// Indy's movement: a custom kinematic controller (no physics engine) tuned for platforming feel.
// Run with acceleration, variable-height jump, coyote time, jump buffering, a mid-air pounce, climbing on marked
// surfaces and poles, riding movers. Fixed timestep, deterministic.
import * as THREE from 'three';

export const TUNE = {
  radius: 0.4,
  stepUp: 0.24,           // ground sphere floats this high so small steps do not block
  runSpeed: 6.4,
  accel: 60, decel: 55, turnAccel: 95,
  airAccel: 30, airDrag: 1.2,
  gravity: 34, fallMult: 1.3, lowJumpMult: 2.3, maxFall: 27,
  jumpSpeed: 13.2,        // about 2.55 high
  coyote: 0.11, buffer: 0.13,
  pounceSpeed: 10.8, pounceUp: 6.2, pounceDecay: 2.6,
  climbUp: 3.6, climbDown: 4.6, climbSide: 2.8, climbOffset: 0.44,
  leapOut: 5.4, leapUp: 10.6,
  snapDown: 0.36,
  scrambleReach: 0.62,    // a ledge this far ahead of Indy...
  scrambleMax: 0.9,       // ...and at most this far above his feet is clawed up instead of missed
  rescueDrop: 17,         // falling this far below the last footing triggers a rescue
};

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hit = {};
const _hits = [{}, {}, {}, {}, {}];
const PROBE = [[0, 0], [0.24, 0], [-0.24, 0], [0, 0.24], [0, -0.24]];
const _wish = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _inw = new THREE.Vector3();
const _planeC = new THREE.Vector3();
const _planeN = new THREE.Vector3();
const _planeR = new THREE.Vector3();

function approach(cur, target, maxDelta) {
  return cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target);
}
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;                 // facing, radians (model +Z)
    this.state = 'air';           // 'ground' | 'air' | 'climb'
    this.ground = null;           // collider stood on
    this.climb = null;
    this.climbU = 0; this.climbPhi = 0;
    this.climbMove = 0;           // signed climb speed, for the animation
    this.coyote = 0; this.buffer = 0; this.regrab = 0;
    this.canPounce = true; this.pouncing = false;
    this.jumpHeldLast = false;
    this.lastGroundY = 0;
    this.airTime = 0;
    this.events = [];
    this.frameAngle = 0;
    this.external = new THREE.Vector3();   // wind etc., units/s^2, set by the game each step
    this.vault = new THREE.Vector3(); this.vaultT = 0;
    this.scrambleCool = 0;
    this.frozen = false;
    this.speed = 0;
  }

  teleport(p, yaw = this.yaw) {
    this.pos.copy(p); this.prevPos.copy(p); this.vel.set(0, 0, 0);
    this.state = 'air'; this.ground = null; this.climb = null; this.yaw = yaw;
    this.lastGroundY = p.y; this.coyote = 0; this.buffer = 0; this.canPounce = true; this.pouncing = false;
    this.airTime = 0; this.regrab = 0.3; this.vaultT = 0; this.noCut = false; this.hoppedOff = null;
    this.scrambleCool = 0;
  }

  get radial() { return Math.hypot(this.pos.x, this.pos.z); }
  get angle() { return Math.atan2(this.pos.x, this.pos.z); }

  /** inp: { x, y, jump (held), jumpPressed }. camAngle: camera angle around the tower (radians). */
  step(dt, inp, camAngle) {
    const T = TUNE, world = this.world;
    this.prevPos.copy(this.pos);
    this.events.length = 0;
    if (this.frozen) { this._carry(); return; }

    this.coyote = Math.max(0, this.coyote - dt);
    this.buffer = Math.max(0, this.buffer - dt);
    this.regrab = Math.max(0, this.regrab - dt);
    this.scrambleCool = Math.max(0, this.scrambleCool - dt);
    if (inp.jumpPressed) this.buffer = T.buffer;

    this._carry();

    // Movement frame: "right" runs around the tower, "up" goes toward it. Near the axis, use the camera's frame.
    const r = this.radial;
    const k = THREE.MathUtils.smoothstep(r, 1.2, 3.2);
    this.frameAngle = camAngle + angleDiff(camAngle, this.angle) * k;
    const fa = this.frameAngle;
    _tan.set(Math.cos(fa), 0, -Math.sin(fa));
    _inw.set(-Math.sin(fa), 0, -Math.cos(fa));
    _wish.copy(_tan).multiplyScalar(inp.x).addScaledVector(_inw, inp.y);
    const wishLen = Math.min(1, _wish.length());
    if (wishLen > 1e-3) _wish.normalize();

    if (this.state === 'climb') this._stepClimb(dt, inp);
    else if (this.state === 'ground') this._stepGround(dt, inp, wishLen);
    else this._stepAir(dt, inp, wishLen);

    // facing
    if (this.state !== 'climb') {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (wishLen > 0.1 || sp > 1.5) {
        const target = wishLen > 0.1 ? Math.atan2(_wish.x, _wish.z) : Math.atan2(this.vel.x, this.vel.z);
        this.yaw += angleDiff(this.yaw, target) * Math.min(1, dt * 16);
      }
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // fell off the world or a long way down
    if (this.state === 'ground' || this.state === 'climb') this.lastGroundY = this.pos.y;
    else if (this.pos.y > this.lastGroundY) this.lastGroundY = Math.max(this.lastGroundY, this.pos.y - 3);
    if (this.pos.y < -7 || (this.state === 'air' && this.pos.y < this.lastGroundY - T.rescueDrop)) this.events.push('fell');
    this.jumpHeldLast = inp.jump;
  }

  _carry() {
    const m = this.state === 'ground' ? this.ground && this.ground.mover : this.state === 'climb' ? this.climb && this.climb.mover : null;
    if (!m) return;
    _v.copy(this.pos);
    m.carry(this.pos);
    // turn with a rotating platform
    _w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).transformDirection(m.delta);
    this.yaw = Math.atan2(_w.x, _w.z);
    this.platformVel = (this.platformVel || new THREE.Vector3()).copy(this.pos).sub(_v);
  }

  _jump(extraUp = 0) {
    const T = TUNE;
    this.vel.y = T.jumpSpeed + extraUp;
    if (this.state === 'ground' && this.ground && this.ground.mover && this.platformVel) {
      // keep the platform's motion
      this.vel.x += this.platformVel.x * 60; this.vel.z += this.platformVel.z * 60;
      if (this.platformVel.y > 0) this.vel.y += this.platformVel.y * 60 * 0.6;
    }
    this.state = 'air'; this.ground = null; this.coyote = 0; this.buffer = 0; this.airTime = 0; this.noCut = false;
    this.events.push('jump');
  }

  _stepGround(dt, inp, wishLen) {
    const T = TUNE, world = this.world;
    // horizontal velocity toward the wish
    const tx = _wish.x * wishLen * T.runSpeed, tz = _wish.z * wishLen * T.runSpeed;
    const reversing = this.vel.x * tx + this.vel.z * tz < 0;
    const acc = (wishLen > 0.01 ? (reversing ? T.turnAccel : T.accel) : T.decel) * dt;
    _v.set(tx - this.vel.x, 0, tz - this.vel.z);
    const d = _v.length();
    if (d > acc) _v.multiplyScalar(acc / d);
    this.vel.x += _v.x; this.vel.z += _v.z; this.vel.y = 0;
    this.vel.x += this.external.x * dt * 0.35; this.vel.z += this.external.z * dt * 0.35;

    if (this.buffer > 0) { this._jump(); this._stepAir(dt, inp, wishLen, true); return; }

    // climbing: walk into a climbable to grab it
    if (wishLen > 0.4 && this.regrab <= 0 && this._tryGrab(true)) return;

    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    _c.set(this.pos.x, this.pos.y + T.radius + T.stepUp, this.pos.z);
    const ct = world.resolveSphere(_c, T.radius);
    this.pos.x = _c.x; this.pos.z = _c.z;
    if (ct.pushed.x || ct.pushed.z) {
      _n.set(ct.pushed.x, 0, ct.pushed.z);
      if (_n.lengthSq() > 1e-10) { _n.normalize(); const vn = this.vel.x * _n.x + this.vel.z * _n.z; if (vn < 0) { this.vel.x -= _n.x * vn; this.vel.z -= _n.z * vn; } }
    }
    // follow the ground
    const hit = this._probe(0.6, 0.6 + T.snapDown, this.pos.y + 0.34);
    if (hit) {
      this.pos.y = hit.point.y;
      this.ground = hit.collider;
      this.canPounce = true; this.pouncing = false; this.hoppedOff = null;
    } else {
      this.state = 'air'; this.ground = null; this.coyote = T.coyote; this.airTime = 0;
      if (this.platformVel && this.platformVel.lengthSq() > 0) { /* stepping off keeps going naturally */ }
    }
  }

  _stepAir(dt, inp, wishLen, justJumped = false) {
    const T = TUNE, world = this.world;
    this.airTime += dt;
    if (!justJumped && this.buffer > 0) {
      if (this.coyote > 0) { this.state = 'ground'; this._jump(); }
      else if (this.canPounce) {
        // the pounce: a lunge in the direction held (or faced)
        if (wishLen > 0.2) _v.copy(_wish); else _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.vel.x = _v.x * T.pounceSpeed; this.vel.z = _v.z * T.pounceSpeed;
        this.vel.y = Math.max(this.vel.y * 0.25, T.pounceUp);
        this.canPounce = false; this.pouncing = true; this.buffer = 0;
        this.yaw = Math.atan2(_v.x, _v.z);
        this.events.push('pounce');
      }
    }
    // gravity with a snappier fall and a short hop when the button is released early
    let g = T.gravity;
    if (this.vel.y < 0) g *= T.fallMult;
    else if (!inp.jump && !this.pouncing && !this.noCut) g *= T.lowJumpMult;
    this.vel.y = Math.max(-T.maxFall, this.vel.y - g * dt);

    // air control
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.vaultT > 0) { /* committed to the hop */ } else if (sp > T.runSpeed) {
      const ns = Math.max(T.runSpeed, sp - T.pounceDecay * dt * (sp - T.runSpeed + 1));
      this.vel.x *= ns / sp; this.vel.z *= ns / sp;
      if (wishLen > 0.01) {            // steer without adding speed
        this.vel.x += _wish.x * T.airAccel * 0.5 * dt; this.vel.z += _wish.z * T.airAccel * 0.5 * dt;
        const s2 = Math.hypot(this.vel.x, this.vel.z);
        if (s2 > ns) { this.vel.x *= ns / s2; this.vel.z *= ns / s2; }
      }
    } else if (wishLen > 0.01) {
      const tx = _wish.x * wishLen * T.runSpeed, tz = _wish.z * wishLen * T.runSpeed;
      _v.set(tx - this.vel.x, 0, tz - this.vel.z);
      const d = _v.length(), acc = T.airAccel * dt;
      if (d > acc) _v.multiplyScalar(acc / d);
      this.vel.x += _v.x; this.vel.z += _v.z;
    } else {
      const f = Math.max(0, 1 - T.airDrag * dt);
      this.vel.x *= f; this.vel.z *= f;
    }
    this.vel.x += this.external.x * dt; this.vel.z += this.external.z * dt; this.vel.y += this.external.y * dt;

    if (this.vaultT > 0) {
      // hopping over the top of a climb: keep heading in over the ledge even if its edge was touched
      this.vaultT -= dt;
      this.vel.x = this.vault.x; this.vel.z = this.vault.z;
      if (this.vaultT <= 0) { this.vel.x = 0; this.vel.z = 0; }     // the hop carries just far enough
    }
    // move in small steps so nothing is tunnelled through
    const dist = this.vel.length() * dt;
    const n = Math.max(1, Math.ceil(dist / 0.3));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
      this.pos.addScaledVector(this.vel, sdt);
      _c.set(this.pos.x, this.pos.y + T.radius, this.pos.z);
      const ct = world.resolveSphere(_c, T.radius);
      this.pos.set(_c.x, _c.y - T.radius, _c.z);
      if (ct.hitHead && this.vel.y > 0) this.vel.y = 0;
      if (ct.pushed.x || ct.pushed.z) {
        _n.set(ct.pushed.x, 0, ct.pushed.z);
        if (_n.lengthSq() > 1e-10) { _n.normalize(); const vn = this.vel.x * _n.x + this.vel.z * _n.z; if (vn < 0) { this.vel.x -= _n.x * vn; this.vel.z -= _n.z * vn; } }
      }
      if (this.vel.y <= 0) {
        const hit = this._probe(0.5, 0.5 + 0.04, this.pos.y + 0.3);
        if (hit) { this._land(hit); return; }
      }
    }
    if (this.regrab <= 0 && this._tryGrab(false)) return;
    if (this.vaultT <= 0 && this.regrab <= 0 && this.scrambleCool <= 0 && this.vel.y < 2.5) this._tryScramble(wishLen);
  }

  /**
   * The ledge scramble: Indy has all but made a jump, with the edge of a platform just ahead of him and its top a
   * little above his feet. Like any cat he claws his way up: a short committed hop onto it, as at the top of a climb.
   */
  _tryScramble(wishLen) {
    const T = TUNE, world = this.world;
    let dx, dz;
    if (wishLen > 0.3) { dx = _wish.x; dz = _wish.z; }
    else { const sp = Math.hypot(this.vel.x, this.vel.z); if (sp < 1.5) return false; dx = this.vel.x / sp; dz = this.vel.z / sp; }
    // the first surface under a point ahead of him, looking from well above the highest ledge he can reach
    _v.set(this.pos.x + dx * T.scrambleReach, this.pos.y + T.scrambleMax + 0.8, this.pos.z + dz * T.scrambleReach);
    const hit = world.raycastDown(_v, T.scrambleMax + 0.8 - 0.15, _hit);
    if (!hit || hit.normal.y < 0.62) return false;
    const h = hit.point.y - this.pos.y;
    if (h > T.scrambleMax) return false;
    // there must be room to stand on it (this also rules out a hit from inside something solid)
    _w.set(hit.point.x, hit.point.y + 0.1, hit.point.z);
    if (world.raycast(_w, _c.set(0, 1, 0), 1.0) < 1.0) return false;
    this.vel.set(dx * 3.2, Math.sqrt(2 * T.gravity * (h + 0.3)), dz * 3.2);
    this.vault.set(dx * 3.2, 0, dz * 3.2); this.vaultT = 0.3; this.noCut = true;
    this.scrambleCool = 0.5; this.pouncing = false;
    this.yaw = Math.atan2(dx, dz);
    this.events.push('scramble');
    return true;
  }

  /**
   * Find footing under Indy: a ray under his centre and four around it, cast from `up` above his feet down to
   * `dist`. Returns the highest walkable hit that is not above maxY, or null.
   */
  _probe(up, dist, maxY) {
    let best = null;
    for (let i = 0; i < 5; i++) {
      const o = PROBE[i];
      _v.set(this.pos.x + o[0], this.pos.y + up, this.pos.z + o[1]);
      const h = this.world.raycastDown(_v, dist, _hits[i]);
      if (h && h.normal.y > 0.62 && h.point.y <= maxY && (!best || h.point.y > best.point.y + 0.001)) best = h;
      if (i === 0 && best) break;                // the centre ray is enough when it hits
    }
    return best;
  }

  _land(hit) {
    const impact = -this.vel.y;
    this.vaultT = 0; this.noCut = false; this.hoppedOff = null;
    this.pos.y = hit.point.y;
    this.ground = hit.collider;
    this.state = 'ground';
    this.vel.y = 0;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > TUNE.runSpeed) { this.vel.x *= TUNE.runSpeed / sp; this.vel.z *= TUNE.runSpeed / sp; }
    this.canPounce = true; this.pouncing = false;
    this.landImpact = impact;
    this.events.push('land');
  }

  // ---- climbing ------------------------------------------------------------------------------------------------

  _climbFrame(cl) {
    // world-space plane: centre, normal, right
    _planeC.copy(cl.centre); _planeN.copy(cl.normal); _planeR.copy(cl.right);
    if (cl.mover) { _planeC.applyMatrix4(cl.mover.matrix); _planeN.transformDirection(cl.mover.matrix); _planeR.transformDirection(cl.mover.matrix); }
  }

  _tryGrab(fromGround) {
    const T = TUNE, p = this.pos;
    for (const cl of this.world.climbs) {
      if (cl === this.hoppedOff) continue;
      let y0 = cl.y0, y1 = cl.y1;
      if (cl.type === 'plane') {
        this._climbFrame(cl);
        if (cl.mover) { const dy = _planeC.y - cl.centre.y; y0 += dy; y1 += dy; }
        if (p.y < y0 - 0.4 || p.y > y1 + (fromGround ? -0.75 : 0.15)) continue;
        _v.set(p.x - _planeC.x, 0, p.z - _planeC.z);
        const d = _v.dot(_planeN);
        if (d < -0.05 || d > T.radius + (fromGround ? 0.3 : 0.5)) continue;
        const u = _v.dot(_planeR);
        if (Math.abs(u) > cl.halfW + 0.15) continue;
        const into = -(_wish.x * _planeN.x + _wish.z * _planeN.z);
        if (fromGround) { if (into < 0.55 || y1 - p.y < 1.3) continue; }
        else if ((this.airTime < 0.12 && into < 0.3) || (this.vel.x * _planeN.x + this.vel.z * _planeN.z > 1.5 && into < 0.2)) continue;
        this.climb = cl; this.climbU = THREE.MathUtils.clamp(u, -cl.halfW + 0.2, cl.halfW - 0.2);
        this.climbY = Math.min(Math.max(p.y, y0), y1 - 0.73);
      } else {
        let px = cl.x, pz = cl.z;
        if (cl.mover) { _v.set(cl.x, cl.y0, cl.z).applyMatrix4(cl.mover.matrix); px = _v.x; pz = _v.z; const dy = _v.y - cl.y0; y0 += dy; y1 += dy; }
        if (p.y < y0 - 0.4 || p.y > y1 + (fromGround ? -0.75 : 0.15)) continue;
        const dx = p.x - px, dz = p.z - pz, dist = Math.hypot(dx, dz);
        if (dist > cl.radius + T.radius + 0.28) continue;
        const into = dist > 1e-4 ? -(_wish.x * dx + _wish.z * dz) / dist : 1;
        if (fromGround && (into < 0.55 || y1 - p.y < 1.3)) continue;
        if (!fromGround && this.airTime < 0.12 && into < 0.3) continue;
        this.climb = cl; this.climbPhi = Math.atan2(dx, dz);
        this.climbY = Math.min(Math.max(p.y, y0), y1 - 0.73);
      }
      this.state = 'climb'; this.ground = null; this.vel.set(0, 0, 0); this.noCut = false; this.vaultT = 0;
      this.canPounce = true; this.pouncing = false; this.climbMove = 0;
      this.events.push('grab');
      this._placeOnClimb();
      return true;
    }
    return false;
  }

  _climbRange(cl) {
    let y0 = cl.y0, y1 = cl.y1;
    if (cl.mover) {
      if (cl.type === 'plane') { this._climbFrame(cl); const dy = _planeC.y - cl.centre.y; y0 += dy; y1 += dy; }
      else { _v.set(cl.x, cl.y0, cl.z).applyMatrix4(cl.mover.matrix); const dy = _v.y - cl.y0; y0 += dy; y1 += dy; }
    }
    return [y0, y1];
  }

  _placeOnClimb() {
    const T = TUNE, cl = this.climb;
    if (cl.type === 'plane') {
      this._climbFrame(cl);
      this.pos.set(_planeC.x + _planeR.x * this.climbU + _planeN.x * T.climbOffset, this.climbY,
        _planeC.z + _planeR.z * this.climbU + _planeN.z * T.climbOffset);
      this.yaw = Math.atan2(-_planeN.x, -_planeN.z);
    } else {
      let px = cl.x, pz = cl.z;
      if (cl.mover) { _v.set(cl.x, cl.y0, cl.z).applyMatrix4(cl.mover.matrix); px = _v.x; pz = _v.z; }
      const rr = cl.radius + T.climbOffset;
      this.pos.set(px + Math.sin(this.climbPhi) * rr, this.climbY, pz + Math.cos(this.climbPhi) * rr);
      this.yaw = this.climbPhi + Math.PI;
    }
  }

  _stepClimb(dt, inp) {
    const T = TUNE, cl = this.climb;
    const [y0, y1] = this._climbRange(cl);
    if (cl.mover) this.climbY = this.pos.y;       // carried
    // outward direction of the surface where Indy hangs
    if (cl.type === 'plane') { this._climbFrame(cl); _n.copy(_planeN); }
    else _n.set(Math.sin(this.climbPhi), 0, Math.cos(this.climbPhi));

    if (this.buffer > 0) {
      // leap off; holding down just lets go
      this.buffer = 0; this.state = 'air'; this.climb = null; this.regrab = 0.32; this.airTime = 0;
      if (inp.y < -0.5) { this.vel.set(_n.x * 2, 0, _n.z * 2); }
      else {
        this.vel.set(_n.x * T.leapOut + _tan.x * inp.x * 4.5, T.leapUp, _n.z * T.leapOut + _tan.z * inp.x * 4.5);
        this.yaw = Math.atan2(this.vel.x, this.vel.z);
        this.events.push('jump');
      }
      return;
    }

    const vy = inp.y > 0 ? inp.y * T.climbUp : inp.y * T.climbDown;
    this.climbY += vy * dt;
    this.climbMove = vy;
    if (cl.type === 'plane') {
      // sideways along the surface, in the direction that matches the screen
      const sign = (_planeR.x * _tan.x + _planeR.z * _tan.z) >= 0 ? 1 : -1;
      const du = inp.x * sign * T.climbSide * dt;
      this.climbU = THREE.MathUtils.clamp(this.climbU + du, -cl.halfW + 0.2, cl.halfW - 0.2);
      if (Math.abs(inp.x) > Math.abs(inp.y)) this.climbMove = inp.x * T.climbSide;
    } else {
      // around the pole
      const dxdphi = Math.cos(this.climbPhi) * _tan.x - Math.sin(this.climbPhi) * _tan.z;
      this.climbPhi += inp.x * (dxdphi >= 0 ? 1 : -1) * 2.4 * dt;
      if (Math.abs(inp.x) > Math.abs(inp.y)) this.climbMove = inp.x * 2;
    }
    if (this.climbY > y1 - 0.72 && inp.y > 0.1) {
      // over the top: a little hop onto whatever is up there
      this.climbY = y1 - 0.72; this._placeOnClimb();
      this.state = 'air'; this.climb = null; this.regrab = 0.4; this.airTime = 0;
      this.vel.set(-_n.x * 3.4, 9.3, -_n.z * 3.4);
      // A rope out on the tower's side is climbed from any side, and what is at its top is on the tower's side of it:
      // hop to a spot a fixed way in from the rope itself, wherever Indy hung on it.
      if (cl.type !== 'plane' && Math.hypot(this.pos.x, this.pos.z) > 2.5) {
        let px = cl.x, pz = cl.z;
        if (cl.mover) { _v.set(cl.x, cl.y0, cl.z).applyMatrix4(cl.mover.matrix); px = _v.x; pz = _v.z; }
        const k = 1 - 1.6 / Math.hypot(px, pz);
        this.vel.x = (px * k - this.pos.x) / 0.34; this.vel.z = (pz * k - this.pos.z) / 0.34;
      }
      this.vault.set(this.vel.x, 0, this.vel.z); this.vaultT = 0.34; this.noCut = true;
      this.hoppedOff = cl;            // not to be grabbed again until Indy has landed
      this.events.push('vault');
      return;
    }
    if (this.climbY < y0 - 0.02) {
      this.climbY = y0 - 0.02; this._placeOnClimb();
      this.state = 'air'; this.climb = null; this.regrab = 0.25; this.vel.set(0, 0, 0); this.airTime = 0;
      return;
    }
    this._placeOnClimb();
    // feet reached the floor while climbing down
    if (inp.y < -0.1) {
      _v.set(this.pos.x, this.pos.y + 0.4, this.pos.z);
      const hit = this.world.raycastDown(_v, 0.45, _hit);
      if (hit && hit.normal.y > 0.62) { this.state = 'ground'; this.ground = hit.collider; this.pos.y = hit.point.y; this.climb = null; this.regrab = 0.3; }
    }
  }
}
