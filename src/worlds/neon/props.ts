import * as THREE from 'three/webgpu';
import { abs, color, float, fract, hash, mix, normalWorld, positionLocal, positionWorld, pow, sin, smoothstep, step, time, uv, vec3, floor, cameraPosition, normalize, dot } from 'three/tsl';
import { createParticles, glowMat, lightShaft, mat, rng } from '../../world/kit';
import { boxG, cylG, instancedFrom, mergeG, mtx, QUAY_Y, CANAL_HALF, signTexture, sphG, torG, xf, type Env } from './env';

/** Railings, lamp posts, crates, cones, kiosks, machines (fans, crane, servers), steam, cables, dispatcher hologram, searchlights. */
export function buildProps(env: Env): void {
  const { root, q, updaters } = env;
  const R = rng(777);
  const steel = mat('#2b3444', 0.42, 0.85);
  const darkSteel = mat('#171d28', 0.5, 0.8);

  // ───────── railings along both quays (gap at the docks) ─────────
  {
    const posts: THREE.Matrix4[] = [];
    const railGeos: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const x = s * (CANAL_HALF + 0.42);
      for (let z = -70; z <= 70; z += 1.75) {
        if (Math.abs(z) < 3.0) continue;
        posts.push(mtx([x, QUAY_Y + 0.5, z]));
      }
      for (const [z0, z1] of [
        [-70, -3.0],
        [3.0, 70],
      ] as Array<[number, number]>) {
        railGeos.push(boxG(0.05, 0.05, z1 - z0, [x, QUAY_Y + 1.0, (z0 + z1) / 2]), boxG(0.035, 0.035, z1 - z0, [x, QUAY_Y + 0.55, (z0 + z1) / 2]));
      }
    }
    root.add(instancedFrom(boxG(0.07, 1.0, 0.07), steel, posts));
    const rails = new THREE.Mesh(mergeG(railGeos), steel);
    root.add(rails);
    // glowing top edge (thin)
    const glowGeos: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) for (const [z0, z1] of [[-70, -3.0], [3.0, 70]] as Array<[number, number]>) glowGeos.push(boxG(0.02, 0.02, z1 - z0, [s * (CANAL_HALF + 0.42) + s * 0.03, QUAY_Y + 1.03, (z0 + z1) / 2]));
    const gm = new THREE.MeshBasicNodeMaterial();
    gm.colorNode = mix(color('#19d9ff'), color('#ff2fd0'), step(0.0, sin(positionWorld.z.mul(0.09)))).mul(1.8);
    root.add(new THREE.Mesh(mergeG(glowGeos), gm));
  }

  // ───────── lamp posts with light cones + ground pools ─────────
  {
    const poles: THREE.Matrix4[] = [];
    const heads: THREE.Matrix4[] = [];
    const headCols: THREE.Color[] = [];
    const cones: THREE.Matrix4[] = [];
    const pools: THREE.Matrix4[] = [];
    const cc = [new THREE.Color('#ffd9a8'), new THREE.Color('#ff7ad8'), new THREE.Color('#8fe8ff')];
    let n = 0;
    for (const s of [-1, 1]) {
      for (let z = -62; z <= 62; z += 10.5) {
        const x = s * 11.2;
        const c = cc[n % 3]!;
        poles.push(mtx([x, QUAY_Y + 3.4, z], [0, 0, 0], [1, 1, 1]));
        // arm toward the canal
        heads.push(mtx([x - s * 0.9, QUAY_Y + 6.6, z]));
        headCols.push(c);
        cones.push(mtx([x - s * 0.9, QUAY_Y + 6.5, z]));
        pools.push(mtx([x - s * 0.9, QUAY_Y + 0.03, z], [-Math.PI / 2, 0, 0]));
        n++;
      }
    }
    const poleGeo = mergeG([cylG(0.09, 0.14, 6.8, 8), boxG(1.0, 0.09, 0.09, [-0.45, 3.25, 0]), cylG(0.22, 0.22, 0.12, 8, [0, -3.3, 0])]);
    // arm direction differs per side → mirror by using two meshes
    const poleGeoR = mergeG([cylG(0.09, 0.14, 6.8, 8), boxG(1.0, 0.09, 0.09, [0.45, 3.25, 0]), cylG(0.22, 0.22, 0.12, 8, [0, -3.3, 0])]);
    const polesL = poles.filter((_, i) => i < poles.length / 2);
    const polesR = poles.filter((_, i) => i >= poles.length / 2);
    root.add(instancedFrom(poleGeoR, steel, polesL));
    root.add(instancedFrom(poleGeo, steel, polesR));
    const headMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3.2, 3.2, 3.2) });
    root.add(instancedFrom(boxG(0.5, 0.1, 0.22), headMat, heads, headCols));
    // light cones (additive) & pools
    const coneGeo = new THREE.CylinderGeometry(0.15, 2.2, 6.4, 20, 1, true);
    coneGeo.translate(0, -3.2, 0);
    const coneMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    coneMat.fog = false;
    {
      const vd = normalize(cameraPosition.sub(positionWorld));
      const facing = pow(abs(dot(normalize(normalWorld), vd)), 2.0);
      coneMat.colorNode = vec3(1.0, 0.85, 0.7).mul(0.9);
      coneMat.opacityNode = smoothstep(0.0, 0.5, uv().y).mul(facing).mul(0.075);
    }
    const coneMesh = instancedFrom(coneGeo, coneMat, cones, headCols);
    root.add(coneMesh);
    const poolMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    poolMat.colorNode = vec3(1.0, 0.85, 0.7);
    poolMat.opacityNode = smoothstep(0.5, 0.0, uv().sub(0.5).length()).pow(1.6).mul(0.28);
    root.add(instancedFrom(new THREE.PlaneGeometry(6.5, 6.5), poolMat, pools, headCols));
  }

  // ───────── crates, barrels, cones ─────────
  {
    const crateMats: THREE.Matrix4[] = [];
    const crateCols: THREE.Color[] = [];
    const pal = ['#1c2c3c', '#3a1c22', '#1f3526', '#3a2c12', '#241c3c', '#17252d'].map((c) => new THREE.Color(c));
    const stack = (cx: number, cz: number, rows: number, cols: number, layers: number, rot = 0): void => {
      for (let l = 0; l < layers; l++)
        for (let r = 0; r < rows - l; r++)
          for (let c = 0; c < cols; c++) {
            const w = 1.2 + R() * 0.4;
            const x = cx + (c - cols / 2) * 1.45 * Math.cos(rot) - (r - rows / 2) * 1.3 * Math.sin(rot);
            const z = cz + (c - cols / 2) * 1.45 * Math.sin(rot) + (r - rows / 2) * 1.3 * Math.cos(rot);
            crateMats.push(mtx([x + (R() - 0.5) * 0.1, QUAY_Y + 0.55 + l * 1.1, z], [0, rot + (R() - 0.5) * 0.15, 0], [w, 1.1, 1.2]));
            crateCols.push(pal[Math.floor(R() * pal.length)]!);
          }
    };
    stack(-12.2, 8.5, 3, 3, 2, 0.2);
    stack(-11.2, 13, 2, 3, 2, -0.1);
    stack(11.4, -9.5, 3, 3, 3, -0.2);
    stack(12.6, -14.5, 2, 3, 2, 0.15);
    stack(-13, -13, 3, 2, 2, 0.1);
    stack(10, 10, 2, 2, 1, 0.4);
    const crates = instancedFrom(boxG(1, 1, 1), mat('#ffffff', 0.62, 0.25), crateMats, crateCols);
    crates.castShadow = true;
    root.add(crates);
    // crate edge frames (emissive stripes) – thin glowing bands
    const bandMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2, 2, 2) });
    const bandMats = crateMats.filter((_, i) => i % 3 === 0).map((m) => {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const q2 = new THREE.Quaternion().setFromRotationMatrix(m);
      const s2 = new THREE.Vector3().setFromMatrixScale(m);
      return new THREE.Matrix4().compose(p.add(new THREE.Vector3(0, 0.3, 0)), q2, new THREE.Vector3(s2.x * 1.02, 0.06, s2.z * 1.02));
    });
    root.add(instancedFrom(boxG(1, 1, 1), bandMat, bandMats, [new THREE.Color('#ffb020'), new THREE.Color('#19d9ff'), new THREE.Color('#ff2fd0')]));
    // barrels
    const barrelMats: THREE.Matrix4[] = [];
    for (let i = 0; i < 9; i++) barrelMats.push(mtx([-9.6 + (i % 3) * 0.75, QUAY_Y + 0.5, 12.5 + Math.floor(i / 3) * 0.75]));
    for (let i = 0; i < 6; i++) barrelMats.push(mtx([9.4 + (i % 3) * 0.75, QUAY_Y + 0.5, -4.6 - Math.floor(i / 3) * 0.75]));
    const barrelGeo = mergeG([cylG(0.32, 0.32, 1.0, 14), torG(0.325, 0.03, 16, 5, [0, 0.25, 0], [Math.PI / 2, 0, 0]), torG(0.325, 0.03, 16, 5, [0, -0.25, 0], [Math.PI / 2, 0, 0])]);
    root.add(instancedFrom(barrelGeo, mat('#1c3f52', 0.5, 0.6), barrelMats));
    // traffic cones
    const coneMats: THREE.Matrix4[] = [];
    const conePos: Array<[number, number]> = [
      [-7.6, 2.9],
      [-7.6, -2.9],
      [7.6, 2.9],
      [7.6, -2.9],
      [-8.4, 3.4],
      [8.4, -3.4],
      [-10.2, 6.5],
      [10.6, 6.0],
      [-9.6, -6.6],
      [9.9, -8.2],
      [-7.2, 7.4],
      [7.2, -7.4],
    ];
    for (const [x, z] of conePos) coneMats.push(mtx([x, QUAY_Y + 0.3, z], [0, R() * 6, 0]));
    const coneG = mergeG([cylG(0.03, 0.2, 0.6, 12), boxG(0.5, 0.05, 0.5, [0, -0.3, 0])]);
    const coneBodyMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.0 });
    {
      const yy = positionLocal.y;
      const stripe = step(0.0, sin(yy.mul(26))).mul(step(-0.2, yy)).mul(step(yy, 0.2));
      coneBodyMat.colorNode = mix(color('#ff5a10'), color('#f0f0f0'), stripe);
      coneBodyMat.emissiveNode = mix(color('#ff5a10'), color('#f0f0f0'), stripe).mul(0.12);
    }
    root.add(instancedFrom(coneG, coneBodyMat, coneMats));
  }

  // ───────── kiosks / vending machines ─────────
  {
    const vendBody = mat('#1a2030', 0.35, 0.7);
    const vend = (x: number, z: number, rotY: number, text: string, col: string): void => {
      const g = new THREE.Group();
      g.position.set(x, QUAY_Y, z);
      g.rotation.y = rotY;
      g.add(new THREE.Mesh(mergeG([boxG(1.1, 2.1, 0.85, [0, 1.05, 0]), boxG(1.15, 0.08, 0.9, [0, 2.12, 0])]), vendBody));
      const tex = signTexture({ text, sub: 'GETRÄNKE · SNACKS', color: col, w: 256, h: 512, font: '900 64px Arial', bg: '#06090f', border: true });
      const fm = new THREE.MeshBasicNodeMaterial({ map: tex, color: new THREE.Color(1.8, 1.8, 1.8) });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.7), fm);
      face.position.set(0, 1.2, 0.43);
      g.add(face);
      // product grid glow
      const grid = new THREE.MeshBasicNodeMaterial();
      {
        const u = uv();
        const cell = floor(u.mul(vec3(4, 6, 1).xy));
        const h = hash(cell.x.add(cell.y.mul(7)).add(x * 3.7));
        const gl = step(0.12, fract(u.x.mul(4))).mul(step(0.12, fract(u.y.mul(6))));
        grid.colorNode = mix(vec3(1.0, 0.3, 0.6), vec3(0.2, 0.9, 1.0), h).mul(gl.mul(0.9).add(0.1)).mul(1.4);
      }
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.9), grid);
      gp.position.set(0, 1.35, 0.436);
      g.add(gp);
      const glowBar = new THREE.Mesh(boxG(0.9, 0.05, 0.05, [0, 0.16, 0.44]), glowMat(col, 2.4));
      g.add(glowBar);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      root.add(g);
    };
    vend(-10.6, -4.7, Math.PI / 2, 'DRINK', '#ff2fd0');
    vend(-10.6, -6.0, Math.PI / 2, 'SNACK', '#19d9ff');
    vend(10.6, 3.4, -Math.PI / 2, 'KAFFEE', '#ffb020');
    env.addLight('#ff7ad8', 10, 8, -9.2, QUAY_Y + 1.6, -5.2);

    // ramen stand on side 1
    const stand = new THREE.Group();
    stand.position.set(10.3, QUAY_Y, -1.6);
    stand.rotation.y = -Math.PI / 2;
    stand.add(new THREE.Mesh(boxG(3.0, 1.0, 1.0, [0, 0.5, 0]), mat('#20263a', 0.5, 0.6)));
    stand.add(new THREE.Mesh(boxG(3.4, 0.12, 1.5, [0, 2.6, 0.1], [0.12, 0, 0]), mat('#3a1830', 0.6, 0.3)));
    for (const sx of [-1.5, 1.5]) stand.add(new THREE.Mesh(cylG(0.05, 0.05, 2.6, 6, [sx, 1.3, 0.75]), steel));
    const rtex = signTexture({ text: 'RAMEN', sub: 'HEISS · SCHNELL', color: '#ff7a1e', w: 512, h: 180, border: true });
    const rm = new THREE.MeshBasicNodeMaterial({ map: rtex, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true });
    const rface = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), rm);
    rface.position.set(0, 2.15, 0.72);
    rface.rotation.x = 0.12;
    stand.add(rface);
    // lanterns
    const lan = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.4, 2.4, 2.4) }), 5);
    for (let i = 0; i < 5; i++) {
      lan.setMatrixAt(i, mtx([-1.4 + i * 0.7, 2.35, 0.85], [0, 0, 0], [1, 1.25, 1]));
      lan.setColorAt(i, new THREE.Color(i % 2 ? '#ff5a3a' : '#ffb040'));
    }
    lan.frustumCulled = false;
    stand.add(lan);
    // pot glow
    stand.add(new THREE.Mesh(cylG(0.32, 0.28, 0.35, 14, [-0.6, 1.15, 0]), mat('#3a3f4c', 0.3, 0.9)));
    stand.add(new THREE.Mesh(cylG(0.29, 0.29, 0.02, 14, [-0.6, 1.32, 0]), glowMat('#ff9a3a', 1.6)));
    root.add(stand);
    env.addLight('#ff9a3a', 14, 9, 9.2, QUAY_Y + 2.0, -1.6);
    const steamR = createParticles({ count: 70, min: [9.5, QUAY_Y + 1.4, -2.4], max: [10.1, QUAY_Y + 4.4, -1.6], color: '#d0d8f0', size: 0.9, motion: 'rise', speed: 0.55, wind: [-0.2, 0.1], additive: false, opacity: 0.16, quality: q });
    root.add(steamR);
  }

  // ───────── server rack hut (side 0) ─────────
  {
    const hut = new THREE.Group();
    hut.position.set(-12.6, QUAY_Y, -9.5);
    hut.rotation.y = Math.PI / 2;
    const rackMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.7 });
    {
      const u = uv();
      const cell = floor(u.mul(vec3(6, 26, 1).xy));
      const h = hash(cell.x.add(cell.y.mul(13.0)).add(3.0));
      const t = floor(time.mul(h.mul(3.0).add(0.5)).add(h.mul(20.0)));
      const on = step(0.55, hash(t.add(cell.x.mul(3.0)).add(cell.y.mul(17.0)).add(11.0)));
      const led = step(0.2, fract(u.x.mul(6))).mul(step(0.35, fract(u.y.mul(26)))).mul(on);
      const hcol = mix(vec3(0.1, 1.0, 0.4), vec3(0.1, 0.7, 1.0), step(0.5, h));
      const alarm = step(0.97, h);
      rackMat.colorNode = color('#10151e');
      rackMat.emissiveNode = mix(hcol, vec3(1.0, 0.2, 0.2), alarm).mul(led.mul(1.8));
    }
    for (let i = 0; i < 5; i++) {
      const rack = new THREE.Mesh(boxG(0.8, 2.2, 0.9, [(i - 2) * 0.95, 1.1, 0]), rackMat);
      rack.castShadow = true;
      hut.add(rack);
    }
    hut.add(new THREE.Mesh(boxG(5.2, 0.15, 1.5, [0, 2.3, 0]), steel));
    hut.add(new THREE.Mesh(boxG(0.12, 2.3, 1.5, [-2.6, 1.15, 0]), steel), new THREE.Mesh(boxG(0.12, 2.3, 1.5, [2.6, 1.15, 0]), steel));
    hut.add(new THREE.Mesh(boxG(4.8, 0.05, 0.05, [0, 2.2, 0.76]), glowMat('#19d9ff', 2.4)));
    root.add(hut);
    env.addLight('#19d9ff', 12, 8, -11.4, QUAY_Y + 2.0, -9.5);
  }

  // ───────── ventilation towers with spinning fans ─────────
  const fans: THREE.Group[] = [];
  {
    const towerBody = mat('#1d2432', 0.5, 0.75);
    const tower = (x: number, z: number, h: number, r: number, col: string): void => {
      const g = new THREE.Group();
      g.position.set(x, QUAY_Y, z);
      g.add(
        new THREE.Mesh(
          mergeG([cylG(r, r * 1.08, h, 20, [0, h / 2, 0]), torG(r, 0.08, 28, 6, [0, h, 0], [Math.PI / 2, 0, 0]), new THREE.RingGeometry(r * 0.97, r * 1.05, 28).rotateX(-Math.PI / 2).translate(0, h + 0.02, 0)]),
          towerBody,
        ),
      );
      g.add(new THREE.Mesh(mergeG([torG(r * 1.02, 0.05, 28, 6, [0, h * 0.5, 0], [Math.PI / 2, 0, 0]), torG(r * 1.02, 0.05, 28, 6, [0, h * 0.2, 0], [Math.PI / 2, 0, 0]), cylG(r * 0.14, r * 0.14, 0.14, 10, [0, h + 0.05, 0])]), glowMat(col, 2.6)));
      const rotor = new THREE.Group();
      rotor.position.y = h + 0.05;
      const blades = mergeG(
        [0, 1, 2, 3, 4, 5].map((i) => {
          const bl = boxG(r * 0.9, 0.03, r * 0.28, [r * 0.5, 0, 0], [0.35, 0, 0]);
          return xf(bl, [0, 0, 0], [0, (i / 6) * Math.PI * 2, 0]);
        }),
      );
      rotor.add(new THREE.Mesh(blades, steel));
      g.add(rotor);
      fans.push(rotor);
      root.add(g);
    };
    tower(-9.6, 16, 3.4, 1.2, '#ff2fd0');
    tower(9.8, 15, 4.2, 1.5, '#19d9ff');
    tower(-11.5, -18, 3.0, 1.1, '#ffb020');
    tower(11.8, -20, 3.6, 1.3, '#7a5cff');
  }

  // ───────── gantry crane over the canal (side 1) ─────────
  const crane = new THREE.Group();
  const trolley = new THREE.Group();
  const hook = new THREE.Group();
  const beacon = new THREE.Mesh(sphG(0.22, 10, 8), glowMat('#ff2e3a', 3));
  {
    crane.position.set(9.2, QUAY_Y, -7.5);
    const tw = mergeG([
      ...[
        [0.55, 0.55],
        [-0.55, 0.55],
        [0.55, -0.55],
        [-0.55, -0.55],
      ].map(([x, z]) => boxG(0.16, 15, 0.16, [x!, 7.5, z!])),
      ...[2, 4, 6, 8, 10, 12, 14].flatMap((y) => [boxG(1.3, 0.09, 0.09, [0, y, 0.55]), boxG(1.3, 0.09, 0.09, [0, y, -0.55]), boxG(0.09, 0.09, 1.3, [0.55, y, 0]), boxG(0.09, 0.09, 1.3, [-0.55, y, 0]), boxG(1.5, 0.07, 0.07, [0, y + 1, 0.55], [0, 0, 0.7])]),
      boxG(2.4, 1.2, 2.0, [0, 15.6, 0]),
    ]);
    crane.add(new THREE.Mesh(tw, mat('#c9a000', 0.6, 0.5)));
    const jibPivot = new THREE.Group();
    jibPivot.position.y = 16.5;
    const jib = mergeG([
      boxG(20, 0.3, 0.3, [-9, 0.7, 0.4]),
      boxG(20, 0.3, 0.3, [-9, 0.7, -0.4]),
      boxG(20, 0.25, 0.25, [-9, 0.0, 0]),
      ...Array.from({ length: 16 }, (_, i) => boxG(0.09, 1.0, 0.09, [-18 + i * 1.2 + 0.6, 0.4, 0], [0, 0, i % 2 ? 0.5 : -0.5])),
      boxG(6, 0.5, 0.9, [4.5, 0.4, 0]),
      boxG(2, 1.8, 1.4, [5.5, -0.4, 0]),
    ]);
    jibPivot.add(new THREE.Mesh(jib, mat('#c9a000', 0.6, 0.5)));
    beacon.position.set(0, 2.4, 0);
    jibPivot.add(beacon);
    jibPivot.add(new THREE.Mesh(boxG(19, 0.05, 0.05, [-9, 1.05, 0]), glowMat('#ff2fd0', 2.2)));
    trolley.position.set(-9, 0.4, 0);
    trolley.add(new THREE.Mesh(boxG(0.9, 0.35, 0.9), darkSteel));
    const cable = new THREE.Mesh(cylG(0.02, 0.02, 1, 5), darkSteel);
    cable.name = 'cable';
    hook.add(new THREE.Mesh(mergeG([boxG(1.8, 0.16, 0.8), boxG(1.6, 1.0, 0.7, [0, -0.7, 0]), boxG(1.62, 0.06, 0.72, [0, -0.5, 0])]), mat('#3a5a7a', 0.6, 0.5)));
    hook.add(new THREE.Mesh(boxG(1.4, 0.06, 0.06, [0, -1.0, 0.36]), glowMat('#19d9ff', 2.8)));
    trolley.add(hook, cable);
    jibPivot.add(trolley);
    crane.add(jibPivot);
    crane.userData.jib = jibPivot;
    crane.userData.cable = cable;
    root.add(crane);
    env.addLight('#ff2e3a', 8, 12, 9.2, QUAY_Y + 17.5, -7.5);
  }
  env.updaters.push((dt, t) => {
    for (let i = 0; i < fans.length; i++) fans[i]!.rotation.y += dt * (5 + i * 1.7);
    const jib = crane.userData.jib as THREE.Group;
    jib.rotation.y = Math.sin(t * 0.06) * 0.05;
    const tx = -9.5 + Math.sin(t * 0.13) * 5.5;
    trolley.position.x = tx;
    const drop = 7.0 + Math.sin(t * 0.21) * 2.5;
    hook.position.y = -drop;
    const cable = crane.userData.cable as THREE.Mesh;
    cable.scale.set(1, drop, 1);
    cable.position.y = -drop / 2;
    hook.rotation.y = Math.sin(t * 0.4) * 0.25;
    (beacon.material as THREE.MeshBasicNodeMaterial).color.set('#ff2e3a').multiplyScalar(Math.sin(t * 3.2) > 0 ? 3.2 : 0.3);
  });

  // ───────── steam vents ─────────
  {
    const vents: Array<[number, number]> = [
      [-9.8, 6.2],
      [10.2, 6.4],
      [-11, -7.2],
      [8.4, -9.4],
      [-8.6, -12],
    ];
    const grateMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.8 });
    {
      const u = uv();
      const bars = step(0.5, fract(u.x.mul(9)));
      grateMat.colorNode = color('#0a0d12');
      grateMat.emissiveNode = vec3(1.0, 0.45, 0.2).mul(bars.oneMinus().mul(0.9));
    }
    const grateGeos: THREE.BufferGeometry[] = [];
    for (const [x, z] of vents) {
      grateGeos.push(new THREE.PlaneGeometry(1.1, 0.7).rotateX(-Math.PI / 2).translate(x, QUAY_Y + 0.02, z));
      const st = createParticles({ count: 80, min: [x - 0.35, QUAY_Y + 0.1, z - 0.25], max: [x + 0.35, QUAY_Y + 4.5, z + 0.25], color: '#c8d4f0', color2: '#ff9ad0', size: 1.1, motion: 'rise', speed: 0.5, wind: [0.35, 0.1], additive: false, opacity: 0.13, quality: q });
      root.add(st);
    }
    root.add(new THREE.Mesh(mergeG(grateGeos), grateMat));
  }

  // ───────── overhead cables with string lights ─────────
  {
    const cableGeos: THREE.BufferGeometry[] = [];
    const bulbMats: THREE.Matrix4[] = [];
    const bulbCols: THREE.Color[] = [];
    const bulbPal = ['#ff2fd0', '#19d9ff', '#ffb020', '#7dff6a'].map((c) => new THREE.Color(c));
    const spans: Array<{ z: number; y: number; sag: number; lights: boolean }> = [
      { z: -11, y: 7.6, sag: 1.4, lights: true },
      { z: -24, y: 9.4, sag: 1.6, lights: false },
      { z: -34, y: 8.4, sag: 1.4, lights: true },
      { z: 34, y: 9.0, sag: 1.5, lights: true },
    ];
    const poleGeos: THREE.BufferGeometry[] = [];
    for (const sp of spans) {
      const x0 = -11.2;
      const x1 = 11.2;
      for (let k = 0; k < 2; k++) {
        const pts: THREE.Vector3[] = [];
        const n = 12;
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          pts.push(new THREE.Vector3(x0 + (x1 - x0) * u, sp.y - Math.sin(u * Math.PI) * sp.sag - k * 0.35, sp.z + k * 0.18));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        cableGeos.push(new THREE.TubeGeometry(curve, 30, 0.035, 5, false));
        if (sp.lights && k === 0) {
          for (let i = 1; i < 26; i++) {
            const p = curve.getPointAt(i / 26);
            bulbMats.push(mtx([p.x, p.y - 0.12, p.z]));
            bulbCols.push(bulbPal[i % bulbPal.length]!);
          }
        }
      }
      for (const s of [-1, 1]) {
        const hh = sp.y + 0.6 - QUAY_Y;
        poleGeos.push(cylG(0.11, 0.16, hh, 8, [s * 11.2, QUAY_Y + hh / 2, sp.z]), boxG(0.9, 0.08, 0.08, [s * 10.9, sp.y + 0.5, sp.z]));
      }
    }
    // poles positioned relative to world (QUAY_Y offset)
    const poleMesh = new THREE.Mesh(mergeG(poleGeos), steel);
    root.add(poleMesh);
    root.add(new THREE.Mesh(mergeG(cableGeos), darkSteel));
    root.add(instancedFrom(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3, 3, 3) }), bulbMats, bulbCols));
  }

  // ───────── dispatcher hologram NPC (side 0) ─────────
  {
    const g = new THREE.Group();
    g.position.set(-8.4, QUAY_Y, 6.6);
    g.rotation.y = Math.PI / 2 + 0.2;
    g.add(new THREE.Mesh(mergeG([cylG(0.5, 0.6, 0.45, 20, [0, 0.22, 0]), cylG(0.34, 0.34, 0.05, 20, [0, 0.47, 0])]), mat('#151b27', 0.4, 0.85)));
    g.add(new THREE.Mesh(torG(0.5, 0.025, 32, 6, [0, 0.48, 0], [Math.PI / 2, 0, 0]), glowMat('#19d9ff', 3)));
    const holoMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    {
      const wp = positionWorld;
      const n = normalize(normalWorld);
      const vd = normalize(cameraPosition.sub(wp));
      const fres = pow(float(1).sub(abs(dot(n, vd))), 1.6);
      const scan = sin(wp.y.mul(70).sub(time.mul(5))).mul(0.5).add(0.5);
      const glitch = step(0.985, fract(sin(time.mul(3.7)).mul(9137.3)));
      holoMat.colorNode = vec3(0.15, 0.85, 1.0).mul(fres.mul(1.6).add(0.35)).mul(scan.mul(0.5).add(0.6)).mul(glitch.mul(1.8).add(1.0)).mul(1.5);
      holoMat.opacityNode = fres.mul(0.7).add(0.2).mul(sin(time.mul(29)).mul(0.05).add(0.95));
    }
    const fig = new THREE.Group();
    fig.position.y = 0.6;
    const body = mergeG([
      sphG(0.15, 16, 12, [0, 1.55, 0]),
      cylG(0.05, 0.06, 0.12, 10, [0, 1.36, 0]),
      xf(new THREE.CapsuleGeometry(0.19, 0.5, 6, 14), [0, 1.0, 0], [0, 0, 0], [1, 1, 0.65]),
      xf(new THREE.CapsuleGeometry(0.055, 0.5, 4, 8), [0.29, 1.0, 0.05], [0.25, 0, 0.12]),
      xf(new THREE.CapsuleGeometry(0.055, 0.5, 4, 8), [-0.29, 1.0, 0.05], [0.25, 0, -0.12]),
      xf(new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), [0.1, 0.35, 0], [0, 0, 0]),
      xf(new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), [-0.1, 0.35, 0], [0, 0, 0]),
    ]);
    fig.add(new THREE.Mesh(body, holoMat));
    // orbiting data rings
    const rg = new THREE.Group();
    const r1 = new THREE.Mesh(torG(0.55, 0.008, 40, 4), glowMat('#19d9ff', 2.2));
    const r2 = new THREE.Mesh(torG(0.7, 0.006, 40, 4), glowMat('#ff2fd0', 2.0));
    r1.rotation.x = Math.PI / 2;
    r2.rotation.x = Math.PI / 2 + 0.6;
    rg.add(r1, r2);
    rg.position.y = 1.0;
    fig.add(rg);
    g.add(fig);
    // info panel
    const ptex = signTexture({ text: 'DISPATCH', sub: 'PLATTFORM · MAX 2 KURIERE', color: '#19d9ff', w: 512, h: 256, bg: 'rgba(4,20,32,0.55)', border: true });
    const pm = new THREE.MeshBasicNodeMaterial({ map: ptex, color: new THREE.Color(1.8, 1.8, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), pm);
    panel.position.set(0.95, 2.05, 0.1);
    panel.rotation.y = -0.45;
    g.add(panel);
    root.add(g);
    env.addLight('#19d9ff', 8, 7, -8.0, QUAY_Y + 1.8, 6.6);
    updaters.push((_dt, t) => {
      fig.position.y = 0.6 + Math.sin(t * 1.4) * 0.04;
      fig.rotation.y = Math.sin(t * 0.5) * 0.5;
      rg.rotation.y = t * 0.9;
      panel.position.y = 2.05 + Math.sin(t * 1.1) * 0.03;
    });
  }

  // ───────── searchlights sweeping the sky + hologram globe ─────────
  {
    const beams: Array<{ piv: THREE.Group; ph: number; sp: number; amp: number }> = [];
    const addBeam = (x: number, y: number, z: number, col: string, ph: number, sp: number): void => {
      const piv = new THREE.Group();
      piv.position.set(x, y, z);
      const sh = lightShaft(col, 110, 0.3, 7, 0.32);
      sh.rotation.x = Math.PI; // extend upward
      piv.add(sh);
      const base = new THREE.Mesh(cylG(0.5, 0.7, 0.8, 10), steel);
      base.position.y = -0.3;
      piv.add(base);
      const lens = new THREE.Mesh(sphG(0.4, 10, 8), glowMat(col, 3.5));
      piv.add(lens);
      root.add(piv);
      beams.push({ piv, ph, sp, amp: 0.55 });
    };
    addBeam(-24, 24, -20, '#8fd8ff', 0, 0.35);
    addBeam(26, 30, -26, '#ff9ad8', 2, 0.28);
    addBeam(-44, 40, -50, '#9a8aff', 4, 0.22);
    if (q.density > 0.6) addBeam(46, 48, -48, '#8fffe0', 1, 0.3);
    updaters.push((_dt, t) => {
      for (const b of beams) {
        b.piv.rotation.z = Math.sin(t * b.sp + b.ph) * b.amp;
        b.piv.rotation.x = Math.cos(t * b.sp * 0.8 + b.ph) * b.amp * 0.6;
      }
    });

    // rotating hologram globe above the arkologie
    const globe = new THREE.Group();
    globe.position.set(30, 54, -16);
    const wf = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(7, 2)), new THREE.LineBasicNodeMaterial({ color: new THREE.Color(0.2, 1.4, 2.2), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    globe.add(wf);
    const ringMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.2, 0.4, 1.8) });
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(9 + i * 1.4, 0.06, 6, 80), ringMat);
      r.rotation.set(1.0 + i * 0.5, i * 0.7, 0);
      globe.add(r);
      rings.push(r);
    }
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), glowMat('#20e8ff', 1.6, 0.6)));
    root.add(globe);
    updaters.push((dt) => {
      wf.rotation.y += dt * 0.25;
      wf.rotation.x += dt * 0.05;
      rings.forEach((r, i) => {
        r.rotation.z += dt * (0.3 + i * 0.2);
      });
    });
  }
}
