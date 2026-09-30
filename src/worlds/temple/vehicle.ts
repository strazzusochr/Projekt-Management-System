import * as THREE from 'three/webgpu';
import type { VehicleRig } from '../../world/types';
import type { QualityPreset } from '../../render/quality';
import { bake, cone, cyl, ellipsoid, lathe, merge, torus } from '../../characters/geo';
import { Bin, flameGeometry, flameMaterial, glowVc, vcMaterial, type Geo, rbox } from './util';

const L = 1.5; // half length
const W = 0.98; // half width
const D = 0.52; // depth below rim line

function rimY(u: number): number {
  return 0.34 + 0.55 * Math.pow(Math.abs(u), 2.4);
}

/** Point on the hull surface for u in -1..1 along the keel and phi in -pi/2..pi/2 across. */
function hullPoint(u: number, phi: number, out = new THREE.Vector3()): THREE.Vector3 {
  const taper = Math.pow(Math.max(0.0001, 1 - u * u), 0.5);
  const halfW = W * taper;
  const rim = rimY(u);
  out.set(halfW * Math.sin(phi), rim - D * Math.pow(taper, 0.6) * Math.cos(phi), u * L);
  return out;
}

function hullGeometry(): Geo {
  const nu = 34;
  const nv = 14;
  const pos: number[] = [];
  const col: number[] = [];
  const pbr: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const wood = new THREE.Color('#5c3a22');
  const wood2 = new THREE.Color('#7a4c2a');
  const stone = new THREE.Color('#9a9482');
  const gold = new THREE.Color('#d6a640');
  const c = new THREE.Color();
  for (let i = 0; i <= nu; i++) {
    const u = -1 + (2 * i) / nu;
    for (let j = 0; j <= nv; j++) {
      const phi = -Math.PI / 2 + (Math.PI * j) / nv;
      hullPoint(u, phi, v);
      pos.push(v.x, v.y, v.z);
      const depth = (rimY(u) - v.y) / D; // 0 at rim → 1 at keel
      const plank = Math.floor((phi + Math.PI / 2) * 5.2) % 2;
      c.copy(plank ? wood : wood2);
      if (depth < 0.46) c.copy(stone).multiplyScalar(0.85 + 0.15 * Math.sin(u * 22));
      if (depth < 0.1) c.copy(gold);
      col.push(c.r, c.g, c.b);
      pbr.push(depth < 0.1 ? 0.3 : depth < 0.46 ? 0.85 : 0.65, depth < 0.1 ? 0.85 : 0, 0);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = a + 1;
      const cc = a + nv + 1;
      const d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPbr', new THREE.Float32BufferAttribute(pbr, 3));
  g.setIndex(idx);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

function petalFan(z: number, dir: number): Geo[] {
  const parts: Geo[] = [];
  const base = rimY(dir) + 0.02;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = ((i - (n - 1) / 2) / ((n - 1) / 2)) * 1.05; // fan angle around Z axis
    const len = 0.72 - Math.abs(a) * 0.16;
    const petal = new THREE.SphereGeometry(1, 12, 10);
    petal.scale(0.1, len * 0.5, 0.03);
    petal.translate(0, len * 0.5, 0);
    const b = bake(petal, { color: '#f7dbe8', rough: 0.45, emit: 0.45 }, { p: [0, base, z], r: [dir * 0.55, 0, -a] });
    // gradient white → magenta tip
    const p = b.getAttribute('position');
    const cl = b.getAttribute('color') as THREE.BufferAttribute;
    const tip = new THREE.Color('#e04a8c');
    const bas = new THREE.Color('#fff2f6');
    const c = new THREE.Color();
    for (let k = 0; k < p.count; k++) {
      const t = Math.min(1, Math.max(0, (p.getY(k) - base) / (len * 0.95)));
      c.copy(bas).lerp(tip, t * t);
      cl.setXYZ(k, c.r, c.g, c.b);
    }
    parts.push(b);
  }
  // inner glowing bud
  parts.push(bake(new THREE.SphereGeometry(0.075, 10, 8), { color: '#ffd27a', rough: 0.3, emit: 2.4 }, { p: [0, base + 0.16, z + dir * 0.03] }));
  return parts;
}

export interface Barge {
  rig: VehicleRig;
  dispose(): void;
}

export function createBarge(quality: QualityPreset, waterY: number): Barge {
  const bin = new Bin();
  const root = new THREE.Group();
  root.name = 'lotosbarke';
  const hull = new THREE.Group();
  root.add(hull);

  const solidMat = bin.add(vcMaterial());
  // hull + deck + rails + cushions + petals + braziers, merged into a handful of meshes
  const parts: Geo[] = [];
  parts.push(hullGeometry());
  // deck planks
  for (let i = 0; i < 9; i++) {
    const z = -1.32 + i * 0.33;
    const taper = Math.pow(Math.max(0.05, 1 - (z / L) ** 2), 0.5);
    parts.push(bake(rbox(W * 1.78 * taper, 0.05, 0.31, 0.012, 1), { color: i % 2 ? '#8b6238' : '#7a5230', rough: 0.7 }, { p: [0, 0.14, z] }));
  }
  // ribs + gunwale posts with gold caps
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const u = -0.78 + i * 0.26;
      const z = u * L;
      const p = hullPoint(u, s * Math.PI / 2);
      parts.push(bake(rbox(0.09, 0.12, 0.16, 0.02, 1), { color: '#c99a3c', rough: 0.35, metal: 0.8 }, { p: [p.x, p.y + 0.06, z] }));
      // glowing glyph plate
      const q = hullPoint(u, s * 1.0);
      parts.push(bake(rbox(0.03, 0.09, 0.15, 0.01, 1), { color: '#5ff2e0', rough: 0.2, emit: 2.6 }, { p: [q.x + s * 0.005, q.y - 0.02, z], r: [0, 0, s * 0.35] }));
    }
  }
  // lotus prows on both ends
  for (const dir of [1, -1]) {
    parts.push(...petalFan(dir * (L - 0.06), dir));
    // carved stone end post with gold ring
    parts.push(bake(cyl(0.07, 0.09, 0.38, 10), { color: '#8f8a78', rough: 0.85 }, { p: [0, rimY(dir) + 0.19, dir * (L - 0.24)] }));
    parts.push(bake(torus(0.085, 0.018, Math.PI * 2, 14, 6), { color: '#d6a640', rough: 0.3, metal: 0.9 }, { p: [0, rimY(dir) + 0.36, dir * (L - 0.24)], r: [Math.PI / 2, 0, 0] }));
  }
  // seat cushions (seat anchors sit on top of these)
  const seatZ = [-0.66, 0.66];
  for (const z of seatZ) {
    parts.push(bake(cyl(0.3, 0.32, 0.1, 16), { color: '#a02a4a', rough: 0.8 }, { p: [0, 0.22, z] }));
    parts.push(bake(torus(0.31, 0.02, Math.PI * 2, 18, 6), { color: '#d6a640', rough: 0.3, metal: 0.9 }, { p: [0, 0.26, z], r: [Math.PI / 2, 0, 0] }));
    parts.push(bake(cyl(0.26, 0.3, 0.06, 16), { color: '#7a5230', rough: 0.7 }, { p: [0, 0.17, z] }));
  }
  // central brazier: bronze bowl on stone tripod
  parts.push(bake(lathe([[0.02, 0], [0.17, 0.05], [0.2, 0.14], [0.16, 0.2], [0.02, 0.22]], 16, 12), { color: '#a87432', rough: 0.35, metal: 0.85 }, { p: [0, 0.3, 0] }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    parts.push(bake(cyl(0.02, 0.03, 0.22, 6), { color: '#6a5a44', rough: 0.8 }, { p: [Math.sin(a) * 0.1, 0.24, Math.cos(a) * 0.1], r: [Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25] }));
  }
  parts.push(bake(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), { color: '#ff7a20', rough: 0.4, emit: 2.2 }, { p: [0, 0.48, 0], s: [1, 0.55, 1] }));
  const hullMesh = new THREE.Mesh(merge(parts), solidMat);
  hullMesh.name = 'hull';
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  hull.add(hullMesh);
  bin.add(hullMesh.geometry);

  // flame over the brazier
  const flame = flameMaterial('#fff0b0', '#ff5a10', 3.0);
  const fg = flameGeometry(0.34, 0.5);
  const fm = new THREE.Mesh(fg, flame.material);
  fm.position.set(0, 0.5, 0);
  fm.frustumCulled = false;
  fm.renderOrder = 5;
  hull.add(fm);
  bin.add(fg);
  bin.add(flame.material);

  // petal lamps (occupancy indicators): two glowing lotus buds on gold poles at the rim
  const lampGeo = (() => {
    const p: Geo[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const petal = new THREE.SphereGeometry(1, 10, 8);
      petal.scale(0.045, 0.11, 0.025);
      petal.translate(0, 0.11, 0);
      p.push(bake(petal, { color: '#ffffff', rough: 0.3 }, { p: [Math.sin(a) * 0.035, 0.0, Math.cos(a) * 0.035], r: [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45] }));
    }
    p.push(bake(new THREE.SphereGeometry(0.04, 8, 6), { color: '#ffffff', rough: 0.3 }, { p: [0, 0.1, 0] }));
    return merge(p);
  })();
  bin.add(lampGeo);
  const lamps: Array<{ mat: ReturnType<typeof glowVc>; k: number; goal: number }> = [];
  const poleGeo = merge([bake(cyl(0.012, 0.016, 0.42, 6), { color: '#d6a640', rough: 0.3, metal: 0.9 }, { p: [0, 0.21, 0] })]);
  bin.add(poleGeo);
  const poleMat = bin.add(vcMaterial());
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    const gm = glowVc(0.3, { tint: i === 0 ? '#ff8ad0' : '#8affea' });
    const p = hullPoint(0.0, s * Math.PI / 2);
    const g = new THREE.Group();
    g.position.set(p.x * 0.98, p.y + 0.02, i === 0 ? -0.12 : 0.12);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    g.add(pole);
    const bud = new THREE.Mesh(lampGeo, gm.material);
    bud.position.y = 0.42;
    g.add(bud);
    hull.add(g);
    bin.add(gm.material);
    lamps.push({ mat: gm, k: 0.3, goal: 0.3 });
  }

  // seats
  const seats: THREE.Object3D[] = [];
  seatZ.forEach((z, i) => {
    const s = new THREE.Object3D();
    s.name = `seat${i}`;
    s.position.set(0, 0.27, z);
    s.rotation.y = i === 0 ? 0 : Math.PI;
    root.add(s);
    seats.push(s);
  });

  // pick proxy
  const proxyGeo = new THREE.BoxGeometry(2.3, 1.3, 3.7);
  const proxyMat = new THREE.MeshBasicNodeMaterial({ visible: false });
  const pickProxy = new THREE.Mesh(proxyGeo, proxyMat);
  pickProxy.position.y = 0.45;
  pickProxy.name = 'pick:vehicle';
  pickProxy.userData.pick = { kind: 'vehicle', id: 'vehicle' };
  root.add(pickProxy);
  bin.add(proxyGeo);
  bin.add(proxyMat);

  // brazier light
  let light: THREE.PointLight | null = null;
  if (quality.localLights > 0) {
    light = new THREE.PointLight(0xff8a3a, 5, 8, 2);
    light.position.set(0, 0.9, 0);
    hull.add(light);
  }

  const seatBase = seats.map((s) => s.position.y);
  let glow = 0;
  const yawBoth = Math.PI / 2;

  const rig: VehicleRig = {
    root,
    seats,
    docks: [new THREE.Vector3(-4.2, waterY, 0), new THREE.Vector3(4.2, waterY, 0)],
    yaw: [yawBoth, yawBoth],
    pickProxy,
    crossingTime: 3.4,
    update(dt: number, t: number, moving: number): void {
      glow += (moving - glow) * (1 - Math.exp(-dt * 3));
      const bob = Math.sin(t * 1.5) * 0.028 + Math.sin(t * 2.3 + 1.0) * 0.012 + moving * Math.sin(t * 5.1) * 0.012;
      hull.position.y = bob;
      hull.rotation.z = Math.sin(t * 1.1) * 0.012 + moving * Math.sin(t * 3.7) * 0.012;
      hull.rotation.x = Math.sin(t * 0.9 + 0.5) * 0.008 + moving * 0.012;
      seats.forEach((s, i) => (s.position.y = seatBase[i]! + bob));
      flame.k.value = 2.6 + glow * 1.4 + Math.sin(t * 17) * 0.2;
      fm.scale.setScalar(1 + glow * 0.35);
      if (light) light.intensity = 4.5 + glow * 3 + Math.sin(t * 13) * 0.6 + Math.sin(t * 7.3) * 0.4;
      for (let i = 0; i < lamps.length; i++) {
        const l = lamps[i]!;
        l.k += (l.goal - l.k) * (1 - Math.exp(-dt * 5));
        l.mat.k.value = l.k + Math.sin(t * 2 + i) * 0.1 * l.k;
      }
    },
    setIndicator(info): void {
      lamps.forEach((l, i) => {
        l.goal = i < info.count ? 4.2 : 0.35;
      });
    },
  };
  void cone;
  void ellipsoid;
  return {
    rig,
    dispose() {
      root.removeFromParent();
      bin.dispose();
    },
  };
}
