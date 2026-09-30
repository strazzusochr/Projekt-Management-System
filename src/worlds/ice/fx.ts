import * as THREE from 'three/webgpu';
import { color, float, hash, instanceIndex, pow, sin, smoothstep, time, uniformArray, uv, vec2, vec3 } from 'three/tsl';
import type { Disposer } from './common';

export interface HaloSpec {
  p: THREE.Vector3;
  color: THREE.ColorRepresentation;
  /** world size (diameter) of the glow */
  size: number;
  /** 0..1 flicker amount */
  flicker?: number;
  intensity?: number;
}

/**
 * Soft additive glow sprites (lantern halos, window bloom, fire) – one instanced draw call.
 * Data lives in uniform arrays; the sprite count is fixed at build time.
 */
export function createHalos(list: HaloSpec[], d: Disposer): THREE.Sprite {
  const n = Math.max(1, list.length);
  const pos = list.map((l) => l.p.clone());
  const col = list.map((l) => {
    const c = new THREE.Color(l.color).multiplyScalar(l.intensity ?? 1);
    return new THREE.Vector3(c.r, c.g, c.b);
  });
  const misc = list.map((l) => new THREE.Vector3(l.size, l.flicker ?? 0, 0));
  while (pos.length < n) {
    pos.push(new THREE.Vector3());
    col.push(new THREE.Vector3());
    misc.push(new THREE.Vector3(0, 0, 0));
  }
  const posU = uniformArray(pos, 'vec3');
  const colU = uniformArray(col, 'vec3');
  const miscU = uniformArray(misc, 'vec3');
  const m = d.add(new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const id = instanceIndex;
  const info = miscU.element(id) as unknown as ReturnType<typeof vec3>;
  m.positionNode = posU.element(id) as unknown as ReturnType<typeof vec3>;
  const flick = float(1).sub(info.y.mul(float(0.5).sub(sin(time.mul(11.0).add(hash(id.toFloat().add(3.1)).mul(50.0))).mul(0.25).add(sin(time.mul(23.0).add(hash(id.toFloat()).mul(90.0))).mul(0.25)))));
  m.scaleNode = vec2(info.x, info.x);
  const dist = uv().sub(0.5).length();
  const fall = pow(smoothstep(0.5, 0.0, dist), 2.4);
  m.colorNode = (colU.element(id) as unknown as ReturnType<typeof vec3>).mul(fall).mul(flick);
  m.opacityNode = float(1);
  const s = new THREE.Sprite(m);
  s.count = n;
  s.frustumCulled = false;
  s.renderOrder = 8;
  s.name = 'halos';
  void color;
  void vec3;
  return s;
}

/** Canvas sign texture (painted or backlit lettering). */
export function makeSignTexture(lines: Array<{ text: string; size: number; color: string; weight?: string; font?: string }>, bg: string, border: string, w = 1024, h = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = border;
  g.lineWidth = 10;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lines.reduce((a, l) => a + l.size * 1.15, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    g.font = `${l.weight ?? 'bold'} ${l.size}px ${l.font ?? 'sans-serif'}`;
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, y + l.size * 0.58);
    y += l.size * 1.15;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
