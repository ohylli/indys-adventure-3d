// Collision world: triangle-mesh colliders (static world merged into one BVH, plus one small BVH per mover),
// a sphere/capsule push-out, downward ray casts, and climbable surfaces.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _box = new THREE.Box3();
const _seg = new THREE.Line3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Ray();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Position-only, non-indexed copy of a mesh's geometry with a matrix applied. */
export function bakeGeometry(mesh, matrix) {
  let g = mesh.geometry;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position').clone());
  if (g.index) out.setIndex(g.index.clone());
  const flat = out.index ? out.toNonIndexed() : out;
  if (matrix) flat.applyMatrix4(matrix);
  return flat;
}

/** A non-indexed geometry with only positions, so any mix of sources can be merged. */
function positionOnly(geom) {
  const flat = geom.index ? geom.toNonIndexed() : geom;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', flat.getAttribute('position'));
  return out;
}

class Collider {
  constructor(geometry, mover = null, tag = null) {
    this.bvh = new MeshBVH(geometry);
    this.mover = mover;       // null = static world
    this.tag = tag;
  }
}

export class CollisionWorld {
  constructor() {
    this.staticGeoms = [];
    this.colliders = [];
    this.climbs = [];         // { type: 'plane' | 'pole', ..., mover }
    this.contact = { grounded: false, normal: new THREE.Vector3(), collider: null, hitHead: false, pushed: new THREE.Vector3() };
  }

  addStaticGeometry(geom) { this.staticGeoms.push(positionOnly(geom)); }

  addMoverGeometry(mover, geoms, tag = null) {
    geoms = geoms.map(positionOnly);
    const g = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    const c = new Collider(g, mover, tag);
    this.colliders.push(c);
    return c;
  }

  build() {
    this._mergeClimbs();
    if (this.staticGeoms.length) {
      const merged = mergeGeometries(this.staticGeoms, false);
      this.colliders.unshift(new Collider(merged));
      this.staticGeoms.length = 0;
    }
  }

  /**
   * Push a sphere out of everything it overlaps. centre is modified in place.
   * Fills this.contact: grounded (a supporting surface was touched), normal, collider, hitHead.
   */
  resolveSphere(centre, radius) {
    const ct = this.contact;
    ct.grounded = false; ct.collider = null; ct.hitHead = false; ct.pushed.set(0, 0, 0);
    let bestUp = 0.62;
    for (const c of this.colliders) {
      const mover = c.mover;
      _seg.start.copy(centre);
      if (mover) _seg.start.applyMatrix4(mover.invMatrix);
      _seg.end.copy(_seg.start);
      _box.min.copy(_seg.start).addScalar(-radius);
      _box.max.copy(_seg.start).addScalar(radius);
      let hitAny = false;
      c.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(_seg, _triPoint, _capPoint);
          if (dist >= radius) return;
          const depth = radius - dist;
          if (dist > 1e-6) _dir.copy(_capPoint).sub(_triPoint).multiplyScalar(1 / dist);
          else tri.getNormal(_dir);
          _seg.start.addScaledVector(_dir, depth);
          _seg.end.copy(_seg.start);
          _box.min.copy(_seg.start).addScalar(-radius);
          _box.max.copy(_seg.start).addScalar(radius);
          hitAny = true;
          _n.copy(_dir);
          if (mover) _n.transformDirection(mover.matrix);
          if (_n.y > bestUp) { bestUp = _n.y; ct.grounded = true; ct.normal.copy(_n); ct.collider = c; }
          if (_n.y < -0.5) ct.hitHead = true;
        },
      });
      if (hitAny) {
        _v.copy(_seg.start);
        if (mover) _v.applyMatrix4(mover.matrix);
        ct.pushed.add(_v).sub(centre);
        centre.copy(_v);
      }
    }
    return ct;
  }

  /** First hit straight down from origin within maxDist. Returns { point, normal, distance, collider } or null. */
  raycastDown(origin, maxDist, out = {}) {
    let best = null;
    for (const c of this.colliders) {
      const mover = c.mover;
      _ray.origin.copy(origin);
      _ray.direction.copy(DOWN);
      if (mover) { _ray.origin.applyMatrix4(mover.invMatrix); _ray.direction.transformDirection(mover.invMatrix); }
      const hit = c.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
      if (!hit || hit.distance > maxDist) continue;
      if (!best || hit.distance < best.distance) {
        best = out;
        out.distance = hit.distance;
        out.point = (out.point || new THREE.Vector3()).copy(hit.point);
        out.normal = (out.normal || new THREE.Vector3()).copy(hit.face.normal);
        if (mover) { out.point.applyMatrix4(mover.matrix); out.normal.transformDirection(mover.matrix); }
        if (out.normal.y < 0) out.normal.negate();
        out.collider = c;
      }
    }
    return best;
  }

  /** Any hit along a ray (world space). Returns distance or Infinity. */
  raycast(origin, dir, maxDist) {
    let best = Infinity;
    for (const c of this.colliders) {
      const mover = c.mover;
      _ray.origin.copy(origin);
      _ray.direction.copy(dir);
      if (mover) { _ray.origin.applyMatrix4(mover.invMatrix); _ray.direction.transformDirection(mover.invMatrix); }
      const hit = c.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
      if (hit && hit.distance < best) best = hit.distance;
    }
    return best;
  }

  /** Climb planes stacked on top of each other (two ladder segments) become one tall plane. */
  _mergeClimbs() {
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < this.climbs.length && !merged; i++) {
        for (let j = 0; j < this.climbs.length && !merged; j++) {
          const a = this.climbs[i], b = this.climbs[j];
          if (i === j || a.type !== 'plane' || b.type !== 'plane' || a.mover || b.mover) continue;
          const same = a.normal.dot(b.normal) > 0.99 && Math.abs(a.halfW - b.halfW) < 0.1
            && Math.hypot(a.centre.x - b.centre.x, a.centre.z - b.centre.z) < 0.15;
          if (same && Math.abs(a.y1 - b.y0) < 0.25) {
            a.y1 = b.y1; a.centre.y = (a.y0 + a.y1) / 2;
            this.climbs.splice(j, 1);
            merged = true;
          }
        }
      }
    }
  }

  // ---- climbables -------------------------------------------------------------------------------------------

  /** A flat climbable rectangle from a quad mesh (world matrix applied unless it rides a mover). */
  addClimbFromMesh(mesh, mover = null, kind = 'climb', localMatrix = null) {
    if (!localMatrix) mesh.updateWorldMatrix(true, false);
    // for a mover, localMatrix is the mesh's matrix in the mover's own space
    const mat = localMatrix || mesh.matrixWorld;
    const pos = mesh.geometry.getAttribute('position');
    const pts = [];
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat));
    const box = new THREE.Box3().setFromPoints(pts);
    const centre = box.getCenter(new THREE.Vector3());
    if (kind === 'pole') {
      const size = box.getSize(new THREE.Vector3());
      this.climbs.push({ type: 'pole', x: centre.x, z: centre.z, y0: box.min.y, y1: box.max.y,
        radius: Math.max(0.08, Math.max(size.x, size.z) / 2), mover });
      return;
    }
    // normal from the geometry (first triangle), flattened to horizontal
    const idx = mesh.geometry.index;
    const a = pts[idx ? idx.getX(0) : 0], b = pts[idx ? idx.getX(1) : 1], c = pts[idx ? idx.getX(2) : 2];
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    normal.y = 0;
    if (normal.lengthSq() < 1e-8) return;
    normal.normalize();
    const right = new THREE.Vector3(normal.z, 0, -normal.x);     // to the right when facing the surface from outside... flipped below per use
    let halfW = 0;
    for (const p of pts) halfW = Math.max(halfW, Math.abs(_v.subVectors(p, centre).dot(right)));
    this.climbs.push({ type: 'plane', centre, normal, right, halfW, y0: box.min.y, y1: box.max.y, mover });
  }

  addClimbPlane(centre, normal, halfW, y0, y1, mover = null) {
    const n = normal.clone().setY(0).normalize();
    this.climbs.push({ type: 'plane', centre: centre.clone(), normal: n, right: new THREE.Vector3(n.z, 0, -n.x), halfW, y0, y1, mover });
  }

  addClimbPole(x, z, y0, y1, radius = 0.15, mover = null) {
    this.climbs.push({ type: 'pole', x, z, y0, y1, radius, mover });
  }
}
