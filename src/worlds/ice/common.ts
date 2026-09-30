import * as THREE from 'three/webgpu';
import { attribute, color, float, mix, mx_noise_float, normalWorld, positionWorld, smoothstep as tslSmooth, step, vertexColor } from 'three/tsl';
import { bake, cyl, ellipsoid, merge, roundedBox, tube, type Place, type Surface } from '../../characters/geo';
import type { QualityPreset } from '../../render/quality';

// ───────────────────────── layout constants ─────────────────────────

export const WATER_Y = 0;
export const BANK_Y = 0.6;
export const PLATFORM_Y = 0.62;
/** |x| of the ice edge on both banks. */
export const BANK_EDGE = 6.0;
export const DOCK_X = 4.2;
/** Heated station platform footprint (side 1). */
export const PLATFORM = { x0: 5.8, x1: 15.5, z0: -8.5, z1: 8.5 };
/** Hull deck height above the ferry root. */
export const FERRY_DECK = 0.56;

export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Pseudo noise used for terrain (cheap, deterministic). */
export function n2(x: number, z: number): number {
  return (
    Math.sin(x * 0.13 + 1.3) * Math.cos(z * 0.11 + 0.4) * 0.55 +
    Math.sin(x * 0.29 + z * 0.23 + 2.0) * 0.3 +
    Math.sin(x * 0.61 - z * 0.53 + 4.1) * 0.15
  );
}

/** Terrain height of the ice shelf / snow field (mesh + gameplay share this). */
export function terrainHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  let h = BANK_Y;
  if (ax < BANK_EDGE) {
    const t = smooth(BANK_EDGE, 4.4, ax);
    h = BANK_Y - t * 3.6;
  }
  // rolling drifts and ridges outside the play area
  const dz = Math.max(0, Math.abs(z) - 11);
  const dx = Math.max(0, ax - 21);
  const d = Math.hypot(dx, dz);
  const amp = smooth(0, 16, d);
  h += amp * (n2(x, z) * 2.4 + 0.6) + amp * amp * d * 0.05;
  // pressure ridges hugging the lead further out
  const ridge = Math.exp(-Math.pow((ax - 34) / 3.2, 2)) * (0.5 + 0.5 * Math.sin(z * 0.21 + ax)) * 2.2 * smooth(8, 30, Math.abs(z));
  h += ridge;
  // sunk under the heated platform
  if (x > 0) {
    const ddx = Math.max(PLATFORM.x0 - x, x - PLATFORM.x1, 0);
    const ddz = Math.max(Math.abs(z) - PLATFORM.z1, 0);
    const m = 1 - smooth(0, 1.6, Math.hypot(ddx, ddz));
    h = h + (0.12 - h) * m * (ax >= BANK_EDGE - 1 ? 1 : 0.6);
  }
  return h;
}

export function groundHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  if (x >= PLATFORM.x0 && x <= PLATFORM.x1 && Math.abs(z) <= PLATFORM.z1) return PLATFORM_Y;
  if (ax < 5.4) return WATER_Y;
  if (ax < BANK_EDGE && Math.abs(z) < 1.05) return BANK_Y - 0.02;
  return terrainHeight(x, z);
}

// ───────────────────────── materials ─────────────────────────

/**
 * Material for all baked props: colour / roughness / metal / emissive come from vertex attributes
 * (see geo.bake). Up-facing surfaces collect procedural snow automatically; emissive parts stay clean.
 */
export function createPropMaterial(o: { snow?: number; side?: THREE.Side } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  if (o.side !== undefined) m.side = o.side;
  const pbr = attribute('aPbr', 'vec3');
  const vc = vertexColor().rgb;
  const nz = mx_noise_float(positionWorld.mul(3.3)).mul(0.16);
  const snow = tslSmooth(0.5, 0.82, normalWorld.y.add(nz)).mul(step(pbr.z, 0.02)).mul(o.snow ?? 0.9);
  m.colorNode = mix(vc, color(new THREE.Color('#d3e3f5')), snow);
  m.roughnessNode = mix(pbr.x, float(0.62), snow);
  m.metalnessNode = pbr.y.mul(float(1).sub(snow));
  m.emissiveNode = vc.mul(pbr.z);
  return m;
}

// ───────────────────────── geometry builder ─────────────────────────

/** Collects baked parts and merges them into one geometry (one draw call). */
export class PropBuilder {
  private parts: THREE.BufferGeometry[] = [];

  get size(): number {
    return this.parts.length;
  }

  add(geo: THREE.BufferGeometry, surf: Surface, place?: Place | THREE.Matrix4): this {
    this.parts.push(bake(geo, surf, place));
    return this;
  }

  box(w: number, h: number, d: number, surf: Surface, place?: Place): this {
    return this.add(new THREE.BoxGeometry(w, h, d), surf, place);
  }

  rbox(w: number, h: number, d: number, r: number, surf: Surface, place?: Place): this {
    return this.add(roundedBox(w, h, d, r, 2), surf, place);
  }

  cyl(r0: number, r1: number, h: number, surf: Surface, place?: Place, seg = 14): this {
    return this.add(cyl(r0, r1, h, seg), surf, place);
  }

  ell(rx: number, ry: number, rz: number, surf: Surface, place?: Place, w = 14, h = 10): this {
    return this.add(ellipsoid(rx, ry, rz, w, h), surf, place);
  }

  cone(r: number, h: number, surf: Surface, place?: Place, seg = 10): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), surf, place);
  }

  tube(points: Array<[number, number, number]>, radius: number, surf: Surface, tubular = 16, radial = 6): this {
    return this.add(tube(points, radius, tubular, radial), surf);
  }

  /** Straight rod between two points. */
  rod(a: [number, number, number], b: [number, number, number], radius: number, surf: Surface, seg = 6): this {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(radius, radius, len, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, surf, m);
  }

  build(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = merge(this.parts);
    this.parts = [];
    return g;
  }
}

/** Common surfaces. */
export const S = {
  steel: { color: '#8a97a8', rough: 0.4, metal: 0.85 } as Surface,
  darkSteel: { color: '#39424f', rough: 0.45, metal: 0.8 } as Surface,
  rubber: { color: '#15181d', rough: 0.9 } as Surface,
  orange: { color: '#e2661c', rough: 0.55 } as Surface,
  orangeMetal: { color: '#d9581a', rough: 0.4, metal: 0.5 } as Surface,
  white: { color: '#dfe7f0', rough: 0.6 } as Surface,
  teal: { color: '#1f7f86', rough: 0.6 } as Surface,
  wood: { color: '#7b5a3a', rough: 0.85 } as Surface,
  darkWood: { color: '#4a3524', rough: 0.85 } as Surface,
  canvas: { color: '#c9b78e', rough: 0.95 } as Surface,
  yellow: { color: '#e8b923', rough: 0.55 } as Surface,
  red: { color: '#b8281f', rough: 0.55 } as Surface,
  olive: { color: '#4b5a3f', rough: 0.8 } as Surface,
  warm: (i = 2.4): Surface => ({ color: '#ff9a3c', rough: 0.4, emit: i }),
  warmWhite: (i = 2.6): Surface => ({ color: '#ffd9a0', rough: 0.4, emit: i }),
  cyan: (i = 2.4): Surface => ({ color: '#5fe6ff', rough: 0.3, emit: i }),
  green: (i = 2.4): Surface => ({ color: '#5dff9c', rough: 0.3, emit: i }),
  red2: (i = 2.6): Surface => ({ color: '#ff3b2f', rough: 0.3, emit: i }),
};

export function place(x: number, y: number, z: number, ry = 0, s: number | [number, number, number] = 1): Place {
  return { p: [x, y, z], r: [0, ry, 0], s };
}

// ───────────────────────── misc helpers ─────────────────────────

export interface Disposer {
  add<T extends { dispose(): void }>(item: T): T;
  disposeAll(): void;
}

export function createDisposer(): Disposer {
  const items: Array<{ dispose(): void }> = [];
  return {
    add(item) {
      items.push(item);
      return item;
    },
    disposeAll() {
      for (const i of items) {
        try {
          i.dispose();
        } catch {
          /* ignore */
        }
      }
      items.length = 0;
    },
  };
}

/** Collects geometries/materials/textures of an object tree for later disposal. */
export function collectDisposables(root: THREE.Object3D, into: Disposer): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) into.add(mesh.geometry);
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const m of mat) into.add(m);
    else if (mat) into.add(mat);
  });
}

export interface WorldCtx {
  quality: QualityPreset;
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  dispose: Disposer;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
