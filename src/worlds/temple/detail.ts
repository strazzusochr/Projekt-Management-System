import * as THREE from 'three/webgpu';
import { rng, rockGeometry } from '../../world/kit';
import type { QualityPreset } from '../../render/quality';
import { Bin, S, box, build, instanced, mtx, swayNode, vcMaterial, weather, type Geo } from './util';
import { terrainHeight, quayEdge } from './terrain';
import type { Module } from './structures';
import { bake, merge } from '../../characters/geo';

const col = (h: string) => new THREE.Color(h);

/** Flagstone paving on the bank terraces, low rubble and grass tufts – removes the empty look. */
export function buildDetail(bin: Bin, quality: QualityPreset): Module {
  const g = new THREE.Group();
  g.name = 'detail';
  const r = rng(6161);
  const dens = quality.density;
  const mat = bin.add(vcMaterial());

  // ── flagstones ──
  const tileGeo = build([[box(1, 1, 1), S('#ffffff', 0.9)]]);
  bin.add(tileGeo);
  const tm: THREE.Matrix4[] = [];
  const tc: THREE.Color[] = [];
  const stones = [col('#8e9682'), col('#7d8874'), col('#9aa08c'), col('#6f7c68')];
  const zone = (s: number, x0: number, x1: number, z0: number, z1: number, step: number) => {
    for (let x = x0; x < x1; x += step) {
      for (let z = z0; z < z1; z += step) {
        const xx = s * (x + step / 2);
        const zz = z + step / 2;
        if (Math.abs(zz) < 1.6 && x < 7.4) continue; // stair landing has its own stones
        const y = terrainHeight(xx, zz);
        const e = quayEdge(zz);
        if (x + step / 2 < e + 0.3) continue;
        if (Math.abs(terrainHeight(xx + 0.7, zz) - y) > 0.25 || Math.abs(terrainHeight(xx, zz + 0.7) - y) > 0.25) continue;
        const sz = step - 0.07 - r() * 0.05;
        tm.push(mtx(xx, y + 0.005 + r() * 0.012, zz, (r() - 0.5) * 0.06, [sz, 0.07, sz * (0.92 + r() * 0.08)]));
        const c = stones[Math.floor(r() * stones.length)]!.clone().multiplyScalar(0.85 + r() * 0.3);
        if (r() < 0.32) c.lerp(col('#4f8a3a'), 0.25 + r() * 0.45);
        tc.push(c);
      }
    }
  };
  const step = 1.35;
  for (const s of [-1, 1]) {
    zone(s, 6.4, 14.2, -22, 22, step);
    zone(s, 16.6, 22.8, -30, 24, step * 1.15);
  }
  g.add(instanced(tileGeo, mat, tm, tc, false));

  // ── rubble & rocks ──
  const rocks: Geo[] = [];
  for (let i = 0; i < 4; i++) {
    const rg = rockGeometry(0.34 + i * 0.05, i + 3, 1, 0.75);
    rocks.push(bake(rg, { color: ['#7b8676', '#6c7868', '#8a9080', '#5f6c5c'][i]!, rough: 0.95 }));
  }
  const rockGeo = weather(merge([rocks[0]!]), 1, '#4f8a3a', 0.4, 0.5, 0.2);
  const rockGeo2 = weather(merge([rocks[2]!]), 4, '#4f8a3a', 0.5, 0.5, 0.2);
  bin.add(rockGeo), bin.add(rockGeo2);
  for (const rg of [rockGeo, rockGeo2]) {
    const m: THREE.Matrix4[] = [];
    const c: THREE.Color[] = [];
    const n = Math.round(60 * dens);
    for (let i = 0; i < n; i++) {
      const s = r() < 0.5 ? -1 : 1;
      const x = s * (6.8 + Math.pow(r(), 1.3) * 22);
      const z = -40 + r() * 64;
      if (Math.abs(x) < 12.6 && Math.abs(z) < 6.4) continue;
      const y = terrainHeight(x, z);
      if (y < 0.3) continue;
      m.push(mtx(x, y - 0.06, z, r() * 6.28, 0.5 + r() * 1.5, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3));
      c.push(col('#ffffff').multiplyScalar(0.7 + r() * 0.4));
    }
    g.add(instanced(rg, mat, m, c, false));
  }

  // ── grass tufts ──
  const blades: Geo[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r();
    const h = 0.45 + r() * 0.45;
    const w = 0.035 + r() * 0.02;
    const p = [0, 0, 0, w, 0, 0, -w, 0, 0, w * 0.6, h * 0.55, h * 0.12, -w * 0.6, h * 0.55, h * 0.12, 0, h, h * 0.42];
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    bg.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
    bg.computeVertexNormals();
    bg.rotateY(a);
    // widen the base: fix winding via normals
    const cl: number[] = [];
    const pos = bg.getAttribute('position');
    const cb = col('#1c4a26');
    const ct = col(r() < 0.5 ? '#8fd050' : '#b8e070');
    for (let k = 0; k < pos.count; k++) {
      const t = Math.min(1, pos.getY(k) / h);
      const c = cb.clone().lerp(ct, t);
      cl.push(c.r, c.g, c.b);
    }
    bg.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    bg.setAttribute('aPbr', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3).map((_, k) => (k % 3 === 0 ? 0.8 : 0)), 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
    blades.push(bg);
  }
  const tuft = merge(blades);
  bin.add(tuft);
  const gm = vcMaterial({ side: THREE.DoubleSide });
  gm.positionNode = swayNode(0.14, 1.9, 0.9);
  bin.add(gm);
  const gmx: THREE.Matrix4[] = [];
  const gcs: THREE.Color[] = [];
  const nG = Math.round(1100 * dens);
  let tries = 0;
  while (gmx.length < nG && tries++ < nG * 12) {
    const s = r() < 0.5 ? -1 : 1;
    let x: number;
    let z = -46 + r() * 70;
    if (r() < 0.45) {
      // lush fringe along the quay edge (leaves the stair landings clear)
      z = -34 + r() * 68;
      if (Math.abs(z) < 2.8) continue;
      x = s * (quayEdge(z) + 0.05 + r() * 0.5);
    } else {
      x = s * (6.9 + Math.pow(r(), 1.15) * 26);
      if (Math.abs(x) < 12.6 && Math.abs(z) < 6.2) continue;
    }
    const y = terrainHeight(x, z);
    if (y < 0.3) continue;
    gmx.push(mtx(x, y - 0.02, z, r() * 6.28, 0.7 + r() * 1.0));
    gcs.push(col('#ffffff').lerp(col('#c8e090'), r() * 0.6).multiplyScalar(0.75 + r() * 0.4));
  }
  g.add(instanced(tuft, gm, gmx, gcs, false));
  return { obj: g };
}
