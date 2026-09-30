// Wie _raw.mjs, startet Chromium aber selbst (volles stderr-Log) und verbindet per CDP.
// Aufruf: [EXE=shell] node scripts/qa/_rawcdp.mjs "<query>" --flag ...   (Log: $SCRATCH/chrome-stderr.log bzw. LOGFILE)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [,, query = '', ...args] = process.argv;
const exe = process.env.EXE === 'shell' ? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = 9333;
const userDir = mkdtempSync(join(tmpdir(), 'rb-cdp-'));
const logFile = process.env.LOGFILE ?? join(userDir, 'chrome-stderr.log');
const log = createWriteStream(logFile);
const headless = process.env.HEADED ? [] : [process.env.EXE === 'shell' ? '' : '--headless=new'].filter(Boolean);
const proc = spawn(exe, [...headless, '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${userDir}`, `--remote-debugging-port=${port}`, '--enable-logging=stderr', '--v=1', ...args, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
proc.stdout.pipe(log); proc.stderr.pipe(log);
let browser;
for (let i = 0; i < 50 && !browser; i++) { await new Promise((r) => setTimeout(r, 200)); browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = await ctx.newPage();
await page.goto('http://localhost:5199/scripts/qa/probe/raw.html?' + query);
await page.waitForFunction(() => window.__PROBE_DONE__ === true, null, { timeout: 120000, polling: 200 });
const r = await page.evaluate(() => window.__PROBE_RESULT__);
let shotPixel;
if (process.env.SHOT) {
  const buf = await page.screenshot({ path: process.env.SHOT });
  // Screenshot im Browser dekodieren und Pixel in der Canvas-Mitte (Dreieck) bzw. Ecke (Clear-Farbe) lesen.
  shotPixel = await page.evaluate(async (b64) => {
    const cv = document.querySelector('canvas');
    if (!cv) return null;
    const bb = cv.getBoundingClientRect();
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const at = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    return { center: at(bb.left + bb.width / 2, bb.top + bb.height * 0.62), corner: at(bb.left + 4, bb.top + 4) };
  }, buf.toString('base64'));
}
console.log(JSON.stringify({ ok: r.ok, stages: r.stages.map((s) => `${s.name}:${s.ok ? 'ok' : 'FAIL ' + s.error}`), lost: r.lost, canvasPixel: r.canvasPixel, shotPixel, canvasFrameMs: r.canvasFrameMs }));
await browser.close().catch(() => {});
proc.kill('SIGKILL');
console.log('log:', logFile);
