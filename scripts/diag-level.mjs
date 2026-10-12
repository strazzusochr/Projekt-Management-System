// Loads one level, prints renderer stats + all console errors/warnings, saves a screenshot.
// Usage: node scripts/diag-level.mjs <level> [webgl|auto] [quality] [port]
import { chromium } from '@playwright/test';
const [, , level = 'temple', renderer = 'webgl', quality = 'low', port = '5174'] = process.argv;
const args = renderer === 'webgl' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args });
const page = await b.newPage({ viewport: { width: 1100, height: 620 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message.slice(0, 400)}`));
const r = renderer === 'webgl' ? '&renderer=webgl' : '';
await page.goto(`http://localhost:${port}/?qa=1&mute=1&adaptive=0&quality=${quality}${r}&level=${level}`);
try {
  await page.waitForFunction(() => window.__RIVERBOUND_QA__?.isReady?.(), null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__RIVERBOUND_QA__.waitIdle(300000));
  await page.waitForTimeout(1500);
  console.log('screen', await page.evaluate(() => window.__RIVERBOUND_QA__.screen()), JSON.stringify(await page.evaluate(() => window.__RIVERBOUND_QA__.rendererInfo())));
} catch (e) { console.log('LOAD FAIL', String(e).slice(0, 200)); }
await page.screenshot({ path: `qa-output/diag-${level}-${renderer}.png` });
console.log([...new Set(logs)].filter((l) => !l.includes('favicon') && !l.includes('404')).slice(0, 25).join('\n'));
await b.close();
