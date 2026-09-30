import * as THREE from 'three/webgpu';
import { Actor } from './Actor';
import { buildHumanoid, type HumanoidRig, type HumanoidSpec, type IdleStyle } from './HumanoidBuilder';

export interface HumanoidOptions {
  id: string;
  name: string;
  spec: HumanoidSpec;
  walkSpeed?: number;
  /** Seated when riding the vehicle (otherwise standing). */
  sitsInVehicle?: boolean;
  /** Extra per-frame animation (props, glowing parts …). */
  extra?: (actor: HumanoidActor, dt: number) => void;
}

const headWorld = new THREE.Vector3();

interface Pose {
  hipsY: number;
  hipsX: number;
  hipsRotX: number;
  hipsRotZ: number;
  torsoX: number;
  torsoZ: number;
  torsoY: number;
  headX: number;
  headY: number;
  headZ: number;
  shLX: number;
  shLZ: number;
  shRX: number;
  shRZ: number;
  shLY: number;
  shRY: number;
  elL: number;
  elR: number;
  elLY: number;
  elRY: number;
  hipLX: number;
  hipRX: number;
  hipLZ: number;
  hipRZ: number;
  knL: number;
  knR: number;
  mouthOpen: number;
  mouthFrown: number;
  browRaise: number;
  browFurrow: number;
}

const ZERO: Pose = {
  hipsY: 0,
  hipsX: 0,
  hipsRotX: 0,
  hipsRotZ: 0,
  torsoX: 0,
  torsoZ: 0,
  torsoY: 0,
  headX: 0,
  headY: 0,
  headZ: 0,
  shLX: 0,
  shLZ: 0,
  shRX: 0,
  shRZ: 0,
  shLY: 0,
  shRY: 0,
  elL: 0,
  elR: 0,
  elLY: 0,
  elRY: 0,
  hipLX: 0,
  hipRX: 0,
  hipLZ: 0,
  hipRZ: 0,
  knL: 0,
  knR: 0,
  mouthOpen: 0,
  mouthFrown: 0,
  browRaise: 0,
  browFurrow: 0,
};

/** Procedurally animated humanoid figure. */
export class HumanoidActor extends Actor {
  readonly rig: HumanoidRig;
  readonly spec: HumanoidSpec;
  readonly idleStyle: IdleStyle;
  sitsInVehicle: boolean;
  private cur: Pose = { ...ZERO };
  private seed: number;
  private blinkTimer = 2 + Math.random() * 3;
  private blink = 0;
  private glanceTimer = 3;
  private glance = { yaw: 0, pitch: 0 };
  private extra?: (actor: HumanoidActor, dt: number) => void;

  constructor(opts: HumanoidOptions) {
    const h = opts.spec.height;
    super({ id: opts.id, name: opts.name, height: h, radius: Math.max(0.28, h * 0.2), walkSpeed: opts.walkSpeed ?? 1.35 });
    this.spec = opts.spec;
    this.idleStyle = opts.spec.idle ?? 'calm';
    this.sitsInVehicle = opts.sitsInVehicle ?? false;
    this.extra = opts.extra;
    this.seed = [...opts.id].reduce((a, c) => a + c.charCodeAt(0), 0) * 0.37;
    this.rig = buildHumanoid(opts.spec, (parent, geo, name) => this.addMesh(parent, geo, name));
    this.pivot.add(this.rig.hips);
  }

  /** Adds an accessory mesh (already baked geometry) to a joint using this actor's material. */
  attach(joint: THREE.Object3D, geo: THREE.BufferGeometry, name = 'accessory'): THREE.Mesh {
    return this.addMesh(joint, geo, name);
  }

  protected pose(dt: number): void {
    const t = this.time + this.seed;
    const d = this.rig.dims;
    const p: Pose = { ...ZERO };
    const w = this.moveBlend;
    const style = this.idleStyle;

    // ── idle base ──
    const breath = Math.sin(t * 1.7) * 0.5 + 0.5;
    const sway = Math.sin(t * 0.63) * (style === 'energetic' ? 0.035 : style === 'heavy' ? 0.012 : 0.022);
    const idleK = 1 - w;
    p.hipsX = sway * 0.35 * d.height * idleK;
    p.hipsRotZ = sway * 0.5 * idleK;
    p.torsoZ = -sway * 0.7 * idleK;
    p.shLZ = 0.1 + breath * 0.02;
    p.shRZ = -0.1 - breath * 0.02;
    p.shLX = Math.sin(t * 0.9) * 0.03;
    p.shRX = Math.sin(t * 0.9 + 1) * 0.03;
    p.elL = -0.14;
    p.elR = -0.14;
    p.knL = 0.04;
    p.knR = 0.04;
    switch (style) {
      case 'energetic':
        p.hipsY = Math.abs(Math.sin(t * 4.5)) * 0.018 * d.height * idleK;
        p.knL = p.knR = 0.1 + Math.abs(Math.sin(t * 4.5)) * 0.1;
        p.elL = p.elR = -0.5;
        break;
      case 'proud':
      case 'stately':
        p.torsoX = -0.06;
        p.headX = -0.08;
        p.shLZ = 0.45;
        p.shRZ = -0.45;
        p.elL = -1.5;
        p.elR = -1.5;
        p.elLY = 0.7;
        p.elRY = -0.7;
        if (style === 'stately') {
          p.shLZ = 0.14;
          p.elL = -0.3;
        }
        break;
      case 'shy':
        p.headX = 0.22;
        p.shLX = -0.35;
        p.shRX = -0.35;
        p.shLZ = -0.08;
        p.shRZ = 0.08;
        p.elL = -0.9;
        p.elR = -0.9;
        break;
      case 'heavy':
        p.torsoX = 0.1;
        p.headX = 0.08;
        p.knL = p.knR = 0.12;
        break;
      case 'armsCrossed':
        p.shLX = -0.55;
        p.shRX = -0.55;
        p.shLZ = -0.15;
        p.shRZ = 0.15;
        p.elL = -1.95;
        p.elR = -1.85;
        p.elLY = -0.55;
        p.elRY = 0.6;
        break;
      case 'handsBehind':
        p.shLX = 0.35;
        p.shRX = 0.35;
        p.elL = -0.9;
        p.elR = -0.9;
        p.torsoX = -0.04;
        break;
      case 'lookout': {
        const phase = (t * 0.15) % 1;
        if (phase > 0.55 && phase < 0.85) {
          const k = Math.sin(((phase - 0.55) / 0.3) * Math.PI);
          p.shRX = -1.9 * k;
          p.shRZ = -0.2;
          p.elR = -2.0 * k;
          p.headX = -0.1 * k;
        }
        break;
      }
      case 'fidget':
        p.hipsRotZ += Math.sin(t * 2.1) * 0.03;
        break;
      default:
        break;
    }
    p.torsoY = 0;

    // occasional idle glances
    this.glanceTimer -= dt;
    if (this.glanceTimer <= 0) {
      this.glanceTimer = 2.5 + Math.random() * 4;
      this.glance = Math.random() < 0.45 ? { yaw: 0, pitch: 0 } : { yaw: (Math.random() - 0.5) * 1.2, pitch: (Math.random() - 0.5) * 0.3 };
    }
    p.headY = this.glance.yaw * idleK;
    p.headX += this.glance.pitch * idleK;

    // ── walk ──
    if (w > 0.001) {
      const g = this.gait;
      const s = Math.sin(g);
      const stride = 0.62;
      p.hipLX = -s * stride * w;
      p.hipRX = s * stride * w;
      p.knL = Math.max(p.knL, (Math.max(0, Math.sin(g + 1.9)) * 1.0 + 0.08) * w);
      p.knR = Math.max(p.knR, (Math.max(0, Math.sin(g + 1.9 + Math.PI)) * 1.0 + 0.08) * w);
      p.shLX = s * 0.5 * w + p.shLX * (1 - w);
      p.shRX = -s * 0.5 * w + p.shRX * (1 - w);
      p.shLZ = p.shLZ * (1 - w) + 0.12 * w;
      p.shRZ = p.shRZ * (1 - w) - 0.12 * w;
      p.elL = p.elL * (1 - w) - 0.35 * w;
      p.elR = p.elR * (1 - w) - 0.35 * w;
      p.elLY *= 1 - w;
      p.elRY *= 1 - w;
      p.hipsY += Math.abs(Math.cos(g)) * 0.028 * d.height * w;
      p.torsoX = p.torsoX * (1 - w) + 0.07 * w;
      p.torsoY = -s * 0.08 * w;
      p.hipsRotZ += Math.sin(g) * 0.03 * w;
    }

    // ── vehicle ──
    if (this.mood === 'sit') {
      p.hipLX = -1.45;
      p.hipRX = -1.45;
      p.knL = 1.5;
      p.knR = 1.5;
      p.hipsY = -d.thigh * 0.92;
      p.shLX = -0.35;
      p.shRX = -0.35;
      p.elL = -0.9;
      p.elR = -0.9;
    } else if (this.mood === 'ride') {
      p.hipLZ = 0.08;
      p.hipRZ = -0.08;
      p.knL = 0.18;
      p.knR = 0.18;
      p.hipsY = -d.height * 0.008;
      p.torsoZ += Math.sin(t * 1.3) * 0.03;
    }

    // ── hop (boarding / leaving) ──
    if (this.hopProgress >= 0) {
      const k = Math.sin(this.hopProgress * Math.PI);
      p.hipLX = -0.7 * k;
      p.hipRX = -0.5 * k;
      p.knL = 1.1 * k;
      p.knR = 0.9 * k;
      p.shLZ = 0.6 * k + 0.1;
      p.shRZ = -0.6 * k - 0.1;
      p.shLX = -0.5 * k;
      p.shRX = -0.5 * k;
    }

    // ── reactions ──
    if (this.reaction) {
      const e = this.reactionEnvelope();
      const rt = this.reaction.t;
      switch (this.reaction.kind) {
        case 'select':
        case 'wave':
          p.shRZ = lerp(p.shRZ, -2.5, e);
          p.shRX = lerp(p.shRX, -0.2, e);
          p.elR = lerp(p.elR, -0.5 + Math.sin(rt * 11) * 0.45, e);
          p.headZ = 0.12 * e;
          p.browRaise = e;
          p.mouthOpen = 0.4 * e;
          break;
        case 'celebrate':
        case 'cheer':
          p.hipsY += Math.abs(Math.sin(rt * 7)) * 0.14 * d.height * 0.5 * e;
          p.shLZ = lerp(p.shLZ, 2.7, e);
          p.shRZ = lerp(p.shRZ, -2.7, e);
          p.elL = lerp(p.elL, -0.25, e);
          p.elR = lerp(p.elR, -0.25, e);
          p.headX = -0.25 * e;
          p.mouthOpen = e;
          p.browRaise = e;
          break;
        case 'fail':
          p.headY += Math.sin(rt * 13) * 0.42 * e;
          p.shLZ = lerp(p.shLZ, 0.55, e);
          p.shRZ = lerp(p.shRZ, -0.55, e);
          p.shLX = lerp(p.shLX, -0.5, e);
          p.shRX = lerp(p.shRX, -0.5, e);
          p.elL = lerp(p.elL, -1.2, e);
          p.elR = lerp(p.elR, -1.2, e);
          p.hipsY += 0.012 * d.height * e;
          p.mouthFrown = e;
          p.browFurrow = e;
          break;
        case 'fear':
        case 'shiver':
          p.torsoX = lerp(p.torsoX, -0.22, e);
          p.shLX = lerp(p.shLX, -1.3, e);
          p.shRX = lerp(p.shRX, -1.3, e);
          p.elL = lerp(p.elL, -1.7, e);
          p.elR = lerp(p.elR, -1.7, e);
          p.torsoZ += Math.sin(rt * 38) * 0.035 * e;
          p.mouthOpen = 0.6 * e;
          p.browRaise = e;
          p.knL = p.knR = lerp(p.knL, 0.35, e);
          break;
        case 'threat':
          p.torsoX = lerp(p.torsoX, 0.2, e);
          p.shLX = lerp(p.shLX, -0.9, e);
          p.shRX = lerp(p.shRX, -0.9, e);
          p.browFurrow = e;
          break;
        case 'nod':
          p.headX += Math.sin(rt * 10) * 0.28 * e;
          p.mouthOpen = 0.15 * e;
          break;
      }
    }

    // ── look target overrides head ──
    if (this.lookTarget) {
      this.rig.head.getWorldPosition(headWorld);
      const la = this.lookAngles(headWorld);
      p.headY = la.yaw * 0.8;
      p.headX = la.pitch * 0.8 + (this.reaction?.kind === 'nod' ? p.headX : 0);
      p.torsoY += la.yaw * 0.2;
    }

    // ── smooth & apply ──
    const k = 1 - Math.exp(-dt * 14);
    const c = this.cur;
    for (const key of Object.keys(p) as Array<keyof Pose>) c[key] += (p[key] - c[key]) * k;
    const r = this.rig;
    r.hips.position.y = d.legLen + c.hipsY;
    r.hips.position.x = c.hipsX;
    r.hips.rotation.set(c.hipsRotX, 0, c.hipsRotZ);
    r.torso.rotation.set(c.torsoX, c.torsoY, c.torsoZ);
    r.torso.scale.set(1 + breath * 0.008, 1 + breath * 0.012, 1 + breath * 0.012);
    r.head.rotation.set(c.headX, c.headY, c.headZ, 'YXZ');
    r.shoulderL.rotation.set(c.shLX, c.shLY, c.shLZ);
    r.shoulderR.rotation.set(c.shRX, c.shRY, c.shRZ);
    r.elbowL.rotation.set(c.elL, c.elLY, 0);
    r.elbowR.rotation.set(c.elR, c.elRY, 0);
    r.hipL.rotation.set(c.hipLX, 0, c.hipLZ);
    r.hipR.rotation.set(c.hipRX, 0, c.hipRZ);
    r.kneeL.rotation.x = c.knL;
    r.kneeR.rotation.x = c.knR;

    // face
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.14;
      this.blinkTimer = 2.2 + Math.random() * 3.5;
    }
    if (this.blink > 0) this.blink -= dt;
    r.eyes.scale.y = this.blink > 0 ? 0.12 : 1 + c.browRaise * 0.08;
    r.brows.position.y = d.headR * (1.33 + c.browRaise * 0.1 - c.browFurrow * 0.04);
    r.brows.scale.set(1, 1 - c.browFurrow * 0.2, 1);
    r.mouth.scale.set(1 - c.mouthOpen * 0.2, 1 + c.mouthOpen * 1.6, 1);
    r.mouth.rotation.z = c.mouthFrown * Math.PI;
    r.mouth.position.y = d.headR * (0.62 + c.mouthFrown * 0.06);
    this.extra?.(this, dt);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
