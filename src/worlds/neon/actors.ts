import * as THREE from 'three/webgpu';
import { HumanoidActor } from '../../characters/HumanoidActor';
import type { Actor } from '../../characters/Actor';
import { bake, cyl, ellipsoid, merge, roundedBox, torus, tube } from '../../characters/geo';

type V3 = [number, number, number];

/** Small helper: merged baked accessory geometry. */
function acc(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return merge(parts);
}

// ───────────────────────── NOVA – sprinter ─────────────────────────
function makeNova(): HumanoidActor {
  const H = 1.68;
  const actor: HumanoidActor = new HumanoidActor({
    id: 'nova',
    name: 'Nova',
    walkSpeed: 2.2,
    spec: {
      height: H,
      build: { shoulders: 0.92, hips: 0.92, limbs: 0.92, legs: 1.06, head: 0.98 },
      skin: '#e2b092',
      eyes: { iris: '#19d9ff', size: 1.1, glow: 0.9 },
      hair: { style: 'spiky', color: '#0c1626', accent: '#19d9ff' },
      brows: { color: '#0c1626', thickness: 0.8, tilt: 0.12 },
      nose: 'small',
      lips: '#b8506a',
      outfit: {
        top: { kind: 'suit', color: '#14233c', accent: '#1d4a78', trim: '#19d9ff', glow: '#19d9ff', sleeves: 'long', collar: 'high', rough: 0.32, metal: 0.45 },
        bottom: { kind: 'leggings', color: '#16263f', rough: 0.4 },
        shoes: { kind: 'magboots', color: '#1b2c47', sole: '#19d9ff', glow: '#19d9ff' },
        gloves: '#0b1626',
        belt: '#19d9ff',
      },
      hat: { kind: 'headband', color: '#0a1424', glow: '#19d9ff' },
      idle: 'energetic',
    },
    extra: (a, dt) => {
      fins.rotation.x = -0.12 + Math.sin(a.moveBlend * 3 + a.gait * 0.5) * 0.05 * a.moveBlend;
      finGlow.scale.setScalar(1 + Math.sin(performance.now() * 0.006) * 0.08);
      void dt;
    },
  });
  const rig = actor.rig;
  const H0 = H;
  const cy0 = { color: '#19d9ff', rough: 0.3, emit: 3 };
  // magnetic ankle rings on both boots
  const ring = acc([
    bake(torus(H0 * 0.036, 0.007, Math.PI * 2, 20, 5), cy0, { p: [0, -H0 * 0.205, 0], r: [Math.PI / 2, 0, 0] }),
    bake(torus(H0 * 0.036, 0.005, Math.PI * 2, 20, 5), cy0, { p: [0, -H0 * 0.19, 0], r: [Math.PI / 2, 0, 0] }),
  ]);
  actor.attach(rig.kneeL, ring, 'ankleL');
  actor.attach(rig.kneeR, ring.clone(), 'ankleR');
  // wrist HUD band
  const band = acc([
    bake(cyl(0.038, 0.036, 0.05, 14), { color: '#0a1424', rough: 0.3, metal: 0.6 }, { p: [0, 0.055, 0] }),
    bake(roundedBox(0.05, 0.012, 0.04, 0.004), cy0, { p: [0, 0.055, 0.04] }),
  ]);
  actor.attach(rig.handL, band, 'hud');
  // aero fins on the back
  const fins = new THREE.Group();
  rig.back.add(fins);
  const finGeo = acc([
    bake(roundedBox(0.03, 0.34, 0.12, 0.01), { color: '#0a1424', rough: 0.3, metal: 0.7 }, { p: [0.09, 0.02, -0.03], r: [0.12, 0, -0.32] }),
    bake(roundedBox(0.03, 0.34, 0.12, 0.01), { color: '#0a1424', rough: 0.3, metal: 0.7 }, { p: [-0.09, 0.02, -0.03], r: [0.12, 0, 0.32] }),
    bake(roundedBox(0.01, 0.3, 0.02, 0.004), cy0, { p: [0.105, 0.02, -0.0], r: [0.12, 0, -0.32] }),
    bake(roundedBox(0.01, 0.3, 0.02, 0.004), cy0, { p: [-0.105, 0.02, -0.0], r: [0.12, 0, 0.32] }),
    bake(roundedBox(0.14, 0.2, 0.06, 0.02), { color: '#12283f', rough: 0.35, metal: 0.6 }, { p: [0, 0.0, 0.0] }),
    bake(roundedBox(0.09, 0.02, 0.012, 0.004), cy0, { p: [0, 0.04, -0.034] }),
  ]);
  const finMesh = actor.attach(fins, finGeo, 'fins');
  finMesh.position.set(0, 0, 0);
  const finGlow = new THREE.Group();
  fins.add(finGlow);
  return actor;
}

// ───────────────────────── KAI – drone technician ─────────────────────────
function makeKai(): HumanoidActor {
  const H = 1.76;
  let droneAnchor: THREE.Group | null = null;
  let rotors: THREE.Mesh | null = null;
  const actor: HumanoidActor = new HumanoidActor({
    id: 'kai',
    name: 'Kai',
    walkSpeed: 1.7,
    spec: {
      height: H,
      build: { shoulders: 1.0, limbs: 0.95 },
      skin: '#b98060',
      eyes: { iris: '#ff8a1e', size: 1.0, glow: 0.5 },
      hair: { style: 'undercut', color: '#17110d', accent: '#ff8a1e' },
      brows: { color: '#17110d', thickness: 1.1 },
      nose: 'button',
      outfit: {
        top: { kind: 'jacket', color: '#3a4258', accent: '#505b76', trim: '#ff8a1e', glow: '#ff8a1e', sleeves: 'long', collar: 'high', rough: 0.6, metal: 0.15 },
        bottom: { kind: 'pants', color: '#2b3242', rough: 0.7 },
        shoes: { kind: 'sneakers', color: '#3a4054', sole: '#ff8a1e', glow: '#ff8a1e' },
        gloves: '#15181e',
        belt: '#ff8a1e',
      },
      idle: 'fidget',
    },
    extra: (a, dt) => {
      if (!droneAnchor || !rotors) return;
      const t = performance.now() * 0.001;
      droneAnchor.position.y = 0.66 + Math.sin(t * 2.6) * 0.022;
      droneAnchor.position.x = 0.36 + Math.sin(t * 1.3) * 0.012;
      droneAnchor.rotation.y = Math.sin(t * 0.8) * 0.6 + a.moveBlend * 0.3;
      droneAnchor.rotation.z = Math.sin(t * 1.7) * 0.06;
      rotors.rotation.y += dt * 60;
    },
  });
  const rig = actor.rig;
  const or = { color: '#ff8a1e', rough: 0.3, emit: 3 };
  const dark = { color: '#151922', rough: 0.35, metal: 0.7 };
  // visor + headset (on the head; face at +Z, eye line ≈ headR * 1.0)
  const r = H * 0.074;
  const visor = acc([
    bake(new THREE.SphereGeometry(r * 1.06, 22, 10, Math.PI / 2 - Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.4, Math.PI * 0.16), { color: '#ff8a1e', rough: 0.08, metal: 0.2, emit: 1.1 }, { p: [0, r * 1.0, 0.0], s: [1.0, 1.15, 1.0] }),
    bake(torus(r * 1.03, r * 0.05, Math.PI * 0.95, 20, 5), dark, { p: [0, r * 1.18, 0], r: [Math.PI / 2, 0, Math.PI * 0.025] }),
    bake(torus(r * 1.03, r * 0.05, Math.PI * 0.95, 20, 5), dark, { p: [0, r * 0.82, 0], r: [Math.PI / 2, 0, Math.PI * 0.025] }),
  ]);
  actor.attach(rig.head, visor, 'visor');
  const headset = acc([
    bake(torus(r * 1.12, r * 0.05, Math.PI, 20, 5), dark, { p: [0, r * 1.0, 0] }),
    bake(cyl(r * 0.28, r * 0.28, r * 0.22, 14), dark, { p: [r * 1.12, r * 1.0, 0], r: [0, 0, Math.PI / 2] }),
    bake(cyl(r * 0.28, r * 0.28, r * 0.22, 14), dark, { p: [-r * 1.12, r * 1.0, 0], r: [0, 0, Math.PI / 2] }),
    bake(cyl(r * 0.16, r * 0.16, r * 0.05, 12), or, { p: [r * 1.24, r * 1.0, 0], r: [0, 0, Math.PI / 2] }),
    bake(tube([[r * 1.1, r * 0.9, r * 0.1], [r * 1.05, r * 0.55, r * 0.6], [r * 0.4, r * 0.4, r * 0.98]], r * 0.03, 12, 5), dark),
    bake(ellipsoid(r * 0.08, r * 0.08, r * 0.08, 8, 6), or, { p: [r * 0.4, r * 0.4, r * 1.0] }),
  ]);
  actor.attach(rig.head, headset, 'headset');
  // tool pouches + wrist multitool
  const pouch = acc([
    bake(roundedBox(0.09, 0.13, 0.07, 0.02), { color: '#2b3140', rough: 0.7 }, { p: [0.15, -0.02, 0.02] }),
    bake(roundedBox(0.03, 0.03, 0.01, 0.004), or, { p: [0.15, 0.0, 0.058] }),
    bake(roundedBox(0.09, 0.1, 0.07, 0.02), { color: '#2b3140', rough: 0.7 }, { p: [-0.15, -0.04, 0.02] }),
  ]);
  actor.attach(rig.hips, pouch, 'pouches');
  const tool = acc([bake(roundedBox(0.05, 0.05, 0.09, 0.01), dark, { p: [0, 0.05, 0.03] }), bake(roundedBox(0.03, 0.012, 0.05, 0.004), or, { p: [0, 0.078, 0.03] })]);
  actor.attach(rig.handR, tool, 'multitool');
  // companion drone
  droneAnchor = new THREE.Group();
  droneAnchor.position.set(0.36, 0.66, 0.04);
  rig.torso.add(droneAnchor);
  const droneBody = acc([
    bake(ellipsoid(0.055, 0.03, 0.065, 14, 10), { color: '#2d3444', rough: 0.3, metal: 0.8 }),
    bake(ellipsoid(0.03, 0.02, 0.03, 10, 8), or, { p: [0, -0.01, 0.05] }),
    bake(cyl(0.006, 0.006, 0.13, 6), dark, { p: [0.05, 0.005, 0.05], r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.006, 0.006, 0.13, 6), dark, { p: [-0.05, 0.005, -0.05], r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.005, 0.005, 0.1, 6), dark, { p: [0.0, 0.005, 0.06], r: [Math.PI / 2, 0, 0] }),
    bake(ellipsoid(0.008, 0.008, 0.008, 6, 5), { color: '#ff3040', rough: 0.3, emit: 4 }, { p: [0.0, 0.032, -0.05] }),
    bake(ellipsoid(0.008, 0.008, 0.008, 6, 5), { color: '#40ff70', rough: 0.3, emit: 4 }, { p: [0.0, 0.032, 0.05] }),
  ]);
  actor.attach(droneAnchor, droneBody, 'drone');
  const rotorGeo = acc(
    [
      [0.09, 0.09],
      [-0.09, 0.09],
      [0.09, -0.09],
      [-0.09, -0.09],
    ].map(([x, z]) => bake(cyl(0.05, 0.05, 0.004, 14), { color: '#a8c8ff', rough: 0.2, metal: 0.2, emit: 0.7 }, { p: [x!, 0.03, z!] })),
  );
  rotors = actor.attach(droneAnchor, rotorGeo, 'rotors');
  return actor;
}

// ───────────────────────── MARA – network engineer ─────────────────────────
function makeMara(): HumanoidActor {
  const H = 1.7;
  let drum: THREE.Group | null = null;
  const actor: HumanoidActor = new HumanoidActor({
    id: 'mara',
    name: 'Mara',
    walkSpeed: 1.2,
    spec: {
      height: H,
      build: { shoulders: 0.98, hips: 1.08, chest: 1.05, limbs: 1.0 },
      skin: '#8c5a44',
      eyes: { iris: '#ff2fd0', size: 1.05, glow: 0.5 },
      hair: { style: 'braid', color: '#1a0c16', accent: '#ff2fd0' },
      brows: { color: '#1a0c16', thickness: 1.0 },
      nose: 'round',
      lips: '#a83a66',
      outfit: {
        top: { kind: 'coat', color: '#4a2a66', accent: '#6a3d8c', trim: '#ff2fd0', glow: '#ff2fd0', sleeves: 'long', collar: 'high', length: 0.3, rough: 0.7, metal: 0.1 },
        bottom: { kind: 'pants', color: '#34214c', rough: 0.7 },
        shoes: { kind: 'boots', color: '#2b1c3e', sole: '#ff2fd0', glow: '#ff2fd0' },
        gloves: '#231530',
        belt: '#ff2fd0',
      },
      hat: { kind: 'bandana', color: '#3a1a52' },
      idle: 'calm',
    },
    extra: (a, dt) => {
      if (drum) drum.rotation.x += dt * (0.35 + a.moveBlend * 1.6);
    },
  });
  const rig = actor.rig;
  const mg = { color: '#ff2fd0', rough: 0.3, emit: 3 };
  const metal = { color: '#2a2036', rough: 0.4, metal: 0.8 };
  // backplate + frame
  const frame = acc([
    bake(roundedBox(0.3, 0.36, 0.06, 0.02), metal, { p: [0, 0.0, -0.04] }),
    bake(cyl(0.012, 0.012, 0.44, 8), metal, { p: [0.1, 0.0, -0.09] }),
    bake(cyl(0.012, 0.012, 0.44, 8), metal, { p: [-0.1, 0.0, -0.09] }),
    bake(roundedBox(0.2, 0.02, 0.012, 0.004), mg, { p: [0, 0.14, -0.072] }),
    bake(torus(0.07, 0.008, Math.PI * 2, 14, 4), mg, { p: [0, -0.1, -0.075] }),
  ]);
  actor.attach(rig.back, frame, 'rigframe');
  // rotating cable drum (axis = X)
  drum = new THREE.Group();
  drum.position.set(0, 0.02, -0.2);
  rig.back.add(drum);
  const drumGeo = acc([
    bake(cyl(0.11, 0.11, 0.44, 22), { color: '#3a2a4a', rough: 0.55, metal: 0.2 }, { r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.235, 0.235, 0.028, 26), { color: '#514266', rough: 0.35, metal: 0.8 }, { p: [0.22, 0, 0], r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.235, 0.235, 0.028, 26), { color: '#514266', rough: 0.35, metal: 0.8 }, { p: [-0.22, 0, 0], r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.2, 0.2, 0.36, 26), { color: '#1a1224', rough: 0.85 }, { r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.205, 0.205, 0.02, 26), mg, { p: [0.12, 0, 0], r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.205, 0.205, 0.02, 26), mg, { p: [-0.12, 0, 0], r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.205, 0.205, 0.012, 26), { color: '#00e5ff', rough: 0.3, emit: 2.6 }, { p: [0, 0, 0], r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.05, 0.05, 0.5, 10), metal, { r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.03, 0.03, 0.03, 10), mg, { p: [0.265, 0, 0], r: [0, 0, Math.PI / 2] }),
    bake(cyl(0.03, 0.03, 0.03, 10), mg, { p: [-0.265, 0, 0], r: [0, 0, Math.PI / 2] }),
    bake(tube([[0.22, 0.235, 0.0], [0.27, 0.3, 0.05], [0.24, 0.32, 0.12]], 0.008, 10, 5), mg),
  ]);
  actor.attach(drum, drumGeo, 'drum');
  // fibre-tester in right hand
  const tester = acc([
    bake(roundedBox(0.035, 0.11, 0.035, 0.01), { color: '#231530', rough: 0.4, metal: 0.5 }, { p: [0, 0.03, 0.02] }),
    bake(roundedBox(0.02, 0.03, 0.005, 0.002), mg, { p: [0, 0.05, 0.04] }),
    bake(cyl(0.004, 0.004, 0.06, 6), mg, { p: [0, 0.13, 0.02] }),
  ]);
  actor.attach(rig.handR, tester, 'tester');
  // braid clip + glow tips
  const braid = acc([bake(ellipsoid(0.02, 0.02, 0.02, 8, 6), mg, { p: [0, -0.02, 0] })]);
  actor.attach(rig.headTop, braid, 'clip').position.set(0, -0.08, -H * 0.075);
  return actor;
}

// ───────────────────────── OSKAR – veteran in exo-frame ─────────────────────────
function makeOskar(): HumanoidActor {
  const H = 1.82;
  const blink: THREE.Mesh[] = [];
  const actor: HumanoidActor = new HumanoidActor({
    id: 'oskar',
    name: 'Oskar',
    walkSpeed: 0.8,
    spec: {
      height: H,
      build: { shoulders: 1.12, belly: 0.3, limbs: 1.12, chest: 1.1, hips: 1.05 },
      skin: '#c69a80',
      eyes: { iris: '#5a7a90', size: 0.95 },
      hair: { style: 'short', color: '#a9a9a6' },
      brows: { color: '#a9a9a6', thickness: 1.5 },
      beard: { style: 'full', color: '#bdbdb8' },
      nose: 'hooked',
      outfit: {
        top: { kind: 'jacket', color: '#5a5a46', accent: '#7a7458', trim: '#ffc400', glow: '#ffc400', sleeves: 'long', collar: 'high', rough: 0.9 },
        bottom: { kind: 'pants', color: '#40423a', rough: 0.9 },
        shoes: { kind: 'boots', color: '#2c2b26', sole: '#ffc400', glow: '#ffc400' },
        gloves: '#2b2a24',
        belt: '#5a5340',
      },
      hat: { kind: 'helmet', color: '#c99a00', accent: '#3a3428', glow: '#ffc400' },
      idle: 'heavy',
    },
    extra: () => {
      const t = performance.now() * 0.001;
      const on = Math.sin(t * 5.5) > 0;
      for (const m of blink) m.scale.setScalar(on ? 1 : 0.05);
    },
  });
  const rig = actor.rig;
  const yl = { color: '#ffc400', rough: 0.3, emit: 3.2 };
  const steel = { color: '#4b4f55', rough: 0.4, metal: 0.9 };
  const dark = { color: '#23252a', rough: 0.5, metal: 0.8 };
  const legLen = H * 0.46;
  const footH = H * 0.035;
  const seg = (legLen - footH) * 0.5;
  // thigh exo-struts (hip joints)
  for (const [joint, sx] of [
    [rig.hipL, 1],
    [rig.hipR, -1],
  ] as Array<[THREE.Group, number]>) {
    const x = sx * 0.115;
    const strut = acc([
      bake(cyl(0.05, 0.05, 0.075, 14), steel, { p: [x, 0.0, 0], r: [0, 0, Math.PI / 2] }),
      bake(cyl(0.02, 0.02, seg * 0.95, 8), dark, { p: [x, -seg * 0.5, 0.0] }),
      bake(roundedBox(0.03, seg * 0.7, 0.05, 0.008), steel, { p: [x + sx * 0.012, -seg * 0.45, 0.0] }),
      bake(torus(0.078, 0.014, Math.PI * 2, 18, 5), steel, { p: [0, -seg * 0.22, 0], r: [Math.PI / 2, 0, 0] }),
      bake(torus(0.072, 0.012, Math.PI * 2, 18, 5), steel, { p: [0, -seg * 0.75, 0], r: [Math.PI / 2, 0, 0] }),
      bake(cyl(0.02, 0.02, 0.04, 8), yl, { p: [x + sx * 0.03, 0.0, 0], r: [0, 0, Math.PI / 2] }),
    ]);
    actor.attach(joint, strut, 'exoThigh');
    // hydraulic piston
    const piston = acc([bake(cyl(0.012, 0.012, seg * 0.8, 6), { color: '#c8ccd2', rough: 0.2, metal: 1 }, { p: [x + sx * 0.03, -seg * 0.5, -0.04] })]);
    actor.attach(joint, piston, 'piston');
  }
  // shin struts (knee joints)
  for (const [joint, sx] of [
    [rig.kneeL, 1],
    [rig.kneeR, -1],
  ] as Array<[THREE.Group, number]>) {
    const x = sx * 0.1;
    const strut = acc([
      bake(cyl(0.045, 0.045, 0.07, 14), steel, { p: [x, 0.0, 0], r: [0, 0, Math.PI / 2] }),
      bake(cyl(0.02, 0.02, seg * 0.92, 8), dark, { p: [x, -seg * 0.48, 0.0] }),
      bake(roundedBox(0.03, seg * 0.6, 0.05, 0.008), steel, { p: [x + sx * 0.01, -seg * 0.4, 0.0] }),
      bake(torus(0.065, 0.012, Math.PI * 2, 18, 5), steel, { p: [0, -seg * 0.3, 0], r: [Math.PI / 2, 0, 0] }),
      bake(torus(0.06, 0.012, Math.PI * 2, 18, 5), steel, { p: [0, -seg * 0.78, 0], r: [Math.PI / 2, 0, 0] }),
      bake(roundedBox(0.03, 0.03, 0.14, 0.008), steel, { p: [x, -seg * 0.98, 0.05] }),
    ]);
    actor.attach(joint, strut, 'exoShin');
    const lamp = acc([bake(ellipsoid(0.018, 0.018, 0.018, 8, 6), yl, { p: [x + sx * 0.025, 0.0, 0.0] })]);
    blink.push(actor.attach(joint, lamp, 'warn'));
  }
  // hip lamps + back frame
  const hipLamp = acc([bake(ellipsoid(0.02, 0.02, 0.02, 8, 6), yl, { p: [0.19, 0.02, 0.0] }), bake(ellipsoid(0.02, 0.02, 0.02, 8, 6), yl, { p: [-0.19, 0.02, 0.0] })]);
  blink.push(actor.attach(rig.hips, hipLamp, 'hipLamps'));
  const backFrame = acc([
    bake(cyl(0.018, 0.018, 0.78, 8), dark, { p: [0.085, -0.02, -0.05] }),
    bake(cyl(0.018, 0.018, 0.78, 8), dark, { p: [-0.085, -0.02, -0.05] }),
    bake(roundedBox(0.28, 0.03, 0.05, 0.008), steel, { p: [0, 0.32, -0.05] }),
    bake(roundedBox(0.28, 0.03, 0.05, 0.008), steel, { p: [0, -0.3, -0.05] }),
    bake(roundedBox(0.22, 0.32, 0.11, 0.02), { color: '#3d4046', rough: 0.5, metal: 0.7 }, { p: [0, 0.02, -0.12] }),
    bake(roundedBox(0.16, 0.03, 0.01, 0.004), yl, { p: [0, 0.12, -0.18] }),
    bake(roundedBox(0.16, 0.03, 0.01, 0.004), yl, { p: [0, 0.06, -0.18] }),
    bake(cyl(0.028, 0.028, 0.16, 10), steel, { p: [0.09, 0.4, -0.05] }),
    bake(cyl(0.028, 0.028, 0.16, 10), steel, { p: [-0.09, 0.4, -0.05] }),
    bake(torus(0.03, 0.008, Math.PI * 2, 12, 4), yl, { p: [0.09, 0.48, -0.05], r: [Math.PI / 2, 0, 0] }),
    bake(torus(0.03, 0.008, Math.PI * 2, 12, 4), yl, { p: [-0.09, 0.48, -0.05], r: [Math.PI / 2, 0, 0] }),
  ]);
  actor.attach(rig.back, backFrame, 'exoBack');
  const shoulderPads = acc([
    bake(ellipsoid(0.1, 0.05, 0.09, 12, 8), steel, { p: [0, 0.04, 0], s: 1 }),
    bake(cyl(0.012, 0.012, 0.1, 6), yl, { p: [0.0, 0.09, 0.0], r: [0, 0, Math.PI / 2] }),
  ]);
  actor.attach(rig.shoulderL, shoulderPads, 'padL');
  actor.attach(rig.shoulderR, shoulderPads.clone(), 'padR');
  // cane
  const handToGround = H * 0.42;
  const cane = acc([
    bake(cyl(0.014, 0.014, handToGround + 0.12, 8), { color: '#5a4630', rough: 0.6 }, { p: [0.0, -handToGround * 0.5 + 0.06, 0.03] }),
    bake(new THREE.SphereGeometry(0.03, 10, 8), { color: '#8a6a44', rough: 0.4, metal: 0.4 }, { p: [0, 0.12, 0.03] }),
    bake(cyl(0.018, 0.018, 0.05, 8), { color: '#101010', rough: 0.9 }, { p: [0, -handToGround + 0.02, 0.03] }),
    bake(torus(0.016, 0.004, Math.PI * 2, 10, 4), yl, { p: [0, -handToGround * 0.55, 0.03], r: [Math.PI / 2, 0, 0] }),
  ]);
  actor.attach(rig.handR, cane, 'cane');
  return actor;
}

export function createCouriers(): Map<string, Actor> {
  const m = new Map<string, Actor>();
  m.set('nova', makeNova());
  m.set('kai', makeKai());
  m.set('mara', makeMara());
  m.set('oskar', makeOskar());
  return m;
}

export type { V3 };
