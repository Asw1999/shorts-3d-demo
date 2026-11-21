import * as THREE from '../vendor/three160.module.min.js';

/**
 * Build a closed watertight 3D loft BufferGeometry from ordered Z cross-sections.
 * Each section: { z, rx, ry, cy = 0 } ordered from minimum Z to maximum Z.
 */
export function buildLoftGeometry(sections, radialSegs = 22) {
  if (!Array.isArray(sections) || sections.length < 2) {
    throw new Error('buildLoftGeometry requires at least 2 cross-sections');
  }
  const positions = [];
  const indices = [];
  const ringStarts = [];

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
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
  for (let s = 0; s < sections.length - 1; s++) {
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
  const first = sections[0];
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
  const last = sections[sections.length - 1];
  if (last.rx > 1e-4 || (last.ry ?? last.rx) > 1e-4) {
    const cIdx = positions.length / 3;
    positions.push(0, last.cy ?? 0, last.z);
    const rLast = ringStarts[sections.length - 1];
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
