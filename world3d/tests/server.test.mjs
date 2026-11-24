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


/* ---- v543: zones, door warps, roster zoning, sit, buy ---- */
{
  const userA = 'w3zone' + Math.random().toString(36).slice(2, 7);
  const userB = 'w3town' + Math.random().toString(36).slice(2, 7);
  const A = await signup(userA);
  const B = await signup(userB);
  const sidA = { sid: 'za' + Math.random().toString(36).slice(2, 10) };
  const sidB = { sid: 'zb' + Math.random().toString(36).slice(2, 10) };
  await ping(A, { x: 0, z: 18, ry: 0, ...sidA });
  await ping(B, { x: 2, z: 16, ry: 0, ...sidB });
  // buy: unauthenticated, unknown item, insufficient funds
  const noauth = await raw('POST', '/api/world3d/buy', { 'content-type': 'application/json' }, { item: 'mocha' });
  ok(noauth.status === 401, 'buy: unauthenticated rejected', noauth.status);
  const unk = await raw('POST', '/api/world3d/buy', A.json, { item: 'rocket' });
  ok(unk.j && unk.j.ok === false, 'buy: unknown item refused');
  const poor = await raw('POST', '/api/world3d/buy', A.json, { item: 'mocha' });
  ok(poor.j && poor.j.ok === false && /not enough/.test(poor.j.err || '') && poor.j.bal === 0, 'buy: insufficient funds refused server-side, balance untouched', poor.j);
  // warp from spawn (not at a door) must be refused
  const w0 = await ping(A, { x: 2000, z: 5.5, ry: 0, warp: true, ...sidA });
  ok(w0.j && w0.j.x === 0 && w0.j.zone === 'town', 'warp: refused when not standing at a door', w0.j && { x: w0.j.x, zone: w0.j.zone });
  // walk A to the coffee shop door in legal steps
  const stepTo = async (S, sid, tx, tz) => {
    let cx = (await ping(S, { ...sid })).j, px2 = cx.x, pz2 = cx.z;
    for (let i = 0; i < 24; i++) {
      const dx = tx - px2, dz = tz - pz2, d = Math.hypot(dx, dz);
      if (d < 0.6) break;
      const st = Math.min(9, d);
      const r = await ping(S, { x: Math.round((px2 + dx / d * st) * 10) / 10, z: Math.round((pz2 + dz / d * st) * 10) / 10, ry: 0, ...sid });
      px2 = r.j.x; pz2 = r.j.z;
    }
    return { x: px2, z: pz2 };
  };
  const atDoor = await stepTo(A, sidA, -28.6, -35.0);
  ok(Math.hypot(atDoor.x + 28.6, atDoor.z + 35) < 1.6, 'walk: reached the coffee shop door legally', atDoor);
  const w1 = await ping(A, { x: 2000, z: 5.5, ry: 3.14, warp: true, ...sidA });
  ok(w1.j && w1.j.x === 2000 && w1.j.zone === 'coffee', 'warp: door warp lands inside the cafe', w1.j && { x: w1.j.x, zone: w1.j.zone });
  // roster zoning both ways
  const ra = await ping(A, { ...sidA });
  ok(ra.j && !ra.j.roster.some((e) => e.u === userB), 'roster: cafe player does not see town players');
  const rb = await ping(B, { ...sidB });
  ok(rb.j && !rb.j.roster.some((e) => e.u === userA), 'roster: town player does not see cafe players');
  // movement inside the cafe works; walking out of the zone does not
  const mv = await ping(A, { x: 2000, z: 2, ry: 0, ...sidA });
  ok(mv.j && mv.j.z === 2 && mv.j.zone === 'coffee', 'move: walking inside the cafe accepted');
  const out = await ping(A, { x: 1980, z: 0, ry: 0, ...sidA });
  ok(out.j && out.j.x >= 1989, 'move: cross-zone walk refused (position held)', out.j && out.j.x);
  // B comes in too; sit flag passes through to A's roster
  await stepTo(B, sidB, -28.6, -35.0);
  await ping(B, { x: 2000, z: 5.5, ry: 3.14, warp: true, ...sidB });
  await ping(B, { x: 1995.95, z: 1, ry: 1.57, sit: 1, ...sidB });
  const ra2 = await ping(A, { ...sidA });
  const bEntry = ra2.j && ra2.j.roster.find((e) => e.u === userB);
  ok(!!bEntry && bEntry.sit === 1, 'roster: seated flag passes through inside the cafe', bEntry);
  // warp back out
  await ping(A, { x: 2000, z: 5.5, ry: 3.14, ...sidA });
  const w2 = await ping(A, { x: -28.6, z: -35, ry: 0, warp: true, ...sidA });
  ok(w2.j && w2.j.x === -28.6 && w2.j.zone === 'town', 'warp: exit warp returns to the town door', w2.j && { x: w2.j.x, zone: w2.j.zone });
}

/* ---- v544: cosmetics endpoints + arcade/clothing warps ---- */
{
  const cos = (S, body) => raw('POST', '/api/world3d/cos', S.json, body);
  const noauth = await raw('POST', '/api/world3d/cos', { 'content-type': 'application/json', cookie: 'six_in=1' }, { action: 'wear', slot: 'hat', id: 'none' });
  ok(noauth.status === 401, 'cos: unauthenticated is 401', noauth.status);
  const userC = 'w3cos' + Date.now().toString(36).slice(-5);
  const C = await signup(userC);
  const sidC = { sid: 'cos1' };
  const p0 = await ping(C, { x: 0, z: 18, ry: 0, ...sidC });
  ok(p0.j && p0.j.cos && Array.isArray(p0.j.cos.own) && p0.j.cos.own.length === 0 && p0.j.cos.wear.hat === 'none' && p0.j.cos.wear.hair === 'crest' && p0.j.cos.wear.acc === 'none', 'cos: ping carries default cosmetics', p0.j && p0.j.cos);
  const unk = await cos(C, { action: 'buy', id: 'nope' });
  ok(unk.status === 400 && unk.j && unk.j.err === 'unknown item', 'cos: buying an unknown item is 400', unk.j);
  const poor = await cos(C, { action: 'buy', id: 'shades' });
  ok(poor.j && poor.j.ok === false && poor.j.err === 'not enough six cents' && poor.j.bal === 0, 'cos: buying at 0 balance refused, balance untouched', poor.j);
  const unowned = await cos(C, { action: 'wear', slot: 'hat', id: 'crown' });
  ok(unowned.j && unowned.j.ok === false && /do not own/.test(unowned.j.err || ''), 'cos: wearing an unowned item refused', unowned.j);
  const wrongSlot = await cos(C, { action: 'wear', slot: 'hat', id: 'shades' });
  ok(wrongSlot.status === 400, 'cos: wearing an item in the wrong slot is 400', wrongSlot.j);
  const free = await cos(C, { action: 'wear', slot: 'hat', id: 'none' });
  ok(free.j && free.j.ok === true, 'cos: free default wear ok', free.j);
  const hueOk = await cos(C, { action: 'wear', slot: 'hue', id: 200 });
  ok(hueOk.j && hueOk.j.ok === true && hueOk.j.cos.hue === 200, 'cos: hue set ok and echoed', hueOk.j);
  const hueBad = await cos(C, { action: 'wear', slot: 'hue', id: 999 });
  ok(hueBad.status === 400, 'cos: hue out of range is 400', hueBad.j);
  const badAction = await cos(C, { action: 'dance' });
  ok(badAction.status === 400, 'cos: unknown action is 400', badAction.j);
  // arcade + clothing warps use the same validated door mechanic
  const stepTo2 = async (S, sid, tx, tz) => {
    let cur = await ping(S, { ...sid });
    let x = cur.j.x, z = cur.j.z;
    for (let i = 0; i < 60; i++) {
      const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
      if (d < 1.2) break;
      const step = Math.min(9, d);
      x += (dx / d) * step; z += (dz / d) * step;
      cur = await ping(S, { x, z, ry: 0, ...sid });
      x = cur.j.x; z = cur.j.z;
    }
    return cur.j;
  };
  await stepTo2(C, sidC, -62, -42.8);
  const wa = await ping(C, { x: 2040, z: 5.5, ry: 3.14, warp: true, ...sidC });
  ok(wa.j && wa.j.x === 2040 && wa.j.zone === 'arcade', 'warp: arcade door lands inside the arcade', wa.j && { x: wa.j.x, zone: wa.j.zone });
  const mvA = await ping(C, { x: 2040, z: 0, ry: 0, ...sidC });
  ok(mvA.j && mvA.j.z === 0 && mvA.j.zone === 'arcade', 'move: walking inside the arcade accepted');
  const outA = await ping(C, { x: 2040, z: 5.5, ry: 3.14, ...sidC });
  const backA = await ping(C, { x: -62, z: -42.8, ry: 0, warp: true, ...sidC });
  ok(backA.j && backA.j.zone === 'town', 'warp: arcade exit returns to town', backA.j && backA.j.zone);
  await stepTo2(C, sidC, 43.4, -35.0);
  const wc = await ping(C, { x: 2080, z: 5.5, ry: 3.14, warp: true, ...sidC });
  ok(wc.j && wc.j.x === 2080 && wc.j.zone === 'clothing', 'warp: clothing door lands inside the store', wc.j && { x: wc.j.x, zone: wc.j.zone });
  // roster carries wear: a second player in clothing sees C's wear object
  const D = await signup('w3cosb' + Date.now().toString(36).slice(-5));
  const sidD = { sid: 'cos2' };
  await ping(D, { x: 0, z: 18, ry: 0, ...sidD });
  await stepTo2(D, sidD, 43.4, -35.0);
  await ping(D, { x: 2080, z: 5.5, ry: 3.14, warp: true, ...sidD });
  const rd = await ping(D, { ...sidD });
  const cEntry = rd.j && rd.j.roster.find((e) => e.u === userC);
  ok(!!cEntry && !!cEntry.wear && cEntry.wear.hair === 'crest', 'roster: entries carry the wear object', cEntry);
}

/* ---- v545: shards, trivia, apartment decor + solo roster, new warps ---- */
{
  const E = await signup('w3x5' + Date.now().toString(36).slice(-5));
  const sidE = { sid: 'x51' };
  const stepTo3 = async (S, sid, tx, tz) => {
    let cur = await ping(S, { ...sid });
    let x = cur.j.x, z = cur.j.z;
    for (let i = 0; i < 80; i++) {
      const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
      if (d < 1.2) break;
      const step = Math.min(9, d);
      x += (dx / d) * step; z += (dz / d) * step;
      cur = await ping(S, { x, z, ry: 0, ...sid });
      x = cur.j.x; z = cur.j.z;
    }
    return cur.j;
  };
  await ping(E, { x: 0, z: 18, ry: 0, ...sidE });
  // shards: too far, then close, then duplicate
  const far = await raw('POST', '/api/world3d/shard', E.json, { id: 's1' });
  ok(far.j && far.j.ok === false && /close/.test(far.j.err || ''), 'shard: claiming from spawn refused (not close)', far.j);
  const unk = await raw('POST', '/api/world3d/shard', E.json, { id: 's99' });
  ok(unk.status === 400, 'shard: unknown id is 400', unk.j);
  await stepTo3(E, sidE, 6, -6);
  const got = await raw('POST', '/api/world3d/shard', E.json, { id: 's1' });
  ok(got.j && got.j.ok === true && got.j.shards === 1 && got.j.bal === 5, 'shard: pickup pays 5 and counts 1', got.j);
  const dup = await raw('POST', '/api/world3d/shard', E.json, { id: 's1' });
  ok(dup.j && dup.j.ok === false && /already/.test(dup.j.err || ''), 'shard: second claim refused', dup.j);
  // trivia: get leaks no answer; wrong then right; repeat pays 0
  const tq = await raw('POST', '/api/world3d/trivia', E.json, { action: 'get' });
  ok(tq.j && tq.j.ok === true && typeof tq.j.q === 'string' && Array.isArray(tq.j.choices) && tq.j.choices.length === 3 && tq.j.c === undefined, 'trivia: question served without the answer', tq.j);
  let paid = null, sawWrong = false;
  for (let choice = 0; choice < 3; choice++) {
    const ans = await raw('POST', '/api/world3d/trivia', E.json, { action: 'answer', qid: tq.j.qid, choice });
    if (ans.j && ans.j.correct === false) sawWrong = true;
    if (ans.j && ans.j.correct === true) { paid = ans.j; break; }
  }
  ok(sawWrong, 'trivia: a wrong choice reports correct:false');
  ok(!!paid && paid.paid === 10 && paid.left === 2, 'trivia: correct answer pays 10, 2 left', paid);
  // repeat check: answer the same qid with every choice; none may pay again
  let repPaid = 0;
  for (let choice = 0; choice < 3; choice++) {
    const ans = await raw('POST', '/api/world3d/trivia', E.json, { action: 'answer', qid: tq.j.qid, choice });
    if (ans.j && ans.j.paid) repPaid += ans.j.paid;
  }
  ok(repPaid === 0, 'trivia: re-answering the same question pays nothing');
  // apartment decor validation + persistence in ping cos
  const badRug = await raw('POST', '/api/world3d/apt', E.json, { rug: 5 });
  ok(badRug.status === 400, 'apt: rug out of range is 400', badRug.j);
  const setRug = await raw('POST', '/api/world3d/apt', E.json, { rug: 2, poster: 1 });
  ok(setRug.j && setRug.j.ok === true && setRug.j.apt.rug === 2 && setRug.j.apt.poster === 1, 'apt: decor set ok', setRug.j);
  const pe = await ping(E, { ...sidE });
  ok(pe.j && pe.j.cos.apt.rug === 2 && pe.j.cos.shards.length === 1, 'apt+shard: ping cos reflects decor and shards', pe.j && pe.j.cos);
  // library + rec warps
  await stepTo3(E, sidE, 58, -44.8);
  const wl = await ping(E, { x: 2120, z: 5.5, ry: 3.14, warp: true, ...sidE });
  ok(wl.j && wl.j.zone === 'library', 'warp: library door lands inside', wl.j && wl.j.zone);
  await ping(E, { x: 2120, z: 5.5, ry: 3.14, ...sidE });
  const bl = await ping(E, { x: 58, z: -44.8, ry: 0, warp: true, ...sidE });
  ok(bl.j && bl.j.zone === 'town', 'warp: library exit returns to town', bl.j && bl.j.zone);
  await stepTo3(E, sidE, 62, 40.3);
  const wr = await ping(E, { x: 2160, z: 5.5, ry: 3.14, warp: true, ...sidE });
  ok(wr.j && wr.j.zone === 'rec', 'warp: rec center door lands inside', wr.j && wr.j.zone);
  await ping(E, { x: 2160, z: 5.5, ry: 3.14, ...sidE });
  await ping(E, { x: 62, z: 40.3, ry: 0, warp: true, ...sidE });
  // apartment: solo instance — two players inside, neither sees the other
  const F = await signup('w3x5b' + Date.now().toString(36).slice(-5));
  const sidF = { sid: 'x52' };
  await ping(F, { x: 0, z: 18, ry: 0, ...sidF });
  await stepTo3(E, sidE, -64, 38.3);
  await ping(E, { x: 2200, z: 5.5, ry: 3.14, warp: true, ...sidE });
  await stepTo3(F, sidF, -64, 38.3);
  await ping(F, { x: 2200, z: 5.5, ry: 3.14, warp: true, ...sidF });
  const re2 = await ping(E, { ...sidE });
  const rf2 = await ping(F, { ...sidF });
  ok(re2.j && re2.j.zone === 'apt' && re2.j.roster.length === 0, 'apt: E is solo inside (empty roster)', re2.j && { zone: re2.j.zone, n: re2.j.roster.length });
  ok(rf2.j && rf2.j.zone === 'apt' && rf2.j.roster.length === 0, 'apt: F is solo inside too (same geometry, own instance)', rf2.j && { zone: rf2.j.zone, n: rf2.j.roster.length });
}

/* ---- v546: emote sync through the roster ---- */
{
  const userG = 'w3emo' + Date.now().toString(36).slice(-5);
  const userH = 'w3emo2' + Date.now().toString(36).slice(-5);
  const G = await signup(userG);
  const H = await signup(userH);
  const sidG = { sid: 'emo1' }, sidH = { sid: 'emo2' };
  await ping(G, { x: 2, z: 18, ry: 0, ...sidG });
  await ping(H, { x: -2, z: 18, ry: 0, ...sidH });
  await ping(G, { x: 2, z: 18, ry: 0, emote: 'wave', ...sidG });
  const rh = await ping(H, { ...sidH });
  const gEntry = rh.j && rh.j.roster.find((e) => e.u === userG);
  ok(!!gEntry && gEntry.emote === 'wave', 'emote: wave shows in the roster', gEntry);
  await ping(G, { x: 2, z: 18, ry: 0, emote: 'spin', ...sidG });
  const rh2 = await ping(H, { ...sidH });
  const g2 = rh2.j && rh2.j.roster.find((e) => e.u === userG);
  ok(!!g2 && (g2.emote === null || g2.emote === undefined), 'emote: invalid emote is dropped server-side', g2);
  await ping(G, { x: 2, z: 18, ry: 0, emote: 'celebrate', ...sidG });
  const rh3 = await ping(H, { ...sidH });
  const g3 = rh3.j && rh3.j.roster.find((e) => e.u === userG);
  ok(!!g3 && g3.emote === 'celebrate', 'emote: celebrate shows in the roster', g3);
}

/* ---- Stage 11: the wild is walkable, zones span chunks ---- */
{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = async (tag) => {
    const user = 'w3wild' + tag + Math.random().toString(36).slice(2, 6);
    const S = await signup(user);
    return { user, S, sid: { sid: 'w' + tag + Math.random().toString(36).slice(2, 10) } };
  };
  const walkTo = async (P, tx, tz) => {
    let cur = (await ping(P.S, { ...P.sid })).j;
    for (let i = 0; i < 60; i++) {
      const dx = tx - cur.x, dz = tz - cur.z, d = Math.hypot(dx, dz);
      if (d < 1) break;
      const st = Math.min(9, d);
      cur = (await ping(P.S, { x: Math.round((cur.x + dx / d * st) * 10) / 10, z: Math.round((cur.z + dz / d * st) * 10) / 10, ry: 0, ...P.sid })).j;
      await sleep(230); // stay under the sustained-speed window
    }
    return cur;
  };
  const C = await mk('c'); // heads east into the wild
  const E = await mk('e'); // heads west, ends >400u from C
  const T = await mk('t'); // stays at the town edge
  await ping(C.S, { x: 0, z: 18, ry: 0, ...C.sid });
  await ping(E.S, { x: 0, z: 18, ry: 0, ...E.sid });
  await ping(T.S, { x: 0, z: 18, ry: 0, ...T.sid });
  // the walks take ~25s total; presence prunes at 7s, so everyone
  // keepalive-pings (position-less, never moves them) throughout
  const ka = setInterval(() => { ping(C.S, { ...C.sid }); ping(E.S, { ...E.sid }); ping(T.S, { ...T.sid }); }, 3000);
  const cEnd = await walkTo(C, 250, 0);
  ok(/^wild:/.test(cEnd.zone || '') && cEnd.x > 240, 'wild: walking east out of town is accepted, zone is wild:<cx>:<cz>', { x: cEnd.x, zone: cEnd.zone });
  const cDeep = await walkTo(C, 400, 0);
  ok(/^wild:/.test(cDeep.zone || '') && cDeep.x > 390, 'wild: deep-wild movement keeps working across chunk borders', { x: cDeep.x, zone: cDeep.zone });
  await walkTo(E, -250, 0);
  await walkTo(T, 190, 0);
  clearInterval(ka);
  const rc = await ping(C.S, { ...C.sid });
  ok(rc.j && !rc.j.roster.some((e2) => e2.u === E.user), 'wild roster: players >400u apart do not see each other');
  ok(rc.j && rc.j.roster.some((e2) => e2.u === T.user), 'wild roster: the town-edge player 210u away is visible across the town/wild border');
  const rt = await ping(T.S, { ...T.sid });
  ok(rt.j && rt.j.roster.some((e2) => e2.u === C.user), 'town roster: a wild player in range shows in town');
  // walking into an interior without a door warp is still refused
  const wIn = await ping(C.S, { x: 2000, z: 5.5, ry: 0, ...C.sid });
  ok(wIn.j && wIn.j.x === cDeep.x, 'wild: teleport-walk into an interior is refused (position held)', wIn.j && wIn.j.x);
}

console.log('SERVER RESULT: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
