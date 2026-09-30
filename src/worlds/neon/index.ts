import * as THREE from 'three/webgpu';
import type { BankLayout, LevelWorld, WorldBuildContext, WorldFactory } from '../../world/types';
import { applyEnvironment, createLightRig, createSkyDome, setupFog } from '../../world/kit';
import type { WorldLook } from '../../render/PostFX';
import type { Actor } from '../../characters/Actor';
import { createEnv, disposeTree, QUAY_Y, CANAL_HALF } from './env';
import { buildTerrain, groundAt } from './terrain';
import { buildCity } from './city';
import { buildAtmosphere } from './fx';
import { buildVehicle } from './vehicle';
import { buildSigns } from './signs';
import { buildBridge } from './bridge';
import { buildTraffic } from './traffic';
import { buildProps } from './props';
import { createCouriers } from './actors';

const LOOK: WorldLook = {
  toneMapping: 'agx',
  exposure: 1.15,
  bloom: { strength: 0.9, radius: 0.6, threshold: 0.75 },
  ao: { radius: 0.4, intensity: 0.8 },
  vignette: 0.5,
  saturation: 1.15,
  gain: [1, 0.98, 1.06],
  lift: [0.005, 0.0, 0.02],
  contrast: 1.1,
};

function bank(side: 0 | 1): BankLayout {
  const s = side === 0 ? -1 : 1;
  const zs = [-3.7, -2.2, -0.7, 0.9, 2.4, 3.9];
  const slots = zs.map((z, i) => new THREE.Vector3(s * (i % 2 ? 9.4 : 8.3), QUAY_Y, z));
  return {
    slots,
    dockPoint: new THREE.Vector3(s * (CANAL_HALF + 0.55), QUAY_Y, 0),
    facing: new THREE.Vector3(0, QUAY_Y, 0),
  };
}

const factory: WorldFactory = async (ctx: WorldBuildContext): Promise<LevelWorld> => {
  const { quality, renderer } = ctx;
  const scene = new THREE.Scene();
  const env = createEnv(scene, quality);

  // ───────── sky, fog, image-based light ─────────
  const sky = createSkyDome({
    zenith: '#05060f',
    horizon: '#2a1640',
    ground: '#0a0714',
    stars: 0.5,
    horizonGlow: { color: '#c0208a', strength: 0.55, height: 0.22 },
    curve: 0.45,
  });
  scene.add(sky);
  let disposeEnv: (() => void) | null = null;
  try {
    disposeEnv = applyEnvironment(renderer, scene, sky, 0.55);
  } catch (e) {
    console.warn('[neon] environment bake failed', e);
  }
  setupFog(scene, { color: '#1a1030', density: 0.0062, heightDensity: 0.03, height: 1.6 });

  // ───────── lights ─────────
  createLightRig(scene, {
    hemiSky: '#2a3c78',
    hemiGround: '#1c0e30',
    hemiIntensity: 0.42,
    sunColor: '#86a6ff',
    sunIntensity: 0.9,
    sunDir: new THREE.Vector3(-0.35, 0.85, 0.45),
    shadowArea: 13,
    shadowCenter: new THREE.Vector3(0, 0, 0),
    fillColor: '#ff3fb8',
    fillIntensity: 0.38,
    fillDir: new THREE.Vector3(-1, 0.35, 0.5),
    rimColor: '#22e4ff',
    rimIntensity: 0.75,
    rimDir: new THREE.Vector3(0.9, 0.5, -0.8),
    quality,
  });

  // ───────── world features ─────────
  const vehicle = buildVehicle(env); // first: gets the local-light budget
  buildTerrain(env);
  const { heroes } = buildCity(env);
  buildSigns(env, heroes);
  buildBridge(env);
  buildTraffic(env);
  buildProps(env);
  buildAtmosphere(env);

  // ───────── actors ─────────
  const actors: Map<string, Actor> = createCouriers();
  const banks: [BankLayout, BankLayout] = [bank(0), bank(1)];
  let ai = 0;
  for (const a of actors.values()) {
    a.groundAt = groundAt;
    const slot = banks[0].slots[ai % banks[0].slots.length]!;
    a.root.position.copy(slot);
    a.faceTowards(banks[0].facing);
    a.snapYaw();
    scene.add(a.root);
    ai++;
  }

  // ───────── camera ─────────
  const home = { target: new THREE.Vector3(0, 0.6, 0), radius: 24, polar: 1.02, azimuth: 0 };
  const camera: LevelWorld['camera'] = {
    home,
    limits: {
      minRadius: 10,
      maxRadius: 42,
      minPolar: 0.45,
      maxPolar: 1.35,
      minAzimuth: -1.1,
      maxAzimuth: 1.1,
      targetMin: new THREE.Vector3(-12, -2, -12),
      targetMax: new THREE.Vector3(12, 6, 12),
    },
    intro: [
      { position: new THREE.Vector3(-30, 22, 30), target: new THREE.Vector3(0, 5, -14), duration: 0 },
      { position: new THREE.Vector3(18, 6, 16), target: new THREE.Vector3(0, 4, -10), duration: 2.4 },
      { position: new THREE.Vector3(-11, 3.2, 12), target: new THREE.Vector3(-1, 1.2, 0), duration: 2.3 },
      { position: new THREE.Vector3(0, 13.2, 20.5), target: new THREE.Vector3(0, 0.6, 0), duration: 2.4 },
    ],
  };

  const world: LevelWorld = {
    scene,
    look: LOOK,
    banks,
    vehicle,
    actors,
    camera,
    groundAt,
    music: 'neon',
    ambience: 'neon',
    seated: false,
    update(dt, t, cam) {
      for (const u of env.updaters) u(dt, t, cam);
    },
    dispose() {
      for (const a of actors.values()) a.dispose();
      actors.clear();
      disposeTree(env.root);
      disposeTree(sky);
      scene.remove(sky, env.root);
      disposeEnv?.();
      scene.environment = null;
    },
  };
  return world;
};

export default factory;
