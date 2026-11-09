const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec } = require('child_process');
const { scanAllClips, resolveVideoDirectories, exportToGPX, exportToGeoJSON, exportToKML } = require('./gps-parser');
const { exportVideoClip } = require('./video-exporter');
const logger = require('./logger');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const APP_DIR = __dirname;

function resolveDataDir() {
    if (process.env.DASHCAM_DATA_DIR) {
        return path.resolve(process.env.DASHCAM_DATA_DIR);
    }
    if (__dirname.includes('app.asar') || process.resourcesPath) {
        const base = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : os.tmpdir());
        const dir = path.join(base, 'd026-dashcam-viewer');
        return dir;
    }
    return APP_DIR;
}

const DATA_DIR = resolveDataDir();

function getFFmpegPath() {
    const isWin = process.platform === 'win32';
    const binName = isWin ? 'ffmpeg.exe' : 'ffmpeg';

    if (process.resourcesPath) {
        const prodBin = path.join(process.resourcesPath, 'bin', binName);
        if (fs.existsSync(prodBin)) return prodBin;
    }

    const localBin = path.join(APP_DIR, 'bin', binName);
    if (fs.existsSync(localBin)) return localBin;

    if (isWin) {
        const sysPath = 'C:\\Program Files (x86)\\GPS Media Player\\resources\\deps\\windows\\ffmpeg.exe';
        if (fs.existsSync(sysPath)) return sysPath;
    }

    return 'ffmpeg';
}

const FFMPEG_PATH = getFFmpegPath();

app.use(express.json());

// Configuration management
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
let config = {
    dashcamDir: process.env.DASHCAM_DIR || (fs.existsSync(path.join(path.dirname(APP_DIR), 'D026DASHCAM')) ? path.join(path.dirname(APP_DIR), 'D026DASHCAM') : ''),
    defaultCopyDir: process.env.COPY_DIR || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Videos', 'Dashcam') : path.join(DATA_DIR, 'exports'))
};

// Check if bundled default config exists
const bundledConfigFile = path.join(APP_DIR, 'config.json');
if (fs.existsSync(bundledConfigFile)) {
    try {
        config = { ...config, ...JSON.parse(fs.readFileSync(bundledConfigFile, 'utf8')) };
    } catch (e) {}
}

// Load saved config if exists in DATA_DIR
if (fs.existsSync(CONFIG_FILE)) {
    try {
        config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch (e) {
        logger.warn('No se pudo leer config.json del usuario, usando valores por defecto.');
    }
}

// 1. Priority: Environment variable DASHCAM_DIR
if (process.env.DASHCAM_DIR && fs.existsSync(process.env.DASHCAM_DIR)) {
    config.dashcamDir = path.resolve(process.env.DASHCAM_DIR);
}

// 2. Highest Priority: Command line argument (e.g. node server.js "D:\DashcamVideos")
if (process.argv[2]) {
    const cliPath = path.resolve(process.argv[2]);
    if (fs.existsSync(cliPath)) {
        config.dashcamDir = cliPath;
        logger.info(`[Config] Usando ruta pasada por argumento: ${config.dashcamDir}`);
    } else {
        logger.warn(`[Config] La ruta pasada por argumento no existe: ${cliPath}`);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        logger.info(`[Config] Configuración guardada en ${CONFIG_FILE}`);
    } catch (e) {
        logger.error('[Config] Error guardando config.json:', e);
    }
}

// Ensure required persistent directories exist in DATA_DIR
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');
const CACHE_DIR = path.join(DATA_DIR, 'cache_mp4');
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    ['F', 'R'].forEach(cam => {
        const p = path.join(CACHE_DIR, cam);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
    saveConfig();
} catch (err) {
    logger.error('Error inicializando directorios de datos:', err);
}

// Helper: locate exact file on disk using flexible directory structure
function resolveClipPath(camera, filename) {
    const layout = resolveVideoDirectories(config.dashcamDir);
    if (!layout) return null;

    if (layout.mode === 'split_folders') {
        const baseDir = camera === 'F' ? layout.dirF : (layout.dirR || layout.dirF);
        const p = path.join(baseDir, filename);
        return fs.existsSync(p) ? p : null;
    } else {
        const p = path.join(layout.dir, filename);
        return fs.existsSync(p) ? p : null;
    }
}

// Cache scanned metadata in memory
let cachedJourney = null;
function getJourneyData(forceRefresh = false) {
    if (!cachedJourney || forceRefresh) {
        console.log(`\n[Scanner] Analizando carpeta: ${config.dashcamDir}`);
        const t0 = Date.now();
        cachedJourney = scanAllClips(config.dashcamDir);
        console.log(`[Scanner] Completado en ${Date.now() - t0}ms. Clips encontrados: ${cachedJourney.clips.length}, Puntos GPS: ${cachedJourney.allPoints.length}`);
    }
    return cachedJourney;
}

// Helper: Generate clean, human-readable clip filename
function formatFriendlyName(clip, camera = 'F', format = 'mp4', template = 'datetime', customText = '') {
    const camLabel = camera === 'F' ? 'Frontal' : 'Trasera';
    const ext = format.toLowerCase().startsWith('mp4') ? 'mp4' : 'ts';

    const match = clip.filename.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(\d+)/);
    if (!match) {
        return `Clip_${clip.id + 1}_${camLabel}.${ext}`;
    }
    const [_, y, m, d, hh, mm, ss, seq] = match;
    const clipNum = String(parseInt(seq, 10)).padStart(3, '0');

    if (customText && customText.trim()) {
        const cleanCustom = customText.trim().replace(/[\\/:*?"<>|]/g, '_');
        return `${cleanCustom}_${camLabel}.${ext}`;
    }

    if (template === 'detailed') {
        const speedStr = clip.maxSpeed ? `_Max${Math.round(clip.maxSpeed)}kmh` : '';
        return `Clip-${clipNum}_${y}-${m}-${d}_${hh}h${mm}m${speedStr}_${camLabel}.${ext}`;
    }

    return `${y}-${m}-${d}_${hh}h${mm}m${ss}s_${camLabel}.${ext}`;
}

// Pre-load data on startup
getJourneyData();

// Serve vendor libraries directly from node_modules
app.use('/lib/leaflet', express.static(path.join(APP_DIR, 'node_modules', 'leaflet', 'dist')));
app.use('/lib/mpegts', express.static(path.join(APP_DIR, 'node_modules', 'mpegts.js', 'dist')));

// Serve static frontend assets
app.use(express.static(path.join(APP_DIR, 'public')));
app.use('/exports', express.static(EXPORTS_DIR));

// -------------------------------------------------------------
// Settings APIs
// -------------------------------------------------------------

// Native Windows Folder Browser Dialog
app.post('/api/select-folder-dialog', (req, res) => {
    if (process.platform !== 'win32') {
        return res.json({ success: false, message: 'El diálogo nativo de carpetas solo está disponible en Windows. Puedes ingresar la ruta en el campo de texto.' });
    }
    const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = "Selecciona la carpeta de grabaciones de la Dashcam"
        $dlg.ShowNewFolderButton = $true
        $win = New-Object System.Windows.Forms.NativeWindow
        $hwnd = (Get-Process -Id $PID).MainWindowHandle
        $win.AssignHandle($hwnd)
        if ($dlg.ShowDialog($win) -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $dlg.SelectedPath
        }
    `;
    const child = spawn('powershell', ['-NoProfile', '-Command', psScript]);
    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.on('close', () => {
        const selected = output.trim();
        if (selected && fs.existsSync(selected)) {
            res.json({ success: true, path: selected });
        } else {
            res.json({ success: false, cancelled: true });
        }
    });
});

app.get('/api/settings', (req, res) => {
    res.json(config);
});

app.post('/api/settings', (req, res) => {
    const { dashcamDir, defaultCopyDir } = req.body;
    let changedDir = false;

    if (dashcamDir) {
        const cleanPath = path.resolve(dashcamDir.trim().replace(/^["']|["']$/g, ''));
        if (!fs.existsSync(cleanPath)) {
            return res.status(400).json({ error: `La ruta no existe en tu equipo: ${cleanPath}` });
        }
        if (config.dashcamDir !== cleanPath) {
            config.dashcamDir = cleanPath;
            changedDir = true;
        }
    }

    if (defaultCopyDir) {
        config.defaultCopyDir = path.resolve(defaultCopyDir.trim().replace(/^["']|["']$/g, ''));
    }

    saveConfig();

    if (changedDir) {
        getJourneyData(true);
    }

    const data = getJourneyData();
    res.json({
        success: true,
        config,
        clipsCount: data.clips.length,
        summary: data.summary
    });
});

// -------------------------------------------------------------
// Data APIs
// -------------------------------------------------------------

app.get('/api/clips', (req, res) => {
    const data = getJourneyData();
    res.json({
        summary: data.summary,
        clips: data.clips,
        dashcamDir: config.dashcamDir
    });
});

app.get('/api/route', (req, res) => {
    const data = getJourneyData();
    const geojson = exportToGeoJSON(data.allPoints, data.clips);
    res.json(geojson);
});

app.get('/api/clip/:id', (req, res) => {
    const clipId = parseInt(req.params.id);
    const data = getJourneyData();
    const clip = data.clips.find(c => c.id === clipId);
    if (!clip) return res.status(404).json({ error: 'Clip not found' });

    const clipPoints = data.allPoints.filter(p => p.clipId === clipId);
    res.json({ clip, points: clipPoints });
});

// -------------------------------------------------------------
// Full Journey Downloads
// -------------------------------------------------------------

app.get('/api/export/gpx', (req, res) => {
    const data = getJourneyData();
    const gpx = exportToGPX(data.allPoints, 'D026 Dashcam Trayecto Completo');
    res.setHeader('Content-Disposition', 'attachment; filename="trayecto_completo.gpx"');
    res.setHeader('Content-Type', 'application/gpx+xml');
    res.send(gpx);
});

app.get('/api/export/geojson', (req, res) => {
    const data = getJourneyData();
    const geojson = exportToGeoJSON(data.allPoints, data.clips);
    res.setHeader('Content-Disposition', 'attachment; filename="trayecto_completo.geojson"');
    res.setHeader('Content-Type', 'application/geo+json');
    res.send(JSON.stringify(geojson, null, 2));
});

app.get('/api/export/kml', (req, res) => {
    const data = getJourneyData();
    const kml = exportToKML(data.allPoints, 'D026 Dashcam Trayecto Completo');
    res.setHeader('Content-Disposition', 'attachment; filename="trayecto_completo.kml"');
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
    res.send(kml);
});

// -------------------------------------------------------------
// Friendly Clip Copy & Export Feature
// -------------------------------------------------------------

app.post('/api/copy-clip', async (req, res) => {
    try {
        const {
            clipId,
            camera = 'F',
            destinationDir,
            format = 'mp4',
            template = 'datetime',
            customName = ''
        } = req.body;

        const targetDir = destinationDir ? path.resolve(destinationDir) : config.defaultCopyDir;
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        config.defaultCopyDir = targetDir;
        saveConfig();

        const data = getJourneyData();
        const clip = data.clips.find(c => c.id === parseInt(clipId));
        if (!clip) return res.status(404).json({ error: 'Clip no encontrado' });

        const camerasToProcess = camera === 'both' ? ['F', 'R'] : [camera.toUpperCase()];
        const results = [];

        for (const cam of camerasToProcess) {
            const rawFile = cam === 'F' ? clip.frontFile : (clip.rearFile || null);
            if (!rawFile) continue;

            const srcPath = resolveClipPath(cam, rawFile);
            if (!srcPath) continue;

            const friendlyFilename = formatFriendlyName(clip, cam, format, template, customName);
            const dstPath = path.join(targetDir, friendlyFilename);

            if (format.toLowerCase() === 'ts') {
                fs.copyFileSync(srcPath, dstPath);
                const stat = fs.statSync(dstPath);
                results.push({
                    camera: cam,
                    filename: friendlyFilename,
                    path: dstPath,
                    sizeBytes: stat.size,
                    format: 'ts'
                });
            } else {
                await new Promise((resolve, reject) => {
                    const proc = spawn(FFMPEG_PATH, [
                        '-y',
                        '-i', srcPath,
                        '-map', '0:0',
                        '-map', '0:2',
                        '-c', 'copy',
                        '-movflags', '+faststart',
                        dstPath
                    ]);
                    proc.on('close', code => {
                        if (code === 0 && fs.existsSync(dstPath)) {
                            const stat = fs.statSync(dstPath);
                            results.push({
                                camera: cam,
                                filename: friendlyFilename,
                                path: dstPath,
                                sizeBytes: stat.size,
                                format: 'mp4'
                            });
                            resolve();
                        } else {
                            reject(new Error(`FFmpeg falló al remuxear con código ${code}`));
                        }
                    });
                    proc.on('error', reject);
                });
            }
        }

        res.json({
            success: true,
            destinationDir: targetDir,
            copiedFiles: results,
            message: `Se copiaron ${results.length} archivo(s) a ${targetDir}`
        });
    } catch (err) {
        console.error('Error copying clip:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/download-clip/:clipId/:camera/:format', (req, res) => {
    const clipId = parseInt(req.params.clipId);
    const camera = req.params.camera.toUpperCase();
    const format = req.params.format.toLowerCase();
    const template = req.query.template || 'datetime';
    const customName = req.query.name || '';

    const data = getJourneyData();
    const clip = data.clips.find(c => c.id === clipId);
    if (!clip) return res.status(404).send('Clip no encontrado');

    const rawFile = camera === 'F' ? clip.frontFile : (clip.rearFile || null);
    if (!rawFile) return res.status(404).send('Archivo de video no disponible');

    const srcPath = resolveClipPath(camera, rawFile);
    if (!srcPath) return res.status(404).send('Archivo no encontrado');

    const friendlyFilename = formatFriendlyName(clip, camera, format, template, customName);

    if (format === 'ts') {
        res.setHeader('Content-Disposition', `attachment; filename="${friendlyFilename}"`);
        res.setHeader('Content-Type', 'video/mp2t');
        return res.sendFile(srcPath);
    }

    const mp4CacheName = rawFile.replace(/\.ts$/i, '.mp4');
    const mp4CachePath = path.join(CACHE_DIR, camera, mp4CacheName);

    const sendCachedMp4 = () => {
        res.setHeader('Content-Disposition', `attachment; filename="${friendlyFilename}"`);
        res.setHeader('Content-Type', 'video/mp4');
        res.sendFile(mp4CachePath);
    };

    if (fs.existsSync(mp4CachePath)) {
        return sendCachedMp4();
    }

    const proc = spawn(FFMPEG_PATH, [
        '-y',
        '-i', srcPath,
        '-map', '0:0',
        '-map', '0:2',
        '-c', 'copy',
        '-movflags', '+faststart',
        mp4CachePath
    ]);
    proc.on('close', code => {
        if (code === 0 && fs.existsSync(mp4CachePath)) {
            sendCachedMp4();
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${friendlyFilename.replace(/\.mp4$/, '.ts')}"`);
            res.sendFile(srcPath);
        }
    });
});

app.post('/api/open-folder', (req, res) => {
    const { filePath, folderPath } = req.body;
    let target = folderPath || (filePath ? path.dirname(filePath) : config.defaultCopyDir);

    if (process.platform === 'win32') {
        if (filePath && fs.existsSync(filePath)) {
            exec(`explorer.exe /select,"${filePath}"`);
        } else if (target && fs.existsSync(target)) {
            exec(`explorer.exe "${target}"`);
        }
    } else if (process.platform === 'darwin') {
        if (filePath && fs.existsSync(filePath)) {
            exec(`open -R "${filePath}"`);
        } else if (target && fs.existsSync(target)) {
            exec(`open "${target}"`);
        }
    } else {
        if (target && fs.existsSync(target)) {
            exec(`xdg-open "${target}"`);
        }
    }

    res.json({ success: true });
});

// -------------------------------------------------------------
// Video Streaming Endpoints
// -------------------------------------------------------------

app.get('/video/raw/:cam/:file', (req, res) => {
    const cam = req.params.cam.toUpperCase();
    const file = path.basename(req.params.file);
    const filePath = resolveClipPath(cam, file);

    if (!filePath) return res.status(404).send('Video not found');
    res.sendFile(filePath);
});

app.get('/video/mp4/:cam/:file', (req, res) => {
    const cam = req.params.cam.toUpperCase();
    const file = path.basename(req.params.file);
    const tsPath = resolveClipPath(cam, file);

    if (!tsPath) return res.status(404).send('Video file not found');

    const mp4Name = file.replace(/\.ts$/i, '.mp4');
    const mp4Path = path.join(CACHE_DIR, cam, mp4Name);

    if (fs.existsSync(mp4Path)) {
        return res.sendFile(mp4Path);
    }

    const proc = spawn(FFMPEG_PATH, [
        '-y',
        '-i', tsPath,
        '-map', '0:0',
        '-map', '0:2',
        '-c', 'copy',
        '-movflags', '+faststart',
        mp4Path
    ]);

    proc.on('close', code => {
        if (code === 0 && fs.existsSync(mp4Path)) {
            res.sendFile(mp4Path);
        } else {
            res.sendFile(tsPath);
        }
    });

    proc.on('error', () => {
        res.sendFile(tsPath);
    });
});

// -------------------------------------------------------------
// Video Export Jobs
// -------------------------------------------------------------

const exportJobs = new Map();

app.post('/api/export-video', async (req, res) => {
    const { clipFilename, camera = 'F', resolution = '1080p' } = req.body;
    const cam = camera.toUpperCase();
    const inputFilePath = resolveClipPath(cam, path.basename(clipFilename));

    if (!inputFilePath) {
        return res.status(404).json({ error: 'Video clip not found' });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const baseName = path.basename(clipFilename, path.extname(clipFilename));
    const outFileName = `render_${baseName}_hud_${resolution}.mp4`;
    const outputFilePath = path.join(EXPORTS_DIR, outFileName);

    const job = {
        id: jobId,
        clipFilename,
        camera: cam,
        resolution,
        status: 'rendering',
        progress: 0,
        currentSec: 0,
        outFileName,
        downloadUrl: `/exports/${outFileName}`,
        error: null
    };

    exportJobs.set(jobId, job);
    res.json({ success: true, jobId, message: 'Export job started', job });

    try {
        await exportVideoClip({
            inputFilePath,
            outputFilePath,
            camera: cam,
            resolution,
            onProgress: (pct, sec) => {
                job.progress = pct;
                job.currentSec = Math.round(sec);
            }
        });
        job.status = 'completed';
        job.progress = 100;
    } catch (err) {
        job.status = 'failed';
        job.error = err.message;
    }
});

app.get('/api/export-status/:jobId', (req, res) => {
    const job = exportJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

// Start server function with automatic port conflict handling
function startServer(port = PORT) {
    return new Promise((resolve, reject) => {
        const tryListen = (p) => {
            const server = app.listen(p, () => {
                const actualPort = server.address().port;
                logger.info(`\n======================================================`);
                logger.info(`  🚗 D026 DASHCAM VIEWER ESTÁ LISTO Y EN EJECUCIÓN`);
                logger.info(`  📁 Carpeta de Grabaciones: ${config.dashcamDir || '(No seleccionada)'}`);
                logger.info(`  📁 Carpeta de Datos:       ${DATA_DIR}`);
                logger.info(`  📁 Carpeta del Proyecto:   ${APP_DIR}`);
                logger.info(`  📁 Binario FFmpeg:         ${FFMPEG_PATH}`);
                logger.info(`  🔗 Abre en tu navegador:   http://localhost:${actualPort}`);
                logger.info(`======================================================\n`);
                resolve({ server, port: actualPort, app });
            });

            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE' && p < port + 10) {
                    logger.warn(`Puerto ${p} ocupado, intentando con puerto ${p + 1}...`);
                    tryListen(p + 1);
                } else {
                    logger.error(`Error al iniciar servidor en puerto ${p}:`, err);
                    reject(err);
                }
            });
        };

        tryListen(port);
    });
}

if (require.main === module) {
    startServer().catch(err => {
        logger.error('Error fatal al iniciar servidor:', err);
        process.exit(1);
    });
}

module.exports = { app, startServer, config, saveConfig, logger, DATA_DIR, EXPORTS_DIR, CACHE_DIR };
