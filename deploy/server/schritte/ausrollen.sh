#!/usr/bin/env bash
# Neue Podium-Version einspielen (von deploy.ps1 aufgerufen): vorige Version bleibt als /opt/podium.vorher (Rückweg),
# Datenbank-Sicherung vorher, Gesundheitsprüfung danach; bei Fehler automatisch zurück.
# Aufruf:            sudo bash /tmp/podium-kit/schritte/ausrollen.sh /tmp/podium.tar.gz
# Rückweg von Hand:  sudo bash /tmp/podium-kit/schritte/ausrollen.sh --zurueck
# Laufende Spiele (im Speicher) gehen beim Neustart verloren – nicht während einer Vorlesung ausrollen.
source "$(dirname "$0")/gemeinsam.sh"
source "$(dirname "$0")/liebler-dotnet.sh"
als_root

DB=/var/lib/podium/podium.db

if [[ "${1:-}" == "--zurueck" ]]; then
    [[ -d /opt/podium.vorher ]] || fehler "Keine vorige Version vorhanden."
    systemctl stop podium
    rm -rf /opt/podium.defekt && mv /opt/podium /opt/podium.defekt && mv /opt/podium.vorher /opt/podium
    systemctl start podium && gesund && ok "vorige Version läuft wieder" || fehler "auch die vorige Version startet nicht – journalctl -u podium"
    exit 0
fi

id podium >/dev/null 2>&1 && [[ -f /etc/systemd/system/podium.service ]] || fehler "Erst einrichten: sudo bash /tmp/podium-kit/schritte/einrichten.sh – nichts geändert."

archiv="${1:?Pfad zum Archiv fehlt}"
[[ -f "$archiv" ]] || fehler "Archiv $archiv fehlt"
neu=$(mktemp -d /opt/podium.neu.XXXX)
tar -xzf "$archiv" -C "$neu" --strip-components=1
[[ -f "$neu/Podium" ]] || { rm -rf "$neu"; fehler "Archiv enthält kein Podium-Programm"; }
# Framework-abhängiges Paket: passende gemeinsame Runtime vorhanden? (VibeVHS-Schritt 09) – sonst nichts ändern
dotnet_pruefen "$neu" "Podium" || { rm -rf "$neu"; fehler "Ausrollen abgebrochen: Runtime fehlt (siehe oben). Nichts geändert."; }
# Unter Windows gebaute Archive tragen keine Unix-Rechte: hier festlegen
chown -R root:root "$neu"
find "$neu" -type d -exec chmod 755 {} +
find "$neu" -type f -exec chmod 644 {} +
chmod 755 "$neu/Podium"; [[ -f "$neu/createdump" ]] && chmod 755 "$neu/createdump"

if [[ -f "$DB" ]]; then
    ziel="/var/backups/podium/vor-update-$(date +%Y%m%d-%H%M%S).db"
    sqlite3 "$DB" ".backup '$ziel'" && chown podium:podium "$ziel" && ok "Datenbank gesichert: $ziel"
fi

systemctl stop podium 2>/dev/null || true
rm -rf /opt/podium.vorher
[[ -d /opt/podium ]] && mv /opt/podium /opt/podium.vorher
mv "$neu" /opt/podium
start=$(date +%s)
systemctl start podium
if gesund 60; then
    ok "neue Version läuft · $(curl -fsS "$GESUND")"
    rm -f "$archiv"
    if curl -fsS "${GESUND%/gesund}/api/auth/setup" | grep -q '"needed":true'; then
        warn "Noch kein Konto – JETZT https://liebler.iui.hs-osnabrueck.de/podium/ öffnen und das Admin-Konto anlegen (Ersteinrichtung)"
    fi
else
    warn "neue Version antwortet nicht – zurück zur vorigen"
    journalctl -u podium --since "@$start" -n 30 --no-pager | sed 's/^/   /'
    systemctl stop podium
    if [[ -d /opt/podium.vorher ]]; then bash "$0" --zurueck; fi
    fehler "Ausrollen fehlgeschlagen (Datenbank-Sicherung in /var/backups/podium)"
fi
