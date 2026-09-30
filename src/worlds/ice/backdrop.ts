import * as THREE from 'three/webgpu';
import { Fn, attribute, cos, hash, instanceIndex, positionLocal, sin, time, vec3 } from 'three/tsl';
import { rng } from '../../world/kit';
import { WATER_Y, terrainHeight, type WorldCtx } from './common';
import {
  chunkGeometry,
  createCrystals,
  createIceCave,
  createIceMaterial,
  glacierWallGeometry,
  icebergGeometry,
  mergeIce,
  mountainGeometry,
  spireGeometry,
  type CrystalCluster,
} from './ice';

export interface Backdrop {
  group: THREE.Group;
  /** Positions of cave mouths (for optional local lights). */
  caves: THREE.Vector3[];
  update(dt: number, t: number): void;
}

export function createBackdrop(ctx: WorldCtx): Backdrop {
  const d = ctx.dispose;
  const q = ctx.quality;
  const group = new THREE.Group();
  group.name = 'backdrop';
  const bergMat = d.add(createIceMaterial({ glow: 1.7, rough: 0.16, snow: 0.55 }));
  const glacierMat = d.add(createIceMaterial({ glow: 0.75, rough: 0.28, snow: 0.8 }));
  const r = rng(90210);

  // ── icebergs drifting in the lead (one merged draw call, per-berg bobbing in the vertex shader) ──
  {
    const bergDefs: Array<[number, number, number]> = [
      // x, z, radius
      [-2.6, -13.5, 2.2],
      [3.1, -21, 3.1],
      [-1.8, -31, 4.4],
      [2.0, -44, 5.4],
      [-3.0, -58, 6.4],
      [0.5, -76, 8.0],
      [3.4, -96, 9.5],
      [-3.6, 11.5, 1.4],
      [3.7, 15.5, 1.9],
      [-3.3, -8.0, 1.1],
      [3.4, -9.6, 1.5],
    ];
    const parts: THREE.BufferGeometry[] = [];
    const m4 = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    bergDefs.forEach(([x, z, rad], i) => {
      const geo = icebergGeometry(rad, 3 + i * 1.7);
      e.set((r() - 0.5) * 0.06, r() * 6.28, (r() - 0.5) * 0.06);
      qt.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, WATER_Y + rad * 0.14, z), qt, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m4);
      const ph = new Float32Array(geo.getAttribute('position').count).fill(r() * 6.28);
      geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      parts.push(geo);
    });
    bergMat.positionNode = Fn(() => {
      const p = positionLocal.toVar();
      const ph = attribute('aPhase', 'float');
      p.y.addAssign(sin(time.mul(0.5).add(ph)).mul(0.05));
      p.x.addAssign(sin(time.mul(0.31).add(ph.mul(1.7))).mul(0.035));
      p.z.addAssign(cos(time.mul(0.27).add(ph.mul(2.3))).mul(0.03));
      return p;
    })();
    const mesh = new THREE.Mesh(d.add(mergeIce(parts)), bergMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'icebergs';
    group.add(mesh);
  }

  // ── brash ice ──
  {
    const geo = d.add(chunkGeometry(2.3));
    const mat = d.add(createIceMaterial({ glow: 1.4, rough: 0.2, snow: 0.6 }));
    const idx = instanceIndex.toFloat();
    mat.positionNode = Fn(() => {
      const p = positionLocal.toVar();
      p.y.addAssign(sin(time.mul(1.15).add(hash(idx).mul(6.28))).mul(0.035));
      return p.add(vec3(sin(time.mul(0.4).add(hash(idx.add(3.0)).mul(6.28))).mul(0.05), 0, 0));
    })();
    const n = Math.round(70 * q.density);
    const inst = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      let x = (r() - 0.5) * 11.2;
      let z = 20 - r() * 90;
      if (Math.abs(z) < 2.8 && Math.abs(x) < 5.6) z += z < 0 ? -3 : 3;
      if (Math.abs(x) > 4.6) x *= 0.85;
      const s = 0.22 + Math.pow(r(), 2.2) * 0.85;
      e.set(0, r() * 6.28, 0);
      qt.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, WATER_Y - 0.03 + s * 0.05, z), qt, new THREE.Vector3(s * (1 + r() * 0.6), s * 0.9, s * (1 + r() * 0.6)));
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.name = 'brashIce';
    group.add(inst);
  }

  // ── glacier walls ──
  const walls: Array<{ x: number; z: number; yaw: number; len: number; h: number; seed: number }> = [
    { x: -44, z: -8, yaw: Math.PI / 2, len: 130, h: 20, seed: 1 },
    { x: 44, z: -8, yaw: -Math.PI / 2, len: 130, h: 22, seed: 2 },
    { x: -35, z: -84, yaw: Math.PI / 2 - 0.16, len: 90, h: 28, seed: 3 },
    { x: 35, z: -84, yaw: -Math.PI / 2 + 0.16, len: 90, h: 30, seed: 4 },
    { x: 0, z: -168, yaw: 0, len: 240, h: 46, seed: 5 },
    { x: -80, z: -20, yaw: Math.PI / 2, len: 200, h: 42, seed: 6 },
    { x: 80, z: -20, yaw: -Math.PI / 2, len: 200, h: 44, seed: 7 },
    { x: -20, z: 90, yaw: Math.PI, len: 200, h: 30, seed: 8 },
  ];
  const glacierParts: THREE.BufferGeometry[] = [];
  for (const w of walls) {
    const geo = glacierWallGeometry(w.len, w.h, w.seed, Math.round(w.len / 2.6), 9);
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(w.x, -1.5, w.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, w.yaw, 0)), new THREE.Vector3(1, 1, 1)));
    glacierParts.push(geo);
  }

  // ── seracs / ice spires along the fronts ──
  {
    const parts: THREE.BufferGeometry[] = [];
    const n = Math.round(46 * Math.min(1, q.density + 0.2));
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const z = -110 + (i / n) * 130 + (r() - 0.5) * 6;
      const x = side * (30 + r() * 20);
      const wallX = Math.abs(z) > 60 ? 35 : 44;
      const px = side * (wallX - 1.5 - r() * 3);
      void x;
      const h = 6 + r() * 12;
      const sp = spireGeometry(1.4 + r() * 2.2, h, i * 1.3, 5 + (i % 3));
      sp.rotateZ((r() - 0.5) * 0.25);
      sp.translate(px, terrainHeight(px, z) - 0.5, z);
      parts.push(sp);
    }
    // the great central spires at the head of the fjord
    for (let i = 0; i < 9; i++) {
      const sp = spireGeometry(3 + r() * 3, 16 + r() * 16, 100 + i, 6);
      sp.translate(-40 + i * 10 + (r() - 0.5) * 4, 4, -140 + r() * 8);
      parts.push(sp);
    }
    for (const p of parts) glacierParts.push(p);
  }

  // ── distant mountains ──
  {
    const parts: THREE.BufferGeometry[] = [];
    const defs: Array<[number, number, number, number]> = [
      [-110, -300, 95, 88],
      [-10, -330, 120, 112],
      [95, -310, 100, 92],
      [190, -260, 90, 72],
      [-210, -250, 100, 80],
      [-300, -80, 110, 84],
      [310, -100, 105, 78],
      [-280, 150, 95, 66],
      [290, 140, 100, 72],
      [-90, 320, 100, 70],
      [110, 330, 105, 68],
      [30, -420, 150, 120],
    ];
    defs.forEach(([x, z, rad, h], i) => {
      const g = mountainGeometry(rad, h, 1.3 + i * 2.1);
      g.translate(x, -4, z);
      parts.push(g);
    });
    const merged = mergeIce(parts);
    const mat = d.add(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, flatShading: false }));
    const mesh = new THREE.Mesh(d.add(merged), mat);
    mesh.name = 'mountains';
    group.add(mesh);
  }

  // ── ice caves ──
  const caveMouths: THREE.Vector3[] = [];
  const caveDefs: Array<{ x: number; z: number; yaw: number; s: number }> = [
    { x: -41.2, z: -22, yaw: Math.PI / 2, s: 2.6 },
    { x: 41.2, z: -30, yaw: -Math.PI / 2, s: 2.9 },
    { x: -31.5, z: -74, yaw: Math.PI / 2 - 0.16, s: 3.2 },
  ];
  for (const c of caveDefs) {
    const cave = createIceCave(c.s, c.x + c.z, q, d);
    const cy = terrainHeight(c.x, c.z) - 0.2;
    cave.group.position.set(c.x, cy, c.z);
    cave.group.rotation.y = c.yaw;
    group.add(cave.group);
    cave.arch.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(c.x, cy, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c.yaw, 0)), new THREE.Vector3(1, 1, 1)));
    glacierParts.push(cave.arch);
    caveMouths.push(new THREE.Vector3(c.x + Math.sin(c.yaw) * 3, terrainHeight(c.x, c.z) + 1.6, c.z + Math.cos(c.yaw) * 3));
  }

  {
    const mesh = new THREE.Mesh(d.add(mergeIce(glacierParts)), glacierMat);
    mesh.name = 'glaciers';
    group.add(mesh);
  }

  // ── crystals ──
  const clusters: CrystalCluster[] = [];
  const add = (x: number, z: number, s: number, tint: CrystalCluster['tint'], count = 7) => clusters.push({ x, y: terrainHeight(x, z) - 0.05, z, count, scale: s, tint });
  // along the lead edge (glowing fissures reaching the water)
  add(-6.5, -9.5, 0.7, 'cyan');
  add(-6.6, 10.6, 0.8, 'cyan');
  add(-6.9, 16.5, 0.7, 'blue');
  add(-6.5, -15.5, 0.9, 'teal');
  add(-7.4, -22, 0.9, 'cyan');
  add(-7.2, 24, 0.8, 'blue');
  add(6.5, -11, 0.75, 'cyan');
  add(6.6, 12.5, 0.75, 'blue');
  add(7.0, 18, 0.7, 'teal');
  add(6.6, -18, 0.9, 'cyan');
  add(7.2, -26, 0.9, 'violet');
  // camp side
  add(-19.6, -13.5, 1.0, 'violet');
  add(-20.6, -2.6, 0.9, 'blue');
  add(-17.6, 13.4, 0.9, 'teal');
  add(-24.5, 7.5, 1.2, 'cyan', 9);
  add(-27.0, -9, 1.3, 'violet', 9);
  add(-14.0, -14.5, 0.8, 'cyan');
  // station side
  add(19.2, -13.5, 0.9, 'violet');
  add(21.5, 12.0, 1.0, 'teal');
  add(24.5, -1.5, 1.2, 'cyan', 9);
  add(18.0, 16.5, 0.9, 'blue');
  add(27, -12, 1.3, 'violet', 9);
  // mouths of the caves
  for (const c of caveDefs) {
    const ox = Math.sin(c.yaw);
    const oz = Math.cos(c.yaw);
    add(c.x + ox * 3.2 + oz * 2.4, c.z + oz * 3.2 - ox * 2.4, 1.0, 'cyan', 8);
    add(c.x + ox * 3.4 - oz * 2.6, c.z + oz * 3.4 + ox * 2.6, 1.1, 'blue', 8);
  }
  group.add(createCrystals(clusters, q, d));

  return {
    group,
    caves: caveMouths,
    update() {
      /* everything animates in shaders */
    },
  };
}
