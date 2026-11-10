"""creatures.glb: gull, jackdaw, pigeon, visitor_a, visitor_b, visitor_c.

Run:  blender --background --python blender/creatures.py
Fast iteration:  PIECES=gull,jackdaw blender ...   (builds and previews only those pieces, skips the export)

Contract (see blender/ASSETS.md):
  * every piece is an empty named after the piece; creatures face -Y
  * animated parts are separate mesh objects parented to the root, origin at the joint, rest rotation = identity
  * part objects are named <piece>_<part> and carry the custom property part = 'wing_L' | 'wing_R' | 'body' |
    'head' | 'arm_L' | 'arm_R' (exported as glTF extras -> three.js userData.part)
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from indykit import *
reset_scene()

import numpy as np

R = math.radians
ONLY = [s for s in os.environ.get('PIECES', '').split(',') if s]
NOPREV = bool(os.environ.get('NOPREV'))


# ----------------------------------------------------------------------------- local helpers

def ell(name, radii, loc=(0, 0, 0), material=None, rot=(0, 0, 0), segs=12, rings=8, axis='z'):
    """Ellipsoid from a UV sphere. axis = direction of the sphere's poles (rings are perpendicular to it),
    radii are along the object's X/Y/Z, rot is in degrees."""
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
    """Give the faces whose centre (mesh-local coordinates) satisfies fn another material."""
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


def cut(ob, co, no, fill=True):
    """Remove the geometry on the side of the plane (co, no; mesh-local) that the normal points to."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=Vector(co), plane_no=Vector(no).normalized(),
                                 clear_outer=True, clear_inner=False)
    if fill:
        edges = [g for g in res['geom_cut'] if isinstance(g, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.edgeloop_fill(bm, edges=edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def loft(name, sections, material=None):
    """Skin a list of closed cross-sections (each a list of the same number of points), capped at both ends."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bmesh(name, bm, material)


def wing(name, side, stations, material, n=8, stub=0.05):
    """A wing spread along X from the shoulder (local origin). side = +1 for the left wing (+X), -1 for the right.
    stations = [(span, leading-edge y, trailing-edge y, thickness, z), ...] from root to tip."""
    secs = []
    x0, le0, te0, t0, z0 = stations[0]
    # a short stub inboard of the shoulder keeps the wing root buried in the body at every flap angle
    stations = [(x0 - stub, le0 * 0.8, te0 * 0.8, t0 * 0.8, z0)] + list(stations)
    for (x, le, te, t, z) in stations:
        yc, c = (le + te) / 2, (te - le) / 2
        secs.append([(side * x, yc + c * math.cos(2 * math.pi * k / n), z + t / 2 * math.sin(2 * math.pi * k / n))
                     for k in range(n)])
    return loft(name, secs, material)


def rod(name, p1, p2, r, material, segs=8, r2=None):
    """Cylinder/cone from p1 (radius r) to p2 (radius r2)."""
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    ob = cylinder(name, r=r, r_top=r2, h=d.length, loc=(p1 + p2) / 2, material=material, segs=segs)
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return ob


def decal(name, pos, normal, rx, rz, depth, material, segs=10, rings=6):
    """A flat ellipsoid lying on a surface: rx wide, rz tall, `depth` thick along the surface normal."""
    ob = ell(name, (rx, depth, rz), pos, material, segs=segs, rings=rings)
    ob.rotation_euler = Vector(normal).to_track_quat('Y', 'Z').to_euler()
    return ob


def eye(name, c, out, r, iris, pupil=0.6, push=0.55):
    """Toy eye: iris ball, bulging dark pupil, white highlight. c = centre, out = direction the eye looks."""
    c = Vector(c)
    out = Vector(out).normalized()
    pc = c + out * r * push
    hl = (out + Vector((0, -0.45, 0.65))).normalized()
    return [
        ell(name, (r, r, r), c, iris, segs=10, rings=6),
        ell(name + '_p', (r * pupil,) * 3, pc, 'eye_dark', segs=8, rings=6),
        ell(name + '_h', (r * 0.24,) * 3, pc + hl * r * pupil * 0.95, 'eye_white', segs=6, rings=4),
    ]


def eyelid(c, look, r, material, slant=0.4, drop=0.25, brow=None):
    """Half-lid over an eye(): a cap that hides the eye above a plane slanting down toward the beak (cheeky look),
    with an optional dark brow line along its edge."""
    c = Vector(c)
    o = Vector(look).normalized()
    f = Vector((0, -1, 0))
    ft = (f - o * f.dot(o)).normalized()
    ut = o.cross(ft)
    if ut.z < 0:
        ut = -ut
    l = (ft - ut * slant).normalized()
    nrm = l.cross(o)
    if nrm.dot(ut) < 0:
        nrm = -nrm
    ob = ell('lid', (r * 1.28,) * 3, c, material, segs=10, rings=6)
    cut(ob, nrm * (r * drop), -nrm)
    objs = [ob]
    if brow:
        m = c + nrm * r * (drop + 0.1) + o * r * 1.02 + l * r * 0.2
        objs.append(rod('brow', m - l * r * 0.85, m + l * r * 0.85, r * 0.24, brow, segs=6))
    return objs


def part(objs, piece, pname, root, origin=(0, 0, 0), angle=60):
    """Join objs into the part object <piece>_<pname>, origin at the joint, parented under root (at the origin)."""
    objs = [o for o in objs if o is not None]
    ob = join(objs) if len(objs) > 1 else objs[0]
    ob.name = f'{piece}_{pname}'
    ob.data.name = ob.name
    apply_transforms(ob, location=True)
    shade(ob, angle)
    o = Vector(origin)
    ob.data.transform(Matrix.Translation(-o))
    ob.location = o
    ob.parent = root
    ob['part'] = pname
    return ob


def rescale(root, k):
    """Uniformly scale a finished piece about its root."""
    for ch in root.children_recursive:
        if ch.type == 'MESH':
            ch.data.transform(Matrix.Scale(k, 4))
        ch.location = ch.location * k


def pose(ob, x=0.0, y=0.0, z=0.0, mode='YXZ', sx=1.0):
    """Rotation in degrees. Mode 'YXZ' = rotate about Y first, then about X (the wing fold). sx = span scale."""
    ob.rotation_mode = mode
    ob.rotation_euler = (R(x), R(y), R(z))
    ob.scale = (sx, 1, 1)


def rest(root):
    for ch in root.children_recursive:
        ch.rotation_mode = 'XYZ'
        ch.rotation_euler = (0, 0, 0)
        ch.scale = (1, 1, 1)


def child(root, pname):
    return next(c for c in root.children if c.get('part') == pname)


# ----------------------------------------------------------------------------- birds

def bird_feet(sx, ankle_y, leg_top, material, r_leg=0.02, toe=0.075, r_toe=0.016):
    out = []
    x = sx * 0.05
    out.append(rod('leg', (x, ankle_y, 0.012), (x, ankle_y + 0.01, leg_top), r_leg, material, segs=6))
    for dx in (-0.032, 0.0, 0.032):
        out.append(rod('toe', (x, ankle_y, 0.017), (x + dx, ankle_y - toe, 0.015), r_toe, material, segs=6,
                       r2=r_toe * 0.75))
    out.append(rod('toe', (x, ankle_y, 0.017), (x, ankle_y + toe * 0.55, 0.015), r_toe, material, segs=6,
                   r2=r_toe * 0.75))
    return out


def build_gull():
    P = 'gull'
    root = empty(P)
    W, G, K = 'gull_white', 'gull_grey', 'black_rubber'
    hc = Vector((0, -0.215, 0.1))
    b = [
        ell('b', (0.2, 0.34, 0.185), (0, 0.04, 0), W, segs=18, rings=10, axis='y'),
        ell('mantle', (0.17, 0.25, 0.1), (0, 0.11, 0.1), G, segs=12, rings=8, axis='y'),
        ell('head', (0.185, 0.19, 0.18), hc, W, segs=16, rings=10),
        ell('tail', (0.12, 0.15, 0.03), (0, 0.25, 0.02), W, segs=10, rings=6, axis='y'),
    ]
    beak = lathe('beak', [(0.072, 0), (0.068, 0.07), (0.054, 0.14), (0.034, 0.19), (0.012, 0.215), (0, 0.22)],
                 segs=10, material='beak_yellow', loc=(0, -0.345, 0.085))
    beak.rotation_euler = (R(100), 0, 0)
    b.append(beak)
    # hooked tip and the red spot of the herring gull on both sides of the lower mandible
    b.append(ell('hook', (0.02, 0.026, 0.028), (0, -0.548, 0.036), 'beak_yellow', segs=8, rings=6))
    for s in (1, -1):
        b.append(ell('dot', (0.016, 0.03, 0.02), (s * 0.04, -0.475, 0.038), 'red', segs=8, rings=6))
    for s in (1, -1):
        o = Vector((s * 0.66, -0.62, 0.4)).normalized()
        e = hc + o * 0.158
        look = Vector((s * 0.55, -0.8, 0.15))
        b += eye('eye', e, look, 0.058, 'yellow_light', pupil=0.6)
        b += eyelid(e, look, 0.058, W, slant=0.32, drop=0.5, brow='grey_dark')
        b.append(ell('foot', (0.04, 0.075, 0.03), (s * 0.07, 0.2, -0.155), 'pad_pink', segs=8, rings=6, axis='y'))
    part(b, P, 'body', root)

    stations = [
        (0.00, -0.15, 0.17, 0.07, 0.0),
        (0.22, -0.19, 0.17, 0.07, 0.02),
        (0.48, -0.20, 0.13, 0.06, 0.035),
        (0.72, -0.13, 0.13, 0.05, 0.02),
        (0.80, -0.09, 0.135, 0.048, 0.015),
        (0.96, 0.01, 0.15, 0.04, 0.0),
        (1.00, 0.04, 0.155, 0.035, 0.0),
        (1.06, 0.10, 0.16, 0.022, -0.005),
    ]
    for s, nm in ((1, 'wing_L'), (-1, 'wing_R')):
        w = wing('w', s, stations, G)
        paint(w, K, lambda c: abs(c.x) > 0.8)
        paint(w, W, lambda c: abs(c.x) > 1.0)
        sh = (s * 0.165, -0.02, 0.07)
        w.location = sh
        part([w], P, nm, root, origin=sh)
    return root


def build_jackdaw():
    P = 'jackdaw'
    root = empty(P)
    K, G = 'jackdaw_black', 'jackdaw_grey'
    WG = mat('jackdaw_wing', '#3f4252').name
    b = [
        ell('b', (0.125, 0.19, 0.13), (0, 0.03, 0.235), K, rot=(-30, 0, 0), segs=16, rings=10, axis='y'),
        ell('tail', (0.07, 0.12, 0.024), (0, 0.175, 0.15), WG, rot=(-22, 0, 0), segs=10, rings=6, axis='y'),
    ]
    for s in (1, -1):
        b.append(ell('thigh', (0.05, 0.055, 0.06), (s * 0.055, 0.045, 0.15), K, segs=8, rings=6))
        b += bird_feet(s, 0.035, 0.14, 'grey_dark')
    part(b, P, 'body', root)

    hc = Vector((0, -0.105, 0.405))
    hd = ell('head', (0.108, 0.112, 0.105), hc, K, rot=(-27, 0, 0), segs=16, rings=10, axis='y')
    paint(hd, G, lambda c: c.y > -0.04)
    h = [hd]
    beak = lathe('beak', [(0.042, 0), (0.036, 0.04), (0.022, 0.075), (0, 0.098)], segs=8,
                 material='black_rubber', loc=(0, -0.19, 0.39))
    beak.rotation_euler = (R(100), 0, 0)
    h.append(beak)
    for s in (1, -1):
        o = Vector((s * 0.72, -0.6, 0.32)).normalized()
        h += eye('eye', hc + o * 0.088, Vector((s * 0.75, -0.62, 0.15)), 0.036, 'eye_pale', pupil=0.45, push=0.7)
    part(h, P, 'head', root, origin=(0, -0.075, 0.335))

    stations = [
        (0.00, -0.09, 0.10, 0.04, 0.0),
        (0.12, -0.115, 0.12, 0.04, 0.005),
        (0.26, -0.12, 0.125, 0.035, 0.005),
        (0.37, -0.09, 0.115, 0.03, 0.0),
        (0.43, -0.035, 0.085, 0.022, 0.0),
        (0.45, 0.0, 0.055, 0.012, 0.0),
    ]
    for s, nm in ((1, 'wing_L'), (-1, 'wing_R')):
        w = wing('w', s, stations, WG)
        sh = (s * 0.113, -0.01, 0.3)
        w.location = sh
        part([w], P, nm, root, origin=sh)
    return root


def build_pigeon():
    P = 'pigeon'
    root = empty(P)
    mat('pigeon_grey', '#8e9cb4')
    mat('pigeon_light', '#b9c4d4')
    mat('pigeon_dark', '#57627c')
    mat('pigeon_green', '#2fb08a')
    mat('pigeon_purple', '#a866d0')
    mat('pigeon_feet', '#e2607c')
    B, L, D = 'pigeon_grey', 'pigeon_light', 'pigeon_dark'
    b = [ell('b', (0.145, 0.2, 0.15), (0, 0.035, 0.215), B, rot=(-12, 0, 0), segs=16, rings=10, axis='y')]
    neck = ell('neck', (0.09, 0.092, 0.14), (0, -0.105, 0.33), B, rot=(10, 0, 0), segs=12, rings=10)
    paint(neck, 'pigeon_purple', lambda c: -0.05 < c.z < 0.043)
    paint(neck, 'pigeon_green', lambda c: c.z >= 0.043)
    b.append(neck)
    tail = ell('tail', (0.078, 0.11, 0.026), (0, 0.19, 0.16), B, rot=(-12, 0, 0), segs=10, rings=8, axis='y')
    paint(tail, D, lambda c: c.y > 0.042)
    b.append(tail)
    for s in (1, -1):
        b.append(ell('thigh', (0.055, 0.06, 0.06), (s * 0.06, 0.045, 0.13), B, segs=8, rings=6))
        b += bird_feet(s, 0.035, 0.12, 'pigeon_feet')
    part(b, P, 'body', root)

    hc = Vector((0, -0.125, 0.47))
    h = [ell('head', (0.08, 0.085, 0.08), hc, D, segs=12, rings=8)]
    beak = lathe('beak', [(0.03, 0), (0.024, 0.035), (0.01, 0.065), (0, 0.072)], segs=8,
                 material='grey_dark', loc=(0, -0.195, 0.458))
    beak.rotation_euler = (R(105), 0, 0)
    h.append(beak)
    h.append(ell('cere', (0.027, 0.022, 0.016), (0, -0.205, 0.476), 'white_paint', segs=8, rings=4))
    for s in (1, -1):
        o = Vector((s * 0.8, -0.52, 0.22)).normalized()
        h += eye('eye', hc + o * 0.064, Vector((s * 0.85, -0.5, 0.1)), 0.028, 'orange', pupil=0.55, push=0.6)
    part(h, P, 'head', root, origin=(0, -0.11, 0.39))

    stations = [
        (0.00, -0.085, 0.095, 0.04, 0.0),
        (0.10, -0.105, 0.11, 0.04, 0.004),
        (0.14, -0.11, 0.112, 0.038, 0.005),
        (0.20, -0.112, 0.114, 0.036, 0.005),
        (0.24, -0.108, 0.114, 0.034, 0.004),
        (0.33, -0.08, 0.11, 0.03, 0.0),
        (0.39, -0.03, 0.09, 0.022, 0.0),
        (0.41, 0.0, 0.06, 0.012, 0.0),
    ]
    for s, nm in ((1, 'wing_L'), (-1, 'wing_R')):
        w = wing('w', s, stations, L)
        paint(w, D, lambda c: 0.10 < abs(c.x) < 0.14 or 0.20 < abs(c.x) < 0.24 or abs(c.x) > 0.33)
        sh = (s * 0.132, -0.01, 0.285)
        w.location = sh
        part([w], P, nm, root, origin=sh)
    return root


# ----------------------------------------------------------------------------- visitors

HZ = 2.08                    # head centre height
HR = (0.47, 0.44, 0.43)      # head radii
NECK = (0, 0, 1.66)


def head_y(x, z):
    q = 1 - (x / HR[0]) ** 2 - ((z - HZ) / HR[2]) ** 2
    return -HR[1] * math.sqrt(max(q, 0.0))


def head_pn(x, z):
    """Point on the front of the head and the surface normal there."""
    y = head_y(x, z)
    n = Vector((x / HR[0] ** 2, y / HR[1] ** 2, (z - HZ) / HR[2] ** 2)).normalized()
    return Vector((x, y, z)), n


def interp(pts, z):
    for (z0, r0), (z1, r1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return pts[-1][1] if z > pts[-1][0] else pts[0][1]


TEE = [(0.70, 0.335), (0.80, 0.355), (1.0, 0.355), (1.25, 0.33), (1.45, 0.265), (1.57, 0.17), (1.63, 0.11)]
DRESS = [(0.56, 0.52), (0.64, 0.5), (0.85, 0.41), (1.05, 0.33), (1.25, 0.32), (1.45, 0.265), (1.57, 0.17),
         (1.63, 0.11)]


def visitor_arm(P, s, root, skin, sleeve, held=None, held_col=None):
    S = Vector((s * 0.33, 0, 1.47))
    objs = [ell('sh', (0.125, 0.125, 0.125), S, sleeve or skin, segs=10, rings=4)]
    if held == 'icecream':
        E = S + Vector((s * 0.07, -0.05, -0.30))
        hand = E + Vector((-s * 0.06, -0.30, 0.10))
        if sleeve:
            objs.append(rod('sl', S, S + (E - S) * 0.7, 0.125, sleeve, segs=10, r2=0.13))
        objs.append(rod('a1', S, E, 0.095, skin, segs=10))
        objs.append(ell('el', (0.095,) * 3, E, skin, segs=10, rings=4))
        objs.append(rod('a2', E, hand, 0.095, skin, segs=10, r2=0.09))
        objs.append(rod('cone', hand + Vector((0, 0, -0.12)), hand + Vector((0, 0, 0.24)), 0.02, 'wood_light',
                        segs=10, r2=0.115))
        objs.append(ell('scoop', (0.15, 0.15, 0.14), hand + Vector((0, 0, 0.31)), held_col, segs=10, rings=6))
        objs.append(ell('cherry', (0.05,) * 3, hand + Vector((0.02, 0, 0.455)), 'red', segs=6, rings=4))
    else:
        d = Vector((s * math.sin(R(9)), 0, -math.cos(R(9))))
        hand = S + d * 0.64
        if sleeve:
            objs.append(rod('sl', S, S + d * 0.24, 0.125, sleeve, segs=10, r2=0.13))
        objs.append(rod('a', S, S + d * 0.58, 0.095, skin, segs=10, r2=0.09))
        if held == 'balloon':
            bc = Vector((hand.x + s * 0.34, 0.04, 3.2))
            pts = [hand + Vector((0, -0.02, 0.0)), Vector((hand.x + s * 0.08, 0.0, 1.7)),
                   Vector((hand.x + s * 0.24, 0.03, 2.5)), bc + Vector((0, 0, -0.4))]
            objs.append(tube('string', pts, r=0.022, segs=4, material='white_paint'))
            objs.append(ell('balloon', (0.34, 0.34, 0.4), bc, held_col, segs=12, rings=8))
            objs.append(rod('knot', bc + Vector((0, 0, -0.46)), bc + Vector((0, 0, -0.37)), 0.06, held_col, segs=8,
                            r2=0.02))
            objs.append(ell('shine', (0.07, 0.03, 0.1), bc + Vector((-0.15, -0.26, 0.16)), 'eye_white',
                            rot=(-25, 0, -30), segs=8, rings=4))
    objs.append(ell('hand', (0.125, 0.125, 0.125), hand, skin, segs=10, rings=6))
    objs.append(ell('thumb', (0.05,) * 3, hand + Vector((-s * 0.075, -0.08, 0.04)), skin, segs=6, rings=4))
    return part(objs, P, 'arm_L' if s > 0 else 'arm_R', root, origin=S)


def build_visitor(P, skin, blush, hair, style, outfit, top, bottom, shoes, mouth='smile', stripe=None,
                  held=None, held_side=1, held_col=None, sleeve=True, badge=None):
    root = empty(P)
    mat('blush_' + P[-1], blush)
    # ---- body: legs, shoes, clothes, neck
    b = []
    for s in (1, -1):
        b.append(cylinder('leg', r=0.115, h=0.5, loc=(s * 0.15, 0, 0.36), material=skin, segs=10))
        shoe = ell('shoe', (0.15, 0.22, 0.13), (s * 0.15, -0.05, 0.1), shoes, segs=10, rings=6)
        cut(shoe, (0, 0, -0.1), (0, 0, -1))
        b.append(shoe)
        if outfit == 'tee':
            b.append(cylinder('short', r=0.165, h=0.32, loc=(s * 0.15, 0, 0.57), material=bottom, segs=10))
    if outfit == 'tee':
        b.append(ell('hips', (0.305, 0.24, 0.2), (0, 0, 0.72), bottom, segs=14, rings=8))
        n = 10
        zs = [0.70 + (1.63 - 0.70) * i / n for i in range(n + 1)]
        t = lathe('torso', [(interp(TEE, z), z) for z in zs], segs=14, material=top)
        if stripe:
            band = (1.63 - 0.70) / n
            paint(t, stripe, lambda c: int((c.z - 0.70) / band) % 2 == 1 and c.z < 1.5)
        t.scale = (1, 0.8, 1)
        b.append(t)
    else:
        zs = [0.56, 0.64, 0.85, 1.05, 1.12, 1.25, 1.45, 1.57, 1.63]
        t = lathe('dress', [(interp(DRESS, z), z) for z in zs], segs=14, material=top)
        paint(t, bottom, lambda c: c.z < 0.64 and c.z > 0.565)
        if stripe:
            paint(t, stripe, lambda c: 1.05 < c.z < 1.12)
        t.scale = (1, 0.82, 1)
        b.append(t)
    if badge:
        b.append(ell('badge', (0.13, 0.03, 0.13), (0, -0.8 * interp(TEE, 1.2) + 0.005, 1.2), badge, segs=10, rings=4,
                     axis='y'))
    b.append(cylinder('neck', r=0.11, h=0.16, loc=(0, 0, 1.66), material=skin, segs=10))
    part(b, P, 'body', root)

    # ---- arms
    for s in (1, -1):
        h = held if s == held_side else None
        visitor_arm(P, s, root, skin, top if sleeve else None, held=h, held_col=held_col)

    # ---- head
    h = [ell('head', HR, (0, 0, HZ), skin, segs=16, rings=10)]
    for s in (1, -1):
        h.append(ell('ear', (0.05, 0.07, 0.085), (s * 0.455, 0.02, HZ - 0.04), skin, segs=6, rings=4))
        p, n = head_pn(s * 0.18, HZ + 0.0)
        h.append(decal('eye', p, n, 0.054, 0.072, 0.03, 'eye_dark', segs=8, rings=6))
        h.append(ell('hl', (0.02,) * 3, p + n * 0.026 + Vector((0.016, 0, 0.03)), 'eye_white', segs=6, rings=4))
        p, n = head_pn(s * 0.31, HZ - 0.12)
        h.append(decal('cheek', p, n, 0.07, 0.045, 0.012, 'blush_' + P[-1], segs=8, rings=4))
    if mouth == 'smile':
        pts = []
        for i in range(7):
            tt = -1 + 2 * i / 6
            x, z = 0.11 * tt, HZ - 0.2 + 0.05 * tt * tt
            pts.append((x, head_y(x, z) - 0.006, z))
        h.append(tube('mouth', pts, r=0.018, segs=8, material='mouth'))
    else:
        p, n = head_pn(0, HZ - 0.17)
        m = decal('mouth', p, n, 0.085, 0.07, 0.02, 'mouth', segs=12, rings=6)
        cut(m, (0, 0, 0.012), (0, 0, 1))
        h.append(m)

    # hair cap: a shell over the head, cut along a slanted hairline
    hc = Vector((0, 0.025, HZ + 0.015))
    cap = ell('hair', (HR[0] + 0.035, HR[1] + 0.035, HR[2] + 0.035), hc, hair, segs=16, rings=10)
    cut(cap, Vector((0, -0.36, HZ + 0.25)) - hc, (0, -0.667, -0.745))
    h.append(cap)
    def fringe(x, dz, rx, rz, depth=0.05):
        p, n = head_pn(x, HZ + dz)
        h.append(decal('fringe', p, n, rx, rz, depth, hair, segs=8, rings=6))

    if style == 'pigtails':
        fringe(-0.1, 0.27, 0.27, 0.12)
        fringe(0.23, 0.3, 0.15, 0.1)
        for s in (1, -1):
            h.append(ell('tail', (0.12, 0.12, 0.22), (s * 0.54, 0.08, HZ - 0.2), hair, rot=(0, -s * 14, 0),
                         segs=8, rings=6))
            h.append(ell('bobble', (0.065,) * 3, (s * 0.49, 0.08, HZ + 0.02), 'red', segs=6, rings=4))
    elif style == 'hat':
        fringe(0.0, 0.2, 0.26, 0.09, 0.04)
        hat = lathe('hat', [(0.62, 0.2), (0.63, 0.24), (0.5, 0.29), (0.485, 0.39), (0.44, 0.49), (0, 0.505)],
                    segs=16, material='teal', loc=(0, 0.02, HZ))
        paint(hat, 'cream', lambda c: 0.29 < c.z < 0.39)
        hat.rotation_euler = (R(-9), 0, 0)
        h.append(hat)
    elif style == 'puffs':
        for s in (1, -1):
            fringe(s * 0.15, 0.29, 0.18, 0.09)
            h.append(sphere('puff', r=0.21, loc=(s * 0.42, 0.06, HZ + 0.3), material=hair, subdiv=2))
            h.append(ell('band', (0.075,) * 3, (s * 0.31, 0.04, HZ + 0.2), 'yellow', segs=6, rings=4))
    part(h, P, 'head', root, origin=NECK)
    return root


def build_visitor_a():
    return build_visitor('visitor_a', 'skin_a', '#f29a9a', 'hair_blond', 'pigtails', 'dress', 'yellow', 'cream',
                         'red', mouth='smile', stripe='red', held='icecream', held_side=1, held_col='pink',
                         sleeve=True)


def build_visitor_b():
    return build_visitor('visitor_b', 'skin_b', '#d9765a', 'hair_dark', 'hat', 'tee', 'cream', 'blue',
                         'white_paint', mouth='open', stripe='red')


def build_visitor_c():
    return build_visitor('visitor_c', 'skin_c', '#b0563e', 'hair_dark', 'puffs', 'tee', 'green', 'purple',
                         'yellow', mouth='smile', held='balloon', held_side=1, held_col='red', badge='yellow')


# ----------------------------------------------------------------------------- previews / stats

def preview(root, views, tag=None, res=(560, 480), focus=None):
    mine = set(root.children_recursive)
    others = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in mine and not o.hide_render]
    for o in others:
        o.hide_render = True
    files = []
    for vtag, az, el in views:
        fn = f'creatures_{root.name}_{vtag}.png'
        render_preview(fn, focus or [root], azimuth=az, elevation=el, res=res)
        files.append(os.path.join(PREVIEW_DIR, fn))
    for o in others:
        o.hide_render = False
    if tag:
        sheet(files, os.path.join(PREVIEW_DIR, f'creatures_{root.name}_{tag}.png'))
    return files


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


def stats(root):
    bpy.context.view_layer.update()
    inv = root.matrix_world.inverted()
    lo, hi, tris = Vector((1e9,) * 3), Vector((-1e9,) * 3), 0
    for o in root.children_recursive:
        if o.type != 'MESH':
            continue
        m = inv @ o.matrix_world
        for v in o.data.vertices:
            p = m @ v.co
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    sz = hi - lo
    print(f'[stats] {root.name:10s} tris {tris:5d}  size X {sz.x:.2f} Y {sz.y:.2f} Z {sz.z:.2f}   '
          f'x[{lo.x:.2f},{hi.x:.2f}] y[{lo.y:.2f},{hi.y:.2f}] z[{lo.z:.2f},{hi.z:.2f}]')
    for o in root.children:
        l = o.location
        print(f'[stats]     {o.name:18s} part={o.get("part")!s:7s} origin ({l.x:.3f}, {l.y:.3f}, {l.z:.3f})')


# ----------------------------------------------------------------------------- build

BUILDERS = [
    ('gull', build_gull), ('jackdaw', build_jackdaw), ('pigeon', build_pigeon),
    ('visitor_a', build_visitor_a), ('visitor_b', build_visitor_b), ('visitor_c', build_visitor_c),
]
# target body length (Y) for the birds; they are modelled roughly to size and then fitted exactly
FIT_LENGTH = {'gull': 0.9, 'jackdaw': 0.55, 'pigeon': 0.5}
SPAN = {'gull': 2.4, 'jackdaw': 1.1, 'pigeon': 1.0}   # wingspan, tip to tip
# visitors are fitted to this height (measured over body + head; a held balloon rises above it)
FIT_HEIGHT = {'visitor_a': 2.6, 'visitor_b': 2.6, 'visitor_c': 2.6}

roots = {}
for i, (name, fn) in enumerate(BUILDERS):
    if ONLY and name not in ONLY:
        continue
    r = fn()
    if name in FIT_LENGTH:
        bpy.context.view_layer.update()
        body = child(r, 'body')
        ys = [(body.matrix_world @ v.co).y for v in body.data.vertices]
        for c in r.children:
            if c.get('part') == 'head':
                ys += [(c.matrix_world @ v.co).y for v in c.data.vertices]
        rescale(r, FIT_LENGTH[name] / (max(ys) - min(ys)))
        for nm in ('wing_L', 'wing_R'):
            w = child(r, nm)
            tip = max(abs(v.co.x) for v in w.data.vertices)
            w.data.transform(Matrix.Diagonal((((SPAN[name] / 2 - abs(w.location.x)) / tip), 1, 1, 1)))
    if name in FIT_HEIGHT:
        bpy.context.view_layer.update()
        zs = []
        for c in r.children:
            if c.get('part') in ('body', 'head'):
                zs += [(c.matrix_world @ v.co).z for v in c.data.vertices]
        rescale(r, FIT_HEIGHT[name] / max(zs))
    r.location = (i * 6.0, 0, 0)
    roots[name] = r

VIEWS = [('front', 0, 15), ('34', 35, 20), ('side', 90, 10)]
# folded wing pose shown in the previews: (sweep-back angle about X, span scale)
FOLD = {'gull': (68, 0.6), 'jackdaw': (52, 0.6), 'pigeon': (58, 0.62)}
if not NOPREV:
    for name, r in roots.items():
        preview(r, VIEWS, tag='sheet', focus=[child(r, 'body')] if name == 'gull' else None)
        if name == 'gull':
            preview(r, [('span', 20, 25)], res=(900, 420))
        if name in FIT_LENGTH:
            wl, wr = child(r, 'wing_L'), child(r, 'wing_R')
            # flap up / flap down
            pose(wl, y=-35); pose(wr, y=35)
            f1 = preview(r, [('flap_up', 25, 15)])
            pose(wl, y=30); pose(wr, y=-30)
            f2 = preview(r, [('flap_down', 25, 15)])
            # folded: down about Y, then swept back about X
            fx, fs = FOLD[name]
            pose(wl, x=fx, y=80, sx=fs); pose(wr, x=fx, y=-80, sx=fs)
            f3 = preview(r, [('folded', 35, 15), ('folded_side', 90, 8), ('folded_back', 160, 20)])
            if 'head' in [c.get('part') for c in r.children]:
                pose(child(r, 'head'), y=25)
                f3 += preview(r, [('headtilt', 15, 12)])
            sheet(f1 + f2 + f3, os.path.join(PREVIEW_DIR, f'creatures_{name}_poses.png'))
        else:
            pose(child(r, 'arm_R'), y=130)
            pose(child(r, 'head'), y=-12)
            f1 = preview(r, [('wave', 0, 15), ('wave_34', 35, 20)])
            pose(child(r, 'arm_R'), y=100)
            pose(child(r, 'arm_L'), x=-25)
            pose(child(r, 'head'), x=15)
            f2 = preview(r, [('wave2', -35, 20)])
            sheet(f1 + f2, os.path.join(PREVIEW_DIR, f'creatures_{name}_poses.png'))
        rest(r)

for r in roots.values():
    rest(r)
    stats(r)

if not ONLY:
    export_glb('creatures.glb', list(roots.values()))
else:
    print('[indykit] partial build (PIECES set): export skipped')
