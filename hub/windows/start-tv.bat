@echo off
rem Opens the TV board full screen on the TV (the wireless display).
rem TV_X = how far right the TV screen starts, in pixels. With the TV set to "Extend" to the
rem right of a 1920-wide main screen, that's 1920. Change it if the board opens on the wrong screen.
set TV_X=1920
set URL=http://localhost:8787/tv

rem Wait up to 60 seconds for the hub to start.
for /l %%i in (1,1,30) do (
  powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:8787/health -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" && goto open
  timeout /t 2 /nobreak >nul
)
:open
start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --kiosk %URL% --edge-kiosk-type=fullscreen --no-first-run --user-data-dir="%LOCALAPPDATA%\KartcadeTV" --window-position=%TV_X%,0
