# Start the API bound to 127.0.0.1 on an OS-assigned free port.
# Manages ONLY this project: pid/port are recorded in ./.server.pid.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot/..
if (Test-Path .server.pid) {
  $existing = Get-Content .server.pid -Raw | ConvertFrom-Json
  if (Get-Process -Id $existing.pid -ErrorAction SilentlyContinue) {
    Write-Host "Server already running: http://127.0.0.1:$($existing.port) (pid $($existing.pid))"
    exit 0
  }
  Remove-Item .server.pid -Force
}
$out = "data/server.out.log"
$err = "data/server.err.log"
New-Item -ItemType Directory -Force data | Out-Null
$p = Start-Process -FilePath "node" `
  -ArgumentList "--experimental-sqlite","--import","tsx","src/api/start.ts" `
  -WorkingDirectory (Get-Location) `
  -RedirectStandardOutput $out -RedirectStandardError $err `
  -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
$line = Get-Content $out -ErrorAction SilentlyContinue | Select-String "listening on" | Select-Object -First 1
if ($line) { Write-Host $line.Line } else { Write-Host "Started pid $($p.Id); see $out / $err" }

