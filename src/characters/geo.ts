import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Surface description baked into vertex attributes. */
export interface Surface {
  color: THREE.ColorRepresentation;
  rough?: number;
  metal?: number;
  /** Emissive strength (multiplies the vertex colour). */
  emit?: number;
}

const tmpColor = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpE = new THREE.Euler();

/** Position/rotation/scale shorthand for placing a part. */
export interface Place {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number] | number;
}

export function placeMatrix(pl: Place = {}): THREE.Matrix4 {
  tmpP.set(...(pl.p ?? [0, 0, 0]));
  tmpE.set(...(pl.r ?? [0, 0, 0]));
  tmpQ.setFromEuler(tmpE);
  const s = pl.s ?? 1;
  if (typeof s === 'number') tmpS.set(s, s, s);
  else tmpS.set(...s);
  return tmpM.compose(tmpP, tmpQ, tmpS).clone();
}

/**
 * Normalises a geometry to the attribute layout used by all character/prop parts
 * (position, normal, uv, color, aPbr), bakes the surface and applies the placement.
 */
export function bake(geo: THREE.BufferGeometry, surf: Surface, place?: Place | THREE.Matrix4): THREE.BufferGeometry {
  let g = geo;
  if (!g.index) {
    const count = g.getAttribute('position').count;
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  g.morphAttributes = {};
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const pbr = new Float32Array(n * 3);
  tmpColor.set(surf.color);
  // vertex colours are linear
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpColor.r;
    col[i * 3 + 1] = tmpColor.g;
    col[i * 3 + 2] = tmpColor.b;
    pbr[i * 3] = surf.rough ?? 0.75;
    pbr[i * 3 + 1] = surf.metal ?? 0;
    pbr[i * 3 + 2] = surf.emit ?? 0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 3));
  if (place) g.applyMatrix4(place instanceof THREE.Matrix4 ? place : placeMatrix(place));
  return g;
}

/** Applies a per-vertex colour gradient along an axis (e.g. darker feet of fur, ombre cloth). */
export function gradient(geo: THREE.BufferGeometry, axis: 'x' | 'y' | 'z', from: number, to: number, c0: THREE.ColorRepresentation, c1: THREE.ColorRepresentation): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  const a = new THREE.Color(c0);
  const b = new THREE.Color(c1);
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  for (let i = 0; i < pos.count; i++) {
    const v = ai === 0 ? pos.getX(i) : ai === 1 ? pos.getY(i) : pos.getZ(i);
    const t = THREE.MathUtils.clamp((v - from) / (to - from), 0, 1);
    tmpColor.copy(a).lerp(b, t);
    col.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
  }
  col.needsUpdate = true;
  return geo;
}

/** Tints vertices by a deterministic noise – breaks up flat colour on fur, stone, bark. */
export function mottle(geo: THREE.BufferGeometry, amount: number, scale = 7, seed = 1): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * scale + seed;
    const y = pos.getY(i) * scale;
    const z = pos.getZ(i) * scale - seed;
    const nz = Math.sin(x * 1.7 + Math.sin(y * 2.3)) * Math.cos(z * 1.3 + Math.sin(x * 0.7)) * 0.5 + 0.5;
    const f = 1 + (nz - 0.5) * 2 * amount;
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  col.needsUpdate = true;
  return geo;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts, false);
  if (!m) throw new Error('mergeGeometries failed – inconsistent attributes');
  for (const p of parts) p.dispose();
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

// ───────────────────────── primitive shapes ─────────────────────────

export function ellipsoid(rx: number, ry: number, rz: number, w = 18, h = 14): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

/** Smooth closed lathe through (radius, y) control points; ends are closed to the axis. */
export function lathe(profile: Array<[number, number]>, segments = 20, samples = 28): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  pts[0]!.x = 0;
  pts[pts.length - 1]!.x = 0;
  return new THREE.LatheGeometry(pts, segments);
}

/** Open lathe shell (for skirts, coat tails, hat brims) – ends stay open. */
export function latheShell(profile: Array<[number, number]>, segments = 22, samples = 16, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const g = new THREE.LatheGeometry(curve.getPoints(samples), segments, phiStart, phiLength);
  // double-sided shells: add a flipped copy so they render from inside too
  const back = g.clone();
  const idx = back.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    idx.setX(i, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  const nrm = back.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  const merged = mergeGeometries([g, back], false)!;
  g.dispose();
  back.dispose();
  return merged;
}

/** Limb segment: rounded taper from radius r0 (at y=0) to r1 (at y=-len). */
export function limb(r0: number, r1: number, len: number, seg = 12): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const cap = 6;
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r1, -len - Math.cos(a) * r1 * 0.9 + r1 * 0.2));
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0 * 0.9 - r0 * 0.2));
  }
  pts[0]!.x = 0;
  pts[pts.length - 1]!.x = 0;
  return new THREE.LatheGeometry(pts, seg);
}

export function roundedBox(w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
}

export function cyl(r0: number, r1: number, h: number, seg = 14, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r0, r1, h, seg, 1, open);
}

export function cone(r: number, h: number, seg = 12): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, h, seg);
}

export function torus(r: number, tube: number, arc = Math.PI * 2, seg = 24, tubeSeg = 8): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, tubeSeg, seg, arc);
}

/** Tube along a smooth curve through points. */
export function tube(points: Array<[number, number, number]>, radius: number, tubular = 24, radial = 8, radiusEnd?: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  if (radiusEnd !== undefined) {
    // taper: scale ring radius along the tube
    const pos = g.getAttribute('position');
    const frames = curve.computeFrenetFrames(tubular, false);
    for (let i = 0; i <= tubular; i++) {
      const t = i / tubular;
      const k = THREE.MathUtils.lerp(1, radiusEnd / radius, t);
      const center = curve.getPointAt(t);
      for (let j = 0; j <= radial; j++) {
        const vi = i * (radial + 1) + j;
        tmpP.fromBufferAttribute(pos, vi).sub(center).multiplyScalar(k).add(center);
        pos.setXYZ(vi, tmpP.x, tmpP.y, tmpP.z);
      }
    }
    void frames;
    g.computeVertexNormals();
  }
  return g;
}

/** Extruded 2D shape (ornaments, blades, fins). */
export function extrude(shape: THREE.Shape, depth: number, bevel = 0.01): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Displaces vertices along their normals with a smooth pseudo-noise (rocks, foliage clumps). */
export function displace(geo: THREE.BufferGeometry, amount: number, scale = 2, seed = 0): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * scale + seed * 13.1;
    const y = pos.getY(i) * scale + seed * 7.7;
    const z = pos.getZ(i) * scale - seed * 3.3;
    const n =
      Math.sin(x * 1.3 + Math.cos(z * 1.7)) * 0.5 +
      Math.sin(y * 2.1 + Math.sin(x * 1.1)) * 0.3 +
      Math.sin(z * 3.7 + y * 2.9) * 0.2;
    pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * n * amount, pos.getY(i) + nrm.getY(i) * n * amount, pos.getZ(i) + nrm.getZ(i) * n * amount);
  }
  geo.computeVertexNormals();
  return geo;
}
