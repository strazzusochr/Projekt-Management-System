import * as THREE from 'three/webgpu';
import { mat } from '../../world/kit';
import { sstep, vnoise, lerp } from './common';

/** Flat bank shelf height next to the river. */
export const BANK_Y = 0.5;
/** Upstream water step (small waterfalls) at this z. */
export const FALL_Z = -40;
export const FALL_LIFT = 1.6;
/** Wooden jetty deck (same on both banks, mirrored in x). */
export const DECK_Y = 0.62;
export const DECK_Z = 1.45;
export const DECK_HALF_W = 0.6;
export const DECK_X0 = 3.4;
export const DECK_X1 = 9.0;

/** Meandering bank edge (|x| where water meets the bank). Straight near the play area. */
export function bankEdge(z: number): number {
  const k = sstep(3, 14, Math.abs(z));
  return 6.2 + k * (Math.sin(z * 0.16 + 0.6) * 0.55 + Math.sin(z * 0.43 + 2.1) * 0.3);
}

export function baseHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  const d = ax - bankEdge(z);
  let h: number;
  if (d < 0) {
    h = BANK_Y - (BANK_Y + 1.7) * sstep(0, 3.6, -d);
  } else {
    const hill = sstep(9, 42, d);
    const n = Math.sin(x * 0.09 + 1.3) * Math.cos(z * 0.08 + 0.4) + 0.6 * Math.sin(x * 0.21 - z * 0.15 + 2) + 0.4 * Math.sin(z * 0.045 + x * 0.05);
    h = BANK_Y + hill * (3 + 6.5 * (0.5 + 0.5 * n));
    h += (Math.sin(x * 0.7 + z * 0.45) + Math.sin(x * 0.31 - z * 0.83)) * 0.07 * sstep(3, 9, d);
  }
  h += FALL_LIFT * (1 - sstep(FALL_Z - 0.8, FALL_Z + 0.8, z));
  // valley closes far upstream, and behind the camera
  h += 14 * sstep(-100, -132, z) + 9 * sstep(52, 72, z);
  return h;
}

/** Terrain height incl. wooden jetty decks (actors walk on it). */
export function groundAt(x: number, z: number): number {
  let h = baseHeight(x, z);
  const ax = Math.abs(x);
  if (ax > DECK_X0 - 0.3 && ax < DECK_X1 + 0.3) {
    const w = 1 - sstep(DECK_HALF_W - 0.1, DECK_HALF_W + 0.1, Math.abs(z - DECK_Z));
    const e = sstep(DECK_X0 - 0.3, DECK_X0, ax) * (1 - sstep(DECK_X1 - 0.1, DECK_X1 + 0.3, ax));
    const k = w * e;
    if (k > 0) h = h * (1 - k) + Math.max(h, DECK_Y) * k;
  }
  return h;
}

const GRASS_A = new THREE.Color('#5f9238');
const GRASS_B = new THREE.Color('#8db044');
const GRASS_C = new THREE.Color('#3f7135');
const MOSS = new THREE.Color('#6e9a48');
const DIRT = new THREE.Color('#82694a');
const WET = new THREE.Color('#4d4433');
const SAND = new THREE.Color('#b9ab7c');
const BED = new THREE.Color('#3f7c72');
const ROCK = new THREE.Color('#7d796f');
const FOREST = new THREE.Color('#2f5f33');
const tmp = new THREE.Color();

function terrainColor(x: number, z: number, h: number, slope: number, out: THREE.Color): THREE.Color {
  const d = Math.abs(x) - bankEdge(z);
  const n1 = vnoise(x * 0.32, z * 0.32) * 0.5 + 0.5;
  const n2 = vnoise(x * 1.1 + 7, z * 1.1 - 3) * 0.5 + 0.5;
  const n3 = vnoise(x * 0.07 - 3, z * 0.07 + 5) * 0.5 + 0.5;
  if (d < 0) {
    const t = sstep(0, 3.4, -d);
    out.copy(SAND).lerp(BED, t);
    out.lerp(WET, (1 - sstep(0, 0.9, -d)) * 0.8);
    out.multiplyScalar(0.85 + n2 * 0.3);
    return out;
  }
  out.copy(GRASS_C).lerp(GRASS_A, sstep(0.25, 0.65, n1)).lerp(GRASS_B, sstep(0.6, 0.95, n1 * 0.6 + n3 * 0.5));
  out.lerp(MOSS, sstep(0.55, 0.85, n2) * 0.45);
  const hill = sstep(9, 44, d);
  out.lerp(FOREST, hill * 0.75);
  out.lerp(DIRT, (1 - sstep(0.15, 1.1, d)) * 0.85);
  out.lerp(WET, (1 - sstep(0.0, 0.35, d)) * 0.7);
  // worn earth around the jetty approaches
  const dj = Math.hypot(Math.abs(x) - 9.4, z - DECK_Z);
  out.lerp(DIRT, (1 - sstep(0.8, 2.6, dj)) * 0.75);
  // steep = rocky
  out.lerp(ROCK, sstep(0.55, 1.1, slope) * 0.8);
  // waterfall ledge is rocky
  out.lerp(ROCK, (1 - sstep(1.0, 3.4, Math.abs(z - FALL_Z))) * 0.7);
  tmp.setScalar(0.88 + n2 * 0.24);
  out.multiply(tmp);
  void h;
  return out;
}

function axis(limit: number, near: number, step: number, growth: number): number[] {
  const pos: number[] = [];
  let v = 0;
  while (v < limit) {
    pos.push(v);
    v += step + Math.max(0, v - near) * growth;
  }
  pos.push(limit);
  return pos;
}

/** Height-field mesh of the whole valley with baked vertex colours. */
export function buildTerrain(): THREE.Mesh {
  const xp = axis(120, 16, 0.4, 0.13);
  const xs = [...xp.slice(1).reverse().map((v) => -v), ...xp];
  const zNear = axis(40, 40, 0.8, 0);
  const zFar = axis(150, 40, 0.8, 0.12).filter((v) => v > 40);
  const zBack = axis(80, 20, 1.0, 0.2);
  const zs = [...zFar.reverse().map((v) => -v), ...zNear.slice(1).reverse().map((v) => -v), ...zNear, ...zBack.filter((v) => v > 40)];
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const hs = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const h = baseHeight(xs[i]!, zs[j]!);
      hs[k] = h;
      pos[k * 3] = xs[i]!;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = zs[j]!;
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const hl = hs[j * nx + Math.max(0, i - 1)]!;
      const hr = hs[j * nx + Math.min(nx - 1, i + 1)]!;
      const hd = hs[Math.max(0, j - 1) * nx + i]!;
      const hu = hs[Math.min(nz - 1, j + 1) * nx + i]!;
      const sx = (hr - hl) / (xs[Math.min(nx - 1, i + 1)]! - xs[Math.max(0, i - 1)]!);
      const sz = (hu - hd) / (zs[Math.min(nz - 1, j + 1)]! - zs[Math.max(0, j - 1)]!);
      terrainColor(xs[i]!, zs[j]!, hs[k]!, Math.hypot(sx, sz), tmp);
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const m = mat('#ffffff', 0.96, 0, { vertexColors: true });
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function mix3(a: number, b: number, t: number): number {
  return lerp(a, b, t);
}

/** Layered, hazy ridge lines all around the valley (atmospheric perspective backdrop). */
export function buildRidges(): THREE.Mesh {
  const layers = [
    { r: 175, h: 34, amp: 16, top: '#7fa48f', base: '#b9cfb6', seed: 1.3 },
    { r: 225, h: 46, amp: 20, top: '#98b9a0', base: '#cfdcbd', seed: 4.1 },
    { r: 285, h: 60, amp: 24, top: '#b3cbb0', base: '#dfe3bf', seed: 7.7 },
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const seg = 120;
  const c0 = new THREE.Color();
  const c1 = new THREE.Color();
  for (const L of layers) {
    const base = pos.length / 3;
    c0.set(L.top);
    c1.set(L.base);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = vnoise(a * 5 + L.seed, L.seed) * 0.5 + vnoise(a * 13, L.seed * 2) * 0.25 + 0.5;
      const top = L.h + L.amp * (n - 0.5) * 2;
      const x = Math.sin(a) * L.r;
      const z = -Math.cos(a) * L.r * 0.8 - 30;
      pos.push(x, -8, z, x, top, z);
      col.push(c1.r, c1.g, c1.b, c0.r, c0.g, c0.b);
    }
    for (let i = 0; i < seg; i++) {
      const o = base + i * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.fog = false;
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'ridges';
  mesh.frustumCulled = false;
  return mesh;
}
