import * as THREE from 'three/webgpu';
import type { WorldFactory, LevelWorld, BankLayout } from '../../world/types';
import type { Actor } from '../../characters/Actor';
import type { CameraKeyframe } from '../../camera/CameraRig';
import { applyEnvironment, createLightRig, createSkyDome, createWater, setupFog } from '../../world/kit';
import { Bin, type BuildCtx, type Part } from './common';
import { BANK_Y, DECK_Y, DECK_Z, FALL_LIFT, buildRidges, buildTerrain, groundAt } from './terrain';
import { CabbageActor, createGoat, createWolf } from './quad';
import { createMira } from './keeper';
import { createBoat } from './boat';
import { buildFlora } from './flora';
import { buildProps } from './props';
import { buildLife } from './life';

/** Direction the sunlight comes FROM: low morning sun from the back-left. */
const SUN = new THREE.Vector3(-0.657, 0.477, -0.583);

const factory: WorldFactory = async (ctx): Promise<LevelWorld> => {
  const { quality, renderer } = ctx;
  const scene = new THREE.Scene();
  scene.name = 'forest';
  const bin = new Bin();
  const lights = { left: quality.localLights };
  const bc: BuildCtx = { scene, quality, bin, lights, sun: SUN.clone() };
  const parts: Part[] = [];

  // ── sky, environment, fog, lights ──
  const sky = createSkyDome({
    zenith: '#6f9fd6',
    horizon: '#f6d7a8',
    ground: '#c2b58a',
    sunDir: SUN.clone(),
    sunColor: '#ffe2ae',
    sunSize: 0.04,
    sunGlow: 1.15,
    clouds: { color: '#fff4e2', shadow: '#dcb9a4', coverage: 0.42, speed: 0.004, scale: 0.8, opacity: 0.8 },
    horizonGlow: { color: '#ffd7a0', strength: 0.35, height: 0.22 },
  });
  scene.add(sky);
  bin.add(sky.geometry);
  bin.add(sky.material as THREE.Material);
  const disposeEnv = applyEnvironment(renderer, scene, sky, 0.45);
  setupFog(scene, { color: '#9fb07a', density: 0.004, heightDensity: 0.006, height: 1.2 });
  createLightRig(scene, {
    hemiSky: '#bcd4ef',
    hemiGround: '#5f7a3c',
    hemiIntensity: 0.5,
    sunColor: '#ffd9a0',
    sunIntensity: 2.7,
    sunDir: SUN.clone(),
    shadowArea: 34,
    shadowCenter: new THREE.Vector3(0, 0, -6),
    fillColor: '#9dbfee',
    fillIntensity: 0.55,
    fillDir: new THREE.Vector3(0.35, 0.55, 1),
    rimColor: '#ffb070',
    rimIntensity: 0.7,
    rimDir: new THREE.Vector3(-0.3, 0.35, -1),
    quality,
  });

  // ── terrain & water ──
  const terrain = buildTerrain();
  scene.add(terrain);
  scene.add(buildRidges());
  const water = createWater({
    width: 14.6,
    length: 115.3,
    position: new THREE.Vector3(0, 0, 17.35),
    shallow: '#49c4ae',
    deep: '#0f5560',
    foam: '#f4f8f2',
    sky: '#cfe2ea',
    flow: [0, 0.55],
    waveAmp: 0.035,
    waveLen: 3.2,
    roughness: 0.06,
    depthFade: 2.2,
    foamWidth: 0.3,
    refraction: 0.03,
    normalStrength: 0.42,
    minOpacity: 0.62,
    quality,
  });
  water.renderOrder = 1;
  scene.add(water);
  // upstream pool above the waterfalls
  const upWater = createWater({
    width: 14.6,
    length: 80.3,
    position: new THREE.Vector3(0, FALL_LIFT, -80.85),
    shallow: '#4fc9b2',
    deep: '#125c66',
    foam: '#f4f8f2',
    sky: '#cfe2ea',
    flow: [0, 0.7],
    waveAmp: 0.025,
    roughness: 0.06,
    depthFade: 2.0,
    minOpacity: 0.62,
    quality,
  });
  upWater.renderOrder = 1;
  scene.add(upWater);

  // the boat lantern gets the first dynamic light of the budget
  const boatLit = lights.left > 0;
  if (boatLit) lights.left--;

  // ── environment parts ──
  const flora = buildFlora(bc);
  parts.push(flora);
  const props = buildProps(bc);
  parts.push(props);

  // ── vehicle ──
  const boat = createBoat(bin, { lights: boatLit ? 1 : 0 });
  scene.add(boat.rig.root);
  boat.rig.root.position.copy(boat.rig.docks[0]);
  boat.rig.root.rotation.y = boat.rig.yaw[0];

  // ── banks ──
  const face = new THREE.Vector3(0, BANK_Y, 0);
  const mk = (sx: 1 | -1): BankLayout => {
    const raw: Array<[number, number]> = [[8.3, 3.9], [9.5, 2.5], [10.1, 0.5], [9.7, -1.4], [8.6, -3.0], [11.3, 1.8], [11.2, -1.0]];
    return {
      slots: raw.map(([x, z]) => new THREE.Vector3(sx * x, groundAt(sx * x, z), z)),
      dockPoint: new THREE.Vector3(sx * 4.75, DECK_Y, DECK_Z),
      facing: face.clone(),
    };
  };
  const banks: [BankLayout, BankLayout] = [mk(-1), mk(1)];

  // ── actors ──
  const actors = new Map<string, Actor>();
  const keeper = createMira();
  const wolf = createWolf();
  const goat = createGoat();
  const cabbage = new CabbageActor();
  actors.set('keeper', keeper);
  actors.set('wolf', wolf);
  actors.set('goat', goat);
  actors.set('cabbage', cabbage);
  for (const a of actors.values()) a.groundAt = groundAt;
  scene.add(wolf.root, goat.root, cabbage.root);
  const startSlots = [banks[0].slots[0]!, banks[0].slots[2]!, banks[0].slots[4]!];
  [wolf, goat, cabbage].forEach((a, i) => {
    a.root.position.copy(startSlots[i]!);
    a.faceTowards(banks[0].facing);
    a.snapYaw();
  });
  boat.rig.seats[0]!.add(keeper.root);
  keeper.root.position.set(0, 0, 0);
  keeper.mood = 'sit';
  keeper.yawGoal = 0;
  keeper.snapYaw();

  const life = buildLife(bc, { boat: boat.rig.root, groundAt });
  parts.push(life);

  // ── camera ──
  const home = { target: new THREE.Vector3(0, 0.5, 0), radius: 24, polar: 1.0, azimuth: 0 };
  const homePos = new THREE.Vector3(0, 0.5 + 24 * Math.cos(1.0), 24 * Math.sin(1.0));
  const intro: CameraKeyframe[] = [
    { position: new THREE.Vector3(-5, 36, -66), target: new THREE.Vector3(0, 6, -20), duration: 0 },
    { position: new THREE.Vector3(3, 23, -36), target: new THREE.Vector3(0, 2, -6), duration: 2.6 },
    { position: new THREE.Vector3(-8, 15, 2), target: new THREE.Vector3(0, 1, -1), duration: 2.3 },
    { position: homePos, target: home.target.clone(), duration: 2.2 },
  ];

  let lastVehicleT = -10;
  const vUpdate = boat.rig.update.bind(boat.rig);
  boat.rig.update = (dt, t, moving): void => {
    lastVehicleT = t;
    vUpdate(dt, t, moving);
  };

  const world: LevelWorld = {
    scene,
    look: {
      toneMapping: 'aces',
      exposure: 0.88,
      bloom: { strength: 0.45, radius: 0.5, threshold: 0.9 },
      ao: { radius: 0.5, intensity: 0.9 },
      vignette: 0.4,
      saturation: 1.38,
      gain: [1.04, 1.0, 0.94],
      lift: [0.01, 0.008, 0.0],
      contrast: 1.2,
    },
    banks,
    vehicle: boat.rig,
    actors,
    camera: {
      home,
      limits: {
        minRadius: 10,
        maxRadius: 40,
        minPolar: 0.45,
        maxPolar: 1.35,
        minAzimuth: -1.1,
        maxAzimuth: 1.1,
        targetMin: new THREE.Vector3(-12, -2, -12),
        targetMax: new THREE.Vector3(12, 6, 12),
      },
      intro,
    },
    groundAt,
    music: 'forest',
    ambience: 'forest',
    seated: true,
    update(dt, t, camera): void {
      if (t - lastVehicleT > 0.25) boat.rig.update(dt, t, 0);
      boat.tick(t);
      for (const p of parts) p.update?.(dt, t, camera);
    },
    dispose(): void {
      for (const a of actors.values()) a.dispose();
      for (const p of parts) p.dispose?.();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
        else mt?.dispose();
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) im.dispose();
      });
      bin.dispose();
      disposeEnv();
      scene.environment = null;
      scene.clear();
    },
  };
  return world;
};

export default factory;
