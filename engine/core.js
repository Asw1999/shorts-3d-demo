import * as THREE from '../vendor/three160.module.min.js';

export { THREE };

export const W = 720;
export const H = 1280;

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
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

export function buildCaptionChunks(words) {
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
    if (cw.length <= 7) {
      pushChunk(cw, nextFirst);
    } else {
      const mid = Math.ceil(cw.length / 2);
      const partA = cw.slice(0, mid);
      const partB = cw.slice(mid);
      pushChunk(partA, partB[0].start);
      pushChunk(partB, nextFirst);
    }
  }
  return chunks;
}

export function createEngine(opts = {}) {
  const defaultFps = opts.fps || 24;
  const dsf = Number(opts.dsf || 1.5);
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

  function renderSoftware3D(wireMix = 0, hooks = null) {
    ctx.setTransform(dsf, 0, 0, dsf, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (hooks && hooks.before3D) hooks.before3D(ctx, W, H);

    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    _projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const drawList = [];
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

        let shade = 1.0;
        if (!ud.unlit) {
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
          _halfVec.addVectors(sunDir, _viewDir).normalize();
          const ndoth = shadeN.dot(_halfVec);
          const isSpecOrRim = !ud.noSpecular && (ndoth > 0.88 || (ndotv < 0.26 && ndotl > 0.08));
          if (isSpecOrRim) {
            shade = 1.18;
          } else if (ndotl > 0.30) {
            shade = 1.0;
          } else if (ndotl > -0.14) {
            shade = 0.74;
          } else {
            shade = 0.48;
          }
        }

        const ramp = shade >= 1.1 ? RAMP_SPEC : shade >= 0.99 ? RAMP_LIT : shade >= 0.7 ? RAMP_MID : RAMP_DEEP;
        let r, g, b;
        if (ud.unlit) {
          r = ud.baseR; g = ud.baseG; b = ud.baseB;
        } else if (ramp === RAMP_SPEC) {
          r = ud.baseR + (1.0 - ud.baseR) * 0.36;
          g = ud.baseG + (0.97 - ud.baseG) * 0.36;
          b = ud.baseB + (0.88 - ud.baseB) * 0.36;
        } else {
          r = ud.baseR * ramp[0] + ramp[3];
          g = ud.baseG * ramp[1] + ramp[4];
          b = ud.baseB * ramp[2] + ramp[5];
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
          tone: (!ud.unlit && shade < 0.75) ? (shade < 0.6 ? 2 : 1) : 0,
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

          drawList.push({
            kind: 1,
            ax: scrX[ed.a], ay: scrY[ed.a],
            bx: scrX[ed.b], by: scrY[ed.b],
            depth: dEdge - 0.00025,
            alpha: (isSilhouette ? 0.96 : 0.62) * Math.min(1, ud.outlineStrength + 0.2),
            lw: (isSilhouette ? 2.7 : 2.2) * inkScale,
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
        ctx.globalAlpha = solidAlpha * item.alpha;
        ctx.strokeStyle = '#0e1118';
        ctx.lineWidth = item.lw;
        ctx.beginPath();
        ctx.moveTo(item.ax, item.ay);
        ctx.lineTo(item.bx, item.by);
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
    const halfW = Math.max(125, (el.offsetWidth || 280) * 0.5 + 14);
    const halfH = Math.max(28, (el.offsetHeight || 56) * 0.5 + 10);
    const p = projectToScreen(anchorObj);
    const lx = Math.max(halfW + 8, Math.min(W - halfW - 8, p.x + offsetX));
    let ly = Math.max(145 + halfH, Math.min(H - 135 - halfH, p.y + offsetY));
    if (ly > H * 0.60 - halfH && ly < H * 0.78 + halfH) {
      ly = (p.y + offsetY < H * 0.69)
        ? Math.max(145 + halfH, H * 0.59 - halfH)
        : Math.min(H - 135 - halfH, H * 0.79 + halfH);
    }

    activeCallouts.push({ el, line, dot, p, lx, ly, halfW, halfH, opacity });
  }

  function resolveCalloutLayout() {
    if (!activeCallouts.length) return;
    const padX = 12;
    const padY = 12;
    const capBandTop = H * 0.60;
    const capBandBot = H * 0.78;
    const minYBound = 142;
    const maxYBound = H - 135;

    const clampY = (c) => {
      c.ly = Math.max(minYBound + c.halfH, Math.min(maxYBound - c.halfH, c.ly));
      if (c.ly > capBandTop - c.halfH && c.ly < capBandBot + c.halfH) {
        c.ly = c.ly < H * 0.69
          ? Math.max(minYBound + c.halfH, capBandTop - c.halfH - 4)
          : Math.min(maxYBound - c.halfH, capBandBot + c.halfH + 4);
      }
    };

    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < activeCallouts.length; i++) {
        for (let j = i + 1; j < activeCallouts.length; j++) {
          const a = activeCallouts[i];
          const b = activeCallouts[j];
          const dx = b.lx - a.lx;
          const dy = b.ly - a.ly;
          const ovX = (a.halfW + b.halfW + padX) - Math.abs(dx);
          const ovY = (a.halfH + b.halfH + padY) - Math.abs(dy);
          if (ovX > 0 && ovY > 0) {
            moved = true;
            // Push apart vertically first (preferring stacking cleanly in portrait 9:16)
            const topItem = a.ly <= b.ly ? a : b;
            const botItem = a.ly <= b.ly ? b : a;
            const push = ovY * 0.5 + 4;
            topItem.ly -= push;
            botItem.ly += push;
            clampY(topItem);
            clampY(botItem);
            // If clamped top/bottom still overlap vertically, push lower item below upper
            const remOvY = (topItem.halfH + botItem.halfH + padY) - Math.abs(botItem.ly - topItem.ly);
            if (remOvY > 0) {
              botItem.ly = topItem.ly + topItem.halfH + botItem.halfH + padY + 4;
              clampY(botItem);
            }
            // If STILL overlapping (e.g. clamped against caption band), push apart horizontally
            const stillOvY = (topItem.halfH + botItem.halfH + padY) - Math.abs(botItem.ly - topItem.ly);
            if (stillOvY > 0) {
              const dir = dx >= 0 ? 1 : -1;
              a.lx = Math.max(a.halfW + 8, Math.min(W - a.halfW - 8, a.lx - dir * (ovX * 0.5 + 4)));
              b.lx = Math.max(b.halfW + 8, Math.min(W - b.halfW - 8, b.lx + dir * (ovX * 0.5 + 4)));
            }
          }
        }
      }
      if (!moved) break;
    }

    for (const c of activeCallouts) {
      c.el.style.left = `${c.lx.toFixed(1)}px`;
      c.el.style.top = `${c.ly.toFixed(1)}px`;
      c.el.style.opacity = c.opacity.toFixed(2);

      c.line.setAttribute('x1', c.p.x.toFixed(1));
      c.line.setAttribute('y1', c.p.y.toFixed(1));
      c.line.setAttribute('x2', c.lx.toFixed(1));
      c.line.setAttribute('y2', c.ly.toFixed(1));
      c.line.setAttribute('opacity', (c.opacity * 0.92).toFixed(2));

      c.dot.setAttribute('cx', c.p.x.toFixed(1));
      c.dot.setAttribute('cy', c.p.y.toFixed(1));
      c.dot.setAttribute('opacity', c.opacity.toFixed(2));
    }
    activeCallouts.length = 0;
  }

  function computeGroupsBox3(groups) {
    const box = new THREE.Box3();
    for (const grp of groups) {
      if (!grp) continue;
      grp.updateMatrixWorld(true);
      grp.traverse((o) => {
        if (!o.isMesh || !isVisibleInHierarchy(o)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
    }
    return box;
  }

  function getSubjectBounds(groups) {
    const box = computeGroupsBox3(groups);
    if (box.isEmpty()) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, centerYPct: 0, bottomPct: 0 };
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
      centerYPct: ((minY + maxY) * 0.5 / H) * 100,
      bottomPct: (maxY / H) * 100,
    };
  }

  function enforceUpperSubjectFraming(groups, camTarget) {
    const box = computeGroupsBox3(groups);
    if (box.isEmpty()) return;
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

    const measureY = () => {
      camera.updateMatrixWorld(true);
      let minY = Infinity, maxY = -Infinity;
      const v = new THREE.Vector3();
      for (const c of corners) {
        v.copy(c).project(camera);
        const sy = (-v.y * 0.5 + 0.5) * H;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
      return { minY, maxY, cy: 0.5 * (minY + maxY) };
    };

    const camFwd = new THREE.Vector3();
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    for (let iter = 0; iter < 8; iter++) {
      const m = measureY();
      const overCenter = m.cy - H * 0.415;
      const overBottom = m.maxY - H * 0.575;
      const shiftPx = Math.max(overCenter, overBottom);
      if (shiftPx <= 2 && m.minY >= 102) break;
      camFwd.subVectors(camTarget, camera.position).normalize();
      const distNow = camera.position.distanceTo(camTarget);
      camRight.crossVectors(camFwd, new THREE.Vector3(0, 1, 0));
      if (camRight.lengthSq() < 1e-6) camRight.set(1, 0, 0);
      camRight.normalize();
      camUp.crossVectors(camRight, camFwd).normalize();

      if (m.minY < 102 || m.maxY - m.minY > H * 0.45) {
        const extraDist = Math.max(0.65, ((m.maxY - m.minY) / (H * 0.43) - 1) * distNow * 0.6);
        camera.position.addScaledVector(camFwd, -Math.min(2.6, extraDist));
      }
      if (shiftPx > 2) {
        const worldShift = (shiftPx / H) * distNow * 0.85;
        camTarget.addScaledVector(camUp, -Math.min(1.8, worldShift));
      } else if (m.minY < 102) {
        const worldShift = ((102 - m.minY) / H) * distNow * 0.65;
        camTarget.addScaledVector(camUp, Math.min(1.0, worldShift));
      }
      camera.lookAt(camTarget);
    }
  }

  const dom = {
    bg0: document.getElementById('bg-layer-0'),
    bg1: document.getElementById('bg-layer-1'),
    bg2: document.getElementById('bg-layer-2'),
    reticle: document.getElementById('reticle'),
    captionEl: document.getElementById('caption'),
    flashOverlay: document.getElementById('flash-overlay'),
    pillDot: document.getElementById('pill-dot'),
    pillText: document.getElementById('pill-text'),
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

  function updateCaption(t) {
    let activeChunk = null;
    for (const ch of CHUNKS) {
      if (t >= ch.start && t <= ch.end) { activeChunk = ch; break; }
    }
    if (activeChunk) {
      const chunkPop = 1 + 0.04 * Math.exp(-Math.max(0, t - activeChunk.start) * 14);
      dom.captionEl.style.display = 'inline-block';
      dom.captionEl.style.transform = `scale(${chunkPop.toFixed(3)})`;
      dom.captionEl.innerHTML = activeChunk.words
        .map((w) => {
          const isActive = t >= w.start - 0.03 && t <= w.end + 0.08;
          let style = '';
          if (isActive) {
            const wDur = Math.max(0.08, w.end - w.start);
            const u = clamp01((t - w.start) / wDur);
            const lift = -4.0 - 3.0 * Math.sin(u * Math.PI);
            style = ` style="transform: translateY(${lift.toFixed(2)}px)"`;
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
      clamp01, easeOutCubic, easeInOut,
      getTimings: () => TIMINGS,
    };

    const instance = scenarioModule.setup(api);

    try {
      const res = await fetch(timingsUrl);
      if (res.ok) {
        TIMINGS = await res.json();
        CHUNKS = buildCaptionChunks(TIMINGS.words || []);
      }
    } catch (e) {
      console.warn('Could not load timings:', timingsUrl, e);
    }

    window.renderFrame = function(frameIdx, fpsOverride) {
      const fps = fpsOverride || defaultFps;
      const t = frameIdx / fps;
      activeCallouts.length = 0;
      instance.render(t, frameIdx, fps);
      resolveCalloutLayout();
      updateCaption(t);
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

    window.renderFrame(0, defaultFps);
    window.__timings = TIMINGS;
    window.__ready = true;
  }

  return { mountScenario };
}
