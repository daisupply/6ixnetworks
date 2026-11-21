// browser.test.mjs — real-browser regression battery for the 3D world.
// covers: loader (styled first paint, NO raw JS visible), handshake
// failure -> error screen (never READY), desktop movement/camera
// (directions, diagonal parity, sprint, jump, no double-jump, camera
// no-auto-rotate, no-clip boom, follow continuity, focus/visibility
// loss), frame-rate robustness under CPU throttling, settings,
// portal round trip, SESSION TAKEOVER freeze + reclaim, and mobile
// simultaneous inputs (joystick+camera, joystick+jump, joystick+sprint,
// touch cancel, release-stop, landscape).
//
// requires a running LOCAL test server and a Chrome binary:
//   W3_BASE=http://127.0.0.1:18097 CHROME_PATH=/path/to/chrome \
//     node world3d/tests/browser.test.mjs
// assertions POLL game state (window.__w3state) instead of assuming
// wall-clock timing, so the battery stays valid on slow machines.
import puppeteer from 'puppeteer-core';
import { createHash } from 'node:crypto';

const B = process.env.W3_BASE || 'http://127.0.0.1:18097';
const CHROME = process.env.CHROME_PATH || (process.env.HOME + '/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
let jar = '';
async function req(method, path, body) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', cookie: jar, 'user-agent': UA }, body: body == null ? undefined : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) { const c = sc.split(';')[0]; if (!jar.includes(c.split('=')[0])) jar = jar ? jar + '; ' + c : c; }
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { }
  return { status: r.status, j };
}
const lzb = (buf) => { let z = 0; for (const byte of buf) { if (byte === 0) { z += 8; continue; } for (let k = 7; k >= 0; k--) { if ((byte >> k) & 1) return z; z++; } } return z; };
await req('GET', '/enter');
const ch = await req('GET', '/auth/challenge'); const c0 = ch.j.c; let n0 = 0;
for (; ; n0++) { if (lzb(createHash('sha256').update(c0 + ':' + n0).digest()) >= 15) break; }
const uname = 'w3bt' + Date.now().toString(36).slice(-5);
const su = await req('POST', '/auth/signup', { user: uname, pass: 'testpass123', pow: { c: c0, n: n0 }, hp: '' });
if (!su.j || !su.j.ok) throw new Error('signup failed: ' + JSON.stringify(su.j));
const sessCookie = jar.split('; ').find((x) => x.startsWith('six_sess='));
console.log('signed up', uname);

let pass = 0, fail = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log('PASS', label); } else { fail++; console.log('FAIL', label, extra !== undefined ? JSON.stringify(extra).slice(0, 220) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1'] });
async function newPage(w, h, touch) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.setUserAgent(UA);
  await page.setViewport({ width: w, height: h, hasTouch: !!touch, isMobile: !!touch });
  await page.setCookie({ name: 'six_in', value: '1', domain: '127.0.0.1', path: '/' }, { name: 'six_sess', value: sessCookie.slice(sessCookie.indexOf('=') + 1), domain: '127.0.0.1', path: '/' });
  page._errs = errs;
  return page;
}
const state = (page) => page.evaluate(() => window.__w3state && window.__w3state());
async function pollState(page, fn, timeoutMs) {
  const t0 = Date.now(); let s = null;
  while (Date.now() - t0 < timeoutMs) { s = await state(page); if (s && fn(s)) return s; await sleep(180); }
  return s;
}
async function dragCam(page, px) {
  await page.mouse.move(640, 400); await page.mouse.down();
  await page.mouse.move(640 + px, 400, { steps: 8 }); await page.mouse.up();
}
async function homeTo(page, tx, tz, tol) {
  const t0 = Date.now();
  let lastPos = null, lastMoveAt = Date.now();
  await page.keyboard.down('KeyW');
  let near = false;
  while (Date.now() - t0 < 90000) {
    const s = await state(page);
    if (!s) break;
    const dx = tx - s.x, dz = tz - s.z, dist = Math.hypot(dx, dz);
    if (dist < tol) { near = true; break; }
    if (!lastPos || Math.hypot(s.x - lastPos.x, s.z - lastPos.z) > 0.5) { lastPos = { x: s.x, z: s.z }; lastMoveAt = Date.now(); }
    else if (Date.now() - lastMoveAt > 4000) {
      await page.keyboard.up('KeyW'); await page.keyboard.down('KeyD'); await sleep(600); await page.keyboard.up('KeyD');
      await page.keyboard.down('KeyW'); lastMoveAt = Date.now();
    }
    const wantYaw = Math.atan2(dx, dz);
    let diff = wantYaw - s.camYaw;
    while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) > 0.09) await dragCam(page, Math.max(-260, Math.min(260, -diff / 0.0021)));
    await sleep(200);
  }
  await page.keyboard.up('KeyW');
  await pollState(page, (x) => x.speed < 0.8, 9000);
  return near;
}
async function turnCamTo(page, target) {
  for (let i = 0; i < 14; i++) {
    const s = await state(page);
    if (!s) return false;
    let diff = target - s.camYaw;
    while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) < 0.3) return true;
    await dragCam(page, Math.max(-280, Math.min(280, -diff / 0.0021)));
    await sleep(150);
  }
  return false;
}
async function bootDesktop(extra) {
  const page = await newPage(1280, 800, false);
  // headless pointer lock makes synthetic drags chaotic; stub it so the
  // deterministic drag path is exercised (lock engagement is native in
  // real browsers and was verified separately).
  await page.evaluateOnNewDocument(() => { try { Element.prototype.requestPointerLock = function () { }; } catch (e) { } });
  if (extra) await extra(page);
  await page.goto(B + '/world3d?from=portal', { waitUntil: 'load', timeout: 30000 });
  const s = await pollState(page, (x) => x.booted, 30000);
  return { page, booted: !!s };
}

/* ---- 1) LOADER: styled first paint, no raw code, ring animating ---- */
{
  const page = await newPage(1280, 800, false);
  await page.setRequestInterception(true);
  page.on('request', (rq) => { if (rq.url().includes('client3d.js')) rq.abort(); else rq.continue(); });
  await page.goto(B + '/world3d', { waitUntil: 'load', timeout: 30000 });
  await sleep(900);
  const probe = await page.evaluate(() => {
    const card = document.querySelector('.w3load-card');
    const ring = document.querySelector('.w3ring');
    const cs = getComputedStyle(card);
    return { bg: cs.backgroundColor, ringAnim: getComputedStyle(ring).animationName, visibleText: document.body.innerText };
  });
  ok(probe.bg && probe.bg !== 'rgba(0, 0, 0, 0)' && probe.bg !== 'transparent', 'loader: styled card on first paint even with engine blocked', probe.bg);
  ok(probe.ringAnim === 'w3spin', 'loader: portal ring animation running (inlined critical CSS)');
  ok(!probe.visibleText.includes('__sixNotif') && !probe.visibleText.includes('function () {'), 'loader: NO raw JS source visible as page text');
  await page.screenshot({ path: '/tmp/w3t-loader.png' });
  await page.close();
}

/* ---- 2) HANDSHAKE FAILURE: never READY, error screen shows ---- */
for (const [label, fulfill] of [
  ['http500', (rq) => rq.respond({ status: 500, contentType: 'application/json', body: '{"ok":false,"err":"boom"}' })],
  ['badjson', (rq) => rq.respond({ status: 200, contentType: 'application/json', body: 'this is not json{{{' })],
]) {
  const page = await newPage(1280, 800, false);
  await page.setRequestInterception(true);
  page.on('request', (rq) => { if (rq.url().includes('/api/world3d/ping')) fulfill(rq); else rq.continue(); });
  await page.goto(B + '/world3d', { waitUntil: 'load', timeout: 30000 });
  await sleep(3500);
  const probe = await page.evaluate(() => ({
    booted: window.__w3booted === true,
    errShown: !document.getElementById('w3loaderr').hidden,
    errText: document.getElementById('w3loaderr').textContent,
    btnsShown: !document.getElementById('w3loadbtns').hidden,
  }));
  ok(!probe.booted && probe.errShown && probe.btnsShown, 'handshake ' + label + ': error screen with retry/back, never READY', probe);
  ok(/world server/.test(probe.errText), 'handshake ' + label + ': error message names the failed handshake', probe.errText);
  await page.close();
}

/* ---- 3) DESKTOP: boot, directions, camera ---- */
const { page, booted } = await bootDesktop();
ok(booted, 'desktop: engine booted to READY after a valid handshake');
{
  const s = await state(page);
  ok(s && Math.abs(s.x) < 0.6 && Math.abs(s.z - 18) < 0.6, 'desktop: spawn (0,18)', s && { x: s.x, z: s.z });
  ok(s && s.camDist > 11 && s.camDist < 14.5, 'desktop: camera at boom distance ~13', s && s.camDist);
  await page.screenshot({ path: '/tmp/w3t-desktop.png' });
}
// S moves toward the camera (+z at spawn yaw)
{
  const s0 = await state(page);
  await page.keyboard.down('KeyS');
  const s = await pollState(page, (x) => x.z > s0.z + 2, 12000);
  await page.keyboard.up('KeyS');
  ok(!!s, 'desktop: S moves toward the camera', s && { z: s.z, z0: s0.z });
  await pollState(page, (x) => x.speed < 0.8, 8000);
}
// A and D move in opposite horizontal directions
{
  const s0 = await state(page);
  await page.keyboard.down('KeyD');
  const sd = await pollState(page, (x) => x.x > s0.x + 2, 12000);
  await page.keyboard.up('KeyD');
  ok(!!sd, 'desktop: D moves +x at spawn yaw', sd && { x: sd.x, x0: s0.x });
  await pollState(page, (x) => x.speed < 0.8, 8000);
  const s1 = await state(page);
  await page.keyboard.down('KeyA');
  const sa = await pollState(page, (x) => x.x < s1.x - 2, 12000);
  await page.keyboard.up('KeyA');
  ok(!!sa, 'desktop: A moves -x (opposite of D)', sa && { x: sa.x, x1: s1.x });
  await pollState(page, (x) => x.speed < 0.8, 8000);
}
// W walks away from camera; walk speed; no auto-rotate; stop on release
{
  const s0 = await state(page);
  await page.keyboard.down('KeyW');
  const sw = await pollState(page, (x) => x.speed > 12, 15000);
  ok(!!sw, 'desktop: W reaches walk speed ~15', sw && sw.speed);
  const yawSamples = [];
  const posSamples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2600) { const s = await state(page); if (s) { yawSamples.push(s.camYaw); posSamples.push([s.x, s.z]); } await sleep(200); }
  const yawDrift = Math.max(...yawSamples) - Math.min(...yawSamples);
  ok(yawDrift < 0.05, 'desktop: camera does NOT auto-rotate while walking', { yawDrift });
  let maxStep = 0;
  for (let i = 1; i < posSamples.length; i++) maxStep = Math.max(maxStep, Math.hypot(posSamples[i][0] - posSamples[i - 1][0], posSamples[i][1] - posSamples[i - 1][1]));
  ok(maxStep < 3, 'desktop: follow is continuous, no position snapping between samples', { maxStep });
  const zNow = (await state(page)).z;
  ok(zNow < s0.z - 2, 'desktop: W walked away from the camera (z decreased)', { zNow, z0: s0.z });
  await page.keyboard.up('KeyW');
  const stopped = await pollState(page, (x) => x.speed < 0.8, 9000);
  ok(!!stopped, 'desktop: releasing W stops acceleration (speed -> 0)');
  const p1 = await state(page); await sleep(700); const p2 = await state(page);
  ok(Math.hypot(p2.x - p1.x, p2.z - p1.z) < 0.3, 'desktop: no drift after stop');
}
// diagonal speed == straight speed
{
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
  const sd = await pollState(page, (x) => x.speed > 11, 15000);
  ok(!!sd && sd.speed < 17.5, 'desktop: diagonal speed equals walk speed (not faster)', sd && sd.speed);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
  await pollState(page, (x) => x.speed < 0.8, 8000);
}
// sprint
{
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  const ss = await pollState(page, (x) => x.speed > 20, 15000);
  ok(!!ss, 'desktop: sprint reaches >20 (walk is 15)', ss && ss.speed);
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  await pollState(page, (x) => x.speed < 0.8, 8000);
}
// jump: rises, no double-jump while airborne, lands clean
{
  await page.keyboard.press('Space');
  const air = await pollState(page, (x) => x.y > 0.7 && !x.grounded, 9000);
  ok(!!air, 'desktop: jump rises and leaves the ground', air && air.y);
  let maxY = 0;
  if (air) {
    await page.keyboard.press('Space'); // second press mid-air must NOT re-jump
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) { const s = await state(page); if (s) { maxY = Math.max(maxY, s.y); if (s.grounded && s.y === 0) break; } await sleep(120); }
  }
  ok(maxY > 1.2 && maxY < 2.7, 'desktop: no double jump — apex stays at single-jump height (~2.2)', { maxY });
  const landed = await pollState(page, (x) => x.grounded && x.y === 0, 6000);
  ok(!!landed, 'desktop: jump lands cleanly');
}
// camera rotation changes movement direction
{
  const before = await state(page);
  for (let i = 0; i < 7; i++) { await dragCam(page, 220); await sleep(120); }
  const turned = await pollState(page, (x) => Math.abs(x.camYaw) < 0.6 || Math.abs(x.camYaw) > 5.7, 12000);
  ok(!!turned, 'desktop: mouse drag rotates camera ~180 degrees', turned && turned.camYaw);
  const s0 = await state(page);
  await page.keyboard.down('KeyW');
  const sz = await pollState(page, (x) => x.z > s0.z + 2, 12000);
  await page.keyboard.up('KeyW');
  ok(!!sz, 'desktop: after rotating, W follows the NEW camera direction (+z)', sz && { z: sz.z, z0: s0.z });
  await pollState(page, (x) => x.speed < 0.8, 8000);
  for (let i = 0; i < 7; i++) { await dragCam(page, -220); await sleep(120); }
  await pollState(page, (x) => Math.abs(Math.abs(x.camYaw) - Math.PI) < 0.5, 12000);
}
// camera boom does not clip: stand north-facing distance from the
// fountain, then face AWAY so the boom must cross the fountain sphere.
{
  await homeTo(page, 0, 12, 2.5);
  await turnCamTo(page, 0); // facing south: camera boom reaches north into the fountain
  const s = await pollState(page, (x) => x.camDist < 11, 12000);
  ok(!!s, 'camera: boom shortens instead of clipping into the fountain sphere', s && s.camDist);
  await turnCamTo(page, Math.PI); // facing the fountain again: boom over open ground
  const back = await pollState(page, (x) => x.camDist > 11.5, 12000);
  ok(!!back, 'camera: boom eases back out when the obstacle clears', back && back.camDist);
}
// settings: panel + persistence
{
  await page.evaluate(() => { document.getElementById('w3setbtn').click(); });
  await sleep(300);
  const open = await page.evaluate(() => !document.getElementById('w3set').hidden);
  ok(open, 'settings: panel opens');
  await page.evaluate(() => { const el = document.getElementById('w3sens'); el.value = '1.8'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('w3settings') || '{}').sens);
  ok(saved === 1.8, 'settings: sensitivity persists to localStorage', saved);
  await page.evaluate(() => { document.getElementById('w3setclose').click(); });
}
// focus loss + visibility loss kill movement
{
  await page.keyboard.down('KeyW');
  await pollState(page, (x) => x.speed > 8, 12000);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const stopped = await pollState(page, (x) => x.speed < 0.8, 9000);
  ok(!!stopped, 'desktop: window blur kills movement (no stuck keys)');
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyW');
  await pollState(page, (x) => x.speed > 8, 12000);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const stopped2 = await pollState(page, (x) => x.speed < 0.8, 9000);
  ok(!!stopped2, 'desktop: tab hide (visibilitychange) kills movement');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.keyboard.up('KeyW');
}
// frame-rate robustness: same checks under 6x CPU throttling
{
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.keyboard.down('KeyW');
  const sw = await pollState(page, (x) => x.speed > 10, 25000);
  ok(!!sw, 'framerate: walk still reaches speed under 6x CPU throttle', sw && sw.speed);
  await page.keyboard.up('KeyW');
  const st = await pollState(page, (x) => x.speed < 0.8, 15000);
  ok(!!st, 'framerate: stop still works under 6x CPU throttle');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();
}
ok(page._errs.length === 0, 'desktop: zero page errors', page._errs.slice(0, 3));

/* ---- 4) PORTAL ROUND TRIP: steer there, prompt, return to /world ---- */
{
  const near = await homeTo(page, 22, 0, 4.4);
  ok(near, 'portal: steered to the return portal');
  const actVis = await page.evaluate(() => !document.getElementById('w3act').hidden);
  ok(actVis, 'portal: RETURN prompt appears near portal');
  if (actVis) {
    await page.evaluate(() => document.getElementById('w3act').click());
    try { await page.waitForFunction(() => location.pathname === '/world', { timeout: 10000 }); ok(true, 'portal: return trip lands on /world'); }
    catch (e) { ok(false, 'portal: return trip lands on /world', await page.evaluate(() => location.pathname)); }
  }
}

/* ---- 5) SESSION TAKEOVER: second tab freezes, reclaim works, no dupes ---- */
{
  // the "other tab" is driven over the API from node. two puppeteer
  // pages in one browser starve each other's rAF, the idle page's
  // pings stall, and the server prunes it — which would fake the whole
  // scenario. one live browser page + one API peer is deterministic
  // and exercises the same client code paths.
  const apiPing = async (body) => {
    const r = await fetch(B + '/api/world3d/ping', { method: 'POST', headers: { 'content-type': 'application/json', cookie: jar, 'user-agent': UA }, body: JSON.stringify(body) });
    return r.json();
  };
  let alive = true;
  await apiPing({ x: 0, z: 17, ry: 3, sid: 'tabA' }); // tab A owns the session
  const keeper = (async () => { let x = 0; while (alive) { x = x === 0 ? 1 : 0; await apiPing({ x, z: 17, ry: 3, sid: 'tabA' }).catch(() => { }); await sleep(1200); } })();

  const tp = await newPage(1280, 800, false);
  await tp.evaluateOnNewDocument(() => { try { Element.prototype.requestPointerLock = function () { }; } catch (e) { } });
  await tp.goto(B + '/world3d?from=portal', { waitUntil: 'load', timeout: 30000 });
  let conflictShown = false;
  { const t0 = Date.now(); while (Date.now() - t0 < 25000) { conflictShown = await tp.evaluate(() => { const el = document.getElementById('w3conflict'); return !!el && !el.hidden; }).catch(() => false); if (conflictShown) break; await sleep(300); } }
  const ts = await state(tp);
  ok(conflictShown && ts && ts.state === 'SESSION_CONFLICT' && ts.conflict === true && !ts.booted,
    'takeover: second tab enters SESSION_CONFLICT with the persistent card visible', ts && ts.state);
  const f0 = await state(tp);
  await tp.keyboard.down('KeyW');
  await sleep(2200);
  const f1 = await state(tp);
  await tp.keyboard.up('KeyW');
  ok(f0 && f1 && Math.hypot(f1.x - f0.x, f1.z - f0.z) < 0.3, 'takeover: frozen tab cannot move (W does nothing, page in front, loop live)', f1 && { x: f1.x, z: f1.z });
  ok(f1 && f1.remotes === 0, 'takeover: no duplicate entity for the same account', f1 && f1.remotes);
  await tp.evaluate(() => document.getElementById('w3reclaim').click());
  const live = await pollState(tp, (x) => x.state === 'READY' && !x.conflict && x.booted, 15000);
  ok(!!live, 'takeover: reclaim (position-less ping) makes this tab live again');
  alive = false; await sleep(1600); await keeper; // let tab A's keeper exit
  const stolen = await apiPing({ x: 2, z: 16, ry: 0, sid: 'tabA' });
  ok(stolen && stolen.ok === false && stolen.err === 'session taken over', 'takeover: after reclaim, the other tab is the stale one', stolen && stolen.err);
  const m0 = await state(tp);
  await tp.keyboard.down('KeyW');
  const moved = await pollState(tp, (x) => Math.hypot(x.x - m0.x, x.z - m0.z) > 2, 15000);
  await tp.keyboard.up('KeyW');
  ok(!!moved, 'takeover: reclaimed tab can move again');
  ok(tp._errs.length === 0, 'takeover: zero page errors', tp._errs.slice(0, 3));
  await tp.close();
}

/* ---- 6) PHONE: simultaneous inputs, cancel, rotate ---- */
{
  const mp = await newPage(390, 844, true);
  await mp.goto(B + '/world3d', { waitUntil: 'load', timeout: 30000 });
  const mb = await pollState(mp, (x) => x.booted, 30000);
  ok(!!mb, 'phone: engine booted');
  const ctrls = await mp.evaluate(() => {
    const j = document.getElementById('w3jump').getBoundingClientRect();
    const sp = document.getElementById('w3sprint').getBoundingClientRect();
    const zone = document.getElementById('w3joyzone').getBoundingClientRect();
    return { jump: { x: j.x + j.width / 2, y: j.y + j.height / 2 }, sprint: { x: sp.x + sp.width / 2, y: sp.y + sp.height / 2 }, zone: { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }, vis: j.width > 0 };
  });
  ok(ctrls.vis, 'phone: touch controls visible');
  const cdp = await mp.createCDPSession();
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  // joystick engages and walks
  await touch('touchStart', [{ x: ctrls.zone.x, y: ctrls.zone.y, id: 1 }]);
  await touch('touchMove', [{ x: ctrls.zone.x, y: ctrls.zone.y - 70, id: 1 }]);
  const walking = await pollState(mp, (x) => x.speed > 5, 15000);
  ok(!!walking, 'phone: joystick walks', walking && walking.speed);
  // joystick + jump simultaneously
  await touch('touchStart', [{ x: ctrls.zone.x, y: ctrls.zone.y - 70, id: 1 }, { x: ctrls.jump.x, y: ctrls.jump.y, id: 2 }]);
  const jumped = await pollState(mp, (x) => x.y > 0.2, 9000);
  ok(!!jumped, 'phone: joystick + jump simultaneously (jump fires while stick held)', jumped && jumped.y);
  await touch('touchEnd', [{ x: ctrls.zone.x, y: ctrls.zone.y - 70, id: 1 }]);
  // joystick + sprint simultaneously
  await touch('touchStart', [{ x: ctrls.zone.x, y: ctrls.zone.y - 70, id: 1 }, { x: ctrls.sprint.x, y: ctrls.sprint.y, id: 3 }]);
  const sprinting = await pollState(mp, (x) => x.speed > 19, 15000);
  ok(!!sprinting, 'phone: joystick + sprint simultaneously (speed > 19)', sprinting && sprinting.speed);
  // pointer/touch cancel kills the stick without touching the other input's state
  await touch('touchCancel', []); // CDP: touchCancel carries no points; cancels all active touches
  const cancelled = await pollState(mp, (x) => x.speed < 1, 12000);
  ok(!!cancelled, 'phone: touch cancel stops joystick movement');
  await sleep(400); // touchCancel already ended every active touch
  // joystick + second-finger camera drag at the same time
  const cam0 = (await state(mp)).camYaw;
  await touch('touchStart', [{ x: ctrls.zone.x, y: ctrls.zone.y, id: 5 }]);
  await touch('touchMove', [{ x: ctrls.zone.x, y: ctrls.zone.y - 60, id: 5 }]);
  await pollState(mp, (x) => x.speed > 4, 12000);
  await touch('touchStart', [{ x: ctrls.zone.x, y: ctrls.zone.y - 60, id: 5 }, { x: 300, y: 420, id: 6 }]);
  await touch('touchMove', [{ x: ctrls.zone.x, y: ctrls.zone.y - 60, id: 5 }, { x: 210, y: 420, id: 6 }]);
  // poll for the yaw change instead of a fixed sleep: under heavy CPU
  // throttling a fixed window can contain zero frames (v542 run: dyaw
  // exactly 0 with the stick driving fine — rAF starvation, not logic).
  const camS = await pollState(mp, (x) => Math.abs(x.camYaw - cam0) > 0.15 && x.speed > 2, 20000) || await state(mp);
  ok(camS && Math.abs(camS.camYaw - cam0) > 0.15 && camS.speed > 2, 'phone: second finger rotates camera WHILE joystick drives', camS && { dyaw: camS.camYaw - cam0, speed: camS.speed });
  await touch('touchEnd', []);
  const rest = await pollState(mp, (x) => x.speed < 1, 12000);
  ok(!!rest, 'phone: releasing all touches stops movement');
  // rotate to landscape and reboot clean
  await mp.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await mp.reload({ waitUntil: 'load' });
  const lb = await pollState(mp, (x) => x.booted, 30000);
  ok(!!lb, 'phone: landscape orientation boots + renders');
  await mp.screenshot({ path: '/tmp/w3t-phone.png' });
  ok(mp._errs.length === 0, 'phone: zero page errors', mp._errs.slice(0, 3));
  await mp.close();
}

await browser.close();
console.log('BROWSER RESULT: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
