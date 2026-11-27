#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/opt/ffmpeg-full/bin:/opt/homebrew/bin:/usr/local/opt/ffmpeg-full/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  LATEST_NVM="$(ls -1d "$HOME/.nvm/versions/node"/v* 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$LATEST_NVM" ] && [ -d "$LATEST_NVM/bin" ]; then
    export PATH="$LATEST_NVM/bin:$PATH"
  fi
fi

export GIT_TERMINAL_PROMPT=0
mkdir -p "$APP_DIR/data"

OPEN_BROWSER=0
if [ "${1:-}" = "--open" ]; then
  OPEN_BROWSER=1
fi

STATUS_FILE="$APP_DIR/data/update-status.json"
BRANCH="main"
PREV_COMMIT="$(git rev-parse HEAD)"

write_status() {
  local state="$1"
  local step="$2"
  local err="${3:-}"
  local cur_commit
  cur_commit="$(git rev-parse --short HEAD 2>/dev/null || echo "")"
  AMBO_STATE="$state" AMBO_STEP="$step" AMBO_ERR="$err" AMBO_COMMIT="$cur_commit" AMBO_STATUS_FILE="$STATUS_FILE" node -e '
    const fs = require("fs");
    const payload = {
      state: process.env.AMBO_STATE,
      step: process.env.AMBO_STEP,
      commit: process.env.AMBO_COMMIT,
      error: process.env.AMBO_ERR || null,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(process.env.AMBO_STATUS_FILE, JSON.stringify(payload, null, 2));
  '
}

stop_port_3000() {
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"
  fi
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k 3000/tcp >/dev/null 2>&1 || true
    sleep 1
  fi
}

start_server_and_wait() {
  nohup npm run start > "$APP_DIR/data/ambo-server.log" 2>&1 </dev/null &
  local spid=$!
  disown "$spid" 2>/dev/null || true
  for _ in $(seq 1 60); do
    local code
    code="$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/signin 2>/dev/null || echo "000")"
    if [ "$code" != "000" ]; then
      return 0
    fi
    if ! kill -0 "$spid" 2>/dev/null; then
      return 1
    fi
    sleep 0.5
  done
  return 1
}

rollback_and_restart() {
  local reason="$1"
  git reset --hard "$PREV_COMMIT" >/dev/null 2>&1 || true
  if [ -d "$APP_DIR/.next.bak" ]; then
    rm -rf "$APP_DIR/.next"
    mv "$APP_DIR/.next.bak" "$APP_DIR/.next"
  fi
  start_server_and_wait || true
  write_status "error" "Update failed and rolled back safely" "$reason"
  exit 1
}

write_status "updating" "Downloading latest updates from GitHub..."
if ! git fetch origin "$BRANCH" --quiet; then
  write_status "error" "Could not reach GitHub" "Check your internet connection and try again."
  exit 1
fi

git reset --hard "origin/$BRANCH" >/dev/null
chmod +x "Start Ambo AI.command" "Update Ambo AI.command" scripts/*.sh 2>/dev/null || true

write_status "installing" "Updating dependencies..."
if ! npm install --no-audit --no-fund >> "$APP_DIR/data/ambo-update.log" 2>&1; then
  rollback_and_restart "npm install failed. Check data/ambo-update.log."
fi

if [ -x "$APP_DIR/python-worker/.venv/bin/pip" ] && [ -f "$APP_DIR/python-worker/requirements.txt" ]; then
  "$APP_DIR/python-worker/.venv/bin/pip" install -q -r "$APP_DIR/python-worker/requirements.txt" >> "$APP_DIR/data/ambo-update.log" 2>&1 || true
fi

write_status "building" "Rebuilding & restarting Ambo AI..."
sleep 0.6

stop_port_3000
rm -rf "$APP_DIR/.next.bak"
if [ -d "$APP_DIR/.next" ]; then
  mv "$APP_DIR/.next" "$APP_DIR/.next.bak"
fi

if ! npm run build >> "$APP_DIR/data/ambo-update.log" 2>&1; then
  rollback_and_restart "Build failed. Previous working version was restored."
fi

rm -rf "$APP_DIR/.next.bak"

if ! start_server_and_wait; then
  write_status "error" "Server restart timed out" "Check data/ambo-server.log."
  exit 1
fi

write_status "completed" "Updated! Reloading Ambo AI..."

if [ "$OPEN_BROWSER" -eq 1 ]; then
  if command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:3000"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:3000" >/dev/null 2>&1 &
  fi
fi
