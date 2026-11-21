// server.test.mjs — 3D world server contract tests: asset routes + MIME
// types, page structure, auth, the initial handshake, session-takeover
// semantics, leave, unknown routes.
// run against a LOCAL test server (never production):
//   W3_BASE=http://127.0.0.1:18097 node world3d/tests/server.test.mjs
// the test signs up throwaway accounts through the real PoW flow.
import { createHash } from 'node:crypto';

const B = process.env.W3_BASE || 'http://127.0.0.1:18097';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('PASS', label); } else { fail++; console.log('FAIL', label, extra !== undefined ? JSON.stringify(extra).slice(0, 200) : ''); } };

async function raw(method, path, headers, body) {
  const r = await fetch(B + path, { method, headers: { ...UA, ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { }
  return { status: r.status, type: r.headers.get('content-type') || '', text, j, setCookie: r.headers.get('set-cookie') || '' };
}
const lzb = (buf) => { let z = 0; for (const byte of buf) { if (byte === 0) { z += 8; continue; } for (let k = 7; k >= 0; k--) { if ((byte >> k) & 1) return z; z++; } } return z; };
async function signup(user) {
  const ch = await raw('GET', '/auth/challenge', { cookie: 'six_in=1' });
  const c = ch.j && ch.j.c; let n = 0;
  for (; ; n++) { if (lzb(createHash('sha256').update(c + ':' + n).digest()) >= 15) break; }
  const r = await raw('POST', '/auth/signup', { 'content-type': 'application/json', cookie: 'six_in=1' }, { user, pass: 'probe-pass-123', pow: { c, n }, hp: '' });
  const sess = (r.setCookie.match(/six_sess=([^;]+)/) || [])[1];
  if (!r.j || !r.j.ok || !sess) throw new Error('signup failed: ' + JSON.stringify(r.j));
  return { cookie: 'six_in=1; six_sess=' + sess, json: { 'content-type': 'application/json', cookie: 'six_in=1; six_sess=' + sess } };
}
const ping = (S, body) => raw('POST', '/api/world3d/ping', S.json, body);

/* ---- asset routes + MIME types ---- */
{
  const page = await raw('GET', '/world3d', { cookie: 'six_in=1' });
  ok(page.status === 200 && page.type.includes('text/html'), 'route: /world3d is 200 text/html', { status: page.status, type: page.type });
  ok(page.text.includes('.w3load-card{') && page.text.includes('#w3load{'), 'page: critical loader CSS is inlined in the HTML');
  ok(page.text.includes('<script>(function () {'), 'page: NOTIF_JS is wrapped in a <script> tag (raw-code regression)');
  ok(page.text.includes('id="w3conflict"'), 'page: session-conflict card markup present');
  ok(page.text.includes('importmap'), 'page: importmap present');
  const client = await raw('GET', '/world3d/client3d.js', { cookie: 'six_in=1' });
  ok(client.status === 200 && client.type.includes('javascript'), 'route: client3d.js served as javascript', { type: client.type });
  const math = await raw('GET', '/world3d/math3d.js', { cookie: 'six_in=1' });
  ok(math.status === 200 && math.type.includes('javascript') && math.text.includes('export function moveVec'), 'route: math3d.js served as javascript with the shared math', { type: math.type });
  const css = await raw('GET', '/world3d/world3d.css', { cookie: 'six_in=1' });
  ok(css.status === 200 && css.type.includes('text/css'), 'route: world3d.css served as text/css', { type: css.type });
  const three = await raw('GET', '/world3d/vendor/three.module.min.js', { cookie: 'six_in=1' });
  ok(three.status === 200 && three.type.includes('javascript') && three.text.length > 500000, 'route: vendored three.js served as javascript', { type: three.type, len: three.text.length });
  const missing = await raw('GET', '/world3d/nope.js', { cookie: 'six_in=1' });
  ok(missing.status === 404 || !missing.type.includes('javascript') || missing.text.length < 1000, 'route: unknown asset does not serve the engine or an HTML fallback as JS', { status: missing.status });
}

/* ---- auth + handshake contract ---- */
{
  const noauth = await raw('POST', '/api/world3d/ping', { 'content-type': 'application/json', cookie: 'six_in=1' }, { x: 0, z: 18, sid: 'x1' });
  ok(noauth.status === 401 && noauth.j && noauth.j.ok === false && noauth.j.err === 'login first', 'handshake: unauthenticated ping is 401 ok:false login first', noauth);
}

const user = 'w3srv' + Date.now().toString(36).slice(-5);
const S = await signup(user);
{
  const unknown = await raw('POST', '/api/world3d/bogus', S.json, {});
  ok(unknown.status === 404 && unknown.j && unknown.j.ok === false, 'handshake: unknown api route is 404 for an authed user (auth runs first, hence 401 when logged out)', unknown.status);
  const hs = await ping(S, { x: 0, z: 18, ry: 3.14, sid: 'sidA' });
  ok(hs.status === 200 && hs.j && hs.j.ok === true, 'handshake: authenticated ping returns ok:true', hs.j);
  ok(hs.j && hs.j.me === user && typeof hs.j.bal === 'number' && hs.j.portal && hs.j.portal.x === 22, 'handshake: response carries me, numeric balance, portal position');
  ok(hs.j && Array.isArray(hs.j.roster), 'handshake: roster is an array');
}

/* ---- session takeover semantics (the contract the client freeze relies on) ---- */
{
  const mv = await ping(S, { x: 1, z: 17, ry: 3, sid: 'sidA' });
  ok(mv.j && mv.j.ok === true, 'takeover: owning sid can move');
  const steal = await ping(S, { x: 9, z: 9, ry: 0, sid: 'sidB' });
  ok(steal.j && steal.j.ok === false && steal.j.err === 'session taken over', 'takeover: second sid MOVEMENT is rejected as session taken over', steal.j);
  const after = await ping(S, { sid: 'sidA' });
  ok(after.j && after.j.ok === true && Math.abs(after.j.x - 1) < 0.01 && Math.abs(after.j.z - 17) < 0.01, 'takeover: rejected movement did not move the entry', after.j);
  const claim = await ping(S, { sid: 'sidB' }); // position-less: ownership transfers
  ok(claim.j && claim.j.ok === true, 'takeover: position-less ping transfers the session (reclaim path)');
  const oldNow = await ping(S, { x: 5, z: 5, ry: 0, sid: 'sidA' });
  ok(oldNow.j && oldNow.j.ok === false && oldNow.j.err === 'session taken over', 'takeover: the previous sid is now the stale one');
  const lv = await raw('POST', '/api/world3d/leave', S.json, {});
  ok(lv.j && lv.j.ok === true, 'leave: ok');
  const fresh = await ping(S, { x: 0, z: 18, ry: 3.14, sid: 'sidC' });
  ok(fresh.j && fresh.j.ok === true && fresh.j.x === 0 && fresh.j.z === 18, 'leave: next ping respawns clean at spawn');
}

console.log('SERVER RESULT: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
