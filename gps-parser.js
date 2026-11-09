const fs = require('fs');
const path = require('path');

// Haversine distance in km
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function parseClipGPS(filePath) {
    if (!fs.existsSync(filePath)) {
        return { points: [], duration: 0, distanceKm: 0, maxSpeed: 0, avgSpeed: 0, startTime: null, endTime: null };
    }

    const stat = fs.statSync(filePath);
    if (stat.size < 16) return { points: [], duration: 0, distanceKm: 0, maxSpeed: 0, avgSpeed: 0, startTime: null, endTime: null };

    const fd = fs.openSync(filePath, 'r');
    const tail = Buffer.alloc(8);
    fs.readSync(fd, tail, 0, 8, stat.size - 8);
    const tag = tail.slice(0, 4).toString('ascii');

    let points = [];
    if (tag === '####') {
        const tableSize = tail.readUInt32BE(4);
        const buf = Buffer.alloc(tableSize);
        fs.readSync(fd, buf, 0, tableSize, stat.size - 8 - tableSize);
        fs.closeSync(fd);

        const text = buf.toString('latin1');
        const regex = /(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+([NS]):([\d\.]+)\s+([EW]):([\d\.]+)\s+([\d\.]+)\s*km\/h\s+x:([-\d\.]+)\s+y:([-\d\.]+)\s+z:([-\d\.]+)\s+A:([-\d\.]+)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            let lat = parseFloat(match[3]);
            if (match[2] === 'S') lat = -lat;
            let lon = parseFloat(match[5]);
            if (match[4] === 'W') lon = -lon;
            const speed_kmh = parseFloat(match[6]);
            const bearing = parseFloat(match[10]);

            if (lat !== 0 || lon !== 0) {
                points.push({
                    time: match[1],
                    isoTime: new Date(match[1].replace(/\//g, '-') + 'Z').toISOString(),
                    lat,
                    lon,
                    speed_kmh,
                    bearing,
                    x: parseFloat(match[7]),
                    y: parseFloat(match[8]),
                    z: parseFloat(match[9])
                });
            }
        }
    } else {
        fs.closeSync(fd);
        try {
            const buf = fs.readFileSync(filePath);
            let idx = 0;
            while ((idx = buf.indexOf('Newfloat', idx)) !== -1) {
                const p = idx + 8;
                if (p + 72 <= buf.length) {
                    const hour = buf.readInt32LE(p + 8);
                    const min = buf.readInt32LE(p + 12);
                    const sec = buf.readInt32LE(p + 16);
                    const year = buf.readInt32LE(p + 20);
                    const month = buf.readInt32LE(p + 24);
                    const day = buf.readInt32LE(p + 28);
                    const speedKnots = buf.readFloatLE(p + 56);
                    const bearing = buf.readFloatLE(p + 60);

                    const timeStr = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
                    points.push({
                        time: timeStr,
                        isoTime: new Date(timeStr.replace(/\//g, '-') + 'Z').toISOString(),
                        lat: 0,
                        lon: 0,
                        speed_kmh: Math.round(speedKnots * 1.852 * 10) / 10,
                        bearing: Math.round(bearing * 10) / 10,
                        x: 0, y: 0, z: 0
                    });
                }
                idx += 8;
            }
        } catch (e) {
            console.error('Error reading Newfloat fallback:', e);
        }
    }

    let totalDist = 0;
    let maxSpeed = 0;
    let speedSum = 0;
    for (let i = 0; i < points.length; i++) {
        if (points[i].speed_kmh > maxSpeed) maxSpeed = points[i].speed_kmh;
        speedSum += points[i].speed_kmh;
        if (i > 0 && points[i].lat !== 0 && points[i - 1].lat !== 0) {
            totalDist += haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
        }
    }

    return {
        points,
        duration: points.length,
        distanceKm: Math.round(totalDist * 1000) / 1000,
        maxSpeed: Math.round(maxSpeed * 10) / 10,
        avgSpeed: points.length > 0 ? Math.round((speedSum / points.length) * 10) / 10 : 0,
        startTime: points.length > 0 ? points[0].time : null,
        endTime: points.length > 0 ? points[points.length - 1].time : null
    };
}

// Automatically resolves and detects how the dashcam folder is structured:
// 1. Root of SD card: contains 'video/F' and optionally 'video/R'
// 2. Direct folder: contains 'F' and optionally 'R'
// 3. Flat folder: contains .ts files directly
function resolveVideoDirectories(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) return null;

    // Structure 1: baseDir/video/F
    const vf = path.join(targetPath, 'video', 'F');
    const vr = path.join(targetPath, 'video', 'R');
    if (fs.existsSync(vf)) {
        return {
            mode: 'split_folders',
            dirF: vf,
            dirR: fs.existsSync(vr) ? vr : null
        };
    }

    // Structure 2: baseDir/F
    const directF = path.join(targetPath, 'F');
    const directR = path.join(targetPath, 'R');
    if (fs.existsSync(directF)) {
        return {
            mode: 'split_folders',
            dirF: directF,
            dirR: fs.existsSync(directR) ? directR : null
        };
    }

    // Structure 3: Flat folder with .ts files directly in targetPath
    const tsFiles = fs.readdirSync(targetPath).filter(f => f.toLowerCase().endsWith('.ts'));
    if (tsFiles.length > 0) {
        return {
            mode: 'flat_folder',
            dir: targetPath,
            files: tsFiles
        };
    }

    // Structure 4: Search immediate subfolders for a 'video' or 'F' folder
    try {
        const subdirs = fs.readdirSync(targetPath, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const d of subdirs) {
            const sub = path.join(targetPath, d.name);
            const res = resolveVideoDirectories(sub);
            if (res) return res;
        }
    } catch (e) {}

    return null;
}

// Scans any dashcam directory regardless of how it is passed
function scanAllClips(baseDir) {
    const layout = resolveVideoDirectories(baseDir);
    if (!layout) {
        return {
            summary: { totalClips: 0, totalPoints: 0, totalDistanceKm: 0, overallMaxSpeed: 0, startTime: null, endTime: null },
            clips: [],
            allPoints: [],
            detectedLayout: null,
            dashcamDir: baseDir
        };
    }

    let filesF = [];
    let filesR = [];
    let getFullPath = (cam, file) => '';

    if (layout.mode === 'split_folders') {
        filesF = fs.existsSync(layout.dirF) ? fs.readdirSync(layout.dirF).filter(f => f.toLowerCase().endsWith('.ts')).sort() : [];
        filesR = layout.dirR && fs.existsSync(layout.dirR) ? fs.readdirSync(layout.dirR).filter(f => f.toLowerCase().endsWith('.ts')).sort() : [];
        getFullPath = (cam, file) => path.join(cam === 'F' ? layout.dirF : layout.dirR, file);
    } else {
        // Flat folder
        const allTs = layout.files.sort();
        filesF = allTs.filter(f => /F\.ts$/i.test(f) || !/R\.ts$/i.test(f));
        filesR = allTs.filter(f => /R\.ts$/i.test(f));
        getFullPath = (cam, file) => path.join(layout.dir, file);
    }

    // Map rear files by sequence number or base timestamp
    const rearMap = new Map();
    for (const rf of filesR) {
        const baseKey = rf.replace(/R\.ts$/i, '');
        rearMap.set(baseKey, rf);
    }

    const clips = [];
    const allPoints = [];
    let cumulativeDistance = 0;
    let overallMaxSpeed = 0;
    let lastValidPoint = null;

    for (let i = 0; i < filesF.length; i++) {
        const f = filesF[i];
        const filePath = getFullPath('F', f);
        const stat = fs.statSync(filePath);
        const clipData = parseClipGPS(filePath);

        const baseKey = f.replace(/F\.ts$/i, '');
        const rearFile = rearMap.get(baseKey) || null;

        for (const pt of clipData.points) {
            if (pt.lat === 0 && pt.lon === 0 && lastValidPoint) {
                pt.lat = lastValidPoint.lat;
                pt.lon = lastValidPoint.lon;
            } else if (pt.lat !== 0 && pt.lon !== 0) {
                lastValidPoint = pt;
            }
        }

        const clipObj = {
            id: i,
            filename: f,
            frontFile: f,
            rearFile,
            sizeBytes: stat.size,
            durationSec: clipData.duration,
            distanceKm: clipData.distanceKm,
            maxSpeed: clipData.maxSpeed,
            avgSpeed: clipData.avgSpeed,
            startTime: clipData.startTime,
            endTime: clipData.endTime,
            pointsCount: clipData.points.length,
            startCoord: clipData.points.length > 0 ? [clipData.points[0].lat, clipData.points[0].lon] : null,
            endCoord: clipData.points.length > 0 ? [clipData.points[clipData.points.length - 1].lat, clipData.points[clipData.points.length - 1].lon] : null
        };

        for (let pIdx = 0; pIdx < clipData.points.length; pIdx++) {
            const pt = clipData.points[pIdx];
            if (pt.lat !== 0 && pt.lon !== 0) {
                if (pt.speed_kmh > overallMaxSpeed) overallMaxSpeed = pt.speed_kmh;
                allPoints.push({
                    clipId: i,
                    secInClip: pIdx,
                    time: pt.time,
                    isoTime: pt.isoTime,
                    lat: pt.lat,
                    lon: pt.lon,
                    speed_kmh: pt.speed_kmh,
                    bearing: pt.bearing,
                    x: pt.x,
                    y: pt.y,
                    z: pt.z
                });
            }
        }

        cumulativeDistance += clipData.distanceKm;
        clips.push(clipObj);
    }

    return {
        summary: {
            totalClips: clips.length,
            totalPoints: allPoints.length,
            totalDistanceKm: Math.round(cumulativeDistance * 100) / 100,
            overallMaxSpeed: Math.round(overallMaxSpeed * 10) / 10,
            startTime: allPoints.length > 0 ? allPoints[0].time : null,
            endTime: allPoints.length > 0 ? allPoints[allPoints.length - 1].time : null
        },
        clips,
        allPoints,
        detectedLayout: layout,
        dashcamDir: baseDir
    };
}

// Generates standard GPX 1.1 XML
function exportToGPX(points, title = 'D026 Dashcam Unified Track') {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<gpx version="1.1" creator="D026 Dashcam Viewer" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n`;
    xml += `  <metadata>\n`;
    xml += `    <name>${escapeXml(title)}</name>\n`;
    xml += `    <time>${new Date().toISOString()}</time>\n`;
    xml += `  </metadata>\n`;
    xml += `  <trk>\n`;
    xml += `    <name>${escapeXml(title)}</name>\n`;
    xml += `    <trkseg>\n`;

    for (const pt of points) {
        if (pt.lat !== 0 && pt.lon !== 0) {
            const speedMs = (pt.speed_kmh / 3.6).toFixed(2);
            xml += `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lon.toFixed(6)}">\n`;
            xml += `        <time>${pt.isoTime || new Date(pt.time.replace(/\//g, '-') + 'Z').toISOString()}</time>\n`;
            xml += `        <speed>${speedMs}</speed>\n`;
            xml += `        <course>${pt.bearing.toFixed(1)}</course>\n`;
            xml += `      </trkpt>\n`;
        }
    }

    xml += `    </trkseg>\n`;
    xml += `  </trk>\n`;
    xml += `</gpx>\n`;
    return xml;
}

// Generates GeoJSON FeatureCollection
function exportToGeoJSON(points, clips = []) {
    const coordinates = [];
    const timestamps = [];
    const speeds = [];
    const bearings = [];

    for (const pt of points) {
        if (pt.lat !== 0 && pt.lon !== 0) {
            coordinates.push([pt.lon, pt.lat]);
            timestamps.push(pt.time);
            speeds.push(pt.speed_kmh);
            bearings.push(pt.bearing);
        }
    }

    const geojson = {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: {
                    name: 'D026 Dashcam Full Route',
                    pointCount: coordinates.length,
                    timestamps,
                    speeds,
                    bearings
                },
                geometry: {
                    type: 'LineString',
                    coordinates
                }
            }
        ]
    };

    for (const c of clips) {
        if (c.startCoord) {
            geojson.features.push({
                type: 'Feature',
                properties: {
                    type: 'clip_start',
                    clipId: c.id,
                    filename: c.filename,
                    startTime: c.startTime,
                    maxSpeed: c.maxSpeed,
                    distanceKm: c.distanceKm
                },
                geometry: {
                    type: 'Point',
                    coordinates: [c.startCoord[1], c.startCoord[0]]
                }
            });
        }
    }

    return geojson;
}

function exportToKML(points, title = 'D026 Dashcam Route') {
    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    kml += `<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
    kml += `  <Document>\n`;
    kml += `    <name>${escapeXml(title)}</name>\n`;
    kml += `    <Style id="dashcamPath">\n`;
    kml += `      <LineStyle>\n`;
    kml += `        <color>ff00ffff</color>\n`;
    kml += `        <width>5</width>\n`;
    kml += `      </LineStyle>\n`;
    kml += `    </Style>\n`;
    kml += `    <Placemark>\n`;
    kml += `      <name>Complete Track</name>\n`;
    kml += `      <styleUrl>#dashcamPath</styleUrl>\n`;
    kml += `      <LineString>\n`;
    kml += `        <extrude>1</extrude>\n`;
    kml += `        <tessellate>1</tessellate>\n`;
    kml += `        <coordinates>\n`;

    const coordStr = points
        .filter(pt => pt.lat !== 0 && pt.lon !== 0)
        .map(pt => `${pt.lon.toFixed(6)},${pt.lat.toFixed(6)},0`)
        .join(' ');

    kml += `          ${coordStr}\n`;
    kml += `        </coordinates>\n`;
    kml += `      </LineString>\n`;
    kml += `    </Placemark>\n`;
    kml += `  </Document>\n`;
    kml += `</kml>\n`;
    return kml;
}

function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, c => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

module.exports = {
    parseClipGPS,
    resolveVideoDirectories,
    scanAllClips,
    exportToGPX,
    exportToGeoJSON,
    exportToKML,
    haversineDistance
};
