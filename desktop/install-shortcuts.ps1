$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$pythonExe = (Get-Command python.exe -ErrorAction Stop).Source
$pythonwExe = Join-Path (Split-Path -Parent $pythonExe) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonwExe)) { throw 'pythonw.exe was not found.' }
$launcher = Join-Path $PSScriptRoot 'launch.py'
$desktopDir = [Environment]::GetFolderPath('Desktop')
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $desktopDir '每日规划.lnk'
$backupDir = Join-Path $projectDir '.tmp\launcher'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (Test-Path -LiteralPath $shortcutPath) {
    $backup = Join-Path $backupDir 'original-desktop-shortcut.lnk'
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $shortcutPath -Destination $backup }
}
$linkShell = New-Object -ComObject WScript.Shell
foreach ($entry in @(
    @{ Path = $shortcutPath; Arguments = '"' + $launcher + '"' },
    @{ Path = (Join-Path $startupDir 'Daily Plan.lnk'); Arguments = '"' + $launcher + '" --autostart' }
)) {
    $link = $linkShell.CreateShortcut($entry.Path)
    $link.TargetPath = $pythonwExe
    $link.Arguments = $entry.Arguments
    $link.WorkingDirectory = $projectDir
    $link.IconLocation = (Join-Path $projectDir 'favicon.ico') + ',0'
    $link.Description = 'Daily Plan - floating orb and local backend'
    $link.WindowStyle = 7
    $link.Save()
    Write-Output ('Installed: ' + $entry.Path)
}
