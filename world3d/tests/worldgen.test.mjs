// worldgen.test.mjs — terrain v2 + biome fields + chunk seeds.
// tests the EXACT functions client3d.js uses from ../math3d.js and
// ../worldgen.js. run: node world3d/tests/worldgen.test.mjs
import { groundH, terrainNormal, terrainWeights, terrainChunkGrid, biomeFields, WATER_Y } from '../math3d.js';
import { WORLD_SEED, SALT, hash2i, chunkSeed, chunkRng, STREAM_R, EVICT_R, chunkKey, isApronChunk, chunkCenterD, wantedChunks, planChunks, genChunkVeg, VEG_TREES, pathNetwork, pathDist, settlements, settleDist } from '../worldgen.js';

let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('PASS', label); } else { fail++; console.log('FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); } };
const rectD = (x, z) => Math.hypot(Math.max(Math.abs(x) - 195, 0), Math.max(Math.abs(z) - 118, 0));
const hashStr = s => { let h1 = 5381, h2 = 52711; for (let i = 0; i < s.length; i++) { h1 = (h1 * 33) ^ s.charCodeAt(i); h2 = (h2 * 31) ^ s.charCodeAt(i); } return (h1 >>> 0).toString(16) + ':' + (h2 >>> 0).toString(16) + ':' + s.length; };

/* ---- apron regression pins (Stage 1, pre-overhaul code) ----
 * heights + weights on a 10u grid over every point within
 * rect-distance 30 of the playable bounds (1,342 points). the
 * terrain v2 handover is guarded to dOut > 60 (heights) and
 * dOut > 30 (weights), so these must stay bit-identical forever;
 * a deliberate apron change re-pins here AND in WORLDGEN.md. */
{
  let hs = '', ws = '', n = 0;
  for (let x = -230; x <= 230; x += 10) for (let z = -153; z <= 153; z += 10) {
    if (rectD(x, z) > 30) continue;
    const h = groundH(x, z), ny = terrainNormal(x, z)[1];
    hs += h.toFixed(6) + ','; ws += terrainWeights(x, z, ny, h).map(v => v.toFixed(5)).join('/') + ','; n++;
  }
  ok(n === 1342, 'pin grid covers 1342 points', n);
  ok(hashStr(hs) === '7cfee98b:c541dc8f:12155', 'PIN_H: apron heights bit-identical', hashStr(hs));
  ok(hashStr(ws) === '56710384:a43e1252:53680', 'PIN_W: apron weights bit-identical', hashStr(ws));
}
/* landmark heights, exact */
{
  const lm = [[0, 18, '0.000000'], [118, 12, '0.000000'], [0, 0, '0.000000'],
    [-179, -38, '2.508944'], [174, 8, '7.285529'], [195, 0, '6.292374'], [0, 118, '0.625207']];
  for (const [x, z, want] of lm) ok(groundH(x, z).toFixed(6) === want, 'landmark h(' + x + ',' + z + ') = ' + want, groundH(x, z).toFixed(6));
}

/* ---- determinism: same coords -> same everything, every call ---- */
{
  let same = true;
  for (let i = 0; i < 200; i++) {
    const x = i * 37.7 - 3000, z = (i % 91) * 41.3 - 1800;
    if (groundH(x, z) !== groundH(x, z)) same = false;
    const a = biomeFields(x, z), b = biomeFields(x, z);
    if (a.moist !== b.moist || a.forest !== b.forest || a.high !== b.high || a.lake !== b.lake) same = false;
  }
  ok(same, 'groundH + biomeFields are pure/deterministic at wild coords');
  ok(WORLD_SEED === 20261123, 'WORLD_SEED is the shipped constant');
  ok(hash2i(3, -7) === hash2i(3, -7) && hash2i(3, -7) !== hash2i(3, -8), 'hash2i stable and input-sensitive');
  ok(chunkSeed(5, 5, SALT.VEG) !== chunkSeed(5, 5, SALT.SETTLE), 'salt namespaces separate chunk streams');
  const r1 = chunkRng(7, -3, SALT.VEG), r2 = chunkRng(7, -3, SALT.VEG);
  let rsame = true, inRange = true;
  for (let i = 0; i < 64; i++) { const v = r1(); if (v !== r2()) rsame = false; if (!(v >= 0 && v < 1)) inRange = false; }
  ok(rsame && inRange, 'chunkRng deterministic and in [0,1)');
  const firsts = new Set();
  for (let cx = -20; cx < 20; cx++) for (let cz = -20; cz < 20; cz++) firsts.add(chunkRng(cx, cz, SALT.VEG)());
  ok(firsts.size >= 1595, 'chunk streams distinct across 1600 chunks', firsts.size);
}

/* ---- countryside character (annulus dOut 250..900, 14u grid) ----
 * the pre-overhaul rim was ~100% mountains above h 8 out here.
 * terrain v2 must read as countryside: mostly low rolling ground,
 * some lake basins below WATER_Y, rare high peaks, nothing deeper
 * than the -2.6 floor. */
{
  let n = 0, low = 0, lake = 0, hi = 0, mn = Infinity, mx = -Infinity;
  for (let x = -1100; x <= 1100; x += 14) for (let z = -1100; z <= 1100; z += 14) {
    const d = rectD(x, z); if (d < 250 || d > 900) continue;
    const h = groundH(x, z); n++;
    if (h < 8) low++; if (h < WATER_Y) lake++; if (h > 20) hi++;
    if (h < mn) mn = h; if (h > mx) mx = h;
  }
  ok(low / n > 0.7 && low / n < 0.97, 'annulus mostly low ground (h<8)', (low / n).toFixed(3));
  ok(lake / n > 0.04 && lake / n < 0.20, 'lake basins exist but are not an ocean', (lake / n).toFixed(3));
  ok(hi / n > 0.002 && hi / n < 0.08, 'high peaks are rare destinations', (hi / n).toFixed(3));
  ok(mn >= -2.6 - 1e-9 && mx <= 40, 'wild heights inside [-2.6, 40]', [mn.toFixed(2), mx.toFixed(2)]);
  ok(WATER_Y === -1.15, 'WATER_Y is the shipped constant');
}

/* ---- continuity: no handover cliff, no chunk seams ----
 * bounds are measured-with-margin (see WORLDGEN.md): the authored
 * rim's own creases reached 6.34/2.5u pre-overhaul; terrain v2's
 * worst full-transect step is 3.68 and deep-wild 2.94. a real seam
 * or blend bug would jump far past these. */
{
  let worst = 0;
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    let prev = groundH(0, 0);
    for (let d = 2.5; d <= 1600; d += 2.5) { const h = groundH(dx * d, dz * d); worst = Math.max(worst, Math.abs(h - prev)); prev = h; }
  }
  ok(worst <= 4.0, 'full transects: max step <= 4.0 per 2.5u (no handover cliff)', worst.toFixed(3));
  let dworst = 0;
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071]]) {
    let prev = null;
    for (let d = 2.5; d <= 1600; d += 2.5) {
      const x = dx * d, z = dz * d, h = groundH(x, z);
      if (prev !== null && rectD(x, z) > 250) dworst = Math.max(dworst, Math.abs(h - prev));
      prev = h;
    }
  }
  ok(dworst <= 3.2, 'deep wild: max step <= 3.2 per 2.5u', dworst.toFixed(3));
  // shared-edge agreement between adjacent wild chunks
  const A = terrainChunkGrid(9, 4), B = terrainChunkGrid(10, 4), N = A.seg + 1;
  let edge = true;
  for (let j = 0; j < N; j++) {
    const a = A.pos[(j * N + A.seg) * 3 + 1], b = B.pos[(j * N) * 3 + 1];
    if (a !== b) edge = false;
  }
  ok(edge, 'adjacent wild chunks share edge heights exactly');
  let finite = true;
  for (const g of [A, terrainChunkGrid(-12, 7), terrainChunkGrid(20, -15)]) {
    for (const arr of [g.pos, g.nor, g.col, g.w1, g.wS, g.uv]) for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) finite = false;
  }
  ok(finite, 'wild chunk grids are finite everywhere (no NaN)');
}

/* ---- biomes occur in the wild, not just the authored west ---- */
{
  let fE = 0, fT = 0;
  for (let x = 400; x <= 1000; x += 20) for (let z = -500; z <= 500; z += 20) {
    const h = groundH(x, z), ny = terrainNormal(x, z)[1], w = terrainWeights(x, z, ny, h);
    fT++; if (w[1] > 0.5 && ny > 0.9) fE++;
  }
  ok(fE / fT > 0.02, 'field forest occurs on gentle eastern ground', (fE / fT).toFixed(3));
  // weights still sum to 1 in the wild
  let sumOk = true;
  for (let i = 0; i < 300; i++) {
    const x = 300 + i * 3.1, z = -700 + (i % 67) * 19.7, h = groundH(x, z);
    const w = terrainWeights(x, z, terrainNormal(x, z)[1], h);
    if (Math.abs(w[0] + w[1] + w[2] + w[3] + w[4] - 1) > 1e-6) sumOk = false;
  }
  ok(sumOk, 'wild weights sum to 1');
}

/* ---- streaming plan (Stage 3): wanted set, hysteresis, apron ---- */
{
  ok(STREAM_R === 330 && EVICT_R === 385, 'stream radii are the shipped constants');
  ok(isApronChunk(-5, -4) && isApronChunk(4, 3) && !isApronChunk(5, 0) && !isApronChunk(-6, 0) && !isApronChunk(0, 4), 'apron membership matches the boot grid');
  const want = wantedChunks(0, 18, STREAM_R);
  let sorted = true, within = true;
  for (let i = 0; i < want.length; i++) {
    if (want[i].d > STREAM_R) within = false;
    if (i && want[i].d < want[i - 1].d) sorted = false;
  }
  ok(sorted && within, 'wantedChunks nearest-first, all centres within radius');
  ok(want.length > 95 && want.length < 135, 'wanted set at spawn is ~113 chunks', want.length);
  // coverage: every ground point within STREAM_R-40 of the player
  // lies inside some wanted chunk (no holes in the disc)
  const keys = new Set(want.map(w => chunkKey(w.cx, w.cz)));
  let holes = 0;
  for (let x = -290; x <= 290; x += 7) for (let z = -272; z <= 308; z += 7) {
    if (Math.hypot(x, z - 18) > STREAM_R - 40) continue;
    if (!keys.has(chunkKey(Math.floor(x / 55), Math.floor(z / 55)))) holes++;
  }
  ok(holes === 0, 'wanted disc has no coverage holes', holes);
  // plan from the boot state: builds are the non-apron wanted, no evictions
  const apron = new Set();
  for (let cx = -5; cx < 5; cx++) for (let cz = -4; cz < 4; cz++) apron.add(chunkKey(cx, cz));
  const p0 = planChunks(apron, 0, 18);
  ok(p0.evict.length === 0, 'plan at spawn evicts nothing');
  ok(p0.build.length === want.length - 80 && p0.build.every(w => !isApronChunk(w.cx, w.cz)), 'plan at spawn builds exactly the non-apron wanted', p0.build.length);
  // hysteresis: a present chunk centred in the (330, 385] band is
  // neither rebuilt nor evicted; beyond EVICT_R it is evicted
  const haveBand = new Set(apron); haveBand.add('6,0'); // centre ~357.6 from spawn
  const pB = planChunks(haveBand, 0, 18);
  ok(!pB.evict.includes('6,0') && !pB.build.some(w => chunkKey(w.cx, w.cz) === '6,0'), 'hysteresis band chunk is left alone');
  const haveFar = new Set(apron); haveFar.add('7,0'); // centre ~412.6 from spawn
  ok(planChunks(haveFar, 0, 18).evict.includes('7,0'), 'chunk beyond EVICT_R is evicted');
  // the apron is never evicted, even from 1500u away
  ok(planChunks(apron, 1500, 0).evict.length === 0, 'apron is never evicted at any distance');
  // after a long trek east, the plan wants the new neighbourhood
  const pT = planChunks(apron, 1500, 0);
  ok(pT.build.length > 90 && pT.build[0].d < 55, 'trek plan builds the new neighbourhood nearest-first', pT.build.length);
  ok(Math.abs(chunkCenterD(0, 0, 27.5, 27.5)) === 0, 'chunk centre math anchors at +27.5');
}

/* ---- per-chunk vegetation (Stage 4): determinism + gates ---- */
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(eq(genChunkVeg(9, 2), genChunkVeg(9, 2)), 'genChunkVeg deterministic per chunk');
  const s1 = [genChunkVeg(9, 2), genChunkVeg(10, 2), genChunkVeg(9, 3)];
  const s2 = [genChunkVeg(9, 3), genChunkVeg(10, 2), genChunkVeg(9, 2)];
  ok(eq(s1[0], s2[2]) && eq(s1[1], s2[1]) && eq(s1[2], s2[0]), 'chunk content independent of generation order');
  const empty = { trees: [], shrubs: [], rocks: [], grass: [] };
  ok(eq(genChunkVeg(0, 0), empty) && eq(genChunkVeg(-3, 2), empty), 'apron chunks generate no wild vegetation');
  ok(eq(genChunkVeg(37, 0), empty), 'interior-band chunk generates nothing');
  // content pin: any deliberate generator change re-pins here
  const batch = [[9, 2], [-14, 7], [20, -11], [-18, -16], [12, 12], [-7, -20]];
  let json = ''; const allTrees = [];
  for (const [cx, cz] of batch) { const v = genChunkVeg(cx, cz); json += JSON.stringify(v); allTrees.push(...v.trees); }
  ok(hashStr(json) === 'a3e66177:f7c9d9b1:59469', 'VEG_PIN: wild content bit-identical', hashStr(json));
  // every placed tree honours the eco gates + approved species
  const approved = new Set([...VEG_TREES.broad, ...VEG_TREES.pine, ...VEG_TREES.twisted, ...VEG_TREES.dead, ...VEG_TREES.sakura]);
  let bad = 0;
  for (const t of allTrees) {
    const e = 1.3, gx = (groundH(t.x + e, t.z) - groundH(t.x - e, t.z)) / (2 * e), gz = (groundH(t.x, t.z + e) - groundH(t.x, t.z - e)) / (2 * e);
    if (Math.hypot(gx, gz) > 0.55 + 1e-9 || groundH(t.x, t.z) <= WATER_Y + 0.25 || !approved.has(t.n)) bad++;
  }
  ok(bad === 0 && allTrees.length > 20, 'all batch trees pass slope/water gates, approved species only', bad);
  // spacing: pooled across the batch (incl. cross-chunk pairs) the
  // cell margins guarantee >= 5.5u between tree candidates
  let minPair = Infinity;
  for (let i = 0; i < allTrees.length; i++) for (let j = i + 1; j < allTrees.length; j++) {
    const d = Math.hypot(allTrees[i].x - allTrees[j].x, allTrees[i].z - allTrees[j].z);
    if (d < minPair) minPair = d;
  }
  ok(minPair >= 5.4, 'tree spacing >= 5.4u even across chunk borders', minPair.toFixed(2));
  // distribution over a wild ring: forests exist, barrens exist,
  // and the average density is countryside, not a wall of trees
  let chunks = 0, trees = 0, maxTrees = 0, bare = 0;
  for (let cx = -18; cx <= 18; cx++) for (let cz = -18; cz <= 18; cz++) {
    if (isApronChunk(cx, cz)) continue;
    const v = genChunkVeg(cx, cz); chunks++;
    trees += v.trees.length; if (v.trees.length > maxTrees) maxTrees = v.trees.length;
    if (v.trees.length === 0 && v.grass.length === 0) bare++;
  }
  ok(maxTrees >= 9, 'dense forest chunks exist (>=9 of 16 cells)', maxTrees);
  ok(bare > 0, 'bare chunks exist (lakes/highlands)', bare);
  const avg = trees / chunks;
  ok(avg > 2 && avg < 10, 'average tree density is countryside-like', avg.toFixed(2));
}

/* ---- dirt path network (Stage 5) ---- */
{
  const net = pathNetwork();
  ok(hashStr(JSON.stringify(net.nodes) + JSON.stringify(net.edges)) === '617666b9:3f6c7615:1442', 'NET_PIN: path network bit-identical', hashStr(JSON.stringify(net.nodes) + JSON.stringify(net.edges)));
  ok(net.nodes.length === 25 && net.segs.length === net.edges.length, 'network shape: 4 trailheads + 21 waypoints', [net.nodes.length, net.edges.length]);
  const deg = new Array(net.nodes.length).fill(0);
  for (const [a, b] of net.edges) { deg[a]++; deg[b]++; }
  ok(deg.every(d => d >= 1), 'every node is connected');
  let bad = 0;
  for (const n of net.nodes.slice(4)) {
    const e = 1.3, gx = (groundH(n.x + e, n.z) - groundH(n.x - e, n.z)) / (2 * e), gz = (groundH(n.x, n.z + e) - groundH(n.x, n.z - e)) / (2 * e);
    const h = groundH(n.x, n.z);
    if (Math.hypot(gx, gz) > 0.35 + 1e-9 || h <= WATER_Y + 0.3 || h >= 14) bad++;
  }
  ok(bad === 0, 'every waypoint sits on passable dry ground', bad);
  ok(pathDist(net.nodes[5].x, net.nodes[5].z) < 0.01, 'pathDist is 0 at a node');
  const mid = net.segs[4];
  ok(pathDist((mid.ax + mid.bx) / 2, (mid.az + mid.bz) / 2) < 0.01, 'pathDist is 0 at a segment midpoint');
  // dirt is worn in along the tread, absent away from it
  const mx = (mid.ax + mid.bx) / 2, mz = (mid.az + mid.bz) / 2;
  const wOn = terrainWeights(mx, mz, terrainNormal(mx, mz)[1], groundH(mx, mz));
  const wOff = terrainWeights(mx + 20, mz + 20, terrainNormal(mx + 20, mz + 20)[1], groundH(mx + 20, mz + 20));
  ok(wOn[2] > 0.6 && wOn[2] > wOff[2] + 0.3, 'dirt weight follows the path', [wOn[2].toFixed(3), wOff[2].toFixed(3)]);
  // vegetation keeps off the tread across a wide scan
  let viol = 0;
  for (let cx = -10; cx <= 10; cx++) for (let cz = -10; cz <= 10; cz++) {
    if (isApronChunk(cx, cz)) continue;
    const v = genChunkVeg(cx, cz);
    for (const layer of ['trees', 'shrubs', 'rocks']) for (const d of v[layer]) if (pathDist(d.x, d.z) < 3.2) viol++;
    for (const d of v.grass) if (pathDist(d.x, d.z) < 1.6) viol++;
  }
  ok(viol === 0, 'no vegetation on the path tread (361-chunk scan)', viol);
}

/* ---- settlements (Stage 6) ---- */
{
  const S = settlements();
  ok(S.length === 5, 'one hamlet per ring-1 waypoint', S.length);
  ok(hashStr(JSON.stringify(S)) === '67130650:f8ab330e:19440', 'SETTLE_PIN: layouts bit-identical', hashStr(JSON.stringify(S)));
  let contained = true, padsExact = true, towers = 0;
  for (const s of S) {
    if (Math.abs(groundH(s.x, s.z) - s.h) > 1e-6) padsExact = false;
    for (const it of s.items) {
      if (Math.hypot(it.x - s.x, it.z - s.z) > s.r) contained = false;
      if (it.n === 'watchtower') towers++;
    }
  }
  ok(padsExact, 'groundH equals the pad height at every hamlet centre');
  ok(contained, 'every structure sits inside its pad');
  ok(towers === 1, 'exactly one watchtower in the world', towers);
  ok(settleDist(S[0].x, S[0].z) === 0 && settleDist(0, 18) > 200, 'settleDist behaves (0 at a hamlet, far at spawn)');
  // vegetation keeps out of the greens: scan the chunks around hamlet 0
  const s0 = S[0];
  let viol = 0;
  const ccx = Math.floor(s0.x / 55), ccz = Math.floor(s0.z / 55);
  for (let cx = ccx - 1; cx <= ccx + 1; cx++) for (let cz = ccz - 1; cz <= ccz + 1; cz++) {
    const v = genChunkVeg(cx, cz);
    for (const layer of ['trees', 'shrubs', 'rocks']) for (const d of v[layer]) if (settleDist(d.x, d.z) < 25) viol++;
  }
  ok(viol === 0, 'no wild trees/shrubs/rocks inside a hamlet pad', viol);
}

console.log('WORLDGEN RESULT: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
