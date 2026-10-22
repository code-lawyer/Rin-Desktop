param([string]$CodexPath = 'codex', [switch]$Run, [switch]$Help, [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
if (-not $Run -or $Help) {
  Write-Output 'Usage: pwsh -File tools/probes/windows-preflight.ps1 -Run [-OutputDirectory work/qa/new-run]'
  Write-Output 'Default: help only. -Run reads Windows/device metadata and CLI versions. Each report uses a new work/qa directory.'
  return
}
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
$qaDirectory = [IO.Path]::GetFullPath((Join-Path $taskRoot 'work/qa'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $qaDirectory ('windows-preflight/' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N')) }
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $resolvedOutput.StartsWith($qaDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be a new directory inside work/qa' }
if (Test-Path -LiteralPath $resolvedOutput) { throw 'Output already exists; select a new run directory.' }
[IO.Directory]::CreateDirectory((Split-Path -Parent $resolvedOutput)) | Out-Null
New-Item -ItemType Directory -Path $resolvedOutput -ErrorAction Stop | Out-Null
$json = $report | ConvertTo-Json -Depth 8
$resultFile = Join-Path $resolvedOutput 'result.json'
$stream = [IO.File]::Open($resultFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json + "`n"); $stream.Write($bytes, 0, $bytes.Length) }
finally { $stream.Dispose() }
Write-Output ('Report: ' + $resultFile)
$json
