# Shared by run.ps1 and installer.ps1: messages, and making sure Node.js and the npm packages are there.
# Expects $ManagerDir to be set by the script that dot-sources it. Must run in Windows PowerShell 5.1 as well as 7.

$NodeMinMajor = 23
$NodeMinMinor = 6

function Write-Badge([string]$Text, [string]$Fore, [string]$Back, [string]$Message) {
  Write-Host "  " -NoNewline
  Write-Host " $Text " -ForegroundColor $Fore -BackgroundColor $Back -NoNewline
  Write-Host "  $Message"
}

function Stop-Script([string]$Message) {
  Write-Host ""
  Write-Badge "STOPPED" White DarkRed $Message
  Write-Host ""
  exit 1
}

function Write-Note([string]$Message) { Write-Host "  $Message" -ForegroundColor DarkGray }

function Test-Interactive { return [Environment]::UserInteractive -and -not [Console]::IsInputRedirected }

# Asks a question that defaults to yes; no without a console to answer in.
function Read-Yes([string]$Question) {
  if (-not (Test-Interactive)) { return $false }
  $reply = Read-Host "  $Question [Y/n]"
  return [string]::IsNullOrWhiteSpace($reply) -or $reply -match '^[Yy]'
}

# The installed Node version (23.6.0), or "".
function Get-NodeVersion {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return "" }
  try { return ((& node -p "process.versions.node") | Out-String).Trim() } catch { return "" }
}

function Test-NodeVersion([string]$Version) {
  if ($Version -notmatch '^(\d+)\.(\d+)') { return $false }
  $major = [int]$Matches[1]
  $minor = [int]$Matches[2]
  return ($major -gt $NodeMinMajor) -or ($major -eq $NodeMinMajor -and $minor -ge $NodeMinMinor)
}

# A program winget just installed is on the saved PATH, not yet on this window's.
function Update-PathFromRegistry {
  $parts = @([Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::GetEnvironmentVariable("Path", "User")) | Where-Object { $_ }
  $env:Path = $parts -join ";"
}

function Show-ManualInstall {
  Write-Host ""
  Write-Note "Install Node.js $NodeMinMajor.$NodeMinMinor or newer, then run this again:"
  Write-Note "  winget install OpenJS.NodeJS.LTS"
  Write-Note "  or the Windows installer from https://nodejs.org/en/download"
  Stop-Script "Node.js $NodeMinMajor.$NodeMinMinor or newer is required."
}

function Confirm-Node {
  $version = Get-NodeVersion
  if (Test-NodeVersion $version) { return }
  Write-Host ""
  if ($version) {
    Write-Badge "CHECK" Black DarkYellow "Node.js $version is installed, but the manager needs $NodeMinMajor.$NodeMinMinor or newer."
  } else {
    Write-Badge "CHECK" Black DarkYellow "Node.js is not installed. The manager runs on Node.js $NodeMinMajor.$NodeMinMinor or newer."
  }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Show-ManualInstall }
  if (-not (Read-Yes "Install Node.js with winget (winget install OpenJS.NodeJS.LTS)?")) { Show-ManualInstall }
  # winget also exits non-zero when there is nothing newer to install, so the version decides.
  & winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  Update-PathFromRegistry
  $version = Get-NodeVersion
  if (-not (Test-NodeVersion $version)) {
    if (-not $version) { $version = "none" }
    Stop-Script "Node.js $NodeMinMajor.$NodeMinMinor or newer is still not found (found: $version). Open a new window and run this again, or install it from https://nodejs.org."
  }
  Write-Badge "READY" Black DarkGreen "Node.js $version"
}

# Installs the npm packages when they are missing or older than package.json.
function Confirm-Packages {
  $stamp = Join-Path $ManagerDir "node_modules\.package-lock.json"
  $package = Join-Path $ManagerDir "package.json"
  $lock = Join-Path $ManagerDir "package-lock.json"
  if (Test-Path -LiteralPath $stamp) {
    $installed = (Get-Item -LiteralPath $stamp -Force).LastWriteTimeUtc
    $lockOk = -not (Test-Path -LiteralPath $lock) -or (Get-Item -LiteralPath $lock -Force).LastWriteTimeUtc -le $installed
    if ((Get-Item -LiteralPath $package -Force).LastWriteTimeUtc -le $installed -and $lockOk) { return }
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Stop-Script "npm is missing. Reinstall Node.js, which includes it." }
  Write-Note "Installing the manager's packages..."
  Push-Location -LiteralPath $ManagerDir
  try {
    # npm ci installs exactly what package-lock.json lists and leaves it unchanged, so a git clone stays clean for updates.
    if (Test-Path -LiteralPath $lock) {
      & npm.cmd ci --no-audit --no-fund --loglevel=error
      if ($LASTEXITCODE -eq 0) { return }
    }
    & npm.cmd install --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { Stop-Script "npm install failed." }
  } finally {
    Pop-Location
  }
}
