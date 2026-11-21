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
