import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs, resolveAssetsDir, probeSegment, muxSegments } from './mux.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const CDP_PORT = 9235;
const PROFILE_DIR = path.join(process.env.TMPDIR || os.tmpdir(), 'shorts_chrome_profile');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function whichBin(name) {
  try {
    const out = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function findPlaywrightChrome() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    '/root/.cache/ms-playwright',
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let dirs = [];
    try {
      dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium')).sort().reverse();
    } catch {
      continue;
    }
    for (const d of dirs) {
      const candidates = [
        path.join(root, d, 'chrome-linux', 'chrome'),
        path.join(root, d, 'chrome-linux64', 'chrome'),
        path.join(root, d, 'chrome-linux', 'headless_shell'),
        path.join(root, d, 'chrome-linux64', 'chrome-headless-shell'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
  }
  return null;
}

/**
 * Autodetect Chromium binary in strict priority order:
 * 1. CHROME_BIN env var
 * 2. chromium (PATH)
 * 3. chromium-browser (PATH)
 * 4. google-chrome (PATH)
 * 5. Playwright Chromium cache
 */
function detectChromeBin() {
  const checked = [];
  if (process.env.CHROME_BIN) {
    const envBin = process.env.CHROME_BIN.trim();
    checked.push(`CHROME_BIN=${envBin}`);
    if (fs.existsSync(envBin)) return envBin;
    const resolved = whichBin(envBin);
    if (resolved) return resolved;
    throw new Error(`CHROME_BIN is set to "${envBin}" but binary was not found or not executable.`);
  }

  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    checked.push(name);
    const found = whichBin(name);
    if (found) return found;
  }

  checked.push('playwright cache (~/.cache/ms-playwright/chromium-*)');
  const pw = findPlaywrightChrome();
  if (pw) return pw;

  throw new Error(
    `No Chromium/Chrome binary found. Checked in order: ${checked.join(', ')}. ` +
    `Install Chromium or set CHROME_BIN=/path/to/chrome.`
  );
}

function getChromeVersion(chromeBin) {
  try {
    return execFileSync(chromeBin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'unknown';
  }
}

function startServer(assetsDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      if (reqPath === '/favicon.ico') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (reqPath.startsWith('/__assets__/')) {
        const rel = reqPath.slice('/__assets__/'.length);
        const assetPath = path.resolve(assetsDir, rel);
        if (!assetPath.startsWith(assetsDir) || !fs.existsSync(assetPath)) {
          res.writeHead(404);
          res.end('Asset not found');
          return;
        }
        const ext = path.extname(assetPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(assetPath).pipe(res);
        return;
      }
      const fullPath = path.join(__dirname, reqPath);
      if (!fullPath.startsWith(__dirname) || !fs.existsSync(fullPath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(fullPath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function waitForCdpTarget(port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const list = await res.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Chromium CDP on port ${port}`);
}

function createCdpClient(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();

    ws.addEventListener('open', () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = nextId++;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      resolve({ ws, send });
    });

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method && onEvent) {
        onEvent(msg.method, msg.params || {});
      }
    });

    ws.addEventListener('error', reject);
  });
}

function buildPreviewMap(timings, totalFrames, fps) {
  const previewMap = new Map();
  const addTarget = (frameIdx, filename) => {
    const clamped = Math.max(0, Math.min(totalFrames - 1, frameIdx));
    const list = previewMap.get(clamped) || [];
    list.push(filename);
    previewMap.set(clamped, list);
  };
  addTarget(Math.round(1.8 * fps), 'preview_00_intro.jpg');
  if (Array.isArray(timings.beats) && timings.beats.length > 0) {
    timings.beats.forEach((beat, idx) => {
      const filename = `preview_${String(idx + 1).padStart(2, '0')}_${beat.id}.jpg`;
      const midSec = (Number(beat.start) + Number(beat.end)) / 2;
      addTarget(Math.round(midSec * fps), filename);
    });
  }
  return previewMap;
}

function formatCdpRemoteArg(arg) {
  if (!arg) return '';
  if (arg.value !== undefined) return String(arg.value);
  if (arg.unserializableValue !== undefined) return String(arg.unserializableValue);
  return arg.description || `[${arg.type || 'unknown'}]`;
}

function formatExceptionDetails(details = {}) {
  const desc =
    details.exception?.description ||
    details.exception?.value ||
    details.text ||
    'Unknown page exception';
  const loc = details.url
    ? ` (${details.url}:${details.lineNumber ?? 0}:${details.columnNumber ?? 0})`
    : '';
  return `${desc}${loc}`;
}

function parseShardSpec(spec) {
  const m = /^(\d+)\/(\d+)$/.exec(spec.trim());
  if (!m) throw new Error(`Invalid --shard format "${spec}". Expected i/N (e.g. 1/3).`);
  const shardNum = Number(m[1]);
  const totalShards = Number(m[2]);
  if (totalShards < 1 || shardNum < 1 || shardNum > totalShards) {
    throw new Error(`Invalid shard range "${spec}". Must satisfy 1 <= i <= N.`);
  }
  return { shardNum, totalShards };
}

/**
 * Render shard `shardNum` (1-based) of `totalShards` into `${outDir}/shards/seg_${shardNum}.mp4`
 * (video-only, identical H.264/bt709 encode parameters across all shards).
 * Skips rendering if an existing valid segment with the exact expected frame count exists (resume).
 */
async function renderSegment({
  shardNum,
  totalShards,
  totalFrames,
  scenario,
  dsf,
  chromeBin,
  chromeVersion,
  serverPort,
  outDir,
  shardsDir,
  previewMap,
  pageErrors,
}) {
  const chunk = Math.ceil(totalFrames / totalShards);
  const startFrame = (shardNum - 1) * chunk;
  const endFrame = Math.min(totalFrames, shardNum * chunk);
  const frameCount = Math.max(0, endFrame - startFrame);
  const segPath = path.join(shardsDir, `seg_${shardNum}.mp4`);
  const tmpSegPath = path.join(shardsDir, `seg_${shardNum}.tmp.mp4`);
  const metricsPath = path.join(shardsDir, `metrics_${shardNum}.json`);
  const expectedW = Math.round(720 * dsf);
  const expectedH = Math.round(1280 * dsf);

  if (frameCount === 0) {
    throw new Error(`Shard ${shardNum}/${totalShards} has 0 frames for totalFrames=${totalFrames}`);
  }

  // Resume check: skip if seg_i.mp4 already exists with exact expected frame count and resolution
  if (fs.existsSync(segPath)) {
    const existing = probeSegment(segPath);
    if (existing && existing.frames === frameCount && existing.width === expectedW && existing.height === expectedH) {
      console.log(`Shard ${shardNum}/${totalShards}: resume hit — ${segPath} already valid (${existing.frames} frames @ ${existing.width}x${existing.height}), skipping.`);
      return { shardNum, skipped: true, frameCount, segPath };
    }
    console.log(`Shard ${shardNum}/${totalShards}: existing ${segPath} invalid (${JSON.stringify(existing)}), re-rendering.`);
    try { fs.rmSync(segPath, { force: true }); } catch {}
  }

  const cdpPort = CDP_PORT + (shardNum - 1);
  const profDir = `${PROFILE_DIR}_${process.pid}_s${shardNum}`;
  try { fs.rmSync(profDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(profDir, { recursive: true });

  const chrome = spawn(
    chromeBin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profDir}`,
      '--window-size=720,1280',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  let chromeErr = '';
  chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });

  const shardStartMs = Date.now();
  try {
    const wsUrl = await waitForCdpTarget(cdpPort);
    const { ws, send } = await createCdpClient(wsUrl, (method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        const msg = `[PAGE EXCEPTION shard=${shardNum}/${totalShards}] ${formatExceptionDetails(params.exceptionDetails)}`;
        console.error(msg);
        pageErrors.push(msg);
      } else if (method === 'Runtime.consoleAPICalled') {
        const type = params.type || 'log';
        const text = (params.args || []).map(formatCdpRemoteArg).join(' ');
        if (type === 'error' || type === 'assert') {
          const msg = `[PAGE CONSOLE ${type.toUpperCase()} shard=${shardNum}/${totalShards}] ${text}`;
          console.error(msg);
          pageErrors.push(msg);
        }
      }
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 720,
      height: 1280,
      deviceScaleFactor: dsf,
      mobile: false,
    });

    const pageQuery = new URLSearchParams({
      scenario,
      timings: '/__assets__/vo_timings.json',
      dsf: String(dsf),
    }).toString();
    await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/index.html?${pageQuery}` });

    let ready = false;
    for (let i = 0; i < 80; i++) {
      const res = await send('Runtime.evaluate', { expression: 'Boolean(window.__ready)', returnByValue: true });
      if (res?.exceptionDetails) {
        const msg = `[PAGE EVAL EXCEPTION shard=${shardNum}/${totalShards}] ${formatExceptionDetails(res.exceptionDetails)}`;
        console.error(msg);
        pageErrors.push(msg);
      }
      if (res?.result?.value === true) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!ready) {
      throw new Error(`Shard ${shardNum}/${totalShards} did not signal window.__ready=true (${chromeErr.slice(-300)})`);
    }

    // Video-only encode with strictly identical parameters across all shards for lossless concat
    const ffArgs = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-framerate', String(FPS),
      '-i', 'pipe:0',
      '-vf', 'scale=in_color_matrix=bt470bg:out_color_matrix=bt709:in_range=full:out_range=tv,format=yuv420p,setsar=1',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level', '4.1',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'tv',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709',
      '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
      '-preset', 'medium',
      '-crf', '18',
      '-video_track_timescale', '24000',
      '-an',
      '-movflags', '+faststart',
      tmpSegPath,
    ];

    const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d.toString(); });
    const ffDone = new Promise((resolve, reject) => {
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg shard ${shardNum} exited ${code}: ${ffErr.slice(-600)}`))));
    });

    const loopStartMs = Date.now();
    for (let f = startFrame; f < endFrame; f++) {
      const evalRes = await send('Runtime.evaluate', { expression: `window.renderFrame(${f}, ${FPS})`, returnByValue: true });
      if (evalRes?.exceptionDetails) {
        const msg = `[PAGE RENDER EXCEPTION frame=${f}] ${formatExceptionDetails(evalRes.exceptionDetails)}`;
        console.error(msg);
        pageErrors.push(msg);
        throw new Error(msg);
      }
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, optimizeForSpeed: true });
      const buf = Buffer.from(shot.data, 'base64');

      const previewNames = previewMap.get(f);
      if (previewNames) {
        for (const previewName of previewNames) {
          fs.writeFileSync(path.join(outDir, previewName), buf);
        }
      }

      if (!ff.stdin.write(buf)) {
        await new Promise((r) => ff.stdin.once('drain', r));
      }

      const doneInShard = f - startFrame + 1;
      if (doneInShard % 60 === 0 || doneInShard === frameCount) {
        const elapsedSec = ((Date.now() - loopStartMs) / 1000).toFixed(1);
        const msPerF = ((Date.now() - loopStartMs) / doneInShard).toFixed(1);
        console.log(`Shard ${shardNum}/${totalShards}: ${doneInShard}/${frameCount} frames (${elapsedSec}s, ${msPerF}ms/f)`);
      }
    }

    const renderLoopMs = Date.now() - loopStartMs;
    ff.stdin.end();
    await ffDone;
    ws.close();

    fs.renameSync(tmpSegPath, segPath);
    const totalMs = Date.now() - shardStartMs;
    const metrics = {
      shard: shardNum,
      totalShards,
      scenario,
      startFrame,
      endFrame,
      frameCount,
      renderLoopMs,
      totalMs,
      msPerFrame: +(renderLoopMs / frameCount).toFixed(2),
      totalMsPerFrame: +(totalMs / frameCount).toFixed(2),
      dsf,
      nodeVersion: process.version,
      chromeBin,
      chromeVersion,
    };
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
    console.log(`Shard ${shardNum}/${totalShards} done: ${segPath} (${frameCount} frames, ${metrics.msPerFrame}ms/f render, ${(totalMs / 1000).toFixed(1)}s total)`);
    return { shardNum, skipped: false, frameCount, segPath, metrics };
  } finally {
    chrome.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 250));
    try { fs.rmSync(profDir, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(tmpSegPath)) fs.rmSync(tmpSegPath, { force: true }); } catch {}
  }
}

async function main() {
  const opts = parseCommonArgs(process.argv.slice(2));
  const outDir = path.resolve(__dirname, opts.outDir);
  const assetsDir = resolveAssetsDir(opts);
  const shardsDir = path.join(outDir, 'shards');
  fs.mkdirSync(shardsDir, { recursive: true });

  const timingsPath = path.join(assetsDir, 'vo_timings.json');
  const timings = fs.existsSync(timingsPath)
    ? JSON.parse(fs.readFileSync(timingsPath, 'utf8'))
    : { total_duration: 6.0 };

  const totalFrames = Math.ceil(timings.total_duration * FPS);
  const previewMap = buildPreviewMap(timings, totalFrames, FPS);
  const chromeBin = detectChromeBin();
  const chromeVersion = getChromeVersion(chromeBin);

  console.log(`Scenario=${opts.scenario} | Frames=${totalFrames} @ ${FPS}fps | DSF=${opts.dsf} | Assets=${assetsDir} | Chrome=${chromeBin} (${chromeVersion})`);

  const { server, port } = await startServer(assetsDir);
  const pageErrors = [];
  const wallStartMs = Date.now();

  try {
    if (opts.shardSpec) {
      // Single-shard mode (cloud matrix or manual shard resume): video-only seg_i.mp4
      const { shardNum, totalShards } = parseShardSpec(opts.shardSpec);
      await renderSegment({
        shardNum,
        totalShards,
        totalFrames,
        scenario: opts.scenario,
        dsf: opts.dsf,
        chromeBin,
        chromeVersion,
        serverPort: port,
        outDir,
        shardsDir,
        previewMap,
        pageErrors,
      });
    } else {
      // Full local mode: run shards 1..SHARDS (bounded by CONCURRENCY to avoid OOM on mobile), then concat + mux
      const totalShards = Math.max(1, opts.shards);
      const concurrency = Math.max(1, Number(process.env.CONCURRENCY || 1));
      for (let start = 1; start <= totalShards; start += concurrency) {
        const batch = [];
        for (let i = start; i < Math.min(totalShards + 1, start + concurrency); i++) {
          batch.push(
            renderSegment({
              shardNum: i,
              totalShards,
              totalFrames,
              scenario: opts.scenario,
              dsf: opts.dsf,
              chromeBin,
              chromeVersion,
              serverPort: port,
              outDir,
              shardsDir,
              previewMap,
              pageErrors,
            })
          );
        }
        await Promise.all(batch);
      }
      await muxSegments({ ...opts, shards: totalShards });
      const totalWallSec = ((Date.now() - wallStartMs) / 1000).toFixed(1);
      console.log(`All done in ${totalWallSec}s (page JS errors: ${pageErrors.length})`);
    }

    if (pageErrors.length > 0) {
      throw new Error(`Encountered ${pageErrors.length} page JS error(s):\n${pageErrors.join('\n')}`);
    }
  } catch (err) {
    console.error('Render failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

main();
