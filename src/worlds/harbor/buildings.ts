import * as THREE from 'three/webgpu';
import { bake, cyl, ellipsoid, extrude, lathe, torus, tube } from '../../characters/geo';
import { buildHumanoid, type HumanoidSpec } from '../../characters/HumanoidBuilder';
import { rng } from '../../world/kit';
import { Parts, fillInstances, paint, starShape } from './helpers';

const CREAM = '#eadfc6';
const CREAM_D = '#cdbf9f';
const GOLD = { color: '#f2c14e', rough: 0.22, metal: 1 } as const;
const GOLD_GLOW = { color: '#ffd76a', rough: 0.2, metal: 1, emit: 0.5 } as const;

export interface Built {
  group: THREE.Group;
  geos: THREE.BufferGeometry[];
  spin?: THREE.Object3D;
}

function columnGeometry(h: number, r: number, fluted = true): THREE.BufferGeometry {
  const p = new Parts();
  p.add(cyl(r * 1.45, r * 1.55, h * 0.06, 16), { color: CREAM_D, rough: 0.7 }, { p: [0, h * 0.03, 0] });
  p.add(cyl(r * 1.15, r * 1.3, h * 0.04, 16), GOLD, { p: [0, h * 0.075, 0] });
  const shaft = cyl(r * 0.86, r, h * 0.78, fluted ? 20 : 14);
  p.add(shaft, { color: CREAM, rough: 0.6 }, { p: [0, h * 0.5, 0] });
  p.add(torus(r * 0.9, r * 0.07, Math.PI * 2, 18, 5), GOLD, { p: [0, h * 0.885, 0], r: [Math.PI / 2, 0, 0] });
  p.add(cyl(r * 1.35, r * 0.9, h * 0.06, 18), GOLD, { p: [0, h * 0.93, 0] });
  p.add(new THREE.BoxGeometry(r * 3.0, h * 0.04, r * 3.0), GOLD, { p: [0, h * 0.98, 0] });
  return p.build();
}

/** Golden domed temple (rotunda). Local origin = centre of the ground, front (door) faces +Z. */
export function buildSunTemple(mat: THREE.Material): Built {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const p = new Parts();
  // stepped stylobate
  p.add(cyl(5.6, 5.8, 0.6, 48), { color: CREAM_D, rough: 0.75 }, { p: [0, -0.05, 0] });
  p.add(cyl(5.0, 5.2, 0.32, 48), { color: CREAM, rough: 0.7 }, { p: [0, 0.4, 0] });
  p.add(cyl(4.55, 4.7, 0.3, 48), { color: CREAM, rough: 0.65 }, { p: [0, 0.7, 0] });
  p.add(torus(4.62, 0.06, Math.PI * 2, 48, 5), GOLD, { p: [0, 0.86, 0], r: [Math.PI / 2, 0, 0] });
  const Y = 0.85;
  // cella
  p.add(cyl(2.75, 2.85, 3.6, 40), { color: '#f3ead6', rough: 0.6 }, { p: [0, Y + 1.8, 0] });
  p.add(torus(2.8, 0.09, Math.PI * 2, 40, 5), GOLD, { p: [0, Y + 0.25, 0], r: [Math.PI / 2, 0, 0] });
  // door with golden frame and glowing interior
  p.add(new THREE.BoxGeometry(1.4, 2.4, 0.3), { color: '#3a2216', rough: 0.9 }, { p: [0, Y + 1.2, 2.72] });
  p.add(new THREE.BoxGeometry(1.2, 2.2, 0.12), { color: '#ffb45a', rough: 0.5, emit: 1.3 }, { p: [0, Y + 1.15, 2.86] });
  p.add(extrude(new THREE.Shape().absarc(0, 0, 0.68, 0, Math.PI, false), 0.22, 0.03), GOLD, { p: [0, Y + 2.3, 2.75] });
  p.add(new THREE.BoxGeometry(0.12, 2.5, 0.2), GOLD, { p: [0.75, Y + 1.2, 2.8] });
  p.add(new THREE.BoxGeometry(0.12, 2.5, 0.2), GOLD, { p: [-0.75, Y + 1.2, 2.8] });
  // windows (glowing slits) around the cella
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2 + Math.PI / 6;
    if (Math.abs(Math.sin(a - Math.PI / 2)) < 0.01) continue;
    p.add(new THREE.BoxGeometry(0.38, 1.4, 0.12), { color: '#ffcf80', rough: 0.4, emit: 1.2 }, { p: [Math.sin(a) * 2.78, Y + 2.0, Math.cos(a) * 2.78], r: [0, a, 0] });
  }
  // entablature ring (gold) resting on the columns
  const ring = new THREE.Shape();
  ring.absarc(0, 0, 4.25, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 3.3, 0, Math.PI * 2, true);
  ring.holes.push(hole);
  const ringGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.55, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1, curveSegments: 48 });
  ringGeo.rotateX(-Math.PI / 2);
  p.add(ringGeo, { color: '#f0d27a', rough: 0.3, metal: 0.9 }, { p: [0, Y + 3.5, 0] });
  p.add(torus(4.3, 0.09, Math.PI * 2, 48, 5), GOLD, { p: [0, Y + 4.06, 0], r: [Math.PI / 2, 0, 0] });
  // dome
  const dome = lathe([[3.9, 0], [3.95, 0.35], [3.6, 1.4], [2.8, 2.35], [1.7, 3.05], [0.7, 3.5], [0.15, 3.75]], 48, 36);
  p.add(dome, { color: '#f2c14e', rough: 0.2, metal: 1 }, { p: [0, Y + 4.05, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const pts: Array<[number, number, number]> = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const rr = 3.95 * Math.cos(t * 1.42) * (1 - t * 0.05);
      pts.push([Math.sin(a) * (rr + 0.04), Y + 4.05 + 0.02 + Math.sin(t * 1.42) * 3.7, Math.cos(a) * (rr + 0.04)]);
    }
    p.add(tube(pts, 0.05, 14, 4), { color: '#fff0b0', rough: 0.25, metal: 1, emit: 0.35 });
  }
  p.add(cyl(0.35, 0.5, 0.5, 14), GOLD, { p: [0, Y + 7.9, 0] });
  p.add(ellipsoid(0.32, 0.32, 0.32, 14, 10), GOLD_GLOW, { p: [0, Y + 8.3, 0] });
  p.add(new THREE.ConeGeometry(0.16, 1.5, 10), GOLD, { p: [0, Y + 9.2, 0] });
  // sun medallion above the door
  p.add(cyl(0.7, 0.7, 0.08, 24), { color: '#ffd25a', rough: 0.25, metal: 1, emit: 0.7 }, { p: [0, Y + 3.0, 2.86], r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    p.add(new THREE.ConeGeometry(0.1, 0.42, 4), GOLD, { p: [Math.cos(a) * 0.92, Y + 3.0 + Math.sin(a) * 0.92, 2.86], r: [0, 0, a - Math.PI / 2], s: [1, 1, 0.5] });
  }
  // braziers at the front steps
  for (const s of [1, -1]) {
    p.add(cyl(0.16, 0.24, 0.9, 10), { color: CREAM_D, rough: 0.7 }, { p: [s * 1.7, Y + 0.45, 4.15] });
    p.add(cyl(0.34, 0.2, 0.22, 12), GOLD, { p: [s * 1.7, Y + 1.02, 4.15] });
    p.add(new THREE.ConeGeometry(0.22, 0.6, 8), { color: '#ffb040', rough: 0.4, emit: 2.4 }, { p: [s * 1.7, Y + 1.4, 4.15] });
  }
  const sg = p.build();
  geos.push(sg);
  const body = new THREE.Mesh(sg, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  // instanced columns
  const cg = columnGeometry(3.5, 0.27);
  geos.push(cg);
  const cols = new THREE.InstancedMesh(cg, mat, 12);
  const items: Parameters<typeof fillInstances>[1] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    items.push({ p: [Math.sin(a) * 3.75, Y, Math.cos(a) * 3.75], r: [0, a, 0] });
  }
  fillInstances(cols, items);
  cols.castShadow = true;
  cols.receiveShadow = true;
  group.add(cols);
  return { group, geos };
}

/** Small open pavilion: 4 columns, gold dome. */
export function buildKiosk(mat: THREE.Material, r = 1.5, gold = true): Built {
  const group = new THREE.Group();
  const p = new Parts();
  p.add(cyl(r * 1.25, r * 1.35, 0.35, 8), { color: CREAM_D, rough: 0.7 }, { p: [0, 0.12, 0] });
  p.add(cyl(r * 1.15, r * 1.2, 0.2, 8), { color: CREAM, rough: 0.65 }, { p: [0, 0.4, 0] });
  const Y = 0.5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p.add(cyl(0.12, 0.14, 2.3, 10), { color: CREAM, rough: 0.6 }, { p: [Math.sin(a) * r, Y + 1.15, Math.cos(a) * r] });
    p.add(cyl(0.2, 0.14, 0.14, 10), GOLD, { p: [Math.sin(a) * r, Y + 2.35, Math.cos(a) * r] });
  }
  p.add(cyl(r * 1.25, r * 1.25, 0.22, 6), GOLD, { p: [0, Y + 2.5, 0] });
  p.add(lathe([[r * 1.3, 0], [r * 1.3, 0.2], [r * 1.0, 0.8], [r * 0.55, 1.3], [r * 0.15, 1.6]], 24, 20), { color: gold ? '#f2c14e' : '#7fbfd0', rough: 0.2, metal: 1 }, { p: [0, Y + 2.6, 0] });
  p.add(ellipsoid(0.13, 0.13, 0.13, 10, 8), GOLD_GLOW, { p: [0, Y + 4.4, 0] });
  p.add(new THREE.ConeGeometry(0.06, 0.6, 6), GOLD, { p: [0, Y + 4.8, 0] });
  // bench + lantern inside
  p.add(cyl(0.3, 0.3, 0.06, 12), { color: '#8a5a34', rough: 0.8 }, { p: [0, Y + 0.55, 0] });
  p.add(cyl(0.05, 0.08, 0.5, 8), { color: '#8a5a34', rough: 0.8 }, { p: [0, Y + 0.3, 0] });
  const g = p.build();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  group.add(mesh);
  return { group, geos: [g] };
}

/** Bell tower with an onion dome. */
export function buildBellTower(mat: THREE.Material): Built {
  const group = new THREE.Group();
  const p = new Parts();
  p.add(new THREE.BoxGeometry(3.0, 0.5, 3.0), { color: CREAM_D, rough: 0.75 }, { p: [0, 0.2, 0] });
  p.add(new THREE.BoxGeometry(2.4, 7.0, 2.4), { color: CREAM, rough: 0.7 }, { p: [0, 4.0, 0] });
  for (let k = 0; k < 4; k++) p.add(new THREE.BoxGeometry(2.55, 0.16, 2.55), GOLD, { p: [0, 1.8 + k * 1.7, 0] });
  for (const s of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      p.add(new THREE.BoxGeometry(0.4, 0.9, 0.08), { color: '#ffc46a', rough: 0.4, emit: 1.2 }, { p: [0, 2.4 + k * 1.7, s * 1.22] });
      p.add(new THREE.BoxGeometry(0.08, 0.9, 0.4), { color: '#ffc46a', rough: 0.4, emit: 1.2 }, { p: [s * 1.22, 2.4 + k * 1.7, 0] });
    }
  }
  p.add(new THREE.BoxGeometry(2.9, 0.3, 2.9), GOLD, { p: [0, 7.6, 0] });
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as Array<[number, number]>) p.add(cyl(0.1, 0.12, 1.5, 8), { color: CREAM, rough: 0.6 }, { p: [x * 1.05, 8.5, z * 1.05] });
  p.add(ellipsoid(0.32, 0.4, 0.32, 10, 8), GOLD, { p: [0, 8.4, 0] });
  p.add(lathe([[1.35, 0], [1.6, 0.5], [1.5, 1.2], [0.9, 1.9], [0.35, 2.6], [0.08, 3.2]], 28, 24), { color: '#f2c14e', rough: 0.2, metal: 1 }, { p: [0, 9.2, 0] });
  p.add(cyl(0.05, 0.05, 1.2, 6), GOLD, { p: [0, 13.0, 0] });
  p.add(extrude(starShape(8, 0.5, 0.22), 0.06, 0.01), GOLD_GLOW, { p: [0, 13.7, 0] });
  const g = p.build();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  group.add(mesh);
  return { group, geos: [g] };
}

/** Lighthouse of the star island: banded tower, gallery, glowing crystal (spins) and rotating beams. */
export function buildLighthouse(mat: THREE.Material, crystalMat: THREE.Material): Built & { crystal: THREE.Mesh; beams: THREE.Group } {
  const group = new THREE.Group();
  const p = new Parts();
  p.add(cyl(2.8, 3.2, 1.2, 20), { color: '#8a7a92', rough: 0.85 }, { p: [0, 0.4, 0] });
  const tower = cyl(1.25, 1.85, 11.5, 28);
  const tg = bake(tower, { color: '#f1e9ff', rough: 0.6 }, { p: [0, 7.0, 0] });
  const cA = new THREE.Color('#f1e9ff');
  const cB = new THREE.Color('#7a4fd0');
  paint(tg, (pt, _n, c) => {
    c.copy(Math.floor((pt.y + 20) / 1.6) % 2 === 0 ? cA : cB);
  });
  p.addBaked(tg);
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05;
    p.add(new THREE.BoxGeometry(0.28, 0.6, 0.1), { color: '#ffd889', rough: 0.4, emit: 1.3 }, { p: [Math.sin(a) * (1.75 - k * 0.09), 2.0 + k * 1.7, Math.cos(a) * (1.75 - k * 0.09)], r: [0, a, 0] });
  }
  p.add(cyl(2.2, 1.4, 0.35, 28), GOLD, { p: [0, 12.9, 0] });
  p.add(torus(2.05, 0.06, Math.PI * 2, 32, 5), GOLD, { p: [0, 13.6, 0], r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    p.add(cyl(0.035, 0.035, 0.75, 5), GOLD, { p: [Math.sin(a) * 2.05, 13.3, Math.cos(a) * 2.05] });
  }
  // lantern room (dark frame, the glow is a separate mesh)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.add(cyl(0.06, 0.06, 2.3, 6), GOLD, { p: [Math.sin(a) * 1.2, 14.4, Math.cos(a) * 1.2] });
  }
  p.add(cyl(1.5, 1.3, 0.22, 20), GOLD, { p: [0, 13.2, 0] });
  p.add(lathe([[1.55, 0], [1.4, 0.5], [0.9, 1.1], [0.35, 1.5], [0.1, 1.8]], 24, 16), { color: '#f2c14e', rough: 0.2, metal: 1 }, { p: [0, 15.6, 0] });
  p.add(extrude(starShape(8, 0.55, 0.24), 0.07, 0.01), GOLD_GLOW, { p: [0, 17.9, 0] });
  const g = p.build();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  group.add(mesh);
  const cgeo = new Parts().add(new THREE.OctahedronGeometry(0.95, 0), { color: '#ffffff' }, { s: [0.75, 1.35, 0.75] }).build();
  const crystal = new THREE.Mesh(cgeo, crystalMat);
  crystal.position.set(0, 14.4, 0);
  group.add(crystal);
  const beams = new THREE.Group();
  beams.position.set(0, 14.4, 0);
  group.add(beams);
  return { group, geos: [g, cgeo], crystal, beams };
}

/** Observatory dome with telescope. */
export function buildObservatory(mat: THREE.Material): Built {
  const group = new THREE.Group();
  const p = new Parts();
  p.add(cyl(3.0, 3.3, 3.4, 28), { color: '#e6ddf5', rough: 0.65 }, { p: [0, 1.6, 0] });
  p.add(cyl(3.2, 3.2, 0.3, 28), GOLD, { p: [0, 3.4, 0] });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    p.add(new THREE.BoxGeometry(0.5, 1.1, 0.1), { color: '#c8b4ff', rough: 0.3, emit: 1.0 }, { p: [Math.sin(a) * 3.05, 1.8, Math.cos(a) * 3.05], r: [0, a, 0] });
  }
  const dome = new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(3.0, 2.5, 3.0);
  p.add(dome, { color: '#f3eefc', rough: 0.35, metal: 0.4 }, { p: [0, 3.55, 0] });
  // slit + telescope
  p.add(new THREE.BoxGeometry(0.7, 2.6, 3.4), { color: '#1c1430', rough: 0.9 }, { p: [0, 5.0, 1.2], r: [0.55, 0, 0] });
  p.add(cyl(0.3, 0.42, 3.4, 12), { color: '#d8b04a', rough: 0.25, metal: 1 }, { p: [0, 5.4, 2.3], r: [Math.PI / 2 - 0.85, 0, 0] });
  p.add(cyl(0.36, 0.3, 0.3, 12), GOLD, { p: [0, 6.8, 3.6], r: [Math.PI / 2 - 0.85, 0, 0] });
  p.add(torus(3.05, 0.09, Math.PI * 2, 36, 5), GOLD, { p: [0, 3.6, 0], r: [Math.PI / 2, 0, 0] });
  p.add(extrude(starShape(5, 0.6, 0.26), 0.08, 0.01), GOLD_GLOW, { p: [0, 6.5, 0] });
  const g = p.build();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  group.add(mesh);
  return { group, geos: [g] };
}

/** Distant mini village: domes, towers and roofs on a little plot; local origin at ground level. */
export function buildVillage(mat: THREE.Material, seed: number, scale: number): Built {
  const rnd = rng(seed);
  const group = new THREE.Group();
  const p = new Parts();
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd();
    const d = i === 0 ? 0 : 2.2 + rnd() * 1.5;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const w = 1.2 + rnd() * 1.2;
    const h = 2.2 + rnd() * 4.5;
    p.add(cyl(w, w * 1.05, h, 12), { color: rnd() > 0.5 ? CREAM : '#e9d3b0', rough: 0.7 }, { p: [x, h / 2, z] });
    if (rnd() > 0.35) p.add(lathe([[w * 1.15, 0], [w * 1.1, 0.3], [w * 0.7, 0.9], [w * 0.2, 1.4]], 14, 12), { color: '#f2c14e', rough: 0.22, metal: 1 }, { p: [x, h, z] });
    else p.add(new THREE.ConeGeometry(w * 1.2, w * 1.6, 12), { color: '#c8583c', rough: 0.7 }, { p: [x, h + w * 0.8, z] });
    p.add(new THREE.BoxGeometry(0.22, 0.6, 0.06), { color: '#ffc46a', rough: 0.4, emit: 1.4 }, { p: [x, h * 0.6, z + w * 1.02] });
  }
  const g = p.build();
  const mesh = new THREE.Mesh(g, mat);
  group.add(mesh);
  group.scale.setScalar(scale);
  return { group, geos: [g] };
}

/** Colossal robed statue holding a star lantern. Returns the group (feet at origin) and the star mesh. */
export function buildStatue(mat: THREE.Material, scale: number): { group: THREE.Group; star: THREE.Mesh; geos: THREE.BufferGeometry[]; starMat: THREE.Material } {
  const spec: HumanoidSpec = {
    height: 1.8,
    build: { shoulders: 1.2, chest: 1.05, hips: 1.1, limbs: 1.2, legs: 1.0, head: 1.0, neck: 1.1 },
    skin: '#7d6a70',
    eyes: { iris: '#ffd48a', size: 1.0, glow: 1.6 },
    hair: { style: 'long', color: '#3f3548' },
    nose: 'long',
    outfit: {
      top: { kind: 'robe', color: '#5c4a62', accent: '#c9a45a', trim: '#f0c85a', length: 1.0, collar: 'high', sleeves: 'long', rough: 0.85 },
      bottom: { kind: 'pants', color: '#43364a' },
      shoes: { kind: 'boots', color: '#5a4a3c' },
      belt: '#f0c85a',
      cape: '#4a3a5a',
      sash: '#f0c85a',
    },
    hat: { kind: 'circlet', color: '#f0c85a', accent: '#8fe6ff' },
    idle: 'stately',
  };
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const rigRoot = new THREE.Group();
  const rig = buildHumanoid(spec, (parent, geo, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    parent.add(m);
    geos.push(geo);
    return m;
  });
  rigRoot.add(rig.hips);
  // pose: left arm raised holding the star, right arm resting on the chest
  rig.shoulderL.rotation.set(-0.15, 0, 2.5);
  rig.elbowL.rotation.set(-0.2, 0, 0);
  rig.shoulderR.rotation.set(-0.5, 0, -0.35);
  rig.elbowR.rotation.set(-1.6, -0.5, 0);
  rig.head.rotation.set(-0.1, 0.2, 0);
  rig.torso.rotation.set(-0.03, 0.1, 0);
  const starMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#ffe6a0').multiplyScalar(2.3) });
  const sgeo = extrude(starShape(8, 0.62, 0.3), 0.08, 0.02);
  geos.push(sgeo);
  const star = new THREE.Mesh(sgeo, starMat);
  star.position.set(0, -0.62, 0);
  star.rotation.z = Math.PI;
  rig.handL.add(star);
  rigRoot.scale.setScalar(scale);
  group.add(rigRoot);
  return { group, star, geos, starMat };
}
