// Loads the GLB files and turns their flat-colour materials into toon materials.
//   glow_*   unlit, brightened at dusk (assets.setGlow) so they bloom
//   glass_*  transparent
//   tint_*   recoloured per instance (kit(name, { tint }))
// COL_*, CLIMB_* and CLIMBPOLE_* helper meshes are hidden and tagged in userData.helper.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYER_NO_OUTLINE } from './layers.js';

/**
 * A copy of a geometry with position, normal and a constant vertex colour (optionally transformed).
 * Baking the flat material colours into vertex colours lets everything share one toon material,
 * which is what keeps the draw-call count low.
 */
export function colouredGeometry(geometry, color, matrix = null) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone());
  else g.computeVertexNormals();
  const have = src.getAttribute('color');
  if (have) g.setAttribute('color', have.clone());
  else {
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  if (matrix) g.applyMatrix4(matrix);
  return g;
}

const FILES = ['indy', 'tower', 'environment', 'kit_rides', 'kit_festival', 'creatures', 'items'];

function gradientMap() {
  // three flat tones: shade, mid, lit
  const data = new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const GLOW_DAY = { glow_window: new THREE.Color('#33466b') };

class Assets {
  constructor() {
    this.gltf = {};
    this.pieces = new Map();        // kit piece name -> root Object3D (template)
    this.materials = new Map();     // name -> toon material
    this.glowMats = [];             // { mat, base, day }
    this.gradient = gradientMap();
    // the two shared vertex-colour materials nearly everything ends up using
    this.vcToon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient, name: 'vc_toon' });
    this.vcGlow = new THREE.MeshBasicMaterial({ vertexColors: true, name: 'glow_vc' });
    this.glowMats.push({ mat: this.vcGlow, base: new THREE.Color(1, 1, 1), day: null });
    // vcToon plus a hard cool rim along the silhouette, for dark creatures that must stand out from dark backgrounds
    this.rim = { rimColor: { value: new THREE.Color('#b4cdff') }, rimStrength: { value: 0 } };
    this.vcToonRim = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient, name: 'vc_toon_rim' });
    this.vcToonRim.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.rim);
      shader.fragmentShader = 'uniform vec3 rimColor;\nuniform float rimStrength;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
        float rimEdge = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
        outgoingLight += rimColor * rimStrength * smoothstep(0.5, 0.6, rimEdge);
        #include <opaque_fragment>`);
    };
    this.vcToonRim.customProgramCacheKey = () => 'vc_toon_rim';
    this.glow = 0;
    this.missing = new Set();
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    let done = 0;
    await Promise.all(FILES.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`./assets/${name}.glb`);
        this.gltf[name] = gltf;
        this._prepare(gltf.scene);
        if (name !== 'indy' && name !== 'tower' && name !== 'environment') {
          const roots = gltf.scene.children.length === 1 && gltf.scene.children[0].children.length > 3 && !gltf.scene.children[0].isMesh
            && /kit|scene|root/i.test(gltf.scene.children[0].name) ? gltf.scene.children[0].children : gltf.scene.children;
          for (const root of roots) this.pieces.set(root.name, root);
        }
      } catch (err) {
        console.warn(`[assets] ${name}.glb not available yet`, err.message || err);
      }
      done++;
      onProgress?.(done / FILES.length);
    }));
  }

  toon(src) {
    const name = src.name || 'unnamed';
    let m = this.materials.get(name);
    if (m) return m;
    const color = src.color ? src.color.clone() : new THREE.Color(1, 1, 1);
    if (name.startsWith('glow_')) {
      m = new THREE.MeshBasicMaterial({ color, name });
      this.glowMats.push({ mat: m, base: color.clone(), day: GLOW_DAY[name] || null });
    } else if (name.startsWith('glass_')) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: this.gradient, transparent: true, opacity: 0.5, depthWrite: false, name });
    } else {
      m = new THREE.MeshToonMaterial({ color, gradientMap: this.gradient, name });
    }
    this.materials.set(name, m);
    this._applyGlow();
    return m;
  }

  _prepare(scene) {
    scene.traverse((o) => {
      if (/^COL_/.test(o.name)) o.userData.helper = 'col';
      else if (/^CLIMBPOLE_/.test(o.name)) o.userData.helper = 'pole';
      else if (/^CLIMB_/.test(o.name)) o.userData.helper = 'climb';
      if (!o.isMesh) return;
      const helper = o.userData.helper || (o.parent && o.parent.userData.helper);
      if (helper) { o.userData.helper = helper; o.visible = false; return; }
      o.material = Array.isArray(o.material) ? o.material.map((m) => this.toon(m)) : this.toon(o.material);
      const n = o.material.name || '';
      o.castShadow = !n.startsWith('glass_') && !n.startsWith('glow_');
      o.receiveShadow = !n.startsWith('glow_');
      if (n.startsWith('glass_')) o.layers.set(LAYER_NO_OUTLINE);
    });
    this._collapse(scene);
  }

  /** Which shared material a mesh can be folded into: 'toon', 'glow' or null (keeps its own material). */
  kindOf(material) {
    if (material === this.vcToon) return 'toon';
    if (material === this.vcGlow) return 'glow';
    const n = material.name || '';
    if (n.startsWith('tint_') || n.startsWith('glass_') || n === 'glow_window' || material.transparent) return null;
    if (n.startsWith('glow_')) return 'glow';
    return material.isMeshToonMaterial ? 'toon' : null;
  }

  /**
   * GLTFLoader splits a Blender object with several materials into a Group of one mesh per material.
   * Fold each such group (and each plain single-material mesh) into one vertex-coloured mesh per kind.
   */
  _collapse(scene) {
    const groups = new Map();
    const singles = [];
    scene.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.userData.helper || o.children.length) return;
      if (/^beacon_/.test(o.name) || (o.parent && /^beacon_/.test(o.parent.name))) return;
      const kind = this.kindOf(o.material);
      if (!kind) return;
      const p = o.parent;
      const primitive = p && !p.isMesh && p.children.length > 1 && p.children.every((c) => c.isMesh && !c.children.length)
        && !o.userData.part && o.position.lengthSq() === 0;
      if (primitive) { if (!groups.has(p)) groups.set(p, []); groups.get(p).push([o, kind]); }
      else singles.push([o, kind]);
    });
    const make = (list, kind, name) => {
      const geoms = list.map((o) => colouredGeometry(o.geometry, o.material.color));
      const mesh = new THREE.Mesh(geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false), kind === 'toon' ? this.vcToon : this.vcGlow);
      mesh.name = name;
      mesh.castShadow = kind === 'toon'; mesh.receiveShadow = kind === 'toon';
      if (kind === 'glow') mesh.layers.set(LAYER_NO_OUTLINE);
      return mesh;
    };
    for (const [parent, list] of groups) {
      for (const kind of ['toon', 'glow']) {
        const meshes = list.filter(([, k]) => k === kind).map(([o]) => o);
        if (!meshes.length) continue;
        parent.add(make(meshes, kind, `${parent.name}_${kind}`));
        for (const m of meshes) m.removeFromParent();
      }
    }
    for (const [o, kind] of singles) {
      o.geometry = colouredGeometry(o.geometry, o.material.color);
      o.material = kind === 'toon' ? this.vcToon : this.vcGlow;
      o.castShadow = kind === 'toon'; o.receiveShadow = kind === 'toon';
      if (kind === 'glow') o.layers.set(LAYER_NO_OUTLINE);
    }
  }

  /** How strongly festival lights glow: 0 in daylight, 1 at dusk. */
  setGlow(g) {
    if (Math.abs(g - this.glow) < 0.004) return;
    this.glow = g;
    this._applyGlow();
  }

  _applyGlow() {
    const g = this.glow;
    this.rim.rimStrength.value = 0.4 + 0.5 * g;
    for (const { mat, base, day } of this.glowMats) {
      if (day) mat.color.copy(day).lerp(base, g).multiplyScalar(1 + g * 1.5);
      else mat.color.copy(base).multiplyScalar(0.92 + g * 1.7);
    }
  }

  has(name) { return this.pieces.has(name); }

  /** A fresh copy of a kit piece at the origin. opts.tint recolours its tint_* materials. */
  kit(name, opts = {}) {
    const src = this.pieces.get(name);
    if (!src) {
      if (!this.missing.has(name)) { this.missing.add(name); console.warn(`[assets] missing kit piece "${name}"`); }
      const ph = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshToonMaterial({ color: 0xff00ff, gradientMap: this.gradient }));
      ph.name = name; ph.userData.placeholder = true;
      const g = new THREE.Group(); g.add(ph); g.name = name;
      return g;
    }
    const obj = src.clone(true);
    obj.position.set(0, 0, 0); obj.quaternion.identity(); obj.scale.set(1, 1, 1);
    if (opts.tint != null) {
      const tint = new THREE.Color(opts.tint);
      const key = '#' + tint.getHexString();
      obj.traverse((o) => {
        if (o.isMesh && o.material.name && o.material.name.startsWith('tint_')) {
          const k = o.material.name + key;
          let m = this.materials.get(k);
          if (!m) { m = o.material.clone(); m.color.copy(tint); this.materials.set(k, m); }
          o.material = m;
        }
      });
    }
    return obj;
  }

  /** Find a child by the `part` custom property (or by name). */
  part(obj, part) {
    let found = null;
    obj.traverse((o) => { if (!found && (o.userData.part === part || o.name === part)) found = o; });
    return found;
  }

  /** A skinned clone of Indy with its animation clips. */
  indy() {
    const gltf = this.gltf.indy;
    const scene = SkeletonUtils.clone(gltf.scene);
    return { scene, clips: gltf.animations };
  }
}

export const assets = new Assets();
