param(
    [ValidateSet('wallpaper','avatar')][string]$Mode = 'wallpaper',
    [string]$Provider = '',
    [string]$Storage = '',
    [string]$Project = '',
    [switch]$Check,
    [switch]$NoDialog
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskStart = Join-Path $PSScriptRoot 'start.mjs'

function ConvertTo-NativeArgument([string]$Value) {
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

try {
    $taskNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $taskNode) { $taskNode = Join-Path $taskRoot 'prototypes/live2d-codex/runtime/node.exe' }
    if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Node.js 24+ is required. See docs/build.md.' }
    $taskArgs = @($taskStart, "--mode=$Mode")
    if ($Provider) { $taskArgs += "--provider=$Provider" }
    if ($Storage) { $taskArgs += "--storage=$Storage" }
    if ($Project) { $taskArgs += "--project=$Project" }
    # PowerShell 5.1's native & invocation loses trailing backslashes in quoted
    # arguments. Use the same explicit Windows quoting for preflight and launch.
    $taskPreflight = New-Object System.Diagnostics.Process
    try {
        $taskPreflight.StartInfo.FileName = $taskNode
        $taskPreflight.StartInfo.Arguments = (($taskArgs + '--check') | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
        $taskPreflight.StartInfo.WorkingDirectory = $taskRoot
        $taskPreflight.StartInfo.UseShellExecute = $false
        $taskPreflight.StartInfo.CreateNoWindow = $true
        $taskPreflight.StartInfo.RedirectStandardOutput = $true
        $taskPreflight.StartInfo.RedirectStandardError = $true
        $taskPreflight.StartInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
        $taskPreflight.StartInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
        $null = $taskPreflight.Start()
        $taskOutput = $taskPreflight.StandardOutput.ReadToEndAsync()
        $taskError = $taskPreflight.StandardError.ReadToEndAsync()
        $taskPreflight.WaitForExit()
        $taskCheck = $taskOutput.GetAwaiter().GetResult()
        $taskCheckError = $taskError.GetAwaiter().GetResult()
        if ($taskPreflight.ExitCode -ne 0) { throw ($taskCheck + $taskCheckError) }
    }
    finally { $taskPreflight.Dispose() }
    if ($Check) { $taskCheck; exit 0 }
    $taskLogs = Join-Path $taskRoot 'work/runtime/launcher'
    [IO.Directory]::CreateDirectory($taskLogs) | Out-Null
    $taskRun = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '-' + $PID
    $taskArguments = (($taskArgs + '--background') | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $taskErrorLog = Join-Path $taskLogs "$taskRun.error.log"
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList $taskArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskLogs "$taskRun.log") `
        -RedirectStandardError $taskErrorLog
    # Cache the handle before waiting so Windows PowerShell 5.1 retains ExitCode.
    $null = $taskProcess.Handle
    # Wait for the build and process handoff, not the lifetime of the Electron tree.
    $taskProcess.WaitForExit()
    if ($taskProcess.ExitCode -ne 0) {
        $taskFailure = (Get-Content -LiteralPath $taskErrorLog -Encoding UTF8 -Tail 20) -join [Environment]::NewLine
        throw "Source build or application launch failed (exit $($taskProcess.ExitCode)).`n$taskFailure"
    }
}
catch {
    if ($Check -or $NoDialog) { Write-Error $_.Exception.Message; exit 1 }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message + "`nSee docs/build.md and work/runtime/launcher.", 'Rin Desktop - launch failed') | Out-Null
    exit 1
}
