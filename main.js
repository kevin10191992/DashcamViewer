const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

// Allow dragging & dropping a folder onto the EXE or passing via CLI
if (process.argv.length > 1) {
    const candidatePath = process.argv[process.argv.length - 1];
    if (candidatePath && !candidatePath.startsWith('-') && fs.existsSync(candidatePath)) {
        try {
            const stat = fs.statSync(candidatePath);
            if (stat.isDirectory()) {
                process.env.DASHCAM_DIR = path.resolve(candidatePath);
                console.log('[Electron] Carpeta detectada por argumento:', process.env.DASHCAM_DIR);
            }
        } catch (e) {}
    }
}

// Start the Express server internally
try {
    require('./server.js');
} catch (e) {
    console.error('[Electron] Error iniciando servidor interno:', e);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        title: 'D026 Dashcam Viewer & GPS Route Studio',
        backgroundColor: '#070a10',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.setMenuBarVisibility(false);

    // Wait a brief moment for the express server to be ready
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 600);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
