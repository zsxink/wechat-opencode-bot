@echo off
cd /d "%~1"
start "" opencode serve --hostname 127.0.0.1 --port 4096
