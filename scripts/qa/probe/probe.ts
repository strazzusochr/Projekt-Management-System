/**
 * Riverbound QA – GPU-/Renderer-Probe.
 *
 * Rendert eine kleine, aber repräsentative Szene mit dem WebGPURenderer aus `three/webgpu`
 * (NodeMaterial mit TSL-Farbknoten, Schatten, RenderPipeline mit Bloom-Pass) und misst:
 *   - welches Backend aktiv ist (renderer.backend.isWebGPUBackend / isWebGLBackend)
 *   - Adapter-Infos (WebGPU) bzw. UNMASKED_RENDERER (WebGL2)
 *   - Init-Zeit, erste Frame-Zeit (inkl. Shader-Kompilierung), CPU+GPU-Frame-Zeiten, rAF-Durchsatz
 *   - ob überhaupt sichtbare Pixel gerendert wurden (Helligkeitsstichprobe)
 *
 * Ergebnis landet in window.__PROBE_RESULT__, window.__PROBE_DONE__ wird true.
 * Kein Teil des Spiels – nur für scripts/qa/gpu-probe.mjs und docs/QA-ENVIRONMENT.md.
 */
import * as THREE from 'three/webgpu';
import { pass, color, mix, positionWorld, normalWorld, float, vec3, time, sin, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

type Dict = Record<string, unknown>;

interface ProbeResult {
  ok: boolean;
  stage: string;
  url: string;
  userAgent: string;
  requested: { forceWebGL: boolean; width: number; height: number; frames: number; bloom: boolean; shadows: boolean };
  env: Dict;
  backend: null | { name: 'webgpu' | 'webgl2' | 'unknown'; isWebGPUBackend: boolean; isWebGLBackend: boolean };
  timings: Dict;
  info: Dict;
  pixels: Dict;
  warnings: string[];
  errors: string[];
}

const params = new URLSearchParams(location.search);
const forceWebGL = params.get('renderer') === 'webgl';
const width = Number(params.get('w') ?? 1280);
const height = Number(params.get('h') ?? 720);
const frames = Number(params.get('frames') ?? 60);
const useBloom = params.get('bloom') !== '0';
const useShadows = params.get('shadows') !== '0';
const showHud = params.get('hud') !== '0';
const envOnly = params.get('envOnly') === '1';

const result: ProbeResult = {
  ok: false,
  stage: 'start',
  url: location.href,
  userAgent: navigator.userAgent,
  requested: { forceWebGL, width, height, frames, bloom: useBloom, shadows: useShadows },
  env: {},
  backend: null,
  timings: {},
  info: {},
  pixels: {},
  warnings: [],
  errors: [],
};
(window as unknown as Dict).__PROBE_RESULT__ = result;
(window as unknown as Dict).__PROBE_DONE__ = false;

// Konsolen-Warnungen/-Fehler von three.js mitschneiden (z.B. "WebGPU is not available, running under WebGL2 backend").
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);
console.warn = (...args: unknown[]) => { result.warnings.push(args.map(String).join(' ')); origWarn(...args); };
console.error = (...args: unknown[]) => { result.errors.push(args.map(String).join(' ')); origError(...args); };
window.addEventListener('error', (e) => result.errors.push(`onerror: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => result.errors.push(`unhandledrejection: ${String(e.reason)}`));

const out = document.getElementById('result') as HTMLPreElement;
if (!showHud) out.style.display = 'none';
function publish(): void {
  out.textContent = JSON.stringify(result, null, 1);
}

function stats(values: number[]): Dict {
  if (values.length === 0) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const pick = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n: values.length, mean: r(mean), median: r(pick(0.5)), p90: r(pick(0.9)), min: r(s[0]), max: r(s[s.length - 1]), fpsFromMean: r(1000 / mean) };
}

async function probeEnvironment(): Promise<void> {
  const env: Dict = { isSecureContext: window.isSecureContext, hasNavigatorGpu: 'gpu' in navigator, devicePixelRatio: window.devicePixelRatio };
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: Dict): Promise<unknown>; getPreferredCanvasFormat?(): string } }).gpu;
  if (gpu) {
    try {
      env.preferredCanvasFormat = gpu.getPreferredCanvasFormat?.();
      const adapter = (await gpu.requestAdapter({ powerPreference: 'high-performance' })) as null | {
        info?: Dict; features: Set<string>; limits: Dict; isFallbackAdapter?: boolean;
      };
      if (adapter) {
        const info = adapter.info ?? {};
        env.webgpuAdapter = {
          vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
          isFallbackAdapter: (info as Dict).isFallbackAdapter ?? adapter.isFallbackAdapter,
          subgroupMinSize: (info as Dict).subgroupMinSize, subgroupMaxSize: (info as Dict).subgroupMaxSize,
          features: [...adapter.features].sort(),
          limits: {
            maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
            maxBindGroups: adapter.limits.maxBindGroups,
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
          },
        };
      } else {
        env.webgpuAdapter = null;
      }
    } catch (err) {
      env.webgpuAdapterError = String(err);
    }
  }
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      env.webgl2 = {
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxSamples: gl.getParameter(gl.MAX_SAMPLES),
        floatColorBuffer: !!gl.getExtension('EXT_color_buffer_float'),
      };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else {
      env.webgl2 = null;
    }
  } catch (err) {
    env.webgl2Error = String(err);
  }
  result.env = env;
}

function buildScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; animate: (t: number) => void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1a24);
  scene.fog = new THREE.Fog(0x0e1a24, 18, 60);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
  camera.position.set(9, 6.5, 12);
  camera.lookAt(0, 0.8, 0);

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a2a1a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b0, 3.2);
  sun.position.set(8, 14, 6);
  sun.castShadow = useShadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const accent = new THREE.PointLight(0x55ccff, 25, 14, 2);
  accent.position.set(-3, 2.5, 2);
  scene.add(accent);

  // Boden: NodeMaterial mit prozeduraler Farbmischung über die Weltposition (TSL).
  const groundMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const stripes = sin(positionWorld.x.mul(1.3)).mul(sin(positionWorld.z.mul(1.1))).mul(0.5).add(0.5);
  groundMat.colorNode = mix(color(0x2f4a2a), color(0x6d8a3c), stripes);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // "Wasser": animierter TSL-Farbknoten, leicht metallisch.
  const waterMat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.15, metalness: 0.1, clearcoat: 1 });
  const wave = sin(positionWorld.x.mul(2).add(time.mul(1.5))).mul(0.5).add(0.5);
  waterMat.colorNode = mix(color(0x0b3b5a), color(0x2a88b8), wave);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(40, 5, 64, 8), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.02, 4.5);
  water.receiveShadow = true;
  scene.add(water);

  const objects: THREE.Mesh[] = [];
  const knotMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.6 });
  knotMat.colorNode = mix(color(0xd4a24c), color(0x9c3b2e), normalWorld.y.mul(0.5).add(0.5));
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.32, 200, 32), knotMat);
  knot.position.set(0, 1.9, 0);
  knot.castShadow = knot.receiveShadow = true;
  scene.add(knot);
  objects.push(knot);

  // Viele Instanzen + einzelne Meshes für realistischere Drawcall-Zahlen.
  const rockMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  rockMat.colorNode = mix(color(0x55606a), color(0x8a949c), positionWorld.y.mul(0.8).clamp(0, 1));
  const rockGeo = new THREE.IcosahedronGeometry(0.45, 2);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 120);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < rocks.count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 4 + rnd() * 12;
    p.set(Math.cos(a) * r, 0.15, Math.sin(a) * r - 2);
    q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
    const k = 0.4 + rnd() * 1.2;
    s.set(k, k * 0.7, k);
    m.compose(p, q, s);
    rocks.setMatrixAt(i, m);
  }
  rocks.castShadow = rocks.receiveShadow = true;
  scene.add(rocks);

  for (let i = 0; i < 24; i++) {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.2 });
    mat.colorNode = color(new THREE.Color().setHSL(i / 24, 0.55, 0.5));
    const mesh = new THREE.Mesh(i % 2 ? new THREE.BoxGeometry(0.6, 0.6, 0.6) : new THREE.SphereGeometry(0.35, 32, 16), mat);
    const a = (i / 24) * Math.PI * 2;
    mesh.position.set(Math.cos(a) * 3.2, 0.4 + (i % 3) * 0.25, Math.sin(a) * 3.2);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    objects.push(mesh);
  }

  // Emissive Kugeln -> Futter für den Bloom-Pass.
  const glowStrength = uniform(4.0);
  for (let i = 0; i < 5; i++) {
    const gm = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    gm.colorNode = color(0x000000);
    gm.emissiveNode = vec3(0.3, 0.9, 1.0).mul(glowStrength).mul(sin(time.mul(2).add(float(i))).mul(0.3).add(0.7));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 12), gm);
    glow.position.set(-4 + i * 2, 2.8 + (i % 2) * 0.6, -1.5);
    scene.add(glow);
  }

  const animate = (t: number) => {
    knot.rotation.y = t * 0.6;
    knot.rotation.x = Math.sin(t * 0.4) * 0.3;
    for (let i = 1; i < objects.length; i++) objects[i].position.y = 0.4 + (i % 3) * 0.25 + Math.sin(t * 2 + i) * 0.1;
  };
  return { scene, camera, animate };
}

async function main(): Promise<void> {
  await probeEnvironment();
  publish();
  if (envOnly) {
    result.ok = true;
    result.stage = 'done';
    publish();
    (window as unknown as Dict).__PROBE_DONE__ = true;
    return;
  }

  result.stage = 'renderer-create';
  const stage = document.getElementById('stage') as HTMLDivElement;
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = useShadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  stage.appendChild(renderer.domElement);

  const tInit0 = performance.now();
  result.stage = 'renderer-init';
  await renderer.init();
  result.timings.initMs = Math.round(performance.now() - tInit0);

  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean; device?: { queue: { onSubmittedWorkDone(): Promise<void> } }; gl?: WebGL2RenderingContext };
  const isWebGPU = backend.isWebGPUBackend === true;
  const isWebGL = backend.isWebGLBackend === true;
  result.backend = { name: isWebGPU ? 'webgpu' : isWebGL ? 'webgl2' : 'unknown', isWebGPUBackend: isWebGPU, isWebGLBackend: isWebGL };
  if (isWebGL && backend.gl) {
    const gl = backend.gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    result.info.glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }
  publish();

  // WebGL: gl.finish() blockiert in Chromium/ANGLE/SwiftShader nicht bis zum Raster-Ende (gemessen ~0,1 ms).
  // readPixels(1×1) erzwingt dagegen einen echten Abschluss → ?sync=readpixels (Default) für ehrliche Frame-Zeiten.
  const syncMode = params.get('sync') ?? 'readpixels';
  const px = new Uint8Array(4);
  const gpuSync = async (): Promise<void> => {
    if (isWebGPU && backend.device) await backend.device.queue.onSubmittedWorkDone();
    else if (backend.gl) {
      if (syncMode === 'finish') backend.gl.finish();
      else backend.gl.readPixels(0, 0, 1, 1, backend.gl.RGBA, backend.gl.UNSIGNED_BYTE, px);
    }
  };

  result.stage = 'scene-build';
  const { scene, camera, animate } = buildScene();

  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  pipeline.outputNode = useBloom ? sceneColor.add(bloom(sceneColor, 0.9, 0.4, 0.75)) : sceneColor;

  // Erster Frame inkl. Pipeline-/Shader-Kompilierung.
  result.stage = 'first-frame';
  const tFirst = performance.now();
  animate(0);
  pipeline.render();
  await gpuSync();
  result.timings.firstFrameMs = Math.round(performance.now() - tFirst);
  publish();

  // Aufwärmen.
  result.stage = 'warmup';
  for (let i = 0; i < 5; i++) {
    animate(i / 60);
    pipeline.render();
    await gpuSync();
  }

  // Synchron gemessene Frames: CPU-Submit + Warten auf GPU-Abschluss (bei SwiftShader = echte Rasterzeit).
  result.stage = 'measure-sync';
  const cpuOnly: number[] = [];
  const cpuGpu: number[] = [];
  for (let i = 0; i < frames; i++) {
    animate(1 + i / 60);
    const t0 = performance.now();
    pipeline.render();
    const t1 = performance.now();
    await gpuSync();
    const t2 = performance.now();
    cpuOnly.push(t1 - t0);
    cpuGpu.push(t2 - t0);
  }
  result.timings.submitMs = stats(cpuOnly);
  result.timings.frameMs = stats(cpuGpu);
  const info = renderer.info as unknown as { render: Dict; memory: Dict };
  result.info = {
    ...result.info,
    drawCalls: info.render.drawCalls,
    frameCalls: info.render.frameCalls,
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
  };
  publish();

  // rAF-Durchsatz, so wie ein Spiel-Loop laufen würde (3 s).
  result.stage = 'measure-raf';
  const rafIntervals: number[] = [];
  await new Promise<void>((resolve) => {
    let last = performance.now();
    const start = last;
    const loop = () => {
      const now = performance.now();
      rafIntervals.push(now - last);
      last = now;
      animate(now / 1000);
      pipeline.render();
      if (now - start < 3000) requestAnimationFrame(loop);
      else resolve();
    };
    requestAnimationFrame(loop);
  });
  rafIntervals.shift();
  result.timings.rafIntervalMs = stats(rafIntervals);
  await gpuSync();

  // Pixel-Stichprobe: wurde wirklich etwas Sichtbares gerendert?
  result.stage = 'pixels';
  try {
    animate(2);
    pipeline.render();
    await gpuSync();
    const c2 = document.createElement('canvas');
    c2.width = 64; c2.height = 36;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(renderer.domElement, 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      let lum = 0; let nonDark = 0; const buckets = new Set<number>();
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        lum += l;
        if (l > 24) nonDark++;
        buckets.add(((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5));
      }
      const n = d.length / 4;
      result.pixels = { meanLuma: Math.round(lum / n), nonDarkFraction: Math.round((nonDark / n) * 100) / 100, colorBuckets: buckets.size };
    }
  } catch (err) {
    result.pixels = { error: String(err) };
  }

  result.ok = result.errors.length === 0;
  result.stage = 'done';
  publish();
  (window as unknown as Dict).__PROBE_DONE__ = true;
}

main().catch((err: unknown) => {
  result.errors.push(`fatal@${result.stage}: ${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`);
  result.ok = false;
  publish();
  (window as unknown as Dict).__PROBE_DONE__ = true;
});
