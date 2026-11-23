# Tree + Wildlife Audit — ecosystem phase, Stage 1 (2026-11-23)

Scope: every tree-generation path in world3d, the tree asset
standard, and the wildlife placeholder state. No code changed by
this audit. Implementation follows the stage order in the brief;
old-tree elimination is Stage 2 work and starts only after this
audit is reviewed.

## 1. Old / primitive tree paths found (ALL must go)

| # | Path (client3d.js) | Construction | Instances | Where it appears |
|---|---|---|---|---|
| T1 | Plaza instanced pines (~L624, town builder) | CylinderGeometry trunk + 2× ConeGeometry, flat colors, InstancedMesh | ~74 | Avenue rows (±8.5 offsets) + 7 grove clusters across the town center |
| T2 | LOD impostors (`impostorGeo` / `buildImpostors` / `registerLOD`) | Cylinder + cones (pine) / cylinder + 2 icosahedrons (leaf), vertex-colored, flat-shaded | 1 per library tree (~116) | Far LOD for EVERY natPlace tree — and the **permanent fallback when a tree GLB fails to load** (natPlace: "impostor stays as the permanent fallback") |
| T3 | Horizon silhouette band (`buildHorizon`) | 90× ConeGeometry + 26× IcosahedronGeometry, flat colors | 116 | Rim ring at r ≈ 228–234 (distant scenery) |
| T4 | Procedural sakura (`sakura()`) | Cylinder trunk + 4× IcosahedronGeometry pink blobs | 2 permanent + 8 fallback slots | Pond park pair (138,30), (140,−8) are non-hero = always procedural; plaza ring (6) + pond pair (2) are heroes whose blobs stay if the GLB swap fails |
| T5 | Round-tree fallback (`buildDressing`, ~L3004) | Cylinder trunk + 3× IcosahedronGeometry, flat-shaded | 10 fallback slots | Scattered town spots; fallback stays visible if tree_round.glb fails |
| T6 | Substandard tree GLBs | tree_sakura.glb (552 tris), tree_round.glb (472 tris) — **0 textures**, flat colors | live via swapModel (8 + 10) | Even a "successful" swap lands an untextured model that fails the standard |
| T7 | Dead tree GLBs (repo only) | tree_pine.glb (136 tris), tree_tall.glb (108), tree_broad.glb (208) — 0 textures | 0 (unreferenced) | assets/environment + assets/trees; delete from repo |

Also noted: swapModel's contract itself (fallback hidden on
success, kept forever on failure) is the mechanism behind T4/T5.
Buildings use the same helper with box fallbacks — out of scope
here, but tree call sites must stop passing primitive fallbacks.

## 2. Good tree paths (keep)

- `natPlace` (buildNature forest/meadow/landmarks, spawn
  landscaping, grove): real GLB clones on groundH, seeded
  (mulberry32 90221022), omit-on-failure. Its only defect is the
  T2 impostor registration.
- `natInst` / `natInstChunked`: instanced GLB ground cover
  (grass/flowers/ferns/bushes), omit-on-failure. Clean.
- `grovePlace` (test grove): GLB, omit-on-failure. Clean.

## 3. Approved tree asset list (inspected, not assumed)

Inspection method: parsed every candidate GLB — materials,
embedded images, normal maps, alpha mode, tri/vert counts.

**APPROVED — Quaternius Stylized Nature MegaKit (CC0)**, all in
assets/nature/. Every model: bark material with baseColor
texture + normal map, foliage material with alpha-MASK leaf-card
texture, double-sided, 3 embedded images:

| Asset | Tris | Height | Role |
|---|---|---|---|
| CommonTree_1 | 6,265 | 7.0 | broadleaf |
| CommonTree_2 | 5,648 | 7.4 | broadleaf |
| CommonTree_3 | 3,505 | 9.2 | broadleaf, tall |
| CommonTree_4 | 4,066 | 9.2 | broadleaf, tall |
| CommonTree_5 | 3,182 | 6.8 | broadleaf, small |
| Pine_1 | 3,947 | 7.1 | evergreen |
| Pine_2 | 3,648 | 7.1 | evergreen |
| Pine_3 | 4,964 | 7.2 | evergreen |
| Pine_4 | 3,370 | 10.0 | evergreen, tall |
| Pine_5 | 1,646 | 8.5 | evergreen, slim |
| TwistedTree_1 | 9,564 | 16.5 | landmark (used at 0.5–0.66 scale) |
| TwistedTree_2 | 9,134 | 18.7 | landmark |
| TwistedTree_3 | 10,089 | 15.9 | landmark / autumn accent |
| DeadTree_3 | 5,802 | 12.9 | snag — bark tex+normal, leafless BY DESIGN; sparing use only |

**NOT APPROVED:** tree_sakura, tree_round, tree_pine, tree_tall,
tree_broad (all 0 textures, 108–552 tris, flat colors).

Variety gaps vs the brief's Stage 3: no young/small tree
(Pine_5/CommonTree_5 at reduced scale is the closest), and no
quality cherry/sakura — the cozy palette wants blossoms, but the
only sakura asset fails the standard. Options when Stage 3
starts: (a) derive new variations from the CC0 MegaKit set
(recolored leaf atlases, Blender re-poses — license permits),
(b) model a proper sakura in Blender textured with real
bark/leaf-card textures. No primitive substitutes either way.

LOD direction (for Stage 6): replace T2 impostors with
**decimated versions of the approved GLBs themselves** (Blender
pipeline, same textures, ~15–25% tris) — the brief's permitted
"simplified versions of the approved tree models". The horizon
band (T3) gets the same treatment or textured billboards
rendered from the actual models; flat cones never return.

## 4. Wildlife state vs the brief's bar

Current stage-11 wildlife is **100% primitive placeholders** and
fails the "proper model" requirement:

| Species | Count | Construction |
|---|---|---|
| Butterflies | 10 | PlaneGeometry wings + box body |
| Rabbits | 5 | Spheres + box ears |
| Deer | 3 | Sphere body, cylinder legs/neck, cone antlers/tail |
| Birds | 5 | Cone body + plane wings (pond orbit) |
| Squirrels | 0 | — |
| Foxes | 0 | — |

The BEHAVIOR layer is sound and reusable: clock-deterministic
wander (identical on every client, zero network traffic), flee
offsets, ~95u distance culling. Stage 4/5 keeps the behavior
architecture and replaces the bodies.

CP8 (rigged animals) is still BLOCKED on the Quaternius
Animated Animals Google Drive quota. Folder inventory (CC0
confirmed): Alpaca, Bull, Cow, Deer, Donkey, Fox, Horse,
Horse_White, Husky, ShibaInu, Stag, Wolf. Deer + Stag + Fox
cover two of the brief's five species. The pack has **no
rabbit, bird, or squirrel** — those three need a separate
license-verified source (per-asset check, no exceptions) or a
later stage. Animals already downloaded: none (folder
listing only; Deer.gltf in assets-dl is a 0-byte/quota stub —
verify before trusting).

## 5. What Stage 2 will do (not started)

1. Delete T1 cone-pine instancing; replant those avenue/grove
   spots with approved GLBs via the deterministic spawner.
2. Delete T4/T5 procedural fallbacks + T6 swaps; sakura/round
   spots replanted from the approved list (sakura pending the
   Stage-3 decision above).
3. Replace T2 impostors with decimated approved-model LODs;
   load failure → tree omitted, never a primitive.
4. Replace T3 horizon band with textured distant trees.
5. Delete T7 dead GLBs from the repo.
6. Deterministic seeded distribution by zone (forest / edge /
   grassland / residential / spawn) on groundH with slope,
   path, building and spacing checks — extending buildNature's
   seeded approach rather than replacing it.

## 6. Implementation outcome (2026-11-23, same day — snapshot, not pushed)

All seven old-tree paths eliminated (T1–T7). Avenue/grove spots
replanted via natPlace; sakura spots now grow the derived
SakuraTree (leaf atlas verified: 0 green-dominant px, 2,353
pink); round-tree spots replanted with CommonTree variants; the
spawn-garden sakura swap replaced. Impostors replaced by
decimated real-model LODs (Blender, 20% tris, same textures),
instanced per type; horizon band replaced by LOD
CommonTree_2/Pine_3 instances on the rim. buildEcoZones added
the forest-edge gradient, residential garden trees, meadow
groves and spawn shrubs behind slope (gradient < 0.55),
terrain-material (grass+forest > 0.5, sand < 0.2, rock < 0.35)
and spacing gates, seed 112358.

Wildlife: primitive rabbits/deer/birds/butterflies REMOVED.
Deer (6, herds of 2 at 3 homes) + foxes (2, solitary forest)
are the rigged Quaternius CC0 models with Idle/Idle_2/
Headlow/Eating/Walk/Gallop state clips on the existing
clock-deterministic wander + local flee system. Facing:
models face −Z in model space; yawOff −π/2 applied and proven
in-engine — per-animal tracked facing-vs-motion dot = 1.00
across 9 samples for 6 of 7 animals (one fox had a single
turn-straddling −0.85 interval, then all 1.00; one deer was
dwelling). Rabbit/bird/squirrel remain unsourced — no
license-verified rigged models found; they ship when a source
verifies, never as primitives.

Validation: scene audit ×2 probes (identical, deterministic):
cone InstancedMeshes 0, LOD instanced meshes 20 (31,875 verts),
LOD registry 236 trees (59 near / 177 far), deer 6, zero page
or shader errors. Suites: math 106/106, roof 11/11, server
68/68, smoke ALL PASS. Screenshots read: spawn, forest
interior, forest edge, grassland, residential, pond/rim.
Perf at spawn (SwiftShader, low): ~440 draw calls, fps 23-24
(sandbox-bound; real-GPU verdict is the user's screen).
