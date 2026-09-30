import * as THREE from 'three/webgpu';
import { HumanoidActor } from '../../characters/HumanoidActor';
import type { HumanoidSpec } from '../../characters/HumanoidBuilder';
import { bake, cyl, ellipsoid, extrude, merge, roundedBox, torus, tube } from '../../characters/geo';
import { starShape } from './helpers';

const PAIR = {
  sun: { main: '#ffcf3a', deep: '#c8871a' },
  storm: { main: '#25b9d0', deep: '#12707f' },
  star: { main: '#a071ff', deep: '#5a36a8' },
} as const;
type PairId = keyof typeof PAIR;

/** Chest emblem (baked) in the pair colour: sun disc / storm bolt-diamond / star. */
function emblemGeometry(pair: PairId, size: number): THREE.BufferGeometry {
  const c = PAIR[pair].main;
  const d = PAIR[pair].deep;
  const parts: THREE.BufferGeometry[] = [];
  if (pair === 'sun') {
    parts.push(bake(ellipsoid(size, size, size * 0.22, 18, 10), { color: d, rough: 0.35, metal: 0.8 }));
    parts.push(bake(ellipsoid(size * 0.72, size * 0.72, size * 0.3, 18, 10), { color: c, rough: 0.25, metal: 0.9, emit: 0.7 }));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push(bake(new THREE.ConeGeometry(size * 0.16, size * 0.55, 6), { color: c, rough: 0.3, metal: 0.9, emit: 0.7 }, { p: [Math.cos(a) * size * 1.12, Math.sin(a) * size * 1.12, 0], r: [0, 0, a - Math.PI / 2], s: [1, 1, 0.35] }));
    }
  } else if (pair === 'storm') {
    const s = new THREE.Shape();
    s.moveTo(0, size * 1.2);
    s.lineTo(size * 0.7, 0);
    s.lineTo(0, -size * 1.2);
    s.lineTo(-size * 0.7, 0);
    s.closePath();
    parts.push(bake(extrude(s, size * 0.25, size * 0.05), { color: d, rough: 0.3, metal: 0.7 }));
    const bolt = new THREE.Shape();
    bolt.moveTo(size * 0.15, size * 0.85);
    bolt.lineTo(-size * 0.28, -size * 0.05);
    bolt.lineTo(size * 0.02, -size * 0.05);
    bolt.lineTo(-size * 0.15, -size * 0.85);
    bolt.lineTo(size * 0.32, size * 0.08);
    bolt.lineTo(size * 0.02, size * 0.08);
    bolt.closePath();
    parts.push(bake(extrude(bolt, size * 0.3, size * 0.02), { color: c, rough: 0.2, metal: 0.4, emit: 0.9 }, { p: [0, 0, size * 0.06] }));
  } else {
    parts.push(bake(extrude(starShape(5, size * 1.2, size * 0.5), size * 0.28, size * 0.05), { color: d, rough: 0.3, metal: 0.7 }));
    parts.push(bake(extrude(starShape(5, size * 0.95, size * 0.4), size * 0.3, size * 0.02), { color: c, rough: 0.2, metal: 0.4, emit: 0.9 }, { p: [0, 0, size * 0.06] }));
  }
  return merge(parts);
}

function chestZ(H: number, chest: number, belly: number): number {
  const chestR = H * 0.088 * chest * (1 + belly * 0.15);
  return chestR * (0.78 + belly * 0.12) * 0.99;
}

function addEmblem(a: HumanoidActor, pair: PairId, H: number, chest: number, belly: number, size: number): void {
  const T = a.rig.dims.torsoLen * 0.88;
  const g = emblemGeometry(pair, size);
  const z = chestZ(H, chest, belly) + size * 0.05;
  const m = a.attach(a.rig.torso, g, 'emblem');
  m.position.set(H * 0.075, T * 0.66, z);
  m.rotation.x = -0.08;
}

function makeActor(id: string, name: string, spec: HumanoidSpec, extra?: (a: HumanoidActor) => void): HumanoidActor {
  const a = new HumanoidActor({ id, name, spec, sitsInVehicle: true, walkSpeed: 1.35 });
  extra?.(a);
  return a;
}

export function createHarborActors(): Map<string, HumanoidActor> {
  const map = new Map<string, HumanoidActor>();

  // ───────── Kapitän Aurel – tall, proud, golden long coat, blond, captain hat ─────────
  {
    const H = 1.9;
    const build = { shoulders: 1.1, chest: 1.06, hips: 0.95, limbs: 1.0, legs: 1.03, head: 0.98, neck: 1.0 };
    const spec: HumanoidSpec = {
      height: H,
      build,
      skin: '#eebd98',
      eyes: { iris: '#3f86cf', size: 1.02 },
      hair: { style: 'short', color: '#f0c85c' },
      brows: { color: '#c8a040', thickness: 1.15, tilt: 0.05 },
      beard: { style: 'mustache', color: '#dcb254' },
      nose: 'long',
      lips: '#b8654f',
      blush: 0.15,
      outfit: {
        top: { kind: 'coat', color: '#d99f2b', accent: '#fff1c8', trim: '#8a5a12', length: 0.82, collar: 'high', sleeves: 'long', rough: 0.55, metal: 0.12 },
        bottom: { kind: 'pants', color: '#3a2a20' },
        shoes: { kind: 'boots', color: '#2b1c14' },
        belt: '#3a2618',
        sash: PAIR.sun.main,
        gloves: '#f4ead2',
      },
      hat: { kind: 'captain', color: '#f6f0e2', accent: PAIR.sun.main },
      idle: 'proud',
    };
    map.set('aurel', makeActor('aurel', 'Kapitän Aurel', spec, (a) => addEmblem(a, 'sun', H, build.chest, 0, 0.034)));
  }

  // ───────── Lyra – slender navigator, gold scarf, map tube, long hair ─────────
  {
    const H = 1.68;
    const build = { shoulders: 0.86, chest: 0.92, hips: 0.94, limbs: 0.88, legs: 1.05, head: 0.98, neck: 1.1 };
    const spec: HumanoidSpec = {
      height: H,
      build,
      skin: '#efc3a2',
      eyes: { iris: '#2f9a7a', size: 1.12 },
      hair: { style: 'long', color: '#7a3f22', accent: PAIR.sun.main },
      brows: { color: '#5a2e18', thickness: 0.8, tilt: -0.04 },
      nose: 'small',
      lips: '#c25a58',
      blush: 0.35,
      freckles: true,
      outfit: {
        top: { kind: 'jacket', color: '#f2e6c6', accent: '#d3a03a', trim: '#e2b64c', length: 0.3, collar: 'none', sleeves: 'long', rough: 0.7 },
        bottom: { kind: 'pants', color: '#5a3d2e' },
        shoes: { kind: 'boots', color: '#4a2f22' },
        belt: '#6a4830',
        scarf: PAIR.sun.main,
        sash: PAIR.sun.main,
        gloves: '#8a5a34',
      },
      idle: 'lookout',
    };
    map.set(
      'lyra',
      makeActor('lyra', 'Lyra', spec, (a) => {
        addEmblem(a, 'sun', H, build.chest, 0, 0.028);
        // brass-capped leather map tube on the back with strap
        const tubeParts = [
          bake(cyl(H * 0.026, H * 0.026, H * 0.36, 14), { color: '#7a4a2a', rough: 0.6 }),
          bake(cyl(H * 0.03, H * 0.03, H * 0.03, 14), { color: '#d8b04a', rough: 0.25, metal: 1 }, { p: [0, H * 0.19, 0] }),
          bake(cyl(H * 0.03, H * 0.03, H * 0.03, 14), { color: '#d8b04a', rough: 0.25, metal: 1 }, { p: [0, -H * 0.19, 0] }),
          bake(torus(H * 0.03, H * 0.006, Math.PI * 2, 14, 5), { color: '#3a2618', rough: 0.5 }, { p: [0, H * 0.06, 0], r: [Math.PI / 2, 0, 0] }),
          bake(tube([[0, H * 0.02, H * 0.03], [0, H * 0.0, H * 0.06], [0, -H * 0.02, H * 0.03]], H * 0.004, 4, 4), { color: '#3a2618', rough: 0.5 }),
        ];
        const tm = a.attach(a.rig.back, merge(tubeParts), 'mapTube');
        tm.position.set(H * 0.02, H * 0.02, -H * 0.03);
        tm.rotation.set(0.15, 0, 0.5);
        // strap across the chest
        const strap = a.attach(a.rig.torso, bake(tube([[H * 0.07, a.rig.dims.torsoLen * 0.85, H * 0.045], [0, a.rig.dims.torsoLen * 0.5, H * 0.075], [-H * 0.075, a.rig.dims.torsoLen * 0.2, H * 0.04]], H * 0.006, 12, 4), { color: '#3a2618', rough: 0.55 }), 'strap');
        strap.position.set(0, 0, 0);
      }),
    );
  }

  // ───────── Kapitän Brann – stocky, belly, full red beard, storm-blue heavy coat, tricorn ─────────
  {
    const H = 1.8;
    const build = { shoulders: 1.18, chest: 1.12, hips: 1.08, limbs: 1.16, legs: 0.9, head: 1.06, neck: 0.65, belly: 0.95 };
    const spec: HumanoidSpec = {
      height: H,
      build,
      skin: '#dc9a78',
      eyes: { iris: '#5a8298', size: 0.92 },
      hair: { style: 'short', color: '#b5401f' },
      brows: { color: '#a03a1c', thickness: 1.6, tilt: 0.1 },
      beard: { style: 'full', color: '#b5401f' },
      nose: 'round',
      lips: '#a8523f',
      blush: 0.4,
      outfit: {
        top: { kind: 'coat', color: '#28497a', accent: '#18304f', trim: PAIR.storm.main, length: 0.62, collar: 'fur', sleeves: 'long', rough: 0.9 },
        bottom: { kind: 'pants', color: '#2a2f3d' },
        shoes: { kind: 'boots', color: '#1c2028' },
        belt: '#2a1c14',
        sash: PAIR.storm.main,
        gloves: '#3a2a20',
      },
      hat: { kind: 'tricorn', color: '#1d2a44', accent: PAIR.storm.main },
      idle: 'armsCrossed',
    };
    map.set('brann', makeActor('brann', 'Kapitän Brann', spec, (a) => addEmblem(a, 'storm', H, build.chest, build.belly, 0.036)));
  }

  // ───────── Tamsin – wiry rigger, bandana, leather vest, rope coil on shoulder ─────────
  {
    const H = 1.72;
    const build = { shoulders: 1.02, chest: 0.98, hips: 0.9, limbs: 1.06, legs: 1.04, head: 0.94, neck: 1.0 };
    const spec: HumanoidSpec = {
      height: H,
      build,
      skin: '#c98d66',
      eyes: { iris: '#7a4a2a', size: 1.05 },
      hair: { style: 'spiky', color: '#2b1d16' },
      brows: { color: '#20150f', thickness: 1.0, tilt: 0.08 },
      nose: 'button',
      lips: '#a5584a',
      freckles: true,
      outfit: {
        top: { kind: 'vest', color: '#8a5a34', accent: '#3a2a20', trim: PAIR.storm.main, sleeves: 'short', rough: 0.7 },
        bottom: { kind: 'pants', color: '#3d4b5b' },
        shoes: { kind: 'boots', color: '#3a2a1e' },
        belt: '#4a3020',
        sash: PAIR.storm.main,
        scarf: PAIR.storm.main,
        gloves: '#6b4a2a',
      },
      hat: { kind: 'bandana', color: PAIR.storm.main },
      idle: 'energetic',
    };
    map.set(
      'tamsin',
      makeActor('tamsin', 'Tamsin', spec, (a) => {
        addEmblem(a, 'storm', H, build.chest, 0, 0.028);
        // rope coil over the left shoulder
        const rope: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) rope.push(bake(torus(H * 0.052, H * 0.0075, Math.PI * 2, 22, 5), { color: i % 2 ? '#c9a86a' : '#b8965a', rough: 0.95 }, { p: [0, i * H * 0.0105 - H * 0.02, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 1] }));
        rope.push(bake(tube([[H * 0.05, 0, 0], [H * 0.07, -H * 0.06, H * 0.01], [H * 0.06, -H * 0.13, H * 0.02]], H * 0.0075, 10, 5), { color: '#c9a86a', rough: 0.95 }));
        const rm = a.attach(a.rig.torso, merge(rope), 'ropeCoil');
        rm.position.set(a.rig.dims.shoulderX * 0.25, a.rig.dims.torsoLen * 0.88 * 0.86, 0);
        rm.rotation.set(0.15, 0, -0.55);
      }),
    );
  }

  // ───────── Kapitänin Ysolde – elegant, violet coat, tricorn, monocle ─────────
  {
    const H = 1.8;
    const build = { shoulders: 0.92, chest: 0.96, hips: 0.95, limbs: 0.92, legs: 1.07, head: 0.96, neck: 1.2 };
    const spec: HumanoidSpec = {
      height: H,
      build,
      skin: '#f2d4c0',
      eyes: { iris: '#7a68d8', size: 1.1 },
      hair: { style: 'bun', color: '#2a2030', accent: '#cbb8ff' },
      brows: { color: '#1f1826', thickness: 0.75, tilt: 0.09 },
      nose: 'hooked',
      lips: '#8f2f52',
      outfit: {
        top: { kind: 'coat', color: '#6b3fa8', accent: '#3a2266', trim: '#e6dcff', length: 0.92, collar: 'high', sleeves: 'long', rough: 0.5, metal: 0.1 },
        bottom: { kind: 'pants', color: '#231a30' },
        shoes: { kind: 'boots', color: '#1a1424' },
        belt: '#241a34',
        sash: PAIR.star.main,
        gloves: '#efe6ff',
      },
      hat: { kind: 'tricorn', color: '#2a1a44', accent: PAIR.star.main },
      idle: 'stately',
    };
    map.set(
      'ysolde',
      makeActor('ysolde', 'Kapitänin Ysolde', spec, (a) => {
        addEmblem(a, 'star', H, build.chest, 0, 0.032);
        // monocle (baked, attached to the head rig): golden ring, lens rim and a fine chain
        const r = a.rig.dims.headR;
        const ex = -r * 0.36;
        const ey = r * 1.05;
        const mono = [
          bake(torus(r * 0.235, r * 0.03, Math.PI * 2, 24, 6), { color: '#ffd54a', rough: 0.2, metal: 1, emit: 0.25 }, { p: [ex, ey, r * 1.0] }),
          bake(torus(r * 0.2, r * 0.012, Math.PI * 2, 20, 4), { color: '#fff3c0', rough: 0.1, metal: 1 }, { p: [ex, ey, r * 1.005] }),
          bake(tube([[ex - r * 0.2, ey - r * 0.1, r * 0.95], [-r * 0.75, ey - r * 0.55, r * 0.75], [-r * 0.85, ey - r * 1.3, r * 0.4], [-r * 0.5, ey - r * 2.0, r * 0.5]], r * 0.012, 14, 4), { color: '#ffd54a', rough: 0.25, metal: 1 }),
        ];
        a.attach(a.rig.head, merge(mono), 'monocle');
      }),
    );
  }

  // ───────── Pim – small ship boy, cap, telescope ─────────
  {
    const H = 1.349;
    const build = { shoulders: 0.95, chest: 0.95, hips: 0.95, limbs: 0.95, legs: 1.0, head: 1.02, neck: 1.0 };
    const spec: HumanoidSpec = {
      height: H,
      build,
      skin: '#f0c4a0',
      eyes: { iris: '#3a8a5a', size: 1.25 },
      hair: { style: 'curly', color: '#d9772e' },
      brows: { color: '#b0561c', thickness: 0.9, tilt: -0.06 },
      nose: 'button',
      lips: '#c86a5a',
      blush: 0.55,
      freckles: true,
      outfit: {
        top: { kind: 'jacket', color: '#3d3070', accent: '#e8e2ff', trim: PAIR.star.main, length: 0.25, collar: 'none', sleeves: 'long', rough: 0.85 },
        bottom: { kind: 'shorts', color: '#4a4370' },
        shoes: { kind: 'boots', color: '#5a3a22' },
        belt: '#4a3020',
        sash: PAIR.star.main,
        scarf: PAIR.star.main,
      },
      hat: { kind: 'cap', color: '#7a4fd0', accent: '#ffd54a' },
      idle: 'fidget',
    };
    map.set(
      'pim',
      makeActor('pim', 'Pim', spec, (a) => {
        addEmblem(a, 'star', H, build.chest, 0, 0.026);
        // brass telescope in the right hand
        const L = H * 0.26;
        const tele = [
          bake(cyl(H * 0.014, H * 0.016, L * 0.5, 12), { color: '#7a4a2a', rough: 0.55 }, { p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }),
          bake(cyl(H * 0.011, H * 0.014, L * 0.4, 12), { color: '#d8b04a', rough: 0.25, metal: 1 }, { p: [0, 0, L * 0.42], r: [Math.PI / 2, 0, 0] }),
          bake(cyl(H * 0.019, H * 0.017, L * 0.16, 12), { color: '#d8b04a', rough: 0.25, metal: 1 }, { p: [0, 0, L * 0.68], r: [Math.PI / 2, 0, 0] }),
          bake(cyl(H * 0.014, H * 0.014, L * 0.1, 12), { color: '#cfe8ff', rough: 0.05, metal: 0.2, emit: 0.4 }, { p: [0, 0, L * 0.77], r: [Math.PI / 2, 0, 0] }),
          bake(cyl(H * 0.013, H * 0.013, L * 0.08, 12), { color: '#2a1c14', rough: 0.6 }, { p: [0, 0, -L * 0.28], r: [Math.PI / 2, 0, 0] }),
        ];
        const tm = a.attach(a.rig.handR, merge(tele), 'telescope');
        tm.position.set(0, H * 0.02, H * 0.05);
        tm.rotation.set(-0.5, 0, 0);
      }),
    );
  }

  // silence unused helpers in case of tree-shaking differences
  void roundedBox;
  return map;
}
