// Audio for Indy's Adventure 3D. Everything is synthesized with Web Audio: no audio files.
// This file is the public API the game calls. Keep these names and signatures.
//
//   import { audio } from './audio/index.js';
//
//   audio.unlock()                 Call from a user gesture (click / key / touch). Creates/resumes the AudioContext.
//                                  Safe to call many times. Everything else is a silent no-op before this.
//   audio.update(dt)               Once per frame (scheduler tick, smoothing of intensity changes).
//
//   Music (adaptive, modern electronic; layers build as Indy gains altitude):
//   audio.setMusic(name)           'none' | 'title' | 'climb' | 'claim' | 'results'. Crossfades. Same name = no-op.
//                                    title:   warm, inviting loop for the title screen
//                                    climb:   the stage track, driven by setProgress/setSection
//                                    claim:   triumphant arrival stinger that flows into a celebratory loop (fireworks)
//                                    results: relaxed after-party loop
//   audio.setProgress(p)           0..1 how far up the tower Indy is. Adds layers/energy smoothly as it rises.
//   audio.setSection(i)            0..8 index of the stage section (see SECTIONS below). May change the arrangement,
//                                  key or pattern on the next bar boundary.
//   audio.setTension(x)            0..1 momentary danger (gull diving, wind gust). Optional subtle filter/percussion lift.
//   audio.duck(amount, seconds)    Briefly lower the music (0..1) e.g. for the checkpoint jingle.
//
//   Sound effects:
//   audio.sfx(name, opts?)         One-shots. opts: { volume = 1, pitch = 1, pan = 0 (-1..1) }.
//     movement:   'jump', 'pounce', 'land', 'step', 'climb', 'bounce' (trampoline/balloon), 'vault'
//     pickups:    'treat' (rising pitch if collected in quick succession: pass opts.pitch), 'heart', 'charm', 'checkpoint'
//     harm:       'hurt', 'splash', 'fall' (whoosh when falling off), 'respawn'
//     creatures:  'gull' (cry), 'jackdaw' (chak), 'flap' (wings scatter), 'pigeon' (coo)
//     world:      'pop' (balloon), 'honk' (coaster car horn), 'coaster' (short rattle pass-by), 'ride_ding',
//                 'drop_whoosh', 'wind' (gust, about 1.5 s), 'firework_launch', 'firework_burst', 'spark',
//                 'aww' (a visitor cooing at the cat: wordless vocal-ish "aww")
//     ui:         'ui_move', 'ui_select', 'ui_back', 'pause', 'unpause'
//   audio.meow(kind)               The cat's synthesized voice: 'meow' | 'chirp' (small jump trill) | 'hurt' (yowl) |
//                                  'happy' (mrrp) | 'purr' (about 3 s, for the ending). Port/improve the formant
//                                  synth from ../indys-adventure/js/audio.js.
//   audio.loop(name, on, opts?)    Looping ambiences that fade in/out: 'wind_high' (altitude wind bed; opts.volume
//                                  0..1 can be updated every frame), 'crowd' (festival murmur at the plaza).
//
//   Mixing:
//   audio.setMuted(bool), audio.muted
//   audio.setVolumes({ music, sfx })   0..1 each
//
//   Testing:
//   audio.renderOffline(what, seconds)  -> Promise<AudioBuffer>; what = { music: 'climb', progress: 0.5, section: 3 }
//                                        or { sfx: 'jump' } or { meow: 'meow' }. Used by automated checks.
//
// ---- implementation notes (for whoever tunes this) -------------------------------------------------------------
// Files: graph.js (buses, reverb, delay, limiter, node helpers), theory.js (keys, chords, notation), songs.js (all
// the music as data), music.js (the sequencer), synth.js (instruments), sfx.js, voice.js (meows), ambience.js.
// Calling conventions:
//   - setProgress / setTension / loop(..., {volume}) are cheap and may be called every frame; values are smoothed
//     (progress: ~1.5 s rising, ~3 s falling) and faders only move when the value changes noticeably.
//   - setSection takes effect on the next bar line (≤ 2.2 s at 108 BPM, plus the 0.18 s lookahead); calling it every
//     frame with the same value is free. A short drum fill plays into the change when there is time.
//   - The scheduler runs from update() and from a 25 ms timer, so it keeps time when frames drop. The context is
//     suspended while the tab is hidden and resumed when it is shown.
//   - meow('meow' | 'happy' | 'hurt') dips the music by ~4 dB for the length of the call so Indy is always heard;
//     'chirp' (cheap enough for every jump) and 'purr' don't. Effects are dropped while muted, and the same effect
//     re-triggered within 30 ms is ignored, so calling sfx('step') every footstep is fine.
//   - setMusic('claim') cuts the climb in 0.25 s and lands the fanfare downbeat ~50 ms later: call it at the moment
//     Indy reaches the top. Other switches crossfade over ~1.2 s.
//   - renderOffline extras: progress may be [from, to] (a ramp over the render), section may be 'auto'
//     (follows progress), tension, seed, stopAfter (s: fade the song out there), log (records every pitched note
//     in buf.log), opts for sfx/meow, and { loop: 'wind_high', opts: { volume } }. The buffer gets a .stats object
//     { started, ended, maxLive, events, liveTrace }. Offline renders always use the default volumes, unmuted.
//   - audio._debug exposes the live context, graph and player for the dev sandbox and tests.

import { createGraph, volumeToGain, DEFAULT_VOLUMES, clamp01 } from './graph.js';
import { MusicPlayer, SONG_NAMES } from './music.js';
import { playSfx, SFX_NAMES } from './sfx.js';
import { meowVoice, MEOW_KINDS } from './voice.js';
import { Ambience, LOOP_NAMES } from './ambience.js';

export const SECTIONS = [
  'plaza',        // 0  Särkänniemi plaza at the foot of the tower
  'ferris',       // 1  Ferris wheel
  'coaster',      // 2  spiral coaster track
  'drop',         // 3  drop ride and nets
  'swinger',      // 4  wave swinger
  'festival',     // 5  balloons, banners, wind, gulls
  'underside',    // 6  lanterns under the pod
  'pod',          // 7  observation deck ledges and the revolving restaurant
  'antenna',      // 8  roof and mast
];

export { SFX_NAMES, MEOW_KINDS, LOOP_NAMES, SONG_NAMES };

const LOOKAHEAD = 0.18; // seconds of music queued ahead of the clock
const TIMER_MS = 25; // backup scheduler tick when frames are slow
const XFADE = { default: 1.2, claim: 0.25 }; // fade-out time of the old song when switching to ...
const MIN_REPEAT = 0.03; // the same sfx within 30 ms is dropped (stacking only makes it louder)
const MAX_LIVE = 260; // above this many sounding voices, new effects are dropped

let ctx = null;
let G = null;
let player = null;
const fading = [];
const loops = new Map(); // name → Ambience
const lastSfx = new Map();
let timer = null;

const state = {
  music: 'none',
  progress: 0,
  section: 0,
  tension: 0,
  muted: false,
  volumes: { ...DEFAULT_VOLUMES },
  loops: new Map(), // name → { on, volume } (remembered before unlock)
};

function running() {
  return !!ctx && ctx.state === 'running';
}

function applyMix(immediate = false) {
  if (!G) return;
  const t = ctx.currentTime;
  const set = (p, v) => (immediate ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.04));
  set(G.master.gain, state.muted ? 0 : 1);
  set(G.musicVol.gain, volumeToGain(state.volumes.music));
  set(G.sfxVol.gain, volumeToGain(state.volumes.sfx));
}

function startSong(name) {
  player = new MusicPlayer(G, name, {
    progress: state.progress, section: state.section, tension: state.tension, seed: (Math.random() * 1e9) | 0,
  });
  const t = ctx.currentTime + 0.05;
  player.start(t);
  player.schedule(t + LOOKAHEAD, ctx.currentTime);
}

function syncLoops() {
  for (const [name, s] of state.loops) {
    let a = loops.get(name);
    if (!a && s.on) loops.set(name, (a = new Ambience(G, name)));
    if (a) a.set(s.on, s.volume);
  }
}

function tick() {
  if (!running()) return;
  const now = ctx.currentTime;
  if (player) {
    player.update(now);
    player.schedule(now + LOOKAHEAD, now);
  }
  for (let i = fading.length - 1; i >= 0; i--) {
    const f = fading[i];
    f.schedule(now + LOOKAHEAD, now);
    if (now > f.stopAt + 0.1) {
      f.dispose();
      fading.splice(i, 1);
    }
  }
  for (const [name, a] of loops) if (a.finished(now)) loops.delete(name);
}

function onVisibility() {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else ctx.resume().catch(() => {});
}

export const audio = {
  get muted() { return state.muted; },
  set muted(b) { this.setMuted(b); },

  unlock() {
    if (ctx) {
      if (ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) ctx.resume().catch(() => {});
      return;
    }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      ctx = null;
      return;
    }
    G = createGraph(ctx);
    applyMix(true);
    if (state.music !== 'none') startSong(state.music);
    syncLoops();
    timer = setInterval(tick, TIMER_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  },

  update() {
    tick();
  },

  setMusic(name) {
    if (name == null) name = 'none';
    if (name === state.music) return;
    if (name !== 'none' && !SONG_NAMES.includes(name)) {
      console.warn(`audio.setMusic: unknown song "${name}"`);
      return;
    }
    state.music = name;
    if (!G) return;
    if (player) {
      player.stop(ctx.currentTime, XFADE[name] ?? XFADE.default);
      fading.push(player);
      player = null;
    }
    if (name !== 'none') startSong(name);
  },

  setProgress(p) {
    state.progress = clamp01(+p || 0);
    if (player) player.setProgress(state.progress);
  },

  setSection(i) {
    state.section = Math.max(0, Math.min(SECTIONS.length - 1, Math.round(+i || 0)));
    if (player) player.setSection(state.section);
  },

  setTension(x) {
    state.tension = clamp01(+x || 0);
    if (player) player.setTension(state.tension);
  },

  duck(amount = 0.5, seconds = 1) {
    if (!G) return;
    const p = G.musicDuck.gain;
    const t = ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(1 - clamp01(amount), t, 0.04);
    p.setTargetAtTime(1, t + Math.max(0, seconds), 0.3);
  },

  sfx(name, opts = {}) {
    if (!running() || state.muted) return;
    const now = ctx.currentTime;
    const last = lastSfx.get(name);
    if (last != null && now - last < MIN_REPEAT) return;
    if (G.stats.live > MAX_LIVE) return;
    lastSfx.set(name, now);
    if (!playSfx(G, name, opts, now + 0.005)) console.warn(`audio.sfx: unknown effect "${name}"`);
  },

  meow(kind = 'meow', opts = {}) {
    if (!running() || state.muted) return;
    if (!MEOW_KINDS.includes(kind)) {
      console.warn(`audio.meow: unknown kind "${kind}"`);
      return;
    }
    meowVoice(G, kind, ctx.currentTime + 0.01, opts);
  },

  loop(name, on, opts = {}) {
    if (!LOOP_NAMES.includes(name)) {
      console.warn(`audio.loop: unknown loop "${name}"`);
      return;
    }
    const prev = state.loops.get(name);
    const volume = opts.volume ?? prev?.volume ?? 1;
    state.loops.set(name, { on: !!on, volume });
    if (!G) return;
    let a = loops.get(name);
    if (!a && on) loops.set(name, (a = new Ambience(G, name)));
    if (a) a.set(!!on, volume);
  },

  setMuted(b) {
    state.muted = !!b;
    applyMix();
  },

  setVolumes({ music, sfx } = {}) {
    if (music != null) state.volumes.music = clamp01(+music);
    if (sfx != null) state.volumes.sfx = clamp01(+sfx);
    applyMix();
  },

  async renderOffline(what = {}, seconds = 4) {
    const rate = 44100;
    const ac = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const g = createGraph(ac);
    const t0 = 0.02;
    const liveTrace = [];
    let player0 = null;
    const every = (fn, step = 0.25) => {
      for (let t = step; t < seconds - 0.01; t += step) {
        ac.suspend(t).then(() => { fn(t); ac.resume(); });
      }
    };
    if (what.music) {
      const ramp = Array.isArray(what.progress) ? what.progress : null;
      const progressAt = (t) => (ramp ? ramp[0] + (ramp[1] - ramp[0]) * Math.min(1, t / seconds) : clamp01(what.progress ?? 0));
      const sectionAt = (t) => (what.section === 'auto' ? Math.min(8, Math.floor(progressAt(t) * 9)) : what.section ?? 0);
      const pl = new MusicPlayer(g, what.music, { progress: progressAt(0), section: sectionAt(0), tension: what.tension ?? 0, seed: what.seed ?? 1, log: what.log });
      player0 = pl;
      pl.start(t0);
      pl.schedule(t0 + 0.4, 0);
      every((t) => {
        liveTrace.push(g.stats.started - g.stats.ended);
        if (what.stopAfter != null && t >= what.stopAfter && pl.stopAt === Infinity) pl.stop(t, 0.5);
        pl.setProgress(progressAt(t));
        pl.setSection(sectionAt(t));
        pl.update(t);
        pl.schedule(t + 0.4, t);
      });
    } else if (what.sfx) {
      if (!playSfx(g, what.sfx, what.opts || {}, t0)) throw new Error(`unknown sfx "${what.sfx}"`);
    } else if (what.meow) {
      if (!MEOW_KINDS.includes(what.meow)) throw new Error(`unknown meow "${what.meow}"`);
      meowVoice(g, what.meow, t0, what.opts || {});
    } else if (what.loop) {
      const a = new Ambience(g, what.loop);
      a.set(true, what.opts?.volume ?? 1);
    } else {
      throw new Error('renderOffline: nothing to render');
    }
    const buf = await ac.startRendering();
    const s = g.stats;
    buf.stats = { started: s.started, ended: s.ended, maxLive: s.maxLive, events: s.events, liveTrace };
    if (player0 && player0.log) buf.log = player0.log;
    return buf;
  },

  /** For the dev sandbox and tests. */
  _debug: {
    get ctx() { return ctx; },
    get graph() { return G; },
    get player() { return player; },
    get state() { return state; },
    get loops() { return loops; },
    get fading() { return fading.length; },
  },
};
