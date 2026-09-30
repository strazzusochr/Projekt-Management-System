import * as THREE from 'three/webgpu';
import { glowMat, rng } from '../../world/kit';
import { bake, cone, cyl, ellipsoid, merge, mottle, roundedBox, torus, tube } from '../../characters/geo';
import { type BuildCtx, type Part, halo, makeInstanced, makePools, matrixAt, vcMaterial } from './common';
import { DECK_HALF_W, DECK_X0, DECK_X1, DECK_Y, DECK_Z, groundAt } from './terrain';

type Geo = THREE.BufferGeometry;
type V3 = [number, number, number];

const WOOD = ['#9b6d42', '#8a5e37', '#a67848', '#946840'];

function jettyGeometry(sx: number): Geo[] {
  const parts: Geo[] = [];
  const len = DECK_X1 - DECK_X0;
  const n = Math.round(len / 0.245);
  for (let i = 0; i < n; i++) {
    const x = sx * (DECK_X0 + 0.12 + i * (len / n));
    parts.push(bake(roundedBox(len / n - 0.025, 0.06, DECK_HALF_W * 2 + 0.06 + ((i * 7) % 3) * 0.03, 0.012), { color: WOOD[i % 4]!, rough: 0.85 }, { p: [x, DECK_Y - 0.03, DECK_Z], r: [0, ((i * 13) % 5 - 2) * 0.004, 0] }));
  }
  for (const dz of [-0.46, 0.46]) parts.push(bake(roundedBox(len + 0.2, 0.11, 0.1, 0.02), { color: '#6f4a2c', rough: 0.9 }, { p: [sx * (DECK_X0 + len / 2), DECK_Y - 0.13, DECK_Z + dz] }));
  // posts
  const posts = 5;
  for (let k = 0; k < posts; k++) {
    const x = sx * (DECK_X0 + 0.15 + k * ((len - 0.4) / (posts - 1)));
    for (const dz of [-1, 1]) {
      const z = DECK_Z + dz * (DECK_HALF_W + 0.08);
      const h = k === 0 || k === posts - 1 ? 1.2 : 0.95;
      parts.push(bake(cyl(0.075, 0.09, 2.4 + h * 0.2, 9), { color: '#6f4a2c', rough: 0.9 }, { p: [x, DECK_Y - 1.0 + h * 0.2, z] }));
      parts.push(bake(cone(0.09, 0.08, 9), { color: '#7d5533', rough: 0.85 }, { p: [x, DECK_Y + 0.2 + h * 0.2 + 0.3, z] }));
      parts.push(bake(torus(0.08, 0.014, Math.PI * 2, 10, 4), { color: '#d5bd8a', rough: 0.95 }, { p: [x, DECK_Y + 0.35, z], r: [Math.PI / 2, 0, 0] }));
    }
    // rope railing on the shore-side edge only (the boat side stays open for boarding)
    if (k < posts - 1) {
      const x2 = sx * (DECK_X0 + 0.15 + (k + 1) * ((len - 0.4) / (posts - 1)));
      const z = DECK_Z + DECK_HALF_W + 0.08;
      const pts: V3[] = [[x, DECK_Y + 0.62, z], [(x + x2) / 2, DECK_Y + 0.5, z], [x2, DECK_Y + 0.62, z]];
      parts.push(bake(tube(pts, 0.017, 10, 5), { color: '#d5bd8a', rough: 0.95 }));
    }
  }
  // approach steps down to the bank
  parts.push(bake(roundedBox(0.34, 0.1, 1.5, 0.02), { color: '#8a5e37', rough: 0.9 }, { p: [sx * (DECK_X1 + 0.05), DECK_Y - 0.09, DECK_Z] }));
  return parts;
}

function stoneLantern(x: number, z: number, s: number, rot: number): Geo[] {
  const y = groundAt(x, z);
  const st = { color: '#8f8c82', rough: 0.9 };
  const p: Geo[] = [
    bake(cyl(0.34 * s, 0.4 * s, 0.14 * s, 8), st, { p: [x, y + 0.07 * s, z], r: [0, rot, 0] }),
    bake(cyl(0.11 * s, 0.14 * s, 0.9 * s, 8), st, { p: [x, y + 0.6 * s, z], r: [0, rot, 0] }),
    bake(cyl(0.3 * s, 0.22 * s, 0.1 * s, 8), st, { p: [x, y + 1.1 * s, z], r: [0, rot, 0] }),
    bake(roundedBox(0.36 * s, 0.34 * s, 0.36 * s, 0.03 * s), { color: '#ffd28a', rough: 0.4, emit: 3.2 }, { p: [x, y + 1.34 * s, z], r: [0, rot, 0] }),
    bake(cone(0.44 * s, 0.34 * s, 8), st, { p: [x, y + 1.68 * s, z], r: [0, rot, 0] }),
    bake(ellipsoid(0.08 * s, 0.08 * s, 0.08 * s, 8, 6), st, { p: [x, y + 1.88 * s, z] }),
  ];
  for (let k = 0; k < 4; k++) {
    const a = rot + (k / 4) * Math.PI * 2;
    p.push(bake(roundedBox(0.05 * s, 0.34 * s, 0.05 * s, 0.01 * s), st, { p: [x + Math.sin(a + Math.PI / 4) * 0.2 * s, y + 1.34 * s, z + Math.cos(a + Math.PI / 4) * 0.2 * s] }));
  }
  return p;
}

function shrineGeometry(x: number, z: number, faceX: number): Geo[] {
  const y = groundAt(x, z);
  const st = { color: '#8c8a80', rough: 0.9 };
  const dark = { color: '#6f6d65', rough: 0.95 };
  const rune = { color: '#84ffe0', rough: 0.3, emit: 3.0 };
  const moss = { color: '#5f8f3e', rough: 1 };
  const P: Geo[] = [];
  const at = (lx: number, ly: number, lz: number): V3 => [x + lx * faceX, y + ly, z + lz];
  // plinth steps
  P.push(bake(roundedBox(3.2, 0.2, 3.0, 0.05), dark, { p: at(0, 0.08, 0) }));
  P.push(bake(roundedBox(2.6, 0.2, 2.5, 0.05), st, { p: at(-0.05, 0.27, 0) }));
  P.push(bake(roundedBox(2.0, 0.22, 2.0, 0.05), dark, { p: at(-0.1, 0.47, 0) }));
  // two pillars + carved rings + runes
  for (const dz of [-0.85, 0.85]) {
    P.push(bake(roundedBox(0.36, 2.3, 0.36, 0.06), st, { p: at(-0.1, 1.72, dz) }));
    P.push(bake(roundedBox(0.5, 0.16, 0.5, 0.04), dark, { p: at(-0.1, 0.66, dz) }));
    P.push(bake(roundedBox(0.46, 0.14, 0.46, 0.04), dark, { p: at(-0.1, 2.86, dz) }));
    for (let k = 0; k < 4; k++) P.push(bake(roundedBox(0.03, 0.14 + (k % 2) * 0.08, 0.2, 0.01), rune, { p: at(-0.29, 1.2 + k * 0.42, dz) }));
    P.push(bake(ellipsoid(0.32, 0.12, 0.32, 8, 6), moss, { p: at(-0.1, 2.97, dz) }));
  }
  // lintel + leaf arch
  P.push(bake(roundedBox(0.44, 0.32, 2.5, 0.06), st, { p: at(-0.1, 3.1, 0) }));
  P.push(bake(torus(0.85, 0.07, Math.PI, 20, 6), st, { p: at(-0.12, 3.25, 0), r: [0, Math.PI / 2, 0] }));
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * Math.PI;
    P.push(bake(ellipsoid(0.02, 0.09, 0.05, 6, 4), { color: '#8fe0a0', rough: 0.3, emit: 1.8 }, { p: at(-0.2, 3.25 + Math.sin(a) * 0.85, Math.cos(a) * 0.85), r: [a - Math.PI / 2, 0, 0] }));
  }
  P.push(bake(ellipsoid(0.16, 0.16, 0.16, 10, 8), { color: '#ff9fd0', rough: 0.2, emit: 2.6 }, { p: at(-0.24, 4.15, 0) }));
  // altar stone with bowl
  P.push(bake(roundedBox(0.9, 0.7, 0.9, 0.08), st, { p: at(0.2, 0.9, 0) }));
  P.push(bake(cyl(0.34, 0.2, 0.18, 12), dark, { p: at(0.2, 1.34, 0) }));
  P.push(bake(ellipsoid(0.12, 0.12, 0.12, 12, 10), { color: '#b8fff0', rough: 0.15, emit: 4.0 }, { p: at(0.2, 1.56, 0) }));
  P.push(bake(torus(0.36, 0.03, Math.PI * 2, 18, 5), st, { p: at(0.2, 1.42, 0), r: [Math.PI / 2, 0, 0] }));
  // moss patches and hanging vines
  for (const [lx, ly, lz, s] of [[0.5, 0.4, 1.2, 0.5], [-0.2, 0.62, -1.0, 0.45], [0.7, 0.36, -0.8, 0.4], [-0.4, 0.4, 1.1, 0.35]] as const) P.push(bake(ellipsoid(s, s * 0.22, s * 0.8, 8, 6), moss, { p: at(lx, ly, lz) }));
  for (let k = 0; k < 6; k++) {
    const z0 = -1.1 + k * 0.44;
    P.push(bake(tube([[x - 0.3 * faceX, y + 2.95, z + z0], [x - 0.32 * faceX, y + 2.5 - (k % 3) * 0.2, z + z0 + 0.03], [x - 0.3 * faceX, y + 2.15 - (k % 3) * 0.45, z + z0 - 0.02]], 0.012, 8, 4), { color: '#4f8a3a', rough: 0.9 }));
  }
  return P;
}

function logGeometry(len: number, r: number, seed: number): Geo {
  const R = rng(seed);
  const parts: Geo[] = [];
  const g = new THREE.CylinderGeometry(r, r * 1.12, len, 12, 8);
  g.rotateZ(Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + Math.sin(Math.atan2(z, y) * 7 + x * 1.3) * 0.045 + Math.sin(x * 2.2 + seed) * 0.03;
    pos.setXYZ(i, x, y * k, z * k);
  }
  g.computeVertexNormals();
  const b = bake(g, { color: '#5a4230', rough: 0.95 });
  const pp = b.getAttribute('position');
  const cc = b.getAttribute('color') as THREE.BufferAttribute;
  const bark = new THREE.Color('#5c4432');
  const moss = new THREE.Color('#5d8a3a');
  const cut = new THREE.Color('#b99863');
  const tmp = new THREE.Color();
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i);
    const y = pp.getY(i);
    tmp.copy(bark).multiplyScalar(0.8 + 0.4 * (Math.sin(x * 4 + y * 9) * 0.5 + 0.5));
    if (y > r * 0.25) tmp.lerp(moss, Math.min(1, (y - r * 0.25) / (r * 0.6)) * 0.85);
    if (Math.abs(x) > len / 2 - 0.02) tmp.copy(cut).multiplyScalar(0.8 + 0.2 * Math.sin(Math.hypot(y, pp.getZ(i)) * 30));
    cc.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  parts.push(b);
  // branch stubs & shelf fungi
  for (let k = 0; k < 3; k++) parts.push(bake(cyl(r * 0.12, r * 0.2, r * 0.9, 6), { color: '#5a4230', rough: 0.95 }, { p: [(R() - 0.5) * len * 0.7, r * 0.7, r * 0.5], r: [0.9, 0, (R() - 0.5) * 0.6] }));
  for (let k = 0; k < 4; k++) parts.push(bake(new THREE.SphereGeometry(r * 0.32, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), { color: k % 2 ? '#e8b060' : '#f0e4c8', rough: 0.7 }, { p: [(R() - 0.5) * len * 0.8, r * (0.2 + R() * 0.3), -r * 0.98], r: [-Math.PI / 2, 0, 0], s: [1, 0.5, 1] }));
  for (let k = 0; k < 5; k++) parts.push(bake(ellipsoid(r * 0.6, r * 0.22, r * 0.55, 8, 5), { color: '#6d9944', rough: 1 }, { p: [(R() - 0.5) * len * 0.8, r * 0.9, (R() - 0.5) * r * 0.7] }));
  return merge(parts);
}

export function buildProps(c: BuildCtx): Part {
  const { scene, bin } = c;
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);
  const R = rng(777);
  const vc = bin.add(vcMaterial());
  const lampGlow = bin.add(glowMat('#ffffff', 3.4));
  const pools: Array<{ x: number; y: number; z: number; r: number; color: THREE.ColorRepresentation; a?: number }> = [];
  const flick: Array<{ light: THREE.PointLight | null; h: THREE.Sprite; base: number; size: number }> = [];

  // ── jetties, posts, crates, barrels ──
  const wood: Geo[] = [];
  for (const sx of [-1, 1]) {
    wood.push(...jettyGeometry(sx));
    // barrel, crates & rope coil beside the approach
    const bx = sx * 8.5;
    const bz = 2.9;
    const gy = groundAt(bx, bz);
    wood.push(bake(cyl(0.3, 0.3, 0.75, 12), { color: '#8a5e37', rough: 0.85 }, { p: [bx, gy + 0.37, bz] }));
    for (const yy of [0.15, 0.6]) wood.push(bake(torus(0.305, 0.017, Math.PI * 2, 14, 4), { color: '#3f3f3f', rough: 0.5, metal: 0.7 }, { p: [bx, gy + yy, bz], r: [Math.PI / 2, 0, 0] }));
    wood.push(bake(roundedBox(0.55, 0.45, 0.5, 0.03), { color: '#a67848', rough: 0.8 }, { p: [sx * 9.4, groundAt(sx * 9.4, 3.3) + 0.22, 3.3], r: [0, 0.4, 0] }));
    wood.push(bake(roundedBox(0.4, 0.36, 0.4, 0.03), { color: '#946840', rough: 0.8 }, { p: [sx * 9.3, groundAt(sx * 9.3, 3.35) + 0.63, 3.3], r: [0, -0.3, 0] }));
    for (let k = 0; k < 3; k++) wood.push(bake(torus(0.16 - k * 0.01, 0.028, Math.PI * 2, 14, 5), { color: '#d8c08a', rough: 0.95 }, { p: [sx * 7.6, DECK_Y + 0.04 + k * 0.045, DECK_Z + 0.32], r: [Math.PI / 2, 0, 0] }));
    // signpost with two boards
    const sxp = sx * 9.9;
    const szp = -1.4;
    const sy = groundAt(sxp, szp);
    wood.push(bake(cyl(0.06, 0.08, 1.9, 7), { color: '#6f4a2c', rough: 0.9 }, { p: [sxp, sy + 0.9, szp] }));
    wood.push(bake(roundedBox(0.75, 0.2, 0.05, 0.02), { color: '#a67848', rough: 0.8 }, { p: [sxp - sx * 0.3, sy + 1.6, szp + 0.06], r: [0, 0, 0.06] }));
    wood.push(bake(roundedBox(0.65, 0.18, 0.05, 0.02), { color: '#946840', rough: 0.8 }, { p: [sxp + sx * 0.25, sy + 1.3, szp - 0.06], r: [0, 0.2, -0.05] }));
    wood.push(bake(ellipsoid(0.05, 0.09, 0.012, 6, 4), { color: '#6fbf5a', rough: 0.6 }, { p: [sxp - sx * 0.55, sy + 1.6, szp + 0.09], r: [0, 0, 1.2] }));
  }
  // jetty lantern posts (with warm dynamic lights while the budget lasts)
  for (const sx of [-1, 1]) {
    const px = sx * 8.35;
    const pz = DECK_Z - DECK_HALF_W - 0.42;
    const gy = groundAt(px, pz);
    wood.push(bake(cyl(0.05, 0.065, 2.3, 8), { color: '#5d3f26', rough: 0.9 }, { p: [px, gy + 1.15, pz] }));
    wood.push(bake(tube([[px, gy + 2.2, pz], [px + sx * 0.2, gy + 2.42, pz], [px + sx * 0.4, gy + 2.28, pz]], 0.018, 10, 5), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }));
    const lx = px + sx * 0.4;
    const ly = gy + 2.0;
    wood.push(bake(cone(0.12, 0.1, 8), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }, { p: [lx, ly + 0.22, pz] }));
    wood.push(bake(cyl(0.09, 0.07, 0.03, 8), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }, { p: [lx, ly - 0.16, pz] }));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      wood.push(bake(cyl(0.006, 0.006, 0.34, 4), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }, { p: [lx + Math.sin(a) * 0.09, ly, pz + Math.cos(a) * 0.09] }));
    }
    const g = new THREE.Mesh(bin.add(new THREE.SphereGeometry(0.075, 10, 8)), lampGlow);
    g.position.set(lx, ly, pz);
    g.scale.y = 1.4;
    group.add(g);
    const h = halo('#ffb060', 1.9, 0.6);
    h.position.copy(g.position);
    group.add(h);
    let light: THREE.PointLight | null = null;
    if (c.lights.left > 0) {
      c.lights.left--;
      light = new THREE.PointLight(0xffb266, 7, 8, 2);
      light.position.copy(g.position);
      group.add(light);
    }
    flick.push({ light, h, base: 7, size: 1.9 });
    pools.push({ x: lx, y: gy + 0.05, z: pz, r: 2.6, color: '#ffb060', a: 0.45 });
    pools.push({ x: sx * 6.4, y: DECK_Y + 0.02, z: DECK_Z, r: 1.6, color: '#ffc880', a: 0.25 });
  }

  // ── shrine on the goal-bank hill (facing the river), with stone lanterns ──
  const shrine: Geo[] = shrineGeometry(15.4, -3.6, -1);
  shrine.push(...stoneLantern(13.2, -1.6, 1.0, 0.3), ...stoneLantern(13.4, -6.0, 0.9, -0.2));
  pools.push({ x: 13.2, y: groundAt(13.2, -1.6) + 0.05, z: -1.6, r: 2.4, color: '#ffc070', a: 0.4 });
  pools.push({ x: 13.4, y: groundAt(13.4, -6) + 0.05, z: -6.0, r: 2.2, color: '#ffc070', a: 0.4 });
  pools.push({ x: 15.0, y: groundAt(15, -3.6) + 1.7, z: -3.6, r: 2.0, color: '#7fffe0', a: 0.35 });
  const shrineHalo = halo('#a8fff0', 2.6, 0.7);
  shrineHalo.position.set(15.4 - 0.2 * -1, groundAt(15.4, -3.6) + 1.56, -3.6);
  group.add(shrineHalo);
  const lanternHalos = [halo('#ffc070', 1.6, 0.6), halo('#ffc070', 1.5, 0.6)];
  lanternHalos[0]!.position.set(13.2, groundAt(13.2, -1.6) + 1.34, -1.6);
  lanternHalos[1]!.position.set(13.4, groundAt(13.4, -6) + 1.2, -6.0);
  lanternHalos.forEach((h) => group.add(h));
  if (c.lights.left > 0) {
    c.lights.left--;
    const sl = new THREE.PointLight(0x8affea, 6, 9, 2);
    sl.position.set(15.0, groundAt(15, -3.6) + 1.7, -3.6);
    group.add(sl);
    flick.push({ light: sl, h: shrineHalo, base: 6, size: 2.6 });
  }

  // ── fallen logs ──
  const logs: Array<[number, number, number, number, number]> = [
    [-13.4, -5.4, 0.4, 5.2, 0.42], [14.6, 9.5, -0.6, 4.6, 0.38], [-19.5, -9.5, 1.2, 6.0, 0.5], [18.5, -12.5, 0.2, 5.4, 0.46], [-7.6, -10.8, 1.5, 3.6, 0.33], [10.5, -20.5, -0.9, 4.2, 0.4],
  ];
  const logGeos: Geo[] = [];
  logs.forEach(([x, z, rot, len, r], i) => {
    const g = logGeometry(len, r, 10 + i);
    g.applyMatrix4(matrixAt(x, groundAt(x, z) + r * 0.75, z, rot, 1, 0, (R() - 0.5) * 0.06));
    logGeos.push(g);
  });
  wood.push(...logGeos);

  // ── string lanterns between the giant trees ──
  const strings: Geo[] = [];
  const lampMats: THREE.Matrix4[] = [];
  const lampCols: THREE.Color[] = [];
  const stringDefs: Array<[V3, V3]> = [
    [[14.3, 3.9, 4.4], [13.5, 3.6, -9.2]],
    [[-14.4, 3.8, 4.2], [-12.6, 3.7, -8.9]],
  ];
  const palette = ['#ffb35c', '#ff9a52', '#ffd06a', '#ff8a6a', '#ffc27a'];
  for (const [a, b] of stringDefs) {
    const pts: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - Math.sin(u * Math.PI) * 0.9, a[2] + (b[2] - a[2]) * u]);
    }
    strings.push(bake(tube(pts, 0.014, 40, 4), { color: '#5a4630', rough: 0.9 }));
    for (let i = 1; i < 10; i += 1) {
      const p = pts[i]!;
      lampMats.push(matrixAt(p[0], p[1] - 0.22, p[2], 0, [0.9, 1.15, 0.9]));
      lampCols.push(new THREE.Color(palette[i % palette.length]!));
      strings.push(bake(cone(0.07, 0.08, 8), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }, { p: [p[0], p[1] - 0.06, p[2]] }));
      strings.push(bake(cyl(0.005, 0.005, 0.08, 4), { color: '#3a3a3a', rough: 0.5 }, { p: [p[0], p[1] - 0.02, p[2]] }));
    }
  }
  wood.push(...strings);
  const lampGeo = bin.add(new THREE.SphereGeometry(0.1, 10, 8));
  const lampInst = makeInstanced(lampGeo, bin.add(glowMat('#ffffff', 3.0)), lampMats, { colors: lampCols, receive: false, name: 'stringLamps' });
  group.add(lampInst);
  for (const m of lampMats) {
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    pools.push({ x: p.x, y: groundAt(p.x, p.z) + 0.05, z: p.z, r: 1.3, color: '#ffb060', a: 0.16 });
  }

  const woodGeo = bin.add(merge(wood));
  mottle(woodGeo, 0.12, 12, 5);
  const wm = new THREE.Mesh(woodGeo, vc);
  wm.castShadow = true;
  wm.receiveShadow = true;
  wm.name = 'woodProps';
  group.add(wm);
  const stoneGeo = bin.add(merge(shrine));
  mottle(stoneGeo, 0.16, 6, 9);
  const sm = new THREE.Mesh(stoneGeo, vc);
  sm.castShadow = true;
  sm.receiveShadow = true;
  sm.name = 'shrine';
  group.add(sm);
  group.add(makePools(pools));

  return {
    update(_dt, t): void {
      for (let i = 0; i < flick.length; i++) {
        const f = flick[i]!;
        const k = 0.9 + Math.sin(t * 7.3 + i * 2) * 0.05 + Math.sin(t * 12.1 + i) * 0.04;
        if (f.light) f.light.intensity = f.base * k;
        f.h.scale.setScalar(f.size * (0.96 + 0.04 * Math.sin(t * 6 + i)));
      }
    },
  };
}
