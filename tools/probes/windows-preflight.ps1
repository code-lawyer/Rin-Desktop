param([string]$CodexPath = 'codex')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$computer = Get-CimInstance Win32_ComputerSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$osInfo = Get-CimInstance Win32_OperatingSystem
$bluetooth = @(Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue)
$remoteMatches = @($bluetooth | Where-Object { $_.FriendlyName -match 'RC003|RC001|小米|Xiaomi' })
$cliVersion = & $CodexPath --version
if ($LASTEXITCODE -ne 0) { throw 'Codex version check failed' }
$report = [ordered]@{
  date = [DateTime]::UtcNow.ToString('o')
  stage = 'M0/B-01'
  operatingSystem = @{ name = $osInfo.Caption; version = $osInfo.Version; build = $osInfo.BuildNumber }
  cpu = $processor.Name
  memoryGB = [Math]::Round($computer.TotalPhysicalMemory / 1GB)
  gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
  codexVersion = ($cliVersion | Out-String).Trim()
  toolsOnCurrentPath = @{}
  bluetooth = @{
    presentDeviceCount = $bluetooth.Count
    healthyAdapter = @($bluetooth | Where-Object { $_.FriendlyName -match '(Intel|英特尔|Realtek|Qualcomm).*Bluetooth' -and $_.Status -eq 'OK' }).Count -gt 0
    matchedRemoteNames = @($remoteMatches | ForEach-Object { $_.FriendlyName })
    matchingIsHeuristic = $true
    gattOrAudioValidated = $false
  }
  deviceIdentifiersPersisted = $false
}
foreach ($toolName in @('node', 'dotnet', 'claude', 'python')) {
  $report.toolsOnCurrentPath[$toolName] = [bool](Get-Command $toolName -ErrorAction SilentlyContinue)
}
$pythonEntry = Get-Command python -ErrorAction SilentlyContinue
$report['pythonIsWindowsAppAlias'] = [bool]($pythonEntry -and $pythonEntry.Source -match 'WindowsApps')
$claudeEntry = Get-Command claude -ErrorAction SilentlyContinue
if ($claudeEntry) {
  $claudeVersion = & $claudeEntry.Source --version
  if ($LASTEXITCODE -eq 0) { $report['claudeVersion'] = ($claudeVersion | Out-String).Trim() }
}
$outputDirectory = Join-Path $taskRoot 'docs/evidence'
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$json = $report | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $outputDirectory '2026-10-01-windows-preflight.json'), $json + "`n", [Text.UTF8Encoding]::new($false))
$json
