import * as THREE from 'three/webgpu';
import { abs, color, float, fract, mix, mx_noise_float, positionLocal, sin, smoothstep, step, time, uniform, uv, vec3 } from 'three/tsl';
import type { VehicleRig } from '../../world/types';
import { glowMat, lightShaft, mat } from '../../world/kit';
import { boxG, cylG, instancedFrom, mergeG, mtx, sphG, torG, type Env } from './env';

const DECK_Y = 0.28;
export const DOCK_Y = 0.52;
export const DOCK_X = 4.2;

/** Hover maintenance platform "Schwebeplattform" with pilot console, energy cell and status displays. */
export function buildVehicle(env: Env): VehicleRig {
  const root = new THREE.Group();
  root.name = 'vehicle:schwebeplattform';
  const body = new THREE.Group(); // visual group (bobs)
  root.add(body);

  // ───────── hull ─────────
  const hullMat = mat('#232a37', 0.42, 0.85);
  const frameMat = mat('#39445a', 0.35, 0.9);

  const hull = mergeG([
    boxG(3.5, 0.16, 3.1, [0, DECK_Y - 0.08, 0]),
    boxG(2.7, 0.2, 2.3, [0, DECK_Y - 0.26, 0]),
    boxG(1.6, 0.16, 1.4, [0, DECK_Y - 0.42, 0]),
    // side skirts
    boxG(0.1, 0.22, 3.1, [1.8, DECK_Y - 0.1, 0]),
    boxG(0.1, 0.22, 3.1, [-1.8, DECK_Y - 0.1, 0]),
    boxG(3.7, 0.22, 0.1, [0, DECK_Y - 0.1, 1.6]),
    boxG(3.7, 0.22, 0.1, [0, DECK_Y - 0.1, -1.6]),
  ]);
  const hullMesh = new THREE.Mesh(hull, hullMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  body.add(hullMesh);

  // deck plating with grid lines (TSL)
  const deckMat = mat('#10151d', 0.5, 0.55);
  {
    const g = uv().mul(8);
    const f = abs(fract(g).sub(0.5));
    const seam = smoothstep(0.44, 0.5, f.x.max(f.y));
    deckMat.colorNode = mix(color('#151b25'), color('#0a0e14'), seam);
    deckMat.emissiveNode = color('#12c8ff').mul(seam.mul(0.35));
  }
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.9).rotateX(-Math.PI / 2), deckMat);
  deck.position.y = DECK_Y + 0.004;
  deck.receiveShadow = true;
  body.add(deck);

  // hazard edge stripes (diagonal TSL)
  const stripeMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2 });
  {
    const u = uv();
    const s = step(0.5, fract(u.x.add(u.y).mul(1)));
    stripeMat.colorNode = mix(color('#101010'), color('#e8b000'), s);
  }
  const stripes: THREE.BufferGeometry[] = [];
  const stripeGeo = (len: number, horiz: boolean, x: number, z: number): THREE.BufferGeometry => {
    const g = new THREE.PlaneGeometry(horiz ? len : 0.16, horiz ? 0.16 : len, horiz ? Math.round(len * 6) : 1, 1);
    // scale uv for repeated stripes
    const uvA = g.getAttribute('uv');
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * (horiz ? len * 4 : 1), uvA.getY(i) * (horiz ? 1 : len * 4));
    g.rotateX(-Math.PI / 2);
    g.translate(x, DECK_Y + 0.006, z);
    return g;
  };
  stripes.push(stripeGeo(3.3, true, 0, 1.38), stripeGeo(3.3, true, 0, -1.38), stripeGeo(2.9, false, 1.58, 0), stripeGeo(2.9, false, -1.58, 0));
  const stripeMesh = new THREE.Mesh(mergeG(stripes.map((g) => g)), stripeMat);
  body.add(stripeMesh);

  // ───────── hover pads ─────────
  const padMat = glowMat('#20e8ff', 2.6);
  const padGlowBase = new THREE.Color('#20e8ff');
  const padPods: THREE.BufferGeometry[] = [];
  const padDiscs: THREE.BufferGeometry[] = [];
  const padPos: Array<[number, number]> = [
    [1.4, 1.15],
    [-1.4, 1.15],
    [1.4, -1.15],
    [-1.4, -1.15],
  ];
  for (const [px, pz] of padPos) {
    padPods.push(cylG(0.5, 0.42, 0.2, 20, [px, DECK_Y - 0.36, pz]));
    padPods.push(torG(0.46, 0.025, 28, 6, [px, DECK_Y - 0.27, pz], [Math.PI / 2, 0, 0]));
    padDiscs.push(cylG(0.38, 0.38, 0.03, 24, [px, DECK_Y - 0.47, pz]));
  }
  const podMesh = new THREE.Mesh(mergeG(padPods), frameMat);
  podMesh.castShadow = true;
  body.add(podMesh);
  const padMesh = new THREE.Mesh(mergeG(padDiscs), padMat);
  body.add(padMesh);
  // soft glow cones under pads (additive shafts)
  const shafts: THREE.Mesh[] = [];
  for (const [px, pz] of padPos) {
    const s = lightShaft('#20e8ff', 0.75, 0.35, 0.6, 0.5);
    s.position.set(px, DECK_Y - 0.48, pz);
    body.add(s);
    shafts.push(s);
  }
  const padLight = env.addLight('#20e8ff', 6, 6, 0, DECK_Y - 0.55, 0, body);

  // ───────── railing ─────────
  const railGeos: THREE.BufferGeometry[] = [];
  const railGlow: THREE.BufferGeometry[] = [];
  const postAt = (x: number, z: number): void => {
    railGeos.push(cylG(0.028, 0.034, 1.02, 8, [x, DECK_Y + 0.51, z]));
  };
  // front/back (z = ±1.5) full, sides (x = ±1.7) with boarding gaps |z| < 0.85
  for (let x = -1.7; x <= 1.71; x += 0.85) {
    postAt(x, 1.5);
    postAt(x, -1.5);
  }
  for (const sx of [-1.7, 1.7]) {
    for (const z of [-1.5, -1.05, 1.05, 1.5]) postAt(sx, z);
    // gate posts (thicker, hazard)
    railGeos.push(boxG(0.09, 1.1, 0.09, [sx, DECK_Y + 0.55, 0.85]), boxG(0.09, 1.1, 0.09, [sx, DECK_Y + 0.55, -0.85]));
    railGlow.push(boxG(0.03, 0.9, 0.03, [sx + (sx > 0 ? 0.06 : -0.06), DECK_Y + 0.5, 0.85]), boxG(0.03, 0.9, 0.03, [sx + (sx > 0 ? 0.06 : -0.06), DECK_Y + 0.5, -0.85]));
    // rails on the two short segments
    for (const [z0, z1] of [
      [-1.5, -0.85],
      [0.85, 1.5],
    ] as Array<[number, number]>) {
      const len = z1 - z0;
      railGeos.push(boxG(0.045, 0.045, len, [sx, DECK_Y + 1.0, (z0 + z1) / 2]), boxG(0.03, 0.03, len, [sx, DECK_Y + 0.55, (z0 + z1) / 2]));
      railGlow.push(boxG(0.02, 0.02, len, [sx, DECK_Y + 1.03, (z0 + z1) / 2]));
    }
  }
  railGeos.push(boxG(3.4, 0.045, 0.045, [0, DECK_Y + 1.0, -1.5]), boxG(3.4, 0.03, 0.03, [0, DECK_Y + 0.55, -1.5]));
  railGeos.push(boxG(3.4, 0.045, 0.045, [0, DECK_Y + 1.0, 1.5]), boxG(3.4, 0.03, 0.03, [0, DECK_Y + 0.55, 1.5]));
  railGlow.push(boxG(3.4, 0.02, 0.02, [0, DECK_Y + 1.03, -1.5]), boxG(3.4, 0.02, 0.02, [0, DECK_Y + 1.03, 1.5]));
  const railMesh = new THREE.Mesh(mergeG(railGeos), frameMat);
  railMesh.castShadow = true;
  body.add(railMesh);
  const railGlowMat = glowMat('#ffb020', 2.2);
  body.add(new THREE.Mesh(mergeG(railGlow), railGlowMat));

  // ───────── pilot console (front, +Z) ─────────
  const consoleMat = mat('#1b2230', 0.35, 0.8);
  const consoleGeo = mergeG([
    boxG(1.5, 0.78, 0.44, [0, DECK_Y + 0.39, 1.16]),
    boxG(1.5, 0.05, 0.5, [0, DECK_Y + 0.8, 1.16], [-0.42, 0, 0]),
    boxG(0.08, 0.5, 0.08, [-0.5, DECK_Y + 0.98, 1.2]),
    boxG(0.08, 0.5, 0.08, [0.5, DECK_Y + 0.98, 1.2]),
    cylG(0.03, 0.03, 0.34, 8, [0.42, DECK_Y + 0.96, 1.04], [0.4, 0, 0]),
    sphG(0.05, 10, 8, [0.42, DECK_Y + 1.12, 0.98]),
  ]);
  const consoleMesh = new THREE.Mesh(consoleGeo, consoleMat);
  consoleMesh.castShadow = true;
  body.add(consoleMesh);
  // screen on the sloped top
  const screenMat = new THREE.MeshBasicNodeMaterial();
  {
    const u = uv();
    const scan = sin(u.y.mul(90).sub(time.mul(5))).mul(0.5).add(0.5);
    const grid = step(0.94, fract(u.x.mul(10))).add(step(0.94, fract(u.y.mul(6)))).mul(0.5);
    const blip = smoothstep(0.03, 0, abs(fract(u.x.mul(0.6).add(time.mul(0.35))).sub(u.y))).mul(2);
    const wave = smoothstep(0.02, 0, abs(u.y.sub(sin(u.x.mul(14).add(time.mul(3))).mul(0.25).add(0.5)))).mul(1.6);
    screenMat.colorNode = vec3(0.05, 0.75, 1.0).mul(scan.mul(0.35).add(0.25).add(grid).add(blip).add(wave)).add(vec3(0.0, 0.03, 0.06));
  }
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.42), screenMat);
  screen.position.set(0, DECK_Y + 0.812, 1.2);
  screen.rotation.set(-Math.PI / 2 + 0.42, 0, 0);
  screen.position.z = 1.155;
  screen.position.y = DECK_Y + 0.83;
  screen.rotation.x = -Math.PI / 2 + 0.42;
  body.add(screen);
  // console side status lamps
  const lampGeo = sphG(0.05, 10, 8);
  const lampMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2, 2, 2) });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 4);
  lamps.frustumCulled = false;
  const lampOff = new THREE.Color('#1a1e26');
  for (let i = 0; i < 4; i++) {
    lamps.setMatrixAt(i, mtx([-0.6 + i * 0.16, DECK_Y + 0.82, 1.42]));
    lamps.setColorAt(i, lampOff);
  }
  body.add(lamps);

  // energy bar (rear face of console, +Z side, faces camera)
  const N = 12;
  const barMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) });
  const barGeo = boxG(0.085, 0.14, 0.03);
  const barMats: THREE.Matrix4[] = [];
  for (let i = 0; i < N; i++) barMats.push(mtx([-0.55 + i * 0.1, DECK_Y + 0.5, 1.4]));
  const bar = instancedFrom(barGeo, barMat, barMats, [new THREE.Color('#222')]);
  body.add(bar);
  body.add(new THREE.Mesh(boxG(1.3, 0.24, 0.02, [0, DECK_Y + 0.5, 1.385]), mat('#070a10', 0.4, 0.5)));
  // occupancy row (pips above bar)
  const pipMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.4, 2.4, 2.4) });
  const pips = new THREE.InstancedMesh(sphG(0.045, 10, 8), pipMat, 4);
  pips.frustumCulled = false;
  for (let i = 0; i < 4; i++) {
    pips.setMatrixAt(i, mtx([-0.15 + i * 0.1, DECK_Y + 0.66, 1.4]));
    pips.setColorAt(i, lampOff);
  }
  body.add(pips);

  // ───────── energy cell (rear centre) ─────────
  const cellZ = -1.0;
  const cell = new THREE.Group();
  cell.position.set(0, DECK_Y, cellZ);
  body.add(cell);
  const cellFrame = mergeG([
    cylG(0.38, 0.44, 0.14, 20, [0, 0.07, 0]),
    cylG(0.34, 0.34, 0.1, 20, [0, 1.15, 0]),
    ...[
      [0.3, 0.3],
      [-0.3, 0.3],
      [0.3, -0.3],
      [-0.3, -0.3],
    ].map(([x, z]) => cylG(0.028, 0.028, 1.08, 8, [x!, 0.6, z!])),
    torG(0.3, 0.02, 28, 6, [0, 0.4, 0], [Math.PI / 2, 0, 0]),
    torG(0.3, 0.02, 28, 6, [0, 0.8, 0], [Math.PI / 2, 0, 0]),
  ]);
  const cellFrameMesh = new THREE.Mesh(cellFrame, frameMat);
  cellFrameMesh.castShadow = true;
  cell.add(cellFrameMesh);
  const uCellCol = uniform(new THREE.Color('#3dffb0'));
  const uPulse = uniform(1);
  const coreMat = new THREE.MeshBasicNodeMaterial();
  coreMat.colorNode = uCellCol.mul(
    mx_noise_float(vec3(positionLocal.x.mul(7), positionLocal.y.mul(4).sub(time.mul(2.4)), positionLocal.z.mul(7))).mul(0.6).add(1.9),
  ).mul(uPulse);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.86, 20, 6), coreMat);
  core.position.y = 0.62;
  cell.add(core);
  const haloMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  haloMat.colorNode = uCellCol.mul(1.2);
  haloMat.opacityNode = smoothstep(0.0, 0.25, uv().y).mul(smoothstep(1.0, 0.75, uv().y)).mul(0.28).mul(uPulse);
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 1.0, 20, 1, true), haloMat);
  halo.position.y = 0.62;
  cell.add(halo);
  const ringMatA = new THREE.MeshBasicNodeMaterial();
  ringMatA.colorNode = uCellCol.mul(2.4);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 6, 32), ringMatA);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 6, 32), ringMatA);
  ringA.position.y = 0.62;
  ringB.position.y = 0.62;
  cell.add(ringA, ringB);
  const cellLight = env.addLight('#3dffb0', 14, 9, 0, DECK_Y + 0.7, cellZ, body);

  // ───────── thrusters (rear corners, glow ∝ moving) ─────────
  const thrMat = glowMat('#7a5cff', 2);
  const thrGeo = mergeG([cylG(0.14, 0.2, 0.34, 14, [1.55, DECK_Y - 0.05, -1.62], [Math.PI / 2, 0, 0]), cylG(0.14, 0.2, 0.34, 14, [-1.55, DECK_Y - 0.05, -1.62], [Math.PI / 2, 0, 0])]);
  body.add(new THREE.Mesh(thrGeo, frameMat));
  const thrGlowGeo = mergeG([cylG(0.11, 0.11, 0.03, 14, [1.55, DECK_Y - 0.05, -1.8], [Math.PI / 2, 0, 0]), cylG(0.11, 0.11, 0.03, 14, [-1.55, DECK_Y - 0.05, -1.8], [Math.PI / 2, 0, 0])]);
  body.add(new THREE.Mesh(thrGlowGeo, thrMat));
  const wakeShafts: THREE.Mesh[] = [];
  for (const sx of [1.55, -1.55]) {
    const s = lightShaft('#7a5cff', 1.6, 0.1, 0.35, 0.6);
    s.rotation.x = -Math.PI / 2;
    s.position.set(sx, DECK_Y - 0.05, -1.8);
    body.add(s);
    wakeShafts.push(s);
  }
  // beacon on the console mast
  const beaconMat = glowMat('#ff2e5a', 3);
  const beacon = new THREE.Mesh(sphG(0.06, 10, 8), beaconMat);
  beacon.position.set(-0.5, DECK_Y + 1.28, 1.2);
  body.add(beacon);

  // underside cargo lights
  const under = new THREE.Mesh(boxG(1.2, 0.03, 0.03, [0, DECK_Y - 0.52, 0]), glowMat('#ff2fd0', 2.2));
  body.add(under);

  // ───────── seats / dock / pick ─────────
  const seatBase: Array<[number, number, number, number]> = [
    [0, DECK_Y, 0.55, 0],
    [-0.9, DECK_Y, -0.15, 0.4],
    [0.9, DECK_Y, -0.15, -0.4],
    [0, DECK_Y, -0.05, 0],
  ];
  const seats: THREE.Object3D[] = seatBase.map(([x, y, z, ry], i) => {
    const s = new THREE.Object3D();
    s.name = `seat${i}`;
    s.position.set(x, y, z);
    s.rotation.y = ry;
    root.add(s);
    return s;
  });

  const pickGeo = new THREE.BoxGeometry(3.7, 1.8, 3.3);
  pickGeo.translate(0, 0.9, 0);
  const pickProxy = new THREE.Mesh(pickGeo, new THREE.MeshBasicNodeMaterial({ visible: false }));
  pickProxy.name = 'pick:vehicle';
  pickProxy.userData.pick = { kind: 'vehicle', id: 'vehicle' };
  root.add(pickProxy);

  const docks: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-DOCK_X, DOCK_Y, 0), new THREE.Vector3(DOCK_X, DOCK_Y, 0)];
  root.position.copy(docks[0]);
  env.root.add(root);

  // ───────── state ─────────
  let movingSmooth = 0;
  let energyFrac = 1;
  let count = 0;
  let capacity = 2;
  const tmpC = new THREE.Color();
  const levelColor = (f: number, out: THREE.Color): THREE.Color => {
    // green (1) → amber (0.45) → red (0)
    if (f > 0.45) return out.set('#ffb020').lerp(tmpC.set('#3dffb0'), (f - 0.45) / 0.55);
    return out.set('#ff2e3a').lerp(tmpC.set('#ffb020'), f / 0.45);
  };
  const refreshIndicator = (): void => {
    const lit = Math.ceil(energyFrac * N - 1e-6);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const pos = i / (N - 1);
      levelColor(pos, c);
      if (i >= lit) c.multiplyScalar(0.05);
      bar.setColorAt(i, c);
    }
    if (bar.instanceColor) bar.instanceColor.needsUpdate = true;
    levelColor(energyFrac, c);
    uCellCol.value.copy(c);
    if (cellLight) cellLight.color.copy(c);
    ringMatA.colorNode = uCellCol.mul(2.4);
    for (let i = 0; i < 4; i++) {
      const on = i < count && i < capacity;
      const shown = i < capacity;
      pips.setColorAt(i, on ? tmpC.set('#7cffff') : shown ? tmpC.set('#141a22') : tmpC.set('#000000'));
      lamps.setColorAt(i, on ? tmpC.set('#7cffff') : i === 3 ? tmpC.set('#ff5a2e') : lampOff);
    }
    if (pips.instanceColor) pips.instanceColor.needsUpdate = true;
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  };
  refreshIndicator();

  const tc = new THREE.Color();
  const update = (dt: number, t: number, moving: number): void => {
    movingSmooth += (moving - movingSmooth) * (1 - Math.exp(-dt * 5));
    const bob = Math.sin(t * 1.6) * 0.03 + Math.sin(t * 2.7 + 1) * 0.012;
    const pitch = Math.sin(t * 1.1) * 0.006 + movingSmooth * 0.035;
    const roll = Math.sin(t * 0.9 + 2) * 0.008;
    body.position.y = bob;
    body.rotation.x = pitch;
    body.rotation.z = roll;
    for (let i = 0; i < seats.length; i++) seats[i]!.position.y = seatBase[i]![1] + bob;
    // pads pulse & thruster glow
    const pulse = 0.75 + 0.25 * Math.sin(t * 6 + 0.5) + movingSmooth * 0.5;
    padMat.color.copy(padGlowBase).multiplyScalar(2.2 * pulse);
    for (let i = 0; i < shafts.length; i++) {
      const m = shafts[i]!.material as THREE.MeshBasicNodeMaterial;
      m.opacity = 1;
      shafts[i]!.scale.set(1 + movingSmooth * 0.3, 1 + movingSmooth * 1.1 + Math.sin(t * 8 + i) * 0.05, 1 + movingSmooth * 0.3);
    }
    if (padLight) padLight.intensity = 5 + pulse * 3;
    thrMat.color.set('#7a5cff').multiplyScalar(0.4 + movingSmooth * 4.2);
    for (const s of wakeShafts) s.scale.set(0.6 + movingSmooth, 0.2 + movingSmooth * 1.6, 0.6 + movingSmooth);
    // cell animation
    uPulse.value = 0.85 + 0.15 * Math.sin(t * 3.1) + movingSmooth * 0.25;
    ringA.rotation.set(t * 1.3, t * 0.7, 0);
    ringB.rotation.set(t * -0.9 + 1.2, 0, t * 1.1);
    core.rotation.y = t * 0.8;
    if (cellLight) cellLight.intensity = 10 + Math.sin(t * 3.1) * 2 + movingSmooth * 5;
    beaconMat.color.copy(tc.set('#ff2e5a').multiplyScalar(Math.sin(t * 5) > 0 ? 3.2 : 0.3));
    void float;
  };

  const setIndicator: NonNullable<VehicleRig['setIndicator']> = (info) => {
    count = info.count;
    capacity = info.capacity;
    if (info.maxEnergy && info.maxEnergy > 0 && info.energy !== undefined) energyFrac = Math.max(0, Math.min(1, info.energy / info.maxEnergy));
    refreshIndicator();
  };

  return { root, seats, docks, yaw: [0, 0], pickProxy, crossingTime: 2.8, update, setIndicator };
}
