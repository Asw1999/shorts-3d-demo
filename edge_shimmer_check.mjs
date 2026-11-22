import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs } from './mux.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SW = 540;
const SH = 960;
const FPS = 24;
const GRAD_THRESH = 38; // Sobel-like |dx|+|dy| threshold on 0..255 grayscale @ 540x960

/**
 * Edge Shimmer CI Test (Fase 1):
 * Downscales MP4 to 540x960 grayscale. For each consecutive frame pair during slow
 * camera motion (excluding hard cuts where global MAD > 6.5), measures the fraction of
 * edge pixels (gradient > threshold) that appear/disappear (XOR / union) AND 3-frame
 * edge blink flicker (E[n]==E[n+2] && E[n]!=E[n+1]).
 */
export function analyzeEdgeShimmer(mp4Path, opts = {}) {
  const fps = opts.fps || FPS;
  const maxMeanChurn = opts.maxMeanChurn ?? null; // baseline threshold (e.g. v1.2)
  const maxMeanFlicker = opts.maxMeanFlicker ?? null;

  const proc = spawnSync('ffmpeg', [
    '-v', 'error',
    '-i', mp4Path,
    '-vf', `scale=${SW}:${SH}:flags=area,format=gray`,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    'pipe:1',
  ], { maxBuffer: 768 * 1024 * 1024 });

  if (proc.status !== 0) {
    throw new Error(`ffmpeg downscale 540x960 failed for ${mp4Path}: ${proc.stderr?.toString()}`);
  }

  const raw = proc.stdout;
  const frameSize = SW * SH;
  const numFrames = Math.floor(raw.length / frameSize);
  if (numFrames < 4) throw new Error(`Too few frames (${numFrames}) in ${mp4Path}`);

  // Focus on 3D scene region (y = 14%..63% of 960 = y 134..605) to measure 3D outline shimmer cleanly
  // while still supporting full-frame measurement too
  const yStart = 134;
  const yEnd = 605;
  const xStart = 8;
  const xEnd = SW - 8;
  const roiW = xEnd - xStart;
  const roiH = yEnd - yStart;
  const roiSize = roiW * roiH;

  function computeEdgeMask(frameIdx, outMask) {
    const base = frameIdx * frameSize;
    let edgeCount = 0;
    for (let y = yStart; y < yEnd; y++) {
      const row = base + y * SW;
      const outRow = (y - yStart) * roiW;
      for (let x = xStart; x < xEnd; x++) {
        const dx = raw[row + x + 1] - raw[row + x - 1];
        const dy = raw[row + SW + x] - raw[row - SW + x];
        const g = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
        if (g > GRAD_THRESH) {
          outMask[outRow + (x - xStart)] = 1;
          edgeCount++;
        } else {
          outMask[outRow + (x - xStart)] = 0;
        }
      }
    }
    return edgeCount;
  }

  function frameRoiMad(fA, fB) {
    const baseA = fA * frameSize;
    const baseB = fB * frameSize;
    let sum = 0;
    for (let y = yStart; y < yEnd; y += 2) {
      const rA = baseA + y * SW;
      const rB = baseB + y * SW;
      for (let x = xStart; x < xEnd; x += 2) {
        const d = raw[rA + x] - raw[rB + x];
        sum += d < 0 ? -d : d;
      }
    }
    return sum / ((roiH / 2) * (roiW / 2));
  }

  let mPrev2 = new Uint8Array(roiSize);
  let mPrev1 = new Uint8Array(roiSize);
  let mCurr = new Uint8Array(roiSize);

  computeEdgeMask(0, mPrev2);
  computeEdgeMask(1, mPrev1);

  const secChurnSum = {};
  const secChurnCnt = {};
  const secFlickSum = {};
  const secFlickCnt = {};

  let totalChurnSum = 0;
  let totalChurnCnt = 0;
  let totalFlickSum = 0;
  let totalFlickCnt = 0;

  // First pair (0,1)
  const mad01 = frameRoiMad(0, 1);
  if (mad01 > 0.05 && mad01 < 6.5) {
    let xorCnt = 0, unionCnt = 0;
    for (let i = 0; i < roiSize; i++) {
      const a = mPrev2[i], b = mPrev1[i];
      if (a | b) {
        unionCnt++;
        if (a ^ b) xorCnt++;
      }
    }
    if (unionCnt > 100) {
      const ch = xorCnt / unionCnt;
      secChurnSum[0] = (secChurnSum[0] || 0) + ch;
      secChurnCnt[0] = (secChurnCnt[0] || 0) + 1;
      totalChurnSum += ch;
      totalChurnCnt++;
    }
  }

  for (let f = 2; f < numFrames; f++) {
    computeEdgeMask(f, mCurr);
    const sec = Math.floor((f - 1) / fps);
    const mad12 = frameRoiMad(f - 1, f);
    const mad01 = frameRoiMad(f - 2, f - 1);

    // Slow camera motion filter: non-static (>0.05) and not a hard cut (<6.5 MAD)
    if (mad12 > 0.05 && mad12 < 6.5) {
      let xorCnt = 0, unionCnt = 0;
      for (let i = 0; i < roiSize; i++) {
        const a = mPrev1[i], b = mCurr[i];
        if (a | b) {
          unionCnt++;
          if (a ^ b) xorCnt++;
        }
      }
      if (unionCnt > 100) {
        const ch = xorCnt / unionCnt;
        secChurnSum[sec] = (secChurnSum[sec] || 0) + ch;
        secChurnCnt[sec] = (secChurnCnt[sec] || 0) + 1;
        totalChurnSum += ch;
        totalChurnCnt++;
      }
    }

    // 3-frame edge shimmer/blink (appears & disappears on adjacent frames during slow motion)
    if (mad01 > 0.05 && mad01 < 6.5 && mad12 > 0.05 && mad12 < 6.5) {
      let blinkCnt = 0, union3 = 0;
      for (let i = 0; i < roiSize; i++) {
        const a = mPrev2[i], b = mPrev1[i], c = mCurr[i];
        if (a | b | c) {
          union3++;
          if (a === c && a !== b) blinkCnt++;
        }
      }
      if (union3 > 100) {
        const fl = blinkCnt / union3;
        secFlickSum[sec] = (secFlickSum[sec] || 0) + fl;
        secFlickCnt[sec] = (secFlickCnt[sec] || 0) + 1;
        totalFlickSum += fl;
        totalFlickCnt++;
      }
    }

    // Rotate buffers
    const tmp = mPrev2;
    mPrev2 = mPrev1;
    mPrev1 = mCurr;
    mCurr = tmp;
  }

  const meanChurn = totalChurnCnt > 0 ? totalChurnSum / totalChurnCnt : 0;
  const meanFlicker = totalFlickCnt > 0 ? totalFlickSum / totalFlickCnt : 0;

  let maxSecChurn = 0, maxSecChurnIdx = 0;
  let maxSecFlicker = 0, maxSecFlickerIdx = 0;
  const secs = Object.keys(secChurnCnt).map(Number).sort((a, b) => a - b);
  for (const s of secs) {
    const c = secChurnSum[s] / secChurnCnt[s];
    if (c > maxSecChurn) { maxSecChurn = c; maxSecChurnIdx = s; }
    if (secFlickCnt[s]) {
      const fl = secFlickSum[s] / secFlickCnt[s];
      if (fl > maxSecFlicker) { maxSecFlicker = fl; maxSecFlickerIdx = s; }
    }
  }

  const churnPass = maxMeanChurn === null ? true : meanChurn <= maxMeanChurn;
  const flickerPass = maxMeanFlicker === null ? true : meanFlicker <= maxMeanFlicker;

  return {
    mp4Path: path.relative(__dirname, mp4Path),
    numFrames,
    slowPairsChecked: totalChurnCnt,
    meanEdgeChurn: +meanChurn.toFixed(4),
    maxSecEdgeChurn: +maxSecChurn.toFixed(4),
    maxSecChurnIdx,
    meanEdgeFlicker: +meanFlicker.toFixed(4),
    maxSecEdgeFlicker: +maxSecFlicker.toFixed(4),
    maxSecFlickerIdx,
    thresholds: { maxMeanChurn, maxMeanFlicker },
    checks: { churnPass, flickerPass },
    pass: churnPass && flickerPass,
  };
}

function formatSummaryMarkdown(scenario, res) {
  const m = (ok) => (ok ? 'PASS' : 'FAIL');
  const lines = [
    `### Edge Shimmer Gate (540x960) — \`${scenario}\` (${res.pass ? 'PASS' : 'FAIL'})`,
    '',
    '| Metric | Result | Measured | Baseline Ceiling (v1.2) |',
    '| --- | --- | --- | --- |',
    `| Mean Edge Appear/Disappear (churn) | ${m(res.checks.churnPass)} | ${res.meanEdgeChurn.toFixed(4)} (maxSec=${res.maxSecEdgeChurn.toFixed(4)} @ s${res.maxSecChurnIdx}) | ${res.thresholds.maxMeanChurn !== null ? `<= ${res.thresholds.maxMeanChurn.toFixed(4)}` : 'INFO'} |`,
    `| Mean 3-Frame Edge Flicker (blink) | ${m(res.checks.flickerPass)} | ${res.meanEdgeFlicker.toFixed(4)} (maxSec=${res.maxSecEdgeFlicker.toFixed(4)} @ s${res.maxSecFlickerIdx}) | ${res.thresholds.maxMeanFlicker !== null ? `<= ${res.thresholds.maxMeanFlicker.toFixed(4)}` : 'INFO'} |`,
    '',
  ];
  return lines.join('\n');
}

// Exact measured v1.2 baselines per scenario (v1.5 fails if worse than v1.2)
const V12_BASELINES = {
  submarine: { maxMeanChurn: 0.3778, maxMeanFlicker: 0.0841 },
  a10: { maxMeanChurn: 0.3547, maxMeanFlicker: 0.0935 },
};

async function main() {
  const argv = process.argv.slice(2);
  let mp4Override = '';
  let maxChurnArg = null;
  let maxFlickArg = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mp4' && argv[i + 1]) mp4Override = argv[++i];
    else if (argv[i] === '--max-churn' && argv[i + 1]) maxChurnArg = Number(argv[++i]);
    else if (argv[i] === '--max-flicker' && argv[i + 1]) maxFlickArg = Number(argv[++i]);
  }
  const opts = parseCommonArgs(argv);
  const outDir = path.resolve(__dirname, opts.outDir);
  const mp4Path = mp4Override ? path.resolve(__dirname, mp4Override) : path.join(outDir, opts.output);
  const noExit = argv.includes('--no-exit');

  const base = V12_BASELINES[opts.scenario] || { maxMeanChurn: null, maxMeanFlicker: null };
  const res = analyzeEdgeShimmer(mp4Path, {
    maxMeanChurn: maxChurnArg ?? base.maxMeanChurn,
    maxMeanFlicker: maxFlickArg ?? base.maxMeanFlicker,
  });

  const md = formatSummaryMarkdown(opts.scenario, res);
  console.log('\n' + md);

  if (!mp4Override) {
    fs.mkdirSync(outDir, { recursive: true });
    const metricsPath = path.join(outDir, 'metrics.json');
    let metrics = {};
    if (fs.existsSync(metricsPath)) {
      try { metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8')); } catch {}
    }
    metrics.edgeShimmer = res;
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  }

  if (!res.pass && !noExit) {
    console.error('EDGE SHIMMER GATE FAILED!');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('edge_shimmer_check.mjs failed:', err);
    process.exit(1);
  });
}
