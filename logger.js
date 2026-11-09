const fs = require('fs');
const path = require('path');
const os = require('os');

const logFiles = new Set();

// 1. Always in OS temp dir
try {
    const tempLog = path.join(os.tmpdir(), 'd026-dashcam-viewer.log');
    logFiles.add(tempLog);
} catch (e) {}

// 2. In Electron userData or APPDATA
try {
    let appDataDir = null;
    try {
        const electron = require('electron');
        const app = electron.app || (electron.remote && electron.remote.app);
        if (app && app.getPath) {
            appDataDir = app.getPath('userData');
        }
    } catch (e) {}

    if (!appDataDir && process.env.APPDATA) {
        appDataDir = path.join(process.env.APPDATA, 'd026-dashcam-viewer');
    }

    if (appDataDir) {
        if (!fs.existsSync(appDataDir)) fs.mkdirSync(appDataDir, { recursive: true });
        logFiles.add(path.join(appDataDir, 'd026-dashcam-viewer.log'));
    }
} catch (e) {}

// 3. In PORTABLE_EXECUTABLE_DIR if set and writable
if (process.env.PORTABLE_EXECUTABLE_DIR) {
    try {
        const pLog = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'd026-dashcam-viewer.log');
        fs.appendFileSync(pLog, '', 'utf8');
        logFiles.add(pLog);
    } catch (e) {}
}

// 4. In current working directory (e.g. temp extraction directory)
try {
    const cwdLog = path.join(process.cwd(), 'd026-dashcam-viewer.log');
    fs.appendFileSync(cwdLog, '', 'utf8');
    logFiles.add(cwdLog);
} catch (e) {}

function formatMsg(level, ...args) {
    const ts = new Date().toISOString();
    const body = args.map(arg => {
        if (arg instanceof Error) {
            return `${arg.message}\n${arg.stack}`;
        }
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch (e) { return String(arg); }
        }
        return String(arg);
    }).join(' ');
    return `[${ts}] [${level}] ${body}`;
}

function writeToFiles(line) {
    for (const file of logFiles) {
        try {
            fs.appendFileSync(file, line + '\n', 'utf8');
        } catch (e) {}
    }
}

const logger = {
    info(...args) {
        const line = formatMsg('INFO', ...args);
        console.log(line);
        writeToFiles(line);
    },
    warn(...args) {
        const line = formatMsg('WARN', ...args);
        console.warn(line);
        writeToFiles(line);
    },
    error(...args) {
        const line = formatMsg('ERROR', ...args);
        console.error(line);
        writeToFiles(line);
    },
    getLogPaths() {
        return Array.from(logFiles);
    },
    getPrimaryLogPath() {
        return Array.from(logFiles)[0] || path.join(os.tmpdir(), 'd026-dashcam-viewer.log');
    }
};

// Global crash handlers to guarantee unhandled errors are logged to disk
process.on('uncaughtException', (err) => {
    logger.error('CRASH FATAL (uncaughtException):', err);
});

process.on('unhandledRejection', (reason) => {
    logger.error('PROMISE REJECTION (unhandledRejection):', reason);
});

module.exports = logger;
