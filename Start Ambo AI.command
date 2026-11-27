#!/usr/bin/env bash
set -euo pipefail

# Resolve symlinked script location so Desktop aliases or symlinks still find the project root
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
APP_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
cd "$APP_DIR"

# Ensure user-local, Claude CLI, and Homebrew (Apple Silicon + Intel) binaries are in PATH when launched from Finder
export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/opt/ffmpeg-full/bin:/opt/homebrew/bin:/usr/local/opt/ffmpeg-full/bin:/usr/local/bin:$PATH"

# Include nvm-managed Node if installed
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  LATEST_NVM="$(ls -1d "$HOME/.nvm/versions/node"/v* 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$LATEST_NVM" ] && [ -d "$LATEST_NVM/bin" ]; then
    export PATH="$LATEST_NVM/bin:$PATH"
  fi
fi

# Verify Node.js and npm
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo ""
  echo "============================================================"
  echo "  Node.js is not installed yet."
  echo "  Run this in Terminal first (see MAC_SETUP.md):"
  echo "    brew install node ffmpeg python"
  echo "============================================================"
  echo ""
  read -r -p "Press Return to close..."
  exit 1
fi

mkdir -p "$APP_DIR/data"

# First-time setup or cross-machine architecture refresh (e.g., Linux -> Apple Silicon / Intel Mac)
if [ ! -d "$APP_DIR/node_modules" ] || ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  echo "Installing Node.js dependencies for this Mac (first-time setup)..."
  npm install
  if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
    echo "Rebuilding better-sqlite3 native bindings..."
    npm rebuild better-sqlite3
  fi
fi

# Set up local Python worker environment if missing or copied from another OS
if command -v python3 >/dev/null 2>&1; then
  if [ ! -x "$APP_DIR/python-worker/.venv/bin/python" ] || ! "$APP_DIR/python-worker/.venv/bin/python" -c "import faster_whisper" >/dev/null 2>&1; then
    if [ -f "$APP_DIR/python-worker/requirements.txt" ]; then
      echo "Setting up local Python worker (faster-whisper, yt-dlp, doc parsers)..."
      rm -rf "$APP_DIR/python-worker/.venv"
      python3 -m venv "$APP_DIR/python-worker/.venv"
      "$APP_DIR/python-worker/.venv/bin/python" -m pip install --upgrade pip >/dev/null 2>&1 || true
      "$APP_DIR/python-worker/.venv/bin/pip" install -r "$APP_DIR/python-worker/requirements.txt"
    fi
  fi
fi

# Build production bundle if missing
if [ ! -f "$APP_DIR/.next/BUILD_ID" ]; then
  echo "Building Ambo AI production app (one-time)..."
  npm run build
fi

PORT=3000
URL="http://127.0.0.1:${PORT}"

is_port_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  curl -fsS -o /dev/null "$URL" >/dev/null 2>&1
}

is_http_ready() {
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "000")"
  [ "$code" != "000" ]
}

if ! is_port_listening; then
  echo "Starting Ambo AI privately on $URL ..."
  nohup npm run start > "$APP_DIR/data/ambo-server.log" 2>&1 </dev/null &
  SERVER_PID=$!
  disown "$SERVER_PID" 2>/dev/null || true

  READY=0
  for _ in $(seq 1 60); do
    if is_http_ready; then
      READY=1
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done

  if [ "$READY" -ne 1 ]; then
    echo ""
    echo "Ambo AI failed to start cleanly. Last log lines:"
    tail -n 30 "$APP_DIR/data/ambo-server.log" 2>/dev/null || true
    echo ""
    read -r -p "Press Return to close..."
    exit 1
  fi
fi

# Open in default browser
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
fi
