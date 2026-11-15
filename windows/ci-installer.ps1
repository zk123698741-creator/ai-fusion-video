param(
    [Parameter(Mandatory=$true)][string]$Bundle,
    [Parameter(Mandatory=$true)][string]$OutDir,
    [string]$Compiler = "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe"
)
$ErrorActionPreference = 'Stop'
$Bundle = (Resolve-Path -LiteralPath $Bundle).Path
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
foreach ($name in @('data','config','logs','backups','.runtime')) {
    if (Test-Path -LiteralPath (Join-Path $Bundle $name)) {
        throw "Installer requires a clean bundle. Found: $name"
    }
}
$id = (Get-Content -LiteralPath "$Bundle/current.txt" -Raw).Trim()
$version = (Get-Content -LiteralPath "$Bundle/releases/$id/version.json" -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installer version' }
if (!(Test-Path -LiteralPath $Compiler)) { throw 'Inno Setup 6 compiler is required' }
& $Compiler "/DBundleDir=$Bundle" "/DAppVersion=$version" "/DOutputDir=$OutDir" "$PSScriptRoot/installer.iss"
if ($LASTEXITCODE -ne 0) { throw 'EXE installer compilation failed' }
$installer = Join-Path $OutDir "FusionVideo-Windows-x64-$version-Setup.exe"
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($installer))" | Add-Content -LiteralPath "$OutDir/SHA256SUMS.txt" -Encoding ascii
Write-Output "Built EXE installer: $installer"
