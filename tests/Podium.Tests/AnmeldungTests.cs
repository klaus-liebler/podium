using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Podium.Auth;
using Podium.Data;

namespace Podium.Tests;

/// <summary>Anmeldung über ASP.NET Core Identity: Aufwertung bestehender Datenbanken, Altpasswörter, TOTP-Pflicht, SAML-Zuordnung.</summary>
public sealed class AnmeldungTests : IAsyncLifetime
{
    private readonly string ordner = Directory.CreateTempSubdirectory("podium-tests-").FullName;
    private ServiceProvider dienste = null!;

    public ValueTask InitializeAsync()
    {
        var k = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        var s = new ServiceCollection().AddLogging();
        s.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={Path.Combine(ordner, "podium.db")}"));
        s.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(ordner, "schluessel")));
        s.AddPodiumIdentity(k);
        dienste = s.BuildServiceProvider();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        await dienste.DisposeAsync();
        SqliteConnection.ClearAllPools();
        Directory.Delete(ordner, recursive: true);
    }

    private async Task<T> MitAsync<T>(Func<IServiceProvider, Task<T>> arbeit)
    {
        await using var b = dienste.CreateAsyncScope();
        return await arbeit(b.ServiceProvider);
    }

    /// <summary>Datenbank wie vor dem Umbau: ohne Identity-Spalten und -Tabellen, Konten mit SsoId und Passwort im bisherigen Format.</summary>
    private async Task AlteDatenbankAsync(string passwortHash)
    {
        await MitAsync(async d =>
        {
            var db = d.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync(TestContext.Current.CancellationToken);
            await db.Database.ExecuteSqlRawAsync("DROP TABLE UserLogins; DROP TABLE UserPasskeys;", TestContext.Current.CancellationToken);
            foreach (var spalte in new[] { "SecurityStamp", "AccessFailedCount", "LockoutEndUtc", "TwoFactorEnabled", "AuthenticatorKeyProtected", "RecoveryCodes" })
            {
                var sql = "ALTER TABLE Users DROP COLUMN \"" + spalte + "\"";
                await db.Database.ExecuteSqlRawAsync(sql, TestContext.Current.CancellationToken);
            }

            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO Users (UserName, DisplayName, PasswordHash, IsAdmin, Active, CreatedUtc, MusicJson, SsoId) VALUES "
                + "('admin', 'Admin', {0}, 1, 1, '2026-01-01 10:00:00', '', 'admin-subj@hs-osnabrueck.de'), "
                + "('lehrer', 'Lehrer', '', 0, 1, '2026-01-01 10:00:00', '', 'lehrer-subj@hs-osnabrueck.de')",
                [passwortHash], TestContext.Current.CancellationToken);
            db.EnsureSchemaUpgrades();
            return true;
        });
    }

    [Fact]
    public async Task Aufwertung_uebernimmt_SsoId_als_Verknuepfung_und_vergibt_Stempel()
    {
        await AlteDatenbankAsync(Passwords.Hash("altes-Passwort-123"));
        var (logins, stempel) = await MitAsync(async d =>
        {
            var db = d.GetRequiredService<AppDb>();
            return (await db.UserLogins.OrderBy(l => l.ProviderKey).Select(l => new { l.UserId, l.Provider, l.ProviderKey }).ToListAsync(TestContext.Current.CancellationToken),
                await db.Users.Select(u => u.SecurityStamp).ToListAsync(TestContext.Current.CancellationToken));
        });
        logins.Select(l => (l.Provider, l.ProviderKey)).ShouldBe([("SAML", "admin-subj@hs-osnabrueck.de"), ("SAML", "lehrer-subj@hs-osnabrueck.de")]);
        stempel.ShouldAllBe(s => s.Length == 32);

        // ein zweiter Start ändert nichts mehr
        await MitAsync(d => { d.GetRequiredService<AppDb>().EnsureSchemaUpgrades(); return Task.FromResult(true); });
        (await MitAsync(d => d.GetRequiredService<AppDb>().UserLogins.CountAsync(TestContext.Current.CancellationToken))).ShouldBe(2);
    }

    [Fact]
    public async Task Hochschulkennung_findet_dasselbe_Konto_wie_vorher()
    {
        await AlteDatenbankAsync(Passwords.Hash("altes-Passwort-123"));
        var konto = await MitAsync(d => d.GetRequiredService<UserManager<User>>().FindByLoginAsync(Saml.LoginProvider, "lehrer-subj@hs-osnabrueck.de"));
        konto.ShouldNotBeNull();
        konto.UserName.ShouldBe("lehrer");
        konto.SsoId.ShouldBe("lehrer-subj@hs-osnabrueck.de");   // bleibt gefüllt (Rückweg auf die alte Version)
        (await MitAsync(d => d.GetRequiredService<UserManager<User>>().FindByLoginAsync(Saml.LoginProvider, "fremd@hs-osnabrueck.de"))).ShouldBeNull();
    }

    [Fact]
    public async Task Altes_Passwort_gilt_weiter_und_Sperre_nach_fuenf_Fehlversuchen()
    {
        await AlteDatenbankAsync(Passwords.Hash("altes-Passwort-123"));
        await MitAsync(async d =>
        {
            var um = d.GetRequiredService<UserManager<User>>();
            var admin = (await um.FindByNameAsync("admin"))!;
            (await um.CheckPasswordAsync(admin, "altes-Passwort-123")).ShouldBeTrue();
            (await um.CheckPasswordAsync(admin, "falsch-falsch")).ShouldBeFalse();
            for (var i = 0; i < 5; i++)
            {
                await um.AccessFailedAsync(admin);
            }

            (await um.IsLockedOutAsync(admin)).ShouldBeTrue();
            return true;
        });
    }

    [Theory]
    [InlineData(true, "Passwort", false, false, true)]     // Admin: TOTP Pflicht
    [InlineData(false, "Passwort", false, false, false)]
    [InlineData(false, "Passwort", false, true, true)]     // freiwillig eingerichtet
    [InlineData(true, "SAML", true, false, false)]         // REFEDS-MFA vom IdP
    [InlineData(true, "SAML", false, false, true)]
    [InlineData(false, "SAML", false, false, false)]
    [InlineData(true, "Passkey", true, false, false)]      // Nutzerprüfung im Gerät
    public void Zweiter_Faktor_ist_Pflicht_fuer_Admins(bool admin, string art, bool mfa, bool eingerichtet, bool erwartet)
        => Anmeldeangebot.BrauchtZweitenFaktor(new User { IsAdmin = admin, TwoFactorEnabled = eingerichtet }, art, mfa, mfaBeiSso: true).ShouldBe(erwartet);
}
