import * as THREE from 'three/webgpu';
import { createParticles, glowMat, mat, rng } from '../world/kit';
import type { QualityPreset } from '../render/quality';
import {
  Kit,
  TOP,
  auroraMaterial,
  blob,
  box,
  cone,
  cyl,
  dome,
  islandBase,
  prism,
  ribbonGeo,
  sphere,
  torus,
  tubeGeo,
  waterfallMaterial,
  type IslandMats,
  type Place,
  type V3,
} from './mapKit';

export type Anim = (dt: number, t: number, hover: number) => void;
export interface IslandBuild {
  root: THREE.Group;
  anim: Anim[];
  /** Highest point above the island top (m) – emblems float above it. */
  top?: number;
}
export interface IslandCtx {
  quality: QualityPreset;
  mats: IslandMats;
}
type Builder = (c: IslandCtx) => IslandBuild;

const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | V3 = 1): Place => ({ p: [x, y, z], r: [rx, ry, rz], s });
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function finish(k: Kit, c: IslandCtx, name: string, root: THREE.Group): void {
  for (const m of k.build(c.mats, name)) root.add(m);
}

/** Small animated sub-kit (boat, car, airship…) that shares the island materials. */
function subModel(c: IslandCtx, name: string, fill: (k: Kit) => void): THREE.Group {
  const k = new Kit();
  fill(k);
  const g = new THREE.Group();
  g.name = name;
  finish(k, c, name, g);
  return g;
}

function distToPoly(pts: THREE.Vector3[], x: number, z: number): number {
  let best = 1e9;
  for (const p of pts) best = Math.min(best, Math.hypot(p.x - x, p.z - z));
  return best;
}

// ───────────────────────────────────────── FOREST ─────────────────────────────────────────

const forest: Builder = (c) => {
  const k = new Kit();
  const root = new THREE.Group();
  const anim: Anim[] = [];
  const R = rng(101);
  const dens = c.quality.density;
  islandBase(k, { radius: 4.4, seed: 1.3, top: '#4a9443', top2: '#78b653', rock: '#6a5747', rock2: '#8b7660', rim: '#c2ab74' });

  // river with banks
  const rp = [V(-4.9, 0, -1.3), V(-3.1, 0, -2.1), V(-1.3, 0, -0.9), V(0.6, 0, 0.3), V(2.4, 0, 1.5), V(5.0, 0, 2.2)];
  const bank = rp.map((v) => v.clone().setY(TOP + 0.05));
  const wat = rp.map((v) => v.clone().setY(TOP + 0.085));
  k.add('solid', ribbonGeo(bank, 2.0), '#7d6444');
  k.add('metal', ribbonGeo(wat, 1.35), '#3fb2d2');
  k.add('glow', ribbonGeo(rp.map((v) => v.clone().setY(TOP + 0.1)), 0.35), '#bff6ff', {}, { glow: 0.6 });
  const curve = new THREE.CatmullRomCurve3(wat, false, 'catmullrom', 0.4);
  const rs = curve.getSpacedPoints(50);
  const near = (x: number, z: number, m: number): boolean => distToPoly(rs, x, z) < m;

  // river rocks
  for (let i = 0; i < 9; i++) {
    const p = curve.getPointAt(R());
    const side = R() > 0.5 ? 1 : -1;
    k.add('solid', blob(0.16 + R() * 0.16, i + 3, 1, 0.7), '#8d8a84', at(p.x + side * (0.78 + R() * 0.15), TOP + 0.05, p.z + side * 0.2), { flat: true, jitter: 0.1 });
  }

  const tree = (x: number, z: number, s: number, hue: number): void => {
    const th = 1.5 * s;
    k.add('solid', cyl(0.13 * s, 0.24 * s, th, 8), '#5a4131', at(x, TOP + th / 2 - 0.05, z), { jitter: 0.08 });
    const greens = hue === 0 ? ['#2d7a3d', '#3a8f47', '#4aa452'] : ['#3d8a3a', '#62a94a', '#88c25a'];
    for (let j = 0; j < 3; j++) {
      const r = (1.0 - j * 0.2) * s;
      const a = R() * 6.28;
      k.add('solid', blob(r, x * 3 + j), greens[j]!, at(x + Math.cos(a) * 0.2 * s, TOP + th + j * 0.62 * s - 0.1, z + Math.sin(a) * 0.2 * s), { flat: true, jitter: 0.1 });
    }
  };

  // ancient tree
  const ax = -1.6;
  const az = 1.2;
  k.add('solid', cyl(0.42, 0.74, 2.6, 10), '#5b4230', at(ax, TOP + 1.2, az), { jitter: 0.1 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.28 + 0.4;
    k.add('solid', tubeGeo([[ax + Math.cos(a) * 0.45, TOP + 0.8, az + Math.sin(a) * 0.45], [ax + Math.cos(a) * 0.95, TOP + 0.25, az + Math.sin(a) * 0.95], [ax + Math.cos(a) * 1.4, TOP - 0.02, az + Math.sin(a) * 1.4]], 0.14, 8, 6), '#4d3727', {}, { jitter: 0.08 });
  }
  const canopy = ['#276f38', '#2f8443', '#3b9a4c', '#4aad55', '#5cbc60'];
  for (let j = 0; j < 7; j++) {
    const a = j * 2.3;
    const rr = 1.05 + (j % 3) * 0.2;
    k.add('solid', blob(rr, 20 + j, 1, 0.85), canopy[j % 5]!, at(ax + Math.cos(a) * (0.5 + (j % 2) * 0.6), TOP + 2.9 + (j % 3) * 0.5, az + Math.sin(a) * (0.5 + (j % 2) * 0.6)), { flat: true, jitter: 0.1 });
  }
  // hollow + lights in the ancient tree
  k.add('solid', box(0.42, 0.62, 0.2), '#1d140f', at(ax + 0.05, TOP + 0.4, az + 0.66, 0, 0.1, 0));
  k.add('glow', box(0.26, 0.4, 0.06), '#ffcf7a', at(ax + 0.05, TOP + 0.36, az + 0.74, 0, 0.1, 0), { glow: 1.8 });
  // hanging vines + lantern blossoms
  for (let i = 0; i < 9; i++) {
    const a = i * 0.72 + 0.2;
    const px = ax + Math.cos(a) * 1.35;
    const pz = az + Math.sin(a) * 1.35;
    const ln = 0.6 + R() * 0.9;
    k.add('solid', tubeGeo([[px, TOP + 2.7, pz], [px + 0.05, TOP + 2.7 - ln * 0.5, pz + 0.05], [px, TOP + 2.7 - ln, pz]], 0.02, 6, 4), '#3f8a3e');
    k.add('glow', sphere(0.075, 8, 6), i % 2 ? '#ffb2e6' : '#fff0a0', at(px, TOP + 2.7 - ln, pz), { glow: 2.2 });
  }

  // trees
  const spots: Array<[number, number, number, number]> = [[-3.3, 0.4, 0.85, 0], [-3.4, 2.6, 0.7, 1], [0.2, 2.8, 0.9, 1], [1.7, -1.9, 1.0, 0], [3.3, -0.8, 0.8, 1], [-0.4, -2.7, 1.05, 0], [3.1, 3.0, 0.65, 0], [-2.2, -3.0, 0.75, 1], [-1.0, 3.3, 0.6, 0]];
  const nTrees = Math.max(4, Math.round(spots.length * Math.min(1, dens + 0.2)));
  for (let i = 0; i < nTrees; i++) {
    const [x, z, s, h] = spots[i]!;
    if (!near(x, z, 1.5) && Math.hypot(x, z) < 3.9) tree(x, z, s, h);
  }

  // shrubs, ferns, flowers
  const nb = Math.round(18 * dens);
  for (let i = 0; i < nb; i++) {
    const a = R() * 6.28;
    const rr = 0.8 + R() * 3.0;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (near(x, z, 1.15) || Math.hypot(x - ax, z - az) < 1.3) continue;
    if (R() > 0.45) k.add('solid', blob(0.2 + R() * 0.16, i, 1, 0.75), ['#3f8b3d', '#57a349', '#2f7a3a'][i % 3]!, at(x, TOP + 0.05, z), { flat: true, jitter: 0.1 });
    else {
      k.add('solid', cyl(0.012, 0.012, 0.22, 4), '#3a7d3a', at(x, TOP + 0.1, z));
      k.add('glow', sphere(0.055, 6, 5), ['#ff8fb8', '#ffe07a', '#ffffff', '#b9a0ff'][i % 4]!, at(x, TOP + 0.24, z), { glow: 1.6 });
    }
  }

  // glowing mushrooms
  const mush = (x: number, z: number, s: number, col: string): void => {
    k.add('solid', cyl(0.045 * s, 0.07 * s, 0.32 * s, 6), '#efe6cf', at(x, TOP + 0.14 * s, z));
    k.add('glow', dome(0.22 * s, 12, 6), col, at(x, TOP + 0.3 * s, z), { glow: 2.4 });
    k.add('glow', sphere(0.035 * s, 6, 4), '#ffffff', at(x + 0.07 * s, TOP + 0.47 * s, z + 0.03 * s), { glow: 3 });
    k.add('glow', sphere(0.028 * s, 6, 4), '#ffffff', at(x - 0.08 * s, TOP + 0.43 * s, z - 0.04 * s), { glow: 3 });
  };
  const mcols = ['#4de6ff', '#ff6ad8', '#7dffb2'];
  [[-0.2, 2.1, 1.3], [0.15, 2.4, 0.9], [-0.55, 2.55, 0.7], [-3.0, -1.2, 1.1], [-3.4, -0.8, 0.7], [2.8, 0.2, 1.0], [3.2, 0.7, 0.65], [1.2, -0.4, 0.6]].forEach(([x, z, s], i) => mush(x!, z!, s!, mcols[i % 3]!));

  // a mossy log + stepping stones over the river
  k.add('solid', cyl(0.16, 0.18, 1.6, 8), '#6b4f38', at(1.0, TOP + 0.18, -0.55, 0, 0.8, Math.PI / 2), { jitter: 0.08 });
  for (let i = 0; i < 4; i++) k.add('solid', cyl(0.24, 0.27, 0.12, 8), '#9a9a90', at(-0.6 + i * 0.05 + 0.1, TOP + 0.09, -0.1 + i * 0.28 + 0.3 * 0));

  finish(k, c, 'forest', root);

  // rowboat drifting along the river
  const boat = subModel(c, 'boat', (b) => {
    b.add('solid', new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#8a5a34', at(0, 0.02, 0, 0, 0, 0, [0.62, 0.3, 0.26]), { jitter: 0.08 });
    b.add('solid', new THREE.CircleGeometry(1, 16), '#c99a62', at(0, 0.0, 0, -Math.PI / 2, 0, 0, [0.6, 0.25, 1]).valueOf(), {});
    b.add('solid', box(0.06, 0.05, 0.5), '#7b4e2c', at(0.05, 0.08, 0));
    b.add('solid', cyl(0.012, 0.012, 0.85, 4), '#d9c08a', at(0.05, 0.16, 0.28, Math.PI / 2 - 0.3, 0, 0.2));
    b.add('solid', cyl(0.012, 0.012, 0.85, 4), '#d9c08a', at(0.05, 0.16, -0.28, -(Math.PI / 2 - 0.3), 0, -0.2));
    b.add('solid', cyl(0.012, 0.012, 0.5, 4), '#5b3d28', at(0.5, 0.28, 0));
    b.add('glow', sphere(0.06, 8, 6), '#ffd27a', at(0.5, 0.56, 0), { glow: 2.6 });
  });
  root.add(boat);
  anim.push((_dt, t) => {
    const u = 0.5 + 0.5 * Math.sin(t * 0.22);
    const p = curve.getPointAt(0.12 + u * 0.76);
    const tg = curve.getTangentAt(0.12 + u * 0.76);
    const dir = Math.cos(t * 0.22) >= 0 ? 1 : -1;
    boat.position.set(p.x, p.y + 0.07 + Math.sin(t * 2.1) * 0.02, p.z);
    boat.rotation.y = Math.atan2(-tg.z * dir, tg.x * dir);
    boat.rotation.z = Math.sin(t * 1.7) * 0.03;
  });

  // fireflies
  root.add(Object.assign(createParticles({ count: 46, min: [-4, TOP + 0.2, -4], max: [4, TOP + 3.6, 4], color: '#c8ff8a', color2: '#7fffd6', size: 0.1, motion: 'float', speed: 0.6, twinkle: 0.9, quality: c.quality }), { name: 'fireflies' }));
  return { root, anim, top: 6.6 };
};

// ───────────────────────────────────────── TEMPLE ─────────────────────────────────────────

const temple: Builder = (c) => {
  const k = new Kit();
  const root = new THREE.Group();
  const anim: Anim[] = [];
  const R = rng(202);
  islandBase(k, { radius: 4.5, seed: 2.6, top: '#557a4a', top2: '#3d6b48', rock: '#75746a', rock2: '#5c6b62', rim: '#8a8a70' });
  const stone = '#b5b09e';
  const stone2 = '#9a9684';
  const moss = '#5f8f4c';

  // stepped platform
  const tiers: Array<[number, number, number, number]> = [[5.6, 0.3, 4.4, 0.15], [4.7, 0.3, 3.6, 0.45], [3.9, 0.3, 2.9, 0.75]];
  tiers.forEach(([w, h, d, y], i) => {
    k.add('solid', box(w, h, d), i % 2 ? stone2 : stone, at(0, TOP + y, -0.3), { jitter: 0.06 });
    k.add('solid', box(w + 0.04, 0.05, d + 0.04), moss, at(0, TOP + y + h / 2 + 0.005, -0.3), { jitter: 0.1 });
  });
  const floorY = TOP + 0.75 + 0.15;

  // columns (some broken)
  const col = (x: number, z: number, h: number, capital: boolean): void => {
    k.add('solid', cyl(0.27, 0.3, 0.14, 10), stone2, at(x, floorY + 0.07, z));
    k.add('solid', cyl(0.19, 0.21, h, 10), stone, at(x, floorY + 0.14 + h / 2, z), { jitter: 0.08, flat: true });
    if (capital) {
      k.add('solid', cyl(0.25, 0.19, 0.12, 10), stone2, at(x, floorY + 0.14 + h + 0.06, z));
      k.add('solid', box(0.58, 0.12, 0.58), stone, at(x, floorY + 0.14 + h + 0.18, z));
    } else {
      k.add('solid', blob(0.2, 4, 0, 0.5), stone, at(x, floorY + 0.14 + h, z), { flat: true });
    }
  };
  const fx = [-1.5, -0.5, 0.5, 1.5];
  col(fx[0]!, 0.6, 1.55, true);
  col(fx[1]!, 0.6, 1.55, true);
  col(fx[2]!, 0.6, 0.85, false);
  col(fx[3]!, 0.6, 0.4, false);
  col(-1.5, -1.2, 1.55, true);
  col(0.9, -1.2, 1.1, false);
  // fallen column
  k.add('solid', cyl(0.19, 0.21, 1.3, 10), stone, at(1.6, floorY + 0.2, 1.0, 0, 0.5, Math.PI / 2), { jitter: 0.08, flat: true });
  // architrave + pediment (left half survives)
  k.add('solid', box(2.4, 0.3, 0.7), stone, at(-1.0, floorY + 0.14 + 1.55 + 0.36, 0.6), { jitter: 0.06 });
  k.add('solid', prism(2.7, 0.7, 0.62), stone2, at(-1.0, floorY + 0.14 + 1.55 + 0.51, 0.6), { flat: true });
  k.add('solid', box(0.8, 0.3, 0.7), stone, at(0.6, floorY + 0.14 + 1.55 + 0.36, 0.6, 0, 0, -0.35));
  // back wall with dark doorway and jade runes
  k.add('solid', box(3.4, 2.2, 0.36), stone, at(-0.15, floorY + 1.1, -1.75), { jitter: 0.07 });
  k.add('solid', box(0.95, 1.5, 0.4), '#1c2a26', at(-0.15, floorY + 0.75, -1.72));
  k.add('solid', dome(0.475, 12, 6), '#1c2a26', at(-0.15, floorY + 1.5, -1.72, 0, 0, 0, [1, 1, 0.9]));
  k.add('glow', torus(0.28, 0.025, Math.PI * 2, 24, 6), '#4dffc4', at(-0.15, floorY + 1.75, -1.5), { glow: 2.4 });
  k.add('glow', torus(0.16, 0.02, Math.PI * 2, 20, 6), '#4dffc4', at(-0.15, floorY + 1.75, -1.5), { glow: 2.4 });
  for (let i = 0; i < 6; i++) k.add('glow', box(0.05, 0.16 + (i % 2) * 0.06, 0.02), '#4dffc4', at(-1.35 + i * 0.16, floorY + 1.55 + (i % 3) * 0.12, -1.55), { glow: 2 });
  // rubble
  for (let i = 0; i < 7; i++) k.add('solid', box(0.2 + R() * 0.22, 0.16 + R() * 0.12, 0.2 + R() * 0.2), i % 2 ? stone : stone2, at(0.8 + R() * 1.6, floorY + 0.08, -0.3 + R() * 1.9, R() * 0.5, R() * 3, R() * 0.5), { jitter: 0.1 });

  // waterfall cliff
  for (let i = 0; i < 4; i++) k.add('solid', blob(1.15 - i * 0.12, 30 + i, 1, 1.3), i % 2 ? '#6c6a5f' : '#7b7a6d', at(-2.7 + (i % 2) * 0.35, TOP + 0.9 + i * 0.75, -2.15 + (i % 2) * 0.1), { flat: true, jitter: 0.1 });
  k.add('solid', blob(0.9, 44, 1, 0.5), '#5f9a4a', at(-2.7, TOP + 3.5, -2.2), { flat: true, jitter: 0.1 });
  // jade pool
  k.add('solid', torus(1.15, 0.15, Math.PI * 2, 24, 6), stone2, at(-2.1, TOP + 0.05, 0.05, Math.PI / 2, 0, 0), { jitter: 0.1 });
  k.add('glow', new THREE.CircleGeometry(1.08, 28), '#2fd6a2', at(-2.1, TOP + 0.09, 0.05, -Math.PI / 2), { glow: 0.95 });
  // lilies
  for (let i = 0; i < 4; i++) k.add('solid', new THREE.CircleGeometry(0.13, 8), '#3f9c58', at(-2.5 + i * 0.28, TOP + 0.11, -0.2 + (i % 2) * 0.5, -Math.PI / 2));
  k.add('glow', sphere(0.06, 8, 6), '#ffb6d9', at(-2.05, TOP + 0.17, 0.3), { glow: 2 });

  // torches
  const flames: THREE.Mesh[] = [];
  const flameMat = glowMat('#ff9a3a', 3.2);
  const tp: Array<[number, number]> = [[-2.6, 1.3], [2.6, 1.3], [-2.6, -1.9], [2.7, -1.9]];
  tp.forEach(([x, z], i) => {
    k.add('solid', cyl(0.045, 0.06, 1.2, 6), '#3d2c22', at(x, floorY - 0.15 + 0.6 - 0.5 * 0, z));
    k.add('solid', cyl(0.17, 0.09, 0.16, 8), '#2b2b2b', at(x, floorY + 1.06 - 0.15, z));
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.46, 7), flameMat);
    f.position.set(x!, floorY + 1.28 - 0.15, z!);
    f.name = `flame${i}`;
    flames.push(f);
    root.add(f);
  });
  anim.push((_dt, t) => {
    flames.forEach((f, i) => {
      const s = 1 + Math.sin(t * 9 + i * 2.1) * 0.12 + Math.sin(t * 17 + i) * 0.08;
      f.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      f.rotation.z = Math.sin(t * 6 + i) * 0.08;
    });
  });

  // jungle
  const palm = (x: number, z: number, s: number): void => {
    k.add('solid', tubeGeo([[x, TOP, z], [x + 0.15 * s, TOP + 0.9 * s, z], [x + 0.05, TOP + 1.8 * s, z + 0.05]], 0.09 * s, 8, 6), '#6b563e');
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28;
      k.add('solid', cone(0.16 * s, 1.1 * s, 4), i % 2 ? '#2f7d48' : '#3f9757', at(x + 0.05 + Math.cos(a) * 0.5 * s, TOP + 1.85 * s, z + Math.sin(a) * 0.5 * s, Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25), { flat: true });
    }
  };
  palm(2.9, -1.0, 1.0);
  palm(-3.5, 1.7, 0.85);
  palm(3.3, 2.3, 0.75);
  for (let i = 0; i < 14; i++) {
    const a = R() * 6.28;
    const rr = 3.0 + R() * 0.9;
    k.add('solid', blob(0.22 + R() * 0.2, i, 1, 0.7), ['#3a7a4a', '#2f6a44', '#4f8a4f'][i % 3]!, at(Math.cos(a) * rr, TOP + 0.05, Math.sin(a) * rr), { flat: true, jitter: 0.1 });
  }
  // hanging vines from the roof
  for (let i = 0; i < 5; i++) k.add('solid', tubeGeo([[-1.9 + i * 0.5, floorY + 2.05, 0.8], [-1.9 + i * 0.5 + 0.04, floorY + 1.7, 0.85], [-1.9 + i * 0.5, floorY + 1.3 - R() * 0.4, 0.85]], 0.018, 6, 4), '#3f8a3e');
  finish(k, c, 'temple', root);

  // waterfall sheet + splash
  const wf = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 3.5), waterfallMaterial('#6ff0d0', '#e9fffa'));
  wf.position.set(-2.55, TOP + 2.05, -0.95);
  wf.renderOrder = 2;
  root.add(wf);
  const wf2 = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 3.3), waterfallMaterial('#59e0c0', '#dcfff6'));
  wf2.position.set(-2.0, TOP + 1.95, -1.05);
  wf2.renderOrder = 2;
  root.add(wf2);
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 32), glowMat('#c8fff0', 1.4, 0.8));
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(-2.3, TOP + 0.13, -0.3);
  root.add(ripple);
  anim.push((_dt, t) => {
    const p = (t * 0.5) % 1;
    ripple.scale.setScalar(1 + p * 2.4);
    (ripple.material as THREE.MeshBasicNodeMaterial).opacity = (1 - p) * 0.8;
  });
  // floating jade idol
  const idol = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), glowMat('#3dffc0', 2.0));
  idol.scale.set(1, 1.5, 1);
  idol.position.set(-0.15, floorY + 1.45, -0.6);
  root.add(idol);
  anim.push((_dt, t) => {
    idol.rotation.y = t * 0.9;
    idol.position.y = floorY + 1.45 + Math.sin(t * 1.4) * 0.1;
  });
  root.add(createParticles({ count: 40, min: [-3, floorY, -2.6], max: [3, floorY + 3.2, 1.6], color: '#ff9c48', color2: '#ffd27a', size: 0.06, motion: 'rise', speed: 0.5, opacity: 0.9, quality: c.quality }));
  root.add(createParticles({ count: 18, min: [-3, TOP + 0.1, -1.4], max: [-1.4, TOP + 1.3, 0.8], color: '#8fffe0', size: 0.07, motion: 'float', speed: 0.5, twinkle: 0.8, quality: c.quality }));
  return { root, anim, top: 4.9 };
};

// ───────────────────────────────────────── NEON ─────────────────────────────────────────

const neon: Builder = (c) => {
  const k = new Kit();
  const root = new THREE.Group();
  const anim: Anim[] = [];
  const R = rng(303);
  islandBase(k, { radius: 4.5, seed: 4.1, top: '#232a4a', top2: '#2e3560', rock: '#2d2745', rock2: '#41345f', rim: '#6d4ba8' });

  // canal
  const cp = [V(-4.9, 0, 0.9), V(-2.6, 0, 0.1), V(-0.5, 0, 0.5), V(1.6, 0, 0.7), V(3.2, 0, 0.0), V(5.0, 0, -0.5)];
  k.add('solid', ribbonGeo(cp.map((v) => v.clone().setY(TOP + 0.05)), 1.65), '#0f1428');
  k.add('glow', ribbonGeo(cp.map((v) => v.clone().setY(TOP + 0.08)), 1.05), '#19d8ff', {}, { glow: 1.6 });
  k.add('glow', ribbonGeo(cp.map((v) => v.clone().setY(TOP + 0.085).add(V(0, 0, 0.6))), 0.06), '#ff3fd0', {}, { glow: 2.8 });
  k.add('glow', ribbonGeo(cp.map((v) => v.clone().setY(TOP + 0.085).add(V(0, 0, -0.6))), 0.06), '#ff3fd0', {}, { glow: 2.8 });

  // road + bridge
  const roadX = 0.85;
  k.add('solid', ribbonGeo([V(roadX, TOP + 0.05, -3.2), V(roadX, TOP + 0.05, 0), V(roadX, TOP + 0.05, 3.4)], 0.8), '#171b30');
  for (let i = 0; i < 9; i++) k.add('glow', box(0.05, 0.01, 0.22), '#ffd76a', at(roadX, TOP + 0.075, -2.8 + i * 0.72), { glow: 1.4 });
  k.add('solid', box(0.95, 0.12, 1.6), '#20263f', at(roadX, TOP + 0.24, 0.5), { jitter: 0.05 });
  for (const s of [-1, 1]) {
    k.add('glow', box(0.045, 0.05, 1.6), '#ff45d8', at(roadX + s * 0.45, TOP + 0.5, 0.5), { glow: 2.6 });
    k.add('glow', box(0.03, 0.03, 1.6), '#ff45d8', at(roadX + s * 0.45, TOP + 0.36, 0.5), { glow: 1.8 });
    for (let i = 0; i < 3; i++) k.add('solid', cyl(0.02, 0.02, 0.3, 5), '#2c3358', at(roadX + s * 0.45, TOP + 0.4, -0.15 + i * 0.65));
  }
  k.add('glow', torus(0.55, 0.03, Math.PI, 20, 6), '#19d8ff', at(roadX, TOP + 0.3, 0.5, 0, Math.PI / 2, 0), { glow: 2.2 });

  // buildings
  const pal = ['#2a3f8f', '#4b2f96', '#1f5a94', '#3c2a86', '#2450a8'];
  const bl: Array<[number, number, number, number, number]> = [
    [-3.0, -2.3, 1.3, 1.5, 2.7], [-1.3, -2.7, 1.2, 1.3, 4.3], [-0.15, -1.9, 1.0, 1.1, 2.6], [1.95, -2.5, 1.3, 1.4, 2.2], [3.3, -1.7, 1.2, 1.3, 3.5],
    [-3.3, 2.5, 1.2, 1.3, 1.9], [-1.6, 2.8, 1.0, 1.1, 3.0], [2.0, 2.6, 1.4, 1.2, 2.1], [3.4, 2.0, 1.0, 1.0, 2.7], [-0.4, 3.2, 0.8, 0.8, 1.5],
  ];
  const beacons: THREE.Mesh[] = [];
  const bMat = glowMat('#ff2a3a', 4);
  const signs: THREE.Mesh[] = [];
  const signCols = ['#ff3fd0', '#19d8ff', '#ffe14a', '#7dff6a'];
  bl.forEach(([x, z, w, d, h], i) => {
    const cc = pal[i % pal.length]!;
    k.add('bld', box(w, h, d), cc, at(x, TOP + h / 2, z), { jitter: 0.05 });
    k.add('solid', box(w + 0.12, 0.1, d + 0.12), '#1f2b66', at(x, TOP + h + 0.05, z));
    if (h > 2.4) {
      k.add('solid', box(w * 0.55, 0.28, d * 0.55), '#2a3878', at(x, TOP + h + 0.24, z));
      k.add('solid', cyl(0.018, 0.018, 0.8, 4), '#8890b8', at(x + 0.1, TOP + h + 0.65, z + 0.05));
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bMat);
      b.position.set(x! + 0.1, TOP + h + 1.07, z! + 0.05);
      beacons.push(b);
      root.add(b);
    }
    // neon edge trim on tall towers
    if (h > 2.5) {
      const tc = signCols[i % 4]!;
      k.add('glow', box(w + 0.13, 0.04, 0.04), tc, at(x, TOP + h + 0.02, z + d / 2 + 0.06), { glow: 2.6 });
      k.add('glow', box(w + 0.13, 0.04, 0.04), tc, at(x, TOP + h + 0.02, z - d / 2 - 0.06), { glow: 2.6 });
      k.add('glow', box(0.04, h * 0.8, 0.04), tc, at(x + w / 2 + 0.03, TOP + h * 0.5, z + d / 2 + 0.03), { glow: 1.8 });
    }
    // vertical sign boards facing the street
    if (i % 2 === 0) {
      const sg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.34), glowMat(signCols[(i + 1) % 4]!, 3.2));
      const sz = z! > 0 ? z! - d! / 2 - 0.08 : z! + d! / 2 + 0.08;
      sg.position.set(x! + w! * 0.25, TOP + h! * 0.55, sz);
      sg.rotation.y = Math.PI / 2;
      signs.push(sg);
      root.add(sg);
    }
  });
  // street lamps + neon stripes on the ground
  for (let i = 0; i < 8; i++) {
    const a = i * 0.9 + 0.3;
    const x = Math.cos(a) * 3.8;
    const z = Math.sin(a) * 3.4;
    k.add('solid', cyl(0.02, 0.025, 0.7, 5), '#3b4270', at(x, TOP + 0.35, z));
    k.add('glow', sphere(0.06, 8, 6), '#8ff4ff', at(x, TOP + 0.74, z), { glow: 2.6 });
  }
  // little boats in the canal
  k.add('glow', box(0.32, 0.05, 0.14), '#ffe14a', at(-2.5, TOP + 0.14, 0.15, 0, 0.25, 0), { glow: 2 });
  k.add('solid', box(0.28, 0.06, 0.1), '#1a2040', at(-2.5, TOP + 0.18, 0.15, 0, 0.25, 0));

  // holo ring on the tallest tower
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.028, 6, 48), glowMat('#ff45d8', 3));
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.022, 6, 40), glowMat('#19d8ff', 3));
  const ringC = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.018, 6, 56), glowMat('#ffe14a', 2.4));
  const holo = new THREE.Group();
  holo.add(ringA, ringB, ringC);
  holo.position.set(-1.3, TOP + 5.75, -2.7);
  root.add(holo);
  finish(k, c, 'neon', root);
  // hover cars on the bridge
  const car = (col: string): THREE.Group =>
    subModel(c, 'car', (m) => {
      m.add('solid', box(0.3, 0.07, 0.15), '#10132a', at(0, 0, 0));
      m.add('solid', box(0.15, 0.06, 0.12), '#2b3358', at(-0.02, 0.06, 0));
      m.add('glow', box(0.32, 0.015, 0.13), col, at(0, -0.04, 0), { glow: 2.6 });
      m.add('glow', box(0.02, 0.03, 0.1), '#fff7d0', at(0.16, 0.0, 0), { glow: 3.2 });
    });
  const cars = [car('#19d8ff'), car('#ff45d8')];
  cars.forEach((cg) => root.add(cg));
  anim.push((_dt, t) => {
    holo.rotation.y = t * 0.8;
    ringA.rotation.x = Math.PI / 2 + Math.sin(t * 1.3) * 0.25;
    ringB.rotation.x = Math.PI / 2 + Math.cos(t * 1.7) * 0.4;
    ringB.rotation.z = t * 1.2;
    ringC.rotation.x = Math.PI / 2;
    ringC.rotation.z = -t * 0.5;
    holo.position.y = TOP + 5.75 + Math.sin(t * 1.2) * 0.1;
    beacons.forEach((b, i) => (b.visible = Math.sin(t * 3.2 + i * 1.7) > -0.2));
    signs.forEach((s, i) => (s.visible = Math.sin(t * 2.3 + i * 2.0) + 0.6 * Math.sin(t * 11 + i * 3) > -0.9));
    cars.forEach((cg, i) => {
      const u = ((t * 0.16 + i * 0.5) % 1) * (i ? -1 : 1);
      const zz = i ? 3.0 - ((t * 0.16 + i * 0.5) % 1) * 6.2 : -2.8 + ((t * 0.16 + i * 0.5) % 1) * 6.2;
      void u;
      cg.position.set(roadX + (i ? 0.17 : -0.17), TOP + (Math.abs(zz - 0.5) < 0.8 ? 0.42 : 0.16) + Math.sin(t * 3 + i) * 0.015, zz);
      cg.rotation.y = i ? Math.PI / 2 : -Math.PI / 2;
    });
  });
  root.add(createParticles({ count: 34, min: [-4, TOP + 0.2, -3.5], max: [4, TOP + 5, 3.5], color: '#19d8ff', color2: '#ff45d8', size: 0.07, motion: 'rise', speed: 0.6, twinkle: 0.7, quality: c.quality }));
  void R;
  return { root, anim, top: 7.2 };
};

// ───────────────────────────────────────── HARBOR ─────────────────────────────────────────

const harbor: Builder = (c) => {
  const k = new Kit();
  const root = new THREE.Group();
  const anim: Anim[] = [];
  const R = rng(404);
  islandBase(k, { radius: 4.4, seed: 5.2, top: '#7cb659', top2: '#a2cf6c', rock: '#8c7f76', rock2: '#ab9c8c', rim: '#d5c39a', floating: true });
  // hanging rock spikes + roots
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1 + 0.4;
    k.add('solid', cone(0.35 + R() * 0.2, 1.4 + R() * 1.6, 6), i % 2 ? '#8b7d72' : '#a69787', at(Math.cos(a) * 2.6, TOP - 1.7 - R(), Math.sin(a) * 2.6, Math.PI, 0, 0), { flat: true, jitter: 0.1 });
  }
  const marble = '#f3ecdc';
  const gold = '#f3b73c';
  // plaza + basilica
  k.add('solid', cyl(2.1, 2.2, 0.16, 20), '#e6dcc4', at(-0.4, TOP + 0.06, -0.5), { jitter: 0.05 });
  k.add('solid', cyl(1.55, 1.65, 0.22, 20), marble, at(-0.4, TOP + 0.24, -0.5));
  k.add('solid', cyl(1.22, 1.28, 1.0, 20), marble, at(-0.4, TOP + 0.85, -0.5), { jitter: 0.03 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * 6.28;
    k.add('solid', cyl(0.07, 0.08, 1.05, 8), '#fffaf0', at(-0.4 + Math.cos(a) * 1.36, TOP + 0.85, -0.5 + Math.sin(a) * 1.36));
    k.add('glow', box(0.1, 0.26, 0.05), '#ffd58a', at(-0.4 + Math.cos(a + 0.31) * 1.24, TOP + 0.85, -0.5 + Math.sin(a + 0.31) * 1.24, 0, -(a + 0.31), 0), { glow: 1.6 });
  }
  k.add('metal', torus(1.32, 0.07, Math.PI * 2, 32, 6), gold, at(-0.4, TOP + 1.38, -0.5, Math.PI / 2, 0, 0));
  k.add('metal', dome(1.32, 32, 14), gold, at(-0.4, TOP + 1.36, -0.5, 0, 0, 0, [1, 1.05, 1]));
  k.add('metal', torus(1.0, 0.03, Math.PI * 2, 32, 5), '#ffd97a', at(-0.4, TOP + 1.85, -0.5, Math.PI / 2, 0, 0));
  k.add('metal', cyl(0.06, 0.1, 0.5, 8), gold, at(-0.4, TOP + 2.95, -0.5));
  k.add('metal', sphere(0.13, 12, 8), '#ffe08a', at(-0.4, TOP + 3.25, -0.5));
  k.add('glow', sphere(0.06, 8, 6), '#fff2c0', at(-0.4, TOP + 3.46, -0.5), { glow: 4 });
  // houses
  const house = (x: number, z: number, w: number, d: number, h: number, ry: number, roof: string): void => {
    k.add('solid', box(w, h, d), '#f5eddc', at(x, TOP + h / 2, z, 0, ry, 0), { jitter: 0.04 });
    k.add('solid', prism(w + 0.18, 0.5, d + 0.16), roof, at(x, TOP + h, z, 0, ry, 0), { flat: true, jitter: 0.06 });
    k.add('glow', box(0.14, 0.18, 0.04), '#ffd58a', at(x + Math.cos(ry) * 0.2, TOP + h * 0.6, z - Math.sin(ry) * 0.2 + (d / 2 + 0.01) * Math.cos(ry), 0, ry, 0), { glow: 1.7 });
    k.add('solid', box(0.16, 0.28, 0.05), '#5b4030', at(x - Math.cos(ry) * 0.2, TOP + 0.16, z + Math.sin(ry) * 0.2 + (d / 2 + 0.01) * Math.cos(ry), 0, ry, 0));
  };
  house(2.4, 0.2, 0.9, 0.8, 0.8, -0.3, '#c9603c');
  house(2.2, -1.6, 0.8, 0.8, 0.95, 0.3, '#b8543a');
  house(-2.9, 1.5, 0.85, 0.75, 0.7, 0.2, '#d0703f');
  house(0.9, 2.4, 0.75, 0.7, 0.6, 0.0, '#c9603c');
  // lighthouse
  for (let i = 0; i < 5; i++) k.add('solid', cyl(0.3 - i * 0.03, 0.34 - i * 0.03, 0.5, 12), i % 2 ? '#d8482f' : '#faf5ea', at(-2.9, TOP + 0.25 + i * 0.5, -1.9));
  k.add('solid', cyl(0.36, 0.3, 0.1, 12), '#2b2b33', at(-2.9, TOP + 2.55, -1.9));
  k.add('glow', cyl(0.2, 0.2, 0.32, 10), '#fff0b0', at(-2.9, TOP + 2.76, -1.9), { glow: 3.6 });
  k.add('metal', cone(0.32, 0.4, 10), gold, at(-2.9, TOP + 3.12, -1.9));
  // pier (cantilevered deck)
  k.add('solid', box(2.6, 0.12, 0.95), '#9a6b44', at(3.9, TOP + 0.02, 1.9, 0, -0.5, 0), { jitter: 0.1 });
  for (let i = 0; i < 6; i++) k.add('solid', box(0.02, 0.005, 0.95), '#6f4a2c', at(3.9 + (i - 2.5) * 0.4 * Math.cos(-0.5), TOP + 0.085, 1.9 - (i - 2.5) * 0.4 * Math.sin(-0.5), 0, -0.5, 0));
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) {
      const px = 3.9 + Math.cos(-0.5) * e * 1.2 - Math.sin(-0.5) * s * 0.46;
      const pz = 1.9 - Math.sin(-0.5) * e * 1.2 + Math.cos(-0.5) * s * 0.46;
      k.add('solid', cyl(0.04, 0.05, 0.6, 6), '#5b3d28', at(px, TOP + 0.35, pz));
      k.add('glow', sphere(0.07, 8, 6), '#ffd27a', at(px, TOP + 0.7, pz), { glow: 2.8 });
    }
  }
  k.add('solid', box(0.28, 0.24, 0.28), '#b98a52', at(3.4, TOP + 0.2, 1.5, 0, 0.3, 0));
  k.add('solid', cyl(0.13, 0.13, 0.3, 8), '#8a4a34', at(4.4, TOP + 0.23, 2.2));
  // flag poles
  for (const [fx2, fz2, col] of [[-0.4, 1.0, '#d8482f'], [2.9, 1.0, '#2f6fd8']] as Array<[number, number, string]>) {
    k.add('solid', cyl(0.02, 0.02, 1.3, 5), '#e8dcc0', at(fx2, TOP + 0.65, fz2));
    k.add('solid', prism(0.34, 0.5, 0.02), col, at(fx2 + 0.2, TOP + 1.05, fz2, 0, 0, -Math.PI / 2 + 0));
  }
  // trees
  for (let i = 0; i < 6; i++) {
    const a = 0.7 + i * 1.05;
    const x = Math.cos(a) * 3.55;
    const z = Math.sin(a) * 3.35;
    if (x > 2.6 && z > 0.8) continue;
    k.add('solid', cyl(0.05, 0.08, 0.6, 5), '#6b4a34', at(x, TOP + 0.3, z));
    k.add('solid', blob(0.42, i, 1, 1.05), i % 2 ? '#4f9a4a' : '#68b04f', at(x, TOP + 0.85, z), { flat: true, jitter: 0.1 });
  }
  finish(k, c, 'harbor', root);

  // stream falling off the island edge
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 7.5), waterfallMaterial('#9adcff', '#ffffff', true));
  fall.position.set(-4.0, TOP - 3.7, 0.9);
  fall.rotation.y = Math.PI / 2 - 0.35;
  fall.renderOrder = 2;
  root.add(fall);
  const fall2 = fall.clone();
  fall2.rotation.y = -0.35;
  root.add(fall2);

  // clouds around & below
  const ck = new Kit();
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7 + 0.4;
    const rr = 4.2 + R() * 4.5;
    const cx = Math.cos(a) * rr;
    const cz = Math.sin(a) * rr;
    const cy = -2.8 - R() * 3.6;
    for (let j = 0; j < 4; j++) ck.add('solid', blob(0.9 + R() * 0.7, i * 7 + j, 1, 0.62), '#fff3e6', at(cx + (j - 1.5) * 0.95, cy + (j % 2) * 0.25, cz + (R() - 0.5) * 0.8), { flat: false, jitter: 0.03 });
  }
  const cm = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#fff2e2'), roughness: 1, metalness: 0 });
  cm.emissive = new THREE.Color('#ffc9a0');
  cm.emissiveIntensity = 0.45;
  const clouds = new THREE.Group();
  for (const m of ck.build({ solid: cm }, 'clouds')) {
    m.castShadow = false;
    clouds.add(m);
  }
  root.add(clouds);

  // airship circling the island
  const ship = subModel(c, 'airship', (m) => {
    m.add('solid', new THREE.SphereGeometry(1, 20, 12), '#f1e2c2', at(0, 0.15, 0, 0, 0, 0, [1.05, 0.42, 0.42]), { jitter: 0.02 });
    m.add('solid', new THREE.SphereGeometry(1, 20, 12), '#c9483a', at(0.15, 0.15, 0, 0, 0, 0, [0.16, 0.435, 0.435]));
    m.add('solid', new THREE.SphereGeometry(1, 20, 12), '#c9483a', at(-0.5, 0.15, 0, 0, 0, 0, [0.12, 0.425, 0.425]));
    m.add('solid', box(0.42, 0.13, 0.2), '#6b4a2e', at(0.05, -0.4, 0));
    m.add('glow', box(0.3, 0.05, 0.21), '#ffd58a', at(0.05, -0.38, 0), { glow: 2.2 });
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) m.add('solid', box(0.32, 0.02, 0.24), '#c9483a', at(-0.95, 0.15 + Math.sin(a) * 0.15, Math.cos(a) * 0.15, a, 0, 0), {});
    m.add('solid', cyl(0.012, 0.012, 0.3, 4), '#8a7a60', at(-0.05, -0.2, 0.12));
    m.add('solid', cyl(0.012, 0.012, 0.3, 4), '#8a7a60', at(0.2, -0.2, -0.12));
  });
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.03), mat('#3a2a20', 0.6));
  prop.position.set(-1.0, -0.4, 0);
  ship.add(prop);
  ship.scale.setScalar(1.25);
  root.add(ship);
  anim.push((_dt, t, hover) => {
    const a = t * 0.34;
    ship.position.set(Math.cos(a) * 6.6, TOP + 3.6 + Math.sin(t * 0.9) * 0.22 + hover * 0.3, Math.sin(a) * 4.9);
    ship.rotation.y = Math.atan2(-Math.cos(a) * 4.9, -Math.sin(a) * 6.6);
    ship.rotation.z = Math.sin(t * 0.7) * 0.05;
    prop.rotation.x = t * 30;
    clouds.position.x = Math.sin(t * 0.1) * 0.8;
    clouds.position.z = Math.cos(t * 0.08) * 0.6;
  });
  root.add(createParticles({ count: 26, min: [-4, TOP + 0.5, -4], max: [4, TOP + 4, 4], color: '#fff3c8', size: 0.08, motion: 'float', speed: 0.5, twinkle: 0.6, opacity: 0.7, quality: c.quality }));
  return { root, anim, top: 4.6 };
};

// ───────────────────────────────────────── ICE ─────────────────────────────────────────

const ice: Builder = (c) => {
  const k = new Kit();
  const root = new THREE.Group();
  const anim: Anim[] = [];
  const R = rng(505);
  islandBase(k, { radius: 4.4, seed: 6.3, top: '#eef6ff', top2: '#d4e8fb', rock: '#8fc4e4', rock2: '#c4e6f8', rim: '#f6fbff' });
  // frozen pond
  k.add('ice', new THREE.CircleGeometry(1.3, 24), '#8fd4f2', at(1.3, TOP + 0.04, 1.6, -Math.PI / 2, 0, 0, [1.2, 1.0, 1]));
  // crystals
  const crystal = (x: number, z: number, h: number, r: number, tilt: number, kind: 'ice' | 'glow' = 'ice'): void => {
    const ry = R() * 6;
    k.add(kind, cone(r, h, 6), kind === 'ice' ? '#a4dcf6' : '#6fe6ff', at(x, TOP + h / 2 - 0.05, z, tilt * Math.cos(ry), ry, tilt * Math.sin(ry)), kind === 'ice' ? { flat: true, jitter: 0.08, grad: ['#f3fbff', TOP, TOP + h] } : { flat: true, glow: 0.9 });
    k.add(kind, cyl(r * 0.95, r * 1.1, h * 0.35, 6), kind === 'ice' ? '#8ecfee' : '#59d8f5', at(x, TOP + h * 0.17, z, tilt * Math.cos(ry), ry, tilt * Math.sin(ry)), kind === 'ice' ? { flat: true, jitter: 0.06 } : { flat: true, glow: 0.7 });
  };
  crystal(-1.4, -1.6, 4.6, 0.85, 0.05);
  crystal(-2.3, -1.0, 3.2, 0.6, -0.18);
  crystal(-0.2, -2.3, 3.6, 0.65, 0.16);
  crystal(-2.9, -2.1, 2.3, 0.5, -0.1, 'glow');
  crystal(0.9, -2.2, 2.1, 0.42, 0.22);
  crystal(-1.0, -0.6, 1.5, 0.35, 0.1, 'glow');
  crystal(3.0, -1.2, 1.5, 0.4, 0.2);
  crystal(3.3, 0.4, 0.9, 0.3, -0.2, 'glow');
  for (let i = 0; i < 12; i++) {
    const a = R() * 6.28;
    const rr = 2 + R() * 2.2;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (z < -0.5 && Math.abs(x) < 3) continue;
    k.add('ice', cone(0.1 + R() * 0.12, 0.4 + R() * 0.6, 5), '#b9e5fa', at(x, TOP + 0.15, z, R() * 0.3, R() * 6, R() * 0.3), { flat: true, jitter: 0.08 });
  }
  // snow drifts
  for (let i = 0; i < 12; i++) {
    const a = R() * 6.28;
    const rr = 0.8 + R() * 3.3;
    k.add('solid', blob(0.3 + R() * 0.35, i, 1, 0.45), '#f7fbff', at(Math.cos(a) * rr, TOP + 0.02, Math.sin(a) * rr), { jitter: 0.03 });
  }

  // research tent
  const tx = -1.5;
  const tz = 1.7;
  k.add('solid', prism(1.7, 1.25, 2.1), '#ff7a2c', at(tx, TOP, tz, 0, 0.3, 0), { flat: true, jitter: 0.05 });
  k.add('solid', prism(1.72, 0.12, 2.12), '#ffffff', at(tx, TOP + 1.15, tz, 0, 0.3, 0), { flat: true });
  const cs = Math.cos(0.3);
  const sn = Math.sin(0.3);
  k.add('solid', prism(0.72, 0.85, 0.08), '#2a2f3d', at(tx + sn * 1.05, TOP, tz + cs * 1.05, 0, 0.3, 0));
  k.add('glow', prism(0.5, 0.62, 0.06), '#ffcf88', at(tx + sn * 1.08, TOP, tz + cs * 1.08, 0, 0.3, 0), { glow: 2.0 });
  for (const s of [-1, 1]) {
    const gx = tx + Math.cos(0.3) * s * 1.6 + sn * 0.9;
    const gz = tz - Math.sin(0.3) * s * 1.6 + cs * 0.9;
    k.add('solid', tubeGeo([[tx + sn * 0.5, TOP + 1.0, tz + cs * 0.5], [(tx + gx) / 2, TOP + 0.5, (tz + gz) / 2], [gx, TOP + 0.03, gz]], 0.008, 6, 4), '#3a3f4c');
    k.add('solid', cone(0.03, 0.14, 4), '#d6d6d6', at(gx, TOP + 0.05, gz));
  }
  // antenna / weather station
  k.add('solid', cyl(0.03, 0.04, 1.9, 6), '#8e98aa', at(0.7, TOP + 0.95, 0.4));
  k.add('solid', box(0.3, 0.22, 0.2), '#dfe6ee', at(0.7, TOP + 1.2, 0.4));
  k.add('metal', dome(0.3, 14, 6), '#dfe8f2', at(0.75, TOP + 1.7, 0.4, -0.7, 0.4, 0), { flat: false });
  k.add('glow', sphere(0.05, 8, 6), '#ff3a3a', at(0.7, TOP + 1.95, 0.4), { glow: 3.5 });
  // flag
  k.add('solid', cyl(0.018, 0.018, 1.5, 5), '#ccd3dc', at(-2.8, TOP + 0.75, 0.6));
  k.add('solid', box(0.5, 0.3, 0.02), '#e0392e', at(-2.55, TOP + 1.3, 0.6));
  // crates, barrels, sled
  k.add('solid', box(0.42, 0.34, 0.42), '#6f7d52', at(0.2, TOP + 0.17, 2.6, 0, 0.4, 0), { jitter: 0.06 });
  k.add('solid', box(0.32, 0.28, 0.32), '#8a6f45', at(0.55, TOP + 0.14, 2.9, 0, 0.9, 0), { jitter: 0.06 });
  k.add('solid', cyl(0.14, 0.14, 0.36, 10), '#c0392b', at(-0.35, TOP + 0.18, 2.75));
  k.add('solid', cyl(0.14, 0.14, 0.36, 10), '#c0392b', at(-0.62, TOP + 0.18, 2.55));
  k.add('solid', box(0.9, 0.06, 0.36), '#7a5a3a', at(-3.0, TOP + 0.1, 2.5, 0, 0.5, 0));
  for (const s of [-1, 1]) k.add('solid', box(1.0, 0.04, 0.04), '#3a3a3a', { p: [-3.0 - s * 0.09, TOP + 0.05, 2.5 + s * 0.16], r: [0, 0.5, 0] });
  // lanterns near the tent
  k.add('solid', cyl(0.02, 0.02, 0.6, 5), '#3a3f4c', at(-0.2, TOP + 0.3, 1.0));
  k.add('glow', sphere(0.08, 8, 6), '#ffd08a', at(-0.2, TOP + 0.64, 1.0), { glow: 2.6 });

  // penguins
  const penguin = (x: number, z: number, s: number, ry: number): void => {
    k.add('solid', new THREE.SphereGeometry(1, 14, 10), '#1c2436', at(x, TOP + 0.22 * s, z, 0, ry, 0, [0.14 * s, 0.24 * s, 0.13 * s]));
    k.add('solid', new THREE.SphereGeometry(1, 12, 8), '#f4f6fa', at(x + Math.sin(ry) * 0.06 * s, TOP + 0.2 * s, z + Math.cos(ry) * 0.06 * s, 0, ry, 0, [0.11 * s, 0.2 * s, 0.09 * s]));
    k.add('solid', new THREE.SphereGeometry(1, 12, 8), '#1c2436', at(x, TOP + 0.5 * s, z, 0, ry, 0, [0.1 * s, 0.1 * s, 0.1 * s]));
    k.add('solid', cone(0.03 * s, 0.09 * s, 5), '#ff9a2c', at(x + Math.sin(ry) * 0.1 * s, TOP + 0.49 * s, z + Math.cos(ry) * 0.1 * s, Math.PI / 2, ry, 0));
    k.add('solid', box(0.06 * s, 0.02 * s, 0.09 * s), '#ff9a2c', at(x + Math.cos(ry) * 0.06 * s, TOP + 0.01, z - Math.sin(ry) * 0.06 * s, 0, ry, 0));
    k.add('solid', box(0.06 * s, 0.02 * s, 0.09 * s), '#ff9a2c', at(x - Math.cos(ry) * 0.06 * s, TOP + 0.01, z + Math.sin(ry) * 0.06 * s, 0, ry, 0));
  };
  penguin(2.2, 2.4, 1.1, -0.6);
  penguin(2.7, 2.1, 0.8, -0.9);
  penguin(3.2, 1.2, 0.6, -1.2);
  finish(k, c, 'ice', root);

  // rotating anemometer
  const cups = subModel(c, 'anemometer', (m) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.28;
      m.add('solid', cyl(0.008, 0.008, 0.24, 4), '#d0d6de', { p: [Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12], r: [0, -a, Math.PI / 2] });
      m.add('solid', dome(0.05, 8, 4), '#ff9a2c', at(Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24, 0, 0, Math.PI / 2));
    }
  });
  cups.position.set(0.7, TOP + 2.05, 0.4);
  root.add(cups);
  anim.push((dt, t) => {
    cups.rotation.y += dt * 4;
    void t;
  });

  // aurora ribbon
  const aur = new THREE.Mesh(new THREE.PlaneGeometry(15, 6.5, 60, 10), auroraMaterial());
  aur.position.set(-1, TOP + 8.6, -7.5);
  aur.rotation.x = -0.12;
  aur.frustumCulled = false;
  aur.renderOrder = 6;
  root.add(aur);
  anim.push((_dt, t) => {
    aur.position.x = -1 + Math.sin(t * 0.15) * 1.2;
  });
  // glittering ice sparkle + snow
  root.add(createParticles({ count: 90, min: [-5, TOP, -5], max: [5, TOP + 8, 5], color: '#ffffff', size: 0.07, motion: 'fall', speed: 0.5, wind: [0.4, 0.1], opacity: 0.85, additive: false, quality: c.quality }));
  root.add(createParticles({ count: 30, min: [-4, TOP + 0.2, -3], max: [4, TOP + 3.5, 3], color: '#9af0ff', size: 0.06, motion: 'float', speed: 0.6, twinkle: 1, quality: c.quality }));
  return { root, anim, top: 5.6 };
};

export const ISLAND_BUILDERS: Record<string, Builder> = { forest, temple, neon, harbor, ice };
