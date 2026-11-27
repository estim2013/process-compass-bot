FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STATE_DIR=/app/state \
    DB_PATH=/app/state/mvp.sqlite

COPY --chown=node:node package.json ./package.json
COPY --chown=node:node server.js ./server.js
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node data/registry.json data/glossary.json ./data/
COPY --chown=node:node data/source_docs ./data/source_docs
RUN mkdir -p /app/state && chown node:node /app/state

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
