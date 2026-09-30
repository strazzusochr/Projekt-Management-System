import * as THREE from 'three/webgpu';
import { bake, cyl, ellipsoid, extrude, roundedBox, torus, tube } from '../../characters/geo';
import { rng } from '../../world/kit';
import { Parts, starShape } from './helpers';

export interface PierResult {
  parts: Parts;
  /** Lantern positions (world) for glow spheres + optional point lights. */
  lanterns: THREE.Vector3[];
  crates: Array<{ p: [number, number, number]; r: number; s: number }>;
  barrels: Array<{ p: [number, number, number]; r: number; s: number }>;
  planters: Array<{ p: [number, number, number]; r: number }>;
  mooring: THREE.Vector3[];
}

const gold = { color: '#f0bd45', rough: 0.24, metal: 1 } as const;
const brass = { color: '#c99b3c', rough: 0.3, metal: 0.95 } as const;

/**
 * One harbour pier. `s` = -1 (Sonnenpier, left) or +1 (Sternenkai, right). Deck top at y = 0.5,
 * the free end at |x| = 6.2 facing the gap.
 */
export function buildPier(s: 1 | -1, seed: number): PierResult {
  const parts = new Parts();
  const rnd = rng(seed);
  const X = (x: number) => s * x;
  const lanterns: THREE.Vector3[] = [];
  const crates: PierResult['crates'] = [];
  const barrels: PierResult['barrels'] = [];
  const planters: PierResult['planters'] = [];
  const mooring: THREE.Vector3[] = [];
  const x0 = 6.2;
  const x1 = 14.8;
  const len = x1 - x0;
  const cx = X((x0 + x1) / 2);

  // deck planks (run along X)
  const nPlanks = 22;
  const zHalf = 3.0;
  const pw = (zHalf * 2) / nPlanks;
  for (let i = 0; i < nPlanks; i++) {
    const z = -zHalf + (i + 0.5) * pw;
    const tone = 0.86 + rnd() * 0.22;
    const col = new THREE.Color(s < 0 ? '#a87a4c' : '#8f7a66').multiplyScalar(tone);
    // stagger plank ends for a hand-built look
    const cut = i % 3 === 0 ? 0.35 : i % 3 === 1 ? 0 : 0.7;
    parts.add(new THREE.BoxGeometry(len - cut, 0.12, pw * 0.94), { color: col, rough: 0.82 }, { p: [X((x0 + x1) / 2 - cut * 0.5), 0.44, z] });
  }
  void cx;
  // underside beams
  for (const x of [x0 + 0.6, 9.2, 12.0, 14.6]) parts.add(new THREE.BoxGeometry(0.28, 0.3, zHalf * 2 + 0.3), { color: '#5a3a22', rough: 0.85 }, { p: [X(x), 0.2, 0] });
  for (const z of [-zHalf + 0.3, 0, zHalf - 0.3]) parts.add(new THREE.BoxGeometry(len, 0.3, 0.3), { color: '#4d321d', rough: 0.85 }, { p: [X((x0 + x1) / 2), 0.16, z] });
  // golden edge trim + end cap
  for (const z of [-zHalf - 0.04, zHalf + 0.04]) parts.add(roundedBox(len, 0.08, 0.16, 0.03), gold, { p: [X((x0 + x1) / 2), 0.53, z] });
  parts.add(roundedBox(0.18, 0.08, zHalf * 2 + 0.3, 0.03), gold, { p: [X(x0 - 0.03), 0.53, 0] });
  // inlaid emblem in the deck
  const ex = X(10.6);
  if (s < 0) {
    parts.add(cyl(1.75, 1.75, 0.022, 40), { color: '#7a5028', rough: 0.6 }, { p: [ex, 0.505, 0] });
    parts.add(cyl(1.55, 1.55, 0.03, 40), gold, { p: [ex, 0.508, 0] });
    parts.add(cyl(1.3, 1.3, 0.034, 40), { color: '#ffd76a', rough: 0.2, metal: 1, emit: 0.45 }, { p: [ex, 0.51, 0] });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      parts.add(new THREE.ConeGeometry(0.22, 1.05, 4), gold, { p: [ex + Math.cos(a) * 2.05, 0.512, Math.sin(a) * 2.05], r: [Math.PI / 2, 0, -a + Math.PI / 2], s: [1, 1, 0.08] });
    }
  } else {
    parts.add(cyl(1.85, 1.85, 0.022, 48), { color: '#3a2c58', rough: 0.55 }, { p: [ex, 0.505, 0] });
    parts.add(extrude(starShape(8, 1.8, 0.85), 0.03, 0.01), { color: '#a98cff', rough: 0.2, metal: 0.9, emit: 0.55 }, { p: [ex, 0.52, 0], r: [-Math.PI / 2, 0, 0] });
    parts.add(extrude(starShape(8, 1.15, 0.55), 0.034, 0.008), { color: '#f0e6ff', rough: 0.2, metal: 0.9, emit: 0.7 }, { p: [ex, 0.535, 0], r: [-Math.PI / 2, 0, Math.PI / 8] });
    parts.add(torus(1.95, 0.05, Math.PI * 2, 48, 5), gold, { p: [ex, 0.515, 0], r: [Math.PI / 2, 0, 0] });
  }
  // supports hanging under the overhang
  for (const z of [-zHalf + 0.25, zHalf - 0.25]) {
    for (const x of [x0 + 0.5, x0 + 2.6]) {
      parts.add(cyl(0.11, 0.16, 3.4, 8), { color: '#4d321d', rough: 0.9 }, { p: [X(x), -1.25, z] });
      parts.add(torus(0.16, 0.03, Math.PI * 2, 12, 4), brass, { p: [X(x), 0.0, z], r: [Math.PI / 2, 0, 0] });
    }
    // diagonal struts toward the island
    parts.add(cyl(0.07, 0.07, 3.2, 6), { color: '#4d321d', rough: 0.9 }, { p: [X(x0 + 2.4), -0.55, z], r: [0, 0, s * 0.9] });
  }
  // railing posts and rope along both long sides (open at the free end for boarding)
  const railX0 = x0 + 1.4;
  for (const z of [-zHalf, zHalf]) {
    const pts: Array<[number, number, number]> = [];
    for (let x = railX0; x <= x1 + 0.01; x += 1.55) {
      parts.add(cyl(0.045, 0.06, 1.0, 8), { color: '#5d3d24', rough: 0.85 }, { p: [X(x), 1.0, z] });
      parts.add(ellipsoid(0.07, 0.07, 0.07, 8, 6), gold, { p: [X(x), 1.53, z] });
      pts.push([X(x), 1.32 - Math.sin(((x - railX0) / (x1 - railX0)) * Math.PI * 3) * 0.02, z]);
    }
    parts.add(tube(pts, 0.022, 30, 5), { color: '#d8c28a', rough: 0.95 });
    const lower = pts.map(([x, y, zz]) => [x, y - 0.4, zz] as [number, number, number]);
    parts.add(tube(lower, 0.016, 30, 5), { color: '#c9b078', rough: 0.95 });
  }
  // far end railing (back edge toward the island is open)
  // mooring bollards at the free end
  for (const z of [-2.0, 2.0]) {
    parts.add(cyl(0.16, 0.22, 0.6, 12), { color: '#3f2d20', rough: 0.7 }, { p: [X(x0 + 0.55), 0.8, z] });
    parts.add(cyl(0.24, 0.16, 0.12, 12), brass, { p: [X(x0 + 0.55), 1.14, z] });
    parts.add(torus(0.2, 0.03, Math.PI * 2, 14, 5), { color: '#d8c28a', rough: 0.95 }, { p: [X(x0 + 0.55), 0.74, z], r: [Math.PI / 2, 0, 0] });
    mooring.push(new THREE.Vector3(X(x0 + 0.55), 1.0, z));
  }
  // tall lantern posts: two flank the boarding point, two further along
  const lampSpots: Array<[number, number]> = [[x0 + 0.35, -2.75], [x0 + 0.35, 2.75], [10.2, -3.0], [10.2, 3.0], [14.0, -3.0], [14.0, 3.0]];
  for (const [x, z] of lampSpots) {
    parts.add(cyl(0.06, 0.09, 2.5, 8), { color: '#3f2d20', rough: 0.75 }, { p: [X(x), 1.7, z] });
    parts.add(cyl(0.16, 0.12, 0.05, 10), brass, { p: [X(x), 3.0, z] });
    parts.add(cyl(0.05, 0.16, 0.14, 10), brass, { p: [X(x), 3.32, z] });
    parts.add(tube([[X(x), 2.9, z], [X(x) + s * -0.35, 3.05, z], [X(x) + s * -0.5, 2.7, z]], 0.02, 8, 4), brass);
    parts.add(cyl(0.17, 0.17, 0.05, 10), brass, { p: [X(x), 3.2, z] });
    lanterns.push(new THREE.Vector3(X(x), 3.1, z));
  }
  // planters with flowers (flower blobs added by index via instancing)
  for (const [x, z] of [[8.2, 2.55], [8.2, -2.55], [12.6, 2.55], [12.6, -2.55]] as Array<[number, number]>) {
    parts.add(roundedBox(1.1, 0.42, 0.5, 0.05), { color: '#8a5a34', rough: 0.8 }, { p: [X(x), 0.75, z] });
    parts.add(roundedBox(1.16, 0.06, 0.56, 0.02), gold, { p: [X(x), 0.98, z] });
    parts.add(new THREE.SphereGeometry(0.5, 8, 6), { color: '#4f8a3a', rough: 0.9 }, { p: [X(x), 1.08, z], s: [1.0, 0.35, 0.45] });
    planters.push({ p: [X(x), 1.1, z], r: 0 });
  }
  // stone steps up to the island plaza at the back end + paved plaza slab
  parts.add(roundedBox(0.8, 0.14, zHalf * 1.9, 0.02), { color: '#d9cdb6', rough: 0.7 }, { p: [X(x1 + 0.4), 0.47, 0] });
  parts.add(roundedBox(0.8, 0.3, zHalf * 1.8, 0.02), { color: '#d2c6ae', rough: 0.7 }, { p: [X(x1 + 1.2), 0.5, 0] });
  parts.add(roundedBox(4.4, 0.72, zHalf * 1.7, 0.05), { color: '#e2d6bd', rough: 0.72 }, { p: [X(x1 + 3.6), 0.3, 0] });
  parts.add(roundedBox(4.5, 0.05, 0.3, 0.02), gold, { p: [X(x1 + 3.6), 0.67, 0] });
  parts.add(cyl(1.1, 1.1, 0.03, 32), { color: s < 0 ? '#f0c85a' : '#b8a0ff', rough: 0.3, metal: 0.8, emit: 0.3 }, { p: [X(x1 + 3.6), 0.675, 0] });
  // cargo: crates and barrels near the back
  const cratePos: Array<[number, number, number]> = [[13.9, 0.5, 1.7], [14.3, 0.5, 2.4], [14.0, 1.1, 2.0], [13.0, 0.5, -2.2], [13.7, 0.5, -2.45], [14.3, 0.5, -1.9], [13.8, 1.1, -2.2]];
  for (const [x, y, z] of cratePos) crates.push({ p: [X(x), y + 0.3, z], r: rnd() * 0.6, s: 0.9 + rnd() * 0.25 });
  const barrelPos: Array<[number, number, number]> = [[13.2, 0.5, 2.45], [11.6, 0.5, 2.6], [11.9, 0.5, -2.55], [14.3, 0.5, 0.9]];
  for (const [x, y, z] of barrelPos) barrels.push({ p: [X(x), y + 0.35, z], r: rnd() * 6, s: 0.9 + rnd() * 0.2 });
  // rope coils and a small signpost with lantern crest
  for (const [x, z] of [[9.0, -2.4], [10.6, 2.4]] as Array<[number, number]>) {
    for (let i = 0; i < 4; i++) parts.add(torus(0.28 - i * 0.02, 0.05, Math.PI * 2, 16, 5), { color: '#c9a86a', rough: 0.95 }, { p: [X(x), 0.56 + i * 0.09, z], r: [Math.PI / 2, 0, 0] });
  }
  // broken rope-bridge remnants hanging from the tall anchor posts at the free end
  for (const z of [-2.45, 2.45]) {
    parts.add(cyl(0.12, 0.16, 2.4, 10), { color: '#4d321d', rough: 0.85 }, { p: [X(x0 + 0.05), 1.7, z] });
    parts.add(cyl(0.2, 0.2, 0.12, 10), brass, { p: [X(x0 + 0.05), 2.9, z] });
    const rope: Array<[number, number, number]> = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      rope.push([X(x0 - 0.05 - t * 1.8 - Math.sin(t * 3) * 0.2), 2.5 - t * 6.5 + Math.sin(t * 8 + z) * 0.08, z + Math.sin(t * 5 + z) * 0.12]);
    }
    parts.add(tube(rope, 0.04, 24, 5), { color: '#b8a070', rough: 0.95 });
    for (let i = 1; i <= 5; i++) {
      const t = i / 8;
      const p = rope[i]!;
      parts.add(new THREE.BoxGeometry(0.16, 0.05, 1.0), { color: '#7a5030', rough: 0.9 }, { p: [p[0], p[1] - 0.02, z > 0 ? p[2] - 0.5 : p[2] + 0.5], r: [0, 0, (rnd() - 0.5) * 0.7 * t] });
    }
    parts.add(tube(rope.map(([x, y, zz]) => [x, y, zz - Math.sign(z) * 1.0] as [number, number, number]), 0.035, 24, 5), { color: '#b8a070', rough: 0.95 });
  }
  void bake;
  return { parts, lanterns, crates, barrels, planters, mooring };
}
