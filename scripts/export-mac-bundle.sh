#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p "$ROOT_DIR/dist"
STAGE_DIR="$(mktemp -d)"
APP_STAGE="$STAGE_DIR/Ambo AI"
OUT_ZIP="$ROOT_DIR/dist/Ambo-AI-Mac.zip"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

mkdir -p "$APP_STAGE/data/fonts" "$APP_STAGE/python-worker" "$APP_STAGE/scripts"

# Root configs, docs & 1-click launcher
cp "$ROOT_DIR/package.json" "$APP_STAGE/"
cp "$ROOT_DIR/next.config.ts" "$APP_STAGE/"
cp "$ROOT_DIR/tailwind.config.ts" "$APP_STAGE/"
cp "$ROOT_DIR/postcss.config.mjs" "$APP_STAGE/"
cp "$ROOT_DIR/tsconfig.json" "$APP_STAGE/"
cp "$ROOT_DIR/README.md" "$APP_STAGE/"
cp "$ROOT_DIR/MAC_SETUP.md" "$APP_STAGE/"
cp "$ROOT_DIR/.gitignore" "$APP_STAGE/"
cp "$ROOT_DIR/Start Ambo AI.command" "$APP_STAGE/"
cp "$ROOT_DIR/Update Ambo AI.command" "$APP_STAGE/"
chmod +x "$APP_STAGE/Start Ambo AI.command" "$APP_STAGE/Update Ambo AI.command"

# Source code & public assets
cp -R "$ROOT_DIR/src" "$APP_STAGE/src"
cp -R "$ROOT_DIR/public" "$APP_STAGE/public"

# Church & caption fonts
if [ -d "$ROOT_DIR/data/fonts" ]; then
  cp -R "$ROOT_DIR/data/fonts/." "$APP_STAGE/data/fonts/"
fi

# Clean Python worker scripts & requirements (never copy Linux .venv)
cp "$ROOT_DIR/python-worker/"*.py "$APP_STAGE/python-worker/"
cp "$ROOT_DIR/python-worker/requirements.txt" "$APP_STAGE/python-worker/"

# Export & updater scripts
cp "$ROOT_DIR/scripts/export-mac-bundle.sh" "$APP_STAGE/scripts/"
cp "$ROOT_DIR/scripts/update-app.sh" "$APP_STAGE/scripts/"
chmod +x "$APP_STAGE/scripts/export-mac-bundle.sh" "$APP_STAGE/scripts/update-app.sh"

rm -f "$OUT_ZIP"
(
  cd "$STAGE_DIR"
  if command -v zip >/dev/null 2>&1; then
    zip -rq "$OUT_ZIP" "Ambo AI"
  else
    python3 -c '
import os, sys, zipfile
root = sys.argv[1]
out = sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, os.path.dirname(root))
            zi = zipfile.ZipInfo.from_file(full, rel)
            st = os.stat(full)
            zi.external_attr = (st.st_mode & 0xFFFF) << 16
            with open(full, "rb") as f:
                zf.writestr(zi, f.read())
' "$APP_STAGE" "$OUT_ZIP"
  fi
)

echo "Created portable Mac bundle: $OUT_ZIP ($(du -h "$OUT_ZIP" | cut -f1))"
