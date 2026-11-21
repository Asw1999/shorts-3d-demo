import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeTemporalStability } from './temporal_check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const W = 720;
const H = 1280;
const DSF = 1.5; // 1080x1920
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function whichBin(name) {
  try {
    return execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

function detectChrome() {
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    const f = whichBin(name);
    if (f) return f;
  }
  throw new Error('No Chrome/Chromium binary found');
}

function startServer(assetsDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      if (reqPath === '/favicon.ico') { res.writeHead(404); res.end(); return; }
      const fp = reqPath.startsWith('/__assets__/')
        ? path.resolve(assetsDir, reqPath.slice('/__assets__/'.length))
        : path.resolve(__dirname, '.' + reqPath);
      if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
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

async function runRendererSession(chromeBin, port, scenario, rendererMode, stillSecs, benchStartSec, benchFrames, outDir, cdpPort) {
  const profDir = path.join(os.tmpdir(), `webgl_spike_${scenario}_${rendererMode}_${process.pid}`);
  try { fs.rmSync(profDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(profDir, { recursive: true });

  const args = [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profDir}`,
    '--window-size=720,1280',
  ];
  if (rendererMode === 'webgl') {
    args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
  } else {
    args.push('--disable-gpu', '--enable-unsafe-swiftshader');
  }
  args.push('about:blank');

  const ch = spawn(chromeBin, args, { stdio: 'ignore' });
  try {
    const wsUrl = await waitForCdp(cdpPort);
    const { ws, send } = await createCdp(wsUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DSF, mobile: false });
    const q = new URLSearchParams({
      scenario,
      timings: '/__assets__/vo_timings.json',
      dsf: String(DSF),
      renderer: rendererMode,
    }).toString();
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?${q}` });

    let ready = false;
    for (let i = 0; i < 80; i++) {
      const r = await send('Runtime.evaluate', { expression: 'Boolean(window.__ready)', returnByValue: true });
      if (r?.result?.value === true) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!ready) throw new Error(`${scenario}/${rendererMode} failed to become ready`);

    const glInfoRes = await send('Runtime.evaluate', { expression: 'window.__webglInfo || null', returnByValue: true });
    const webglInfo = glInfoRes?.result?.value || null;

    // 1. Capture 3 full-res 1080x1920 PNG stills
    const stillPaths = [];
    for (const sec of stillSecs) {
      const f = Math.round(sec * FPS);
      const ev = await send('Runtime.evaluate', { expression: `window.renderFrame(${f}, ${FPS})`, returnByValue: true });
      if (ev?.exceptionDetails) throw new Error(`renderFrame exception at t=${sec}s: ${ev.exceptionDetails.text}`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const sp = path.join(outDir, `${scenario}_${rendererMode}_t${sec}.png`);
      fs.writeFileSync(sp, Buffer.from(shot.data, 'base64'));
      stillPaths.push(sp);
    }

    // 2. Benchmark 120 consecutive frames (5 seconds @ 24fps) piped to FFmpeg for temporal check + ms/frame
    const mp4Path = path.join(outDir, `${scenario}_${rendererMode}_bench.mp4`);
    const ff = spawn('ffmpeg', [
      '-y', '-v', 'error', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
      '-vf', 'scale=in_color_matrix=bt470bg:out_color_matrix=bt709:in_range=full:out_range=tv,format=yuv420p,setsar=1',
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'medium', '-qp', '18',
      '-x264-params', `keyint=${FPS}:min-keyint=${FPS}:scenecut=0:open-gop=0:threads=1`,
      mp4Path,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    const ffDone = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));

    const startF = Math.round(benchStartSec * FPS);
    let jsRenderSumMs = 0;
    const t0 = Date.now();
    for (let i = 0; i < benchFrames; i++) {
      const f = startF + i;
      const js0 = Date.now();
      const ev = await send('Runtime.evaluate', { expression: `window.renderFrame(${f}, ${FPS})`, returnByValue: true });
      jsRenderSumMs += Date.now() - js0;
      if (ev?.exceptionDetails) throw new Error(`renderFrame exception at f=${f}: ${ev.exceptionDetails.text}`);
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, optimizeForSpeed: true });
      const buf = Buffer.from(shot.data, 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    const loopMs = Date.now() - t0;
    ff.stdin.end();
    await ffDone;
    ws.close();

    const stability = analyzeTemporalStability(mp4Path);
    const { perSecond, ...stabSummary } = stability;

    return {
      rendererMode,
      webglInfo,
      benchFrames,
      msPerFrameTotal: +(loopMs / benchFrames).toFixed(2),
      msPerFrameJsOnly: +(jsRenderSumMs / benchFrames).toFixed(2),
      stability: stabSummary,
      stillPaths,
    };
  } finally {
    ch.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 250));
    try { fs.rmSync(profDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const outDir = path.resolve(__dirname, 'out_webgl_spike');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const chromeBin = detectChrome();
  const chromeVersion = execFileSync(chromeBin, ['--version'], { encoding: 'utf8' }).trim();

  const plan = [
    { scenario: 'submarine', totalFrames: 1129, stillSecs: [2, 16, 32], benchStartSec: 14, benchFrames: 120 },
    { scenario: 'a10', totalFrames: 1218, stillSecs: [14, 26, 38], benchStartSec: 18, benchFrames: 120 },
  ];

  const report = { chromeBin, chromeVersion, scenarios: {} };

  for (let pi = 0; pi < plan.length; pi++) {
    const item = plan[pi];
    const assetsDir = path.join(__dirname, 'assets', item.scenario);
    const { server, port } = await startServer(assetsDir);
    try {
      console.log(`\n=== SPIKE SCENARIO: ${item.scenario} ===`);
      const c2d = await runRendererSession(chromeBin, port, item.scenario, 'canvas2d', item.stillSecs, item.benchStartSec, item.benchFrames, outDir, 9310 + pi * 2);
      const wgl = await runRendererSession(chromeBin, port, item.scenario, 'webgl', item.stillSecs, item.benchStartSec, item.benchFrames, outDir, 9311 + pi * 2);

      // Estimate total Actions minutes for 3 shards + plan (5s) + mux (95s) + setup (5s per render job)
      const estRenderSecTotal3Shards = (wgl.msPerFrameTotal / 1000) * item.totalFrames;
      const estMaxShardSec = estRenderSecTotal3Shards / 3;
      const estActionsMinutes = +((5 + 3 * (12 + estMaxShardSec) + 95) / 60).toFixed(2);
      const estWallMinutes = +((5 + 12 + estMaxShardSec + 95) / 60).toFixed(2);

      // Build before (top row: Canvas2D) vs after (bottom row: WebGL) 3x2 comparison sheet
      const sheetPath = path.join(outDir, `compare_${item.scenario}.jpg`);
      execFileSync('ffmpeg', [
        '-y', '-v', 'error',
        '-i', c2d.stillPaths[0], '-i', c2d.stillPaths[1], '-i', c2d.stillPaths[2],
        '-i', wgl.stillPaths[0], '-i', wgl.stillPaths[1], '-i', wgl.stillPaths[2],
        '-filter_complex',
        '[0:v][1:v][2:v]hstack=inputs=3[top];[3:v][4:v][5:v]hstack=inputs=3[bot];[top][bot]vstack=inputs=2,scale=1620:-1[out]',
        '-map', '[out]', '-q:v', '3', sheetPath,
      ]);

      const perfGo = wgl.msPerFrameTotal <= 1500;
      const stabGo = wgl.stability.pass;
      report.scenarios[item.scenario] = {
        totalFrames: item.totalFrames,
        stillSecs: item.stillSecs,
        canvas2d: {
          msPerFrameTotal: c2d.msPerFrameTotal,
          msPerFrameJsOnly: c2d.msPerFrameJsOnly,
          stabilityPass: c2d.stability.pass,
          meanJitterFrac: c2d.stability.meanJitterFrac,
        },
        webgl: {
          webglInfo: wgl.webglInfo,
          msPerFrameTotal: wgl.msPerFrameTotal,
          msPerFrameJsOnly: wgl.msPerFrameJsOnly,
          stabilityPass: wgl.stability.pass,
          meanJitterFrac: wgl.stability.meanJitterFrac,
          maxSecJitterFrac: wgl.stability.maxSecJitterFrac,
          maxOscRun: wgl.stability.maxOscRun,
          estActionsMinutes3Shards: estActionsMinutes,
          estWallMinutes3Shards: estWallMinutes,
        },
        numericGo: perfGo && stabGo,
        compareSheet: path.basename(sheetPath),
      };
    } finally {
      server.close();
    }
  }

  fs.writeFileSync(path.join(outDir, 'spike_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

  const lines = [
    '## Fase 3 — WebGL SwiftShader Cloud Spike (`ubuntu-24.04`, 1080x1920)',
    '',
    `Chrome: \`${chromeVersion}\``,
    '',
    '| Scenario | Canvas2D ms/f | WebGL ms/f (<=1500) | WebGL Samples | WebGL Stability (mean/maxSec/osc) | Est. Actions Min (3 shards) | Numeric Gate |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [sc, r] of Object.entries(report.scenarios)) {
    const w = r.webgl;
    lines.push(
      `| ${sc} | ${r.canvas2d.msPerFrameTotal} | **${w.msPerFrameTotal}** (JS ${w.msPerFrameJsOnly}) | MSAA ${w.webglInfo?.samples ?? '?'}x | ${w.stabilityPass ? 'PASS' : 'FAIL'} (${w.meanJitterFrac}/${w.maxSecJitterFrac}/${w.maxOscRun}) | ${w.estActionsMinutes3Shards} min (wall ${w.estWallMinutes3Shards}m) | ${r.numericGo ? 'GO' : 'NO-GO'} |`
    );
  }
  lines.push('');
  const md = lines.join('\n');
  console.log('\n' + md);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  }
}

main().catch((err) => {
  console.error('webgl_spike.mjs failed:', err);
  process.exit(1);
});
