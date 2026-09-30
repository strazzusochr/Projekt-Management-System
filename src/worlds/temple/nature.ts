import * as THREE from 'three/webgpu';
import { attribute, cos, hash, instanceIndex, mix, mx_noise_float, positionLocal, positionWorld, sin, smoothstep, time, uniform, uv, vec3, color as tslColor } from 'three/tsl';
import { bake, cone, cyl, ellipsoid, merge, torus, tube } from '../../characters/geo';
import { createParticles, rng } from '../../world/kit';
import type { QualityPreset } from '../../render/quality';
import { Bin, S, instanced, mistMaterial, mtx, segment, smooth as ss, swayNode, vcMaterial, type Geo, rbox } from './util';
import { terrainHeight } from './terrain';
import type { Module } from './structures';

const col = (h: string) => new THREE.Color(h);

// ───────────────────────── fronds & trees ─────────────────────────

function blade(len: number, width: number, seg: number, a0: number, c0: THREE.Color, c1: THREE.Color): Geo {
  const pos: number[] = [];
  const cl: number[] = [];
  const pb: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const out = len * (Math.sin(a0) * t + 0.55 * t * t);
    const y = len * (Math.cos(a0) * t - 0.62 * t * t * t);
    const w = width * Math.sin(Math.PI * Math.pow(Math.max(0.0001, t), 0.62)) * (1 - t * 0.3);
    const fold = w * 0.35;
    for (const s of [-1, 0, 1]) {
      pos.push(s * w, y + (s === 0 ? -fold * 0.0 : fold), out);
      c.copy(c0).lerp(c1, Math.pow(t, 0.8) * (s === 0 ? 0.85 : 1));
      cl.push(c.r, c.g, c.b);
      pb.push(0.7, 0, 0);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let s = 0; s < 2; s++) {
      const a = i * 3 + s;
      const b = a + 1;
      const cc = a + 3;
      const d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.setAttribute('aPbr', new THREE.Float32BufferAttribute(pb, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function frondClump(nBlades: number, len: number, seed: number): Geo {
  const r = rng(seed);
  const parts: Geo[] = [];
  const c0 = col('#173d24');
  const c1 = col('#7cc046');
  for (let i = 0; i < nBlades; i++) {
    const b = blade(len * (0.75 + r() * 0.5), 0.2 + r() * 0.08, 6, 0.28 + r() * 0.5, c0, c1);
    b.rotateY((i / nBlades) * Math.PI * 2 + r() * 0.5);
    // give attributes the layout expected by merge
    b.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(b.getAttribute('position').count * 2), 2));
    parts.push(b);
  }
  return merge(parts);
}

export function buildFoliage(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'foliage';
  const r = rng(555);
  const dens = quality.density;
  // ferns / palm fronds
  const geoA = frondClump(8, 2.0, 3);
  const geoB = frondClump(7, 3.2, 8);
  bin.add(geoA), bin.add(geoB);
  const mk = () => {
    const m = vcMaterial({ side: THREE.DoubleSide });
    m.positionNode = swayNode(0.16, 1.5, 2.2);
    return bin.add(m);
  };
  const place = (n: number, minR: number) => {
    const ms: THREE.Matrix4[] = [];
    const cs: THREE.Color[] = [];
    let guard = 0;
    while (ms.length < n && guard++ < n * 20) {
      const side = r() < 0.5 ? -1 : 1;
      const x = side * (7.2 + Math.pow(r(), 0.75) * 44);
      const z = -75 + r() * 100;
      if (Math.abs(x) < 12.8 && Math.abs(z) < 7.2) continue; // keep the bank slots clear
      if (Math.abs(x) < 6.6) continue;
      const y = terrainHeight(x, z);
      if (y < 0.3) continue;
      const sc = minR + r() * 0.9;
      ms.push(mtx(x, y - 0.05, z, r() * 6.28, sc));
      cs.push(col('#ffffff').lerp(col(r() < 0.3 ? '#d8f090' : '#8fd070'), r() * 0.6).multiplyScalar(0.7 + r() * 0.4));
    }
    return { ms, cs };
  };
  const a = place(Math.round(210 * dens), 0.8);
  const b = place(Math.round(110 * dens), 0.9);
  g.add(instanced(geoA, mk(), a.ms, a.cs, false), instanced(geoB, mk(), b.ms, b.cs, false));

  // jungle trees on the cliffs: trunk + layered canopy
  const trunk = merge([bake(new THREE.CylinderGeometry(0.28, 0.55, 5.4, 8).translate(0, 2.4, 0), { color: '#4a3626', rough: 0.95 })]);
  const canopyParts: Geo[] = [];
  const rr = rng(9);
  for (let i = 0; i < 9; i++) {
    const a1 = rr() * 6.28;
    const d = 0.6 + rr() * 2.2;
    const sph = new THREE.SphereGeometry(1, 8, 6);
    sph.scale(1.8 + rr() * 1.2, 1.0 + rr() * 0.5, 1.8 + rr() * 1.2);
    const cc = col('#1f5a2e').lerp(col('#6fb03e'), rr());
    const geo = bake(sph, { color: cc, rough: 0.85 }, { p: [Math.sin(a1) * d, 5.6 + rr() * 1.6, Math.cos(a1) * d] });
    // darker underside
    const p = geo.getAttribute('position');
    const cl = geo.getAttribute('color') as THREE.BufferAttribute;
    const tmp = new THREE.Color();
    for (let k = 0; k < p.count; k++) {
      const under = ss(7.4, 4.4, p.getY(k));
      tmp.setRGB(cl.getX(k), cl.getY(k), cl.getZ(k)).multiplyScalar(1 - under * 0.55);
      cl.setXYZ(k, tmp.r, tmp.g, tmp.b);
    }
    canopyParts.push(geo);
  }
  const canopy = merge(canopyParts);
  bin.add(trunk), bin.add(canopy);
  const treeMat = bin.add(vcMaterial());
  const canopyMat = vcMaterial();
  canopyMat.positionNode = swayNode(0.1, 0.9, 6);
  bin.add(canopyMat);
  const tm: THREE.Matrix4[] = [];
  const tc: THREE.Color[] = [];
  const nt = Math.round(46 * dens);
  let tries = 0;
  while (tm.length < nt && tries++ < nt * 30) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (17 + r() * 34);
    const z = -80 + r() * 100;
    const y = terrainHeight(x, z);
    if (y < 1.2) continue;
    // skip steep places
    const s = Math.hypot(terrainHeight(x + 1, z) - terrainHeight(x - 1, z), terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2;
    if (s > 1.2) continue;
    if (Math.abs(x) < 13.5 && Math.abs(z) < 8) continue;
    if (Math.hypot(x - 21.5, z + 2.5) < 13) continue;
    const sc = 0.9 + r() * 1.5;
    tm.push(mtx(x, y - 0.4, z, r() * 6.28, sc));
    tc.push(col('#ffffff').lerp(col('#c9d8a0'), r() * 0.5));
  }
  g.add(instanced(trunk, treeMat, tm, undefined, false), instanced(canopy, canopyMat, tm, tc, false));
  // big shrub / canopy masses clinging to the cliff faces
  const sm: THREE.Matrix4[] = [];
  const sc: THREE.Color[] = [];
  const nS = Math.round(80 * dens);
  let tr2 = 0;
  while (sm.length < nS && tr2++ < nS * 30) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (23 + r() * 34);
    const z = -104 + r() * 124;
    const y = terrainHeight(x, z);
    if (y < 2.5) continue;
    if (Math.abs(x) < 16 && Math.abs(z) < 9) continue;
    if (Math.hypot(x - 21.5, z + 2.5) < 14) continue;
    const scl = 1.3 + r() * 1.9;
    sm.push(mtx(x, y - 3.0 * scl, z, r() * 6.28, [scl, scl * (0.8 + r() * 0.5), scl]));
    sc.push(col('#ffffff').lerp(col('#a9d070'), r() * 0.6).multiplyScalar(0.65 + r() * 0.5));
  }
  g.add(instanced(canopy, canopyMat, sm, sc, false));
  return { obj: g };
}

// ───────────────────────── vines ─────────────────────────

export function buildVines(bin: Bin, anchors: Array<[number, number, number, number]>, quality: QualityPreset): Module {
  const r = rng(808);
  const parts: Geo[] = [];
  const nMul = Math.max(0.5, quality.density);
  for (const [x, y, z, len] of anchors) {
    const n = Math.max(1, Math.round(2 * nMul));
    for (let v = 0; v < n; v++) {
      const ox = (r() - 0.5) * 1.6;
      const oz = (r() - 0.5) * 1.6;
      const L = len * (0.6 + r() * 0.6);
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        pts.push([x + ox + Math.sin(t * 3 + v) * 0.25, y - t * L, z + oz + Math.cos(t * 2.4 + v) * 0.2]);
      }
      const geo = bake(tube(pts, 0.035 + r() * 0.03, 12, 5, 0.012), { color: col('#2f5a2a').lerp(col('#6a8a3a'), r() * 0.5), rough: 0.8 });
      // sway weight increases with distance from the anchor
      const p = geo.getAttribute('position');
      const w = new Float32Array(p.count);
      for (let k = 0; k < p.count; k++) w[k] = Math.pow(Math.min(1, (y - p.getY(k)) / Math.max(1, L)), 1.4);
      geo.setAttribute('aSway', new THREE.BufferAttribute(w, 1));
      parts.push(geo);
      // leaves
      for (let k = 0; k < 7; k++) {
        const t = 0.15 + (k / 7) * 0.85;
        const leaf = new THREE.SphereGeometry(1, 6, 4);
        leaf.scale(0.14, 0.03, 0.26);
        const lg = bake(leaf, { color: col('#3f7a30').lerp(col('#9fd05a'), r() * 0.6), rough: 0.7 }, { p: [x + ox + Math.sin(t * 3 + v) * 0.25 + (k % 2 ? 0.14 : -0.14), y - t * L, z + oz + Math.cos(t * 2.4 + v) * 0.2], r: [0.4, r() * 6, 0.3] });
        const lp = lg.getAttribute('position');
        const lw = new Float32Array(lp.count);
        lw.fill(Math.pow(t, 1.4) * 1.2);
        lg.setAttribute('aSway', new THREE.BufferAttribute(lw, 1));
        parts.push(lg);
      }
    }
  }
  const geo = merge(parts);
  const m = vcMaterial({ side: THREE.DoubleSide });
  const sw = attribute('aSway', 'float');
  m.positionNode = positionLocal.add(vec3(sin(time.mul(1.2).add(positionLocal.x.mul(0.7)).add(positionLocal.y.mul(0.3))).mul(0.16).mul(sw), 0, cos(time.mul(0.9).add(positionLocal.z.mul(0.6))).mul(0.12).mul(sw)));
  bin.add(geo), bin.add(m);
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.name = 'vines';
  return { obj: mesh };
}

// ───────────────────────── crystals ─────────────────────────

export function buildCrystals(bin: Bin, spots: Array<[number, number, number, number]>): Module {
  const r = rng(4242);
  const parts: Geo[] = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.55 + r() * 1.1 + (i === 0 ? 0.7 : 0);
    const rad = 0.09 + r() * 0.1;
    const body = new THREE.CylinderGeometry(rad * 0.7, rad, h, 6, 1);
    body.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(rad * 0.7, rad * 2.1, 6, 1);
    tip.translate(0, h + rad, 0);
    const a = r() * 6.28;
    const tilt = i === 0 ? 0 : 0.25 + r() * 0.5;
    for (const gpart of [body, tip]) {
      const bg = bake(gpart, { color: '#ffffff', rough: 0.2 }, { p: [Math.sin(a) * (i === 0 ? 0 : 0.18 + r() * 0.1), 0, Math.cos(a) * (i === 0 ? 0 : 0.18 + r() * 0.1)], r: [Math.cos(a) * tilt, a, -Math.sin(a) * tilt] });
      const p = bg.getAttribute('position');
      const cl = bg.getAttribute('color') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const t = Math.min(1, Math.max(0, p.getY(k) / 1.6));
        const v = 0.7 + t * 1.6;
        cl.setXYZ(k, v, v, v);
      }
      parts.push(bg);
    }
  }
  const geo = merge(parts);
  const m = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
  bin.add(geo), bin.add(m);
  const ms: THREE.Matrix4[] = [];
  const cs: THREE.Color[] = [];
  const cols = ['#19e6ff', '#ff3fd0', '#ffae2b', '#3fffb0'];
  for (const [x, y, z, sc] of spots) {
    ms.push(mtx(x, y, z, r() * 6.28, sc));
    cs.push(col(cols[Math.floor(r() * cols.length)]!).multiplyScalar(1.5));
  }
  const im = instanced(geo, m, ms, cs, false);
  im.receiveShadow = false;
  return { obj: im };
}

// ───────────────────────── lotus ─────────────────────────

export function buildLotus(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  const r = rng(2024);
  const pad = new THREE.CircleGeometry(0.55, 18, 0.3, Math.PI * 2 - 0.5);
  pad.rotateX(-Math.PI / 2);
  const padG = merge([bake(pad, { color: '#2f7a3a', rough: 0.6 })]);
  const petals: Geo[] = [];
  for (let ring = 0; ring < 2; ring++) {
    const n = ring === 0 ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.4;
      const p = new THREE.SphereGeometry(1, 6, 4);
      p.scale(0.06, 0.16 - ring * 0.03, 0.03);
      p.translate(0, 0.14, 0);
      const tilt = 0.35 + ring * 0.5;
      petals.push(bake(p, { color: ring ? '#ffd0e4' : '#f3a0c8', rough: 0.5, emit: 0.35 }, { p: [Math.sin(a) * 0.05, 0.03, Math.cos(a) * 0.05], r: [Math.cos(a) * tilt, 0, -Math.sin(a) * tilt] }));
    }
  }
  petals.push(bake(new THREE.SphereGeometry(0.05, 8, 6), { color: '#ffd060', rough: 0.4, emit: 1.6 }, { p: [0, 0.07, 0] }));
  const flowerG = merge(petals);
  bin.add(padG), bin.add(flowerG);
  const padM = vcMaterial({ side: THREE.DoubleSide });
  padM.positionNode = positionLocal.add(vec3(0, sin(time.mul(1.1).add(hash(instanceIndex.toFloat()).mul(6.283))).mul(0.018), 0));
  const flM = vcMaterial({ side: THREE.DoubleSide });
  flM.positionNode = positionLocal.add(vec3(0, sin(time.mul(1.1).add(hash(instanceIndex.toFloat()).mul(6.283))).mul(0.018), 0));
  bin.add(padM), bin.add(flM);
  const pm: THREE.Matrix4[] = [];
  const pc: THREE.Color[] = [];
  const fm: THREE.Matrix4[] = [];
  const n = Math.round(90 * quality.density);
  for (let i = 0; i < n; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (3.6 + r() * 2.0);
    const z = -46 + r() * 56;
    if (Math.abs(z) < 2.6 && Math.abs(x) > 2.4) continue;
    const sc = 0.6 + r() * 0.9;
    pm.push(mtx(x, 0.03, z, r() * 6.28, sc));
    pc.push(col('#ffffff').lerp(col('#a8d070'), r() * 0.5).multiplyScalar(0.7 + r() * 0.4));
    if (r() < 0.32) fm.push(mtx(x + (r() - 0.5) * 0.3, 0.04, z + (r() - 0.5) * 0.3, r() * 6, 0.9 + r() * 0.4));
  }
  const pads = instanced(padG, padM, pm, pc, false);
  pads.receiveShadow = false;
  g.add(pads, instanced(flowerG, flM, fm, undefined, false));
  return { obj: g };
}

// ───────────────────────── waterfalls ─────────────────────────

function ribbonFall(path: Array<[number, number]>, across: 'x' | 'z', width: number, lift: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = path[i]!;
    const hs: number[] = [];
    for (const f of [-0.5, 0, 0.5]) hs.push(across === 'x' ? terrainHeight(x + f * width, z) : terrainHeight(x, z + f * width));
    const y = Math.max(...hs) + lift;
    for (const s of [0, 1]) {
      const o = (s - 0.5) * width;
      pos.push(across === 'x' ? x + o : x, y, across === 'x' ? z : z + o);
      uvs.push(s, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function fallMaterial(speed: number, seed: number) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const v = uv();
  const n1 = mx_noise_float(vec3(v.x.mul(9).add(seed), v.y.mul(26).sub(time.mul(speed)), 0.0));
  const n2 = mx_noise_float(vec3(v.x.mul(21).add(seed * 2), v.y.mul(9).sub(time.mul(speed * 0.7)), 3.0));
  const streak = smoothstep(-0.2, 0.7, n1.mul(0.6).add(n2.mul(0.5)));
  const edge = smoothstep(0.0, 0.18, v.x).mul(smoothstep(1.0, 0.82, v.x));
  const top = smoothstep(0.0, 0.08, v.y);
  m.colorNode = mix(tslColor(new THREE.Color('#8fe0da')), tslColor(new THREE.Color('#ffffff')), streak.mul(0.9)).mul(1.15);
  m.opacityNode = streak.mul(0.55).add(0.22).mul(edge).mul(top).mul(0.85);
  return m;
}

export function buildFalls(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'waterfalls';
  const defs: Array<{ path: Array<[number, number]>; across: 'x' | 'z'; w: number }> = [];
  const line = (x0: number, z0: number, x1: number, z1: number, n = 30) => Array.from({ length: n }, (_, i): [number, number] => [x0 + ((x1 - x0) * i) / (n - 1), z0 + ((z1 - z0) * i) / (n - 1)]);
  defs.push({ path: line(0, -96, 0, -57.5, 44), across: 'x', w: 9 });
  defs.push({ path: line(-52, -24, -29.5, -24), across: 'z', w: 3.4 });
  defs.push({ path: line(54, -38, 29.5, -38), across: 'z', w: 4.2 });
  defs.push({ path: line(-48, -54, -30.5, -54), across: 'z', w: 2.8 });
  defs.push({ path: line(50, 6, 30.5, 6), across: 'z', w: 2.4 });
  const bases: Array<[number, number, number, number]> = [];
  defs.forEach((d, i) => {
    const geo = ribbonFall(d.path, d.across, d.w, 0.5);
    const m = fallMaterial(1.6 + i * 0.3, i * 3.7);
    bin.add(geo), bin.add(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    g.add(mesh);
    const end = d.path[d.path.length - 1]!;
    bases.push([end[0], terrainHeight(end[0], end[1]) + 0.4, end[1], d.w]);
  });
  // mist + splashes at the bases
  bases.forEach(([x, y, z, w], i) => {
    const mist = createParticles({ count: i === 0 ? 48 : 22, min: [x - w * 0.7, y, z - w * 0.7], max: [x + w * 0.7, y + (i === 0 ? 7 : 4), z + w * 0.7], color: '#dff4f6', size: i === 0 ? 4.2 : 2.6, motion: 'float', speed: 0.35, opacity: 0.16, additive: false, quality });
    const spl = createParticles({ count: i === 0 ? 50 : 20, min: [x - w * 0.5, y, z - w * 0.5], max: [x + w * 0.5, y + 2.6, z + w * 0.5], color: '#ffffff', size: 0.12, motion: 'rise', speed: 1.4, opacity: 0.6, quality });
    g.add(mist, spl);
  });
  return { obj: g };
}

// ───────────────────────── mist, particles ─────────────────────────

export function buildAtmosphere(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'atmosphere';
  const geo = new THREE.PlaneGeometry(64, 150);
  geo.rotateX(-Math.PI / 2);
  bin.add(geo);
  const layers: Array<[number, string, number, number]> = [[0.22, '#a8c0cc', 0.36, 0.06], [1.1, '#b8a8c8', 0.22, 0.05]];
  if (quality.level === 'low') layers.pop();
  for (const [y, c, o, sc] of layers) {
    const m = mistMaterial(c, o, sc, [0.04, 0.02], 32, 75, -40);
    bin.add(m);
    const p = new THREE.Mesh(geo, m);
    p.position.set(0, y, -40);
    p.renderOrder = 2;
    g.add(p);
  }
  g.add(createParticles({ count: 110, min: [-16, 0.4, -34], max: [16, 8, 12], color: '#7ff5ff', color2: '#c8ffe8', size: 0.11, motion: 'float', speed: 0.5, twinkle: 0.85, quality }));
  g.add(createParticles({ count: 60, min: [-22, 0.6, -50], max: [22, 12, -10], color: '#ffe27a', color2: '#b8ff7a', size: 0.14, motion: 'float', speed: 0.4, twinkle: 1.0, quality }));
  g.add(createParticles({ count: 40, min: [-18, 4, -24], max: [18, 12, 12], color: '#ff9ac8', color2: '#ffd0e4', size: 0.13, motion: 'fall', speed: 0.5, wind: [0.4, 0.1], opacity: 0.8, additive: false, quality }));
  return { obj: g };
}

// ───────────────────────── rope bridges ─────────────────────────

export function buildBridges(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'bridges';
  const mat = bin.add(vcMaterial());
  const r = rng(77);
  const mk = (z: number, x0: number, x1: number, y0: number, y1: number, sag: number, seed: number) => {
    const P: Geo[] = [];
    const n = Math.round(Math.abs(x1 - x0) / 0.62);
    const at = (t: number): [number, number] => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - sag * 4 * t * (1 - t)];
    const wood = ['#6f4a2a', '#5f3f24', '#7c5530', '#54381f'];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const [x, y] = at(t);
      const [xn, yn] = at(Math.min(1, t + 0.01));
      const ang = Math.atan2(yn - y, xn - x);
      P.push(bake(rbox(0.5, 0.07, 1.7, 0.02, 1), { color: wood[Math.floor(r() * wood.length)]!, rough: 0.85 }, { p: [x, y, z + (r() - 0.5) * 0.04], r: [0, 0, ang] }));
    }
    for (const s of [-1, 1]) {
      const rope: Array<[number, number, number]> = [];
      const hand: Array<[number, number, number]> = [];
      for (let i = 0; i <= 12; i++) {
        const [x, y] = at(i / 12);
        rope.push([x, y + 0.05, z + s * 0.82]);
        hand.push([x, y + 1.05, z + s * 0.82]);
      }
      P.push(bake(tube(rope, 0.035, 24, 5), { color: '#a08a5a', rough: 0.95 }));
      P.push(bake(tube(hand, 0.045, 24, 5), { color: '#b09a68', rough: 0.95 }));
      for (let i = 0; i <= n; i += 3) {
        const [x, y] = at(i / n);
        P.push(segment([x, y + 0.03, z + s * 0.82], [x, y + 1.05, z + s * 0.82], 0.022, 0.022, S('#a08a5a', 0.95), 4));
        if (i % 6 === 0) P.push(bake(ellipsoid(0.07, 0.11, 0.07, 6, 5), { color: '#ffb45a', rough: 0.3, emit: 1.6 }, { p: [x, y + 1.2, z + s * 0.82] }));
      }
    }
    // towers at both ends
    for (const [x, y] of [[x0, y0], [x1, y1]] as Array<[number, number]>) {
      for (const s of [-1, 1]) P.push(bake(rbox(0.7, 4.2, 0.7, 0.1), { color: '#8f8b78', rough: 0.9 }, { p: [x + (x < 0 ? -0.3 : 0.3), y - 1.3, z + s * 0.9] }));
      P.push(bake(rbox(0.9, 0.3, 2.9, 0.08), { color: '#d6a640', rough: 0.35, metal: 0.8 }, { p: [x + (x < 0 ? -0.3 : 0.3), y + 0.9, z] }));
    }
    const geo = merge(P);
    bin.add(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.frustumCulled = true;
    m.name = 'bridge' + seed;
    g.add(m);
  };
  const y1 = (x: number, z: number) => terrainHeight(x, z) + 3.2;
  mk(-24, -23.5, 23.5, y1(-23.5, -24), y1(23.5, -24), 1.6, 1);
  if (quality.level !== 'low') mk(-58, -26, 26, y1(-26, -58), y1(26, -58), 2.8, 2);
  return { obj: g };
}

void cone;
void cyl;
void torus;
void uniform;
void positionWorld;
