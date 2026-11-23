// math.test.mjs — pure movement/camera math for the 3D world.
// tests the EXACT functions client3d.js imports from ../math3d.js.
// run: node world3d/tests/math.test.mjs   (no server, no deps)
import { angWrap, angLerp, dampK, normInput, moveVec, segSphereT, segBoxT, groundH, noise2, fbm2, ridge2, terrainNormal, terrainWeights, TERR_DETAIL_SCALE, TERR_BREAK_SCALE, TERR_LAYERS, terrainProjA, terrainProjB, rot2, blendTerrainNormal, terrainSideW, terrainSideUV } from '../math3d.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('PASS', label); } else { fail++; console.log('FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/* ---- movement directions at spawn yaw (PI): W away, S toward, A/D opposed ---- */
{
  const W = moveVec(Math.PI, 0, -1), S = moveVec(Math.PI, 0, 1), A = moveVec(Math.PI, -1, 0), D = moveVec(Math.PI, 1, 0);
  ok(near(W.x, 0) && near(W.z, -1), 'yaw=PI: W moves -z (away from camera, toward fountain)', W);
  ok(near(S.x, 0) && near(S.z, 1), 'yaw=PI: S moves +z (toward the camera)', S);
  ok(near(A.x, -1) && near(A.z, 0), 'yaw=PI: A moves -x', A);
  ok(near(D.x, 1) && near(D.z, 0), 'yaw=PI: D moves +x (opposite of A)', D);
}
/* ---- directions at several yaws: W is always the camera forward ---- */
for (const yaw of [0, Math.PI / 2, -Math.PI / 2, 2.3, -0.7, 5.9]) {
  const W = moveVec(yaw, 0, -1);
  ok(near(W.x, Math.sin(yaw)) && near(W.z, Math.cos(yaw)), 'yaw=' + yaw.toFixed(2) + ': W == camera forward (sin, cos)', W);
  const D = moveVec(yaw, 1, 0);
  ok(near(D.x, -Math.cos(yaw)) && near(D.z, Math.sin(yaw)), 'yaw=' + yaw.toFixed(2) + ': D == camera right (-cos, sin)', D);
  // rotating the camera by +d must rotate the W direction by exactly +d
  const W2 = moveVec(yaw + 0.6, 0, -1);
  const dot = W.x * W2.x + W.z * W2.z;
  ok(near(dot, Math.cos(0.6), 1e-9), 'yaw=' + yaw.toFixed(2) + ': camera rotation rotates movement direction by the same angle');
}
/* ---- diagonal speed equals straight speed (after normInput) ---- */
for (const yaw of [0, 1.1, Math.PI, -2.0]) {
  const straight = normInput(0, -1); const sw = moveVec(yaw, straight.x, straight.y);
  const sMag = Math.hypot(sw.x, sw.z) * straight.mag;
  const diag = normInput(1, -1); const dw = moveVec(yaw, diag.x, diag.y);
  const dMag = Math.hypot(dw.x, dw.z) * diag.mag;
  ok(near(sMag, 1) && near(dMag, 1), 'yaw=' + yaw.toFixed(2) + ': diagonal speed == straight speed == 1', { sMag, dMag });
}
/* ---- analog magnitude preserved under the clamp, capped above it ---- */
{
  const half = normInput(0.3, -0.4); // magnitude 0.5
  ok(near(half.mag, 0.5) && near(Math.hypot(half.x, half.y), 1), 'normInput: 0.5 stick keeps mag 0.5 with unit direction', half);
  const over = normInput(3, 4); // magnitude 5
  ok(near(over.mag, 1) && near(over.x, 0.6) && near(over.y, 0.8), 'normInput: over-range input clamps to mag 1', over);
  const zero = normInput(0, 0);
  ok(zero.mag === 0 && zero.x === 0 && zero.y === 0, 'normInput: zero input is zero');
}
/* ---- damping is frame-rate independent ---- */
{
  const step = (rate, dts) => { let v = 0; for (const dt of dts) v += (1 - v) * dampK(rate, dt); return v; };
  const a = step(10, Array(60).fill(1 / 60));            // 1s at 60fps
  const b = step(10, Array(20).fill(1 / 20));            // 1s at 20fps
  const c = step(10, [0.4, 0.05, 0.25, 0.3]);            // 1s irregular
  ok(near(a, b, 1e-6) && near(a, c, 1e-6), 'dampK: same convergence at 60fps, 20fps and irregular dt', { a, b, c });
  ok(dampK(10, 0) === 0, 'dampK: dt=0 means no movement');
}
/* ---- angle wrap / lerp take the shortest path ---- */
{
  ok(near(angWrap(3 * Math.PI), Math.PI) || near(angWrap(3 * Math.PI), -Math.PI), 'angWrap: 3PI wraps to +-PI');
  ok(near(angWrap(-Math.PI - 0.5), Math.PI - 0.5), 'angWrap: just past -PI wraps to +PI side');
  const mid = angLerp(Math.PI - 0.1, -Math.PI + 0.1, 0.5); // shortest path crosses the seam
  ok(Math.abs(Math.abs(mid) - Math.PI) < 0.001, 'angLerp: lerps across the +-PI seam, not the long way', mid);
}
/* ---- camera boom collision segments ---- */
{
  const fount = { x: 0, y: 1.6, z: 0, r: 7.9 };
  const t = segSphereT(0, 1.6, -12, 0, 1.6, 12, fount);
  ok(t > 0.16 && t < 0.18, 'segSphereT: boom into the fountain sphere hits at t~0.171', t);
  ok(segSphereT(20, 1.6, -12, 20, 1.6, 12, fount) === -1, 'segSphereT: parallel miss returns -1');
  ok(segSphereT(0, 1.6, 12, 0, 1.6, 30, fount) === -1, 'segSphereT: sphere behind the segment returns -1');
  const box = { minX: -5, maxX: 5, minZ: -5, maxZ: 5, h: 10 };
  const tb = segBoxT(0, 2, -12, 0, 2, 12, box);
  ok(tb > 0.28 && tb < 0.30, 'segBoxT: boom into a building box hits at t~0.292', tb);
  ok(segBoxT(0, 12, -12, 0, 12, 12, box) === -1, 'segBoxT: boom above the roofline misses');
  ok(segBoxT(9, 2, -12, 9, 2, 12, box) === -1, 'segBoxT: boom beside the box misses');
}

// ---- stage 08: groundH ----
ok(near(groundH(0, 18), 0), 'groundH: spawn is plateau');
ok(near(groundH(0, -50), 0), 'groundH: north row is plateau');
ok(near(groundH(118, 12), 0), 'groundH: pond is plateau');
ok(near(groundH(-100, 0), 0), 'groundH: west houses are plateau');
ok(groundH(174, 8) > 5.5, 'groundH: east overlook rises (' + groundH(174, 8).toFixed(1) + ')');
ok(groundH(-168, -42) > 1.8, 'groundH: west forest floor rises (' + groundH(-168, -42).toFixed(1) + ')');
ok(groundH(150, 8) > 0 && groundH(150, 8) < groundH(174, 8), 'groundH: overlook slope is gradual');
ok(groundH(140, 8) >= 0 && groundH(140, 8) < groundH(150, 8), 'groundH: mask ramp is monotonic outward');
ok(near(groundH(174, 8), groundH(174, 8)), 'groundH: deterministic');
ok(Math.abs(groundH(-179, -38) - groundH(-174, -34)) < 0.05, 'groundH v2: clearing pad is flat');
ok(groundH(-179, -38) > 2.0, 'groundH v2: clearing pad stays elevated (' + groundH(-179, -38).toFixed(1) + ')');
ok(Math.abs(groundH(174, 8) - groundH(170, 5)) < 0.05, 'groundH v2: overlook pad is flat');
ok(near(groundH(34, 64), 0), 'groundH v2: south park still plateau');

// ---- terrain pass: procedural heightfield guarantees ----
// noise primitives: bounded + deterministic
{
  let inRange = true, det = true;
  for (let i = 0; i < 400; i++) {
    const x = -97 + i * 0.61, z = 53 - i * 0.37;
    const n = noise2(x, z), f = fbm2(x, z, 4), r = ridge2(x, z, 4);
    if (!(n >= -1.45 && n <= 1.45 && f >= -1.01 && f <= 1.01 && r >= 0 && r <= 1.01)) inRange = false;
    if (noise2(x, z) !== n || fbm2(x, z, 4) !== f || ridge2(x, z, 4) !== r) det = false;
  }
  ok(inRange, 'terrain: noise/fbm/ridge stay in their ranges');
  ok(det, 'terrain: noise is deterministic (same input, same output, bit-exact)');
}
// the whole developed plateau is EXACTLY zero — spawn, plaza, roads,
// pond, every building footprint and door front keep their old ground
{
  let flat = true, worst = '';
  for (let x = -126; x <= 126; x += 6) for (let z = -98; z <= 98; z += 6) {
    if (groundH(x, z) !== 0) { flat = false; worst = x + ',' + z + '=' + groundH(x, z); }
  }
  ok(flat, 'terrain: town plateau is exactly h=0 everywhere' + (worst ? ' (worst ' + worst + ')' : ''));
  const doors = [[-28.6, -35.0], [-62, -42.8], [43.4, -35.0], [58, -44.8], [62, 40.3], [-64, 38.3]];
  ok(doors.every(([x, z]) => groundH(x, z) === 0), 'terrain: every building door front is at h=0');
}
// chunk boundaries: the client builds 55u chunks, 22 segments (2.5u).
// a border vertex sampled through either neighbour's parameterization
// must produce the identical height, bit for bit — no seams, ever.
{
  const TCHUNK = 55, TSEG = 22, step = TCHUNK / TSEG;
  let ident = true;
  for (let cx = -5; cx < 4 && ident; cx++) for (let cz = -4; cz < 4 && ident; cz++) {
    for (let j = 0; j <= TSEG; j++) {
      const zA = cz * TCHUNK + j * step;
      if (groundH(cx * TCHUNK + TSEG * step, zA) !== groundH((cx + 1) * TCHUNK, zA)) { ident = false; break; }
      const xA = cx * TCHUNK + j * step;
      if (groundH(xA, cz * TCHUNK + TSEG * step) !== groundH(xA, (cz + 1) * TCHUNK)) { ident = false; break; }
    }
  }
  ok(ident, 'terrain: shared chunk-border heights are bit-identical');
}
// no spikes, no cliffs: bounded range everywhere, gentle slopes
// inside the playable bounds, valid up-facing normals
{
  let maxH = -1e9, minH = 1e9, maxSlope = 0, normalsOk = true;
  for (let x = -275; x <= 275; x += 2) for (let z = -220; z <= 220; z += 2) {
    const h = groundH(x, z);
    if (h > maxH) maxH = h; if (h < minH) minH = h;
    if (Math.abs(x) <= 195 && Math.abs(z) <= 118) {
      const e = 1.5;
      const gx = (groundH(x + e, z) - groundH(x - e, z)) / (2 * e);
      const gz = (groundH(x, z + e) - groundH(x, z - e)) / (2 * e);
      const sl = Math.hypot(gx, gz);
      if (sl > maxSlope) maxSlope = sl;
      const ny = 1 / Math.hypot(gx, 1, gz);
      if (!(ny > 0.55 && ny <= 1)) normalsOk = false;
    }
  }
  ok(maxH <= 45 && minH >= -2.01, 'terrain: elevation bounded (min ' + minH.toFixed(2) + ', max ' + maxH.toFixed(2) + ')');
  ok(maxSlope <= 0.6, 'terrain: steepest playable slope is walkable (' + maxSlope.toFixed(3) + ')');
  ok(normalsOk, 'terrain: analytic normals are unit and up-facing inside the bounds');
}
// the horizon is real terrain, not a wall: edge heights are high
// and VARY along the rim (ridged silhouettes, not a uniform ring)
{
  const rim = [groundH(-270, 0), groundH(270, 0), groundH(0, -212), groundH(0, 212), groundH(-270, -212), groundH(270, 212)];
  const lo = Math.min(...rim), hi = Math.max(...rim);
  ok(lo > 4 && hi - lo > 4, 'terrain: mountain rim rises and varies (rim ' + rim.map((v) => v.toFixed(1)).join('/') + ')');
}
// refinement pass: shared terrain normal — unit, up-facing, and
// tilted against the uphill direction (mesh halo math agrees by
// construction; this pins the function itself down)
{
  let okN = true;
  for (let i = 0; i < 120; i++) {
    const x = -190 + (i * 37) % 380, z = -110 + (i * 53) % 220;
    const n = terrainNormal(x, z);
    const len = Math.hypot(n[0], n[1], n[2]);
    if (Math.abs(len - 1) > 1e-9 || n[1] <= 0) okN = false;
    const e = 1.5;
    const gx = (groundH(x + e, z) - groundH(x - e, z)) / (2 * e);
    if (gx > 0.05 && n[0] >= 0) okN = false; // uphill east -> normal leans west
    if (gx < -0.05 && n[0] <= 0) okN = false;
  }
  ok(okN, 'refine: terrainNormal is unit, up-facing, and leans against the slope');
}
// refinement pass: flat-chunk eligibility — the 8 low-res chunks and
// their neighbours' shared-edge strips are all exactly h=0
{
  let flatOk = true;
  const isFlatChunk = (cx, cz) => Math.max(Math.abs(cx * 55), Math.abs((cx + 1) * 55)) <= 124
    && Math.max(Math.abs(cz * 55), Math.abs((cz + 1) * 55)) <= 96;
  let nFlat = 0;
  for (let cx = -5; cx < 5; cx++) for (let cz = -4; cz < 4; cz++) if (isFlatChunk(cx, cz)) {
    nFlat++;
    for (let x = cx * 55; x <= (cx + 1) * 55; x += 5.5) for (let z = cz * 55; z <= (cz + 1) * 55; z += 5.5) {
      if (groundH(x, z) !== 0) flatOk = false;
    }
  }
  // neighbour edge strips just outside the flat rects
  for (let z = -55; z <= 55; z += 5) if (groundH(112.4, z) !== 0 || groundH(-112.4, z) !== 0) flatOk = false;
  for (let x = -110; x <= 110; x += 5) if (groundH(x, 57.4) !== 0 || groundH(x, -57.4) !== 0) flatOk = false;
  ok(flatOk && nFlat === 8, 'refine: 8 flat chunks + shared-edge strips are exactly h=0');
}
// refinement pass: material weights are a valid blend everywhere,
// and each layer stays in its place
{
  let valid = true;
  for (let x = -260; x <= 260 && valid; x += 13) for (let z = -200; z <= 200; z += 13) {
    const h = groundH(x, z), n = terrainNormal(x, z);
    const w = terrainWeights(x, z, n[1], h);
    const sum = w.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-6 || w.some((v) => !(v >= 0 && v <= 1))) valid = false;
  }
  ok(valid, 'refine: terrainWeights sum to 1 and stay in [0,1] across the world');
  const nPond = terrainNormal(0, 100), wFar = terrainWeights(0, 100, nPond[1], 0);
  ok(wFar[4] === 0, 'refine: no sand away from the pond');
  const nF = terrainNormal(-175, 0), wF = terrainWeights(-175, 0, nF[1], groundH(-175, 0));
  ok(wF[1] > 0.4, 'refine: forest floor dominates deep in the west woods (' + wF[1].toFixed(2) + ')');
  const nM = terrainNormal(150, 20), wM = terrainWeights(150, 20, nM[1], groundH(150, 20));
  ok(wM[0] > wM[1] && wM[0] > 0.3, 'refine: grass leads in the east meadow (' + wM[0].toFixed(2) + ')');
  const wT = terrainWeights(0, 0, 1, 0);
  ok(wT[3] === 0 && wT[0] > 0.9, 'refine: town centre is grass, never rock');
}
// refinement pass: valleys are real — the west drainage line runs
// below its banks, and the north saddle dips between the hill masses
{
  const pathW = (z) => -160 + 20 * Math.sin(z * 0.019 + 2.6) + 8 * fbm2(z * 0.012 + 9.9, 3.3, 2);
  let westOk = true;
  for (const z of [-30, 0, 30]) {
    const px = pathW(z);
    if (!(groundH(px, z) < groundH(px - 20, z) - 0.3)) westOk = false;
  }
  ok(westOk, 'refine: west drainage valley runs below its west bank');
  ok(groundH(170, 42) < groundH(152, 40) - 0.3 && groundH(170, 42) < groundH(186, 44) - 0.3,
    'refine: north saddle valley dips between the east hill masses');
}
// refinement pass: generation order cannot change the result
{
  const pts = [];
  for (let i = 0; i < 200; i++) pts.push([-260 + (i * 41) % 520, -200 + (i * 67) % 400]);
  const fwd = pts.map(([x, z]) => groundH(x, z));
  const rev = pts.slice().reverse().map(([x, z]) => groundH(x, z)).reverse();
  ok(fwd.every((v, i) => v === rev[i] && Number.isFinite(v)), 'refine: generation order does not change terrain (and no NaN)');
}
// realism pass: material selection reaches the rim — steep high
// ground is rocky, and the rim really is steeper than the playable
// slopes (occasional steep rocky areas exist by design)
{
  let rimRock = 0, rimN = 0, sloped = 0, tot = 0;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const x = Math.cos(a) * 258, z = Math.sin(a) * 196;
    const h = groundH(x, z), n = terrainNormal(x, z);
    const w = terrainWeights(x, z, n[1], h);
    tot++; if (n[1] < 0.99) sloped++;
    if (h >= 13) { rimN++; if (w[3] >= 0.25) rimRock++; }
  }
  ok(rimN > 5 && rimRock >= rimN * 0.6, 'realism: exposed high rim ground is mostly rock (' + rimRock + '/' + rimN + ' sampled)');
  ok(sloped >= tot * 0.5, 'realism: rim faces are genuinely sloped (' + sloped + '/' + tot + ' samples tilted)');
}
// realism pass: chunk connectivity across resolutions — the flat
// chunks' edge vertices (0, 27.5, 55 along the edge) are a strict
// subset of the neighbour's full-res edge line, and every point of
// that line is h=0, so the two resolutions describe the SAME surface
{
  let subset = true;
  for (const z of [-55, -27.5, 0, 27.5, 55]) if (groundH(110, z) !== 0 || groundH(-110, z) !== 0) subset = false;
  for (let z = -55; z <= 55; z += 2.5) if (groundH(110, z) !== 0 || groundH(-110, z) !== 0) subset = false;
  for (let x = -110; x <= 110; x += 2.5) if (groundH(x, 55) !== 0 || groundH(x, -55) !== 0) subset = false;
  ok(subset, 'realism: flat/full-res chunk edges coincide exactly (subset of one flat line)');
  // corners where four chunks meet: one height, whoever asks
  const corners = [[110, 55], [110, -55], [-110, 55], [-110, -55], [55, 55], [0, 0]];
  ok(corners.every(([x, z]) => groundH(x, z) === 0), 'realism: four-chunk corners inside the plateau agree at h=0');
}
// realism pass 2: texture projections, tested as the client
// actually uses them. chunk (cx,cz) generates vertices on its own
// local grid; the shared edge of two chunks must produce the same
// world positions AND the same UVs from both sides, at both
// resolutions, or the ground seams.
{
  const edgePts = (cx, cz, seg, axis) => {
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const t = (55 / seg) * i;
      pts.push(axis === 'x' ? [cx * 55 + 55, cz * 55 + t] : [cx * 55 + t, cz * 55 + 55]);
    }
    return pts;
  };
  let edgeOk = true;
  // full-res / full-res edge at x=165 (chunks (2,0) and (3,0))
  const eA = edgePts(2, 0, 22, 'x');
  // the second chunk's local grid reaches the same edge from its west side:
  const eB2 = []; for (let i = 0; i <= 22; i++) eB2.push([165, 2.5 * i]);
  for (let i = 0; i <= 22; i++) {
    if (eA[i][0] !== eB2[i][0] || eA[i][1] !== eB2[i][1]) edgeOk = false;
    const [ax, az] = eA[i];
    const pa = terrainProjA(ax, az), pb = terrainProjA(eB2[i][0], eB2[i][1]);
    if (pa[0] !== pb[0] || pa[1] !== pb[1]) edgeOk = false;
    for (let L = 0; L < 5; L++) {
      const ba = terrainProjB(ax, az, L), bb = terrainProjB(eB2[i][0], eB2[i][1], L);
      if (ba[0] !== bb[0] || ba[1] !== bb[1]) edgeOk = false;
    }
  }
  ok(edgeOk, 'proj: neighbouring chunks generate identical edge positions and UVs (detail + all 5 breakup layers)');
  // flat (seg 2) / full-res (seg 22) edge at x=110: the flat chunk's
  // 3 edge points are a subset of the full-res edge line, same UVs
  let subOk = true;
  const flatEdge = edgePts(1, 0, 2, 'x');
  const fullEdge = new Set(); for (let i = 0; i <= 22; i++) fullEdge.add('110,' + 2.5 * i);
  for (const [x, z] of flatEdge) if (!fullEdge.has(x + ',' + z)) subOk = false;
  for (const [x, z] of flatEdge) {
    const pa = terrainProjA(x, z), pb = terrainProjA(110, z);
    if (pa[0] !== pb[0] || pa[1] !== pb[1]) subOk = false;
  }
  ok(subOk, 'proj: flat/full-res boundary — flat edge points are a subset with identical UVs');
  // four-chunk corner (55,55): one world point, one UV set
  const cA = terrainProjA(55, 55);
  ok(TERR_LAYERS.every((_, L) => { const b = terrainProjB(55, 55, L); return Number.isFinite(b[0]) && Number.isFinite(b[1]); }) && cA[0] === 55 * TERR_DETAIL_SCALE,
    'proj: four-chunk corner has a single well-defined UV set');
  // rotated breakup has no jumps: stepping 1mm across a border
  // moves every layer's breakup UV by ~the step size, never more
  let jumpOk = true;
  for (let L = 0; L < 5; L++) for (const z of [-30, 0, 41]) {
    const a = terrainProjB(110 - 0.001, z, L), b = terrainProjB(110 + 0.001, z, L);
    if (Math.abs(b[0] - a[0]) > 0.01 || Math.abs(b[1] - a[1]) > 0.01) jumpOk = false;
  }
  ok(jumpOk, 'proj: rotated breakup UVs are continuous across chunk borders (no jumps)');
}
// realism pass 2: the breakup rotations are real rotations, and
// the normal-blend correction (rotate the breakup sample by
// -theta) exactly recovers a known surface normal — with a
// negative control proving the test can detect a missing
// correction (at the dirt layer's 71 degrees, skipping it is off
// by far more than the tolerance).
{
  let rotOk = true, corrOk = true, ctrlOk = true;
  const nA = [0.3, -0.4, 0.866];
  for (let L = 0; L < 5; L++) {
    const [c, s, m] = TERR_LAYERS[L];
    if (Math.abs(c * c + s * s - 1) > 2e-3) rotOk = false;
    const rt = rot2(rot2([0.7, -0.2], c, s), c, -s);
    if (Math.abs(rt[0] - 0.7) > 2e-3 || Math.abs(rt[1] + 0.2) > 2e-3) rotOk = false;
    // the texture-space normal a rotated sampling would produce
    // from the surface normal nA, then the shader's correction:
    const nb = [...rot2([nA[0], nA[1]], c, s), nA[2]];
    const fixed = blendTerrainNormal(nA, nb, c, s, m);
    if (Math.abs(fixed[0] - nA[0]) > 2e-3 || Math.abs(fixed[1] - nA[1]) > 2e-3 || Math.abs(fixed[2] - nA[2]) > 2e-3) corrOk = false;
    // negative control: same blend with the WRONG sign (+theta)
    const wrong = (() => { const b = rot2([nb[0], nb[1]], c, s); return [nA[0] + (b[0] - nA[0]) * m, nA[1] + (b[1] - nA[1]) * m]; })();
    if (L === 2 && Math.hypot(wrong[0] - nA[0], wrong[1] - nA[1]) < 0.05) ctrlOk = false;
  }
  ok(rotOk, 'proj: layer rotations are orthonormal and invertible');
  ok(corrOk, 'proj: normal correction recovers the true normal at every layer mix');
  ok(ctrlOk, 'proj: negative control — an uncorrected blend is measurably wrong (test has teeth)');
}
// realism pass 2: rock side projection — weight ramps only on
// genuinely steep faces, the axis choice follows the dominant
// normal, and the side UV runs smoothly up a uniform slope.
{
  ok(terrainSideW(1) === 0 && terrainSideW(0.95) === 0 && terrainSideW(0.5) === 1, 'proj: side weight is 0 on gentle ground, 1 on steep faces');
  let mono = true, prev = -1;
  for (const ny of [0.88, 0.82, 0.76, 0.70, 0.64, 0.60]) { const w = terrainSideW(ny); if (w < prev) mono = false; prev = w; }
  ok(mono && prev === 1, 'proj: side weight ramps monotonically between 28 and 53 degrees');
  const uvZ = terrainSideUV(10, 3, 20, 0, 0.71), uvX = terrainSideUV(10, 3, 20, 0.71, 0);
  ok(uvZ[0] === 10 * TERR_DETAIL_SCALE && uvZ[1] === 3 * TERR_DETAIL_SCALE && uvX[0] === 20 * TERR_DETAIL_SCALE,
    'proj: side UV uses the XY projection for z-facing slopes, ZY for x-facing');
  const s1 = terrainSideUV(5, 1, 8, 0, 0.71), s2 = terrainSideUV(5, 2.5, 9.5, 0, 0.71);
  ok(Math.abs((s2[1] - s1[1]) - 1.5 * TERR_DETAIL_SCALE) < 1e-9, 'proj: side UV climbs smoothly with height on a uniform slope');
}
// realism pass 2: shader/spec consistency — the GLSL literals in
// client3d.js must match this spec exactly, or the tests above
// describe a shader that does not exist.
{
  const glsl = readFileSync(new URL('../client3d.js', import.meta.url), 'utf8');
  const near = (a, b) => Math.abs(a - b) < 1.5e-3;
  let specOk = glsl.includes('vWPos.xz * 0.142857') && near(TERR_DETAIL_SCALE, 0.142857)
    && glsl.includes('vWPos.xz * 0.052632') && near(TERR_BREAK_SCALE, 0.052632);
  const rotCalls = [...glsl.matchAll(/terrRot\(tB, ([\d.]+), ([\d.]+)\)/g)].map((mm) => [+mm[1], +mm[2]]);
  // breakup UV definitions in source order: bG, bF, bD, bR, bS
  const wantRot = [TERR_LAYERS[0], TERR_LAYERS[1], TERR_LAYERS[2], TERR_LAYERS[3], TERR_LAYERS[4]];
  if (rotCalls.length !== 5 || !rotCalls.every((r, i) => near(r[0], wantRot[i][0]) && near(r[1], wantRot[i][1]))) specOk = false;
  const nrmCalls = [...glsl.matchAll(/terrNrm\(uT\w+n, tUvA, b\w, ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)/g)]
    .map((mm) => [+mm[1], +mm[2], +mm[3], +mm[4]]);
  if (nrmCalls.length !== 4 || !nrmCalls.every((r, i) => near(r[0], TERR_LAYERS[i][0]) && near(r[1], TERR_LAYERS[i][1]) && near(r[2], TERR_LAYERS[i][2]) && near(r[3], TERR_LAYERS[i][3]))) specOk = false;
  const mixCalls = [...glsl.matchAll(/terrMixD\(uT\w, tUvA, b\w, ([\d.]+)\)/g)].map((mm) => +mm[1]);
  const wantMix = [TERR_LAYERS[0][2], TERR_LAYERS[1][2], TERR_LAYERS[2][2], TERR_LAYERS[4][2]];
  if (mixCalls.length !== 4 || !mixCalls.every((v, i) => near(v, wantMix[i]))) specOk = false;
  ok(specOk, 'proj: shader literals match the tested spec (scales, rotations, mixes, normal strengths)');
  // declaration order matters in GLSL: terrNrm calls terrRot, so
  // its definition must come after terrRot's in the shader source
  // (pass 2 shipped this wrong once — the fragment program failed
  // to compile and the terrain rendered unshaded white).
  const iRot = glsl.indexOf('vec2 terrRot('), iNrm = glsl.indexOf('vec3 terrNrm(');
  ok(iRot > 0 && iNrm > iRot, 'proj: terrNrm is declared after terrRot (GLSL declaration order)');
}

// refinement pass: full-world generation cost (all 80 chunks' halo
// sampling at their real resolutions)
{
  const t0 = Date.now();
  let acc = 0;
  for (let cx = -5; cx < 5; cx++) for (let cz = -4; cz < 4; cz++) {
    const flat = Math.max(Math.abs(cx * 55), Math.abs((cx + 1) * 55)) <= 124
      && Math.max(Math.abs(cz * 55), Math.abs((cz + 1) * 55)) <= 96;
    const seg = flat ? 2 : 22, H = seg + 3, step = 55 / seg;
    for (let j = 0; j < H; j++) for (let i = 0; i < H; i++) acc += groundH(cx * 55 + (i - 1) * step, cz * 55 + (j - 1) * step);
  }
  const ms = Date.now() - t0;
  ok(ms < 2500 && acc !== 0, 'refine: full 80-chunk terrain generation in ' + ms + 'ms');
}

// generation performance: a full chunk is 625 halo samples
{
  const t0 = Date.now();
  let acc = 0;
  for (let i = 0; i < 20000; i++) acc += groundH(-260 + (i % 520), -200 + (i % 400));
  const ms = Date.now() - t0;
  ok(ms < 500 && acc !== 0, 'terrain: 20k height samples in ' + ms + 'ms (chunk gen stays cheap)');
}

console.log('MATH RESULT: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

