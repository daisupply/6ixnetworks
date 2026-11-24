/* Voice reliability tests — the real voiceutil.js with mocked
 * candidate application (no real WebRTC in Node; the browser
 * two-session test is reported separately and never conflated
 * with these). Run: node world3d/tests/voice.test.mjs */
import { IceBuffer, nextRetryDelay, voiceUiState, ESTABLISH_TIMEOUT_MS } from '../voiceutil.js';

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

/* IceBuffer: the signaling-order contract */
{
  const applied = [];
  const ib = new IceBuffer((c) => applied.push(c.id));
  ib.add({ id: 1 }); ib.add({ id: 2 });
  ok(applied.length === 0, 'ice: candidates before the remote description are buffered, not applied');
  ib.setReady();
  ok(applied.join() === '1,2', 'ice: buffered candidates flush IN ORDER once the remote description lands', { applied });
  ib.add({ id: 3 });
  ok(applied.join() === '1,2,3', 'ice: candidates after ready apply immediately');
  ib.add({ id: 2 });
  ok(applied.join() === '1,2,3', 'ice: a re-delivered duplicate candidate is dropped');
  ib.add({ id: 1 });
  ok(applied.length === 3, 'ice: duplicates of already-applied candidates are dropped too');
}
{
  const applied = [];
  const ib = new IceBuffer((c) => applied.push(c.id));
  ib.add({ id: 1 });
  ib.close();
  ib.setReady();
  ib.add({ id: 2 });
  ok(applied.length === 0, 'ice: nothing is applied after the peer closes (stale callbacks are inert)');
}
{
  const applied = [];
  const ib = new IceBuffer((c) => { if (c.id === 2) throw new Error('bad candidate'); applied.push(c.id); });
  ib.add({ id: 1 }); ib.add({ id: 2 }); ib.add({ id: 3 });
  ib.setReady();
  ok(applied.join() === '1,3', 'ice: one throwing candidate does not kill the rest of the queue', { applied });
}

/* backoff */
ok(nextRetryDelay(1) === 5000 && nextRetryDelay(2) === 10000 && nextRetryDelay(6) === 30000 && nextRetryDelay(99) === 30000,
  'backoff: 5s per failure, capped at 30s', { d1: nextRetryDelay(1), d6: nextRetryDelay(6) });
ok(ESTABLISH_TIMEOUT_MS >= 8000 && ESTABLISH_TIMEOUT_MS <= 20000, 'watchdog: establishment timeout is a sane bound', { ESTABLISH_TIMEOUT_MS });

/* UI state derivation — the pill must reflect reality */
const S = (o) => voiceUiState(Object.assign({ on: false, pending: false, hasStream: true, muted: false, peerStates: [], anyFail: false }, o));
ok(S({}) === 'off', 'ui: voice off reads off');
ok(S({ pending: true }) === 'requesting', 'ui: pending mic request reads requesting (not live)');
ok(S({ on: true, hasStream: false }) === 'listen', 'ui: denied/missing mic reads listen-only');
ok(S({ on: true, hasStream: false, peerStates: ['connected'] }) === 'listen', 'ui: listen-only outranks a connected peer (mic problem is not hidden)');
ok(S({ on: true, muted: true, peerStates: ['connected'] }) === 'muted', 'ui: muted outranks connected');
ok(S({ on: true, peerStates: ['connected'] }) === 'live', 'ui: a connected peer reads live');
ok(S({ on: true, peerStates: ['new', 'connecting'] }) === 'connecting', 'ui: peers in flight read connecting');
ok(S({ on: true, peerStates: ['disconnected'] }) === 'reconnecting', 'ui: a disconnected peer reads reconnecting');
ok(S({ on: true, peerStates: [], anyFail: true }) === 'failed', 'ui: failures with no live peer read failed (not live)');
ok(S({ on: true, peerStates: [] }) === 'live', 'ui: on + mic + nobody nearby reads live (ready)');

console.log(`VOICE RESULT: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
