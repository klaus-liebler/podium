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
    /// <summary>Musikauswahl je Spielabschnitt (JSON, siehe Music/MusicApi.cs)</summary>
    public string MusicJson { get; set; } = "{}";
    /// <summary>Hochschul-Login: dauerhafte Kennung vom IdP (subject-id/pairwise-id/eppn); null = nur lokales Konto</summary>
    public string? SsoId { get; set; }
    /// <summary>Hochschul-Login: E-Mail-Adresse laut IdP (bei jeder Anmeldung aktualisiert)</summary>
    public string? Email { get; set; }
    /// <summary>Eigener Claude-API-Schlüssel für KI-Vorschläge – verschlüsselt (Data Protection), nie im Klartext ausgeliefert</summary>
    public string? AiKeyProtected { get; set; }

    // ---- ASP.NET Core Identity (siehe Auth/Identity.cs)
    /// <summary>Sicherheitsstempel: steht im Anmelde-Cookie; ändert er sich (Passwort, Admin-Recht, zweiter Faktor …), enden alle Sitzungen</summary>
    public string SecurityStamp { get; set; } = NewStamp();
    /// <summary>Fehlversuche in Folge (Passwort oder Code); nach zu vielen ist das Konto bis LockoutEndUtc gesperrt</summary>
    public int AccessFailedCount { get; set; }
    public DateTime? LockoutEndUtc { get; set; }
    /// <summary>Zweiter Faktor (TOTP, Authenticator-App) eingerichtet – Pflicht für Admins</summary>
    public bool TwoFactorEnabled { get; set; }
    /// <summary>TOTP-Geheimnis, verschlüsselt (Data Protection)</summary>
    public string? AuthenticatorKeyProtected { get; set; }
    /// <summary>SHA-256 der noch gültigen Wiederherstellungscodes, durch „;“ getrennt</summary>
    public string? RecoveryCodes { get; set; }

    public static string NewStamp() => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
}

/// <summary>Verknüpfung eines Kontos mit einem Identitätsdienst (Identity-„Login“): SAML = dauerhafte Hochschulkennung wie bisher in User.SsoId, OIDC = „sub“.</summary>
public class UserLogin
{
    public int Id { get; set; }
    public int UserId { get; set; }
    /// <summary>"SAML" oder "OIDC"</summary>
    public string Provider { get; set; } = "";
    public string ProviderKey { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>Passkey (WebAuthn) eines Kontos – nur öffentliche Daten.</summary>
public class UserPasskey
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public byte[] CredentialId { get; set; } = [];
    public byte[] PublicKey { get; set; } = [];
    public string Name { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public long SignCount { get; set; }
    public string Transports { get; set; } = "";
    public bool IsUserVerified { get; set; }
    public bool IsBackupEligible { get; set; }
    public bool IsBackedUp { get; set; }
    public byte[] AttestationObject { get; set; } = [];
    public byte[] ClientDataJson { get; set; } = [];
}

/// <summary>Eigenes, hochgeladenes Musikstück eines Kontos. Datei liegt unter StoredName im Musikordner.</summary>
public class MusicUpload
{
    public int Id { get; set; }
    public int OwnerId { get; set; }
    public string Title { get; set; } = "";
    public string FileName { get; set; } = "";
    public string StoredName { get; set; } = "";
    public long Size { get; set; }
    /// <summary>optional: Wiedergabe ab Sekunde</summary>
    public double? StartSec { get; set; }
    /// <summary>optional (Siegerehrung): Ende des Intros für „Nach dem Intro ausblenden“</summary>
    public double? IntroEndSec { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
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
    /// <summary>optional: Ordner (z. B. ein Kurs); null = ohne Ordner</summary>
    public int? FolderId { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
    /// <summary>Papierkorb: gesetzt = gelöscht (nach 30 Tagen endgültig entfernt)</summary>
    public DateTime? DeletedUtc { get; set; }
    /// <summary>optional: 3D-Welt für dieses Quiz ("" = wie zuletzt auf der Leinwand gewählt)</summary>
    public string Theme { get; set; } = "";
    /// <summary>optional: eigene Musikauswahl für dieses Quiz (JSON wie User.MusicJson, "" = Auswahl des Kontos)</summary>
    public string MusicJson { get; set; } = "";
    /// <summary>Teilen per Link: zufälliges Token (null = nicht geteilt)</summary>
    public string? ShareToken { get; set; }
    public List<Question> Questions { get; set; } = new();
}

/// <summary>Ordner für Quizze eines Kontos (z. B. je Kurs). Löschen lässt die Quizze bestehen (sie wandern nach „ohne Ordner“).</summary>
public class QuizFolder
{
    public int Id { get; set; }
    public int OwnerId { get; set; }
    public string Name { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    /// <summary>optional: feste Kurs-PIN – Runden mit Quizzen aus diesem Ordner bekommen immer diese PIN</summary>
    public string? Pin { get; set; }
}

/// <summary>Fragetypen: Auswahl (1..n richtig), Schätzfrage (Zahl mit Toleranz), Reihenfolge (Antworten richtig anordnen)</summary>
public static class QuestionKinds
{
    public const string Choice = "choice", Estimate = "estimate", Order = "order";
    public static string Norm(string? k) => k is Estimate or Order ? k : Choice;
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
    /// <summary>Fragetyp (QuestionKinds); bei "order" ist die gespeicherte Reihenfolge der Antworten die richtige</summary>
    public string Kind { get; set; } = QuestionKinds.Choice;
    /// <summary>optional: Erklärung, die mit der Lösung erscheint (Markdown)</summary>
    public string Explanation { get; set; } = "";
    /// <summary>optional: Notizen für die Lehrperson – nur auf der Fernbedienung sichtbar</summary>
    public string Notes { get; set; } = "";
    /// <summary>Schätzfrage: richtiger Wert, Toleranz (± absolut, 0 = exakt) und Einheit</summary>
    public double? CorrectValue { get; set; }
    public double? Tolerance { get; set; }
    public string Unit { get; set; } = "";
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
    /// <summary>Auswertung je Frage (JSON, siehe Views.FinalStats) – für die Auswertung nach der Vorlesung</summary>
    public string StatsJson { get; set; } = "";
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

/// <summary>Gespeicherte Direktfrage als Vorlage (z. B. „Wie war das Tempo heute?“)</summary>
public class DirectTemplate
{
    public int Id { get; set; }
    public int OwnerId { get; set; }
    /// <summary>DirectSpec als JSON</summary>
    public string SpecJson { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>Bild in einer Frage/Antwort. Datei liegt unter StoredName im Bildordner; Abruf über api/media/{StoredName} (nicht aufzählbar).</summary>
public class MediaFile
{
    public int Id { get; set; }
    public int OwnerId { get; set; }
    public string StoredName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Invite> Invites => Set<Invite>();
    public DbSet<Quiz> Quizzes => Set<Quiz>();
    public DbSet<QuizFolder> QuizFolders => Set<QuizFolder>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<AnswerOption> AnswerOptions => Set<AnswerOption>();
    public DbSet<GameSession> GameSessions => Set<GameSession>();
    public DbSet<GameSessionPlayer> GameSessionPlayers => Set<GameSessionPlayer>();
    public DbSet<DirectPoll> DirectPolls => Set<DirectPoll>();
    public DbSet<MusicUpload> MusicUploads => Set<MusicUpload>();
    public DbSet<DirectTemplate> DirectTemplates => Set<DirectTemplate>();
    public DbSet<MediaFile> MediaFiles => Set<MediaFile>();
    public DbSet<UserLogin> UserLogins => Set<UserLogin>();
    public DbSet<UserPasskey> UserPasskeys => Set<UserPasskey>();

    /// <summary>
    /// Alle Zeitpunkte sind UTC. SQLite speichert sie als Text ohne Zeitzone, EF liest sie als DateTimeKind.Unspecified –
    /// dann fehlt im JSON das "Z" und der Browser hielte sie für Ortszeit. Beim Lesen daher als UTC kennzeichnen.
    /// </summary>
    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        b.Properties<DateTime>().HaveConversion<UtcConverter>();
        b.Properties<DateTime?>().HaveConversion<UtcConverter>();
    }
    sealed class UtcConverter() : Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime, DateTime>(
        v => v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : v,
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

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
            if (!HasColumn(table, "OwnerId")) SpalteAnlegen(table, "OwnerId", "INTEGER NULL");
        // Achtung: ExecuteSqlRaw deutet geschweifte Klammern als Platzhalter – daher Vorgabe '' (wird wie {} gelesen)
        if (!HasColumn("Users", "MusicJson")) Database.ExecuteSqlRaw(@"ALTER TABLE ""Users"" ADD COLUMN ""MusicJson"" TEXT NOT NULL DEFAULT ''");
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""MusicUploads"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_MusicUploads"" PRIMARY KEY AUTOINCREMENT,
            ""OwnerId"" INTEGER NOT NULL, ""Title"" TEXT NOT NULL, ""FileName"" TEXT NOT NULL, ""StoredName"" TEXT NOT NULL,
            ""Size"" INTEGER NOT NULL, ""StartSec"" REAL NULL, ""IntroEndSec"" REAL NULL, ""CreatedUtc"" TEXT NOT NULL)");
        Database.ExecuteSqlRaw(@"CREATE INDEX IF NOT EXISTS ""IX_MusicUploads_OwnerId"" ON ""MusicUploads"" (""OwnerId"")");
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""QuizFolders"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_QuizFolders"" PRIMARY KEY AUTOINCREMENT,
            ""OwnerId"" INTEGER NOT NULL, ""Name"" TEXT NOT NULL, ""CreatedUtc"" TEXT NOT NULL)");
        Database.ExecuteSqlRaw(@"CREATE INDEX IF NOT EXISTS ""IX_QuizFolders_OwnerId"" ON ""QuizFolders"" (""OwnerId"")");
        if (!HasColumn("Users", "SsoId")) Database.ExecuteSqlRaw(@"ALTER TABLE ""Users"" ADD COLUMN ""SsoId"" TEXT NULL");
        if (!HasColumn("Users", "Email")) Database.ExecuteSqlRaw(@"ALTER TABLE ""Users"" ADD COLUMN ""Email"" TEXT NULL");
        Database.ExecuteSqlRaw(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Users_SsoId"" ON ""Users"" (""SsoId"")");
        if (!HasColumn("Quizzes", "FolderId")) Database.ExecuteSqlRaw(@"ALTER TABLE ""Quizzes"" ADD COLUMN ""FolderId"" INTEGER NULL");
        foreach (var (table, col, type) in new[] {
            ("Quizzes", "DeletedUtc", "TEXT NULL"), ("Quizzes", "Theme", "TEXT NOT NULL DEFAULT ''"), ("Quizzes", "MusicJson", "TEXT NOT NULL DEFAULT ''"),
            ("Quizzes", "ShareToken", "TEXT NULL"), ("QuizFolders", "Pin", "TEXT NULL"),
            ("Questions", "Kind", "TEXT NOT NULL DEFAULT 'choice'"), ("Questions", "Explanation", "TEXT NOT NULL DEFAULT ''"),
            ("Questions", "Notes", "TEXT NOT NULL DEFAULT ''"), ("Questions", "CorrectValue", "REAL NULL"), ("Questions", "Tolerance", "REAL NULL"),
            ("Questions", "Unit", "TEXT NOT NULL DEFAULT ''"), ("GameSessions", "StatsJson", "TEXT NOT NULL DEFAULT ''"),
            ("Users", "AiKeyProtected", "TEXT NULL") })
            if (!HasColumn(table, col)) SpalteAnlegen(table, col, type);
        Database.ExecuteSqlRaw(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Quizzes_ShareToken"" ON ""Quizzes"" (""ShareToken"")");
        Database.ExecuteSqlRaw(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_QuizFolders_Pin"" ON ""QuizFolders"" (""Pin"")");
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""DirectTemplates"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_DirectTemplates"" PRIMARY KEY AUTOINCREMENT,
            ""OwnerId"" INTEGER NOT NULL, ""SpecJson"" TEXT NOT NULL, ""CreatedUtc"" TEXT NOT NULL)");
        Database.ExecuteSqlRaw(@"CREATE INDEX IF NOT EXISTS ""IX_DirectTemplates_OwnerId"" ON ""DirectTemplates"" (""OwnerId"")");
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""MediaFiles"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_MediaFiles"" PRIMARY KEY AUTOINCREMENT,
            ""OwnerId"" INTEGER NOT NULL, ""StoredName"" TEXT NOT NULL, ""ContentType"" TEXT NOT NULL, ""Size"" INTEGER NOT NULL, ""CreatedUtc"" TEXT NOT NULL)");
        Database.ExecuteSqlRaw(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_MediaFiles_StoredName"" ON ""MediaFiles"" (""StoredName"")");
        // ASP.NET Core Identity: Stempel, Sperre, zweiter Faktor; Verknüpfungen (bisherige SsoId wird übernommen) und Passkeys
        foreach (var (table, col, type) in new[] {
            ("Users", "SecurityStamp", "TEXT NOT NULL DEFAULT ''"), ("Users", "AccessFailedCount", "INTEGER NOT NULL DEFAULT 0"),
            ("Users", "LockoutEndUtc", "TEXT NULL"), ("Users", "TwoFactorEnabled", "INTEGER NOT NULL DEFAULT 0"),
            ("Users", "AuthenticatorKeyProtected", "TEXT NULL"), ("Users", "RecoveryCodes", "TEXT NULL") })
            if (!HasColumn(table, col)) SpalteAnlegen(table, col, type);
        Database.ExecuteSqlRaw(@"UPDATE ""Users"" SET ""SecurityStamp"" = upper(hex(randomblob(16))) WHERE ""SecurityStamp"" = ''");
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""UserLogins"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_UserLogins"" PRIMARY KEY AUTOINCREMENT,
            ""UserId"" INTEGER NOT NULL, ""Provider"" TEXT NOT NULL, ""ProviderKey"" TEXT NOT NULL, ""DisplayName"" TEXT NOT NULL, ""CreatedUtc"" TEXT NOT NULL,
            CONSTRAINT ""FK_UserLogins_Users_UserId"" FOREIGN KEY (""UserId"") REFERENCES ""Users"" (""Id"") ON DELETE CASCADE)");
        Database.ExecuteSqlRaw(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_UserLogins_Provider_ProviderKey"" ON ""UserLogins"" (""Provider"", ""ProviderKey"")");
        Database.ExecuteSqlRaw(@"CREATE INDEX IF NOT EXISTS ""IX_UserLogins_UserId"" ON ""UserLogins"" (""UserId"")");
        Database.ExecuteSqlRaw(@"INSERT INTO ""UserLogins"" (""UserId"", ""Provider"", ""ProviderKey"", ""DisplayName"", ""CreatedUtc"")
            SELECT u.""Id"", 'SAML', u.""SsoId"", 'Hochschulkennung', u.""CreatedUtc"" FROM ""Users"" u
            WHERE u.""SsoId"" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ""UserLogins"" l WHERE l.""Provider"" = 'SAML' AND l.""ProviderKey"" = u.""SsoId"")");
        Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""UserPasskeys"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_UserPasskeys"" PRIMARY KEY AUTOINCREMENT,
            ""UserId"" INTEGER NOT NULL, ""CredentialId"" BLOB NOT NULL, ""PublicKey"" BLOB NOT NULL, ""Name"" TEXT NOT NULL, ""CreatedUtc"" TEXT NOT NULL,
            ""SignCount"" INTEGER NOT NULL, ""Transports"" TEXT NOT NULL, ""IsUserVerified"" INTEGER NOT NULL, ""IsBackupEligible"" INTEGER NOT NULL,
            ""IsBackedUp"" INTEGER NOT NULL, ""AttestationObject"" BLOB NOT NULL, ""ClientDataJson"" BLOB NOT NULL,
            CONSTRAINT ""FK_UserPasskeys_Users_UserId"" FOREIGN KEY (""UserId"") REFERENCES ""Users"" (""Id"") ON DELETE CASCADE)");
        Database.ExecuteSqlRaw(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_UserPasskeys_CredentialId"" ON ""UserPasskeys"" (""CredentialId"")");
        Database.ExecuteSqlRaw(@"CREATE INDEX IF NOT EXISTS ""IX_UserPasskeys_UserId"" ON ""UserPasskeys"" (""UserId"")");
        // Papierkorb: nach 30 Tagen endgültig löschen (Fragen/Antworten per Fremdschlüssel-Kaskade)
        Database.ExecuteSqlRaw(@"DELETE FROM ""Quizzes"" WHERE ""DeletedUtc"" IS NOT NULL AND ""DeletedUtc"" < @p0", DateTime.UtcNow.AddDays(-30));
        // Umbenanntes Stück: gespeicherte Musikauswahl ("b:<datei>") nachziehen
        Database.ExecuteSqlRaw(@"UPDATE ""Users"" SET ""MusicJson"" = REPLACE(""MusicJson"", '""b:podium_gehoert_euch.mp3""', '""b:podium_gehoert_euch_liebler.mp3""') WHERE ""MusicJson"" LIKE '%b:podium_gehoert_euch.mp3%'");
    }

    /// <summary>Spalte ergänzen (Namen stammen nur aus diesem Code, nie aus Eingaben)</summary>
    void SpalteAnlegen(string table, string column, string type)
    {
        var sql = "ALTER TABLE \"" + table + "\" ADD COLUMN \"" + column + "\" " + type;
        Database.ExecuteSqlRaw(sql);
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
        b.Entity<UserLogin>().HasIndex(l => new { l.Provider, l.ProviderKey }).IsUnique();
        b.Entity<UserLogin>().HasOne<User>().WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<UserPasskey>().HasIndex(p => p.CredentialId).IsUnique();
        b.Entity<UserPasskey>().HasOne<User>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Invite>().HasIndex(i => i.TokenHash).IsUnique();
        b.Entity<MusicUpload>().HasIndex(m => m.OwnerId);
        b.Entity<QuizFolder>().HasIndex(f => f.OwnerId);
        b.Entity<QuizFolder>().HasIndex(f => f.Pin).IsUnique();
        b.Entity<Quiz>().HasIndex(q => q.ShareToken).IsUnique();
        b.Entity<DirectTemplate>().HasIndex(t => t.OwnerId);
        b.Entity<MediaFile>().HasIndex(m => m.StoredName).IsUnique();
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
