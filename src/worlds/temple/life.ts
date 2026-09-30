import * as THREE from 'three/webgpu';
import { color as tslColor, fract, hash, mix, mx_fractal_noise_float, positionLocal, positionWorld, smoothstep, time, uniform, uv, vec3, positionView, normalView, float } from 'three/tsl';
import { cone, cyl, ellipsoid, lathe, latheShell, torus, tube } from '../../characters/geo';
import { rng } from '../../world/kit';
import type { QualityPreset } from '../../render/quality';
import { Bin, S, build, glowVc, smooth as ss, vcMaterial, weather, type Geo } from './util';
import { terrainHeight } from './terrain';
import type { Module } from './structures';

const col = (h: string) => new THREE.Color(h);

// ───────────────────────── giant koi ─────────────────────────

function koiGeos(seed: number, base: string, p1: string, p2: string): { body: Geo; tail: Geo } {
  const bodyParts = build([
    [ellipsoid(0.3, 0.26, 0.95, 18, 12), S(base, 0.35, 0), { p: [0, 0, 0.1] }],
    [ellipsoid(0.22, 0.2, 0.42, 14, 10), S(base, 0.35, 0), { p: [0, -0.01, 0.9] }],
    [ellipsoid(0.03, 0.22, 0.4, 8, 8), S(p1, 0.4), { p: [0, 0.3, 0.0], r: [0.4, 0, 0] }],
    [ellipsoid(0.32, 0.03, 0.2, 8, 6), S(p1, 0.4), { p: [0.32, -0.12, 0.35], r: [0, -0.5, -0.5] }],
    [ellipsoid(0.32, 0.03, 0.2, 8, 6), S(p1, 0.4), { p: [-0.32, -0.12, 0.35], r: [0, 0.5, 0.5] }],
    [ellipsoid(0.05, 0.05, 0.03, 6, 5), S('#101010', 0.3), { p: [0.14, 0.07, 1.2] }],
    [ellipsoid(0.05, 0.05, 0.03, 6, 5), S('#101010', 0.3), { p: [-0.14, 0.07, 1.2] }],
  ]);
  // patchy colouring
  const pos = bodyParts.getAttribute('position');
  const cl = bodyParts.getAttribute('color') as THREE.BufferAttribute;
  const c = new THREE.Color();
  const c1 = new THREE.Color(p1);
  const c2 = new THREE.Color(p2);
  for (let i = 0; i < pos.count; i++) {
    const n = Math.sin(pos.getZ(i) * 3.3 + seed) * Math.sin(pos.getX(i) * 6.0 + seed * 2) + Math.sin(pos.getZ(i) * 7.0 + seed * 3) * 0.5;
    if (pos.getY(i) > -0.15 && n > 0.35) c.copy(c1);
    else if (pos.getY(i) > -0.1 && n < -0.55) c.copy(c2);
    else c.setRGB(cl.getX(i), cl.getY(i), cl.getZ(i));
    cl.setXYZ(i, c.r, c.g, c.b);
  }
  const tail = build([
    [ellipsoid(0.03, 0.34, 0.34, 8, 8), S(p1, 0.4), { p: [0, 0.04, -0.28], r: [0.5, 0, 0] }],
    [ellipsoid(0.03, 0.3, 0.3, 8, 8), S(base, 0.4), { p: [0, -0.06, -0.3], r: [-0.5, 0, 0] }],
    [ellipsoid(0.12, 0.14, 0.3, 8, 6), S(base, 0.4), { p: [0, 0, -0.05] }],
  ]);
  return { body: bodyParts, tail };
}

export function buildKoi(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'koi';
  const mat = bin.add(vcMaterial());
  const defs = [
    { base: '#f4efe4', p1: '#ff6a1a', p2: '#1a1a1a', cz: -4, a: 3.0, b: 6.5, sp: 0.16, ph: 0, dep: -1.1, sc: 1.2 },
    { base: '#ffcf5a', p1: '#ff8a1a', p2: '#f4efe4', cz: -14, a: 2.7, b: 7, sp: 0.13, ph: 2, dep: -1.3, sc: 1.5 },
    { base: '#f4efe4', p1: '#e83a2a', p2: '#f4efe4', cz: -24, a: 3.2, b: 7.5, sp: 0.12, ph: 4, dep: -1.0, sc: 1.35 },
    { base: '#e8e2d2', p1: '#ff9a3a', p2: '#2a2a2a', cz: 6, a: 3.1, b: 5, sp: 0.18, ph: 1, dep: -1.2, sc: 1.1 },
    { base: '#ffd98a', p1: '#ff7a1a', p2: '#f4efe4', cz: -32, a: 2.8, b: 6, sp: 0.14, ph: 3, dep: -1.4, sc: 1.6 },
    { base: '#f8f4ea', p1: '#c8281c', p2: '#1a1a1a', cz: -9, a: 2.2, b: 4, sp: -0.2, ph: 5, dep: -0.9, sc: 1.0 },
  ].slice(0, quality.level === 'low' ? 3 : 6);
  const fishes = defs.map((d, i) => {
    const gs = koiGeos(i * 1.7, d.base, d.p1, d.p2);
    bin.add(gs.body), bin.add(gs.tail);
    const root = new THREE.Group();
    const body = new THREE.Mesh(gs.body, mat);
    const tailPivot = new THREE.Group();
    tailPivot.position.z = -0.2;
    const tail = new THREE.Mesh(gs.tail, mat);
    tailPivot.add(tail);
    root.add(body, tailPivot);
    root.scale.setScalar(d.sc);
    g.add(root);
    return { root, tailPivot, d };
  });
  return {
    obj: g,
    update(_dt, t) {
      for (const f of fishes) {
        const w = t * f.d.sp + f.d.ph;
        const x = Math.cos(w) * f.d.a;
        const z = f.d.cz + Math.sin(w) * f.d.b;
        const dx = -Math.sin(w) * f.d.a * Math.sign(f.d.sp);
        const dz = Math.cos(w) * f.d.b * Math.sign(f.d.sp);
        f.root.position.set(x, f.d.dep + Math.sin(t * 0.5 + f.d.ph) * 0.2, z);
        f.root.rotation.y = Math.atan2(dx, dz) + Math.sin(t * 2.2 + f.d.ph) * 0.12;
        f.root.rotation.z = Math.sin(t * 1.1 + f.d.ph) * 0.06;
        f.tailPivot.rotation.y = Math.sin(t * 4.2 + f.d.ph * 2) * 0.55;
      }
    },
  };
}

// ───────────────────────── temple spirit ─────────────────────────

export function buildSpirit(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'temple-spirit';
  const glass = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  glass.blending = THREE.AdditiveBlending;
  glass.fog = false;
  const fres = float(1).sub(normalView.dot(positionView.normalize().negate()).abs().clamp(0, 1));
  const n = mx_fractal_noise_float(vec3(positionWorld.x.mul(1.4), positionWorld.y.mul(1.2).sub(time.mul(0.6)), positionWorld.z.mul(1.4)), 2, 2.0, 0.5, 1.0);
  const below = smoothstep(-2.2, 0.4, positionLocal.y);
  glass.colorNode = mix(tslColor(col('#4ff0ff')), tslColor(col('#d8b0ff')), fres.add(n.mul(0.25)).clamp(0, 1)).mul(1.35);
  glass.opacityNode = fres.mul(0.5).add(0.1).mul(below).mul(n.mul(0.25).add(0.8));
  bin.add(glass);
  // robe (open lathe shell), hood, head glow, arms, halo
  const robe = latheShell([[0.02, 1.7], [0.42, 1.5], [0.5, 0.6], [0.7, -0.4], [0.35, -1.6], [0.05, -2.3]], 22, 18);
  const hood = new THREE.SphereGeometry(0.36, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.75);
  hood.translate(0, 1.9, -0.02);
  const armGeo = tube([[0, 0, 0], [0.35, -0.25, 0.25], [0.65, -0.1, 0.55]], 0.09, 10, 6, 0.03);
  const halo = new THREE.TorusGeometry(0.62, 0.02, 6, 36);
  halo.translate(0, 1.95, -0.2);
  const orb = new THREE.SphereGeometry(0.12, 10, 8);
  const face = new THREE.SphereGeometry(0.18, 12, 10);
  face.translate(0, 1.85, 0.12);
  for (const geo of [robe, hood, halo, face]) {
    const m = new THREE.Mesh(geo, glass);
    g.add(m);
    bin.add(geo);
  }
  const arms: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(armGeo, glass);
    m.position.set(s * 0.4, 1.35, 0.05);
    m.scale.x = s;
    g.add(m);
    arms.push(m);
  }
  bin.add(armGeo);
  const eyes = glowVc(3.4, { tint: '#ffffff' });
  bin.add(eyes.material);
  const eyeGeo = build([
    [ellipsoid(0.035, 0.02, 0.02, 6, 5), S('#ffffff'), { p: [0.07, 1.88, 0.29] }],
    [ellipsoid(0.035, 0.02, 0.02, 6, 5), S('#ffffff'), { p: [-0.07, 1.88, 0.29] }],
  ]);
  bin.add(eyeGeo);
  g.add(new THREE.Mesh(eyeGeo, eyes.material));
  const orbs: THREE.Mesh[] = [];
  const orbMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#a8f8ff').multiplyScalar(2.5), transparent: true, opacity: 0.85, depthWrite: false });
  orbMat.blending = THREE.AdditiveBlending;
  bin.add(orbMat), bin.add(orb);
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(orb, orbMat);
    m.scale.setScalar(0.5 + (i % 3) * 0.3);
    g.add(m);
    orbs.push(m);
  }
  g.scale.setScalar(1.0);
  let light: THREE.PointLight | null = null;
  if (quality.localLights >= 4) {
    light = new THREE.PointLight(0x66e8ff, 6, 9, 2);
    light.position.set(0, 1.5, 0.4);
    g.add(light);
  }
  return {
    obj: g,
    update(_dt, t, cam) {
      // drifting figure-eight above the water beyond the crossing
      const a = t * 0.13;
      const x = Math.sin(a) * 4.4;
      const z = -13 + Math.sin(a * 2) * 3.2;
      g.position.set(x, 2.5 + Math.sin(t * 0.8) * 0.28, z);
      const dx = cam.position.x - g.position.x;
      const dz = cam.position.z - g.position.z;
      g.rotation.y += (Math.atan2(dx, dz) - g.rotation.y) * 0.03;
      g.rotation.z = Math.sin(t * 0.6) * 0.05;
      arms.forEach((m, i) => {
        m.rotation.z = Math.sin(t * 1.1 + i * 2) * 0.25;
        m.rotation.x = Math.sin(t * 0.9 + i) * 0.2;
      });
      orbs.forEach((m, i) => {
        const b = t * (0.8 + i * 0.13) + i * 1.9;
        m.position.set(Math.cos(b) * (0.9 + i * 0.05), 1.2 + Math.sin(b * 1.3) * 0.9, Math.sin(b) * (0.9 + i * 0.05));
      });
      eyes.k.value = 3 + Math.sin(t * 2) * 1.0;
      if (light) light.intensity = 5 + Math.sin(t * 1.7) * 1.5;
    },
  };
}

// ───────────────────────── stone turtles + lantern bugs ─────────────────────────

export function buildCreatures(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'creatures';
  const mat = bin.add(vcMaterial());
  const r = rng(909);
  // turtle: mossy shell with glowing glyphs
  const shellParts: Array<[Geo, ReturnType<typeof S>, { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number }?]> = [
    [ellipsoid(0.62, 0.34, 0.8, 18, 12), S('#7d8672', 0.9), { p: [0, 0.32, 0] }],
    [torus(0.6, 0.06, Math.PI * 2, 20, 6), S('#5f6a58', 0.9), { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0], s: [1, 1.28, 1] }],
  ];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    shellParts.push([ellipsoid(0.15, 0.05, 0.17, 8, 6), S('#96a08a', 0.85), { p: [Math.sin(a) * 0.32, 0.6 - 0.08 * Math.cos(a * 2) * 0, Math.cos(a) * 0.42], r: [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5] }]);
    shellParts.push([ellipsoid(0.03, 0.02, 0.03, 6, 5), S('#5ff2e0', 0.2, 0, 2.2), { p: [Math.sin(a) * 0.32, 0.68, Math.cos(a) * 0.42] }]);
  }
  shellParts.push([ellipsoid(0.16, 0.05, 0.2, 8, 6), S('#96a08a', 0.85), { p: [0, 0.68, 0] }], [ellipsoid(0.06, 0.03, 0.06, 6, 5), S('#ffb45a', 0.2, 0, 2.4), { p: [0, 0.72, 0] }]);
  const shell = weather(build(shellParts), 5, '#4d8a38', 0.6, 0.6, 0.2);
  const head = build([
    [ellipsoid(0.2, 0.16, 0.26, 12, 8), S('#6d7a62', 0.8), { p: [0, 0, 0.1] }],
    [ellipsoid(0.04, 0.05, 0.03, 6, 5), S('#ffb45a', 0.2, 0, 2.5), { p: [0.11, 0.05, 0.24] }],
    [ellipsoid(0.04, 0.05, 0.03, 6, 5), S('#ffb45a', 0.2, 0, 2.5), { p: [-0.11, 0.05, 0.24] }],
  ]);
  const legGeo = build([[ellipsoid(0.13, 0.12, 0.2, 8, 6), S('#6d7a62', 0.85), { p: [0, -0.02, 0] }]]);
  bin.add(shell), bin.add(head), bin.add(legGeo);
  const turtles: Array<{ root: THREE.Group; head: THREE.Group; legs: THREE.Mesh[]; cx: number; cz: number; rad: number; sp: number; ph: number }> = [];
  const spots: Array<[number, number, number]> = [[-11.6, 8.2, 1.4], [12.4, -8.6, 1.2], [-15.5, -11, 1.6], [14.6, 11.5, 1.1]];
  spots.forEach(([cx, cz, rad], i) => {
    const root = new THREE.Group();
    const sh = new THREE.Mesh(shell, mat);
    sh.castShadow = true;
    root.add(sh);
    const hg = new THREE.Group();
    hg.position.set(0, 0.28, 0.74);
    hg.add(new THREE.Mesh(head, mat));
    root.add(hg);
    const legs: THREE.Mesh[] = [];
    for (const [lx, lz] of [[0.42, 0.42], [-0.42, 0.42], [0.42, -0.42], [-0.42, -0.42]] as Array<[number, number]>) {
      const l = new THREE.Mesh(legGeo, mat);
      l.position.set(lx, 0.14, lz);
      root.add(l);
      legs.push(l);
    }
    g.add(root);
    turtles.push({ root, head: hg, legs, cx, cz, rad, sp: 0.045 + r() * 0.02, ph: i * 1.7 });
  });

  // lantern bugs
  const bodyG = build([
    [ellipsoid(0.03, 0.03, 0.07, 8, 6), S('#2a2030', 0.6), { p: [0, 0, 0.03] }],
    [ellipsoid(0.028, 0.028, 0.03, 8, 6), S('#2a2030', 0.6), { p: [0, 0, 0.11] }],
  ]);
  const abdG = build([[ellipsoid(0.05, 0.05, 0.06, 10, 8), S('#ffe27a'), { p: [0, -0.005, -0.06] }]]);
  const wingG = build([
    [ellipsoid(0.11, 0.004, 0.05, 8, 4), S('#e8f8ff', 0.3), { p: [0.1, 0.03, 0.03] }],
    [ellipsoid(0.11, 0.004, 0.05, 8, 4), S('#e8f8ff', 0.3), { p: [-0.1, 0.03, 0.03] }],
  ]);
  bin.add(bodyG), bin.add(abdG), bin.add(wingG);
  const abd = glowVc(4.0);
  const wing = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false });
  bin.add(abd.material), bin.add(wing);
  const nb = quality.level === 'low' ? 4 : 8;
  const bugs: Array<{ root: THREE.Group; wings: THREE.Mesh; cx: number; cz: number; a: number; b: number; y: number; sp: number; ph: number }> = [];
  for (let i = 0; i < nb; i++) {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(bodyG, mat));
    root.add(new THREE.Mesh(abdG, abd.material));
    const wings = new THREE.Mesh(wingG, wing);
    root.add(wings);
    root.scale.setScalar(1.6);
    g.add(root);
    const side = i % 2 ? 1 : -1;
    bugs.push({ root, wings, cx: side * (7.5 + r() * 5), cz: -8 + r() * 16, a: 2 + r() * 3, b: 2 + r() * 3, y: 1.2 + r() * 2.2, sp: 0.35 + r() * 0.3, ph: r() * 6 });
  }
  void cone; void cyl; void lathe; void hash; void fract; void uniform; void uv; void ss;
  return {
    obj: g,
    update(_dt, t) {
      for (const tt of turtles) {
        const w = t * tt.sp + tt.ph;
        const x = tt.cx + Math.cos(w) * tt.rad;
        const z = tt.cz + Math.sin(w) * tt.rad;
        tt.root.position.set(x, terrainHeight(x, z) + 0.03, z);
        tt.root.rotation.y = Math.atan2(-Math.sin(w), Math.cos(w));
        tt.head.rotation.x = Math.sin(t * 1.3 + tt.ph) * 0.12;
        tt.head.position.z = 0.74 + Math.sin(t * 0.8 + tt.ph) * 0.05;
        tt.legs.forEach((l, i) => {
          l.rotation.x = Math.sin(t * 2.2 + tt.ph + (i % 2 ? Math.PI : 0)) * 0.4;
        });
      }
      for (const b of bugs) {
        const w = t * b.sp + b.ph;
        const x = b.cx + Math.sin(w) * b.a + Math.sin(w * 2.3) * 0.6;
        const z = b.cz + Math.cos(w * 0.8) * b.b;
        const y = b.y + Math.sin(w * 1.7) * 0.6;
        b.root.position.set(x, y, z);
        b.root.rotation.y = Math.atan2(Math.cos(w) * b.a, -Math.sin(w * 0.8) * b.b * 0.8);
        b.wings.rotation.z = Math.sin(t * 60 + b.ph) * 0.5;
      }
      abd.k.value = 3.2 + Math.sin(t * 3.1) * 1.2;
    },
  };
}

// ───────────────────────── distant thunderstorm ─────────────────────────

export interface Storm extends Module {
  readonly flash: { value: number };
  strikeNow(): void;
}

export function buildStorm(bin: Bin): Storm {
  const g = new THREE.Group();
  g.name = 'storm';
  const flash = { value: 0 };
  const uFlash = uniform(0);
  const geo = new THREE.PlaneGeometry(300, 70);
  bin.add(geo);
  const banks: Array<[number, number, number, number]> = [[-120, 62, -250, 1], [60, 80, -270, 2], [190, 55, -230, 3], [-30, 105, -300, 4], [-210, 90, -240, 5]];
  for (const [x, y, z, sd] of banks) {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.fog = false;
    const v = uv();
    const n = mx_fractal_noise_float(vec3(v.x.mul(5).add(sd * 3.1).add(time.mul(0.012)), v.y.mul(3.2), time.mul(0.03).add(sd)), 4, 2.0, 0.5, 1.0);
    const dens = smoothstep(-0.15, 0.55, n).mul(smoothstep(0.0, 0.3, v.x)).mul(smoothstep(1.0, 0.7, v.x)).mul(smoothstep(0.0, 0.35, v.y)).mul(smoothstep(1.0, 0.65, v.y));
    const inner = smoothstep(0.1, 0.9, n.add(0.5)).mul(uFlash);
    m.colorNode = mix(tslColor(col('#2a2040')), tslColor(col('#3a2f52')), n.mul(0.5).add(0.5)).add(mix(tslColor(col('#8a7ad8')), tslColor(col('#fff0ff')), inner).mul(inner).mul(3.0));
    m.opacityNode = dens.mul(0.92);
    bin.add(m);
    const p = new THREE.Mesh(geo, m);
    p.position.set(x, y, z);
    p.scale.setScalar(1 + (sd % 3) * 0.25);
    p.renderOrder = -900;
    g.add(p);
  }
  // pre-baked jagged bolts
  const r = rng(13);
  const boltMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#e6ddff').multiplyScalar(6) });
  boltMat.fog = false;
  bin.add(boltMat);
  const bolts: THREE.Mesh[] = [];
  for (let b = 0; b < 3; b++) {
    const pts: Array<THREE.Vector3> = [];
    let x = 0;
    for (let i = 0; i <= 12; i++) {
      x += (r() - 0.5) * 9;
      pts.push(new THREE.Vector3(x, 60 - i * 5, 0));
    }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), 60, 0.35, 4, false);
    bin.add(tg);
    const m = new THREE.Mesh(tg, boltMat);
    m.position.set(-90 + b * 100, 30 + b * 8, -220 - b * 20);
    m.visible = false;
    g.add(m);
    bolts.push(m);
  }
  let next = 4;
  let strike = -1;
  let bolt = 0;
  let now = 0;
  return {
    obj: g,
    flash,
    strikeNow() {
      next = 0;
    },
    update(_dt, t) {
      now = t;
      if (strike < 0 && now > next) {
        strike = t;
        bolt = Math.floor(Math.random() * bolts.length);
        next = t + 6 + Math.random() * 9;
      }
      let f = 0;
      if (strike >= 0) {
        const u = t - strike;
        // double flicker envelope
        f = Math.max(0, Math.exp(-u * 7) * (0.6 + 0.4 * Math.sin(u * 60))) + (u > 0.22 ? Math.max(0, Math.exp(-(u - 0.22) * 6)) * 0.8 : 0);
        bolts.forEach((b, i) => (b.visible = i === bolt && u < 0.32 && f > 0.15));
        if (u > 1.4) {
          strike = -1;
          f = 0;
          bolts.forEach((b) => (b.visible = false));
        }
      }
      flash.value = Math.min(1, f);
      uFlash.value = 0.12 + flash.value * 1.4;
    },
  };
}
