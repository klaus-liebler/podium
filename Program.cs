using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Claims;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Podium.Auth;
using Podium.Data;
using Podium.Game;
using Podium.Import;
using Podium.Music;
using QRCoder;

var builder = WebApplication.CreateBuilder(args);

var dbPath = builder.Configuration["DbPath"] ?? Path.Combine(builder.Environment.ContentRootPath, "podium.db");
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddSignalR();
builder.Services.AddSingleton<GameManager>();
builder.Services.AddPodiumAuth(builder.Configuration);
// Schlüssel für Anmelde-Cookies dauerhaft ablegen (sonst sind nach jedem Neustart alle abgemeldet)
var keysPath = builder.Configuration["KeysPath"] ?? Path.Combine(Path.GetDirectoryName(Path.GetFullPath(dbPath))!, "schluessel");
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(keysPath)).SetApplicationName("Podium");
builder.Services.AddHttpClient("import", c =>
{
    c.Timeout = TimeSpan.FromSeconds(15);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Podium-Importer/1.0");
});
// Hinter nginx: Schema (https) und Host aus den Proxy-Headern übernehmen (nur vom lokalen Proxy)
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    o.KnownProxies.Add(System.Net.IPAddress.Loopback);
    o.KnownProxies.Add(System.Net.IPAddress.IPv6Loopback);
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    db.Database.EnsureCreated();
    db.EnsureSchemaUpgrades();
    AuthApi.LogSetupState(db, app.Logger);   // erstes Admin-Konto legt man in der Oberfläche an (Ersteinrichtung)
}

app.UseForwardedHeaders();
// Betrieb unter einem Unterpfad (z. B. https://liebler.iui.hs-osnabrueck.de/podium) – alle URLs im Frontend sind relativ
var pathBase = app.Configuration["PathBase"];
if (!string.IsNullOrWhiteSpace(pathBase)) app.UsePathBase(pathBase);

// Die Oberfläche ist ein Single-File-Build (web/ -> wwwroot/index.html + index.html.br).
// Unterstützt der Browser Brotli, wird direkt die vorkomprimierte Datei ausgeliefert.
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value;
    if (path is "/" or "/index.html")
    {
        var file = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");
        var br = file + ".br";
        ctx.Response.Headers.CacheControl = "no-cache";
        ctx.Response.Headers["X-Frame-Options"] = "DENY";
        ctx.Response.Headers["Referrer-Policy"] = "same-origin";
        if (ctx.Request.Headers.AcceptEncoding.ToString().Contains("br") && File.Exists(br))
        {
            ctx.Response.Headers.ContentEncoding = "br";
            ctx.Response.Headers.Vary = "Accept-Encoding";
            ctx.Response.ContentType = "text/html; charset=utf-8";
            await ctx.Response.SendFileAsync(br);
            return;
        }
        if (File.Exists(file))
        {
            ctx.Response.ContentType = "text/html; charset=utf-8";
            await ctx.Response.SendFileAsync(file);
            return;
        }
    }
    await next();
});
// 3D-Modelle (Kenney, glTF) – diese Endungen kennt ASP.NET nicht von Haus aus
var mime = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
mime.Mappings[".glb"] = "model/gltf-binary";
mime.Mappings[".gltf"] = "model/gltf+json";
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = mime });
app.UseAuthentication();
app.UseAuthorization();

// Studierende: Hub ohne Anmeldung (die Leinwand weist sich über den geheimen Host-Schlüssel aus)
app.MapHub<GameHub>("/hub");
// Für nginx/deploy: Lebenszeichen
app.MapGet("/gesund", () => Results.Text($"ok {typeof(Program).Assembly.GetName().Version}"));

var api = app.MapGroup("/api");
api.MapAuth();
api.MapInvites();
api.MapMusic(MusicApi.Dir(app.Configuration, dbPath));

// ---------------------------------------------------------------- öffentlich (Leinwand/Handy)
api.MapGet("/qr", (string data) =>
{
    if (string.IsNullOrEmpty(data) || data.Length > 400) return Results.BadRequest();
    using var gen = new QRCodeGenerator();
    using var qr = gen.CreateQrCode(data, QRCodeGenerator.ECCLevel.M);
    var svg = new SvgQRCode(qr).GetGraphic(10, "#1b1340", "#ffffff", drawQuietZones: true);
    return Results.Content(svg, "image/svg+xml");
});

// ---------------------------------------------------------------- Dozentenbereich (Anmeldung nötig, nur eigene Daten)
var my = api.MapGroup("").RequireAuthorization();

IQueryable<Quiz> Own(AppDb db, ClaimsPrincipal u) { var id = u.UserId(); return db.Quizzes.Where(q => q.OwnerId == id); }
// Ordner-ID nur übernehmen, wenn der Ordner dem Konto gehört
async Task<int?> OwnFolder(AppDb db, ClaimsPrincipal u, int? folderId)
{
    if (folderId is not > 0) return null;
    var uid = u.UserId();
    return await db.QuizFolders.AnyAsync(f => f.Id == folderId && f.OwnerId == uid) ? folderId : null;
}
IQueryable<Quiz> OwnFull(AppDb db, ClaimsPrincipal u) => Own(db, u).Include(x => x.Questions).ThenInclude(x => x.Options);

my.MapGet("/quizzes", async (AppDb db, ClaimsPrincipal u) =>
    await Own(db, u).OrderByDescending(q => q.UpdatedUtc)
        .Select(q => new { q.Id, q.Title, q.Description, q.FolderId, q.UpdatedUtc, QuestionCount = q.Questions.Count })
        .ToListAsync());

my.MapGet("/quizzes/{id:int}", async (int id, AppDb db, ClaimsPrincipal u) =>
{
    var q = await OwnFull(db, u).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
    return q == null ? Results.NotFound() : Results.Ok(QuizDto.From(q));
});

my.MapPost("/quizzes", async (QuizDto dto, AppDb db, ClaimsPrincipal u) =>
{
    if (dto.Validate() is { } err) return Results.BadRequest(new { error = err });
    var q = new Quiz { OwnerId = u.UserId(), FolderId = await OwnFolder(db, u, dto.FolderId) };
    dto.ApplyTo(q);
    db.Quizzes.Add(q);
    await db.SaveChangesAsync();
    return Results.Ok(new { q.Id });
});

my.MapPut("/quizzes/{id:int}", async (int id, QuizDto dto, AppDb db, ClaimsPrincipal u) =>
{
    if (dto.Validate() is { } err) return Results.BadRequest(new { error = err });
    var q = await OwnFull(db, u).FirstOrDefaultAsync(x => x.Id == id);
    if (q == null) return Results.NotFound();
    db.Questions.RemoveRange(q.Questions);
    q.Questions.Clear();
    dto.ApplyTo(q);
    q.UpdatedUtc = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { q.Id });
});

my.MapPost("/quizzes/{id:int}/copy", async (int id, AppDb db, ClaimsPrincipal u) =>
{
    var q = await OwnFull(db, u).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
    if (q == null) return Results.NotFound();
    var copy = new Quiz { OwnerId = u.UserId(), FolderId = q.FolderId };
    (QuizDto.From(q) with { Title = q.Title + " (Kopie)" }).ApplyTo(copy);
    db.Quizzes.Add(copy);
    await db.SaveChangesAsync();
    return Results.Ok(new { copy.Id });
});

my.MapDelete("/quizzes/{id:int}", async (int id, AppDb db, ClaimsPrincipal u) =>
{
    await Own(db, u).Where(q => q.Id == id).ExecuteDeleteAsync();
    return Results.NoContent();
});

my.MapGet("/quizzes/{id:int}/export", async (int id, AppDb db, ClaimsPrincipal u) =>
{
    var q = await OwnFull(db, u).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
    if (q == null) return Results.NotFound();
    var json = System.Text.Json.JsonSerializer.Serialize(QuizDto.From(q) with { Id = 0, FolderId = null },
        new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { WriteIndented = true });
    var name = string.Concat(q.Title.Select(c => char.IsLetterOrDigit(c) ? c : '_'));
    return Results.File(System.Text.Encoding.UTF8.GetBytes(json), "application/json", $"podium-{name}.json");
});

// ---------------------------------------------------------------- Ordner (z. B. je Kurs)
my.MapGet("/folders", async (AppDb db, ClaimsPrincipal u) =>
{
    var id = u.UserId();
    return await db.QuizFolders.Where(f => f.OwnerId == id).OrderBy(f => f.Name).Select(f => new { f.Id, f.Name }).ToListAsync();
});

my.MapPost("/folders", async (FolderRequest req, AppDb db, ClaimsPrincipal u) =>
{
    var name = req.Name?.Trim() ?? "";
    if (name.Length is 0 or > 80) return Results.BadRequest(new { error = "Ordnername: 1 bis 80 Zeichen." });
    var f = new QuizFolder { OwnerId = u.UserId(), Name = name };
    db.QuizFolders.Add(f);
    await db.SaveChangesAsync();
    return Results.Ok(new { f.Id, f.Name });
});

my.MapPut("/folders/{id:int}", async (int id, FolderRequest req, AppDb db, ClaimsPrincipal u) =>
{
    var name = req.Name?.Trim() ?? "";
    if (name.Length is 0 or > 80) return Results.BadRequest(new { error = "Ordnername: 1 bis 80 Zeichen." });
    var uid = u.UserId();
    var f = await db.QuizFolders.FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == uid);
    if (f == null) return Results.NotFound();
    f.Name = name;
    await db.SaveChangesAsync();
    return Results.Ok(new { f.Id, f.Name });
});

// Ordner löschen: enthaltene Quizze bleiben erhalten (ohne Ordner)
my.MapDelete("/folders/{id:int}", async (int id, AppDb db, ClaimsPrincipal u) =>
{
    var uid = u.UserId();
    if (!await db.QuizFolders.AnyAsync(f => f.Id == id && f.OwnerId == uid)) return Results.NotFound();
    await Own(db, u).Where(q => q.FolderId == id).ExecuteUpdateAsync(s => s.SetProperty(q => q.FolderId, (int?)null));
    await db.QuizFolders.Where(f => f.Id == id).ExecuteDeleteAsync();
    return Results.NoContent();
});

my.MapPut("/quizzes/{id:int}/folder", async (int id, MoveRequest req, AppDb db, ClaimsPrincipal u) =>
{
    var folder = await OwnFolder(db, u, req.FolderId);
    if (req.FolderId is > 0 && folder == null) return Results.NotFound();
    var n = await Own(db, u).Where(q => q.Id == id).ExecuteUpdateAsync(s => s.SetProperty(q => q.FolderId, folder));
    return n == 0 ? Results.NotFound() : Results.NoContent();
});

// ---------------------------------------------------------------- Import (Kahoot-Link, Kahoot-JSON, Kahoot-Tabellenvorlage, CSV, Podium-JSON)
async Task<IResult> SaveImport(QuizImport.Result r, AppDb db, ClaimsPrincipal u, int? folder)
{
    if (r.Quiz == null) return Results.BadRequest(new { error = r.Error ?? "Import fehlgeschlagen", warnings = r.Warnings });
    if (r.Quiz.Validate() is { } err) return Results.BadRequest(new { error = err, warnings = r.Warnings });
    var quiz = new Quiz { OwnerId = u.UserId(), FolderId = await OwnFolder(db, u, folder) };
    r.Quiz.ApplyTo(quiz);
    db.Quizzes.Add(quiz);
    await db.SaveChangesAsync();
    return Results.Ok(new { quiz.Id, quiz.Title, Count = quiz.Questions.Count, r.Warnings });
}

my.MapPost("/import/kahoot", async (ImportUrlRequest req, int? folder, IHttpClientFactory http, AppDb db, ClaimsPrincipal u) =>
    await SaveImport(await QuizImport.FromKahootUrlAsync(req.Url, http.CreateClient("import")), db, u, folder));

my.MapPost("/import/file", async (IFormFile file, int? folder, AppDb db, ClaimsPrincipal u) =>
{
    if (file.Length > 10_000_000) return Results.BadRequest(new { error = "Datei zu groß (max. 10 MB)." });
    var name = Path.GetFileNameWithoutExtension(file.FileName);
    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    QuizImport.Result r;
    try
    {
        await using var s = file.OpenReadStream();
        switch (ext)
        {
            case ".json":
                r = QuizImport.FromJson(await new StreamReader(s).ReadToEndAsync(), name); break;
            case ".xlsx":
                var ms = new MemoryStream(); await s.CopyToAsync(ms); ms.Position = 0;
                r = QuizImport.FromRows(QuizImport.ReadXlsx(ms), name); break;
            case ".csv": case ".txt": case ".tsv":
                r = QuizImport.FromRows(QuizImport.ReadCsv(await new StreamReader(s).ReadToEndAsync()), name); break;
            default:
                return Results.BadRequest(new { error = "Unterstützt werden .xlsx (Kahoot-Vorlage), .csv und .json." });
        }
    }
    catch (Exception ex) when (ex is InvalidDataException or System.Xml.XmlException or NullReferenceException or InvalidOperationException)
    {
        return Results.BadRequest(new { error = "Die Datei konnte nicht gelesen werden: " + ex.Message });
    }
    return await SaveImport(r, db, u, folder);
}).DisableAntiforgery(); // Cookie ist SameSite=Strict

my.MapGet("/directpolls", async (AppDb db, ClaimsPrincipal u) =>
{
    var id = u.UserId();
    return await db.DirectPolls.Where(p => p.OwnerId == id).OrderByDescending(p => p.CreatedUtc).Take(50)
        .Select(p => new { p.Id, p.RoomTitle, p.Text, p.Kind, p.AnswerCount, p.CreatedUtc, p.OptionsJson, p.ResultsJson })
        .ToListAsync();
});

my.MapGet("/sessions", async (AppDb db, ClaimsPrincipal u) =>
{
    var id = u.UserId();
    return await db.GameSessions.Where(s => s.OwnerId == id).OrderByDescending(s => s.StartedUtc).Take(50)
        .Select(s => new { s.Id, s.QuizTitle, s.StartedUtc, s.FinishedUtc, PlayerCount = s.Players.Count,
            Winner = s.Players.OrderBy(p => p.Rank).Select(p => p.Nickname).FirstOrDefault() })
        .ToListAsync();
});

// ---------------------------------------------------------------- Spiel starten
my.MapPost("/games", async (CreateGameRequest req, GameManager games, HttpContext ctx, IConfiguration cfg, ClaimsPrincipal u) =>
{
    try
    {
        var g = await games.CreateAsync(req.QuizId, Program.PublicBase(ctx, cfg), u.UserId());
        return Results.Ok(new { g.Pin, g.HostKey });
    }
    catch (InvalidOperationException ex) { return Results.BadRequest(new { error = ex.Message }); }
});

app.Run();

record CreateGameRequest(int QuizId);
record ImportUrlRequest(string Url);
record FolderRequest(string? Name);
record MoveRequest(int? FolderId);

record OptionDto(string Text, bool IsCorrect);
record QuestionDto(string Text, int TimeLimitSeconds, int PointsMultiplier, List<OptionDto> Options);
record QuizDto(int Id, string Title, string? Description, List<QuestionDto> Questions)
{
    /// <summary>nur beim Laden und Neuanlegen ausgewertet; Speichern ändert den Ordner nicht</summary>
    public int? FolderId { get; init; }

    public static QuizDto From(Quiz q) => new(q.Id, q.Title, q.Description,
        q.Questions.OrderBy(x => x.Order).Select(x => new QuestionDto(x.Text, x.TimeLimitSeconds, x.PointsMultiplier,
            x.Options.OrderBy(o => o.Order).Select(o => new OptionDto(o.Text, o.IsCorrect)).ToList())).ToList()) { FolderId = q.FolderId };

    public string? Validate()
    {
        if (string.IsNullOrWhiteSpace(Title)) return "Bitte einen Titel angeben.";
        if (Questions is null || Questions.Count == 0) return "Mindestens eine Frage ist nötig.";
        for (int i = 0; i < Questions.Count; i++)
        {
            var q = Questions[i];
            var n = i + 1;
            if (string.IsNullOrWhiteSpace(q.Text)) return $"Frage {n}: Fragetext fehlt.";
            if (q.Options is null || q.Options.Count is < 2 or > 6) return $"Frage {n}: 2 bis 6 Antwortmöglichkeiten nötig.";
            if (q.Options.Any(o => string.IsNullOrWhiteSpace(o.Text))) return $"Frage {n}: leere Antwortmöglichkeit.";
            if (!q.Options.Any(o => o.IsCorrect)) return $"Frage {n}: mindestens eine Antwort muss richtig sein.";
            if (q.TimeLimitSeconds is < 5 or > 240) return $"Frage {n}: Zeit muss zwischen 5 und 240 Sekunden liegen.";
        }
        return null;
    }

    public void ApplyTo(Quiz q)
    {
        q.Title = Title.Trim();
        q.Description = Description?.Trim() ?? "";
        q.Questions = Questions.Select((x, i) => new Question
        {
            Order = i,
            Text = x.Text.Trim(),
            TimeLimitSeconds = x.TimeLimitSeconds,
            PointsMultiplier = Math.Clamp(x.PointsMultiplier, 0, 2),
            Options = x.Options.Select((o, j) => new AnswerOption { Order = j, Text = o.Text.Trim(), IsCorrect = o.IsCorrect }).ToList()
        }).ToList();
    }
}

public partial class Program
{
    // Basis-URL für QR-Code und Einladungslinks: konfigurierbar (PublicBaseUrl), sonst aus der Anfrage – lokal mit LAN-IP
    // statt "localhost", damit Handys im selben Netz beitreten können.
    public static string PublicBase(HttpContext ctx, IConfiguration cfg)
    {
        var configured = cfg["PublicBaseUrl"];
        if (!string.IsNullOrWhiteSpace(configured)) return configured.TrimEnd('/');
        var host = ctx.Request.Host.Host;
        var port = ctx.Request.Host.Port;
        if (host is "localhost" or "127.0.0.1" or "[::1]" or "::1")
            host = LanAddress() ?? host;
        return $"{ctx.Request.Scheme}://{host}{(port is null ? "" : ":" + port)}{ctx.Request.PathBase}";
    }

    static string? LanAddress()
    {
        var candidates = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .Where(n => !n.Description.Contains("Virtual", StringComparison.OrdinalIgnoreCase)
                     && !n.Description.Contains("Hyper-V", StringComparison.OrdinalIgnoreCase)
                     && !n.Description.Contains("VPN", StringComparison.OrdinalIgnoreCase))
            .Select(n => (n, props: n.GetIPProperties()))
            .OrderByDescending(x => x.props.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork));
        foreach (var (_, props) in candidates)
            foreach (var a in props.UnicastAddresses)
                if (a.Address.AddressFamily == AddressFamily.InterNetwork && !a.Address.ToString().StartsWith("169.254"))
                    return a.Address.ToString();
        return null;
    }
}

