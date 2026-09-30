import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualityPreset } from '../../render/quality';

export type Updater = (dt: number, t: number, cam: THREE.PerspectiveCamera) => void;

/** Shared build environment handed to every feature builder. */
export interface Env {
  scene: THREE.Scene;
  root: THREE.Group;
  q: QualityPreset;
  updaters: Updater[];
  /** Adds a budgeted local light (returns null when the quality budget is exhausted). */
  addLight(color: THREE.ColorRepresentation, intensity: number, distance: number, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.PointLight | null;
}

export const QUAY_Y = 0.8;
export const CANAL_HALF = 6.2;

export function createEnv(scene: THREE.Scene, q: QualityPreset): Env {
  const root = new THREE.Group();
  root.name = 'neon-world';
  scene.add(root);
  let budget = q.localLights;
  return {
    scene,
    root,
    q,
    updaters: [],
    addLight(color, intensity, distance, x, y, z, parent) {
      if (budget <= 0) return null;
      budget--;
      const l = new THREE.PointLight(new THREE.Color(color), intensity, distance, 2);
      l.position.set(x, y, z);
      (parent ?? root).add(l);
      return l;
    },
  };
}

type V3 = [number, number, number];

/** Applies position / euler rotation / scale to a geometry in place. */
export function xf(geo: THREE.BufferGeometry, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: number | V3 = 1): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
    typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s),
  );
  geo.applyMatrix4(m);
  return geo;
}

export const boxG = (w: number, h: number, d: number, p?: V3, r?: V3): THREE.BufferGeometry => xf(new THREE.BoxGeometry(w, h, d), p, r);
export const cylG = (rt: number, rb: number, h: number, seg = 12, p?: V3, r?: V3): THREE.BufferGeometry => xf(new THREE.CylinderGeometry(rt, rb, h, seg), p, r);
export const torG = (r: number, tube: number, seg = 24, tseg = 6, p?: V3, rot?: V3, arc = Math.PI * 2): THREE.BufferGeometry => xf(new THREE.TorusGeometry(r, tube, tseg, seg, arc), p, rot);
export const sphG = (r: number, w = 12, h = 8, p?: V3, s?: number | V3): THREE.BufferGeometry => xf(new THREE.SphereGeometry(r, w, h), p, [0, 0, 0], s ?? 1);

/** Merge helper for primitives that share the attribute layout (position/normal/uv, indexed). */
export function mergeG(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(list, false);
  if (!m) throw new Error('mergeG failed');
  for (const g of list) g.dispose();
  m.computeBoundingSphere();
  return m;
}

/** InstancedMesh from a matrix list. */
export function instancedFrom(geo: THREE.BufferGeometry, material: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, material, Math.max(1, mats.length));
  for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]!);
  if (colors) for (let i = 0; i < mats.length; i++) im.setColorAt(i, colors[i % colors.length]!);
  im.count = mats.length;
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  return im;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export function mtx(p: V3, r: V3 = [0, 0, 0], s: number | V3 = 1): THREE.Matrix4 {
  _e.set(...r);
  _q.setFromEuler(_e);
  const sv = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), _q.clone(), sv);
}
export { _m as _tmpMatrix };

/** Canvas texture for neon signs / screens. */
export function signTexture(opts: {
  text: string;
  sub?: string;
  color: string;
  bg?: string;
  w?: number;
  h?: number;
  font?: string;
  border?: boolean;
  glowBlur?: number;
}): THREE.CanvasTexture {
  const w = opts.w ?? 512;
  const h = opts.h ?? 160;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = opts.font ?? '900 84px "Arial Black", Impact, sans-serif';
  // fit text
  let size = parseInt(/(\d+)px/.exec(font)?.[1] ?? '84', 10);
  const mk = (s: number): string => font.replace(/\d+px/, `${s}px`);
  ctx.font = mk(size);
  while (ctx.measureText(opts.text).width > w * 0.86 && size > 12) {
    size -= 4;
    ctx.font = mk(size);
  }
  const cy = opts.sub ? h * 0.42 : h * 0.5;
  ctx.shadowColor = opts.color;
  ctx.shadowBlur = opts.glowBlur ?? 22;
  ctx.fillStyle = opts.color;
  ctx.fillText(opts.text, w / 2, cy);
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.65;
  ctx.fillText(opts.text, w / 2, cy);
  ctx.globalAlpha = 1;
  if (opts.sub) {
    ctx.font = `700 ${Math.round(h * 0.14)}px "Arial", sans-serif`;
    ctx.shadowBlur = 10;
    ctx.fillStyle = opts.color;
    ctx.fillText(opts.sub, w / 2, h * 0.82);
  }
  if (opts.border) {
    ctx.shadowBlur = 14;
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 5;
    const r = 18;
    const x = 8;
    const y = 8;
    const ww = w - 16;
    const hh = h - 16;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, r);
    ctx.arcTo(x + ww, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + ww, y, r);
    ctx.closePath();
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Disposes every geometry / material / texture below `root`. */
export function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<{ dispose(): void }>();
  root.traverse((o) => {
    const anyO = o as THREE.Mesh & { isInstancedMesh?: boolean; isSprite?: boolean };
    const geo = anyO.geometry as THREE.BufferGeometry | undefined;
    if (geo && !seen.has(geo)) {
      seen.add(geo);
      geo.dispose();
    }
    const m = anyO.material as THREE.Material | THREE.Material[] | undefined;
    const mats = Array.isArray(m) ? m : m ? [m] : [];
    for (const mm of mats) {
      if (seen.has(mm)) continue;
      seen.add(mm);
      const rec = mm as unknown as Record<string, unknown>;
      for (const k of ['map', 'emissiveMap', 'alphaMap']) {
        const tex = rec[k] as THREE.Texture | null | undefined;
        if (tex && !seen.has(tex)) {
          seen.add(tex);
          tex.dispose();
        }
      }
      mm.dispose();
    }
    if (anyO.isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}

/** Deterministic flicker 0..1 (mostly 1 with short dropouts). */
export function flicker(t: number, ph: number, severity = 1): number {
  const a = Math.sin(t * 37.0 + ph * 11.0) * Math.sin(t * 23.3 + ph * 5.0);
  const b = Math.sin(t * 91.0 + ph * 3.0);
  const drop = a > 0.82 ? (b > 0 ? 0.12 : 0.45) : 1;
  return 1 - (1 - drop) * severity;
}
