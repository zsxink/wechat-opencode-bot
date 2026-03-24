@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "DATA_DIR=%USERPROFILE%\.wechat-opencode-bot"

if "%1"=="" goto usage
if "%1"=="start" goto start
if "%1"=="stop" goto stop
if "%1"=="restart" goto restart
if "%1"=="status" goto status
if "%1"=="logs" goto logs
goto usage

:usage
echo Usage: daemon.bat [start^|stop^|restart^|status^|logs]
echo.
echo Commands:
echo   start   - Start the daemon
echo   stop    - Stop the daemon
echo   restart - Restart the daemon
echo   status  - Check daemon status
echo   logs    - View recent logs
goto :end

:start
echo Starting wechat-opencode-bot daemon...
if exist "%DATA_DIR%\daemon.pid" (
    set /p PID=<"%DATA_DIR%\daemon.pid"
    tasklist /FI "PID eq %PID%" 2>nul | findstr /I "%PID%" >nul
    if !errorlevel!==0 (
        echo Already running (PID: %PID%)
        goto :end
    )
    del "%DATA_DIR%\daemon.pip" 2>nul
)

if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"

start /b node "%PROJECT_DIR%\dist\main.js" start >> "%DATA_DIR%\logs\stdout.log" 2>> "%DATA_DIR%\logs\stderr.log"
echo Daemon started
echo Logs: %DATA_DIR%\logs\

goto :end

:stop
if not exist "%DATA_DIR%\daemon.pid" (
    echo Not running (no PID file)
    goto :end
)
set /p PID=<"%DATA_DIR%\daemon.pid"
taskkill /PID %PID% /F >nul 2>&1
if %errorlevel%==0 (
    echo Stopped (PID: %PID%)
) else (
    echo Process not found
)
del "%DATA_DIR%\daemon.pid" 2>nul
goto :end

:restart
call :stop
timeout /t 2 /nobreak >nul
call :start
goto :end

:status
if not exist "%DATA_DIR%\daemon.pid" (
    echo Not running
    goto :end
)
set /p PID=<"%DATA_DIR%\daemon.pid"
tasklist /FI "PID eq %PID%" 2>nul | findstr /I "%PID%" >nul
if %errorlevel%==0 (
    echo Running (PID: %PID%)
) else (
    echo Not running (stale PID file)
)
goto :end

:logs
if not exist "%DATA_DIR%\logs\stdout.log" (
    echo No logs found
    goto :end
)
echo === Recent logs ===
type "%DATA_DIR%\logs\stdout.log"
echo.
echo === Errors ===
type "%DATA_DIR%\logs\stderr.log" 2>nul
goto :end

:end
endlocal
