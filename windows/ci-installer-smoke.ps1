param(
    [Parameter(Mandatory=$true)][string]$OutDir,
    [Parameter(Mandatory=$true)][string]$InstallDir
)
$ErrorActionPreference = 'Stop'
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
if (Test-Path -LiteralPath $InstallDir) { throw 'Use a fresh installer test directory' }
$installers = @(Get-ChildItem -LiteralPath $OutDir -Filter '*-Setup.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one EXE installer' }
$installer = $installers[0].FullName
$arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',"/DIR=`"$InstallDir`"", "/LOG=`"$OutDir/install.log`"")
$process = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
foreach ($file in @('Start.cmd','Update.cmd','Rollback.cmd','unins000.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $InstallDir $file))) { throw "Installed file missing: $file" }
}
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
foreach ($shortcut in @("$desktop/FusionVideo.lnk", "$programs/FusionVideo/FusionVideo.lnk")) {
    if (!(Test-Path -LiteralPath $shortcut)) { throw "Shortcut missing: $shortcut" }
}
# A second setup must reject this installation instead of replacing its data.
$second = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
if ($second.ExitCode -eq 0) { throw 'Installer unexpectedly overwrote an existing installation' }
& "$PSScriptRoot/ci-smoke.ps1" -Bundle $InstallDir -ResultFile "$OutDir/smoke.json"
New-Item -ItemType Directory -Force "$InstallDir/data/media" | Out-Null
$marker = Join-Path $InstallDir 'data/media/installer-preserve-test.txt'
[IO.File]::WriteAllText($marker, 'keep-user-data')
$uninstallArgs = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/LOG=`"$OutDir/uninstall.log`"")
$uninstall = Start-Process -FilePath "$InstallDir/unins000.exe" -ArgumentList $uninstallArgs -PassThru -Wait -WindowStyle Hidden
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller failed: $($uninstall.ExitCode)" }
if (Test-Path -LiteralPath "$InstallDir/Start.cmd") { throw 'Uninstaller left the installed launcher' }
if (!(Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker) -ne 'keep-user-data') {
    throw 'Uninstaller did not preserve user media'
}
if (!(Test-Path -LiteralPath "$InstallDir/config/windows.json")) { throw 'Uninstaller did not preserve configuration' }
[ordered]@{ install = 'passed'; existingInstallGuard = 'passed'; startup = 'passed'; uninstall = 'passed'; userDataPreserved = $true } |
    ConvertTo-Json | Set-Content -LiteralPath "$OutDir/installer-smoke.json" -Encoding utf8
