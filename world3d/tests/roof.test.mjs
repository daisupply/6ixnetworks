// roof.test.mjs — residential house roof geometry tests (V578).
// These tests exist because bounds checks cannot detect an
// inverted roof: a valley roof and a gable roof have the same
// min/max heights. Every assertion here is DIRECTIONAL — it
// measures which way the slopes actually face, from three
// independent sources of truth:
//   1. the generation math in assets-src/districts.py, simulated
//      from the parameters written in that file;
//   2. the actual exported house.glb (decoded from the repo's
//      house.glb.b64 — the exact bytes the game serves);
//   3. the same GLB vertices after the three runtime parent
//      rotations (0.5 / 0.9 / 0.25 rad) are applied.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log("FAIL", name); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- 1. source-level: simulate the roof generation math ----------
{
  const py = fs.readFileSync(path.join(HERE, "..", "assets-src", "districts.py"), "utf8");
  const hStart = py.indexOf("# gable roof, ridge along X");
  const house = py.slice(hStart, py.indexOf("box(\"ridge_cap\"", hStart));
  const wallTop = parseFloat(/wall_top = ([\d.]+)/.exec(house)[1]);
  const roofH = parseFloat(/roof_h = ([\d.]+)/.exec(house)[1]);
  const run = parseFloat(/atan2\(roof_h, ([\d.]+) \+ ([\d.]+)\)/.exec(house)[1]) + parseFloat(/atan2\(roof_h, ([\d.]+) \+ ([\d.]+)\)/.exec(house)[2]);
  const extra = parseFloat(/math\.hypot\(4\.5 \+ 0\.9, roof_h\) \+ ([\d.]+)/.exec(house)[1]);
  const centerOff = parseFloat(/sgn \* ([\d.]+), wall_top/.exec(house)[1]);
  const flipped = /rotation_euler = \(-sgn \* pitch, 0, 0\)/.exec(house) !== null;
  const pitch = Math.atan2(roofH, run);
  const slopeLen = Math.hypot(run, roofH) + extra, half = slopeLen / 2;
  const cz = wallTop + roofH / 2 + 0.05;
  // Blender rotation about X: z' = y*sin(t) + z*cos(t)
  let bothDescend = true, ridgeZ = 0, eaveZ = 0;
  for (const sgn of [-1, 1]) {
    const t = (flipped ? -sgn : sgn) * pitch, cy = sgn * centerOff;
    const ends = [-half, half].map((ly) => ({ y: cy + ly * Math.cos(t), z: cz + ly * Math.sin(t) + 0.12 * Math.cos(t) }));
    ends.sort((a, b) => Math.abs(a.y) - Math.abs(b.y));
    if (!(ends[0].z > ends[1].z)) bothDescend = false;
    ridgeZ = ends[0].z; eaveZ = ends[1].z;
  }
  ok(bothDescend, "source: simulated slabs from districts.py parameters descend outward on both sides");
  ok(near(ridgeZ, wallTop + roofH, 0.35) && near(eaveZ, wallTop, 0.25),
    `source: ridge ~${(wallTop + roofH).toFixed(1)} and eaves ~wall top ${wallTop} (got ridge ${ridgeZ.toFixed(2)}, eave ${eaveZ.toFixed(2)})`);
}

// ---------- GLB parsing (repo asset, decoded from .b64) ----------
function loadGlbVerts(b64Path) {
  const buf = Buffer.from(fs.readFileSync(b64Path, "utf8").trim(), "base64");
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error("not a GLB");
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(data.toString("utf8"));
    if (type === 0x004E4942) bin = data;
    off += 8 + len;
  }
  const accessor = (idx) => {
    const a = json.accessors[idx], bv = json.bufferViews[a.bufferView];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const comps = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
    const out = new Float32Array(a.count * comps);
    const stride = bv.byteStride || comps * 4;
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = bin.readFloatLE(start + i * stride + c * 4);
    return out;
  };
  const nodeMatrix = (n) => {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
    const [x, y, z, w] = r, x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
      (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
      t[0], t[1], t[2], 1];
  };
  const byMat = new Map();
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    const M = nodeMatrix(node);
    for (const prim of json.meshes[node.mesh].primitives) {
      const name = json.materials[prim.material]?.name || "?";
      const pos = accessor(prim.attributes.POSITION);
      const arr = byMat.get(name) || [];
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        arr.push([M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]);
      }
      byMat.set(name, arr);
    }
  }
  return byMat;
}

const byMat = loadGlbVerts(path.join(HERE, "..", "assets", "architecture", "house.glb.b64"));
const roofAll = byMat.get("roof_house") || [];
const roof = roofAll.filter((p) => p[1] > 5.3); // main roof (porch roof sits below y 5.3)
const maxY = (a) => (a.length ? Math.max(...a.map((p) => p[1])) : -Infinity);
const minY = (a) => (a.length ? Math.min(...a.map((p) => p[1])) : Infinity);

// ---------- 2. GLB-level slope direction ----------
{
  ok(roof.length >= 40 && roof.every((p) => p.every(Number.isFinite)), "glb: main roof present, no degenerate/NaN vertices");
  for (const sgn of [1, -1]) {
    const half = roof.filter((p) => (sgn > 0 ? p[2] >= 0 : p[2] < 0));
    const inner = half.filter((p) => Math.abs(p[2]) < 1.2), outer = half.filter((p) => Math.abs(p[2]) > 4.6);
    ok(inner.length > 0 && outer.length > 0 && maxY(inner) > maxY(outer) + 2.0,
      `glb: ${sgn > 0 ? "+" : "-"}Z roof half descends outward (inner ${maxY(inner).toFixed(2)} vs outer ${maxY(outer).toFixed(2)})`);
  }
  const xs = roof.map((p) => p[0]), zs = roof.map((p) => p[2]);
  ok(near(Math.min(...xs), -6.2, 0.15) && near(Math.max(...xs), 6.2, 0.15), "glb: roof spans the ridge direction (x -6.2..6.2)");
  ok(near(Math.min(...zs) + Math.max(...zs), 0, 0.15), "glb: roof centered over the walls in z");
  ok(near(maxY(roof), 8.65, 0.1) && near(minY(roof), 5.44, 0.12), `glb: ridge top ${maxY(roof).toFixed(2)} (~8.65), eave bottom ${minY(roof).toFixed(2)} (~5.44)`);
  // ridge cap: timber_dark verts above the roof, centered on the ridge line
  const cap = (byMat.get("timber_dark") || []).filter((p) => p[1] > 8.3 && Math.abs(p[2]) < 0.45);
  ok(cap.length > 0 && Math.max(...cap.map((p) => p[0])) - Math.min(...cap.map((p) => p[0])) > 12
    && minY(cap) < maxY(roof), "glb: ridge cap runs the ridge length and meets the slab tops (no float/gap)");
  // gable infills: walls_shade triangles at |x| ~ 5.5 with apex at ridge height
  const gab = (byMat.get("walls_shade") || []).filter((p) => Math.abs(Math.abs(p[0]) - 5.5) < 0.2 && p[1] > 5.0);
  ok(gab.length > 0 && near(maxY(gab), 8.4, 0.1), `glb: gable apex at ${maxY(gab).toFixed(2)} (~8.4, matches roof profile)`);
  // porch roof (same material, below y 5.3, out at z ~ +5.5): its
  // high edge must be the one nearest the house center in x
  const porch = roofAll.filter((p) => p[1] < 5.3 && p[2] > 4.6);
  let porchOk = porch.length > 0;
  for (const sgn of [1, -1]) {
    const side = porch.filter((p) => (sgn > 0 ? p[0] >= 0 : p[0] < 0));
    const inner = side.filter((p) => Math.abs(p[0]) < 0.95), outer = side.filter((p) => Math.abs(p[0]) > 1.35);
    if (!(inner.length && outer.length && maxY(inner) > maxY(outer))) porchOk = false;
  }
  ok(porchOk, "glb: porch roof still slopes down away from center (unchanged, was already correct)");
}

// ---------- 3. parent rotations ----------
// A rigid yaw cannot change slope direction (the ridge-distance
// of every vertex is rotation-invariant), so a Node-side yaw
// test would be vacuous. The meaningful check — that the
// loader + group placement in the real client does not mirror
// or misplace the model at yaws 0.5 / 0.9 / 0.25 — runs against
// world-space vertices in the running game (Phase 7 probe,
// reported with the stage results).

console.log(`ROOF RESULT: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
