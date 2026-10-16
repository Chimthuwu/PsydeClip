Get-Process electron -ErrorAction SilentlyContinue | Select-Object Id, Path, StartTime | Format-Table -AutoSize
