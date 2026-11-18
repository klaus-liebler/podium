using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Podium.Auth;
using Podium.Data;
using Podium.Game;

namespace Podium.Music;

/// <summary>
/// Musikmanager: Jede:r Dozierende wählt pro Spielabschnitt (Warteraum, Fragestellung, Lösung &amp; Statistik, Siegerehrung)
/// Stücke aus den mitgelieferten Titeln oder lädt eigene Dateien hoch. Leere Auswahl = Standard der jeweiligen 3D-Welt.
/// Verweise: "b:&lt;datei&gt;" = mitgeliefert (public/music), "u:&lt;id&gt;" = eigener Upload.
/// </summary>
public static partial class MusicApi
{
    public static readonly string[] Slots = ["lobby", "question", "reveal", "podium"];
    const long MaxFile = 30_000_000;          // je Datei
    const long MaxTotal = 400_000_000;        // je Konto
    const int MaxFiles = 60;

    static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        [".mp3"] = "audio/mpeg", [".ogg"] = "audio/ogg", [".oga"] = "audio/ogg", [".opus"] = "audio/ogg",
        [".m4a"] = "audio/mp4", [".aac"] = "audio/aac", [".wav"] = "audio/wav", [".flac"] = "audio/flac", [".webm"] = "audio/webm",
    };

    [GeneratedRegex(@"^[a-f0-9]{32}\.[a-z0-9]{2,5}$")] private static partial Regex StoredName();

    public static string Dir(IConfiguration cfg, string dbPath)
    {
        var d = cfg["MusicPath"] ?? Path.Combine(Path.GetDirectoryName(Path.GetFullPath(dbPath))!, "musik");
        Directory.CreateDirectory(d);
        return d;
    }

    public record Selection(List<string>? Lobby, List<string>? Question, List<string>? Reveal, List<string>? Podium);
    public record UploadDto(int Id, string Title, string FileName, string Url, long Size, double? Start, double? IntroEnd, DateTime CreatedUtc);
    public record UploadPatch(string? Title, double? Start, double? IntroEnd);

    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    static Selection ReadSelection(string? json)
    {
        try { return JsonSerializer.Deserialize<Selection>(string.IsNullOrWhiteSpace(json) ? "{}" : json, Json) ?? new(null, null, null, null); }
        catch (JsonException) { return new(null, null, null, null); }
    }

    static UploadDto Dto(MusicUpload u) => new(u.Id, u.Title, u.FileName, $"api/music/f/{u.StoredName}", u.Size, u.StartSec, u.IntroEndSec, u.CreatedUtc);

    /// <summary>Uploads + Auswahl eines Kontos (für Dozentenbereich und Leinwand)</summary>
    static async Task<object> Config(AppDb db, int ownerId)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == ownerId);
        var uploads = await db.MusicUploads.AsNoTracking().Where(m => m.OwnerId == ownerId).OrderBy(m => m.Title).ToListAsync();
        return new { uploads = uploads.Select(Dto), selection = ReadSelection(user?.MusicJson) };
    }

    public static void MapMusic(this RouteGroupBuilder api, string dir)
    {
        // Leinwand: Musik des Spiel-Besitzers (ausgewiesen über den geheimen Host-Schlüssel, ohne Anmeldung)
        api.MapGet("/games/{pin}/music", async (string pin, string key, GameManager games, AppDb db) =>
        {
            var g = games.Get(pin);
            if (g == null || !string.Equals(g.HostKey, key, StringComparison.Ordinal)) return Results.NotFound();
            return g.OwnerId is int id ? Results.Ok(await Config(db, id)) : Results.Ok(new { uploads = Array.Empty<object>(), selection = new { } });
        });

        // Audiodateien: nicht aufzählbarer Zufallsname, Range-Anfragen (Spulen) werden unterstützt
        api.MapGet("/music/f/{name}", (string name, HttpContext ctx) =>
        {
            if (!StoredName().IsMatch(name)) return Results.NotFound();
            var path = Path.Combine(dir, name);
            if (!File.Exists(path)) return Results.NotFound();
            ctx.Response.Headers.CacheControl = "private, max-age=604800";
            ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.File(path, Types.GetValueOrDefault(Path.GetExtension(name), "application/octet-stream"), enableRangeProcessing: true);
        });

        var my = api.MapGroup("/music").RequireAuthorization();
        my.MapGet("", async (AppDb db, ClaimsPrincipal u) => Results.Ok(await Config(db, u.UserId())));

        my.MapPut("/selection", async (Selection sel, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            var mine = (await db.MusicUploads.Where(m => m.OwnerId == id).Select(m => m.Id).ToListAsync()).Select(i => "u:" + i).ToHashSet();
            List<string> Clean(List<string>? l) => (l ?? []).Where(r => r.StartsWith("b:") ? r.Length < 120 && !r.Contains('/') && !r.Contains('\\') : mine.Contains(r))
                .Distinct().Take(40).ToList();
            var clean = new Selection(Clean(sel.Lobby), Clean(sel.Question), Clean(sel.Reveal), Clean(sel.Podium));
            var user = await db.Users.FirstAsync(x => x.Id == id);
            user.MusicJson = JsonSerializer.Serialize(clean, Json);
            await db.SaveChangesAsync();
            return Results.Ok(clean);
        });

        my.MapPost("/uploads", async (IFormFileCollection files, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            if (files.Count == 0) return Results.BadRequest(new { error = "Keine Datei gewählt." });
            var have = await db.MusicUploads.Where(m => m.OwnerId == id).Select(m => m.Size).ToListAsync();
            long total = have.Sum();
            var added = new List<UploadDto>();
            foreach (var f in files)
            {
                var ext = Path.GetExtension(f.FileName).ToLowerInvariant();
                if (!Types.ContainsKey(ext)) return Results.BadRequest(new { error = $"„{f.FileName}“: unterstützt werden {string.Join(", ", Types.Keys)}." });
                if (f.Length > MaxFile) return Results.BadRequest(new { error = $"„{f.FileName}“ ist zu groß (max. {MaxFile / 1_000_000} MB)." });
                if (have.Count + added.Count >= MaxFiles) return Results.BadRequest(new { error = $"Höchstens {MaxFiles} eigene Stücke." });
                if (total + f.Length > MaxTotal) return Results.BadRequest(new { error = $"Speicherplatz erschöpft (max. {MaxTotal / 1_000_000} MB je Konto)." });
                var stored = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)).ToLowerInvariant() + ext;
                await using (var s = File.Create(Path.Combine(dir, stored))) await f.CopyToAsync(s);
                var title = Path.GetFileNameWithoutExtension(f.FileName).Replace('_', ' ').Trim();
                var m = new MusicUpload { OwnerId = id, Title = title.Length > 100 ? title[..100] : title, FileName = Path.GetFileName(f.FileName), StoredName = stored, Size = f.Length };
                db.MusicUploads.Add(m);
                await db.SaveChangesAsync();
                total += f.Length;
                added.Add(Dto(m));
            }
            return Results.Ok(added);
        }).DisableAntiforgery() // Cookie ist SameSite=Strict
          .WithMetadata(new RequestSizeLimitAttribute(MaxFile * 4 + 1_000_000))
          .WithMetadata(new RequestFormLimitsAttribute { MultipartBodyLengthLimit = MaxFile * 4 + 1_000_000 });

        my.MapPut("/uploads/{uid:int}", async (int uid, UploadPatch p, AppDb db, ClaimsPrincipal u) =>
        {
            var m = await db.MusicUploads.FirstOrDefaultAsync(x => x.Id == uid && x.OwnerId == u.UserId());
            if (m == null) return Results.NotFound();
            if (p.Title is { } t && t.Trim().Length > 0) m.Title = t.Trim().Length > 100 ? t.Trim()[..100] : t.Trim();
            m.StartSec = p.Start is > 0 and < 3600 ? p.Start : null;
            m.IntroEndSec = p.IntroEnd is > 0 and < 3600 ? p.IntroEnd : null;
            await db.SaveChangesAsync();
            return Results.Ok(Dto(m));
        });

        my.MapDelete("/uploads/{uid:int}", async (int uid, AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            var m = await db.MusicUploads.FirstOrDefaultAsync(x => x.Id == uid && x.OwnerId == id);
            if (m == null) return Results.NoContent();
            db.MusicUploads.Remove(m);
            // Verweis auch aus der Auswahl entfernen
            var user = await db.Users.FirstAsync(x => x.Id == id);
            var sel = ReadSelection(user.MusicJson);
            List<string>? Drop(List<string>? l) => l?.Where(r => r != "u:" + uid).ToList();
            user.MusicJson = JsonSerializer.Serialize(new Selection(Drop(sel.Lobby), Drop(sel.Question), Drop(sel.Reveal), Drop(sel.Podium)), Json);
            await db.SaveChangesAsync();
            try { File.Delete(Path.Combine(dir, m.StoredName)); } catch (IOException) { /* evtl. gerade in Wiedergabe – bleibt als Waise liegen */ }
            return Results.NoContent();
        });
    }
}
