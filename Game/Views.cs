namespace Podium.Game;

/// <summary>Baut die Zustands-Objekte, die an Host bzw. Spieler geschickt werden. Aufruf nur innerhalb von g.Lock.</summary>
public static class Views
{
    static string P(Phase p) => p.ToString().ToLowerInvariant();

    static int RemainingMs(Game g) => g.Phase is Phase.Intro or Phase.Answering
        ? Math.Max(0, (int)(g.DeadlineUtc - DateTime.UtcNow).TotalMilliseconds) : 0;

    static bool ShowSolution(Game g) => g.Phase is Phase.Reveal;

    public static object HostState(Game g)
    {
        var q = g.Current;
        var idx = g.QuestionIndex;
        var reveal = ShowSolution(g);
        int[]? distribution = null;
        int answeredCount = 0, correctCount = 0;
        double avgMs = 0;
        if (q != null)
        {
            var answers = g.Players.Values.Select(p => p.Answers.GetValueOrDefault(idx)).Where(a => a != null).ToList();
            answeredCount = answers.Count;
            if (reveal || g.Phase is Phase.Scoreboard)
            {
                distribution = new int[q.Options.Count];
                foreach (var a in answers) foreach (var c in a!.Choices) distribution[c]++;
                correctCount = answers.Count(a => a!.Correct);
                avgMs = answers.Count > 0 ? answers.Average(a => a!.ElapsedMs) : 0;
            }
        }

        return new
        {
            role = "host",
            pin = g.Pin,
            joinUrl = g.JoinUrl,
            quizTitle = g.QuizTitle,
            phase = P(g.Phase),
            version = g.Version,
            questionIndex = idx,
            questionCount = g.Questions.Count,
            isLast = g.IsLastQuestion,
            remainingMs = RemainingMs(g),
            question = q == null ? null : new
            {
                text = q.Text,
                timeLimit = q.TimeLimitSeconds,
                multi = q.Multi,
                correctCount = q.Options.Count(o => o.Correct),
                points = q.PointsMultiplier,
                options = q.Options.Select(o => new { text = o.Text, correct = reveal || g.Phase is Phase.Scoreboard ? o.Correct : (bool?)null })
            },
            answeredCount,
            connectedCount = g.Players.Values.Count(p => p.Connected),
            distribution,
            correctCount,
            avgMs = Math.Round(avgMs),
            players = g.Ranked.Select(p => new
            {
                id = p.Id,
                nick = p.Nickname,
                avatar = p.Avatar,
                score = p.Score,
                rank = p.Rank,
                prevRank = p.PrevRank,
                connected = p.Connected,
                anon = p.Anonymous,
                streak = p.Streak,
                lastPoints = q != null && p.Answers.TryGetValue(idx, out var a) ? a.Points : 0,
                lastCorrect = q != null && p.Answers.TryGetValue(idx, out var b) && b.Correct,
                correctTotal = p.Answers.Values.Count(x => x.Correct),
                answered = g.Phase == Phase.Direct && g.Direct != null ? g.Direct.Answers.ContainsKey(p.Id) : q != null && p.Answers.ContainsKey(idx),
            }),
            hasQuiz = g.Questions.Count > 0,
            direct = g.Direct == null ? null : DirectHost(g.Direct),
            stats = g.Phase is Phase.Final or Phase.Podium ? FinalStats(g) : null,
        };
    }

    // ---------------------------------------------------------------- DirectMode

    static string K(DirectKind k) => k.ToString().ToLowerInvariant();

    static object DirectHost(DirectQuestion d) => new
    {
        id = d.Id,
        text = d.Text,
        kind = K(d.Kind),
        options = d.Options,
        multi = d.Multi,
        live = d.Live,
        min = d.Min,
        max = d.Max,
        unit = d.Unit,
        open = d.Open,
        count = d.Answers.Count,
        results = d.Live || !d.Open ? DirectResults(d) : null,
    };

    /// <summary>Anonyme Auswertung: Häufigkeiten / Kennwerte / Wortliste.</summary>
    public static object DirectResults(DirectQuestion d)
    {
        var answers = d.Answers.Values.ToList();
        switch (d.Kind)
        {
            case DirectKind.Choice:
                var counts = new int[d.Options.Count];
                foreach (var a in answers) foreach (var c in a.Choices ?? []) counts[c]++;
                return new { counts };
            case DirectKind.Number:
                var v = answers.Where(a => a.Number.HasValue).Select(a => a.Number!.Value).Order().ToArray();
                if (v.Length == 0) return new { values = v, n = 0 };
                double mean = v.Average();
                double median = v.Length % 2 == 1 ? v[v.Length / 2] : (v[v.Length / 2 - 1] + v[v.Length / 2]) / 2;
                double sd = v.Length > 1 ? Math.Sqrt(v.Sum(x => (x - mean) * (x - mean)) / (v.Length - 1)) : 0;
                return new { values = v, n = v.Length, mean, median, min = v[0], max = v[^1], sd };
            default:
                // Gleiche Antworten (ohne Groß/Klein, Leerraum normalisiert) werden zusammengefasst
                var words = answers.Where(a => !string.IsNullOrWhiteSpace(a.Text))
                    .GroupBy(a => string.Join(' ', a.Text!.Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries)))
                    .Select(gr => new { w = gr.GroupBy(a => a.Text!.Trim()).OrderByDescending(x => x.Count()).First().Key, n = gr.Count() })
                    .OrderByDescending(x => x.n).ThenBy(x => x.w).Take(100).ToList();
                return new { words, n = answers.Count };
        }
    }

    static object DirectPlayer(DirectQuestion d, Player p)
    {
        var a = d.Answers.GetValueOrDefault(p.Id);
        return new
        {
            id = d.Id,
            text = d.Text,
            kind = K(d.Kind),
            options = d.Options,
            multi = d.Multi,
            min = d.Min,
            max = d.Max,
            unit = d.Unit,
            open = d.Open,
            mine = a == null ? null : new { choices = a.Choices, number = a.Number, text = a.Text },
        };
    }

    static object FinalStats(Game g) => new
    {
        questions = g.Questions.Select((q, i) =>
        {
            var answers = g.Players.Values.Select(p => p.Answers.GetValueOrDefault(i)).Where(a => a != null).ToList();
            var dist = new int[q.Options.Count];
            foreach (var a in answers) foreach (var c in a!.Choices) dist[c]++;
            return new
            {
                text = q.Text,
                options = q.Options.Select(o => new { text = o.Text, correct = o.Correct }),
                distribution = dist,
                answered = answers.Count,
                correct = answers.Count(a => a!.Correct),
                players = g.Players.Count,
                avgMs = answers.Count > 0 ? Math.Round(answers.Average(a => a!.ElapsedMs)) : 0,
            };
        }),
    };

    public static object PlayerState(Game g, Player p)
    {
        var q = g.Current;
        var idx = g.QuestionIndex;
        var a = q != null ? p.Answers.GetValueOrDefault(idx) : null;
        var ranked = g.Ranked.ToList();
        var pos = ranked.IndexOf(p);
        var ahead = pos > 0 ? ranked[pos - 1] : null;

        return new
        {
            role = "player",
            pin = g.Pin,
            quizTitle = g.QuizTitle,
            phase = P(g.Phase),
            version = g.Version,
            me = new { id = p.Id, nick = p.Nickname, avatar = p.Avatar, score = p.Score, rank = p.Rank, streak = p.Streak },
            playerCount = g.Players.Count,
            questionIndex = idx,
            questionCount = g.Questions.Count,
            remainingMs = RemainingMs(g),
            question = q == null ? null : new
            {
                text = q.Text,
                multi = q.Multi,
                timeLimit = q.TimeLimitSeconds,
                optionCount = q.Options.Count,
                options = q.Options.Select(o => o.Text),
                correct = ShowSolution(g) ? q.Options.Select((o, i) => (o, i)).Where(x => x.o.Correct).Select(x => x.i) : null,
            },
            answer = a == null ? null : new
            {
                choices = a.Choices,
                correct = g.Phase is Phase.Reveal or Phase.Scoreboard ? a.Correct : (bool?)null,
                points = g.Phase is Phase.Reveal or Phase.Scoreboard ? a.Points : 0,
            },
            ahead = ahead == null ? null : new { nick = ahead.Nickname, diff = ahead.Score - p.Score },
            correctTotal = p.Answers.Values.Count(x => x.Correct),
            hasQuiz = g.Questions.Count > 0,
            direct = g.Direct == null ? null : DirectPlayer(g.Direct, p),
        };
    }
}
