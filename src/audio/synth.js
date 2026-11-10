// The music instruments. Each function schedules one note at AudioContext time t into `dest` (a channel input)
// and cleans up after itself (see track() in graph.js). Notes are MIDI numbers, velocities 0..1.
// They are deliberately small: a voice is 1–3 sources and a couple of gains/filters, so the full arrangement
// stays around 100 live sources. Shared filtering and stereo placement happen on the channel (music.js).

import { osc, noise, gain, filter, adsr, perc, mtof } from './graph.js';

// ---- drums ------------------------------------------------------------------------------------------------------

/** Round, punchy kick: a sine with a fast pitch drop and a held body, plus a tiny click for definition. */
export function kick(G, dest, t, v = 1) {
  const ac = G.ac;
  const g = gain(ac, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.002);
  g.gain.setValueAtTime(v, t + 0.03);
  g.gain.setTargetAtTime(0, t + 0.03, 0.1);
  const end = t + 0.75;
  const o = osc(G, 'sine', 160, t, end, [g]);
  o.frequency.setValueAtTime(170, t);
  o.frequency.exponentialRampToValueAtTime(58, t + 0.055);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.35);
  o.connect(g).connect(dest);
  const cg = gain(ac, 0);
  const n = noise(G, t, perc(cg.gain, t, 0.22 * v, 0.0005, 0.0035), [cg]);
  n.connect(cg).connect(dest);
}

/** A pitched tom for fills. */
export function tom(G, dest, t, v, hz = 160) {
  const g = gain(G.ac, 0);
  const end = perc(g.gain, t, v, 0.002, 0.11);
  const o = osc(G, 'sine', hz, t, end, [g]);
  o.frequency.setValueAtTime(hz * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(hz, t + 0.04);
  o.frequency.exponentialRampToValueAtTime(hz * 0.8, t + 0.4);
  o.connect(g).connect(dest);
}

/** Layered clap: three quick noise bursts and a tail through a band-pass, with a short snare body under it. */
export function clap(G, dest, t, v = 1) {
  const ac = G.ac;
  const g = gain(ac, 0);
  const bp = filter(ac, 'bandpass', 1250, 0.9);
  const p = g.gain;
  p.setValueAtTime(0, t);
  for (let k = 0; k < 3; k++) {
    const tb = t + k * 0.011;
    p.setValueAtTime(v * (0.8 + k * 0.1), tb);
    p.setTargetAtTime(v * 0.1, tb + 0.0005, 0.0035);
  }
  const tt = t + 0.033;
  p.setValueAtTime(v, tt);
  p.setTargetAtTime(0, tt + 0.0005, 0.065);
  const n = noise(G, t, tt + 0.5, [bp, g]);
  n.connect(bp).connect(g).connect(dest);
  const bg = gain(ac, 0);
  const o = osc(G, 'triangle', 220, t, perc(bg.gain, t, 0.45 * v, 0.001, 0.035), [bg]);
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(165, t + 0.08);
  o.connect(bg).connect(dest);
}

/** Hi-hat: noise into the channel's high-pass; open hats ring longer. */
export function hat(G, dest, t, v, open = false) {
  const g = gain(G.ac, 0);
  const n = noise(G, t, perc(g.gain, t, v, 0.001, open ? 0.11 : 0.016), [g]);
  n.connect(g).connect(dest);
}

/** Shaker: a soft swelling noise grain into the channel's band-pass. */
export function shaker(G, dest, t, v) {
  const g = gain(G.ac, 0);
  const p = g.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(v, t + 0.014);
  p.setTargetAtTime(0, t + 0.014, 0.022);
  const n = noise(G, t, t + 0.2, [g]);
  n.connect(g).connect(dest);
}

/** Light wooden percussion (rim / block) for the quiet sections. */
export function rim(G, dest, t, v, hz = 1700) {
  const ac = G.ac;
  const g = gain(ac, 0);
  const end = perc(g.gain, t, v, 0.0008, 0.018);
  const o = osc(G, 'sine', hz, t, end, [g]);
  o.frequency.setValueAtTime(hz, t);
  o.frequency.exponentialRampToValueAtTime(hz * 0.88, t + 0.05);
  const g2 = gain(ac, 0.6);
  const o2 = osc(G, 'triangle', hz * 0.265, t, end, [g2]);
  o2.connect(g2).connect(g);
  o.connect(g).connect(dest);
}

/** Crash cymbal: bright noise with a long tail (lives on the fx channel, mostly heard through the reverb). */
export function crash(G, dest, t, v = 1) {
  const ac = G.ac;
  const hp = filter(ac, 'highpass', 4200, 0.6);
  const pk = filter(ac, 'peaking', 7500, 1.2);
  pk.gain.value = 6;
  const g = gain(ac, 0);
  const end = perc(g.gain, t, v, 0.002, 0.6);
  const n = noise(G, t, end, [hp, pk, g]);
  n.connect(hp).connect(pk).connect(g).connect(dest);
}

/** Noise riser that sweeps up over `dur` and stops on the downbeat. */
export function riser(G, dest, t, dur, v = 1) {
  const ac = G.ac;
  const bp = filter(ac, 'bandpass', 400, 2.5);
  bp.frequency.setValueAtTime(350, t);
  bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
  const g = gain(ac, 0);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + dur);
  g.gain.setTargetAtTime(0, t + dur, 0.015);
  const n = noise(G, t, t + dur + 0.12, [bp, g]);
  n.connect(bp).connect(g).connect(dest);
}

/** A deep cinematic boom for big arrivals. */
export function boom(G, dest, t, v = 1) {
  const ac = G.ac;
  const g = gain(ac, 0);
  const end = perc(g.gain, t, v, 0.004, 0.5);
  const o = osc(G, 'sine', 110, t, end, [g]);
  o.frequency.setValueAtTime(115, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 1.2);
  o.connect(g).connect(dest);
  const lp = filter(ac, 'lowpass', 500, 0.7);
  const ng = gain(ac, 0);
  const n = noise(G, t, perc(ng.gain, t, 0.6 * v, 0.005, 0.25), [lp, ng]);
  n.connect(lp).connect(ng).connect(dest);
}

// ---- tonal instruments ------------------------------------------------------------------------------------------

/** Warm pad voice: two detuned saws (the channel low-pass and pump shape it). */
export function padNote(G, dest, t, dur, n, v, pan = 0) {
  const ac = G.ac;
  const f = mtof(n);
  const g = gain(ac, 0);
  const p = ac.createStereoPanner();
  p.pan.value = pan;
  const end = adsr(g.gain, t, v, { a: 0.3, d: 0.8, s: 0.8, r: 0.32, end: t + dur });
  const o1 = osc(G, 'sawtooth', f, t, end, [g, p]);
  const o2 = osc(G, 'sawtooth', f, t, end);
  o1.detune.value = -9;
  o2.detune.value = 9;
  o1.connect(g);
  o2.connect(g);
  g.connect(p).connect(dest);
}

/** Bright supersaw voice for the euphoric top layer: three saws spread ±16 cents. */
export function superNote(G, dest, t, dur, n, v, pan = 0) {
  const ac = G.ac;
  const f = mtof(n);
  const g = gain(ac, 0);
  const p = ac.createStereoPanner();
  p.pan.value = pan;
  const end = adsr(g.gain, t, v, { a: 0.06, d: 0.5, s: 0.7, r: 0.25, end: t + dur });
  const o1 = osc(G, 'sawtooth', f, t, end, [g, p]);
  const o2 = osc(G, 'sawtooth', f, t, end);
  const o3 = osc(G, 'sawtooth', f, t, end);
  o2.detune.value = -16;
  o3.detune.value = 16;
  o1.connect(g);
  o2.connect(g);
  o3.connect(g);
  g.connect(p).connect(dest);
}

/** Round FM bass: a sine carrier with a 1:1 modulator whose index drops after the attack ("bwom"). */
export function bassNote(G, dest, t, dur, n, v) {
  const ac = G.ac;
  const f = mtof(n);
  const g = gain(ac, 0);
  const mg = gain(ac, 0);
  const end = adsr(g.gain, t, v, { a: 0.006, d: 0.3, s: 0.78, r: 0.035, end: t + dur });
  mg.gain.setValueAtTime(f * 2.0 * v, t);
  mg.gain.setTargetAtTime(f * 0.55, t, 0.06);
  const car = osc(G, 'sine', f, t, end, [g, mg]);
  const mod = osc(G, 'sine', f, t, end);
  mod.connect(mg).connect(car.frequency);
  car.connect(g).connect(dest);
}

/** Soft electric piano (FM 1:1 with a decaying index, plus a quiet bell partial for the tine). */
export function keysNote(G, dest, t, dur, n, v, pan = 0) {
  const ac = G.ac;
  const f = mtof(n);
  const g = gain(ac, 0);
  const mg = gain(ac, 0);
  const p = ac.createStereoPanner();
  p.pan.value = pan;
  const end = adsr(g.gain, t, v, { a: 0.003, d: 0.55, s: 0.3, r: 0.18, end: t + dur });
  mg.gain.setValueAtTime(f * 1.6 * v, t);
  mg.gain.setTargetAtTime(f * 0.15, t, 0.22);
  const car = osc(G, 'sine', f, t, end, [g, mg, p]);
  const mod = osc(G, 'sine', f, t, end);
  mod.connect(mg).connect(car.frequency);
  car.connect(g).connect(p).connect(dest);
}

/** Pluck for arpeggios: a saw through a low-pass whose cutoff snaps shut. */
export function pluck(G, dest, t, n, v, bright = 1) {
  const ac = G.ac;
  const f = mtof(n);
  const lp = filter(ac, 'lowpass', 2000, 3.5);
  lp.frequency.setValueAtTime(f * 1.5 + 3200 * bright, t);
  lp.frequency.setTargetAtTime(f * 1.1 + 250, t, 0.05);
  const g = gain(ac, 0);
  const end = perc(g.gain, t, v, 0.002, 0.13);
  const o = osc(G, 'sawtooth', f, t, end, [lp, g]);
  o.connect(lp).connect(g).connect(dest);
}

/**
 * The lead: saw + square a few cents apart, with delayed vibrato and a short glide from the previous note when
 * the phrase is legato. `from` is the previous MIDI note or null.
 */
export function leadNote(G, dest, t, dur, n, v, from = null) {
  const ac = G.ac;
  const f = mtof(n);
  const g = gain(ac, 0);
  const sq = gain(ac, 0.4);
  const vg = gain(ac, 0);
  const end = adsr(g.gain, t, v, { a: 0.014, d: 0.3, s: 0.78, r: 0.06, end: t + dur });
  vg.gain.setValueAtTime(0, t);
  vg.gain.setValueAtTime(0, t + 0.16);
  vg.gain.linearRampToValueAtTime(13, t + 0.5);
  const o1 = osc(G, 'sawtooth', f, t, end, [g, sq, vg]);
  const o2 = osc(G, 'square', f, t, end);
  const lfo = osc(G, 'sine', 5.2, t, end);
  o1.detune.value = -6;
  o2.detune.value = 6;
  if (from != null && from !== n) {
    const f0 = mtof(from);
    for (const o of [o1, o2]) {
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    }
  }
  lfo.connect(vg);
  vg.connect(o1.detune);
  vg.connect(o2.detune);
  o1.connect(g);
  o2.connect(sq).connect(g);
  g.connect(dest);
}

/**
 * FM bell. ratio 2 → soft music box (melody at low energy), ratio 3.5 → glassy sparkle.
 * index is the modulation depth relative to the note frequency; decay is the amplitude time constant.
 */
export function bellNote(G, dest, t, n, v, { ratio = 3.5, index = 1.4, decay = 0.5, pan = 0 } = {}) {
  const ac = G.ac;
  const f = mtof(n);
  const g = gain(ac, 0);
  const mg = gain(ac, 0);
  const p = ac.createStereoPanner();
  p.pan.value = pan;
  const end = perc(g.gain, t, v, 0.002, decay);
  mg.gain.setValueAtTime(f * index, t);
  mg.gain.setTargetAtTime(f * index * 0.15, t, decay * 0.35);
  const car = osc(G, 'sine', f, t, end, [g, mg, p]);
  const mod = osc(G, 'sine', f * ratio, t, end);
  mod.connect(mg).connect(car.frequency);
  car.connect(g).connect(p).connect(dest);
}

/** A soft low sine pulse (tension layer heartbeat). */
export function pulse(G, dest, t, n, v) {
  const g = gain(G.ac, 0);
  const end = perc(g.gain, t, v, 0.01, 0.09);
  const o = osc(G, 'sine', mtof(n), t, end, [g]);
  o.connect(g).connect(dest);
}
