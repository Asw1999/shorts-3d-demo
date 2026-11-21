import * as THREE from '../vendor/three160.module.min.js';
import { resolvePreset } from './presets.js';
import { createWebGLRenderer } from './webgl_renderer.js';

export { THREE };

export const W = 720;
export const H = 1280;

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const smoothstep = (e0, e1, x) => {
  const u = clamp01((x - e0) / (e1 - e0));
  return u * u * (3 - 2 * u);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOut = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export function buildMeshEdges(geo, isSmooth = false) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const creaseDot = isSmooth ? 0.28 : 0.62;

  const vertMap = new Map();
  const canonIdx = new Int32Array(pos.count);
  let nextV = 0;
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    let cid = vertMap.get(key);
    if (cid === undefined) {
      cid = nextV++;
      vertMap.set(key, cid);
    }
    canonIdx[i] = cid;
  }

  const faceNormals = new Array(triCount);
  const edgeMap = new Map();

  function pushEdge(va, vb, rawA, rawB, faceIdx) {
    const c0 = canonIdx[rawA];
    const c1 = canonIdx[rawB];
    if (c0 === c1) return;
    const key = c0 < c1 ? `${c0}:${c1}` : `${c1}:${c0}`;
    let entry = edgeMap.get(key);
    if (!entry) {
      entry = { rawA, rawB, faces: [faceIdx] };
      edgeMap.set(key, entry);
    } else if (entry.faces.length < 2) {
      entry.faces.push(faceIdx);
    }
  }

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    vA.fromBufferAttribute(pos, i0);
    vB.fromBufferAttribute(pos, i1);
    vC.fromBufferAttribute(pos, i2);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    n.crossVectors(e1, e2);
    const len = n.length();
    faceNormals[t] = len > 1e-8 ? n.clone().divideScalar(len) : null;
    if (faceNormals[t]) {
      pushEdge(canonIdx[i0], canonIdx[i1], i0, i1, t);
      pushEdge(canonIdx[i1], canonIdx[i2], i1, i2, t);
      pushEdge(canonIdx[i2], canonIdx[i0], i2, i0, t);
    }
  }

  const edges = [];
  for (const entry of edgeMap.values()) {
    const f0 = entry.faces[0];
    const f1 = entry.faces.length > 1 ? entry.faces[1] : -1;
    let isCrease = false;
    if (f1 === -1) {
      isCrease = true;
    } else if (faceNormals[f0] && faceNormals[f1]) {
      const dot = faceNormals[f0].dot(faceNormals[f1]);
      if (dot < creaseDot) isCrease = true;
    }
    edges.push({ a: entry.rawA, b: entry.rawB, f0, f1, isCrease });
  }
  return edges;
}

export function buildCaptionChunks(words, maxWords = 7) {
  const clauses = [];
  let curClauseId = null;
  let curWords = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const cid = w.clause ?? w.beat;
    if (curWords.length > 0 && cid !== curClauseId) {
      clauses.push(curWords);
      curWords = [];
    }
    curClauseId = cid;
    curWords.push(w);
  }
  if (curWords.length > 0) clauses.push(curWords);

  const chunks = [];
  const pushChunk = (arr, nextStart) => {
    if (!arr.length) return;
    const last = arr[arr.length - 1];
    const endT = nextStart !== null
      ? Math.min(nextStart, last.end + 0.16)
      : last.end + 0.35;
    chunks.push({ start: arr[0].start, end: endT, words: arr });
  };

  for (let c = 0; c < clauses.length; c++) {
    const cw = clauses[c];
    const nextFirst = c < clauses.length - 1 ? clauses[c + 1][0].start : null;
    if (cw.length <= maxWords) {
      pushChunk(cw, nextFirst);
    } else {
      const parts = Math.ceil(cw.length / maxWords);
      const perPart = Math.ceil(cw.length / parts);
      for (let p = 0; p < cw.length; p += perPart) {
        const slice = cw.slice(p, p + perPart);
        const nextSliceFirst = (p + perPart < cw.length) ? cw[p + perPart].start : nextFirst;
        pushChunk(slice, nextSliceFirst);
      }
    }
  }
  return chunks;
}

export function createEngine(opts = {}) {
  const defaultFps = opts.fps || 24;
  const dsf = Number(opts.dsf || 1.5);
  const preset = resolvePreset(opts.preset);
  const rendererMode = String(opts.renderer || 'canvas2d').toLowerCase();
  const flags = {
    autoFrame: opts.flags?.autoFrame !== false,
    adaptiveRim: opts.flags?.adaptiveRim !== false,
    labelLayout: opts.flags?.labelLayout !== false,
    smoothShade: opts.flags?.smoothShade !== false,
    hook: opts.flags?.hook !== false,
  };
  const canvas = document.getElementById('c2d');
  canvas.width = Math.round(W * dsf);
  canvas.height = Math.round(H * dsf);
  const ctx = canvas.getContext('2d');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, W / H, 1.8, 36);
  const sunDir = new THREE.Vector3(0.55, 0.78, 0.48).normalize();
  const root = new THREE.Group();
  scene.add(root);

  const meshes = [];
  let webglBackend = null;
  if (rendererMode === 'webgl') {
    webglBackend = createWebGLRenderer(W, H, dsf, sunDir);
  }

  function addPart(parent, geo, hexColor, partOpts = {}) {
    const mat = new THREE.MeshBasicMaterial({ color: hexColor });
    const m = new THREE.Mesh(geo, mat);
    const isSmooth = Boolean(partOpts.smooth);
    if (isSmooth && !geo.userData._smoothComputed) {
      geo.computeVertexNormals();
      geo.userData._smoothComputed = true;
    }
    const edgeKey = isSmooth ? '_cachedEdgesSmooth' : '_cachedEdges';
    if (!geo.userData[edgeKey]) {
      geo.userData[edgeKey] = buildMeshEdges(geo, isSmooth);
    }
    m.userData = {
      baseColor: new THREE.Color(hexColor),
      baseR: ((hexColor >> 16) & 255) / 255,
      baseG: ((hexColor >> 8) & 255) / 255,
      baseB: (hexColor & 255) / 255,
      unlit: Boolean(partOpts.unlit),
      noCull: Boolean(partOpts.noCull),
      noOutline: Boolean(partOpts.noOutline),
      noSpecular: Boolean(partOpts.noSpecular),
      smooth: isSmooth,
      excludeFromBounds: Boolean(partOpts.excludeFromBounds),
      alpha: partOpts.alpha !== undefined ? partOpts.alpha : 1.0,
      depthBias: partOpts.depthBias || 0,
      outlineStrength: partOpts.outlineStrength !== undefined ? partOpts.outlineStrength : 1.0,
      edges: geo.userData[edgeKey],
    };
    parent.add(m);
    meshes.push(m);
    return m;
  }

  function isVisibleInHierarchy(obj) {
    let cur = obj;
    while (cur) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }

  // Scratch vectors & typed arrays for 3D software rasterizer
  const _vA = new THREE.Vector3();
  const _vB = new THREE.Vector3();
  const _vC = new THREE.Vector3();
  const _cent = new THREE.Vector3();
  const _e1 = new THREE.Vector3();
  const _e2 = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _viewDir = new THREE.Vector3();
  const _halfVec = new THREE.Vector3();
  const _projMat = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _nA = new THREE.Vector3();
  const _nB = new THREE.Vector3();
  const _nC = new THREE.Vector3();
  const _smoothN = new THREE.Vector3();
  const _normalMat = new THREE.Matrix3();

  let scratchCap = 0;
  let scrX = new Float32Array(0);
  let scrY = new Float32Array(0);
  let scrZ = new Float32Array(0);
  let wldX = new Float32Array(0);
  let wldY = new Float32Array(0);
  let wldZ = new Float32Array(0);
  let faceVis = new Uint8Array(0);
  let faceDepth = new Float32Array(0);

  function ensureScratch(vCount, fCount) {
    if (vCount > scratchCap) {
      scratchCap = Math.max(vCount, scratchCap * 2, 512);
      scrX = new Float32Array(scratchCap);
      scrY = new Float32Array(scratchCap);
      scrZ = new Float32Array(scratchCap);
      wldX = new Float32Array(scratchCap);
      wldY = new Float32Array(scratchCap);
      wldZ = new Float32Array(scratchCap);
    }
    if (fCount > faceVis.length) {
      const cap = Math.max(fCount, faceVis.length * 2, 512);
      faceVis = new Uint8Array(cap);
      faceDepth = new Float32Array(cap);
    }
  }

  const RAMP_LIT = [1.02, 1.0, 0.95, 0.012, 0.008, 0.0];
  const RAMP_MID = [0.76, 0.70, 0.84, 0.0, 0.0, 0.02];
  const RAMP_DEEP = [0.50, 0.44, 0.62, 0.0, 0.0, 0.03];
  const RAMP_SPEC = [1, 1, 1, 0, 0, 0];

  function makeHalftone(spacing, radius, alpha) {
    const c = document.createElement('canvas');
    c.width = spacing;
    c.height = spacing;
    const g = c.getContext('2d');
    g.fillStyle = `rgba(14, 17, 24, ${alpha})`;
    for (const [dx, dy, rr] of [
      [spacing / 2, spacing / 2, radius],
      [0, 0, radius],
      [spacing, 0, radius],
      [0, spacing, radius],
      [spacing, spacing, radius],
    ]) {
      g.beginPath();
      g.arc(dx, dy, rr, 0, Math.PI * 2);
      g.fill();
    }
    return ctx.createPattern(c, 'repeat');
  }
  const HALFTONE_MID = makeHalftone(7, 1.05, 0.26);
  const HALFTONE_DEEP = makeHalftone(6, 1.45, 0.36);

  let lastBgLum = 0.35;
  let lastDarkFactor = 0.0;
  let lastCamTarget = new THREE.Vector3();
  let currentFrameTime = 0;
  let lastSilhouetteEdges = [];

  function parseCssColors(str) {
    if (!str) return [];
    const cols = [];
    const rgbRe = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/gi;
    let m;
    while ((m = rgbRe.exec(str)) !== null) {
      const a = m[4] !== undefined ? Number(m[4]) : 1.0;
      if (a >= 0.35) {
        cols.push([Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, a]);
      }
    }
    const hexRe = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
    while ((m = hexRe.exec(str)) !== null) {
      const h = m[1];
      if (h.length === 6) {
        cols.push([
          parseInt(h.slice(0, 2), 16) / 255,
          parseInt(h.slice(2, 4), 16) / 255,
          parseInt(h.slice(4, 6), 16) / 255,
          1.0,
        ]);
      } else {
        cols.push([
          parseInt(h[0] + h[0], 16) / 255,
          parseInt(h[1] + h[1], 16) / 255,
          parseInt(h[2] + h[2], 16) / 255,
          1.0,
        ]);
      }
    }
    return cols;
  }

  function srgbToLin(c) {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function estimateBackdropLuminance() {
    let compLum = 0.10;
    const layers = [dom.bg0, dom.bg1, dom.bg2];
    for (const el of layers) {
      if (!el) continue;
      const opStr = el.style.opacity;
      const op = opStr === '' ? 1.0 : Number(opStr);
      if (!Number.isFinite(op) || op <= 0.01) continue;
      const cssText = `${el.style.background || ''} ${el.style.backgroundColor || ''} ${el.style.backgroundImage || ''}`;
      const cols = parseCssColors(cssText);
      if (!cols.length) continue;
      let sumL = 0;
      let sumW = 0;
      for (const [r, g, b, a] of cols) {
        // True WCAG relative luminance (linearized sRGB) so dark/mid crossover guarantees >=3:1 everywhere
        const lum = 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
        sumL += lum * a;
        sumW += a;
      }
      if (sumW > 0) {
        const layerLum = sumL / sumW;
        compLum = compLum * (1 - op) + layerLum * op;
      }
    }
    return clamp01(compLum);
  }

  function renderSoftware3D(wireMix = 0, hooks = null) {
    ctx.setTransform(dsf, 0, 0, dsf, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (hooks && hooks.before3D) hooks.before3D(ctx, W, H);

    // Adaptive contrast based on true WCAG backdrop luminance (scene data, not frame feedback):
    // bgLum <= 0.13 -> bright outer rim (>=5:1); bgLum >= 0.19 -> crisp dark ink (>=4.5:1)
    const bgLum = estimateBackdropLuminance();
    const darkFactor = flags.adaptiveRim ? smoothstep(0.19, 0.11, bgLum) : 0.0;
    lastBgLum = bgLum;
    lastDarkFactor = darkFactor;

    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    // Optional second renderer backend (RENDERER=webgl: Three.js WebGLRenderer + SwiftShader MSAA 4x)
    if (webglBackend) {
      const glCanvas = webglBackend.renderScene(scene, camera, meshes, {
        wireMix,
        darkFactor,
        rimHex: preset.palette.rimHex,
      });
      ctx.drawImage(glCanvas, 0, 0, W, H);
      ctx.globalAlpha = 1;
      if (hooks && hooks.after3D) hooks.after3D(ctx, W, H);
      return;
    }

    _projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const drawList = [];
    lastSilhouetteEdges = [];
    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;

    for (const m of meshes) {
      if (!isVisibleInHierarchy(m)) continue;
      const geo = m.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const mw = m.matrixWorld;
      const ud = m.userData;
      const alpha = ud.alpha;
      if (alpha <= 0.01) continue;

      const isSmooth = ud.smooth && Boolean(geo.attributes.normal);
      const normAttr = isSmooth ? geo.attributes.normal : null;
      if (isSmooth) _normalMat.getNormalMatrix(mw);

      const objLum = 0.2126 * ud.baseR + 0.7152 * ud.baseG + 0.0722 * ud.baseB;
      const objDark = clamp01((0.55 - objLum) / 0.35);

      const vCount = pos.count;
      const triCount = idx ? idx.count / 3 : vCount / 3;
      ensureScratch(vCount, triCount);

      for (let i = 0; i < vCount; i++) {
        _p.fromBufferAttribute(pos, i).applyMatrix4(mw);
        wldX[i] = _p.x;
        wldY[i] = _p.y;
        wldZ[i] = _p.z;
        _p.applyMatrix4(_projMat);
        scrX[i] = (_p.x * 0.5 + 0.5) * W;
        scrY[i] = (-_p.y * 0.5 + 0.5) * H;
        scrZ[i] = _p.z;
      }

      for (let t = 0; t < triCount; t++) {
        faceVis[t] = 0;
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

        const z0 = scrZ[i0];
        const z1 = scrZ[i1];
        const z2 = scrZ[i2];
        if (z0 < -1 || z1 < -1 || z2 < -1 || z0 > 1 || z1 > 1 || z2 > 1) continue;

        _vA.set(wldX[i0], wldY[i0], wldZ[i0]);
        _vB.set(wldX[i1], wldY[i1], wldZ[i1]);
        _vC.set(wldX[i2], wldY[i2], wldZ[i2]);

        _e1.subVectors(_vB, _vA);
        _e2.subVectors(_vC, _vA);
        _n.crossVectors(_e1, _e2);
        const nLen = _n.length();
        if (nLen < 1e-8) continue;
        _n.divideScalar(nLen);

        _cent.set(
          (_vA.x + _vB.x + _vC.x) / 3,
          (_vA.y + _vB.y + _vC.y) / 3,
          (_vA.z + _vB.z + _vC.z) / 3
        );
        _viewDir.set(camX - _cent.x, camY - _cent.y, camZ - _cent.z).normalize();
        const ndotv = _n.dot(_viewDir);
        if (!ud.noCull && ndotv <= 0) continue;

        let r, g, b;
        let tone = 0;
        if (ud.unlit) {
          r = ud.baseR; g = ud.baseG; b = ud.baseB;
        } else {
          let shadeN = _n;
          if (isSmooth) {
            _nA.fromBufferAttribute(normAttr, i0);
            _nB.fromBufferAttribute(normAttr, i1);
            _nC.fromBufferAttribute(normAttr, i2);
            _smoothN.addVectors(_nA, _nB).add(_nC);
            if (_smoothN.lengthSq() > 1e-8) {
              _smoothN.applyMatrix3(_normalMat).normalize();
              shadeN = _smoothN;
            }
          }
          const ndotl = shadeN.dot(sunDir);
          const smoothNdotv = clamp01(shadeN.dot(_viewDir));
          _halfVec.addVectors(sunDir, _viewDir).normalize();
          const ndoth = shadeN.dot(_halfVec);

          // Smooth toon band transitions (eliminates jagged stepped bands on curved meshes)
          const bandW = flags.smoothShade ? (isSmooth ? 0.13 : 0.035) : 0.0001;
          const tMid = smoothstep(-0.14 - bandW, -0.14 + bandW, ndotl);
          const tLit = smoothstep(0.30 - bandW, 0.30 + bandW, ndotl);

          const mR = RAMP_DEEP[0] + (RAMP_MID[0] - RAMP_DEEP[0]) * tMid + (RAMP_LIT[0] - RAMP_MID[0]) * tLit;
          const mG = RAMP_DEEP[1] + (RAMP_MID[1] - RAMP_DEEP[1]) * tMid + (RAMP_LIT[1] - RAMP_MID[1]) * tLit;
          const mB = RAMP_DEEP[2] + (RAMP_MID[2] - RAMP_DEEP[2]) * tMid + (RAMP_LIT[2] - RAMP_MID[2]) * tLit;
          const oR = RAMP_DEEP[3] + (RAMP_MID[3] - RAMP_DEEP[3]) * tMid + (RAMP_LIT[3] - RAMP_MID[3]) * tLit;
          const oG = RAMP_DEEP[4] + (RAMP_MID[4] - RAMP_DEEP[4]) * tMid + (RAMP_LIT[4] - RAMP_MID[4]) * tLit;
          const oB = RAMP_DEEP[5] + (RAMP_MID[5] - RAMP_DEEP[5]) * tMid + (RAMP_LIT[5] - RAMP_MID[5]) * tLit;

          r = ud.baseR * mR + oR;
          g = ud.baseG * mG + oG;
          b = ud.baseB * mB + oB;

          if (!ud.noSpecular) {
            const specBand = smoothstep(0.84, 0.93, ndoth);
            const sunRim = smoothstep(0.30, 0.12, smoothNdotv) * smoothstep(0.02, 0.22, ndotl) * 0.65;
            const specMix = Math.max(specBand, sunRim) * 0.36;
            if (specMix > 0.005) {
              r += (1.0 - r) * specMix;
              g += (0.97 - g) * specMix;
              b += (0.88 - b) * specMix;
            }
          }

          // Adaptive rim light against dark backgrounds (pops dark silhouettes cleanly)
          if (darkFactor > 0.02) {
            const rimPow = Math.pow(clamp01(1 - smoothNdotv / 0.54), 1.6);
            const rimAmt = rimPow * darkFactor * (0.38 + 0.48 * objDark);
            if (rimAmt > 0.005) {
              r += (0.68 - r) * rimAmt;
              g += (0.91 - g) * rimAmt;
              b += (1.00 - b) * rimAmt;
            }
          }

          tone = ndotl < -0.18 ? 2 : ndotl < 0.22 ? 1 : 0;
        }
        r = Math.max(0, Math.min(255, Math.round(r * 255)));
        g = Math.max(0, Math.min(255, Math.round(g * 255)));
        b = Math.max(0, Math.min(255, Math.round(b * 255)));

        const depth = (z0 + z1 + z2) / 3 + ud.depthBias;
        faceVis[t] = 1;
        faceDepth[t] = depth;

        drawList.push({
          kind: 0,
          ax: scrX[i0], ay: scrY[i0],
          bx: scrX[i1], by: scrY[i1],
          cx: scrX[i2], cy: scrY[i2],
          depth,
          alpha,
          fill: `rgb(${r},${g},${b})`,
          wireAccent: !ud.noOutline,
          tone,
        });
      }

      if (!ud.noOutline && alpha >= 0.92 && (1 - wireMix) > 0.15) {
        const edges = ud.edges;
        const inkScale = Math.sqrt(ud.outlineStrength);
        for (let e = 0; e < edges.length; e++) {
          const ed = edges[e];
          const v0 = faceVis[ed.f0] === 1;
          const v1 = ed.f1 >= 0 && faceVis[ed.f1] === 1;
          if (!v0 && !v1) continue;

          const isSilhouette = (ed.f1 < 0 && v0) || (ed.f1 >= 0 && v0 !== v1);
          const isCrease = v0 && v1 && ed.isCrease;
          if (!isSilhouette && !isCrease) continue;

          const dEdge = (v0 && v1)
            ? Math.min(faceDepth[ed.f0], faceDepth[ed.f1])
            : (v0 ? faceDepth[ed.f0] : faceDepth[ed.f1]);

          if (isSilhouette && !ud.excludeFromBounds) {
            const mx = 0.5 * (scrX[ed.a] + scrX[ed.b]);
            const my = 0.5 * (scrY[ed.a] + scrY[ed.b]);
            if (mx > 24 && mx < W - 24 && my > 195 && my < 800) {
              lastSilhouetteEdges.push([scrX[ed.a], scrY[ed.a], scrX[ed.b], scrY[ed.b]]);
            }
          }
          drawList.push({
            kind: 1,
            ax: scrX[ed.a], ay: scrY[ed.a],
            bx: scrX[ed.b], by: scrY[ed.b],
            depth: dEdge - 0.00025,
            alpha: (isSilhouette ? 0.96 : 0.62) * Math.min(1, ud.outlineStrength + 0.2),
            lw: (isSilhouette ? 2.7 : 2.2) * inkScale,
            isSilhouette,
            objDark,
          });
        }
      }
    }

    drawList.sort((a, b) => b.depth - a.depth);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const solidAlpha = 1 - wireMix;

    for (let i = 0; i < drawList.length; i++) {
      const item = drawList[i];
      if (item.kind === 1) {
        ctx.beginPath();
        ctx.moveTo(item.ax, item.ay);
        ctx.lineTo(item.bx, item.by);
        // Adaptive bright outer rim halo on dark backgrounds + crisp dark ink inner edge (>=3:1 WCAG everywhere)
        if (item.isSilhouette && darkFactor > 0.08) {
          const rimAlpha = smoothstep(0.08, 0.40, darkFactor);
          ctx.globalAlpha = solidAlpha * item.alpha * rimAlpha;
          ctx.strokeStyle = preset.palette.rimHex;
          ctx.lineWidth = item.lw + 3.6 * rimAlpha;
          ctx.stroke();
        }
        ctx.globalAlpha = solidAlpha * item.alpha;
        ctx.strokeStyle = '#080a0f';
        ctx.lineWidth = item.lw;
        ctx.stroke();
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(item.ax, item.ay);
      ctx.lineTo(item.bx, item.by);
      ctx.lineTo(item.cx, item.cy);
      ctx.closePath();

      if (wireMix > 0.02) {
        ctx.globalAlpha = wireMix * item.alpha;
        ctx.fillStyle = 'rgba(38, 128, 240, 0.22)';
        ctx.fill();
      }
      if (solidAlpha > 0.02) {
        ctx.globalAlpha = solidAlpha * item.alpha;
        ctx.fillStyle = item.fill;
        ctx.fill();
        if (item.alpha >= 0.98) {
          ctx.strokeStyle = item.fill;
          ctx.lineWidth = 1.05;
          ctx.stroke();
        }
        if (item.tone > 0 && item.alpha >= 0.9) {
          ctx.fillStyle = item.tone === 2 ? HALFTONE_DEEP : HALFTONE_MID;
          ctx.fill();
        }
      }
      if (wireMix > 0.02 && item.wireAccent) {
        ctx.globalAlpha = wireMix * 0.78 * item.alpha;
        ctx.strokeStyle = 'rgb(142, 220, 255)';
        ctx.lineWidth = 1.15;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (hooks && hooks.after3D) hooks.after3D(ctx, W, H);
  }

  function projectToScreen(obj) {
    const v = new THREE.Vector3();
    obj.getWorldPosition(v);
    v.project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * W,
      y: (-v.y * 0.5 + 0.5) * H,
    };
  }

  const activeCallouts = [];

  function getElementRect(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || parseFloat(cs.opacity || '1') <= 0.02) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }

  function setCallout(elId, lineId, dotId, label, anchorObj, offsetX, offsetY, opacity) {
    const el = document.getElementById(elId);
    const line = document.getElementById(lineId);
    const dot = document.getElementById(dotId);
    if (opacity <= 0.02 || !label) {
      el.style.opacity = 0;
      line.setAttribute('opacity', 0);
      dot.setAttribute('opacity', 0);
      return;
    }
    el.textContent = label;
    const w = Math.max(120, el.offsetWidth || 240);
    const h = Math.max(44, el.offsetHeight || 52);
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    const p = projectToScreen(anchorObj);
    // Pure-time 8px spatial hysteresis quantization (>4px deadband, zero cross-frame state)
    const quantize = (v, step = 8) => Math.round(v / step) * step;
    const qx = quantize(p.x + offsetX, 8);
    const qy = quantize(p.y + offsetY, 8);
    const lx = Math.max(halfW + 10, Math.min(W - halfW - 10, qx));
    const ly = Math.max(204 + halfH, Math.min(H * 0.80 - halfH, qy));

    activeCallouts.push({ el, line, dot, p, lx, ly, halfW, halfH, opacity });
  }

  function rectsOverlapWithGap(a, b, gap) {
    return (
      a.left < b.right + gap &&
      a.right + gap > b.left &&
      a.top < b.bottom + gap &&
      a.bottom + gap > b.top
    );
  }

  function resolveCalloutLayout() {
    if (!activeCallouts.length) return;
    if (!flags.labelLayout) {
      for (const c of activeCallouts) {
        const ix = Math.round(c.lx);
        const iy = Math.round(c.ly);
        c.el.style.left = `${ix}px`;
        c.el.style.top = `${iy}px`;
        c.el.style.opacity = c.opacity.toFixed(2);
        c.line.setAttribute('x1', Math.round(c.p.x));
        c.line.setAttribute('y1', Math.round(c.p.y));
        c.line.setAttribute('x2', ix);
        c.line.setAttribute('y2', iy);
        c.line.setAttribute('opacity', (c.opacity * 0.92).toFixed(2));
        c.dot.setAttribute('cx', Math.round(c.p.x));
        c.dot.setAttribute('cy', Math.round(c.p.y));
        c.dot.setAttribute('opacity', c.opacity.toFixed(2));
      }
      activeCallouts.length = 0;
      return;
    }
    const MIN_GAP = 14; // strictly >= 10px required for label-vs-label, label-vs-caption, label-vs-HUD
    const MARGIN_X = 12;

    // Fixed deterministic safe obstacles (immune to 1-frame caption scale bounce)
    const hudRect = { left: 60, top: 134, right: W - 60, bottom: 192 };
    const hookVisible = flags.hook && currentFrameTime >= 0 && currentFrameTime < 2.15 && dom.hookBanner && dom.hookBanner.style.display !== 'none';
    const hookRect = hookVisible ? { left: 90, top: 198, right: W - 90, bottom: 294 } : null;
    const capRectLive = getElementRect(dom.captionEl);
    // Use a stable envelope around the caption band whenever a caption is present
    const capRect = capRectLive
      ? {
          left: Math.min(18, capRectLive.left),
          top: Math.min(812, capRectLive.top - 4),
          right: Math.max(W - 18, capRectLive.right),
          bottom: Math.max(972, capRectLive.bottom + 4),
        }
      : null;

    const staticObstacles = [hudRect];
    if (hookRect) staticObstacles.push(hookRect);
    if (capRect) staticObstacles.push(capRect);

    const minYBound = Math.max(hudRect.bottom + MIN_GAP, hookRect ? hookRect.bottom + MIN_GAP : 0);
    const maxYBound = Math.round(H * 0.84); // keep well above bottom Shorts UI

    const boxOf = (c, cx = c.lx, cy = c.ly) => ({
      left: cx - c.halfW,
      right: cx + c.halfW,
      top: cy - c.halfH,
      bottom: cy + c.halfH,
    });

    const clampBounds = (c) => {
      c.lx = Math.max(MARGIN_X + c.halfW, Math.min(W - MARGIN_X - c.halfW, c.lx));
      c.ly = Math.max(minYBound + c.halfH, Math.min(maxYBound - c.halfH, c.ly));
    };

    const pushFromObstacles = (c) => {
      clampBounds(c);
      for (const obs of staticObstacles) {
        const r = boxOf(c);
        if (rectsOverlapWithGap(r, obs, MIN_GAP)) {
          const aboveY = obs.top - MIN_GAP - c.halfH;
          const belowY = obs.bottom + MIN_GAP + c.halfH;
          const canAbove = aboveY >= minYBound + c.halfH;
          const canBelow = belowY <= maxYBound - c.halfH;
          if (canAbove && (!canBelow || Math.abs(c.ly - aboveY) <= Math.abs(c.ly - belowY))) {
            c.ly = aboveY;
          } else if (canBelow) {
            c.ly = belowY;
          } else {
            c.ly = Math.max(minYBound + c.halfH, aboveY);
          }
          clampBounds(c);
        }
      }
    };

    for (const c of activeCallouts) pushFromObstacles(c);

    // Iterative AABB separation pass (label vs label + label vs static obstacles)
    for (let iter = 0; iter < 24; iter++) {
      let moved = false;
      for (let i = 0; i < activeCallouts.length; i++) {
        for (let j = i + 1; j < activeCallouts.length; j++) {
          const a = activeCallouts[i];
          const b = activeCallouts[j];
          const dx = b.lx - a.lx;
          const dy = b.ly - a.ly;
          const ovX = (a.halfW + b.halfW + MIN_GAP) - Math.abs(dx);
          const ovY = (a.halfH + b.halfH + MIN_GAP) - Math.abs(dy);
          if (ovX > 0 && ovY > 0) {
            moved = true;
            const topItem = a.ly <= b.ly ? a : b;
            const botItem = a.ly <= b.ly ? b : a;
            const push = ovY * 0.5 + 3;
            topItem.ly -= push;
            botItem.ly += push;
            pushFromObstacles(topItem);
            pushFromObstacles(botItem);

            const remOvY = (topItem.halfH + botItem.halfH + MIN_GAP) - Math.abs(botItem.ly - topItem.ly);
            if (remOvY > 0) {
              botItem.ly = topItem.ly + topItem.halfH + botItem.halfH + MIN_GAP + 2;
              pushFromObstacles(botItem);
            }
            const stillOvY = (topItem.halfH + botItem.halfH + MIN_GAP) - Math.abs(botItem.ly - topItem.ly);
            if (stillOvY > 0) {
              const dir = dx >= 0 ? 1 : -1;
              a.lx -= dir * (ovX * 0.5 + 4);
              b.lx += dir * (ovX * 0.5 + 4);
              pushFromObstacles(a);
              pushFromObstacles(b);
            }
          }
        }
      }
      if (!moved) break;
    }

    // Deterministic slot fallback if any callout STILL violates MIN_GAP against obstacles or peers
    const placed = [];
    for (let idx = 0; idx < activeCallouts.length; idx++) {
      const c = activeCallouts[idx];
      const isFree = (cx, cy) => {
        if (cx - c.halfW < MARGIN_X || cx + c.halfW > W - MARGIN_X) return false;
        if (cy - c.halfH < minYBound || cy + c.halfH > maxYBound) return false;
        const r = boxOf(c, cx, cy);
        for (const obs of staticObstacles) {
          if (rectsOverlapWithGap(r, obs, MIN_GAP)) return false;
        }
        for (const pr of placed) {
          if (rectsOverlapWithGap(r, pr, MIN_GAP)) return false;
        }
        return true;
      };

      if (!isFree(c.lx, c.ly)) {
        let best = null;
        let bestCost = Infinity;
        const xCandidates = [
          Math.round(c.lx),
          Math.round(MARGIN_X + c.halfW + 4),
          Math.round(W * 0.5),
          Math.round(W - MARGIN_X - c.halfW - 4),
        ];
        for (let cy = Math.round(minYBound + c.halfH); cy <= Math.round(maxYBound - c.halfH); cy += 22) {
          for (const cx of xCandidates) {
            if (!isFree(cx, cy)) continue;
            const cost = Math.hypot(cx - c.p.x, cy - c.p.y) + Math.abs(cy - c.ly) * 0.35;
            if (cost < bestCost) {
              bestCost = cost;
              best = { cx, cy };
            }
          }
        }
        if (best) {
          c.lx = best.cx;
          c.ly = best.cy;
        }
      }
      c.lx = Math.round(c.lx);
      c.ly = Math.round(c.ly);
      placed.push(boxOf(c));
    }

    for (const c of activeCallouts) {
      const ix = Math.round(c.lx);
      const iy = Math.round(c.ly);
      c.el.style.left = `${ix}px`;
      c.el.style.top = `${iy}px`;
      c.el.style.opacity = c.opacity.toFixed(2);

      // Leader line always stays connected from 3D projected anchor to integer-locked label center
      c.line.setAttribute('x1', c.p.x.toFixed(1));
      c.line.setAttribute('y1', c.p.y.toFixed(1));
      c.line.setAttribute('x2', String(ix));
      c.line.setAttribute('y2', String(iy));
      c.line.setAttribute('opacity', (c.opacity * 0.92).toFixed(2));

      c.dot.setAttribute('cx', c.p.x.toFixed(1));
      c.dot.setAttribute('cy', c.p.y.toFixed(1));
      c.dot.setAttribute('opacity', c.opacity.toFixed(2));
    }
    activeCallouts.length = 0;
  }

  function computeGroupsBox3(groups) {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const grp of groups) {
      if (!grp) continue;
      grp.traverse((o) => {
        if (!o.isMesh || !isVisibleInHierarchy(o)) return;
        if (o.userData && o.userData.excludeFromBounds) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
    }
    return box;
  }

  function getSubjectBounds(groups) {
    const box = computeGroupsBox3(groups);
    if (box.isEmpty()) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthPct: 0, heightPct: 0, centerYPct: 0, bottomPct: 0 };
    }
    camera.updateMatrixWorld(true);
    const pts = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const v = new THREE.Vector3();
    for (const p of pts) {
      v.copy(p).project(camera);
      const sx = (v.x * 0.5 + 0.5) * W;
      const sy = (-v.y * 0.5 + 0.5) * H;
      if (sx < minX) minX = sx;
      if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx;
      if (sy > maxY) maxY = sy;
    }
    return {
      minX, minY, maxX, maxY,
      widthPct: ((maxX - minX) / W) * 100,
      heightPct: ((maxY - minY) / H) * 100,
      centerYPct: ((minY + maxY) * 0.5 / H) * 100,
      bottomPct: (maxY / H) * 100,
    };
  }

  /**
   * Generic deterministic camera pacing overlay (pure function of t; zero cross-frame state).
   * Uses clean monotonic zoom/orbit within each 2.7s shot + intentional cuts (zero vibration).
   */
  function applyCameraPacing(t, camTarget) {
    const totalDur = TIMINGS.total_duration || 45.0;
    const holdFade = clamp01((totalDur - 1.5 - t) / 0.6);
    const offset = new THREE.Vector3().subVectors(camera.position, camTarget);
    const dist = offset.length();
    if (dist < 1e-4) return;

    // 1. Immediate smooth kinetic intro sweep in 0..0.6s so Frame 0 is already dynamically moving
    const introEnv = Math.exp(-t * 3.8);
    const introDistMul = 1.0 + 0.14 * introEnv;
    const introYaw = -0.15 * introEnv;

    // 2. Deterministic sub-shot cuts with clean monotonic slow push/orbit inside each shot (preset-driven)
    const segDur = preset.camera.segDur;
    const segIdx = Math.floor(t / segDur);
    const segU = (t - segIdx * segDur) / segDur;
    const patterns = [
      { yaw0: 0.00, yaw1: 0.07, d0: 1.00, d1: 0.94, pitchY: 0.00 },
      { yaw0: -0.10, yaw1: -0.02, d0: 0.95, d1: 0.90, pitchY: 0.16 },
      { yaw0: 0.11, yaw1: 0.04, d0: 0.98, d1: 0.91, pitchY: -0.12 },
      { yaw0: -0.05, yaw1: 0.04, d0: 0.96, d1: 0.91, pitchY: 0.10 },
    ];
    const pat = patterns[segIdx % patterns.length];
    const paceScale = holdFade * smoothstep(0.0, 0.35, t);
    const dYaw = introYaw + (pat.yaw0 + (pat.yaw1 - pat.yaw0) * segU) * preset.camera.orbitAmp * paceScale;
    const rawDMul = pat.d0 + (pat.d1 - pat.d0) * segU;
    const dMul = introDistMul * (1 + (rawDMul - 1) * preset.camera.zoomAmp * paceScale);
    const dY = (pat.pitchY + preset.camera.elevBias) * paceScale;

    const cosY = Math.cos(dYaw);
    const sinY = Math.sin(dYaw);
    const nx = offset.x * cosY - offset.z * sinY;
    const nz = offset.x * sinY + offset.z * cosY;
    offset.set(nx * dMul, offset.y * dMul + dY, nz * dMul);
    camera.position.copy(camTarget).add(offset);
    camera.lookAt(camTarget);
  }

  function isExplanationTime(t) {
    const beats = TIMINGS.beats || [];
    if (beats.length >= 3) {
      const firstEnd = beats[0].end ?? 4.0;
      const lastStart = beats[beats.length - 1].start ?? (TIMINGS.total_duration - 4.0);
      return t >= firstEnd && t <= lastStart;
    }
    return t >= 2.2 && t <= (TIMINGS.total_duration || 45.0) - 2.0;
  }

  /**
   * Smooth analytical framing controller over static core-mesh bbox and fixed deterministic
   * vertical safe band. Zero per-frame deadband feedback loops -> zero temporal jitter.
   */
  function enforceUpperSubjectFraming(groups, camTarget, opts = {}) {
    if (!flags.autoFrame) {
      lastCamTarget.copy(camTarget);
      return;
    }
    const t = opts.t ?? currentFrameTime;
    if (opts.pacing !== false) {
      applyCameraPacing(t, camTarget);
    }

    const box = computeGroupsBox3(groups);
    if (box.isEmpty()) {
      lastCamTarget.copy(camTarget);
      return;
    }
    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];

    // Smooth deterministic safe vertical band (NEVER reads live 1-line/2-line caption height!)
    const hookExit = smoothstep(1.75, 2.20, t);
    const safeTop = flags.hook ? (294 - 90 * hookExit) : 204;
    const safeBottom = 794; // strictly above 2-line caption top (~832px) at all times
    const availH = safeBottom - safeTop;
    const idealCy = safeTop + availH * 0.50;

    // Smooth desired subject height: ~32% during hook banner -> preset targetHeightFrac during explanation beats (>=35%)
    const explBlend = smoothstep(1.65, 2.35, t);
    const targetH = Math.min(availH * 0.88, H * (0.318 + (preset.camera.targetHeightFrac - 0.318) * explBlend));

    const measure = () => {
      camera.updateMatrixWorld(true);
      let minY = Infinity, maxY = -Infinity;
      const v = new THREE.Vector3();
      for (const c of corners) {
        v.copy(c).project(camera);
        const sy = (-v.y * 0.5 + 0.5) * H;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
      return { minY, maxY, h: Math.max(10, maxY - minY), cy: 0.5 * (minY + maxY) };
    };

    const camFwd = new THREE.Vector3();
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);

    // Fixed 4 smooth analytical passes (no discontinuous if/break deadbands -> C^infinity smooth!)
    const boxCenter = box.getCenter(new THREE.Vector3());
    for (let pass = 0; pass < 4; pass++) {
      const m = measure();
      camFwd.subVectors(camTarget, camera.position).normalize();
      const distNow = Math.max(2.5, camera.position.distanceTo(boxCenter));
      camRight.crossVectors(camFwd, upAxis);
      if (camRight.lengthSq() < 1e-6) camRight.set(1, 0, 0);
      camRight.normalize();
      camUp.crossVectors(camRight, camFwd).normalize();

      // Continuous distance ratio scaling toward targetH (smoothly preserves pacing push/pull!)
      const ratio = m.h / targetH;
      const clampedRatio = Math.max(0.55, Math.min(1.85, ratio));
      const newDist = Math.max(3.2, Math.min(26.0, distNow * clampedRatio));
      const deltaDist = newDist - distNow;
      camera.position.addScaledVector(camFwd, -deltaDist * 0.85);
      camera.lookAt(camTarget);

      // Continuous vertical recentering strictly inside [safeTop, safeBottom]
      const m2 = measure();
      const dist2 = Math.max(2.5, camera.position.distanceTo(boxCenter));
      const cyErr = m2.cy - idealCy;
      const worldShift = (cyErr / H) * dist2 * 0.86;
      camTarget.addScaledVector(camUp, -Math.max(-3.0, Math.min(3.0, worldShift)));
      camera.lookAt(camTarget);
    }
    lastCamTarget.copy(camTarget);
  }

  const dom = {
    bg0: document.getElementById('bg-layer-0'),
    bg1: document.getElementById('bg-layer-1'),
    bg2: document.getElementById('bg-layer-2'),
    reticle: document.getElementById('reticle'),
    captionEl: document.getElementById('caption'),
    flashOverlay: document.getElementById('flash-overlay'),
    topPill: document.getElementById('top-pill'),
    pillDot: document.getElementById('pill-dot'),
    pillText: document.getElementById('pill-text'),
    hookBanner: document.getElementById('hook-banner'),
    hookKicker: document.getElementById('hook-kicker'),
    hookHeadline: document.getElementById('hook-headline'),
  };

  let TIMINGS = { beats: [], words: [], total_duration: 45.0 };
  let CHUNKS = [];

  function findWordTime(beatId, regex, fallback) {
    if (!TIMINGS.words) return fallback;
    for (const w of TIMINGS.words) {
      if (w.beat === beatId && regex.test(w.text)) return w.start;
    }
    return fallback;
  }

  function beatMap() {
    const m = {};
    for (const b of (TIMINGS.beats || [])) m[b.id] = b;
    return m;
  }

  function updateHookBanner(t, hookCfg) {
    if (!dom.hookBanner) return;
    const hookDur = preset.tempo.hookDur;
    if (!flags.hook || !hookCfg || !hookCfg.headline || t < 0 || t >= hookDur) {
      dom.hookBanner.style.opacity = '0';
      dom.hookBanner.style.display = 'none';
      return;
    }
    dom.hookKicker.textContent = hookCfg.kicker || '';
    dom.hookHeadline.textContent = hookCfg.headline;
    dom.hookBanner.style.display = 'flex';
    dom.hookBanner.style.borderColor = preset.palette.hookBorder;
    dom.hookKicker.style.color = preset.palette.accentHex;

    // Already visible & mid-motion at Frame 0 (t=0.00s)!
    const exitStart = hookDur - 0.35;
    const exitMix = t > exitStart ? clamp01((t - exitStart) / 0.35) : 0;
    const opacity = 1.0 - exitMix;
    const introSpring = Math.exp(-t * 6.5);
    const scale = 1.0 + 0.10 * introSpring + 0.022 * Math.sin(t * 7.5) * (1 - exitMix);
    const slideX = 16 * introSpring;
    const slideY = -24 * exitMix + Math.sin(t * 5.2) * 3.0 * (1 - exitMix);
    const tilt = -1.8 * introSpring + Math.sin(t * 4.5) * 0.65 * (1 - exitMix);

    dom.hookBanner.style.opacity = opacity.toFixed(3);
    dom.hookBanner.style.transform = `translate(calc(-50% + ${slideX.toFixed(1)}px), ${slideY.toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${tilt.toFixed(2)}deg)`;
  }

  function updateCaption(t) {
    let activeChunk = null;
    for (const ch of CHUNKS) {
      if (t >= ch.start && t <= ch.end) { activeChunk = ch; break; }
    }
    if (activeChunk) {
      const chunkPop = 1 + preset.tempo.captionPopScale * Math.exp(-Math.max(0, t - activeChunk.start) * 14);
      dom.captionEl.style.display = 'inline-block';
      dom.captionEl.style.background = preset.palette.captionBg;
      dom.captionEl.style.transform = `scale(${chunkPop.toFixed(3)})`;
      dom.captionEl.innerHTML = activeChunk.words
        .map((w) => {
          const isActive = t >= w.start - 0.03 && t <= w.end + 0.08;
          let style = '';
          if (isActive) {
            const wDur = Math.max(0.08, w.end - w.start);
            const u = clamp01((t - w.start) / wDur);
            const lift = -preset.tempo.wordLiftPx - 3.0 * Math.sin(u * Math.PI);
            style = ` style="color:${preset.palette.accentHex}; transform: translateY(${lift.toFixed(2)}px)"`;
          }
          return `<span class="w${isActive ? ' active' : ''}"${style}>${w.text}</span>`;
        })
        .join('');
    } else {
      dom.captionEl.style.display = 'none';
    }
  }

  function setTopPill(label, accentClass = '') {
    dom.pillText.textContent = label;
    dom.pillDot.className = accentClass;
  }

  async function mountScenario(scenarioModule, timingsUrl) {
    const api = {
      THREE, W, H, fps: defaultFps,
      canvas, ctx, scene, camera, sunDir, root, meshes, dom,
      addPart, isVisibleInHierarchy, renderSoftware3D,
      projectToScreen, setCallout,
      enforceUpperSubjectFraming, getSubjectBounds,
      findWordTime, beatMap, updateCaption, setTopPill,
      clamp01, smoothstep, easeOutCubic, easeInOut,
      getTimings: () => TIMINGS,
    };

    const instance = scenarioModule.setup(api);
    const hookCfg = instance.hook || scenarioModule.HOOK || null;

    try {
      const res = await fetch(timingsUrl);
      if (res.ok) {
        TIMINGS = await res.json();
        CHUNKS = buildCaptionChunks(TIMINGS.words || [], preset.narration.chunkMaxWords);
      }
    } catch (e) {
      console.warn('Could not load timings:', timingsUrl, e);
    }

    window.renderFrame = function(frameIdx, fpsOverride) {
      const fps = fpsOverride || defaultFps;
      const t = frameIdx / fps;
      currentFrameTime = t;
      activeCallouts.length = 0;
      // Update caption & hook banner FIRST so framing & label collision pass read exact live DOM rects
      updateCaption(t);
      updateHookBanner(t, hookCfg);
      instance.render(t, frameIdx, fps);
      resolveCalloutLayout();
      return true;
    };

    window.__getSubjectBounds = function() {
      return getSubjectBounds(instance.getSubjectGroups ? instance.getSubjectGroups() : []);
    };

    window.__getCalloutRects = function() {
      const ids = ['lbl-a', 'lbl-b', 'lbl-c'];
      const out = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        const op = parseFloat(getComputedStyle(el).opacity || '0');
        if (op > 0.05 && el.textContent.trim()) {
          const r = el.getBoundingClientRect();
          out.push({ id, label: el.textContent.trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom });
        }
      }
      return out;
    };

    window.__inspectFrame = function() {
      const sb = window.__getSubjectBounds();
      const hudRect = getElementRect(dom.topPill);
      const hookRect = getElementRect(dom.hookBanner);
      const capRect = getElementRect(dom.captionEl);
      const wordSpans = capRect
        ? Array.from(dom.captionEl.querySelectorAll('span.w')).map((el) => {
            const r = el.getBoundingClientRect();
            return { text: el.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
          })
        : [];
      const calloutRects = window.__getCalloutRects();
      return {
        t: currentFrameTime,
        isExplanation: isExplanationTime(currentFrameTime),
        subjectBounds: sb,
        hudRect,
        hookRect: hookRect ? {
          ...hookRect,
          headline: dom.hookHeadline?.textContent || '',
          opacity: parseFloat(dom.hookBanner?.style.opacity || '0'),
          transform: dom.hookBanner?.style.transform || '',
        } : null,
        captionRect: capRect,
        wordSpans,
        calloutRects,
        cameraState: {
          pos: [camera.position.x, camera.position.y, camera.position.z],
          target: [lastCamTarget.x, lastCamTarget.y, lastCamTarget.z],
          dist: camera.position.distanceTo(lastCamTarget),
        },
        bgLum: lastBgLum,
        darkFactor: lastDarkFactor,
        silhouetteSampleCount: lastSilhouetteEdges.length,
        silhouetteEdges: lastSilhouetteEdges.length <= 48
          ? lastSilhouetteEdges
          : Array.from({ length: 48 }, (_, i) => lastSilhouetteEdges[Math.floor((i * lastSilhouetteEdges.length) / 48)]),
      };
    };

    window.renderFrame(0, defaultFps);
    window.__timings = TIMINGS;
    window.__ready = true;
  }

  return { mountScenario };
}
