import * as THREE from 'three/webgpu';
import { bake, cyl, ellipsoid, extrude, lathe, latheShell, merge, roundedBox, torus, tube } from '../../characters/geo';
import { Parts, paint, starShape } from './helpers';

export interface AirshipSpec {
  len: number;
  env: string;
  accent: string;
  hull: string;
  trim: string;
  emblem: 'sun' | 'star' | 'storm';
  seed: number;
  /** Fewer details for tiny distant ships. */
  simple?: boolean;
}

export interface Airship {
  group: THREE.Group;
  props: Array<{ mesh: THREE.Object3D; speed: number }>;
  bodyGeo: THREE.BufferGeometry;
  propGeo: THREE.BufferGeometry;
  radius: number;
}

function propellerGeometry(r: number, blades: number, col: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(bake(ellipsoid(r * 0.14, r * 0.14, r * 0.14, 10, 8), { color: '#e3b64f', rough: 0.25, metal: 1 }));
  parts.push(bake(cyl(r * 0.06, r * 0.06, r * 0.45, 8), { color: '#e3b64f', rough: 0.25, metal: 1 }, { p: [-r * 0.2, 0, 0], r: [0, 0, Math.PI / 2] }));
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    // blade along +Y, twisted by pitch around Y, rotated around X (the spin axis)
    const b = new THREE.SphereGeometry(1, 8, 6);
    b.scale(r * 0.05, r * 0.5, r * 0.14);
    b.translate(0, r * 0.55, 0);
    b.rotateY(0.5);
    b.rotateX(a);
    parts.push(bake(b, { color: col, rough: 0.5 }));
  }
  return merge(parts);
}

/** Builds an airship (nose toward +X). Returns a group with a static body mesh and spinning props. */
export function buildAirship(spec: AirshipSpec, mat: THREE.Material): Airship {
  const L = spec.len;
  const R = L * 0.155;
  const parts = new Parts();
  // ── envelope: lathe along Y, rotated to X ──
  const prof: Array<[number, number]> = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = (t - 0.5) * L;
    const r = R * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0.02, t))), 0.72) * (1 + 0.06 * Math.sin(t * 9 + spec.seed));
    prof.push([Math.max(0.02, r), y]);
  }
  const env = lathe(prof, spec.simple ? 20 : 36, spec.simple ? 16 : 36);
  env.rotateZ(-Math.PI / 2);
  env.scale(1, 0.92, 1);
  const eg = bake(env, { color: spec.env, rough: 0.55 });
  const cEnv = new THREE.Color(spec.env);
  const cAcc = new THREE.Color(spec.accent);
  const cTrim = new THREE.Color(spec.trim);
  const tmp = new THREE.Color();
  paint(eg, (p, n2, c) => {
    const ang = Math.atan2(p.z, p.y);
    const stripe = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 18) % 2;
    tmp.copy(stripe ? cEnv : cAcc);
    const shade = 0.72 + 0.4 * (n2.y * 0.5 + 0.5);
    c.copy(tmp).multiplyScalar(shade);
    const x = p.x / L + 0.5;
    if (x > 0.955 || x < 0.03) c.copy(cTrim);
    if (Math.abs(p.y) < R * 0.06 && p.z < 0) c.copy(cTrim);
    const band = Math.abs(x - 0.5) < 0.01 || Math.abs(x - 0.25) < 0.006 || Math.abs(x - 0.75) < 0.006;
    if (band) c.copy(cTrim).multiplyScalar(0.9);
  });
  parts.addBaked(eg);
  // ── fins ──
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(L * 0.14, 0);
  fin.lineTo(L * 0.06, R * 0.95);
  fin.lineTo(-L * 0.005, R * 0.95);
  fin.closePath();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const f = extrude(fin, R * 0.05, 0.005);
    parts.add(f, { color: k % 2 ? spec.accent : spec.env, rough: 0.6 }, { p: [-L * 0.5 + L * 0.02, 0, 0], r: [a, 0, 0] });
    void a;
  }
  // ── gondola ──
  const gy = -R * 0.92 - R * 0.55;
  const gl = L * 0.36;
  const hullG = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hullG.scale(gl * 0.5, R * 0.42, R * 0.34);
  parts.add(hullG, { color: spec.hull, rough: 0.6 }, { p: [L * 0.02, gy + R * 0.05, 0] });
  parts.add(new THREE.SphereGeometry(1, 16, 8), { color: spec.trim, rough: 0.3, metal: 0.9 }, { p: [L * 0.02, gy + R * 0.05, 0], s: [gl * 0.51, R * 0.04, R * 0.35] });
  // cabin + bridge
  parts.add(roundedBox(gl * 0.5, R * 0.3, R * 0.5, R * 0.05), { color: '#f2e6cc', rough: 0.7 }, { p: [L * 0.0, gy + R * 0.28, 0] });
  parts.add(roundedBox(gl * 0.52, R * 0.05, R * 0.56, R * 0.02), { color: spec.trim, rough: 0.35, metal: 0.8 }, { p: [L * 0.0, gy + R * 0.45, 0] });
  if (!spec.simple) {
    for (let i = 0; i < 5; i++) {
      const wx = -gl * 0.19 + i * gl * 0.095;
      for (const s of [1, -1]) parts.add(new THREE.BoxGeometry(gl * 0.05, R * 0.13, R * 0.02), { color: '#ffd98a', rough: 0.3, emit: 1.6 }, { p: [wx, gy + R * 0.3, s * R * 0.255] });
    }
    // bow lantern + rails
    parts.add(new THREE.SphereGeometry(R * 0.06, 8, 6), { color: '#ffcf70', rough: 0.3, emit: 2.4 }, { p: [gl * 0.5 + L * 0.02, gy + R * 0.15, 0] });
    for (const s of [1, -1]) parts.add(tube([[-gl * 0.45, gy + R * 0.58, s * R * 0.3], [0, gy + R * 0.62, s * R * 0.32], [gl * 0.45, gy + R * 0.58, s * R * 0.3]], R * 0.012, 12, 4), { color: spec.trim, rough: 0.3, metal: 0.9 });
  }
  // rigging: ropes from envelope to gondola
  for (const sx of [-0.26, -0.08, 0.1, 0.28]) {
    for (const s of [1, -1]) {
      const ex = sx * L;
      const envR = R * Math.pow(Math.sin(Math.PI * (sx + 0.5)), 0.72);
      parts.add(tube([[ex, -envR * 0.6, s * envR * 0.78], [ex * 0.96, gy * 0.55, s * (envR * 0.7 + R * 0.05)], [ex * 0.9 + L * 0.02, gy + R * 0.42, s * R * 0.3]], R * 0.012, 8, 4), { color: '#d8c28a', rough: 0.9 });
    }
  }
  // envelope emblem decals (both sides)
  for (const s of [1, -1]) {
    const ex = L * 0.08;
    if (spec.emblem === 'sun') {
      parts.add(cyl(R * 0.45, R * 0.45, R * 0.03, 24), { color: '#ffd25a', rough: 0.3, metal: 0.8, emit: 0.65 }, { p: [ex, R * 0.05, s * R * 0.9], r: [Math.PI / 2, 0, 0] });
      parts.add(cyl(R * 0.3, R * 0.3, R * 0.05, 24), { color: '#fff0b0', rough: 0.3, emit: 1.0 }, { p: [ex, R * 0.05, s * R * 0.9], r: [Math.PI / 2, 0, 0] });
    } else if (spec.emblem === 'star') {
      parts.add(extrude(starShape(5, R * 0.5, R * 0.22), R * 0.05, R * 0.01), { color: '#e8dcff', rough: 0.3, emit: 0.9 }, { p: [ex, R * 0.05, s * R * 0.9], r: [0, s > 0 ? 0 : Math.PI, 0] });
    } else {
      parts.add(new THREE.OctahedronGeometry(R * 0.4), { color: '#7fe8f0', rough: 0.3, emit: 0.9 }, { p: [ex, R * 0.05, s * R * 0.88], s: [1, 1.3, 0.25] });
    }
  }
  // mast + pennant top
  parts.add(cyl(R * 0.015, R * 0.02, R * 0.5, 6), { color: spec.trim, rough: 0.4, metal: 0.8 }, { p: [L * 0.05, R * 0.92 + R * 0.2, 0] });
  // side outriggers for propellers
  const propSpecs: Array<{ x: number; y: number; z: number; r: number }> = [
    { x: -L * 0.08, y: gy + R * 0.45, z: R * 0.62, r: R * 0.38 },
    { x: -L * 0.08, y: gy + R * 0.45, z: -R * 0.62, r: R * 0.38 },
    { x: -L * 0.5 - R * 0.14, y: 0, z: 0, r: R * 0.52 },
  ];
  for (const p of spec.simple ? [] : propSpecs.slice(0, 2)) {
    parts.add(tube([[p.x + L * 0.02, gy + R * 0.4, Math.sign(p.z) * R * 0.3], [p.x, p.y, p.z * 0.8], [p.x + R * 0.02, p.y, p.z]], R * 0.03, 10, 5), { color: spec.trim, rough: 0.4, metal: 0.9 });
    parts.add(ellipsoid(R * 0.12, R * 0.1, R * 0.1, 10, 8), { color: spec.trim, rough: 0.3, metal: 0.9 }, { p: [p.x + R * 0.05, p.y, p.z] });
  }
  parts.add(ellipsoid(R * 0.1, R * 0.1, R * 0.1, 10, 8), { color: spec.trim, rough: 0.3, metal: 0.9 }, { p: [-L * 0.5 - R * 0.02, 0, 0] });
  // sun-visor style stern skirt (thin ring)
  parts.add(latheShell([[R * 0.14, 0], [R * 0.24, -R * 0.2], [R * 0.3, -R * 0.4]], 14, 6), { color: spec.trim, rough: 0.4, metal: 0.8 }, { p: [-L * 0.5 - R * 0.18, 0, 0], r: [0, 0, Math.PI / 2] });
  parts.add(torus(R * 0.26, R * 0.02, Math.PI * 2, 20, 4), { color: spec.trim, rough: 0.35, metal: 0.9 }, { p: [-L * 0.5 - R * 0.05, 0, 0], r: [0, Math.PI / 2, 0] });

  const bodyGeo = parts.build();
  const group = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, mat);
  body.castShadow = !spec.simple;
  group.add(body);

  // ── spinning propellers (shared geometry per ship) ──
  const propGeo = propellerGeometry(1, 3, spec.trim);
  const props: Airship['props'] = [];
  propSpecs.forEach((p, i) => {
    if (spec.simple && i !== 2) return;
    const m = new THREE.Mesh(propGeo, mat);
    m.position.set(p.x + R * 0.12, p.y, p.z);
    m.scale.setScalar(p.r);
    if (i === 2) m.position.x = p.x;
    group.add(m);
    props.push({ mesh: m, speed: (i === 2 ? 14 : 18) * (i % 2 ? -1 : 1) });
  });
  return { group, props, bodyGeo, propGeo, radius: L * 0.5 };
}
