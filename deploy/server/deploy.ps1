<#
.SYNOPSIS
    Podium auf liebler.iui.hs-osnabrueck.de ausrollen: Oberfläche bauen (Vite, Single-File), self-contained Linux-Build,
    Kit und Archiv hochladen, auf dem Server mit sudo einspielen (vorige Version bleibt als Rückweg, Datenbank-Sicherung
    vorher, Gesundheitsprüfung danach).
.EXAMPLE
    .\deploy\server\deploy.ps1            # bauen + hochladen + einspielen (fragt nach sudo-Passwort)
.EXAMPLE
    .\deploy\server\deploy.ps1 -NurKit    # nur das Kit nach /tmp/podium-kit hochladen (für schritte/einrichten.sh)
.EXAMPLE
    .\deploy\server\deploy.ps1 -NurBauen  # nur bauen (deploy\ausgabe\podium.tar.gz)
#>
param(
    [string] $Ziel = "srvadmin@liebler.iui.hs-osnabrueck.de",
    [string] $Schluessel = "$env:USERPROFILE\.ssh\id_ed25519_liebler_iui_hs_osnabrueck",
    [switch] $NurKit,
    [switch] $NurBauen
)

$ErrorActionPreference = "Stop"
$wurzel = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ausgabe = Join-Path $wurzel "deploy\ausgabe"
$sshArgs = @()
if (Test-Path $Schluessel) { $sshArgs = @("-i", $Schluessel) }

function Kit-Hochladen {
    Write-Host "» Kit nach ${Ziel}:/tmp/podium-kit" -ForegroundColor Cyan
    $kit = Join-Path $ausgabe "podium-kit.tar.gz"
    New-Item -ItemType Directory -Force $ausgabe | Out-Null
    tar -czf $kit -C (Join-Path $wurzel "deploy\server") .
    scp @sshArgs $kit "${Ziel}:/tmp/podium-kit.tar.gz"
    ssh @sshArgs $Ziel "rm -rf /tmp/podium-kit && mkdir -p /tmp/podium-kit && tar -xzf /tmp/podium-kit.tar.gz -C /tmp/podium-kit && rm /tmp/podium-kit.tar.gz && chmod +x /tmp/podium-kit/schritte/*.sh /tmp/podium-kit/sicherung.sh"
}

if ($NurKit) { Kit-Hochladen; return }

# Suno-Lieder sind nicht im Repository (kostenloser Tarif, keine Weiterverbreitung) – sie kommen nur aus der lokalen Kopie
$suno = @("the_final_fanfare.mp3", "podium_gehoert_euch_hsos.mp3", "podium_gehoert_euch_liebler.mp3")
$fehlend = $suno | Where-Object { -not (Test-Path (Join-Path $wurzel "web\public\music\$_")) }
if ($fehlend) {
    Write-Warning ("Suno-Lieder fehlen in web\public\music (nicht im Repository): {0}`nOhne sie bleibt die Siegerehrung auf dem Server ohne Sieger-Song." -f ($fehlend -join ", "))
    if ((Read-Host "Trotzdem ausrollen? (j/n)") -ne "j") { return }
}

Write-Host "» Oberfläche bauen (web → wwwroot)" -ForegroundColor Cyan
Push-Location (Join-Path $wurzel "web")
try {
    if (-not (Test-Path "node_modules")) { npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci fehlgeschlagen." } }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Oberfläche: Build fehlgeschlagen." }
} finally { Pop-Location }

Write-Host "» dotnet publish (linux-x64, self-contained)" -ForegroundColor Cyan
$build = Join-Path $ausgabe "podium"
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
dotnet publish (Join-Path $wurzel "Podium.csproj") -c Release -r linux-x64 --self-contained true -o $build -p:DebugType=None
if ($LASTEXITCODE -ne 0) { throw "Build fehlgeschlagen." }
Remove-Item (Join-Path $build "appsettings.Development.json") -ErrorAction SilentlyContinue
Get-ChildItem $build -Filter "*.db*" | Remove-Item -Force   # lokale Entwicklungsdatenbank nie mitliefern
$archiv = Join-Path $ausgabe "podium.tar.gz"
tar -czf $archiv -C $ausgabe podium
Write-Host ("✓ gebaut: {0} ({1:N1} MB)" -f $archiv, ((Get-Item $archiv).Length / 1MB)) -ForegroundColor Green
if ($NurBauen) { return }

Kit-Hochladen
Write-Host "» Archiv hochladen" -ForegroundColor Cyan
scp @sshArgs $archiv "${Ziel}:/tmp/podium.tar.gz"
Write-Host "» einspielen (sudo fragt nach dem Passwort von srvadmin)" -ForegroundColor Cyan
ssh @sshArgs -t $Ziel "sudo bash /tmp/podium-kit/schritte/ausrollen.sh /tmp/podium.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "Einspielen fehlgeschlagen – Meldung oben (eine vorhandene Version läuft unverändert weiter)." }
Write-Host "✓ ausgerollt: https://liebler.iui.hs-osnabrueck.de/podium/" -ForegroundColor Green
