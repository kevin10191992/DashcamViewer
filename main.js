const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

process.on('uncaughtException', (err) => {
    logger.error('CRASH NO CONTROLADO EN MAIN PROCESS:', err);
    try {
        dialog.showErrorBox(
            'Error Inesperado - D026 Dashcam Viewer',
            `Ocurrió un error inesperado al ejecutar la aplicación:\n\n${err.message}\n\nPuedes revisar el archivo de log en:\n${logger.getPrimaryLogPath()}`
        );
    } catch (e) {}
});

logger.info(`================================================================`);
logger.info(`Iniciando D026 Dashcam Viewer (Electron v${process.versions.electron}, Node v${process.versions.node})`);
logger.info(`Argumentos CLI:`, process.argv);
logger.info(`Rutas de logs activas:`, logger.getLogPaths());

// Set user data dir for server.js to use
try {
    const userDataPath = app.getPath('userData');
    process.env.DASHCAM_DATA_DIR = userDataPath;
    logger.info(`Directorio de datos de usuario (userData): ${userDataPath}`);
} catch (e) {
    logger.warn('No se pudo obtener userData de app:', e);
}

// Allow dragging & dropping a folder onto the EXE or passing via CLI
if (process.argv.length > 1) {
    const candidatePath = process.argv[process.argv.length - 1];
    if (candidatePath && !candidatePath.startsWith('-') && fs.existsSync(candidatePath)) {
        try {
            const stat = fs.statSync(candidatePath);
            if (stat.isDirectory()) {
                process.env.DASHCAM_DIR = path.resolve(candidatePath);
                logger.info('[Electron] Carpeta detectada por argumento:', process.env.DASHCAM_DIR);
            }
        } catch (e) {}
    }
}

const { startServer } = require('./server.js');

let mainWindow = null;
let serverInstance = null;
let serverPort = null;

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        title: 'D026 Dashcam Viewer & GPS Route Studio',
        backgroundColor: '#070a10',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.setMenuBarVisibility(false);

    // Press F12 or Ctrl+Shift+I to open DevTools
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
            mainWindow.webContents.toggleDevTools();
        }
    });

    mainWindow.once('ready-to-show', () => {
        logger.info('Ventana principal lista para mostrarse (ready-to-show).');
        mainWindow.show();
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        logger.error(`Error cargando interfaz web en ${validatedURL}: [${errorCode}] ${errorDescription}`);
        const logPath = logger.getPrimaryLogPath();
        const errHtml = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="utf-8">
                <title>Error cargando interfaz</title>
                <style>
                    body { background: #070a10; color: #f1f2f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .card { background: #121824; border: 1px solid #ff4757; border-radius: 12px; padding: 32px; max-width: 650px; box-shadow: 0 10px 40px rgba(0,0,0,0.7); }
                    h2 { color: #ff4757; margin-top: 0; font-size: 22px; }
                    p { line-height: 1.5; color: #a4b0be; font-size: 14px; }
                    code { background: #1a2234; padding: 4px 8px; border-radius: 4px; color: #00d2d3; word-break: break-all; }
                    .btn-row { margin-top: 24px; display: flex; gap: 12px; }
                    button { background: #00d2d3; color: #070a10; border: none; padding: 10px 20px; font-weight: 700; border-radius: 6px; cursor: pointer; }
                    button:hover { background: #00b4b5; }
                    .btn-secondary { background: #2f3542; color: #f1f2f6; }
                    .btn-secondary:hover { background: #57606f; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>⚠️ No se pudo conectar con el servidor interno</h2>
                    <p>La ventana no pudo cargar la dirección: <code>${validatedURL}</code></p>
                    <p><strong>Detalle del error:</strong> <code>${errorDescription} (Código: ${errorCode})</code></p>
                    <p><strong>Archivo de log para diagnóstico:</strong><br><code>${logPath}</code></p>
                    <div class="btn-row">
                        <button onclick="location.reload()">🔄 Reintentar</button>
                        <button class="btn-secondary" onclick="window.close()">Cerrar</button>
                    </div>
                </div>
            </body>
            </html>
        `;
        mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errHtml)}`);
        if (!mainWindow.isVisible()) {
            mainWindow.show();
        }
    });

    try {
        if (!serverInstance) {
            logger.info('Iniciando servidor interno Express...');
            const result = await startServer(3000);
            serverInstance = result.server;
            serverPort = result.port;
        }

        const targetUrl = `http://localhost:${serverPort}`;
        logger.info(`Cargando interfaz en: ${targetUrl}`);
        await mainWindow.loadURL(targetUrl);
    } catch (err) {
        logger.error('Error fatal iniciando o conectando al servidor interno:', err);
        dialog.showErrorBox(
            'Error al iniciar D026 Dashcam Viewer',
            `No se pudo iniciar el servidor interno:\n\n${err.message}\n\nConsulta el archivo de log en:\n${logger.getPrimaryLogPath()}`
        );
        if (!mainWindow.isVisible()) {
            mainWindow.show();
        }
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    logger.info('Todas las ventanas cerradas. Saliendo de la aplicación...');
    if (serverInstance) {
        try { serverInstance.close(); } catch (e) {}
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
