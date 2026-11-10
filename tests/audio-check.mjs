// Automated listening test for src/audio (we cannot hear, so we measure).
//
//   npx vite --port 5181 --strictPort          (in another terminal)
//   node tests/audio-check.mjs [url] [--quick]  default url http://127.0.0.1:5181/tools/audio.html
//
// 1. Static musicality: every melody parses, lands on chord tones on beats 1 and 3, voicings stay in key.
// 2. Offline renders (audio.renderOffline in the page): every song at several progress/section values, every sfx,
//    every meow and loop. For each: peak, RMS, clipped samples, DC offset, NaNs, silence, a coarse spectrum
//    (sub < 120 Hz, low-mid < 1 kHz, high-mid < 5 kHz, high), and for music RMS per second, the tempo
//    estimated from the onset envelope, and the note log (in key, chord tones under the melody, bass on roots).
// 3. Long runs: a 90 s climb from the plaza to the antenna (layers must build, never drop out) and a 60 s run
//    whose live-voice count must stay flat; a stopped song must decay to silence (no stuck notes).
// 4. Real time: unlock, play the climb for 22 s, check the clock advances and notes keep being scheduled,
//    switch sections and songs, and check there were no console errors.
// Exits non-zero on any failure.

import { chromium } from 'playwright';
import { PROG, MEL, SONGS, CLIMB_SECTIONS } from '../src/audio/songs.js';
import { parseMelody, parseProgression, isChordTone, voiceChord, MAJOR } from '../src/audio/theory.js';
import { VOICE_DUCK } from '../src/audio/voice.js';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:5181/tools/audio.html';
const QUICK = args.includes('--quick');

const failures = [];
const warnings = [];
const fail = (msg) => { failures.push(msg); };
const warn = (msg) => { warnings.push(msg); };
const f1 = (x) => (x == null || !Number.isFinite(x) ? '  -inf' : x.toFixed(1).padStart(6));

// ---------------------------------------------------------------------------------------------------------------
// 1. static musicality
{
  let notes = 0, snapped = 0;
  const specs = [];
  for (const sec of CLIMB_SECTIONS) for (const p of sec.phrases) specs.push([sec.key, p]);
  for (const s of Object.values(SONGS)) {
    if (s.section) for (const p of s.section.phrases) specs.push([s.section.key, p]);
    if (s.intro) specs.push([s.section.key, s.intro]);
  }
  for (const [key, spec] of specs) {
    const mel = parseMelody(MEL[spec.mel]);
    const prog = parseProgression(PROG[spec.prog]);
    mel.forEach((bar, bi) => {
      const segs = prog[bi % prog.length];
      for (const s0 of [0, 8]) {
        const ev = bar.find((e) => e.step <= s0 && s0 < e.step + e.len);
        if (!ev) continue;
        notes++;
        const seg = segs.find((g) => g.step <= s0 && s0 < g.step + g.len);
        if (!isChordTone(ev.deg, seg.chord)) {
          snapped++;
          if (spec.prog === spec.mel) fail(`melody ${spec.mel} bar ${bi + 1} beat ${s0 / 4 + 1}: not a chord tone of ${seg.chord.name}`);
        }
      }
    });
    const scale = new Set(MAJOR.map((m) => (m + key) % 12));
    let prev = null;
    for (const bar of prog) for (const { chord } of bar) {
      prev = voiceChord(key, chord, prev);
      for (const n of prev) if (!scale.has(n % 12)) fail(`voicing of ${chord.name} in key ${key} has out-of-key note ${n}`);
      if (Math.max(...prev) - Math.min(...prev) > 14) warn(`wide voicing ${prev} for ${chord.name}`);
    }
  }
  console.log(`static: ${specs.length} phrase specs, ${notes} strong-beat melody notes, ${snapped} adjusted by snapping (reused melodies only)`);
}

// ---------------------------------------------------------------------------------------------------------------
// analysis code, injected into the page

function analyze(buf, opts = {}) {
  const sr = buf.sampleRate;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  const mono = new Float32Array(n);
  let peak = 0, sum = 0, dc = 0, clips = 0, nans = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) { nans++; continue; }
    const al = Math.abs(l), ar = Math.abs(r);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    if (al >= 0.999 || ar >= 0.999) clips++;
    sum += (l * l + r * r) / 2;
    dc += (l + r) / 2;
    mono[i] = (l + r) / 2;
  }
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
  const out = { peak: db(peak), rms: db(Math.sqrt(sum / n)), clips, nans, dc: dc / n };
  // where the sound is: first/last 10 ms window above -60 dBFS
  const win = Math.round(sr * 0.01);
  let first = -1, last = -1, activeSum = 0, activeN = 0;
  for (let w = 0; w * win < n; w++) {
    let s = 0;
    const a = w * win, b = Math.min(n, a + win);
    for (let i = a; i < b; i++) s += mono[i] * mono[i];
    const r = Math.sqrt(s / (b - a));
    if (r > 0.001) { if (first < 0) first = w; last = w; }
    if (r > 0.01) { activeSum += s; activeN += b - a; }
  }
  out.start = first < 0 ? null : first * 0.01;
  out.end = last < 0 ? null : (last + 1) * 0.01;
  out.activeRms = activeN ? db(Math.sqrt(activeSum / activeN)) : -180;
  // RMS per second
  out.perSec = [];
  for (let s = 0; s + sr <= n; s += sr) {
    let q = 0;
    for (let i = s; i < s + sr; i++) q += mono[i] * mono[i];
    out.perSec.push(db(Math.sqrt(q / sr)));
  }
  // coarse spectrum: averaged Hann-windowed FFT power per band
  const N = 4096;
  const re = new Float64Array(N), im = new Float64Array(N);
  const bands = [0, 0, 0, 0];
  const edges = [120, 1000, 5000];
  const frames = Math.min(80, Math.max(1, Math.floor((n - N) / N)));
  const hop = Math.max(N, Math.floor((n - N) / frames));
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = (mono[off + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const hz = (k * sr) / N;
      const p = re[k] * re[k] + im[k] * im[k];
      bands[hz < edges[0] ? 0 : hz < edges[1] ? 1 : hz < edges[2] ? 2 : 3] += p;
    }
  }
  const tot = bands.reduce((a, b) => a + b, 0) || 1;
  out.bands = bands.map((b) => Math.round((100 * b) / tot));
  // tempo: onset envelope (positive log-energy flux in 5 ms hops), autocorrelation over 50..200 BPM
  if (opts.music) {
    // energy of the second difference (a 12 dB/octave high-pass, so bass waveforms don't fake onsets) in 10 ms
    // windows every 5 ms; the onset envelope is the positive change of its log
    const hopS = Math.round(sr * 0.005);
    const env = [];
    let prev = 0;
    for (let i = 2; i + 2 * hopS <= n; i += hopS) {
      let s = 0;
      for (let j = i; j < i + 2 * hopS; j++) { const dd = mono[j] - 2 * mono[j - 1] + mono[j - 2]; s += dd * dd; }
      const e = Math.log(1e-9 + s);
      env.push(Math.max(0, e - prev));
      prev = e;
    }
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    const x = env.map((v) => v - mean);
    const acf = new Float64Array(620);
    for (let lag = 30; lag < acf.length; lag++) {
      let s = 0;
      for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
      acf[lag] = s;
    }
    // comb over the first four multiples of each candidate beat (75..150 hops = 160..80 BPM), so echoes of the
    // dotted-eighth delay and syncopations don't win over the real pulse
    let best = -Infinity, bestLag = 0;
    for (let lag = 75; lag <= 150; lag++) {
      const s = acf[lag] + acf[2 * lag] + acf[3 * lag] + acf[4 * lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    const hopSec = hopS / sr;
    out.bpm = bestLag ? 60 / (bestLag * hopSec) : 0;
    // onsets, and how many of them sit on the 16th-note grid of the song (± 15 ms; swung offbeats allowed).
    // The detector lags real onsets by a few ms (soft attacks peak late), so the grid offset with the most hits
    // is searched (0..step); a wrong tempo or sloppy scheduling spreads the phases and few land on any offset.
    const thr = mean * 4;
    const step = 60 / opts.bpm / 4, t0 = opts.t0 ?? 0.02, swing = (opts.swing ?? 0) * step;
    const phases = [];
    for (let i = 1; i < env.length - 1; i++) {
      if (!(env[i] > thr && env[i] >= env[i - 1] && env[i] > env[i + 1])) continue;
      const t = (i + 1) * hopSec - t0;
      phases.push(((t % step) + step) % step);
    }
    const dist = (a, b) => { const d = Math.abs(a - b) % step; return Math.min(d, step - d); };
    let bestHits = 0, bestOff = 0;
    for (let off = 0; off < step; off += 0.001) {
      let hits = 0;
      for (const p of phases) if (Math.min(dist(p, off), dist(p, off + swing)) <= 0.015) hits++;
      if (hits > bestHits) { bestHits = hits; bestOff = off; }
    }
    out.onsetsPerSec = phases.length / (n / sr);
    out.onGrid = phases.length ? bestHits / phases.length : 1;
    out.gridLag = bestOff > step / 2 ? bestOff - step : bestOff;
  }
  return out;

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi;
          re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
  }
}

/** Checks the note log of a music render: everything in key, chord tones on strong beats, bass on the roots. */
function checkLog(log) {
  const MAJ = [0, 2, 4, 5, 7, 9, 11];
  const res = { notes: log.length, outOfKey: 0, strongNonChord: 0, bassOffRoot: 0, padNonChord: 0, byInst: {} };
  for (const e of log) {
    res.byInst[e.inst] = (res.byInst[e.inst] || 0) + 1;
    const p = ((e.n % 12) + 12) % 12;
    const scale = MAJ.map((m) => (m + e.key) % 12);
    if (!scale.includes(p)) res.outOfKey++;
    if (e.inst === 'melody' && e.strong && e.chord && !e.chord.includes(p)) res.strongNonChord++;
    if (e.inst === 'harmony' && e.strong && e.chord && !e.chord.includes(p)) res.strongNonChord++;
    if (e.inst === 'bass' && (e.kind === 'R' || e.kind === 'O') && p !== e.chordBass) res.bassOffRoot++;
    if (e.inst === 'pad' && e.chord && !e.chord.includes(p)) res.padNonChord++;
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------

const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext();
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
await page.goto(url);
await preparePage();
const names = await page.evaluate(async () => {
  const m = await import('/src/audio/index.js');
  return { sfx: m.SFX_NAMES, meow: m.MEOW_KINDS, loops: m.LOOP_NAMES };
});

async function preparePage() {
  await page.waitForFunction(() => window.audio && window.audio.renderOffline);
  await page.addScriptTag({ content: `window.__analyze = ${analyze.toString()}; window.__checkLog = ${checkLog.toString()};` });
}

/** Renders and analyses in the page. Retries once if the dev server reloaded the page meanwhile (other files edited). */
async function render(what, seconds, opts = {}) {
  try {
    return await renderOnce(what, seconds, opts);
  } catch (e) {
    if (!/context was destroyed|navigation/i.test(String(e))) throw e;
    await page.waitForLoadState('load');
    await preparePage();
    return renderOnce(what, seconds, opts);
  }
}

async function renderOnce(what, seconds, opts = {}) {
  return page.evaluate(async ({ what, seconds, opts }) => {
    const t0 = performance.now();
    const buf = await window.audio.renderOffline(what, seconds);
    const ms = performance.now() - t0;
    const a = window.__analyze(buf, opts);
    a.renderMs = ms;
    a.stats = { ...buf.stats, liveTrace: undefined, liveEnd: buf.stats.liveTrace.at(-1) ?? 0 };
    a.liveTrace = buf.stats.liveTrace;
    if (buf.log) a.log = window.__checkLog(buf.log);
    return a;
  }, { what, seconds, opts });
}

// ---- 2a. music
const MUSIC_SECS = QUICK ? 12 : 32;
const musicCases = [
  { label: 'title', what: { music: 'title' }, bpm: 100 },
  { label: 'climb p0.00 s0 plaza', what: { music: 'climb', progress: 0, section: 0 }, bpm: 108, quiet: true },
  { label: 'climb p0.12 s1 ferris', what: { music: 'climb', progress: 0.12, section: 1 }, bpm: 108, quiet: true },
  { label: 'climb p0.25 s2 coaster', what: { music: 'climb', progress: 0.25, section: 2 }, bpm: 108 },
  { label: 'climb p0.37 s3 drop', what: { music: 'climb', progress: 0.37, section: 3 }, bpm: 108 },
  { label: 'climb p0.50 s4 swinger', what: { music: 'climb', progress: 0.5, section: 4 }, bpm: 108, swing: 0.14 },
  { label: 'climb p0.62 s5 festival', what: { music: 'climb', progress: 0.62, section: 5 }, bpm: 108 },
  { label: 'climb p0.75 s6 underside', what: { music: 'climb', progress: 0.75, section: 6 }, bpm: 108 },
  { label: 'climb p0.87 s7 pod', what: { music: 'climb', progress: 0.87, section: 7 }, bpm: 108, full: true },
  { label: 'climb p1.00 s8 antenna', what: { music: 'climb', progress: 1, section: 8 }, bpm: 108, full: true },
  { label: 'climb p0.60 s5 tension 1', what: { music: 'climb', progress: 0.6, section: 5, tension: 1 }, bpm: 108 },
  { label: 'claim', what: { music: 'claim' }, bpm: 116, full: true },
  { label: 'results', what: { music: 'results' }, bpm: 96, swing: 0.12 },
];
console.log(`\nMUSIC (${MUSIC_SECS} s offline renders, default volumes)`);
console.log('case                          peak    RMS  minSec maxSec clips  bpm~  onset/s grid%  sub lmid hmid high  notes  live  x-rt');
const musicRms = {};
for (const c of musicCases) {
  const a = await render({ ...c.what, log: true }, MUSIC_SECS, { music: true, bpm: c.bpm, swing: c.swing });
  const steady = a.perSec.slice(2);
  const minSec = Math.min(...steady), maxSec = Math.max(...steady);
  musicRms[c.label] = a.rms;
  console.log(
    `${c.label.padEnd(28)} ${f1(a.peak)} ${f1(a.rms)} ${f1(minSec)} ${f1(maxSec)} ${String(a.clips).padStart(5)} ${a.bpm.toFixed(1).padStart(6)} ${a.onsetsPerSec.toFixed(1).padStart(7)} ${(100 * a.onGrid).toFixed(0).padStart(5)}  ` +
    `${a.bands.map((b) => String(b).padStart(4)).join(' ')} ${String(a.log.notes).padStart(6)} ${String(a.stats.maxLive).padStart(5)} ${(MUSIC_SECS * 1000 / a.renderMs).toFixed(1).padStart(5)}`,
  );
  if (a.nans) fail(`${c.label}: ${a.nans} NaN samples`);
  if (a.clips) fail(`${c.label}: ${a.clips} clipped samples`);
  if (a.peak > -0.5) fail(`${c.label}: peak ${a.peak.toFixed(1)} dBFS too hot`);
  if (Math.abs(a.dc) > 0.005) fail(`${c.label}: DC offset ${a.dc.toFixed(4)}`);
  if (minSec < -40) fail(`${c.label}: drops out (a second at ${minSec.toFixed(1)} dBFS)`);
  if (a.rms < -30 || a.rms > -8) fail(`${c.label}: absurd level ${a.rms.toFixed(1)} dBFS RMS`);
  if (c.full && (a.rms < -17 || a.rms > -11)) fail(`${c.label}: full arrangement RMS ${a.rms.toFixed(1)} outside −16..−12 (±1)`);
  // the autocorrelation tempo (bpm~) is informational: half-time and syncopated grooves fool it. The grid test is
  // the real timing check: onsets must land on the song's 16th-note grid.
  if (a.onGrid < 0.8) fail(`${c.label}: only ${(100 * a.onGrid).toFixed(0)}% of onsets on the ${c.bpm} BPM grid`);
  if (Math.abs(a.gridLag) > 0.025) fail(`${c.label}: onsets ${(a.gridLag * 1000).toFixed(0)} ms off the expected grid`);
  if (a.onsetsPerSec < 1.5) fail(`${c.label}: hardly any note onsets (${a.onsetsPerSec.toFixed(1)}/s)`);
  const L = a.log;
  if (L.outOfKey) fail(`${c.label}: ${L.outOfKey} out-of-key notes`);
  if (L.strongNonChord) fail(`${c.label}: ${L.strongNonChord} melody/harmony notes off the chord on strong beats`);
  if (L.bassOffRoot) fail(`${c.label}: ${L.bassOffRoot} bass notes off the root`);
  if (L.padNonChord) fail(`${c.label}: ${L.padNonChord} pad notes outside the chord`);
  if (a.stats.maxLive > 260) fail(`${c.label}: ${a.stats.maxLive} live voices`);
}
const order = ['climb p0.00 s0 plaza', 'climb p0.25 s2 coaster', 'climb p0.50 s4 swinger', 'climb p0.87 s7 pod', 'climb p1.00 s8 antenna'];
for (let i = 1; i < order.length; i++) {
  if (musicRms[order[i]] < musicRms[order[i - 1]] - 1) fail(`layering: ${order[i]} (${musicRms[order[i]].toFixed(1)}) quieter than ${order[i - 1]} (${musicRms[order[i - 1]].toFixed(1)})`);
}

// ---- 2b. long runs
if (!QUICK) {
  console.log('\nLONG RUNS');
  const sweep = await render({ music: 'climb', progress: [0, 1], section: 'auto' }, 90, { music: true, bpm: 108, swing: 0.14 });
  const per10 = [];
  for (let i = 0; i < 90; i += 10) per10.push(sweep.perSec.slice(i, i + 10).reduce((a, b) => a + b, 0) / 10);
  console.log(`climb 0→1 over 90 s: RMS per 10 s: ${per10.map((x) => x.toFixed(1)).join(' ')}  min 1 s ${Math.min(...sweep.perSec.slice(1)).toFixed(1)}  clips ${sweep.clips}  peak ${sweep.peak.toFixed(1)}`);
  if (Math.min(...sweep.perSec.slice(1)) < -40) fail('climb sweep drops out');
  if (per10[8] < per10[0] + 4) fail(`climb sweep: top (${per10[8].toFixed(1)}) not clearly louder than plaza (${per10[0].toFixed(1)})`);
  for (let i = 1; i < 9; i++) if (per10[i] < per10[i - 1] - 1.5) fail(`climb sweep: level drops between ${i * 10 - 10}–${i * 10} s and ${i * 10}–${i * 10 + 10} s`);
  if (sweep.clips) fail(`climb sweep clips (${sweep.clips})`);

  const long = await render({ music: 'climb', progress: 0.9, section: 7 }, 60, { music: true, bpm: 108 });
  const tr = long.liveTrace;
  const firstHalf = Math.max(...tr.slice(8, tr.length / 2)), secondHalf = Math.max(...tr.slice(tr.length / 2));
  console.log(`climb 60 s at p0.9: live voices max ${long.stats.maxLive}, max 2nd..30th s ${firstHalf}, max 30..60 s ${secondHalf}, sources started ${long.stats.started}, ended ${long.stats.ended}`);
  if (secondHalf > firstHalf * 1.5 + 10) fail(`live voices grow over time (${firstHalf} → ${secondHalf})`);

  const stopped = await render({ music: 'claim', stopAfter: 8 }, 14, { music: true });
  const tail = stopped.perSec.slice(-2);
  console.log(`claim stopped at 8 s: RMS of the last 2 s ${tail.map((x) => x.toFixed(1)).join(', ')} dBFS`);
  if (Math.max(...tail) > -70) fail(`sound continues after stop (${Math.max(...tail).toFixed(1)} dBFS): stuck notes?`);
}

// ---- 2c. sfx, meows, loops
console.log('\nSFX / VOICE / LOOPS');
console.log('name                 peak    RMS  active  start   end  clips  sub lmid hmid high');
const sfxRow = (name, a) => console.log(`${name.padEnd(18)} ${f1(a.peak)} ${f1(a.rms)} ${f1(a.activeRms)} ${(a.start ?? -1).toFixed(2).padStart(6)} ${(a.end ?? -1).toFixed(2).padStart(5)} ${String(a.clips).padStart(6)}  ${a.bands.map((b) => String(b).padStart(4)).join(' ')}`);
const oneShot = async (label, what, secs) => {
  const a = await render(what, secs);
  sfxRow(label, a);
  if (a.nans) fail(`${label}: NaN samples`);
  if (a.clips) fail(`${label}: clipping`);
  if (a.peak > -3) fail(`${label}: peak ${a.peak.toFixed(1)} dBFS above −3`);
  if (a.peak < -40) fail(`${label}: silent (peak ${a.peak.toFixed(1)})`);
  if (Math.abs(a.dc) > 0.005) fail(`${label}: DC offset`);
  if (a.end != null && a.end > secs - 0.05) fail(`${label}: still sounding at the end of the ${secs} s render`);
  return a;
};
for (const name of names.sfx) await oneShot(name, { sfx: name }, name === 'firework_burst' ? 5 : 4);
await oneShot('treat pitch 1.5', { sfx: 'treat', opts: { pitch: 1.5 } }, 2);
const meows = {};
for (const kind of names.meow) meows[kind] = await oneShot(`meow:${kind}`, { meow: kind }, kind === 'purr' ? 5 : 3);
for (const name of names.loops) {
  const a = await render({ loop: name, opts: { volume: 1 } }, 8);
  sfxRow(`loop:${name}`, a);
  if (a.nans || a.clips) fail(`loop ${name}: NaN/clipping`);
  if (a.peak > -3) fail(`loop ${name}: peak ${a.peak.toFixed(1)}`);
  if (Math.min(...a.perSec.slice(2)) < -50) fail(`loop ${name}: drops out`);
}
const fullMusic = musicRms['climb p1.00 s8 antenna'];
const duckDb = 20 * Math.log10(VOICE_DUCK.gain);
console.log('');
for (const kind of ['meow', 'happy', 'hurt']) {
  const lvl = meows[kind].activeRms;
  const margin = lvl - (fullMusic + duckDb);
  console.log(`${kind}: active RMS ${lvl.toFixed(1)} dBFS vs full music ${fullMusic.toFixed(1)} dBFS ducked ${duckDb.toFixed(1)} dB under the voice → margin ${margin.toFixed(1)} dB`);
  if (margin < 3) fail(`${kind} not clearly above the music (margin ${margin.toFixed(1)} dB)`);
}

// ---- 4. real time
console.log('\nREAL TIME');
await page.click('#unlock');
await page.click('button[data-name="climb"]');
await page.evaluate(() => { window.audio.setProgress(0.6); window.audio.setSection(5); window.audio.loop('wind_high', true, { volume: 0.5 }); });
const sample = () => page.evaluate(() => {
  const d = window.audio._debug;
  return { t: d.ctx.currentTime, state: d.ctx.state, events: d.graph.stats.events, live: d.graph.stats.live, bar: d.player?.bar, section: d.player?.section, song: d.player?.name };
});
const samples = [await sample()];
const RT_SECS = QUICK ? 8 : 22;
for (let i = 0; i < RT_SECS / 2; i++) {
  await page.waitForTimeout(2000);
  if (i === 3) await page.evaluate(() => window.audio.setSection(7));
  if (i === 5) await page.evaluate(() => { window.audio.setProgress(1); window.audio.sfx('treat'); window.audio.meow('meow'); });
  samples.push(await sample());
}
console.log(samples.map((s) => `t=${s.t.toFixed(1)} ${s.state} events=${s.events} live=${s.live} sec=${s.section}`).join('\n'));
const s0 = samples[0], sN = samples.at(-1);
if (sN.t - s0.t < RT_SECS * 0.9) fail(`real time: context clock advanced only ${(sN.t - s0.t).toFixed(1)} s in ${RT_SECS} s`);
for (let i = 1; i < samples.length; i++) {
  if (samples[i].events <= samples[i - 1].events) fail(`real time: no new notes scheduled between samples ${i - 1} and ${i}`);
  if (samples[i].live > 300) fail(`real time: ${samples[i].live} live voices`);
}
if (!QUICK && sN.section !== 7) fail(`real time: section change did not land (section ${sN.section})`);
// song switches
await page.evaluate(() => window.audio.setMusic('claim'));
await page.waitForTimeout(3000);
const afterClaim = await sample();
await page.evaluate(() => window.audio.setMusic('results'));
await page.waitForTimeout(3000);
const afterResults = await sample();
console.log(`after claim: song=${afterClaim.song} events=${afterClaim.events}; after results: song=${afterResults.song} events=${afterResults.events} live=${afterResults.live}`);
if (afterClaim.song !== 'claim' || afterResults.song !== 'results') fail('real time: setMusic did not switch songs');
if (afterResults.events <= afterClaim.events) fail('real time: results not scheduling');
const fadingLeft = await page.evaluate(() => window.audio._debug.fading);
if (fadingLeft > 1) fail(`real time: ${fadingLeft} old songs still alive after their fade`);

// tab visibility: hide the page behind another tab, the context should suspend, then resume when shown again
{
  const other = await context.newPage();
  await other.bringToFront();
  await page.waitForTimeout(800);
  const hidden = await page.evaluate(() => ({ hidden: document.hidden, state: window.audio._debug.ctx.state }));
  await page.bringToFront();
  await page.waitForTimeout(800);
  const shown = await page.evaluate(() => ({ hidden: document.hidden, state: window.audio._debug.ctx.state, events: window.audio._debug.graph.stats.events }));
  await page.waitForTimeout(1000);
  const later = await page.evaluate(() => window.audio._debug.graph.stats.events);
  await other.close();
  if (!hidden.hidden) {
    // headless Chromium keeps background tabs "visible": fake the visibility change to exercise the handler
    const fake = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const ctx = window.audio._debug.ctx;
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(500);
      const hiddenState = ctx.state;
      const t0 = ctx.currentTime;
      await sleep(500);
      const frozen = ctx.currentTime - t0 < 0.05;
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(500);
      const ev0 = window.audio._debug.graph.stats.events;
      await sleep(1000);
      return { hiddenState, frozen, shownState: ctx.state, scheduling: window.audio._debug.graph.stats.events > ev0 };
    });
    console.log(`visibility (simulated): hidden → ${fake.hiddenState}${fake.frozen ? ', clock frozen' : ''}; shown → ${fake.shownState}, scheduling ${fake.scheduling}`);
    if (fake.hiddenState !== 'suspended' || !fake.frozen) fail('hidden tab: context not suspended');
    if (fake.shownState !== 'running' || !fake.scheduling) fail('shown tab: context did not resume scheduling');
  } else {
    console.log(`visibility: hidden → context ${hidden.state}; shown → context ${shown.state}, still scheduling: ${later > shown.events}`);
    if (hidden.state !== 'suspended') fail(`hidden tab: context ${hidden.state}, expected suspended`);
    if (shown.state !== 'running' || later <= shown.events) fail('shown tab: context did not resume scheduling');
  }
}

// ---- console
if (consoleErrors.length) fail(`console errors/warnings:\n  ${consoleErrors.join('\n  ')}`);
await browser.close();

console.log('');
for (const w of warnings) console.log(`warn: ${w}`);
if (failures.length) {
  console.log(`FAIL (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('PASS');
