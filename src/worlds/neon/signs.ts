import * as THREE from 'three/webgpu';
import { abs, color, float, fract, mix, mx_noise_float, pow, sin, smoothstep, step, time, uv, vec3 } from 'three/tsl';
import { mat } from '../../world/kit';
import { boxG, flicker, mergeG, signTexture, type Env } from './env';
import type { Hero } from './city';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TN = any;

interface SignDef {
  text: string;
  sub?: string;
  color: string;
  w: number;
  h: number;
  /** position on the facade (world) */
  x: number;
  y: number;
  z: number;
  rotY: number;
  flicker?: boolean;
  border?: boolean;
  intensity?: number;
}

/** Neon signs (CanvasTexture), holographic billboards and animated digital screens. */
export function buildSigns(env: Env, heroes: Hero[]): void {
  const { root, q } = env;
  const backMat = mat('#0a0d14', 0.5, 0.6);
  const backGeos: THREE.BufferGeometry[] = [];
  const pushBack = (w: number, h: number, dp: number, x: number, y: number, z: number, rotY: number): void => {
    const g = boxG(w, h, dp);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(1, 1, 1)));
    backGeos.push(g);
  };
  const defs: SignDef[] = [];

  // facade signs on the hero buildings: face the canal (rotY +π/2 → +X on the left side, −π/2 on the right)
  const texts: Array<{ text: string; sub?: string; color: string; flicker?: boolean; w?: number; h?: number }> = [
    { text: 'NACHTSCHICHT', sub: 'BAR · 24H', color: '#ff2fd0', flicker: true, w: 6.2, h: 2.0 },
    { text: 'KANAL 9', sub: 'NEWS · LIVE', color: '#19d9ff', w: 5.0, h: 1.8 },
    { text: 'RAMEN', sub: 'NUDELN · SUPPE', color: '#ff7a1e', flicker: true, w: 4.4, h: 1.7 },
    { text: 'DATEN-BAR', color: '#7dff6a', w: 5.4, h: 1.5 },
    { text: 'APOTHEKE', sub: 'NOTDIENST', color: '#3dff9a', w: 4.6, h: 1.6 },
    { text: 'HOTEL SIGMA', color: '#ffd23a', w: 5.4, h: 1.5, flicker: true },
    { text: 'CYBER-CLINIC', color: '#5ab8ff', w: 6.0, h: 1.5 },
    { text: 'GLASFASER', sub: 'SCHNELL · SICHER', color: '#c05aff', w: 5.0, h: 1.8 },
    { text: 'TAXI 24', color: '#ffe23a', w: 3.2, h: 1.4 },
    { text: 'ARKOLOGIE', sub: 'DOCK', color: '#19d9ff', w: 7.0, h: 2.2 },
    { text: 'PIER 9', sub: 'WARENUMSCHLAG', color: '#ff2fd0', w: 6.0, h: 2.0 },
    { text: 'BAHNHOF', color: '#ff4a4a', w: 4.6, h: 1.4 },
  ];
  let ti = 0;
  const sorted = [...heroes].sort((a, b) => a.side - b.side || a.z - b.z);
  for (const h of sorted) {
    const t = texts[ti++ % texts.length]!;
    const s = h.side;
    const faceX = s * (16.5 - 0.06) ;
    const y = 3.5 + ((ti * 2.7) % 8);
    defs.push({
      text: t.text,
      sub: t.sub,
      color: t.color,
      w: t.w ?? 5,
      h: t.h ?? 1.6,
      x: faceX,
      y: Math.min(y, h.h - 2),
      z: h.z + ((ti % 3) - 1) * 1.2,
      rotY: s < 0 ? Math.PI / 2 : -Math.PI / 2,
      flicker: t.flicker,
      border: true,
    });
  }
  // dedicated hero signs at the docks (large, on posts behind the slots)
  defs.push({ text: 'PIER 9', sub: 'ABFAHRT · WARTEN', color: '#ff2fd0', w: 4.2, h: 1.7, x: -13.4, y: 4.2, z: -6, rotY: Math.PI / 2, border: true });
  defs.push({ text: 'ARKOLOGIE-DOCK', sub: 'ANKUNFT', color: '#19d9ff', w: 5.4, h: 1.7, x: 13.4, y: 4.2, z: -6, rotY: -Math.PI / 2, border: true });

  // posts for the free-standing dock signs
  for (const sx of [-13.4, 13.4]) {
    backGeos.push(boxG(0.16, 4.4, 0.16, [sx + (sx < 0 ? -0.05 : 0.05), 0.8 + 2.2, -6 - 2.0]), boxG(0.16, 4.4, 0.16, [sx + (sx < 0 ? -0.05 : 0.05), 0.8 + 2.2, -6 + 2.0]));
  }
  const lights: Array<{ mat: THREE.MeshBasicNodeMaterial; base: number; ph: number; flick: boolean }> = [];
  for (const d of defs) {
    const tex = signTexture({ text: d.text, sub: d.sub, color: d.color, w: 512, h: Math.round(512 * (d.h / d.w)), border: d.border });
    const sm = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1, 1, 1).multiplyScalar(d.intensity ?? 2.0) });
    sm.side = THREE.DoubleSide;
    const g = new THREE.Group();
    g.position.set(d.x, d.y, d.z);
    g.rotation.y = d.rotY;
    pushBack(d.w + 0.5, d.h + 0.4, 0.14, d.x, d.y, d.z, d.rotY);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), sm);
    face.position.z = 0.09;
    g.add(face);
    root.add(g);
    lights.push({ mat: sm, base: d.intensity ?? 2.0, ph: Math.random() * 10, flick: !!d.flicker });
  }
  env.updaters.push((_dt, t) => {
    for (const l of lights) {
      const f = l.flick ? flicker(t, l.ph) : 1;
      const breathe = 0.92 + 0.08 * Math.sin(t * 2 + l.ph);
      l.mat.color.setScalar(l.base * f * breathe);
    }
  });

  // (backing panels are merged at the end of this function)
  // ───────── holographic billboards (additive planes with scanlines) ─────────
  const holo = (w: number, h: number, col: [number, number, number], kind: number, x: number, y: number, z: number, rotY: number): THREE.Mesh => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    m.fog = true;
    const u = uv();
    const scan = sin(u.y.mul(220).sub(time.mul(6))).mul(0.5).add(0.5);
    const fine = step(0.5, fract(u.y.mul(90).add(time.mul(0.3))));
    const jitter = step(0.985, fract(sin(time.mul(7.3)).mul(43758.5))).mul(0.06);
    const uu = u.x.add(jitter.mul(sin(u.y.mul(30))));
    const edge = smoothstep(0.0, 0.08, uu).mul(smoothstep(1.0, 0.92, uu)).mul(smoothstep(0.0, 0.08, u.y)).mul(smoothstep(1.0, 0.92, u.y));
    let pattern: TN;
    if (kind === 0) {
      // radial rings + rotating sweep
      const p = vec3(uu.sub(0.5).mul(w / h), u.y.sub(0.5), 0.0);
      const rr = p.xy.length();
      const rings = smoothstep(0.02, 0.0, abs(fract(rr.mul(6).sub(time.mul(0.4))).sub(0.5).abs().sub(0.42)));
      const core = smoothstep(0.32, 0.0, rr);
      pattern = rings.mul(0.8).add(core).mul(edge);
    } else if (kind === 1) {
      // bar chart / data stream
      const col1 = fract(uu.mul(16));
      const barH = mx_noise_float(vec3(uu.mul(16).floor(), time.mul(0.9), 0.0)).mul(0.5).add(0.5).mul(0.8).add(0.1);
      const bars = step(u.y, barH).mul(step(0.12, col1)).mul(step(col1, 0.88));
      pattern = bars.mul(0.9).add(smoothstep(0.02, 0.0, abs(u.y.sub(0.05))).mul(0.6)).mul(edge);
    } else {
      // wave + grid
      const wv = smoothstep(0.03, 0.0, abs(u.y.sub(sin(uu.mul(12).add(time.mul(2.5))).mul(0.22).add(0.5))));
      const wv2 = smoothstep(0.02, 0.0, abs(u.y.sub(sin(uu.mul(7).sub(time.mul(1.7))).mul(0.3).add(0.5)))).mul(0.6);
      const grid = step(0.94, fract(uu.mul(14))).add(step(0.94, fract(u.y.mul(8)))).mul(0.25);
      pattern = wv.add(wv2).add(grid).mul(edge).add(edge.mul(0.06));
    }
    const flick = sin(time.mul(23)).mul(0.04).add(0.96);
    m.colorNode = vec3(col[0], col[1], col[2]).mul(pattern.mul(scan.mul(0.5).add(0.6)).add(fine.mul(0.04).mul(edge)).mul(flick)).mul(1.8);
    m.opacityNode = float(1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.renderOrder = 5;
    root.add(mesh);
    return mesh;
  };
  holo(7, 4.4, [0.1, 0.9, 1.0], 0, -14.2, 9.5, 8.5, Math.PI / 2 - 0.25);
  holo(7.5, 4.0, [1.0, 0.2, 0.85], 1, 14.6, 10.5, 10.5, -Math.PI / 2 + 0.25);
  holo(10, 5.5, [0.4, 1.0, 0.7], 2, 16.2, 16, -12, -Math.PI / 2 + 0.1);
  if (q.level !== 'low') holo(9, 5, [1.0, 0.7, 0.2], 1, -16.2, 15, -14, Math.PI / 2 - 0.1);

  // ───────── giant animated digital billboards on facades ─────────
  const digital = (w: number, h: number, x: number, y: number, z: number, rotY: number, seed: number): void => {
    const m = new THREE.MeshBasicNodeMaterial();
    const u = uv();
    const t = time.mul(0.6).add(seed);
    const pl = sin(u.x.mul(6).add(t)).add(sin(u.y.mul(5).sub(t.mul(1.3)))).add(sin(u.x.add(u.y).mul(8).add(t.mul(0.7)))).add(sin(u.x.sub(u.y).mul(3).sub(t)));
    const k = pl.mul(0.25).add(0.5);
    const a = vec3(1.0, 0.15, 0.7);
    const b = vec3(0.1, 0.8, 1.0);
    const c = vec3(1.0, 0.75, 0.2);
    const cc = mix(mix(a, b, smoothstep(0.2, 0.6, k)), c, smoothstep(0.65, 0.95, k));
    const pixel = step(0.12, fract(u.x.mul(w * 3.5))).mul(step(0.12, fract(u.y.mul(h * 3.5))));
    const strip = step(0.5, fract(u.y.mul(6).sub(time.mul(0.5)).add(seed)));
    m.colorNode = cc.mul(pixel.mul(0.75).add(0.25)).mul(strip.mul(0.5).add(1.0)).mul(1.45);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    pushBack(w + 0.5, h + 0.5, 0.3, x, y, z, rotY);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    face.position.z = 0.17;
    g.add(face);
    root.add(g);
  };
  digital(9, 5, -16.4, 17, -2, Math.PI / 2, 0.3);
  digital(8, 4.5, 16.4, 19, 6, -Math.PI / 2, 2.1);
  digital(12, 6, 16.4, 23, -22, -Math.PI / 2, 4.4);
  digital(11, 6, -16.4, 22, 18, Math.PI / 2, 6.6);
  if (q.density > 0.6) {
    digital(14, 7, -34, 40, -20, Math.PI / 2, 8.2);
    digital(14, 7, 34, 38, 12, -Math.PI / 2, 9.9);
  }
  root.add(new THREE.Mesh(mergeG(backGeos), backMat));
  void color;
  void pow;
}
