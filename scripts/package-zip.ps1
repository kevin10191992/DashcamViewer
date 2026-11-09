param (
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

if (-not $Version) {
    try {
        $pkg = Get-Content -Raw -Path (Join-Path $PSScriptRoot "..\package.json") | ConvertFrom-Json
        $Version = "v" + $pkg.version
    } catch {
        $Version = "v1.0.0"
    }
}

$distDir = Join-Path $PSScriptRoot "..\dist"
$unpackedDir = Join-Path $distDir "win-unpacked"

if (-not (Test-Path $unpackedDir)) {
    Write-Host "Directorio win-unpacked no encontrado. Compilando archivos desempaquetados..."
    npx electron-builder --win --dir
}

$zipFileName = "D026-Dashcam-Viewer-$Version-Windows-Portable.zip"
$zipPath = Join-Path $distDir $zipFileName

Write-Host "Empaquetando archivos desempaquetados de $unpackedDir en $zipFileName..."
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}

Compress-Archive -Path "$unpackedDir\*" -DestinationPath $zipPath -Force
Write-Host "✅ Archivo ZIP creado con éxito: $zipPath"
