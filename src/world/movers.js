// Movers: kinematic platforms whose transform is a pure function of game time.
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

/** Drop ride: rises slowly from y0 to y1, waits, drops fast, waits. */
export function dropRide({ a, r, y0, y1, up = 6, holdTop = 2.2, down = 1.1, holdBottom = 2.4, phase = 0 }) {
  const period = up + holdTop + down + holdBottom;
  return (t, o) => {
    let k = (t + phase * period) % period;
    let y;
    if (k < holdBottom) y = y0;
    else if ((k -= holdBottom) < up) { const s = k / up; y = y0 + (y1 - y0) * (s * s * (3 - 2 * s)); }
    else if ((k -= up) < holdTop) y = y1;
    else { const s = (k - holdTop) / down; y = y1 - (y1 - y0) * (s * s); }
    placeCyl(o, a, r, y);
  };
}
dropRide.period = (d) => (d.up ?? 6) + (d.holdTop ?? 2.2) + (d.down ?? 1.1) + (d.holdBottom ?? 2.4);

/** Travel along a helix around the tower from (a0, y0) to (a1, y1), then wrap. speed in units/s along the path. */
export function helix({ a0, a1, y0, y1, r, speed = 6, phase = 0, gap = 0 }) {
  const arc = Math.abs(a1 - a0) * DEG * r;
  const len = Math.hypot(arc, y1 - y0);
  const pitch = Math.atan2(y1 - y0, arc) * Math.sign(a1 - a0);
  const total = len + gap;
  return (t, o) => {
    const s = ((t * speed + phase * total) % total + total) % total;
    const k = Math.min(1, s / len);
    const a = a0 + (a1 - a0) * k;
    cyl(a, r, y0 + (y1 - y0) * k, o.position);
    // nose along the direction of travel (local +X), tilted to the slope
    o.rotation.set(0, a * DEG + (a1 < a0 ? Math.PI : 0), 0, 'YXZ');
    o.rotation.z = (a1 < a0 ? -1 : 1) * pitch;
    o.visible = s <= len;
  };
}
