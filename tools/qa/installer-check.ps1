param([switch]$Run, [string]$PreviousSetup, [switch]$Lifecycle)
$ErrorActionPreference = 'Stop'
if (-not $Run) {
  Write-Output 'Default: help only. Use -Run [-PreviousSetup <old installer>] for isolated portable extraction. Optional -Lifecycle tests registration/uninstall only if the normal AppId and default shortcut group are absent; installs under work/qa. No application startup, accounts or hardware.'
  exit 0
}
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$setup = Join-Path $repoRoot "release/v$version/Rin-Desktop-$version-Setup.exe"
if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw 'Build the installer first.' }
if ($PreviousSetup) { $PreviousSetup = (Resolve-Path -LiteralPath $PreviousSetup).Path }
$qaRoot = Join-Path $repoRoot 'work/qa'
$runRoot = Join-Path $qaRoot ('installer-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runRoot | Out-Null

function Install-Isolated([string]$Binary, [string]$Destination, [string]$Log) {
  $target = [IO.Path]::GetFullPath($Destination)
  if (-not $target.StartsWith($runRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installation target must stay inside this QA run.' }
  $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/PORTABLE=1', "/DIR=`"$target`"", "/LOG=`"$Log`"")
  $process = Start-Process -FilePath $Binary -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer failed with code $($process.ExitCode). See $Log" }
}
function Verify-Package([string]$Directory) {
  & node (Join-Path $repoRoot 'tools/qa/release-package.mjs') "--package=$Directory"
  if ($LASTEXITCODE -ne 0) { throw 'Installed package verification failed.' }
}
$fresh = Join-Path $runRoot '中文 空格路径/独立应用'
Install-Isolated $setup $fresh (Join-Path $runRoot 'fresh-install.log')
Verify-Package $fresh
$upgrade = $null
if ($PreviousSetup) {
  $upgrade = Join-Path $runRoot 'upgrade/application'
  Install-Isolated $PreviousSetup $upgrade (Join-Path $runRoot 'previous-install.log')
  Install-Isolated $setup $upgrade (Join-Path $runRoot 'upgrade-install.log')
  Verify-Package $upgrade
}
$lifecycleResult = $null
if ($Lifecycle) {
  $appKey = '{215174A1-C028-4225-947F-9B15787E578D}_is1'
  $keys = @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appKey", "HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$appKey", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appKey", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$appKey")
  foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { throw 'Existing Rin Desktop installation detected; registration test refuses to alter it. Portable checks remain available.' } }
  $registered = [IO.Path]::GetFullPath((Join-Path $runRoot 'lifecycle/application'))
  if (-not $registered.StartsWith($runRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Registration target escapes this QA run.' }
  # DisableProgramGroupPage=yes ignores /GROUP. Guard the actual default group.
  $group = 'Rin Desktop'
  $groupPath = Join-Path ([Environment]::GetFolderPath('Programs')) $group
  $commonGroupPath = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) $group
  if ((Test-Path -LiteralPath $groupPath) -or (Test-Path -LiteralPath $commonGroupPath)) { throw 'Existing Rin Desktop shortcut group detected; refusing registration test.' }
  $sentinel = Join-Path $runRoot 'lifecycle/user-data-preservation.txt'
  New-Item -ItemType Directory -Path (Split-Path -Parent $sentinel) -Force | Out-Null
  [IO.File]::WriteAllText($sentinel, 'isolated synthetic data must survive uninstall')
  $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/TASKS=', "/DIR=`"$registered`"", "/LOG=`"$(Join-Path $runRoot 'registered-install.log')`"")
  $uninstaller = Join-Path $registered 'unins000.exe'
  try {
    $process = Start-Process -FilePath $setup -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw 'Registered installation failed.' }
    $registration = $keys | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $registration) { throw 'The installer did not register an uninstall entry.' }
    $record = Get-ItemProperty -LiteralPath $registration
    if ([IO.Path]::GetFullPath($record.InstallLocation).TrimEnd('\') -ne $registered) { throw 'Registered installation path does not match the isolated target.' }
    if (-not (Test-Path -LiteralPath (Join-Path $groupPath 'Rin Desktop.lnk'))) { throw 'QA Start-menu shortcut missing.' }
    Verify-Package $registered
  } finally {
    # Only the known fresh test target is eligible for uninstall; never execute a registry command string.
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
      $process = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -Wait -PassThru -WindowStyle Hidden
      if ($process.ExitCode -ne 0) { throw 'QA uninstall failed.' }
    }
  }
  foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { throw 'QA uninstall entry remains.' } }
  if ((Test-Path -LiteralPath (Join-Path $registered 'VibeVoice.exe')) -or (Test-Path -LiteralPath $groupPath)) { throw 'QA installed binary or shortcut remains after uninstall.' }
  if ([IO.File]::ReadAllText($sentinel) -ne 'isolated synthetic data must survive uninstall') { throw 'Uninstall changed the separate synthetic data.' }
  $rollbackVersion = $null
  if ($PreviousSetup) {
    Install-Isolated $PreviousSetup $registered (Join-Path $runRoot 'rollback-install.log')
    $oldManifest = Get-Content -LiteralPath (Join-Path $registered 'manifest.json') -Raw | ConvertFrom-Json
    foreach ($entry in $oldManifest.files) {
      $path = [IO.Path]::GetFullPath((Join-Path $registered $entry.file))
      if (-not $path.StartsWith($registered + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Rollback manifest contains an unsafe path.' }
      if ((Get-Item -LiteralPath $path).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Rollback file validation failed.' }
    }
    $rollbackVersion = $oldManifest.version
  }
  $lifecycleResult = @{ registration=$true; defaultStartMenuWasAbsent=$true; uninstall=$true; separateSyntheticDataPreserved=$true; rollbackVersion=$rollbackVersion; rollbackIsPortable=$true }
}
$result = @{ version=$version; freshDirectory=$fresh; upgradeDirectory=$upgrade; portableExtraction=$true; registryAndShortcuts=[bool]$lifecycleResult; applicationStarted=$false; uninstallTested=[bool]$lifecycleResult; lifecycle=$lifecycleResult; accounts=$false; hardware=$false; passed=$true }
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runRoot 'result.json') -Encoding utf8
$result | ConvertTo-Json -Depth 5
