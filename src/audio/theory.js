// Music theory helpers: scale degrees, chords, voicing and the tiny text notations used in songs.js.
//
// Everything is written in scale degrees of a major key, so a song can change key by changing one number.
// Degrees are 0-based internally (0 = tonic, 4 = fifth, 7 = tonic an octave up, -3 = fifth below).
//
// Chord tokens (one per bar, or two per bar joined with '|'):
//   '1'..'7'   diatonic triad on that degree (quality follows the key: 1 4 5 major, 2 3 6 minor)
//   '7' suffix adds the diatonic seventh ('47' = IVmaj7, '27' = ii7, '57' = V7)
//   'a' suffix adds the ninth ('1a' = I add9), 's' makes it sus4 ('5s')
//   '/3' slash bass on another degree ('1/3' = I with the third in the bass)
//
// Melody notation: space separated 'degree:length' tokens, bars separated by '|'. Lengths in 16th notes and
// every bar must add up to 16. Degrees are 1-based like a musician would say them ('1' = tonic, '5' = fifth);
// each ' raises an octave, each , lowers one. 'r' is a rest.   e.g. "r:2 5,:2 1:2 2:2 3:4 5:4 | ..."

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const KEY = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
export const STEPS = 16; // 16th-note steps per 4/4 bar

/** Semitones above the tonic of scale degree d (any integer). */
export function degSemi(d) {
  const o = Math.floor(d / 7);
  return o * 12 + MAJOR[d - o * 7];
}

/** MIDI note of degree d in a key (pitch class 0..11) with the tonic in the given octave (C4 = 60). */
export function midi(key, d, octave) {
  return 12 * (octave + 1) + key + degSemi(d);
}

/** Pitch class (0..11) of a degree in a key. */
export const pc = (key, d) => (((key + degSemi(d)) % 12) + 12) % 12;

export function parseChord(tok) {
  const m = /^([1-7])(7)?(a)?(s)?(?:\/([1-7]))?$/.exec(tok);
  if (!m) throw new Error(`bad chord token "${tok}"`);
  const r = +m[1] - 1;
  const tones = [r, m[4] ? r + 3 : r + 2, r + 4];
  if (m[2]) tones.push(r + 6);
  if (m[3]) tones.push(r + 8);
  return { name: tok, root: r, tones, bass: m[5] ? +m[5] - 1 : r };
}

/** "1a 5 67 4a|5" → bars: [[{chord, step, len}], ...] */
export function parseProgression(str) {
  return str.trim().split(/\s+/).map((bar) => {
    const parts = bar.split('|');
    const len = STEPS / parts.length;
    return parts.map((tok, i) => ({ chord: parseChord(tok), step: i * len, len }));
  });
}

/** Melody text → bars: [[{step, len, deg}], ...] (rests dropped). */
export function parseMelody(str) {
  return str.split('|').map((bar, bi) => {
    const out = [];
    let step = 0;
    for (const tok of bar.trim().split(/\s+/)) {
      if (!tok) continue;
      const m = /^(r|[1-7])([',]*):(\d+)$/.exec(tok);
      if (!m) throw new Error(`bad melody token "${tok}" in bar ${bi + 1}`);
      const len = +m[3];
      if (m[1] !== 'r') {
        let d = +m[1] - 1;
        for (const c of m[2]) d += c === "'" ? 7 : -7;
        out.push({ step, len, deg: d });
      }
      step += len;
    }
    if (step !== STEPS) throw new Error(`melody bar ${bi + 1} has ${step} steps: "${bar.trim()}"`);
    return out;
  });
}

export function isChordTone(d, chord) {
  return chord.tones.some((t) => (((d - t) % 7) + 7) % 7 === 0);
}

/** The nearest chord tone to degree d (ties go down, which sounds more settled). */
export function snapToChord(d, chord) {
  for (let k = 0; k < 4; k++) {
    if (isChordTone(d - k, chord)) return d - k;
    if (isChordTone(d + k, chord)) return d + k;
  }
  return d;
}

/** Chord tones as MIDI notes in a close voicing between lo and hi, voice-led from `prev` when given. */
export function voiceChord(key, chord, prev, lo = 55, hi = 77, center = 64) {
  // pitch classes in ascending order above the root, so rotations are the close-position inversions
  const root = pc(key, chord.root);
  const pcs = [...new Set(chord.tones.map((t) => pc(key, t)))].sort((a, b) => ((a - root + 12) % 12) - ((b - root + 12) % 12));
  const cands = [];
  for (let r = 0; r < pcs.length; r++) {
    const v = [];
    let n = lo + ((pcs[r] - lo) % 12 + 12) % 12;
    v.push(n);
    for (let i = 1; i < pcs.length; i++) {
      const p = pcs[(r + i) % pcs.length];
      n = n + 1 + ((p - (n + 1)) % 12 + 12) % 12;
      v.push(n);
    }
    if (v[v.length - 1] <= hi) cands.push(v);
    // the same inversion an octave up, if it still fits
    const up = v.map((x) => x + 12);
    if (up[up.length - 1] <= hi) cands.push(up);
  }
  if (!cands.length) return pcs.map((p) => lo + ((p - lo) % 12 + 12) % 12).sort((a, b) => a - b);
  const cost = (v) => {
    if (!prev || !prev.length) return Math.abs(v.reduce((s, x) => s + x, 0) / v.length - center);
    // each new note's distance to the nearest old note, plus a pull to the centre so voicings don't drift
    let c = 0;
    for (const x of v) c += Math.min(...prev.map((y) => Math.abs(x - y)));
    return c + 0.3 * Math.abs(v.reduce((s, x) => s + x, 0) / v.length - center);
  };
  cands.sort((a, b) => cost(a) - cost(b));
  return cands[0];
}

/** A small seeded PRNG (mulberry32) so arrangements are repeatable. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
