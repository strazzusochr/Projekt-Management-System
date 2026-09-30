import * as THREE from 'three/webgpu';
import { HumanoidActor } from '../../characters/HumanoidActor';
import type { HumanoidSpec } from '../../characters/HumanoidBuilder';
import { Actor } from '../../characters/Actor';
import { bake, cyl, ellipsoid, merge, roundedBox, torus, tube } from '../../characters/geo';
import { PolarDogActor } from './dog';

const H_HENRIK = 1.85;
const H_SANA = 1.72;
const H_LUMI = 1.2;
const H_AKI = 1.25;

function goggles(r: number): THREE.BufferGeometry {
  // pushed up on the forehead, lenses facing forward
  const parts: THREE.BufferGeometry[] = [];
  const strap = { color: '#1d2126', rough: 0.85 };
  const frame = { color: '#e07a1e', rough: 0.45 };
  const glass = { color: '#ffb35a', rough: 0.08, metal: 0.4, emit: 0.7 };
  parts.push(bake(torus(r * 0.9, r * 0.075, Math.PI * 2, 30, 6), strap, { p: [0, r * 1.7, -r * 0.02], r: [Math.PI / 2 - 0.22, 0, 0], s: [1, 1.05, 1] }));
  for (const s of [1, -1]) {
    parts.push(bake(cyl(r * 0.33, r * 0.33, r * 0.2, 16), frame, { p: [s * r * 0.37, r * 1.72, r * 0.74], r: [Math.PI / 2 - 0.35, 0, 0] }));
    parts.push(bake(cyl(r * 0.27, r * 0.27, r * 0.22, 16), glass, { p: [s * r * 0.37, r * 1.74, r * 0.79], r: [Math.PI / 2 - 0.35, 0, 0] }));
  }
  parts.push(bake(roundedBox(r * 0.22, r * 0.14, r * 0.14, r * 0.04), frame, { p: [0, r * 1.7, r * 0.78], r: [-0.3, 0, 0] }));
  return merge(parts);
}

function tablet(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(bake(roundedBox(0.19, 0.27, 0.018, 0.012), { color: '#1c2229', rough: 0.35, metal: 0.6 }, { p: [0, 0, 0] }));
  parts.push(bake(new THREE.BoxGeometry(0.165, 0.235, 0.004), { color: '#7fe9ff', rough: 0.1, emit: 2.6 }, { p: [0, 0, 0.011] }));
  // UI bars on the screen
  for (let i = 0; i < 4; i++) parts.push(bake(new THREE.BoxGeometry(0.11 - i * 0.015, 0.014, 0.003), { color: '#effcff', rough: 0.1, emit: 3.2 }, { p: [-0.02, 0.07 - i * 0.032, 0.0135] }));
  parts.push(bake(new THREE.BoxGeometry(0.14, 0.05, 0.003), { color: '#3dffb2', rough: 0.1, emit: 2.8 }, { p: [0, -0.085, 0.0135] }));
  return merge(parts);
}

function lantern(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(bake(cyl(0.05, 0.045, 0.02, 10), { color: '#2a2f36', rough: 0.4, metal: 0.8 }, { p: [0, -0.09, 0] }));
  parts.push(bake(cyl(0.048, 0.056, 0.15, 10), { color: '#ffb35a', rough: 0.2, emit: 3.4 }, { p: [0, 0.0, 0] }));
  parts.push(bake(cyl(0.02, 0.06, 0.04, 10), { color: '#2a2f36', rough: 0.4, metal: 0.8 }, { p: [0, 0.095, 0] }));
  parts.push(bake(tube([[-0.055, 0.1, 0], [0, 0.17, 0], [0.055, 0.1, 0]], 0.006, 10, 4), { color: '#2a2f36', rough: 0.4, metal: 0.8 }));
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) parts.push(bake(new THREE.BoxGeometry(0.008, 0.16, 0.008), { color: '#2a2f36', rough: 0.4, metal: 0.8 }, { p: [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05] }));
  return merge(parts);
}

function backpack(r: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(bake(roundedBox(0.34, 0.5, 0.2, 0.06), { color: '#c8541a', rough: 0.75 }, { p: [0, 0, 0] }));
  parts.push(bake(roundedBox(0.3, 0.16, 0.06, 0.03), { color: '#8a3a12', rough: 0.75 }, { p: [0, -0.12, -0.12] }));
  parts.push(bake(cyl(0.09, 0.09, 0.32, 12), { color: '#2b3038', rough: 0.6 }, { p: [0, -0.32, 0], r: [0, 0, Math.PI / 2] }));
  parts.push(bake(ellipsoid(0.016, 0.016, 0.016, 6, 5), { color: '#ff3b2f', rough: 0.3, emit: 2.4 }, { p: [0.1, 0.22, -0.11] }));
  void r;
  return merge(parts);
}

export interface Cast {
  actors: Map<string, Actor>;
  humans: HumanoidActor[];
  dog: PolarDogActor;
}

export function createCast(groundAt: (x: number, z: number) => number): Cast {
  const specs: Record<string, { name: string; spec: HumanoidSpec; walk: number }> = {
    henrik: {
      name: 'Dr. Henrik',
      walk: 1.3,
      spec: {
        height: H_HENRIK,
        build: { shoulders: 1.14, chest: 1.12, belly: 0.3, limbs: 1.15, hips: 1.08, head: 1.02 },
        skin: '#d9a688',
        eyes: { iris: '#3c6f92' },
        hair: { style: 'short', color: '#7d7c78' },
        brows: { color: '#6f6c66', thickness: 1.4, tilt: 0.04 },
        beard: { style: 'full', color: '#8b8882' },
        nose: 'round',
        blush: 0.18,
        outfit: {
          top: { kind: 'parka', color: '#e8651a', accent: '#b4470f', trim: '#f4c26a', collar: 'fur', length: 0.24, rough: 0.8 },
          bottom: { kind: 'pants', color: '#2a303a' },
          shoes: { kind: 'boots', color: '#2b2622', sole: '#101215' },
          gloves: '#3a3f47',
          belt: '#3a2b1c',
        },
        idle: 'calm',
      },
    },
    sana: {
      name: 'Dr. Sana',
      walk: 1.35,
      spec: {
        height: H_SANA,
        build: { shoulders: 0.97, chest: 1.0, hips: 1.02, head: 1.0 },
        skin: '#c58a68',
        eyes: { iris: '#3a2a20' },
        hair: { style: 'bob', color: '#15161b' },
        brows: { color: '#15161b', thickness: 0.9 },
        nose: 'small',
        lips: '#a24a46',
        blush: 0.25,
        outfit: {
          top: { kind: 'parka', color: '#12a3a1', accent: '#0d6f78', trim: '#f2ead8', collar: 'fur', length: 0.2, rough: 0.78 },
          bottom: { kind: 'pants', color: '#232a35' },
          shoes: { kind: 'boots', color: '#3b2f2a', sole: '#14161a' },
          gloves: '#e9eef2',
          scarf: '#f3eee4',
        },
        hat: { kind: 'beanie', color: '#d6f2ee', accent: '#f5efe3' },
        idle: 'lookout',
      },
    },
    lumi: {
      name: 'Lumi',
      walk: 1.2,
      spec: {
        height: H_LUMI,
        build: { limbs: 1.4, chest: 1.2, belly: 0.6, shoulders: 1.08, hips: 1.12, head: 1.02 },
        skin: '#ecc3a5',
        eyes: { iris: '#3a7c5a', size: 1.25 },
        hair: { style: 'braid', color: '#5b3a22', accent: '#e2483d' },
        brows: { color: '#4a2f1c' },
        nose: 'button',
        blush: 0.55,
        freckles: true,
        outfit: {
          top: { kind: 'parka', color: '#f6c619', accent: '#d69a0b', trim: '#fff2b8', collar: 'ruff', length: 0.3, rough: 0.7 },
          bottom: { kind: 'pants', color: '#eeb912', rough: 0.7 },
          shoes: { kind: 'boots', color: '#a52e2a', sole: '#22252a' },
          gloves: '#e2483d',
        },
        hat: { kind: 'beanie', color: '#e2483d', accent: '#f6f1e6' },
        idle: 'energetic',
      },
    },
    aki: {
      name: 'Aki',
      walk: 1.22,
      spec: {
        height: H_AKI,
        build: { limbs: 1.4, chest: 1.18, belly: 0.55, shoulders: 1.06, hips: 1.1, head: 1.0 },
        skin: '#d8a382',
        eyes: { iris: '#4a3421', size: 1.2 },
        hair: { style: 'short', color: '#2a1a12' },
        brows: { color: '#2a1a12', thickness: 1.1 },
        nose: 'button',
        blush: 0.4,
        freckles: true,
        outfit: {
          top: { kind: 'parka', color: '#d92f2f', accent: '#a52020', trim: '#ffc9c0', collar: 'ruff', length: 0.3, rough: 0.7 },
          bottom: { kind: 'pants', color: '#c22828', rough: 0.7 },
          shoes: { kind: 'boots', color: '#243b6b', sole: '#15171c' },
          gloves: '#243b6b',
          scarf: '#f6c619',
        },
        hat: { kind: 'beanie', color: '#243b6b', accent: '#f6f1e6' },
        idle: 'fidget',
      },
    },
  };

  const actors = new Map<string, Actor>();
  const humans: HumanoidActor[] = [];
  for (const [id, def] of Object.entries(specs)) {
    const a = new HumanoidActor({ id, name: def.name, spec: def.spec, walkSpeed: def.walk, sitsInVehicle: true });
    a.groundAt = groundAt;
    if (id === 'henrik') {
      a.attach(a.rig.head, goggles(a.rig.dims.headR), 'goggles');
      a.attach(a.rig.back, backpack(1), 'pack');
    }
    if (id === 'sana') {
      const tg = tablet();
      const m = a.attach(a.rig.handR, tg, 'tablet');
      m.position.set(-0.03, -0.045, 0.085);
      m.rotation.set(0.35, 0.5, 0.15);
      a.attach(a.rig.back, backpack(1), 'pack').scale.setScalar(0.85);
    }
    if (id === 'aki') {
      const m = a.attach(a.rig.back, backpack(1), 'pack');
      m.scale.setScalar(0.7);
    }
    actors.set(id, a);
    humans.push(a);
  }
  const dog = new PolarDogActor('nanuk', 'Nanuk');
  dog.groundAt = groundAt;
  actors.set('nanuk', dog);
  return { actors, humans, dog };
}

/** Expedition leader NPC (not part of the puzzle) holding a lantern. */
export function createLeader(groundAt: (x: number, z: number) => number): { actor: HumanoidActor; lantern: THREE.Mesh } {
  const spec: HumanoidSpec = {
    height: 1.82,
    build: { shoulders: 1.1, chest: 1.1, belly: 0.15, limbs: 1.1 },
    skin: '#b9825f',
    eyes: { iris: '#2c2118' },
    hair: { style: 'short', color: '#241a14' },
    brows: { color: '#241a14', thickness: 1.3 },
    beard: { style: 'short', color: '#2a1f18' },
    nose: 'long',
    outfit: {
      top: { kind: 'parka', color: '#1c3f74', accent: '#12294c', trim: '#dfe8f3', collar: 'fur', length: 0.28, rough: 0.75, glow: '#ffb35a' },
      bottom: { kind: 'pants', color: '#1f2530' },
      shoes: { kind: 'boots', color: '#25201c', sole: '#0f1013' },
      gloves: '#2c313a',
      belt: '#d9d2c0',
    },
    hat: { kind: 'cap', color: '#e6edf5', accent: '#1c3f74' },
    idle: 'stately',
  };
  const actor = new HumanoidActor({ id: 'leader', name: 'Expeditionsleiterin', spec, walkSpeed: 1.2 });
  actor.groundAt = groundAt;
  const lm = actor.attach(actor.rig.handL, lantern(), 'lantern');
  lm.position.set(0.0, -0.13, 0.03);
  lm.castShadow = false;
  return { actor, lantern: lm };
}
