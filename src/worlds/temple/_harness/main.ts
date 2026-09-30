import * as THREE from 'three/webgpu';
import { PostFX } from '../../../render/PostFX';
import { QUALITY_PRESETS, type QualityLevel } from '../../../render/quality';
import factory from '../index';

const w = window as unknown as Record<string, unknown>;
const params = new URLSearchParams(location.search);
const lvl = (params.get('q') ?? 'medium') as QualityLevel;
const preset = QUALITY_PRESETS[lvl];
const az = parseFloat(params.get('az') ?? '0');
const polar = parseFloat(params.get('polar') ?? '1.0');
const radius = parseFloat(params.get('r') ?? '25');
const tx = parseFloat(params.get('tx') ?? '0');
const ty = parseFloat(params.get('ty') ?? '0.5');
const tz = parseFloat(params.get('tz') ?? '0');
const move = params.get('move');
const intro = params.get('intro');
(async () => {
  try {
    const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: true });
    await renderer.init();
    renderer.setPixelRatio(1);
    renderer.setSize(1280, 720);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);
    const t0 = performance.now();
    const world = await factory({ quality: preset, renderer });
    w.buildMs = performance.now() - t0;
    const cam = new THREE.PerspectiveCamera(45, 1280 / 720, 0.1, 2500);
    const tgt = new THREE.Vector3(tx, ty, tz);
    cam.position.set(tgt.x + radius * Math.sin(polar) * Math.sin(az), tgt.y + radius * Math.cos(polar), tgt.z + radius * Math.sin(polar) * Math.cos(az));
    if (intro) {
      const k = world.camera.intro[Number(intro)]!;
      cam.position.copy(k.position);
      tgt.copy(k.target);
    }
    cam.lookAt(tgt);
    const ids = [...world.actors.keys()];
    if (move) {
      const a = world.actors.get(ids[0]!)!;
      const b = world.actors.get(ids[3]!)!;
      world.vehicle.seats[0]!.add(a.root);
      a.root.position.set(0, 0, 0);
      world.vehicle.seats[1]!.add(b.root);
      b.root.position.set(0, 0, 0);
      (a as unknown as { mood: string }).mood = 'sit';
      (b as unknown as { mood: string }).mood = 'sit';
      world.vehicle.setIndicator?.({ count: 2, capacity: 2 });
      world.vehicle.root.position.copy(world.vehicle.docks[Number(move) === 2 ? 1 : 0]!);
    }
    const post = new PostFX(renderer);
    post.configure(world.scene, cam, preset, world.look);
    let t = 0;
    let frames = 0;
    const clock = new THREE.Timer();
    renderer.setAnimationLoop(() => {
      clock.update();
      const dt = Math.min(0.05, clock.getDelta());
      t += dt;
      world.vehicle.update(dt, t, 0);
      for (const a of world.actors.values()) a.update(dt);
      world.update(dt, t + 5, cam);
      post.render();
      frames++;
      if (frames === 6) w.info = { calls: renderer.info.render.drawCalls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries };
      if (frames === Number(params.get('frames') ?? '6')) {
        w.ready = true;
        renderer.setAnimationLoop(null);
      }
    });
  } catch (e) {
    w.err = String((e as Error).stack ?? e);
    w.ready = true;
    console.error(e);
  }
})();
