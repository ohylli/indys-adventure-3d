// Everything in the level that reacts to Indy: collectibles, checkpoints, birds, visitors, balloons, wind, sparks.
// Nothing is ever killed: birds are scared off by a meow and come back later.
import * as THREE from 'three';
import { assets } from '../core/assets.js';
import { cyl, placeCyl } from './movers.js';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

const centreOf = (player, out = _v) => out.set(player.pos.x, player.pos.y + 0.45, player.pos.z);
const rad = (d) => d * DEG;

function setWings(obj, flap, fold = 0) {
  // flap: -1..1 (up positive). fold: 0 spread .. 1 folded against the body.
  const L = obj.userData.wingL, R = obj.userData.wingR;
  if (!L || !R) return;
  const up = flap * rad(34) * (1 - fold);
  L.rotation.set(rad(55) * fold, 0, up - rad(80) * fold);
  R.rotation.set(rad(55) * fold, 0, -up + rad(80) * fold);
  L.scale.x = R.scale.x = 1 - 0.4 * fold;
}

function bird(name) {
  const obj = assets.kit(name);
  obj.userData.wingL = assets.part(obj, 'wing_L');
  obj.userData.wingR = assets.part(obj, 'wing_R');
  obj.userData.head = assets.part(obj, 'head');
  return obj;
}

// ---------------------------------------------------------------------------------------------------- treats
export class Treats {
  constructor(ctx) { this.ctx = ctx; this.items = []; this.meshes = []; this.total = 0; }

  add(pos) { this.items.push({ pos: pos.clone(), taken: false, pop: 0, phase: this.items.length * 0.7 }); this.total = this.items.length; }

  build(parent) {
    // A chunky fish cracker. Built here (about 150 triangles) because there are well over a hundred on screen.
    const s = new THREE.Shape();
    s.moveTo(0.27, 0);
    s.bezierCurveTo(0.2, 0.17, -0.02, 0.17, -0.12, 0.03);
    s.lineTo(-0.27, 0.15); s.lineTo(-0.24, 0); s.lineTo(-0.27, -0.15); s.lineTo(-0.12, -0.03);
    s.bezierCurveTo(-0.02, -0.17, 0.2, -0.17, 0.27, 0);
    const body = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 5 });
    body.translate(0, 0, -0.05);
    const eyes = mergeEyes(new THREE.SphereGeometry(0.035, 6, 4));
    const parts = [
      [body, new THREE.MeshToonMaterial({ color: 0xffa63d, gradientMap: assets.gradient, emissive: 0x7a3a00, emissiveIntensity: 0.25 })],
      [eyes, new THREE.MeshBasicMaterial({ color: 0x2b1a12 })],
    ];
    for (const [g, m] of parts) {
      const im = new THREE.InstancedMesh(g, m, Math.max(1, this.items.length));
      im.userData.local = new THREE.Matrix4();
      im.frustumCulled = false; im.castShadow = false;
      parent.add(im);
      this.meshes.push(im);
    }
  }

  update(dt, t, player) {
    const pc = centreOf(player, _pc);
    const game = this.ctx.game;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      let scale = 1.5;
      if (it.taken) { it.pop = Math.max(0, it.pop - dt * 5); scale = it.pop * 2.2; }
      else if (game.playing && pc.distanceToSquared(it.pos) < 1.05) {
        it.taken = true; it.pop = 1;
        game.collect('treat', it.pos);
      }
      _e.set(0, t * 2.4 + it.phase, 0.18 * Math.sin(t * 2 + it.phase));
      _q.setFromEuler(_e);
      _v.copy(it.pos); _v.y += 0.1 * Math.sin(t * 2.2 + it.phase) + (it.taken ? (1 - it.pop) * 0.8 : 0);
      _m.compose(_v, _q, _s.setScalar(scale));
      for (const im of this.meshes) im.setMatrixAt(i, _mul(_m, im.userData.local));
    }
    for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
  }

  get taken() { let n = 0; for (const it of this.items) if (it.taken) n++; return n; }
  reset() { for (const it of this.items) { it.taken = false; it.pop = 0; } }
}
function mergeEyes(eye) {
  const pos = [];
  for (const z of [0.085, -0.085]) {
    const g = eye.clone().toNonIndexed(); g.translate(0.15, 0.035, z);
    pos.push(...g.getAttribute('position').array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
const _mm = new THREE.Matrix4();
const _pc = new THREE.Vector3();
function _mul(a, b) { return _mm.multiplyMatrices(a, b); }

// ---------------------------------------------------------------------------------------------------- pickups
export class Pickup {
  constructor(ctx, kind, pos) {
    this.ctx = ctx; this.kind = kind; this.pos = pos.clone(); this.taken = false;
    this.object = assets.kit(kind);
    this.object.position.copy(pos);
    this.object.scale.setScalar(kind === 'heart' ? 1.5 : 1.4);
    ctx.scene.add(this.object);
  }
  update(dt, t, player) {
    if (this.taken) return;
    this.object.rotation.y = t * 1.8;
    this.object.position.y = this.pos.y + 0.12 * Math.sin(t * 2.4);
    if (this.ctx.game.playing && centreOf(player).distanceToSquared(this.pos) < 1.3) {
      if (this.kind === 'heart' && !this.ctx.game.canHeal()) return;
      this.taken = true; this.object.visible = false;
      this.ctx.game.collect(this.kind === 'heart' ? 'heart' : 'charm', this.pos);
    }
  }
  reset() { this.taken = false; this.object.visible = true; }
}

// ---------------------------------------------------------------------------------------------------- checkpoint
export class Checkpoint {
  constructor(ctx, a, r, y, section, index) {
    this.ctx = ctx; this.a = a; this.r = r; this.section = section; this.index = index;
    this.object = assets.kit('checkpoint_box');
    placeCyl(this.object, a, r, y ?? 0);
    this.flag = assets.part(this.object, 'flag');
    if (this.flag) this.flag.scale.setScalar(0.001);
    this.active = false; this.grow = 0;
    this.pos = this.object.position;
  }
  dropToGround(world) {
    const hit = world.raycastDown(_v.set(this.pos.x, 200, this.pos.z), 400);
    if (hit) this.pos.y = hit.point.y;
    this.object.updateMatrixWorld(true);
  }
  get respawn() { return _v.set(this.pos.x, this.pos.y + 0.6, this.pos.z).clone(); }
  update(dt, t, player) {
    if (this.active && this.grow < 1) {
      this.grow = Math.min(1, this.grow + dt * 3);
      const k = 1 + 0.35 * Math.sin(this.grow * Math.PI);
      if (this.flag) this.flag.scale.setScalar(Math.max(0.001, this.grow * k));
    }
    if (!this.active && this.ctx.game.playing) {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, dy = player.pos.y - this.pos.y;
      if (dx * dx + dz * dz < 2.6 && dy > -0.5 && dy < 2.2) { this.active = true; this.ctx.game.setCheckpoint(this); }
    }
  }
  reset() { this.active = false; this.grow = 0; if (this.flag) this.flag.scale.setScalar(0.001); }
}

// ---------------------------------------------------------------------------------------------------- gull
/** opts: { a, r, y, arc = 40, speed = 0.5 }: patrols back and forth along an arc, dives at Indy, hates meows. */
export class Gull {
  constructor(ctx, opts) {
    this.ctx = ctx; this.o = { arc: 40, speed: 0.45, ...opts };
    this.object = bird('gull');
    this.object.scale.setScalar(1.15);
    ctx.scene.add(this.object);
    this.pos = this.object.position;
    this.home = new THREE.Vector3(); this.target = new THREE.Vector3(); this.dir = new THREE.Vector3(0, 0, 1);
    this.reset();
  }
  reset() { this.state = 'patrol'; this.timer = 0; this.cool = 2 + Math.random() * 2; this.object.visible = true; this._home(0, this.pos); }
  _home(t, out) {
    const a = this.o.a + this.o.arc * Math.sin(t * this.o.speed + this.o.a);
    return cyl(a, this.o.r, this.o.y + 0.6 * Math.sin(t * 1.3 + this.o.a), out);
  }
  update(dt, t, player) {
    const game = this.ctx.game, pc = centreOf(player, _w);
    this.cool = Math.max(0, this.cool - dt);
    this.timer -= dt;
    const prev = _v.copy(this.pos);
    let flapRate = 9, speedFace = true;
    if (this.state === 'patrol') {
      this._home(t, this.home);
      this.pos.lerp(this.home, Math.min(1, dt * 2.5));
      const d = pc.distanceTo(this.pos);
      if (game.playing && this.cool <= 0 && d < 12.5 && Math.abs(pc.y - this.pos.y) < 7 && !game.invulnerable) {
        this.state = 'warn'; this.timer = 0.75; this.ctx.audio.sfx('gull', { volume: 0.8 }); game.tension(0.7);
      }
    } else if (this.state === 'warn') {
      flapRate = 15; speedFace = false;
      this.pos.y += dt * 1.2;
      _s.subVectors(pc, this.pos).setY(0).normalize();
      this.dir.lerp(_s, Math.min(1, dt * 8));
      if (this.timer <= 0) {
        this.state = 'dive';
        this.target.copy(pc).addScaledVector(player.vel, 0.35);
        this.dir.subVectors(this.target, this.pos).normalize();
        this.timer = 1.5;
      }
    } else if (this.state === 'dive') {
      flapRate = 4;
      this.pos.addScaledVector(this.dir, 14 * dt);
      if (game.playing && this.pos.distanceToSquared(pc) < 1.0) { game.hurt(this.pos, { sfx: 'gull' }); this.state = 'return'; this.timer = 1.2; this.cool = 5; }
      else if (this.timer <= 0 || this.pos.distanceToSquared(this.target) < 1 || _s.subVectors(this.target, this.pos).dot(this.dir) < 0) {
        this.state = 'return'; this.timer = 1.4; this.cool = 4.5;
      }
    } else if (this.state === 'return') {
      this._home(t, this.home);
      this.pos.lerp(this.home, Math.min(1, dt * 2.2));
      if (this.timer <= 0) this.state = 'patrol';
    } else if (this.state === 'scared') {
      flapRate = 18;
      this.pos.addScaledVector(this.dir, 13 * dt);
      if (this.timer <= 0) { this.state = 'away'; this.timer = 11; this.object.visible = false; }
    } else if (this.state === 'away') {
      if (this.timer <= 0) {
        this.state = 'return'; this.timer = 2.5; this.object.visible = true;
        this._home(t, this.home); this.pos.copy(this.home).multiplyScalar(2.4); this.pos.y = this.home.y + 8;
      }
    }
    if (speedFace) { _s.subVectors(this.pos, prev); if (_s.lengthSq() > 1e-6) this.dir.lerp(_s.normalize(), Math.min(1, dt * 7)); }
    this.object.rotation.set(-Math.asin(THREE.MathUtils.clamp(this.dir.y, -0.9, 0.9)) * 0.8, Math.atan2(this.dir.x, this.dir.z), 0, 'YXZ');
    setWings(this.object, Math.sin(t * flapRate + this.o.a) * (this.state === 'dive' ? 0.25 : 1) + (this.state === 'dive' ? 0.5 : 0));
  }
  onMeow(pos) {
    if (this.state === 'away' || this.state === 'scared' || this.pos.distanceTo(pos) > 10) return;
    this.state = 'scared'; this.timer = 1.6;
    this.dir.set(this.pos.x, 0, this.pos.z).normalize().multiplyScalar(0.9).setY(0.45).normalize();
    this.ctx.particles.burst('feather', this.pos, { count: 8 });
    this.ctx.audio.sfx('flap'); this.ctx.audio.sfx('gull', { pitch: 1.3, volume: 0.6 });
  }
}

// ---------------------------------------------------------------------------------------------------- perching birds
/** A jackdaw (pecks if you bump into it) or a pigeon (harmless). Flies off when meowed at. */
export class Percher {
  constructor(ctx, kind, a, r, y, opts = {}) {
    this.ctx = ctx; this.kind = kind; this.o = opts;
    this.object = bird(kind);
    this.object.scale.setScalar(kind === 'jackdaw' ? 1.5 : 1.35);
    this.home = cyl(a, r, y);
    this.yaw = (a + (opts.yaw ?? 0)) * DEG;
    ctx.scene.add(this.object);
    this.pos = this.object.position;
    this.dir = new THREE.Vector3();
    this.reset();
  }
  reset() { this.state = 'perch'; this.timer = 0; this.fold = 1; this.pos.copy(this.home); this.object.visible = true; this.hop = Math.random() * 3; }
  update(dt, t, player) {
    const game = this.ctx.game, pc = centreOf(player, _w);
    if (this.state === 'perch') {
      this.fold = Math.min(1, this.fold + dt * 4);
      this.hop -= dt;
      let y = 0;
      if (this.hop < 0.25) y = Math.sin((0.25 - Math.max(0, this.hop)) / 0.25 * Math.PI) * 0.16;
      if (this.hop < 0) this.hop = 1.5 + Math.random() * 3;
      this.pos.copy(this.home); this.pos.y += y;
      const d2 = pc.distanceToSquared(this.home);
      // look at Indy when he is close
      let yaw = this.yaw;
      if (d2 < 60) yaw = Math.atan2(pc.x - this.home.x, pc.z - this.home.z);
      this.object.rotation.set(0, this.object.rotation.y + shortest(this.object.rotation.y, yaw) * Math.min(1, dt * 6), 0);
      const head = this.object.userData.head;
      if (head) head.rotation.z = 0.35 * Math.sin(t * 1.7 + this.home.x);
      setWings(this.object, 0, this.fold);
      if (game.playing) {
        if (this.o.harmless) { if (d2 < 9) this._fly(pc); }
        else if (d2 < 0.75 && !game.invulnerable) { game.hurt(this.home, { sfx: 'jackdaw' }); }
      }
    } else if (this.state === 'fly') {
      this.timer -= dt;
      this.fold = Math.max(0, this.fold - dt * 6);
      this.pos.addScaledVector(this.dir, 9 * dt);
      this.object.rotation.set(-0.4, Math.atan2(this.dir.x, this.dir.z), 0, 'YXZ');
      setWings(this.object, Math.sin(t * 22), this.fold);
      if (this.timer <= 0) { this.state = 'away'; this.object.visible = false; this.timer = this.o.harmless ? 14 : 1e9; }
    } else if (this.state === 'away') {
      this.timer -= dt;
      if (this.timer <= 0 && pc.distanceToSquared(this.home) > 120) this.reset();
    }
  }
  _fly(from) {
    this.state = 'fly'; this.timer = 2.2;
    this.dir.subVectors(this.home, from).setY(0);
    if (this.dir.lengthSq() < 0.01) this.dir.set(this.home.x, 0, this.home.z);
    this.dir.normalize().setY(0.75).normalize();
    this.ctx.particles.burst('feather', this.home, { count: this.kind === 'jackdaw' ? 6 : 4, color: this.kind === 'jackdaw' ? 0x3a3b46 : 0xc8d0da });
    this.ctx.audio.sfx('flap', { volume: 0.7 });
    if (this.kind === 'jackdaw') this.ctx.audio.sfx('jackdaw', { volume: 0.7 });
  }
  onMeow(pos) { if (this.state === 'perch' && this.home.distanceTo(pos) < 8) this._fly(pos); }
}
function shortest(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

// ---------------------------------------------------------------------------------------------------- visitors
export class Visitor {
  constructor(ctx, kind, a, r, yaw = 180) {
    this.ctx = ctx;
    this.object = assets.kit(kind);
    placeCyl(this.object, a, r, 0, yaw);
    this.baseYaw = this.object.rotation.y;
    ctx.scene.add(this.object);
    this.head = assets.part(this.object, 'head');
    this.arm = assets.part(this.object, 'arm_R');
    this.pos = this.object.position;
    this.wave = 0; this.cool = 0; this.phase = a;
    const g = new THREE.CylinderGeometry(0.5, 0.5, 2.6, 10); g.translate(this.pos.x, 1.3, this.pos.z);
    ctx.world.addStaticGeometry(g.toNonIndexed());
  }
  update(dt, t, player) {
    this.cool = Math.max(0, this.cool - dt);
    this.wave = Math.max(0, this.wave - dt);
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const near = dx * dx + dz * dz < 90;
    const yaw = near ? Math.atan2(dx, dz) : this.baseYaw;
    this.object.rotation.y += shortest(this.object.rotation.y, yaw) * Math.min(1, dt * 3);
    this.object.position.y = Math.abs(Math.sin(t * 2 + this.phase)) * 0.04 + (this.wave > 0 ? Math.abs(Math.sin(this.wave * 9)) * 0.18 : 0);
    if (this.head) this.head.rotation.z = 0.1 * Math.sin(t * 1.1 + this.phase);
    if (this.arm) this.arm.rotation.z = this.wave > 0 ? -rad(112 + 16 * Math.sin(this.wave * 14)) * Math.min(1, this.wave * 4, (1.8 - this.wave) * 4 + 1) : 0;
  }
  onMeow(pos) {
    if (this.cool > 0 || this.pos.distanceTo(pos) > 9) return;
    this.cool = 3; this.wave = 1.8;
    this.ctx.particles.burst('heart', _v.set(this.pos.x, 2.9, this.pos.z), { count: 5 });
    this.ctx.audio.sfx('aww', { volume: 0.8 });
    this.ctx.game.charmed(this);
  }
  reset() { this.wave = 0; this.cool = 0; }
}

// ---------------------------------------------------------------------------------------------------- bouncy things
export class Balloon {
  constructor(ctx, a, r, y, tint = '#e8443a') {
    this.ctx = ctx; this.tint = tint;
    this.object = assets.kit('balloon', { tint });
    this.home = cyl(a, r, y);
    this.object.position.copy(this.home);
    ctx.scene.add(this.object);
    this.gone = 0; this.phase = a * 0.3;
  }
  update(dt, t, player) {
    if (this.gone > 0) {
      this.gone -= dt;
      if (this.gone <= 0) { this.object.visible = true; this.grow = 0; }
      return;
    }
    this.grow = Math.min(1, (this.grow ?? 1) + dt * 3);
    this.object.scale.setScalar(this.grow);
    this.object.position.set(this.home.x + 0.12 * Math.sin(t * 0.9 + this.phase), this.home.y + 0.18 * Math.sin(t * 1.4 + this.phase), this.home.z);
    this.object.rotation.z = 0.06 * Math.sin(t * 1.1 + this.phase);
    if (!this.ctx.game.playing || this.grow < 0.9) return;
    const pc = centreOf(player);
    if (pc.distanceToSquared(this.object.position) < 1.45 * 1.45) {
      if (player.state !== 'climb' && pc.y > this.object.position.y - 0.1 && player.vel.y < 4) {
        player.vel.y = 17.5; player.state = 'air'; player.ground = null; player.canPounce = true; player.pouncing = false; player.noCut = true;
        this.ctx.game.bounced(this.object.position);
      }
      this.ctx.particles.burst('pop', this.object.position, { color: this.tint });
      this.ctx.audio.sfx('pop');
      this.object.visible = false; this.gone = 3.2;
    }
  }
  reset() { this.gone = 0; this.object.visible = true; this.grow = 1; }
}

export class BounceZone {
  constructor(ctx, pos, radius = 1.25, power = 19) { this.ctx = ctx; this.pos = pos; this.radius = radius; this.power = power; this.cool = 0; }
  update(dt, t, player) {
    this.cool = Math.max(0, this.cool - dt);
    if (this.object && this.squash > 0) { this.squash = Math.max(0, this.squash - dt * 4); this.object.scale.y = 1 - 0.3 * Math.sin(this.squash * Math.PI); }
    if (this.cool > 0 || player.state !== 'ground') return;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    if (dx * dx + dz * dz < this.radius * this.radius && Math.abs(player.pos.y - this.pos.y) < 0.3) {
      player.vel.y = this.power; player.state = 'air'; player.ground = null; player.coyote = 0; player.canPounce = true; player.noCut = true;
      this.cool = 0.25; this.squash = 1;
      this.ctx.game.bounced(this.pos);
    }
  }
}

// ---------------------------------------------------------------------------------------------------- hazards
/** Gusts of wind in a band of the tower: { a0, a1, y0, y1, period = 6, blow = 2.4, strength = 15, phase = 0 } */
export class Wind {
  constructor(ctx, opts) {
    this.ctx = ctx; this.o = { period: 6, blow: 2.4, strength: 15, phase: 0, warn: 0.9, tangent: 0, ...opts };
    this.type = 'wind';
    this.stream = null; this.blowing = false; this.level = 0;
  }
  inside(player, margin = 0) {
    const o = this.o, y = player.pos.y;
    if (y < o.y0 - margin || y > o.y1 + margin) return false;
    if (o.a0 == null) return true;
    let a = (player.angle / DEG - o.a0) % 360; if (a < 0) a += 360;
    let span = (o.a1 - o.a0) % 360; if (span <= 0) span += 360;
    return a <= span;
  }
  update(dt, t, player) {
    const o = this.o;
    const k = ((t + o.phase) % o.period + o.period) % o.period;
    const warn = k > o.period - o.blow - o.warn && k <= o.period - o.blow;
    const blow = k > o.period - o.blow;
    const near = this.inside(player, 6);
    if (!this.stream && this.ctx.particles.stream) {
      this.stream = this.ctx.particles.stream('wind', { dir: new THREE.Vector3(1, 0, 0), size: new THREE.Vector3(16, 9, 16), rate: 0 });
    }
    const a = player.angle, out = _w.set(Math.sin(a), 0, Math.cos(a));
    const dir = _s.copy(out).addScaledVector(_v.set(Math.cos(a), 0, -Math.sin(a)), o.tangent).normalize();
    if (this.stream) {
      this.stream.rate = near ? (blow ? 46 : warn ? 9 : 0) : 0;
      if (this.stream.position) this.stream.position.copy(player.pos).addScaledVector(dir, -3);
      if (this.stream.dir) this.stream.dir.copy(dir);
    }
    if (blow && !this.blowing && near) this.ctx.audio.sfx('wind', { volume: 0.9 });
    if (warn && !this.warned && near) this.ctx.game.tension(0.5);
    this.warned = warn; this.blowing = blow;
    this.level += ((blow ? 1 : 0) - this.level) * Math.min(1, dt * 5);
    if (this.level > 0.02 && this.inside(player) && player.state !== 'climb') {
      player.external.addScaledVector(dir, o.strength * this.level);
    }
  }
}

/** A firework fountain that sprays sparks on a timer. Do not stand in it. */
export class Sparkler {
  constructor(ctx, a, r, y, opts = {}) {
    this.ctx = ctx; this.o = { on: 1.5, off: 2.1, phase: 0, ...opts };
    this.type = 'sparkler';
    this.object = assets.kit('firework_fountain');
    placeCyl(this.object, a, r, y ?? 0);
    this.object.scale.setScalar(1.5);
    ctx.scene.add(this.object);
    this.pos = this.object.position;
    this.needGround = y == null;
    this.stream = null; this.was = false;
  }
  dropToGround(world) {
    const hit = world.raycastDown(_v.set(this.pos.x, 200, this.pos.z), 400);
    if (hit) this.pos.y = hit.point.y;
  }
  update(dt, t, player) {
    const o = this.o, k = ((t + o.phase) % (o.on + o.off));
    const on = k < o.on, soon = k > o.on + o.off - 0.5;
    const d2 = centreOf(player).distanceToSquared(this.pos);
    if (!this.stream && this.ctx.particles.stream) {
      this.stream = this.ctx.particles.stream('spark', { dir: UP.clone(), rate: 0, speed: 7, spread: 0.12 });
    }
    if (this.stream) {
      if (this.stream.position) this.stream.position.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
      this.stream.rate = d2 < 3600 ? (on ? 80 : soon ? 10 : 0) : 0;
    }
    if (on && !this.was && d2 < 400) this.ctx.audio.sfx('spark', { volume: 0.7 });
    this.was = on;
    if (on && this.ctx.game.playing && !this.ctx.game.invulnerable) {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, dy = player.pos.y - this.pos.y;
      if (dx * dx + dz * dz < 0.85 && dy > -0.6 && dy < 3.0) this.ctx.game.hurt(this.pos, { sfx: 'spark' });
    }
  }
}

/** Water is the enemy of all cats. */
export class Water {
  constructor(ctx, pos, radius) { this.ctx = ctx; this.pos = pos; this.radius = radius; }
  update(dt, t, player) {
    if (!this.ctx.game.playing) return;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    if (dx * dx + dz * dz < this.radius * this.radius && player.pos.y < this.pos.y + 0.15 && player.pos.y > this.pos.y - 1.5) {
      this.ctx.particles.burst('splash', _v.set(player.pos.x, this.pos.y + 0.1, player.pos.z), { count: 16 });
      this.ctx.game.hurt(this.pos, { sfx: 'splash', force: true, up: 10, out: 6.5 });
    }
  }
}

/** The front of a moving ride car: bumps Indy if it runs into him. opts: { half: Vector3 (local box), honk } */
export class Bumper {
  constructor(ctx, mover, opts = {}) {
    this.ctx = ctx; this.mover = mover; this.cool = 0; this.honk = 0;
    // long enough to catch Indy when the car's nose is pushing him along (car 1.1 + cat 0.4 from its centre)
    // Narrower than the car itself: grazing its side only pushes Indy aside.
    this.half = opts.half || new THREE.Vector3(1.7, 0.75, 0.72);
    this.centre = opts.centre || new THREE.Vector3(0, 0.55, 0);
  }
  update(dt, t, player) {
    this.cool = Math.max(0, this.cool - dt); this.honk = Math.max(0, this.honk - dt);
    const m = this.mover;
    if (!m.object.visible || !this.ctx.game.playing) return;
    const lp = centreOf(player).applyMatrix4(m.invMatrix);
    const d = lp.sub(this.centre);
    const dist = d.length();
    if (dist < 13 && this.honk <= 0 && d.x > 1) { this.honk = 2.6; this.ctx.audio.sfx('honk', { volume: 0.85 }); this.ctx.game.tension(0.6); }
    if (Math.abs(d.x) < this.half.x && Math.abs(d.y) < this.half.y && Math.abs(d.z) < this.half.z && this.cool <= 0) {
      if (player.ground && player.ground.mover === m) return;      // riding on top is fine
      this.cool = 0.8;
      // knocked toward the tower wall, out of the car's lane, so it rolls on past
      const rr = Math.hypot(player.pos.x, player.pos.z) || 1;
      _w.setFromMatrixPosition(m.matrix);
      this.ctx.game.hurt(_w, { sfx: 'honk', out: 5.2, up: 8.5, dir: _s.set(-player.pos.x / rr, 0, -player.pos.z / rr) });
    }
  }
}

/** Shows a tutorial hint while test(player) is true. */
export class Hint {
  constructor(ctx, test, text) { this.ctx = ctx; this.test = test; this.text = text; this.shown = false; this.done = false; }
  update(dt, t, player) {
    if (this.done) return;
    const want = this.ctx.game.playing && this.test(player);
    if (want && !this.shown) { this.shown = true; this.ctx.game.hint(this.text, this); }
    else if (!want && this.shown) { this.shown = false; this.done = true; this.ctx.game.hint(null, this); }
  }
  reset() { this.done = false; this.shown = false; }
}
