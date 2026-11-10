// The game: owns the scene, the world, Indy, and the state machine (loading, title, play, pause, claim, results).
import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { assets } from './core/assets.js';
import { input } from './core/input.js';
import { settings } from './core/settings.js';
import { LAYER_NO_OUTLINE } from './core/layers.js';
import { audio as rawAudio } from './audio/index.js';

// Sound must never be able to stop the game: a failing audio call is logged once and skipped.
const audioWarned = new Set();
const audio = new Proxy(rawAudio, {
  get(target, key) {
    const v = target[key];
    if (typeof v !== 'function') return v;
    return (...args) => {
      try { return v.apply(target, args); } catch (err) {
        if (!audioWarned.has(key)) { audioWarned.add(key); console.warn(`[audio] ${String(key)} failed:`, err.message || err); }
        return undefined;
      }
    };
  },
});
import { ui } from './ui/index.js';
import { Sky } from './world/sky.js';
import { ParticleSystem } from './fx/particles.js';
import { Fireworks } from './fx/fireworks.js';
import { CollisionWorld } from './world/collision.js';
import { Player, TUNE } from './world/player.js';
import { IndyModel } from './world/indyModel.js';
import { TowerCamera } from './world/camera.js';
import { Level } from './world/level.js';
import { buildLevel, SECTION_NAMES, SECTION_Y, TOP_Y } from './world/leveldata.js';
import { cyl, spin } from './world/movers.js';

const STEP = 1 / 60;
const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.time = 0;              // game time (stops while paused)
    this.acc = 0;
    this.hearts = 3; this.maxHearts = 3;
    this.naps = 0; this.runTime = 0; this.charm = false;
    this.invuln = 0;
    this.section = -1;
    this.checkpoint = null;
    this.respawn = null;        // { t, phase }
    this.meowCool = 0; this.stepDist = 0; this.treatChain = 0; this.treatChainT = 0;
    this.hintOwner = null;
    this.god = false; this.manual = false;
    this.renderPos = new THREE.Vector3();
    this.inp = { x: 0, y: 0, jump: false, jumpPressed: false };
    this.jumpLatch = false; this.meowLatch = false;
    this.claimT = 0;
    this.fps = 60; this.slowFrames = 0;
  }

  get playing() { return this.state === 'play' && !this.respawn; }
  get invulnerable() { return this.invuln > 0 || this.god; }

  // ------------------------------------------------------------------------------------------------ setup
  async init() {
    ui.init(document.getElementById('ui'));
    ui.show('loading', { progress: 0 });
    input.init();
    this.renderer = new Renderer(this.canvas);
    this.renderer.setRetro(!!settings.get('retro'));
    this.scene = new THREE.Scene();
    this.cam = new TowerCamera();
    this.camera = this.cam.camera;

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 10; sc.far = 160;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.intensity = 0.62;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.fog = new THREE.FogExp2(0xcfe6f5, 0.001);

    this.sky = new Sky(this.scene);
    this.particles = new ParticleSystem(this.scene, { max: 4000 });
    this.fireworks = new Fireworks(this.scene);
    this.fireworks.onBurst = (pos, size) => {
      this.sky.flash?.(0.22 * size);
      audio.sfx('firework_burst', { volume: THREE.MathUtils.clamp(40 / this.camera.position.distanceTo(pos), 0.25, 1) });
    };

    await assets.load((p) => ui.show('loading', { progress: p * 0.9 }));
    this._buildWorld();
    ui.show('loading', { progress: 1 });

    audio.setMuted(!!settings.get('muted'));
    audio.setVolumes({ music: settings.get('musicVolume'), sfx: settings.get('sfxVolume') });
    settings.on((key, value) => {
      if (key === 'retro') this.renderer.setRetro(!!value);
      if (key === 'muted') audio.setMuted(!!value);
    });
    const unlock = () => audio.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { passive: true });

    ui.on('start', () => this.startRun());
    ui.on('resume', () => { if (this.state === 'pause') { this.state = 'play'; ui.show('play'); audio.sfx('unpause'); } });
    ui.on('restart', () => this.startRun());
    ui.on('quit', () => this.toTitle());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play') this.pause(); });

    this.toTitle(true);
  }

  _buildWorld() {
    const scene = this.scene;
    this.world = new CollisionWorld();
    this.ctx = { scene, world: this.world, particles: this.particles, audio, game: this };
    this.level = new Level(this.ctx);
    const L = this.level;

    // the landscape
    const env = assets.gltf.environment;
    if (env) {
      env.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
      for (const top of env.scene.children) {
        if (/far|lake|city|hill|shore|island|water/i.test(top.name)) top.traverse((o) => { if (o.isMesh) { o.layers.set(LAYER_NO_OUTLINE); o.receiveShadow = false; } });
      }
      this.clouds = env.scene.getObjectByName('clouds');
      if (this.clouds) {
        this.clouds.removeFromParent();
        this.clouds.traverse((o) => { if (o.isMesh) { o.receiveShadow = false; o.layers.set(LAYER_NO_OUTLINE); } });
        scene.add(this.clouds);
      }
      L.root.add(env.scene);
    }
    // the tower; its restaurant tier revolves
    const tower = assets.gltf.tower;
    if (tower) {
      const rest = tower.scene.getObjectByName('restaurant');
      if (rest) { rest.removeFromParent(); L.mover(rest, spin({ speed: 7 })); }
      L.root.add(tower.scene);
      L._registerStatic(tower.scene);
      this.beacons = ['beacon_1', 'beacon_2', 'beacon_3'].map((n) => tower.scene.getObjectByName(n)).filter(Boolean);
      for (const b of this.beacons) { b.userData.noMerge = true; b.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.userData.base = o.material.color.clone(); } }); }
    }
    buildLevel(L);
    L.finish();

    this.player = new Player(this.world);
    this.indy = new IndyModel();
    scene.add(this.indy.root, this.indy.blob);
    this._placeAtSpawn();
  }

  _placeAtSpawn() {
    const s = this.level.spawn;
    this.player.teleport(cyl(s.a, s.r, s.y), s.a * DEG + Math.PI);
    this.renderPos.copy(this.player.pos);
  }

  // ------------------------------------------------------------------------------------------------ states
  toTitle(first = false) {
    const go = () => {
      this.state = 'title';
      this.level.reset(); this._resetRun();
      this._placeAtSpawn();
      this.player.yaw = (this.level.spawn.a + 20) * DEG;
      this.player.frozen = true;
      this.indy.forced = 'sit'; this.indy.hat(true);
      this.cam.mode = 'title';
      this._stopShow();
      ui.show('title');
      audio.setMusic('title');
      audio.loop('wind_high', false); audio.loop('crowd', true, { volume: 0.5 });
      this._setBeacon(null);
    };
    if (first) { go(); ui.fade(true, 0).then(() => ui.fade(false, 0.8)); }
    else ui.fade(true, 0.35).then(() => { go(); ui.fade(false, 0.5); });
  }

  _resetRun() {
    this.hearts = this.maxHearts = 3; this.naps = 0; this.runTime = 0; this.charm = false;
    this.invuln = 0; this.section = -1; this.checkpoint = null; this.respawn = null; this.claimT = 0;
    this.hintOwner = null; ui.hint(null);
  }

  startRun() {
    audio.unlock();
    ui.fade(true, 0.3).then(() => {
      this.level.reset(); this._resetRun(); this._stopShow();
      this._placeAtSpawn();
      this.player.frozen = false;
      this.indy.forced = null; this.indy.hat(false);
      this.cam.follow(); this.cam.snap(this.player);
      this.state = 'play';
      ui.show('play');
      audio.setMusic('climb'); audio.setSection(0); audio.setProgress(0);
      this._setBeacon(null);
      ui.fade(false, 0.45);
    });
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    ui.show('pause');
    audio.sfx('pause');
  }

  // ------------------------------------------------------------------------------------------------ hooks for entities
  hint(text, owner) {
    if (text) { this.hintOwner = owner; ui.hint(text); }
    else if (this.hintOwner === owner) { this.hintOwner = null; ui.hint(null); }
  }
  tension(x) { audio.setTension(x); this.tensionT = 1.2; }
  canHeal() { return this.hearts < this.maxHearts; }
  charmed() { /* a visitor said aww */ }
  bounced(pos) { audio.sfx('bounce'); this.indy.jumpPulse(); this.particles.burst('land', pos); }

  collect(kind, pos) {
    if (kind === 'treat') {
      this.treatChain = this.treatChainT > 0 ? Math.min(12, this.treatChain + 1) : 0;
      this.treatChainT = 1.2;
      audio.sfx('treat', { pitch: 1 + this.treatChain * 0.06, volume: 0.8 });
      this.particles.burst('sparkle', pos, { count: 8 });
    } else if (kind === 'heart') {
      this.hearts = Math.min(this.maxHearts, this.hearts + 1);
      audio.sfx('heart'); this.particles.burst('heart', pos);
    } else if (kind === 'charm') {
      this.charm = true; this.maxHearts = 4; this.hearts = 4;
      audio.sfx('charm'); audio.duck(0.6, 1.6);
      this.particles.burst('star', pos, { count: 18 });
      ui.toast('Nine Lives charm! One more heart.', 3200);
    }
  }

  setCheckpoint(cp) {
    if (this.checkpoint && cp.index <= this.checkpoint.index && cp.pos.y <= this.checkpoint.pos.y) { return; }
    const first = !this.checkpoint;
    this.checkpoint = cp;
    if (cp.index === 0 && first) return;
    audio.sfx('checkpoint'); audio.duck(0.5, 1.2);
    this.particles.burst('star', _v.copy(cp.pos).setY(cp.pos.y + 1), { count: 10 });
    ui.toast('Checkpoint!', 1800);
    if (this.hearts < this.maxHearts) this.hearts++;
  }

  /** Something hurt Indy. opts: { sfx, force, out, up } */
  hurt(source, opts = {}) {
    if (this.god || (this.invuln > 0 && !opts.force) || !this.playing) return;
    const p = this.player;
    this.hearts--;
    this.invuln = 1.7;
    _v.set(p.pos.x - source.x, 0, p.pos.z - source.z);
    if (_v.lengthSq() < 0.01) _v.set(p.pos.x, 0, p.pos.z);
    _v.normalize();
    p.state = 'air'; p.climb = null; p.ground = null; p.regrab = 0.5; p.pouncing = false; p.noCut = true; p.vaultT = 0;
    p.vel.set(_v.x * (opts.out ?? 5.5), opts.up ?? 8, _v.z * (opts.out ?? 5.5));
    this.indy.hurt();
    audio.meow('hurt'); audio.sfx('hurt');
    if (opts.sfx && opts.sfx !== 'gull' && opts.sfx !== 'jackdaw') audio.sfx(opts.sfx);
    ui.flash('#ff3b30', 0.3);
    this.cam.shake = 0.9;
    this.particles.burst('hurt', _w.set(p.pos.x, p.pos.y + 0.6, p.pos.z));
    if (this.hearts <= 0) this._startRespawn(true);
  }

  _startRespawn(nap) {
    if (this.respawn) return;
    this.respawn = { t: 0, nap, moved: false };
    ui.fade(true, 0.3);
    if (nap) this.naps++;
  }

  _doRespawn() {
    const cp = this.checkpoint;
    if (cp) this.player.teleport(cp.respawn, (cp.a + 90) * DEG);
    else this._placeAtSpawn();
    if (this.respawn.nap) { this.hearts = this.maxHearts; ui.toast('Indy took a nap. Back to the box!', 2200); }
    this.invuln = 1.5;
    this.cam.snap(this.player);
    audio.sfx('respawn');
  }

  // ------------------------------------------------------------------------------------------------ frame
  frame(dt) {
    input.poll();
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    dt = Math.min(dt, 0.1);

    if (input.pressed('jump')) this.jumpLatch = true;
    if (input.pressed('meow')) this.meowLatch = true;
    if (this.state === 'play' && input.pressed('pause')) this.pause();
    if (this.state === 'claim' && this.claimT > 3.5 && (input.pressed('confirm') || input.pressed('jump'))) this._toResults();

    if (!this.manual) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 5) { this.acc -= STEP; this.fixed(STEP); n++; }
      if (n === 5) this.acc = 0;
    }
    ui.tick();
    this.draw(dt);
  }

  /** One fixed step of the simulation. */
  fixed(dt) {
    if (this.state === 'pause' || this.state === 'loading') return;
    this.time += dt;
    const p = this.player, L = this.level;
    L.updateMovers(this.time);
    p.external.set(0, 0, 0);

    const control = this.state === 'play' && !this.respawn;
    const inp = this.inp;
    inp.x = control ? input.moveX : 0; inp.y = control ? input.moveY : 0;
    inp.jump = control && input.jump; inp.jumpPressed = control && this.jumpLatch;
    const meow = control && this.meowLatch;
    this.jumpLatch = false; this.meowLatch = false;

    L.update(dt, this.time, p);         // entities may push Indy (wind) before he moves
    p.step(dt, inp, this.cam.angle);
    this._playerEvents(dt);

    if (this.state === 'play') {
      this.runTime += dt;
      this.invuln = Math.max(0, this.invuln - dt);
      this.meowCool = Math.max(0, this.meowCool - dt);
      this.treatChainT = Math.max(0, this.treatChainT - dt);
      if (this.tensionT > 0) { this.tensionT -= dt; if (this.tensionT <= 0) audio.setTension(0); }
      if (meow && this.meowCool <= 0) this._meow();
      this._sections();
      if (this.respawn) {
        const r = this.respawn; r.t += dt;
        if (r.t > 0.35 && !r.moved) { r.moved = true; this._doRespawn(); ui.fade(false, 0.35); }
        if (r.t > 0.6) this.respawn = null;
      }
      // the top: sit on the perch and the tower is yours
      if (control && p.state === 'ground' && p.pos.y > TOP_Y - 0.3) this._claim();
    } else if (this.state === 'claim') {
      this.claimT += dt;
      if (this.claimT > 12 && ui.screen === 'claim') this._toResults();
    }
  }

  _playerEvents(dt) {
    const p = this.player, P = this.particles;
    for (const ev of p.events) {
      if (ev === 'jump') { audio.sfx('jump'); if (Math.random() < 0.35) audio.meow('chirp'); this.indy.jumpPulse(); P.burst('jump', p.pos); }
      else if (ev === 'pounce') { audio.sfx('pounce'); this.indy.jumpPulse(); P.burst('dust', p.pos, { count: 4 }); }
      else if (ev === 'land') { const hard = p.landImpact > 9; audio.sfx('land', { volume: hard ? 1 : 0.55 }); this.indy.landPulse(p.landImpact); if (hard) P.burst('land', p.pos); }
      else if (ev === 'grab') audio.sfx('climb');
      else if (ev === 'vault') { audio.sfx('vault'); this.indy.jumpPulse(); }
      else if (ev === 'fell' && this.state === 'play' && !this.respawn) {
        audio.sfx('fall');
        const low = (this.checkpoint ? this.checkpoint.pos.y : 0) < 3 && p.pos.y < 3;
        if (!low && !this.god) { this.hearts--; audio.meow('hurt'); }
        this._startRespawn(this.hearts <= 0);
      }
    }
    if (p.state === 'ground' && p.speed > 2) {
      this.stepDist += p.speed * dt;
      if (this.stepDist > 1.25) { this.stepDist = 0; audio.sfx('step', { volume: 0.3, pitch: 0.9 + Math.random() * 0.25 }); if (Math.random() < 0.5) P.burst('dust', p.pos, { count: 1 }); }
    } else if (p.state === 'climb' && Math.abs(p.climbMove) > 0.5) {
      this.stepDist += Math.abs(p.climbMove) * dt;
      if (this.stepDist > 0.9) { this.stepDist = 0; audio.sfx('climb', { volume: 0.4, pitch: 0.9 + Math.random() * 0.3 }); }
    }
  }

  _meow() {
    const p = this.player;
    this.meowCool = 0.6;
    audio.meow('meow');
    this.indy.meow();
    _v.set(p.pos.x + Math.sin(p.yaw) * 0.5, p.pos.y + 0.75, p.pos.z + Math.cos(p.yaw) * 0.5);
    this.particles.burst('meow', _v, { dir: _w.set(Math.sin(p.yaw), 0.15, Math.cos(p.yaw)) });
    this.level.meow(p.pos);
  }

  _sections() {
    const p = this.player;
    if (p.state === 'air') return;
    let s = 0;
    for (let i = SECTION_Y.length - 1; i >= 0; i--) if (p.pos.y >= SECTION_Y[i]) { s = i; break; }
    if (s === 1) {
      // the wheel only counts once Indy is actually on it
      const onWheel = p.ground && p.ground.mover && p.ground.mover.name === 'ferris_gondola';
      if (!onWheel && this.section < 1) s = 0;
      else if (!onWheel && p.pos.y < 4) s = this.section >= 1 ? 1 : 0;
    }
    if (s !== this.section) {
      const first = this.section < 0;
      this.section = s;
      audio.setSection(s);
      ui.banner(SECTION_NAMES[s], first ? 'Climb it to claim it' : `${Math.round(p.pos.y * 1.2)} m`);
    }
  }

  _setBeacon(color) {
    for (const b of this.beacons || []) b.traverse((o) => { if (o.isMesh) o.material.color.copy(color ? _c.set(color).multiplyScalar(2.2) : o.userData.base); });
  }

  _claim() {
    const p = this.player;
    this.state = 'claim'; this.claimT = 0;
    p.frozen = true; p.vel.set(0, 0, 0);
    p.pos.set(0, TOP_Y, 0);
    p.yaw = this.cam.angle;
    this.indy.forced = 'sit';
    ui.hint(null);
    ui.show('claim', { text: 'NÄSINNEULA CLAIMED!' });
    audio.setMusic('claim'); audio.meow('happy');
    setTimeout(() => audio.meow('purr'), 1600);
    this.cam.startOrbit({ angle: this.cam.angle, speed: 0.16, radius: 7.5, height: TOP_Y + 2.2, target: new THREE.Vector3(0, TOP_Y + 0.5, 0) });
    this._setBeacon('#ff7ac0');
    this.particles.burst('star', _v.set(0, TOP_Y + 1, 0), { count: 24 });
    this.particles.burst('confetti', _v.set(0, TOP_Y + 2.5, 0), { count: 60 });
    this.show = this.fireworks.show(new THREE.Vector3(0, 60, 0), { radius: 95, minY: 105, maxY: 160, launchY: 30, rate: 1.7, size: 1.3 });
  }

  _stopShow() { if (this.show) { this.show.stop(); this.show = null; } }

  _toResults() {
    const total = this.level.treats.total, got = this.level.treats.taken;
    const frac = total ? got / total : 1;
    let score = frac * 50 + Math.max(0, 30 - this.naps * 10) + (this.charm ? 10 : 0) + Math.max(0, 10 - Math.max(0, this.runTime - 420) / 30);
    const rank = score >= 90 ? 'S' : score >= 72 ? 'A' : score >= 50 ? 'B' : 'C';
    this.state = 'results';
    ui.show('results', { treats: got, treatsTotal: total, timeSec: this.runTime, naps: this.naps, charm: this.charm, rank });
    audio.setMusic('results');
  }

  // ------------------------------------------------------------------------------------------------ render
  draw(dt) {
    const p = this.player;
    const paused = this.state === 'pause';
    const adt = paused ? 0 : dt;
    // interpolate between fixed steps unless Indy rides something (then stay locked to it)
    const riding = (p.ground && p.ground.mover) || (p.climb && p.climb.mover) || this.manual;
    const alpha = riding ? 1 : THREE.MathUtils.clamp(this.acc / STEP, 0, 1);
    this.renderPos.lerpVectors(p.prevPos, p.pos, alpha);

    this.indy.update(adt, p, this.renderPos, this.world, { invuln: this.state === 'play' ? this.invuln : 0, happy: this.state === 'claim' || this.state === 'results' });

    // camera
    if (this.cam.mode === 'title') {
      const s = this.level.spawn, t = performance.now() / 1000;
      const a = s.a - 9 + Math.sin(t * 0.21) * 2.5;
      cyl(a, s.r + 5.4 + Math.sin(t * 0.17) * 0.4, 0.75 + Math.sin(t * 0.13) * 0.2, this.camera.position);
      this.camera.lookAt(_v.set(0, 17, 0).lerp(p.pos, 0.3));
      this.cam.angle = a * DEG;
    } else if (!paused) {
      if (this.state === 'claim' || this.state === 'results') {
        const o = this.cam.orbit;
        o.radius += (30 - o.radius) * Math.min(1, dt * 0.22);
        o.height += (TOP_Y + 7 - o.height) * Math.min(1, dt * 0.22);
      }
      this.cam.update(dt, p, this.renderPos);
    }

    // time of day follows the altitude
    const y = this.state === 'title' ? 0 : this.state === 'claim' || this.state === 'results' ? 140 : this.renderPos.y;
    const want = THREE.MathUtils.clamp((y - 8) / 122, 0, 1);
    this.dayT = this.dayT == null ? want : this.dayT + (want - this.dayT) * Math.min(1, dt * 1.5);
    this.sky.setTime(this.dayT);
    this.sky.update(adt, this.camera);
    const st = this.sky.state;
    this.sun.color.copy(st.sunColor); this.sun.intensity = st.sunIntensity;
    this.hemi.color.copy(st.hemiSky); this.hemi.groundColor.copy(st.hemiGround); this.hemi.intensity = st.hemiIntensity;
    this.scene.fog.color.copy(st.fogColor); this.scene.fog.density = st.fogDensity;
    assets.setGlow(st.glow);
    // the key light keeps a readable angle even when the sun is on the horizon
    _v.copy(st.lightDir || st.sunDir);
    const horiz = Math.hypot(_v.x, _v.z) || 1;
    const elev = Math.max(Math.atan2(_v.y, horiz), 40 * DEG);
    _v.set(_v.x / horiz * Math.cos(elev), Math.sin(elev), _v.z / horiz * Math.cos(elev));
    this.sun.target.position.copy(this.renderPos);
    this.sun.position.copy(this.renderPos).addScaledVector(_v, 70);

    if (this.clouds) this.clouds.rotation.y = this.time * 0.004;
    this.particles.update(adt);
    this.fireworks.update(adt);
    if (this.state === 'play' || this.state === 'claim') this._mortars(adt);

    // audio and HUD
    audio.update(dt);
    if (this.state === 'play') {
      audio.setProgress(THREE.MathUtils.clamp(this.renderPos.y / TOP_Y, 0, 1));
      audio.loop('wind_high', true, { volume: THREE.MathUtils.smoothstep(this.renderPos.y, 30, 115) });
      audio.loop('crowd', this.renderPos.y < 30, { volume: 0.55 * (1 - THREE.MathUtils.smoothstep(this.renderPos.y, 4, 28)) });
      ui.update({ hearts: this.hearts, maxHearts: this.maxHearts, treats: this.level.treats.taken, treatsTotal: this.level.treats.total,
        altitude: Math.max(0, this.renderPos.y * 1.2), altitudeMax: 168, charm: this.charm, timeSec: this.runTime });
    }

    this.renderer.render(this.scene, this.camera);
    this._autoQuality(dt);
  }

  _mortars(dt) {
    // the launch tubes on the roof fire once the evening comes
    if (!this.level.mortars || this.dayT < 0.55) return;
    this.mortarT = (this.mortarT || 0) - dt;
    if (this.mortarT > 0) return;
    this.mortarT = 2.5 + Math.random() * 3;
    const m = this.level.mortars[(Math.random() * this.level.mortars.length) | 0];
    m.getWorldPosition(_v); _v.y += 1;
    this.fireworks.launch(_v, { height: 34 + Math.random() * 14, style: 'random', size: 0.9 });
    if (this.camera.position.distanceTo(_v) < 60) audio.sfx('firework_launch', { volume: 0.6 });
  }

  _autoQuality(dt) {
    // drop the resolution a little if the machine cannot hold 50 fps
    if (this.renderer.retro || document.hidden || this.manual) return;
    this.slowFrames = this.fps < 45 ? this.slowFrames + dt : Math.max(0, this.slowFrames - dt * 0.5);
    if (this.slowFrames > 3 && this.renderer.quality > 0.6) {
      this.renderer.quality = Math.max(0.6, this.renderer.quality - 0.15);
      this.renderer.resize(); this.slowFrames = 0;
    }
  }
}
const _c = new THREE.Color();
