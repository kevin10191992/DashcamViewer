@echo off
chcp 65001 >nul
title D026 Dashcam Viewer

echo ======================================================
echo    🚗 INICIANDO D026 DASHCAM VIEWER & GPS STUDIO
echo ======================================================

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

if not "%~1"=="" (
    echo [OK] Carpeta indicada: %~1
    start "" http://localhost:3000
    node server.js "%~1"
) else (
    echo [OK] Iniciando con la ultima carpeta configurada...
    start "" http://localhost:3000
    node server.js
)

pause
