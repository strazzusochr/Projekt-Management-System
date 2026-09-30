import * as THREE from 'three/webgpu';
import { createParticles } from '../../world/kit';
import type { Env } from './env';

/** Rain, mist and dust particles that follow the camera loosely. */
export function buildAtmosphere(env: Env): void {
  const { q, root } = env;
  const rain = createParticles({
    count: 6500,
    min: [-32, 0, -32],
    max: [32, 30, 32],
    color: '#a8ccff',
    color2: '#ffffff',
    size: 0.028,
    motion: 'fall',
    speed: 26,
    wind: [1.2, 0.3],
    additive: true,
    opacity: 0.38,
    stretch: 8,
    quality: q,
  });
  rain.name = 'rain';
  root.add(rain);
  const rain2 = createParticles({
    count: 1400,
    min: [-14, 0, -14],
    max: [14, 12, 14],
    color: '#d8ecff',
    size: 0.024,
    motion: 'fall',
    speed: 20,
    wind: [1.0, 0.2],
    additive: true,
    opacity: 0.5,
    stretch: 9,
    quality: q,
  });
  root.add(rain2);
  const mist = createParticles({
    count: 110,
    min: [-30, 0.2, -50],
    max: [30, 3.5, 50],
    color: '#3a4f9a',
    color2: '#20b0d8',
    size: 5.5,
    motion: 'float',
    speed: 0.15,
    additive: true,
    opacity: 0.014,
    quality: q,
  });
  root.add(mist);
  const dust = createParticles({
    count: 500,
    min: [-24, 0.5, -30],
    max: [24, 16, 30],
    color: '#8fd8ff',
    color2: '#ff7ad8',
    size: 0.07,
    motion: 'float',
    speed: 0.6,
    additive: true,
    opacity: 0.6,
    twinkle: 0.8,
    quality: q,
  });
  root.add(dust);

  env.updaters.push((_dt, _t, cam) => {
    // keep the rain volume roughly around the play area / camera
    const cx = Math.round((cam.position.x * 0.45) / 4) * 4;
    const cz = Math.round((cam.position.z * 0.45) / 4) * 4;
    rain.position.set(cx, 0, cz);
    rain2.position.set(cam.position.x * 0.7, 0, cam.position.z * 0.7);
  });
  void THREE;
}
