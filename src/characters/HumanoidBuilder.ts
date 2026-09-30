import * as THREE from 'three/webgpu';
import { bake, cyl, ellipsoid, gradient, lathe, latheShell, limb, merge, roundedBox, torus, tube, type Surface } from './geo';

export type HairStyle = 'short' | 'bob' | 'long' | 'ponytail' | 'bun' | 'braid' | 'spiky' | 'bald' | 'curly' | 'undercut' | 'mohawk';
export type TopKind = 'tunic' | 'jacket' | 'coat' | 'parka' | 'robe' | 'suit' | 'vest' | 'shirt' | 'armor';
export type HatKind = 'ranger' | 'captain' | 'tricorn' | 'beanie' | 'cap' | 'hood' | 'helmet' | 'bandana' | 'circlet' | 'headband' | 'none';
export type IdleStyle = 'calm' | 'energetic' | 'proud' | 'shy' | 'heavy' | 'lookout' | 'armsCrossed' | 'handsBehind' | 'fidget' | 'stately';

export interface HumanoidSpec {
  height: number;
  build?: {
    shoulders?: number;
    hips?: number;
    belly?: number;
    chest?: number;
    limbs?: number;
    legs?: number;
    head?: number;
    neck?: number;
  };
  skin: THREE.ColorRepresentation;
  eyes?: { iris: THREE.ColorRepresentation; size?: number; glow?: number };
  hair: { style: HairStyle; color: THREE.ColorRepresentation; accent?: THREE.ColorRepresentation };
  brows?: { color?: THREE.ColorRepresentation; thickness?: number; tilt?: number };
  beard?: { style: 'full' | 'short' | 'goatee' | 'mustache'; color?: THREE.ColorRepresentation };
  nose?: 'small' | 'round' | 'long' | 'button' | 'hooked';
  ears?: 'normal' | 'pointed' | 'small';
  lips?: THREE.ColorRepresentation;
  blush?: number;
  freckles?: boolean;
  outfit: {
    top: {
      kind: TopKind;
      color: THREE.ColorRepresentation;
      accent?: THREE.ColorRepresentation;
      trim?: THREE.ColorRepresentation;
      /** Hem length 0..1 (0 = at the waist, 1 = ankles) for tunics/coats/robes. */
      length?: number;
      collar?: 'none' | 'high' | 'fur' | 'hood' | 'ruff';
      sleeves?: 'long' | 'short' | 'none';
      /** Emissive light-strip colour (neon outfits). */
      glow?: THREE.ColorRepresentation;
      rough?: number;
      metal?: number;
    };
    bottom: { kind: 'pants' | 'shorts' | 'skirt' | 'leggings'; color: THREE.ColorRepresentation; rough?: number };
    shoes: { kind: 'boots' | 'shoes' | 'sneakers' | 'sandals' | 'magboots'; color: THREE.ColorRepresentation; sole?: THREE.ColorRepresentation; glow?: THREE.ColorRepresentation };
    gloves?: THREE.ColorRepresentation;
    belt?: THREE.ColorRepresentation;
    scarf?: THREE.ColorRepresentation;
    cape?: THREE.ColorRepresentation;
    sash?: THREE.ColorRepresentation;
  };
  hat?: { kind: HatKind; color: THREE.ColorRepresentation; accent?: THREE.ColorRepresentation; glow?: THREE.ColorRepresentation };
  idle?: IdleStyle;
}

/** Joint hierarchy of a built humanoid. All limbs hang along -Y from their joint; the figure faces +Z. */
export interface HumanoidRig {
  hips: THREE.Group;
  torso: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Group;
  brows: THREE.Group;
  mouth: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  /** Attachment points for accessories. */
  handL: THREE.Group;
  handR: THREE.Group;
  back: THREE.Group;
  headTop: THREE.Group;
  dims: {
    height: number;
    legLen: number;
    thigh: number;
    shin: number;
    torsoLen: number;
    headR: number;
    upperArm: number;
    foreArm: number;
    shoulderX: number;
    hipX: number;
  };
}

type Geo = THREE.BufferGeometry;

function darken(c: THREE.ColorRepresentation, k: number): THREE.Color {
  return new THREE.Color(c).multiplyScalar(k);
}

function g(name: string): THREE.Group {
  const grp = new THREE.Group();
  grp.name = name;
  return grp;
}

/**
 * Builds a stylised humanoid from procedural parts. Each rig segment becomes one merged mesh
 * (vertex colours + PBR attributes) → ~14 draw calls per figure.
 */
export function buildHumanoid(spec: HumanoidSpec, addMesh: (parent: THREE.Object3D, geo: Geo, name: string) => THREE.Mesh): HumanoidRig {
  const H = spec.height;
  const b = spec.build ?? {};
  const child = H < 1.35;
  const headR = H * (child ? 0.092 : 0.074) * (b.head ?? 1);
  const legLen = H * (child ? 0.4 : 0.46) * (b.legs ?? 1);
  const footH = H * 0.035;
  const thigh = (legLen - footH) * 0.5;
  const shin = (legLen - footH) * 0.5;
  const torsoLen = H - legLen - headR * 2.05 - H * 0.035 * (b.neck ?? 1);
  const neckLen = H * 0.035 * (b.neck ?? 1);
  const limbR = H * 0.028 * (b.limbs ?? 1);
  const shoulderR = H * 0.1 * (b.shoulders ?? 1);
  const hipR = H * 0.085 * (b.hips ?? 1);
  const belly = b.belly ?? 0;
  const chest = b.chest ?? 1;
  const upperArm = H * 0.165;
  const foreArm = H * 0.15;
  const skin: Surface = { color: spec.skin, rough: 0.62 };
  const top = spec.outfit.top;
  const topSurf: Surface = { color: top.color, rough: top.rough ?? 0.82, metal: top.metal ?? 0 };
  const accentSurf: Surface = { color: top.accent ?? darken(top.color, 0.7), rough: 0.7 };
  const trimSurf: Surface = { color: top.trim ?? top.accent ?? darken(top.color, 0.55), rough: 0.5, metal: top.trim ? 0.4 : 0 };
  const bottomSurf: Surface = { color: spec.outfit.bottom.color, rough: spec.outfit.bottom.rough ?? 0.85 };
  const shoeSurf: Surface = { color: spec.outfit.shoes.color, rough: 0.55 };
  const soleSurf: Surface = { color: spec.outfit.shoes.sole ?? darken(spec.outfit.shoes.color, 0.35), rough: 0.9 };
  const glow = top.glow ? { color: top.glow, rough: 0.3, emit: 2.2 } : null;
  const hairSurf: Surface = { color: spec.hair.color, rough: 0.55 };
  const sleeves = top.sleeves ?? (top.kind === 'vest' || top.kind === 'armor' ? 'short' : 'long');

  // ───────── joints ─────────
  const hips = g('hips');
  hips.position.y = legLen;
  const torso = g('torso');
  torso.position.y = torsoLen * 0.12;
  hips.add(torso);
  const T = torsoLen * 0.88; // torso mesh height above the waist joint
  const neck = g('neck');
  neck.position.y = T;
  torso.add(neck);
  const head = g('head');
  head.position.y = neckLen;
  neck.add(head);
  const eyes = g('eyes');
  const brows = g('brows');
  const mouth = g('mouth');
  head.add(eyes, brows, mouth);
  const shoulderX = shoulderR * 1.05;
  const shoulderL = g('shoulderL');
  const shoulderR_ = g('shoulderR');
  shoulderL.position.set(shoulderX, T * 0.86, 0);
  shoulderR_.position.set(-shoulderX, T * 0.86, 0);
  torso.add(shoulderL, shoulderR_);
  const elbowL = g('elbowL');
  const elbowR = g('elbowR');
  elbowL.position.y = -upperArm;
  elbowR.position.y = -upperArm;
  shoulderL.add(elbowL);
  shoulderR_.add(elbowR);
  const handL = g('handL');
  const handR = g('handR');
  handL.position.y = -foreArm - H * 0.03;
  handR.position.y = -foreArm - H * 0.03;
  elbowL.add(handL);
  elbowR.add(handR);
  const hipX = hipR * 0.52;
  const hipL = g('hipL');
  const hipR_ = g('hipR');
  hipL.position.set(hipX, 0, 0);
  hipR_.position.set(-hipX, 0, 0);
  hips.add(hipL, hipR_);
  const kneeL = g('kneeL');
  const kneeR = g('kneeR');
  kneeL.position.y = -thigh;
  kneeR.position.y = -thigh;
  hipL.add(kneeL);
  hipR_.add(kneeR);
  const back = g('back');
  back.position.set(0, T * 0.6, -H * 0.07);
  torso.add(back);
  const headTop = g('headTop');
  headTop.position.y = headR * 2.1;
  head.add(headTop);

  // ───────── pelvis (hips mesh) ─────────
  const pelvis: Geo[] = [];
  pelvis.push(bake(ellipsoid(hipR * 1.04, torsoLen * 0.2, hipR * 0.78 * (1 + belly * 0.2)), bottomSurf, { p: [0, torsoLen * 0.06, 0] }));
  const hemLen = top.length ?? (top.kind === 'robe' ? 0.95 : top.kind === 'coat' ? 0.42 : top.kind === 'tunic' ? 0.25 : top.kind === 'parka' ? 0.18 : 0);
  if (hemLen > 0) {
    const bottomY = torsoLen * 0.12 - hemLen * (legLen - footH * 2);
    const waistRr = hipR * 1.12 * (1 + belly * 0.35);
    const flare = top.kind === 'robe' ? 1.7 : 1.35;
    const skirt = latheShell([[waistRr, torsoLen * 0.16], [waistRr * 1.06, torsoLen * 0.02], [waistRr * (1 + (flare - 1) * 0.6), (torsoLen * 0.12 + bottomY) / 2], [waistRr * flare, bottomY]], 22, 12);
    skirt.scale(1, 1, 0.86);
    pelvis.push(bake(skirt, topSurf));
    pelvis.push(bake(torus(waistRr * flare, H * 0.006, Math.PI * 2, 30, 5), trimSurf, { p: [0, bottomY, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.86, 1] }));
  }
  if (spec.outfit.bottom.kind === 'skirt') {
    const skirt = latheShell([[hipR * 1.08, torsoLen * 0.14], [hipR * 1.2, -torsoLen * 0.05], [hipR * 1.45, -thigh * 0.85]], 20, 10);
    pelvis.push(bake(skirt, bottomSurf));
  }
  if (spec.outfit.belt) {
    pelvis.push(bake(torus(hipR * 1.07 * (1 + belly * 0.3), H * 0.012, Math.PI * 2, 28, 6), { color: spec.outfit.belt, rough: 0.45 }, { p: [0, torsoLen * 0.15, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1.6] }));
    pelvis.push(bake(roundedBox(H * 0.04, H * 0.03, H * 0.012, H * 0.004), { color: '#c9a45a', rough: 0.3, metal: 0.9 }, { p: [0, torsoLen * 0.15, hipR * 0.86] }));
  }
  if (spec.outfit.sash) {
    pelvis.push(bake(torus(hipR * 1.1, H * 0.018, Math.PI * 2, 28, 6), { color: spec.outfit.sash, rough: 0.8 }, { p: [0, torsoLen * 0.17, 0], r: [Math.PI / 2, 0.15, 0], s: [1, 0.8, 1] }));
    pelvis.push(bake(tube([[hipR * 0.8, torsoLen * 0.15, hipR * 0.5], [hipR * 0.95, -torsoLen * 0.1, hipR * 0.6], [hipR * 0.9, -torsoLen * 0.35, hipR * 0.55]], H * 0.014, 10, 6), { color: spec.outfit.sash, rough: 0.8 }));
  }
  addMesh(hips, merge(pelvis), 'pelvis');

  // ───────── torso ─────────
  const tp: Geo[] = [];
  const waistR = hipR * 0.9 * (1 + belly * 0.45);
  const chestR = H * 0.088 * chest * (1 + belly * 0.15);
  const puff = top.kind === 'parka' ? 1.18 : top.kind === 'armor' ? 1.08 : 1;
  const torsoGeo = lathe(
    [
      [hipR * 0.98 * puff, -torsoLen * 0.06],
      [waistR * 1.02 * puff, T * 0.12],
      [waistR * (1 + belly * 0.25) * puff, T * 0.35],
      [chestR * puff, T * 0.62],
      [shoulderR * 0.92 * puff, T * 0.84],
      [shoulderR * 0.55, T * 0.99],
      [H * 0.03, T * 1.02],
    ],
    24,
    30,
  );
  torsoGeo.scale(1.12, 1, 0.78 + belly * 0.12);
  tp.push(bake(torsoGeo, topSurf));
  // neck
  tp.push(bake(cyl(H * 0.026, H * 0.03, neckLen + headR * 0.6, 12), skin, { p: [0, T + neckLen * 0.4, 0] }));
  // shoulder balls (smooth the arm joint)
  for (const s of [1, -1]) tp.push(bake(ellipsoid(limbR * 1.55 * puff, limbR * 1.5 * puff, limbR * 1.45 * puff, 14, 10), topSurf, { p: [s * shoulderX, T * 0.86, 0] }));
  // outfit details per kind
  const frontZ = chestR * 0.78 * (0.78 + belly * 0.12) + H * 0.004;
  switch (top.kind) {
    case 'jacket':
    case 'coat': {
      // lapels + placket + buttons
      for (const s of [1, -1]) {
        const lapel = new THREE.Shape();
        lapel.moveTo(0, 0);
        lapel.lineTo(s * H * 0.05, -H * 0.02);
        lapel.lineTo(s * H * 0.02, -H * 0.12);
        lapel.lineTo(0, -H * 0.1);
        const lg = new THREE.ShapeGeometry(lapel);
        tp.push(bake(lg, accentSurf, { p: [s * H * 0.012, T * 0.95, frontZ * 1.02], r: [-0.18, 0, 0] }));
      }
      tp.push(bake(roundedBox(H * 0.012, T * 0.55, H * 0.01, H * 0.003), trimSurf, { p: [0, T * 0.45, frontZ * 1.03] }));
      for (let i = 0; i < 3; i++) tp.push(bake(ellipsoid(H * 0.007, H * 0.007, H * 0.004, 8, 6), { color: '#d8b56a', rough: 0.3, metal: 0.9 }, { p: [H * 0.018, T * (0.25 + i * 0.16), frontZ * 1.06] }));
      break;
    }
    case 'parka': {
      for (let i = 0; i < 4; i++) {
        const y = T * (0.15 + i * 0.2);
        tp.push(bake(torus(chestR * 1.1 * puff, H * 0.005, Math.PI * 2, 30, 4), accentSurf, { p: [0, y, 0], r: [Math.PI / 2, 0, 0], s: [1.12 * (i < 2 ? waistR / chestR : 1), 0.8, 1] }));
      }
      tp.push(bake(roundedBox(H * 0.014, T * 0.8, H * 0.01, H * 0.004), trimSurf, { p: [0, T * 0.5, frontZ * 1.12] }));
      break;
    }
    case 'suit': {
      tp.push(bake(roundedBox(H * 0.09, H * 0.05, H * 0.02, H * 0.01), accentSurf, { p: [0, T * 0.66, frontZ] }));
      break;
    }
    case 'vest': {
      for (const s of [1, -1]) tp.push(bake(roundedBox(H * 0.07, T * 0.7, H * 0.012, H * 0.004), accentSurf, { p: [s * H * 0.045, T * 0.45, frontZ], r: [0, 0, s * 0.08] }));
      break;
    }
    case 'armor': {
      tp.push(bake(ellipsoid(chestR * 1.02, T * 0.26, H * 0.04), trimSurf, { p: [0, T * 0.62, frontZ * 0.9] }));
      for (const s of [1, -1]) tp.push(bake(ellipsoid(limbR * 2.1, limbR * 1.2, limbR * 1.9, 14, 8), trimSurf, { p: [s * shoulderX, T * 0.93, 0], r: [0, 0, s * -0.3] }));
      break;
    }
    case 'robe':
    case 'tunic':
    case 'shirt':
      tp.push(bake(torus(H * 0.045, H * 0.006, Math.PI, 16, 5), trimSurf, { p: [0, T * 0.96, H * 0.02], r: [0.3, 0, Math.PI] }));
      break;
  }
  if (glow) {
    // light strips along the torso sides and chest
    for (const s of [1, -1]) {
      tp.push(bake(tube([[s * chestR * 0.95, T * 0.2, frontZ * 0.4], [s * chestR * 1.05, T * 0.55, frontZ * 0.55], [s * shoulderR * 0.6, T * 0.92, frontZ * 0.5]], H * 0.005, 16, 5), glow));
    }
    tp.push(bake(torus(chestR * 1.02, H * 0.004, Math.PI * 0.7, 20, 4), glow, { p: [0, T * 0.62, 0], r: [Math.PI / 2, 0, Math.PI * 0.15], s: [1.12, 0.78, 1] }));
  }
  // collar
  const collar = top.collar ?? 'none';
  if (collar === 'high') tp.push(bake(cyl(H * 0.042, H * 0.05, H * 0.05, 16, true), accentSurf, { p: [0, T * 1.0, 0] }));
  if (collar === 'fur') tp.push(bake(torus(H * 0.05, H * 0.022, Math.PI * 2, 20, 8), { color: '#ece6da', rough: 1 }, { p: [0, T * 0.98, 0], r: [Math.PI / 2, 0, 0] }));
  if (collar === 'ruff') tp.push(bake(torus(H * 0.05, H * 0.016, Math.PI * 2, 24, 6), { color: '#f2eee4', rough: 0.9 }, { p: [0, T * 1.0, 0], r: [Math.PI / 2, 0, 0] }));
  if (collar === 'hood') {
    const hood = latheShell([[H * 0.06, T * 1.0], [H * 0.085, T * 0.94], [H * 0.07, T * 0.86]], 20, 8, Math.PI * 0.35, Math.PI * 1.3);
    tp.push(bake(hood, accentSurf, { r: [0, Math.PI, 0] }));
  }
  if (spec.outfit.scarf) {
    tp.push(bake(torus(H * 0.045, H * 0.02, Math.PI * 2, 20, 8), { color: spec.outfit.scarf, rough: 0.95 }, { p: [0, T * 0.99, 0], r: [Math.PI / 2 + 0.1, 0, 0] }));
    tp.push(bake(tube([[H * 0.03, T * 0.97, H * 0.05], [H * 0.045, T * 0.8, H * 0.07], [H * 0.04, T * 0.62, H * 0.06]], H * 0.017, 10, 6), { color: spec.outfit.scarf, rough: 0.95 }));
  }
  if (spec.outfit.cape) {
    const cape = latheShell([[shoulderR * 0.8, T * 0.96], [shoulderR * 1.1, T * 0.6], [shoulderR * 1.35, -torsoLen * 0.35]], 18, 10, Math.PI * 0.62, Math.PI * 0.76);
    cape.scale(1, 1, 0.85);
    tp.push(bake(cape, { color: spec.outfit.cape, rough: 0.8 }, { r: [0, Math.PI, 0] }));
  }
  addMesh(torso, merge(tp), 'torso');

  // ───────── head ─────────
  const r = headR;
  const hp: Geo[] = [];
  const skull = ellipsoid(r * 0.97, r * 1.04, r, 26, 20);
  hp.push(bake(skull, skin, { p: [0, r, 0] }));
  hp.push(bake(ellipsoid(r * 0.78, r * 0.58, r * 0.8, 20, 14), skin, { p: [0, r * 0.64, r * 0.13] }));
  const earKind = spec.ears ?? 'normal';
  for (const s of [1, -1]) {
    if (earKind === 'pointed') hp.push(bake(new THREE.ConeGeometry(r * 0.12, r * 0.5, 8), skin, { p: [s * r * 1.02, r * 1.12, -r * 0.05], r: [0, 0, s * -1.1], s: [1, 1, 0.5] }));
    else hp.push(bake(ellipsoid(r * 0.1, r * (earKind === 'small' ? 0.15 : 0.2), r * 0.13, 10, 8), skin, { p: [s * r * 0.96, r * 0.98, -r * 0.02], r: [0, s * 0.3, 0] }));
  }
  const noseKind = spec.nose ?? 'small';
  const noseSurf: Surface = { color: darken(spec.skin, 0.93), rough: 0.6 };
  if (noseKind === 'long') hp.push(bake(ellipsoid(r * 0.1, r * 0.2, r * 0.16, 12, 10), noseSurf, { p: [0, r * 0.9, r * 1.0], r: [0.25, 0, 0] }));
  else if (noseKind === 'hooked') hp.push(bake(ellipsoid(r * 0.1, r * 0.22, r * 0.17, 12, 10), noseSurf, { p: [0, r * 0.92, r * 1.02], r: [0.45, 0, 0] }));
  else if (noseKind === 'round') hp.push(bake(ellipsoid(r * 0.15, r * 0.13, r * 0.13, 12, 10), noseSurf, { p: [0, r * 0.86, r * 1.0] }));
  else if (noseKind === 'button') hp.push(bake(ellipsoid(r * 0.1, r * 0.09, r * 0.09, 10, 8), noseSurf, { p: [0, r * 0.86, r * 1.0] }));
  else hp.push(bake(ellipsoid(r * 0.09, r * 0.14, r * 0.12, 10, 8), noseSurf, { p: [0, r * 0.88, r * 1.0], r: [0.2, 0, 0] }));
  if (spec.blush) {
    for (const s of [1, -1]) hp.push(bake(ellipsoid(r * 0.16, r * 0.1, r * 0.04, 10, 6), { color: new THREE.Color(spec.skin).lerp(new THREE.Color('#e0706a'), spec.blush), rough: 0.7 }, { p: [s * r * 0.5, r * 0.78, r * 0.83], r: [0, s * 0.55, 0] }));
  }
  if (spec.freckles) {
    for (let i = 0; i < 10; i++) {
      const s = i % 2 ? 1 : -1;
      const a = 0.35 + (i % 5) * 0.06;
      hp.push(bake(ellipsoid(r * 0.018, r * 0.018, r * 0.01, 5, 4), { color: darken(spec.skin, 0.72), rough: 0.7 }, { p: [s * r * (0.3 + (i % 3) * 0.08), r * (0.84 + (i % 4) * 0.02), r * (0.92 - a * 0.1)] }));
    }
  }
  addHair(hp, spec.hair.style, r, hairSurf, spec.hair.accent);
  if (spec.beard) {
    const bs: Surface = { color: spec.beard.color ?? spec.hair.color, rough: 0.9 };
    if (spec.beard.style === 'full') {
      hp.push(bake(ellipsoid(r * 0.82, r * 0.6, r * 0.7, 18, 12), bs, { p: [0, r * 0.5, r * 0.28] }));
      hp.push(bake(ellipsoid(r * 0.3, r * 0.08, r * 0.1, 10, 6), bs, { p: [0, r * 0.75, r * 0.93], r: [0, 0, 0] }));
    } else if (spec.beard.style === 'short') {
      hp.push(bake(ellipsoid(r * 0.8, r * 0.5, r * 0.78, 18, 12), { ...bs, color: new THREE.Color(spec.skin).lerp(new THREE.Color(bs.color), 0.55) }, { p: [0, r * 0.6, r * 0.16] }));
    } else if (spec.beard.style === 'goatee') {
      hp.push(bake(ellipsoid(r * 0.2, r * 0.22, r * 0.14, 12, 8), bs, { p: [0, r * 0.35, r * 0.82] }));
      hp.push(bake(ellipsoid(r * 0.28, r * 0.06, r * 0.08, 10, 6), bs, { p: [0, r * 0.74, r * 0.93] }));
    } else {
      hp.push(bake(tube([[-r * 0.32, r * 0.66, r * 0.86], [0, r * 0.77, r * 0.98], [r * 0.32, r * 0.66, r * 0.86]], r * 0.055, 14, 6), bs));
    }
  }
  if (spec.hat && spec.hat.kind !== 'none') addHat(hp, spec.hat, r);
  addMesh(head, merge(hp), 'head');

  // eyes (own mesh → blink by scaling)
  const eyeSize = spec.eyes?.size ?? 1;
  const irisCol = spec.eyes?.iris ?? '#4a3421';
  const ep: Geo[] = [];
  for (const s of [1, -1]) {
    const ex = s * r * 0.36;
    ep.push(bake(ellipsoid(r * 0.16 * eyeSize, r * 0.19 * eyeSize, r * 0.09, 14, 10), { color: '#f4f1ea', rough: 0.25, emit: 0.06 }, { p: [ex, 0, 0] }));
    ep.push(bake(ellipsoid(r * 0.105 * eyeSize, r * 0.125 * eyeSize, r * 0.05, 14, 10), { color: irisCol, rough: 0.2, emit: spec.eyes?.glow ?? 0.05 }, { p: [ex, -r * 0.01, r * 0.06] }));
    ep.push(bake(ellipsoid(r * 0.055 * eyeSize, r * 0.065 * eyeSize, r * 0.03, 10, 8), { color: '#0b0a0a', rough: 0.1 }, { p: [ex, -r * 0.012, r * 0.088] }));
    ep.push(bake(ellipsoid(r * 0.025, r * 0.025, r * 0.012, 6, 5), { color: '#ffffff', rough: 0.1, emit: 1.6 }, { p: [ex + r * 0.035, r * 0.04, r * 0.1] }));
  }
  eyes.position.set(0, r * 1.05, r * 0.86);
  addMesh(eyes, merge(ep), 'eyes');

  // brows
  const browCol = spec.brows?.color ?? darken(spec.hair.color, 0.85);
  const bt = spec.brows?.thickness ?? 1;
  const bp: Geo[] = [];
  for (const s of [1, -1]) {
    bp.push(bake(tube([[s * r * 0.2, 0, 0], [s * r * 0.36, r * 0.05, r * 0.02], [s * r * 0.52, -r * 0.01, -r * 0.03]], r * 0.035 * bt, 10, 5), { color: browCol, rough: 0.9 }));
  }
  brows.position.set(0, r * 1.33, r * 0.9);
  brows.rotation.z = spec.brows?.tilt ?? 0;
  addMesh(brows, merge(bp), 'brows');

  // mouth (smile arc; flipped for frown, scaled for open)
  const lips = spec.lips ?? darken(spec.skin, 0.62);
  const mp: Geo[] = [bake(torus(r * 0.2, r * 0.035, Math.PI * 0.8, 16, 6), { color: lips, rough: 0.5 }, { r: [0, 0, Math.PI * 1.1] })];
  mp.push(bake(ellipsoid(r * 0.16, r * 0.07, r * 0.03, 10, 6), { color: '#3a1614', rough: 0.6 }, { p: [0, -r * 0.1, -r * 0.02] }));
  mouth.position.set(0, r * 0.62, r * 0.9);
  addMesh(mouth, merge(mp), 'mouth');

  // ───────── arms ─────────
  const sleeveSurf = sleeves === 'long' ? topSurf : skin;
  const gloveSurf: Surface = spec.outfit.gloves ? { color: spec.outfit.gloves, rough: 0.6 } : skin;
  for (const [sh, el, s] of [[shoulderL, elbowL, 1], [shoulderR_, elbowR, -1]] as const) {
    const ua: Geo[] = [bake(limb(limbR * 1.25 * puff, limbR * 1.05 * puff, upperArm), sleeves === 'none' ? skin : topSurf)];
    if (sleeves === 'short') ua.push(bake(limb(limbR * 1.35, limbR * 1.3, upperArm * 0.45), topSurf));
    if (glow && sleeves === 'long') ua.push(bake(cyl(limbR * 1.28, limbR * 1.28, H * 0.008, 14, true), glow, { p: [0, -upperArm * 0.5, 0] }));
    addMesh(sh, merge(ua), 'upperArm');
    const fa: Geo[] = [bake(limb(limbR * 1.05 * puff, limbR * 0.85, foreArm), sleeveSurf)];
    if (sleeves === 'long') fa.push(bake(cyl(limbR * 1.12 * puff, limbR * 1.05 * puff, H * 0.03, 14), accentSurf, { p: [0, -foreArm + H * 0.01, 0] }));
    // hand: palm + 4 fingers + thumb
    const hy = -foreArm - H * 0.03;
    fa.push(bake(ellipsoid(H * 0.024, H * 0.03, H * 0.013, 12, 10), gloveSurf, { p: [0, hy, 0] }));
    for (let i = 0; i < 4; i++) {
      const fx = (i - 1.5) * H * 0.011;
      fa.push(bake(limb(H * 0.0055, H * 0.005, H * 0.026, 6), gloveSurf, { p: [fx, hy - H * 0.022, H * 0.002], r: [0.35, 0, (i - 1.5) * 0.06] }));
    }
    fa.push(bake(limb(H * 0.006, H * 0.0055, H * 0.022, 6), gloveSurf, { p: [s * -H * 0.02, hy - H * 0.004, H * 0.008], r: [0.3, 0, s * 0.9] }));
    addMesh(el, merge(fa), 'foreArm');
  }

  // ───────── legs ─────────
  const shoes = spec.outfit.shoes;
  const bottom = spec.outfit.bottom;
  const legSurf = bottom.kind === 'shorts' || bottom.kind === 'skirt' ? skin : bottomSurf;
  for (const kn of [kneeL, kneeR]) void kn;
  for (const [hj, kj] of [[hipL, kneeL], [hipR_, kneeR]] as const) {
    const th: Geo[] = [bake(limb(limbR * 1.65 * (1 + belly * 0.2), limbR * 1.3, thigh), bottom.kind === 'skirt' ? skin : bottomSurf)];
    if (bottom.kind === 'shorts') th.push(bake(limb(limbR * 1.75, limbR * 1.6, thigh * 0.55), bottomSurf));
    addMesh(hj, merge(th), 'thigh');
    const sh: Geo[] = [bake(limb(limbR * 1.28, limbR * 1.0, shin), legSurf)];
    const shoeLen = H * 0.13;
    const shoeW = H * 0.052;
    if (shoes.kind === 'boots' || shoes.kind === 'magboots') {
      sh.push(bake(cyl(limbR * 1.3, limbR * 1.22, shin * 0.55, 14), shoeSurf, { p: [0, -shin * 0.72, 0] }));
      sh.push(bake(torus(limbR * 1.3, H * 0.006, Math.PI * 2, 16, 4), { ...soleSurf, color: darken(shoes.color, 0.6) }, { p: [0, -shin * 0.45, 0], r: [Math.PI / 2, 0, 0] }));
    }
    const fy = -shin - footH * 0.35;
    sh.push(bake(roundedBox(shoeW, footH * 1.35, shoeLen, H * 0.02), shoeSurf, { p: [0, fy, shoeLen * 0.28] }));
    sh.push(bake(ellipsoid(shoeW * 0.52, footH * 0.75, shoeLen * 0.24, 12, 8), shoeSurf, { p: [0, fy + footH * 0.05, shoeLen * 0.62] }));
    sh.push(bake(roundedBox(shoeW * 1.06, footH * 0.35, shoeLen * 1.04, H * 0.008), soleSurf, { p: [0, fy - footH * 0.62, shoeLen * 0.3] }));
    if (shoes.glow) sh.push(bake(roundedBox(shoeW * 1.08, footH * 0.12, shoeLen * 1.02, H * 0.004), { color: shoes.glow, rough: 0.3, emit: 2.5 }, { p: [0, fy - footH * 0.4, shoeLen * 0.3] }));
    if (shoes.kind === 'sneakers') sh.push(bake(roundedBox(shoeW * 1.02, footH * 0.3, shoeLen * 0.5, H * 0.004), { color: '#f4f4f0', rough: 0.6 }, { p: [0, fy + footH * 0.2, shoeLen * 0.35] }));
    addMesh(kj, merge(sh), 'shin');
  }

  return {
    hips,
    torso,
    neck,
    head,
    eyes,
    brows,
    mouth,
    shoulderL,
    shoulderR: shoulderR_,
    elbowL,
    elbowR,
    hipL,
    hipR: hipR_,
    kneeL,
    kneeR,
    handL,
    handR,
    back,
    headTop,
    dims: { height: H, legLen, thigh, shin, torsoLen, headR, upperArm, foreArm, shoulderX, hipX },
  };
}

function addHair(out: Geo[], style: HairStyle, r: number, surf: Surface, accent?: THREE.ColorRepresentation): void {
  if (style === 'bald') return;
  const cy = r; // skull centre
  const cap = (theta: number, tilt: number, scale = 1.08) => {
    const geo = new THREE.SphereGeometry(r * scale, 24, 14, 0, Math.PI * 2, 0, theta);
    return bake(geo, surf, { p: [0, cy + r * 0.02, -r * 0.02], r: [tilt, 0, 0], s: [1, 1.02, 1.04] });
  };
  switch (style) {
    case 'short':
      out.push(cap(Math.PI * 0.5, -0.45));
      for (let i = 0; i < 5; i++) out.push(bake(ellipsoid(r * 0.22, r * 0.12, r * 0.15, 10, 8), surf, { p: [(i - 2) * r * 0.2, cy + r * 0.78, r * 0.72], r: [0.5, 0, (i - 2) * 0.2] }));
      break;
    case 'undercut':
      out.push(cap(Math.PI * 0.32, -0.25, 1.1));
      out.push(bake(ellipsoid(r * 0.55, r * 0.25, r * 0.6, 14, 10), surf, { p: [r * 0.15, cy + r * 0.95, r * 0.25], r: [0.3, 0, -0.35] }));
      break;
    case 'mohawk':
      for (let i = 0; i < 6; i++) out.push(bake(new THREE.ConeGeometry(r * 0.12, r * 0.55, 8), surf, { p: [0, cy + r * 0.95 - Math.abs(i - 2.5) * r * 0.05, r * (0.55 - i * 0.22)], r: [-0.4 + i * 0.18, 0, 0] }));
      break;
    case 'spiky':
      out.push(cap(Math.PI * 0.45, -0.4));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        out.push(bake(new THREE.ConeGeometry(r * 0.16, r * 0.5, 7), surf, { p: [Math.sin(a) * r * 0.55, cy + r * 0.85, Math.cos(a) * r * 0.45 - r * 0.1], r: [Math.cos(a) * 0.7 - 0.2, 0, -Math.sin(a) * 0.7] }));
      }
      break;
    case 'bob':
      out.push(cap(Math.PI * 0.56, -0.5));
      out.push(bake(latheShell([[r * 1.08, 0], [r * 1.12, -r * 0.45], [r * 1.02, -r * 0.8]], 22, 8, Math.PI * 0.62, Math.PI * 1.76), surf, { p: [0, cy + r * 0.25, -r * 0.05] }));
      break;
    case 'long':
      out.push(cap(Math.PI * 0.55, -0.5));
      out.push(bake(latheShell([[r * 1.07, 0], [r * 1.1, -r * 0.8], [r * 1.0, -r * 1.8]], 22, 10, Math.PI * 0.72, Math.PI * 1.56), surf, { p: [0, cy + r * 0.2, -r * 0.1], s: [1, 1, 0.8] }));
      break;
    case 'ponytail':
      out.push(cap(Math.PI * 0.55, -0.45));
      out.push(bake(tube([[0, cy + r * 0.7, -r * 0.9], [0, cy + r * 0.3, -r * 1.35], [0, cy - r * 0.4, -r * 1.3], [0, cy - r * 1.1, -r * 1.05]], r * 0.2, 20, 8, r * 0.07), surf));
      out.push(bake(torus(r * 0.18, r * 0.05, Math.PI * 2, 14, 6), { color: accent ?? '#c23a3a', rough: 0.5 }, { p: [0, cy + r * 0.62, -r * 1.02], r: [0.9, 0, 0] }));
      break;
    case 'bun':
      out.push(cap(Math.PI * 0.55, -0.45));
      out.push(bake(ellipsoid(r * 0.42, r * 0.38, r * 0.4, 14, 10), surf, { p: [0, cy + r * 0.95, -r * 0.6] }));
      if (accent) out.push(bake(cyl(r * 0.03, r * 0.03, r * 1.2, 6), { color: accent, rough: 0.4 }, { p: [0, cy + r * 1.05, -r * 0.6], r: [0, 0, 1.2] }));
      break;
    case 'braid':
      out.push(cap(Math.PI * 0.55, -0.45));
      for (let i = 0; i < 7; i++) out.push(bake(ellipsoid(r * 0.19 - i * r * 0.012, r * 0.2, r * 0.17, 10, 8), surf, { p: [Math.sin(i * 1.3) * r * 0.05, cy + r * 0.25 - i * r * 0.3, -r * 1.02 + i * r * 0.03] }));
      out.push(bake(torus(r * 0.12, r * 0.04, Math.PI * 2, 12, 5), { color: accent ?? '#3d8a4a', rough: 0.5 }, { p: [0, cy - r * 1.8, -r * 0.83], r: [Math.PI / 2, 0, 0] }));
      break;
    case 'curly':
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 * 3.1;
        const yy = (i / 26) * 0.9;
        const rr = r * (1.0 - yy * 0.35);
        out.push(bake(ellipsoid(r * 0.28, r * 0.26, r * 0.26, 10, 8), surf, { p: [Math.sin(a) * rr, cy + r * (0.35 + yy * 0.75), Math.cos(a) * rr * 0.95 - r * 0.12] }));
      }
      break;
  }
}

function addHat(out: Geo[], hat: NonNullable<HumanoidSpec['hat']>, r: number): void {
  const s: Surface = { color: hat.color, rough: 0.7 };
  const a: Surface = { color: hat.accent ?? darken(hat.color, 0.6), rough: 0.5, metal: hat.accent ? 0.3 : 0 };
  const top = r * 1.85;
  switch (hat.kind) {
    case 'ranger':
      out.push(bake(cyl(r * 1.75, r * 1.8, r * 0.06, 28), s, { p: [0, top - r * 0.2, 0] }));
      out.push(bake(lathe([[r * 0.92, 0], [r * 0.95, r * 0.35], [r * 0.7, r * 0.6], [r * 0.2, r * 0.66]], 22, 14), s, { p: [0, top - r * 0.2, 0] }));
      out.push(bake(cyl(r * 0.96, r * 0.96, r * 0.12, 24, true), a, { p: [0, top - r * 0.1, 0] }));
      out.push(bake(ellipsoid(r * 0.08, r * 0.3, r * 0.05, 8, 8), { color: '#6f9b4c', rough: 0.8 }, { p: [r * 0.85, top + r * 0.1, r * 0.1], r: [0, 0, -0.5] }));
      break;
    case 'captain':
      out.push(bake(lathe([[r * 0.98, 0], [r * 1.02, r * 0.25], [r * 1.18, r * 0.45], [r * 0.3, r * 0.55]], 24, 14), s, { p: [0, top - r * 0.28, -r * 0.05] }));
      out.push(bake(cyl(r * 1.0, r * 1.0, r * 0.12, 24, true), a, { p: [0, top - r * 0.22, -r * 0.05] }));
      out.push(bake(ellipsoid(r * 0.75, r * 0.06, r * 0.5, 16, 6), { color: '#1b1b1f', rough: 0.3 }, { p: [0, top - r * 0.3, r * 0.75], r: [0.25, 0, 0] }));
      out.push(bake(ellipsoid(r * 0.14, r * 0.14, r * 0.05, 10, 8), { color: '#e8c060', rough: 0.25, metal: 1 }, { p: [0, top - r * 0.05, r * 1.02] }));
      break;
    case 'tricorn': {
      out.push(bake(lathe([[r * 0.95, 0], [r * 0.98, r * 0.4], [r * 0.6, r * 0.55], [r * 0.1, r * 0.58]], 22, 12), s, { p: [0, top - r * 0.25, 0] }));
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2 + Math.PI / 3;
        out.push(bake(ellipsoid(r * 1.0, r * 0.32, r * 0.14, 16, 8), s, { p: [Math.sin(ang) * r * 0.9, top - r * 0.08, Math.cos(ang) * r * 0.9], r: [0, ang + Math.PI / 2, 0] }));
      }
      out.push(bake(torus(r * 0.97, r * 0.03, Math.PI * 2, 30, 4), a, { p: [0, top - r * 0.2, 0], r: [Math.PI / 2, 0, 0] }));
      break;
    }
    case 'beanie':
      out.push(bake(new THREE.SphereGeometry(r * 1.1, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), s, { p: [0, r * 1.12, -r * 0.03], r: [-0.18, 0, 0], s: [1, 1.08, 1.04] }));
      out.push(bake(torus(r * 1.02, r * 0.12, Math.PI * 2, 28, 8), a, { p: [0, r * 1.45, r * 0.02], r: [Math.PI / 2 - 0.18, 0, 0] }));
      out.push(bake(ellipsoid(r * 0.3, r * 0.3, r * 0.3, 12, 10), { color: hat.accent ?? '#f3efe6', rough: 1 }, { p: [0, r * 2.28, -r * 0.2] }));
      break;
    case 'cap':
      out.push(bake(new THREE.SphereGeometry(r * 1.08, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), s, { p: [0, r * 1.2, 0], r: [-0.12, 0, 0] }));
      out.push(bake(ellipsoid(r * 0.8, r * 0.05, r * 0.6, 16, 6), a, { p: [0, r * 1.25, r * 0.9], r: [0.12, 0, 0] }));
      break;
    case 'hood':
      out.push(bake(new THREE.SphereGeometry(r * 1.22, 24, 14, Math.PI * 0.18, Math.PI * 1.64, 0, Math.PI * 0.72), s, { p: [0, r * 1.02, -r * 0.08], r: [0, Math.PI, 0] }));
      break;
    case 'helmet':
      out.push(bake(new THREE.SphereGeometry(r * 1.18, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), { ...s, rough: 0.35, metal: 0.6 }, { p: [0, r * 1.05, 0], r: [-0.2, 0, 0] }));
      out.push(bake(torus(r * 1.12, r * 0.05, Math.PI * 1.2, 24, 5), hat.glow ? { color: hat.glow, rough: 0.3, emit: 2.4 } : a, { p: [0, r * 1.05, 0], r: [Math.PI / 2 - 0.2, 0, Math.PI * 0.9] }));
      break;
    case 'bandana':
      out.push(bake(new THREE.SphereGeometry(r * 1.09, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), s, { p: [0, r * 1.05, -r * 0.02], r: [-0.3, 0, 0] }));
      out.push(bake(tube([[0, r * 1.3, -r * 1.0], [0, r * 1.0, -r * 1.3], [r * 0.1, r * 0.6, -r * 1.25]], r * 0.1, 8, 6, r * 0.04), s));
      break;
    case 'circlet':
      out.push(bake(torus(r * 1.02, r * 0.04, Math.PI * 2, 30, 5), { color: hat.color, rough: 0.25, metal: 1 }, { p: [0, r * 1.45, 0], r: [Math.PI / 2 - 0.15, 0, 0] }));
      out.push(bake(ellipsoid(r * 0.1, r * 0.14, r * 0.06, 8, 8), { color: hat.accent ?? '#46d6c4', rough: 0.1, emit: 1.5 }, { p: [0, r * 1.58, r * 0.98] }));
      break;
    case 'headband':
      out.push(bake(torus(r * 1.02, r * 0.07, Math.PI * 2, 28, 6), hat.glow ? { color: hat.glow, rough: 0.3, emit: 2.2 } : s, { p: [0, r * 1.38, 0], r: [Math.PI / 2 - 0.1, 0, 0] }));
      break;
    default:
      break;
  }
}

export function applyLegGradient(geo: THREE.BufferGeometry, top: number, bottom: number, c0: THREE.ColorRepresentation, c1: THREE.ColorRepresentation): void {
  gradient(geo, 'y', top, bottom, c0, c1);
}
