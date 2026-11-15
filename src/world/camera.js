// The tower camera. It always sits outside the player on the line from the tower axis, looking inward, and orbits
// by itself as Indy runs around the tower. No manual camera control is needed.
import * as THREE from 'three';
import { angleDiff } from './player.js';

const _t = new THREE.Vector3();

export class TowerCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 4000);
    this.angle = 0;          // radians around the tower
    this.radius = 20;
    this.height = 4;
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.mode = 'follow';    // 'follow' | 'orbit'
    this.orbit = { angle: 0, speed: 0.1, radius: 30, height: 8, target: new THREE.Vector3(), fov: 50 };
    this.zoom = 1;
    // help from the level's camera zones (Level.camHelp): how far the camera runs ahead of Indy round the tower, and
    // how much higher it rides (so that gaps and landing spots are seen more from above). `want` is set by the game.
    this.want = { lead: 1, lift: 0 };
    this.leadScale = 1; this.lift = 0;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const aspect = innerWidth / Math.max(1, innerHeight);
    this.camera.aspect = aspect;
    // keep a comfortable horizontal view on tall phone screens
    this.portrait = aspect < 1 ? Math.min(1.25, 1 / aspect) : 1;
    this.camera.fov = aspect < 1 ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the follow position (after a teleport). */
  snap(player) {
    this.angle = player.radial > 1 ? player.angle : this.angle;
    this.leadScale = this.want.lead; this.lift = this.want.lift;
    const want = this._want(player);
    this.radius = want.radius; this.height = want.height;
    this.look.copy(want.look);
    this._apply();
  }

  _want(player, pos = player.pos) {
    const r = Math.hypot(pos.x, pos.z);
    const dist = (11.5 + Math.min(4, r * 0.06)) * this.portrait * this.zoom;
    let radius = Math.max(r + dist, 15);
    let height = pos.y + 3.3 + Math.min(2.2, pos.y * 0.012) + this.lift;
    // out on the plaza the camera rides a little higher, so the hedge behind Indy stays below the frame
    if (pos.y < 8) height += 1.3 * THREE.MathUtils.smoothstep(r, 15, 25) * (1 - THREE.MathUtils.smoothstep(pos.y, 3, 8));
    // look at Indy, pulled slightly toward the tower so it stays in frame
    _t.set(pos.x * 0.9, pos.y + 1.15, pos.z * 0.9);
    return { radius, height, look: _t };
  }

  update(dt, player, pos = player.pos) {
    if (this.mode === 'orbit') {
      const o = this.orbit;
      o.angle += o.speed * dt;
      this.camera.position.set(Math.sin(o.angle) * o.radius, o.height, Math.cos(o.angle) * o.radius);
      this.camera.lookAt(o.target);
      this.angle = o.angle;
      return;
    }
    const r = Math.hypot(pos.x, pos.z);
    const pa = Math.atan2(pos.x, pos.z);
    this.leadScale += (this.want.lead - this.leadScale) * Math.min(1, dt * 1.5);
    this.lift += (this.want.lift - this.lift) * Math.min(1, dt * 1.5);
    if (r > 0.9) {
      // follow Indy's angle around the tower; slower near the axis where the angle swings wildly
      // (but keep up when he climbs round a pole, so that 'up' on the stick stays 'toward the pole')
      const k = Math.max(THREE.MathUtils.smoothstep(r, 0.9, 4), player.state === 'climb' ? 0.85 : 0);
      const ls = this.leadScale;
      const lead = THREE.MathUtils.clamp((player.vel.x * Math.cos(pa) - player.vel.z * Math.sin(pa)) / Math.max(r, 5) * 0.35 * ls, -0.3 * ls, 0.3 * ls);
      this.angle += angleDiff(this.angle, pa + lead) * Math.min(1, dt * (1.2 + 3.6 * k));
    }
    const want = this._want(player, pos);
    this.radius += (want.radius - this.radius) * Math.min(1, dt * 3.5);
    const fast = player.vel.y < -12 ? 9 : 4.5;
    this.height += (want.height - this.height) * Math.min(1, dt * fast);
    this.look.lerp(want.look, Math.min(1, dt * 9));
    this._apply();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
  }

  _apply() {
    this.camera.position.set(Math.sin(this.angle) * this.radius, this.height, Math.cos(this.angle) * this.radius);
    this.camera.lookAt(this.look);
  }

  startOrbit(opts) {
    Object.assign(this.orbit, opts);
    if (opts.target) this.orbit.target = opts.target.clone ? opts.target.clone() : this.orbit.target;
    this.mode = 'orbit';
  }

  follow() { this.mode = 'follow'; }
}
