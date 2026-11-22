# Curated Asset Catalog — Stage 02 Environment Rebuild

Inspected 2026-11-22 in Blender 4.2.3 (batch stats + Cycles preview renders of all 68 MegaKit models;
stats for all 329 Kenney GLBs). Preview sheets: `~/workspace/.tests/catalog-{trees,cover,rocks}.png`,
per-model renders: `~/workspace/.tests/previews/megakit/`. Sources + licenses: `ASSET_SOURCES.md`.

## Art direction lock

Quaternius Stylized Nature MegaKit is the visual backbone — dense leaf-card canopies, warm bark,
mossy stone. Everything else must match ITS palette/scale or stay in the background.
Cozy golden-hour lighting (v548) stays. No photoreal textures on stylized models.

## PRIMARY — Stylized Nature MegaKit (CC0, Standard edition = 68 of 116 models)

Scale note: dims are meters as authored. World trees today are ~7–10 units; MegaKit fits nearly 1:1.

### Trees — FOREST BACKBONE
| Model | Tris | Dims (WxDxH) | Role |
|---|---|---|---|
| CommonTree_1..5 | 3,182–6,265 | ~4×4.5×7–9.4 | Main broadleaf forest + meadow + town shade trees. All 5, varied scale 0.85–1.3, random Y rotation. |
| Pine_1..5 | 1,646–4,964 | ~4–6×4–6×7.3–10.2 | Forest depth, high ground, overlook. Mix with broadleaf ~70/30. |
| TwistedTree_1..5 | 9,134–10,104 | 9–13.5×9–11.5×15.7–19 | RED autumn foliage, grey twisted trunks. Landmark only: clearing centerpiece + 2–3 accents, scale 0.55–0.75. Never a forest. |
| DeadTree_1..5 | 5,648–6,557 | 6–8.4×5.8–8.4×9.5–16.4 | Bare snags. 1–2 max, deep forest edge. Atmosphere, not decoration. |

### Ground cover — ALL CURATED
| Model | Role |
|---|---|
| Grass_Common_Short / Tall | Meadow + forest floor instanced tufts (dark green blades). Primary grass. |
| Grass_Wispy_Short / Tall | Golden dry grass — meadow variety, path edges, overlook. |
| Flower_3_Group / Single | Pink cosmos — composed meadow clusters. |
| Flower_4_Group / Single | Yellow bell flowers — meadow + clearing clusters. |
| Bush_Common_Flowers | Flowering bush — town landscaping + forest edge. |
| Bush_Common | VERIFIED in-engine (CP3): renders dark red-brown — it is the autumn/dark variant. Accent only; Bush_Common_Flowers is the green landscaping bush. |
| Fern_1 | Forest floor, shaded spots, near rocks/water. |
| Plant_1 / Plant_1_Big | Rosette plant — garden beds, planters, clearing edge. |
| Plant_7 / Plant_7_Big | Purple ground flowers — patches near paths/buildings. |
| Clover_1 / 2 | Sparse meadow scatter, small scale. Optional. |
| Mushroom_Common / Mushroom_Laetiporus | Forest floor detail at tree bases. Small counts. |
| Petal_1..5 | Oversized single petals — SKIP (reads wrong at world scale). |

### Rocks + paths
| Model | Role |
|---|---|
| Rock_Medium_1..3 | THE boulders. Forest, meadow, shoreline, overlook. Varied scale/rotation. |
| Pebble_Round_1..5 | Mossy flat stones — scatter, pond edge, stepping stones. |
| Pebble_Square_1..6 | Cut-stone blocks — ruins/steps accents only, sparing. |
| RockPath_Round_* / RockPath_Square_* | Pre-made cobble path patches — forest trail + garden paths (replaces plain ribbon look). |

## SUPPLEMENT — Ultimate Nature Pack (Quaternius, CC0, FBX only → convert picks to GLB)
- **BirchTree_1..5 + BirchTree_Autumn_1..5**: white-bark species the MegaKit lacks — meadow + forest-edge
  variety. Same artist, compatible style. Convert on selection.
- Skip: snow variants (wrong season), cacti (wrong biome), dead variants (MegaKit DeadTree is better).

## BACKGROUND / PROPS — Kenney Nature Kit (CC0, 329 GLBs)
Median 76 tris, max 720; authored ~1 unit tall (needs ×4–6 scale). Noticeably simpler than Quaternius —
per spec rule: NO foreground hero use. Approved roles:
- **Bridges** (bridge_wood/stone, 16 variants) — pond/stream crossing in the park/water zone.
- **Fences** (12) — garden/property lines at distance.
- **Logs + stumps** (11) — forest floor mid-distance.
- **Cliffs** (56) — far rim silhouettes only.
- Everything else: skip unless a specific gap appears.

## ARCHITECTURE KITS (CP7 will cherry-pick with renders)
- Medieval Village MegaKit (176 glTF): modular walls/corners/doors/floors. Most reads medieval —
  candidates only: door frames, balconies, wood floors for porches. Town stays modern-cozy.
- Downtown City MegaKit (153 glTF): brick modular system — too urban overall; candidates:
  brick columns/trim for the hall. Decide at CP7, default is NO.

## WILDLIFE — Quaternius Ultimate Animated Animals (CC0)
12 rigged glTF on Google Drive (Alpaca, Bull, Cow, Deer, Donkey, Fox, Horse, Horse_White, Husky,
ShibaInu, Stag, Wolf) — file IDs mapped, download currently blocked by a Drive quota error
(retry later; CP8 item). World picks when acquired: Deer, Stag, Fox (+ maybe Horse). Farm/dog
animals don't fit the wild brief.

## CP3 in-engine verdicts (test grove, 2026-11-22)
- Art direction LOCKED: MegaKit models + cozy golden-hour lighting read correctly in-engine;
  WebP textures load clean in three r160; scale is right (canopy ~2x avatar height).
- Grass_Common_Tall renders DARK (near-black on the shadow side). CP6 must vary it:
  mix Grass_Wispy, vary density, and use InstancedMesh.setColorAt tints toward lighter
  green/gold so fields don't read as a hedge wall.
- TwistedTree red crown over green understory trees reads great as a landmark.

## Stage 03 — grove inventory + world-wide systems (2026-11-22)
The CP3 test grove (34, 64) is the reference environment. What makes it read well:
- MODELS: CommonTree_1/3/5, Pine_2/4, TwistedTree_2 (landmark), Bush_Common +
  Bush_Common_Flowers, Rock_Medium_1/3, Fern_1, Flower_3/4_Group (Quaternius MegaKit, CC0).
- GROUND COVER: Grass_Common_Tall instanced (240 in the grove disc; zoned world-wide
  since CP6), instance-color variation, gentle emissive lift (0x1c2a0e x 0.38) so
  shadow sides don't go black.
- SYSTEMS: groundH terrain, golden-hour sun/hemi/fog (v548), seeded deterministic
  placement, loadAsset cache (one fetch per model, clones share geometry/materials).
Stage 03 extends this world-wide: chunked lawn grass (44u cells, 68 chunks, 5,998
instances, distance visibility w/ hysteresis), road-edge tufts, building-perimeter
landscaping (flowering bushes at corners, Plant_1_Big at doors, flower patches),
tree LOD (full GLB near / merged-geometry impostor instanced far; impostor is also
the load/failure fallback; time-based 220ms update cadence; distances scale with
the gfx tier: low 68 / medium 95 / high 130), and a horizon ring (10 hills + 116
silhouette trees) so the world never ends at a hard edge. Terrain + buildings are
persistent single systems — they never unload, so streaming can't open holes.

## Conversion rules (glTF/FBX → repo GLB)
- Blender import → apply scale → export single GLB with textures embedded.
- Texture caps: bark/leaf atlases ≤1024px, small props ≤512px (source PNGs are 4–5.7 MB each —
  raw import would explode repo + load time).
- Naming: `world3d/assets/nature/<model>.glb.b64`, manifest rows in ASSET_SOURCES.md.
- Pivot/origin at ground center; forward +Z to match existing pipeline.
