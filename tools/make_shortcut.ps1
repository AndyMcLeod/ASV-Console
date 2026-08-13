<#
.SYNOPSIS
    Create (or refresh) the "ASV Console (Sim)" desktop shortcut.

.DESCRIPTION
    Run this once after cloning the project onto a machine, or after moving the
    folder. It points a desktop shortcut at start_sim.bat IN THIS COPY of the
    project, resolved from the script's own location - so there is no path to
    edit and no way for it to point at a folder that has moved.

    Re-running it overwrites the existing shortcut rather than making a second
    one, so it is safe to run whenever you are not sure it is still right.

    This replaces the hand-built shortcut the README used to describe
    (right-drag start_sim.bat to the desktop, then Properties -> Change Icon).
    That route still works; this one is repeatable and verifies itself.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1 -Name "ASV Console (4 m USV)" -Arguments "--vessel example_usv_4m"
    Makes a SECOND shortcut beside the first, on another vessel profile.
    start_sim.bat forwards its arguments to asv_console.py, so anything that
    accepts works here: --vessel, --port 8792 for a console beside the first,
    --single-window, --browser none.

.NOTES
    Creates nothing outside the Desktop folder and writes nothing into the
    project. Delete the .lnk to undo it completely.

    The .lnk itself is deliberately NOT tracked in the repository: it is a
    binary carrying absolute paths for one machine, so a committed copy would
    be wrong for every other clone. This script plus tools\asv.ico are what the
    repo carries, and between them the shortcut is reproducible anywhere.
#>
[CmdletBinding()]
param(
    # Shortcut file name, without the .lnk extension.
    [string] $Name = 'ASV Console (Sim)',

    # Passed straight through to start_sim.bat -> asv_console.py.
    [string] $Arguments = '',

    # Where to put it. Defaults to the Desktop, which on a OneDrive-backed
    # profile is the redirected OneDrive\Desktop - GetFolderPath resolves that
    # correctly, whereas $env:USERPROFILE\Desktop does not (it silently names a
    # folder that does not exist on this profile).
    [string] $DesktopPath = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'

# Resolve the project from THIS SCRIPT's location: tools\ -> repo root.
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'start_sim.bat'
$icon = Join-Path $root 'tools\asv.ico'

if (-not (Test-Path -LiteralPath $target)) {
    throw "start_sim.bat not found at $target - is make_shortcut.ps1 still inside the project's tools\ folder?"
}
if (-not (Test-Path -LiteralPath $DesktopPath)) {
    throw "Desktop folder not found at $DesktopPath - pass -DesktopPath explicitly."
}

$link = Join-Path $DesktopPath "$Name.lnk"
$existed = Test-Path -LiteralPath $link

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath = $target
$sc.Arguments = $Arguments
$sc.WorkingDirectory = $root
$sc.Description = 'Start the ASV Console in simulator mode (opens the chart + controls in your browser)'
$sc.WindowStyle = 1
# Only claim the icon if it is actually there; a missing IconLocation makes
# Explorer fall back to a blank page icon rather than the .bat's own.
if (Test-Path -LiteralPath $icon) { $sc.IconLocation = "$icon,0" }
$sc.Save()

# Verify by reading the shortcut back, rather than trusting Save() - a bad path
# saves happily and only fails when double-clicked.
$check = $shell.CreateShortcut($link)
if ($check.TargetPath -ne $target) {
    throw "Shortcut saved but points at '$($check.TargetPath)' instead of '$target'."
}
if ($check.WorkingDirectory -ne $root) {
    throw "Shortcut saved but starts in '$($check.WorkingDirectory)' instead of '$root'."
}

Write-Host ("{0} shortcut: {1}" -f $(if ($existed) { 'Updated' } else { 'Created' }), $link)
Write-Host ("  -> {0}" -f $check.TargetPath)
if ($Arguments) { Write-Host ("  args: {0}" -f $Arguments) }
Write-Host '  Double-click it to start the console in simulator mode.'
