#!/usr/bin/env sh
# Open the editor on this project's dev server (macOS / Linux).
# chmod +x retouch.sh once, then run ./retouch.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found on PATH. Install it from https://nodejs.org and try again."
  exit 1
fi
exec node "./bin/retouch.mjs" "$@"
