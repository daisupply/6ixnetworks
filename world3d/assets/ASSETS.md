# ASSET MANIFEST — 6ixNetworks 3D

Every asset below is **original**, modeled for this project in
Blender 4.2 via the versioned Python sources in `../assets-src/`.
No downloaded models, no third-party textures. License: the
project's own. Regenerate any GLB by re-running its source script
with headless Blender; never hand-edit a .glb. In the repo each
GLB travels as `<name>.glb.b64` (the push pipeline is text-only);
world3d.js decodes on serve, so runtime URLs stay `.glb`.

| asset | source | size | used for |
|---|---|---|---|
| environment/tree_round.glb | assets-src/trees.py | 54KB | the 10 leafy park/residential trees |
| environment/tree_pine.glb | assets-src/trees.py | 13KB | (family spare; instanced pines still procedural) |
| environment/tree_sakura.glb | assets-src/trees.py | 63KB | the 8 hero sakura trees |
| furniture/cafe_table.glb | assets-src/cafe_furniture.py | 20KB | café tables ×4 |
| furniture/cafe_chair.glb | assets-src/cafe_furniture.py | 25KB | café chairs ×8 (seat visuals; SEATS data unchanged) |
| furniture/cafe_sofa.glb | assets-src/cafe_furniture.py | 61KB | café sofa |
| furniture/cafe_counter.glb | assets-src/cafe_furniture.py | 25KB | café counter run |
| furniture/espresso.glb | assets-src/cafe_furniture.py | 24KB | espresso machine on the counter |
| architecture/coffee_shop.glb | assets-src/coffee_shop.py | 468KB | coffee shop exterior — STAGE 01 build: gable roof w/ tile texture, rail-framed storefront w/ lit-interior texture, recessed porch, modeled STARLIGHT CAFÉ sign; 6,640 tris, 33 meshes, 33 materials |
| characters/character.glb | assets-src/character.py | 199KB | rigged character — skeleton + idle/walk clips; Mira (café) first |

Conventions: meters = world units; origin at ground contact center;
front faces +Z in three.js space; materials named by slot
(`body` on the character is recolored per-NPC at runtime).
Runtime loading: `loadAsset`/`swapModel`/`attachRig` in client3d.js —
async, cached, procedural fallback stays if a load fails.
