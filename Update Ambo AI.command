#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
APP_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
cd "$APP_DIR"

echo ""
echo "Updating Ambo AI to the latest version..."
echo "(Your sermons, clips, prompts, and settings will stay safe.)"
echo ""

if bash "$APP_DIR/scripts/update-app.sh" --open; then
  echo ""
  echo "Ambo AI is up to date and running at http://127.0.0.1:3000"
  echo ""
else
  echo ""
  echo "Update could not complete. Check data/ambo-update.log for details."
  echo ""
  read -r -p "Press Return to close..."
  exit 1
fi
