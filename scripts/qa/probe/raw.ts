/**
 * Riverbound QA – Roh-WebGPU-Probe (ohne three.js).
 *
 * Stufen (einzeln getimt, jede mit eigenem Fehlerstatus):
 *   adapter   – navigator.gpu.requestAdapter(...)
 *   device    – adapter.requestDevice()
 *   offscreen – Dreieck in eine rgba8unorm-Textur rendern, per copyTextureToBuffer + mapAsync zurücklesen
 *   canvas    – GPUCanvasContext.configure + getCurrentTexture + Render-Pass über mehrere Frames,
 *               danach Canvas per drawImage in 2D-Canvas zurücklesen
 * So lässt sich unterscheiden, ob ein Device-Lost vom Rendern an sich oder vom Canvas-/Swapchain-Pfad kommt.
 */
/// <reference types="@webgpu/types" />
type Dict = Record<string, unknown>;

const params = new URLSearchParams(location.search);
const order = (params.get('order') ?? 'offscreen,canvas').split(',');
const frames = Number(params.get('frames') ?? 5);
const alphaMode = (params.get('alpha') ?? 'premultiplied') as 'opaque' | 'premultiplied';

const result: Dict & { stages: Dict[]; errors: string[]; lost: Dict | null } = {
  ok: false, stage: 'start', stages: [], errors: [], lost: null, adapter: null, userAgent: navigator.userAgent,
};
const w = window as unknown as Dict;
w.__PROBE_RESULT__ = result;
w.__PROBE_DONE__ = false;
window.addEventListener('error', (e) => result.errors.push(`onerror: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => result.errors.push(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`));
const out = document.getElementById('result') as HTMLPreElement;
const publish = () => { out.textContent = JSON.stringify(result, null, 1); };

const WGSL = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(0.0, 0.8), vec2f(-0.8, -0.8), vec2f(0.8, -0.8));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.1, 0.8, 0.3, 1.0); }
`;

async function stage<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  result.stage = name;
  const t0 = performance.now();
  const rec: Dict = { name };
  result.stages.push(rec);
  try {
    const v = await fn();
    rec.ok = true;
    rec.ms = Math.round(performance.now() - t0);
    if (v !== undefined && typeof v !== 'object') rec.value = v;
    return v;
  } catch (err) {
    rec.ok = false;
    rec.ms = Math.round(performance.now() - t0);
    rec.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return undefined;
  } finally {
    publish();
  }
}

function pipelineFor(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: WGSL });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
}

async function main(): Promise<void> {
  const gpu = navigator.gpu;
  if (!gpu) { result.errors.push('navigator.gpu fehlt'); return; }
  const opts: GPURequestAdapterOptions = {};
  if (params.get('fallback') === '1') opts.forceFallbackAdapter = true;
  const pp = params.get('pp');
  if (pp === 'low') opts.powerPreference = 'low-power';
  if (pp === 'high') opts.powerPreference = 'high-performance';
  result.requestOptions = opts;

  const adapter = await stage('adapter', async () => {
    const a = await gpu.requestAdapter(opts);
    if (!a) throw new Error('requestAdapter() lieferte null');
    const info = a.info as unknown as Dict;
    result.adapter = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
    return a;
  });
  if (!adapter) return;

  const device = await stage('device', async () => {
    const d = await adapter.requestDevice();
    d.lost.then((info) => { result.lost = { reason: info.reason, message: info.message, atStage: result.stage }; publish(); });
    d.addEventListener('uncapturederror', (ev) => result.errors.push(`uncapturederror: ${(ev as GPUUncapturedErrorEvent).error.message}`));
    return d;
  });
  if (!device) return;

  for (const name of order) {
    if (name === 'offscreen') {
      await stage('offscreen', async () => {
        const size = 64;
        const tex = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        const pipe = pipelineFor(device, 'rgba8unorm');
        const buf = device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.5, g: 0, b: 0, a: 1 } }] });
        pass.setPipeline(pipe);
        pass.draw(3);
        pass.end();
        enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: size * 4 }, [size, size]);
        device.queue.submit([enc.finish()]);
        await buf.mapAsync(GPUMapMode.READ);
        const px = new Uint8Array(buf.getMappedRange());
        const at = (x: number, y: number) => Array.from(px.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
        const center = at(32, 40);
        const corner = at(1, 1);
        buf.unmap();
        result.offscreenPixels = { center, corner };
        if (center[1] < 150 || corner[0] < 100) throw new Error(`unerwartete Pixel center=${center} corner=${corner}`);
      });
    }
    if (name === 'canvas') {
      await stage('canvas', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('webgpu');
        if (!ctx) throw new Error('getContext("webgpu") lieferte null');
        const format = gpu.getPreferredCanvasFormat();
        result.canvasFormat = format;
        ctx.configure({ device, format, alphaMode });
        const pipe = pipelineFor(device, format);
        const frameMs: number[] = [];
        for (let i = 0; i < frames; i++) {
          const t0 = performance.now();
          const enc = device.createCommandEncoder();
          const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.5, g: 0, b: 0, a: 1 } }] });
          pass.setPipeline(pipe);
          pass.draw(3);
          pass.end();
          device.queue.submit([enc.finish()]);
          await device.queue.onSubmittedWorkDone();
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          frameMs.push(Math.round((performance.now() - t0) * 10) / 10);
          if (result.lost) throw new Error(`Device lost nach Frame ${i}`);
        }
        result.canvasFrameMs = frameMs;
        const c2 = document.createElement('canvas');
        c2.width = 32; c2.height = 32;
        const g = c2.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(canvas, 0, 0, 32, 32);
        const d = g.getImageData(16, 20, 1, 1).data;
        result.canvasPixel = Array.from(d);
        if (d[1] < 100) throw new Error(`Canvas-Readback unerwartet: ${Array.from(d)}`);
      });
    }
  }
  result.ok = result.stages.every((s) => s.ok) && !result.lost;
}

main()
  .catch((err: unknown) => result.errors.push(`fatal@${String(result.stage)}: ${String(err)}`))
  .finally(async () => {
    await new Promise((r) => setTimeout(r, 300)); // device.lost-Promise noch auflösen lassen
    result.stage = 'done';
    publish();
    w.__PROBE_DONE__ = true;
  });
