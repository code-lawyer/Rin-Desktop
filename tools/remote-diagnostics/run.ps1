param([ValidateRange(10,600)][int]$Seconds=600)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskPython=Join-Path $taskRoot 'work/runtime/rc003-probe/Scripts/python.exe'
$taskCompiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$taskNode=(Get-Command node -ErrorAction Stop).Source
if(!(Test-Path -LiteralPath $taskPython)){throw 'Prepare the isolated Python environment from tools/remote-diagnostics/README.md first.'}
if(!(Test-Path -LiteralPath $taskCompiler)){throw 'The Windows .NET Framework compiler is unavailable.'}
$taskToolDir=Join-Path $taskRoot 'work/runtime/rc003-tools'
[IO.Directory]::CreateDirectory($taskToolDir)|Out-Null
$taskExe=Join-Path $taskToolDir 'keys.exe'
& $taskCompiler /nologo /target:winexe /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$taskExe" (Join-Path $PSScriptRoot 'raw_keys.cs')
if($LASTEXITCODE -ne 0){throw 'Key probe compilation failed.'}
$taskSession=Join-Path $taskRoot ('work/runtime/rc003-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
[IO.Directory]::CreateDirectory($taskSession)|Out-Null
# This GUI is the explicit interactive tool for the user; the controller console stays hidden.
$taskKeys=Start-Process -FilePath $taskExe -ArgumentList ('"'+$taskSession+'"') -WindowStyle Normal -PassThru
$taskArgs=@(('"'+(Join-Path $PSScriptRoot 'session.mjs')+'"'),'--directory',('"'+$taskSession+'"'),'--seconds',$Seconds)
$taskController=Start-Process -FilePath $taskNode -ArgumentList $taskArgs -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskSession 'controller.jsonl') -RedirectStandardError (Join-Path $taskSession 'controller-errors.log') -PassThru
@{keysPid=$taskKeys.Id;controllerPid=$taskController.Id;session=$taskSession}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskSession 'owned-processes.json') -Encoding utf8
Write-Output $taskSession
