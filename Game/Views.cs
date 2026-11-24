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
        object? estimate = null;
        var solved = reveal || g.Phase is Phase.Scoreboard;
        if (q != null)
        {
            var answers = g.Players.Values.Select(p => p.Answers.GetValueOrDefault(idx)).Where(a => a != null).ToList();
            answeredCount = answers.Count;
            if (solved)
            {
                if (q.IsChoice)
                {
                    distribution = new int[q.Options.Count];
                    foreach (var a in answers) foreach (var c in a!.Choices) distribution[c]++;
                }
                if (q.IsEstimate) estimate = EstimateStats(g, q, idx);
                correctCount = answers.Count(a => a!.Correct);
                avgMs = answers.Count > 0 ? answers.Average(a => a!.ElapsedMs) : 0;
            }
        }
        var next = g.Questions.Skip(idx + 1).Select((x, i) => (x, i: idx + 1 + i)).FirstOrDefault(t => !g.Skipped.Contains(t.i)).x;

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
                kind = q.Kind,
                timeLimit = q.TimeLimitSeconds,
                multi = q.Multi,
                correctCount = q.IsChoice ? q.Options.Count(o => o.Correct) : 0,
                points = q.PointsMultiplier,
                unit = q.Unit,
                options = q.Displayed.Select(o => new { text = o.Text, correct = solved && q.IsChoice ? o.Correct : (bool?)null }),
                correctOrder = solved && q.IsOrder ? q.CorrectSequence : null,
                correctValue = solved && q.IsEstimate ? q.CorrectValue : null,
                tolerance = q.IsEstimate ? q.Tolerance : 0,
                explanation = solved ? q.Explanation : "",
                // nur für die Fernbedienung (die Leinwand zeigt sie nicht)
                notes = q.Notes,
            },
            next = next == null ? null : new { text = next.Text, kind = next.Kind },
            theme = g.Theme,
            skipped = g.Skipped.Count,
            answeredCount,
            connectedCount = g.Players.Values.Count(p => p.Connected),
            distribution,
            estimate,
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

    /// <summary>Schätzfrage: Kennwerte der Schätzungen und die drei nächsten Schätzungen</summary>
    static object EstimateStats(Game g, QuestionSnap q, int idx)
    {
        var est = g.Players.Values.Select(p => (p, a: p.Answers.GetValueOrDefault(idx))).Where(x => x.a?.Number != null)
            .Select(x => (x.p, v: x.a!.Number!.Value)).ToList();
        var v = est.Select(x => x.v).Order().ToArray();
        var c = q.CorrectValue ?? 0;
        return new
        {
            n = v.Length,
            mean = v.Length > 0 ? v.Average() : (double?)null,
            median = v.Length == 0 ? (double?)null : v.Length % 2 == 1 ? v[v.Length / 2] : (v[v.Length / 2 - 1] + v[v.Length / 2]) / 2,
            min = v.Length > 0 ? v[0] : (double?)null,
            max = v.Length > 0 ? v[^1] : (double?)null,
            within = est.Count(x => q.Hits(x.v)),
            values = v,
            closest = est.Where(x => !x.p.Anonymous).OrderBy(x => Math.Abs(x.v - c)).Take(3).Select(x => new { nick = x.p.Nickname, value = x.v }),
        };
    }

    /// <summary>Auswertung je Frage (Leinwand-Statistik und gespeicherte Auswertung einer Runde)</summary>
    public static object FinalStats(Game g) => new
    {
        questions = g.Questions.Select((q, i) =>
        {
            var answers = g.Players.Values.Select(p => p.Answers.GetValueOrDefault(i)).Where(a => a != null).ToList();
            var dist = new int[q.IsChoice ? q.Options.Count : 0];
            if (q.IsChoice) foreach (var a in answers) foreach (var c in a!.Choices) dist[c]++;
            var nums = answers.Where(a => a!.Number != null).Select(a => a!.Number!.Value).Order().ToArray();
            return new
            {
                text = q.Text,
                kind = q.Kind,
                // Reihenfolge: Elemente in der richtigen Reihenfolge
                options = q.Options.Select(o => new { text = o.Text, correct = o.Correct }),
                distribution = dist,
                answered = answers.Count,
                correct = answers.Count(a => a!.Correct),
                players = g.Players.Count(p => !p.Value.Anonymous),
                avgMs = answers.Count > 0 ? Math.Round(answers.Average(a => a!.ElapsedMs)) : 0,
                skipped = g.Skipped.Contains(i),
                correctValue = q.CorrectValue,
                tolerance = q.Tolerance,
                unit = q.Unit,
                median = nums.Length == 0 ? (double?)null : nums.Length % 2 == 1 ? nums[nums.Length / 2] : (nums[nums.Length / 2 - 1] + nums[nums.Length / 2]) / 2,
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
                kind = q.Kind,
                multi = q.Multi,
                timeLimit = q.TimeLimitSeconds,
                unit = q.Unit,
                optionCount = q.Options.Count,
                options = q.Displayed.Select(o => o.Text),
                correct = ShowSolution(g) && q.IsChoice ? q.Options.Select((o, i) => (o, i)).Where(x => x.o.Correct).Select(x => x.i) : null,
                correctOrder = ShowSolution(g) && q.IsOrder ? q.CorrectSequence : null,
                correctValue = ShowSolution(g) && q.IsEstimate ? q.CorrectValue : null,
                tolerance = q.IsEstimate ? q.Tolerance : 0,
                explanation = ShowSolution(g) ? q.Explanation : "",
            },
            answer = a == null ? null : new
            {
                choices = a.Choices,
                number = a.Number,
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
