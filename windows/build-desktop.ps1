param(
    [Parameter(Mandatory=$true)][string]$Bundle,
    [Parameter(Mandatory=$true)][string]$Cache
)
$ErrorActionPreference = 'Stop'
$Bundle = (Resolve-Path -LiteralPath $Bundle).Path
$Cache = [IO.Path]::GetFullPath($Cache)
$desktop = Get-Content -LiteralPath "$PSScriptRoot/desktop-toolchain.json" -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force $Cache | Out-Null
$archive = Join-Path $Cache "electron-$($desktop.version).zip"
if (!(Test-Path -LiteralPath $archive)) {
    & curl.exe --fail --location --retry 3 --output $archive $desktop.url
    if ($LASTEXITCODE -ne 0) { throw 'Electron download failed' }
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $desktop.sha256) {
    throw 'Electron archive hash mismatch'
}
if (Test-Path -LiteralPath "$Bundle/FusionVideo.exe") { throw 'Desktop executable already exists' }
& tar.exe -xf $archive -C $Bundle
if ($LASTEXITCODE -ne 0) { throw 'Electron extraction failed' }
Rename-Item -LiteralPath "$Bundle/electron.exe" -NewName 'FusionVideo.exe'
if (Test-Path -LiteralPath "$Bundle/electron_wer.dll") {
    Rename-Item -LiteralPath "$Bundle/electron_wer.dll" -NewName 'FusionVideo_wer.dll'
}
New-Item -ItemType Directory -Force "$Bundle/resources/app" | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot/desktop-main.cjs","$PSScriptRoot/desktop-loading.html" -Destination "$Bundle/resources/app"
$id = (Get-Content -LiteralPath "$Bundle/current.txt" -Raw).Trim()
$version = (Get-Content -LiteralPath "$Bundle/releases/$id/version.json" -Raw | ConvertFrom-Json).version
$package = @{ name = 'fusionvideo-desktop'; productName = 'FusionVideo'; version = $version; main = 'desktop-main.cjs' }
[IO.File]::WriteAllText("$Bundle/resources/app/package.json", ($package | ConvertTo-Json))
Write-Output "Desktop executable: $Bundle/FusionVideo.exe"
