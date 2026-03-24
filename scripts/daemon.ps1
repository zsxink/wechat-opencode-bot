# wechat-opencode-bot Windows Daemon Manager
# Supports: PowerShell 5.1+

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("start", "stop", "restart", "status", "logs")]
    [string]$Command = ""
)

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ProjectDir
$DataDir = Join-Path $env:USERPROFILE ".wechat-opencode-bot"
$PidFile = Join-Path $DataDir "daemon.pid"

function Write-Log {
    param([string]$Message)
    Write-Host $Message
}

function Ensure-DataDir {
    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir | Out-Null
    }
    $logsDir = Join-Path $DataDir "logs"
    if (-not (Test-Path $logsDir)) {
        New-Item -ItemType Directory -Path $logsDir | Out-Null
    }
}

function Get-Status {
    if (-not (Test-Path $PidFile)) {
        return $null
    }
    $pid = Get-Content $PidFile -Raw -ErrorAction SilentlyContinue
    if (-not $pid) { return $null }
    $pid = $pid.Trim()
    if ([string]::IsNullOrEmpty($pid)) { return $null }
    
    $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if ($process) {
        return $pid
    }
    return $null
}

switch ($Command) {
    "start" {
        $existing = Get-Status
        if ($existing) {
            Write-Log "Already running (PID: $existing)"
            exit 0
        }

        Ensure-DataDir
        $stdoutLog = Join-Path $DataDir "logs\stdout.log"
        $stderrLog = Join-Path $DataDir "logs\stderr.log"

        $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
        if (-not $nodePath) {
            Write-Log "Error: node not found in PATH"
            exit 1
        }

        $mainJs = Join-Path $ProjectDir "dist\main.js"
        if (-not (Test-Path $mainJs)) {
            Write-Log "Error: dist/main.js not found. Run 'npm run build' first."
            exit 1
        }

        $process = Start-Process -FilePath $nodePath -ArgumentList $mainJs, "start" -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
        
        Start-Sleep -Milliseconds 500
        
        if (-not $process.HasExited) {
            $process.Id | Set-Content $PidFile -ErrorAction SilentlyContinue
            Write-Log "Daemon started (PID: $($process.Id))"
            Write-Log "Logs: $DataDir\logs\"
        } else {
            Write-Log "Failed to start daemon"
            exit 1
        }
    }

    "stop" {
        $pid = Get-Status
        if (-not $pid) {
            Write-Log "Not running"
            exit 0
        }

        try {
            Stop-Process -Id $pid -Force -ErrorAction Stop
            Write-Log "Stopped (PID: $pid)"
        } catch {
            Write-Log "Could not stop process: $_"
        }
        
        if (Test-Path $PidFile) {
            Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        }
    }

    "restart" {
        & $MyInvocation.PSCommandPath -Command "stop"
        Start-Sleep -Seconds 1
        & $MyInvocation.PSCommandPath -Command "start"
    }

    "status" {
        $pid = Get-Status
        if ($pid) {
            Write-Log "Running (PID: $pid)"
        } else {
            Write-Log "Not running"
        }
    }

    "logs" {
        $stdoutLog = Join-Path $DataDir "logs\stdout.log"
        $stderrLog = Join-Path $DataDir "logs\stderr.log"
        
        if (-not (Test-Path $stdoutLog)) {
            Write-Log "No logs found"
            exit 0
        }

        Write-Log "=== Recent logs (stdout) ==="
        Get-Content $stdoutLog -Tail 50 -ErrorAction SilentlyContinue
        
        if (Test-Path $stderrLog) {
            Write-Log ""
            Write-Log "=== Errors (stderr) ==="
            Get-Content $stderrLog -Tail 50 -ErrorAction SilentlyContinue
        }
    }

    default {
        Write-Log "Usage: .\daemon.ps1 [-Command] <start|stop|restart|status|logs>"
        Write-Log ""
        Write-Log "Commands:"
        Write-Log "  start   - Start the daemon"
        Write-Log "  stop    - Stop the daemon"
        Write-Log "  restart - Restart the daemon"
        Write-Log "  status  - Check daemon status"
        Write-Log "  logs    - View recent logs"
    }
}
