import * as THREE from 'three/webgpu';
import { color, float, mix, positionWorld, sin, smoothstep, step, time } from 'three/tsl';
import { mat } from '../../world/kit';
import { boxG, cylG, instancedFrom, mergeG, mtx, QUAY_Y, xf, type Env } from './env';

/** Large steel arch bridge over the canal (truss deck, arches, hangers, chasing light strips). */
export function buildBridge(env: Env, z0 = -17, span = 27): void {
  const { root, q } = env;
  const steel = mat('#2b3444', 0.42, 0.85);
  const dark = mat('#141a24', 0.6, 0.7);
  const deckY = 7.6;
  const half = span; // deck from -span..span

  // deck
  const deckGeos: THREE.BufferGeometry[] = [
    boxG(half * 2, 0.55, 6.2, [0, deckY, 0]),
    boxG(half * 2, 0.9, 0.35, [0, deckY + 0.6, 3.0]),
    boxG(half * 2, 0.9, 0.35, [0, deckY + 0.6, -3.0]),
    // underside girders
    boxG(half * 2, 0.5, 0.4, [0, deckY - 0.5, 1.7]),
    boxG(half * 2, 0.5, 0.4, [0, deckY - 0.5, -1.7]),
  ];
  // diagonal truss under the deck
  const nT = 30;
  for (let i = 0; i < nT; i++) {
    const x = -half + ((i + 0.5) / nT) * half * 2;
    const dir = i % 2 ? 1 : -1;
    for (const z of [1.7, -1.7]) deckGeos.push(boxG(0.16, 1.6, 0.16, [x, deckY - 1.05, z], [0, 0, dir * 0.6]));
  }
  // piers on both quays
  for (const s of [-1, 1]) {
    deckGeos.push(boxG(5, deckY + 0.4, 7.5, [s * (half - 3), (deckY - 0.5) / 2 + 0.4, 0]));
  }
  const deck = new THREE.Mesh(mergeG(deckGeos), steel);
  deck.castShadow = false;
  deck.receiveShadow = true;

  // arches (two, front & back) as tubes along a parabola
  const arch = (zz: number): THREE.BufferGeometry => {
    const pts: THREE.Vector3[] = [];
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = -half * 0.86 + u * half * 1.72;
      const k = 1 - Math.pow((x / (half * 0.86)), 2);
      pts.push(new THREE.Vector3(x, deckY + 0.6 + k * 9.2, zz));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 56, 0.32, 8, false);
  };
  const archGeo = mergeG([arch(3.05), arch(-3.05)]);
  const archMesh = new THREE.Mesh(archGeo, steel);

  // hangers (vertical) + top braces
  const hangerMats: THREE.Matrix4[] = [];
  const braceGeos: THREE.BufferGeometry[] = [];
  const nH = 21;
  for (let i = 1; i < nH; i++) {
    const u = i / nH;
    const x = -half * 0.86 + u * half * 1.72;
    const k = 1 - Math.pow(x / (half * 0.86), 2);
    const h = k * 9.2;
    if (h < 0.6) continue;
    for (const z of [3.05, -3.05]) hangerMats.push(mtx([x, deckY + 0.6 + h / 2, z], [0, 0, 0], [1, h, 1]));
    if (i % 2 === 0) braceGeos.push(boxG(0.14, 0.14, 6.1, [x, deckY + 0.6 + h, 0]));
  }
  const hangers = instancedFrom(cylG(0.055, 0.055, 1, 6), dark, hangerMats);
  const braces = braceGeos.length ? new THREE.Mesh(mergeG(braceGeos), steel) : null;

  // light strips: chasing lights along deck edges + arch
  const stripMat = new THREE.MeshBasicNodeMaterial();
  {
    const x = positionWorld.x;
    const chase = smoothstep(0.4, 1.0, sin(x.mul(0.55).sub(time.mul(3.2))).mul(0.5).add(0.5));
    stripMat.colorNode = mix(color('#19d9ff'), color('#ff2fd0'), step(0.0, sin(x.mul(0.12).add(time.mul(0.4))))).mul(chase.mul(2.4).add(0.5));
  }
  const strips = new THREE.Mesh(
    mergeG([
      boxG(half * 2, 0.1, 0.1, [0, deckY + 1.08, 3.0]),
      boxG(half * 2, 0.1, 0.1, [0, deckY + 1.08, -3.0]),
      boxG(half * 2, 0.08, 0.08, [0, deckY - 0.3, 3.15]),
      boxG(half * 2, 0.08, 0.08, [0, deckY - 0.3, -3.15]),
    ]),
    stripMat,
  );
  // glow along the arch (tube offset)
  const archGlowMat = new THREE.MeshBasicNodeMaterial();
  {
    const x = positionWorld.x;
    const pulse = sin(x.mul(0.35).add(time.mul(2.0))).mul(0.5).add(0.5);
    archGlowMat.colorNode = mix(color('#ff2fd0'), color('#7a5cff'), pulse).mul(pulse.mul(1.6).add(0.9));
  }
  const archGlowGeo = (() => {
    const pts: THREE.Vector3[] = [];
    const n = 28;
    for (const zz of [3.05 + 0.34, -3.05 - 0.34]) {
      void zz;
    }
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = -half * 0.86 + u * half * 1.72;
      const k = 1 - Math.pow(x / (half * 0.86), 2);
      pts.push(new THREE.Vector3(x, deckY + 0.6 + k * 9.2 - 0.05, 0));
    }
    const mk = (zz: number): THREE.BufferGeometry => xf(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 56, 0.09, 6, false), [0, 0, zz]);
    return mergeG([mk(3.05 + 0.34), mk(-3.05 - 0.34)]);
  })();
  const archGlow = new THREE.Mesh(archGlowGeo, archGlowMat);

  // road lamps along the deck (instanced small emissive)
  const lampMats: THREE.Matrix4[] = [];
  for (let x = -half + 2; x <= half - 2; x += 4) for (const z of [2.6, -2.6]) lampMats.push(mtx([x, deckY + 1.15, z]));
  const lampMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#ffe8c0').multiplyScalar(2.6) });
  const lamps = instancedFrom(new THREE.SphereGeometry(0.11, 8, 6), lampMat, lampMats);

  const g = new THREE.Group();
  g.name = 'bridge';
  g.position.set(0, 0, z0);
  g.add(deck, archMesh, hangers, strips, archGlow, lamps);
  if (braces) g.add(braces);

  // under-bridge light pool + spotlight
  const l = env.addLight('#7a5cff', 40, 20, 0, deckY - 1.5, z0 + 0.5);
  void l;
  // bridge shadow warning sign
  root.add(g);
  void q;
  void QUAY_Y;
  void float;
}
