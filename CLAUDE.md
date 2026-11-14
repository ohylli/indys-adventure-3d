# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Overview

**Indy's Adventure 3D: Näsinneula** is a browser 3D platformer and the sequel to Indy's Adventure (2D pixel art;
where its checkout lives on this machine, if anywhere, is in `CLAUDE.local.md`).
Indy, a real fluffy white cat with a dark tabby cap and a big dark tail, climbs the outside of the Näsinneula
observation tower in Tampere "to claim it" (the tallest cat tree in Finland). It is one continuous stage on a festival
night at the Särkänniemi amusement park: rides on the lower half of the tower, festival decorations higher up,
fireworks at the top. Nothing is ever killed: creatures are scared off or charmed by a meow.

Look: clean low-poly toon. Chunky shapes, flat colours, cel shading, dark post-process outlines, saturated palette,
golden afternoon at the base turning to sunset at the top. A "retro mode" toggle renders at low resolution.

Other level themes that were considered are in `docs/IDEAS.md`.

## Stack and commands

- three.js (WebGL renderer) + three-mesh-bvh, bundled by Vite into a static site (`dist/`, relative base) for GitHub Pages
  (`.github/workflows/pages.yml`).
- `npm run dev` (port 5173), `npm run build`.
- `npm test`: a bot plays the whole stage in headless Chromium (see Testing). `npm run test:touch`: touch controls.
- Models are built by Blender Python scripts in `blender/` (Blender 5.2, headless) and exported as GLB to `public/assets/`:
  `blender --background --python blender/<script>.py` (the Blender executable's path on this machine is in `CLAUDE.local.md`)
  Each script also renders previews to `blender/previews/` (not committed): look at them after changing a model.
- Audio is synthesized with Web Audio. There are no audio files and no textures.

## Layout

```
index.html              canvas + UI root
src/main.js             boot and the frame loop
src/game.js             the Game: scene, lights, state machine (loading, title, play, pause, claim, results),
                        hooks the entities call (hurt, collect, setCheckpoint, hint), HUD and audio driving
src/debug.js            window.indy test hooks
src/core/               renderer.js (passes), assets.js (GLB loading, toon materials, batching), input.js, settings.js, layers.js
src/world/              collision.js, player.js, indyModel.js, camera.js, level.js (builder), leveldata.js (the stage),
                        movers.js, entities.js, sky.js
src/fx/                 particles.js, fireworks.js, pool.js
src/audio/              index.js (API), music.js, songs.js, synth.js, sfx.js, voice.js, ambience.js, graph.js, theory.js
src/ui/                 index.js (API), ui.css, touch.js, icons.js
blender/lib/indykit.py  shared Blender helpers and the colour PALETTE
blender/*.py            one script per GLB: indy, tower, kit_rides, kit_festival, creatures, items, environment
blender/ASSETS.md       the spec of every model (names, sizes, origins) that the game code relies on
public/assets/*.glb     exported models
tools/                  dev sandboxes (audio.html, ui.html, fx.html), montage.mjs (contact sheets of images),
                        record.mjs (renders a playthrough video with audio)
tests/                  run.mjs + bot.js + route.js (the playthrough), touch-check.mjs, and the subagents' checks
```

## World conventions

- three.js coordinates: Y up, 1 unit ≈ 1 m. The tower axis is the Y axis through the origin. Ground is y = 0.
- Cylindrical placement: angle θ in degrees, radius r, height y → position `(r·sin θ, y, r·cos θ)` (`cyl()` in movers.js).
  An object placed with `placeCyl` has its local +Z pointing outward (away from the tower, toward the camera)
  and local +X pointing along increasing θ. The camera always sits outside the player looking inward at the tower,
  so increasing θ is "right" on screen. θ = 0 is south (the pavilion entrance), θ = 180 is the quay to the north.
- Scale: Indy is about 1.0 tall and 1.2 long, jumps about 2.55 high and about 4.4 far (more with a pounce).
  The game tower is 140 units tall and the HUD shows altitude = y × 1.2 m (168 m at the tip). Shaft radius ≈ 5, pod ≈ 16.
- Game logic runs at a fixed 60 Hz (`Game.fixed`). Movers are pure functions of game time.

## Architecture notes

- **Rendering** (`core/renderer.js`): scene to a half-float target with a depth texture; a second pass of view normals
  of layer 0 only (`scene.overrideMaterial`); an ink pass that finds edges in depth and normals; bloom; a final pass
  that encodes sRGB and, in retro mode, dithers. Things that must not get ink (sky, particles, glows, far scenery)
  are on `LAYER_NO_OUTLINE`. Retro mode renders at 288 lines and lets CSS scale the canvas with `image-rendering: pixelated`.
- **Materials and batching** (`core/assets.js`): every GLB material becomes a toon material by name (`glow_*` unlit and
  brightened at dusk via `assets.setGlow`, `glass_*` transparent, `tint_*` recoloured per instance). To keep draw calls
  low, flat colours are baked into vertex colours so almost everything shares `assets.vcToon` / `assets.vcGlow`, and
  `Level._mergeStatic` bakes all static level geometry (kit pieces, tower, landscape) into one mesh per material.
  Anything that must stay a separate object is marked `userData.noMerge` (spinners, checkpoints, the beacon bars).
- **Collision** (`world/collision.js`): triangle meshes in BVHs: one merged static collider plus one per mover. Collision
  geometry comes from `COL_*` helper meshes in the GLBs and from the level builder's procedural pieces. Queries are a
  sphere push-out and downward ray casts. Climbables are analytic: planes (from `CLIMB_*` quads) and poles.
- **Player** (`world/player.js`): states `ground`, `air`, `climb`. On the ground Indy follows the floor with a
  five-ray probe (so small gaps and steps up to 0.24 are walkable) and a floating sphere handles walls. Movement is in
  the tower's frame: stick right = tangent, stick up = toward the axis (near the axis it blends to the camera's frame).
  Hopping over the top of a climb (`vault`) is committed for 0.34 s. `TUNE` at the top of the file has every number.
- **Movers** (`world/movers.js`): motion functions `(t, object)`; `Level.mover()` wraps a kit piece, registers its
  collider and climbables in the mover's local space, and the player is carried by `mover.delta`.
- **Level** (`world/leveldata.js`): the stage as code, one function per section, using the builder in `level.js`
  (`piece`, `mover`, `arcDeck`, `box`, `cable`, `treat`, `checkpoint`, `gull`, `wind`, `sparkler`, `hint`, …).
  Checkpoint order matters: `tests/route.js` refers to checkpoints by index.
- **Entities** (`world/entities.js`): each has `update(dt, t, player)` and optionally `onMeow(pos)` and `reset()`.
  They talk to the game through `ctx.game` (`hurt`, `collect`, `setCheckpoint`, `hint`, `tension`, `playing`).
  Give an entity a `type` string if a test needs to find it (class names are minified in the build).
- **Camera** (`world/camera.js`): follows Indy's angle around the tower with a little lead; `mode` is `follow`,
  `orbit` (claim) or `title`.
- **Audio** (`audio/index.js` header) and **UI** (`ui/index.js` header) document their own APIs. The game calls audio
  through a proxy that logs and swallows exceptions, so sound can never stop the game.
  Frame order: `input.poll()` → game logic → `ui.tick()`. The UI handles the M and R keys and the pause menu itself.

## Testing

- `node tests/run.mjs` plays the stage with the bot: `--each` (every section alone from its checkpoint), `--only=name`,
  `--god`, `--shots`, `--url=http://127.0.0.1:5173/` (use a running dev server), `--eval=file.js` (run a snippet with
  `window.bot` and `window.indy` after booting, for debugging). The route is `tests/route.js`.
  After changing the level layout or `player.js`, run it; if a section fails, `--each` shows which one.
- The bot (`tests/bot.js`) is async: route steps are `await b.walk(...)` etc. `b.beat(s)` is a pause that only happens
  in showcase recordings; put it only where Indy stands safely.
- `node tools/record.mjs` renders a showcase video (title, the bot's climb, claim, results) with the game's audio to
  `tests/out/video/indy-playthrough.mp4`, offline and frame by frame on Playwright's fake clock (needs ffmpeg on PATH).
  `--only=name`, `--max=seconds`, `--fps=30`, `--size=1280x720`. Its header explains how it works.
- `window.indy` (src/debug.js): `start()`, `manual(true)` + `step(n, input)`, `tp(a, r, y)`, `cp(i)`, `god(true)`, `info()`.
- The Playwright MCP browser is good for looking at the game: load the dev server, call `indy.start()`, teleport with
  `indy.cp(i)`, take screenshots. `node tools/montage.mjs out.png <cols> a.png b.png …` tiles screenshots into one image.

## Asset contract (Blender → game)

- 1 Blender unit = 1 game unit. Blender Z up → game Y up. Blender −Y → game +Z ("outward"/front). Blender X → game X.
  So in Blender: front of a thing faces −Y, and for pieces mounted on the tower the tower is on the +Y side.
- Flat colours only. One Principled material per colour, created with `indykit.mat(name)` from `PALETTE`
  (or `mat(name, '#hex')` for a one-off). No image textures, no vertex colours.
- Shading via `indykit.shade(obj, angle)`. Outlines are a post-process, so do not model outline hulls.
- Helper objects, exported but hidden in game: `COL_*` collision-only meshes (simple, closed),
  `CLIMB_*` climbable flat quads (front = the side Indy climbs on), `CLIMBPOLE_*` climbable vertical poles/ropes.
  Visible meshes do not collide unless they have a `COL_` sibling.
- A kit file holds many pieces. Each piece is one root object with a unique name, and everything that belongs to it
  is parented under it. The game resets each root to the origin.
- Parts the game animates are separate child objects with a custom property `part` (for example `wing_L`, `head`,
  `flag`, `emit`): look them up with `assets.part(obj, 'wing_L')`. Blender object names are global, so children are
  named `<piece>_<part>`. Kit files have no baked animations; only `indy.glb` has skeletal animations
  (`idle`, `walk`, `run`, `jump`, `fall`, `land`, `pounce`, `climb`, `hurt`, `sit`).
