$since = (Get-Date).AddHours(-2)
$events = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $since } -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'Unrecordable|electron' }
if ($events) {
  $events | Select-Object -First 10 TimeCreated, Id, ProviderName | Format-Table -AutoSize
} else {
  Write-Output 'No Application-log crash/error events mentioning Unrecordable or electron in the last 2 hours.'
}
