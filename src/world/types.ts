import type * as THREE from 'three/webgpu';
import type { Actor } from '../characters/Actor';
import type { CameraKeyframe, CameraLimits, CameraView } from '../camera/CameraRig';
import type { WorldLook } from '../render/PostFX';
import type { QualityPreset } from '../render/quality';
import type { MusicId } from '../audio/music';
import type { AmbienceId } from '../audio/ambience';

/** Where entities stand on one bank. Side 0 = start bank, side 1 = goal bank. */
export interface BankLayout {
  /** One standing slot per puzzle entity (≥ entity count), world coordinates on the ground. */
  slots: THREE.Vector3[];
  /** Point on the jetty/shore right next to the docked vehicle (walk target before hopping aboard). */
  dockPoint: THREE.Vector3;
  /** Point entities face while idle on this bank (usually the river centre). */
  facing: THREE.Vector3;
}

/** The transport (boat, barge, hover platform, skiff, ferry). */
export interface VehicleRig {
  /** Moved by the game between docks[0] and docks[1] (world space, added to the scene by the world). */
  root: THREE.Group;
  /** Seat anchors, children of `root` (local space). Index 0 is the helm/pilot seat. ≥ capacity. */
  seats: THREE.Object3D[];
  /** Root position when docked at side 0 / side 1. */
  docks: [THREE.Vector3, THREE.Vector3];
  /** Root yaw (radians) when docked at side 0 / side 1. */
  yaw: [number, number];
  /** Invisible pick mesh inside `root`; set `userData.pick = { kind: 'vehicle', id: 'vehicle' }`. */
  pickProxy: THREE.Object3D;
  /** Seconds a crossing takes (game adds easing / weight). */
  crossingTime: number;
  /** Optional travel waypoints between the docks (world space) for curved paths; y is used as-is. */
  path?: THREE.Vector3[];
  /** Per frame; `moving` is 0..1 (speed factor) so wakes/thrusters/lights can react. */
  update(dt: number, t: number, moving: number): void;
  /** Called whenever the load changes (3D capacity / weight / energy display on the vehicle). */
  setIndicator?(info: { count: number; capacity: number; weight?: number; maxWeight?: number; energy?: number; maxEnergy?: number }): void;
}

export interface WorldBuildContext {
  quality: QualityPreset;
  renderer: THREE.WebGPURenderer;
}

/** A complete, playable 3D world for one level. */
export interface LevelWorld {
  scene: THREE.Scene;
  look: WorldLook;
  banks: [BankLayout, BankLayout];
  vehicle: VehicleRig;
  /** Must contain an Actor for EVERY puzzle entity id of the level (key = entity id). */
  actors: Map<string, Actor>;
  camera: { home: CameraView; limits: CameraLimits; intro: CameraKeyframe[] };
  /** Terrain height at (x, z) – actors walk on it. */
  groundAt(x: number, z: number): number;
  music: MusicId;
  ambience: AmbienceId;
  /** Humanoids sit (true) or stand (false) while riding. */
  seated: boolean;
  /** Per-frame animation of environment, NPCs, particles, water. `t` = seconds since start. */
  update(dt: number, t: number, camera: THREE.PerspectiveCamera): void;
  /** Optional hooks for world-specific feedback. */
  onCrossingStart?(to: 0 | 1): void;
  onCrossingEnd?(side: 0 | 1): void;
  onViolation?(): void;
  onWin?(): void;
  dispose(): void;
}

export type WorldFactory = (ctx: WorldBuildContext) => Promise<LevelWorld>;
