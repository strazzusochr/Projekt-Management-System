import * as THREE from 'three/webgpu';
import { color, float, fract, mix, smoothstep, step, uniform, uv } from 'three/tsl';
import { lightShaft } from '../../world/kit';
import { PropBuilder, S, createPropMaterial, groundHeight, type WorldCtx } from './common';

// ───────────────────────── patrol drones ─────────────────────────

interface DroneState {
  root: THREE.Group;
  shaft: THREE.Mesh;
  pos: (t: number, out: THREE.Vector3) => void;
  last: THREE.Vector3;
  yaw: number;
  bank: number;
  phase: number;
}

export interface Drones {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

export function createDrones(ctx: WorldCtx): Drones {
  const d = ctx.dispose;
  const group = new THREE.Group();
  group.name = 'drones';
  const B = new PropBuilder();
  // body
  B.rbox(0.46, 0.13, 0.36, 0.05, { color: '#dfe6ee', rough: 0.4, metal: 0.2 }, { p: [0, 0, 0] });
  B.rbox(0.3, 0.06, 0.24, 0.03, { color: '#2a3340', rough: 0.4, metal: 0.5 }, { p: [0, 0.08, 0] });
  B.box(0.47, 0.03, 0.06, { color: '#e2661c', rough: 0.5 }, { p: [0, 0.02, 0.0] });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      B.rod([sx * 0.18, 0, sz * 0.14], [sx * 0.36, 0.05, sz * 0.32], 0.018, { color: '#2a3340', rough: 0.4, metal: 0.6 }, 5);
      B.cyl(0.05, 0.05, 0.08, { color: '#1a2029', rough: 0.4, metal: 0.7 }, { p: [sx * 0.36, 0.07, sz * 0.32] }, 8);
      B.cyl(0.012, 0.012, 0.04, S.steel, { p: [sx * 0.36, 0.13, sz * 0.32] }, 5);
    }
  }
  // gimbal camera
  B.ell(0.07, 0.07, 0.07, { color: '#1b222c', rough: 0.3, metal: 0.6 }, { p: [0, -0.11, 0.08] }, 10, 8);
  B.ell(0.03, 0.03, 0.03, S.cyan(3.0), { p: [0, -0.115, 0.14] }, 8, 6);
  B.cyl(0.02, 0.02, 0.1, S.darkSteel, { p: [0, -0.16, -0.06], r: [0.5, 0, 0] }, 5);
  const bodyGeo = d.add(B.build());
  const bodyMat = d.add(createPropMaterial({ snow: 0.4 }));

  const paths: Array<{ pos: (t: number, o: THREE.Vector3) => void; phase: number }> = [
    { pos: (t, o) => o.set(-14.5 + Math.cos(t * 0.21) * 8.5, 6.4 + Math.sin(t * 0.7) * 0.25, 3 + Math.sin(t * 0.21) * 8.0), phase: 0 },
    { pos: (t, o) => o.set(Math.sin(t * 0.17) * 6.5, 7.4 + Math.sin(t * 0.5) * 0.3, -16 + Math.sin(t * 0.34) * 12.5), phase: 1.3 },
    { pos: (t, o) => o.set(14.5 + Math.cos(-t * 0.19 + 1.0) * 9.0, 5.6 + Math.sin(t * 0.6) * 0.25, -1 + Math.sin(-t * 0.19 + 1.0) * 7.5), phase: 2.6 },
  ];

  const drones: DroneState[] = paths.map((p, i) => {
    const root = new THREE.Group();
    root.name = `drone${i}`;
    const mesh = new THREE.Mesh(bodyGeo, bodyMat);
    mesh.castShadow = false;
    root.add(mesh);
    const shaft = lightShaft(i === 1 ? '#8fdcff' : '#ffe2b0', 1, 0.05, 1.35, 0.32);
    d.add(shaft.geometry);
    d.add(shaft.material as THREE.Material);
    shaft.position.set(0, -0.14, 0.1);
    root.add(shaft);
    group.add(root);
    const last = new THREE.Vector3();
    p.pos(0, last);
    return { root, shaft, pos: p.pos, last, yaw: 0, bank: 0, phase: p.phase };
  });

  // rotors (instanced, matrices updated per frame)
  const rotorGeo = d.add(new THREE.CircleGeometry(0.2, 16));
  rotorGeo.rotateX(-Math.PI / 2);
  const rotorMat = d.add(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  {
    const p = uv().sub(0.5).mul(2);
    const r = p.length();
    const blades = step(0.5, fract(p.x.mul(0.0).add(uv().y.mul(0.0)).add(r.mul(6.0))));
    void blades;
    rotorMat.colorNode = color(new THREE.Color('#9fb3c8'));
    rotorMat.opacityNode = smoothstep(1.0, 0.7, r).mul(float(0.16)).add(smoothstep(0.98, 0.9, r).mul(smoothstep(0.75, 0.85, r)).mul(0.22));
  }
  const rotors = new THREE.InstancedMesh(rotorGeo, rotorMat, drones.length * 4);
  rotors.frustumCulled = false;
  rotors.renderOrder = 5;
  group.add(rotors);

  // navigation lights (instanced): red / green / strobe per drone
  const lightGeo = d.add(new THREE.SphereGeometry(0.035, 8, 6));
  const lightMat = d.add(new THREE.MeshBasicNodeMaterial());
  lightMat.colorNode = color(new THREE.Color(1, 1, 1)).mul(3.4);
  const lights = new THREE.InstancedMesh(lightGeo, lightMat, drones.length * 3);
  lights.frustumCulled = false;
  const cols = [new THREE.Color('#ff2a1c'), new THREE.Color('#22ff6a'), new THREE.Color('#ffffff')];
  for (let i = 0; i < drones.length; i++) for (let k = 0; k < 3; k++) lights.setColorAt(i * 3 + k, cols[k]!);
  if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
  group.add(lights);

  const m4 = new THREE.Matrix4();
  const mLocal = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const tmp = new THREE.Vector3();
  const rotorOff = [new THREE.Vector3(0.36, 0.13, 0.32), new THREE.Vector3(-0.36, 0.13, 0.32), new THREE.Vector3(0.36, 0.13, -0.32), new THREE.Vector3(-0.36, 0.13, -0.32)];
  const lightOff = [new THREE.Vector3(0.24, 0.04, -0.17), new THREE.Vector3(-0.24, 0.04, -0.17), new THREE.Vector3(0, 0.12, -0.05)];
  const scl = new THREE.Vector3();

  return {
    group,
    update(dt, t) {
      drones.forEach((dr, i) => {
        dr.pos(t + dr.phase * 5, tmp);
        const vx = tmp.x - dr.last.x;
        const vz = tmp.z - dr.last.z;
        const sp = Math.hypot(vx, vz) / Math.max(dt, 1e-4);
        if (sp > 0.05) {
          const goal = Math.atan2(vx, vz);
          let dy = goal - dr.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          dr.yaw += dy * (1 - Math.exp(-dt * 2.5));
          dr.bank += ((-dy * 0.6 * Math.min(1, sp * 0.4)) - dr.bank) * (1 - Math.exp(-dt * 3));
        }
        dr.last.copy(tmp);
        dr.root.position.copy(tmp);
        dr.root.rotation.set(0.06 * Math.min(1, sp * 0.3), dr.yaw, dr.bank);
        // spot cone reaches the ground
        const gh = groundHeight(tmp.x, tmp.z);
        const h = Math.max(1, tmp.y - Math.max(gh, 0.0) - 0.14);
        dr.shaft.scale.set(1, h, 1);
        dr.shaft.rotation.set(-0.06 * Math.min(1, sp * 0.3), 0, -dr.bank);
        dr.root.updateMatrixWorld(true);
        // rotors
        const spin = t * 60 + i * 3;
        for (let k = 0; k < 4; k++) {
          e.set(0, spin * (k % 2 ? -1 : 1), 0);
          q.setFromEuler(e);
          mLocal.compose(rotorOff[k]!, q, one);
          m4.multiplyMatrices(dr.root.matrixWorld, mLocal);
          rotors.setMatrixAt(i * 4 + k, m4);
        }
        // nav lights
        const blinkRed = 0.6 + 0.4 * Math.sin(t * 5 + i);
        const strobe = fract01(t * 0.75 + i * 0.3) < 0.09 || (fract01(t * 0.75 + i * 0.3) > 0.16 && fract01(t * 0.75 + i * 0.3) < 0.24) ? 1.6 : 0.05;
        const sc = [blinkRed, 0.85 + 0.15 * Math.sin(t * 3 + i * 2), strobe];
        for (let k = 0; k < 3; k++) {
          scl.setScalar(sc[k]!);
          mLocal.compose(lightOff[k]!, new THREE.Quaternion(), scl);
          m4.multiplyMatrices(dr.root.matrixWorld, mLocal);
          lights.setMatrixAt(i * 3 + k, m4);
        }
      });
      rotors.instanceMatrix.needsUpdate = true;
      lights.instanceMatrix.needsUpdate = true;
    },
  };
}

function fract01(x: number): number {
  return x - Math.floor(x);
}

// ───────────────────────── storage robot ─────────────────────────

export interface Robot {
  group: THREE.Group;
  /** Toggles the crates on both piles. */
  update(dt: number, t: number): void;
}

export function createRobot(ctx: WorldCtx): Robot {
  const d = ctx.dispose;
  const root = new THREE.Group();
  root.name = 'storageRobot';
  const X = -11.05;
  const ZA = 4.7;
  const ZB = 9.1;
  const propMat = d.add(createPropMaterial({ snow: 0.45 }));

  // treads with moving cleats
  const treadPhase = uniform(0);
  const treadMat = d.add(new THREE.MeshStandardNodeMaterial({ roughness: 0.85 }));
  {
    const c = fract(uv().x.mul(10.0).add(treadPhase));
    treadMat.colorNode = mix(color(new THREE.Color('#0e1116')), color(new THREE.Color('#2a303a')), step(0.5, c));
  }
  const treadGeo = d.add(new THREE.BoxGeometry(0.26, 0.32, 1.1, 1, 1, 1));
  // remap uv.x along the length for the cleats
  {
    const uvs = treadGeo.getAttribute('uv');
    const pos = treadGeo.getAttribute('position');
    for (let i = 0; i < uvs.count; i++) uvs.setX(i, pos.getZ(i) + 0.55);
  }
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(treadGeo, treadMat);
    t.position.set(sx * 0.44, 0.16, 0);
    t.castShadow = true;
    root.add(t);
  }
  const B = new PropBuilder();
  for (const sx of [-1, 1]) for (const sz of [-0.42, 0, 0.42]) B.cyl(0.14, 0.14, 0.05, S.darkSteel, { p: [sx * 0.585, 0.17, sz], r: [0, 0, Math.PI / 2] }, 12);
  B.rbox(0.9, 0.26, 1.0, 0.05, { color: '#3a4350', rough: 0.45, metal: 0.6 }, { p: [0, 0.4, 0] });
  B.rbox(0.74, 0.52, 0.78, 0.07, { color: '#e2a01c', rough: 0.5, metal: 0.25 }, { p: [0, 0.78, -0.02] });
  B.box(0.76, 0.06, 0.8, { color: '#1c2129', rough: 0.5, metal: 0.5 }, { p: [0, 0.55, -0.02] });
  B.box(0.5, 0.2, 0.02, { color: '#20262f', rough: 0.4, metal: 0.5 }, { p: [0, 0.8, 0.375] });
  for (let i = 0; i < 4; i++) B.box(0.05, 0.05, 0.02, i % 2 ? S.green(2.4) : S.cyan(2.4), { p: [-0.15 + i * 0.1, 0.8, 0.39] });
  B.box(0.02, 0.4, 0.5, { color: '#8a5f0d', rough: 0.6 }, { p: [0.375, 0.78, -0.02] });
  B.box(0.02, 0.4, 0.5, { color: '#8a5f0d', rough: 0.6 }, { p: [-0.375, 0.78, -0.02] });
  B.box(0.3, 0.02, 0.5, S.darkSteel, { p: [0, 1.06, -0.12] });
  B.cyl(0.015, 0.015, 0.5, S.steel, { p: [-0.3, 1.3, -0.3] }, 5);
  B.ell(0.03, 0.03, 0.03, S.red2(3.0), { p: [-0.3, 1.56, -0.3] }, 6, 5);
  for (const sx of [-1, 1]) B.box(0.12, 0.05, 0.03, S.warmWhite(3.2), { p: [sx * 0.3, 0.4, 0.51] });
  const bodyMesh = new THREE.Mesh(d.add(B.build()), propMat);
  bodyMesh.castShadow = true;
  root.add(bodyMesh);

  // head with blinking eyes
  const head = new THREE.Group();
  head.position.set(0, 1.12, 0.12);
  root.add(head);
  {
    const HB = new PropBuilder();
    HB.cyl(0.05, 0.06, 0.12, S.darkSteel, { p: [0, -0.08, 0] }, 8);
    HB.rbox(0.42, 0.22, 0.3, 0.06, { color: '#dfe6ee', rough: 0.4, metal: 0.2 }, { p: [0, 0.04, 0] });
    HB.rbox(0.36, 0.14, 0.02, 0.04, { color: '#0b0f14', rough: 0.2, metal: 0.4 }, { p: [0, 0.05, 0.155] });
    head.add(new THREE.Mesh(d.add(HB.build()), propMat));
  }
  const eyeGeo = d.add(new THREE.CircleGeometry(0.045, 14));
  const eyeMat = d.add(new THREE.MeshBasicNodeMaterial());
  eyeMat.colorNode = color(new THREE.Color('#5df0ff')).mul(3.2);
  const eyes = new THREE.Group();
  eyes.position.set(0, 0.05, 0.168);
  head.add(eyes);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sx * 0.09, 0, 0);
    eyes.add(eye);
  }

  // arm + carried crate
  const arm = new THREE.Group();
  arm.position.set(0, 0.92, 0.3);
  root.add(arm);
  const fore = new THREE.Group();
  fore.position.set(0, 0, 0.5);
  arm.add(fore);
  {
    const AB = new PropBuilder();
    AB.cyl(0.07, 0.07, 0.18, S.darkSteel, { r: [0, 0, Math.PI / 2] }, 10);
    AB.rbox(0.12, 0.12, 0.6, 0.03, { color: '#e2a01c', rough: 0.5 }, { p: [0, 0, 0.26] });
    arm.add(new THREE.Mesh(d.add(AB.build()), propMat));
    const FB = new PropBuilder();
    FB.cyl(0.055, 0.055, 0.16, S.darkSteel, { r: [0, 0, Math.PI / 2] }, 10);
    FB.rbox(0.09, 0.09, 0.5, 0.02, { color: '#d9d2c0', rough: 0.5 }, { p: [0, 0, 0.22] });
    for (const sx of [-1, 1]) FB.box(0.03, 0.14, 0.2, S.darkSteel, { p: [sx * 0.2, 0, 0.55] });
    FB.box(0.44, 0.03, 0.06, S.darkSteel, { p: [0, 0.05, 0.47] });
    fore.add(new THREE.Mesh(d.add(FB.build()), propMat));
  }
  const crateGeo = d.add(new THREE.BoxGeometry(0.42, 0.32, 0.4));
  const crateMat = d.add(new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#d9701e'), roughness: 0.6 }));
  const carried = new THREE.Mesh(crateGeo, crateMat);
  carried.position.set(0, 0.0, 0.62);
  carried.castShadow = true;
  fore.add(carried);
  root.position.set(X, groundHeight(X, ZA), ZA);
  root.rotation.y = -Math.PI / 2;

  // loose crates that the robot moves between the piles
  const topA = new THREE.Mesh(crateGeo, crateMat);
  const topB = new THREE.Mesh(crateGeo, crateMat);
  {
    const ya = groundHeight(-12.3, 3.3) + 0.7 + 0.55 + 0.16;
    topA.position.set(-12.2, ya, 3.55);
    const yb = groundHeight(-12.3, 9.8) + 0.62 + 0.16;
    topB.position.set(-12.3, yb, 10.05);
    topA.castShadow = true;
    topB.castShadow = true;
  }
  const group = new THREE.Group();
  group.add(root, topA, topB);

  // cycle
  const T = 26;
  let treadSpeed = 0;
  let blinkT = 2;
  let blink = 0;
  let headYaw = 0;
  const lerp = THREE.MathUtils.lerp;
  const sm = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
  return {
    group,
    update(dt, t) {
      const c = t % T;
      let z = ZA;
      let yaw = -Math.PI / 2;
      let armDown = 0;
      let carry = false;
      let showA = true;
      let showB = false;
      let speed = 0;
      if (c < 2.5) {
        // pick from pile A
        armDown = sm(0, 1.2, c) * (1 - sm(1.8, 2.5, c));
        carry = c > 1.4;
        showA = !carry;
        z = ZA;
        yaw = -Math.PI / 2;
      } else if (c < 3.5) {
        carry = true;
        showA = false;
        yaw = lerp(-Math.PI / 2, 0, sm(2.5, 3.5, c));
      } else if (c < 10.5) {
        carry = true;
        showA = false;
        const u = sm(3.5, 10.5, c);
        z = lerp(ZA, ZB, u);
        yaw = 0;
        speed = 0.6;
      } else if (c < 12.5) {
        carry = c < 11.6;
        showA = false;
        showB = !carry;
        z = ZB;
        yaw = lerp(0, -Math.PI / 2, sm(10.5, 11.3, c));
        armDown = sm(11.0, 11.8, c) * (1 - sm(12.0, 12.5, c));
      } else if (c < 15.5) {
        showA = false;
        showB = true;
        z = ZB;
        yaw = -Math.PI / 2;
        headYaw = Math.sin((c - 12.5) * 2.2) * 0.7;
      } else if (c < 18) {
        // pick from pile B
        z = ZB;
        yaw = -Math.PI / 2;
        armDown = sm(15.5, 16.4, c) * (1 - sm(17.2, 18, c));
        carry = c > 16.6;
        showB = !carry;
      } else if (c < 19) {
        carry = true;
        z = ZB;
        yaw = lerp(-Math.PI / 2, -Math.PI, sm(18, 19, c));
      } else if (c < 24) {
        carry = true;
        const u = sm(19, 24, c);
        z = lerp(ZB, ZA, u);
        yaw = -Math.PI;
        speed = 0.6;
      } else {
        z = ZA;
        carry = c < 25.0;
        showA = !carry;
        yaw = lerp(-Math.PI, -Math.PI / 2, sm(24, 25, c));
        armDown = sm(24.4, 25, c) * (1 - sm(25.3, 26, c));
      }
      if (c >= 15.5 || c < 12.5) headYaw *= 0.9;
      root.position.set(X, groundHeight(X, z), z);
      root.rotation.y += (yaw - root.rotation.y) * (1 - Math.exp(-dt * 6));
      arm.rotation.x = lerp(-0.5, 0.55, armDown);
      fore.rotation.x = lerp(0.25, -0.35, armDown);
      carried.visible = carry;
      topA.visible = showA;
      topB.visible = showB;
      treadSpeed += ((speed > 0 ? speed : 0) - treadSpeed) * (1 - Math.exp(-dt * 5));
      treadPhase.value += dt * treadSpeed * 1.6 * (Math.cos(yaw) >= 0 ? -1 : 1);
      head.rotation.y = headYaw + Math.sin(t * 0.7) * 0.15;
      blinkT -= dt;
      if (blinkT <= 0) {
        blink = 0.12;
        blinkT = 2 + Math.random() * 3;
      }
      if (blink > 0) blink -= dt;
      eyes.scale.y = blink > 0 ? 0.08 : 1;
      root.position.y += Math.sin(t * 9) * 0.004 * (speed > 0 ? 1 : 0);
    },
  };
}

// ───────────────────────── dock works: guide cable + gantries ─────────────────────────

export function createDockworks(ctx: WorldCtx): THREE.Group {
  const d = ctx.dispose;
  const g = new THREE.Group();
  g.name = 'dockworks';
  const zc = -1.62;
  const yc = 2.45;
  const xs = 10.6;
  const B = new PropBuilder();
  for (const s of [-1, 1]) {
    const x = s * xs;
    const base = groundHeight(x, zc);
    B.cyl(0.11, 0.15, yc + 1.1 - base + 0.6, S.darkSteel, { p: [x, base + (yc + 1.1 - base + 0.6) / 2 - 0.3, zc] }, 8);
    B.box(0.14, 0.14, 0.9, S.darkSteel, { p: [x - s * 0.1, yc + 0.4, zc] });
    B.cyl(0.24, 0.24, 0.1, S.steel, { p: [x - s * 0.1, yc + 0.02, zc], r: [Math.PI / 2, 0, 0] }, 14);
    B.cyl(0.05, 0.05, 0.7, S.orange, { p: [x - s * 0.1, yc - 0.42, zc] }, 6);
    B.cyl(0.13, 0.13, 0.3, S.steel, { p: [x - s * 0.1, yc - 0.9, zc] }, 8);
    B.box(0.5, 0.5, 0.5, S.darkSteel, { p: [x + s * 0.2, base + 0.25, zc] });
    B.box(0.2, 0.12, 0.02, S.warm(2.4), { p: [x + s * 0.2 - s * 0.26, base + 0.32, zc] });
    B.add(new THREE.TorusGeometry(0.34, 0.03, 5, 14), S.yellow, { p: [x + s * 0.2, base + 0.7, zc], r: [Math.PI / 2, 0, 0] });
    // guys
    B.rod([x, yc + 1.0, zc], [x + s * 2.4, base + 0.05, zc + 1.0], 0.012, { color: '#c9d0da', rough: 0.5, metal: 0.5 }, 4);
    B.rod([x, yc + 1.0, zc], [x + s * 2.4, base + 0.05, zc - 1.2], 0.012, { color: '#c9d0da', rough: 0.5, metal: 0.5 }, 4);
  }
  const gm = new THREE.Mesh(d.add(B.build()), d.add(createPropMaterial({ snow: 0.7 })));
  gm.castShadow = true;
  g.add(gm);
  // the cable itself
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const x = -xs + 0.1 + (i / 12) * (2 * xs - 0.2);
    pts.push(new THREE.Vector3(x, yc - Math.sin((i / 12) * Math.PI) * 0.02 + 0.09, zc));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const cableGeo = d.add(new THREE.TubeGeometry(curve, 48, 0.028, 6, false));
  const cableMat = d.add(new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#9aa6b5'), roughness: 0.35, metalness: 0.9 }));
  const cable = new THREE.Mesh(cableGeo, cableMat);
  g.add(cable);
  return g;
}
