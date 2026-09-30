import * as THREE from 'three/webgpu';
import { QUALITY_PRESETS, type QualityLevel, type QualityPreset } from './quality';

export type BackendName = 'webgpu' | 'webgl2';

export interface RendererInitOptions {
  canvasParent: HTMLElement;
  forceWebGL: boolean;
  quality: QualityLevel;
  adaptive: boolean;
}

/**
 * Owns the WebGPURenderer. WebGPU is tried first; three.js falls back to its WebGL2 backend
 * automatically when no adapter is available (or when `forceWebGL` is requested).
 * Everything above this layer talks to the renderer only through this class and TSL nodes,
 * which compile for both backends.
 */
export class RendererManager {
  readonly renderer: THREE.WebGPURenderer;
  readonly canvas: HTMLCanvasElement;
  backend: BackendName = 'webgl2';
  adapterLabel = '';
  preset: QualityPreset;
  /** Current adaptive resolution scale (multiplies the device pixel ratio). */
  private dprScale = 1;
  private frameTimes: number[] = [];
  private lastAdapt = 0;
  private resizeObserver: ResizeObserver;
  private listeners = new Set<(w: number, h: number) => void>();
  width = 1;
  height = 1;

  private constructor(renderer: THREE.WebGPURenderer, private readonly opts: RendererInitOptions) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.preset = QUALITY_PRESETS[opts.quality];
    this.canvas.classList.add('game-canvas');
    this.canvas.setAttribute('data-testid', 'game-canvas');
    this.canvas.tabIndex = 0;
    opts.canvasParent.appendChild(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(opts.canvasParent);
  }

  static async create(opts: RendererInitOptions): Promise<RendererManager> {
    const preset = QUALITY_PRESETS[opts.quality];
    const renderer = new THREE.WebGPURenderer({
      antialias: preset.msaa,
      forceWebGL: opts.forceWebGL,
      powerPreference: 'high-performance',
      alpha: false,
    });
    await renderer.init();
    const mgr = new RendererManager(renderer, opts);
    const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
    mgr.backend = backend;
    mgr.adapterLabel = mgr.describeAdapter();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = preset.shadows;
    renderer.shadowMap.type = preset.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    mgr.resize();
    return mgr;
  }

  private describeAdapter(): string {
    try {
      const b = this.renderer.backend as unknown as {
        adapter?: { info?: { vendor?: string; architecture?: string; description?: string } };
        gl?: WebGL2RenderingContext;
      };
      if (this.backend === 'webgpu' && b.adapter?.info) {
        const i = b.adapter.info;
        return [i.vendor, i.architecture, i.description].filter(Boolean).join(' ');
      }
      if (b.gl) {
        const ext = b.gl.getExtension('WEBGL_debug_renderer_info');
        return String(ext ? b.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : b.gl.getParameter(b.gl.RENDERER));
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  /** True for software rasterizers (SwiftShader, llvmpipe) – used to pick a safe default quality. */
  get isSoftwareRenderer(): boolean {
    return /swiftshader|llvmpipe|software|basic render/i.test(this.adapterLabel);
  }

  onResize(fn: (w: number, h: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setQuality(level: QualityLevel): void {
    this.preset = QUALITY_PRESETS[level];
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.type = this.preset.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.dprScale = 1;
    this.frameTimes.length = 0;
    this.resize();
  }

  get pixelRatio(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio);
    return Math.max(this.preset.minPixelRatio, dpr * this.dprScale);
  }

  resize(): void {
    const parent = this.opts.canvasParent;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, true);
    for (const l of this.listeners) l(w, h);
  }

  /**
   * Adaptive resolution: keeps the frame time near the 60 fps budget by scaling the pixel
   * ratio between the preset's min and max. Decisions are made at most every 1.5 s.
   */
  sampleFrame(dtMs: number, now: number): void {
    if (!this.opts.adaptive) return;
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.lastAdapt < 1500 || this.frameTimes.length < 45) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    let changed = false;
    if (median > 22 && this.pixelRatio > this.preset.minPixelRatio + 0.01) {
      this.dprScale = Math.max(0.4, this.dprScale - 0.1);
      changed = true;
    } else if (median < 14 && this.dprScale < 1) {
      this.dprScale = Math.min(1, this.dprScale + 0.05);
      changed = true;
    }
    if (changed) {
      this.lastAdapt = now;
      this.frameTimes.length = 0;
      this.resize();
    }
  }

  get info(): { drawCalls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return {
      drawCalls: i.render.drawCalls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
