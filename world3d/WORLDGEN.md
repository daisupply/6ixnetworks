# WORLDGEN.md — Moonfall Town endless-world overhaul: decisions + baselines

Written at Stage 1 of the world-generation overhaul (2026-11-23). The
implementation brief is `~/workspace/your_files/moonfall-worldgen-overhaul-prompt.md`;
this file records the architecture decisions taken under it and the
measured baselines every later stage is judged against.

## Architecture decisions

- **Module split.** Continuous fields (terrain height, biome fields,
  material weights) live in `math3d.js` — the one pure module the
  client and the Node suites already share. Discrete generation
  (world seed, per-chunk seeds, per-chunk RNG streams) lives in the
  new sibling module `world3d/worldgen.js`, imported by the client
  the same way `math3d.js` is. `math3d.js` stays seed-agnostic: all
  of its noise offsets remain literals, as they are today.
- **WORLD_SEED = 20261123** (in `worldgen.js`). Never changes once
  shipped; a seed change is a new world.
- **Terrain v2 handover.** `groundHBase` keeps every authored term
  bit-identical. Past rect-distance 60 beyond the playable bounds
  (|x|≤195, |z|≤118) the heightfield crossfades (smoothstep 60→200)
  to `wildH`, the procedural countryside in `math3d.js`, because the
  authored rim term saturates at dOut 85 and would otherwise ring
  the world in full-strength mountains forever. Both surfaces are
  continuous, so the blend is seamless by construction. Inside
  dOut 60 nothing changes at all.
- **Biome fields.** `biomeFields(x,z)` in `math3d.js` returns
  {moist, forest, high, lake} in [0,1] from low-frequency fbm
  (wavelengths ~200–350u). `terrainWeights` consults them only past
  dOut 30 (fade 30→90), so apron weights are bit-identical.
- **Water level.** `WATER_Y = -1.15` exported from `math3d.js`.
  Lake basins in `wildH` pull low ground toward −2.3 (the −2.6
  floor clamp applies), so basin floors sit below WATER_Y. Water
  meshes arrive in Stage 7; the heightfield carries lakes from
  Stage 2 on.
- **Apron regression pins.** Heights and weights sampled on a 10u
  grid over every point within rect-distance 30 of the bounds
  (1,342 points), hashed (djb2 pair over fixed-precision strings):
  - PIN_H = `7cfee98b:c541dc8f:12155` (groundH, pre-Stage-2 code)
  - PIN_W = `56710384:a43e1252:53680` (terrainWeights with
    ny = terrainNormal(x,z)[1], h = groundH(x,z), pre-Stage-2 code)
  Asserted by `world3d/tests/worldgen.test.mjs` from Stage 2 on.
  If a future stage legitimately changes apron terrain, the pin
  change must be deliberate, explained here, and re-pinned.
- **Zone keys.** Town stays `'town'`, interiors keep their keys;
  wilderness chunks get `wild:<cx>:<cz>` (Stage 11). The interior
  band at x 1989–2211 stays reserved.

## Baselines (measured 2026-11-23, pre-overhaul code, sandbox node)

- Suites: math 106/106, roof 11/11, server 68/68 (against a fresh
  local server, W3_BASE=http://127.0.0.1:18101), smoke ALL PASS.
- `terrainChunkGrid` cost: wild chunk (22 seg) ≈ 7.64 ms avg,
  flat plateau chunk (2 seg) ≈ 0.02 ms avg — pure math in Node.
  Stage 3's per-frame build budget must respect this: a full chunk
  is several ms before any BufferGeometry upload.
- `groundH`: 20,000 samples in 94.6 ms (≈4.7 µs/sample) over a
  mixed town/wild path; checksum 362220.172.
- Landmark heights (groundH): spawn (0,18) = 0, pond (118,12) = 0,
  gazebo (0,0) = 0, clearing pad centre (−179,−38) = 2.508944,
  overlook pad centre (174,8) = 7.285529, east edge (195,0) =
  6.292374, north edge (0,118) = 0.625207.
- **Pending (environment):** boot time, draw calls, live heap, and
  the rendered rim/backdrop screenshot strip could not be measured
  — Chrome in the sandbox dies on launch (SIGTRAP) as of
  2026-11-23. These baselines are owed when Chrome recovers and
  must be filled in before Stage 10's budget enforcement is
  signed off.

## Known defects this overhaul fixes (verified in code, Stage 1)

1. Playable bounds enforced twice (client clamp + server zone
   validation) — the world cannot be walked out of.
2. `buildTerrain()` builds one fixed 10×8 chunk grid at boot and
   never evicts; beyond it is void.
3. The beyond-bounds rim term saturates at dOut 85: full-strength
   ridged mountains in every direction, forever.
4. Biomes are positional, not fields: forest weight exists only in
   the west band, sand only at the pond.
5. No world seed / no chunk-derived seeding: all builders use
   literal boot-time seeds inside the fixed bounds.
6. Vegetation is boot-time only, gated to the bounds; nothing
   generates or disposes at runtime.
7. Sun shadow camera, sky dome and fog are anchored to the town.
8. Water is one disc at the pond; no world water level exists.
9. Roads are three hand-placed strips; no path data exists.
10. The map draws the fixed bounds rectangle only.

## Stage 2 results (2026-11-23, measured in Node)

- Apron pins hold bit-identical after the handover (PIN_H, PIN_W).
- Annulus dOut 250–900 character: 83.7% of samples below h 8,
  10.1% below WATER_Y (lake basins + low plains dips), 1.1% above
  h 20, range [−2.60, 27.55]. Pre-overhaul this annulus was
  effectively all mountains.
- Continuity: worst full-transect step 3.68 per 2.5u (pre-overhaul
  rim: 6.34); deep-wild worst 2.94 (highland ridge faces). Both
  bounded in `worldgen.test.mjs` with the reasoning recorded there.
- Suites after Stage 2: math 106, roof 11, server 68, smoke PASS,
  worldgen 27/27.
- Still owed (Chrome dead in sandbox): the rendered rim-strip
  screenshots — the view outward from the old rim in four
  directions, and the town-view regression shot.

## Stage 3 results (2026-11-23)

- Chunk manager live in `client3d.js`: `buildTerrain()` seeds the
  pinned apron (80 chunks) into `TERRAIN_MESHES`; a new
  `tickTerrainStreaming()` in the main loop applies the pure plan
  from `worldgen.js` (`planChunks`: STREAM_R 330 build, EVICT_R
  385 evict, apron never evicted), replanned on chunk-boundary
  crossings, builds draining ≤2/frame nearest-first. Eviction
  removes the mesh AND disposes + drops its cached geometry; the
  shared material, textures and index arrays are never disposed.
- Town zone only: in interiors the manager idles and clears its
  queue, so no terrain can ever generate under the interior band
  at x≈2000. `__w3state` now also reports `tMesh`.
- The plan logic is Node-tested (worldgen suite 39/39): coverage
  (no holes in the wanted disc), sort order, hysteresis band,
  apron protection at 1500u, trek re-plan. Suites: math 106,
  roof 11, server 68, smoke PASS.
- Still owed (same Chrome block): the 600u in-browser trek —
  chunk counts holding in radius, no holes at streaming speed,
  heap returning to baseline after a return trek. Player bounds
  are still enforced until Stage 11, so the trek needs the probe
  to place the player; it runs when Chrome recovers.

## Stage 4 results (2026-11-23)

- `genChunkVeg(cx, cz)` in `worldgen.js`: pure descriptors
  {trees, shrubs, rocks, grass} from world-aligned cells (trees
  13.75u / shrubs 9.17u / rocks 11u / grass 4.58u), each cell
  rolling its own hash stream — content is identical regardless
  of generation order, and border cells can never disagree.
  Gates mirror buildEcoZones (slope ≤ 0.55 via the same 1.3u
  difference, weights grass+forest > 0.5, sand < 0.2, rock <
  0.35, nothing in water); density follows the Stage 2 fields
  (forest field + forest weight, treeline fade 13–19u, lone
  meadow trees at 4.5%). Species: the 15 LOD-approved trees
  (broadleaf / pine / twisted / dead / sakura by moisture,
  height), Bush_Common(_Flowers), Fern_1, Rock_Medium_1–3,
  Grass_Common/Wispy_Short.
- Client: wild chunks render as per-chunk InstancedMeshes through
  `wildParts` (species parts cached + shared; trees via their
  decimated `_LOD` parts, the rest full). Builds drain ≤2/frame
  behind terrain; eviction disposes only instance buffers.
  Deliberate scope calls: wild trees render at LOD fidelity at
  every distance (no per-tree full clones — that's the town
  system's cost profile, not a streaming one), and wild
  vegetation has no colliders (the per-frame collider sweep
  stays town-sized).
- Measured: avg per wild chunk 5.3 trees / 6.4 shrubs / 2.2
  rocks / 53.5 grass tufts over 1,289 chunks; densest forest
  chunk 11 trees; min pooled tree spacing 8.84u (guarantee
  5.5u); content pin VEG_PIN `a3e66177:f7c9d9b1:59469`.
  Worldgen suite 49/49; math 106, roof 11, smoke PASS; server
  68/68 on re-run (one transient single-test flake on the first
  run — the same flake seen once in the v582 session, unrelated
  to this stage's files).

## Stage 5 results (2026-11-23)

- Path network as pure data in `worldgen.js`: 4 trailheads at
  dOut ≈ 34 on the avenue lines + waypoint rings at ~340 / ~560
  / ~820u (5 / 7 / 9 nodes — every candidate found a valid spot).
  Waypoints come from a deterministic golden-angle ground search
  (slope ≤ 0.35, dry, h < 14); edges link each node to the
  nearest node of the previous ring plus same-ring neighbours
  under 300u. 25 nodes, 21 edges, every node connected.
  NET_PIN `617666b9:3f6c7615:1442`.
- `pathDist(x, z)` (nearest segment) is registered into
  math3d.js through a provider slot (`setPathProvider`) — the
  module graph stays acyclic (worldgen imports math3d, never the
  reverse), and math3d alone behaves exactly as pre-Stage-5.
  A re-entrancy guard in `pathNetwork()` keeps the network build
  itself pathless (it samples weights to place waypoints).
- terrainWeights wears dirt along the tread (0.85 at the
  centreline, fading by 7u) inside the existing dOut > 30 guard,
  so PIN_H / PIN_W still hold bit-identical; the last ~34u to
  each gate is Stage 8's deliberate join. genChunkVeg clears
  trees/shrubs/rocks within 3.4u of a centreline and grass
  within 1.8u — 0 violations over 13,636 placements scanned.
  VEG_PIN unchanged (no batch chunk is crossed by a path).
- Suites: worldgen 57/57, math 106, roof 11, server 68, smoke
  PASS.

## Stage 6 results (2026-11-23) — COMPLETE (assets installed + verified same day)

- Close-out (2026-11-23 afternoon): the sandbox write layer
  healed; all six models exported on disk (cottage 560,792 B,
  shed 387,880, watchtower 644,340, well 153,448, fence
  62,572, crate 75,608), every texture verified non-empty,
  exported wall footprints re-audited (6×4 / 4×6 / 4×4 exact),
  and the .glb + .glb.b64 pairs installed into
  assets/architecture + assets/environment (installed .b64s
  decode byte-identical to the exports). The well's first
  render caught its roof floating/inverted — fixed (posts
  raised, gable slabs re-sloped to meet at the ridge) and
  re-rendered clean before install. Suites at close: worldgen
  64/64, math 106, roof 11. The server suite ran green at
  12:05 on this same world3d code; a re-run is gated on the
  repo tree's server.js, which the main chat's stage-10
  incident truncated to 0 bytes (their restore, their lane —
  the reconstruction working file was used for a temp boot
  check instead: /world3d serves 200; asset URLs sit behind
  the site gate as designed). Snapshot:
  ~/workspace/.tests/stages/worldgen-s6/ (full file copies).

## Stage 6 build record (2026-11-23 morning) — code complete, assets blocked on the sandbox

- `settlements()` in `worldgen.js`: every ring-1 waypoint hosts
  a hamlet — 2–3 cottages + a shed ringing a green, a well, 1–3
  crates by the shed, a fence arc (r 17.5) with a gap where the
  path arrives; the third hamlet also gets a watchtower. Layout
  is pure data from the node index (SETTLE_PIN
  `67130650:f8ab330e:19440`); every item sits within the pad.
- Terrain pads: each hamlet flattens groundH toward its centre
  height over r 24 (feather to 34) via a second provider slot
  (`setPadProvider` in math3d.js, same acyclic pattern as
  paths; re-entrancy guarded like the network build). Pad
  heights are exact at centres; apron pins untouched.
  genChunkVeg clears trees/shrubs/rocks within 26u of a centre
  and grass within 22u (the green stays mown).
- Client: whole-hamlet streaming in client3d.js (build < 370u,
  evict > 430u, hysteresis), structures as GLB clones, fences as
  one InstancedMesh per hamlet, colliders registered
  synchronously from layout data and spliced on eviction.
  Suites: worldgen 64/64, math 106, roof 11, server 68, smoke
  PASS.
- Buildings are kitbashes of the CC0 Medieval Village MegaKit
  in Blender (`assets-src/hamlet.py`): plaster cottage (6×4,
  tile roof, chimney, glass window inserts), brick shed (4×6),
  two-storey watchtower with the conical tower roof, an original
  well built from kit materials, plus direct fence/crate
  conversions. First renders read well (timber framing, stone,
  tile roofs all read correctly); fixes already in the builder:
  glass inserts (done, verified in renders), gable prisms now
  textured with the wall material + smart UVs (first version
  read as a bright billboard), ambient fill in renders.
- REWORK (same day, at Deion's word — he flagged the renders:
  walls not parallel, not square): the audit found the real
  bug. Blender's glTF importer leaves pieces in QUATERNION
  rotation mode, so every rotation_euler write in the builder
  was silently ignored — side walls shipped unrotated, jutting
  out like fins (cottage footprint measured 8.00×7.57, tower
  6.00×5.43), roofs unrotated, back walls unflipped. Fixed:
  place() sets rotation_mode='XYZ' first, and placements are
  recomputed from the pieces' measured geometry offset (origin
  sits +0.105 off-centre) so outer faces land exactly on the
  rectangle. Measured after (live-scene audit): cottage walls
  exactly 6×4, shed 4×6, tower 4×4, corners flush, opposite
  walls parallel. Re-renders read clean (front ¾ views with
  the ambient fill). The law is recorded in AGENTS.md.
- BLOCKED: GLB exports. Cottage (848KB) and the v1 watchtower
  exported fine, then at ~12:07 CST the sandbox's filesystem
  policy began denying writes from Blender/Python with EPERM
  (the glTF exporter's final file.write; tempfile's probe hits
  the same wall — diagnosed down to os.write on freshly created
  files; shell/dd/node writes still work, the policy flaps).
  The exports in hamlet-out/ are the PRE-rework builds — do not
  install them. When writes heal, one batch (`hamlet.py --
  cottage|shed|tower|well|fence|crate`, one process each)
  re-exports everything with the fixed geometry, then the GLBs
  + .b64s install into assets/architecture + assets/environment.
  Until they land, the client omits missing kinds gracefully
  (no crash, hamlets just lack those pieces).

## Stage 7 mini-spec (written 2026-11-23, build next)
- Behavior: wild water renders as one shared material at WATER_Y
  (-1.15); per-chunk water quads exist only on chunks whose sampled
  min ground height < WATER_Y; town chunks never get wild water (the
  park pond disc stays as-is). Landmarks: pure site-picking functions
  in worldgen.js choose a lake-island site, a highland overlook, a
  deep-forest ruin site, and a falls site from the biome fields —
  deterministic from WORLD_SEED, exported for tests + Stage 8/11 use.
- Edge cases: quads must not z-fight terrain at shoreline (offset
  +0.02, polygonOffset); a chunk fully below WATER_Y still gets one
  quad; apron chunks excluded even if a corner dips (pond area).
- What could break: water quads in interior band (guard like veg);
  streaming eviction must dispose water geometry with its chunk;
  genChunkVeg gates already keep veg out of water — landmark sites
  must not collide with hamlet pads or path tread (min distances).
- Unhappy path: a picked site that fails its own criteria on re-sample
  (float drift) — pickers assert criteria in the test suite with the
  same sampling the client will use.
- Pins: PIN_H / PIN_W / VEG_PIN / NET_PIN / SETTLE_PIN must not move
  (water + landmarks are additive; no groundH/weights changes).

## Stage 7 results (2026-11-23) — COMPLETE, PUSHED as v590 (5e9cfc96) at his word
- worldgen.js: chunkMinH/chunkWater (5x5 sample at mesh-grid
  steps; apron + interior band excluded) and landmarks() — a
  fixed 14u scan picking lake / overlook / ruin / falls by
  criteria over the continuous fields, no rng. Sites: lake
  (-896,280) h -2.60 with island (-874,290) h -0.36; overlook
  (882,-266) h 28.20; ruin (546,-896) h 5.27; falls lip
  (-28,-742) h 10.01 -> base (-36.4,-762.4) h -1.89. Picker
  cost ~0.7-0.9s one-time lazy. LAND_PIN dd9f307:6a083001:340.
  Bug caught by survey before tests: slopeOf returns {g, ny} —
  the picker's slope gates must read .g (object<=number is
  always false; only the slope-free lake picked without it).
- client3d.js: water quads ride the terrain chunk lifecycle
  (ensureWaterQuad in ensureChunkMesh, disposed in evictChunk;
  one shared material mirroring the pond's; polygonOffset -2,
  y = WATER_Y + 0.02). Falls ribbon (10-segment groundH strip,
  DoubleSide, translucent) on settlement hysteresis via
  tickLandmarks. __w3state gained waterC + fallsOn.
- Gate: worldgen 78/78 (14 new), math 106, roof 11, syntax OK.
  Browser boot check vs the temp server: READY at spawn, zero
  page errors, waterC 0 on the apron, falls correctly unbuilt
  at 740u. Not verified: standing at a lake/falls in the wild
  (needs Stage 11 bounds removal to walk there; sandbox treks
  are throughput-limited regardless). Snapshot:
  ~/workspace/.tests/stages/worldgen-s7/.

## Stage 8 mini-spec (2026-11-23)
- Prompt scope, verbatim: avenue-end transitions, fence/garden
  continuity, lamp runs along the first path segments; criteria:
  inside the plateau, no unintended change.
- Network: append 4 gate nodes (ring -2) ON the bounds lines —
  (195,0), (-195,0), (0,-118), (0,118) — each edged to its
  trailhead (nodes 0-3). Appended last so every existing node
  index (and SETTLE_PIN / VEG_PIN) is untouched; NET_PIN re-pins
  deliberately. The dirt tread then runs bounds -> trailhead ->
  ring 1; wear stays out of the apron (the dOut>30 guard is
  unchanged, so PIN_H / PIN_W stay bit-identical).
- Client dressing (one builder, town scope): flanking fence
  runs (hamlet fence GLB, one InstancedMesh) along the bounds
  line +-6..34u each side of every gate with the tread gap open;
  avenue-style lamp runs (instanced posts + heads, no real
  lights) along each join and the first ~60u of the onward
  ring-1 edge, alternating sides at groundH. No new colliders
  (bounds still clamp; wild-side lamps follow the no-wild-
  colliders rule).
- Unhappy paths: a gate fence segment landing on a hamlet pad
  or in water (gates are on the plateau rim — heights sampled
  per segment, segments below WATER_Y+0.2 skipped); the fence
  proto failing to load (dressing silently absent, gates still
  work — same rule as settlements).

## Stage 8 results (2026-11-23) — COMPLETE, not pushed
- worldgen.js: gate nodes appended in buildNetwork (ring -2) at
  (195,0), (-195,0), (0,-118), (0,118), each edged to its
  trailhead; gateNodes() exported. Network now 29 nodes /
  25 edges. NET_PIN re-pinned deliberately:
  b6a87f95:dd478b47:1576. PIN_H, PIN_W, VEG_PIN, SETTLE_PIN,
  LAND_PIN all bit-identical (append-last + the dOut>30 wear
  guard did their job). pathDist = 0 along all four joins.
- client3d.js gate dressing (town build, one block): flanking
  fence runs (hamlet fence GLB, single InstancedMesh, ~112
  segments) along the bounds line +-5.5..34u either side of
  each gate with the tread gap open; avenue-style lamp runs
  (instanced posts + emissive heads, 16 lamps) along each join
  and the first stretch of the onward ring-1 edge, alternating
  sides, seated at groundH. No new colliders.
- Gate: worldgen 82/82 (4 new Stage 8 tests), math 106, roof
  11. Browser boot check: booted READY, ZERO page errors with
  the dressing live. The spawn screenshot died to the sandbox
  timeout at capture time (target closed) — the side-by-side
  vs pre-overhaul town screenshots remain owed (his screen or
  a quiet box); inside-plateau change is provably nil by the
  pins (heights + weights bit-identical).

## Stage 9 results (2026-11-23) — COMPLETE, not pushed
- tickSkyFollow(px, pz) runs in the frame loop after
  tickTerrainStreaming: anchor = player position snapped to a
  2u grid (no shadow shimmer); sun position/target, sky dome,
  star shell, moon disc and the four nebula sprites all ride
  the anchor. Interiors (|x| > 1000) skip the follow — the sun
  stays where town left it, interior lighting untouched.
  moon.target is now scene-added so its matrix updates.
- Fog: FogExp2 0.0016 -> 0.0022. At the 330u stream edge the
  fog factor goes from ~76% visible to ~59% — softer pop-in
  without milking cross-town views (~68% at 280u). Full
  fog-wall densities (0.0035+) were rejected: they haze the
  whole town. The recorded-walk pop-in criterion stays a
  his-screen verdict.
- Verified: syntax, boot READY with zero errors, anchor at
  spawn = (0, 18) for a player at (0, 18.3) via __w3state
  skyAx/skyAz. NOT verified in-sandbox: the anchor tracking a
  long walk — the test client's heartbeat starves on the
  shared box (state drops to RECONNECTING, position freezes;
  the documented SwiftShader/scheduler class, key input and
  speed intent still register, zero page errors). His screen
  settles it, same as the owed treks.
- Known edge for Stage 12 review: the mountain ridgeline ring
  is land, not sky — it does not follow; a player walking the
  far wild will eventually cross it.

## Stage 10 results (2026-11-23) — COMPLETE, not pushed
- planChunks(have, px, pz, R = STREAM_R): eviction threshold
  is R + 55, identical to EVICT_R at the default. Client
  streamRadius() maps the existing gfx tiers (tierOf, incl.
  the auto FPS cap) to radii: high 330 / medium 260 / low 200;
  tickTerrainStreaming replans when the tier radius changes,
  even standing still. Density and placement are NEVER scaled
  — generation is radius-independent, so tiers cannot diverge
  chunk content between clients (Stage 11 hash agreement).
- Budgets surfaced in __w3state: streamR, tris (renderer.info
  triangles) alongside the existing calls/tMesh/vegC counts;
  the per-frame build drains stay capped at 2 terrain + 2 veg.
- Gate: worldgen suite with 4 new Stage 10 tests (radius
  shrinks wanted set, R + 55 eviction, default keeps, content
  determinism), math suite, client syntax. The +20% frame-time
  trek criterion is a real-GPU measurement — his screen only.

## Stage 11 results (2026-11-23) — COMPLETE, not pushed
- Server (world3d.js): zoneOf returns 'wild:<cx>:<cz>' for the
  surface out to WORLD_EDGE 990 (town/interior answers byte-
  identical; beyond the edge and the interior band stay void).
  Movement accepts same-zone OR surface->surface crossings
  (town<->wild, wild chunk<->chunk); interiors remain warp-only
  islands. Roster: surface players share one roster across
  borders within 400u; interiors unchanged (apartments still
  solo). Voice: surface pairs are eligible across chunk
  borders; the 36u radius still applies.
- Client: zoneNow() knows 'wild'; the town fence clamp is
  replaced by the +-990 world edge (interior box clamps
  unchanged); groundY and remote-avatar ground ride groundH
  on all surface; terrain streaming runs in town + wild and
  idles only in interiors; the TP boom clamp is interiors-only;
  footstep timbre and the district toast cover the wilds.
- Map: in the wild, M opens a local-area view (340u window on
  the player): path network, hamlets, gates, the four
  landmarks labelled, town outlined when in range.
- Gate: server suite 74/74 with 6 new wild tests (walk out of
  town, deep-wild chunk crossings, roster range/border rules
  both ways, interior teleport-walk refused). One trivia FAIL
  on the first run was the suite's own pre-existing flake (it
  fails whenever the first-served question's correct choice is
  index 0 — it never sees a wrong answer); green on re-run,
  unrelated to this stage. Two independent generation
  processes agree bit-for-bit on the sampled world hash
  (52d55c39: veg + terrain + network + settlements +
  landmarks). Client boot: READY, zone town, streamR 330,
  zero errors incl. shader errors.
- NOT verified in-sandbox: a live two-browser wild meet-up and
  the walk to the world edge (heartbeat starvation class) —
  his-screen / Stage 12 items.

## Stage 12 — full verification report (2026-11-23)
Measured in this sandbox, final code (Stages 1-11):
- math 106/106, roof 11/11, worldgen 86/86, server 74/74.
  Pins: PIN_H / PIN_W / VEG_PIN / SETTLE_PIN / LAND_PIN
  bit-identical to their Stage 2-7 values; NET_PIN re-pinned
  once, deliberately, at Stage 8 (gate joins).
- Cross-process world hash agreement: 52d55c39 in two
  independent generation processes (veg, terrain, network,
  settlements, landmarks) — the two-client consistency
  property at the generation level.
- Browser suite sections 1-3: loader 2/2, handshake 4/4,
  desktop boot/movement/camera/settings 16 passes with the
  same 2 inconclusive samples as the pre-overhaul baseline
  (a 0.58u W-travel sample and a 0.575 double-jump apex —
  both SwiftShader-throttle artefacts; the adjacent speed,
  direction, follow-continuity, jump-rise and landing checks
  pass). The suite then hit the sandbox throughput wall in
  section 4 (portal trek), as it did before the overhaul.
- Client boots at every stage gate: READY, zero page errors,
  zero shader errors.
His-screen only (never claimed from here): pointer-lock feel,
real-GPU frame times on a 600u trek (Stage 10 criterion), the
recorded-walk pop-in check (Stage 9), standing at the lake /
falls / world edge, the two-client wild meet-up, the Stage 8
side-by-side town screenshots, the mountain-ring crossing at
the far wild, real-device touch, and the cafe live path.
The world is walkable end to end as of Stage 11: town gates
join the path network, the sun and sky travel, tiers set the
stream radius, and the server validates wild movement,
rosters and voice across chunk borders.
