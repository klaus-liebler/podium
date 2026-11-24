using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Podium.Data;

namespace Podium.Auth;

/// <summary>Anmeldung der Dozierenden (Cookie), eigenes Konto, Benutzerverwaltung für Admins.</summary>
public static class AuthApi
{
    public const string AdminPolicy = "admin";

    public static int UserId(this ClaimsPrincipal u) => int.Parse(u.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public static void AddPodiumAuth(this IServiceCollection services, IConfiguration cfg, string keysDir)
    {
        var auth = services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme);
        auth
            .AddCookie(o =>
            {
                o.Cookie.Name = "podium.anmeldung";
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Strict;       // schützt die JSON-API gegen CSRF
                o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                o.ExpireTimeSpan = TimeSpan.FromHours(12);
                o.SlidingExpiration = true;
                // API: 401/403 statt Weiterleitung auf eine Login-Seite
                o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
                o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
                // Deaktivierte/gelöschte Konten verlieren ihre Sitzung beim nächsten Aufruf
                o.Events.OnValidatePrincipal = async ctx =>
                {
                    var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                    var stamp = ctx.Principal?.FindFirstValue("stamp");
                    var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDb>();
                    var user = int.TryParse(id, out var uid) ? await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid) : null;
                    if (user is not { Active: true } || Stamp(user) != stamp) { ctx.RejectPrincipal(); await ctx.HttpContext.SignOutAsync(); }
                };
            });
        auth.AddPodiumSaml(cfg, keysDir);   // Hochschul-Login, nur wenn konfiguriert
        services.AddAuthorizationBuilder().AddPolicy(AdminPolicy, p => p.RequireClaim("admin", "true"));
    }

    /// <summary>Ändert sich bei Passwortwechsel/Rechteänderung -> alte Sitzungen werden ungültig</summary>
    static string Stamp(User u) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(u.PasswordHash + u.IsAdmin)))[..16];

    // ---------------------------------------------------------------- Ersteinrichtung
    // Wie bei evcc: Solange die Datenbank KEIN Konto enthält, darf das erste Admin-Konto einmalig über die
    // Oberfläche angelegt werden. Kein Passwort in Konfiguration, Umgebung oder Log.
    static readonly SemaphoreSlim SetupLock = new(1, 1);

    public static void LogSetupState(AppDb db, ILogger log)
    {
        if (!db.Users.Any())
            log.LogWarning("Noch kein Konto vorhanden – das erste Admin-Konto bitte JETZT über die Anmeldeseite anlegen (Ersteinrichtung).");
        else AssignOrphans(db, log);
    }

    /// <summary>Bestand ohne Besitzer (aus der Zeit vor der Anmeldung) dem ersten Admin zuordnen</summary>
    static void AssignOrphans(AppDb db, ILogger log)
    {
        var admin = db.Users.Where(u => u.IsAdmin).OrderBy(u => u.Id).FirstOrDefault();
        if (admin == null) return;
        var n = db.Quizzes.Where(q => q.OwnerId == null).ExecuteUpdate(s => s.SetProperty(q => q.OwnerId, admin.Id))
              + db.GameSessions.Where(q => q.OwnerId == null).ExecuteUpdate(s => s.SetProperty(q => q.OwnerId, admin.Id))
              + db.DirectPolls.Where(q => q.OwnerId == null).ExecuteUpdate(s => s.SetProperty(q => q.OwnerId, admin.Id));
        if (n > 0) log.LogInformation("{Count} Einträge ohne Besitzer dem Konto \"{User}\" zugeordnet.", n, admin.UserName);
    }

    // ---------------------------------------------------------------- Schutz gegen Passwort-Raten
    static readonly ConcurrentDictionary<string, (int fails, DateTime until)> Throttle = new();
    static string Key(HttpContext ctx, string user) => $"{ctx.Connection.RemoteIpAddress}|{user}";

    public static void MapAuth(this RouteGroupBuilder api)
    {
        api.MapPost("/auth/login", async (LoginRequest req, AppDb db, HttpContext ctx) =>
        {
            var name = (req.UserName ?? "").Trim().ToLowerInvariant();
            var key = Key(ctx, name);
            if (Throttle.TryGetValue(key, out var t) && t.until > DateTime.UtcNow)
                return Results.Json(new { error = $"Zu viele Fehlversuche. Bitte in {Math.Ceiling((t.until - DateTime.UtcNow).TotalSeconds)} s erneut versuchen." }, statusCode: 429);
            var user = await db.Users.FirstOrDefaultAsync(u => u.UserName == name);
            // Auch bei unbekanntem Namen einmal hashen, damit die Antwortzeit nichts verrät
            var ok = user is { Active: true } ? Passwords.Verify(req.Password ?? "", user.PasswordHash) : Passwords.Verify(req.Password ?? "", Dummy) && false;
            if (!ok)
            {
                var fails = (Throttle.TryGetValue(key, out var f) ? f.fails : 0) + 1;
                Throttle[key] = (fails, fails >= 5 ? DateTime.UtcNow.AddSeconds(Math.Min(300, 15 * Math.Pow(2, fails - 5))) : DateTime.MinValue);
                return Results.Json(new { error = "Benutzername oder Passwort ist falsch." }, statusCode: 401);
            }
            Throttle.TryRemove(key, out _);
            user!.LastLoginUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();
            await SignIn(ctx, user);
            return Results.Ok(Me(user));
        });

        api.MapGet("/auth/setup", async (AppDb db) => Results.Ok(new { needed = !await db.Users.AnyAsync() }));

        api.MapPost("/auth/setup", async (InviteAccept req, AppDb db, HttpContext ctx, ILogger<AppDb> log) =>
        {
            await SetupLock.WaitAsync();
            try
            {
                if (await db.Users.AnyAsync())
                    return Results.Json(new { error = "Podium ist bereits eingerichtet – bitte anmelden." }, statusCode: 409);
                var name = (req.UserName ?? "").Trim().ToLowerInvariant();
                if (CheckUserName(name) is { } nerr) return Results.BadRequest(new { error = nerr });
                if (Passwords.Check(req.Password) is { } err) return Results.BadRequest(new { error = err });
                var user = new User { UserName = name, DisplayName = string.IsNullOrWhiteSpace(req.DisplayName) ? name : req.DisplayName.Trim(),
                    PasswordHash = Passwords.Hash(req.Password!), IsAdmin = true, LastLoginUtc = DateTime.UtcNow };
                db.Users.Add(user);
                await db.SaveChangesAsync();
                log.LogInformation("Ersteinrichtung: Admin-Konto \"{User}\" angelegt (von {Ip}).", name, ctx.Connection.RemoteIpAddress);
                AssignOrphans(db, log);
                Seed.EnsureDemo(db, user.Id);
                await SignIn(ctx, user);
                return Results.Ok(Me(user));
            }
            finally { SetupLock.Release(); }
        });

        api.MapPost("/auth/logout", async (HttpContext ctx) => { await ctx.SignOutAsync(); return Results.NoContent(); });

        api.MapGet("/auth/me", async (ClaimsPrincipal p, AppDb db) =>
        {
            var u = await db.Users.FindAsync(p.UserId());
            return u == null ? Results.Unauthorized() : Results.Ok(Me(u));
        }).RequireAuthorization();

        api.MapPost("/auth/password", async (PasswordChange req, ClaimsPrincipal p, AppDb db, HttpContext ctx) =>
        {
            var u = await db.Users.FindAsync(p.UserId());
            if (u == null) return Results.Unauthorized();
            if (!Passwords.Verify(req.Current ?? "", u.PasswordHash)) return Results.BadRequest(new { error = "Das bisherige Passwort stimmt nicht." });
            if (Passwords.Check(req.New) is { } err) return Results.BadRequest(new { error = err });
            u.PasswordHash = Passwords.Hash(req.New!);
            await db.SaveChangesAsync();
            await SignIn(ctx, u); // neue Sitzung mit neuem Stempel
            return Results.Ok(new { ok = true });
        }).RequireAuthorization();

        // ------------------------------------------------------------ Benutzerverwaltung (nur Admins)
        var admin = api.MapGroup("/users").RequireAuthorization(AdminPolicy);
        admin.MapGet("", async (AppDb db) => await db.Users.OrderBy(u => u.UserName)
            .Select(u => new { u.Id, u.UserName, u.DisplayName, u.IsAdmin, u.Active, u.CreatedUtc, u.LastLoginUtc, Sso = u.SsoId != null, u.Email, Quizzes = db.Quizzes.Count(q => q.OwnerId == u.Id) })
            .ToListAsync());

        admin.MapPut("/{id:int}", async (int id, UserEdit req, AppDb db, ClaimsPrincipal p) =>
        {
            var u = await db.Users.FindAsync(id);
            if (u == null) return Results.NotFound();
            if (id == p.UserId() && (!req.IsAdmin || !req.Active)) return Results.BadRequest(new { error = "Das eigene Konto kann nicht deaktiviert oder herabgestuft werden." });
            if (!string.IsNullOrWhiteSpace(req.DisplayName)) u.DisplayName = req.DisplayName.Trim();
            u.IsAdmin = req.IsAdmin; u.Active = req.Active;
            await db.SaveChangesAsync();
            return Results.Ok(new { ok = true });
        });

        admin.MapPost("/{id:int}/reset", async (int id, AppDb db, ClaimsPrincipal p, HttpContext ctx, IConfiguration cfg) =>
        {
            var u = await db.Users.FindAsync(id);
            if (u == null) return Results.NotFound();
            var (token, inv) = NewInvite("reset", p.UserId(), TimeSpan.FromDays(3), $"Passwort für {u.UserName}");
            inv.UserId = u.Id;
            db.Invites.Add(inv);
            await db.SaveChangesAsync();
            return Results.Ok(new { link = Link(ctx, cfg, token), expiresUtc = inv.ExpiresUtc });
        });

        admin.MapDelete("/{id:int}", async (int id, AppDb db, ClaimsPrincipal p) =>
        {
            if (id == p.UserId()) return Results.BadRequest(new { error = "Das eigene Konto kann nicht gelöscht werden." });
            if (await db.Quizzes.AnyAsync(q => q.OwnerId == id)) return Results.BadRequest(new { error = "Das Konto besitzt noch Quizze – bitte stattdessen deaktivieren." });
            await db.Users.Where(u => u.Id == id).ExecuteDeleteAsync();
            return Results.NoContent();
        });
    }

    // ------------------------------------------------------------ Einladungen / Zurücksetzen per Einmal-Link
    static (string token, Invite inv) NewInvite(string kind, int createdBy, TimeSpan valid, string note)
    {
        var token = Base64Url(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        return (token, new Invite { TokenHash = HashToken(token), Kind = kind, CreatedById = createdBy, ExpiresUtc = DateTime.UtcNow + valid, Note = note });
    }
    static string HashToken(string token) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));
    static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    /// <summary>Token steht hinter "#" – Browser schicken ihn nie an den Server, er landet also in keinem Zugriffslog</summary>
    static string Link(HttpContext ctx, IConfiguration cfg, string token) => $"{Program.PublicBase(ctx, cfg)}/#/invite/{token}";

    static async Task<Invite?> FindValid(AppDb db, string token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 100) return null;
        var hash = HashToken(token);
        var inv = await db.Invites.FirstOrDefaultAsync(i => i.TokenHash == hash);
        return inv is { UsedUtc: null } && inv.ExpiresUtc > DateTime.UtcNow ? inv : null;
    }

    public static void MapInvites(this RouteGroupBuilder api)
    {
        var admin = api.MapGroup("/invites").RequireAuthorization(AdminPolicy);
        admin.MapGet("", async (AppDb db) =>
        {
            var now = DateTime.UtcNow;
            return await db.Invites.Where(i => i.Kind == "invite" && i.UsedUtc == null && i.ExpiresUtc > now).OrderByDescending(i => i.CreatedUtc)
                .Select(i => new { i.Id, i.Note, i.IsAdmin, i.CreatedUtc, i.ExpiresUtc }).ToListAsync();
        });
        admin.MapPost("", async (InviteRequest req, AppDb db, ClaimsPrincipal p, HttpContext ctx, IConfiguration cfg) =>
        {
            var days = Math.Clamp(req.Days ?? 7, 1, 30);
            var (token, inv) = NewInvite("invite", p.UserId(), TimeSpan.FromDays(days), (req.Note ?? "").Trim());
            inv.IsAdmin = req.IsAdmin;
            db.Invites.Add(inv);
            await db.SaveChangesAsync();
            return Results.Ok(new { inv.Id, link = Link(ctx, cfg, token), expiresUtc = inv.ExpiresUtc });
        });
        admin.MapDelete("/{id:int}", async (int id, AppDb db) => { await db.Invites.Where(i => i.Id == id).ExecuteDeleteAsync(); return Results.NoContent(); });

        // öffentlich: Link prüfen und einlösen
        api.MapGet("/invite/{token}", async (string token, AppDb db) =>
        {
            var inv = await FindValid(db, token);
            if (inv == null) return Results.Json(new { error = "Der Link ist ungültig, abgelaufen oder wurde schon verwendet." }, statusCode: 404);
            var user = inv.UserId is { } uid ? await db.Users.FindAsync(uid) : null;
            return Results.Ok(new { inv.Kind, inv.Note, inv.ExpiresUtc, userName = user?.UserName, displayName = user?.DisplayName });
        });
        api.MapPost("/invite/{token}", async (string token, InviteAccept req, AppDb db, HttpContext ctx) =>
        {
            var inv = await FindValid(db, token);
            if (inv == null) return Results.Json(new { error = "Der Link ist ungültig, abgelaufen oder wurde schon verwendet." }, statusCode: 404);
            if (Passwords.Check(req.Password) is { } err) return Results.BadRequest(new { error = err });
            User user;
            if (inv.Kind == "reset")
            {
                user = await db.Users.FindAsync(inv.UserId!.Value) ?? throw new InvalidOperationException();
                user.PasswordHash = Passwords.Hash(req.Password!);
            }
            else
            {
                var name = (req.UserName ?? "").Trim().ToLowerInvariant();
                if (CheckUserName(name) is { } nerr) return Results.BadRequest(new { error = nerr });
                if (await db.Users.AnyAsync(u => u.UserName == name)) return Results.BadRequest(new { error = "Diesen Benutzernamen gibt es schon." });
                user = new User { UserName = name, DisplayName = string.IsNullOrWhiteSpace(req.DisplayName) ? name : req.DisplayName.Trim(), PasswordHash = Passwords.Hash(req.Password!), IsAdmin = inv.IsAdmin };
                db.Users.Add(user);
            }
            user.LastLoginUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();
            inv.UsedUtc = DateTime.UtcNow; inv.UsedById = user.Id;
            await db.SaveChangesAsync();
            if (inv.Kind == "invite") Seed.EnsureDemo(db, user.Id);
            await SignIn(ctx, user);
            return Results.Ok(Me(user));
        });
    }

    static string? CheckUserName(string name) => System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9._-]{2,40}$") ? null
        : "Benutzername: 2–40 Zeichen, nur a–z, 0–9, Punkt, Bindestrich, Unterstrich.";

    static readonly string Dummy =Passwords.Hash(Guid.NewGuid().ToString());

    static object Me(User u) => new { u.Id, u.UserName, u.DisplayName, u.IsAdmin, sso = u.SsoId != null, hasPassword = u.PasswordHash.Length > 0 };

    internal static Task SignIn(HttpContext ctx, User u)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, u.Id.ToString()),
            new(ClaimTypes.Name, u.UserName),
            new("admin", u.IsAdmin ? "true" : "false"),
            new("stamp", Stamp(u)),
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
        return ctx.SignInAsync(principal, new AuthenticationProperties { IsPersistent = true });
    }
}

public record LoginRequest(string? UserName, string? Password);
public record PasswordChange(string? Current, string? New);
public record UserEdit(string? UserName, string? DisplayName, string? Password, bool IsAdmin, bool Active = true);
public record InviteRequest(string? Note, bool IsAdmin, int? Days);
public record InviteAccept(string? UserName, string? DisplayName, string? Password);
