#!/usr/bin/env bash
# Podium einrichten (einmalig, idempotent): Dienstbenutzer, Verzeichnisse, Umgebung, systemd-Dienst, Sicherungs-Timer,
# nginx-Datei /etc/nginx/liebler.d/podium.conf (gemeinsames Schema, siehe schritte/liebler-nginx.sh). Die Anwendung selbst bringt deploy.ps1 (danach: ausrollen.sh).
# Voraussetzung: nginx als Reverse Proxy mit /etc/nginx/sites-available/liebler.conf (aus dem VibeVHS-Kit, Schritt 03).
# Start:   ssh -t liebler "sudo bash /tmp/podium-kit/schritte/einrichten.sh"
# Rückweg: sudo bash /tmp/podium-kit/schritte/einrichten.sh --zurueck   (Dienst aus, nginx-Zeile raus; Daten bleiben)
source "$(dirname "$0")/gemeinsam.sh"
source "$(dirname "$0")/liebler-nginx.sh"
als_root

if [[ "${1:-}" == "--zurueck" ]]; then
    systemctl disable --now podium podium-sicherung.timer 2>/dev/null || true
    liebler_app_entfernen podium
    ok "Podium abgeschaltet (Daten in /var/lib/podium und Sicherungen bleiben erhalten)"
    exit 0
fi

# ---------- Voraussetzungen
command -v nginx >/dev/null && systemctl is-active --quiet nginx || fehler "nginx läuft nicht – erst VibeVHS-Kit Schritt 03 (nginx statt Apache)."
[[ -f "$LIEBLER_SITE" ]] || fehler "$LIEBLER_SITE fehlt – erst VibeVHS-Kit Schritt 03 (nginx-Grundgerüst)."
command -v sqlite3 >/dev/null || { info "sqlite3 installieren (für Sicherungen)"; apt-get install -y sqlite3 >/dev/null; }
if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet podium; then
    fehler "Port $PORT ist schon belegt: $(ss -ltnpH "sport = :$PORT")"
fi

# ---------- Benutzer und Verzeichnisse
id podium >/dev/null 2>&1 || { useradd --system --home-dir /var/lib/podium --shell /usr/sbin/nologin podium; ok "Dienstbenutzer podium angelegt"; }
install -d -o root   -g root   -m 0755 /opt/podium /opt/podium-werkzeuge
install -d -o podium -g podium -m 0750 /var/lib/podium /var/lib/podium/schluessel /var/backups/podium
install -d -o root   -g podium -m 0750 /etc/podium
if [[ ! -f /etc/podium/podium.env ]]; then
    install -o root -g podium -m 0640 "$KIT/podium.env.beispiel" /etc/podium/podium.env
    ok "/etc/podium/podium.env angelegt – erstes Admin-Konto dort festlegen (nie ins Repository)"
fi

# ---------- systemd
neu=0
einspielen systemd/podium.service /etc/systemd/system/podium.service && neu=1 || true
einspielen systemd/podium-sicherung.service /etc/systemd/system/podium-sicherung.service && neu=1 || true
einspielen systemd/podium-sicherung.timer /etc/systemd/system/podium-sicherung.timer && neu=1 || true
einspielen sicherung.sh /opt/podium-werkzeuge/sicherung.sh 0755 || true
(( neu )) && systemctl daemon-reload
systemctl enable podium >/dev/null 2>&1
systemctl enable --now podium-sicherung.timer >/dev/null 2>&1
ok "Dienst podium und Sicherungs-Timer (täglich 01:45) aktiviert"

# ---------- nginx: eigene Datei /etc/nginx/liebler.d/podium.conf (die Einträge anderer Apps bleiben unberührt)
rm -f /etc/nginx/snippets/podium.conf   # frühere Ablage (vor liebler.d)
liebler_app_setzen podium "$KIT/nginx/podium.conf"

# ---------- Start (falls schon ausgerollt)
if [[ -x /opt/podium/Podium ]]; then
    systemctl restart podium
    gesund 60 && ok "Podium läuft: $(curl -fsS "$GESUND")" || { journalctl -u podium -n 30 --no-pager | sed 's/^/   /'; fehler "Podium antwortet nicht"; }
else
    warn "Noch keine Anwendung in /opt/podium – jetzt vom Entwicklungsrechner ausrollen:  .\\deploy\\server\\deploy.ps1"
fi
ok "Einrichtung fertig"
