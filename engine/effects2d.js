/**
 * Generic 2D Canvas atmospheric overlays (light shafts & seeded drifting/rising particles)
 * usable via renderSoftware3D before3D/after3D hooks.
 */

export function drawLightShafts(ctx, W, H, opts = {}) {
  const count = opts.count ?? 5;
  const t = opts.t ?? 0;
  const alpha = opts.alpha ?? 0.14;
  if (alpha <= 0.005) return;
  const colorRgb = opts.colorRgb ?? '150, 225, 255';
  const maxLen = opts.maxLen ?? H * 0.72;
  const tilt = opts.tilt ?? 0.24;

  ctx.save();
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const sway = Math.sin(t * (0.45 + i * 0.11) + i * 1.9) * 28;
    const topX = u * W * 1.08 - W * 0.04 + sway;
    const topW = 42 + (i % 3) * 22;
    const botW = topW * 2.4;
    const botX = topX + maxLen * tilt;

    const grad = ctx.createLinearGradient(topX, 0, botX, maxLen);
    const rayAlpha = alpha * (0.65 + 0.35 * Math.sin(t * 0.9 + i * 2.1));
    grad.addColorStop(0, `rgba(${colorRgb}, ${rayAlpha.toFixed(3)})`);
    grad.addColorStop(0.65, `rgba(${colorRgb}, ${(rayAlpha * 0.35).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${colorRgb}, 0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(topX - topW * 0.5, 0);
    ctx.lineTo(topX + topW * 0.5, 0);
    ctx.lineTo(botX + botW * 0.5, maxLen);
    ctx.lineTo(botX - botW * 0.5, maxLen);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawDriftParticles(ctx, W, H, opts = {}) {
  const count = opts.count ?? 36;
  const t = opts.t ?? 0;
  const alpha = opts.alpha ?? 0.55;
  if (alpha <= 0.01) return;

  const seed = opts.seed ?? 1337;
  const vx = opts.vx ?? 0;
  const vy = opts.vy ?? -65;
  const minR = opts.minR ?? 2.0;
  const maxR = opts.maxR ?? 7.5;
  const wobble = opts.wobble ?? 10;
  const style = opts.style ?? 'dot'; // 'dot' | 'bubble'
  const fillRgb = opts.fillRgb ?? '210, 244, 255';
  const yMin = opts.yMin ?? 0;
  const yMax = opts.yMax ?? H;
  const spanY = Math.max(10, yMax - yMin);

  ctx.save();
  for (let i = 0; i < count; i++) {
    const h1 = Math.sin(i * 127.1 + seed * 0.13) * 43758.5453;
    const h2 = Math.sin(i * 269.5 + seed * 0.29) * 19341.1234;
    const h3 = Math.sin(i * 419.2 + seed * 0.71) * 91823.4567;
    const r1 = h1 - Math.floor(h1);
    const r2 = h2 - Math.floor(h2);
    const r3 = h3 - Math.floor(h3);

    const speedMul = 0.55 + r3 * 0.9;
    const rad = minR + r3 * (maxR - minR);
    let x = ((r1 * W + vx * t * speedMul) % W + W) % W;
    x += Math.sin(t * (1.8 + r2 * 2.2) + i * 1.7) * wobble;
    let yOff = ((r2 * spanY + vy * t * speedMul) % spanY + spanY) % spanY;
    const y = yMin + yOff;

    const pAlpha = alpha * (0.45 + 0.55 * r3);
    if (style === 'bubble') {
      ctx.fillStyle = `rgba(${fillRgb}, ${(pAlpha * 0.26).toFixed(3)})`;
      ctx.strokeStyle = `rgba(${fillRgb}, ${(pAlpha * 0.85).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.2, rad * 0.22);
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 255, 255, ${(pAlpha * 0.9).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x - rad * 0.32, y - rad * 0.32, Math.max(0.8, rad * 0.24), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `rgba(${fillRgb}, ${pAlpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
