$desktop = [Environment]::GetFolderPath('Desktop')
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'release\win-unpacked\Unrecordable.exe'
$lnkPath = Join-Path $desktop 'Unrecordable.lnk'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = Join-Path $root 'release\win-unpacked'
$lnk.IconLocation = (Join-Path $root 'audio.ico') + ',0'
$lnk.Save()
Write-Output ('Shortcut created: ' + (Test-Path $lnkPath))
Write-Output ('Target exists: ' + (Test-Path $exe))
