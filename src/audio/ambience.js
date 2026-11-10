// Looping ambiences: 'wind_high' (the altitude wind bed) and 'crowd' (festival murmur at the plaza).
// Each is a small, continuously running graph built from noise and slow LFOs (no repeating sample), faded in and
// out by a gain. set(on, volume) can be called every frame: the level only changes when it moves noticeably.

import { gain, filter } from './graph.js';

export const LOOP_NAMES = ['wind_high', 'crowd'];
const LOOP_GAIN = { wind_high: 0.55, crowd: 0.5 };

export class Ambience {
  constructor(G, name) {
    this.G = G;
    this.name = name;
    this.out = gain(G.ac, 0);
    this.out.connect(G.sfxIn);
    this.sources = [];
    this.nodes = [this.out];
    this.level = -1;
    this.on = false;
    this.offAt = Infinity;
    (name === 'crowd' ? buildCrowd : buildWind)(this, G.ac);
    const t = G.ac.currentTime;
    for (const s of this.sources) s.start(t, s.buffer ? Math.random() * s.buffer.duration : undefined);
  }

  // helpers used by the builders
  node(n) { this.nodes.push(n); return n; }
  src(n) { this.sources.push(n); return n; }
  noise(rate = 1) {
    const s = this.G.ac.createBufferSource();
    s.buffer = this.G.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    return this.src(s);
  }
  lfo(target, hz, depth, type = 'sine') {
    const ac = this.G.ac;
    const o = this.src(ac.createOscillator());
    o.type = type;
    o.frequency.value = hz;
    const g = this.node(gain(ac, depth));
    o.connect(g).connect(target);
    return o;
  }

  /** Fades towards volume (0..1) when on, or out when off. */
  set(on, volume = 1) {
    const ac = this.G.ac;
    const now = ac.currentTime;
    const target = on ? LOOP_GAIN[this.name] * Math.max(0, Math.min(1, volume)) : 0;
    if (on) this.offAt = Infinity;
    else if (this.on) this.offAt = now + 2.5;
    this.on = on;
    if (Math.abs(target - this.level) < 0.004) return;
    this.out.gain.setTargetAtTime(target, now, on ? 0.35 : 0.5);
    this.level = target;
  }

  /** True once the loop has faded out completely and been torn down. */
  finished(now) {
    if (this.on || now < this.offAt) return false;
    this.dispose();
    return true;
  }

  dispose() {
    const t = this.G.ac.currentTime;
    for (const s of this.sources) {
      try { s.stop(t); } catch { /* not started */ }
      s.disconnect();
    }
    for (const n of this.nodes) n.disconnect();
    this.sources = [];
  }
}

/** High wind: two noise bands whose centres and loudness drift (gusts), plus a low rumble. Wide stereo. */
function buildWind(A, ac) {
  const bands = [
    { f: 480, q: 0.9, lfoHz: 0.071, lfoDepth: 220, ampHz: 0.11, pan: -0.5, v: 0.55, rate: 0.97 },
    { f: 1150, q: 1.6, lfoHz: 0.13, lfoDepth: 480, ampHz: 0.083, pan: 0.5, v: 0.32, rate: 1.03 },
    { f: 2600, q: 3, lfoHz: 0.19, lfoDepth: 900, ampHz: 0.17, pan: 0.1, v: 0.1, rate: 1.0 },
  ];
  for (const b of bands) {
    const bp = A.node(filter(ac, 'bandpass', b.f, b.q));
    A.lfo(bp.frequency, b.lfoHz, b.lfoDepth);
    const g = A.node(gain(ac, b.v * 0.6));
    A.lfo(g.gain, b.ampHz, b.v * 0.4);
    const p = A.node(ac.createStereoPanner());
    p.pan.value = b.pan;
    A.noise(b.rate).connect(bp).connect(g).connect(p).connect(A.out);
  }
  const lp = A.node(filter(ac, 'lowpass', 160, 0.7));
  const rg = A.node(gain(ac, 0.5));
  A.lfo(rg.gain, 0.05, 0.25);
  A.noise(0.9).connect(lp).connect(rg).connect(A.out);
}

/**
 * Festival crowd: several distant "talkers" (glottal-ish buzz through a wandering formant band, chopped into
 * syllables by a 3–6 Hz amplitude LFO, each with its own pitch drift) over a soft murmur bed of filtered noise.
 */
function buildCrowd(A, ac) {
  const muffle = A.node(filter(ac, 'lowpass', 2200, 0.7));
  muffle.connect(A.out);
  const talkers = [
    { f0: 120, formant: 600, syl: 4.1, pan: -0.6 },
    { f0: 210, formant: 900, syl: 5.3, pan: 0.4 },
    { f0: 165, formant: 750, syl: 3.6, pan: -0.15 },
    { f0: 240, formant: 1100, syl: 4.7, pan: 0.7 },
  ];
  for (const k of talkers) {
    const o = A.src(ac.createOscillator());
    o.type = 'sawtooth';
    o.frequency.value = k.f0;
    A.lfo(o.frequency, 0.23 + Math.random() * 0.2, k.f0 * 0.12);
    const bp = A.node(filter(ac, 'bandpass', k.formant, 2.5));
    A.lfo(bp.frequency, 0.7 + Math.random() * 0.6, k.formant * 0.35, 'triangle');
    const amp = A.node(gain(ac, 0.022));
    A.lfo(amp.gain, k.syl, 0.022);
    const p = A.node(ac.createStereoPanner());
    p.pan.value = k.pan;
    o.connect(bp).connect(amp).connect(p).connect(muffle);
  }
  const bed = A.node(filter(ac, 'bandpass', 650, 0.6));
  const bg = A.node(gain(ac, 0.35));
  A.lfo(bg.gain, 0.09, 0.1);
  A.noise(1).connect(bed).connect(bg).connect(muffle);
}
