import * as THREE from 'three/webgpu';
import type { LevelWorld, WorldFactory } from '../../world/types';
import type { Actor } from '../../characters/Actor';
import { applyEnvironment, createLightRig, createSkyDome, createWater, setupFog } from '../../world/kit';
import { Bin } from './util';
import { buildTerrain, buildQuay, terrainHeight } from './terrain';
import { createBarge } from './vehicle';
import { createChaos, createGuardian } from './actors';
import { buildRuins, buildStatues, buildTorches, type Module } from './structures';
import { buildAtmosphere, buildBridges, buildCrystals, buildFalls, buildFoliage, buildLotus, buildVines } from './nature';
import { buildCreatures, buildKoi, buildSpirit, buildStorm } from './life';
import { buildDetail } from './detail';

/** Vine anchors: x, y, z, hanging length. */
const VINES: Array<[number, number, number, number]> = [
  [-22, 8.6, -12, 5], [-22, 8.4, -14.6, 4.5], [-16, 8.4, -30, 5], [-16, 8.6, -32.5, 5],
  [-12, 4.4, -24.8, 3.6], [-6, 3.9, -24.8, 3.2], [6, 3.9, -24.8, 3.2], [12, 4.4, -24.8, 3.6],
  [-4.5, 14.8, -45.5, 8], [0, 14.6, -45.5, 9], [4.5, 14.8, -45.5, 8], [-9.5, 14.8, -45.5, 8], [9.5, 14.8, -45.5, 8],
  [-10.4, 8.6, -17, 3.4], [10.4, 8.6, -17, 3.4], [-14.2, 7.4, -18, 5], [14.4, 7.4, -18, 4], [-14.2, 7.4, -32, 5.5],
  [14.4, 7.4, -25, 4], [-19.5, 7.4, -22, 5], [19.5, 7.4, -22, 4.5], [-14.2, 7.4, -46, 5], [14.4, 7.4, -39, 4.5],
  [16.6, 6.4, 5.2, 4], [16.6, 6.4, 8.0, 4], [-27, 9.5, -24, 6], [27, 9.5, -24, 6],
];

const factory: WorldFactory = async (ctx) => {
  const { quality, renderer } = ctx;
  const bin = new Bin();
  const scene = new THREE.Scene();

  // ── sky, light, fog ──
  const sky = createSkyDome({
    zenith: '#2b2f55',
    horizon: '#e8875a',
    ground: '#3a2a3a',
    sunDir: new THREE.Vector3(0.2, 0.14, -1),
    sunColor: '#ffb27a',
    sunSize: 0.05,
    sunGlow: 1.2,
    stars: 0.3,
    clouds: { color: '#6a5878', shadow: '#2a2540', coverage: 0.6, speed: 0.01, scale: 0.9, opacity: 0.85 },
    horizonGlow: { color: '#ff8a5a', strength: 0.6, height: 0.2 },
  });
  scene.add(sky);
  const disposeEnv = applyEnvironment(renderer, scene, sky, 0.6);
  setupFog(scene, { color: '#5d6d86', density: 0.0085, heightDensity: 0.008, height: 2.4 });
  const lights = createLightRig(scene, {
    hemiSky: '#84a8c4',
    hemiGround: '#2d4038',
    hemiIntensity: 0.7,
    sunColor: '#ffae70',
    sunIntensity: 2.1,
    sunDir: new THREE.Vector3(-0.75, 0.32, 0.55),
    shadowArea: 24,
    fillColor: '#3fd0c0',
    fillIntensity: 0.85,
    fillDir: new THREE.Vector3(0.7, 0.3, 0.5),
    rimColor: '#c04ab8',
    rimIntensity: 0.5,
    rimDir: new THREE.Vector3(0.2, 0.5, -1),
    quality,
  });

  // ── ground & water ──
  scene.add(buildTerrain(bin), buildQuay(bin));
  const water = createWater({
    width: 12.2,
    length: 160,
    position: new THREE.Vector3(0, 0, -45),
    shallow: '#32c4a0',
    deep: '#09323e',
    foam: '#e9fff6',
    sky: '#8fb0c8',
    flow: [0, 0.22],
    waveAmp: 0.035,
    waveLen: 4,
    roughness: 0.06,
    depthFade: 2.4,
    foamWidth: 0.4,
    refraction: 0.02,
    normalStrength: 0.4,
    minOpacity: 0.7,
    glow: '#1aa89a',
    glowStrength: 0.25,
    quality,
  });
  scene.add(water);

  // ── vehicle ──
  const barge = createBarge(quality, 0);
  scene.add(barge.rig.root);
  barge.rig.root.position.copy(barge.rig.docks[0]);
  barge.rig.root.rotation.y = barge.rig.yaw[0];

  // ── banks & actors ──
  const slot = (s: number) => {
    const rows: Array<[number, number]> = [[8.6, -3.6], [8.6, -1.2], [8.6, 1.2], [8.6, 3.6], [10.9, -2.4], [10.9, 0], [10.9, 2.4], [10.9, 4.8]];
    return rows.map(([x, z]) => new THREE.Vector3(s * x, 0.5, z));
  };
  const banks: LevelWorld['banks'] = [
    { slots: slot(-1), dockPoint: new THREE.Vector3(-6.3, 0.5, 0), facing: new THREE.Vector3(0, 0.5, 0) },
    { slots: slot(1), dockPoint: new THREE.Vector3(6.3, 0.5, 0), facing: new THREE.Vector3(0, 0.5, 0) },
  ];
  const groundAt = (x: number, z: number) => terrainHeight(x, z);
  const actors = new Map<string, Actor>();
  const cast: Array<[string, string, boolean]> = [
    ['guardian1', 'Arun', true],
    ['guardian2', 'Sela', true],
    ['guardian3', 'Kiran', true],
    ['chaos1', 'Zikk', false],
    ['chaos2', 'Mok', false],
    ['chaos3', 'Pell', false],
  ];
  // interleave guardians and imps on the front/back rows so the bank looks lived in
  const order = [0, 4, 1, 5, 2, 6];
  cast.forEach(([id, name, isGuardian], i) => {
    const a = isGuardian ? createGuardian(id, name) : createChaos(id, name);
    a.groundAt = groundAt;
    scene.add(a.root);
    const p = banks[0].slots[order[i]! % banks[0].slots.length]!;
    a.root.position.copy(p);
    a.faceTowards(banks[0].facing);
    a.snapYaw();
    actors.set(id, a);
  });

  // ── environment modules ──
  const storm = buildStorm(bin);
  const modules: Module[] = [
    buildRuins(bin, quality),
    buildDetail(bin, quality),
    buildStatues(bin, quality),
    buildTorches(bin, quality),
    buildBridges(bin, quality),
    buildFoliage(bin, quality),
    buildVines(bin, VINES, quality),
    buildCrystals(bin, crystalSpots()),
    buildLotus(bin, quality),
    buildFalls(bin, quality),
    buildAtmosphere(bin, quality),
    buildKoi(bin, quality),
    buildSpirit(bin, quality),
    buildCreatures(bin, quality),
    storm,
  ];
  for (const m of modules) scene.add(m.obj);
  const baseHemi = lights.hemi.intensity;
  const baseRim = lights.rim?.intensity ?? 0;

  const world: LevelWorld = {
    scene,
    look: { toneMapping: 'aces', exposure: 1.0, bloom: { strength: 0.7, radius: 0.55, threshold: 0.8 }, ao: { radius: 0.6, intensity: 1 }, vignette: 0.5, saturation: 1.05, gain: [1.02, 0.98, 1.02], lift: [0.01, 0.0, 0.02], contrast: 1.08 },
    banks,
    vehicle: barge.rig,
    actors,
    camera: {
      home: { target: new THREE.Vector3(0, 0.5, 0), radius: 25, polar: 1.0, azimuth: 0 },
      limits: { minRadius: 10, maxRadius: 42, minPolar: 0.45, maxPolar: 1.35, minAzimuth: -1.1, maxAzimuth: 1.1, targetMin: new THREE.Vector3(-12, -2, -12), targetMax: new THREE.Vector3(12, 6, 12) },
      intro: [
        { position: new THREE.Vector3(-26, 9, 34), target: new THREE.Vector3(-2, 3, -14), duration: 0 },
        { position: new THREE.Vector3(-14, 6, 18), target: new THREE.Vector3(0, 4, -20), duration: 2.4 },
        { position: new THREE.Vector3(14, 8, 20), target: new THREE.Vector3(0, 1.5, -6), duration: 2.4 },
        { position: new THREE.Vector3(0, 14, 21), target: new THREE.Vector3(0, 0.5, 0), duration: 2.4 },
      ],
    },
    groundAt,
    music: 'temple',
    ambience: 'temple',
    seated: true,
    update(dt, t, camera) {
      for (const m of modules) m.update?.(dt, t, camera);
      const f = storm.flash.value;
      lights.hemi.intensity = baseHemi + f * 1.5;
      if (lights.rim) lights.rim.intensity = baseRim + f * 2.4;
      scene.environmentIntensity = 0.6 + f * 0.9;
    },
    onViolation() {
      storm.strikeNow();
    },
    onWin() {
      storm.strikeNow();
    },
    dispose() {
      for (const a of actors.values()) a.dispose();
      actors.clear();
      barge.dispose();
      disposeEnv();
      lights.sun.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (o as THREE.Sprite).isSprite) {
          const mm = (mesh.material ?? null) as THREE.Material | THREE.Material[] | null;
          if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
          else mm?.dispose();
          if (mesh.geometry) mesh.geometry.dispose();
        }
      });
      water.geometry.dispose();
      scene.clear();
      bin.dispose();
    },
  };
  return world;
};

function crystalSpots(): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  // glowing crystals on the river bed (seen through the jade water)
  for (let i = 0; i < 12; i++) {
    const z = -38 + i * 4.2;
    const s = i % 2 ? 1 : -1;
    out.push([s * (3.3 + (i % 3) * 0.5), -2.45, z, 0.9 + (i % 3) * 0.3]);
  }
  const bank: Array<[number, number, number]> = [
    [-13.2, 12, 1.1], [13.4, 11.5, 1.0], [-13, -14.2, 1.3], [13.2, -14.6, 1.2], [-11.6, -19.5, 1.5], [11.8, -19.8, 1.4],
    [-17.5, 2.5, 1.0], [17.5, -3, 1.2], [-20, -9, 1.4], [19, 13, 1.1], [-28.5, -22, 1.8], [28.5, -36, 2.0], [-30, -52, 1.6], [7, -50, 1.4], [-7, -51, 1.4],
    [-9.5, 7.5, 0.7], [9.5, -7.5, 0.7], [-8.2, -13.8, 0.8], [8.4, 14, 0.8],
  ];
  for (const [x, z, s] of bank) out.push([x, terrainHeight(x, z) - 0.05, z, s]);
  return out;
}

export default factory;
