import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { VehicleRig } from '../../world/types';
import { lightShaft } from '../../world/kit';
import { bake, cyl, ellipsoid, extrude, merge, roundedBox, torus, tube } from '../../characters/geo';
import { Parts, clothMaterial, crystalGeometry, glowUniformMat, paint, propMaterial, starShape, stripeClothColor, sunBannerColor } from './helpers';

const HALF = 1.6; // half length of the hull (z)
const BEAM = 0.62;
const DEPTH = 0.7;

function widthAt(t: number): number {
  return BEAM * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.4)), 0.55);
}
function sheerAt(t: number): number {
  return 0.55 + 0.34 * Math.pow(Math.abs(t), 2.4);
}
function keelDepthAt(t: number): number {
  return DEPTH * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 1.8)), 0.8) + 0.06;
}

/** Parametric double-ended skiff hull (open shell, plank-striped vertex colours). */
function hullGeometry(): THREE.BufferGeometry {
  const nz = 36;
  const nt = 16;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let iz = 0; iz <= nz; iz++) {
    const t = (iz / nz) * 2 - 1;
    const z = t * HALF;
    const w = widthAt(t);
    const ys = sheerAt(t);
    const d = keelDepthAt(t);
    for (let it = 0; it <= nt; it++) {
      const th = (it / nt) * Math.PI;
      pos.push(Math.cos(th) * w, ys - Math.sin(th) * d, z);
    }
  }
  for (let iz = 0; iz < nz; iz++) {
    for (let it = 0; it < nt; it++) {
      const a = iz * (nt + 1) + it;
      const b = a + 1;
      const c = a + (nt + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  const b = bake(g, { color: '#8a5a34', rough: 0.72 });
  paint(b, (_p, _n, c, i) => {
    const it = i % (nt + 1);
    const iz = Math.floor(i / (nt + 1));
    const row = it;
    const plank = row % 2 === 0 ? 1.0 : 0.82;
    const grain = 0.94 + 0.06 * Math.sin(iz * 1.7 + it * 2.3);
    c.set('#9a6638').multiplyScalar(plank * grain);
    if (it <= 1 || it >= nt - 1) c.set('#f1c14a').multiplyScalar(0.95);
    else if (it === 2 || it === nt - 2) c.set('#2e6f8a');
  });
  return b;
}

function railCurve(side: number, lift: number): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * 2 - 1;
    pts.push([side * widthAt(t) * 0.995, sheerAt(t) + lift, t * HALF]);
  }
  return pts;
}

export interface SkiffHandles {
  rig: VehicleRig;
  dispose(): void;
}

export function createSkiff(opts: { lowDetail: boolean }): SkiffHandles {
  const root = new THREE.Group();
  root.name = 'vehicle:himmelsskiff';
  const hull = new THREE.Group();
  hull.name = 'skiffHull';
  root.add(hull);

  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };

  // ── static wooden/brass body (single draw call) ──
  const body = new Parts();
  const wood = { color: '#8a5a34', rough: 0.75 } as const;
  const brass = { color: '#e3b64f', rough: 0.22, metal: 1 } as const;
  const darkWood = { color: '#5a3a22', rough: 0.8 } as const;
  body.addBaked(hullGeometry());
  // gunwale rails + inner rail
  for (const s of [1, -1]) {
    body.add(tube(railCurve(s, 0.012), 0.032, 40, 6), brass);
    body.add(tube(railCurve(s, -0.09).map(([x, y, z]) => [x * 0.94, y, z] as [number, number, number]), 0.018, 40, 5), { color: '#2e6f8a', rough: 0.5 });
  }
  // deck floor planks
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.19;
    body.add(new THREE.BoxGeometry(0.18, 0.035, 2.3), { color: i % 2 ? '#a06e3c' : '#93602f', rough: 0.8 }, { p: [x, 0.19, 0] });
  }
  body.add(new THREE.BoxGeometry(0.95, 0.03, 0.06), darkWood, { p: [0, 0.215, -0.5] });
  body.add(new THREE.BoxGeometry(0.95, 0.03, 0.06), darkWood, { p: [0, 0.215, 0.5] });
  // benches (thwarts) at the seats
  for (const z of [-0.72, 0.5]) {
    body.add(roundedBox(1.02, 0.06, 0.34, 0.02), { color: '#a87a48', rough: 0.7 }, { p: [0, 0.6, z] });
    body.add(new THREE.BoxGeometry(0.08, 0.38, 0.28), darkWood, { p: [0.4, 0.4, z] });
    body.add(new THREE.BoxGeometry(0.08, 0.38, 0.28), darkWood, { p: [-0.4, 0.4, z] });
    body.add(new THREE.BoxGeometry(1.05, 0.02, 0.36), brass, { p: [0, 0.572, z] });
  }
  // mast, boom, cap
  const mastZ = -0.08;
  body.add(cyl(0.045, 0.06, 2.55, 10), wood, { p: [0, 1.45, mastZ] });
  body.add(cyl(0.05, 0.05, 0.14, 10), brass, { p: [0, 0.35, mastZ] });
  body.add(cyl(0.06, 0.055, 0.1, 10), brass, { p: [0, 2.68, mastZ] });
  body.add(ellipsoid(0.07, 0.09, 0.07, 10, 8), { color: '#ffd76a', rough: 0.2, metal: 1, emit: 0.8 }, { p: [0, 2.8, mastZ] });
  body.add(cyl(0.028, 0.028, 1.35, 8), wood, { p: [0, 0.82, mastZ - 0.6], r: [Math.PI / 2, 0, 0] });
  // stays
  body.add(tube([[0, 2.55, mastZ], [0, 1.6, 0.8], [0, 0.72, HALF - 0.12]], 0.008, 12, 4), { color: '#d9c9a0', rough: 0.9 });
  body.add(tube([[0, 2.55, mastZ], [0, 1.6, -0.9], [0, 0.72, -HALF + 0.12]], 0.008, 12, 4), { color: '#d9c9a0', rough: 0.9 });
  // figurehead (golden star) + stern crest + bow rings
  body.add(extrude(starShape(5, 0.2, 0.09), 0.06, 0.012), { color: '#ffd24a', rough: 0.2, metal: 1, emit: 0.7 }, { p: [0, sheerAt(1) + 0.22, HALF - 0.02] });
  body.add(torus(0.07, 0.014, Math.PI * 2, 14, 5), brass, { p: [0, sheerAt(1) - 0.08, HALF - 0.05] });
  body.add(extrude(starShape(4, 0.14, 0.06), 0.05, 0.01), { color: '#f1c14a', rough: 0.25, metal: 1 }, { p: [0, sheerAt(1) + 0.16, -HALF + 0.02] });
  // rudder + tiller
  body.add(new THREE.BoxGeometry(0.05, 0.5, 0.32), { color: '#6a4426', rough: 0.7 }, { p: [0, 0.12, -HALF - 0.12], r: [0.12, 0, 0] });
  body.add(cyl(0.02, 0.02, 0.85, 8), wood, { p: [0, 0.62, -HALF + 0.42], r: [Math.PI / 2 - 0.35, 0, 0] });
  body.add(ellipsoid(0.04, 0.04, 0.05, 8, 6), brass, { p: [0, 0.78, -1.15] });
  // cleats and helm compass
  for (const s of [1, -1]) {
    body.add(new THREE.BoxGeometry(0.16, 0.035, 0.05), brass, { p: [s * 0.5, 0.66, 0.05] });
    body.add(new THREE.BoxGeometry(0.16, 0.035, 0.05), brass, { p: [s * 0.44, 0.7, -1.05] });
  }
  body.add(cyl(0.07, 0.09, 0.14, 12), brass, { p: [0.36, 0.7, -1.05 + 0.32] });
  body.add(cyl(0.062, 0.062, 0.02, 12), { color: '#bfe8ff', rough: 0.1, emit: 0.8 }, { p: [0.36, 0.775, -1.05 + 0.32] });
  // lantern posts (frames) at each seat
  const lampPos: Array<[number, number, number]> = [[-0.5, 0.6, -0.72], [0.5, 0.6, 0.5]];
  lampPos.forEach(([x, y, z]) => {
    body.add(cyl(0.02, 0.025, 0.5, 8), brass, { p: [x, y + 0.25, z] });
    body.add(cyl(0.085, 0.07, 0.03, 10), brass, { p: [x, y + 0.53, z] });
    body.add(cyl(0.03, 0.09, 0.07, 10), brass, { p: [x, y + 0.78, z] });
    body.add(cyl(0.008, 0.008, 0.2, 5), brass, { p: [x, y + 0.9, z] });
  });
  const bodyMat = track(propMaterial({ side: THREE.DoubleSide }));
  const bodyMesh = new THREE.Mesh(track(body.build()), bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.name = 'skiffBody';
  hull.add(bodyMesh);

  // ── sail (cloth, wind flutter driven by `moving`) ──
  const flutter = uniform(0.5);
  const sailW = 1.35;
  const sailH = 1.65;
  const sg = new THREE.PlaneGeometry(sailW, sailH, 16, 10);
  sg.translate(sailW / 2, sailH / 2, 0);
  const sp = sg.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const u = sp.getX(i) / sailW;
    sp.setY(i, sp.getY(i) * (1 - u * 0.78));
  }
  sg.computeVertexNormals();
  track(sg);
  const sailMat = track(
    clothMaterial({
      colorFn: (u) => sunBannerColor('#f7ecd0', '#e9b23a', '#2e6f8a')(u),
      amp: 0.16,
      speed: 1.6,
      flutter: 0.35,
      rough: 0.8,
      emissive: 0.12,
      strength: flutter,
    }),
  );
  const sail = new THREE.Mesh(sg, sailMat);
  sail.position.set(0, 0.86, mastZ - 0.02);
  sail.rotation.y = Math.PI / 2;
  sail.castShadow = true;
  sail.name = 'skiffSail';
  hull.add(sail);
  // masthead pennant
  const pg = track(new THREE.PlaneGeometry(0.7, 0.22, 10, 2));
  pg.translate(0.35, 0, 0);
  const pp = pg.getAttribute('position');
  for (let i = 0; i < pp.count; i++) {
    const u = pp.getX(i) / 0.7;
    pp.setY(i, pp.getY(i) * (1 - u * 0.9));
  }
  const pennant = new THREE.Mesh(pg, track(clothMaterial({ colorFn: stripeClothColor('#ffd24a', '#c2482e', 3, false), amp: 0.09, speed: 3.2, strength: flutter })));
  pennant.position.set(0, 2.62, mastZ);
  pennant.rotation.y = Math.PI / 2;
  hull.add(pennant);

  // ── levitation crystals underneath ──
  const crystal = glowUniformMat('#6fe6ff', 2.6);
  track(crystal.material);
  const cg = track(new Parts().add(crystalGeometry(0.1, 0.4, 6), { color: '#ffffff' }).build());
  const crystals = new THREE.Group();
  const cpos: Array<[number, number, number, number]> = [[0, -0.16, -0.95, 0.8], [0, -0.22, 0.0, 1.25], [0, -0.16, 0.95, 0.8], [0.32, -0.08, 0.35, 0.55], [-0.32, -0.08, -0.35, 0.55]];
  cpos.forEach(([x, y, z, s], i) => {
    const m = new THREE.Mesh(cg, crystal.material);
    m.position.set(x, y, z);
    m.scale.setScalar(s);
    m.rotation.z = i % 2 ? 0.12 : -0.1;
    m.name = 'levCrystal';
    crystals.add(m);
  });
  hull.add(crystals);
  // hull glow strips (runes)
  const runeGeo = track(
    new Parts()
      .add(tube(railCurve(1, -0.19).map(([x, y, z]) => [x * 0.9, y, z * 0.85] as [number, number, number]), 0.012, 30, 4), { color: '#ffffff' })
      .add(tube(railCurve(-1, -0.19).map(([x, y, z]) => [x * 0.9, y, z * 0.85] as [number, number, number]), 0.012, 30, 4), { color: '#ffffff' })
      .build(),
  );
  const runes = new THREE.Mesh(runeGeo, crystal.material);
  hull.add(runes);
  const shaft = lightShaft('#7fe4ff', 3.4, 0.35, 1.05, 0.5);
  shaft.position.y = -0.1;
  shaft.visible = false;
  hull.add(shaft);
  track(shaft.geometry);
  track(shaft.material as THREE.Material);

  // ── seat lanterns (two): glow cores ──
  const lampGlow = [glowUniformMat('#ffc65a', 3), glowUniformMat('#ffc65a', 3)];
  const lampGeo = track(new THREE.SphereGeometry(0.07, 12, 8));
  lampPos.forEach(([x, y, z], i) => {
    const lg = lampGlow[i]!;
    track(lg.material);
    const m = new THREE.Mesh(lampGeo, lg.material);
    m.position.set(x, y + 0.66, z);
    m.scale.set(1, 1.35, 1);
    hull.add(m);
    lg.k.value = 0.12;
  });
  let lamps: THREE.PointLight | null = null;
  if (!opts.lowDetail) {
    lamps = new THREE.PointLight('#ffb45a', 0, 5, 2);
    lamps.position.set(0, 1.2, -0.1);
    hull.add(lamps);
  }

  // ── seats ──
  const seat0 = new THREE.Object3D();
  seat0.name = 'seat:helm';
  seat0.position.set(0, 0.22, -0.72);
  const seat1 = new THREE.Object3D();
  seat1.name = 'seat:passenger';
  seat1.position.set(0, 0.22, 0.5);
  root.add(seat0, seat1);
  const seats = [seat0, seat1];
  const seatBase = seats.map((s) => s.position.clone());

  // ── pick proxy ──
  const pickGeo = track(new THREE.BoxGeometry(1.5, 1.6, 3.5));
  const pickMat = track(new THREE.MeshBasicNodeMaterial({ visible: false }));
  const pick = new THREE.Mesh(pickGeo, pickMat);
  pick.position.set(0, 0.8, 0);
  pick.userData.pick = { kind: 'vehicle', id: 'vehicle' };
  pick.name = 'pick:vehicle';
  root.add(pick);

  const docks: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-4.2, 0.3, 0), new THREE.Vector3(4.2, 0.3, 0)];
  root.position.copy(docks[0]);
  root.rotation.y = Math.PI / 2;

  let move = 0;
  let occupied = 0;
  const rig: VehicleRig = {
    root,
    seats,
    docks,
    yaw: [Math.PI / 2, -Math.PI / 2],
    pickProxy: pick,
    crossingTime: 3.2,
    path: [docks[0].clone(), new THREE.Vector3(-2.2, 0.75, 0.3), new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(2.2, 0.75, -0.3), docks[1].clone()],
    update(dt, t, moving) {
      move += (moving - move) * (1 - Math.exp(-dt * 4));
      const bob = Math.sin(t * 1.5) * (0.045 + 0.03 * move) + Math.sin(t * 2.6 + 1) * 0.014;
      const pitch = Math.sin(t * 0.9) * 0.014 + Math.sin(t * 2.1) * 0.006 * move + move * 0.03;
      const roll = Math.sin(t * 1.1 + 0.5) * 0.022 + Math.sin(t * 3.1) * 0.012 * move;
      hull.position.y = bob;
      hull.rotation.set(pitch, 0, roll);
      seats.forEach((s, i) => {
        const b = seatBase[i]!;
        s.position.set(b.x, b.y * Math.cos(pitch) - b.z * Math.sin(pitch) + bob, b.z * Math.cos(pitch) + b.y * Math.sin(pitch));
        s.rotation.set(pitch, 0, roll);
      });
      flutter.value = 0.45 + move * 1.15 + Math.sin(t * 0.7) * 0.1;
      crystal.k.value = 0.55 + move * 0.95 + Math.sin(t * 3.0) * 0.12 + occupied * 0.05;
      crystals.rotation.y = t * 0.6 * (0.3 + move);
      shaft.visible = move > 0.03;
      shaft.scale.set(0.55 + move * 0.6, 0.5 + move * 0.5, 0.55 + move * 0.6);
      if (lamps) lamps.intensity = occupied > 0 ? 3 + occupied : 0.8;
    },
    setIndicator(info) {
      occupied = info.count;
      lampGlow.forEach((lg, i) => {
        lg.k.value = i < info.count ? 1.15 : 0.12;
      });
    },
  };

  return {
    rig,
    dispose() {
      for (const d of disposables) d.dispose();
      root.removeFromParent();
    },
  };
}

// keep merge import used for tree-shaking parity
void merge;
