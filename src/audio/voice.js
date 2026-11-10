// Formant voice synthesis: Indy's meows, plus the other "voiced" creatures (gull, jackdaw) and the visitors' "aww".
//
// A voice is a buzzy glottal pulse (a custom PeriodicWave, softer than a raw sawtooth) shaped by three parallel
// band-pass formant filters, like a vocal tract. Pitch, formants and loudness each follow a contour over the
// sound's 0..1 duration, rendered into automation curves. Cat meows glide from a closed "m" through a bright "ee"
// to an open "a" and a rounded "ow"; the formants are set high because a cat's vocal tract is small.
// A trill (fast amplitude flutter) gives the rolled "rr" of a chirp; a growl (slower, rougher modulation) and a
// detuned second source give the hurt yowl its edge. Every call randomizes pitch, length and a smooth jitter so
// no two meows are identical. Ported from ../indys-adventure/js/audio.js and extended.

import { gain, filter, osc, noise, track } from './graph.js';

// Formant centres [F1, F2, F3] in Hz.
const CAT = {
  m: [420, 1150, 2700],
  i: [720, 2900, 4300],
  e: [900, 2450, 3900],
  a: [1250, 1950, 3400],
  o: [760, 1300, 3000],
  u: [560, 980, 2700],
};
const HUMAN = {
  a: [780, 1200, 2700],
  o: [560, 880, 2600],
  w: [380, 760, 2500],
};
const BIRD = {
  k: [1500, 2900, 4200],
  a: [1700, 2600, 4000],
  o: [1100, 2000, 3500],
};

// Each voice: dur s, vol, f0 / vowel / amp contours over 0..1, trill [Hz, depth, from, to], growl [Hz, depth],
// breath (noise level), detune (cents, adds a rough second source), vibrato [Hz, depth], table (formant set).
export const VOICES = {
  meow: {
    dur: 0.62, vol: 1, table: CAT,
    f0: [[0, 540], [0.25, 830], [0.55, 770], [1, 500]],
    vowels: [[0, 'm'], [0.12, 'i'], [0.4, 'a'], [0.76, 'o'], [1, 'u']],
    amp: [[0, 0], [0.07, 0.5], [0.2, 1], [0.7, 0.85], [1, 0]],
    breath: 0.1, vibrato: [5.5, 0.012],
  },
  chirp: { // the little "mrrp!" on a jump: a rolled trill that rises
    dur: 0.2, vol: 0.6, table: CAT,
    f0: [[0, 620], [0.5, 800], [1, 980]],
    vowels: [[0, 'm'], [0.3, 'i'], [1, 'e']],
    amp: [[0, 0], [0.15, 1], [0.75, 0.85], [1, 0]],
    trill: [30, 0.6, 0, 0.7], breath: 0.12,
  },
  hurt: { // a startled yowl
    dur: 0.46, vol: 0.6, table: CAT,
    f0: [[0, 820], [0.15, 1200], [0.6, 1000], [1, 620]],
    vowels: [[0, 'm'], [0.08, 'a'], [0.55, 'a'], [1, 'u']],
    amp: [[0, 0], [0.05, 1], [0.62, 0.9], [1, 0]],
    growl: [62, 0.35], breath: 0.22, detune: 25,
  },
  happy: { // "mrrrow?" with a rolled start and a rising, questioning end
    dur: 0.4, vol: 0.85, table: CAT,
    f0: [[0, 640], [0.3, 700], [0.7, 830], [1, 1080]],
    vowels: [[0, 'm'], [0.2, 'i'], [0.6, 'e'], [1, 'i']],
    amp: [[0, 0], [0.12, 1], [0.85, 0.9], [1, 0]],
    trill: [27, 0.5, 0, 0.35], breath: 0.08,
  },
  // ---- other creatures
  gullLong: { // the long "kyaaaow"
    dur: 0.5, vol: 0.55, table: BIRD,
    f0: [[0, 950], [0.12, 1400], [0.55, 1250], [1, 780]],
    vowels: [[0, 'k'], [0.1, 'a'], [0.6, 'a'], [1, 'o']],
    amp: [[0, 0], [0.04, 1], [0.6, 0.8], [1, 0]],
    growl: [95, 0.25], breath: 0.15, detune: 35,
  },
  gullShort: { // the "kya" laugh syllables
    dur: 0.13, vol: 0.45, table: BIRD,
    f0: [[0, 1250], [0.3, 1350], [1, 950]],
    vowels: [[0, 'k'], [0.25, 'a'], [1, 'o']],
    amp: [[0, 0], [0.12, 1], [0.6, 0.8], [1, 0]],
    growl: [95, 0.25], breath: 0.15, detune: 35,
  },
  jackdaw: { // a sharp "chak"
    dur: 0.085, vol: 0.6, table: BIRD,
    f0: [[0, 1300], [0.4, 1150], [1, 850]],
    vowels: [[0, 'k'], [0.3, 'a'], [1, 'o']],
    amp: [[0, 0], [0.08, 1], [0.5, 0.7], [1, 0]],
    breath: 0.5, detune: 40, jitter: 0.06,
  },
  aww: { // a visitor cooing at the cat
    dur: 0.85, vol: 0.5, table: HUMAN,
    f0: [[0, 300], [0.15, 330], [0.6, 260], [1, 215]],
    vowels: [[0, 'a'], [0.55, 'o'], [1, 'w']],
    amp: [[0, 0], [0.12, 1], [0.7, 0.75], [1, 0]],
    breath: 0.3, vibrato: [5, 0.02],
  },
};
const FORMANT_Q = [4.5, 7, 9];
const FORMANT_GAIN = [1, 0.7, 0.35];
const VOICE_GAIN = 0.86; // overall level of all formant voices (meows go through the voice compressor too)

/** Piecewise-linear value of a [[t, v], ...] contour at u in 0..1. */
function interp(pts, u) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return v0 + ((v1 - v0) * (u - t0)) / Math.max(1e-6, t1 - t0);
    }
  }
  return pts[pts.length - 1][1];
}
function curve(n, fn) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = fn(i / (n - 1));
  return a;
}

/** The glottal source: harmonics falling ~5 dB/octave with a slight even/odd tilt, softer than a saw. */
function glottalWave(G) {
  if (G.glottal) return G.glottal;
  const N = 48;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let n = 1; n < N; n++) im[n] = Math.pow(n, -0.85) * (n % 2 ? 1 : 0.8);
  return (G.glottal = G.ac.createPeriodicWave(re, im));
}

/**
 * Plays a voice spec at time t0 into dest. opts: { pitch, vol, random }.
 * Returns the end time.
 */
export function voice(G, dest, t0, V, { pitch = 1, vol = 1, random = true } = {}) {
  const ac = G.ac;
  const rnd = (spread) => (random ? 1 + (Math.random() * 2 - 1) * spread : 1);
  const p = pitch * rnd(0.07);
  const dur = V.dur * rnd(0.06);
  const N = Math.max(32, Math.round(dur * 600));
  const jitAmt = V.jitter ?? 0.03;
  const jit = [];
  for (let i = 0; i < 9; i++) jit.push([i / 8, random ? (Math.random() - 0.5) * jitAmt : 0]);
  const vibPh = Math.random() * 6;
  const [vibHz, vibDepth] = V.vibrato || [5.5, 0.006];
  const f0 = curve(N, (u) => interp(V.f0, u) * p * (1 + interp(jit, u) + vibDepth * Math.sin(vibPh + 2 * Math.PI * vibHz * u * dur)));
  const amp = curve(N, (u) => {
    let a = interp(V.amp, u);
    if (V.trill) {
      const [hz, depth, from = 0, to = 1] = V.trill;
      if (u >= from && u <= to) {
        const fade = Math.min(1, (to - u) / 0.1); // the roll relaxes into the vowel
        a *= 1 - depth * fade * 0.5 * (1 + Math.sin(2 * Math.PI * hz * u * dur));
      }
    }
    if (V.growl) a *= 1 - V.growl[1] * 0.5 * (1 + Math.sin(2 * Math.PI * V.growl[0] * u * dur + Math.sin(u * 40)));
    return a;
  });
  const end = t0 + dur;
  const table = V.table || CAT;
  const tract = Math.sqrt(p); // a higher voice comes from a smaller mouth

  const env = gain(ac, 0);
  env.gain.setValueCurveAtTime(amp, t0, dur);
  const mix = gain(ac, 1);
  const out = gain(ac, V.vol * vol * VOICE_GAIN);
  const lp = filter(ac, 'lowpass', 3000, 0.7);
  const nodes = [env, mix, out, lp];

  const wave = glottalWave(G);
  const srcs = [osc(G, wave, 500, t0, end + 0.02, nodes)];
  if (V.detune) {
    const s2 = osc(G, wave, 500, t0, end + 0.02);
    s2.detune.value = V.detune;
    srcs.push(s2);
  }
  for (const s of srcs) {
    s.frequency.setValueCurveAtTime(f0, t0, dur);
    s.connect(env);
  }

  for (let k = 0; k < 3; k++) {
    const bp = filter(ac, 'bandpass', 1000, FORMANT_Q[k]);
    bp.frequency.setValueCurveAtTime(curve(N, (u) => interp(V.vowels.map(([t, v]) => [t, table[v][k]]), u) * tract), t0, dur);
    const g = gain(ac, FORMANT_GAIN[k]);
    env.connect(bp).connect(g).connect(mix);
    nodes.push(bp, g);
  }
  // breath: noise through the upper formant region, following the loudness contour
  if (V.breath) {
    const bf = filter(ac, 'bandpass', 3200 * tract, 0.9);
    const bg = gain(ac, 0);
    bg.gain.setValueCurveAtTime(curve(N, (u) => interp(V.amp, u) * V.breath), t0, dur);
    noise(G, t0, end + 0.02, [bf, bg]).connect(bf).connect(bg).connect(mix);
  }
  // the mouth opening: duller on closed sounds ("m", "ow"), brighter on open vowels
  lp.frequency.setValueCurveAtTime(curve(N, (u) => (1500 + 1.6 * interp(V.vowels.map(([t, v]) => [t, table[v][1]]), u)) * tract), t0, dur);
  mix.connect(lp).connect(out).connect(dest);
  return end;
}

/**
 * Purring, about 3 s: a pulse train at ~26 Hz (the larynx snapping open and shut) through low resonances, plus
 * pulsed noise. Two out-breaths and two shorter, quicker, softer in-breaths.
 */
export function purr(G, dest, t0, { vol = 1 } = {}) {
  const ac = G.ac;
  const dur = 3;
  const N = Math.round(dur * 1200);
  const breaths = [[0, 0], [0.04, 0.9], [0.3, 0.8], [0.34, 0.1], [0.38, 0.55], [0.48, 0.5], [0.52, 0.05],
    [0.56, 0.9], [0.82, 0.8], [0.86, 0.1], [0.9, 0.55], [0.97, 0.4], [1, 0]];
  const inhale = (u) => (u > 0.34 && u < 0.53) || u > 0.86;
  const ph = Math.random();
  const rate = (u) => (inhale(u) ? 28 : 25) * (1 + 0.04 * Math.sin(u * 9));
  // integrate the rate to get the pulse phase, so rate changes don't jump
  let phase = ph;
  const am = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    phase += rate(u) / (N / dur);
    const pulse = Math.pow(Math.max(0, Math.sin(2 * Math.PI * phase)), 3);
    am[i] = interp(breaths, u) * (inhale(u) ? 0.7 : 1) * (0.12 + 0.88 * pulse);
  }
  const g = gain(ac, 0);
  g.gain.setValueCurveAtTime(am, t0, dur);
  const lp = filter(ac, 'lowpass', 520, 1.2);
  const res = filter(ac, 'peaking', 240, 2);
  res.gain.value = 6;
  const out = gain(ac, 0.65 * vol);
  const hg = gain(ac, 0.45);
  const nodes = [g, lp, res, out, hg];
  noise(G, t0, t0 + dur + 0.02, nodes).connect(lp);
  // a soft voiced hum underneath, pulsed the same way
  const hum = osc(G, glottalWave(G), 105 * (0.95 + Math.random() * 0.1), t0, t0 + dur + 0.02);
  hum.connect(hg).connect(lp);
  lp.connect(res).connect(g).connect(out).connect(dest);
  return t0 + dur;
}

export const MEOW_KINDS = ['meow', 'chirp', 'hurt', 'happy', 'purr'];
/** How far the music dips while Indy meows (gain), and for how long beyond the sound (s). */
export const VOICE_DUCK = { gain: 0.6, tail: 0.15 };

/** Indy's voice. Routed through its own gain with a touch of reverb so it sits in the same space as the sfx. */
export function meowVoice(G, kind, t0, opts = {}) {
  const ac = G.ac;
  const out = gain(ac, opts.volume ?? 1);
  const pan = ac.createStereoPanner();
  pan.pan.value = opts.pan ?? 0;
  const rev = gain(ac, 0.12);
  out.connect(pan).connect(G.voiceIn);
  pan.connect(rev).connect(G.sfxRevIn);
  const end = kind === 'purr' ? purr(G, out, t0) : voice(G, out, t0, VOICES[kind] || VOICES.meow, { pitch: opts.pitch ?? 1 });
  // dip the music under the voice (not for the small jump chirp, which can be frequent, nor the long purr)
  if (kind !== 'purr' && kind !== 'chirp') {
    const d = G.voiceDuck.gain;
    d.cancelScheduledValues(t0);
    d.setTargetAtTime(VOICE_DUCK.gain, t0, 0.03);
    d.setTargetAtTime(1, end + VOICE_DUCK.tail, 0.2);
  }
  // a silent timer source that disconnects the per-call nodes after the sound
  const timer = ac.createConstantSource();
  timer.offset.value = 0;
  timer.connect(out);
  track(G, timer, [out, pan, rev]);
  timer.start(t0);
  timer.stop(end + 0.1);
}
