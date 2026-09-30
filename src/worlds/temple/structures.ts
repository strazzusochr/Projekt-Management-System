import * as THREE from 'three/webgpu';
import { hash, instanceIndex, sin, time, vertexColor } from 'three/tsl';
import { cone, cyl, ellipsoid, lathe, torus } from '../../characters/geo';
import { createParticles, rng } from '../../world/kit';
import type { QualityPreset } from '../../render/quality';
import { Bin, S, build, flameGeometry, flameMaterial, glowVc, instanced, mtx, segment, smooth as ss, vcMaterial, weather, type Geo, type Part, rbox, box } from './util';
import { terrainHeight } from './terrain';

export interface Module {
  obj: THREE.Object3D;
  update?(dt: number, t: number, cam: THREE.PerspectiveCamera): void;
}

const col = (h: string) => new THREE.Color(h);

// ───────────────────────── colossal statues ─────────────────────────

function statueParts(keeper: boolean): { body: Geo; head: Geo; eyes: Geo; headPos: [number, number, number] } {
  const stone = keeper ? '#c2bca0' : '#7f8a78';
  const stone2 = keeper ? '#a89f80' : '#67715f';
  const gold = '#d6a640';
  const jade = keeper ? '#46d6b0' : '#3fae8c';
  const P: Part[] = [];
  P.push([rbox(3.8, 1.0, 3.8, 0.12, 2), S(stone2, 0.9), { p: [0, 0.5, 0] }]);
  P.push([rbox(3.1, 0.55, 3.1, 0.1, 2), S(stone, 0.85), { p: [0, 1.27, 0] }]);
  P.push([torus(1.55, 0.09, Math.PI * 2, 28, 6), S(gold, 0.3, 0.9), { p: [0, 1.56, 0], r: [Math.PI / 2, 0, 0] }]);
  // kilt / robe
  if (keeper) {
    P.push([lathe([[1.7, 1.55], [1.5, 2.6], [1.15, 4.0], [0.95, 4.5]], 26, 16), S(stone, 0.8), { s: [1, 1, 0.8] }]);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      P.push([segment([Math.sin(a) * 1.5, 1.7, Math.cos(a) * 1.2], [Math.sin(a) * 1.0, 4.3, Math.cos(a) * 0.8], 0.06, 0.03, S(stone2, 0.8), 5)]);
    }
  } else {
    P.push([lathe([[1.15, 1.55], [1.1, 2.4], [1.0, 3.4], [0.9, 4.4]], 22, 14), S(stone, 0.85), { s: [1, 1, 0.74] }]);
    P.push([rbox(1.0, 2.6, 0.12, 0.05), S(stone2, 0.8), { p: [0, 3.0, 0.82] }]);
  }
  // torso
  P.push([lathe([[0.9, 4.2], [1.05, 5.0], [1.4, 6.2], [1.55, 7.0], [0.9, 7.7]], 24, 18), S(stone, 0.85), { s: [1, 1, 0.68] }]);
  P.push([torus(0.98, 0.14, Math.PI * 2, 24, 6), S(gold, 0.3, 0.9), { p: [0, 4.35, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.72, 1] }]);
  P.push([ellipsoid(1.15, 0.95, 0.5, 18, 12), S(keeper ? '#e6c060' : '#b58a3a', 0.35, 0.8), { p: [0, 6.3, 0.52] }]);
  P.push([ellipsoid(0.24, 0.28, 0.12, 12, 10), S(jade, 0.2, 0, 2.6), { p: [0, 6.45, 1.0] }]);
  for (const s of [-1, 1]) {
    P.push([ellipsoid(0.8, 0.34, 0.72, 16, 10), S(keeper ? gold : '#9c7a34', 0.4, 0.8), { p: [s * 1.75, 7.3, 0], r: [0, 0, s * -0.3] }]);
    P.push([cone(0.2, 0.7, 8), S(gold, 0.35, 0.85), { p: [s * 2.25, 7.75, 0], r: [0, 0, s * -0.7] }]);
    P.push([segment([s * 1.65, 7.0, 0], [s * 1.95, 5.6, 0.55], 0.44, 0.36, S(stone, 0.85), 10)]);
    P.push([ellipsoid(0.4, 0.4, 0.4, 10, 8), S(gold, 0.35, 0.85), { p: [s * 1.95, 5.6, 0.55] }]);
    if (keeper && s === 1) {
      // raised open palm
      P.push([segment([1.95, 5.6, 0.55], [2.6, 7.2, 1.7], 0.36, 0.3, S(stone, 0.85), 10)]);
      P.push([ellipsoid(0.5, 0.55, 0.16, 12, 10), S(stone, 0.85), { p: [2.65, 7.75, 1.75], r: [0.4, 0.2, 0] }]);
      for (let f = 0; f < 4; f++) P.push([segment([2.65 + (f - 1.5) * 0.2, 8.0, 1.8], [2.65 + (f - 1.5) * 0.24, 8.7, 1.95], 0.07, 0.05, S(stone, 0.85), 6)]);
      P.push([ellipsoid(0.32, 0.32, 0.12, 12, 10), S(jade, 0.15, 0, 2.6), { p: [2.65, 7.75, 1.95] }]);
    } else {
      P.push([segment([s * 1.95, 5.6, 0.55], [s * 0.32, 5.55, 1.55], 0.36, 0.3, S(stone, 0.85), 10)]);
    }
  }
  if (!keeper) {
    // great sword planted point-down in front
    P.push([rbox(0.52, 3.4, 0.14, 0.04), S('#9ea8a4', 0.3, 0.8), { p: [0, 3.1, 1.6] }]);
    P.push([cone(0.26, 0.5, 4), S('#9ea8a4', 0.3, 0.8), { p: [0, 1.15, 1.6], r: [Math.PI, Math.PI / 4, 0] }]);
    P.push([rbox(1.9, 0.22, 0.26, 0.06), S(gold, 0.3, 0.9), { p: [0, 4.9, 1.6] }]);
    P.push([cyl(0.09, 0.09, 0.9, 8), S('#3a2a1e', 0.6), { p: [0, 5.4, 1.6] }]);
    P.push([ellipsoid(0.2, 0.2, 0.2, 10, 8), S(jade, 0.2, 0, 2.4), { p: [0, 5.95, 1.6] }]);
  } else {
    // staff of light on the left side
    P.push([cyl(0.09, 0.11, 12.5, 8), S('#5a4630', 0.6), { p: [-3.0, 6.75, 0.8] }]);
    P.push([torus(0.7, 0.09, Math.PI * 1.5, 22, 6), S(gold, 0.3, 0.9), { p: [-3.0, 13.4, 0.8], r: [0, 0, Math.PI * 0.75] }]);
    P.push([ellipsoid(0.32, 0.32, 0.32, 12, 10), S('#9ffff0', 0.1, 0, 3.2), { p: [-3.0, 13.4, 0.8] }]);
    P.push([segment([-1.95, 5.6, 0.55], [-3.0, 6.0, 0.8], 0.36, 0.3, S(stone, 0.85), 10)]);
  }
  // neck
  P.push([segment([0, 7.55, 0], [0, 8.1, 0], 0.42, 0.38, S(stone, 0.85), 10)]);
  const body = weather(build(P), keeper ? 3 : 5, '#4d7d38', 3.4, keeper ? 0.28 : 0.6, 0.2);

  // head in its own frame (origin = neck top)
  const H: Part[] = [];
  H.push([ellipsoid(0.74, 0.88, 0.8, 22, 16), S(stone, 0.8), { p: [0, 0.78, 0] }]);
  H.push([ellipsoid(0.56, 0.42, 0.55, 16, 10), S(stone, 0.8), { p: [0, 0.2, 0.18] }]);
  H.push([rbox(1.25, 0.16, 0.34, 0.06), S(stone2, 0.8), { p: [0, 0.98, 0.66] }]);
  H.push([rbox(0.17, 0.52, 0.24, 0.05), S(stone, 0.8), { p: [0, 0.55, 0.78] }]);
  H.push([rbox(0.52, 0.06, 0.1, 0.02), S('#2c2f2a', 0.9), { p: [0, 0.22, 0.72] }]);
  // headdress: tiered crown + lappets
  H.push([cyl(0.86, 0.9, 0.34, 20), S(gold, 0.35, 0.85), { p: [0, 1.5, 0] }]);
  H.push([cyl(0.62, 0.8, 0.62, 20), S(stone2, 0.8), { p: [0, 1.95, 0] }]);
  H.push([cyl(0.3, 0.55, keeper ? 1.5 : 0.85, 16), S(gold, 0.35, 0.85), { p: [0, keeper ? 3.0 : 2.7, 0] }]);
  H.push([ellipsoid(0.2, 0.2, 0.2, 10, 8), S(jade, 0.15, 0, 3.0), { p: [0, keeper ? 3.9 : 3.3, 0] }]);
  for (const s of [-1, 1]) {
    H.push([rbox(0.3, 1.7, 0.95, 0.08), S(stone2, 0.8), { p: [s * 0.98, 0.5, -0.1], r: [0, 0, s * -0.1] }]);
    H.push([rbox(0.32, 0.12, 0.99, 0.03), S(gold, 0.3, 0.9), { p: [s * 1.02, 0.35, -0.1], r: [0, 0, s * -0.1] }]);
    H.push([rbox(0.32, 0.12, 0.99, 0.03), S(gold, 0.3, 0.9), { p: [s * 1.0, 0.85, -0.1], r: [0, 0, s * -0.1] }]);
  }
  if (keeper) H.push([torus(2.3, 0.12, Math.PI * 2, 40, 8), S(gold, 0.25, 0.95, 0.6), { p: [0, 1.3, -1.0], r: [0, 0, 0] }]);
  const head = weather(build(H), keeper ? 9 : 11, '#4d7d38', 0.0, 0, 0.18);
  const E: Part[] = [];
  for (const s of [-1, 1]) E.push([ellipsoid(0.19, 0.075, 0.09, 12, 8), S(keeper ? '#a0fff0' : '#ffc060', 0.2, 0, 3), { p: [s * 0.3, 0.9, 0.72], r: [0, s * 0.25, s * -0.15] }]);
  if (keeper) E.push([torus(2.15, 0.05, Math.PI * 2, 40, 6), S('#8fffe6', 0.2, 0, 2.6), { p: [0, 1.3, -0.98] }]);
  const eyes = build(E);
  return { body, head, eyes, headPos: [0, 7.9, 0] };
}

export function buildStatues(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'statues';
  const mat = bin.add(vcMaterial());
  const guard = statueParts(false);
  const keeper = statueParts(true);
  for (const p of [guard, keeper]) bin.add(p.body), bin.add(p.head), bin.add(p.eyes);
  const eyeG = glowVc(3.4);
  const eyeK = glowVc(3.2);
  bin.add(eyeG.material);
  bin.add(eyeK.material);

  const place = (p: typeof guard, x: number, z: number, yaw: number, scale: number, shadows: boolean, eyesMat: ReturnType<typeof glowVc>) => {
    const y = terrainHeight(x, z);
    const root = new THREE.Group();
    root.position.set(x, y - 0.05, z);
    root.rotation.y = yaw;
    root.scale.setScalar(scale);
    const body = new THREE.Mesh(p.body, mat);
    body.castShadow = shadows;
    body.receiveShadow = true;
    root.add(body);
    const head = new THREE.Group();
    head.position.set(...p.headPos);
    const hm = new THREE.Mesh(p.head, mat);
    hm.castShadow = shadows;
    hm.receiveShadow = true;
    head.add(hm);
    const em = new THREE.Mesh(p.eyes, eyesMat.material);
    head.add(em);
    root.add(head);
    g.add(root);
    return { root, head };
  };
  // near pair flanking the channel, far pair guarding the gate
  place(guard, -10.4, -17, Math.PI / 2 - 0.55, 1.0, true, eyeG);
  place(guard, 10.4, -17, -Math.PI / 2 + 0.55, 1.0, true, eyeG);
  place(guard, -10.2, -41, Math.PI / 2 - 0.35, 1.55, false, eyeG);
  place(guard, 10.2, -41, -Math.PI / 2 + 0.35, 1.55, false, eyeG);
  // Temple Keeper on the sanctuary terrace
  const kp = place(keeper, 21.5, -2.5, -Math.PI / 2 + 0.5, 1.15, true, eyeK);

  // braziers flanking the keeper + steps
  const stepGeo = build([[box(1, 1, 1), S('#ffffff', 0.9)]]);
  bin.add(stepGeo);
  const stepMs: THREE.Matrix4[] = [];
  const stepCs: THREE.Color[] = [];
  for (let i = 0; i < 4; i++) {
    stepMs.push(mtx(17.2 - i * 0.0, 0.5 + i * 0.4 - 0.05, -2.5, 0, [1.6 + 0.0, 0.9, 12 - i * 0.0]));
    stepCs.push(col('#a9a48a').multiplyScalar(0.9 - i * 0.05));
  }
  void stepMs;
  void stepCs;
  const rand = rng(31);
  void rand;

  const baseEye = 3.4;
  return {
    obj: g,
    update(_dt, t) {
      // slow head turn of the keeper: sweeps from the channel to the sky and back
      kp.head.rotation.y = Math.sin(t * 0.21) * 0.55 + Math.sin(t * 0.09 + 1.0) * 0.25;
      kp.head.rotation.x = Math.sin(t * 0.17 + 0.6) * 0.07;
      eyeK.k.value = 2.6 + Math.sin(t * 0.9) * 0.9 + 0.5 * Math.max(0, Math.sin(t * 0.21 * 2));
      eyeG.k.value = baseEye + Math.sin(t * 1.3) * 0.5 + quality.density * 0.0;
    },
  };
}

// ───────────────────────── colonnades, arches, temples ─────────────────────────

function pillarGeo(kind: 'intact' | 'broken' | 'stub', seed: number): Geo {
  const P: Part[] = [];
  const stone = '#9aa38c';
  const stone2 = '#7c8674';
  const h = kind === 'intact' ? 6.2 : kind === 'broken' ? 3.1 : 1.0;
  P.push([rbox(1.9, 0.5, 1.9, 0.08, 2), S(stone2, 0.9), { p: [0, 0.25, 0] }]);
  P.push([torus(0.72, 0.1, Math.PI * 2, 20, 6), S(stone, 0.85), { p: [0, 0.62, 0], r: [Math.PI / 2, 0, 0] }]);
  P.push([cyl(0.56, 0.64, h, 18), S(stone, 0.88), { p: [0, 0.5 + h / 2, 0] }]);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    P.push([segment([Math.sin(a) * 0.62, 0.7, Math.cos(a) * 0.62], [Math.sin(a) * 0.55, 0.5 + h - 0.1, Math.cos(a) * 0.55], 0.045, 0.045, S(stone2, 0.9), 4)]);
  }
  if (kind === 'intact') {
    P.push([torus(0.6, 0.06, Math.PI * 2, 18, 5), S('#d6a640', 0.3, 0.9), { p: [0, 1.6, 0], r: [Math.PI / 2, 0, 0] }]);
    P.push([torus(0.6, 0.085, Math.PI * 2, 18, 5), S('#54f0da', 0.25, 0, 2.2), { p: [0, 4.3, 0], r: [Math.PI / 2, 0, 0] }]);
    P.push([torus(0.58, 0.06, Math.PI * 2, 18, 5), S('#d6a640', 0.3, 0.9), { p: [0, 5.5, 0], r: [Math.PI / 2, 0, 0] }]);
    P.push([cyl(0.66, 1.0, 0.55, 18), S(stone, 0.85), { p: [0, 6.95, 0] }]);
    P.push([rbox(2.1, 0.4, 2.1, 0.08), S(stone2, 0.88), { p: [0, 7.4, 0] }]);
  } else if (kind === 'broken') {
    P.push([torus(0.6, 0.06, Math.PI * 2, 18, 5), S('#d6a640', 0.3, 0.9), { p: [0, 1.5, 0], r: [Math.PI / 2, 0, 0] }]);
    P.push([torus(0.6, 0.06, Math.PI * 1.4, 18, 5), S('#54f0da', 0.25, 0, 1.4), { p: [0, 2.6, 0], r: [Math.PI / 2, 0, 1.0] }]);
    // jagged break
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + seed;
      P.push([rbox(0.4, 0.5 + (i % 2) * 0.35, 0.36, 0.05), S(stone, 0.9), { p: [Math.sin(a) * 0.3, 0.5 + h + 0.15, Math.cos(a) * 0.3], r: [Math.sin(a) * 0.4, a, Math.cos(a) * 0.3] }]);
    }
  }
  return weather(build(P), seed, '#4d7d38', kind === 'intact' ? 2.4 : 3.4, kind === 'intact' ? 0.5 : 0.7, 0.22);
}

function archGeo(broken: boolean): Geo {
  const P: Part[] = [];
  const stone = '#9aa38c';
  const stone2 = '#7c8674';
  for (const s of [-1, 1]) {
    P.push([rbox(1.9, 0.6, 2.4, 0.1), S(stone2, 0.9), { p: [s * 3.4, 0.3, 0] }]);
    const top = broken && s > 0 ? 3.4 : 5.0;
    P.push([rbox(1.5, top, 1.9, 0.1), S(stone, 0.88), { p: [s * 3.4, 0.6 + top / 2, 0] }]);
    if (!(broken && s > 0)) P.push([rbox(1.7, 0.4, 2.1, 0.06), S('#d6a640', 0.35, 0.8), { p: [s * 3.4, 5.6, 0] }]);
  }
  P.push([torus(3.4, 0.75, broken ? Math.PI * 0.62 : Math.PI, 26, 8), S(stone, 0.88), { p: [0, 5.6, 0], s: [1, 1, 1.25], r: [0, 0, broken ? Math.PI * 0.38 : 0] }]);
  if (!broken) {
    P.push([rbox(1.0, 1.1, 1.7, 0.1), S('#d6a640', 0.3, 0.85), { p: [0, 9.3, 0] }]);
    P.push([ellipsoid(0.32, 0.36, 0.18, 12, 10), S('#54f0da', 0.15, 0, 2.6), { p: [0, 9.3, 0.9] }]);
  }
  // rubble
  for (let i = 0; i < 6; i++) P.push([rbox(0.6 + (i % 3) * 0.3, 0.4, 0.6, 0.08), S(stone2, 0.95), { p: [(i - 2.5) * 0.9, 0.2, 2.0 + (i % 2) * 0.5], r: [0.2 * i, i, 0.1] }]);
  return weather(build(P), broken ? 2 : 4, '#4d7d38', 3.2, 0.6, 0.24);
}

function ziggurat(size: number): Geo {
  const P: Part[] = [];
  let y = 0;
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const s = size * (1 - i * 0.17);
    const h = 3.4;
    P.push([rbox(s, h, s, 0.15, 1), S(i % 2 ? '#7f8a78' : '#9aa38c', 0.9), { p: [0, y + h / 2, 0] }]);
    P.push([rbox(s + 0.5, 0.35, s + 0.5, 0.08, 1), S('#66705f', 0.9), { p: [0, y + h, 0] }]);
    // glowing window strip on the front (toward +z) and corners
    const n = Math.max(2, Math.floor(s / 3.2));
    for (let k = 0; k < n; k++) {
      const xx = (k - (n - 1) / 2) * (s / n);
      P.push([rbox(0.7, 1.6, 0.12, 0.04), S(i % 2 ? '#ffb45a' : '#5ff2e0', 0.2, 0, 2.4), { p: [xx, y + h * 0.5, s / 2 + 0.04] }]);
      P.push([rbox(0.12, 1.6, 0.7, 0.04), S(i % 2 ? '#ffb45a' : '#5ff2e0', 0.2, 0, 2.4), { p: [s / 2 + 0.04, y + h * 0.5, xx] }]);
      P.push([rbox(0.12, 1.6, 0.7, 0.04), S(i % 2 ? '#ffb45a' : '#5ff2e0', 0.2, 0, 2.4), { p: [-s / 2 - 0.04, y + h * 0.5, xx] }]);
    }
    y += h + 0.35;
  }
  // shrine and beacon on top
  P.push([rbox(size * 0.24, 2.6, size * 0.24, 0.12), S('#9aa38c', 0.85), { p: [0, y + 1.3, 0] }]);
  P.push([cone(size * 0.2, 2.2, 4), S('#d6a640', 0.3, 0.85), { p: [0, y + 3.7, 0], r: [0, Math.PI / 4, 0] }]);
  P.push([ellipsoid(0.7, 0.9, 0.7, 12, 10), S('#ffcf7a', 0.2, 0, 3), { p: [0, y + 5.4, 0] }]);
  // central stair
  for (let i = 0; i < 16; i++) P.push([rbox(size * 0.22, 0.3, 1.0, 0.04, 1), S('#b5af96', 0.9), { p: [0, 0.15 + i * 1.15 * 0.5 * (y / 18), size / 2 + 1.6 - i * 0.62 * (size / 16) * 0.5], r: [0, 0, 0] }]);
  return weather(build(P), 7, '#4d7d38', 6, 0.55, 0.22);
}

function gateParts(): Geo {
  const P: Part[] = [];
  const stone = '#9a947e';
  const stone2 = '#7f7b68';
  for (const s of [-1, 1]) {
    // pylon: square frustum
    const pyl = new THREE.CylinderGeometry(4.4, 6.4, 22, 4, 1);
    P.push([pyl, S(stone, 0.9), { p: [s * 12.5, 11, 0], r: [0, Math.PI / 4, 0], s: [1.15, 1, 0.95] }]);
    for (let k = 0; k < 4; k++) P.push([rbox(10.2 - k * 0.9, 0.5, 8.2 - k * 0.7, 0.1), S(stone2, 0.9), { p: [s * 12.5, 4 + k * 5, 0] }]);
    P.push([rbox(11.2, 1.4, 9.0, 0.2), S('#d6a640', 0.35, 0.8), { p: [s * 12.5, 22.4, 0] }]);
    // carved glowing glyph columns on the inner face
    for (let k = 0; k < 6; k++) P.push([rbox(0.5, 1.5, 0.15, 0.05), S(k % 2 ? '#5ff2e0' : '#ffb45a', 0.2, 0, 2.6), { p: [s * 7.6, 5 + k * 2.4, 3.2] }]);
  }
  P.push([rbox(24, 3.6, 7.5, 0.3), S(stone, 0.88), { p: [0, 17.2, 0] }]);
  P.push([rbox(25, 0.8, 8.0, 0.2), S('#d6a640', 0.35, 0.8), { p: [0, 19.4, 0] }]);
  for (let k = 0; k < 9; k++) P.push([rbox(1.2, 0.5, 0.15, 0.05), S(k % 2 ? '#5ff2e0' : '#ffb45a', 0.2, 0, 2.6), { p: [(k - 4) * 2.4, 17.2, 3.85] }]);
  // sun disc
  P.push([torus(2.6, 0.32, Math.PI * 2, 36, 8), S('#d6a640', 0.3, 0.9, 0.4), { p: [0, 22.8, 0.4] }]);
  P.push([cyl(2.1, 2.1, 0.3, 32), S('#ffbe62', 0.2, 0, 2.6), { p: [0, 22.8, 0.4], r: [Math.PI / 2, 0, 0] }]);
  return weather(build(P), 12, '#4d7d38', 5, 0.6, 0.22);
}

function drumGeo(): Geo {
  return weather(build([[cyl(0.62, 0.62, 1.5, 14), S('#9aa38c', 0.9), { r: [0, 0, Math.PI / 2] }], [torus(0.63, 0.06, Math.PI * 2, 14, 5), S('#7c8674', 0.9), { p: [0.45, 0, 0], r: [0, Math.PI / 2, 0] }]]), 3, '#4d7d38', 0.6, 0.5, 0.2);
}

export function buildRuins(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'ruins';
  const r = rng(101);
  const mat = bin.add(vcMaterial());
  const dens = quality.density;
  // colonnades
  const geoI = pillarGeo('intact', 1);
  const geoB = pillarGeo('broken', 2);
  const geoS = pillarGeo('stub', 3);
  bin.add(geoI), bin.add(geoB), bin.add(geoS);
  const mI: THREE.Matrix4[] = [];
  const mB: THREE.Matrix4[] = [];
  const mS: THREE.Matrix4[] = [];
  const cI: THREE.Color[] = [];
  const cB: THREE.Color[] = [];
  const cS: THREE.Color[] = [];
  const zs = [-46, -39, -32, -25, -18, -11, -4, 4, 11, 18, 25];
  zs.forEach((z, i) => {
    // side 0 (ruin quay) – mostly broken; side 1 (sanctuary) – intact
    const x0 = -14.2 + (r() - 0.5) * 0.3;
    const rr = r();
    const y0 = terrainHeight(x0, z);
    const tint = col('#ffffff').multiplyScalar(0.85 + r() * 0.2);
    if (rr < 0.28) {
      mI.push(mtx(x0, y0, z, r() * 6, 1));
      cI.push(tint);
    } else if (rr < 0.72) {
      mB.push(mtx(x0, y0, z, r() * 6, 1));
      cB.push(tint);
    } else {
      mS.push(mtx(x0, y0, z, r() * 6, 1));
      cS.push(tint);
    }
    if (Math.abs(z) > 8 || i % 2 === 0) {
      const x1 = 14.4;
      mI.push(mtx(x1, terrainHeight(x1, z), z, 0, 1));
      cI.push(col('#ffffff').multiplyScalar(0.95 + r() * 0.08));
    }
  });
  // second rank further out on the terrace
  for (const z of [-36, -22, -8, 8, 22]) {
    const x0 = -19.5;
    mB.push(mtx(x0, terrainHeight(x0, z), z, r() * 6, 1.15));
    cB.push(col('#ffffff').multiplyScalar(0.8));
    const x1 = 19.5;
    if (z < -12 || z > 10) {
      mI.push(mtx(x1, terrainHeight(x1, z), z, 0, 1.15));
      cI.push(col('#ffffff'));
    }
  }
  const pI = instanced(geoI, mat, mI, cI, true);
  const pB = instanced(geoB, mat, mB, cB, true);
  const pS = instanced(geoS, mat, mS, cS, false);
  g.add(pI, pB, pS);

  // fallen drums & blocks
  const dg = drumGeo();
  bin.add(dg);
  const dm: THREE.Matrix4[] = [];
  const dc: THREE.Color[] = [];
  const nd = Math.round(26 * dens);
  for (let i = 0; i < nd; i++) {
    const side = r() < 0.65 ? -1 : 1;
    const x = side * (9 + r() * 12);
    const z = -44 + r() * 62;
    if (Math.abs(x) < 12.6 && Math.abs(z) < 6.5) continue;
    dm.push(mtx(x, terrainHeight(x, z) + 0.55, z, r() * 6, 0.8 + r() * 0.5, 0, (r() - 0.5) * 0.3));
    dc.push(col('#ffffff').multiplyScalar(0.7 + r() * 0.3));
  }
  g.add(instanced(dg, mat, dm, dc, false));

  // arches
  const ab = archGeo(true);
  const ai = archGeo(false);
  bin.add(ab), bin.add(ai);
  const a1 = new THREE.Mesh(ab, mat);
  a1.position.set(-22, terrainHeight(-22, -12) - 0.1, -12);
  a1.rotation.y = Math.PI / 2;
  a1.castShadow = true;
  const a2 = new THREE.Mesh(ai, mat);
  a2.position.set(16.6, terrainHeight(16.6, 6.5), 6.5);
  a2.rotation.y = Math.PI / 2;
  a2.scale.setScalar(0.9);
  a2.castShadow = true;
  const a3 = new THREE.Mesh(ab, mat);
  a3.position.set(-16, terrainHeight(-16, -30), -30);
  a3.rotation.y = Math.PI / 2 + 0.2;
  a3.scale.setScalar(1.15);
  g.add(a1, a2, a3);

  // ziggurats in the background
  const zg = ziggurat(16);
  const zg2 = ziggurat(20);
  bin.add(zg), bin.add(zg2);
  const z1 = new THREE.Mesh(zg, mat);
  z1.position.set(-29, terrainHeight(-29, -42) - 0.6, -42);
  z1.rotation.y = 0.5;
  const z2 = new THREE.Mesh(zg2, mat);
  z2.position.set(31, terrainHeight(31, -58) - 0.6, -58);
  z2.rotation.y = -0.35;
  const z3 = new THREE.Mesh(zg, mat);
  z3.position.set(27, terrainHeight(27, 14) - 0.6, 14);
  z3.rotation.y = -0.2;
  z3.scale.setScalar(0.8);
  g.add(z1, z2, z3);

  // temple gate at the end of the gorge
  const gg = gateParts();
  bin.add(gg);
  const gate = new THREE.Mesh(gg, mat);
  gate.position.set(0, 0.5, -49);
  gate.castShadow = false;
  g.add(gate);

  // glyph stones (slab + pulsing glyph inscriptions)
  const slab = weather(build([[rbox(1.1, 2.3, 0.4, 0.14), S('#7f8a78', 0.9), { p: [0, 1.15, 0] }], [cyl(0.55, 0.55, 0.4, 14, false), S('#7f8a78', 0.9), { p: [0, 2.3, 0], r: [Math.PI / 2, 0, 0] }]]), 6, '#4d7d38', 1.0, 0.6, 0.2);
  const gl: Part[] = [];
  for (let i = 0; i < 5; i++) gl.push([rbox(0.5 - (i % 2) * 0.2, 0.06, 0.05, 0.02), S(i % 2 ? '#5ff2e0' : '#ffb45a', 0.2, 0, 1.0), { p: [(i % 2) * 0.05, 0.6 + i * 0.32, 0.22] }]);
  gl.push([torus(0.2, 0.03, Math.PI * 1.7, 14, 5), S('#5ff2e0', 0.2, 0, 1.0), { p: [0, 2.05, 0.22] }]);
  const glyph = build(gl);
  bin.add(slab), bin.add(glyph);
  const gm: THREE.Matrix4[] = [];
  const spots: Array<[number, number, number]> = [[-12.8, 9.5, 0.6], [-12.4, -10.4, 0.8], [-17, 4, 1.2], [-16, -22, 0.4], [12.6, 9.8, -0.6], [12.8, -10.6, -0.9], [16.5, -7, -1.4], [15.8, -20, -0.5], [-11, 14, 0.2], [11.5, 15, -0.3]];
  for (const [x, z, ry] of spots) gm.push(mtx(x, terrainHeight(x, z), z, ry + (x < 0 ? Math.PI / 2 : -Math.PI / 2), 1));
  g.add(instanced(slab, mat, gm, undefined, true));
  const glowM = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
  glowM.colorNode = vertexColor().rgb.mul(sin(time.mul(1.4).add(hash(instanceIndex.toFloat()).mul(6.283))).mul(0.8).add(1.9));
  bin.add(glowM);
  g.add(instanced(glyph, glowM, gm));
  bin.add(mat);
  return { obj: g };
}

// ───────────────────────── torches ─────────────────────────

export function buildTorches(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'torches';
  const mat = bin.add(vcMaterial());
  const post = weather(build([
    [cyl(0.15, 0.2, 1.7, 10), S('#7f8a78', 0.9), { p: [0, 0.85, 0] }],
    [lathe([[0.05, 0], [0.3, 0.08], [0.36, 0.28], [0.26, 0.4], [0.05, 0.42]], 14, 10), S('#a87432', 0.35, 0.85), { p: [0, 1.62, 0] }],
    [torus(0.34, 0.035, Math.PI * 2, 14, 5), S('#d6a640', 0.3, 0.9), { p: [0, 1.92, 0], r: [Math.PI / 2, 0, 0] }],
    [ellipsoid(0.24, 0.1, 0.24, 10, 6), S('#ff7a20', 0.4, 0, 2.0), { p: [0, 1.95, 0] }],
  ]), 8, '#4d7d38', 0.6, 0.5, 0.15);
  bin.add(post);
  const pos: Array<[number, number, number]> = [
    [7.4, 0.5, 2.7], [-7.4, 0.5, 2.7], [7.4, 0.5, -2.7], [-7.4, 0.5, -2.7],
    [12.2, 0.5, 7.5], [-12.2, 0.5, 7.5], [12.2, 0.5, -8], [-12.2, 0.5, -8],
    [12.5, 0.5, -20], [-12.5, 0.5, -20], [12.5, 0.5, -30], [-12.5, 0.5, -30],
    [12.4, 0.5, 14], [-12.4, 0.5, 14], [7.2, 0.5, -12.5], [-7.2, 0.5, -12.5],
  ];
  const pm = pos.map(([x, , z]) => mtx(x, terrainHeight(x, z), z, 0, 1));
  g.add(instanced(post, mat, pm, undefined, false));
  const fl = flameMaterial('#fff0b0', '#ff5a10', 3.0);
  const fg = flameGeometry(0.5, 0.86);
  bin.add(fl.material), bin.add(fg);
  const fm = pos.map(([x, , z]) => mtx(x, terrainHeight(x, z) + 1.95, z, 0, 1));
  const flames = instanced(fg, fl.material, fm);
  flames.frustumCulled = false;
  flames.renderOrder = 5;
  g.add(flames);
  // embers rising from the braziers
  const emb = createParticles({ count: 90, min: [-14, 0.6, -14], max: [14, 6, 14], color: '#ff9a3a', color2: '#ffd27a', size: 0.075, motion: 'rise', speed: 0.7, wind: [0.15, -0.05], twinkle: 0.6, quality });
  g.add(emb);
  const emb2 = createParticles({ count: 60, min: [-14, 0.6, -46], max: [14, 8, -16], color: '#ff8a3a', color2: '#ffc060', size: 0.09, motion: 'rise', speed: 0.6, wind: [0.1, 0], twinkle: 0.6, quality });
  g.add(emb2);

  // dynamic torch lights (budget from quality; one is reserved for the barge)
  const budget = Math.max(0, Math.min(5, quality.localLights - 1));
  const lights: THREE.PointLight[] = [];
  const order = [0, 1, 2, 3, 4, 5].slice(0, budget);
  for (const idx of order) {
    const p = pos[idx]!;
    const l = new THREE.PointLight(0xff9a4a, 9, 13, 2);
    l.position.set(p[0], terrainHeight(p[0], p[2]) + 2.2, p[2]);
    g.add(l);
    lights.push(l);
  }
  void ss;
  return {
    obj: g,
    update(_dt, t) {
      fl.k.value = 2.8 + Math.sin(t * 9) * 0.25;
      lights.forEach((l, i) => {
        l.intensity = 8 + Math.sin(t * 11 + i * 2.3) * 1.4 + Math.sin(t * 5.7 + i) * 1.1 + Math.sin(t * 23 + i * 7) * 0.5;
      });
    },
  };
}
