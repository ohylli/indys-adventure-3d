"""The Näsinneula: base pavilion, tapered concrete shaft, ring balcony, two-tier saucer pod, roof, mast and beacon.

Game scale: 140 units tall (HUD altitude = z * 1.2 m, so 168 m at the tip), shaft radius about 5, pod radius about 16.
The restaurant tier is a separate object ('restaurant') because the game rotates it.

    blender --background --python blender/tower.py
"""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from indykit import *
import bpy, bmesh
from mathutils import Vector

reset_scene()
SEG = 48
COLSEG = 32

# ------------------------------------------------------------------------------------------------ key dimensions
SHAFT_R0, SHAFT_R1, SHAFT_TOP = 5.2, 4.6, 94.0
BALCONY_Z, BALCONY_R = 92.5, 6.7
POD_BOTTOM_Z = 94.0
DECK_Z, DECK_R_IN, DECK_R_OUT = 99.5, 12.7, 15.0          # ledge A (fixed): walkable ring
REST_Z, REST_R_IN, REST_R_OUT = 103.0, 14.1, 16.4         # ledge B (rotating restaurant brim)
EAVE_Z, EAVE_R = 106.3, 16.9
ROOF_Z0, ROOF_Z1, ROOF_R1 = 106.9, 109.5, 5.0

root = empty('tower')
rest = empty('restaurant', parent=root)


def shaft_r(z):
    return SHAFT_R0 + (SHAFT_R1 - SHAFT_R0) * min(1.0, max(0.0, z / SHAFT_TOP))


def add(ob, parent=root, angle=40):
    shade(ob, angle)
    ob.parent = parent
    return ob


def col(name, profile, parent=root):
    ob = lathe('COL_' + name, profile, COLSEG, 'grey')
    ob.parent = parent
    return ob


def ring_of(n, fn, name, parent=root, angle=40):
    """Join n copies made by fn(i, angle_rad) into one object."""
    objs = [fn(i, 2 * math.pi * i / n) for i in range(n)]
    ob = join(objs, name)
    return add(ob, parent, angle)


def polar(r, a, z=0.0):
    return (r * math.cos(a), r * math.sin(a), z)


# ------------------------------------------------------------------------------------------------ shaft
BAND = 4.0
prof = [(shaft_r(z), z) for z in [i * BAND for i in range(int(SHAFT_TOP / BAND) + 1)] + [SHAFT_TOP]]
shaft = lathe('shaft', prof, SEG, 'concrete', cap_top=False, cap_bottom=False)
shaft.data.materials.append(mat('concrete_b', '#cbbba6'))
for poly in shaft.data.polygons:
    band = int(poly.center.z / BAND)
    poly.material_index = 1 if band % 3 == 1 else 0
add(shaft, angle=80)
# thin shadow joints between the pours
joints = []
for i in range(1, int(SHAFT_TOP / BAND)):
    z = i * BAND
    r = shaft_r(z) + 0.035
    joints.append(lathe('_j', [(r, z - 0.07), (r, z + 0.07)], SEG, 'concrete_dark', cap_top=False, cap_bottom=False))
add(join(joints, 'shaft_joints'), angle=80)
# four columns of little windows: they show how far round the tower you have run
wins = []
for k in range(4):
    a = math.radians(45 + 90 * k)
    for z in range(8, 90, 8):
        r = shaft_r(z)
        w = box('_w', (0.34, 0.7, 1.5), polar(r - 0.08, a, z), 'window_dark', rot=(0, 0, a))
        f = box('_f', (0.22, 0.95, 1.75), polar(r - 0.06, a, z), 'concrete_dark', rot=(0, 0, a))
        wins += [w, f]
add(join(wins, 'shaft_windows'), angle=30)
col('shaft', [(SHAFT_R0, -0.5), (SHAFT_R0, 0), (SHAFT_R1, SHAFT_TOP)])

# ------------------------------------------------------------------------------------------------ base pavilion
PAV_R, PAV_H = 11.0, 3.4
pav = []
pav.append(lathe('_plinth', [(PAV_R + 0.5, 0), (PAV_R + 0.5, 0.35), (PAV_R, 0.35)], SEG, 'concrete_dark', cap_bottom=False))
pav.append(lathe('_glass', [(PAV_R - 0.25, 0.35), (PAV_R - 0.25, PAV_H - 0.5)], SEG, 'window_blue', cap_top=False, cap_bottom=False))
pav.append(lathe('_roof', [(PAV_R + 0.9, PAV_H - 0.5), (PAV_R + 0.9, PAV_H), (shaft_r(PAV_H) - 0.05, PAV_H)], SEG, 'concrete_light', cap_top=False))
pav.append(lathe('_fascia', [(PAV_R + 0.95, PAV_H - 0.42), (PAV_R + 0.95, PAV_H - 0.12)], SEG, 'red', cap_top=False, cap_bottom=False))
pavilion = add(join(pav, 'pavilion'), angle=50)
add(ring_of(24, lambda i, a: box('_m', (0.3, 0.3, PAV_H - 0.85), polar(PAV_R - 0.1, a, 0.35 + (PAV_H - 0.85) / 2), 'concrete', rot=(0, 0, a)),
            'pavilion_columns'))
add(ring_of(24, lambda i, a: sphere('_b', 0.14, polar(PAV_R + 1.0, a + math.radians(7.5), PAV_H - 0.62), 'glow_warm', 1),
            'pavilion_bulbs'), angle=180)
# entrance canopy on the south side (-Y) with the name
canopy = box('pavilion_canopy', (6.0, 2.6, 0.3), (0, -(PAV_R + 1.6), 2.9), 'red', bevel_w=0.06)
posts = [cylinder('_p', 0.14, 2.75, (sx * 2.7, -(PAV_R + 2.6), 1.375), 'steel_dark', 10) for sx in (-1, 1)]
door = box('_door', (3.2, 0.2, 2.3), (0, -(PAV_R - 0.1), 1.5), 'window_dark')
add(join([canopy, door] + posts, 'pavilion_entrance'), angle=40)
try:
    cu = bpy.data.curves.new('sign', 'FONT')
    cu.body = 'NÄSINNEULA'
    cu.align_x = 'CENTER'
    cu.size = 0.95
    cu.extrude = 0.07
    cu.resolution_u = 2
    txt = bpy.data.objects.new('pavilion_sign', cu)
    link(txt)
    txt.location = (0, -(PAV_R + 2.92), 3.2)
    txt.rotation_euler = (math.radians(90), 0, 0)
    select_only([txt])
    bpy.ops.object.convert(target='MESH')
    txt = bpy.context.view_layer.objects.active
    set_material(txt, 'white_paint')
    apply_transforms(txt, location=False)
    add(txt, angle=30)
except Exception as e:  # the sign is a nicety
    print('[tower] no sign:', e)
col('pavilion', [(PAV_R + 0.9, 0), (PAV_R + 0.9, PAV_H), (0.0, PAV_H)])
canopy_col = box('COL_canopy', (6.0, 2.6, 0.3), (0, -(PAV_R + 1.6), 2.9), 'grey')
canopy_col.parent = root

# ------------------------------------------------------------------------------------------------ ring balcony
bal = []
bal.append(lathe('_slab', [(shaft_r(BALCONY_Z) - 0.1, BALCONY_Z - 0.55), (BALCONY_R - 0.35, BALCONY_Z - 0.55),
                           (BALCONY_R, BALCONY_Z - 0.2), (BALCONY_R, BALCONY_Z), (shaft_r(BALCONY_Z) - 0.1, BALCONY_Z)],
                 SEG, 'concrete_light', cap_top=False, cap_bottom=False))
bal.append(lathe('_rail', [(BALCONY_R - 0.14, BALCONY_Z + 0.78), (BALCONY_R - 0.02, BALCONY_Z + 0.78),
                           (BALCONY_R - 0.02, BALCONY_Z + 0.9), (BALCONY_R - 0.14, BALCONY_Z + 0.9),
                           (BALCONY_R - 0.14, BALCONY_Z + 0.78)], SEG, 'steel_dark', cap_top=False, cap_bottom=False))
balcony = add(join(bal, 'balcony'), angle=50)
add(ring_of(24, lambda i, a: box('_p', (0.1, 0.1, 0.8), polar(BALCONY_R - 0.08, a, BALCONY_Z + 0.4), 'steel_dark', rot=(0, 0, a)),
            'balcony_posts'))
col('balcony', [(shaft_r(BALCONY_Z) - 0.3, BALCONY_Z - 0.5), (BALCONY_R, BALCONY_Z - 0.5), (BALCONY_R, BALCONY_Z),
                (shaft_r(BALCONY_Z) - 0.3, BALCONY_Z)])

# ------------------------------------------------------------------------------------------------ pod, lower part
# the flaring underside ("bowl") and the observation-deck window band with its brim (ledge A)
bowl = lathe('pod_bowl', [(SHAFT_R1 - 0.05, POD_BOTTOM_Z), (5.4, POD_BOTTOM_Z + 0.5), (7.0, 96.2), (10.2, 98.2),
                          (DECK_R_IN - 0.1, DECK_Z - 0.45), (DECK_R_OUT, DECK_Z - 0.45)],
             SEG, 'pod_brown', cap_top=False, cap_bottom=False)
add(bowl, angle=50)
add(ring_of(16, lambda i, a: box('_rib', (5.6, 0.34, 0.5), polar(8.9, a, 97.15), 'concrete_shadow',
                                 rot=(0, math.radians(-33), a)), 'pod_ribs'))
brim_a = lathe('pod_brim_a', [(DECK_R_OUT, DECK_Z - 0.45), (DECK_R_OUT + 0.12, DECK_Z - 0.3), (DECK_R_OUT + 0.12, DECK_Z - 0.06),
                              (DECK_R_OUT, DECK_Z), (DECK_R_IN - 0.2, DECK_Z)],
               SEG, 'pod_dark', cap_top=False, cap_bottom=False)
add(brim_a, angle=40)


def window_band(name, r0, z0, r1, z1, panes, parent, lit_every=0, phase=0):
    """A slanted ring of dark glass panes with mullions and a few lit ones."""
    objs = []
    glass = lathe('_g', [(r0, z0), (r1, z1)], panes, 'window_dark', cap_top=False, cap_bottom=False)
    glass.data.materials.append(mat('glow_window'))
    if lit_every:
        for i, poly in enumerate(glass.data.polygons):
            if (i * 7 + phase) % lit_every in (0, 1) or (i * 3 + phase) % 11 == 0:
                poly.material_index = 1
    objs.append(glass)
    slope = math.atan2(r1 - r0, z1 - z0)
    length = math.hypot(r1 - r0, z1 - z0)
    for i in range(panes):
        a = 2 * math.pi * i / panes
        objs.append(box('_m', (0.16, 0.16, length), polar((r0 + r1) / 2 + 0.04, a, (z0 + z1) / 2), 'pod_dark',
                        rot=(0, slope, a)))
    ob = join(objs, name)
    return add(ob, parent, angle=25)


window_band('pod_windows_a', DECK_R_IN + 0.15, DECK_Z, REST_R_IN - 0.15, REST_Z - 0.45, 40, root, lit_every=9, phase=2)
sill = lathe('pod_sill', [(REST_R_IN - 0.3, REST_Z - 0.5), (REST_R_IN + 0.3, REST_Z - 0.5), (REST_R_IN + 0.3, REST_Z - 0.38)],
             SEG, 'pod_dark', cap_top=False, cap_bottom=False)
add(sill)
col('pod_bowl', [(SHAFT_R1 - 0.2, POD_BOTTOM_Z - 0.2), (5.4, POD_BOTTOM_Z + 0.5), (7.0, 96.2), (10.2, 98.2),
                 (DECK_R_IN - 0.1, DECK_Z - 0.45), (DECK_R_OUT + 0.1, DECK_Z - 0.45), (DECK_R_OUT + 0.1, DECK_Z),
                 (DECK_R_IN + 0.15, DECK_Z), (REST_R_IN - 0.15, REST_Z - 0.45), (0.0, REST_Z - 0.45)])

# ------------------------------------------------------------------------------------------------ restaurant tier (rotates)
brim_b = lathe('rest_brim', [(REST_R_IN - 0.3, REST_Z - 0.38), (REST_R_OUT, REST_Z - 0.38), (REST_R_OUT + 0.12, REST_Z - 0.26),
                             (REST_R_OUT + 0.12, REST_Z - 0.06), (REST_R_OUT, REST_Z), (REST_R_IN - 0.2, REST_Z)],
               SEG, 'pod_dark', cap_top=False, cap_bottom=False)
add(brim_b, rest)
# a coloured stripe and bulbs on the rotating brim so the motion reads
add(ring_of(24, lambda i, a: box('_s', (0.5, 1.5, 0.05), polar(REST_R_OUT - 0.75, a, REST_Z + 0.012),
                                 'yellow' if i % 2 else 'cream', rot=(0, 0, a)), 'rest_marks', rest), rest)
add(ring_of(32, lambda i, a: sphere('_b', 0.13, polar(REST_R_OUT + 0.14, a, REST_Z - 0.17), 'glow_warm', 1),
            'rest_bulbs', rest, angle=180), rest)
window_band('rest_windows', REST_R_IN + 0.15, REST_Z, EAVE_R - 1.3, EAVE_Z - 0.05, 44, rest, lit_every=6, phase=1)
col('restaurant', [(REST_R_IN - 0.3, REST_Z - 0.38), (REST_R_OUT + 0.1, REST_Z - 0.38), (REST_R_OUT + 0.1, REST_Z),
                   (REST_R_IN + 0.15, REST_Z), (EAVE_R - 1.3, EAVE_Z - 0.05), (0.0, EAVE_Z - 0.05)], rest)

# ------------------------------------------------------------------------------------------------ roof
eave = lathe('roof_eave', [(EAVE_R - 1.5, EAVE_Z - 0.05), (EAVE_R, EAVE_Z - 0.05), (EAVE_R + 0.15, EAVE_Z + 0.1),
                           (EAVE_R + 0.15, ROOF_Z0 - 0.08), (EAVE_R, ROOF_Z0)], SEG, 'pod_dark', cap_top=False, cap_bottom=False)
roof = lathe('roof', [(EAVE_R, ROOF_Z0), (ROOF_R1, ROOF_Z1)], SEG, 'pod_roof', cap_top=False, cap_bottom=False)
add(join([eave, roof], 'roof'), angle=40)
add(ring_of(22, lambda i, a: box('_seam', (11.4, 0.14, 0.09), polar((EAVE_R + ROOF_R1) / 2, a, (ROOF_Z0 + ROOF_Z1) / 2 + 0.04),
                                 'pod_dark', rot=(0, math.atan2(ROOF_Z1 - ROOF_Z0, EAVE_R - ROOF_R1), a)), 'roof_seams'))
add(ring_of(22, lambda i, a: sphere('_b', 0.15, polar(EAVE_R + 0.2, a + 0.14, EAVE_Z + 0.45), 'glow_warm', 1),
            'roof_bulbs', angle=180))
drums = lathe('roof_drums', [(ROOF_R1, ROOF_Z1), (ROOF_R1, 111.3), (ROOF_R1 + 0.25, 111.3), (ROOF_R1 + 0.25, 111.7),
                             (3.6, 111.7), (3.6, 113.0), (3.85, 113.0), (3.85, 113.3), (2.3, 113.3), (2.3, 114.2),
                             (1.1, 114.6)], SEG, 'concrete_dark', cap_top=False, cap_bottom=False)
drums.data.materials.append(mat('pod_dark'))
for poly in drums.data.polygons:
    z = poly.center.z
    if 111.25 < z < 111.75 or 112.95 < z < 113.35:
        poly.material_index = 1
add(drums, angle=40)
add(ring_of(12, lambda i, a: box('_v', (0.12, 0.9, 1.0), polar(ROOF_R1 + 0.02, a, 110.4), 'window_dark', rot=(0, 0, a)), 'roof_vents'))
# (the collision drums are as wide as their lips, so there is no overhang to bump a jumping cat's head on)
col('roof', [(EAVE_R - 1.5, EAVE_Z - 0.05), (EAVE_R + 0.15, EAVE_Z - 0.05), (EAVE_R + 0.15, ROOF_Z0), (ROOF_R1 + 0.25, ROOF_Z1 - 0.05),
             (ROOF_R1 + 0.25, 111.7), (3.85, 111.7), (3.85, 113.3), (2.3, 113.3), (2.3, 114.2), (0.0, 114.6)])

# ------------------------------------------------------------------------------------------------ mast and beacon
# Gameplay: Indy climbs the lower mast (radius 0.8) to a maintenance ring, the beacon drum (radius 1.15) to a small
# crow's nest, and the upper mast to the tip at z = 140.
RING_Z, RING_R = 123.2, 2.8
BEACON_Z0, BEACON_Z1, BEACON_R = 123.9, 127.25, 1.15
NEST_Z, NEST_R = 127.5, 1.6
mast_lo = lathe('mast_lower', [(1.1, 114.6), (0.8, 115.1), (0.8, BEACON_Z0)], 20, 'white_paint', cap_top=False, cap_bottom=False)
add(mast_lo, angle=50)
ring = lathe('mast_ring', [(0.8, RING_Z - 0.22), (RING_R - 0.15, RING_Z - 0.22), (RING_R, RING_Z - 0.1), (RING_R, RING_Z),
                           (0.8, RING_Z)], 28, 'steel', cap_top=False, cap_bottom=False)
ring.data.materials.append(mat('yellow'))
for poly in ring.data.polygons:
    if poly.center.z < RING_Z - 0.02 and math.hypot(poly.center.x, poly.center.y) > RING_R - 0.2:
        poly.material_index = 1
add(ring, angle=40)
add(ring_of(6, lambda i, a: box('_s', (2.0, 0.12, 0.12), polar(1.75, a, RING_Z - 0.75), 'steel_dark', rot=(0, math.radians(38), a)),
            'mast_ring_struts'))
beacon_body = lathe('beacon_body', [(0.8, BEACON_Z0 - 0.25), (BEACON_R, BEACON_Z0), (BEACON_R, BEACON_Z1), (0.9, BEACON_Z1 + 0.05)],
                    20, 'cream', cap_top=False, cap_bottom=False)
add(beacon_body, angle=50)
for i in range(3):
    z0 = BEACON_Z0 + 0.3 + i * 1.0
    bar = lathe(f'beacon_{i + 1}', [(BEACON_R + 0.06, z0), (BEACON_R + 0.06, z0 + 0.75)], 20,
                'glow_yellow' if i > 0 else 'glow_green', cap_top=False, cap_bottom=False)
    add(bar, angle=80)
nest = lathe('mast_nest', [(0.9, NEST_Z - 0.25), (NEST_R - 0.12, NEST_Z - 0.25), (NEST_R, NEST_Z - 0.12), (NEST_R, NEST_Z),
                           (0.42, NEST_Z)], 24, 'steel', cap_top=False, cap_bottom=False)
add(nest, angle=40)
mast_hi = lathe('mast_upper', [(0.42, NEST_Z), (0.42, 134.0), (0.24, 134.5), (0.2, 139.6), (0.0, 139.95)],
                16, 'white_paint', cap_top=False, cap_bottom=False)
mast_hi.data.materials.append(mat('red'))
for poly in mast_hi.data.polygons:
    z = poly.center.z
    if 128.2 < z < 134.0 and int((z - 128.2) / 1.45) % 2 == 0:
        poly.material_index = 1
add(mast_hi, angle=50)
lights = [sphere('_l', 0.2, polar(0.42, math.radians(a), 137.2), 'glow_red', 1) for a in (0, 180)]
lights += [sphere('_l', 0.2, polar(RING_R, math.radians(a), RING_Z - 0.1), 'glow_red', 1) for a in (0, 120, 240)]
lights += [sphere('_l', 0.24, polar(2.45, math.radians(a), 114.3), 'glow_red', 1) for a in (60, 180, 300)]
add(join(lights, 'mast_lights'), angle=180)
ants = [cylinder('_a', 0.06, 2.2, polar(3.3, math.radians(a), 114.3), 'steel', 6) for a in (25, 140, 250)]
add(join(ants, 'roof_antennas'))
col('mast', [(1.1, 114.5), (0.8, 115.1), (0.8, RING_Z - 0.22), (RING_R, RING_Z - 0.22), (RING_R, RING_Z), (0.8, RING_Z),
             (0.8, BEACON_Z0 - 0.25), (BEACON_R, BEACON_Z0), (BEACON_R, NEST_Z - 0.25), (NEST_R, NEST_Z - 0.25),
             (NEST_R, NEST_Z), (0.42, NEST_Z), (0.42, 134.0), (0.24, 134.5), (0.2, 139.6), (0.0, 139.6)])

# ------------------------------------------------------------------------------------------------ previews + export
bpy.context.view_layer.update()
pod_objs = [o for o in root.children_recursive if o.type == 'MESH' and not o.name.startswith('COL_')
            and any((o.matrix_world @ Vector(c)).z > 90 for c in o.bound_box)]
base_objs = [o for o in root.children_recursive if o.name.startswith('pavilion')]
render_preview('tower_full.png', [root], azimuth=20, elevation=6, res=(700, 1500), zoom=1.9)
render_preview('tower_pod.png', pod_objs, azimuth=20, elevation=4, res=(1100, 900), zoom=1.9, target=(0, 0, 112))
render_preview('tower_pod_above.png', pod_objs, azimuth=40, elevation=28, res=(1100, 900), zoom=2.0, target=(0, 0, 108))
render_preview('tower_pod_below.png', pod_objs, azimuth=10, elevation=-22, res=(1100, 900), zoom=2.4, target=(0, 0, 100))
render_preview('tower_base.png', base_objs, azimuth=15, elevation=12, res=(1100, 700), zoom=1.3)
export_glb('tower.glb', [root])
for o in sorted(root.children_recursive, key=lambda o: o.name):
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        print(f'[tower] {o.name:22s} tris {len(o.data.loop_triangles):6d}')
