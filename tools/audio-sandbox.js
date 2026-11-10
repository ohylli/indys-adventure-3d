// Dev sandbox for src/audio: audition every song, effect, meow and loop, and watch the output level.
// Serve the project root (npx vite --port 5181 --strictPort) and open /tools/audio.html.
import { audio, SECTIONS, SFX_NAMES, MEOW_KINDS, LOOP_NAMES, SONG_NAMES } from '../src/audio/index.js';

window.audio = audio; // for the console and tests/audio-check.mjs

const $ = (id) => document.getElementById(id);
const button = (parent, label, fn) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.name = label;
  b.addEventListener('click', () => { audio.unlock(); fn(b); });
  $(parent).append(b);
  return b;
};
const slider = (id, fn, fmt = (v) => v.toFixed(2)) => {
  const el = $(id);
  const out = el.parentElement.querySelector('output');
  const sync = () => { const v = +el.value; if (out) out.textContent = fmt(v); fn(v); };
  el.addEventListener('input', sync);
  sync();
  return el;
};

$('unlock').addEventListener('click', () => audio.unlock());
$('mute').addEventListener('change', (e) => audio.setMuted(e.target.checked));
slider('musicVol', (v) => audio.setVolumes({ music: v }));
slider('sfxVol', (v) => audio.setVolumes({ sfx: v }));

// ---- music
const songButtons = [];
for (const name of ['none', ...SONG_NAMES]) {
  songButtons.push(button('songs', name, (b) => {
    audio.setMusic(name);
    songButtons.forEach((x) => x.classList.toggle('active', x === b));
  }));
}
const sectionEl = slider('section', (v) => audio.setSection(v), (v) => `${v} ${SECTIONS[v]}`);
slider('progress', (v) => {
  audio.setProgress(v);
  if ($('autoSection').checked) {
    const s = Math.min(8, Math.floor(v * 9));
    if (+sectionEl.value !== s) {
      sectionEl.value = s;
      sectionEl.dispatchEvent(new Event('input'));
    }
  }
});
slider('tension', (v) => audio.setTension(v));
$('duck').addEventListener('click', () => audio.duck(0.6, 1.5));

let sweep = null;
$('climbSweep').addEventListener('click', () => {
  audio.unlock();
  audio.setMusic('climb');
  const start = performance.now();
  clearInterval(sweep);
  sweep = setInterval(() => {
    const p = Math.min(1, (performance.now() - start) / 120000);
    $('progress').value = p;
    $('progress').dispatchEvent(new Event('input'));
    if (p >= 1) clearInterval(sweep);
  }, 200);
});

// ---- effects, voice, loops
for (const name of SFX_NAMES) {
  button('sfx', name, () => audio.sfx(name, { pitch: +$('pitch').value, pan: +$('pan').value, volume: +$('sfxOptVol').value }));
}
slider('pitch', () => {});
slider('pan', () => {});
slider('sfxOptVol', () => {});
for (const kind of MEOW_KINDS) button('meows', kind, () => audio.meow(kind));
const loopOn = {};
for (const name of LOOP_NAMES) {
  button('loops', name, (b) => {
    loopOn[name] = !loopOn[name];
    b.classList.toggle('active', loopOn[name]);
    audio.loop(name, loopOn[name], { volume: name === 'wind_high' ? +$('windVol').value : 1 });
  });
}
slider('windVol', (v) => { if (loopOn.wind_high) audio.loop('wind_high', true, { volume: v }); });

// ---- frame loop: drives audio.update like the game does, and the meters
const buf = new Float32Array(2048);
let peakHold = -60, peakHoldT = 0;
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
const pct = (d) => `${Math.max(0, Math.min(100, ((d + 60) / 60) * 100))}%`;
function frame(now) {
  audio.update(1 / 60);
  const dbg = audio._debug;
  const G = dbg.graph;
  if (G) {
    G.analyser.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (const x of buf) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
    const rms = db(Math.sqrt(sum / buf.length));
    const pk = db(peak);
    if (pk > peakHold || now - peakHoldT > 1500) { peakHold = pk; peakHoldT = now; }
    $('rmsBar').style.width = pct(rms);
    $('peakBar').style.width = pct(pk);
    $('peakHold').style.left = pct(peakHold);
    const p = dbg.player;
    $('info').textContent = [
      `context ${dbg.ctx.state}  t=${dbg.ctx.currentTime.toFixed(2)} s  base latency ${(dbg.ctx.baseLatency * 1000).toFixed(0)} ms`,
      `RMS ${rms.toFixed(1)} dBFS   peak ${peakHold.toFixed(1)} dBFS`,
      `live voices ${G.stats.live}  (max ${G.stats.maxLive})  scheduled notes ${G.stats.events}`,
      p ? `song ${p.name}  energy ${p.energy.toFixed(2)}  section ${p.section} ${SECTIONS[p.section] || ''}` : 'song none',
      p && p.phrase ? `phrase #${p.phrase.index} ${p.phrase.spec.prog}/${p.phrase.spec.mel}${p.phrase.spec.v ? ' ' + p.phrase.spec.v : ''}${p.phrase.breakdown ? ' BREAKDOWN' : ''}  bar ${p.bar + 1}/${p.phrase.nBars}` : '',
      `fading songs ${dbg.fading}  loops ${[...dbg.loops.keys()].join(', ') || '-'}`,
    ].join('\n');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
