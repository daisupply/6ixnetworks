// math.test.mjs — pure movement/camera math for the 3D world.
// tests the EXACT functions client3d.js imports from ../math3d.js.
// run: node world3d/tests/math.test.mjs   (no server, no deps)
import { angWrap, angLerp, dampK, normInput, moveVec, segSphereT, segBoxT, groundH } from '../math3d.js';

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

console.log('MATH RESULT: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

