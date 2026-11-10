// Plays the game with the bot and reports whether the stage can be completed.
//   node tests/run.mjs                 full playthrough from the plaza to the tip, as one run
//   node tests/run.mjs --each          every section on its own, from its checkpoint (pinpoints a broken section)
//   node tests/run.mjs --only=festival one section
//   node tests/run.mjs --god           nothing hurts (route feasibility only)
//   node tests/run.mjs --url=http://127.0.0.1:5173/   use a running dev server instead of starting one
//   node tests/run.mjs --shots         save a screenshot at the end of each section (tests/out/bot/)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const outDir = path.join(root, 'tests', 'out', 'bot');
fs.mkdirSync(outDir, { recursive: true });

let server = null;
let url = args.url;
if (!url) {
  server = await createServer({ root, server: { port: 5179, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });

async function boot() {
  await page.goto(url);
  await page.waitForFunction(() => window.indy && window.indy.game.state === 'title', null, { timeout: 60000 });
  await page.evaluate(() => window.indy.start());
  await page.waitForFunction(() => window.indy.game.state === 'play', null, { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.evaluate((god) => { window.indy.manual(true); window.indy.god(!!god); }, !!args.god);
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'tests', 'bot.js'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'tests', 'route.js'), 'utf8') });
}

async function runSection(i, alone) {
  return page.evaluate(([i, alone]) => {
    const s = window.route[i];
    const t0 = window.bot.steps;
    try {
      if (alone && s.cp != null) { window.indy.cp(s.cp); window.bot.hold({}, 30); }
      const g = window.indy.game;
      const before = { hearts: g.hearts, naps: g.naps };
      s.run();
      return { name: s.name, ok: true, seconds: +((window.bot.steps - t0) / 60).toFixed(1), heartsLost: Math.max(0, before.hearts - g.hearts), naps: g.naps - before.naps, info: window.indy.info() };
    } catch (e) {
      return { name: s.name, ok: false, seconds: +((window.bot.steps - t0) / 60).toFixed(1), error: String(e.message || e) };
    }
  }, [i, alone]);
}

await boot();
if (args.eval) {
  // debugging aid: run a snippet (the body of a function using window.bot / window.indy) and print what it returns
  const body = fs.readFileSync(args.eval, 'utf8');
  const res = await page.evaluate((body) => { try { return new Function(body)(); } catch (e) { return 'ERROR ' + (e.stack || e); } }, body);
  console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
  if (args.shot) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(outDir, String(args.shot)) }); }
  await browser.close(); if (server) await server.close();
  process.exit(0);
}
const names =await page.evaluate(() => window.route.map((s) => s.name));
const wanted = args.only ? names.map((n, i) => (String(args.only).split(',').includes(n) ? i : -1)).filter((i) => i >= 0) : names.map((_, i) => i);
const alone = !!args.each || !!args.only;
const results = [];
for (const i of wanted) {
  if (alone && results.length) await boot();
  const r = await runSection(i, alone);
  results.push(r);
  if (args.shots || !r.ok) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `${String(i).padStart(2, '0')}_${r.name}${r.ok ? '' : '_FAILED'}.png` ) });
  }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(11)} ${String(r.seconds).padStart(6)} s  ${r.ok ? `hearts lost ${r.heartsLost}, naps ${r.naps}` : r.error}`);
  if (!r.ok && !alone) break;
}
const final = await page.evaluate(() => window.indy.info());
const ok = results.length === wanted.length && results.every((r) => r.ok);
const total = results.reduce((s, r) => s + r.seconds, 0);
console.log(`\n${ok ? 'STAGE COMPLETED' : 'NOT COMPLETED'}: ${results.filter((r) => r.ok).length}/${wanted.length} sections, ${total.toFixed(0)} s of play, state "${final.state}", treats ${final.treats}/${final.total}`);
if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].slice(0, 10).join('\n  '));
await browser.close();
if (server) await server.close();
process.exit(ok && !errors.length ? 0 : 1);
