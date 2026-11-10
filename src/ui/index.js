// HTML/CSS overlay UI for Indy's Adventure 3D: HUD, screens and touch controls, drawn over the WebGL canvas.
// This file is the public API the game calls. Keep these names and signatures.
//
//   import { ui } from './ui/index.js';
//
//   ui.init(root)                  root = the #ui element (position: fixed, covers the viewport, pointer-events none
//                                  except on interactive children). Builds the DOM, loads fonts/CSS, sets up touch
//                                  controls (shown only when a touch device is in use) and menu navigation.
//                                  ui.css styles #ui itself; if root is omitted, #ui is looked up or created.
//   ui.on(event, fn)               Events the game listens to (returns an unsubscribe function):
//                                    'start'    title: Start pressed
//                                    'resume'   pause: Resume (also Esc / P / gamepad Start or B / touch pause
//                                               while the pause screen is up: the UI handles those itself)
//                                    'restart'  pause/results: restart the stage from the plaza
//                                    'quit'     pause/results: back to the title screen
//                                  After one of these fires, menu input is ignored until the game calls ui.show().
//                                  Retro mode and sound toggles are handled by the UI itself through
//                                  src/core/settings.js (settings.set('retro', …), settings.set('muted', …)),
//                                  from the menus and from the M / R keys (input.pressed('mute'|'retro')) on any
//                                  screen, with a toast. The game applies them by listening to settings.on().
//   ui.show(screen, data?)         'loading' | 'title' | 'play' | 'pause' | 'claim' | 'results' | 'none'
//                                    loading: data = { progress: 0..1 }; call again to update the bar
//                                    title:   logo "Indy's Adventure 3D" + subtitle "Näsinneula", Start,
//                                             Retro mode on/off, Sound on/off, a controls panel
//                                             (the 3D scene keeps rendering behind it, so keep it airy)
//                                    play:    HUD only
//                                    pause:   Resume, Restart, Retro mode, Sound, Quit to title + controls reminder
//                                             (also shows altitude / treats / time from the last ui.update)
//                                    claim:   hides the HUD (cinematic letterbox); shows data.text as a big caption
//                                             if given (call again with new text to change it)
//                                    results: data = { treats, treatsTotal, timeSec, naps, charm (bool), rank ('S'|'A'|'B'|'C') }
//                                             with Play again ('restart') / Title ('quit') buttons
//   ui.screen                      current screen name
//   ui.update(state)               every frame while playing; cheap (diff before touching the DOM):
//                                    { hearts, maxHearts, treats, treatsTotal, altitude (metres, number),
//                                      altitudeMax (168), charm (bool), timeSec }
//                                  HUD: hearts, fish treat counter, an altitude meter (a little tower gauge with a
//                                  cat marker plus "42 m"), charm icon when found.
//   ui.banner(title, subtitle?)    Section title card that slides in and out, e.g. ('The Wave Swinger', '62 m').
//   ui.toast(text, ms = 2500)      Small transient message ("Checkpoint!", "Nine Lives charm!").
//   ui.hint(text | null)           Tutorial hint bubble that stays until replaced or cleared. Text may contain
//                                  {move} {jump} {meow} {pause}: replace them with input.glyph(action) styled as keycaps,
//                                  and re-render when input.onDevice fires. Only visible on the play screen.
//   ui.fade(opaque, seconds)       Fade a full-screen cover in (true) or out (false). Returns a Promise.
//   ui.flash(color, seconds)       Quick full-screen flash (hurt = red tint, firework = white).
//
// Menus must work with keyboard and gamepad (input.pressed('up'|'down'|'left'|'right'|'confirm'|'back'|'pause'),
// polled by the game calling ui.tick() once per frame after input.poll()), mouse and touch.
//   ui.tick()                      once per frame: menu navigation from input, button repeat, etc.
//                                  Call it AFTER the game's own input handling for the frame. Menu input is ignored
//                                  on the frame a screen is shown, so a pause key that opened the pause screen
//                                  does not also close it. 'jump' also confirms in menus.
//
// Touch controls (src/ui/touch.js): a virtual stick on the left, JUMP and MEOW buttons on the right, a pause button
// at the top. They write to input.setVirtual({ moveX, moveY, jump, meow }) and input.virtualPress('pause').
// They are shown on the play screen while the touch device is in use (input.lastDevice === 'touch', or after any
// touchstart; hidden again on keyboard / gamepad input).
//
// Extras: ui.device ('keyboard' | 'gamepad' | 'touch', the device the UI is currently showing glyphs for),
// ui.setDevice(d) (force it; sandbox/tests), ui.touch.state (virtual stick/button state, read-only, for tests),
// ui.emit(event) (used internally).

import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/lilita-one/latin-400.css';
import './ui.css';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { audio } from '../audio/index.js';
import { ICONS, ROSETTE, GAUGE_TOWER, DEFS } from './icons.js';
import { createTouch } from './touch.js';

// Glyph labels for a device the input module is not currently reporting (mirrors src/core/input.js GLYPHS).
// Needed because the UI switches to touch glyphs on the first touchstart, before input.lastDevice changes.
const FALLBACK_GLYPHS = {
  keyboard: { move: 'WASD / Arrows', jump: 'Space', meow: 'X', pause: 'Esc', confirm: 'Enter', back: 'Esc', mute: 'M', retro: 'R' },
  gamepad: { move: 'Left stick', jump: 'A', meow: 'X', pause: 'Start', confirm: 'A', back: 'B', mute: 'M', retro: 'R' },
  touch: { move: 'the stick', jump: 'JUMP', meow: 'MEOW', pause: 'II', confirm: 'tap', back: 'back', mute: 'M', retro: 'R' },
};

const RANK_CAPTION = { S: 'Top cat!', A: 'Purr-fect climb!', B: 'Great climbing!', C: 'Tower claimed!' };
const MENU_SCREENS = new Set(['title', 'pause', 'results']);
const DIRS = ['up', 'down', 'left', 'right'];
const LOGO_ROT = [-5, 3, -2, 4, -3, 2, -4, 3, -2, 4, -3];

const handlers = {};
const reduceMotion = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sfx = (name) => { try { audio.sfx(name); } catch { /* audio not ready */ } };
const fmtTime = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function letters(str, start, rotOffset = 0) {
  return [...str].map((c, i) => {
    const n = start + i;
    const r = LOGO_ROT[(n + rotOffset) % LOGO_ROT.length];
    return `<span class="ch" style="--i:${n}"><span class="ch-b" style="--r:${r}deg"><span class="ch-s" aria-hidden="true">${esc(c)}</span><span class="ch-f">${esc(c)}</span></span></span>`;
  }).join('');
}

function logoHTML() {
  return `<div class="logo" role="img" aria-label="Indy's Adventure 3D: Näsinneula">
    <div class="logo-line logo-l1" aria-hidden="true">${letters('INDY', 0)}<span class="logo-needle">${ICONS.needle}</span>${letters('S', 4)}</div>
    <div class="logo-line logo-l2" aria-hidden="true">${letters('ADVENTURE', 5)}<span class="logo-3d">3D</span></div>
    <div class="logo-ribbon" aria-hidden="true"><span class="rb-tail l">${ICONS.tail}</span><span class="rb-mid">NÄSINNEULA</span><span class="rb-tail r">${ICONS.tail}</span></div>
  </div>`;
}

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ------------------------------------------------------------------------------------------------------------
let root = null;
let $ = {};                   // element refs
let touch = null;
let device = 'keyboard';
let frame = 0;
let shownFrame = -1;
let lockUntil = 0;
let leaving = false;          // an event that leaves the screen fired; wait for the next ui.show()
let focused = null;
const repeat = { dir: null, next: 0 };
const hud = { hearts: -1, maxHearts: -1, treats: -1, treatsTotal: -1, alt: -1, p: -1, charm: null };
let lastState = {};
let hintText = null;
let bannerTimers = [];
let resultsTimers = [];
let resultsRaf = 0;
let fadeTimer = 0;
let fadeResolvers = [];

function glyph(action) {
  if (device === input.lastDevice) return input.glyph(action);
  return (FALLBACK_GLYPHS[device] || FALLBACK_GLYPHS.keyboard)[action] || action;
}

/** Glyph for an action as keycap / button markup for the device in use. */
function glyphHTML(action) {
  const g = glyph(action);
  if (device === 'gamepad') {
    if (/stick/i.test(g)) return `<span class="g"><span class="gp-stick">${ICONS.stick}</span></span>`;
    if (/^[ABXY]$/.test(g)) return `<span class="g"><span class="gp gp-${g}">${g}</span></span>`;
    return `<span class="g"><span class="gp gp-pill">${esc(g)}</span></span>`;
  }
  if (device === 'touch') {
    if (g === 'JUMP') return '<span class="g"><span class="tb tb-jump">JUMP</span></span>';
    if (g === 'MEOW') return '<span class="g"><span class="tb tb-meow">MEOW</span></span>';
    if (g === 'II') return `<span class="g"><span class="tb tb-pause">${ICONS.pause}</span></span>`;
    if (/stick/.test(g)) return `the stick <span class="g"><span class="t-stick">${ICONS.stick}</span></span>`;
    return `<span class="g"><span class="tb tb-meow">${esc(g)}</span></span>`;
  }
  const parts = g.split(/\s*\/\s*/);
  return `<span class="g">${parts.map((p) => (p === 'Arrows'
    ? `<span class="kc">${ICONS.arrows}</span>`
    : `<span class="kc${p.length > 3 ? ' kc-wide' : ''}">${esc(p)}</span>`)).join('<span class="g-sep">/</span>')}</span>`;
}

function richText(text) {
  return esc(text).replace(/\{(\w+)\}/g, (_, a) => glyphHTML(a));
}

function legendRows() {
  if (device === 'touch') {
    return [
      ['Move', `<span class="g"><span class="t-stick">${ICONS.stick}</span></span> <small>left side</small>`],
      ['Jump', glyphHTML('jump')],
      ['Meow', glyphHTML('meow')],
      ['Pause', glyphHTML('pause')],
    ];
  }
  const rows = [['Move', glyphHTML('move')], ['Jump', glyphHTML('jump')], ['Meow', glyphHTML('meow')], ['Pause', glyphHTML('pause')]];
  if (device === 'keyboard') rows.push(['Sound / Retro', `${glyphHTML('mute')}${glyphHTML('retro')}`]);
  return rows;
}

function renderDevice() {
  const rows = legendRows().map(([a, g]) => `<span class="lg-a">${a}</span><span class="lg-g">${g}</span>`).join('');
  for (const el of root.querySelectorAll('.legend-rows')) el.innerHTML = rows;
  const strip = legendRows().slice(0, 3);
  if (device === 'touch') strip[0][1] = `<span class="g"><span class="t-stick">${ICONS.stick}</span></span>`;
  $.strip.innerHTML = strip.map(([a, g]) => `<span class="ls">${g} ${a}</span>`).join('');
  let prompt;
  if (device === 'touch') prompt = '<span class="ol ol-thin">Tap START to climb!</span>';
  else prompt = `<span class="ol ol-thin">Press</span>${glyphHTML('confirm')}<span class="ol ol-thin">to start</span>`;
  $.prompt.innerHTML = prompt;
  if (hintText != null) $.hintTxt.innerHTML = richText(hintText);
  root.classList.toggle('touch-on', device === 'touch');
  root.dataset.device = device;
  updateTouchEnabled();
}

function setDevice(d) {
  if (!d || d === device) return;
  device = d;
  if (root) renderDevice();
}

function updateTouchEnabled() {
  if (touch) touch.setEnabled(device === 'touch' && ui.screen === 'play');
}

// ---- settings toggles --------------------------------------------------------------------------------------
function syncToggles() {
  const retro = !!settings.get('retro');
  const sound = !settings.get('muted');
  for (const b of root.querySelectorAll('[data-toggle="retro"]')) { b.classList.toggle('is-checked', retro); b.setAttribute('aria-pressed', retro); }
  for (const b of root.querySelectorAll('[data-toggle="sound"]')) {
    b.classList.toggle('is-checked', sound);
    b.setAttribute('aria-pressed', sound);
    const ic = b.querySelector('.ico');
    if (ic && ic.dataset.state !== String(sound)) { ic.outerHTML = sound ? ICONS.soundOn : ICONS.soundOff; b.querySelector('.ico').dataset.state = String(sound); }
  }
  root.classList.toggle('retro-on', retro);
}

function toggleSetting(which, withToast) {
  if (which === 'retro') {
    const v = settings.toggle('retro');
    if (withToast) ui.toast(`Retro mode ${v ? 'on' : 'off'}`, 1600, 'retro');
  } else {
    const muted = settings.toggle('muted');
    if (withToast) ui.toast(muted ? 'Sound off' : 'Sound on', 1600, muted ? 'soundOff' : 'soundOn');
  }
}

// ---- menu focus & navigation -------------------------------------------------------------------------------
function activeScreenEl() { return $.screens[ui.screen] || null; }

function navList() {
  const scr = activeScreenEl();
  if (!scr || !MENU_SCREENS.has(ui.screen)) return [];
  return [...scr.querySelectorAll('[data-nav]')].filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden');
}

function setFocus(btn, withSound) {
  if (!btn || focused === btn) return;
  if (focused) focused.classList.remove('is-focus');
  focused = btn;
  btn.classList.add('is-focus');
  if (document.activeElement !== btn) {
    try { btn.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  if (withSound) sfx('ui_move');
}

function clearFocus() {
  if (focused) focused.classList.remove('is-focus');
  focused = null;
}

function navigate(dir) {
  const list = navList();
  if (!list.length) return;
  if (!focused || !list.includes(focused)) { setFocus(list[0], true); return; }
  const r0 = focused.getBoundingClientRect();
  const x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
  const vertical = dir === 'up' || dir === 'down';
  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  let best = null, bestScore = Infinity;
  let wrap = null, wrapDist = -Infinity;
  for (const b of list) {
    if (b === focused) continue;
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const main = (vertical ? y - y0 : x - x0) * sign;
    const cross = Math.abs(vertical ? x - x0 : y - y0);
    const overlaps = vertical ? r.right > r0.left && r.left < r0.right : r.bottom > r0.top && r.top < r0.bottom;
    if (main > 4) {
      const score = main + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = b; }
    } else if (overlaps && -main > wrapDist) { wrapDist = -main; wrap = b; }
  }
  setFocus(best || wrap, true);
}

function activate(btn) {
  if (!btn || leaving) return;
  try { audio.unlock(); } catch { /* ignore */ }
  btn.classList.add('is-press');
  setTimeout(() => btn.classList.remove('is-press'), 140);
  const tog = btn.dataset.toggle;
  if (tog) { sfx('ui_select'); toggleSetting(tog, false); return; }
  const act = btn.dataset.act;
  if (!act) return;
  sfx(act === 'quit' ? 'ui_back' : 'ui_select');
  leaving = true;
  ui.emit(act);
}

// ---- HUD ---------------------------------------------------------------------------------------------------
function pop(el, scale = 1.3) {
  if (reduceMotion.matches || !el.animate) return;
  el.animate([{ transform: `scale(${scale}) rotate(-4deg)` }, { transform: 'scale(.94)' }, { transform: 'none' }],
    { duration: 380, easing: 'cubic-bezier(.2,1.4,.45,1)' });
}

function renderHearts(n, max) {
  const wrap = $.hearts;
  if (max !== hud.maxHearts) {
    wrap.innerHTML = '';
    for (let i = 0; i < max; i++) wrap.append(h(`<span class="ht">${i < n ? ICONS.heart : ICONS.heartEmpty}</span>`));
    for (let i = 0; i < max; i++) wrap.children[i].dataset.full = i < n ? '1' : '0';
    hud.maxHearts = max;
  } else {
    for (let i = 0; i < max; i++) {
      const el = wrap.children[i];
      const full = i < n;
      if ((el.dataset.full === '1') !== full) {
        el.innerHTML = full ? ICONS.heart : ICONS.heartEmpty;
        el.dataset.full = full ? '1' : '0';
        el.classList.remove('lost', 'gain');
        void el.offsetWidth;
        el.classList.add(full ? 'gain' : 'lost');
      }
    }
  }
  wrap.classList.toggle('low', n === 1 && max > 1);
  wrap.setAttribute('aria-label', `${n} of ${max} hearts`);
  hud.hearts = n;
}

// ---- results -----------------------------------------------------------------------------------------------
function clearResults() {
  for (const t of resultsTimers) clearTimeout(t);
  resultsTimers = [];
  cancelAnimationFrame(resultsRaf);
}

function countUp(el, to, ms, fmt) {
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(to * e));
    if (k < 1) resultsRaf = requestAnimationFrame(step);
  };
  if (reduceMotion.matches || ms <= 0) { el.textContent = fmt(to); return; }
  resultsRaf = requestAnimationFrame(step);
}

function runResults(d = {}) {
  clearResults();
  const treats = d.treats ?? 0, total = d.treatsTotal ?? 0, time = d.timeSec ?? 0, naps = d.naps ?? 0;
  const rank = ['S', 'A', 'B', 'C'].includes(d.rank) ? d.rank : 'B';
  const R = $.res;
  R.treatsV.innerHTML = `<span class="n">0</span>${total ? ` <small>/ ${total}</small>` : ''}`;
  R.treatsV.classList.toggle('perfect', !!total && treats >= total);
  R.timeV.textContent = '00:00';
  R.napsV.textContent = '0';
  R.charmV.className = `rv r ${d.charm ? 'found' : 'miss'}`;
  R.charmV.textContent = d.charm ? 'Found!' : 'Not found';
  R.charmI.style.opacity = d.charm ? '1' : '.35';
  R.charmI.style.filter = d.charm ? '' : 'grayscale(1)';
  R.rank.dataset.rank = rank;
  R.rankL.textContent = rank;
  R.rankCap.textContent = RANK_CAPTION[rank];
  R.rank.classList.remove('stamp');
  for (const el of R.rows) el.classList.remove('show');

  const fast = reduceMotion.matches;
  const at = (ms, fn) => resultsTimers.push(setTimeout(fn, fast ? 0 : ms));
  const showRow = (i) => { for (const el of R.rows) if (el.dataset.row === String(i)) el.classList.add('show'); };
  const nEl = R.treatsV.querySelector('.n');
  at(450, () => { showRow(0); countUp(nEl, treats, 700, String); sfx('ui_move'); });
  at(800, () => { showRow(1); countUp(R.timeV, Math.floor(time), 700, fmtTime); sfx('ui_move'); });
  at(1150, () => { showRow(2); countUp(R.napsV, naps, 350, String); sfx('ui_move'); });
  at(1450, () => { showRow(3); sfx('ui_move'); });
  at(1800, () => { R.rank.classList.add('stamp'); sfx('ui_select'); });
  if (fast) { nEl.textContent = treats; R.timeV.textContent = fmtTime(time); R.napsV.textContent = naps; }
}

function buildConfetti(el) {
  const cols = ['#ef4f43', '#ffcb3d', '#22b8a8', '#ff8c3a', '#fff3d6', '#8b93f0'];
  let html = '';
  for (let i = 0; i < 42; i++) {
    const left = (i * 97) % 100 + ((i * 13) % 7) / 7;
    const dur = 4.5 + ((i * 37) % 30) / 10;
    const delay = -((i * 53) % 70) / 10;
    const dx = (((i * 29) % 21) - 10) * 0.8;
    const rot = 360 + ((i * 71) % 5) * 120;
    const w = i % 3 === 0 ? 'width:.7em;height:.7em;border-radius:50%;' : '';
    html += `<i style="left:${left}%;background:${cols[i % cols.length]};animation-duration:${dur}s;animation-delay:${delay}s;--dx:${dx}vw;--rot:${rot}deg;${w}"></i>`;
  }
  el.innerHTML = html;
}

// ---- build -------------------------------------------------------------------------------------------------
function build() {
  root.innerHTML = '';
  root.append(h(DEFS));

  // HUD
  const hudEl = h(`<div class="layer l-hud hud" aria-hidden="false">
    <div class="hud-tl">
      <div class="hearts" role="img"></div>
      <div class="chip treats" role="img" aria-label="Fish treats">${ICONS.fish}<span class="num">0</span><span class="tot"></span></div>
      <div class="chip charm-chip" role="img" aria-label="Nine Lives charm found">${ICONS.charm}<span>Nine Lives</span></div>
    </div>
    <div class="hud-alt">
      <div class="alt-read display ol"><span class="v">0</span><span class="u">m</span></div>
      <div class="gauge-wrap"><div class="gauge">${GAUGE_TOWER}<div class="gauge-cat">${ICONS.catHead}</div></div></div>
    </div>
  </div>`);
  $.hud = hudEl;
  $.hearts = hudEl.querySelector('.hearts');
  $.treats = hudEl.querySelector('.treats');
  $.treatNum = hudEl.querySelector('.treats .num');
  $.treatTot = hudEl.querySelector('.treats .tot');
  $.charm = hudEl.querySelector('.charm-chip');
  $.altV = hudEl.querySelector('.alt-read .v');
  $.alt = hudEl.querySelector('.alt-read');
  $.gauge = hudEl.querySelector('.gauge');
  $.gaugeFill = hudEl.querySelector('.gauge-fill');

  const touchLayer = h('<div class="layer l-touch"></div>');

  const hintEl = h(`<div class="layer l-hint"><div class="hint" role="status" aria-live="polite"><div class="hint-box"><span class="hint-av">${ICONS.catSmall}</span><span class="hint-txt"></span></div></div></div>`);
  $.hint = hintEl.querySelector('.hint');
  $.hintTxt = hintEl.querySelector('.hint-txt');

  const bannerEl = h(`<div class="layer l-banner"><div class="banner" role="status" aria-live="polite">
    <div class="bn-card"><span class="bn-tail l">${ICONS.tail}</span><div class="bn-mid display"><span class="ol bn-t"></span></div><span class="bn-tail r">${ICONS.tail}</span></div>
    <div class="bn-sub"></div></div></div>`);
  $.banner = bannerEl.querySelector('.banner');
  $.bnT = bannerEl.querySelector('.bn-t');
  $.bnSub = bannerEl.querySelector('.bn-sub');

  // screens
  const screens = h('<div class="layer l-screens"></div>');
  const loading = h(`<section class="scr scr-loading" aria-label="Loading">
    ${logoHTML()}
    <div class="paws">${Array.from({ length: 10 }, () => `<span class="pw">${ICONS.paw}</span>`).join('')}</div>
    <div class="load-txt" role="progressbar" aria-valuemin="0" aria-valuemax="100">Loading<b>0%</b></div>
  </section>`);
  const toggleBtn = (key, icon, label) =>
    `<button class="btn btn-toggle" type="button" data-nav data-toggle="${key}" aria-pressed="false">${icon}<span>${label}</span><span class="sw" aria-hidden="true"></span></button>`;
  const title = h(`<section class="scr scr-title" aria-label="Title">
    <div class="title-logo">${logoHTML()}</div>
    <div class="title-bottom">
      <div class="title-left">
        <div class="title-prompt"></div>
        <div class="title-menu">
          <button class="btn btn-primary" type="button" data-nav data-act="start">${ICONS.play}<span class="lbl">START</span></button>
          <div class="toggles">${toggleBtn('retro', ICONS.retro, 'Retro mode')}${toggleBtn('sound', ICONS.soundOn, 'Sound')}</div>
        </div>
        <div class="legend-strip"></div>
      </div>
      <div class="title-right">
        <div class="panel legend"><h3>Controls</h3><div class="legend-rows"></div></div>
        <div class="credit">${ICONS.paw}<span>A sequel to <i>Indy's Adventure</i></span></div>
      </div>
    </div>
  </section>`);
  const pause = h(`<section class="scr scr-pause" aria-label="Paused">
    <div class="panel pause-panel">
      <div class="tag display"><span class="ol">Paused</span></div>
      <div class="menu-v">
        <button class="btn btn-primary" type="button" data-nav data-act="resume">${ICONS.play}<span class="lbl">Resume</span></button>
        <button class="btn" type="button" data-nav data-act="restart">${ICONS.restart}<span>Restart climb</span></button>
        ${toggleBtn('retro', ICONS.retro, 'Retro mode')}
        ${toggleBtn('sound', ICONS.soundOn, 'Sound')}
        <button class="btn" type="button" data-nav data-act="quit">${ICONS.home}<span>Quit to title</span></button>
      </div>
      <div class="pause-side">
        <div class="stats-mini">
          <span>${ICONS.catHead}</span><span><b class="ps-alt">0 m</b> <small>altitude</small></span>
          <span>${ICONS.fish}</span><span><b class="ps-treats">0</b> <small>treats</small></span>
          <span>${ICONS.clock}</span><span><b class="ps-time">00:00</b> <small>time</small></span>
        </div>
        <div class="legend"><h3>Controls</h3><div class="legend-rows"></div></div>
      </div>
    </div>
  </section>`);
  const claim = h('<section class="scr scr-claim" aria-label="Claimed"><div class="claim-cap display" role="status" aria-live="polite"></div></section>');
  const resTitle = `<div class="logo" role="heading" aria-level="1" aria-label="Näsinneula claimed!">
      <div class="logo-line logo-l1" aria-hidden="true">${letters('NÄSINNEULA', 0, 1)}</div>
      <div class="logo-line logo-l2" aria-hidden="true">${letters('CLAIMED!', 10, 2)}</div></div>`;
  const row = (i, icon, label, cls) =>
    `<span class="ri r" data-row="${i}">${icon}</span><span class="rl r" data-row="${i}">${label}</span><span class="rv r ${cls}" data-row="${i}"></span>`;
  const results = h(`<section class="scr scr-results" aria-label="Results">
    <div class="rays"></div><div class="confetti"></div>
    <div class="res-title">${resTitle}</div>
    <div class="res-main">
      <div class="panel res-card"><div class="res-rows">
        ${row(0, ICONS.fish, 'Fish treats', 'rv-treats')}<span class="row-sep"></span>
        ${row(1, ICONS.clock, 'Time', 'rv-time')}<span class="row-sep"></span>
        ${row(2, ICONS.nap, 'Naps taken', 'rv-naps')}<span class="row-sep"></span>
        ${row(3, ICONS.charm, 'Nine Lives charm', 'rv-charm')}
      </div></div>
      <div class="rank" data-rank="S" role="img" aria-label="Rank">
        ${ROSETTE}<div class="rk-l">S</div><div class="rk-cap"></div>
        <span class="spark" style="left:-6%;top:6%">${ICONS.star}</span>
        <span class="spark" style="right:-8%;top:30%;animation-delay:-.5s">${ICONS.star}</span>
        <span class="spark" style="left:2%;top:62%;animation-delay:-.9s;width:1em;height:1em">${ICONS.star}</span>
      </div>
    </div>
    <div class="res-btns">
      <button class="btn btn-primary" type="button" data-nav data-act="restart">${ICONS.restart}<span class="lbl">Play again</span></button>
      <button class="btn" type="button" data-nav data-act="quit">${ICONS.home}<span>Title</span></button>
    </div>
  </section>`);
  screens.append(loading, title, pause, claim, results);
  $.screens = { loading, title, pause, claim, results };
  $.loadPaws = [...loading.querySelectorAll('.pw')];
  $.loadTxt = loading.querySelector('.load-txt');
  $.prompt = title.querySelector('.title-prompt');
  $.strip = title.querySelector('.legend-strip');
  $.ps = { alt: pause.querySelector('.ps-alt'), treats: pause.querySelector('.ps-treats'), time: pause.querySelector('.ps-time') };
  $.claimCap = claim.querySelector('.claim-cap');
  buildConfetti(results.querySelector('.confetti'));
  $.res = {
    treatsV: results.querySelector('.rv-treats'),
    timeV: results.querySelector('.rv-time'),
    napsV: results.querySelector('.rv-naps'),
    charmV: results.querySelector('.rv-charm'),
    charmI: results.querySelector('.ri[data-row="3"]'),
    rows: [...results.querySelectorAll('.r')],
    rank: results.querySelector('.rank'),
    rankL: results.querySelector('.rk-l'),
    rankCap: results.querySelector('.rk-cap'),
  };

  const toastEl = h('<div class="layer l-toast"><div class="toasts" role="status" aria-live="polite"></div></div>');
  $.toasts = toastEl.querySelector('.toasts');
  $.flash = h('<div class="layer l-flash"></div>');
  $.fade = h('<div class="layer l-fade"></div>');

  root.append(hudEl, touchLayer, hintEl, bannerEl, screens, toastEl, $.flash, $.fade);
  touch = createTouch(touchLayer, input, { ICONS });
  ui.touch = touch;
}

function wireEvents() {
  // Menu buttons: mouse / touch / Tab+Enter all end up in activate(). Native Enter/Space activation is suppressed,
  // because the same key presses also reach input.pressed('confirm' | 'jump') in ui.tick().
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (!btn || !root.contains(btn)) return;
    const scr = activeScreenEl();
    if (!scr || !scr.contains(btn)) return;
    setFocus(btn, false);
    activate(btn);
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button')) e.preventDefault();
  });
  root.addEventListener('keyup', (e) => {
    if (e.key === ' ' && e.target.closest && e.target.closest('button')) e.preventDefault();
  });
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const btn = e.target.closest('[data-nav]');
    const scr = activeScreenEl();
    if (btn && scr && scr.contains(btn)) setFocus(btn, true);
  });
  root.addEventListener('focusin', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (btn && btn !== focused) setFocus(btn, false);
  });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.scr, .l-touch')) e.preventDefault(); });

  // device tracking for glyphs and touch controls
  addEventListener('touchstart', () => setDevice('touch'), { capture: true, passive: true });
  addEventListener('keydown', (e) => { if (!e.repeat && e.key !== 'Unidentified') setDevice('keyboard'); }, { capture: true });
  input.onDevice((d) => setDevice(d));
  // iOS: no pinch-zoom over the game
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  settings.on((key) => { if (key === 'retro' || key === 'muted') syncToggles(); });
}

// ------------------------------------------------------------------------------------------------------------
export const ui = {
  screen: 'none',
  device: 'keyboard',
  touch: null,

  init(el) {
    if (root) return;
    root = el || document.getElementById('ui');
    if (!root) { root = document.createElement('div'); root.id = 'ui'; document.body.append(root); }
    root.dataset.screen = 'none';
    input.init();
    device = input.lastDevice || 'keyboard';
    build();
    wireEvents();
    syncToggles();
    renderDevice();
    Object.defineProperty(this, 'device', { get: () => device, configurable: true });
  },

  setDevice(d) { setDevice(d); },

  on(event, fn) {
    (handlers[event] ||= []).push(fn);
    return () => { handlers[event] = (handlers[event] || []).filter((f) => f !== fn); };
  },
  emit(event, ...args) { for (const fn of handlers[event] || []) fn(...args); },

  show(screen, data) {
    if (!root) return;
    const prev = this.screen;
    if (screen === 'loading') {
      const p = clamp01(data?.progress ?? 0);
      const on = Math.floor(p * $.loadPaws.length + 1e-6);
      $.loadPaws.forEach((pw, i) => pw.classList.toggle('on', i < on));
      $.loadTxt.innerHTML = `Loading<b>${Math.round(p * 100)}%</b>`;
      $.loadTxt.setAttribute('aria-valuenow', Math.round(p * 100));
    }
    if (screen === 'claim' && data && 'text' in data) setClaimText(data.text);
    if (screen === prev) {
      if (screen === 'results') runResults(data);
      return;
    }
    this.screen = screen;
    root.dataset.screen = screen;
    for (const [name, el] of Object.entries($.screens)) el.classList.toggle('is-on', name === screen);
    shownFrame = frame;
    lockUntil = performance.now() + (screen === 'results' ? 1500 : screen === 'title' && prev === 'results' ? 400 : 120);
    leaving = false;
    repeat.dir = null;
    clearFocus();
    if (screen !== 'claim') setClaimText(null);
    if (screen === 'pause') fillPauseStats();
    if (screen === 'results') runResults(data); else clearResults();
    if (MENU_SCREENS.has(screen)) {
      const first = $.screens[screen].querySelector('[data-nav]');
      setFocus(first, false);
    } else if (document.activeElement && root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    if (screen !== 'play') { for (const t of bannerTimers) clearTimeout(t); $.banner.classList.remove('in', 'out'); }
    updateTouchEnabled();
  },

  update(s) {
    if (!root || !s) return;
    lastState = s;
    const max = s.maxHearts ?? hud.maxHearts;
    if (s.hearts !== hud.hearts || max !== hud.maxHearts) renderHearts(s.hearts ?? 0, Math.max(0, max | 0));
    if (s.treats !== hud.treats) {
      const grew = hud.treats >= 0 && s.treats > hud.treats;
      $.treatNum.textContent = s.treats ?? 0;
      if (grew) pop($.treats, 1.22);
      hud.treats = s.treats;
    }
    if (s.treatsTotal !== hud.treatsTotal) {
      $.treatTot.textContent = s.treatsTotal ? `/ ${s.treatsTotal}` : '';
      hud.treatsTotal = s.treatsTotal;
    }
    const alt = Math.max(0, Math.round(s.altitude || 0));
    if (alt !== hud.alt) { $.altV.textContent = alt; hud.alt = alt; }
    const p = clamp01((s.altitude || 0) / (s.altitudeMax || 168));
    if (Math.abs(p - hud.p) > 0.0004) {
      $.gauge.style.setProperty('--p', p.toFixed(4));
      const hgt = p * 289;
      $.gaugeFill.setAttribute('y', (296 - hgt).toFixed(2));
      $.gaugeFill.setAttribute('height', hgt.toFixed(2));
      hud.p = p;
    }
    const charm = !!s.charm;
    if (charm !== hud.charm) {
      $.hud.classList.toggle('has-charm', charm);
      if (charm && hud.charm === false) { $.charm.classList.remove('got'); void $.charm.offsetWidth; $.charm.classList.add('got'); }
      hud.charm = charm;
    }
  },

  banner(title, subtitle) {
    if (!root) return;
    for (const t of bannerTimers) clearTimeout(t);
    $.bnT.textContent = title || '';
    $.bnSub.textContent = subtitle || '';
    const b = $.banner;
    b.classList.remove('in', 'out');
    void b.offsetWidth;
    b.classList.add('in');
    bannerTimers = [
      setTimeout(() => { b.classList.remove('in'); b.classList.add('out'); }, 3000),
      setTimeout(() => b.classList.remove('out'), 3500),
    ];
  },

  toast(text, ms = 2500, icon = 'star') {
    if (!root) return;
    const el = h(`<div class="toast">${ICONS[icon] || ICONS.star}<span></span></div>`);
    el.querySelector('span').textContent = text;
    $.toasts.append(el);
    while ($.toasts.children.length > 3) $.toasts.firstElementChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
  },

  hint(text) {
    if (!root) return;
    if (text == null || text === '') {
      hintText = null;
      $.hint.classList.remove('show');
      return;
    }
    const changed = text !== hintText;
    hintText = text;
    $.hintTxt.innerHTML = richText(text);
    $.hint.classList.add('show');
    if (changed) { $.hint.classList.remove('bump'); void $.hint.offsetWidth; $.hint.classList.add('bump'); }
  },

  fade(opaque, seconds = 0.4) {
    if (!root) return Promise.resolve();
    const s = Math.max(0, +seconds || 0);
    clearTimeout(fadeTimer);
    $.fade.style.setProperty('--fd', `${s}s`);
    $.fade.classList.toggle('is-opaque', !!opaque);
    return new Promise((resolve) => {
      fadeResolvers.push(resolve);
      fadeTimer = setTimeout(() => { const r = fadeResolvers; fadeResolvers = []; r.forEach((f) => f()); }, s * 1000 + 16);
    });
  },

  flash(color = '#fff', seconds = 0.25) {
    if (!root) return;
    const el = $.flash;
    el.style.setProperty('--flash', color);
    for (const a of el.getAnimations ? el.getAnimations() : []) a.cancel();
    const peak = reduceMotion.matches ? 0.3 : 0.7;
    if (el.animate) el.animate([{ opacity: peak }, { opacity: 0 }], { duration: Math.max(50, seconds * 1000), easing: 'ease-out' });
  },

  tick() {
    if (!root) return;
    frame++;
    if (input.pressed('mute')) toggleSetting('sound', true);
    if (input.pressed('retro')) toggleSetting('retro', true);
    if (!MENU_SCREENS.has(this.screen)) return;
    const now = performance.now();
    if (frame <= shownFrame + 1 || now < lockUntil || leaving) { repeat.dir = null; return; }

    // directions, with hold-to-repeat
    let moved = false;
    for (const d of DIRS) {
      if (input.pressed(d)) { navigate(d); repeat.dir = d; repeat.next = now + 420; moved = true; break; }
    }
    if (!moved && repeat.dir) {
      if (!input.held(repeat.dir)) repeat.dir = null;
      else if (now >= repeat.next) { navigate(repeat.dir); repeat.next = now + 120; }
    }

    if (input.pressed('confirm') || input.pressed('jump')) {
      if (!focused || !navList().includes(focused)) setFocus(navList()[0], false);
      activate(focused);
      return;
    }
    if (input.pressed('back') || input.pressed('pause')) {
      if (this.screen === 'pause') {
        const btn = $.screens.pause.querySelector('[data-act="resume"]');
        setFocus(btn, false);
        activate(btn);
      }
    }
  },
};

function setClaimText(text) {
  const el = $.claimCap;
  if (!el) return;
  if (!text) { el.classList.remove('show'); el.innerHTML = ''; return; }
  el.innerHTML = `<span class="ol">${esc(text)}</span>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

function fillPauseStats() {
  const s = lastState || {};
  $.ps.alt.textContent = `${Math.max(0, Math.round(s.altitude || 0))} m`;
  $.ps.treats.textContent = s.treatsTotal ? `${s.treats ?? 0} / ${s.treatsTotal}` : `${s.treats ?? 0}`;
  $.ps.time.textContent = fmtTime(s.timeSec);
}
