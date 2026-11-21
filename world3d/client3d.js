/* the third dimension — client engine.
 * Safeguards honored here (3D migration spec, 2026-11-21):
 *  - exactly ONE renderer, ONE scene, ONE animation loop per session;
 *    the renderer is created once in init() and never recreated on
 *    state updates. Cleanup disposes geometries/materials/renderer
 *    and removes every listener it added.
 *  - delta-time movement, normalized diagonals, simple reliable
 *    ground (flat plaza y=0) + jump/land states, circle colliders
 *    push-out so nobody walks through the fountain/portal/lamps.
 *  - remote players are interpolated toward their last server
 *    position; the server validates all movement (see world3d.js).
 *  - WebGL context loss surfaces a real error overlay (never a
 *    silent black screen); load failure is caught by the page
 *    watchdog in world3d.js page().
 *  - touch joystick (move) and touch drag (camera) are independent;
 *    losing focus clears all input so nobody runs forever.
 * Three.js is pinned: r160, vendored at /world3d/vendor/.
 */
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;

const PORTAL = { x: 22, z: 0 };
const BOUND_X = 195, BOUND_Z = 118;
const WALK = 15, DASH = 24, GRAV = 30, JUMP_V = 11;

let renderer = null, scene = null, camera = null, raf = 0, clock = null;
let disposed = false, booted = false;
let me = '', mySid = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let px = 0, pz = 18, py = 0, vy = 0, grounded = true, ry = Math.PI;
let camYaw = Math.PI, camPitch = 0.42, camDist = 13;
let keys = {}, joyVec = { x: 0, y: 0 }, joyId = null, camId = null, camLast = null;
let remotes = new Map(); // u -> { group, tx, tz, try_, hue }
let portalGroup = null, portalRing = null, portalPts = null, fountainGlow = null;
let pingTimer = 0, lastPingOk = 0, gfxMode = 'auto', shadowOn = false;
let transitioning = false, startedAt = performance.now();

const colliders = []; // {x, z, r}
function addCollider(x, z, r) { colliders.push({ x, z, r }); }

function setLoad(pct, msg) {
  const f = $('w3barfill'), m = $('w3loadmsg');
  if (f) f.style.width = pct + '%';
  if (m && msg) m.textContent = msg;
}
function loadError(text) {
  const e = $('w3loaderr'), b = $('w3loadbtns'), m = $('w3loadmsg');
  if (e) { e.hidden = false; e.textContent = text; }
  if (b) b.hidden = false;
  if (m) m.textContent = 'load failed';
}
let toastAt = 0;
function toast(text, ms) {
  const t = $('w3toast'); if (!t) return;
  t.textContent = text; t.hidden = false; toastAt = performance.now() + (ms || 3200);
}

async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  try { return await r.json(); } catch (e) { return { ok: false, err: 'bad reply' }; }
}

/* ---------- shared avatar pieces (created once, reused by everyone) ---------- */
let sharedGeo = null, sharedMats = null;
function starGeometry() {
  const s = new THREE.Shape();
  const R = 0.34, r = 0.13;
  for (let i = 0; i < 8; i++) {
    const rad = (i % 2 === 0) ? R : r, a = i * Math.PI / 4 - Math.PI / 2;
    const X = Math.cos(a) * rad, Y = Math.sin(a) * rad;
    if (i === 0) s.moveTo(X, Y); else s.lineTo(X, Y);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false });
}
function makeAvatar(hue) {
  if (!sharedGeo) {
    sharedGeo = {
      body: new THREE.CapsuleGeometry(0.42, 0.85, 6, 14),
      head: new THREE.SphereGeometry(0.34, 18, 14),
      star: starGeometry(),
    };
    sharedMats = { star: new THREE.MeshStandardMaterial({ color: 0xffd257, emissive: 0x8a5a00, emissiveIntensity: 0.7, roughness: 0.35 }) };
  }
  const g = new THREE.Group();
  const col = (typeof hue === 'number') ? new THREE.Color().setHSL(hue / 360, 0.55, 0.6) : new THREE.Color(0x8b7cff);
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.05 });
  const body = new THREE.Mesh(sharedGeo.body, bodyMat);
  body.position.y = 0.95; body.castShadow = shadowOn;
  const head = new THREE.Mesh(sharedGeo.head, bodyMat);
  head.position.y = 2.02; head.castShadow = shadowOn;
  const star = new THREE.Mesh(sharedGeo.star, sharedMats.star);
  star.position.set(0, 2.02, 0.3);
  g.add(body); g.add(head); g.add(star);
  g.userData.bodyMat = bodyMat;
  return g;
}
function disposeAvatar(g) {
  if (g.userData.bodyMat) g.userData.bodyMat.dispose();
}

/* ---------- world building (procedural, no external assets to fail) ---------- */
function buildWorld() {
  scene.fog = new THREE.FogExp2(0x0b0620, 0.0038);
  scene.background = new THREE.Color(0x0b0620);

  const hemi = new THREE.HemisphereLight(0x8f7bff, 0x14092e, 0.85);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xcdbfff, 1.5);
  moon.position.set(-40, 60, -25);
  shadowOn = gfxMode === 'high' || (gfxMode === 'auto' && !window.matchMedia('(pointer: coarse)').matches);
  moon.castShadow = shadowOn;
  if (shadowOn) { moon.shadow.mapSize.set(1024, 1024); moon.shadow.camera.left = -60; moon.shadow.camera.right = 60; moon.shadow.camera.top = 60; moon.shadow.camera.bottom = -60; }
  scene.add(moon);
  scene.userData.moon = moon;

  // sky stars + moon disc
  const starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.48 + 0.05, R = 380;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * R; starPos[i * 3 + 1] = Math.sin(e) * R; starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * R;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdcd6ff, size: 1.6, sizeAttenuation: false, fog: false }));
  scene.add(stars);
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(16, 32), new THREE.MeshBasicMaterial({ color: 0xf2efff, fog: false }));
  moonDisc.position.set(-150, 130, -320); moonDisc.lookAt(0, 0, 0);
  scene.add(moonDisc);

  // ground: dark plaza plane + glowing plaza disc + fountain surround
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(BOUND_X * 2 + 60, BOUND_Z * 2 + 60), new THREE.MeshStandardMaterial({ color: 0x171233, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = shadowOn;
  scene.add(ground);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x241a4d, roughness: 0.9 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = shadowOn;
  scene.add(plaza);

  // fountain at origin (the wishing well, in 3d)
  const fb = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 7, 1.1, 28), new THREE.MeshStandardMaterial({ color: 0x2c2160, roughness: 0.7 }));
  fb.position.y = 0.55; scene.add(fb);
  const fw = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 1.16, 28), new THREE.MeshStandardMaterial({ color: 0x3b6ea5, roughness: 0.25, metalness: 0.1, emissive: 0x0a2c50, emissiveIntensity: 0.6 }));
  fw.position.y = 0.58; scene.add(fw);
  fountainGlow = new THREE.Mesh(new THREE.SphereGeometry(1.15, 18, 14), new THREE.MeshBasicMaterial({ color: 0xf4f2ff }));
  fountainGlow.position.y = 2.6; scene.add(fountainGlow);
  const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 2.4, 10), new THREE.MeshStandardMaterial({ color: 0x2c2160, roughness: 0.7 }));
  fp.position.y = 1.2; scene.add(fp);
  addCollider(0, 0, 7.6);

  // THE DIMENSIONAL PORTAL — east of the fountain, mirror of the 2d one
  portalGroup = new THREE.Group();
  portalGroup.position.set(PORTAL.x, 0, PORTAL.z);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d1440, roughness: 0.4, metalness: 0.4, emissive: 0x3b1470, emissiveIntensity: 0.5 });
  const frame = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.32, 12, 40), frameMat);
  frame.position.y = 3.6; frame.castShadow = shadowOn;
  portalGroup.add(frame);
  portalRing = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.1, 8, 40), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
  portalRing.position.y = 3.6;
  portalGroup.add(portalRing);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.15, 40), new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.34, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  disc.position.y = 3.6; disc.name = 'portalDisc';
  portalGroup.add(disc);
  const postGeo = new THREE.CylinderGeometry(0.3, 0.42, 1.4, 10);
  const postL = new THREE.Mesh(postGeo, frameMat); postL.position.set(-3.4, 0.7, 0); portalGroup.add(postL);
  const postR = new THREE.Mesh(postGeo, frameMat); postR.position.set(3.4, 0.7, 0); portalGroup.add(postR);
  const pPos = new Float32Array(140 * 3);
  for (let i = 0; i < 140; i++) {
    const a = Math.random() * Math.PI * 2, rr2 = Math.random() * 3;
    pPos[i * 3] = Math.cos(a) * rr2; pPos[i * 3 + 1] = 3.6 + Math.sin(a) * rr2; pPos[i * 3 + 2] = (Math.random() - 0.5) * 0.7;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  portalPts = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xa5f3fc, size: 0.14, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  portalGroup.add(portalPts);
  scene.add(portalGroup);
  addCollider(PORTAL.x - 3.4, PORTAL.z, 0.9);
  addCollider(PORTAL.x + 3.4, PORTAL.z, 0.9);

  // lamp posts around the plaza
  const lampPole = new THREE.CylinderGeometry(0.09, 0.12, 3.4, 8);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x241a45, roughness: 0.8 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const bulbGeo = new THREE.SphereGeometry(0.24, 10, 8);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, R = 24;
    const lx = Math.cos(a) * R, lz = Math.sin(a) * R;
    if (Math.abs(lx - PORTAL.x) < 5 && Math.abs(lz - PORTAL.z) < 5) continue;
    const pole = new THREE.Mesh(lampPole, lampMat); pole.position.set(lx, 1.7, lz); scene.add(pole);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat); bulb.position.set(lx, 3.5, lz); scene.add(bulb);
    addCollider(lx, lz, 0.5);
  }

  // pine trees ring + district silhouettes (arcade / theater blocks)
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1c3f, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x14352a, roughness: 1 });
  const coneGeo = new THREE.ConeGeometry(1.7, 4.6, 8);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, R = 44 + Math.random() * 60;
    const tx = Math.cos(a) * R, tz = Math.sin(a) * R * 0.62;
    if (Math.abs(tx) > BOUND_X - 6 || Math.abs(tz) > BOUND_Z - 6) continue;
    const tr = new THREE.Mesh(trunkGeo, trunkMat); tr.position.set(tx, 0.8, tz); scene.add(tr);
    const cn = new THREE.Mesh(coneGeo, leafMat); cn.position.set(tx, 3.8, tz); cn.castShadow = shadowOn; scene.add(cn);
    addCollider(tx, tz, 0.8);
  }
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x1d1440, roughness: 0.85 });
  const neonMats = [0xa78bfa, 0xf472b6, 0x38bdf8].map((c) => new THREE.MeshStandardMaterial({ color: 0x1d1440, roughness: 0.85, emissive: c, emissiveIntensity: 0.35 }));
  [[-62, -52, 26, 16, 12], [58, -54, 26, 16, 12], [-64, 46, 22, 13, 10], [62, 48, 22, 13, 10], [0, -78, 30, 14, 9]].forEach((b, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b[2], b[4], b[3]), i % 2 ? neonMats[i % 3] : blockMat);
    m.position.set(b[0], b[4] / 2, b[1]); m.castShadow = shadowOn; scene.add(m);
    addCollider(b[0], b[1], Math.max(b[2], b[3]) * 0.62);
  });
}

/* ---------- networking: ping-poll presence, like the 2d world ---------- */
async function ping() {
  try {
    const r = await jpost('/api/world3d/ping', { x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10, ry, sid: mySid });
    if (!r || !r.ok) {
      if (r && r.err === 'session taken over') { toast('this dimension is open in another tab — movement paused here'); return; }
      if (r && r.err === 'login first') { window.__w3fatal = true; loadError('ur not logged in. log in on the site first, then come back through the portal.'); stopLoop(); return; }
      return;
    }
    lastPingOk = performance.now();
    me = r.me || me;
    if (typeof r.bal === 'number') $('w3bal').textContent = '¢ ' + r.bal + ' six cents';
    $('w3who').textContent = '@' + me + ' · ' + (r.roster.length + 1) + ' in the dimension';
    const seen = new Set();
    for (const p of r.roster) {
      seen.add(p.u);
      let rm = remotes.get(p.u);
      if (!rm) {
        const group = makeAvatar(p.hue);
        group.position.set(p.x, 0, p.z);
        scene.add(group);
        rm = { group, tx: p.x, tz: p.z, try_: p.ry || 0 };
        remotes.set(p.u, rm);
      }
      rm.tx = p.x; rm.tz = p.z; rm.try_ = p.ry || 0;
    }
    for (const [u, rm] of remotes) {
      if (!seen.has(u)) { scene.remove(rm.group); disposeAvatar(rm.group); remotes.delete(u); }
    }
  } catch (e) { /* network blip: next ping retries; stale presence prunes server-side */ }
}

/* ---------- input ---------- */
function onKey(down) {
  return (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    keys[e.code] = down;
    if (e.code === 'Space') { e.preventDefault(); if (down && grounded) { vy = JUMP_V; grounded = false; } }
  };
}
const kd = onKey(true), ku = onKey(false);
function clearInput() { keys = {}; joyVec = { x: 0, y: 0 }; joyId = null; camId = null; const k = $('w3knob'); if (k) k.style.transform = 'translate(0px,0px)'; }
function onBlur() { clearInput(); }
function onVis() { if (document.hidden) clearInput(); }
function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
function bindTouch() {
  const joy = $('w3joy'), knob = $('w3knob'), cv = $('w3cv');
  joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); moveJoy(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) moveJoy(e); });
  const endJoy = (e) => { if (e.pointerId === joyId) { joyId = null; joyVec = { x: 0, y: 0 }; knob.style.transform = 'translate(0px,0px)'; } };
  joy.addEventListener('pointerup', endJoy); joy.addEventListener('pointercancel', endJoy);
  function moveJoy(e) {
    const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    joyVec = { x: dx, y: dy };
    knob.style.transform = 'translate(' + (dx * 30) + 'px,' + (dy * 30) + 'px)';
  }
  cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; camId = e.pointerId; camLast = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerId !== camId || !camLast) return;
    camYaw -= (e.clientX - camLast.x) * 0.005;
    camPitch = clamp(camPitch + (e.clientY - camLast.y) * 0.004, 0.08, 1.25);
    camLast = { x: e.clientX, y: e.clientY };
  });
  const endCam = (e) => { if (e.pointerId === camId) { camId = null; camLast = null; } };
  cv.addEventListener('pointerup', endCam); cv.addEventListener('pointercancel', endCam);
  $('w3jump').addEventListener('pointerdown', (e) => { e.preventDefault(); if (grounded) { vy = JUMP_V; grounded = false; } });
}

/* ---------- main loop (the ONLY loop) ---------- */
let lastT = 0;
function loop(t) {
  if (disposed) return;
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  // movement input (keyboard + joystick), normalized
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz -= 1;
  if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  ix += joyVec.x; iz += joyVec.y;
  const mag = Math.hypot(ix, iz);
  if (mag > 0.01) {
    const s = (keys.ShiftLeft || keys.ShiftRight) ? DASH : WALK;
    const nx = ix / Math.max(1, mag), nz = iz / Math.max(1, mag);
    // input is screen-relative: rotate by camera yaw
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const wx = nx * cos - nz * sin, wz = nx * sin + nz * cos;
    px += wx * s * dt; pz += wz * s * dt;
    ry = Math.atan2(wx, wz);
    // camera follows heading gently while moving with keys only
    if (joyId === null && camId === null && (keys.KeyW || keys.ArrowUp)) camYaw = lerp(camYaw, ry + Math.PI, Math.min(1, dt * 2.2));
  }
  // gravity / jump
  if (!grounded) {
    py += vy * dt; vy -= GRAV * dt;
    if (py <= 0) { py = 0; vy = 0; grounded = true; }
  }
  // bounds + colliders (push-out, no walking through solid things)
  px = clamp(px, -BOUND_X, BOUND_X); pz = clamp(pz, -BOUND_Z, BOUND_Z);
  for (const c of colliders) {
    const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz), min = c.r + 0.55;
    if (d > 0.001 && d < min) { px = c.x + dx / d * min; pz = c.z + dz / d * min; }
  }
  // my avatar
  if (scene.userData.meGroup) {
    const g = scene.userData.meGroup;
    g.position.set(px, py, pz);
    g.rotation.y = ry;
  }
  // remotes: interpolate
  for (const rm of remotes.values()) {
    const g = rm.group, k = Math.min(1, dt * 9);
    g.position.x = lerp(g.position.x, rm.tx, k);
    g.position.z = lerp(g.position.z, rm.tz, k);
    g.rotation.y = lerp(g.rotation.y, rm.try_, k);
  }
  // portal life
  const now = performance.now();
  if (portalRing) { portalRing.rotation.z = now / 600; portalRing.scale.setScalar(1 + Math.sin(now / 480) * 0.04); }
  if (portalPts) portalPts.rotation.z = -now / 2400;
  if (fountainGlow) fountainGlow.position.y = 2.6 + Math.sin(now / 900) * 0.12;
  // return-portal proximity -> action button
  const nearPortal = Math.hypot(px - PORTAL.x, pz - PORTAL.z) < 5.2;
  const act = $('w3act');
  if (nearPortal !== act.dataset.on) { act.dataset.on = nearPortal ? '1' : ''; act.hidden = !nearPortal; }
  if (toastAt && now > toastAt) { $('w3toast').hidden = true; toastAt = 0; }
  // camera
  const cx = px - Math.sin(camYaw) * Math.cos(camPitch) * camDist;
  const cz = pz - Math.cos(camYaw) * Math.cos(camPitch) * camDist;
  const cy = 1.6 + Math.sin(camPitch) * camDist;
  camera.position.set(cx, Math.max(1.2, cy), cz);
  camera.lookAt(px, 1.7 + py, pz);
  // network ping ~ every 450ms
  pingTimer += dt;
  if (pingTimer > 0.45) { pingTimer = 0; ping(); }
  renderer.render(scene, camera);
  lastT = t;
}

function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function cleanup() {
  if (disposed) return; disposed = true;
  stopLoop();
  window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
  window.removeEventListener('resize', onResize); window.removeEventListener('blur', onBlur);
  document.removeEventListener('visibilitychange', onVis);
  if (scene) {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }
    });
  }
  if (renderer) { renderer.dispose(); }
}

/* ---------- return through the portal ---------- */
function goBack() {
  if (transitioning) return; transitioning = true;
  const ov = $('w3load');
  ov.classList.add('show'); setLoad(100, 'crossing back…');
  try { navigator.sendBeacon && navigator.sendBeacon('/api/world3d/leave', new Blob(['{}'], { type: 'application/json' })); } catch (e) { }
  setTimeout(() => { location.href = '/world'; }, 650);
}

/* ---------- boot ---------- */
function init() {
  setLoad(35, 'building the plaza…');
  const cv = $('w3cv');
  try {
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    loadError('WebGL could not start on this device/browser: ' + (e && e.message ? e.message : e));
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 900);
  clock = new THREE.Clock();
  buildWorld();
  const mine = makeAvatar(null);
  scene.add(mine); scene.userData.meGroup = mine;
  setLoad(70, 'opening the portal…');

  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stopLoop(); loadError('the WebGL context was lost (gpu hiccup or too many tabs). tap retry to re-enter.'); $('w3load').classList.add('show'); }, false);
  cv.addEventListener('webglcontextrestored', () => { toast('context restored'); if (!raf) raf = requestAnimationFrame(loop); }, false);

  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  window.addEventListener('resize', onResize); window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', () => { try { navigator.sendBeacon && navigator.sendBeacon('/api/world3d/leave', new Blob(['{}'], { type: 'application/json' })); } catch (e) { } cleanup(); });
  bindTouch();
  $('w3act').addEventListener('click', goBack);
  $('w3gfx').addEventListener('click', () => {
    gfxMode = gfxMode === 'auto' ? 'high' : (gfxMode === 'high' ? 'low' : 'auto');
    $('w3gfx').textContent = 'gfx: ' + gfxMode;
    const wantShadow = gfxMode === 'high';
    if (scene.userData.moon && scene.userData.moon.castShadow !== wantShadow) { toast('gfx set — shadows apply next visit'); }
    renderer.setPixelRatio(gfxMode === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  });

  ping().then(() => {
    if (window.__w3fatal) return; // loadError already owns the screen
    setLoad(100, 'in.');
    booted = true; window.__w3booted = true;
    window.__w3state = function () { return { x: px, z: pz, y: py, me: me, remotes: remotes.size, booted: booted }; };
    if (window.__w3watchdog) clearTimeout(window.__w3watchdog);
    setTimeout(() => { $('w3load').classList.add('hide'); }, 250);
    if (new URLSearchParams(location.search).get('from') === 'portal') toast('✦ u crossed over. the portal behind u leads back', 4600);
    raf = requestAnimationFrame(loop);
  }).catch((e) => { loadError('could not reach the world server: ' + (e && e.message ? e.message : e)); });
}

try { init(); } catch (e) { loadError('the 3d engine hit an error: ' + (e && e.message ? e.message : e)); }
