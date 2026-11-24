using System.Security.Claims;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Podium.Data;
using Sustainsys.Saml2;
using Sustainsys.Saml2.AspNetCore2;
using Sustainsys.Saml2.Metadata;

namespace Podium.Auth;

/// <summary>
/// Hochschul-Login per SAML (Shibboleth-IdP der HS Osnabrück). Podium ist Service Provider:
///   Metadaten  {PublicBaseUrl}/Saml2       (entityID = diese URL)
///   ACS        {PublicBaseUrl}/Saml2/Acs   (HTTP-POST)
/// Zugelassen sind nur Personen mit passender eduPersonScopedAffiliation (Mitarbeitende, nicht Studierende).
/// Beim ersten Login entsteht automatisch ein Konto. Ein bereits angemeldetes lokales Konto kann verknüpft werden.
///
/// Konfiguration (Abschnitt "Saml", z. B. per Umgebung Saml__IdpEntityId=…):
///   IdpEntityId          aktiviert den Hochschul-Login
///   IdpMetadataUrl       Vorgabe: IdpEntityId
///   AllowedAffiliations  Vorgabe: employee@, staff@, faculty@hs-osnabrueck.de (kommagetrennt)
///   CertPath             Schlüssel + Zertifikat des SP (PFX); fehlt die Datei, wird sie beim Start erzeugt
///   ContactEmail         optional: technischer Kontakt in den Metadaten
/// </summary>
public static class Saml
{
    public const string Scheme = Saml2Defaults.Scheme;          // "Saml2" – zugleich der Pfad der Metadaten
    const string ExternScheme = "saml-extern";                  // kurzlebiges Zwischen-Cookie bis zur Kontozuordnung
    const string LinkItem = "podium.link";

    // SAML-Attributnamen (urn:oid-Form, wie Shibboleth sie ausliefert)
    const string AttrSubjectId = "urn:oasis:names:tc:SAML:attribute:subject-id";
    const string AttrPairwiseId = "urn:oasis:names:tc:SAML:attribute:pairwise-id";
    const string AttrEppn = "urn:oid:1.3.6.1.4.1.5923.1.1.1.6";
    const string AttrAffiliation = "urn:oid:1.3.6.1.4.1.5923.1.1.1.9";
    const string AttrDisplayName = "urn:oid:2.16.840.1.113730.3.1.241";
    const string AttrGivenName = "urn:oid:2.5.4.42";
    const string AttrSurname = "urn:oid:2.5.4.4";
    const string AttrMail = "urn:oid:0.9.2342.19200300.100.1.3";

    public static bool Enabled(IConfiguration cfg) => !string.IsNullOrWhiteSpace(cfg["Saml:IdpEntityId"]);

    public static void AddPodiumSaml(this AuthenticationBuilder auth, IConfiguration cfg, string keysDir)
    {
        if (!Enabled(cfg)) return;
        var publicBase = cfg["PublicBaseUrl"]?.TrimEnd('/')
            ?? throw new InvalidOperationException("Für den Hochschul-Login muss PublicBaseUrl gesetzt sein.");
        var cert = LoadOrCreateCertificate(cfg["Saml:CertPath"] ?? Path.Combine(keysDir, "saml-sp.pfx"), new Uri(publicBase).Host);

        auth.AddCookie(ExternScheme, o =>
        {
            o.Cookie.Name = "podium.saml";
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Lax;   // kommt per Weiterleitung vom IdP zurück
            o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            o.ExpireTimeSpan = TimeSpan.FromMinutes(5);
        });
        auth.AddSaml2(Scheme, o =>
        {
            o.SignInScheme = ExternScheme;
            var sp = o.SPOptions;
            sp.EntityId = new EntityId(publicBase + "/" + Scheme);
            sp.PublicOrigin = new Uri(publicBase + "/");
            sp.ModulePath = "/" + Scheme;
            sp.ReturnUrl = new Uri(publicBase + "/api/auth/saml/fertig");
            sp.WantAssertionsSigned = true;
            sp.ServiceCertificates.Add(new ServiceCertificate { Certificate = cert, Use = CertificateUse.Both, MetadataPublishOverride = MetadataPublishOverrideType.None });
            sp.MetadataCacheDuration = new XsdDuration(hours: 1);   // IdP holt Änderungen zügig ab
            sp.Organization = new Organization();
            sp.Organization.Names.Add(new LocalizedName("Podium", "de"));
            sp.Organization.DisplayNames.Add(new LocalizedName("Podium – Live-Quiz für die Lehre", "de"));
            sp.Organization.Urls.Add(new LocalizedUri(new Uri(publicBase + "/"), "de"));
            if (cfg["Saml:ContactEmail"] is { Length: > 0 } mail)
            {
                var c = new ContactPerson(ContactType.Technical);
                c.EmailAddresses.Add("mailto:" + mail);
                sp.Contacts.Add(c);
            }
            var acs = new AttributeConsumingService { IsDefault = true };
            acs.ServiceNames.Add(new LocalizedName("Podium", "de"));
            foreach (var (name, friendly, required) in new[]
            {
                (AttrSubjectId, "subject-id", false), (AttrPairwiseId, "pairwise-id", false), (AttrEppn, "eduPersonPrincipalName", false),
                (AttrAffiliation, "eduPersonScopedAffiliation", true), (AttrDisplayName, "displayName", false),
                (AttrGivenName, "givenName", false), (AttrSurname, "sn", false), (AttrMail, "mail", true),
            })
                acs.RequestedAttributes.Add(new RequestedAttribute(name) { FriendlyName = friendly, IsRequired = required, NameFormat = RequestedAttribute.AttributeNameFormatUri });
            sp.AttributeConsumingServices.Add(acs);

            // .NET (EncryptedXml) kann kein AES-GCM – Shibboleth wählt laut Metadaten dann AES-CBC
            o.Notifications.MetadataCreated = (md, _) =>
            {
                // nur HTTP-POST an den ACS, kein Artifact-Binding und kein Single Logout (beides nutzt Podium nicht)
                foreach (var spd in md.RoleDescriptors.OfType<SpSsoDescriptor>())
                {
                    foreach (var key in spd.AssertionConsumerServices.Where(a => a.Value.Binding != Sustainsys.Saml2.WebSso.Saml2Binding.HttpPostUri).Select(a => a.Key).ToList())
                        spd.AssertionConsumerServices.Remove(key);
                    spd.SingleLogoutServices.Clear();
                }
                foreach (var role in md.RoleDescriptors)
                    foreach (var kd in role.Keys.Where(k => k.Use is KeyType.Encryption or KeyType.Unspecified))
                    {
                        // Schlüsseltransport nur rsa-oaep-mgf1p: bei xmlenc11#rsa-oaep scheitert Sustainsys am Digest-URI xmldsig#sha1
                        // ("Unknown hash algorithm for OAEP")
                        foreach (var alg in new[] { "http://www.w3.org/2001/04/xmlenc#aes256-cbc", "http://www.w3.org/2001/04/xmlenc#aes128-cbc",
                                     "http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p" })
                            kd.EncryptionMethods.Add(new EncryptionMethod { Algorithm = new Uri(alg) });
                    }
            };
            // IdP-Metadaten werden erst beim ersten Login geladen (EnsureIdp) – ist der IdP gerade nicht erreichbar,
            // bleiben die eigenen Metadaten trotzdem abrufbar.
        });
    }

    /// <summary>IdP beim ersten Bedarf registrieren (Metadaten laden); bei Fehlern beim nächsten Versuch erneut</summary>
    static readonly SemaphoreSlim IdpLock = new(1, 1);
    static async Task<string?> EnsureIdp(Saml2Options o, IConfiguration cfg, ILogger log)
    {
        var entityId = new EntityId(cfg["Saml:IdpEntityId"]);
        if (o.IdentityProviders.TryGetValue(entityId, out _)) return null;
        await IdpLock.WaitAsync();
        try
        {
            if (o.IdentityProviders.TryGetValue(entityId, out _)) return null;
            var idp = new IdentityProvider(entityId, o.SPOptions)
            {
                MetadataLocation = cfg["Saml:IdpMetadataUrl"] ?? entityId.Id,
                AllowUnsolicitedAuthnResponse = false,
            };
            await Task.Run(() => idp.LoadMetadata = true);
            o.IdentityProviders.Add(idp);
            return null;
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Metadaten des IdP {Idp} konnten nicht geladen werden.", entityId.Id);
            return "Der Anmeldedienst der Hochschule ist gerade nicht erreichbar. Bitte später erneut versuchen.";
        }
        finally { IdpLock.Release(); }
    }

    static X509Certificate2 LoadOrCreateCertificate(string path, string host)
    {
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            using var rsa = RSA.Create(3072);
            var req = new CertificateRequest($"CN={host}, O=Podium", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, false));
            using var c = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(10));
            File.WriteAllBytes(path, c.Export(X509ContentType.Pkcs12));
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        return X509CertificateLoader.LoadPkcs12FromFile(path, null,
            OperatingSystem.IsWindows() ? X509KeyStorageFlags.UserKeySet : X509KeyStorageFlags.EphemeralKeySet);
    }

    // ---------------------------------------------------------------- Endpunkte
    public static void MapSaml(this RouteGroupBuilder api, IConfiguration cfg)
    {
        api.MapGet("/auth/saml", () => Results.Ok(new { enabled = Enabled(cfg) }));
        if (!Enabled(cfg)) return;

        // Start: zum IdP weiterleiten. Ist schon ein lokales Konto angemeldet, wird es anschließend verknüpft.
        api.MapGet("/auth/saml/login", async (HttpContext ctx, bool? link, IOptionsMonitor<Saml2Options> opts, ILogger<Saml2Options> log) =>
        {
            if (await EnsureIdp(opts.Get(Scheme), cfg, log) is { } err) return Back(ctx, err);
            var props = new AuthenticationProperties { RedirectUri = ctx.Request.PathBase + "/api/auth/saml/fertig" };
            if (link == true && (await ctx.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme)).Principal is { } p
                && p.FindFirstValue(ClaimTypes.NameIdentifier) is { } uid)
                props.Items[LinkItem] = uid;
            return Results.Challenge(props, [Scheme]);
        });

        // Rückkehr vom IdP: Berechtigung prüfen, Konto finden/anlegen/verknüpfen, Podium-Sitzung starten
        api.MapGet("/auth/saml/fertig", async (HttpContext ctx, AppDb db, ILogger<Saml2Options> log) =>
        {
            var ext = await ctx.AuthenticateAsync(ExternScheme);
            await ctx.SignOutAsync(ExternScheme);
            if (ext.Principal is not { } p) return Back(ctx, "Die Anmeldung über die Hochschule ist fehlgeschlagen. Bitte erneut versuchen.");

            string? Get(string type) => p.FindFirst(type)?.Value?.Trim() is { Length: > 0 } v ? v : null;
            var subject = Get(AttrSubjectId) ?? Get(AttrPairwiseId) ?? Get(AttrEppn);
            if (subject == null)
            {
                log.LogWarning("SAML-Antwort ohne verwendbare Kennung. Erhaltene Attribute: {Attrs}", string.Join(", ", p.Claims.Select(c => c.Type).Distinct()));
                return Back(ctx, "Der Anmeldedienst hat keine Kennung übermittelt. Bitte beim Rechenzentrum melden.");
            }
            var allowed = (cfg["Saml:AllowedAffiliations"] ?? "employee@hs-osnabrueck.de,staff@hs-osnabrueck.de,faculty@hs-osnabrueck.de")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var affiliations = p.FindAll(AttrAffiliation).Select(c => c.Value.Trim()).ToList();
            if (!affiliations.Any(a => allowed.Contains(a, StringComparer.OrdinalIgnoreCase)))
            {
                log.LogInformation("Hochschul-Login abgelehnt für {Subject} (Zugehörigkeit: {Aff}).", subject, string.Join(", ", affiliations));
                return Back(ctx, "Der Dozentenbereich ist Mitarbeitenden der Hochschule vorbehalten. Studierende brauchen keine Anmeldung – sie treten per QR-Code bei.");
            }

            var mail = Get(AttrMail);
            var fullName = string.Join(" ", new[] { Get(AttrGivenName), Get(AttrSurname) }.Where(x => x != null));
            var name = Get(AttrDisplayName) ?? (fullName.Length > 0 ? fullName : mail ?? subject);

            var user = await db.Users.FirstOrDefaultAsync(u => u.SsoId == subject);
            if (user == null && ext.Properties?.Items.TryGetValue(LinkItem, out var linkId) == true && int.TryParse(linkId, out var lid))
            {
                user = await db.Users.FirstOrDefaultAsync(u => u.Id == lid && u.SsoId == null);
                if (user != null) { user.SsoId = subject; log.LogInformation("Konto \"{User}\" mit Hochschulkennung {Subject} verknüpft.", user.UserName, subject); }
            }
            if (user == null)
            {
                user = new User { SsoId = subject, UserName = await FreeUserName(db, subject, mail), DisplayName = name };
                db.Users.Add(user);
                log.LogInformation("Hochschul-Login: neues Konto \"{User}\" für {Subject} angelegt.", user.UserName, subject);
            }
            if (!user.Active) return Back(ctx, "Dieses Konto ist deaktiviert. Bitte an die Administration wenden.");
            user.Email = mail;
            user.LastLoginUtc = DateTime.UtcNow;
            var isNew = user.Id == 0;
            await db.SaveChangesAsync();
            if (isNew) Seed.EnsureDemo(db, user.Id);
            await AuthApi.SignIn(ctx, user);
            return Results.Redirect(ctx.Request.PathBase + "/#/");
        });
    }

    /// <summary>
    /// Fehler beim Verarbeiten der IdP-Antwort (…/Saml2/Acs) wirft Sustainsys als Ausnahme – ohne diesen Fang gäbe es eine leere
    /// 500-Seite. Stattdessen: ausführlich loggen und mit verständlicher Meldung (inkl. Ursache) zur Anmeldeseite.
    /// Muss VOR UseAuthentication stehen.
    /// </summary>
    public static void UseSamlErrors(this WebApplication app)
    {
        if (!Enabled(app.Configuration)) return;
        var log = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Podium.Saml");
        app.Use(async (ctx, next) =>
        {
            if (!ctx.Request.Path.StartsWithSegments("/" + Scheme)) { await next(); return; }
            try { await next(); }
            catch (Exception ex) when (!ctx.Response.HasStarted)
            {
                log.LogError(ex, "Hochschul-Login: Antwort des IdP an {Path} konnte nicht verarbeitet werden.", ctx.Request.Path);
                var cause = ex.InnerException is { } inner ? $"{ex.GetType().Name}: {ex.Message} → {inner.GetType().Name}: {inner.Message}" : $"{ex.GetType().Name}: {ex.Message}";
                if (cause.Length > 400) cause = cause[..400] + " …";
                ctx.Response.Clear();
                ctx.Response.Redirect($"{ctx.Request.PathBase}/#/login?ssoerror={Uri.EscapeDataString("Die Antwort des Anmeldedienstes konnte nicht verarbeitet werden. Ursache: " + cause)}");
            }
        });
    }

    static IResult Back(HttpContext ctx, string error) =>
        Results.Redirect($"{ctx.Request.PathBase}/#/login?ssoerror={Uri.EscapeDataString(error)}");

    /// <summary>Benutzername aus dem lokalen Teil der Kennung/E-Mail ableiten, bei Kollision durchnummerieren</summary>
    static async Task<string> FreeUserName(AppDb db, string subject, string? mail)
    {
        var raw = (subject.Contains('@') ? subject : mail ?? subject).Split('@')[0].ToLowerInvariant();
        var baseName = new string(raw.Where(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '.' or '_' or '-').ToArray());
        if (baseName.Length < 2) baseName = "hs-" + baseName;
        if (baseName.Length > 36) baseName = baseName[..36];
        var name = baseName;
        for (var i = 2; await db.Users.AnyAsync(u => u.UserName == name); i++) name = $"{baseName}{i}";
        return name;
    }
}
