// Movers: kinematic platforms. Their transform is a function of game time (a lift also reads its own state, which
// an entity advances: see Level.lift).
import * as THREE from 'three';

const _m = new THREE.Matrix4();

export class Mover {
  /** object: a THREE.Object3D added directly to the scene. fn(t, object) sets its position / rotation. */
  constructor(object, fn) {
    this.object = object;
    this.fn = fn;
    this.matrix = new THREE.Matrix4();
    this.invMatrix = new THREE.Matrix4();
    this.prevMatrix = new THREE.Matrix4();
    this.delta = new THREE.Matrix4();      // prev -> now
    this.update(0);
    this.prevMatrix.copy(this.matrix);
    this.delta.identity();
  }

  update(t) {
    this.prevMatrix.copy(this.matrix);
    this.fn(t, this.object);
    this.object.updateMatrix();
    this.matrix.copy(this.object.matrix);
    this.invMatrix.copy(this.matrix).invert();
    this.delta.copy(this.matrix).multiply(_m.copy(this.prevMatrix).invert());
    // a mover that jumps (a coaster car wrapping round to the top of the track) must not fling its rider along
    const e = this.matrix.elements, p = this.prevMatrix.elements;
    if (Math.abs(e[12] - p[12]) + Math.abs(e[13] - p[13]) + Math.abs(e[14] - p[14]) > 4) this.delta.identity();
  }

  /** Move a world-space point along with the mover's motion over the last update. */
  carry(point) { return point.applyMatrix4(this.delta); }
}

const DEG = Math.PI / 180;

/** Position on the cylinder around the tower. */
export function cyl(aDeg, r, y, out = new THREE.Vector3()) {
  const a = aDeg * DEG;
  return out.set(r * Math.sin(a), y, r * Math.cos(a));
}

/** Place an object on the cylinder, facing outward (plus extra yaw in degrees). */
export function placeCyl(obj, aDeg, r, y, yawDeg = 0) {
  cyl(aDeg, r, y, obj.position);
  obj.rotation.set(0, (aDeg + yawDeg) * DEG, 0);
  return obj;
}

// ---- motion functions: (t, object) => void ---------------------------------------------------------------------

/** Circle the tower at a fixed radius. tilt makes the height vary with the angle (wave swinger). */
export function orbit({ a0 = 0, r, y, speed = 20, tilt = 0, tiltPhase = 0, bob = 0, bobPeriod = 3 }) {
  return (t, o) => {
    const a = a0 + speed * t;
    const yy = y + tilt * Math.sin((a - tiltPhase) * DEG) + bob * Math.sin((t / bobPeriod) * Math.PI * 2);
    placeCyl(o, a, r, yy);
  };
}

/** Spin about the tower axis in place. */
export function spin({ speed = 10, y = 0, tilt = 0, a0 = 0 }) {
  return (t, o) => { o.position.set(0, y, 0); o.rotation.set(0, (a0 + speed * t) * DEG, 0); };
}

/** A gondola on a Ferris wheel whose plane is tangent to the tower at angle a. Stays upright. */
export function ferris({ a, r, hubY, radius = 8, speed = 14, phase = 0 }) {
  const hub = cyl(a, r, hubY);
  const tan = new THREE.Vector3(Math.cos(a * DEG), 0, -Math.sin(a * DEG));
  return (t, o) => {
    const p = (phase + speed * t) * DEG;
    o.position.copy(hub).addScaledVector(tan, Math.cos(p) * radius);
    o.position.y += Math.sin(p) * radius;
    o.rotation.set(0, a * DEG, 0);
  };
}

/** Bob up and down in place, optionally drifting around the tower. */
export function bob({ a, r, y, amp = 0.6, period = 4, phase = 0, drift = 0, sway = 0 }) {
  return (t, o) => {
    const k = (t / period + phase) * Math.PI * 2;
    placeCyl(o, a + drift * Math.sin(k * 0.5) + sway * Math.sin(k * 0.37), r, y + amp * Math.sin(k));
  };
}

/**
 * Roll along a track at a fixed radius. `pts` are [angle, y] corners joined by straight runs (a helix where both
 * change); speed in units/s; `offset` puts a car that far behind the head of its train. After the end of the track
 * the car is parked out of the world for `gap` more units of travel, then starts again: both ends of the track are
 * meant to be inside a shed, so nobody sees it come or go.
 * The returned function also has .len (the length of the track) and .dist(t): how far along the track the car is. While it is parked
 * dist is null, except over the last `pre` units before it starts, when it counts up from -pre to 0 (so that
 * warning lights can come on before the car is there).
 */
export function track({ r, pts, speed = 5, phase = 0, offset = 0, gap = 0, pre = 0 }) {
  const segs = [];
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, y0] = pts[i], [a1, y1] = pts[i + 1];
    const arc = Math.abs(a1 - a0) * DEG * r, l = Math.hypot(arc, y1 - y0);
    segs.push({ a0, y0, a1, y1, s0: len, l, pitch: Math.atan2(y1 - y0, arc) });
    len += l;
  }
  const total = len + gap, back = pts[pts.length - 1][0] < pts[0][0], BLEND = 0.9;
  const lap = (t) => (((t * speed + phase * total - offset) % total) + total) % total;
  const dist = (t) => { const s = lap(t); return s < len ? s : s >= total - pre ? s - total : null; };
  const fn = (t, o) => {
    const s = lap(t);
    if (s >= len) { o.position.set(0, -300, 0); o.visible = false; return; }
    let i = segs.length - 1;
    for (let j = 0; j < segs.length; j++) if (s < segs[j].s0 + segs[j].l) { i = j; break; }
    const g = segs[i], k = (s - g.s0) / g.l, a = g.a0 + (g.a1 - g.a0) * k;
    cyl(a, r, g.y0 + (g.y1 - g.y0) * k, o.position);
    // nose along the direction of travel (local +X), tilted to the slope; the tilt eases in over each corner
    let pitch = g.pitch;
    const d0 = s - g.s0, d1 = g.s0 + g.l - s;
    if (i > 0 && d0 < BLEND) pitch += (segs[i - 1].pitch - pitch) * 0.5 * (1 - d0 / BLEND);
    else if (i < segs.length - 1 && d1 < BLEND) pitch += (segs[i + 1].pitch - pitch) * 0.5 * (1 - d1 / BLEND);
    o.rotation.set(0, a * DEG + (back ? Math.PI : 0), 0, 'YXZ');
    o.rotation.z = pitch;
    o.visible = true;
  };
  fn.dist = dist; fn.len = len;
  return fn;
}
