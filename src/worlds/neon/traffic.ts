import * as THREE from 'three/webgpu';
import { attribute, smoothstep, uv } from 'three/tsl';
import { rng } from '../../world/kit';
import { boxG, cylG, mergeG, sphG, type Env } from './env';

interface Lane {
  y: number;
  z: number;
  x: number;
  dirAxis: 'x' | 'z';
  speed: number;
  count: number;
  span: number;
  dir: 1 | -1;
}

/** Flying traffic lanes with light trails + patrol drones with blinking lights. */
export function buildTraffic(env: Env): void {
  const { root, q } = env;
  const R = rng(4242);
  const lanes: Lane[] = [
    { y: 34, z: -46, x: 0, dirAxis: 'x', speed: 16, count: 16, span: 190, dir: 1 },
    { y: 41, z: -60, x: 0, dirAxis: 'x', speed: 22, count: 14, span: 220, dir: -1 },
    { y: 27, z: -32, x: 0, dirAxis: 'x', speed: 12, count: 12, span: 170, dir: -1 },
    { y: 52, z: -80, x: 0, dirAxis: 'x', speed: 26, count: 12, span: 260, dir: 1 },
    { y: 30, z: 0, x: -30, dirAxis: 'z', speed: 14, count: 12, span: 220, dir: 1 },
    { y: 37, z: 0, x: 30, dirAxis: 'z', speed: 18, count: 12, span: 220, dir: -1 },
    { y: 46, z: 0, x: -60, dirAxis: 'z', speed: 20, count: 10, span: 260, dir: -1 },
  ];
  const scale = Math.max(0.4, q.density);
  const total = lanes.reduce((n, l) => n + Math.round(l.count * scale), 0);

  // vehicles: sleek wedge with headlight/taillight tints via instanceColor
  const carGeo = mergeG([boxG(2.6, 0.5, 1.1, [0, 0, 0]), boxG(1.3, 0.35, 0.9, [-0.2, 0.32, 0]), sphG(0.28, 8, 6, [1.3, 0, 0], [0.5, 0.5, 1.6])]);
  const carMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(1.6, 1.6, 1.6) });
  const cars = new THREE.InstancedMesh(carGeo, carMat, total);
  cars.frustumCulled = false;
  const trailGeo = new THREE.PlaneGeometry(1, 1);
  const trailMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  {
    const u = uv();
    trailMat.colorNode = attribute('aTint', 'vec3').mul(2.0);
    trailMat.opacityNode = smoothstep(1.0, 0.0, u.x).mul(smoothstep(0.0, 0.3, u.y).mul(smoothstep(1.0, 0.7, u.y))).mul(0.55);
  }
  const tints = new Float32Array(total * 3);
  const tintPal = [new THREE.Color('#ff2fd0'), new THREE.Color('#19d9ff'), new THREE.Color('#ffb020'), new THREE.Color('#ffffff'), new THREE.Color('#7a5cff')];
  const trails = new THREE.InstancedMesh(trailGeo, trailMat, total);
  trails.frustumCulled = false;
  const items: Array<{ lane: Lane; off: number; jitter: number; lat: number; tail: number }> = [];
  let k = 0;
  for (const lane of lanes) {
    const n = Math.round(lane.count * scale);
    for (let i = 0; i < n; i++) {
      const c = tintPal[Math.floor(R() * tintPal.length)]!;
      cars.setColorAt(k, c.clone().lerp(new THREE.Color('#ffffff'), 0.35));
      tints[k * 3] = c.r;
      tints[k * 3 + 1] = c.g;
      tints[k * 3 + 2] = c.b;
      items.push({ lane, off: R(), jitter: (R() - 0.5) * 3, lat: (R() - 0.5) * 6, tail: 7 + R() * 9 });
      k++;
    }
  }
  trailGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
  root.add(cars, trails);

  // ground traffic on the bridge deck (z0 = -17, deck y = 8.6)
  const groundCars = new THREE.InstancedMesh(boxG(2.2, 0.55, 1.0, [0, 0.3, 0]), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(1.4, 1.4, 1.4) }), 6);
  groundCars.frustumCulled = false;
  for (let i = 0; i < 6; i++) groundCars.setColorAt(i, new THREE.Color(i % 2 ? '#ff4a5a' : '#ffe8b0'));
  root.add(groundCars);

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const sc = new THREE.Vector3(1, 1, 1);
  const eul = new THREE.Euler();
  const sc2 = new THREE.Vector3();

  // ───────── patrol drones (all instanced: 5 draw calls total) ─────────
  const droneBodyGeo = mergeG([
    sphG(0.32, 12, 8, [0, 0, 0], [1.2, 0.55, 1.2]),
    boxG(1.3, 0.06, 0.06, [0, 0.05, 0], [0, Math.PI / 4, 0]),
    boxG(1.3, 0.06, 0.06, [0, 0.05, 0], [0, -Math.PI / 4, 0]),
    cylG(0.06, 0.06, 0.1, 8, [0.46, 0.06, 0.46]),
    cylG(0.06, 0.06, 0.1, 8, [-0.46, 0.06, 0.46]),
    cylG(0.06, 0.06, 0.1, 8, [0.46, 0.06, -0.46]),
    cylG(0.06, 0.06, 0.1, 8, [-0.46, 0.06, -0.46]),
    sphG(0.1, 8, 6, [0, -0.2, 0.3]),
  ]);
  const droneMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#2b3244'), roughness: 0.35, metalness: 0.85 });
  const nDrones = Math.max(4, Math.round(9 * scale));
  const drones: Array<{ cx: number; cz: number; rx: number; rz: number; y: number; sp: number; ph: number; s: number }> = [];
  for (let i = 0; i < nDrones; i++) {
    drones.push({ cx: (R() - 0.5) * 30, cz: -6 + (R() - 0.5) * 50, rx: 8 + R() * 22, rz: 5 + R() * 14, y: 6 + R() * 13, sp: (0.08 + R() * 0.12) * (R() > 0.5 ? 1 : -1), ph: R() * 6.28, s: 0.9 + R() * 0.7 });
  }
  const mk = (geo: THREE.BufferGeometry, m: THREE.Material): THREE.InstancedMesh => {
    const im = new THREE.InstancedMesh(geo, m, nDrones);
    im.frustumCulled = false;
    return im;
  };
  const bodies = mk(droneBodyGeo, droneMat);
  const reds = mk(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(4, 0.2, 0.25) }));
  const greens = mk(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.3, 4, 0.6) }));
  const whites = mk(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3, 3, 3.4) }));
  const rotors = mk(new THREE.CylinderGeometry(0.34, 0.34, 0.01, 14), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.5, 0.7, 1.0), transparent: true, opacity: 0.22, depthWrite: false }));
  root.add(bodies, reds, greens, whites, rotors);
  const offRed = new THREE.Matrix4().makeTranslation(-0.75, 0.05, -0.75);
  const offGrn = new THREE.Matrix4().makeTranslation(0.75, 0.05, -0.75);
  const offWht = new THREE.Matrix4().makeTranslation(0, -0.28, 0.35);
  const offRotor = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.16, 0), new THREE.Quaternion(), new THREE.Vector3(3.5, 1, 3.5));
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const dm = new THREE.Matrix4();
  const tm = new THREE.Matrix4();
  const dq = new THREE.Quaternion();
  const de = new THREE.Euler();
  const dp = new THREE.Vector3();
  const ds = new THREE.Vector3();
  const spin = new THREE.Matrix4();

  const dir = new THREE.Vector3();
  env.updaters.push((dt, t) => {
    void dt;
    // vehicles
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const L = it.lane;
      const u = ((it.off + (t * L.speed * L.dir) / L.span) % 1 + 1) % 1;
      const along = (u - 0.5) * L.span;
      if (L.dirAxis === 'x') pos.set(along, L.y + it.jitter, L.z + it.lat);
      else pos.set(L.x + it.lat, L.y + it.jitter, along);
      const yaw = L.dirAxis === 'x' ? (L.dir > 0 ? 0 : Math.PI) : L.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      eul.set(0, yaw, 0);
      quat.setFromEuler(eul);
      sc.set(1, 1, 1);
      cars.setMatrixAt(i, m4.compose(pos, quat, sc));
      // trail behind the car (along local -X)
      const back = -it.tail / 2 - 1.3;
      dir.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const tp = pos.clone().addScaledVector(dir, back);
      const tq = quat.clone();
      sc2.set(it.tail, 0.28, 1);
      trails.setMatrixAt(i, m4.compose(tp, tq.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))), sc2));
    }
    cars.instanceMatrix.needsUpdate = true;
    trails.instanceMatrix.needsUpdate = true;
    // bridge traffic
    for (let i = 0; i < 6; i++) {
      const lane = i % 2 ? 1 : -1;
      const u = (((i * 0.31 + t * 0.045 * (lane > 0 ? 1 : -1)) % 1) + 1) % 1;
      pos.set((u - 0.5) * 54, 8.55, -17 + lane * 1.5);
      eul.set(0, lane > 0 ? 0 : Math.PI, 0);
      quat.setFromEuler(eul);
      sc.set(1, 1, 1);
      groundCars.setMatrixAt(i, m4.compose(pos, quat, sc));
    }
    groundCars.instanceMatrix.needsUpdate = true;
    // drones
    for (let i = 0; i < drones.length; i++) {
      const d = drones[i]!;
      const a = t * d.sp + d.ph;
      dp.set(d.cx + Math.cos(a) * d.rx, d.y + Math.sin(t * 1.3 + d.ph) * 0.35, d.cz + Math.sin(a) * d.rz);
      dir.set(-Math.sin(a) * d.rx * Math.sign(d.sp), 0, Math.cos(a) * d.rz * Math.sign(d.sp));
      de.set(0.08, Math.atan2(dir.x, dir.z), Math.sin(t * 1.1 + d.ph) * 0.06);
      dq.setFromEuler(de);
      ds.setScalar(d.s);
      dm.compose(dp, dq, ds);
      bodies.setMatrixAt(i, dm);
      const b = Math.sin(t * 5 + d.ph * 3) > 0.2;
      reds.setMatrixAt(i, b ? tm.multiplyMatrices(dm, offRed) : zero);
      greens.setMatrixAt(i, !b || Math.sin(t * 2.3 + d.ph) > 0.7 ? tm.multiplyMatrices(dm, offGrn) : zero);
      whites.setMatrixAt(i, tm.multiplyMatrices(dm, offWht));
      spin.makeRotationY(t * 40 + i);
      rotors.setMatrixAt(i, tm.multiplyMatrices(dm, spin.multiply(offRotor)));
    }
    bodies.instanceMatrix.needsUpdate = true;
    reds.instanceMatrix.needsUpdate = true;
    greens.instanceMatrix.needsUpdate = true;
    whites.instanceMatrix.needsUpdate = true;
    rotors.instanceMatrix.needsUpdate = true;
  });
}
