/* Far-range horizon geometry — pure data, no THREE imports, so
 * the winding/seam/radii are unit-testable in Node
 * (tests/horizon.test.mjs). The client builds its BufferGeometry
 * from farRangeData(); heights sample the same ridge/sector
 * fields as groundH's rim ranges in math3d.js, so the far range
 * is the rim mountain system continued outward.
 *
 * Winding law (v593 bug, fixed here): grid rows j run radially
 * outward, columns i run counter-clockwise (angle increasing,
 * x=cos*r, z=sin*r). Triangles (a0,b0,c0) / (b0,d0,c0) — where
 * a0=(j,i), b0=(j,i+1), c0=(j+1,i), d0=(j+1,i+1) — produce
 * cross products with POSITIVE Y (upward-facing). The v593
 * order (a0,c0,b0)/(b0,c0,d0) produced downward normals on
 * every triangle and the FrontSide material culled the whole
 * range from every playable viewpoint. */
import { ridge2, fbm2 } from './math3d.js';

function sstep(a, b, v) { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

export const FAR_NA = 288;   // angular steps
export const FAR_NR = 18;    // radial steps
export const FAR_RIN = 1030; // inner radius — beyond the 990 world edge
export const FAR_ROUT = 1980;

export function farRangeH(x, z) {
  const r = Math.hypot(x, z);
  const rg = ridge2(x * 0.0085 + 31.4, z * 0.0085 + 3.1, 4);
  const ang = Math.atan2(z, x);
  const sector = 0.72 + 0.6 * (fbm2(Math.cos(ang) * 1.35 + 9.1, Math.sin(ang) * 1.35 + 4.4, 2) * 0.5 + 0.5);
  const rise = sstep(FAR_RIN, 1450, r);
  const crest = (18 + 165 * Math.pow(rg, 1.7)) * sector;
  const detail = 16 * (ridge2(x * 0.021 + 7.3, z * 0.021 + 2.9, 3) - 0.5) + 6 * fbm2(x * 0.05, z * 0.05, 2);
  let h = -8 + rise * (crest + detail * (0.4 + 0.6 * rg));
  h *= 1 - 0.35 * sstep(1750, FAR_ROUT, r);
  return h;
}

export function farRangeData() {
  const NA = FAR_NA, NR = FAR_NR;
  const positions = new Float32Array((NA + 1) * (NR + 1) * 3);
  let p = 0;
  for (let j = 0; j <= NR; j++) {
    const r = FAR_RIN + (FAR_ROUT - FAR_RIN) * Math.pow(j / NR, 1.25);
    const rowStart = p;
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      positions[p++] = x; positions[p++] = farRangeH(x, z); positions[p++] = z;
    }
    // seam: sin(2π) is -2.4e-16, not 0 — copy the first vertex of
    // the row over the last so the wrap is bit-identical and the
    // ring is watertight, not merely close.
    positions[p - 3] = positions[rowStart];
    positions[p - 2] = positions[rowStart + 1];
    positions[p - 1] = positions[rowStart + 2];
  }
  const indices = new Uint32Array(NA * NR * 6);
  let q = 0;
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
    const a0 = j * (NA + 1) + i, b0 = a0 + 1, c0 = a0 + NA + 1, d0 = c0 + 1;
    indices[q++] = a0; indices[q++] = b0; indices[q++] = c0;
    indices[q++] = b0; indices[q++] = d0; indices[q++] = c0;
  }
  return { positions, indices, NA, NR, R_IN: FAR_RIN, R_OUT: FAR_ROUT };
}
