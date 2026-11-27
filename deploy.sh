#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PORT="${APP_PORT:-3210}"
CONTAINER="${APP_CONTAINER:-process-compass-mvp}"
IMAGE="${APP_IMAGE:-process-compass-mvp:latest}"

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "Missing $APP_DIR/.env; copy .env.example and configure the model key first." >&2
  exit 1
fi
mkdir -p "$APP_DIR/state"
chown 1000:1000 "$APP_DIR/state"
docker build -t "$IMAGE" "$APP_DIR"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --env-file "$APP_DIR/.env" \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e STATE_DIR=/app/state \
  -e DB_PATH=/app/state/mvp.sqlite \
  --publish "${APP_PORT}:3000" \
  --volume "$APP_DIR/state:/app/state" \
  --health-cmd "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"" \
  --health-interval 30s \
  --health-timeout 5s \
  --health-retries 3 \
  "$IMAGE"
echo "Process Compass is listening on port ${APP_PORT}. Check /api/health."

