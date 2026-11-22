import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs, resolveAssetsDir } from './mux.mjs';
import { computeShardRange } from './render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const GOP = FPS;
const W = 720;
const H = 1280;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

function whichBin(name) {
  try {
    const out = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch { return null; }
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
    try { dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium')).sort().reverse(); } catch { continue; }
    for (const d of dirs) {
      for (const rel of [
        ['chrome-linux', 'chrome'],
        ['chrome-linux64', 'chrome'],
        ['chrome-linux', 'headless_shell'],
        ['chrome-linux64', 'chrome-headless-shell'],
      ]) {
        const c = path.join(root, d, ...rel);
        if (fs.existsSync(c)) return c;
      }
    }
  }
  return null;
}

function detectChromeBin() {
  if (process.env.CHROME_BIN) {
    const b = process.env.CHROME_BIN.trim();
    if (fs.existsSync(b)) return b;
    const r = whichBin(b);
    if (r) return r;
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    const f = whichBin(name);
    if (f) return f;
  }
  const pw = findPlaywrightChrome();
  if (pw) return pw;
  throw new Error('No Chromium/Chrome binary found for seam_check.mjs');
}

function startServer(assetsDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      if (reqPath === '/favicon.ico') { res.writeHead(404); res.end(); return; }
      const filePath = reqPath.startsWith('/__assets__/')
        ? path.resolve(assetsDir, reqPath.slice('/__assets__/'.length))
        : path.resolve(__dirname, '.' + reqPath);
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function waitForCdp(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
        if (pg) return pg.webSocketDebuggerUrl;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for CDP on port ${port}`);
}

function createCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nid = 1;
    const pend = new Map();
    ws.addEventListener('open', () => {
      const send = (method, params = {}) => new Promise((res, rej) => {
        const id = nid++;
        pend.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
      resolve({ ws, send });
    });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data.toString());
      if (m.id && pend.has(m.id)) {
        const { res, rej } = pend.get(m.id);
        pend.delete(m.id);
        if (m.error) rej(new Error(m.error.message));
        else res(m.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}

async function captureFrameRange(chromeBin, port, scenario, dsf, startF, endF, cdpPort) {
  const profDir = path.join(process.env.TMPDIR || os.tmpdir(), `seam_${scenario}_${process.pid}_${cdpPort}`);
  try { fs.rmSync(profDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(profDir, { recursive: true });

  const rendererMode = (process.env.RENDERER || 'canvas2d').toLowerCase();
  const chromeArgs = [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profDir}`,
    '--window-size=720,1280',
  ];
  if (rendererMode === 'webgl') {
    chromeArgs.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
  } else {
    chromeArgs.push('--disable-gpu', '--enable-unsafe-swiftshader');
  }
  chromeArgs.push('about:blank');

  const ch = spawn(chromeBin, chromeArgs, { stdio: 'ignore' });

  try {
    const wsUrl = await waitForCdp(cdpPort);
    const { ws, send } = await createCdp(wsUrl);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dsf, mobile: false });
    const q = new URLSearchParams({
      scenario,
      timings: '/__assets__/vo_timings.json',
      dsf: String(dsf),
      preset: process.env.PRESET || 'explainer',
      renderer: process.env.RENDERER || 'canvas2d',
      model: process.env.MODEL || 'procedural',
    }).toString();
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?${q}` });
    for (let i = 0; i < 80; i++) {
      const r = await send('Runtime.evaluate', { expression: 'Boolean(window.__ready)', returnByValue: true });
      if (r?.result?.value === true) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    const frames = [];
    for (let f = startF; f < endF; f++) {
      await send('Runtime.evaluate', { expression: `window.renderFrame(${f}, ${FPS})`, returnByValue: true });
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, optimizeForSpeed: true });
      frames.push(Buffer.from(shot.data, 'base64'));
    }
    ws.close();
    return frames;
  } finally {
    ch.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(profDir, { recursive: true, force: true }); } catch {}
  }
}

async function encodeFrames(jpegs, outPath) {
  const ffArgs = [
    '-y', '-v', 'error',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
    '-vf', 'scale=in_color_matrix=bt470bg:out_color_matrix=bt709:in_range=full:out_range=tv,format=yuv420p,setsar=1',
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
    '-preset', 'medium', '-qp', '18',
    '-x264-params', `keyint=${GOP}:min-keyint=${GOP}:scenecut=0:open-gop=0:b-adapt=0:threads=1`,
    '-video_track_timescale', '24000', '-an', '-movflags', '+faststart',
    outPath,
  ];
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => { err += d.toString(); });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(err)))));
  for (const buf of jpegs) {
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
}

function decodeFrameRgb(mp4Path, frameOffset) {
  const proc = spawnSync('ffmpeg', [
    '-v', 'error', '-i', mp4Path,
    '-vf', `select=eq(n\\,${frameOffset})`,
    '-vsync', '0', '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { maxBuffer: 20 * 1024 * 1024 });
  if (proc.status !== 0) {
    throw new Error(`ffmpeg decode failed at offset ${frameOffset}: ${proc.stderr?.toString()}`);
  }
  return proc.stdout;
}

function meanAbsDiffPct(bufA, bufB) {
  if (bufA.length !== bufB.length || bufA.length === 0) return 100.0;
  let sum = 0;
  for (let i = 0; i < bufA.length; i++) {
    sum += Math.abs(bufA[i] - bufB[i]);
  }
  return (sum / (bufA.length * 255)) * 100.0;
}

async function main() {
  const opts = parseCommonArgs(process.argv.slice(2));
  const outDir = path.resolve(__dirname, opts.outDir);
  const assetsDir = resolveAssetsDir(opts);
  const timings = JSON.parse(fs.readFileSync(path.join(assetsDir, 'vo_timings.json'), 'utf8'));
  const totalFrames = Math.ceil(timings.total_duration * FPS);
  const totalShards = Math.max(2, opts.shards || 3);

  // Collect interior shard boundaries for SHARDS=3
  const boundaries = [];
  for (let s = 1; s < totalShards; s++) {
    const r = computeShardRange(s, totalShards, totalFrames);
    if (r.endFrame >= GOP && r.endFrame + GOP <= totalFrames) {
      boundaries.push(r.endFrame);
    }
  }

  const chromeBin = detectChromeBin();
  const { server, port } = await startServer(assetsDir);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `seam_work_${opts.scenario}_`));

  const results = [];
  let maxDiffPct = 0;

  try {
    for (let bi = 0; bi < boundaries.length; bi++) {
      const b = boundaries[bi];
      const winStart = b - GOP;
      const winEnd = b + GOP;

      // 1. Continuous SHARDS=1 session across [b-24 .. b+23]
      const contJpegs = await captureFrameRange(chromeBin, port, opts.scenario, opts.dsf, winStart, winEnd, 9280 + bi * 2);
      // 2. Cold-started SHARDS=3 session starting directly at shard boundary b ([b .. b+23])
      const coldJpegs = await captureFrameRange(chromeBin, port, opts.scenario, opts.dsf, b, winEnd, 9281 + bi * 2);

      // Encode continuous 48-frame MP4 vs 24+24 sharded & concatenated MP4
      const s1Mp4 = path.join(tmpDir, `b${b}_s1.mp4`);
      const segA = path.join(tmpDir, `b${b}_segA.mp4`);
      const segB = path.join(tmpDir, `b${b}_segB.mp4`);
      const s3Mp4 = path.join(tmpDir, `b${b}_s3.mp4`);
      const concatTxt = path.join(tmpDir, `b${b}_concat.txt`);

      await encodeFrames(contJpegs, s1Mp4);
      await encodeFrames(contJpegs.slice(0, GOP), segA);
      await encodeFrames(coldJpegs, segB);
      fs.writeFileSync(concatTxt, `file '${segA}'\nfile '${segB}'\n`, 'utf8');
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-c:v', 'copy', s3Mp4]);

      // Check ±3 frames around the seam: offsets GOP-3 .. GOP+3 -> absolute frames b-3 .. b+3
      const frameDiffs = [];
      for (let off = -3; off <= 3; off++) {
        const localIdx = GOP + off;
        const a = decodeFrameRgb(s1Mp4, localIdx);
        const c = decodeFrameRgb(s3Mp4, localIdx);
        const pct = meanAbsDiffPct(a, c);
        if (pct > maxDiffPct) maxDiffPct = pct;
        frameDiffs.push({ frame: b + off, rel: off, diffPct: +pct.toFixed(6) });
      }
      results.push({ boundaryFrame: b, boundarySec: +(b / FPS).toFixed(3), frames: frameDiffs });
    }
  } finally {
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  const pass = maxDiffPct === 0.0;
  const seamCheck = {
    scenario: opts.scenario,
    shardsCompared: `1 vs ${totalShards}`,
    boundariesChecked: boundaries,
    maxDiffPct: +maxDiffPct.toFixed(6),
    pass,
    details: results,
  };

  const mdLines = [
    `### Seam Check (SHARDS=1 vs ${totalShards}, ±3 frames) — \`${opts.scenario}\` (${pass ? 'PASS' : 'FAIL'})`,
    '',
    '| Boundary Frame | Time | Frame Diffs (b-3..b+3) | Max Diff | Result |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const r of results) {
    const vals = r.frames.map((x) => `${x.diffPct.toFixed(4)}%`).join(', ');
    const rMax = Math.max(...r.frames.map((x) => x.diffPct));
    mdLines.push(`| ${r.boundaryFrame} | ${r.boundarySec}s | ${vals} | ${rMax.toFixed(4)}% | ${rMax === 0 ? 'PASS' : 'FAIL'} |`);
  }
  mdLines.push('');
  const md = mdLines.join('\n');
  console.log('\n' + md);

  // Merge into metrics.json
  fs.mkdirSync(outDir, { recursive: true });
  const metricsPath = path.join(outDir, 'metrics.json');
  let metrics = {};
  if (fs.existsSync(metricsPath)) {
    try { metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8')); } catch {}
  }
  metrics.seamCheck = seamCheck;
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + '\n', 'utf8');

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  }

  if (!pass) {
    console.error(`SEAM CHECK FAILED: maxDiffPct=${maxDiffPct.toFixed(6)}% (expected 0.0000%)`);
    process.exit(1);
  }
  console.log(`SEAM CHECK PASSED for ${opts.scenario}: maxDiffPct=0.0000% across all shard boundaries!`);
}

main().catch((err) => {
  console.error('seam_check.mjs failed:', err);
  process.exit(1);
});
