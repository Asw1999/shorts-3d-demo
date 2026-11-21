#!/usr/bin/env bash
set -euo pipefail

START_MS=$(node -e "console.log(Date.now())" 2>/dev/null || echo 0)
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.65.1}"
DEB_CACHE="${APT_DEB_CACHE:-$HOME/.cache/shorts-apt-debs}"
SETUP_INFO_FILE="${SETUP_INFO_FILE:-${OUT_DIR:-out_cloud}/setup_info.json}"
APT_CACHE_HIT=false

echo "=== Cloud Render Setup v1.3 (idempotent, pinned Playwright=${PLAYWRIGHT_VERSION}) ==="

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

# 2. Fast cached install of ffmpeg (and DejaVu Sans only if missing)
NEED_FFMPEG=0
NEED_FONT=0
command -v ffmpeg >/dev/null 2>&1 || NEED_FFMPEG=1
if ! fc-list 2>/dev/null | grep -qi "DejaVuSans-Bold"; then
  NEED_FONT=1
fi

if [ "$NEED_FFMPEG" -eq 1 ] || [ "$NEED_FONT" -eq 1 ]; then
  mkdir -p "$DEB_CACHE"
  PKGS=()
  [ "$NEED_FFMPEG" -eq 1 ] && PKGS+=(ffmpeg)
  [ "$NEED_FONT" -eq 1 ] && PKGS+=(fontconfig fonts-dejavu-core)

  if [ "$NEED_FONT" -eq 0 ] && ls "$DEB_CACHE"/*.deb >/dev/null 2>&1; then
    echo "APT cache HIT: installing cached ffmpeg .deb packages from $DEB_CACHE ..."
    APT_CACHE_HIT=true
    if ! run_root dpkg -i "$DEB_CACHE"/*.deb >/dev/null 2>&1; then
      echo "dpkg fallback: resolving missing dependencies via apt-get -f install..."
      run_root apt-get update -qq
      run_root apt-get -f install -y -qq --no-install-recommends
    fi
  else
    echo "APT cache MISS: installing ${PKGS[*]} and populating $DEB_CACHE ..."
    run_root apt-get update -qq
    run_root apt-get install -y -qq --no-install-recommends \
      -o dir::cache::archives="$DEB_CACHE" \
      -o APT::Keep-Downloaded-Packages=true \
      "${PKGS[@]}"
    run_root rm -rf "$DEB_CACHE/partial" "$DEB_CACHE/lock"
    run_root chown -R "$(id -u):$(id -g)" "$DEB_CACHE" || true
  fi

  if [ "$NEED_FONT" -eq 1 ]; then
    fc-cache -f
  fi
else
  echo "System ffmpeg and DejaVu Sans already installed — skipping apt."
  APT_CACHE_HIT=true
fi

# 3. Detect preinstalled Chrome/Chromium BEFORE touching Playwright (saves ~40s/job!)
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
  echo "System browser already present: $CHROME_BIN_FOUND ($CHROME_SOURCE) — skipping Playwright Chromium install!"
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
    aptCacheHit: process.argv[2] === "true",
    chromeBin: process.argv[3],
    chromeSource: process.argv[4],
    chromeVersion: process.argv[5],
    playwrightPinnedVersion: process.argv[6],
    ffmpegVersion: process.argv[7],
    nodeVersion: process.version
  };
  fs.writeFileSync(process.argv[8], JSON.stringify(info, null, 2) + "\n");
' "$SETUP_DUR_SEC" "$APT_CACHE_HIT" "$CHROME_BIN_FOUND" "$CHROME_SOURCE" "$CHROME_VERSION" "$PLAYWRIGHT_VERSION" "$FFMPEG_VERSION" "$SETUP_INFO_FILE"

echo "=== Setup Complete in ${SETUP_DUR_SEC}s ==="
echo "Node: $(node -v)"
echo "Chrome: ${CHROME_BIN_FOUND} [${CHROME_SOURCE}] (${CHROME_VERSION})"
echo "Playwright pinned fallback: ${PLAYWRIGHT_VERSION}"
echo "FFmpeg: ${FFMPEG_VERSION}"
echo "DejaVu Sans Bold: $(fc-match 'DejaVu Sans:bold' || true)"
