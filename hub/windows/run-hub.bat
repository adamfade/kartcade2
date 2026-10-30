@echo off
rem Keeps the Kartcade TV hub running. Restarts it 5 seconds after any crash.
cd /d "%~dp0.."
:loop
node server.js >> data\hub.log 2>&1
timeout /t 5 /nobreak >nul
goto loop
