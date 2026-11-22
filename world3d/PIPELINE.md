# 3D ASSET PIPELINE — audit, plan, and migration rules (v553+)

## 1. Audit of the current architecture (measured 2026-11-21)
- `client3d.js`: 2,892 lines, one module. **159 primitive geometry
  constructions** (Box/Cylinder/Cone/Sphere/Icosahedron/Plane/Circle/
  Torus), **73 material constructions**, only **11 InstancedMesh** uses.
- Scene construction is 13 `build*()` functions; `buildTown()` and
  `buildWorld()` are monoliths mixing terrain, buildings, props,
  lighting and interiors.
- Rendering: one renderer, one rAF loop, ~234 draw calls at spawn
  (low tier, sandbox GPU). Server contract: HTTP ping presence,
  zone-box interiors at x-offsets, server-validated economy. All of
  that stays.
- Characters: procedural articulated box avatars, pose math in
  `animateAvatar()` (walk/idle/sit/wave/celebrate). No skeletons,
  no clips, no skinned meshes anywhere.
- Materials: MeshStandardMaterial with flat colors + a few canvas
  textures (ground, plaza, windows, signs, posters). No normal /
  roughness / AO maps.
- What is GOOD and stays: instanced flowers/lamps/shards patterns,
  zone light culling, interior x-offset architecture, the whole
  server contract, FP/TP cameras, collision registries (circle/box
  colliders are data, independent of visuals).

## 2. What gets replaced by modeled assets (priority order)
REPLACE (visually important, primitive today):
- Trees (leafy blobs + cone pines) → modeled tree family (3 variants).
- Café furniture (tables/chairs/counter/sofa) → modeled furniture set.
- NPC bodies (at least the fixed-post NPCs first) → rigged character
  with real idle/walk clips.
- Coffee shop exterior shell → architectural kit build (walls with
  real window/door assemblies, roof, awning, sign) — the slice.
- Street props (bus stop, benches, mailboxes, lamps) → modeled props.
- Buildings row (arcade/clothing/library/rec/apartments) → kit-built
  from shared wall/window/roof components, one style pass each.
KEEP PROCEDURAL (correct tool for the job):
- Collision volumes, interaction zones, ground/plaza/street planes
  (large flat surfaces with canvas textures), water surface, sky
  dome, particles (petals/spray/stars), the FP view-model hands
  (must track the camera math exactly), gazebo + fountain (already
  the landmark look; revisit after the kit exists).

## 3. The pipeline
Blender 4.2 LTS (headless, scripted with Python in
`world3d/assets-src/`) is the modeling tool. Every asset:
- modeled as real mesh objects (bevels, joined/merged parts, proper
  origins at ground contact, real-world scale in meters = world units),
- materials assigned in Blender (Principled BSDF; vertex-color or
  small canvas textures where a texture earns its place),
- exported to **glTF binary (.glb)** into `world3d/assets/<family>/`,
- loaded at runtime by the vendored **GLTFLoader (three r160)** via
  `loadAsset()` in client3d.js — cached by URL, cloned per use,
  disposed with the scene like everything else.
Source `.blend`-equivalent: the Python build scripts ARE the source
of truth (versioned, re-runnable); exports are regenerated, never
hand-edited. `assets/ASSETS.md` is the manifest: name, source script,
license (all original, made for 6ixNetworks), triangle count, usage.

## 4. Dependencies
- Blender 4.2.3 headless (build-time only; never shipped to players).
- GLTFLoader + BufferGeometryUtils from three@0.160.0, vendored at
  `world3d/vendor/addons/` (MIT, same version as the engine — no
  second renderer, no runtime CDN).
- No new npm dependencies. No external models. No texture downloads.

## 5. Directory structure (created as used, never empty-shell)
world3d/
  assets/            shipped .glb files, by family
    architecture/  environment/  furniture/  characters/
    textures/        (only when a texture file earns its place)
  assets-src/        Blender Python build scripts (the sources)
  vendor/addons/     GLTFLoader (r160)
  PIPELINE.md        this document
  assets/ASSETS.md   the asset manifest

## 6. Compatibility plan
- Server contract untouched: no endpoint, zone, or economy changes.
- Every replacement is VISUAL-ONLY: positions, colliders, SEATS,
  INTERACT entries, door pairs and NPC posts stay byte-identical,
  so gameplay cannot drift. A GLB that fails to load falls back to
  the existing procedural build for that object (never a hole).
- Characters migrate one class at a time: fixed-post NPC → walking
  NPCs → remotes → local avatar last, each behind the same
  `animateAvatar`-shaped state (speed/pose/emote) so sync is unchanged.
- FP hands stay procedural (they are a view model, not a character).

## 7. Performance plan
- GLBs are small (low-poly, merged materials, no embedded textures
  beyond small canvases) and load async during the existing loader;
  the world boots on procedural fallbacks if an asset is slow.
- Repeated assets (trees) load once and clone; tree canopies join
  the existing sway/instancing strategy where counts grow.
- Draw-call budget: replacements must not raise spawn draw calls by
  more than ~10%; measured before/after each stage via __w3state.
- Mobile: same tiers (low tier keeps shadows off; GLB geometry is
  cheaper than the primitive piles it replaces).

## 8. Staging
- v553: foundation (loader, structure, manifest, material presets)
  + tree family + café furniture (interior slice) + rigged NPC (Mira).
- v554: coffee shop exterior from the architecture kit.
- v555: street props + remaining NPCs on the rig.
- v556: north-row buildings kit pass; apartments/rec polish.
Each stage: suites + draw-call check + screenshots, then push.
