// Particle effects. Public API (keep these names and signatures):
//
//   import { ParticleSystem } from './fx/particles.js';
//   const particles = new ParticleSystem(scene, { max: 4000 });
//   particles.burst(type, position, opts?)   position: THREE.Vector3 (copied).
//       opts: { count, color (hex number | THREE.Color | array of them to pick from), dir (Vector3, main direction),
//               speed, spread (0..1), scale, life }  — every field optional, each type has good defaults.
//       types:
//         'dust'      small soft puffs when running / turning (count ~3)
//         'land'      ring of puffs spreading outward on landing
//         'jump'      a few puffs kicked down
//         'sparkle'   golden twinkles (collecting a treat)
//         'heart'     little hearts floating up (collecting a heart, charming a creature)
//         'star'      burst of stars (checkpoint, charm)
//         'feather'   tumbling feathers (a bird is scared off)
//         'confetti'  colourful paper bits, flutter down slowly
//         'splash'    water drops arcing up
//         'pop'       balloon pop: scraps flying outward, takes opts.color
//         'meow'      expanding ring / arcs in front of the cat showing the meow's reach (opts.dir = facing)
//         'spark'     hot sparks for firework fountains (bright, additive, fall with gravity)
//         'hurt'      a few sharp white stars
//   particles.stream(type, opts) -> handle   Continuous emitter: handle.position (Vector3, mutable),
//       handle.rate (per second), handle.stop(). For 'spark' fountains and 'wind' streaks
//       ('wind': long thin white streaks flying along opts.dir inside a box opts.size (Vector3) around position).
//   particles.update(dt)                     once per frame
//   particles.dispose()
//
// Rendering rules: toon style (flat shapes, no soft photographic sprites): draw shapes procedurally in the shader or
// from tiny canvas textures. Objects go on LAYER_NO_OUTLINE, depthWrite false, frustumCulled false.
// One or two draw calls in total (instanced quads or points). No allocations per frame.
//
// Implementation notes:
// - Two pools (two draw calls): normal-blended flat toon shapes, and an additive pool for 'spark'.
//   The additive pool gets max/4 slots (at least 512). Both reuse their slots as a ring buffer when full.
// - Sizes are in world units relative to Indy (1 unit tall): dust puffs ~0.35 across, hearts ~0.5, stars ~0.6.
//   opts.scale multiplies size, speed and gravity together (the whole effect scales uniformly).
// - opts.speed is the initial speed in units/s; opts.life is in seconds; opts.spread 0 = straight along dir,
//   1 = all directions. Any burst type can also be used as a stream (one particle per emission).
// - Extra stream opts: { dir, size (Vector3 box, 'wind'), rate, color, speed, scale, life }; the handle also has
//   handle.dir (Vector3, mutable) and handle.active.

import * as THREE from 'three';
import { QuadPool, SHAPE } from './pool.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

const pal = (...hex) => hex.map((h) => new THREE.Color(h));
// default looks per type
const DEF = {
  dust: { ground: true, count: 3, colors: pal('#f6efe2', '#e8dcc6', '#ddd0b8'), shape: SHAPE.PUFF, speed: 0.9, spread: 0.55,
    life: 0.55, size: 0.17, sizeVar: 0.35, grav: -0.6, drag: 3.5, endScale: 0.15, grow: 0.25, offset: 0.12 },
  land: { ground: true, count: 10, colors: pal('#f6efe2', '#e8dcc6', '#ddd0b8'), shape: SHAPE.PUFF, speed: 3.2, spread: 0,
    life: 0.6, size: 0.2, sizeVar: 0.3, grav: -0.8, drag: 5, endScale: 0.1, grow: 0.2, offset: 0.25 },
  jump: { ground: true, count: 5, colors: pal('#f6efe2', '#e8dcc6', '#ddd0b8'), shape: SHAPE.PUFF, speed: 2.2, spread: 0.3,
    life: 0.45, size: 0.17, sizeVar: 0.3, grav: -0.5, drag: 5, endScale: 0.1, grow: 0.2, offset: 0.15 },
  sparkle: { count: 12, colors: pal('#ffd23a', '#fff09a', '#ffb81f', '#ffffff'), shape: SHAPE.SPARKLE, speed: 2.6,
    spread: 1, life: 0.75, lifeVar: 0.3, size: 0.17, sizeVar: 0.5, grav: 1.2, drag: 3.2, endScale: 0.0, grow: 0.15,
    spin: 4, twinkle: 30, offset: 0.2, rise: 0.8 },
  heart: { count: 6, colors: pal('#ff4f86', '#ff7aa8', '#e8336a', '#ff9cc0'), shape: SHAPE.HEART, speed: 1.6,
    spread: 0.35, life: 1.3, lifeVar: 0.3, size: 0.2, sizeVar: 0.35, grav: -1.4, drag: 2.2, endScale: 0.0, grow: 0.15,
    wob: 0.35, wobFreq: 6, sway: 0.8, offset: 0.25 },
  star: { count: 10, colors: pal('#ffd33d', '#ffe680', '#ffb627', '#7fd4ff', '#ff8ab4'), shape: SHAPE.STAR,
    speed: 4.6, spread: 1, life: 0.85, lifeVar: 0.3, size: 0.24, sizeVar: 0.35, grav: 2.0, drag: 3.6, endScale: 0.0,
    grow: 0.12, spin: 5, offset: 0.1, rise: 1.2 },
  feather: { count: 7, colors: pal('#ffffff', '#eef2f6', '#d8dee6'), shape: SHAPE.FEATHER, speed: 3.2, spread: 1,
    life: 2.2, lifeVar: 0.4, size: 0.2, sizeVar: 0.25, grav: 1.6, drag: 2.6, endScale: 0.3, grow: 0.06, spin: 1.5,
    wob: 1.0, wobFreq: 4.5, sway: 1.4, fade: 0.8, offset: 0.25, rise: 1.0 },
  confetti: { count: 36, colors: pal('#ff4f6d', '#ffd23a', '#3fc9ff', '#5ee07a', '#b67dff', '#ff8a3d', '#ff7ac8'),
    shape: SHAPE.RECT, speed: 6.5, spread: 0.42, life: 2.8, lifeVar: 0.4, size: 0.1, sizeVar: 0.25, grav: 3.0,
    drag: 2.4, endScale: 0.6, grow: 0.04, spin: 4, flutter: 11, aspect: 0.55, sway: 1.2, fade: 0.85, offset: 0.15 },
  splash: { count: 12, colors: pal('#5fd0ff', '#9fe6ff', '#3fb2f0', '#e8fbff'), shape: SHAPE.DROP, speed: 4.6,
    spread: 0.38, life: 0.85, lifeVar: 0.25, size: 0.12, sizeVar: 0.3, grav: 13, drag: 0.6, endScale: 0.4,
    grow: 0.08, align: 0.06, offset: 0.2 },
  pop: { count: 12, colors: pal('#ff4f6d'), shape: SHAPE.TRI, speed: 6, spread: 1, life: 0.6, lifeVar: 0.3,
    size: 0.14, sizeVar: 0.35, grav: 7, drag: 4, endScale: 0.2, grow: 0.0, spin: 12, offset: 0.2 },
  meow: { count: 3, colors: pal('#ffffff'), speed: 1.0, life: 0.7, size: 0.4 },
  spark: { count: 24, colors: pal('#fff4c2', '#ffe08a', '#ffc65a'), endColors: pal('#ff8a2a', '#ff5a1f', '#ffb03a'),
    shape: SHAPE.STREAK, speed: 6.5, spread: 0.3, life: 0.8, lifeVar: 0.35, size: 0.075, sizeVar: 0.3, grav: 9,
    drag: 1.0, endScale: 0.3, grow: 0.0, align: 0.5, aspect: 0.55, crackle: 0.3, offset: 0.05 },
  hurt: { count: 5, colors: pal('#ffffff'), shape: SHAPE.SPARKLE, speed: 3.6, spread: 1, life: 0.45, lifeVar: 0.15,
    size: 0.26, sizeVar: 0.25, grav: 0, drag: 6, endScale: 0.0, grow: 0.15, spin: 3, offset: 0.25 },
  wind: { count: 1, colors: pal('#ffffff'), shape: SHAPE.STREAK, speed: 14, spread: 0.02, life: 0.9, lifeVar: 0.3,
    size: 0.07, sizeVar: 0.3, grav: 0, drag: 0, endScale: 1, grow: 0, align: 0.9, aspect: 0.5, fade: 0.55,
    fadeIn: 0.2, alpha: 0.75 },
};
const STREAM_RATE = { spark: 90, wind: 14 };

const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const _d = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _v = new THREE.Vector3();

function pickColor(src, fallback) {
  let c = src;
  if (Array.isArray(src)) c = src.length ? src[(Math.random() * src.length) | 0] : null;
  if (c == null) return fallback[(Math.random() * fallback.length) | 0];
  if (c.isColor) return c;
  return _c.set(c);
}

// basis perpendicular to d (unit) into _bx, _by
function basis(d) {
  if (Math.abs(d.y) < 0.9) _bx.set(0, 1, 0).cross(d).normalize();
  else _bx.set(1, 0, 0).cross(d).normalize();
  _by.crossVectors(d, _bx);
}

// random unit vector in a cone of half-angle spread*PI around d (basis must be set)
function coneDir(d, spread, out) {
  const cosMax = Math.cos(Math.min(1, Math.max(0, spread)) * Math.PI);
  const ct = 1 - Math.random() * (1 - cosMax);
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  const ph = Math.random() * TAU;
  return out.copy(d).multiplyScalar(ct).addScaledVector(_bx, st * Math.cos(ph)).addScaledVector(_by, st * Math.sin(ph));
}

export class ParticleSystem {
  constructor(scene, opts = {}) {
    this.scene = scene;
    const max = opts.max ?? 4000;
    this.pool = new QuadPool(scene, { max, additive: false, renderOrder: 20, name: 'particles' });
    this.hot = new QuadPool(scene, { max: Math.max(512, (max / 4) | 0), additive: true, renderOrder: 21,
      name: 'particles-additive' });
    this.streams = [];
  }

  get live() { return this.pool.live + this.hot.live; }

  burst(type, position, opts = {}) {
    const def = DEF[type];
    if (!def) return;
    if (type === 'meow') return this._meow(position, opts);
    const count = Math.max(0, Math.round(opts.count ?? def.count));
    for (let n = 0; n < count; n++) this._emit(type, def, position.x, position.y, position.z, opts, n, count, null);
    if (type === 'pop') this._popRing(position, opts);
  }

  _emit(type, def, x, y, z, opts, n, count, box) {
    const scale = opts.scale ?? 1;
    const pool = type === 'spark' ? this.hot : this.pool;
    const dir = _d.copy(opts.dir ?? UP);
    if (dir.lengthSq() < 1e-8) dir.copy(UP);
    dir.normalize();
    basis(dir);
    const spread = opts.spread ?? def.spread;
    const speed = (opts.speed ?? def.speed) * scale * (0.7 + 0.6 * Math.random());
    let v;
    if (type === 'land') {
      // ring around dir (default up): evenly spaced, slightly jittered
      const ph = (n / count) * TAU + Math.random() * 0.4;
      v = _v.set(0, 0, 0).addScaledVector(_bx, Math.cos(ph)).addScaledVector(_by, Math.sin(ph))
        .addScaledVector(dir, 0.12);
    } else if (type === 'jump') {
      // kicked down and out
      const ph = (n / count) * TAU + Math.random();
      v = _v.copy(dir).multiplyScalar(-0.55).addScaledVector(_bx, Math.cos(ph)).addScaledVector(_by, Math.sin(ph));
      v.normalize();
    } else {
      v = coneDir(dir, spread, _v);
      if (def.rise) v.y += def.rise * 0.3;
    }
    const vx = v.x * speed, vy = v.y * speed, vz = v.z * speed;
    const off = (def.offset ?? 0) * scale;
    let px = x, py = y, pz = z;
    if (box) {
      px += (Math.random() - 0.5) * box.x;
      py += (Math.random() - 0.5) * box.y;
      pz += (Math.random() - 0.5) * box.z;
    } else if (off > 0) {
      const k = off / Math.max(speed, 1e-3);
      px += vx * k * Math.random(); py += vy * k * Math.random(); pz += vz * k * Math.random();
    }
    const life = (opts.life ?? def.life) * (1 + (def.lifeVar ?? 0.2) * (Math.random() - 0.5) * 2);
    const size = def.size * scale * (1 + (def.sizeVar ?? 0) * (Math.random() - 0.5) * 2);
    if (def.ground) py += size * 0.8; // ground puffs sit on the ground instead of half inside it
    const col = pickColor(opts.color, def.colors);
    const i = pool.spawn(px, py, pz, vx, vy, vz, life, size, def.shape, col);
    pool.grav[i] = (def.grav ?? 0) * scale;
    pool.drag[i] = def.drag ?? 0;
    pool.endScale[i] = def.endScale ?? 0;
    pool.grow[i] = def.grow ?? 0.12;
    if (def.spin) {
      pool.rot[i] = Math.random() * TAU;
      pool.spin[i] = def.spin * (Math.random() * 2 - 1);
    }
    if (def.wob) {
      pool.wobAmp[i] = def.wob * (0.6 + 0.4 * Math.random());
      pool.wobFreq[i] = def.wobFreq ?? 5;
    }
    if (def.sway) pool.sway[i] = def.sway * scale;
    if (def.twinkle) pool.twinkle[i] = def.twinkle * (0.7 + 0.6 * Math.random());
    if (def.flutter) pool.flutter[i] = def.flutter * (0.6 + 0.8 * Math.random());
    if (def.aspect) pool.aspect[i] = def.aspect;
    if (def.align) pool.align[i] = 1 + def.align / scale;
    if (def.fade != null) pool.fade[i] = def.fade;
    if (def.fadeIn) pool.fadeIn[i] = def.fadeIn;
    if (def.alpha) pool.alpha[i] = def.alpha;
    if (def.crackle) pool.crackle[i] = def.crackle;
    if (def.endColors) pool.setEndColor(i, def.endColors[(Math.random() * def.endColors.length) | 0], 0.15);
    if (type === 'heart') pool.rot[i] = (Math.random() - 0.5) * 0.5;
    if (type === 'feather') pool.rot[i] = Math.random() * TAU;
    return i;
  }

  // balloon pop: a quick white ring flash plus the scraps
  _popRing(p, opts) {
    const scale = opts.scale ?? 1;
    const i = this.pool.spawn(p.x, p.y, p.z, 0, 0, 0, 0.18, 0.4 * scale, SHAPE.RING, WHITE);
    this.pool.param[i] = 0.05;
    this.pool.endScale[i] = 1.7;
    this.pool.grow[i] = 0.3;
    this.pool.fade[i] = 0.3;
  }

  // meow: three sound-wave arcs travelling along the facing direction plus a ring that grows to the reach radius
  _meow(p, opts) {
    const def = DEF.meow;
    const scale = opts.scale ?? 1;
    const dir = _d.copy(opts.dir ?? _v.set(1, 0, 0));
    dir.y *= 0.3;
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    const col = pickColor(opts.color, def.colors);
    const speed = (opts.speed ?? def.speed) * scale;
    const life = opts.life ?? def.life;
    const count = Math.max(1, Math.round(opts.count ?? def.count));
    for (let n = 0; n < count; n++) {
      const i = this.pool.spawn(p.x + dir.x * 0.2, p.y + dir.y * 0.2, p.z + dir.z * 0.2,
        dir.x * speed, dir.y * speed, dir.z * speed, life, def.size * scale, SHAPE.ARC, col);
      this.pool.age[i] = -n * 0.13; // staggered
      this.pool.align[i] = 1.0001;
      this.pool.param[i] = 0.08;
      this.pool.endScale[i] = 3.2;
      this.pool.grow[i] = 0.15;
      this.pool.fade[i] = 0.45;
      this.pool.drag[i] = 1.2;
    }
    // reach ring
    const i = this.pool.spawn(p.x, p.y, p.z, 0, 0, 0, life * 0.9, 0.4 * scale, SHAPE.RING, col);
    this.pool.param[i] = 0.035;
    this.pool.endScale[i] = 7.0; // ~2.6 units radius at the end
    this.pool.grow[i] = 0;
    this.pool.fade[i] = 0.25;
    this.pool.alpha[i] = 0.75;
  }

  stream(type, opts = {}) {
    const def = DEF[type] ?? DEF.spark;
    const h = {
      type: DEF[type] ? type : 'spark',
      position: new THREE.Vector3().copy(opts.position ?? new THREE.Vector3()),
      dir: new THREE.Vector3().copy(opts.dir ?? (type === 'wind' ? new THREE.Vector3(1, 0, 0) : UP)),
      size: new THREE.Vector3().copy(opts.size ?? new THREE.Vector3(8, 4, 8)),
      rate: opts.rate ?? STREAM_RATE[type] ?? 20,
      active: true,
      acc: 0,
      opts: { color: opts.color, speed: opts.speed, spread: opts.spread, scale: opts.scale, life: opts.life,
        dir: null },
      def,
      stop: null,
    };
    h.opts.dir = h.dir;
    h.stop = () => { h.active = false; };
    this.streams.push(h);
    return h;
  }

  update(dt) {
    for (let s = this.streams.length - 1; s >= 0; s--) {
      const h = this.streams[s];
      if (!h.active) { this.streams.splice(s, 1); continue; }
      h.acc += h.rate * dt;
      let guard = 0;
      while (h.acc >= 1 && guard++ < 200) {
        h.acc -= 1;
        const p = h.position;
        if (h.type === 'wind') this._emit('wind', h.def, p.x, p.y, p.z, h.opts, 0, 1, h.size);
        else if (h.type === 'meow') this._meow(p, h.opts);
        else this._emit(h.type, h.def, p.x, p.y, p.z, h.opts, (Math.random() * 8) | 0, 8, null);
      }
    }
    this.pool.update(dt);
    this.hot.update(dt);
  }

  clear() {
    this.pool.clear();
    this.hot.clear();
  }

  dispose() {
    this.streams.length = 0;
    this.pool.dispose();
    this.hot.dispose();
  }
}
