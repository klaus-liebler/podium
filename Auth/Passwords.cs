using System.Security.Cryptography;

namespace Podium.Auth;

/// <summary>Passwort-Hashing mit PBKDF2-SHA256 (Format: pbkdf2-sha256$iterationen$salt$hash, Base64).</summary>
public static class Passwords
{
    const int Iterations = 600_000, SaltBytes = 16, HashBytes = 32;
    public const int MinLength = 10;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var p = stored.Split('$');
        if (p.Length != 4 || p[0] != "pbkdf2-sha256" || !int.TryParse(p[1], out var it)) return false;
        var salt = Convert.FromBase64String(p[2]);
        var expected = Convert.FromBase64String(p[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, it, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    /// <summary>Gut lesbares Zufallspasswort (ohne verwechselbare Zeichen)</summary>
    public static string Generate(int length = 16)
    {
        const string chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return string.Create(length, chars, (span, c) => { for (int i = 0; i < span.Length; i++) span[i] = c[RandomNumberGenerator.GetInt32(c.Length)]; });
    }

    public static string? Check(string? password) =>
        string.IsNullOrEmpty(password) || password.Length < MinLength ? $"Das Passwort muss mindestens {MinLength} Zeichen lang sein." :
        password.Length > 200 ? "Das Passwort ist zu lang." : null;
}
