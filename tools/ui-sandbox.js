// UI sandbox: drives every state of src/ui over a fake animated "game" background.
// Open http://127.0.0.1:5182/tools/ui.html (npx vite --port 5182 --strictPort). ?clean hides the dev panel,
// ?screen=title|play|... starts on a screen, ?bg=day|night|sunset picks the background.
import { ui } from '../src/ui/index.js';
import { input } from '../src/core/input.js';
import { settings } from '../src/core/settings.js';

const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const log = [];
const logEl = $('#log');
function note(msg) {
  log.push(msg);
  if (log.length > 30) log.shift();
  logEl.textContent = log.slice().reverse().join('\n');
}

const state = { hearts: 3, maxHearts: 3, treats: 12, treatsTotal: 40, altitude: 42, altitudeMax: 168, charm: false, timeSec: 0 };
const sample = { treats: 37, treatsTotal: 40, timeSec: 463, naps: 2, charm: true, rank: 'S' };
let auto = false;
const events = [];

ui.init(document.getElementById('ui'));

for (const ev of ['start', 'resume', 'restart', 'quit']) {
  ui.on(ev, () => {
    events.push(ev);
    note(`event: ${ev}`);
    if (ev === 'start' || ev === 'restart') {
      ui.fade(true, 0.25).then(() => {
        Object.assign(state, { hearts: state.maxHearts, treats: 0, altitude: 0, timeSec: 0, charm: false });
        ui.show('play');
        ui.fade(false, 0.4);
        ui.banner('Särkänniemi Plaza', '0 m');
        ui.hint('Use {move} to walk and {jump} to jump');
      });
    } else if (ev === 'resume') ui.show('play');
    else if (ev === 'quit') ui.fade(true, 0.25).then(() => { ui.show('title'); ui.fade(false, 0.4); ui.hint(null); });
  });
}

// --- game loop stand-in -----------------------------------------------------------------------------------
let last = performance.now();
function loop(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  input.poll();
  if (ui.screen === 'play') {
    if (input.pressed('pause')) ui.show('pause');
    state.timeSec += dt;
    if (auto) { state.altitude = (state.altitude + dt * 9) % 168; }
  }
  ui.update(state);
  ui.tick();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- dev panel ------------------------------------------------------------------------------------------------
function syncSliders() {
  $('#hHearts').value = state.hearts; $('#hMax').value = state.maxHearts; $('#hTreats').value = state.treats;
  $('#hAlt').value = Math.round(state.altitude); $('#hCharm').checked = state.charm;
  $('#hHeartsV').textContent = `${state.hearts}/${state.maxHearts}`;
}
$('#hHearts').oninput = (e) => { state.hearts = +e.target.value; syncSliders(); };
$('#hMax').oninput = (e) => { state.maxHearts = +e.target.value; state.hearts = Math.min(state.hearts, state.maxHearts); syncSliders(); };
$('#hTreats').oninput = (e) => { state.treats = +e.target.value; };
$('#hAlt').oninput = (e) => { state.altitude = +e.target.value; };
$('#hCharm').onchange = (e) => { state.charm = e.target.checked; if (state.charm) ui.toast('Nine Lives charm!', 2500, 'charm'); };
$('#hAuto').onchange = (e) => { auto = e.target.checked; };
syncSliders();

let loadTimer = 0;
const actions = {
  collapse: () => document.body.classList.add('collapsed'),
  loadAnim: () => {
    clearInterval(loadTimer);
    let p = 0;
    ui.show('loading', { progress: 0 });
    loadTimer = setInterval(() => { p = Math.min(1, p + 0.04); ui.show('loading', { progress: p }); if (p >= 1) clearInterval(loadTimer); }, 80);
  },
  claim: () => { ui.show('claim', { text: 'Näsinneula claimed!' }); },
  results: () => ui.show('results', { ...sample }),
  banner: () => ui.banner('The Wave Swinger', '62 m'),
  banner2: () => ui.banner('Underneath the Observation Deck', '118 m'),
  toast: () => ui.toast('Checkpoint!'),
  toast2: () => ui.toast('Nine Lives charm!', 2500, 'charm'),
  hint: () => ui.hint('Use {move} to walk and {jump} to jump'),
  hint2: () => ui.hint('Press {meow} to meow: gulls fly off and visitors go "aww". {pause} pauses.'),
  hintOff: () => ui.hint(null),
  fadeIn: () => ui.fade(true, 0.5).then(() => note('fade in done')),
  fadeOut: () => ui.fade(false, 0.5).then(() => note('fade out done')),
  flashRed: () => ui.flash('#ff2a2a', 0.35),
  flashWhite: () => ui.flash('#ffffff', 0.3),
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('#dev button, #devToggle');
  if (!b) return;
  if (b.id === 'devToggle') { document.body.classList.remove('collapsed'); return; }
  if (b.dataset.show) ui.show(b.dataset.show, b.dataset.show === 'loading' ? { progress: 0.45 } : undefined);
  if (b.dataset.do) actions[b.dataset.do]();
  if (b.dataset.rank) { sample.rank = b.dataset.rank; sample.charm = b.dataset.rank !== 'C'; sample.naps = { S: 0, A: 1, B: 3, C: 7 }[b.dataset.rank]; sample.treats = { S: 40, A: 34, B: 22, C: 9 }[b.dataset.rank]; ui.show('results', { ...sample }); }
  if (b.dataset.dev) ui.setDevice(b.dataset.dev);
  if (b.dataset.bg) document.body.dataset.bg = b.dataset.bg;
  b.blur();
});
settings.on((k, v) => note(`setting ${k} = ${v}`));
input.onDevice((d) => note(`device: ${d}`));

if (params.has('clean')) document.body.classList.add('clean');
if (params.get('bg')) document.body.dataset.bg = params.get('bg');
ui.show(params.get('screen') || 'title');

window.sandbox = { ui, input, settings, state, sample, events, actions, setAuto: (v) => { auto = v; } };
