# Asset specs

Every model in the game, with the names, sizes and origins the game code relies on. Read `CLAUDE.md`
("Asset contract") and `blender/lib/indykit.py` first.

All sizes are in Blender coordinates: **X = sideways (tangential), −Y = front/outward (toward the camera),
+Y = toward the tower, Z = up.** "Origin" is the piece root's position; geometry is defined relative to it.

## Art direction

- Clean low-poly toon, like a modern homage to 90s 3D platformers: chunky, exaggerated, rounded/bevelled big shapes,
  very few small details, readable silhouettes. Think toy-like. Thickness everywhere (no paper-thin walls; rods and
  rails at least 0.08 thick, most 0.12–0.2) because thin things shimmer and the ink outline needs something to hold.
- Flat saturated colours from `PALETTE`. Build colour patterns (stripes, panels, checker) from geometry with different
  materials. Festival look: red/cream/yellow/teal stripes, bulbs (`glow_*` spheres, r ≈ 0.12–0.18), bunting.
- The scene is lit by a low golden sun and later a sunset, so warm colours and `glow_*` lights carry the mood.
- Triangle budgets: small props 150–600, medium 600–2000, big rides ≤ 5000. Keep the whole file reasonable.
- Scale reference: Indy the cat is 1.0 tall and 1.2 long, jumps about 2.6 high and 6 far. Cartoon humans are 2.6 tall.
- Walkable tops are flat and at the stated height exactly. Collision (`COL_`) is simple closed boxes/cylinders that
  match the walkable shape (not the decoration).
- Every script ends by rendering previews (`render_preview`) and exporting. **Look at your previews** (Read tool) from
  several angles, including the game's typical view (front, about 15–25° above), and iterate until each piece looks
  good and professional: appealing proportions, clean colour blocking, nothing floating, nothing interpenetrating oddly.

## kit_rides.glb (`blender/kit_rides.py`)

Platforms. Origin = centre of the walkable top surface (top is the plane Z = 0). Supports go down and toward +Y
(the tower) and should reach at least 3.5 past the inner (+Y) edge so they always disappear into the shaft.

| Piece | Walkable top (X × Y) | Notes |
| --- | --- | --- |
| `deck_s` | 2.4 × 2.0 | 0.3 thick wooden deck, striped festival skirt on front and sides, two struts. `COL_` box. |
| `deck_m` | 4.0 × 2.4 | Same family. |
| `deck_l` | 6.0 × 3.0 | Station platform: same family plus corner posts with bulbs (posts are decoration, no collision). |
| `deck_round` | disc r = 1.3 | Round pad on a single arm, looks like a circus podium. `COL_` cylinder. |
| `bracket` | none | Support bracket only: origin at the top-front tip, triangle arm going 3.5 toward +Y and 1.2 down. For the code-built spiral track and ring walkways. |

Rides. The game moves them in code, so parts that move are separate pieces.

| Piece | Spec |
| --- | --- |
| `ferris_base` | Support for a Ferris wheel whose plane is XZ (axle along Y). Origin on the ground under the hub; hub centre at Z = 10. A-frame legs **behind** the wheel (Y from +1.6 to +3.0) plus a hub cap at the front; a small boarding step is not needed. `COL_` for the legs is not needed. |
| `ferris_rotor` | The wheel: rim, spokes, bulbs. Origin at the hub centre, rotates about Y. Structure occupies Y ∈ [+0.9, +1.5]. Eight gondola pivots on a circle of radius 8.0 in the plane Y = 0, at 0°, 45°, … (0° = +X): at each a stub axle from the rim to Y = 0. Add eight child empties `pivot_0` … `pivot_7` at the pivot positions. |
| `ferris_gondola` | Hangs from a pivot. Origin = pivot point. A U-frame: two arms at X = ±1.35 rise from the floor to a top bar through the origin. Floor: flat slab 2.6 × 1.8 (X × Y), walkable top at Z = −2.4, with a rounded tub/skirt shape below it and a tiny 0.12 lip (visual only). `COL_` box for the floor slab only (0.3 thick). Tintable body: use material `tint_main` (any palette colour) for the tub. |
| `coaster_car` | One cute roller-coaster car that drives along +X. Origin = bottom centre at rail-top level. 2.2 long (X), 1.4 wide (Y), 1.1 tall, rounded nose with headlight eyes (`glow_yellow`) at +X, seat backs, wheels. Body in `tint_main`. `COL_` box 2.2 × 1.4 × 1.1. |
| `drop_car` | Gondola of a drop ride that travels vertically on a rail behind it. Origin = centre of the walkable top (Z = 0). Floor 3.0 × 2.0, 0.35 thick, with a padded back panel 1.3 high along the +Y edge, side handles, guide rollers at +Y, bulbs under the floor. `COL_` floor box and `COL_` back panel box. |
| `drop_rail` | 4-unit tall lattice rail segment for the drop ride, stackable. Origin at its bottom centre; it stands at Y ∈ [+1.1, +1.6] relative to the car origin's line (so a rail placed at the same angle sits just behind the car), 1.2 wide. Yellow/steel. |
| `drop_top` | Cap for the top of the rail: a star-burst sign with bulbs, about 2.4 wide, 1.6 tall. Origin bottom centre, same Y offset as the rail. |
| `swing_hub` | Crown of a wave swinger (chair carousel) that surrounds the tower shaft. Origin on the tower axis, at the canopy's underside (Z = 0). A ring canopy with inner radius 5.6 and outer radius 9.5, 1.6 tall, scalloped striped edge, bulbs. Rotates about Z. Model the full 360° ring. |
| `swing_chair` | Hangs from the canopy. Origin = top of the chains. Four chains (thin rods, 0.07) converge from the seat corners up to the origin, 4.0 long. Seat: flat cushioned platform 2.0 × 1.6 (X × Y), walkable top at Z = −4.0, 0.3 thick, low backrest 0.4 on the +Y edge. Seat cushion in `tint_main`. `COL_` box for the seat. |
| `station_arch` | Festival entrance arch, 4.4 wide (X), 3.8 tall, 0.5 deep, with a blank signboard and bulbs along the arch. Origin bottom centre. Posts at X = ±2.0. No collision. |
| `sign_arrow` | Arrow sign on a 2.2 tall pole, arrow 1.4 long pointing +X, ringed with bulbs. Origin bottom centre. |

## kit_festival.glb (`blender/kit_festival.py`)

| Piece | Spec |
| --- | --- |
| `balloon` | One big round party balloon, radius 1.0, with a knot and a 2.5 long string hanging down. Origin = balloon centre. Skin in `tint_main`. `COL_` not needed (the game uses a sphere). |
| `balloon_bunch` | A cluster of 7–9 balloons (r ≈ 0.6) forming a mound about 2.6 wide with a gently domed top, strings converging to a knot 3 below. Origin = top centre of the cluster. Mixed festival colours. `COL_`: a squashed dome/cylinder r = 1.2, top at Z = 0, 0.8 tall. |
| `hot_air_balloon` | Small cartoon hot-air balloon: envelope radius 2.2, about 4.4 tall, vertical gores in two alternating colours (`tint_main` and `cream`), a flat crown disc on top (r = 1.3) to stand on, ropes, a basket 1.1 wide below with a burner glow. Origin = centre of the crown top (Z = 0). `COL_`: crown cylinder r = 1.3 (0.3 thick, top at Z = 0) and a sphere-ish envelope below so Indy bumps off the sides. |
| `lantern` | Round paper festival lantern, radius 0.9, slightly squashed, ribs, `glow_warm` body, dark caps, hangs from a 1.5 string above. Flat top cap r = 0.65 at Z = 0. Origin = top cap centre. `COL_` cylinder r = 0.85, top at Z = 0, 1.4 tall. |
| `banner` | Tall vertical festival banner: cloth 2.4 wide × 8.0 tall hanging in the XZ plane from a top bar, front faces −Y. Origin = centre of the top bar. Bold design from geometry: stripes, a big paw print, pennant-cut bottom. `CLIMB_banner`: a quad 2.2 × 8.0 covering the cloth, 0.03 in front, facing −Y. |
| `banner_short` | Same, 2.4 × 4.0, with `CLIMB_banner_short`. |
| `net` | Climbing cargo net 3.0 wide × 5.0 tall in a frame of two poles and a top bar. Origin = bottom centre. Net is in the XZ plane, climbed from −Y. `CLIMB_net` quad 2.8 × 5.0. Rope strands as thin boxes (0.07), grid about 0.5. |
| `ladder` | Yellow service ladder, 0.9 wide × 4.0 tall, stackable, stands 0.25 in front (−Y) of a wall at Y = 0. Origin = bottom centre at the wall plane. `CLIMB_ladder` quad 0.9 × 4.0 at the rung plane facing −Y. |
| `rope` | Thick sisal climbing rope with knots, 6.0 long, hanging down from the origin (top), small ring at the top. `CLIMBPOLE_rope`: a thin box/cylinder r = 0.1 along the rope. |
| `trampoline` | Round festival trampoline / bouncy drum, radius 1.3, 0.6 tall, bright striped side, springy top. Origin = bottom centre. `COL_` cylinder r = 1.3, 0.6 tall. |
| `crate` | Wooden crate 1.2 × 1.2 × 1.2 with corner battens. Origin = bottom centre. `COL_` box. |
| `gift_box` | Big present 1.6 × 1.6 × 1.0 with ribbon and bow (bow off-centre and small so the top stays walkable). Box in `tint_main`. Origin = bottom centre. `COL_` box. |
| `speaker_stack` | Festival PA speaker 1.6 × 1.3 × 2.4 with two cones. Origin = bottom centre. `COL_` box. |
| `kiosk` | Food kiosk 3.4 wide × 2.6 deep × 3.6 tall with a striped awning roof (flat top at Z = 3.6), counter facing −Y, a sign with a fish shape. Origin = bottom centre. `COL_` box for the whole body. |
| `fountain` | Round plaza fountain: basin outer radius 3.0, rim 0.5 high and 0.4 thick, water surface (`glass_clear` or `water`) at Z = 0.35, centre column 1.6 tall with a bowl. Origin = bottom centre. `COL_` for rim ring (use 12 boxes or a ring mesh) and centre column. |
| `lamp_post` | Park lamp, 4.6 tall, twin `glow_warm` globes, dark green post. Origin = bottom centre. `COL_` thin cylinder. |
| `bench` | Park bench 2.0 long, seat at 0.6. Origin = bottom centre. `COL_` box for the seat. |
| `fence` | Low festival fence segment 3.0 long × 1.0 tall, origin = bottom centre, along X. No collision. |
| `flag_pole` | 7.0 tall pole with a Finnish flag (white with blue cross) built from geometry, flag flying toward +X. Origin = bottom centre. |
| `firework_fountain` | Ground firework: a short striped cone/tube, 0.5 wide × 0.8 tall. Origin = bottom centre. Child empty `emit` at the nozzle. |
| `firework_mortar` | Rack of three launch tubes, 1.2 wide × 0.9 tall. Origin = bottom centre. Child empty `emit` at the top centre. |
| `string_bulb` | One festoon bulb: `glow_warm` sphere r = 0.13 with a small dark cap on top. Origin = top of the cap. Very low poly (it is instanced hundreds of times). |
| `bunting_flag` | One triangular pennant, 0.5 wide × 0.6 tall, 0.03 thick, hanging down from the origin (centre of its top edge), in the XZ plane. Material `tint_main`. |
| `cat_perch` | The ending gag: a small cat-tree perch that sits on the antenna tip. Round carpeted platform r = 0.95 (walkable top at Z = 0, 0.2 thick, cream carpet with a darker rim), a sisal-wrapped post 1.6 long below it, a toy mouse dangling on a string from the rim. Origin = top centre. `COL_` cylinder for the platform. |

## creatures.glb and items.glb (`blender/creatures.py`, `blender/items.py`)

Creatures face −Y. Moving parts are child objects whose origin is the joint, so the game can rotate them:
wings are named `wing_L` / `wing_R` (L = the creature's left = +X in Blender when facing −Y), origin at the shoulder,
modelled spread out flat along ±X. The game flaps by rotating them about the forward axis and folds them by rotating down.

| Piece | Spec |
| --- | --- |
| `gull` | Cartoon herring gull, body 0.9 long, wingspan 2.4. White body, grey wings with dark tips, yellow beak with a red dot, cheeky eyes. Children: `body` (mesh incl. head, beak, tail, tucked feet), `wing_L`, `wing_R`. Origin = body centre. |
| `jackdaw` | Jackdaw (naakka): small stocky black bird, 0.55 long, silver-grey nape and cheeks, black crown, large pale eyes (`glow_eye_pale`, so they bloom at dusk). Standing pose with feet; origin = bottom centre between the feet. Children: `body`, `wing_L`, `wing_R` (wingspan 1.1, modelled spread; the game folds them when perched), `head` (origin at the neck, so it can tilt). |
| `pigeon` | Plump city pigeon, 0.5 long, blue-grey with iridescent green/purple neck patch. Same structure as the jackdaw. |
| `visitor_a`, `visitor_b`, `visitor_c` | Chibi festival visitors, 2.6 tall, big head (about 1/3 of the height), simple mitten hands, different outfits/hair/skin, one holds a balloon string or an ice cream. Origin = bottom centre. Children: `body` (torso+legs), `head` (origin at neck), `arm_L`, `arm_R` (origin at shoulder, hanging down). |

Items (`items.glb`), all centred on their origin unless noted, built to spin about Z:

| Piece | Spec |
| --- | --- |
| `treat_fish` | The collectible: a chunky golden-orange fish cracker, 0.55 long (along X), 0.3 tall, 0.16 thick, with a tail fin and an eye. |
| `heart` | Health pickup: plump red heart, 0.55 wide, 0.2 thick, with a small highlight. |
| `charm_nine` | The hidden "Nine Lives" charm: golden cat-head medallion, 0.7 wide, with ears, a raised "9" and a small ring on top. |
| `checkpoint_box` | Cardboard box checkpoint: 1.3 wide (X) × 1.0 deep × 0.75 tall, open top with four flaps folded outward, a paw print on the front (−Y). Origin = bottom centre. Child `flag`: a small pole with a teal pennant with a paw on it, rising from the back corner to Z ≈ 2.0, origin at its base (the game scales it up from 0 when the checkpoint activates). `COL_` box for the body (so Indy can stand in/on it: make it a solid box 0.4 tall, lower than the walls). |

## environment.glb (`blender/environment.py`)

The world around the tower. The tower itself (`tower.glb`), the rides Indy uses and plaza props are placed by the game.

- Compass: north = Blender +Y. The tower is at the origin; ground level Z = 0 at the plaza.
- `plaza`: flat paved disc, radius 34, at Z = 0, with a ring/radial paving pattern in two tones built from geometry.
  Leave r < 13 simple (the tower base building stands there). Beyond the paving, lawn out to r ≈ 60.
- A low hedge/fence ring at r = 33–34 (≤ 1.2 tall) with a gap to the north where a wooden quay/pier (6 wide) runs
  out over the water from r = 30 to r = 46. The game adds the collision.
- **Nothing taller than 2 units within r < 46** (the camera sits there looking inward). Beyond r = 46: trees
  (birches, pines, round deciduous), a ring of non-playable park scenery as a backdrop: a second roller coaster
  silhouette, a carousel, tents, a big wheel far to one side, an aquarium/planetarium dome, kiosks, lamp strings.
- Särkänniemi is on a peninsula on the south shore of lake Näsijärvi. The lake (`water`) lies to the north, west and
  north-east, starting about 40–70 from the tower, and runs to the horizon with forested islands and far shores as
  layered silhouettes. One tiny island with a little lighthouse (Siilinkari). The tower base is ~12 above the lake:
  put the water surface at Z = −6 with a sloping grassy/rocky shore.
- To the south and south-east: the city of Tampere as chunky low-poly blocks: red-brick factories with tall chimneys
  (Finlayson, Tampella), the Tammerkoski rapids channel, a church spire, pastel apartment blocks with dark roofs,
  a stadium-ish shape, streets. To the south-west a forested ridge (Pyynikki) with a small stone observation tower.
- Seen from y = 140 the ground must look good and endless: extend terrain/water to radius ≥ 1600 with distant hills
  as a ring. The game adds fog toward the horizon.
- Clouds: 14–20 chunky cloud puffs as separate objects `cloud_01` … parented under an empty `clouds` at the origin,
  placed at radius 250–700 and height 40–220, material `white_paint`. The game slowly rotates `clouds`.
- Budget ≤ 90k triangles in total. Merge static scenery into few objects by region (`ground`, `lake`, `plaza`,
  `park_near`, `park_far`, `city`, `far_shores`, `clouds/…`).
