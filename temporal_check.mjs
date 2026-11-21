import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs } from './mux.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GW = 270;
const GH = 480;
const FPS = 24;

// --- Fast In-Place Radix-2 1D/2D FFT for Phase Correlation ---
function makeTwiddles(n) {
  const cos = new Float32Array(n >> 1);
  const sin = new Float32Array(n >> 1);
  for (let i = 0; i < (n >> 1); i++) {
    const ang = (-2 * Math.PI * i) / n;
    cos[i] = Math.cos(ang);
    sin[i] = Math.sin(ang);
  }
  const rev = new Uint32Array(n);
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    let x = i, y = 0;
    for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
    rev[i] = y;
  }
  return { n, cos, sin, rev };
}

function fft1d(re, im, tw, inverse = false) {
  const { n, cos, sin, rev } = tw;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? -1 : 1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const wr = cos[k];
        const wi = sign * sin[k];
        const u = i + j;
        const v = u + half;
        const tr = wr * re[v] - wi * im[v];
        const ti = wr * im[v] + wi * re[v];
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
      }
    }
  }
  if (inverse) {
    const invN = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= invN; im[i] *= invN; }
  }
}

// 2D FFT on PW x PH (256 x 256 center crop of 270x480 at 1:1 @270p pixel scale -> exact 1px accuracy, ~10x faster)
const PW = 256;
const PH = 256;
const TW_W = makeTwiddles(PW);
const TW_H = makeTwiddles(PH);
const HANN_X = new Float32Array(PW);
const HANN_Y = new Float32Array(PH);
for (let i = 0; i < PW; i++) HANN_X[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (PW - 1)));
for (let i = 0; i < PH; i++) HANN_Y[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (PH - 1)));

function fft2d(re, im, inverse = false) {
  const rowRe = new Float32Array(PW);
  const rowIm = new Float32Array(PW);
  for (let y = 0; y < PH; y++) {
    const off = y * PW;
    for (let x = 0; x < PW; x++) { rowRe[x] = re[off + x]; rowIm[x] = im[off + x]; }
    fft1d(rowRe, rowIm, TW_W, inverse);
    for (let x = 0; x < PW; x++) { re[off + x] = rowRe[x]; im[off + x] = rowIm[x]; }
  }
  const colRe = new Float32Array(PH);
  const colIm = new Float32Array(PH);
  for (let x = 0; x < PW; x++) {
    for (let y = 0; y < PH; y++) { colRe[y] = re[y * PW + x]; colIm[y] = im[y * PW + x]; }
    fft1d(colRe, colIm, TW_H, inverse);
    for (let y = 0; y < PH; y++) { re[y * PW + x] = colRe[y]; im[y * PW + x] = colIm[y]; }
  }
}

function extractFrameFft(rawBuf, frameIdx, reOut, imOut) {
  const frameSize = GW * GH;
  const base = frameIdx * frameSize;
  const x0 = Math.floor((GW - PW) / 2); // 7
  const y0 = 64; // covers y=64..320 @270x480 (13.3%..66.7% height = main 3D subject + labels)
  // Compute mean to remove DC component
  let mean = 0;
  for (let y = 0; y < PH; y++) {
    const rowOff = base + (y0 + y) * GW + x0;
    for (let x = 0; x < PW; x++) mean += rawBuf[rowOff + x];
  }
  mean /= (PW * PH);
  for (let y = 0; y < PH; y++) {
    const rowOff = base + (y0 + y) * GW + x0;
    const wy = HANN_Y[y];
    const dstOff = y * PW;
    for (let x = 0; x < PW; x++) {
      reOut[dstOff + x] = (rawBuf[rowOff + x] - mean) * HANN_X[x] * wy;
      imOut[dstOff + x] = 0;
    }
  }
  fft2d(reOut, imOut, false);
}

function phaseCorrShift(reA, imA, reB, imB, cRe, cIm) {
  const N = PW * PH;
  for (let i = 0; i < N; i++) {
    // Cross-power spectrum: (A * conj(B)) / |A * conj(B)|
    const ar = reA[i], ai = imA[i];
    const br = reB[i], bi = imB[i];
    const cr = ar * br + ai * bi;
    const ci = ai * br - ar * bi;
    const mag = Math.hypot(cr, ci) + 1e-6;
    cRe[i] = cr / mag;
    cIm[i] = ci / mag;
  }
  fft2d(cRe, cIm, true);
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < N; i++) {
    if (cRe[i] > bestVal) { bestVal = cRe[i]; bestIdx = i; }
  }
  let px = bestIdx % PW;
  let py = Math.floor(bestIdx / PW);
  // Parabolic subpixel refinement around peak
  const at = (x, y) => cRe[((y + PH) % PH) * PW + ((x + PW) % PW)];
  const vxL = at(px - 1, py), vxC = bestVal, vxR = at(px + 1, py);
  const vyU = at(px, py - 1), vyC = bestVal, vyD = at(px, py + 1);
  const denomX = 2 * (vxL - 2 * vxC + vxR);
  const denomY = 2 * (vyU - 2 * vyC + vyD);
  const subX = Math.abs(denomX) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (vxL - vxR) / denomX)) : 0;
  const subY = Math.abs(denomY) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (vyU - vyD) / denomY)) : 0;
  let dx = px + subX;
  let dy = py + subY;
  if (dx > PW / 2) dx -= PW;
  if (dy > PH / 2) dy -= PH;
  return { dx, dy, peak: bestVal };
}

function frameMad(buf, fA, fB) {
  const frameSize = GW * GH;
  const offA = fA * frameSize;
  const offB = fB * frameSize;
  let sum = 0;
  for (let i = 0; i < frameSize; i++) {
    const d = buf[offA + i] - buf[offB + i];
    sum += d < 0 ? -d : d;
  }
  return sum / frameSize;
}

export function analyzeTemporalStability(mp4Path, opts = {}) {
  const fps = opts.fps || FPS;
  const proc = spawnSync('ffmpeg', [
    '-v', 'error',
    '-i', mp4Path,
    '-vf', `scale=${GW}:${GH}:flags=area,format=gray`,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    'pipe:1',
  ], { maxBuffer: 512 * 1024 * 1024 });

  if (proc.status !== 0) {
    throw new Error(`ffmpeg downscale failed for ${mp4Path}: ${proc.stderr?.toString()}`);
  }
  const raw = proc.stdout;
  const frameSize = GW * GH;
  const numFrames = Math.floor(raw.length / frameSize);
  if (numFrames < 4) {
    throw new Error(`Too few frames (${numFrames}) in ${mp4Path}`);
  }

  // 1. Triplet reversal ratio: ratio = diff(n,n+2) / (diff(n,n+1) + diff(n+1,n+2)) when sum > 0.8
  const secTotal = {};
  const secActive = {};
  const secJitter = {};
  let allTriplets = 0;
  let activeTriplets = 0;
  let jitterTriplets = 0;

  for (let n = 0; n < numFrames - 2; n++) {
    const sec = Math.floor((n + 1) / fps);
    secTotal[sec] = (secTotal[sec] || 0) + 1;
    allTriplets++;
    const d01 = frameMad(raw, n, n + 1);
    const d12 = frameMad(raw, n + 1, n + 2);
    const sum = d01 + d12;
    if (sum > 0.8) {
      secActive[sec] = (secActive[sec] || 0) + 1;
      activeTriplets++;
      const d02 = frameMad(raw, n, n + 2);
      const ratio = d02 / sum;
      if (ratio < 0.6) {
        secJitter[sec] = (secJitter[sec] || 0) + 1;
        jitterTriplets++;
      }
    }
  }

  const perSecond = [];
  let maxSecFrac = 0;
  let maxSecIdx = 0;
  const badSeconds = [];
  const secs = Object.keys(secTotal).map(Number).sort((a, b) => a - b);
  for (const s of secs) {
    const tot = secTotal[s] || 1;
    const act = secActive[s] || 0;
    const jit = secJitter[s] || 0;
    // Fraction of triplets in this second with ratio < 0.6 (over all triplets in second, matching baseline)
    const frac = jit / tot;
    const fracActive = act > 0 ? jit / act : 0;
    if (frac > maxSecFrac) { maxSecFrac = frac; maxSecIdx = s; }
    if (frac > 0.15) badSeconds.push({ sec: s, frac: +frac.toFixed(4), jit, tot, act });
    perSecond.push({ sec: s, frac: +frac.toFixed(4), fracActive: +fracActive.toFixed(4), jit, act, tot });
  }
  const meanFrac = allTriplets > 0 ? jitterTriplets / allTriplets : 0;

  // 2. Global shift tracking via 2D Phase Correlation
  const N = PW * PH;
  let prevRe = new Float32Array(N);
  let prevIm = new Float32Array(N);
  let currRe = new Float32Array(N);
  let currIm = new Float32Array(N);
  const cRe = new Float32Array(N);
  const cIm = new Float32Array(N);

  extractFrameFft(raw, 0, prevRe, prevIm);
  const shifts = [];
  let oscRunX = 0, maxOscRunX = 0, oscStartX = 0, worstOscX = null;
  let oscRunY = 0, maxOscRunY = 0, oscStartY = 0, worstOscY = null;
  let prevDx = 0, prevDy = 0;

  for (let f = 1; f < numFrames; f++) {
    extractFrameFft(raw, f, currRe, currIm);
    const { dx, dy, peak } = phaseCorrShift(prevRe, prevIm, currRe, currIm, cRe, cIm);
    shifts.push({ f, dx: +dx.toFixed(2), dy: +dy.toFixed(2) });

    // Check consecutive sign-flipping oscillation with amplitude >= 1px @270p
    if (Math.abs(dx) >= 1.0 && Math.abs(prevDx) >= 1.0 && (dx * prevDx < 0)) {
      if (oscRunX === 0) oscStartX = f - 1;
      oscRunX = oscRunX === 0 ? 2 : oscRunX + 1;
      if (oscRunX > maxOscRunX) {
        maxOscRunX = oscRunX;
        worstOscX = { startFrame: oscStartX, endFrame: f, length: oscRunX, sec: +(oscStartX / fps).toFixed(2) };
      }
    } else {
      oscRunX = 0;
    }

    if (Math.abs(dy) >= 1.0 && Math.abs(prevDy) >= 1.0 && (dy * prevDy < 0)) {
      if (oscRunY === 0) oscStartY = f - 1;
      oscRunY = oscRunY === 0 ? 2 : oscRunY + 1;
      if (oscRunY > maxOscRunY) {
        maxOscRunY = oscRunY;
        worstOscY = { startFrame: oscStartY, endFrame: f, length: oscRunY, sec: +(oscStartY / fps).toFixed(2) };
      }
    } else {
      oscRunY = 0;
    }

    prevDx = dx;
    prevDy = dy;
    const tmpR = prevRe; prevRe = currRe; currRe = tmpR;
    const tmpI = prevIm; prevIm = currIm; currIm = tmpI;
  }

  const maxOscRun = Math.max(maxOscRunX, maxOscRunY);
  const tripletMeanPass = meanFrac <= 0.03;
  const tripletMaxSecPass = maxSecFrac <= 0.15;
  const phaseOscPass = maxOscRun < 6;
  const pass = tripletMeanPass && tripletMaxSecPass && phaseOscPass;

  return {
    mp4Path: path.relative(__dirname, mp4Path),
    numFrames,
    meanJitterFrac: +meanFrac.toFixed(4),
    maxSecJitterFrac: +maxSecFrac.toFixed(4),
    maxSecIdx,
    activeTriplets,
    jitterTriplets,
    badSeconds,
    maxOscRunX,
    maxOscRunY,
    maxOscRun,
    worstOscX,
    worstOscY,
    checks: {
      meanFracLe003: tripletMeanPass,
      maxSecFracLe015: tripletMaxSecPass,
      phaseOscLt6: phaseOscPass,
    },
    pass,
    perSecond,
  };
}

function formatSummaryMarkdown(scenario, res) {
  const m = (ok) => (ok ? 'PASS' : 'FAIL');
  const lines = [
    `### Temporal Stability Gate — \`${scenario}\` (${res.pass ? 'PASS' : 'FAIL'})`,
    '',
    '| Metric | Result | Measured | Threshold |',
    '| --- | --- | --- | --- |',
    `| Mean Triplet Reversal (ratio < 0.6) | ${m(res.checks.meanFracLe003)} | ${res.meanJitterFrac.toFixed(4)} (${res.jitterTriplets}/${res.numFrames - 2}) | <= 0.0300 |`,
    `| Max Per-Second Reversal Frac | ${m(res.checks.maxSecFracLe015)} | ${res.maxSecJitterFrac.toFixed(4)} (at s=${res.maxSecIdx}) | <= 0.1500 |`,
    `| Phase-Corr Sign-Flip Run (>=1px @270p) | ${m(res.checks.phaseOscLt6)} | maxRun=${res.maxOscRun} (dx=${res.maxOscRunX}, dy=${res.maxOscRunY}) | < 6 consecutive frames |`,
    '',
  ];
  if (res.badSeconds.length > 0) {
    lines.push(`Bad seconds (>0.15): ${res.badSeconds.map((b) => `s${b.sec}=${b.frac}`).join(', ')}`, '');
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  let mp4Override = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mp4' && argv[i + 1]) mp4Override = argv[++i];
  }
  const opts = parseCommonArgs(argv);
  const outDir = path.resolve(__dirname, opts.outDir);
  const mp4Path = mp4Override ? path.resolve(__dirname, mp4Override) : path.join(outDir, opts.output);
  const noExit = argv.includes('--no-exit');

  const res = analyzeTemporalStability(mp4Path);
  const md = formatSummaryMarkdown(opts.scenario, res);
  console.log('\n' + md);

  if (!mp4Override) {
    fs.mkdirSync(outDir, { recursive: true });
    const metricsPath = path.join(outDir, 'metrics.json');
    let metrics = {};
    if (fs.existsSync(metricsPath)) {
      try { metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8')); } catch {}
    }
    const { perSecond, ...summaryObj } = res;
    metrics.temporalStability = summaryObj;
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  }

  if (!res.pass && !noExit) {
    console.error('TEMPORAL STABILITY GATE FAILED!');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('temporal_check.mjs failed:', err);
    process.exit(1);
  });
}
