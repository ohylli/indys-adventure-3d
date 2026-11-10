// FX sandbox: sky / particles / fireworks. Open http://127.0.0.1:5183/tools/fx.html
// Debug hook for scripted screenshots: window.fx (see bottom). ?clean hides the panel.
import * as THREE from 'three';
import { Sky } from '../src/world/sky.js';
import { ParticleSystem } from '../src/fx/particles.js';
import { Fireworks } from '../src/fx/fireworks.js';
import { LAYER_NO_OUTLINE } from '../src/core/layers.js';

const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');

// --- deterministic random (fx.seed) ---
const nativeRandom = Math.random;
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xffffff, 0.001);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 4000);
camera.layers.enable(LAYER_NO_OUTLINE);

const sun = new THREE.DirectionalLight(0xffffff, 2);
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
scene.add(sun, sun.target, hemi);

// 3-step toon gradient
const grad = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: grad });

// ground, tower, props, distant hills
const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 64), toon('#7cc35a'));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 100, 24), toon('#ece6da'));
tower.position.y = 50;
scene.add(tower);
const pod = new THREE.Mesh(new THREE.CylinderGeometry(13, 10, 5, 32), toon('#d8504a'));
pod.position.y = 102.5;
scene.add(pod);
const podTop = new THREE.Mesh(new THREE.CylinderGeometry(9, 13, 2, 32), toon('#f2efe6'));
podTop.position.y = 106;
scene.add(podTop);
const boxes = [['#e8473f', -4, 12, 1.6], ['#ffcf3a', 4.5, 11, 1.2], ['#3f8de8', -7, 6, 2], ['#ffffff', 3, 13.5, 1],
  ['#8a5ad8', 8, 4, 1.4], ['#ffffff', -9, -3, 2.4]];
for (const [c, x, z, s] of boxes) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), toon(c));
  b.position.set(x, s / 2, z);
  b.rotation.y = x * 0.3;
  scene.add(b);
}
// 1-unit-tall stand-in for Indy
const indy = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.4, 6, 12), toon('#ffffff'));
indy.position.set(-1.1, 0.5, 10);
scene.add(indy);
const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), toon('#5a4a42'));
cap.position.set(-1.1, 0.92, 10);
scene.add(cap);
const r = mulberry(7);
for (let k = 0; k < 40; k++) {
  const a = r() * Math.PI * 2, d = 500 + r() * 1300, h = 40 + r() * 120;
  const hill = new THREE.Mesh(new THREE.ConeGeometry(h * 1.8, h, 7), toon(r() < 0.5 ? '#4f9a4a' : '#5f8f5a'));
  hill.position.set(Math.sin(a) * d, h / 2 - 2, Math.cos(a) * d);
  scene.add(hill);
}
const lake = new THREE.Mesh(new THREE.CircleGeometry(300, 32), toon('#4aa7d8'));
lake.rotation.x = -Math.PI / 2;
lake.position.set(-250, 0.05, -350);
scene.add(lake);

// --- fx ---
const sky = new Sky(scene);
const particles = new ParticleSystem(scene, { max: 4000 });
const fireworks = new Fireworks(scene);
fireworks.onBurst = (pos, size) => sky.flash(0.25 * size);

let useLightDir = false;
function applySky(t) {
  sky.setTime(t);
  const s = sky.state;
  sun.color.copy(s.sunColor);
  sun.intensity = s.sunIntensity;
  sun.position.copy(useLightDir ? s.lightDir : s.sunDir).multiplyScalar(100);
  hemi.color.copy(s.hemiSky);
  hemi.groundColor.copy(s.hemiGround);
  hemi.intensity = s.hemiIntensity;
  scene.fog.color.copy(s.fogColor);
  scene.fog.density = s.fogDensity;
  document.getElementById('tval').textContent = t.toFixed(2);
  document.getElementById('time').value = t;
}

// --- camera ---
const camState = { theta: 35, r: 25, y: 60, pitch: 8, yaw: null, orbit: false };
// camera on the cylinder (theta, r, y); looks inward (or along azimuth `yaw` in degrees), pitched up by `pitch`
function setCam(theta, rad, y, pitch = 0, yaw = null) {
  Object.assign(camState, { theta, r: rad, y, pitch, yaw });
  placeCam();
}
function placeCam() {
  const { theta, r: rad, y, pitch } = camState;
  const th = (theta * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  const yaw = camState.yaw == null ? th + Math.PI : (camState.yaw * Math.PI) / 180;
  camera.position.set(Math.sin(th) * rad, y, Math.cos(th) * rad);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
  camera.lookAt(camera.position.clone().add(dir));
}
const SPOT = new THREE.Vector3(0, 0.6, 10);
const FW_SPOT = new THREE.Vector3(0, 128, -40);
const views = {
  sunward: () => setCam(305, 25, 60, 9, 215),
  away: () => setCam(125, 25, 60, 9, 35),
  particles: () => { camState.orbit = false; camera.position.set(0, 1.5, 18); camera.lookAt(0, 0.9, 10); },
  close: () => { camState.orbit = false; camera.position.set(0, 1.3, 14); camera.lookAt(0, 0.85, 10); },
  fireworks: () => setCam(0, 25, 112, 14),
};
function view(name) {
  camState.custom = false;
  views[name]();
}

// --- actions ---
const TYPES = ['dust', 'land', 'jump', 'sparkle', 'heart', 'star', 'feather', 'confetti', 'splash', 'pop', 'meow',
  'spark', 'hurt'];
function burst(type, opts = {}) {
  const p = SPOT.clone();
  if (type === 'dust' || type === 'land' || type === 'jump') p.y = 0.05;
  if (type === 'splash') p.y = 0.1;
  if (type === 'meow') { p.set(0.35, 0.7, 10); opts = { dir: new THREE.Vector3(1, 0, 0), ...opts }; }
  if (type === 'pop') { p.y = 1.6; opts = { color: 0xff4f6d, ...opts }; }
  if (type === 'confetti') p.y = 1.2;
  if (type === 'feather') p.y = 1.4;
  particles.burst(type, p, opts);
}
let windH = null, fountainH = null, showH = null;
function wind(on = !windH) {
  if (windH) { windH.stop(); windH = null; }
  if (on) windH = particles.stream('wind', { position: new THREE.Vector3(0, 2, 9), dir: new THREE.Vector3(1, 0.05, 0),
    size: new THREE.Vector3(14, 4, 4) });
  return !!windH;
}
function fountain(on = !fountainH) {
  if (fountainH) { fountainH.stop(); fountainH = null; }
  if (on) fountainH = particles.stream('spark', { position: new THREE.Vector3(2.5, 0.1, 9) });
  return !!fountainH;
}
function firework(style, opts = {}) {
  if (opts.rocket) fireworks.launch(new THREE.Vector3(FW_SPOT.x, 60, FW_SPOT.z), { style, height: FW_SPOT.y - 60, ...opts });
  else fireworks.burstAt(FW_SPOT, { style, ...opts });
}
function show(on = !showH) {
  if (showH) { showH.stop(); showH = null; }
  if (on) showH = fireworks.show(new THREE.Vector3(0, 100, 0), { radius: 40, minY: 120, maxY: 150, launchY: 70 });
  return !!showH;
}

// --- loop ---
let paused = false;
let last = performance.now();
const frameTimes = [];
let cpuUpdate = 0, cpuRender = 0;
function simulate(dt) {
  if (camState.orbit) { camState.theta += dt * 8; placeCam(); }
  particles.update(dt);
  fireworks.update(dt);
  sky.update(dt, camera);
}
function render() {
  renderer.render(scene, camera);
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  frameTimes.push(now - last);
  if (frameTimes.length > 240) frameTimes.shift();
  last = now;
  if (!paused) {
    const t0 = performance.now();
    simulate(dt);
    const t1 = performance.now();
    render();
    const t2 = performance.now();
    cpuUpdate = cpuUpdate * 0.95 + (t1 - t0) * 0.05;
    cpuRender = cpuRender * 0.95 + (t2 - t1) * 0.05;
  }
  if ((now | 0) % 15 === 0 || !paused) updateStats();
}
let statsEl = document.getElementById('stats'), statTick = 0;
function updateStats() {
  if (++statTick % 10) return;
  const avg = frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length);
  statsEl.textContent = `frame ${avg.toFixed(1)} ms  calls ${renderer.info.render.calls}\n` +
    `particles ${particles.live}  fireworks ${fireworks.live}\nupdate ${cpuUpdate.toFixed(2)} ms  render ${cpuRender.toFixed(2)} ms`;
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// --- UI ---
const $ = (id) => document.getElementById(id);
$('time').addEventListener('input', (e) => applySky(+e.target.value));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => view(b.dataset.view)));
$('orbit').onclick = (e) => { camState.orbit = !camState.orbit; e.target.classList.toggle('on', camState.orbit); };
$('flash').onclick = () => sky.flash(0.5);
for (const t of TYPES) {
  const b = document.createElement('button');
  b.textContent = t;
  b.onclick = () => burst(t);
  $('ptypes').appendChild(b);
}
$('wind').onclick = (e) => e.target.classList.toggle('on', wind());
$('fountain').onclick = (e) => e.target.classList.toggle('on', fountain());
for (const s of ['peony', 'ring', 'willow', 'heart', 'paw', 'random']) {
  const b = document.createElement('button');
  b.textContent = s;
  b.onclick = (e) => firework(s, { rocket: !e.shiftKey });
  $('fstyles').appendChild(b);
}
$('show').onclick = (e) => e.target.classList.toggle('on', show());

applySky(+params.get('t') || 0);
view(params.get('view') || 'sunward');
requestAnimationFrame(frame);

// --- debug hook ---
const errors = [];
addEventListener('error', (e) => errors.push(String(e.message)));
window.fx = {
  THREE, renderer, scene, camera, sky, particles, fireworks, errors,
  setTime: applySky,
  useLightDir(v) { useLightDir = v; applySky(sky.state.t); },
  view, setCam, burst, wind, fountain, firework, show,
  pause(v = true) { paused = v; },
  seed(n) { Math.random = n == null ? nativeRandom : mulberry(n); },
  step(dt = 1 / 60, n = 1) { for (let k = 0; k < n; k++) simulate(dt); render(); },
  render,
  clear() { particles.clear(); fireworks.clear(); wind(false); fountain(false); show(false); },
  stats() {
    return { particles: particles.live, fireworks: fireworks.live, calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles, programs: renderer.info.programs.length };
  },
  // real-time benchmark: frame intervals + CPU cost of update/render while running the given setup
  async bench(seconds = 5) {
    paused = false;
    const t0 = performance.now();
    frameTimes.length = 0;
    let maxLive = 0;
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((r) => setTimeout(r, 100));
      maxLive = Math.max(maxLive, fireworks.live + particles.live);
    }
    const ft = frameTimes.slice(1).sort((a, b) => a - b);
    return { avgFrame: ft.reduce((a, b) => a + b, 0) / ft.length, p95: ft[Math.floor(ft.length * 0.95)],
      cpuUpdate, cpuRender, maxLive, calls: renderer.info.render.calls };
  },
  // GPU-bound estimate: render n frames synchronously, forcing completion each time with a 1-pixel readback
  gpuBench(n = 60) {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let k = 0; k < n; k++) { simulate(1 / 60); render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - t0) / n;
  },
  ready: true,
};
