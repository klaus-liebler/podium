using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Podium.Auth;
using Podium.Data;
using Podium.Game;

namespace Podium.Teaching;

/// <summary>
/// Komfortfunktionen des Dozentenbereichs: Bilder in Fragen, Papierkorb, Teilen per Link, Direktfragen-Vorlagen,
/// Auswertung gespielter Runden, offene Räume (vorbereiten, Fernbedienung) und Kurs-PINs.
/// </summary>
public static partial class TeachingApi
{
    const long MaxImage = 5_000_000;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [GeneratedRegex(@"^[a-f0-9]{32}\.(png|jpg|gif|webp)$")] private static partial Regex MediaName();

    public static string MediaDir(IConfiguration cfg, string dbPath)
    {
        var d = cfg["MediaPath"] ?? Path.Combine(Path.GetDirectoryName(Path.GetFullPath(dbPath))!, "bilder");
        Directory.CreateDirectory(d);
        return d;
    }

    /// <summary>Bildtyp an den ersten Bytes erkennen (kein SVG – das könnte Skripte enthalten)</summary>
    static (string ext, string type)? Sniff(ReadOnlySpan<byte> b) =>
        b.Length >= 8 && b[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }) ? ("png", "image/png") :
        b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF ? ("jpg", "image/jpeg") :
        b.Length >= 6 && (b[..6].SequenceEqual("GIF87a"u8) || b[..6].SequenceEqual("GIF89a"u8)) ? ("gif", "image/gif") :
        b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8) ? ("webp", "image/webp") : null;

    static string Token(int bytes = 16) => Convert.ToHexString(RandomNumberGenerator.GetBytes(bytes)).ToLowerInvariant();

    public static void MapTeaching(this RouteGroupBuilder api, string mediaDir)
    {
        // ------------------------------------------------------------ Bilder (öffentlich abrufbar, damit Handys sie sehen)
        api.MapGet("/media/{name}", (string name, HttpContext ctx) =>
        {
            if (!MediaName().IsMatch(name)) return Results.NotFound();
            var path = Path.Combine(mediaDir, name);
            if (!File.Exists(path)) return Results.NotFound();
            ctx.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
            var type = Path.GetExtension(name) switch { ".png" => "image/png", ".jpg" => "image/jpeg", ".gif" => "image/gif", _ => "image/webp" };
            return Results.File(path, type);
        });

        var my = api.MapGroup("").RequireAuthorization();

        my.MapPost("/media", async (IFormFile file, AppDb db, ClaimsPrincipal u) =>
        {
            if (file.Length is 0 or > MaxImage) return Results.BadRequest(new { error = "Bilder bis 5 MB (PNG, JPEG, GIF oder WebP)." });
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            if (Sniff(ms.GetBuffer().AsSpan(0, (int)Math.Min(ms.Length, 16))) is not { } kind)
                return Results.BadRequest(new { error = "Nur PNG, JPEG, GIF oder WebP." });
            var (ext, type) = kind;
            var name = $"{Token()}.{ext}";
            await File.WriteAllBytesAsync(Path.Combine(mediaDir, name), ms.ToArray());
            db.MediaFiles.Add(new MediaFile { OwnerId = u.UserId(), StoredName = name, ContentType = type, Size = ms.Length });
            await db.SaveChangesAsync();
            return Results.Ok(new { url = $"api/media/{name}" });
        }).DisableAntiforgery(); // Cookie ist SameSite=Strict

        // ------------------------------------------------------------ Papierkorb
        my.MapGet("/trash", async (AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            return await db.Quizzes.Where(q => q.OwnerId == id && q.DeletedUtc != null).OrderByDescending(q => q.DeletedUtc)
                .Select(q => new { q.Id, q.Title, q.DeletedUtc, QuestionCount = q.Questions.Count }).ToListAsync();
        });
        my.MapPost("/trash/{qid:int}/restore", async (int qid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            var q = await db.Quizzes.FirstOrDefaultAsync(x => x.Id == qid && x.OwnerId == id && x.DeletedUtc != null);
            if (q == null) return Results.NotFound();
            q.DeletedUtc = null;
            // Ordner inzwischen gelöscht? Dann ohne Ordner wiederherstellen
            if (q.FolderId is int f && !await db.QuizFolders.AnyAsync(x => x.Id == f && x.OwnerId == id)) q.FolderId = null;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
        my.MapDelete("/trash/{qid:int}", async (int qid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            await db.Quizzes.Where(x => x.Id == qid && x.OwnerId == id && x.DeletedUtc != null).ExecuteDeleteAsync();
            return Results.NoContent();
        });
        my.MapDelete("/trash", async (AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            await db.Quizzes.Where(x => x.OwnerId == id && x.DeletedUtc != null).ExecuteDeleteAsync();
            return Results.NoContent();
        });

        // ------------------------------------------------------------ Teilen per Link (Empfänger:innen brauchen ein Konto)
        my.MapPost("/quizzes/{qid:int}/share", async (int qid, AppDb db, ClaimsPrincipal u, HttpContext ctx, IConfiguration cfg) =>
        {
            var id = u.UserId();
            var q = await db.Quizzes.FirstOrDefaultAsync(x => x.Id == qid && x.OwnerId == id && x.DeletedUtc == null);
            if (q == null) return Results.NotFound();
            q.ShareToken ??= Token(18);
            await db.SaveChangesAsync();
            return Results.Ok(new { link = $"{Program.PublicBase(ctx, cfg)}/#/shared/{q.ShareToken}" });
        });
        my.MapDelete("/quizzes/{qid:int}/share", async (int qid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            await db.Quizzes.Where(x => x.Id == qid && x.OwnerId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.ShareToken, (string?)null));
            return Results.NoContent();
        });
        my.MapGet("/shared/{token}", async (string token, AppDb db) =>
        {
            var q = await Shared(db, token);
            if (q == null) return Results.Json(new { error = "Der Link ist ungültig oder wurde zurückgezogen." }, statusCode: 404);
            var owner = await db.Users.AsNoTracking().Where(x => x.Id == q.OwnerId).Select(x => x.DisplayName).FirstOrDefaultAsync();
            return Results.Ok(new { q.Title, q.Description, owner, questions = q.Questions.OrderBy(x => x.Order).Select(x => new { x.Text, kind = QuestionKinds.Norm(x.Kind) }) });
        });
        my.MapPost("/shared/{token}/copy", async (string token, AppDb db, ClaimsPrincipal u) =>
        {
            var q = await Shared(db, token);
            if (q == null) return Results.Json(new { error = "Der Link ist ungültig oder wurde zurückgezogen." }, statusCode: 404);
            var copy = new Quiz { OwnerId = u.UserId(), Theme = q.Theme };
            (QuizDto.From(q) with { Title = q.Title }).ApplyTo(copy);
            db.Quizzes.Add(copy);
            await db.SaveChangesAsync();
            return Results.Ok(new { copy.Id });
        });

        // ------------------------------------------------------------ Direktfragen-Vorlagen
        my.MapGet("/directtemplates", async (AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            var list = await db.DirectTemplates.Where(t => t.OwnerId == id).OrderBy(t => t.CreatedUtc).ToListAsync();
            return list.Select(t => new { t.Id, spec = JsonSerializer.Deserialize<JsonElement>(t.SpecJson) });
        });
        my.MapPost("/directtemplates", async (DirectSpec spec, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            if (string.IsNullOrWhiteSpace(spec.Text) || spec.Text.Length > 300) return Results.BadRequest(new { error = "Bitte eine Frage (max. 300 Zeichen) eingeben." });
            if (await db.DirectTemplates.CountAsync(t => t.OwnerId == id) >= 50) return Results.BadRequest(new { error = "Höchstens 50 Vorlagen." });
            var t = new DirectTemplate { OwnerId = id, SpecJson = JsonSerializer.Serialize(spec with { Options = spec.Options?.Take(6).ToList() }, Json) };
            db.DirectTemplates.Add(t);
            await db.SaveChangesAsync();
            return Results.Ok(new { t.Id });
        });
        my.MapDelete("/directtemplates/{tid:int}", async (int tid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            await db.DirectTemplates.Where(t => t.Id == tid && t.OwnerId == id).ExecuteDeleteAsync();
            return Results.NoContent();
        });

        // ------------------------------------------------------------ Auswertung gespielter Runden
        my.MapGet("/sessions/{sid:int}", async (int sid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            var s = await db.GameSessions.AsNoTracking().Include(x => x.Players).FirstOrDefaultAsync(x => x.Id == sid && x.OwnerId == id);
            if (s == null) return Results.NotFound();
            return Results.Ok(new
            {
                s.Id, s.QuizId, s.QuizTitle, s.StartedUtc, s.FinishedUtc,
                players = s.Players.OrderBy(p => p.Rank).Select(p => new { p.Nickname, p.Score, p.Rank, p.CorrectCount }),
                stats = string.IsNullOrEmpty(s.StatsJson) ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(s.StatsJson),
            });
        });
        my.MapDelete("/sessions/{sid:int}", async (int sid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            await db.GameSessions.Where(x => x.Id == sid && x.OwnerId == id).ExecuteDeleteAsync();
            return Results.NoContent();
        });
        my.MapGet("/sessions/{sid:int}/csv", async (int sid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            var s = await db.GameSessions.AsNoTracking().Include(x => x.Players).FirstOrDefaultAsync(x => x.Id == sid && x.OwnerId == id);
            if (s == null) return Results.NotFound();
            var sb = new StringBuilder("﻿");
            static string C(object? v) => "\"" + (v?.ToString() ?? "").Replace("\"", "\"\"") + "\"";
            sb.AppendLine(string.Join(';', new[] { "Rang", "Name", "Punkte", "Richtig" }.Select(C)));
            foreach (var p in s.Players.OrderBy(p => p.Rank)) sb.AppendLine(string.Join(';', new object[] { p.Rank, p.Nickname, p.Score, p.CorrectCount }.Select(C)));
            if (!string.IsNullOrEmpty(s.StatsJson))
            {
                sb.AppendLine().AppendLine(string.Join(';', new[] { "Nr.", "Frage", "Typ", "Antworten", "Richtig", "Quote %", "Ø Zeit s", "übersprungen" }.Select(C)));
                var qs = JsonSerializer.Deserialize<JsonElement>(s.StatsJson).GetProperty("questions");
                int n = 0;
                foreach (var q in qs.EnumerateArray())
                {
                    n++;
                    int answered = q.GetProperty("answered").GetInt32(), correct = q.GetProperty("correct").GetInt32();
                    sb.AppendLine(string.Join(';', new object[] { n, q.GetProperty("text").GetString() ?? "", q.GetProperty("kind").GetString() ?? "",
                        answered, correct, answered > 0 ? Math.Round(100.0 * correct / answered) : 0,
                        (q.GetProperty("avgMs").GetDouble() / 1000).ToString("0.0", System.Globalization.CultureInfo.GetCultureInfo("de-DE")),
                        q.GetProperty("skipped").GetBoolean() ? "ja" : "" }.Select(C)));
                }
            }
            var file = $"podium-{Regex.Replace(s.QuizTitle, @"[^\w-]+", "_")}-{s.StartedUtc:yyyy-MM-dd}.csv";
            return Results.File(Encoding.UTF8.GetBytes(sb.ToString()), "text/csv; charset=utf-8", file);
        });

        // ------------------------------------------------------------ Offene Räume (vorbereitet oder laufend) und Fernbedienung
        my.MapGet("/games", (GameManager games, ClaimsPrincipal u) => games.ForOwner(u.UserId()).Select(g =>
        {
            lock (g.Lock) return new
            {
                g.Pin, g.HostKey, title = g.QuizTitle, phase = g.Phase.ToString().ToLowerInvariant(), hasQuiz = g.Questions.Count > 0,
                players = g.Players.Count, g.CreatedUtc, g.JoinUrl,
            };
        }));
        // Fernbedienung: Host-Schlüssel nur für den Besitzer (angemeldet) – nie per QR-Code auf der Leinwand
        // Lösungen je Frage gleich mit – die Fernbedienung zeigt sie schon während der Antwortzeit (die Leinwand nicht)
        my.MapGet("/games/{pin}/remote", (string pin, GameManager games, ClaimsPrincipal u) =>
            games.Get(pin) is { } g && g.OwnerId == u.UserId() ? Results.Ok(new
            {
                g.HostKey, title = g.QuizTitle,
                solutions = g.Questions.Select(q => new
                {
                    kind = q.Kind,
                    correct = q.IsOrder ? q.Options.Select(o => o.Text) : q.Options.Where(o => o.Correct).Select(o => o.Text),
                    value = q.CorrectValue, tolerance = q.Tolerance, unit = q.Unit,
                }),
            }) : Results.NotFound());
        my.MapDelete("/games/{pin}", async (string pin, GameManager games, ClaimsPrincipal u) =>
        {
            if (games.Get(pin) is not { } g || g.OwnerId != u.UserId()) return Results.NotFound();
            await games.CloseAsync(g);
            return Results.NoContent();
        });

        // ------------------------------------------------------------ Kurs-PIN je Ordner
        my.MapPut("/folders/{fid:int}/pin", async (int fid, AppDb db, ClaimsPrincipal u, GameManager games) =>
        {
            var id = u.UserId();
            var f = await db.QuizFolders.FirstOrDefaultAsync(x => x.Id == fid && x.OwnerId == id);
            if (f == null) return Results.NotFound();
            if (f.Pin == null)
            {
                var used = (await db.QuizFolders.Where(x => x.Pin != null).Select(x => x.Pin!).ToListAsync()).ToHashSet();
                string pin;
                do pin = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
                while (used.Contains(pin) || games.Get(pin) != null);
                f.Pin = pin;
                await db.SaveChangesAsync();
            }
            return Results.Ok(new { f.Pin });
        });
        my.MapDelete("/folders/{fid:int}/pin", async (int fid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            await db.QuizFolders.Where(x => x.Id == fid && x.OwnerId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.Pin, (string?)null));
            return Results.NoContent();
        });
    }

    static Task<Quiz?> Shared(AppDb db, string token) => token.Length is < 20 or > 64 ? Task.FromResult<Quiz?>(null)
        : db.Quizzes.AsNoTracking().Include(q => q.Questions).ThenInclude(q => q.Options).FirstOrDefaultAsync(q => q.ShareToken == token && q.DeletedUtc == null);
}
