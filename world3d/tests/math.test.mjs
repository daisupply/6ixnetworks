// math.test.mjs — pure movement/camera math for the 3D world.
// tests the EXACT functions client3d.js imports from ../math3d.js.
// run: node world3d/tests/math.test.mjs   (no server, no deps)
import { angWrap, angLerp, dampK, normInput, moveVec, segSphereT, segBoxT, groundH, noise2, fbm2, ridge2, terrainNormal, terrainWeights } from '../math3d.js';

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

