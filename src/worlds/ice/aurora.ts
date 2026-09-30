import * as THREE from 'three/webgpu';
import { Fn, clamp, color, exp, float, mix, mx_noise_float, normalize, positionLocal, pow, sin, smoothstep, time, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { QualityPreset } from '../../render/quality';
import { rng } from '../../world/kit';
import type { Disposer } from './common';

/** 0 = calm sky, 1 = celebration surge (all curtains flare). */
export const auroraBoost = uniform(0);

interface RibbonSpec {
  /** arc centre in the XZ plane (mesh origin) */
  radius: number;
  /** angle range (0 = north / -Z, positive = towards +X) */
  a0: number;
  a1: number;
  baseY: number;
  height: number;
  /** bottom / mid / top colour of the curtain */
  low: string;
  mid: string;
  top: string;
  strength: number;
  rayFreq: number;
  fold1: number;
  fold2: number;
  amp1: number;
  amp2: number;
  speed: number;
  seed: number;
  /** curtain top leans outwards (m) */
  lean: number;
  wobble: number;
}

const SPECS: RibbonSpec[] = [
  // main hero arc, straight over the fjord
  { radius: 215, a0: -1.3, a1: 1.15, baseY: 52, height: 118, low: '#3dff9a', mid: '#19d6b8', top: '#8a4dff', strength: 1.15, rayFreq: 74, fold1: 9, fold2: 23, amp1: 14, amp2: 5, speed: 0.34, seed: 1.7, lean: -26, wobble: 9 },
  // second, deeper curtain behind it
  { radius: 300, a0: -0.95, a1: 1.45, baseY: 84, height: 138, low: '#37f0c4', mid: '#2aa8e8', top: '#c04bff', strength: 0.8, rayFreq: 58, fold1: 7, fold2: 19, amp1: 20, amp2: 7, speed: 0.26, seed: 4.1, lean: 18, wobble: 12 },
  // low bright band close to the horizon
  { radius: 165, a0: -0.75, a1: 0.65, baseY: 28, height: 58, low: '#6bffb0', mid: '#2fe0a2', top: '#3aa4d8', strength: 0.95, rayFreq: 96, fold1: 12, fold2: 31, amp1: 8, amp2: 3, speed: 0.45, seed: 8.3, lean: -8, wobble: 5 },
  // magenta-violet crown east
  { radius: 150, a0: 0.5, a1: 2.5, baseY: 92, height: 130, low: '#b06cff', mid: '#e04fd0', top: '#5a3cff', strength: 0.55, rayFreq: 44, fold1: 6, fold2: 15, amp1: 18, amp2: 6, speed: 0.22, seed: 12.9, lean: 12, wobble: 10 },
  // west curtain
  { radius: 195, a0: -2.55, a1: -0.85, baseY: 62, height: 100, low: '#4dffb8', mid: '#20c9c9', top: '#7a56ff', strength: 0.78, rayFreq: 66, fold1: 8, fold2: 21, amp1: 15, amp2: 5, speed: 0.3, seed: 17.4, lean: 10, wobble: 8 },
  // faint distant glow band
  { radius: 380, a0: -1.5, a1: 1.5, baseY: 22, height: 76, low: '#2fffb2', mid: '#1fa6a0', top: '#4d3cc8', strength: 0.5, rayFreq: 40, fold1: 5, fold2: 13, amp1: 26, amp2: 8, speed: 0.18, seed: 21.6, lean: 0, wobble: 14 },
];

function buildRibbonGeometry(s: RibbonSpec, segU: number, segV: number): THREE.BufferGeometry {
  const r = rng(Math.floor(s.seed * 1000));
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  const pos = new Float32Array((segU + 1) * (segV + 1) * 3);
  const uvs = new Float32Array((segU + 1) * (segV + 1) * 2);
  let p = 0;
  let q = 0;
  for (let i = 0; i <= segU; i++) {
    const u = i / segU;
    const th = s.a0 + (s.a1 - s.a0) * u;
    const wob = Math.sin(u * 7.3 + ph[0]!) * s.wobble + Math.sin(u * 17.1 + ph[1]!) * s.wobble * 0.35 + Math.sin(u * 3.1 + ph[2]!) * s.wobble * 0.8;
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;
      const rr = s.radius + s.lean * v * v + Math.sin(u * 5.0 + v * 2.0 + ph[1]!) * 6;
      const y = s.baseY + wob + v * s.height;
      pos[p++] = Math.sin(th) * rr;
      pos[p++] = y;
      pos[p++] = -Math.cos(th) * rr;
      uvs[q++] = u;
      uvs[q++] = v;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * (segV + 1) + j;
      const b = a + 1;
      const c = a + (segV + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function buildRibbonMaterial(s: RibbonSpec, cheap: boolean): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  m.fog = false;
  const T = time;
  m.positionNode = Fn(() => {
    const p = positionLocal.toVar();
    const uu = uv().x;
    const vv = uv().y;
    const radial = normalize(vec3(p.x, 0, p.z));
    const fold = sin(uu.mul(s.fold1).add(T.mul(s.speed)).add(s.seed))
      .mul(s.amp1)
      .add(sin(uu.mul(s.fold2).sub(T.mul(s.speed * 1.7)).add(s.seed * 2.3)).mul(s.amp2));
    const sway = fold.mul(pow(vv, 1.25));
    const lift = sin(uu.mul(s.fold1 * 1.9).add(T.mul(0.55)).add(s.seed)).mul(2.4).mul(vv);
    return p.add(radial.mul(sway)).add(vec3(0, lift, 0));
  })();

  const u = uv().x;
  const v = uv().y;
  const lowC = color(new THREE.Color(s.low));
  const midC = color(new THREE.Color(s.mid));
  const topC = color(new THREE.Color(s.top));
  let col = mix(lowC, midC, smoothstep(0.0, 0.5, v));
  col = mix(col, topC, smoothstep(0.42, 1.0, v));

  // vertical rays: noise along the curtain, slowly drifting and shearing with height
  let rays;
  if (cheap) {
    const a = sin(u.mul(s.rayFreq).add(T.mul(0.7)).add(sin(u.mul(9).add(s.seed)).mul(2.2)));
    const b = sin(u.mul(s.rayFreq * 2.3).sub(T.mul(1.1)).add(s.seed));
    rays = pow(a.mul(0.5).add(b.mul(0.25)).add(0.62).clamp(0, 1), 1.5);
  } else {
    const n1 = mx_noise_float(vec2(u.mul(s.rayFreq).add(s.seed * 7.0), T.mul(0.11).add(v.mul(0.35))));
    const n2 = mx_noise_float(vec2(u.mul(s.rayFreq * 2.6).add(s.seed * 3.0), T.mul(0.23).sub(v.mul(0.6))));
    rays = pow(clamp(n1.mul(0.55).add(n2.mul(0.32)).add(0.55), 0, 1), 1.5);
  }
  // patchy brightness along the arc (bright knots travelling slowly)
  const patches = smoothstep(-0.25, 0.65, mx_noise_float(vec2(u.mul(5.5).add(s.seed), T.mul(0.06)))).mul(0.85).add(0.15);
  const bottomEdge = smoothstep(0.0, 0.045, v);
  const edgeGlow = exp(v.mul(-9.5));
  const body = pow(float(1).sub(v), 1.35);
  const pulse = sin(u.mul(11).sub(T.mul(0.55)).add(s.seed)).mul(0.22).add(0.78);
  const breathe = sin(T.mul(0.13).add(s.seed * 2.0)).mul(0.18).add(0.86);
  const ends = smoothstep(0.0, 0.05, u).mul(smoothstep(1.0, 0.95, u));
  const I = body
    .mul(rays.mul(1.35).add(0.28))
    .add(edgeGlow.mul(rays.mul(0.5).add(0.62)).mul(0.9))
    .mul(bottomEdge)
    .mul(patches)
    .mul(pulse)
    .mul(breathe)
    .mul(ends)
    .mul(auroraBoost.mul(0.9).add(1))
    .mul(s.strength);
  m.colorNode = col.mul(I);
  return m;
}

export interface Aurora {
  group: THREE.Group;
  update(t: number, camera: THREE.Camera): void;
}

export function createAurora(quality: QualityPreset, d: Disposer): Aurora {
  const group = new THREE.Group();
  group.name = 'aurora';
  const hi = quality.level === 'high' || quality.level === 'ultra';
  const lo = quality.level === 'low';
  const segU = lo ? 90 : hi ? 220 : 150;
  const segV = lo ? 12 : 26;
  const specs = lo ? SPECS.filter((_, i) => i < 3 || i === 4) : SPECS;
  for (const s of specs) {
    const geo = d.add(buildRibbonGeometry(s, segU, segV));
    const mat = d.add(buildRibbonMaterial(s, lo));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -500;
    mesh.name = 'aurora:ribbon';
    group.add(mesh);
  }
  return {
    group,
    update(_t, camera) {
      // keep the sky structures centred on the camera in x/z so the parallax stays sky-like
      group.position.x = camera.position.x * 0.92;
      group.position.z = camera.position.z * 0.92;
    },
  };
}
