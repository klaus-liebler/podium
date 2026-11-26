# Podium auf liebler.iui.hs-osnabrueck.de

Ziel: **https://liebler.iui.hs-osnabrueck.de/podium/** – hinter dem nginx, den das VibeVHS-Kit eingerichtet hat
(Hochschulzertifikat, Reverse Proxy). Aufbau wie bei VibeVHS: framework-abhängiger Linux-Build (gemeinsame ASP.NET-Core-Runtime aus VibeVHS-Schritt 09; `-MitRuntime` = self-contained), eigener Dienstbenutzer,
Kestrel nur lokal, Ausrollen mit Sicherung und automatischem Rückweg. **Jeden Schritt startet Klaus selbst.**

| | |
|---|---|
| Programm | `/opt/podium` (vorige Version: `/opt/podium.vorher`) · Dienst `podium.service`, Benutzer `podium` |
| Daten | `/var/lib/podium/podium.db` (SQLite), Cookie-Schlüssel `/var/lib/podium/schluessel`, eigene Musik der Dozierenden `/var/lib/podium/musik` (Uploads bis 30 MB je Datei – nginx `client_max_body_size 130m`), Bilder in Fragen `/var/lib/podium/bilder` (bis 5 MB je Bild) |
| Sicherungen | `/var/backups/podium` – täglich 01:45 (`podium-sicherung.timer`) und vor jedem Update, siehe [Sicherung](#sicherung) |
| Geheimnisse | nur `/etc/podium/podium.env` (root:podium, 0640) – nie im Repository |
| Port | `127.0.0.1:5090` (nur lokal), nach außen nginx `location /podium/` mit WebSockets (SignalR) |
| Zugang | **kein** nginx-Passwort: Studierende treten per QR ohne Anmeldung bei; Dozentenbereich mit Konten in der App |

## 1 · Kit hochladen (Entwicklungsrechner, im VPN)

```powershell
.\deploy\server\deploy.ps1 -NurKit
```

## 2 · Einrichten (einmalig)

```powershell
ssh -t liebler "sudo bash /tmp/podium-kit/schritte/einrichten.sh"
```

Legt Benutzer, Verzeichnisse, `/etc/podium/podium.env`, `podium.service` und den Sicherungs-Timer an, kopiert
`nginx/podium.conf` nach `/etc/nginx/snippets/` und fügt in `/etc/nginx/sites-available/liebler.conf` direkt nach
`include …/liebler-zertifikat.conf;` die Zeile `include /etc/nginx/snippets/podium.conf;` ein (mit Sicherung, `nginx -t`,
bei Fehler zurück).

**Wichtig:** Dieselbe Zeile dauerhaft in `vibevhs/deploy/server/nginx/liebler.conf` übernehmen – sonst entfernt ein
erneuter VibeVHS-Schritt 03 sie wieder.

**Erstes Admin-Konto:** Kein Passwort in `podium.env`. Solange die Datenbank kein Konto enthält, zeigt
`https://liebler.iui.hs-osnabrueck.de/podium/` die **Ersteinrichtung** – dort einmalig Benutzername und Passwort des
Admin-Kontos festlegen (wie bei evcc) und gleich danach den zweiten Faktor mit einer Authenticator-App einrichten (Pflicht für
Admins; Wiederherstellungscodes sicher ablegen). Danach ist die Ersteinrichtung gesperrt. Weil bis dahin jede·r mit Zugang zur Seite
das Konto anlegen könnte: **direkt nach dem ersten Ausrollen** erledigen (`ausrollen.sh` erinnert daran).

## 3 · Ausrollen (jetzt und bei jedem Update)

```powershell
.\deploy\server\deploy.ps1
```

Baut die Oberfläche (`web`, `npm run build`) und das Programm (linux-x64, framework-abhängig), lädt hoch, sichert die
Datenbank, ersetzt `/opt/podium` und prüft `http://127.0.0.1:5090/podium/gesund`. Antwortet die neue Version nicht,
kommt die vorige automatisch zurück. Von Hand zurück: `ssh -t liebler "sudo bash /tmp/podium-kit/schritte/ausrollen.sh --zurueck"`.

> Laufende Spiele liegen im Arbeitsspeicher – **nicht während einer Vorlesung ausrollen.**

Die Datenbank wird beim Start automatisch ergänzt (neue Tabellen/Spalten); bestehende Daten bleiben erhalten.

## Prüfen

- `https://liebler.iui.hs-osnabrueck.de/podium/` → Anmeldeseite
- Quiz starten → QR-Code zeigt `https://liebler.iui.hs-osnabrueck.de/podium/#/join/…`, mit dem Handy (auch ohne VPN) beitreten
- `ssh liebler "systemctl status podium podium-sicherung.timer"` · Logs: `journalctl -u podium -f`

## Kolleg·innen einladen

Als Admin: **👥 Benutzer → Einladungslink erzeugen** (gültig 3–30 Tage, nur einmal verwendbar, optional mit Admin-Rechten).
Den Link per Mail schicken; die Kollegin legt damit Benutzername und Passwort selbst an. Passwort vergessen →
**Passwort-Link** beim Konto. Die Tokens stehen hinter `#` in der Adresse und erreichen daher nie ein Server-Log; in der
Datenbank liegt nur ihr SHA-256.

## Sicherung

`sicherung.sh` (installiert als `/opt/podium-werkzeuge/sicherung.sh`) läuft täglich um 01:45 und vor jedem Update:

| Was | Ziel in `/var/backups/podium` | Aufbewahrung |
|---|---|---|
| Datenbank | `podium-<datum>-<zeit>.db` (Online-Sicherung, Integritätsprüfung) | **14 Tage**, ältere werden gelöscht |
| Schlüssel (Cookies, TOTP-Geheimnisse, SAML-Zertifikat) | `schluessel/` | nur der aktuelle Stand – ohne ihn müssen alle den zweiten Faktor neu einrichten |
| Musik | `musik/` (fortlaufender Spiegel) | **unbegrenzt** – neue Dateien kommen dazu, auf dem Server gelöschte bleiben im Spiegel |
| Bilder in Fragen | `bilder/` (fortlaufender Spiegel) | **unbegrenzt**, wie Musik |

Die Spiegel löschen bewusst nichts: Jede der 14 Datenbank-Sicherungen kann auf Musik oder Bilder verweisen, die inzwischen
gelöscht wurden – nach einer Rücksicherung sind sie so noch vorhanden. Folge: Die Spiegel wachsen, und gelöschte Dateien
verschwinden nicht aus der Sicherung.

Die Sicherung liegt auf demselben Server; gegen Platten- oder Serververlust schützt sie nicht (dafür `/var/backups/podium`
zusätzlich extern kopieren).

**Achtung:** `deploy.ps1` spielt `sicherung.sh` nicht neu ein (nur `schritte/einrichten.sh`). Nach einer Änderung am Skript:
`ssh liebler "sudo install -m 0755 /tmp/podium-kit/sicherung.sh /opt/podium-werkzeuge/sicherung.sh"` (nach `deploy.ps1 -NurKit`).

## Rücksicherung

```bash
sudo systemctl stop podium
sudo -u podium cp /var/backups/podium/podium-<datum>.db /var/lib/podium/podium.db   # -wal/-shm vorher beiseitelegen
sudo -u podium cp -a --update /var/backups/podium/bilder/. /var/lib/podium/bilder/    # fehlende Bilder zurück (falls nötig)
sudo -u podium cp -a --update /var/backups/podium/musik/. /var/lib/podium/musik/      # fehlende Musik zurück (falls nötig)
sudo systemctl start podium
```

## Abschalten

`ssh -t liebler "sudo bash /tmp/podium-kit/schritte/einrichten.sh --zurueck"` – Dienst aus, nginx-Zeile raus, Daten bleiben.
