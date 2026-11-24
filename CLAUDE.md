# Podium – Projektregeln

## Änderungen nach SchoolCraft und VibeVHS portieren

Podium ist in zwei weitere Projekte integriert. **Jede Änderung hier muss geprüft und, wo betroffen, dorthin portiert werden**
(im selben Arbeitsgang, mit eigenem Commit im jeweiligen Repository):

- **SchoolCraft** (`C:\repos\schoolcraft`): hat Leinwand, Handy-Ansicht und Spielablauf übernommen – Herkunft und Abweichungen
  in `podium/HERKUNFT.md` (Stand-Commit dort nachziehen).
  - `web/src` (ohne Dozentenbereich, Editor, Anmeldung, Musikmanager) → `schoolcraft/podium/web/src`, gebaut nach
    `src/SchoolCraft.Web/wwwroot/podium` (Build-Ergebnis ist dort eingecheckt: nach dem Portieren `npm run build`).
  - `Game/*.cs` → `src/SchoolCraft.Web/Podium/` (eigene Anpassungen: Beitritt mit Konto, Speichern über den Quizdienst).
  - Quizformat (`QuizDto`, Export `podium-*.json`) → `QuizDienst.AusPodium/ExportierenAsync` und SchoolCrafts eigener
    Quiz-Editor; Import/Export muss kompatibel bleiben. Neue Felder dort in Domain, Datenbank und Editor ergänzen.
  - Keine Suno-Lieder, keine Google Fonts.
- **VibeVHS** (`C:\repos\vibevhs`): bindet Podium als eingebaute Unterrichts-App per Adresse ein (`Podium:Adresse`,
  `UnterrichtsappDienst`, `Unterrichtsapp.cs`). Betroffen nur, wenn sich Adressen/Routen (`#/…`), der Einstieg oder die
  Beschreibung von Podium ändern.

Was nicht portiert werden muss (z. B. Podiums eigener Editor für VibeVHS), kurz im Commit vermerken.

## Sonstiges

- Oberfläche: Vite + Lit + TypeScript, Single-File-Build (`web/`), Typprüfung `npx tsc --noEmit` in `web/`.
- Datenbank: SQLite ohne Migrationen – Schemaänderungen in `AppDb.EnsureSchemaUpgrades` (`Data/Models.cs`).
- Suno-Lieder (kostenloser Tarif) nie ins Repository (siehe `.gitignore`, `web/public/music/CREDITS.md`).
- Ausrollen: `deploy/server/deploy.ps1` (Fehlermeldung „Connection … closed“ von ssh ist harmlos – danach `gesund` prüfen).
