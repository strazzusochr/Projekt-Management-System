import * as THREE from 'three/webgpu';
import {
  atan,
  cameraPosition,
  color,
  dot,
  float,
  floor,
  hash,
  length,
  mix,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalWorld,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  time,
  transformNormalByViewMatrix,
  cameraViewMatrix,
  normalize,
  reflect,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { createWater, rng } from '../../world/kit';
import { BANK_Y, PLATFORM, WATER_Y, groundHeight, terrainHeight, type WorldCtx } from './common';

// ───────────────────────── terrain ─────────────────────────

function gridGeometry(xs: number[], zs: number[], flip: boolean): THREE.BufferGeometry {
  const cols = xs.length;
  const rows = zs.length;
  const pos = new Float32Array(cols * rows * 3);
  let p = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = xs[i]!;
      const z = zs[j]!;
      pos[p++] = x;
      pos[p++] = terrainHeight(x, z);
      pos[p++] = z;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function range(a: number, b: number, step_: number): number[] {
  const out: number[] = [];
  for (let v = a; v < b - 1e-6; v += step_) out.push(v);
  return out;
}

function bankAxes(sign: 1 | -1): { xs: number[]; zs: number[] } {
  const ax = [...range(4.4, 7.4, 0.2), ...range(7.4, 13, 0.8), ...range(13, 30, 2), ...range(30, 60, 4), ...range(60, 150.1, 10)];
  const xs = ax.map((v) => v * sign);
  if (sign < 0) xs.reverse();
  const zs = [...range(-200, -100, 10), ...range(-100, -40, 4), ...range(-40, 40, 1), ...range(40, 90.1, 5)];
  return { xs, zs };
}

function createTerrainMaterial(ctx: WorldCtx): THREE.MeshStandardNodeMaterial {
  const q = ctx.quality;
  const m = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const xz = vec2(P.x, P.z);
  const big = mx_noise_float(vec3(xz.x.mul(0.045), 0.0, xz.y.mul(0.045)));
  const mid = mx_noise_float(xz.mul(0.33));
  const fine = mx_noise_float(xz.mul(2.6));
  const distPlay = length(vec2(P.x.abs().sub(6.5).max(0), P.z.mul(0.7)));
  const iceAmount = smoothstep(0.22, -0.12, big.add(mid.mul(0.22))).mul(smoothstep(4.0, 13.0, distPlay).mul(0.85).add(0.15));
  const snowLight = color(new THREE.Color('#c6d8ee'));
  const snowShade = color(new THREE.Color('#92aed2'));
  const iceA = color(new THREE.Color('#5b95c8'));
  const iceB = color(new THREE.Color('#2b5f9a'));
  let albedo = mix(snowLight, snowShade, fine.mul(0.5).add(0.5).mul(0.55).add(mid.mul(0.1)));
  albedo = mix(albedo, mix(iceA, iceB, mid.mul(0.5).add(0.5)), iceAmount);
  // ice face at the lead edge
  const faceK = smoothstep(0.55, 0.05, P.y);
  albedo = mix(albedo, color(new THREE.Color('#3b86c2')), faceK);
  m.colorNode = albedo;
  m.roughnessNode = mix(float(0.86), float(0.15), iceAmount).mul(float(1).sub(faceK)).add(faceK.mul(0.12));

  // micro relief (sastrugi) via noise gradient → view-space normal
  const e = 0.35;
  const q0 = mx_noise_float(xz.mul(1.35).add(vec2(0, time.mul(0.0))));
  const qx = mx_noise_float(xz.add(vec2(e, 0)).mul(1.35));
  const qz = mx_noise_float(xz.add(vec2(0, e)).mul(1.35));
  const k = float(0.55).mul(float(1).sub(iceAmount.mul(0.7)));
  const nW = normalize(normalWorld.add(vec3(q0.sub(qx).mul(k), 0, q0.sub(qz).mul(k))));
  m.normalNode = transformNormalByViewMatrix(nW, cameraViewMatrix);

  // glowing fissures (Worley cell borders) – blue light welling up from the sea below
  const w = mx_worley_noise_vec2(xz.mul(0.31), float(1.0));
  const edge1 = w.y.sub(w.x);
  const line1 = smoothstep(0.05, 0.0, edge1);
  const w2 = mx_worley_noise_vec2(xz.mul(0.093).add(vec2(11.0, 5.0)), float(1.0));
  const line2 = smoothstep(0.03, 0.0, w2.y.sub(w2.x));
  const zone = smoothstep(-0.05, 0.45, mx_noise_float(xz.mul(0.085).add(vec2(31.0, 7.0))));
  const zone2 = smoothstep(0.1, 0.6, mx_noise_float(xz.mul(0.05).add(vec2(3.0, 19.0))));
  const pulse = sin(time.mul(0.7).add(big.mul(9.0))).mul(0.25).add(0.75);
  const cracks = line1.mul(zone).mul(0.8).add(line2.mul(zone2)).mul(float(1).sub(faceK)).mul(smoothstep(-0.25, 0.25, mid.add(0.15))).clamp(0, 1);
  let emissive = color(new THREE.Color('#36c8ff')).mul(cracks).mul(pulse).mul(1.55);
  // under-ice glow along the edge + submerged wall
  const nearEdge = smoothstep(3.6, 0.0, P.x.abs().sub(6.0).max(0));
  const wallGlow = smoothstep(0.35, -1.6, P.y);
  emissive = emissive.add(color(new THREE.Color('#1fb4ff')).mul(wallGlow.mul(0.9).add(nearEdge.mul(0.06).mul(mid.mul(0.5).add(0.6)))));
  // glitter
  if (q.level !== 'low') {
    const cell = floor(xz.mul(26.0));
    const h = hash(cell.x.add(cell.y.mul(57.0)).add(100.0));
    const tw = sin(time.mul(2.4).add(h.mul(60.0))).mul(0.5).add(0.5);
    const near = smoothstep(46.0, 14.0, length(cameraPosition.sub(P)));
    emissive = emissive.add(vec3(0.9, 1.1, 1.3).mul(step(0.9962, h)).mul(pow(tw, 4.0)).mul(near).mul(2.6));
  }
  m.emissiveNode = emissive;
  return m;
}

export interface Ground {
  group: THREE.Group;
}

export function createGround(ctx: WorldCtx): Ground {
  const group = new THREE.Group();
  group.name = 'ground';
  const d = ctx.dispose;
  const mat = d.add(createTerrainMaterial(ctx));
  for (const sign of [-1, 1] as const) {
    const { xs, zs } = bankAxes(sign);
    const geo = d.add(gridGeometry(xs, zs, sign > 0));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = sign < 0 ? 'ground:camp' : 'ground:station';
    group.add(mesh);
  }

  // lead floor (seen through the water)
  const floorGeo = d.add(new THREE.PlaneGeometry(13, 260));
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = d.add(new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#031224'), roughness: 0.9 }));
  {
    const nrm = mx_noise_float(vec2(positionWorld.x.mul(0.6), positionWorld.z.mul(0.2)));
    floorMat.emissiveNode = color(new THREE.Color('#0a5f8a')).mul(smoothstep(0.2, 1.0, nrm.mul(0.5).add(0.5)).mul(0.12));
  }
  const lead = new THREE.Mesh(floorGeo, floorMat);
  lead.position.set(0, -3.4, -60);
  group.add(lead);

  // far ice pack that fades into the fog at the horizon
  const farGeo = d.add(new THREE.PlaneGeometry(5000, 5000));
  farGeo.rotateX(-Math.PI / 2);
  const farMat = d.add(new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#0d2039') }));
  const far = new THREE.Mesh(farGeo, farMat);
  far.position.set(0, -0.35, -400);
  group.add(far);

  // ── the lead: dark, deep, slowly flowing water ──
  const water = createWater({
    width: 12.8,
    length: 250,
    position: new THREE.Vector3(0, WATER_Y, -70),
    shallow: '#1b8ea6',
    deep: '#010a16',
    foam: '#e4f5ff',
    sky: '#3fdcb8',
    flow: [0.02, -0.3],
    waveAmp: 0.026,
    waveLen: 4.4,
    roughness: 0.05,
    depthFade: 3.4,
    foamWidth: 0.6,
    refraction: 0.028,
    normalStrength: 0.24,
    minOpacity: 0.8,
    glow: '#0a90c0',
    glowStrength: 0.12,
    quality: ctx.quality,
  });
  d.add(water.geometry);
  d.add(water.material as THREE.Material);
  // the aurora mirrors in the lead: analytic reflection of the northern curtains
  {
    const wm = water.material as THREE.MeshStandardNodeMaterial;
    const P = positionWorld;
    const rip = mx_noise_float(vec3(P.x.mul(0.7), P.z.mul(0.45).sub(time.mul(0.35)), time.mul(0.18)));
    const rip2 = mx_noise_float(vec3(P.x.mul(1.9), P.z.mul(1.3).add(time.mul(0.4)), 3.0));
    const N = normalize(vec3(rip.mul(0.09).add(rip2.mul(0.04)), 1.0, rip2.mul(0.07).add(rip.mul(0.03))));
    const Vd = normalize(P.sub(cameraPosition));
    const Rv = reflect(Vd, N);
    const elev = Rv.y;
    const az = atan(Rv.x, Rv.z.negate());
    const band = smoothstep(0.02, 0.2, elev).mul(smoothstep(0.9, 0.3, elev));
    const north = smoothstep(0.25, -0.7, Rv.z);
    const rays = mx_noise_float(vec2(az.mul(16.0), time.mul(0.1))).mul(0.5).add(0.5);
    const hue = smoothstep(0.2, 0.75, elev);
    const auroraCol = mix(color(new THREE.Color('#39ffa0')), color(new THREE.Color('#9a5cff')), hue);
    const fres = pow(float(1).sub(dot(N, Vd.negate()).clamp(0, 1)), 3.0).mul(0.75).add(0.16);
    const aur = auroraCol.mul(band).mul(north).mul(rays.mul(1.1).add(0.25)).mul(fres).mul(1.5);
    wm.emissiveNode = (wm.emissiveNode as ReturnType<typeof color>).add(aur);
  }
  water.renderOrder = 1;
  group.add(water);
  return { group };
}

// ───────────────────────── small instanced details ─────────────────────────

/** Footprint trails (people + dog) melting into the snow. */
export function createFootprints(ctx: WorldCtx): THREE.InstancedMesh {
  const d = ctx.dispose;
  const trails: Array<Array<[number, number]>> = [
    // camp → dock
    [[-14.5, -3.2], [-12.6, -1.5], [-10.8, 0.5], [-9.0, 1.9], [-7.6, 1.4], [-6.4, 0.5]],
    // tent B ↔ crates
    [[-15.6, 5.4], [-14.0, 7.2], [-12.2, 8.6]],
    // generator ↔ fire barrel
    [[-11.6, -7.2], [-10.9, -5.2], [-10.7, -3.0]],
    // dog trail around the slots
    [[-8.1, 5.6], [-7.6, 3.8], [-8.6, 2.2], [-7.4, 0.8], [-8.4, -1.4], [-7.9, -3.6]],
    // sled tracks toward the lead
    [[-11, 12.5], [-9, 10.4], [-8.2, 8.0]],
    // far bank: to the station steps
    [[24, 6], [20.5, 4.2], [17.6, 2.4]],
  ];
  const pts: Array<{ x: number; z: number; yaw: number; s: number }> = [];
  const r = rng(77);
  trails.forEach((tr, ti) => {
    const dog = ti === 3;
    let leftFoot = false;
    for (let k = 0; k < tr.length - 1; k++) {
      const a = tr[k]!;
      const b = tr[k + 1]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const step = dog ? 0.42 : 0.62;
      const n = Math.max(1, Math.floor(len / step));
      const yaw = Math.atan2(dx, dz);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const side = leftFoot ? 1 : -1;
        leftFoot = !leftFoot;
        const off = (dog ? 0.09 : 0.14) * side;
        pts.push({ x: a[0] + dx * t + Math.cos(yaw) * off + (r() - 0.5) * 0.06, z: a[1] + dz * t - Math.sin(yaw) * off + (r() - 0.5) * 0.06, yaw: yaw + (r() - 0.5) * 0.2, s: dog ? 0.42 : 1 });
      }
    }
  });
  const geo = d.add(new THREE.CircleGeometry(0.5, 14));
  geo.rotateX(-Math.PI / 2);
  const mat = d.add(new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#6d86ad'), roughness: 0.95, transparent: true, opacity: 0.62, depthWrite: false }));
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  const inst = new THREE.InstancedMesh(geo, mat, pts.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  pts.forEach((p, i) => {
    e.set(0, p.yaw, 0);
    q.setFromEuler(e);
    const y = groundHeight(p.x, p.z) + 0.012;
    m4.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(0.15 * p.s + 0.02, 1, 0.34 * p.s + 0.02));
    inst.setMatrixAt(i, m4);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.name = 'footprints';
  inst.renderOrder = 2;
  return inst;
}

/** Wind-sculpted snow drifts piled against props and along the edges. */
export function createDrifts(ctx: WorldCtx): THREE.InstancedMesh {
  const d = ctx.dispose;
  const r = rng(31337);
  const geo = d.add(new THREE.IcosahedronGeometry(1, 2));
  {
    const pos = geo.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = 1 + Math.sin(v.x * 3.3) * 0.08 + Math.sin(v.z * 4.1 + v.y * 2) * 0.06;
      pos.setXYZ(i, v.x * n, Math.max(v.y, -0.15) * n, v.z * n);
    }
    geo.computeVertexNormals();
  }
  const mat = d.add(new THREE.MeshStandardNodeMaterial({ roughness: 0.85 }));
  {
    const nz = mx_noise_float(positionWorld.mul(1.7));
    mat.colorNode = mix(color(new THREE.Color('#bcd0ea')), color(new THREE.Color('#dbe8f8')), smoothstep(-0.2, 0.9, normalWorld.y.add(nz.mul(0.15))));
    mat.emissiveNode = color(new THREE.Color('#2b5f8f')).mul(0.03);
  }
  const want = Math.round(96 * ctx.quality.density);
  const list: Array<{ x: number; z: number; sx: number; sy: number; sz: number; yaw: number }> = [];
  const push = (x: number, z: number, sx: number, sy: number, sz: number, yaw: number) => list.push({ x, z, sx, sy, sz, yaw });
  // deliberate ones: against tents, sled, crates, station
  const planned: Array<[number, number, number]> = [
    [-13.6, -3.4, 1.3], [-16.0, -6.6, 1.5], [-15.2, 3.6, 1.2], [-17.6, 1.8, 1.4], [-12.4, 9.2, 1.4], [-10.2, 11.4, 1.6], [-9.6, -8.6, 1.3],
    [-12.2, -10.2, 1.5], [-18.5, -4.2, 2.0], [-19.0, 7.0, 1.8], [-8.4, 8.2, 1.0], [-7.6, -8.2, 1.2], [-20.0, 0.0, 2.2], [-14.4, 12.6, 1.8],
    [17.2, 9.6, 1.6], [19.0, -9.4, 1.8], [16.6, -11.0, 1.4], [22.5, 2.0, 2.2], [21.0, 7.5, 1.7], [18.0, 12.4, 1.9], [24.0, -6.0, 2.0],
  ];
  for (const [x, z, s] of planned) push(x, z, s * (1.3 + r() * 0.7), s * (0.3 + r() * 0.2), s * (0.9 + r() * 0.6), r() * 3.14);
  while (list.length < want) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (8 + r() * 42);
    const z = (r() - 0.5) * 80;
    if (Math.abs(x) < 10.8 && Math.abs(z) < 6.2) continue;
    if (x > PLATFORM.x0 - 1 && x < PLATFORM.x1 + 0.8 && Math.abs(z) < PLATFORM.z1 + 0.8) continue;
    const s = 0.8 + r() * 2.4;
    push(x, z, s * (1.2 + r()), s * (0.25 + r() * 0.25), s * (0.8 + r() * 0.8), r() * 3.14);
  }
  const inst = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  list.forEach((it, i) => {
    e.set(0, it.yaw, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(it.x, terrainHeight(it.x, it.z) - 0.05, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
    inst.setMatrixAt(i, m4);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.receiveShadow = true;
  inst.name = 'drifts';
  return inst;
}

/** Soft aurora light wandering over the snow (additive, tinted green/violet). */
export function createAuroraSpill(ctx: WorldCtx): THREE.Group {
  const d = ctx.dispose;
  const g = new THREE.Group();
  g.name = 'auroraSpill';
  const mat = d.add(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  mat.fog = false;
  {
    const P = positionWorld;
    const n1 = mx_noise_float(vec3(P.x.mul(0.05), P.z.mul(0.035).add(time.mul(0.05)), time.mul(0.07)));
    const n2 = mx_noise_float(vec3(P.x.mul(0.11).add(9.0), P.z.mul(0.08), time.mul(0.11)));
    const green = color(new THREE.Color('#2dff9a'));
    const violet = color(new THREE.Color('#8a55ff'));
    const c = mix(green, violet, smoothstep(-0.2, 0.7, n2));
    const inten = smoothstep(-0.15, 0.7, n1).mul(0.055);
    const fadeX = smoothstep(90.0, 20.0, P.x.abs());
    const fadeZ = smoothstep(80.0, 10.0, P.z.abs());
    mat.colorNode = c.mul(inten).mul(fadeX).mul(fadeZ);
  }
  const geoL = d.add(new THREE.PlaneGeometry(100, 180, 1, 1));
  geoL.rotateX(-Math.PI / 2);
  for (const sign of [-1, 1]) {
    const mesh = new THREE.Mesh(geoL, mat);
    mesh.position.set(sign * (7.0 + 50), BANK_Y + 0.03, -20);
    mesh.renderOrder = 2;
    g.add(mesh);
  }
  void uv;
  return g;
}
