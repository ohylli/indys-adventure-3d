// Plays for a few seconds the way a phone would: taps START, drags the virtual stick, taps JUMP and MEOW.
//   node tests/touch-check.mjs [--url=http://127.0.0.1:5173/]
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const outDir = path.join(root, 'tests', 'out', 'touch');
fs.mkdirSync(outDir, { recursive: true });
let server = null, url = args.url;
if (!url) {
  server = await createServer({ root, server: { port: 5178, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || /\[audio\]/.test(m.text())) errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

await page.goto(url);
await page.waitForFunction(() => window.indy && window.indy.game.state === 'title', null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, 'title.png') });
await page.tap('[data-act="start"]', { force: true });
await page.waitForFunction(() => window.indy.game.state === 'play', null, { timeout: 10000 });
await page.waitForTimeout(1200);
check('touch controls are shown', await page.evaluate(() => { const b = document.querySelector('[data-touch="jump"]'); return !!b && b.getBoundingClientRect().width > 20 && getComputedStyle(b).visibility !== 'hidden'; }));

const before = await page.evaluate(() => window.indy.info());
// drag the stick to the right for a second
await touch('touchStart', [[150, 280, 1]]);
await touch('touchMove', [[230, 280, 1]]);
await page.waitForTimeout(1000);
const mid = await page.evaluate(() => window.indy.info());
check('the stick moves Indy', Math.abs(mid.a - before.a) > 5, `(angle ${before.a} -> ${mid.a})`);
// jump while still holding the stick
const jumpBox = await page.evaluate(() => { const r = document.querySelector('[data-touch="jump"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await touch('touchStart', [[230, 280, 1], [jumpBox[0], jumpBox[1], 2]]);
await page.waitForTimeout(150);
const air = await page.evaluate(() => window.indy.info());
check('JUMP jumps while the stick is held', air.move === 'air' && air.y > 0.3, `(y ${air.y}, ${air.move})`);
await page.screenshot({ path: path.join(outDir, 'play.png') });
await touch('touchEnd', [[230, 280, 1]]);
await touch('touchEnd', []);
await page.waitForTimeout(700);
const meowBox = await page.evaluate(() => { const r = document.querySelector('[data-touch="meow"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.evaluate(() => { window.__meows = 0; const g = window.indy.game; const orig = g._meow.bind(g); g._meow = () => { window.__meows++; orig(); }; });
await touch('touchStart', [[meowBox[0], meowBox[1], 3]]);
await page.waitForTimeout(120);
await touch('touchEnd', []);
await page.waitForTimeout(200);
check('MEOW meows', await page.evaluate(() => window.__meows) === 1);
const pauseBox = await page.evaluate(() => { const r = document.querySelector('[data-touch="pause"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.touchscreen.tap(pauseBox[0], pauseBox[1]);
await page.waitForTimeout(500);
check('the pause button pauses', await page.evaluate(() => window.indy.game.state) === 'pause');
await page.screenshot({ path: path.join(outDir, 'pause.png') });
await page.tap('[data-act="resume"]', { force: true });      // the focused button animates, so it is never "stable"
await page.waitForTimeout(400);
check('Resume resumes', await page.evaluate(() => window.indy.game.state) === 'play');
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
if (server) await server.close();
process.exit(results.every(Boolean) ? 0 : 1);
