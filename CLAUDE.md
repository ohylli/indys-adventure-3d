# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Overview

**Indy's Adventure 3D: Näsinneula** is a browser 3D platformer and the sequel to `../indys-adventure` (2D pixel art).
Indy, a real fluffy white cat with a dark tabby cap and a big dark tail, climbs the outside of the Näsinneula
observation tower in Tampere "to claim it" (the tallest cat tree in Finland). It is one continuous stage on a festival
night at the Särkänniemi amusement park: rides on the lower half of the tower, festival decorations higher up,
fireworks at the top. Nothing is ever killed: creatures are scared off or charmed by a meow.

Look: clean low-poly toon. Chunky shapes, flat colours, cel shading, dark post-process outlines, saturated palette,
golden afternoon at the base turning to sunset at the top. A "retro mode" toggle renders at low resolution.

## Stack and commands

- three.js (WebGL renderer) + three-mesh-bvh, bundled by Vite into a static site (`dist/`, relative base) for GitHub Pages.
- `npm run dev` (port 5173), `npm run build`, `npm test` (Playwright bot run).
- Models are built by Blender Python scripts in `blender/` (Blender 5.2, headless) and exported as GLB to `public/assets/`:
  `"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python blender/<script>.py`
- Audio is synthesized with Web Audio. There are no audio files and no textures.

## Layout

```
index.html              canvas + UI root
src/main.js             boot and main loop (fixed 60 Hz update, interpolated render)
src/game.js             game state machine (loading, title, play, pause, claim, results)
src/core/               renderer + post FX, toon materials, asset loading, input, settings
src/world/              collision, player controller, camera, level, level data, movers, entities, sky
src/fx/                 particles, fireworks
src/audio/              adaptive music, sound effects, meow synth
src/ui/                 HTML/CSS overlay: HUD, screens, touch controls
blender/lib/indykit.py  shared Blender helpers and the colour PALETTE
blender/*.py            one script per GLB
blender/ASSETS.md       the exact spec of every model (names, sizes, origins)
blender/previews/       preview renders (not shipped)
public/assets/*.glb     exported models
tools/*.html            dev sandboxes (not part of the build)
tests/                  Playwright scripts
```

## World conventions

- three.js coordinates: Y up, metres-ish ("units"). The tower axis is the Y axis through the origin. Ground is y = 0.
- Cylindrical placement: angle θ in degrees, radius r, height y → position `(r·sin θ, y, r·cos θ)`.
  An object placed with `rotation.y = θ` has its local +Z pointing outward (away from the tower, toward the camera)
  and local +X pointing along increasing θ. The camera always sits outside the player looking inward at the tower,
  so increasing θ is "right" on screen.
- Scale: Indy is about 1.0 tall (ear tips) and 1.2 long. The game tower is 140 units tall and the HUD shows
  altitude = y × 1.2 m (168 m at the tip). Shaft radius ≈ 5, pod radius ≈ 15.
- Game logic runs at a fixed 60 Hz. Movers are pure functions of time.

## Asset contract (Blender → game)

- 1 Blender unit = 1 game unit. Blender Z up → game Y up. Blender −Y → game +Z ("outward"/front). Blender X → game X.
  So in Blender: front of a thing faces −Y, and for pieces mounted on the tower the tower is on the +Y side.
- Flat colours only. One Principled material per colour, created with `indykit.mat(name)` from `PALETTE`
  (or `mat(name, '#hex')` for a one-off). No image textures, no vertex colours.
  The game turns materials into toon materials by name: `glow_*` → unlit emissive (blooms at dusk),
  `glass_*` → transparent, `tint_*` → recoloured per instance from level data.
- Shading via `indykit.shade(obj, angle)`. Outlines are a post-process, so do not model outline hulls.
- Helper objects, exported but hidden in game: `COL_*` collision-only meshes (simple boxes/cylinders, closed),
  `CLIMB_*` climbable flat quads (front = the side Indy climbs on), `CLIMBPOLE_*` climbable vertical poles/ropes.
  Visible meshes do not collide unless they have a `COL_` sibling.
- A kit file holds many pieces. Each piece is one root object (an empty or a mesh) with a unique name, and everything
  that belongs to it is parented under it. Root positions may be spread out for preview renders: the game resets each
  root to the origin, so a piece's geometry is defined relative to its root.
- Named child empties are attachment or pivot points that the game animates (for example `wing_L`).
  The game does all motion in code, so kit files have no baked animations (only `indy.glb` has skeletal animations).

## Module contracts

`src/core/layers.js`: `LAYER_DEFAULT = 0`, `LAYER_NO_OUTLINE = 1`. Sky, particles, glows and anything transparent that
must not get an ink outline goes on layer 1 only (`obj.layers.set(LAYER_NO_OUTLINE)`).

`src/core/input.js` (`input` singleton): `init()`, `poll()` once per frame, fields `moveX`, `moveY` (−1..1, up = +1),
`jump`, `meow` (held), `pressed(action)` for edges (`jump`, `meow`, `pause`, `confirm`, `back`, `up`, `down`, `left`,
`right`, `mute`, `retro`), `lastDevice` (`'keyboard' | 'gamepad' | 'touch'`), `setVirtual({moveX, moveY, jump, meow})`
and `virtualPress(action)` for touch controls, `glyph(action)` for on-screen key names.

`src/core/settings.js` (`settings` singleton): `get(key)`, `set(key, value)`, `on(fn)`; keys `retro`, `muted`,
`musicVolume`, `sfxVolume`. Persisted in localStorage.

`src/audio/index.js` (`audio` singleton): see the header comment of that file.
`src/ui/index.js` (`ui` singleton): see the header comment of that file.
`src/fx/particles.js`, `src/fx/fireworks.js`, `src/world/sky.js`: see their header comments.

## Rules for parallel work

- Stay inside the files you were assigned. Do not run `npm install`, do not edit `package.json`, do not commit.
- Dev sandboxes go in `tools/` and use their own Vite port (`npx vite --port <yours> --strictPort`).
- For browser checks write a Node script with the `playwright` package (already installed, Chromium is cached;
  launch with `args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']` for WebGL).
  The Playwright MCP browser is reserved for the lead session.
