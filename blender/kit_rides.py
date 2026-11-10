"""kit_rides.glb: platforms and amusement rides for the lower half of the tower.

Spec: blender/ASSETS.md, section "kit_rides.glb". Run headless:
    blender --background --python blender/kit_rides.py
Environment: RIDES_PREVIEW=none | all (default) | comma list of piece names / "overview" / "assembly".
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from indykit import *
from mathutils.bvhtree import BVHTree
reset_scene()

R = math.radians
mat('tint_main', '#e8443a')
PIECES = {}


# ----------------------------------------------------------------------------- local helpers

class Piece:
    """One kit piece: an empty root, visible parts (joined into one mesh by finish()), COL_ helpers, child empties."""

    def __init__(self, name):
        self.name = name
        self.root = empty(name)
        self.parts = []

    def add(self, ob, angle=35.0):
        if isinstance(ob, (list, tuple)):
            for o in ob:
                self.add(o, angle)
            return ob
        shade(ob, angle)
        self.parts.append(ob)
        return ob

    def bulb(self, loc, material='glow_warm', r=0.13, subdiv=1):
        return self.add(sphere('bulb', r, loc, material, subdiv=subdiv), 180)

    def col_box(self, suffix, size, loc):
        ob = box('COL_' + self.name + suffix, size, loc)
        parent_to(ob, self.root)
        return ob

    def col_cyl(self, suffix, r, h, loc, segs=20):
        ob = cylinder('COL_' + self.name + suffix, r=r, h=h, loc=loc, segs=segs)
        parent_to(ob, self.root)
        return ob

    def finish(self):
        m = join(self.parts, self.name + '_mesh') if len(self.parts) > 1 else self.parts[0]
        m.name = self.name + '_mesh'
        m.data.name = self.name + '_mesh'
        parent_to(m, self.root)
        apply_transforms(m, location=True)
        self.mesh = m
        PIECES[self.name] = self
        return self


def orient(ob, p0, p1, up=(0, 0, 1)):
    """Place ob so its local Z runs from p0 to p1 (centred between them), local Y as close to `up` as possible."""
    p0, p1 = Vector(p0), Vector(p1)
    z = (p1 - p0).normalized()
    upv = Vector(up)
    if abs(z.dot(upv)) > 0.999:
        upv = Vector((0, 1, 0)) if abs(z.y) < 0.9 else Vector((1, 0, 0))
    x = upv.cross(z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = (p0 + p1) / 2
    ob.matrix_world = m
    return ob


def beam(name, p0, p1, w=0.14, d=None, material='steel_dark', up=(0, 0, 1), w1=None, d1=None, bevel_w=0.0):
    """Box beam from p0 to p1. Cross-section: w sideways, d along `up`. w1/d1 taper the p1 end."""
    d = w if d is None else d
    length = (Vector(p1) - Vector(p0)).length
    ob = box(name, (w, d, length), material=material, bevel_w=bevel_w)
    if w1 is not None or d1 is not None:
        sx = (w1 if w1 is not None else w) / w
        sy = (d1 if d1 is not None else d) / d
        for v in ob.data.vertices:
            if v.co.z > 0:
                v.co.x *= sx
                v.co.y *= sy
    return orient(ob, p0, p1, up)


def rod(name, p0, p1, r=0.05, material='steel', segs=6, r1=None):
    length = (Vector(p1) - Vector(p0)).length
    ob = cylinder(name, r=r, h=length, material=material, segs=segs, r_top=r1)
    return orient(ob, p0, p1)


def prism(name, pts, depth, material=None, y0=0.0):
    """Extrude a 2D outline [(x, z), ...] lying in the XZ plane from y = y0 to y0 + depth."""
    bm = bmesh.new()
    f = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y0 + depth, z)) for x, z in pts]
    n = len(pts)
    bm.faces.new(f)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[i], b[i], b[j], f[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bmesh(name, bm, material)


def rrect(hx, hy, r, n=3):
    """Rounded-rectangle outline (CCW), half extents hx, hy, corner radius r, n segments per corner."""
    r = min(r, hx - 1e-4, hy - 1e-4)
    pts = []
    for sx, sy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(n + 1):
            a = R(a0 + 90.0 * k / n)
            pts.append((sx * (hx - r) + r * math.cos(a), sy * (hy - r) + r * math.sin(a)))
    return pts


def rr_z(hx, hy, r, z, n=3, cx=0.0, cy=0.0):
    return [(cx + x, cy + y, z) for x, y in rrect(hx, hy, r, n)]


def rr_x(x, hy, z0, z1, r, n=3):
    cz, hz = (z0 + z1) / 2, (z1 - z0) / 2
    return [(x, y, cz + z) for y, z in rrect(hy, hz, r, n)]


def loft(name, rings, mats=None, caps=(True, True), cap_mats=None, material=None):
    """Skin a list of rings (equal point counts). mats = one material name per band."""
    bm = bmesh.new()
    names = []

    def idx(m):
        if m not in names:
            names.append(m)
        return names.index(m)

    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for k in range(len(vr) - 1):
        mi = idx(mats[k] if mats else material)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((vr[k][i], vr[k][j], vr[k + 1][j], vr[k + 1][i]))
            f.material_index = mi
    first = cap_mats[0] if cap_mats else (mats[0] if mats else material)
    last = cap_mats[1] if cap_mats else (mats[-1] if mats else material)
    if caps[0]:
        bm.faces.new(list(reversed(vr[0]))).material_index = idx(first)
    if caps[1]:
        bm.faces.new(vr[-1]).material_index = idx(last)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bmesh(name, bm)
    for m in names:
        ob.data.materials.append(mat(m))
    return ob


def paint(ob, mats, fn):
    """Per-face materials: fn(face_centre, face_normal) -> index into mats."""
    ob.data.materials.clear()
    for m in mats:
        ob.data.materials.append(mat(m))
    for p in ob.data.polygons:
        p.material_index = fn(p.center, p.normal)
    return ob


def yring(name, r0, r1, y0, y1, segs, material):
    """Ring of rectangular cross-section around the Y axis (a wheel rim in the XZ plane)."""
    ob = lathe(name, [(r0, y0), (r1, y0), (r1, y1), (r0, y1), (r0, y0)], segs=segs, material=material,
               cap_top=False, cap_bottom=False)
    ob.rotation_euler = (R(-90), 0, 0)
    return ob


def arc_band(name, cx, cz, r0, r1, y0, y1, a0, a1, steps, mat_fn):
    """Curved bar in the XZ plane (degrees, 0 = +X, 90 = +Z); mat_fn(step) -> material name."""
    bm = bmesh.new()
    names = []

    def idx(m):
        if m not in names:
            names.append(m)
        return names.index(m)

    rings = []
    for k in range(steps + 1):
        a = R(a0 + (a1 - a0) * k / steps)
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((cx + r * c, y, cz + r * s)) for r, y in ((r0, y0), (r1, y0), (r1, y1), (r0, y1))])
    for k in range(steps):
        mi = idx(mat_fn(k))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i])).material_index = mi
    bm.faces.new(rings[0]).material_index = idx(mat_fn(0))
    bm.faces.new(list(reversed(rings[-1]))).material_index = idx(mat_fn(steps - 1))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bmesh(name, bm)
    for m in names:
        ob.data.materials.append(mat(m))
    return ob


def scallop(name, w, top, straight, drop, material, thick=0.08, m=6):
    """Valance tab in the XZ plane: front face at y = 0 (faces -Y), thickness toward +Y, centred on x = 0."""
    pts = [(-w / 2, top), (-w / 2, top - straight)]
    for k in range(1, m):
        t = math.pi * k / m
        pts.append((-w / 2 * math.cos(t), top - straight - drop * math.sin(t)))
    pts += [(w / 2, top - straight), (w / 2, top)]
    return prism(name, pts, thick, material)


def along(poly, n):
    """n points evenly spaced along a closed 2D polyline."""
    segs, total = [], 0.0
    for i in range(len(poly)):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
        segs.append((a, b, (b - a).length))
        total += segs[-1][2]
    out = []
    for k in range(n):
        d = total * k / n
        for a, b, l in segs:
            if d <= l:
                out.append(a.lerp(b, d / l))
                break
            d -= l
    return out


def garland(P, p0, p1, sag, n, mats=('glow_warm',), r=0.1, rope_r=0.035):
    """A sagging festoon with n bulbs between two points."""
    p0, p1 = Vector(p0), Vector(p1)
    pts = []
    for k in range(n + 2):
        t = k / (n + 1)
        p = p0.lerp(p1, t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(p)
    P.add(tube('garland', pts, r=rope_r, segs=4, material='black_rubber'), 60)
    for k in range(1, n + 1):
        P.bulb(pts[k] - Vector((0, 0, r * 0.8)), mats[k % len(mats)], r)


def tri_bracket(x, y0, z0, reach, drop, w=0.18, material='steel_dark'):
    """Triangular support in the YZ plane: top beam (top at z0) from y0 going `reach` toward +Y,
    diagonal from the tip down to z0 - drop at the far end."""
    t = w
    y1 = y0 + reach
    za, zb = z0 - t * 0.8, z0 - drop + t / 2
    parts = [
        beam('br_top', (x, y0, z0 - t / 2), (x, y1, z0 - t / 2), w, t, material),
        beam('br_diag', (x, y0 + 0.3, za), (x, y1 - 0.05, zb), w * 0.85, t, material),
        beam('br_end', (x, y1 - t / 2, z0 - t), (x, y1 - t / 2, z0 - drop), w * 0.85, t, material),
    ]
    ym = y0 + reach * 0.55
    zm = za + (zb - za) * (ym - y0 - 0.3) / (reach - 0.3)
    parts.append(beam('br_web', (x, ym, z0 - t), (x, ym, zm), w * 0.7, t * 0.7, material))
    return parts


def striped_post(P, x, y, z0, h, r=0.09, band=0.26, mats=('red', 'cream'), globe='glow_warm'):
    n = max(2, round(h / band))
    prof = [(r, z0 + h * k / n) for k in range(n + 1)]
    ob = lathe('post', prof, segs=8, loc=(x, y, 0))
    paint(ob, list(mats), lambda c, nrm: int((c.z - z0) / (h / n) - 1e-4) % 2 if abs(nrm.z) < 0.5 else 0)
    P.add(ob, 60)
    P.add(cylinder('post_foot', r * 1.7, 0.1, (x, y, z0 + 0.05), 'yellow', segs=8), 50)
    P.add(cylinder('post_cap', r * 1.5, 0.08, (x, y, z0 + h + 0.04), 'yellow', segs=8), 50)
    if globe:
        P.bulb((x, y, z0 + h + 0.2), globe, 0.17, subdiv=2)


# ----------------------------------------------------------------------------- platforms

def build_deck(name, W, D, drop, posts=False):
    P = Piece(name)
    n = round(W / 0.4)
    pw = W / n
    for i in range(n):
        P.add(box('plank', (pw, D, 0.12), (-W / 2 + pw * (i + 0.5), 0, -0.06), 'wood' if i % 2 == 0 else 'wood_light'))
    f = box('fascia', (W, D, 0.18), (0, 0, -0.21))
    paint(f, ['yellow', 'wood_dark'], lambda c, nrm: 1 if (nrm.y > 0.5 or abs(nrm.z) > 0.5) else 0)
    P.add(f)
    cols = ('red', 'cream')
    for i in range(n):
        s = scallop('scallop', pw, -0.3, 0.1, 0.25, cols[i % 2])
        s.location = (-W / 2 + pw * (i + 0.5), -D / 2, 0)
        P.add(s)
    ns = round((D - 0.08) / 0.4)
    sw = (D - 0.08) / ns
    for sgn in (-1, 1):
        for i in range(ns):
            s = scallop('scallop', sw, -0.3, 0.1, 0.25, cols[(i + 1) % 2])
            s.location = (sgn * W / 2, -D / 2 + 0.08 + sw * (i + 0.5), 0)
            s.rotation_euler = (0, 0, R(90) * sgn)
            P.add(s)
    xs = W / 2 - 0.45
    y0 = -D / 2 + 0.2
    reach = D / 2 + 3.6 - y0
    for sgn in (-1, 1):
        P.add(tri_bracket(sgn * xs, y0, -0.3, reach, drop))
    P.add(beam('tie', (-xs, y0 + 0.4, -0.39), (xs, y0 + 0.4, -0.39), 0.16, 0.16, 'steel_dark'))
    P.add(beam('tie', (-xs, D / 2 - 0.3, -0.39), (xs, D / 2 - 0.3, -0.39), 0.16, 0.16, 'steel_dark'))
    if posts:
        tops = {}
        for sx in (-1, 1):
            xf = sx * (W / 2 - 0.16)
            striped_post(P, xf, -D / 2 + 0.16, 0, 1.3)
            striped_post(P, xf, D / 2 - 0.16, 0, 2.6)
            tops[sx] = ((xf, -D / 2 + 0.16, 1.3), (xf, D / 2 - 0.16, 2.6))
        lights = ('glow_warm', 'glow_pink', 'glow_warm', 'glow_blue')
        garland(P, tops[-1][1], tops[1][1], 0.55, 9, lights)
        for sx in (-1, 1):
            garland(P, tops[sx][0], tops[sx][1], 0.3, 4, lights)
    P.col_box('', (W, D, 0.3), (0, 0, -0.15))
    return P.finish()


build_deck('deck_s', 2.4, 2.0, 1.5)
build_deck('deck_m', 4.0, 2.4, 1.6)
build_deck('deck_l', 6.0, 3.0, 1.8, posts=True)


def build_deck_round():
    P = Piece('deck_round')
    segs = 32
    prof = [(0.0, -0.76), (1.08, -0.76), (1.08, -0.62), (1.0, -0.62), (1.22, -0.14), (1.3, -0.14), (1.3, 0.0),
            (1.12, 0.0), (0.4, 0.0), (0.0, 0.0)]
    ob = lathe('podium', prof, segs=segs)
    mats = ['red', 'cream', 'yellow', 'red_dark']

    def fn(c, nrm):
        rc = math.hypot(c.x, c.y)
        k = int((math.atan2(c.y, c.x) % (2 * math.pi)) / (2 * math.pi / segs))
        stripe = (k // 2) % 2
        if c.z > -0.001:                      # top: yellow hub, pinwheel, yellow rim
            return 2 if (rc < 0.35 or rc > 1.1) else stripe
        if c.z > -0.15 and rc > 1.2:          # top rim band and its underside step
            return 2
        if -0.62 < c.z < -0.14 and abs(nrm.z) < 0.9:   # tapered drum
            return 1 - stripe
        if c.z < -0.75 and nrm.z < -0.5:
            return 3
        return 2
    paint(ob, mats, fn)
    P.add(ob, 40)
    P.add(cylinder('collar', 0.5, 0.16, (0, 0, -0.84), 'steel_dark', segs=12), 50)
    P.add(tri_bracket(0, -0.3, -0.88, 0.3 + 1.3 + 3.6, 1.5, w=0.28))
    P.col_cyl('', 1.3, 0.76, (0, 0, -0.38), segs=24)
    return P.finish()


build_deck_round()


def build_bracket():
    P = Piece('bracket')
    P.add(tri_bracket(0, 0.1, 0.0, 3.4, 1.2, w=0.2))
    P.add(box('tip', (0.28, 0.1, 0.28), (0, 0.05, -0.14), 'yellow'))
    return P.finish()


build_bracket()


# ----------------------------------------------------------------------------- Ferris wheel

def build_ferris_base():
    P = Piece('ferris_base')
    hub = 10.0
    foot_z, top_z = 0.4, 9.8

    def leg_x(z):
        return 5.0 + (0.45 - 5.0) * (z - foot_z) / (top_z - foot_z)

    for s in (-1, 1):
        P.add(beam('leg', (s * 5.0, 2.3, foot_z), (s * 0.45, 2.3, top_z), 0.95, 0.9, 'teal', up=(0, 1, 0),
                   w1=0.55, d1=0.6))
        P.add(box('foot', (2.0, 1.4, 0.5), (s * 5.1, 2.3, 0.25), 'concrete_dark', bevel_w=0.07))
        P.add(box('foot_band', (1.5, 1.16, 0.22), (s * 5.02, 2.3, 0.6), 'yellow'))
        for k in range(7):
            t = 0.1 + 0.8 * k / 6
            z = foot_z + (top_z - foot_z) * t
            dy = (0.9 + (0.6 - 0.9) * t) / 2
            P.bulb((s * leg_x(z), 2.3 - dy - 0.02, z), 'glow_warm', 0.15)
    for z, w, d in ((3.4, 0.5, 0.42), (7.0, 0.42, 0.36)):
        P.add(beam('tie', (-leg_x(z), 2.3, z), (leg_x(z), 2.3, z), w, d, 'teal'))
    # bearing housing, axle and the front hub cap
    P.add(cylinder('housing', 1.0, 1.4, (0, 2.3, hub), 'yellow', segs=16, rot=(R(90), 0, 0)), 40)
    P.add(cylinder('housing_ring', 1.12, 0.3, (0, 2.3, hub), 'teal', segs=16, rot=(R(90), 0, 0)), 40)
    P.add(cylinder('axle', 0.4, 1.1, (0, 1.15, hub), 'steel_dark', segs=10, rot=(R(90), 0, 0)), 50)
    cap = lathe('hub_cap', [(0.0, 0.45), (0.32, 0.48), (0.58, 0.58), (0.74, 0.74), (0.78, 0.9)], segs=16,
                material='red', loc=(0, 0, hub))
    cap.rotation_euler = (R(-90), 0, 0)
    P.add(cap, 50)
    P.bulb((0, 0.45, hub), 'glow_warm', 0.2, subdiv=2)
    return P.finish()


build_ferris_base()

FERRIS_R = 8.0


def build_ferris_rotor():
    P = Piece('ferris_rotor')
    yc = 1.3                                             # mid plane of the wheel structure
    P.add(yring('rim', 7.74, 8.26, 1.1, 1.5, 48, 'red'), 40)
    P.add(yring('rim_inner', 6.35, 6.6, 1.15, 1.45, 48, 'yellow'), 40)
    P.add(yring('rim_small', 3.3, 3.52, 1.18, 1.42, 32, 'teal'), 40)

    def pt(r, deg, y=yc):
        return (r * math.cos(R(deg)), y, r * math.sin(R(deg)))

    for i in range(8):
        a = 45.0 * i
        P.add(beam('spoke', pt(1.2, a), pt(7.85, a), 0.3, 0.3, 'cream', up=(0, 1, 0)))
        P.add(beam('spoke2', pt(1.2, a + 22.5), pt(7.85, a + 22.5), 0.16, 0.2, 'cream', up=(0, 1, 0)))
        for j, rr in enumerate((2.5, 4.1, 5.3, 6.47)):
            P.bulb(pt(rr, a, 1.13), 'glow_warm' if j % 2 == 0 else 'glow_white', 0.14)
        for j, da in enumerate((11.25, 22.5, 33.75)):
            P.bulb(pt(FERRIS_R, a + da, 1.08), ('glow_pink', 'glow_yellow', 'glow_blue')[j], 0.14)
        # pivot mount and the stub axle that carries a gondola
        P.add(beam('mount', pt(7.68, a, 1.2), pt(8.32, a, 1.2), 0.62, 0.6, 'yellow', up=(0, 1, 0)))
        P.add(rod('stub', pt(FERRIS_R, a, 0.0), pt(FERRIS_R, a, 1.0), 0.13, 'steel', segs=8), 50)
        P.add(rod('stub_collar', pt(FERRIS_R, a, 0.72), pt(FERRIS_R, a, 0.9), 0.24, 'steel_dark', segs=8), 50)
        empty('pivot_%d' % i, pt(FERRIS_R, a, 0.0), parent=P.root)
    for k in range(16):                                   # zigzag lattice between the two rims
        ai = 11.25 + 22.5 * k
        for ao in (ai - 11.25, ai + 11.25):
            P.add(beam('lace', pt(6.55, ai), pt(7.85, ao), 0.14, 0.2, 'cream', up=(0, 1, 0)))
    # hub drum with a sun ornament
    P.add(cylinder('hub', 1.35, 0.5, (0, 1.25, 0), 'red', segs=16, rot=(R(90), 0, 0)), 40)
    star = []
    for k in range(16):
        rr = 2.15 if k % 2 == 0 else 1.2
        star.append((rr * math.cos(R(22.5 * k)), rr * math.sin(R(22.5 * k))))
    P.add(prism('sun', star, 0.1, 'yellow', y0=0.9))
    return P.finish()


build_ferris_rotor()


def uframe_pts(hw, h, cr, y=0.0, n=4):
    """Inverted U in the XZ plane: up from (-hw, -h), along the top bar at z = 0, down to (hw, -h)."""
    pts = [(-hw, y, -h)]
    for k in range(n + 1):
        a = math.pi - (math.pi / 2) * k / n
        pts.append((-hw + cr + cr * math.cos(a), y, -cr + cr * math.sin(a)))
    for k in range(n + 1):
        a = math.pi / 2 - (math.pi / 2) * k / n
        pts.append((hw - cr + cr * math.cos(a), y, -cr + cr * math.sin(a)))
    pts.append((hw, y, -h))
    return pts


def build_ferris_gondola():
    P = Piece('ferris_gondola')
    zf = -2.4
    rings = [
        rr_z(0.80, 0.42, 0.36, zf - 0.84),
        rr_z(1.08, 0.66, 0.46, zf - 0.74),
        rr_z(1.32, 0.88, 0.46, zf - 0.46),
        rr_z(1.42, 0.97, 0.40, zf - 0.16),
        rr_z(1.42, 0.97, 0.40, zf - 0.02),
        rr_z(1.42, 0.97, 0.40, zf + 0.12),
        rr_z(1.30, 0.90, 0.28, zf + 0.12),
        rr_z(1.30, 0.90, 0.28, zf),
    ]
    tub = loft('tub', rings, mats=['tint_main', 'tint_main', 'tint_main', 'cream', 'yellow', 'yellow', 'yellow'],
               cap_mats=('tint_main', 'wood'))
    P.add(tub, 50)
    P.add(tube('uframe', uframe_pts(1.36, 2.36, 0.3), r=0.09, segs=8, material='cream'), 60)
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.add(rod('brace', (sx * 1.36, 0, -1.55), (sx * 1.36, sy * 0.72, zf + 0.1), 0.07, 'cream', segs=6), 60)
        P.add(sphere('knuckle', 0.15, (sx * 1.36, 0, -1.55), 'yellow', subdiv=1), 180)
        P.bulb((sx * 1.2, 0, -0.26), 'glow_warm', 0.13)
    P.add(rod('bearing', (0, -0.2, 0), (0, 0.2, 0), 0.22, 'steel_dark', segs=10), 50)
    P.add(rod('sleeve', (-0.5, 0, 0), (0.5, 0, 0), 0.13, 'yellow', segs=8), 50)
    P.bulb((0, 0, zf - 0.86), 'glow_warm', 0.2, subdiv=2)
    P.col_box('', (2.6, 1.8, 0.3), (0, 0, zf - 0.15))
    return P.finish()


build_ferris_gondola()


# ----------------------------------------------------------------------------- roller coaster car

def build_coaster_car():
    P = Piece('coaster_car')
    secs = [  # x, half width, z low, z high, corner radius
        (-1.10, 0.40, 0.34, 0.62, 0.13),
        (-1.05, 0.55, 0.24, 0.70, 0.16),
        (-0.92, 0.60, 0.18, 0.72, 0.14),
        (0.32, 0.60, 0.18, 0.72, 0.14),
        (0.50, 0.60, 0.18, 0.98, 0.20),
        (0.78, 0.57, 0.20, 0.98, 0.26),
        (0.95, 0.50, 0.25, 0.92, 0.30),
        (1.02, 0.40, 0.32, 0.84, 0.25),
        (1.06, 0.26, 0.42, 0.74, 0.15),
        (1.07, 0.14, 0.50, 0.66, 0.07),
    ]
    body = loft('body', [rr_x(*s) for s in secs], material='tint_main')
    paint(body, ['tint_main', 'grey_dark'], lambda c, nrm: 1 if (nrm.z > 0.9 and -0.95 < c.x < 0.35) else 0)
    P.add(body, 50)
    for sy in (-1, 1):
        P.add(box('wall', (1.54, 0.17, 0.4), (-0.26, sy * 0.52, 0.76), 'tint_main', bevel_w=0.06, bevel_segs=2), 40)
        P.add(box('stripe', (1.5, 0.05, 0.12), (-0.2, sy * 0.59, 0.4), 'cream'))
        for sx in (-0.68, 0.68):
            P.add(cylinder('wheel', 0.24, 0.15, (sx, sy * 0.605, 0.24), 'black_rubber', segs=12, rot=(R(90), 0, 0)), 40)
            P.add(cylinder('hubcap', 0.12, 0.05, (sx, sy * 0.675, 0.24), 'yellow', segs=8, rot=(R(90), 0, 0)), 40)
    P.add(box('chassis', (1.8, 0.9, 0.16), (0, 0, 0.16), 'steel_dark'))
    # seats: backs reach the full 1.1
    for x in (-0.93, -0.2):
        P.add(box('seat_back', (0.2, 0.86, 0.42), (x, 0, 0.89), 'cream', bevel_w=0.07, bevel_segs=2), 40)
        P.add(box('seat', (0.4, 0.86, 0.14), (x + 0.28, 0, 0.77), 'cream', bevel_w=0.05), 40)
    # friendly face, placed on the nose surface by ray casting
    bvh = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices], [tuple(q.vertices) for q in body.data.polygons])

    def nose_x(y, z):
        hit = bvh.ray_cast(Vector((3.0, y, z)), Vector((-1.0, 0.0, 0.0)))[0]
        return hit.x

    lim = 1.1
    for sy in (-1, 1):
        ex = min(nose_x(sy * 0.26, 0.71) - 0.035, lim - 0.19 * 0.62)
        P.add(sphere('eye_bezel', 0.24, (ex, sy * 0.26, 0.71), 'cream', subdiv=2, scale=(0.36, 1, 1)), 180)
        P.add(sphere('eye', 0.19, (ex, sy * 0.26, 0.71), 'glow_yellow', subdiv=2, scale=(0.62, 1, 1)), 180)
        P.add(sphere('pupil', 0.08, (min(ex + 0.105, lim - 0.04), sy * 0.225, 0.715), 'eye_dark', subdiv=2,
                     scale=(0.5, 1, 1)), 180)
        P.add(sphere('tail_light', 0.09, (-1.055, sy * 0.3, 0.5), 'glow_red', subdiv=1, scale=(0.5, 1, 1)), 180)
    smile = []
    for k in range(9):
        y = -0.3 + 0.6 * k / 8
        z = 0.385 + 0.1 * (y / 0.3) ** 2
        smile.append((min(nose_x(y, z) + 0.005, lim - 0.042), y, z))
    P.add(tube('smile', smile, r=0.042, segs=8, material='eye_dark'), 60)
    P.col_box('', (2.2, 1.4, 1.1), (0, 0, 0.55))
    return P.finish()


build_coaster_car()


# ----------------------------------------------------------------------------- drop ride

def build_drop_car():
    P = Piece('drop_car')
    slab = box('floor', (3.0, 1.88, 0.35), (0, 0.06, -0.175))
    paint(slab, ['grey_dark', 'yellow', 'steel_dark'],
          lambda c, nrm: 0 if nrm.z > 0.5 else (2 if nrm.z < -0.5 else 1))
    P.add(slab)
    for i in range(10):                                   # hazard-striped front edge
        P.add(box('hazard', (0.3, 0.12, 0.35), (-1.35 + 0.3 * i, -0.94, -0.175),
                  'yellow' if i % 2 == 0 else 'black_rubber'))
    pod = loft('pod', [rr_z(1.0, 0.55, 0.2, -0.8), rr_z(1.32, 0.82, 0.25, -0.35)], material='steel_dark')
    P.add(pod, 50)
    lights = ('glow_pink', 'glow_yellow')
    for i in range(5):
        P.bulb((-1.2 + 0.6 * i, -0.86, -0.45), lights[i % 2], 0.13)
    for sx in (-1, 1):
        for i, y in enumerate((-0.3, 0.3)):
            P.bulb((sx * 1.36, y, -0.45), lights[(i + 1) % 2], 0.13)
    # padded back panel along the +Y edge
    P.add(box('back_frame', (3.0, 0.18, 1.3), (0, 0.91, 0.65), 'blue_dark'))
    P.add(box('back_cap', (3.0, 0.25, 0.14), (0, 0.875, 1.23), 'yellow'))
    for i in range(3):
        P.add(box('pad', (0.86, 0.12, 0.92), (-0.96 + 0.96 * i, 0.81, 0.6), 'red', bevel_w=0.05, bevel_segs=2), 40)
    # side handles
    for sx in (-1, 1):
        x = sx * 1.42
        pts = [(x, -0.8, -0.05), (x, -0.8, 0.5), (x, -0.72, 0.6), (x, 0.6, 0.6), (x, 0.8, 0.6)]
        P.add(tube('handle', pts, r=0.06, segs=8, material='yellow'), 60)
        P.add(rod('handle_post', (x, 0.0, -0.05), (x, 0.0, 0.6), 0.05, 'yellow', segs=6), 60)
        # roller carriage gripping the rail (rail posts are at X = +-0.5, Y 1.1..1.6)
        P.add(box('carriage', (0.14, 0.68, 1.5), (sx * 1.02, 1.3, 0.5), 'steel_dark'))
        P.add(box('carriage_tie', (0.5, 0.14, 0.3), (sx * 1.2, 1.0, 0.5), 'steel_dark'))
        for z in (-0.02, 1.02):
            P.add(cylinder('roller', 0.18, 0.3, (sx * 0.79, 1.35, z), 'black_rubber', segs=12, rot=(R(90), 0, 0)), 40)
            P.add(cylinder('roller_hub', 0.08, 0.34, (sx * 0.79, 1.35, z), 'yellow', segs=8, rot=(R(90), 0, 0)), 40)
            P.add(box('roller_arm', (0.3, 0.12, 0.12), (sx * 0.9, 1.57, z), 'steel_dark'))
    P.col_box('_floor', (3.0, 2.0, 0.35), (0, 0, -0.175))
    P.col_box('_back', (3.0, 0.25, 1.3), (0, 0.875, 0.65))
    return P.finish()


build_drop_car()


def build_drop_rail():
    P = Piece('drop_rail')
    for sx in (-1, 1):
        P.add(box('chord', (0.2, 0.5, 4.0), (sx * 0.5, 1.35, 2.0), 'yellow'))
    for k in range(4):
        x0 = -0.42 if k % 2 == 0 else 0.42
        P.add(beam('diag', (x0, 1.4, k + 0.12), (-x0, 1.4, k + 0.95), 0.13, 0.16, 'steel_dark', up=(0, 1, 0)))
        P.add(box('rung', (0.8, 0.2, 0.14), (0, 1.4, k + 0.07), 'steel_dark'))
    P.add(box('rack', (0.18, 0.1, 4.0), (0, 1.2, 2.0), 'steel'))
    return P.finish()


build_drop_rail()


def build_drop_top():
    P = Piece('drop_top')

    def burst(a, b, k_in, n, cz):
        pts = []
        for i in range(2 * n):
            ang = math.pi / 2 + math.pi * i / n
            rr = 1.0 if i % 2 == 0 else k_in
            pts.append((a * rr * math.cos(ang), cz + b * rr * math.sin(ang)))
        return pts

    cz = 0.9
    P.add(box('cap', (1.5, 0.5, 0.3), (0, 1.35, 0.15), 'yellow', bevel_w=0.04), 40)
    P.add(box('mast', (0.3, 0.2, 0.8), (0, 1.5, 0.6), 'steel_dark'))
    outer = burst(1.2, 0.66, 0.7, 12, cz)
    P.add(prism('burst', outer, 0.16, 'red', y0=1.3))
    P.add(prism('burst_in', burst(0.92, 0.52, 0.74, 12, cz), 0.1, 'yellow', y0=1.21))
    P.add(prism('burst_face', [(0.64 * math.cos(R(18 * i)), cz + 0.32 * math.sin(R(18 * i))) for i in range(20)],
                0.09, 'cream', y0=1.13), 20)
    for i in range(0, 24, 2):
        x, z = outer[i]
        P.bulb((x * 0.93, 1.29, cz + (z - cz) * 0.93), 'glow_yellow' if (i // 2) % 2 == 0 else 'glow_pink', 0.09)
    return P.finish()


build_drop_top()


# ----------------------------------------------------------------------------- wave swinger

def build_swing_hub():
    P = Piece('swing_hub')
    segs = 48
    prof = [(5.6, 0.0), (9.0, 0.0), (9.4, 0.42), (9.5, 0.42), (9.5, 0.83), (9.5, 0.95), (8.2, 1.1), (6.9, 1.3), (5.9, 1.52),
            (5.9, 1.6), (5.6, 1.6), (5.6, 0.0)]
    ob = lathe('canopy', prof, segs=segs, cap_top=False, cap_bottom=False)
    mats = ['red', 'cream', 'yellow', 'red_dark']

    def fn(c, nrm):
        rc = math.hypot(c.x, c.y)
        k = int((math.atan2(c.y, c.x) % (2 * math.pi)) / (2 * math.pi / segs))
        wedge = (k // 2) % 2
        if rc > 9.4 and c.z > 0.83:
            return 0                                     # red trim along the roof edge
        if rc < 5.62:
            return 3                                     # inner wall facing the shaft
        if c.z < 0.01:
            return wedge                                 # striped ceiling
        if c.z < 0.41:
            return 3                                     # shadowed chamfer behind the scallops
        if rc > 9.4:
            return 2                                     # fascia
        if c.z > 1.5 and rc < 5.95:
            return 2                                     # crown ring
        return wedge                                     # striped roof
    paint(ob, mats, fn)
    P.add(ob, 30)
    d = 9.5 * math.cos(math.pi / segs)
    w = 2 * 9.5 * math.sin(math.pi / segs)
    for i in range(segs):
        a = 2 * math.pi * (i + 0.5) / segs
        s = scallop('scallop', w, 0.42, 0.1, 0.32, 'teal' if i % 2 == 0 else 'cream')
        s.location = (d * math.cos(a), d * math.sin(a), 0)
        s.rotation_euler = (0, 0, a + math.pi / 2)
        P.add(s)
        b = 2 * math.pi * i / segs
        P.bulb((9.46 * math.cos(b), 9.46 * math.sin(b), 0.63), 'glow_warm', 0.15)
        if i % 2 == 0:                                    # a bulb on every roof seam
            P.bulb((8.75 * math.cos(b), 8.75 * math.sin(b), 1.05), 'glow_white', 0.13)
    return P.finish()


build_swing_hub()


def build_swing_chair():
    P = Piece('swing_chair')
    zt = -4.0
    seat = loft('seat', [rr_z(0.96, 0.76, 0.2, zt - 0.3), rr_z(1.0, 0.8, 0.22, zt - 0.26), rr_z(1.0, 0.8, 0.22, zt - 0.18),
                         rr_z(1.0, 0.8, 0.22, zt - 0.05), rr_z(0.95, 0.75, 0.18, zt)],
                mats=['yellow', 'yellow', 'tint_main', 'tint_main'], cap_mats=('yellow', 'tint_main'))
    P.add(seat, 50)
    P.add(box('backrest', (1.6, 0.18, 0.4), (0, 0.71, zt + 0.2), 'cream', bevel_w=0.07, bevel_segs=2), 40)
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = (sx * 0.9, sy * 0.7, zt + 0.02)
            P.add(beam('chain', c, (0, 0, -0.06), 0.07, 0.07, 'steel'))
            P.add(sphere('eyelet', 0.09, c, 'yellow', subdiv=1), 180)
        P.add(rod('foot_arm', (sx * 0.6, -0.7, zt - 0.28), (sx * 0.6, -0.95, zt - 0.8), 0.045, 'steel_dark', segs=6), 60)
    P.add(rod('foot_bar', (-0.68, -0.95, zt - 0.8), (0.68, -0.95, zt - 0.8), 0.06, 'yellow', segs=6), 60)
    P.add(sphere('swivel', 0.11, (0, 0, -0.11), 'steel_dark', subdiv=1), 180)
    P.col_box('', (2.0, 1.6, 0.3), (0, 0, zt - 0.15))
    return P.finish()


build_swing_chair()


# ----------------------------------------------------------------------------- station dressing

def build_station_arch():
    P = Piece('station_arch')
    for sx in (-1, 1):
        x = sx * 2.0
        P.add(box('plinth', (0.4, 0.5, 0.3), (x, 0, 0.15), 'teal'))
        for k in range(5):
            P.add(box('post', (0.32, 0.42, 0.24), (x, 0, 0.42 + 0.24 * k), 'red' if k % 2 == 0 else 'cream'))
        P.add(box('capital', (0.4, 0.5, 0.12), (x, 0, 1.56), 'yellow'))
        for z in (0.66, 1.14):
            P.bulb((x, -0.22, z), 'glow_warm', 0.1)
    nv = 15
    arch = arc_band('arch', 0, 1.6, 1.8, 2.2, -0.2, 0.2, 0, 180, nv * 2,
                    lambda k: 'yellow' if k // 2 == nv // 2 else ('red', 'cream')[(k // 2) % 2])
    P.add(arch, 20)
    for i in range(1, nv):
        a = R(180.0 * i / nv)
        P.bulb((2.0 * math.cos(a), -0.2, 1.6 + 2.0 * math.sin(a)), 'glow_warm', 0.11)
    # blank lunette signboard on a beam
    P.add(box('sign_beam', (3.3, 0.3, 0.2), (0, 0, 2.35), 'yellow'))
    a0 = math.degrees(math.asin(0.85 / 1.82))
    pts = [(1.82 * math.cos(R(a0 + (180 - 2 * a0) * i / 12)), 1.6 + 1.82 * math.sin(R(a0 + (180 - 2 * a0) * i / 12)))
           for i in range(13)]
    P.add(prism('signboard', pts, 0.16, 'cream', y0=-0.08), 20)
    return P.finish()


build_station_arch()


def build_sign_arrow():
    P = Piece('sign_arrow')
    P.add(cylinder('foot', 0.3, 0.1, (0, 0, 0.05), 'steel_dark', segs=12, r_top=0.24), 40)
    P.add(cylinder('pole', 0.08, 2.05, (0, 0, 1.075), 'white_paint', segs=8), 60)
    P.add(sphere('finial', 0.1, (0, 0, 2.1), 'yellow', subdiv=1), 180)
    cz = 1.72
    outline = [(-0.7, -0.2), (0.15, -0.2), (0.15, -0.42), (0.7, 0.0), (0.15, 0.42), (0.15, 0.2), (-0.7, 0.2)]
    inner = [(-0.6, -0.1), (0.25, -0.1), (0.25, -0.24), (0.54, 0.0), (0.25, 0.24), (0.25, 0.1), (-0.6, 0.1)]
    path = [(-0.65, -0.15), (0.2, -0.15), (0.2, -0.33), (0.63, 0.0), (0.2, 0.33), (0.2, 0.15), (-0.65, 0.15)]
    P.add(prism('arrow', [(x, cz + z) for x, z in outline], 0.14, 'red', y0=-0.22))
    P.add(prism('arrow_in', [(x, cz + z) for x, z in inner], 0.05, 'cream', y0=-0.26))
    for i, p in enumerate(along(path, 14)):
        P.bulb((p.x, -0.23, cz + p.y), 'glow_warm' if i % 2 == 0 else 'glow_yellow', 0.055)
    return P.finish()


build_sign_arrow()


# ----------------------------------------------------------------------------- checks

def bounds_of(objs):
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def fmt(v):
    return '(%7.3f, %7.3f, %7.3f)' % (v.x, v.y, v.z)


def near(a, b, tol=1e-3):
    return abs(a - b) <= tol


def check_box(lo, hi, size, top, label):
    ok = (near(hi.x - lo.x, size[0]) and near(hi.y - lo.y, size[1]) and near(hi.z - lo.z, size[2])
          and near(hi.z, top) and near(lo.x + hi.x, 0))
    assert ok, 'SPEC MISMATCH %s: %s .. %s' % (label, fmt(lo), fmt(hi))


print('[rides] ---------------- spec check (coordinates relative to each root, Blender axes)')
VIS = {}
total_tris = 0
for name, P in PIECES.items():
    vis = [P.mesh]
    cols = [c for c in P.root.children if c.type == 'MESH' and c.name.startswith('COL_')]
    P.mesh.data.calc_loop_triangles()
    tris = len(P.mesh.data.loop_triangles)
    total_tris += tris
    lo, hi = bounds_of(vis)
    VIS[name] = (lo.copy(), hi.copy())
    print('[rides] %-15s %5d tris   visible %s .. %s' % (name, tris, fmt(lo), fmt(hi)))
    for c in cols:
        clo, chi = bounds_of([c])
        print('[rides]     %-22s %s .. %s' % (c.name, fmt(clo), fmt(chi)))
print('[rides] total visible tris: %d' % total_tris)


def col_bounds(name):
    return bounds_of([bpy.data.objects[name]])


for nm, W, D in (('deck_s', 2.4, 2.0), ('deck_m', 4.0, 2.4), ('deck_l', 6.0, 3.0)):
    check_box(*col_bounds('COL_' + nm), (W, D, 0.3), 0.0, nm)
    lo, hi = VIS[nm]
    assert hi.y >= D / 2 + 3.5, nm + ' struts too short'
lo, hi = col_bounds('COL_deck_round')
assert near(hi.z, 0.0) and near(hi.x, 1.3) and near(lo.x, -1.3), 'deck_round'
assert VIS['deck_round'][1].y >= 1.3 + 3.5
lo, hi = VIS['bracket']
assert near(hi.z, 0.0) and near(lo.y, 0.0) and near(hi.y, 3.5) and near(lo.z, -1.2), 'bracket %s %s' % (fmt(lo), fmt(hi))
check_box(*col_bounds('COL_ferris_gondola'), (2.6, 1.8, 0.3), -2.4, 'ferris_gondola')
check_box(*col_bounds('COL_coaster_car'), (2.2, 1.4, 1.1), 1.1, 'coaster_car')
lo, hi = VIS['coaster_car']
assert lo.x >= -1.101 and hi.x <= 1.101 and lo.y >= -0.701 and hi.y <= 0.701 and hi.z <= 1.101 and near(lo.z, 0.0), \
    'coaster visible %s %s' % (fmt(lo), fmt(hi))
check_box(*col_bounds('COL_drop_car_floor'), (3.0, 2.0, 0.35), 0.0, 'drop_car floor')
lo, hi = col_bounds('COL_drop_car_back')
assert near(hi.z, 1.3) and near(lo.z, 0.0) and near(hi.y, 1.0) and near(hi.x - lo.x, 3.0), 'drop_car back'
lo, hi = VIS['drop_rail']
assert near(lo.z, 0.0) and near(hi.z, 4.0) and near(lo.y, 1.1) and near(hi.y, 1.6) and near(hi.x - lo.x, 1.2), 'drop_rail'
check_box(*col_bounds('COL_swing_chair'), (2.0, 1.6, 0.3), -4.0, 'swing_chair')
lo, hi = VIS['swing_hub']
assert near(lo.z, 0.0) and hi.z <= 1.601 and hi.x <= 9.7, 'swing_hub %s %s' % (fmt(lo), fmt(hi))
lo, hi = VIS['ferris_rotor']
assert lo.y >= -0.001 and hi.y <= 1.501, 'ferris_rotor Y range %s %s' % (fmt(lo), fmt(hi))
lo, hi = VIS['ferris_base']
assert near(lo.z, 0.0), 'ferris_base'
for i in range(8):
    p = bpy.data.objects['pivot_%d' % i]
    assert p.parent == PIECES['ferris_rotor'].root
    v = p.location
    assert near(math.hypot(v.x, v.z), 8.0) and near(v.y, 0.0)
    assert near(math.degrees(math.atan2(v.z, v.x)) % 360, 45.0 * i, 1e-2)
    print('[rides]     pivot_%d  %s  radius %.3f' % (i, fmt(v), math.hypot(v.x, v.z)))
lo, hi = VIS['station_arch']
assert near(hi.z, 3.8) and near(hi.x, 2.2) and near(lo.x, -2.2), 'station_arch'
print('[rides] spec check OK')


# ----------------------------------------------------------------------------- layout, export, previews

def lay_out(names, y, gap=1.5):
    x = 0.0
    for nm in names:
        lo, hi = VIS[nm]
        root = PIECES[nm].root
        root.location = (x - lo.x, y, -min(lo.z, 0.0))
        x += (hi.x - lo.x) + gap


ROW1 = ['deck_s', 'deck_m', 'deck_l', 'deck_round', 'bracket', 'coaster_car', 'drop_car', 'drop_rail', 'drop_top',
        'ferris_gondola', 'swing_chair', 'station_arch', 'sign_arrow']
ROW2 = ['ferris_base', 'ferris_rotor', 'swing_hub']
lay_out(ROW1, 0.0)
lay_out(ROW2, 26.0, gap=3.0)
PIECES['ferris_rotor'].root.location.z = 8.2
bpy.context.view_layer.update()

export_glb('kit_rides.glb')

WANT = os.environ.get('RIDES_PREVIEW', 'all')
WANT = None if WANT == 'all' else set(w for w in WANT.split(',') if w)


def want(key):
    return WANT is None or key in WANT


def shot(filename, roots, **kw):
    """render_preview of the given roots only (everything else hidden)."""
    keep = set()
    for r in roots:
        keep.add(r)
        keep.update(r.children_recursive)
    hidden = []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o not in keep and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    render_preview(filename, list(roots), **kw)
    for o in hidden:
        o.hide_render = False


VIEWS = {
    'deck_s': [('f34', 30, 20), ('low', 25, -18)],
    'deck_m': [('f34', 30, 20), ('side', 80, 12)],
    'deck_l': [('f34', 30, 20), ('front', 0, 15)],
    'deck_round': [('f34', 30, 25), ('low', 30, -15)],
    'bracket': [('f34', 40, 15)],
    'ferris_base': [('f34', 30, 15), ('side', 85, 5)],
    'ferris_rotor': [('f34', 30, 15), ('front', 0, 5)],
    'ferris_gondola': [('f34', 30, 20), ('side', 90, 5), ('low', 20, -15)],
    'coaster_car': [('f34', 40, 20), ('front', 90, 12), ('rear', 215, 25), ('side', 0, 10)],
    'drop_car': [('f34', 30, 20), ('back', 150, 20), ('low', 20, -20)],
    'drop_rail': [('f34', 30, 15)],
    'drop_top': [('f34', 25, 10)],
    'swing_hub': [('f34', 30, 20), ('low', 30, -12)],
    'swing_chair': [('f34', 30, 20), ('seat', 30, 30)],
    'station_arch': [('f34', 30, 15), ('front', 0, 8)],
    'sign_arrow': [('f34', 20, 12)],
}
for nm, views in VIEWS.items():
    if not want(nm):
        continue
    for tag, az, el in views:
        kw = {}
        if nm == 'swing_chair' and tag == 'seat':
            kw = dict(target=tuple(PIECES[nm].root.location + Vector((0, 0, -4.0))), zoom=3.0)
        shot('rides_%s_%s.png' % (nm, tag), [PIECES[nm].root], azimuth=az, elevation=el, **kw)

if want('overview'):
    render_preview('rides_overview.png', [P.root for P in PIECES.values()], azimuth=18, elevation=24, res=(1900, 950))
    render_preview('rides_overview_small.png', [PIECES[n].root for n in ROW1], azimuth=18, elevation=22,
                   res=(1900, 700), zoom=1.5)


# Assemblies: preview only, built after the export so they never reach the GLB.
def instance(root, loc=(0, 0, 0), rot=(0, 0, 0)):
    e = empty('_inst_' + root.name, loc)
    e.rotation_euler = rot
    for ch in root.children:
        if ch.type == 'MESH' and not ch.name.startswith('COL_'):
            c = ch.copy()
            link(c)
            c.parent = e
            c.matrix_parent_inverse = Matrix.Identity(4)
    return e


def cat_proxy(loc):
    """Indy-sized stand-in (1.0 tall, 1.2 long) for judging scale."""
    e = empty('_cat', loc)
    for ob in (sphere('_cat_body', 0.34, (0, 0, 0.42), 'fur_white', scale=(1.5, 0.9, 1.0)),
               sphere('_cat_head', 0.28, (0.45, 0, 0.68), 'fur_white'),
               box('_cat_ear', (0.1, 0.36, 0.14), (0.47, 0, 0.93), 'fur_tabby'),
               sphere('_cat_tail', 0.14, (-0.6, 0, 0.62), 'fur_tail', scale=(1.0, 1.0, 2.0))):
        shade(ob, 180)
        ob.parent = e
    return e


if want('assembly'):
    far = Vector((0, -300, 0))
    # Ferris wheel
    base = instance(PIECES['ferris_base'].root, far)
    ang = R(14)
    rot = instance(PIECES['ferris_rotor'].root, far + Vector((0, 0, 10)), (0, ang, 0))
    grp = [base, rot]
    bpy.context.view_layer.update()
    for i in range(8):
        p = rot.matrix_world @ bpy.data.objects['pivot_%d' % i].location
        grp.append(instance(PIECES['ferris_gondola'].root, p))
    grp.append(cat_proxy(grp[2].location + Vector((0.2, 0, -2.4))))
    shot('rides_asm_ferris_f34.png', grp, azimuth=28, elevation=12, res=(1200, 1100))
    shot('rides_asm_ferris_front.png', grp, azimuth=0, elevation=15, res=(1200, 1100))
    shot('rides_asm_ferris_side.png', grp, azimuth=88, elevation=4, res=(900, 1100))
    shot('rides_asm_ferris_close.png', grp, azimuth=20, elevation=18, res=(1200, 900),
         target=tuple(grp[2].location + Vector((-1, 0, -1.5))), zoom=3.2)
    # wave swinger
    far2 = Vector((0, -400, 0))
    grp = [instance(PIECES['swing_hub'].root, far2 + Vector((0, 0, 6)))]
    shaft = cylinder('_shaft', 5.0, 12.0, tuple(far2 + Vector((0, 0, 3))), 'concrete', segs=32)
    sh = empty('_shaft_root')
    shaft.parent = sh
    grp.append(sh)
    for i in range(12):
        a = 2 * math.pi * i / 12
        grp.append(instance(PIECES['swing_chair'].root, far2 + Vector((8 * math.cos(a), 8 * math.sin(a), 6)),
                            (0, 0, a + math.pi / 2)))
    grp.append(cat_proxy(far2 + Vector((0.0, -8.0, 2.0))))
    shot('rides_asm_swing_f34.png', grp, azimuth=20, elevation=14, res=(1400, 900))
    shot('rides_asm_swing_close.png', grp, azimuth=12, elevation=12, res=(1200, 900),
         target=tuple(far2 + Vector((0, -8.5, 4.0))), zoom=2.6)
    shot('rides_asm_swing_low.png', grp, azimuth=15, elevation=-10, res=(1400, 900))
    # drop ride
    far3 = Vector((0, -500, 0))
    grp = [instance(PIECES['drop_rail'].root, far3 + Vector((0, 0, 4.0 * k))) for k in range(3)]
    grp.append(instance(PIECES['drop_top'].root, far3 + Vector((0, 0, 12.0))))
    grp.append(instance(PIECES['drop_car'].root, far3 + Vector((0, 0, 4.5))))
    grp.append(cat_proxy(far3 + Vector((0.3, -0.1, 4.5))))
    shot('rides_asm_drop_f34.png', grp, azimuth=28, elevation=15, res=(900, 1200))
    shot('rides_asm_drop_back.png', grp, azimuth=140, elevation=10, res=(900, 1200))
    # station: big deck, arch, sign, coaster car, round pad
    far4 = Vector((0, -600, 0))
    grp = [instance(PIECES['deck_l'].root, far4),
           instance(PIECES['station_arch'].root, far4 + Vector((-0.4, 1.1, 0))),
           instance(PIECES['sign_arrow'].root, far4 + Vector((2.4, 0.9, 0))),
           instance(PIECES['coaster_car'].root, far4 + Vector((5.2, 0, 0.2))),
           instance(PIECES['deck_s'].root, far4 + Vector((-5.2, 0, 1.2))),
           instance(PIECES['deck_round'].root, far4 + Vector((-8.4, 0, 2.6))),
           cat_proxy(far4 + Vector((1.2, -0.6, 0))),
           cat_proxy(far4 + Vector((5.2, 0, 1.3)))]
    shot('rides_asm_station_f34.png', grp, azimuth=22, elevation=18, res=(1500, 800))

print('[rides] done')
