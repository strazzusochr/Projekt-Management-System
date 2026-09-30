#!/usr/bin/env node
/**
 * Riverbound QA – GPU-/Renderer-Flag-Matrix für headless Chromium.
 *
 * Startet (falls nötig) einen Vite-Server auf Port 5199, öffnet die Probe-Seite
 * scripts/qa/probe/index.html mit verschiedenen Chromium-Binaries, Headless-Modi und Launch-Flags
 * und schreibt die Ergebnisse nach qa-output/gpu-probe/.
 *
 * Aufruf:
 *   node scripts/qa/gpu-probe.mjs              # Phase A (Erkennung, alle Kombinationen) + Phase B (Rendering, Kandidaten)
 *   node scripts/qa/gpu-probe.mjs --phase=a    # nur Erkennung
 *   node scripts/qa/gpu-probe.mjs --phase=b    # nur Rendering-Messung der Kandidaten
 *   node scripts/qa/gpu-probe.mjs --only=<id>[,<id>...]  # nur diese Flag-Kombinationen (Phase B)
 *   node scripts/qa/gpu-probe.mjs --modes=full-headless-new,shell-headless-old,full-headed-xvfb
 *   node scripts/qa/gpu-probe.mjs --gpu-page   # zusätzlich chrome://gpu-Text sichern
 *   node scripts/qa/gpu-probe.mjs --tag=<name> # Ergebnisdateien mit Suffix, statt phase-*.json zu überschreiben
 *
 * Headed-Läufe (headless:false) brauchen ein X-Display: `xvfb-run -a node scripts/qa/gpu-probe.mjs`.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'qa-output/gpu-probe');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const PROBE = `${BASE}/scripts/qa/probe/index.html`;

const BIN = {
  full: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  shell: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
};

// Playwright setzt selbst --enable-features=CDPScreenshotNewSurface. Chromium wertet bei doppelten
// Switches nur den letzten aus, deshalb wird das Feature hier immer mitgeführt.
const feat = (...f) => `--enable-features=${['CDPScreenshotNewSurface', ...f].join(',')}`;

/** Flag-Kombinationen. id muss eindeutig sein. */
export const FLAGSETS = [
  // Ergebnis der Device-Lost-Analyse (docs/QA-ENVIRONMENT.md): WebGPU-Canvas braucht GPU-Compositing über
  // Skia/Vulkan (SwiftShader), sonst fehlt die SharedImage-Backing-Factory für die WebGPU-Swapchain.
  { id: 'webgpu-skia-vk-ss', args: ['--enable-unsafe-webgpu', '--disable-blink-features=WebGPUExperimentalFeatures', '--use-angle=swiftshader', feat('Vulkan'), '--use-vulkan=swiftshader'] },
  { id: 'webgpu-skia-vk-ss+blocklist', args: ['--enable-unsafe-webgpu', '--disable-blink-features=WebGPUExperimentalFeatures', '--use-angle=swiftshader', feat('Vulkan'), '--use-vulkan=swiftshader', '--ignore-gpu-blocklist'] },
  { id: 'webgpu-skia-vk-ss+exp', args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', feat('Vulkan'), '--use-vulkan=swiftshader'] },
  { id: 'none', args: [] },
  // Chromium 141 kennt `GPUTextureViewDescriptor.swizzle` nur in einer alten Experimental-Form (Dictionary),
  // three r186 übergibt dort immer den String 'rgba' -> TypeError. Die Blink-Runtime-Features abschalten:
  { id: 'unsafe-webgpu+no-exp', args: ['--enable-unsafe-webgpu', '--disable-blink-features=WebGPUExperimentalFeatures'] },
  { id: 'unsafe-webgpu+no-exp+no-dev', args: ['--enable-unsafe-webgpu', '--disable-blink-features=WebGPUExperimentalFeatures,WebGPUDeveloperFeatures'] },
  { id: 'unsafe-webgpu+vulkan+no-exp', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--disable-blink-features=WebGPUExperimentalFeatures'] },
  { id: 'wgpu-ss-full+no-exp', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--disable-blink-features=WebGPUExperimentalFeatures'] },
  { id: 'unsafe-webgpu', args: ['--enable-unsafe-webgpu'] },
  { id: 'unsafe-webgpu+vulkan', args: ['--enable-unsafe-webgpu', feat('Vulkan')] },
  { id: 'unsafe-webgpu+vulkan+webgpu-feat', args: ['--enable-unsafe-webgpu', feat('Vulkan', 'WebGPU')] },
  { id: 'unsafe-webgpu+adapter-swiftshader', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] },
  { id: 'unsafe-webgpu+vulkan+use-vulkan-ss', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--use-vulkan=swiftshader'] },
  { id: 'unsafe-webgpu+vulkan+use-vulkan-ss+adapter-ss', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] },
  { id: 'wgpu-ss+angle-vulkan', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=vulkan'] },
  { id: 'wgpu-ss+angle-swiftshader', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'] },
  { id: 'wgpu-ss+angle-swiftshader+unsafe-ss', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  { id: 'wgpu-ss+ignore-blocklist', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] },
  { id: 'wgpu-ss+no-vulkan-surface', args: ['--enable-unsafe-webgpu', feat('Vulkan'), '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'] },
  { id: 'angle-swiftshader', args: ['--use-angle=swiftshader'] },
  { id: 'angle-swiftshader+unsafe-ss', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  { id: 'gl-angle+swiftshader-webgl', args: ['--use-gl=angle', '--use-angle=swiftshader-webgl'] },
  { id: 'angle-vulkan+vulkan-ss', args: [feat('Vulkan'), '--use-vulkan=swiftshader', '--use-angle=vulkan'] },
  { id: 'disable-gpu', args: ['--disable-gpu'] },
  { id: 'unsafe-webgpu+disable-gpu', args: ['--enable-unsafe-webgpu', '--disable-gpu'] },
];

const argv = process.argv.slice(2);
const phase = (argv.find((a) => a.startsWith('--phase='))?.split('=')[1] ?? 'ab').toLowerCase();
const only = argv.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
const modeFilter = argv.find((a) => a.startsWith('--modes='))?.split('=')[1]?.split(',');
const withGpuPage = argv.includes('--gpu-page');
// --tag=<name>: Ergebnisdateien als phase-a-<name>.json / phase-b-<name>.json / report-<name>.json (nichts überschreiben)
const tag = argv.find((a) => a.startsWith('--tag='))?.split('=')[1];
const outName = (base) => (tag ? `${base}-${tag}.json` : `${base}.json`);
const hasDisplay = !!process.env.DISPLAY;

async function isUp() {
  try {
    const r = await fetch(PROBE, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isUp()) return null;
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isUp()) return proc;
  }
  try { process.kill(-proc.pid); } catch { /* ignore */ }
  throw new Error('Vite-Server auf Port 5199 kam nicht hoch');
}

function modes() {
  const m = [
    { id: 'full-headless-new', executablePath: BIN.full, headless: true },
    { id: 'shell-headless-old', executablePath: BIN.shell, headless: true },
  ];
  if (hasDisplay) m.push({ id: 'full-headed-xvfb', executablePath: BIN.full, headless: false });
  return modeFilter ? m.filter((x) => modeFilter.includes(x.id)) : m;
}

async function runProbe(mode, flagset, query, { screenshot, timeoutMs = 240_000 } = {}) {
  const started = Date.now();
  let browser;
  const consoleLines = [];
  try {
    browser = await chromium.launch({ executablePath: mode.executablePath, headless: mode.headless, args: flagset.args, timeout: 60_000 });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') consoleLines.push(`[${msg.type()}] ${msg.text()}`.slice(0, 400)); });
    page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${String(err).slice(0, 400)}`));
    await page.goto(`${PROBE}?${query}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__PROBE_DONE__ === true, null, { timeout: timeoutMs, polling: 250 });
    const result = await page.evaluate(() => window.__PROBE_RESULT__);
    let shot;
    if (screenshot) {
      // Pixelstatistik aus dem echten Compositor-Screenshot (drawImage(webgpuCanvas) ist in headless Chromium
      // mit Vulkan-Compositing leer, der Screenshot dagegen zuverlässig).
      const buf = await page.screenshot({ path: screenshot });
      shot = await page.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = 64; c.height = 36;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let lum = 0; let nonDark = 0; const buckets = new Set();
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          lum += l; if (l > 24) nonDark++;
          buckets.add(((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5));
        }
        const n = d.length / 4;
        return { meanLuma: Math.round(lum / n), nonDarkFraction: Math.round((nonDark / n) * 100) / 100, colorBuckets: buckets.size };
      }, buf.toString('base64')).catch((e) => ({ error: String(e) }));
    }
    let gpuPage;
    if (withGpuPage) {
      const gp = await browser.newPage();
      await gp.goto('chrome://gpu', { timeout: 30_000 }).catch(() => {});
      await gp.waitForTimeout(1500);
      gpuPage = await gp.evaluate(() => {
        const root = document.querySelector('info-view');
        const txt = (root?.shadowRoot ?? document.body)?.innerText ?? document.body.innerText;
        return txt.slice(0, 20000);
      }).catch((e) => `error: ${e}`);
    }
    return { ok: true, wallMs: Date.now() - started, result, shot, console: consoleLines.slice(0, 30), gpuPage };
  } catch (err) {
    return { ok: false, wallMs: Date.now() - started, error: String(err).slice(0, 1000), console: consoleLines.slice(0, 30) };
  } finally {
    await browser?.close().catch(() => {});
  }
}

function summarizeEnv(r) {
  if (!r.ok) return { launch: 'FAIL', error: r.error?.split('\n')[0] };
  const env = r.result?.env ?? {};
  const a = env.webgpuAdapter;
  return {
    navigatorGpu: env.hasNavigatorGpu,
    adapter: a ? `${a.vendor}/${a.architecture}/${a.description || a.device || ''}${a.isFallbackAdapter ? ' (fallback)' : ''}` : a === null ? 'null' : (env.webgpuAdapterError ?? 'n/a'),
    webgl2: env.webgl2 ? env.webgl2.renderer : env.webgl2 === null ? 'null' : (env.webgl2Error ?? 'n/a'),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await ensureServer();
  const report = { date: new Date().toISOString(), node: process.version, display: process.env.DISPLAY ?? null, phaseA: [], phaseB: [] };
  try {
    if (phase.includes('a')) {
      for (const mode of modes()) {
        for (const fs of FLAGSETS) {
          const r = await runProbe(mode, fs, 'envOnly=1&hud=0', { timeoutMs: 60_000 });
          const row = { mode: mode.id, flags: fs.id, args: fs.args, ...summarizeEnv(r), gpuPage: r.gpuPage };
          report.phaseA.push({ ...row, raw: r.result?.env, console: r.console });
          console.log(`[A] ${mode.id.padEnd(20)} ${fs.id.padEnd(48)} gpu=${String(row.navigatorGpu).padEnd(5)} adapter=${row.adapter} | webgl2=${row.webgl2}${row.launch ? ' LAUNCH FAIL ' + row.error : ''}`);
        }
      }
      writeFileSync(resolve(OUT, outName('phase-a')), JSON.stringify(report.phaseA, null, 1));
    }
    if (phase.includes('b')) {
      // Kandidaten: alles, was in Phase A einen WebGPU-Adapter oder WebGL2 geliefert hat (bzw. --only).
      let candidates = FLAGSETS.filter((f) => !only || only.includes(f.id));
      if (!only && report.phaseA.length) {
        const good = new Set(report.phaseA.filter((r) => (r.adapter && !['null', 'n/a'].includes(r.adapter)) || (r.webgl2 && r.webgl2 !== 'null')).map((r) => r.flags));
        candidates = candidates.filter((f) => good.has(f.id));
      }
      for (const mode of modes()) {
        for (const fs of candidates) {
          for (const renderer of ['auto', 'webgl']) {
            const q = `frames=40&hud=0${renderer === 'webgl' ? '&renderer=webgl' : ''}`;
            const shot = resolve(OUT, `${mode.id}__${fs.id}__${renderer}.png`);
            const r = await runProbe(mode, fs, q, { screenshot: shot });
            const res = r.result ?? {};
            const row = {
              mode: mode.id, flags: fs.id, args: fs.args, renderer,
              launchOk: r.ok, error: r.error, backend: res.backend?.name, ok: res.ok,
              initMs: res.timings?.initMs, firstFrameMs: res.timings?.firstFrameMs,
              frameMedianMs: res.timings?.frameMs?.median, frameP90Ms: res.timings?.frameMs?.p90,
              submitMedianMs: res.timings?.submitMs?.median, rafMedianMs: res.timings?.rafIntervalMs?.median,
              drawCalls: res.info?.drawCalls, triangles: res.info?.triangles,
              pixels: res.pixels, shot: r.shot, adapter: res.env?.webgpuAdapter ? `${res.env.webgpuAdapter.vendor}/${res.env.webgpuAdapter.architecture}/${res.env.webgpuAdapter.description ?? ''}` : null,
              glRenderer: res.info?.glRenderer ?? res.env?.webgl2?.renderer, errors: res.errors?.slice(0, 5), warnings: res.warnings?.slice(0, 5),
              wallMs: r.wallMs, screenshot: shot,
            };
            report.phaseB.push(row);
            console.log(`[B] ${mode.id.padEnd(20)} ${fs.id.padEnd(48)} ${renderer.padEnd(5)} -> backend=${row.backend} ok=${row.ok} init=${row.initMs}ms first=${row.firstFrameMs}ms frame(med)=${row.frameMedianMs}ms raf(med)=${row.rafMedianMs}ms shotLuma=${row.shot?.meanLuma} buckets=${row.shot?.colorBuckets} ${row.error ? 'ERR ' + row.error.split('\n')[0] : ''} ${(row.errors ?? []).join(' | ').slice(0, 200)}`);
          }
        }
      }
      writeFileSync(resolve(OUT, outName('phase-b')), JSON.stringify(report.phaseB, null, 1));
    }
    writeFileSync(resolve(OUT, outName('report')), JSON.stringify(report, null, 1));
    console.log(`\nErgebnisse: ${OUT}`);
  } finally {
    if (server) { try { process.kill(-server.pid); } catch { /* ignore */ } }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
