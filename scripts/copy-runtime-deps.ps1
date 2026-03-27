$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pluginRoot = Join-Path $projectRoot 'com.jvhtec.lake-smaart.sdPlugin'
$sourceRoot = Join-Path $projectRoot 'node_modules'
$runtimeDependencies = @('ws')

if (-not (Test-Path $pluginRoot)) {
    throw "Plugin root not found: $pluginRoot"
}

$pluginNodeModules = Join-Path $pluginRoot 'node_modules'
New-Item -ItemType Directory -Force -Path $pluginNodeModules | Out-Null

foreach ($dependency in $runtimeDependencies) {
    $sourcePath = Join-Path $sourceRoot $dependency
    $destinationPath = Join-Path $pluginNodeModules $dependency

    if (-not (Test-Path $sourcePath)) {
        throw "Runtime dependency not found: $sourcePath. Run npm install first."
    }

    if (Test-Path $destinationPath) {
        Remove-Item -Recurse -Force -LiteralPath $destinationPath
    }

    Copy-Item -Recurse -Force -LiteralPath $sourcePath -Destination $destinationPath
    Write-Host "Copied runtime dependency '$dependency' to plugin bundle."
}
