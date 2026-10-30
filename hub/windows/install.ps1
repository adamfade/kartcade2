# One-time setup on the front PC. Right-click > Run with PowerShell (as administrator).
#   1. Checks Node.js is installed
#   2. Opens port 8787 on the local network so the rigs can reach the hub
#   3. Starts the hub and the TV board automatically when Windows signs in
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8787

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js isn't installed. Install the LTS version from https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS), then run this again." -ForegroundColor Red
  exit 1
}
Write-Host "Node.js $(node -v) found."

$rule = 'Kartcade TV hub'
if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private,Domain | Out-Null
  Write-Host "Opened port $port for the local network."
}
$netCat = (Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory
if ($netCat -eq 'Public') {
  Write-Host "This PC's network is set to Public, which blocks the rigs. Settings > Network > (your network) > Private." -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path (Join-Path $here '..\data') | Out-Null
$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell
foreach ($item in @(@{ n = 'Kartcade TV hub'; t = 'start-hub.vbs' }, @{ n = 'Kartcade TV board'; t = 'start-tv.bat' })) {
  $lnk = $sh.CreateShortcut((Join-Path $startup "$($item.n).lnk"))
  $lnk.TargetPath = Join-Path $here $item.t
  $lnk.WorkingDirectory = $here
  if ($item.t -like '*.bat') { $lnk.WindowStyle = 7 }
  $lnk.Save()
}
Write-Host "Hub and TV board will start when Windows signs in."

Start-Process wscript.exe -ArgumentList "`"$(Join-Path $here 'start-hub.vbs')`""
Start-Sleep 3
Start-Process (Join-Path $here 'start-tv.bat')
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.)' } | Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "Done. This PC's address: $ip" -ForegroundColor Green
Write-Host "Rigs: set LOCAL_URL = http://${ip}:$port in each rig's config.ini"
Write-Host "Control page (phone on the shop Wi-Fi): http://${ip}:$port/control"
