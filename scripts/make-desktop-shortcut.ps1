# Put a desktop shortcut on the freshly built unpacked app.
#
# The icon is `build/icon.ico` — the app's own 7-size artwork, the same set
# `scripts/make-icon.js` generates and electron-builder embeds in the exe
# (`npm run verify:icon` proves that). It used to point at `audio.ico`, a 4-bit
# 16/32px leftover that came in with an unrelated spike commit, so the shortcut
# wore a different icon from the app it launched (owner, 2026-10-13: "make sure
# it uses the correct icon this time").
$desktop = [Environment]::GetFolderPath('Desktop')
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'release\win-unpacked\PsydeClip.exe'
$lnkPath = Join-Path $desktop 'PsydeClip.lnk'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = Join-Path $root 'release\win-unpacked'
$ico = Join-Path $root 'build\icon.ico'
$lnk.IconLocation = $ico + ',0'
$lnk.Save()
Write-Output ('Shortcut created: ' + (Test-Path $lnkPath))
Write-Output ('Target exists: ' + (Test-Path $exe))
Write-Output ('Icon exists:   ' + (Test-Path $ico))
Write-Output ('Icon set to:   ' + $lnk.IconLocation)
