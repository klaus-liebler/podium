using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Podium.Auth;
using Anthropic;
using Anthropic.Models.Beta;
using Anthropic.Models.Beta.Messages;
using Podium.Data;

namespace Podium.Teaching;

/// <summary>
/// KI-Vorschläge für Quizfragen aus einem Text oder PDF (Claude). Nur aktiv, wenn ein API-Schlüssel konfiguriert ist
/// (Ai:ApiKey, z. B. in /etc/podium/podium.env als Ai__ApiKey). Die Oberfläche weist darauf hin, dass der Inhalt dafür
/// an Anthropic übertragen wird; die Vorschläge werden erst nach Prüfung durch die Lehrperson übernommen.
/// </summary>
public static class AiApi
{
    const string Model = "claude-opus-5-5";
    const int MaxText = 150_000;
    const long MaxPdf = 20_000_000;

    const string Purpose = "Podium.AiKey";
    static string? ServerKey(IConfiguration cfg) => cfg["Ai:ApiKey"] is { Length: > 10 } k ? k : null;

    /// <summary>Eigener Schlüssel des Kontos, sonst der optionale Server-Schlüssel</summary>
    static async Task<(string? key, bool own)> Key(AppDb db, IDataProtectionProvider dp, IConfiguration cfg, int userId)
    {
        var stored = await db.Users.Where(u => u.Id == userId).Select(u => u.AiKeyProtected).FirstOrDefaultAsync();
        if (stored != null)
            try { return (dp.CreateProtector(Purpose).Unprotect(stored), true); }
            catch (System.Security.Cryptography.CryptographicException) { /* Schlüsselring verloren – neu hinterlegen */ }
        return (ServerKey(cfg), false);
    }

    public static void MapAi(this RouteGroupBuilder api)
    {
        var my = api.MapGroup("/ai").RequireAuthorization();
        my.MapGet("", async (AppDb db, IDataProtectionProvider dp, IConfiguration cfg, ClaimsPrincipal u) =>
        {
            var (key, own) = await Key(db, dp, cfg, u.UserId());
            return Results.Ok(new { enabled = key != null, own, server = ServerKey(cfg) != null, hint = own ? "…" + key![^4..] : null });
        });

        // Eigenen Claude-API-Schlüssel hinterlegen (console.anthropic.com → API Keys) bzw. entfernen
        my.MapPut("/key", async (AiKeyRequest r, AppDb db, IDataProtectionProvider dp, ClaimsPrincipal u) =>
        {
            var key = (r.Key ?? "").Trim();
            if (!key.StartsWith("sk-ant-") || key.Length is < 30 or > 300 || key.Any(char.IsWhiteSpace))
                return Results.BadRequest(new { error = "Das sieht nicht wie ein Claude-API-Schlüssel aus (beginnt mit „sk-ant-“)." });
            var user = await db.Users.FirstAsync(x => x.Id == u.UserId());
            user.AiKeyProtected = dp.CreateProtector(Purpose).Protect(key);
            await db.SaveChangesAsync();
            return Results.Ok(new { hint = "…" + key[^4..] });
        });
        my.MapDelete("/key", async (AppDb db, ClaimsPrincipal u) =>
        {
            var id = u.UserId();
            await db.Users.Where(x => x.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.AiKeyProtected, (string?)null));
            return Results.NoContent();
        });

        my.MapPost("/questions", async (HttpRequest req, AppDb db, IDataProtectionProvider dp, IConfiguration cfg, ClaimsPrincipal u, ILogger<AiMarker> log, CancellationToken ct) =>
        {
            if ((await Key(db, dp, cfg, u.UserId())).key is not { } key) return Results.BadRequest(new { error = "Bitte zuerst unter „Mein Konto“ einen Claude-API-Schlüssel hinterlegen." });
            var form = await req.ReadFormAsync(ct);
            var text = (form["text"].ToString() ?? "").Trim();
            var count = Math.Clamp(int.TryParse(form["count"], out var c) ? c : 5, 1, 20);
            var file = form.Files.GetFile("file");
            if (text.Length > MaxText) return Results.BadRequest(new { error = $"Der Text ist zu lang (max. {MaxText / 1000} 000 Zeichen)." });
            if (file != null && (file.Length > MaxPdf || !file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)))
                return Results.BadRequest(new { error = "Bitte eine PDF-Datei bis 20 MB." });
            if (text.Length == 0 && file == null) return Results.BadRequest(new { error = "Bitte Text einfügen oder eine PDF-Datei wählen." });

            var content = new List<BetaContentBlockParam>();
            if (file != null)
            {
                using var ms = new MemoryStream();
                await file.CopyToAsync(ms, ct);
                content.Add(new BetaRequestDocumentBlock { Source = new BetaBase64PdfSource { Data = Convert.ToBase64String(ms.ToArray()) } });
            }
            content.Add(new BetaTextBlockParam { Text = Prompt(count, text) });

            AnthropicClient client = new() { ApiKey = key };
            BetaMessage msg;
            try
            {
                msg = await client.Beta.Messages.Create(new MessageCreateParams
                {
                    Model = Model,
                    MaxTokens = 16000,
                    Betas = [AnthropicBeta.ServerSideFallback2026_07_01],
                    Fallbacks = new Default(),
                    OutputConfig = new BetaOutputConfig { Effort = Effort.Medium },
                    System = "Du erstellst Quizfragen für Lehrveranstaltungen an Hochschulen. Antworte ausschließlich mit JSON.",
                    Messages = [new BetaUserMessageParam { Content = content }],
                }, ct);
            }
            catch (Anthropic.Exceptions.AnthropicUnauthorizedException)
            {
                return Results.BadRequest(new { error = "Der Claude-API-Schlüssel wurde abgelehnt. Bitte unter „Mein Konto“ prüfen." });
            }
            catch (Anthropic.Exceptions.AnthropicRateLimitException)
            {
                return Results.Json(new { error = "Zu viele Anfragen an Claude – bitte kurz warten und erneut versuchen." }, statusCode: 429);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "KI-Vorschläge fehlgeschlagen");
                return Results.Json(new { error = "Der KI-Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen." }, statusCode: 502);
            }
            if (msg.StopReason == "refusal") return Results.BadRequest(new { error = "Der KI-Dienst hat die Anfrage abgelehnt." });

            var answer = string.Concat(msg.Content.Select(b => b.TryPickText(out var t) ? t.Text : ""));
            var questions = Parse(answer);
            if (questions.Count == 0) return Results.Json(new { error = "Es kamen keine verwertbaren Vorschläge zurück. Bitte erneut versuchen." }, statusCode: 502);
            return Results.Ok(new { questions });
        }).DisableAntiforgery(); // Cookie ist SameSite=Strict
    }

    static string Prompt(int count, string text) => $$"""
        Erstelle {{count}} abwechslungsreiche Quizfragen auf Deutsch zum {{(text.Length > 0 ? "folgenden Inhalt" : "beigefügten Dokument")}}.
        Prüfe Verständnis, nicht nur Auswendiggelerntes. Jede Frage hat eine kurze Erklärung zur Lösung (1–2 Sätze).
        Typen: überwiegend "choice" (2–4 Antworten, mindestens eine richtig, Antworten kurz), gelegentlich "estimate"
        (Zahl mit correctValue, tolerance, unit, ohne options) oder "order" (3–5 Elemente in richtiger Reihenfolge, isCorrect true).
        Formeln in LaTeX zwischen $…$, Code in `…`.
        Gib nur ein JSON-Array zurück, ohne weiteren Text, in diesem Format:
        [{"kind":"choice","text":"…","timeLimitSeconds":20,"options":[{"text":"…","isCorrect":true}],"explanation":"…"},
         {"kind":"estimate","text":"…","timeLimitSeconds":30,"correctValue":42,"tolerance":2,"unit":"m","options":[],"explanation":"…"}]
        {{(text.Length > 0 ? "\n<inhalt>\n" + text + "\n</inhalt>" : "")}}
        """;

    /// <summary>JSON-Array aus der Antwort lesen und jede Frage mit denselben Regeln prüfen wie beim Speichern</summary>
    static List<QuestionDto> Parse(string answer)
    {
        int a = answer.IndexOf('['), b = answer.LastIndexOf(']');
        if (a < 0 || b <= a) return [];
        try
        {
            var list = JsonSerializer.Deserialize<List<QuestionDto>>(answer[a..(b + 1)], new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
            return list.Select(q => q with
            {
                TimeLimitSeconds = new[] { 10, 15, 20, 30, 45, 60, 90 }.OrderBy(t => Math.Abs(t - q.TimeLimitSeconds)).First(),
                PointsMultiplier = 1,
                Options = q.Options ?? [],
                Notes = "",
            }).Where((q, i) => q.Validate(i + 1) == null).Take(20).ToList();
        }
        catch (JsonException) { return []; }
    }

    /// <summary>nur als Kategorie für das Log</summary>
    public sealed class AiMarker;
}

public record AiKeyRequest(string? Key);
