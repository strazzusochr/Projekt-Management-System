import * as THREE from 'three/webgpu';
import { weld, rng } from '../../world/kit';
import { bake } from '../../characters/geo';
import { Parts, nz, paint } from './helpers';

export interface IslandSpec {
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  depth: number;
  /** Height of the top surface relative to cy. */
  topY: number;
  seed: number;
  /** Extra terrain height (local x/z relative to the centre) added on the top. */
  topFn?: (x: number, z: number) => number;
  seg?: [number, number];
  grassA?: string;
  grassB?: string;
  rockA?: string;
  rockB?: string;
  /** Emissive crystal clusters below (colour). */
  crystal?: string;
  vines?: number;
}

const RIM_DROP = 1.15;

export function rimAt(s: IslandSpec, phi: number): number {
  return s.radius * (1 + 0.075 * Math.sin(3 * phi + s.seed) + 0.05 * Math.sin(5 * phi + s.seed * 2.1) + 0.03 * Math.sin(8 * phi + s.seed * 3.3));
}

/** Terrain height at a world position (world y), valid on the top surface. */
export function islandTopAt(s: IslandSpec, wx: number, wz: number): number {
  const lx = wx - s.cx;
  const lz = wz - s.cz;
  const phi = Math.atan2(lz, lx);
  const rho = Math.min(1, Math.hypot(lx, lz) / rimAt(s, phi));
  const edge = Math.pow(rho, 6);
  return s.cy + s.topY + 0.14 * nz(lx * 0.3 + s.seed, 0, lz * 0.3) * (1 - edge) - edge * RIM_DROP + (s.topFn ? s.topFn(lx, lz) * (1 - edge * 0.85) : 0);
}

export function insideIsland(s: IslandSpec, wx: number, wz: number, margin = 0.85): boolean {
  const lx = wx - s.cx;
  const lz = wz - s.cz;
  const phi = Math.atan2(lz, lx);
  return Math.hypot(lx, lz) < rimAt(s, phi) * margin;
}

/** Floating island: flat-ish grassy top, craggy hanging underside, strata colours. Local origin = (cx, cy, cz). */
export function islandParts(s: IslandSpec, parts: Parts): void {
  const [sw, sh] = s.seg ?? [80, 48];
  const g0 = weld(new THREE.SphereGeometry(1, sw, sh));
  const pos = g0.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i);
    const dy = pos.getY(i);
    const dz = pos.getZ(i);
    const phi = Math.atan2(dz, dx);
    const rho = Math.hypot(dx, dz);
    const rim = rimAt(s, phi);
    let r: number;
    let y: number;
    if (dy >= 0) {
      r = rim * rho;
      const lx = Math.cos(phi) * r;
      const lz = Math.sin(phi) * r;
      const edge = Math.pow(rho, 6);
      y = s.topY + 0.14 * nz(lx * 0.3 + s.seed, 0, lz * 0.3) * (1 - edge) - edge * RIM_DROP + (s.topFn ? s.topFn(lx, lz) * (1 - edge * 0.85) : 0);
    } else {
      const u = -dy;
      const k = Math.pow(1 - u, 0.85);
      const ribs = Math.max(0, Math.sin(phi * 7 + s.seed * 1.3 + u * 4)) * Math.sin(u * Math.PI);
      const ribs2 = Math.max(0, Math.sin(phi * 13 + s.seed * 2.7 - u * 6)) * Math.sin(u * Math.PI) * 0.5;
      r = rim * k * (1 + 0.16 * nz(dx * 3 + s.seed, dy * 2.5, dz * 3) - 0.08 + 0.26 * ribs + 0.12 * ribs2);
      y = s.topY - RIM_DROP - s.depth * Math.pow(u, 1.2) * (1 + 0.18 * nz(dx * 2.2, dy * 1.7 + s.seed, dz * 2.2));
    }
    pos.setXYZ(i, Math.cos(phi) * r, y, Math.sin(phi) * r);
  }
  g0.computeVertexNormals();
  const geo = bake(g0, { color: '#ffffff', rough: 0.93 });
  const gA = new THREE.Color(s.grassA ?? '#86b246');
  const gB = new THREE.Color(s.grassB ?? '#b4c65a');
  const rA = new THREE.Color(s.rockA ?? '#8f7358');
  const rB = new THREE.Color(s.rockB ?? '#b89a76');
  const moss = new THREE.Color('#6a9a40');
  const soil = new THREE.Color('#7a5a3a');
  const tint = new THREE.Color('#5a4a70');
  const tmp = new THREE.Color();
  paint(geo, (p, n, c) => {
    const yRel = p.y - (s.topY - RIM_DROP);
    const stripe = 0.5 + 0.5 * Math.sin(p.y * 2.2 + nz(p.x * 0.25, p.y * 0.15, p.z * 0.25) * 2.4);
    c.copy(rA).lerp(rB, stripe);
    const deep = Math.min(1, Math.max(0, -yRel / s.depth));
    c.multiplyScalar(1 - 0.5 * Math.pow(deep, 1.1));
    c.lerp(tint, Math.pow(deep, 2) * 0.55);
    const gr = Math.min(1, Math.max(0, (yRel + 0.55) / 0.7)) * Math.min(1, Math.max(0, (n.y - 0.15) / 0.5));
    if (gr > 0) {
      tmp.copy(gA).lerp(gB, 0.5 + 0.5 * nz(p.x * 0.35, 0, p.z * 0.35));
      c.lerp(tmp, gr);
    }
    if (yRel > -RIM_DROP * 0.9 && yRel < 0.05 && n.y < 0.75) c.lerp(soil, 0.55 * (1 - gr));
    if (n.y > 0.55 && yRel < -0.5) c.lerp(moss, 0.4 * (1 - deep));
  });
  parts.addBaked(geo);

  const rnd = rng(s.seed * 977 + 13);
  // hanging vines with leaves + roots
  const nVines = s.vines ?? 12;
  for (let i = 0; i < nVines; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = rimAt(s, a) * (0.9 + rnd() * 0.06);
    const x0 = Math.cos(a) * rr;
    const z0 = Math.sin(a) * rr;
    const y0 = s.topY - RIM_DROP * 0.35;
    const L = 2.2 + rnd() * 4.5;
    const dirx = Math.cos(a);
    const dirz = Math.sin(a);
    const wob = (rnd() - 0.5) * 0.6;
    const pts: Array<[number, number, number]> = [
      [x0, y0, z0],
      [x0 + dirx * 0.25, y0 - L * 0.3, z0 + dirz * 0.25 + wob],
      [x0 + dirx * 0.45 - wob, y0 - L * 0.65, z0 + dirz * 0.45],
      [x0 + dirx * 0.3, y0 - L, z0 + dirz * 0.3 + wob * 0.5],
    ];
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 12, 0.045 + rnd() * 0.03, 4, false);
    parts.add(tg, { color: i % 3 === 0 ? '#5a3f2a' : '#4d7c3a', rough: 0.9 });
    const leaves = 5 + Math.floor(rnd() * 4);
    for (let k = 0; k < leaves; k++) {
      const t = (k + 0.5) / leaves;
      const py = y0 - L * t;
      parts.add(new THREE.SphereGeometry(1, 6, 4), { color: k % 2 ? '#86c04c' : '#5fa03e', rough: 0.8 }, { p: [x0 + dirx * (0.1 + 0.3 * t) + (k % 2 ? 0.1 : -0.1), py, z0 + dirz * (0.1 + 0.3 * t)], s: [0.16, 0.05, 0.1], r: [0, k * 1.3, 0.5] });
    }
  }
  // big roots below the rim
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const u = 0.25 + rnd() * 0.25;
    const rr = rimAt(s, a) * Math.pow(1 - u, 0.85) * 0.95;
    const x0 = Math.cos(a) * rr;
    const z0 = Math.sin(a) * rr;
    const y0 = s.topY - RIM_DROP - s.depth * Math.pow(u, 1.2);
    const L = 2.5 + rnd() * 3;
    const pts = [
      new THREE.Vector3(x0, y0, z0),
      new THREE.Vector3(x0 * 1.06, y0 - L * 0.3, z0 * 1.06),
      new THREE.Vector3(x0 * 1.02 + rnd() - 0.5, y0 - L * 0.7, z0 * 1.02 + rnd() - 0.5),
      new THREE.Vector3(x0 * 0.98, y0 - L, z0 * 0.98),
    ];
    parts.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.14, 5, false), { color: '#5a3d2a', rough: 0.95 });
  }
  // glowing crystal clusters on the underside
  if (s.crystal) {
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      const u = 0.35 + rnd() * 0.45;
      const rr = rimAt(s, a) * Math.pow(1 - u, 0.85) * 0.9;
      const x0 = Math.cos(a) * rr;
      const z0 = Math.sin(a) * rr;
      const y0 = s.topY - RIM_DROP - s.depth * Math.pow(u, 1.2);
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const h = 0.6 + rnd() * 1.3;
        parts.add(new THREE.ConeGeometry(0.16 + rnd() * 0.1, h, 5), { color: s.crystal, rough: 0.15, metal: 0.2, emit: 1.6 }, { p: [x0 + (rnd() - 0.5) * 0.7, y0 - h * 0.35 + (rnd() - 0.5) * 0.4, z0 + (rnd() - 0.5) * 0.7], r: [(rnd() - 0.5) * 1.2 + Math.PI, 0, (rnd() - 0.5) * 1.2] });
      }
    }
  }
}

/** Shifts a baked geometry into world space. */
export function toWorld(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geo.translate(x, y, z);
  return geo;
}

const sm01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Plateau bump: height h inside radius r0, falling off to 0 at r1. */
export function plateau(x: number, z: number, cx: number, cz: number, r0: number, r1: number, h: number): number {
  return h * sm01((r1 - Math.hypot(x - cx, z - cz)) / (r1 - r0));
}

export const ISLAND_A: IslandSpec = {
  cx: -21.9,
  cy: 0,
  cz: -3.0,
  radius: 14.5,
  depth: 19,
  topY: 0.12,
  seed: 2.3,
  crystal: '#7fd8ff',
  vines: 16,
  seg: [84, 48],
  topFn: (x, z) => plateau(x, z, 6.2, -7.6, 4.0, 8.0, 2.3) + plateau(x, z, -6.5, 2.5, 1.5, 4.5, 0.7),
};
export const ISLAND_B: IslandSpec = {
  cx: 21.6,
  cy: 0,
  cz: -2.5,
  radius: 14.0,
  depth: 21,
  topY: 0.12,
  seed: 5.7,
  crystal: '#b98cff',
  vines: 16,
  seg: [84, 48],
  grassA: '#7fae55',
  grassB: '#a9c268',
  rockA: '#7c6a78',
  rockB: '#a89aa8',
  topFn: (x, z) => plateau(x, z, -6.5, -7.0, 3.6, 7.6, 2.7) + plateau(x, z, 6.5, 2.0, 1.5, 4.5, 0.8),
};

/** Moves an island horizontally so its rim toward the gap ends `edge` metres from the gap centre (x = 0). */
export function alignIsland(s: IslandSpec, side: 1 | -1, edge = 7.5): void {
  for (let i = 0; i < 4; i++) {
    const phi = Math.atan2(-s.cz, side * edge - s.cx);
    s.cx = side * edge - rimAt(s, phi) * Math.cos(phi);
  }
}
