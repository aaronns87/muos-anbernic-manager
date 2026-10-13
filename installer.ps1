# muOS Anbernic Manager installer for Windows, like installer.sh: checks Node.js and the manager's packages, creates
# the workspace folders (Roms with a folder per MustardOS system, apps, os, bios, backups), can start from a clean
# cache, and offers a Start menu shortcut. Nothing on the handheld or its cards is touched.
# Start it with installer.cmd, which also works by double-click. Same options as installer.sh.

$ErrorActionPreference = "Stop"
$ManagerDir = $PSScriptRoot
. (Join-Path $ManagerDir "scripts\common.ps1")

function Show-Usage {
  Write-Host @"
Usage: installer.cmd [options]

Sets up the muOS Anbernic Manager on this computer:
  1. checks for Node.js $NodeMinMajor.$NodeMinMinor or newer (offers to install it with winget) and installs the npm packages,
  2. creates the workspace: Roms\ with a folder per MustardOS system, apps\, os\, bios\ and backups\,
  3. optionally starts from a clean cache; the old one is kept as .cache-backup-<date>,
  4. offers a Start menu shortcut with the manager's icon,
  5. optionally starts the manager, which opens the setup wizard on a clean cache.

  --workspace DIR   where the workspace folders go (default: the folder holding muos-anbernic-manager)
  --clean-cache     start from a clean cache without asking
  --keep-cache      keep the current cache
  --shortcut        add the Start menu shortcut without asking
  --no-shortcut     do not add the Start menu shortcut
  --yes             accept the defaults without asking
  --start           start the manager at the end without asking
  --no-start        do not start the manager
  -h, --help        show this help
"@
}

$Workspace = ""; $CacheChoice = ""; $AssumeYes = $false; $StartChoice = ""; $ShortcutChoice = ""
$argv = @($args)
for ($i = 0; $i -lt $argv.Count; $i++) {
  switch -CaseSensitive ($argv[$i]) {
    "--workspace" {
      if ($i + 1 -ge $argv.Count) { Stop-Script "--workspace needs a folder." }
      $i++
      $Workspace = [string]$argv[$i]
    }
    "--clean-cache" { $CacheChoice = "clean" }
    "--keep-cache" { $CacheChoice = "keep" }
    { $_ -eq "--yes" -or $_ -eq "-y" } { $AssumeYes = $true }
    "--start" { $StartChoice = "start" }
    "--no-start" { $StartChoice = "skip" }
    "--shortcut" { $ShortcutChoice = "make" }
    "--no-shortcut" { $ShortcutChoice = "skip" }
    { $_ -eq "--help" -or $_ -eq "-h" } { Show-Usage; exit 0 }
    default { Show-Usage; Stop-Script "Unknown option: $($argv[$i])" }
  }
}

function Write-Step([string]$Text) { Write-Host ""; Write-Host "  $Text" -ForegroundColor White }
function Write-Done([string]$Text) { Write-Badge "DONE" Black DarkGreen $Text }

# The answer, or the default with --yes or without a console.
function Read-Default([string]$Question, [bool]$Default) {
  if ($AssumeYes -or -not (Test-Interactive)) { return $Default }
  $hint = "[y/N]"
  if ($Default) { $hint = "[Y/n]" }
  $reply = Read-Host "  $Question $hint"
  if ([string]::IsNullOrWhiteSpace($reply)) { return $Default }
  return $reply -match '^[Yy]'
}

Set-Location -LiteralPath $ManagerDir
Write-Host ""
Write-Badge "muOS Anbernic Manager" Black DarkGreen "installer"
Write-Note "Games, artwork, apps and settings for MustardOS handhelds, from this computer."

Write-Step "1. Node.js and packages"
Confirm-Node
Confirm-Packages
Write-Done "Node.js $(Get-NodeVersion) and the manager's packages are ready."

Write-Step "2. Workspace folders"
$DefaultWorkspace = (Resolve-Path -LiteralPath (Join-Path $ManagerDir "..")).Path
if (-not $Workspace -and -not $AssumeYes -and (Test-Interactive)) {
  Write-Note "Roms\, apps\, os\, bios\ and backups\ go into one folder. Existing folders and files are left as they are."
  $Workspace = Read-Host "  Workspace folder [$DefaultWorkspace]"
}
if (-not $Workspace) { $Workspace = $DefaultWorkspace }
if ($Workspace.StartsWith("~")) { $Workspace = $HOME + $Workspace.Substring(1) }
try { $null = New-Item -ItemType Directory -Force -Path $Workspace } catch { Stop-Script "Could not create $Workspace." }
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
Write-Note "Workspace: $Workspace"

Write-Step "3. Cache"
$Cache = Join-Path $ManagerDir ".cache"
if ((Test-Path -LiteralPath $Cache) -and (Get-ChildItem -LiteralPath $Cache -Force | Select-Object -First 1)) {
  Write-Note "The cache holds downloads (game descriptions, arcade titles), Wi-Fi and SSH logins, and settings."
  if ($CacheChoice -eq "clean" -or (-not $CacheChoice -and (Read-Default "Start from a clean cache? The current one is kept as a backup." $false))) {
    $Backup = Join-Path $ManagerDir (".cache-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    try { Move-Item -LiteralPath $Cache -Destination $Backup } catch { Stop-Script "Could not move the cache to $Backup." }
    Write-Done "Clean cache. The old one is in $(Split-Path -Leaf $Backup); delete it once you no longer need it."
  } else {
    Write-Note "Keeping the current cache and settings."
  }
} else {
  Write-Note "The cache is clean."
}

$InitArgs = @("--init")
if ($Workspace.TrimEnd("\") -ne $DefaultWorkspace.TrimEnd("\")) { $InitArgs += @("--workspace", $Workspace) }
& node src/main.ts @InitArgs
if ($LASTEXITCODE -ne 0) { Stop-Script "Could not create the workspace folders." }

Write-Step "4. Start menu shortcut"
$makeShortcut = $ShortcutChoice -eq "make"
if (-not $ShortcutChoice -and ($AssumeYes -or (Test-Interactive))) {
  Write-Note "Starts the manager from the Start menu with its icon, in a terminal window; closing the window stops it."
  $makeShortcut = Read-Default "Add muOS Anbernic Manager to the Start menu?" $true
}
if ($makeShortcut) {
  & node src/main.ts --shortcut
  if ($LASTEXITCODE -ne 0) { Write-Note "Could not add the shortcut; Settings in the manager can try again." }
} else {
  Write-Note "Skipped. Settings in the manager can add it later."
}

Write-Step "Ready"
Write-Note "Start the manager any time from the Start menu, or with:  $(Join-Path $ManagerDir 'run.cmd')"
Write-Note "Put games in $Workspace\Roms\<SYSTEM>, MustardOS apps (.muxapp, .muxupd) in apps\ and images (.img.gz) in os\."
if ($StartChoice -eq "start" -or (-not $StartChoice -and (Read-Default "Start the manager now?" $true))) {
  & (Join-Path $ManagerDir "run.ps1")
  exit $LASTEXITCODE
}
Write-Host ""
