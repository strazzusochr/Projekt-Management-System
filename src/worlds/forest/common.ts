import * as THREE from 'three/webgpu';
import { attribute, color, cos, float, hash, instanceIndex, length, positionGeometry, positionLocal, positionWorld, sin, smoothstep, time, uv, vec3, vertexColor } from 'three/tsl';
import type { QualityPreset } from '../../render/quality';

/** Collects everything that has to be disposed together. */
export class Bin {
  private list: Array<{ dispose(): void }> = [];
  add<T extends { dispose(): void }>(x: T): T {
    this.list.push(x);
    return x;
  }
  dispose(): void {
    for (const d of this.list) d.dispose();
    this.list = [];
  }
}

export interface VcOptions {
  side?: THREE.Side;
  /** [strength, speed, heightScale] – wind sway of the vertices. */
  sway?: [number, number, number];
  flat?: boolean;
}

/**
 * Standard node material driven by baked vertex attributes (colour + aPbr = rough/metal/emissive),
 * so a whole prop set can be merged into a single draw call.
 */
export function vcMaterial(o: VcOptions = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const pbr = attribute('aPbr', 'vec3');
  m.roughnessNode = pbr.x;
  m.metalnessNode = pbr.y;
  m.emissiveNode = vertexColor().rgb.mul(pbr.z);
  if (o.side !== undefined) m.side = o.side;
  if (o.flat) m.flatShading = true;
  if (o.sway) m.positionNode = swayNode(o.sway[0], o.sway[1], o.sway[2]);
  return m;
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function sstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Cheap smooth pseudo noise in roughly [-1, 1]. */
export function vnoise(x: number, y: number, z = 0): number {
  return (Math.sin(x * 1.7 + Math.sin(y * 2.3 + z)) * Math.cos(y * 1.3 + Math.sin(x * 0.7 - z * 1.1)) + Math.sin((x + y) * 0.9 + z * 0.5) * 0.5) / 1.5;
}

const _c = new THREE.Color();

/** Overwrites the baked vertex colours of a geometry with a per-vertex function. */
export function paint(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    _c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i), _c);
    col.setXYZ(i, _c.r, _c.g, _c.b);
  }
  col.needsUpdate = true;
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function matrixAt(x: number, y: number, z: number, rotY = 0, scale: number | [number, number, number] = 1, tiltX = 0, tiltZ = 0): THREE.Matrix4 {
  _e.set(tiltX, rotY, tiltZ, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  if (typeof scale === 'number') _s.set(scale, scale, scale);
  else _s.set(scale[0], scale[1], scale[2]);
  return _m.compose(_p, _q, _s).clone();
}

export function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], opts: { cast?: boolean; receive?: boolean; colors?: THREE.Color[]; name?: string } = {}): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]!);
  if (mats.length === 0) im.count = 0;
  if (opts.colors) for (let i = 0; i < opts.colors.length; i++) im.setColorAt(i, opts.colors[i]!);
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = opts.cast ?? false;
  im.receiveShadow = opts.receive ?? true;
  if (opts.name) im.name = opts.name;
  im.computeBoundingSphere();
  return im;
}

/** Soft additive glow sprite (lantern halos, mushroom glow …). */
export function halo(col: THREE.ColorRepresentation, size: number, strength = 1): THREE.Sprite {
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  m.blending = THREE.AdditiveBlending;
  m.fog = false;
  const d = length(uv().sub(0.5)).mul(2);
  const g = float(1).sub(smoothstep(0, 1, d));
  m.colorNode = color(new THREE.Color(col));
  m.opacityNode = g.mul(g).mul(strength);
  const sp = new THREE.Sprite(m);
  sp.scale.set(size, size, 1);
  sp.frustumCulled = false;
  sp.renderOrder = 5;
  sp.raycast = () => {};
  return sp;
}

/** Height-dependent wind sway that also works on InstancedMesh (uses the untransformed geometry height). */
export function swayNode(strength: number, speed: number, heightScale: number): THREE.Node {
  const h = positionGeometry.y.mul(heightScale).max(0);
  const ph = hash(instanceIndex.toFloat()).mul(6.28);
  const w = sin(time.mul(speed).add(ph).add(positionWorld.x.mul(0.3)));
  const w2 = cos(time.mul(speed * 0.8).add(ph.mul(1.3)).add(positionWorld.z.mul(0.25)));
  const hh = h.mul(h);
  return positionLocal.add(vec3(w.mul(strength).mul(hh), 0, w2.mul(strength * 0.5).mul(hh)));
}

export interface BuildCtx {
  scene: THREE.Scene;
  quality: QualityPreset;
  bin: Bin;
  /** Remaining dynamic-light budget. */
  lights: { left: number };
  /** Direction the sunlight comes from. */
  sun: THREE.Vector3;
}

export interface Part {
  update?(dt: number, t: number, camera: THREE.PerspectiveCamera): void;
  dispose?(): void;
}

/** One draw call of soft additive ground glow pools (light pools of lanterns, mushrooms, shrine …). */
export function makePools(items: Array<{ x: number; y: number; z: number; r: number; color: THREE.ColorRepresentation; a?: number }>): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.blending = THREE.AdditiveBlending;
  const d = length(uv().sub(0.5)).mul(2);
  const g = float(1).sub(smoothstep(0, 1, d));
  m.opacityNode = g.mul(g);
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  for (const it of items) {
    mats.push(matrixAt(it.x, it.y, it.z, 0, it.r * 2));
    cols.push(new THREE.Color(it.color).multiplyScalar(it.a ?? 0.6));
  }
  const im = makeInstanced(geo, m, mats, { colors: cols, receive: false, name: 'pools' });
  im.renderOrder = 4;
  return im;
}
