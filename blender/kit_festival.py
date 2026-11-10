"""kit_festival.glb: festival props (balloons, lanterns, banners, climbables, plaza furniture, fireworks, cat perch).

Run:  blender --background --python blender/kit_festival.py
Fast iteration:  FEST_PREVIEW=balloon,lantern blender ...   (previews only those pieces; 'none' skips previews,
                 default 'all'). The GLB is always built completely and exported.

Contract (see blender/ASSETS.md "kit_festival.glb"):
  * every piece is an empty named after the piece; its visible geometry is one mesh child `<piece>_mesh`
  * helpers are direct children of the root: COL_<piece>[_<part>], CLIMB_<piece>, CLIMBPOLE_rope
  * child empties are named <piece>_<part> and carry the custom property part (-> three.js userData.part),
    because Blender object names are global: firework_fountain_emit / firework_mortar_emit (part = 'emit')
  * cat_perch has one extra mesh child `cat_perch_mouse` (part = 'mouse', origin at the string attachment)
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from indykit import *
reset_scene()

import numpy as np

PI = math.pi
RAD = math.radians
PREVIEW = os.environ.get('FEST_PREVIEW', 'all')

mat('tint_main', '#e8443a')
mat('balloon_shine', '#fff6ea')
mat('rope_dark', '#a8844c')
mat('glow_rib', '#f47a1c')

PIECES = []
_shaded = set()


# ----------------------------------------------------------------------------- local helpers

def S(ob, angle=40.0):
    """shade() and remember that this part already has its shading."""
    shade(ob, angle)
    _shaded.add(ob.name)
    return ob


def new_piece(name):
    r = empty(name)
    PIECES.append(r)
    return r


def merge(name, parts):
    """Join mesh parts into a fresh object with an identity transform."""
    for p in parts:
        if p.name not in _shaded:
            shade(p, 35.0)
    base = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    link(base)
    ob = join([base] + [p for p in parts if p is not None], name)
    _shaded.add(ob.name)
    return ob


def finish(root, parts, name=None):
    ob = merge(name or (root.name + '_mesh'), parts)
    ob.parent = root
    return ob


def part_empty(root, part, loc):
    e = empty(f'{root.name}_{part}', loc, parent=root)
    e['part'] = part
    e.empty_display_size = 0.2
    return e


def lathe2(name, profile, segs=16, mats=None, closed=False, cap_bottom=None, cap_top=None,
           mat_fn=None, rfn=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Solid of revolution about Z with a material per profile segment.
    profile = [(r, z), ...] traversed counter-clockwise in the (r, z) half-plane (outside going up, top going
    inward, inside going down), which gives outward normals. mats: one name per segment or a single name.
    mat_fn(k, i) overrides per face (k = profile segment, i = angular segment). rfn(i) scales the radius of
    angular column i. cap_bottom / cap_top: True (use the neighbouring material) or a material name."""
    bm = bmesh.new()
    names = []

    def mi(m):
        if m is None:
            return 0
        if m not in names:
            names.append(m)
        return names.index(m)

    n = len(profile)
    nseg = n if closed else n - 1
    if mats is None or isinstance(mats, str):
        mats = [mats] * nseg
    rings = []
    for (r, z) in profile:
        if r < 1e-6:
            v = bm.verts.new((0, 0, z))
            rings.append([v] * segs)
        else:
            ring = []
            for i in range(segs):
                a = 2 * PI * i / segs
                rr = r * (rfn(i) if rfn else 1.0)
                ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
            rings.append(ring)
    for k in range(nseg):
        a, b = rings[k], rings[(k + 1) % n]
        for i in range(segs):
            j = (i + 1) % segs
            vs = []
            for v in (a[i], a[j], b[j], b[i]):
                if v not in vs:
                    vs.append(v)
            if len(vs) < 3:
                continue
            f = bm.faces.new(vs)
            f.material_index = mi(mat_fn(k, i) if mat_fn else mats[k])
    if cap_bottom and rings[0][0] is not rings[0][1]:
        f = bm.faces.new(list(reversed(rings[0])))
        f.material_index = mi(cap_bottom if isinstance(cap_bottom, str) else mats[0])
    if cap_top and rings[-1][0] is not rings[-1][1]:
        f = bm.faces.new(rings[-1])
        f.material_index = mi(cap_top if isinstance(cap_top, str) else mats[-1])
    ob = obj_from_bmesh(name, bm)
    for nm in names:
        ob.data.materials.append(mat(nm))
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def torus(name, R, r, segs=16, tsegs=6, material=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    prof = [(R + r * math.cos(2 * PI * k / tsegs), r * math.sin(2 * PI * k / tsegs)) for k in range(tsegs)]
    return lathe2(name, prof, segs, mats=material, closed=True, loc=loc, rot=rot)


def rod(name, p0, p1, r=0.03, segs=4, material=None, r1=None):
    """Straight cylinder between two points."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = cylinder(name, r=r, r_top=r1, h=d.length, loc=(p0 + p1) / 2, material=material, segs=segs)
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return ob


def tbox(name, w0, d0, w1, d1, z0, z1, material, loc=(0, 0, 0)):
    """Box tapered along Z: bottom w0 x d0 at z0, top w1 x d1 at z1."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        top = v.co.z > 0
        v.co.x *= (w1 if top else w0)
        v.co.y *= (d1 if top else d0)
        v.co.z = z1 if top else z0
    ob = obj_from_bmesh(name, bm, material)
    ob.location = loc
    return ob


def _ccw(pts):
    area = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        area += x0 * y1 - x1 * y0
    return list(pts) if area > 0 else list(reversed(pts))


def prism_xz(name, pts, y0, y1, material):
    """Polygon in the XZ plane ((x, z) points), extruded from y0 (front, -Y side) to y1."""
    pts = _ccw(pts)
    bm = bmesh.new()
    f = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    bm.faces.new(f)
    bm.faces.new(list(reversed(b)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[i], b[i], b[j], f[j]))
    return obj_from_bmesh(name, bm, material)


def prism_xy(name, pts, z0, z1, material):
    """Polygon in the XY plane, extruded from z0 up to z1."""
    pts = _ccw(pts)
    bm = bmesh.new()
    b = [bm.verts.new((x, y, z0)) for x, y in pts]
    t = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(t)
    bm.faces.new(list(reversed(b)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((b[i], b[j], t[j], t[i]))
    return obj_from_bmesh(name, bm, material)


def ellipse(cx, cy, a, b, n=12, rot=0.0):
    c, s = math.cos(RAD(rot)), math.sin(RAD(rot))
    out = []
    for i in range(n):
        t = 2 * PI * i / n
        x, y = a * math.cos(t), b * math.sin(t)
        out.append((cx + x * c - y * s, cy + x * s + y * c))
    return out


def paw_polys(cx, cy, s):
    """A paw print about s wide and s tall, centred on (cx, cy): list of polygons (pad first, then four toes)."""
    pad = []
    for i in range(14):
        t = 2 * PI * i / 14
        pad.append((cx + 0.37 * s * math.cos(t) * (1 - 0.22 * math.sin(t)), cy - 0.18 * s + 0.27 * s * math.sin(t)))
    polys = [pad]
    for (tx, ty, ang) in ((-0.36, 0.10, 24), (-0.13, 0.33, 8), (0.13, 0.33, -8), (0.36, 0.10, -24)):
        polys.append(ellipse(cx + tx * s, cy + ty * s, 0.115 * s, 0.16 * s, 10, ang))
    return polys


def star_pts(cx, cy, R, r, n=5, rot=90.0):
    out = []
    for i in range(n * 2):
        a = RAD(rot) + PI * i / n
        rr = R if i % 2 == 0 else r
        out.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return out


def fish_parts(cx, cz, L, y0, y1, material, flip=False, eye=True):
    """A simple fish silhouette in the XZ plane, L long, facing +X (or -X when flip)."""
    s = -1 if flip else 1
    parts = [prism_xz('fish', ellipse(cx + s * 0.1 * L, cz, 0.38 * L, 0.22 * L, 14), y0, y1, material)]
    tail = [(cx - s * 0.2 * L, cz), (cx - s * 0.5 * L, cz - 0.2 * L), (cx - s * 0.41 * L, cz),
            (cx - s * 0.5 * L, cz + 0.2 * L)]
    parts.append(prism_xz('fish_tail', tail, y0, y1, material))
    if eye:
        parts.append(prism_xz('fish_eye', ellipse(cx + s * 0.3 * L, cz + 0.05 * L, 0.035 * L, 0.035 * L, 8),
                              y0 - 0.012, y1, 'eye_dark'))
    return parts


def bake(ob):
    """Move the object's transform into its mesh, so the exported node has an identity transform."""
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    return ob


def col_box(root, size, loc, suffix=''):
    ob = bake(box(f'COL_{root.name}{suffix}', size, loc))
    ob.parent = root
    return ob


def col_cyl(root, r, z0, z1, suffix='', segs=16, loc=(0, 0)):
    ob = bake(cylinder(f'COL_{root.name}{suffix}', r=r, h=z1 - z0, loc=(loc[0], loc[1], (z0 + z1) / 2), segs=segs))
    ob.parent = root
    return ob


def climb_quad(root, name, w, z0, z1, y):
    """Climbable quad in the XZ plane at depth y, front (normal) toward -Y."""
    ob = quad(name, [(-w / 2, y, z0), (w / 2, y, z0), (w / 2, y, z1), (-w / 2, y, z1)])
    ob.parent = root
    return ob


# ----------------------------------------------------------------------------- balloons

def balloon_body(name, R, skin, segs=16, nlat=9):
    """Party balloon about the origin: sphere of radius R, slightly drawn out toward a knot at -Z."""
    prof = [(0.11 * R, -1.21 * R), (0.05 * R, -1.13 * R)]
    lat0 = -76.0
    for k in range(nlat + 1):
        lat = RAD(lat0 + (90 - lat0) * k / nlat)
        z = math.sin(lat) * R
        if z < 0:
            z *= 1.08
        prof.append((math.cos(lat) * R, z))
    return S(lathe2(name, prof, segs, mats=skin, cap_bottom=True), 62)


def shine_patch(name, R, centre, direction, a=0.34, b=0.18, roll=0.6, n=8, material='balloon_shine'):
    """A small elliptical highlight lying on a sphere of radius R (a, b = angular half sizes in radians)."""
    bm = bmesh.new()
    M = Vector(direction).normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4() @ Matrix.Rotation(roll, 4, 'Z')
    c = bm.verts.new(M @ Vector((0, 0, R)))
    ring = []
    for i in range(n):
        p = 2 * PI * i / n
        v = Vector((math.tan(a * math.cos(p)), math.tan(b * math.sin(p)), 1)).normalized() * R
        ring.append(bm.verts.new(M @ v))
    for i in range(n):
        bm.faces.new((c, ring[i], ring[(i + 1) % n]))
    ob = obj_from_bmesh(name, bm, material)
    ob.location = centre
    return S(ob, 180)


def make_balloon():
    root = new_piece('balloon')
    P = [balloon_body('b', 1.0, 'tint_main', segs=20, nlat=11)]
    P.append(shine_patch('s', 1.03, (0, 0, 0), (-0.50, -0.64, 0.58), a=0.36, b=0.16, roll=0.75, n=10))
    P.append(shine_patch('s2', 1.03, (0, 0, 0), (-0.80, -0.56, 0.20), a=0.085, b=0.075, roll=0.0, n=6))
    P.append(S(tube('str', [(0, 0, -1.2), (0.07, 0.0, -1.8), (-0.06, 0.03, -2.45), (0.06, -0.02, -3.1),
                            (0.0, 0.0, -3.69)], r=0.024, segs=4, material='white_paint'), 60))
    finish(root, P)
    return root


def make_balloon_bunch():
    root = new_piece('balloon_bunch')
    G = Vector((0, 0, -3.0))
    spec = [((0.0, 0.0, -0.62), 0.62, 'red')]
    cols = ['yellow', 'teal', 'pink', 'blue', 'orange', 'green']
    for i in range(6):
        a = RAD(60 * i + 20)
        R = 0.60 if i % 2 == 0 else 0.56
        spec.append(((0.72 * math.cos(a), 0.72 * math.sin(a), -0.09 - R - (0.0 if i % 2 == 0 else 0.05)), R, cols[i]))
    spec.append(((0.40, -0.34, -1.52), 0.52, 'purple'))
    spec.append(((-0.42, 0.26, -1.56), 0.50, 'cream'))
    P = []
    for k, (c, R, col) in enumerate(spec):
        c = Vector(c)
        d = (G - c).normalized()
        b = balloon_body(f'b{k}', R, col, segs=12, nlat=6)
        b.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        b.location = c
        P.append(b)
        P.append(shine_patch(f's{k}', R * 1.035, c, (-0.50, -0.64, 0.58), a=0.34, b=0.16, roll=0.75, n=6))
        P.append(rod(f'str{k}', c + d * 1.2 * R, G, r=0.02, segs=4, material='white_paint'))
    P.append(S(sphere('knot', 0.075, G, 'red', subdiv=1), 180))
    P.append(rod('tail', G, G + Vector((0.05, 0, -0.45)), r=0.022, segs=4, material='white_paint'))
    finish(root, P)
    col_cyl(root, 1.2, -0.8, 0.0)
    return root


def make_hot_air_balloon():
    root = new_piece('hot_air_balloon')
    P = []
    Rb, zc = 2.115, -1.775           # gore seams lie on this sphere, gore centres bulge 4 % (max r = 2.2)
    prof = [(0.60, -4.42)]
    for lat in (-42, -28, -14, 0, 14, 28, 41):
        prof.append((Rb * math.cos(RAD(lat)), zc + Rb * math.sin(RAD(lat))))
    prof.append((1.22, -0.07))
    env = lathe2('env', prof, 24, mat_fn=lambda k, i: 'tint_main' if (i // 2) % 2 == 0 else 'cream',
                 rfn=lambda i: 1.04 if i % 2 else 1.0, cap_bottom='red_dark')
    # rotate half a gore so that a full gore (not a seam) faces the front
    env.rotation_euler = (0, 0, RAD(-90 - 15))
    P.append(S(env, 24))
    # crown disc to stand on (top at Z = 0, r = 1.3)
    P.append(S(lathe2('crown', [(1.18, -0.24), (1.30, -0.16), (1.30, -0.035), (1.265, 0.0)], 24,
                      mats=['orange', 'orange', 'orange'], cap_top='yellow'), 30))
    P.append(S(lathe2('crown_dot', [(0.42, 0.0), (0.42, 0.012)], 16, mats='orange', cap_top=True), 30))
    # mouth collar
    P.append(S(lathe2('collar', [(0.56, -4.56), (0.67, -4.53), (0.67, -4.38), (0.61, -4.32), (0.56, -4.40)], 16,
                      mats=['yellow', 'yellow', 'yellow', 'yellow', 'red_dark'], closed=True), 40))
    # basket
    zt = -5.42
    P.append(tbox('basket_base', 0.90, 0.90, 0.94, 0.94, -6.32, -6.20, 'wood_dark'))
    P.append(tbox('basket', 0.94, 0.94, 1.06, 1.06, -6.20, -5.56, 'wood'))
    P.append(tbox('basket_band', 1.02, 1.02, 1.05, 1.05, -5.98, -5.84, 'wood_light'))
    P.append(S(box('basket_rim', (1.12, 1.12, 0.14), (0, 0, -5.49), 'wood_dark', bevel_w=0.03), 30))
    # ropes: basket corners -> collar, and burner cross
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(rod('rope', (sx * 0.5, sy * 0.5, zt), (sx * 0.43, sy * 0.43, -4.5), r=0.035, segs=5,
                         material='rope'))
    zb = -4.98
    for sy in (-1, 1):
        P.append(rod('burner_bar', (-0.46, sy * 0.46, zb), (0.46, -sy * 0.46, zb), r=0.035, segs=4,
                     material='steel_dark'))
    P.append(S(cylinder('burner', r=0.15, h=0.2, loc=(0, 0, zb + 0.06), material='steel', segs=10), 40))
    P.append(S(lathe2('flame', [(0.11, zb + 0.16), (0.17, zb + 0.32), (0.0, -4.42)], 8, mats='glow_warm'), 60))
    P.append(S(lathe2('flame_in', [(0.06, zb + 0.16), (0.09, zb + 0.30), (0.0, -4.50)], 6, mats='glow_yellow',
                      loc=(0, -0.06, 0)), 60))
    # sandbags
    for sx in (-1, 1):
        P.append(S(uv_sphere('bag', 0.12, (sx * 0.64, 0.05 * sx, -5.86), 'canvas', segs=8, rings=5,
                             scale=(1, 1, 1.25)), 80))
        P.append(rod('bag_rope', (sx * 0.60, 0.05 * sx, -5.50), (sx * 0.64, 0.05 * sx, -5.74), r=0.025, segs=4,
                     material='rope'))
    finish(root, P)
    col_cyl(root, 1.3, -0.3, 0.0, '_crown')
    c = lathe2('COL_hot_air_balloon_envelope', [(0.60, -4.4), (1.63, -3.25), (2.2, -1.775), (2.0, -0.86),
                                                (1.3, -0.3)], 12, cap_bottom=True, cap_top=True)
    c.parent = root
    col_box(root, (1.1, 1.1, 0.9), (0, 0, -5.87), '_basket')
    return root


def make_lantern():
    root = new_piece('lantern')
    P = []
    a, b, zc = 0.9, 0.83, -0.7

    def rr(z):
        return a * math.sqrt(max(0.0, 1 - ((z - zc) / b) ** 2))

    prof = [(rr(-1.3), -1.3)]
    mats = []
    for z in (-1.15, -0.925, -0.7, -0.475, -0.25):
        prof += [(rr(z) + 0.02, z - 0.03), (rr(z) + 0.02, z + 0.03)]
        mats += ['glow_warm', 'glow_rib']
    prof.append((rr(-0.1), -0.1))
    mats.append('glow_warm')
    P.append(S(lathe2('paper', prof, 20, mats=mats), 50))
    P.append(S(lathe2('cap_top', [(0.50, -0.22), (0.65, -0.17), (0.65, -0.035), (0.62, 0.0)], 20,
                      mats='pod_dark', cap_top=True), 30))
    P.append(S(lathe2('cap_bot', [(0.48, -1.46), (0.65, -1.42), (0.65, -1.25), (0.58, -1.18)], 20,
                      mats='pod_dark', cap_bottom=True), 30))
    P.append(S(lathe2('band_top', [(0.67, -0.14), (0.67, -0.08)], 20, mats='gold'), 30))
    P.append(S(lathe2('band_bot', [(0.67, -1.36), (0.67, -1.30)], 20, mats='gold'), 30))
    # string above (1.5) and tassel below
    P.append(rod('string', (0, 0, 0), (0, 0, 1.5), r=0.025, segs=4, material='pod_dark'))
    P.append(S(cylinder('knob', r=0.09, h=0.07, loc=(0, 0, 0.035), material='gold', segs=8), 40))
    P.append(rod('cord', (0, 0, -1.46), (0, 0, -1.72), r=0.03, segs=4, material='red'))
    P.append(S(sphere('bead', 0.08, (0, 0, -1.74), 'gold', subdiv=1), 180))
    P.append(S(lathe2('tassel', [(0.12, -2.2), (0.10, -1.92), (0.04, -1.8)], 8, mats='red', cap_bottom=True), 50))
    finish(root, P)
    col_cyl(root, 0.85, -1.4, 0.0)
    return root


# ----------------------------------------------------------------------------- banners

def digit5(cx, cz, w, h, t, y0, y1, material):
    yc, yd = (y0 + y1) / 2, (y1 - y0)
    top, bot = cz + h / 2, cz - h / 2
    mid = cz + 0.06 * h
    out = [box('d5', (w, yd, t), (cx, yc, top - t / 2), material),
           box('d5', (w, yd, t), (cx, yc, mid), material),
           box('d5', (w, yd, t), (cx, yc, bot + t / 2), material)]
    h1 = (top - t) - (mid + t / 2)
    out.append(box('d5', (t, yd, h1), (cx - w / 2 + t / 2, yc, (top - t + mid + t / 2) / 2), material))
    h2 = (mid - t / 2) - (bot + t)
    out.append(box('d5', (t, yd, h2), (cx + w / 2 - t / 2, yc, (mid - t / 2 + bot + t) / 2), material))
    return out


def make_banner(name, H, scheme):
    root = new_piece(name)
    P = []
    W, T = 2.4, 0.06
    y0, y1 = -T / 2, T / 2
    # top bar with finials and a hanging cord
    P.append(S(cylinder('bar', r=0.075, h=2.86, material='wood_dark', segs=10, rot=(0, PI / 2, 0)), 40))
    for s in (-1, 1):
        P.append(S(sphere('finial', 0.13, (s * 1.48, 0, 0), 'gold', subdiv=2), 180))
        P.append(rod('cord', (s * 1.30, 0, 0.03), (0, 0, 0.62), r=0.03, segs=4, material='rope'))
    P.append(S(torus('ring', 0.09, 0.03, 10, 4, 'gold', loc=(0, 0, 0.68), rot=(PI / 2, 0, 0)), 60))
    # sleeve around the bar
    P.append(S(box('sleeve', (W, 0.2, 0.26), (0, 0, -0.01), scheme['sleeve'], bevel_w=0.04), 30))
    # horizontal sections of the cloth
    for (za, zb, m) in scheme['bands']:
        P.append(box('band', (W, T, za - zb), (0, 0, (za + zb) / 2), m))
    # vertical stripes with a swallowtail cut
    zs, notch, n = scheme['tail_top'], scheme['notch'], 6
    for i in range(n):
        xa, xb = -W / 2 + W * i / n, -W / 2 + W * (i + 1) / n

        def zbot(x):
            return -H + notch * (1 - abs(x) / (W / 2))
        P.append(prism_xz('tail', [(xa, zs), (xa, zbot(xa)), (xb, zbot(xb)), (xb, zs)], y0, y1,
                          scheme['tail'][i % 2]))
    # decals: 0.02 proud of the cloth
    for (kind, cx, cz, size, m) in scheme['decals']:
        if kind == 'paw':
            for poly in paw_polys(cx, cz, size):
                P.append(prism_xz('paw', poly, y0 - 0.02, y1 + 0.02, m))
        elif kind == '55':
            w = size * 0.62
            for s in (-1, 1):
                P += digit5(cx + s * (w / 2 + 0.09), cz, w, size, size * 0.2, y0 - 0.02, y0 + 0.02, m)
        elif kind == 'star':
            P.append(prism_xz('star', star_pts(cx, cz, size, size * 0.45), y0 - 0.02, y1 + 0.02, m))
    # tassels on the two tips
    for s in (-1, 1):
        P.append(S(sphere('tip', 0.085, (s * (W / 2 - 0.05), 0, -H - 0.03), 'gold', subdiv=1), 180))
    finish(root, P)
    climb_quad(root, 'CLIMB_' + name, 2.2, -H, 0.0, y0 - 0.03)
    return root


BANNER_LONG = dict(
    sleeve='red_dark',
    bands=[(-0.14, -0.46, 'yellow'), (-0.46, -2.46, 'cream'), (-2.46, -2.76, 'yellow'),
           (-2.76, -5.66, 'red'), (-5.66, -5.96, 'yellow')],
    tail_top=-5.96, notch=0.95, tail=('teal', 'cream'),
    decals=[('55', 0.0, -1.46, 1.3, 'red'), ('paw', 0.0, -4.16, 1.95, 'cream'),
            ('star', -0.86, -3.02, 0.17, 'yellow'), ('star', 0.86, -3.02, 0.17, 'yellow'),
            ('star', -0.86, -5.38, 0.17, 'yellow'), ('star', 0.86, -5.38, 0.17, 'yellow')],
)
BANNER_SHORT = dict(
    sleeve='blue_dark',
    bands=[(-0.14, -0.42, 'yellow'), (-0.42, -2.90, 'teal'), (-2.90, -3.16, 'yellow')],
    tail_top=-3.16, notch=0.56, tail=('red', 'cream'),
    decals=[('paw', 0.0, -1.62, 1.75, 'cream')],
)


# ----------------------------------------------------------------------------- climbables

def make_net():
    root = new_piece('net')
    P = []
    for s in (-1, 1):
        prof = [(0.09, 0.0)] + [(0.09, 0.75 * k) for k in range(1, 8)]
        prof[-1] = (0.09, 5.22)
        P.append(S(lathe2('pole', prof, 10, mats=['red' if k % 2 == 0 else 'cream' for k in range(7)],
                          loc=(s * 1.5, 0, 0)), 40))
        P.append(S(cylinder('foot', r=0.2, h=0.12, loc=(s * 1.5, 0, 0.06), material='wood_dark', segs=10), 40))
        P.append(S(sphere('ball', 0.16, (s * 1.5, 0, 5.34), 'yellow', subdiv=2), 180))
    P.append(S(cylinder('topbar', r=0.08, h=3.0, loc=(0, 0, 5.0), material='wood', segs=8, rot=(0, PI / 2, 0)), 40))
    t = 0.07
    for x in (-1.0, -0.5, 0.0, 0.5, 1.0):
        P.append(box('strand_v', (t, t, 4.94), (x, 0, 2.53), 'rope'))
    zs = [0.08] + [0.5 * k for k in range(1, 10)]
    for z in zs:
        P.append(box('strand_h', (2.84, t, t), (0, 0, z), 'rope'))
    for z in zs[1:]:
        for x in (-1.0, -0.5, 0.0, 0.5, 1.0):
            P.append(box('knot', (0.13, 0.12, 0.13), (x, 0, z), 'rope_dark', rot=(0, PI / 4, 0)))
    # lashings at the top bar
    for x in (-1.0, -0.5, 0.0, 0.5, 1.0):
        P.append(box('lash', (0.1, 0.2, 0.2), (x, 0, 5.0), 'rope_dark'))
    finish(root, P)
    climb_quad(root, 'CLIMB_net', 2.8, 0.0, 5.0, -0.05)
    return root


def make_ladder():
    root = new_piece('ladder')
    P = []
    y = -0.25
    for s in (-1, 1):
        P.append(box('rail', (0.08, 0.09, 4.0), (s * 0.41, y, 2.0), 'yellow'))
        for z in (0.6, 3.4):
            P.append(box('standoff', (0.07, 0.24, 0.07), (s * 0.41, y / 2 - 0.005, z), 'steel_dark'))
            P.append(box('plate', (0.16, 0.04, 0.2), (s * 0.41, -0.02, z), 'steel_dark'))
    for k in range(10):
        P.append(S(cylinder('rung', r=0.042, h=0.76, loc=(0, y, 0.2 + 0.4 * k), material='yellow_light', segs=6,
                            rot=(0, PI / 2, 0)), 50))
    finish(root, P)
    climb_quad(root, 'CLIMB_ladder', 0.9, 0.0, 4.0, y)
    return root


def make_rope():
    root = new_piece('rope')
    P = []
    # three-strand twisted rope: lobed cross-section that twists along the length
    bm = bmesh.new()
    L, step = 6.0, 0.2
    nr = int(round(L / step))
    rings = []
    for k in range(nr + 1):
        z = -step * k
        tw = RAD(30.0) * k
        ring = []
        for i in range(6):
            a = tw + 2 * PI * i / 6
            r = 0.105 if i % 2 == 0 else 0.07
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for k in range(nr):
        a, b = rings[k + 1], rings[k]          # a = lower ring
        for i in range(6):
            j = (i + 1) % 6
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = i % 2
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    rope = obj_from_bmesh('rope', bm)
    rope.data.materials.append(mat('rope'))
    rope.data.materials.append(mat('rope_dark'))
    P.append(S(rope, 35))
    for z in (-1.2, -2.4, -3.6, -4.8):
        P.append(S(uv_sphere('knot', 0.2, (0, 0, z), 'rope', segs=8, rings=5, scale=(1, 1, 0.8)), 80))
    P.append(S(cylinder('whip_top', r=0.125, h=0.2, loc=(0, 0, -0.12), material='red', segs=8), 40))
    P.append(S(cylinder('whip_bot', r=0.125, h=0.16, loc=(0, 0, -5.62), material='red', segs=8), 40))
    P.append(S(lathe2('fray', [(0.17, -6.0), (0.11, -5.7)], 8, mats='rope', cap_bottom='rope_dark'), 40))
    P.append(S(torus('ring', 0.13, 0.04, 12, 5, 'steel', loc=(0, 0, 0.13), rot=(PI / 2, 0, 0)), 60))
    finish(root, P)
    c = bake(cylinder('CLIMBPOLE_rope', r=0.1, h=6.0, loc=(0, 0, -3.0), segs=8))
    c.parent = root
    return root


# ----------------------------------------------------------------------------- bouncy / boxes

def make_trampoline():
    root = new_piece('trampoline')
    P = []
    prof = [(1.20, 0.0), (1.24, 0.07), (1.30, 0.42), (1.30, 0.555), (1.255, 0.6), (1.03, 0.6), (0.99, 0.57),
            (0.87, 0.57), (0.81, 0.57), (0.0, 0.57)]
    names = ['blue_dark', None, 'yellow', 'yellow', 'yellow', 'yellow', 'pod_dark', 'grey_dark', 'pod_dark']

    def mf(k, i):
        if k == 1:
            return 'red' if (i // 2) % 2 == 0 else 'cream'
        return names[k]
    P.append(S(lathe2('drum', prof, 32, mat_fn=mf, cap_bottom='blue_dark'), 30))
    P.append(prism_xy('star', star_pts(0, 0, 0.6, 0.27, rot=90), 0.56, 0.585, 'yellow'))
    finish(root, P)
    col_cyl(root, 1.3, 0.0, 0.6)
    return root


def make_crate():
    root = new_piece('crate')
    P = [box('panels', (1.1, 1.1, 1.1), (0, 0, 0.6), 'wood_light')]
    b, e = 0.16, 0.52
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box('bat_v', (b, b, 1.2), (sx * e, sy * e, 0.6), 'wood', bevel_w=0.02))
    for z in (0.08, 1.12):
        for s in (-1, 1):
            P.append(box('bat_x', (1.2 - 2 * b + 0.04, b, b), (0, s * e, z), 'wood', bevel_w=0.02))
            P.append(box('bat_y', (b, 1.2 - 2 * b + 0.04, b), (s * e, 0, z), 'wood', bevel_w=0.02))
    # diagonal braces on the four sides, plank seams on top
    for k in range(4):
        d = box('brace', (1.3, 0.05, 0.14), (0, -0.565, 0.6), 'wood', rot=(0, PI / 4 * (1 if k % 2 == 0 else -1), 0))
        apply_transforms(d, location=True)
        d.rotation_euler = (0, 0, k * PI / 2)
        P.append(d)
    for x in (-0.18, 0.18):
        P.append(box('seam', (0.035, 0.9, 0.02), (x, 0, 1.15), 'wood'))
    finish(root, P)
    col_box(root, (1.2, 1.2, 1.2), (0, 0, 0.6))
    return root


def make_gift_box():
    root = new_piece('gift_box')
    P = []
    P.append(S(box('body', (1.5, 1.5, 0.74), (0, 0, 0.37), 'tint_main', bevel_w=0.03), 30))
    P.append(S(box('lid', (1.6, 1.6, 0.28), (0, 0, 0.86), 'tint_main', bevel_w=0.03), 30))
    rx, ry, rw = 0.38, 0.34, 0.24
    # ribbon: around the body and over the lid, crossing off-centre (toward the back right)
    P.append(box('rib_y_body', (rw, 1.54, 0.73), (rx, 0, 0.365), 'yellow'))
    P.append(box('rib_y_lid', (rw, 1.64, 0.30), (rx, 0, 0.87), 'yellow'))
    P.append(box('rib_x_body', (1.54, rw, 0.73), (0, ry, 0.365), 'yellow'))
    P.append(box('rib_x_lid', (1.64, rw, 0.30), (0, ry, 0.87), 'yellow'))
    # small bow at the crossing
    for s in (-1, 1):
        loop = uv_sphere('loop', 0.17, (0, 0, 0), 'yellow', segs=8, rings=6, scale=(1.25, 0.62, 0.72))
        loop.rotation_euler = (0, -s * RAD(28), RAD(35))
        loop.location = (rx + s * 0.17 * math.cos(RAD(35)), ry + s * 0.17 * math.sin(RAD(35)), 1.13)
        P.append(S(loop, 80))
        tail = box('bow_tail', (0.34, 0.14, 0.05), (0, 0, 0), 'yellow')
        tail.rotation_euler = (0, 0, RAD(35 - 90 + s * 32))
        tail.location = (rx + 0.20 * math.cos(RAD(-55 + s * 32)), ry + 0.20 * math.sin(RAD(-55 + s * 32)), 1.035)
        P.append(tail)
    P.append(S(sphere('bow_knot', 0.095, (rx, ry, 1.10), 'orange', subdiv=1), 180))
    finish(root, P)
    col_box(root, (1.6, 1.6, 1.0), (0, 0, 0.5))
    return root


def speaker_cone(name, R, loc):
    prof = [(R, 0.0), (R, 0.045), (R - 0.05, 0.06), (R - 0.11, 0.035), (0.34 * R, 0.008), (0.24 * R, 0.045),
            (0.0, 0.06)]
    mats = ['steel_dark', 'steel_dark', 'steel_dark', 'grey_dark', 'grey_light', 'grey_light']
    ob = lathe2(name, prof, 16, mats=mats, loc=loc, rot=(PI / 2, 0, 0))
    return S(ob, 35)


def make_speaker_stack():
    root = new_piece('speaker_stack')
    P = []
    yf = -0.57                          # recessed baffle plane; the cabinet frame comes out to y = -0.65
    hx, zt = 0.79, 2.39                 # cabinet 0.01 inside the envelope; the steel corners reach it exactly
    P.append(box('cab', (2 * hx, 1.21, zt), (0, 0.035, zt / 2), 'pod_dark'))
    fw = 0.1
    P.append(box('fr_l', (fw, 0.07, zt), (-hx + fw / 2, -0.605, zt / 2), 'pod_dark'))
    P.append(box('fr_r', (fw, 0.07, zt), (hx - fw / 2, -0.605, zt / 2), 'pod_dark'))
    P.append(box('fr_b', (2 * hx - 2 * fw, 0.07, fw), (0, -0.605, fw / 2), 'pod_dark'))
    P.append(box('fr_t', (2 * hx - 2 * fw, 0.07, fw), (0, -0.605, zt - fw / 2), 'pod_dark'))
    P.append(box('baffle', (1.4, 0.03, 2.2), (0, yf, 1.2), 'black_rubber'))
    yb = yf - 0.015
    P.append(speaker_cone('woofer', 0.56, (0, yb, 0.74)))
    P.append(speaker_cone('mid', 0.37, (0, yb, 1.75)))
    # horn slot and power light on the top strip
    P.append(box('horn', (0.5, 0.05, 0.1), (-0.32, yb - 0.01, 2.2), 'steel_dark'))
    P.append(box('horn_in', (0.4, 0.05, 0.04), (-0.32, yb - 0.02, 2.2), 'grey_light'))
    P.append(S(sphere('led', 0.045, (0.52, yb - 0.01, 2.2), 'glow_green', subdiv=1), 180))
    P.append(box('badge', (0.26, 0.04, 0.09), (0.24, yb - 0.005, 2.2), 'red'))
    # steel corner protectors (flush with the 1.6 x 1.3 x 2.4 envelope)
    c = 0.16
    for sx in (-1, 1):
        for sz in (0, 1):
            for sy in (-1, 1):
                P.append(box('corner', (c, c, c), (sx * (0.8 - c / 2), sy * (0.65 - c / 2),
                                                   c / 2 if sz == 0 else 2.4 - c / 2), 'steel'))
    # side handles
    for sx in (-1, 1):
        P.append(box('handle_bg', (0.02, 0.42, 0.2), (sx * 0.79, 0.05, 1.55), 'black_rubber'))
        P.append(box('handle', (0.05, 0.34, 0.06), (sx * 0.805, 0.05, 1.55), 'steel'))
    finish(root, P)
    col_box(root, (1.6, 1.3, 2.4), (0, 0, 1.2))
    return root


# ----------------------------------------------------------------------------- plaza props

def scallop(name, x0, x1, zt, y0, y1, material, drop=0.07, depth=0.17):
    pts = [(x1, zt), (x0, zt)]
    for t in (0.0, 0.25, 0.5, 0.75, 1.0):
        pts.append((x0 + (x1 - x0) * t, zt - drop - depth * math.sin(PI * t)))
    return prism_xz(name, pts, y0, y1, material)


def make_kiosk():
    root = new_piece('kiosk')
    P = []
    P.append(box('low', (3.0, 2.2, 1.1), (0, 0, 0.55), 'teal'))
    P.append(box('core', (3.0, 1.85, 2.2), (0, 0.175, 2.2), 'cream'))
    P.append(box('fr_up', (3.0, 0.35, 0.9), (0, -0.925, 2.85), 'cream'))
    for s in (-1, 1):
        P.append(box('pillar', (0.3, 0.35, 1.3), (s * 1.35, -0.925, 1.75), 'cream'))
    P.append(box('inside', (2.4, 0.04, 1.3), (0, -0.76, 1.75), 'window_dark'))
    P.append(box('belt', (3.06, 2.26, 0.1), (0, 0, 1.1), 'white_paint'))
    P.append(box('plinth', (3.08, 2.28, 0.14), (0, 0, 0.07), 'blue_dark'))
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box('post', (0.2, 0.2, 3.3), (sx * 1.5, sy * 1.1, 1.65), 'white_paint'))
    # counter
    P.append(S(box('counter', (3.3, 0.56, 0.1), (0, -1.02, 1.17), 'wood', bevel_w=0.02), 30))
    for s in (-1, 1):
        P.append(prism_xz('bracket', [(-1.28, 1.12), (-0.86, 1.12), (-0.86, 0.72)], 0, 0.1, 'wood_dark'))
        br = P[-1]
        br.rotation_euler = (0, 0, PI / 2)       # the prism's X axis now runs along Y
        br.location = (s * 1.15 + 0.05, -0.02, 0)
    # striped roof slab: flat top at Z = 3.6
    n = 8
    w = 3.4 / n
    cols = ('red', 'cream')
    for i in range(n):
        x = -1.7 + w * (i + 0.5)
        P.append(box('roof', (w, 2.6, 0.3), (x, 0, 3.45), cols[i % 2]))
        P.append(scallop('val_f', x - w / 2, x + w / 2, 3.3, -1.25, -1.19, cols[i % 2]))
    m = 6
    d = 2.6 / m
    for i in range(m):
        for s in (-1, 1):
            sc = scallop('val_s', -1.3 + d * i, -1.3 + d * (i + 1), 3.3, -1.65, -1.59, cols[(i + (0 if s < 0 else 1)) % 2])
            sc.rotation_euler = (0, 0, s * PI / 2)     # front (-Y) turns to +X for s = +1, -X for s = -1
            P.append(sc)
    # bulbs under the front valance
    for i in range(1, n):
        P.append(S(sphere('bulb', 0.07, (-1.7 + w * i, -1.23, 3.2), 'glow_warm', subdiv=1), 180))
    # back door and side windows
    P.append(box('door', (0.9, 0.05, 1.9), (0.55, 1.105, 1.09), 'blue_dark'))
    P.append(box('door_win', (0.5, 0.05, 0.5), (0.55, 1.115, 1.6), 'window_dark'))
    P.append(S(sphere('door_knob', 0.06, (0.22, 1.15, 1.05), 'yellow', subdiv=1), 180))
    for s in (-1, 1):
        P.append(box('win_frame', (0.05, 0.96, 0.8), (s * 1.505, 0.15, 2.1), 'white_paint'))
        P.append(box('win', (0.05, 0.8, 0.64), (s * 1.515, 0.15, 2.1), 'window_dark'))
        P.append(box('win_bar', (0.05, 0.06, 0.64), (s * 1.525, 0.15, 2.1), 'white_paint'))
    # sign with a fish
    zsg = 2.74
    P.append(box('sign_frame', (2.44, 0.04, 0.72), (0, -1.12, zsg), 'yellow'))
    P.append(box('sign', (2.30, 0.06, 0.58), (0, -1.13, zsg), 'blue_dark'))
    P += fish_parts(-0.05, zsg, 1.12, -1.19, -1.15, 'fish_orange')
    for (bx, bz, br_) in ((0.78, zsg + 0.1, 0.06), (0.93, zsg - 0.04, 0.04), (0.86, zsg + 0.2, 0.03)):
        P.append(prism_xz('bubble', ellipse(bx, bz, br_, br_, 8), -1.18, -1.15, 'water_light'))
    for (bx, bz) in ((-0.95, zsg + 0.13), (-0.98, zsg - 0.14)):
        P.append(prism_xz('sparkle', star_pts(bx, bz, 0.08, 0.035, n=4, rot=0), -1.18, -1.15, 'yellow'))
    # goods: fish crackers hanging in the window, a popcorn box and a cup on the counter
    for x in (-0.75, 0.0, 0.75):
        P += fish_parts(x, 2.02, 0.42, -0.90, -0.85, 'fish_orange', eye=False)
        P.append(rod('fish_str', (x + 0.04, -0.875, 2.1), (x + 0.04, -0.875, 2.4), r=0.02, segs=4,
                     material='cream'))
    P.append(tbox('popcorn', 0.2, 0.2, 0.28, 0.28, 1.22, 1.55, 'red', loc=(-0.95, -0.98, 0)))
    P.append(S(sphere('pop', 0.15, (-0.95, -0.98, 1.56), 'yellow_light', subdiv=1, scale=(1, 1, 0.7)), 60))
    P.append(S(lathe2('cup', [(0.07, 1.22), (0.1, 1.46)], 8, mats='teal', cap_top='cream',
                      loc=(1.0, -1.0, 0)), 40))
    finish(root, P)
    col_box(root, (3.4, 2.6, 3.6), (0, 0, 1.8))
    return root


def make_fountain():
    root = new_piece('fountain')
    P = []
    P.append(S(lathe2('rim', [(3.0, 0.0), (3.0, 0.12), (3.0, 0.34), (3.0, 0.44), (2.94, 0.5), (2.66, 0.5),
                              (2.6, 0.44), (2.6, 0.2)], 32,
                      mats=['concrete', 'teal', 'concrete_light', 'concrete_light', 'concrete_light',
                            'concrete_light', 'concrete_light']), 30))
    # water with two ripple rings, one flat surface at Z = 0.35
    P.append(S(lathe2('water', [(2.62, 0.1), (2.62, 0.35), (2.0, 0.35), (1.88, 0.35), (1.3, 0.35), (1.18, 0.35),
                                (0.5, 0.35)], 32,
                      mats=['water', 'water', 'water_light', 'water', 'water_light', 'water']), 30))
    # centre column with a bowl (rim at Z = 1.6) and a little bubbling jet
    prof = [(0.66, 0.0), (0.66, 0.44), (0.52, 0.54), (0.34, 0.62), (0.26, 0.78), (0.26, 1.04), (0.38, 1.2),
            (0.96, 1.46), (1.0, 1.6), (0.9, 1.6), (0.86, 1.53), (0.24, 1.53), (0.2, 1.74), (0.0, 1.86)]
    mats = ['concrete', 'concrete', 'concrete_light', 'concrete_light', 'concrete_light', 'concrete_light',
            'concrete_light', 'teal', 'concrete_light', 'concrete_light', 'water', 'water_light', 'water_light']
    P.append(S(lathe2('column', prof, 16, mats=mats), 35))
    finish(root, P)
    c = lathe2('COL_fountain_rim', [(2.6, 0.0), (3.0, 0.0), (3.0, 0.5), (2.6, 0.5)], 16, closed=True)
    c.parent = root
    c = lathe2('COL_fountain_column', [(0.66, 0.0), (0.66, 0.45), (0.3, 0.62), (0.3, 1.1), (1.0, 1.5), (1.0, 1.6)],
               12, cap_bottom=True, cap_top=True)
    c.parent = root
    return root


def make_lamp_post():
    root = new_piece('lamp_post')
    P = []
    g = 'pine_dark'
    prof = [(0.30, 0.0), (0.30, 0.12), (0.21, 0.2), (0.17, 0.7), (0.12, 0.78), (0.085, 0.95), (0.075, 3.72),
            (0.15, 3.76), (0.15, 3.88), (0.07, 3.94), (0.05, 4.3), (0.1, 4.36), (0.1, 4.42), (0.0, 4.6)]
    P.append(S(lathe2('post', prof, 10, mats=g, cap_bottom=True), 35))
    P.append(S(lathe2('band', [(0.195, 0.6), (0.195, 0.68)], 10, mats='gold'), 35))
    for s in (-1, 1):
        P.append(S(tube('arm', [(0, 0, 3.5), (s * 0.3, 0, 3.36), (s * 0.6, 0, 3.42), (s * 0.74, 0, 3.66)],
                        r=0.05, segs=8, material=g), 50))
        P.append(S(lathe2('cup', [(0.06, 3.62), (0.2, 3.78), (0.2, 3.84)], 10, mats=g, cap_top=True,
                          loc=(s * 0.74, 0, 0)), 35))
        P.append(S(uv_sphere('globe', 0.3, (s * 0.74, 0, 4.08), 'glow_warm', segs=12, rings=8), 180))
        P.append(S(lathe2('hat', [(0.14, 4.34), (0.04, 4.46)], 8, mats=g, cap_top=True, loc=(s * 0.74, 0, 0)), 35))
    finish(root, P)
    col_cyl(root, 0.15, 0.0, 4.6, segs=8)
    return root


def make_bench():
    root = new_piece('bench')
    P = []
    for y in (-0.2, 0.0, 0.2):
        P.append(S(box('slat', (2.0, 0.17, 0.08), (0, y, 0.56), 'wood', bevel_w=0.015), 30))
    for z, y in ((0.84, 0.335), (1.08, 0.375)):
        P.append(S(box('back', (2.0, 0.08, 0.19), (0, y, z), 'wood', rot=(RAD(-9), 0, 0), bevel_w=0.015), 30))
    g = 'pine_dark'
    for s in (-1, 1):
        x = s * 0.78
        P.append(box('leg_f', (0.1, 0.1, 0.52), (x, -0.22, 0.26), g))
        P.append(box('leg_b', (0.1, 0.1, 1.18), (x, 0.40, 0.59), g, rot=(RAD(-9), 0, 0)))
        P.append(box('under', (0.1, 0.66, 0.09), (x, 0.03, 0.475), g))
        P.append(box('arm', (0.12, 0.62, 0.08), (x, 0.03, 0.9), g))
        P.append(box('arm_post', (0.09, 0.09, 0.4), (x, -0.22, 0.7), g))
        P.append(box('foot_f', (0.14, 0.18, 0.06), (x, -0.22, 0.03), g))
        P.append(box('foot_b', (0.14, 0.18, 0.06), (x, 0.49, 0.03), g))
    finish(root, P)
    col_box(root, (2.0, 0.6, 0.12), (0, 0, 0.54))
    return root


def make_fence():
    root = new_piece('fence')
    P = []
    for s in (-1, 1):
        P.append(S(box('post', (0.17, 0.17, 0.86), (s * 1.3954, 0, 0.43), 'red', bevel_w=0.02), 30))
        P.append(S(sphere('cap', 0.11, (s * 1.3954, 0, 0.89), 'yellow', subdiv=2), 180))
    for z in (0.26, 0.64):
        P.append(box('rail', (2.7, 0.07, 0.1), (0, 0.035, z), 'white_paint'))
    n = 9
    for i in range(n):
        x = -1.1 + 2.2 * i / (n - 1)
        P.append(prism_xz('picket', [(x - 0.105, 0.05), (x + 0.105, 0.05), (x + 0.105, 0.74), (x, 0.87),
                                     (x - 0.105, 0.74)], -0.06, 0.0, 'cream' if i % 2 == 0 else 'teal'))
    finish(root, P)
    return root


def make_flag_pole():
    root = new_piece('flag_pole')
    P = []
    P.append(S(lathe2('pole', [(0.26, 0.0), (0.26, 0.2), (0.14, 0.32), (0.085, 0.5), (0.06, 6.74)], 10,
                      mats=['grey', 'grey', 'white_paint', 'white_paint'], cap_top=True), 35))
    P.append(S(sphere('ball', 0.13, (0, 0, 6.87), 'gold', subdiv=2), 180))
    # Finnish flag 18 x 11 units: blue cross 3 wide, 5 units from the hoist, 4 from top and bottom
    u = 1.4 / 11
    cols_u = [0, 1.25, 2.5, 3.75, 5, 6.5, 8, 9.67, 11.33, 13, 14.67, 16.33, 18]
    rows_u = [0, 4, 7, 11]
    x0, zb, T = 0.05, 6.6 - 1.4, 0.05

    def yw(cu):
        return 0.14 * math.sin(cu * u * 3.4) * min(1.0, cu / 4.0) * (0.55 + 0.45 * cu / 18)

    bm = bmesh.new()
    F = [[bm.verts.new((x0 + cu * u, yw(cu) - T / 2, zb + ru * u)) for ru in rows_u] for cu in cols_u]
    B = [[bm.verts.new((x0 + cu * u, yw(cu) + T / 2, zb + ru * u)) for ru in rows_u] for cu in cols_u]
    nc, nr = len(cols_u) - 1, len(rows_u) - 1

    def cell_mat(i, j):
        cu = (cols_u[i] + cols_u[i + 1]) / 2
        ru = (rows_u[j] + rows_u[j + 1]) / 2
        return 1 if (5 < cu < 8 or 4 < ru < 7) else 0

    for i in range(nc):
        for j in range(nr):
            m = cell_mat(i, j)
            bm.faces.new((F[i][j], F[i + 1][j], F[i + 1][j + 1], F[i][j + 1])).material_index = m
            bm.faces.new((B[i][j + 1], B[i + 1][j + 1], B[i + 1][j], B[i][j])).material_index = m
        bm.faces.new((F[i][0], B[i][0], B[i + 1][0], F[i + 1][0])).material_index = cell_mat(i, 0)
        bm.faces.new((F[i + 1][nr], B[i + 1][nr], B[i][nr], F[i][nr])).material_index = cell_mat(i, nr - 1)
    for j in range(nr):
        bm.faces.new((F[nc][j], B[nc][j], B[nc][j + 1], F[nc][j + 1])).material_index = cell_mat(nc - 1, j)
        bm.faces.new((F[0][j + 1], B[0][j + 1], B[0][j], F[0][j])).material_index = cell_mat(0, j)
    flag = obj_from_bmesh('flag', bm)
    flag.data.materials.append(mat('white_paint'))
    flag.data.materials.append(mat('blue_dark'))
    P.append(S(flag, 50))
    for z in (6.52, 5.28):
        P.append(box('clip', (0.12, 0.09, 0.07), (0.05, 0, z), 'gold'))
    finish(root, P)
    return root


# ----------------------------------------------------------------------------- fireworks, instanced bits

def make_firework_fountain():
    root = new_piece('firework_fountain')
    P = []
    prof = [(0.25, 0.0), (0.25, 0.07), (0.215, 0.09), (0.19, 0.24), (0.165, 0.39), (0.14, 0.54), (0.115, 0.69),
            (0.13, 0.71), (0.13, 0.8), (0.075, 0.8), (0.075, 0.74), (0.0, 0.74)]
    mats = ['blue_dark', 'blue_dark', 'red', 'cream', 'red', 'cream', 'gold', 'gold', 'gold', 'black_rubber',
            'black_rubber']
    P.append(S(lathe2('cone', prof, 12, mats=mats, cap_bottom=True), 35))
    P.append(S(tube('fuse', [(0.2, 0, 0.1), (0.31, 0.02, 0.16), (0.36, -0.03, 0.26)], r=0.022, segs=4,
                    material='cream'), 60))
    for k in range(3):
        a = RAD(-90 + 120 * k)
        st = prism_xz('star', star_pts(0, 0.31, 0.075, 0.034), -0.196, -0.13, 'yellow')
        st.rotation_euler = (0, 0, a + PI / 2)
        P.append(st)
    finish(root, P)
    part_empty(root, 'emit', (0, 0, 0.8))
    return root


def make_firework_mortar():
    root = new_piece('firework_mortar')
    P = []
    P.append(S(box('base', (1.2, 0.5, 0.1), (0, 0, 0.05), 'wood', bevel_w=0.015), 30))
    for sy in (-1, 1):
        P.append(box('rail', (1.2, 0.06, 0.1), (0, sy * 0.21, 0.46), 'wood_dark'))
        for sx in (-1, 1):
            P.append(box('post', (0.08, 0.07, 0.44), (sx * 0.56, sy * 0.21, 0.3), 'wood_dark'))
    for x, col in ((-0.36, 'red'), (0.0, 'teal'), (0.36, 'yellow')):
        prof = [(0.15, 0.1), (0.15, 0.56), (0.15, 0.7), (0.15, 0.9), (0.11, 0.9), (0.11, 0.8), (0.0, 0.8)]
        P.append(S(lathe2('tube', prof, 10, mats=[col, 'cream', col, col, 'black_rubber', 'black_rubber'],
                          loc=(x, 0, 0)), 35))
    finish(root, P)
    part_empty(root, 'emit', (0, 0, 0.9))
    return root


def make_string_bulb():
    root = new_piece('string_bulb')
    P = [S(sphere('bulb', 0.13, (0, 0, -0.19), 'glow_warm', subdiv=1), 180)]
    P.append(S(lathe2('cap', [(0.066, -0.085), (0.046, 0.0)], 5, mats='pod_dark', cap_top=True), 40))
    finish(root, P)
    return root


def make_bunting_flag():
    root = new_piece('bunting_flag')
    P = [prism_xz('flag', [(-0.25, 0.0), (0.0, -0.6), (0.25, 0.0)], -0.015, 0.015, 'tint_main')]
    finish(root, P)
    return root


# ----------------------------------------------------------------------------- cat perch

def make_cat_perch():
    root = new_piece('cat_perch')
    P = []
    rim = 'cardboard'
    P.append(S(lathe2('pad', [(0.78, -0.2), (0.92, -0.19), (0.95, -0.15), (0.95, -0.04), (0.92, 0.0), (0.80, 0.0)],
                      24, mats=[rim] * 5, cap_top='cream', cap_bottom='wood_dark'), 30))
    # paw print woven into the carpet (toes toward +Y so it reads upright from the camera side)
    for poly in paw_polys(0.0, 0.03, 0.82):
        P.append(prism_xy('paw', poly, -0.01, 0.012, 'wood_light'))
    # sisal-wrapped post, 1.6 long below the platform
    n = 16
    prof = [(0.21 + (0.012 if k % 2 == 0 else -0.004), -1.8 + 0.1 * k) for k in range(n + 1)]
    P.append(S(lathe2('post', prof, 12, mats=['rope' if k % 2 == 0 else 'rope_dark' for k in range(n)],
                      cap_bottom='rope_dark'), 60))
    P.append(S(lathe2('collar', [(0.3, -0.3), (0.34, -0.26), (0.34, -0.2)], 12, mats='wood_dark',
                      cap_bottom=True), 35))
    P.append(S(lathe2('clamp', [(0.27, -1.84), (0.27, -1.66), (0.23, -1.62)], 12, mats='steel_dark',
                      cap_bottom=True), 35))
    finish(root, P)

    # toy mouse dangling from the rim: separate child so the game can swing it (origin = attachment point)
    A = Vector((-0.63, -0.66, -0.19))
    M = []
    M.append(rod('string', (0, 0, 0.02), (0, 0, -0.52), r=0.02, segs=4, material='red'))
    M.append(S(uv_sphere('body', 0.135, (0, 0, -0.64), 'grey', segs=10, rings=6, scale=(1.5, 1.0, 1.0)), 180))
    for sy in (-1, 1):
        ear = uv_sphere('ear', 0.075, (-0.085, sy * 0.085, -0.535), 'ear_pink', segs=8, rings=4, scale=(0.45, 1, 1))
        ear.rotation_euler = (0, RAD(-20), 0)
        M.append(S(ear, 180))
        M.append(S(sphere('eye', 0.026, (-0.165, sy * 0.06, -0.60), 'eye_dark', subdiv=1), 180))
    M.append(S(sphere('nose', 0.034, (-0.21, 0, -0.645), 'nose_pink', subdiv=1), 180))
    M.append(S(tube('tail', [(0.17, 0, -0.64), (0.3, 0, -0.6), (0.37, 0.03, -0.68), (0.45, 0.0, -0.62)],
                    r=0.022, segs=4, material='nose_pink'), 60))
    mouse = merge('cat_perch_mouse', M)
    mouse.data.transform(Matrix.Rotation(RAD(-28), 4, 'Z'))     # rest rotation stays identity
    mouse.location = A
    mouse.parent = root
    mouse['part'] = 'mouse'
    col_cyl(root, 0.95, -0.2, 0.0)
    return root


# ----------------------------------------------------------------------------- build

make_balloon()
make_balloon_bunch()
make_hot_air_balloon()
make_lantern()
make_banner('banner', 8.0, BANNER_LONG)
make_banner('banner_short', 4.0, BANNER_SHORT)
make_net()
make_ladder()
make_rope()
make_trampoline()
make_crate()
make_gift_box()
make_speaker_stack()
make_kiosk()
make_fountain()
make_lamp_post()
make_bench()
make_fence()
make_flag_pole()
make_firework_fountain()
make_firework_mortar()
make_string_bulb()
make_bunting_flag()
make_cat_perch()


# ----------------------------------------------------------------------------- measurements and spec checks

def is_helper(o):
    return o.name.startswith(('COL_', 'CLIMB'))


def local_bounds(root, objs):
    bpy.context.view_layer.update()
    inv = root.matrix_world.inverted()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        m = inv @ o.matrix_world
        for v in o.data.vertices:
            w = m @ v.co
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def fmt(v):
    return '(' + ', '.join(f'{c:+.3f}' for c in v) + ')'


def winding_problems(ob):
    """Islands whose faces point inward (the game culls back faces) or that have inconsistent winding."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    seen, out = set(), []
    for f0 in bm.faces:
        if f0 in seen:
            continue
        island, stack = [f0], [f0]
        seen.add(f0)
        while stack:
            f = stack.pop()
            for e in f.edges:
                for g in e.link_faces:
                    if g not in seen:
                        seen.add(g)
                        island.append(g)
                        stack.append(g)
        edges = {e for f in island for e in f.edges}
        closed = all(len(e.link_faces) == 2 for e in edges)
        mixed = sum(1 for e in edges if len(e.link_faces) == 2 and not e.is_contiguous)
        c = sum((f.calc_center_median() for f in island), Vector()) / len(island)
        vol = sum((f.calc_center_median() - c).dot(f.normal) * f.calc_area() for f in island) / 3
        area = sum(f.calc_area() for f in island)
        if mixed or (closed and vol < 0) or (not closed and vol < -1e-4 * area):
            out.append(f'{ob.name}: island of {len(island)} faces near {fmt(c)} '
                       f'closed={closed} signed volume {vol:+.5f} mixed edges {mixed}')
    bm.free()
    return out


HELPER_EXPECT = {      # name: (lo, hi) relative to the piece root
    'COL_balloon_bunch': ((-1.2, -1.2, -0.8), (1.2, 1.2, 0.0)),
    'COL_hot_air_balloon_crown': ((-1.3, -1.3, -0.3), (1.3, 1.3, 0.0)),
    'COL_hot_air_balloon_envelope': ((-2.2, -2.2, -4.4), (2.2, 2.2, -0.3)),
    'COL_hot_air_balloon_basket': ((-0.55, -0.55, -6.32), (0.55, 0.55, -5.42)),
    'COL_lantern': ((-0.85, -0.85, -1.4), (0.85, 0.85, 0.0)),
    'CLIMB_banner': ((-1.1, -0.06, -8.0), (1.1, -0.06, 0.0)),
    'CLIMB_banner_short': ((-1.1, -0.06, -4.0), (1.1, -0.06, 0.0)),
    'CLIMB_net': ((-1.4, -0.05, 0.0), (1.4, -0.05, 5.0)),
    'CLIMB_ladder': ((-0.45, -0.25, 0.0), (0.45, -0.25, 4.0)),
    'CLIMBPOLE_rope': ((-0.1, -0.1, -6.0), (0.1, 0.1, 0.0)),
    'COL_trampoline': ((-1.3, -1.3, 0.0), (1.3, 1.3, 0.6)),
    'COL_crate': ((-0.6, -0.6, 0.0), (0.6, 0.6, 1.2)),
    'COL_gift_box': ((-0.8, -0.8, 0.0), (0.8, 0.8, 1.0)),
    'COL_speaker_stack': ((-0.8, -0.65, 0.0), (0.8, 0.65, 2.4)),
    'COL_kiosk': ((-1.7, -1.3, 0.0), (1.7, 1.3, 3.6)),
    'COL_fountain_rim': ((-3.0, -3.0, 0.0), (3.0, 3.0, 0.5)),
    'COL_fountain_column': ((-1.0, -1.0, 0.0), (1.0, 1.0, 1.6)),
    'COL_lamp_post': ((-0.15, -0.15, 0.0), (0.15, 0.15, 4.6)),
    'COL_bench': ((-1.0, -0.3, 0.48), (1.0, 0.3, 0.6)),
    'COL_cat_perch': ((-0.95, -0.95, -0.2), (0.95, 0.95, 0.0)),
}
VISIBLE_EXPECT = {     # piece: {axis-limit: value} for the visible meshes, relative to the root
    'balloon_bunch': {'zmax': 0.0},
    'hot_air_balloon': {'zmax': 0.012},
    'banner': {'zmax': 0.794},
    'banner_short': {'zmax': 0.794},
    'net': {'zmin': 0.0},
    'ladder': {'zmin': 0.0, 'zmax': 4.0, 'ymax': 0.0},
    'rope': {'zmin': -6.0},
    'trampoline': {'zmin': 0.0, 'zmax': 0.6, 'xmax': 1.3},
    'crate': {'zmin': 0.0, 'zmax': 1.2, 'xmin': -0.6, 'xmax': 0.6, 'ymin': -0.6, 'ymax': 0.6},
    'gift_box': {'zmin': 0.0, 'xmin': -0.82, 'xmax': 0.82},
    'speaker_stack': {'zmin': 0.0, 'zmax': 2.4, 'ymin': -0.65, 'ymax': 0.65},
    'kiosk': {'zmin': 0.0, 'zmax': 3.6, 'xmin': -1.7, 'xmax': 1.7, 'ymin': -1.3, 'ymax': 1.3},
    'fountain': {'zmin': 0.0, 'xmax': 3.0},
    'lamp_post': {'zmin': 0.0, 'zmax': 4.6},
    'bench': {'zmin': 0.0, 'xmin': -1.0, 'xmax': 1.0},
    'fence': {'zmin': 0.0, 'zmax': 1.0, 'xmin': -1.5, 'xmax': 1.5},
    'flag_pole': {'zmin': 0.0, 'zmax': 7.0},
    'firework_fountain': {'zmin': 0.0, 'zmax': 0.8},
    'firework_mortar': {'zmin': 0.0, 'zmax': 0.9, 'xmin': -0.6, 'xmax': 0.6},
    'string_bulb': {'zmax': 0.0},
    'bunting_flag': {'zmax': 0.0, 'zmin': -0.6, 'xmin': -0.25, 'xmax': 0.25, 'ymin': -0.015, 'ymax': 0.015},
    'cat_perch': {'zmax': 0.012, 'zmin': -1.84},
}
TRI_LIMIT = {'string_bulb': 40, 'bunting_flag': 12}
EMPTY_EXPECT = {'firework_fountain_emit': (0, 0, 0.8), 'firework_mortar_emit': (0, 0, 0.9)}

problems = []
seen_helpers = set()
print('\n[festival] ===== spec check =====')
total_tris = 0
for root in PIECES:
    kids = [o for o in root.children_recursive]
    vis = [o for o in kids if o.type == 'MESH' and not is_helper(o)]
    helpers = [o for o in kids if o.type == 'MESH' and is_helper(o)]
    empties = [o for o in kids if o.type == 'EMPTY']
    vt, ht = sum(tris(o) for o in vis), sum(tris(o) for o in helpers)
    total_tris += vt + ht
    lo, hi = local_bounds(root, vis)
    for o in vis + helpers:
        problems += winding_problems(o)
    print(f'[festival] {root.name:18s} tris {vt:5d} (+{ht:3d} helper)  visible bbox {fmt(lo)} .. {fmt(hi)}')
    if root.name in TRI_LIMIT and vt > TRI_LIMIT[root.name]:
        problems.append(f'{root.name}: {vt} tris > {TRI_LIMIT[root.name]}')
    lim = {'xmin': lo.x, 'ymin': lo.y, 'zmin': lo.z, 'xmax': hi.x, 'ymax': hi.y, 'zmax': hi.z}
    for key, want in VISIBLE_EXPECT.get(root.name, {}).items():
        if abs(lim[key] - want) > 2e-3:
            problems.append(f'{root.name}: visible {key} = {lim[key]:.4f}, expected {want}')
    for h in helpers:
        hlo, hhi = local_bounds(root, [h])
        extra = ''
        if h.name.startswith('CLIMB_'):
            m = (root.matrix_world.inverted() @ h.matrix_world).to_3x3()
            nrm = (m @ h.data.polygons[0].normal).normalized()
            extra = f'  normal {fmt(nrm)}  faces {len(h.data.polygons)}'
            if nrm.dot(Vector((0, -1, 0))) < 0.999 or len(h.data.polygons) != 1:
                problems.append(f'{h.name}: must be one quad facing -Y, normal is {fmt(nrm)}')
        print(f'[festival]     {h.name:30s} {fmt(hlo)} .. {fmt(hhi)}{extra}')
        seen_helpers.add(h.name)
        if h.name in HELPER_EXPECT:
            wlo, whi = HELPER_EXPECT[h.name]
            if any(abs(a - b) > 1e-3 for a, b in zip(tuple(hlo) + tuple(hhi), tuple(wlo) + tuple(whi))):
                problems.append(f'{h.name}: bbox {fmt(hlo)} .. {fmt(hhi)} differs from spec {wlo} .. {whi}')
        else:
            problems.append(f'{h.name}: helper without an expectation')
    for e in empties:
        p = root.matrix_world.inverted() @ e.matrix_world.translation
        print(f'[festival]     empty {e.name:24s} {fmt(p)}  part={e.get("part")}')
        if e.name in EMPTY_EXPECT and (p - Vector(EMPTY_EXPECT[e.name])).length > 1e-4:
            problems.append(f'{e.name}: at {fmt(p)}')
for name in list(HELPER_EXPECT) :
    if name not in seen_helpers:
        problems.append(f'missing helper {name}')
for name in EMPTY_EXPECT:
    if name not in bpy.data.objects:
        problems.append(f'missing empty {name}')
for o in bpy.data.objects:
    if '.0' in o.name:
        problems.append(f'object name with a numeric suffix: {o.name}')
print(f'[festival] total {total_tris} tris in {len(PIECES)} pieces')
for p in problems:
    print('[festival] PROBLEM:', p)
print('[festival] spec check', 'FAILED' if problems else 'OK')


# ----------------------------------------------------------------------------- layout, export, previews

def layout(max_w=34.0, gap=1.6):
    """Spread the roots out (short pieces in front) and stand every piece on the ground for the overview."""
    items = []
    for r in PIECES:
        meshes = [o for o in r.children_recursive if o.type == 'MESH']
        lo, hi = local_bounds(r, meshes)
        items.append((hi.z - lo.z, r, lo, hi))
    items.sort(key=lambda t: t[0])
    x = y = depth = 0.0
    for h, r, lo, hi in items:
        w = hi.x - lo.x
        if x > 0 and x + w > max_w:
            x = 0.0
            y += depth + gap + 0.6
            depth = 0.0
        r.location = (x - lo.x, y - lo.y, -lo.z)
        x += w + gap
        depth = max(depth, hi.y - lo.y)
    bpy.context.view_layer.update()


layout(max_w=24.0)
export_glb('kit_festival.glb')

VIEWS = {     # piece: [(tag, azimuth, elevation, kwargs)]; every piece gets the front 3/4 view first
    'balloon': [('side', -60, 5, {})],
    'balloon_bunch': [('top', 20, 55, {}), ('low', 200, -10, {})],
    'hot_air_balloon': [('front', 0, 8, {}), ('low', 40, -25, {}), ('top', 20, 60, {})],
    'lantern': [('low', 20, -20, {})],
    'banner': [('front', 0, 5, {}), ('side', 75, 10, {})],
    'banner_short': [('front', 0, 5, {})],
    'net': [('front', 0, 10, {})],
    'ladder': [('side', 80, 10, {})],
    'rope': [('top', 20, 10, dict(target_top=True))],
    'trampoline': [('top', 10, 50, {})],
    'gift_box': [('top', -30, 45, {})],
    'speaker_stack': [('front', 0, 10, {})],
    'kiosk': [('front', 0, 15, {}), ('back', 150, 25, {})],
    'fountain': [('top', 20, 45, {})],
    'bench': [('back', 150, 20, {})],
    'flag_pole': [('flag', 10, 5, dict(target_top=True))],
    'cat_perch': [('top', 20, 50, {}), ('low', -30, -5, {})],
}


def solo_preview(root, tag, az, el, res=(720, 540), **kw):
    mine = set(root.children_recursive)
    hidden = []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o not in mine and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    extra = {}
    if kw.pop('target_top', False):
        meshes = [o for o in mine if o.type == 'MESH' and not is_helper(o)]
        lo, hi = local_bounds(root, meshes)
        top = root.matrix_world @ Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z - 0.9))
        extra = dict(target=tuple(top), zoom=(hi - lo).length / 3.2)
    extra.update(kw)
    path = render_preview(f'festival_{root.name}_{tag}.png', [root], azimuth=az, elevation=el, res=res, **extra)
    for o in hidden:
        o.hide_render = False
    return path


def make_sheet(filename, paths, cols=2):
    tiles = []
    for p in paths:
        img = bpy.data.images.load(p)
        w, h = img.size
        arr = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(arr)
        tiles.append(arr.reshape(h, w, 4))
        bpy.data.images.remove(img)
    h, w = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    sheet = np.ones((rows * h, cols * w, 4), np.float32)
    for k, t in enumerate(tiles):
        r, c = divmod(k, cols)
        y0 = (rows - 1 - r) * h
        sheet[y0:y0 + h, c * w:(c + 1) * w] = t
    out = bpy.data.images.new('_sheet', cols * w, rows * h, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(PREVIEW_DIR, filename)
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    print(f'[festival] sheet {filename}: ' + ', '.join(os.path.basename(p)[9:-4] for p in paths))


if PREVIEW != 'none':
    for m_ in bpy.data.materials:          # previews only (after the export): show wrong winding as holes
        m_.use_backface_culling = True
    want = None if PREVIEW == 'all' else set(PREVIEW.split(','))
    paths = []
    for root in PIECES:
        if want is not None and root.name not in want:
            continue
        paths.append(solo_preview(root, '34', 30, 20))
        for (tag, az, el, kw) in VIEWS.get(root.name, []):
            paths.append(solo_preview(root, tag, az, el, **dict(kw)))
    for k in range(0, len(paths), 4):
        make_sheet(f'festival_sheet_{k // 4 + 1:02d}.png', paths[k:k + 4])
    if want is None or 'overview' in want:
        render_preview('festival_overview.png', None, azimuth=18, elevation=24, res=(1500, 900), zoom=1.3)

print('[festival] done')
