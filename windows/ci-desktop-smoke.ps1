param(
    [Parameter(Mandatory=$true)][string]$Bundle,
    [Parameter(Mandatory=$true)][string]$ResultFile
)
$ErrorActionPreference = 'Stop'
$Bundle = (Resolve-Path -LiteralPath $Bundle).Path
$ResultFile = [IO.Path]::GetFullPath($ResultFile)
$executable = Join-Path $Bundle 'FusionVideo.exe'
$savedElectronNode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = $null
    $process = Start-Process -FilePath $executable -ArgumentList "`"--smoke-result=$ResultFile`"" -PassThru
    if (!$process.WaitForExit(360000)) {
        Stop-Process -Id $process.Id -Force
        throw 'Desktop startup test timed out'
    }
    if ($process.ExitCode -ne 0) { throw "Desktop test failed: $($process.ExitCode)" }
    $result = Get-Content -LiteralPath $ResultFile -Raw | ConvertFrom-Json
    if (!$result.renderedInitialization -or $result.shutdown -ne 'passed') {
        throw 'Desktop render or service shutdown verification failed'
    }
    Write-Output "Desktop window rendered: $($result.title); close stopped services"
} finally {
    $env:ELECTRON_RUN_AS_NODE = $savedElectronNode
    & "$Bundle/runtime/node/node.exe" "$Bundle/windows/control.mjs" stop
}
