// The music itself: chord progressions, melodies, groove patterns and the arrangement of every song.
// Pure data (plus a few tiny helpers), so it can be tuned without touching the engine in music.js.
// Notation is explained at the top of theory.js. All of it is in scale degrees, so any phrase works in any key.

import { KEY } from './theory.js';

// ---- chord progressions (one token per bar) ---------------------------------------------------------------------
export const PROG = {
  A: '1a 5 67 4a 1a 5 67 4a', //       I  V  vi7 IV   the warm pop loop
  B: '67 4a 1 5 67 4a 1 5s|5', //      vi IV I  V     the same chords from the relative minor: more drive
  C: '47 5 37 6 47 5 37 67', //        IV V  iii vi   "royal road": the most euphoric, for the top
  D: '27 57 1a 47 27 57 1a 47', //     ii V  I   IV   jazzy and laid back
  F: '1a 1/3 4a 5 1a 1/3 4a 5s|5', //  I  I/3 IV V    bouncy festival walk-up
  G: '47 37 27 1a 47 37 27 5s|5', //   IV iii ii I    floating, descending (lanterns)
  BRK: '47 47 67 5s|5', //             breakdown: 4 bars of space before the drop
  STING: '1a 4|5', //                  the claim fanfare (2 bars)
};

// ---- melodies (written over the progression with the same letter; strong beats land on chord tones) -------------
export const MEL = {
  // "Indy's theme": a rising four-note pickup that keeps climbing, answered by a settled fall
  A:
    'r:2 5,:2 1:2 2:2 3:4 5:4 | 5:3 3:3 2:6 r:4 | r:2 5,:2 1:2 2:2 3:4 6:4 | 6:4 5:4 4:4 2:4 |' +
    'r:2 5,:2 1:2 2:2 3:4 5:2 6:2 | 7:3 5:3 2:4 5:2 3:4 | 3:4 2:2 1:2 6,:4 1:4 | 6,:4 1:4 1:8',
  // the chorus hook: repeated notes, pushes up to the octave
  B:
    "6:3 6:3 7:2 1':4 6:4 | 6:3 5:3 4:6 r:4 | 3:3 3:3 2:2 3:4 5:4 | 2:6 1:2 7,:8 |" +
    "6:3 6:3 7:2 1':4 3':4 | 1':3 6:3 4:2 6:8 | 5:3 3:3 2:2 3:4 1:4 | 2:8 r:4 5,:4",
  // soaring top-of-the-tower line
  C:
    "4:2 6:2 1':6 6:2 5:4 | 5:2 7:2 2':6 7:2 5:4 | 3':4 2':2 1':2 7:4 5:4 | 6:6 5:2 6:8 |" +
    "4:2 6:2 1':6 6:2 1':4 | 2':2 1':2 7:4 2':4 3':4 | 3':6 2':2 7:4 5:4 | 6:12 r:4",
  // lazy, swingy
  D:
    "2:3 4:3 6:2 1':4 6:4 | 7:6 6:2 5:8 | 3:3 2:3 1:2 2:4 3:4 | 3:8 r:4 5,:2 6,:2 |" +
    "2:3 4:3 6:2 2':4 1':4 | 7:4 5:2 7:2 5:8 | 3:3 5:3 3:2 2:8 | 1:12 r:4",
  // bouncy
  F:
    "1':3 7:3 5:2 3:4 5:4 | 5:3 6:3 5:2 3:8 | 4:3 6:3 1':6 6:4 | 7:3 6:3 5:10 |" +
    "1':3 7:3 5:2 3:4 5:4 | 5:3 6:3 5:2 3:4 2:4 | 1:3 4:3 6:2 1':8 | 2':8 7:4 5:4",
  // slow and floating
  G: "3':8 1':8 | 7:8 5:8 | 6:8 4:8 | 3:12 r:4 | 6:4 5:4 1':8 | 7:4 1':4 3':8 | 2':8 1':4 6:4 | 2:8 5,:8",
  BRK: "6:8 3':8 | 1':8 6:8 | 3':8 6:8 | 5:8 7:8",
  STING: "1:2 3:2 5:2 1':10 | 6:4 1':4 2':8",
};

// ---- grooves ---------------------------------------------------------------------------------------------------
// Drums: one 16-step string per instrument. X = 1, x = 0.78, o = 0.55, . = 0.35 (ghost), - = nothing.
// Quiet notes are gated out at low energy, so the same pattern grows denser as Indy climbs (see music.js).
export const DRUMS = {
  soft: { kick: 'X-------X-o-----', clap: '----X-------X---', hat: '--x---x---x---x-', ohat: '----------------', shk: 'x.o.x.o.x.o.x.o.', perc: '---o--x----o-x--' },
  pop: { kick: 'X---x-o-X---x---', clap: '----X-------X--o', hat: 'o-x-o-x-o-x-o-x-', ohat: '--------------x-', shk: 'x.o.x.o.x.o.x.o.', perc: '------x-----o---' },
  drive: { kick: 'X---x---X---x-o-', clap: '----X-------X---', hat: 'x.x.x.x.x.x.x.x.', ohat: '--x---x---x---x-', shk: '----------------', perc: 'o--o--o---o--o--' },
  four: { kick: 'X---X---X---X---', clap: '----X-------X---', hat: 'o.x.o.x.o.x.o.x.', ohat: '--x---x---x---x-', shk: 'x.o.x.o.x.o.x.o.', perc: '-----------o--x-' },
  half: { kick: 'X---------x-----', clap: '--------X-------', hat: 'x-o-x-o-x-o-x-o-', ohat: '------x---------', shk: 'x.o.x.o.x.o.x.o.', perc: '---o-----o---o--' },
  chill: { kick: 'X------xX-----o-', clap: '----X-------X---', hat: 'x-o-x-o-x-o-x-o-', ohat: '----------------', shk: 'o.x.o.x.o.x.o.x.', perc: '--o----o--o---o-' },
};

// Bass: R root, O octave up, F fifth, A approach note into the next bar, . hold, - rest.
export const BASS = {
  whole: 'R...............',
  half: 'R.......R.......',
  pulse: 'R.....R...R.....',
  drive: 'R-R-R-O-R-R-R-OA',
  offbeat: '--R.--R.--R.--R.',
  syncop: 'R..R..R...R.O..A',
  chill: 'R.....R.-.R...-A',
  sub: 'R.......-.....R.',
};

// Arpeggios: digits index a ladder of chord tones going up from about E4; - is a rest.
export const ARP = {
  up8: '0-1-2-3-4-3-2-1-',
  ferris: '0-2-4-2-1-3-5-3-',
  gallop: '0-120-120-120-12',
  sixteen: '0123432101234321',
  swing3: '0--1--2--3--2--1',
  sparse: '0---2---4---2---',
};

// Electric piano comping: C = the whole chord, digits = single chord tones, - = rest.
export const KEYS = {
  gentle: 'C-----2---1-3---',
  comp: 'C-----C---C-----',
  stabs: '--C---C---C---C-',
  chill: 'C------C---C----',
};

// ---- songs -----------------------------------------------------------------------------------------------------
// A phrase spec: { prog, mel, v } plus optional groove overrides (drums, bass, arp, keys).
//   v: 'echo'   odd bars: the lead rests and a bell answers an octave up
//      'answer' bars 5–8 play only the long notes of the melody
//      'oct'    the lead is doubled an octave down
//      'anthem' 'oct' plus the harmony voice at full level
//   breakdown: true  drums and bass drop out, the melody floats on bells, then a build into the next phrase
const BREAKDOWN = { prog: 'BRK', mel: 'BRK', breakdown: true };

/** The stage track: one arrangement per section (SECTIONS in index.js). Layers come from progress (music.js). */
export const CLIMB_SECTIONS = [
  { // 0 plaza: golden afternoon, intimate
    key: KEY.D, drums: 'soft', bass: 'pulse', arp: 'up8', keys: 'gentle',
    phrases: [{ prog: 'A', mel: 'A' }, { prog: 'D', mel: 'D' }, { prog: 'A', mel: 'A', v: 'echo' }, { prog: 'G', mel: 'G' }],
  },
  { // 1 ferris wheel: rolling arpeggio
    key: KEY.D, drums: 'pop', bass: 'pulse', arp: 'ferris', keys: 'comp',
    phrases: [{ prog: 'A', mel: 'A' }, { prog: 'B', mel: 'B' }, { prog: 'A', mel: 'A', v: 'answer' }, { prog: 'F', mel: 'F' }],
  },
  { // 2 spiral coaster: driving
    key: KEY.D, drums: 'drive', bass: 'drive', arp: 'gallop', keys: 'stabs',
    phrases: [{ prog: 'B', mel: 'B' }, { prog: 'A', mel: 'A' }, BREAKDOWN, { prog: 'B', mel: 'B', v: 'oct' }, { prog: 'F', mel: 'F' }],
  },
  { // 3 drop ride: tension and release
    key: KEY.D, drums: 'pop', bass: 'syncop', arp: 'sixteen', keys: 'comp',
    phrases: [{ prog: 'B', mel: 'B' }, BREAKDOWN, { prog: 'C', mel: 'C' }, { prog: 'B', mel: 'B', v: 'echo' }],
  },
  { // 4 wave swinger: a lilting shuffle with a 3-against-4 arpeggio
    key: KEY.D, swing: 0.14, drums: 'pop', bass: 'syncop', arp: 'swing3', keys: 'comp',
    phrases: [{ prog: 'D', mel: 'D' }, { prog: 'A', mel: 'A' }, { prog: 'F', mel: 'F' }, { prog: 'D', mel: 'D', v: 'echo' }],
  },
  { // 5 festival: key lift to E, four on the floor
    key: KEY.E, drums: 'four', bass: 'offbeat', arp: 'up8', keys: 'stabs',
    phrases: [{ prog: 'F', mel: 'F' }, { prog: 'A', mel: 'A' }, { prog: 'C', mel: 'C' }, BREAKDOWN, { prog: 'F', mel: 'F', v: 'oct' }],
  },
  { // 6 underside: lanterns under the pod, half-time and dreamy
    key: KEY.E, drums: 'half', bass: 'sub', arp: 'sparse', keys: 'chill',
    phrases: [{ prog: 'G', mel: 'G' }, { prog: 'D', mel: 'D' }, { prog: 'G', mel: 'G', v: 'echo' }, { prog: 'B', mel: 'B' }],
  },
  { // 7 pod: the whole band
    key: KEY.E, drums: 'four', bass: 'offbeat', arp: 'sixteen', keys: 'stabs',
    phrases: [{ prog: 'C', mel: 'C' }, { prog: 'B', mel: 'B' }, BREAKDOWN, { prog: 'C', mel: 'C', v: 'oct' }, { prog: 'A', mel: 'A', v: 'oct' }],
  },
  { // 8 antenna: key lift to F, biggest and brightest
    key: KEY.F, drums: 'four', bass: 'offbeat', arp: 'ferris', keys: 'stabs',
    phrases: [{ prog: 'C', mel: 'C', v: 'anthem' }, { prog: 'A', mel: 'A', v: 'anthem' }, BREAKDOWN, { prog: 'F', mel: 'F', v: 'anthem' }, { prog: 'B', mel: 'B', v: 'anthem' }],
  },
];

/**
 * Song definitions. energy: fixed arrangement energy (climb uses progress instead). levels: per-layer overrides
 * (0..1) on top of what the energy gives. fadeIn: seconds.
 */
export const SONGS = {
  title: {
    bpm: 100, energy: 0.36, fadeIn: 1.2,
    levels: { lead: 0, melodySoft: 1, arp: 0.55, harmony: 0, lift: 0 },
    section: { key: KEY.D, drums: 'soft', bass: 'pulse', arp: 'up8', keys: 'gentle',
      phrases: [{ prog: 'A', mel: 'A' }, { prog: 'D', mel: 'D' }, { prog: 'G', mel: 'G' }, { prog: 'A', mel: 'A', v: 'echo' }] },
  },
  climb: { bpm: 108, fadeIn: 0.8, sections: CLIMB_SECTIONS },
  claim: {
    bpm: 116, energy: 1, fadeIn: 0.005,
    levels: { harmony: 1 },
    intro: { prog: 'STING', mel: 'STING', stinger: true },
    section: { key: KEY.F, drums: 'four', bass: 'offbeat', arp: 'ferris', keys: 'stabs',
      phrases: [{ prog: 'C', mel: 'C', v: 'anthem' }, { prog: 'A', mel: 'A', v: 'anthem' }, { prog: 'F', mel: 'F', v: 'anthem' }, BREAKDOWN, { prog: 'B', mel: 'B', v: 'anthem' }] },
  },
  results: {
    bpm: 96, energy: 0.5, fadeIn: 1.5,
    levels: { lead: 0, melodySoft: 0.9, arp: 0.35, lift: 0, harmony: 0, sparkle: 0.5 },
    section: { key: KEY.F, swing: 0.12, drums: 'chill', bass: 'chill', arp: 'sparse', keys: 'chill',
      phrases: [{ prog: 'D', mel: 'D' }, { prog: 'G', mel: 'G' }, { prog: 'A', mel: 'A', v: 'answer' }, { prog: 'D', mel: 'D', v: 'echo' }] },
  },
};
