// Shared GPU particle pool used by particles.js and fireworks.js (each owns its own pools).
//
// One pool = one draw call: an InstancedBufferGeometry quad with a single interleaved per-instance buffer
// (16 floats per particle) and a ShaderMaterial that draws flat toon shapes procedurally (signed distance
// functions, anti-aliased with fwidth). Simulation runs on the CPU in typed arrays (structure of arrays);
// slots are reused as a ring buffer, so a full pool overwrites its oldest slots. Nothing is allocated per frame.
//
// Spawning: const i = pool.spawn(x, y, z, vx, vy, vz, life, size, shape, color);  then optionally tweak fields
// by index, e.g. pool.drag[i] = 3; pool.endScale[i] = 0.2;  (all fields are reset to defaults by spawn()).
// Sizes are world units: `size` is the HALF extent of the quad, so a particle with size 0.25 is 0.5 units across.

import * as THREE from 'three';
import { LAYER_NO_OUTLINE } from '../core/layers.js';

export const SHAPE = {
  CIRCLE: 0, // flat disc with darker rim
  PUFF: 1, // cel-shaded ball (shadow crescent bottom-right)
  STAR: 2, // chunky 5-point star
  HEART: 3,
  SPARKLE: 4, // sharp 4-point twinkle
  RECT: 5, // confetti / paper bit (use aspect)
  STREAK: 6, // tapered streak, head at the particle, tail behind (use with align)
  RING: 7, // thin annulus (param = thickness)
  ARC: 8, // sound-wave arc, opening along the velocity (use with align; param = thickness)
  FEATHER: 9, // leaf with a darker quill
  DROP: 10, // water drop (use with align)
  DIAMOND: 11,
  TRI: 12, // triangle scrap
  GLOW: 13, // round star with a white-hot core (best with additive pools)
};

const STRIDE = 16;
const TAU = Math.PI * 2;

const VERT = /* glsl */ `
attribute vec4 aA; // xyz position, w size (half extent, world units)
attribute vec4 aB; // xyz velocity (for alignment), w rotation
attribute vec4 aC; // rgb colour (linear), a alpha
attribute vec4 aD; // x shape, y aspect, z align (0 = off, else 1 + stretch), w param
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vD; // shape, param, full-ring factor (arcs seen end-on)
varying vec2 vK; // stretch factor, aspect
void main() {
  if (aA.w <= 0.0 || aC.a <= 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 mv = modelViewMatrix * vec4(aA.xyz, 1.0);
  float size = aA.w;
  float sx = size;
  float sy = size * aD.y;
  float ang = aB.w;
  float shift = 0.0;
  float full = 0.0;
  float k = 1.0;
  if (aD.z > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(aB.xyz, 0.0)).xyz;
    float l = length(vv.xy);
    float L = length(vv);
    full = 1.0 - smoothstep(0.15, 0.45, l / max(L, 1e-5));
    ang = l > 1e-5 ? atan(vv.y, vv.x) : 0.0;
    k = min(1.0 + (aD.z - 1.0) * l, 12.0);
    sx = size * k;
    shift = size - sx; // keep the head at the particle, stretch backwards
  }
  vec2 off = vec2(position.x * sx + shift, position.y * sy);
  float c = cos(ang), s = sin(ang);
  mv.xy += vec2(off.x * c - off.y * s, off.x * s + off.y * c);
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vColor = aC;
  vD = vec3(aD.x, aD.w, full);
  vK = vec2(k, aD.y);
}
`;

const FRAG = /* glsl */ `
uniform float uHot;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vD;
varying vec2 vK;

float dot2(vec2 v) { return dot(v, v); }
// Inigo Quilez's 2D distance functions (MIT)
float sdStar(vec2 p, float r, float n, float m) {
  float an = 3.141593 / n;
  float en = 3.141593 / m;
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdUnevenCapsule(vec2 p, float r1, float r2, float h) {
  p.x = abs(p.x);
  float b = (r1 - r2) / h;
  float a = sqrt(1.0 - b * b);
  float k = dot(p, vec2(-b, a));
  if (k < 0.0) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0.0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}
float sdArc(vec2 p, vec2 sc, float ra, float rb) {
  p.x = abs(p.x);
  return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}
float sdVesica(vec2 p, float r, float d) {
  p = abs(p);
  float b = sqrt(r * r - d * d);
  return ((p.y - b) * d > p.x * b) ? length(p - vec2(0.0, b)) : length(p - vec2(-d, 0.0)) - r;
}
float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdTri(vec2 p) {
  const float k = sqrt(3.0);
  p.y += 0.25;
  p.x = abs(p.x) - 0.85;
  p.y = p.y + 0.85 / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -1.7, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  vec2 p = vUv;
  int shape = int(vD.x + 0.5);
  float param = vD.y;
  vec3 col = vColor.rgb;
  float d = 1.0;
  float rim = 0.17;     // width of the darker rim (uv units)
  float rimDark = 0.72; // rim colour multiplier
  float shade = 1.0;
  float core = 0.0; // white-hot amount (additive pools)
  float tailA = 1.0;
  if (shape == 0) {
    d = length(p) - 0.92;
  } else if (shape == 1) {
    d = length(p) - 0.92;
    shade = length(p - vec2(-0.2, 0.24)) > 0.9 ? 0.82 : 1.0;
    rim = 0.12;
  } else if (shape == 2) {
    d = sdStar(p, 0.95, 5.0, 2.7);
    rim = 0.16;
  } else if (shape == 3) {
    d = sdHeart(p * 0.64 + vec2(0.0, 0.52)) / 0.64;
  } else if (shape == 4) {
    d = sdStar(p, 1.0, 4.0, 2.25);
    rim = 0.1;
  } else if (shape == 5) {
    d = sdBox(p, vec2(0.92), 0.12);
    rim = 0.0;
  } else if (shape == 6) {
    // comet streak in size units: round head at the front, tapered tail behind (stretch-aware, no distortion)
    float X = (p.x - 1.0) * vK.x + 1.0;
    float Y = p.y * vK.y;
    float rH = 0.92 * min(vK.y, 1.0);
    float rT = 0.12 * rH;
    float h = max(2.0 * vK.x - rH - rT, rH - rT + 0.02);
    float ax = (1.0 - rH) - X;
    d = sdUnevenCapsule(vec2(Y, ax), rH, rT, h);
    float tf = clamp(ax / h, 0.0, 1.0);
    tailA = 1.0 - 0.7 * tf;
    core = smoothstep(rH * 0.55, rH * 0.15, length(vec2(ax, Y)));
    rim = 0.0;
  } else if (shape == 7) {
    d = abs(length(p) - (0.95 - param)) - param;
    rim = 0.0;
  } else if (shape == 8) {
    float ap = mix(1.0, 3.14159, vD.z);
    d = sdArc(vec2(p.y, p.x), vec2(sin(ap), cos(ap)), 0.95 - param, param);
    rim = 0.0;
  } else if (shape == 9) {
    d = sdVesica(vec2(p.y, p.x) * vec2(1.0, 0.68), 1.0, 0.7) / 0.68;
    float spine = abs(p.y + 0.02 * p.x) < 0.045 && p.x < 0.75 ? 1.0 : 0.0;
    shade = mix(p.y > 0.0 ? 1.0 : 0.88, 0.62, spine);
    float quill = max(abs(p.y) - 0.045, p.x + 0.6) ; // stem sticking out behind
    quill = max(quill, -p.x - 1.0);
    if (quill < d) { d = quill; shade = 0.62; }
    rim = 0.0;
  } else if (shape == 10) {
    d = sdUnevenCapsule(vec2(p.y, 0.35 - p.x), 0.62, 0.22, 1.05);
    shade = length(p - vec2(0.55, 0.22)) < 0.17 ? 1.6 : 1.0; // highlight
    rim = 0.16;
  } else if (shape == 11) {
    vec2 q = abs(p);
    d = (q.x + q.y - 0.95) * 0.7071;
    shade = p.x * p.y > 0.0 ? 1.0 : 0.85;
    rim = 0.0;
  } else if (shape == 12) {
    d = sdTri(p);
    rim = 0.13;
  } else {
    d = length(p) - 0.9;
    core = smoothstep(0.5, 0.1, length(p));
    rim = 0.0;
  }
  float fw = max(fwidth(d), 1e-4);
  float a = clamp(0.5 - d / fw, 0.0, 1.0);
  if (a <= 0.0) discard;
  col *= shade;
  if (uHot < 0.5) a *= mix(1.0, tailA, 0.6);
  if (uHot > 0.5) {
    // additive: saturated body, white-hot core
    col = mix(col, vec3(1.0, 0.95, 0.85) * max(max(col.r, col.g), col.b), core * 0.65);
    a *= tailA;
  } else if (rim > 0.0) {
    col *= mix(1.0, rimDark, clamp(0.5 + (d + rim) / fw, 0.0, 1.0));
  }
  a *= vColor.a;
  // hot pools use premultiplied glow blending: out = src + dst * (1 - 0.8 a)
  gl_FragColor = uHot > 0.5 ? vec4(col * a, a * 0.8) : vec4(col, a);
  #include <colorspace_fragment>
}
`;

let quadGeo = null;
function baseQuad() {
  if (quadGeo) return quadGeo;
  quadGeo = {
    pos: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    idx: [0, 1, 2, 0, 2, 3],
  };
  return quadGeo;
}

const _trailCol = new THREE.Color();

function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class QuadPool {
  // opts: { max, additive, renderOrder }
  constructor(scene, opts = {}) {
    const max = (this.max = opts.max ?? 2000);
    this.scene = scene;
    const F = (n = 1) => new Float32Array(max * n);
    this.pos = F(3);
    this.vel = F(3);
    this.age = F();
    this.life = F();
    this.size = F();
    this.endScale = F(); // size multiplier at the end of life (shrink curve t^2)
    this.grow = F(); // fraction of life spent popping in (0 = appear at full size)
    this.rot = F();
    this.spin = F();
    this.grav = F(); // units/s^2 downwards (negative floats up)
    this.drag = F(); // 1/s exponential velocity decay
    this.shape = F();
    this.col0 = F(3);
    this.col1 = F(3);
    this.colT = F(); // life fraction where colour starts blending col0 -> col1 (1 = never)
    this.alpha = F();
    this.fade = F(); // life fraction where alpha starts fading to 0 (1 = no fade)
    this.fadeIn = F(); // life fraction of alpha fade-in
    this.aspect = F();
    this.align = F(); // 0 = billboard with rotation, else 1 + stretch (seconds of velocity per size)
    this.param = F();
    this.flutter = F(); // paper flip frequency (rad/s), 0 = none
    this.wobAmp = F();
    this.wobFreq = F();
    this.sway = F(); // horizontal sway speed (units/s)
    this.twinkle = F(); // size twinkle frequency (rad/s)
    this.crackle = F(); // fraction of life at the end that flickers
    this.seed = F();
    this.trail = F(); // child trail particles per second (uses trailLife / trailSize / trailShape)
    this.trailAcc = F();
    this.alive = new Uint8Array(max);

    this.trailLife = 0.9;
    this.trailSize = 0.45;
    this.trailShape = SHAPE.GLOW;
    this.trailGrav = 2.5;

    this.cursor = 0;
    this.live = 0;
    this.hw = 0; // high-water mark: slots [0, hw) may be alive
    this.seedCounter = 0;

    this.data = new Float32Array(max * STRIDE);
    const ib = (this.ib = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1));
    ib.setUsage(THREE.DynamicDrawUsage);
    const q = baseQuad();
    const geo = (this.geometry = new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(q.pos, 3));
    geo.setIndex(q.idx);
    geo.setAttribute('aA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    geo.setAttribute('aB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    geo.setAttribute('aC', new THREE.InterleavedBufferAttribute(ib, 4, 8));
    geo.setAttribute('aD', new THREE.InterleavedBufferAttribute(ib, 4, 12));
    geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: { uHot: { value: opts.additive ? 1 : 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: opts.additive ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (opts.additive) {
      // "glow" blending: additive build-up where sparks overlap, but the sky behind is partly covered so colours
      // stay saturated over a bright dusk sky (pure additive washes gold to white there)
      const m = this.material;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.OneFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
      m.blendSrcAlpha = THREE.OneFactor;
      m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    }
    const mesh = (this.mesh = new THREE.Mesh(geo, this.material));
    mesh.frustumCulled = false;
    mesh.layers.set(LAYER_NO_OUTLINE);
    mesh.renderOrder = opts.renderOrder ?? 10;
    mesh.visible = false;
    mesh.name = opts.name ?? 'particles';
    scene.add(mesh);
  }

  // color: THREE.Color (linear components are copied)
  spawn(x, y, z, vx, vy, vz, life, size, shape, color) {
    const i = this.cursor;
    this.cursor = i + 1 >= this.max ? 0 : i + 1;
    if (!this.alive[i]) this.live++;
    this.alive[i] = 1;
    if (i + 1 > this.hw) this.hw = i + 1;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col0[i3] = this.col1[i3] = color.r;
    this.col0[i3 + 1] = this.col1[i3 + 1] = color.g;
    this.col0[i3 + 2] = this.col1[i3 + 2] = color.b;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.shape[i] = shape;
    this.endScale[i] = 0;
    this.grow[i] = 0.12;
    this.rot[i] = 0;
    this.spin[i] = 0;
    this.grav[i] = 0;
    this.drag[i] = 0;
    this.colT[i] = 1;
    this.alpha[i] = 1;
    this.fade[i] = 1;
    this.fadeIn[i] = 0;
    this.aspect[i] = 1;
    this.align[i] = 0;
    this.param[i] = 0.12;
    this.flutter[i] = 0;
    this.wobAmp[i] = 0;
    this.wobFreq[i] = 0;
    this.sway[i] = 0;
    this.twinkle[i] = 0;
    this.crackle[i] = 0;
    this.trail[i] = 0;
    this.trailAcc[i] = 0;
    this.seed[i] = (this.seedCounter = (this.seedCounter + 1) % 9973) * 0.61803 + Math.random();
    return i;
  }

  setEndColor(i, c, fromT = 0) {
    const i3 = i * 3;
    this.col1[i3] = c.r; this.col1[i3 + 1] = c.g; this.col1[i3 + 2] = c.b;
    this.colT[i] = fromT;
  }

  clear() {
    this.alive.fill(0);
    this.live = 0;
    this.hw = 0;
    this.cursor = 0;
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  update(dt) {
    const { pos, vel, data } = this;
    let hw = this.hw;
    for (let i = 0; i < hw; i++) {
      if (!this.alive[i]) continue;
      const o = i * STRIDE;
      const a = this.age[i] + dt;
      this.age[i] = a;
      if (a < 0) { data[o + 3] = 0; continue; } // delayed spawn
      const life = this.life[i];
      if (a >= life) {
        this.alive[i] = 0;
        this.live--;
        data[o + 3] = 0;
        continue;
      }
      const t = a / life;
      const i3 = i * 3;
      // physics
      const dr = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
      let vx = vel[i3] * dr, vy = vel[i3 + 1] * dr - this.grav[i] * dt, vz = vel[i3 + 2] * dr;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      const seed = this.seed[i];
      let px = pos[i3] + vx * dt, py = pos[i3 + 1] + vy * dt, pz = pos[i3 + 2] + vz * dt;
      if (this.sway[i] !== 0) {
        const sw = this.sway[i] * Math.sin(a * 3.1 + seed * TAU) * dt;
        px += sw * Math.cos(seed * 17.0);
        pz += sw * Math.sin(seed * 17.0);
      }
      pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;

      // size over life: pop in (overshoot), then shrink towards endScale with t^2
      let s = this.size[i];
      const g = this.grow[i];
      if (g > 0 && t < g) {
        const u = t / g;
        s *= u * (1.0 + 0.6 * (1 - u)) + 0.15 * (1 - u);
      }
      s *= 1 + (this.endScale[i] - 1) * t * t;
      if (this.twinkle[i] > 0) s *= 0.72 + 0.28 * Math.sin(a * this.twinkle[i] + seed * TAU);

      // colour
      let r = this.col0[i3], gg = this.col0[i3 + 1], b = this.col0[i3 + 2];
      const ct = this.colT[i];
      if (ct < 1 && t > ct) {
        const k = Math.min(1, (t - ct) / Math.max(1e-3, 1 - ct) * 1.6);
        r += (this.col1[i3] - r) * k;
        gg += (this.col1[i3 + 1] - gg) * k;
        b += (this.col1[i3 + 2] - b) * k;
      }

      // alpha
      let al = this.alpha[i];
      const fi = this.fadeIn[i];
      if (fi > 0 && t < fi) al *= t / fi;
      const f = this.fade[i];
      if (t > f) al *= 1 - (t - f) / (1 - f);
      const cr = this.crackle[i];
      if (cr > 0 && t > 1 - cr) {
        const h = hash(seed, Math.floor(a * 22));
        if (h < 0.4) al *= 0.08;
        else if (h > 0.85) { s *= 1.5; r = r * 0.5 + 0.5; gg = gg * 0.5 + 0.47; b = b * 0.5 + 0.4; }
      }

      // rotation / flutter
      let rot = this.rot[i] + this.spin[i] * dt;
      this.rot[i] = rot;
      if (this.wobAmp[i] !== 0) rot += this.wobAmp[i] * Math.sin(a * this.wobFreq[i] + seed * TAU);
      let asp = this.aspect[i];
      const fl = this.flutter[i];
      if (fl > 0) {
        const c = Math.cos(a * fl + seed * TAU);
        const ac = Math.max(Math.abs(c), 0.12);
        asp /= ac;
        s *= ac;
        if (c < 0) { r *= 0.72; gg *= 0.72; b *= 0.72; }
      }

      // trails (fireworks willow)
      const tr = this.trail[i];
      if (tr > 0 && t < 0.85) {
        let acc = this.trailAcc[i] + tr * dt;
        while (acc >= 1) {
          acc -= 1;
          const j = this.spawn(px, py, pz, vx * 0.05, vy * 0.05 - 0.4, vz * 0.05, this.trailLife * (0.7 + 0.5 * Math.random()),
            this.size[i] * this.trailSize, this.trailShape, _trailCol.setRGB(r * 0.75, gg * 0.5, b * 0.3));
          this.grav[j] = this.trailGrav;
          this.drag[j] = 1.5;
          this.grow[j] = 0;
          this.endScale[j] = 0.3;
          this.crackle[j] = 0.6;
          this.alpha[j] = 0.6;
          if (this.hw > hw) hw = this.hw;
        }
        this.trailAcc[i] = acc;
      }

      data[o] = px; data[o + 1] = py; data[o + 2] = pz; data[o + 3] = s;
      data[o + 4] = vx; data[o + 5] = vy; data[o + 6] = vz; data[o + 7] = rot;
      data[o + 8] = r; data[o + 9] = gg; data[o + 10] = b; data[o + 11] = al;
      data[o + 12] = this.shape[i]; data[o + 13] = asp; data[o + 14] = this.align[i]; data[o + 15] = this.param[i];
    }
    if (this.live <= 0) {
      this.live = 0;
      this.hw = 0;
      this.cursor = 0;
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return;
    }
    this.hw = hw;
    this.geometry.instanceCount = hw;
    this.mesh.visible = true;
    const ib = this.ib;
    ib.clearUpdateRanges();
    ib.addUpdateRange(0, hw * STRIDE);
    ib.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
