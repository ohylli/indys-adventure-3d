// UI check: opens the UI sandbox (tools/ui.html) at several viewport sizes, drives every screen, saves screenshots to
// tests/out/ui/ and runs functional checks (keyboard menu navigation, events, settings persistence, touch controls,
// layout bounds/overlaps, console errors).
//
//   npx vite --port 5182 --strictPort      (in another terminal)
//   node tests/ui-check.mjs [--shots-only] [--only=portrait,landscape,720p,1080p]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.UI_URL || 'http://127.0.0.1:5182/tools/ui.html';
const OUT = 'tests/out/ui';
mkdirSync(OUT, { recursive: true });
const argOnly = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const shotsOnly = process.argv.includes('--shots-only');

const SIZES = [
  { name: 'portrait', width: 390, height: 844, touch: true },
  { name: 'landscape', width: 844, height: 390, touch: true },
  { name: '720p', width: 1280, height: 720 },
  { name: '1080p', width: 1920, height: 1080 },
];

let failures = 0;
let passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FAIL ${msg}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A human-length key tap. input.js samples held keys once per frame, so an instant down+up can fall between polls.
async function tap(page, key) { await page.keyboard.down(key); await sleep(110); await page.keyboard.up(key); await sleep(40); }

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function open(size, query = '') {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    hasTouch: !!size.touch,
    isMobile: !!size.touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?clean${query}`);
  await page.waitForFunction(() => window.sandbox && document.fonts.status === 'loaded');
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

/** Elements of the active screen / HUD must stay inside the viewport, and listed pairs must not overlap. */
async function layoutCheck(page, label, selectors, pairs = []) {
  const res = await page.evaluate(({ selectors, pairs }) => {
    const W = innerWidth, H = innerHeight;
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      let e = el;
      while (e) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null; e = e.parentElement; }
      return r;
    };
    const out = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const r = vis(el);
        if (!r) continue;
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${sel} out of view [${r.left | 0},${r.top | 0},${r.right | 0},${r.bottom | 0}]`);
      }
    }
    for (const [a, b] of pairs) {
      const ea = document.querySelector(a), eb = document.querySelector(b);
      if (!ea || !eb) continue;
      const ra = vis(ea), rb = vis(eb);
      if (!ra || !rb) continue;
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 2 && oy > 2) out.push(`${a} overlaps ${b} (${ox | 0}x${oy | 0})`);
    }
    return out;
  }, { selectors, pairs });
  check(res.length === 0, `${label}: layout ${res.length ? res.join('; ') : 'inside viewport, no overlaps'}`);
}

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

// ---------------------------------------------------------------------------------------------------------------
for (const size of SIZES) {
  if (argOnly.length && !argOnly.includes(size.name)) continue;
  console.log(`\n== ${size.name} ${size.width}x${size.height}${size.touch ? ' touch' : ''}`);
  const { context, page, errors } = await open(size);
  const S = size.name;
  if (size.touch) await page.evaluate(() => window.sandbox.ui.setDevice('touch'));

  // loading
  await page.evaluate(() => window.sandbox.ui.show('loading', { progress: 0.6 }));
  await sleep(900);
  await shoot(page, `${S}-loading`);

  // title (sunset and bright day)
  await page.evaluate(() => window.sandbox.ui.show('title'));
  await sleep(1400);
  await shoot(page, `${S}-title`);
  await layoutCheck(page, `${S} title`, ['.scr-title .btn', '.scr-title .logo', '.scr-title .legend', '.scr-title .credit'],
    [['.scr-title .title-logo', '.scr-title .title-left'], ['.scr-title .title-logo', '.scr-title .legend'], ['.scr-title .title-left', '.scr-title .title-right']]);
  await page.evaluate(() => { document.body.dataset.bg = 'day'; });
  await sleep(150);
  await shoot(page, `${S}-title-day`);
  await page.evaluate(() => { document.body.dataset.bg = 'sunset'; });

  // play: HUD + banner + hint
  await page.evaluate(() => {
    const { ui, state } = window.sandbox;
    Object.assign(state, { hearts: 2, maxHearts: 3, treats: 12, treatsTotal: 40, altitude: 62, charm: true });
    ui.show('play');
    ui.banner('The Wave Swinger', '62 m');
    ui.hint('Use {move} to walk and {jump} to jump');
  });
  await sleep(1100);
  await shoot(page, `${S}-play`);
  const playPairs = [['.hud-tl', '.hud-alt'], ['.banner', '.hud-tl'], ['.banner', '.alt-read'], ['.banner', '.gauge'], ['.hint', '.gauge'], ['.hint', '.t-jump'], ['.hint', '.t-meow'], ['.hud-alt', '.t-jump'], ['.hud-alt', '.t-meow'], ['.hud-alt', '.t-pause'], ['.hud-tl', '.t-pause']];
  await layoutCheck(page, `${S} play`, ['.hud-tl', '.hud-alt', '.alt-read', '.gauge', '.gauge-cat', '.banner', '.hint-box', '.t-jump', '.t-meow', '.t-pause'], playPairs);
  await page.evaluate(() => { document.body.dataset.bg = 'day'; window.sandbox.state.altitude = 140; window.sandbox.ui.toast('Checkpoint!'); window.sandbox.ui.hint('Press {meow} to meow: gulls fly off and visitors go "aww". {pause} pauses.'); });
  await sleep(500);
  await shoot(page, `${S}-play-day`);
  await layoutCheck(page, `${S} play day`, ['.toast', '.hint-box'], [['.toast', '.hud-alt'], ['.toast', '.banner'], ['.hint', '.t-jump'], ['.hint', '.t-meow']]);
  await page.evaluate(() => { document.body.dataset.bg = 'night'; window.sandbox.state.altitude = 8; window.sandbox.state.hearts = 1; });
  await sleep(300);
  await shoot(page, `${S}-play-night`);
  await page.evaluate(() => { document.body.dataset.bg = 'sunset'; });

  // pause
  await page.evaluate(() => { window.sandbox.state.hearts = 3; window.sandbox.state.timeSec = 192; window.sandbox.ui.show('pause'); });
  await sleep(700);
  await shoot(page, `${S}-pause`);
  await layoutCheck(page, `${S} pause`, ['.pause-panel', '.scr-pause .btn', '.scr-pause .tag'], []);

  // claim
  await page.evaluate(() => { window.sandbox.ui.hint(null); window.sandbox.ui.show('claim', { text: 'Näsinneula claimed!' }); });
  await sleep(1100);
  await shoot(page, `${S}-claim`);

  // results
  for (const rank of ['S', 'B']) {
    await page.evaluate((rank) => {
      const d = rank === 'S' ? { treats: 40, treatsTotal: 40, timeSec: 463, naps: 0, charm: true, rank: 'S' } : { treats: 22, treatsTotal: 40, timeSec: 1324, naps: 3, charm: false, rank: 'B' };
      window.sandbox.ui.show('none');
      window.sandbox.ui.show('results', d);
    }, rank);
    await sleep(2800);
    await shoot(page, `${S}-results-${rank}`);
  }
  await layoutCheck(page, `${S} results`, ['.res-title .logo', '.res-card', '.rank', '.res-btns .btn'],
    [['.res-title', '.res-main'], ['.res-main', '.res-btns'], ['.res-card', '.rank']]);

  // hint glyphs per device
  await page.evaluate(() => { window.sandbox.ui.show('play'); });
  for (const dev of ['keyboard', 'gamepad', 'touch']) {
    await page.evaluate((dev) => { window.sandbox.ui.setDevice(dev); window.sandbox.ui.hint('Hold {jump} to jump higher, {meow} to meow, {move} to move, {pause} to pause'); }, dev);
    await sleep(450);
    if (size.name === '720p' || size.name === 'portrait') await shoot(page, `${S}-hint-${dev}`);
  }
  if (size.touch) await page.evaluate(() => window.sandbox.ui.setDevice('touch'));

  check(errors.length === 0, `${S}: no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------
if (!shotsOnly) {
  console.log('\n== keyboard menus, events, settings');
  {
    const { context, page, errors } = await open({ width: 1280, height: 720 }, '');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.sandbox);
    await sleep(400);
    const focusedAct = () => page.evaluate(() => { const f = document.querySelector('#ui .is-focus'); return f ? (f.dataset.act || f.dataset.toggle) : null; });
    check(await focusedAct() === 'start', 'title: Start focused by default');
    await tap(page, 'ArrowRight'); await sleep(80);
    check(await focusedAct() === 'retro', 'title: Right moves focus to Retro mode');
    await tap(page, 'ArrowRight'); await sleep(80);
    check(await focusedAct() === 'sound', 'title: Right again moves to Sound');
    await tap(page, 'ArrowRight'); await sleep(80);
    check(await focusedAct() === 'start', 'title: Right wraps back to Start');
    await tap(page, 'ArrowLeft'); await sleep(80);
    check(await focusedAct() === 'sound', 'title: Left wraps to Sound');
    await tap(page, 'Enter'); await sleep(80);
    check(await page.evaluate(() => window.sandbox.settings.get('muted')) === true, 'title: Enter on Sound mutes (settings.muted = true)');
    check(await page.evaluate(() => document.querySelector('.scr-title [data-toggle="sound"]').classList.contains('is-checked')) === false, 'title: Sound switch shows OFF');
    await tap(page, 'ArrowLeft'); await sleep(80);
    await tap(page, 'Space'); await sleep(80);
    check(await page.evaluate(() => window.sandbox.settings.get('retro')) === true, 'title: Space on Retro mode turns retro on');
    await page.reload();
    await page.waitForFunction(() => window.sandbox);
    await sleep(300);
    const persisted = await page.evaluate(() => ({ retro: window.sandbox.settings.get('retro'), muted: window.sandbox.settings.get('muted'),
      retroUi: document.querySelector('.scr-title [data-toggle="retro"]').classList.contains('is-checked'),
      soundUi: document.querySelector('.scr-title [data-toggle="sound"]').classList.contains('is-checked') }));
    check(persisted.retro === true && persisted.muted === true && persisted.retroUi && !persisted.soundUi, 'settings persist across reload and the toggles show them');
    await tap(page, 'KeyM'); await sleep(100);
    check(await page.evaluate(() => window.sandbox.settings.get('muted')) === false, 'M key toggles sound (unmuted)');
    await tap(page, 'KeyR'); await sleep(100);
    check(await page.evaluate(() => window.sandbox.settings.get('retro')) === false, 'R key toggles retro mode (off)');
    check(await page.evaluate(() => document.querySelectorAll('#ui .toast').length) >= 1, 'M/R keys show a toast');

    await tap(page, 'Enter'); await sleep(700);
    check(await page.evaluate(() => window.sandbox.events.includes('start')), "title: Enter on Start emits 'start'");
    check(await page.evaluate(() => window.sandbox.ui.screen) === 'play', 'sandbox switched to play');
    const startCount = await page.evaluate(() => window.sandbox.events.filter((e) => e === 'start').length);
    check(startCount === 1, `'start' fired once (${startCount})`);

    await tap(page, 'Escape'); await sleep(250);
    check(await page.evaluate(() => window.sandbox.ui.screen) === 'pause', 'Esc in play opens pause (and does not immediately resume)');
    check(await focusedAct() === 'resume', 'pause: Resume focused');
    await tap(page, 'ArrowDown'); await sleep(80);
    check(await focusedAct() === 'restart', 'pause: Down -> Restart');
    await tap(page, 'ArrowDown'); await tap(page, 'ArrowDown'); await tap(page, 'ArrowDown'); await sleep(80);
    check(await focusedAct() === 'quit', 'pause: Down x3 more -> Quit to title');
    await tap(page, 'ArrowDown'); await sleep(80);
    check(await focusedAct() === 'resume', 'pause: Down wraps to Resume');
    await tap(page, 'ArrowUp'); await sleep(80);
    check(await focusedAct() === 'quit', 'pause: Up wraps to Quit');
    await tap(page, 'ArrowUp'); await sleep(80);
    await tap(page, 'Enter'); await sleep(80);
    check(await page.evaluate(() => window.sandbox.settings.get('muted')) === true, 'pause: Enter on Sound toggles sound');
    await tap(page, 'Escape'); await sleep(200);
    const afterEsc = await page.evaluate(() => [window.sandbox.events.join(','), window.sandbox.ui.screen]);
    check(afterEsc[0].endsWith('resume') && afterEsc[1] === 'play', `pause: Esc emits 'resume' (${afterEsc})`);

    await tap(page, 'Escape'); await sleep(250);
    await tap(page, 'ArrowDown'); await sleep(60);
    await tap(page, 'Enter'); await sleep(600);
    check(await page.evaluate(() => window.sandbox.events.at(-1)) === 'restart', "pause: Restart emits 'restart'");

    await tap(page, 'Escape'); await sleep(250);
    await tap(page, 'ArrowUp'); await sleep(60);
    await tap(page, 'Enter'); await sleep(600);
    check(await page.evaluate(() => window.sandbox.events.at(-1)) === 'quit' && await page.evaluate(() => window.sandbox.ui.screen) === 'title', "pause: Quit to title emits 'quit'");

    // mouse click on a menu button
    await page.evaluate(() => window.sandbox.ui.show('pause'));
    await sleep(400);
    const rb = await page.evaluate(() => { const r = document.querySelector('.scr-pause [data-act="resume"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.move(rb[0], rb[1]); await sleep(60);
    await page.mouse.click(rb[0], rb[1]);
    await sleep(100);
    check(await page.evaluate(() => window.sandbox.events.at(-1)) === 'resume', "pause: mouse click on Resume emits 'resume'");

    // results: input lock, then keyboard
    await page.evaluate(() => window.sandbox.ui.show('results', { treats: 30, treatsTotal: 40, timeSec: 500, naps: 1, charm: false, rank: 'A' }));
    await sleep(200);
    await tap(page, 'Enter'); await sleep(80);
    check(await page.evaluate(() => window.sandbox.events.at(-1)) === 'resume', 'results: input locked right after showing (no accidental skip)');
    await sleep(1500);
    check(await focusedAct() === 'restart', 'results: Play again focused');
    await tap(page, 'ArrowRight'); await sleep(80);
    check(await focusedAct() === 'quit', 'results: Right -> Title');
    await tap(page, 'Enter'); await sleep(600);
    check(await page.evaluate(() => window.sandbox.events.at(-1)) === 'quit', "results: Title emits 'quit'");
    check(await page.evaluate(() => document.querySelectorAll('#ui button').length === [...document.querySelectorAll('#ui [data-nav]')].filter((b) => b.tagName === 'BUTTON').length + 3), 'menu entries are real <button> elements');

    // fade promise + flash
    const fadeMs = await page.evaluate(async () => { const t = performance.now(); await window.sandbox.ui.fade(true, 0.3); const d = performance.now() - t; await window.sandbox.ui.fade(false, 0); return d; });
    check(fadeMs >= 280 && fadeMs < 600, `fade(true, .3) resolves after ~300 ms (${fadeMs | 0})`);
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await context.close();
  }

  console.log('\n== touch controls (landscape touch, CDP multi-touch)');
  {
    const { context, page, errors } = await open({ width: 844, height: 390, touch: true }, '&screen=play');
    const cdp = await context.newCDPSession(page);
    const touchEv = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
    const read = () => page.evaluate(() => { const i = window.sandbox.input; i.poll(); return { mx: i.moveX, my: i.moveY, jump: i.jump, meow: i.meow, dev: i.lastDevice }; });
    const center = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);

    await touchEv('touchStart', [[150, 250, 1]]);
    await sleep(50);
    check(await page.evaluate(() => document.querySelector('#ui').classList.contains('touch-on')), 'touchstart shows the touch controls');
    let s = await read();
    check(s.mx === 0 && s.my === 0, `stick at rest = 0,0 (${s.mx}, ${s.my})`);
    await touchEv('touchMove', [[154, 251, 1]]);
    s = await read();
    check(s.mx === 0 && s.my === 0, 'small thumb wobble stays inside the dead zone');
    await touchEv('touchMove', [[230, 250, 1]]);
    await sleep(30);
    s = await read();
    check(s.mx > 0.8 && Math.abs(s.my) < 0.05, `stick right -> moveX ${s.mx.toFixed(2)}, moveY ${s.my.toFixed(2)}`);
    check(s.dev === 'touch', 'input.lastDevice becomes touch');
    const bc = await center('.t-stick-base');
    await touchEv('touchMove', [[bc[0], bc[1] - 80, 1]]);
    s = await read();
    check(s.my > 0.8 && Math.abs(s.mx) < 0.1, `stick up -> moveY ${s.my.toFixed(2)} (up = +1)`);
    await touchEv('touchMove', [[100, 300, 1]]);
    s = await read();
    check(s.mx < -0.5 && s.my < -0.5 && Math.hypot(s.mx, s.my) <= 1.0001, `stick down-left diagonal -> ${s.mx.toFixed(2)}, ${s.my.toFixed(2)}`);

    const j = await center('.t-jump');
    await touchEv('touchStart', [[100, 300, 1], [j[0], j[1], 2]]);
    s = await read();
    check(s.jump === true && s.mx < -0.5, 'JUMP held while the stick is held (multi-touch)');
    await page.screenshot({ path: `${OUT}/landscape-touch-active.png` });
    const m = await center('.t-meow');
    await touchEv('touchStart', [[100, 300, 1], [j[0], j[1], 2], [m[0], m[1], 3]]);
    s = await read();
    check(s.jump && s.meow && s.mx < -0.5, 'stick + JUMP + MEOW together');
    // CDP touchEnd lists the points that lift
    await touchEv('touchEnd', [[j[0], j[1], 2]]);
    s = await read();
    check(!s.jump && s.meow && s.mx < -0.5, 'releasing JUMP keeps MEOW and stick (tracked by identifier)');
    await touchEv('touchEnd', [[100, 300, 1]]);
    s = await read();
    check(s.mx === 0 && s.my === 0 && s.meow, 'releasing the stick zeroes movement, MEOW still held');
    await touchEv('touchEnd', []);
    s = await read();
    check(!s.jump && !s.meow && s.mx === 0, 'all released');

    const p = await center('.t-pause');
    await touchEv('touchStart', [[p[0], p[1], 5]]);
    await touchEv('touchEnd', []);
    await sleep(200);
    check(await page.evaluate(() => window.sandbox.ui.screen) === 'pause', 'pause button -> input.virtualPress("pause") -> game opened pause');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('#ui .l-touch')).display) === 'none', 'touch controls hidden on the pause screen');
    // tap Resume
    await sleep(300);
    const r = await center('.scr-pause [data-act="resume"]');
    await page.touchscreen.tap(r[0], r[1]);
    await sleep(200);
    check(await page.evaluate(() => window.sandbox.ui.screen) === 'play', 'tapping Resume resumes');
    // scrolling / zoom prevention
    const ta = await page.evaluate(() => [getComputedStyle(document.querySelector('.t-zone')).touchAction, getComputedStyle(document.querySelector('.t-jump')).touchAction, getComputedStyle(document.querySelector('#ui')).userSelect]);
    check(ta[0] === 'none' && ta[1] === 'none' && ta[2] === 'none', `touch-action none on stick and buttons, user-select none (${ta.join(', ')})`);
    // a key press switches back to keyboard glyphs and hides touch controls
    await tap(page, 'ArrowLeft');
    await sleep(100);
    check(await page.evaluate(() => !document.querySelector('#ui').classList.contains('touch-on')), 'keyboard input hides the touch controls');
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await context.close();
  }

  console.log('\n== reduced motion');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}?clean`);
    await page.waitForFunction(() => window.sandbox);
    await page.evaluate(() => window.sandbox.ui.show('results', { treats: 12, treatsTotal: 40, timeSec: 90, naps: 5, charm: false, rank: 'C' }));
    await sleep(300);
    const r = await page.evaluate(() => ({ rank: document.querySelector('.rank').classList.contains('stamp'), conf: getComputedStyle(document.querySelector('.confetti')).display }));
    check(r.rank && r.conf === 'none', 'reduced motion: results appear at once, no confetti');
    await page.screenshot({ path: `${OUT}/720p-results-reduced-motion.png` });
    check(errors.length === 0, 'no page errors');
    await context.close();
  }
}

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
