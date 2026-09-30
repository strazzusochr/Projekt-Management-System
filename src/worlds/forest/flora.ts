import * as THREE from 'three/webgpu';
import { glowMat, rng, rockGeometry, weld } from '../../world/kit';
import { bake, cone, cyl, ellipsoid, lathe, merge, tube, gradient } from '../../characters/geo';
import { type BuildCtx, type Part, halo, makeInstanced, makePools, matrixAt, paint, sstep, vcMaterial, vnoise } from './common';
import { FALL_Z, bankEdge, groundAt } from './terrain';

type Geo = THREE.BufferGeometry;
type V3 = [number, number, number];

/** Areas that must stay free of trunks/boulders (bank slots, jetties, boat lane). */
export function inPlay(x: number, z: number, pad = 0): boolean {
  const ax = Math.abs(x);
  return ax < 12.6 + pad && Math.abs(z) < 5.8 + pad;
}

// ───────────────────────── trees ─────────────────────────

interface TreeCfg {
  height: number;
  trunkR: number;
  crownR: number;
  clumps: number;
  seed: number;
  bark: string;
  barkLight: string;
  leaf: string[];
  gold: string[];
  goldChance: number;
  flare: number;
  lean: number;
  birch?: boolean;
  roots?: number;
  branches?: number;
  detail?: number;
}

const _col = new THREE.Color();
const _col2 = new THREE.Color();

function treeGeometry(c: TreeCfg): Geo {
  const r = rng(c.seed);
  const H = c.height;
  const R = c.trunkR;
  const parts: Geo[] = [];
  // trunk
  const prof: Array<[number, number]> = [
    [R * (1 + c.flare), -0.5],
    [R * (1 + c.flare * 0.5), 0.3],
    [R * 1.1, H * 0.08],
    [R * 0.97, H * 0.22],
    [R * 0.86, H * 0.42],
    [R * 0.7, H * 0.62],
    [R * 0.5, H * 0.78],
    [R * 0.28, H * 0.9],
  ];
  const trunk = lathe(prof, c.birch ? 10 : 14, 26);
  const pos = trunk.getAttribute('position');
  const roots = c.roots ?? 6;
  const ph = r() * 6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const rr = 1 + Math.sin(ang * 9 + y * 0.35 + ph) * 0.035 + Math.sin(ang * 5 - y * 0.2) * 0.05 + Math.pow(Math.max(0, Math.sin(ang * roots + ph)), 2) * 0.55 * c.flare * Math.exp(-Math.max(0, y) * 1.1);
    const lean = c.lean * Math.pow(Math.max(0, y) / H, 2) * H * 0.1;
    pos.setXYZ(i, x * rr + lean, y, z * rr);
  }
  trunk.computeVertexNormals();
  const barkC = new THREE.Color(c.bark);
  const barkL = new THREE.Color(c.barkLight);
  const moss = new THREE.Color('#587a35');
  const bt = bake(trunk, { color: c.bark, rough: 0.95 });
  paint(bt, (x, y, z, nx, ny, _nz, out) => {
    const ang = Math.atan2(z, x);
    const n = vnoise(x * 1.3, y * 0.7, z * 1.3) * 0.5 + 0.5;
    out.copy(barkC).lerp(barkL, n * 0.7 + Math.sin(ang * 17 + y * 0.4) * 0.12);
    if (c.birch) {
      const ring = Math.sin(y * 5.2 + ang * 2.0) > 0.85 || Math.sin(y * 9 + ang * 5) > 0.93;
      if (ring) out.set('#2b2622');
    }
    const mossK = sstep(0.05, 0.7, (1 - y / (H * 0.3)) * 0.55 + ny * 0.25 + n * 0.3 - 0.15) * (c.birch ? 0.2 : 1);
    out.lerp(moss, mossK * 0.75);
    void nx;
  });
  parts.push(bt);
  // surface roots
  for (let k = 0; k < (c.birch ? 2 : 5); k++) {
    const a = (k / 5) * Math.PI * 2 + r() * 0.8;
    const L = R * (2.4 + r() * 1.6);
    const pts: V3[] = [
      [Math.cos(a) * R * 0.6, 0.9 * (R / 1.4), Math.sin(a) * R * 0.6],
      [Math.cos(a) * R * 1.4, 0.3, Math.sin(a) * R * 1.4],
      [Math.cos(a + 0.2) * L, -0.05, Math.sin(a + 0.2) * L],
    ];
    parts.push(bake(tube(pts, R * 0.3, 10, 6, R * 0.09), { color: c.bark, rough: 0.95 }));
  }
  // limbs & canopy anchor points
  const anchors: Array<{ x: number; y: number; z: number; s: number }> = [];
  const nb = c.branches ?? 5;
  for (let k = 0; k < nb; k++) {
    const hf = 0.5 + r() * 0.28;
    const a = (k / nb) * Math.PI * 2 + r() * 0.9;
    const L = c.crownR * (0.75 + r() * 0.55);
    const y0 = H * hf;
    const lean0 = c.lean * Math.pow(hf, 2) * H * 0.1;
    const pts: V3[] = [
      [lean0 + Math.cos(a) * R * 0.4, y0, Math.sin(a) * R * 0.4],
      [lean0 + Math.cos(a) * L * 0.45, y0 + L * 0.28, Math.sin(a) * L * 0.45],
      [lean0 + Math.cos(a) * L * 0.9, y0 + L * 0.5, Math.sin(a) * L * 0.9],
    ];
    parts.push(bake(tube(pts, R * 0.34, 10, 6, R * 0.1), { color: c.bark, rough: 0.95 }));
    anchors.push({ x: pts[2]![0], y: pts[2]![1], z: pts[2]![2], s: 0.9 });
  }
  // canopy clumps (welded icospheres, displaced)
  const centerY = H * 0.86;
  for (let k = 0; k < c.clumps; k++) {
    let cx: number;
    let cy: number;
    let cz: number;
    let cr: number;
    if (k < anchors.length && k < c.clumps * 0.35) {
      const a = anchors[k]!;
      cx = a.x;
      cy = a.y + c.crownR * 0.25;
      cz = a.z;
      cr = c.crownR * (0.42 + r() * 0.16);
    } else {
      const ang = r() * Math.PI * 2;
      const rad = c.crownR * Math.sqrt(r()) * 1.05;
      const dome = 1 - Math.pow(rad / (c.crownR * 1.1), 2);
      cx = Math.cos(ang) * rad + c.lean * H * 0.09;
      cz = Math.sin(ang) * rad;
      cy = centerY - c.crownR * 0.25 + dome * c.crownR * 0.85 + (r() - 0.5) * c.crownR * 0.3;
      cr = c.crownR * (0.3 + r() * 0.22) * (0.7 + 0.5 * dome);
    }
    const g = weld(new THREE.IcosahedronGeometry(1, c.detail ?? 2));
    const gp = g.getAttribute('position');
    const sd = r() * 50;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const y = gp.getY(i);
      const z = gp.getZ(i);
      const n = Math.sin(x * 3.1 + sd) * Math.sin(y * 2.7 + sd * 1.3) * Math.sin(z * 3.3 + sd * 0.7) * 0.28 + Math.sin(x * 7 + z * 6 + sd) * 0.09;
      const k2 = 1 + n;
      gp.setXYZ(i, x * k2 * cr, y * k2 * cr * 0.74, z * k2 * cr);
    }
    g.computeVertexNormals();
    g.translate(cx, cy, cz);
    const gold = r() < c.goldChance;
    const pal = gold ? c.gold : c.leaf;
    const base = new THREE.Color(pal[Math.floor(r() * pal.length)]!);
    const gb = bake(g, { color: base, rough: 0.82 });
    paint(gb, (x, y, z, _nx, ny, _nz, out) => {
      const ly = (y - cy) / cr;
      const n = vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.5 + 0.5;
      out.copy(base);
      out.multiplyScalar(0.5 + 0.55 * sstep(-0.9, 0.7, ly) + 0.25 * n);
      _col2.set('#f2e08a');
      out.lerp(_col2, sstep(0.3, 1.0, ly + ny * 0.3) * 0.28);
    });
    parts.push(gb);
  }
  const out = merge(parts);
  void _col;
  return out;
}

function conifer(seed: number): Geo {
  const r = rng(seed);
  const parts: Geo[] = [];
  const tiers = 5;
  parts.push(bake(cyl(0.18, 0.3, 2.2, 6), { color: '#4a3526', rough: 0.95 }, { p: [0, 1.1, 0] }));
  for (let k = 0; k < tiers; k++) {
    const u = k / (tiers - 1);
    const rad = 2.1 * (1 - u * 0.78) + r() * 0.15;
    const g = bake(cone(rad, 2.4 - u * 0.5, 8), { color: '#2d5f3a', rough: 0.9 }, { p: [0, 2.2 + k * 1.35, 0], r: [0, r() * 3, 0] });
    gradient(g, 'y', 2.2 + k * 1.35 - 1.2, 2.2 + k * 1.35 + 1.2, '#1f4a2e', k % 2 ? '#3f7a44' : '#4b8848');
    parts.push(g);
  }
  return merge(parts);
}

function silhouetteTree(): Geo {
  return merge([
    bake(cone(1.6, 5.5, 6), { color: '#2b4f45', rough: 1 }, { p: [0, 3.6, 0] }),
    bake(cone(1.2, 4.0, 6), { color: '#33594c', rough: 1 }, { p: [0, 6.4, 0] }),
    bake(cone(0.8, 3.0, 6), { color: '#3a6353', rough: 1 }, { p: [0, 8.8, 0] }),
  ]);
}

// ───────────────────────── rocks ─────────────────────────

function paintRock(g: Geo): Geo {
  const stone = new THREE.Color('#8b867b');
  const dark = new THREE.Color('#5d5a54');
  const warm = new THREE.Color('#9a8d78');
  const moss = new THREE.Color('#5e8a3c');
  const moss2 = new THREE.Color('#86ab4d');
  return paint(bake(g, { color: '#888', rough: 0.92 }), (x, y, z, _nx, ny, _nz, out) => {
    const n = vnoise(x * 2.3, y * 2.3, z * 2.3) * 0.5 + 0.5;
    const n2 = vnoise(x * 6.1 + 3, y * 6.1, z * 6.1) * 0.5 + 0.5;
    out.copy(stone).lerp(dark, sstep(0.35, 0.9, n) * 0.7).lerp(warm, sstep(0.5, 0.8, n2) * 0.4);
    const m = sstep(0.15, 0.55, ny + (n - 0.5) * 0.7);
    out.lerp(moss, m * 0.85).lerp(moss2, m * sstep(0.5, 0.9, n2) * 0.6);
    out.multiplyScalar(0.62 + 0.5 * sstep(-0.6, 0.6, y));
  });
}

// ───────────────────────── small plants ─────────────────────────


function blade(h: number, w: number, curve: number, rows: number, cBase: THREE.Color, cTip: THREE.Color, yaw: number, px: number, pz: number): Geo {
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < rows; i++) {
    const u = i / rows;
    const wy = w * (1 - u * 0.85);
    const y = u * h;
    const z = curve * u * u * h;
    pos.push(-wy, y, z, wy, y, z);
    const c = _col.copy(cBase).lerp(cTip, u);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  pos.push(0, h, curve * h);
  col.push(cTip.r, cTip.g, cTip.b);
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    const o = i * 2;
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  }
  const top = (rows - 1) * 2;
  idx.push(top, top + 1, rows * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const bg = bake(g, { color: '#fff', rough: 0.85 }, { r: [0, yaw, 0], p: [px, 0, pz] });
  bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return bg;
}

function grassTuft(): Geo {
  const parts: Geo[] = [];
  const blades = 5;
  const cBase = new THREE.Color('#2f5f2a');
  const cTip = new THREE.Color('#b5d660');
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    parts.push(blade(0.32 + (b % 3) * 0.13, 0.038, 0.12 + (b % 2) * 0.08, 3, cBase, cTip, a, Math.sin(a) * 0.05, Math.cos(a) * 0.05));
  }
  return merge(parts);
}

function fern(): Geo {
  const parts: Geo[] = [];
  const fronds = 6;
  const cA = new THREE.Color('#2b6a33');
  const cB = new THREE.Color('#79b544');
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + (f % 2) * 0.3;
    const len = 0.55 + (f % 3) * 0.12;
    const seg = 6;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const rach: Array<[number, number, number]> = [];
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      rach.push([0, 0.08 + Math.sin(u * 2.2) * len * 0.42 - u * u * len * 0.1, u * len]);
    }
    for (let i = 0; i < seg; i++) {
      const u = i / seg;
      const p0 = rach[i]!;
      const p1 = rach[i + 1]!;
      const lw = Math.sin((0.15 + u * 0.85) * Math.PI) * len * 0.22 + 0.02;
      const base = pos.length / 3;
      pos.push(p0[0], p0[1], p0[2], -lw, (p0[1] + p1[1]) / 2 - lw * 0.35, (p0[2] + p1[2]) / 2 + lw * 0.2, p1[0], p1[1], p1[2], lw, (p0[1] + p1[1]) / 2 - lw * 0.35, (p0[2] + p1[2]) / 2 + lw * 0.2);
      const c = _col.copy(cA).lerp(cB, u);
      for (let q = 0; q < 4; q++) col.push(c.r, c.g, c.b);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const bg = bake(g, { color: '#fff', rough: 0.8 }, { r: [0, a, 0] });
    bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(bg);
  }
  return merge(parts);
}

function flower(petal: string, center: string): Geo {
  const parts: Geo[] = [bake(cyl(0.004, 0.006, 0.3, 3), { color: '#4f8a3a', rough: 0.8 }, { p: [0, 0.15, 0] })];
  parts.push(bake(new THREE.OctahedronGeometry(0.03, 0), { color: '#4f8a3a', rough: 0.8 }, { p: [0.02, 0.09, 0], s: [1, 0.3, 0.5], r: [0, 0, 0.5] }));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    parts.push(bake(new THREE.OctahedronGeometry(0.03, 0), { color: petal, rough: 0.6 }, { p: [Math.sin(a) * 0.028, 0.31, Math.cos(a) * 0.028], r: [-0.5, a, 0], s: [0.55, 0.3, 1] }));
  }
  parts.push(bake(new THREE.OctahedronGeometry(0.014, 0), { color: center, rough: 0.5, emit: 0.3 }, { p: [0, 0.315, 0] }));
  return merge(parts);
}
function reedClump(): Geo {
  const parts: Geo[] = [];
  const cb = new THREE.Color('#3c6a2c');
  const ct = new THREE.Color('#a5c866');
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2 + 0.4 * b;
    const h = 0.9 + (b % 3) * 0.28;
    parts.push(blade(h, 0.02, 0.22 + (b % 2) * 0.12, 4, cb, ct, a, Math.sin(a) * 0.04, Math.cos(a) * 0.04));
    if (b === 1 || b === 4) {
      const lean = 0.22 * h;
      const ex = Math.sin(a) * lean * 0.9;
      const ez = Math.cos(a) * lean * 0.9;
      parts.push(bake(cyl(0.028, 0.028, 0.2, 5), { color: '#6b4422', rough: 0.9 }, { p: [ex, h * 0.95, ez] }));
    }
  }
  return merge(parts);
}
function lilyPad(): Geo {
  const g = new THREE.CircleGeometry(0.42, 16, 0.5, Math.PI * 2 - 0.5);
  g.rotateX(-Math.PI / 2);
  const b = bake(g, { color: '#3c8a45', rough: 0.55 });
  return paint(b, (x, _y, z, _nx, _ny, _nz, out) => {
    const d = Math.hypot(x, z) / 0.42;
    out.set('#2f7a3d').lerp(_col2.set('#79b85a'), sstep(0.9, 0.2, d) * 0.6);
    if (Math.abs(Math.atan2(z, x) * 3) % 1 < 0.06) out.multiplyScalar(0.8);
  });
}

function lotus(): Geo {
  const parts: Geo[] = [];
  for (let ring = 0; ring < 2; ring++) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + ring * 0.5;
      parts.push(bake(new THREE.OctahedronGeometry(0.07, 0), { color: ring ? '#f7b9d2' : '#e88db4', rough: 0.55 }, { p: [Math.sin(a) * (0.05 + ring * 0.02), 0.09 + ring * 0.02, Math.cos(a) * (0.05 + ring * 0.02)], r: [Math.sin(a) * -0.6, a, 0], s: [0.5, 1.2, 0.25] }));
    }
  }
  parts.push(bake(new THREE.OctahedronGeometry(0.035, 0), { color: '#ffd45a', rough: 0.4, emit: 0.9 }, { p: [0, 0.07, 0] }));
  return merge(parts);
}
export function buildFlora(c: BuildCtx): Part & { mushMat: THREE.MeshBasicNodeMaterial } {
  const { scene, quality: q, bin } = c;
  const D = q.density;
  const group = new THREE.Group();
  group.name = 'flora';
  scene.add(group);
  const R = rng(4242);
  const treeMat = bin.add(vcMaterial({ sway: [0.05, 1.05, 0.07] }));
  const rockMat = bin.add(vcMaterial());
  const taken: Array<[number, number, number]> = [];
  const free = (x: number, z: number, rad: number): boolean => {
    for (const t of taken) if (Math.hypot(t[0] - x, t[1] - z) < t[2] + rad) return false;
    return true;
  };

  // ── ancient giants (hand placed for composition) ──
  const oakCfg = (seed: number, gold: number, leaf: string[]): TreeCfg => ({
    height: 17,
    trunkR: 1.05,
    crownR: 6.2,
    clumps: 24,
    seed,
    bark: '#5b4330',
    barkLight: '#86664a',
    leaf,
    gold: ['#e3ad3a', '#d98b2d', '#c8c246'],
    goldChance: gold,
    flare: 0.85,
    lean: 0.35,
    roots: 6 + (seed % 3),
    branches: 6,
  });
  const giantGeos = [
    treeGeometry(oakCfg(11, 0.18, ['#2f6d3b', '#438a3f', '#5f9a44'])),
    treeGeometry(oakCfg(23, 0.34, ['#356f3a', '#4d9040', '#78a846'])),
    treeGeometry(oakCfg(37, 0.12, ['#2a6a45', '#3b8a4e', '#4f9a4a'])),
    treeGeometry({ ...oakCfg(51, 0.25, ['#316e3a', '#549a43', '#6fa649']), height: 20, trunkR: 1.25, crownR: 7 }),
  ];
  giantGeos.forEach((g) => bin.add(g));
  const giantSpots: Array<[number, number, number, number]> = [
    [-15.6, 4.6, 0, 1.0], [-13.4, -8.6, 1, 1.05], [-20.4, -1.4, 3, 1.1], [-16.4, -19.5, 2, 1.0], [-24, 9.5, 1, 1.15], [-12.4, 12.5, 0, 0.95],
    [15.4, 5.4, 1, 1.0], [14.2, -10.4, 3, 1.05], [19.8, -3.2, 0, 1.1], [16.8, -21.5, 2, 1.0], [24.6, 8.8, 3, 1.1], [12.6, 12.8, 2, 0.95],
    [-9.6, -33, 0, 1.0], [9.8, -34, 1, 1.0],
  ];
  const perGiant: THREE.Matrix4[][] = giantGeos.map(() => []);
  for (const [x, z, v, s] of giantSpots) {
    const y = groundAt(x, z) - 0.15;
    perGiant[v]!.push(matrixAt(x, y, z, R() * 6.28, s * (0.92 + R() * 0.16)));
    taken.push([x, z, 2.4 * s]);
  }
  giantGeos.forEach((g, i) => {
    const im = makeInstanced(g, treeMat, perGiant[i]!, { cast: true, name: `giantTree${i}` });
    group.add(im);
  });

  // leaning riverside trees (birch) that frame the water
  const birchCfg = (seed: number): TreeCfg => ({
    height: 10,
    trunkR: 0.26,
    crownR: 2.7,
    clumps: 11,
    seed,
    bark: '#d8d2c2',
    barkLight: '#efe9db',
    leaf: ['#8fbf48', '#a9cb4f', '#7bb146'],
    gold: ['#e8c04a', '#d9a53a'],
    goldChance: 0.4,
    flare: 0.4,
    lean: 0.8,
    birch: true,
    roots: 4,
    branches: 4,
  });
  const birchGeos = [treeGeometry(birchCfg(71)), treeGeometry(birchCfg(83))];
  birchGeos.forEach((g) => bin.add(g));
  const perBirch: THREE.Matrix4[][] = birchGeos.map(() => []);
  const birchSpots: Array<[number, number, number, number]> = [
    [-7.4, -13.5, 0, 0.32], [7.6, -17, 1, -0.3], [-7.8, -25, 1, 0.25], [7.7, -8.5, 0, -0.26], [-8.6, 15, 1, 0.2], [8.8, 16, 0, -0.2],
  ];
  for (const [x, z, v, tilt] of birchSpots) {
    perBirch[v]!.push(matrixAt(x, groundAt(x, z) - 0.1, z, R() * 6.28, 1 + R() * 0.25, 0, tilt));
    taken.push([x, z, 1.2]);
  }
  birchGeos.forEach((g, i) => group.add(makeInstanced(g, treeMat, perBirch[i]!, { cast: true, name: `birch${i}` })));

  // mid-size oaks fill the forest
  const midCfg = (seed: number, gold: number): TreeCfg => ({
    height: 10.5,
    trunkR: 0.55,
    crownR: 3.6,
    clumps: 10,
    seed,
    bark: '#5a4632',
    barkLight: '#7d6247',
    leaf: ['#2f6d3b', '#4a8c3f', '#6aa046'],
    gold: ['#e0a838', '#cf8a2e', '#bcc043'],
    goldChance: gold,
    flare: 0.6,
    lean: 0.4,
    roots: 5,
    branches: 4,
  });
  const midGeos = [treeGeometry(midCfg(101, 0.15)), treeGeometry(midCfg(113, 0.3)), treeGeometry(midCfg(127, 0.08))];
  midGeos.forEach((g) => bin.add(g));
  const perMid: THREE.Matrix4[][] = midGeos.map(() => []);
  const nMid = Math.round(34 * D);
  let tries = 0;
  while (perMid.reduce((a, b) => a + b.length, 0) < nMid && tries++ < 2000) {
    const side = R() < 0.5 ? -1 : 1;
    const x = side * (9.5 + R() * 34);
    const z = -58 + R() * 78;
    const d = Math.abs(x) - bankEdge(z);
    if (d < 3.4 || inPlay(x, z, 1.5) || !free(x, z, 1.6)) continue;
    if (z < FALL_Z - 1 && Math.abs(x) < 8) continue;
    const v = Math.floor(R() * 3);
    perMid[v]!.push(matrixAt(x, groundAt(x, z) - 0.1, z, R() * 6.28, 0.8 + R() * 0.5));
    taken.push([x, z, 1.6]);
  }
  midGeos.forEach((g, i) => group.add(makeInstanced(g, treeMat, perMid[i]!, { cast: i === 0, name: `midTree${i}` })));

  // conifers on the hills, silhouette trees far away
  const coniGeo = bin.add(conifer(5));
  const coniM: THREE.Matrix4[] = [];
  const nConi = Math.round(90 * D);
  tries = 0;
  while (coniM.length < nConi && tries++ < 3000) {
    const side = R() < 0.5 ? -1 : 1;
    const x = side * (16 + R() * 60);
    const z = -85 + R() * 105;
    if (!free(x, z, 1.6)) continue;
    coniM.push(matrixAt(x, groundAt(x, z) - 0.2, z, R() * 6, 0.9 + R() * 0.9));
    taken.push([x, z, 1.4]);
  }
  group.add(makeInstanced(coniGeo, treeMat, coniM, { name: 'conifers' }));
  const silGeo = bin.add(silhouetteTree());
  const silM: THREE.Matrix4[] = [];
  const nSil = Math.round(220 * Math.max(0.5, D));
  for (let i = 0; i < nSil; i++) {
    const x = (R() - 0.5) * 300;
    const z = -95 - R() * 60;
    if (Math.abs(x) < 6 && z > -110) continue;
    silM.push(matrixAt(x, groundAt(x, z) - 0.5, z, R() * 6, 1.6 + R() * 2.4));
  }
  group.add(makeInstanced(silGeo, bin.add(vcMaterial()), silM, { name: 'silhouettes' }));

  // ── rocks ──
  const rockGeos = [1, 2, 3, 4].map((s) => bin.add(paintRock(rockGeometry(1, s * 3.7, 2, 0.62 + s * 0.05))));
  const perRock: THREE.Matrix4[][] = rockGeos.map(() => []);
  const addRock = (x: number, z: number, s: number, ySink = 0.25, sy = 1): void => {
    const v = Math.floor(R() * rockGeos.length);
    perRock[v]!.push(matrixAt(x, groundAt(x, z) - s * ySink, z, R() * 6.28, [s * (0.9 + R() * 0.3), s * sy, s * (0.9 + R() * 0.3)]));
  };
  // hero boulders around the bank / play area edge (outside the walk zones)
  const boulders: Array<[number, number, number]> = [
    [-6.5, -6.6, 1.5], [-7.3, 8.6, 1.3], [6.7, -5.9, 1.6], [7.4, 7.8, 1.2], [-11.8, -6.3, 1.9], [12.2, -6.6, 1.7], [-12.4, 7.4, 1.5], [12.6, 7.9, 1.6],
    [-6.6, -21, 2.0], [6.9, -23, 2.2], [-10.5, -14, 1.4], [10.8, -15.5, 1.5], [-7.0, -38.8, 2.6], [7.3, -39.2, 2.8], [-1.7, -40.4, 1.5], [2.2, -40.6, 1.6],
    [-15, 1.2, 1.1], [15.5, -0.8, 1.2],
  ];
  for (const [x, z, s] of boulders) {
    addRock(x, z, s, 0.3, 0.85);
    taken.push([x, z, s * 0.9]);
  }
  const nSmall = Math.round(70 * D);
  tries = 0;
  let placed = 0;
  while (placed < nSmall && tries++ < 1500) {
    const side = R() < 0.5 ? -1 : 1;
    const z = -45 + R() * 62;
    const x = side * (bankEdge(z) + (R() - 0.6) * 2.4);
    if (inPlay(x, z, 0.4)) continue;
    addRock(x, z, 0.25 + R() * 0.55, 0.3);
    placed++;
  }
  // stepping stones far upstream
  const stepGeo = bin.add(
    merge([
      paintRock(rockGeometry(0.62, 9, 2, 0.4)),
      bake(cyl(0.55, 0.75, 2.2, 8), { color: '#4d5d52', rough: 0.9 }, { p: [0, -1.1, 0] }),
    ]),
  );
  const stepM: THREE.Matrix4[] = [];
  const stepX = [-5.0, -3.5, -1.8, -0.1, 1.6, 3.3, 4.9];
  stepX.forEach((x, i) => stepM.push(matrixAt(x, 0.02 + Math.sin(i * 2.1) * 0.03, -27 + Math.sin(i * 1.3) * 0.6, i * 1.7, 0.95 + 0.15 * Math.sin(i * 3.3))));
  group.add(makeInstanced(stepGeo, rockMat, stepM, { cast: true, name: 'steppingStones' }));
  rockGeos.forEach((g, i) => group.add(makeInstanced(g, rockMat, perRock[i]!, { cast: i < 2, name: `rocks${i}` })));

  // ── undergrowth ──
  const grassMat = bin.add(vcMaterial({ side: THREE.DoubleSide, sway: [0.16, 1.8, 2.4] }));
  const grassGeo = bin.add(grassTuft());
  const gM: THREE.Matrix4[] = [];
  const nGrass = Math.round(2200 * D);
  tries = 0;
  while (gM.length < nGrass && tries++ < nGrass * 3) {
    const side = R() < 0.5 ? -1 : 1;
    const z = -48 + R() * 68;
    const d = 0.5 + Math.pow(R(), 1.6) * 30;
    const x = side * (bankEdge(z) + d);
    if (Math.abs(x) < 7.2 && Math.abs(z) < 5) continue;
    gM.push(matrixAt(x, groundAt(x, z) - 0.02, z, R() * 6.28, 0.7 + R() * 1.1));
  }
  group.add(makeInstanced(grassGeo, grassMat, gM, { name: 'grass' }));

  const fernMat = bin.add(vcMaterial({ side: THREE.DoubleSide, sway: [0.1, 1.4, 1.6] }));
  const fernGeo = bin.add(fern());
  const fM: THREE.Matrix4[] = [];
  const nFern = Math.round(320 * D);
  tries = 0;
  while (fM.length < nFern && tries++ < nFern * 6) {
    const side = R() < 0.5 ? -1 : 1;
    const z = -46 + R() * 62;
    const x = side * (bankEdge(z) + 1.2 + R() * 26);
    if (inPlay(x, z, -0.5)) continue;
    fM.push(matrixAt(x, groundAt(x, z), z, R() * 6.28, 0.8 + R() * 0.9));
  }
  group.add(makeInstanced(fernGeo, fernMat, fM, { name: 'ferns' }));

  const flowerDefs: Array<[string, string]> = [['#fffaf0', '#ffd04a'], ['#ffd23f', '#e0862a'], ['#ff8fb8', '#ffe27a'], ['#9b8cff', '#fff2a0'], ['#ff7a4a', '#3a2a20']];
  flowerDefs.forEach(([pet, cen], i) => {
    const g = bin.add(flower(pet, cen));
    const m: THREE.Matrix4[] = [];
    const n = Math.round(100 * D);
    let tr = 0;
    while (m.length < n && tr++ < n * 6) {
      const side = R() < 0.5 ? -1 : 1;
      const z = -40 + R() * 56;
      const x = side * (bankEdge(z) + 0.7 + Math.pow(R(), 1.5) * 14);
      // drifts of flowers: only where a slow noise is high
      if (vnoise(x * 0.25 + i * 7, z * 0.25) < -0.1) continue;
      if (Math.abs(x) < 7.5 && Math.abs(z) < 4.5) continue;
      m.push(matrixAt(x, groundAt(x, z), z, R() * 6.28, 0.8 + R() * 0.7, (R() - 0.5) * 0.25, (R() - 0.5) * 0.25));
    }
    group.add(makeInstanced(g, bin.add(vcMaterial({ sway: [0.12, 2.0, 3.0] })), m, { name: `flowers${i}` }));
  });

  // reeds and cattails along the shore
  const reedGeo = bin.add(reedClump());
  const reedM: THREE.Matrix4[] = [];
  const nReed = Math.round(120 * D);
  tries = 0;
  while (reedM.length < nReed && tries++ < nReed * 8) {
    const side = R() < 0.5 ? -1 : 1;
    const z = -46 + R() * 60;
    const x = side * (bankEdge(z) - 0.1 + (R() - 0.5) * 1.3);
    if (Math.abs(z - 1.45) < 2.2 && Math.abs(x) > 3) continue;
    if (Math.abs(z) < 2.4) continue;
    reedM.push(matrixAt(x, groundAt(x, z) - 0.05, z, R() * 6.28, 0.8 + R() * 0.8));
  }
  group.add(makeInstanced(reedGeo, bin.add(vcMaterial({ side: THREE.DoubleSide, sway: [0.14, 1.5, 1.6] })), reedM, { name: 'reeds' }));

  // lily pads + lotus in the shallows
  const padGeo = bin.add(lilyPad());
  const padM: THREE.Matrix4[] = [];
  const lotusGeo = bin.add(lotus());
  const lotusM: THREE.Matrix4[] = [];
  const nPad = Math.round(80 * D);
  tries = 0;
  while (padM.length < nPad && tries++ < nPad * 12) {
    const side = R() < 0.5 ? -1 : 1;
    const z = -34 + R() * 50;
    const x = side * (bankEdge(z) - 0.7 - R() * 2.4);
    if (Math.abs(z) < 2.6 || (Math.abs(z - 1.45) < 1.5 && Math.abs(x) > 3)) continue;
    padM.push(matrixAt(x, 0.03, z, R() * 6.28, 0.7 + R() * 0.9));
    if (R() < 0.16) lotusM.push(matrixAt(x + 0.2, 0.03, z + 0.1, R() * 6.28, 0.9 + R() * 0.5));
  }
  const padMat = bin.add(vcMaterial({ side: THREE.DoubleSide }));
  group.add(makeInstanced(padGeo, padMat, padM, { name: 'lilyPads' }));
  group.add(makeInstanced(lotusGeo, bin.add(vcMaterial({ side: THREE.DoubleSide })), lotusM, { name: 'lotus' }));

  // ── glowing mushrooms ──
  const capGeo = bin.add((() => {
    const g = new THREE.SphereGeometry(0.5, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 0.62, 1);
    return g;
  })());
  const stemGeo = bin.add(merge([bake(cyl(0.07, 0.11, 0.5, 7), { color: '#e9e2cf', rough: 0.7 }, { p: [0, 0.25, 0] }), bake(ellipsoid(0.1, 0.05, 0.1, 8, 5), { color: '#cfc6ae', rough: 0.8 }, { p: [0, 0.02, 0] })]));
  const mushMat = bin.add(glowMat('#ffffff', 2.4));
  const capM: THREE.Matrix4[] = [];
  const stemM: THREE.Matrix4[] = [];
  const capC: THREE.Color[] = [];
  const glowCols = ['#5df0d0', '#7cc4ff', '#ffb066', '#ff8fd0', '#b6ff7a'];
  const pools: Array<{ x: number; y: number; z: number; r: number; color: THREE.ColorRepresentation; a?: number }> = [];
  const clusters: Array<[number, number, number]> = [
    [-13.5, 2.8, 0], [-11.6, -5.2, 1], [13.2, -4.2, 2], [12.4, 7.5, 0], [-9.2, -9.8, 3], [9.6, -11.5, 1], [-17, -6.5, 0], [17.2, 1.5, 4],
    [-12.6, -16.5, 2], [13.6, -14.2, 3], [-8.8, 11.5, 4], [9.5, 12.6, 1], [15.6, -7.2, 0], [-15.2, -12.2, 1], [-6.8, -31, 3], [7.4, -30, 0],
  ];
  const nMush = Math.max(4, Math.round(clusters.length * Math.min(1, 0.4 + D * 0.6)));
  clusters.slice(0, nMush).forEach(([cx, cz, ci]) => {
    const n = 4 + Math.floor(R() * 4);
    const col = glowCols[ci % glowCols.length]!;
    for (let k = 0; k < n; k++) {
      const a = R() * 6.28;
      const rr = 0.1 + R() * 0.55;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const s = 0.22 + R() * 0.5;
      const y = groundAt(x, z);
      const tilt = (R() - 0.5) * 0.3;
      capM.push(matrixAt(x, y + 0.5 * s, z, R() * 6, [s * 0.9, s * 1.0, s * 0.9], tilt, tilt));
      stemM.push(matrixAt(x, y - 0.02, z, R() * 6, [s * 0.9, s, s * 0.9], tilt, tilt));
      _col.set(col).lerp(_col2.set('#ffffff'), R() * 0.25);
      capC.push(_col.clone());
    }
    pools.push({ x: cx, y: groundAt(cx, cz) + 0.04, z: cz, r: 1.3, color: col, a: 0.55 });
  });
  group.add(makeInstanced(capGeo, mushMat, capM, { colors: capC, receive: false, name: 'mushroomCaps' }));
  group.add(makeInstanced(stemGeo, rockMat, stemM, { name: 'mushroomStems' }));
  group.add(makePools(pools));
  void halo;

  return {
    mushMat,
    update(_dt, t) {
      const k = 2.1 + Math.sin(t * 1.6) * 0.35;
      mushMat.color.setScalar(k);
    },
  };
}
