# muOS Anbernic Manager for Windows: starts the manager app (a Node server in src/) on 127.0.0.1 and opens it in
# the browser, like run.sh. Needs Node.js 23.6 or newer; offers to install it with winget when it is missing.
# Start it with run.cmd, which also works by double-click. Same options as run.sh:
# run.cmd [--no-open] [--port N] [--refresh-names] [--refresh-descriptions] [--skip-descriptions] [--root DIR] [-h]

$ErrorActionPreference = "Stop"
$ManagerDir = $PSScriptRoot
. (Join-Path $ManagerDir "scripts\common.ps1")

try { $Host.UI.RawUI.WindowTitle = "muOS Anbernic Manager" } catch {}
Confirm-Node
Confirm-Packages
Set-Location -LiteralPath $ManagerDir
# Exit code 75 is the manager restarting itself after an update; new packages are installed first.
$env:MANAGER_RESTART = "1"
while ($true) {
  & node src/main.ts @args
  $code = $LASTEXITCODE
  if ($code -ne 75) { exit $code }
  Confirm-Packages
}
