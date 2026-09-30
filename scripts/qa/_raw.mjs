// Roh-WebGPU-Probe (scripts/qa/probe/raw.html) mit beliebigen Chromium-Flags ausführen.
// Aufruf: [EXE=shell] [HEADED=1] [LOG=1] node scripts/qa/_raw.mjs "<query>" --flag1 --flag2 ...
import { chromium } from '@playwright/test';
const [,, query = '', ...args] = process.argv;
const exe = process.env.EXE === 'shell' ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const logs = [];
const browser = await chromium.launch({ executablePath: exe, headless: !process.env.HEADED, args,
  logger: { isEnabled: (n) => n === 'browser', log: (n, s, m) => { const t = String(m); if (!/DevTools listening|Fontconfig|dbus|DBus|pw:browser <launching>|<launched>/.test(t)) logs.push(t.slice(0, 400)); } } });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[console.${m.type()}] ${m.text().slice(0, 300)}`); });
const t0 = Date.now();
await page.goto('http://localhost:5199/scripts/qa/probe/raw.html?' + query);
await page.waitForFunction(() => window.__PROBE_DONE__ === true, null, { timeout: 120000, polling: 200 });
const r = await page.evaluate(() => window.__PROBE_RESULT__);
console.log(JSON.stringify({ args, query, ok: r.ok, adapter: r.adapter, stages: r.stages, lost: r.lost, offscreenPixels: r.offscreenPixels, canvasFormat: r.canvasFormat, canvasFrameMs: r.canvasFrameMs, canvasPixel: r.canvasPixel, errors: r.errors }, null, 0));
if (process.env.LOG) console.log('--- browser log ---\n' + logs.filter((l) => !/^\s*$/.test(l)).slice(0, 60).join('\n'));
console.log('wall', Date.now() - t0);
await browser.close();
