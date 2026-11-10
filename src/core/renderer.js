// WebGL renderer and post-processing: scene colour + depth, a normals pass, ink outlines, bloom, and the final
// output with an optional "retro" low-resolution mode.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LAYER_DEFAULT, LAYER_NO_OUTLINE } from './layers.js';

const OUTLINE_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 uTexel;
uniform float uThickness;
uniform float uNear;
uniform float uFar;
uniform vec3 uInk;
uniform float uStrength;
uniform vec2 uFade;
varying vec2 vUv;

float rawDepth(vec2 uv) { return texture2D(tDepth, uv).x; }
float viewZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

void main() {
  vec4 col = texture2D(tColor, vUv);
  vec2 o = uTexel * uThickness;
  float d0 = rawDepth(vUv);
  float dl = rawDepth(vUv - vec2(o.x, 0.0)), dr = rawDepth(vUv + vec2(o.x, 0.0));
  float du = rawDepth(vUv + vec2(0.0, o.y)), dd = rawDepth(vUv - vec2(0.0, o.y));
  float dmin = min(d0, min(min(dl, dr), min(du, dd)));
  // Depth-buffer values are linear in screen space on a plane, so the second difference is zero on any flat
  // surface however steep, and jumps at silhouettes. Dividing by (1 - d) makes it a relative depth jump.
  float lap = abs(dl + dr - 2.0 * d0) + abs(du + dd - 2.0 * d0);
  float depthEdge = smoothstep(0.035, 0.11, lap / (1.0 - dmin + 1e-7));

  vec3 n0 = nrm(vUv);
  float nd = 0.0;
  nd += 1.0 - dot(n0, nrm(vUv - vec2(o.x, 0.0)));
  nd += 1.0 - dot(n0, nrm(vUv + vec2(o.x, 0.0)));
  nd += 1.0 - dot(n0, nrm(vUv + vec2(0.0, o.y)));
  nd += 1.0 - dot(n0, nrm(vUv - vec2(0.0, o.y)));
  float normalEdge = smoothstep(0.45, 1.1, nd);

  float z = viewZ(dmin);
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, z);
  float edge = max(depthEdge, normalEdge * 0.85) * fade * uStrength;
  gl_FragColor = vec4(mix(col.rgb, uInk, edge), 1.0);
}`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform float uRetro;
uniform vec2 uSize;
uniform float uVignette;
varying vec2 vUv;

float bayer(vec2 p) {
  vec2 a = floor(mod(p, 4.0));
  float m = mod(a.x * 2.0 + a.y * 3.0, 4.0) + mod(a.x + a.y * 2.0, 2.0) * 4.0 + mod(a.y, 2.0) * 8.0;
  return m / 16.0 - 0.5;
}

void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  c = min(c, vec3(4.0));
  // soft shoulder so bright glows roll off instead of clipping
  c = mix(c, 1.0 - exp(-c), smoothstep(0.85, 1.6, max(c.r, max(c.g, c.b))));
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 1.1;
  c = mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  if (uRetro > 0.5) {
    float levels = 20.0;
    c = floor(c * levels + 0.5 + bayer(vUv * uSize) * 0.65) / levels;
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;   // the final pass does the sRGB encode itself
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.autoClear = true;
    this.gl.info.autoReset = false;
    this.retro = false;
    this.quality = 1;            // 0.6 .. 1 resolution scale (auto-adjusted)
    this.bloomEnabled = true;

    this.normalMaterial = new THREE.MeshNormalMaterial();
    this.outline = new FullScreenQuad(new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: OUTLINE_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null },
        uTexel: { value: new THREE.Vector2() }, uThickness: { value: 1 }, uNear: { value: 0.3 }, uFar: { value: 4000 },
        uInk: { value: new THREE.Color('#231a2e') }, uStrength: { value: 0.9 }, uFade: { value: new THREE.Vector2(70, 260) },
      },
    }));
    this.final = new FullScreenQuad(new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tColor: { value: null }, uRetro: { value: 0 }, uSize: { value: new THREE.Vector2() }, uVignette: { value: 0.35 } },
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.0);
    this.targets = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setRetro(on) {
    if (this.retro === on) return;
    this.retro = on;
    this.resize();
  }

  resize() {
    const cssW = Math.max(1, innerWidth), cssH = Math.max(1, innerHeight);
    let w, h;
    if (this.retro) {
      h = Math.min(288, cssH);
      w = Math.max(1, Math.round(h * cssW / cssH));
      this.canvas.style.imageRendering = 'pixelated';
    } else {
      const dpr = Math.min(devicePixelRatio || 1, 2) * this.quality;
      w = Math.round(cssW * dpr);
      h = Math.round(cssH * dpr);
      this.canvas.style.imageRendering = 'auto';
    }
    this.width = w; this.height = h;
    this.gl.setPixelRatio(1);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    if (this.targets) for (const t of Object.values(this.targets)) t.dispose();
    const samples = this.retro || this.quality < 0.8 ? 0 : 4;      // no MSAA on machines that are struggling
    const color = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    color.depthTexture = new THREE.DepthTexture(w, h);
    color.depthTexture.type = THREE.UnsignedIntType;
    const normal = new THREE.WebGLRenderTarget(w, h, { samples, depthBuffer: true });
    normal.texture.minFilter = normal.texture.magFilter = THREE.NearestFilter;
    const comp = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.targets = { color, normal, comp };
    this.bloom.setSize(Math.round(w / 2), Math.round(h / 2));
    const u = this.outline.material.uniforms;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uThickness.value = this.retro ? 1 : Math.max(1, h / 800);
    u.uStrength.value = this.retro ? 0.62 : 0.9;
    this.final.material.uniforms.uSize.value.set(w, h);
    this.final.material.uniforms.uRetro.value = this.retro ? 1 : 0;
  }

  render(scene, camera) {
    const gl = this.gl;
    const { color, normal, comp } = this.targets;
    gl.info.reset();

    // 1. the scene, everything
    camera.layers.enable(LAYER_DEFAULT);
    camera.layers.enable(LAYER_NO_OUTLINE);
    gl.setRenderTarget(color);
    gl.render(scene, camera);

    // 2. normals of the outlined layer only
    camera.layers.disable(LAYER_NO_OUTLINE);
    const bg = scene.background, fog = scene.fog, shadows = gl.shadowMap.autoUpdate;
    scene.background = null; scene.fog = null; gl.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.normalMaterial;
    gl.setRenderTarget(normal);
    gl.setClearColor(0x8080ff, 1);
    gl.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = bg; scene.fog = fog; gl.shadowMap.autoUpdate = shadows;
    gl.setClearColor(0x000000, 1);
    camera.layers.enable(LAYER_NO_OUTLINE);

    // 3. ink
    const u = this.outline.material.uniforms;
    u.tColor.value = color.texture; u.tDepth.value = color.depthTexture; u.tNormal.value = normal.texture;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    gl.setRenderTarget(comp);
    this.outline.render(gl);

    // 4. bloom, added onto the composite
    if (this.bloomEnabled) this.bloom.render(gl, null, comp, 0, false);

    // 5. to the screen
    this.final.material.uniforms.tColor.value = comp.texture;
    gl.setRenderTarget(null);
    this.final.render(gl);
  }
}
