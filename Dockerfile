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
CMD ["node", "server.js"]
