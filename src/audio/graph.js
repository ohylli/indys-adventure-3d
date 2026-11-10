// The mixing graph shared by music, sound effects, the cat voice and the ambience loops.
// createGraph(ac) builds it on the live AudioContext once, and on a fresh OfflineAudioContext for every
// renderOffline() call, so tests hear exactly the same chain the game does.
//
//   music instruments ─► (per-song channels) ─► musicIn ─► glue comp ─► duck ─► voiceDuck ─► musicVol ─┐
//          sends ─► reverb (convolver, generated IR) ─► glue comp                                       │
//          sends ─► ping-pong delay (tempo synced)   ─► glue comp                                       ├─► master (mute)
//   voice ─► voice comp ─┐                                                                              │   ─► DC block
//   sfx / loops ─────────┴► sfxIn ─► sfxVol ────────────────────────────────────────────────────────────┤   ─► limiter
//          sends ─► short reverb ─► sfxVol ─────────────────────────────────────────────────────────────┘   ─► soft clip
//                                                                                                            ─► destination
// voiceDuck dips the music by a few dB while Indy meows, so the cat is always heard.
//
// Every one-shot source (oscillator / noise player) goes through track(), which counts it and disconnects its
// nodes when it ends. G.stats.live is therefore the number of sounding voices, used by tests to prove that the
// node count stays bounded.

export const DEFAULT_VOLUMES = { music: 0.8, sfx: 0.9 };

/** Slider value 0..1 → gain. Squared for a perceptual taper; the default 0.8 maps to ~0.96. */
export const volumeToGain = (v) => 1.5 * Math.pow(Math.min(1, Math.max(0, v)), 2);

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createGraph(ac) {
  const G = {
    ac,
    stats: { started: 0, ended: 0, events: 0, maxLive: 0, get live() { return this.started - this.ended; } },
  };
  G.noise = makeNoiseBuffer(ac, 2.5);

  // ---- master: mute gain → limiter → soft clip → out (+ analyser tap for meters)
  G.master = gain(ac, 1);
  // DC blocker: 1:1 FM (bass, e-piano) has a sideband at 0 Hz, and DC would only eat limiter headroom
  const dcBlock = filter(ac, 'highpass', 18, 0.7);
  G.limiter = ac.createDynamicsCompressor();
  setComp(G.limiter, { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.12 });
  G.clip = ac.createWaveShaper();
  G.clip.curve = softClipCurve(0.8, 0.98);
  G.master.connect(dcBlock).connect(G.limiter).connect(G.clip).connect(ac.destination);
  G.analyser = ac.createAnalyser();
  G.analyser.fftSize = 2048;
  G.clip.connect(G.analyser);

  // ---- music bus
  G.musicVol = gain(ac, volumeToGain(DEFAULT_VOLUMES.music));
  G.musicDuck = gain(ac, 1); // audio.duck()
  G.voiceDuck = gain(ac, 1); // dips automatically while Indy meows
  G.musicGlue = ac.createDynamicsCompressor();
  setComp(G.musicGlue, { threshold: -12, knee: 8, ratio: 2, attack: 0.015, release: 0.22 });
  G.musicIn = gain(ac, 0.75); // overall music level: full arrangement ≈ −14 dBFS RMS at the default volume
  G.musicIn.connect(G.musicGlue).connect(G.musicDuck).connect(G.voiceDuck).connect(G.musicVol).connect(G.master);

  // reverb: a warm hall (2.6 s), high-passed on the way in so the low end stays clean
  G.revIn = gain(ac, 1);
  const revHp = ac.createBiquadFilter();
  revHp.type = 'highpass';
  revHp.frequency.value = 220;
  G.reverb = ac.createConvolver();
  G.reverb.buffer = makeImpulse(ac, 2.6, 0.018, 7000, 1800);
  G.revOut = gain(ac, 0.9);
  G.revIn.connect(revHp).connect(G.reverb).connect(G.revOut).connect(G.musicGlue);

  // ping-pong delay, dotted eighths; G.setTempo() keeps it in sync with the song
  G.dlyIn = gain(ac, 1);
  G.dlyA = ac.createDelay(2);
  G.dlyB = ac.createDelay(2);
  const fbFilt = ac.createBiquadFilter();
  fbFilt.type = 'lowpass';
  fbFilt.frequency.value = 3400;
  const fbHp = ac.createBiquadFilter();
  fbHp.type = 'highpass';
  fbHp.frequency.value = 280;
  const fbA = gain(ac, 0.42), fbB = gain(ac, 0.42);
  const panA = ac.createStereoPanner(), panB = ac.createStereoPanner();
  panA.pan.value = -0.55;
  panB.pan.value = 0.55;
  G.dlyOut = gain(ac, 0.8);
  G.dlyIn.connect(fbHp).connect(G.dlyA);
  G.dlyA.connect(fbFilt).connect(fbA).connect(G.dlyB);
  G.dlyB.connect(fbB).connect(G.dlyA);
  G.dlyA.connect(panA).connect(G.dlyOut);
  G.dlyB.connect(panB).connect(G.dlyOut);
  G.dlyOut.connect(G.musicGlue);
  const dlyToRev = gain(ac, 0.25);
  G.dlyOut.connect(dlyToRev).connect(G.revIn);
  G.setTempo = (bpm, when = ac.currentTime) => {
    const d = (60 / bpm) * 0.75;
    G.dlyA.delayTime.setTargetAtTime(d, when, 0.05);
    G.dlyB.delayTime.setTargetAtTime(d, when, 0.05);
  };
  G.setTempo(108, 0);

  // ---- sfx bus (sound effects, the cat voice, ambience loops)
  G.sfxVol = gain(ac, volumeToGain(DEFAULT_VOLUMES.sfx));
  G.sfxIn = gain(ac, 1);
  G.sfxIn.connect(G.sfxVol).connect(G.master);
  G.sfxRevIn = gain(ac, 1);
  G.sfxReverb = ac.createConvolver();
  G.sfxReverb.buffer = makeImpulse(ac, 1.5, 0.01, 8000, 2500);
  G.sfxRevIn.connect(G.sfxReverb).connect(gain(ac, 0.8)).connect(G.sfxVol);

  // Indy's voice gets its own gentle compressor so it reads clearly over the music without peaking
  // (a compressor evens loud and soft calls; a soft saturator trims the formant ringing peaks that it is too slow for)
  G.voiceIn = gain(ac, 1);
  const vc = ac.createDynamicsCompressor();
  setComp(vc, { threshold: -16, knee: 6, ratio: 3, attack: 0.003, release: 0.12 });
  const sat = ac.createWaveShaper();
  sat.curve = softClipCurve(0.28, 0.5);
  sat.oversample = '2x';
  G.voiceIn.connect(vc).connect(sat).connect(G.sfxIn);

  return G;
}

// ---------------------------------------------------------------------------------------------------------------
// Small node helpers shared by the instruments, effects and voice.

export function gain(ac, v = 1) {
  // (constructor options set the starting value without a timeline event: assigning .value schedules one at
  // "now", and a setValueCurveAtTime that starts a hair before it then throws)
  return new GainNode(ac, { gain: v });
}

export function filter(ac, type, freq, Q = 0.707) {
  return new BiquadFilterNode(ac, { type, frequency: freq, Q });
}

function setComp(c, { threshold, knee, ratio, attack, release }) {
  c.threshold.value = threshold;
  c.knee.value = knee;
  c.ratio.value = ratio;
  c.attack.value = attack;
  c.release.value = release;
}

/** Registers a one-shot source: counts it and disconnects `nodes` (and the source) when it ends. */
export function track(G, src, nodes = []) {
  const s = G.stats;
  s.started++;
  const live = s.started - s.ended;
  if (live > s.maxLive) s.maxLive = live;
  src.onended = () => {
    s.ended++;
    try { src.disconnect(); } catch { /* already */ }
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* already */ }
    }
  };
  return src;
}

/** An oscillator that plays from t0 to t1 (tracked). */
export function osc(G, type, freq, t0, t1, nodes) {
  const o = type instanceof PeriodicWave
    ? new OscillatorNode(G.ac, { frequency: freq, periodicWave: type })
    : new OscillatorNode(G.ac, { frequency: freq, type });
  track(G, o, nodes);
  o.start(t0);
  o.stop(t1);
  return o;
}

/** White noise from t0 to t1, from a random point of the shared buffer (tracked). */
export function noise(G, t0, t1, nodes, rate = 1) {
  const s = G.ac.createBufferSource();
  s.buffer = G.noise;
  s.loop = true;
  s.playbackRate.value = rate;
  track(G, s, nodes);
  s.start(t0, Math.random() * (G.noise.duration - 0.1));
  s.stop(t1);
  return s;
}

/**
 * Attack / decay-to-sustain / release envelope on an AudioParam. Returns the time at which it is silent.
 *   a: attack s, d: decay time constant s, s: sustain 0..1, r: release time constant s, end: note-off time.
 * Exponential segments use setTargetAtTime; sources should stop at the returned time (≈ 6 time constants).
 */
export function adsr(param, t, peak, { a = 0.005, d = 0.1, s = 1, r = 0.05, end }) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (s < 1) param.setTargetAtTime(peak * s, t + a, d);
  const off = Math.max(end, t + a);
  param.setTargetAtTime(0, off, r);
  return off + r * 6;
}

/** Percussive envelope: fast attack, exponential decay with time constant tau. Returns the stop time. */
export function perc(param, t, peak, a, tau) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, tau);
  return t + a + tau * 7;
}

// ---------------------------------------------------------------------------------------------------------------
// Generated buffers and curves.

function makeNoiseBuffer(ac, seconds) {
  const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/**
 * Stereo reverb impulse: a few early reflections, then decorrelated noise with an exponential decay (−60 dB at
 * `seconds`) that also darkens over time (one-pole low-pass sweeping from brightHz to darkHz).
 */
function makeImpulse(ac, seconds, preDelay, brightHz, darkHz) {
  const sr = ac.sampleRate;
  const len = Math.ceil(sr * seconds);
  const b = ac.createBuffer(2, len, sr);
  const pre = Math.floor(preDelay * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const u = (i - pre) / (len - pre);
      const env = Math.exp(-6.9 * u) * (u < 0.01 ? u / 0.01 : 1);
      const fc = brightHz * Math.pow(darkHz / brightHz, u);
      const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env;
    }
    // early reflections
    for (let r = 0; r < 7; r++) {
      const at = pre + Math.floor((0.004 + Math.random() * 0.05) * sr);
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.05);
    }
  }
  return b;
}

/**
 * Linear up to `knee`, then a tanh curve approaching `ceiling`. On the master (0.8, 0.98) it is a last line of
 * defence after the limiter; on the voice bus it rounds off peaks.
 */
function softClipCurve(knee, ceiling) {
  const n = 4096;
  const c = new Float32Array(n);
  const room = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax < knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}
