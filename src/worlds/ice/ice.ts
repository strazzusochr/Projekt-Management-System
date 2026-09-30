import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  cameraPosition,
  color,
  dot,
  exp,
  float,
  mix,
  mx_noise_float,
  normalize,
  normalWorld,
  positionGeometry,
  positionWorld,
  pow,
  sin,
  smoothstep,
  time,
  uv,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import { rng } from '../../world/kit';
import type { QualityPreset } from '../../render/quality';
import type { Disposer } from './common';

// ───────────────────────── ice material ─────────────────────────

/** Faceted glacial ice: vertex-colour albedo, inner cyan glow (subsurface fake), snow on up-facing faces. */
export function createIceMaterial(o: { glow?: number; rough?: number; snow?: number } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const vc = vertexColor().rgb;
  const V = normalize(cameraPosition.sub(positionWorld));
  const nv = dot(normalWorld, V).abs().clamp(0, 1);
  const fres = pow(float(1).sub(nv), 2.0);
  const nz = mx_noise_float(positionWorld.mul(0.45));
  const snowTop = smoothstep(0.6, 0.9, normalWorld.y.add(nz.mul(0.12))).mul(o.snow ?? 0.7);
  m.colorNode = mix(vc.mul(nz.mul(0.14).add(1.0)), color(new THREE.Color('#d9e8f8')), snowTop);
  m.roughnessNode = float(o.rough ?? 0.24).add(nz.mul(0.07)).add(snowTop.mul(0.5)).clamp(0.05, 0.95);
  m.metalnessNode = float(0);
  const lowGlow = smoothstep(3.0, -2.0, positionWorld.y);
  const pulse = sin(time.mul(0.6).add(positionWorld.x.mul(0.2)).add(positionWorld.z.mul(0.15))).mul(0.15).add(0.85);
  m.emissiveNode = color(new THREE.Color('#37c4ff'))
    .mul(float(0.035).add(fres.mul(0.2)).add(lowGlow.mul(0.32)))
    .mul(pulse)
    .mul(float(1).sub(snowTop))
    .mul(o.glow ?? 1);
  return m;
}

// ───────────────────────── geometry helpers ─────────────────────────

const _c = new THREE.Color();

/** Converts to flat-shaded, non-indexed, colour-only geometry. */
export function finishIce(geo: THREE.BufferGeometry, colorFn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = colorFn(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function mergeIce(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeIce failed');
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

const ICE_TOP = new THREE.Color('#e6f2ff');
const ICE_MID = new THREE.Color('#a9d4f2');
const ICE_DEEP = new THREE.Color('#2c78b4');
const ICE_ABYSS = new THREE.Color('#123f78');

function iceShade(t: number, n: number): THREE.Color {
  // t: 0 deep … 1 top
  if (t > 0.6) _c.copy(ICE_MID).lerp(ICE_TOP, Math.min(1, (t - 0.6) / 0.4));
  else if (t > 0.25) _c.copy(ICE_DEEP).lerp(ICE_MID, (t - 0.25) / 0.35);
  else _c.copy(ICE_ABYSS).lerp(ICE_DEEP, t / 0.25);
  const k = 1 + n * 0.12;
  return _c.multiplyScalar(k);
}

/** Faceted, displaced iceberg (radius ≈ half width). Waterline at y = 0. */
export function icebergGeometry(radius: number, seed: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, 2);
  const pos = ico.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const s = seed;
    let rad =
      1 +
      Math.sin(v.x * 3.1 + s) * 0.2 +
      Math.sin(v.y * 4.3 + v.z * 2.7 + s * 2) * 0.16 +
      Math.sin(v.z * 6.1 - v.x * 5.3 + s * 3) * 0.09 +
      Math.sin(v.x * 11 + v.y * 9 + v.z * 7 + s) * 0.04;
    const spike = Math.max(0, Math.sin(v.x * 5 + s) * Math.sin(v.z * 4.6 + s * 1.3)) * 0.7 * Math.max(0, v.y);
    rad += spike;
    const y = v.y > 0 ? v.y * rad * radius * 0.95 : v.y * rad * radius * 0.75;
    // quantise a little for hard facets
    pos.setXYZ(i, v.x * rad * radius * 1.05, y, v.z * rad * radius * 0.95);
  }
  return finishIce(ico, (x, y, z) => iceShade(THREE.MathUtils.clamp(0.42 + y / (radius * 1.6), 0, 1), Math.sin(x * 2.1 + z * 1.7 + seed)));
}

/** Small drifting ice chunk (unit size). */
export function chunkGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const rad = 1 + Math.sin(v.x * 4 + seed) * 0.22 + Math.sin(v.z * 5 + v.y * 3 + seed * 2) * 0.16;
    pos.setXYZ(i, v.x * rad, v.y * rad * 0.42, v.z * rad);
  }
  return finishIce(g, (_x, y) => iceShade(THREE.MathUtils.clamp(0.7 + y * 0.5, 0, 1), 0));
}

/** Jagged ice spire / seracs. */
export function spireGeometry(radius: number, height: number, seed: number, sides = 5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, sides, 3, false);
  g.translate(0, height / 2, 0);
  const pos = g.getAttribute('position');
  const r = rng(Math.floor(seed * 977) + 13);
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(4)}|${y.toFixed(4)}|${z.toFixed(4)}`;
    let o = cache.get(key);
    if (!o) {
      const k = y > height * 0.98 ? 0.3 : 1;
      o = [(r() - 0.5) * radius * 0.5 * k, (r() - 0.5) * height * 0.08, (r() - 0.5) * radius * 0.5 * k];
      cache.set(key, o);
    }
    pos.setXYZ(i, x + o[0], y + o[1], z + o[2]);
  }
  return finishIce(g, (_x, y, _z) => iceShade(THREE.MathUtils.clamp(0.4 + (y / height) * 0.6, 0, 1), 0));
}

/**
 * Vertical glacier front. Local +Z faces the viewer; x runs along the wall, y up from the base.
 * A snow-covered slope rises behind the face.
 */
export function glacierWallGeometry(length: number, height: number, seed: number, segX = 56, segY = 9): THREE.BufferGeometry {
  const rows = segY + 5;
  const cols = segX + 1;
  const pos = new Float32Array(cols * rows * 3);
  const r = rng(Math.floor(seed * 1013) + 7);
  const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
  const colH: number[] = [];
  for (let i = 0; i < cols; i++) {
    const x = (i / segX - 0.5) * length;
    const n = Math.sin(x * 0.07 + ph[0]!) * 0.22 + Math.sin(x * 0.19 + ph[1]!) * 0.14 + Math.sin(x * 0.53 + ph[2]!) * 0.06;
    colH.push(height * (0.85 + n + (Math.floor(Math.sin(x * 0.11 + ph[3]!) * 2.5) / 2.5) * 0.12));
  }
  let p = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i / segX - 0.5) * length;
      const ht = colH[i]!;
      let y: number;
      let z: number;
      if (j <= segY) {
        const t = j / segY;
        y = -3 + t * (ht + 3);
        // seracs: stepped displacement + crevasses
        const step = Math.floor((Math.sin(x * 0.21 + ph[0]! + y * 0.11) * 0.5 + 0.5) * 4) / 4;
        const cre = Math.max(0, Math.sin(x * 0.9 + ph[1]!) - 0.82) * 14;
        z = -step * 3.2 - cre + Math.sin(y * 0.4 + x * 0.05 + ph[2]!) * 0.8 + (1 - t) * 1.5;
      } else {
        const k = j - segY;
        z = -k * 9 + Math.sin(x * 0.12 + k) * 2;
        y = ht + k * 3.2 + Math.sin(x * 0.09 + k * 1.3 + ph[3]!) * 1.4;
      }
      pos[p++] = x;
      pos[p++] = y;
      pos[p++] = z;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return finishIce(g, (x, y, z, _nx, ny) => {
    const t = THREE.MathUtils.clamp((y + 3) / (height + 3), 0, 1);
    const c = iceShade(0.25 + t * 0.6 + (ny > 0.6 ? 0.25 : 0), Math.sin(x * 0.3 + z * 0.2));
    if (ny > 0.6) c.lerp(ICE_TOP, 0.6);
    return c;
  });
}

const ROCK_A = new THREE.Color('#141d33');
const ROCK_B = new THREE.Color('#26324d');
const SNOW = new THREE.Color('#c8dcf5');

/** One faceted mountain (base at y = 0). */
export function mountainGeometry(radius: number, height: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, 30, 12, true);
  g.translate(0, height / 2, 0);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const t = v.y / height;
    const rr = Math.hypot(v.x, v.z);
    const ridge = 1 + Math.sin(a * 3 + seed) * 0.28 + Math.sin(a * 7 + seed * 2) * 0.12 + Math.sin(a * 13 + seed * 3 + t * 6) * 0.05;
    const nn = Math.sin(v.y * 0.09 + a * 5 + seed) * 0.08 + Math.sin(v.y * 0.21 - a * 9) * 0.04;
    const scale = ridge * (1 + nn);
    v.x *= scale;
    v.z *= scale;
    v.y *= 1 + Math.sin(a * 2 + seed) * 0.08 + (rr < radius * 0.15 ? Math.sin(a * 5) * 0.06 : 0);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / height;
    const nn = n.getY(i);
    const grain = Math.sin(pos.getX(i) * 0.11 + pos.getZ(i) * 0.09 + seed) * 0.5 + 0.5;
    _c.copy(ROCK_A).lerp(ROCK_B, grain * 0.7 + t * 0.4);
    const snowLine = 0.38 + Math.sin(pos.getX(i) * 0.05 + seed * 2) * 0.06 - nn * 0.05;
    const s = THREE.MathUtils.smoothstep(t, snowLine, snowLine + 0.16) * THREE.MathUtils.smoothstep(nn, 0.15, 0.55) + THREE.MathUtils.smoothstep(t, 0.75, 0.9);
    _c.lerp(SNOW, Math.min(1, s));
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

// ───────────────────────── crystals ─────────────────────────

export interface CrystalCluster {
  x: number;
  y: number;
  z: number;
  count: number;
  scale: number;
  tint: 'cyan' | 'blue' | 'violet' | 'teal';
  spread?: number;
}

const TINTS: Record<CrystalCluster['tint'], THREE.Color> = {
  cyan: new THREE.Color('#4de6ff'),
  blue: new THREE.Color('#5a9dff'),
  violet: new THREE.Color('#b26bff'),
  teal: new THREE.Color('#3dffc4'),
};

/** Glowing crystal clusters (instanced) + additive light pools on the ice around them. */
export function createCrystals(clusters: CrystalCluster[], quality: QualityPreset, d: Disposer): THREE.Group {
  const group = new THREE.Group();
  group.name = 'crystals';
  const r = rng(4242);
  // crystal: hexagonal shard
  const prof: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(0.085, 0.02), new THREE.Vector2(0.095, 0.5), new THREE.Vector2(0.05, 0.72), new THREE.Vector2(0, 0.86)];
  const geo = d.add(new THREE.LatheGeometry(prof, 6));
  const mat = d.add(new THREE.MeshBasicNodeMaterial());
  {
    const y = positionGeometry.y.div(0.86);
    const n = mx_noise_float(positionGeometry.mul(9.0));
    const base = float(0.35).add(pow(y, 1.4).mul(1.6)).add(n.mul(0.15));
    const flick = sin(time.mul(1.4).add(positionWorld.x.mul(2.0)).add(positionWorld.z.mul(1.7))).mul(0.12).add(0.95);
    mat.colorNode = vec3(1, 1, 1).mul(base).mul(flick).mul(1.9);
  }
  let total = 0;
  for (const c of clusters) total += c.count;
  total = Math.max(1, Math.round(total * Math.min(1, 0.45 + quality.density * 0.55)));
  const inst = new THREE.InstancedMesh(geo, mat, total);
  inst.name = 'crystals:shards';
  inst.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  let n = 0;
  const pools: Array<{ x: number; y: number; z: number; s: number; c: THREE.Color }> = [];
  for (const c of clusters) {
    const cnt = Math.max(1, Math.round(c.count * Math.min(1, 0.45 + quality.density * 0.55)));
    for (let i = 0; i < cnt && n < total; i++, n++) {
      const a = r() * Math.PI * 2;
      const rad = r() * (c.spread ?? 0.5) * c.scale;
      const s = c.scale * (0.5 + r() * 0.9) * (i === 0 ? 1.4 : 1);
      e.set((r() - 0.5) * 0.7, r() * 6.28, (r() - 0.5) * 0.7);
      q.setFromEuler(e);
      sc.set(s, s * (0.8 + r() * 0.6), s);
      m4.compose(new THREE.Vector3(c.x + Math.cos(a) * rad, c.y, c.z + Math.sin(a) * rad), q, sc);
      inst.setMatrixAt(n, m4);
      col.copy(TINTS[c.tint]).lerp(new THREE.Color('#ffffff'), r() * 0.25);
      inst.setColorAt(n, col);
    }
    pools.push({ x: c.x, y: c.y, z: c.z, s: c.scale * 3.4, c: TINTS[c.tint] });
  }
  inst.count = n;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);

  // light pools on the ground
  const pGeo = d.add(new THREE.PlaneGeometry(1, 1));
  pGeo.rotateX(-Math.PI / 2);
  const pMat = d.add(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pMat.fog = false;
  {
    const p = uv().sub(0.5).mul(2);
    const rr = p.length();
    const glow = pow(float(1).sub(rr).clamp(0, 1), 2.2);
    const flick = sin(time.mul(0.9).add(positionWorld.x.mul(1.3))).mul(0.15).add(0.85);
    pMat.colorNode = vec3(1, 1, 1).mul(glow).mul(flick).mul(0.5);
  }
  const pools2 = new THREE.InstancedMesh(pGeo, pMat, pools.length);
  pools2.name = 'crystals:pools';
  pools2.frustumCulled = false;
  pools2.renderOrder = 3;
  pools.forEach((p, i) => {
    m4.compose(new THREE.Vector3(p.x, p.y + 0.03, p.z), new THREE.Quaternion(), new THREE.Vector3(p.s, 1, p.s));
    pools2.setMatrixAt(i, m4);
    pools2.setColorAt(i, p.c);
  });
  pools2.instanceMatrix.needsUpdate = true;
  if (pools2.instanceColor) pools2.instanceColor.needsUpdate = true;
  group.add(pools2);
  void exp;
  void vec2;
  return group;
}

// ───────────────────────── ice cave ─────────────────────────

/** Ice cave entrance with glowing interior. Local +Z faces the viewer, floor at y = 0. */
export function createIceCave(scale: number, seed: number, quality: QualityPreset, d: Disposer): { group: THREE.Group; arch: THREE.BufferGeometry } {
  const g = new THREE.Group();
  g.name = 'iceCave';
  const r = rng(Math.floor(seed * 100));
  const parts: THREE.BufferGeometry[] = [];
  const W = 3.4 * scale;
  const H = 3.2 * scale;
  // arch made of displaced ice blobs
  const blobs = 15;
  for (let i = 0; i < blobs; i++) {
    const a = (i / (blobs - 1)) * Math.PI;
    const bx = Math.cos(a) * W * 0.5;
    const by = Math.sin(a) * H * 0.85;
    const s = (0.55 + r() * 0.45) * scale * (i % 3 === 0 ? 1.15 : 0.9);
    const ico = new THREE.IcosahedronGeometry(s, 1);
    const pos = ico.getAttribute('position');
    const v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k);
      const nn = 1 + Math.sin(v.x * 4 + i) * 0.2 + Math.sin(v.y * 5 + v.z * 3 + i) * 0.15;
      pos.setXYZ(k, v.x * nn, v.y * nn * 0.9, v.z * nn * 1.4);
    }
    ico.translate(bx, by, 0);
    parts.push(finishIce(ico, (_x, y) => iceShade(THREE.MathUtils.clamp(0.5 + y / (H * 2), 0, 1), 0)));
  }
  // outer buttress blocks
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const spire = spireGeometry((0.9 - k * 0.15) * scale, (3.4 + k * 1.4) * scale, seed + k + s, 6);
      spire.translate(s * (W * 0.62 + k * 0.7 * scale), -0.1, -0.6 * scale * k);
      parts.push(spire);
    }
  }
  // icicles hanging in the mouth
  for (let i = 0; i < 9; i++) {
    const t = 0.15 + (i / 8) * 0.7;
    const a = t * Math.PI;
    const cone = new THREE.ConeGeometry((0.06 + r() * 0.05) * scale, (0.5 + r() * 0.7) * scale, 5, 1);
    cone.rotateX(Math.PI);
    cone.translate(Math.cos(a) * W * 0.44, Math.sin(a) * H * 0.78 - 0.25 * scale, 0.55 * scale);
    parts.push(finishIce(cone, () => iceShade(0.85, 0)));
  }
  const arch = mergeIce(parts);

  // glowing interior: layered additive discs give a deep tunnel feeling
  const inGeo = d.add(new THREE.PlaneGeometry(W * 0.95, H * 0.98));
  const inMat = d.add(new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }));
  {
    const p = uv().sub(vec2(0.5, 0.0)).mul(vec2(2, 1));
    const arch = smoothstep(1.0, 0.55, p.x.abs().add(p.y.mul(0.25)));
    const rad = p.length();
    const core = pow(float(1).sub(rad.mul(0.85)).clamp(0, 1), 1.6);
    const streak = mx_noise_float(vec3(uv().mul(vec2(6, 9)), time.mul(0.25))).mul(0.5).add(0.5);
    const c = mix(color(new THREE.Color('#031a3a')), color(new THREE.Color('#6feaff')), core.mul(0.85).add(streak.mul(0.15)));
    inMat.colorNode = c.mul(arch.mul(1.0).add(0.02)).mul(mix(float(0.7), float(2.1), core));
  }
  const inner = new THREE.Mesh(inGeo, inMat);
  inner.position.set(0, H * 0.5, -0.45 * scale);
  g.add(inner);
  // dark side walls of the tunnel
  const tunGeo = d.add(new THREE.CylinderGeometry(W * 0.5, W * 0.5, 4.5 * scale, 14, 1, true, 0, Math.PI));
  tunGeo.rotateZ(Math.PI / 2);
  tunGeo.rotateY(Math.PI / 2);
  const tunMat = d.add(new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide }));
  {
    const ph = uv().x;
    tunMat.colorNode = mix(color(new THREE.Color('#02132b')), color(new THREE.Color('#1c8fc0')), pow(ph, 3.0)).mul(0.8);
  }
  const tun = new THREE.Mesh(tunGeo, tunMat);
  tun.position.set(0, 0.05, -2.2 * scale);
  tun.scale.set(1, H / (W * 0.5), 1);
  g.add(tun);
  // volumetric glow spill outside
  const glowGeo = d.add(new THREE.PlaneGeometry(1, 1));
  glowGeo.rotateX(-Math.PI / 2);
  const glowMat = d.add(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  {
    const p = uv().sub(0.5).mul(2);
    glowMat.colorNode = color(new THREE.Color('#4fd4ff')).mul(pow(float(1).sub(p.length()).clamp(0, 1), 2.0)).mul(0.55);
  }
  const spill = new THREE.Mesh(glowGeo, glowMat);
  spill.scale.set(W * 2.2, 1, W * 2.4);
  spill.position.set(0, 0.06, W * 1.0);
  spill.renderOrder = 3;
  g.add(spill);
  void quality;
  return { group: g, arch };
}
