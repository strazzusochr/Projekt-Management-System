import * as THREE from 'three/webgpu';
import {
  Fn,
  atan,
  attribute,
  color,
  float,
  fract,
  hash,
  instanceIndex,
  length,
  mix,
  positionGeometry,
  positionLocal,
  sin,
  cos,
  smoothstep,
  step,
  time,
  uniform,
  uv,
  vec2,
  vertexColor,
} from 'three/tsl';
import { bake, merge, type Place, type Surface } from '../../characters/geo';

/** Accumulates baked (vertex-coloured) parts and merges them into ONE geometry / draw call. */
export class Parts {
  private list: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, surf: Surface, place?: Place | THREE.Matrix4): this {
    this.list.push(bake(geo, surf, place));
    return this;
  }
  /** Adds an already-baked geometry (with color/aPbr attributes). */
  addBaked(geo: THREE.BufferGeometry): this {
    this.list.push(geo);
    return this;
  }
  get count(): number {
    return this.list.length;
  }
  build(): THREE.BufferGeometry {
    const g = merge(this.list);
    this.list = [];
    return g;
  }
}

/** PBR material driven by baked vertex attributes (color, aPbr = rough/metal/emissive). */
export function propMaterial(o: { side?: THREE.Side; flat?: boolean } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const pbr = attribute('aPbr', 'vec3');
  m.roughnessNode = pbr.x;
  m.metalnessNode = pbr.y;
  m.emissiveNode = vertexColor().rgb.mul(pbr.z);
  if (o.side !== undefined) m.side = o.side;
  if (o.flat) m.flatShading = true;
  return m;
}

/** Recolours a baked geometry per vertex. `c` holds the current colour and may be modified. */
export function paint(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, i: number) => void): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    fn(p, n, c, i);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  return geo;
}

/** Smooth pseudo noise in roughly [-1, 1]. */
export function nz(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 1.7 + Math.sin(y * 2.3 + z * 0.7)) * Math.cos(z * 1.9 + Math.sin(x * 1.3)) * 0.5 +
    Math.sin(y * 3.1 + x * 1.1 + z * 2.3) * 0.3 +
    Math.sin((x + z) * 4.3 + y * 1.7) * 0.2
  );
}

export function starShape(points: number, outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

/** Uniform handle for the world-wide wind strength (0..1.5). */
export const windStrength = uniform(1);

const mkFloat = () => uniform(0);
export type FloatUniform = ReturnType<typeof mkFloat>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ColorFn = (u: any) => any;

/**
 * Cloth (sails, banners, pennants): attached along the uv.x = 0 edge, the free end waves with wind.
 * `colorFn` paints the fabric procedurally from uv.
 */
export function clothMaterial(o: { colorFn: ColorFn; amp: number; speed: number; flutter?: number; rough?: number; emissive?: number; strength?: FloatUniform }): THREE.MeshStandardNodeMaterial {
  const strength = o.strength ?? windStrength;
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: o.rough ?? 0.85, metalness: 0 });
  const seed = hash(instanceIndex.toFloat().add(3.7)).mul(6.28);
  m.positionNode = Fn(() => {
    const p = positionLocal.toVar();
    const u = uv().x;
    const v = uv().y;
    const ph = seed.add(time.mul(o.speed));
    const w1 = sin(u.mul(5.5).sub(ph.mul(1.6)).add(v.mul(2.0)));
    const w2 = sin(u.mul(11.0).sub(ph.mul(2.7)).add(v.mul(4.0))).mul(0.35);
    const g = u.mul(u.mul(0.7).add(0.3)).mul(strength);
    p.z.addAssign(w1.add(w2).mul(o.amp).mul(g));
    p.y.addAssign(sin(u.mul(4.0).sub(ph.mul(1.3))).mul(o.amp * (o.flutter ?? 0.25)).mul(g));
    p.x.subAssign(w1.abs().mul(o.amp * 0.25).mul(g));
    return p;
  })();
  const c = o.colorFn(uv());
  m.colorNode = c;
  if (o.emissive) m.emissiveNode = c.mul(o.emissive);
  return m;
}

// ── procedural banner designs (TSL) ──

export function sunBannerColor(bg: THREE.ColorRepresentation, fg: THREE.ColorRepresentation, edge: THREE.ColorRepresentation): ColorFn {
  return (u) => {
    const p = u.sub(vec2(0.5, 0.5)).mul(vec2(1.0, 1.35));
    const r = length(p);
    const a = atan(p.y, p.x);
    const rays = smoothstep(0.45, 0.62, sin(a.mul(12)).mul(0.5).add(0.5)).mul(smoothstep(0.42, 0.26, r)).mul(smoothstep(0.18, 0.22, r));
    const disc = smoothstep(0.19, 0.17, r);
    const ring = smoothstep(0.24, 0.235, r).mul(smoothstep(0.205, 0.21, r));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let c: any = color(new THREE.Color(bg));
    c = mix(c, color(new THREE.Color(fg)), rays.max(disc).max(ring));
    const border = smoothstep(0.06, 0.03, u.x.min(float(1).sub(u.x)).min(u.y).min(float(1).sub(u.y)));
    c = mix(c, color(new THREE.Color(edge)), border);
    return c.mul(float(0.88).add(sin(u.y.mul(90)).mul(0.03)));
  };
}

export function starBannerColor(bg: THREE.ColorRepresentation, fg: THREE.ColorRepresentation, edge: THREE.ColorRepresentation): ColorFn {
  return (u) => {
    const p = u.sub(vec2(0.5, 0.5)).mul(vec2(1.0, 1.3));
    const r = length(p);
    const a = atan(p.y, p.x);
    const sr = mix(float(0.09), float(0.27), smoothstep(0.0, 1.0, sin(a.mul(2.5).add(1.5708)).abs().pow(1.6)));
    const star = smoothstep(0.012, 0.0, r.sub(sr));
    const dots = smoothstep(0.02, 0.0, length(fract(u.mul(vec2(6.0, 8.0))).sub(0.5)).sub(0.05)).mul(0.35);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let c: any = color(new THREE.Color(bg)).mul(float(1).sub(dots.mul(0.6)));
    c = mix(c, color(new THREE.Color(fg)), star);
    const border = smoothstep(0.06, 0.03, u.x.min(float(1).sub(u.x)).min(u.y).min(float(1).sub(u.y)));
    c = mix(c, color(new THREE.Color(edge)), border);
    return c;
  };
}

export function stripeClothColor(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, n: number, vertical = false): ColorFn {
  return (u) => {
    const t = vertical ? u.x : u.y;
    const s = step(0.5, fract(t.mul(n)));
    return mix(color(new THREE.Color(a)), color(new THREE.Color(b)), s).mul(float(0.9).add(sin(u.x.mul(40)).mul(0.04)));
  };
}

export function triangleFlag(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 10, 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / w + 0.5;
    pos.setY(i, pos.getY(i) * (1 - u * 0.92));
  }
  g.translate(w / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

export const tmpObj = new THREE.Object3D();

/** Fills an InstancedMesh from a list of placements. */
export function fillInstances(mesh: THREE.InstancedMesh, items: Array<{ p: [number, number, number]; r?: [number, number, number]; s?: number | [number, number, number]; c?: THREE.ColorRepresentation }>): void {
  const col = new THREE.Color();
  items.forEach((it, i) => {
    tmpObj.position.set(...it.p);
    tmpObj.rotation.set(...(it.r ?? [0, 0, 0]));
    if (typeof it.s === 'number') tmpObj.scale.setScalar(it.s);
    else if (it.s) tmpObj.scale.set(...it.s);
    else tmpObj.scale.setScalar(1);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(i, tmpObj.matrix);
    if (it.c !== undefined) mesh.setColorAt(i, col.set(it.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Emissive unlit material whose brightness is driven by a uniform. */
export function glowUniformMat(col: THREE.ColorRepresentation, base = 3): { material: THREE.MeshBasicNodeMaterial; k: FloatUniform } {
  const k = uniform(1);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(new THREE.Color(col)).mul(k.mul(base));
  return { material: m, k };
}

export function crystalGeometry(r: number, h: number, sides = 6): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(r, r, h * 0.5, sides, 1);
  const top = new THREE.ConeGeometry(r, h * 0.25, sides, 1);
  top.translate(0, h * 0.375, 0);
  const bot = new THREE.ConeGeometry(r, h * 0.25, sides, 1);
  bot.rotateX(Math.PI);
  bot.translate(0, -h * 0.375, 0);
  return merge([bake(body, { color: '#ffffff' }), bake(top, { color: '#ffffff' }), bake(bot, { color: '#ffffff' })]);
}

export const vertexWave = (amp: number, speed: number) =>
  Fn(() => {
    const p = positionLocal.toVar();
    const h = positionGeometry.y.max(0);
    p.x.addAssign(sin(time.mul(speed).add(h.mul(2))).mul(amp).mul(h));
    p.z.addAssign(cos(time.mul(speed * 0.8).add(h.mul(1.7))).mul(amp * 0.6).mul(h));
    return p;
  })();
