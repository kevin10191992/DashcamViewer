const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseClipGPS } = require('./gps-parser');

function getFFmpegPath() {
    const isWin = process.platform === 'win32';
    const binName = isWin ? 'ffmpeg.exe' : 'ffmpeg';

    if (process.resourcesPath) {
        const prodBin = path.join(process.resourcesPath, 'bin', binName);
        if (fs.existsSync(prodBin)) return prodBin;
    }

    const localBin = path.join(__dirname, 'bin', binName);
    if (fs.existsSync(localBin)) return localBin;

    if (isWin) {
        const sysPath = 'C:\\Program Files (x86)\\GPS Media Player\\resources\\deps\\windows\\ffmpeg.exe';
        if (fs.existsSync(sysPath)) return sysPath;
    }

    return 'ffmpeg';
}

const FFMPEG_PATH = getFFmpegPath();

function formatAssTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function getCompassDir(bearing) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(((bearing % 360) + 360) % 360 / 45) % 8;
    return dirs[idx];
}

function generateAssHUD(points, playResX = 1920, playResY = 1080) {
    let ass = `[Script Info]
Title: Dashcam Telemetry HUD
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TopBar,Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&HB0000000,1,0,0,0,100,100,0,0,3,1,0,7,30,30,25
Style: BotBar,Arial,34,&H00FFFFFF,&H000000FF,&H00000000,&HD00a0e14,1,0,0,0,100,100,0,0,3,2,0,2,30,30,30
Style: SpeedLarge,Arial Black,58,&H0000F5FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,2,30,30,30

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const tStart = i;
        const tEnd = i + 1;
        const timeStartStr = formatAssTime(tStart);
        const timeEndStr = formatAssTime(tEnd);

        const compass = getCompassDir(pt.bearing);
        const latStr = pt.lat !== 0 ? `${Math.abs(pt.lat).toFixed(6)}° ${pt.lat >= 0 ? 'N' : 'S'}` : '--';
        const lonStr = pt.lon !== 0 ? `${Math.abs(pt.lon).toFixed(6)}° ${pt.lon >= 0 ? 'E' : 'W'}` : '--';
        const speed = Math.round(pt.speed_kmh);

        // Top Timestamp & Brand
        ass += `Dialogue: 0,${timeStartStr},${timeEndStr},TopBar,,0,0,0,,{\\c&H00D0FF&}D026 DASHCAM{\\c&HFFFFFF&}   |   ${pt.time}\n`;

        // Bottom Telemetry Bar: Speed (Cyan), Heading, Lat/Lon
        const hudText = `{\\c&H00F5FF&}{\\b1}${speed} km/h{\\b0}  {\\c&H606060&}|  {\\c&H00D0FF&}${Math.round(pt.bearing)}° ${compass}  {\\c&H606060&}|  {\\c&HFFFFFF&}LAT: ${latStr}  LON: ${lonStr}`;
        ass += `Dialogue: 0,${timeStartStr},${timeEndStr},BotBar,,0,0,0,,${hudText}\n`;
    }

    return ass;
}

function exportVideoClip({ inputFilePath, outputFilePath, camera = 'F', resolution = '1080p', onProgress = () => {} }) {
    return new Promise((resolve, reject) => {
        const clipData = parseClipGPS(inputFilePath);
        const points = clipData.points;
        const durationSec = Math.max(points.length, 1);

        const tempAssPath = outputFilePath.replace(/\.mp4$/i, '_hud.ass');
        const is1080p = resolution === '1080p';
        const resX = is1080p ? 1920 : 3840;
        const resY = is1080p ? 1080 : 2160;

        const assContent = generateAssHUD(points, resX, resY);
        fs.writeFileSync(tempAssPath, assContent, 'utf8');

        // Escape ASS path for FFmpeg filter on Windows
        const escapedAss = tempAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');

        let vf = `ass='${escapedAss}'`;
        if (is1080p) {
            vf = `scale=1920:1080,${vf}`;
        }

        const args = [
            '-y',
            '-i', inputFilePath,
            '-vf', vf,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '22',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            outputFilePath
        ];

        const proc = spawn(FFMPEG_PATH, args);

        proc.stderr.on('data', data => {
            const str = data.toString();
            // Parse time=00:00:15.24
            const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (timeMatch) {
                const curSec = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
                const pct = Math.min(Math.round((curSec / durationSec) * 100), 99);
                onProgress(pct, curSec);
            }
        });

        proc.on('close', code => {
            // Clean up temporary ASS file
            try { if (fs.existsSync(tempAssPath)) fs.unlinkSync(tempAssPath); } catch (e) {}

            if (code === 0) {
                onProgress(100, durationSec);
                resolve({ success: true, outputFilePath });
            } else {
                reject(new Error(`FFmpeg exited with error code ${code}`));
            }
        });

        proc.on('error', err => {
            try { if (fs.existsSync(tempAssPath)) fs.unlinkSync(tempAssPath); } catch (e) {}
            reject(err);
        });
    });
}

module.exports = {
    exportVideoClip,
    generateAssHUD
};
