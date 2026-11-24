/* Voice-chat reliability helpers — pure, no DOM/WebRTC
 * imports, unit-tested in tests/voice.test.mjs with mocked
 * candidate application. The client wires these into its
 * vc* functions; the logic that used to be inline and
 * untestable (ICE buffering, retry backoff, UI state
 * derivation, establishment timeout) lives here. */

/* ICE candidates that arrive before the remote description is
 * set must be buffered and applied IN ORDER once it is; a
 * candidate must never be applied twice (re-drained mailboxes
 * re-deliver), and nothing may be applied after close. */
export class IceBuffer {
  constructor(apply) {
    this.apply = apply;   // (candidate) => void, may throw — contained
    this.q = [];
    this.ready = false;
    this.closed = false;
    this.seen = new Set();
  }
  add(c) {
    if (this.closed || !c) return false;
    const key = typeof c === 'string' ? c : JSON.stringify(c);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.ready) this.deliver(c);
    else this.q.push(c);
    return true;
  }
  deliver(c) {
    try { const r = this.apply(c); if (r && r.catch) r.catch(() => { }); } catch (e) { /* a bad candidate must not kill the queue */ }
  }
  setReady() {
    if (this.closed || this.ready) return;
    this.ready = true;
    const q = this.q; this.q = [];
    for (const c of q) this.deliver(c);
  }
  close() { this.closed = true; this.q = []; }
}

/* failure backoff: 5s per consecutive failure, capped 30s —
 * the formula vcNoteFail3 always used, now shared + tested. */
export function nextRetryDelay(fails) {
  return Math.min(30000, 5000 * Math.max(1, fails | 0));
}

/* a peer that has not reached 'connected' within this window
 * is treated as failed (signaling loss used to leave peers in
 * 'new' forever — no state ever fired to retry them). */
export const ESTABLISH_TIMEOUT_MS = 12000;

/* Derive the ONE voice UI state from real system state.
 * s: { on, pending, hasStream, muted, peerStates: string[],
 *      anyFail } — peerStates are RTCPeerConnection
 * connectionState values of live peers. Priority: an actually
 * connected peer outranks transitional states; a microphone
 * problem outranks peer states (listen-only is not a failure
 * of the network). */
export function voiceUiState(s) {
  if (s.pending) return 'requesting';
  if (!s.on) return 'off';
  if (!s.hasStream) return 'listen';
  if (s.muted) return 'muted';
  const ps = s.peerStates || [];
  if (ps.includes('connected')) return 'live';
  if (ps.includes('disconnected')) return 'reconnecting';
  if (ps.length) return 'connecting';
  if (s.anyFail) return 'failed';
  return 'live'; // on, mic live, nobody nearby — ready
}
