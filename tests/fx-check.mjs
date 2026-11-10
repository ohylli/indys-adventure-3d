// FX visual check: opens tools/fx.html, takes deterministic screenshots into tests/out/fx/, checks console errors
// and measures frame time with the fireworks show running.
// Needs the sandbox server: npx vite --port 5183 --strictPort   (then: node tests/fx-check.mjs [only-prefix])
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const URL = process.env.FX_URL ?? 'http://127.0.0.1:5183/tools/fx.html?clean';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'fx');
const only = process.argv[2] ?? '';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(URL);
await page.waitForFunction(() => window.fx && window.fx.ready);
await page.evaluate(() => fx.pause(true));

const shot = async (name) => {
  if (only && !name.startsWith(only)) return;
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('saved', name);
};
const ev = (fn, arg) => page.evaluate(fn, arg);

// --- sky ---
for (const t of [0, 0.25, 0.5, 0.75, 1]) {
  for (const v of ['sunward', 'away']) {
    await ev(([t, v]) => { fx.clear(); fx.setTime(t); fx.view(v); fx.step(1 / 60, 2); }, [t, v]);
    await shot(`sky_t${t.toFixed(2)}_${v}`);
  }
}
// sky from the top of the tower looking slightly down (horizon + fog), sunset
await ev(() => { fx.setTime(0.5); fx.setCam(35, 30, 130, -6); fx.step(1 / 60, 2); });
await shot('sky_t0.50_high_down');
await ev(() => { fx.setTime(1); fx.setCam(80, 30, 40, 4); fx.step(1 / 60, 2); });
await shot('sky_t1.00_side');

// --- particles (afternoon, camera ~8 units from a 1-unit stand-in) ---
const ptimes = { dust: 0.15, land: 0.15, jump: 0.12, sparkle: 0.2, heart: 0.45, star: 0.18, feather: 0.45,
  confetti: 0.6, splash: 0.3, pop: 0.08, meow: 0.3, spark: 0.25, hurt: 0.12 };
for (const [type, secs] of Object.entries(ptimes)) {
  for (const t of type === 'spark' || type === 'sparkle' || type === 'heart' ? [0, 1] : [0]) {
    await ev(([type, secs, t]) => {
      fx.clear(); fx.seed(42); fx.setTime(t); fx.view('close');
      fx.burst(type);
      fx.step(1 / 60, Math.round(secs * 60));
    }, [type, secs, t]);
    await shot(`p_${type}${t ? '_dusk' : ''}`);
  }
}
await ev(() => { fx.clear(); fx.seed(5); fx.setTime(0.3); fx.view('particles'); fx.wind(true); fx.step(1 / 60, 90); });
await shot('p_wind_stream');
await ev(() => { fx.clear(); fx.seed(6); fx.setTime(1); fx.view('particles'); fx.fountain(true); fx.step(1 / 60, 90); });
await shot('p_spark_fountain_dusk');
await ev(() => { fx.clear(); fx.seed(7); fx.setTime(0); fx.view('particles');
  for (const t of ['star', 'heart', 'sparkle']) fx.burst(t); fx.step(1 / 60, 15); });
await shot('p_combo_8units');
await ev(() => { fx.clear(); fx.seed(8); fx.setTime(0); fx.view('particles');
  fx.burst('land'); fx.burst('confetti'); fx.step(1 / 60, 12); });
await shot('p_land_confetti_8units');
await ev(() => { fx.clear(); fx.seed(9); fx.setTime(1); fx.view('particles');
  fx.burst('meow'); fx.burst('heart'); fx.step(1 / 60, 18); });
await shot('p_meow_heart_8units_dusk');

// --- fireworks (dusk) ---
for (const style of ['peony', 'ring', 'willow', 'heart', 'paw']) {
  for (const [label, secs] of [['a', 0.7], ['b', 1.7]]) {
    await ev(([style, secs]) => {
      fx.clear(); fx.seed(11); fx.setTime(1); fx.view('fireworks');
      fx.firework(style, style === 'peony' ? { color: [0xff3d6e, 0xffd23f] } : {});
      fx.step(1 / 60, Math.round(secs * 60));
    }, [style, secs]);
    await shot(`fw_${style}_${label}`);
  }
}
await ev(() => { fx.clear(); fx.seed(12); fx.setTime(1); fx.view('fireworks'); fx.firework('peony', { rocket: true });
  fx.step(1 / 60, 85); });
await shot('fw_rocket');
await ev(() => { fx.clear(); fx.seed(13); fx.setTime(0.5); fx.view('fireworks'); fx.firework('ring');
  fx.step(1 / 60, 45); });
await shot('fw_ring_sunset');
await ev(() => { fx.clear(); fx.seed(14); fx.setTime(1); fx.view('fireworks'); fx.show(true); fx.step(1 / 60, 60 * 8); });
await shot('fw_show_a');
await ev(() => { fx.step(1 / 60, 50); });
await shot('fw_show_b');
const showStats = await ev(() => fx.stats());
await ev(() => { fx.setCam(200, 25, 112, 14); fx.step(1 / 60, 70); });
await shot('fw_show_c');

// --- performance with the show + streams running (real time) ---
let perf = null;
if (!only) {
  await ev(() => { fx.clear(); fx.seed(); fx.setTime(1); fx.view('fireworks'); fx.show(true); fx.fountain(true); fx.wind(true);
    fx.step(1 / 60, 300); });
  perf = await page.evaluate(() => fx.bench(5));
  perf.gpuBoundMsPerFrame = await page.evaluate(() => fx.gpuBench(120));
  perf.stats = await ev(() => fx.stats());
  // particles-only stress: 4000 slots full
  perf.gpuBoundParticlesFull = await page.evaluate(() => {
    fx.clear(); fx.view('particles');
    for (let k = 0; k < 120; k++) fx.burst('confetti');
    fx.step(1 / 60, 2);
    return { ms: fx.gpuBench(60), live: fx.particles.live };
  });
}

const pageErrors = await ev(() => fx.errors);
console.log(JSON.stringify({ showStats, perf, errors: [...errors, ...pageErrors] }, null, 2));
await browser.close();
