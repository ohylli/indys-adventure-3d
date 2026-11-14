"""Indy: the hero. A chibi long-haired white cat with a dark tabby cap, dark back patches and a big dark plume tail.

Builds the mesh, the rig, the skin weights and the animations, and exports public/assets/indy.glb.

    blender --background --python blender/indy.py            build + export + previews
    blender --background --python blender/indy.py -- fast    geometry previews only (no rig)

Blender coords: Indy faces -Y, Z up, his left side is +X.
"""
import sys, os, math, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from indykit import *
import bpy, bmesh
from mathutils import Vector, Matrix, Quaternion, Euler

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
FAST = 'fast' in ARGS
random.seed(7)
reset_scene()

V = Vector

# ------------------------------------------------------------------------------------------------ proportions
HEAD_C = V((0, -0.37, 0.69))
HEAD_R = V((0.335, 0.30, 0.285))            # ellipsoid radii: wide chibi head
BODY_C = V((0, 0.10, 0.43))
CHEST_C = V((0, -0.13, 0.44))
HIND_C = V((0, 0.30, 0.44))
LEG_TOP_Z = 0.33
LEGS = {                                     # paw centres on the ground
    'FL': V((0.145, -0.17, 0)), 'FR': V((-0.145, -0.17, 0)),
    'RL': V((0.165, 0.33, 0)), 'RR': V((-0.165, 0.33, 0)),
}
TAIL_PTS = [V((0, 0.50, 0.52)), V((0, 0.66, 0.66)), V((0, 0.78, 0.86)), V((0, 0.80, 1.08)), V((0, 0.72, 1.26))]
TAIL_RAD = [0.125, 0.185, 0.225, 0.205, 0.115]
EYE_X, EYE_Z = 0.138, 0.682
EYE_R = 0.078


def ellipsoid(c, r, subdiv=3):
    r = r if isinstance(r, (tuple, list, Vector)) else (r, r, r)
    return sphere('_e', 1.0, c, None, subdiv, r)


# ------------------------------------------------------------------------------------------------ fused fur body
def build_body():
    parts = []
    parts.append(ellipsoid(BODY_C, (0.29, 0.36, 0.265)))
    parts.append(ellipsoid(CHEST_C, (0.255, 0.25, 0.25)))
    parts.append(ellipsoid(CHEST_C + V((0, -0.10, -0.03)), (0.20, 0.17, 0.20)))      # chest ruff bulge
    parts.append(ellipsoid(HIND_C, (0.275, 0.27, 0.26)))
    parts.append(ellipsoid(HEAD_C, HEAD_R))
    for s in (1, -1):                                                               # cheeks: wide fluffy face
        parts.append(ellipsoid(HEAD_C + V((s * 0.215, 0.0, -0.12)), (0.15, 0.17, 0.13)))
    parts.append(ellipsoid(HEAD_C + V((0, -0.285, -0.10)), (0.16, 0.135, 0.11)))    # muzzle
    parts.append(ellipsoid(HEAD_C + V((0, -0.19, -0.19)), (0.12, 0.11, 0.08)))       # chin
    parts.append(ellipsoid(HEAD_C + V((0, 0.13, -0.17)), (0.24, 0.20, 0.17)))       # neck ruff
    for key, p in LEGS.items():
        rear = key[0] == 'R'
        r = 0.098 if rear else 0.09
        leg = cylinder('_l', r, LEG_TOP_Z, (p.x, p.y, LEG_TOP_Z / 2 + 0.05), None, 12, r_top=r * 1.25)
        parts.append(leg)
        parts.append(ellipsoid(V((p.x, p.y - 0.035, 0.07)), (r * 1.22, r * 1.5, 0.075)))  # paw
        if rear:                                                                        # thigh
            parts.append(ellipsoid(V((p.x * 1.05, p.y - 0.02, 0.33)), (0.14, 0.19, 0.19)))
        else:
            parts.append(ellipsoid(V((p.x, p.y, 0.33)), (0.115, 0.13, 0.15)))
    for p, r in zip(TAIL_PTS, TAIL_RAD):
        parts.append(ellipsoid(p, r))
    for i in range(len(TAIL_PTS) - 1):                                               # fill between tail blobs
        a, b = TAIL_PTS[i], TAIL_PTS[i + 1]
        parts.append(ellipsoid((a + b) / 2, (TAIL_RAD[i] + TAIL_RAD[i + 1]) / 2 * 0.98))
    ob = join(parts, 'indy_fur')
    apply_transforms(ob, location=True)
    select_only([ob])
    m = ob.modifiers.new('rm', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = 0.02
    m.adaptivity = 0
    bpy.ops.object.modifier_apply(modifier=m.name)
    m = ob.modifiers.new('sm', 'SMOOTH')
    m.factor = 0.6
    m.iterations = 9
    bpy.ops.object.modifier_apply(modifier=m.name)
    m = ob.modifiers.new('dc', 'DECIMATE')
    m.ratio = 0.26
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


# ------------------------------------------------------------------------------------------------ markings
# A signed field per colour region: > 0 inside (roughly in distance units). The highest positive one wins.

def _ell(p, c, r):
    q = V(((p.x - c[0]) / r[0], (p.y - c[1]) / r[1], (p.z - c[2]) / r[2]))
    return (1.0 - q.length) * min(r)


def _tail_field(p):
    best = -1.0
    for i in range(len(TAIL_PTS) - 1):
        a, b = TAIL_PTS[i], TAIL_PTS[i + 1]
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
        d = (p - (a + ab * t)).length
        rad = TAIL_RAD[i] * (1 - t) + TAIL_RAD[i + 1] * t
        best = max(best, rad * 1.5 - d)
    # only the tail itself and the rump right at its base
    return min(best, (p.y - 0.455) * 1.0 + (p.z - 0.50) * 0.35)


def _table(tab, x):
    """Piecewise-linear lookup in [(x, y), ...] sorted by x."""
    if x <= tab[0][0]:
        return tab[0][1]
    for (x0, y0), (x1, y1) in zip(tab, tab[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return tab[-1][1]


# Lower edge of the cap (head-local height) by angle round the head (0 = front, pi = back). It is lopsided, as on
# the real Indy: on his left the eye sits in white and the edge slants from the blaze's tip down to the outer brow;
# on his right the dark wraps round the eye and runs down the cheek to the jaw.
CAP_EDGE_L = [(0.0, 0.22), (0.3, 0.19), (0.6, 0.13), (0.9, 0.11), (1.4, 0.10), (1.9, 0.06), (2.4, 0.02), (math.pi, 0.0)]
CAP_EDGE_R = [(0.0, -0.04), (0.3, -0.10), (0.6, -0.12), (1.0, -0.15), (1.4, -0.17), (1.9, -0.12), (2.4, -0.03), (math.pi, 0.0)]


def _cap_field(p):
    """Brown tabby cap: top of the head and the ears, down round his right eye and cheek, above his left eye.
    White blaze up the forehead, skewed slightly to his left."""
    h = p - HEAD_C
    if h.length > 0.52:
        return -1.0
    a = math.atan2(h.x, -h.y)                   # 0 = front, +90deg = his left, 180 = back
    edge = _table(CAP_EDGE_L if a >= 0 else CAP_EDGE_R, abs(a))
    cap = (h.z - edge) * 0.9
    # the blaze: a wedge of white from the muzzle up the forehead
    if h.y < 0.02:
        cx = 0.022                              # skew to his left
        half = 0.105 - 0.42 * max(0.0, h.z - 0.02)   # narrows upward
        half = max(half, -0.05)
        blaze = half - abs(h.x - cx)
        blaze = min(blaze, -0.10 - h.y)               # on the face, not over the top of the head
        blaze = min(blaze, 0.235 - h.z)               # tip at about the height of the ears' bases
        cap = min(cap, -blaze)
    return cap


PATCHES = [
    ((-0.04, 0.02, 0.665), (0.215, 0.165, 0.12)),      # saddle over the shoulders
    ((-0.215, 0.07, 0.56), (0.105, 0.14, 0.12)),       # runs down his right side
    ((0.255, 0.335, 0.53), (0.10, 0.115, 0.115)),      # spot on his left hip
    ((0.235, 0.26, 0.60), (0.09, 0.10, 0.07)),
]


def region_fields(p):
    return {
        'fur_tail': _tail_field(p),
        'fur_dark': max(_cap_field(p), max(_ell(p, c, r) for c, r in PATCHES)),
    }


def dark_field(p):
    f = region_fields(p)
    return max(f['fur_tail'], f['fur_dark'])


def _tan_field(p):
    """Warm tan round his right eye, mostly below and outside it, inside the cap."""
    return min(_ell(p, (-0.155, -0.62, 0.66), (0.115, 0.13, 0.11)), _cap_field(p))


def material_at(p):
    f = region_fields(p)
    if f['fur_tail'] > 0 and f['fur_tail'] >= f['fur_dark']:
        return 'fur_tail'
    if f['fur_dark'] > 0:
        cap = _cap_field(p)
        if cap < f['fur_dark']:                 # a body patch: darker than the tabby cap
            return 'fur_dark'
        return 'fur_tan' if _tan_field(p) > 0 else 'fur_cap'
    return 'fur_white'


def snap_boundaries(ob, field, passes=3):
    """Move one end of every edge that crosses a colour boundary onto the boundary,
    so the patch outlines follow mesh edges and come out smooth instead of saw-toothed."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(passes):
        val = {v: field(v.co) for v in bm.verts}
        moved = set()
        for e in bm.edges:
            a, b = e.verts
            sa, sb = val[a], val[b]
            if sa * sb >= 0 or abs(sa) < 1e-5 or abs(sb) < 1e-5:
                continue
            t = sa / (sa - sb)
            v = a if abs(sa) <= abs(sb) else b
            if v in moved:
                continue
            v.co = a.co.lerp(b.co, t)
            moved.add(v)
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()


MATS = ['fur_white', 'fur_dark', 'fur_cap', 'fur_tan', 'fur_tail', 'ear_inner', 'nose_pink', 'pad_pink',
        'eye_green', 'eye_amber', 'eye_dark', 'eye_white', 'mouth', 'fur_cream']


def paint(ob):
    ob.data.materials.clear()
    for name in MATS:
        ob.data.materials.append(mat(name))
    idx = {n: i for i, n in enumerate(MATS)}
    for poly in ob.data.polygons:
        poly.material_index = idx[material_at(poly.center)]


# ------------------------------------------------------------------------------------------------ fur tufts
def tuft(base, direction, length, radius, material=None, flat=0.7, curl=None, sides=6):
    """A pointed lock of fur: a slightly flattened, curved cone. Coloured like the coat under its base."""
    d = V(direction).normalized()
    up = V((0, 0, 1)) if abs(d.z) < 0.9 else V((0, 1, 0))
    x = d.cross(up).normalized()
    y = x.cross(d).normalized()
    curl = V(curl) if curl is not None else V((0, 0, -0.25))
    bm = bmesh.new()
    rings = []
    for k, (t, rr) in enumerate(((-0.25, 1.05), (0.25, 0.92), (0.65, 0.55))):
        c = V(base) + d * (length * t) + curl * (length * max(0.0, t) ** 2)
        ring = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            ring.append(bm.verts.new(c + (x * math.cos(a) + y * math.sin(a) * flat) * radius * rr))
        rings.append(ring)
    tip = bm.verts.new(V(base) + d * length + curl * length)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((a[i], a[j], b[j], b[i]))
    for i in range(sides):
        bm.faces.new((rings[-1][i], rings[-1][(i + 1) % sides], tip))
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bmesh('_tuft', bm, material or material_at(V(base)))
    ob['anchor'] = tuple(base)
    return ob


def build_tufts():
    out = []
    # cheek ruffs: the long-haired "lion" look
    for s in (1, -1):
        b = HEAD_C + V((s * 0.30, 0.02, -0.13))
        for dz, dy, ln, rr in ((0.05, 0.05, 0.17, 0.085), (-0.45, 0.05, 0.20, 0.095), (-1.0, 0.0, 0.17, 0.085)):
            col = None
            out.append(tuft(b + V((0, dy * 0.3, dz * 0.06)), (s * 1.0, 0.25, dz), ln, rr, col, curl=(0, 0.1, -0.2)))
        out.append(tuft(HEAD_C + V((s * 0.20, -0.02, -0.25)), (s * 0.45, 0.0, -1.0), 0.15, 0.08))
    # chest mane
    for x, y, z, ln in ((0, -0.36, 0.40, 0.19), (0.11, -0.33, 0.42, 0.17), (-0.11, -0.33, 0.42, 0.17),
                        (0.19, -0.24, 0.44, 0.15), (-0.19, -0.24, 0.44, 0.15), (0.0, -0.30, 0.30, 0.14)):
        out.append(tuft((x, y, z), (x * 1.2, -0.55, -0.85), ln, 0.085, curl=(0, 0.15, -0.1)))
    # elbows and belly
    for s in (1, -1):
        out.append(tuft((s * 0.15, -0.08, 0.27), (s * 0.2, 0.9, -0.5), 0.12, 0.06))
    # pantaloons on the haunches
    for s in (1, -1):
        out.append(tuft((s * 0.19, 0.47, 0.36), (s * 0.35, 0.85, -0.45), 0.17, 0.09))
        out.append(tuft((s * 0.22, 0.42, 0.24), (s * 0.5, 0.7, -0.6), 0.13, 0.075))
        out.append(tuft((s * 0.08, 0.53, 0.33), (s * 0.1, 0.9, -0.5), 0.14, 0.08))
    # rump / back locks
    out.append(tuft((0.0, 0.38, 0.69), (0, 0.8, 0.5), 0.10, 0.07, curl=(0, 0.2, -0.3)))
    # the plume: a few big locks sweeping back along the tail give it a feathery edge
    n = len(TAIL_PTS)
    for i in range(1, n):
        a, b = TAIL_PTS[i - 1], TAIL_PTS[i]
        axis = (b - a).normalized()
        side = axis.cross(V((1, 0, 0))).normalized()
        c = a + (b - a) * 0.45
        rad = (TAIL_RAD[i - 1] + TAIL_RAD[i]) / 2
        count = 4
        for j in range(count):
            ang = 2 * math.pi * (j + 0.5 * (i % 2)) / count
            radial = (V((1, 0, 0)) * math.cos(ang) + side * math.sin(ang))
            base = c + radial * rad * 0.5
            out.append(tuft(base, radial * 0.3 + axis * 1.0, rad * 1.35, rad * 0.66, 'fur_tail',
                            flat=0.85, curl=tuple(radial * 0.3)))
    tip = TAIL_PTS[-1]
    out.append(tuft(tip - (TAIL_PTS[-1] - TAIL_PTS[-2]).normalized() * 0.03,
                    (TAIL_PTS[-1] - TAIL_PTS[-2]).normalized() + V((0, -0.25, 0.1)), 0.2, 0.09, 'fur_tail'))
    return out


# ------------------------------------------------------------------------------------------------ ears, face
def build_ear(s):
    """Big triangular tabby ear with a pale pink inside, pale furnishings spilling out of it and a lynx tip.
    Returns (object, base point)."""
    base = HEAD_C + V((s * 0.19, 0.03, 0.215))
    tipv = base + V((s * 0.095, 0.02, 0.315))
    w = 0.155
    # outer shell: a squat 3-sided pyramid, open toward the front
    fwd = V((0, -1, 0))
    side = V((s, 0, 0.0)).normalized()
    bl = base - side * w + V((0, 0.02, -0.03))
    br = base + side * w * 0.95 + V((0, 0.02, -0.06))
    bb = base + V((0, 0.115, -0.02))
    bf = base + V((0, -0.075, -0.02))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in (bl, bf, br, bb, tipv)]
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
        bm.faces.new((vs[a], vs[b], vs[4]))
    bm.faces.new((vs[3], vs[2], vs[1], vs[0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    outer = obj_from_bmesh('_ear', bm, 'fur_cap')
    # inner ear: a pink triangle set into the front faces
    c = (bl + br + tipv) / 3 + V((0, -0.058, 0.0))
    k = 0.60
    il = c + (bl - c) * k + V((0, -0.012, 0.02))
    ir = c + (br - c) * k + V((0, -0.012, 0.02))
    it = c + (tipv - c) * k * 0.9
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(p + V((0, -0.02, 0))) for p in (il, ir, it)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=V((0, 0.03, 0)), verts=[e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)])
    inner = obj_from_bmesh('_earin', bm, 'ear_inner')
    # furnishings: a fan of pale locks rising from the bottom of the ear across the pink, inside the rim
    locks = []
    for t, ln in ((-0.3, 0.5), (0.0, 0.62), (0.3, 0.5)):
        b = il.lerp(ir, 0.5 + t) + V((0, -0.04, 0.01))
        up = it - b
        locks.append(tuft(b, up.normalized() + V((s * t * 0.5, -0.2, 0)), up.length * ln, 0.022, 'fur_cream',
                          flat=0.45, curl=(0, -0.08, 0)))
    # lynx tip: a dark lock carrying the point of the ear on upward
    d = (tipv - (bl + br) / 2).normalized()
    lynx = tuft(tipv - d * 0.03, d + V((s * 0.1, 0.05, 0.25)), 0.085, 0.02, 'fur_tail', flat=0.6, curl=(0, 0, 0))
    ear = join([outer, inner, lynx] + locks, f'_ear_{"L" if s > 0 else "R"}')
    return ear, base


def head_surface(x, z):
    """Point on the front of the head ellipsoid at head-local (x, z), plus the outward normal."""
    hx, hz = x / HEAD_R.x, (z - HEAD_C.z) / HEAD_R.z
    y = -math.sqrt(max(0.0, 1 - hx * hx - hz * hz)) * HEAD_R.y
    p = V((x, HEAD_C.y + y, z))
    n = V((x / HEAD_R.x ** 2, y / HEAD_R.y ** 2, (z - HEAD_C.z) / HEAD_R.z ** 2)).normalized()
    return p, n


def disc(name, centre, normal, rx, rz, thick, material, segs=20, tilt=0.0):
    """A domed elliptical disc lying on the plane with the given normal."""
    ob = uv_sphere(name, 1.0, (0, 0, 0), material, segs, 8, (rx, thick, rz))
    q = V((0, -1, 0)).rotation_difference(normal)
    ob.rotation_euler = (q @ Quaternion((0, 1, 0), tilt)).to_euler()
    ob.location = centre
    return ob


def build_eye(s):
    p, n = on_fur(s * EYE_X, EYE_Z)
    n = (n + V((0, -1, 0)) * 0.6).normalized()        # face a bit more forward than the skull does
    tilt = -s * 0.2
    parts = [
        disc('_rim', p - n * 0.006, n, EYE_R * 1.14, EYE_R * 1.16, 0.02, 'eye_dark', tilt=tilt),
        disc('_iris', p + n * 0.002, n, EYE_R, EYE_R * 1.02, 0.022, 'eye_green', tilt=tilt),
        disc('_amber', p + n * 0.006 + V((-s * 0.004, 0, 0.0)), n, EYE_R * 0.82, EYE_R * 0.92, 0.02, 'eye_amber', tilt=tilt),
        disc('_pupil', p + n * 0.010 + V((-s * 0.006, 0, 0.0)), n, EYE_R * 0.58, EYE_R * 0.74, 0.018, 'eye_dark', tilt=tilt),
        disc('_hl', p + n * 0.024 + V((0.026, 0, 0.032)), n, EYE_R * 0.27, EYE_R * 0.27, 0.01, 'eye_white'),
        disc('_hl2', p + n * 0.024 + V((-0.022, 0, -0.03)), n, EYE_R * 0.12, EYE_R * 0.12, 0.008, 'eye_white'),
    ]
    eye = join(parts, f'_eye_{"L" if s > 0 else "R"}')
    apply_transforms(eye, location=True)
    return eye, p


def build_face():
    _np, _nn = on_fur(0.0, HEAD_C.z - 0.075)
    nose_c = _np + V((0, 0.006, 0))
    nose = uv_sphere('_nose', 1.0, nose_c, 'nose_pink', 12, 8, (0.042, 0.03, 0.03))
    # mouth: two little dark arcs under the nose (the cat "w"), and an interior that opens for the meow
    arcs = []
    for s in (1, -1):
        pts = []
        for i in range(6):
            t = i / 5
            a = math.pi * t
            pts.append(nose_c + V((s * (0.006 + 0.036 * (1 - math.cos(a)) / 2), 0.012 + 0.02 * t,
                                   -0.036 - 0.022 * math.sin(a))))
        arcs.append(tube('_m', pts, 0.0075, 8, 'eye_dark'))
    stem = tube('_ms', [nose_c + V((0, 0.004, -0.02)), nose_c + V((0, 0.012, -0.04))], 0.0075, 8, 'eye_dark')
    mouth_c = on_fur(0.0, nose_c.z - 0.085)[0] + V((0, 0.012, 0))
    mouth = uv_sphere('_mouth', 1.0, mouth_c, 'mouth', 12, 8, (0.05, 0.03, 0.045))
    tongue = uv_sphere('_tongue', 1.0, mouth_c + V((0, -0.012, -0.018)), 'nose_pink', 10, 6, (0.03, 0.02, 0.018))
    mouth = join([mouth, tongue], '_mouth')
    apply_transforms(mouth, location=True)
    # whiskers: a few bold ink strokes
    wh = []
    for s in (1, -1):
        root = on_fur(s * 0.095, nose_c.z - 0.035)[0]
        for dz, ln in ((0.03, 0.2), (-0.03, 0.18)):
            tipp = root + V((s * ln, 0.06, dz * 2.2))
            mid = (root + tipp) / 2 + V((0, -0.02, 0.012))
            wh.append(tube('_w', [root, mid, tipp], 0.0065, 8, 'eye_white'))
    static = join([nose, stem] + arcs, '_face')
    apply_transforms(static, location=True)
    whiskers = join(wh, '_whiskers')
    apply_transforms(whiskers, location=True)
    return static, mouth, mouth_c, whiskers


def build_pads():
    out = []
    for key, p in LEGS.items():
        out.append(uv_sphere('_pad', 1.0, (p.x, p.y - 0.045, 0.012), 'pad_pink', 10, 6, (0.05, 0.06, 0.012)))
    return out


def build_fedora():
    """For the title screen: his name is Indiana, after all."""
    hat_brown, hat_dark = mat('hat_brown', '#8a5a36'), mat('hat_band', '#3a2a22')
    brim = lathe('_brim', [(0.0, 0.0), (0.30, 0.0), (0.335, 0.022), (0.33, 0.04), (0.17, 0.034)], 24, hat_brown)
    crown = lathe('_crown', [(0.175, 0.03), (0.17, 0.10), (0.16, 0.19), (0.13, 0.225), (0.07, 0.205), (0.0, 0.195)], 24, hat_brown)
    band = lathe('_band', [(0.178, 0.035), (0.181, 0.04), (0.176, 0.095), (0.172, 0.10)], 24, hat_dark, cap_top=False, cap_bottom=False)
    hat = join([brim, crown, band], 'fedora')
    for v in hat.data.vertices:                 # pinch the crown front, dip the brim front and back
        r = math.hypot(v.co.x, v.co.y)
        if v.co.z > 0.12:
            v.co.x *= 0.86 - 0.25 * max(0.0, -v.co.y) * (v.co.z - 0.12) * 8
        if r > 0.2:
            v.co.z += 0.045 * (abs(v.co.x) / 0.33) ** 2 - 0.02
    shade(hat, 50)
    hat.location = HEAD_C + V((0.0, -0.035, 0.255))
    hat.rotation_euler = (math.radians(-9), math.radians(5), 0)
    return hat


# ------------------------------------------------------------------------------------------------ assemble
fur = build_body()
snap_boundaries(fur, dark_field)
snap_boundaries(fur, lambda p: _tan_field(p) if (p - HEAD_C).length < 0.5 else -1.0, passes=2)
from mathutils.bvhtree import BVHTree
_bm = bmesh.new(); _bm.from_mesh(fur.data)
FUR_BVH = BVHTree.FromBMesh(_bm)


def on_fur(x, z, y_from=-2.0):
    """Point on the front of the coat at (x, z) and its normal (ray cast from the front)."""
    hit, n, _, _ = FUR_BVH.ray_cast(V((x, y_from, z)), V((0, 1, 0)))
    return hit, n


paint(fur)
shade(fur, 180)

tufts = build_tufts()
ear_L, ear_L_base = build_ear(1)
ear_R, ear_R_base = build_ear(-1)
eye_L, eye_L_c = build_eye(1)
eye_R, eye_R_c = build_eye(-1)
face, mouth, mouth_c, whiskers = build_face()
pads = build_pads()
fedora = build_fedora()

for t in tufts:
    shade(t, 75)
for e in (ear_L, ear_R):
    shade(e, 40)
for o in (eye_L, eye_R, face, mouth, whiskers):
    shade(o, 180)


def previews(tag, objs=None):
    for name, az, el in (('front', 0, 8), ('q', 38, 16), ('side', 90, 6), ('back', 150, 22), ('top', 20, 62), ('q2', -52, 18)):
        render_preview(f'indy_{tag}_{name}.png', objs, azimuth=az, elevation=el, res=(900, 760), zoom=1.25)


if FAST:
    fedora.hide_render = True
    previews('geo')
    fedora.hide_render = False
    render_preview('indy_geo_hat.png', None, azimuth=30, elevation=10, res=(900, 760), zoom=1.25)
    tris = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
    print('[indy] polys', tris, 'fur', len(fur.data.polygons))
    sys.exit(0)


# ================================================================================================ rig
BONES = {
    # name: (head, tail, parent)
    'hips': ((0, 0.34, 0.46), (0, 0.12, 0.47), None),
    'spine': ((0, 0.12, 0.47), (0, -0.10, 0.47), 'hips'),
    'chest': ((0, -0.10, 0.47), (0, -0.26, 0.52), 'spine'),
    'neck': ((0, -0.26, 0.52), (0, -0.33, 0.60), 'chest'),
    'head': ((0, -0.33, 0.60), (0, -0.37, 0.95), 'neck'),
    'tail1': (tuple(TAIL_PTS[0]), tuple(TAIL_PTS[1]), 'hips'),
    'tail2': (tuple(TAIL_PTS[1]), tuple(TAIL_PTS[2]), 'tail1'),
    'tail3': (tuple(TAIL_PTS[2]), tuple(TAIL_PTS[3]), 'tail2'),
    'tail4': (tuple(TAIL_PTS[3]), tuple(TAIL_PTS[4]), 'tail3'),
}
for key, p in LEGS.items():
    par = 'hips' if key[0] == 'R' else 'chest'
    BONES[f'leg_{key}_up'] = ((p.x, p.y, 0.34), (p.x, p.y + 0.01, 0.17), par)
    BONES[f'leg_{key}_lo'] = ((p.x, p.y + 0.01, 0.17), (p.x, p.y - 0.02, 0.0), f'leg_{key}_up')
BONES['ear_L'] = (tuple(ear_L_base), tuple(ear_L_base + V((0.06, 0, 0.2))), 'head')
BONES['ear_R'] = (tuple(ear_R_base), tuple(ear_R_base + V((-0.06, 0, 0.2))), 'head')
BONES['eye_L'] = (tuple(eye_L_c), tuple(eye_L_c + V((0, -0.06, 0))), 'head')
BONES['eye_R'] = (tuple(eye_R_c), tuple(eye_R_c + V((0, -0.06, 0))), 'head')
BONES['mouth'] = (tuple(mouth_c + V((0, 0.02, 0.03))), tuple(mouth_c + V((0, -0.04, 0.03))), 'head')

arm_data = bpy.data.armatures.new('IndyRig')
rig = bpy.data.objects.new('Indy', arm_data)
link(rig)
select_only([rig])
bpy.ops.object.mode_set(mode='EDIT')
for name, (h, t, par) in BONES.items():
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = h, t
    eb.roll = 0
    if par:
        eb.parent = arm_data.edit_bones[par]
        eb.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')


# ------------------------------------------------------------------------------------------------ skin weights
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


BODY_BONES = [('hips', 0.21), ('spine', 0.22), ('chest', 0.20), ('neck', 0.13)]
HEAD_SEG = (V((0, -0.33, 0.62)), V((0, -0.40, 0.76)))


def weights_at(p):
    """Smooth skin weights for a point on the coat."""
    w = {}
    for name, rad in BODY_BONES:
        a, b = V(BONES[name][0]), V(BONES[name][1])
        w[name] = 1.0 / (max(seg_dist(p, a, b) - rad, 0.0) + 0.03) ** 3
    # head: everything inside the skull/cheeks is rigid with the head, the ruff blends
    q = p - HEAD_C
    e = V((q.x / (HEAD_R.x * 1.12), q.y / (HEAD_R.y * 1.1), q.z / (HEAD_R.z * 1.1))).length
    w['head'] = 1.0 / (max(seg_dist(p, *HEAD_SEG) - 0.25, 0.0) + 0.03) ** 3
    if e < 1.0 or (q.y < 0.05 and e < 1.25):
        w = {'head': 1.0}
    # legs: only below the belly line
    for key, lp in LEGS.items():
        horiz = math.hypot(p.x - lp.x, p.y - lp.y)
        mask = smooth01((0.43 - p.z) / 0.17) * smooth01((0.30 - horiz) / 0.14)
        if mask <= 0:
            continue
        for part in ('up', 'lo'):
            a, b = V(BONES[f'leg_{key}_{part}'][0]), V(BONES[f'leg_{key}_{part}'][1])
            w[f'leg_{key}_{part}'] = mask * 1.0 / (max(seg_dist(p, a, b) - 0.07, 0.0) + 0.03) ** 3
    # tail
    tf = _tail_field(p)
    if tf > -0.06:
        mask = smooth01((tf + 0.06) / 0.10)
        for i in range(1, 5):
            a, b = V(BONES[f'tail{i}'][0]), V(BONES[f'tail{i}'][1])
            rad = (TAIL_RAD[i - 1] + TAIL_RAD[i]) / 2
            w[f'tail{i}'] = mask * 1.0 / (max(seg_dist(p, a, b) - rad * 0.9, 0.0) + 0.03) ** 3
        for name, _ in BODY_BONES:
            if name in w:
                w[name] *= (1 - mask * 0.98)
    top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    total = sum(v for _, v in top)
    return {k: v / total for k, v in top if v / total > 0.01}


def assign(ob, fn):
    groups = {}
    for v in ob.data.vertices:
        for bone, wt in fn(v.co).items():
            g = groups.get(bone)
            if g is None:
                g = groups[bone] = ob.vertex_groups.new(name=bone)
            g.add([v.index], wt, 'REPLACE')


def rigid(ob, bone):
    g = ob.vertex_groups.new(name=bone)
    g.add([v.index for v in ob.data.vertices], 1.0, 'REPLACE')


assign(fur, weights_at)
for t in tufts:
    anchor = V(t['anchor'])
    wts = weights_at(anchor)
    assign(t, lambda co, wts=wts: wts)
rigid(ear_L, 'ear_L'); rigid(ear_R, 'ear_R')
rigid(eye_L, 'eye_L'); rigid(eye_R, 'eye_R')
rigid(mouth, 'mouth'); rigid(face, 'head'); rigid(whiskers, 'head')
for pad, key in zip(pads, LEGS.keys()):
    rigid(pad, f'leg_{key}_lo')

body = join([fur] + tufts + [ear_L, ear_R, eye_L, eye_R, mouth, face] + pads, 'indy_body')
whiskers.name = 'indy_whiskers'
for ob in (body, whiskers):
    ob.parent = rig
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
select_only([body]); bpy.ops.object.material_slot_remove_unused()
select_only([whiskers]); bpy.ops.object.material_slot_remove_unused()

# the fedora rides on the head bone
bpy.context.view_layer.update()
hat_world = fedora.matrix_world.copy()
fedora.parent = rig
fedora.parent_type = 'BONE'
fedora.parent_bone = 'head'
bpy.context.view_layer.update()
fedora.matrix_world = hat_world


# ================================================================================================ animation
scene = bpy.context.scene
scene.render.fps = 30
REST = {b.name: b.matrix_local.to_3x3().to_quaternion() for b in arm_data.bones}
REST_M = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
MOUTH_SHUT = 0.04


def world_quat(pitch=0.0, yaw=0.0, roll=0.0):
    """pitch > 0: nose up / leg swings forward. yaw > 0: turn to his left. roll > 0: lean to his right side."""
    return (Quaternion((0, 0, 1), math.radians(yaw)) @ Quaternion((1, 0, 0), math.radians(-pitch))
            @ Quaternion((0, 1, 0), math.radians(roll)))


def local_scale(bone, sx=1.0, sy=1.0, sz=1.0):
    m = REST_M[bone]
    world = (sx, sy, sz)
    out = [1.0, 1.0, 1.0]
    for i in range(3):
        col = m.col[i]
        j = max(range(3), key=lambda k: abs(col[k]))
        out[i] = world[j]
    return out


def apply_pose(pose):
    """pose: {bone: (pitch, yaw, roll)}, plus optional 'hips_loc': (x, y, z) offset,
    'eyes': vertical openness 0..1.3, 'mouth': openness 0..1."""
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    for name, val in pose.items():
        if name in BONES:
            q = world_quat(*val)
            rig.pose.bones[name].rotation_quaternion = REST[name].inverted() @ q @ REST[name]
    off = V(pose.get('hips_loc', (0, 0, 0)))
    rig.pose.bones['hips'].location = REST_M['hips'].inverted() @ off
    eyes = pose.get('eyes', 1.0)
    for e in ('eye_L', 'eye_R'):
        rig.pose.bones[e].scale = local_scale(e, 1.0, 1.0, max(0.06, eyes))
    mo = max(MOUTH_SHUT, pose.get('mouth_open', 0.0))
    rig.pose.bones['mouth'].scale = (mo, mo, mo)


def key_pose(frame, pose):
    apply_pose(pose)
    for pb in rig.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        if pb.name == 'hips':
            pb.keyframe_insert('location', frame=frame)
        if pb.name.startswith(('eye', 'mouth')):
            pb.keyframe_insert('scale', frame=frame)


ACTIONS = {}


def make_action(name, frames, fn, loop=True):
    """fn(t) -> pose, with t in 0..1 over the clip. Keys every frame so there is no interpolation surprise."""
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    for f in range(frames + 1):
        t = f / frames
        key_pose(f, fn(0.0 if (loop and f == frames) else t))
    ACTIONS[name] = (act, frames)
    rig.animation_data.action = None
    return act


def legs(pose, FL=(0, 0), FR=(0, 0), RL=(0, 0), RR=(0, 0), splay=0.0):
    """Each leg: (upper pitch, lower pitch). splay rolls the legs outward."""
    for key, (up, lo) in (('FL', FL), ('FR', FR), ('RL', RL), ('RR', RR)):
        sgn = -1 if key[1] == 'L' else 1
        pose[f'leg_{key}_up'] = (up, 0, sgn * splay)
        pose[f'leg_{key}_lo'] = (lo, 0, 0)
    return pose


def tail(pose, pitches, yaws=(0, 0, 0, 0)):
    """pitches > 0 raise the tail and curl it forward over the back, < 0 lower it to trail behind."""
    for i in range(4):
        pose[f'tail{i + 1}'] = (-pitches[i], yaws[i], 0)
    return pose


S = math.sin
TAU = 2 * math.pi


def a_idle(t):
    p = TAU * t
    pose = {'hips_loc': (0, 0, -0.006 * (1 - math.cos(p)) / 2),
            'chest': (1.2 * S(p), 0, 0), 'head': (1.5 * S(p - 0.8), 2.0 * S(p), 0),
            'ear_L': (0, 0, 0), 'ear_R': (0, 0, 0)}
    legs(pose)
    tail(pose, (3 * S(p), 2 * S(p - 0.5), 0, 0),
         (9 * S(p), 13 * S(p - 0.7), 16 * S(p - 1.4), 18 * S(p - 2.1)))
    return pose


def leg_cycle(phase, amp, lift):
    """One leg of a run/walk: swing forward-back with the lower leg folding while it swings forward."""
    up = amp * S(phase)
    lo = -lift * max(0.0, math.cos(phase)) - 6
    return (up + (-lo - 6) * 0.35, lo)


def a_run(t):
    p = TAU * t
    stretch = S(p)
    pose = {'hips_loc': (0, 0, 0.035 + 0.045 * S(p - 0.5)),
            'hips': (4.5 * S(p - 0.9), 0, 0), 'spine': (-5 * stretch, 0, 0), 'chest': (-3 * stretch, 0, 0),
            'neck': (4 * stretch, 0, 0), 'head': (4 + 3 * S(p - 0.9), 0, 0),
            'ear_L': (-16, 0, 0), 'ear_R': (-16, 0, 0)}
    legs(pose,
         FL=leg_cycle(p + 0.25, 46, 55), FR=leg_cycle(p - 0.15, 46, 55),
         RL=leg_cycle(p + math.pi + 0.3, 50, 50), RR=leg_cycle(p + math.pi - 0.1, 50, 50))
    tail(pose, (-42 + 7 * S(p + 1.0), -16 + 9 * S(p + 0.4), -8 + 10 * S(p - 0.2), 12 * S(p - 0.8)))
    return pose


def a_walk(t):
    p = TAU * t
    pose = {'hips_loc': (0, 0, 0.008 * S(2 * p)),
            'hips': (0, 2.5 * S(p), 1.5 * S(p)), 'chest': (0, -2.5 * S(p), 0),
            'head': (2 * S(2 * p), 0, 0), 'ear_L': (0, 0, 0), 'ear_R': (0, 0, 0)}
    legs(pose,
         FL=leg_cycle(p, 24, 34), FR=leg_cycle(p + math.pi, 24, 34),
         RL=leg_cycle(p + math.pi + 0.5, 24, 30), RR=leg_cycle(p + 0.5, 24, 30))
    tail(pose, (6 + 3 * S(2 * p), 4, 2, 0), (8 * S(p), 11 * S(p - 0.7), 14 * S(p - 1.4), 15 * S(p - 2.1)))
    return pose


def a_jump(t):
    w = S(TAU * t)
    pose = {'hips': (20, 0, 0), 'spine': (-3, 0, 0), 'chest': (-4, 0, 0), 'neck': (-4, 0, 0), 'head': (-6, 0, 0),
            'ear_L': (6, 0, 0), 'ear_R': (6, 0, 0), 'hips_loc': (0, 0, 0.02)}
    legs(pose, FL=(62 + 2 * w, -62), FR=(56 - 2 * w, -58), RL=(-48, 14), RR=(-42, 10), splay=4)
    tail(pose, (-38, -14 + 3 * w, -8, -6 + 4 * w))
    return pose


def a_fall(t):
    w = S(TAU * t)
    pose = {'hips': (-9, 0, 0), 'spine': (3, 0, 0), 'chest': (4, 0, 0), 'neck': (4, 0, 0), 'head': (6, 0, 0),
            'ear_L': (-24, 0, 0), 'ear_R': (-24, 0, 0), 'eyes': 1.15}
    legs(pose, FL=(30 + 4 * w, -8), FR=(26 - 4 * w, -8), RL=(22 - 3 * w, -34), RR=(18 + 3 * w, -30), splay=14)
    tail(pose, (12, 10 + 4 * w, 8, 10 + 6 * w))
    return pose


def a_land(t):
    k = 1 - smooth01(t / 0.9)               # 1 = full squash at touchdown, easing out to standing
    pose = {'hips_loc': (0, 0, -0.10 * k), 'hips': (-4 * k, 0, 0), 'head': (-10 * k, 0, 0),
            'ear_L': (-14 * k, 0, 0), 'ear_R': (-14 * k, 0, 0), 'eyes': 1.0 - 0.45 * k}
    legs(pose, FL=(34 * k, -74 * k), FR=(34 * k, -74 * k), RL=(36 * k, -76 * k), RR=(36 * k, -76 * k), splay=10 * k)
    tail(pose, (16 * k, 10 * k, 6 * k, 0))
    return pose


def a_pounce(t):
    w = S(TAU * t)
    pose = {'hips': (5, 0, 0), 'spine': (-3, 0, 0), 'neck': (4, 0, 0), 'head': (8, 0, 0),
            'ear_L': (-22, 0, 0), 'ear_R': (-22, 0, 0), 'hips_loc': (0, 0, 0.03)}
    legs(pose, FL=(78 + 2 * w, -6), FR=(72 - 2 * w, -6), RL=(-70, 6), RR=(-64, 6), splay=6)
    tail(pose, (-52, -14, -6 + 3 * w, 4 * w))
    return pose


def a_climb(t):
    p = TAU * t
    pose = {'hips_loc': (0, 0, -0.105), 'hips': (0, 3 * S(p), 0), 'chest': (0, -4 * S(p), 0),
            'neck': (8, 0, 0), 'head': (18, 2 * S(p), 0), 'ear_L': (0, 0, 0), 'ear_R': (0, 0, 0)}

    def reach(ph, front):
        up = (30 if front else 24) * S(ph) + (22 if front else -6)
        lo = -30 * max(0.0, math.cos(ph)) - 10
        return (up, lo)
    legs(pose, FL=reach(p, True), FR=reach(p + math.pi, True),
         RL=reach(p + math.pi, False), RR=reach(p, False), splay=46)
    tail(pose, (-48, -12, -4, 0), (6 * S(p), 9 * S(p - 0.7), 11 * S(p - 1.4), 12 * S(p - 2.1)))
    return pose


def a_hurt(t):
    k = S(math.pi * min(1.0, t * 1.15)) ** 0.7 if t < 0.87 else 0.0
    pose = {'hips_loc': (0, 0.03 * k, 0.07 * k), 'hips': (9 * k, 0, 0), 'spine': (-8 * k, 0, 0),
            'chest': (-6 * k, 0, 0), 'head': (-12 * k, 0, 0), 'ear_L': (-38 * k, 0, 0), 'ear_R': (-38 * k, 0, 0),
            'eyes': 1.0 + 0.3 * k, 'mouth_open': 0.7 * k}
    legs(pose, FL=(24 * k, 0), FR=(24 * k, 0), RL=(-22 * k, 0), RR=(-22 * k, 0), splay=16 * k)
    tail(pose, (22 * k, 14 * k, 8 * k, 4 * k))
    return pose


def a_sit(t):
    p = TAU * t
    b = 0.5 * (1 - math.cos(p))
    pose = {'hips_loc': (0, -0.04, -0.215), 'hips': (33, 0, 0), 'spine': (-6 + 0.8 * b, 0, 0), 'chest': (-9, 0, 0),
            'neck': (-8, 0, 0), 'head': (-9 + 1.5 * S(p - 0.6), 3 * S(p), 0), 'ear_L': (0, 0, 0), 'ear_R': (0, 0, 0)}
    legs(pose, FL=(-18, 0), FR=(-18, 0), RL=(46, -96), RR=(46, -96), splay=0)
    pose['leg_RL_up'] = (46, 0, -22)
    pose['leg_RR_up'] = (46, 0, 22)
    tail(pose, (-62, -10, -2, 0), (38, 44 + 3 * S(p), 42 + 5 * S(p - 0.6), 36 + 9 * S(p - 1.2)))
    return pose


CLIPS = [
    ('idle', 72, a_idle, True), ('walk', 24, a_walk, True), ('run', 14, a_run, True),
    ('jump', 16, a_jump, True), ('fall', 12, a_fall, True), ('land', 9, a_land, False),
    ('pounce', 12, a_pounce, True), ('climb', 18, a_climb, True), ('hurt', 14, a_hurt, False),
    ('sit', 72, a_sit, True),
]
for name, frames, fn, loop in CLIPS:
    make_action(name, frames, fn, loop)

# every action on its own NLA track so the glTF exporter writes them all
ad = rig.animation_data
for name, (act, frames) in ACTIONS.items():
    tr = ad.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, 0, act)
    st.name = name


def pose_previews():
    fedora.hide_render = True
    shots = [('idle', 0.0, 38, 14), ('walk', 0.2, 80, 8), ('run', 0.25, 90, 6), ('run', 0.75, 90, 6),
             ('run', 0.5, 40, 14), ('jump', 0.0, 80, 8), ('fall', 0.0, 80, 8), ('land', 0.0, 70, 10),
             ('pounce', 0.0, 80, 10), ('climb', 0.2, 30, 55), ('climb', 0.2, 90, 5), ('hurt', 0.4, 50, 12),
             ('sit', 0.0, 40, 12), ('sit', 0.0, 110, 10), ('sit', 0.0, 0, 8)]
    fns = {n: f for n, _, f, _ in CLIPS}
    for tr in ad.nla_tracks:
        tr.mute = True
    for i, (name, t, az, el) in enumerate(shots):
        apply_pose(fns[name](t))
        bpy.context.view_layer.update()
        render_preview(f'indy_pose_{i:02d}_{name}.png', [body], azimuth=az, elevation=el, res=(760, 640), zoom=1.1,
                       target=(0, 0.1, 0.55))
    apply_pose({})
    fedora.hide_render = False
    render_preview('indy_hat.png', [body, fedora], azimuth=28, elevation=10, res=(760, 640), zoom=1.2,
                   target=(0, 0.1, 0.55))
    for tr in ad.nla_tracks:
        tr.mute = False


if 'noposes' not in ARGS:
    pose_previews()

# ================================================================================================ export
apply_pose({})
objs = [rig, body, whiskers, fedora]
select_only(objs)
os.makedirs(ASSET_DIR, exist_ok=True)
out = os.path.join(ASSET_DIR, 'indy.glb')
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True, export_morph=False,
    export_cameras=False, export_lights=False, export_texcoords=False, export_extras=True,
    export_force_sampling=True, export_optimize_animation_size=False, export_frame_step=1,
    export_def_bones=False, export_influence_nb=4,
)
tris = sum(len(p.vertices) - 2 for o in (body, whiskers, fedora) for p in o.data.polygons)
print(f'[indy] exported {out}: {tris} tris, {os.path.getsize(out) / 1024:.0f} kB, clips: {list(ACTIONS)}')
