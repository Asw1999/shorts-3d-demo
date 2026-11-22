import * as THREE from '../vendor/three160.module.min.js';

/**
 * Compute smooth averaged (welded) vertex normals for gap-free inverted-hull outlines
 * even on sharp hard-surface geometries like BoxGeometry.
 */
function buildWeldedOutlineGeometry(srcGeo) {
  if (srcGeo.userData._weldedOutlineGeo) return srcGeo.userData._weldedOutlineGeo;
  const geo = srcGeo.clone();
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const sums = new Map();
  const keys = new Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    keys[i] = k;
    let s = sums.get(k);
    if (!s) {
      s = [0, 0, 0];
      sums.set(k, s);
    }
    s[0] += norm.getX(i);
    s[1] += norm.getY(i);
    s[2] += norm.getZ(i);
  }

  const welded = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keys[i]);
    const len = Math.hypot(s[0], s[1], s[2]) || 1;
    welded[i * 3] = s[0] / len;
    welded[i * 3 + 1] = s[1] / len;
    welded[i * 3 + 2] = s[2] / len;
  }
  geo.setAttribute('aSmoothNormal', new THREE.BufferAttribute(welded, 3));
  srcGeo.userData._weldedOutlineGeo = geo;
  return geo;
}

const TOON_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vVertColor;
  #ifdef USE_VCOLOR
  attribute vec3 color;
  #endif
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    #ifdef USE_VCOLOR
      vVertColor = color;
    #else
      vVertColor = vec3(1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const TOON_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uBaseColor;
  uniform vec3 uSunDir;
  uniform vec3 uRimColor;
  uniform float uAlpha;
  uniform float uUnlit;
  uniform float uSmooth;
  uniform float uNoSpec;
  uniform float uDarkFactor;
  uniform float uWireMix;
  uniform float uDsf;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vVertColor;

  void main() {
    if (uAlpha <= 0.01) discard;
    vec3 baseCol = uBaseColor * vVertColor;
    vec3 N = uSmooth > 0.5
      ? normalize(vWorldNormal)
      : normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndotv = clamp(dot(N, V), 0.0, 1.0);

    vec3 col = baseCol;
    if (uUnlit < 0.5) {
      float ndotl = dot(N, normalize(uSunDir));
      vec3 H = normalize(normalize(uSunDir) + V);
      float ndoth = clamp(dot(N, H), 0.0, 1.0);

      float bandW = uSmooth > 0.5 ? 0.11 : 0.03;
      float tMid = smoothstep(-0.14 - bandW, -0.14 + bandW, ndotl);
      float tLit = smoothstep(0.30 - bandW, 0.30 + bandW, ndotl);

      vec3 deepCol = baseCol * vec3(0.50, 0.44, 0.62) + vec3(0.0, 0.0, 0.03);
      vec3 midCol  = baseCol * vec3(0.76, 0.70, 0.84) + vec3(0.0, 0.0, 0.02);
      vec3 litCol  = baseCol * vec3(1.02, 1.00, 0.95) + vec3(0.012, 0.008, 0.0);
      col = mix(mix(deepCol, midCol, tMid), litCol, tLit);

      if (uNoSpec < 0.5) {
        float specBand = smoothstep(0.84, 0.93, ndoth);
        float sunRim = smoothstep(0.30, 0.12, ndotv) * smoothstep(0.02, 0.22, ndotl) * 0.65;
        float specMix = max(specBand, sunRim) * 0.36;
        col = mix(col, vec3(1.0, 0.97, 0.88), specMix);
      }

      // Adaptive Fresnel rim light on dark backgrounds
      if (uDarkFactor > 0.02) {
        float objLum = dot(baseCol, vec3(0.2126, 0.7152, 0.0722));
        float objDark = clamp((0.55 - objLum) / 0.35, 0.0, 1.0);
        float rimPow = pow(clamp(1.0 - ndotv / 0.54, 0.0, 1.0), 1.6);
        float rimAmt = rimPow * uDarkFactor * (0.42 + 0.48 * objDark);
        col = mix(col, uRimColor, clamp(rimAmt, 0.0, 0.92));
      }

      // Screen-space procedural halftone dots in shadow bands (matching Canvas2D comic aesthetic)
      if (uAlpha >= 0.90 && ndotl < 0.22) {
        float spacing = (ndotl < -0.18 ? 6.0 : 7.0) * uDsf;
        float rad = (ndotl < -0.18 ? 1.45 : 1.05) * uDsf;
        float dotAlpha = ndotl < -0.18 ? 0.34 : 0.24;
        vec2 cell = mod(gl_FragCoord.xy, spacing) - 0.5 * spacing;
        float d = length(cell);
        float dotMask = 1.0 - smoothstep(rad - 0.5, rad + 0.5, d);
        col = mix(col, vec3(0.055, 0.067, 0.094), dotMask * dotAlpha);
      }
    }

    // Blueprint wireframe/X-ray tint blend when uWireMix > 0
    if (uWireMix > 0.02) {
      vec3 bpFill = vec3(0.16, 0.54, 0.95);
      col = mix(col, bpFill, uWireMix * 0.72);
    }

    float finalAlpha = uAlpha * (1.0 - uWireMix * 0.65);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), finalAlpha);
  }
`;

const OUTLINE_VERT = /* glsl */ `
  attribute vec3 aSmoothNormal;
  uniform float uThicknessPx;
  uniform vec2 uResolution;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vec4 clipPos = projectionMatrix * mvPos;
    vec3 clipNormal = mat3(projectionMatrix) * (mat3(modelViewMatrix) * normalize(aSmoothNormal));
    vec2 ndcDir = length(clipNormal.xy) > 1e-4 ? normalize(clipNormal.xy) : vec2(0.0);
    vec2 pxOffset = ndcDir * (uThicknessPx * 2.0 / uResolution) * clipPos.w;
    clipPos.xy += pxOffset;
    // Push slightly behind so front-facing surface always wins depth test
    clipPos.z += 0.0004 * clipPos.w;
    gl_Position = clipPos;
  }
`;

const OUTLINE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() {
    if (uAlpha <= 0.02) discard;
    gl_FragColor = vec4(uColor, uAlpha);
  }
`;

export function createWebGLRenderer(W, H, dsf, sunDir) {
  const glCanvas = document.createElement('canvas');
  glCanvas.width = Math.round(W * dsf);
  glCanvas.height = Math.round(H * dsf);

  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias: true, // MSAA 4x in ANGLE/SwiftShader
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(dsf);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.sortObjects = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const info = {
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    samples: gl.getParameter(gl.SAMPLES),
    antialias: gl.getContextAttributes()?.antialias ?? false,
    width: glCanvas.width,
    height: glCanvas.height,
  };
  window.__webglInfo = info;

  const prepared = new WeakMap();
  const resolution = new THREE.Vector2(W * dsf, H * dsf);
  const rimCol = new THREE.Color('#e2f9ff');
  const inkCol = new THREE.Color('#080a0f');

  function ensureMeshMaterials(m) {
    if (prepared.has(m)) return prepared.get(m);
    const ud = m.userData;
    const baseCol = new THREE.Color(ud.baseR, ud.baseG, ud.baseB);
    const hasVCol = Boolean(ud.useVertexColors && m.geometry.attributes.color);
    const mat = new THREE.ShaderMaterial({
      vertexShader: TOON_VERT,
      fragmentShader: TOON_FRAG,
      defines: hasVCol ? { USE_VCOLOR: 1 } : {},
      uniforms: {
        uBaseColor: { value: baseCol },
        uSunDir: { value: sunDir.clone() },
        uRimColor: { value: rimCol.clone() },
        uAlpha: { value: ud.alpha },
        uUnlit: { value: ud.unlit ? 1.0 : 0.0 },
        uSmooth: { value: ud.smooth ? 1.0 : 0.0 },
        uNoSpec: { value: ud.noSpecular ? 1.0 : 0.0 },
        uDarkFactor: { value: 0.0 },
        uWireMix: { value: 0.0 },
        uDsf: { value: dsf },
      },
      side: ud.noCull ? THREE.DoubleSide : THREE.FrontSide,
      transparent: ud.alpha < 0.99,
      depthWrite: ud.alpha >= 0.98,
    });
    m.material = mat;

    // Solid anti-aliased inverted-hull BackSide outline (>=2.5px @1080p, polygonOffset prevents dashes/shimmer)
    let outlineInk = null;
    let outlineRim = null;
    if (!ud.noOutline) {
      const oGeo = buildWeldedOutlineGeometry(m.geometry);
      const inkThickPx = Math.max(2.6, 2.6 * Math.sqrt(ud.outlineStrength || 1.0) * dsf);
      const inkMat = new THREE.ShaderMaterial({
        vertexShader: OUTLINE_VERT,
        fragmentShader: OUTLINE_FRAG,
        uniforms: {
          uThicknessPx: { value: inkThickPx },
          uResolution: { value: resolution },
          uColor: { value: inkCol.clone() },
          uAlpha: { value: 1.0 },
        },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      });
      outlineInk = new THREE.Mesh(oGeo, inkMat);
      outlineInk.userData = { excludeFromBounds: true, _isOutlineHelper: true };
      outlineInk.renderOrder = 0;
      m.add(outlineInk);

      // Outer adaptive bright rim inverted-hull (visible only on dark backgrounds -> >=3:1 WCAG contrast)
      const rimMat = new THREE.ShaderMaterial({
        vertexShader: OUTLINE_VERT,
        fragmentShader: OUTLINE_FRAG,
        uniforms: {
          uThicknessPx: { value: inkThickPx + 3.2 * dsf },
          uResolution: { value: resolution },
          uColor: { value: rimCol.clone() },
          uAlpha: { value: 0.0 },
        },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 3,
        polygonOffsetUnits: 3,
      });
      outlineRim = new THREE.Mesh(oGeo, rimMat);
      outlineRim.userData = { excludeFromBounds: true, _isOutlineHelper: true };
      outlineRim.renderOrder = -1;
      m.add(outlineRim);
    }

    const rec = { mat, outlineInk, outlineRim };
    prepared.set(m, rec);
    return rec;
  }

  function renderScene(scene, camera, meshes, { wireMix, darkFactor, rimHex }) {
    rimCol.set(rimHex || '#e2f9ff');
    const solidAlpha = 1 - wireMix;
    const rimAlpha = darkFactor > 0.08
      ? Math.max(0, Math.min(1, (darkFactor - 0.08) / 0.32))
      : 0.0;

    for (const m of meshes) {
      const ud = m.userData;
      const rec = ensureMeshMaterials(m);
      const u = rec.mat.uniforms;
      u.uAlpha.value = ud.alpha;
      u.uDarkFactor.value = darkFactor;
      u.uWireMix.value = wireMix;
      u.uRimColor.value.copy(rimCol);

      const isTrans = ud.alpha < 0.98 || wireMix > 0.02;
      if (rec.mat.transparent !== isTrans) {
        rec.mat.transparent = isTrans;
        rec.mat.depthWrite = !isTrans;
        rec.mat.needsUpdate = true;
      }
      // Render translucent cutaway hulls AFTER opaque internal parts
      m.renderOrder = isTrans ? 10 : 1;

      const showOutline = !ud.noOutline && ud.alpha >= 0.92 && solidAlpha > 0.15;
      if (rec.outlineInk) {
        rec.outlineInk.visible = showOutline;
        rec.outlineInk.material.uniforms.uAlpha.value = showOutline ? solidAlpha * 0.96 : 0;
      }
      if (rec.outlineRim) {
        const showRim = showOutline && rimAlpha > 0.02;
        rec.outlineRim.visible = showRim;
        rec.outlineRim.material.uniforms.uColor.value.copy(rimCol);
        rec.outlineRim.material.uniforms.uAlpha.value = showRim ? solidAlpha * rimAlpha : 0;
      }
    }

    renderer.render(scene, camera);
    return glCanvas;
  }

  return { renderScene, glCanvas, info, renderer };
}
