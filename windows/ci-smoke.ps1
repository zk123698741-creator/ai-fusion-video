param(
    [Parameter(Mandatory=$true)][string]$Bundle,
    [Parameter(Mandatory=$true)][string]$ResultFile
)
$ErrorActionPreference = 'Stop'
$Bundle = (Resolve-Path -LiteralPath $Bundle).Path
$node = Join-Path $Bundle 'runtime/node/node.exe'
$control = Join-Path $Bundle 'windows/control.mjs'
try {
    & $node $control start --no-browser
    if ($LASTEXITCODE -ne 0) {
        throw 'Windows application failed to start'
    }
    $page = Invoke-WebRequest 'http://127.0.0.1:18088/setup' -TimeoutSec 15
    $init = Invoke-RestMethod 'http://127.0.0.1:18088/api/system/init/status' -TimeoutSec 15
    if ($page.StatusCode -ne 200 -or $init.code -ne 0 -or $init.data.initialized -ne $false) {
        throw 'Fresh application initialization check failed'
    }
    [ordered]@{
        setupStatus = $page.StatusCode
        initialization = $init
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultFile -Encoding utf8
} catch {
    foreach ($name in @('launcher','backend','frontend','mysql','redis')) {
        $file = Join-Path $Bundle "logs/$name.log"
        if (Test-Path -LiteralPath $file) {
            Write-Output "Service log: $name"
            Get-Content -LiteralPath $file -Tail 35
        }
    }
    throw
} finally {
    & $node $control stop
    if ($LASTEXITCODE -ne 0) {
        throw 'Windows application did not stop normally'
    }
}
