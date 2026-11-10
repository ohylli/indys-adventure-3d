// Fireworks for the festival night. Public API (keep these names and signatures):
//
//   import { Fireworks } from './fx/fireworks.js';
//   const fireworks = new Fireworks(scene);
//   fireworks.launch(from, opts?)     from: Vector3. opts: { height = 30, color (hex | array), size = 1,
//                                     style: 'peony' | 'ring' | 'willow' | 'heart' | 'paw' | 'random', delay = 0 }
//                                     A rocket with a trail rises `height` units, then bursts.
//   fireworks.burstAt(position, opts?)  Burst immediately at a point (no rocket).
//   fireworks.show(center, opts?)     Start a continuous show around `center` (Vector3): rockets launch at random
//                                     points on a ring opts.radius (default 40) around it, bursting between
//                                     opts.minY and opts.maxY, opts.rate per second (default 1.5).
//                                     Returns a handle with stop(). Include a few 'paw' and 'heart' bursts.
//   fireworks.onBurst = (position, size) => {}   Callback so the game can play a sound and flash the sky.
//   fireworks.update(dt)
//   fireworks.dispose()
//
// Rendering rules: stylized, bold, readable against a dusk sky; additive blending; LAYER_NO_OUTLINE; depthWrite false;
// few draw calls; no per-frame allocations. Bursts should have sparkle/crackle fade-out and slight gravity droop.
//
// Implementation notes:
// - One additive instanced draw call (own QuadPool, 9000 slots, ring buffer). A size-1 burst is ~30 units across.
// - opts.color: one colour, or an array; with 2+ colours the burst is two-coloured (inner shell / colour change).
//   Without a colour a random festival palette is chosen.
// - Planar styles ('ring', 'heart', 'paw') face the tower axis (the Y axis): their plane normal is the horizontal
//   direction from the burst to the axis, so a camera looking inward sees them face-on.
// - show() opts: { radius = 40, minY = center.y + 25, maxY = center.y + 55, rate = 1.5, launchY = center.y,
//   size = 1, styles (array, optional) }. Rockets launch from height launchY on the ring.
//   handle: { stop(), rate, center, active }.
// - onBurst(position, size) receives a reused Vector3: copy it if you keep it.

import * as THREE from 'three';
import { QuadPool, SHAPE } from './pool.js';

const TAU = Math.PI * 2;
const MAX_ROCKETS = 64;

const C = (h) => new THREE.Color(h);
const PALETTE = [
  [C('#ff3d6e'), C('#ffd23f')], // red + gold
  [C('#3fa9ff'), C('#ffffff')], // blue + white
  [C('#57ff8a'), C('#ffe45c')], // green + yellow
  [C('#c46bff'), C('#ff7ad9')], // purple + pink
  [C('#ff9a2e'), C('#ff3d6e')], // orange + red
  [C('#4ff0ff'), C('#c46bff')], // cyan + purple
  [C('#ffd23f'), C('#ff5a3c')], // gold + red
  [C('#ff7ad9'), C('#4ff0ff')], // pink + cyan
];
const WILLOW = [C('#ffcf5a'), C('#ff9d2e')];
const HEART = [C('#ff3d7f'), C('#ff9ccf')];
const PAW = [C('#ff8fd0'), C('#fff1fa')];
const ROCKET = C('#ffe6a8');
const ROCKET_TRAIL = C('#ffb54a');
const FLASH = C('#fff6e0');
const GLITTER = C('#fff3c4');
const STYLES = ['peony', 'ring', 'willow', 'heart', 'paw'];
const SHOW_STYLES = ['peony', 'peony', 'ring', 'willow', 'peony', 'heart', 'ring', 'paw', 'willow', 'peony', 'heart',
  'paw'];

// --- shape tables (unit-sized, x right / y up) ---
// heart outline (classic parametric heart), centred, max extent ~1
const HEART_PTS = (() => {
  const n = 64, pts = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(x / 17, (y + 2.5) / 17);
  }
  return pts;
})();

// paw print: one big pad (rounded, wider at the bottom, slightly 3-lobed) and four toe beans in an arc above it.
// Each entry: x, y, isFill (fill dots get the second colour)
const PAW_PTS = (() => {
  const pts = [];
  const nPad = 46;
  for (let k = 0; k < nPad; k++) {
    const a = (k / nPad) * TAU;
    const s = Math.sin(a), c = Math.cos(a);
    const w = 0.56 * (1 + 0.16 * Math.max(0, -s)); // wider at the bottom
    const lobes = s < 0 ? 1 + 0.07 * Math.cos(3 * (a - Math.PI * 1.5)) : 1; // 3 soft lobes along the bottom
    const h = s > 0 ? 0.42 : 0.46;
    pts.push(c * w * lobes, -0.36 + s * h * (s > 0 ? 1 - 0.18 * c * c : lobes), 0);
  }
  const toes = [[-0.74, 0.3, 0.6], [-0.27, 0.72, 0.22], [0.27, 0.72, -0.22], [0.74, 0.3, -0.6]];
  for (const [tx, ty, tilt] of toes) {
    const nT = 15;
    for (let k = 0; k < nT; k++) {
      const a = (k / nT) * TAU;
      const ex = Math.cos(a) * 0.19, ey = Math.sin(a) * 0.25;
      pts.push(tx + ex * Math.cos(tilt) - ey * Math.sin(tilt), ty + ex * Math.sin(tilt) + ey * Math.cos(tilt), 0);
    }
    pts.push(tx, ty, 1);
  }
  // fill dots inside the big pad
  const fill = [[0, -0.34], [-0.28, -0.28], [0.28, -0.28], [-0.15, -0.05], [0.15, -0.05], [-0.18, -0.58], [0.18, -0.58],
    [0, -0.66]];
  for (const [fx, fy] of fill) pts.push(fx, fy, 1);
  return pts;
})();

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3(0, 1, 0);
const _tmp = new THREE.Color();
const _burstPos = new THREE.Vector3();

function toColors(src, out) {
  // fills out[0], out[1] (THREE.Color) from opts.color; returns number of colours given
  if (src == null) return 0;
  const arr = Array.isArray(src) ? src : [src];
  if (!arr.length) return 0;
  for (let k = 0; k < 2; k++) {
    const v = arr[Math.min(k, arr.length - 1)];
    if (v && v.isColor) out[k].copy(v); else out[k].set(v);
  }
  return arr.length;
}

export class Fireworks {
  constructor(scene) {
    this.scene = scene;
    this.onBurst = null;
    this.pool = new QuadPool(scene, { max: 9000, additive: true, renderOrder: 30, name: 'fireworks' });
    this.pool.trailLife = 1.1;
    this.pool.trailSize = 0.42;
    this.pool.trailShape = SHAPE.GLOW;
    this.pool.trailGrav = 2.2;
    this.rockets = [];
    for (let k = 0; k < MAX_ROCKETS; k++) {
      this.rockets.push({ active: false, from: new THREE.Vector3(), pos: new THREE.Vector3(), drift: new THREE.Vector3(),
        t: 0, dur: 1, delay: 0, height: 30, style: 'peony', c: [new THREE.Color(), new THREE.Color()], nCol: 0,
        size: 1, acc: 0 });
    }
    this.shows = [];
    this._c = [new THREE.Color(), new THREE.Color()];
    this._showIdx = 0;
  }

  get live() { return this.pool.live; }

  launch(from, opts = {}) {
    let r = null;
    for (const k of this.rockets) if (!k.active) { r = k; break; }
    if (!r) return;
    r.active = true;
    r.from.copy(from);
    r.pos.copy(from);
    r.height = Math.max(4, opts.height ?? 30);
    r.dur = Math.min(2.6, Math.max(0.9, 0.75 + r.height / 42));
    r.t = 0;
    r.delay = opts.delay ?? 0;
    r.size = opts.size ?? 1;
    r.style = opts.style ?? 'random';
    r.nCol = toColors(opts.color, r.c);
    r.drift.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(r.height * 0.06);
    r.acc = 0;
  }

  burstAt(position, opts = {}) {
    const cols = this._c;
    const n = toColors(opts.color, cols);
    this._burst(position.x, position.y, position.z, opts.style ?? 'random', n, cols, opts.size ?? 1);
  }

  show(center, opts = {}) {
    const cy = center.y;
    const h = {
      center: new THREE.Vector3().copy(center),
      radius: opts.radius ?? 40,
      minY: opts.minY ?? cy + 25,
      maxY: opts.maxY ?? cy + 55,
      launchY: opts.launchY ?? cy,
      rate: opts.rate ?? 1.5,
      size: opts.size ?? 1,
      styles: opts.styles ?? null,
      acc: 0.75, // first rocket almost immediately
      active: true,
      stop: null,
    };
    h.stop = () => { h.active = false; };
    this.shows.push(h);
    return h;
  }

  _showLaunch(h) {
    const salvo = Math.random() < 0.22 ? 2 + ((Math.random() * 2) | 0) : 1;
    const base = Math.random() * TAU;
    for (let k = 0; k < salvo; k++) {
      const styles = h.styles ?? SHOW_STYLES;
      const style = styles[this._showIdx++ % styles.length];
      const th = base + (salvo > 1 ? (k - (salvo - 1) / 2) * 0.45 : 0);
      _p.set(h.center.x + Math.sin(th) * h.radius, h.launchY, h.center.z + Math.cos(th) * h.radius);
      const by = h.minY + Math.random() * (h.maxY - h.minY);
      const size = h.size * (0.8 + Math.random() * 0.45) * (style === 'paw' || style === 'heart' ? 1.15 : 1);
      // salvos share a colour
      const pal = PALETTE[(Math.random() * PALETTE.length) | 0];
      this._salvoCols ??= [null, null];
      this.launch(_p, { height: by - h.launchY, style, size, delay: k * 0.18,
        color: style === 'willow' || style === 'heart' || style === 'paw' ? undefined : (this._salvoCols[0] = pal[0],
          this._salvoCols[1] = pal[1], this._salvoCols) });
    }
  }

  _burst(x, y, z, style, nCol, cols, size) {
    if (style === 'random') style = STYLES[(Math.random() * STYLES.length) | 0];
    // colours
    let c1, c2;
    if (nCol > 0) {
      c1 = cols[0];
      c2 = nCol > 1 ? cols[1] : cols[0];
    } else if (style === 'willow') { c1 = WILLOW[0]; c2 = WILLOW[1]; }
    else if (style === 'heart') { c1 = HEART[0]; c2 = HEART[1]; }
    else if (style === 'paw') { c1 = PAW[0]; c2 = PAW[1]; }
    else {
      const p = PALETTE[(Math.random() * PALETTE.length) | 0];
      c1 = p[0];
      c2 = Math.random() < 0.7 ? p[1] : p[0];
    }
    const two = c1 !== c2 && !c1.equals(c2);
    // facing basis for planar shapes: normal toward the tower axis, right = cross(n, up)
    _n.set(-x, 0, -z);
    if (_n.lengthSq() < 1e-6) _n.set(0, 0, -1);
    _n.normalize();
    _r.crossVectors(_n, _u).normalize();

    const pool = this.pool;
    // budget: shrink bursts when the pool is busy so a finale stays under ~6000 live particles
    const busy = pool.live / 6000;
    const dens = busy > 0.75 ? Math.max(0.35, 1 - (busy - 0.75) * 2.6) : 1;
    const R = 15 * size; // final radius
    const drag = 2.3;
    const v0 = R * drag; // distance travelled with exponential drag = v0 / drag
    const starSize = 0.75 * Math.sqrt(size);
    const grav = 3.2 * size;

    // central flash
    let i = pool.spawn(x, y, z, 0, 0, 0, 0.22, 3.2 * size, SHAPE.GLOW, FLASH);
    pool.grow[i] = 0; pool.endScale[i] = 2.0; pool.fade[i] = 0.2;

    const star = (dx, dy, dz, speed, col, colEnd, life, sz, alignK) => {
      const j = pool.spawn(x, y, z, dx * speed, dy * speed, dz * speed, life, sz, SHAPE.STREAK, col);
      alignK *= 2.4;
      pool.drag[j] = drag;
      pool.grav[j] = grav;
      pool.align[j] = 1 + alignK;
      pool.aspect[j] = 0.7;
      pool.grow[j] = 0.0;
      pool.endScale[j] = 0.45;
      pool.crackle[j] = 0.38;
      pool.fade[j] = 0.75;
      if (colEnd !== col) pool.setEndColor(j, colEnd, 0.4);
      else pool.setEndColor(j, _tmp.copy(col).lerp(GLITTER, 0.55), 0.55);
      return j;
    };

    if (style === 'peony') {
      const n = Math.round(150 * dens * Math.min(1.6, size));
      const inner = two ? Math.round(n * 0.35) : 0;
      for (let k = 0; k < n; k++) {
        // fibonacci sphere with jitter -> even shell
        const yy = 1 - (2 * (k + 0.5)) / n;
        const rr = Math.sqrt(1 - yy * yy);
        const ph = k * 2.39996 + Math.random() * 0.2;
        const sp = v0 * (0.92 + Math.random() * 0.12);
        star(rr * Math.cos(ph), yy, rr * Math.sin(ph), sp, c1, two ? c2 : c1, 1.9 + Math.random() * 0.5, starSize, 0.05);
      }
      for (let k = 0; k < inner; k++) {
        const yy = 1 - (2 * (k + 0.5)) / inner;
        const rr = Math.sqrt(1 - yy * yy);
        const ph = k * 2.39996;
        star(rr * Math.cos(ph), yy, rr * Math.sin(ph), v0 * 0.5, c2, c2, 1.5 + Math.random() * 0.4, starSize * 0.85,
          0.04);
      }
    } else if (style === 'ring') {
      const n = Math.round(90 * dens * Math.min(1.5, size));
      const tilt = (Math.random() - 0.5) * 0.5;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const cx = Math.cos(a), cy = Math.sin(a);
        // ring in the plane facing the axis (slightly tilted for variety)
        const dx = _r.x * cx + _n.x * cy * tilt;
        const dy = cy;
        const dz = _r.z * cx + _n.z * cy * tilt;
        star(dx, dy, dz, v0 * (0.98 + Math.random() * 0.04), c1, c1, 2.0 + Math.random() * 0.3, starSize * 1.05, 0.04);
      }
      const core = Math.round(26 * dens);
      for (let k = 0; k < core; k++) {
        const yy = 1 - (2 * (k + 0.5)) / core;
        const rr = Math.sqrt(1 - yy * yy);
        const ph = k * 2.39996;
        star(rr * Math.cos(ph), yy, rr * Math.sin(ph), v0 * 0.28, c2, c2, 1.4, starSize * 0.8, 0.03);
      }
    } else if (style === 'willow') {
      const n = Math.round(56 * dens * Math.min(1.5, size));
      for (let k = 0; k < n; k++) {
        const yy = 1 - (2 * (k + 0.5)) / n;
        const rr = Math.sqrt(1 - yy * yy);
        const ph = k * 2.39996 + Math.random() * 0.3;
        const j = star(rr * Math.cos(ph), yy * 0.8 + 0.25, rr * Math.sin(ph), v0 * 0.85 * (0.9 + Math.random() * 0.2),
          c1, c2, 3.2 + Math.random() * 0.8, starSize * 0.9, 0.06);
        pool.drag[j] = 1.9;
        pool.grav[j] = 5.0 * size;
        pool.trail[j] = 18 * dens;
        pool.crackle[j] = 0.25;
        pool.endScale[j] = 0.6;
      }
    } else {
      // planar shapes: heart / paw
      const pts = style === 'heart' ? HEART_PTS : PAW_PTS;
      const stride = style === 'heart' ? 2 : 3;
      const n = pts.length / stride;
      const step = dens < 0.7 ? 2 : 1;
      const sp = v0 * 1.05;
      for (let k = 0; k < n; k += step) {
        const px = pts[k * stride], py = pts[k * stride + 1];
        const fill = stride === 3 && pts[k * stride + 2] > 0;
        const dx = _r.x * px, dy = py, dz = _r.z * px;
        const j = star(dx, dy, dz, sp, fill ? c2 : c1, fill ? c2 : c1, 2.2 + Math.random() * 0.3,
          starSize * (fill ? 1.1 : 1.0), 0.03);
        pool.grav[j] = grav * 0.35; // keep the shape readable, slight droop
        pool.crackle[j] = 0.3;
      }
      // a light sprinkle of glitter around the shape
      const extra = Math.round(24 * dens);
      for (let k = 0; k < extra; k++) {
        const yy = 1 - (2 * (k + 0.5)) / extra;
        const rr = Math.sqrt(1 - yy * yy);
        const ph = k * 2.39996;
        const j = star(rr * Math.cos(ph), yy, rr * Math.sin(ph), v0 * 0.35, GLITTER, GLITTER, 1.2, starSize * 0.6, 0.03);
        pool.crackle[j] = 0.7;
      }
    }
    if (this.onBurst) this.onBurst(_burstPos.set(x, y, z), size);
  }

  update(dt) {
    // shows
    for (let s = this.shows.length - 1; s >= 0; s--) {
      const h = this.shows[s];
      if (!h.active) { this.shows.splice(s, 1); continue; }
      h.acc += h.rate * dt;
      while (h.acc >= 1) { h.acc -= 1; if (this.pool.live < 6200) this._showLaunch(h); }
    }
    // rockets
    const pool = this.pool;
    for (let ri = 0; ri < MAX_ROCKETS; ri++) {
      const r = this.rockets[ri];
      if (!r.active) continue;
      if (r.delay > 0) { r.delay -= dt; continue; }
      const t0 = r.t;
      r.t = Math.min(r.dur, r.t + dt);
      const u0 = t0 / r.dur, u1 = r.t / r.dur;
      const e0 = 1 - (1 - u0) * (1 - u0), e1 = 1 - (1 - u1) * (1 - u1);
      // trail sparks along the segment travelled this frame
      r.acc += dt * 90;
      const n = Math.floor(r.acc);
      r.acc -= n;
      for (let k = 0; k < n; k++) {
        const e = e0 + (e1 - e0) * ((k + Math.random()) / Math.max(1, n));
        const x = r.from.x + r.drift.x * e, y = r.from.y + r.height * e, z = r.from.z + r.drift.z * e;
        const j = pool.spawn(x, y, z, (Math.random() - 0.5) * 1.6, -1.5 - Math.random() * 2, (Math.random() - 0.5) * 1.6,
          0.45 + Math.random() * 0.45, 0.2 + Math.random() * 0.12, SHAPE.GLOW, ROCKET_TRAIL);
        pool.grav[j] = 4;
        pool.drag[j] = 1.5;
        pool.grow[j] = 0;
        pool.endScale[j] = 0.1;
        pool.crackle[j] = 0.5;
        pool.setEndColor(j, ROCKET_TRAIL, 0);
      }
      const x = r.from.x + r.drift.x * e1, y = r.from.y + r.height * e1, z = r.from.z + r.drift.z * e1;
      // head: a short-lived bright streak pointing up
      const speed = (r.height * 2 * (1 - u1)) / r.dur + 0.5;
      const j = pool.spawn(x, y, z, 0, speed, 0, dt * 1.5 + 1e-3, 0.32, SHAPE.STREAK, ROCKET);
      pool.align[j] = 1.05;
      pool.grow[j] = 0;
      pool.endScale[j] = 1;
      if (r.t >= r.dur) {
        r.active = false;
        this._burst(x, y, z, r.style, r.nCol, r.c, r.size);
      }
    }
    pool.update(dt);
  }

  clear() {
    for (const r of this.rockets) r.active = false;
    this.shows.length = 0;
    this.pool.clear();
  }

  dispose() {
    this.shows.length = 0;
    for (const r of this.rockets) r.active = false;
    this.pool.dispose();
  }
}
