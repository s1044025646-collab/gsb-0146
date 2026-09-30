# Stop the API started by scripts/start.ps1 using this project's ./.server.pid.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot/..
if (-not (Test-Path .server.pid)) { Write-Host "No .server.pid; nothing to stop."; exit 0 }
$info = Get-Content .server.pid -Raw | ConvertFrom-Json
if (Get-Process -Id $info.pid -ErrorAction SilentlyContinue) {
  Stop-Process -Id $info.pid
  Write-Host "Stopped pid $($info.pid) (was http://127.0.0.1:$($info.port))."
} else {
  Write-Host "Process $($info.pid) not running."
}
Remove-Item .server.pid -Force
