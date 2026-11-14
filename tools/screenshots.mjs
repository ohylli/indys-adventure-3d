// Retakes the README screenshots (screenshots/*.png, 1280x720): the title screen, then the bot plays the whole
// stage (tests/route.js) and a shot is taken whenever one of SHOTS below says the moment has come.
//
//   node tools/screenshots.mjs                        all of them -> screenshots/
//   node tools/screenshots.mjs --only=wheel,claim     some of them (the bot still climbs from the plaza)
//   node tools/screenshots.mjs --out=tests/out/shots  somewhere else (to compare before replacing)
//   node tools/screenshots.mjs --url=http://127.0.0.1:5173/   use a running dev server
//
// The game runs in manual mode, stepped by the bot. When a shot is due, the bot's step hook calls back here and
// waits: the game's own frame loop keeps drawing (and the HUD keeps animating) while Playwright takes the picture.
// The bot plays faster than real time, so the HUD's toasts and section banners pile up: they are cleared before
// a shot (a shot with `banner: true` keeps the section banner). Particles age in real time, not game time, so the
// shot waits a second for the meow rings of the last few hundred steps to fade.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const outDir = path.resolve(root, String(args.out || 'screenshots'));
fs.mkdirSync(outDir, { recursive: true });

// When each shot is taken. `section` is a route section name; `when` runs in the page (with P = player, G = game,
// S = steps since the section started) and is checked after every bot step of that section. `retro` turns retro
// mode on for the shot (with its toast) and off again afterwards.
const SHOTS = [
  { name: 'plaza', section: 'plaza', when: 'S === 150' },
  { name: 'wheel', banner: true, section: 'ferris', when: "P.ground && P.ground.mover && P.ground.mover.name === 'ferris_gondola' && P.pos.y > 17.3" },
  { name: 'coaster', section: 'coaster', when: 'P.pos.y > 23.4' },
  { name: 'swinger', section: 'swinger', when: "P.ground && P.ground.mover && P.ground.mover.name === 'swing_chair' && (window.__seatS = (window.__seatS || 0) + 1) > 60" },
  { name: 'festival', section: 'festival', when: "P.ground && P.ground.mover && P.ground.mover.name === 'hot_air_balloon' && P.pos.y > 81.5" },
  { name: 'lanterns', section: 'underside', when: 'P.radial > 12.8 && P.state === "air"' },
  { name: 'restaurant', section: 'restaurant', when: 'P.ground && P.ground.mover && P.pos.y > 102.5' },
  { name: 'retro', section: 'needle', when: 'S === 1', retro: true },
  { name: 'needle', section: 'needle', when: "P.state === 'climb' && P.pos.y > 120.5" },
  { name: 'claim', section: 'needle', when: "G.state === 'claim' && G.claimT > 2.6" },
];
const only = args.only ? String(args.only).split(',') : null;
const wantTitle = !only || only.includes('title');
const shots = SHOTS.filter((s) => !only || only.includes(s.name));

let server = null;
let url = args.url;
if (!url) {
  server = await createServer({ root, server: { port: 5183, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });

const save = async (name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('saved', path.relative(root, file));
};

await page.exposeFunction('__snap', async (name, retro, banner) => {
  await page.evaluate((banner) => {
    for (const t of document.querySelectorAll('#ui .toast')) t.remove();
    if (!banner) document.querySelector('#ui .banner').classList.remove('in', 'out');
  }, banner);
  if (retro) {
    await page.evaluate(() => window.indy.release());
    await page.keyboard.press('KeyR');
  }
  await page.waitForTimeout(1100);
  await save(name);
  if (retro) { await page.keyboard.press('KeyR'); await page.waitForTimeout(100); }
});

await page.goto(url);
await page.waitForFunction(() => window.indy && window.indy.game.state === 'title', null, { timeout: 60000 });
if (wantTitle) { await page.waitForTimeout(2500); await save('title'); }

if (shots.length) {
  await page.evaluate(() => window.indy.start());
  await page.waitForFunction(() => window.indy.game.state === 'play', null, { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.indy.manual(true));
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'tests', 'bot.js'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'tests', 'route.js'), 'utf8') });
  const res = await page.evaluate(async (shots) => {
    const b = window.bot;
    const pending = shots.map((s) => ({ ...s, test: new Function('P', 'G', 'S', `return (${s.when});`) }));
    let section = null, s0 = 0;
    const G = window.indy.game;
    b.onStep = async () => {
      const S = b.steps - s0;
      for (const s of pending) {
        if (s.done || s.section !== section || !s.test(G.player, G, S)) continue;
        s.done = true;
        await window.__snap(s.name, !!s.retro, !!s.banner);
      }
    };
    try {
      for (const sec of window.route) {
        if (pending.every((s) => s.done)) break;
        section = sec.name; s0 = b.steps;
        await sec.run();
      }
      // the claim plays on after the route ends
      for (let i = 0; i < 600 && !pending.every((s) => s.done); i++) await b.hold({}, 1);
    } catch (e) {
      return { error: String(e.message || e), missed: pending.filter((s) => !s.done).map((s) => s.name) };
    }
    return { missed: pending.filter((s) => !s.done).map((s) => s.name) };
  }, shots.map(({ name, section, when, retro, banner }) => ({ name, section, when, retro, banner })));
  if (res.error) console.log('the bot failed:', res.error);
  if (res.missed.length) console.log('not taken:', res.missed.join(', '));
}

if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].slice(0, 10).join('\n  '));
await browser.close();
if (server) await server.close();
