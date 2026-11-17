# Podium – Live-Quiz für die Lehre

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
| `web/public/models/` | CC0-3D-Modelle von Kenney (Figuren, Natur, Stadt, Weltraum, Arena, Möbel) |
| `web/src/three/themes/` | 3D-Welten: Gameshow-Studio, Campus-Insel, Weltraum-Arena, Stadion, Apfelwiese, Osnabrück |
| `deploy/` | Bereitstellung auf liebler.iui.hs-osnabrueck.de (systemd, nginx-Schema `liebler.d/`, Sicherung) |

## Anmeldung

Dozierende melden sich mit eigenem Konto an (PBKDF2-Hash, Cookie, Sperre nach Fehlversuchen); jede·r sieht nur die eigenen
Quizze. Solange die Datenbank kein Konto enthält, zeigt die Anmeldeseite die **Ersteinrichtung**: Dort legt man
einmalig das Admin-Konto an (wie bei evcc, kein Passwort in Konfiguration oder Log). Weitere Konten per **Einladungslink** (👥 Benutzer), Passwort vergessen
per **Passwort-Link**. Studierende brauchen keine Anmeldung.

Betrieb unter einem Unterpfad: `PathBase=/podium`, `PublicBaseUrl=https://…/podium`. Server-Bereitstellung: [deploy/README.md](deploy/README.md).

## Routen (Hash)

`#/` Dozentenbereich · `#/edit/<id>` Editor · `#/host/<pin>/<key>` Leinwand · `#/join/<pin>` Handy · `#/ask/<pin>` anonyme Live-Fragerunde · `#/login` · `#/invite/<token>` · `#/account` · `#/users`

## Leinwand-Tastatur

Leertaste/Enter/→ = weiter · D = Direktfrage · M = Ton · F = Vollbild

## Lizenz

Code: MIT (siehe `LICENSE`). Musik und 3D-Modelle: CC0 bzw. gemeinfrei (Ausnahme: der mit Suno erstellte Sieger-Song), Nachweise in `web/public/music/CREDITS.md` und `web/public/models/KENNEY-LICENSE.txt`.
