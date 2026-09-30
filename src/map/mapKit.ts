import * as THREE from 'three/webgpu';
import {
  atan,
  attribute,
  dot,
  Fn,
  mix,
  mx_noise_float,
  positionLocal,
  normalLocal,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  uv,
  vec3,
  hash,
  floor,
  abs,
  color as tslColor,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { weld } from '../world/kit';

export type V3 = [number, number, number];
export type Kind = 'solid' | 'metal' | 'glow' | 'bld' | 'ice';
export interface Place {
  p?: V3;
  r?: V3;
  s?: V3 | number;
}

/** Height of the island top surface above the water line (island-local). */
export const TOP = 0.7;

export function matrixOf(pl: Place): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pl.r?.[0] ?? 0, pl.r?.[1] ?? 0, pl.r?.[2] ?? 0));
  const s = pl.s ?? 1;
  const sv = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s[0], s[1], s[2]);
  const p = pl.p ?? [0, 0, 0];
  return new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, sv);
}

function hash01(i: number, seed: number): number {
  const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface AddOpts {
  /** Multiplies the colour (>1 = HDR glow for bloom). */
  glow?: number;
  /** Per-triangle brightness variation 0..1. */
  jitter?: number;
  /** Recompute flat normals (faceted, low-poly look). */
  flat?: boolean;
  /** Vertical colour gradient [colour, y0, y1] in island space (colour at y1). */
  grad?: [THREE.ColorRepresentation, number, number];
}

/** Collects coloured parts into per-material merge buckets (one draw call per bucket). */
export class Kit {
  readonly parts: Record<Kind, THREE.BufferGeometry[]> = { solid: [], metal: [], glow: [], bld: [], ice: [] };
  private seed = 1;

  add(kind: Kind, geo: THREE.BufferGeometry, col: THREE.ColorRepresentation, pl: Place = {}, o: AddOpts = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    if (o.flat || !g.getAttribute('normal')) {
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    g.applyMatrix4(matrixOf(pl));
    const pos = g.getAttribute('position');
    const n = pos.count;
    const arr = new Float32Array(n * 3);
    const c = new THREE.Color(col);
    const k = o.glow ?? 1;
    const jit = o.jitter ?? 0;
    const gc = o.grad ? new THREE.Color(o.grad[0]) : null;
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i += 3) {
      const f = 1 + (hash01(i, this.seed) - 0.5) * 2 * jit;
      for (let j = 0; j < 3 && i + j < n; j++) {
        tmp.copy(c);
        if (gc && o.grad) tmp.lerp(gc, clamp01((pos.getY(i + j) - o.grad[1]) / (o.grad[2] - o.grad[1])));
        arr[(i + j) * 3] = tmp.r * f * k;
        arr[(i + j) * 3 + 1] = tmp.g * f * k;
        arr[(i + j) * 3 + 2] = tmp.b * f * k;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts[kind].push(g);
    this.seed++;
    return this;
  }

  /** Adds a geometry that already carries position/normal/color. */
  addRaw(kind: Kind, geo: THREE.BufferGeometry): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'color') g.deleteAttribute(n);
    this.parts[kind].push(g);
    return this;
  }

  build(mats: Partial<Record<Kind, THREE.Material>>, name: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const kind of Object.keys(this.parts) as Kind[]) {
      const list = this.parts[kind];
      const m = mats[kind];
      if (!list.length || !m) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      list.length = 0;
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, m);
      mesh.name = `${name}:${kind}`;
      mesh.castShadow = kind !== 'glow';
      mesh.receiveShadow = kind !== 'glow';
      out.push(mesh);
    }
    return out;
  }
}

// ───────────────────────── materials ─────────────────────────

export function makeMaterials() {
  const lock = uniform(0);
  const hover = uniform(0);
  const vc = attribute('color', 'vec3');
  const lum = dot(vc, vec3(0.299, 0.587, 0.114));
  const frost = vec3(lum.mul(0.7).add(0.05)).add(vec3(0.05, 0.1, 0.19));
  const lockK = lock.mul(0.88);
  const baseCol = mix(vc, frost, lockK);
  const rimBoost = vc.mul(hover.mul(0.32));

  const solid = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0.02 });
  solid.colorNode = baseCol;
  solid.emissiveNode = mix(rimBoost, frost.mul(0.05), lock);

  const metal = new THREE.MeshStandardNodeMaterial({ roughness: 0.27, metalness: 0.85 });
  metal.colorNode = baseCol;
  metal.emissiveNode = mix(rimBoost.mul(0.6), frost.mul(0.03), lock);

  const ice = new THREE.MeshStandardNodeMaterial({ roughness: 0.14, metalness: 0.05 });
  ice.colorNode = baseCol;
  ice.emissiveNode = mix(vc.mul(hover.mul(0.3).add(0.1)), frost.mul(0.08), lock);

  const glow = new THREE.MeshBasicNodeMaterial();
  glow.colorNode = mix(vc.mul(hover.mul(0.7).add(1)), vec3(lum.mul(0.14)).add(vec3(0.05, 0.08, 0.13)), lock);

  // neon city: procedural lit windows that flicker
  const bld = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.3 });
  bld.colorNode = baseCol;
  const P = positionLocal;
  const cy = floor(P.y.mul(2.6));
  const cx = floor(P.x.add(P.z).mul(2.9));
  const cz = floor(P.x.sub(P.z).mul(0.0).add(P.z.mul(0.0)));
  const cellH = hash(cy.mul(13.1).add(cx.mul(7.7)).add(cz).add(P.x.mul(0.0).add(floor(P.x.mul(0.5)).mul(3.3))));
  const fy = P.y.mul(2.6).fract();
  const fx = P.x.add(P.z).mul(2.9).fract();
  const win = smoothstep(0.12, 0.2, fy).mul(smoothstep(0.86, 0.78, fy)).mul(smoothstep(0.18, 0.26, fx)).mul(smoothstep(0.82, 0.74, fx));
  const vertical = step(abs(normalLocal.y), 0.5);
  const lit = step(0.42, cellH).mul(win).mul(vertical);
  const flick = sin(time.mul(cellH.mul(2.5).add(0.6)).add(cellH.mul(40))).mul(0.18).add(0.82);
  const wcol = mix(mix(vec3(0.25, 0.85, 1.0), vec3(1.0, 0.3, 0.85), step(0.6, cellH)), vec3(1.0, 0.78, 0.4), step(0.85, cellH));
  bld.emissiveNode = mix(wcol.mul(lit).mul(flick).mul(2.4), vec3(0), lock);

  return { solid, metal, glow, bld, ice, lock, hover } as const;
}
export type IslandMats = ReturnType<typeof makeMaterials>;

/** Flowing waterfall sheet (uv.y = 1 at the top). */
export function waterfallMaterial(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, fadeBottom = false): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const v = uv();
  const n = mx_noise_float(vec3(v.x.mul(11), v.y.mul(3.2).add(time.mul(1.9)), time.mul(0.25)));
  const n2 = mx_noise_float(vec3(v.x.mul(23).add(4), v.y.mul(6).add(time.mul(2.7)), 3));
  const streak = smoothstep(-0.25, 0.55, n.add(n2.mul(0.4)));
  const edge = smoothstep(0, 0.14, v.x).mul(smoothstep(1, 0.86, v.x));
  const foam = smoothstep(0.16, 0.0, v.y);
  m.colorNode = mix(tslColor(new THREE.Color(a)), tslColor(new THREE.Color(b)), streak).add(vec3(foam.mul(0.5)));
  let op = edge.mul(streak.mul(0.45).add(0.5));
  if (fadeBottom) op = op.mul(smoothstep(0.0, 0.45, v.y));
  m.opacityNode = op;
  return m;
}

/** Aurora curtain (uv.y = 1 at the top). */
export function auroraMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.blending = THREE.AdditiveBlending;
  m.fog = false;
  const v = uv();
  const n = mx_noise_float(vec3(v.x.mul(9), time.mul(0.35), v.y.mul(1.5))).mul(0.5).add(0.5);
  const n2 = mx_noise_float(vec3(v.x.mul(22).add(time.mul(0.6)), 2, v.y.mul(0.5))).mul(0.5).add(0.5);
  const rays = smoothstep(0.28, 0.85, n.mul(0.6).add(n2.mul(0.6)));
  const g = tslColor(new THREE.Color('#3dffa8'));
  const p = tslColor(new THREE.Color('#a45bff'));
  const c = mix(g, p, smoothstep(0.3, 1.0, v.y)).mul(1.7);
  m.colorNode = c;
  m.opacityNode = smoothstep(0.0, 0.18, v.y).mul(smoothstep(1.0, 0.45, v.y)).mul(rays).mul(smoothstep(0.0, 0.12, v.x)).mul(smoothstep(1.0, 0.88, v.x)).mul(0.55);
  m.positionNode = Fn(() => {
    const q = positionLocal.toVar();
    q.z.addAssign(sin(q.x.mul(0.42).add(time.mul(0.55)).add(q.y.mul(0.12))).mul(1.7));
    q.y.addAssign(sin(q.x.mul(0.6).add(time.mul(0.8))).mul(0.35));
    q.x.addAssign(sin(q.y.mul(0.5).add(time.mul(0.7))).mul(0.3));
    return q;
  })();
  return m;
}

/** Dashed rotating ring for the selected island. */
export function ringMaterial(col: THREE.ColorRepresentation): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.blending = THREE.AdditiveBlending;
  const ang = atan(positionLocal.y, positionLocal.x);
  const dash = smoothstep(-0.15, 0.35, sin(ang.mul(9)));
  const pulse = sin(time.mul(2.4)).mul(0.15).add(0.85);
  m.colorNode = tslColor(new THREE.Color(col)).mul(3.2).mul(pulse);
  m.opacityNode = dash.mul(0.95).add(0.15);
  return m;
}

// ───────────────────────── geometry helpers ─────────────────────────

export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 10): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
export const cone = (r: number, h: number, seg = 8): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg, 1);
export const sphere = (r: number, ws = 12, hs = 8): THREE.BufferGeometry => new THREE.SphereGeometry(r, ws, hs);
export const dome = (r: number, ws = 24, hs = 12): THREE.BufferGeometry => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2);
export const torus = (r: number, tube: number, arc = Math.PI * 2, seg = 24, tseg = 6): THREE.BufferGeometry => new THREE.TorusGeometry(r, tube, tseg, seg, arc);

/** Lumpy low-poly blob (foliage, rocks, clouds). */
export function blob(r: number, seed = 1, detail = 1, squash = 1): THREE.BufferGeometry {
  const g = weld(new THREE.IcosahedronGeometry(r, detail));
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + Math.sin(v.x * 3.1 / r + seed * 2.3) * 0.13 + Math.sin(v.y * 4.3 / r + seed * 1.1) * 0.1 + Math.sin((v.z - v.x) * 3.7 / r + seed) * 0.09;
    v.multiplyScalar(n);
    v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const f = g.toNonIndexed();
  f.deleteAttribute('normal');
  f.computeVertexNormals();
  return f;
}

/** Flat ribbon following the polyline (river, canal, road). Lies in XZ at the points' y. */
export function ribbonGeo(points: THREE.Vector3[], width: number, samples = 40): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = curve.getPoint(t);
    const tg = curve.getTangent(t);
    const sx = -tg.z;
    const sz = tg.x;
    const l = Math.hypot(sx, sz) || 1;
    const w = width * 0.5 * (0.85 + 0.15 * Math.sin(t * 9));
    pos.push(p.x + (sx / l) * w, p.y, p.z + (sz / l) * w, p.x - (sx / l) * w, p.y, p.z - (sz / l) * w);
    nor.push(0, 1, 0, 0, 1, 0);
    if (i < samples) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function tubeGeo(pts: V3[], r: number, seg = 10, radial = 6): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, radial, false);
}

export function starGeo(outer = 0.5, inner = 0.22, depth = 0.12): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Triangular prism (tents, roofs). Ridge along Z. */
export function prism(w: number, h: number, d: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

export interface BaseOpts {
  radius: number;
  seed: number;
  top: THREE.ColorRepresentation;
  top2: THREE.ColorRepresentation;
  rock: THREE.ColorRepresentation;
  rock2: THREE.ColorRepresentation;
  rim: THREE.ColorRepresentation;
  floating?: boolean;
  segments?: number;
}

/** Sculpted island body: lathe + noise displacement, painted by slope/height. */
export function islandBase(kit: Kit, o: BaseOpts): void {
  const R = o.radius;
  const T = TOP;
  const prof: Array<[number, number]> = o.floating
    ? [[0.001, T], [R * 0.55, T + 0.03], [R * 0.93, T - 0.05], [R, T - 0.4], [R * 0.9, T - 1.4], [R * 0.72, T - 3.0], [R * 0.5, T - 5.0], [R * 0.28, T - 7.0], [R * 0.1, T - 8.6], [0.001, T - 9.2]]
    : [[0.001, T], [R * 0.55, T + 0.03], [R * 0.92, T - 0.04], [R, T - 0.32], [R * 1.0, T - 0.95], [R * 0.93, T - 1.9], [R * 0.72, T - 2.9], [R * 0.36, T - 3.7], [0.001, T - 4.1]];
  prof.reverse(); // bottom -> top so the lathe faces point outwards
  const pts = new THREE.SplineCurve(prof.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(o.floating ? 36 : 26).map((p) => new THREE.Vector2(Math.max(0.001, p.x), p.y));
  const g = weld(new THREE.LatheGeometry(pts, o.segments ?? 56));
  const pos = g.getAttribute('position');
  const depth = o.floating ? 9.2 : 4.1;
  const sd = o.seed;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const dk = clamp01((T - y) / depth);
    let f = 1 + 0.07 * Math.sin(a * 3 + sd) + 0.05 * Math.sin(a * 5 - sd * 2) + 0.03 * Math.sin(a * 11 + sd * 3);
    f += dk * 0.12 * Math.sin(a * 7 + y * 1.7 + sd) + dk * 0.06 * Math.sin(a * 13 - y * 2.9);
    let ny = y;
    if (y < T - 0.5) ny += 0.2 * Math.sin(a * 4 + y * 3.1 + sd) * (1 - dk);
    else ny += 0.035 * Math.sin(x * 1.3 + sd) * Math.cos(z * 1.1 - sd);
    pos.setXYZ(i, x * f, ny, z * f);
  }
  g.computeVertexNormals();
  const nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const cTop = new THREE.Color(o.top);
  const cTop2 = new THREE.Color(o.top2);
  const cRock = new THREE.Color(o.rock);
  const cRock2 = new THREE.Color(o.rock2);
  const cRim = new THREE.Color(o.rim);
  const c = new THREE.Color();
  const c2 = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const topness = smooth(0.5, 0.82, nor.getY(i));
    const strata = 0.5 + 0.5 * Math.sin(y * 6.5 + Math.atan2(z, x) * 0.6 + o.seed) + 0.25 * Math.sin(y * 17 + x);
    c.copy(cRock).lerp(cRock2, clamp01(strata));
    const dk = clamp01((T - y) / depth);
    c.multiplyScalar(0.5 + 0.5 * (1 - dk));
    const edgeZone = smooth(T - 0.9, T - 0.25, y) * (1 - topness);
    c.lerp(cRim, edgeZone * 0.55);
    c2.copy(cTop).lerp(cTop2, clamp01(0.5 + 0.5 * Math.sin(x * 1.7 + z * 1.3 + o.seed) * Math.cos(z * 0.9 - x * 0.6)));
    c.lerp(c2, topness);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  kit.addRaw('solid', g);
}
