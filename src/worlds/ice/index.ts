import * as THREE from 'three/webgpu';
import type { BankLayout, LevelWorld, WorldBuildContext, WorldFactory } from '../../world/types';
import { applyEnvironment, createLightRig, createParticles, createSkyDome, setupFog } from '../../world/kit';
import type { WorldLook } from '../../render/PostFX';
import { createAurora } from './aurora';
import { createBackdrop } from './backdrop';
import { createCamp } from './camp';
import { createCast, createLeader } from './cast';
import { PLATFORM_Y, createDisposer, groundHeight, type WorldCtx } from './common';
import { createFerry } from './ferry';
import { createHalos } from './fx';
import { createAuroraSpill, createDrifts, createFootprints, createGround } from './ground';
import { createDockworks, createDrones, createRobot } from './npcs';
import { createStation } from './station';

const LOOK: WorldLook = {
  toneMapping: 'agx',
  exposure: 1.1,
  bloom: { strength: 0.7, radius: 0.65, threshold: 0.8 },
  ao: { radius: 0.5, intensity: 0.85 },
  vignette: 0.45,
  saturation: 1.05,
  gain: [0.96, 1.0, 1.06],
  lift: [0.0, 0.006, 0.016],
  contrast: 1.06,
};

const MOON_DIR = new THREE.Vector3(-0.42, 0.52, -0.74).normalize();

function slotsFor(side: 0 | 1): THREE.Vector3[] {
  const s = side === 0 ? -1 : 1;
  const xa = side === 0 ? 7.5 : 7.4;
  const xb = side === 0 ? 9.1 : 8.95;
  const rowA = [-3.5, -1.2, 1.1, 3.4];
  const rowB = [-2.35, 0.0, 2.3, 4.6];
  const out: THREE.Vector3[] = [];
  for (const z of rowA) out.push(new THREE.Vector3(s * xa, groundHeight(s * xa, z), z));
  for (const z of rowB) out.push(new THREE.Vector3(s * xb, groundHeight(s * xb, z), z));
  return out;
}

const factory: WorldFactory = async (bctx: WorldBuildContext): Promise<LevelWorld> => {
  const { quality, renderer } = bctx;
  const scene = new THREE.Scene();
  const disposer = createDisposer();
  const ctx: WorldCtx = { quality, renderer, scene, dispose: disposer };

  // ── sky, environment, fog ──
  const sky = createSkyDome({
    zenith: '#03081a',
    horizon: '#16304f',
    ground: '#0a1628',
    sunDir: MOON_DIR,
    sunColor: '#dbe9ff',
    sunSize: 0.024,
    sunGlow: 0.55,
    stars: 0.8,
    horizonGlow: { color: '#1c7a6a', strength: 0.3, height: 0.2 },
    curve: 0.55,
  });
  scene.add(sky);
  disposer.add(sky.geometry);
  disposer.add(sky.material as THREE.Material);
  const disposeEnv = applyEnvironment(renderer, scene, sky, 0.6);
  setupFog(scene, { color: '#12294a', density: 0.0034, heightDensity: 0.0095, height: 3.2 });

  // ── lights ──
  const rig = createLightRig(scene, {
    hemiSky: '#24447a',
    hemiGround: '#0b1526',
    hemiIntensity: 0.85,
    sunColor: '#b8d3ff',
    sunIntensity: 1.35,
    sunDir: MOON_DIR,
    shadowArea: 24,
    shadowCenter: new THREE.Vector3(0, 0, 0),
    fillColor: '#35ffb0',
    fillIntensity: 0.42,
    fillDir: new THREE.Vector3(0.25, 1, -0.5),
    rimColor: '#8062ff',
    rimIntensity: 0.5,
    rimDir: new THREE.Vector3(0.7, 0.35, -0.7),
    quality,
  });

  const budget = quality.localLights;
  const localLights: THREE.PointLight[] = [];
  const addLight = (col: string, intensity: number, dist: number, pos: THREE.Vector3): THREE.PointLight | null => {
    if (localLights.length >= budget) return null;
    const l = new THREE.PointLight(new THREE.Color(col), intensity, dist, 2);
    l.position.copy(pos);
    scene.add(l);
    localLights.push(l);
    return l;
  };

  // ── ferry (first light of the budget) ──
  const ferry = createFerry({ quality, allowLight: budget >= 1, dispose: disposer });
  if (ferry.light) localLights.push(ferry.light);
  scene.add(ferry.vehicle.root);
  ferry.vehicle.root.position.copy(ferry.vehicle.docks[0]);

  // ── environment ──
  const ground = createGround(ctx);
  scene.add(ground.group);
  scene.add(createFootprints(ctx));
  scene.add(createDrifts(ctx));
  scene.add(createAuroraSpill(ctx));
  const aurora = createAurora(quality, disposer);
  scene.add(aurora.group);
  const backdrop = createBackdrop(ctx);
  scene.add(backdrop.group);
  const camp = createCamp(ctx);
  scene.add(camp.group);
  const station = createStation(ctx);
  scene.add(station.group);
  scene.add(createDockworks(ctx));
  const drones = createDrones(ctx);
  scene.add(drones.group);
  const robot = createRobot(ctx);
  scene.add(robot.group);

  // warm glow halos of lanterns / windows / fire
  const halos = createHalos([...camp.halos, ...station.halos], disposer);
  scene.add(halos);

  // ── local lights (priority order, budget from the quality preset) ──
  const fireLight = addLight('#ff8a3c', 30, 14, camp.fire.clone().add(new THREE.Vector3(0, 1.4, 0)));
  addLight('#ffb062', 22, 15, new THREE.Vector3(10.4, PLATFORM_Y + 2.6, 0.4));
  // leader + lantern
  const leader = createLeader(groundHeight);
  leader.actor.root.position.set(10.7, PLATFORM_Y, -2.6);
  leader.actor.faceTowards(new THREE.Vector3(0, PLATFORM_Y, -0.6));
  leader.actor.snapYaw();
  scene.add(leader.actor.root);
  const lanternLight = addLight('#ffb35a', 14, 9, new THREE.Vector3(10.4, 1.4, -2.4));
  addLight('#4fd4ff', 16, 16, backdrop.caves[0]!);
  addLight('#ff9a4a', 12, 9, new THREE.Vector3(8.6, PLATFORM_Y + 2.2, 6.4));
  addLight('#ff9a4a', 12, 9, new THREE.Vector3(8.6, PLATFORM_Y + 2.2, -6.4));
  addLight('#ffa860', 14, 10, new THREE.Vector3(-14.4, 1.6, -3.2));
  addLight('#4fd4ff', 16, 16, backdrop.caves[1]!);

  // ── weather ──
  const snowNear = createParticles({
    count: 2200,
    min: [-30, 0, -34],
    max: [30, 17, 30],
    color: '#f2f8ff',
    size: 0.1,
    motion: 'fall',
    speed: 1.5,
    wind: [4.2, 1.1],
    additive: false,
    opacity: 0.85,
    quality,
  });
  snowNear.renderOrder = 9;
  scene.add(snowNear);
  const snowFar = createParticles({
    count: 1300,
    min: [-70, 0, -100],
    max: [70, 26, 40],
    color: '#e6f1ff',
    size: 0.19,
    motion: 'fall',
    speed: 1.2,
    wind: [4.6, 1.3],
    additive: false,
    opacity: 0.5,
    quality,
  });
  snowFar.renderOrder = 9;
  scene.add(snowFar);
  const streaks = createParticles({
    count: 800,
    min: [-40, 0.05, -40],
    max: [40, 1.7, 40],
    color: '#dcecff',
    size: 1.2,
    motion: 'fall',
    speed: 0.25,
    wind: [9, 0.6],
    additive: false,
    opacity: 0.3,
    stretch: 0.1,
    quality,
  });
  streaks.renderOrder = 9;
  scene.add(streaks);
  const glitter = createParticles({
    count: 650,
    min: [-30, 0.3, -34],
    max: [30, 6.5, 30],
    color: new THREE.Color('#bfefff').multiplyScalar(2.4),
    color2: new THREE.Color('#ffffff').multiplyScalar(2.8),
    size: 0.05,
    motion: 'float',
    speed: 0.7,
    twinkle: 0.95,
    additive: true,
    quality,
  });
  glitter.renderOrder = 10;
  scene.add(glitter);
  const sparks = createParticles({
    count: 70,
    min: [camp.fire.x - 0.25, camp.fire.y + 0.9, camp.fire.z - 0.25],
    max: [camp.fire.x + 0.25, camp.fire.y + 4.6, camp.fire.z + 0.25],
    color: new THREE.Color('#ff9a3c').multiplyScalar(2.6),
    color2: new THREE.Color('#ffd27a').multiplyScalar(2.2),
    size: 0.07,
    motion: 'rise',
    speed: 1.5,
    wind: [-0.7, 0.2],
    additive: true,
    quality,
  });
  sparks.renderOrder = 10;
  scene.add(sparks);
  const smoke = createParticles({
    count: 34,
    min: [-10.6, 3.0, -8.6],
    max: [-10.2, 7.5, -8.0],
    color: '#8fa0b8',
    size: 0.9,
    motion: 'rise',
    speed: 0.55,
    wind: [1.3, 0.2],
    additive: false,
    opacity: 0.17,
    quality,
  });
  smoke.renderOrder = 6;
  scene.add(smoke);

  // ── cast ──
  const cast = createCast(groundHeight);
  const banks: [BankLayout, BankLayout] = [
    { slots: slotsFor(0), dockPoint: new THREE.Vector3(-6.25, groundHeight(-6.25, 0), 0), facing: new THREE.Vector3(0, 0.6, 0) },
    { slots: slotsFor(1), dockPoint: new THREE.Vector3(6.25, groundHeight(6.25, 0), 0), facing: new THREE.Vector3(0, 0.6, 0) },
  ];
  const order = ['henrik', 'sana', 'lumi', 'aki', 'nanuk'];
  const start = [5, 1, 2, 6, 3];
  order.forEach((id, i) => {
    const a = cast.actors.get(id)!;
    const slot = banks[0].slots[start[i]!]!;
    a.root.position.copy(slot);
    a.faceTowards(banks[0].facing);
    a.snapYaw();
    scene.add(a.root);
  });

  // ── camera ──
  const home = { target: new THREE.Vector3(0, 0.6, 0), radius: 25, polar: 1.0, azimuth: 0 };
  const homePos = new THREE.Vector3(
    home.target.x + home.radius * Math.sin(home.polar) * Math.sin(home.azimuth),
    home.target.y + home.radius * Math.cos(home.polar),
    home.target.z + home.radius * Math.sin(home.polar) * Math.cos(home.azimuth),
  );

  // leader behaviour
  const ferryPos = new THREE.Vector3();
  const lanternPos = new THREE.Vector3();
  let leaderTimer = 6;
  const lookGoal = new THREE.Vector3(0, 1.4, 0);
  const lookCur = new THREE.Vector3(0, 1.4, 0);
  leader.actor.lookTarget = lookCur;

  let fireSeed = 0;
  const world: LevelWorld = {
    scene,
    look: LOOK,
    banks,
    vehicle: ferry.vehicle,
    actors: cast.actors,
    camera: {
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
        { position: new THREE.Vector3(3, 2.4, 34), target: new THREE.Vector3(0, 30, -140), duration: 0 },
        { position: new THREE.Vector3(-20, 4.5, 24), target: new THREE.Vector3(-9, 5, -14), duration: 2.4 },
        { position: new THREE.Vector3(16, 6.5, 22), target: new THREE.Vector3(6, 1.6, -2), duration: 2.3 },
        { position: homePos, target: home.target.clone(), duration: 2.4 },
      ],
    },
    groundAt: groundHeight,
    music: 'ice',
    ambience: 'ice',
    seated: true,
    update(dt, t, camera) {
      aurora.update(t, camera);
      backdrop.update(dt, t);
      camp.update(dt, t);
      station.update(dt, t);
      drones.update(dt, t);
      robot.update(dt, t);
      // aurora-tinted fill light breathes with the sky
      if (rig.fill) {
        rig.fill.intensity = 0.42 * (0.82 + 0.18 * Math.sin(t * 0.31) + 0.06 * Math.sin(t * 0.83));
        rig.fill.color.setHSL(0.42 + Math.sin(t * 0.06) * 0.06, 1, 0.58);
      }
      if (rig.rim) rig.rim.intensity = 0.5 * (0.85 + 0.15 * Math.sin(t * 0.21 + 1.0));
      // fire flicker
      fireSeed += dt * 17;
      if (fireLight) fireLight.intensity = 30 * (0.86 + 0.09 * Math.sin(fireSeed) + 0.06 * Math.sin(fireSeed * 2.7 + 1.3) + 0.05 * Math.sin(fireSeed * 5.1));
      // expedition leader
      const la = leader.actor;
      ferry.vehicle.root.getWorldPosition(ferryPos);
      lookGoal.set(ferryPos.x, ferryPos.y + 1.3, ferryPos.z);
      lookCur.lerp(lookGoal, 1 - Math.exp(-dt * 1.6));
      la.update(dt);
      leaderTimer -= dt;
      if (leaderTimer <= 0) {
        leaderTimer = 9 + Math.random() * 7;
        la.react(ferryPos.x > 1 ? 'wave' : Math.random() < 0.5 ? 'nod' : 'wave');
      }
      leader.lantern.getWorldPosition(lanternPos);
      if (lanternLight) {
        lanternLight.position.copy(lanternPos).add(new THREE.Vector3(0, 0.05, 0));
        lanternLight.intensity = 14 * (0.92 + 0.05 * Math.sin(t * 9.1) + 0.03 * Math.sin(t * 15.3));
      }
    },
    dispose() {
      disposeEnv();
      for (const a of cast.actors.values()) a.dispose();
      leader.actor.dispose();
      scene.traverse((o) => {
        const l = o as THREE.Light;
        if (l.isLight && (l as THREE.DirectionalLight).shadow) (l as THREE.DirectionalLight).shadow.dispose();
      });
      disposer.disposeAll();
      scene.clear();
    },
  };
  return world;
};

export default factory;
