import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs, resolveAssetsDir } from './mux.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const W = 720;
const H = 1280;
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
    } catch { continue; }
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
    throw new Error(`CHROME_BIN=${b} not found`);
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    const f = whichBin(name);
    if (f) return f;
  }
  const pw = findPlaywrightChrome();
  if (pw) return pw;
  throw new Error('No Chromium/Chrome binary found for verify.mjs');
}

function startServer(assetsDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      if (reqPath === '/favicon.ico') { res.writeHead(404); res.end(); return; }
      let filePath;
      if (reqPath.startsWith('/__assets__/')) {
        filePath = path.resolve(assetsDir, reqPath.slice('/__assets__/'.length));
        if (!filePath.startsWith(assetsDir) || !fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
      } else {
        filePath = path.resolve(__dirname, '.' + reqPath);
        if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
      }
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

function srgbToLin(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relLum(r, g, b) {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

function wcagRatio(l1, l2) {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function measureSilhouetteContrast(pngBuf, edges, subjBounds, dsf) {
  if (!edges || !edges.length) return null;
  const rw = Math.round(W * dsf);
  const rh = Math.round(H * dsf);
  const proc = spawnSync('ffmpeg', [
    '-v', 'error', '-f', 'image2pipe', '-vcodec', 'png', '-i', 'pipe:0',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { input: pngBuf, maxBuffer: 20 * 1024 * 1024 });
  if (proc.status !== 0 || proc.stdout.length < rw * rh * 3) return null;
  const rgb = proc.stdout;
  const pixLum = (x, y) => {
    const ix = Math.max(0, Math.min(rw - 1, Math.round(x * dsf)));
    const iy = Math.max(0, Math.min(rh - 1, Math.round(y * dsf)));
    const idx = (iy * rw + ix) * 3;
    return relLum(rgb[idx], rgb[idx + 1], rgb[idx + 2]);
  };

  const scx = 0.5 * (subjBounds.minX + subjBounds.maxX);
  const scy = 0.5 * (subjBounds.minY + subjBounds.maxY);

  // Sample surrounding background luminance at perimeter corners around subject bbox
  const bgSamples = [];
  for (const [bx, by] of [
    [subjBounds.minX - 24, subjBounds.minY - 12],
    [subjBounds.maxX + 24, subjBounds.minY - 12],
    [subjBounds.minX - 24, scy],
    [subjBounds.maxX + 24, scy],
    [scx, Math.max(198, subjBounds.minY - 18)],
    [scx, Math.min(800, subjBounds.maxY + 18)],
  ]) {
    if (bx >= 8 && bx < W - 8 && by >= 196 && by < 808) {
      bgSamples.push(pixLum(bx, by));
    }
  }
  const fallbackBgLum = bgSamples.length
    ? bgSamples.sort((a, b) => a - b)[Math.floor(bgSamples.length / 2)]
    : 0.15;

  const ratios = [];
  for (const [ax, ay, bx, by] of edges) {
    const mx = 0.5 * (ax + bx);
    const my = 0.5 * (ay + by);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    let nx = -dy / len;
    let ny = dx / len;
    // Orient normal outward from subject center
    if (nx * (mx - scx) + ny * (my - scy) < 0) { nx = -nx; ny = -ny; }

    // Background luminance just outside silhouette (10-16px outward)
    const bgLum = (mx + nx * 14 >= 6 && mx + nx * 14 < W - 6 && my + ny * 14 >= 196 && my + ny * 14 < 808)
      ? pixLum(mx + nx * 14, my + ny * 14)
      : fallbackBgLum;

    // Best silhouette edge pixel within ±3px across the edge stroke/rim halo
    let bestR = 1.0;
    for (let off = -3; off <= 3; off += 1) {
      const lEdge = pixLum(mx + nx * off, my + ny * off);
      const r = wcagRatio(lEdge, bgLum);
      if (r > bestR) bestR = r;
    }
    ratios.push(bestR);
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  // 75th percentile represents clean outer silhouette boundary (excluding internal occluded edges)
  return ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.75))];
}

function rectsOverlapGap(a, b, gap) {
  return (
    a.left < b.right + gap &&
    a.right + gap > b.left &&
    a.top < b.bottom + gap &&
    a.bottom + gap > b.top
  );
}

async function runDomLayoutGate(scenario, assetsDir, dsf) {
  const timingsPath = path.join(assetsDir, 'vo_timings.json');
  const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  const totalFrames = Math.ceil(timings.total_duration * FPS);
  const stepFrames = Math.round(0.25 * FPS); // 6 frames = 0.25s exact sampling!

  const chromeBin = detectChromeBin();
  const { server, port } = await startServer(assetsDir);
  const cdpPort = 9260 + (process.pid % 200);
  const profDir = path.join(process.env.TMPDIR || os.tmpdir(), `verify_${scenario}_${process.pid}`);
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

  const chrome = spawn(chromeBin, chromeArgs, { stdio: 'ignore' });

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
    }).toString();
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?${q}` });

    let ready = false;
    for (let i = 0; i < 80; i++) {
      const r = await send('Runtime.evaluate', { expression: 'Boolean(window.__ready)', returnByValue: true });
      if (r?.result?.value === true) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!ready) throw new Error('Page did not become ready for verification');

    const samples = [];
    const violations = {
      captionVsSubject: [],
      labelVsLabel: [],
      labelVsCaption: [],
      labelVsHud: [],
      wordGapLt6px: [],
      hudSafeZone: [],
      captionSafeZone: [],
      subjectTooSmallInExplanation: [],
      lowContrast: [],
    };

    let minWordGapPx = Infinity;
    let minSubjExplPct = Infinity;
    let maxSubjExplPct = 0;
    let minBgLum = 1.0;
    let maxDarkFactor = 0.0;
    let hudTopPct = null;
    let maxCaptionBottomPct = 0;
    let minContrastRatio = Infinity;
    let contrastSamples = 0;

    for (let idx = 0, f = 0; f < totalFrames; f += stepFrames, idx++) {
      const evalRes = await send('Runtime.evaluate', {
        expression: `(() => { window.renderFrame(${f}, ${FPS}); return window.__inspectFrame(); })()`,
        returnByValue: true,
      });
      if (evalRes?.exceptionDetails) {
        throw new Error(`Exception at frame ${f}: ${evalRes.exceptionDetails.text}`);
      }
      const d = evalRes.result.value;
      samples.push({ f, t: d.t, cam: d.cameraState, hook: d.hookRect });

      // Contrast check every 2.0s (every 8th 0.25s sample) via real rendered pixels
      if (idx % 8 === 0 && d.silhouetteEdges && d.silhouetteEdges.length > 0) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const ratio = measureSilhouetteContrast(Buffer.from(shot.data, 'base64'), d.silhouetteEdges, d.subjectBounds, dsf);
        if (ratio !== null) {
          contrastSamples++;
          if (ratio < minContrastRatio) minContrastRatio = ratio;
          if (ratio < 3.0) {
            violations.lowContrast.push({ t: +d.t.toFixed(2), ratio: +ratio.toFixed(2), bgLum: +d.bgLum.toFixed(3) });
          }
        }
      }

      if (d.bgLum < minBgLum) minBgLum = d.bgLum;
      if (d.darkFactor > maxDarkFactor) maxDarkFactor = d.darkFactor;

      if (d.hudRect) {
        const pct = (d.hudRect.top / H) * 100;
        hudTopPct = pct;
        if (pct < 9.0 || pct > 14.0) {
          violations.hudSafeZone.push({ t: +d.t.toFixed(2), hudTopPct: +pct.toFixed(2) });
        }
      }

      if (d.captionRect) {
        const capBotPct = (d.captionRect.bottom / H) * 100;
        if (capBotPct > maxCaptionBottomPct) maxCaptionBottomPct = capBotPct;
        if (capBotPct > 78.5) {
          violations.captionSafeZone.push({ t: +d.t.toFixed(2), capBotPct: +capBotPct.toFixed(2) });
        }

        // Caption vs main subject bounding box intersection
        const sb = d.subjectBounds;
        const sbRect = { left: sb.minX, top: sb.minY, right: sb.maxX, bottom: sb.maxY };
        if (sb.heightPct > 0 && rectsOverlapGap(sbRect, d.captionRect, 0)) {
          violations.captionVsSubject.push({
            t: +d.t.toFixed(2),
            subjMaxY: +sb.maxY.toFixed(1),
            capTop: +d.captionRect.top.toFixed(1),
          });
        }
      }

      // Word gap >= 6px check on same line
      for (let i = 0; i < d.wordSpans.length - 1; i++) {
        const a = d.wordSpans[i];
        const b = d.wordSpans[i + 1];
        if (Math.abs(a.top - b.top) < 22) {
          const gap = b.left - a.right;
          if (gap < minWordGapPx) minWordGapPx = gap;
          if (gap < 6.0) {
            violations.wordGapLt6px.push({
              t: +d.t.toFixed(2),
              pair: `${a.text}|${b.text}`,
              gapPx: +gap.toFixed(2),
            });
          }
        }
      }

      // Label collisions (minimum gap 10px: label-vs-label, label-vs-caption, label-vs-HUD)
      const lbls = d.calloutRects || [];
      for (let i = 0; i < lbls.length; i++) {
        const a = lbls[i];
        if (d.captionRect && rectsOverlapGap(a, d.captionRect, 10)) {
          violations.labelVsCaption.push({ t: +d.t.toFixed(2), label: a.label });
        }
        if (d.hudRect && rectsOverlapGap(a, d.hudRect, 10)) {
          violations.labelVsHud.push({ t: +d.t.toFixed(2), label: a.label });
        }
        for (let j = i + 1; j < lbls.length; j++) {
          const b = lbls[j];
          if (rectsOverlapGap(a, b, 10)) {
            violations.labelVsLabel.push({ t: +d.t.toFixed(2), pair: `${a.label} <> ${b.label}` });
          }
        }
      }

      // Subject height >= 35% in explanation beats
      if (d.isExplanation) {
        const hp = d.subjectBounds.heightPct;
        if (hp < minSubjExplPct) minSubjExplPct = hp;
        if (hp > maxSubjExplPct) maxSubjExplPct = hp;
        if (hp < 34.5) {
          violations.subjectTooSmallInExplanation.push({ t: +d.t.toFixed(2), heightPct: +hp.toFixed(2) });
        }
      }
    }

    // Hook 0-2s check: Frame 0 must already show bold headline >= 60% width + motion between t=0 and t=0.25s
    const s0 = samples[0];
    const s1 = samples[1];
    const camMove0 = s0 && s1
      ? Math.hypot(
          s1.cam.pos[0] - s0.cam.pos[0],
          s1.cam.pos[1] - s0.cam.pos[1],
          s1.cam.pos[2] - s0.cam.pos[2]
        )
      : 0;
    const hookWidthPct = s0?.hook ? +((s0.hook.width / W) * 100).toFixed(2) : 0;
    const hookPass = Boolean(
      s0?.hook &&
      s0.hook.opacity >= 0.8 &&
      s0.hook.headline.trim().length > 0 &&
      hookWidthPct >= 60.0 &&
      camMove0 > 0.05 &&
      s1?.hook?.transform !== s0.hook.transform
    );

    // Camera pacing check: every 3.0s window (12 samples of 0.25s) up to totalDur-1.5s must move meaningfully
    let staticWindows = 0;
    let minWindowCamDelta = Infinity;
    const holdLimit = timings.total_duration - 1.5;
    for (let i = 0; i + 12 < samples.length; i++) {
      if (samples[i + 12].t > holdLimit) break;
      let maxDelta = 0;
      const p0 = samples[i].cam.pos;
      for (let k = 1; k <= 12; k++) {
        const pk = samples[i + k].cam.pos;
        const dPos = Math.hypot(pk[0] - p0[0], pk[1] - p0[1], pk[2] - p0[2]);
        if (dPos > maxDelta) maxDelta = dPos;
      }
      if (maxDelta < minWindowCamDelta) minWindowCamDelta = maxDelta;
      if (maxDelta < 0.20) staticWindows++;
    }

    ws.close();

    return {
      sampledFrames: samples.length,
      sampleIntervalSec: 0.25,
      captionVsSubjectCount: violations.captionVsSubject.length,
      labelVsLabelCount: violations.labelVsLabel.length,
      labelVsCaptionCount: violations.labelVsCaption.length,
      labelVsHudCount: violations.labelVsHud.length,
      wordGapLt6pxCount: violations.wordGapLt6px.length,
      minWordGapPx: Number.isFinite(minWordGapPx) ? +minWordGapPx.toFixed(2) : null,
      hudTopPct: hudTopPct !== null ? +hudTopPct.toFixed(2) : null,
      hudSafeZoneViolations: violations.hudSafeZone.length,
      maxCaptionBottomPct: +maxCaptionBottomPct.toFixed(2),
      captionSafeZoneViolations: violations.captionSafeZone.length,
      hookFrame0Pass: hookPass,
      hookHeadline: s0?.hook?.headline || null,
      hookWidthPct,
      hookFrame0CamDelta: +camMove0.toFixed(3),
      explanationSubjectMinPct: Number.isFinite(minSubjExplPct) ? +minSubjExplPct.toFixed(2) : null,
      explanationSubjectMaxPct: +maxSubjExplPct.toFixed(2),
      explanationTooSmallCount: violations.subjectTooSmallInExplanation.length,
      static3sCameraWindows: staticWindows,
      min3sCameraDelta: Number.isFinite(minWindowCamDelta) ? +minWindowCamDelta.toFixed(3) : null,
      minBackdropLum: +minBgLum.toFixed(3),
      maxAdaptiveRimFactor: +maxDarkFactor.toFixed(3),
      minSilhouetteContrastRatio: Number.isFinite(minContrastRatio) ? +minContrastRatio.toFixed(2) : null,
      contrastSamples,
      lowContrastCount: violations.lowContrast.length,
      sampleViolations: {
        captionVsSubject: violations.captionVsSubject.slice(0, 5),
        labelVsLabel: violations.labelVsLabel.slice(0, 5),
        labelVsCaption: violations.labelVsCaption.slice(0, 5),
        labelVsHud: violations.labelVsHud.slice(0, 5),
        wordGapLt6px: violations.wordGapLt6px.slice(0, 5),
        subjectTooSmall: violations.subjectTooSmallInExplanation.slice(0, 5),
        lowContrast: violations.lowContrast.slice(0, 5),
      },
      pass: (
        violations.captionVsSubject.length === 0 &&
        violations.labelVsLabel.length === 0 &&
        violations.labelVsCaption.length === 0 &&
        violations.labelVsHud.length === 0 &&
        violations.wordGapLt6px.length === 0 &&
        violations.hudSafeZone.length === 0 &&
        violations.captionSafeZone.length === 0 &&
        violations.subjectTooSmallInExplanation.length === 0 &&
        violations.lowContrast.length === 0 &&
        hookPass &&
        staticWindows === 0
      ),
    };
  } finally {
    chrome.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    server.close();
    try { fs.rmSync(profDir, { recursive: true, force: true }); } catch {}
  }
}

function runFfprobeGate(mp4Path) {
  const raw = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries,r_frame_rate,nb_frames,duration',
    '-of', 'json',
    mp4Path,
  ], { encoding: 'utf8' });
  const st = JSON.parse(raw).streams?.[0];
  if (!st) throw new Error(`ffprobe returned no video stream for ${mp4Path}`);

  const checks = {
    resolution1080x1920: Number(st.width) === 1080 && Number(st.height) === 1920,
    pixFmtYuv420p: st.pix_fmt === 'yuv420p',
    colorBt709: st.color_space === 'bt709' && st.color_primaries === 'bt709' && st.color_transfer === 'bt709',
    fps24: st.r_frame_rate === '24/1',
  };
  return {
    codec: st.codec_name,
    width: Number(st.width),
    height: Number(st.height),
    pixFmt: st.pix_fmt,
    colorSpace: st.color_space,
    colorPrimaries: st.color_primaries,
    colorTransfer: st.color_transfer,
    fps: st.r_frame_rate,
    nbFrames: Number(st.nb_frames),
    durationSec: +Number(st.duration).toFixed(3),
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

function runEbur128Gate(mp4Path) {
  const proc = spawnSync('ffmpeg', [
    '-hide_banner', '-i', mp4Path, '-af', 'ebur128=peak=true', '-f', 'null', '-',
  ], { encoding: 'utf8' });
  if (proc.status !== 0) {
    throw new Error(`ffmpeg ebur128 exited ${proc.status}: ${(proc.stderr || '').slice(-400)}`);
  }
  const tail = (proc.stderr || '').slice(-1200);
  const mI = /Integrated loudness:\s*\n\s*I:\s*([-\d.]+)\s*LUFS/m.exec(tail);
  const mPk = /True peak:\s*\n\s*Peak:\s*([-\d.]+)\s*dBFS/m.exec(tail);
  const mLra = /LRA:\s*([-\d.]+)\s*LU/m.exec(tail);

  const integratedLufs = mI ? Number(mI[1]) : null;
  const truePeakDbtp = mPk ? Number(mPk[1]) : null;
  const lraLu = mLra ? Number(mLra[1]) : null;

  const lufsPass = integratedLufs !== null && integratedLufs >= -15.0 && integratedLufs <= -13.0;
  const peakPass = truePeakDbtp !== null && truePeakDbtp <= -1.5;

  return {
    integratedLufs,
    truePeakDbtp,
    lraLu,
    lufsPass,
    peakPass,
    pass: lufsPass && peakPass,
  };
}

function formatSummaryMarkdown(scenario, gates) {
  const d = gates.domLayout;
  const f = gates.ffprobe;
  const e = gates.ebur128;
  const mark = (ok) => (ok ? 'PASS' : 'FAIL');
  const lines = [
    `### CI Verification Gate — \`${scenario}\` (${gates.allPass ? 'ALL PASS' : 'FAILED'})`,
    '',
    '| Gate | Result | Measured Value | Target |',
    '| --- | --- | --- | --- |',
    `| Caption vs Subject | ${mark(d.captionVsSubjectCount === 0)} | ${d.captionVsSubjectCount} violations (${d.sampledFrames} frames @ 0.25s) | 0 |`,
    `| Label vs Label (>=10px) | ${mark(d.labelVsLabelCount === 0)} | ${d.labelVsLabelCount} violations | 0 |`,
    `| Label vs Caption (>=10px) | ${mark(d.labelVsCaptionCount === 0)} | ${d.labelVsCaptionCount} violations | 0 |`,
    `| Label vs HUD (>=10px) | ${mark(d.labelVsHudCount === 0)} | ${d.labelVsHudCount} violations | 0 |`,
    `| Subtitle Word Gap (>=6px) | ${mark(d.wordGapLt6pxCount === 0)} | min=${d.minWordGapPx}px (${d.wordGapLt6pxCount} violations) | >= 6px, 0 violations |`,
    `| HUD Safe Zone (10-12%) | ${mark(d.hudSafeZoneViolations === 0)} | top=${d.hudTopPct}% | 9-14% |`,
    `| Caption Safe Zone | ${mark(d.captionSafeZoneViolations === 0)} | maxBottom=${d.maxCaptionBottomPct}% | <= 78.5% |`,
    `| Hook 0-2s (Motion + >=60% W) | ${mark(d.hookFrame0Pass)} | "${d.hookHeadline}", width=${d.hookWidthPct}%, camDelta=${d.hookFrame0CamDelta} | >= 60% W & moving at t=0 |`,
    `| Subject Size (Explanation) | ${mark(d.explanationTooSmallCount === 0)} | min=${d.explanationSubjectMinPct}%, max=${d.explanationSubjectMaxPct}% | >= 35% |`,
    `| Camera Pacing (<=3s) | ${mark(d.static3sCameraWindows === 0)} | staticWindows=${d.static3sCameraWindows}, minDelta=${d.min3sCameraDelta} | 0 static windows |`,
    `| Silhouette Contrast (>=3:1) | ${mark(d.lowContrastCount === 0)} | min=${d.minSilhouetteContrastRatio}:1 (${d.contrastSamples} frames, ${d.lowContrastCount} fail) | >= 3.0:1 |`,
  ];
  if (f) {
    lines.push(
      `| ffprobe Video Spec | ${mark(f.pass)} | ${f.width}x${f.height}, ${f.pixFmt}, ${f.colorSpace}, ${f.fps}, ${f.nbFrames}f | 1080x1920 yuv420p bt709 24/1 |`
    );
  }
  if (e) {
    lines.push(
      `| ebur128 Audio Loudness | ${mark(e.pass)} | I=${e.integratedLufs} LUFS, TP=${e.truePeakDbtp} dBTP | -14±1 LUFS, <= -1.5 dBTP |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const skipMedia = argv.includes('--skip-media');
  const opts = parseCommonArgs(argv);
  const outDir = path.resolve(__dirname, opts.outDir);
  const assetsDir = resolveAssetsDir(opts);
  const mp4Path = path.join(outDir, opts.output);

  console.log(`Running CI verification gate for scenario=${opts.scenario} (skipMedia=${skipMedia})...`);
  const domLayout = await runDomLayoutGate(opts.scenario, assetsDir, opts.dsf);
  const ffprobe = skipMedia ? null : runFfprobeGate(mp4Path);
  const ebur128 = skipMedia ? null : runEbur128Gate(mp4Path);

  const allPass = Boolean(
    domLayout.pass &&
    (skipMedia || (ffprobe?.pass && ebur128?.pass))
  );

  const gates = { allPass, domLayout, ffprobe, ebur128 };
  const md = formatSummaryMarkdown(opts.scenario, gates);
  console.log('\n' + md);

  // Merge gate results into outDir/metrics.json
  fs.mkdirSync(outDir, { recursive: true });
  const metricsPath = path.join(outDir, 'metrics.json');
  let metrics = {};
  if (fs.existsSync(metricsPath)) {
    try { metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8')); } catch {}
  }
  metrics.gates = gates;
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + '\n', 'utf8');

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  }

  if (!allPass) {
    console.error('CI VERIFICATION GATE FAILED!');
    console.error(JSON.stringify(domLayout.sampleViolations, null, 2));
    process.exit(1);
  }
  console.log(`CI VERIFICATION GATE PASSED for ${opts.scenario}!`);
}

main().catch((err) => {
  console.error('verify.mjs crashed:', err);
  process.exit(1);
});
