import * as THREE from 'three/webgpu';
import { Actor } from '../../characters/Actor';
import { HumanoidActor } from '../../characters/HumanoidActor';
import type { HumanoidSpec } from '../../characters/HumanoidBuilder';
import { bake, cone, cyl, ellipsoid, extrude, limb, merge, roundedBox, torus, tube, type Place, type Surface } from '../../characters/geo';
import { S, glowVc } from './util';

type Geo = THREE.BufferGeometry;
type Part = [Geo, Surface, Place?];
const B = (parts: Part[]): Geo => merge(parts.map(([g, s, p]) => bake(g, s, p)));

// ───────────────────────── guardians ─────────────────────────

function spearGeo(): Geo {
  return B([
    [cyl(0.021, 0.024, 2.3, 8), S('#5a3b22', 0.6), { p: [0, 0.55, 0] }],
    [cyl(0.03, 0.03, 0.22, 8), S('#d0a040', 0.3, 0.9), { p: [0, 1.5, 0] }],
    [cyl(0.03, 0.03, 0.06, 8), S('#d0a040', 0.3, 0.9), { p: [0, -0.35, 0] }],
    [ellipsoid(0.06, 0.24, 0.014, 12, 10), S('#e0b458', 0.28, 0.95), { p: [0, 1.93, 0] }],
    [cone(0.03, 0.14, 8), S('#e0b458', 0.28, 0.95), { p: [0, 2.16, 0] }],
    [torus(0.05, 0.012, Math.PI * 2, 14, 6), S('#9c2b2b', 0.7), { p: [0, 1.7, 0], r: [Math.PI / 2, 0, 0] }],
    [tube([[0, 1.7, 0.04], [0.04, 1.5, 0.06], [0.02, 1.32, 0.05]], 0.02, 8, 5), S('#9c2b2b', 0.8)],
    [ellipsoid(0.035, 0.05, 0.035, 8, 6), S('#46e6d0', 0.2, 0, 1.6), { p: [0, 1.7, 0.05] }],
  ]);
}

function lanternStaffGeo(): Geo {
  const arc = torus(0.13, 0.018, Math.PI * 1.35, 22, 6);
  return B([
    [cyl(0.02, 0.024, 2.05, 8), S('#3a5a55', 0.5, 0.3), { p: [0, 0.45, 0] }],
    [cyl(0.032, 0.032, 0.05, 8), S('#e6c060', 0.3, 0.9), { p: [0, 0.2, 0] }],
    [cyl(0.032, 0.032, 0.05, 8), S('#e6c060', 0.3, 0.9), { p: [0, 0.9, 0] }],
    [arc, S('#e6c060', 0.28, 0.95), { p: [0, 1.62, 0], r: [0, 0, Math.PI * 0.32 - Math.PI / 2 + 0.0] }],
    [ellipsoid(0.06, 0.06, 0.06, 12, 10), S('#7ff5e0', 0.15, 0, 3.2), { p: [0.0, 1.62, 0] }],
    [ellipsoid(0.03, 0.05, 0.03, 8, 6), S('#e6c060', 0.3, 0.9), { p: [0, 1.5, 0] }],
    [tube([[0, 1.48, 0], [0.05, 1.3, 0.02], [0.0, 1.12, 0.03]], 0.012, 8, 5), S('#d05a7a', 0.8)],
  ]);
}

function glaiveGeo(): Geo {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.quadraticCurveTo(0.16, 0.12, 0.09, 0.42);
  sh.quadraticCurveTo(0.04, 0.3, 0.0, 0.34);
  sh.lineTo(-0.02, 0.05);
  sh.lineTo(0, 0);
  const blade = extrude(sh, 0.025, 0.004);
  return B([
    [cyl(0.02, 0.022, 1.95, 8), S('#3a2a1e', 0.6), { p: [0, 0.5, 0] }],
    [cyl(0.03, 0.03, 0.3, 8), S('#2c8a6a', 0.35, 0.4), { p: [0, 1.35, 0] }],
    [blade, S('#7fe0c0', 0.2, 0.6, 0.35), { p: [0, 1.45, 0], s: [1.15, 1.15, 1] }],
    [roundedBox(0.16, 0.03, 0.05, 0.01), S('#d0a040', 0.3, 0.9), { p: [0, 1.46, 0] }],
    [ellipsoid(0.04, 0.05, 0.04, 8, 6), S('#ff9a3a', 0.3, 0, 2.0), { p: [0, -0.5, 0] }],
    [torus(0.05, 0.012, Math.PI * 2, 12, 5), S('#ff7a2a', 0.6), { p: [0, 0.15, 0], r: [Math.PI / 2, 0, 0] }],
  ]);
}

const SPECS: Record<string, { spec: HumanoidSpec; weapon: () => Geo; walk: number }> = {
  guardian1: {
    spec: {
      height: 1.86,
      build: { shoulders: 1.16, chest: 1.16, belly: 0.14, limbs: 1.18, hips: 1.06, head: 1.02, neck: 1.1 },
      skin: '#8b5a3a',
      eyes: { iris: '#3a2a1a' },
      hair: { style: 'short', color: '#2a2a2e', accent: '#c9a04a' },
      brows: { color: '#4a4a4c', thickness: 1.6 },
      beard: { style: 'full', color: '#8a8a8c' },
      nose: 'round',
      lips: '#7a4034',
      outfit: {
        top: { kind: 'armor', color: '#8a6a2a', accent: '#3a3a2a', trim: '#e0b458', length: 0.38, collar: 'high', sleeves: 'short', rough: 0.4, metal: 0.7 },
        bottom: { kind: 'pants', color: '#3a3a48' },
        shoes: { kind: 'boots', color: '#4a3320' },
        gloves: '#6a4a2a',
        belt: '#3a2618',
        sash: '#9a2b2b',
        cape: '#1f4a44',
      },
      hat: { kind: 'helmet', color: '#b58a3a', accent: '#e0b458', glow: '#46e6d0' },
      idle: 'proud',
    },
    weapon: spearGeo,
    walk: 1.2,
  },
  guardian2: {
    spec: {
      height: 1.72,
      build: { shoulders: 0.86, chest: 0.92, hips: 1.06, limbs: 0.86, legs: 1.04, head: 1.0, neck: 1.05 },
      skin: '#c58e64',
      eyes: { iris: '#1f7a6a', size: 1.15, glow: 0.2 },
      hair: { style: 'long', color: '#131a2e', accent: '#46d6c4' },
      brows: { color: '#0e1424', thickness: 0.8, tilt: 0.05 },
      nose: 'small',
      lips: '#a84a52',
      blush: 0.3,
      outfit: {
        top: { kind: 'robe', color: '#1f5f78', accent: '#12405a', trim: '#e6c060', length: 0.98, collar: 'high', sleeves: 'long', rough: 0.55 },
        bottom: { kind: 'skirt', color: '#1f5f78' },
        shoes: { kind: 'sandals', color: '#c9a040' },
        sash: '#e39a2e',
        scarf: '#efe6c8',
      },
      hat: { kind: 'circlet', color: '#e6c060', accent: '#46e6d0' },
      idle: 'stately',
    },
    weapon: lanternStaffGeo,
    walk: 1.3,
  },
  guardian3: {
    spec: {
      height: 1.76,
      build: { shoulders: 1.0, chest: 1.0, limbs: 1.0, legs: 1.06, head: 0.98 },
      skin: '#a9744c',
      eyes: { iris: '#5a3a1a', size: 1.05 },
      hair: { style: 'ponytail', color: '#3b2418', accent: '#d04a3a' },
      brows: { thickness: 1.0 },
      freckles: true,
      nose: 'button',
      goatee: undefined,
      outfit: {
        top: { kind: 'armor', color: '#2f9a76', accent: '#1f6a55', trim: '#c8963e', length: 0.3, collar: 'none', sleeves: 'short', rough: 0.45, metal: 0.35 },
        bottom: { kind: 'pants', color: '#2a4a52' },
        shoes: { kind: 'boots', color: '#5a3a22' },
        gloves: '#2a6a5a',
        belt: '#2a1a12',
        sash: '#e0672a',
      },
      hat: { kind: 'headband', color: '#e0672a' },
      idle: 'energetic',
    } as HumanoidSpec,
    weapon: glaiveGeo,
    walk: 1.55,
  },
};

export function createGuardian(id: string, name: string): HumanoidActor {
  const d = SPECS[id]!;
  const a = new HumanoidActor({ id, name, spec: d.spec, walkSpeed: d.walk, sitsInVehicle: true });
  const w = d.weapon();
  const m = a.attach(a.rig.handR, w, 'weapon');
  m.rotation.x = 0.08;
  return a;
}

// ───────────────────────── chaos spirits ─────────────────────────

interface ImpSpec {
  body: string;
  belly: string;
  mask: string;
  maskAccent: string;
  eye: string;
  tailA: string;
  tailB: string;
  crest: 'ram' | 'ears' | 'crest';
  seed: number;
}

const IMPS: Record<string, ImpSpec> = {
  chaos1: { body: '#5b2d8e', belly: '#d2a8ff', mask: '#e83f8f', maskAccent: '#ffd166', eye: '#ff5ac8', tailA: '#ff3f9f', tailB: '#ffd166', crest: 'ram', seed: 1.1 },
  chaos2: { body: '#b9520f', belly: '#ffd58a', mask: '#ffb020', maskAccent: '#7a1e0a', eye: '#ffe34a', tailA: '#ff6a12', tailB: '#ffe066', crest: 'ears', seed: 2.7 },
  chaos3: { body: '#1c7c8c', belly: '#a5f2e2', mask: '#3ad6c8', maskAccent: '#f4f0d0', eye: '#7dffe9', tailA: '#22c9b4', tailB: '#b6f6ff', crest: 'crest', seed: 4.3 },
};

const headW = new THREE.Vector3();

function tailSegGeo(len: number, w0: number, w1: number, colA: string, colB: string): Geo {
  // tapered petal hanging along -Z (pointing backwards), flattened in Y
  const parts: Part[] = [
    [ellipsoid(w0, 0.014, len * 0.62, 10, 8), S(colA, 0.5, 0, 1.4), { p: [0, 0, -len * 0.5] }],
    [ellipsoid(w1, 0.012, len * 0.45, 8, 6), S(colB, 0.5, 0, 1.6), { p: [0, 0.002, -len * 0.82] }],
  ];
  return B(parts);
}

export class ChaosImp extends Actor {
  private cfg: ImpSpec;
  private seed: number;
  private body: THREE.Group;
  private headG: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private chains: THREE.Group[][] = [];
  private chainBase: THREE.Group[] = [];
  private eyeK: { value: number };
  private tailK: { value: number };
  private crestG: THREE.Group;
  private lookHeadWorld = headW;

  constructor(id: string, name: string) {
    super({ id, name, height: 0.9, radius: 0.32, walkSpeed: 1.5 });
    const c = (this.cfg = IMPS[id]!);
    this.seed = c.seed;
    this.body = new THREE.Group();
    this.body.position.y = 0.34;
    this.pivot.add(this.body);

    // torso
    const torso = B([
      [ellipsoid(0.17, 0.21, 0.15, 20, 14), S(c.body, 0.55), { p: [0, 0.18, 0] }],
      [ellipsoid(0.115, 0.15, 0.06, 14, 10), S(c.belly, 0.6, 0, 0.15), { p: [0, 0.16, 0.115] }],
      [ellipsoid(0.11, 0.1, 0.12, 12, 8), S(c.body, 0.55), { p: [0, -0.02, -0.01] }],
      // tiny fluffy shoulder tufts and a belt with a glowing charm
      [torus(0.155, 0.018, Math.PI * 2, 20, 6), S(c.maskAccent, 0.4, 0.6), { p: [0, 0.03, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.85, 1] }],
      [ellipsoid(0.03, 0.03, 0.02, 8, 6), S(c.eye, 0.2, 0, 2.5), { p: [0, 0.03, 0.135] }],
    ]);
    this.addMesh(this.body, torso, 'torso');

    // head with mask
    this.headG = new THREE.Group();
    this.headG.position.set(0, 0.5, 0.01);
    this.body.add(this.headG);
    const headParts: Part[] = [
      [ellipsoid(0.185, 0.17, 0.17, 24, 16), S(c.body, 0.55), { p: [0, 0.14, 0] }],
      // mask plate
      [ellipsoid(0.15, 0.15, 0.06, 22, 14), S(c.mask, 0.35, 0.15), { p: [0, 0.135, 0.125] }],
      [ellipsoid(0.15, 0.05, 0.05, 16, 8), S(c.maskAccent, 0.35, 0.3), { p: [0, 0.225, 0.14], r: [0.5, 0, 0] }],
      // eye recesses
      [ellipsoid(0.048, 0.06, 0.03, 12, 8), S('#1a0f22', 0.6), { p: [0.062, 0.16, 0.166], r: [0, 0.2, -0.25] }],
      [ellipsoid(0.048, 0.06, 0.03, 12, 8), S('#1a0f22', 0.6), { p: [-0.062, 0.16, 0.166], r: [0, -0.2, 0.25] }],
      // brow ridges
      [tube([[0.02, 0.215, 0.165], [0.07, 0.235, 0.17], [0.115, 0.205, 0.15]], 0.011, 8, 5), S(c.maskAccent, 0.4, 0.4)],
      [tube([[-0.02, 0.215, 0.165], [-0.07, 0.235, 0.17], [-0.115, 0.205, 0.15]], 0.011, 8, 5), S(c.maskAccent, 0.4, 0.4)],
      // nose + grin + cheek spirals
      [cone(0.022, 0.05, 8), S(c.maskAccent, 0.4, 0.3), { p: [0, 0.115, 0.19], r: [Math.PI / 2, 0, 0] }],
      [torus(0.055, 0.008, Math.PI * 0.9, 16, 5), S('#2b1030', 0.5), { p: [0, 0.075, 0.172], r: [0, 0, Math.PI * 1.05] }],
      [torus(0.028, 0.007, Math.PI * 1.6, 12, 5), S(c.maskAccent, 0.4, 0.3), { p: [0.1, 0.1, 0.13], r: [0, 0.9, 0] }],
      [torus(0.028, 0.007, Math.PI * 1.6, 12, 5), S(c.maskAccent, 0.4, 0.3), { p: [-0.1, 0.1, 0.13], r: [0, -0.9, 0] }],
      // forehead gem
      [ellipsoid(0.026, 0.034, 0.02, 10, 8), S(c.eye, 0.15, 0, 2.6), { p: [0, 0.2, 0.172] }],
    ];
    this.addMesh(this.headG, B(headParts), 'head');

    this.crestG = new THREE.Group();
    this.crestG.position.set(0, 0.26, 0);
    this.headG.add(this.crestG);
    const crestParts: Part[] = [];
    if (c.crest === 'ram') {
      for (const s of [1, -1]) {
        crestParts.push([torus(0.09, 0.024, Math.PI * 1.55, 20, 7), S('#f0e2c0', 0.45, 0.1), { p: [s * 0.13, -0.03, -0.02], r: [0, s * 0.35, s * -0.5 + (s > 0 ? 0 : Math.PI)] }]);
        crestParts.push([cone(0.02, 0.06, 8), S(c.maskAccent, 0.4, 0.5), { p: [s * 0.2, 0.09, -0.02], r: [0, 0, -s * 1.3] }]);
      }
    } else if (c.crest === 'ears') {
      for (const s of [1, -1]) {
        crestParts.push([cone(0.05, 0.22, 4), S(c.body, 0.55), { p: [s * 0.15, 0.0, -0.02], r: [0, 0, -s * 0.85] }]);
        crestParts.push([cone(0.03, 0.15, 4), S(c.belly, 0.6, 0, 0.3), { p: [s * 0.152, 0.0, 0.0], r: [0.1, 0, -s * 0.85] }]);
      }
      crestParts.push([cone(0.03, 0.14, 6), S(c.tailA, 0.4, 0, 1.6), { p: [0, 0.06, 0.0] }]);
    } else {
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.32;
        crestParts.push([ellipsoid(0.028, 0.15, 0.008, 8, 6), S(i % 2 ? c.tailB : c.tailA, 0.5, 0, 1.2), { p: [Math.sin(a) * 0.1, 0.06 + Math.cos(a) * 0.08, -0.03], r: [-0.15, 0, -a] }]);
      }
    }
    this.addMesh(this.crestG, B(crestParts), 'crest');

    // glowing eyes (own material so they can flare up)
    const eyes = glowVc(3.2);
    this.eyeK = eyes.k;
    const eyeGeo = B([
      [ellipsoid(0.032, 0.044, 0.02, 10, 8), S(c.eye), { p: [0.062, 0.16, 0.176], r: [0, 0.2, -0.25] }],
      [ellipsoid(0.032, 0.044, 0.02, 10, 8), S(c.eye), { p: [-0.062, 0.16, 0.176], r: [0, -0.2, 0.25] }],
    ]);
    const eyeMesh = new THREE.Mesh(eyeGeo, eyes.material);
    eyeMesh.name = 'eyes';
    this.headG.add(eyeMesh);
    this.track(eyeGeo, eyes.material);

    // arms
    const mkArm = (s: number) => {
      const g = new THREE.Group();
      g.position.set(s * 0.17, 0.3, 0.0);
      this.body.add(g);
      const geo = B([
        [limb(0.034, 0.026, 0.15, 8), S(c.body, 0.55)],
        [ellipsoid(0.034, 0.038, 0.03, 10, 8), S(c.maskAccent, 0.5, 0.2), { p: [0, -0.175, 0] }],
        [cone(0.011, 0.035, 5), S(c.maskAccent, 0.5, 0.2), { p: [0.02, -0.22, 0.01], r: [0, 0, 0.3] }],
        [cone(0.011, 0.035, 5), S(c.maskAccent, 0.5, 0.2), { p: [-0.02, -0.22, 0.01], r: [0, 0, -0.3] }],
        [cone(0.011, 0.035, 5), S(c.maskAccent, 0.5, 0.2), { p: [0, -0.225, 0.02] }],
      ]);
      this.addMesh(g, geo, 'arm');
      return g;
    };
    this.armL = mkArm(1);
    this.armR = mkArm(-1);

    // tails: glowing ribbon chains
    const tails = glowVc(1.7);
    this.tailK = tails.k;
    this.track(tails.material);
    const chainDefs = c.crest === 'ears' ? [{ n: 5, len: 0.13, x: 0, up: 0.5 }, { n: 4, len: 0.11, x: 0.05, up: 0.8 }, { n: 4, len: 0.11, x: -0.05, up: 0.8 }] : c.crest === 'ram' ? [{ n: 5, len: 0.15, x: 0.06, up: 0.0 }, { n: 5, len: 0.15, x: -0.06, up: 0.0 }] : [{ n: 6, len: 0.13, x: 0, up: -0.2 }, { n: 4, len: 0.12, x: 0.08, up: 0.3 }, { n: 4, len: 0.12, x: -0.08, up: 0.3 }];
    for (const d of chainDefs) {
      const base = new THREE.Group();
      base.position.set(d.x, 0.02, -0.12);
      base.rotation.set(d.up, d.x * 6, 0);
      this.body.add(base);
      this.chainBase.push(base);
      let parent: THREE.Object3D = base;
      const segs: THREE.Group[] = [];
      for (let i = 0; i < d.n; i++) {
        const seg = new THREE.Group();
        seg.position.z = i === 0 ? 0 : -d.len;
        const k = 1 - i / d.n;
        const geo = tailSegGeo(d.len * 1.15, 0.05 * k + 0.012, 0.03 * k + 0.008, i % 2 ? c.tailB : c.tailA, i % 2 ? c.tailA : c.tailB);
        const mesh = new THREE.Mesh(geo, tails.material);
        mesh.name = 'tail';
        seg.add(mesh);
        this.track(geo);
        parent.add(seg);
        parent = seg;
        segs.push(seg);
      }
      this.chains.push(segs);
    }
    this.mood = 'idle';
  }

  private cur = { hover: 0.2, lean: 0, arms: 0.6, scale: 1, sq: 1 };

  protected pose(dt: number): void {
    const t = this.time + this.seed * 3.1;
    const w = this.moveBlend;
    const e = this.reactionEnvelope();
    const kind = this.reaction?.kind;
    const rt = this.reaction?.t ?? 0;
    const ru = this.reaction ? Math.min(1, this.reaction.t / this.reaction.dur) : 0;

    let hover = 0.26 + Math.sin(t * 2.1) * 0.05 * (1 - w * 0.5) + Math.sin(t * 5.3) * 0.008;
    if (this.mood === 'sit') hover = 0.06 + Math.sin(t * 2.1) * 0.012;
    else if (this.mood === 'ride') hover = 0.12 + Math.sin(t * 2.4) * 0.03;
    let lean = w * 0.3 + Math.sin(t * 1.1) * 0.04;
    let arms = 0.65 + Math.sin(t * 1.7) * 0.12 + w * 0.3;
    let armsR = arms;
    let scale = 1;
    let sq = 1;
    let spin = 0;
    let glow = 1;
    let tailAmp = 1 + w * 1.1;
    let shiver = 0;
    let headNod = 0;
    let armFlip = 0;

    if (this.hopProgress >= 0) {
      const k = Math.sin(this.hopProgress * Math.PI);
      sq = 1 + 0.2 * k;
      scale = 1 - 0.06 * k;
      arms = 1.5 * k + arms;
      armsR = arms;
      tailAmp += k;
    }
    switch (kind) {
      case 'celebrate':
      case 'cheer':
        spin = Math.PI * 4 * (ru * ru * (3 - 2 * ru));
        hover += Math.abs(Math.sin(rt * 6)) * 0.28 * e;
        arms = armsR = 0.65 + 2.1 * e;
        glow = 1 + 1.2 * e;
        tailAmp += 1.2 * e;
        break;
      case 'fail':
        sq = 1 - 0.24 * e;
        lean += 0.5 * e;
        hover -= 0.12 * e;
        glow = 1 - 0.8 * e;
        tailAmp *= 1 - 0.75 * e;
        arms = armsR = 0.65 - 0.5 * e;
        headNod = 0.5 * e;
        break;
      case 'threat':
        scale = 1 + 0.42 * e;
        glow = 1 + 3.2 * e;
        arms = armsR = 0.65 + 1.0 * e;
        tailAmp += 1.0 * e;
        shiver = Math.sin(rt * 45) * 0.012 * e;
        hover += 0.08 * e;
        break;
      case 'fear':
      case 'shiver':
        scale = 1 - 0.3 * e;
        shiver = Math.sin(rt * 40) * 0.03 * e;
        arms = armsR = 0.4 - 0.35 * e;
        tailAmp *= 1 - 0.6 * e;
        hover -= 0.06 * e;
        glow = 1 - 0.4 * e;
        break;
      case 'select':
      case 'wave':
        armFlip = 1;
        armsR = 0.65 + 2.1 * e + Math.sin(rt * 12) * 0.25 * e;
        hover += 0.05 * e;
        glow = 1 + 0.8 * e;
        break;
      case 'nod':
        headNod = Math.sin(rt * 10) * 0.35 * e;
        break;
      default:
        break;
    }
    void armFlip;

    const k = 1 - Math.exp(-dt * 12);
    const c = this.cur;
    c.hover += (hover - c.hover) * k;
    c.lean += (lean - c.lean) * k;
    c.arms += (arms - c.arms) * k;
    c.scale += (scale - c.scale) * k;
    c.sq += (sq - c.sq) * k;

    this.body.position.y = 0.08 + c.hover;
    this.body.position.x = shiver;
    this.body.rotation.set(c.lean, spin, Math.sin(t * 1.3) * 0.06 + Math.sin(t * 7) * 0.02 * w);
    this.body.scale.set(c.scale / Math.sqrt(c.sq), c.scale * c.sq, c.scale / Math.sqrt(c.sq));

    // head: idle glances + look target
    let hy = Math.sin(t * 0.7) * 0.25 + Math.sin(t * 0.31) * 0.15;
    let hx = Math.sin(t * 0.9) * 0.08 + headNod;
    if (this.lookTarget) {
      this.headG.getWorldPosition(this.lookHeadWorld);
      const la = this.lookAngles(this.lookHeadWorld, 1.0, 0.4);
      hy = la.yaw * 0.85;
      hx = la.pitch * 0.8 + headNod;
    }
    this.headG.rotation.set(hx, hy, Math.sin(t * 1.9) * 0.05);
    this.crestG.rotation.x = Math.sin(t * 3.2) * 0.06 * tailAmp;

    // arms
    this.armL.rotation.set(Math.sin(t * 2.3) * 0.25, 0, c.arms + Math.sin(t * 3.1) * 0.06);
    this.armR.rotation.set(Math.sin(t * 2.3 + 1.6) * 0.25, 0, -(armsR === arms ? c.arms : armsR) - Math.sin(t * 3.4) * 0.06);
    if (kind === 'select' || kind === 'wave') this.armR.rotation.z = -armsR;

    // tails
    let ci = 0;
    for (const segs of this.chains) {
      const phase = ci * 1.7;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]!;
        const f = i + 1;
        s.rotation.x = Math.sin(t * 3.2 - f * 0.75 + phase) * 0.28 * tailAmp + (this.cfg.crest === 'ears' ? -0.22 : 0.08) + (kind === 'fail' ? 0.25 * e * f * 0.3 : 0);
        s.rotation.y = Math.sin(t * 2.4 - f * 0.85 + phase * 1.3) * 0.36 * tailAmp;
      }
      ci++;
    }
    for (const b of this.chainBase) b.rotation.z = Math.sin(t * 1.6) * 0.08;
    this.eyeK.value = 3.0 * glow + Math.sin(t * 4) * 0.25;
    this.tailK.value = 1.5 * (0.6 + 0.4 * glow) + Math.sin(t * 5 + this.seed) * 0.15;
  }
}

export function createChaos(id: string, name: string): ChaosImp {
  return new ChaosImp(id, name);
}
