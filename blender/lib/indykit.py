"""Shared helpers for every Blender asset script in this project.

Run asset scripts headless:
    blender --background --python blender/<script>.py

Conventions (see CLAUDE.md "Asset contract"):
  * 1 Blender unit = 1 game unit. Z up in Blender, exported Y up.
  * Things that have a front face Blender -Y (becomes +Z in three.js).
  * Flat colours only: one Principled material per colour, taken from PALETTE by name.
    No textures. The game converts every material to a toon material by name:
      glow_*   -> unlit emissive (blooms at dusk)
      glass_*  -> transparent
  * Objects named COL_*  are collision-only meshes (hidden in game).
    Objects named CLIMB_* are climbable flat quads, CLIMBPOLE_* climbable poles (hidden in game).
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ASSET_DIR = os.path.join(ROOT, 'public', 'assets')
PREVIEW_DIR = os.path.join(ROOT, 'blender', 'previews')

PALETTE = {
    # concrete / tower
    'concrete_light': '#d6c8b4', 'concrete': '#bfae98', 'concrete_dark': '#9a8a78', 'concrete_shadow': '#75685c',
    'pod_dark': '#3b3a46', 'pod_brown': '#5c4b44', 'pod_roof': '#4a444c',
    'window_dark': '#27324c', 'window_blue': '#3f5f8f', 'glow_window': '#ffd98a',
    # metal / neutral
    'steel': '#9aa3ad', 'steel_dark': '#5e6772', 'white_paint': '#f4f1ea', 'black_rubber': '#2b2a30',
    'grey_light': '#c9cdd3', 'grey': '#8d939c', 'grey_dark': '#555b66',
    # festival colours
    'red': '#e8443a', 'red_dark': '#b02e2e', 'orange': '#f58a2c', 'yellow': '#ffc93c', 'yellow_light': '#ffe58a',
    'green': '#4fb65a', 'green_dark': '#2f7d4a', 'teal': '#2bb3a6', 'blue': '#3d7fe0', 'blue_dark': '#2a4f9a',
    'sky_blue': '#7cc4f2', 'purple': '#8a5bd6', 'pink': '#f27aa8', 'magenta': '#d6408f', 'cream': '#f6ecd2',
    # wood / cardboard / fabric
    'wood': '#b9824f', 'wood_dark': '#86573a', 'wood_light': '#dcb07a',
    'cardboard': '#c79a62', 'cardboard_dark': '#a37a48', 'canvas': '#f2e6cf', 'rope': '#c9a56a',
    # nature
    'grass': '#6dbf4b', 'grass_dark': '#4a9a3f', 'leaf': '#58a84a', 'leaf_dark': '#3a7d3e', 'leaf_light': '#8fd05a',
    'pine': '#2f6b4a', 'pine_dark': '#23523c', 'birch_bark': '#efe9dc', 'trunk': '#7a5a3e',
    'rock': '#8c8f96', 'rock_dark': '#6a6d75', 'sand': '#e3d3a6', 'dirt': '#a9825a',
    'water': '#3f8fd0', 'water_deep': '#2c6fb0', 'water_light': '#7fc0ea',
    # city
    'brick': '#b5533c', 'brick_dark': '#8d3f30', 'roof_red': '#a8483a', 'roof_grey': '#5c6470',
    'plaster_cream': '#efe0bf', 'plaster_pink': '#e9b7a8', 'plaster_green': '#b9d4b0', 'plaster_blue': '#b4cbe0',
    'asphalt': '#5a5d66', 'paving': '#c9c2b6', 'paving_dark': '#a9a296',
    # Indy
    'fur_white': '#f7f2e8', 'fur_cream': '#e9e0d0', 'fur_dark': '#3a2f2b', 'fur_tabby': '#7b5c46', 'fur_tail': '#2d2523',
    'nose_pink': '#f29aa5', 'ear_pink': '#f3b3b3', 'pad_pink': '#f0a0aa', 'mouth': '#a8324a',
    'eye_green': '#a9c95a', 'eye_dark': '#1f1b1a', 'eye_white': '#ffffff',
    # birds / people
    'gull_white': '#f5f5f2', 'gull_grey': '#9aa7b5', 'beak_yellow': '#f5b72e', 'beak_orange': '#f08a2a',
    'jackdaw_black': '#2c2d36', 'jackdaw_grey': '#70737f', 'eye_pale': '#dfe8f0',
    'skin_a': '#f1c6a0', 'skin_b': '#c98d62', 'skin_c': '#8a5a3c', 'hair_dark': '#3a2a22', 'hair_blond': '#e6c36a',
    # precious
    'gold': '#f5c542', 'gold_dark': '#c9922a', 'fish_orange': '#f79a3a', 'fish_light': '#ffd08a',
    # emissive (unlit in game, bloom at dusk)
    'glow_yellow': '#ffd75a', 'glow_warm': '#ffb347', 'glow_red': '#ff5040', 'glow_green': '#5fe07a',
    'glow_blue': '#5aa8ff', 'glow_pink': '#ff7ac0', 'glow_white': '#fff6d8', 'glow_purple': '#b98aff',
    # transparent
    'glass_clear': '#bfe3f5', 'glass_dark': '#3a4a6a',
}


# ----------------------------------------------------------------------------- scene / materials

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hexstr, alpha=1.0):
    h = hexstr.lstrip('#')
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (alpha,)


def mat(name, hexcolor=None):
    """Get or create the flat-colour material `name`. Colour comes from PALETTE unless hexcolor is given
    (use that for one-off colours; keep the name descriptive, and keep the glow_/glass_ prefixes meaningful)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    if hexcolor is None:
        if name not in PALETTE:
            raise KeyError(f'material "{name}" is not in PALETTE; pass a hex colour')
        hexcolor = PALETTE[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    rgba = hex_rgba(hexcolor)
    m.diffuse_color = rgba
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    if name.startswith('glow_'):
        bsdf.inputs['Emission Color'].default_value = rgba
        bsdf.inputs['Emission Strength'].default_value = 1.5
    if name.startswith('glass_'):
        bsdf.inputs['Alpha'].default_value = 0.45
        m.diffuse_color = rgba[:3] + (0.45,)
    return m


# ----------------------------------------------------------------------------- object helpers

def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def obj_from_bmesh(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if material is not None:
        set_material(ob, material)
    return ob


def set_material(ob, material):
    m = mat(material) if isinstance(material, str) else material
    ob.data.materials.clear()
    ob.data.materials.append(m)
    return ob


def empty(name, loc=(0, 0, 0), parent=None):
    """An empty (exports as a named node): use for groups, pivots and attachment points."""
    ob = bpy.data.objects.new(name, None)
    ob.location = loc
    link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def parent_to(child, parent, keep_world=True):
    if keep_world:
        bpy.context.view_layer.update()
        wm = child.matrix_world.copy()
        child.parent = parent
        child.matrix_parent_inverse = Matrix.Identity(4)
        bpy.context.view_layer.update()
        child.matrix_world = wm
    else:
        child.parent = parent
    return child


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def apply_transforms(ob, location=False, rotation=True, scale=True):
    select_only([ob])
    bpy.ops.object.transform_apply(location=location, rotation=rotation, scale=scale)
    return ob


def join(objs, name=None):
    """Join mesh objects into the first one (keeps per-face materials)."""
    objs = [o for o in objs if o is not None]
    select_only(objs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    if name:
        ob.name = name
        ob.data.name = name
    return ob


def shade(ob, angle=35.0, smooth=True):
    """Smooth-shade with hard edges wherever faces meet at more than `angle` degrees.
    angle=0 gives fully flat shading, angle=180 fully smooth."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lim = math.radians(angle)
    for f in bm.faces:
        f.smooth = smooth
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) <= lim
        else:
            e.smooth = True
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


def bevel(ob, width=0.03, segments=2, angle=30.0, apply=True):
    select_only([ob])
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    if apply:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def subsurf(ob, levels=1, apply=True):
    select_only([ob])
    mod = ob.modifiers.new('subsurf', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    if apply:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


# ----------------------------------------------------------------------------- primitives

def box(name, size=(1, 1, 1), loc=(0, 0, 0), material=None, rot=(0, 0, 0), bevel_w=0.0, bevel_segs=1):
    """Axis-aligned box of full size (x, y, z) centred at loc."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel_w > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel_w, segments=bevel_segs, affect='EDGES', profile=0.5)
    ob = obj_from_bmesh(name, bm, material)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def cylinder(name, r=0.5, h=1.0, loc=(0, 0, 0), material=None, segs=16, r_top=None, rot=(0, 0, 0), caps=True):
    """Cylinder/cone along Z, centred at loc. r is the bottom radius, r_top the top radius (defaults to r)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs,
                          radius1=r, radius2=(r if r_top is None else r_top), depth=h)
    ob = obj_from_bmesh(name, bm, material)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def sphere(name, r=0.5, loc=(0, 0, 0), material=None, subdiv=2, scale=(1, 1, 1)):
    """Icosphere, optionally squashed into an ellipsoid with scale (applied to the mesh)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    ob = obj_from_bmesh(name, bm, material)
    ob.location = loc
    return ob


def uv_sphere(name, r=0.5, loc=(0, 0, 0), material=None, segs=16, rings=10, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    ob = obj_from_bmesh(name, bm, material)
    ob.location = loc
    return ob


def lathe(name, profile, segs=32, material=None, loc=(0, 0, 0), cap_top=True, cap_bottom=True):
    """Solid of revolution around Z. profile = [(radius, z), ...] from bottom to top."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_bottom and profile[0][0] > 1e-6:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and profile[-1][0] > 1e-6:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bmesh(name, bm, material)
    ob.location = loc
    return ob


def tube(name, points, r=0.05, segs=8, material=None, closed=False):
    """A round tube through a list of 3D points (a bevelled poly curve converted to mesh)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = max(0, segs // 4 - 1)
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, co in zip(sp.points, points):
        p.co = (co[0], co[1], co[2], 1.0)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    link(ob)
    select_only([ob])
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    if material is not None:
        set_material(ob, material)
    return ob


def quad(name, corners, material=None):
    """A single quad from four corner points (counter-clockwise seen from its front)."""
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(c) for c in corners])
    return obj_from_bmesh(name, bm, material)


# ----------------------------------------------------------------------------- export / preview

def _with_children(objs):
    out = []
    for o in objs:
        out.append(o)
        out.extend(o.children_recursive)
    return out


def export_glb(filename, roots=None, animations=False):
    """Export to public/assets/<filename>. roots=None exports every object in the scene;
    otherwise the given root objects and all their children."""
    os.makedirs(ASSET_DIR, exist_ok=True)
    path = filename if os.path.isabs(filename) else os.path.join(ASSET_DIR, filename)
    objs = _with_children(roots) if roots else list(bpy.context.scene.objects)
    objs = [o for o in objs if o.type in {'MESH', 'EMPTY', 'ARMATURE'}]
    select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_extras=True,
        export_cameras=False, export_lights=False,
        export_animations=animations, export_skins=True, export_morph=animations,
        export_materials='EXPORT', export_texcoords=False, export_normals=True,
    )
    tris = sum(len(o.data.loop_triangles) if (o.data.calc_loop_triangles() or True) else 0
               for o in objs if o.type == 'MESH')
    print(f'[indykit] exported {path}  ({len(objs)} objects, {tris} tris, {os.path.getsize(path) / 1024:.0f} kB)')
    return path


def _bounds(objs):
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def render_preview(filename, objs=None, azimuth=35.0, elevation=20.0, res=(1100, 800), zoom=1.0,
                   sky='#9fd3f5', hide_helpers=True, ortho=False, target=None, frame=None):
    """Render a PNG into blender/previews/ so you can LOOK at what you built (use the Read tool on it).
    azimuth: degrees around Z, 0 = camera on the -Y side looking at the front; elevation: degrees above horizon.
    objs=None frames every visible mesh. COL_/CLIMB_ helper meshes are hidden unless hide_helpers=False."""
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    path = filename if os.path.isabs(filename) else os.path.join(PREVIEW_DIR, filename)
    scene = bpy.context.scene
    if frame is not None:
        scene.frame_set(frame)
    hidden = []
    if hide_helpers:
        for o in scene.objects:
            if o.name.startswith(('COL_', 'CLIMB')) and not o.hide_render:
                o.hide_render = True
                hidden.append(o)
    targets = _with_children(objs) if objs else [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
    targets = [o for o in targets if o.type == 'MESH' and not o.hide_render]
    lo, hi = _bounds(targets)
    centre = Vector(target) if target is not None else (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.01)

    cam_data = bpy.data.cameras.new('_preview_cam')
    cam = bpy.data.objects.new('_preview_cam', cam_data)
    link(cam)
    az, el = math.radians(azimuth), math.radians(elevation)
    direction = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam_data.lens = 60
    fov = 2 * math.atan(36 / 2 / cam_data.lens * min(1.0, res[1] / res[0]))
    dist = radius / math.sin(fov / 2) / zoom
    if ortho:
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = radius * 2.2 / zoom
    cam.location = centre + direction * dist
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_start = max(0.01, dist / 500)
    cam_data.clip_end = dist * 10 + radius * 4

    sun_data = bpy.data.lights.new('_preview_sun', 'SUN')
    sun_data.energy = 3.2
    sun = bpy.data.objects.new('_preview_sun', sun_data)
    link(sun)
    sun.rotation_euler = Euler((math.radians(50), 0, az + math.radians(35)))
    world = bpy.data.worlds.new('_preview_world')
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = hex_rgba(sky)
        bg.inputs['Strength'].default_value = 1.0
    old_world = scene.world
    scene.world = world
    scene.camera = cam
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'BLENDER_WORKBENCH'):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    try:
        scene.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)
    bpy.data.cameras.remove(cam_data)
    bpy.data.lights.remove(sun_data)
    scene.world = old_world
    bpy.data.worlds.remove(world)
    for o in hidden:
        o.hide_render = False
    print(f'[indykit] preview {path}')
    return path
