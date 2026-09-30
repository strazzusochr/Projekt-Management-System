import * as THREE from 'three/webgpu';
import { Actor } from '../../characters/Actor';
import { bake, ellipsoid, gradient, merge, mottle } from '../../characters/geo';

const WHITE = '#eef1f5';
const CREAM = '#dcd6cb';
const GREY = '#7b8592';
const DARK = '#3c434d';
const CHAR = '#262b33';

type Geo = THREE.BufferGeometry;

function fur(geo: Geo, color: THREE.ColorRepresentation, place: { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number } = {}, mot = 0.1, seed = 1): Geo {
  const g = bake(geo, { color, rough: 0.96 }, place);
  if (mot > 0) mottle(g, mot, 11, seed);
  return g;
}

/** Husky-like polar dog with a fully procedural quadruped rig. Faces +Z, root stands on the ground. */
export class PolarDogActor extends Actor {
  private readonly body = new THREE.Group();
  private readonly torsoMesh: THREE.Mesh;
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly eyes = new THREE.Group();
  private readonly earL = new THREE.Group();
  private readonly earR = new THREE.Group();
  private readonly tongue: THREE.Mesh;
  private readonly legs: Array<{ upper: THREE.Group; lower: THREE.Group; front: boolean; side: number }> = [];
  private readonly tailYaw = new THREE.Group();
  private readonly tail: THREE.Group[] = [];
  private readonly seed: number;
  private sitK = 0;
  private blinkT = 2 + Math.random() * 3;
  private blink = 0;
  private twitchT = [3 + Math.random() * 3, 4 + Math.random() * 3];
  private twitch = [0, 0];
  private glanceT = 2;
  private glance = { yaw: 0, pitch: 0 };
  private pivotY = 0;
  private wag = 0;
  private tongueK = 0;
  private readonly headWorld = new THREE.Vector3();

  constructor(id = 'nanuk', name = 'Nanuk') {
    super({ id, name, height: 0.8, radius: 0.34, walkSpeed: 1.55 });
    this.seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) * 0.41;
    this.pivot.add(this.body);
    this.body.position.y = 0.5;

    // ── torso ──
    const tp: Geo[] = [];
    tp.push(fur(ellipsoid(0.165, 0.175, 0.24, 20, 14), GREY, { p: [0, 0.02, 0.19] }, 0.12, 1));
    tp.push(fur(ellipsoid(0.15, 0.16, 0.22, 20, 14), GREY, { p: [0, 0.0, -0.02] }, 0.12, 2));
    tp.push(fur(ellipsoid(0.158, 0.17, 0.2, 20, 14), GREY, { p: [0, 0.01, -0.21] }, 0.12, 3));
    // dark saddle
    tp.push(fur(ellipsoid(0.12, 0.09, 0.3, 16, 10), DARK, { p: [0, 0.1, -0.02] }, 0.18, 4));
    // white chest + belly fluff
    tp.push(fur(ellipsoid(0.11, 0.13, 0.13, 14, 10), WHITE, { p: [0, -0.02, 0.36] }, 0.06, 5));
    tp.push(fur(ellipsoid(0.115, 0.07, 0.3, 14, 10), WHITE, { p: [0, -0.14, 0.02] }, 0.06, 6));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      tp.push(fur(ellipsoid(0.045, 0.055, 0.05, 8, 6), i % 2 ? WHITE : CREAM, { p: [Math.cos(a) * 0.08, -0.05 + Math.sin(a) * 0.09, 0.4] }, 0.05, 7 + i));
    }
    for (const s of [1, -1]) {
      tp.push(fur(ellipsoid(0.04, 0.08, 0.2, 10, 8), CREAM, { p: [s * 0.15, -0.03, -0.02], r: [0, 0, s * 0.15] }, 0.1, 20 + s));
    }
    const torsoGeo = merge(tp);
    gradient(torsoGeo, 'y', -0.13, 0.03, new THREE.Color(WHITE), new THREE.Color(GREY));
    // re-apply the dark saddle over the gradient (top only)
    this.torsoMesh = this.addMesh(this.body, torsoGeo, 'torso');

    // ── neck + head ──
    this.neck.position.set(0, 0.09, 0.32);
    this.body.add(this.neck);
    this.addMesh(
      this.neck,
      merge([
        fur(ellipsoid(0.1, 0.11, 0.15, 14, 10), GREY, { p: [0, 0.03, 0.05], r: [-0.35, 0, 0] }, 0.1, 30),
        fur(ellipsoid(0.11, 0.09, 0.13, 14, 10), WHITE, { p: [0, -0.03, 0.06], r: [-0.3, 0, 0] }, 0.06, 31),
        fur(ellipsoid(0.12, 0.08, 0.1, 12, 8), WHITE, { p: [0, -0.06, 0.1] }, 0.06, 32),
      ]),
      'neck',
    );
    this.head.position.set(0, 0.12, 0.12);
    this.neck.add(this.head);
    const hp: Geo[] = [];
    hp.push(fur(ellipsoid(0.098, 0.088, 0.115, 18, 14), GREY, { p: [0, 0, 0.03] }, 0.08, 40));
    hp.push(fur(ellipsoid(0.1, 0.055, 0.105, 16, 10), CHAR, { p: [0, 0.035, 0.03] }, 0.1, 41));
    hp.push(fur(ellipsoid(0.02, 0.012, 0.1, 8, 6), WHITE, { p: [0, 0.075, 0.09] }, 0, 42));
    hp.push(fur(ellipsoid(0.055, 0.046, 0.1, 14, 10), WHITE, { p: [0, -0.03, 0.14] }, 0.03, 43));
    hp.push(fur(ellipsoid(0.03, 0.022, 0.03, 10, 8), '#0c0d10', { p: [0, -0.012, 0.235] }, 0, 44));
    hp.push(bake(ellipsoid(0.03, 0.022, 0.03, 10, 8), { color: '#0c0d10', rough: 0.25 }, { p: [0, -0.012, 0.238] }));
    for (const s of [1, -1]) {
      hp.push(fur(ellipsoid(0.05, 0.05, 0.065, 12, 8), WHITE, { p: [s * 0.075, -0.045, 0.06] }, 0.05, 45 + s));
      hp.push(fur(ellipsoid(0.034, 0.024, 0.026, 10, 8), CHAR, { p: [s * 0.046, 0.02, 0.105] }, 0, 47));
      hp.push(fur(ellipsoid(0.02, 0.05, 0.035, 8, 6), CREAM, { p: [s * 0.098, -0.05, 0.0] }, 0.05, 48));
      hp.push(fur(ellipsoid(0.028, 0.012, 0.02, 6, 4), WHITE, { p: [s * 0.05, 0.05, 0.135] }, 0, 49));
    }
    this.addMesh(this.head, merge(hp), 'head');
    // ears
    for (const [grp, s] of [[this.earL, 1], [this.earR, -1]] as const) {
      grp.position.set(s * 0.062, 0.078, -0.005);
      this.head.add(grp);
      const eg = merge([
        fur(new THREE.ConeGeometry(0.048, 0.14, 5), CHAR, { p: [0, 0.07, 0], r: [-0.12, 0, s * -0.22], s: [1, 1, 0.55] }, 0.08, 50),
        fur(new THREE.ConeGeometry(0.032, 0.11, 5), '#e6cfc4', { p: [0, 0.065, 0.014], r: [-0.12, 0, s * -0.22], s: [1, 1, 0.4] }, 0, 51),
      ]);
      this.addMesh(grp, eg, s > 0 ? 'earL' : 'earR');
    }
    // eyes (ice blue)
    this.eyes.position.set(0, 0.02, 0.1);
    this.head.add(this.eyes);
    const ey: Geo[] = [];
    for (const s of [1, -1]) {
      ey.push(bake(ellipsoid(0.019, 0.016, 0.01, 10, 8), { color: '#9fe0ff', rough: 0.15, emit: 0.55 }, { p: [s * 0.046, 0, 0.01] }));
      ey.push(bake(ellipsoid(0.0085, 0.0095, 0.006, 8, 6), { color: '#05070a', rough: 0.1 }, { p: [s * 0.046, 0, 0.018] }));
      ey.push(bake(ellipsoid(0.004, 0.004, 0.003, 6, 4), { color: '#ffffff', rough: 0.1, emit: 1.5 }, { p: [s * 0.042, 0.006, 0.021] }));
    }
    this.addMesh(this.eyes, merge(ey), 'eyes');
    // tongue
    this.tongue = this.addMesh(this.head, merge([bake(ellipsoid(0.026, 0.008, 0.05, 10, 6), { color: '#e2707a', rough: 0.4 }, { p: [0, -0.07, 0.17], r: [0.35, 0, 0] })]), 'tongue');
    this.tongue.visible = false;

    // ── legs ──
    const legDefs: Array<[boolean, number]> = [
      [true, 1],
      [true, -1],
      [false, 1],
      [false, -1],
    ];
    for (const [front, s] of legDefs) {
      const upper = new THREE.Group();
      upper.position.set(s * (front ? 0.095 : 0.09), front ? -0.05 : -0.04, front ? 0.24 : -0.23);
      this.body.add(upper);
      const lower = new THREE.Group();
      const len1 = 0.2;
      lower.position.y = -len1;
      upper.add(lower);
      const col = front ? WHITE : CREAM;
      const ug: Geo[] = [
        fur(new THREE.CapsuleGeometry(front ? 0.046 : 0.058, len1 - 0.06, 4, 10), front ? GREY : GREY, { p: [0, -len1 / 2 + (front ? 0 : 0.01), 0], s: front ? [1, 1, 1.1] : [1, 1, 1.3] }, 0.1, 60),
        fur(ellipsoid(0.05, 0.05, 0.055, 10, 8), front ? GREY : GREY, { p: [0, -0.01, 0] }, 0.1, 61),
      ];
      const ugm = merge(ug);
      gradient(ugm, 'y', -0.2, -0.06, new THREE.Color(col), new THREE.Color(GREY));
      this.addMesh(upper, ugm, 'upper');
      const lg: Geo[] = [
        fur(new THREE.CapsuleGeometry(0.031, 0.14, 4, 8), col, { p: [0, -0.09, 0.005] }, 0.05, 62),
        fur(ellipsoid(0.048, 0.03, 0.07, 12, 8), col, { p: [0, -0.205, 0.03] }, 0.05, 63),
      ];
      for (let i = -1; i <= 1; i++) lg.push(bake(ellipsoid(0.011, 0.008, 0.016, 6, 4), { color: '#2a2d33', rough: 0.6 }, { p: [i * 0.02, -0.215, 0.09] }));
      this.addMesh(lower, merge(lg), 'lower');
      this.legs.push({ upper, lower, front, side: s });
    }

    // ── tail (three curled fluffy segments) ──
    this.tailYaw.position.set(0, 0.1, -0.36);
    this.body.add(this.tailYaw);
    let parent: THREE.Object3D = this.tailYaw;
    const segLen = [0.16, 0.15, 0.13];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.y = i === 0 ? 0 : segLen[i - 1]!;
      parent.add(g);
      const rad = 0.052 - i * 0.004;
      const sg = merge([
        fur(ellipsoid(rad * 1.25, segLen[i]! * 0.62, rad * 1.25, 12, 8), i === 2 ? WHITE : GREY, { p: [0, segLen[i]! / 2, 0] }, 0.1, 70 + i),
        fur(ellipsoid(rad * 1.1, segLen[i]! * 0.5, rad * 0.9, 10, 8), WHITE, { p: [0, segLen[i]! / 2, -rad * 0.55] }, 0.05, 74 + i),
        fur(ellipsoid(rad * 0.9, segLen[i]! * 0.3, rad * 0.9, 8, 6), i === 2 ? WHITE : CREAM, { p: [rad * 0.6, segLen[i]! * 0.55, 0] }, 0.05, 78 + i),
        fur(ellipsoid(rad * 0.9, segLen[i]! * 0.3, rad * 0.9, 8, 6), i === 2 ? WHITE : CREAM, { p: [-rad * 0.6, segLen[i]! * 0.55, 0] }, 0.05, 82 + i),
      ]);
      this.addMesh(g, sg, `tail${i}`);
      this.tail.push(g);
      parent = g;
    }
    this.tail[0]!.rotation.x = -0.6;
    this.tail[1]!.rotation.x = 0.9;
    this.tail[2]!.rotation.x = 0.9;
    this.snapYaw();
  }

  protected pose(dt: number): void {
    const t = this.time + this.seed;
    const w = this.moveBlend;
    const sittingGoal = this.mood === 'sit' || this.mood === 'ride' ? 1 : 0;
    const k = 1 - Math.exp(-dt * 7);
    this.sitK += (sittingGoal - this.sitK) * k;
    const sit = this.sitK;
    const idle = 1 - w;
    const env = this.reactionEnvelope();
    const kind = this.reaction?.kind;
    const rt = this.reaction?.t ?? 0;
    const g = this.gait;
    const smooth = (a: number, b: number, kk: number) => a + (b - a) * kk;

    // pivot raise when perched on the ferry stool
    this.pivotY = smooth(this.pivotY, sit * 0.3, k);
    this.pivot.position.y = this.pivotY;

    // ── body ──
    const breath = Math.sin(t * 1.9);
    let bodyY = 0.5 - 0.13 * sit;
    let bodyPitch = -0.5 * sit;
    let bodyRoll = 0;
    let bodyYaw = 0;
    if (w > 0.01) {
      bodyY += (Math.abs(Math.sin(g)) * 0.02 - 0.008) * w;
      bodyPitch += Math.sin(g * 2) * 0.02 * w;
      bodyRoll += Math.sin(g) * 0.03 * w;
      bodyYaw += Math.sin(g) * 0.04 * w;
    }
    // weight shift when idling
    bodyRoll += Math.sin(t * 0.5) * 0.012 * idle * (1 - sit);
    // reactions on the body
    let headYawR = 0;
    let headPitchR = 0;
    let headRollR = 0;
    let earBack = 0;
    let tailDown = 0;
    let wagBoost = 0;
    let pawUp = 0;
    let tongueGoal = sit > 0.5 ? 0.25 : 0;
    if (kind && env > 0) {
      switch (kind) {
        case 'select':
          headRollR = 0.32 * env;
          wagBoost = env;
          tongueGoal = Math.max(tongueGoal, 0.6 * env);
          break;
        case 'celebrate':
        case 'cheer':
          bodyY += Math.abs(Math.sin(rt * 8)) * 0.13 * env * (1 - sit * 0.6);
          bodyPitch += -0.25 * env * Math.abs(Math.sin(rt * 8));
          wagBoost = 1.4 * env;
          tongueGoal = Math.max(tongueGoal, env);
          headPitchR = -0.25 * env;
          break;
        case 'wave':
          pawUp = env;
          wagBoost = 0.8 * env;
          headRollR = 0.2 * env;
          tongueGoal = Math.max(tongueGoal, 0.5 * env);
          break;
        case 'nod':
          headPitchR = Math.sin(rt * 10) * 0.28 * env;
          break;
        case 'fail':
          headPitchR = 0.45 * env;
          tailDown = env;
          earBack = 0.8 * env;
          headYawR = Math.sin(rt * 9) * 0.25 * env;
          break;
        case 'fear':
        case 'shiver':
          bodyY -= 0.05 * env * (1 - sit);
          bodyRoll += Math.sin(rt * 44) * 0.035 * env;
          tailDown = env;
          earBack = env;
          headPitchR = 0.25 * env;
          break;
        case 'threat':
          bodyPitch += 0.16 * env;
          headPitchR = 0.3 * env;
          earBack = 0.9 * env;
          bodyY -= 0.03 * env;
          break;
      }
    }
    this.body.position.y = bodyY + breath * 0.003;
    this.body.rotation.set(bodyPitch, bodyYaw, bodyRoll);
    this.torsoMesh.scale.set(1 + breath * 0.008, 1 + breath * 0.014, 1 + breath * 0.006);

    // ── legs ──
    for (const L of this.legs) {
      const ph = (L.front ? 0 : Math.PI) + (L.side > 0 ? 0 : Math.PI);
      const swing = -Math.sin(g + ph) * (L.front ? 0.62 : 0.55) * w;
      const lift = Math.max(0, Math.cos(g + ph)) * (L.front ? 1.0 : 0.9) * w;
      let up = swing;
      let lo = lift;
      // standing: slight hind-leg bend
      if (!L.front) {
        up += 0.16 * (1 - sit) - 1.15 * sit;
        lo += -0.3 * (1 - sit) * (1 - w) + 2.0 * sit;
      } else {
        up += 0.5 * sit;
      }
      // hop tuck
      if (this.hopProgress >= 0) {
        const hk = Math.sin(this.hopProgress * Math.PI);
        up += L.front ? -0.9 * hk : 0.7 * hk;
        lo += 1.0 * hk;
      }
      // offering a paw
      if (pawUp > 0 && L.front && L.side < 0) {
        up = smooth(up, -1.25 + Math.sin(rt * 10) * 0.12, pawUp);
        lo = smooth(lo, 0.9, pawUp);
      }
      // splay when sitting
      L.upper.rotation.set(up, 0, L.side * (0.04 + (L.front ? 0 : 0.12 * sit)));
      L.lower.rotation.x = lo;
    }

    // ── neck / head ──
    this.glanceT -= dt;
    if (this.glanceT <= 0) {
      this.glanceT = 1.8 + Math.random() * 3.5;
      this.glance = Math.random() < 0.4 ? { yaw: 0, pitch: 0 } : { yaw: (Math.random() - 0.5) * 1.1, pitch: (Math.random() - 0.5) * 0.35 };
    }
    let hy = this.glance.yaw * idle + headYawR;
    let hp = this.glance.pitch * idle + headPitchR - 0.3 * sit + Math.sin(g * 2) * 0.04 * w + 0.12 * sit;
    let hr = headRollR;
    if (this.lookTarget) {
      this.head.getWorldPosition(this.headWorld);
      const la = this.lookAngles(this.headWorld, 1.0, 0.5);
      hy = la.yaw * 0.85;
      hp = la.pitch * 0.85 - 0.25 * sit;
    }
    this.neck.rotation.set(-0.35 + hp * 0.4 + 0.12 * sit, hy * 0.45, hr * 0.4);
    this.head.rotation.set(hp * 0.6 + 0.28, hy * 0.55, hr * 0.6);

    // ears
    for (let i = 0; i < 2; i++) {
      this.twitchT[i]! -= dt;
      if (this.twitchT[i]! <= 0) {
        this.twitchT[i] = 2.5 + Math.random() * 5;
        this.twitch[i] = 1;
      }
      this.twitch[i]! = Math.max(0, this.twitch[i]! - dt * 5);
    }
    const perk = w > 0.1 || sit > 0.5 ? 0.06 : 0;
    this.earL.rotation.set(-perk - earBack * 0.7 + this.twitch[0]! * 0.4, 0, -0.06 + earBack * 0.6 - Math.sin(this.twitch[0]! * Math.PI) * 0.35);
    this.earR.rotation.set(-perk - earBack * 0.7 + this.twitch[1]! * 0.4, 0, 0.06 - earBack * 0.6 + Math.sin(this.twitch[1]! * Math.PI) * 0.35);

    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.13;
      this.blinkT = 2.5 + Math.random() * 3.5;
    }
    if (this.blink > 0) this.blink -= dt;
    this.eyes.scale.y = this.blink > 0 ? 0.1 : 1;

    // tongue
    this.tongueK = smooth(this.tongueK, tongueGoal, 1 - Math.exp(-dt * 6));
    this.tongue.visible = this.tongueK > 0.08;
    this.tongue.scale.set(1, 1, 0.4 + this.tongueK * 0.7 + Math.max(0, Math.sin(t * 9)) * 0.1 * this.tongueK);

    // tail
    this.wag = smooth(this.wag, wagBoost, 1 - Math.exp(-dt * 8));
    const wagFreq = 2.4 + this.wag * 9 + w * 2;
    const wagAmp = 0.18 + this.wag * 0.55 + w * 0.08;
    this.tailYaw.rotation.y = Math.sin(t * wagFreq) * wagAmp;
    const tailUp = 1 - tailDown;
    this.tailYaw.rotation.x = smooth(0.2, -0.3, tailUp) + sit * 0.15;
    this.tail[0]!.rotation.x = smooth(0.3, -0.6, tailUp) + Math.sin(t * 0.9) * 0.03;
    this.tail[1]!.rotation.x = smooth(0.15, 0.9, tailUp);
    this.tail[2]!.rotation.x = smooth(0.1, 0.9, tailUp) + Math.sin(t * wagFreq + 0.6) * 0.1;
  }
}
