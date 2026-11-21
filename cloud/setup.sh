#!/usr/bin/env bash
set -euo pipefail

START_MS=$(node -e "console.log(Date.now())" 2>/dev/null || echo 0)
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.65.1}"
FFMPEG_PIN_VER="8.1.3-autobuild-2026-11-21-12-37"
FFMPEG_STATIC_URL="https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-21-12-37/ffmpeg-n8.1.3-39-g660b5aa7db-linux64-gpl-8.1.tar.xz"
FFMPEG_CACHE_DIR="${FFMPEG_CACHE_DIR:-$HOME/.cache/ffmpeg-static-8.1.3}"
SETUP_INFO_FILE="${SETUP_INFO_FILE:-${OUT_DIR:-out_cloud}/setup_info.json}"
FFMPEG_CACHE_HIT=false

echo "=== Cloud Render Setup v1.4 (pinned FFmpeg=${FFMPEG_PIN_VER}, Playwright=${PLAYWRIGHT_VERSION}) ==="

run_root() {
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

# 1. Verify Node >= 22
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found. Please install Node.js >= 22." >&2
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node.js >= 22 required, found $(node -v)" >&2
  exit 1
fi

# 2. Fast zero-dpkg pinned static FFmpeg (cached in ~/.cache/ffmpeg-static-8.1.3/bin)
if [ -x "$FFMPEG_CACHE_DIR/bin/ffmpeg" ] && [ -x "$FFMPEG_CACHE_DIR/bin/ffprobe" ]; then
  echo "FFmpeg static cache HIT: $FFMPEG_CACHE_DIR/bin"
  export PATH="$FFMPEG_CACHE_DIR/bin:$PATH"
  FFMPEG_CACHE_HIT=true
elif command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  echo "System ffmpeg already installed — skipping download."
  FFMPEG_CACHE_HIT=true
else
  echo "FFmpeg static cache MISS: downloading pinned static build (${FFMPEG_PIN_VER})..."
  mkdir -p "$FFMPEG_CACHE_DIR/bin"
  TMP_TAR=$(mktemp /tmp/ffmpeg_static_XXXXXX.tar.xz)
  if curl -fsSL --retry 3 "$FFMPEG_STATIC_URL" -o "$TMP_TAR"; then
    tar -xJf "$TMP_TAR" --strip-components=2 -C "$FFMPEG_CACHE_DIR/bin" --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'
    chmod +x "$FFMPEG_CACHE_DIR/bin/ffmpeg" "$FFMPEG_CACHE_DIR/bin/ffprobe"
    rm -f "$TMP_TAR"
    export PATH="$FFMPEG_CACHE_DIR/bin:$PATH"
  else
    rm -f "$TMP_TAR"
    echo "Static download failed; falling back to apt-get ffmpeg..."
    run_root apt-get update -qq
    run_root apt-get install -y -qq --no-install-recommends ffmpeg
  fi
fi

# Persist cached ffmpeg bin into GITHUB_PATH for subsequent workflow steps
if [ -n "${GITHUB_PATH:-}" ] && [ -x "$FFMPEG_CACHE_DIR/bin/ffmpeg" ]; then
  echo "$FFMPEG_CACHE_DIR/bin" >> "$GITHUB_PATH"
fi

# 3. Fonts check (DejaVu Sans is preinstalled on ubuntu-24.04; only install if missing)
if ! fc-list 2>/dev/null | grep -qi "DejaVuSans-Bold"; then
  echo "Installing fonts-dejavu-core..."
  run_root apt-get update -qq
  run_root apt-get install -y -qq --no-install-recommends fontconfig fonts-dejavu-core
  fc-cache -f
fi

# 4. Detect preinstalled Chrome/Chromium BEFORE touching Playwright (saves ~40s/job!)
CHROME_BIN_FOUND=""
CHROME_SOURCE=""
if [ -n "${CHROME_BIN:-}" ] && [ -x "${CHROME_BIN}" ]; then
  CHROME_BIN_FOUND="${CHROME_BIN}"
  CHROME_SOURCE="env"
else
  for candidate in chromium chromium-browser google-chrome; do
    if found=$(command -v "$candidate" 2>/dev/null); then
      CHROME_BIN_FOUND="$found"
      CHROME_SOURCE="system"
      break
    fi
  done
fi

if [ -n "$CHROME_BIN_FOUND" ]; then
  echo "System browser already present: $CHROME_BIN_FOUND ($CHROME_SOURCE) — skipping Playwright install!"
else
  echo "No system browser found — installing pinned Playwright Chromium (${PLAYWRIGHT_VERSION})..."
  PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  if ! find "$PW_CACHE" -maxdepth 4 \( -name "chrome" -o -name "headless_shell" -o -name "chrome-headless-shell" \) -type f 2>/dev/null | grep -q .; then
    npx --yes "playwright@${PLAYWRIGHT_VERSION}" install chromium
  fi
  run_root env "PATH=$PATH" npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium
  CHROME_BIN_FOUND=$(find "$PW_CACHE" -maxdepth 4 \( -name "chrome" -o -name "headless_shell" -o -name "chrome-headless-shell" \) -type f 2>/dev/null | head -n 1 || true)
  CHROME_SOURCE="playwright"
fi

CHROME_VERSION="unknown"
if [ -n "$CHROME_BIN_FOUND" ]; then
  CHROME_VERSION=$("$CHROME_BIN_FOUND" --version 2>/dev/null | head -n 1 || echo "unknown")
fi
FFMPEG_VERSION=$(ffmpeg -version 2>/dev/null | head -n 1 || echo "unknown")
END_MS=$(node -e "console.log(Date.now())" 2>/dev/null || echo 0)
SETUP_DUR_SEC=$(node -e "console.log(((Number(process.argv[1]) - Number(process.argv[2])) / 1000).toFixed(2))" "$END_MS" "$START_MS")

mkdir -p "$(dirname "$SETUP_INFO_FILE")"
node -e '
  const fs = require("fs");
  const info = {
    setupDurationSec: Number(process.argv[1]),
    ffmpegCacheHit: process.argv[2] === "true",
    ffmpegPinnedVersion: process.argv[3],
    chromeBin: process.argv[4],
    chromeSource: process.argv[5],
    chromeVersion: process.argv[6],
    playwrightPinnedVersion: process.argv[7],
    ffmpegVersion: process.argv[8],
    nodeVersion: process.version
  };
  fs.writeFileSync(process.argv[9], JSON.stringify(info, null, 2) + "\n");
' "$SETUP_DUR_SEC" "$FFMPEG_CACHE_HIT" "$FFMPEG_PIN_VER" "$CHROME_BIN_FOUND" "$CHROME_SOURCE" "$CHROME_VERSION" "$PLAYWRIGHT_VERSION" "$FFMPEG_VERSION" "$SETUP_INFO_FILE"

echo "=== Setup Complete in ${SETUP_DUR_SEC}s (ffmpegCacheHit=${FFMPEG_CACHE_HIT}) ==="
echo "Node: $(node -v)"
echo "Chrome: ${CHROME_BIN_FOUND} [${CHROME_SOURCE}] (${CHROME_VERSION})"
echo "Playwright pinned fallback: ${PLAYWRIGHT_VERSION}"
echo "FFmpeg: ${FFMPEG_VERSION}"
echo "DejaVu Sans Bold: $(fc-match 'DejaVu Sans:bold' || true)"
