import { createChibiGeometries, buildChibi } from '../engine/chibi.js';
import { buildLoftGeometry, updateFillColumn } from '../engine/geometry.js';
import { drawLightShafts, drawDriftParticles } from '../engine/effects2d.js';

function lerp(a, b, u) {
  return a + (b - a) * u;
}

function lerpRgb(c0, c1, u) {
  return [
    Math.round(lerp(c0[0], c1[0], u)),
    Math.round(lerp(c0[1], c1[1], u)),
    Math.round(lerp(c0[2], c1[2], u)),
  ];
}

export function setup(api) {
  const {
    THREE, W, H, scene, camera, root, dom,
    addPart, renderSoftware3D, setCallout,
    enforceUpperSubjectFraming, beatMap,
    clamp01, easeOutCubic, easeInOut, getTimings,
  } = api;

  const bgOcean = dom.bg0;
  dom.bg1.style.opacity = '0';
  dom.bg2.style.opacity = '0';
  dom.reticle.setAttribute('opacity', '0');
  dom.flashOverlay.style.opacity = '0';

  // --- 1. Main Submarine Group ---
  const subGroup = new THREE.Group();
  root.add(subGroup);

  // Elongated lofted submarine hull (multi-section smooth teardrop/cigar profile, NOT a straight cylinder)
  const hullSections = [
    { z: -3.42, rx: 0.02, ry: 0.02, cy: 0.00 },
    { z: -3.12, rx: 0.16, ry: 0.16, cy: 0.00 },
    { z: -2.55, rx: 0.34, ry: 0.34, cy: 0.00 },
    { z: -1.85, rx: 0.56, ry: 0.54, cy: 0.00 },
    { z: -1.10, rx: 0.72, ry: 0.68, cy: 0.00 },
    { z:  0.00, rx: 0.76, ry: 0.71, cy: 0.00 },
    { z:  1.15, rx: 0.74, ry: 0.70, cy: 0.00 },
    { z:  2.00, rx: 0.65, ry: 0.62, cy: -0.02 },
    { z:  2.65, rx: 0.46, ry: 0.46, cy: -0.04 },
    { z:  3.08, rx: 0.24, ry: 0.25, cy: -0.06 },
    { z:  3.28, rx: 0.02, ry: 0.02, cy: -0.07 },
  ];
  const hullGeo = buildLoftGeometry(hullSections, 32, { axialSubdiv: 2 });
  const hullOuter = addPart(subGroup, hullGeo, 0x45566e, { smooth: true, depthBias: 0.002 });

  // Clean non-intersecting lower keel skeg fin beneath the hull bottom (no coplanar z-fighting)
  const keelGeo = new THREE.BoxGeometry(0.14, 0.14, 3.1);
  const keelAccent = addPart(subGroup, keelGeo, 0x9b3634);
  keelAccent.position.set(0, -0.74, -0.10);

  // Conning Tower / Sail (streamlined lofted vertical fin)
  const sailGroup = new THREE.Group();
  sailGroup.position.set(0, 0.54, 0.62);
  subGroup.add(sailGroup);

  const sailProfile = [
    { z: -0.78, rx: 0.06, ry: 0.46, cy: 0.46 },
    { z: -0.45, rx: 0.22, ry: 0.48, cy: 0.48 },
    { z:  0.15, rx: 0.25, ry: 0.49, cy: 0.49 },
    { z:  0.65, rx: 0.18, ry: 0.46, cy: 0.46 },
    { z:  0.84, rx: 0.05, ry: 0.41, cy: 0.41 },
  ];
  const sailGeo = buildLoftGeometry(sailProfile, 22, { axialSubdiv: 2 });
  const sailMesh = addPart(sailGroup, sailGeo, 0x334054, { smooth: true });

  // Sail top cap + yellow navigation band + bridge windows + periscope/masts
  const sailCapGeo = new THREE.BoxGeometry(0.42, 0.06, 1.28);
  addPart(sailGroup, sailCapGeo, 0x48566d).position.set(0, 0.94, 0.02);

  const sailWindowGeo = new THREE.BoxGeometry(0.28, 0.10, 0.12);
  addPart(sailGroup, sailWindowGeo, 0x7dd3fc, { unlit: true, depthBias: -0.002 }).position.set(0, 0.78, 0.72);

  const mastGeo = new THREE.CylinderGeometry(0.032, 0.038, 0.68, 12);
  addPart(sailGroup, mastGeo, 0x94a3b8, { smooth: true }).position.set(0, 1.24, 0.22);
  const scopeHeadGeo = new THREE.BoxGeometry(0.08, 0.08, 0.18);
  addPart(sailGroup, scopeHeadGeo, 0xcbd5e1).position.set(0, 1.56, 0.27);
  const scopeLensGeo = new THREE.BoxGeometry(0.06, 0.055, 0.03);
  addPart(sailGroup, scopeLensGeo, 0x38bdf8, { unlit: true, noOutline: true, depthBias: -0.002 }).position.set(0, 1.56, 0.365);

  const snorkelGeo = new THREE.CylinderGeometry(0.026, 0.03, 0.46, 10);
  addPart(sailGroup, snorkelGeo, 0x64748b, { smooth: true }).position.set(0, 1.12, -0.18);

  // Articulated Sail Diving Planes (Sirip di Menara)
  const sailPlanesGroup = new THREE.Group();
  sailPlanesGroup.position.set(0, 0.52, 0.16);
  sailGroup.add(sailPlanesGroup);
  const sailPlaneGeo = new THREE.BoxGeometry(0.74, 0.065, 0.34);
  for (const s of [-1, 1]) {
    addPart(sailPlanesGroup, sailPlaneGeo, 0x52627a).position.set(s * 0.56, 0, 0);
  }
  const sailPlaneAnchor = new THREE.Object3D();
  sailPlaneAnchor.position.set(0.78, 0.54, 0.20);
  sailGroup.add(sailPlaneAnchor);

  // Aft Cruciform Fins & Articulated Stern Hydroplanes (Sirip Belakang)
  const sternGroup = new THREE.Group();
  sternGroup.position.set(0, 0, -2.78);
  subGroup.add(sternGroup);

  const vFinGeo = new THREE.BoxGeometry(0.075, 1.26, 0.56);
  addPart(sternGroup, vFinGeo, 0x45546a).position.set(0, 0, 0);
  const rudderEdgeGeo = new THREE.BoxGeometry(0.082, 1.14, 0.18);
  addPart(sternGroup, rudderEdgeGeo, 0x2c3647).position.set(0, 0, -0.24);

  const sternPlanesGroup = new THREE.Group();
  sternGroup.add(sternPlanesGroup);
  const hFinGeo = new THREE.BoxGeometry(1.48, 0.075, 0.52);
  addPart(sternPlanesGroup, hFinGeo, 0x52627a).position.set(0, 0, 0);
  const sternPlaneAnchor = new THREE.Object3D();
  sternPlaneAnchor.position.set(0.68, 0.04, 0);
  sternGroup.add(sternPlaneAnchor);

  // Aft 5-Blade Brass Propeller
  const propGroup = new THREE.Group();
  propGroup.position.set(0, 0, -3.44);
  subGroup.add(propGroup);

  const propHubGeo = new THREE.ConeGeometry(0.11, 0.28, 14);
  propHubGeo.rotateX(-Math.PI / 2);
  addPart(propGroup, propHubGeo, 0xd4a438, { smooth: true });

  const propBladeGeo = new THREE.BoxGeometry(0.085, 0.34, 0.028);
  for (let i = 0; i < 5; i++) {
    const holder = new THREE.Group();
    holder.rotation.z = (i / 5) * Math.PI * 2;
    const b = addPart(holder, propBladeGeo, 0xe8b948, { outlineStrength: 0.7 });
    b.position.set(0, 0.21, 0);
    b.rotation.y = 0.45;
    propGroup.add(holder);
  }

  // --- 2. Cutaway Internal Ballast Tanks + Animated Water Levels + Top Vent Valves ---
  const cutawayGroup = new THREE.Group();
  subGroup.add(cutawayGroup);

  // Inner dark pressure hull core (center spine between left & right ballast tanks)
  const coreGeo = new THREE.CylinderGeometry(0.32, 0.32, 2.38, 18);
  coreGeo.rotateX(Math.PI / 2);
  addPart(cutawayGroup, coreGeo, 0x2a3342, { smooth: true, depthBias: 0.001 }).position.set(0, 0.0, 0.08);

  // Left & Right Ballast Tanks (translucent outer glass/frame + animated seawater fill + air pressure glow)
  const TANK_BASE_Y = -0.34;
  const TANK_HEIGHT = 0.68;
  const tankFrameGeo = new THREE.BoxGeometry(0.38, TANK_HEIGHT, 2.10);
  const tankFillGeo = new THREE.BoxGeometry(0.33, 1.0, 2.02); // unit height=1 for updateFillColumn!
  const tankAirGeo = new THREE.BoxGeometry(0.32, 0.14, 1.96);
  const ventBaseGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.12, 14);
  const ventCapGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 14);

  const waterFills = [];
  const airBlasts = [];
  const ventCaps = [];
  const tankFrames = [];

  for (const s of [-1, 1]) {
    const tx = s * 0.45;
    const tf = addPart(cutawayGroup, tankFrameGeo, 0xdbeafe, { alpha: 0.28, depthBias: -0.002, excludeFromBounds: true });
    tf.position.set(tx, 0.0, 0.08);
    tankFrames.push(tf);

    const wf = addPart(cutawayGroup, tankFillGeo, 0x22b8cf, { depthBias: -0.004, outlineStrength: 0.65, excludeFromBounds: true });
    wf.position.set(tx, TANK_BASE_Y, 0.08);
    waterFills.push(wf);

    const ab = addPart(cutawayGroup, tankAirGeo, 0xe0f7ff, { unlit: true, noOutline: true, alpha: 0.78, depthBias: -0.006, excludeFromBounds: true });
    ab.position.set(tx, 0.25, 0.08);
    ab.visible = false;
    airBlasts.push(ab);

    // Top Vent Valve assembly on each ballast tank
    addPart(cutawayGroup, ventBaseGeo, 0xf59e0b, { smooth: true, depthBias: -0.004, excludeFromBounds: true }).position.set(tx, 0.40, 0.18);
    const vc = addPart(cutawayGroup, ventCapGeo, 0xef4444, { smooth: true, depthBias: -0.005, excludeFromBounds: true });
    vc.position.set(tx, 0.49, 0.18);
    ventCaps.push(vc);
  }

  // Anchors for callouts
  const tankAnchor = new THREE.Object3D();
  tankAnchor.position.set(-0.54, -0.04, 0.45);
  subGroup.add(tankAnchor);

  const ventAnchor = new THREE.Object3D();
  ventAnchor.position.set(0.45, 0.56, 0.18);
  subGroup.add(ventAnchor);

  const subCenterAnchor = new THREE.Object3D();
  subCenterAnchor.position.set(0, 0.18, 0.10);
  subGroup.add(subCenterAnchor);

  // 3D Rising Bubbles from Vents (Beat 3 Dive) & Bottom Flood Ports (Beat 5 Surface)
  const bubbleGeo = new THREE.IcosahedronGeometry(0.085, 1);
  const bubble3D = [];
  for (let i = 0; i < 16; i++) {
    const b = addPart(subGroup, bubbleGeo, 0xc8f4ff, { unlit: true, noOutline: true, alpha: 0.78, depthBias: -0.008, excludeFromBounds: true });
    b.visible = false;
    bubble3D.push(b);
  }

  // --- 3. Balanced Force Vector Arrows for Beat 4 (APUNG NETRAL: Up Buoyancy vs Down Weight) ---
  const forceGroup = new THREE.Group();
  subGroup.add(forceGroup);
  forceGroup.visible = false;

  const fShaftGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.72, 14);
  const fHeadGeo = new THREE.ConeGeometry(0.22, 0.38, 14);

  // Upward Buoyancy Arrow (Cyan/Emerald, +Y)
  const arrowUp = new THREE.Group();
  arrowUp.position.set(1.18, 0.0, 0.15);
  forceGroup.add(arrowUp);
  addPart(arrowUp, fShaftGeo, 0x22d3ee, { smooth: true, unlit: true, depthBias: -0.006, excludeFromBounds: true }).position.y = 0.38;
  addPart(arrowUp, fHeadGeo, 0x67e8f9, { smooth: true, unlit: true, depthBias: -0.006, excludeFromBounds: true }).position.y = 0.90;

  // Downward Weight Arrow (Coral/Orange, -Y)
  const arrowDown = new THREE.Group();
  arrowDown.position.set(-1.18, 0.0, 0.15);
  forceGroup.add(arrowDown);
  addPart(arrowDown, fShaftGeo, 0xf97316, { smooth: true, unlit: true, depthBias: -0.006, excludeFromBounds: true }).position.y = -0.38;
  const fHeadDown = addPart(arrowDown, fHeadGeo, 0xfb923c, { smooth: true, unlit: true, depthBias: -0.006, excludeFromBounds: true });
  fHeadDown.position.y = -0.90;
  fHeadDown.rotation.z = Math.PI;

  const neutralAnchor = new THREE.Object3D();
  neutralAnchor.position.set(1.18, 0.70, 0.15);
  forceGroup.add(neutralAnchor);

  // --- 4. Opening & Ending Dock/Pier Stage (Dermaga) + 2 Parameterized Chibi Characters ---
  const dockGroup = new THREE.Group();
  root.add(dockGroup);
  const dockMeshes = [];
  function addDockPart(parent, geo, hex, opts = {}) {
    const m = addPart(parent, geo, hex, opts);
    m.userData.baseAlpha = m.userData.alpha;
    dockMeshes.push(m);
    return m;
  }

  const DOCK_Y = -0.18; // pier deck right beside the surfaced submarine waterline
  // Wooden pier deck planks on the viewer-near (+X) side of the submarine
  const plankGeo = new THREE.BoxGeometry(1.75, 0.14, 0.52);
  for (let i = 0; i < 10; i++) {
    const col = (i & 1) ? 0x9c6d44 : 0xb07f52;
    const pl = addDockPart(dockGroup, plankGeo, col, { noSpecular: true, outlineStrength: 0.65 });
    pl.position.set(2.05, DOCK_Y - 0.07, -1.9 + i * 0.56);
  }
  // Pier side stringer beam + short wooden pilings meeting the waterline cleanly above caption zone
  addDockPart(dockGroup, new THREE.BoxGeometry(0.18, 0.20, 5.7), 0x6e4a2e).position.set(1.22, DOCK_Y - 0.16, 0.62);
  const pilingGeo = new THREE.CylinderGeometry(0.14, 0.15, 0.55, 10);
  for (const pz of [-1.8, -0.2, 1.4, 3.0]) {
    addDockPart(dockGroup, pilingGeo, 0x5c3c24, { smooth: true }).position.set(1.28, DOCK_Y - 0.36, pz);
    addDockPart(dockGroup, pilingGeo, 0x5c3c24, { smooth: true }).position.set(2.75, DOCK_Y - 0.36, pz);
  }
  // Iron mooring bollards along pier edge
  const bollardGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.26, 10);
  const bollardCapGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10);
  for (const bz of [-0.9, 1.9]) {
    addDockPart(dockGroup, bollardGeo, 0x2c3442, { smooth: true }).position.set(1.36, DOCK_Y + 0.13, bz);
    addDockPart(dockGroup, bollardCapGeo, 0x1e2530, { smooth: true }).position.set(1.36, DOCK_Y + 0.27, bz);
  }
  // Waterline foam strip hugging the submarine hull & pier edge (no awkward far box edge in frame!)
  const foamGeo = new THREE.BoxGeometry(3.8, 0.05, 6.8);
  const seaSurface = addDockPart(dockGroup, foamGeo, 0x66c7e8, { alpha: 0.34, unlit: true, noOutline: true, depthBias: 0.35 });
  seaSurface.position.set(0.85, -0.48, 0.35);

  // Two parameterized Chibi characters from engine/chibi.js (facing 3/4 toward camera so faces & captain cap shine!)
  // Character A: Submarine Captain (white/navy captain cap + dark navy uniform + gold pocket + clipboard)
  // Character B: Crew Sailor (red knit beanie + yellow maritime foul-weather jacket)
  const chibiGeo = createChibiGeometries();
  const chibis = [
    buildChibi(dockGroup, addDockPart, chibiGeo, {
      x: 1.85, z: 1.15, yaw: 0.28, scale: 1.14, floorY: DOCK_Y,
      uniform: 0x1e3354, uniformDark: 0x13223a, pocketColor: 0xffc61a, beltColor: 0x0f172a, bootColor: 0x141923,
      hatStyle: 'captain', hatColor: 0xf4f6fa, clipboard: true, glasses: false, phase: 0.0,
    }),
    buildChibi(dockGroup, addDockPart, chibiGeo, {
      x: 1.98, z: -0.15, yaw: 0.42, scale: 1.12, floorY: DOCK_Y,
      uniform: 0xe2a829, uniformDark: 0x1d3557, pocketColor: 0xc28518, beltColor: 0x1e293b, bootColor: 0x1f242d,
      hatStyle: 'beanie', hatColor: 0xd9483b, hatAccent: 0xa62c22, clipboard: false, glasses: true, phase: 1.8,
    }),
  ];

  // --- 5. Subject Group Provider for Engine Framing Guard & Verification ---
  function getSubjectGroups() {
    const groups = [subGroup];
    if (dockGroup.visible) {
      chibis.forEach((c) => groups.push(c.g));
    }
    return groups;
  }

  // --- 6. Per-Frame Animation, Ocean Environment, Camera, Callouts & HUD ---
  function render(t) {
    const TIMINGS = getTimings();
    const B = beatMap();

    const tHookS = B.hook?.start ?? 0.18;
    const tHookE = B.hook?.end ?? 4.50;
    const tTanksS = B.tanks?.start ?? 4.78;
    const tTanksE = B.tanks?.end ?? 11.76;
    const tDiveS = B.dive?.start ?? 12.04;
    const tDiveE = B.dive?.end ?? 19.71;
    const tNeutS = B.neutral?.start ?? 19.99;
    const tNeutE = B.neutral?.end ?? 27.84;
    const tSurfS = B.surface?.start ?? 28.12;
    const tSurfE = B.surface?.end ?? 35.45;
    const tHydroS = B.hydroplane?.start ?? 35.73;
    const tHydroE = B.hydroplane?.end ?? 40.89;
    const tOutroS = B.outro?.start ?? 41.17;
    const tOutroE = B.outro?.end ?? 45.08;
    const totalDur = TIMINGS.total_duration || 47.03;

    // Beat 7B: return to dock for punchline ("Dia main timbangan.") + 1.5s hold loop
    const tDockReturn = Math.min(totalDur - 3.3, tOutroS + (tOutroE - tOutroS) * 0.52);
    const inDockEnd = t >= tDockReturn;
    const dockInMix = inDockEnd ? easeInOut((t - tDockReturn) / 0.55) : 0;
    const dockOutMix = easeInOut((t - (tTanksS - 0.45)) / 0.65);
    const dockShow = Math.max(1 - dockOutMix, dockInMix);

    // Dive depth 0 (surface) -> 1 (deep underwater)
    let depth = 0.0;
    if (t < tDiveS) {
      depth = lerp(0.0, 0.15, easeInOut((t - tTanksS) / 1.4));
    } else if (t < tNeutS) {
      depth = lerp(0.15, 0.92, easeInOut((t - tDiveS) / Math.max(1.0, tDiveE - tDiveS)));
    } else if (t < tSurfS) {
      depth = 0.92 + 0.03 * Math.sin(t * 2.0);
    } else if (t < tHydroS) {
      depth = lerp(0.92, 0.12, easeInOut((t - tSurfS) / Math.max(1.0, tSurfE - tSurfS)));
    } else if (t < tOutroS) {
      depth = 0.42 + 0.12 * Math.sin((t - tHydroS) * 1.4);
    } else if (!inDockEnd) {
      depth = lerp(0.38, 0.0, easeInOut((t - tOutroS) / Math.max(0.6, tDockReturn - tOutroS)));
    } else {
      depth = 0.0;
    }

    // Dynamic ocean background gradient (bright blue surface -> deep dark abyss)
    const topC = lerpRgb([46, 134, 193], [8, 42, 74], depth);
    const midC = lerpRgb([20, 88, 138], [5, 24, 52], depth);
    const botC = lerpRgb([10, 44, 82], [2, 10, 24], depth);
    bgOcean.style.background = `linear-gradient(180deg, rgb(${topC}) 0%, rgb(${midC}) 52%, rgb(${botC}) 100%)`;

    // Dock visibility & chibi character acting
    dockGroup.visible = dockShow > 0.02;
    if (dockGroup.visible) {
      for (const dm of dockMeshes) dm.userData.alpha = dm.userData.baseAlpha * dockShow;
      dockGroup.position.y = inDockEnd ? -(1 - dockInMix) * 0.45 : -dockOutMix * 0.55;

      const tHoldStart = totalDur - 1.50;
      chibis.forEach((c, idx) => {
        const ph = c.cfg.phase;
        if (inDockEnd) {
          const cheer = t < tHoldStart ? 5.2 : 1.5;
          const hop = t < tHoldStart ? Math.abs(Math.sin(t * cheer + ph)) * 0.075 : 0.01 * Math.sin(t * 2 + ph);
          c.g.position.set(c.cfg.x, DOCK_Y + hop, c.cfg.z);
          c.head.rotation.set(-0.18 + Math.sin(t * 5 + ph) * 0.10, idx === 0 ? -0.15 : -0.25, Math.sin(t * 2.5 + ph) * 0.06);
          c.mouth.scale.set(1.4, 1.5, 1);
          const armUp = t < tHoldStart ? -2.4 + Math.sin(t * 7 + ph) * 0.2 : -2.2;
          c.arms[0].rotation.set(idx === 0 ? -1.05 : armUp, 0, -0.30);
          c.arms[1].rotation.set(armUp, 0, 0.34);
        } else {
          const bob = Math.abs(Math.sin(t * 3.0 + ph)) * 0.022;
          c.g.position.set(c.cfg.x, DOCK_Y + bob, c.cfg.z);
          c.head.rotation.set(-0.22, Math.sin(t * 2.2 + ph) * 0.18, Math.sin(t * 2.0 + ph) * 0.06);
          c.mouth.scale.set(1.1, 1.15 + 0.35 * Math.abs(Math.sin(t * 4 + ph)), 1);
          if (idx === 0) {
            c.arms[0].rotation.set(-0.95 + Math.sin(t * 2) * 0.06, 0, -0.22);
            c.arms[1].rotation.set(-1.95 + Math.sin(t * 4.5) * 0.12, 0, 0.28);
          } else {
            c.arms[0].rotation.set(-0.35 + Math.sin(t * 3) * 0.15, 0, -0.22);
            c.arms[1].rotation.set(-2.25 + Math.sin(t * 5) * 0.15, 0, 0.32);
          }
        }
      });
    }

    // Cutaway X-ray transparency during Beats 2..5 (tanks, dive, neutral, surface)
    const cutawayIn = easeInOut((t - (tTanksS + 0.2)) / 0.55);
    const cutawayOut = easeInOut((t - (tHydroS - 0.45)) / 0.55);
    const cutawayMix = clamp01(cutawayIn * (1 - cutawayOut));
    hullOuter.userData.alpha = lerp(1.0, 0.22, cutawayMix);
    keelAccent.userData.alpha = lerp(1.0, 0.22, cutawayMix);
    cutawayGroup.visible = cutawayMix > 0.05;

    // Animated Ballast Tank Water Level (0..1) via generic engine updateFillColumn
    let waterLevel = 0.14;
    let ventOpen = 0.0;
    let airBlastOn = false;
    if (t < tDiveS) {
      waterLevel = 0.14 + 0.04 * Math.sin(t * 2.5);
    } else if (t < tNeutS) {
      const p = easeInOut((t - (tDiveS + 0.4)) / Math.max(1.0, tDiveE - tDiveS - 0.8));
      waterLevel = lerp(0.14, 0.88, p);
      ventOpen = clamp01((t - tDiveS) / 0.35) * clamp01((tDiveE - t) / 0.35);
    } else if (t < tSurfS) {
      waterLevel = 0.62 + 0.015 * Math.sin(t * 2.0);
    } else if (t < tHydroS) {
      const p = easeInOut((t - (tSurfS + 0.4)) / Math.max(1.0, tSurfE - tSurfS - 0.8));
      waterLevel = lerp(0.84, 0.12, p);
      airBlastOn = t >= tSurfS + 0.3 && t <= tSurfE - 0.3;
    } else {
      waterLevel = 0.14;
    }

    waterFills.forEach((wf) => updateFillColumn(wf, waterLevel, TANK_BASE_Y, TANK_HEIGHT));
    ventCaps.forEach((vc) => {
      vc.position.y = 0.49 + ventOpen * 0.16;
      vc.rotation.z = ventOpen * 0.35;
    });
    airBlasts.forEach((ab, idx) => {
      ab.visible = airBlastOn && cutawayGroup.visible;
      if (ab.visible) {
        ab.scale.setScalar(0.92 + 0.12 * Math.sin(t * 28 + idx));
      }
    });

    // 3D Bubbles during Dive (from top vents) & Surface (from bottom flood ports)
    const divingBubbles = t >= tDiveS + 0.3 && t <= tDiveE + 0.4;
    const surfacingBubbles = airBlastOn;
    bubble3D.forEach((b, i) => {
      if (divingBubbles || surfacingBubbles) {
        b.visible = true;
        const side = i % 2 === 0 ? 1 : -1;
        const cycle = 1.25;
        const age = ((t * 1.1 + i * (cycle / bubble3D.length)) % cycle) / cycle;
        if (divingBubbles) {
          b.position.set(
            side * (0.45 + Math.sin(t * 5 + i) * 0.10),
            0.52 + age * 1.65,
            0.18 + Math.cos(t * 4 + i * 1.3) * 0.24
          );
        } else {
          b.position.set(
            side * (0.52 + age * 0.48 + Math.sin(t * 6 + i) * 0.08),
            -0.38 - age * 0.35 + age * age * 1.55,
            -0.6 + (i % 6) * 0.28
          );
        }
        b.scale.setScalar((0.55 + (i % 4) * 0.22) * (1 - age * 0.35));
        b.userData.alpha = (1 - age) * 0.78;
      } else {
        b.visible = false;
      }
    });

    // Beat 4 Balanced Buoyancy/Weight Force Arrows
    const showForces = t >= tNeutS + 0.4 && t <= tSurfS - 0.2;
    forceGroup.visible = showForces;
    if (showForces) {
      const fPulse = 1.0 + 0.06 * Math.sin(t * 4.2);
      arrowUp.scale.set(1, fPulse, 1);
      arrowDown.scale.set(1, fPulse, 1);
    }

    // Hydroplane & submarine pitch animation (especially showcased in Beat 6)
    let subPitch = 0;
    let planeTilt = 0;
    if (t >= tDiveS && t < tNeutS) {
      subPitch = 0.10 * Math.sin(clamp01((t - tDiveS) / (tDiveE - tDiveS)) * Math.PI);
      planeTilt = 0.28;
    } else if (t >= tSurfS && t < tHydroS) {
      subPitch = -0.14 * Math.sin(clamp01((t - tSurfS) / (tSurfE - tSurfS)) * Math.PI);
      planeTilt = -0.32;
    } else if (t >= tHydroS && t < tOutroS) {
      const cyc = Math.sin((t - tHydroS) * 2.2);
      planeTilt = cyc * 0.55;
      subPitch = cyc * 0.22;
    }
    subGroup.rotation.x = subPitch;
    subGroup.position.set(0, Math.sin(t * 2.0) * 0.06, 0);
    sailPlanesGroup.rotation.x = planeTilt;
    sternPlanesGroup.rotation.x = -planeTilt * 0.85;

    // Propeller spin (gentle idle at dock, strong forward thrust underwater & Beat 6)
    const propRate = (t >= tHydroS && t < tOutroS) ? 18.0 : (dockShow > 0.5 ? 2.5 : 9.5);
    propGroup.rotation.z = t * propRate;

    // --- 7. Dynamic 7-Beat Camera Choreography (continuous slow zoom/pan, never static >3s) ---
    const camTarget = new THREE.Vector3();
    const setCam = (ang, dist, cy, lx, ly, lz) => {
      camera.position.set(Math.sin(ang) * dist, cy, Math.cos(ang) * dist);
      camTarget.set(lx, ly, lz);
      camera.lookAt(camTarget);
    };

    if (t < tTanksS) {
      // Beat 1: Hook at Pier/Dock + Surfaced Submarine (slow push-in & orbit)
      const p = clamp01(t / Math.max(0.5, tTanksS));
      setCam(0.58 + p * 0.22, 13.4 - p * 1.3, 1.65 + p * 0.25, 0.35, -0.85, 0.35);
    } else if (t < tDiveS) {
      // Beat 2: Cutaway reveal of Left/Right Ballast Tanks + Vent Valves
      const p = clamp01((t - tTanksS) / Math.max(0.5, tDiveS - tTanksS));
      setCam(0.95 + p * 0.45, 11.4 - p * 1.1, 2.35 - p * 0.35, 0.0, -0.70, 0.15);
    } else if (t < tNeutS) {
      // Beat 3: Diving (wide side-3/4 dropping smoothly with rising vent bubbles)
      const p = clamp01((t - tDiveS) / Math.max(0.5, tNeutS - tDiveS));
      setCam(1.38 - p * 0.32, 12.2 - p * 1.2, 2.40 - p * 1.15, 0.0, -0.75, 0.10);
    } else if (t < tSurfS) {
      // Beat 4: Neutral Buoyancy (front-3/4 centered on balanced up/down force arrows)
      const p = clamp01((t - tNeutS) / Math.max(0.5, tSurfS - tNeutS));
      setCam(0.62 - p * 0.42, 12.6 - p * 1.0, 1.35 + p * 0.35, 0.0, -0.75, 0.10);
    } else if (t < tHydroS) {
      // Beat 5: Surfacing (low angle looking upward as compressed air pushes water out)
      const p = clamp01((t - tSurfS) / Math.max(0.5, tHydroS - tSurfS));
      setCam(-0.88 - p * 0.34, 12.0 - p * 1.2, -0.55 + p * 1.45, 0.0, -0.70, 0.10);
    } else if (t < tOutroS) {
      // Beat 6: Hydroplanes macro sweep (highlighting pitching sail planes, stern planes & propeller)
      const p = clamp01((t - tHydroS) / Math.max(0.5, tOutroS - tHydroS));
      setCam(1.92 + p * 0.38, 11.0 - p * 1.1, 1.55 - p * 0.35, 0.0, -0.60, -0.85);
    } else if (!inDockEnd) {
      // Beat 7A: Hero rising surface profile ("bukan menyelam pakai mesin")
      const p = clamp01((t - tOutroS) / Math.max(0.4, tDockReturn - tOutroS));
      setCam(-0.62 + p * 0.30, 12.4 - p * 1.2, 1.05 + p * 0.35, 0.0, -0.80, 0.35);
    } else {
      // Beat 7B: Loop back to Dock with Captain & Crew cheering + 1.5s hold easing to Frame 0!
      const tHoldStart = totalDur - 1.50;
      const pIntro = clamp01((t - tDockReturn) / Math.max(0.4, tHoldStart - tDockReturn));
      const pHold = clamp01((t - tHoldStart) / 1.50);
      const ang = 0.78 * (1 - pHold) + 0.58 * pHold;
      const dist = (13.0 + pIntro * 0.2) * (1 - pHold) + 13.4 * pHold;
      const cy = (1.80 - pIntro * 0.08) * (1 - pHold) + 1.65 * pHold;
      setCam(ang, dist, cy, 0.35, -0.85, 0.35);
    }

    // Engine generic framing guard: subject center <= 45% H & strictly above caption pill
    enforceUpperSubjectFraming(getSubjectGroups(), camTarget);

    // Render 3D with generic 2D ocean atmosphere overlays (light shafts, plankton, bubbles)
    const submergeOverlay = clamp01(1 - dockShow * 0.65);
    renderSoftware3D(0, {
      before3D: (ctx2d, w, h) => {
        drawLightShafts(ctx2d, w, h, {
          t,
          count: 5,
          alpha: lerp(0.18, 0.055, depth) * submergeOverlay,
          colorRgb: '145, 228, 255',
          maxLen: h * lerp(0.76, 0.55, depth),
          tilt: 0.22,
        });
        drawDriftParticles(ctx2d, w, h, {
          t,
          count: 34,
          seed: 401,
          vx: 14,
          vy: -12,
          minR: 1.5,
          maxR: 3.8,
          wobble: 12,
          style: 'dot',
          fillRgb: '165, 240, 220',
          alpha: 0.42 * submergeOverlay,
          yMin: 95,
          yMax: h * 0.65,
        });
      },
      after3D: (ctx2d, w, h) => {
        const bubbleIntensity = (divingBubbles || surfacingBubbles) ? 0.78 : 0.46;
        drawDriftParticles(ctx2d, w, h, {
          t,
          count: (divingBubbles || surfacingBubbles) ? 32 : 18,
          seed: 907,
          vx: 4,
          vy: (divingBubbles || surfacingBubbles) ? -135 : -68,
          minR: 2.8,
          maxR: (divingBubbles || surfacingBubbles) ? 9.5 : 6.8,
          wobble: 10,
          style: 'bubble',
          fillRgb: '215, 246, 255',
          alpha: bubbleIntensity * submergeOverlay,
          yMin: 110,
          yMax: h * 0.64,
        });
      },
    });

    // --- 8. Contextual Callouts per Beat (engine's resolveCalloutLayout guarantees 0 overlaps) ---
    const clearCallouts = () => {
      setCallout('lbl-a', 'line-a', 'dot-a', '', subCenterAnchor, 0, 0, 0);
      setCallout('lbl-b', 'line-b', 'dot-b', '', subCenterAnchor, 0, 0, 0);
      setCallout('lbl-c', 'line-c', 'dot-c', '', subCenterAnchor, 0, 0, 0);
    };

    if (t < tTanksS) {
      clearCallouts();
    } else if (t < tDiveS) {
      const op1 = clamp01((t - (tTanksS + 0.35)) / 0.3) * clamp01((tDiveS - 0.15 - t) / 0.3);
      const op2 = clamp01((t - (tTanksS + 1.25)) / 0.3) * clamp01((tDiveS - 0.15 - t) / 0.3);
      setCallout('lbl-a', 'line-a', 'dot-a', 'TANGKI BALLAST', tankAnchor, -135, -185, op1);
      setCallout('lbl-b', 'line-b', 'dot-b', 'KATUP VENT', ventAnchor, 130, -145, op2);
      setCallout('lbl-c', 'line-c', 'dot-c', '', subCenterAnchor, 0, 0, 0);
    } else if (t < tNeutS) {
      const op = clamp01((t - (tDiveS + 0.3)) / 0.3) * clamp01((tNeutS - 0.15 - t) / 0.3);
      setCallout('lbl-a', 'line-a', 'dot-a', 'KATUP VENT', ventAnchor, 135, -170, op);
      setCallout('lbl-b', 'line-b', 'dot-b', 'TANGKI BALLAST', tankAnchor, -135, 130, op);
      setCallout('lbl-c', 'line-c', 'dot-c', '', subCenterAnchor, 0, 0, 0);
    } else if (t < tSurfS) {
      const op = clamp01((t - (tNeutS + 0.4)) / 0.3) * clamp01((tSurfS - 0.15 - t) / 0.3);
      setCallout('lbl-a', 'line-a', 'dot-a', 'APUNG NETRAL', neutralAnchor, 120, -140, op);
      setCallout('lbl-b', 'line-b', 'dot-b', '', subCenterAnchor, 0, 0, 0);
      setCallout('lbl-c', 'line-c', 'dot-c', '', subCenterAnchor, 0, 0, 0);
    } else if (t < tHydroS) {
      const op = clamp01((t - (tSurfS + 0.35)) / 0.3) * clamp01((tHydroS - 0.15 - t) / 0.3);
      setCallout('lbl-a', 'line-a', 'dot-a', 'UDARA BERTEKANAN', ventAnchor, 120, -175, op);
      setCallout('lbl-b', 'line-b', 'dot-b', 'TANGKI BALLAST', tankAnchor, -125, 135, op);
      setCallout('lbl-c', 'line-c', 'dot-c', '', subCenterAnchor, 0, 0, 0);
    } else if (t < tOutroS) {
      const op = clamp01((t - (tHydroS + 0.3)) / 0.3) * clamp01((tOutroS - 0.15 - t) / 0.3);
      setCallout('lbl-a', 'line-a', 'dot-a', 'SIRIP MENARA', sailPlaneAnchor, -120, -170, op);
      setCallout('lbl-b', 'line-b', 'dot-b', 'SIRIP EKOR', sternPlaneAnchor, 130, -155, op);
      setCallout('lbl-c', 'line-c', 'dot-c', '', subCenterAnchor, 0, 0, 0);
    } else if (inDockEnd) {
      const opPay = clamp01((t - (tDockReturn + 0.35)) / 0.3);
      setCallout('lbl-a', 'line-a', 'dot-a', 'MAIN TIMBANGAN!', subCenterAnchor, -90, -195, opPay);
      setCallout('lbl-b', 'line-b', 'dot-b', '', subCenterAnchor, 0, 0, 0);
      setCallout('lbl-c', 'line-c', 'dot-c', '', subCenterAnchor, 0, 0, 0);
    } else {
      clearCallouts();
    }

    // --- 9. Top HUD Pill per Beat ---
    let pillLabel = 'KAPAL SELAM · PERMUKAAN';
    let dotClass = 'active-cool';
    if (inDockEnd) {
      pillLabel = 'KAPAL SELAM · MAIN TIMBANGAN';
      dotClass = '';
    } else if (t >= tOutroS) {
      pillLabel = 'KAPAL SELAM · MAIN TIMBANGAN';
      dotClass = '';
    } else if (t >= tHydroS) {
      pillLabel = 'KAPAL SELAM · SIRIP KEMUDI';
      dotClass = 'active-cool';
    } else if (t >= tSurfS) {
      pillLabel = 'KAPAL SELAM · MUNCUL';
      dotClass = '';
    } else if (t >= tNeutS) {
      pillLabel = 'KAPAL SELAM · APUNG NETRAL';
      dotClass = 'active-cool';
    } else if (t >= tDiveS) {
      pillLabel = 'KAPAL SELAM · MENYELAM';
      dotClass = 'alert';
    } else if (t >= tTanksS) {
      pillLabel = 'KAPAL SELAM · TANGKI BALLAST';
      dotClass = 'active-cool';
    }
    api.setTopPill(pillLabel, dotClass);
  }

  const hook = {
    kicker: 'RIBUAN TON',
    headline: 'TENGGELAM & MUNCUL SESUKA HATI!',
  };

  return { render, getSubjectGroups, hook };
}
