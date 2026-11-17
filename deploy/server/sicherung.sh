#!/usr/bin/env bash
# Online-Sicherung der Podium-Datenbank (konsistent auch bei laufendem Dienst), 14 Tage aufbewahren, mit Integritätsprüfung.
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
