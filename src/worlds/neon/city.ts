import * as THREE from 'three/webgpu';
import { abs, attribute, color, float, floor, fract, hash, mix, normalWorld, positionWorld, select, sin, smoothstep, step, time, uv, vec3 } from 'three/tsl';
import { rng } from '../../world/kit';
import { boxG, cylG, instancedFrom, mtx, type Env } from './env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TN = any;

interface Bld {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y?: number;
}

export interface Hero {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  side: -1 | 1;
}

/** Facade material: PBR concrete/glass with a procedural emissive window grid, edge LED chase lines. */
function facadeMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2 });
  const b: TN = attribute('aBld', 'vec4'); // x seed, y hue pick, z window density, w height
  const wp = positionWorld;
  const side = float(1).sub(step(0.5, abs(normalWorld.y)));
  const horiz = select(abs(normalWorld.x).greaterThan(0.5), wp.z, wp.x);
  const gx = horiz.div(1.7).add(500.0);
  const gy = wp.y.div(2.9).add(3.0);
  const cx = floor(gx);
  const cy = floor(gy);
  const fx = fract(gx);
  const fy = fract(gy);
  const win = smoothstep(0.1, 0.17, fx).mul(smoothstep(0.9, 0.83, fx)).mul(smoothstep(0.16, 0.24, fy)).mul(smoothstep(0.86, 0.78, fy)).mul(side);
  const id = cx.add(cy.mul(131.0)).add(b.x.mul(977.0));
  const r = hash(id);
  const r2 = hash(id.add(19.7));
  const lit = step(float(1).sub(b.z), r);
  const warm = vec3(1.0, 0.72, 0.38);
  const cyan = vec3(0.3, 0.85, 1.0);
  const magenta = vec3(1.0, 0.25, 0.75);
  const main = mix(warm, cyan, step(0.5, b.y));
  let wcol = mix(main, magenta, step(0.86, r2));
  wcol = mix(wcol, vec3(1.0, 0.95, 0.85), step(0.94, r2).mul(0.6));
  // some windows flicker (tv light / faulty tubes)
  const flick = step(0.0, sin(time.mul(hash(id.add(2.0)).mul(6.0).add(1.0)).add(r2.mul(40.0)))).mul(step(0.9, r)).add(step(0.9, r).oneMinus());
  const wLevel = win.mul(lit).mul(flick);
  // vertical LED chase lines on facade edges
  const u = uv().x;
  const edge = smoothstep(0.035, 0.0, u.min(float(1).sub(u))).mul(side);
  const chase = smoothstep(0.55, 1.0, sin(wp.y.mul(0.42).sub(time.mul(2.2)).add(b.x.mul(50.0))).mul(0.5).add(0.5));
  const ledCol = mix(vec3(0.1, 0.9, 1.0), vec3(1.0, 0.2, 0.8), step(0.5, hash(b.x.mul(31.0))));
  // horizontal glowing floor bands on some buildings
  const band = step(0.97, fract(wp.y.div(9.0).add(b.x))).mul(side).mul(step(0.5, hash(b.x.mul(7.0))));
  m.colorNode = mix(color('#161c2a'), color('#070a12'), win);
  m.roughnessNode = mix(float(0.62), float(0.14), win);
  m.metalnessNode = mix(float(0.15), float(0.65), win);
  m.emissiveNode = wcol.mul(wLevel.mul(1.7)).add(ledCol.mul(edge.mul(chase.mul(2.6).add(0.25)))).add(ledCol.mul(band.mul(1.6)));
  return m;
}

/** Skyline, blocks along the canal and rooftop details. Returns "hero" facades (for signs). */
export function buildCity(env: Env): { heroes: Hero[] } {
  const { q, root } = env;
  const R = rng(20260930);
  const list: Bld[] = [];
  const heroes: Hero[] = [];

  // hero frontage along the canal (x = ±16.5 …)
  for (const s of [-1, 1] as const) {
    let z = -66;
    while (z < 66) {
      const d = 8 + R() * 6;
      const h = Math.abs(z) < 30 ? 16 + R() * 22 : 24 + R() * 40;
      const w = 9 + R() * 5;
      const x = s * (16.5 + w / 2);
      list.push({ x, z: z + d / 2, w, d, h });
      if (Math.abs(z + d / 2) < 28) heroes.push({ x, z: z + d / 2, w, d, h, side: s });
      z += d + 0.8 + R() * 1.4;
    }
  }
  // second row (taller)
  for (const s of [-1, 1]) {
    let z = -90;
    while (z < 90) {
      const d = 10 + R() * 10;
      const w = 12 + R() * 10;
      const h = 40 + R() * 70;
      list.push({ x: s * (32 + w / 2 + R() * 3), z: z + d / 2, w, d, h });
      z += d + 1.5 + R() * 3;
    }
  }
  // third row: megatowers
  const megaCount = Math.round(16 * q.density + 6);
  for (let i = 0; i < megaCount; i++) {
    const s = i % 2 ? 1 : -1;
    list.push({ x: s * (54 + R() * 60), z: -110 + R() * 200, w: 14 + R() * 12, d: 14 + R() * 12, h: 90 + R() * 90 });
  }
  // far background wall (behind the bridge) – z < -70 across the canal axis
  const bgCount = Math.round(18 * q.density + 8);
  for (let i = 0; i < bgCount; i++) {
    list.push({ x: -100 + (i / bgCount) * 200 + (R() - 0.5) * 6, z: -105 - R() * 50, w: 12 + R() * 14, d: 14 + R() * 10, h: 70 + R() * 110 });
  }
  // behind the camera side (z > 70)
  for (let i = 0; i < 10; i++) {
    const s = i % 2 ? 1 : -1;
    list.push({ x: s * (30 + R() * 50), z: 80 + R() * 40, w: 14 + R() * 10, d: 14 + R() * 10, h: 50 + R() * 80 });
  }

  // tiers: add a narrower upper tower on tall buildings
  const withTiers: Bld[] = [];
  for (const b of list) {
    withTiers.push(b);
    if (b.h > 34) {
      const th = b.h * (0.25 + R() * 0.3);
      withTiers.push({ x: b.x + (R() - 0.5) * b.w * 0.15, z: b.z + (R() - 0.5) * b.d * 0.15, w: b.w * (0.55 + R() * 0.2), d: b.d * (0.55 + R() * 0.2), h: th, y: b.h });
    }
  }

  const geo = boxG(1, 1, 1, [0, 0.5, 0]);
  const n = withTiers.length;
  const data = new Float32Array(n * 4);
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  for (let i = 0; i < n; i++) {
    const b = withTiers[i]!;
    mats.push(mtx([b.x, b.y ?? 0.8, b.z], [0, 0, 0], [b.w, b.h, b.d]));
    const tint = new THREE.Color().setHSL(0.62 + R() * 0.12, 0.25 + R() * 0.25, 0.6 + R() * 0.5);
    cols.push(tint);
    data[i * 4] = R();
    data[i * 4 + 1] = R();
    data[i * 4 + 2] = 0.28 + R() * 0.45;
    data[i * 4 + 3] = b.h;
  }
  geo.setAttribute('aBld', new THREE.InstancedBufferAttribute(data, 4));
  const mesh = instancedFrom(geo, facadeMaterial(), mats, cols);
  mesh.name = 'skyline';
  root.add(mesh);

  // rooftop antennas with blinking aviation lights
  const antMats: THREE.Matrix4[] = [];
  const lampMats: THREE.Matrix4[] = [];
  const phases = new Float32Array(n);
  let ai = 0;
  for (let i = 0; i < n; i++) {
    const b = withTiers[i]!;
    if (b.h < 26 && R() > 0.5) continue;
    const top = (b.y ?? 0.8) + b.h;
    const ah = 5 + R() * 14;
    antMats.push(mtx([b.x + (R() - 0.5) * b.w * 0.4, top + ah / 2, b.z + (R() - 0.5) * b.d * 0.4], [0, 0, 0], [1, ah, 1]));
    const p = antMats[antMats.length - 1]!.elements;
    lampMats.push(mtx([p[12]!, top + ah + 0.15, p[14]!]));
    phases[ai++] = R();
  }
  const antGeo = cylG(0.09, 0.14, 1, 6);
  root.add(instancedFrom(antGeo, new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#2a3140'), roughness: 0.5, metalness: 0.8 }), antMats));
  const lampGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const ph = new THREE.InstancedBufferAttribute(phases.slice(0, Math.max(1, ai)), 1);
  lampGeo.setAttribute('aPh', ph);
  const lampMat = new THREE.MeshBasicNodeMaterial();
  {
    const p: TN = attribute('aPh', 'float');
    const on = step(0.55, sin(time.mul(1.9).add(p.mul(40.0))).mul(0.5).add(0.5));
    lampMat.colorNode = mix(vec3(0.25, 0.02, 0.04), vec3(3.0, 0.25, 0.3), on);
  }
  root.add(instancedFrom(lampGeo, lampMat, lampMats));

  return { heroes };
}
