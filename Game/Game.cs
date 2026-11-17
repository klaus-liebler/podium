namespace Podium.Game;

public enum Phase { Lobby, Intro, Answering, Reveal, Scoreboard, Podium, Final, Direct }

// ---------------------------------------------------------------- DirectMode (spontane Fragen ans Publikum)
public enum DirectKind { Choice, Number, Text }

/// <summary>Vom Dozenten spontan gestellte Frage. Antworten sind bis zum Schließen möglich und änderbar.</summary>
public sealed record DirectSpec(string Text, string Kind, List<string>? Options, bool Multi, bool Live, double? Min, double? Max, string? Unit);

public sealed class DirectAnswer
{
    public int[]? Choices { get; init; }
    public double? Number { get; init; }
    public string? Text { get; init; }
    public DateTime AtUtc { get; init; } = DateTime.UtcNow;
}

public sealed class DirectQuestion
{
    public required int Id { get; init; }
    public required string Text { get; init; }
    public required DirectKind Kind { get; init; }
    public List<string> Options { get; init; } = new();
    public bool Multi { get; init; }
    public bool Live { get; set; }
    public double? Min { get; init; }
    public double? Max { get; init; }
    public string Unit { get; init; } = "";
    public bool Open { get; set; } = true;
    public Phase ReturnPhase { get; init; }
    public DateTime StartedUtc { get; } = DateTime.UtcNow;
    /// <summary>Antworten je Spieler-Id (überschreibbar, solange offen)</summary>
    public Dictionary<string, DirectAnswer> Answers { get; } = new();
}

public sealed record OptionSnap(string Text, bool Correct);
public sealed record QuestionSnap(string Text, int TimeLimitSeconds, int PointsMultiplier, List<OptionSnap> Options)
{
    public bool Multi => Options.Count(o => o.Correct) > 1;
}

/// <summary>Gestaltbarer Avatar: jeweils ein Index in eine feste Teile-Liste (Client rendert SVG).</summary>
/// <remarks>Body = 3D-Figur (Kenney Mini Characters), Aid = Hilfsmittel (0 keins, 1 Brille, 2 Sonnenbrille)</remarks>
public sealed record Avatar(int Shape, int Color, int Eyes, int Mouth, int Hat, int Body = 0, int Aid = 0)
{
    public static Avatar Sanitize(Avatar? a) => a is null
        ? new Avatar(0, 0, 0, 0, 0)
        : new Avatar(C(a.Shape), C(a.Color), C(a.Eyes), C(a.Mouth), C(a.Hat), C(a.Body), Math.Clamp(a.Aid, 0, 2));
    static int C(int v) => Math.Clamp(v, 0, 31);
}

public sealed class PlayerAnswer
{
    public required int[] Choices { get; init; }
    public required double ElapsedMs { get; init; }
    public bool Correct { get; set; }
    public int Points { get; set; }
}

public sealed class Player
{
    public required string Id { get; init; }
    public required string Nickname { get; init; }
    /// <summary>Anonyme Teilnahme (Live-Fragerunde per QR): kein Name, kein Avatar, keine Wertung</summary>
    public bool Anonymous { get; init; }
    public required Avatar Avatar { get; set; }
    public string? ConnectionId { get; set; }
    public bool Connected { get; set; }
    public int Score { get; set; }
    public int Streak { get; set; }
    public int Rank { get; set; }
    public int PrevRank { get; set; }
    public int JoinOrder { get; init; }
    public Dictionary<int, PlayerAnswer> Answers { get; } = new();
}

public sealed class Game
{
    public required string Pin { get; init; }
    public required string HostKey { get; init; }
    public required int QuizId { get; init; }
    public int? OwnerId { get; init; }
    public required string QuizTitle { get; init; }
    public required List<QuestionSnap> Questions { get; init; }
    public required string JoinUrl { get; init; }
    public DateTime CreatedUtc { get; } = DateTime.UtcNow;
    public DateTime StartedUtc { get; set; }

    public object Lock { get; } = new();
    public Phase Phase { get; set; } = Phase.Lobby;
    public int QuestionIndex { get; set; } = -1;
    public DateTime PhaseStartUtc { get; set; }
    public DateTime DeadlineUtc { get; set; }
    /// <summary>Wird bei jedem Phasenwechsel erhöht, damit verspätete Timer nichts mehr auslösen.</summary>
    public int Version { get; set; }
    public bool Persisted { get; set; }
    public DirectQuestion? Direct { get; set; }
    public int DirectCounter { get; set; }
    public bool HostUpdatePending { get; set; }

    public Dictionary<string, Player> Players { get; } = new();

    public QuestionSnap? Current => QuestionIndex >= 0 && QuestionIndex < Questions.Count ? Questions[QuestionIndex] : null;
    public bool IsLastQuestion => QuestionIndex >= Questions.Count - 1;

    public IEnumerable<Player> Ranked => Players.Values.OrderByDescending(p => p.Score).ThenBy(p => p.JoinOrder);

    public void Rerank()
    {
        int r = 0, prevScore = int.MinValue, shown = 0;
        foreach (var p in Ranked)
        {
            r++;
            if (p.Score != prevScore) shown = r;
            prevScore = p.Score;
            p.PrevRank = p.Rank == 0 ? shown : p.Rank;
            p.Rank = shown;
        }
    }
}
