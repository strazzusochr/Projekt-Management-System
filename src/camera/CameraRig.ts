import * as THREE from 'three/webgpu';

export interface CameraLimits {
  minRadius: number;
  maxRadius: number;
  /** Polar angle limits in radians measured from +Y (0 = straight down view from above). */
  minPolar: number;
  maxPolar: number;
  /** Optional azimuth window (radians) around which the player may orbit. */
  minAzimuth?: number;
  maxAzimuth?: number;
  /** Pan bounds for the orbit target. */
  targetMin: THREE.Vector3;
  targetMax: THREE.Vector3;
}

export interface CameraView {
  target: THREE.Vector3;
  radius: number;
  polar: number;
  azimuth: number;
}

export interface CameraKeyframe {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Seconds from the previous keyframe to this one (ignored for the first). */
  duration: number;
}

type Mode = 'orbit' | 'cinematic' | 'showcase';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function damp(current: number, goal: number, lambda: number, dt: number): number {
  return current + (goal - current) * (1 - Math.exp(-lambda * dt));
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Gameplay camera: damped orbit around a target with limits, plus cinematic flights and a
 * showcase orbit. Any user input immediately returns control (cinematics are skippable).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: Mode = 'orbit';
  reducedMotion = false;

  private cur: CameraView;
  private goal: CameraView;
  private home: CameraView;
  private limits: CameraLimits = {
    minRadius: 4,
    maxRadius: 60,
    minPolar: 0.2,
    maxPolar: 1.45,
    targetMin: new THREE.Vector3(-50, -5, -50),
    targetMax: new THREE.Vector3(50, 20, 50),
  };
  private cine: {
    pos: THREE.CatmullRomCurve3;
    tgt: THREE.CatmullRomCurve3;
    /** cumulative normalized times per key */
    times: number[];
    elapsed: number;
    total: number;
    resolve: () => void;
    returnHome: boolean;
  } | null = null;
  private showcaseSpeed = 0.08;
  private showcaseTime = 0;
  private shakeAmp = 0;
  private shakeTime = 0;
  private dragVelocity = { az: 0, polar: 0 };

  constructor(fov = 42) {
    this.camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 2000);
    const v: CameraView = { target: new THREE.Vector3(), radius: 20, polar: 1.05, azimuth: 0 };
    this.cur = cloneView(v);
    this.goal = cloneView(v);
    this.home = cloneView(v);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setLimits(limits: CameraLimits): void {
    this.limits = limits;
    this.clampGoal();
  }

  /** Gameplay default view; `immediate` snaps without smoothing. */
  setHome(view: CameraView, immediate = false): void {
    this.home = cloneView(view);
    this.goal = cloneView(view);
    this.clampGoal();
    if (immediate) {
      this.cur = cloneView(this.goal);
      this.apply();
    }
  }

  get homeView(): CameraView {
    return cloneView(this.home);
  }

  get currentView(): CameraView {
    return cloneView(this.cur);
  }

  // ───────────────────────── user control ─────────────────────────

  /** Called on any user camera interaction – aborts cinematics / showcase. */
  takeControl(): void {
    if (this.mode === 'cinematic') this.skipCinematic();
    if (this.mode === 'showcase') this.stopShowcase();
  }

  rotate(dxPx: number, dyPx: number): void {
    this.takeControl();
    const k = 0.0055;
    this.goal.azimuth -= dxPx * k;
    this.goal.polar -= dyPx * k;
    this.dragVelocity.az = -dxPx * k;
    this.dragVelocity.polar = -dyPx * k;
    this.clampGoal();
  }

  pan(dxPx: number, dyPx: number): void {
    this.takeControl();
    const scale = this.cur.radius * 0.0016;
    const right = tmpV.set(Math.cos(this.cur.azimuth), 0, -Math.sin(this.cur.azimuth));
    const forward = tmpV2.set(Math.sin(this.cur.azimuth), 0, Math.cos(this.cur.azimuth));
    this.goal.target.addScaledVector(right, -dxPx * scale);
    this.goal.target.addScaledVector(forward, -dyPx * scale);
    this.clampGoal();
  }

  zoom(deltaY: number): void {
    this.takeControl();
    const factor = Math.exp(deltaY * 0.0012);
    this.goal.radius *= factor;
    this.clampGoal();
  }

  /** Smoothly frames a point (optionally with a radius). Keeps the current viewing angle. */
  focus(point: THREE.Vector3, radius?: number): void {
    if (this.mode === 'cinematic') return;
    this.mode = 'orbit';
    this.goal.target.copy(point);
    if (radius !== undefined) this.goal.radius = radius;
    this.clampGoal();
  }

  /** Frames a view completely (target + angles). */
  frame(view: Partial<CameraView>): void {
    if (this.mode === 'cinematic') return;
    this.mode = 'orbit';
    if (view.target) this.goal.target.copy(view.target);
    if (view.radius !== undefined) this.goal.radius = view.radius;
    if (view.polar !== undefined) this.goal.polar = view.polar;
    if (view.azimuth !== undefined) this.goal.azimuth = this.nearestAzimuth(view.azimuth);
    this.clampGoal();
  }

  resetView(): void {
    this.takeControl();
    this.goal = cloneView(this.home);
    this.goal.azimuth = this.nearestAzimuth(this.home.azimuth);
  }

  shake(strength = 0.25): void {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, strength);
    this.shakeTime = 0;
  }

  // ───────────────────────── cinematics ─────────────────────────

  playCinematic(keys: CameraKeyframe[], opts: { returnHome?: boolean; speed?: number } = {}): Promise<void> {
    if (keys.length < 2) return Promise.resolve();
    this.skipCinematic();
    const speed = opts.speed ?? 1;
    const durations = keys.map((k, i) => (i === 0 ? 0 : Math.max(0.05, k.duration / speed)));
    const total = durations.reduce((a, b) => a + b, 0);
    let acc = 0;
    const times = durations.map((d) => (acc += d) / total);
    return new Promise((resolve) => {
      this.cine = {
        pos: new THREE.CatmullRomCurve3(keys.map((k) => k.position.clone()), false, 'centripetal'),
        tgt: new THREE.CatmullRomCurve3(keys.map((k) => k.target.clone()), false, 'centripetal'),
        times,
        elapsed: 0,
        total,
        resolve,
        returnHome: opts.returnHome ?? true,
      };
      this.mode = 'cinematic';
    });
  }

  get inCinematic(): boolean {
    return this.mode === 'cinematic';
  }

  skipCinematic(): void {
    if (!this.cine) return;
    const c = this.cine;
    this.cine = null;
    this.mode = 'orbit';
    // continue smoothly from where the camera is now
    this.syncFromCamera();
    if (c.returnHome) {
      this.goal = cloneView(this.home);
      this.goal.azimuth = this.nearestAzimuth(this.home.azimuth);
    }
    c.resolve();
  }

  startShowcase(target: THREE.Vector3, radius: number, polar: number, speed = 0.08): void {
    this.skipCinematic();
    this.mode = 'showcase';
    this.showcaseSpeed = this.reducedMotion ? speed * 0.4 : speed;
    this.showcaseTime = 0;
    this.goal.target.copy(target);
    this.goal.radius = radius;
    this.goal.polar = polar;
  }

  stopShowcase(): void {
    if (this.mode !== 'showcase') return;
    this.mode = 'orbit';
    this.clampGoal();
  }

  // ───────────────────────── update ─────────────────────────

  update(dt: number): void {
    if (this.mode === 'cinematic' && this.cine) {
      const c = this.cine;
      c.elapsed += dt;
      const u = Math.min(1, c.elapsed / c.total);
      const e = easeInOut(u);
      c.pos.getPoint(e, this.camera.position);
      c.tgt.getPoint(e, tmpV);
      this.camera.lookAt(tmpV);
      this.applyShake(dt);
      if (u >= 1) {
        this.cine = null;
        this.mode = 'orbit';
        this.syncFromCamera();
        if (c.returnHome) {
          this.goal = cloneView(this.home);
          this.goal.azimuth = this.nearestAzimuth(this.home.azimuth);
        }
        c.resolve();
      }
      return;
    }

    if (this.mode === 'showcase') {
      this.showcaseTime += dt;
      this.goal.azimuth += this.showcaseSpeed * dt;
    } else {
      // gentle inertia after a drag
      this.dragVelocity.az *= Math.exp(-dt * 6);
      this.dragVelocity.polar *= Math.exp(-dt * 6);
    }

    const lambda = this.mode === 'showcase' ? 2.2 : 7.5;
    this.cur.target.x = damp(this.cur.target.x, this.goal.target.x, lambda, dt);
    this.cur.target.y = damp(this.cur.target.y, this.goal.target.y, lambda, dt);
    this.cur.target.z = damp(this.cur.target.z, this.goal.target.z, lambda, dt);
    this.cur.radius = damp(this.cur.radius, this.goal.radius, lambda, dt);
    this.cur.polar = damp(this.cur.polar, this.goal.polar, lambda, dt);
    this.cur.azimuth = this.cur.azimuth + wrapAngle(this.goal.azimuth - this.cur.azimuth) * (1 - Math.exp(-lambda * dt));
    this.apply();
    this.applyShake(dt);
  }

  private apply(): void {
    const { target, radius, polar, azimuth } = this.cur;
    const sp = Math.sin(polar);
    this.camera.position.set(
      target.x + radius * sp * Math.sin(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * sp * Math.cos(azimuth),
    );
    this.camera.lookAt(target);
  }

  private applyShake(dt: number): void {
    if (this.shakeAmp <= 0.001) return;
    this.shakeTime += dt;
    const a = this.shakeAmp * Math.exp(-this.shakeTime * 7);
    this.camera.position.x += Math.sin(this.shakeTime * 61) * a * 0.3;
    this.camera.position.y += Math.sin(this.shakeTime * 47 + 1.3) * a * 0.2;
    if (a < 0.002) this.shakeAmp = 0;
  }

  /** Derives the orbit state from the camera's current position/orientation. */
  private syncFromCamera(): void {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    // pick a target point in front of the camera at the current home radius distance
    const dist = THREE.MathUtils.clamp(this.home.radius, this.limits.minRadius, this.limits.maxRadius);
    const target = this.camera.position.clone().addScaledVector(dir, dist);
    const offset = this.camera.position.clone().sub(target);
    const radius = offset.length();
    this.cur.target.copy(target);
    this.cur.radius = radius;
    this.cur.polar = Math.acos(THREE.MathUtils.clamp(offset.y / radius, -1, 1));
    this.cur.azimuth = Math.atan2(offset.x, offset.z);
    this.goal = cloneView(this.cur);
    this.clampGoal();
  }

  private nearestAzimuth(a: number): number {
    return this.cur.azimuth + wrapAngle(a - this.cur.azimuth);
  }

  private clampGoal(): void {
    const l = this.limits;
    const g = this.goal;
    g.radius = THREE.MathUtils.clamp(g.radius, l.minRadius, l.maxRadius);
    g.polar = THREE.MathUtils.clamp(g.polar, l.minPolar, l.maxPolar);
    if (l.minAzimuth !== undefined && l.maxAzimuth !== undefined && this.mode !== 'showcase') {
      const center = (l.minAzimuth + l.maxAzimuth) / 2;
      const half = (l.maxAzimuth - l.minAzimuth) / 2;
      const rel = wrapAngle(g.azimuth - center);
      g.azimuth = g.azimuth - rel + THREE.MathUtils.clamp(rel, -half, half);
    }
    g.target.clamp(l.targetMin, l.targetMax);
  }

  /** Projects a world point to CSS pixels (for tooltips and QA). */
  project(point: THREE.Vector3, width: number, height: number): { x: number; y: number; visible: boolean } {
    const p = tmpV.copy(point).project(this.camera);
    const visible = p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05;
    return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height, visible };
  }
}

function cloneView(v: CameraView): CameraView {
  return { target: v.target.clone(), radius: v.radius, polar: v.polar, azimuth: v.azimuth };
}
