param(
    [Parameter(Mandatory=$true)][string]$Bundle,
    [Parameter(Mandatory=$true)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
$Bundle = (Resolve-Path -LiteralPath $Bundle).Path
$OutDir = [IO.Path]::GetFullPath($OutDir)
foreach ($name in @('data','config','logs','backups','.runtime')) {
    if (Test-Path -LiteralPath (Join-Path $Bundle $name)) {
        throw "Package the clean application before starting it. Found: $name"
    }
}
$id = (Get-Content -LiteralPath "$Bundle/current.txt" -Raw).Trim()
if ($id -notmatch '^[\w.-]+$') {
    throw 'Invalid release directory name'
}
$release = Get-Content -LiteralPath "$Bundle/releases/$id/version.json" -Raw | ConvertFrom-Json
if ($release.version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Invalid application version'
}
$links = @(Get-ChildItem -LiteralPath $Bundle -Recurse -Attributes ReparsePoint)
if ($links.Count -ne 0) {
    throw 'Portable application contains directory links to the build machine'
}
$commit = git rev-parse --verify HEAD
if ($LASTEXITCODE -ne 0) {
    throw 'Source commit could not be resolved'
}
$manifest = [ordered]@{
    application = 'ai-fusion-video'
    version = $release.version
    architecture = 'win32-x64'
    windowsWrapper = 2
    desktopRuntime = (Get-Content -LiteralPath "$PSScriptRoot/desktop-toolchain.json" -Raw | ConvertFrom-Json)
    sourceCommit = $commit.Trim()
    sourceRepository = $env:GITHUB_REPOSITORY
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    toolchain = (Get-Content -LiteralPath "$PSScriptRoot/toolchain.json" -Raw | ConvertFrom-Json)
}
New-Item -ItemType Directory -Force $OutDir | Out-Null
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath "$Bundle/build-manifest.json" -Encoding utf8
Copy-Item -LiteralPath "$Bundle/build-manifest.json" -Destination "$OutDir/build-manifest.json"
$zip = Join-Path $OutDir "FusionVideo-Windows-x64-$($release.version).zip"
if (Test-Path -LiteralPath $zip) {
    throw 'ZIP already exists; use a new output directory'
}
$sevenZip = Join-Path ${env:ProgramFiles} '7-Zip/7z.exe'
Push-Location (Split-Path $Bundle -Parent)
try {
    & $sevenZip a $zip (Split-Path $Bundle -Leaf) -tzip -mx=3 -mmt=4 -bso0 -bsp0
    if ($LASTEXITCODE -ne 0) {
        throw 'Windows ZIP packaging failed'
    }
    & $sevenZip t $zip -bso0
    if ($LASTEXITCODE -ne 0) {
        throw 'Windows ZIP integrity check failed'
    }
} finally {
    Pop-Location
}
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($zip))" | Set-Content -LiteralPath "$OutDir/SHA256SUMS.txt" -Encoding ascii
Write-Output "Verified Windows package: $zip"
