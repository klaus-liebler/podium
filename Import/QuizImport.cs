using System.IO.Compression;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Podium.Import;

/// <summary>
/// Import von Fragesammlungen:
///  * Kahoot-Link (öffentliche/eigene sichtbare Kahoots, über Kahoots JSON-Schnittstelle)
///  * Kahoot-JSON (z. B. gespeicherte Antwort dieser Schnittstelle) und Podium-Export-JSON
///  * Kahoot-Tabellenvorlage (.xlsx: Question, Answer 1–4, Time limit, Correct answer(s)) sowie CSV mit denselben Spalten
/// </summary>
internal static partial class QuizImport
{
    public sealed record Result(QuizDto? Quiz, List<string> Warnings, string? Error = null);

    static readonly int[] AllowedTimes = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
    static int SnapTime(double secs) => AllowedTimes.OrderBy(t => Math.Abs(t - secs)).First();

    [GeneratedRegex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")]
    private static partial Regex GuidRx();
    [GeneratedRegex("<[^>]+>")]
    private static partial Regex TagRx();

    static string Clean(string? s, int max)
    {
        s = WebUtility.HtmlDecode(TagRx().Replace(s ?? "", " "));
        s = Regex.Replace(s, @"\s+", " ").Trim();
        return s.Length > max ? s[..max] : s;
    }

    /// <summary>Podium-Export: Text ist Markdown – Zeilenumbrüche und Zeichen wie &lt; erhalten, nur kürzen.</summary>
    static string CleanMd(string? s, int max)
    {
        s = (s ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Trim();
        return s.Length > max ? s[..max] : s;
    }

    // ---------------------------------------------------------------- Kahoot-Link

    public static async Task<Result> FromKahootUrlAsync(string url, HttpClient http)
    {
        var m = GuidRx().Match(url ?? "");
        if (!m.Success) return new(null, [], "Im Link wurde keine Kahoot-ID gefunden (Format …/details/<id>).");
        var id = m.Value;
        foreach (var api in new[] { $"https://create.kahoot.it/rest/kahoots/{id}/card/?includeKahoot=true", $"https://create.kahoot.it/rest/kahoots/{id}" })
        {
            try
            {
                using var resp = await http.GetAsync(api);
                if (!resp.IsSuccessStatusCode) continue;
                var json = await resp.Content.ReadAsStringAsync();
                var r = FromJson(json, "Kahoot-Import");
                if (r.Quiz != null) return r;
            }
            catch (HttpRequestException) { /* nächste Variante */ }
            catch (TaskCanceledException) { return new(null, [], "Kahoot hat nicht rechtzeitig geantwortet."); }
        }
        return new(null, [], "Das Kahoot konnte nicht geladen werden. Vermutlich ist es privat – stelle es in Kahoot auf „Öffentlich“ oder nutze den Export als Tabelle.");
    }

    // ---------------------------------------------------------------- JSON (Kahoot oder Podium)

    public static Result FromJson(string json, string fallbackTitle)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(json); } catch (JsonException) { return new(null, [], "Die Datei ist kein gültiges JSON."); }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.TryGetProperty("kahoot", out var k)) root = k;
            if (!root.TryGetProperty("questions", out var qs) || qs.ValueKind != JsonValueKind.Array)
                return new(null, [], "Im JSON wurde keine Fragenliste gefunden.");

            var title = Clean(Str(root, "title") ?? fallbackTitle, 120);
            var desc = Clean(Str(root, "description") ?? "", 300);
            var warnings = new List<string>();
            var skippedTypes = new Dictionary<string, int>();
            var questions = new List<QuestionDto>();
            int n = 0;
            foreach (var q in qs.EnumerateArray())
            {
                n++;
                // Podium-Export
                if (q.TryGetProperty("options", out var opts))
                {
                    var o = opts.EnumerateArray().Select(x => new OptionDto(CleanMd(Str(x, "text"), 300), x.TryGetProperty("isCorrect", out var c) && c.ValueKind == JsonValueKind.True)).ToList();
                    var kind = Podium.Data.QuestionKinds.Norm(Str(q, "kind"));
                    var text = CleanMd(Str(q, "text"), 1000);
                    var extra = new { Explanation = CleanMd(Str(q, "explanation"), 2000), Notes = CleanMd(Str(q, "notes"), 2000) };
                    if (kind == Podium.Data.QuestionKinds.Choice)
                    {
                        var before = questions.Count;
                        Add(questions, warnings, n, text, o, Num(q, "timeLimitSeconds") ?? 20, (int)(Num(q, "pointsMultiplier") ?? 1));
                        if (questions.Count > before) questions[^1] = questions[^1] with { Explanation = extra.Explanation, Notes = extra.Notes };
                        continue;
                    }
                    var dto = new QuestionDto(text, SnapTime(Num(q, "timeLimitSeconds") ?? 20), Math.Clamp((int)(Num(q, "pointsMultiplier") ?? 1), 0, 2),
                        o.Where(x => x.Text.Length > 0).Take(6).ToList(), kind, extra.Explanation, extra.Notes, Num(q, "correctValue"), Num(q, "tolerance"), Clean(Str(q, "unit") ?? "", 12));
                    if (dto.Validate(n) is { } err) warnings.Add(err + " – übersprungen.");
                    else questions.Add(dto);
                    continue;
                }
                // Kahoot
                var type = Str(q, "type") ?? "quiz";
                if (type is not ("quiz" or "multiple_select_quiz" or "true_false"))
                {
                    skippedTypes[type] = skippedTypes.GetValueOrDefault(type) + 1;
                    continue;
                }
                var choices = q.TryGetProperty("choices", out var ch) && ch.ValueKind == JsonValueKind.Array
                    ? ch.EnumerateArray().Select(x => new OptionDto(Clean(Str(x, "answer"), 150), x.TryGetProperty("correct", out var c) && c.ValueKind == JsonValueKind.True)).ToList()
                    : [];
                var timeMs = Num(q, "time") ?? 20000;
                var pm = (int)(Num(q, "pointsMultiplier") ?? 1);
                Add(questions, warnings, n, Clean(Str(q, "question"), 400), choices, timeMs / 1000.0, pm);
            }
            foreach (var (t, c) in skippedTypes)
                warnings.Add($"{c} Folie(n) vom Typ „{TypeName(t)}“ übersprungen (keine Quizfrage – eignet sich als Direktfrage).");
            if (questions.Count == 0) return new(null, warnings, "Keine importierbaren Quizfragen gefunden.");
            return new(new QuizDto(0, title, desc, questions), warnings);
        }
    }

    static string TypeName(string t) => t switch
    {
        "survey" or "poll" => "Umfrage",
        "open_ended" => "Offene Antwort",
        "word_cloud" => "Word Cloud",
        "slider" => "Schieberegler",
        "content" => "Folie",
        "jumble" => "Reihenfolge",
        "brainstorming" => "Brainstorming",
        "drop_pin" => "Pin setzen",
        _ => t,
    };

    static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static double? Num(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    static void Add(List<QuestionDto> list, List<string> warnings, int n, string text, List<OptionDto> options, double secs, int pm)
    {
        options = options.Where(o => o.Text.Length > 0).ToList();
        if (text.Length == 0) { warnings.Add($"Frage {n}: ohne Text – übersprungen."); return; }
        if (options.Count > 6) { warnings.Add($"Frage {n}: mehr als 6 Antworten – auf 6 gekürzt."); options = options.Take(6).ToList(); }
        if (options.Count < 2) { warnings.Add($"Frage {n} („{Short(text)}“): weniger als 2 Text-Antworten (evtl. Bild-Antworten) – übersprungen."); return; }
        if (!options.Any(o => o.IsCorrect)) { warnings.Add($"Frage {n} („{Short(text)}“): keine richtige Antwort markiert – übersprungen."); return; }
        list.Add(new QuestionDto(text, SnapTime(secs), Math.Clamp(pm, 0, 2), options));
    }
    static string Short(string s) => s.Length > 40 ? s[..40] + "…" : s;

    // ---------------------------------------------------------------- Tabelle (Kahoot-Vorlage .xlsx / CSV)

    public static Result FromRows(List<List<string>> rows, string fallbackTitle)
    {
        // Kopfzeile suchen: eine Zelle beginnt mit "Question"/"Frage"
        int header = rows.FindIndex(r => r.Any(c => Regex.IsMatch(c.Trim(), @"^(question|frage)\b", RegexOptions.IgnoreCase)));
        if (header < 0) return new(null, [], "Keine Kopfzeile mit „Question“ bzw. „Frage“ gefunden. Bitte die Kahoot-Vorlage oder gleichnamige Spalten verwenden.");
        var h = rows[header].Select(c => c.Trim().ToLowerInvariant()).ToList();
        int qCol = h.FindIndex(c => Regex.IsMatch(c, @"^(question|frage)\b"));
        var ansCols = Enumerable.Range(1, 6).Select(i => h.FindIndex(c => Regex.IsMatch(c, $@"^(answer|antwort)\s*{i}\b"))).Where(i => i >= 0).ToList();
        int timeCol = h.FindIndex(c => c.StartsWith("time") || c.StartsWith("zeit"));
        int corrCol = h.FindIndex(c => c.StartsWith("correct") || c.StartsWith("richtig") || c.StartsWith("korrekt"));
        if (ansCols.Count < 2 || corrCol < 0) return new(null, [], "Spalten „Answer 1…“ bzw. „Antwort 1…“ und „Correct answer(s)“/„Richtig“ werden benötigt.");

        var warnings = new List<string>();
        var questions = new List<QuestionDto>();
        string Cell(List<string> r, int i) => i >= 0 && i < r.Count ? r[i] : "";
        for (int ri = header + 1, n = 1; ri < rows.Count; ri++)
        {
            var r = rows[ri];
            var text = Clean(Cell(r, qCol), 400);
            if (text.Length == 0) continue;
            var correct = Regex.Matches(Cell(r, corrCol), @"\d+").Select(x => int.Parse(x.Value)).ToHashSet();
            var options = ansCols.Select((col, i) => new OptionDto(Clean(Cell(r, col), 150), correct.Contains(i + 1))).ToList();
            var secs = double.TryParse(Cell(r, timeCol).Replace(',', '.'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var t) ? t : 20;
            Add(questions, warnings, n++, text, options, secs, 1);
        }
        if (questions.Count == 0) return new(null, warnings, "Keine Fragen in der Tabelle gefunden.");
        return new(new QuizDto(0, fallbackTitle, "", questions), warnings);
    }

    public static List<List<string>> ReadCsv(string text)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        char sep = lines.Take(5).Sum(l => l.Count(c => c == ';')) >= lines.Take(5).Sum(l => l.Count(c => c == ',')) ? ';' : ',';
        if (lines.Take(5).Any(l => l.Contains('\t'))) sep = '\t';
        var rows = new List<List<string>>();
        foreach (var line in lines)
        {
            var row = new List<string>(); var cur = new System.Text.StringBuilder(); bool q = false;
            for (int i = 0; i < line.Length; i++)
            {
                var c = line[i];
                if (q) { if (c == '"') { if (i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; } else q = false; } else cur.Append(c); }
                else if (c == '"') q = true;
                else if (c == sep) { row.Add(cur.ToString()); cur.Clear(); }
                else cur.Append(c);
            }
            row.Add(cur.ToString());
            rows.Add(row);
        }
        return rows;
    }

    /// <summary>Minimaler .xlsx-Leser (erstes Tabellenblatt) ohne Zusatzbibliothek.</summary>
    public static List<List<string>> ReadXlsx(Stream stream)
    {
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XNamespace rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        XDocument Load(string path) { using var s = zip.GetEntry(path)!.Open(); return XDocument.Load(s); }

        var shared = new List<string>();
        if (zip.GetEntry("xl/sharedStrings.xml") != null)
            shared = Load("xl/sharedStrings.xml").Root!.Elements(ns + "si").Select(si => string.Concat(si.Descendants(ns + "t").Select(t => t.Value))).ToList();

        var sheet = Load("xl/workbook.xml").Root!.Element(ns + "sheets")!.Elements(ns + "sheet").First();
        var rid = sheet.Attribute(rel + "id")!.Value;
        XNamespace pr = "http://schemas.openxmlformats.org/package/2006/relationships";
        var target = Load("xl/_rels/workbook.xml.rels").Root!.Elements(pr + "Relationship").First(r => r.Attribute("Id")!.Value == rid).Attribute("Target")!.Value;
        var sheetPath = target.StartsWith('/') ? target.TrimStart('/') : "xl/" + target;

        var rows = new List<List<string>>();
        foreach (var row in Load(sheetPath).Descendants(ns + "row"))
        {
            var cells = new List<string>();
            foreach (var c in row.Elements(ns + "c"))
            {
                var col = ColIndex(c.Attribute("r")?.Value ?? "");
                while (cells.Count < col) cells.Add("");
                var t = c.Attribute("t")?.Value;
                var v = c.Element(ns + "v")?.Value ?? "";
                string val = t switch
                {
                    "s" => int.TryParse(v, out var i) && i < shared.Count ? shared[i] : "",
                    "inlineStr" => string.Concat(c.Descendants(ns + "t").Select(x => x.Value)),
                    _ => v,
                };
                if (col >= 0 && col < cells.Count) cells[col] = val; else cells.Add(val);
            }
            rows.Add(cells);
        }
        return rows;
    }

    static int ColIndex(string cellRef)
    {
        int n = 0;
        foreach (var ch in cellRef) { if (!char.IsLetter(ch)) break; n = n * 26 + (char.ToUpperInvariant(ch) - 'A' + 1); }
        return n - 1;
    }
}
