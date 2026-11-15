// The level builder: places kit pieces around the tower, builds walkways and track procedurally, registers
// colliders, climbables, movers, collectibles, creatures and hazard zones. The layout itself is in leveldata.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets, colouredGeometry } from '../core/assets.js';
import { LAYER_NO_OUTLINE } from '../core/layers.js';
import { bakeGeometry } from './collision.js';
import { Mover, cyl, placeCyl } from './movers.js';
import * as E from './entities.js';

const DEG = Math.PI / 180;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

const COLORS = {
  wood: '#c9955c', wood_light: '#e2bb86', wood_dark: '#8f5f3c', red: '#e8443a', cream: '#f6ecd2', yellow: '#ffc93c',
  teal: '#2bb3a6', blue: '#3d7fe0', steel: '#9aa3ad', steel_dark: '#5e6772', pink: '#f27aa8', purple: '#8a5bd6',
  rope: '#c9a56a', green: '#4fb65a', orange: '#f58a2c', dark: '#2b2a30', concrete: '#bfae98',
};
const FESTIVE = ['#e8443a', '#ffc93c', '#2bb3a6', '#3d7fe0', '#f27aa8', '#f6ecd2', '#8a5bd6', '#f58a2c'];
const NO_HELP = { lead: 1, lift: 0 };

export class Level {
  constructor(ctx) {
    this.ctx = ctx;                   // { scene, world, particles, audio, game }
    this.scene = ctx.scene;
    this.world = ctx.world;
    this.root = new THREE.Group(); this.root.name = 'level';
    this.scene.add(this.root);
    this.movers = [];
    this.entities = [];
    this.checkpoints = [];
    this.spinners = [];               // decorative rotating things: { object, axis, speed }
    this.pendingGround = [];          // things to drop onto the ground once colliders exist
    this.treats = new E.Treats(ctx);
    this.mats = new Map();
    this.instancers = new Map();
    this.spawn = { a: 0, r: 24, y: 0 };
    this.camZones = [];               // { y0, y1, rMin, rMax, lead, lift }: see camZone()
  }

  mat(color) {
    const hex = COLORS[color] || color;
    let m = this.mats.get(hex);
    if (!m) { m = new THREE.MeshToonMaterial({ color: hex, gradientMap: assets.gradient }); this.mats.set(hex, m); }
    return m;
  }

  // ---- kit pieces ------------------------------------------------------------------------------------------------

  _registerStatic(obj) {
    obj.updateWorldMatrix(true, true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.helper === 'col') this.world.addStaticGeometry(bakeGeometry(o, o.matrixWorld));
      else if (o.userData.helper === 'climb') this.world.addClimbFromMesh(o, null, 'climb');
      else if (o.userData.helper === 'pole') this.world.addClimbFromMesh(o, null, 'pole');
    });
  }

  /** A static kit piece on the cylinder. opts: { yaw, tint, scale, collide = true, flip } */
  piece(name, a, r, y, opts = {}) {
    const obj = assets.kit(name, opts);
    placeCyl(obj, a, r, y, opts.yaw || 0);
    if (opts.scale) obj.scale.setScalar(opts.scale);
    if (opts.tilt) obj.rotation.z = opts.tilt * DEG;
    this.root.add(obj);
    if (opts.collide !== false) this._registerStatic(obj);
    return obj;
  }

  /** A kit piece (or any object) that moves. fn is a motion function from movers.js. Returns the Mover. */
  mover(nameOrObject, fn, opts = {}) {
    const obj = typeof nameOrObject === 'string' ? assets.kit(nameOrObject, opts) : nameOrObject;
    const group = new THREE.Group();
    group.add(obj);
    if (opts.yaw) obj.rotation.y = opts.yaw * DEG;
    if (opts.offset) obj.position.copy(opts.offset);
    if (opts.scale) obj.scale.setScalar(opts.scale);
    this.scene.add(group);
    group.updateMatrixWorld(true);
    const geoms = [];
    const climbs = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.helper === 'col') geoms.push(bakeGeometry(o, o.matrixWorld));
      else if (o.userData.helper) climbs.push([o, o.matrixWorld.clone()]);     // the group is still at the origin
    });
    for (const g of opts.extraCol || []) geoms.push(g);
    const mover = new Mover(group, fn);
    mover.name = typeof nameOrObject === 'string' ? nameOrObject : obj.name;
    if (geoms.length && opts.collide !== false) mover.collider = this.world.addMoverGeometry(mover, geoms, opts.tag || null);
    for (const [o, local] of climbs) this.world.addClimbFromMesh(o, mover, o.userData.helper, local);
    this.movers.push(mover);
    return mover;
  }

  // ---- procedural walkways -----------------------------------------------------------------------------------------

  /**
   * A curved deck hugging the tower from angle a0 to a1 (degrees), between radii rIn and rOut, at height y0 rising
   * to y1 (a ramp when they differ). Collides. opts: { top, side, alt, thick, step (deg per plank), collide }
   */
  arcDeck(a0, a1, rIn, rOut, y0, y1 = y0, opts = {}) {
    const step = opts.step || 5;
    const n = Math.max(1, Math.round(Math.abs(a1 - a0) / step));
    const thick = opts.thick ?? 0.3;
    const top = [], side = [], alt = [];
    for (let i = 0; i < n; i++) {
      const aa = (a0 + (a1 - a0) * (i / n)) * DEG, ab = (a0 + (a1 - a0) * ((i + 1) / n)) * DEG;
      const ya = y0 + (y1 - y0) * (i / n), yb = y0 + (y1 - y0) * ((i + 1) / n);
      const P = (a, r, y) => [r * Math.sin(a), y, r * Math.cos(a)];
      const A = P(aa, rIn, ya), B = P(aa, rOut, ya), C = P(ab, rOut, yb), D = P(ab, rIn, yb);
      const A2 = P(aa, rIn, ya - thick), B2 = P(aa, rOut, ya - thick), C2 = P(ab, rOut, yb - thick), D2 = P(ab, rIn, yb - thick);
      const fwd = a1 > a0;
      const quad = (arr, p, q, r, s) => { if (fwd) arr.push(...p, ...q, ...r, ...p, ...r, ...s); else arr.push(...p, ...r, ...q, ...p, ...s, ...r); };
      quad(top, A, B, C, D);                       // top
      quad(side, B2, A2, D2, C2);                  // bottom
      quad(i % 2 ? alt : side, B, B2, C2, C);      // outer face (striped)
      quad(side, A2, A, D, D2);                    // inner face
      if (i === 0) quad(side, A, A2, B2, B);
      if (i === n - 1) quad(side, D, C, C2, D2);
    }
    const mk = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g; };
    const group = new THREE.Group();
    const parts = [[top, opts.top || 'wood_light'], [side, opts.side || 'red'], [alt, opts.alt || 'cream']];
    for (const [arr, color] of parts) {
      if (!arr.length) continue;
      const mesh = new THREE.Mesh(mk(arr), this.mat(color));
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      if (opts.collide !== false) this.world.addStaticGeometry(mk(arr));
    }
    this.root.add(group);
    return group;
  }

  /** A straight box (collides): centre on the cylinder, size (tangential, height, radial). */
  box(a, r, y, size, color = 'wood', opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), this.mat(color));
    placeCyl(mesh, a, r, y, opts.yaw || 0);
    mesh.castShadow = opts.cast !== false; mesh.receiveShadow = true;
    this.root.add(mesh);
    mesh.updateWorldMatrix(true, false);
    if (opts.collide !== false) this.world.addStaticGeometry(bakeGeometry(mesh, mesh.matrixWorld));
    return mesh;
  }

  /**
   * An invisible wall along the edge of a curved deck or ramp: a strip at radius r from angle a0 to a1, standing
   * `height` tall on a floor that rises from y0 to y1. Rails are drawn thin, so this is what actually holds Indy in.
   */
  arcWall(a0, a1, r, y0, y1, height, step = 5) {
    const n = Math.max(1, Math.round(Math.abs(a1 - a0) / step));
    const pos = [];
    for (let i = 0; i < n; i++) {
      const aa = (a0 + (a1 - a0) * (i / n)) * DEG, ab = (a0 + (a1 - a0) * ((i + 1) / n)) * DEG;
      const ya = y0 + (y1 - y0) * (i / n), yb = y0 + (y1 - y0) * ((i + 1) / n);
      const A = [r * Math.sin(aa), ya, r * Math.cos(aa)], B = [r * Math.sin(ab), yb, r * Math.cos(ab)];
      const A2 = [A[0], ya + height, A[2]], B2 = [B[0], yb + height, B[2]];
      pos.push(...A, ...B, ...B2, ...A, ...B2, ...A2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.world.addStaticGeometry(g);
  }

  /** An invisible wall along a radius (the end of a deck): at angle a from radius r0 to r1, standing on y. */
  radialWall(a, r0, r1, y, height) {
    const A = cyl(a, r0, y), B = cyl(a, r1, y);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([A.x, y, A.z, B.x, y, B.z, B.x, y + height, B.z, A.x, y, A.z, B.x, y + height, B.z, A.x, y + height, A.z], 3));
    this.world.addStaticGeometry(g);
  }

  /**
   * A thin railing drawn along a curved edge: posts and a top bar (no collision: pair it with arcWall).
   * opts: { height = 0.8, color, post = 8 (degrees between posts) }
   */
  arcRail(a0, a1, r, y0, y1, opts = {}) {
    const h = opts.height ?? 0.8, color = opts.color || 'yellow';
    this.arcDeck(a0, a1, r - 0.06, r + 0.06, y0 + h, y1 + h, { top: color, side: color, alt: color, thick: 0.1, collide: false, step: 4 });
    const n = Math.max(1, Math.round(Math.abs(a1 - a0) / (opts.post ?? 8)));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      this.box(a0 + (a1 - a0) * k, r, y0 + (y1 - y0) * k + h / 2 - 0.05, [0.12, h, 0.12], color, { collide: false });
    }
  }

  /** A round platform with a hole (ring) or without, flat, centred on the tower axis. Collides. */
  disc(y, rIn, rOut, color = 'steel', thick = 0.25) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    if (rIn > 0) { const hole = new THREE.Path(); hole.absarc(0, 0, rIn, 0, Math.PI * 2, true); shape.holes.push(hole); }
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 20 });
    g.rotateX(Math.PI / 2); g.translate(0, y, 0);
    const mesh = new THREE.Mesh(g, this.mat(color));
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);
    this.world.addStaticGeometry(bakeGeometry(mesh, null));
    return mesh;
  }

  /** Invisible collision cylinder wall (keeps Indy inside the plaza) or solid cylinder. */
  wall(radius, y0, y1, inward = true) {
    const g = new THREE.CylinderGeometry(radius, radius, y1 - y0, 48, 1, true);
    g.translate(0, (y0 + y1) / 2, 0);
    this.world.addStaticGeometry(bakeGeometry({ geometry: g }, null));
  }

  // ---- decoration ----------------------------------------------------------------------------------------------------

  instancer(pieceName) {
    let inst = this.instancers.get(pieceName);
    if (!inst) { inst = { name: pieceName, matrices: [], colors: [] }; this.instancers.set(pieceName, inst); }
    return inst;
  }

  /**
   * A hanging cable between two points (THREE.Vector3) with festoon bulbs or bunting flags along it.
   * opts: { sag = 1, kind: 'bulbs' | 'flags' | 'both' | 'none', spacing, color }
   */
  cable(p0, p1, opts = {}) {
    const sag = opts.sag ?? 1, kind = opts.kind || 'bulbs';
    const len = p0.distanceTo(p1);
    const segs = Math.max(6, Math.round(len / 1.2));
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push(new THREE.Vector3().lerpVectors(p0, p1, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, segs * 2, 0.035, 5, false), this.mat(opts.color || 'dark'));
    this.root.add(tube);
    const spacing = opts.spacing || (kind === 'flags' ? 0.75 : 1.1);
    const count = Math.max(2, Math.floor(len / spacing));
    const bulbs = this.instancer('string_bulb'), flags = this.instancer('bunting_flag');
    const tan = new THREE.Vector3();
    for (let i = 1; i < count; i++) {
      const t = i / count;
      curve.getPointAt(t, _p); curve.getTangentAt(t, tan);
      const yaw = Math.atan2(tan.x, tan.z) - Math.PI / 2;
      _q.setFromEuler(_e.set(0, yaw, 0));
      if (kind === 'bulbs' || (kind === 'both' && i % 2 === 0)) {
        bulbs.matrices.push(new THREE.Matrix4().compose(_p.clone().add(new THREE.Vector3(0, -0.02, 0)), _q, _s));
      } else if (kind === 'flags' || kind === 'both') {
        flags.matrices.push(new THREE.Matrix4().compose(_p, _q, _s));
        flags.colors.push(FESTIVE[(flags.colors.length * 3) % FESTIVE.length]);
      }
    }
    return tube;
  }

  /** Cable given in cylinder coordinates: [a, r, y] each. */
  cableCyl(c0, c1, opts) { return this.cable(cyl(c0[0], c0[1], c0[2]), cyl(c1[0], c1[1], c1[2]), opts); }

  /** Purely decorative kit piece. */
  decor(name, a, r, y, opts = {}) { return this.piece(name, a, r, y, { ...opts, collide: false }); }

  _buildInstancers() {
    for (const inst of this.instancers.values()) {
      if (!inst.matrices.length || !assets.has(inst.name)) continue;
      const src = assets.kit(inst.name);
      src.updateWorldMatrix(true, true);
      src.traverse((o) => {
        if (!o.isMesh || o.userData.helper) return;
        const tinted = inst.colors.length && o.material.name && o.material.name.startsWith('tint_');
        let material = o.material;
        if (tinted) { material = o.material.clone(); material.color.set(0xffffff); }
        const im = new THREE.InstancedMesh(o.geometry, material, inst.matrices.length);
        for (let i = 0; i < inst.matrices.length; i++) {
          im.setMatrixAt(i, _m.multiplyMatrices(inst.matrices[i], o.matrixWorld));
          if (tinted) im.setColorAt(i, new THREE.Color(inst.colors[i % inst.colors.length]));
        }
        im.frustumCulled = false;
        im.castShadow = false; im.receiveShadow = false;
        if (material.name && material.name.startsWith('glow_')) im.layers.set(LAYER_NO_OUTLINE);
        this.root.add(im);
      });
    }
  }

  // ---- gameplay objects ----------------------------------------------------------------------------------------------

  treat(a, r, y) { this.treats.add(cyl(a, r, y + 0.75)); }

  /** A row of treats between two cylinder positions (the angle and height interpolate: arcs and spirals). */
  treatLine(c0, c1, n) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.treat(c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t);
    }
  }

  add(entity) { this.entities.push(entity); return entity; }
  heart(a, r, y) { return this.add(new E.Pickup(this.ctx, 'heart', cyl(a, r, y + 0.8))); }
  charm(a, r, y) { return this.add(new E.Pickup(this.ctx, 'charm_nine', cyl(a, r, y + 0.9))); }
  checkpoint(a, r, y, section) {
    const cp = new E.Checkpoint(this.ctx, a, r, y, section, this.checkpoints.length);
    cp.object.userData.noMerge = true;
    this.root.add(cp.object);
    if (y == null) this.pendingGround.push(cp);
    this.checkpoints.push(cp);
    return this.add(cp);
  }
  gull(opts) { return this.add(new E.Gull(this.ctx, opts)); }
  jackdaw(a, r, y, opts) { return this.add(new E.Percher(this.ctx, 'jackdaw', a, r, y, opts)); }
  pigeon(a, r, y, opts) { return this.add(new E.Percher(this.ctx, 'pigeon', a, r, y, { harmless: true, ...opts })); }
  visitor(kind, a, r, yaw) { return this.add(new E.Visitor(this.ctx, kind, a, r, yaw)); }
  balloon(a, r, y, tint) { return this.add(new E.Balloon(this.ctx, a, r, y, tint)); }
  bouncer(a, r, y, radius, power) { return this.add(new E.BounceZone(this.ctx, cyl(a, r, y), radius, power)); }
  wind(opts) { return this.add(new E.Wind(this.ctx, opts)); }
  sparkler(a, r, y, opts) { return this.add(new E.Sparkler(this.ctx, a, r, y, opts)); }
  water(a, r, y, radius) { return this.add(new E.Water(this.ctx, cyl(a, r, y), radius)); }
  bumper(mover, opts) { return this.add(new E.Bumper(this.ctx, mover, opts)); }

  /**
   * A ride that waits at the bottom and carries Indy up once he stands on it (no waiting for a timetable).
   * opts: { a, r, y0, y1, speed (units/s), delay, linger, drop (fall back down fast instead of sinking), ...mover opts }
   */
  lift(nameOrObject, opts) {
    const state = { h: 0 };
    const mover = this.mover(nameOrObject, (t, o) => placeCyl(o, opts.a, opts.r, opts.y0 + (opts.y1 - opts.y0) * state.h), opts);
    mover.lift = this.add(new E.Lift(this.ctx, mover, state, opts));
    return mover;
  }

  /** Warning bulbs along a track: `spots` are { pos, s } with s the distance along the track. See E.TrackLights. */
  trackLights(spots, cars, opts) { return this.add(new E.TrackLights(this.ctx, spots, cars, opts)); }

  /**
   * Camera help for a part of the tower: while Indy is between y0 and y1 (and radius rMin..rMax), the camera runs
   * `lead` times further ahead of him round the tower and rides `lift` higher. Gaps are judged better from above.
   */
  camZone(zone) { this.camZones.push({ rMin: 0, rMax: 1e9, lead: 1, lift: 0, ...zone }); }
  camHelp(player) {
    const y = player.pos.y, r = player.radial;
    for (const z of this.camZones) if (y >= z.y0 && y <= z.y1 && r >= z.rMin && r <= z.rMax) return z;
    return NO_HELP;
  }
  hint(test, text) { return this.add(new E.Hint(this.ctx, test, text)); }
  spinner(object, axis, speed) { object.userData.noMerge = true; this.spinners.push({ object, axis, speed }); return object; }

  // ---- lifecycle -----------------------------------------------------------------------------------------------------

  finish() {
    this.world.build();
    for (const thing of this.pendingGround) thing.dropToGround(this.world);
    this.pendingGround.length = 0;
    this._mergeStatic();
    this._buildInstancers();
    this.treats.build(this.root);
    this.root.updateMatrixWorld(true);
  }

  /** Bake every static mesh of the level into one mesh per material: a couple of thousand draw calls become ~60. */
  _mergeStatic() {
    this.root.updateMatrixWorld(true);
    const groups = new Map();
    const remove = [];
    const visit = (o) => {
      if (o.userData.noMerge) return;
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) {
        remove.push(o);
        if (!o.userData.helper && o.visible) {
          const kind = assets.kindOf(o.material);
          let material = o.material, g;
          if (kind) {
            g = colouredGeometry(o.geometry, o.material.color, o.matrixWorld);
            material = kind === 'toon' ? assets.vcToon : assets.vcGlow;
          } else {
            const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
            g = new THREE.BufferGeometry();
            g.setAttribute('position', src.getAttribute('position').clone());
            if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone());
            else g.computeVertexNormals();
            g.applyMatrix4(o.matrixWorld);
          }
          const cast = kind === 'glow' ? false : o.castShadow;
          const mask = kind === 'glow' ? (1 << LAYER_NO_OUTLINE) : o.layers.mask;
          const key = material.uuid + ':' + mask + ':' + (cast ? 1 : 0) + ':' + (o.receiveShadow ? 1 : 0);
          if (!groups.has(key)) groups.set(key, { material, mask, cast, receive: o.receiveShadow, list: [] });
          groups.get(key).list.push(g);
        }
      }
      for (const c of o.children) visit(c);
    };
    visit(this.root);
    for (const o of remove) if (!o.children.length) o.removeFromParent(); else o.visible = false;
    for (const { material, mask, cast, receive, list } of groups.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
      mesh.layers.mask = mask;
      mesh.castShadow = cast; mesh.receiveShadow = receive && !String(material.name).startsWith('glow_');
      mesh.userData.noMerge = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      for (const g of list) g.dispose();
    }
  }

  updateMovers(t) { for (const m of this.movers) m.update(t); }

  update(dt, t, player) {
    for (const s of this.spinners) s.object.rotation[s.axis] = s.speed * t;
    this.treats.update(dt, t, player);
    for (const e of this.entities) e.update(dt, t, player);
  }

  /** Meow: everything within range reacts. */
  meow(pos) { for (const e of this.entities) if (e.onMeow) e.onMeow(pos); }

  reset() {
    this.treats.reset();
    for (const e of this.entities) e.reset?.();
  }
}
