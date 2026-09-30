import * as THREE from 'three/webgpu';
import { abs, color, float, floor, fract, hash, mix, mx_fractal_noise_float, mx_noise_float, positionWorld, pow, sin, smoothstep, step, time, vec2, vec3 } from 'three/tsl';
import { createWater, glowMat, mat } from '../../world/kit';
import { boxG, cylG, instancedFrom, mergeG, mtx, QUAY_Y, CANAL_HALF, type Env } from './env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TN = any;

/** One layer of animated rain ripples (rings) on a 2D world position node. Returns 0..1. */
export function rippleLayer(P: TN, scale: number, speed: number, seed: number): TN {
  const g = P.mul(scale);
  const cell: TN = floor(g);
  const f: TN = fract(g);
  const id = cell.x.add(cell.y.mul(57.0)).add(seed + 2000.0);
  const h1 = hash(id);
  const h2 = hash(id.add(3.1));
  const h3 = hash(id.add(7.7));
  const centre = vec2(h1.mul(0.4).add(0.3), h2.mul(0.4).add(0.3));
  const d = f.sub(centre).length();
  const ph = fract(time.mul(speed).add(h3));
  const radius = ph.mul(0.3);
  const width = ph.mul(0.03).add(0.012);
  const ring = smoothstep(width, 0.0, abs(d.sub(radius))).mul(float(1).sub(ph).pow(1.6));
  return ring;
}

export function groundAt(x: number, _z: number): number {
  return Math.abs(x) >= CANAL_HALF ? QUAY_Y : 0;
}

/** Water, quays, streets, canal walls. */
export function buildTerrain(env: Env): { water: THREE.Mesh } {
  const { q, root } = env;

  // ───────── canal water ─────────
  const water = createWater({
    width: CANAL_HALF * 2 + 0.1,
    length: 240,
    position: new THREE.Vector3(0, 0, 0),
    shallow: '#0c4a66',
    deep: '#02040e',
    foam: '#8aeaff',
    sky: '#5a35a0',
    flow: [0.0, 0.22],
    waveAmp: 0.03,
    waveLen: 3.4,
    roughness: 0.06,
    depthFade: 2.0,
    foamWidth: 0.22,
    refraction: 0.015,
    normalStrength: 0.5,
    minOpacity: 0.86,
    glow: '#1690d0',
    glowStrength: 0.3,
    quality: q,
  });
  root.add(water);

  // magenta / cyan neon reflection ribbons on the water (additive)
  const ribbonMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  {
    const P = positionWorld.xz;
    const side = step(0.0, P.x); // 1 on the cyan (right) side
    const dEdge = float(CANAL_HALF).sub(abs(P.x));
    const band = smoothstep(4.2, 0.0, dEdge);
    const streak = mx_noise_float(vec3(P.x.mul(0.55), P.y.mul(0.16).sub(time.mul(0.35)), time.mul(0.25))).mul(0.5).add(0.5);
    const slices = pow(sin(P.y.mul(0.9).add(P.x.mul(0.6)).add(time.mul(0.9))).mul(0.5).add(0.5), 3);
    const mag = vec3(1.0, 0.12, 0.72);
    const cya = vec3(0.05, 0.85, 1.0);
    ribbonMat.colorNode = mix(mag, cya, side).mul(1.4);
    ribbonMat.opacityNode = band.mul(streak.mul(0.55).add(slices.mul(0.25))).mul(0.34);
  }
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(CANAL_HALF * 2, 200, 1, 1).rotateX(-Math.PI / 2), ribbonMat);
  ribbon.position.y = 0.035;
  ribbon.renderOrder = 2;
  root.add(ribbon);

  // rain ripples on the water
  const rippleMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  {
    const P = positionWorld.xz;
    const r = rippleLayer(P, 1.15, 0.85, 0).add(rippleLayer(P, 2.1, 1.25, 41).mul(0.8)).add(q.level === 'low' ? float(0) : rippleLayer(P, 3.3, 1.7, 97).mul(0.6));
    rippleMat.colorNode = vec3(0.55, 0.85, 1.0).mul(1.4);
    rippleMat.opacityNode = r.mul(0.32);
  }
  const ripples = new THREE.Mesh(new THREE.PlaneGeometry(CANAL_HALF * 2, 200).rotateX(-Math.PI / 2), rippleMat);
  ripples.position.y = 0.05;
  ripples.renderOrder = 3;
  root.add(ripples);

  // ───────── quay surfaces (wet concrete / asphalt with puddles) ─────────
  const groundMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
  {
    const P = positionWorld.xz;
    const ax = abs(positionWorld.x);
    const road = smoothstep(2.4, 1.9, abs(ax.sub(14.0)));
    const g = P.div(2.5);
    const fr = abs(fract(g).sub(0.5));
    const seam = smoothstep(0.465, 0.5, fr.x.max(fr.y)).mul(float(1).sub(road));
    const n = mx_fractal_noise_float(vec3(P.x.mul(0.16), 0.0, P.y.mul(0.16)), 3, 2.0, 0.5, 1.0);
    const n2 = mx_noise_float(vec3(P.x.mul(1.3), 0.0, P.y.mul(1.3)));
    const puddle = smoothstep(0.06, 0.22, n.add(road.mul(0.08)));
    const paver = mix(color('#1b2230'), color('#10151f'), seam);
    const asphalt = color('#0d1016').mul(n2.mul(0.25).add(1.0));
    const base = mix(paver, asphalt, road);
    groundMat.colorNode = base;
    groundMat.roughnessNode = mix(float(0.78), float(0.06), puddle).add(seam.mul(0.1));
    groundMat.metalnessNode = mix(float(0.05), float(0.35), puddle);
    // fake neon reflections in puddles
    const neonCol = mix(vec3(1.0, 0.14, 0.75), vec3(0.08, 0.85, 1.0), smoothstep(-6.0, 6.0, P.x.add(sin(P.y.mul(0.13)).mul(5.0))));
    const bands = pow(sin(P.y.mul(0.31).add(P.x.mul(0.08))).mul(0.5).add(0.5), 4.0);
    const dash = step(0.55, fract(P.y.mul(0.22))).mul(smoothstep(0.09, 0.03, abs(ax.sub(14.0)))).mul(road);
    const rip = rippleLayer(P, 1.6, 0.9, 7).mul(puddle).mul(0.6);
    groundMat.emissiveNode = neonCol.mul(puddle.mul(bands).mul(0.28).mul(float(1).sub(seam))).add(vec3(1.0, 0.8, 0.4).mul(dash.mul(0.9))).add(vec3(0.5, 0.8, 1.0).mul(rip));
  }
  for (const s of [-1, 1]) {
    const w = 60;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, 240, 1, 1).rotateX(-Math.PI / 2), groundMat);
    plane.position.set(s * (CANAL_HALF + w / 2), QUAY_Y, 0);
    plane.receiveShadow = true;
    root.add(plane);
  }

  // ───────── canal walls + coping + glow strips ─────────
  const wallMat = mat('#141a26', 0.7, 0.2);
  {
    const P = positionWorld;
    const bricks = abs(fract(P.z.div(1.2)).sub(0.5)).max(abs(fract(P.y.div(0.4)).sub(0.5)));
    const line = smoothstep(0.45, 0.5, bricks);
    const stain = mx_noise_float(vec3(P.z.mul(0.4), P.y.mul(2.0), 0.0)).mul(0.5).add(0.5);
    wallMat.colorNode = mix(color('#1b2331'), color('#0c1119'), line).mul(stain.mul(0.6).add(0.7));
    wallMat.emissiveNode = color('#0a2030').mul(smoothstep(0.0, -1.0, P.y).mul(0.4));
  }
  const glowStripL = glowMat('#ff2fd0', 2.6);
  const glowStripR = glowMat('#19d9ff', 2.6);
  const copingMat = mat('#232b3a', 0.4, 0.7);
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 240), wallMat);
    wall.position.set(s * (CANAL_HALF + 0.05), QUAY_Y - 1.8, 0);
    root.add(wall);
    const coping = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 240), copingMat);
    coping.position.set(s * (CANAL_HALF + 0.3), QUAY_Y + 0.0, 0);
    coping.receiveShadow = true;
    root.add(coping);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 240), s < 0 ? glowStripL : glowStripR);
    strip.position.set(s * (CANAL_HALF + 0.16), QUAY_Y + 0.09, 0);
    root.add(strip);
    // lower glow strip on the wall face, just above the water (reflects nicely)
    const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 240), s < 0 ? glowStripL : glowStripR);
    strip2.position.set(s * (CANAL_HALF - 0.16), 0.32, 0);
    root.add(strip2);
    // hazard band behind coping
    const hz = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
    const hzS = step(0.5, fract(positionWorld.z.mul(0.7).add(positionWorld.x.mul(0.7))));
    hz.colorNode = mix(color('#0e0f12'), color('#c99a00'), hzS);
    hz.emissiveNode = color('#c99a00').mul(hzS.mul(0.06));
    const band = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 240).rotateX(-Math.PI / 2), hz);
    band.position.set(s * (CANAL_HALF + 0.9), QUAY_Y + 0.005, 0);
    root.add(band);
  }

  // wall lamps (instanced, colour per lamp) + bollards + ladders
  const lampMats: THREE.Matrix4[] = [];
  const lampCols: THREE.Color[] = [];
  const palette = ['#ff2fd0', '#19d9ff', '#ffb020', '#7a5cff'].map((c) => new THREE.Color(c));
  for (const s of [-1, 1]) {
    for (let z = -100; z <= 100; z += 4.5) {
      lampMats.push(mtx([s * (CANAL_HALF - 0.06), 0.62, z]));
      lampCols.push(palette[(Math.abs(Math.round(z / 4.5)) + (s > 0 ? 1 : 0)) % palette.length]!);
    }
  }
  const wallLampMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.6, 2.6, 2.6) });
  root.add(instancedFrom(boxG(0.06, 0.18, 0.4), wallLampMat, lampMats, lampCols));

  const bollardMats: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) for (let z = -60; z <= 60; z += 6) if (Math.abs(z) > 2.2 || true) bollardMats.push(mtx([s * (CANAL_HALF + 0.55), QUAY_Y + 0.22, z + (s > 0 ? 1.5 : 0)]));
  const bollardGeo = mergeG([cylG(0.12, 0.16, 0.36, 10, [0, 0, 0]), cylG(0.19, 0.16, 0.08, 10, [0, 0.2, 0])]);
  const bollards = instancedFrom(bollardGeo, mat('#3a4254', 0.4, 0.85), bollardMats);
  bollards.castShadow = true;
  root.add(bollards);

  // dock landing plates with chevrons at the platform berths
  const chevMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.5 });
  {
    const P = positionWorld;
    const ch = abs(fract(P.x.mul(0.9).add(abs(P.z).mul(0.9))).sub(0.5));
    const stripe = smoothstep(0.2, 0.16, ch);
    chevMat.colorNode = mix(color('#1a2130'), color('#e8a800'), stripe.mul(0.9));
    chevMat.emissiveNode = color('#ffb020').mul(stripe.mul(0.5));
  }
  for (const s of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 4.6), chevMat);
    plate.position.set(s * (CANAL_HALF + 1.6), QUAY_Y + 0.03, 0);
    plate.receiveShadow = true;
    root.add(plate);
  }

  return { water };
}
