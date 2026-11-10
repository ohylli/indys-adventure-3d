// Sky and time of day. Public API (keep these names and signatures):
//
//   import { Sky } from './world/sky.js';
//   const sky = new Sky(scene);
//   sky.setTime(t)            t in 0..1. 0 = golden late afternoon (warm low sun, blue sky),
//                             0.5 = sunset (orange/pink horizon, sun touching the horizon),
//                             1 = dusk (deep blue/purple above, glowing band at the horizon, first stars).
//                             The game drives t from Indy's altitude, so it changes slowly and may go both ways.
//   sky.update(dt, camera)    once per frame: keeps the dome centred on the camera, twinkles stars.
//   sky.flash(amount)         brief additive lift of the whole sky (firework burst), decays on its own.
//   sky.state                 updated by setTime; the game applies these to its lights and fog:
//       sunDir        Vector3  direction TOWARD the sun (normalized). The sun sets in the north-west: keep its
//                              azimuth fixed around there and lower the elevation from about 25° to -6°.
//       sunColor      Color    directional light colour
//       sunIntensity  number   (toon materials; about 2.2 in the afternoon down to 0.5 at dusk)
//       hemiSky       Color, hemiGround Color, hemiIntensity number
//       fogColor      Color    equals the horizon colour so distant land melts into the sky
//       fogDensity    number   for THREE.FogExp2 (about 0.0009 .. 0.0016)
//       glow          number   0..1 how strongly festival lights should glow (0 in daylight, 1 at dusk)
//
// What it draws (all on LAYER_NO_OUTLINE, fog: false, depthWrite: false, renderOrder very low):
//   - a dome with a stylized vertical gradient (3–4 colour stops, slight banding is fine and suits the toon look)
//   - a clean cartoon sun disc with a soft halo; near sunset it becomes big and orange
//   - stars that fade in after sunset (points, gentle twinkle), maybe a pale moon
//   - optional thin stylized horizon haze band
// Clouds are models from environment.glb and are not handled here.
//
// Implementation notes:
// - Extra state fields: state.t, state.lightDir (Vector3: sunDir with the elevation clamped to >= 10°, a nicer
//   choice for the DirectionalLight once the sun is below the horizon), state.stars (0..1), state.horizon (Color,
//   same as fogColor), state.zenith (Color).
// - The dome is a sphere of radius 900 (needs camera.far > 900), depthTest/depthWrite off, renderOrder -1000; the
//   stars are Points at radius 850, renderOrder -999. Both sit in the opaque queue, so they draw first and
//   everything else draws over them. The camera must have layer 1 enabled (camera.layers.enable(LAYER_NO_OUTLINE)).
// - The sun azimuth is fixed at SUN_AZIMUTH_DEG (game θ convention: direction (sin θ, 0, cos θ)), i.e. toward
//   -X/-Z ("north-west" with north = -Z, west = -X).
// - All look values live in the KEYS table below (colours of the gradient, sun, lights and fog side by side) and
//   are interpolated with a smoothstep between neighbouring keyframes, so any t in 0..1 is valid.

import * as THREE from 'three';
import { LAYER_NO_OUTLINE } from '../core/layers.js';

export const SUN_AZIMUTH_DEG = 215;
const DEG = Math.PI / 180;
const DOME_R = 900;
const STAR_R = 850;
const STAR_COUNT = 650;

// Keyframes. Gradient stops (bottom → top): horizon (elevation 0, also the fog colour), low, mid, high, zenith.
// `h` = sin(elevation) of the low/mid/high stops.
const KEYS = [
  { t: 0.0, elev: 25, // golden late afternoon
    sky: ['#f7e8c4', '#d3e8ee', '#93c9f2', '#4f9cec', '#2b72d8'], h: [0.06, 0.17, 0.4], band: 0.55,
    sun: '#fffbea', sunSize: 2.6, sunSoft: 0.1, halo: '#fff4c8', haloAmt: 0.42, glow: '#ffe7a8', glowAmt: 0.32,
    glowH: 0.22,
    light: '#fff0d6', lightI: 2.05, hemiSky: '#c4e0ff', hemiGround: '#a8916a', hemiI: 1.15, fog: 0.0009,
    festival: 0, stars: 0 },
  { t: 0.25, elev: 13, // golden hour
    sky: ['#ffd79a', '#ffd2a6', '#a9c6ee', '#5e93e2', '#2c62c8'], h: [0.05, 0.15, 0.36], band: 0.6,
    sun: '#fff1bf', sunSize: 3.2, sunSoft: 0.12, halo: '#ffdf94', haloAmt: 0.5, glow: '#ffc670', glowAmt: 0.45,
    glowH: 0.2,
    light: '#ffdcaa', lightI: 1.8, hemiSky: '#b9c8f0', hemiGround: '#a07e5c', hemiI: 1.15, fog: 0.001,
    festival: 0.05, stars: 0 },
  { t: 0.5, elev: 3.6, // sunset: deep blue -> magenta -> orange -> yellow
    sky: ['#ffd56a', '#ff8f45', '#d9508f', '#5a3ca4', '#1b2a7c'], h: [0.045, 0.12, 0.28], band: 0.7,
    sun: '#ffc24a', sunSize: 5.2, sunSoft: 0.06, halo: '#ff9a48', haloAmt: 0.55, glow: '#ff8a3c', glowAmt: 0.55,
    glowH: 0.16,
    light: '#ffae78', lightI: 1.3, hemiSky: '#a596d8', hemiGround: '#946070', hemiI: 1.2, fog: 0.0012,
    festival: 0.35, stars: 0 },
  { t: 0.75, elev: -2.5, // after sunset
    sky: ['#ff9f72', '#e86a7e', '#9a4a9e', '#3d3592', '#16246a'], h: [0.035, 0.11, 0.28], band: 0.75,
    sun: '#ffa04a', sunSize: 5.2, sunSoft: 0.08, halo: '#ff7a50', haloAmt: 0.4, glow: '#ff7a5a', glowAmt: 0.5,
    glowH: 0.12,
    light: '#ff9a88', lightI: 0.85, hemiSky: '#9690dc', hemiGround: '#6e4e76', hemiI: 1.5, fog: 0.0014,
    festival: 0.75, stars: 0.35 },
  { t: 1.0, elev: -6, // dusk: indigo -> violet -> thin warm afterglow at the horizon
    sky: ['#dc8a84', '#ffae76', '#7c4f9f', '#352e86', '#121848'], h: [0.022, 0.08, 0.24], band: 0.8,
    sun: '#ff8a4a', sunSize: 5.2, sunSoft: 0.1, halo: '#ff6a50', haloAmt: 0.25, glow: '#ff8a62', glowAmt: 0.42,
    glowH: 0.07,
    light: '#ffa49a', lightI: 0.6, hemiSky: '#9898ec', hemiGround: '#70528a', hemiI: 1.8, fog: 0.0016,
    festival: 1, stars: 1 },
];
// pre-convert colours (linear working space)
for (const k of KEYS) {
  k.skyC = k.sky.map((h) => new THREE.Color(h));
  for (const f of ['sun', 'halo', 'glow', 'light', 'hemiSky', 'hemiGround']) k[f + 'C'] = new THREE.Color(k[f]);
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uC0, uC1, uC2, uC3, uC4;
uniform vec3 uH; // stop heights
uniform float uBand;
uniform vec3 uSunDir;
uniform vec3 uSunCol, uHaloCol, uGlowCol;
uniform vec4 uSun; // x radius (rad), y softness, z halo amount, w glow amount
uniform float uGlowH;
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uFlash;
varying vec3 vDir;

vec3 grad(float y) {
  vec3 c = mix(uC0, uC1, smoothstep(0.0, uH.x, y));
  c = mix(c, uC2, smoothstep(uH.x, uH.y, y));
  c = mix(c, uC3, smoothstep(uH.y, uH.z, y));
  c = mix(c, uC4, smoothstep(uH.z, 1.0, y));
  return c;
}
float disc(float d, float r, float soft) {
  float fw = fwidth(d) + 1e-5;
  return 1.0 - smoothstep(r - soft - fw, r + fw, d);
}

void main() {
  vec3 dir = normalize(vDir);
  float y = max(dir.y, 0.0);
  // the warm side of the sky reaches higher toward the sun: bands bulge up around the sun's azimuth
  vec3 hflat = normalize(vec3(dir.x, 0.0, dir.z) + 1e-5);
  vec3 sflat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
  float az = dot(hflat, sflat) * 0.5 + 0.5; // 1 toward the sun, 0 away
  float azk = az * az * az;
  float ye = y / (1.0 + uSun.w * 1.3 * azk);
  // posterized gradient: bands in sqrt space (thinner near the horizon). Each band shows the gradient at its centre
  // (mixed with the smooth gradient by uBand); neighbouring bands are blended over one pixel for clean edges.
  const float N = 10.0;
  float f = sqrt(ye) * N;
  float k = floor(f);
  float e = fract(f);
  float nb = e < 0.5 ? k - 1.0 : k + 1.0;
  float de = e < 0.5 ? e : 1.0 - e;
  float wgt = 0.5 * (1.0 - smoothstep(0.0, fwidth(f) + 1e-4, de));
  float yk = mix(ye, pow((k + 0.5) / N, 2.0), uBand);
  float yn = mix(ye, pow(max(nb + 0.5, 0.0) / N, 2.0), uBand);
  vec3 col = mix(grad(yk), grad(yn), wgt);
  float yb = mix(yk, yn, wgt);

  // warm glow toward the sun azimuth, strongest at the horizon (follows the bands)
  float glow = azk * azk * exp(-yb / uGlowH);
  col = mix(col, uGlowCol, clamp(glow * uSun.w, 0.0, 1.0));

  // sun: clean disc + stepped halo rings + soft bloom
  float ang = 2.0 * asin(clamp(length(dir - uSunDir) * 0.5, 0.0, 1.0));
  float r = uSun.x;
  float horizon = smoothstep(-0.002, 0.004, dir.y);
  float halo = 0.45 * disc(ang, r * 1.4, r * 0.08) + 0.25 * disc(ang, r * 2.0, r * 0.1);
  halo += 0.55 * exp(-ang / (r * 2.4));
  col = mix(col, uHaloCol, clamp(halo * uSun.z * mix(0.4, 1.0, horizon), 0.0, 1.0));
  float sd = disc(ang, r, r * uSun.y) * horizon;
  vec3 sunC = mix(uSunCol, mix(uSunCol, vec3(1.0, 0.97, 0.72), 0.5), disc(ang, r * 0.62, r * 0.04)); // two-tone disc
  col = mix(col, sunC, sd);

  // moon: pale crescent, fades in with the stars
  if (uStars > 0.0) {
    vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 my = cross(uMoonDir, mx);
    vec2 mp = vec2(dot(dir, mx), dot(dir, my)) / 0.024;
    float front = step(0.0, dot(dir, uMoonDir));
    float md = length(mp);
    float m = disc(md, 1.0, 0.04) * (1.0 - disc(length(mp - vec2(-0.42, 0.28)), 0.92, 0.04)) * front;
    float mg = exp(-md * 0.55) * 0.12 * front;
    col = mix(col, vec3(1.0, 0.95, 0.8), clamp(m + mg, 0.0, 1.0) * uStars);
  }

  // below the horizon: horizon colour, gently darker further down
  if (dir.y < 0.0) col = mix(uC0, uC0 * 0.86, smoothstep(0.0, -0.4, dir.y));
  col += uFlash * vec3(0.30, 0.26, 0.34) * (0.55 + 0.45 * y);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const STAR_VERT = /* glsl */ `
attribute vec4 aStar; // x size px, y phase, z twinkle speed, w brightness
uniform float uTime;
uniform float uStars;
uniform float uScale;
varying float vA;
varying float vBig;
void main() {
  vec3 dir = normalize(position);
  float tw = 0.62 + 0.38 * sin(uTime * aStar.z + aStar.y);
  vA = uStars * aStar.w * tw * smoothstep(0.04, 0.22, dir.y);
  vBig = step(2.6, aStar.x);
  gl_PointSize = aStar.x * uScale * (0.85 + 0.15 * tw);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  if (vA <= 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const STAR_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying float vBig;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p) - 0.45;
  if (vBig > 0.5) {
    // bright stars: small 4-point twinkle
    vec2 q = abs(p);
    float crs = min(q.x * 4.0 + q.y, q.y * 4.0 + q.x) - 0.9;
    d = min(d, crs * 0.35);
  }
  float fw = fwidth(d) + 1e-4;
  float a = clamp(0.5 - d / fw, 0.0, 1.0) * vA;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

// small deterministic RNG for the star field
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x) => x * x * (3 - 2 * x);
const _vp = new THREE.Vector4();

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.state = {
      t: 0,
      sunDir: new THREE.Vector3(-0.5, 0.4, -0.7).normalize(),
      lightDir: new THREE.Vector3(-0.5, 0.4, -0.7).normalize(),
      sunColor: new THREE.Color('#fff1d6'), sunIntensity: 2.2,
      hemiSky: new THREE.Color('#bfe3ff'), hemiGround: new THREE.Color('#8a7a5c'), hemiIntensity: 1.1,
      fogColor: new THREE.Color('#cfe6f5'), fogDensity: 0.0011, glow: 0,
      stars: 0,
      horizon: new THREE.Color(), zenith: new THREE.Color(),
    };
    this._flash = 0;
    this._time = 0;
    this._t = -1;

    const u = (this.uniforms = {
      uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() },
      uC3: { value: new THREE.Color() }, uC4: { value: new THREE.Color() },
      uH: { value: new THREE.Vector3() },
      uBand: { value: 0.5 },
      uSunDir: { value: new THREE.Vector3() },
      uSunCol: { value: new THREE.Color() }, uHaloCol: { value: new THREE.Color() }, uGlowCol: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector4() },
      uGlowH: { value: 0.2 },
      uMoonDir: { value: new THREE.Vector3(0.62, 0.36, 0.7).normalize() },
      uStars: { value: 0 },
      uFlash: { value: 0 },
    });

    this.group = new THREE.Group();
    this.group.name = 'sky';
    const domeMat = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    });
    const dome = (this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 48, 32), domeMat));
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    dome.layers.set(LAYER_NO_OUTLINE);
    dome.name = 'sky-dome';
    this.group.add(dome);

    // stars
    const r = rng(1234);
    const pos = new Float32Array(STAR_COUNT * 3);
    const at = new Float32Array(STAR_COUNT * 4);
    for (let k = 0; k < STAR_COUNT; k++) {
      // denser toward the zenith, none right at the horizon
      const yy = 0.06 + 0.94 * Math.sqrt(r());
      const ph = r() * Math.PI * 2;
      const rr = Math.sqrt(1 - yy * yy);
      pos.set([Math.cos(ph) * rr * STAR_R, yy * STAR_R, Math.sin(ph) * rr * STAR_R], k * 3);
      const big = r() < 0.07;
      at.set([big ? 4.2 + r() * 1.6 : 1.4 + r() * 1.2, r() * 6.283, 1.2 + r() * 2.8, big ? 1 : 0.45 + r() * 0.5],
        k * 4);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aStar', new THREE.BufferAttribute(at, 4));
    this.starUniforms = { uTime: { value: 0 }, uStars: u.uStars, uScale: { value: 1 },
      uColor: { value: new THREE.Color('#fff6dc') } };
    const starMat = new THREE.ShaderMaterial({
      uniforms: this.starUniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    });
    const stars = (this.stars = new THREE.Points(sg, starMat));
    stars.renderOrder = -999;
    stars.frustumCulled = false;
    stars.layers.set(LAYER_NO_OUTLINE);
    stars.name = 'sky-stars';
    // scale point sizes with the render height (works with retro low-res targets too)
    stars.onBeforeRender = (renderer) => {
      renderer.getCurrentViewport(_vp);
      this.starUniforms.uScale.value = Math.max(0.5, _vp.w / 900);
    };
    this.group.add(stars);
    scene.add(this.group);
    this.setTime(0);
  }

  setTime(t) {
    t = Math.min(1, Math.max(0, t));
    if (t === this._t) return;
    this._t = t;
    let k = 0;
    while (k < KEYS.length - 2 && t > KEYS[k + 1].t) k++;
    const A = KEYS[k], B = KEYS[k + 1];
    const f = smooth(Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t))));
    const L = (a, b) => a + (b - a) * f;
    const u = this.uniforms, s = this.state;
    s.t = t;
    for (let i = 0; i < 5; i++) u['uC' + i].value.copy(A.skyC[i]).lerp(B.skyC[i], f);
    u.uH.value.set(L(A.h[0], B.h[0]), L(A.h[1], B.h[1]), L(A.h[2], B.h[2]));
    u.uBand.value = L(A.band, B.band);
    const elev = L(A.elev, B.elev) * DEG;
    const az = SUN_AZIMUTH_DEG * DEG;
    s.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
    const le = Math.max(elev, 10 * DEG);
    s.lightDir.set(Math.sin(az) * Math.cos(le), Math.sin(le), Math.cos(az) * Math.cos(le)).normalize();
    u.uSunDir.value.copy(s.sunDir);
    u.uSunCol.value.copy(A.sunC).lerp(B.sunC, f);
    u.uHaloCol.value.copy(A.haloC).lerp(B.haloC, f);
    u.uGlowCol.value.copy(A.glowC).lerp(B.glowC, f);
    u.uSun.value.set(L(A.sunSize, B.sunSize) * DEG, L(A.sunSoft, B.sunSoft), L(A.haloAmt, B.haloAmt),
      L(A.glowAmt, B.glowAmt));
    u.uGlowH.value = L(A.glowH, B.glowH);
    s.stars = L(A.stars, B.stars);
    u.uStars.value = s.stars;

    s.sunColor.copy(A.lightC).lerp(B.lightC, f);
    s.sunIntensity = L(A.lightI, B.lightI);
    s.hemiSky.copy(A.hemiSkyC).lerp(B.hemiSkyC, f);
    s.hemiGround.copy(A.hemiGroundC).lerp(B.hemiGroundC, f);
    s.hemiIntensity = L(A.hemiI, B.hemiI);
    s.fogColor.copy(u.uC0.value);
    s.horizon.copy(u.uC0.value);
    s.zenith.copy(u.uC4.value);
    s.fogDensity = L(A.fog, B.fog);
    s.glow = L(A.festival, B.festival);
  }

  update(dt, camera) {
    if (camera) {
      camera.updateMatrixWorld();
      this.group.position.setFromMatrixPosition(camera.matrixWorld);
    }
    this._time += dt;
    this.starUniforms.uTime.value = this._time;
    if (this._flash > 0) {
      this._flash *= Math.exp(-dt * 6);
      if (this._flash < 0.002) this._flash = 0;
    }
    this.uniforms.uFlash.value = this._flash;
  }

  flash(amount = 0.5) {
    this._flash = Math.min(1, this._flash + amount);
  }

  dispose() {
    this.scene.remove(this.group);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
  }
}
