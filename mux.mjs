import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseCommonArgs(argv) {
  const opts = {
    scenario: process.env.SCENARIO || 'a10',
    outDir: process.env.OUT_DIR || 'out',
    assetsDir: process.env.ASSETS_DIR || '',
    output: process.env.OUTPUT_MP4 || '',
    shards: Number(process.env.SHARDS || 3),
    dsf: Number(process.env.DSF || 1.5),
    shardSpec: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario' && argv[i + 1]) opts.scenario = argv[++i];
    else if (a === '--out-dir' && argv[i + 1]) opts.outDir = argv[++i];
    else if (a === '--assets-dir' && argv[i + 1]) opts.assetsDir = argv[++i];
    else if (a === '--output' && argv[i + 1]) opts.output = argv[++i];
    else if (a === '--shards' && argv[i + 1]) opts.shards = Number(argv[++i]);
    else if (a === '--dsf' && argv[i + 1]) opts.dsf = Number(argv[++i]);
    else if (a === '--shard' && argv[i + 1]) opts.shardSpec = argv[++i];
  }
  if (!opts.output) {
    opts.output = `demo_${opts.scenario}.mp4`;
  }
  return opts;
}

export function resolveAssetsDir(opts) {
  if (opts.assetsDir) {
    return path.resolve(__dirname, opts.assetsDir);
  }
  const scenarioAssets = path.join(__dirname, 'assets', opts.scenario);
  if (fs.existsSync(path.join(scenarioAssets, 'vo_timings.json'))) {
    return scenarioAssets;
  }
  return path.resolve(__dirname, opts.outDir);
}

export function findAudioFile(assetsDir, outDir, scenario) {
  const candidates = [
    path.join(assetsDir, 'final_audio.flac'),
    path.join(assetsDir, 'final_audio.wav'),
    path.join(__dirname, 'assets', scenario, 'final_audio.flac'),
    path.join(__dirname, 'assets', scenario, 'final_audio.wav'),
    path.join(outDir, 'final_audio.flac'),
    path.join(outDir, 'final_audio.wav'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function probeSegment(segPath) {
  try {
    const out = execFileSync(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=nb_frames,width,height,codec_name,pix_fmt',
        '-of', 'json',
        segPath,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(out);
    const st = parsed.streams?.[0];
    if (!st) return null;
    let frames = Number(st.nb_frames);
    if (!Number.isFinite(frames) || frames <= 0) {
      const cntOut = execFileSync(
        'ffprobe',
        [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-count_frames',
          '-show_entries', 'stream=nb_read_frames',
          '-of', 'default=nw=1:nk=1',
          segPath,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      frames = Number(cntOut.trim());
    }
    return {
      frames,
      width: Number(st.width),
      height: Number(st.height),
      codec: st.codec_name,
      pixFmt: st.pix_fmt,
    };
  } catch {
    return null;
  }
}

export async function muxSegments(opts) {
  const muxStartMs = Date.now();
  const outDir = path.resolve(__dirname, opts.outDir);
  const assetsDir = resolveAssetsDir(opts);
  const shardsDir = path.join(outDir, 'shards');

  if (!fs.existsSync(shardsDir)) {
    throw new Error(`Shards directory not found: ${shardsDir}`);
  }

  // Discover segments seg_1.mp4 .. seg_N.mp4 in numeric order
  const segFiles = fs
    .readdirSync(shardsDir)
    .map((f) => {
      const m = /^seg_(\d+)\.mp4$/.exec(f);
      return m ? { idx: Number(m[1]), file: f, full: path.join(shardsDir, f) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx);

  if (segFiles.length === 0) {
    throw new Error(`No seg_*.mp4 files found in ${shardsDir}`);
  }

  // If SHARDS env/arg is explicit and matches expected count, verify contiguous 1..N
  const expectedN = opts.shards || segFiles.length;
  const selectedSegs = [];
  for (let i = 1; i <= expectedN; i++) {
    const found = segFiles.find((s) => s.idx === i);
    if (!found) {
      throw new Error(`Missing shard segment seg_${i}.mp4 in ${shardsDir} (expected ${expectedN} shards)`);
    }
    const info = probeSegment(found.full);
    if (!info || info.frames <= 0) {
      throw new Error(`Invalid or corrupt shard segment: ${found.full}`);
    }
    selectedSegs.push({ ...found, info });
  }

  const concatPath = path.join(shardsDir, 'concat.txt');
  const concatBody = selectedSegs
    .map((s) => `file '${s.full.replace(/'/g, "'\\''")}'`)
    .join('\n') + '\n';
  fs.writeFileSync(concatPath, concatBody, 'utf8');

  const audioFile = findAudioFile(assetsDir, outDir, opts.scenario);
  const outMp4 = path.join(outDir, opts.output);

  const ffArgs = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
  ];
  if (audioFile) {
    ffArgs.push(
      '-i', audioFile,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ac', '2',
      '-ar', '44100'
    );
  } else {
    ffArgs.push('-c:v', 'copy', '-an');
  }
  ffArgs.push('-movflags', '+faststart', outMp4);

  const ff = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d.toString(); });
  await new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg mux exited ${code}: ${ffErr.slice(-800)}`))));
  });

  // Aggregate per-shard metrics_*.json -> outDir/metrics.json
  const shardMetrics = [];
  for (let i = 1; i <= expectedN; i++) {
    const mp = path.join(shardsDir, `metrics_${i}.json`);
    if (fs.existsSync(mp)) {
      try {
        shardMetrics.push(JSON.parse(fs.readFileSync(mp, 'utf8')));
      } catch {}
    }
  }
  const totalFrames = selectedSegs.reduce((acc, s) => acc + s.info.frames, 0);
  const sumShardMs = shardMetrics.reduce((acc, m) => acc + (m.totalMs || 0), 0);
  const maxShardMs = shardMetrics.reduce((acc, m) => Math.max(acc, m.totalMs || 0), 0);
  const muxMs = Date.now() - muxStartMs;

  const setupDurations = shardMetrics.map((m) => m.setupDurationSec).filter((v) => typeof v === 'number');
  const muxSetupPath = path.join(outDir, 'setup_info.json');
  let muxSetupInfo = null;
  if (fs.existsSync(muxSetupPath)) {
    try { muxSetupInfo = JSON.parse(fs.readFileSync(muxSetupPath, 'utf8')); } catch {}
  }

  const aggregated = {
    scenario: opts.scenario,
    shards: expectedN,
    totalFrames,
    gop: shardMetrics[0]?.gop || 24,
    audioSource: audioFile ? path.relative(__dirname, audioFile) : null,
    outputMp4: path.relative(__dirname, outMp4),
    nodeVersion: process.version,
    chromeBin: shardMetrics[0]?.chromeBin || null,
    chromeSource: shardMetrics[0]?.chromeSource || null,
    chromeVersion: shardMetrics[0]?.chromeVersion || null,
    playwrightPinnedVersion: shardMetrics[0]?.playwrightPinnedVersion || '1.65.1',
    ffmpegVersion: shardMetrics[0]?.ffmpegVersion || null,
    sumShardTimeSec: +(sumShardMs / 1000).toFixed(2),
    maxShardTimeSec: +(maxShardMs / 1000).toFixed(2),
    muxTimeSec: +(muxMs / 1000).toFixed(2),
    avgRenderLoopMsPerFrame: shardMetrics.length
      ? +(shardMetrics.reduce((acc, m) => acc + (m.renderLoopMs || 0), 0) / Math.max(1, totalFrames)).toFixed(2)
      : null,
    avgMsPerFramePerShard: shardMetrics.length
      ? +(sumShardMs / Math.max(1, totalFrames)).toFixed(2)
      : null,
    avgShardSetupSec: setupDurations.length
      ? +(setupDurations.reduce((a, b) => a + b, 0) / setupDurations.length).toFixed(2)
      : null,
    muxSetupSec: muxSetupInfo?.setupDurationSec ?? null,
    perShard: shardMetrics,
  };
  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(aggregated, null, 2) + '\n', 'utf8');

  console.log(`Muxed ${selectedSegs.length} shards (${totalFrames} frames) + ${audioFile ? path.basename(audioFile) : 'no-audio'} -> ${outMp4} (${(muxMs / 1000).toFixed(2)}s)`);
  return { outMp4, aggregated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseCommonArgs(process.argv.slice(2));
  muxSegments(opts).catch((err) => {
    console.error('Mux failed:', err.message);
    process.exit(1);
  });
}
