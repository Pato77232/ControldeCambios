# Sistema de Control de Cambios de BusesUTA: imagen de producción sin dependencias externas.
# Requiere Node.js 22.13 o superior por node:sqlite.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/changeflow.sqlite \
    DEMO_DB_PATH=/data/demo.sqlite \
    SQLITE_JOURNAL_MODE=DELETE

WORKDIR /app
COPY package.json ./
COPY backend ./backend
COPY js ./js
COPY css ./css
COPY index.html wireframe.html ./

# Los datos (bases SQLite y adjuntos) viven en /data, que se monta como volumen.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/catalog').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "backend/server.cjs"]
