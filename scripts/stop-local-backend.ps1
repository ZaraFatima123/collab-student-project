$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$backendState = Get-Content -LiteralPath (Join-Path $workspacePath '.local-backend.json') -Raw | ConvertFrom-Json
$backendProcessId = [int]$backendState.pid
if ($backendProcessId -le 0 -or $backendState.entry -ne 'dist/src/server.js') { throw 'Unexpected backend state file' }
$backendProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $backendProcessId"
if (!$backendProcess) { Write-Output 'The recorded backend process is already stopped.'; exit 0 }
$recordedStart = [DateTime]::Parse($backendState.startedAt).ToUniversalTime()
$actualStart = $backendProcess.CreationDate.ToUniversalTime()
if ($backendProcess.Name -ne 'node.exe' -or $backendProcess.CommandLine -notmatch 'dist[/\\]src[/\\]server\.js' -or [Math]::Abs(($actualStart - $recordedStart).TotalSeconds) -gt 5) {
  throw 'The PID no longer matches the recorded backend. No process was stopped.'
}
Stop-Process -Id $backendProcessId
Write-Output 'Local backend stopped. Persistent PostgreSQL and its data were left intact.'
