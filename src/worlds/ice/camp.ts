import * as THREE from 'three/webgpu';
import { Fn, color, float, mix, positionLocal, sin, smoothstep, time, uniform, uv, vec3 } from 'three/tsl';
import { rockGeometry } from '../../world/kit';
import { lathe, latheShell, merge } from '../../characters/geo';
import { BANK_Y, PropBuilder, S, createPropMaterial, groundHeight, type WorldCtx } from './common';
import { makeSignTexture, type HaloSpec } from './fx';

export interface Camp {
  group: THREE.Group;
  halos: HaloSpec[];
  /** camera-facing fire position for particles / lights */
  fire: THREE.Vector3;
  update(dt: number, t: number): void;
}

const gy = (x: number, z: number) => groundHeight(x, z);

function tent(B: PropBuilder, x: number, z: number, yaw: number, r: number, main: string, accent: string, len = 1.25): void {
  const y0 = gy(x, z) - 0.02;
  const dome = new THREE.SphereGeometry(r, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  B.add(dome, { color: main, rough: 0.92 }, { p: [x, y0, z], r: [0, yaw, 0], s: [1, 0.78, len] });
  // two-tone skirt
  B.add(new THREE.CylinderGeometry(r * 1.005, r * 1.005, 0.34, 26, 1, true), { color: accent, rough: 0.9 }, { p: [x, y0 + 0.14, z], r: [0, yaw, 0], s: [1, 1, len] });
  // pole ribs
  for (const a of [0, Math.PI / 2]) {
    B.add(new THREE.TorusGeometry(r * 1.01, 0.028, 5, 22, Math.PI), { color: '#c9d2dc', rough: 0.4, metal: 0.8 }, { p: [x, y0, z], r: [0, yaw + a, 0], s: [1, 0.79, a === 0 ? len : 1] });
  }
  // glowing door
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const fz = r * len * 0.97;
  const dx = x + s * fz;
  const dz = z + c * fz;
  B.add(new THREE.CircleGeometry(r * 0.36, 16, 0, Math.PI), { color: '#ffb457', rough: 0.5, emit: 2.5 }, { p: [dx, y0 + 0.02, dz], r: [0, yaw, 0], s: [1, 1.5, 1] });
  B.add(new THREE.CircleGeometry(r * 0.36, 16, 0, Math.PI), { color: '#2a2f38', rough: 0.9 }, { p: [x + s * (fz - 0.02), y0 + 0.01, z + c * (fz - 0.02)], r: [0, yaw + Math.PI, 0], s: [1.08, 1.6, 1] });
  // guy lines + stakes
  for (let i = 0; i < 6; i++) {
    const a = yaw + (i / 6) * Math.PI * 2 + 0.3;
    const rx = Math.sin(a);
    const rz = Math.cos(a);
    const top: [number, number, number] = [x + rx * r * 0.7, y0 + r * 0.55, z + rz * r * 0.7 * len];
    const foot: [number, number, number] = [x + rx * (r + 1.5), gy(x + rx * (r + 1.5), z + rz * (r + 1.5)) + 0.02, z + rz * (r + 1.5)];
    B.rod(top, foot, 0.008, { color: '#cdd6e0', rough: 0.6 }, 4);
    B.cyl(0.02, 0.02, 0.2, S.orange, { p: [foot[0], foot[1] + 0.05, foot[2]], r: [0.3, 0, 0] }, 5);
  }
}

function crate(B: PropBuilder, x: number, y: number, z: number, yaw: number, w: number, h: number, d: number, kind: number): void {
  const col = [S.wood, S.olive, { color: '#c8631c', rough: 0.6 }, { color: '#2c5f8f', rough: 0.6 }][kind % 4]!;
  B.rbox(w, h, d, 0.03, col, { p: [x, y + h / 2, z], r: [0, yaw, 0] });
  // straps / braces
  const strap = { color: kind % 4 === 0 ? '#3b2a1c' : '#20242b', rough: 0.7 };
  B.box(w * 1.02, h * 0.1, d * 1.02, strap, { p: [x, y + h * 0.5, z], r: [0, yaw, 0] });
  B.box(w * 0.1, h * 1.02, d * 1.02, strap, { p: [x, y + h * 0.5, z], r: [0, yaw, 0] });
  // label
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  B.box(w * 0.28, h * 0.22, 0.01, { color: '#e9e2c9', rough: 0.7 }, { p: [x + s * (d / 2 + 0.006), y + h * 0.72, z + c * (d / 2 + 0.006)], r: [0, yaw, 0] });
}

function barrel(B: PropBuilder, x: number, y: number, z: number, col: string): void {
  B.cyl(0.29, 0.29, 0.86, { color: col, rough: 0.5, metal: 0.4 }, { p: [x, y + 0.43, z] }, 14);
  for (const yy of [0.15, 0.43, 0.71]) B.add(new THREE.TorusGeometry(0.295, 0.014, 5, 16), { color: '#1c2026', rough: 0.5, metal: 0.6 }, { p: [x, y + yy, z], r: [Math.PI / 2, 0, 0] });
  B.cyl(0.1, 0.1, 0.03, S.darkSteel, { p: [x + 0.12, y + 0.875, z + 0.06] }, 8);
}

function makeFlag(d: WorldCtx['dispose'], w: number, h: number, base: string, stripe: string, phase: number): THREE.Mesh {
  const geo = d.add(new THREE.PlaneGeometry(w, h, 14, 6));
  geo.translate(w / 2, -h / 2, 0);
  const m = d.add(new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.85 }));
  const u = uv().x;
  const v = uv().y;
  m.colorNode = mix(color(new THREE.Color(base)), color(new THREE.Color(stripe)), smoothstep(0.04, 0.0, v.sub(0.5).abs().sub(0.14)));
  m.positionNode = Fn(() => {
    const p = positionLocal.toVar();
    const k = u;
    p.z.addAssign(sin(u.mul(9.0).sub(time.mul(5.2)).add(phase)).mul(0.11).mul(k).add(sin(u.mul(4.0).sub(time.mul(3.1)).add(v.mul(3.0))).mul(0.06).mul(k)));
    p.y.addAssign(sin(u.mul(7.0).sub(time.mul(4.4)).add(phase)).mul(0.05).mul(k));
    return p;
  })();
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  return mesh;
}

export function createCamp(ctx: WorldCtx): Camp {
  const d = ctx.dispose;
  const group = new THREE.Group();
  group.name = 'camp';
  const halos: HaloSpec[] = [];
  const B = new PropBuilder();
  const R = 6.0;

  // ── tents ──
  tent(B, -14.4, -5.6, 1.15, 2.15, '#dc6a1e', '#7a2d10');
  tent(B, -15.4, 6.6, 2.05, 1.85, '#1e9aa0', '#0d4e58');
  tent(B, -18.4, 0.2, 1.55, 1.55, '#e2b634', '#7a5a12', 1.15);
  halos.push({ p: new THREE.Vector3(-14.4 + Math.sin(1.15) * 2.6, 1.0, -5.6 + Math.cos(1.15) * 2.6), color: '#ff9a3c', size: 3.6, intensity: 0.75, flicker: 0.15 });
  halos.push({ p: new THREE.Vector3(-15.4 + Math.sin(2.05) * 2.1, 0.9, 6.6 + Math.cos(2.05) * 2.1), color: '#ffb057', size: 3.0, intensity: 0.65, flicker: 0.15 });
  halos.push({ p: new THREE.Vector3(-18.4 + Math.sin(1.55) * 1.6, 0.8, 0.2 + Math.cos(1.55) * 1.6), color: '#ffc46a', size: 2.6, intensity: 0.55, flicker: 0.2 });

  // ── crates (two work piles for the storage robot + scattered) ──
  const pile = (px: number, pz: number, yaw: number, n: number) => {
    const base = gy(px, pz);
    crate(B, px, base, pz, yaw, 1.0, 0.7, 0.8, 0);
    crate(B, px + 0.05, base, pz + 0.95, yaw + 0.06, 0.9, 0.62, 0.9, 1);
    if (n > 2) crate(B, px, base + 0.7, pz + 0.1, yaw - 0.05, 0.85, 0.55, 0.7, 2);
  };
  pile(-12.3, 3.3, 0.05, 3);
  pile(-12.3, 9.8, -0.06, 2);
  crate(B, -7.8, gy(-7.8, -7.4), -7.4, 0.3, 0.9, 0.6, 0.7, 3);
  crate(B, -8.9, gy(-8.9, -7.9), -7.9, -0.2, 0.7, 0.5, 0.6, 1);
  crate(B, -8.3, gy(-8.3, -7.6) + 0.6, -7.6, 0.5, 0.6, 0.45, 0.5, 2);
  crate(B, -16.8, gy(-16.8, 10.4), 10.4, 0.8, 1.1, 0.7, 0.9, 0);
  crate(B, -10.4, gy(-10.4, -10.6), -10.6, 0.1, 0.9, 0.6, 0.7, 3);

  // ── barrels ──
  barrel(B, -12.2, gy(-12.2, -9.4), -9.4, '#b8341f');
  barrel(B, -11.5, gy(-11.5, -9.9), -9.9, '#2f6ea0');
  barrel(B, -12.9, gy(-12.9, -9.9), -9.7, '#d68a1f');
  barrel(B, -9.2, gy(-9.2, 10.4), 10.4, '#b8341f');
  barrel(B, -8.6, gy(-8.6, 11.0), 11.0, '#3a7a58');

  // ── generator ──
  {
    const gx = -10.9;
    const gz = -8.3;
    const base = gy(gx, gz);
    B.rbox(1.7, 0.95, 0.95, 0.06, { color: '#d97a1c', rough: 0.5, metal: 0.3 }, { p: [gx, base + 0.62, gz], r: [0, 0.25, 0] });
    B.box(1.75, 0.12, 1.0, S.darkSteel, { p: [gx, base + 0.1, gz], r: [0, 0.25, 0] });
    for (let i = 0; i < 5; i++) B.box(0.05, 0.6, 0.02, S.darkSteel, { p: [gx - 0.5 + i * 0.14, base + 0.66, gz + 0.48], r: [0, 0.25, 0] });
    B.cyl(0.07, 0.07, 1.0, S.darkSteel, { p: [gx + 0.5, base + 1.5, gz - 0.2] }, 8);
    B.cyl(0.11, 0.11, 0.07, S.darkSteel, { p: [gx + 0.5, base + 2.0, gz - 0.2] }, 8);
    for (let i = 0; i < 4; i++) B.box(0.05, 0.05, 0.02, i % 2 ? S.green(2.6) : S.warm(2.6), { p: [gx + 0.3 + i * 0.08, base + 0.95, gz + 0.58], r: [0, 0.25, 0] });
    B.cyl(0.18, 0.18, 0.34, S.red, { p: [gx - 1.25, base + 0.17, gz + 0.3] }, 10);
    halos.push({ p: new THREE.Vector3(gx + 0.36, base + 0.98, gz + 0.62), color: '#8dffb3', size: 0.7, intensity: 0.55 });
  }

  // ── sled with lashed cargo ──
  {
    const sx = -8.9;
    const sz = 6.5;
    const sy = gy(sx, sz);
    const yaw = 0.35;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const side of [-1, 1]) {
      const ox = c * side * 0.42;
      const oz = -s * side * 0.42;
      B.tube([[sx + ox - s * 1.2, sy + 0.16, sz + oz - c * 1.2], [sx + ox - s * 0.7, sy + 0.05, sz + oz - c * 0.7], [sx + ox + s * 0.8, sy + 0.05, sz + oz + c * 0.8], [sx + ox + s * 1.25, sy + 0.32, sz + oz + c * 1.25]], 0.025, S.darkWood, 14, 5);
    }
    for (let i = 0; i < 6; i++) {
      const t = -0.95 + i * 0.38;
      B.box(0.95, 0.04, 0.16, S.wood, { p: [sx + s * t, sy + 0.2, sz + c * t], r: [0, yaw, 0] });
    }
    B.rbox(0.8, 0.36, 1.1, 0.08, { color: '#b8541a', rough: 0.85 }, { p: [sx - s * 0.1, sy + 0.42, sz - c * 0.1], r: [0, yaw, 0] });
    B.cyl(0.14, 0.14, 0.8, { color: '#3d5a3a', rough: 0.9 }, { p: [sx + s * 0.55, sy + 0.5, sz + c * 0.55], r: [0, yaw, Math.PI / 2] }, 10);
    B.box(0.85, 0.03, 0.05, S.darkWood, { p: [sx - s * 0.1, sy + 0.62, sz - c * 0.1], r: [0, yaw, 0] });
    B.tube([[sx + s * 1.25, sy + 0.32, sz + c * 1.25], [sx + s * 1.9, sy + 0.2, sz + c * 1.9], [sx + s * 2.4, sy + 0.04, sz + c * 2.4]], 0.012, { color: '#d8cfa8', rough: 0.9 }, 8, 4);
  }

  // ── antenna mast (lattice, guyed) ──
  const mastX = -17.0;
  const mastZ = -9.4;
  const mastBase = gy(mastX, mastZ);
  {
    const legs: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const top = 11.5;
    const w0 = 0.5;
    const w1 = 0.13;
    const lv = 8;
    for (let k = 0; k < lv; k++) {
      const t0 = k / lv;
      const t1 = (k + 1) / lv;
      const wa = w0 + (w1 - w0) * t0;
      const wb = w0 + (w1 - w0) * t1;
      const ya = mastBase + top * t0;
      const yb = mastBase + top * t1;
      for (let i = 0; i < 4; i++) {
        const a = legs[i]!;
        const b = legs[(i + 1) % 4]!;
        B.rod([mastX + a[0] * wa, ya, mastZ + a[1] * wa], [mastX + a[0] * wb, yb, mastZ + a[1] * wb], 0.024, S.steel, 5);
        B.rod([mastX + a[0] * wb, yb, mastZ + a[1] * wb], [mastX + b[0] * wb, yb, mastZ + b[1] * wb], 0.014, S.steel, 4);
        B.rod([mastX + a[0] * wa, ya, mastZ + a[1] * wa], [mastX + b[0] * wb, yb, mastZ + b[1] * wb], 0.012, S.steel, 4);
      }
    }
    B.cyl(0.02, 0.02, 3.0, S.steel, { p: [mastX, mastBase + top + 1.4, mastZ] }, 5);
    for (let i = 0; i < 4; i++) B.box(0.9 - i * 0.14, 0.02, 0.02, S.steel, { p: [mastX, mastBase + 8.2 + i * 0.45, mastZ], r: [0, 0.7, 0] });
    B.cyl(0.06, 0.06, 1.2, S.darkSteel, { p: [mastX + 0.4, mastBase + 6.5, mastZ + 0.4], r: [0, 0, Math.PI / 2] }, 6);
    B.rbox(0.5, 0.6, 0.3, 0.05, S.white, { p: [mastX + 0.55, mastBase + 5.2, mastZ], r: [0, 0.5, 0] });
    // guy wires
    for (let i = 0; i < 3; i++) {
      const a = 0.4 + (i / 3) * Math.PI * 2;
      const fx = mastX + Math.sin(a) * 6.5;
      const fz = mastZ + Math.cos(a) * 6.5;
      B.rod([mastX, mastBase + 8.2, mastZ], [fx, gy(fx, fz) + 0.05, fz], 0.009, { color: '#c9d0da', rough: 0.5, metal: 0.5 }, 4);
      B.cyl(0.05, 0.05, 0.28, S.orange, { p: [fx, gy(fx, fz) + 0.1, fz] }, 6);
    }
    halos.push({ p: new THREE.Vector3(mastX, mastBase + 11.6, mastZ), color: '#ff3020', size: 1.2, intensity: 0.5, flicker: 0 });
  }

  // ── lantern posts + fire barrel ──
  const lanterns: Array<[number, number]> = [[-9.6, -6.3], [-9.6, 6.1], [-13.0, -1.8], [-13.6, 3.4], [-8.0, 12.2]];
  for (const [lx, lz] of lanterns) {
    const b = gy(lx, lz);
    B.cyl(0.04, 0.05, 2.2, S.darkWood, { p: [lx, b + 1.1, lz] }, 6);
    B.box(0.5, 0.04, 0.04, S.darkWood, { p: [lx + 0.2, b + 2.05, lz] });
    B.rod([lx + 0.02, b + 1.6, lz], [lx + 0.28, b + 2.0, lz], 0.02, S.darkWood, 4);
    B.cyl(0.02, 0.02, 0.16, S.darkSteel, { p: [lx + 0.42, b + 1.98, lz] }, 4);
    B.cyl(0.075, 0.09, 0.2, S.warmWhite(3.4), { p: [lx + 0.42, b + 1.84, lz] }, 8);
    B.cyl(0.06, 0.1, 0.04, S.darkSteel, { p: [lx + 0.42, b + 1.95, lz] }, 8);
    halos.push({ p: new THREE.Vector3(lx + 0.42, b + 1.84, lz), color: '#ffb35a', size: 2.4, intensity: 0.85, flicker: 0.25 });
  }
  const fire = new THREE.Vector3(-11.0, 0, 1.0);
  fire.y = gy(fire.x, fire.z);
  {
    const fb = fire.y;
    B.add(latheShell([[0.31, 0.0], [0.33, 0.45], [0.3, 0.9]], 14, 6), { color: '#3a2a22', rough: 0.55, metal: 0.7 }, { p: [fire.x, fb, fire.z] });
    B.cyl(0.3, 0.3, 0.04, { color: '#3a2a22', rough: 0.5, metal: 0.6 }, { p: [fire.x, fb + 0.02, fire.z] }, 12);
    B.cyl(0.26, 0.26, 0.06, { color: '#ff7a1c', rough: 0.6, emit: 2.6 }, { p: [fire.x, fb + 0.76, fire.z] }, 12);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      B.rbox(0.42, 0.09, 0.09, 0.02, S.darkWood, { p: [fire.x + Math.cos(a) * 0.9, fb + 0.1, fire.z + Math.sin(a) * 0.9], r: [0, -a, 0] });
    }
    halos.push({ p: new THREE.Vector3(fire.x, fb + 1.05, fire.z), color: '#ff8a2a', size: 3.4, intensity: 1.2, flicker: 0.5 });
  }

  // ── rocks: a snow-dusted boulder field behind the camp (one merged mesh) ──
  {
    const RB = new PropBuilder();
    const rr = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
    for (let i = 0; i < 11; i++) {
      const x = -21.5 - rr(i) * 10;
      const z = -14 + i * 2.8 + rr(i + 7) * 2;
      RB.add(rockGeometry(1.2 + rr(i + 3) * 1.6, i + 1, 2, 0.75), { color: i % 2 ? '#2b364b' : '#232d41', rough: 0.9 }, { p: [x, gy(x, z) + 0.1, z], r: [0, rr(i + 11) * 6, 0] });
    }
    for (let i = 0; i < 8; i++) {
      const x = -9.5 - rr(i + 40) * 3.5 - i * 0.2;
      const z = 14 + rr(i + 50) * 9;
      RB.add(rockGeometry(0.5 + rr(i + 60) * 0.7, i + 21, 1, 0.7), { color: '#2a3549', rough: 0.9 }, { p: [x, gy(x, z) + 0.05, z], r: [0, rr(i + 70) * 6, 0] });
    }
    const rockMesh = new THREE.Mesh(d.add(RB.build()), d.add(createPropMaterial({ snow: 1 })));
    rockMesh.receiveShadow = true;
    rockMesh.name = 'camp:rocks';
    group.add(rockMesh);
  }

  // static merged geometry
  const staticGeo = d.add(B.build());
  const mesh = new THREE.Mesh(staticGeo, d.add(createPropMaterial({ snow: 0.9 })));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'camp:static';
  group.add(mesh);

  // ── satellite dish (slowly tracking) ──
  const dish = new THREE.Group();
  dish.position.set(-13.4, gy(-13.4, -9.0), -9.0);
  {
    const PB = new PropBuilder();
    PB.cyl(0.22, 0.34, 0.9, S.darkSteel, { p: [0, 0.45, 0] }, 10);
    PB.cyl(0.38, 0.38, 0.1, S.steel, { p: [0, 0.95, 0] }, 12);
    const ped = d.add(PB.build());
    const pedMesh = new THREE.Mesh(ped, d.add(createPropMaterial({ snow: 0.9 })));
    dish.add(pedMesh);
    const yaw = new THREE.Group();
    yaw.position.y = 1.0;
    dish.add(yaw);
    const tilt = new THREE.Group();
    tilt.position.y = 0.6;
    yaw.add(tilt);
    const DB = new PropBuilder();
    DB.box(0.16, 0.8, 0.16, S.darkSteel, { p: [0, -0.3, 0] });
    DB.box(0.9, 0.1, 0.1, S.darkSteel, { p: [0, 0.1, 0] });
    const bowl = latheShell([[0.0, 0.0], [0.45, 0.06], [0.9, 0.24], [1.15, 0.44]], 28, 10);
    DB.add(bowl, { color: '#e9eef4', rough: 0.35, metal: 0.4 }, { p: [0, 0.1, 0.1], r: [Math.PI / 2, 0, 0] });
    DB.add(new THREE.TorusGeometry(1.15, 0.028, 6, 28), { color: '#cfd8e2', rough: 0.4, metal: 0.5 }, { p: [0, 0.1, 0.54] });
    DB.rod([0.4, 0.1, 0.5], [0.05, 0.1, 1.2], 0.02, S.darkSteel, 5);
    DB.rod([-0.4, 0.1, 0.5], [-0.05, 0.1, 1.2], 0.02, S.darkSteel, 5);
    DB.rod([0, 0.5, 0.5], [0, 0.12, 1.2], 0.02, S.darkSteel, 5);
    DB.cyl(0.07, 0.05, 0.28, S.red2(1.2), { p: [0, 0.1, 1.28], r: [Math.PI / 2, 0, 0] }, 8);
    const dg = d.add(DB.build());
    const dm = new THREE.Mesh(dg, d.add(createPropMaterial({ snow: 0.85 })));
    dm.castShadow = true;
    tilt.add(dm);
    tilt.rotation.x = -0.9;
    (dish.userData as { yaw: THREE.Group; tilt: THREE.Group }).yaw = yaw;
    (dish.userData as { yaw: THREE.Group; tilt: THREE.Group }).tilt = tilt;
    halos.push({ p: new THREE.Vector3(dish.position.x, dish.position.y + 1.9, dish.position.z + 1.0), color: '#ff5030', size: 0.5, intensity: 0.4 });
  }
  group.add(dish);

  // ── weather mast with spinning anemometer ──
  const anemo = new THREE.Group();
  {
    const wx = -18.6;
    const wz = -6.6;
    const wb = gy(wx, wz);
    const WB = new PropBuilder();
    WB.cyl(0.03, 0.045, 3.3, S.steel, { p: [wx, wb + 1.65, wz] }, 6);
    WB.rbox(0.42, 0.34, 0.26, 0.03, S.white, { p: [wx + 0.18, wb + 1.2, wz] });
    WB.box(0.3, 0.06, 0.02, S.cyan(2.2), { p: [wx + 0.18, wb + 1.26, wz + 0.135] });
    WB.rod([wx, wb + 3.0, wz], [wx + 0.6, wb + 3.0, wz], 0.014, S.steel, 4);
    WB.cone(0.05, 0.22, S.red, { p: [wx + 0.72, wb + 3.0, wz], r: [0, 0, -Math.PI / 2] }, 6);
    WB.box(0.2, 0.16, 0.012, S.red, { p: [wx - 0.05, wb + 3.0, wz] });
    group.add(new THREE.Mesh(d.add(WB.build()), d.add(createPropMaterial({ snow: 0.4 }))));
    const AB = new PropBuilder();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      AB.rod([0, 0, 0], [Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32], 0.012, S.steel, 4);
      AB.add(new THREE.SphereGeometry(0.08, 10, 6, 0, Math.PI), S.orange, { p: [Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32], r: [0, -a + Math.PI / 2, 0] });
    }
    AB.cyl(0.03, 0.03, 0.08, S.darkSteel, { p: [0, -0.04, 0] }, 6);
    anemo.add(new THREE.Mesh(d.add(AB.build()), d.add(createPropMaterial({ snow: 0.1 }))));
    anemo.position.set(wx, wb + 3.35, wz);
    group.add(anemo);
  }

  // ── blinking aviation lights (mast) ──
  const blink = uniform(1);
  const blinkMat = d.add(new THREE.MeshBasicNodeMaterial());
  blinkMat.colorNode = color(new THREE.Color('#ff2a18')).mul(blink).mul(3.2);
  const blinkGeo = d.add(new THREE.SphereGeometry(0.11, 10, 8));
  const blinkers = new THREE.InstancedMesh(blinkGeo, blinkMat, 3);
  const m4 = new THREE.Matrix4();
  [4.2, 8.0, 11.6].forEach((h, i) => {
    m4.makeTranslation(mastX + (i === 2 ? 0 : 0.26), mastBase + h, mastZ + (i === 2 ? 0 : 0.26));
    blinkers.setMatrixAt(i, m4);
  });
  blinkers.instanceMatrix.needsUpdate = true;
  blinkers.frustumCulled = false;
  group.add(blinkers);
  // dish LED + tent lantern glass are part of the static mesh (emissive)

  // ── flags ──
  const flagDefs: Array<[number, number, number, string, string, number]> = [
    [-8.1, -6.9, 4.6, '#e2661c', '#f4f0e6', 0],
    [-8.1, 6.6, 4.0, '#1e9aa0', '#f4f0e6', 1.7],
    [-11.4, -11.6, 6.2, '#f2f0ea', '#e2661c', 3.1],
  ];
  const poleB = new PropBuilder();
  for (const [fx, fz, h, c1, c2, ph] of flagDefs) {
    const b = gy(fx, fz);
    poleB.cyl(0.04, 0.055, h, S.steel, { p: [fx, b + h / 2, fz] }, 6);
    poleB.ell(0.07, 0.07, 0.07, S.yellow, { p: [fx, b + h + 0.05, fz] }, 8, 6);
    const flag = makeFlag(d, 1.7, 1.0, c1, c2, ph);
    flag.position.set(fx + 0.05, b + h - 0.08, fz);
    group.add(flag);
  }
  const poleMesh = new THREE.Mesh(d.add(poleB.build()), d.add(createPropMaterial({ snow: 0.4 })));
  poleMesh.castShadow = true;
  group.add(poleMesh);

  // ── welcome sign ──
  {
    const tex = d.add(makeSignTexture([{ text: 'CAMP NORDLICHT', size: 104, color: '#fdf1d6' }, { text: '68°N · Forschungslager', size: 46, color: '#e8b56a', weight: '600' }], '#3a2a1e', '#e8b56a'));
    const mat = d.add(new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.75, emissive: new THREE.Color('#ffb060'), emissiveMap: tex, emissiveIntensity: 0.55 }));
    const geo = d.add(new THREE.BoxGeometry(2.9, 0.75, 0.08));
    const sign = new THREE.Mesh(geo, mat);
    const sx = -9.2;
    const sz = -9.4;
    sign.position.set(sx, gy(sx, sz) + 1.9, sz);
    sign.rotation.y = 0.35;
    sign.castShadow = true;
    group.add(sign);
    const legs = new PropBuilder();
    for (const o of [-1.2, 1.2]) legs.cyl(0.05, 0.06, 2.0, S.darkWood, { p: [sx + Math.cos(0.35) * o, gy(sx, sz) + 0.95, sz - Math.sin(0.35) * o] }, 6);
    const lm = new THREE.Mesh(d.add(legs.build()), d.add(createPropMaterial({ snow: 0.3 })));
    group.add(lm);
    halos.push({ p: new THREE.Vector3(sx + 0.3, gy(sx, sz) + 2.35, sz + 0.2), color: '#ffcf8a', size: 2.0, intensity: 0.5 });
  }
  void BANK_Y;
  void R;
  void float;
  void vec3;
  void lathe;
  void merge;

  return {
    group,
    halos,
    fire,
    update(dt, t) {
      const yaw = (dish.userData as { yaw: THREE.Group }).yaw;
      const tilt = (dish.userData as { tilt: THREE.Group }).tilt;
      anemo.rotation.y += dt * (4.5 + Math.sin(t * 0.4) * 2);
      yaw.rotation.y += dt * 0.11;
      tilt.rotation.x = -0.9 + Math.sin(t * 0.13) * 0.16;
      // aviation blink: 1.4 s cycle, short flash
      const ph = (t % 1.4) / 1.4;
      blink.value = ph < 0.16 ? 1 : 0.06;
    },
  };
}
