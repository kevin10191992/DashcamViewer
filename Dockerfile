# =====================================================================
# D026 Dashcam Viewer - Docker Container (Web Service)
# =====================================================================
FROM node:20-alpine

# Instalar FFmpeg en Alpine Linux para procesamiento de video y HUD
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Instalar solo dependencias de producción (omite Electron y electron-builder)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar el código fuente del servidor y cliente web
COPY server.js gps-parser.js video-exporter.js ./
COPY public/ ./public/

# Variables de entorno por defecto
ENV NODE_ENV=production \
    PORT=3000 \
    DASHCAM_DIR=/data/dashcam \
    COPY_DIR=/data/exports

# Crear directorios para montaje de volúmenes
RUN mkdir -p /data/dashcam /data/exports /app/cache_mp4 /app/exports

# Exponer el puerto del servidor web
EXPOSE 3000

# Volúmenes recomendados:
# - /data/dashcam (Carpeta con las grabaciones video/F y video/R)
# - /data/exports (Carpeta para guardar clips copiados o videos renderizados)
VOLUME ["/data/dashcam", "/data/exports"]

# Iniciar servidor web Express
CMD ["node", "server.js"]
