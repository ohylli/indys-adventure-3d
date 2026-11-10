"""items.glb: treat_fish, heart, charm_nine, checkpoint_box.

Run:  blender --background --python blender/items.py

Every piece is an empty named after the piece. The collectibles have one mesh child <piece>_body (part = 'body'),
centred on the root and built to spin about Z. checkpoint_box also has checkpoint_box_flag (part = 'flag', origin
at the pole base) and COL_checkpoint_box.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from indykit import *
reset_scene()

import numpy as np

R = math.radians
NOPREV = bool(os.environ.get('NOPREV'))


# ----------------------------------------------------------------------------- local helpers

def ell(name, radii, loc=(0, 0, 0), material=None, rot=(0, 0, 0), segs=12, rings=8, axis='z'):
    """Ellipsoid from a UV sphere; axis = direction of the poles, radii along X/Y/Z, rot in degrees."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    if axis == 'y':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(R(90), 3, 'X'), verts=bm.verts)
    elif axis == 'x':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(R(90), 3, 'Y'), verts=bm.verts)
    bmesh.ops.scale(bm, vec=Vector(radii), verts=bm.verts)
    ob = obj_from_bmesh(name, bm, material)
    ob.location = loc
    ob.rotation_euler = tuple(R(a) for a in rot)
    return ob


def paint(ob, material, fn):
    m = mat(material)
    names = [s.name for s in ob.data.materials]
    if m.name not in names:
        ob.data.materials.append(m)
        names.append(m.name)
    idx = names.index(m.name)
    for p in ob.data.polygons:
        if fn(p.center):
            p.material_index = idx
    return ob


def prism(name, pts_xz, y0, y1, material, bevel_w=0.0):
    """Extrude a convex polygon given in the XZ plane (counter-clockwise seen from -Y) from y0 to y1."""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in pts_xz]
    b = [bm.verts.new((x, y1, z)) for x, z in pts_xz]
    n = len(a)
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel_w > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel_w, segments=2, affect='EDGES', profile=0.5)
    return obj_from_bmesh(name, bm, material)


def disc(name, r, loc, material, facing='y', depth=0.03, rz=None, rot=0.0, segs=12):
    """A flat round stud (decal that still has thickness) lying in the XZ plane (facing='y') or XY plane ('z')."""
    radii = (r, depth, rz or r) if facing == 'y' else (r, rz or r, depth)
    ob = ell(name, radii, loc, material, segs=segs, rings=4, axis=facing)
    if rot:
        ob.rotation_euler = (0, R(rot), 0) if facing == 'y' else (0, 0, R(rot))
    return ob


def paw(name, c, size, material, facing=-1, depth=0.03):
    """Paw print in the XZ plane centred at c: a big pad and four toes. facing = -1 for the -Y side, +1 for +Y."""
    c = Vector(c)
    out = [disc(name, 0.34 * size, c + Vector((0, 0, -0.14 * size)), material, depth=depth, rz=0.27 * size)]
    for dx, dz, rot in ((-0.37, 0.14, 25), (-0.13, 0.36, 8), (0.13, 0.36, -8), (0.37, 0.14, -25)):
        out.append(disc(name, 0.115 * size, c + Vector((dx * size, 0, dz * size)), material, depth=depth,
                        rz=0.15 * size, rot=rot * facing, segs=10))
    return out


def part(objs, piece, pname, root, origin=(0, 0, 0), angle=60, centre=False):
    objs = [o for o in objs if o is not None]
    ob = join(objs) if len(objs) > 1 else objs[0]
    ob.name = f'{piece}_{pname}'
    ob.data.name = ob.name
    apply_transforms(ob, location=True)
    shade(ob, angle)
    if centre:      # centre the bounding box on the root
        xs = [v.co for v in ob.data.vertices]
        lo = Vector((min(v.x for v in xs), min(v.y for v in xs), min(v.z for v in xs)))
        hi = Vector((max(v.x for v in xs), max(v.y for v in xs), max(v.z for v in xs)))
        ob.data.transform(Matrix.Translation(-(lo + hi) / 2))
    o = Vector(origin)
    ob.data.transform(Matrix.Translation(-o))
    ob.location = o
    ob.parent = root
    ob['part'] = pname
    return ob


def fit(ob, axis, size):
    """Uniformly scale a part's mesh so its extent along axis (0/1/2) is exactly size."""
    vs = [v.co[axis] for v in ob.data.vertices]
    ob.data.transform(Matrix.Scale(size / (max(vs) - min(vs)), 4))


# ----------------------------------------------------------------------------- pieces

def build_treat_fish():
    P = 'treat_fish'
    root = empty(P)
    O, L = 'fish_orange', 'fish_light'
    b = [ell('b', (0.2, 0.07, 0.14), (0.075, 0, 0), O, segs=16, rings=10, axis='x')]
    # tail: two chunky lobes
    for sz in (1, -1):
        b.append(ell('tail', (0.11, 0.042, 0.066), (-0.175, 0, sz * 0.06), L, rot=(0, sz * 38, 0), segs=10,
                     rings=6, axis='x'))
    b.append(ell('dorsal', (0.085, 0.03, 0.04), (0.035, 0, 0.106), L, rot=(0, 18, 0), segs=8, rings=6, axis='x'))
    for sy in (1, -1):
        b.append(ell('fin', (0.055, 0.016, 0.035), (0.05, sy * 0.062, -0.045), L, rot=(0, 30, 0), segs=8, rings=4,
                     axis='y'))
        b.append(ell('eye', (0.04, 0.02, 0.04), (0.175, sy * 0.046, 0.04), 'eye_white', segs=10, rings=4, axis='y'))
        b.append(ell('pupil', (0.023, 0.014, 0.023), (0.183, sy * 0.06, 0.04), 'eye_dark', segs=8, rings=4,
                     axis='y'))
    ob = part(b, P, 'body', root, centre=True)
    fit(ob, 0, 0.55)
    return root


def heart_point(x, y, z):
    """Map a unit-sphere point (poles on Y) to a puffy heart whose silhouette is the classic heart curve."""
    rho = math.hypot(x, z)
    t = math.atan2(x, z)
    hx = 16 * math.sin(t) ** 3
    hz = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
    # blend toward a circle near the middle of the faces so the cleft and the tip do not crease the whole front
    w = rho ** 2.5
    cx, cz = 0.78 * math.sin(t), 0.78 * math.cos(t)
    return Vector((rho * ((1 - w) * cx + w * hx / 16), y, rho * ((1 - w) * cz + w * (hz + 2.5) / 16)))


def build_heart():
    P = 'heart'
    root = empty(P)
    sx, sy = 0.275, 0.1
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=12, radius=1.0)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(R(90), 3, 'X'), verts=bm.verts)
    for v in bm.verts:
        q = heart_point(*v.co)
        v.co = Vector((q.x * sx, q.y * sy, q.z * sx))
    h = obj_from_bmesh('h', bm, 'red')
    objs = [h]
    # glossy highlight on the upper lobe, on both faces (it spins)
    for sgn in (-1, 1):
        for d, rad, rot in (((-0.5, sgn * 0.72, 0.5), (0.055, 0.012, 0.026), 38),
                            ((-0.72, sgn * 0.66, 0.2), (0.018, 0.01, 0.018), 0)):
            q = heart_point(*Vector(d).normalized())
            objs.append(ell('hl', rad, Vector((q.x * sx, q.y * sy, q.z * sx)), 'eye_white', rot=(0, rot, 0),
                            segs=10, rings=4, axis='y'))
    ob = part(objs, P, 'body', root, angle=50, centre=True)
    fit(ob, 0, 0.55)
    return root


def nine(name, y, facing, material, r=0.032):
    """A raised '9' in the XZ plane at depth y; facing = -1 reads correctly from -Y, +1 from +Y."""
    f = -facing     # mirror X so the digit reads the right way round from the side it faces
    cx, cz, rr = 0.0, 0.055, 0.082
    loop = [(f * (cx + rr * math.cos(2 * math.pi * i / 16)), y, cz + rr * math.sin(2 * math.pi * i / 16))
            for i in range(16)]
    tail = [(f * (cx + rr), y, cz), (f * (cx + rr), y, cz - 0.06), (f * (cx + rr * 0.9), y, cz - 0.115),
            (f * (cx + rr * 0.62), y, cz - 0.165), (f * (cx + rr * 0.2), y, cz - 0.2),
            (f * (cx - rr * 0.3), y, cz - 0.205), (f * (cx - rr * 0.75), y, cz - 0.18)]
    return [tube(name, loop, r=r, segs=8, material=material, closed=True),
            tube(name + '_t', tail, r=r, segs=8, material=material)]


def build_charm_nine():
    P = 'charm_nine'
    root = empty(P)
    Gd, Dk = 'gold', 'gold_dark'
    t, rim = 0.04, 0.058          # half thickness of the face and of the raised rim
    med = lathe('med', [(0, -t), (0.275, -t), (0.29, -rim), (0.335, -rim), (0.35, -t), (0.35, t), (0.335, rim),
                        (0.29, rim), (0.275, t), (0, t)], segs=28, material=Gd)
    paint(med, Dk, lambda c: math.hypot(c.x, c.y) < 0.27)
    med.rotation_euler = (R(90), 0, 0)
    objs = [med]
    for s in (1, -1):
        ear = prism('ear', [(s * 0.12, 0.27), (s * 0.345, 0.05), (s * 0.325, 0.44)] if s > 0 else
                    [(s * 0.345, 0.05), (s * 0.12, 0.27), (s * 0.325, 0.44)], -rim, rim, Gd, bevel_w=0.012)
        objs.append(ear)
        for sy in (1, -1):
            objs.append(prism('ear_in', [(s * 0.2, 0.25), (s * 0.31, 0.16), (s * 0.3, 0.37)] if s > 0 else
                              [(s * 0.31, 0.16), (s * 0.2, 0.25), (s * 0.3, 0.37)],
                              sy * rim, sy * (rim + 0.012), Dk))
    objs += nine('nine_f', -(t + 0.012), -1, 'glow_yellow')
    objs += nine('nine_b', (t + 0.012), 1, 'glow_yellow')
    ring_r = 0.06
    ring = [(ring_r * math.cos(2 * math.pi * i / 12), 0, 0.35 + ring_r * 0.75 + ring_r * math.sin(2 * math.pi * i / 12))
            for i in range(12)]
    objs.append(tube('ring', ring, r=0.022, segs=8, material=Dk, closed=True))
    ob = part(objs, P, 'body', root, angle=40, centre=True)
    fit(ob, 0, 0.7)
    return root


def build_checkpoint_box():
    P = 'checkpoint_box'
    root = empty(P)
    C, D = 'cardboard', 'cardboard_dark'
    W, Dp, H, T = 1.3, 1.0, 0.75, 0.06
    b = [box('floor', (W, Dp, 0.06), (0, 0, 0.03), C)]
    # walls
    b.append(box('front', (W, T, H), (0, -Dp / 2 + T / 2, H / 2), C))
    b.append(box('back', (W, T, H), (0, Dp / 2 - T / 2, H / 2), C))
    b.append(box('left', (T, Dp - 2 * T, H), (W / 2 - T / 2, 0, H / 2), C))
    b.append(box('right', (T, Dp - 2 * T, H), (-W / 2 + T / 2, 0, H / 2), C))
    # dark lining inside, cushion at the standing height (z = 0.4, same as the collision box)
    b.append(box('lin_f', (W - 2 * T, 0.012, H - 0.4), (0, -Dp / 2 + T + 0.006, 0.4 + (H - 0.4) / 2 - 0.004), D))
    b.append(box('lin_b', (W - 2 * T, 0.012, H - 0.4), (0, Dp / 2 - T - 0.006, 0.4 + (H - 0.4) / 2 - 0.004), D))
    b.append(box('lin_l', (0.012, Dp - 2 * T, H - 0.4), (W / 2 - T - 0.006, 0, 0.4 + (H - 0.4) / 2 - 0.004), D))
    b.append(box('lin_r', (0.012, Dp - 2 * T, H - 0.4), (-W / 2 + T + 0.006, 0, 0.4 + (H - 0.4) / 2 - 0.004), D))
    b.append(box('cushion', (W - 2 * T, Dp - 2 * T, 0.2), (0, 0, 0.3), 'red'))
    # flaps folded outward: hinge on the outer top edge, angle measured from upright
    FL, FT = 0.36, 0.045
    for y, ang, fl in ((-Dp / 2, 97, 0.3), (Dp / 2, -118, FL)):
        a = R(ang)
        d = Vector((0, -math.sin(a), math.cos(a)))
        f = box('flap', (W - 0.03, FT, fl), Vector((0, y, H - 0.01)) + d * fl / 2, C)
        f.rotation_euler = (a, 0, 0)
        b.append(f)
    for x, ang in ((W / 2, 112), (-W / 2, -100)):
        a = R(ang)
        d = Vector((math.sin(a), 0, math.cos(a)))
        f = box('flap', (FT, Dp - 0.03, FL), Vector((x, 0, H - 0.01)) + d * FL / 2, C)
        f.rotation_euler = (0, a, 0)
        b.append(f)
    # paw print on the front
    b += paw('paw', (0, -Dp / 2, 0.29), 0.5, 'wood_dark', facing=-1, depth=0.016)
    # packing tape strips on the sides
    for s in (1, -1):
        b.append(box('tape', (0.012, 0.16, H - 0.02), (s * (W / 2 + 0.002), 0, H / 2 - 0.005), 'canvas'))
    part(b, P, 'body', root, angle=30)

    # flag: pole in the back corner (the creature's left = +X), teal pennant with a cream paw, flying toward -X
    base = Vector((0.5, 0.35, 0.4))
    top = 2.0
    fl = [cylinder('pole', r=0.04, h=top - base.z - 0.05, loc=(base.x, base.y, (top - 0.05 + base.z) / 2),
                   material='white_paint', segs=8)]
    fl.append(ell('knob', (0.07, 0.07, 0.07), (base.x, base.y, top - 0.06), 'yellow', segs=8, rings=6))
    x0 = base.x - 0.03
    fl.append(prism('pennant', [(x0, 1.36), (x0, 1.9), (x0 - 0.78, 1.63)][::-1], base.y - 0.025, base.y + 0.025,
                    'teal'))
    for sgn in (-1, 1):
        fl += paw('fpaw', (x0 - 0.25, base.y + sgn * 0.025, 1.64), 0.26, 'cream', facing=sgn, depth=0.014)
    part(fl, P, 'flag', root, origin=base, angle=30)

    col = box('COL_checkpoint_box', (W, Dp, 0.4), (0, 0, 0.2), 'grey')
    col.parent = root
    return root


# ----------------------------------------------------------------------------- previews / stats

def child(root, pname):
    return next(c for c in root.children if c.get('part') == pname)


def sheet(files, out):
    imgs = []
    for f in files:
        im = bpy.data.images.load(f)
        w, h = im.size
        a = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        imgs.append(a.reshape(h, w, 4))
        bpy.data.images.remove(im)
    row = np.concatenate(imgs, axis=1)
    o = bpy.data.images.new('_sheet', row.shape[1], row.shape[0])
    o.pixels.foreach_set(row.ravel())
    o.filepath_raw = out
    o.file_format = 'PNG'
    o.save()
    bpy.data.images.remove(o)
    print(f'[indykit] sheet {out}')


def preview(root, views, tag=None, res=(480, 440)):
    mine = set(root.children_recursive)
    others = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in mine and not o.hide_render]
    for o in others:
        o.hide_render = True
    files = []
    for vtag, az, el in views:
        fn = f'items_{root.name}_{vtag}.png'
        render_preview(fn, [root], azimuth=az, elevation=el, res=res)
        files.append(os.path.join(PREVIEW_DIR, fn))
    for o in others:
        o.hide_render = False
    if tag:
        sheet(files, os.path.join(PREVIEW_DIR, f'items_{root.name}_{tag}.png'))
    return files


def stats(root):
    bpy.context.view_layer.update()
    inv = root.matrix_world.inverted()
    lo, hi, tris = Vector((1e9,) * 3), Vector((-1e9,) * 3), 0
    for o in root.children_recursive:
        if o.type != 'MESH' or o.name.startswith('COL_'):
            continue
        m = inv @ o.matrix_world
        for v in o.data.vertices:
            p = m @ v.co
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    sz = hi - lo
    print(f'[stats] {root.name:15s} tris {tris:5d}  size X {sz.x:.2f} Y {sz.y:.2f} Z {sz.z:.2f}   '
          f'x[{lo.x:.2f},{hi.x:.2f}] y[{lo.y:.2f},{hi.y:.2f}] z[{lo.z:.2f},{hi.z:.2f}]')
    for o in root.children:
        l = o.location
        print(f'[stats]     {o.name:22s} part={o.get("part")!s:5s} origin ({l.x:.3f}, {l.y:.3f}, {l.z:.3f})')


# ----------------------------------------------------------------------------- build

roots = []
for i, fn in enumerate((build_treat_fish, build_heart, build_charm_nine, build_checkpoint_box)):
    r = fn()
    r.location = (i * 4.0, 0, 0)
    roots.append(r)

if not NOPREV:
    for r in roots:
        if r.name == 'checkpoint_box':
            preview(r, [('front', 0, 20), ('34', 35, 25), ('back', 150, 25), ('top', 20, 60)], tag='sheet')
        else:
            preview(r, [('front', 0, 10), ('34', 40, 20), ('edge', 90, 10), ('back', 180, 10)], tag='sheet')

for r in roots:
    stats(r)

export_glb('items.glb', roots)
