/* Wild water geometry — pure data, no THREE imports, unit-
 * tested in tests/water.test.mjs. Replaces the whole-chunk
 * 55x55 plane (square shorelines, water drawn over dry land
 * inside mixed chunks) with a marching-squares surface clipped
 * to the actual WATER_Y contour of groundH:
 *
 * - the chunk is sampled on a world-aligned 2.75u grid (21x21
 *   nodes), so two neighbouring chunks sample IDENTICAL heights
 *   at their shared border nodes and compute the same crossing
 *   points on shared edges — shorelines meet with no gaps, on
 *   every client, because groundH is a pure function of world
 *   coordinates;
 * - each cell's below-water polygon is triangulated flat at
 *   the shared WATER_Y level; no vertex ever sits over terrain
 *   above the water level (edge crossings interpolate to
 *   exactly WATER_Y);
 * - every vertex carries an RGBA colour baked from its depth
 *   below WATER_Y: pale + translucent at the shoreline, deep
 *   blue + opaque in the basin — shallow vs deep reads without
 *   a depth texture or reflection pass;
 * - one geometry per chunk, built once per chunk build, freed
 *   on eviction; regeneration is bit-identical (asserted). */
import { groundH, WATER_Y } from './math3d.js';

export const WATER_CELL = 2.75; // 20 cells per 55u chunk
export const WATER_LIFT = 0.02; // same ride height as the old quad
const N = 20;                   // cells per side

const SHALLOW = [0.52, 0.72, 0.82, 0.52];
const DEEP = [0.07, 0.26, 0.47, 0.90];

export function waterChunkData(cx, cz) {
  const x0 = cx * 55, z0 = cz * 55;
  const H = new Float32Array((N + 1) * (N + 1));
  let anyIn = false;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const h = groundH(x0 + i * WATER_CELL, z0 + j * WATER_CELL);
    H[j * (N + 1) + i] = h;
    if (h < WATER_Y) anyIn = true;
  }
  if (!anyIn) return null;
  const pos = [], col = [], idx = [];
  const vIdx = new Map(); // dedupe shared corners/edges within the chunk
  function vert(x, z, h) {
    const key = x.toFixed(3) + ',' + z.toFixed(3);
    let id = vIdx.get(key);
    if (id !== undefined) return id;
    id = pos.length / 3;
    vIdx.set(key, id);
    pos.push(x, WATER_Y + WATER_LIFT, z);
    const depth = Math.max(0, WATER_Y - h);
    // this world's floor is -2.6, so the deepest possible water
    // is ~1.45 below WATER_Y — the ramp is calibrated to that,
    // not to an ocean that doesn't exist here
    const t = Math.min(1, depth / 1.5);
    for (let k = 0; k < 4; k++) col.push(SHALLOW[k] + (DEEP[k] - SHALLOW[k]) * t);
    return id;
  }
  // emit one triangle with UPWARD winding: plan order A->B->C->D
  // (z growing south) is clockwise from above, so each triple is
  // emitted reversed — (p, r, q) — and the tests assert ny > 0
  // on every triangle of the real output.
  function tri(p, q, r) { idx.push(vert(p[0], p[1], p[2]), vert(r[0], r[1], r[2]), vert(q[0], q[1], q[2])); }

  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const xa = x0 + i * WATER_CELL, za = z0 + j * WATER_CELL, xb = xa + WATER_CELL, zb = za + WATER_CELL;
    const hA = H[j * (N + 1) + i], hB = H[j * (N + 1) + i + 1], hC = H[(j + 1) * (N + 1) + i + 1], hD = H[(j + 1) * (N + 1) + i];
    const A = [xa, za, hA], B = [xb, za, hB], C = [xb, zb, hC], D = [xa, zb, hD];
    const inA = hA < WATER_Y, inB = hB < WATER_Y, inC = hC < WATER_Y, inD = hD < WATER_Y;
    const mask = (inA ? 1 : 0) | (inB ? 2 : 0) | (inC ? 4 : 0) | (inD ? 8 : 0);
    if (mask === 0) continue;
    const cross = (P, Q) => {
      const t = (WATER_Y - P[2]) / (Q[2] - P[2]);
      return [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, WATER_Y];
    };
    if (mask === 5) { tri(A, cross(A, B), cross(D, A)); tri(C, cross(C, D), cross(B, C)); continue; }   // saddle A+C
    if (mask === 10) { tri(B, cross(B, C), cross(A, B)); tri(D, cross(D, A), cross(C, D)); continue; } // saddle B+D
    // walk the boundary A->B->C->D->A collecting the in-polygon
    const corners = [A, B, C, D], ins = [inA, inB, inC, inD];
    const poly = [];
    for (let k = 0; k < 4; k++) {
      const P = corners[k], Q = corners[(k + 1) % 4];
      if (ins[k]) poly.push(P);
      if (ins[k] !== ins[(k + 1) % 4]) poly.push(cross(P, Q));
    }
    for (let k = 1; k + 1 < poly.length; k++) tri(poly[0], poly[k], poly[k + 1]); // fan
  }
  if (!idx.length) return null;
  return { positions: new Float32Array(pos), colors: new Float32Array(col), indices: new Uint32Array(idx) };
}
