import * as THREE from 'three/webgpu';
import { Fn, attribute, color, hash, instanceIndex, mix, mx_fractal_noise_float, positionGeometry, positionLocal, positionWorld, sin, smoothstep, time, uniform, uv, vec2, vec3, vertexColor } from 'three/tsl';
import { bake, merge, type Place, type Surface } from '../../characters/geo';

/** Collects everything that has to be disposed together. */
export class Bin {
  readonly items: Array<{ dispose(): void }> = [];
  add<T extends { dispose(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
  dispose(): void {
    for (const i of this.items) i.dispose();
    this.items.length = 0;
  }
}

export const S = (col: THREE.ColorRepresentation, rough = 0.85, metal = 0, emit = 0): Surface => ({ color: col, rough, metal, emit });

/** Vertex colour PBR material (colour, roughness, metalness, emissive baked with `bake`). */
export function vcMaterial(opts: { side?: THREE.Side; alphaTest?: number } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const pbr = attribute('aPbr', 'vec3');
  m.roughnessNode = pbr.x;
  m.metalnessNode = pbr.y;
  m.emissiveNode = vertexColor().rgb.mul(pbr.z);
  if (opts.side !== undefined) m.side = opts.side;
  return m;
}

/** Unlit vertex-coloured glow material with an adjustable brightness uniform. */
export function glowVc(intensity: number, opts: { additive?: boolean; opacity?: number; side?: THREE.Side } = {}) {
  const k = uniform(intensity);
  const m = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
  m.colorNode = vertexColor().rgb.mul(k);
  if (opts.side !== undefined) m.side = opts.side;
  if (opts.additive || (opts.opacity !== undefined && opts.opacity < 1)) {
    m.transparent = true;
    m.depthWrite = false;
    if (opts.additive) m.blending = THREE.AdditiveBlending;
    if (opts.opacity !== undefined) m.opacityNode = uniform(opts.opacity);
  }
  return { material: m, k };
}

export type Geo = THREE.BufferGeometry;

/** Bakes + merges a list of [geometry, surface, place] parts. */
export function build(parts: Array<[Geo, Surface, Place?]>): Geo {
  return merge(parts.map(([g, s, p]) => bake(g, s, p)));
}

/** Instanced mesh from a list of matrices (+ optional colours). */
export function instanced(geo: Geo, mat: THREE.Material, matrices: THREE.Matrix4[], colors?: THREE.Color[], shadow = false): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  im.count = matrices.length;
  for (let i = 0; i < matrices.length; i++) {
    im.setMatrixAt(i, matrices[i]!);
    if (colors) im.setColorAt(i, colors[i]!);
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = shadow;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  im.frustumCulled = true;
  return im;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function mtx(x: number, y: number, z: number, ry = 0, sc: number | [number, number, number] = 1, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  if (typeof sc === 'number') _s.set(sc, sc, sc);
  else _s.set(sc[0], sc[1], sc[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
void _m;

export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ───────────────────────── shared node materials ─────────────────────────

/** Animated flame card material (additive). Works for InstancedMesh and single Mesh. */
export function flameMaterial(core: THREE.ColorRepresentation = '#ffe9a0', edge: THREE.ColorRepresentation = '#ff5a10', power = 3.2) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.blending = THREE.AdditiveBlending;
  const k = uniform(power);
  const ph = hash(instanceIndex.toFloat().add(3.1)).mul(6.283);
  const v = uv();
  m.positionNode = Fn(() => {
    const p = positionLocal.toVar();
    const w = sin(time.mul(13).add(ph).add(v.y.mul(5))).mul(0.045).add(sin(time.mul(7.3).add(ph.mul(2))).mul(0.03));
    p.x.addAssign(w.mul(v.y));
    p.y.mulAssign(sin(time.mul(17).add(ph)).mul(0.08).add(1));
    return p;
  })();
  const across = v.x.sub(0.5).abs().mul(2);
  const shape = smoothstep(1.0, 0.0, across.add(v.y.mul(0.85))).mul(smoothstep(0.0, 0.12, v.y));
  m.colorNode = mix(color(new THREE.Color(edge)), color(new THREE.Color(core)), smoothstep(0.75, 0.05, v.y.add(across.mul(0.5)))).mul(k);
  m.opacityNode = shape;
  return { material: m, k };
}

/** Two crossed flame cards, base at y=0. */
export function flameGeometry(w = 0.34, h = 0.62): Geo {
  const a = new THREE.PlaneGeometry(w, h);
  a.translate(0, h / 2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const c = a.clone();
  c.rotateY(Math.PI / 4);
  const out = [a, b, c].map((g) => {
    g.deleteAttribute('normal');
    return g;
  });
  const geos = out.map((g) => g.toNonIndexed());
  const mg = new THREE.BufferGeometry();
  const pos: number[] = [];
  const uvs: number[] = [];
  for (const g of geos) {
    const p = g.getAttribute('position');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uvs.push(u.getX(i), u.getY(i));
    }
    g.dispose();
  }
  a.dispose();
  b.dispose();
  c.dispose();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  mg.computeBoundingSphere();
  return mg;
}

/** Generic foliage sway (instanced or single) by height above the local origin. */
export function swayNode(strength = 0.12, speed = 1.4, height = 1.2) {
  return Fn(() => {
    const h = positionGeometry.y.div(height).clamp(0, 1);
    const ph = hash(instanceIndex.toFloat()).mul(6.283);
    const s = sin(time.mul(speed).add(ph).add(positionLocal.x.mul(0.25)).add(positionLocal.z.mul(0.2))).mul(strength).mul(h.mul(h));
    return positionLocal.add(vec3(s, 0, s.mul(0.55)));
  })();
}

/** Scrolling fbm mist material for big horizontal planes. */
export function mistMaterial(col: THREE.ColorRepresentation, opacity: number, scale: number, speed: [number, number], edgeFade: number) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const P = positionWorld.xz;
  const n = mx_fractal_noise_float(vec3(P.x.mul(scale).add(time.mul(speed[0])), P.y.mul(scale).add(time.mul(speed[1])), time.mul(0.05)), 3, 2.0, 0.5, 1.0);
  const d = smoothstep(-0.25, 0.55, n);
  const edge = smoothstep(edgeFade, edgeFade * 0.35, P.x.abs().div(1.0)).mul(1);
  m.colorNode = color(new THREE.Color(col));
  m.opacityNode = d.mul(opacity).mul(edge.max(0.0)).mul(smoothstep(0, 1, vec2(1, 1).x));
  return m;
}
