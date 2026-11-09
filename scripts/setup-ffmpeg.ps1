# Script para descargar automáticamente FFmpeg estático para Windows
$ErrorActionPreference = "Stop"

$binDir = Join-Path $PSScriptRoot "..\bin"
$ffmpegDest = Join-Path $binDir "ffmpeg.exe"

if (Test-Path $ffmpegDest) {
    Write-Host "✅ ffmpeg.exe ya está presente en $ffmpegDest" -ForegroundColor Green
    exit 0
}

Write-Host "📦 Creando directorio bin..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$tempZip = Join-Path $env:TEMP "ffmpeg-release.zip"
$tempExtracted = Join-Path $env:TEMP "ffmpeg_extracted"

Write-Host "⬇️ Descargando FFmpeg estático..." -ForegroundColor Cyan
$url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
Invoke-WebRequest -Uri $url -OutFile $tempZip -UseBasicParsing

Write-Host "📂 Descomprimiendo binarios..." -ForegroundColor Cyan
if (Test-Path $tempExtracted) { Remove-Item -Recurse -Force $tempExtracted }
Expand-Archive -Path $tempZip -DestinationPath $tempExtracted -Force

$foundExe = (Get-ChildItem -Path $tempExtracted -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1).FullName
if (-not $foundExe) {
    throw "No se encontró ffmpeg.exe dentro del archivo descargado."
}

Copy-Item -Path $foundExe -Destination $ffmpegDest -Force
Write-Host "✅ FFmpeg instalado correctamente en: $ffmpegDest" -ForegroundColor Green

# Limpieza temporal
Remove-Item -Force $tempZip -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $tempExtracted -ErrorAction SilentlyContinue
