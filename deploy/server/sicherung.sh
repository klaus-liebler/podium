#!/usr/bin/env bash
# Online-Sicherung der Podium-Datenbank und der hochgeladenen Musik (konsistent auch bei laufendem Dienst), 14 Tage aufbewahren, mit Integritätsprüfung.
# Ziel: /opt/podium-werkzeuge/sicherung.sh (schritte/einrichten.sh), läuft als Benutzer podium über podium-sicherung.timer.
set -euo pipefail
DB=/var/lib/podium/podium.db
ZIEL=/var/backups/podium
[[ -f "$DB" ]] || { echo "keine Datenbank – nichts zu sichern"; exit 0; }
datei="$ZIEL/podium-$(date +%Y%m%d-%H%M%S).db"
sqlite3 "$DB" ".backup '$datei'"
[[ "$(sqlite3 "$datei" 'PRAGMA integrity_check;')" == "ok" ]] || { echo "Sicherung $datei ist beschädigt" >&2; exit 1; }
find "$ZIEL" -name 'podium-*.db' -mtime +14 -delete
echo "gesichert: $datei"
# Eigene Musik der Dozierenden (Musikmanager): Spiegel ergänzen (Dateinamen sind eindeutig, gelöschte bleiben in der Sicherung)
if [[ -d /var/lib/podium/musik ]]; then mkdir -p "$ZIEL/musik"; cp -a --update /var/lib/podium/musik/. "$ZIEL/musik/"; echo "Musik gesichert: $ZIEL/musik"; fi
