import * as THREE from 'three/webgpu';
import { rng } from '../../world/kit';
import { mtx, smooth as ss, vcMaterial, instanced, build, S, Bin } from './util';
import { ellipsoid, roundedBox } from '../../characters/geo';

/** Position of the quay edge (|x|) – slightly pushed in around the landing stairs. */
export function quayEdge(z: number): number {
  return 6.05 - 0.35 * (1 - ss(1.0, 2.6, Math.abs(z)));
}

/** Analytic terrain height – used for the mesh, for actors (groundAt) and for prop placement. */
export function terrainHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  const edge = quayEdge(z);
  const bed = -2.7 + Math.sin(z * 0.23 + 1.3) * 0.25 + Math.sin(x * 0.9) * 0.08;
  const flat = ss(edge - 0.3, edge, ax);
  let h = bed + (0.5 - bed) * flat;
  let up = 0;
  up += 1.5 * ss(14.5, 16.2, ax);
  up += 2.4 * ss(23, 25.2, ax);
  up += 40 * Math.pow(ss(31, 62, ax), 1.5);
  const rug = ss(26, 42, ax);
  const n1 = Math.sin(x * 0.31 + z * 0.17) * Math.sin(z * 0.23 - x * 0.11);
  up += rug * (2.6 * n1 + 1.7 * Math.sin(x * 0.8 + z * 0.6) * Math.cos(z * 0.5 - x * 0.35) + 0.9 * Math.sin(z * 1.7 + x * 1.3));
  // gorge end (far, -z): the channel rises into the waterfall cliff, walls close in
  const fw = ss(-54, -70, z);
  up += fw * (15 + 34 * ss(0, 26, ax));
  up += 24 * ss(-72, -112, z);
  // back hills (+z)
  up += 15 * ss(30, 52, z);
  // slight undulation of the ruin quay
  h += flat * 0.03 * Math.sin(x * 1.1) * Math.sin(z * 0.9);
  h += up;
  return h;
}

function axis(spec: Array<[number, number, number]>): number[] {
  const out: number[] = [];
  for (const [a, b, s] of spec) {
    const n = Math.max(1, Math.round((b - a) / s));
    for (let i = 0; i <= n; i++) {
      const v = a + ((b - a) * i) / n;
      if (out.length === 0 || v > out[out.length - 1]! + 1e-6) out.push(v);
    }
  }
  return out;
}

const C = (h: string) => new THREE.Color(h);
const PAL = {
  paverA: C('#8a8b74'),
  paverB: C('#6a6f5c'),
  moss: C('#4f7d38'),
  mossDark: C('#2c5a30'),
  wet: C('#2d3f42'),
  rockWarm: C('#75594a'),
  rockCool: C('#4a4a5c'),
  rockDark: C('#33323f'),
  jungle: C('#2f6a36'),
  jungleLight: C('#5f9a3f'),
  ruby: C('#7a4a52'),
};

export function buildTerrain(bin: Bin): THREE.Mesh {
  const xs = axis([[-82, -17, 2.4], [-17, 17, 0.32], [17, 82, 2.4]]);
  const zs = axis([[-138, -19, 2.7], [-19, 19, 0.32], [19, 62, 2.2]]);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const pbr = new Float32Array(nx * nz * 3);
  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i]!;
      const z = zs[j]!;
      const h = terrainHeight(x, z);
      const e = 0.5;
      const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
      const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
      const slope = Math.hypot(dx, dz) / (2 * e);
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      // colour
      const tile = (Math.floor(x / 1.3) + Math.floor(z / 1.3)) & 1;
      const nz1 = 0.5 + 0.5 * Math.sin(x * 1.7 + Math.sin(z * 1.3)) * Math.sin(z * 1.9 - x * 0.7);
      const nz2 = 0.5 + 0.5 * Math.sin(x * 0.53 + 2.0) * Math.cos(z * 0.47 - 1.0) + 0.25 * Math.sin(x * 2.1 + z * 1.7);
      tmp.copy(PAL.paverB).lerp(PAL.paverA, tile * 0.45 + nz1 * 0.4);
      tmp.lerp(PAL.moss, ss(0.5, 0.95, nz2) * 0.75);
      // jungle green on soft high ground
      const jungleMix = ss(0.9, 2.2, h) * (1 - ss(0.5, 1.1, slope));
      tmp2.copy(PAL.jungle).lerp(PAL.jungleLight, ss(0.3, 0.9, nz2));
      tmp.lerp(tmp2, jungleMix);
      // rock on slopes
      const band = 0.5 + 0.5 * Math.sin(h * 0.85 + nz1 * 2.2);
      tmp2.copy(PAL.rockCool).lerp(PAL.rockWarm, band);
      tmp2.lerp(PAL.ruby, ss(0.7, 1.0, nz2) * 0.25);
      tmp2.lerp(PAL.mossDark, ss(0.55, 0.95, nz1 * nz2) * 0.55 * (1 - ss(1.0, 2.2, slope)));
      tmp.lerp(tmp2, ss(0.35, 1.05, slope));
      tmp.lerp(PAL.rockDark, ss(18, 46, h) * 0.5);
      // wet dark edges close to the water
      tmp.lerp(PAL.wet, (1 - ss(-0.2, 0.7, h)) * 0.85);
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
      pbr[k * 3] = 0.92;
      pbr[k * 3 + 1] = 0;
      pbr[k * 3 + 2] = 0;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx[n++] = a;
      idx[n++] = c;
      idx[n++] = b;
      idx[n++] = b;
      idx[n++] = c;
      idx[n++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mat = vcMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  bin.add(geo);
  bin.add(mat);
  return mesh;
}

/** Ashlar quay walls along both sides of the channel + stairs down to the docks. */
export function buildQuay(bin: Bin): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'quay';
  const r = rng(77);
  const geo = build([[roundedBox(1, 1, 1, 0.05, 1), S('#ffffff', 0.9)]]);
  const mat = vcMaterial();
  const ms: THREE.Matrix4[] = [];
  const cs: THREE.Color[] = [];
  const stone = [C('#9a9682'), C('#8a8a78'), C('#7d8570'), C('#a09a86'), C('#6f7a68')];
  for (const s of [-1, 1]) {
    for (let row = 0; row < 4; row++) {
      let z = -36 + (row % 2) * 0.55;
      while (z < 36) {
        const len = 1.0 + r() * 0.35;
        const zc = z + len / 2;
        const edge = quayEdge(zc);
        const hgt = 0.46;
        const y = 0.5 - hgt / 2 - row * hgt + 0.02;
        const th = 0.75;
        ms.push(mtx(s * (edge - th / 2 + 0.05), y, zc, 0, [th, hgt - 0.02, len - 0.04]));
        const c = stone[Math.floor(r() * stone.length)]!.clone();
        c.multiplyScalar(0.78 + r() * 0.3 - row * 0.05);
        if (row > 0 && r() < 0.5) c.lerp(C('#3b5a34'), 0.25 + r() * 0.35);
        cs.push(c);
        z += len;
      }
    }
    // coping stones on top
    let z = -36;
    while (z < 36) {
      const len = 1.15 + r() * 0.3;
      const zc = z + len / 2;
      const edge = quayEdge(zc);
      ms.push(mtx(s * (edge - 0.42), 0.56, zc, 0, [0.95, 0.14, len - 0.05]));
      cs.push(C('#b0aa92').multiplyScalar(0.8 + r() * 0.2));
      z += len;
    }
  }
  const quay = instanced(geo, mat, ms, cs, false);
  quay.name = 'quay-blocks';
  g.add(quay);
  bin.add(geo);
  bin.add(mat);

  // landing stairs (three steps) next to each dock
  const stairGeo = build([[roundedBox(1, 1, 1, 0.04, 1), S('#ffffff', 0.85)]]);
  const stairMat = vcMaterial();
  const sm: THREE.Matrix4[] = [];
  const sc: THREE.Color[] = [];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      sm.push(mtx(s * (5.62 - k * 0.0 + 0.05 + 0.0), 0.36 - k * 0.19, 0, 0, [0.55 - 0.0, 0.16, 2.9 - k * 0.0]));
      sc.push(C('#b8b29a').multiplyScalar(1 - k * 0.1));
    }
    // landing pillars with lanterns
    for (const z of [-1.7, 1.7]) {
      sm.push(mtx(s * 6.5, 0.9, z, 0, [0.42, 0.9, 0.42]));
      sc.push(C('#8f8b78'));
      sm.push(mtx(s * 6.5, 1.42, z, 0, [0.56, 0.16, 0.56]));
      sc.push(C('#b8b29a'));
    }
  }
  const stairs = instanced(stairGeo, stairMat, sm, sc, true);
  stairs.name = 'landing';
  g.add(stairs);
  bin.add(stairGeo);
  bin.add(stairMat);
  void ellipsoid;
  return g;
}
