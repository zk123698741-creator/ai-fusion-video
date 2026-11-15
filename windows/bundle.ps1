param(
    [Parameter(Mandatory=$true)][string]$Destination,
    [string]$Cache = "$PSScriptRoot/../.local/windows-build-cache"
)
$ErrorActionPreference = 'Stop'
$source = Split-Path $PSScriptRoot -Parent
$Destination = [IO.Path]::GetFullPath($Destination)
$Cache = [IO.Path]::GetFullPath($Cache)
if (Test-Path -LiteralPath $Destination) {
    throw 'Use a new destination directory to preserve existing data'
}
New-Item -ItemType Directory -Force $Cache,"$Destination/runtime","$Destination/releases","$Destination/windows" | Out-Null
$dependencies = Get-Content -LiteralPath "$PSScriptRoot/toolchain.json" -Raw | ConvertFrom-Json
foreach ($dependency in $dependencies) {
    $archive = Join-Path $Cache "$($dependency.name)-$($dependency.archive)"
    if (!(Test-Path -LiteralPath $archive)) {
        & curl.exe --fail --location --retry 3 --output $archive $dependency.url
        if ($LASTEXITCODE -ne 0) {
            throw "Download failed: $($dependency.name)"
        }
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $dependency.sha256) {
        throw "Archive hash mismatch: $($dependency.name)"
    }
    $unpacked = Join-Path $Cache $dependency.name
    New-Item -ItemType Directory -Force $unpacked | Out-Null
    if ([IO.Path]::GetExtension($archive) -eq '.7z') {
        $sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
        if (!(Test-Path -LiteralPath $sevenZip)) {
            throw '7-Zip is required to extract the FFmpeg runtime'
        }
        & $sevenZip x $archive "-o$unpacked" -y -bso0 -bsp0
    } else {
        & tar.exe -xf $archive -C $unpacked
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Extraction failed: $($dependency.name)"
    }
    & robocopy.exe "$unpacked/$($dependency.folder)" "$Destination/runtime/$($dependency.name)" /E /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) {
        throw "Runtime copy failed: $($dependency.name)"
    }
}
Copy-Item -LiteralPath "$Destination/runtime/java/bin/msvcp140.dll","$Destination/runtime/java/bin/vcruntime140.dll","$Destination/runtime/java/bin/vcruntime140_1.dll" -Destination "$Destination/runtime/mysql/bin"
Copy-Item "$PSScriptRoot/*.mjs","$PSScriptRoot/*.ps1","$PSScriptRoot/*.json" "$Destination/windows"
Copy-Item "$PSScriptRoot/*.cmd" $Destination
Copy-Item "$PSScriptRoot/README-Windows.md" "$Destination/README-Windows.md"
Copy-Item "$source/LICENSE" "$Destination/LICENSE-ai-fusion-video.txt"
$package = Get-Content -LiteralPath "$source/ai-fusion-video-web/package.json" -Raw | ConvertFrom-Json
$id = "$($package.version)-windows.1"
& "$PSScriptRoot/build.ps1" -Source $source -Destination "$Destination/releases/$id" -Runtime "$Destination/runtime"
if ($LASTEXITCODE -ne 0) {
    throw 'Application build failed'
}
[IO.File]::WriteAllText("$Destination/current.txt", $id)
Write-Output "Portable Windows build: $Destination"
