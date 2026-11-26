using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Podium.Data;

namespace Podium.Auth;

/// <summary>
/// Anmeldung der Dozierenden über ASP.NET Core Identity (Cookie „podium.anmeldung“ wie bisher), eigenes Konto mit zweitem Faktor und
/// Passkeys, Benutzerverwaltung für Admins. Verfahren je Instanz: siehe <see cref="Anmeldeangebot"/>.
/// </summary>
public static class AuthApi
{
    public const string AdminPolicy = "admin";
    public const string OidcScheme = "oidc";

    public static int UserId(this ClaimsPrincipal u) => int.Parse(u.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public static void AddPodiumAuth(this IServiceCollection services, IConfiguration cfg, string keysDir)
    {
        services.AddPodiumIdentity(cfg);
        var angebot = new Anmeldeangebot(cfg);
        var auth = services.AddAuthentication(o =>
        {
            o.DefaultScheme = IdentityConstants.ApplicationScheme;
            o.DefaultSignInScheme = IdentityConstants.ExternalScheme;
        });
        auth.AddIdentityCookies(c =>
        {
            c.ApplicationCookie!.Configure(o =>
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
                // Deaktivierte/gelöschte Konten, neues Passwort, geänderte Admin-Rechte oder zweiter Faktor: Sitzung endet beim nächsten Aufruf
                o.Events.OnValidatePrincipal = async ctx =>
                {
                    var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                    var stamp = ctx.Principal?.FindFirstValue(new ClaimsIdentityOptions().SecurityStampClaimType);
                    var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDb>();
                    var aktuell = int.TryParse(id, out var uid)
                        ? await db.Users.AsNoTracking().Where(u => u.Id == uid && u.Active).Select(u => u.SecurityStamp).FirstOrDefaultAsync()
                        : null;
                    if (aktuell == null || aktuell != stamp) { ctx.RejectPrincipal(); await ctx.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme); }
                };
            });
            c.ExternalCookie!.Configure(o => { o.Cookie.Name = "podium.extern"; o.Cookie.SameSite = SameSiteMode.Lax; o.ExpireTimeSpan = TimeSpan.FromMinutes(5); });
            c.TwoFactorUserIdCookie!.Configure(o => { o.Cookie.Name = "podium.zweiterfaktor"; o.Cookie.SameSite = SameSiteMode.Lax; o.ExpireTimeSpan = TimeSpan.FromMinutes(5); });
        });
        if (angebot.Hat(Verfahren.Saml)) auth.AddPodiumSaml(cfg, keysDir);   // Hochschul-Login, unverändert (beim IdP registriert)
        if (angebot.Hat(Verfahren.Oidc))
            auth.AddOpenIdConnect(OidcScheme, o =>
            {
                o.SignInScheme = IdentityConstants.ExternalScheme;
                o.Authority = cfg["Oidc:Authority"];
                o.ClientId = cfg["Oidc:ClientId"];
                o.ClientSecret = cfg["Oidc:ClientSecret"] is { Length: > 0 } s ? s : null;   // nur per Umgebung
                o.ResponseType = "code";
                o.UsePkce = true;
                o.CallbackPath = "/signin-oidc";
                o.MapInboundClaims = false;
                o.SaveTokens = false;
                o.RequireHttpsMetadata = cfg.GetValue("Oidc:HttpsMetadata", true);
                o.Scope.Clear();
                foreach (var sc in "openid profile email".Split(' ')) o.Scope.Add(sc);
                o.Events.OnTicketReceived = ctx =>
                {
                    // Zwischen-Cookie klein halten
                    var keep = new HashSet<string> { "sub", "amr", "acr", "name", "given_name", "family_name", "email" };
                    if (ctx.Principal?.Identity is ClaimsIdentity q)
                    {
                        var slim = new ClaimsIdentity(q.AuthenticationType);
                        slim.AddClaims(q.Claims.Where(x => keep.Contains(x.Type)).Select(x => new Claim(x.Type, x.Value)));
                        ctx.Principal = new ClaimsPrincipal(slim);
                    }
                    return Task.CompletedTask;
                };
                o.Events.OnRemoteFailure = ctx =>
                {
                    ctx.Response.Redirect($"{ctx.Request.PathBase}/#/login?ssoerror={Uri.EscapeDataString("Die Anmeldung über den Identitätsdienst ist fehlgeschlagen oder wurde abgebrochen.")}");
                    ctx.HandleResponse();
                    return Task.CompletedTask;
                };
            });
        services.AddAuthorizationBuilder().AddPolicy(AdminPolicy, p => p.RequireClaim(PodiumIdentity.AdminClaim, "true"));
    }

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

    /// <summary>Antwort nach der ersten Stufe: angemeldet (Konto) oder zweiter Faktor nötig („code“ bzw. „setup“ = erst einrichten)</summary>
    static async Task<IResult> Antwort(Anmeldeabschluss.Ergebnis e, User u, UserManager<User> um) => e switch
    {
        Anmeldeabschluss.Ergebnis.Angemeldet => Results.Ok(await MeAsync(u, um)),
        Anmeldeabschluss.Ergebnis.ZweiterFaktor => Results.Ok(new { twoFactor = u.TwoFactorEnabled ? "code" : "setup" }),
        _ => Results.Json(new { error = "Dieses Konto ist deaktiviert oder nach zu vielen Fehlversuchen vorübergehend gesperrt." }, statusCode: 403),
    };

    public static void MapAuth(this RouteGroupBuilder api)
    {
        // Welche Kacheln zeigt die Anmeldeseite?
        api.MapGet("/auth/methods", (Anmeldeangebot a) => Results.Ok(new
        {
            saml = a.Hat(Verfahren.Saml) ? new { name = a.SamlName } : null,
            oidc = a.Hat(Verfahren.Oidc) ? new { name = a.OidcName } : null,
            password = a.Hat(Verfahren.Passwort),
            passkey = a.Hat(Verfahren.Passkey),
        }));

        api.MapPost("/auth/login", async (LoginRequest req, UserManager<User> um, Anmeldeabschluss abschluss, Anmeldeangebot angebot, HttpContext ctx) =>
        {
            if (!angebot.Hat(Verfahren.Passwort)) return Results.Json(new { error = "Die Anmeldung mit Passwort ist hier ausgeschaltet." }, statusCode: 403);
            var name = (req.UserName ?? "").Trim().ToLowerInvariant();
            var key = Key(ctx, name);
            if (Throttle.TryGetValue(key, out var t) && t.until > DateTime.UtcNow)
                return Results.Json(new { error = $"Zu viele Fehlversuche. Bitte in {Math.Ceiling((t.until - DateTime.UtcNow).TotalSeconds)} s erneut versuchen." }, statusCode: 429);
            var user = await um.FindByNameAsync(name);
            if (user is { Active: true } && user.PasswordHash.Length > 0 && await um.IsLockedOutAsync(user))
                return Results.Json(new { error = "Zu viele Fehlversuche – die Anmeldung ist vorübergehend gesperrt. Bitte später erneut versuchen." }, statusCode: 429);
            // Auch bei unbekanntem Namen einmal hashen, damit die Antwortzeit nichts verrät
            var ok = user is { Active: true } && user.PasswordHash.Length > 0 ? await um.CheckPasswordAsync(user, req.Password ?? "") : Passwords.Verify(req.Password ?? "", Dummy) && false;
            if (!ok)
            {
                var fails = (Throttle.TryGetValue(key, out var f) ? f.fails : 0) + 1;
                Throttle[key] = (fails, fails >= 5 ? DateTime.UtcNow.AddSeconds(Math.Min(300, 15 * Math.Pow(2, fails - 5))) : DateTime.MinValue);
                if (user is { Active: true } && user.PasswordHash.Length > 0)
                {
                    await um.AccessFailedAsync(user);   // Sperre nach Fehlversuchen (Identity)
                    if (await um.IsLockedOutAsync(user))
                        return Results.Json(new { error = "Zu viele Fehlversuche – die Anmeldung ist vorübergehend gesperrt. Bitte später erneut versuchen." }, statusCode: 429);
                }
                return Results.Json(new { error = "Benutzername oder Passwort ist falsch." }, statusCode: 401);
            }
            Throttle.TryRemove(key, out _);
            await um.ResetAccessFailedCountAsync(user!);
            return await Antwort(await abschluss.AbschliessenAsync(ctx, user!, "Passwort", false), user!, um);
        });

        // ------------------------------------------------------------ zweiter Faktor (TOTP)
        // Stand des Zwischen-Cookies nach der ersten Stufe: Code eingeben oder (Admins ohne Faktor) erst einrichten
        api.MapGet("/auth/2fa", async (SignInManager<User> sm) =>
            await sm.GetTwoFactorAuthenticationUserAsync() is { } u ? Results.Ok(new { twoFactor = u.TwoFactorEnabled ? "code" : "setup" })
                : Results.Json(new { error = "Die Anmeldung ist abgelaufen (nach fünf Minuten). Bitte erneut anmelden." }, statusCode: 401));

        api.MapPost("/auth/2fa", async (TwoFactorRequest req, SignInManager<User> sm, UserManager<User> um, HttpContext ctx, ILogger<AppDb> log) =>
        {
            if (await sm.GetTwoFactorAuthenticationUserAsync() is not { } u)
                return Results.Json(new { error = "Die Anmeldung ist abgelaufen (nach fünf Minuten). Bitte erneut anmelden." }, statusCode: 401);
            var r = !string.IsNullOrWhiteSpace(req.RecoveryCode)
                ? await sm.TwoFactorRecoveryCodeSignInAsync(req.RecoveryCode.Trim())
                : await sm.TwoFactorAuthenticatorSignInAsync(new string((req.Code ?? "").Where(char.IsAsciiDigit).ToArray()), isPersistent: true, rememberClient: false);
            if (r.IsLockedOut) return Results.Json(new { error = "Zu viele Fehlversuche – die Anmeldung ist vorübergehend gesperrt." }, statusCode: 429);
            if (!r.Succeeded) return Results.Json(new { error = "Der Code stimmt nicht. Bitte erneut versuchen." }, statusCode: 400);
            u.LastLoginUtc = DateTime.UtcNow;
            await um.UpdateAsync(u);
            log.LogInformation("Anmeldung mit zweitem Faktor: Konto {User}", u.UserName);
            return Results.Ok(await MeAsync(u, um));
        });

        // Einrichtung: in der Anmeldung (Zwischen-Cookie) oder im eigenen Konto
        api.MapGet("/auth/2fa/setup", async (SignInManager<User> sm, UserManager<User> um, Anmeldeabschluss abschluss, HttpContext ctx) =>
        {
            var (u, vorAnmeldung) = await ZweiterFaktorKontoAsync(ctx, sm, um);
            if (u == null) return Results.Unauthorized();
            var key = await um.GetAuthenticatorKeyAsync(u);
            if (string.IsNullOrEmpty(key))
            {
                await um.ResetAuthenticatorKeyAsync(u);   // erneuert den Stempel
                key = await um.GetAuthenticatorKeyAsync(u);
                if (vorAnmeldung) await abschluss.ZwischenCookieAsync(ctx, u, ctx.User.FindFirstValue(ClaimTypes.AuthenticationMethod) ?? "Passwort");
                else await sm.RefreshSignInAsync(u);
            }
            var uri = $"otpauth://totp/Podium:{Uri.EscapeDataString(u.UserName)}?secret={key}&issuer=Podium&digits=6";
            using var gen = new QRCoder.QRCodeGenerator();
            using var qr = gen.CreateQrCode(uri, QRCoder.QRCodeGenerator.ECCLevel.M);
            var svg = new QRCoder.SvgQRCode(qr).GetGraphic(5);
            var grouped = string.Join(' ', Enumerable.Range(0, (key!.Length + 3) / 4).Select(i => key.Substring(i * 4, Math.Min(4, key.Length - i * 4)))).ToLowerInvariant();
            return Results.Ok(new { key = grouped, qr = "data:image/svg+xml;base64," + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(svg)) });
        });

        api.MapPost("/auth/2fa/enable", async (TwoFactorRequest req, SignInManager<User> sm, UserManager<User> um, Anmeldeabschluss abschluss, HttpContext ctx) =>
        {
            var (u, vorAnmeldung) = await ZweiterFaktorKontoAsync(ctx, sm, um);
            if (u == null) return Results.Unauthorized();
            var code = new string((req.Code ?? "").Where(char.IsAsciiDigit).ToArray());
            if (code.Length == 0 || !await um.VerifyTwoFactorTokenAsync(u, um.Options.Tokens.AuthenticatorTokenProvider, code))
                return Results.BadRequest(new { error = "Der Code stimmt nicht. Bitte die Uhrzeit des Telefons prüfen und den aktuellen Code eingeben." });
            await um.SetTwoFactorEnabledAsync(u, true);
            var codes = (await um.GenerateNewTwoFactorRecoveryCodesAsync(u, 10))?.ToList() ?? [];
            if (vorAnmeldung)
            {
                var art = (await ctx.AuthenticateAsync(IdentityConstants.TwoFactorUserIdScheme)).Principal?.FindFirstValue(ClaimTypes.AuthenticationMethod) ?? "Passwort";
                await ctx.SignOutAsync(IdentityConstants.TwoFactorUserIdScheme);
                await abschluss.AnmeldenAsync(u, art, true);
            }
            else await sm.RefreshSignInAsync(u);
            return Results.Ok(new { recoveryCodes = codes, me = await MeAsync(u, um) });
        });

        api.MapPost("/auth/2fa/recovery-codes", async (ClaimsPrincipal p, SignInManager<User> sm, UserManager<User> um) =>
        {
            var u = await um.GetUserAsync(p);
            if (u is not { TwoFactorEnabled: true }) return Results.BadRequest(new { error = "Zuerst den zweiten Faktor einrichten." });
            var codes = (await um.GenerateNewTwoFactorRecoveryCodesAsync(u, 10))?.ToList() ?? [];
            await sm.RefreshSignInAsync(u);
            return Results.Ok(new { recoveryCodes = codes });
        }).RequireAuthorization();

        api.MapDelete("/auth/2fa", async (ClaimsPrincipal p, SignInManager<User> sm, UserManager<User> um) =>
        {
            var u = await um.GetUserAsync(p);
            if (u == null) return Results.Unauthorized();
            if (u.IsAdmin) return Results.BadRequest(new { error = "Für Administrator·innen ist der zweite Faktor Pflicht." });
            u.AuthenticatorKeyProtected = null; u.RecoveryCodes = null;
            await um.SetTwoFactorEnabledAsync(u, false);
            await sm.RefreshSignInAsync(u);
            return Results.Ok(await MeAsync(u, um));
        }).RequireAuthorization();

        // ------------------------------------------------------------ Passkeys
        api.MapPost("/auth/passkey/options", async (SignInManager<User> sm, Anmeldeangebot a) =>
            a.Hat(Verfahren.Passkey) ? Results.Content(await sm.MakePasskeyRequestOptionsAsync(null), "application/json") : Results.NotFound());

        api.MapPost("/auth/passkey/login", async (PasskeyRequest req, SignInManager<User> sm, UserManager<User> um, Anmeldeabschluss abschluss, Anmeldeangebot a, HttpContext ctx, ILogger<AppDb> log) =>
        {
            if (!a.Hat(Verfahren.Passkey) || string.IsNullOrEmpty(req.Credential)) return Results.NotFound();
            var r = await sm.PerformPasskeyAssertionAsync(req.Credential);
            if (!r.Succeeded || r.User is not { } u)
            {
                log.LogWarning("Anmeldung mit Passkey fehlgeschlagen: {Grund}", r.Failure?.Message);
                return Results.Json(new { error = "Dieser Passkey wurde nicht erkannt." }, statusCode: 401);
            }
            await um.AddOrUpdatePasskeyAsync(u, r.Passkey);   // Signaturzähler fortschreiben
            return await Antwort(await abschluss.AbschliessenAsync(ctx, u, "Passkey", r.Passkey.IsUserVerified), u, um);
        });

        api.MapPost("/auth/passkeys/options", async (ClaimsPrincipal p, SignInManager<User> sm, UserManager<User> um, Anmeldeangebot a) =>
        {
            if (!a.Hat(Verfahren.Passkey)) return Results.NotFound();
            var u = await um.GetUserAsync(p);
            if (u == null) return Results.Unauthorized();
            var json = await sm.MakePasskeyCreationOptionsAsync(new PasskeyUserEntity { Id = u.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), Name = u.UserName, DisplayName = u.DisplayName });
            return Results.Content(json, "application/json");
        }).RequireAuthorization();

        api.MapPost("/auth/passkeys", async (PasskeyRequest req, ClaimsPrincipal p, SignInManager<User> sm, UserManager<User> um, ILogger<AppDb> log) =>
        {
            var u = await um.GetUserAsync(p);
            if (u == null || string.IsNullOrEmpty(req.Credential)) return Results.BadRequest();
            var r = await sm.PerformPasskeyAttestationAsync(req.Credential);
            if (!r.Succeeded)
            {
                log.LogWarning("Passkey hinzufügen fehlgeschlagen: {Grund}", r.Failure?.Message);
                return Results.BadRequest(new { error = "Der Passkey ließ sich nicht prüfen. Bitte erneut versuchen." });
            }
            r.Passkey.Name = string.IsNullOrWhiteSpace(req.Name) ? "Passkey" : req.Name.Trim();
            await um.AddOrUpdatePasskeyAsync(u, r.Passkey);
            return Results.Ok(await MeAsync(u, um));
        }).RequireAuthorization();

        // Passkey entfernen; id = Credential-Id (Base64) wie in auth/me
        api.MapPost("/auth/passkeys/remove", async (PasskeyRequest req, ClaimsPrincipal p, AppDb db, SignInManager<User> sm, UserManager<User> um) =>
        {
            var u = await um.GetUserAsync(p);
            if (u == null) return Results.Unauthorized();
            byte[] cid;
            try { cid = Convert.FromBase64String(req.Credential ?? ""); } catch (FormatException) { return Results.BadRequest(); }
            var pk = await db.UserPasskeys.FirstOrDefaultAsync(x => x.UserId == u.Id && x.CredentialId == cid);
            if (pk == null) return Results.NotFound();
            var id = pk.Id;
            if (u.PasswordHash.Length == 0 && !await db.UserLogins.AnyAsync(x => x.UserId == u.Id) && !await db.UserPasskeys.AnyAsync(x => x.UserId == u.Id && x.Id != id))
                return Results.BadRequest(new { error = "Das ist die letzte Möglichkeit, sich anzumelden." });
            await um.RemovePasskeyAsync(u, pk.CredentialId);
            await sm.RefreshSignInAsync(u);
            return Results.Ok(await MeAsync(u, um));
        }).RequireAuthorization();

        // ------------------------------------------------------------ OIDC (optional)
        api.MapGet("/auth/oidc/login", (HttpContext ctx, bool? link, Anmeldeangebot a) =>
        {
            if (!a.Hat(Verfahren.Oidc)) return Results.NotFound();
            var props = new AuthenticationProperties { RedirectUri = ctx.Request.PathBase + "/api/auth/oidc/fertig" };
            if (link == true && ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) is { } uid) props.Items["podium.link"] = uid;
            return Results.Challenge(props, [OidcScheme]);
        });
        api.MapGet("/auth/oidc/fertig", async (HttpContext ctx, IConfiguration cfg, UserManager<User> um, SignInManager<User> sm, Anmeldeabschluss abschluss) =>
        {
            string Zurueck(string fehler) => $"{ctx.Request.PathBase}/#/login?ssoerror={Uri.EscapeDataString(fehler)}";
            var ext = await ctx.AuthenticateAsync(IdentityConstants.ExternalScheme);
            await ctx.SignOutAsync(IdentityConstants.ExternalScheme);
            if (ext.Principal is not { } p || Extern.AusOidc(p, (cfg["Oidc:MfaAcr"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) is not { } e)
                return Results.Redirect(Zurueck("Die Anmeldung über den Identitätsdienst ist fehlgeschlagen."));
            var user = await um.FindByLoginAsync("OIDC", e.Schluessel);
            if (user == null && ext.Properties?.Items.TryGetValue("podium.link", out var lid) == true && await um.FindByIdAsync(lid!) is { } eigen
                && ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) == lid)
            {
                await um.AddLoginAsync(eigen, new UserLoginInfo("OIDC", e.Schluessel, "Firmenkonto"));
                await sm.RefreshSignInAsync(eigen);
                return Results.Redirect(ctx.Request.PathBase + "/#/account");
            }
            if (user == null) return Results.Redirect(Zurueck("Mit diesem Konto ist noch kein Podium-Konto verknüpft. Bitte mit Passwort anmelden und unter „Mein Konto“ verknüpfen."));
            return Results.Redirect(ctx.Request.PathBase + (await abschluss.AbschliessenAsync(ctx, user, "OIDC", e.Mfa) switch
            {
                Anmeldeabschluss.Ergebnis.Angemeldet => "/#/",
                Anmeldeabschluss.Ergebnis.ZweiterFaktor => "/#/login?zweiterfaktor=1",
                _ => "/#/login?ssoerror=" + Uri.EscapeDataString("Dieses Konto ist deaktiviert oder vorübergehend gesperrt."),
            }));
        });

        api.MapGet("/auth/setup", async (AppDb db) => Results.Ok(new { needed = !await db.Users.AnyAsync() }));

        api.MapPost("/auth/setup", async (InviteAccept req, AppDb db, HttpContext ctx, ILogger<AppDb> log, UserManager<User> um, Anmeldeabschluss abschluss) =>
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
                // Admins brauchen einen zweiten Faktor: gleich anschließend einrichten
                return await Antwort(await abschluss.AbschliessenAsync(ctx, user, "Passwort", false), user, um);
            }
            finally { SetupLock.Release(); }
        });

        api.MapPost("/auth/logout", async (SignInManager<User> sm) => { await sm.SignOutAsync(); return Results.NoContent(); });

        api.MapGet("/auth/me", async (ClaimsPrincipal p, UserManager<User> um) =>
        {
            var u = await um.GetUserAsync(p);
            return u == null ? Results.Unauthorized() : Results.Ok(await MeAsync(u, um));
        }).RequireAuthorization();

        api.MapPost("/auth/password", async (PasswordChange req, ClaimsPrincipal p, UserManager<User> um, SignInManager<User> sm) =>
        {
            var u = await um.GetUserAsync(p);
            if (u == null) return Results.Unauthorized();
            if (!Passwords.Verify(req.Current ?? "", u.PasswordHash)) return Results.BadRequest(new { error = "Das bisherige Passwort stimmt nicht." });
            if (Passwords.Check(req.New) is { } err) return Results.BadRequest(new { error = err });
            u.PasswordHash = Passwords.Hash(req.New!);
            await um.UpdateSecurityStampAsync(u);   // andere Sitzungen enden
            await sm.RefreshSignInAsync(u);         // diese bleibt (neuer Stempel)
            return Results.Ok(new { ok = true });
        }).RequireAuthorization();

        // ------------------------------------------------------------ Benutzerverwaltung (nur Admins)
        var admin = api.MapGroup("/users").RequireAuthorization(AdminPolicy);
        admin.MapGet("", async (AppDb db) => await db.Users.OrderBy(u => u.UserName)
            .Select(u => new { u.Id, u.UserName, u.DisplayName, u.IsAdmin, u.Active, u.CreatedUtc, u.LastLoginUtc, Sso = u.SsoId != null, u.Email,
                u.TwoFactorEnabled, Passkeys = db.UserPasskeys.Count(x => x.UserId == u.Id), Quizzes = db.Quizzes.Count(q => q.OwnerId == u.Id) })
            .ToListAsync());

        admin.MapPut("/{id:int}", async (int id, UserEdit req, AppDb db, ClaimsPrincipal p, UserManager<User> um) =>
        {
            var u = await db.Users.FindAsync(id);
            if (u == null) return Results.NotFound();
            if (id == p.UserId() && (!req.IsAdmin || !req.Active)) return Results.BadRequest(new { error = "Das eigene Konto kann nicht deaktiviert oder herabgestuft werden." });
            if (!string.IsNullOrWhiteSpace(req.DisplayName)) u.DisplayName = req.DisplayName.Trim();
            var rechte = u.IsAdmin != req.IsAdmin || u.Active != req.Active;
            u.IsAdmin = req.IsAdmin; u.Active = req.Active;
            if (req.Active) { u.AccessFailedCount = 0; u.LockoutEndUtc = null; }   // „Aktivieren“ hebt auch die Sperre nach Fehlversuchen auf
            if (rechte) await um.UpdateSecurityStampAsync(u);   // Rechteänderung beendet Sitzungen
            else await db.SaveChangesAsync();
            return Results.Ok(new { ok = true });
        });

        // Zweiten Faktor zurücksetzen (Telefon verloren): Admins richten ihn bei der nächsten Anmeldung neu ein
        admin.MapPost("/{id:int}/reset-2fa", async (int id, ClaimsPrincipal p, UserManager<User> um, ILogger<AppDb> log) =>
        {
            if (id == p.UserId()) return Results.BadRequest(new { error = "Den eigenen zweiten Faktor ändern Sie unter „Mein Konto“." });
            if (await um.FindByIdAsync(id.ToString(System.Globalization.CultureInfo.InvariantCulture)) is not { } u) return Results.NotFound();
            u.AuthenticatorKeyProtected = null; u.RecoveryCodes = null;
            await um.SetTwoFactorEnabledAsync(u, false);   // erneuert den Stempel
            log.LogInformation("Zweiter Faktor von \"{User}\" zurückgesetzt.", u.UserName);
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
        api.MapPost("/invite/{token}", async (string token, InviteAccept req, AppDb db, HttpContext ctx, UserManager<User> um, Anmeldeabschluss abschluss) =>
        {
            var inv = await FindValid(db, token);
            if (inv == null) return Results.Json(new { error = "Der Link ist ungültig, abgelaufen oder wurde schon verwendet." }, statusCode: 404);
            if (Passwords.Check(req.Password) is { } err) return Results.BadRequest(new { error = err });
            User user;
            if (inv.Kind == "reset")
            {
                user = await db.Users.FindAsync(inv.UserId!.Value) ?? throw new InvalidOperationException();
                user.PasswordHash = Passwords.Hash(req.Password!);
                user.SecurityStamp = User.NewStamp();   // alte Sitzungen enden
                user.AccessFailedCount = 0; user.LockoutEndUtc = null;
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
            return await Antwort(await abschluss.AbschliessenAsync(ctx, user, "Passwort", false), user, um);
        });
    }

    static string? CheckUserName(string name) => System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9._-]{2,40}$") ? null
        : "Benutzername: 2–40 Zeichen, nur a–z, 0–9, Punkt, Bindestrich, Unterstrich.";

    static readonly string Dummy =Passwords.Hash(Guid.NewGuid().ToString());

    internal static async Task<object> MeAsync(User u, UserManager<User> um)
    {
        var logins = await um.GetLoginsAsync(u);
        var passkeys = await um.GetPasskeysAsync(u);
        return new
        {
            u.Id, u.UserName, u.DisplayName, u.IsAdmin, sso = u.SsoId != null, hasPassword = u.PasswordHash.Length > 0,
            twoFactor = u.TwoFactorEnabled, recoveryCodesLeft = await um.CountRecoveryCodesAsync(u),
            oidc = logins.Any(l => l.LoginProvider == "OIDC"),
            passkeys = passkeys.Select(x => new { id = Convert.ToBase64String(x.CredentialId), name = x.Name ?? "Passkey", createdUtc = x.CreatedAt.UtcDateTime, backedUp = x.IsBackedUp }),
        };
    }

    /// <summary>Konto für die TOTP-Einrichtung: angemeldet (eigenes Konto) oder nach der ersten Stufe (Zwischen-Cookie)</summary>
    static async Task<(User? u, bool vorAnmeldung)> ZweiterFaktorKontoAsync(HttpContext ctx, SignInManager<User> sm, UserManager<User> um)
    {
        if (await um.GetUserAsync(ctx.User) is { } eigen) return (eigen, false);
        var u = await sm.GetTwoFactorAuthenticationUserAsync();
        if (u != null)
        {
            // Art der ersten Stufe für die spätere Sitzung merken
            var z = await ctx.AuthenticateAsync(IdentityConstants.TwoFactorUserIdScheme);
            ctx.User = z.Principal ?? ctx.User;
        }
        return (u, u != null);
    }
}

public record TwoFactorRequest(string? Code, string? RecoveryCode);
public record PasskeyRequest(string? Credential, string? Name);

public record LoginRequest(string? UserName, string? Password);
public record PasswordChange(string? Current, string? New);
public record UserEdit(string? UserName, string? DisplayName, string? Password, bool IsAdmin, bool Active = true);
public record InviteRequest(string? Note, bool IsAdmin, int? Days);
public record InviteAccept(string? UserName, string? DisplayName, string? Password);
