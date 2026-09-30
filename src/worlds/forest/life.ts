import * as THREE from 'three/webgpu';
import { abs, color, hash, instanceIndex, mix, mx_fractal_noise_float, mx_noise_float, positionGeometry, positionLocal, positionWorld, sin, smoothstep, time, uv, vec3 } from 'three/tsl';
import { createParticles, lightShaft, rng } from '../../world/kit';
import { bake, cone, ellipsoid, merge, roundedBox } from '../../characters/geo';
import type { QuadrupedActor } from './quad';
import { createFox, createRabbit, createSquirrel, createStag } from './quad';
import { type BuildCtx, type Part, halo, makePools, matrixAt, paint, vcMaterial } from './common';
import { FALL_LIFT, FALL_Z } from './terrain';

type Geo = THREE.BufferGeometry;

function fallMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const v = uv();
  const n1 = mx_noise_float(vec3(v.x.mul(11), v.y.mul(2.2).add(time.mul(2.6)), time.mul(0.25)));
  const n2 = mx_noise_float(vec3(v.x.mul(23).add(4), v.y.mul(4.5).add(time.mul(4.1)), 3));
  const streak = smoothstep(-0.25, 0.65, n1.mul(0.7).add(n2.mul(0.4)));
  const edge = smoothstep(0.0, 0.14, v.x).mul(smoothstep(1.0, 0.86, v.x));
  const foamTop = smoothstep(0.86, 1.0, v.y);
  const foamBot = smoothstep(0.22, 0.0, v.y);
  m.colorNode = mix(color('#8fdad0'), color('#ffffff'), streak.mul(0.7).add(foamBot.mul(0.6)).add(foamTop.mul(0.3)).clamp(0, 1));
  m.opacityNode = edge.mul(streak.mul(0.55).add(0.32)).add(foamBot.mul(0.5)).clamp(0, 0.92);
  return m;
}

function mistMaterial(seed: number, strength: number): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.fog = false;
  const v = uv();
  const wp = positionWorld.xz;
  const n = mx_fractal_noise_float(vec3(wp.x.mul(0.11).add(time.mul(0.05)).add(seed), wp.y.mul(0.11).sub(time.mul(0.03)), time.mul(0.04)), 3, 2.0, 0.5, 1.0);
  const edge = smoothstep(0, 0.28, v.x).mul(smoothstep(1, 0.72, v.x)).mul(smoothstep(0, 0.22, v.y)).mul(smoothstep(1, 0.78, v.y));
  m.colorNode = color('#f4f1de');
  m.opacityNode = smoothstep(-0.15, 0.65, n).mul(edge).mul(strength);
  return m;
}

function birdGeometry(): Geo {
  const parts: Geo[] = [
    bake(ellipsoid(0.06, 0.055, 0.17, 10, 8), { color: '#f4ecdc', rough: 0.8 }),
    bake(ellipsoid(0.042, 0.042, 0.048, 8, 6), { color: '#f4ecdc', rough: 0.8 }, { p: [0, 0.03, 0.19] }),
    bake(cone(0.014, 0.05, 5), { color: '#f0a040', rough: 0.6 }, { p: [0, 0.028, 0.245], r: [Math.PI / 2, 0, 0] }),
    bake(roundedBox(0.1, 0.01, 0.16, 0.004), { color: '#5a5048', rough: 0.8 }, { p: [0, 0.0, -0.22] }),
  ];
  const wingGeo = new THREE.PlaneGeometry(0.85, 0.3, 6, 1);
  wingGeo.rotateX(-Math.PI / 2);
  const wp = wingGeo.getAttribute('position');
  for (let i = 0; i < wp.count; i++) {
    const x = wp.getX(i);
    const z = wp.getZ(i);
    wp.setZ(i, z * (1 - 0.55 * Math.abs(x) / 0.425) + 0.05 * (Math.abs(x) / 0.425));
  }
  wingGeo.computeVertexNormals();
  const wing = bake(wingGeo, { color: '#eee6d6', rough: 0.8 }, { p: [0, 0.03, 0] });
  paint(wing, (x, _y, _z, _nx, _ny, _nz, out) => {
    const k = Math.min(1, Math.abs(x) / 0.425);
    out.set('#f2eadb').lerp(new THREE.Color('#4a4038'), Math.max(0, k - 0.55) * 2);
  });
  parts.push(wing);
  return merge(parts);
}

function butterflyGeometry(): Geo {
  const parts: Geo[] = [bake(ellipsoid(0.008, 0.008, 0.05, 6, 4), { color: '#2a2320', rough: 0.8 })];
  for (const sx of [1, -1]) {
    const g = new THREE.PlaneGeometry(0.11, 0.12, 2, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(sx * 0.058, 0, 0);
    parts.push(bake(g, { color: '#ffffff', rough: 0.7 }));
  }
  return merge(parts);
}

interface RabbitAI {
  a: QuadrupedActor;
  home: THREE.Vector3;
  timer: number;
  hopsLeft: number;
  busy: boolean;
}

export function buildLife(c: BuildCtx, o: { boat: THREE.Object3D; groundAt: (x: number, z: number) => number }): Part {
  const { scene, quality: q, bin } = c;
  const group = new THREE.Group();
  group.name = 'life';
  scene.add(group);
  const R = rng(9001);

  // ── waterfalls ──
  const fallMat = bin.add(fallMaterial());
  const falls: Array<[number, number]> = [[-3.9, 2.8], [0.05, 3.6], [4.0, 2.8]];
  for (const [x, w] of falls) {
    const geo = bin.add(new THREE.PlaneGeometry(w, FALL_LIFT + 0.12, 1, 1));
    const m = new THREE.Mesh(geo, fallMat);
    m.position.set(x, (FALL_LIFT + 0.12) / 2 - 0.02, FALL_Z - 0.48);
    m.rotation.x = -0.14;
    m.renderOrder = 3;
    group.add(m);
    // foam pool at the foot
    const fg = bin.add(new THREE.PlaneGeometry(w + 0.8, 1.6, 1, 1));
    fg.rotateX(-Math.PI / 2);
    const fm = new THREE.Mesh(fg, bin.add(foamMaterial()));
    fm.position.set(x, 0.05, FALL_Z + 0.25);
    fm.renderOrder = 3;
    group.add(fm);
  }
  group.add(
    createParticles({ count: 70, min: [-5.6, 0.1, FALL_Z - 0.3], max: [5.6, 1.5, FALL_Z + 0.9], color: '#ffffff', color2: '#bfeee8', size: 0.34, motion: 'rise', speed: 0.9, opacity: 0.5, additive: false, quality: q }),
  );

  // ── mist drifting over the river ──
  const mistGeo = bin.add(new THREE.PlaneGeometry(17, 26, 1, 1));
  mistGeo.rotateX(-Math.PI / 2);
  const mistZ = [8, -6, -20, -32, 22, -44];
  mistZ.forEach((z, i) => {
    const m = new THREE.Mesh(mistGeo, bin.add(mistMaterial(i * 3.7, 0.5)));
    m.position.set(Math.sin(i * 2.1) * 1.4, 0.32 + (i % 3) * 0.16, z);
    m.rotation.y = i * 0.9;
    m.renderOrder = 6;
    group.add(m);
  });
  const fallMist = new THREE.Mesh(mistGeo, bin.add(mistMaterial(11, 0.6)));
  fallMist.position.set(0, FALL_LIFT * 0.7, FALL_Z + 3);
  fallMist.scale.set(0.8, 1, 0.5);
  fallMist.renderOrder = 6;
  group.add(fallMist);

  // ── sun rays through the canopy ──
  const shaftTargets: Array<[number, number, number, number]> = [
    [-9.5, 0.5, -11, 1.0], [9, 0.5, -15, 0.9], [-3.5, 0, -25, 1.2], [5.5, 0, -31, 1.1], [-17.5, 0.6, -14.5, 0.9], [-12, 0.5, 5, 0.8],
  ];
  const down = new THREE.Vector3(0, -1, 0);
  const toGround = c.sun.clone().negate();
  const shaftQuat = new THREE.Quaternion().setFromUnitVectors(down, toGround);
  const nShafts = q.level === 'low' ? 3 : shaftTargets.length;
  const shafts: THREE.Mesh[] = [];
  for (let i = 0; i < nShafts; i++) {
    const [x, y, z, s] = shaftTargets[i]!;
    const len = 26;
    const sh = lightShaft('#ffe1a6', len, 0.5 * s, 3.4 * s, 0.34);
    bin.add(sh.geometry);
    bin.add(sh.material as THREE.Material);
    sh.quaternion.copy(shaftQuat);
    sh.position.set(x, y, z).addScaledVector(c.sun, len * 0.98);
    sh.renderOrder = 5;
    group.add(sh);
    shafts.push(sh);
  }

  // ── drifting particles ──
  group.add(createParticles({ count: 90, min: [-20, 0.5, -34], max: [20, 4.8, 14], color: '#fff2a0', color2: '#b9ff8a', size: 0.24, motion: 'float', speed: 0.7, twinkle: 0.9, quality: q }));
  group.add(createParticles({ count: 130, min: [-15, 0.4, -32], max: [15, 9, 8], color: '#fff0cc', size: 0.075, motion: 'float', speed: 0.22, twinkle: 0.35, opacity: 0.75, quality: q }));
  group.add(createParticles({ count: 55, min: [-24, 0, -36], max: [24, 16, 14], color: '#e0a53a', color2: '#8fbf45', size: 0.22, motion: 'fall', speed: 0.7, wind: [0.7, 0.2], additive: false, opacity: 0.95, quality: q }));
  group.add(createParticles({ count: 40, min: [-4, 0.1, -3], max: [4, 0.9, 3], color: '#bffff0', size: 0.11, motion: 'rise', speed: 0.35, twinkle: 0.8, opacity: 0.8, quality: q }));

  // ── birds circling above the canopy ──
  const birdGeo = bin.add(birdGeometry());
  const birdMat = bin.add(vcMaterial({ side: THREE.DoubleSide }));
  birdMat.positionNode = positionLocal.add(vec3(0, sin(time.mul(12).add(hash(instanceIndex.toFloat()).mul(6.28))).mul(abs(positionGeometry.x)).mul(1.15), 0));
  const nBirds = q.level === 'low' ? 3 : 7;
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, nBirds);
  birds.frustumCulled = false;
  birds.castShadow = false;
  group.add(birds);
  const birdCfg = Array.from({ length: nBirds }, (_, i) => ({
    cx: (R() - 0.5) * 16,
    cz: -14 - R() * 20,
    r: 9 + R() * 9,
    h: 12 + R() * 8,
    w: (0.22 + R() * 0.18) * (i % 2 ? 1 : -1),
    p: R() * 6.28,
  }));

  // ── butterflies over the flower meadows ──
  const bfGeo = bin.add(butterflyGeometry());
  const bfMat = bin.add(vcMaterial({ side: THREE.DoubleSide }));
  bfMat.positionNode = positionLocal.add(vec3(0, sin(time.mul(22).add(hash(instanceIndex.toFloat()).mul(6.28))).mul(abs(positionGeometry.x)).mul(2.6), 0));
  const bfHome: Array<[number, number]> = [[-13, 3], [12.5, -5], [-9, -12], [10, 8], [-16, -8], [16, -1]];
  const nBf = Math.max(4, Math.round(10 * Math.min(1, q.particles + 0.3)));
  const butterflies = new THREE.InstancedMesh(bfGeo, bfMat, nBf);
  butterflies.frustumCulled = false;
  const bfCols = ['#ffd45a', '#ff9ac0', '#9ad0ff', '#ffffff', '#ffb070'];
  for (let i = 0; i < nBf; i++) butterflies.setColorAt(i, new THREE.Color(bfCols[i % bfCols.length]!));
  group.add(butterflies);

  // ── creatures ──
  const npcs: QuadrupedActor[] = [];
  const addNpc = (a: QuadrupedActor, x: number, z: number, yOff = 0, faceX = 0, faceZ = 0, small = false): QuadrupedActor => {
    a.pickProxy.removeFromParent();
    delete a.pickProxy.userData.pick;
    a.groundAt = o.groundAt;
    a.root.position.set(x, o.groundAt(x, z) + yOff, z);
    scene.add(a.root);
    a.faceTowards(new THREE.Vector3(faceX, 0, faceZ));
    a.snapYaw();
    if (small) a.root.traverse((m) => ((m as THREE.Mesh).castShadow = false));
    npcs.push(a);
    return a;
  };
  // resting fox
  const fox = addNpc(createFox(), -17.6, -3.6, 0, 0, 2);
  fox.mood = 'sit';
  fox.allowYawn = true;
  // ancient stag spirit, watching the boat from the misty rise
  const stag = addNpc(createStag(), -19.5, -16.5, 0, 0, 0);
  stag.groundAt = o.groundAt;
  const stagGlow = halo('#8dffd6', 5.5, 0.28);
  stagGlow.position.set(-19.5, o.groundAt(-19.5, -16.5) + 2.2, -16.5);
  group.add(stagGlow);
  // squirrel on the fallen log
  const sqx = -13.4 + Math.cos(0.4) * 0.9;
  const sqz = -5.4 - Math.sin(0.4) * 0.9;
  const squirrel = addNpc(createSquirrel(), sqx, sqz, 0.42 * 0.75 + 0.42, -8, -3, true);
  squirrel.mood = 'sit';
  // hopping rabbits
  const rabbits: RabbitAI[] = [];
  const rHomes: Array<[number, number]> = [[-16, 7.5], [15.5, -9.5], [-11, -12.5]];
  rHomes.forEach(([x, z], i) => {
    const r = addNpc(createRabbit(`rabbit${i}`, i * 0.4), x, z, 0, 0, 0, true);
    rabbits.push({ a: r, home: new THREE.Vector3(x, 0, z), timer: 1 + R() * 3, hopsLeft: 0, busy: false });
  });

  // pools of faint glow under the spirit stag
  group.add(makePools([{ x: -19.5, y: o.groundAt(-19.5, -16.5) + 0.06, z: -16.5, r: 3.2, color: '#6fffd0', a: 0.35 }]));

  const tmpV = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  let stagTimer = 0;

  return {
    update(dt, t): void {
      // birds
      for (let i = 0; i < nBirds; i++) {
        const b = birdCfg[i]!;
        const th = b.p + t * b.w;
        const dir = Math.sign(b.w);
        const x = b.cx + Math.cos(th) * b.r;
        const z = b.cz + Math.sin(th) * b.r;
        const y = b.h + Math.sin(t * 0.7 + i) * 1.2;
        const hx = -Math.sin(th) * dir;
        const hz = Math.cos(th) * dir;
        tmpM.copy(matrixAt(x, y, z, Math.atan2(hx, hz), 2.3, Math.sin(t * 0.6 + i) * 0.06, -dir * 0.32));
        birds.setMatrixAt(i, tmpM);
      }
      birds.instanceMatrix.needsUpdate = true;
      // butterflies
      for (let i = 0; i < nBf; i++) {
        const hm = bfHome[i % bfHome.length]!;
        const ph = i * 1.9;
        const x = hm[0] + Math.sin(t * 0.45 + ph) * 2.6 + Math.sin(t * 1.1 + ph * 2) * 0.6;
        const z = hm[1] + Math.cos(t * 0.38 + ph) * 2.6;
        const y = o.groundAt(x, z) + 0.9 + Math.sin(t * 0.9 + ph) * 0.5 + Math.sin(t * 2.7 + ph) * 0.12;
        const hx = Math.cos(t * 0.45 + ph) * 2.6 * 0.45;
        const hz = -Math.sin(t * 0.38 + ph) * 2.6 * 0.38;
        tmpM.copy(matrixAt(x, y, z, Math.atan2(hx, hz), 1.4, 0, Math.sin(t * 1.3 + ph) * 0.3));
        butterflies.setMatrixAt(i, tmpM);
      }
      butterflies.instanceMatrix.needsUpdate = true;
      // creatures
      for (const n of npcs) n.update(dt);
      // fox notices the boat
      const bp = o.boat.getWorldPosition(tmpV);
      fox.lookTarget = bp.distanceTo(fox.root.position) < 22 ? bp : null;
      // stag follows the boat with its gaze
      stag.lookTarget = bp;
      stagTimer -= dt;
      if (stagTimer <= 0) {
        stagTimer = 2.2;
        stag.faceTowards(bp);
      }
      // rabbits: nibble, then a few hops around home
      for (const rb of rabbits) {
        if (rb.a.isBusy) continue;
        rb.timer -= dt;
        if (rb.timer > 0) continue;
        if (rb.hopsLeft <= 0) {
          rb.hopsLeft = 2 + Math.floor(R() * 3);
          rb.timer = 2 + R() * 4;
          if (R() < 0.5) {
            rb.timer = 0.01;
          } else continue;
        }
        const ang = R() * 6.28;
        const rad = 0.6 + R() * 0.9;
        let tx = rb.a.root.position.x + Math.cos(ang) * rad;
        let tz = rb.a.root.position.z + Math.sin(ang) * rad;
        const dx = tx - rb.home.x;
        const dz = tz - rb.home.z;
        if (Math.hypot(dx, dz) > 3.2) {
          tx = rb.home.x + dx * 0.4;
          tz = rb.home.z + dz * 0.4;
        }
        rb.hopsLeft--;
        rb.timer = 0.12;
        void rb.a.hopTo(tmpV.set(tx, o.groundAt(tx, tz), tz), 0.2, 0.34);
        if (rb.hopsLeft <= 0) rb.timer = 3 + R() * 5;
      }
      for (let i = 0; i < shafts.length; i++) shafts[i]!.scale.x = shafts[i]!.scale.z = 1 + Math.sin(t * 0.3 + i * 1.7) * 0.05;
      stagGlow.scale.setScalar(5.5 * (0.92 + 0.08 * Math.sin(t * 0.9)));
    },
  };
}

function foamMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const v = uv();
  const wp = positionWorld.xz;
  const n = mx_noise_float(vec3(wp.x.mul(2.4), wp.y.mul(2.4).sub(time.mul(1.4)), time.mul(0.4)));
  const ring = smoothstep(0.0, 0.3, v.x).mul(smoothstep(1.0, 0.7, v.x)).mul(smoothstep(0.0, 0.25, v.y)).mul(smoothstep(1.0, 0.4, v.y));
  m.colorNode = color('#ffffff');
  m.opacityNode = smoothstep(-0.2, 0.5, n).mul(ring).mul(0.85);
  return m;
}
