import * as THREE from 'three/webgpu';
import { color, float, fract, mix, mx_noise_float, step, time, uniform, uv, vec2, vec3 } from 'three/tsl';
import { createParticles, lightShaft } from '../../world/kit';
import { BANK_EDGE, PLATFORM, PLATFORM_Y, PropBuilder, S, createPropMaterial, groundHeight, type WorldCtx } from './common';
import { makeSignTexture, type HaloSpec } from './fx';

export interface Station {
  group: THREE.Group;
  halos: HaloSpec[];
  update(dt: number, t: number): void;
}

const P0 = PLATFORM.x0;
const P1 = PLATFORM.x1;
const PZ = PLATFORM.z1;
const TOP = PLATFORM_Y;

export function createStation(ctx: WorldCtx): Station {
  const d = ctx.dispose;
  const q = ctx.quality;
  const group = new THREE.Group();
  group.name = 'station';
  const halos: HaloSpec[] = [];
  const B = new PropBuilder();
  const heat = uniform(1);
  const grating = (w: number, h: number, cell: number): THREE.MeshStandardNodeMaterial => {
    const m = ctx.dispose.add(new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.75 }));
    const g = uv().mul(vec2(w / cell, h / cell));
    const f = fract(g);
    const hole = step(0.18, f.x).mul(step(0.18, f.y));
    const wave = mx_noise_float(vec3(uv().mul(vec2(5, 8)), time.mul(0.35))).mul(0.5).add(0.5);
    const stripe = step(0.955, fract(uv().y.mul(h / 3.0))).mul(0.8).add(step(0.965, fract(uv().x.mul(w / 3.0))).mul(0.5));
    m.colorNode = mix(color(new THREE.Color('#2c343f')), color(new THREE.Color('#080b10')), hole);
    m.emissiveNode = color(new THREE.Color('#ff7418'))
      .mul(hole.mul(float(0.45).add(wave.mul(0.55))).mul(0.85).add(stripe.mul(2.0)))
      .mul(heat);
    return m;
  };

  // ── deck ──
  const dw = P1 - P0;
  const dl = PZ * 2;
  const deckGeo = d.add(new THREE.PlaneGeometry(dw, dl));
  deckGeo.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, grating(dw, dl, 0.2));
  deck.position.set((P0 + P1) / 2, TOP + 0.004, 0);
  deck.receiveShadow = true;
  group.add(deck);

  // ── fascia + curb ──
  const fasciaH = 0.55;
  B.box(0.16, fasciaH, dl, S.darkSteel, { p: [P0 + 0.08, TOP - fasciaH / 2, 0] });
  B.box(dw, fasciaH, 0.16, S.darkSteel, { p: [(P0 + P1) / 2, TOP - fasciaH / 2, PZ - 0.08] });
  B.box(dw, fasciaH, 0.16, S.darkSteel, { p: [(P0 + P1) / 2, TOP - fasciaH / 2, -PZ + 0.08] });
  B.box(0.16, fasciaH, dl, S.darkSteel, { p: [P1 - 0.08, TOP - fasciaH / 2, 0] });
  B.box(0.05, 0.05, dl - 0.3, S.warm(2.8), { p: [P0 - 0.005, TOP - 0.06, 0] });
  B.box(dw - 0.3, 0.05, 0.05, S.warm(2.8), { p: [(P0 + P1) / 2, TOP - 0.06, PZ + 0.005] });
  B.box(dw - 0.3, 0.05, 0.05, S.warm(2.8), { p: [(P0 + P1) / 2, TOP - 0.06, -PZ - 0.005] });
  // hazard curb along the water side
  for (let i = 0; i < 16; i++) {
    const z = -PZ + 0.5 + i * (dl - 1) / 15;
    if (Math.abs(z) < 1.2) continue;
    B.box(0.2, 0.05, 0.46, i % 2 ? S.yellow : S.rubber, { p: [P0 + 0.24, TOP + 0.02, z] });
  }
  // stilts
  for (let i = 0; i <= 6; i++) {
    const z = -PZ + 0.6 + (i / 6) * (dl - 1.2);
    B.cyl(0.13, 0.15, 2.6, S.darkSteel, { p: [P0 + 0.35, TOP - 1.4, z] }, 8);
    B.cyl(0.16, 0.16, 0.08, S.steel, { p: [P0 + 0.35, TOP - 0.14, z] }, 8);
  }
  for (let i = 0; i <= 5; i++) {
    const x = P0 + 1.6 + (i / 5) * (dw - 2.4);
    for (const z of [-PZ + 0.35, PZ - 0.35]) B.cyl(0.12, 0.14, 1.2, S.darkSteel, { p: [x, TOP - 0.7, z] }, 8);
  }
  // ── railings (gap at the boarding ramp) ──
  const rail = (ax: number, az: number, bx: number, bz: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      B.cyl(0.03, 0.03, 1.0, S.yellow, { p: [ax + (bx - ax) * t, TOP + 0.5, az + (bz - az) * t] }, 6);
    }
    B.rod([ax, TOP + 1.0, az], [bx, TOP + 1.0, bz], 0.03, S.yellow, 6);
    B.rod([ax, TOP + 0.6, az], [bx, TOP + 0.6, bz], 0.022, S.white, 5);
  };
  rail(P0 + 0.06, -PZ + 0.1, P0 + 0.06, -1.5, 8);
  rail(P0 + 0.06, 1.5, P0 + 0.06, PZ - 0.1, 8);
  rail(P0 + 0.06, PZ - 0.1, P1 - 0.1, PZ - 0.1, 11);
  rail(P0 + 0.06, -PZ + 0.1, P1 - 0.1, -PZ + 0.1, 11);
  rail(P1 - 0.1, -PZ + 0.1, P1 - 0.1, PZ - 0.1, 14);

  // ── boarding ramps (both banks): hinged steel plates ──
  for (const s of [-1, 1]) {
    const x = s * 5.72;
    const tilt = -s * 0.05;
    B.box(0.85, 0.05, 1.9, S.steel, { p: [x, TOP - 0.06, 0], r: [0, 0, tilt] });
    for (let i = 0; i < 6; i++) B.box(0.05, 0.02, 1.9, S.darkSteel, { p: [x - 0.32 + i * 0.13, TOP - 0.028, 0], r: [0, 0, tilt] });
    for (const z of [-0.92, 0.92]) {
      B.cyl(0.025, 0.025, 0.9, S.yellow, { p: [x, TOP + 0.34, z], r: [0, 0, Math.PI / 2] }, 6);
      B.cyl(0.025, 0.025, 0.7, S.yellow, { p: [x + 0.4, TOP + 0.36, z] }, 6);
      B.cyl(0.025, 0.025, 0.7, S.yellow, { p: [x - 0.4, TOP + 0.36, z] }, 6);
    }
    B.box(0.06, 0.06, 1.9, S.warm(2.4), { p: [x - s * 0.44, TOP - 0.04, 0] });
    halos.push({ p: new THREE.Vector3(x - s * 0.44, TOP + 0.1, 0), color: '#ff9a3c', size: 1.4, intensity: 0.5 });
  }
  // ── bollard lights along the water edge ──
  for (const z of [-7.6, -5.9, -4.2, -2.6, 2.6, 4.2, 5.9, 7.6]) {
    B.cyl(0.07, 0.09, 0.52, S.darkSteel, { p: [P0 + 0.2, TOP + 0.26, z] }, 8);
    B.cyl(0.075, 0.075, 0.12, S.warmWhite(3.0), { p: [P0 + 0.2, TOP + 0.54, z] }, 8);
    B.cyl(0.1, 0.07, 0.04, S.darkSteel, { p: [P0 + 0.2, TOP + 0.62, z] }, 8);
    halos.push({ p: new THREE.Vector3(P0 + 0.2, TOP + 0.55, z), color: '#ffb968', size: 0.95, intensity: 0.55, flicker: 0.05 });
  }

  // ── main station building ──
  const bx0 = 11.4;
  const bx1 = 15.1;
  const bz0 = -6.9;
  const bz1 = 1.7;
  const bh = 3.6;
  const cx = (bx0 + bx1) / 2;
  const cz = (bz0 + bz1) / 2;
  B.box(bx1 - bx0, bh, bz1 - bz0, { color: '#d8e0ea', rough: 0.55, metal: 0.2 }, { p: [cx, TOP + bh / 2, cz] });
  B.box(bx1 - bx0 + 0.1, 0.5, bz1 - bz0 + 0.1, { color: '#e2661c', rough: 0.5, metal: 0.3 }, { p: [cx, TOP + 0.5, cz] });
  B.box(bx1 - bx0 + 0.16, 0.16, bz1 - bz0 + 0.16, S.darkSteel, { p: [cx, TOP + bh + 0.08, cz] });
  // vertical panel lines
  for (let i = 1; i < 8; i++) B.box(0.02, bh * 0.98, 0.02, { color: '#8593a6', rough: 0.5 }, { p: [bx0 - 0.005, TOP + bh / 2, bz0 + i * ((bz1 - bz0) / 8)] });
  // windows: -X face (towards the lead) and +Z face (towards the camera)
  const win = (x: number, y: number, z: number, w: number, h: number, dirX: number, dirZ: number) => {
    const wpos: [number, number, number] = [x + dirX * 0.02, y, z + dirZ * 0.02];
    B.box(dirX ? 0.06 : w + 0.12, h + 0.12, dirZ ? 0.06 : w + 0.12, S.darkSteel, { p: [x + dirX * 0.005, y, z + dirZ * 0.005] });
    B.box(dirX ? 0.05 : w, h, dirZ ? 0.05 : w, S.warmWhite(2.2), { p: wpos });
    B.box(dirX ? 0.06 : 0.04, h, dirZ ? 0.06 : 0.04, S.darkSteel, { p: [wpos[0] + dirX * 0.01, y, wpos[2] + dirZ * 0.01] });
    halos.push({ p: new THREE.Vector3(x + dirX * 0.25, y, z + dirZ * 0.25), color: '#ffb35e', size: w * 2.3, intensity: 0.42 });
  };
  for (let i = 0; i < 5; i++) win(bx0, TOP + 2.1, bz0 + 1.0 + i * 1.65, 0.95, 0.75, -1, 0);
  for (let i = 0; i < 2; i++) win(bx0 + 0.9 + i * 1.75, TOP + 2.1, bz1, 0.95, 0.75, 0, 1);
  // door + airlock canopy on the +Z face
  B.box(1.0, 1.9, 0.07, { color: '#f2b13a', rough: 0.5, emit: 0.7 }, { p: [bx1 - 0.85, TOP + 0.95, bz1 + 0.03] });
  B.box(1.5, 0.12, 0.7, S.darkSteel, { p: [bx1 - 0.85, TOP + 2.05, bz1 + 0.34] });
  B.box(1.3, 0.05, 0.5, S.warmWhite(3.0), { p: [bx1 - 0.85, TOP + 1.98, bz1 + 0.34] });
  halos.push({ p: new THREE.Vector3(bx1 - 0.85, TOP + 1.9, bz1 + 0.4), color: '#ffc47a', size: 2.4, intensity: 0.7 });
  // roof gear
  B.cyl(0.55, 0.62, 0.3, S.white, { p: [bx0 + 1.0, TOP + bh + 0.3, bz0 + 1.2] }, 14);
  B.ell(0.75, 0.75, 0.75, { color: '#eef2f7', rough: 0.35, metal: 0.1 }, { p: [bx0 + 1.0, TOP + bh + 0.7, bz0 + 1.2] }, 20, 12);
  B.cyl(0.05, 0.05, 4.2, S.steel, { p: [bx1 - 0.5, TOP + bh + 2.1, bz0 + 0.9] }, 6);
  B.cyl(0.03, 0.03, 1.0, S.steel, { p: [bx1 - 0.5, TOP + bh + 3.4, bz0 + 0.9], r: [0, 0, Math.PI / 2] }, 5);
  for (let i = 0; i < 3; i++) B.box(0.8 - i * 0.2, 0.02, 0.02, S.steel, { p: [bx1 - 0.5, TOP + bh + 2.6 + i * 0.5, bz0 + 0.9], r: [0, 0.6, 0] });
  B.rbox(1.6, 0.5, 1.0, 0.05, S.darkSteel, { p: [cx + 0.2, TOP + bh + 0.4, bz1 - 1.4] });
  for (let i = 0; i < 6; i++) B.box(0.04, 0.4, 0.02, { color: '#0c0f13', rough: 0.6 }, { p: [cx - 0.3 + i * 0.16, TOP + bh + 0.42, bz1 - 0.88] });
  // vents
  for (const vz of [-3.2, -2.2]) {
    B.cyl(0.14, 0.14, 0.6, S.steel, { p: [cx - 0.4, TOP + bh + 0.5, vz] }, 8);
    B.cyl(0.19, 0.16, 0.06, S.darkSteel, { p: [cx - 0.4, TOP + bh + 0.83, vz] }, 8);
  }

  // ── annex with roll-up door ──
  B.box(2.2, 2.5, 3.6, { color: '#c6d0dc', rough: 0.6, metal: 0.2 }, { p: [12.4, TOP + 1.25, 4.6] });
  B.box(2.3, 0.14, 3.7, S.darkSteel, { p: [12.4, TOP + 2.57, 4.6] });
  B.box(0.06, 1.9, 2.4, { color: '#ffb257', rough: 0.5, emit: 1.2 }, { p: [11.28, TOP + 1.0, 4.6] });
  for (let i = 0; i < 8; i++) B.box(0.07, 0.03, 2.4, { color: '#8f5a20', rough: 0.6, emit: 0.4 }, { p: [11.27, TOP + 0.2 + i * 0.24, 4.6] });
  B.box(0.5, 0.05, 0.26, S.red2(2.4), { p: [11.24, TOP + 2.3, 3.0] });
  halos.push({ p: new THREE.Vector3(11.1, TOP + 1.0, 4.6), color: '#ffb257', size: 4.2, intensity: 0.65 });
  // tanks with piping
  for (const tz of [4.0, 5.6]) {
    B.cyl(0.78, 0.78, 3.0, { color: '#cfd7e2', rough: 0.4, metal: 0.55 }, { p: [14.5, TOP + 1.5, tz] }, 18);
    B.ell(0.78, 0.25, 0.78, { color: '#cfd7e2', rough: 0.4, metal: 0.55 }, { p: [14.5, TOP + 3.0, tz] }, 18, 6);
    for (const yy of [0.5, 1.5, 2.5]) B.add(new THREE.TorusGeometry(0.8, 0.02, 5, 18), S.darkSteel, { p: [14.5, TOP + yy, tz], r: [Math.PI / 2, 0, 0] });
    B.box(0.05, 0.22, 0.18, S.green(2.0), { p: [13.75, TOP + 1.6, tz] });
  }
  B.tube([[13.5, TOP + 2.5, 4.0], [13.0, TOP + 2.9, 4.8], [12.3, TOP + 2.7, 5.2]], 0.07, { color: '#b9c4d2', rough: 0.4, metal: 0.7 }, 12, 6);
  B.tube([[14.5, TOP + 3.1, 4.6], [13.4, TOP + 3.6, 3.0], [13.2, TOP + 3.7, 1.7]], 0.09, { color: '#e2661c', rough: 0.5, metal: 0.4 }, 14, 6);

  // ── floodlight towers ──
  for (const tz of [-7.6, 7.6]) {
    B.cyl(0.07, 0.11, 6.4, S.darkSteel, { p: [15.0, TOP + 3.2, tz] }, 8);
    B.box(0.9, 0.5, 0.2, S.darkSteel, { p: [15.0 - 0.28, TOP + 6.2, tz], r: [0, 0, 0] });
    B.box(0.75, 0.3, 0.04, S.warmWhite(3.4), { p: [15.0 - 0.28, TOP + 6.15, tz + Math.sign(tz) * -0.11] });
    B.box(0.75, 0.3, 0.04, S.warmWhite(3.4), { p: [15.0 - 0.28, TOP + 6.15, tz + Math.sign(tz) * 0.11] });
    halos.push({ p: new THREE.Vector3(14.7, TOP + 6.1, tz), color: '#ffe1b0', size: 3.2, intensity: 0.9 });
  }
  // ── patio heaters near the loading zone ──
  for (const hz of [-6.4, 6.4]) {
    B.cyl(0.2, 0.24, 0.1, S.darkSteel, { p: [8.6, TOP + 0.05, hz] }, 10);
    B.cyl(0.04, 0.04, 2.1, S.darkSteel, { p: [8.6, TOP + 1.1, hz] }, 6);
    B.cyl(0.05, 0.3, 0.32, S.darkSteel, { p: [8.6, TOP + 2.25, hz] }, 10);
    B.cyl(0.12, 0.12, 0.22, S.warm(3.4), { p: [8.6, TOP + 2.08, hz] }, 10);
    halos.push({ p: new THREE.Vector3(8.6, TOP + 2.0, hz), color: '#ff8a34', size: 2.8, intensity: 0.95, flicker: 0.1 });
  }
  // supply stacks
  for (let i = 0; i < 3; i++) B.rbox(0.8, 0.6, 0.7, 0.04, { color: i % 2 ? '#2c5f8f' : '#c8631c', rough: 0.6 }, { p: [12.2 + (i % 2) * 0.05, TOP + 0.3 + (i > 1 ? 0.6 : 0), -7.8 + i * 0.0], r: [0, 0.1 * i, 0] });

  const staticGeo = d.add(B.build());
  const mesh = new THREE.Mesh(staticGeo, d.add(createPropMaterial({ snow: 0.9 })));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'station:static';
  group.add(mesh);

  // ── building sign ──
  {
    const tex = d.add(makeSignTexture([{ text: 'STATION POLARIS', size: 120, color: '#e9fbff' }, { text: 'Arktis-Observatorium · Fährdienst', size: 48, color: '#7fd6ff', weight: '600' }], '#0c1e33', '#4fc3ff'));
    const mat = d.add(new THREE.MeshBasicNodeMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) }));
    const geo = d.add(new THREE.PlaneGeometry(3.6, 0.9));
    const sign = new THREE.Mesh(geo, mat);
    sign.position.set(bx0 - 0.045, TOP + 3.05, cz - 0.6);
    sign.rotation.y = -Math.PI / 2;
    group.add(sign);
    halos.push({ p: new THREE.Vector3(bx0 - 0.5, TOP + 3.05, cz - 0.6), color: '#4fc3ff', size: 4.2, intensity: 0.28 });
  }

  // ── rotating radar on the roof ──
  const radar = new THREE.Group();
  radar.position.set(bx1 - 1.6, TOP + bh + 0.35, bz1 - 3.2);
  {
    const RB = new PropBuilder();
    RB.cyl(0.05, 0.08, 0.6, S.steel, { p: [0, 0.3, 0] }, 8);
    RB.box(0.16, 0.2, 0.2, S.darkSteel, { p: [0, 0.65, 0] });
    const rg = d.add(RB.build());
    radar.add(new THREE.Mesh(rg, d.add(createPropMaterial({ snow: 0.5 }))));
    const spin = new THREE.Group();
    spin.position.y = 0.7;
    radar.add(spin);
    const AB = new PropBuilder();
    AB.box(1.7, 0.16, 0.07, S.white, { p: [0, 0.1, 0.0] });
    AB.box(1.7, 0.03, 0.14, S.steel, { p: [0, 0.2, 0.03] });
    AB.box(0.08, 0.1, 0.1, S.red2(2.0), { p: [0.82, 0.1, 0] });
    spin.add(new THREE.Mesh(d.add(AB.build()), d.add(createPropMaterial({ snow: 0.2 }))));
    (radar.userData as { spin: THREE.Group }).spin = spin;
  }
  group.add(radar);
  halos.push({ p: new THREE.Vector3(radar.position.x, radar.position.y + 0.9, radar.position.z), color: '#ff3a24', size: 0.9, intensity: 0.5 });

  // ── station comms beacon (amber, slow rotate) ──
  const beaconU = uniform(1);
  const beaconMat = d.add(new THREE.MeshBasicNodeMaterial());
  beaconMat.colorNode = color(new THREE.Color('#ffb020')).mul(beaconU).mul(3.0);
  const beacon = new THREE.Mesh(d.add(new THREE.SphereGeometry(0.16, 12, 8)), beaconMat);
  beacon.position.set(bx1 - 0.5, TOP + bh + 4.3, bz0 + 0.9);
  group.add(beacon);

  // ── light shafts from the floodlights ──
  const shaftCount = q.level === 'low' ? 0 : 2;
  const shafts: THREE.Mesh[] = [];
  for (let i = 0; i < shaftCount; i++) {
    const sh = lightShaft('#ffd9a8', 6.0, 0.12, 2.3, 0.16);
    d.add(sh.geometry);
    d.add(sh.material as THREE.Material);
    sh.position.set(14.55, TOP + 6.1, i ? 7.6 : -7.6);
    sh.rotation.z = -0.18;
    sh.rotation.x = i ? -0.08 : 0.08;
    group.add(sh);
    shafts.push(sh);
  }

  // ── steam ──
  const steam = createParticles({
    count: 70,
    min: [cx - 0.7, TOP + bh + 0.9, -3.7],
    max: [cx - 0.1, TOP + bh + 6.5, -1.8],
    color: '#cfe4ff',
    size: 1.1,
    motion: 'rise',
    speed: 0.9,
    wind: [1.2, 0.3],
    additive: false,
    opacity: 0.22,
    quality: q,
  });
  steam.renderOrder = 6;
  group.add(steam);
  const edgeSteam = createParticles({
    count: 40,
    min: [P0 + 0.3, TOP + 0.05, -8.2],
    max: [P0 + 1.3, TOP + 2.4, -7.0],
    color: '#bfe0ff',
    size: 0.8,
    motion: 'rise',
    speed: 0.5,
    wind: [1.5, 0.2],
    additive: false,
    opacity: 0.16,
    quality: q,
  });
  edgeSteam.renderOrder = 6;
  group.add(edgeSteam);

  void BANK_EDGE;
  void groundHeight;
  return {
    group,
    halos,
    update(dt, t) {
      const spin = (radar.userData as { spin: THREE.Group }).spin;
      spin.rotation.y += dt * 1.1;
      heat.value = 0.9 + Math.sin(t * 0.8) * 0.1;
      const ph = (t % 2.2) / 2.2;
      beaconU.value = ph < 0.1 ? 1 : 0.08;
      for (const s of shafts) s.visible = true;
    },
  };
}
