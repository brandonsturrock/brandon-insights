#!/usr/bin/env bash
# Usage: render-pdf.sh <in.html> <out.pdf> [dark|light]   (theme default: light)
set -euo pipefail
IN="$1"; OUT="$2"; THEME="${3:-light}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=8000 \
  --print-to-pdf="$OUT" "file://$(cd "$(dirname "$IN")" && pwd)/$(basename "$IN")#theme=$THEME"
