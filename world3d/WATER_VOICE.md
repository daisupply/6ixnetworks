# Water Reconstruction + Voice Reliability — 2026-11-24

Built 2026-11-24 (after v599). NOT pushed at build time — push is Deion's tap.

## WATER

### Root causes found
- Wild water was ONE 55×55 plane per wet chunk (chunkWater = 5×5 min-sample gate): square shorelines, water drawn over dry land inside mixed chunks, huge transparent overdraw.
- The material was a flat emissive Standard material — no depth read, no shoreline blend, glowed uniformly.
- The wild falls ribbon was an untextured translucent strip (read as static); the park falls scrolled a texture but met the pond with a hard edge.

### Geometry — world3d/watermesh.js (new, pure, unit-tested)
- Marching-squares surface clipped to groundH's actual WATER_Y contour on a world-aligned 2.75u grid (21×21 nodes per chunk). Neighbouring chunks sample identical border heights → identical shared-edge vertices (asserted) → no gaps/overlaps, identical on every client (groundH is pure).
- No vertex sits over terrain above WATER_Y (edge crossings interpolate to exactly WATER_Y); every triangle's winding verified upward exhaustively in tests.
- Per-vertex RGBA baked from depth below WATER_Y (world floor is −2.6, so the ramp is calibrated to the real max depth ~1.45): pale/translucent at the shoreline → deep blue/opaque in the basin.
- One geometry per chunk, built on chunk build, disposed on eviction (shared material never disposed), regeneration bit-identical (asserted).
- Gate fix in client ensureWaterQuad: chunkWater's coarse 5×5 gate can miss a narrow dip; the geometry builder is now the authority (apron/interior exclusion preserved).

### Material
- Shared MeshStandardMaterial, vertexColors (RGBA), roughness 0.12, low emissive; onBeforeCompile injects a world-position varying + a gentle time-based shimmer term (uWTime uniform ticked from the render loop). depthWrite off (chunk-vs-chunk sorting), still depth-tested against terrain.
- Town pond: geometry/collider untouched (test-asserted); emissive reduced 0.6 → 0.3 so it stops glowing.
- Park falls: existing scrolling texture kept; added a pulsing foam disc where it meets the pond. Wild falls: ribbon now carries UVs + a scrolling streak texture (offset ticked), plus a foam disc at its base pool. Placement/colliders unchanged everywhere.

### Performance
- Water draw calls: same count as before (one per wet chunk) but fragment coverage is now only the wet fraction of each chunk (shoreline chunks were previously 100% overdraw). No per-frame geometry work; the shimmer is one uniform.

### Tests (real, run 2026-11-24)
- tests/water.test.mjs: 12/12 — lake geometry exists, all vertices at WATER_Y+0.02, none over dry land, all triangles up, alpha spans shallow→deep, determinism bit-identical, neighbour border vertices identical, dry chunk → null, shoreline chunks partial (not whole-plane), pond + wiring assertions.
- Browser (SwiftShader): boot clean on the new build — tMesh 102, waterC 0→2 streaming, ~2.53M tris, ZERO shader-compile errors (the only console noise is a pre-existing GL_INVALID_VALUE texture-upload warning unrelated to water). Spawn screenshot read: world renders normally.
- NOT verified: the pond/falls/lake LOOK on a real GPU (sandbox input starvation made the 118u pond trek impractical — the probe moved ~0.1u/s and steering drags didn't register at 320×200). Shoreline appearance, shimmer strength, and foam are Deion's-screen verdicts.

## VOICE

### Audit (what was actually wrong)
The pipeline was better than assumed — lexicographic initiator, mailbox signaling, fail backoff, discT grace all existed. The real defects:
1. **No establishment timeout** — a peer whose offer/answer was lost sat in 'new' FOREVER (no state ever fired to retry it). This was the big one.
2. **vcSend3 swallowed failures silently** — one dropped POST lost the offer/ICE permanently, invisibly.
3. **ICE handling was ad-hoc** — queue flushed on remote-description, but no dedupe (mailbox re-drains re-delivered candidates) and no close-guard for stale callbacks.
4. **The status pill lied by omission** — it only knew on/off/muted/listen; peer connection states never reached it.
5. **devicechange never rebuilt the local analyser** — after a mic swap, the speaking indicator analysed the dead stream forever; it also force-reset mute.
6. **vcRetry3/vcFails3 entries were never pruned** for players who left entirely.
7. **Stale async chains** — an offer chain could send an answer for a peer that had been closed/replaced mid-flight; ontrack had no gain fallback if the gain node was missing.

### Fixes — world3d/voiceutil.js (new, pure, unit-tested) + client wiring
- IceBuffer class: candidates buffer until the remote description lands, flush IN ORDER, dedupe by candidate string, inert after close, one throwing candidate can't kill the queue. Client vcFlushIce/ICE handling rewired onto it; vcClosePeer closes the buffer.
- Establishment watchdog in vcTick3: a peer not 'connected'/'closed' within ESTABLISH_TIMEOUT_MS (12s) is failed + closed so the existing backoff rebuilds it.
- vcSend3: one retry after 600ms, then a real console.warn (no more silent catch). Offer/answer handlers warn on failure and the answer send is guarded by peer identity (vcPeers[from] === p).
- nextRetryDelay extracted (5s/fail, 30s cap) and shared.
- voiceUiState() derives the pill from REAL state (pending/hasStream/muted/live peer connectionStates/anyFail) with priority: requesting > off > listen > muted > connected=live > disconnected=reconnecting > connecting > failed. vcTick3 refreshes the pill when the derived state changes; new .st-failed pill style (red blink) in world3d.css.
- On 'connected', the winning ICE candidate type (host/srflx/relay) is recorded once via getStats → __w3state vc.via — this is how TURN-carrying gets proven on a real network instead of assumed from config.
- devicechange: gen-guarded (late getUserMedia after voice-off is discarded), replaces the mic track on live peers via replaceTrack (only refusers get rebuilt), rebuilds the local analyser on the new stream, preserves mute via vcApplyMute.
- vcTick3 prunes retry/fail maps for users absent from the roster with no live peer.
- ontrack: stale-peer guard, AudioContext resume, gain-node fallback creation.

### Tests (real, run 2026-11-24)
- tests/voice.test.mjs: 19/19 — MOCKED candidate application (explicitly not real WebRTC): IceBuffer buffering/order/dedupe/close-inertness/throw-isolation, backoff values, establishment-timeout bounds, the full voiceUiState matrix (11 cases incl. listen-outranks-connected, failed-not-live).
- Real browser (SwiftShader, fake media devices):
  - Two-session attempt: both clients acquired fake mics (talk detection fired on both local analysers), one side created its peer and showed ui 'connecting'; the other side's rAF-starved ping loop never refreshed its roster (a documented sandbox two-client starvation, also visible as the heartbeat 'reconnecting' pill) — a full two-party connection could NOT be completed in-sandbox and is NOT claimed.
  - Browser + API-player isolation test (×2 runs): the browser client created the peer, delivered a real offer + 4 ICE candidates through the production server mailbox, ui tracked 'connecting', and when no answer came the watchdog fired ('[vc] peer … never established (new) — retrying with backoff'), the peer closed, ui flipped to 'failed', and a second create→offer→watchdog cycle was observed. Zero unexpected [vc] warnings.
- NOT verified (Deion's screen / real network): an actual two-human call, audio intelligibility, TURN relay selection (vc.via now exposes it), devicechange with real hardware, proximity falloff feel.

## Files changed
- world3d/watermesh.js (new), world3d/voiceutil.js (new)
- world3d/client3d.js (water wiring + material + falls/foam; all voice fixes)
- world3d/world3d.js (serve routes for both new modules)
- world3d/world3d.css (.st-failed pill)
- world3d/tests/water.test.mjs (new), world3d/tests/voice.test.mjs (new)
- Full suites after the build: water 12/12, voice 19/19, math 106/106, worldgen 86/86, roof 11/11, horizon 18/18, server 74/74 (one trivia flake on a dirty-store run — answer-order, pre-existing; clean run 74/74). All generation pins bit-identical.
