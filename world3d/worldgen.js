/* worldgen.js — discrete procedural generation for the endless
 * world: the world seed and per-chunk deterministic streams.
 * Pure and stateless like math3d.js: same seed + same chunk coords
 * -> same content on every client, forever. Continuous fields
 * (terrain height, biomes, material weights) live in math3d.js;
 * this module owns everything discrete — chunk content rng and
 * placement rolls (vegetation Stage 4, settlements Stage 6).
 * No Math.random anywhere: Math.imul integer mixing only, so the
 * streams are identical on every JS engine. */
import { groundH, terrainWeights, biomeFields, WATER_Y, setPathProvider, setPadProvider } from './math3d.js';

const TAU = Math.PI * 2;
const sstepW = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export const WORLD_SEED = 20261123; // never changes once shipped

/* salt namespaces: each generation system draws from its own
 * stream so adding a system never reshuffles another's content. */
export const SALT = { VEG: 1, SETTLE: 2, LANDMARK: 3, PATH: 4, SHRUB: 11, ROCK: 12, GRASS: 13 };

/* deterministic 2-int hash (the nhash mixing family from
 * math3d.js, folded with the world seed). returns uint32. */
export function hash2i(a, b) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(WORLD_SEED, 974711);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/* the seed for one chunk's stream in one salt namespace. */
export function chunkSeed(cx, cz, salt) {
  let h = hash2i(cx, cz);
  h ^= Math.imul((salt | 0) + 1, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/* a mulberry32 stream seeded from (cx, cz, salt): the same chunk
 * always produces the same sequence of draws in [0, 1). */
export function chunkRng(cx, cz, salt) {
  let a = chunkSeed(cx, cz, salt) | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- terrain streaming plan (Stage 3) ----
 * Pure chunk-set arithmetic for the client's terrain manager:
 * which chunks should exist around a position, which to build
 * (nearest first), which to evict. Radii are centre-to-player
 * distances. The apron — the boot-built town grid, cx -5..4,
 * cz -4..3 — is pinned forever and never evicted. */
export const STREAM_R = 330; // build chunks centred within this of the player
export const EVICT_R = 385;  // evict beyond this (the gap is the hysteresis band)
export const CHUNK = 55;     // mirrors TERR_CHUNK in math3d.js

export function chunkKey(cx, cz) { return cx + ',' + cz; }
export function isApronChunk(cx, cz) { return cx >= -5 && cx < 5 && cz >= -4 && cz < 4; }
export function chunkCenterD(cx, cz, px, pz) {
  return Math.hypot(cx * CHUNK + CHUNK / 2 - px, cz * CHUNK + CHUNK / 2 - pz);
}

/* every chunk whose centre is within r of (px, pz), nearest first */
export function wantedChunks(px, pz, r) {
  const out = [];
  const minCx = Math.floor((px - r) / CHUNK), maxCx = Math.floor((px + r) / CHUNK);
  const minCz = Math.floor((pz - r) / CHUNK), maxCz = Math.floor((pz + r) / CHUNK);
  for (let cx = minCx; cx <= maxCx; cx++) for (let cz = minCz; cz <= maxCz; cz++) {
    const d = chunkCenterD(cx, cz, px, pz);
    if (d <= r) out.push({ cx, cz, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

/* diff the wanted set against what exists. have: a Set of 'cx,cz'
 * keys. build: wanted but missing, nearest first. evict: present,
 * not wanted, not apron, and centred beyond R + 55 (the eviction
 * hysteresis margin; at the default R = STREAM_R that is exactly
 * EVICT_R). R is the Stage 10 quality-tier stream radius — it
 * changes how far a client builds, never what a chunk contains. */
export function planChunks(have, px, pz, R = STREAM_R) {
  const want = wantedChunks(px, pz, R);
  const wantKeys = new Set(want.map(w => chunkKey(w.cx, w.cz)));
  const build = want.filter(w => !have.has(chunkKey(w.cx, w.cz)));
  const evict = [];
  for (const key of have) {
    if (wantKeys.has(key)) continue;
    const i = key.indexOf(',');
    const cx = +key.slice(0, i), cz = +key.slice(i + 1);
    if (isApronChunk(cx, cz)) continue;
    if (chunkCenterD(cx, cz, px, pz) > R + (EVICT_R - STREAM_R)) evict.push(key);
  }
  return { build, evict };
}

/* ---- per-chunk vegetation (Stage 4) ----
 * Placement is a pure function of WORLD-ALIGNED cells, not of the
 * chunk: each cell (13.75u trees / 9.17u shrubs / 11u rocks /
 * 4.58u grass) rolls its own hash stream, so a chunk's content is
 * identical no matter which chunks generated before it, and
 * neighbouring chunks can never disagree about a border cell.
 * One candidate per cell, jittered inside a margin, gives a hard
 * minimum spacing (trees >= 5.5u) with no cross-chunk ledger.
 * Gates mirror buildEcoZones exactly: slope via the same 1.3u
 * central difference (reject |grad| > 0.55), material weights
 * (grass+forest > 0.5, sand < 0.2, rock < 0.35), nothing in water.
 * The town apron never calls this — its dressing stays the boot
 * builders' work, byte-identical. */
export const VEG_TREES = {
  broad: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'],
  pine: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5'],
  twisted: ['TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3'],
  dead: ['DeadTree_3'],
  sakura: ['SakuraTree'],
};
function slopeOf(x, z) {
  const e = 1.3;
  const gx = (groundH(x + e, z) - groundH(x - e, z)) / (2 * e);
  const gz = (groundH(x, z + e) - groundH(x, z - e)) / (2 * e);
  return { g: Math.hypot(gx, gz), ny: 1 / Math.sqrt(1 + gx * gx + gz * gz) };
}
function vegSample(x, z) {
  const h = groundH(x, z);
  const s = slopeOf(x, z);
  return { h, g: s.g, w: terrainWeights(x, z, s.ny, h), bf: biomeFields(x, z) };
}
function groundGate(s, maxSlope) {
  return s.g <= maxSlope && s.h > WATER_Y + 0.25 && s.w[0] + s.w[1] > 0.5 && s.w[4] < 0.2 && s.w[3] < 0.35;
}
function pickTree(s, rng) {
  const r = rng();
  if (s.bf.moist > 0.55 && r < 0.03) return VEG_TREES.sakura[0];
  if (s.h > 9 || s.bf.moist < 0.38) return VEG_TREES.pine[(rng() * VEG_TREES.pine.length) | 0];
  if (s.bf.moist < 0.45 && r < 0.30) {
    if (r < 0.06) return VEG_TREES.dead[0];
    return VEG_TREES.twisted[(rng() * VEG_TREES.twisted.length) | 0];
  }
  return VEG_TREES.broad[(rng() * VEG_TREES.broad.length) | 0];
}
/* descriptors for one terrain chunk: { trees, shrubs, rocks,
 * grass }, each a list of { n, x, z, s, ry } (n = asset name).
 * empty for apron chunks and for the reserved interior band. */
export function genChunkVeg(cx, cz) {
  const out = { trees: [], shrubs: [], rocks: [], grass: [] };
  if (isApronChunk(cx, cz)) return out;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const ccx = x0 + CHUNK / 2, ccz = z0 + CHUNK / 2;
  if (ccx > 1975 && ccx < 2225 && Math.abs(ccz) < 40) return out; // interior band stays bare
  // trees: 4x4 cells of 13.75u
  const TC = 13.75;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const gx = cx * 4 + i, gz = cz * 4 + j;
    const rng = chunkRng(gx, gz, SALT.VEG);
    const x = gx * TC + 2.75 + rng() * (TC - 5.5), z = gz * TC + 2.75 + rng() * (TC - 5.5);
    if (pathDist(x, z) < 3.4) continue; // paths stay clear (Stage 5)
    if (settleDist(x, z) < 26) continue; // hamlets stay clear (Stage 6)
    const s = vegSample(x, z);
    if (!groundGate(s, 0.55)) continue;
    const fieldGate = sstepW(0.55, 0.75, s.bf.forest);
    let p = sstepW(0.22, 0.55, s.w[1] + fieldGate * 0.38) * 0.92;
    p = Math.max(p, (s.w[0] > 0.5 ? 0.045 : 0)); // lone meadow trees
    p *= 1 - sstepW(13, 19, s.h); // treeline
    if (rng() >= p) continue;
    out.trees.push({ n: pickTree(s, rng), x, z, s: 0.8 + rng() * 0.55, ry: rng() * TAU });
  }
  // shrubs: 6x6 cells of ~9.17u
  const SC = CHUNK / 6;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const gx = cx * 6 + i, gz = cz * 6 + j;
    const rng = chunkRng(gx, gz, SALT.SHRUB);
    const x = gx * SC + 1.6 + rng() * (SC - 3.2), z = gz * SC + 1.6 + rng() * (SC - 3.2);
    if (pathDist(x, z) < 3.4) continue;
    if (settleDist(x, z) < 26) continue;
    const s = vegSample(x, z);
    if (!groundGate(s, 0.7)) continue;
    if (rng() >= 0.16 + s.w[1] * 0.25) continue;
    const n = s.w[1] > 0.45 ? 'Fern_1' : (s.bf.moist > 0.5 && rng() < 0.45 ? 'Bush_Common_Flowers' : 'Bush_Common');
    out.shrubs.push({ n, x, z, s: 0.8 + rng() * 0.6, ry: rng() * TAU });
  }
  // rocks: 5x5 cells of 11u — density follows rock weight + slope
  const RC = CHUNK / 5;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const gx = cx * 5 + i, gz = cz * 5 + j;
    const rng = chunkRng(gx, gz, SALT.ROCK);
    const x = gx * RC + 2 + rng() * (RC - 4), z = gz * RC + 2 + rng() * (RC - 4);
    if (pathDist(x, z) < 3.4) continue;
    if (settleDist(x, z) < 26) continue;
    const s = vegSample(x, z);
    if (s.h <= WATER_Y + 0.2 || s.g > 0.95) continue;
    const p = 0.05 + s.w[3] * 0.5 + sstepW(0.3, 0.55, s.g) * 0.25 + (s.h > 14 ? 0.15 : 0);
    if (rng() >= p) continue;
    out.rocks.push({ n: 'Rock_Medium_' + (1 + ((rng() * 3) | 0)), x, z, s: 0.7 + rng() * 0.9, ry: rng() * TAU });
  }
  // grass tufts: 12x12 cells of ~4.58u
  const GC = CHUNK / 12;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const gx = cx * 12 + i, gz = cz * 12 + j;
    const rng = chunkRng(gx, gz, SALT.GRASS);
    const x = gx * GC + 0.8 + rng() * (GC - 1.6), z = gz * GC + 0.8 + rng() * (GC - 1.6);
    if (pathDist(x, z) < 1.8) continue; // the worn tread itself stays bare
    if (settleDist(x, z) < 22) continue; // the village green stays mown
    const s = vegSample(x, z);
    if (s.g > 0.5 || s.h <= WATER_Y + 0.15 || s.w[0] + s.w[1] <= 0.55) continue;
    if (rng() >= (s.w[0] + s.w[1]) * 0.55) continue;
    out.grass.push({ n: s.w[1] < 0.2 ? 'Grass_Wispy_Short' : 'Grass_Common_Short', x, z, s: 0.6 + rng() * 0.5, ry: rng() * TAU });
  }
  return out;
}

/* ---- dirt path network (Stage 5) ----
 * A loose trail system as pure data: four trailheads just outside
 * the town's weights-guard zone (Stage 8 joins them to the gates),
 * then seeded waypoint rings at ~340 / ~560 / ~820u. each waypoint
 * is found by a deterministic golden-angle ground search (slope
 * <= 0.35, dry, below the treeline), so the network is identical
 * on every client. edges link each waypoint to the nearest node
 * of the previous ring, plus same-ring neighbours under 300u.
 * consumers: terrainWeights (dirt, via the provider slot in
 * math3d.js), genChunkVeg (clearing, above), Stage 6 settlements
 * (waypoints are the sites), Stage 7 bridges (water crossings),
 * Stage 9 map. */
let NET = null;
function buildNetwork() {
  const nodes = [{ x: 229, z: 0, ring: -1 }, { x: -229, z: 0, ring: -1 }, { x: 0, z: -152, ring: -1 }, { x: 0, z: 152, ring: -1 }];
  const edges = [];
  let prev = [0, 1, 2, 3];
  const RINGS = [[340, 5], [560, 7], [820, 9]];
  RINGS.forEach(([radius, count], ri) => {
    const rng = chunkRng(ri, 77, SALT.PATH);
    const phase = rng() * TAU;
    const mine = [];
    for (let i = 0; i < count; i++) {
      const ang = phase + (i / count) * TAU + (rng() - 0.5) * 0.35;
      const rad = radius + (rng() - 0.5) * 60;
      const cxp = Math.cos(ang) * rad, czp = Math.sin(ang) * rad;
      let spot = null;
      for (let k = 0; k < 14 && !spot; k++) {
        const a = k * 2.39996, rr = k * 5;
        const x = cxp + Math.cos(a) * rr, z = czp + Math.sin(a) * rr;
        const s = vegSample(x, z);
        if (s.g <= 0.35 && s.h > WATER_Y + 0.3 && s.h < 14) spot = { x, z };
      }
      if (!spot) continue;
      const idx = nodes.length;
      nodes.push({ x: spot.x, z: spot.z, ring: ri });
      mine.push(idx);
      let best = -1, bd = Infinity;
      for (const pi of prev) { const d = Math.hypot(nodes[pi].x - spot.x, nodes[pi].z - spot.z); if (d < bd) { bd = d; best = pi; } }
      if (best >= 0) edges.push([best, idx]);
    }
    for (const a of mine) for (const b of mine) {
      if (b <= a) continue;
      if (Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z) < 300) edges.push([a, b]);
    }
    if (mine.length) prev = mine;
  });
  // Stage 8: gate nodes ON the bounds lines, appended last so
  // every existing node index (settlements key off them) is
  // untouched. each gate edges to its trailhead, joining the
  // town avenues to the wild path network.
  const GATES = [[195, 0, 0], [-195, 0, 1], [0, -118, 2], [0, 118, 3]];
  for (const [gx, gz, th] of GATES) {
    const idx = nodes.length;
    nodes.push({ x: gx, z: gz, ring: -2 });
    edges.push([idx, th]);
  }
  const segs = edges.map(([a, b]) => ({ ax: nodes[a].x, az: nodes[a].z, bx: nodes[b].x, bz: nodes[b].z }));
  return { nodes, edges, segs };
}
/* the four town gates paired with their trailheads:
 * [{ x, z, tx, tz }] — gate on the bounds line, t = trailhead. */
export function gateNodes() {
  const { nodes, edges } = pathNetwork();
  const out = [];
  nodes.forEach((n, i) => {
    if (n.ring !== -2) return;
    const e = edges.find(([a, b]) => a === i || b === i);
    const o = nodes[e[0] === i ? e[1] : e[0]];
    out.push({ x: n.x, z: n.z, tx: o.x, tz: o.z });
  });
  return out;
}
let NET_BUILDING = false;
export function pathNetwork() {
  if (NET) return NET;
  // re-entrancy guard: building the network samples terrain
  // weights (vegSample), which consult pathDist, which needs the
  // network. during the build, paths simply do not exist yet —
  // waypoint placement must not depend on the paths it creates.
  if (NET_BUILDING) return { nodes: [], edges: [], segs: [] };
  NET_BUILDING = true;
  NET = buildNetwork();
  NET_BUILDING = false;
  return NET;
}
/* distance from (x, z) to the nearest path segment, in units */
export function pathDist(x, z) {
  const { segs } = pathNetwork();
  let best = Infinity;
  for (const s of segs) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L2 = dx * dx + dz * dz || 1;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
    if (d < best) best = d;
  }
  return best;
}
setPathProvider(pathDist);

/* ---- settlements (Stage 6) ----
 * every ring-1 waypoint hosts a hamlet: 2-3 cottages + a shed
 * around a green with a well, a fence arc, crates by the shed;
 * the third hamlet also gets a watchtower. structures are
 * Blender-kitbashed Medieval Village (CC0) buildings — see
 * assets-src/hamlet.py. each hamlet flattens a terrain pad
 * (r 24, feathered) registered into groundH via the pad slot.
 * layout is pure data from the node index — identical everywhere. */
let SETTLES = null, SETTLE_BUILDING = false;
export function settlements() {
  if (SETTLES) return SETTLES;
  if (SETTLE_BUILDING) return [];
  const net = pathNetwork();
  if (!net.nodes.length) return []; // network mid-build — never cache this
  SETTLE_BUILDING = true;
  const out = [];
  let si = 0;
  net.nodes.forEach((n, i) => {
    if (n.ring !== 0) return;
    const rng = chunkRng(i, 5, SALT.SETTLE);
    const items = [];
    const a0 = rng() * TAU;
    const face = (x, z) => Math.atan2(-(n.x - x), -(n.z - z)); // fronts (glTF -Z) toward the green
    const cottages = 2 + Math.floor(rng() * 2);
    const kinds = [];
    for (let k = 0; k < cottages; k++) kinds.push('cottage');
    kinds.push('shed');
    kinds.forEach((kind, k) => {
      const ang = a0 + (k / kinds.length) * TAU + (rng() - 0.5) * 0.4;
      const dist = 11 + rng() * 5;
      const x = n.x + Math.cos(ang) * dist, z = n.z + Math.sin(ang) * dist;
      items.push({ n: kind, x, z, ry: face(x, z) });
      if (kind === 'shed') {
        const crates = 1 + Math.floor(rng() * 3);
        for (let c = 0; c < crates; c++) items.push({ n: 'crate', x: x + (rng() - 0.5) * 5, z: z + (rng() - 0.5) * 5, ry: rng() * TAU });
      }
    });
    if (si === 2) { // one watchtower in the world, third hamlet
      const ang = a0 + 2.2, dist = 16;
      const x = n.x + Math.cos(ang) * dist, z = n.z + Math.sin(ang) * dist;
      items.push({ n: 'watchtower', x, z, ry: face(x, z) });
    }
    const wx = n.x + Math.cos(a0 + 0.7) * 3.5, wz = n.z + Math.sin(a0 + 0.7) * 3.5;
    items.push({ n: 'well', x: wx, z: wz, ry: rng() * TAU });
    // fence arc at r 17.5 with a gap where the path arrives
    let gapAng = a0;
    const inc = net.edges.find(e => e[1] === i || e[0] === i);
    if (inc) { const o = net.nodes[inc[0] === i ? inc[1] : inc[0]]; gapAng = Math.atan2(o.z - n.z, o.x - n.x); }
    for (let a = 0; a < TAU; a += 2.05 / 17.5) {
      let da = Math.abs(((a - gapAng) % TAU + TAU * 1.5) % TAU - Math.PI);
      if (da < 0.6) continue; // the gate gap where the path arrives
      if (rng() < 0.12) continue; // a few natural gaps
      items.push({ n: 'fence', x: n.x + Math.cos(a) * 17.5, z: n.z + Math.sin(a) * 17.5, ry: -a - Math.PI / 2 });
    }
    out.push({ i, x: n.x, z: n.z, r: 24, h: groundH(n.x, n.z), items });
    si++;
  });
  SETTLE_BUILDING = false;
  SETTLES = out;
  return SETTLES;
}
function settlePadH(x, z, h) {
  for (const s of settlements()) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.r + 10) { const w = 1 - sstepW(s.r - 6, s.r + 10, d); h = h * (1 - w) + s.h * w; }
  }
  return h;
}
setPadProvider(settlePadH);
/* min distance from (x, z) to any settlement centre */
export function settleDist(x, z) {
  let best = Infinity;
  for (const s of settlements()) best = Math.min(best, Math.hypot(x - s.x, z - s.z));
  return best;
}

/* ============ Stage 7: wild water + landmarks ============
 * chunkWater: a chunk carries a water quad iff its sampled
 * minimum terrain height dips below WATER_Y. the 5x5 sample at
 * 13.75u steps matches the client mesh grid, so the answer the
 * picker gives is the answer the renderer needs. apron chunks
 * never report water (the town pond is its own disc) and neither
 * does the reserved interior band.
 * landmarks(): four named sites from a fixed coarse scan of the
 * continuous fields — same scan order and strict comparisons on
 * every client, so the sites are identical everywhere with no
 * rng involved at all. */
export function chunkMinH(cx, cz) {
  let min = Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    const h = groundH(cx * CHUNK + i * (CHUNK / 4), cz * CHUNK + j * (CHUNK / 4));
    if (h < min) min = h;
  }
  return min;
}
export function chunkWater(cx, cz) {
  if (isApronChunk(cx, cz)) return { has: false, min: Infinity };
  const ccx = cx * CHUNK + CHUNK / 2, ccz = cz * CHUNK + CHUNK / 2;
  if (ccx > 1975 && ccx < 2225 && Math.abs(ccz) < 40) return { has: false, min: Infinity };
  const min = chunkMinH(cx, cz);
  return { has: min < WATER_Y, min };
}
const dOutOf = (x, z) => Math.hypot(Math.max(Math.abs(x) - 195, 0), Math.max(Math.abs(z) - 118, 0));
let LANDS = null;
export function landmarks() {
  if (LANDS) return LANDS;
  if (!pathNetwork().nodes.length) return []; // mid-build — never cache
  let lake = null, over = null, ruin = null, falls = null;
  for (let gx = -938; gx <= 938; gx += 14) for (let gz = -938; gz <= 938; gz += 14) {
    const x = gx, z = gz;
    if (dOutOf(x, z) < 80) continue;
    if (x > 1975 && x < 2225 && Math.abs(z) < 40) continue;
    if (settleDist(x, z) < 55) continue;
    const h = groundH(x, z);
    const bf = biomeFields(x, z);
    // lake: the deepest sampled basin point with a real lake field
    if (bf.lake > 0.6 && h < WATER_Y - 0.6 && (!lake || h < lake.h)) lake = { kind: 'lake', x, z, h };
    // overlook + ruin need the path distance; falls needs slope
    if (h >= 16 || bf.forest >= 0.72 || (h > WATER_Y + 2.5 && h < WATER_Y + 12)) {
      const pd = pathDist(x, z);
      if (h >= 16 && pd >= 10 && slopeOf(x, z).g <= 0.55 && (!over || h > over.h)) over = { kind: 'overlook', x, z, h };
      if (bf.forest >= 0.72 && h > WATER_Y + 0.5 && pd >= 25 && slopeOf(x, z).g <= 0.4) {
        const score = bf.forest + Math.min(pd, 60) / 300;
        if (!ruin || score > ruin.score) ruin = { kind: 'ruin', x, z, h, score };
      }
      if (h > WATER_Y + 2.5 && h < WATER_Y + 12 && slopeOf(x, z).g >= 0.75) {
        // greedy downhill walk: does this face actually reach water?
        let cx2 = x, cz2 = z, reached = false, steps = 0;
        while (steps < 6) {
          let bx = cx2, bz = cz2, bh = groundH(cx2, cz2);
          for (const d of [[6, 0], [-6, 0], [0, 6], [0, -6], [4.2, 4.2], [4.2, -4.2], [-4.2, 4.2], [-4.2, -4.2]]) {
            const nh = groundH(cx2 + d[0], cz2 + d[1]);
            if (nh < bh) { bh = nh; bx = cx2 + d[0]; bz = cz2 + d[1]; }
          }
          if (bx === cx2 && bz === cz2) break;
          cx2 = bx; cz2 = bz; steps++;
          if (bh < WATER_Y + 0.4) { reached = true; break; }
        }
        if (reached) {
          const score = (h - groundH(cx2, cz2)) - steps * 0.5;
          if (!falls || score > falls.score) falls = { kind: 'falls', x, z, h, bx: cx2, bz: cz2, bh: groundH(cx2, cz2), score };
        }
      }
    }
  }
  // the lake's island: highest above-water point within 26u of it
  if (lake) {
    let isl = null;
    for (let gx = lake.x - 26; gx <= lake.x + 26; gx += 4) for (let gz = lake.z - 26; gz <= lake.z + 26; gz += 4) {
      if (Math.hypot(gx - lake.x, gz - lake.z) > 26) continue;
      const h = groundH(gx, gz);
      if (h > WATER_Y + 0.3 && (!isl || h > isl.h)) isl = { x: gx, z: gz, h };
    }
    lake.island = isl;
  }
  if (ruin) delete ruin.score;
  if (falls) delete falls.score;
  LANDS = [lake, over, ruin, falls].filter(Boolean);
  return LANDS;
}
export function landmark(kind) { return landmarks().find((l) => l.kind === kind) || null; }
