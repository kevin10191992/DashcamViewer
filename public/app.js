/* ==========================================================================
   D026 DASHCAM VIEWER & GPS ROUTE STUDIO — FRONTEND CONTROLLER
   ========================================================================== */

(function () {
    'use strict';

    // Application State
    const state = {
        clips: [],
        summary: {},
        dashcamDir: '',
        defaultCopyDir: '',
        fullRouteGeoJSON: null,
        currentClipIndex: 0,
        currentCamera: 'F', // 'F' = Front, 'R' = Rear
        currentPoints: [], // Points for the current clip
        followVehicle: true,
        showHUD: true,
        autoAdvance: true,
        playbackSpeed: 1,
        isDraggingScrubber: false,
        mpegPlayer: null,
        activeExportJobId: null,
        lastCopiedFilePath: null
    };

    // DOM Elements
    const el = {
        // Header
        statClips: document.getElementById('statClips'),
        statDist: document.getElementById('statDist'),
        statMaxSpeed: document.getElementById('statMaxSpeed'),
        statDates: document.getElementById('statDates'),
        btnOpenVideoExport: document.getElementById('btnOpenVideoExport'),
        btnOpenCopyClip: document.getElementById('btnOpenCopyClip'),
        btnOpenSettings: document.getElementById('btnOpenSettings'),
        lblSourceFolder: document.getElementById('lblSourceFolder'),

        // Split & Panes
        splitViewport: document.getElementById('splitViewport'),
        splitDivider: document.getElementById('splitDivider'),
        btnResetSplit: document.getElementById('btnResetSplit'),
        videoPane: document.getElementById('videoPane'),
        mapPane: document.getElementById('mapPane'),
        btnExpandVideo: document.getElementById('btnExpandVideo'),
        btnExpandMap: document.getElementById('btnExpandMap'),

        // Video & HUD
        video: document.getElementById('dashcamVideo'),
        videoLoader: document.getElementById('videoLoader'),
        currentClipName: document.getElementById('currentClipName'),
        cameraBadge: document.getElementById('cameraBadge'),
        btnCamFront: document.getElementById('btnCamFront'),
        btnCamRear: document.getElementById('btnCamRear'),
        btnQuickSaveCurrent: document.getElementById('btnQuickSaveCurrent'),
        btnToggleHUD: document.getElementById('btnToggleHUD'),
        telemetryHUD: document.getElementById('telemetryHUD'),
        hudTimestamp: document.getElementById('hudTimestamp'),
        hudSpeed: document.getElementById('hudSpeed'),
        hudHeading: document.getElementById('hudHeading'),
        hudCardinal: document.getElementById('hudCardinal'),
        compassArrow: document.getElementById('compassArrow'),
        hudLat: document.getElementById('hudLat'),
        hudLon: document.getElementById('hudLon'),
        hudGSensor: document.getElementById('hudGSensor'),

        // Controls
        btnPlayPause: document.getElementById('btnPlayPause'),
        iconPlay: document.querySelector('.icon-play'),
        iconPause: document.querySelector('.icon-pause'),
        btnPrevClip: document.getElementById('btnPrevClip'),
        btnNextClip: document.getElementById('btnNextClip'),
        progressContainer: document.getElementById('progressContainer'),
        progressBarFill: document.getElementById('progressBarFill'),
        progressHandle: document.getElementById('progressHandle'),
        scrubTooltip: document.getElementById('scrubTooltip'),
        timeCurrent: document.getElementById('timeCurrent'),
        timeDuration: document.getElementById('timeDuration'),
        chkAutoAdvance: document.getElementById('chkAutoAdvance'),
        speedBtns: document.querySelectorAll('.speed-btn'),

        // Map
        mapContainer: document.getElementById('map'),
        btnFollowVehicle: document.getElementById('btnFollowVehicle'),
        selectMapLayer: document.getElementById('selectMapLayer'),

        // Clips Drawer
        clipsDrawer: document.getElementById('clipsDrawer'),
        btnToggleDrawer: document.getElementById('btnToggleDrawer'),
        clipsGrid: document.getElementById('clipsGrid'),
        clipsCount: document.getElementById('clipsCount'),
        inputSearchClips: document.getElementById('inputSearchClips'),

        // Copy Clip Modal
        copyModal: document.getElementById('copyModal'),
        btnCloseCopyModal: document.getElementById('btnCloseCopyModal'),
        btnCancelCopy: document.getElementById('btnCancelCopy'),
        copyClipSelect: document.getElementById('copyClipSelect'),
        copyCameraSelect: document.getElementById('copyCameraSelect'),
        copyFormatSelect: document.getElementById('copyFormatSelect'),
        rawClipPreview: document.getElementById('rawClipPreview'),
        lblResultingName: document.getElementById('lblResultingName'),
        customNameGroup: document.getElementById('customNameGroup'),
        inputCustomName: document.getElementById('inputCustomName'),
        inputDestDir: document.getElementById('inputDestDir'),
        btnBrowseDefaultDest: document.getElementById('btnBrowseDefaultDest'),
        btnExecuteCopy: document.getElementById('btnExecuteCopy'),
        btnDownloadDirect: document.getElementById('btnDownloadDirect'),
        copySuccessBanner: document.getElementById('copySuccessBanner'),
        copySuccessTitle: document.getElementById('copySuccessTitle'),
        copySuccessDesc: document.getElementById('copySuccessDesc'),
        btnOpenInExplorer: document.getElementById('btnOpenInExplorer'),

        // Settings Modal
        settingsModal: document.getElementById('settingsModal'),
        btnCloseSettingsModal: document.getElementById('btnCloseSettingsModal'),
        btnCancelSettings: document.getElementById('btnCancelSettings'),
        btnSaveSettings: document.getElementById('btnSaveSettings'),
        inputDashcamSourceDir: document.getElementById('inputDashcamSourceDir'),
        inputDefaultCopyDir: document.getElementById('inputDefaultCopyDir'),

        // Export Video Modal
        exportModal: document.getElementById('exportModal'),
        btnCloseModal: document.getElementById('btnCloseModal'),
        btnCancelExport: document.getElementById('btnCancelExport'),
        btnStartExport: document.getElementById('btnStartExport'),
        modalClipSelect: document.getElementById('modalClipSelect'),
        modalCameraSelect: document.getElementById('modalCameraSelect'),
        modalResSelect: document.getElementById('modalResSelect'),
        renderProgressBox: document.getElementById('renderProgressBox'),
        exportProgressFill: document.getElementById('exportProgressFill'),
        exportStatusText: document.getElementById('exportStatusText'),
        exportStatusPct: document.getElementById('exportStatusPct'),
        renderDoneBox: document.getElementById('renderDoneBox'),
        btnDownloadExportedVideo: document.getElementById('btnDownloadExportedVideo')
    };

    // Leaflet Objects
    let map = null;
    let baseLayers = {};
    let fullRouteLayer = null;
    let activeClipLayer = null;
    let vehicleMarker = null;

    // ==========================================================================
    // INITIALIZATION
    // ==========================================================================

    async function init() {
        initMap();
        setupSplitScreenResizer();
        setupEventListeners();
        await loadSettings();
        await loadJourneyData();
        await loadFullRoute();
    }

    async function loadSettings() {
        try {
            const res = await fetch('/api/settings');
            const cfg = await res.json();
            state.dashcamDir = cfg.dashcamDir;
            state.defaultCopyDir = cfg.defaultCopyDir;

            const baseName = cfg.dashcamDir.split(/[\\/]/).filter(Boolean).pop() || 'D026DASHCAM';
            el.lblSourceFolder.textContent = baseName;
            el.inputDashcamSourceDir.value = cfg.dashcamDir;
            el.inputDefaultCopyDir.value = cfg.defaultCopyDir;
            el.inputDestDir.value = cfg.defaultCopyDir;
        } catch (e) {
            console.error('Error loading settings:', e);
        }
    }

    // ==========================================================================
    // MAP SETUP (OPENSTREETMAP + LEAFLET)
    // ==========================================================================

    function initMap() {
        const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        });

        const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            attribution: '&copy; CartoDB &copy; OpenStreetMap'
        });

        const osmHot = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; Humanitarian OpenStreetMap'
        });

        baseLayers = { 'osm': osmStandard, 'dark': cartoDark, 'hot': osmHot };

        map = L.map('map', {
            center: [10.9278, -74.8272],
            zoom: 14,
            layers: [cartoDark],
            zoomControl: false
        });

        L.control.zoom({ position: 'topright' }).addTo(map);

        const carIcon = L.divIcon({
            className: 'vehicle-marker-icon',
            html: `
                <svg id="carSvg" width="34" height="34" viewBox="0 0 36 36" fill="none" class="car-svg">
                    <circle cx="18" cy="18" r="16" fill="rgba(0, 240, 255, 0.25)" stroke="#00f0ff" stroke-width="2"/>
                    <polygon points="18,6 26,26 18,22 10,26" fill="#00f0ff"/>
                </svg>
            `,
            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });

        vehicleMarker = L.marker([10.9278, -74.8272], { icon: carIcon, zIndexOffset: 1000 }).addTo(map);

        el.selectMapLayer.addEventListener('change', e => {
            const selected = e.target.value;
            Object.values(baseLayers).forEach(layer => map.removeLayer(layer));
            if (baseLayers[selected]) {
                baseLayers[selected].addTo(map);
            }
        });
    }

    // ==========================================================================
    // DATA LOADING
    // ==========================================================================

    async function loadJourneyData() {
        try {
            const res = await fetch('/api/clips');
            const data = await res.json();
            state.clips = data.clips;
            state.summary = data.summary;

            el.statClips.textContent = data.summary.totalClips;
            el.statDist.textContent = `${data.summary.totalDistanceKm} km`;
            el.statMaxSpeed.textContent = `${data.summary.overallMaxSpeed} km/h`;
            el.clipsCount.textContent = data.clips.length;

            if (data.summary.startTime && data.summary.endTime) {
                const sDate = data.summary.startTime.split(' ')[0];
                const eDate = data.summary.endTime.split(' ')[0];
                el.statDates.textContent = sDate === eDate ? sDate : `${sDate} a ${eDate}`;
            }

            renderClipsGrid();
            populateExportModalClips();
            populateCopyModalClips();

            if (state.clips.length > 0) {
                loadClip(0);
            }
        } catch (err) {
            console.error('Error loading journey data:', err);
        }
    }

    async function loadFullRoute() {
        try {
            const res = await fetch('/api/route');
            const geojson = await res.json();
            state.fullRouteGeoJSON = geojson;

            if (fullRouteLayer) map.removeLayer(fullRouteLayer);

            fullRouteLayer = L.geoJSON(geojson, {
                style: feature => {
                    if (feature.geometry.type === 'LineString') {
                        return {
                            color: '#00f0ff',
                            weight: 4,
                            opacity: 0.75,
                            lineCap: 'round',
                            lineJoin: 'round'
                        };
                    }
                },
                pointToLayer: (feature, latlng) => {
                    if (feature.properties && feature.properties.type === 'clip_start') {
                        return L.circleMarker(latlng, {
                            radius: 3,
                            fillColor: '#2563eb',
                            color: '#fff',
                            weight: 1,
                            opacity: 0.6,
                            fillOpacity: 0.8
                        });
                    }
                },
                onEachFeature: (feature, layer) => {
                    if (feature.geometry.type === 'LineString') {
                        layer.on('click', e => {
                            findNearestPointAndJump(e.latlng);
                        });
                    } else if (feature.properties && feature.properties.type === 'clip_start') {
                        layer.on('click', () => {
                            loadClip(feature.properties.clipId);
                        });
                        layer.bindTooltip(`Clip ${feature.properties.clipId + 1}: ${feature.properties.filename}<br>Vel: ${feature.properties.maxSpeed} km/h`, { direction: 'top' });
                    }
                }
            }).addTo(map);

            if (fullRouteLayer.getBounds().isValid()) {
                map.fitBounds(fullRouteLayer.getBounds(), { padding: [40, 40] });
            }
        } catch (err) {
            console.error('Error loading full route geojson:', err);
        }
    }

    // ==========================================================================
    // CLIP LOADING & PLAYBACK
    // ==========================================================================

    async function loadClip(index) {
        if (index < 0 || index >= state.clips.length) return;
        state.currentClipIndex = index;
        const clip = state.clips[index];

        el.currentClipName.textContent = clip.filename;
        updateCameraButtons(clip);

        document.querySelectorAll('.clip-card').forEach((card, idx) => {
            card.classList.toggle('active', idx === index);
            if (idx === index) {
                card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        });

        try {
            const res = await fetch(`/api/clip/${clip.id}`);
            const data = await res.json();
            state.currentPoints = data.points;
            renderActiveClipOnMap(clip, data.points);
        } catch (err) {
            console.error('Error loading clip points:', err);
            state.currentPoints = [];
        }

        loadVideoSource();
    }

    function updateCameraButtons(clip) {
        const hasRear = Boolean(clip.rearFile);
        el.btnCamRear.disabled = !hasRear;
        el.btnCamRear.style.opacity = hasRear ? '1' : '0.4';

        if (!hasRear && state.currentCamera === 'R') {
            state.currentCamera = 'F';
        }

        el.btnCamFront.classList.toggle('active', state.currentCamera === 'F');
        el.btnCamRear.classList.toggle('active', state.currentCamera === 'R');
        el.cameraBadge.textContent = state.currentCamera === 'F' ? 'DELANTERA (F)' : 'TRASERA (R)';
    }

    function loadVideoSource(preserveTime = 0) {
        const clip = state.clips[state.currentClipIndex];
        if (!clip) return;

        const filename = state.currentCamera === 'F' ? clip.frontFile : (clip.rearFile || clip.frontFile);
        el.videoLoader.classList.add('active');

        const videoUrl = `/video/mp4/${state.currentCamera}/${filename}`;

        el.video.src = videoUrl;
        el.video.playbackRate = state.playbackSpeed;

        el.video.onloadedmetadata = () => {
            el.videoLoader.classList.remove('active');
            el.timeDuration.textContent = formatTime(el.video.duration);
            if (preserveTime > 0) {
                el.video.currentTime = preserveTime;
            }
            updatePlayPauseUI();
        };

        el.video.onerror = () => {
            console.warn('MP4 playback fallback to mpegts.js...');
            loadMpegtsFallback(filename);
        };
    }

    function loadMpegtsFallback(filename) {
        if (window.mpegts && mpegts.isSupported()) {
            if (state.mpegPlayer) {
                state.mpegPlayer.destroy();
            }
            state.mpegPlayer = mpegts.createPlayer({
                type: 'mse',
                isLive: false,
                url: `/video/raw/${state.currentCamera}/${filename}`
            });
            state.mpegPlayer.attachMediaElement(el.video);
            state.mpegPlayer.load();
            el.videoLoader.classList.remove('active');
        }
    }

    function renderActiveClipOnMap(clip, points) {
        if (activeClipLayer) map.removeLayer(activeClipLayer);

        const latlngs = points
            .filter(p => p.lat !== 0 && p.lon !== 0)
            .map(p => [p.lat, p.lon]);

        if (latlngs.length > 0) {
            activeClipLayer = L.polyline(latlngs, {
                color: '#facc15',
                weight: 6,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(map);

            if (state.followVehicle) {
                map.panTo(latlngs[0]);
            }
        }
    }

    // ==========================================================================
    // TELEMETRY & PLAYBACK SYNCHRONIZATION
    // ==========================================================================

    el.video.addEventListener('timeupdate', () => {
        if (state.isDraggingScrubber) return;

        const curTime = el.video.currentTime;
        const dur = el.video.duration || 1;

        const pct = (curTime / dur) * 100;
        el.progressBarFill.style.width = `${pct}%`;
        el.progressHandle.style.left = `${pct}%`;
        el.timeCurrent.textContent = formatTime(curTime);

        const secIndex = Math.floor(curTime);
        let point = state.currentPoints[secIndex];
        if (!point && state.currentPoints.length > 0) {
            point = state.currentPoints[Math.min(secIndex, state.currentPoints.length - 1)];
        }

        if (point) {
            updateHUD(point);
            updateVehicleMarker(point);
        }
    });

    el.video.addEventListener('ended', () => {
        if (state.autoAdvance && state.currentClipIndex < state.clips.length - 1) {
            loadClip(state.currentClipIndex + 1);
            el.video.play().catch(() => {});
        } else {
            updatePlayPauseUI();
        }
    });

    function updateHUD(point) {
        el.hudSpeed.textContent = Math.round(point.speed_kmh);
        const bearing = Math.round(point.bearing || 0);
        el.hudHeading.textContent = `${bearing}°`;
        el.hudCardinal.textContent = getCardinalDirection(bearing);
        el.compassArrow.style.transform = `rotate(${bearing}deg)`;
        el.hudTimestamp.textContent = point.time || '--';

        if (point.lat !== 0 && point.lon !== 0) {
            const latStr = `${Math.abs(point.lat).toFixed(6)}° ${point.lat >= 0 ? 'N' : 'S'}`;
            const lonStr = `${Math.abs(point.lon).toFixed(6)}° ${point.lon >= 0 ? 'E' : 'W'}`;
            el.hudLat.textContent = latStr;
            el.hudLon.textContent = lonStr;
        }

        el.hudGSensor.textContent = `${(point.x || 0).toFixed(1)}, ${(point.y || 0).toFixed(1)}, ${(point.z || 0).toFixed(1)}`;
    }

    function updateVehicleMarker(point) {
        if (!point || (point.lat === 0 && point.lon === 0)) return;

        const latlng = [point.lat, point.lon];
        vehicleMarker.setLatLng(latlng);

        const carSvg = document.getElementById('carSvg');
        if (carSvg) {
            carSvg.style.transform = `rotate(${point.bearing || 0}deg)`;
        }

        if (state.followVehicle) {
            map.panTo(latlng, { animate: true, duration: 0.2 });
        }
    }

    function findNearestPointAndJump(clickLatLng) {
        let minDistance = Infinity;
        let bestPoint = null;

        if (state.fullRouteGeoJSON) {
            const features = state.fullRouteGeoJSON.features;
            const lineFeature = features.find(f => f.geometry.type === 'LineString');
            if (lineFeature && lineFeature.geometry.coordinates) {
                const coords = lineFeature.geometry.coordinates;
                for (let i = 0; i < coords.length; i++) {
                    const lon = coords[i][0];
                    const lat = coords[i][1];
                    const dist = Math.hypot(lat - clickLatLng.lat, lon - clickLatLng.lng);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestPoint = { lat, lon, index: i };
                    }
                }
            }
        }

        if (bestPoint) {
            for (let cIdx = 0; cIdx < state.clips.length; cIdx++) {
                const clip = state.clips[cIdx];
                if (clip.startCoord && clip.endCoord) {
                    const cLat1 = clip.startCoord[0], cLon1 = clip.startCoord[1];
                    const cLat2 = clip.endCoord[0], cLon2 = clip.endCoord[1];
                    const minLat = Math.min(cLat1, cLat2) - 0.005;
                    const maxLat = Math.max(cLat1, cLat2) + 0.005;
                    const minLon = Math.min(cLon1, cLon2) - 0.005;
                    const maxLon = Math.max(cLon1, cLon2) + 0.005;

                    if (bestPoint.lat >= minLat && bestPoint.lat <= maxLat && bestPoint.lon >= minLon && bestPoint.lon <= maxLon) {
                        loadClip(cIdx);
                        break;
                    }
                }
            }
        }
    }

    // ==========================================================================
    // SPLIT SCREEN RESIZING & EXPAND CONTROLS
    // ==========================================================================

    function setupSplitScreenResizer() {
        let isDragging = false;

        el.splitDivider.addEventListener('mousedown', () => {
            isDragging = true;
            document.body.style.cursor = 'col-resize';
        });

        window.addEventListener('mousemove', e => {
            if (!isDragging) return;

            const containerRect = el.splitViewport.getBoundingClientRect();
            const mouseX = e.clientX - containerRect.left;
            let leftPct = (mouseX / containerRect.width) * 100;
            leftPct = Math.max(20, Math.min(80, leftPct));

            el.videoPane.style.flex = `0 0 ${leftPct}%`;
            el.mapPane.style.flex = `0 0 ${100 - leftPct}%`;
            map.invalidateSize();
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = 'default';
                map.invalidateSize();
            }
        });

        el.btnResetSplit.addEventListener('click', e => {
            e.stopPropagation();
            resetSplit();
        });

        el.btnExpandVideo.addEventListener('click', () => {
            if (el.splitViewport.classList.contains('expanded-video')) {
                resetSplit();
            } else {
                el.splitViewport.classList.remove('expanded-map');
                el.splitViewport.classList.add('expanded-video');
                el.btnExpandVideo.classList.add('active');
                el.btnExpandMap.classList.remove('active');
            }
            setTimeout(() => map.invalidateSize(), 250);
        });

        el.btnExpandMap.addEventListener('click', () => {
            if (el.splitViewport.classList.contains('expanded-map')) {
                resetSplit();
            } else {
                el.splitViewport.classList.remove('expanded-video');
                el.splitViewport.classList.add('expanded-map');
                el.btnExpandMap.classList.add('active');
                el.btnExpandVideo.classList.remove('active');
            }
            setTimeout(() => map.invalidateSize(), 250);
        });
    }

    function resetSplit() {
        el.splitViewport.classList.remove('expanded-video', 'expanded-map');
        el.videoPane.style.flex = '1';
        el.mapPane.style.flex = '1';
        el.btnExpandVideo.classList.remove('active');
        el.btnExpandMap.classList.remove('active');
        setTimeout(() => map.invalidateSize(), 250);
    }

    // ==========================================================================
    // UI EVENT LISTENERS
    // ==========================================================================

    function setupEventListeners() {
        el.btnPlayPause.addEventListener('click', togglePlayPause);

        el.btnPrevClip.addEventListener('click', () => {
            if (state.currentClipIndex > 0) loadClip(state.currentClipIndex - 1);
        });
        el.btnNextClip.addEventListener('click', () => {
            if (state.currentClipIndex < state.clips.length - 1) loadClip(state.currentClipIndex + 1);
        });

        el.btnCamFront.addEventListener('click', () => {
            if (state.currentCamera !== 'F') {
                const curTime = el.video.currentTime;
                state.currentCamera = 'F';
                updateCameraButtons(state.clips[state.currentClipIndex]);
                loadVideoSource(curTime);
            }
        });

        el.btnCamRear.addEventListener('click', () => {
            if (state.currentCamera !== 'R' && state.clips[state.currentClipIndex].rearFile) {
                const curTime = el.video.currentTime;
                state.currentCamera = 'R';
                updateCameraButtons(state.clips[state.currentClipIndex]);
                loadVideoSource(curTime);
            }
        });

        el.btnToggleHUD.addEventListener('click', () => {
            state.showHUD = !state.showHUD;
            el.btnToggleHUD.classList.toggle('active', state.showHUD);
            el.telemetryHUD.classList.toggle('hidden', !state.showHUD);
        });

        el.btnFollowVehicle.addEventListener('click', () => {
            state.followVehicle = !state.followVehicle;
            el.btnFollowVehicle.classList.toggle('active', state.followVehicle);
            if (state.followVehicle && vehicleMarker) {
                map.panTo(vehicleMarker.getLatLng());
            }
        });

        setupScrubBar();

        el.speedBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                el.speedBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.playbackSpeed = parseFloat(btn.dataset.speed);
                el.video.playbackRate = state.playbackSpeed;
            });
        });

        el.chkAutoAdvance.addEventListener('change', e => {
            state.autoAdvance = e.target.checked;
        });

        el.btnToggleDrawer.addEventListener('click', () => {
            el.clipsDrawer.classList.toggle('collapsed');
            el.btnToggleDrawer.textContent = el.clipsDrawer.classList.contains('collapsed') ? '▲' : '▼';
            setTimeout(() => map.invalidateSize(), 250);
        });

        el.inputSearchClips.addEventListener('input', e => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.clip-card').forEach(card => {
                const text = card.textContent.toLowerCase();
                card.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });

        // Modals Setup
        setupExportModal();
        setupCopyClipModal();
        setupSettingsModal();

        // Keyboard Shortcuts
        window.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlayPause();
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                el.video.currentTime = Math.max(0, el.video.currentTime - 5);
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                el.video.currentTime = Math.min(el.video.duration, el.video.currentTime + 5);
            }
        });
    }

    function togglePlayPause() {
        if (el.video.paused) {
            el.video.play().then(updatePlayPauseUI).catch(() => {});
        } else {
            el.video.pause();
            updatePlayPauseUI();
        }
    }

    function updatePlayPauseUI() {
        const isPaused = el.video.paused;
        el.iconPlay.classList.toggle('hidden', !isPaused);
        el.iconPause.classList.toggle('hidden', isPaused);
    }

    function setupScrubBar() {
        let isDragging = false;

        const updateScrub = e => {
            const rect = el.progressContainer.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const targetTime = pos * el.video.duration;

            el.progressBarFill.style.width = `${pos * 100}%`;
            el.progressHandle.style.left = `${pos * 100}%`;
            el.scrubTooltip.style.left = `${pos * 100}%`;
            el.scrubTooltip.textContent = formatTime(targetTime);

            return targetTime;
        };

        el.progressContainer.addEventListener('mousedown', e => {
            isDragging = true;
            state.isDraggingScrubber = true;
            const targetTime = updateScrub(e);
            el.video.currentTime = targetTime;
        });

        window.addEventListener('mousemove', e => {
            if (isDragging) {
                const targetTime = updateScrub(e);
                el.video.currentTime = targetTime;
            }
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                state.isDraggingScrubber = false;
            }
        });
    }

    // ==========================================================================
    // CLIPS TRAY RENDERER
    // ==========================================================================

    function renderClipsGrid() {
        el.clipsGrid.innerHTML = '';

        state.clips.forEach((clip, idx) => {
            const card = document.createElement('div');
            card.className = `clip-card ${idx === state.currentClipIndex ? 'active' : ''}`;

            const timeParts = clip.startTime ? clip.startTime.split(' ') : ['--', '--'];
            const dateStr = timeParts[0];
            const timeStr = timeParts[1] || '--';

            card.innerHTML = `
                <div class="clip-card-header">
                    <span class="clip-id">#${clip.id + 1}</span>
                    <div class="clip-cam-tags">
                        <span class="tag-f">FRONT</span>
                        ${clip.rearFile ? '<span class="tag-r">REAR</span>' : ''}
                        <button class="clip-quick-save" title="Copiar este clip con nombre legible">📋</button>
                    </div>
                </div>
                <div>
                    <div class="clip-time">${timeStr}</div>
                    <div class="clip-date">${dateStr}</div>
                </div>
                <div class="clip-footer">
                    <span>${clip.durationSec}s · ${clip.distanceKm}km</span>
                    <span class="clip-speed">${clip.maxSpeed} km/h</span>
                </div>
            `;

            card.addEventListener('click', e => {
                if (e.target.classList.contains('clip-quick-save')) {
                    e.stopPropagation();
                    openCopyModal(idx);
                } else {
                    loadClip(idx);
                }
            });

            el.clipsGrid.appendChild(card);
        });
    }

    // ==========================================================================
    // COPIAR / GUARDAR CLIP CON NOMBRE LEGIBLE
    // ==========================================================================

    function setupCopyClipModal() {
        // Open modal from Header or Player buttons
        el.btnOpenCopyClip.addEventListener('click', () => openCopyModal(state.currentClipIndex));
        el.btnQuickSaveCurrent.addEventListener('click', () => openCopyModal(state.currentClipIndex));

        el.btnCloseCopyModal.addEventListener('click', () => el.copyModal.classList.add('hidden'));
        el.btnCancelCopy.addEventListener('click', () => el.copyModal.classList.add('hidden'));

        // Input changes update live preview
        el.copyClipSelect.addEventListener('change', updateFriendlyPreview);
        el.copyCameraSelect.addEventListener('change', updateFriendlyPreview);
        el.copyFormatSelect.addEventListener('change', updateFriendlyPreview);

        document.querySelectorAll('input[name="nameTemplate"]').forEach(r => {
            r.addEventListener('change', () => {
                el.customNameGroup.classList.toggle('hidden', r.value !== 'custom');
                updateFriendlyPreview();
            });
        });

        el.inputCustomName.addEventListener('input', updateFriendlyPreview);

        // Destination browse buttons
        const btnPickDestFolder = document.getElementById('btnPickDestFolder');
        if (btnPickDestFolder) {
            btnPickDestFolder.addEventListener('click', async () => {
                const picked = await pickFolderNative();
                if (picked) el.inputDestDir.value = picked;
            });
        }

        el.btnBrowseDefaultDest.addEventListener('click', () => {
            el.inputDestDir.value = state.defaultCopyDir || '';
        });

        // Execute Copy to Folder Button
        el.btnExecuteCopy.addEventListener('click', async () => {
            const clipIdx = parseInt(el.copyClipSelect.value);
            const clip = state.clips[clipIdx];
            if (!clip) return;

            const camera = el.copyCameraSelect.value;
            const format = el.copyFormatSelect.value;
            const template = document.querySelector('input[name="nameTemplate"]:checked').value;
            const customName = el.inputCustomName.value;
            const destinationDir = el.inputDestDir.value.trim();

            if (!destinationDir) {
                alert('Por favor especifica una ruta de carpeta destino.');
                return;
            }

            el.btnExecuteCopy.disabled = true;
            el.btnExecuteCopy.textContent = 'Copiando archivo...';
            el.copySuccessBanner.classList.add('hidden');

            try {
                const res = await fetch('/api/copy-clip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clipId: clip.id,
                        camera,
                        destinationDir,
                        format,
                        template,
                        customName
                    })
                });

                const data = await res.json();
                el.btnExecuteCopy.disabled = false;
                el.btnExecuteCopy.textContent = '💾 Copiar a la Carpeta';

                if (data.success && data.copiedFiles.length > 0) {
                    state.lastCopiedFilePath = data.copiedFiles[0].path;
                    el.copySuccessTitle.textContent = `¡Copia exitosa (${data.copiedFiles.length} archivo)!`;
                    el.copySuccessDesc.textContent = `${data.copiedFiles.map(f => f.filename).join(', ')}`;
                    el.copySuccessBanner.classList.remove('hidden');
                } else {
                    alert(`Error: ${data.error || 'No se pudo copiar el archivo'}`);
                }
            } catch (err) {
                el.btnExecuteCopy.disabled = false;
                el.btnExecuteCopy.textContent = '💾 Copiar a la Carpeta';
                alert(`Error al copiar: ${err.message}`);
            }
        });

        // Open in Windows Explorer
        el.btnOpenInExplorer.addEventListener('click', () => {
            if (state.lastCopiedFilePath) {
                fetch('/api/open-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: state.lastCopiedFilePath })
                });
            }
        });

        // Direct Download Button
        el.btnDownloadDirect.addEventListener('click', () => {
            const clipIdx = parseInt(el.copyClipSelect.value);
            const clip = state.clips[clipIdx];
            if (!clip) return;

            let camera = el.copyCameraSelect.value;
            if (camera === 'both') camera = 'F';
            const format = el.copyFormatSelect.value;
            const template = document.querySelector('input[name="nameTemplate"]:checked').value;
            const customName = encodeURIComponent(el.inputCustomName.value);

            const downloadUrl = `/api/download-clip/${clip.id}/${camera}/${format}?template=${template}&name=${customName}`;
            window.location.href = downloadUrl;
        });
    }

    function openCopyModal(clipIdx = 0) {
        el.copyClipSelect.value = clipIdx;
        el.copyCameraSelect.value = state.currentCamera;
        el.copySuccessBanner.classList.add('hidden');
        el.btnExecuteCopy.disabled = false;
        el.btnExecuteCopy.textContent = '💾 Copiar a la Carpeta';

        if (!el.inputDestDir.value) {
            el.inputDestDir.value = state.defaultCopyDir || '';
        }

        updateFriendlyPreview();
        el.copyModal.classList.remove('hidden');
    }

    function populateCopyModalClips() {
        el.copyClipSelect.innerHTML = '';
        state.clips.forEach(clip => {
            const opt = document.createElement('option');
            opt.value = clip.id;
            opt.textContent = `Clip #${clip.id + 1} (${clip.filename}) — ${clip.startTime || ''}`;
            el.copyClipSelect.appendChild(opt);
        });
    }

    function updateFriendlyPreview() {
        const clipIdx = parseInt(el.copyClipSelect.value) || 0;
        const clip = state.clips[clipIdx];
        if (!clip) return;

        el.rawClipPreview.textContent = clip.filename;

        const camera = el.copyCameraSelect.value;
        const format = el.copyFormatSelect.value;
        const template = document.querySelector('input[name="nameTemplate"]:checked')?.value || 'datetime';
        const customText = el.inputCustomName.value;

        const previewName = computeFriendlyName(clip, camera, format, template, customText);
        el.lblResultingName.textContent = previewName;
    }

    function computeFriendlyName(clip, camera, format, template, customText) {
        const camLabel = camera === 'both' ? 'Frontal_y_Trasera' : (camera === 'F' ? 'Frontal' : 'Trasera');
        const ext = format.toLowerCase().startsWith('mp4') ? 'mp4' : 'ts';

        const match = clip.filename.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(\d+)/);
        if (!match) return `Clip_${clip.id + 1}_${camLabel}.${ext}`;

        const [_, y, m, d, hh, mm, ss, seq] = match;
        const clipNum = String(parseInt(seq, 10)).padStart(3, '0');

        if (template === 'custom' && customText && customText.trim()) {
            const clean = customText.trim().replace(/[\\/:*?"<>|]/g, '_');
            return `${clean}_${camLabel}.${ext}`;
        }

        if (template === 'detailed') {
            const speedStr = clip.maxSpeed ? `_Max${Math.round(clip.maxSpeed)}kmh` : '';
            return `Clip-${clipNum}_${y}-${m}-${d}_${hh}h${mm}m${speedStr}_${camLabel}.${ext}`;
        }

        return `${y}-${m}-${d}_${hh}h${mm}m${ss}s_${camLabel}.${ext}`;
    }

    // ==========================================================================
    // SETTINGS MODAL
    // ==========================================================================

    async function pickFolderNative() {
        try {
            const res = await fetch('/api/select-folder-dialog', { method: 'POST' });
            const data = await res.json();
            if (data.success && data.path) {
                return data.path;
            }
        } catch (e) {
            console.error('Error selecting folder:', e);
        }
        return null;
    }

    function setupSettingsModal() {
        const btnPickSource = document.getElementById('btnPickSourceFolder');
        if (btnPickSource) {
            btnPickSource.addEventListener('click', async () => {
                const picked = await pickFolderNative();
                if (picked) el.inputDashcamSourceDir.value = picked;
            });
        }

        const btnPickDefault = document.getElementById('btnPickDefaultCopyFolder');
        if (btnPickDefault) {
            btnPickDefault.addEventListener('click', async () => {
                const picked = await pickFolderNative();
                if (picked) el.inputDefaultCopyDir.value = picked;
            });
        }

        el.btnOpenSettings.addEventListener('click', () => {
            el.inputDashcamSourceDir.value = state.dashcamDir;
            el.inputDefaultCopyDir.value = state.defaultCopyDir;
            el.settingsModal.classList.remove('hidden');
        });

        el.btnCloseSettingsModal.addEventListener('click', () => el.settingsModal.classList.add('hidden'));
        el.btnCancelSettings.addEventListener('click', () => el.settingsModal.classList.add('hidden'));

        el.btnSaveSettings.addEventListener('click', async () => {
            const dashcamDir = el.inputDashcamSourceDir.value.trim();
            const defaultCopyDir = el.inputDefaultCopyDir.value.trim();

            if (!dashcamDir) return;

            el.btnSaveSettings.disabled = true;
            el.btnSaveSettings.textContent = 'Guardando...';

            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dashcamDir, defaultCopyDir })
                });

                const data = await res.json();
                el.btnSaveSettings.disabled = false;
                el.btnSaveSettings.textContent = 'Guardar y Recargar';

                if (data.success) {
                    state.dashcamDir = data.config.dashcamDir;
                    state.defaultCopyDir = data.config.defaultCopyDir;
                    el.inputDestDir.value = data.config.defaultCopyDir;

                    const baseName = data.config.dashcamDir.split(/[\\/]/).filter(Boolean).pop() || 'D026DASHCAM';
                    el.lblSourceFolder.textContent = baseName;

                    el.settingsModal.classList.add('hidden');
                    // Reload journey data
                    await loadJourneyData();
                    await loadFullRoute();
                }
            } catch (err) {
                el.btnSaveSettings.disabled = false;
                el.btnSaveSettings.textContent = 'Guardar y Recargar';
                alert(`Error al guardar: ${err.message}`);
            }
        });
    }

    // ==========================================================================
    // EXPORT MODAL & VIDEO RENDER PIPELINE
    // ==========================================================================

    function setupExportModal() {
        el.btnOpenVideoExport.addEventListener('click', () => {
            el.modalClipSelect.value = state.currentClipIndex;
            el.modalCameraSelect.value = state.currentCamera;
            el.renderProgressBox.classList.add('hidden');
            el.renderDoneBox.classList.add('hidden');
            el.btnStartExport.disabled = false;
            el.btnStartExport.textContent = 'Iniciar Renderizado';
            el.exportModal.classList.remove('hidden');
        });

        el.btnCloseModal.addEventListener('click', () => el.exportModal.classList.add('hidden'));
        el.btnCancelExport.addEventListener('click', () => el.exportModal.classList.add('hidden'));

        el.btnStartExport.addEventListener('click', async () => {
            const clipIdx = parseInt(el.modalClipSelect.value);
            const clip = state.clips[clipIdx];
            if (!clip) return;

            const camera = el.modalCameraSelect.value;
            const resolution = el.modalResSelect.value;
            const clipFilename = camera === 'F' ? clip.frontFile : (clip.rearFile || clip.frontFile);

            el.btnStartExport.disabled = true;
            el.btnStartExport.textContent = 'Procesando...';
            el.renderProgressBox.classList.remove('hidden');
            el.renderDoneBox.classList.add('hidden');
            el.exportProgressFill.style.width = '0%';
            el.exportStatusPct.textContent = '0%';
            el.exportStatusText.textContent = 'Iniciando trabajo con FFmpeg...';

            try {
                const res = await fetch('/api/export-video', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clipFilename, camera, resolution })
                });
                const jobData = await res.json();
                state.activeExportJobId = jobData.jobId;
                pollExportStatus(jobData.jobId);
            } catch (err) {
                el.exportStatusText.textContent = `Error: ${err.message}`;
                el.btnStartExport.disabled = false;
            }
        });
    }

    function populateExportModalClips() {
        el.modalClipSelect.innerHTML = '';
        state.clips.forEach(clip => {
            const opt = document.createElement('option');
            opt.value = clip.id;
            opt.textContent = `Clip #${clip.id + 1} (${clip.filename}) — ${clip.startTime || ''}`;
            el.modalClipSelect.appendChild(opt);
        });
    }

    function pollExportStatus(jobId) {
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/export-status/${jobId}`);
                const job = await res.json();

                if (job.status === 'rendering') {
                    el.exportProgressFill.style.width = `${job.progress}%`;
                    el.exportStatusPct.textContent = `${job.progress}%`;
                    el.exportStatusText.textContent = `Renderizando HUD (${job.currentSec}s procesados)...`;
                } else if (job.status === 'completed') {
                    clearInterval(interval);
                    el.exportProgressFill.style.width = '100%';
                    el.exportStatusPct.textContent = '100%';
                    el.exportStatusText.textContent = '¡Video renderizado con éxito!';
                    el.btnDownloadExportedVideo.href = job.downloadUrl;
                    el.renderDoneBox.classList.remove('hidden');
                    el.btnStartExport.textContent = 'Completado';
                } else if (job.status === 'failed') {
                    clearInterval(interval);
                    el.exportStatusText.textContent = `Error: ${job.error}`;
                    el.btnStartExport.disabled = false;
                }
            } catch (err) {
                clearInterval(interval);
                el.exportStatusText.textContent = `Error: ${err.message}`;
                el.btnStartExport.disabled = false;
            }
        }, 600);
    }

    // ==========================================================================
    // UTILITIES
    // ==========================================================================

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function getCardinalDirection(angle) {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round(((angle % 360) + 360) % 360 / 45) % 8;
        return directions[index];
    }

    // Bootstrap app
    window.addEventListener('DOMContentLoaded', init);
})();
