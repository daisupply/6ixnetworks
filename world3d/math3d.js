/* math3d.js — pure math for the 3D world, shared by client3d.js (browser)
 * and world3d/tests/math.test.mjs (node). No DOM, no three.js, no state:
 * every function is a pure mapping so the exact code the game runs is the
 * exact code the tests verify.
 *
 * COORDINATE CONTRACT (do not regress — this was the v539/v540 bug):
 *   camera forward on the ground plane = (sin yaw, cos yaw)
 *   camera right                       = (-cos yaw, sin yaw)
 *   input: ix = strafe (A -1 / D +1), iz = forward axis (W -1 / S +1)
 *   moveVec(yaw, ix, iz) returns the world-space direction for that input.
 *   At yaw = PI (spawn): W -> -z (toward the fountain), D -> +x.
 */
const TAU = Math.PI * 2;

export function angWrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
export function angLerp(a, b, k) { return a + angWrap(b - a) * k; }

/* frame-rate independent damping factor: same convergence for any dt split */
export function dampK(rate, dt) { return 1 - Math.exp(-rate * dt); }

/* normalize a raw input vector: returns the UNIT direction plus the
 * magnitude clamped to 1, so diagonals are never faster than straights
 * and analog stick magnitude is preserved below the clamp. */
export function normInput(ix, iz) {
  const m = Math.hypot(ix, iz);
  if (m < 1e-9) return { x: 0, y: 0, mag: 0, raw: 0 };
  return { x: ix / m, y: iz / m, mag: Math.min(1, m), raw: m };
}

/* camera-relative movement direction for input (ix, iz) at camera yaw.
 * returns a vector with the same magnitude as the input vector. */
export function moveVec(yaw, ix, iz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: -ix * c - iz * s, z: ix * s - iz * c };
}

/* segment (a->b) vs sphere s {x,y,z,r}: earliest t in [0,1], or -1 */
export function segSphereT(ax, ay, az, bx, by, bz, s) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const fx = ax - s.x, fy = ay - s.y, fz = az - s.z;
  const A = dx * dx + dy * dy + dz * dz; if (A < 1e-6) return -1;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - s.r * s.r;
  let disc = B * B - 4 * A * C; if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t = (-B - disc) / (2 * A);
  return (t >= 0 && t <= 1) ? t : -1;
}

/* segment (a->b) vs box b {minX,maxX,minZ,maxZ,h} (y from 0..h): entry t or -1 */
export function segBoxT(ax, ay, az, bx, by, bz, b) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let t0 = 0, t1 = 1;
  const axes = [[ax, dx, b.minX, b.maxX], [ay, dy, 0, b.h], [az, dz, b.minZ, b.maxZ]];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) return -1; }
    else {
      let ta = (mn - o) / d, tb = (mx - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

// ---- terrain heightfield (stage 08, overhauled in the terrain pass) ----
// The developed town sits on a flat plateau (h = 0 for |x| <= 126,
// |z| <= 98, smooth mask beyond). Outside it the land is a layered
// procedural heightfield: the original hand-placed hill masses, a
// domain-warped multi-octave rolling layer, a fine surface layer, a
// forest-floor micro layer in the west, and — beyond the playable
// bounds only — ridged-noise foothills and mountain ranges that give
// the horizon real silhouettes. EVERY layer is multiplied by the
// plateau mask, so the town, plaza, roads, pond and every building
// footprint stay at exactly h = 0, bit for bit.
// Pure + deterministic: integer-hash gradient noise (Math.imul only,
// no Math.random, no state), so the ground mesh, the player, remotes,
// NPCs, wildlife and the tests all sample identical heights from the
// same world coordinates on every client, forever.
function sstep(a, b, v) { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
// deterministic 2d gradient noise: integer lattice hash -> gradient,
// smoothstep-interpolated. identical output for identical input on
// every JS engine (imul + doubles only).
function nhash(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const NGRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  let v = 0;
  for (let c = 0; c < 4; c++) {
    const cx = ix + (c & 1), cz = iz + (c >> 1);
    const g = NGRAD[(nhash(cx, cz) * 8) | 0];
    const dx = fx - (c & 1), dz = fz - (c >> 1);
    const d = g[0] * dx + g[1] * dz;
    const wx = (c & 1) ? ux : 1 - ux, wz = (c >> 1) ? uz : 1 - uz;
    v += d * wx * wz;
  }
  return v * 1.4142; // ~[-1, 1]
}
// fractal brownian motion over noise2: oct octaves, lacunarity 2,
// gain 0.5. range roughly [-1, 1].
export function fbm2(x, z, oct) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise2(x * f, z * f); norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}
// ridged fbm for mountain crests: sharp 1-|n| folds, squared.
// range [0, 1].
export function ridge2(x, z, oct) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(noise2(x * f, z * f)); sum += a * n * n; norm += a; a *= 0.5; f *= 2.11; }
  return sum / norm;
}

// The developed town sits on a flat plateau (h = 0 for |x| <= 126,
// |z| <= 98, smooth mask beyond); gentle hills rise outside it: the
// west forest floor, the east overlook, and thin north/south rims.
// Pure + deterministic: the ground mesh, the player, remotes, NPCs and
// wildlife all sample this one function, so every client agrees.
const HILLS = [
  [-168, -42, 3.4, 40], [-172, 48, 2.8, 36], [-158, 92, 2.2, 30],
  [174, 8, 7.6, 44], [162, -62, 3.2, 38], [166, 78, 2.6, 34],
  [-40, -116, 2.4, 34], [70, -114, 2.0, 30],
  [36, 114, 2.2, 32], [-70, 112, 1.9, 30],
];
function groundHBase(x, z) {
  const m = Math.max(sstep(126, 150, Math.abs(x)), sstep(98, 116, Math.abs(z)));
  if (m <= 0) return 0;
  let h = 0;
  for (let i = 0; i < HILLS.length; i++) {
    const dx = x - HILLS[i][0], dz = z - HILLS[i][1];
    h += HILLS[i][2] * Math.exp(-(dx * dx + dz * dz) / (HILLS[i][3] * HILLS[i][3]));
  }
  h += 0.45 * Math.sin(x * 0.045) * Math.cos(z * 0.05);
  h = Math.max(0, h) * m;
  // v2 (stage 02 rebuild): gentle forest-floor undulation, west band only
  if (x < -135) h += 0.35 * Math.sin(x * 0.11 + 1.7) * Math.cos(z * 0.09) * m;
  // terrain pass: layered procedural detail, all scaled by the same
  // plateau mask so the town stays exactly flat. a domain-warped fbm
  // rolling layer gives the outskirts believable hills and valleys
  // (the warp keeps it from reading as evenly-spaced noise blobs), a
  // fine layer breaks up the surface, and the west gets an extra
  // forest-floor layer so the woods floor feels distinct from the
  // softer meadow profile in the east.
  const wx = x + 9 * fbm2(x * 0.011 + 13.7, z * 0.011 + 91.2, 3);
  const wz = z + 9 * fbm2(x * 0.011 + 47.3, z * 0.011 + 5.9, 3);
  let det = 2.3 * fbm2(wx * 0.016, wz * 0.016, 4);
  det += 0.30 * fbm2(x * 0.085, z * 0.085, 2);
  if (x < -130) det += 0.55 * fbm2(x * 0.045 + 7.7, z * 0.045, 3) * sstep(-130, -168, x);
  // refinement pass: the detail layers follow the large landforms
  // instead of operating independently — slopes and high ground
  // carry more surface variation, valley floors stay calm.
  det *= 0.72 + 0.5 * Math.min(1, Math.abs(h) / 5);
  h += det * m;
  // realism pass: the legacy Gaussian hills were perfect smooth
  // domes — at viewing distance their texture mip-averages away and
  // only the bare dome silhouette remains (the grey-dome artifact).
  // a ridged detail term gated to elevated ground breaks the domes
  // into irregular hilltops; low ground, valleys and town untouched.
  h += 0.85 * (ridge2(x * 0.021 + 7.3, z * 0.021 + 2.9, 3) - 0.55) * sstep(1.2, 3.0, h) * m;
  // refinement pass: drainage valleys — two meandering lowland bands
  // with defined paths, so low ground reads as carved valleys with
  // coherent shape instead of random noise dips. the pads still
  // flatten their landmarks on top of this (the overlook terrace
  // now sits above its valley, which is the natural arrangement).
  // east: the low ground sits BETWEEN the hill masses — two saddle
  // valleys carved into the gaps north and south of the overlook
  // massif, draining the meadow bowl on its west flank.
  const dGN = Math.hypot(x - 170, z - 42), dGS = Math.hypot(x - 168, z + 34);
  h -= 1.1 * Math.exp(-(dGN * dGN) / 225) * m + 1.1 * Math.exp(-(dGS * dGS) / 225) * m;
  const vW = -160 + 20 * Math.sin(z * 0.019 + 2.6) + 8 * fbm2(z * 0.012 + 9.9, 3.3, 2);
  const dVW = x - vW;
  h -= 1.3 * Math.exp(-(dVW * dVW) / 196) * m * (1 - sstep(96, 116, Math.abs(z)));
  h = Math.max(-2.6, h); // valley floors are the deepest playable ground
  // beyond the playable bounds the land keeps rising: rolling
  // foothills first, then ridged mountain ranges (visual only —
  // players are clamped inside the bounds, but the same function
  // shapes them, so the apron mesh and the horizon agree).
  const ex = Math.max(Math.abs(x) - 195, 0), ez = Math.max(Math.abs(z) - 118, 0);
  const dOut = Math.hypot(ex, ez);
  if (dOut > 0) {
    const rg = ridge2(x * 0.0085 + 31.4, z * 0.0085 + 3.1, 4);
    // sector gain: a continuous angular function, so some stretches
    // of the range tower and others dip into passes — the rim is a
    // mountain system, not a uniform wall.
    const ang = Math.atan2(z, x);
    const sector = 0.78 + 0.55 * (fbm2(Math.cos(ang) * 1.35 + 9.1, Math.sin(ang) * 1.35 + 4.4, 2) * 0.5 + 0.5);
    h += 3.2 * fbm2(x * 0.02, z * 0.02, 3) * sstep(0, 45, dOut);
    h += sstep(4, 85, dOut) * (7 + 30 * rg * rg) * sector;
    // realism pass: the rim swells were as smooth as the old domes
    // (the hilltop detail above is plateau-masked and never reaches
    // them) — a ridged term that grows into the range breaks their
    // silhouettes and gives their faces shading variation.
    h += 1.15 * (ridge2(x * 0.013 + 3.9, z * 0.013 + 8.4, 3) - 0.5) * sstep(10, 40, dOut);
  }
  // worldgen handover (terrain v2): the rim term above saturates at
  // dOut 85 — left alone it rings the world in full-strength
  // mountains forever. past dOut 60 the heightfield crossfades to
  // wildH, the procedural countryside, reaching it fully at dOut
  // 200. both surfaces are continuous, so the blend is seamless by
  // construction; inside dOut 60 nothing changes at all (the apron
  // regression pins in worldgen.test.mjs cover dOut <= 30).
  const dOutB = Math.hypot(Math.max(Math.abs(x) - 195, 0), Math.max(Math.abs(z) - 118, 0));
  if (dOutB > 60) {
    const w = sstep(60, 200, dOutB);
    h = h * (1 - w) + wildH(x, z) * w;
  }
  return h;
}
// v2: designed flat pads — the forest clearing and the overlook terrace
// blend to their center height so landmarks sit on level ground.
const PAD_CLEAR_H = groundHBase(-179, -38);
const PAD_OVER_H = groundHBase(174, 8);
function flatPad(h, x, z, cx, cz, r, ch) {
  const d = Math.hypot(x - cx, z - cz);
  if (d >= r + 7) return h;
  const w = 1 - sstep(r, r + 7, d);
  return h * (1 - w) + ch * w;
}
export function groundH(x, z) {
  let h = groundHBase(x, z);
  if (h > 0) {
    h = flatPad(h, x, z, -179, -38, 11, PAD_CLEAR_H);
    h = flatPad(h, x, z, 174, 8, 9, PAD_OVER_H);
  }
  // settlement pads (worldgen Stage 6) apply even where the base
  // height is <= 0 — a hamlet can sit in a shallow dip.
  if (padProvider) h = padProvider(x, z, h);
  return h;
}

// ---- worldgen: biome fields + countryside (terrain v2) ----
// Continuous world-scale fields, pure functions of (x, z) over the
// same integer-hash noise as the authored terrain, so every client
// derives identical biomes from coordinates alone. Discrete
// generation (seeds, per-chunk rng) lives in worldgen.js.
export const WATER_Y = -1.15;
export function biomeFields(x, z) {
  return {
    moist: fbm2(x * 0.004 + 171.3, z * 0.004 + 58.9, 3) * 0.5 + 0.5,
    forest: fbm2(x * 0.0035 + 233.7, z * 0.0035 + 96.2, 3) * 0.5 + 0.5,
    high: fbm2(x * 0.0028 + 311.1, z * 0.0028 + 144.4, 3) * 0.5 + 0.5,
    lake: fbm2(x * 0.005 + 421.9, z * 0.005 + 267.3, 3) * 0.5 + 0.5,
  };
}
// the procedural countryside the terrain v2 handover fades to:
// rolling plains everywhere, ridged highlands where the high field
// peaks, and lake basins where the lake field peaks on low ground —
// basin floors are pulled toward -2.3 so they sit below WATER_Y and
// hold water (water meshes arrive in Stage 7; the heightfield
// carries the basins from here on). floored at -2.6 like the
// authored valleys, so no ground anywhere is deeper than that.
function wildH(x, z) {
  const f = biomeFields(x, z);
  let h = 5.2 * fbm2(x * 0.008 + 511.7, z * 0.008 + 388.1, 4);
  h += 1.1 * fbm2(x * 0.03 + 77.7, z * 0.03 + 55.5, 2);
  const hm = sstep(0.52, 0.68, f.high);
  if (hm > 0) { const r = ridge2(x * 0.006 + 611.3, z * 0.006 + 477.9, 4); h += hm * (5 + 24 * r * r); }
  const lm = sstep(0.70, 0.85, f.lake) * (1 - hm) * (1 - sstep(3, 7, h));
  if (lm > 0) h += (-2.3 - h) * lm * 0.85;
  return Math.max(-2.6, h);
}
// analytic terrain normal from the same central differences the
// chunk builder's halo grid computes (eps = the 2.5u mesh step), so
// mesh normals and this function agree by construction.
export function terrainNormal(x, z) {
  const e = 2.5;
  const gx = (groundH(x + e, z) - groundH(x - e, z)) / (2 * e);
  const gz = (groundH(x, z + e) - groundH(x, z - e)) / (2 * e);
  const il = 1 / Math.hypot(gx, 1, gz);
  return [-gx * il, il, -gz * il];
}
// per-vertex material weights from the terrain's own data: biome
// (west forest / east meadow), slope (rock on steeps, dirt on
// shoulders), moisture noise (dirt patches, wild bands only), height
// (exposed rock up high) and the pond shoreline (sand). returns
// [grass, forest, dirt, rock, sand], always summing to 1.
// terrain projection spec (realism pass 2): the ONE source for the
// terrain shader's texture projections. the GLSL in client3d.js
// carries the same numbers as literals, and the test suite reads
// the shader source and fails if they ever drift apart.
// layers: [cos, sin of the breakup rotation, breakup mix,
// normal strength] for grass, forest, dirt, rock, sand.
export const TERR_DETAIL_SCALE = 1 / 7;
export const TERR_BREAK_SCALE = 1 / 19;
export const TERR_LAYERS = [
  [0.906, 0.423, 0.30, 0.55],
  [0.799, 0.602, 0.42, 0.70],
  [0.326, 0.946, 0.40, 0.60],
  [0.966, 0.259, 0.38, 0.95],
  [0.602, 0.799, 0.30, 0.35],
];
export function terrainProjA(x, z) { return [x * TERR_DETAIL_SCALE, z * TERR_DETAIL_SCALE]; }
export function terrainProjB(x, z, layer) {
  const r = TERR_LAYERS[layer], u = x * TERR_BREAK_SCALE, v = z * TERR_BREAK_SCALE;
  return [u * r[0] - v * r[1], u * r[1] + v * r[0]];
}
export function rot2(v, c, s) { return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; }
// the per-layer tangent-space normal blend, mirrored in GLSL as
// terrNrm: the breakup sample's xy is rotated by -theta (the
// inverse of its UV rotation) so both samples live in the detail
// projection's tangent frame before they are mixed.
export function blendTerrainNormal(na, nb, c, s, m) {
  const b = rot2([nb[0], nb[1]], c, -s);
  return [na[0] + (b[0] - na[0]) * m, na[1] + (b[1] - na[1]) * m, na[2] + (nb[2] - na[2]) * m];
}
// rock side projection (steep faces): weight from the surface
// normal's y, and the side UV from the dominant horizontal axis —
// the same formulas the shader uses.
export function terrainSideW(ny) { return 1 - sstep(0.60, 0.88, Math.abs(ny)); }
export function terrainSideUV(x, y, z, nx, nz) {
  return Math.abs(nz) >= Math.abs(nx)
    ? [x * TERR_DETAIL_SCALE, y * TERR_DETAIL_SCALE]
    : [z * TERR_DETAIL_SCALE, y * TERR_DETAIL_SCALE];
}

// remap a tangent-space normal sampled on the SIDE projection
// into the top-projection tangent frame (east, north, up) that
// the terrain shader blends in. XY projection (face points
// mostly +-Z): the sample's axes are (worldX, worldY, worldZ)
// -> (a, c*sign(nz), b). ZY projection: axes are (worldZ,
// worldY, worldX) -> (c*sign(nx), a, b). The sign keeps the
// out-of-face component pointing away from the surface on both
// facings. The GLSL in client3d.js mirrors this exactly and the
// test suite checks both.
export function terrainSideNormal(nx, nz, sx, sy, sz) {
  if (Math.abs(nz) >= Math.abs(nx)) return [sx, sz * (nz < 0 ? -1 : 1), sy];
  return [sz * (nx < 0 ? -1 : 1), sx, sy];
}

// ---- chunk grid generation (shared by client + tests) ----
// The terrain chunk builder's pure grid logic lives here so the
// Node test suite exercises the SAME code the browser renders —
// no test-only reimplementation. Vertex layout: row-major
// (j = z rows, i = x cols), positions from groundH, normals
// from a one-ring halo of groundH samples via central
// differences (so border normals match the neighbour chunk's),
// weights from terrainWeights, moisture/patch vertex tint, and
// detail UVs at TERR_DETAIL_SCALE.
export const TERR_CHUNK = 55, TERR_SEG = 22;
export function terrainChunkFlat(cx, cz) {
  // chunks whose whole rect sits inside the guaranteed-flat
  // plateau build at 2 segments; every sample is provably h=0
  return Math.max(Math.abs(cx * TERR_CHUNK), Math.abs((cx + 1) * TERR_CHUNK)) <= 124
    && Math.max(Math.abs(cz * TERR_CHUNK), Math.abs((cz + 1) * TERR_CHUNK)) <= 96;
}
export function terrainChunkGrid(cx, cz) {
  const flat = terrainChunkFlat(cx, cz);
  const seg = flat ? 2 : TERR_SEG;
  const step = TERR_CHUNK / seg, N = seg + 1, H = seg + 3;
  const gx = cx * TERR_CHUNK, gz = cz * TERR_CHUNK;
  const hs = new Float32Array(H * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < H; i++) {
    hs[j * H + i] = groundH(gx + (i - 1) * step, gz + (j - 1) * step);
  }
  const nv = N * N;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const w1 = new Float32Array(nv * 4), wS = new Float32Array(nv), uv = new Float32Array(nv * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const vi = j * N + i, hi = (j + 1) * H + (i + 1);
    const x = gx + i * step, z = gz + j * step, h = hs[hi];
    const dhx = (hs[hi + 1] - hs[hi - 1]) / (2 * step), dhz = (hs[hi + H] - hs[hi - H]) / (2 * step);
    let nx = -dhx, nz = -dhz; const il = 1 / Math.hypot(nx, 1, nz);
    nx *= il; nz *= il; let ny = il;
    if (flat) { nx = 0; nz = 0; ny = 1; }
    pos[vi * 3] = x; pos[vi * 3 + 1] = h; pos[vi * 3 + 2] = z;
    nor[vi * 3] = nx; nor[vi * 3 + 1] = ny; nor[vi * 3 + 2] = nz;
    const w = terrainWeights(x, z, ny, h);
    w1[vi * 4] = w[0]; w1[vi * 4 + 1] = w[1]; w1[vi * 4 + 2] = w[2]; w1[vi * 4 + 3] = w[3]; wS[vi] = w[4];
    const moist = fbm2(x * 0.013 + 77.3, z * 0.013, 2) * 0.5 + 0.5;
    const patch = 0.92 + 0.16 * (fbm2(x * 0.008 + 3.3, z * 0.008 + 8.8, 2) * 0.5 + 0.5);
    const tint = (0.95 + 0.08 * moist) * (h < 1 ? 0.985 : 1) * patch;
    const gw = w[0];
    col[vi * 3] = tint * (1 - gw + gw * 0.80);
    col[vi * 3 + 1] = tint * (1 - gw + gw * 1.07);
    col[vi * 3 + 2] = tint * (1 - gw + gw * 0.68);
    uv[vi * 2] = x / 7; uv[vi * 2 + 1] = z / 7;
  }
  return { flat, seg, pos, nor, col, w1, wS, uv };
}
export function terrainChunkIndex(seg) {
  const N = seg + 1;
  const idx = new Uint32Array(seg * seg * 6);
  let k = 0;
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  return idx;
}

// worldgen Stage 5: the dirt-path provider slot. the path network
// lives in worldgen.js (which imports this module — a direct
// import back would be a cycle), so worldgen registers its
// pathDist here at load; terrainWeights consults it when present.
// no provider (e.g. math.test.mjs imports math3d alone) = no
// paths in weights, exactly the pre-Stage-5 behaviour.
let pathProvider = null;
export function setPathProvider(fn) { pathProvider = fn; }

// worldgen Stage 6: the settlement-pad provider slot, same
// pattern — worldgen registers a function (x, z, h) -> h that
// blends ground height toward each hamlet's pad height.
let padProvider = null;
export function setPadProvider(fn) { padProvider = fn; }

export function terrainWeights(x, z, ny, h) {
  const s = 1 - ny;
  const wild = Math.max(sstep(126, 150, Math.abs(x)), sstep(98, 116, Math.abs(z)));
  let rock = Math.max(sstep(0.13, 0.34, s), sstep(9, 20, h) * sstep(0.04, 0.12, s));
  rock = Math.max(rock, sstep(15, 27, h) * 0.62 * (0.45 + 0.55 * (fbm2(x * 0.03 + 9.7, z * 0.03 + 1.2, 2) * 0.5 + 0.5)));
  let forest = sstep(-118, -158, x) * (0.5 + 0.5 * (fbm2(x * 0.02 + 3.1, z * 0.02, 2) * 0.5 + 0.5));
  let dirt = sstep(0.30, 0.62, fbm2(x * 0.028 + 51.7, z * 0.028 + 9.4, 3)) * 0.72 * wild
    + sstep(0.045, 0.10, s) * (1 - sstep(0.10, 0.30, s)) * 0.35;
  const dPond = Math.hypot(x - 118, z - 12);
  let sand = (1 - sstep(12.5, 17, dPond)) * (1 - sstep(0.1, 0.45, h));
  // worldgen: field-driven forest and lakeshore sand beyond the
  // apron, faded in by distance past the bounds — the guard keeps
  // every apron weight bit-identical to the authored terrain
  // (regression pins in worldgen.test.mjs cover dOut <= 30).
  const dOutW = Math.hypot(Math.max(Math.abs(x) - 195, 0), Math.max(Math.abs(z) - 118, 0));
  if (dOutW > 30) {
    const fade = sstep(30, 90, dOutW);
    const bf = biomeFields(x, z);
    forest = Math.max(forest, sstep(0.55, 0.72, bf.forest) * (0.45 + 0.55 * bf.moist) * fade);
    sand = Math.max(sand, (1 - sstep(0.45, 1.1, Math.abs(h - WATER_Y))) * fade);
    // dirt paths (worldgen Stage 5): worn dirt along the path
    // network, registered by worldgen.js. inside this same
    // dOut > 30 guard, so apron weights stay pinned; Stage 8
    // joins the paths to the town gates deliberately.
    if (pathProvider) {
      const pd = pathProvider(x, z);
      if (pd < 7) dirt = Math.max(dirt, (1 - sstep(2.2, 7, pd)) * 0.85 * fade);
    }
  }
  let grass = Math.max(0, 1 - forest - dirt - rock - sand);
  const sum = grass + forest + dirt + rock + sand || 1;
  return [grass / sum, forest / sum, dirt / sum, rock / sum, sand / sum];
}
