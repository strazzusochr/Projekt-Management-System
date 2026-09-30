// Visual QA: screenshots of the map and every level, plus a mouse-driven playthrough.
// Usage: node scripts/shots.mjs [baseUrl] [quality] [renderer=auto|webgl] [levels=forest,temple,...] [play=1]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [, , base = 'http://localhost:5173', quality = 'medium', renderer = 'webgl', levelsArg = 'forest,temple,neon,harbor,ice', play = '0'] = process.argv;
const out = `qa-output/shots/${renderer}-${quality}`;
mkdirSync(out, { recursive: true });
const args = renderer === 'webgpu' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const r = renderer === 'webgl' ? '&renderer=webgl' : '';
const waitReady = async () => {
  await page.waitForFunction(() => window.__RIVERBOUND_QA__?.isReady?.(), null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => window.__RIVERBOUND_QA__.waitIdle(240000));
};
const t0 = Date.now();
await page.goto(`${base}/?qa=1&mute=1&adaptive=0&quality=${quality}${r}`);
await waitReady();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/00-map.png` });
console.log('map', (Date.now() - t0) / 1000, 's', JSON.stringify(await page.evaluate(() => window.__RIVERBOUND_QA__.rendererInfo())));
for (const id of levelsArg.split(',')) {
  const t1 = Date.now();
  await page.goto(`${base}/?qa=1&mute=1&adaptive=0&quality=${quality}${r}&level=${id}`);
  await waitReady();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${id}-1-start.png` });
  const info = await page.evaluate(() => window.__RIVERBOUND_QA__.rendererInfo());
  console.log(id, 'loaded', (Date.now() - t1) / 1000, 's', JSON.stringify(info));
  if (play === '1') {
    const click = async (pos) => { await page.mouse.move(pos.x, pos.y); await page.mouse.down(); await page.mouse.up(); };
    let guard = 0;
    while (guard++ < 30) {
      const st = await page.evaluate(() => window.__RIVERBOUND_QA__.currentLevel());
      if (st.won) break;
      const sol = await page.evaluate(() => window.__RIVERBOUND_QA__.solveFromCurrent());
      const group = sol.actions[0];
      for (const eid of st.boatLoad) if (!group.includes(eid)) { const p = await page.evaluate((e) => window.__RIVERBOUND_QA__.entityScreenPos(e), eid); if (!(await page.evaluate(() => 0))) {} await click(p); await page.evaluate(() => window.__RIVERBOUND_QA__.waitIdle()); }
      for (const eid of group) {
        const cur = await page.evaluate(() => window.__RIVERBOUND_QA__.currentLevel());
        if (cur.boatLoad.includes(eid)) continue;
        const p = await page.evaluate((e) => window.__RIVERBOUND_QA__.entityScreenPos(e), eid);
        await click(p);
        await page.evaluate(() => window.__RIVERBOUND_QA__.waitIdle());
      }
      await page.click('[data-testid="btn-sail"]');
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__RIVERBOUND_QA__.waitIdle(240000));
      if (guard === 2) await page.screenshot({ path: `${out}/${id}-2-crossing.png` });
    }
    const fin = await page.evaluate(() => window.__RIVERBOUND_QA__.currentLevel());
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${id}-3-end.png` });
    console.log(id, 'won=', fin.won, 'moves=', fin.moves, 'cost=', fin.cost, (Date.now() - t1) / 1000, 's');
  }
}
const errs = await page.evaluate(() => window.__RIVERBOUND_QA__?.errors?.() ?? []);
console.log('errors', JSON.stringify(errs.slice(0, 20)));
console.log('console', JSON.stringify(logs.slice(0, 30)));
await browser.close();
