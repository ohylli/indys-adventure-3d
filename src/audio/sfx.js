// Sound effects: soft, tactile, synthesized one-shots (sine thumps, filtered-noise swishes, FM bells).
// Every effect is a small recipe built from three primitives below (tone, hiss, bell) plus a few custom bits.
// playSfx() wraps each call in its own gain (opts.volume) → panner (opts.pan) → sfx bus, with a reverb send, and
// opts.pitch scales every frequency of the recipe.

import { gain, filter, osc, noise, track } from './graph.js';
import { voice, VOICES } from './voice.js';

const SFX_GAIN = 0.85; // overall level of all effects (calibrated so the loudest peak below −3 dBFS)

// ---- primitives -------------------------------------------------------------------------------------------------
// S = { G, ac, t, p (pitch), out, end }: each primitive pushes S.end out to the time its sound finishes.

/** An oscillator note. f → f1 glide over `glide` s; amplitude: attack a, hold, then exponential decay over dur. */
function tone(S, { type = 'sine', f, f1, glide, dur = 0.2, a = 0.004, hold = 0, v = 0.5, delay = 0, lp, vib, trem }) {
  const { G, ac } = S;
  const t = S.t + delay;
  const g = gain(ac, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + a);
  g.gain.setTargetAtTime(0, t + a + hold, dur / 5);
  const end = t + a + hold + dur * 1.3;
  const nodes = [g];
  const o = osc(G, type, f * S.p, t, end, nodes);
  if (f1) {
    o.frequency.setValueAtTime(f * S.p, t);
    o.frequency.exponentialRampToValueAtTime(f1 * S.p, t + (glide ?? dur));
  }
  let node = o;
  if (lp) {
    const fl = filter(ac, 'lowpass', lp, 0.7);
    nodes.push(fl);
    node = node.connect(fl);
  }
  if (vib) { // [rate Hz, depth cents]: pitch wobble that fades out over the note
    const l = osc(G, 'sine', vib[0], t, end);
    const lg = gain(ac, vib[1]);
    lg.gain.setTargetAtTime(0, t + a, dur / 2);
    nodes.push(lg);
    l.connect(lg).connect(o.detune);
  }
  if (trem) { // [rate Hz, depth 0..1]: throat flutter
    const tg = gain(ac, 1 - trem[1] / 2);
    const l = osc(G, 'sine', trem[0], t, end);
    const lg = gain(ac, trem[1] / 2);
    nodes.push(tg, lg);
    l.connect(lg).connect(tg.gain);
    node = node.connect(tg);
  }
  node.connect(g).connect(S.out);
  S.end = Math.max(S.end, end);
  return o;
}

/** Filtered noise. f → f1 filter sweep over the note; attack a, hold, exponential decay over dur. */
function hiss(S, { type = 'bandpass', f, f1, q = 1, dur = 0.2, a = 0.002, hold = 0, v = 0.5, delay = 0, rate = 1 }) {
  const { G, ac } = S;
  const t = S.t + delay;
  const fl = filter(ac, type, f * S.p, q);
  if (f1) {
    fl.frequency.setValueAtTime(f * S.p, t);
    fl.frequency.exponentialRampToValueAtTime(f1 * S.p, t + a + hold + dur);
  }
  const g = gain(ac, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + a);
  g.gain.setTargetAtTime(0, t + a + hold, dur / 5);
  const end = t + a + hold + dur * 1.3;
  noise(G, t, end, [fl, g], rate).connect(fl).connect(g).connect(S.out);
  S.end = Math.max(S.end, end);
}

/** FM bell. ratio 2 = sweet, 3.5 = glassy, 1.41 = dingy metal. */
function bell(S, { f, v = 0.3, delay = 0, ratio = 2, index = 1, decay = 0.4 }) {
  const { G, ac } = S;
  const t = S.t + delay;
  const fr = f * S.p;
  const g = gain(ac, 0);
  const mg = gain(ac, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, decay);
  mg.gain.setValueAtTime(fr * index, t);
  mg.gain.setTargetAtTime(fr * index * 0.1, t, decay * 0.4);
  const end = t + decay * 7;
  const car = osc(G, 'sine', fr, t, end, [g, mg]);
  osc(G, 'sine', fr * ratio, t, end).connect(mg).connect(car.frequency);
  car.connect(g).connect(S.out);
  S.end = Math.max(S.end, end);
}

/** A buffer of sparse crackles (firework glitter): `count` tiny bursts spread over `dur` s, denser early on. */
function crackle(S, { dur = 1.6, count = 60, v = 0.5, delay = 0, hp = 2500 }) {
  const { G, ac } = S;
  const sr = ac.sampleRate;
  const buf = ac.createBuffer(1, Math.ceil(sr * dur), sr);
  const d = buf.getChannelData(0);
  for (let k = 0; k < count; k++) {
    const at = Math.floor(Math.pow(Math.random(), 1.6) * (d.length - 400));
    const amp = (0.3 + Math.random() * 0.7) * (1 - at / d.length * 0.6);
    const len = 30 + Math.floor(Math.random() * 200);
    for (let i = 0; i < len; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const fl = filter(ac, 'highpass', hp, 0.7);
  const g = gain(ac, v);
  track(G, src, [fl, g]);
  const t = S.t + delay;
  src.connect(fl).connect(g).connect(S.out);
  src.start(t);
  S.end = Math.max(S.end, t + dur);
}

const rnd = (a, b) => a + Math.random() * (b - a);

// ---- the effects ------------------------------------------------------------------------------------------------
// D major-ish pitches for the musical ones so they never fight the music too badly.
const N = { D5: 587.3, E5: 659.3, Fs5: 740, A5: 880, B5: 987.8, D6: 1174.7, E6: 1318.5, Fs6: 1480, A6: 1760, B6: 1975.5, D7: 2349.3 };

export const SFX = {
  // ---- movement
  jump(S) {
    hiss(S, { f: 700, f1: 2600, q: 1.2, dur: 0.16, a: 0.02, v: 0.32 });
    tone(S, { f: 260, f1: 520, glide: 0.09, dur: 0.12, v: 0.32 });
    tone(S, { type: 'triangle', f: 520, f1: 1040, glide: 0.08, dur: 0.07, v: 0.06 });
  },
  pounce(S) {
    hiss(S, { f: 500, f1: 3200, q: 1, dur: 0.28, a: 0.03, v: 0.4 });
    tone(S, { f: 200, f1: 500, glide: 0.14, dur: 0.16, v: 0.36 });
    tone(S, { f: 95, f1: 60, dur: 0.1, v: 0.3 });
  },
  land(S) {
    tone(S, { f: 140, f1: 55, glide: 0.08, dur: 0.14, a: 0.002, v: 0.62 });
    hiss(S, { type: 'lowpass', f: 900, f1: 300, dur: 0.07, v: 0.38 });
    hiss(S, { type: 'highpass', f: 3000, dur: 0.02, v: 0.05, delay: 0.005 });
  },
  step(S) {
    hiss(S, { type: 'lowpass', f: rnd(1300, 2000), f1: 600, dur: 0.035, a: 0.001, v: 0.2 });
    tone(S, { f: rnd(100, 125), dur: 0.03, v: 0.14 });
  },
  climb(S) { // claws catching: two or three tiny scratches
    const n = Math.random() < 0.5 ? 2 : 3;
    for (let i = 0; i < n; i++) hiss(S, { f: rnd(3000, 4200), q: 2, dur: 0.025, v: 0.16 - i * 0.03, delay: i * rnd(0.022, 0.034) });
  },
  bounce(S) { // trampoline "boing": a rising sine with a springy wobble, over a soft thump
    tone(S, { f: 150, f1: 430, glide: 0.12, dur: 0.45, v: 0.42, vib: [13, 70] });
    tone(S, { type: 'triangle', f: 300, f1: 860, glide: 0.12, dur: 0.3, v: 0.08, vib: [13, 70] });
    tone(S, { f: 95, f1: 50, dur: 0.12, v: 0.45 });
  },
  vault(S) {
    hiss(S, { f: 1200, f1: 3800, q: 1.2, dur: 0.13, a: 0.015, v: 0.28 });
    tone(S, { f: 330, f1: 660, glide: 0.07, dur: 0.1, v: 0.22, delay: 0.02 });
  },

  // ---- pickups
  treat(S) { // sparkly two-note ping; the game raises opts.pitch for quick chains
    bell(S, { f: N.E6, v: 0.32, ratio: 3.01, index: 0.6, decay: 0.12 });
    bell(S, { f: N.B6, v: 0.3, ratio: 2, index: 0.8, decay: 0.2, delay: 0.055 });
    bell(S, { f: N.E6 * 2, v: 0.08, ratio: 3.5, index: 0.5, decay: 0.1, delay: 0.1 });
    hiss(S, { type: 'highpass', f: 7000, dur: 0.12, v: 0.08 });
  },
  heart(S) { // a warm rising arpeggio
    [N.D5, N.Fs5, N.A5, N.D6].forEach((f, i) => {
      tone(S, { type: 'triangle', f, dur: 0.35, a: 0.006, v: 0.2, delay: i * 0.07, lp: 3000 });
      tone(S, { f: f * 2, dur: 0.2, v: 0.05, delay: i * 0.07 });
    });
    bell(S, { f: N.D7, v: 0.12, ratio: 3.5, decay: 0.3, delay: 0.3 });
  },
  charm(S) { // magic: a pentatonic glissando of bells over a swelling chord and shimmer
    [N.D6, N.E6, N.Fs6, N.A6, N.B6, N.D7, N.E6 * 2, N.Fs6 * 2].forEach((f, i) => bell(S, { f, v: 0.12, ratio: 2.01, index: 0.7, decay: 0.35, delay: i * 0.045 }));
    [N.D5, N.Fs5, N.A5].forEach((f) => tone(S, { f, dur: 1.0, a: 0.2, hold: 0.2, v: 0.08 }));
    hiss(S, { type: 'highpass', f: 6000, dur: 0.9, a: 0.3, v: 0.06 });
  },
  checkpoint(S) { // "ta-da-daa!"
    [[N.A5, 0, 0.18], [N.D6, 0.11, 0.18], [N.Fs6, 0.22, 0.18], [N.A6, 0.33, 0.7]].forEach(([f, d, dur]) => {
      tone(S, { type: 'triangle', f, dur, a: 0.005, v: 0.2, delay: d, lp: 4000 });
      bell(S, { f, v: 0.12, ratio: 2, index: 0.6, decay: dur * 0.6, delay: d });
    });
    [N.D5, N.Fs5, N.A5].forEach((f) => tone(S, { f, dur: 0.9, a: 0.03, hold: 0.2, v: 0.06, delay: 0.33 }));
  },

  // ---- harm
  hurt(S) { // gentle: a soft falling "bwomp" and a muffled puff
    tone(S, { type: 'triangle', f: 520, f1: 250, glide: 0.22, dur: 0.3, v: 0.32, lp: 1800 });
    tone(S, { f: 300, f1: 140, glide: 0.25, dur: 0.25, v: 0.25, delay: 0.02 });
    hiss(S, { type: 'lowpass', f: 1200, dur: 0.12, v: 0.22 });
  },
  splash(S) {
    hiss(S, { type: 'lowpass', f: 5000, f1: 600, dur: 0.5, a: 0.005, v: 0.45 });
    hiss(S, { f: 1500, q: 0.8, dur: 0.25, v: 0.18, delay: 0.05 });
    for (let i = 0; i < 5; i++) {
      const f = rnd(500, 1000);
      tone(S, { f, f1: f * 1.6, glide: 0.05, dur: 0.06, v: 0.1, delay: 0.1 + i * rnd(0.05, 0.09) });
    }
  },
  fall(S) { // a long descending whoosh
    hiss(S, { f: 2200, f1: 300, q: 1.5, dur: 0.9, a: 0.25, v: 0.38 });
    tone(S, { f: 900, f1: 180, glide: 1.0, dur: 0.9, a: 0.1, v: 0.14 });
  },
  respawn(S) { // a soft magical bloom
    [N.D5, N.A5, N.D6, N.Fs6].forEach((f, i) => bell(S, { f, v: 0.18, ratio: 2, index: 0.7, decay: 0.4, delay: i * 0.06 }));
    [N.D5, N.A5].forEach((f) => tone(S, { f, dur: 0.6, a: 0.25, v: 0.1 }));
    hiss(S, { f: 800, f1: 6000, q: 1.5, dur: 0.4, a: 0.3, v: 0.08 });
  },

  // ---- creatures
  gull(S) { // "kyaaaow, kya-kya-kya"
    voice(S.G, S.out, S.t, VOICES.gullLong, { pitch: S.p });
    for (let i = 0; i < 3; i++) voice(S.G, S.out, S.t + 0.58 + i * 0.17, VOICES.gullShort, { pitch: S.p * (1 - i * 0.04), vol: 1 - i * 0.15 });
    S.end = Math.max(S.end, S.t + 1.2);
  },
  jackdaw(S) { // "chak!"
    voice(S.G, S.out, S.t, VOICES.jackdaw, { pitch: S.p });
    hiss(S, { f: 2400, q: 1.5, dur: 0.03, v: 0.18 });
    S.end = Math.max(S.end, S.t + 0.15);
  },
  flap(S) { // wings scattering: quick feathery bursts, slowing as the bird gets away
    let d = 0;
    for (let i = 0; i < 8; i++) {
      hiss(S, { f: rnd(700, 1100), q: 0.8, dur: 0.05, a: 0.008, v: 0.3 * (1 - i / 10), delay: d });
      hiss(S, { type: 'lowpass', f: 400, dur: 0.04, v: 0.12 * (1 - i / 10), delay: d });
      d += 0.055 + i * 0.008 + rnd(0, 0.015);
    }
  },
  pigeon(S) { // "hoo-hoooo"
    tone(S, { f: 390, f1: 350, dur: 0.3, a: 0.05, v: 0.22, lp: 900, trem: [16, 0.5] });
    tone(S, { type: 'triangle', f: 195, f1: 175, dur: 0.3, a: 0.05, v: 0.08, lp: 700 });
    tone(S, { f: 420, f1: 330, glide: 0.45, dur: 0.45, a: 0.06, v: 0.24, delay: 0.4, lp: 900, trem: [14, 0.5] });
    tone(S, { type: 'triangle', f: 210, f1: 165, glide: 0.45, dur: 0.45, a: 0.06, v: 0.08, delay: 0.4, lp: 700 });
  },

  // ---- world
  pop(S) { // balloon
    hiss(S, { type: 'highpass', f: 300, dur: 0.035, a: 0.0005, v: 0.75 });
    tone(S, { f: 180, f1: 60, dur: 0.08, a: 0.001, v: 0.35 });
    hiss(S, { type: 'lowpass', f: 2500, dur: 0.15, v: 0.16, delay: 0.01 });
  },
  honk(S) { // coaster car horn: "honk-honk"
    for (const d of [0, 0.22]) {
      for (const [f, dt] of [[349, -6], [349, 6], [440, 0]]) {
        const o = tone(S, { type: 'sawtooth', f, f1: f * 0.97, glide: 0.17, dur: 0.17, a: 0.012, hold: 0.07, v: 0.09, delay: d, lp: 1600 });
        o.detune.value = dt;
      }
    }
  },
  coaster(S) { // a train rattling past: clacks speeding up then slowing, a rumble, panned left → right
    const ac = S.ac;
    const pan = S.panner.pan;
    pan.setValueAtTime(-0.8, S.t);
    pan.linearRampToValueAtTime(0.8, S.t + 1.4);
    let d = 0;
    for (let i = 0; i < 18; i++) {
      const u = i / 17;
      const swell = Math.sin(Math.PI * Math.min(1, u * 1.1));
      hiss(S, { f: rnd(1500, 2200), q: 1.5, dur: 0.025, v: 0.06 + 0.22 * swell, delay: d });
      hiss(S, { type: 'lowpass', f: 300, dur: 0.03, v: 0.1 * swell, delay: d + 0.004 });
      d += 0.13 - 0.06 * swell + rnd(0, 0.01);
    }
    hiss(S, { type: 'lowpass', f: 260, dur: 0.8, a: 0.5, hold: 0.2, v: 0.35 });
    tone(S, { type: 'sawtooth', f: 220, f1: 160, glide: 1.4, dur: 0.8, a: 0.5, v: 0.03, lp: 700 });
    void ac;
  },
  ride_ding(S) {
    bell(S, { f: 1568, v: 0.28, ratio: 1.41, index: 1.2, decay: 0.45 });
    bell(S, { f: 1568, v: 0.24, ratio: 1.41, index: 1.2, decay: 0.55, delay: 0.3 });
  },
  drop_whoosh(S) { // the drop tower letting go
    hiss(S, { f: 3000, f1: 250, q: 1, dur: 1.2, a: 0.1, v: 0.45 });
    tone(S, { f: 600, f1: 80, glide: 1.3, dur: 1.1, v: 0.18 });
    hiss(S, { type: 'lowpass', f: 200, dur: 1.0, a: 0.2, v: 0.3 });
  },
  wind(S) { // a gust, ~1.5 s: swelling band-passed noise whose centre wanders, drifting across
    const { G, ac } = S;
    const t = S.t;
    const dur = 1.5;
    S.panner.pan.setValueAtTime(rnd(-0.6, 0), t);
    S.panner.pan.linearRampToValueAtTime(rnd(0, 0.6), t + dur);
    for (const [f0, q, v] of [[500, 2.2, 0.38], [1300, 3, 0.16]]) {
      const bp = filter(ac, 'bandpass', f0, q);
      bp.frequency.setValueCurveAtTime(new Float32Array([f0 * 0.7, f0 * 1.3, f0 * 0.9, f0 * 1.15, f0 * 0.75].map((x) => x * S.p)), t, dur);
      const g = gain(ac, 0);
      g.gain.setValueCurveAtTime(new Float32Array([0, v * 0.6, v, v * 0.7, v * 0.85, 0]), t, dur);
      noise(G, t, t + dur + 0.05, [bp, g]).connect(bp).connect(g).connect(S.out);
    }
    S.end = Math.max(S.end, t + dur + 0.05);
  },
  firework_launch(S) { // a whistle climbing into the sky with a hissing trail
    tone(S, { f: 120, f1: 60, dur: 0.1, v: 0.25 });
    tone(S, { f: 900, f1: 2600, glide: 1.1, dur: 0.9, a: 0.05, hold: 0.3, v: 0.08, vib: [9, 30] });
    hiss(S, { type: 'highpass', f: 3000, dur: 0.9, a: 0.02, hold: 0.1, v: 0.12 });
  },
  firework_burst(S) { // a big round boom, a crack, a rumble and falling glitter
    tone(S, { f: 85, f1: 32, glide: 0.9, dur: 1.4, a: 0.003, v: 0.6 });
    hiss(S, { type: 'lowpass', f: 900, f1: 180, dur: 1.3, a: 0.003, v: 0.5 });
    hiss(S, { type: 'highpass', f: 1500, dur: 0.05, v: 0.42 });
    crackle(S, { dur: 2.0, count: 90, v: 0.4, delay: 0.25 });
  },
  spark(S) { // a sparkler fizz / a lone spark
    crackle(S, { dur: 0.35, count: 18, v: 0.35, hp: 4000 });
    bell(S, { f: rnd(3000, 4200), v: 0.05, ratio: 3.5, decay: 0.05 });
  },
  aww(S) { // two visitors cooing at the cat
    voice(S.G, S.out, S.t, VOICES.aww, { pitch: S.p });
    voice(S.G, S.out, S.t + 0.06, VOICES.aww, { pitch: S.p * 1.22, vol: 0.7 });
    S.end = Math.max(S.end, S.t + 1.0);
  },

  // ---- ui
  ui_move(S) {
    tone(S, { f: 1100, dur: 0.04, a: 0.002, v: 0.16 });
    tone(S, { type: 'triangle', f: 2200, dur: 0.02, v: 0.04 });
  },
  ui_select(S) {
    tone(S, { type: 'triangle', f: N.A5, dur: 0.08, v: 0.2 });
    tone(S, { type: 'triangle', f: N.E6, dur: 0.16, v: 0.2, delay: 0.06 });
    bell(S, { f: N.E6, v: 0.06, ratio: 2, decay: 0.15, delay: 0.06 });
  },
  ui_back(S) {
    tone(S, { type: 'triangle', f: N.E6, dur: 0.07, v: 0.18 });
    tone(S, { type: 'triangle', f: N.A5, dur: 0.14, v: 0.18, delay: 0.06 });
  },
  pause(S) {
    tone(S, { f: 880, f1: 440, glide: 0.16, dur: 0.18, v: 0.22, lp: 2500 });
    tone(S, { type: 'triangle', f: 660, dur: 0.2, v: 0.12, delay: 0.08, lp: 2000 });
  },
  unpause(S) {
    tone(S, { f: 440, f1: 880, glide: 0.14, dur: 0.18, v: 0.22, lp: 2500 });
    tone(S, { type: 'triangle', f: 1320, dur: 0.2, v: 0.1, delay: 0.08, lp: 3000 });
  },
};

// Per-effect level trims (linear), balanced against the music: frequent movement sounds sit around −22 dBFS
// while sounding, big moments (charm, firework) peak near −4 dBFS. Unlisted: 1.
const LEVEL = {
  jump: 1.8, pounce: 1.4, vault: 1.6, step: 1.4, climb: 2, hurt: 1.6, splash: 1.3, fall: 1.4, flap: 1.8,
  jackdaw: 1.8, gull: 1.6, aww: 1.8, coaster: 1.8, wind: 1.8, spark: 1.4, ui_move: 2, ui_back: 1.4, pause: 1.6, unpause: 1.6,
};

// How wet each effect is (reverb send). Unlisted: 0.12.
const REVERB = { treat: 0.3, heart: 0.3, charm: 0.45, checkpoint: 0.35, respawn: 0.4, gull: 0.3, ride_ding: 0.35, firework_burst: 0.5, firework_launch: 0.3, spark: 0.3, aww: 0.2, step: 0.04, climb: 0.05, land: 0.06 };

export const SFX_NAMES = Object.keys(SFX);

/** Plays effect `name` at time t. opts: { volume = 1, pitch = 1, pan = 0 }. Returns false for unknown names. */
export function playSfx(G, name, opts = {}, t = G.ac.currentTime + 0.005) {
  const recipe = SFX[name];
  if (!recipe) return false;
  const ac = G.ac;
  const out = gain(ac, SFX_GAIN * (LEVEL[name] ?? 1) * (opts.volume ?? 1));
  const panner = ac.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
  const rev = gain(ac, REVERB[name] ?? 0.12);
  out.connect(panner).connect(G.sfxIn);
  panner.connect(rev).connect(G.sfxRevIn);
  const S = { G, ac, t, p: opts.pitch ?? 1, out, panner, end: t };
  recipe(S);
  // a silent timer source that disconnects the per-call nodes once the effect has finished
  const timer = ac.createConstantSource();
  timer.offset.value = 0;
  timer.connect(out);
  track(G, timer, [out, panner, rev]);
  timer.start(t);
  timer.stop(S.end + 0.1);
  return true;
}
