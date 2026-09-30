import * as THREE from 'three/webgpu';
import { color, length, mix, mx_fractal_noise_float, positionWorld, smoothstep, cameraPosition, time, vec2, vec3, float } from 'three/tsl';
import type { LevelWorld, WorldBuildContext, WorldFactory } from '../../world/types';
import { applyEnvironment, createLightRig, createParticles, createSkyDome, setupFog } from '../../world/kit';
import type { CameraKeyframe } from '../../camera/CameraRig';
import type { WorldLook } from '../../render/PostFX';
import type { Actor } from '../../characters/Actor';
import { createHarborActors } from './actors';
import { createSkiff } from './vehicle';
import { Parts, fillInstances, glowUniformMat, propMaterial, windStrength } from './helpers';
import { ISLAND_A, ISLAND_B, alignIsland, islandParts, islandTopAt, type IslandSpec } from './islands';
import { buildPier } from './piers';
import { lathe, torus } from '../../characters/geo';
import { buildScenery, type Scenery } from './scenery';

const SUN_VISUAL = new THREE.Vector3(-0.42, 0.11, -0.9).normalize();
const FOG_COLOR = '#eaa87c';

const LOOK: WorldLook = {
  toneMapping: 'aces',
  exposure: 1.1,
  bloom: { strength: 0.55, radius: 0.6, threshold: 0.85 },
  ao: { radius: 0.5, intensity: 0.9 },
  vignette: 0.35,
  saturation: 1.1,
  gain: [1.06, 1.0, 0.94],
  lift: [0.012, 0.006, 0.0],
  contrast: 1.04,
};

function createCloudSea(): { base: THREE.Mesh; wisps: THREE.Mesh } {
  const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const P = positionWorld.xz;
  const t = time.mul(0.02);
  const drift = P.sub(vec2(t.mul(9), 0));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fbm = (p: any, z: number) => mx_fractal_noise_float(vec3(p.x, p.y, t.mul(z)), 4, 2.0, 0.5, 1.0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const height = (p: any) => fbm(p.mul(0.03), 0.6).mul(0.75).add(fbm(p.mul(0.11), 1.4).mul(0.3));
  const toLight = vec2(-0.75, 0.66).mul(1.5);
  const h0 = height(drift);
  const h1 = height(drift.add(toLight));
  const slope = h1.sub(h0).mul(2.6);
  const dens = h0.mul(0.55).add(0.5);
  let c = mix(color('#5b4c98'), color('#e5867e'), smoothstep(0.1, 0.5, dens));
  c = mix(c, color('#ffd9a4'), smoothstep(0.5, 0.9, dens));
  c = c.add(color('#ffc878').mul(slope.max(0).mul(0.9)));
  c = c.mul(float(1).sub(slope.min(0).abs().mul(0.45)));
  const dist = length(P.sub(cameraPosition.xz));
  c = mix(c, color(FOG_COLOR), smoothstep(200, 900, dist).mul(0.75));
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = c;
  const base = new THREE.Mesh(geo, m);
  base.position.y = -26;
  base.name = 'cloudSea';
  base.frustumCulled = false;

  const geo2 = new THREE.PlaneGeometry(1400, 1400, 1, 1);
  geo2.rotateX(-Math.PI / 2);
  const m2 = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const w1 = mx_fractal_noise_float(vec3(drift.x.mul(0.02).sub(t.mul(1.6)), drift.y.mul(0.045), t), 4, 2.0, 0.5, 1.0);
  const wisp = smoothstep(0.05, 0.6, w1);
  m2.colorNode = mix(color('#ffbf94'), color('#fff1d6'), smoothstep(0.2, 0.9, w1));
  m2.opacityNode = wisp.mul(0.6).mul(float(1).sub(smoothstep(200, 700, dist)));
  const wisps = new THREE.Mesh(geo2, m2);
  wisps.position.y = -19;
  wisps.frustumCulled = false;
  wisps.name = 'cloudWisps';
  return { base, wisps };
}

const factory: WorldFactory = async (ctx: WorldBuildContext): Promise<LevelWorld> => {
  const { quality, renderer } = ctx;
  const scene = new THREE.Scene();
  scene.name = 'world:harbor';
  const disposers: Array<() => void> = [];
  const geos: Array<{ dispose(): void }> = [];

  // ── sky, fog, environment, light ──
  const sky = createSkyDome({
    zenith: '#3b5ea8',
    horizon: '#ffb36b',
    ground: '#c98a70',
    sunDir: SUN_VISUAL,
    sunColor: '#ffd9a0',
    sunSize: 0.03,
    sunGlow: 0.8,
    clouds: { color: '#ffd7a8', shadow: '#c46f8f', coverage: 0.5, speed: 0.012, scale: 0.8, opacity: 0.7 },
    horizonGlow: { color: '#ff8f52', strength: 0.75, height: 0.24 },
    curve: 0.42,
  });
  scene.add(sky);
  setupFog(scene, { color: FOG_COLOR, density: 0.0034 });
  disposers.push(applyEnvironment(renderer, scene, sky, 0.7));
  const rig = createLightRig(scene, {
    hemiSky: '#9db8ee',
    hemiGround: '#d18e5c',
    hemiIntensity: 0.72,
    sunColor: '#ffc27a',
    sunIntensity: 3.2,
    sunDir: new THREE.Vector3(-0.62, 0.52, 0.55),
    shadowArea: 24,
    shadowCenter: new THREE.Vector3(0, 0, 0),
    fillColor: '#8aa8ff',
    fillIntensity: 0.6,
    fillDir: new THREE.Vector3(0.7, 0.35, 0.65),
    rimColor: '#ff9450',
    rimIntensity: 1.9,
    rimDir: SUN_VISUAL.clone(),
    quality,
  });
  void rig;

  // ── cloud sea ──
  const clouds = createCloudSea();
  scene.add(clouds.base, clouds.wisps);
  geos.push(clouds.base.geometry, clouds.wisps.geometry, clouds.base.material as THREE.Material, clouds.wisps.material as THREE.Material);

  // ── islands ──
  const worldMat = propMaterial();
  geos.push(worldMat);
  const addIsland = (spec: IslandSpec) => {
    const p = new Parts();
    islandParts(spec, p);
    const geo = p.build();
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, worldMat);
    mesh.position.set(spec.cx, spec.cy, spec.cz);
    mesh.receiveShadow = true;
    mesh.name = 'island';
    scene.add(mesh);
    return mesh;
  };
  alignIsland(ISLAND_A, -1);
  alignIsland(ISLAND_B, 1);
  addIsland(ISLAND_A);
  addIsland(ISLAND_B);

  // ── piers ──
  const pierA = buildPier(-1, 11);
  const pierB = buildPier(1, 23);
  for (const pr of [pierA, pierB]) {
    const geo = pr.parts.build();
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, worldMat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'pier';
    scene.add(mesh);
  }

  // instanced cargo + lantern glow
  const crateGeo = new THREE.BoxGeometry(0.8, 0.6, 0.8);
  const crateMat = propMaterial();
  const crateParts = new Parts()
    .add(new THREE.BoxGeometry(0.8, 0.6, 0.8), { color: '#9a6a3c', rough: 0.85 })
    .add(new THREE.BoxGeometry(0.84, 0.08, 0.84), { color: '#6a4426', rough: 0.85 }, { p: [0, 0.26, 0] })
    .add(new THREE.BoxGeometry(0.84, 0.08, 0.84), { color: '#6a4426', rough: 0.85 }, { p: [0, -0.26, 0] })
    .add(new THREE.BoxGeometry(0.1, 0.62, 0.84), { color: '#6a4426', rough: 0.85 }, { p: [0.36, 0, 0] })
    .add(new THREE.BoxGeometry(0.1, 0.62, 0.84), { color: '#6a4426', rough: 0.85 }, { p: [-0.36, 0, 0] })
    .add(new THREE.BoxGeometry(0.86, 0.1, 0.04), { color: '#e3b64f', rough: 0.3, metal: 1 }, { p: [0, 0, 0.42], r: [0, 0, 0.6] });
  const crateG = crateParts.build();
  geos.push(crateGeo, crateG, crateMat);
  const allCrates = [...pierA.crates, ...pierB.crates];
  const crateMesh = new THREE.InstancedMesh(crateG, crateMat, allCrates.length);
  fillInstances(crateMesh, allCrates.map((c) => ({ p: c.p, r: [0, c.r, 0], s: c.s })));
  crateMesh.castShadow = true;
  crateMesh.receiveShadow = true;
  scene.add(crateMesh);

  // barrels
  const barrelParts = new Parts()
    .add(lathe([[0.28, -0.38], [0.35, -0.2], [0.38, 0.0], [0.35, 0.2], [0.28, 0.38]], 16, 14), { color: '#94623a', rough: 0.85 })
    .add(torus(0.36, 0.022, Math.PI * 2, 16, 4), { color: '#d9b04a', rough: 0.3, metal: 1 }, { p: [0, 0.22, 0], r: [Math.PI / 2, 0, 0] })
    .add(torus(0.36, 0.022, Math.PI * 2, 16, 4), { color: '#d9b04a', rough: 0.3, metal: 1 }, { p: [0, -0.22, 0], r: [Math.PI / 2, 0, 0] })
    .add(torus(0.39, 0.02, Math.PI * 2, 16, 4), { color: '#5a3a22', rough: 0.8 }, { p: [0, 0.0, 0], r: [Math.PI / 2, 0, 0] });
  const barrelG = barrelParts.build();
  geos.push(barrelG);
  const allBarrels = [...pierA.barrels, ...pierB.barrels];
  const barrelMesh = new THREE.InstancedMesh(barrelG, worldMat, allBarrels.length);
  fillInstances(barrelMesh, allBarrels.map((b) => ({ p: b.p, r: [0, b.r, 0] as [number, number, number], s: b.s })));
  barrelMesh.castShadow = true;
  barrelMesh.receiveShadow = true;
  scene.add(barrelMesh);

  const lampGlow = glowUniformMat('#ffc060', 3.2);
  geos.push(lampGlow.material);
  const lamps = [...pierA.lanterns, ...pierB.lanterns];
  const lampGeo = new THREE.SphereGeometry(0.15, 10, 8);
  geos.push(lampGeo);
  const lampMesh = new THREE.InstancedMesh(lampGeo, lampGlow.material, lamps.length);
  fillInstances(lampMesh, lamps.map((l) => ({ p: [l.x, l.y, l.z] as [number, number, number], s: [1, 1.4, 1] as [number, number, number] })));
  scene.add(lampMesh);
  // dock point lights (budgeted)
  const lights: THREE.PointLight[] = [];
  const lightSpots = [pierA.lanterns[0]!, pierB.lanterns[0]!, pierA.lanterns[1]!, pierB.lanterns[1]!, pierA.lanterns[2]!, pierB.lanterns[2]!];
  for (let i = 0; i < Math.min(quality.localLights, lightSpots.length); i++) {
    const l = new THREE.PointLight('#ffb45c', 22, 13, 2);
    l.position.copy(lightSpots[i]!).add(new THREE.Vector3(0, -0.2, 0));
    scene.add(l);
    lights.push(l);
  }

  // ── scenery (temples, airships, statue, birds, ...) ──
  const scenery: Scenery = await buildScenery(scene, quality, worldMat);

  // ── particles ──
  const wind = createParticles({ count: 220, min: [-44, -6, -34], max: [44, 18, 18], color: '#fff0d0', size: 0.075, motion: 'rise', speed: 0.02, wind: [7, 0.4], opacity: 0.55, stretch: 0.09, quality });
  scene.add(wind);
  const sparkles = createParticles({ count: 130, min: [-16, 0.5, -8], max: [16, 8, 8], color: '#ffe6a0', color2: '#fff8e0', size: 0.11, motion: 'float', speed: 0.6, twinkle: 1, opacity: 0.9, quality });
  scene.add(sparkles);
  const motes = createParticles({ count: 90, min: [-30, -4, -20], max: [30, 12, 6], color: '#ffb87a', color2: '#ffd9a0', size: 0.2, motion: 'rise', speed: 0.5, wind: [1.2, 0.3], opacity: 0.35, quality });
  scene.add(motes);

  // ── vehicle ──
  const skiff = createSkiff({ lowDetail: quality.level === 'low' });
  scene.add(skiff.rig.root);

  // ── actors ──
  const humanoids = createHarborActors();
  const actors = new Map<string, Actor>();
  const groundAt = (x: number, z: number): number => {
    void z;
    return Math.abs(x) >= 6.0 ? 0.5 : 0.3;
  };
  const slotsFor = (side: 1 | -1): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    const cols = [7.7, 9.5, 11.3, 13.1];
    cols.forEach((cx, i) => {
      out.push(new THREE.Vector3(side * (cx + (i % 2) * 0.2), 0.5, 1.05));
      out.push(new THREE.Vector3(side * (cx + 0.45), 0.5, -1.05));
    });
    return out;
  };
  const slots0 = slotsFor(-1);
  const slots1 = slotsFor(1);
  const facing0 = new THREE.Vector3(0, 0.8, 0);
  const banks: LevelWorld['banks'] = [
    { slots: slots0, dockPoint: new THREE.Vector3(-5.9, 0.5, 0), facing: facing0 },
    { slots: slots1, dockPoint: new THREE.Vector3(5.9, 0.5, 0), facing: facing0 },
  ];
  let idx = 0;
  for (const [id, a] of humanoids) {
    a.groundAt = groundAt;
    a.root.position.copy(slots0[idx]!);
    a.faceTowards(facing0);
    a.snapYaw();
    scene.add(a.root);
    actors.set(id, a);
    idx++;
  }

  const intro: CameraKeyframe[] = [
    { position: new THREE.Vector3(-34, 20, 58), target: new THREE.Vector3(-6, 8, -46), duration: 0 },
    { position: new THREE.Vector3(-24, 7, 22), target: new THREE.Vector3(-13, 3.5, -4), duration: 2.3 },
    { position: new THREE.Vector3(6, 4.2, 15), target: new THREE.Vector3(0, 1.2, 0), duration: 2.3 },
    { position: new THREE.Vector3(0, 14.3, 21), target: new THREE.Vector3(0, 0.8, 0), duration: 2.3 },
  ];

  let elapsed = 0;
  const world: LevelWorld = {
    scene,
    look: LOOK,
    banks,
    vehicle: skiff.rig,
    actors,
    camera: {
      home: { target: new THREE.Vector3(0, 0.8, 0), radius: 25, polar: 1.0, azimuth: 0 },
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
      intro,
    },
    groundAt,
    music: 'harbor',
    ambience: 'harbor',
    seated: true,
    update(dt: number, t: number, camera: THREE.PerspectiveCamera) {
      elapsed = t;
      windStrength.value = 1 + Math.sin(t * 0.23) * 0.25 + Math.sin(t * 0.61) * 0.15;
      const flick = 1 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 11.1 + 2) * 0.03;
      lampGlow.k.value = flick;
      lights.forEach((l, i) => {
        l.intensity = 22 * (1 + Math.sin(t * 6.1 + i * 1.7) * 0.05 + Math.sin(t * 9.7 + i) * 0.03);
      });
      scenery.update(dt, t, camera);
    },
    dispose() {
      scenery.dispose();
      for (const a of actors.values()) a.dispose();
      actors.clear();
      skiff.dispose();
      scene.traverse((o) => {
        const anyO = o as THREE.Mesh;
        if (anyO.isMesh) {
          anyO.geometry.dispose();
        }
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      for (const g of geos) g.dispose();
      for (const d of disposers) d();
      scene.clear();
      void elapsed;
    },
  };
  void islandTopAt;
  return world;
};

export default factory;
