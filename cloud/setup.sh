#!/usr/bin/env bash
set -euo pipefail

echo "=== Cloud Render Setup (idempotent) ==="

# 1. System packages: ffmpeg + DejaVu Sans fonts (no Python deps)
NEED_APT=0
command -v ffmpeg >/dev/null 2>&1 || NEED_APT=1
if ! fc-list 2>/dev/null | grep -qi "DejaVuSans-Bold"; then
  NEED_APT=1
fi

if [ "$NEED_APT" -eq 1 ]; then
  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core
  else
    apt-get update -qq
    apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core
  fi
  fc-cache -f
fi

# 2. Verify Node >= 22
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found. Please install Node.js >= 22." >&2
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node.js >= 22 required, found $(node -v)" >&2
  exit 1
fi

# 3. Install Chromium via Playwright (idempotent; skips if cached)
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
PW_PKG="${PLAYWRIGHT_PKG:-playwright@latest}"
if ! find "$PW_CACHE" -maxdepth 4 \( -name "chrome" -o -name "headless_shell" -o -name "chrome-headless-shell" \) -type f 2>/dev/null | grep -q .; then
  npx --yes "$PW_PKG" install chromium
fi
if command -v sudo >/dev/null 2>&1; then
  sudo env "PATH=$PATH" npx --yes "$PW_PKG" install-deps chromium
else
  npx --yes "$PW_PKG" install-deps chromium
fi

echo "=== Setup Complete ==="
echo "Node: $(node -v)"
echo "FFmpeg: $(ffmpeg -version | head -n 1)"
echo "DejaVu Sans Bold: $(fc-match 'DejaVu Sans:bold' || true)"
find "$PW_CACHE" -maxdepth 4 \( -name "chrome" -o -name "headless_shell" -o -name "chrome-headless-shell" \) -type f 2>/dev/null || true
