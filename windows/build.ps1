param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$Runtime,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path -LiteralPath $Source).Path
$Runtime = (Resolve-Path -LiteralPath $Runtime).Path
$env:JAVA_HOME = Join-Path $Runtime 'java'
$env:PATH = "$Runtime\node;$env:JAVA_HOME\bin;$env:PATH"
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:NODE_ENV = 'production'
$package = Get-Content -LiteralPath "$Source/ai-fusion-video-web/package.json" -Raw | ConvertFrom-Json
if ($package.packageManager -notmatch '^pnpm@[0-9]+\.[0-9]+\.[0-9]+$') {
    throw 'Unsupported upstream packageManager. Update the Windows builder before continuing.'
}
if (Test-Path -LiteralPath $Destination) {
    throw "Destination already exists: $Destination"
}
if (!$SkipBuild) {
    Push-Location "$Source/ai-fusion-video"
    try {
        & ./mvnw.cmd package -DskipTests -B
        if ($LASTEXITCODE -ne 0) {
            throw 'Backend build failed'
        }
    } finally {
        Pop-Location
    }
    Push-Location "$Source/ai-fusion-video-web"
    try {
        # Development dependencies are required by TypeScript and Next.js at build time.
        $env:NODE_ENV = 'development'
        & "$Runtime/node/node.exe" "$Runtime/node/node_modules/npm/bin/npm-cli.js" exec --yes "--package=$($package.packageManager)" -- pnpm install --frozen-lockfile --prod=false
        if ($LASTEXITCODE -ne 0) {
            throw 'Frontend dependency installation failed'
        }
        $env:NODE_ENV = 'production'
        & "$Runtime/node/node.exe" "$Runtime/node/node_modules/npm/bin/npm-cli.js" exec --yes "--package=$($package.packageManager)" -- pnpm build
        if ($LASTEXITCODE -ne 0) {
            throw 'Frontend build failed'
        }
    } finally {
        Pop-Location
    }
}
New-Item -ItemType Directory -Path "$Destination/web" -Force | Out-Null
$jar = Get-ChildItem -LiteralPath "$Source/ai-fusion-video/target" -Filter '*.jar' | Where-Object { $_.Name -notlike '*.original' }
if (@($jar).Count -ne 1) {
    throw 'Expected exactly one packaged backend JAR'
}
Copy-Item -LiteralPath $jar.FullName -Destination "$Destination/backend.jar"
# Robocopy materializes pnpm links so the portable app does not refer to the build machine.
& robocopy.exe "$Source/ai-fusion-video-web/.next/standalone" "$Destination/web" /E /XD .pnpm /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) {
    throw 'Copying standalone frontend failed'
}
# Materializing Windows junctions moves Next.js out of pnpm's dependency context.
# Hoist traced runtime packages, rejecting version conflicts rather than selecting one silently.
$versions = @{}
Get-ChildItem -LiteralPath "$Source/ai-fusion-video-web/.next/standalone/node_modules/.pnpm" -Directory | ForEach-Object {
    $modules = Join-Path $_.FullName 'node_modules'
    if (Test-Path -LiteralPath $modules) {
        Get-ChildItem -LiteralPath $modules -Directory | ForEach-Object {
            $entries = @($_)
            if ($_.Name.StartsWith('@')) {
                $entries = @(Get-ChildItem -LiteralPath $_.FullName -Directory)
            }
            foreach ($entry in $entries) {
                $manifest = Join-Path $entry.FullName 'package.json'
                if (Test-Path -LiteralPath $manifest) {
                    $dependency = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
                    if ($versions.ContainsKey($dependency.name) -and $versions[$dependency.name] -ne $dependency.version) {
                        throw "Conflicting traced dependency versions: $($dependency.name). Windows builder needs an update."
                    }
                    $versions[$dependency.name] = $dependency.version
                    & robocopy.exe $entry.FullName "$Destination/web/node_modules/$($dependency.name)" /E /NFL /NDL /NJH /NJS /NP
                    if ($LASTEXITCODE -ge 8) {
                        throw "Copying runtime dependency failed: $($dependency.name)"
                    }
                }
            }
        }
    }
}
Copy-Item -LiteralPath "$Source/ai-fusion-video-web/.next/static" -Destination "$Destination/web/.next/static" -Recurse
Copy-Item -LiteralPath "$Source/ai-fusion-video-web/public" -Destination "$Destination/web/public" -Recurse
[IO.File]::WriteAllText("$Destination/web/public/runtime-config.js", 'window.__FUSION_RUNTIME_CONFIG__ = Object.freeze({apiBaseUrl:""});')
$info = @{ version=$package.version; builtAt=(Get-Date).ToUniversalTime().ToString('o'); platform='win32-x64' }
$info | ConvertTo-Json | Set-Content -LiteralPath "$Destination/version.json" -Encoding UTF8
Write-Output "Release built: $Destination"
exit 0
