# Horizon reconstruction + distant forest quality (2026-11-23)

Task: replace the fake-looking mountain horizon, fix distant-tree
distortion/inconsistency, make the spawn→countryside transition
seamless. Scope held: no new gameplay, buildings, landmarks or
biomes; terrain generation and WORLD_SEED untouched (all pins
bit-identical; suites math 106 / roof 11 / worldgen 86 / server 74).

## 1. The fake mountains — exact source

NOT a PNG. A repo-wide search found no mountain PNGs, skybox,
panorama or billboard assets at all. The player was seeing two
`mkRing()` meshes in buildWorld (client3d.js): open-ended
CylinderGeometry(1,1,1,180,1,true) — ONE quad tall — stretched
between y=-8 and a noise crest, MeshBasicMaterial (unlit), two
vertex colors per ring, at r 338±55 and r 478±70. Vertical paper
curtains: no slopes, no faces, no shading, identical from every
angle, and (since the Stage 11 bounds removal) INSIDE the
playable disc — the player could walk straight through them.
Camera far was 900, so the far ring also clipped in and out
from across the map.

## 2. The replacement — a real far range

Deleted both curtains. New heightfield annulus in buildWorld:
polar grid 288×18 (~5.2k quads, ONE draw call), world-anchored
at r 1030..1980 — beyond the 990 world edge, so it can never be
reached or walked through. Heights sample the SAME fields as
groundH's rim ranges (ridge2 at 0.0085 with the +31.4/+3.1
offsets, the angular sector gain, the 0.021 ridge detail), so
the far range is the rim mountain system continued outward.
Measured at r=1500: crests 11.8..179.0u, mean 78.4, 17% of the
circle below 45u (natural passes). Angular seam delta 0.000000
(heights come from world XZ, so the wrap agrees exactly).
Inner edge max height -8.0 (tucked under the countryside, no
lip). MeshStandardMaterial, flatShading, vertex colors by
height/slope (scrub → rock → pale crest; steep faces forced
rock). Fog: the material patches its fog chunk to 0.16x
density² — the standard aerial-perspective treatment; at
scene fog the range would otherwise be 99% fogged from town.
Camera far 900 → 3200 so the range never clips.

## 3. Distant trees — root causes found

(a) GLB transforms: AUDITED, NOT the bug. Every tree GLB (full
+ _LOD, all 15 species) is a single node, single mesh, identity
transforms, geometry pre-baked (script: .tests/glb-audit.py).
lodParts() nevertheless dropped node transforms by construction
— now fixed properly: it bakes each mesh's matrixWorld into a
CLONED geometry (protos are shared cache objects), including
the multi-material group path, so any future multi-node model
assembles correctly.

(b) Alpha-mip canopy thinning (the visible "eaten" distant
trees): leaf materials are alphaMode MASK, alphaCutoff 0.2 in
BOTH full and LOD files. At range, mip averaging pulls leaf
alpha under the cutoff and canopies thin out. LOD parts now get
alphaTest 0.08 (cloned materials, per species) + texture
anisotropy 8 (GLB textures defaulted to 1 → grazing shimmer).

(c) LOD silhouette shrink: decimation made _LOD models up to
11% shorter (CommonTree_5 6.28 vs 7.01u; CommonTree_3 8.82 vs
9.43). A measured LOD_Y table (full/LOD height ratios for all
15 species) is now applied in all three LOD instancing paths
(town registry via setImpMatrix, wild chunks, horizon band), so
a tree keeps one silhouette across the swap. Roots: all species
sit at y ≈ -0.24..-0.37 in model space and instances plant at
groundH - 0.04/-0.05 — grounded on the audit + code path.

(d) The town→wild quality cliff: wild chunks rendered trees
from _LOD parts at ALL distances, so a wild tree at arm's
length was decimated while a town tree beside it was full.
Fixed with the near-upgrade (below).

## 4. Chunk forest changes

- ensureVegChunk: bounding-sphere slack +4 → +7 (canopy
  overhang); entry now records chunk centre, tree IMs and
  per-species tree lists.
- Near-upgrade: FULL_PARTS cache mirrors WILD_PARTS for the
  full models. tickVegNear (220ms cadence): chunks within
  110u upgrade their TREES to full-model instancing (same
  placement data); beyond 150u they drop back (hysteresis
  110/150). Builds are entry-identity guarded — an eviction
  mid-load can never leave stale meshes; eviction disposes
  near IMs with the rest of the group (shared geometry is
  never disposed). Shrubs/rocks/grass stay on the LOD path
  (their full/LOD delta is invisible).
- Stale-callback audit: wildParts waiters already re-check
  entry identity; terrVegQ entries no-op if the terrain chunk
  left; chunk generation itself is unchanged and deterministic
  (cross-process world hash 52d55c39 from Stage 12 still the
  contract) — a revisited chunk rebuilds identical vegetation.

## 5. Testing

- Unit: math 106/106, roof 11/11, worldgen 86/86, server 74/74
  (server suite against a local instance with the new client).
  All apron/veg/settle/landmark pins bit-identical.
- Far-range math verified in Node (seam 0, crest distribution,
  inner-edge tuck) — see §2.
- Browser (SwiftShader, temp server): client boots READY, zero
  page errors, zero shader errors; __w3state.farRange = true;
  spawn state tMesh 114 / vegC 34 / streamR 330.
- Screenshots read: shots-horizon/01-spawn.png (town + hazed
  rim at frame edges), 02-gate.png (park view: near/mid trees
  full and intact; layered ridge shapes behind the rooftops —
  haze, not a paper wall).
- NOT completed in-sandbox: the staged trek to the deep wild
  (the shared box starved the test client at ~4u/min with
  evaluate timeouts; the run was killed at x≈39). vegNear
  activation, tier-change stream radii in the live client,
  and the look-back shot remain HIS-SCREEN verdicts, along
  with real-GPU pop-in feel. Two process findings from the
  session: math3d's sstep is module-private (an import of it
  killed the client module — caught by the boot gate, fixed
  with an identical local copy), and the main chat's server
  build changed the auth contract ({user, pass, pow:{c,n}})
  — probes updated to the server.test.mjs shape.

## 6. Remaining limitations

- Wild near-upgrade swaps a chunk's trees as a group at
  110/150u; with matched silhouettes (LOD_Y) and matched
  materials the swap should be subtle, but its visibility is
  a his-screen judgment.
- The far range is scenery by design: it sits beyond the
  world edge and its foothills tuck under the streamed
  countryside; it is not explorable terrain (the brief's
  "distant scenery" branch).
- Rabbit/bird/squirrel wildlife remains unsourced (standing).
