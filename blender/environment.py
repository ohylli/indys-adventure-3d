"""environment.glb: the world around the Näsinneula tower (plaza, Särkänniemi park, lake Näsijärvi,
the city of Tampere, Pyynikki ridge, far shores, clouds).

Run:  blender --background --python blender/environment.py [-- norender | views=ground,high,map,detail]
      (default: export + the ground, high and map previews as blender/previews/env_*.png)

Compass: north = Blender +Y, east = +X. Tower axis = Z axis through the origin, plaza at Z = 0,
lake Näsijärvi at Z = -6, lake Pyhäjärvi (south, beyond the city) at Z = -10.
Everything is generated from a seeded RNG, so the output is deterministic.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from indykit import *
reset_scene()

import random
import time
import numpy as np
from mathutils import geometry as mgeo, noise as mnoise
from mathutils.bvhtree import BVHTree

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = 'norender' not in ARGV
VIEWS = 'ground,high,map'
for a in ARGV:
    if a.startswith('views='):
        VIEWS = a[6:]
rng = random.Random(20261110)
T0 = time.time()

# one-off colours that are not in the shared PALETTE
for _n, _h in {
    'street': '#87878b', 'field_a': '#b7c56a', 'field_b': '#d9c97c', 'hill_far': '#4f747a',
    'copper': '#5fa890', 'pine_trunk': '#b06a3e', 'foam': '#eef5f6', 'rail': '#6f665e',
    'plaster_yellow': '#f0d68a', 'roof_dark': '#473f47',
}.items():
    mat(_n, _h)

R_WORLD = 1900.0
Z_NASI = -6.0
Z_PYHA = -10.0
PI = math.pi


# ============================================================================ small maths
def clamp(x, a, b):
    return a if x < a else (b if x > b else x)


def ss(a, b, x):
    """smoothstep from a to b (works for a > b too)."""
    t = clamp((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def nz(x, y, s, o=0.0):
    return mnoise.noise((x / s + o * 17.3, y / s - o * 9.1, o * 3.7))


def brg(b, r):
    """compass bearing (deg, clockwise from north) + radius -> (x, y)."""
    a = math.radians(b)
    return (r * math.sin(a), r * math.cos(a))


def face_tower(b):
    """rotation about Z so that local -Y (the 'front') faces the tower for a thing at bearing b."""
    return -math.radians(b)


def XF(loc=(0, 0, 0), rz=0.0, sc=1.0):
    c, s = math.cos(rz), math.sin(rz)
    sx, sy, sz = (sc, sc, sc) if isinstance(sc, (int, float)) else sc
    lx, ly, lz = loc

    def f(v):
        x, y, z = v[0] * sx, v[1] * sy, v[2] * sz
        return (lx + x * c - y * s, ly + x * s + y * c, lz + z)
    return f


def ring(n, r, z, phase=0.0, ry=None):
    """n points on a circle/ellipse, counter-clockwise seen from above."""
    ry = r if ry is None else ry
    return [(r * math.cos(phase + 2 * PI * i / n), ry * math.sin(phase + 2 * PI * i / n), z) for i in range(n)]


# ============================================================================ mesh builder
def _ico(sub):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    bm.verts.index_update()
    vs = [tuple(v.co) for v in bm.verts]
    fs = []
    for f in bm.faces:
        idx = [v.index for v in f.verts]
        a, b, c = (Vector(vs[i]) for i in idx)
        if (b - a).cross(c - a).dot(a + b + c) < 0:
            idx.reverse()
        fs.append(tuple(idx))
    bm.free()
    return vs, fs


ICO1 = _ico(1)
ICO2 = _ico(2)
BLOBS = []
for _k in range(6):
    _vs = []
    for v in ICO1[0]:
        s = 1 + rng.uniform(-0.09, 0.09)
        _vs.append((v[0] * s, v[1] * s, v[2] * s))
    BLOBS.append((_vs, ICO1[1]))


class MB:
    """Accumulates geometry (verts, faces, per-face material) for one merged object.
    All faces are wound counter-clockwise seen from outside (the game may render single-sided)."""

    def __init__(self, name=''):
        self.name = name
        self.v, self.f, self.fm, self.mn, self.mi = [], [], [], [], {}

    def _m(self, m):
        i = self.mi.get(m)
        if i is None:
            i = self.mi[m] = len(self.mn)
            self.mn.append(m)
        return i

    def add(self, verts, faces, mats, xf=None):
        base = len(self.v)
        self.v.extend([xf(v) for v in verts] if xf else [tuple(v) for v in verts])
        one = self._m(mats) if isinstance(mats, str) else None
        for i, f in enumerate(faces):
            self.f.append(tuple(base + k for k in f))
            self.fm.append(one if one is not None else self._m(mats[i]))

    def inst(self, tpl, loc=(0, 0, 0), rz=0.0, sc=1.0):
        xf = XF(loc, rz, sc)
        base = len(self.v)
        self.v.extend(xf(v) for v in tpl.v)
        remap = [self._m(n) for n in tpl.mn]
        for f, m in zip(tpl.f, tpl.fm):
            self.f.append(tuple(base + k for k in f))
            self.fm.append(remap[m])

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    # ---- primitives
    def loft(self, rings, mat_, cap_bottom=False, cap_top=False, apex=None, xf=None):
        """Rings (same point count, each counter-clockwise seen from the end the loft points to), bottom to top.
        mat_: a name, or f(k, i) with k = band index, 'a' for the apex fan, 'b'/'t' for the caps."""
        n = len(rings[0])
        verts, faces, mats = [], [], []
        fm = mat_ if callable(mat_) else (lambda k, i: mat_)
        for R in rings:
            verts.extend(R)
        for k in range(len(rings) - 1):
            a, b = k * n, (k + 1) * n
            for i in range(n):
                j = (i + 1) % n
                faces.append((a + i, a + j, b + j, b + i))
                mats.append(fm(k, i))
        last = (len(rings) - 1) * n
        if apex is not None:
            ai = len(verts)
            verts.append(apex)
            for i in range(n):
                faces.append((last + i, last + (i + 1) % n, ai))
                mats.append(fm('a', i))
        if cap_bottom:
            faces.append(tuple(reversed(range(n))))
            mats.append(fm('b', 0))
        if cap_top:
            faces.append(tuple(range(last, last + n)))
            mats.append(fm('t', 0))
        self.add(verts, faces, mats, xf)

    def box(self, cx, cy, z0, sx, sy, h, mat_, rz=0.0, top=True, bottom=False, top_mat=None):
        hx, hy = sx / 2, sy / 2
        base = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
        rings = [[(x, y, z0) for x, y in base], [(x, y, z0 + h) for x, y in base]]
        tm = top_mat or mat_
        self.loft(rings, (lambda k, i: tm if k == 't' else mat_), cap_bottom=bottom, cap_top=top,
                  xf=XF((cx, cy, 0), rz))

    def cyl(self, cx, cy, z0, r, h, mat_, n=8, r_top=None, top=True, bottom=False, top_mat=None, phase=0.0):
        rt = r if r_top is None else r_top
        tm = top_mat or mat_
        fm = mat_ if callable(mat_) else (lambda k, i: tm if k == 't' else mat_)
        self.loft([ring(n, r, z0, phase), ring(n, rt, z0 + h, phase)], fm, cap_bottom=bottom, cap_top=top,
                  xf=XF((cx, cy, 0)))

    def cone(self, cx, cy, z0, r, h, mat_, n=6, phase=0.0):
        self.loft([ring(n, r, z0, phase)], mat_, apex=(0, 0, z0 + h), xf=XF((cx, cy, 0)))

    def quad(self, a, b, c, d, mat_):
        self.add([a, b, c, d], [(0, 1, 2, 3)], mat_)

    def octa(self, c, r, mat_):
        x, y, z = c
        v = [(x + r, y, z), (x, y + r, z), (x - r, y, z), (x, y - r, z), (x, y, z + r), (x, y, z - r)]
        f = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (1, 0, 5), (2, 1, 5), (3, 2, 5), (0, 3, 5)]
        self.add(v, f, mat_)

    def blob(self, c, r, mat_, sc=(1, 1, 1), rz=None, var=None, hi=False):
        vs, fs = ICO2 if hi else BLOBS[rng.randrange(len(BLOBS)) if var is None else var]
        rz = rng.uniform(0, 2 * PI) if rz is None else rz
        self.add(vs, fs, mat_, XF(c, rz, (r * sc[0], r * sc[1], r * sc[2])))

    def prism(self, poly, z0, z1, mat_, xf=None, top=True, bottom=False, top_mat=None):
        """Extrude an XY polygon along Z."""
        area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                   for i in range(len(poly)))
        if area < 0:
            poly = list(reversed(poly))
        tm = top_mat or mat_
        self.loft([[(x, y, z0) for x, y in poly], [(x, y, z1) for x, y in poly]],
                  (lambda k, i: tm if k == 't' else mat_), cap_bottom=bottom, cap_top=top, xf=xf)

    def extrude_y(self, poly_xz, y0, y1, mat_, xf=None):
        """Extrude an XZ polygon along Y (a side profile), closed on both ends."""
        n = len(poly_xz)
        area = sum(poly_xz[i][0] * poly_xz[(i + 1) % n][1] - poly_xz[(i + 1) % n][0] * poly_xz[i][1] for i in range(n))
        if area < 0:
            poly_xz = list(reversed(poly_xz))
        back = [(x, y1, z) for x, z in poly_xz]
        front = [(x, y0, z) for x, z in poly_xz]
        self.loft([back, front], mat_, cap_bottom=True, cap_top=True, xf=xf)

    def sweep(self, path, hw, hh, mat_, closed=False, n=4, side=None, caps=True, profile=None, up=None):
        """A rectangular (n=4) or n-gon section swept along a 3D path. Returns the frames (pos, dir, side, up)."""
        P = [Vector(p) for p in path]
        N = len(P)
        Z = Vector((0, 0, 1))
        rings, frames, prev = [], [], None
        for i in range(N):
            d = (P[(i + 1) % N] - P[i - 1]) if closed else (P[min(i + 1, N - 1)] - P[max(i - 1, 0)])
            d.normalize()
            if side is not None:
                s = Vector(side)
            else:
                s = d.cross(Z)
                if s.length < 0.3:
                    s = prev.copy() if prev is not None else Vector((1, 0, 0))
                if prev is not None and s.dot(prev) < 0:
                    s = -s
            s = (s - d * s.dot(d)).normalized()
            if up is not None and d.cross(s).dot(Vector(up)) < 0:
                s = -s
            prev = s
            u = d.cross(s)
            c = P[i]
            if profile is not None:
                R = [c + s * a_ + u * b_ for a_, b_ in profile]
            elif n == 4:
                R = [c - s * hw - u * hh, c + s * hw - u * hh, c + s * hw + u * hh, c - s * hw + u * hh]
            else:
                R = [c + s * (math.cos(2 * PI * k / n + PI / 2) * hw) + u * (math.sin(2 * PI * k / n + PI / 2) * hh)
                     for k in range(n)]
            rings.append([tuple(q) for q in R])
            frames.append((c, d, s, u))
        if closed:
            rings.append(rings[0])
        self.loft(rings, mat_, cap_bottom=caps and not closed, cap_top=caps and not closed)
        return frames

    def roof(self, cx, cy, L, D, rz, z1, rh, kind, mat_, gable_mat=None, over=0.0):
        if D > L:
            L, D = D, L
            rz += PI / 2
        hx, hy = L / 2 + over, D / 2 + over
        xf = XF((cx, cy, 0), rz)
        if kind == 'pyramid' or (kind == 'hip' and hx - hy < 0.5):
            self.loft([[(-hx, -hy, z1), (hx, -hy, z1), (hx, hy, z1), (-hx, hy, z1)]], mat_, apex=(0, 0, z1 + rh), xf=xf)
            return
        rl = hx if kind == 'gable' else hx - hy * 0.9
        v = [(-hx, -hy, z1), (hx, -hy, z1), (hx, hy, z1), (-hx, hy, z1), (-rl, 0, z1 + rh), (rl, 0, z1 + rh)]
        f = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)]
        g = gable_mat or mat_
        self.add(v, f, [mat_, g, mat_, g], xf)

    def building(self, cx, cy, L, D, rz, zg, h, wall, roof='hip', roofm='roof_grey', rh=3.0, sink=3.0):
        if D > L:
            L, D = D, L
            rz += PI / 2
        hx, hy = L / 2, D / 2
        base = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
        rings = [[(x, y, zg - sink) for x, y in base], [(x, y, zg + h) for x, y in base]]
        xf = XF((cx, cy, 0), rz)
        if roof == 'flat':
            self.loft(rings, (lambda k, i: roofm if k == 't' else wall), cap_top=True, xf=xf)
        else:
            self.loft(rings, wall, xf=xf)
            self.roof(cx, cy, L, D, rz, zg + h, rh, roof, roofm, gable_mat=wall if roof == 'gable' else None)
        return L, D, rz

    def strips(self, cx, cy, L, D, rz, zg, h, floors, off, pglow, dark=True, sides=(0, 1), ends=False):
        """Window strips on the long facades: thin quads floating `off` in front of the wall."""
        if D > L:
            L, D = D, L
            rz += PI / 2
        hx, hy = L / 2, D / 2
        xf = XF((cx, cy, 0), rz)
        fh = h / (floors + 0.25)
        hh = fh * 0.24
        for side in sides:
            y = -(hy + off) if side == 0 else (hy + off)
            for k in range(floors):
                zc = zg + fh * (k + 0.7)
                m = min(1.2, hx * 0.15)
                cuts = [-hx + m]
                nseg = 1 if hx < 7 else rng.choice((2, 2, 3))
                for q in range(1, nseg):
                    cuts.append(lerp(-hx + m, hx - m, q / nseg + rng.uniform(-0.12, 0.12)))
                cuts.append(hx - m)
                for q in range(nseg):
                    xa, xb = cuts[q] + 0.3, cuts[q + 1] - 0.3
                    glow = rng.random() < pglow
                    if not glow and not dark:
                        continue
                    mm = 'glow_window' if glow else 'window_dark'
                    if side == 0:
                        c = [(xa, y, zc - hh), (xb, y, zc - hh), (xb, y, zc + hh), (xa, y, zc + hh)]
                    else:
                        c = [(xb, y, zc - hh), (xa, y, zc - hh), (xa, y, zc + hh), (xb, y, zc + hh)]
                    self.add(c, [(0, 1, 2, 3)], mm, xf)

    def build(self, angle=40.0, parent=None, loc=None):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.v, [], self.f)
        for m in self.mn:
            me.materials.append(mat(m))
        me.polygons.foreach_set('material_index', self.fm)
        me.update()
        ob = bpy.data.objects.new(self.name, me)
        link(ob)
        shade(ob, angle)
        if loc is not None:
            ob.location = loc
        if parent is not None:
            ob.parent = parent
        return ob


# ============================================================================ shorelines
def _crp(p0, p1, p2, p3, u, alpha=0.5):
    def tj(ti, a, b):
        return ti + max(1e-4, math.dist(a, b)) ** alpha
    t0 = 0.0
    t1 = tj(t0, p0, p1)
    t2 = tj(t1, p1, p2)
    t3 = tj(t2, p2, p3)
    t = t1 + (t2 - t1) * u

    def L(a, b, ta, tb):
        w = (t - ta) / (tb - ta)
        return (a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w)
    A1, A2, A3 = L(p0, p1, t0, t1), L(p1, p2, t1, t2), L(p2, p3, t2, t3)
    B1, B2 = L(A1, A2, t0, t2), L(A2, A3, t1, t3)
    return L(B1, B2, t1, t2)


def cr_spline(ctrl, closed=True, step=1.5):
    """Centripetal Catmull-Rom through the control points, densely sampled."""
    n = len(ctrl)
    out = []
    for i in (range(n) if closed else range(n - 1)):
        p1, p2 = ctrl[i], ctrl[(i + 1) % n]
        p0 = ctrl[i - 1] if (closed or i > 0) else (2 * p1[0] - p2[0], 2 * p1[1] - p2[1])
        p3 = ctrl[(i + 2) % n] if (closed or i + 2 < n) else (2 * p2[0] - p1[0], 2 * p2[1] - p1[1])
        sub = max(2, int(math.dist(p1, p2) / step))
        for k in range(sub):
            out.append(_crp(p0, p1, p2, p3, k / sub))
    if not closed:
        out.append(tuple(ctrl[-1]))
    return out


def resample(dense, spacing, closed=True):
    out = [dense[0]]
    acc = 0.0
    for i in range(1, len(dense)):
        acc += math.dist(dense[i - 1], dense[i])
        if acc >= spacing(dense[i]):
            out.append(dense[i])
            acc = 0.0
    if closed and len(out) > 3 and math.dist(out[-1], out[0]) < 0.5 * spacing(out[0]):
        out.pop()
    if not closed and out[-1] != dense[-1]:
        out.append(dense[-1])
    return out


def SP(p):
    return clamp(0.055 * math.hypot(p[0], p[1]), 2.6, 70.0)


COVE_R = 39.0
# Näsijärvi (water polygon). South shore from west to east, then the far shores counter-clockwise.
NASI_CTRL = [
    (-1300, -170), (-1050, -215), (-850, -165), (-680, -200), (-520, -160), (-400, -185), (-300, -150),
    (-215, -135), (-150, -118), (-112, -92),
    # Särkänniemi peninsula, west side
    (-94, -60), (-91, -25), (-93, 5), (-85, 32), (-71, 52), (-53, 63), (-36, 59),
]
NASI_CTRL += [brg(b, COVE_R) for b in (-24, -16, -8, 0, 8, 16, 24)]          # quay cove (stone wall arc)
NASI_CTRL += [
    (36, 59), (53, 64), (71, 54), (84, 36), (90, 10), (89, -20), (85, -45), (89, -62),
    # Mustalahti harbour bay and the city shore
    (100, -78), (118, -92), (140, -97), (160, -88), (185, -72), (215, -60), (255, -52), (300, -55), (340, -60),
    (357, -66), (383, -66),                                                    # mouth of Tammerkoski
    (420, -58), (470, -45), (520, -28), (575, -12), (640, 15), (720, 50), (790, 105), (850, 180),
    (880, 270), (940, 340), (1040, 400), (1130, 500), (1160, 640), (1080, 760), (1010, 830), (1120, 930),
    (1220, 1050), (1150, 1220), (980, 1330), (760, 1300), (560, 1400), (330, 1530), (80, 1560), (-180, 1500),
    (-420, 1380), (-640, 1330), (-830, 1130), (-760, 950), (-640, 860), (-800, 760), (-980, 640), (-1130, 500),
    (-1040, 360), (-960, 300), (-1150, 200), (-1330, 80), (-1400, -60),
]
PYHA_CTRL = [
    (-1450, -600), (-1100, -545), (-800, -515), (-560, -490), (-380, -478), (-240, -470), (-120, -482),
    (-20, -505), (80, -528), (190, -545), (290, -540), (350, -530), (373, -526), (399, -526), (440, -518),
    (500, -530), (560, -570), (640, -640), (760, -700), (940, -750), (1150, -790), (1380, -820), (1560, -980),
    (1400, -1220), (1050, -1380), (700, -1470), (350, -1400), (0, -1480), (-350, -1520), (-750, -1400),
    (-1150, -1250), (-1500, -1000), (-1620, -760),
]
CHAN_CTRL = [(370, -38), (370, -100), (377, -170), (380, -240), (372, -310), (370, -380), (380, -450),
             (386, -512), (386, -572)]
CHAN_HW = 13.0
WEIRS = (-118.0, -250.0, -385.0)       # three weirs in the rapids, each drops the water by 4/3


def chan_x(y):
    """x of the channel centre line at y."""
    for (x0, y0), (x1, y1) in zip(CHAN_CTRL, CHAN_CTRL[1:]):
        if y1 <= y <= y0:
            return lerp(x0, x1, (y0 - y) / (y0 - y1))
    return CHAN_CTRL[0][0] if y > CHAN_CTRL[0][1] else CHAN_CTRL[-1][0]


def _island(cx, cy, a, b, rot, n=11, jit=0.2):
    pts = []
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    for i in range(n):
        t = 2 * PI * i / n
        k = 1 + rng.uniform(-jit, jit)
        x, y = a * k * math.cos(t), b * k * math.sin(t)
        pts.append((cx + x * c - y * s, cy + x * s + y * c))
    return pts


# (cx, cy, a, b, rot, kind)   kind: 'forest', 'rock' (bare skerry), 'light' (Siilinkari)
ISLAND_DEFS = [
    (34, 252, 11, 8, 20, 'light'),
    (-135, 58, 7, 5, 30, 'rock'), (114, 104, 8, 5.5, -20, 'rock'), (-46, 122, 5, 4, 0, 'rock'),
    (-250, 200, 36, 21, 20, 'forest'), (190, 400, 54, 29, -15, 'forest'), (-110, 540, 72, 37, 10, 'forest'),
    (430, 290, 40, 23, 40, 'forest'), (-470, 400, 62, 33, -30, 'forest'), (330, 720, 92, 47, 5, 'forest'),
    (-340, 820, 82, 41, 25, 'forest'), (70, 990, 118, 56, -10, 'forest'), (650, 560, 72, 39, 60, 'forest'),
    (-720, 240, 52, 29, 0, 'forest'), (700, 960, 62, 36, 30, 'forest'), (-150, 1220, 95, 50, -20, 'forest'),
    (120, 165, 13, 8, 60, 'forest'), (-175, 130, 15, 9, -30, 'forest'),
    (-365, 165, 27, 15, 40, 'forest'), (-545, 205, 33, 19, -20, 'forest'), (-285, 415, 30, 17, 10, 'forest'),
    (-640, 610, 62, 31, 30, 'forest'), (-225, 62, 6, 4.5, 10, 'rock'), (-300, 300, 7, 5, 50, 'rock'),
    (250, 560, 34, 20, -35, 'forest'),
    # Pyhäjärvi
    (240, -700, 52, 27, 15, 'forest'), (-200, -770, 42, 23, -10, 'forest'), (600, -910, 72, 36, 20, 'forest'),
    (-620, -820, 62, 31, 5, 'forest'),
]

NASI = resample(cr_spline(NASI_CTRL), SP)
PYHA = resample(cr_spline(PYHA_CTRL), SP)
_cl = cr_spline(CHAN_CTRL, closed=False, step=3.0)
_left, _right = [], []
for i, p in enumerate(_cl):
    a, b = _cl[max(i - 1, 0)], _cl[min(i + 1, len(_cl) - 1)]
    d = Vector((b[0] - a[0], b[1] - a[1])).normalized()
    nrm = (-d.y, d.x)           # left of travel (travel goes south, so left = east)
    _left.append((p[0] + nrm[0] * CHAN_HW, p[1] + nrm[1] * CHAN_HW))
    _right.append((p[0] - nrm[0] * CHAN_HW, p[1] - nrm[1] * CHAN_HW))
CHAN = resample(_left, lambda p: 11.0, closed=False) + list(reversed(resample(_right, lambda p: 11.0, closed=False)))
ISLANDS = []
ISL_W = []
ISL_H = []
for (cx, cy, a, b, rot, kind) in ISLAND_DEFS:
    ctrl = _island(cx, cy, a, b, rot, n=(8 if a < 20 else 11))
    dense = cr_spline(ctrl)
    per = sum(math.dist(dense[i - 1], dense[i]) for i in range(len(dense)))
    spi = min(SP((cx, cy)), per / 10.0)
    ISLANDS.append(resample(dense, lambda p, s=spi: s))
    ISL_W.append(min(clamp(0.03 * math.hypot(cx, cy), 4, 22), 0.42 * b))
    ISL_H.append(2.2 + 0.085 * b)

POLYS_W = [np.array(NASI), np.array(PYHA), np.array(CHAN)]
POLYS_I = [np.array(p) for p in ISLANDS]


def in_poly(P, V):
    out = np.zeros(len(P), bool)
    x1, y1 = V[:, 0], V[:, 1]
    x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
    for s in range(0, len(P), 2000):
        x = P[s:s + 2000, 0][:, None]
        y = P[s:s + 2000, 1][:, None]
        cond = (y1 > y) != (y2 > y)
        xi = (x2 - x1) * (y - y1) / (y2 - y1 + 1e-30) + x1
        out[s:s + 2000] = ((cond & (x < xi)).sum(1) % 2) == 1
    return out


def water_flags(P):
    """-> (is_water, island index or -1) for an (N, 2) array."""
    P = np.asarray(P, float).reshape(-1, 2)
    w = np.zeros(len(P), bool)
    for V in POLYS_W:
        w |= in_poly(P, V)
    isl = np.full(len(P), -1)
    for k, V in enumerate(POLYS_I):
        lo, hi = V.min(0), V.max(0)
        box_ = (P[:, 0] >= lo[0]) & (P[:, 0] <= hi[0]) & (P[:, 1] >= lo[1]) & (P[:, 1] <= hi[1])
        if box_.any():
            idx = np.nonzero(box_)[0]
            inside = in_poly(P[idx], V)
            isl[idx[inside]] = k
    return w & (isl < 0), isl


# valid shoreline segments = polygon segments with water on exactly one side
SHORE_LINES = []          # (points, valid flags per segment i -> i+1, island index)
_segA, _segB = [], []
for pi_, poly in enumerate([NASI, PYHA, CHAN] + ISLANDS):
    n = len(poly)
    A = np.array(poly)
    B = np.roll(A, -1, axis=0)
    mid = (A + B) / 2
    d = B - A
    nrm = np.stack([-d[:, 1], d[:, 0]], 1)
    nrm /= (np.linalg.norm(nrm, axis=1)[:, None] + 1e-12)
    w1, _ = water_flags(mid + nrm * 0.7)
    w2, _ = water_flags(mid - nrm * 0.7)
    valid = w1 != w2
    SHORE_LINES.append((poly, valid, pi_ - 3))
    _segA.append(A[valid])
    _segB.append(B[valid])
SEG_A = np.concatenate(_segA)
SEG_B = np.concatenate(_segB)
_SEG_D = SEG_B - SEG_A
_SEG_L2 = (_SEG_D ** 2).sum(1) + 1e-12


def shore_dist(P):
    P = np.asarray(P, float).reshape(-1, 2)
    out = np.empty(len(P))
    for s in range(0, len(P), 300):
        p = P[s:s + 300][:, None, :]
        t = np.clip(((p - SEG_A) * _SEG_D).sum(-1) / _SEG_L2, 0, 1)
        dd = p - (SEG_A + t[..., None] * _SEG_D)
        out[s:s + 300] = np.sqrt((dd * dd).sum(-1).min(1))
    return out


# ============================================================================ terrain functions
def in_chan_zone(x, y):
    return 325 < x < 425 and -532 < y < -60


def wl_step(y):
    return Z_NASI - sum(4.0 / 3.0 * ss(yw + 3, yw - 3, y) for yw in WEIRS)


def water_level(x, y):
    if in_chan_zone(x, y):
        return wl_step(y)
    return Z_NASI if y > -340 else Z_PYHA


def wl_smooth(y):
    return Z_NASI + (Z_PYHA - Z_NASI) * ss(-200, -470, y)


def Wfun(x, y):
    """width of the shore slope (distance inland where the land reaches its full height)."""
    if 330 < x < 420 and -535 < y < -58:
        return 3.0
    r = math.hypot(x, y)
    if r < 250:
        return 8.0
    if r < 700:
        return lerp(8.0, 25.0, ss(250, 700, r))
    return lerp(25.0, 70.0, ss(700, 1300, r))


def BWfun(x, y):
    """width of the light shallow-water band."""
    if in_chan_zone(x, y):
        return 0.0
    return clamp(0.035 * math.hypot(x, y), 4.0, 34.0)


CREST = [(-10, -425, 0), (-90, -402, 26), (-170, -388, 46), (-280, -366, 33), (-420, -346, 30), (-600, -336, 34),
         (-800, -340, 26), (-1050, -352, 21), (-1300, -360, 16)]


def ridge(x, y):
    best, bh, by = 1e9, 0.0, 0.0
    for (x0, y0, h0), (x1, y1, h1) in zip(CREST, CREST[1:]):
        dx, dy = x1 - x0, y1 - y0
        t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy), 0, 1)
        px, py = x0 + dx * t, y0 + dy * t
        d = math.hypot(x - px, y - py)
        if d < best:
            best, bh, by = d, lerp(h0, h1, t), py
    sig = 58.0 if y > by else 44.0
    return bh * math.exp(-(best / sig) ** 2)


ROAD_CTRL = [(-1100, -268), (-900, -262), (-700, -252), (-500, -240), (-350, -228), (-200, -208), (-80, -193),
             (20, -192), (110, -194)]
ROAD = cr_spline(ROAD_CTRL, closed=False, step=6.0)
ROAD_HW = 4.5


def road_dist(x, y):
    best = 1e9
    for (x0, y0), (x1, y1) in zip(ROAD_CTRL, ROAD_CTRL[1:]):
        if x < min(x0, x1) - 30 or x > max(x0, x1) + 30:
            continue
        dx, dy = x1 - x0, y1 - y0
        t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy), 0, 1)
        best = min(best, math.hypot(x - x0 - dx * t, y - y0 - dy * t))
    return best


def road_dist_fine(x, y):
    best = 1e9
    for (x0, y0), (x1, y1) in zip(ROAD, ROAD[1:]):
        if abs(x - x0) > 40:
            continue
        dx, dy = x1 - x0, y1 - y0
        t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
        best = min(best, math.hypot(x - x0 - dx * t, y - y0 - dy * t))
    return best


def _pip(x, y, poly):
    inside = False
    n = len(poly)
    x1, y1 = poly[-1]
    for i in range(n):
        x2, y2 = poly[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
        x1, y1 = x2, y2
    return inside


# region outlines (they run over water where the shore is the real boundary)
PARK_CTRL = [(-125, -105), (-119, -140), (-96, -167), (-50, -181), (0, -184), (45, -180), (80, -165), (97, -136),
             (101, -100), (97, -70), (112, -50), (135, 40), (100, 115), (0, 135), (-100, 115), (-145, 40), (-150, -60)]
CITY_CTRL = [(104, -60), (107, -100), (111, -150), (105, -205), (112, -262), (106, -330), (114, -400), (108, -470),
             (112, -530), (110, -585), (300, -592), (450, -582), (560, -632), (680, -722), (748, -708), (800, -650),
             (836, -540), (814, -420), (842, -300), (820, -180), (850, -60), (830, 20), (800, 96), (760, 140),
             (600, 80), (400, 0), (200, -20)]
PARK_POLY = cr_spline(PARK_CTRL, step=4.0)
CITY_POLY = cr_spline(CITY_CTRL, step=6.0)


def in_park(x, y):
    if x < -152 or x > 137 or y < -186 or y > 137:
        return False
    return _pip(x, y, PARK_POLY)


def in_city(x, y):
    if x < 100 or x > 855 or y < -725 or y > 142:
        return False
    return _pip(x, y, CITY_POLY) and not in_park(x, y)


def city_mask(x, y):
    return ss(100, 130, x) * ss(860, 790, x) * ss(-740, -680, y)


def elevation(x, y):
    """height of the land above the local water level, away from the shore."""
    r = math.hypot(x, y)
    e = 4.0 + 1.6 * nz(x, y, 110, 1)
    e += ridge(x, y)
    e += ss(650, 1500, r) * (18 + 50 * (0.5 + 0.5 * nz(x, y, 330, 2))) + ss(1450, 1900, r) * 55
    e = lerp(e, 3.2, city_mask(x, y))
    e = lerp(e, 6.0, 1 - ss(165, 235, r))
    return e


# ============================================================================ ground triangulation
PTS, EDG = [], []


def add_pt(p):
    PTS.append(Vector((p[0], p[1])))
    return len(PTS) - 1


def add_line(pts, closed=False):
    idx = [add_pt(p) for p in pts]
    for a, b in zip(idx, idx[1:]):
        EDG.append((a, b))
    if closed:
        EDG.append((idx[-1], idx[0]))
    return idx


# 1. shorelines (constraints) and their offset contours (plain points)
_cont_pts, _cont_off, _cont_land = [], [], []
for poly, valid, isl in SHORE_LINES:
    n = len(poly)
    idx = [None] * n
    for i in range(n):
        if valid[i] or valid[i - 1]:
            idx[i] = add_pt(poly[i])
    for i in range(n):
        j = (i + 1) % n
        if valid[i] and idx[i] is not None and idx[j] is not None:
            EDG.append((idx[i], idx[j]))
    for i in range(n):
        if idx[i] is None:
            continue
        p, a, b = poly[i], poly[i - 1], poly[(i + 1) % n]
        d = Vector((b[0] - a[0], b[1] - a[1]))
        if d.length < 1e-6:
            continue
        d.normalize()
        nrm = (-d.y, d.x)
        W = ISL_W[isl] if isl >= 0 else Wfun(*p)
        bw = BWfun(*p)
        r = math.hypot(*p)
        offs = [(W, True), (bw, False)]
        if r < 250 and isl < 0:
            offs.append((W * 0.5, True))
        if isl < 0 and 100 < p[0] < 840 and -730 < p[1] < -20 and not in_chan_zone(*p):
            offs.append((W + 14.0, True))          # edge of the shore park in the city
        for off, land in offs:
            if off <= 0:
                continue
            for sgn in (1, -1):
                _cont_pts.append((p[0] + nrm[0] * off * sgn, p[1] + nrm[1] * off * sgn))
                _cont_off.append(off)
                _cont_land.append(land)
_cp = np.array(_cont_pts)
_cw, _ci = water_flags(_cp)
_cd = shore_dist(_cp)
for k in range(len(_cp)):
    x, y = _cont_pts[k]
    r = math.hypot(x, y)
    if r < 41 or r > R_WORLD - 20:
        continue
    if (_cw[k] == _cont_land[k]) or _cd[k] < 0.78 * _cont_off[k]:
        continue
    add_pt((x, y))

# 2. plaza circle (hole for the `plaza` object), lawn ring, ring path, avenue, road, weirs
add_line([brg(b, 34.0) for b in np.arange(0, 360, 3.75)], closed=True)


def _ring_pts(r, step, min_d, constrain):
    cand = [brg(b, r) for b in np.arange(0, 360, step)]
    w, _ = water_flags(np.array(cand))
    d = shore_dist(np.array(cand))
    prev = None
    first = None
    for k, p in enumerate(cand):
        ok = (not w[k]) and d[k] > min_d
        cur = add_pt(p) if ok else None
        if k == 0:
            first = cur
        if constrain and cur is not None and prev is not None:
            EDG.append((prev, cur))
        prev = cur
    if constrain and prev is not None and first is not None:
        EDG.append((prev, first))


_ring_pts(37.9, 3.75, 0.9, False)
_ring_pts(60.0, 3.0, 9.5, True)
_ring_pts(64.0, 3.0, 9.5, True)
for _poly in (PARK_POLY, CITY_POLY):                # crisp edges for the park lawn and the city ground
    _line = resample(_poly, lambda p: 11.0)
    _w, _ = water_flags(np.array(_line))
    _d = shore_dist(np.array(_line))
    _prev = None
    for k, q in enumerate(_line + _line[:1]):
        kk = k % len(_line)
        ok = (not _w[kk]) and _d[kk] > 1.4 * Wfun(*q) + 15 * (100 < q[0] < 840 and q[1] < -20) and math.hypot(*q) > 70
        cur = add_pt(q) if ok else None
        if cur is not None and _prev is not None:
            EDG.append((_prev, cur))
        _prev = cur
AVE_HW = 4.0
for sx in (-AVE_HW, AVE_HW):
    add_line([(sx, y) for y in np.linspace(-63.9, -187.6, 17)])
for sgn in (1, -1):
    line = []
    for i, p in enumerate(ROAD):
        a, b = ROAD[max(i - 1, 0)], ROAD[min(i + 1, len(ROAD) - 1)]
        d = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        line.append((p[0] - d.y * ROAD_HW * sgn, p[1] + d.x * ROAD_HW * sgn))
    add_line(resample(line, lambda p: max(9.0, SP(p) * 0.8), closed=False))
for yw in WEIRS:
    for dy in (3.0, -3.0, -10.0):
        y = yw + dy
        xc = chan_x(y)
        add_line([(xc - 11.5, y), (xc, y), (xc + 11.5, y)])
# 3. ridge crest points
for (x0, y0, h0), (x1, y1, h1) in zip(CREST, CREST[1:]):
    L = math.hypot(x1 - x0, y1 - y0)
    for k in range(int(L / 30)):
        t = k / int(L / 30)
        x, y = lerp(x0, x1, t), lerp(y0, y1, t)
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        for off in (0, 32, -32, 70, -70):
            if abs(off) > 40 and k % 2:
                continue
            add_pt((x + nx * off + rng.uniform(-4, 4), y + ny * off + rng.uniform(-4, 4)))
# 4. island interiors
for (cx, cy, a, b, rot, kind) in ISLAND_DEFS:
    add_pt((cx, cy))
    if b > 25:
        c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        for k in (-0.45, 0.45):
            add_pt((cx + a * k * c, cy + a * k * s))
# 5. world rim
add_line([brg(b, R_WORLD) for b in np.arange(0, 360, 4.0)], closed=True)
# 6. jittered polar scatter (cell size grows with the distance from the tower)
_cand = []
r = 40.0
while r < R_WORLD - 40:
    n = 72 if r < 150 else 84
    gap = r * 0.068
    off = rng.random()
    for i in range(n):
        a = 2 * PI * (i + off + rng.uniform(-0.28, 0.28)) / n
        rr = r + rng.uniform(-0.25, 0.25) * gap
        _cand.append((rr * math.sin(a), rr * math.cos(a)))
    r *= 1.068
_ca = np.array(_cand)
_w, _i = water_flags(_ca)
_d = shore_dist(_ca)
for k, (x, y) in enumerate(_cand):
    r = math.hypot(x, y)
    if 57.0 < r < 67.0:
        continue
    if abs(x) < 8 and -192 < y < -58:
        continue
    if road_dist(x, y) < 10 + r * 0.01:
        continue
    if in_chan_zone(x, y) and _w[k]:
        if any(-14 < y - yw < 7 for yw in WEIRS) or _d[k] < 4:
            continue
    elif _w[k]:
        if _d[k] < 1.3 * BWfun(x, y):
            continue
    else:
        W = ISL_W[_i[k]] if _i[k] >= 0 else Wfun(x, y)
        if _d[k] < 1.3 * W:
            continue
    add_pt((x, y))

print(f'[env] triangulating {len(PTS)} points, {len(EDG)} constraint edges')
_res = mgeo.delaunay_2d_cdt(PTS, EDG, [], 0, 1e-3, False)
GV2 = [(v.x, v.y) for v in _res[0]]
GT = [tuple(f) for f in _res[2]]
_P = np.array(GV2)
_vw, _vi = water_flags(_P)
_vd = shore_dist(_P)
GZ = []
for k, (x, y) in enumerate(GV2):
    d = _vd[k]
    if _vw[k] and d > 1e-4:
        GZ.append(water_level(x, y))
        continue
    r = math.hypot(x, y)
    if _vi[k] >= 0:
        W = ISL_W[_vi[k]]
        t = ss(0, W, d)
        z = water_level(x, y) + ISL_H[_vi[k]] * t
    else:
        W = Wfun(x, y)
        t = ss(0, W, d)
        if d > 0.01 and r < 39.0:
            t = max(t, 1 - ss(37.95, 38.9, r))         # flat lawn up to the stone wall of the quay cove
        z = (1 - t) * water_level(x, y) + t * (wl_smooth(y) + elevation(x, y))
    GZ.append(z)
GV = [(x, y, z) for (x, y), z in zip(GV2, GZ)]

# face classification
_C = np.array([[(GV2[a][0] + GV2[b][0] + GV2[c][0]) / 3, (GV2[a][1] + GV2[b][1] + GV2[c][1]) / 3] for a, b, c in GT])
_fw, _fi = water_flags(_C)
_fd = shore_dist(_C)
WATER_KINDS = {'water', 'water_light', 'foam'}


def classify(k):
    x, y = _C[k]
    d = _fd[k]
    r = math.hypot(x, y)
    a, b, c = GT[k]
    if _fw[k]:
        if in_chan_zone(x, y):
            for yw in WEIRS:
                if -10 < y - yw < 3:
                    return 'foam'
            return 'water'
        if abs(x - chan_x(y)) < 46 and (-66 < y < -20 or -575 < y < -526):
            return 'water'                          # no shallow band across the mouths of the rapids
        return 'water_light' if d < BWfun(x, y) else 'water'
    if r < 34.0:
        return 'PLAZA'
    if _fi[k] >= 0:
        kind = ISLAND_DEFS[_fi[k]][5]
        if kind != 'forest' or d < 0.55 * ISL_W[_fi[k]]:
            return 'rock'
        return 'leaf_dark' if nz(x, y, 60, 7) > 0 else 'pine'
    W = Wfun(x, y)
    zc = (GZ[a] + GZ[b] + GZ[c]) / 3
    if abs(x) < AVE_HW and -188.5 < y < -62:
        return 'sand'
    if in_park(x, y):
        if d < 0.5 * W:
            bb = math.degrees(math.atan2(x, y)) % 360
            return 'sand' if 252 < bb < 292 else 'rock'
        if d > 8.5 and 60 < r < 64:
            return 'sand'
        return 'grass'
    if x < 115 and road_dist_fine(x, y) < ROAD_HW:
        return 'asphalt'
    if in_city(x, y):
        if in_chan_zone(x, y) or abs(x - chan_x(y)) < 50:
            return 'paving_dark' if d < W else 'street'
        if d < W:
            return 'rock'
        return 'grass' if d < W + 14 else 'street'
    if r < 520 and d < 0.35 * W:
        return 'rock'
    n = nz(x, y, 150, 3)
    if r > 1500:
        return 'hill_far'
    if r > 520:
        if zc < wl_smooth(y) + 17 and d > W and nz(x, y, 95, 5) > 0.4:
            return 'field_a' if nz(x, y, 60, 6) > 0 else 'field_b'
        return 'pine_dark' if n < 0.05 else 'pine'
    if r < 260 and y > -200:
        return 'grass_dark' if n < 0.2 else 'leaf_dark'
    if nz(x, y, 70, 8) < -0.5:
        return 'grass_dark'
    return 'leaf_dark' if n > 0.1 else 'pine'


GK = [classify(k) for k in range(len(GT))]
_bvh = BVHTree.FromPolygons(GV, GT)


def gq(x, y):
    """ground query -> (z, kind). kind is the ground material name, 'PLAZA', or a water kind."""
    loc, nrm, idx, dist = _bvh.ray_cast((x, y, 900.0), (0, 0, -1))
    if loc is None:
        return 0.0, 'NONE'
    return loc.z, GK[idx]


def gz(x, y):
    return gq(x, y)[0]


def _submesh(name, pred, angle):
    remap, vs, fs, ms = {}, [], [], []
    mb = MB(name)
    for k, t in enumerate(GT):
        if not pred(GK[k]):
            continue
        f = []
        for i in t:
            j = remap.get(i)
            if j is None:
                j = remap[i] = len(vs)
                vs.append(GV[i])
            f.append(j)
        fs.append(tuple(f))
        ms.append(GK[k])
    mb.add(vs, fs, ms)
    return mb.build(angle)


OBJ = {}
OBJ['ground'] = _submesh('ground', lambda k: k not in WATER_KINDS and k != 'PLAZA', 28)
OBJ['lake'] = _submesh('lake', lambda k: k in WATER_KINDS, 20)
print(f'[env] ground + lake done ({time.time() - T0:.1f}s)')

# occupancy so that scattered things do not overlap
OCC = []


def occupied(x, y, r):
    for a, b, c in OCC:
        if (x - a) ** 2 + (y - b) ** 2 < (r + c) ** 2:
            return True
    return False


def reserve(x, y, r):
    OCC.append((x, y, r))


# ============================================================================ plaza, hedge, quay
def build_plaza():
    mb = MB('plaza')
    N = 96

    def p(r, i):
        a = 2 * PI * (i % N) / N
        return (r * math.cos(a), r * math.sin(a), 0.0)

    def annulus(r0, r1, matf):
        for i in range(N):
            mb.add([p(r0, i), p(r1, i), p(r1, i + 1), p(r0, i + 1)], [(0, 1, 2, 3)], matf(i))

    A, B = 'paving', 'paving_dark'
    mb.add([p(13, i) for i in range(N)], [tuple(range(N))], A)
    annulus(13, 14, lambda i: B)
    # 16-point star: dark spikes on light paving, a tip points north (i = 24)
    for s in range(16):
        i0 = 6 * s - 3
        a = [p(14, i0 + k) for k in range(7)]
        o = [p(23, i0 + k) for k in range(7)]
        for k in range(6):
            mb.add([a[k], o[3], a[k + 1]], [(0, 1, 2)], B)
        for k in range(3):
            mb.add([a[0], o[k], o[k + 1]], [(0, 1, 2)], A)
        for k in range(3, 6):
            mb.add([a[6], o[k], o[k + 1]], [(0, 1, 2)], A)
    annulus(23, 24.5, lambda i: B)
    annulus(24.5, 26.5, lambda i: A)
    annulus(26.5, 29, lambda i: B if (i // 2) % 2 == 0 else A)
    annulus(29, 31.5, lambda i: A if (i // 2) % 2 == 0 else B)
    annulus(31.5, 33, lambda i: A)
    annulus(33, 34, lambda i: 'concrete_dark')
    return mb.build(30)


HEDGE_GAP = 7.0          # half-angle (deg) of the gap to the north


def build_hedge():
    mb = MB('hedge')
    path = [brg(b, 33.5) + (0.45,) for b in np.arange(HEDGE_GAP + 1.0, 360 - HEDGE_GAP - 0.99, 3.0)]
    prof = [(-0.42, -0.45), (0.42, -0.45), (0.42, 0.2), (0.24, 0.45), (-0.24, 0.45), (-0.42, 0.2)]
    mb.sweep(path, 0, 0, 'leaf_dark', profile=prof, up=(0, 0, 1))
    b = HEDGE_GAP + 16
    while b < 360 - HEDGE_GAP - 10:
        x, y = brg(b, 33.5)
        mb.blob((x, y, 0.6), 0.6, 'leaf', hi=True)
        b += 20.0
    for sgn in (-1, 1):                       # stone gate posts at the gap
        x, y = brg(sgn * HEDGE_GAP, 33.5)
        mb.box(x, y, 0, 1.0, 1.0, 0.95, 'concrete_light', rz=face_tower(sgn * HEDGE_GAP))
        mb.roof(x, y, 1.2, 1.2, face_tower(sgn * HEDGE_GAP), 0.95, 0.25, 'pyramid', 'concrete_dark')
    return mb.build(40)


QUAY = dict(x0=-3.0, x1=3.0, y0=30.0, y1=46.0, top=0.05)


def build_quay():
    mb = MB('quay')
    top = QUAY['top']
    for k in range(8):                        # planks in two tones
        y = 31.0 + 2 * k
        mb.box(0, y, top - 0.3, 6.0, 2.0, 0.3, 'wood' if k % 2 else 'wood_light', bottom=True)
    for sx in (-2.82, 2.82):                  # kerb beams beyond the hedge
        mb.box(sx, 40.4, top, 0.36, 11.2, 0.28, 'wood_dark')
    for y in (36.8, 40.0, 43.2, 46.0):
        for sx in (-3.0, 3.0):
            tall = y == 46.0
            mb.cyl(sx, y, -8.5, 0.34, 8.5 + (1.3 if tall else 0.95), 'wood_dark', n=6)
            if tall:
                mb.octa((sx, y, 1.62), 0.3, 'glow_warm')
        if y > 37:
            mb.sweep([(-3.0, y, -0.6), (3.0, y, -4.6)], 0.14, 0.14, 'wood_dark')
            mb.sweep([(3.0, y, -0.6), (-3.0, y, -4.6)], 0.14, 0.14, 'wood_dark')
    for sx in (-3.0, 3.0):                    # rope rails
        ys = (36.8, 40.0, 43.2, 46.0)
        for ya, yb in zip(ys, ys[1:]):
            mb.sweep([(sx, ya, 0.82), (sx, (ya + yb) / 2, 0.55), (sx, yb, 0.82)], 0.07, 0.07, 'rope', n=3, caps=False)
    # stone retaining wall of the cove (the pier crosses it), with a low cap
    wall = [brg(b, 38.35) + (0.0,) for b in np.arange(-30, 30.01, 3.0)]
    mb.sweep(wall, 0, 0, 'concrete_light', profile=[(-0.45, -7.2), (0.45, -7.2), (0.45, 0.0), (-0.45, 0.0)],
             up=(0, 0, 1))
    for b0, b1 in ((-30, -5.6), (5.6, 30)):
        cap = [brg(b, 38.35) + (0.0,) for b in np.linspace(b0, b1, 9)]
        mb.sweep(cap, 0, 0, 'concrete_dark', profile=[(-0.6, 0.0), (0.6, 0.0), (0.6, 0.5), (-0.6, 0.5)], up=(0, 0, 1))
    # a little rowing boat moored at the pier
    hull = [(-1.7, -0.7), (0.9, -0.7), (1.9, 0), (0.9, 0.7), (-1.7, 0.7)]
    xf = XF((5.6, 43.5, 0), math.radians(80))
    mb.prism(hull, Z_NASI - 0.25, Z_NASI + 0.5, 'red', xf=xf, top_mat='wood_light', bottom=False)
    mb.box(5.6, 43.3, Z_NASI + 0.5, 1.5, 0.4, 0.12, 'wood', rz=math.radians(80))
    return mb.build(40)


OBJ['plaza'] = build_plaza()
OBJ['hedge'] = build_hedge()
OBJ['quay'] = build_quay()

# ============================================================================ tree templates


def _tpl_birch():
    t = MB()
    t.loft([ring(5, 0.42, 0), ring(5, 0.3, 4.0, 0.3), ring(5, 0.2, 8.0, 0.6)], 'birch_bark')
    for (a, z, w) in ((0.3, 1.6, 0.5), (2.6, 3.3, 0.42), (4.4, 2.3, 0.4), (1.5, 5.0, 0.34)):
        r = max(0.25, 0.47 - 0.03 * z)
        c, s = math.cos(a), math.sin(a)
        tx, ty = -s, c
        px, py = c * r, s * r
        t.quad((px - tx * w / 2, py - ty * w / 2, z), (px + tx * w / 2, py + ty * w / 2, z),
               (px + tx * w / 2, py + ty * w / 2, z + 0.28), (px - tx * w / 2, py - ty * w / 2, z + 0.28), 'black_rubber')
    t.blob((0, 0, 8.6), 2.7, 'leaf_light', sc=(1, 1, 1.12), rz=0.0, var=0)
    t.blob((1.5, 0.7, 6.7), 1.9, 'leaf_light', rz=1.0, var=1)
    t.blob((-1.3, -0.8, 7.0), 1.9, 'leaf', rz=2.0, var=2)
    return t


def _tpl_pine():
    t = MB()
    t.loft([ring(5, 0.45, 0), ring(5, 0.32, 5.0, 0.4), ring(5, 0.24, 9.2, 0.8)], 'pine_trunk')
    t.blob((0, 0, 10.2), 3.0, 'pine', sc=(1, 1, 0.6), rz=0.0, var=3)
    t.blob((1.3, -0.8, 8.4), 2.1, 'pine_dark', sc=(1, 1, 0.55), rz=1.3, var=4)
    return t


def _tpl_spruce():
    t = MB()
    t.loft([ring(5, 0.4, 0), ring(5, 0.3, 1.8)], 'trunk')
    t.loft([ring(6, 3.0, 1.3), ring(6, 1.0, 5.4, 0.3)], 'pine_dark')
    t.loft([ring(6, 2.35, 4.4, 0.5), ring(6, 0.75, 8.2, 0.8)], 'pine')
    t.loft([ring(6, 1.7, 7.3, 0.2)], 'pine_dark', apex=(0, 0, 11.6))
    return t


def _tpl_round():
    t = MB()
    t.loft([ring(5, 0.5, 0), ring(5, 0.34, 3.6, 0.5)], 'trunk')
    t.blob((0, 0, 6.0), 3.5, 'leaf', sc=(1, 1, 0.85), rz=0.0, var=5)
    t.blob((1.9, 0.9, 4.9), 2.2, 'leaf_dark', rz=0.7, var=0)
    t.blob((-1.5, -1.1, 7.2), 2.2, 'leaf_light', rz=2.2, var=1)
    return t


def _tpl_spruce_lo():
    t = MB()
    t.loft([ring(5, 3.0, 0.6), ring(5, 0.9, 6.2, 0.4)], 'pine_dark')
    t.loft([ring(5, 2.0, 5.0, 0.6)], 'pine', apex=(0, 0, 11.5))
    return t


def _tpl_decid_lo(leaf, trunk):
    t = MB()
    t.loft([ring(3, 0.5, 0), ring(3, 0.4, 3.6)], trunk)
    t.loft([ring(5, 1.7, 3.0), ring(5, 3.3, 5.2, 0.3), ring(5, 2.3, 7.6, 0.6)], leaf, apex=(0.2, 0.1, 8.7))
    return t


def _tpl_lump(seed):
    r_ = random.Random(seed)
    t = MB()
    n = 6
    ph = r_.uniform(0, 1)
    r0 = [(math.cos(ph + 2 * PI * i / n) * r_.uniform(0.9, 1.1), math.sin(ph + 2 * PI * i / n) * r_.uniform(0.9, 1.1),
           -0.45) for i in range(n)]
    r1 = [(math.cos(ph + 0.4 + 2 * PI * i / n) * r_.uniform(0.62, 0.86),
           math.sin(ph + 0.4 + 2 * PI * i / n) * r_.uniform(0.62, 0.86), r_.uniform(0.38, 0.62)) for i in range(n)]
    t.loft([r0, r1], 'X', apex=(r_.uniform(-0.15, 0.15), r_.uniform(-0.15, 0.15), 0.92))
    return t


T_BIRCH, T_PINE, T_SPRUCE, T_ROUND = _tpl_birch(), _tpl_pine(), _tpl_spruce(), _tpl_round()
T_SPRUCE_LO = _tpl_spruce_lo()
T_DECID_LO = _tpl_decid_lo('leaf', 'trunk')
T_BIRCH_LO = _tpl_decid_lo('leaf_light', 'birch_bark')
T_LUMPS = [_tpl_lump(100 + i) for i in range(4)]


def lump(mb, x, y, z, r, h, m):
    t = T_LUMPS[rng.randrange(4)]
    xf = XF((x, y, z), rng.uniform(0, 2 * PI), (r * rng.uniform(0.85, 1.15), r * rng.uniform(0.85, 1.15), h))
    base = len(mb.v)
    mb.v.extend(xf(v) for v in t.v)
    mi = mb._m(m)
    for f in t.f:
        mb.f.append(tuple(base + k for k in f))
        mb.fm.append(mi)


# ============================================================================ park (near)
near = MB('park_near')
GLOWS = ['glow_warm', 'glow_yellow', 'glow_pink', 'glow_blue', 'glow_green']


def festoon(mb, a, b, nb, sag, bulb='glow_warm', r=0.28, segs=4):
    pts = []
    for i in range(segs + 1):
        u = i / segs
        pts.append((lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u) - sag * 4 * u * (1 - u)))
    mb.sweep(pts, 0.075, 0.075, 'black_rubber', n=3, caps=False)
    for i in range(nb):
        u = (i + 0.5) / nb
        mb.octa((lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u) - sag * 4 * u * (1 - u) - 0.34), r,
                bulb if isinstance(bulb, str) else bulb[i % len(bulb)])


def lamp_pole(mb, x, y, h=5.6):
    mb.cyl(x, y, 0, 0.2, h, 'green_dark', n=4, r_top=0.14)
    mb.octa((x, y, h + 0.15), 0.26, 'gold')


def carousel(mb, x, y):
    n = 16
    xf = XF((x, y, 0))
    mb.cyl(x, y, 0, 7.4, 0.6, 'red', n=n, top_mat='wood_light')
    mb.cyl(x, y, 0.6, 1.7, 5.2, 'cream', n=8, top=False)
    mb.cyl(x, y, 2.3, 1.95, 1.3, 'gold', n=8, top=False)
    R = 8.0
    mb.loft([ring(n, R, 5.3), ring(n, R, 6.3)], (lambda k, i: 'cream' if k == 'b' else ('yellow' if i % 2 else 'red')),
            cap_bottom=True, xf=xf)
    mb.loft([ring(n, R + 0.35, 6.3)], (lambda k, i: 'red' if i % 2 else 'cream'), apex=(0, 0, 10.0), xf=xf)
    mb.blob((x, y, 10.3), 0.75, 'gold')
    cols = ['white_paint', 'pink', 'sky_blue', 'yellow']
    for i in range(8):
        a = 2 * PI * i / 8
        px, py = x + 5.5 * math.cos(a), y + 5.5 * math.sin(a)
        mb.cyl(px, py, 0.6, 0.14, 4.8, 'gold', n=3, top=False)
        mb.box(px, py, 1.3 + 0.8 * (i % 2), 2.0, 0.7, 1.2, cols[i % 4], rz=a + PI / 2, bottom=True)
    for i in range(n):
        a = 2 * PI * (i + 0.5) / n
        mb.octa((x + R * math.cos(a), y + R * math.sin(a), 5.1), 0.3, 'glow_warm')
    reserve(x, y, 10)


def bigtop(mb, x, y, b, c1='red', c2='cream', R=9.0):
    n = 16
    xf = XF((x, y, 0), face_tower(b))
    mb.loft([ring(n, R, 0), ring(n, R, 3.6)], (lambda k, i: c1 if i % 2 else c2), xf=xf)
    mb.loft([ring(n, R + 0.8, 3.5), ring(n, 1.3, 10.2)], (lambda k, i: c2 if (i % 2 and k != 'a') else c1),
            apex=(0, 0, 11.8), xf=xf)
    mb.cyl(x, y, 11.4, 0.16, 3.0, 'grey_dark', n=3)
    mb.extrude_y([(0.1, 12.9), (2.6, 13.6), (0.1, 14.3)], -0.08, 0.08, 'yellow', xf=XF((x, y, 0), face_tower(b)))
    # entrance porch facing the tower
    ex, ey = x - math.sin(math.radians(b)) * (R + 0.2), y - math.cos(math.radians(b)) * (R + 0.2)
    mb.box(ex, ey, 0, 3.4, 1.0, 3.0, 'pod_dark', rz=face_tower(b))
    reserve(x, y, R + 2.5)


def tent(mb, x, y, b, s=6.0, c1='white_paint', c2='teal', n=8):
    xf = XF((x, y, 0), face_tower(b) + PI / n)
    r = s / 2 / math.cos(PI / n)
    xq = XF((x, y, 0), face_tower(b))
    for (dx, dy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        q = xq((dx * s * 0.42, dy * s * 0.42, 0))
        mb.cyl(q[0], q[1], 0, 0.14, 2.7, 'white_paint', n=3, top=False)
    mb.loft([ring(n, r, 2.5), ring(n, r, 3.1)], (lambda k, i: 'cream' if k == 'b' else (c1 if i % 2 else c2)),
            cap_bottom=True, xf=xf)
    mb.loft([ring(n, r + 0.25, 3.1)], (lambda k, i: c2 if i % 2 else c1), apex=(0, 0, 3.1 + s * 0.48), xf=xf)
    reserve(x, y, s * 0.75)


def kiosk(mb, x, y, b, c1='red', c2='cream'):
    rz = face_tower(b)
    mb.box(x, y, 0, 4.2, 3.0, 2.7, 'cream', rz=rz, top=False)
    fx, fy = x - math.sin(math.radians(b)) * 1.7, y - math.cos(math.radians(b)) * 1.7
    mb.box(fx, fy, 0, 4.4, 0.6, 1.15, c1, rz=rz)
    mb.roof(x, y, 5.6, 4.6, rz, 2.7, 1.5, 'gable', c1, gable_mat=c2)
    mb.box(x, y, 3.6, 2.4, 0.3, 0.9, 'yellow', rz=rz)
    mb.octa((fx, fy, 2.2), 0.3, 'glow_warm')
    reserve(x, y, 4.0)


def helter(mb, x, y):
    n = 12
    xf = XF((x, y, 0))
    H, R0, R1 = 12.0, 3.3, 2.1
    rings_ = [ring(n, lerp(R0, R1, k / 6), H * k / 6) for k in range(7)]
    mb.loft(rings_, (lambda k, i: 'red' if k % 2 == 0 else 'white_paint'), xf=xf)
    mb.cyl(x, y, H, 3.0, 0.45, 'yellow', n=n, bottom=True)
    for i in range(4):
        a = PI / 4 + i * PI / 2
        mb.cyl(x + 2.4 * math.cos(a), y + 2.4 * math.sin(a), H + 0.45, 0.15, 2.0, 'white_paint', n=3, top=False)
    mb.loft([ring(n, 3.1, H + 2.45)], (lambda k, i: 'blue' if i % 2 else 'sky_blue'), apex=(0, 0, H + 5.6), xf=xf)
    mb.octa((x, y, H + 5.9), 0.4, 'glow_yellow')
    path = []
    turns, m = 2.5, 34
    for i in range(m + 1):
        u = i / m
        z = lerp(11.2, 1.0, u)
        rr = lerp(R0, R1, z / H) + 1.0
        a = 2 * PI * turns * u
        path.append((x + rr * math.cos(a), y + rr * math.sin(a), z))
    mb.sweep(path, 0.85, 0.2, 'yellow')
    reserve(x, y, 6.5)


def viking(mb, x, y, b):
    rz = face_tower(b)
    xf = XF((x, y, 0), rz)
    T = lambda p: xf(p)
    for sy in (-2.0, 2.0):
        for sx in (-5.2, 5.2):
            mb.sweep([T((sx, sy * 1.4, 0)), T((0, sy, 10.6))], 0.32, 0.32, 'blue', caps=False)
    mb.sweep([T((0, -2.3, 10.6)), T((0, 2.3, 10.6))], 0.45, 0.45, 'yellow')
    ang = math.radians(24)
    ca, sa = math.cos(ang), math.sin(ang)
    rot = lambda p: (p[0] * ca - p[1] * sa, p[0] * sa + p[1] * ca + 10.6)
    hull = [(-5.6, -6.0), (-3.6, -8.0), (0, -8.7), (3.6, -8.0), (5.6, -6.0), (4.5, -6.3), (3, -7.1), (0, -7.5),
            (-3, -7.1), (-4.5, -6.3)]
    mb.extrude_y([rot(p) for p in hull], -1.2, 1.2, 'red', xf=xf)
    for sx in (-2.2, 2.2):
        a0, a1 = rot((0, 0)), rot((sx, -7.2))
        mb.sweep([T((a0[0], 0, a0[1])), T((a1[0], 0, a1[1]))], 0.2, 0.2, 'yellow', caps=False)
    for sx in (-5.6, 5.6):
        q = rot((sx, -5.6))
        mb.octa(T((q[0], 0, q[1])), 0.45, 'gold')
    reserve(x, y, 7.5)


def dome_hall(mb, x, y, b):
    """Aquarium / planetarium: a white dome on a drum with a glowing window ring, plus a low hall."""
    n = 20
    xf = XF((x, y, 0), face_tower(b))
    R = 13.0
    zs = [0, 1.1, 2.3, 3.2]
    mb.loft([ring(n, R + 0.5, z) for z in zs],
            (lambda k, i: ('glow_window' if (i * 7) % 5 < 2 else 'window_dark') if k == 1 else 'concrete_light'), xf=xf)
    prof = [(R + 0.5, 3.2)] + [(R * math.cos(a), 3.2 + 9.5 * math.sin(a)) for a in np.radians([8, 28, 48, 66])]
    mb.loft([ring(n, r_, z_) for r_, z_ in prof], (lambda k, i: 'teal' if k == 0 else 'white_paint'),
            apex=(0, 0, 3.2 + 9.5), xf=xf)
    mb.octa((x, y, 13.3), 0.5, 'glow_blue')
    # hall on the side away from the tower, entrance block toward the tower
    hx, hy = x + math.sin(math.radians(b + 70)) * 17, y + math.cos(math.radians(b + 70)) * 17
    mb.building(hx, hy, 20, 11, face_tower(b + 70), 0, 5.0, 'concrete_light', roof='flat', roofm='teal', sink=0.5)
    mb.strips(hx, hy, 20, 11, face_tower(b + 70), 0, 5.0, 1, 0.12, 0.5)
    ex, ey = x - math.sin(math.radians(b)) * (R + 1.5), y - math.cos(math.radians(b)) * (R + 1.5)
    mb.box(ex, ey, 0, 7, 4, 3.8, 'teal', rz=face_tower(b), top_mat='concrete_light')
    reserve(x, y, R + 3)
    reserve(hx, hy, 11)


def gate(mb, x, y):
    for sx in (-7.0, 7.0):
        mb.box(x + sx, y, 0, 2.4, 2.4, 7.5, 'cream')
        mb.box(x + sx, y, 2.0, 2.6, 2.6, 0.8, 'red', top=False)
        mb.roof(x + sx, y, 3.0, 3.0, 0, 7.5, 2.2, 'pyramid', 'red')
        mb.octa((x + sx, y, 10.0), 0.4, 'glow_yellow')
        reserve(x + sx, y, 3)
    mb.box(x, y, 6.0, 11.6, 1.0, 1.9, 'red', bottom=True)
    mb.box(x, y, 6.3, 8.0, 1.3, 1.3, 'yellow', bottom=True)
    for i in range(7):
        mb.octa((x - 4.8 + 1.6 * i, y, 5.6), 0.3, GLOWS[i % 2])


def coaster(mb, b, r):
    """A second roller coaster as a backdrop: red track on white supports, a lift hill, a loop, a station."""
    a = math.radians(b)
    cx, cy = r * math.sin(a), r * math.cos(a)
    er = (math.sin(a), math.cos(a))
    et = (math.cos(a), -math.sin(a))
    W = lambda t, w, z: (cx + t * et[0] + w * er[0], cy + t * et[1] + w * er[1], z)
    ctrl = [(-24, -14, 3), (-8, -14, 3), (6, -14, 3.5), (18, -13.5, 8), (28, -10, 15), (33, 0, 20.5), (28, 10, 22),
            (16, 14, 15), (6, 14, 6.5)]
    Rl, zc = 6.3, 11.4
    for k in range(11):
        an = 2 * PI * k / 10
        ctrl.append((-6 - Rl * math.sin(an), 14 + 2.6 * k / 10, zc - Rl * math.cos(an)))
    ctrl += [(-20, 16.6, 6.5), (-30, 12, 10.5), (-35, 0, 12), (-32, -10, 7.5)]
    # 3D Catmull-Rom (uniform) through the control points
    path = []
    n = len(ctrl)
    for i in range(n):
        p0, p1, p2, p3 = (Vector(ctrl[(i + k) % n]) for k in (-1, 0, 1, 2))
        sub = max(2, int((p2 - p1).length / 3.2))
        for k in range(sub):
            t = k / sub
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                       + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
            path.append(W(q.x, q.y, q.z))
    frames = mb.sweep(path, 0.85, 0.3, 'red', closed=True)
    up0 = frames[0][3].z
    last = -99
    for i, (c, d, s, u) in enumerate(frames):
        inverted = u.z * up0 < 0.25
        if inverted or abs(d.z) > 0.8 or c.z < 2.6 or i - last < 2:
            continue
        # skip supports that would poke through a lower piece of track
        blocked = any((c.x - q.x) ** 2 + (c.y - q.y) ** 2 < 2.2 and q.z < c.z - 1.5 for (q, _, _, _) in frames)
        if blocked:
            continue
        mb.box(c.x, c.y, 0, 0.55, 0.55, c.z - 0.25, 'white_paint', rz=math.atan2(d.y, d.x), top=False)
        last = i
    # loop braces
    for t in (-6 - Rl - 0.9, -6 + Rl + 0.9):
        p = W(t, 15.3, 0)
        mb.box(p[0], p[1], 0, 0.6, 0.6, zc + 1.0, 'white_paint', rz=-a, top=True)
    # station with a striped roof
    p = W(-14, -17.8, 0)
    mb.box(p[0], p[1], 0, 22, 5.0, 2.4, 'cream', rz=-a, top_mat='wood_light')
    for t in (-24.5, -3.5):
        for w in (-19.8, -11.6):
            q = W(t, w, 0)
            mb.cyl(q[0], q[1], 0, 0.22, 6.2, 'white_paint', n=4, top=False)
    for k in range(6):
        q = W(-25 + 3.67 * k + 1.83, -15.6, 0)
        mb.roof(q[0], q[1], 9.4, 3.67, PI / 2 - a, 6.2, 1.6, 'gable', 'red' if k % 2 else 'yellow', gable_mat='cream')
    # a train on the lift hill
    lift = [i for i, (c, d, s, u) in enumerate(frames) if 7.5 < c.z < 16 and d.z > 0.25]
    cols = ['yellow', 'teal', 'yellow']
    for k, i in enumerate(lift[1:7:2]):
        c, d, s, u = frames[i]
        upv = u if u.z > 0 else -u
        o = c + upv * 0.3
        hw, hl, hh = 0.75, 1.25, 1.1
        corners = []
        for zz in (0, hh):
            for (sl, sw) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                corners.append(tuple(o + d * (hl * sl) + s * (hw * sw) + upv * zz))
        # make the ring counter-clockwise about the up vector
        if d.cross(s).dot(upv) < 0:
            corners = [corners[i_] for i_ in (3, 2, 1, 0, 7, 6, 5, 4)]
        mb.loft([corners[:4], corners[4:]], cols[k % 3], cap_top=True, cap_bottom=True)
    for t in np.linspace(-34, 32, 9):
        reserve(*W(t, -9, 0)[:2], 9)
        reserve(*W(t, 9, 0)[:2], 9)


def big_wheel(mb, x, y, R=17.0, hub=20.5):
    """The big Ferris wheel, face-on to the tower, with rim lights."""
    ax = Vector((-x, -y, 0)).normalized()          # axle points at the tower
    hd = Vector((-ax.y, ax.x, 0))
    C = Vector((x, y, hub))
    n = 28
    rim = [tuple(C + hd * (R * math.cos(PI / 2 + 2 * PI * i / n)) + Vector((0, 0, R * math.sin(PI / 2 + 2 * PI * i / n))))
           for i in range(n)]
    mb.sweep(rim, 0.55, 0.3, 'white_paint', closed=True)
    inner = [tuple(C + (Vector(p) - C) * 0.55) for p in rim]
    mb.sweep(inner, 0.3, 0.2, 'red', closed=True)
    cols = ['red', 'yellow', 'teal', 'blue', 'pink', 'orange', 'green']
    for i in range(14):
        a = PI / 2 + 2 * PI * i / 14
        dirv = hd * math.cos(a) + Vector((0, 0, math.sin(a)))
        mb.sweep([tuple(C + dirv * 1.2), tuple(C + dirv * (R - 0.2))], 0.22, 0.22, 'white_paint', side=tuple(ax), caps=False)
        g = C + dirv * R
        mb.box(g.x, g.y, g.z - 2.9, 2.4, 2.2, 2.2, cols[i % 7], rz=math.atan2(hd.y, hd.x), bottom=True,
               top_mat='white_paint')
    for i in range(n):
        p = Vector(rim[i]) + ax * 0.75
        mb.octa(tuple(p), 0.42, 'glow_yellow' if i % 2 else 'glow_pink')
    mb.sweep([tuple(C - ax * 2.4), tuple(C + ax * 2.4)], 1.5, 1.5, 'red', n=8, side=(0, 0, 1))
    mb.octa(tuple(C + ax * 2.6), 0.9, 'glow_white')
    for sa in (-2.3, 2.3):
        for sh in (-9.5, 9.5):
            foot = Vector((x, y, 0)) + ax * sa * 1.6 + hd * sh
            mb.sweep([tuple(foot), tuple(C + ax * sa)], 0.5, 0.5, 'white_paint', side=tuple(ax), caps=False)
    mb.box(x, y, 0, 26, 7, 1.2, 'cream', rz=math.atan2(hd.y, hd.x), top_mat='wood_light')
    reserve(x, y, 16)


def flower_bed(mb, b, r, col):
    x, y = brg(b, r)
    xf = XF((x, y, 0), face_tower(b), (1.7, 1.0, 1.0))
    mb.loft([ring(8, 1.7, 0.0), ring(8, 1.55, 0.3)], 'dirt', xf=xf)
    mb.loft([ring(8, 1.55, 0.3), ring(8, 1.0, 0.72, 0.3)], col, apex=(0, 0, 0.9), xf=xf)


# ---- park layout (bearing, radius)
coaster(near, 208, 102)
carousel(near, *brg(82, 64))
helter(near, *brg(55, 62))
_x, _y = brg(165, 88)
bigtop(near, _x, _y, 165)
_x, _y = brg(262, 66)
viking(near, _x, _y, 262)
_x, _y = brg(140, 86)
dome_hall(near, _x, _y, 140)
gate(near, 0, -132)
_x, _y = brg(292, 70)
bigtop(near, _x, _y, 292, 'blue', 'white_paint', R=6.5)
for (b, r, c1, c2) in ((240, 71, 'white_paint', 'teal'), (118, 70, 'yellow', 'red'), (100, 74, 'white_paint', 'pink'),
                        (188, 74, 'white_paint', 'blue'), (38, 60, 'white_paint', 'teal'), (318, 61, 'yellow', 'red'),
                        (128, 112, 'white_paint', 'teal'), (176, 108, 'yellow', 'pink'), (150, 118, 'white_paint', 'red')):
    _x, _y = brg(b, r)
    tent(near, _x, _y, b, 6.0 if r < 100 else 7.5, c1, c2)
for (b, r, c1, c2) in ((66, 70.5, 'red', 'cream'), (105, 56, 'teal', 'cream'), (152, 70.5, 'blue', 'cream'),
                        (195, 70.5, 'red', 'cream'), (228, 56, 'yellow', 'cream'), (276, 55, 'teal', 'cream'),
                        (305, 70.5, 'red', 'cream'), (180 + 12, 100, 'yellow', 'cream'), (168, 122, 'teal', 'cream')):
    _x, _y = brg(b, r)
    kiosk(near, _x, _y, b, c1, c2)

# ring of festoon lights around the plaza (just outside the camera zone) and along the avenue
_poles = []
for b in range(40, 321, 10):
    x, y = brg(b, 50.0)
    z, k = gq(x, y)
    if k == 'grass' and z > -0.05:
        _poles.append((x, y))
        lamp_pole(near, x, y)
        reserve(x, y, 1.5)
for (a, b_) in zip(_poles, _poles[1:]):
    if math.dist(a, b_) < 10:
        festoon(near, (a[0], a[1], 5.5), (b_[0], b_[1], 5.5), 4, 0.9)
_ave = [(-6.6, y) for y in (-70, -84, -98, -112, -124)]
for i, (x, y) in enumerate(_ave):
    lamp_pole(near, x, y)
    lamp_pole(near, -x, y)
    reserve(x, y, 1.5)
    reserve(-x, y, 1.5)
    festoon(near, (x, y, 5.5), (-x, y, 5.5), 5, 1.0, bulb=['glow_warm', 'glow_pink', 'glow_yellow', 'glow_blue'])
    if i:
        for sgn in (1, -1):
            festoon(near, (sgn * x, _ave[i - 1][1], 5.5), (sgn * x, y, 5.5), 4, 0.8)
# flower beds on the lawn just outside the hedge
for i, b in enumerate(range(30, 331, 20)):
    flower_bed(near, b, 40.5, ('pink', 'yellow', 'red', 'magenta')[i % 4])

# ---- trees of the park
TREES = {'birch': T_BIRCH, 'pine': T_PINE, 'spruce': T_SPRUCE, 'round': T_ROUND}


def plant(mb, kind, x, y, z, sc=None):
    sc = sc or rng.uniform(1.0, 1.45)
    mb.inst(TREES[kind], (x, y, z - 0.15), rng.uniform(0, 2 * PI), (sc, sc, sc * rng.uniform(0.92, 1.12)))
    reserve(x, y, 2.4 * sc)


_n_near = 0
for _try in range(7000):
    if _n_near >= 185:
        break
    b = rng.uniform(0, 360)
    r = math.sqrt(rng.uniform(53.5 ** 2, 176 ** 2))
    if _try < 500:                                # the two northern corners of the peninsula first
        b = rng.choice((rng.uniform(26, 68), rng.uniform(292, 334)))
        r = rng.uniform(53.5, 76)
    x, y = brg(b, r)
    if not in_park(x, y) or (abs(x) < 9 and y < -58):
        continue
    z, k = gq(x, y)
    if k not in ('grass', 'grass_dark') or z < -2.5:
        continue
    if r < 59 and rng.random() < 0.45:
        continue
    if 58.5 < r < 65.5:
        continue
    if _try < 500 and _n_near >= 26:
        continue
    if occupied(x, y, 3.6):
        continue
    north = y > 20
    shore = _fd is not None and z < -0.1
    if north or shore:
        kind = rng.choice(['pine', 'pine', 'birch', 'birch', 'spruce'])
    else:
        kind = rng.choice(['round', 'round', 'birch', 'birch', 'spruce', 'pine'])
    plant(near, kind, x, y, z)
    _n_near += 1
# a few bare rocks on the shore
for _try in range(60):
    b = rng.uniform(0, 360)
    x, y = brg(b, rng.uniform(60, 96))
    z, k = gq(x, y)
    if k == 'rock' and in_park(x, y) and math.hypot(x, y) > 47:
        s = rng.uniform(0.9, 1.8)
        near.blob((x, y, z + 0.2 * s), s, 'rock_dark' if rng.random() < 0.5 else 'rock', sc=(1.2, 1, 0.7))
OBJ['park_near'] = near.build(40)
print(f'[env] park_near done ({time.time() - T0:.1f}s)')

# ============================================================================ park (far) + Pyynikki + Pispala
far = MB('park_far')
_x, _y = -44.0, -152.0
big_wheel(far, _x, _y)
for (x, y, c1, c2) in ((-76, -146, 'white_paint', 'red'), (22, -150, 'yellow', 'teal'), (38, -158, 'white_paint', 'blue')):
    tent(far, x, y, 180, 7.5, c1, c2)


def boat_hull(mb, x, y, z, L, Wd, rz, hull='white_paint', deck='wood_light', h=0.9):
    poly = [(-L / 2, -Wd / 2), (L / 4, -Wd / 2), (L / 2, 0), (L / 4, Wd / 2), (-L / 2, Wd / 2)]
    mb.prism(poly, z - 0.3, z + h, hull, xf=XF((x, y, 0), rz), top_mat=deck)


def harbour(mb):
    """Mustalahti: two piers, small boats and a white lake steamer."""
    for (px, py, ang, L) in ((127, -80, 78, 24), (166, -72, 96, 26)):
        a = math.radians(ang)
        cx, cy = px + math.cos(a) * L / 2, py + math.sin(a) * L / 2
        mb.box(cx, cy, Z_NASI + 0.5, L, 3.0, 0.5, 'wood', rz=a, bottom=True)
        for t in (0.15, 0.5, 0.95):
            for s in (-1.3, 1.3):
                qx = px + math.cos(a) * L * t - math.sin(a) * s
                qy = py + math.sin(a) * L * t + math.cos(a) * s
                mb.cyl(qx, qy, Z_NASI - 1.0, 0.3, 2.4, 'wood_dark', n=5)
        mb.octa((px + math.cos(a) * L, py + math.sin(a) * L, Z_NASI + 2.4), 0.45, 'glow_warm')
        mb.cyl(px + math.cos(a) * L, py + math.sin(a) * L, Z_NASI + 1.0, 0.12, 1.2, 'grey_dark', n=3, top=False)
    cols = ['red', 'blue', 'white_paint', 'teal', 'yellow', 'white_paint']
    for i, (x, y, ang) in enumerate(((122, -66, 170), (126, -56, 172), (134, -70, -8), (138, -60, -10),
                                      (160, -58, 5), (158, -47, 8))):
        boat_hull(mb, x, y, Z_NASI, 5.5, 2.0, math.radians(ang), hull=cols[i])
        mb.box(x, y, Z_NASI + 0.9, 1.8, 1.3, 0.9, 'white_paint', rz=math.radians(ang))
    # steamer
    x, y, a = 174.0, -52.0, math.radians(96)
    boat_hull(mb, x, y, Z_NASI, 22, 5.0, a, hull='white_paint', deck='wood_light', h=1.6)
    mb.box(x - math.cos(a) * 1.5, y - math.sin(a) * 1.5, Z_NASI + 1.6, 12, 3.6, 2.0, 'white_paint', rz=a, top_mat='cream')
    mb.strips(x - math.cos(a) * 1.5, y - math.sin(a) * 1.5, 12, 3.6, a, Z_NASI + 1.6, 2.0, 1, 0.1, 0.7)
    mb.cyl(x - math.cos(a) * 2.5, y - math.sin(a) * 2.5, Z_NASI + 3.6, 0.8, 2.6, 'black_rubber', n=8, top_mat='red')
    mb.box(x + math.cos(a) * 3.2, y + math.sin(a) * 3.2, Z_NASI + 3.6, 3.0, 2.8, 1.5, 'white_paint', rz=a, top_mat='cream')


harbour(far)


def pyynikki(mb):
    """Observation tower on the ridge (stone, octagonal) with a small cafe."""
    x, y = -170.0, -388.0
    z = gz(x, y)
    mb.cyl(x, y, z - 2, 4.4, 17, 'rock', n=8, r_top=3.7, top=False)
    mb.cyl(x, y, z + 15, 4.5, 1.6, 'concrete_light', n=8, top_mat='rock_dark')
    mb.cyl(x, y, z + 16.6, 1.6, 2.4, 'rock', n=6, top_mat='roof_red')
    mb.octa((x, y, z + 19.6), 0.6, 'glow_warm')
    for a in (0.4, 2.0, 3.6, 5.2):
        mb.octa((x + 4.2 * math.cos(a), y + 4.2 * math.sin(a), z + 11), 0.7, 'glow_window')
    mb.building(x + 9, y + 3, 12, 8, 0.2, gz(x + 9, y + 3), 4.0, 'plaster_cream', roof='hip', roofm='roof_red', rh=2.2)
    reserve(x, y, 9)
    reserve(x + 9, y + 3, 8)


pyynikki(far)


def pispala(mb):
    """Small colourful wooden houses on the north slope of the ridge, plus the shot tower."""
    cols = ['red', 'plaster_yellow', 'plaster_cream', 'white_paint', 'plaster_green', 'plaster_blue', 'red_dark',
            'plaster_pink']
    n = 0
    for _ in range(400):
        if n >= 46:
            break
        x, y = rng.uniform(-640, -300), rng.uniform(-325, -258)
        z, k = gq(x, y)
        if k in WATER_KINDS or k == 'asphalt' or occupied(x, y, 7) or road_dist_fine(x, y) < 12:
            continue
        L, D = rng.uniform(8, 12), rng.uniform(6, 8)
        mb.building(x, y, L, D, rng.uniform(-0.25, 0.25), z, rng.uniform(4.5, 7), rng.choice(cols),
                    roof=rng.choice(['gable', 'gable', 'hip']), roofm=rng.choice(['roof_grey', 'roof_red', 'roof_dark']),
                    rh=2.6, sink=4)
        if rng.random() < 0.4:
            mb.octa((x, y - D / 2 - 0.5, z + 2.5), 0.7, 'glow_window')
        reserve(x, y, 7.5)
        n += 1
    x, y = -505.0, -338.0
    z = gz(x, y)
    mb.cyl(x, y, z - 2, 2.6, 26, 'red_dark', n=6, r_top=2.0, top=False)
    mb.cyl(x, y, z + 24, 2.9, 2.6, 'white_paint', n=6, top_mat='roof_dark')
    mb.cone(x, y, z + 26.6, 2.9, 3.0, 'roof_dark', n=6)
    reserve(x, y, 6)


pispala(far)

FOREST_KINDS = {'leaf_dark', 'pine', 'grass_dark', 'pine_dark', 'hill_far'}


def forest(mb, n_target, bbox, pred, rmin, rmax, mats, tree_p=0.0, tries=None, gap=0.75):
    """Scatter lumpy canopy masses (and optionally simple trees) on forest-coloured ground."""
    n = 0
    for _ in range(tries or n_target * 14):
        if n >= n_target:
            break
        x, y = rng.uniform(bbox[0], bbox[2]), rng.uniform(bbox[1], bbox[3])
        if not pred(x, y):
            continue
        z, k = gq(x, y)
        if k not in FOREST_KINDS:
            continue
        if k == 'grass_dark' and rng.random() < 0.7:
            continue
        if rng.random() < tree_p:
            if occupied(x, y, 3.0):
                continue
            sc = rng.uniform(0.9, 1.5)
            kind = rng.random()
            tpl = T_SPRUCE_LO if kind < 0.5 else (T_DECID_LO if kind < 0.8 else T_BIRCH_LO)
            mb.inst(tpl, (x, y, z - 0.2), rng.uniform(0, 6.3), sc)
            reserve(x, y, 2.6 * sc)
        else:
            r = rng.uniform(rmin, rmax)
            if occupied(x, y, r * gap):
                continue
            lump(mb, x, y, z, r, r * rng.uniform(0.55, 0.8), rng.choice(mats))
            reserve(x, y, r * gap)
        n += 1
    return n


def _mid_pred(x, y):
    r = math.hypot(x, y)
    return 150 < r < 470 and not in_park(x, y) and road_dist_fine(x, y) > 9 and not in_city(x, y)


_nf = forest(far, 330, (-470, -480, 110, -100), _mid_pred, 9, 17, ['leaf_dark', 'pine', 'leaf', 'pine', 'leaf_dark'],
             tree_p=0.5)
# the strip between the park and the road: rows of trees
for x in range(-120, 100, 13):
    if abs(x) < 12:
        continue
    y = -181 + rng.uniform(-1.5, 1.5)
    z, k = gq(x, y)
    if k in FOREST_KINDS and not occupied(x, y, 3):
        far.inst(T_DECID_LO if (x // 13) % 2 else T_BIRCH_LO, (x, y, z - 0.2), rng.uniform(0, 6.3), rng.uniform(1.0, 1.3))
for _i, (x, y) in enumerate(resample(ROAD, lambda p: 38.0, closed=False)):
    if x < -620 or x > 100:
        continue
    sgn = 1 if _i % 2 else -1
    yy = y + sgn * (ROAD_HW + 1.5)
    z = gz(x, yy)
    far.cyl(x, yy, z, 0.25, 5.0, 'grey_dark', n=3, top=False)
    far.octa((x, yy, z + 5.5), 0.75, 'glow_warm')
OBJ['park_far'] = far.build(40)
print(f'[env] park_far done: {_nf} forest items ({time.time() - T0:.1f}s)')

# ============================================================================ city
city = MB('city')
WALLS = ['plaster_cream'] * 4 + ['plaster_pink'] * 2 + ['plaster_green'] * 2 + ['plaster_blue'] * 2 + \
        ['concrete_light'] * 2 + ['plaster_yellow'] * 2 + ['brick']
ROOFS = ['roof_grey'] * 5 + ['roof_dark'] * 3 + ['roof_red'] * 2
CITY_C = (380.0, -300.0)


def chimney(mb, x, y, h, r=2.3, m='brick', band='white_paint'):
    z = gz(x, y)
    mb.cyl(x, y, z - 2, r, h * 0.86 + 2, m, n=8, r_top=r * 0.68, top=False)
    mb.cyl(x, y, z + h * 0.86, r * 0.75, h * 0.06, band, n=8, r_top=r * 0.72, top=False)
    mb.cyl(x, y, z + h * 0.92, r * 0.72, h * 0.08, m, n=8, r_top=r * 0.66, top_mat='black_rubber')
    reserve(x, y, r + 1)


def mill(mb, x, y, L, D, rot, h, wall='brick', roofm='roof_grey', floors=3, roof='gable'):
    z = gz(x, y)
    mb.building(x, y, L, D, rot, z, h, wall, roof=roof, roofm=roofm, rh=min(D * 0.3, 4.5), sink=6)
    mb.strips(x, y, L, D, rot, z, h, floors, 0.45, 0.3)
    reserve(x, y, max(L, D) * 0.5)


def sawtooth(mb, x, y, L, D, rot, h, n=4):
    z = gz(x, y)
    mb.building(x, y, L, D, rot, z, h, 'brick', roof='flat', roofm='roof_grey', sink=5)
    xf = XF((x, y, 0), rot)
    w = L / n
    for k in range(n):
        x0 = -L / 2 + k * w
        mb.extrude_y([(x0, z + h), (x0 + w, z + h), (x0 + w * 0.25, z + h + 2.6)], -D / 2, D / 2, 'roof_grey', xf=xf)


def church(mb, x, y, rot, wall, roofm, spire_m, spire_h, nave=(34, 15, 13), twin=False):
    z = gz(x, y)
    L, D, h = nave
    mb.building(x, y, L, D, rot, z, h, wall, roof='gable', roofm=roofm, rh=D * 0.55, sink=4)
    c, s = math.cos(rot), math.sin(rot)
    # transept
    mb.building(x + c * L * 0.18, y + s * L * 0.18, D * 0.7, D * 1.7, rot, z, h * 0.9, wall, roof='gable', roofm=roofm,
                rh=D * 0.4, sink=4)
    # tower + spire at the west end
    tx, ty = x - c * (L / 2 + 3), y - s * (L / 2 + 3)
    tw = 8.5
    th = h + 14
    mb.box(tx, ty, z - 4, tw, tw, th + 4, wall, rz=rot, top=False)
    mb.box(tx, ty, z + th - 5, tw + 0.5, tw + 0.5, 2.2, 'window_dark', rz=rot, top=False)
    mb.octa((tx - c * (tw / 2 + 0.4), ty - s * (tw / 2 + 0.4), z + th - 9), 1.1, 'glow_window')
    xf = XF((tx, ty, 0), rot + PI / 4)
    mb.loft([ring(4, tw * 0.72, z + th), ring(4, tw * 0.3, z + th + spire_h * 0.3)], spire_m,
            apex=(0, 0, z + th + spire_h), xf=xf)
    for dx in (-1, 1):
        for dy in (-1, 1):
            px, py = tx + (dx * c - dy * s) * tw * 0.42, ty + (dx * s + dy * c) * tw * 0.42
            mb.cone(px, py, z + th, 1.2, 6.5, spire_m, n=4)
    if twin:
        for sgn in (-1, 1):
            px, py = x + c * (L / 2 - 2) - s * sgn * (D / 2 + 1), y + s * (L / 2 - 2) + c * sgn * (D / 2 + 1)
            mb.box(px, py, z - 3, 5, 5, h + 9, wall, rz=rot, top=False)
            mb.roof(px, py, 5.4, 5.4, rot, z + h + 6, spire_h * 0.5, 'pyramid', spire_m)
    reserve(x, y, L * 0.6)


def stadium(mb, x, y, rot):
    z = gz(x, y) + 0.2
    n = 20
    xf = XF((x, y, 0), rot)
    a, b = 28.0, 20.0
    mb.loft([ring(n, a, z - 4, ry=b), ring(n, a, z + 9, ry=b), ring(n, a - 2.2, z + 9, ry=b - 2.2),
             ring(n, 17.5, z + 1.2, ry=11.5), ring(n, 14.5, z + 1.2, ry=8.5)],
            (lambda k, i: ('concrete_light', 'grey_light', 'blue' if (i // 2) % 2 else 'sky_blue', 'roof_red', 'grass')
             [k if k != 't' else 4]), cap_top=True, xf=xf)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = xf((sx * 24, sy * 17, 0))
            mb.cyl(p[0], p[1], z, 0.5, 20, 'grey', n=4, top=False)
            mb.box(p[0], p[1], z + 19.5, 2.6, 0.9, 1.7, 'glow_white', rz=rot, bottom=True)
    reserve(x, y, 30)


def bridge(mb, y, width=10.0, lamps=True, arches=2):
    """Stone arch bridge over the rapids: deck slab, piers and arch spandrels (all convex pieces)."""
    xc = chan_x(y)
    x0, x1 = xc - CHAN_HW - 5, xc + CHAN_HW + 5
    zb = max(gz(x0 - 2, y), gz(x1 + 2, y)) + 0.45
    zw = wl_step(y)
    L = x1 - x0
    zs = zb - 1.0                                  # deck soffit
    ya, yb = y - width / 2, y + width / 2
    mb.box(xc, y, zs, L, width, 1.0, 'concrete_light', bottom=True)
    pw = 2.2
    span = (L - pw) / arches
    for k in range(arches + 1):
        px = x0 + pw / 2 + k * span
        mb.box(px, y, zw - 2.5, pw, width + (0.8 if 0 < k < arches else 0), zs - zw + 2.5, 'concrete_light')
    zspring = zw + 0.4
    rise = zs - zspring - 0.25
    m = 6
    for k in range(arches):
        xl = x0 + pw + k * span
        xr = xl + span - pw
        mid, hr = (xl + xr) / 2, (xr - xl) / 2
        c = [(mid + hr * math.cos(PI * i / m), zspring + rise * math.sin(PI * i / m)) for i in range(m + 1)]
        for i in range(m):
            (xa_, za_), (xb_, zb2) = c[i], c[i + 1]
            mb.quad((xb_, ya, zb2), (xa_, ya, za_), (xa_, ya, zs), (xb_, ya, zs), 'concrete_light')
            mb.quad((xa_, yb, za_), (xb_, yb, zb2), (xb_, yb, zs), (xa_, yb, zs), 'concrete_light')
            mb.quad((xa_, ya, za_), (xb_, ya, zb2), (xb_, yb, zb2), (xa_, yb, za_), 'concrete')
    for sy in (-1, 1):
        mb.box(xc, y + sy * (width / 2 - 0.3), zb, L, 0.6, 0.9, 'concrete')
        if lamps:
            for t in (0.2, 0.5, 0.8):
                px = lerp(x0, x1, t)
                mb.cyl(px, y + sy * (width / 2 - 0.3), zb + 0.9, 0.22, 3.0, 'grey_dark', n=3, top=False)
                mb.octa((px, y + sy * (width / 2 - 0.3), zb + 4.2), 0.75, 'glow_warm')


def city_block(mb, cx, cy, style, hb, detail):
    S = 44.0
    zs = [gz(cx + dx, cy + dy) for dx in (-22, 22) for dy in (-22, 22)] + [gz(cx, cy)]
    zg = max(zs) + 0.4 + math.hypot(cx, cy) / 700.0
    mb.box(cx, cy, min(zs) - 2, S, S, zg - min(zs) + 2, 'paving')
    d = 12.0
    bars = []
    if style == 'perimeter' or style == 'U':
        bars = [(cx, cy + 15.6, S - 1, d), (cx, cy - 15.6, S - 1, d), (cx + 15.5, cy, d, 22), (cx - 15.5, cy, d, 22)]
        if style == 'U':
            bars.pop(rng.randrange(4))
    elif style == 'slabs':
        if rng.random() < 0.5:
            bars = [(cx + rng.uniform(-3, 3), cy + dy, rng.uniform(26, 36), 9.5) for dy in (15, 0, -15)]
        else:
            bars = [(cx + dx, cy + rng.uniform(-3, 3), 9.5, rng.uniform(26, 36)) for dx in (-15, 0, 15)]
    elif style == 'simple':
        if rng.random() < 0.5:
            bars = [(cx, cy + 13, S - 4, 15), (cx, cy - 13, S - 4, 15)]
        else:
            bars = [(cx - 13, cy, 15, S - 4), (cx + 13, cy, 15, S - 4)]
    elif style == 'tower':
        bars = [(cx, cy - 14, S - 2, 14), (cx - 14, cy + 8, 14, 26)]
        h = hb * rng.uniform(1.7, 2.3)
        w = rng.choice(['concrete_light', 'plaster_cream', 'white_paint'])
        mb.building(cx + 9, cy + 9, 15, 15, 0, zg, h, w, roof='flat', roofm='roof_dark', sink=1)
        mb.strips(cx + 9, cy + 9, 15.01, 15, 0, zg, h, 5, 0.3, 0.45, dark=detail)
    elif style == 'park':
        mb.box(cx, cy, zg, S - 5, S - 5, 0.7, 'grass')
        for _ in range(6):
            x, y = cx + rng.uniform(-16, 16), cy + rng.uniform(-16, 16)
            r = rng.uniform(4, 6.5)
            lump(mb, x, y, zg + 2.5, r, r * 0.9, rng.choice(['leaf', 'leaf_dark', 'leaf_light']))
        return
    wall0 = rng.choice(WALLS)
    for (bx, by, L, D) in bars:
        h = hb * rng.uniform(0.8, 1.25)
        wall = wall0 if rng.random() < 0.35 else rng.choice(WALLS)
        flat = style == 'slabs' and rng.random() < 0.3
        mb.building(bx, by, L, D, 0, zg, h, wall, roof='flat' if flat else 'hip', roofm=rng.choice(ROOFS),
                    rh=min(L, D) * 0.28, sink=1)
        if detail:
            mb.strips(bx, by, L, D, 0, zg, h, 2 if h < 13 else 3, 0.45, 0.3, dark=(style == 'slabs'))
    if style in ('perimeter', 'U') and detail:
        mb.box(cx, cy, zg, 14, 14, 0.8, 'grass_dark')
        lump(mb, cx + rng.uniform(-2, 2), cy + rng.uniform(-2, 2), zg + 2.2, 4.5, 4.2, rng.choice(['leaf', 'leaf_dark']))


def small_block(mb, cx, cy):
    S = 20.0
    zs = [gz(cx + dx, cy + dy) for dx in (-10, 10) for dy in (-10, 10)]
    zg = max(zs) + 0.4 + math.hypot(cx, cy) / 700.0
    kind = rng.choice(['house', 'house', 'two', 'green'])
    if kind == 'green':
        mb.box(cx, cy, min(zs) - 2, S, S, zg - min(zs) + 2, 'paving', top_mat='grass')
        for _ in range(2):
            r = rng.uniform(3.5, 5)
            lump(mb, cx + rng.uniform(-5, 5), cy + rng.uniform(-5, 5), zg + 2, r, r * 0.9, rng.choice(['leaf', 'leaf_dark']))
        return
    mb.box(cx, cy, min(zs) - 2, S, S, zg - min(zs) + 2, 'paving')
    if kind == 'house':
        mb.building(cx, cy, rng.uniform(13, 17), rng.uniform(10, 13), rng.choice((0, PI / 2)), zg, rng.uniform(7, 11),
                    rng.choice(WALLS), roof='hip', roofm=rng.choice(ROOFS), rh=3.2, sink=1)
    else:
        rot = rng.choice((0, PI / 2))
        for o in (-5.2, 5.2):
            mb.building(cx + (o if rot else 0), cy + (0 if rot else o), 17, 7.5, rot, zg, rng.uniform(6, 10),
                        rng.choice(WALLS), roof='hip', roofm=rng.choice(ROOFS), rh=2.4, sink=1)


COLS_W = [306, 250, 194, 138]
COLS_E = [434, 490, 546, 602, 674, 730, 786]
ROWS = [-54, -110, -166, -222, -278, -340, -396, -452, -508, -564, -620, -676]
SPECIAL = {(306, -110): 'finlayson', (306, -166): 'finlayson', (434, -110): 'tampella', (434, -166): 'tampella',
           (490, -166): 'cathedral', (306, -278): 'square', (194, -340): 'alexander', (434, -222): 'park',
           (434, -278): 'park', (602, -278): 'station', (602, -340): 'station', (674, -278): 'torni',
           (674, -340): 'arena', (434, -452): 'stadium', (434, -508): 'stadium', (546, -54): 'power',
           (602, -54): 'power', (250, -222): 'park'}
_nblocks = 0
for cx in COLS_W + COLS_E:
    for cy in ROWS:
        sp = SPECIAL.get((cx, cy))
        if sp and sp != 'park':
            continue
        ok = True
        for dx in (-23, 0, 23):
            for dy in (-23, 0, 23):
                if gq(cx + dx, cy + dy)[1] != 'street':
                    ok = False
        if not ok:
            for sx_ in (-11.5, 11.5):
                for sy_ in (-11.5, 11.5):
                    qx, qy = cx + sx_, cy + sy_
                    if all(gq(qx + dx, qy + dy)[1] == 'street' for dx, dy in ((-10.5, -10.5), (10.5, -10.5), (10.5, 10.5),
                                                                              (-10.5, 10.5), (0, 0))):
                        small_block(city, qx, qy)
                        reserve(qx, qy, 14)
            continue
        dc = math.hypot(cx - CITY_C[0], cy - CITY_C[1])
        hb = lerp(15.0, 9.5, ss(120, 400, dc))
        detail = dc < 290
        if sp == 'park':
            style = 'park'
        elif cx in (138, 194) and cy > -300:
            style = 'slabs'
        elif not detail:
            style = rng.choice(['simple', 'simple', 'simple', 'U', 'slabs', 'park'])
        else:
            style = rng.choice(['perimeter'] * 6 + ['U'] * 3 + ['tower'] + ['slabs'])
        city_block(city, cx, cy, style, hb, detail)
        reserve(cx, cy, 30)
        _nblocks += 1

# --- Finlayson (west bank) and Tampella (east bank): red-brick mills with tall chimneys
mill(city, 312, -100, 56, 16, 0.0, 15, floors=4)
mill(city, 341, -143, 16, 62, 0.0, 19, floors=5, roofm='roof_dark')
mill(city, 302, -178, 44, 15, 0.0, 12, floors=3)
sawtooth(city, 304, -139, 40, 30, 0.0, 7, n=5)
chimney(city, 327, -119, 54)
chimney(city, 290, -160, 36, r=1.9)
mill(city, 411, -128, 16, 66, 0.0, 17, floors=4)
mill(city, 448, -98, 50, 16, 0.0, 14, floors=3, roofm='roof_dark')
mill(city, 450, -166, 46, 18, 0.0, 12, floors=3)
sawtooth(city, 446, -132, 36, 34, 0.0, 7, n=4)
chimney(city, 432, -150, 50)
chimney(city, 470, -118, 38, r=1.9)
# --- Naistenlahti power plant on the lake shore
_z = gz(585, -50)
city.building(585, -50, 46, 26, 0.1, _z, 20, 'concrete', roof='flat', roofm='grey_dark', sink=5)
city.building(556, -58, 26, 20, 0.1, gz(556, -58), 12, 'brick', roof='flat', roofm='roof_grey', sink=5)
city.strips(585, -50, 46, 26, 0.1, _z, 20, 3, 0.35, 0.35)
chimney(city, 606, -40, 64, r=2.8, m='concrete_light', band='red')
reserve(585, -50, 30)
# --- churches
church(city, 492, -168, 0.0, 'concrete', 'roof_red', 'roof_red', 34, nave=(32, 16, 13), twin=True)   # cathedral
church(city, 196, -340, 0.0, 'brick', 'roof_grey', 'copper', 46, nave=(34, 14, 13))                  # Alexander church
# --- central square with the town hall, the old church and a lone chimney
_z = gz(306, -278)
city.box(306, -278, _z - 2, 44, 44, 2.35, 'paving', top_mat='paving')
city.building(296, -266, 28, 15, 0, _z + 0.35, 12, 'plaster_cream', roof='hip', roofm='copper', rh=4, sink=1)
city.strips(296, -266, 28, 15, 0, _z + 0.35, 12, 2, 0.3, 0.5)
city.box(296, -266, _z + 12, 5, 5, 8, 'plaster_cream', top=False)
city.roof(296, -266, 5.6, 5.6, 0, _z + 20, 5, 'pyramid', 'copper')
city.building(318, -292, 16, 9, 0, _z + 0.35, 6, 'plaster_yellow', roof='gable', roofm='roof_dark', rh=3.5, sink=1)
city.cone(310, -292, _z + 6, 2.2, 11, 'roof_dark', n=4)
chimney(city, 324, -262, 40, r=1.9)
city.cyl(303, -288, _z + 0.35, 3.0, 0.6, 'concrete_light', n=10, top_mat='water_light')
# --- railway station with its clock tower, the rail yard, the hotel tower and the arena
_z = gz(612, -309)
city.building(613, -309, 14, 78, 0, _z, 9, 'brick', roof='hip', roofm='roof_grey', rh=3, sink=3)
city.strips(613, -309, 14, 78, 0, _z, 9, 2, 0.3, 0.4)
city.box(601, -309, _z - 3, 8, 8, 33, 'brick', top=False)
city.roof(601, -309, 8.6, 8.6, 0, _z + 30, 5, 'pyramid', 'copper')
for (dx, dy) in ((-4.4, 0), (0, 4.4), (0, -4.4)):
    city.octa((601 + dx, -309 + dy, _z + 25), 1.3, 'glow_white')
_ys = list(range(-20, -640, -62))
for ya, yb in zip(_ys, _ys[1:]):
    za, zb_ = gz(638, ya), gz(638, yb)
    if gq(638, ya)[1] in WATER_KINDS or gq(638, yb)[1] in WATER_KINDS:
        continue
    v = [(627, ya, za + 0.9), (649, ya, za + 0.9), (649, yb, zb_ + 0.9), (627, yb, zb_ + 0.9)]
    city.add(v, [(3, 2, 1, 0)], 'rail')
    city.add([(627, ya, za - 1), (627, yb, zb_ - 1), (627, yb, zb_ + 0.9), (627, ya, za + 0.9)], [(0, 1, 2, 3)], 'rail')
    city.add([(649, yb, zb_ - 1), (649, ya, za - 1), (649, ya, za + 0.9), (649, yb, zb_ + 0.9)], [(0, 1, 2, 3)], 'rail')
for (y, n, col) in ((-250, 4, 'red'), (-352, 5, 'green_dark'), (-150, 3, 'blue_dark')):
    for k in range(n):
        yy = y - k * 12.5
        x = 633 if col != 'green_dark' else 643
        city.box(x, yy, gz(x, yy) + 0.9, 4.2, 11.5, 4.0, col, top_mat='grey_light')
        city.strips(x, yy, 4.2, 11.5, 0, gz(x, yy) + 0.9, 4.0, 1, 0.3, 0.8, dark=False)
_z = gz(674, -278)
city.box(674, -278, _z - 2, 44, 44, 2.4, 'paving')
city.building(668, -284, 16, 12, 0, _z + 0.4, 46, 'pod_dark', roof='flat', roofm='steel_dark', sink=1)
city.strips(668, -284, 16, 12, 0, _z + 0.4, 46, 9, 0.3, 0.5, dark=False)
city.building(682, -268, 22, 18, 0, _z + 0.4, 9, 'concrete_light', roof='flat', roofm='roof_grey', sink=1)
_z = gz(674, -350)
city.box(674, -346, _z - 2, 44, 56, 2.4, 'paving')
city.prism([(-20, -12), (-12, -22), (12, -22), (20, -12), (20, 12), (12, 22), (-12, 22), (-20, 12)], _z, _z + 15,
           'pod_dark', xf=XF((674, -352, 0)), top_mat='steel_dark')
city.prism([(-20.5, -12.3), (-12.3, -22.5), (12.3, -22.5), (20.5, -12.3), (20.5, 12.3), (12.3, 22.5), (-12.3, 22.5),
            (-20.5, 12.3)], _z + 11.5, _z + 13, 'glow_warm', xf=XF((674, -352, 0)), top=False)
city.building(662, -322, 13, 11, 0, _z + 0.4, 32, 'steel_dark', roof='flat', roofm='pod_dark', sink=1)
city.strips(662, -322, 13, 11, 0, _z + 0.4, 32, 7, 0.3, 0.45, dark=False)
stadium(city, 446, -478, 0.25)
# --- bridges over Tammerkoski
bridge(city, -194, 10)
bridge(city, -309, 14, arches=2)
bridge(city, -424, 10)
bridge(city, -118 + 5.5, 4.5, lamps=False, arches=3)
# --- lamps along the main street (Hämeenkatu, from the west end over the bridge to the station)
for x in range(232, 592, 24):
    if abs(x - chan_x(-309)) < 22:
        continue
    for sy in (-7.2, 7.2):
        z = gz(x, -309 + sy)
        city.cyl(x, -309 + sy, z, 0.28, 4.2, 'grey_dark', n=3, top=False)
        city.octa((x, -309 + sy, z + 4.8), 0.85, 'glow_warm')
# --- riverside trees
for _ in range(120):
    y = rng.uniform(-520, -70)
    side = rng.choice((-1, 1))
    x = chan_x(y) + side * rng.uniform(17.5, 24)
    z, k = gq(x, y)
    if k != 'street' or occupied(x, y, 4.5) or any(abs(y - by) < 9 for by in (-194, -309, -424)):
        continue
    r = rng.uniform(3.2, 5)
    lump(city, x, y, z + 2.0, r, r * 0.95, rng.choice(['leaf', 'leaf_light', 'leaf_dark']))
    reserve(x, y, r)
# --- trees of the shore parks
_nsp = 0
for _ in range(1500):
    if _nsp >= 90:
        break
    x, y = rng.uniform(100, 840), rng.uniform(-730, -20)
    z, k = gq(x, y)
    if k != 'grass' or not in_city(x, y) or occupied(x, y, 5):
        continue
    r = rng.uniform(3.5, 6)
    lump(city, x, y, z + 2.2, r, r * 0.95, rng.choice(['leaf', 'leaf_light', 'leaf_dark', 'leaf']))
    reserve(x, y, r)
    _nsp += 1
# --- suburbs: scattered simple blocks and tower blocks east and south-east of the centre
_ns = 0
for _ in range(500):
    if _ns >= 34:
        break
    x, y = rng.uniform(820, 1150), rng.uniform(-700, -60)
    if rng.random() < 0.4:
        x, y = rng.uniform(430, 800), rng.uniform(-760, -560)
    z, k = gq(x, y)
    if k not in FOREST_KINDS and k != 'street' or occupied(x, y, 26):
        continue
    if rng.random() < 0.45:
        h = rng.uniform(20, 30)
        city.building(x, y, 15, 15, 0.2, z, h, rng.choice(['white_paint', 'concrete_light', 'plaster_cream']),
                      roof='flat', roofm='roof_dark', sink=6)
        city.strips(x, y, 15.01, 15, 0.2, z, h, 4, 0.5, 0.4, dark=False)
    else:
        city.building(x, y, rng.uniform(34, 48), 14, rng.choice((0.2, 0.2 + PI / 2)), z, rng.uniform(9, 14),
                      rng.choice(WALLS), roof='hip', roofm=rng.choice(ROOFS), rh=3.5, sink=6)
    reserve(x, y, 22)
    _ns += 1
OBJ['city'] = city.build(40)
print(f'[env] city done: {_nblocks} blocks ({time.time() - T0:.1f}s)')

# ============================================================================ far shores, islands, lighthouse
fs = MB('far_shores')


def lighthouse(mb, x, y):
    z = gz(x, y)
    mb.cyl(x, y, z - 1.5, 3.2, 2.7, 'rock_dark', n=8, r_top=2.8)
    mb.loft([ring(8, 2.0, z + 1.2), ring(8, 1.75, z + 4.2), ring(8, 1.5, z + 7.2), ring(8, 1.3, z + 9.6)],
            (lambda k, i: 'red' if k == 1 else 'white_paint'), xf=XF((x, y, 0)))
    mb.cyl(x, y, z + 9.6, 1.9, 0.35, 'grey_dark', n=8, bottom=True)
    mb.cyl(x, y, z + 9.95, 1.05, 1.5, 'glow_white', n=8, top=False)
    mb.cone(x, y, z + 11.45, 1.5, 1.6, 'red', n=8)
    mb.building(x + 4.5, y - 1.5, 5, 4, 0.4, gz(x + 4.5, y - 1.5), 2.6, 'white_paint', roof='gable', roofm='roof_red',
                rh=1.6, sink=2)
    reserve(x, y, 5)
    reserve(x + 4.5, y - 1.5, 4)


lighthouse(fs, ISLAND_DEFS[0][0] - 2, ISLAND_DEFS[0][1])
# island forests
for k, (cx, cy, a, b, rot, kind) in enumerate(ISLAND_DEFS):
    r = math.hypot(cx, cy)
    if kind == 'rock':
        z = gz(cx, cy)
        fs.inst(T_PINE, (cx, cy, z - 0.3), rng.uniform(0, 6.3), 0.8)
        fs.blob((cx + 2.5, cy - 1.5, z), 1.6, 'rock_dark', sc=(1.3, 1, 0.7))
        continue
    if kind == 'light':
        continue
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    lr = clamp(b * 0.42, 6, 26)
    n = int(clamp(a * b / (lr * lr) * 1.5, 4, 16))
    placed = 0
    for _ in range(n * 12):
        if placed >= n:
            break
        u, v = rng.uniform(-0.8, 0.8), rng.uniform(-0.75, 0.75)
        if u * u + v * v > 0.62:
            continue
        x, y = cx + a * u * c - b * v * s, cy + a * u * s + b * v * c
        z, kk = gq(x, y)
        rr = lr * rng.uniform(0.75, 1.2)
        if kk in WATER_KINDS or occupied(x, y, rr * 0.55):
            continue
        lump(fs, x, y, z, rr, rr * rng.uniform(0.6, 0.85), rng.choice(['pine', 'pine_dark', 'leaf_dark', 'pine']))
        reserve(x, y, rr * 0.55)
        placed += 1
    if r < 480:                                   # spruce tips for the silhouette of the nearer islands
        for _ in range(int(6 + a / 6)):
            u, v = rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7)
            x, y = cx + a * u * c - b * v * s, cy + a * u * s + b * v * c
            z, kk = gq(x, y)
            if kk in WATER_KINDS or kk == 'rock':
                continue
            fs.inst(T_SPRUCE_LO, (x, y, z + lr * 0.25), rng.uniform(0, 6.3), rng.uniform(1.2, 1.9))
# forest masses along the far shores (two rows: the silhouette), nearer shores get smaller lumps
_n_shore = 0
for poly, valid, isl in SHORE_LINES[:2]:
    n = len(poly)
    acc = 0.0
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        acc += math.dist(p, q)
        r = math.hypot(*p)
        if not valid[i] or r < 440 or in_city(*p):
            continue
        lr = clamp(r * 0.034, 15, 46)
        if acc < lr * 1.25:
            continue
        acc = 0.0
        d = Vector((q[0] - p[0], q[1] - p[1])).normalized()
        for sgn in (1, -1):
            nx, ny = -d.y * sgn, d.x * sgn
            if gq(p[0] + nx * 6, p[1] + ny * 6)[1] in WATER_KINDS:
                continue
            for row, (off, sc) in enumerate(((0.75, 0.8), (2.1, 1.15))):
                x = p[0] + nx * lr * off + rng.uniform(-0.3, 0.3) * lr
                y = p[1] + ny * lr * off + rng.uniform(-0.3, 0.3) * lr
                z, kk = gq(x, y)
                if kk not in FOREST_KINDS:
                    continue
                rr = lr * sc * rng.uniform(0.85, 1.15)
                lump(fs, x, y, z, rr, rr * rng.uniform(0.5, 0.75), rng.choice(['pine', 'pine_dark', 'pine_dark']))
                _n_shore += 1
            break
# sparse big canopy masses inland, beyond the mid-distance forest
_n_in = forest(fs, 190, (-1500, -1500, 1500, 1500),
               lambda x, y: 470 < math.hypot(x, y) < 1450 and not in_city(x, y),
               26, 48, ['pine', 'pine_dark', 'pine_dark', 'leaf_dark'], tries=6000, gap=1.5)
OBJ['far_shores'] = fs.build(40)
print(f'[env] far_shores done: {_n_shore} shore lumps, {_n_in} inland ({time.time() - T0:.1f}s)')

# ============================================================================ boats
boats = MB('boats')
for (x, y, ang, col) in ((-62, 150, 30, 'white_paint'), (98, 205, 150, 'cream'), (-190, 330, -40, 'white_paint'),
                         (270, 215, 80, 'red'), (25, 440, 200, 'white_paint'), (160, -645, 20, 'cream')):
    a = math.radians(ang)
    z = Z_NASI if y > -340 else Z_PYHA
    boat_hull(boats, x, y, z, 9.0, 2.8, a, hull='white_paint' if col != 'red' else 'red', h=1.1)
    boats.cyl(x, y, z + 1.1, 0.16, 10.5, 'wood_dark', n=3)
    xf = XF((x, y, z), a)
    boats.extrude_y([(0.35, 2.0), (4.3, 2.2), (0.35, 11.2)], -0.09, 0.09, col if col != 'red' else 'white_paint', xf=xf)
    boats.extrude_y([(-0.3, 2.0), (-3.6, 2.0), (-0.3, 9.0)], -0.09, 0.09, 'cream' if col != 'cream' else 'red', xf=xf)
OBJ['boats'] = boats.build(40)

# ============================================================================ clouds
clouds = empty('clouds')
CLOUD_OBJS = []
for i in range(16):
    b = i * 22.5 + rng.uniform(-8, 8)
    h = lerp(45, 215, ((i * 7) % 16) / 15.0) + rng.uniform(-4, 4)
    r = clamp(lerp(680, 290, (h - 45) / 170.0) + rng.uniform(-45, 45), 255, 695)   # low clouds far, high clouds near
    size = rng.uniform(26, 40) * (0.8 + r / 900)
    mb = MB(f'cloud_{i + 1:02d}')
    nb = rng.choice((3, 4, 4, 5))
    x = -(nb - 1) * 0.55 * size / 2
    for k in range(nb):
        rr = size * (0.6 + 0.4 * math.sin(PI * (k + 0.5) / nb)) * rng.uniform(0.85, 1.1)
        vs = []
        for v in ICO2[0]:
            vz = v[2] * 0.62
            if vz < -0.22:
                vz = -0.22
            vs.append((x + v[0] * rr, v[1] * rr * 0.8 + rng.uniform(-1, 1) * 0, vz * rr))
        mb.add(vs, ICO2[1], 'white_paint', XF((0, rng.uniform(-0.15, 0.15) * size, rng.uniform(0, 0.12) * size)))
        x += 0.55 * size * rng.uniform(0.85, 1.15)
    cx, cy = brg(b, r)
    ob = mb.build(50, parent=clouds, loc=(cx, cy, h))
    ob.rotation_euler = (0, 0, face_tower(b) + rng.uniform(-0.4, 0.4))
    CLOUD_OBJS.append(ob)

# ============================================================================ report, checks, export
for m in bpy.data.materials:
    m.use_backface_culling = True
bpy.context.view_layer.update()


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


print('[env] ---- triangles per object')
_total = 0
for name, ob in OBJ.items():
    t = tri_count(ob)
    _total += t
    glow = sorted({s.material.name for s in ob.material_slots if s.material.name.startswith('glow_')})
    print(f'[env] {name:12s} {t:6d}   {"glow: " + ", ".join(glow) if glow else ""}')
_ct = sum(tri_count(o) for o in CLOUD_OBJS)
_total += _ct
print(f'[env] {"clouds/*":12s} {_ct:6d}   ({len(CLOUD_OBJS)} puffs)')
print(f'[env] TOTAL        {_total:6d}')
# nothing taller than 2 within r < 46
_worst = (0, '')
for name, ob in OBJ.items():
    if name in ('ground', 'lake'):
        continue
    for v in ob.data.vertices:
        if v.co.x ** 2 + v.co.y ** 2 < 46 ** 2 and v.co.z > _worst[0]:
            _worst = (v.co.z, name)
print(f'[env] tallest point within r < 46: {_worst[0]:.2f} ({_worst[1]})')
_mx = max(max(v.co.z for v in OBJ['ground'].data.vertices), 0)
print(f'[env] ground max z {_mx:.1f}, plaza hole ok, export follows')

export_glb('environment.glb')


# ============================================================================ previews
def setup_render():
    scene = bpy.context.scene
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'BLENDER_WORKBENCH'):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    world = bpy.data.worlds.new('_env_world')
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get('Background')
    sky = hex_rgba('#f7cfa4')
    bg.inputs['Color'].default_value = sky
    bg.inputs['Strength'].default_value = 1.0
    scene.world = world
    sd = bpy.data.lights.new('_env_sun', 'SUN')
    sd.energy = 3.4
    sd.color = (1.0, 0.86, 0.68)
    sd.angle = math.radians(2)
    sun = bpy.data.objects.new('_env_sun', sd)
    link(sun)
    el, az = math.radians(24), math.radians(315)            # low in the north-west
    to_sun = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    sun.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()
    scene.render.image_settings.file_format = 'PNG'
    try:
        scene.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    # distance fog through the mist pass (approximates the game's fog)
    try:
        world.mist_settings.start = 60
        world.mist_settings.depth = 2100
        world.mist_settings.falloff = 'LINEAR'
        bpy.context.view_layer.use_pass_mist = True
        ng = bpy.data.node_groups.new('_env_comp', 'CompositorNodeTree')
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        rl = ng.nodes.new('CompositorNodeRLayers')
        rl.scene = scene
        mix = ng.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        out = ng.nodes.new('NodeGroupOutput')
        ng.links.new(rl.outputs['Mist'], mix.inputs[0])
        ng.links.new(rl.outputs['Image'], mix.inputs[6])
        mix.inputs[7].default_value = sky
        ng.links.new(mix.outputs[2], out.inputs[0])
        scene.compositing_node_group = ng
        scene.render.use_compositing = True
    except Exception as ex:
        print('[env] fog compositing unavailable:', ex)
    # stand-in for the tower (not exported: it is created after the export)
    s1 = cylinder('_standin_a', r=5.2, h=140, loc=(0, 0, 70), material='concrete', segs=24)
    s2 = cylinder('_standin_b', r=12, h=6, loc=(0, 0, 3), material='concrete_dark', segs=24)
    s3 = cylinder('_standin_c', r=15, h=14, loc=(0, 0, 112), material='pod_dark', segs=24, r_top=11)
    return [s1, s2, s3]


def render_view(filename, pos, target, lens=20.0, res=(1280, 720), ortho=None, fog=True):
    scene = bpy.context.scene
    cd = bpy.data.cameras.new('_env_cam')
    cam = bpy.data.objects.new('_env_cam', cd)
    link(cam)
    cd.lens = lens
    cd.clip_start = 0.5
    cd.clip_end = 6000
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    cam.location = pos
    cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.use_compositing = fog and not ortho
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.filepath = os.path.join(PREVIEW_DIR, filename)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cd)
    print(f'[env] preview {filename}')


if RENDER:
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    standins = setup_render()
    NAMES = {0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW'}
    if 'ground' in VIEWS:
        # the gameplay camera near the ground: 45 from the axis, looking inward past the tower
        for b in (0, 90, 180, 270, 45, 225):
            x, y = brg(b, 45.0)
            render_view(f'env_ground_cam{NAMES[b]}.png', (x, y, 5.0), (0, 0, 7.0))
    if 'high' in VIEWS:
        for h in (50, 100, 140):
            for b in ((0, 90, 180, 270) if h != 140 else (0, 45, 90, 135, 180, 225, 270, 315)):
                x, y = brg(b, 20.0)
                dx, dy = -x / 20.0, -y / 20.0
                c15, s15 = math.cos(math.radians(15)), math.sin(math.radians(15))
                render_view(f'env_high{h}_cam{NAMES[b]}.png', (x, y, float(h)),
                            (x + dx * 100 * c15, y + dy * 100 * c15, h - 100 * s15))
    if 'detail' in VIEWS:
        for i, (pos, tgt) in enumerate([
                ((-10, -40, 14), (-55, -95, 8)), ((30, 0, 10), (60, 22, 5)), ((20, -40, 12), (50, -75, 5)),
                ((0, -100, 10), (-40, -152, 18)), ((-35, 0, 8), (-68, -5, 5)), ((14, 54, 6), (0, 38, 0)),
                ((-10, 20, 4), (2, 44, 0)), ((250, -60, 60), (380, -140, 0)), ((300, -420, 80), (420, -300, 0)),
                ((520, -420, 70), (600, -300, 10)), ((100, -30, 25), (150, -70, -5)), ((-120, -300, 60), (-170, -388, 30)),
                ((10, 215, 8), (34, 252, 0)), ((-420, -200, 60), (-500, -320, 10)), ((345, -335, 6), (372, -309, -4)),
                ((62, 36, 8), (56, 60, 5)), ((120, -230, 50), (200, -330, 10)), ((400, -420, 40), (446, -478, 0))]):
            render_view(f'env_detail_{i:02d}.png', pos, tgt, lens=28.0, res=(960, 600))
    if 'map' in VIEWS:
        for s in standins:
            s.hide_render = True
        for c in CLOUD_OBJS:
            c.hide_render = True
        render_view('env_map_world.png', (0, 0, 3000), (0, 0.001, 0), res=(1400, 1400), ortho=3900)
        render_view('env_map_city.png', (150, -200, 3000), (150, -199.999, 0), res=(1400, 1400), ortho=1300)
        render_view('env_map_park.png', (0, -30, 3000), (0, -29.999, 0), res=(1400, 1400), ortho=420)
print(f'[env] finished in {time.time() - T0:.1f}s')
