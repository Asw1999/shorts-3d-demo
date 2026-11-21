import * as THREE from '../vendor/three160.module.min.js';

/**
 * Parameterized 3D chibi character builder shared across scenarios.
 * Supports configurable uniform colors, hats ('hardhat' | 'hair' | 'captain' | 'none'), and clipboard.
 */
export function createChibiGeometries() {
  return {
    leg: new THREE.CylinderGeometry(0.068, 0.062, 0.24, 8),
    boot: new THREE.BoxGeometry(0.12, 0.08, 0.19),
    torso: new THREE.CylinderGeometry(0.165, 0.195, 0.30, 10),
    belt: new THREE.CylinderGeometry(0.199, 0.199, 0.045, 10),
    pocket: new THREE.BoxGeometry(0.08, 0.07, 0.02),
    arm: new THREE.CylinderGeometry(0.05, 0.046, 0.22, 8),
    hand: new THREE.SphereGeometry(0.056, 8, 6),
    skull: new THREE.SphereGeometry(0.28, 16, 12),
    ear: new THREE.SphereGeometry(0.05, 6, 5),
    eye: new THREE.SphereGeometry(0.05, 8, 6).scale(0.78, 1.18, 0.45),
    spark: new THREE.SphereGeometry(0.017, 5, 4),
    lens: new THREE.TorusGeometry(0.074, 0.014, 5, 14),
    bridge: new THREE.BoxGeometry(0.06, 0.02, 0.02),
    blush: new THREE.SphereGeometry(0.05, 8, 6).scale(1.3, 0.6, 0.3),
    mouth: new THREE.SphereGeometry(0.032, 8, 6).scale(1.0, 1.25, 0.4),
    brow: new THREE.BoxGeometry(0.085, 0.018, 0.02),
    hat: new THREE.SphereGeometry(0.30, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    hatBrim: new THREE.CylinderGeometry(0.335, 0.335, 0.03, 14),
    hatRidge: new THREE.BoxGeometry(0.06, 0.05, 0.52),
    hair: new THREE.SphereGeometry(0.292, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.46),
    fringe: new THREE.BoxGeometry(0.30, 0.07, 0.08),
    capCrown: new THREE.CylinderGeometry(0.33, 0.27, 0.14, 16),
    capBand: new THREE.CylinderGeometry(0.275, 0.275, 0.065, 16),
    capVisor: new THREE.BoxGeometry(0.30, 0.026, 0.22),
    capBadge: new THREE.BoxGeometry(0.085, 0.055, 0.02),
    beanie: new THREE.SphereGeometry(0.298, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
    beanieCuff: new THREE.TorusGeometry(0.285, 0.035, 6, 16),
    clipBoard: new THREE.BoxGeometry(0.20, 0.27, 0.018),
    clipPaper: new THREE.BoxGeometry(0.17, 0.22, 0.006),
    clipClip: new THREE.BoxGeometry(0.07, 0.035, 0.024),
    clipLine: new THREE.BoxGeometry(0.12, 0.010, 0.004),
  };
}

export function buildChibi(parent, addPartFn, chibiGeo, cfg) {
  const P = (p, geo, hex, o) => addPartFn(p, geo, hex, o);
  const SKIN = cfg.skin ?? 0xf7cba6;
  const floorY = cfg.floorY ?? -1.18;
  const g = new THREE.Group();
  g.position.set(cfg.x, floorY, cfg.z);
  g.rotation.y = cfg.yaw || 0;
  g.scale.setScalar(cfg.scale ?? 1.18);
  parent.add(g);

  for (const s of [-1, 1]) {
    P(g, chibiGeo.leg, cfg.uniformDark).position.set(s * 0.085, 0.18, 0);
    P(g, chibiGeo.boot, cfg.bootColor ?? 0x3b2b20).position.set(s * 0.085, 0.04, 0.03);
  }
  const body = new THREE.Group();
  body.position.y = 0.29;
  g.add(body);
  P(body, chibiGeo.torso, cfg.uniform).position.y = 0.15;
  P(body, chibiGeo.belt, cfg.beltColor ?? 0x3a3122).position.y = 0.03;
  P(body, chibiGeo.pocket, cfg.pocketColor ?? cfg.uniformDark, { depthBias: -0.002, outlineStrength: 0.6 }).position.set(0.075, 0.2, 0.172);

  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.20, 0.27, 0);
    pivot.rotation.z = s * 0.2;
    body.add(pivot);
    P(pivot, chibiGeo.arm, cfg.uniform).position.y = -0.10;
    P(pivot, chibiGeo.hand, SKIN).position.y = -0.24;
    arms.push(pivot);
  }

  const head = new THREE.Group();
  head.position.y = 0.30;
  body.add(head);
  P(head, chibiGeo.skull, SKIN).position.y = 0.27;
  const showGlasses = cfg.glasses !== false;
  for (const s of [-1, 1]) {
    P(head, chibiGeo.ear, SKIN).position.set(s * 0.275, 0.25, 0);
    P(head, chibiGeo.eye, 0x1b1f2a, { unlit: true, noOutline: true, depthBias: -0.0014 }).position.set(s * 0.10, 0.25, 0.258);
    P(head, chibiGeo.spark, 0xffffff, { unlit: true, noOutline: true, depthBias: -0.0024 }).position.set(s * 0.10 + 0.018, 0.272, 0.283);
    if (showGlasses) {
      P(head, chibiGeo.lens, 0x0e1118, { unlit: true, noOutline: true, depthBias: -0.0028 }).position.set(s * 0.10, 0.25, 0.288);
    }
    P(head, chibiGeo.blush, 0xff8da1, { unlit: true, noOutline: true, depthBias: -0.0014 }).position.set(s * 0.168, 0.175, 0.218);
    const brow = P(head, chibiGeo.brow, cfg.hairColor ?? 0x2a1c14, { unlit: true, noOutline: true, depthBias: -0.0020 });
    brow.position.set(s * 0.10, 0.355, 0.262);
    brow.rotation.z = s * -0.22;
  }
  if (showGlasses) {
    P(head, chibiGeo.bridge, 0x0e1118, { unlit: true, noOutline: true, depthBias: -0.0028 }).position.set(0, 0.262, 0.292);
  }
  const mouth = P(head, chibiGeo.mouth, 0x6b2430, { unlit: true, noOutline: true, depthBias: -0.0018 });
  mouth.position.set(0, 0.150, 0.254);

  const hatStyle = cfg.hatStyle || (cfg.hardHat ? 'hardhat' : 'hair');
  if (hatStyle === 'hardhat') {
    P(head, chibiGeo.hat, cfg.hatColor ?? 0xffc61a).position.y = 0.355;
    P(head, chibiGeo.hatBrim, 0xf0b50c).position.set(0, 0.355, 0.03);
    P(head, chibiGeo.hatRidge, 0xffd84d, { depthBias: -0.0012 }).position.y = 0.64;
  } else if (hatStyle === 'captain') {
    P(head, chibiGeo.capBand, 0x162238).position.set(0, 0.44, 0);
    P(head, chibiGeo.capCrown, cfg.hatColor ?? 0xf4f6fa).position.set(0, 0.54, -0.01);
    const vis = P(head, chibiGeo.capVisor, 0x111827);
    vis.position.set(0, 0.415, 0.24);
    vis.rotation.x = 0.18;
    P(head, chibiGeo.capBadge, 0xffc61a, { unlit: true, depthBias: -0.002 }).position.set(0, 0.495, 0.285);
  } else if (hatStyle === 'beanie') {
    P(head, chibiGeo.beanie, cfg.hatColor ?? 0xd9483b).position.set(0, 0.34, -0.01);
    const cuff = P(head, chibiGeo.beanieCuff, cfg.hatAccent ?? 0xb8352a);
    cuff.position.set(0, 0.38, 0);
    cuff.rotation.x = Math.PI / 2;
  } else if (hatStyle === 'hair') {
    const hair = P(head, chibiGeo.hair, cfg.hairColor ?? 0x2a1c14);
    hair.position.set(0, 0.29, -0.012);
    hair.rotation.x = -0.32;
    const fringe = P(head, chibiGeo.fringe, cfg.hairColor ?? 0x2a1c14, { depthBias: -0.0012 });
    fringe.position.set(0.03, 0.43, 0.20);
    fringe.rotation.set(-0.5, 0, -0.18);
  }

  let clip = null;
  if (cfg.clipboard) {
    clip = new THREE.Group();
    clip.position.set(0, -0.27, 0.08);
    clip.rotation.set(1.05, 0, 0.1);
    arms[0].add(clip);
    P(clip, chibiGeo.clipBoard, 0x9a6a37);
    P(clip, chibiGeo.clipPaper, 0xf7f3e8, { depthBias: -0.0010, outlineStrength: 0.5 }).position.z = 0.012;
    P(clip, chibiGeo.clipClip, 0xc9d1dc, { depthBias: -0.0016 }).position.set(0, 0.125, 0.016);
    for (let k = 0; k < 4; k++) {
      P(clip, chibiGeo.clipLine, 0x3b4a66, { unlit: true, noOutline: true, depthBias: -0.0022 }).position.set(0, 0.06 - k * 0.045, 0.017);
    }
  }

  return { g, body, head, arms, mouth, clip, cfg };
}
