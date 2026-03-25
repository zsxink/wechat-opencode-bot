@echo off
cd /d "%~dp0\.."
powershell.exe -WindowStyle Hidden -Command "node dist/main.js --daemon"
