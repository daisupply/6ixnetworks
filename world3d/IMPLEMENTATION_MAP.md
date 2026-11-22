# 3D World — Implementation Map (written 2026-11-21, v540 rebuild)

How the 3D world actually works, end to end. Read this before editing.

## Files
- `world3d/world3d.js` — server module `createWorld3D(ctx)`: page HTML,
  asset serving, `/api/world3d/*` (presence + movement validation).
  Reads `client3d.js`, `world3d.css`, `vendor/three.module.min.js` from
  disk ONCE at module creation — restart the server to serve edits.
- `world3d/client3d.js` — the whole client engine (ES module, imports
  `three` via the page importmap). One renderer, one loop.
- `world3d/world3d.css` — page styles. The LOADER's critical styles are
  ALSO inlined in `page()` (world3d.js) so first paint is never unstyled.
- `world3d/vendor/three.module.min.js` — Three.js r160, vendored + pinned
  (sha256 3e690ac7…). No npm dependency (see package.json: no three).

## Wiring (server.js — the ONLY host; worker.js has zero world3d refs)
- `world3dMod()` (~L19063): lazy require + ctx injection.
- `world3dApi()` (~L19076), dispatched at ~L24739 for `/api/world3d/*`.
- Page route ~L24620: `GET /world3d` → `page()`, `text/html`, no-cache.
- Asset route ~L24621: `GET /world3d/*` → `asset()`; vendor file gets
  `cache-control: public, max-age=604800`, client/css `no-cache`.
  MIME: css `text/css`, js `text/javascript` (both charset utf-8).

## Launch journey (2D → 3D → 2D)
1. 2D `world/client.js`: portal drawn beside the fountain (2620,1500);
   action system sets `actMode='dim3'` within 105px → prompt
   "ENTER THE THIRD DIMENSION" → `enterDim3()` (transition lock
   `dim3Busy`, saves `{x,y}` to sessionStorage `six3d-return`, swirl
   overlay, navigates to `/world3d?from=portal` after 700ms).
2. 3D page: inline critical CSS paints the loader instantly → importmap
   → module `client3d.js` → boot state machine (below) → first frame.
3. Return: walk to the 3D portal (22,0) → RETURN prompt → `goBack()`
   (leave beacon + crossing overlay) → `/world`; 2D client restores the
   saved position from `six3d-return` on load (client.js ~L158).

## Boot state machine (client3d.js)
INITIALIZING → LOADING_ASSETS (module + three.js executing) →
BUILDING_WORLD (renderer live, scene built) → INITIALIZING_PLAYER
(avatar spawned) → INITIALIZING_CONTROLS (input + settings bound) →
CONNECTING (initial ping in flight) → READY (validated handshake —
HTTP ok + JSON + ok:true — AND first frame rendered; only then does
the loader fade and input go live). Post-READY states: RECONNECTING
(no successful ping for >3.2s; returns to READY on the next valid
ping), SESSION_CONFLICT (server rejected our sid — see below), ERROR
(handshake failure, WebGL loss, module failure: message + retry +
back-to-2D; a 16s watchdog covers a module that never executes).
Progress bar % is bound to these checkpoints. Input is live ONLY in
READY and RECONNECTING.
Pure math (movement basis, damping, boom segments) lives in
`world3d/math3d.js`, imported by the client and by the tests.

## Session ownership (one live tab per account)
The server entry holds one sid. A movement ping from a different sid
is rejected `{ok:false, err:'session taken over'}`; a position-less
ping transfers ownership. The client treats a takeover reply as a
hard freeze (SESSION_CONFLICT): inputs cleared, velocity zeroed, the
ping scheduler stops submitting positions, a persistent card offers
'use this tab instead' (one position-less reclaim ping) or back to
2D. A conflicted tab also skips the pagehide leave beacon — the entry
belongs to the live tab, and deleting it would respawn them.

## Tests (world3d/tests/, see its README)
- `math.test.mjs` — node only, imports math3d.js directly.
- `server.test.mjs` — API/asset contract against a local test server.
- `browser.test.mjs` — real Chrome battery (loader, handshake failure,
  movement/camera, throttled frame rates, portal, takeover, mobile).

## Data & multiplayer (single source of truth)
- Identity: the site's session cookie; `ctx.voterUser(req)` resolves
  the user. Unauthenticated API → 401 `{err:'login first'}`.
- Currency/inventory/progression live in server.js systems
  (`cfg:cents`, `cfg:wdata`) and are reached ONLY through ctx
  (`getCents`, `getHue`, `getFx`, `storeReady`). Since v543 the 3D
  layer also spends/awards through ctx hooks (`spendCents`,
  `awardCents`) and owns one record inside `cfg:cents` — `cos`
  (cosmetics ownership/wear, star shards, trivia day state, apartment
  decor) via `getCos`/`cosBuy`/`cosWear`/`cosPatch`. Prices, shard
  positions, trivia answers and decor ranges are server-side truth;
  the client only mirrors them for display.
- Presence: this module's own in-memory Map (dimension-separated from
  the 2D world's P map by construction). HTTP ping-polling, no sockets:
  `POST /api/world3d/ping` {x, z, ry, sid, sit, warp, emote} → {me, bal,
  x, z, zone, portal, cos, roster:[{u, x, z, ry, fx, hue, sit, wear,
  emote}]}; `POST /api/world3d/leave`.
- Zones (v543+): positions derive the zone — town (±195/±118) or an
  interior box at world x ≈ 2000 + 40·n (coffee 2000, arcade 2040,
  clothing 2080, library 2120, rec 2160, apt 2200). Rosters only ever
  contain same-zone players; the apartment zone always rosters empty
  (solo instance). Crossing zones requires a `warp:true` ping while
  standing at a registered DOOR_PAIRS point; any other cross-zone move
  is refused and the position held.
- Commerce/activity endpoints (all POST, session-authed):
  `/api/world3d/buy` (café menu), `/api/world3d/cos` (buy/wear/hue),
  `/api/world3d/shard` (proximity-validated pickup, +5¢ once),
  `/api/world3d/trivia` (get/answer; 3 paid correct/day, +10¢),
  `/api/world3d/apt` (rug/poster decor, range-validated).
- One presence entry per account (keyed by lowercase name). A second
  tab takes over via `sid`: a stale sid cannot move the live entry.
  Entries prune after 7s without a ping.
- Server movement validation mirrors the 2D handler: per-step clamp
  `52*dtS + 6` units plus a 6s sustained-speed window (cap 38 u/s).
  The server never accepts currency/inventory from the client.
- Coordinates: 3D plaza = 2D fountain district at 1 unit = 10px,
  `x3=(x2-2400)/10`, `z3=(y2-1500)/10`. Bounds ±195 / ±118.

## Client engine (client3d.js)
- Loop order (single loop, fixed sequence): read input → desired
  velocity → integrate (accel/decel) → gravity/jump → bounds +
  colliders → avatar + remote interpolation/animation → ambient
  animation → camera (damped yaw/pitch/follow, boom collision) →
  ping timer → render.
- Camera: input targets (yaw/pitch) → exponential damping → follow
  point (extra Y damping so jumps don't lurch) → desired boom position
  → segment tests vs `camSpheres`/`camBoxes` shorten the boom → final
  position eased in/out at different rates. The camera NEVER rotates
  without input (the v1 auto-follow hack is deleted).
- Movement basis (do not regress): camera forward = (sin yaw, cos yaw),
  right = (−cos yaw, sin yaw); world velocity =
  (−nx·cos − nz·sin, nx·sin − nz·cos) for input (nx, nz). The inverted
  v1 form made W walk toward the camera and swapped A/D.
- Colliders: `colliders` circles + `boxColliders` AABBs (player);
  instanced trees/rocks/lamps register circles at placement time.
- Avatars: shared geometries/materials; per-player body material by
  saved hue; name-label sprites for remotes; procedural animation
  (idle breath, walk/run swing by real speed, air tuck, land squash).
- Settings persist in localStorage `w3settings` (sensitivity, camera
  distance + height, graphics tier, shadows, ambient sound, volume).
  Graphics tiers change pixelRatio + shadow map size + light toggles.
- Cleanup: `pagehide` sends the leave beacon and disposes the scene,
  materials, textures, renderer; listeners are removed; pointer lock
  is exited. WebGL context loss shows the ERROR state with retry.

Art direction (palette, districts, construction rules): `world3d/ART_DIRECTION.md` — v542 added buildTown() to client3d.js (gazebo well, sakura, streets, north storefront row, houses, park) on top of the v540 plaza; interiors land per-building from v543.

## v547–v551: first person + cozy program
- FP engine (v547): `updateCameraFP()` in client3d.js — eye 1.95 (sit 1.32), own fpPitch state, SET.view 'fp'|'tp' (V key / settings), SET.fov 60–90, SET.bob, view-model hands (`buildHands`/`updateHands`, sleeve color follows hue). TP boom fully preserved in `updateCamera()`. Server contract unchanged.
- Cozy direction (v548): ART_DIRECTION.md v2 — golden-hour sun (the DirectionalLight slot is still `scene.userData.moon` for applyGfx), gradient sky dome, warm haze, cream walls via windowsTexture's dark emissive pass. 2D world untouched.
- Dressing (v549): `buildDressing()` (leafy trees, garden beds, bus stop, mailboxes, bench SEATS, park sign), `BIRDS` + `petals` ticked by `tickDressing(now)` — clock-driven, client-only. SEATS is a module-scope registry (hoisted in v549; seatTaken reads it there).
- Sound (v550): `AMB` per-zone pad voicing via `setAmbience()` (filter center + pad gain on the ensureAudio graph; `acFilter`/`acSfx` exposed), footsteps from the bob cycle in `tickAudio()`, `sfxDoor()` on fadeThrough, SET.sfx + #w3sfx slider. `cozyInteriors()` adds emissive-only dressing per interior.
- NPC schedules (v551): strollers follow `STROLL_WP` (waypoints with dwell + face targets) via `strollTimeline()`/`tickStrollers`; interior NPCS carry `zone` + optional `routine {a, b, dwell, off, faceA, faceB}` walked by `tickNPCRoutines(now)`; the animate loop skips NPC bone math when the player is in another zone.
