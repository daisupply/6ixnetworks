/* Horizon regression tests: far-range winding/seam/radii
 * (farrange.js) and the per-species near-upgrade state machine
 * (nearveg.js). Both modules are the exact code the client
 * imports — no copies. Run: node world3d/tests/horizon.test.mjs */
import { farRangeData, FAR_NA, FAR_NR, FAR_RIN, FAR_ROUT } from '../farrange.js';
import { NearUpgrader } from '../nearveg.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

/* ---------- far range geometry ---------- */
{
  const { positions, indices, NA, NR } = farRangeData();
  ok(positions.length === (NA + 1) * (NR + 1) * 3 && indices.length === NA * NR * 6, 'farrange: vertex/index counts match the grid', { v: positions.length, i: indices.length });
  let finite = true;
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) { finite = false; break; }
  ok(finite, 'farrange: all positions finite');
  // every triangle's geometric normal must face UP (ny > 0):
  // the v593 winding faced all 10,368 triangles down and the
  // FrontSide material culled the range from every viewpoint.
  let down = 0, nonFinite = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const e1 = [positions[b * 3] - ax, positions[b * 3 + 1] - ay, positions[b * 3 + 2] - az];
    const e2 = [positions[c * 3] - ax, positions[c * 3 + 1] - ay, positions[c * 3 + 2] - az];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    if (!Number.isFinite(ny)) nonFinite++;
    else if (ny <= 0) down++;
  }
  ok(nonFinite === 0, 'farrange: all triangle normals finite', { nonFinite });
  ok(down === 0, 'farrange: every triangle normal faces upward', { down, total: indices.length / 3 });
  // angular seam: column 0 and column NA are the same world point
  let seamBad = 0;
  for (let j = 0; j <= NR; j++) {
    const i0 = (j * (NA + 1)) * 3, i1 = (j * (NA + 1) + NA) * 3;
    for (let k = 0; k < 3; k++) if (positions[i0 + k] !== positions[i1 + k]) seamBad++;
  }
  ok(seamBad === 0, 'farrange: angular seam vertices identical (closed ring)', { seamBad });
  let rMin = Infinity, rMax = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 2]);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
  }
  ok(Math.abs(rMin - FAR_RIN) < 0.01 && Math.abs(rMax - FAR_ROUT) < 0.01, 'farrange: inner/outer radii exact (1030/1980 — beyond the 990 world edge)', { rMin, rMax });
  // wiring regression (the v588 class: a client module that is
  // imported but not served kills the whole world boot)
  const client = fs.readFileSync(new URL('../client3d.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../world3d.js', import.meta.url), 'utf8');
  ok(client.includes("from './farrange.js'") && client.includes("from './nearveg.js'"), 'wiring: client imports farrange + nearveg');
  ok(server.includes("'/world3d/farrange.js'") && server.includes("'/world3d/nearveg.js'"), 'wiring: server serves farrange + nearveg routes');
}

/* ---------- near-upgrade state machine ---------- */
function rig(loadFn) {
  const calls = { load: [], create: [], lodVis: new Map(), groupVis: null };
  const up = new NearUpgrader({
    load: async (n) => { calls.load.push(n); return loadFn(n); },
    create: (n) => { calls.create.push(n); },
    setLodVisible: (n, v) => { calls.lodVis.set(n, v); },
    setGroupVisible: (v) => { calls.groupVis = v; },
  });
  return { up, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

{ // success: both species upgrade, both LODs hide
  const { up, calls } = rig(() => [{ fake: 'parts' }]);
  await up.upgrade(['A', 'B']);
  ok(up.state === 'near' && calls.create.join() === 'A,B' && calls.lodVis.get('A') === false && calls.lodVis.get('B') === false && calls.groupVis === true,
    'nearveg: successful load upgrades both species and hides their LODs', { state: up.state, create: calls.create });
}
{ // THE v593 BUG: one species fails — its LOD must stay visible
  const { up, calls } = rig((n) => (n === 'B' ? null : [{ fake: 'parts' }]));
  await up.upgrade(['A', 'B']);
  ok(up.state === 'near' && calls.create.join() === 'A' && calls.lodVis.get('A') === false && calls.lodVis.get('B') === true && calls.groupVis === true,
    'nearveg: failed species keeps its LOD visible; the other still upgrades', { state: up.state, create: calls.create, bVis: calls.lodVis.get('B') });
}
{ // all fail: nothing hides, chunk stays fully LOD
  const { up, calls } = rig(() => null);
  await up.upgrade(['A', 'B']);
  ok(up.state === 'lod' && calls.create.length === 0 && calls.lodVis.get('A') === true && calls.lodVis.get('B') === true && calls.groupVis === false,
    'nearveg: all species failing leaves the chunk fully on LOD', { state: up.state });
}
{ // threshold re-crossing: no duplicate creates, no reloads of built species
  const { up, calls } = rig(() => [{ fake: 'parts' }]);
  await up.upgrade(['A', 'B']);
  up.downgrade(['A', 'B']);
  ok(up.state === 'lod' && calls.groupVis === false && calls.lodVis.get('A') === true, 'nearveg: downgrade restores LOD + hides near group');
  await up.upgrade(['A', 'B']);
  ok(up.state === 'near' && calls.create.length === 2 && calls.load.length === 2,
    'nearveg: re-crossing thresholds does not duplicate meshes or reload built species', { create: calls.create.length, load: calls.load.length });
}
{ // eviction mid-load: late completions apply nothing
  let resolveLoad;
  const { up, calls } = rig(() => new Promise((r) => { resolveLoad = r; }));
  const p = up.upgrade(['A']);
  await tick();
  up.invalidate(); // chunk evicted while the load is in flight
  resolveLoad([{ fake: 'parts' }]);
  await p;
  ok(up.state === 'lod' && calls.create.length === 0 && calls.groupVis !== true,
    'nearveg: eviction during load — no stale meshes created', { state: up.state, create: calls.create.length });
}
{ // downgrade mid-load aborts; a later upgrade still works, creating once
  let resolveLoad;
  let first = true;
  const { up, calls } = rig(() => { if (first) return new Promise((r) => { resolveLoad = r; }); return [{ fake: 'parts' }]; });
  const p = up.upgrade(['A']);
  await tick();
  up.downgrade(['A']);
  resolveLoad([{ fake: 'parts' }]);
  await p;
  ok(calls.create.length === 0 && up.state === 'lod', 'nearveg: downgrade during load aborts the stale completion', { create: calls.create.length });
  first = false;
  await up.upgrade(['A']);
  ok(up.state === 'near' && calls.create.length === 1, 'nearveg: upgrade after an aborted one creates exactly once', { create: calls.create.length });
}
{ // revisit after eviction: a fresh upgrader (new chunk entry) rebuilds correctly
  const { up, calls } = rig(() => [{ fake: 'parts' }]);
  await up.upgrade(['A', 'B']);
  ok(up.state === 'near' && calls.create.length === 2, 'nearveg: revisited chunk upgrades correctly', { state: up.state });
}
{ // failed species retries next approach; built species not re-created
  let bFails = true;
  const { up, calls } = rig((n) => (n === 'B' && bFails ? null : [{ fake: 'parts' }]));
  await up.upgrade(['A', 'B']);
  up.downgrade(['A', 'B']);
  bFails = false;
  await up.upgrade(['A', 'B']);
  const aCreates = calls.create.filter((n) => n === 'A').length;
  const bCreates = calls.create.filter((n) => n === 'B').length;
  ok(up.state === 'near' && aCreates === 1 && bCreates === 1 && calls.lodVis.get('B') === false,
    'nearveg: previously failed species retries and upgrades; built species untouched', { aCreates, bCreates });
}

console.log(`HORIZON RESULT: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
