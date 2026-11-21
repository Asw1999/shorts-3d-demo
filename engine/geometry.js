import * as THREE from '../vendor/three160.module.min.js';

function catmullRom(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * u +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * u3
  );
}

function subdivideSections(sections, axialSubdiv) {
  if (axialSubdiv <= 1 || sections.length < 3) return sections;
  const out = [];
  const n = sections.length;
  for (let i = 0; i < n - 1; i++) {
    const s0 = sections[Math.max(0, i - 1)];
    const s1 = sections[i];
    const s2 = sections[i + 1];
    const s3 = sections[Math.min(n - 1, i + 2)];
    out.push(s1);
    for (let k = 1; k < axialSubdiv; k++) {
      const u = k / axialSubdiv;
      const z = s1.z + (s2.z - s1.z) * u;
      const rx = Math.max(0.005, catmullRom(s0.rx, s1.rx, s2.rx, s3.rx, u));
      const ry0 = s0.ry ?? s0.rx;
      const ry1 = s1.ry ?? s1.rx;
      const ry2 = s2.ry ?? s2.rx;
      const ry3 = s3.ry ?? s3.rx;
      const ry = Math.max(0.005, catmullRom(ry0, ry1, ry2, ry3, u));
      const cy = catmullRom(s0.cy ?? 0, s1.cy ?? 0, s2.cy ?? 0, s3.cy ?? 0, u);
      out.push({ z, rx, ry, cy });
    }
  }
  out.push(sections[n - 1]);
  return out;
}

/**
 * Build a closed watertight 3D loft BufferGeometry from ordered Z cross-sections.
 * Each section: { z, rx, ry, cy = 0 } ordered from minimum Z to maximum Z.
 * Supports smooth Catmull-Rom axial subdivision (default axialSubdiv=2) to eliminate
 * stepped/jagged shading boundaries on curved lofted hulls.
 */
export function buildLoftGeometry(sections, radialSegs = 28, opts = {}) {
  if (!Array.isArray(sections) || sections.length < 2) {
    throw new Error('buildLoftGeometry requires at least 2 cross-sections');
  }
  const axialSubdiv = opts.axialSubdiv ?? (sections.length >= 3 ? 2 : 1);
  const denseSections = subdivideSections(sections, axialSubdiv);

  const positions = [];
  const indices = [];
  const ringStarts = [];

  for (let s = 0; s < denseSections.length; s++) {
    const sec = denseSections[s];
    const z = sec.z;
    const rx = Math.max(0, sec.rx);
    const ry = Math.max(0, sec.ry ?? sec.rx);
    const cy = sec.cy ?? 0;

    ringStarts.push(positions.length / 3);
    for (let i = 0; i < radialSegs; i++) {
      const theta = (i / radialSegs) * Math.PI * 2;
      const x = Math.cos(theta) * rx;
      const y = cy + Math.sin(theta) * ry;
      positions.push(x, y, z);
    }
  }

  // Side quads between adjacent rings (CCW outward winding for +Z progression: +theta x +Z = outward radial)
  for (let s = 0; s < denseSections.length - 1; s++) {
    const r0 = ringStarts[s];
    const r1 = ringStarts[s + 1];
    for (let i = 0; i < radialSegs; i++) {
      const iNext = (i + 1) % radialSegs;
      const a = r0 + i;
      const b = r0 + iNext;
      const c = r1 + iNext;
      const d = r1 + i;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  // Close aft cap (-Z outward normal) if first section has non-zero radius
  const first = denseSections[0];
  if (first.rx > 1e-4 || (first.ry ?? first.rx) > 1e-4) {
    const cIdx = positions.length / 3;
    positions.push(0, first.cy ?? 0, first.z);
    const r0 = ringStarts[0];
    for (let i = 0; i < radialSegs; i++) {
      const iNext = (i + 1) % radialSegs;
      indices.push(cIdx, r0 + iNext, r0 + i);
    }
  }

  // Close fore cap (+Z outward normal) if last section has non-zero radius
  const last = denseSections[denseSections.length - 1];
  if (last.rx > 1e-4 || (last.ry ?? last.rx) > 1e-4) {
    const cIdx = positions.length / 3;
    positions.push(0, last.cy ?? 0, last.z);
    const rLast = ringStarts[denseSections.length - 1];
    for (let i = 0; i < radialSegs; i++) {
      const iNext = (i + 1) % radialSegs;
      indices.push(cIdx, rLast + i, rLast + iNext);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Animate a unit-height (height = 1) fill mesh inside a container from baseY up to baseY + maxHeight.
 */
export function updateFillColumn(mesh, level01, baseY, maxHeight) {
  const lv = Math.max(0, Math.min(1, level01));
  if (lv <= 0.01) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  const h = maxHeight * lv;
  mesh.scale.y = h;
  mesh.position.y = baseY + h * 0.5;
}
