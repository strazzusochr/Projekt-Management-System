import * as THREE from 'three/webgpu';
import { dot, float, length, mix, pass, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import type { QualityPreset } from './quality';

/** Per-world look settings. All values are artistic, the quality preset decides what runs. */
export interface WorldLook {
  toneMapping: 'aces' | 'agx' | 'neutral';
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  ao: { radius: number; intensity: number };
  /** 0 = off … 1 = strong corner darkening. */
  vignette: number;
  /** 1 = neutral. */
  saturation: number;
  /** Multiplicative colour balance in linear space (gain). */
  gain: [number, number, number];
  /** Additive colour lift for the shadows (linear). */
  lift: [number, number, number];
  contrast: number;
}

export const DEFAULT_LOOK: WorldLook = {
  toneMapping: 'aces',
  exposure: 1,
  bloom: { strength: 0.35, radius: 0.4, threshold: 0.85 },
  ao: { radius: 0.35, intensity: 1 },
  vignette: 0.35,
  saturation: 1,
  gain: [1, 1, 1],
  lift: [0, 0, 0],
  contrast: 1,
};

const TONE_MAPPINGS = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
} as const;

/**
 * Builds the RenderPipeline for the current scene/camera according to the quality preset.
 * On LOW (or when post-processing is disabled) the scene is rendered directly – no extra passes.
 */
export class PostFX {
  private pipeline: THREE.RenderPipeline | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private bloomNode: ReturnType<typeof bloom> | null = null;
  private aoNode: ReturnType<typeof ao> | null = null;
  /** Animated uniforms (e.g. flash on level completion). */
  readonly flash = uniform(0);
  readonly flashColor = uniform(new THREE.Color(1, 0.9, 0.7));
  readonly saturationMul = uniform(1);

  constructor(private readonly renderer: THREE.WebGPURenderer) {}

  configure(scene: THREE.Scene, camera: THREE.Camera, preset: QualityPreset, look: WorldLook): void {
    this.disposePipeline();
    this.scene = scene;
    this.camera = camera;
    this.renderer.toneMapping = TONE_MAPPINGS[look.toneMapping];
    this.renderer.toneMappingExposure = look.exposure;
    if (!preset.post.enabled) return;

    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    let out = color.rgb;

    if (preset.post.ao) {
      const depth = scenePass.getTextureNode('depth');
      // normals are reconstructed from depth when no normal node is given (supported at runtime, typed too strictly)
      const aoPass = ao(depth, null as unknown as THREE.Node, camera);
      aoPass.radius.value = look.ao.radius;
      aoPass.resolutionScale = preset.level === 'ultra' ? 1 : 0.5;
      aoPass.samples.value = preset.level === 'ultra' ? 16 : 10;
      this.aoNode = aoPass;
      const occlusion = aoPass.getTextureNode().r;
      out = out.mul(mix(float(1), occlusion, float(look.ao.intensity)));
    }

    if (preset.post.bloom) {
      const b = bloom(vec4(out, 1), look.bloom.strength, look.bloom.radius, look.bloom.threshold);
      this.bloomNode = b;
      out = out.add(b.rgb);
    }

    if (preset.post.grading) {
      const lift = vec3(...look.lift);
      const gain = vec3(...look.gain);
      out = out.mul(gain).add(lift);
      const luma = dot(out, vec3(0.2126, 0.7152, 0.0722));
      out = mix(vec3(luma), out, float(look.saturation).mul(this.saturationMul));
      // contrast around mid-grey in linear space
      out = out.sub(0.18).mul(look.contrast).add(0.18).max(0);
      // vignette
      const d = length(uv().sub(0.5).mul(vec3(1.1, 1, 0).xy));
      const vig = smoothstep(0.35, 0.95, d).mul(look.vignette);
      out = out.mul(float(1).sub(vig));
    }

    out = mix(out, this.flashColor, this.flash);

    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputNode = vec4(out, 1);
  }

  setBloomStrength(v: number): void {
    if (this.bloomNode) this.bloomNode.strength.value = v;
  }

  render(): void {
    if (!this.scene || !this.camera) return;
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private disposePipeline(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.bloomNode?.dispose();
    this.bloomNode = null;
    this.aoNode?.dispose();
    this.aoNode = null;
  }

  dispose(): void {
    this.disposePipeline();
    this.scene = null;
    this.camera = null;
  }
}
