/* Water geometry tests — the real watermesh.js against the
 * real groundH. Run: node world3d/tests/water.test.mjs */
import { waterChunkData, WATER_CELL } from '../watermesh.js';
import { groundH, WATER_Y } from '../math3d.js';
import { landmarks } from '../worldgen.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const lake = landmarks().find((l) => l.kind === 'lake');
const lcx = Math.floor(lake.x / 55), lcz = Math.floor(lake.z / 55);
const d = waterChunkData(lcx, lcz);
ok(!!d && d.indices.length > 0, 'water: the landmark lake chunk produces geometry', { chunk: lcx + ',' + lcz });

// every vertex flat at the shared level, and never over dry land
{
  let badY = 0, badDry = 0;
  for (let i = 0; i < d.positions.length; i += 3) {
    const x = d.positions[i], y = d.positions[i + 1], z = d.positions[i + 2];
    if (Math.abs(y - (WATER_Y + 0.02)) > 1e-6) badY++;
    if (groundH(x, z) > WATER_Y + 0.01) badDry++; // crossings sit ON the level; corners are below it
  }
  ok(badY === 0, 'water: every vertex at WATER_Y + 0.02', { badY });
  ok(badDry === 0, 'water: no vertex over terrain above the water level', { badDry });
}
// upward winding on every triangle
{
  let down = 0;
  const P = d.positions, I = d.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 2] - P[a + 2]];
    const ny = e1[1] * e2[0] - e1[0] * e2[1];
    if (!(ny > 0)) down++;
  }
  ok(down === 0, 'water: every triangle faces upward', { down, tris: I.length / 3 });
}
// depth colours: shoreline pale/translucent, basin deep/opaque
{
  let alphaRange = true, sawShallow = false, sawDeep = false;
  for (let i = 0; i < d.colors.length; i += 4) {
    const a = d.colors[i + 3];
    if (!(a >= 0.5 && a <= 0.92)) alphaRange = false;
    if (a < 0.6) sawShallow = true;
    if (a > 0.8) sawDeep = true;
  }
  ok(alphaRange && sawShallow && sawDeep, 'water: vertex alpha spans shallow->deep across the lake', { alphaRange, sawShallow, sawDeep });
}
// determinism: regeneration is bit-identical (evict + return)
{
  const d2 = waterChunkData(lcx, lcz);
  const same = d.positions.length === d2.positions.length && d.indices.length === d2.indices.length
    && d.positions.every((v, i) => v === d2.positions[i]) && d.indices.every((v, i) => v === d2.indices[i]);
  ok(same, 'water: regenerating a chunk produces identical geometry');
}
// border matching: vertices on a shared chunk edge agree
{
  const edgeVerts = (data, wx, axis) => {
    const s = new Set();
    for (let i = 0; i < data.positions.length; i += 3) {
      const x = data.positions[i], z = data.positions[i + 2];
      if (Math.abs((axis === 'x' ? x : z) - wx) < 1e-6) s.add(x.toFixed(4) + ',' + z.toFixed(4));
    }
    return s;
  };
  // find a wet east neighbour of some wet chunk around the lake
  let checked = 0, mismatched = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const a = waterChunkData(lcx + dx, lcz + dz), b = waterChunkData(lcx + dx + 1, lcz + dz);
    if (!a || !b) continue;
    const borderX = (lcx + dx + 1) * 55;
    const sa = edgeVerts(a, borderX, 'x'), sb = edgeVerts(b, borderX, 'x');
    if (!sa.size || !sb.size) continue;
    checked++;
    for (const v of sa) if (!sb.has(v)) mismatched++;
    for (const v of sb) if (!sa.has(v)) mismatched++;
  }
  ok(checked > 0 && mismatched === 0, 'water: neighbouring chunks share identical border vertices (no shoreline gaps)', { checked, mismatched });
}
// dry land produces nothing: the overlook chunk is high and dry
{
  const over = landmarks().find((l) => l.kind === 'overlook');
  const od = waterChunkData(Math.floor(over.x / 55), Math.floor(over.z / 55));
  ok(od === null, 'water: dry high chunk produces no water geometry');
}
// a mostly-dry chunk with a dip: water covers only a fraction
{
  let partial = null;
  for (let dx = -4; dx <= 4 && !partial; dx++) for (let dz = -4; dz <= 4; dz++) {
    const dd = waterChunkData(lcx + dx, lcz + dz);
    if (dd && dd.indices.length < 300) partial = dd; // a full 20x20 all-in chunk has 800 tris = 2400 indices
  }
  ok(!!partial, 'water: shoreline chunks produce partial coverage, not whole-chunk planes', partial ? { tris: partial.indices.length / 3 } : null);
}
// wiring: pond + falls survive in the client (client-only visuals)
{
  const client = fs.readFileSync(new URL('../client3d.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../world3d.js', import.meta.url), 'utf8');
  ok(client.includes('CircleGeometry(13, 36)') && client.includes('118, 0.04, 12'), 'water wiring: town pond disc intact');
  ok(client.includes("from './watermesh.js'") && server.includes("'/world3d/watermesh.js'"), 'water wiring: client imports watermesh + server serves it');
  ok(client.includes("from './voiceutil.js'") && server.includes("'/world3d/voiceutil.js'"), 'voice wiring: client imports voiceutil + server serves it');
}

console.log(`WATER RESULT: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
