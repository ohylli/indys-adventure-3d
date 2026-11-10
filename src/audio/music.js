// The adaptive music engine: a step sequencer that plays the songs in songs.js on the synth voices in synth.js.
//
// One MusicPlayer is one playing song. It owns a set of mixer channels (one per layer: pad, bass, kick, lead ...)
// whose faders follow an "energy" value: for the climb that is the smoothed tower progress, so layers fade in as
// Indy gains altitude; the other songs use a fixed energy. The arrangement (chords, melody, groove) comes from
// phrases of 8 bars, picked from the current section's list; setSection() switches list on the next bar line.
//
// Timing: schedule(until, now) is a classic lookahead scheduler. It is called from the game's update() and from
// a timer (index.js), and queues every 16th-note step whose time falls before `until` on the AudioContext clock.
// If the caller stalls for longer than the lookahead, late steps are skipped (bookkeeping still advances) so the
// music never bunches up. The same code drives OfflineAudioContext renders (renderOffline in index.js).

import { gain, filter, clamp01 } from './graph.js';
import * as I from './synth.js';
import { STEPS, midi, pc, degSemi, parseProgression, parseMelody, voiceChord, isChordTone, snapToChord, rng, smoothstep as ss } from './theory.js';
import { SONGS, PROG, MEL, DRUMS, BASS, ARP, KEYS } from './songs.js';

const VEL = { X: 1, x: 0.78, o: 0.55, '.': 0.35 };
const SPARKLE = '--o---x---o--x-o'; // where the sparkle bells may twinkle (x likely, o sometimes)

const progCache = {}, melCache = {};
const getProg = (k) => (progCache[k] ||= parseProgression(PROG[k]));
const getMel = (k) => (melCache[k] ||= parseMelody(MEL[k]));

// Mixer channels. mix: fader level at full layer level. pump: sidechain amount (ducks on each kick).
// rev / dly: send levels to the shared reverb and delay. hp / lp / bp: channel filters (shared by all voices).
const CHANNELS = {
  kick: { mix: 0.38 },
  clap: { mix: 0.4, rev: 0.3 },
  hat: { mix: 0.4, hp: 7000, rev: 0.06, pan: 0.15 },
  shk: { mix: 0.3, bp: [6200, 1.1], rev: 0.08, pan: -0.25 },
  perc: { mix: 0.2, rev: 0.22, dly: 0.12, pan: 0.2 },
  bass: { mix: 0.22, lp: 1100, pump: 0.45 },
  pad: { mix: 0.085, lp: 1200, pump: 1, rev: 0.45 },
  lift: { mix: 0.045, hp: 260, lp: 7500, pump: 1, rev: 0.35, dly: 0.08 },
  keys: { mix: 0.2, lp: 5000, pump: 0.35, rev: 0.3, dly: 0.08 },
  arp: { mix: 0.13, hp: 300, pump: 0.8, rev: 0.25, dly: 0.35 },
  lead: { mix: 0.15, lp: 3200, rev: 0.28, dly: 0.22 },
  harmony: { mix: 0.08, lp: 2600, rev: 0.35, dly: 0.2, pan: -0.3 },
  melodySoft: { mix: 0.26, rev: 0.4, dly: 0.25 },
  echo: { mix: 0.15, hp: 500, rev: 0.5, dly: 0.4, pan: 0.25 },
  sparkle: { mix: 0.09, hp: 1500, rev: 0.5, dly: 0.35 },
  tick: { mix: 0.1, hp: 8000 },
  tension: { mix: 0.25 },
  fx: { mix: 0.2, rev: 0.6 },
};

function makeChannel(G, out, cfg) {
  const ac = G.ac;
  const ch = { cfg, input: gain(ac, 1), sends: [], last: -1 };
  let node = ch.input;
  const chain = (n) => { node.connect(n); node = n; return n; };
  if (cfg.hp) chain(filter(ac, 'highpass', cfg.hp));
  if (cfg.bp) chain(filter(ac, 'bandpass', cfg.bp[0], cfg.bp[1]));
  if (cfg.lp) ch.lp = chain(filter(ac, 'lowpass', cfg.lp, 0.8));
  if (cfg.pump) ch.pump = chain(gain(ac, 1));
  if (cfg.pan) {
    const p = ac.createStereoPanner();
    p.pan.value = cfg.pan;
    chain(p);
  }
  ch.fader = chain(gain(ac, 0));
  ch.fader.connect(out);
  for (const [k, bus] of [['rev', G.revIn], ['dly', G.dlyIn]]) {
    if (!cfg[k]) continue;
    const s = gain(ac, cfg[k]);
    ch.fader.connect(s).connect(bus);
    ch.sends.push(s);
  }
  return ch;
}

/** Chord tones from MIDI note `from` upwards: the note ladder that arpeggios and sparkles pick from. */
function ladder(key, chord, from, count) {
  const pcs = new Set(chord.tones.map((t) => pc(key, t)));
  const out = [];
  for (let n = from; out.length < count; n++) if (pcs.has(n % 12)) out.push(n);
  return out;
}

/** Bass notes live between B1 and B2 so every key sits in the same register. */
function bassMidi(key, deg) {
  let n = midi(key, deg, 2);
  while (n > 47) n -= 12;
  while (n < 35) n += 12;
  return n;
}

/** The long notes of a melody bar: whatever sounds on beats 1 and 3, held for two beats. */
function skeleton(bar) {
  const out = [];
  for (const s0 of [0, 8]) {
    const ev = bar.find((e) => e.step <= s0 && s0 < e.step + e.len);
    if (ev) out.push({ step: s0, len: 8, deg: ev.deg });
  }
  return out;
}

function parseBass(str) {
  const out = [];
  for (let s = 0; s < STEPS; s++) {
    const c = str[s];
    if (c === '.' || c === '-') continue;
    let len = 1;
    while (s + len < STEPS && str[s + len] === '.') len++;
    out.push({ step: s, len, kind: c });
  }
  return out;
}
const bassCache = {};
const getBass = (style) => (bassCache[style] ||= parseBass(BASS[style]));

export const SONG_NAMES = Object.keys(SONGS);

export class MusicPlayer {
  /** opts: { progress, section, tension, seed } */
  constructor(G, name, opts = {}) {
    const def = SONGS[name];
    if (!def) throw new Error(`unknown song "${name}"`);
    this.G = G;
    this.name = name;
    this.def = def;
    this.bpm = def.bpm;
    this.stepDur = 60 / def.bpm / 4;
    this.out = gain(G.ac, 0);
    this.out.connect(G.musicIn);
    this.ch = {};
    for (const [k, cfg] of Object.entries(CHANNELS)) this.ch[k] = makeChannel(G, this.out, cfg);
    this.pumpChans = Object.values(this.ch).filter((c) => c.pump);

    this.progressTarget = this.progress = clamp01(opts.progress ?? 0);
    this.tensionTarget = this.tension = clamp01(opts.tension ?? 0);
    this.section = def.sections ? clampSection(opts.section ?? 0, def.sections.length) : 0;
    this.pendingSection = null;
    this.rand = rng(opts.seed ?? 0x1d1);

    this.phrase = null;
    this.phraseCount = 0; // phrases played in this song
    this.sectionPhrase = 0; // phrases played since the section last changed
    this.bar = 0;
    this.step = 0;
    this.nextTime = 0;
    this.voicing = null;
    this.lastLead = null;
    this.levels = {};
    this.lastCut = -1;
    this.pumpDepth = 0;
    this.stopAt = Infinity;
    this.log = opts.log ? [] : null; // tests: every pitched note with its harmonic context
  }

  /** Test hook: records a pitched note (only when constructed with { log: true }). */
  logNote(inst, n, extra) {
    if (!this.log) return;
    const ph = this.phrase;
    this.log.push({ inst, n, key: ph.key, chord: this.chord ? this.chord.tones.map((t) => pc(ph.key, t)) : null, chordBass: this.chord ? pc(ph.key, this.chord.bass) : null, ...extra });
  }

  get energy() { return this.def.energy ?? this.progress; }
  get sectionDef() { return this.def.sections ? this.def.sections[this.section] : this.def.section; }
  /** Seconds per bar. */
  get barDur() { return this.stepDur * STEPS; }

  start(t) {
    this.nextTime = t;
    this.lastNow = t;
    this.G.setTempo(this.bpm, t);
    const g = this.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + (this.def.fadeIn ?? 0.5));
    this.applyLevels(t, true);
  }

  /** Fades out over `fade` seconds; the owner calls dispose() once now > stopAt. */
  stop(now, fade = 1) {
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    this.stopAt = now + fade;
  }

  dispose() {
    this.out.disconnect();
    for (const c of Object.values(this.ch)) for (const s of c.sends) s.disconnect();
  }

  setProgress(p) { this.progressTarget = clamp01(+p || 0); }
  setTension(x) { this.tensionTarget = clamp01(+x || 0); }
  setSection(i) {
    if (!this.def.sections) return;
    i = clampSection(i, this.def.sections.length);
    this.pendingSection = i === this.section ? null : i;
  }

  /** Smooths progress/tension and moves the faders. Call every tick with the context time. */
  update(now) {
    const dt = Math.max(0, Math.min(1, now - this.lastNow));
    this.lastNow = now;
    if (this.def.sections) {
      const tau = this.progressTarget > this.progress ? 1.5 : 3;
      this.progress += (this.progressTarget - this.progress) * (1 - Math.exp(-dt / tau));
    }
    this.tension += (this.tensionTarget - this.tension) * (1 - Math.exp(-dt / 0.25));
    // faders move at most 10 times a second, so per-frame calls don't pile up automation events
    if (!(now - this.lastApply < 0.1)) {
      this.lastApply = now;
      this.applyLevels(now);
    }
  }

  /** Queues every step that starts before `until`. Steps already behind `now` are skipped silently. */
  schedule(until, now) {
    const stopBy = this.stopAt;
    while (this.nextTime < until && this.nextTime < stopBy) {
      if (this.step === 0) this.beginBar();
      this.playStep(this.step, this.nextTime, this.nextTime < now - 0.015);
      this.nextTime += this.stepDur;
      if (++this.step === STEPS) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  // ---- arrangement ---------------------------------------------------------------------------------------------

  computeLevels() {
    const e = this.energy;
    const L = {
      pad: 0.7 + 0.3 * ss(0.15, 0.9, e),
      keys: 0.85 - 0.3 * ss(0.55, 0.95, e),
      perc: 1 - 0.55 * ss(0.45, 0.8, e),
      shk: 0.75 + 0.25 * ss(0.3, 0.6, e),
      // the rhythm section enters softly and keeps growing towards the top
      bass: ss(0.1, 0.22, e) * (0.7 + 0.3 * ss(0.3, 0.9, e)),
      kick: ss(0.17, 0.27, e) * (0.6 + 0.4 * ss(0.3, 0.9, e)),
      clap: ss(0.24, 0.34, e) * (0.75 + 0.25 * ss(0.4, 0.9, e)),
      hat: ss(0.28, 0.38, e),
      arp: ss(0.3, 0.45, e),
      lead: ss(0.36, 0.48, e),
      melodySoft: 1 - ss(0.4, 0.54, e),
      sparkle: ss(0.52, 0.66, e),
      lift: ss(0.78, 0.92, e),
      harmony: ss(0.86, 0.97, e),
      echo: 1,
      fx: ss(0.3, 0.4, e),
      tick: this.tension,
      tension: this.tension,
    };
    if (this.def.levels) Object.assign(L, this.def.levels);
    if (this.phrase && this.phrase.spec.v === 'anthem') L.harmony = Math.max(L.harmony, L.lead);
    return L;
  }

  applyLevels(now, immediate = false) {
    const L = (this.levels = this.computeLevels());
    const e = this.energy;
    for (const k in this.ch) {
      const c = this.ch[k];
      const target = (L[k] ?? 0) * c.cfg.mix;
      if (immediate) c.fader.gain.setValueAtTime(target, now);
      else if (Math.abs(target - c.last) > 0.0015) c.fader.gain.setTargetAtTime(target, now, 0.3);
      c.last = target;
    }
    // the pad opens up with altitude and with danger; the lead gets brighter near the top
    const cut = 900 + 4000 * Math.pow(e, 1.4) + 2400 * this.tension;
    if (immediate || Math.abs(cut - this.lastCut) > 20) {
      const f = immediate ? (p, v) => p.setValueAtTime(v, now) : (p, v) => p.setTargetAtTime(v, now, 0.4);
      f(this.ch.pad.lp.frequency, cut);
      f(this.ch.lead.lp.frequency, 2300 + 2600 * e);
      f(this.ch.keys.lp.frequency, 2500 + 4000 * e);
      this.lastCut = cut;
    }
    this.pumpDepth = L.kick * (0.12 + 0.5 * ss(0.3, 0.95, e));
  }

  on(layer) { return (this.levels[layer] ?? 0) > 0.01; }

  newPhrase(changed) {
    const prev = this.phrase;
    const sec = this.sectionDef;
    let spec;
    if (this.def.intro && this.phraseCount === 0) spec = this.def.intro;
    else {
      const list = sec.phrases;
      const i = this.sectionPhrase++;
      spec = list[i % list.length];
      // on every second pass through the list, vary the melody so long stays don't loop verbatim
      const pass = Math.floor(i / list.length);
      if (pass % 2 === 1 && !spec.v && !spec.breakdown) spec = { ...spec, v: pass % 4 === 1 ? 'answer' : 'echo' };
    }
    const chords = getProg(spec.prog);
    this.phrase = {
      spec,
      key: sec.key,
      swing: sec.swing || 0,
      drums: DRUMS[spec.drums || sec.drums],
      bass: spec.bass || sec.bass,
      arp: ARP[spec.arp || sec.arp],
      keys: KEYS[spec.keys || sec.keys],
      chords,
      mel: getMel(spec.mel),
      nBars: chords.length,
      breakdown: !!spec.breakdown,
      stinger: !!spec.stinger,
      index: this.phraseCount++,
    };
    this.crashNext = changed || (prev && prev.breakdown) || this.phrase.stinger || this.phrase.index % 2 === 0;
    this.bar = 0;
    this.levels = this.computeLevels();
  }

  beginBar() {
    const changed = this.pendingSection != null;
    if (changed) {
      this.section = this.pendingSection;
      this.pendingSection = null;
      this.sectionPhrase = 0;
    }
    if (!this.phrase || this.bar >= this.phrase.nBars || changed) this.newPhrase(changed);
    const ph = this.phrase;
    const b = this.bar;
    this.segs = ph.chords[b % ph.chords.length];
    this.nextBassDeg = ph.chords[(b + 1) % ph.chords.length][0].chord.bass;
    let mel = ph.mel[b % ph.mel.length];
    if (ph.spec.v === 'answer' && b >= 4) mel = skeleton(mel);
    this.melAt = new Map(mel.map((ev) => [ev.step, ev]));
    this.echoBar = ph.spec.v === 'echo' && b % 2 === 1;
    this.lastBar = b === ph.nBars - 1;
    this.fillType = (ph.index + this.section) % 3;

    const e = this.energy;
    let style = ph.bass;
    if (ph.breakdown) style = b < 2 ? 'whole' : null;
    else if (ph.stinger) style = 'whole';
    else if (e < 0.3) style = 'whole';
    else if (e < 0.45 && style !== 'sub') style = 'half';
    this.bassEvents = style ? getBass(style) : [];
  }

  segAt(s) {
    for (const sg of this.segs) if (s >= sg.step && s < sg.step + sg.len) return sg;
    return this.segs[0];
  }

  // ---- one 16th step -------------------------------------------------------------------------------------------

  playStep(s, t, late) {
    const ph = this.phrase;
    for (const sg of this.segs) if (sg.step === s) this.playChord(sg, t, late);
    if (late) return;
    const G = this.G, ch = this.ch, e = this.energy;
    const stats = G.stats;
    const tt = t + (s % 2 === 1 ? ph.swing * this.stepDur : 0); // swung offbeats
    const hum = () => 0.9 + 0.1 * this.rand();
    const sg = this.segAt(s);
    const d = ph.drums;

    // fills: last beat(s) of a phrase, or right before a section change
    const fillBar = (this.lastBar && !ph.breakdown && !ph.stinger) || this.pendingSection != null;
    const filling = fillBar && this.on('clap') && s >= 12 && this.fillType !== 2;

    // ---- drums
    if (!ph.breakdown && !ph.stinger) {
      const kv = VEL[d.kick[s]];
      if (kv && this.on('kick') && (e >= 0.42 || s === 0 || s === 8) && !(filling && s > 12)) {
        I.kick(G, ch.kick.input, t, kv * hum());
        this.pump(t);
        stats.events++;
      }
      const cv = VEL[d.clap[s]];
      if (cv && this.on('clap') && cv >= (e < 0.7 ? 0.6 : 0.3) && !filling) {
        I.clap(G, ch.clap.input, tt, cv * hum());
        stats.events++;
      }
      const ov = VEL[d.ohat[s]];
      const open = ov && this.on('hat') && e >= 0.68 && !filling;
      if (open) {
        I.hat(G, ch.hat.input, tt, ov * 0.75, true);
        stats.events++;
      }
      const hv = VEL[d.hat[s]];
      if (hv && !open && this.on('hat') && hv >= (e < 0.5 ? 0.7 : e < 0.75 ? 0.5 : 0.3) && !filling) {
        I.hat(G, ch.hat.input, tt, hv * hum());
        stats.events++;
      }
    }
    if (!ph.stinger) {
      const sv = VEL[d.shk[s]];
      if (sv && this.on('shk')) {
        I.shaker(G, ch.shk.input, tt, sv * hum());
        stats.events++;
      }
      const pv = VEL[d.perc[s]];
      if (pv && this.on('perc')) {
        I.rim(G, ch.perc.input, tt, pv * hum(), s % 4 === 3 ? 1450 : 1750);
        stats.events++;
      }
    }

    // ---- fills, builds, crashes
    if (filling) {
      if (this.fillType === 0) I.clap(G, ch.clap.input, t, 0.35 + 0.15 * (s - 12));
      else I.tom(G, ch.kick.input, t, 0.5, [210, 180, 150, 125][s - 12]);
      stats.events++;
    }
    if (fillBar && this.fillType === 2 && this.on('clap') && (s === 10 || s === 14)) I.clap(G, ch.clap.input, t, 0.7);
    if (fillBar && s === 0 && this.on('fx') && e >= 0.6 && ph.index % 2 === 1) {
      I.riser(G, ch.fx.input, t, this.barDur, 0.5);
      stats.events++;
    }
    if (ph.breakdown && this.bar === ph.nBars - 1 && this.on('kick')) {
      // the build: claps in 8ths then 16ths, getting louder, into the drop
      if (s < 8 ? s % 2 === 0 : true) I.clap(G, ch.clap.input, t, 0.15 + 0.6 * (s / 15));
      if (s === 0) I.riser(G, ch.fx.input, t, this.barDur, 0.8);
      stats.events++;
    }
    if (s === 0 && this.bar === 0 && this.crashNext && e >= 0.35 && !ph.breakdown) {
      I.crash(G, ch.fx.input, t, ph.stinger ? 1 : 0.7);
      stats.events++;
    }
    if (ph.stinger) this.playStinger(s, t);

    // ---- bass
    if (this.on('bass')) {
      for (const ev of this.bassEvents) {
        if (ev.step !== s) continue;
        const root = bassMidi(ph.key, sg.chord.bass);
        let n = root;
        if (ev.kind === 'O') n = root + 12;
        else if (ev.kind === 'F') n = root + degSemi(sg.chord.bass + 4) - degSemi(sg.chord.bass);
        else if (ev.kind === 'A') {
          const target = bassMidi(ph.key, this.nextBassDeg);
          n = target - (degSemi(this.nextBassDeg) - degSemi(this.nextBassDeg - 1));
        }
        I.bassNote(G, ch.bass.input, tt, ev.len * this.stepDur * 0.92, n, ev.kind === 'A' ? 0.7 : 0.95);
        this.logNote('bass', n, { kind: ev.kind, chordBass: pc(ph.key, sg.chord.bass) });
        stats.events++;
      }
    }

    // ---- arpeggio
    const ac = ph.arp[s];
    if (ac && ac !== '-' && this.on('arp') && !(ph.stinger && this.bar === 0)) {
      const n = this.arpLadder[+ac % this.arpLadder.length];
      I.pluck(G, ch.arp.input, tt, n, (s % 4 === 0 ? 0.9 : 0.65) * hum(), 0.3 + 0.7 * e);
      this.logNote('arp', n);
      stats.events++;
    }

    // ---- electric piano comping
    const kc = ph.keys[s];
    if (kc && kc !== '-' && this.on('keys')) {
      let len = 1;
      while (s + len < STEPS && ph.keys[s + len] === '-' && len < 8) len++;
      const dur = len * this.stepDur;
      if (kc === 'C') {
        this.voicing.forEach((n, i) => I.keysNote(G, ch.keys.input, tt + i * 0.004, dur, n, 0.42, i % 2 ? 0.25 : -0.25));
        this.voicing.forEach((n) => this.logNote('keys', n));
      } else {
        const n = this.keysLadder[+kc % this.keysLadder.length];
        I.keysNote(G, ch.keys.input, tt, dur * 1.5, n, 0.5);
        this.logNote('keys', n);
      }
      stats.events++;
    }

    // ---- melody
    const mev = this.melAt.get(s);
    if (mev) this.playMelody(mev, tt, s, sg);

    // ---- sparkle bells
    const sc = SPARKLE[s];
    if (sc !== '-' && this.on('sparkle') && !ph.stinger) {
      const p = (sc === 'x' ? 0.6 : 0.3) * (0.5 + 0.5 * e);
      if (this.rand() < p) {
        const n = this.sparkLadder[Math.floor(this.rand() * 6)];
        I.bellNote(G, ch.sparkle.input, tt, n, 0.5, { ratio: 3.5, index: 1.1, decay: 0.3, pan: this.rand() * 1.2 - 0.6 });
        this.logNote('sparkle', n);
        stats.events++;
      }
    }

    // ---- tension: 16th ticks and a heartbeat on the root
    if (this.on('tension')) {
      I.hat(G, ch.tick.input, tt, s % 4 === 0 ? 0.8 : s % 2 ? 0.35 : 0.55);
      if (s % 4 === 0) I.pulse(G, ch.tension.input, t, bassMidi(ph.key, sg.chord.root), 0.9);
      stats.events++;
    }
  }

  playChord(sg, t, late) {
    const ph = this.phrase;
    const key = ph.key;
    this.chord = sg.chord;
    this.voicing = voiceChord(key, sg.chord, this.voicing, 55, 76);
    this.arpLadder = ladder(key, sg.chord, 64, 8);
    this.keysLadder = ladder(key, sg.chord, 57, 6);
    this.sparkLadder = ladder(key, sg.chord, 79, 12);
    if (late) return;
    const G = this.G, ch = this.ch;
    const dur = sg.len * this.stepDur;
    if (this.on('pad')) {
      this.voicing.forEach((n, i) => I.padNote(G, ch.pad.input, t, dur, n, 0.5, i % 2 ? 0.4 : -0.4));
      this.voicing.forEach((n) => this.logNote('pad', n));
      G.stats.events++;
    }
    if (this.on('lift') && !(ph.breakdown && this.bar < 2)) {
      this.voicing.slice(-3).forEach((n, i) => I.superNote(G, ch.lift.input, t, dur, n + 12, 0.5, [-0.6, 0, 0.6][i]));
      G.stats.events++;
    }
  }

  playMelody(ev, t, s, sg) {
    const ph = this.phrase, G = this.G, ch = this.ch;
    let deg = ev.deg;
    // strong beats always sit on a chord tone (melodies are reused over other progressions in breakdowns)
    if ((s === 0 || s === 8) && !isChordTone(deg, sg.chord)) deg = snapToChord(deg, sg.chord);
    const n = midi(ph.key, deg, 5);
    const dur = ev.len * this.stepDur;
    const strong = s === 0 || s === 8;
    G.stats.events++;
    if (ph.breakdown) {
      // the melody floats on soft bells over the open pad
      I.bellNote(G, ch.echo.input, t, n, 0.7, { ratio: 2, index: 0.8, decay: Math.min(1.2, 0.3 + dur * 0.4) });
      this.logNote('melody', n, { strong });
      return;
    }
    if (this.echoBar) {
      // call and response: the lead rests, a bell answers an octave up
      I.bellNote(G, ch.echo.input, t, n + 12, 0.55, { ratio: 3.5, index: 0.9, decay: Math.min(0.8, 0.2 + dur * 0.3) });
      this.logNote('melody', n + 12, { strong });
      return;
    }
    const v = ph.spec.v;
    if (this.on('lead')) {
      const legato = this.lastLead && Math.abs(this.lastLead.end - t) < 0.03 ? this.lastLead.n : null;
      I.leadNote(G, ch.lead.input, t, dur * 0.96, n, 0.8, legato);
      if (v === 'oct' || v === 'anthem') I.leadNote(G, ch.lead.input, t, dur * 0.96, n - 12, 0.45, legato != null ? legato - 12 : null);
    }
    this.lastLead = { n, end: t + dur };
    this.logNote('melody', n, { strong });
    if (this.on('melodySoft')) {
      I.bellNote(G, ch.melodySoft.input, t, n, 0.7, { ratio: 2, index: 0.9, decay: Math.min(0.9, 0.25 + dur * 0.5) });
    }
    if (this.on('harmony') && ev.len >= 2) {
      // a diatonic third (or the nearest chord tone) below the melody
      let h = deg - 2;
      if ((s === 0 || s === 8) && !isChordTone(h, sg.chord)) {
        for (const c of [deg - 3, deg - 4, deg - 5]) if (isChordTone(c, sg.chord)) { h = c; break; }
      }
      I.leadNote(G, ch.harmony.input, t, dur * 0.96, midi(ph.key, h, 5), 0.7, null);
      this.logNote('harmony', midi(ph.key, h, 5), { strong });
    }
  }

  /** The claim arrival: boom + crash on the downbeat, a bell arpeggio shooting up, then a snare roll. */
  playStinger(s, t) {
    const G = this.G, ch = this.ch;
    if (this.bar === 0) {
      if (s === 0) {
        I.boom(G, ch.kick.input, t, 1);
        I.kick(G, ch.kick.input, t, 1);
      }
      if (s < 12) I.bellNote(G, ch.sparkle.input, t, this.sparkLadder[s] - 12, 0.7, { ratio: 3.5, index: 1, decay: 0.4, pan: (s / 6 - 1) * 0.6 });
    } else {
      if (s % 4 === 0) {
        I.kick(G, ch.kick.input, t, 0.9);
        this.pump(t);
      }
      if (s >= 8) I.clap(G, ch.clap.input, t, 0.3 + 0.07 * (s - 8));
      if (s === 0) I.riser(G, ch.fx.input, t, this.barDur, 0.7);
    }
    G.stats.events++;
  }

  /** Sidechain-style pumping: dips the pumped channels on each kick and lets them swell back. */
  pump(t) {
    const depth = this.pumpDepth;
    if (depth < 0.02) return;
    for (const c of this.pumpChans) {
      const p = c.pump.gain;
      p.setTargetAtTime(1 - depth * c.cfg.pump, t, 0.006);
      p.setTargetAtTime(1, t + 0.035, this.stepDur * 0.9);
    }
  }
}

function clampSection(i, n) {
  i = Math.round(+i || 0);
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}
