import * as THREE from 'three/webgpu';
import { Actor } from '../../characters/Actor';
import { bake, cone, cyl, ellipsoid, gradient, limb, merge, mottle, tube, type Surface } from '../../characters/geo';
import { clamp01 } from './common';

type Geo = THREE.BufferGeometry;
type V3 = [number, number, number];

export interface QuadSpec {
  id: string;
  name: string;
  /** Body ellipsoid radii (x, y, z). */
  body: V3;
  legLen: number;
  legR: number;
  /** Rest bend of the rear legs (rad). */
  hock: number;
  neck: { len: number; r: number; tilt: number };
  head: { r: number; snout: number; snoutR: number; pitch: number };
  ear: { kind: 'point' | 'leaf' | 'tall'; len: number; w: number };
  tail: { kind: 'bushy' | 'thin' | 'puff' | 'stag'; len: number; r: number; rest: number };
  horns?: 'goat' | 'antlers';
  beard?: boolean;
  fangs?: boolean;
  jaw?: boolean;
  ruff?: boolean;
  hooves?: boolean;
  graze?: boolean;
  slitEyes?: boolean;
  col: { back: string; belly: string; legs: string; head: string; snout: string; nose: string; inner: string; hoof: string; eye: string; tail: string; tip: string; horn: string };
  fur: number;
  sit: 'sit' | 'crouch';
  height: number;
  radius: number;
  walkSpeed: number;
  stride: number;
  translucent?: boolean;
  ghost?: THREE.Color;
  /** Uniform scale of the whole animal. */
  scale?: number;
}

interface QuadRig {
  body: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group | null;
  eyes: THREE.Group;
  earL: THREE.Group;
  earR: THREE.Group;
  tail: THREE.Group;
  hip: THREE.Group[];
  knee: THREE.Group[];
}

interface QPose {
  bodyY: number;
  pitch: number;
  neck: number;
  headX: number;
  headY: number;
  headZ: number;
  tailX: number;
  tailY: number;
  earL: number;
  earR: number;
  earBack: number;
  jaw: number;
  px: number;
  py: number;
  pz: number;
  trem: number;
  eyeOpen: number;
  hip: number[];
  knee: number[];
}

const tv = new THREE.Vector3();

function newPose(): QPose {
  return { bodyY: 0, pitch: 0, neck: 0, headX: 0, headY: 0, headZ: 0, tailX: 0, tailY: 0, earL: 0, earR: 0, earBack: 0, jaw: 0, px: 0, py: 0, pz: 0, trem: 0, eyeOpen: 1, hip: [0, 0, 0, 0], knee: [0, 0, 0, 0] };
}

/** Procedural four-legged animal (wolf, goat, fox, stag, rabbit, squirrel …). */
export class QuadrupedActor extends Actor {
  readonly spec: QuadSpec;
  private rig!: QuadRig;
  private seed: number;
  private glanceTimer = 1.5;
  private glance = { yaw: 0, pitch: 0 };
  private graze = 0;
  private grazeTimer = 4;
  private earTwitch = 0;
  private twitchTimer = 3;
  private blink = 0;
  private blinkTimer = 2;
  private yawn = 0;
  private yawnTimer = 12;
  private sitBodyY = 0;
  private sitKnee = 0;
  private readonly restBodyY: number;
  /** NPC resting animals may yawn even in a seated pose. */
  allowYawn = false;

  constructor(spec: QuadSpec) {
    super({ id: spec.id, name: spec.name, height: spec.height, radius: spec.radius, walkSpeed: spec.walkSpeed, translucent: spec.translucent, ghostColor: spec.ghost });
    this.spec = spec;
    this.seed = [...spec.id].reduce((a, c) => a + c.charCodeAt(0), 0) * 0.31;
    this.restBodyY = spec.legLen;
    this.buildRig();
    // derived sitting layout
    const [, ry, rz] = spec.body;
    if (spec.sit === 'sit') {
      const a = -0.95;
      const hy = ry * 0.35;
      const hz = -rz * 0.55;
      const yPrime = hy * Math.cos(a) - hz * Math.sin(a);
      const bottom = yPrime - ry * 0.78;
      this.sitBodyY = 0.012 - bottom;
      const shY = -(rz * 0.5) * Math.sin(a);
      const need = this.sitBodyY + shY;
      const u = spec.legLen * 0.5;
      this.sitKnee = Math.acos(Math.min(1, Math.max(-1, (need - u) / (spec.legLen * 0.5))));
    } else {
      this.sitBodyY = ry * 0.45 + 0.03;
    }
    if (spec.scale) this.pivot.scale.setScalar(spec.scale);
  }

  private buildRig(): void {
    const s = this.spec;
    const c = s.col;
    const [rx, ry, rz] = s.body;
    const upper = s.legLen * 0.5;
    const lower = s.legLen * 0.5;
    const furGrad = (g: Geo): Geo => gradient(g, 'y', -ry * 0.35, ry * 1.45, c.belly, c.back);

    // ── groups ──
    const body = new THREE.Group();
    body.position.y = s.legLen;
    this.pivot.add(body);
    const neck = new THREE.Group();
    neck.position.set(0, ry * 0.85, rz * 0.62);
    body.add(neck);
    const head = new THREE.Group();
    head.position.y = s.neck.len;
    neck.add(head);
    const eyes = new THREE.Group();
    head.add(eyes);
    const tail = new THREE.Group();
    tail.position.set(0, ry * 0.95, -rz * 0.9);
    body.add(tail);

    // ── torso ──
    const bp: Geo[] = [];
    bp.push(furGrad(bake(ellipsoid(rx, ry, rz, 24, 16), { color: c.back, rough: 0.92 }, { p: [0, ry * 0.55, 0] })));
    bp.push(furGrad(bake(ellipsoid(rx * 0.95, ry * 0.98, rz * 0.5, 18, 12), { color: c.back, rough: 0.92 }, { p: [0, ry * 0.5, rz * 0.5] })));
    for (const sx of [1, -1]) bp.push(furGrad(bake(ellipsoid(rx * 0.55, ry * 0.78, rz * 0.42, 14, 10), { color: c.back, rough: 0.92 }, { p: [sx * rx * 0.72, ry * 0.35, -rz * 0.55] })));
    if (s.ruff) {
      bp.push(bake(ellipsoid(rx * 1.05, ry * 0.9, rz * 0.34, 16, 12), { color: c.belly, rough: 1 }, { p: [0, ry * 0.5, rz * 0.62] }));
      bp.push(bake(ellipsoid(rx * 0.25, ry * 0.12, rz * 0.8, 10, 8), { color: c.tip, rough: 1 }, { p: [0, ry * 1.5, 0] }));
    }
    const bodyGeo = merge(bp);
    mottle(bodyGeo, s.fur, 8, this.seedNum(1));
    this.addMesh(body, bodyGeo, 'body');

    // ── neck ──
    const np: Geo[] = [bake(limb(s.neck.r * 1.25, s.neck.r * 0.85, s.neck.len), { color: c.back, rough: 0.92 }, { r: [Math.PI, 0, 0] })];
    if (s.ruff) np.push(bake(ellipsoid(s.neck.r * 1.7, s.neck.len * 0.42, s.neck.r * 1.6, 14, 10), { color: c.belly, rough: 1 }, { p: [0, s.neck.len * 0.35, 0.01] }));
    if (s.beard || s.horns === 'antlers') np.push(bake(ellipsoid(s.neck.r * 1.4, s.neck.len * 0.3, s.neck.r * 1.3, 12, 8), { color: c.belly, rough: 1 }, { p: [0, s.neck.len * 0.6, -s.neck.r * 0.2] }));
    const neckGeo = merge(np);
    gradient(neckGeo, 'y', 0, s.neck.len, c.back, c.head);
    mottle(neckGeo, s.fur, 9, this.seedNum(2));
    this.addMesh(neck, neckGeo, 'neck');

    // ── head ──
    const hr = s.head.r;
    const sn = s.head.snout;
    const snr = s.head.snoutR;
    const hp: Geo[] = [];
    hp.push(bake(ellipsoid(hr * 0.95, hr * 0.85, hr * 1.1, 20, 14), { color: c.head, rough: 0.9 }, { p: [0, hr * 0.1, hr * 0.1] }));
    hp.push(bake(ellipsoid(snr, snr * 0.78, sn * 0.55, 16, 12), { color: c.snout, rough: 0.85 }, { p: [0, -hr * 0.18, hr * 0.55 + sn * 0.42] }));
    hp.push(bake(ellipsoid(snr * 0.45, snr * 0.36, snr * 0.42, 10, 8), { color: c.nose, rough: 0.3 }, { p: [0, -hr * 0.08, hr * 0.55 + sn * 0.95] }));
    for (const sx of [1, -1]) hp.push(bake(ellipsoid(hr * 0.5, hr * 0.42, hr * 0.5, 12, 8), { color: c.head, rough: 1 }, { p: [sx * hr * 0.62, -hr * 0.12, hr * 0.02] }));
    if (s.fangs) for (const sx of [1, -1]) hp.push(bake(cone(snr * 0.13, snr * 0.5, 6), { color: '#f4efe4', rough: 0.4 }, { p: [sx * snr * 0.62, -hr * 0.18 - snr * 0.9, hr * 0.55 + sn * 0.8], r: [Math.PI, 0, 0] }));
    if (s.beard) hp.push(bake(cone(snr * 0.34, snr * 1.6, 8), { color: c.belly, rough: 1 }, { p: [0, -hr * 0.28 - snr * 1.05, hr * 0.55 + sn * 0.62], r: [Math.PI + 0.25, 0, 0] }));
    // horns
    if (s.horns === 'goat') {
      for (const sx of [1, -1]) {
        hp.push(bake(tube([[sx * hr * 0.35, hr * 0.78, hr * 0.0], [sx * hr * 0.42, hr * 1.35, -hr * 0.2], [sx * hr * 0.5, hr * 1.75, -hr * 0.75], [sx * hr * 0.55, hr * 1.75, -hr * 1.3]], hr * 0.16, 16, 8, hr * 0.04), { color: c.horn, rough: 0.55 }));
        for (let k = 0; k < 4; k++) hp.push(bake(new THREE.TorusGeometry(hr * (0.15 - k * 0.02), hr * 0.03, 5, 10), { color: '#a08a62', rough: 0.6 }, { p: [sx * hr * (0.37 + k * 0.03), hr * (0.95 + k * 0.17), -hr * (0.05 + k * 0.06)], r: [Math.PI / 2 - 0.2, 0, 0] }));
      }
    }
    if (s.horns === 'antlers') {
      const A: Surface = { color: '#f5e6b8', rough: 0.4, emit: 1.6 };
      const T: Surface = { color: '#9ff6d8', rough: 0.3, emit: 3.2 };
      for (const sx of [1, -1]) {
        const beam: V3[] = [[sx * hr * 0.4, hr * 0.8, -hr * 0.1], [sx * hr * 0.9, hr * 1.9, -hr * 0.35], [sx * hr * 1.6, hr * 3.1, -hr * 0.9], [sx * hr * 1.9, hr * 4.3, -hr * 1.2]];
        hp.push(bake(tube(beam, hr * 0.12, 14, 6, hr * 0.05), A));
        const tines: Array<[number, V3[]]> = [
          [0.4, [[sx * hr * 1.0, hr * 2.1, -hr * 0.4], [sx * hr * 1.5, hr * 2.6, 0], [sx * hr * 1.7, hr * 3.3, hr * 0.4]]],
          [0.6, [[sx * hr * 1.5, hr * 3.0, -hr * 0.8], [sx * hr * 2.3, hr * 3.5, -hr * 0.8], [sx * hr * 2.7, hr * 4.3, -hr * 0.9]]],
          [0.8, [[sx * hr * 1.75, hr * 3.8, -hr * 1.1], [sx * hr * 1.3, hr * 4.5, -hr * 1.0], [sx * hr * 1.2, hr * 5.3, -hr * 0.9]]],
          [0.3, [[sx * hr * 0.7, hr * 1.5, -hr * 0.2], [sx * hr * 0.6, hr * 2.0, hr * 0.6], [sx * hr * 0.5, hr * 2.4, hr * 1.2]]],
        ];
        for (const [, pts] of tines) {
          hp.push(bake(tube(pts, hr * 0.07, 10, 5, hr * 0.025), A));
          const e = pts[pts.length - 1]!;
          hp.push(bake(ellipsoid(hr * 0.09, hr * 0.09, hr * 0.09, 8, 6), T, { p: e }));
        }
        hp.push(bake(ellipsoid(hr * 0.12, hr * 0.12, hr * 0.12, 8, 6), T, { p: beam[3]! }));
      }
    }
    const headGeo = merge(hp);
    mottle(headGeo, s.fur * 0.7, 12, this.seedNum(3));
    this.addMesh(head, headGeo, 'head');

    // jaw (wolf & fox)
    let jaw: THREE.Group | null = null;
    if (s.jaw) {
      jaw = new THREE.Group();
      jaw.position.set(0, -hr * 0.36, hr * 0.42);
      head.add(jaw);
      const jp: Geo[] = [
        bake(ellipsoid(snr * 0.82, snr * 0.32, sn * 0.5, 14, 8), { color: c.snout, rough: 0.85 }, { p: [0, -snr * 0.12, sn * 0.5] }),
        bake(ellipsoid(snr * 0.5, snr * 0.14, sn * 0.36, 10, 6), { color: '#d86a78', rough: 0.4 }, { p: [0, snr * 0.08, sn * 0.5] }),
      ];
      if (s.fangs) for (const sx of [1, -1]) jp.push(bake(cone(snr * 0.11, snr * 0.42, 6), { color: '#f4efe4', rough: 0.4 }, { p: [sx * snr * 0.55, snr * 0.1, sn * 0.85] }));
      this.addMesh(jaw, merge(jp), 'jaw');
    }

    // eyes
    const ep: Geo[] = [];
    for (const sx of [1, -1]) {
      const ex = sx * hr * 0.66;
      const ey = hr * 0.3;
      const ez = hr * 0.62;
      ep.push(bake(ellipsoid(hr * 0.19, hr * (s.slitEyes ? 0.17 : 0.17), hr * 0.13, 12, 8), { color: c.eye, rough: 0.2, emit: 0.25 }, { p: [ex, ey, ez], r: [0, sx * 0.5, 0] }));
      ep.push(bake(ellipsoid(hr * (s.slitEyes ? 0.15 : 0.08), hr * (s.slitEyes ? 0.035 : 0.13), hr * 0.06, 8, 6), { color: '#0a0806', rough: 0.1 }, { p: [ex + sx * hr * 0.03, ey, ez + hr * 0.09], r: [0, sx * 0.5, 0] }));
      ep.push(bake(ellipsoid(hr * 0.035, hr * 0.035, hr * 0.02, 6, 5), { color: '#ffffff', rough: 0.1, emit: 1.4 }, { p: [ex + sx * hr * 0.02, ey + hr * 0.07, ez + hr * 0.14] }));
    }
    this.addMesh(eyes, merge(ep), 'eyes');

    // ears
    const mkEar = (sx: number): THREE.Group => {
      const g = new THREE.Group();
      const e = s.ear;
      g.position.set(sx * hr * (e.kind === 'leaf' ? 0.78 : 0.58), hr * (e.kind === 'leaf' ? 0.55 : 0.78), -hr * 0.12);
      const ep2: Geo[] = [];
      if (e.kind === 'point') {
        ep2.push(bake(cone(e.w, e.len, 8), { color: c.head, rough: 0.95 }, { p: [0, e.len / 2, 0], s: [1, 1, 0.55] }));
        ep2.push(bake(cone(e.w * 0.62, e.len * 0.85, 8), { color: c.inner, rough: 0.9 }, { p: [0, e.len * 0.44, e.w * 0.18], s: [1, 1, 0.4] }));
      } else if (e.kind === 'leaf') {
        ep2.push(bake(ellipsoid(e.len * 0.5, e.w * 0.28, e.w, 12, 8), { color: c.head, rough: 0.95 }, { p: [sx * e.len * 0.45, 0, 0], r: [0, 0, sx * -0.2] }));
        ep2.push(bake(ellipsoid(e.len * 0.36, e.w * 0.12, e.w * 0.62, 10, 6), { color: c.inner, rough: 0.9 }, { p: [sx * e.len * 0.45, 0.004, e.w * 0.08], r: [0, 0, sx * -0.2] }));
      } else {
        ep2.push(bake(ellipsoid(e.w, e.len * 0.5, e.w * 0.35, 12, 10), { color: c.head, rough: 0.95 }, { p: [0, e.len * 0.5, 0] }));
        ep2.push(bake(ellipsoid(e.w * 0.62, e.len * 0.4, e.w * 0.2, 10, 8), { color: c.inner, rough: 0.9 }, { p: [0, e.len * 0.5, e.w * 0.18] }));
      }
      this.addMesh(g, merge(ep2), sx > 0 ? 'earL' : 'earR');
      head.add(g);
      return g;
    };
    const earL = mkEar(1);
    const earR = mkEar(-1);

    // ── tail ──
    const tp: Geo[] = [];
    const t = s.tail;
    if (t.kind === 'bushy') {
      const sizes = [0.7, 1.0, 0.95, 0.7, 0.45];
      for (let k = 0; k < sizes.length; k++) {
        const u = k / (sizes.length - 1);
        const surf: Surface = { color: k >= sizes.length - 2 ? c.tip : c.tail, rough: 1 };
        tp.push(bake(ellipsoid(t.r * sizes[k]!, t.r * sizes[k]! * 0.92, t.len * 0.16, 12, 8), surf, { p: [0, -u * u * t.len * 0.12, -u * t.len * 0.86] }));
      }
    } else if (t.kind === 'thin') {
      tp.push(bake(tube([[0, 0, 0], [0, -0.02, -t.len * 0.5], [0, -0.06, -t.len]], t.r, 8, 6, t.r * 0.4), { color: c.tail, rough: 0.9 }));
    } else if (t.kind === 'puff') {
      tp.push(bake(ellipsoid(t.r, t.r, t.r * 1.1, 12, 10), { color: c.tip, rough: 1 }, { p: [0, 0, -t.len * 0.5] }));
    } else {
      tp.push(bake(cone(t.r, t.len, 8), { color: c.tail, rough: 0.9 }, { p: [0, 0, -t.len * 0.5], r: [-Math.PI / 2 - 0.0, 0, 0] }));
      tp.push(bake(ellipsoid(t.r * 0.9, t.r * 0.7, t.len * 0.3, 8, 6), { color: c.belly, rough: 1 }, { p: [0, -t.r * 0.4, -t.len * 0.4] }));
    }
    this.addMesh(tail, merge(tp), 'tail');

    // ── legs ──
    const hips: THREE.Group[] = [];
    const knees: THREE.Group[] = [];
    const legX = rx * 0.6;
    const defs: Array<{ x: number; z: number; rear: boolean }> = [
      { x: legX, z: rz * 0.5, rear: false },
      { x: -legX, z: rz * 0.5, rear: false },
      { x: legX * 1.12, z: -rz * 0.6, rear: true },
      { x: -legX * 1.12, z: -rz * 0.6, rear: true },
    ];
    for (const d of defs) {
      const hip = new THREE.Group();
      hip.position.set(d.x, ry * 0.05, d.z);
      body.add(hip);
      const thick = d.rear ? 1.25 : 1;
      const up = bake(limb(s.legR * 1.7 * thick, s.legR * 1.1, upper), { color: c.legs, rough: 0.92 });
      gradient(up, 'y', 0, -upper, c.back, c.legs);
      mottle(up, s.fur, 14, this.seedNum(5));
      this.addMesh(hip, up, 'upperLeg');
      const knee = new THREE.Group();
      knee.position.y = -upper;
      hip.add(knee);
      const lp: Geo[] = [bake(limb(s.legR * 1.12, s.legR * 0.82, lower * 0.86), { color: c.legs, rough: 0.9 })];
      if (s.hooves) {
        lp.push(bake(cyl(s.legR * 0.86, s.legR * 1.02, s.legR * 1.9, 9), { color: c.hoof, rough: 0.45 }, { p: [0, -lower + s.legR * 0.95, s.legR * 0.1] }));
        lp.push(bake(ellipsoid(s.legR * 0.7, s.legR * 0.7, s.legR * 0.85, 8, 6), { color: c.legs, rough: 0.9 }, { p: [0, -lower * 0.86 - s.legR * 0.2, 0] }));
      } else {
        lp.push(bake(ellipsoid(s.legR * 1.35, s.legR * 0.78, s.legR * 2.1, 10, 8), { color: c.legs, rough: 0.9 }, { p: [0, -lower + s.legR * 0.62, s.legR * 0.7] }));
        for (let k = -1; k <= 1; k++) lp.push(bake(cone(s.legR * 0.2, s.legR * 0.45, 5), { color: '#2b2622', rough: 0.5 }, { p: [k * s.legR * 0.5, -lower + s.legR * 0.42, s.legR * 2.6], r: [Math.PI / 2, 0, 0] }));
      }
      const lg = merge(lp);
      this.addMesh(knee, lg, 'lowerLeg');
      hips.push(hip);
      knees.push(knee);
    }
    this.rig = { body, neck, head, jaw, eyes, earL, earR, tail, hip: hips, knee: knees };
  }

  private seedNum(k: number): number {
    return this.seed * 3.7 + k * 11.1;
  }

  /** Small named helpers for AI-driven NPC behaviour. */
  yawnNow(): void {
    this.yawn = 1.6;
  }

  protected pose(dt: number): void {
    const s = this.spec;
    const t = this.time + this.seed;
    const w = this.moveBlend;
    const idle = 1 - w;
    const p = newPose();
    const seated = this.mood === 'sit' || this.mood === 'ride';

    // rest stance
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      p.hip[i] = rear ? -s.hock : 0.02;
      p.knee[i] = rear ? s.hock * 2 : 0.06;
    }
    const br = Math.sin(t * 1.9) * 0.5 + 0.5;

    // idle behaviour timers
    this.glanceTimer -= dt;
    if (this.glanceTimer <= 0) {
      this.glanceTimer = 1.8 + Math.random() * 3.5;
      this.glance = Math.random() < 0.35 ? { yaw: 0, pitch: 0 } : { yaw: (Math.random() - 0.5) * 1.3, pitch: (Math.random() - 0.4) * 0.35 };
    }
    this.twitchTimer -= dt;
    if (this.twitchTimer <= 0) {
      this.twitchTimer = 2 + Math.random() * 5;
      this.earTwitch = 0.35;
    }
    if (this.earTwitch > 0) this.earTwitch -= dt;
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2 + Math.random() * 3.5;
      this.blink = 0.13;
    }
    if (this.blink > 0) this.blink -= dt;
    if (s.jaw && (!seated || this.allowYawn)) {
      this.yawnTimer -= dt;
      if (this.yawnTimer <= 0) {
        this.yawnTimer = 16 + Math.random() * 12;
        this.yawn = 1.7;
      }
    }
    if (this.yawn > 0) this.yawn -= dt;
    if ((s.graze ?? !!s.hooves) && !seated && w < 0.1) {
      this.grazeTimer -= dt;
      if (this.grazeTimer <= 0) {
        this.graze = this.graze > 0 ? 0 : 2.2 + Math.random() * 2;
        this.grazeTimer = this.graze > 0 ? this.graze : 5 + Math.random() * 6;
      }
    }

    // ── idle ──
    p.headY = this.glance.yaw * idle * (seated ? 0.6 : 1);
    p.headX = this.glance.pitch * idle;
    p.earL = Math.sin(t * 0.8) * 0.05 + (this.earTwitch > 0 ? Math.sin(this.earTwitch * 60) * 0.25 : 0);
    p.earR = Math.sin(t * 0.7 + 1) * 0.05;
    const wag = s.jaw ? 0.25 : s.tail.kind === 'puff' ? 0.05 : 0.35;
    p.tailY = Math.sin(t * (s.hooves ? 5 : 1.6)) * wag * idle;
    p.tailX = s.tail.rest;
    p.eyeOpen = this.blink > 0 ? 0.1 : 1;
    if (this.graze > 0 && (s.graze ?? !!s.hooves)) {
      const k = Math.sin(clamp01(1 - this.graze / 3) * Math.PI) ;
      p.neck = 0.5 * k;
      p.headX += 0.9 * k;
      p.jaw = Math.abs(Math.sin(t * 9)) * 0.06 * k;
    }
    if (this.yawn > 0) {
      const k = Math.sin(clamp01(1 - this.yawn / 1.7) * Math.PI);
      p.jaw = 0.6 * k;
      p.headX -= 0.35 * k;
      p.eyeOpen = Math.min(p.eyeOpen, 1 - 0.85 * k);
    }

    // ── walk (trot: diagonal pairs) ──
    if (w > 0.001) {
      const g = this.gait;
      const A = s.stride;
      const ph = [0, Math.PI, Math.PI, 0];
      for (let i = 0; i < 4; i++) {
        const sw = Math.sin(g + ph[i]!);
        const cs = Math.cos(g + ph[i]!);
        p.hip[i] = p.hip[i]! * (1 - w) + (sw * A - (i >= 2 ? s.hock * 0.5 : 0)) * w;
        p.knee[i] = p.knee[i]! * (1 - w) + (Math.max(0, -cs) * 1.0 + 0.12 + (i >= 2 ? s.hock : 0)) * w;
      }
      p.bodyY += Math.sin(g * 2) * 0.012 * w * s.legLen * 2;
      p.pitch += Math.sin(g * 2 + 1) * 0.03 * w;
      p.neck += -Math.sin(g * 2 + 0.6) * 0.06 * w;
      p.tailY += Math.sin(g) * 0.15 * w;
      p.headX += Math.sin(g * 2) * 0.05 * w;
    }

    // ── seated in the boat ──
    if (seated) {
      if (s.sit === 'sit') {
        p.pitch = -0.95;
        p.bodyY = this.sitBodyY - this.restBodyY;
        p.hip[0] = p.hip[1] = 0.95;
        p.knee[0] = p.knee[1] = this.sitKnee;
        p.hip[2] = p.hip[3] = -1.4;
        p.knee[2] = p.knee[3] = 2.4;
        p.neck += -0.6;
      } else {
        p.pitch = 0.0;
        p.bodyY = this.sitBodyY - this.restBodyY;
        p.hip[0] = p.hip[1] = -0.95;
        p.knee[0] = p.knee[1] = 2.5;
        p.hip[2] = p.hip[3] = -1.25;
        p.knee[2] = p.knee[3] = 2.6;
        p.neck += -0.15;
        p.headX -= 0.1;
      }
    }

    // ── hop (boarding / leaving / ambient hops) ──
    if (this.hopProgress >= 0) {
      const k = Math.sin(this.hopProgress * Math.PI);
      p.hip[0] = p.hip[1] = -1.05 * k;
      p.hip[2] = p.hip[3] = 0.85 * k;
      p.knee[0] = p.knee[1] = 0.5 * k;
      p.knee[2] = p.knee[3] = 0.7 * k;
      p.pitch = -0.32 * k;
      p.neck += -0.15 * k;
      p.tailX = s.tail.rest + 0.5 * k;
      p.headX -= 0.2 * k;
    }

    // ── reactions ──
    if (this.reaction) {
      const e = this.reactionEnvelope();
      const rt = this.reaction.t;
      switch (this.reaction.kind) {
        case 'select':
          p.neck += -0.28 * e;
          p.headX -= 0.25 * e;
          p.earL += 0.35 * e;
          p.earR += 0.35 * e;
          p.tailY += Math.sin(rt * 14) * 0.5 * e;
          p.headY *= 1 - e;
          break;
        case 'celebrate':
        case 'cheer':
          p.py += Math.abs(Math.sin(rt * 9)) * 0.17 * e;
          p.tailY += Math.sin(rt * 16) * 0.6 * e;
          p.headX -= 0.3 * e;
          p.earL += 0.3 * e;
          p.earR += 0.3 * e;
          if (!seated) p.hip[0] = p.hip[1] = -0.5 * e * Math.abs(Math.sin(rt * 9));
          break;
        case 'fail':
          p.headY += Math.sin(rt * 12) * 0.55 * e;
          p.headX += 0.5 * e;
          p.earBack += 0.8 * e;
          p.tailX -= 0.7 * e;
          break;
        case 'fear':
          p.trem = e;
          p.pz -= 0.32 * e * (seated ? 0 : 1);
          p.earBack += 1.0 * e;
          p.tailX -= 1.1 * e;
          p.neck += 0.15 * e;
          p.headX += 0.2 * e;
          p.eyeOpen = 1 + 0.25 * e;
          if (!seated) {
            const st = Math.sin(rt * 9);
            p.hip[0] += st * 0.3 * e;
            p.hip[3] += st * 0.3 * e;
            p.hip[1] -= st * 0.3 * e;
            p.hip[2] -= st * 0.3 * e;
          }
          break;
        case 'shiver':
          p.trem = e;
          p.earBack += 0.5 * e;
          break;
        case 'threat':
          // lowered head, stiff stance, snarl
          p.neck += 0.45 * e;
          p.headX += 0.5 * e;
          p.headY *= 1 - e;
          p.earBack += 1.1 * e;
          p.tailX += 0.35 * e;
          p.tailY *= 1 - e;
          p.jaw = Math.max(p.jaw, (0.32 + Math.sin(rt * 26) * 0.05) * e);
          p.bodyY -= 0.03 * e;
          p.pitch += 0.1 * e;
          p.trem = 0.25 * e;
          if (!seated) {
            p.hip[0] += -0.2 * e;
            p.hip[1] += -0.2 * e;
            p.hip[2] += 0.15 * e;
            p.hip[3] += 0.15 * e;
          }
          break;
        case 'nod':
          p.headX += Math.sin(rt * 10) * 0.3 * e;
          break;
        case 'wave':
          if (!seated) {
            p.hip[0] = -1.15 * e + Math.sin(rt * 10) * 0.3 * e;
            p.knee[0] = 1.2 * e;
          }
          p.tailY += Math.sin(rt * 12) * 0.5 * e;
          break;
      }
    }

    // ── look target ──
    if (this.lookTarget) {
      this.rig.head.getWorldPosition(tv);
      const la = this.lookAngles(tv, 1.0, 0.45);
      p.headY = la.yaw * 0.9;
      p.headX = la.pitch * 0.7 + (this.reaction ? p.headX : 0);
    }

    // ── smooth & apply ──
    this.applyPose(p, 1 - Math.exp(-dt * 12), t, br);
  }

  private applyPose(target: QPose, k: number, t: number, br: number): void {
    const s = this.spec;
    const r = this.rig;
    const ease = (a: number, b: number, kk = k): number => a + (b - a) * kk;
    const prev = this.eased;
    prev.bodyY = ease(prev.bodyY, target.bodyY);
    prev.pitch = ease(prev.pitch, target.pitch);
    prev.neck = ease(prev.neck, target.neck);
    prev.headX = ease(prev.headX, target.headX);
    prev.headY = ease(prev.headY, target.headY);
    prev.headZ = ease(prev.headZ, target.headZ);
    prev.tailX = ease(prev.tailX, target.tailX);
    prev.tailY = ease(prev.tailY, target.tailY, Math.min(1, k * 1.6));
    prev.earL = ease(prev.earL, target.earL, Math.min(1, k * 1.8));
    prev.earR = ease(prev.earR, target.earR, Math.min(1, k * 1.8));
    prev.earBack = ease(prev.earBack, target.earBack);
    prev.jaw = ease(prev.jaw, target.jaw, Math.min(1, k * 1.5));
    prev.px = ease(prev.px, target.px);
    prev.py = ease(prev.py, target.py, Math.min(1, k * 2));
    prev.pz = ease(prev.pz, target.pz);
    prev.trem = ease(prev.trem, target.trem);
    prev.eyeOpen = ease(prev.eyeOpen, target.eyeOpen, Math.min(1, k * 2.5));
    for (let i = 0; i < 4; i++) {
      prev.hip[i] = ease(prev.hip[i]!, target.hip[i]!, Math.min(1, k * 1.4));
      prev.knee[i] = ease(prev.knee[i]!, target.knee[i]!, Math.min(1, k * 1.4));
    }
    const e = prev;
    const tr = e.trem;
    this.pivot.position.set(e.px + Math.sin(t * 58) * 0.006 * tr, e.py + Math.sin(t * 47) * 0.004 * tr, e.pz);
    r.body.position.y = this.restBodyY + e.bodyY;
    r.body.rotation.x = e.pitch;
    r.body.scale.set(1 + br * 0.006, 1 + br * 0.014, 1 + br * 0.01);
    r.neck.rotation.set(s.neck.tilt + e.neck, e.headY * 0.45, 0);
    r.head.rotation.set(s.head.pitch - (e.pitch + s.neck.tilt + e.neck) + e.headX * 0.9, e.headY * 0.55, e.headZ, 'YXZ');
    r.eyes.scale.set(1, Math.max(0.05, e.eyeOpen), 1);
    if (r.jaw) r.jaw.rotation.x = e.jaw;
    const back = e.earBack;
    r.earL.rotation.set(-back * 0.5 - e.earL * 0.5, 0, s.ear.kind === 'leaf' ? -0.2 - e.earL * 0.6 + back * 0.7 : -0.28 - e.earL + back * 0.35);
    r.earR.rotation.set(-back * 0.5 - e.earR * 0.5, 0, s.ear.kind === 'leaf' ? 0.2 + e.earR * 0.6 - back * 0.7 : 0.28 + e.earR - back * 0.35);
    r.tail.rotation.set(e.tailX, e.tailY, 0, 'YXZ');
    for (let i = 0; i < 4; i++) {
      r.hip[i]!.rotation.x = e.hip[i]!;
      r.knee[i]!.rotation.x = e.knee[i]!;
    }
  }

  private eased: QPose = newPose();
}

// ───────────────────────── species ─────────────────────────

const WOLF_COL = { back: '#5b5f66', belly: '#c9c4b6', legs: '#4a4d54', head: '#686b71', snout: '#9a978d', nose: '#121212', inner: '#c98f8a', hoof: '#222', eye: '#e7b13a', tail: '#54575d', tip: '#26272b', horn: '#fff' };

export function createWolf(): QuadrupedActor {
  return new QuadrupedActor({
    id: 'wolf',
    name: 'Wolf',
    body: [0.17, 0.19, 0.43],
    legLen: 0.5,
    legR: 0.046,
    hock: 0.3,
    neck: { len: 0.3, r: 0.12, tilt: 0.85 },
    head: { r: 0.125, snout: 0.2, snoutR: 0.072, pitch: 0.18 },
    ear: { kind: 'point', len: 0.17, w: 0.058 },
    tail: { kind: 'bushy', len: 0.6, r: 0.078, rest: -0.55 },
    fangs: true,
    jaw: true,
    ruff: true,
    col: WOLF_COL,
    fur: 0.26,
    sit: 'sit',
    height: 0.98,
    radius: 0.4,
    walkSpeed: 1.55,
    stride: 0.55,
  });
}

export function createGoat(): QuadrupedActor {
  return new QuadrupedActor({
    id: 'goat',
    name: 'Ziege',
    body: [0.2, 0.22, 0.36],
    legLen: 0.42,
    legR: 0.03,
    hock: 0.22,
    neck: { len: 0.32, r: 0.095, tilt: 0.6 },
    head: { r: 0.098, snout: 0.13, snoutR: 0.056, pitch: 0.3 },
    ear: { kind: 'leaf', len: 0.15, w: 0.05 },
    tail: { kind: 'puff', len: 0.1, r: 0.04, rest: 0.55 },
    horns: 'goat',
    beard: true,
    hooves: true,
    slitEyes: true,
    col: { back: '#f0e9d8', belly: '#f8f3e7', legs: '#e4dac6', head: '#f0e9d8', snout: '#e8ddca', nose: '#c9a09c', inner: '#e7b5b0', hoof: '#3b342c', eye: '#dcb43c', tail: '#f0e9d8', tip: '#e2d7c0', horn: '#cdb88e' },
    fur: 0.09,
    sit: 'crouch',
    height: 1.0,
    radius: 0.38,
    walkSpeed: 1.4,
    stride: 0.5,
  });
}

export function createFox(): QuadrupedActor {
  return new QuadrupedActor({
    id: 'fox',
    name: 'Fuchs',
    body: [0.11, 0.125, 0.28],
    legLen: 0.3,
    legR: 0.03,
    hock: 0.3,
    neck: { len: 0.2, r: 0.075, tilt: 0.9 },
    head: { r: 0.085, snout: 0.14, snoutR: 0.05, pitch: 0.16 },
    ear: { kind: 'point', len: 0.13, w: 0.048 },
    tail: { kind: 'bushy', len: 0.44, r: 0.062, rest: -0.35 },
    fangs: true,
    jaw: true,
    col: { back: '#d8772c', belly: '#f4e6cf', legs: '#3a2a22', head: '#dd7f30', snout: '#f2e3c8', nose: '#0d0d0d', inner: '#f0c9b0', hoof: '#222', eye: '#e5b02e', tail: '#d8772c', tip: '#fbf3e4', horn: '#fff' },
    fur: 0.2,
    sit: 'crouch',
    height: 0.55,
    radius: 0.25,
    walkSpeed: 1.8,
    stride: 0.55,
  });
}

export function createStag(): QuadrupedActor {
  return new QuadrupedActor({
    id: 'stag',
    name: 'Hirschgeist',
    body: [0.27, 0.3, 0.62],
    legLen: 0.98,
    legR: 0.052,
    hock: 0.18,
    neck: { len: 0.66, r: 0.15, tilt: 0.5 },
    head: { r: 0.155, snout: 0.3, snoutR: 0.085, pitch: 0.55 },
    ear: { kind: 'leaf', len: 0.22, w: 0.075 },
    tail: { kind: 'stag', len: 0.16, r: 0.06, rest: -0.4 },
    horns: 'antlers',
    hooves: true,
    beard: true,
    col: { back: '#9a6a40', belly: '#ead9b8', legs: '#7a5334', head: '#a06f44', snout: '#c9a67c', nose: '#2b211c', inner: '#f0d2b6', hoof: '#2a2521', eye: '#bff5dd', tail: '#9a6a40', tip: '#f3ead8', horn: '#fff' },
    fur: 0.16,
    sit: 'crouch',
    height: 2.2,
    radius: 0.6,
    walkSpeed: 1.3,
    stride: 0.42,
    translucent: true,
    ghost: new THREE.Color(0.35, 0.95, 0.7),
    scale: 1.15,
  });
}

export function createRabbit(id: string, tone: number): QuadrupedActor {
  const a = tone > 0.5;
  return new QuadrupedActor({
    id,
    name: 'Hase',
    body: [0.085, 0.095, 0.15],
    legLen: 0.11,
    legR: 0.02,
    hock: 0.55,
    neck: { len: 0.05, r: 0.06, tilt: 0.7 },
    head: { r: 0.062, snout: 0.05, snoutR: 0.036, pitch: 0.2 },
    ear: { kind: 'tall', len: 0.15, w: 0.028 },
    tail: { kind: 'puff', len: 0.06, r: 0.04, rest: 0.4 },
    graze: true,
    col: { back: a ? '#a48a68' : '#8d7a63', belly: '#eee4d2', legs: a ? '#8f7757' : '#7a6853', head: a ? '#a48a68' : '#8d7a63', snout: '#e8dcc6', nose: '#c78a86', inner: '#e8b4ae', hoof: '#222', eye: '#1a1210', tail: '#f5efe2', tip: '#f5efe2', horn: '#fff' },
    fur: 0.2,
    sit: 'crouch',
    height: 0.28,
    radius: 0.16,
    walkSpeed: 1.2,
    stride: 0.6,
  });
}

export function createSquirrel(): QuadrupedActor {
  return new QuadrupedActor({
    id: 'squirrel',
    name: 'Eichhoernchen',
    body: [0.05, 0.058, 0.1],
    legLen: 0.07,
    legR: 0.013,
    hock: 0.4,
    neck: { len: 0.04, r: 0.035, tilt: 0.7 },
    head: { r: 0.04, snout: 0.03, snoutR: 0.024, pitch: 0.15 },
    ear: { kind: 'point', len: 0.04, w: 0.014 },
    tail: { kind: 'bushy', len: 0.26, r: 0.045, rest: 1.35 },
    graze: true,
    col: { back: '#b6683a', belly: '#f0e0c8', legs: '#9c5530', head: '#b9703f', snout: '#ecd9bd', nose: '#1a1210', inner: '#e9b7a0', hoof: '#222', eye: '#150e0a', tail: '#b6683a', tip: '#e5a56b', horn: '#fff' },
    fur: 0.2,
    sit: 'sit',
    height: 0.22,
    radius: 0.12,
    walkSpeed: 1.6,
    stride: 0.6,
  });
}

// ───────────────────────── cabbage ─────────────────────────

function leafSheet(w: number, l: number, cup: number, curl: number, seed: number, colEdge: THREE.Color, colVein: THREE.Color, colBase: THREE.Color): Geo {
  const g = new THREE.PlaneGeometry(w, l, 6, 8);
  g.translate(0, l / 2, 0);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const v = pos.getY(i) / l;
    const prof = Math.pow(Math.max(0, Math.sin(Math.PI * (0.12 + 0.88 * Math.min(1, Math.max(0, v))))), 0.65);
    const x = pos.getX(i) * prof;
    const u = pos.getX(i) / (w / 2);
    const z = cup * u * u * w * 0.5 - curl * v * v * l + 0.018 * Math.sin(u * 8 + v * 6 + seed) * v;
    pos.setXYZ(i, x, pos.getY(i), z);
    tmp.copy(colEdge).lerp(colVein, Math.exp(-u * u * 7)).lerp(colBase, 1 - v * 1.2 > 0 ? 1 - v * 1.2 : 0);
    tmp.multiplyScalar(0.9 + 0.2 * Math.sin(seed + v * 7));
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  g.computeVertexNormals();
  const out = bake(g, { color: '#ffffff', rough: 0.55 });
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** Magical hopping cabbage in a woven basket. */
export class CabbageActor extends Actor {
  private leaves = new THREE.Group();
  private ringA = new THREE.Group();
  private ringB = new THREE.Group();
  private outer = new THREE.Group();
  private mid = new THREE.Group();
  private hopPhase = 0;
  private idleHop = 3;
  private seed = 4.2;

  constructor() {
    super({ id: 'cabbage', name: 'Kohlkopf', height: 0.6, radius: 0.32, walkSpeed: 1.25 });
    this.mat.material.side = THREE.DoubleSide;
    const straw = '#cfa85c';
    const dark = '#8f6a34';
    // basket
    const bp: Geo[] = [];
    const lathePts: Array<[number, number]> = [[0.0, 0.0], [0.17, 0.0], [0.21, 0.05], [0.25, 0.15], [0.27, 0.23]];
    const bcurve = new THREE.LatheGeometry(lathePts.map(([r, y]) => new THREE.Vector2(r, y)), 24);
    bp.push(bake(bcurve, { color: straw, rough: 0.95 }));
    for (let k = 0; k < 6; k++) {
      const y = 0.03 + k * 0.038;
      const rr = 0.18 + (y / 0.23) * 0.09;
      bp.push(bake(new THREE.TorusGeometry(rr + 0.004, 0.011, 5, 26), { color: k % 2 ? dark : '#dfbc72', rough: 0.95 }, { p: [0, y, 0], r: [Math.PI / 2, 0, 0] }));
    }
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      bp.push(bake(cyl(0.007, 0.007, 0.24, 4), { color: dark, rough: 0.95 }, { p: [Math.sin(a) * 0.235, 0.12, Math.cos(a) * 0.235], r: [Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2] }));
    }
    bp.push(bake(new THREE.TorusGeometry(0.272, 0.018, 6, 28), { color: '#a87a3c', rough: 0.9 }, { p: [0, 0.235, 0], r: [Math.PI / 2, 0, 0] }));
    for (const sx of [1, -1]) bp.push(bake(new THREE.TorusGeometry(0.1, 0.01, 5, 14, Math.PI), { color: '#a87a3c', rough: 0.9 }, { p: [sx * 0.272, 0.27, 0], r: [0, Math.PI / 2, 0] }));
    this.addMesh(this.pivot, merge(bp), 'basket');

    // leaves
    this.leaves.position.y = 0.2;
    this.pivot.add(this.leaves);
    this.leaves.add(this.outer, this.mid);
    const eOuter = new THREE.Color('#3e8a4e');
    const vOuter = new THREE.Color('#8fcf7a');
    const bOuter = new THREE.Color('#5aa860');
    const q = new THREE.Quaternion();
    const qx = new THREE.Quaternion();
    const m4 = new THREE.Matrix4();
    const addRing = (grp: THREE.Group, n: number, tilt: number, size: number, r0: number, y0: number, eC: THREE.Color, vC: THREE.Color, bC: THREE.Color, seed: number): void => {
      const parts: Geo[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + seed;
        const sz = size * (0.9 + 0.2 * Math.sin(k * 2.7 + seed));
        const leaf = leafSheet(sz * 0.95, sz * 1.15, 0.5, 0.35, k + seed, eC, vC, bC);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
        qx.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt + 0.12 * Math.sin(k * 3.1));
        q.multiply(qx);
        m4.compose(new THREE.Vector3(Math.sin(a) * r0, y0, Math.cos(a) * r0), q, new THREE.Vector3(1, 1, 1));
        leaf.applyMatrix4(m4);
        parts.push(leaf);
      }
      this.addMesh(grp, merge(parts), 'leaves');
    };
    addRing(this.outer, 9, 1.05, 0.34, 0.08, 0.02, eOuter, vOuter, bOuter, 0.3);
    addRing(this.mid, 7, 0.6, 0.3, 0.05, 0.08, new THREE.Color('#5aa85a'), new THREE.Color('#b7e08a'), new THREE.Color('#84c070'), 1.1);
    const core: Geo[] = [bake(ellipsoid(0.17, 0.2, 0.17, 18, 14), { color: '#b6dc8a', rough: 0.6 }, { p: [0, 0.2, 0] })];
    const inner = new THREE.Group();
    inner.position.y = 0.0;
    this.leaves.add(inner);
    const ip: Geo[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.5;
      const leaf = leafSheet(0.2, 0.3, 0.7, 0.2, k * 1.7, new THREE.Color('#8fcf6e'), new THREE.Color('#d8f0a6'), new THREE.Color('#b0dc86'));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      qx.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.25);
      q.multiply(qx);
      m4.compose(new THREE.Vector3(Math.sin(a) * 0.04, 0.1, Math.cos(a) * 0.04), q, new THREE.Vector3(1, 1, 1));
      leaf.applyMatrix4(m4);
      ip.push(leaf);
    }
    ip.push(...core);
    this.addMesh(inner, merge(ip), 'core');

    // sparkles: two rotating rings of tiny glowing diamonds
    const mkSparkles = (n: number, radius: number, size: number, colors: string[], yy: number, parent: THREE.Object3D): void => {
      const parts: Geo[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        parts.push(bake(new THREE.OctahedronGeometry(size * (0.7 + 0.6 * ((k * 7) % 3) / 3), 0), { color: colors[k % colors.length]!, rough: 0.2, emit: 3.4 }, { p: [Math.sin(a) * radius, yy + Math.sin(k * 1.7) * 0.08, Math.cos(a) * radius], s: [1, 1.6, 1] }));
      }
      this.addMesh(parent, merge(parts), 'sparkles');
    };
    this.ringA.position.y = 0.3;
    this.ringB.position.y = 0.45;
    this.pivot.add(this.ringA, this.ringB);
    mkSparkles(7, 0.42, 0.024, ['#fff2b0', '#9ff7d0', '#ffffff'], 0, this.ringA);
    mkSparkles(5, 0.3, 0.02, ['#b8f0ff', '#fff0a8'], 0, this.ringB);
    // magic ground ring
    const ring = bake(new THREE.TorusGeometry(0.31, 0.011, 6, 40), { color: '#a6ffc8', rough: 0.4, emit: 2.4 }, { p: [0, 0.012, 0], r: [Math.PI / 2, 0, 0] });
    this.addMesh(this.root, ring, 'ring');
  }

  protected pose(dt: number): void {
    const t = this.time + this.seed;
    const w = this.moveBlend;
    const seated = this.mood === 'sit' || this.mood === 'ride';
    let py = 0;
    let tiltZ = 0;
    let sq = 1;
    const hover = seated ? 0.02 : 0.06 + Math.sin(t * 2.1) * 0.025;
    py += hover * (1 - w);
    // ambient little hop
    this.idleHop -= dt;
    if (this.idleHop <= 0 && !seated && w < 0.05) {
      this.idleHop = 3 + Math.random() * 3;
      this.hopPhase = 1;
    }
    if (this.hopPhase > 0) {
      this.hopPhase = Math.max(0, this.hopPhase - dt * 2.4);
      const u = 1 - this.hopPhase;
      py += Math.sin(u * Math.PI) * 0.14;
      sq = 1 + Math.sin(u * Math.PI) * 0.1 - (u < 0.15 || u > 0.85 ? 0.12 : 0);
    }
    if (w > 0.001) {
      const h = Math.abs(Math.sin(this.gait * 0.55));
      py += h * 0.24 * w;
      sq = 1 + (h - 0.4) * 0.16 * w;
      tiltZ = Math.sin(this.gait * 0.55) * 0.1 * w;
    }
    if (this.hopProgress >= 0) {
      const u = this.hopProgress;
      sq = 1 + Math.sin(u * Math.PI) * 0.16;
      tiltZ = Math.sin(u * Math.PI * 2) * 0.12;
    }
    let spin = 0;
    let shake = 0;
    if (this.reaction) {
      const e = this.reactionEnvelope();
      const rt = this.reaction.t;
      switch (this.reaction.kind) {
        case 'select':
          py += Math.abs(Math.sin(rt * 8)) * 0.1 * e;
          spin = rt * 3 * e;
          break;
        case 'celebrate':
        case 'cheer':
          py += Math.abs(Math.sin(rt * 7)) * 0.22 * e;
          spin = rt * 5;
          break;
        case 'fail':
          sq = 1 - 0.2 * e;
          shake = Math.sin(rt * 22) * 0.05 * e;
          break;
        case 'fear':
        case 'shiver':
          shake = Math.sin(rt * 50) * 0.035 * e;
          break;
        case 'threat':
          shake = Math.sin(rt * 30) * 0.02 * e;
          break;
        case 'nod':
          py += Math.abs(Math.sin(rt * 9)) * 0.06 * e;
          break;
        case 'wave':
          tiltZ += Math.sin(rt * 10) * 0.2 * e;
          break;
      }
    }
    this.pivot.position.set(shake, py, 0);
    this.pivot.rotation.set(0, spin, tiltZ);
    this.pivot.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.leaves.rotation.y = Math.sin(t * 0.7) * 0.06;
    this.outer.rotation.z = Math.sin(t * 1.3) * 0.02;
    this.mid.rotation.x = Math.sin(t * 1.6 + 1) * 0.025;
    const pulse = 1 + Math.sin(t * 3.3) * 0.12;
    this.ringA.rotation.y = t * 1.3;
    this.ringB.rotation.y = -t * 1.9;
    this.ringA.scale.setScalar(pulse);
    this.ringB.scale.setScalar(2 - pulse);
    this.ringA.position.y = 0.3 + Math.sin(t * 1.4) * 0.03;
    this.ringB.position.y = 0.46 + Math.sin(t * 1.9 + 1) * 0.03;
  }
}

