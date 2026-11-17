using Microsoft.EntityFrameworkCore;

namespace Podium.Data;

/// <summary>Dozierenden-Konto. Passwort nur als PBKDF2-Hash (siehe Auth/Passwords.cs).</summary>
public class User
{
    public int Id { get; set; }
    /// <summary>Anmeldename, immer klein geschrieben</summary>
    public string UserName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool IsAdmin { get; set; }
    public bool Active { get; set; } = true;
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginUtc { get; set; }
}

/// <summary>Einmal-Link: Einladung für ein neues Konto oder Zurücksetzen eines Passworts. Gespeichert wird nur der SHA-256 des Tokens.</summary>
public class Invite
{
    public int Id { get; set; }
    public string TokenHash { get; set; } = "";
    /// <summary>"invite" oder "reset"</summary>
    public string Kind { get; set; } = "invite";
    /// <summary>bei "reset": betroffenes Konto</summary>
    public int? UserId { get; set; }
    public bool IsAdmin { get; set; }
    public string Note { get; set; } = "";
    public int CreatedById { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresUtc { get; set; }
    public DateTime? UsedUtc { get; set; }
    public int? UsedById { get; set; }
}

public class Quiz
{
    public int Id { get; set; }
    /// <summary>Besitzer (Dozierende:r); jede:r sieht nur eigene Quizze</summary>
    public int? OwnerId { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
    public List<Question> Questions { get; set; } = new();
}

public class Question
{
    public int Id { get; set; }
    public int QuizId { get; set; }
    public int Order { get; set; }
    public string Text { get; set; } = "";
    /// <summary>Antwortzeit in Sekunden (5..240).</summary>
    public int TimeLimitSeconds { get; set; } = 20;
    /// <summary>Punkte-Multiplikator: 0 = ohne Punkte, 1 = Standard, 2 = doppelt.</summary>
    public int PointsMultiplier { get; set; } = 1;
    public List<AnswerOption> Options { get; set; } = new();
}

public class AnswerOption
{
    public int Id { get; set; }
    public int QuestionId { get; set; }
    public int Order { get; set; }
    public string Text { get; set; } = "";
    public bool IsCorrect { get; set; }
}

/// <summary>Archiv einer gespielten Runde.</summary>
public class GameSession
{
    public int Id { get; set; }
    public int? OwnerId { get; set; }
    public int QuizId { get; set; }
    public string QuizTitle { get; set; } = "";
    public string Pin { get; set; } = "";
    public DateTime StartedUtc { get; set; }
    public DateTime? FinishedUtc { get; set; }
    public List<GameSessionPlayer> Players { get; set; } = new();
}

public class GameSessionPlayer
{
    public int Id { get; set; }
    public int GameSessionId { get; set; }
    public string Nickname { get; set; } = "";
    public int Score { get; set; }
    public int Rank { get; set; }
    public int CorrectCount { get; set; }
}

/// <summary>Archiv einer Direktfrage (anonym: nur die Werte, keine Namen).</summary>
public class DirectPoll
{
    public int Id { get; set; }
    public int? OwnerId { get; set; }
    public string Pin { get; set; } = "";
    public string RoomTitle { get; set; } = "";
    public string Text { get; set; } = "";
    public string Kind { get; set; } = "";
    public string OptionsJson { get; set; } = "[]";
    public string ResultsJson { get; set; } = "{}";
    public int AnswerCount { get; set; }
    public DateTime CreatedUtc { get; set; }
}

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Invite> Invites => Set<Invite>();
    public DbSet<Quiz> Quizzes => Set<Quiz>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<AnswerOption> AnswerOptions => Set<AnswerOption>();
    public DbSet<GameSession> GameSessions => Set<GameSession>();
    public DbSet<GameSessionPlayer> GameSessionPlayers => Set<GameSessionPlayer>();
    public DbSet<DirectPoll> DirectPolls => Set<DirectPoll>();

    /// <summary>EnsureCreated legt bei bestehender DB keine neuen Tabellen an – daher hier nachziehen.</summary>
    /// <summary>
    /// EnsureCreated legt bei einer bestehenden Datenbank keine neuen Tabellen/Spalten an – fehlende Teile hier nachziehen
    /// (idempotent; ersetzt Migrationen, solange das Schema klein ist).
    /// </summary>
    public void EnsureSchemaUpgrades()
    {
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""DirectPolls"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_DirectPolls"" PRIMARY KEY AUTOINCREMENT,
            ""Pin"" TEXT NOT NULL, ""RoomTitle"" TEXT NOT NULL, ""Text"" TEXT NOT NULL, ""Kind"" TEXT NOT NULL,
            ""OptionsJson"" TEXT NOT NULL, ""ResultsJson"" TEXT NOT NULL, ""AnswerCount"" INTEGER NOT NULL, ""CreatedUtc"" TEXT NOT NULL)");
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""Users"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_Users"" PRIMARY KEY AUTOINCREMENT,
            ""UserName"" TEXT NOT NULL, ""DisplayName"" TEXT NOT NULL, ""PasswordHash"" TEXT NOT NULL,
            ""IsAdmin"" INTEGER NOT NULL, ""Active"" INTEGER NOT NULL, ""CreatedUtc"" TEXT NOT NULL, ""LastLoginUtc"" TEXT NULL)");
        Database.ExecuteSqlRaw(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Users_UserName"" ON ""Users"" (""UserName"")");
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""Invites"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_Invites"" PRIMARY KEY AUTOINCREMENT,
            ""TokenHash"" TEXT NOT NULL, ""Kind"" TEXT NOT NULL, ""UserId"" INTEGER NULL, ""IsAdmin"" INTEGER NOT NULL, ""Note"" TEXT NOT NULL,
            ""CreatedById"" INTEGER NOT NULL, ""CreatedUtc"" TEXT NOT NULL, ""ExpiresUtc"" TEXT NOT NULL, ""UsedUtc"" TEXT NULL, ""UsedById"" INTEGER NULL)");
        Database.ExecuteSqlRaw(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Invites_TokenHash"" ON ""Invites"" (""TokenHash"")");
        foreach (var table in new[] { "Quizzes", "GameSessions", "DirectPolls" })
            if (!HasColumn(table, "OwnerId")) Database.ExecuteSqlRaw($@"ALTER TABLE ""{table}"" ADD COLUMN ""OwnerId"" INTEGER NULL");
    }

    bool HasColumn(string table, string column)
    {
        var conn = Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}'";
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(u => u.UserName).IsUnique();
        b.Entity<Invite>().HasIndex(i => i.TokenHash).IsUnique();
        b.Entity<Quiz>().HasMany(q => q.Questions).WithOne().HasForeignKey(q => q.QuizId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Question>().HasMany(q => q.Options).WithOne().HasForeignKey(o => o.QuestionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GameSession>().HasMany(g => g.Players).WithOne().HasForeignKey(p => p.GameSessionId).OnDelete(DeleteBehavior.Cascade);
    }
}

public static class Seed
{
    /// <summary>Legt für ein (neues) Konto ein Beispiel-Quiz an, falls es noch keines besitzt.</summary>
    public static void EnsureDemo(AppDb db, int ownerId)
    {
        if (db.Quizzes.Any(q => q.OwnerId == ownerId)) return;
        var quiz = new Quiz
        {
            OwnerId = ownerId,
            Title = "Demo: Grundlagen Informatik",
            Description = "Ein kleines Beispiel-Quiz zum Ausprobieren",
            Questions =
            {
                Q(1, "Wie viele Bits hat ein Byte?", 15, ("4", false), ("8", true), ("16", false), ("32", false)),
                Q(2, "Welche dieser Sprachen sind kompiliert (klassisch, ahead-of-time)?", 25, ("C", true), ("Rust", true), ("Python", false), ("Bash", false), ("Go", true), ("JavaScript", false)),
                Q(3, "HTTP steht für …", 20, ("HyperText Transfer Protocol", true), ("High Transfer Text Process", false), ("Hyperlink Tracking Protocol", false)),
                Q(4, "Ist 0x1F gleich 31?", 10, ("Ja", true), ("Nein", false)),
                Q(5, "Welche Datenstrukturen arbeiten nach dem LIFO-Prinzip?", 20, ("Stack", true), ("Queue", false), ("Call-Stack einer Funktion", true), ("Ringpuffer", false), ("Heap (Prioritätswarteschlange)", false)),
            }
        };
        db.Quizzes.Add(quiz);
        db.SaveChanges();
    }

    static Question Q(int order, string text, int secs, params (string t, bool c)[] opts) => new()
    {
        Order = order,
        Text = text,
        TimeLimitSeconds = secs,
        Options = opts.Select((o, i) => new AnswerOption { Order = i, Text = o.t, IsCorrect = o.c }).ToList()
    };
}
