using System.Collections.Concurrent;
using System.Security.Cryptography;
using Podium.Data;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Podium.Game;

public sealed class GameManager(IHubContext<GameHub> hub, IServiceScopeFactory scopes, ILogger<GameManager> log)
{
    public const int IntroMs = 4500;
    const int MaxPlayers = 500;

    readonly ConcurrentDictionary<string, Game> _games = new();

    public Game? Get(string pin) => _games.TryGetValue(pin ?? "", out var g) ? g : null;

    public static string HostGroup(string pin) => "host-" + pin;

    // ------------------------------------------------------------------ Erzeugen

    public async Task<Game> CreateAsync(int quizId, string joinBase, int ownerId)
    {
        Cleanup();
        string title = "Live-Fragerunde";
        int quizIdValue = 0;
        var questions = new List<QuestionSnap>();
        if (quizId > 0)
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            var quiz = await db.Quizzes.Include(q => q.Questions).ThenInclude(q => q.Options)
                .AsNoTracking().FirstOrDefaultAsync(q => q.Id == quizId && q.OwnerId == ownerId)
                ?? throw new InvalidOperationException("Quiz nicht gefunden");
            questions = quiz.Questions.OrderBy(q => q.Order)
                .Where(q => q.Options.Count >= 2 && q.Options.Any(o => o.IsCorrect))
                .Select(q => new QuestionSnap(q.Text, Math.Clamp(q.TimeLimitSeconds, 5, 240), Math.Clamp(q.PointsMultiplier, 0, 2),
                    q.Options.OrderBy(o => o.Order).Take(6).Select(o => new OptionSnap(o.Text, o.IsCorrect)).ToList()))
                .ToList();
            if (questions.Count == 0) throw new InvalidOperationException("Das Quiz enthält keine spielbaren Fragen (mind. 2 Antworten, mind. 1 richtig).");
            title = quiz.Title;
            quizIdValue = quiz.Id;
        }

        string pin;
        do pin = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
        while (_games.ContainsKey(pin));

        var game = new Game
        {
            Pin = pin,
            HostKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)),
            QuizId = quizIdValue,
            OwnerId = ownerId,
            QuizTitle = title,
            Questions = questions,
            // Live-Fragerunde: QR führt direkt (anonym) zur Antwortseite; Quiz: Beitritt mit Name + Avatar
            JoinUrl = questions.Count == 0 ? $"{joinBase.TrimEnd('/')}/#/ask/{pin}" : $"{joinBase.TrimEnd('/')}/#/join/{pin}",
        };
        _games[pin] = game;
        log.LogInformation("Spiel {Pin} ({Title}) erstellt", pin, title);
        return game;
    }

    void Cleanup()
    {
        foreach (var (pin, g) in _games)
            if (DateTime.UtcNow - g.CreatedUtc > TimeSpan.FromHours(8)) _games.TryRemove(pin, out _);
    }

    // ------------------------------------------------------------------ Spieler

    public (Player? player, string? error) Join(Game g, string nickname, Avatar? avatar, string connectionId)
    {
        nickname = (nickname ?? "").Trim();
        if (nickname.Length is < 1 or > 20) return (null, "Der Name muss 1–20 Zeichen lang sein.");
        lock (g.Lock)
        {
            if (g.Phase is Phase.Podium || (g.Phase is Phase.Final && g.Questions.Count > 0))
                return (null, "Das Spiel ist bereits beendet.");
            if (g.Players.Count >= MaxPlayers) return (null, "Das Spiel ist voll.");
            if (g.Players.Values.Any(p => string.Equals(p.Nickname, nickname, StringComparison.OrdinalIgnoreCase)))
                return (null, "Dieser Name ist schon vergeben.");
            var p = new Player
            {
                Id = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)),
                Nickname = nickname,
                Avatar = Avatar.Sanitize(avatar),
                ConnectionId = connectionId,
                Connected = true,
                JoinOrder = g.Players.Count,
            };
            g.Players[p.Id] = p;
            g.Rerank();
            return (p, null);
        }
    }

    /// <summary>Anonyme Teilnahme an einer Live-Fragerunde. Bekannte Id wird wiederverwendet (Reload/Verbindungsabbruch).</summary>
    public (Player? player, string? error) JoinAnonymous(Game g, string? audienceId, string connectionId)
    {
        lock (g.Lock)
        {
            if (g.Questions.Count > 0) return (null, "quiz");
            if (audienceId != null && g.Players.TryGetValue(audienceId, out var known) && known.Anonymous)
            {
                known.ConnectionId = connectionId; known.Connected = true;
                return (known, null);
            }
            if (g.Players.Count >= MaxPlayers) return (null, "Der Raum ist voll.");
            var p = new Player
            {
                Id = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)),
                Nickname = "",
                Anonymous = true,
                Avatar = new Avatar(0, 0, 0, 0, 0),
                ConnectionId = connectionId,
                Connected = true,
                JoinOrder = g.Players.Count,
            };
            g.Players[p.Id] = p;
            return (p, null);
        }
    }

    public Player? Rejoin(Game g, string playerId, string connectionId)
    {
        lock (g.Lock)
        {
            if (!g.Players.TryGetValue(playerId ?? "", out var p)) return null;
            p.ConnectionId = connectionId;
            p.Connected = true;
            return p;
        }
    }

    public void UpdateAvatar(Game g, string connectionId, Avatar avatar)
    {
        lock (g.Lock)
        {
            var p = g.Players.Values.FirstOrDefault(x => x.ConnectionId == connectionId);
            if (p != null) p.Avatar = Avatar.Sanitize(avatar);
        }
    }

    public async Task DisconnectedAsync(string connectionId)
    {
        foreach (var g in _games.Values)
        {
            bool changed = false;
            lock (g.Lock)
            {
                foreach (var p in g.Players.Values.Where(p => p.ConnectionId == connectionId))
                {
                    p.Connected = false;
                    changed = true;
                }
            }
            if (changed) await SendHostAsync(g);
        }
    }

    /// <summary>Raum schließen: offene Direktfrage archivieren, Raum entfernen, Handys benachrichtigen.</summary>
    public async Task CloseAsync(Game g)
    {
        await DirectCloseAsync(g);                       // archiviert eine noch offene Abstimmung (sonst nichts)
        if (!_games.TryRemove(g.Pin, out _)) return;
        string[] conns;
        lock (g.Lock) conns = g.Players.Values.Select(p => p.ConnectionId).OfType<string>().ToArray();
        await Task.WhenAll(conns.Select(c => hub.Clients.Client(c).SendAsync("closed")));
        log.LogInformation("Raum {Pin} ({Title}) geschlossen", g.Pin, g.QuizTitle);
    }

    public async Task KickAsync(Game g, string playerId)
    {
        string? conn;
        lock (g.Lock)
        {
            if (!g.Players.Remove(playerId, out var p)) return;
            conn = p.ConnectionId;
            g.Rerank();
        }
        if (conn != null) await hub.Clients.Client(conn).SendAsync("kicked");
        await SendHostAsync(g);
    }

    public async Task<bool> AnswerAsync(Game g, string connectionId, int questionIndex, int[] choices)
    {
        bool allAnswered;
        int version;
        lock (g.Lock)
        {
            if (g.Phase != Phase.Answering || g.QuestionIndex != questionIndex) return false;
            var p = g.Players.Values.FirstOrDefault(x => x.ConnectionId == connectionId);
            if (p == null || p.Answers.ContainsKey(questionIndex)) return false;
            var q = g.Current!;
            var clean = (choices ?? []).Where(c => c >= 0 && c < q.Options.Count).Distinct().Order().ToArray();
            if (clean.Length == 0) return false;
            if (!q.Multi && clean.Length > 1) clean = clean[..1];
            var elapsed = Math.Max(0, (DateTime.UtcNow - g.PhaseStartUtc).TotalMilliseconds);
            p.Answers[questionIndex] = new PlayerAnswer { Choices = clean, ElapsedMs = elapsed };
            allAnswered = g.Players.Values.Where(x => x.Connected).All(x => x.Answers.ContainsKey(questionIndex));
            version = g.Version;
        }
        if (allAnswered) await EndAnsweringAsync(g, version);
        else await SendHostAsync(g);
        return true;
    }

    // ------------------------------------------------------------------ Ablauf (Host)

    public async Task NextAsync(Game g)
    {
        int version;
        Phase phase;
        lock (g.Lock) { version = g.Version; phase = g.Phase; }
        switch (phase)
        {
            case Phase.Lobby:
                lock (g.Lock) { if (g.Questions.Count == 0) return; g.StartedUtc = DateTime.UtcNow; }
                await StartQuestionAsync(g, 0, version);
                break;
            case Phase.Intro:
                await BeginAnsweringAsync(g, version);
                break;
            case Phase.Answering:
                await EndAnsweringAsync(g, version);
                break;
            case Phase.Reveal:
                bool last;
                lock (g.Lock) last = g.IsLastQuestion;
                if (last) await SetPhaseAsync(g, version, Phase.Podium);
                else await SetPhaseAsync(g, version, Phase.Scoreboard);
                break;
            case Phase.Scoreboard:
                int next;
                lock (g.Lock) next = g.QuestionIndex + 1;
                await StartQuestionAsync(g, next, version);
                break;
            case Phase.Podium:
                await SetPhaseAsync(g, version, Phase.Final);
                await PersistAsync(g);
                break;
        }
    }

    public async Task FinishEarlyAsync(Game g)
    {
        int v;
        lock (g.Lock) { if (g.Questions.Count == 0 || g.Phase is Phase.Lobby or Phase.Direct) return; v = g.Version; }
        await SetPhaseAsync(g, v, Phase.Podium);
    }

    async Task StartQuestionAsync(Game g, int index, int expectedVersion)
    {
        int v;
        lock (g.Lock)
        {
            if (g.Version != expectedVersion || index >= g.Questions.Count) return;
            g.QuestionIndex = index;
            g.Phase = Phase.Intro;
            g.PhaseStartUtc = DateTime.UtcNow;
            g.DeadlineUtc = g.PhaseStartUtc.AddMilliseconds(IntroMs);
            v = ++g.Version;
        }
        await BroadcastAsync(g);
        Schedule(IntroMs, () => BeginAnsweringAsync(g, v));
    }

    async Task BeginAnsweringAsync(Game g, int expectedVersion)
    {
        int v, ms;
        lock (g.Lock)
        {
            if (g.Version != expectedVersion || g.Phase != Phase.Intro) return;
            g.Phase = Phase.Answering;
            ms = g.Current!.TimeLimitSeconds * 1000;
            g.PhaseStartUtc = DateTime.UtcNow;
            g.DeadlineUtc = g.PhaseStartUtc.AddMilliseconds(ms);
            v = ++g.Version;
        }
        await BroadcastAsync(g);
        Schedule(ms + 300, () => EndAnsweringAsync(g, v));
    }

    async Task EndAnsweringAsync(Game g, int expectedVersion)
    {
        lock (g.Lock)
        {
            if (g.Version != expectedVersion || g.Phase != Phase.Answering) return;
            Score(g);
            g.Phase = Phase.Reveal;
            g.PhaseStartUtc = DateTime.UtcNow;
            g.Version++;
        }
        await BroadcastAsync(g);
    }

    async Task SetPhaseAsync(Game g, int expectedVersion, Phase phase)
    {
        lock (g.Lock)
        {
            if (g.Version != expectedVersion) return;
            g.Phase = phase;
            g.PhaseStartUtc = DateTime.UtcNow;
            g.Version++;
        }
        await BroadcastAsync(g);
    }

    void Schedule(int ms, Func<Task> action) => _ = Task.Run(async () =>
    {
        await Task.Delay(ms);
        try { await action(); } catch (Exception ex) { log.LogError(ex, "Timer-Aktion fehlgeschlagen"); }
    });

    /// <summary>Punkte: nur exakt richtige Auswahl zählt. Bis 1000 Punkte, linear auf 500 fallend über die Zeit, plus Serienbonus.</summary>
    static void Score(Game g)
    {
        var q = g.Current!;
        var correctSet = q.Options.Select((o, i) => (o, i)).Where(x => x.o.Correct).Select(x => x.i).ToArray();
        var limitMs = q.TimeLimitSeconds * 1000.0;
        foreach (var p in g.Players.Values)
        {
            if (p.Answers.TryGetValue(g.QuestionIndex, out var a))
            {
                a.Correct = a.Choices.SequenceEqual(correctSet);
                if (a.Correct)
                {
                    p.Streak++;
                    var frac = Math.Clamp(a.ElapsedMs / limitMs, 0, 1);
                    var basePts = (int)Math.Round(1000 * (1 - frac / 2));
                    var bonus = Math.Min(Math.Max(p.Streak - 1, 0) * 100, 500);
                    a.Points = (basePts + bonus) * q.PointsMultiplier;
                    p.Score += a.Points;
                }
                else p.Streak = 0;
            }
            else p.Streak = 0;
        }
        g.Rerank();
    }

    async Task PersistAsync(Game g)
    {
        GameSession session;
        lock (g.Lock)
        {
            if (g.Persisted) return;
            g.Persisted = true;
            session = new GameSession
            {
                QuizId = g.QuizId,
                OwnerId = g.OwnerId,
                QuizTitle = g.QuizTitle,
                Pin = g.Pin,
                StartedUtc = g.StartedUtc,
                FinishedUtc = DateTime.UtcNow,
                Players = g.Ranked.Select(p => new GameSessionPlayer
                {
                    Nickname = p.Nickname,
                    Score = p.Score,
                    Rank = p.Rank,
                    CorrectCount = p.Answers.Values.Count(a => a.Correct)
                }).ToList()
            };
        }
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.GameSessions.Add(session);
            await db.SaveChangesAsync();
        }
        catch (Exception ex) { log.LogError(ex, "Speichern der Ergebnisse fehlgeschlagen"); }
    }

    // ------------------------------------------------------------------ DirectMode

    public async Task<string?> DirectStartAsync(Game g, DirectSpec spec)
    {
        var text = (spec.Text ?? "").Trim();
        if (text.Length is < 1 or > 300) return "Bitte eine Frage (max. 300 Zeichen) eingeben.";
        if (!Enum.TryParse<DirectKind>(spec.Kind, true, out var kind)) return "Unbekannter Fragetyp.";
        var options = (spec.Options ?? []).Select(o => (o ?? "").Trim()).ToList();
        if (kind == DirectKind.Choice)
        {
            if (options.Count is < 2 or > 6) return "Bitte 2 bis 6 Antwortmöglichkeiten angeben.";
            if (options.Any(o => o.Length is < 1 or > 150)) return "Antwortmöglichkeiten dürfen nicht leer sein (max. 150 Zeichen).";
        }
        else options.Clear();
        if (kind == DirectKind.Number && spec.Min is { } mn && spec.Max is { } mx && mn >= mx) return "Minimum muss kleiner als Maximum sein.";
        var unit = kind == DirectKind.Number ? (spec.Unit ?? "").Trim() : "";
        if (unit.Length > 12) unit = unit[..12];
        lock (g.Lock)
        {
            if (g.Phase is Phase.Intro or Phase.Answering or Phase.Podium) return "Während einer laufenden Quizfrage nicht möglich.";
            g.Direct = new DirectQuestion
            {
                Id = ++g.DirectCounter,
                Text = text,
                Kind = kind,
                Options = options,
                Multi = kind == DirectKind.Choice && spec.Multi,
                Live = spec.Live,
                Min = kind == DirectKind.Number ? spec.Min : null,
                Max = kind == DirectKind.Number ? spec.Max : null,
                Unit = unit,
                ReturnPhase = g.Phase == Phase.Direct ? g.Direct?.ReturnPhase ?? Phase.Lobby : g.Phase,
            };
            g.Phase = Phase.Direct;
            g.PhaseStartUtc = DateTime.UtcNow;
            g.Version++;
        }
        await BroadcastAsync(g);
        return null;
    }

    public async Task DirectSetLiveAsync(Game g, bool live)
    {
        lock (g.Lock) { if (g.Direct == null) return; g.Direct.Live = live; }
        await SendHostAsync(g);
    }

    public async Task DirectCloseAsync(Game g)
    {
        DirectPoll archive;
        lock (g.Lock)
        {
            var d = g.Direct;
            if (d == null || !d.Open) return;
            d.Open = false;
            g.Version++;
            archive = new DirectPoll
            {
                OwnerId = g.OwnerId,
                Pin = g.Pin,
                RoomTitle = g.QuizTitle,
                Text = d.Text,
                Kind = d.Kind.ToString().ToLowerInvariant(),
                OptionsJson = System.Text.Json.JsonSerializer.Serialize(d.Options),
                ResultsJson = System.Text.Json.JsonSerializer.Serialize(Views.DirectResults(d)),
                AnswerCount = d.Answers.Count,
                CreatedUtc = d.StartedUtc,
            };
        }
        await BroadcastAsync(g);
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.DirectPolls.Add(archive);
            await db.SaveChangesAsync();
        }
        catch (Exception ex) { log.LogError(ex, "Direktfrage konnte nicht gespeichert werden"); }
    }

    public async Task DirectEndAsync(Game g)
    {
        lock (g.Lock)
        {
            if (g.Phase != Phase.Direct || g.Direct == null) return;
            g.Phase = g.Direct.ReturnPhase;
            g.Direct = null;
            g.PhaseStartUtc = DateTime.UtcNow;
            g.Version++;
        }
        await BroadcastAsync(g);
    }

    public async Task<string?> DirectAnswerAsync(Game g, string connectionId, int directId, int[]? choices, double? number, string? text)
    {
        Player? p;
        lock (g.Lock)
        {
            var d = g.Direct;
            if (g.Phase != Phase.Direct || d == null || d.Id != directId) return "Diese Frage ist nicht mehr aktiv.";
            if (!d.Open) return "Die Abstimmung ist bereits geschlossen.";
            p = g.Players.Values.FirstOrDefault(x => x.ConnectionId == connectionId);
            if (p == null) return "Nicht angemeldet.";
            DirectAnswer a;
            switch (d.Kind)
            {
                case DirectKind.Choice:
                    var clean = (choices ?? []).Where(c => c >= 0 && c < d.Options.Count).Distinct().Order().ToArray();
                    if (clean.Length == 0) return "Bitte eine Auswahl treffen.";
                    if (!d.Multi) clean = clean[..1];
                    a = new DirectAnswer { Choices = clean };
                    break;
                case DirectKind.Number:
                    if (number is not { } n || !double.IsFinite(n)) return "Bitte eine Zahl eingeben.";
                    if ((d.Min is { } mn && n < mn) || (d.Max is { } mx && n > mx)) return $"Bitte eine Zahl zwischen {d.Min} und {d.Max} eingeben.";
                    a = new DirectAnswer { Number = n };
                    break;
                default:
                    var t = (text ?? "").Trim();
                    if (t.Length is < 1 or > 60) return "Bitte 1 bis 60 Zeichen eingeben.";
                    a = new DirectAnswer { Text = t };
                    break;
            }
            d.Answers[p.Id] = a;
        }
        await SendPlayerAsync(g, p);
        RequestHostUpdate(g);
        return null;
    }

    /// <summary>Bündelt viele schnelle Host-Updates (z. B. 200 Antworten in einer Sekunde) zu wenigen Nachrichten.</summary>
    void RequestHostUpdate(Game g)
    {
        lock (g.Lock) { if (g.HostUpdatePending) return; g.HostUpdatePending = true; }
        Schedule(150, async () =>
        {
            lock (g.Lock) g.HostUpdatePending = false;
            await SendHostAsync(g);
        });
    }

    // ------------------------------------------------------------------ Versand

    public async Task BroadcastAsync(Game g)
    {
        await SendHostAsync(g);
        List<(string conn, object state)> msgs;
        lock (g.Lock)
            msgs = g.Players.Values.Where(p => p.ConnectionId != null)
                .Select(p => (p.ConnectionId!, (object)Views.PlayerState(g, p))).ToList();
        await Task.WhenAll(msgs.Select(m => hub.Clients.Client(m.conn).SendAsync("state", m.state)));
    }

    public Task SendHostAsync(Game g)
    {
        object s;
        lock (g.Lock) s = Views.HostState(g);
        return hub.Clients.Group(HostGroup(g.Pin)).SendAsync("state", s);
    }

    public Task SendPlayerAsync(Game g, Player p)
    {
        object s;
        lock (g.Lock) s = Views.PlayerState(g, p);
        return hub.Clients.Client(p.ConnectionId!).SendAsync("state", s);
    }
}
