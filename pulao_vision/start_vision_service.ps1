param(
  [switch]$NoRestart,
  [string]$EventId = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $scriptDir ".env"
$logDir = Join-Path $scriptDir "logs"
$restartDelay = 5

function Import-DotEnv {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }

    $name, $value = $line.Split("=", 2)
    $name = $name.Trim()
    $value = $value.Trim().Trim('"').Trim("'")
    if ($name) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

Import-DotEnv -Path $envFile

if ($EventId) {
  $env:VISION_EVENT_ID = $EventId
}

if ($env:VISION_RESTART_DELAY_SECONDS) {
  $restartDelay = [int]$env:VISION_RESTART_DELAY_SECONDS
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location -LiteralPath $scriptDir

do {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] Starting vision service on port $($env:VISION_PORT) event=$($env:VISION_EVENT_ID)"

  $command = "py -3.12 `"$scriptDir\multi_camera_service.py`" 2>&1"
  & cmd.exe /d /c $command |
    Tee-Object -FilePath (Join-Path $logDir "vision_service.log") -Append

  $exitCode = $LASTEXITCODE
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] Vision service exited with code $exitCode"

  if ($NoRestart) {
    exit $exitCode
  }

  Write-Host "Restarting in $restartDelay seconds. Press Ctrl+C to stop."
  Start-Sleep -Seconds $restartDelay
} while ($true)
