# Podium – Live-Quiz für die Lehre

**Aus dem Hörsaal wird eine Gameshow.** Podium ist ein Live-Quiz für Vorlesung, Seminar und Klassenzimmer: Die Fragen
laufen auf der Leinwand in einer animierten 3D-Welt mit Musik. Die Teilnehmenden spielen mit dem Handy mit, ganz ohne
App und ohne Anmeldung. Jede Person steht mit einer selbst gestalteten Figur auf der Bühne, und am Ende werden die drei
Besten auf dem Siegerpodest gefeiert, mit Konfetti und eigenem Sieger-Song.

Podium läuft auf dem eigenen Server. Die Daten der Teilnehmenden verlassen die Hochschule nicht, und Studierende spielen
nur mit einem selbst gewählten Spitznamen mit.

![Siegerehrung im Gameshow-Studio](docs/screenshots/siegerehrung.jpg)

### Das kann Podium

- 📱 **Beitreten in Sekunden:** QR-Code scannen oder PIN eingeben, Spitznamen wählen, fertig. Keine App, kein Konto.
- 🎭 **Eigene Figur:** Figur und Kopfbedeckung aussuchen. Die Figur steht live in der 3D-Welt auf der Leinwand.
- 🌍 **Sieben 3D-Welten:** Gameshow-Studio, Campus-Insel, Weltraum-Arena, Stadion, Apfelwiese, Osnabrück und die
  *Ruhige Bühne*. Die Ruhige Bühne kommt ohne Bewegung, Lichteffekte und Konfetti aus, für alle, die es ruhiger mögen.
- 🎵 **Musik mit Spannungsbogen:** Warteraum-Musik, tickende Stoppuhr, Fanfaren, Konfetti und Sieger-Songs. Im
  Musikmanager lässt sich jeder Abschnitt mit eigener Musik belegen, auch mit hochgeladenen Stücken.
- ⚡ **Direktfragen jederzeit:** Spontan nachfragen, auch mitten im Quiz: Ja/Nein, „Verstanden?“, Skala, Schätzfrage
  oder ein Wort für die Word Cloud. Die Antworten sind anonym und erscheinen auf Wunsch live.
- 🏆 **Punkte für Tempo und Serien:** Wer schnell und richtig antwortet, sammelt mehr Punkte. Zwischenstände halten
  die Spannung hoch, am Ende gibt es eine Statistik zu jeder Frage.
- 📥 **Vorhandene Quizze übernehmen:** Import per Kahoot-Link, Kahoot-Tabellenvorlage (.xlsx), CSV oder JSON. Export
  als JSON.
- 🗂️ **Ordnung für viele Kurse:** Quizze in Ordnern, Editor mit 2 bis 6 Antworten je Frage, Zeitlimit und doppelten
  Punkten.
- 👥 **Für das ganze Kollegium:** Eigene Konten mit Einladungslinks, jede Person sieht nur ihre eigenen Quizze.
- 👀 **Szenen-Vorschau:** Jede Welt lässt sich mit 20 simulierten Teilnehmenden ansehen, bevor es ernst wird.

### So läuft eine Runde

| Warteraum | Frage | Lösung |
|---|---|---|
| ![Warteraum mit QR-Code und Figuren](docs/screenshots/warteraum.jpg) | ![Frage mit Countdown](docs/screenshots/frage.jpg) | ![Auflösung mit Antwortverteilung](docs/screenshots/loesung.jpg) |
| Alle scannen den QR-Code, die Figuren laufen auf die Bühne. | Countdown, Musik und Live-Zähler der Antworten. | Antwortverteilung, Trefferquote und durchschnittliche Antwortzeit. |

### Die Welten

| | | |
|---|---|---|
| ![Campus-Insel](docs/screenshots/welt-campus.jpg) | ![Weltraum-Arena](docs/screenshots/welt-space.jpg) | ![Stadion](docs/screenshots/welt-stadium.jpg) |
| 🏫 **Campus-Insel** | 🚀 **Weltraum-Arena** | 🏟️ **Stadion** |
| ![Apfelwiese](docs/screenshots/welt-nature.jpg) | ![Osnabrück](docs/screenshots/welt-osnabrueck.jpg) | ![Ruhige Bühne](docs/screenshots/welt-calm.jpg) |
| 🍎 **Apfelwiese** | ⛪ **Osnabrück** | 🌙 **Ruhige Bühne** |

---

## Technik

Live-Quiz mit Leinwand (3D-Welt, Musik), Handy-Teilnahme per QR-Code, Dozentenbereich und spontanen Direktfragen.

## Voraussetzungen

- .NET SDK 11, Node.js 22+
- Der Single-File-Build nutzt `@klaus-liebler/vite-firmware-single-file` aus
  [klaus-liebler/npm-packages](https://github.com/klaus-liebler/npm-packages) per `file:`-Verweis. Erwartete Ordnerstruktur:

  ```
  repos/
    npm-packages/@klaus-liebler/vite-firmware-single-file
    podium/            ← dieses Repository
  ```

## Starten

```powershell
cd web; npm install; npm run build   # baut die Oberfläche nach ../wwwroot (index.html + index.html.br)
cd ..; dotnet run                    # http://localhost:5158 – lauscht auf allen Netzwerkschnittstellen
                                     # erster Aufruf: Ersteinrichtung legt das Admin-Konto an
```

Handys müssen den Rechner im selben Netz erreichen (ggf. Windows-Firewall für Port 5158 freigeben).
Der QR-Code enthält automatisch die LAN-Adresse; feste Adresse per `PublicBaseUrl` in `appsettings.json` setzen
(z. B. `"PublicBaseUrl": "https://quiz.example.org"`).

Entwicklung mit Hot-Reload: Backend per `dotnet run` starten, dann `cd web; npm run dev` (Port 5173, `/api` und `/hub` werden weitergeleitet).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `Program.cs` | Minimal-API: Quizze, Import/Export, QR-Code, Auslieferung der Single-File-Oberfläche |
| `Game/` | Spiellogik (in-memory), SignalR-Hub, Zustandsobjekte für Leinwand/Handy, DirectMode |
| `Import/QuizImport.cs` | Kahoot-Link, Kahoot-/Podium-JSON, Kahoot-Tabellenvorlage (.xlsx), CSV |
| `Data/` | EF Core + SQLite (`podium.db`): Quizze, gespielte Runden, Direktfragen (anonym) |
| `web/` | Vite + Lit + TypeScript, Single-File-Build (`@klaus-liebler/vite-firmware-single-file`), Three.js tree-geshaked |
| `web/src/three/stage.ts` | gemeinsame 3D-Welt (Lobby → Fragen → Podest) |
| `web/src/audio/engine.ts` | Musik-Decks mit Crossfade, Stoppuhr-Ticken, Spannungskurve, Fanfaren, Effekte |
| `web/public/music/` | CC0-/gemeinfreie Musik (`tracks.json` ordnet Stücke den Stimmungen und Welten zu, Quellen in `CREDITS.md`) |
| `docs/suno-songs.md` | Texte und Stilbeschreibungen der Suno-Stücke für die Siegerehrung (inkl. Entwürfe) |
| `web/public/models/` | CC0-3D-Modelle von Kenney (Figuren, Natur, Stadt, Weltraum, Arena, Möbel) |
| `web/src/three/themes/` | 3D-Welten: Gameshow-Studio, Campus-Insel, Weltraum-Arena, Stadion, Apfelwiese, Osnabrück, Ruhige Bühne (ohne Bewegung und Effekte, für alle, die es ruhiger mögen) |
| `Music/MusicApi.cs`, `web/src/views/music-view.ts` | Musikmanager: Musik je Abschnitt (Warteraum, Fragestellung, Lösung & Statistik, Siegerehrung) pro Konto, eigene Uploads (`musik/` neben der Datenbank, Pfad per `MusicPath`) |
| `web/src/views/preview-sim.ts` | Szenen-Vorschau für Admins: spielt eine Runde mit 20 Beispielteilnehmenden lokal durch |
| `deploy/` | Bereitstellung auf liebler.iui.hs-osnabrueck.de (systemd, nginx-Schema `liebler.d/`, Sicherung) |

## Anmeldung

Dozierende melden sich mit eigenem Konto an (PBKDF2-Hash, Cookie, Sperre nach Fehlversuchen); jede·r sieht nur die eigenen
Quizze. Solange die Datenbank kein Konto enthält, zeigt die Anmeldeseite die **Ersteinrichtung**: Dort legt man
einmalig das Admin-Konto an (wie bei evcc, kein Passwort in Konfiguration oder Log). Weitere Konten per **Einladungslink** (👥 Benutzer), Passwort vergessen
per **Passwort-Link**. Studierende brauchen keine Anmeldung.

Betrieb unter einem Unterpfad: `PathBase=/podium`, `PublicBaseUrl=https://…/podium`. Server-Bereitstellung: [deploy/README.md](deploy/README.md).

## Routen (Hash)

`#/` Dozentenbereich · `#/edit/<id>` Editor · `#/host/<pin>/<key>` Leinwand · `#/join/<pin>` Handy · `#/ask/<pin>` anonyme Live-Fragerunde · `#/music` Musikmanager · `#/preview/<welt>` Szenen-Vorschau (Admin) · `#/login` · `#/invite/<token>` · `#/account` · `#/users`

## Leinwand-Tastatur

Leertaste/Enter/→ = weiter · D = Direktfrage · M = Ton · F = Vollbild

## Lizenz

Code: MIT (siehe `LICENSE`). Musik und 3D-Modelle: CC0 bzw. gemeinfrei (Ausnahme: die mit Suno erstellten Stücke für die Siegerehrung), Nachweise in `web/public/music/CREDITS.md` und `web/public/models/KENNEY-LICENSE.txt`.
