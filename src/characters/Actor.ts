import * as THREE from 'three/webgpu';
import { createCharacterMaterial, type CharacterMaterialHandles } from './materials';

export type Mood = 'idle' | 'walk' | 'ride' | 'sit';
export type Reaction = 'select' | 'celebrate' | 'fail' | 'fear' | 'threat' | 'nod' | 'wave' | 'cheer' | 'shiver';

export interface ActorOptions {
  id: string;
  name: string;
  height: number;
  /** Radius of the pick proxy. */
  radius: number;
  walkSpeed?: number;
  translucent?: boolean;
  ghostColor?: THREE.Color;
}

const up = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Base class for every animated figure. Handles placement, locomotion, hops, facing,
 * highlight/alert feedback and reactions; subclasses implement the procedural pose.
 */
export abstract class Actor {
  readonly id: string;
  readonly name: string;
  /** Placement node (world or seat space). */
  readonly root = new THREE.Group();
  /** Hop/bob offset node – subclasses put the rig inside. */
  readonly pivot = new THREE.Group();
  readonly pickProxy: THREE.Mesh;
  readonly mat: CharacterMaterialHandles;
  readonly height: number;
  readonly radius: number;
  walkSpeed: number;
  mood: Mood = 'idle';
  moodTime = 0;
  reaction: { kind: Reaction; t: number; dur: number } | null = null;
  /** World-space point the head should look at (null = neutral). */
  lookTarget: THREE.Vector3 | null = null;
  /** Ground height sampler provided by the world. */
  groundAt: (x: number, z: number) => number = () => 0;
  /** Walking phase in radians (drives gait). */
  gait = 0;
  /** 0..1 how much the actor is currently moving (for blending). */
  moveBlend = 0;
  /** Yaw the actor turns towards. */
  yawGoal = 0;
  protected time = 0;
  private highlightGoal = 0;
  private alertGoal = 0;
  private path: { points: THREE.Vector3[]; index: number; resolve: () => void; speed: number } | null = null;
  private hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; height: number; resolve: () => void; space: 'world' | 'local' } | null = null;
  protected hopProgress = -1;
  private disposables: Array<{ dispose(): void }> = [];

  constructor(opts: ActorOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.height = opts.height;
    this.radius = opts.radius;
    this.walkSpeed = opts.walkSpeed ?? 1.4;
    this.mat = createCharacterMaterial({ translucent: opts.translucent, ghostColor: opts.ghostColor });
    this.root.name = `actor:${opts.id}`;
    this.root.add(this.pivot);
    const proxyGeo = new THREE.CapsuleGeometry(opts.radius, Math.max(0.01, opts.height - opts.radius * 2), 4, 8);
    proxyGeo.translate(0, opts.height / 2, 0);
    const proxyMat = new THREE.MeshBasicNodeMaterial({ visible: false });
    this.pickProxy = new THREE.Mesh(proxyGeo, proxyMat);
    this.pickProxy.name = `pick:${opts.id}`;
    this.pickProxy.userData.pick = { kind: 'entity', id: opts.id };
    this.root.add(this.pickProxy);
    this.track(proxyGeo, proxyMat, this.mat.material);
  }

  protected track(...items: Array<{ dispose(): void }>): void {
    this.disposables.push(...items);
  }

  /** Adds a mesh that uses this actor's material and casts shadows. */
  protected addMesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, name = 'part'): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.mat.material);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    this.track(geo);
    return m;
  }

  // ───────────────────────── feedback ─────────────────────────

  setHighlight(level: 0 | 1 | 2): void {
    this.highlightGoal = level === 0 ? 0 : level === 1 ? 0.6 : 1;
  }

  setAlert(on: boolean): void {
    this.alertGoal = on ? 1 : 0;
  }

  flash(): void {
    this.mat.flash.value = 1;
  }

  react(kind: Reaction, dur?: number): void {
    const d = dur ?? ({ select: 1.2, celebrate: 2.2, fail: 1.4, fear: 1.8, threat: 1.8, nod: 0.8, wave: 1.6, cheer: 2.4, shiver: 1.2 } as const)[kind];
    this.reaction = { kind, t: 0, dur: d };
  }

  get isBusy(): boolean {
    return this.path !== null || this.hop !== null;
  }

  // ───────────────────────── locomotion ─────────────────────────

  /** Walks through world-space waypoints (y is taken from the ground sampler). */
  walkTo(points: THREE.Vector3[], speed = this.walkSpeed): Promise<void> {
    this.path?.resolve();
    if (!points.length) return Promise.resolve();
    return new Promise((resolve) => {
      this.path = { points: points.map((p) => p.clone()), index: 0, resolve, speed };
      this.mood = 'walk';
    });
  }

  /**
   * Parabolic hop to a target. `space: 'world'` hops in world space (root must be in world space);
   * 'local' hops in the parent's local space (e.g. already attached to a seat).
   */
  hopTo(target: THREE.Vector3, height = 0.6, dur = 0.55, space: 'world' | 'local' = 'world'): Promise<void> {
    this.hop?.resolve();
    return new Promise((resolve) => {
      this.hop = { from: this.root.position.clone(), to: target.clone(), t: 0, dur, height, resolve, space };
      const dir = tmp.copy(target).sub(this.root.position);
      if (dir.lengthSq() > 0.0001) this.yawGoal = Math.atan2(dir.x, dir.z);
    });
  }

  /** Turns to face a world point (only affects yaw). */
  faceTowards(point: THREE.Vector3): void {
    const wp = this.root.getWorldPosition(tmp2);
    const dx = point.x - wp.x;
    const dz = point.z - wp.z;
    if (dx * dx + dz * dz < 1e-6) return;
    let yaw = Math.atan2(dx, dz);
    // convert to parent space yaw
    const parent = this.root.parent;
    if (parent) {
      const q = parent.getWorldQuaternion(new THREE.Quaternion());
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      yaw -= e.y;
    }
    this.yawGoal = yaw;
  }

  snapYaw(): void {
    this.root.rotation.y = this.yawGoal;
  }

  update(dt: number): void {
    this.time += dt;
    this.moodTime += dt;
    // movement along path
    if (this.path) {
      const p = this.path;
      const target = p.points[p.index]!;
      const pos = this.root.position;
      tmp.set(target.x - pos.x, 0, target.z - pos.z);
      const dist = tmp.length();
      const step = p.speed * dt;
      if (dist <= step || dist < 0.01) {
        pos.x = target.x;
        pos.z = target.z;
        p.index++;
        if (p.index >= p.points.length) {
          this.path = null;
          this.mood = 'idle';
          this.moodTime = 0;
          p.resolve();
        }
      } else {
        tmp.multiplyScalar(step / dist);
        pos.add(tmp);
        this.yawGoal = Math.atan2(tmp.x, tmp.z);
      }
      pos.y = this.groundAt(pos.x, pos.z);
      this.gait += dt * p.speed * (7.2 / Math.max(0.6, this.height));
    }
    // hop
    this.hopProgress = -1;
    if (this.hop) {
      const h = this.hop;
      h.t += dt;
      const u = Math.min(1, h.t / h.dur);
      this.hopProgress = u;
      const e = u * u * (3 - 2 * u);
      this.root.position.lerpVectors(h.from, h.to, e);
      this.root.position.y += Math.sin(u * Math.PI) * h.height;
      if (u >= 1) {
        this.root.position.copy(h.to);
        this.hop = null;
        this.hopProgress = -1;
        h.resolve();
      }
    }
    // turning
    const dy = wrap(this.yawGoal - this.root.rotation.y);
    this.root.rotation.y += dy * (1 - Math.exp(-dt * 9));
    // blend factors
    const moving = this.path ? 1 : 0;
    this.moveBlend += (moving - this.moveBlend) * (1 - Math.exp(-dt * 10));
    // feedback uniforms
    const hl = this.mat.highlight;
    hl.value += (this.highlightGoal - hl.value) * (1 - Math.exp(-dt * 12));
    const al = this.mat.alert;
    al.value += (this.alertGoal - al.value) * (1 - Math.exp(-dt * 8));
    this.mat.flash.value = Math.max(0, this.mat.flash.value - dt * 2.2);
    // reactions
    if (this.reaction) {
      this.reaction.t += dt;
      if (this.reaction.t >= this.reaction.dur) this.reaction = null;
    }
    this.pose(dt);
  }

  /** Subclasses animate their rig here. */
  protected abstract pose(dt: number): void;

  /** Reaction envelope 0→1→0 over the reaction duration. */
  protected reactionEnvelope(): number {
    if (!this.reaction) return 0;
    const u = this.reaction.t / this.reaction.dur;
    return Math.sin(Math.min(1, u) * Math.PI) ** 0.6;
  }

  /** Head target yaw/pitch (radians, relative to body) for the current look target. */
  protected lookAngles(headWorld: THREE.Vector3, maxYaw = 1.1, maxPitch = 0.5): { yaw: number; pitch: number } {
    if (!this.lookTarget) return { yaw: 0, pitch: 0 };
    const d = tmp.copy(this.lookTarget).sub(headWorld);
    const bodyYaw = this.root.getWorldQuaternion(new THREE.Quaternion());
    const inv = bodyYaw.invert();
    d.applyQuaternion(inv);
    const yaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -maxYaw, maxYaw);
    const horiz = Math.hypot(d.x, d.z);
    const pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, horiz), -maxPitch, maxPitch);
    return { yaw, pitch };
  }

  /** Center of the figure in world space (for camera focus, tooltips, markers). */
  getCenter(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.set(0, this.height * 0.55, 0));
  }

  getTop(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.set(0, this.height + 0.25, 0));
  }

  dispose(): void {
    this.path?.resolve();
    this.hop?.resolve();
    this.path = null;
    this.hop = null;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.removeFromParent();
  }
}

export { up as ACTOR_UP };
