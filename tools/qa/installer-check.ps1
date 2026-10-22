param([switch]$Run, [string]$PreviousSetup)
$ErrorActionPreference = 'Stop'
if (-not $Run) {
  Write-Output 'Default: help only. Use -Run [-PreviousSetup <old installer>] to extract the current installer into new isolated directories under work/qa. No registration, shortcuts, application startup, accounts or hardware.'
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
$result = @{ version=$version; freshDirectory=$fresh; upgradeDirectory=$upgrade; portableExtraction=$true; registryAndShortcuts=$false; applicationStarted=$false; uninstallTested=$false; accounts=$false; hardware=$false; passed=$true }
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runRoot 'result.json') -Encoding utf8
$result | ConvertTo-Json -Depth 5
