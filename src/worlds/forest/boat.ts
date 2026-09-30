import * as THREE from 'three/webgpu';
import type { VehicleRig } from '../../world/types';
import { glowMat } from '../../world/kit';
import { bake, cone, cyl, ellipsoid, merge, mottle, roundedBox, torus, tube } from '../../characters/geo';
import { Bin, clamp01, halo, lerp, paint, sstep, vcMaterial } from './common';

type Geo = THREE.BufferGeometry;

const L0 = -1.75;
const L1 = 1.95;

function interp(pts: Array<[number, number]>, s: number): number {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (s <= b[0]) {
      const t = (s - a[0]) / (b[0] - a[0]);
      const e = t * t * (3 - 2 * t);
      return lerp(a[1], b[1], lerp(t, e, 0.6));
    }
  }
  return pts[pts.length - 1]![1];
}
const beamPts: Array<[number, number]> = [[0, 0.4], [0.12, 0.56], [0.32, 0.68], [0.55, 0.66], [0.78, 0.5], [0.92, 0.27], [1, 0.03]];
const beamAt = (s: number): number => interp(beamPts, s);
const sheerAt = (s: number): number => 0.4 + 0.07 * (1 - s) * (1 - s) + 0.27 * Math.pow(s, 3.2);
const keelAt = (s: number): number => -0.24 * Math.pow(Math.sin(Math.PI * (0.06 + 0.86 * s)), 0.7);
const zAt = (s: number): number => L0 + (L1 - L0) * s;
const sAt = (z: number): number => (z - L0) / (L1 - L0);

function halfWidthAt(s: number, y: number): number {
  const keel = keelAt(s);
  const sheer = sheerAt(s);
  const u = clamp01((y - keel) / (sheer - keel));
  const cosT = 1 - Math.pow(u, 1 / 1.15);
  return beamAt(s) * Math.sin(Math.acos(Math.min(1, Math.max(-1, cosT))));
}

const ST = 30;
const CJ = 34;

/** One hull shell (outer or inner) as an indexed grid. `off` shrinks it for the inside. */
function hullShell(off: number, flip: boolean): Geo {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= ST; i++) {
    const s = i / ST;
    const z = zAt(s);
    const beam = Math.max(0.0, beamAt(s) - off);
    const keel = keelAt(s) + off;
    const sheer = sheerAt(s);
    for (let j = 0; j <= CJ; j++) {
      const th = ((j / CJ) * 2 - 1) * (Math.PI / 2);
      const x = beam * Math.sin(th);
      const y = keel + (sheer - keel) * Math.pow(1 - Math.cos(th), 1.15);
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < ST; i++) {
    for (let j = 0; j < CJ; j++) {
      const a = i * (CJ + 1) + j;
      const b = a + 1;
      const c = a + CJ + 1;
      const d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface BoatBuild {
  rig: VehicleRig;
  lantern: THREE.PointLight | null;
  lanternHalo: THREE.Sprite;
  tick(t: number): void;
}

export function createBoat(bin: Bin, opts: { lights: number }): BoatBuild {
  const root = new THREE.Group();
  root.name = 'vehicle';
  const hull = new THREE.Group();
  root.add(hull);
  const wood = vcMaterial({ side: THREE.DoubleSide });
  bin.add(wood);

  // ── hull shell (outer, planks + teal stripe) ──
  const outer = bake(hullShell(0, false), { color: '#9a6a3f', rough: 0.72 });
  paint(outer, (x, y, z, _nx, _ny, _nz, c) => {
    const s = sAt(z);
    const beam = Math.max(0.05, beamAt(s));
    const th = Math.abs(Math.asin(Math.max(-1, Math.min(1, x / beam))));
    const band = th / (Math.PI / 2);
    const strake = Math.floor(band * 7);
    c.set(strake % 2 ? '#a5744a' : '#8f6038');
    const seam = Math.abs(band * 7 - Math.round(band * 7));
    c.multiplyScalar(seam < 0.09 ? 0.66 : 1);
    if (band > 0.8 && band < 0.9) c.set('#2f8f88');
    else if (band >= 0.9) c.set('#b98a55');
    if (band < 0.12) c.set('#5f3e24');
    c.multiplyScalar(0.9 + 0.2 * Math.sin(z * 9 + strake * 3.1 + y * 5));
  });
  const inner = bake(hullShell(0.05, true), { color: '#c7996a', rough: 0.8 });
  paint(inner, (x, y, z, _nx, _ny, _nz, c) => {
    const band = Math.abs(x) / Math.max(0.05, beamAt(sAt(z)));
    c.set(Math.floor(band * 6) % 2 ? '#c59665' : '#b8895a');
    c.multiplyScalar(0.75 + 0.35 * Math.min(1, (y + 0.25) * 2));
  });
  // gunwale rail (both sides) & stem/stern posts
  const rail: Geo[] = [];
  for (const sx of [1, -1]) {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i <= 14; i++) {
      const s = i / 14;
      pts.push([sx * (beamAt(s) + 0.01), sheerAt(s) + 0.01, zAt(s)]);
    }
    rail.push(bake(tube(pts, 0.04, 46, 6), { color: '#d0a56a', rough: 0.6 }));
    const pts2: Array<[number, number, number]> = [];
    for (let i = 0; i <= 14; i++) {
      const s = i / 14;
      pts2.push([sx * (beamAt(s) - 0.05), sheerAt(s) - 0.035, zAt(s)]);
    }
    rail.push(bake(tube(pts2, 0.026, 40, 5), { color: '#a87a48', rough: 0.7 }));
  }
  // transom (stern plate)
  rail.push(bake(roundedBox(1.0, 0.5, 0.06, 0.02), { color: '#8a5c36', rough: 0.75 }, { p: [0, 0.14, L0 - 0.01], r: [-0.06, 0, 0] }));
  rail.push(bake(roundedBox(0.84, 0.05, 0.05, 0.015), { color: '#2f8f88', rough: 0.6 }, { p: [0, 0.27, L0 - 0.055] }));
  // bow ornament: curled stem with leaf carvings and a glowing gem
  rail.push(bake(tube([[0, -0.02, L1 - 0.05], [0, 0.35, L1 + 0.1], [0, 0.85, L1 + 0.12], [0, 1.18, L1 - 0.02], [0, 1.28, L1 - 0.2], [0, 1.16, L1 - 0.3]], 0.05, 30, 8, 0.03), { color: '#b98550', rough: 0.55 }));
  rail.push(bake(torus(0.09, 0.028, Math.PI * 1.6, 16, 6), { color: '#b98550', rough: 0.55 }, { p: [0, 1.06, L1 - 0.28], r: [0, Math.PI / 2, 0.4] }));
  rail.push(bake(ellipsoid(0.045, 0.045, 0.045, 10, 8), { color: '#9dffc0', rough: 0.2, emit: 3.2 }, { p: [0, 1.06, L1 - 0.28] }));
  for (const sx of [1, -1]) {
    rail.push(bake(ellipsoid(0.02, 0.2, 0.07, 8, 6), { color: '#6db65a', rough: 0.6 }, { p: [sx * 0.07, 0.6, L1 + 0.02], r: [0.2, 0, sx * -0.5] }));
    rail.push(bake(ellipsoid(0.02, 0.15, 0.055, 8, 6), { color: '#e2c560', rough: 0.4, metal: 0.4 }, { p: [sx * 0.1, 0.36, L1 - 0.07], r: [0.3, 0, sx * -0.7] }));
  }
  // stern post with lantern hook & rudder
  rail.push(bake(cyl(0.035, 0.04, 0.72, 8), { color: '#a87a48', rough: 0.7 }, { p: [0.0, 0.62, L0 + 0.06] }));
  rail.push(bake(roundedBox(0.05, 0.42, 0.34, 0.015), { color: '#7f5532', rough: 0.75 }, { p: [0, -0.06, L0 - 0.2], r: [0.15, 0, 0] }));
  // floor boards
  const boards: Geo[] = [];
  for (let i = 0; i < 12; i++) {
    const s = 0.05 + i * 0.075;
    const hw = halfWidthAt(s, keelAt(s) + 0.08) * 0.92;
    boards.push(bake(roundedBox(Math.max(0.1, hw * 2), 0.03, 0.26, 0.008), { color: i % 2 ? '#b98a5a' : '#a97d4e', rough: 0.8 }, { p: [0, keelAt(s) + 0.065, zAt(s)] }));
  }
  // thwarts (benches)
  const benches: Geo[] = [];
  for (const [z, w] of [[-1.3, 0.36], [-0.5, 0.3], [0.62, 0.3]] as const) {
    const hw = halfWidthAt(sAt(z), 0.23) - 0.01;
    benches.push(bake(roundedBox(hw * 2, 0.045, w, 0.014), { color: '#c99b62', rough: 0.65 }, { p: [0, 0.23, z] }));
    for (const sx of [1, -1]) benches.push(bake(roundedBox(0.045, 0.2, w * 0.8, 0.01), { color: '#8f6038', rough: 0.75 }, { p: [sx * (hw - 0.05), 0.12, z] }));
  }
  // rope coil and small bucket in the bow
  const misc: Geo[] = [];
  for (let k = 0; k < 4; k++) misc.push(bake(torus(0.13 - k * 0.005, 0.022, Math.PI * 2, 16, 5), { color: '#d8c08a', rough: 0.95 }, { p: [-0.28, keelAt(0.9) + 0.13 + k * 0.03, 1.4], r: [Math.PI / 2, 0, 0] }));
  misc.push(bake(cyl(0.11, 0.08, 0.16, 10), { color: '#8a6a44', rough: 0.8 }, { p: [0.3, keelAt(0.88) + 0.14, 1.35] }));
  misc.push(bake(torus(0.11, 0.008, Math.PI * 2, 12, 4), { color: '#4a4a4a', rough: 0.5, metal: 0.8 }, { p: [0.3, keelAt(0.88) + 0.22, 1.35], r: [Math.PI / 2, 0, 0] }));
  const woodGeo = merge([outer, inner, ...rail, ...boards, ...benches, ...misc]);
  mottle(woodGeo, 0.12, 14, 3);
  const woodMesh = new THREE.Mesh(bin.add(woodGeo), wood);
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;
  woodMesh.name = 'boatWood';
  hull.add(woodMesh);

  // ── oars ──
  const oarGeo = (() => {
    const parts: Geo[] = [
      bake(cyl(0.02, 0.026, 2.3, 8), { color: '#c9a06a', rough: 0.6 }, { p: [0.55, 0, 0], r: [0, 0, Math.PI / 2] }),
      bake(roundedBox(0.62, 0.018, 0.17, 0.008), { color: '#a87a48', rough: 0.6 }, { p: [1.55, 0, 0] }),
      bake(roundedBox(0.1, 0.03, 0.1, 0.01), { color: '#2f8f88', rough: 0.6 }, { p: [1.3, 0, 0] }),
      bake(ellipsoid(0.04, 0.04, 0.04, 8, 6), { color: '#8a5a30', rough: 0.7 }, { p: [-0.6, 0, 0] }),
      bake(torus(0.045, 0.012, Math.PI * 2, 10, 4), { color: '#4a4a4a', rough: 0.5, metal: 0.8 }, { p: [0, 0, 0], r: [0, Math.PI / 2, 0] }),
    ];
    return merge(parts);
  })();
  bin.add(oarGeo);
  const oars: THREE.Group[] = [];
  for (const sx of [1, -1]) {
    const g = new THREE.Group();
    g.position.set(sx * 0.7, 0.46, -0.5);
    g.rotation.y = sx > 0 ? 0 : Math.PI;
    const m = new THREE.Mesh(oarGeo, wood);
    m.castShadow = true;
    g.add(m);
    hull.add(g);
    oars.push(g);
    // oarlock
    const lock = new THREE.Mesh(bin.add(merge([bake(cyl(0.018, 0.018, 0.13, 6), { color: '#4a4a4a', rough: 0.5, metal: 0.8 }, { p: [0, -0.06, 0] })])), wood);
    lock.position.set(sx * 0.7, 0.46, -0.5);
    hull.add(lock);
  }

  // ── lantern pole (starboard bow) ──
  const poleX = -0.32;
  const poleZ = 1.05;
  const pole: Geo[] = [
    bake(cyl(0.025, 0.032, 1.5, 8), { color: '#8a5c36', rough: 0.7 }, { p: [poleX, 0.72, poleZ], r: [0.06, 0, 0.06] }),
    bake(tube([[poleX + 0.03, 1.42, poleZ + 0.05], [poleX + 0.08, 1.5, poleZ + 0.24], [poleX + 0.1, 1.44, poleZ + 0.4]], 0.014, 10, 5), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }),
  ];
  const lampY = 1.2;
  const lampX = poleX + 0.1;
  const lampZ = poleZ + 0.44;
  pole.push(bake(cone(0.11, 0.09, 8), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }, { p: [lampX, lampY + 0.17, lampZ] }));
  pole.push(bake(cyl(0.09, 0.075, 0.03, 8), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }, { p: [lampX, lampY - 0.13, lampZ] }));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    pole.push(bake(cyl(0.006, 0.006, 0.28, 4), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }, { p: [lampX + Math.sin(a) * 0.085, lampY, lampZ + Math.cos(a) * 0.085] }));
  }
  pole.push(bake(torus(0.03, 0.007, Math.PI * 2, 8, 4), { color: '#3a3a3a', rough: 0.5, metal: 0.8 }, { p: [lampX, lampY + 0.24, lampZ], r: [Math.PI / 2, 0, 0] }));
  const poleMesh = new THREE.Mesh(bin.add(merge(pole)), wood);
  poleMesh.castShadow = true;
  hull.add(poleMesh);
  const glow = new THREE.Mesh(bin.add(new THREE.SphereGeometry(0.06, 12, 10)), bin.add(glowMat('#ffc06a', 5)));
  glow.position.set(lampX, lampY, lampZ);
  glow.scale.set(1, 1.35, 1);
  hull.add(glow);
  const lanternHalo = halo('#ffb060', 1.7, 0.65);
  lanternHalo.position.copy(glow.position);
  hull.add(lanternHalo);
  let lantern: THREE.PointLight | null = null;
  if (opts.lights > 0) {
    lantern = new THREE.PointLight(0xffb266, 9, 9, 2);
    lantern.position.copy(glow.position);
    hull.add(lantern);
  }

  // ── seats (direct children of root; animated with the hull) ──
  const seatBase = [new THREE.Vector3(0, -0.15, -1.3), new THREE.Vector3(0, -0.15, 0.06), new THREE.Vector3(0, -0.15, 1.02)];
  const seats: THREE.Object3D[] = seatBase.map((b, i) => {
    const o = new THREE.Object3D();
    o.name = `seat${i}`;
    o.position.copy(b);
    root.add(o);
    return o;
  });

  // seat markers
  const markerGeo = bin.add(new THREE.TorusGeometry(0.34, 0.02, 6, 32));
  const markerMats: THREE.MeshBasicNodeMaterial[] = [];
  const markers = seatBase.map((b) => {
    const m = bin.add(glowMat('#3fe0c0', 1.4, 0.8));
    markerMats.push(m);
    const mk = new THREE.Mesh(markerGeo, m);
    mk.rotation.x = Math.PI / 2;
    mk.position.set(b.x, b.y + 0.045, b.z);
    hull.add(mk);
    return mk;
  });

  // pick proxy
  const proxyGeo = bin.add(new THREE.BoxGeometry(2.0, 1.3, 4.2));
  const proxy = new THREE.Mesh(proxyGeo, bin.add(new THREE.MeshBasicNodeMaterial({ visible: false })));
  proxy.position.set(0, 0.35, 0.1);
  proxy.userData.pick = { kind: 'vehicle', id: 'vehicle' };
  proxy.name = 'pick:vehicle';
  root.add(proxy);

  // ── animation ──
  let stroke = 0;
  let mv = 0;
  let occupied = 0;
  let capacity = 2;
  const eul = new THREE.Euler();
  const tmp = new THREE.Vector3();
  const applyBob = (t: number, moving: number): void => {
    const bobY = Math.sin(t * 1.6) * 0.018 + Math.sin(t * 2.7 + 1) * 0.008 + moving * Math.sin(t * 3.4) * 0.018;
    const rx = Math.sin(t * 1.15 + 0.5) * 0.012 - moving * 0.028 + moving * Math.sin(t * 2.2) * 0.014;
    const rz = Math.sin(t * 1.3) * 0.02 + moving * Math.sin(t * 2.6 + 1) * 0.02;
    eul.set(rx, 0, rz, 'YXZ');
    hull.position.set(0, bobY, 0);
    hull.rotation.copy(eul);
    for (let i = 0; i < seats.length; i++) {
      tmp.copy(seatBase[i]!).applyEuler(eul);
      seats[i]!.position.set(tmp.x, tmp.y + bobY, tmp.z);
      seats[i]!.rotation.copy(eul);
    }
    proxy.position.y = 0.35 + bobY;
  };
  const rig: VehicleRig = {
    root,
    seats,
    docks: [new THREE.Vector3(-4.2, 0, 0), new THREE.Vector3(4.2, 0, 0)],
    yaw: [Math.PI / 2, Math.PI / 2],
    pickProxy: proxy,
    crossingTime: 3.2,
    update(dt: number, t: number, moving: number): void {
      mv += (moving - mv) * (1 - Math.exp(-dt * 4));
      stroke += dt * (1.4 + 3.6 * mv);
      applyBob(t, mv);
      const pull = clamp01((Math.cos(stroke) + 0.25) / 0.6);
      for (let i = 0; i < 2; i++) {
        const o = oars[i]!;
        const open = sstep(0.04, 0.45, mv);
        const sweep = lerp(-1.42 + Math.sin(t * 1.3 + i) * 0.01, 0.12 + Math.sin(stroke) * 0.55, open);
        const dip = lerp(0.02, lerp(0.2, -0.34, pull), open);
        o.rotation.set(0, i === 0 ? sweep : Math.PI - sweep, dip);
      }
    },
    setIndicator(info): void {
      occupied = info.count;
      capacity = info.capacity;
    },
  };
  applyBob(0, 0);

  const tick = (t: number): void => {
    for (let i = 0; i < markers.length; i++) {
      const m = markerMats[i]!;
      const active = i < capacity;
      const lit = i < occupied;
      const pulse = 0.75 + 0.25 * Math.sin(t * 3 + i * 1.7);
      if (!active) m.color.setRGB(0.02, 0.05, 0.05);
      else if (lit) m.color.setRGB(2.2 * pulse, 1.5 * pulse, 0.5 * pulse);
      else m.color.setRGB(0.15 * pulse, 1.1 * pulse, 0.9 * pulse);
      markers[i]!.scale.setScalar(lit ? 1.0 + Math.sin(t * 4 + i) * 0.03 : 0.92);
    }
    if (lantern) lantern.intensity = 9 * (0.92 + Math.sin(t * 8.1) * 0.04 + Math.sin(t * 13.7) * 0.03);
    lanternHalo.scale.setScalar(1.7 * (0.95 + Math.sin(t * 8.1) * 0.04));
  };
  return { rig, lantern, lanternHalo, tick };
}
