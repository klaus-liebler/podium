using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Podium.Data;

namespace Podium.Auth;

/// <summary>Anmeldeverfahren, die eine Instanz freischalten kann (Kacheln auf der Anmeldeseite).</summary>
public enum Verfahren { Saml, Oidc, Passwort, Passkey }

/// <summary>
/// Welche Verfahren diese Instanz anbietet. Konfiguration „Anmeldung:Verfahren“ (kommagetrennt: Saml, Oidc, Passwort, Passkey);
/// ohne Angabe: Passwort und Passkey, dazu SAML, sobald Saml:IdpEntityId gesetzt ist (wie bisher), und OIDC, sobald Oidc:Authority und
/// Oidc:ClientId gesetzt sind. Nennt die Liste ein Verfahren ohne Konfiguration, startet Podium nicht.
/// </summary>
public sealed class Anmeldeangebot
{
    public IReadOnlySet<Verfahren> Aktiv { get; }
    public string SamlName { get; }
    public string OidcName { get; }
    /// <summary>Für Admins verlangt Podium bei SSO einen MFA-Nachweis des Identitätsdienstes, sonst den eigenen TOTP-Faktor</summary>
    public bool MfaBeiSso { get; }

    public Anmeldeangebot(IConfiguration cfg)
    {
        var saml = !string.IsNullOrWhiteSpace(cfg["Saml:IdpEntityId"]);
        var oidc = !string.IsNullOrWhiteSpace(cfg["Oidc:Authority"]) && !string.IsNullOrWhiteSpace(cfg["Oidc:ClientId"]);
        Aktiv = Auswerten(cfg["Anmeldung:Verfahren"], saml, oidc);
        SamlName = cfg["Saml:Anzeigename"] ?? "Hochschule Osnabrück";
        OidcName = cfg["Oidc:Anzeigename"] ?? "Firmenkonto";
        MfaBeiSso = cfg.GetValue("Anmeldung:MfaBeiSsoVerlangen", true);
    }

    public bool Hat(Verfahren v) => Aktiv.Contains(v);

    public static IReadOnlySet<Verfahren> Auswerten(string? liste, bool samlKonfiguriert, bool oidcKonfiguriert)
    {
        if (string.IsNullOrWhiteSpace(liste))
        {
            var v = new HashSet<Verfahren> { Verfahren.Passwort, Verfahren.Passkey };
            if (samlKonfiguriert) v.Add(Verfahren.Saml);
            if (oidcKonfiguriert) v.Add(Verfahren.Oidc);
            return v;
        }
        var e = new HashSet<Verfahren>();
        foreach (var t in liste.Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            e.Add(Enum.TryParse<Verfahren>(t, true, out var x) && Enum.IsDefined(x) ? x
                : throw new InvalidOperationException($"Anmeldung:Verfahren: unbekanntes Verfahren „{t}“ (erlaubt: Saml, Oidc, Passwort, Passkey)."));
        if (e.Contains(Verfahren.Saml) && !samlKonfiguriert) throw new InvalidOperationException("Anmeldung:Verfahren nennt Saml, aber Saml:IdpEntityId ist nicht gesetzt.");
        if (e.Contains(Verfahren.Oidc) && !oidcKonfiguriert) throw new InvalidOperationException("Anmeldung:Verfahren nennt Oidc, aber Oidc:Authority/Oidc:ClientId fehlen.");
        return e;
    }

    /// <summary>Muss nach der ersten Stufe noch der eigene zweite Faktor (TOTP) abgefragt bzw. eingerichtet werden? Pflicht für Admins.</summary>
    public static bool BrauchtZweitenFaktor(User u, string art, bool mfa, bool mfaBeiSso) => art switch
    {
        "Passwort" => u.IsAdmin || u.TwoFactorEnabled,
        "Passkey" => u.IsAdmin && !mfa,
        "SAML" or "OIDC" => u.IsAdmin && mfaBeiSso && !mfa,
        _ => true,
    };
}

/// <summary>Was ein Identitätsdienst geliefert hat, auf das Nötige reduziert.</summary>
public sealed record Extern(string Anbieter, string Schluessel, string? Name, string? Mail, IReadOnlyList<string> Zugehoerigkeiten, bool Mfa)
{
    public const string RefedsMfa = "https://refeds.org/profile/mfa";
    static readonly HashSet<string> MfaAmr = new(StringComparer.OrdinalIgnoreCase) { "mfa", "mca", "otp", "hwk" };

    /// <summary>OIDC: Kennung „sub“; zweiter Faktor über „amr“ oder einen konfigurierten „acr“-Wert</summary>
    public static Extern? AusOidc(ClaimsPrincipal p, IEnumerable<string> mfaAcr)
    {
        string? W(string t) => p.FindFirst(t)?.Value?.Trim() is { Length: > 0 } v ? v : null;
        if (W("sub") is not { } sub) return null;
        var acr = new HashSet<string>(mfaAcr, StringComparer.OrdinalIgnoreCase);
        var mfa = p.FindAll("amr").Any(c => MfaAmr.Contains(c.Value)) || (W("acr") is { } a && acr.Contains(a));
        return new Extern("OIDC", sub, W("name") ?? string.Join(" ", new[] { W("given_name"), W("family_name") }.Where(x => x != null)), W("email"), [], mfa);
    }
}

/// <summary>
/// ASP.NET Core Identity über das vorhandene <see cref="User"/>-Modell (eigener Speicher statt Identity-Tabellen): Passwort-Hashes im
/// bisherigen Podium-Format, Sperre nach Fehlversuchen, Sicherheitsstempel, TOTP mit Wiederherstellungscodes, Verknüpfungen (SAML, OIDC)
/// und Passkeys.
/// </summary>
public static class PodiumIdentity
{
    public const string AdminClaim = "admin";

    public static void AddPodiumIdentity(this IServiceCollection services, IConfiguration cfg)
    {
        services.AddScoped<IUserConfirmation<User>, AktivesKonto>();
        services.AddSingleton<IPasswordHasher<User>, PodiumPasswordHasher>();
        services.AddIdentityCore<User>(o =>
            {
                o.User.AllowedUserNameCharacters = "abcdefghijklmnopqrstuvwxyz0123456789._-";
                o.Password.RequiredLength = Passwords.MinLength;
                o.Password.RequireDigit = o.Password.RequireLowercase = o.Password.RequireUppercase = o.Password.RequireNonAlphanumeric = false;
                o.Lockout.AllowedForNewUsers = true;
                o.Lockout.MaxFailedAccessAttempts = Math.Max(1, cfg.GetValue("Anmeldung:SperreNachFehlversuchen", 5));
                o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(Math.Max(1, cfg.GetValue("Anmeldung:SperreMinuten", 15)));
                o.SignIn.RequireConfirmedAccount = true;   // „bestätigt“ = aktiv
                o.ClaimsIdentity.UserIdClaimType = ClaimTypes.NameIdentifier;
                o.ClaimsIdentity.UserNameClaimType = ClaimTypes.Name;
            })
            .AddUserStore<PodiumUserStore>()
            .AddClaimsPrincipalFactory<PodiumClaims>()
            .AddTokenProvider<AuthenticatorTokenProvider<User>>(TokenOptions.DefaultAuthenticatorProvider)
            .AddSignInManager();
        services.Configure<IdentityPasskeyOptions>(o =>
        {
            o.UserVerificationRequirement = "required";   // PIN/Biometrie am Gerät: Passkey gilt als zweiter Faktor
            o.ResidentKeyRequirement = "required";
            if (cfg["Anmeldung:PasskeyDomain"] is { Length: > 0 } d) o.ServerDomain = d;
        });
        services.AddSingleton(new Anmeldeangebot(cfg));
        services.AddScoped<Anmeldeabschluss>();
    }
}

/// <summary>Nur aktive Konten dürfen sich anmelden – mit jedem Verfahren.</summary>
sealed class AktivesKonto : IUserConfirmation<User>
{
    public Task<bool> IsConfirmedAsync(UserManager<User> manager, User user) => Task.FromResult(user?.Active == true);
}

/// <summary>Bisheriges Hash-Format (PBKDF2-SHA256, 600 000 Iterationen, siehe Passwords.cs) – vorhandene Passwörter gelten weiter.</summary>
sealed class PodiumPasswordHasher : IPasswordHasher<User>
{
    public string HashPassword(User user, string password) => Passwords.Hash(password);
    public PasswordVerificationResult VerifyHashedPassword(User user, string hashedPassword, string providedPassword)
        => !string.IsNullOrEmpty(hashedPassword) && Passwords.Verify(providedPassword, hashedPassword) ? PasswordVerificationResult.Success : PasswordVerificationResult.Failed;
}

/// <summary>Claims der Sitzung wie bisher (Id, Benutzername, admin) plus Sicherheitsstempel von Identity.</summary>
sealed class PodiumClaims(UserManager<User> um, IOptions<IdentityOptions> o) : UserClaimsPrincipalFactory<User>(um, o)
{
    protected override Task<ClaimsIdentity> GenerateClaimsAsync(User u)
    {
        var id = new ClaimsIdentity(IdentityConstants.ApplicationScheme, ClaimTypes.Name, ClaimTypes.Role);
        id.AddClaim(new Claim(ClaimTypes.NameIdentifier, u.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        id.AddClaim(new Claim(ClaimTypes.Name, u.UserName));
        id.AddClaim(new Claim(PodiumIdentity.AdminClaim, u.IsAdmin ? "true" : "false"));
        id.AddClaim(new Claim(Options.ClaimsIdentity.SecurityStampClaimType, u.SecurityStamp));
        return Task.FromResult(id);
    }
}

/// <summary>Identity-Speicher über die Tabellen Users, UserLogins, UserPasskeys. Speichert bei jedem Update sofort.</summary>
sealed class PodiumUserStore(AppDb db, IDataProtectionProvider schutz) :
    IUserPasswordStore<User>, IUserSecurityStampStore<User>, IUserLockoutStore<User>, IUserTwoFactorStore<User>,
    IUserAuthenticatorKeyStore<User>, IUserTwoFactorRecoveryCodeStore<User>, IUserLoginStore<User>, IUserPasskeyStore<User>
{
    readonly IDataProtector totp = schutz.CreateProtector("Podium.Identity.Authenticator.v1");
    static string Inv(int i) => i.ToString(System.Globalization.CultureInfo.InvariantCulture);

    public void Dispose() { }

    public Task<string> GetUserIdAsync(User u, CancellationToken c) => Task.FromResult(Inv(u.Id));
    public Task<string?> GetUserNameAsync(User u, CancellationToken c) => Task.FromResult<string?>(u.UserName);
    public Task SetUserNameAsync(User u, string? n, CancellationToken c) { u.UserName = (n ?? "").ToLowerInvariant(); return Task.CompletedTask; }
    public Task<string?> GetNormalizedUserNameAsync(User u, CancellationToken c) => Task.FromResult<string?>(u.UserName.ToUpperInvariant());
    public Task SetNormalizedUserNameAsync(User u, string? n, CancellationToken c) => Task.CompletedTask;
    public async Task<IdentityResult> CreateAsync(User u, CancellationToken c) { db.Users.Add(u); await db.SaveChangesAsync(c); return IdentityResult.Success; }
    public async Task<IdentityResult> UpdateAsync(User u, CancellationToken c)
    {
        if (db.Entry(u).State == EntityState.Detached) db.Users.Attach(u).State = EntityState.Modified;
        await db.SaveChangesAsync(c);
        return IdentityResult.Success;
    }
    public async Task<IdentityResult> DeleteAsync(User u, CancellationToken c) { db.Users.Remove(u); await db.SaveChangesAsync(c); return IdentityResult.Success; }
    public async Task<User?> FindByIdAsync(string userId, CancellationToken c) => int.TryParse(userId, out var id) ? await db.Users.FindAsync([id], c) : null;
    public Task<User?> FindByNameAsync(string n, CancellationToken c) { var k = (n ?? "").Trim().ToLowerInvariant(); return db.Users.FirstOrDefaultAsync(u => u.UserName == k, c); }

    public Task SetPasswordHashAsync(User u, string? h, CancellationToken c) { u.PasswordHash = h ?? ""; return Task.CompletedTask; }
    public Task<string?> GetPasswordHashAsync(User u, CancellationToken c) => Task.FromResult<string?>(u.PasswordHash.Length > 0 ? u.PasswordHash : null);
    public Task<bool> HasPasswordAsync(User u, CancellationToken c) => Task.FromResult(u.PasswordHash.Length > 0);
    public Task SetSecurityStampAsync(User u, string s, CancellationToken c) { u.SecurityStamp = s; return Task.CompletedTask; }
    public Task<string?> GetSecurityStampAsync(User u, CancellationToken c) => Task.FromResult<string?>(u.SecurityStamp);

    public Task<DateTimeOffset?> GetLockoutEndDateAsync(User u, CancellationToken c)
        => Task.FromResult(u.LockoutEndUtc is { } e ? new DateTimeOffset(DateTime.SpecifyKind(e, DateTimeKind.Utc)) : (DateTimeOffset?)null);
    public Task SetLockoutEndDateAsync(User u, DateTimeOffset? e, CancellationToken c) { u.LockoutEndUtc = e?.UtcDateTime; return Task.CompletedTask; }
    public Task<int> IncrementAccessFailedCountAsync(User u, CancellationToken c) => Task.FromResult(++u.AccessFailedCount);
    public Task ResetAccessFailedCountAsync(User u, CancellationToken c) { u.AccessFailedCount = 0; return Task.CompletedTask; }
    public Task<int> GetAccessFailedCountAsync(User u, CancellationToken c) => Task.FromResult(u.AccessFailedCount);
    public Task<bool> GetLockoutEnabledAsync(User u, CancellationToken c) => Task.FromResult(true);
    public Task SetLockoutEnabledAsync(User u, bool e, CancellationToken c) => Task.CompletedTask;

    public Task SetTwoFactorEnabledAsync(User u, bool e, CancellationToken c) { u.TwoFactorEnabled = e; return Task.CompletedTask; }
    public Task<bool> GetTwoFactorEnabledAsync(User u, CancellationToken c) => Task.FromResult(u.TwoFactorEnabled);
    public Task SetAuthenticatorKeyAsync(User u, string key, CancellationToken c) { u.AuthenticatorKeyProtected = string.IsNullOrEmpty(key) ? null : totp.Protect(key); return Task.CompletedTask; }
    public Task<string?> GetAuthenticatorKeyAsync(User u, CancellationToken c)
    {
        if (u.AuthenticatorKeyProtected is not { } g) return Task.FromResult<string?>(null);
        try { return Task.FromResult<string?>(totp.Unprotect(g)); }
        catch (CryptographicException) { return Task.FromResult<string?>(null); }   // Schlüsselring verloren: neu einrichten
    }

    static string CodeHash(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(new string((code ?? "").Where(char.IsAsciiLetterOrDigit).Select(char.ToLowerInvariant).ToArray()))));
    static List<string> Codes(User u) => (u.RecoveryCodes ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries).ToList();
    public Task ReplaceCodesAsync(User u, IEnumerable<string> codes, CancellationToken c) { u.RecoveryCodes = string.Join(';', codes.Select(CodeHash)); return Task.CompletedTask; }
    public Task<bool> RedeemCodeAsync(User u, string code, CancellationToken c)
    {
        var l = Codes(u);
        if (!l.Remove(CodeHash(code))) return Task.FromResult(false);
        u.RecoveryCodes = l.Count == 0 ? null : string.Join(';', l);
        return Task.FromResult(true);
    }
    public Task<int> CountCodesAsync(User u, CancellationToken c) => Task.FromResult(Codes(u).Count);

    // Verknüpfungen. SAML spiegelt sich zusätzlich in User.SsoId (bisheriges Feld; ältere Programmstände und die Benutzerliste lesen es).
    public Task AddLoginAsync(User u, UserLoginInfo l, CancellationToken c)
    {
        db.UserLogins.Add(new UserLogin { UserId = u.Id, Provider = l.LoginProvider, ProviderKey = l.ProviderKey, DisplayName = l.ProviderDisplayName ?? l.LoginProvider });
        if (l.LoginProvider == "SAML") u.SsoId = l.ProviderKey;
        return Task.CompletedTask;
    }
    public async Task RemoveLoginAsync(User u, string provider, string key, CancellationToken c)
    {
        db.UserLogins.RemoveRange(await db.UserLogins.Where(x => x.UserId == u.Id && x.Provider == provider && x.ProviderKey == key).ToListAsync(c));
        if (provider == "SAML" && u.SsoId == key) u.SsoId = null;
    }
    public async Task<IList<UserLoginInfo>> GetLoginsAsync(User u, CancellationToken c)
        => (await db.UserLogins.Where(x => x.UserId == u.Id).ToListAsync(c)).Select(x => new UserLoginInfo(x.Provider, x.ProviderKey, x.DisplayName)).ToList();
    public async Task<User?> FindByLoginAsync(string provider, string key, CancellationToken c)
    {
        var id = await db.UserLogins.Where(x => x.Provider == provider && x.ProviderKey == key).Select(x => (int?)x.UserId).FirstOrDefaultAsync(c);
        return id is { } i ? await db.Users.FindAsync([i], c) : null;
    }

    public async Task AddOrUpdatePasskeyAsync(User u, UserPasskeyInfo p, CancellationToken c)
    {
        var e = await db.UserPasskeys.FirstOrDefaultAsync(x => x.CredentialId == p.CredentialId, c);
        if (e == null) { e = new UserPasskey { UserId = u.Id, CredentialId = p.CredentialId, Name = "Passkey" }; db.UserPasskeys.Add(e); }
        if (!string.IsNullOrWhiteSpace(p.Name)) e.Name = p.Name.Trim()[..Math.Min(p.Name.Trim().Length, 100)];
        e.PublicKey = p.PublicKey; e.CreatedUtc = p.CreatedAt.UtcDateTime; e.SignCount = p.SignCount; e.Transports = string.Join(',', p.Transports ?? []);
        e.IsUserVerified = p.IsUserVerified; e.IsBackupEligible = p.IsBackupEligible; e.IsBackedUp = p.IsBackedUp;
        e.AttestationObject = p.AttestationObject; e.ClientDataJson = p.ClientDataJson;
    }
    public async Task<IList<UserPasskeyInfo>> GetPasskeysAsync(User u, CancellationToken c)
        => (await db.UserPasskeys.Where(x => x.UserId == u.Id).ToListAsync(c)).Select(Info).ToList();
    public async Task<User?> FindByPasskeyIdAsync(byte[] id, CancellationToken c)
    {
        var uid = await db.UserPasskeys.Where(x => x.CredentialId == id).Select(x => (int?)x.UserId).FirstOrDefaultAsync(c);
        return uid is { } i ? await db.Users.FindAsync([i], c) : null;
    }
    public async Task<UserPasskeyInfo?> FindPasskeyAsync(User u, byte[] id, CancellationToken c)
        => await db.UserPasskeys.FirstOrDefaultAsync(x => x.UserId == u.Id && x.CredentialId == id, c) is { } p ? Info(p) : null;
    public async Task RemovePasskeyAsync(User u, byte[] id, CancellationToken c)
        => db.UserPasskeys.RemoveRange(await db.UserPasskeys.Where(x => x.UserId == u.Id && x.CredentialId == id).ToListAsync(c));
    static UserPasskeyInfo Info(UserPasskey p) => new(p.CredentialId, p.PublicKey, new DateTimeOffset(DateTime.SpecifyKind(p.CreatedUtc, DateTimeKind.Utc)), (uint)Math.Clamp(p.SignCount, 0, uint.MaxValue),
        p.Transports.Split(',', StringSplitOptions.RemoveEmptyEntries), p.IsUserVerified, p.IsBackupEligible, p.IsBackedUp, p.AttestationObject, p.ClientDataJson) { Name = p.Name };
}

/// <summary>
/// Letzter Schritt jeder Anmeldung (Passwort, Passkey, SAML, OIDC): aktiv und nicht gesperrt? Zweiter Faktor nötig (Pflicht für Admins)?
/// Dann Zwischen-Cookie von Identity (5 min) und Code-Abfrage auf der Anmeldeseite, sonst Sitzung (12 h, wie bisher).
/// </summary>
public sealed class Anmeldeabschluss(SignInManager<User> sm, Anmeldeangebot angebot, AppDb db, ILogger<Anmeldeabschluss> log)
{
    public enum Ergebnis { Angemeldet, ZweiterFaktor, Gesperrt }

    public async Task<Ergebnis> AbschliessenAsync(HttpContext ctx, User u, string art, bool mfa)
    {
        if (!await sm.CanSignInAsync(u) || await sm.UserManager.IsLockedOutAsync(u)) return Ergebnis.Gesperrt;
        if (Anmeldeangebot.BrauchtZweitenFaktor(u, art, mfa, angebot.MfaBeiSso))
        {
            await ZwischenCookieAsync(ctx, u, art);
            return Ergebnis.ZweiterFaktor;
        }
        await AnmeldenAsync(u, art, mfa);
        return Ergebnis.Angemeldet;
    }

    public async Task AnmeldenAsync(User u, string art, bool mfa)
    {
        u.LastLoginUtc = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await sm.SignInWithClaimsAsync(u, new AuthenticationProperties { IsPersistent = true }, Claims(art, mfa));
        log.LogInformation("Anmeldung ({Art}{Mfa}) Konto {User}", art, mfa ? ", MFA" : "", u.UserName);
    }

    public static IEnumerable<Claim> Claims(string art, bool mfa)
    {
        yield return new Claim(ClaimTypes.AuthenticationMethod, art);
        if (mfa) yield return new Claim("amr", "mfa");
    }

    /// <summary>Wie SignInManager.StoreTwoFactorInfo: Konto-Id, Anmeldeart, Sicherheitsstempel (5 min).</summary>
    public async Task ZwischenCookieAsync(HttpContext ctx, User u, string art)
    {
        var id = new ClaimsIdentity(IdentityConstants.TwoFactorUserIdScheme);
        id.AddClaim(new Claim(ClaimTypes.Name, u.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        id.AddClaim(new Claim(ClaimTypes.AuthenticationMethod, art));
        id.AddClaim(new Claim(sm.Options.ClaimsIdentity.SecurityStampClaimType, u.SecurityStamp));
        await ctx.SignInAsync(IdentityConstants.TwoFactorUserIdScheme, new ClaimsPrincipal(id));
    }
}
