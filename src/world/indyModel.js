// Indy's visual: the skinned model, its animation state machine and the little procedural touches on top
// (blink, meow mouth, squash and stretch, climbing pose, blob shadow).
import * as THREE from 'three';
import { assets } from '../core/assets.js';
import { LAYER_NO_OUTLINE } from '../core/layers.js';
import { angleDiff } from './player.js';

const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

function verticalAxis(bone) {
  // which local axis of this bone points up in the rest pose
  bone.updateWorldMatrix(true, false);
  const e = bone.matrixWorld.elements;
  const ys = [Math.abs(e[1]), Math.abs(e[5]), Math.abs(e[9])];
  return ys.indexOf(Math.max(...ys));
}

export class IndyModel {
  constructor() {
    const { scene, clips } = assets.indy();
    this.root = new THREE.Group();          // at the player's feet, yawed
    this.pivot = new THREE.Group();         // climb pitch + squash
    this.root.add(this.pivot);
    this.pivot.add(scene);
    this.scene = scene;
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
    this.fedora = scene.getObjectByName('fedora');
    if (this.fedora) this.fedora.visible = false;
    this.bones = {};
    for (const n of ['head', 'eye_L', 'eye_R', 'mouth', 'ear_L', 'ear_R']) this.bones[n] = scene.getObjectByName(n);
    this.eyeAxis = this.bones.eye_L ? verticalAxis(this.bones.eye_L) : 1;

    this.mixer = new THREE.AnimationMixer(scene);
    this.actions = {};
    for (const clip of clips) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'land' || clip.name === 'hurt') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[clip.name] = a;
    }
    this.current = null;
    this.play('idle', 0);
    this.squash = 1; this.squashVel = 0;
    this.pitch = 0;
    this.blinkT = 2; this.blink = 0;
    this.meowT = 0; this.oneShot = 0; this.forced = null;
    this.yaw = 0;
    this.visibleBlink = 0;

    // blob shadow: tells you where you will land
    const g = new THREE.CircleGeometry(0.5, 20); g.rotateX(-Math.PI / 2);
    this.blob = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x1a1426, transparent: true, opacity: 0.4, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.blob.layers.set(LAYER_NO_OUTLINE);
    this.blob.renderOrder = 5;
  }

  play(name, fade = 0.12) {
    const next = this.actions[name];
    if (!next || this.current === name) return;
    const prev = this.actions[this.current];
    next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.setEffectiveTimeScale(1);
    if (prev && fade > 0) { next.crossFadeFrom(prev, fade, false); } else if (prev) prev.stop();
    next.play();
    this.current = name;
  }

  hat(on) { if (this.fedora) this.fedora.visible = on; }
  meow() { this.meowT = 0.5; }
  hurt() { this.oneShot = 0.45; this.play('hurt', 0.05); }
  jumpPulse() { this.squashVel = 5.5; }
  landPulse(impact) { this.squashVel = -Math.min(9, 2.5 + impact * 0.35); }

  /** pos: interpolated feet position. */
  update(dt, player, pos, world, opts = {}) {
    // --- choose the clip
    this.oneShot = Math.max(0, this.oneShot - dt);
    let name = 'idle', scale = 1;
    if (this.forced) name = this.forced;
    else if (this.oneShot > 0) name = this.current;
    else if (player.state === 'climb') { name = 'climb'; scale = Math.min(1.7, Math.abs(player.climbMove) / 2.6); }
    else if (player.state === 'ground') {
      const sp = player.speed;
      if (sp < 0.4) name = 'idle';
      else if (sp < 2.6) { name = 'walk'; scale = Math.max(0.6, sp / 1.9); }
      else { name = 'run'; scale = 0.55 + sp / 6.4 * 0.75; }
    } else if (player.pouncing) name = 'pounce';
    else name = player.vel.y > 1.5 ? 'jump' : 'fall';
    const fade = name === 'jump' || name === 'pounce' ? 0.06 : name === 'climb' || this.current === 'climb' ? 0.1 : 0.13;
    this.play(name, fade);
    const act = this.actions[this.current];
    if (act && this.oneShot <= 0) act.setEffectiveTimeScale(scale);
    this.mixer.update(dt);

    // --- transform
    this.root.position.copy(pos);
    this.yaw += angleDiff(this.yaw, player.yaw) * Math.min(1, dt * 22);
    this.root.rotation.y = this.yaw;
    const climbing = player.state === 'climb';
    this.pitch += ((climbing ? -Math.PI / 2 : 0) - this.pitch) * Math.min(1, dt * 14);
    this.pivot.rotation.x = this.pitch;
    const k = -this.pitch / (Math.PI / 2);
    this.pivot.position.set(0, 0.12 * k, 0.33 * k);

    // squash and stretch: a damped spring around 1
    this.squashVel += (1 - this.squash) * 190 * dt;
    this.squashVel *= Math.exp(-13 * dt);
    this.squash = THREE.MathUtils.clamp(this.squash + this.squashVel * dt, 0.72, 1.28);
    const s = this.squash, w = 1 / Math.sqrt(s);
    this.pivot.scale.set(w, s, w);

    // --- face
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blinkT = 2.2 + Math.random() * 3.5; this.blink = 0.13; }
    this.blink = Math.max(0, this.blink - dt);
    this.meowT = Math.max(0, this.meowT - dt);
    const meow = this.meowT > 0 ? Math.sin(Math.min(1, (0.5 - this.meowT) / 0.5) * Math.PI) : 0;
    let eye = this.blink > 0 ? 0.08 : 1;
    if (meow > 0.1) eye = Math.min(eye, 1 - 0.6 * meow);
    if (opts.happy) eye = Math.min(eye, 0.2);
    for (const n of ['eye_L', 'eye_R']) {
      const b = this.bones[n];
      if (b) b.scale.setComponent(this.eyeAxis, b.scale.getComponent(this.eyeAxis) * eye);
    }
    if (this.bones.mouth && meow > 0) this.bones.mouth.scale.setScalar(Math.max(this.bones.mouth.scale.x, meow));

    // hurt flicker
    this.scene.visible = !(opts.invuln > 0 && Math.floor(opts.invuln * 14) % 2 === 0);

    // --- blob shadow on whatever is below
    _v.set(pos.x, pos.y + 0.5, pos.z);
    const hit = world.raycastDown(_v, 40);
    if (hit && !climbing) {
      const h = pos.y - hit.point.y;
      this.blob.visible = true;
      this.blob.position.copy(hit.point); this.blob.position.y += 0.03;
      const sc = THREE.MathUtils.clamp(1 - h * 0.035, 0.45, 1) * 0.95;
      this.blob.scale.setScalar(sc);
      this.blob.material.opacity = THREE.MathUtils.clamp(0.42 - h * 0.012, 0.16, 0.42);
    } else this.blob.visible = false;
  }
}
