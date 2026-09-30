import * as THREE from 'three/webgpu';
import { Fn, color, hash, instanceIndex, length, mix, normalWorld, positionGeometry, positionLocal, sin, smoothstep, time, uv, vec2 } from 'three/tsl';
import type { QualityPreset } from '../../render/quality';
import { lightShaft, rockGeometry, rng } from '../../world/kit';
import { bake, merge } from '../../characters/geo';
import { Parts, clothMaterial, fillInstances, glowUniformMat, propMaterial, starBannerColor, stripeClothColor, sunBannerColor, triangleFlag, tmpObj } from './helpers';
import { ISLAND_A, ISLAND_B, islandParts, islandTopAt, insideIsland, rimAt, type IslandSpec } from './islands';
import { buildAirship, type Airship } from './airships';
import { buildBellTower, buildKiosk, buildLighthouse, buildObservatory, buildStatue, buildSunTemple, buildVillage, type Built } from './buildings';

export interface Scenery {
  update(dt: number, t: number, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

type Updater = (dt: number, t: number, camera: THREE.PerspectiveCamera) => void;

/** Vegetation material: vertex-coloured PBR with height-based wind sway and per-instance phase. */
function swayMaterial(amp: number, height: number): THREE.MeshStandardNodeMaterial {
  const m = propMaterial();
  const ph = hash(instanceIndex.toFloat().add(11.3)).mul(6.28);
  m.positionNode = Fn(() => {
    const p = positionLocal.toVar();
    const h = positionGeometry.y.div(height).clamp(0, 1);
    const w = sin(time.mul(1.4).add(ph)).mul(amp).mul(h.mul(h));
    p.x.addAssign(w);
    p.z.addAssign(w.mul(0.4));
    return p;
  })();
  return m;
}

function catenary(a: THREE.Vector3, b: THREE.Vector3, t: number, sag: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.lerpVectors(a, b, t);
  out.y -= sag * 4 * t * (1 - t);
  return out;
}

/** Rope bridge (planks + ropes) in world space. */
function ropeBridge(parts: Parts, a: THREE.Vector3, b: THREE.Vector3, sag: number, width = 1.3): void {
  const dist = a.distanceTo(b);
  const n = Math.max(6, Math.floor(dist / 0.55));
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const side = new THREE.Vector3();
  const upV = new THREE.Vector3(0, 1, 0);
  const upN = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const railL: THREE.Vector3[] = [];
  const railR: THREE.Vector3[] = [];
  const lowL: THREE.Vector3[] = [];
  const lowR: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    catenary(a, b, t, sag, p0);
    catenary(a, b, Math.min(1, t + 0.01), sag, p1);
    fwd.subVectors(p1, p0);
    if (fwd.lengthSq() < 1e-8) fwd.subVectors(b, a);
    fwd.normalize();
    side.crossVectors(upV, fwd).normalize();
    upN.crossVectors(fwd, side).normalize();
    if (i < n) {
      m.makeBasis(side, upN, fwd).setPosition(p0);
      parts.add(new THREE.BoxGeometry(width, 0.07, 0.42), { color: i % 2 ? '#8a5a34' : '#7a4c2c', rough: 0.88 }, m.clone());
    }
    railL.push(p0.clone().addScaledVector(side, width * 0.5).addScaledVector(upN, 1.05));
    railR.push(p0.clone().addScaledVector(side, -width * 0.5).addScaledVector(upN, 1.05));
    lowL.push(p0.clone().addScaledVector(side, width * 0.5).addScaledVector(upN, -0.02));
    lowR.push(p0.clone().addScaledVector(side, -width * 0.5).addScaledVector(upN, -0.02));
    if (i % 3 === 0 && i < n) {
      for (const [hi, lo] of [[railL[i]!, lowL[i]!], [railR[i]!, lowR[i]!]] as Array<[THREE.Vector3, THREE.Vector3]>) {
        parts.add(new THREE.CylinderGeometry(0.014, 0.014, hi.distanceTo(lo), 4), { color: '#c9b078', rough: 0.95 }, new THREE.Matrix4().makeTranslation((hi.x + lo.x) / 2, (hi.y + lo.y) / 2, (hi.z + lo.z) / 2));
      }
    }
  }
  const rope = (pts: THREE.Vector3[], r: number, col: string) => parts.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, r, 5, false), { color: col, rough: 0.95 });
  rope(railL, 0.03, '#d8c28a');
  rope(railR, 0.03, '#d8c28a');
  rope(lowL, 0.028, '#b8a070');
  rope(lowR, 0.028, '#b8a070');
  for (const p of [a, b]) {
    for (const sgn of [1, -1]) {
      parts.add(new THREE.CylinderGeometry(0.07, 0.09, 1.7, 8), { color: '#4d321d', rough: 0.85 }, new THREE.Matrix4().makeTranslation(p.x + (p === a ? 0 : 0), p.y + 0.75, p.z + sgn * width * 0.55 * 0));
      void sgn;
    }
  }
}

function edgePoint(s: IslandSpec, phi: number, k = 0.93): THREE.Vector3 {
  const r = rimAt(s, phi) * k;
  const x = s.cx + Math.cos(phi) * r;
  const z = s.cz + Math.sin(phi) * r;
  return new THREE.Vector3(x, islandTopAt(s, x, z), z);
}

export async function buildScenery(scene: THREE.Scene, quality: QualityPreset, worldMat: THREE.MeshStandardNodeMaterial): Promise<Scenery> {
  const disposables: Array<{ dispose(): void }> = [];
  const updaters: Updater[] = [];
  const track = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };
  const dens = quality.density;
  const isLow = quality.level === 'low';
  const rnd = rng(4242);
  const island = (s: IslandSpec, x: number, z: number) => new THREE.Vector3(x, islandTopAt(s, x, z), z);

  // ───────────────────────── temples & landmarks ─────────────────────────
  const place = (b: Built, pos: THREE.Vector3, yaw = 0, scale = 1, sink = 0.35) => {
    b.group.position.copy(pos).add(new THREE.Vector3(0, -sink, 0));
    b.group.rotation.y = yaw;
    b.group.scale.multiplyScalar(scale);
    scene.add(b.group);
    b.geos.forEach(track);
    return b;
  };
  // Sun island (left)
  const tPos = island(ISLAND_A, ISLAND_A.cx + 6.2, ISLAND_A.cz - 7.6);
  const temple = place(buildSunTemple(worldMat), new THREE.Vector3(tPos.x, tPos.y + 0.05, tPos.z), Math.atan2(-6.5 - tPos.x + 0, 6.0 - tPos.z) * 0 + 0.55, 0.78, 0.3);
  void temple;
  place(buildBellTower(worldMat), island(ISLAND_A, ISLAND_A.cx - 6.5, ISLAND_A.cz - 1.5), 0.3, 0.9);
  place(buildKiosk(worldMat, 1.4, true), island(ISLAND_A, ISLAND_A.cx + 1.5, ISLAND_A.cz + 6.8), 0.4, 0.95, 0.15);
  place(buildKiosk(worldMat, 1.2, true), island(ISLAND_A, ISLAND_A.cx - 4.5, ISLAND_A.cz + 5.2), 1.0, 0.85, 0.15);
  // Star island (right)
  const crystalGlow = glowUniformMat('#c8a8ff', 3.4);
  track(crystalGlow.material);
  const lh = buildLighthouse(worldMat, crystalGlow.material);
  const lhPos = island(ISLAND_B, ISLAND_B.cx - 6.2, ISLAND_B.cz - 7.0);
  place(lh, lhPos, 0, 0.82, 0.5);
  place(buildObservatory(worldMat), island(ISLAND_B, ISLAND_B.cx + 1.5, ISLAND_B.cz - 8.5), -0.5, 0.85, 0.3);
  place(buildKiosk(worldMat, 1.4, false), island(ISLAND_B, ISLAND_B.cx - 1.5, ISLAND_B.cz + 6.6), -0.4, 0.95, 0.15);
  place(buildKiosk(worldMat, 1.2, false), island(ISLAND_B, ISLAND_B.cx + 4.2, ISLAND_B.cz + 5.0), 0.7, 0.85, 0.15);
  // lighthouse beams
  const beamMat: THREE.Material[] = [];
  for (let i = 0; i < 2; i++) {
    const sh = lightShaft('#d9c4ff', 30, 0.35, 3.2, 0.3);
    sh.rotation.z = Math.PI / 2;
    sh.rotation.y = i * Math.PI;
    sh.position.y = 0;
    lh.beams.add(sh);
    track(sh.geometry);
    beamMat.push(sh.material as THREE.Material);
  }
  beamMat.forEach(track);
  const lhLight = quality.localLights >= 4 ? new THREE.PointLight('#b58cff', 40, 22, 2) : null;
  if (lhLight) {
    lhLight.position.set(lhPos.x, lhPos.y + 12.6, lhPos.z);
    scene.add(lhLight);
  }
  updaters.push((_dt, t) => {
    lh.beams.rotation.y = t * 0.55;
    lh.crystal.rotation.y = t * 1.2;
    lh.crystal.position.y = 14.4 + Math.sin(t * 1.3) * 0.08;
    crystalGlow.k.value = 1 + Math.sin(t * 2.2) * 0.25;
    if (lhLight) lhLight.intensity = 40 * (1 + Math.sin(t * 2.2) * 0.2);
  });

  // ───────────────────────── vegetation, rocks, flowers ─────────────────────────
  const swayTree = track(swayMaterial(0.09, 4));
  const cyprG = (() => {
    const p = new Parts();
    p.add(new THREE.CylinderGeometry(0.07, 0.12, 0.9, 6), { color: '#5a3d2a', rough: 0.9 }, { p: [0, 0.45, 0] });
    p.add(new THREE.ConeGeometry(0.62, 1.7, 9), { color: '#2f6e4a', rough: 0.85 }, { p: [0, 1.25, 0] });
    p.add(new THREE.ConeGeometry(0.5, 1.5, 9), { color: '#3a8256', rough: 0.85 }, { p: [0, 2.15, 0] });
    p.add(new THREE.ConeGeometry(0.34, 1.2, 9), { color: '#4a9a62', rough: 0.85 }, { p: [0, 3.0, 0] });
    return track(p.build());
  })();
  const roundG = (() => {
    const p = new Parts();
    p.add(new THREE.CylinderGeometry(0.1, 0.16, 1.5, 6), { color: '#6a4a30', rough: 0.9 }, { p: [0, 0.75, 0] });
    p.add(new THREE.IcosahedronGeometry(1.0, 1), { color: '#79b04e', rough: 0.8 }, { p: [0, 2.0, 0], s: [1, 0.85, 1] });
    p.add(new THREE.IcosahedronGeometry(0.75, 1), { color: '#a2c85a', rough: 0.8 }, { p: [0.55, 2.55, 0.2] });
    p.add(new THREE.IcosahedronGeometry(0.7, 1), { color: '#5f9a42', rough: 0.8 }, { p: [-0.5, 2.3, -0.3] });
    return track(p.build());
  })();
  const treeSpots = { cyp: [] as Array<{ p: [number, number, number]; s: number; c: THREE.ColorRepresentation }>, rnd: [] as Array<{ p: [number, number, number]; s: number; c: THREE.ColorRepresentation }> };
  const scatter = (s: IslandSpec, n: number, avoid: (x: number, z: number) => boolean, into: typeof treeSpots.cyp, minS: number, maxS: number, cols: string[], margin = 0.8) => {
    let tries = 0;
    while (into.length < n && tries++ < n * 40) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * s.radius * margin;
      const x = s.cx + Math.cos(a) * r;
      const z = s.cz + Math.sin(a) * r;
      if (!insideIsland(s, x, z, margin) || avoid(x, z)) continue;
      into.push({ p: [x, islandTopAt(s, x, z) - 0.05, z], s: minS + rnd() * (maxS - minS), c: cols[Math.floor(rnd() * cols.length)]! });
    }
  };
  const avoidA = (x: number, z: number) =>
    (Math.abs(z - 0) < 4.6 && x > ISLAND_A.cx + 4) || Math.hypot(x - (ISLAND_A.cx + 6.2), z - (ISLAND_A.cz - 7.6)) < 6.2 || Math.hypot(x - (ISLAND_A.cx - 6.5), z - (ISLAND_A.cz - 1.5)) < 2.6 || Math.hypot(x - (ISLAND_A.cx + 1.5), z - (ISLAND_A.cz + 6.8)) < 2.6 || Math.hypot(x - (ISLAND_A.cx - 4.5), z - (ISLAND_A.cz + 5.2)) < 2.4;
  const avoidB = (x: number, z: number) =>
    (Math.abs(z - 0) < 4.6 && x < ISLAND_B.cx - 4) || Math.hypot(x - (ISLAND_B.cx - 6.2), z - (ISLAND_B.cz - 7.0)) < 3.4 || Math.hypot(x - (ISLAND_B.cx + 1.5), z - (ISLAND_B.cz - 8.5)) < 3.6 || Math.hypot(x - (ISLAND_B.cx - 1.5), z - (ISLAND_B.cz + 6.6)) < 2.6 || Math.hypot(x - (ISLAND_B.cx + 4.2), z - (ISLAND_B.cz + 5.0)) < 2.4;
  const nCyp = Math.round(16 * dens);
  const nRnd = Math.round(14 * dens);
  scatter(ISLAND_A, nCyp, avoidA, treeSpots.cyp, 0.8, 1.5, ['#ffffff', '#e6ffe8', '#d8f2df'], 0.86);
  scatter(ISLAND_B, nCyp * 2, avoidB, treeSpots.cyp, 0.8, 1.5, ['#e8e2ff', '#ffffff', '#dcd4f5'], 0.86);
  scatter(ISLAND_A, nRnd, avoidA, treeSpots.rnd, 0.8, 1.35, ['#ffffff', '#f4ffd8', '#ffe9c0'], 0.86);
  scatter(ISLAND_B, nRnd * 2, avoidB, treeSpots.rnd, 0.8, 1.35, ['#f2ffe6', '#ffffff', '#fff0d0'], 0.86);
  const cyp = new THREE.InstancedMesh(cyprG, swayTree, treeSpots.cyp.length);
  fillInstances(cyp, treeSpots.cyp.map((t) => ({ p: t.p, r: [0, rnd() * 6, 0], s: t.s, c: t.c })));
  cyp.castShadow = true;
  cyp.receiveShadow = true;
  scene.add(cyp);
  const rnt = new THREE.InstancedMesh(roundG, swayTree, treeSpots.rnd.length);
  fillInstances(rnt, treeSpots.rnd.map((t) => ({ p: t.p, r: [0, rnd() * 6, 0], s: t.s, c: t.c })));
  rnt.castShadow = true;
  rnt.receiveShadow = true;
  scene.add(rnt);

  // rocks
  const rockG = track(bake(rockGeometry(0.7, 3, 2, 0.75), { color: '#a8927c', rough: 0.95 }));
  const rockItems: Array<{ p: [number, number, number]; s: number; r: [number, number, number]; c: string }> = [];
  for (const sp of [ISLAND_A, ISLAND_B]) {
    for (let i = 0; i < Math.round(14 * dens); i++) {
      const a = rnd() * Math.PI * 2;
      const r = sp.radius * (0.55 + rnd() * 0.36);
      const x = sp.cx + Math.cos(a) * r;
      const z = sp.cz + Math.sin(a) * r;
      if (!insideIsland(sp, x, z, 0.94) || (sp === ISLAND_A ? avoidA(x, z) : avoidB(x, z))) continue;
      rockItems.push({ p: [x, islandTopAt(sp, x, z) + 0.05, z], s: 0.5 + rnd() * 1.1, r: [0, rnd() * 6, 0], c: rnd() > 0.5 ? '#ffffff' : '#d9d0c6' });
    }
  }
  const rocks = new THREE.InstancedMesh(rockG, worldMat, rockItems.length);
  fillInstances(rocks, rockItems);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);

  // flowers (beds near the plazas, temple steps and planters) + grass tufts
  const flowerMat = track(swayMaterial(0.05, 0.8));
  const flowerG = track(new Parts().add(new THREE.IcosahedronGeometry(0.11, 0), { color: '#ffffff', rough: 0.7, emit: 0.25 }, { p: [0, 0.32, 0] }).add(new THREE.CylinderGeometry(0.008, 0.012, 0.32, 4), { color: '#4f8a3a', rough: 0.9 }, { p: [0, 0.16, 0] }).build());
  const flowerCols = ['#ff7aa2', '#ffb347', '#fff0c8', '#c99bff', '#ff6a5a', '#7fd6ff'];
  const flowerItems: Array<{ p: [number, number, number]; s: number; c: string }> = [];
  const beds: Array<{ c: THREE.Vector3; r: number; n: number }> = [];
  beds.push({ c: island(ISLAND_A, ISLAND_A.cx + 9.2, ISLAND_A.cz + 0), r: 1.2, n: 0 });
  const bedSpots: Array<[IslandSpec, number, number]> = [
    [ISLAND_A, ISLAND_A.cx + 8.5, ISLAND_A.cz + 5.2],
    [ISLAND_A, ISLAND_A.cx + 8.5, ISLAND_A.cz - 5.0],
    [ISLAND_A, ISLAND_A.cx - 1.0, ISLAND_A.cz - 1.2],
    [ISLAND_A, ISLAND_A.cx + 5.0, ISLAND_A.cz + 5.6],
    [ISLAND_B, ISLAND_B.cx - 8.5, ISLAND_B.cz + 5.2],
    [ISLAND_B, ISLAND_B.cx - 8.5, ISLAND_B.cz - 5.0],
    [ISLAND_B, ISLAND_B.cx + 1.0, ISLAND_B.cz - 1.2],
    [ISLAND_B, ISLAND_B.cx - 5.0, ISLAND_B.cz + 5.6],
  ];
  for (const [sp, x, z] of bedSpots) {
    const n = Math.round(22 * dens);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 1.5;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (!insideIsland(sp, px, pz, 0.92)) continue;
      flowerItems.push({ p: [px, islandTopAt(sp, px, pz), pz], s: 0.8 + rnd() * 0.8, c: flowerCols[Math.floor(rnd() * flowerCols.length)]! });
    }
  }
  // pier planters (positions fixed by piers.ts)
  for (const side of [-1, 1]) {
    for (const [x, z] of [[8.2, 2.55], [8.2, -2.55], [12.6, 2.55], [12.6, -2.55]] as Array<[number, number]>) {
      for (let i = 0; i < 9; i++) flowerItems.push({ p: [side * x + (rnd() - 0.5) * 0.9, 1.0, z + (rnd() - 0.5) * 0.35], s: 0.9 + rnd() * 0.6, c: flowerCols[Math.floor(rnd() * flowerCols.length)]! });
    }
  }
  const flowers = new THREE.InstancedMesh(flowerG, flowerMat, flowerItems.length);
  fillInstances(flowers, flowerItems);
  scene.add(flowers);

  const grassG = track(new Parts().add(new THREE.ConeGeometry(0.06, 0.5, 4), { color: '#ffffff', rough: 0.9 }, { p: [0, 0.25, 0] }).add(new THREE.ConeGeometry(0.05, 0.4, 4), { color: '#ffffff', rough: 0.9 }, { p: [0.08, 0.2, 0.04], r: [0.2, 0, -0.25] }).build());
  const grassMat = track(swayMaterial(0.12, 0.5));
  const grassItems: Array<{ p: [number, number, number]; s: number; c: string; r: [number, number, number] }> = [];
  const grassCols = ['#8cbc50', '#a4c85a', '#78ac48', '#b8d068'];
  for (const sp of [ISLAND_A, ISLAND_B]) {
    const n = Math.round(230 * dens);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * sp.radius * 0.9;
      const x = sp.cx + Math.cos(a) * r;
      const z = sp.cz + Math.sin(a) * r;
      if (!insideIsland(sp, x, z, 0.93)) continue;
      if (sp === ISLAND_A ? avoidA(x, z) : avoidB(x, z)) continue;
      grassItems.push({ p: [x, islandTopAt(sp, x, z), z], s: 0.9 + rnd() * 1.1, c: grassCols[Math.floor(rnd() * 4)]!, r: [0, rnd() * 6, 0] });
    }
  }
  const grass = new THREE.InstancedMesh(grassG, grassMat, grassItems.length);
  fillInstances(grass, grassItems);
  scene.add(grass);

  // ───────────────────────── background islands ─────────────────────────
  interface BG {
    x: number;
    y: number;
    z: number;
    r: number;
    d: number;
    seed: number;
    village?: boolean;
    crystal?: string;
    tint?: number;
  }
  const bgList: BG[] = [
    { x: -46, y: -3.5, z: -14, r: 9, d: 14, seed: 1.1, village: true, crystal: '#7fd8ff' },
    { x: 47, y: -4.5, z: -18, r: 9.5, d: 15, seed: 2.9, village: true, crystal: '#b98cff' },
    { x: -30, y: -9, z: -34, r: 8, d: 12, seed: 3.3, village: true },
    { x: -8, y: -12, z: -42, r: 6.5, d: 10, seed: 4.6 },
    { x: 16, y: -10.5, z: -38, r: 7.5, d: 12, seed: 5.2, village: true },
    { x: 38, y: -10, z: -36, r: 8.5, d: 13, seed: 6.4 },
    { x: 60, y: -14, z: -56, r: 11, d: 16, seed: 7.7, village: true },
    { x: -62, y: -15, z: -58, r: 12, d: 17, seed: 8.4, village: true },
    { x: 2, y: -16, z: -68, r: 10, d: 15, seed: 9.9, village: true },
    { x: -34, y: -20, z: -78, r: 10, d: 14, seed: 10.6 },
    { x: 30, y: -19, z: -84, r: 11, d: 15, seed: 11.8, village: true },
    { x: 84, y: -22, z: -100, r: 15, d: 20, seed: 12.5 },
    { x: -92, y: -24, z: -108, r: 16, d: 21, seed: 13.3, village: true },
    // high floating rocks (visible when the camera tilts up)
    { x: -24, y: 20, z: -64, r: 4.5, d: 8, seed: 14.1, crystal: '#ffd27f' },
    { x: 34, y: 26, z: -74, r: 5.5, d: 10, seed: 15.2, village: true, crystal: '#ffd27f' },
    { x: 4, y: 16, z: -96, r: 7, d: 11, seed: 16.3, village: true },
    { x: -70, y: 30, z: -110, r: 8, d: 12, seed: 17.7 },
    { x: 66, y: 12, z: -90, r: 6, d: 10, seed: 18.4, village: true },
  ];
  const bgMat = worldMat;
  const villageInst: Array<{ b: Built; bg: BG }> = [];
  const bgTrees: Array<{ p: [number, number, number]; s: number; c: string }> = [];
  bgList.forEach((b, idx) => {
    if (isLow && idx > 11) return;
    const spec: IslandSpec = {
      cx: 0,
      cy: 0,
      cz: 0,
      radius: b.r,
      depth: b.d,
      topY: 0.42,
      seed: b.seed,
      seg: b.r > 9 ? [56, 32] : [40, 24],
      crystal: b.crystal,
      vines: 4,
      grassA: '#9ab866',
      grassB: '#c2c878',
      rockA: '#8d7a80',
      rockB: '#b09a98',
    };
    const parts = new Parts();
    islandParts(spec, parts);
    const g = track(parts.build());
    const mesh = new THREE.Mesh(g, bgMat);
    mesh.position.set(b.x, b.y, b.z);
    scene.add(mesh);
    if (b.village && villageInst.length < 9) {
      const v = buildVillage(worldMat, Math.floor(b.seed * 100), Math.max(0.7, b.r / 9));
      v.group.position.set(b.x + (rnd() - 0.5) * b.r * 0.3, b.y + 0.4, b.z + (rnd() - 0.5) * b.r * 0.3);
      v.group.rotation.y = rnd() * 6;
      scene.add(v.group);
      v.geos.forEach(track);
      villageInst.push({ b: v, bg: b });
    }
    const nt = Math.round(b.r * 1.2 * dens);
    for (let i = 0; i < nt; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * b.r * 0.78;
      bgTrees.push({ p: [b.x + Math.cos(a) * r, b.y + 0.4, b.z + Math.sin(a) * r], s: 1.0 + rnd() * 1.4, c: rnd() > 0.5 ? '#eaffea' : '#ffffff' });
    }
  });
  const bgTreeMesh = new THREE.InstancedMesh(cyprG, swayTree, bgTrees.length);
  fillInstances(bgTreeMesh, bgTrees.map((t) => ({ p: t.p, r: [0, rnd() * 6, 0], s: t.s, c: t.c })));
  scene.add(bgTreeMesh);

  // ───────────────────────── rope bridges ─────────────────────────
  {
    const rp = new Parts();
    const a1 = edgePoint(ISLAND_A, Math.PI - 0.32, 0.92).add(new THREE.Vector3(0, 0.7, 0));
    ropeBridge(rp, a1, new THREE.Vector3(-46 + 8.2, -3.5 + 0.42 + 0.7, -14 + 1.0), 1.1);
    const b1 = edgePoint(ISLAND_B, 0.3, 0.92).add(new THREE.Vector3(0, 0.7, 0));
    ropeBridge(rp, b1, new THREE.Vector3(47 - 8.6, -4.5 + 0.42 + 0.7, -18 + 1.2), 1.1);
    // a bridge between two background islands
    ropeBridge(rp, new THREE.Vector3(-30 + 7.2, -9 + 1.1, -34 + 0.5), new THREE.Vector3(-8 - 5.8, -12 + 1.1, -42), 1.6);
    ropeBridge(rp, new THREE.Vector3(16 + 6.4, -10.5 + 1.1, -38), new THREE.Vector3(38 - 7.4, -10 + 1.1, -36), 1.8);
    const g = track(rp.build());
    const m = new THREE.Mesh(g, worldMat);
    m.castShadow = false;
    scene.add(m);
  }

  // ───────────────────────── banners, sails, pennants ─────────────────────────
  const flagParts = new Parts();
  const mast = (x: number, y: number, z: number, h: number) => {
    flagParts.add(new THREE.CylinderGeometry(0.09, 0.14, h, 8), { color: '#4d321d', rough: 0.8 }, { p: [x, y + h / 2, z] });
    flagParts.add(new THREE.SphereGeometry(0.2, 10, 8), { color: '#f2c14e', rough: 0.2, metal: 1, emit: 0.5 }, { p: [x, y + h + 0.1, z] });
    flagParts.add(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), { color: '#f2c14e', rough: 0.25, metal: 1 }, { p: [x, y + h - 0.4, z + 0.1], r: [Math.PI / 2, 0, 0] });
  };
  const flags: THREE.Mesh[] = [];
  const addFlag = (x: number, y: number, z: number, w: number, h: number, cf: Parameters<typeof clothMaterial>[0]['colorFn'], amp: number, mh: number) => {
    mast(x, y, z, mh);
    const g = track(new THREE.PlaneGeometry(w, h, 30, 14));
    g.translate(w / 2, -h / 2, 0);
    const m = track(clothMaterial({ colorFn: cf, amp, speed: 1.9, flutter: 0.3, emissive: 0.06 }));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x + 0.1, y + mh - 0.2, z + 0.12);
    mesh.castShadow = true;
    scene.add(mesh);
    flags.push(mesh);
  };
  const aMast = island(ISLAND_A, ISLAND_A.cx - 4.8, ISLAND_A.cz + 8.6);
  addFlag(aMast.x, aMast.y - 0.3, aMast.z, 9, 5.6, sunBannerColor('#e8a92e', '#fff0b8', '#7a2c1e'), 0.85, 13.5);
  const aMast2 = island(ISLAND_A, ISLAND_A.cx - 9.5, ISLAND_A.cz + 1.5);
  addFlag(aMast2.x, aMast2.y - 0.3, aMast2.z, 5.5, 3.4, stripeClothColor('#f6e6b8', '#d9862a', 5), 0.6, 9.5);
  const bMast = island(ISLAND_B, ISLAND_B.cx + 5.0, ISLAND_B.cz + 8.6);
  addFlag(bMast.x, bMast.y - 0.3, bMast.z, 9, 5.6, starBannerColor('#4a2f8a', '#f4e9ff', '#d8b04a'), 0.85, 13.5);
  const bMast2 = island(ISLAND_B, ISLAND_B.cx + 9.5, ISLAND_B.cz + 1.5);
  addFlag(bMast2.x, bMast2.y - 0.3, bMast2.z, 5.5, 3.4, stripeClothColor('#cdbcff', '#5a3aa0', 5), 0.6, 9.5);
  // tall gate-poles at the outer end of the piers with big sails
  for (const s of [-1, 1] as const) {
    const px = s * 16.6;
    const y0 = 0.7;
    addFlag(px, y0, 3.5, 6.5, 4.2, s < 0 ? sunBannerColor('#f2c14e', '#7a2c1e', '#fff0b8') : starBannerColor('#7a4fd0', '#ffffff', '#f2c14e'), 0.7, 9.5);
  }
  const flagGeo = track(flagParts.build());
  const flagPoles = new THREE.Mesh(flagGeo, worldMat);
  flagPoles.castShadow = true;
  scene.add(flagPoles);

  // pennant strings over the piers and string lights
  const pennantGeo = track(triangleFlag(0.55, 0.36));
  const pennantMat = track(clothMaterial({ colorFn: () => color('#ffffff'), amp: 0.09, speed: 3.1, rough: 0.8 }));
  const pennantItems: Array<{ p: [number, number, number]; c: string; s: number }> = [];
  const bulbItems: Array<{ p: [number, number, number]; c: string; s: number }> = [];
  const ropeParts = new Parts();
  const pennCols = ['#ffd24a', '#ff7a5a', '#2fb6c9', '#a071ff', '#fff0d0', '#ff9f43'];
  const stringBetween = (a: THREE.Vector3, b: THREE.Vector3, sag: number, nPenn: number, nBulb: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) pts.push(catenary(a, b, i / 20, sag, new THREE.Vector3()));
    ropeParts.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.018, 4, false), { color: '#3a2a20', rough: 0.9 });
    for (let i = 0; i < nPenn; i++) {
      const t = (i + 0.5) / nPenn;
      const p = catenary(a, b, t, sag);
      pennantItems.push({ p: [p.x, p.y - 0.02, p.z], c: pennCols[i % pennCols.length]!, s: 1 });
    }
    for (let i = 0; i < nBulb; i++) {
      const t = (i + 0.5) / nBulb;
      const p = catenary(a, b, t, sag);
      bulbItems.push({ p: [p.x, p.y - 0.06, p.z], c: i % 3 === 0 ? '#ffe6a8' : '#ffc060', s: 1 });
    }
  };
  for (const s of [-1, 1]) {
    // across the pier at two stations, plus along both edges
    for (const x of [10.2, 14.0]) stringBetween(new THREE.Vector3(s * x, 3.2, -3.0), new THREE.Vector3(s * x, 3.2, 3.0), 0.5, 8, 12);
    for (const z of [-3.0, 3.0]) {
      stringBetween(new THREE.Vector3(s * 6.55, 3.15, z * 0.92), new THREE.Vector3(s * 10.2, 3.2, z), 0.4, 6, 9);
      stringBetween(new THREE.Vector3(s * 10.2, 3.2, z), new THREE.Vector3(s * 14.0, 3.2, z), 0.4, 6, 9);
    }
  }
  const pennants = new THREE.InstancedMesh(pennantGeo, pennantMat, pennantItems.length);
  fillInstances(pennants, pennantItems.map((p) => ({ p: p.p, c: p.c, s: p.s })));
  scene.add(pennants);
  const ropeG = track(ropeParts.build());
  scene.add(new THREE.Mesh(ropeG, worldMat));
  const bulbGlow = glowUniformMat('#ffffff', 3.4);
  track(bulbGlow.material);
  const bulbG = track(new THREE.SphereGeometry(0.055, 8, 6));
  const bulbs = new THREE.InstancedMesh(bulbG, bulbGlow.material, bulbItems.length);
  fillInstances(bulbs, bulbItems);
  scene.add(bulbs);

  // ───────────────────────── airships ─────────────────────────
  const airMat = worldMat;
  interface Flyer {
    ship: Airship;
    speed: number;
    base: THREE.Vector3;
    range: number;
    phase: number;
    moored: boolean;
  }
  const flyers: Flyer[] = [];
  const addShip = (spec: Parameters<typeof buildAirship>[0], pos: THREE.Vector3, opts: { speed: number; range: number; moored?: boolean; yaw?: number }) => {
    const ship = buildAirship(spec, airMat);
    ship.group.position.copy(pos);
    ship.group.rotation.y = opts.yaw ?? 0;
    scene.add(ship.group);
    track(ship.bodyGeo);
    track(ship.propGeo);
    flyers.push({ ship, speed: opts.speed, base: pos.clone(), range: opts.range, phase: rnd() * 6, moored: !!opts.moored });
  };
  addShip({ len: 26, env: '#f6e3b0', accent: '#e8a92e', hull: '#8a5a34', trim: '#f2c14e', emblem: 'sun', seed: 1 }, new THREE.Vector3(-33, 5.2, -21), { speed: 0, range: 0, moored: true, yaw: 0.12 });
  addShip({ len: 24, env: '#d9ccff', accent: '#6a44b8', hull: '#4a3a6a', trim: '#d8c8ff', emblem: 'star', seed: 2 }, new THREE.Vector3(38, 4.4, -22), { speed: 0, range: 0, moored: true, yaw: -0.1 });
  addShip({ len: 22, env: '#bfe6ee', accent: '#1f8ea3', hull: '#3a4f66', trim: '#e3b64f', emblem: 'storm', seed: 3 }, new THREE.Vector3(0, -3.5, -40), { speed: 2.0, range: 80 });
  addShip({ len: 46, env: '#ffe2b8', accent: '#d9762a', hull: '#6a4426', trim: '#f2c14e', emblem: 'sun', seed: 4 }, new THREE.Vector3(-10, -9, -92), { speed: 1.05, range: 130 });
  const smallCols: Array<[string, string, string]> = [['#ffd9a8', '#e0703a', '#f2c14e'], ['#e6d8ff', '#7a4fd0', '#e6d8ff'], ['#cdeef2', '#2fb6c9', '#f2c14e'], ['#fff0c8', '#c8583c', '#f2c14e']];
  const smallN = isLow ? 3 : 6;
  for (let i = 0; i < smallN; i++) {
    const c = smallCols[i % 4]!;
    addShip(
      { len: 6.5 + rnd() * 3, env: c[0], accent: c[1], hull: '#6a4a30', trim: c[2], emblem: i % 3 === 0 ? 'sun' : i % 3 === 1 ? 'star' : 'storm', seed: 10 + i, simple: true },
      new THREE.Vector3(-60 + rnd() * 120, -8 + rnd() * 16, -30 - rnd() * 60),
      { speed: 1.3 + rnd() * 1.7, range: 100 },
    );
  }
  // mooring lines from the moored ships to their islands
  {
    const mp = new Parts();
    const lines: Array<[THREE.Vector3, THREE.Vector3]> = [
      [new THREE.Vector3(-26, 3.6, -21), island(ISLAND_A, ISLAND_A.cx - 4.5, ISLAND_A.cz - 8.8).add(new THREE.Vector3(0, 1.3, 0))],
      [new THREE.Vector3(-40, 3.6, -21), island(ISLAND_A, ISLAND_A.cx - 9.0, ISLAND_A.cz - 8.0).add(new THREE.Vector3(0, 1.0, 0))],
      [new THREE.Vector3(30, 3, -22), island(ISLAND_B, ISLAND_B.cx + 0.5, ISLAND_B.cz - 9.0).add(new THREE.Vector3(0, 1.2, 0))],
      [new THREE.Vector3(45, 3, -22), island(ISLAND_B, ISLAND_B.cx + 8.0, ISLAND_B.cz - 6.5).add(new THREE.Vector3(0, 1.0, 0))],
    ];
    for (const [a, b] of lines) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) pts.push(catenary(a, b, i / 12, 0.9, new THREE.Vector3()));
      mp.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.05, 5, false), { color: '#c9b078', rough: 0.95 });
    }
    const g = track(mp.build());
    scene.add(new THREE.Mesh(g, worldMat));
  }
  updaters.push((dt, t) => {
    for (const f of flyers) {
      const s = f.ship;
      if (f.moored) {
        s.group.position.set(f.base.x + Math.sin(t * 0.21 + f.phase) * 0.5, f.base.y + Math.sin(t * 0.45 + f.phase) * 0.35, f.base.z + Math.cos(t * 0.17 + f.phase) * 0.4);
        s.group.rotation.z = Math.sin(t * 0.3 + f.phase) * 0.012;
      } else {
        let x = f.base.x + f.speed * t;
        x = ((x + f.range) % (f.range * 2)) - f.range;
        s.group.position.set(x, f.base.y + Math.sin(t * 0.4 + f.phase) * 0.6, f.base.z);
        s.group.rotation.z = Math.sin(t * 0.33 + f.phase) * 0.02;
        s.group.rotation.x = Math.sin(t * 0.27 + f.phase) * 0.012;
      }
      const spin = f.moored ? 0.35 : 1;
      for (const p of s.props) p.mesh.rotation.x += p.speed * spin * dt;
    }
    for (const v of villageInst) void v;
  });

  // ───────────────────────── colossal statue ─────────────────────────
  {
    const statMat = track(propMaterial());
    statMat.fog = false;
    const st = buildStatue(statMat, 27);
    track(st.starMat);
    st.geos.forEach(track);
    st.group.position.set(-44, -27, -128);
    scene.add(st.group);
    const base: IslandSpec = { cx: 0, cy: 0, cz: 0, radius: 15, depth: 24, topY: 0.4, seed: 21.3, seg: [56, 32], vines: 6, crystal: '#ffd27f', grassA: '#8ea260', grassB: '#b4b872', rockA: '#7d6c72', rockB: '#a89294' };
    const bp = new Parts();
    islandParts(base, bp);
    // plinth
    bp.add(new THREE.CylinderGeometry(6.5, 7.5, 3.2, 20), { color: '#b8a58a', rough: 0.8 }, { p: [0, 2.0, 0] });
    bp.add(new THREE.CylinderGeometry(5.2, 6.0, 2.0, 20), { color: '#cdbb9c', rough: 0.75 }, { p: [0, 4.6, 0] });
    const bg = track(bp.build());
    const bm = new THREE.Mesh(bg, worldMat);
    bm.position.set(-44, -27.4, -128);
    scene.add(bm);
    st.group.position.y = -27.4 + 5.6;
    // glowing halo around the star
    const haloMat = track(new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    haloMat.fog = false;
    const d = length(uv().sub(0.5));
    haloMat.colorNode = color('#ffd48a').mul(0.9);
    haloMat.opacityNode = smoothstep(0.5, 0.0, d).pow(2.8);
    haloMat.scaleNode = vec2(30, 30);
    const halo = new THREE.Sprite(haloMat);
    st.star.getWorldPosition(halo.position);
    halo.position.set(-44 + 14, -27.4 + 5.6 + 27 * 1.6, -128);
    scene.add(halo);
    updaters.push((_dt, t) => {
      halo.scale.setScalar(1 + Math.sin(t * 1.3) * 0.06);
      st.star.rotation.y = Math.sin(t * 0.5) * 0.25;
    });
    // find the real star world position after first matrix update
    scene.updateMatrixWorld(true);
    st.star.getWorldPosition(halo.position);
  }

  // ───────────────────────── birds ─────────────────────────
  {
    const wing = (sgn: number): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      const v = new Float32Array([0, 0, 0.16, 0, 0, -0.14, sgn * 0.78, 0, -0.08]);
      g.setAttribute('position', new THREE.BufferAttribute(v, 3));
      g.setIndex([0, 1, 2, 0, 2, 1]);
      g.computeVertexNormals();
      return g;
    };
    const bp = new Parts();
    bp.add(new THREE.SphereGeometry(1, 8, 6), { color: '#ffffff', rough: 0.7 }, { s: [0.09, 0.07, 0.22] });
    bp.add(wing(1), { color: '#ffffff', rough: 0.8 });
    bp.add(wing(-1), { color: '#ffffff', rough: 0.8 });
    const bg = track(bp.build());
    const bmat = propMaterial({ side: THREE.DoubleSide });
    const ph = hash(instanceIndex.toFloat().add(2.7)).mul(6.28);
    bmat.positionNode = Fn(() => {
      const p = positionLocal.toVar();
      p.y.addAssign(sin(time.mul(9).add(ph)).mul(positionGeometry.x.abs()).mul(0.55));
      return p;
    })();
    track(bmat);
    const flocks: Array<{ mesh: THREE.InstancedMesh; n: number; c: THREE.Vector3; rad: number; spd: number; col: string; seed: number }> = [
      { mesh: new THREE.InstancedMesh(bg, bmat, 12), n: 12, c: new THREE.Vector3(-4, 9, -14), rad: 15, spd: 0.32, col: '#fff6e6', seed: 1 },
      { mesh: new THREE.InstancedMesh(bg, bmat, 9), n: 9, c: new THREE.Vector3(22, 12, -30), rad: 20, spd: -0.22, col: '#3d3450', seed: 2 },
      { mesh: new THREE.InstancedMesh(bg, bmat, 14), n: 14, c: new THREE.Vector3(-26, 5, -45), rad: 26, spd: 0.16, col: '#4a3a5e', seed: 3 },
    ];
    const cc = new THREE.Color();
    for (const f of flocks) {
      for (let i = 0; i < f.n; i++) f.mesh.setColorAt(i, cc.set(f.col).multiplyScalar(0.85 + rnd() * 0.3));
      f.mesh.frustumCulled = false;
      scene.add(f.mesh);
    }
    updaters.push((_dt, t) => {
      for (const f of flocks) {
        for (let i = 0; i < f.n; i++) {
          const a = t * f.spd + (i / f.n) * 1.6 + Math.sin(i * 3.1 + f.seed) * 0.3;
          const rr = f.rad + Math.sin(i * 1.7 + t * 0.2) * 3;
          const x = f.c.x + Math.cos(a) * rr;
          const z = f.c.z + Math.sin(a) * rr * 0.55;
          const y = f.c.y + Math.sin(a * 2.3 + i) * 1.4 + (i % 4) * 0.5;
          tmpObj.position.set(x, y, z);
          const dx = -Math.sin(a) * rr * Math.sign(f.spd);
          const dz = Math.cos(a) * rr * 0.55 * Math.sign(f.spd);
          tmpObj.rotation.set(0, Math.atan2(dx, dz), Math.sin(a * 3 + i) * 0.25);
          tmpObj.scale.setScalar(1.3);
          tmpObj.updateMatrix();
          f.mesh.setMatrixAt(i, tmpObj.matrix);
        }
        f.mesh.instanceMatrix.needsUpdate = true;
      }
    });
  }

  // ───────────────────────── cloud puffs ─────────────────────────
  {
    const puffGeo = track(new THREE.IcosahedronGeometry(1, 1));
    const puffMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 }));
    const upK = normalWorld.y.mul(0.5).add(0.5);
    const pc = mix(color('#a4779c'), color('#fff0dc'), upK.pow(1.4));
    puffMat.colorNode = pc;
    puffMat.emissiveNode = pc.mul(0.2);
    const nFar = Math.round(16 * Math.max(0.5, dens));
    const nGap = 5;
    const nClumps = nFar + nGap;
    const perClump = 6;
    const puffs = new THREE.InstancedMesh(puffGeo, puffMat, nClumps * perClump);
    interface P {
      x: number;
      y: number;
      z: number;
      s: number;
      v: number;
    }
    const data: P[] = [];
    const cc = new THREE.Color();
    for (let c = 0; c < nClumps; c++) {
      const gap = c >= nFar;
      const cx = gap ? -15 + rnd() * 30 : -150 + rnd() * 300;
      const cy = gap ? -22 + rnd() * 8 : -23 + rnd() * 14 + (c % 5 === 0 ? 14 * rnd() : 0);
      const cz = gap ? -20 + rnd() * 30 : -140 + rnd() * 170;
      const v = gap ? 0.25 + rnd() * 0.35 : 0.35 + rnd() * 0.7;
      const sc = gap ? 1.6 + rnd() * 1.6 : 3 + rnd() * 6;
      for (let k = 0; k < perClump; k++) {
        data.push({ x: cx + (rnd() - 0.5) * sc * 2.6, y: cy + (rnd() - 0.4) * sc * 0.5, z: cz + (rnd() - 0.5) * sc * 1.4, s: sc * (0.5 + rnd() * 0.7), v });
        puffs.setColorAt(c * perClump + k, cc.set(rnd() > 0.4 ? '#ffffff' : '#ffe2d0').multiplyScalar(0.9 + rnd() * 0.15));
      }
    }
    puffs.frustumCulled = false;
    scene.add(puffs);
    const wrap = 170;
    updaters.push((dt) => {
      for (let i = 0; i < data.length; i++) {
        const d = data[i]!;
        d.x += d.v * dt;
        if (d.x > wrap) d.x -= wrap * 2;
        tmpObj.position.set(d.x, d.y, d.z);
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.scale.set(d.s * 1.5, d.s * 0.7, d.s);
        tmpObj.updateMatrix();
        puffs.setMatrixAt(i, tmpObj.matrix);
      }
      puffs.instanceMatrix.needsUpdate = true;
    });
  }

  // ───────────────────────── floating debris in the gap (broken bridge planks + rocks) ─────────────────────────
  {
    const nR = isLow ? 6 : 12;
    const nP = isLow ? 6 : 14;
    const debrisRocks = new THREE.InstancedMesh(rockG, worldMat, nR);
    const plankG = track(new Parts().add(new THREE.BoxGeometry(1.1, 0.07, 0.36), { color: '#8a5a34', rough: 0.9 }).add(new THREE.BoxGeometry(0.1, 0.08, 0.4), { color: '#c9a45a', rough: 0.4, metal: 0.7 }, { p: [0.4, 0, 0] }).build());
    const debrisPlanks = new THREE.InstancedMesh(plankG, worldMat, nP);
    interface D {
      x: number;
      y: number;
      z: number;
      s: number;
      rx: number;
      ry: number;
      rz: number;
      sp: number;
      ph: number;
    }
    const mk = (n: number, y0: number, y1: number, sMin: number, sMax: number): D[] =>
      Array.from({ length: n }, () => ({ x: -10 + rnd() * 20, y: y0 + rnd() * (y1 - y0), z: -9 + rnd() * 16, s: sMin + rnd() * (sMax - sMin), rx: rnd() * 6, ry: rnd() * 6, rz: rnd() * 6, sp: 0.1 + rnd() * 0.35, ph: rnd() * 6 }));
    const dr = mk(nR, -11, -3, 0.35, 1.2);
    const dp = mk(nP, -9, -2.5, 0.8, 1.2);
    const cc2 = new THREE.Color();
    dr.forEach((_d, i) => debrisRocks.setColorAt(i, cc2.set(i % 2 ? '#ffffff' : '#d9d0c6')));
    debrisRocks.frustumCulled = false;
    debrisPlanks.frustumCulled = false;
    scene.add(debrisRocks, debrisPlanks);
    updaters.push((_dt, t) => {
      const put = (mesh: THREE.InstancedMesh, arr: D[]) => {
        arr.forEach((d, i) => {
          tmpObj.position.set(d.x + Math.sin(t * 0.2 + d.ph) * 0.4, d.y + Math.sin(t * 0.5 * d.sp * 3 + d.ph) * 0.35, d.z + Math.cos(t * 0.17 + d.ph) * 0.4);
          tmpObj.rotation.set(d.rx + t * d.sp * 0.6, d.ry + t * d.sp, d.rz + t * d.sp * 0.4);
          tmpObj.scale.setScalar(d.s);
          tmpObj.updateMatrix();
          mesh.setMatrixAt(i, tmpObj.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
      };
      put(debrisRocks, dr);
      put(debrisPlanks, dp);
    });
  }

  // ───────────────────────── light shafts & sun glints ─────────────────────────
  {
    const shafts: THREE.Mesh[] = [];
    const spots: Array<[number, number, number, number]> = [[-12, 24, -14, 0.5], [3, 26, -26, 0.4], [14, 24, -12, 0.45]];
    for (const [x, y, z, k] of spots) {
      const sh = lightShaft('#ffd7a0', 30, 0.8, 4.5, isLow ? 0.04 : 0.07 * k * 2);
      sh.position.set(x, y, z);
      sh.rotation.set(0.15, 0, -0.42);
      scene.add(sh);
      shafts.push(sh);
      track(sh.geometry);
      track(sh.material as THREE.Material);
    }
    updaters.push((_dt, t) => {
      shafts.forEach((s, i) => {
        s.rotation.z = -0.42 + Math.sin(t * 0.13 + i) * 0.03;
      });
    });
  }
  // subtle color pulse for material accents
  void mix;

  return {
    update(dt, t, camera) {
      for (const u of updaters) u(dt, t, camera);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      updaters.length = 0;
    },
  };
}

export { merge };
