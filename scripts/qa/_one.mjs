import { chromium } from '@playwright/test';
const [,, query = '', ...args] = process.argv;
const exe = process.env.EXE === 'shell' ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, headless: process.env.HEADED ? false : true, args,
  logger: process.env.LOG ? { isEnabled: (n) => n === 'browser', log: (n, s, m) => { const t = String(m); if (!/DevTools|Fontconfig/.test(t)) console.log('[browser]', t.slice(0, 300)); } } : undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() !== 'log' && m.type() !== 'debug') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto('http://localhost:5199/scripts/qa/probe/index.html?' + query);
await page.waitForFunction(() => window.__PROBE_DONE__ === true, null, { timeout: 300000, polling: 250 });
const r = await page.evaluate(() => window.__PROBE_RESULT__);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
console.log(JSON.stringify({ backend: r.backend?.name, ok: r.ok, stage: r.stage, timings: r.timings, info: r.info, pixels: r.pixels, errors: r.errors.map(e => e.slice(0, 200)), warnings: r.warnings.map(e => e.slice(0,200)) }, null, 1));
console.log('wall', Date.now() - t0);
await browser.close();
