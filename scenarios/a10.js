import { createChibiGeometries, buildChibi } from "../engine/chibi.js";

export function setup(api) {
  const {
    THREE, W, H, scene, camera, root, dom,
    addPart, renderSoftware3D, setCallout,
    enforceUpperSubjectFraming, findWordTime, beatMap,
    clamp01, easeOutCubic, easeInOut, getTimings
  } = api;

  // Configure A-10 background CSS layers (blueprint, sky, hangar)
  const bgBlueprint = dom.bg0;
  const bgSky = dom.bg1;
  const bgHangar = dom.bg2;
  const reticle = dom.reticle;
  const flashOverlay = dom.flashOverlay;
  const pillDot = dom.pillDot;
  const pillText = dom.pillText;

  bgBlueprint.style.backgroundColor = "#0b3a84";
  bgBlueprint.style.backgroundImage = [
    "radial-gradient(circle at 50% 48%, rgba(45, 130, 240, 0.28) 0%, rgba(6, 28, 72, 0.55) 100%)",
    "linear-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(255,255,255,0.10) 1px, transparent 1px)",
    "linear-gradient(rgba(255,255,255,0.20) 2px, transparent 2px)",
    "linear-gradient(90deg, rgba(255,255,255,0.20) 2px, transparent 2px)"
  ].join(", ");
  bgBlueprint.style.backgroundSize = "100% 100%, 24px 24px, 24px 24px, 120px 120px, 120px 120px";

  bgSky.style.background = "radial-gradient(circle at 50% 34%, rgba(114, 146, 210, 0.55) 0%, rgba(56, 70, 120, 0.35) 45%, transparent 75%), linear-gradient(180deg, #12172b 0%, #252e52 46%, #3f4b78 82%, #5e5a78 100%)";
  bgSky.style.opacity = "0";

  bgHangar.style.background = "radial-gradient(ellipse at 50% 22%, rgba(255, 222, 160, 0.60) 0%, rgba(255, 176, 96, 0.16) 42%, transparent 70%), linear-gradient(180deg, #2e211c 0%, #5a3d2c 34%, #94653f 68%, #c08a5a 100%)";
  bgHangar.style.opacity = "1";

    // 1. GAU-8 Avenger Cannon (split rear/front barrels to prevent nose z-fighting when assembled)
    const cannonGroup = new THREE.Group();
    root.add(cannonGroup);

    const barrelSpinner = new THREE.Group();
    cannonGroup.add(barrelSpinner);

    const rearBarrelGroup = new THREE.Group();
    barrelSpinner.add(rearBarrelGroup);
    const frontBarrelGroup = new THREE.Group();
    barrelSpinner.add(frontBarrelGroup);

    const rearBarrelGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.92, 10, 1);
    rearBarrelGeo.rotateX(Math.PI / 2);
    const frontBarrelGeo = new THREE.CylinderGeometry(0.037, 0.037, 1.38, 10, 1);
    frontBarrelGeo.rotateX(Math.PI / 2);
    const boreGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.03, 8);
    boreGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.116;
      const bx = Math.cos(ang) * r;
      const by = Math.sin(ang) * r - 0.04;
      addPart(rearBarrelGroup, rearBarrelGeo, 0x485160, { smooth: true }).position.set(bx, by, 1.04);
      addPart(frontBarrelGroup, frontBarrelGeo, 0x464f5e, { smooth: true }).position.set(bx, by, 2.16);
      addPart(frontBarrelGroup, boreGeo, 0x151820, { unlit: true, noOutline: true, depthBias: -0.002 }).position.set(bx, by, 2.855);
    }

    const clampGeo = new THREE.CylinderGeometry(0.188, 0.188, 0.12, 16);
    clampGeo.rotateX(Math.PI / 2);
    const frontClamp = addPart(frontBarrelGroup, clampGeo, 0xd8e0ec, { smooth: true });
    frontClamp.position.set(0, -0.04, 2.68);
    const midClamp = addPart(frontBarrelGroup, clampGeo, 0x737e90, { smooth: true });
    midClamp.position.set(0, -0.04, 2.04);
    const rearClamp = addPart(rearBarrelGroup, clampGeo, 0x626c7c, { smooth: true });
    rearClamp.position.set(0, -0.04, 1.44);

    // Breach, Ammo Drum & Helical Feed Chute (visible in Beat 1 before airframe encloses)
    const breachGeo = new THREE.CylinderGeometry(0.255, 0.255, 1.12, 20);
    breachGeo.rotateX(Math.PI / 2);
    const breach = addPart(cannonGroup, breachGeo, 0x7d8796, { smooth: true });
    breach.position.set(0, -0.03, 0.24);

    const breachRingGeo = new THREE.CylinderGeometry(0.285, 0.285, 0.12, 20);
    breachRingGeo.rotateX(Math.PI / 2);
    const breachRing = addPart(cannonGroup, breachRingGeo, 0xa8b3c2, { smooth: true });
    breachRing.position.set(0, -0.03, 0.66);

    const drumGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.96, 20);
    drumGeo.rotateX(Math.PI / 2);
    const drum = addPart(cannonGroup, drumGeo, 0x69784e, { smooth: true });
    drum.position.set(0, -0.04, -0.95);

    const drumCapGeo = new THREE.CylinderGeometry(0.495, 0.495, 0.09, 20);
    drumCapGeo.rotateX(Math.PI / 2);
    const drumCapF = addPart(cannonGroup, drumCapGeo, 0x8e99a6, { smooth: true });
    drumCapF.position.set(0, -0.04, -0.49);
    const drumCapR = addPart(cannonGroup, drumCapGeo, 0x8e99a6, { smooth: true });
    drumCapR.position.set(0, -0.04, -1.41);

    const feedGeo = new THREE.BoxGeometry(0.32, 0.25, 0.64);
    const feed = addPart(cannonGroup, feedGeo, 0xd4ad42);
    feed.position.set(0.17, 0.08, -0.34);

    // Centerline laser axis (Beat 3: SUMBU TENGAH)
    const axisCoreGeo = new THREE.CylinderGeometry(0.024, 0.024, 8.2, 8);
    axisCoreGeo.rotateX(Math.PI / 2);
    const centerAxisCore = addPart(root, axisCoreGeo, 0xff3b3b, { unlit: true, noOutline: true });
    centerAxisCore.position.set(0, -0.04, 0.35);
    centerAxisCore.visible = false;

    const axisGlowGeo = new THREE.CylinderGeometry(0.062, 0.062, 8.1, 8);
    axisGlowGeo.rotateX(Math.PI / 2);
    const centerAxisGlow = addPart(root, axisGlowGeo, 0xff5a45, { unlit: true, noOutline: true, alpha: 0.34 });
    centerAxisGlow.position.set(0, -0.04, 0.35);
    centerAxisGlow.visible = false;

    // Beat 3: Bold 3D Recoil Force Vector Arrow + Backward Shock Rings
    const recoilGroup = new THREE.Group();
    root.add(recoilGroup);
    recoilGroup.visible = false;

    const recoilArrowGroup = new THREE.Group();
    recoilArrowGroup.position.set(0.58, 0.02, 1.45);
    recoilGroup.add(recoilArrowGroup);

    const arrowShaftGeo = new THREE.CylinderGeometry(0.065, 0.065, 1.55, 8);
    arrowShaftGeo.rotateX(Math.PI / 2);
    addPart(recoilArrowGroup, arrowShaftGeo, 0xff5028, { unlit: true, depthBias: -0.004 }).position.z = 0.72;

    const arrowBandGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.14, 8);
    arrowBandGeo.rotateX(Math.PI / 2);
    addPart(recoilArrowGroup, arrowBandGeo, 0xffc633, { unlit: true, depthBias: -0.004 }).position.z = 1.25;
    addPart(recoilArrowGroup, arrowBandGeo, 0xffc633, { unlit: true, depthBias: -0.004 }).position.z = 0.72;

    const arrowHeadGeo = new THREE.ConeGeometry(0.20, 0.56, 8);
    arrowHeadGeo.rotateX(-Math.PI / 2); // points straight toward -Z (backward recoil direction!)
    addPart(recoilArrowGroup, arrowHeadGeo, 0xffaa1d, { unlit: true, depthBias: -0.004 }).position.z = -0.25;

    const recoilRings = [];
    const shockRingGeo = new THREE.TorusGeometry(0.42, 0.024, 6, 18);
    for (let i = 0; i < 4; i++) {
      const rg = addPart(recoilGroup, shockRingGeo, 0xffbe55, { unlit: true, noOutline: true, alpha: 0.65 });
      rg.position.set(0, -0.04, 2.2);
      recoilRings.push(rg);
    }

    const cannonAnchor = new THREE.Object3D();
    cannonAnchor.position.set(0, -0.04, 2.45);
    cannonGroup.add(cannonAnchor);

    const drumAnchor = new THREE.Object3D();
    drumAnchor.position.set(0, 0.34, -0.95);
    cannonGroup.add(drumAnchor);

    const recoilAnchor = new THREE.Object3D();
    recoilAnchor.position.set(0.58, 0.08, 1.35);
    recoilGroup.add(recoilAnchor);

    // 2. Muzzle Flash, Tracers, Ejected Brass Casings & Gunsmoke Puffs
    const muzzleGroup = new THREE.Group();
    muzzleGroup.position.set(0, -0.04, 2.86);
    cannonGroup.add(muzzleGroup);

    const flashOuterGeo = new THREE.ConeGeometry(0.38, 1.22, 8);
    flashOuterGeo.rotateX(Math.PI / 2);
    const flashOuter = addPart(muzzleGroup, flashOuterGeo, 0xffaa1d, { unlit: true, noOutline: true, excludeFromBounds: true });
    flashOuter.position.z = 0.56;
    flashOuter.visible = false;

    const flashCoreGeo = new THREE.ConeGeometry(0.20, 0.85, 8);
    flashCoreGeo.rotateX(Math.PI / 2);
    const flashCore = addPart(muzzleGroup, flashCoreGeo, 0xfff085, { unlit: true, noOutline: true, depthBias: -0.004, excludeFromBounds: true });
    flashCore.position.z = 0.38;
    flashCore.visible = false;

    const tracers = [];
    const tracerGeo = new THREE.BoxGeometry(0.065, 0.065, 0.92);
    for (let i = 0; i < 7; i++) {
      const tr = addPart(muzzleGroup, tracerGeo, 0xffbd2e, { unlit: true, noOutline: true, excludeFromBounds: true });
      tr.visible = false;
      tracers.push(tr);
    }

    // Ejected Brass Shell Casings (tumble backward/outward during bursts)
    const shellCasings = [];
    const casingBodyGeo = new THREE.CylinderGeometry(0.030, 0.034, 0.16, 6);
    casingBodyGeo.rotateX(Math.PI / 2);
    const casingTipGeo = new THREE.CylinderGeometry(0.018, 0.030, 0.055, 6);
    casingTipGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const sg = new THREE.Group();
      addPart(sg, casingBodyGeo, 0xf2c130, { outlineStrength: 0.7 });
      const tip = addPart(sg, casingTipGeo, 0xc87424, { outlineStrength: 0.6 });
      tip.position.z = 0.105;
      sg.visible = false;
      root.add(sg);
      shellCasings.push(sg);
    }

    // Gunsmoke Puff Spheres (billow backward from muzzle past cockpit & engine intakes)
    const smokePuffs = [];
    const smokeGeo = new THREE.IcosahedronGeometry(0.18, 1);
    for (let i = 0; i < 14; i++) {
      const sm = addPart(root, smokeGeo, 0xc2c8d6, {
        noOutline: true,
        noSpecular: true,
        alpha: 0.55,
      });
      sm.visible = false;
      smokePuffs.push(sm);
    }

    // 3. A-10 Airframe (sculpted non-z-fighting fuselage + open cockpit bay for pilot & titanium tub!)
    const airframe = new THREE.Group();
    root.add(airframe);

    const fuselageBody = new THREE.Group();
    airframe.add(fuselageBody);

    // Rear main fuselage (smooth high-subdiv cylinder + tapered tail cone + cockpit turtle deck)
    const rearBodyGeo = new THREE.CylinderGeometry(0.45, 0.52, 2.52, 32, 4);
    rearBodyGeo.rotateX(Math.PI / 2);
    addPart(fuselageBody, rearBodyGeo, 0x89929d, { smooth: true }).position.set(0, 0.14, -1.16);

    const tailConeGeo = new THREE.CylinderGeometry(0.18, 0.45, 0.72, 26, 3);
    tailConeGeo.rotateX(Math.PI / 2);
    addPart(fuselageBody, tailConeGeo, 0x7f8894, { smooth: true }).position.set(0, 0.18, -2.74);

    // Lower cockpit belly hull (flat hard-surface bay under titanium tub: z = 0.05 to 1.18)
    const bellyHullGeo = new THREE.BoxGeometry(0.86, 0.48, 1.14);
    const bellyHull = addPart(fuselageBody, bellyHullGeo, 0x7e8792);
    bellyHull.position.set(0, -0.05, 0.62);

    // Left & Right cockpit cheek fairings (turn translucent during Beat 4 cutaway to expose Titanium Tub!)
    const cheekGeo = new THREE.BoxGeometry(0.15, 0.28, 1.06);
    const cheekLeft = addPart(fuselageBody, cheekGeo, 0x8d96a2);
    cheekLeft.position.set(0.37, 0.30, 0.62);
    const cheekRight = addPart(fuselageBody, cheekGeo, 0x8d96a2);
    cheekRight.position.set(-0.37, 0.30, 0.62);

    // Dorsal canopy fairing spine behind cockpit
    const dorsalDeckGeo = new THREE.BoxGeometry(0.40, 0.22, 0.76);
    const dorsalDeck = addPart(fuselageBody, dorsalDeckGeo, 0x828b97);
    dorsalDeck.position.set(0, 0.51, -0.22);
    dorsalDeck.rotation.x = -0.14;

    // Forward Nose Dome (smooth high-subdiv sphere for crisp non-stepped toon bands)
    const noseGeo = new THREE.SphereGeometry(0.47, 28, 22);
    noseGeo.scale(0.96, 0.85, 1.40);
    const nose = addPart(fuselageBody, noseGeo, 0x919aa5, { smooth: true });
    nose.position.set(0, 0.14, 1.34);

    // Lower Chin Gun Shroud / Fairing (smooth >=20 sides)
    const shroudGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.52, 20, 1);
    shroudGeo.rotateX(Math.PI / 2);
    addPart(fuselageBody, shroudGeo, 0x4b5360, { smooth: true }).position.set(0, -0.05, 1.48);

    // Matte Anti-glare Panel flush on nose deck
    const antiGlareGeo = new THREE.BoxGeometry(0.40, 0.05, 0.58);
    const antiGlare = addPart(fuselageBody, antiGlareGeo, 0x262b33, { depthBias: -0.002 });
    antiGlare.position.set(0, 0.46, 1.34);
    antiGlare.rotation.x = 0.24;

    // Iconic A-10 Shark Mouth & Eyes (cleanly offset outside nose flank, zero z-fighting!)
    const mouthSideGeo = new THREE.BoxGeometry(0.04, 0.15, 0.46);
    const teethSideGeo = new THREE.BoxGeometry(0.042, 0.065, 0.36);
    const eyeWhiteGeo = new THREE.SphereGeometry(0.075, 8, 6);
    eyeWhiteGeo.scale(0.4, 0.75, 1.25);
    const eyePupilGeo = new THREE.SphereGeometry(0.042, 6, 5);
    eyePupilGeo.scale(0.4, 0.8, 1.0);
    for (const s of [-1, 1]) {
      const mPlate = addPart(fuselageBody, mouthSideGeo, 0xc8222e, { depthBias: -0.003 });
      mPlate.position.set(s * 0.40, -0.02, 1.44);
      mPlate.rotation.y = s * 0.26;
      mPlate.rotation.z = -s * 0.12;

      const tPlate = addPart(fuselageBody, teethSideGeo, 0xf2f5fa, { unlit: true, noOutline: true, depthBias: -0.004 });
      tPlate.position.set(s * 0.415, -0.01, 1.44);
      tPlate.rotation.y = s * 0.26;

      const ew = addPart(fuselageBody, eyeWhiteGeo, 0xf5f7fb, { unlit: true, depthBias: -0.003 });
      ew.position.set(s * 0.40, 0.22, 1.46);
      ew.rotation.y = s * 0.22;
      const ep = addPart(fuselageBody, eyePupilGeo, 0x161a24, { unlit: true, noOutline: true, depthBias: -0.004 });
      ep.position.set(s * 0.415, 0.22, 1.48);
    }

    // 3A. Simplified 3D Pilot (Clean Head + Helmet + Dark Visor + Simple Seat) inside Titanium Tub
    const pilotGroup = new THREE.Group();
    fuselageBody.add(pilotGroup);

    const seatBackGeo = new THREE.BoxGeometry(0.24, 0.44, 0.08);
    addPart(pilotGroup, seatBackGeo, 0x262c36).position.set(0, 0.48, 0.40);
    const headrestGeo = new THREE.BoxGeometry(0.18, 0.14, 0.09);
    addPart(pilotGroup, headrestGeo, 0x1c2129).position.set(0, 0.74, 0.42);

    const torsoGeo = new THREE.BoxGeometry(0.34, 0.22, 0.20);
    addPart(pilotGroup, torsoGeo, 0x4d5e43).position.set(0, 0.44, 0.57);

    const pilotHeadGeo = new THREE.SphereGeometry(0.148, 16, 16);
    addPart(pilotGroup, pilotHeadGeo, 0xf7cba6, { smooth: true }).position.set(0, 0.67, 0.59);

    const helmetGeo = new THREE.SphereGeometry(0.160, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.58);
    addPart(pilotGroup, helmetGeo, 0xe8edf5, { smooth: true }).position.set(0, 0.68, 0.585);

    const visorGeo = new THREE.CylinderGeometry(0.156, 0.150, 0.088, 16, 1, false, -Math.PI * 0.36, Math.PI * 0.72);
    const visor = addPart(pilotGroup, visorGeo, 0x121722, { smooth: true, depthBias: -0.003 });
    visor.position.set(0, 0.70, 0.605);

    // 3B. Prominent Bubble Canopy Glass over Pilot (smooth >=16 segments)
    const canopyGroup = new THREE.Group();
    fuselageBody.add(canopyGroup);

    const canopyGlassGeo = new THREE.SphereGeometry(0.35, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58);
    canopyGlassGeo.scale(0.92, 1.02, 1.94);
    const canopyGlass = addPart(canopyGroup, canopyGlassGeo, 0x8fd6ff, {
      alpha: 0.36,
      noOutline: true,
      smooth: true,
      depthBias: -0.010,
    });
    canopyGlass.position.set(0, 0.53, 0.62);

    // Canopy dark frame bows (windscreen arch + mid bow + sill rails)
    const bowGeo = new THREE.TorusGeometry(0.305, 0.022, 6, 18, Math.PI);
    const frontBow = addPart(canopyGroup, bowGeo, 0x262c36, { smooth: true, depthBias: -0.012 });
    frontBow.position.set(0, 0.52, 0.98);
    frontBow.rotation.x = 0.42;

    const midBow = addPart(canopyGroup, bowGeo, 0x262c36, { smooth: true, depthBias: -0.012 });
    midBow.position.set(0, 0.54, 0.52);

    const railGeo = new THREE.BoxGeometry(0.036, 0.04, 1.16);
    addPart(canopyGroup, railGeo, 0x2a303b, { depthBias: -0.011 }).position.set(0.285, 0.51, 0.61);
    addPart(canopyGroup, railGeo, 0x2a303b, { depthBias: -0.011 }).position.set(-0.285, 0.51, 0.61);

    // 3C. Armored Titanium Bathtub Cradle (highlighted in Beat 4: BAK TITANIUM 550 KG!)
    const tubGroup = new THREE.Group();
    airframe.add(tubGroup);

    const tubFloorGeo = new THREE.BoxGeometry(0.56, 0.075, 1.06);
    addPart(tubGroup, tubFloorGeo, 0x2cbce8, { depthBias: -0.002 }).position.set(0, 0.21, 0.61);

    const tubSideGeo = new THREE.BoxGeometry(0.075, 0.34, 1.02);
    const tubWallL = addPart(tubGroup, tubSideGeo, 0x45d6ff, { depthBias: -0.003 });
    tubWallL.position.set(0.28, 0.38, 0.61);
    tubWallL.rotation.z = -0.15;

    const tubWallR = addPart(tubGroup, tubSideGeo, 0x45d6ff, { depthBias: -0.003 });
    tubWallR.position.set(-0.28, 0.38, 0.61);
    tubWallR.rotation.z = 0.15;

    const tubFrontGeo = new THREE.BoxGeometry(0.54, 0.30, 0.075);
    const tubFront = addPart(tubGroup, tubFrontGeo, 0x35c8f5, { depthBias: -0.003 });
    tubFront.position.set(0, 0.36, 1.10);
    tubFront.rotation.x = 0.32;

    const tubRearGeo = new THREE.BoxGeometry(0.54, 0.40, 0.075);
    addPart(tubGroup, tubRearGeo, 0x35c8f5, { depthBias: -0.003 }).position.set(0, 0.41, 0.11);

    // Glowing titanium rim highlights along top edge of tub walls
    const tubRimGeo = new THREE.BoxGeometry(0.04, 0.04, 1.04);
    addPart(tubGroup, tubRimGeo, 0x9ef0ff, { unlit: true, noOutline: true, depthBias: -0.004 }).position.set(0.305, 0.545, 0.61);
    addPart(tubGroup, tubRimGeo, 0x9ef0ff, { unlit: true, noOutline: true, depthBias: -0.004 }).position.set(-0.305, 0.545, 0.61);
    tubGroup.visible = false;

    const tubAnchor = new THREE.Object3D();
    tubAnchor.position.set(-0.30, 0.45, 0.65);
    airframe.add(tubAnchor);

    // 3D. Offset Nose Landing Gear (shifted to aircraft's right = -x in model coords)
    const gearGroup = new THREE.Group();
    airframe.add(gearGroup);
    const strutGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8);
    addPart(gearGroup, strutGeo, 0xd8e0ec).position.set(-0.40, -0.45, 1.04);
    const braceGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.48, 6);
    const brace = addPart(gearGroup, braceGeo, 0x9aa4b4);
    brace.position.set(-0.40, -0.35, 0.84);
    brace.rotation.x = 0.65;
    const wheelGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.14, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    addPart(gearGroup, wheelGeo, 0x1a1e26, { smooth: true }).position.set(-0.40, -0.82, 1.04);
    const hubGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.155, 14);
    hubGeo.rotateZ(Math.PI / 2);
    addPart(gearGroup, hubGeo, 0xcfd7e4, { smooth: true }).position.set(-0.40, -0.82, 1.04);
    gearGroup.visible = false;

    const gearAnchor = new THREE.Object3D();
    gearAnchor.position.set(-0.40, -0.82, 1.04);
    gearGroup.add(gearAnchor);

    // 3E. Iconic Thick Tapered Straight Wings, Pylons & Ordnance (flat hard-surface shading)
    function makeTaperedSpanBox(xL, xR, zLE_L, zTE_L, hL, yL, zLE_R, zTE_R, hR, yR) {
      const p = [
        xL, yL + hL * 0.5, zLE_L, // 0: L_LE_top
        xL, yL + hL * 0.5, zTE_L, // 1: L_TE_top
        xL, yL - hL * 0.5, zTE_L, // 2: L_TE_bot
        xL, yL - hL * 0.5, zLE_L, // 3: L_LE_bot
        xR, yR + hR * 0.5, zLE_R, // 4: R_LE_top
        xR, yR + hR * 0.5, zTE_R, // 5: R_TE_top
        xR, yR - hR * 0.5, zTE_R, // 6: R_TE_bot
        xR, yR - hR * 0.5, zLE_R, // 7: R_LE_bot
      ];
      const idx = [
        4, 7, 6, 4, 6, 5, // +X cap
        0, 1, 2, 0, 2, 3, // -X cap
        0, 4, 5, 0, 5, 1, // +Y top
        2, 6, 7, 2, 7, 3, // -Y bot
        3, 7, 4, 3, 4, 0, // +Z leading edge
        1, 5, 6, 1, 6, 2, // -Z trailing edge
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setIndex(idx);
      return g;
    }

    const wingsGroup = new THREE.Group();
    airframe.add(wingsGroup);
    const centerWingGeo = new THREE.BoxGeometry(2.12, 0.175, 1.16);
    addPart(wingsGroup, centerWingGeo, 0x808894).position.set(0, -0.09, -0.34);

    // Tapered left/right outer straight wing panels + drooped wingtip endcaps
    const wingOuterR = makeTaperedSpanBox(1.04, 2.98, 0.24, -0.92, 0.175, -0.09, 0.06, -0.66, 0.110, -0.07);
    const wingOuterL = makeTaperedSpanBox(-2.98, -1.04, 0.06, -0.66, 0.110, -0.07, 0.24, -0.92, 0.175, -0.09);
    addPart(wingsGroup, wingOuterR, 0x808894);
    addPart(wingsGroup, wingOuterL, 0x808894);

    const tipGeo = new THREE.BoxGeometry(0.30, 0.095, 0.72);
    for (const sx of [-1, 1]) {
      const wt = addPart(wingsGroup, tipGeo, 0x767f8c);
      wt.position.set(sx * 3.10, -0.12, -0.32);
      wt.rotation.z = -sx * 0.28;
    }

    const pylonGeo = new THREE.BoxGeometry(0.06, 0.14, 0.56);
    const podGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.88, 12);
    podGeo.rotateX(Math.PI / 2);
    const podNoseGeo = new THREE.SphereGeometry(0.080, 10, 8);
    const podBandGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.09, 12);
    podBandGeo.rotateX(Math.PI / 2);
    for (const sx of [-1.92, -1.28, 1.28, 1.92]) {
      addPart(wingsGroup, pylonGeo, 0x626a75).position.set(sx, -0.18, -0.32);
      addPart(wingsGroup, podGeo, 0x586944, { smooth: true }).position.set(sx, -0.28, -0.28);
      addPart(wingsGroup, podNoseGeo, 0xe8edf5, { smooth: true }).position.set(sx, -0.28, 0.15);
      addPart(wingsGroup, podBandGeo, 0xf2b924, { smooth: true }).position.set(sx, -0.28, 0.02);
    }

    // 3F. Twin H-Tail with Vertical Stabilizers + Horizontal Endplates (flat hard-surface)
    const tailGroup = new THREE.Group();
    airframe.add(tailGroup);
    const hStabGeo = new THREE.BoxGeometry(2.44, 0.105, 0.62);
    addPart(tailGroup, hStabGeo, 0x7e8692).position.set(0, 0.22, -2.74);

    const vStabGeo = new THREE.BoxGeometry(0.105, 0.96, 0.68);
    const rudderTrimGeo = new THREE.BoxGeometry(0.112, 0.62, 0.22);
    const endplateGeo = new THREE.BoxGeometry(0.22, 0.055, 0.74);
    for (const s of [-1, 1]) {
      addPart(tailGroup, vStabGeo, 0x7e8692).position.set(s * 1.20, 0.56, -2.74);
      addPart(tailGroup, rudderTrimGeo, 0x4e5662).position.set(s * 1.20, 0.60, -2.97);
      addPart(tailGroup, endplateGeo, 0x68717d).position.set(s * 1.20, 1.05, -2.74);
      addPart(tailGroup, endplateGeo, 0x68717d).position.set(s * 1.20, 0.08, -2.74);
    }

    // 3G. High-Mounted Twin TF34 Engines on Pylons (>=20 smooth sides + Fan Blades + Igniter Arcs)
    const enginesGroup = new THREE.Group();
    airframe.add(enginesGroup);

    const engBodyGeo = new THREE.CylinderGeometry(0.285, 0.26, 1.42, 28, 3);
    engBodyGeo.rotateX(Math.PI / 2);
    const engLipGeo = new THREE.TorusGeometry(0.245, 0.044, 10, 22);
    const engExhaustGeo = new THREE.CylinderGeometry(0.24, 0.195, 0.28, 20, 1);
    engExhaustGeo.rotateX(Math.PI / 2);
    const engPylonGeo = new THREE.BoxGeometry(0.36, 0.22, 0.86);
    const throatGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.04, 16);
    throatGeo.rotateX(Math.PI / 2);

    const spinnerGeo = new THREE.ConeGeometry(0.070, 0.16, 12);
    spinnerGeo.rotateX(Math.PI / 2);
    const bladeGeo = new THREE.BoxGeometry(0.032, 0.175, 0.016);

    const sparkCoreGeo = new THREE.SphereGeometry(0.11, 8, 6);
    const sparkHaloGeo = new THREE.TorusGeometry(0.17, 0.025, 6, 12);
    const arcSegGeo = new THREE.BoxGeometry(0.024, 0.21, 0.024);

    const fanGroups = [];
    const igniterSparks = [];
    const igniterArcs = [];

    for (const s of [-1, 1]) {
      const ex = s * 0.66;
      const ey = 0.76;

      // Prominent aerodynamic mounting pylon joining upper rear fuselage up to high engine nacelle
      const ep = addPart(enginesGroup, engPylonGeo, 0x737b86);
      ep.position.set(s * 0.44, 0.50, -1.56);
      ep.rotation.z = -s * 0.62;

      // Nacelle cowling (smooth >=20 sides, mounted cleanly above rear fuselage)
      addPart(enginesGroup, engBodyGeo, 0x929aa5, { smooth: true }).position.set(ex, ey, -1.66);
      addPart(enginesGroup, engLipGeo, 0xa8b1bc, { smooth: true }).position.set(ex, ey, -0.90);
      addPart(enginesGroup, engExhaustGeo, 0x353b46, { smooth: true }).position.set(ex, ey, -2.44);
      addPart(enginesGroup, throatGeo, 0x151922, { unlit: true, noOutline: true }).position.set(ex, ey, -0.95);

      // Spinning 3D Fan Hub & 8 Blades
      const fanG = new THREE.Group();
      fanG.position.set(ex, ey, -0.91);
      enginesGroup.add(fanG);

      addPart(fanG, spinnerGeo, 0xdce4f0, { smooth: true, outlineStrength: 0.7 }).position.z = 0.06;
      for (let b = 0; b < 8; b++) {
        const ang = (b / 8) * Math.PI * 2;
        const bladeHolder = new THREE.Group();
        bladeHolder.rotation.z = ang;
        const blade = addPart(bladeHolder, bladeGeo, 0x8794a8, { outlineStrength: 0.55 });
        blade.position.set(0, 0.11, 0.01);
        blade.rotation.y = 0.42;
        fanG.add(bladeHolder);
      }
      fanGroups.push(fanG);

      // Electric Igniter Sparks & Jagged Lightning Arcs (Beat 4, excluded from framing bounds)
      const sp = addPart(enginesGroup, sparkCoreGeo, 0xffaa1d, { unlit: true, noOutline: true, excludeFromBounds: true });
      sp.position.set(ex, ey, -0.82);
      sp.visible = false;
      igniterSparks.push(sp);

      const halo = addPart(enginesGroup, sparkHaloGeo, 0xff7b1a, { unlit: true, noOutline: true, alpha: 0.65, excludeFromBounds: true });
      halo.position.set(ex, ey, -0.83);
      halo.visible = false;
      igniterSparks.push(halo);

      const arcGroup = new THREE.Group();
      arcGroup.position.set(ex, ey, -0.81);
      arcGroup.visible = false;
      enginesGroup.add(arcGroup);
      for (let a = 0; a < 3; a++) {
        const seg = addPart(arcGroup, arcSegGeo, a === 1 ? 0xfff078 : 0xff8a14, { unlit: true, noOutline: true, excludeFromBounds: true });
        seg.position.set((a - 1) * 0.07, 0, 0);
        seg.rotation.z = (a % 2 === 0 ? 0.55 : -0.65);
      }
      igniterArcs.push(arcGroup);
    }

    const engineAnchor = new THREE.Object3D();
    engineAnchor.position.set(0.66, 0.96, -1.42);
    enginesGroup.add(engineAnchor);

    // 4. Stylized Non-Intersecting Clouds (no spiky z-fighting!)
    const cloudsGroup = new THREE.Group();
    scene.add(cloudsGroup);
    const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
    const cloudSeeds = [
      [-4.2, -2.6, -7.2, 1.35],
      [4.4, -2.0, -7.8, 1.55],
      [-3.6, 2.8, -8.5, 1.25],
      [3.8, 3.0, -8.0, 1.30],
      [0.4, -3.4, -9.2, 1.75]
    ];
    for (const [cx, cy, cz, sc] of cloudSeeds) {
      const cg = new THREE.Group();
      cg.position.set(cx, cy, cz);
      const c1 = addPart(cg, cloudGeo, 0xd9deef, { noOutline: true, noSpecular: true });
      c1.scale.set(sc * 1.35, sc * 0.68, sc * 0.72);
      // Offset side puffs cleanly without interpenetrating c1
      const c2 = addPart(cg, cloudGeo, 0xc7cee4, { noOutline: true, noSpecular: true });
      c2.position.set(sc * 1.45, -0.18 * sc, -0.55 * sc);
      c2.scale.set(sc * 0.82, sc * 0.50, sc * 0.56);
      const c3 = addPart(cg, cloudGeo, 0xd0d6ea, { noOutline: true, noSpecular: true });
      c3.position.set(-sc * 1.35, -0.16 * sc, -0.45 * sc);
      c3.scale.set(sc * 0.78, sc * 0.48, sc * 0.52);
      cloudsGroup.add(cg);
    }

    // 5. Beat 1 Warm Hangar Workshop Stage + Expressive Chibi Engineers
    //    (dissolves into the blueprint at "terbalik", before the airframe assembles around the gun)
    const hangarGroup = new THREE.Group();
    root.add(hangarGroup);
    const hangarMeshes = [];
    function addHangarPart(parent, geo, hex, opts = {}) {
      const m = addPart(parent, geo, hex, opts);
      m.userData.baseAlpha = m.userData.alpha;
      hangarMeshes.push(m);
      return m;
    }
    const FLOOR_Y = -1.18;

    // Checker concrete floor (one mesh per tile so near-camera tiles clip individually; always painted first)
    const tileGeo = new THREE.BoxGeometry(1.0, 0.04, 1.0);
    for (let ix = -4; ix <= 5; ix++) {
      for (let iz = -4; iz <= 6; iz++) {
        const tile = addHangarPart(hangarGroup, tileGeo, ((ix + iz) & 1) ? 0xc4956a : 0xd4a87a, {
          noOutline: true, noSpecular: true, depthBias: 0.60,
        });
        tile.position.set(ix + 0.5, FLOOR_Y - 0.02, iz + 0.5);
      }
    }
    // Yellow safety bay stripes around the cannon work area
    const stripeLongGeo = new THREE.BoxGeometry(0.09, 0.012, 5.4);
    const stripeCrossGeo = new THREE.BoxGeometry(2.6, 0.012, 0.09);
    for (const sx of [-1.3, 1.3]) {
      addHangarPart(hangarGroup, stripeLongGeo, 0xffc928, { noOutline: true, noSpecular: true, depthBias: 0.55 })
        .position.set(sx, FLOOR_Y + 0.006, 0.6);
    }
    for (const sz of [-2.1, 3.3]) {
      addHangarPart(hangarGroup, stripeCrossGeo, 0xffc928, { noOutline: true, noSpecular: true, depthBias: 0.55 })
        .position.set(0, FLOOR_Y + 0.006, sz);
    }

    // Corrugated warm hangar walls (back + left) with a glowing clerestory window strip
    const wallPanelGeo = new THREE.BoxGeometry(0.5, 4.6, 0.08);
    const windowGeo = new THREE.BoxGeometry(0.42, 0.55, 0.02);
    const beamGeo = new THREE.BoxGeometry(10.4, 0.22, 0.16);
    for (let i = 0; i < 20; i++) {
      const col = (i & 1) ? 0x9a6446 : 0xae7452;
      const pBack = addHangarPart(hangarGroup, wallPanelGeo, col, { noSpecular: true, depthBias: 0.70, outlineStrength: 0.45 });
      pBack.position.set(-4.0 + 0.25 + i * 0.5, FLOOR_Y + 2.3, -4.0);
      const pLeft = addHangarPart(hangarGroup, wallPanelGeo, col, { noSpecular: true, depthBias: 0.70, outlineStrength: 0.45 });
      pLeft.position.set(-4.0, FLOOR_Y + 2.3, -4.0 + 0.25 + i * 0.5);
      pLeft.rotation.y = Math.PI / 2;
      if (i % 2 === 0) {
        const wB = addHangarPart(hangarGroup, windowGeo, 0xffe6a6, { unlit: true, noOutline: true, depthBias: 0.66 });
        wB.position.set(-4.0 + 0.25 + i * 0.5, FLOOR_Y + 3.55, -3.95);
        const wL = addHangarPart(hangarGroup, windowGeo, 0xffe6a6, { unlit: true, noOutline: true, depthBias: 0.66 });
        wL.position.set(-3.95, FLOOR_Y + 3.55, -4.0 + 0.25 + i * 0.5);
        wL.rotation.y = Math.PI / 2;
      }
    }
    addHangarPart(hangarGroup, beamGeo, 0x5b3a2a, { depthBias: 0.65 }).position.set(1.0, FLOOR_Y + 2.9, -3.9);
    const beamL = addHangarPart(hangarGroup, beamGeo, 0x5b3a2a, { depthBias: 0.65 });
    beamL.position.set(-3.9, FLOOR_Y + 2.9, 1.0);
    beamL.rotation.y = Math.PI / 2;

    // Hanging workshop lamps
    const cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.2, 4);
    const shadeGeo = new THREE.ConeGeometry(0.30, 0.24, 12, 1, true);
    const bulbGeo = new THREE.SphereGeometry(0.10, 8, 6);
    for (const [lx, lz] of [[0.2, -1.2], [0.4, 1.4], [2.4, 0.2]]) {
      const lamp = new THREE.Group();
      lamp.position.set(lx, FLOOR_Y + 3.55, lz);
      hangarGroup.add(lamp);
      addHangarPart(lamp, cordGeo, 0x222222, { noOutline: true }).position.y = 0.7;
      addHangarPart(lamp, shadeGeo, 0x2f5a46, { noCull: true });
      addHangarPart(lamp, bulbGeo, 0xfff1bf, { unlit: true, noOutline: true, depthBias: 0.002 }).position.y = -0.12;
    }

    // Wooden crates + red tool chest
    const crateGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    const crateSlatGeo = new THREE.BoxGeometry(0.64, 0.08, 0.64);
    for (const [cx, cy, cz, ry] of [[-3.2, 0, -3.1, 0.2], [-2.5, 0, -3.25, -0.15], [-2.95, 0.62, -3.15, 0.5]]) {
      const crate = new THREE.Group();
      crate.position.set(cx, FLOOR_Y + 0.31 + cy, cz);
      crate.rotation.y = ry;
      hangarGroup.add(crate);
      addHangarPart(crate, crateGeo, 0xb67d45);
      addHangarPart(crate, crateSlatGeo, 0x8c5a2f, { outlineStrength: 0.6 }).position.y = 0.18;
      addHangarPart(crate, crateSlatGeo, 0x8c5a2f, { outlineStrength: 0.6 }).position.y = -0.18;
    }
    const chest = new THREE.Group();
    chest.position.set(-3.3, FLOOR_Y, 1.6);
    chest.rotation.y = Math.PI / 2;
    hangarGroup.add(chest);
    addHangarPart(chest, new THREE.BoxGeometry(0.9, 0.9, 0.48), 0xd8392f).position.y = 0.47;
    for (let d = 0; d < 3; d++) {
      addHangarPart(chest, new THREE.BoxGeometry(0.30, 0.04, 0.02), 0xe9edf2, { noOutline: true, depthBias: -0.002 })
        .position.set(0, 0.25 + d * 0.27, 0.245);
    }
    const chestWheelGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8);
    chestWheelGeo.rotateZ(Math.PI / 2);
    for (const wx of [-0.36, 0.36]) {
      addHangarPart(chest, chestWheelGeo, 0x1b1e24).position.set(wx, 0.04, 0.12);
    }

    // Drafting table with blueprint sheet + desk lamp
    const draftTable = new THREE.Group();
    draftTable.position.set(-1.75, FLOOR_Y, -1.15);
    draftTable.rotation.y = 0.55;
    hangarGroup.add(draftTable);
    const tLegGeo = new THREE.BoxGeometry(0.06, 0.86, 0.06);
    for (const [lx, lz] of [[-0.5, -0.32], [0.5, -0.32], [-0.5, 0.32], [0.5, 0.32]]) {
      addHangarPart(draftTable, tLegGeo, 0x6b4a33).position.set(lx, 0.43, lz);
    }
    const board = new THREE.Group();
    board.position.set(0, 0.9, 0);
    board.rotation.x = 0.42;
    draftTable.add(board);
    addHangarPart(board, new THREE.BoxGeometry(1.2, 0.05, 0.82), 0xd9b98c);
    addHangarPart(board, new THREE.BoxGeometry(0.98, 0.012, 0.64), 0x2b6fd6, { unlit: true, noOutline: true, depthBias: -0.003 })
      .position.y = 0.032;
    const bpLineGeo = new THREE.BoxGeometry(0.80, 0.006, 0.014);
    for (let k = 0; k < 4; k++) {
      addHangarPart(board, bpLineGeo, 0xcfe6ff, { unlit: true, noOutline: true, depthBias: -0.005 })
        .position.set(0, 0.04, -0.21 + k * 0.14);
    }
    addHangarPart(board, new THREE.CylinderGeometry(0.11, 0.11, 0.008, 12), 0xcfe6ff, { unlit: true, noOutline: true, depthBias: -0.006 })
      .position.set(0.26, 0.042, 0.05);
    const dLampArm = addHangarPart(draftTable, new THREE.CylinderGeometry(0.018, 0.018, 0.55, 5), 0x262a31);
    dLampArm.position.set(0.52, 1.18, -0.30);
    dLampArm.rotation.z = 0.35;
    const dLampHead = addHangarPart(draftTable, new THREE.ConeGeometry(0.11, 0.14, 10, 1, true), 0x2f5a46, { noCull: true });
    dLampHead.position.set(0.40, 1.44, -0.30);
    dLampHead.rotation.z = 0.9;

    // Yellow GAU-8 maintenance stand (A-frame cradles under drum and barrel clamp, rails + casters)
    const STAND_YEL = 0xf5b81c;
    const casterGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10);
    casterGeo.rotateZ(Math.PI / 2);
    function buildCradle(z, topY, width) {
      const h = topY - FLOOR_Y;
      const legGeo = new THREE.BoxGeometry(0.09, h * 1.04, 0.10);
      for (const s of [-1, 1]) {
        const leg = addHangarPart(hangarGroup, legGeo, STAND_YEL);
        leg.position.set(s * width * 0.34, FLOOR_Y + h * 0.5, z);
        leg.rotation.z = s * 0.26;
        addHangarPart(hangarGroup, casterGeo, 0x1b1e24).position.set(s * width * 0.5, FLOOR_Y + 0.07, z);
      }
      addHangarPart(hangarGroup, new THREE.BoxGeometry(width * 0.62, 0.08, 0.11), STAND_YEL)
        .position.set(0, FLOOR_Y + h * 0.42, z);
      addHangarPart(hangarGroup, new THREE.BoxGeometry(width * 0.50, 0.10, 0.24), 0xd99a10)
        .position.set(0, topY - 0.05, z);
      addHangarPart(hangarGroup, new THREE.BoxGeometry(width * 1.08, 0.07, 0.24), 0x2b2f37)
        .position.set(0, FLOOR_Y + 0.15, z);
    }
    buildCradle(-0.95, -0.50, 1.0);
    buildCradle(2.04, -0.22, 0.78);
    const railGeoH = new THREE.BoxGeometry(0.08, 0.07, 3.1);
    for (const s of [-1, 1]) {
      addHangarPart(hangarGroup, railGeoH, STAND_YEL).position.set(s * 0.36, FLOOR_Y + 0.15, 0.55);
    }


  const chibiGeo = createChibiGeometries();
  const chibis = [
    buildChibi(hangarGroup, addHangarPart, chibiGeo, { x: 1.48, z: 0.15, yaw: 0.22, uniform: 0x7f8650, uniformDark: 0x5d6339, hardHat: true, clipboard: true, phase: 0, floorY: FLOOR_Y }),
    buildChibi(hangarGroup, addHangarPart, chibiGeo, { x: 0.90, z: 1.62, yaw: 0.26, uniform: 0x8a8a58, uniformDark: 0x62653f, hardHat: false, clipboard: false, phase: 1.7, floorY: FLOOR_Y }),
  ];

  function getSubjectGroups() {
    const groups = [airframe, cannonGroup];
    if (hangarGroup.visible) chibis.forEach((c) => groups.push(c.g));
    return groups;
  }

  function render(t) {
    const TIMINGS = getTimings();
      const B = beatMap();

      const tHookS = B.hook?.start ?? 0.12;
      const tHookE = B.hook?.end ?? 9.07;
      const hookDur = Math.max(2.0, tHookE - tHookS);

      const tAssemble = B.assemble?.start ?? 9.21;
      const tAssembleEnd = B.assemble?.end ?? 15.45;
      const tRecoil = B.recoil?.start ?? 15.59;
      const tRecoilEnd = B.recoil?.end ?? 22.55;
      const tIgniter = B.igniter_tub?.start ?? 22.69;
      const tIgniterEnd = B.igniter_tub?.end ?? 30.47;
      const tOutro = B.outro?.start ?? 30.61;
      const tOutroEnd = B.outro?.end ?? 34.54;
      const totalDur = TIMINGS.total_duration || tOutroEnd;

      // Dynamic sub-beat cues anchored to spoken words / beat bounds
      const tFlip = Math.min(findWordTime('hook', /kebalik|terbalik/i, tHookS + hookDur * 0.44), tHookS + hookDur * 0.48);
      const tAsmStart = findWordTime('hook', /dirakit|mengelilingi/i, tHookE - 2.35);
      const tPayoffReturn = Math.min(totalDur - 2.35, tOutroEnd + 0.05);
      const inPayoffHangar = t >= tPayoffReturn;
      const payoffMix = inPayoffHangar ? easeInOut((t - tPayoffReturn) / 0.48) : 0;

      // 1. Hangar -> Blueprint -> Sky -> Hangar Payoff Transition
      const hangarFade = easeInOut((t - (tFlip - 0.32)) / 0.72);
      const wireIn = easeInOut((t - (tFlip - 0.28)) / 0.65);
      const wireOut = easeInOut((t - (tAsmStart - 0.55)) / 1.0);
      const wireMix = inPayoffHangar ? 0 : wireIn * (1 - wireOut);
      const skyMixBase = easeInOut((t - (tAsmStart - 0.35)) / 0.95);
      const skyMix = skyMixBase * (1 - payoffMix);
      const hangarShow = Math.max(1 - hangarFade, payoffMix);

      bgSky.style.opacity = skyMix.toFixed(3);
      bgHangar.style.opacity = hangarShow.toFixed(3);
      reticle.setAttribute('opacity', (!inPayoffHangar ? hangarFade * (1 - skyMix) * 0.55 : 0).toFixed(3));
      reticle.setAttribute('transform', `rotate(${(t * 18).toFixed(1)} 360 600)`);

      cloudsGroup.visible = skyMix > 0.05;
      cloudsGroup.position.z = ((t * 1.45) % 6.5) - 1.2;

      // 1b. Hangar stage + chibi engineer acting (Beat 1A-1B shock/disbelief + Beat 5B payoff cheering!)
      hangarGroup.visible = hangarShow > 0.01;
      if (hangarGroup.visible) {
        for (const hm of hangarMeshes) hm.userData.alpha = hm.userData.baseAlpha * hangarShow;
        hangarGroup.position.y = inPayoffHangar ? -(1 - payoffMix) * 0.45 : -hangarFade * 0.55;

        const win = (a, b) => clamp01((t - a) / 0.25) * clamp01((b - t) / 0.25);
        chibis.forEach((c, idx) => {
          const ph = c.cfg.phase;
          if (inPayoffHangar) {
            // Beat 5B Payoff: Chibi engineers cheer & nod proudly next to the completed Warthog!
            const tHoldStart = totalDur - 1.50;
            const cheerRate = t < tHoldStart ? 5.2 : 1.4;
            const hop = t < tHoldStart ? Math.abs(Math.sin(t * cheerRate + ph)) * 0.085 : 0.012 * Math.sin(t * 2.0 + ph);
            // Step chibis forward of the underwing rocket pod (z=0.15) so celebratory hands never clip the wing
            c.g.position.set(
              idx === 0 ? 1.62 : 0.88,
              FLOOR_Y + hop,
              idx === 0 ? 0.78 : 1.82
            );
            const nod = t < tHoldStart ? Math.sin(t * 6.5 + ph) * 0.14 : -0.10;
            c.head.rotation.set(-0.22 + nod, idx === 0 ? -0.35 : -0.18, Math.sin(t * 2.5 + ph) * 0.07);
            c.body.rotation.set(0, 0, Math.sin(t * 3.0 + ph) * 0.04);
            c.mouth.scale.set(1.45, 1.55, 1);
            // Both raise arms in amazed celebration; then settle cleanly for 1.5s hold
            const armLift = t < tHoldStart ? -2.45 + Math.sin(t * 7.5 + ph) * 0.22 : -2.25;
            c.arms[0].rotation.set(idx === 0 ? -1.15 : armLift, 0, -0.32);
            c.arms[1].rotation.set(armLift, 0, 0.36);
          } else {
            const hop = Math.abs(Math.sin(t * 3.4 + ph)) * 0.028;
            c.g.position.set(c.cfg.x, FLOOR_Y + hop, c.cfg.z);
            const shakeEnv = idx === 0
              ? Math.max(win(1.15, 2.75), win(3.55, tFlip + 0.2))
              : Math.max(win(2.2, 3.6), win(3.8, tFlip + 0.4));
            const lookUp = idx === 0 ? 0.5 + 0.5 * win(0.4, 3.6) : 0.68;
            const shake = Math.sin(t * 10.5 + ph) * 0.42 * shakeEnv;
            const baseYaw = idx === 0 ? -0.55 : -0.25;
            c.head.rotation.set(-0.38 * lookUp, baseYaw * (1 - shakeEnv * 0.5) + shake, Math.sin(t * 2.3 + ph) * 0.10 + 0.12 * shakeEnv);
            c.body.rotation.set(-0.10 * lookUp, 0, Math.sin(t * 3.4 + ph) * 0.035);
            const mOpen = 1 + shakeEnv * 0.9;
            c.mouth.scale.set(1 + shakeEnv * 0.2, mOpen, 1);
            if (idx === 0) {
              c.arms[0].rotation.set(-0.95 + Math.sin(t * 2.0) * 0.06, 0, -0.25);
              c.arms[1].rotation.set(-2.5 * shakeEnv - 0.1, 0, 0.2 + 0.25 * shakeEnv);
            } else {
              const point = win(0.5, 2.35);
              const handsUp = win(2.35, tFlip + 0.3);
              c.arms[1].rotation.set(-2.35 * point - 2.6 * handsUp + Math.sin(t * 6) * 0.06 * point, 0, 0.2 + 0.35 * handsUp);
              c.arms[0].rotation.set(-2.6 * handsUp - 0.1, 0, -0.2 - 0.35 * handsUp);
            }
          }
        });
      }

      // 1c. Blueprint Exploded Split View in Beat 1C (tFlip .. tAsmStart)
      const explodeMix = (t >= tFlip && t < tAsmStart)
        ? clamp01((t - tFlip) / 0.55) * clamp01((tAsmStart - t) / 0.45)
        : 0;
      frontBarrelGroup.position.z = explodeMix * 0.72;
      rearBarrelGroup.position.z = -explodeMix * 0.15;
      drum.position.z = -0.95 - explodeMix * 0.65;
      drumCapF.position.z = -0.49 - explodeMix * 0.65;
      drumCapR.position.z = -1.41 - explodeMix * 0.65;
      feed.position.y = 0.08 + explodeMix * 0.42;

      // 2. Airframe Assembly (and keep assembled in Beat 5B Payoff)
      const bodyEase = easeOutCubic((t - tAsmStart) / 0.85);
      const wingEase = easeOutCubic((t - (tAsmStart + 0.35)) / 0.75);
      const tailEase = easeOutCubic((t - (tAsmStart + 0.65)) / 0.70);
      const engEase = easeOutCubic((t - (tAsmStart + 0.95)) / 0.68);

      fuselageBody.visible = bodyEase > 0.01;
      fuselageBody.position.set(0, fuselageBody.visible ? (1 - bodyEase) * 3.0 : 0, fuselageBody.visible ? -(1 - bodyEase) * 3.8 : 0);

      wingsGroup.visible = wingEase > 0.01;
      wingsGroup.scale.set(0.25 + 0.75 * wingEase, 1, 1);
      wingsGroup.position.set(0, wingsGroup.visible ? (1 - wingEase) * 1.45 : 0, 0);

      tailGroup.visible = tailEase > 0.01;
      tailGroup.position.set(0, 0, tailGroup.visible ? -(1 - tailEase) * 2.8 : 0);

      enginesGroup.visible = engEase > 0.01;
      enginesGroup.position.set(0, enginesGroup.visible ? (1 - engEase) * 2.6 : 0, 0);

      const insideHull = bodyEase > 0.78;
      rearBarrelGroup.visible = !insideHull;
      breach.visible = !insideHull;
      breachRing.visible = !insideHull;
      drum.visible = !insideHull;
      drumCapF.visible = !insideHull;
      drumCapR.visible = !insideHull;
      feed.visible = !insideHull;

      // 3. Beat-Specific Highlights
      const inRecoilBeat = t >= tRecoil + 0.15 && t <= tIgniter - 0.10;
      centerAxisCore.visible = t >= tRecoil + 0.35 && t <= tIgniter - 0.10;
      centerAxisGlow.visible = centerAxisCore.visible;

      recoilGroup.visible = inRecoilBeat;
      if (inRecoilBeat) {
        const pulseKick = Math.pow(1 - ((t * 1.65) % 1), 2);
        recoilArrowGroup.position.set(0.58, 0.02, 1.50 - pulseKick * 0.35);
        recoilRings.forEach((rg, idx) => {
          const phase = ((t * 1.6 + idx * 0.25) % 1);
          rg.position.set(0, -0.04, 2.85 - phase * 3.35);
          rg.scale.setScalar(0.68 + phase * 1.55);
          rg.userData.alpha = (1 - phase) * 0.72;
        });
      }

      const gearPop = t >= tRecoil + 1.35 && t <= tIgniter + 0.15
        ? easeOutCubic((t - (tRecoil + 1.35)) / 0.55)
        : 0;
      gearGroup.visible = gearPop > 0.02;
      gearGroup.position.y = (1 - gearPop) * 0.45;

      const igniterMid = (tIgniter + tIgniterEnd) * 0.5;
      const showTub = t >= Math.min(tIgniter + 3.2, igniterMid - 0.65) && t <= tOutro + 0.15;
      tubGroup.visible = showTub;
      if (showTub) {
        const pulseScale = 1.0 + 0.028 * Math.sin(t * 12);
        tubGroup.scale.setScalar(pulseScale);
        cheekLeft.userData.alpha = 0.20;
        cheekRight.userData.alpha = 0.20;
        canopyGlass.userData.alpha = 0.18;
      } else {
        cheekLeft.userData.alpha = 1.0;
        cheekRight.userData.alpha = 1.0;
        canopyGlass.userData.alpha = 0.36;
      }

      // 4. 12-Beat Dynamic Camera Choreography (subject kept upper <=45% centerY, above ~69% caption band!)
      const camTarget = new THREE.Vector3();
      const setCam = (ang, dist, cy, lx, ly, lz) => {
        camera.position.set(Math.sin(ang) * dist, cy, Math.cos(ang) * dist);
        camTarget.set(lx, ly, lz);
        camera.lookAt(camTarget);
      };
      const tH1 = tHookS + 3.0;
      const tAsmMid = tAssemble + (tRecoil - tAssemble) * 0.44;
      const tRec1 = tRecoil + (tIgniter - tRecoil) * 0.35;
      const tRec2 = tRecoil + (tIgniter - tRecoil) * 0.68;
      const tIgMid = tIgniter + (tOutro - tIgniter) * 0.50;

      if (t < tH1) {
        // Beat 1A: Hangar Wide Establish + slow push-in
        const p = clamp01(t / Math.max(0.5, tH1));
        setCam(0.52 + p * 0.16, 12.6 - p * 1.2, 0.90 + p * 0.20, 0.10, -1.15, 0.72);
      } else if (t < tFlip) {
        // Beat 1B: Close-up 3/4 Chibi Reaction & Cannon Breach
        const p = clamp01((t - tH1) / Math.max(0.4, tFlip - tH1));
        setCam(-0.42 + p * 0.22, 10.6 - p * 0.9, 0.65 + p * 0.15, 0.55, -1.25, 0.95);
      } else if (t < tAsmStart) {
        // Beat 1C: Blueprint Exploded Split View orbit
        const p = clamp01((t - tFlip) / Math.max(0.4, tAsmStart - tFlip));
        setCam(0.65 + p * 0.42, 10.6 - p * 1.0, 1.55 + p * 0.30, 0.0, -0.75, 0.20);
      } else if (t < tAssemble) {
        // Beat 1D: Airframe Assembly pull-back
        const p = clamp01((t - tAsmStart) / Math.max(0.4, tAssemble - tAsmStart));
        setCam(1.15 - p * 0.25, 11.8 + p * 2.0, 1.90 + p * 0.40, 0.0, -0.85, -0.05);
      } else if (t < tAsmMid) {
        // Beat 2A: Hero Side-3/4 Flight Sweep
        const p = clamp01((t - tAssemble) / Math.max(0.4, tAsmMid - tAssemble));
        setCam(1.26 - p * 0.42, 14.0 - p * 1.5, 2.30 - p * 0.30, 0.0, -0.85, 0.05);
      } else if (t < tRecoil) {
        // Beat 2B: Macro Zoom on 7-Barrel Muzzle & Shark Nose + First Firing Burst
        const p = clamp01((t - tAsmMid) / Math.max(0.4, tRecoil - tAsmMid));
        setCam(-0.48 + p * 0.26, 9.8 - p * 1.0, 0.75 - p * 0.25, 0.0, -0.75, 1.45);
      } else if (t < tRec1) {
        // Beat 3A: Side-Profile Recoil Force Vector Shot
        const p = clamp01((t - tRecoil) / Math.max(0.4, tRec1 - tRecoil));
        setCam(1.48 - p * 0.22, 14.2 - p * 1.4, 1.40 - p * 0.30, 0.0, -0.85, 0.25);
      } else if (t < tRec2) {
        // Beat 3B: High Top-Down Dorsal Alignment View (Centerline Laser!)
        const p = clamp01((t - tRec1) / Math.max(0.4, tRec2 - tRec1));
        setCam(0.20 - p * 0.34, 11.8 - p * 1.2, 9.6 - p * 1.2, 0.0, -0.80, -0.95);
      } else if (t < tIgniter) {
        // Beat 3C: Low Worm's-Eye Macro Zoom on Offset Nose Gear
        const p = clamp01((t - tRec2) / Math.max(0.4, tIgniter - tRec2));
        setCam(0.32 - p * 0.42, 10.2 - p * 1.1, -1.35 + p * 0.45, -0.15, -1.05, 0.90);
      } else if (t < tIgMid) {
        // Beat 4A: Twin Engine Intake Macro Zoom & Electric Igniter Arcs
        const p = clamp01((t - tIgniter) / Math.max(0.4, tIgMid - tIgniter));
        setCam(0.62 - p * 0.26, 10.2 - p * 1.1, 2.05 - p * 0.35, 0.0, -0.35, -0.95);
      } else if (t < tOutro) {
        // Beat 4B: Cockpit X-Ray Cutaway — Chibi Pilot in 550 kg Titanium Bathtub
        const p = clamp01((t - tIgMid) / Math.max(0.4, tOutro - tIgMid));
        setCam(0.98 - p * 0.32, 9.6 - p * 1.0, 1.75 - p * 0.35, 0.0, -0.55, 0.55);
      } else if (!inPayoffHangar) {
        // Beat 5A: Hero Low-Angle Full-Auto Strafe Run
        const p = clamp01((t - tOutro) / Math.max(0.4, tPayoffReturn - tOutro));
        setCam(-0.55 + p * 0.28, 12.6 - p * 1.4, 0.45 + p * 0.35, 0.0, -0.85, 0.55);
      } else {
        // Beat 5B: Chibi Payoff Return in Hangar + 1.5s Hold & Seamless Loop Back Toward Frame 0!
        const tHoldStart = totalDur - 1.50;
        const pIntro = clamp01((t - tPayoffReturn) / Math.max(0.4, tHoldStart - tPayoffReturn));
        const pHold = clamp01((t - tHoldStart) / 1.50);
        // Glide cleanly back toward Frame 0's (ang=0.52, dist=12.6, cy=0.90) during hold!
        const ang = 0.72 * (1 - pHold) + 0.52 * pHold;
        const dist = (13.2 + pIntro * 0.2) * (1 - pHold) + 12.6 * pHold;
        const cy = (1.10 - pIntro * 0.10) * (1 - pHold) + 0.90 * pHold;
        setCam(ang, dist, cy, 0.10, -1.15, 0.72);
      }

      // 5. Firing Windows (matches make_audio.py!), Spinning Fans, Igniters, Casings & Smoke
      const b1 = t >= tAssembleEnd - 1.5 && t <= tAssembleEnd - 0.15;
      const b2 = t >= tIgniter + 2.2 && t <= tIgniter + 3.6;
      const b3 = t >= tOutro + 0.45 && t <= Math.min(totalDur - 1.85, tOutroEnd + 0.25);
      const isFiring = (b1 || b2 || b3) && !inPayoffHangar;

      barrelSpinner.rotation.z = isFiring ? t * 24.0 : t * 1.8;
      const fanSpeed = isFiring ? 22.0 : 14.5;
      fanGroups.forEach((fg, idx) => {
        fg.rotation.z = t * fanSpeed * (idx === 0 ? 1 : -1);
      });

      // Igniter electric arcs/sparks active during Beat 4 igniter phase + midpoint (smooth modulation, no high-freq strobe)
      const igniterOn = t >= tIgniter + 0.85 && t <= Math.max(tIgniter + 4.9, igniterMid + 0.95);
      igniterSparks.forEach((sp, idx) => {
        sp.visible = igniterOn;
        if (sp.visible) sp.scale.setScalar(0.95 + 0.25 * Math.sin(t * 10 + idx));
      });
      igniterArcs.forEach((ag, idx) => {
        ag.visible = igniterOn;
        if (ag.visible) {
          ag.rotation.z = t * (idx === 0 ? 7.5 : -8.5);
          ag.scale.setScalar(0.92 + 0.22 * Math.sin(t * 9 + idx));
        }
      });

      if (isFiring) {
        // Smooth damped recoil & muzzle glow (low-freq 10 rad/s, zero frame-alternating strobe jitter)
        const pulse = 0.5 + 0.5 * Math.sin(t * 14);
        const recoilKick = -0.095 - 0.035 * pulse;
        root.position.set(0, Math.sin(t * 2.1) * 0.045, recoilKick);
        flashOuter.visible = true;
        flashOuter.scale.setScalar(0.92 + 0.24 * pulse);
        flashOuter.rotation.z = t * 9.5;
        flashCore.visible = true;
        flashCore.scale.setScalar(0.84 + 0.26 * pulse);
        flashCore.rotation.z = -t * 11.0;
        flashOverlay.style.opacity = (0.24 + 0.22 * pulse).toFixed(2);

        tracers.forEach((tr, i) => {
          tr.visible = true;
          const zProg = 0.25 + ((t * 14 + i * 0.95) % 2.8);
          tr.position.set((i % 2 === 0 ? 0.05 : -0.05), ((i % 3) - 1) * 0.035, zProg);
        });
      } else {
        root.position.set(0, Math.sin(t * 2.1) * 0.055, 0);
        flashOuter.visible = false;
        flashCore.visible = false;
        flashOverlay.style.opacity = '0';
        tracers.forEach((tr) => { tr.visible = false; });
      }

      // Ejected Brass Shell Casings + Smoke Puff Spheres (active during bursts + 0.85s drift tail)
      const activeBurstWindow = (bs, be) => (t >= bs && t <= be + 0.85 ? { bs, be } : null);
      const curBurst = !inPayoffHangar && (activeBurstWindow(tAssembleEnd - 1.5, tAssembleEnd - 0.15)
        || activeBurstWindow(tIgniter + 2.2, tIgniter + 3.6)
        || activeBurstWindow(tOutro + 0.45, Math.min(totalDur - 1.85, tOutroEnd + 0.25)));

      if (curBurst) {
        const { bs, be } = curBurst;
        shellCasings.forEach((sg, i) => {
          const cycle = 0.68;
          const rawAge = (t - bs + i * (cycle / shellCasings.length)) % cycle;
          const spawnTime = t - rawAge;
          if (spawnTime >= bs - 0.05 && spawnTime <= be && rawAge >= 0) {
            sg.visible = true;
            const side = i % 2 === 0 ? 1 : -1;
            const spread = 0.65 + (i % 5) * 0.18;
            sg.position.set(
              side * (0.28 + rawAge * 1.45 * spread),
              -0.22 + rawAge * 0.55 - 2.65 * rawAge * rawAge,
              1.32 - rawAge * 4.4
            );
            sg.rotation.set(t * 14 + i, t * 11 + i * 0.7, t * 17);
          } else {
            sg.visible = false;
          }
        });

        smokePuffs.forEach((sm, i) => {
          const cycle = 0.92;
          const rawAge = (t - bs + i * (cycle / smokePuffs.length)) % cycle;
          const spawnTime = t - rawAge;
          if (spawnTime >= bs - 0.05 && spawnTime <= be && rawAge >= 0) {
            sm.visible = true;
            const p = rawAge / cycle;
            const side = i % 2 === 0 ? 1 : -1;
            sm.position.set(
              side * (0.08 + p * 0.68 * ((i % 3) * 0.4 + 0.5)),
              -0.02 + p * 0.82 + Math.sin(i * 2.1 + t * 5) * 0.08,
              2.85 - p * 4.65
            );
            sm.scale.setScalar(0.55 + p * 1.65);
            sm.userData.alpha = (1 - p) * 0.62;
          } else {
            sm.visible = false;
          }
        });
      } else {
        shellCasings.forEach((sg) => { sg.visible = false; });
        smokePuffs.forEach((sm) => { sm.visible = false; });
      }

    enforceUpperSubjectFraming(getSubjectGroups(), camTarget);
    renderSoftware3D(wireMix);

      // 6. Contextual Callouts per Beat (clamped cleanly inside frame!)
      if (t < tAssemble + 4.2) {
        const op1 = t >= 1.8 && t <= tAssemble + 3.6
          ? clamp01((t - 1.8) / 0.3) * clamp01((tAssemble + 3.6 - t) / 0.3)
          : 0;
        const op2 = t >= 2.8 && t <= tAsmStart + 0.4
          ? clamp01((t - 2.8) / 0.3) * clamp01((tAsmStart + 0.4 - t) / 0.3)
          : 0;
        const op3 = t >= tAssemble + 0.3 && t <= tAssemble + 4.2
          ? clamp01((t - (tAssemble + 0.3)) / 0.3) * clamp01((tAssemble + 4.2 - t) / 0.3)
          : 0;
        setCallout('lbl-a', 'line-a', 'dot-a', 'MERIAM 30MM', cannonAnchor, -95, -175, op1);
        setCallout('lbl-b', 'line-b', 'dot-b', 'DRUM PELURU', drumAnchor, 110, -185, op2);
        setCallout('lbl-c', 'line-c', 'dot-c', '3.900 PELURU/MENIT', engineAnchor, 85, -170, op3);
      } else if (t < tIgniter) {
        const opAxis = clamp01((t - (tRecoil + 0.55)) / 0.3) * clamp01((tIgniter - 0.2 - t) / 0.3);
        const opGear = clamp01((t - (tRecoil + 1.55)) / 0.3) * clamp01((tIgniter - 0.2 - t) / 0.3);
        const opVec = clamp01((t - (tRecoil + 0.45)) / 0.3) * clamp01((tIgniter - 0.2 - t) / 0.3);
        setCallout('lbl-a', 'line-a', 'dot-a', 'SUMBU TENGAH', cannonAnchor, -125, -265, opAxis);
        setCallout('lbl-b', 'line-b', 'dot-b', 'RODA DIGESER', gearAnchor, -90, 120, opGear);
        setCallout('lbl-c', 'line-c', 'dot-c', 'REKOIL 45 kN', recoilAnchor, 175, -115, opVec);
      } else if (t < tOutro) {
        const opIg = clamp01((t - (tIgniter + 0.9)) / 0.3) * clamp01((Math.max(tIgniter + 4.8, igniterMid + 0.9) - t) / 0.3);
        const opTub = clamp01((t - Math.min(tIgniter + 3.05, igniterMid - 0.8)) / 0.3) * clamp01((tOutro - 0.1 - t) / 0.3);
        setCallout('lbl-a', 'line-a', 'dot-a', 'PEMANTIK OTOMATIS', engineAnchor, 110, -165, opIg);
        setCallout('lbl-b', 'line-b', 'dot-b', 'BAK TITANIUM 550 KG', tubAnchor, -125, -185, opTub);
        setCallout('lbl-c', 'line-c', 'dot-c', '', engineAnchor, 0, 0, 0);
      } else if (!inPayoffHangar) {
        setCallout('lbl-a', 'line-a', 'dot-a', '', cannonAnchor, 0, 0, 0);
        setCallout('lbl-b', 'line-b', 'dot-b', '', drumAnchor, 0, 0, 0);
        setCallout('lbl-c', 'line-c', 'dot-c', '', engineAnchor, 0, 0, 0);
      } else {
        const opPay = clamp01((t - (tPayoffReturn + 0.35)) / 0.30);
        setCallout('lbl-a', 'line-a', 'dot-a', 'MERIAM BERSAYAP!', cannonAnchor, -65, -220, opPay);
        setCallout('lbl-b', 'line-b', 'dot-b', '', drumAnchor, 0, 0, 0);
        setCallout('lbl-c', 'line-c', 'dot-c', '', engineAnchor, 0, 0, 0);
      }

      // 7. Top pill badge update (changes per beat / payoff end card)
      let pillLabel = 'A-10 WARTHOG · GAU-8 AVENGER';
      if (inPayoffHangar) {
        pillLabel = 'MERIAM TERBANG BERSAYAP!';
      } else if (t >= tOutro) {
        pillLabel = 'A-10 WARTHOG · MERIAM TERBANG';
      } else if (t >= tIgniter) {
        pillLabel = 'A-10 WARTHOG · PEMANTIK & TITANIUM';
      } else if (t >= tRecoil) {
        pillLabel = 'A-10 WARTHOG · REKOIL 45 kN';
      } else if (t >= tAssemble) {
        pillLabel = 'A-10 WARTHOG · 3.900 RPM';
      }
      pillText.textContent = pillLabel;
      pillDot.className = isFiring ? 'firing' : '';

  }

  const hook = {
    kicker: 'FAKTA GILA',
    headline: 'MERIAM TERBANG BERSAYAP!',
  };

  return { render, getSubjectGroups, hook };
}
