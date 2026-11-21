/* the third dimension — client engine (v2 overhaul, 2026-11-21).
 *
 * What v2 fixes vs the first build (from the phase-1 audit):
 *  - CAMERA: v1 placed the camera rigidly from yaw/pitch every frame
 *    (zero damping = jitter), had NO collision (clipped through
 *    buildings), and auto-rotated toward the walk heading while W was
 *    held — the "camera moves on its own" bug. v2 is a real controller:
 *    input targets -> exponentially damped yaw/pitch/follow point,
 *    segment-tested collision that shortens the boom, pointer lock on
 *    desktop with drag fallback, adjustable sensitivity + distance.
 *    The camera NEVER rotates without player input.
 *  - MOVEMENT: v1 snapped facing instantly and had no acceleration.
 *    v2 is velocity-based (fast accel, faster decel = stops dead on
 *    release), shortest-angle turn smoothing, normalized diagonals.
 *  - INPUT: pointer lock mouse-look, dynamic-origin touch joystick,
 *    separate camera touch, sprint button, true multitouch via
 *    per-pointer tracking. Focus loss clears everything.
 *  - CHARACTERS: articulated avatars (legs/arms/head/star crest) with
 *    procedural idle/walk/run/jump/land animation; remotes get name
 *    labels and the same animation driven by their real speed.
 *  - LOADING: progress is driven by REAL checkpoints (engine code ->
 *    renderer -> world built -> server hello -> first frame), the
 *    loader itself is styled by CSS inlined in the page head, and
 *    errors are surfaced, never hidden.
 * Safeguards kept: exactly ONE renderer/scene/loop, dispose on exit,
 * server-authoritative movement (world3d.js validates), read-only
 * player data, WebGL context-loss overlay. Three.js r160 vendored.
 */
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const TAU = Math.PI * 2;
function angWrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function angLerp(a, b, k) { return a + angWrap(b - a) * k; }
function dampK(rate, dt) { return 1 - Math.exp(-rate * dt); }
// deterministic rng so the plaza layout is designed, not scattered
function mulberry32(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const PORTAL = { x: 22, z: 0 };
const BOUND_X = 195, BOUND_Z = 118;
const WALK = 15, SPRINT = 26, ACCEL = 90, DECEL = 120, TURN = 14;
const GRAV = 30, JUMP_V = 11.5;

/* ---------- settings (persisted) ---------- */
const SET_DEF = { sens: 1, camDist: 13, camH: 1.7, gfx: 'auto', shadows: true, snd: false, vol: 0.5 };
let SET = { ...SET_DEF };
try { const s = JSON.parse(localStorage.getItem('w3settings') || 'null'); if (s) SET = { ...SET_DEF, ...s }; } catch (e) { }
function saveSet() { try { localStorage.setItem('w3settings', JSON.stringify(SET)); } catch (e) { } }

/* ---------- state ---------- */
let renderer = null, scene = null, camera = null, raf = 0, clock = null;
let disposed = false, booted = false;
let me = '', mySid = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let px = 0, pz = 18, py = 0, vy = 0, grounded = true, ry = Math.PI;
let vx = 0, vz = 0, speedSm = 0, landT = 0, wasGrounded = true;
let camYawT = Math.PI, camPitchT = 0.42, camYaw = Math.PI, camPitch = 0.42;
let followX = 0, followY = 1.7, followZ = 18, camDistEff = 13;
let keys = {}, sprintTouch = false;
let joyVec = { x: 0, y: 0 }, joyId = null, joyCenter = null, camPtrId = null, camLast = null, mouseDrag = false;
let remotes = new Map();
let portalRing = null, portalPts = null, portalDisc = null, fountainOrb = null, fountainWater = null, spray = null, motes = null;
let pingTimer = 0, transitioning = false, fpsEma = 60, lastPingOk = 0, bootState = 'INITIALIZING';
let R = {}; // cached DOM refs
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

const colliders = [];   // {x, z, r} circles (player)
const boxColliders = []; // {minX, maxX, minZ, maxZ} (player)
const camSpheres = [];  // {x, y, z, r} (camera boom)
const camBoxes = [];    // {minX, maxX, minZ, maxZ, h} (camera boom)
function addCollider(x, z, r) { colliders.push({ x, z, r }); }

/* ---------- loading: real checkpoints + rotating flavor ---------- */
const FLAVOR = ['tuning the portal…', 'folding space, carefully…', 'waking the stars…', 'polishing the fountain…', 'teaching gravity the rules…', 'rolling out the moonlight…'];
let flavorI = 0, flavorTimer = 0, loadDone = false;
function setLoad(pct, state) {
  if (state) bootState = state;
  if (R.barfill) R.barfill.style.width = pct + '%';
  if (R.loadpct) R.loadpct.textContent = bootState.replace(/_/g, ' ') + ' · ' + pct + '%';
}
function loadError(text) {
  bootState = 'ERROR';
  loadDone = true;
  if (flavorTimer) { clearInterval(flavorTimer); flavorTimer = 0; }
  if (R.loaderr) { R.loaderr.hidden = false; R.loaderr.textContent = text; }
  if (R.loadbtns) R.loadbtns.hidden = false;
  if (R.loadmsg) R.loadmsg.textContent = 'load failed';
  if (R.load) R.load.classList.add('show');
}
let toastAt = 0;
function toast(text, ms) {
  if (!R.toast) return;
  R.toast.textContent = text; R.toast.hidden = false; toastAt = performance.now() + (ms || 3200);
}

async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  try { return await r.json(); } catch (e) { return { ok: false, err: 'bad reply' }; }
}

/* ---------- ambient audio (procedural pad, off by default) ---------- */
let AC = null, acMaster = null;
function ensureAudio() {
  if (!SET.snd) return;
  if (AC) { if (AC.resume) AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    acMaster = AC.createGain(); acMaster.gain.value = SET.vol * 0.14;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    acMaster.connect(f); f.connect(AC.destination);
    [[110, 'sine', 0.5], [164.81, 'sine', 0.42], [220, 'triangle', 0.16]].forEach((cfg, i) => {
      const o = AC.createOscillator(); o.type = cfg[1]; o.frequency.value = cfg[0]; o.detune.value = (i - 1) * 4;
      const g = AC.createGain(); g.gain.value = cfg[2];
      o.connect(g); g.connect(acMaster); o.start();
    });
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.07;
    const lg = AC.createGain(); lg.gain.value = 90;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
  } catch (e) { AC = null; }
}
function applyAudio() {
  if (!SET.snd) { if (AC && AC.suspend) AC.suspend(); return; }
  ensureAudio();
  if (acMaster) acMaster.gain.value = SET.vol * 0.14;
}

/* ---------- avatars: articulated, procedurally animated ---------- */
let sharedGeo = null, sharedMats = null;
function starGeometry() {
  const s = new THREE.Shape();
  const Rr = 0.3, rr = 0.12;
  for (let i = 0; i < 8; i++) {
    const rad = (i % 2 === 0) ? Rr : rr, a = i * Math.PI / 4 - Math.PI / 2;
    const X = Math.cos(a) * rad, Y = Math.sin(a) * rad;
    if (i === 0) s.moveTo(X, Y); else s.lineTo(X, Y);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false });
}
function labelSprite(name) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = '700 30px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 8;
  g.fillStyle = '#f3efff'; g.fillText('@' + name, 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(3.4, 0.85, 1); sp.position.y = 2.78;
  sp.userData.tex = tex;
  return sp;
}
function makeAvatar(hue, name) {
  if (!sharedGeo) {
    sharedGeo = {
      body: new THREE.CapsuleGeometry(0.4, 0.72, 6, 14),
      head: new THREE.SphereGeometry(0.33, 20, 16),
      limb: new THREE.CapsuleGeometry(0.115, 0.42, 4, 10),
      leg: new THREE.CapsuleGeometry(0.135, 0.4, 4, 10),
      star: starGeometry(),
      eye: new THREE.SphereGeometry(0.045, 8, 8),
    };
    sharedMats = {
      star: new THREE.MeshStandardMaterial({ color: 0xffd257, emissive: 0x9a6200, emissiveIntensity: 0.8, roughness: 0.3 }),
      eye: new THREE.MeshBasicMaterial({ color: 0xeaf6ff }),
      dark: new THREE.MeshStandardMaterial({ color: 0x191233, roughness: 0.7 }),
    };
  }
  const col = (typeof hue === 'number') ? new THREE.Color().setHSL(hue / 360, 0.55, 0.58) : new THREE.Color(0x8b7cff);
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(sharedGeo.body, bodyMat); body.position.y = 1.32; g.add(body);
  const head = new THREE.Mesh(sharedGeo.head, bodyMat); head.position.y = 2.06; g.add(head);
  const eyeL = new THREE.Mesh(sharedGeo.eye, sharedMats.eye); eyeL.position.set(-0.12, 2.1, 0.29); g.add(eyeL);
  const eyeR = new THREE.Mesh(sharedGeo.eye, sharedMats.eye); eyeR.position.set(0.12, 2.1, 0.29); g.add(eyeR);
  const star = new THREE.Mesh(sharedGeo.star, sharedMats.star); star.position.set(0, 1.42, 0.4); g.add(star);
  function limb(side, isLeg) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (isLeg ? 0.19 : 0.52), isLeg ? 0.92 : 1.68, 0);
    const m = new THREE.Mesh(isLeg ? sharedGeo.leg : sharedGeo.limb, isLeg ? sharedMats.dark : bodyMat);
    m.position.y = isLeg ? -0.3 : -0.28;
    pivot.add(m); g.add(pivot);
    return pivot;
  }
  const parts = { legL: limb(-1, true), legR: limb(1, true), armL: limb(-1, false), armR: limb(1, false), body, head, star };
  g.userData.parts = parts; g.userData.bodyMat = bodyMat;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  if (name) { const lb = labelSprite(name); g.add(lb); g.userData.label = lb; }
  return g;
}
function disposeAvatar(g) {
  if (g.userData.bodyMat) g.userData.bodyMat.dispose();
  if (g.userData.label) { g.userData.label.material.map.dispose(); g.userData.label.material.dispose(); }
}
/* procedural animation: phase advances with real speed; idle breathes;
   air poses tuck; landing squashes. state kept per avatar in `st`. */
function animateAvatar(g, st, dt, now) {
  const P = g.userData.parts; if (!P) return;
  st.phase = (st.phase || 0) + dt * (2.2 + st.speed * 1.05);
  const sf = clamp(st.speed / WALK, 0, 1.6);
  const swing = Math.sin(st.phase) * 0.62 * Math.min(1, sf);
  if (!st.grounded) {
    P.legL.rotation.x = -0.55; P.legR.rotation.x = 0.35;
    P.armL.rotation.x = -2.6; P.armR.rotation.x = -2.6;
    P.armL.rotation.z = 0.5; P.armR.rotation.z = -0.5;
  } else {
    P.legL.rotation.x = swing; P.legR.rotation.x = -swing;
    P.armL.rotation.x = -swing * 0.8; P.armR.rotation.x = swing * 0.8;
    P.armL.rotation.z = 0.08; P.armR.rotation.z = -0.08;
  }
  const bob = st.grounded ? Math.abs(Math.sin(st.phase)) * 0.055 * Math.min(1, sf) : 0;
  const breath = st.speed < 0.4 && st.grounded ? Math.sin(now / 620) * 0.012 : 0;
  let squash = 1;
  if (st.landT > 0) { st.landT -= dt; squash = 0.88 + 0.12 * (1 - clamp(st.landT / 0.16, 0, 1)); }
  g.scale.set(1, squash * (1 + breath), 1);
  P.body.position.y = 1.32 + bob; P.head.position.y = 2.06 + bob;
  P.star.rotation.z = Math.sin(now / 900) * 0.14;
  P.body.rotation.x = clamp(st.speed * 0.008, 0, 0.16); // lean into motion
}

/* ---------- graphics tiers ---------- */
function tierOf() { return SET.gfx === 'auto' ? (window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high') : SET.gfx; }
function applyGfx() {
  if (!renderer) return;
  const tier = tierOf();
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(tier === 'low' ? 1 : tier === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
  const moon = scene && scene.userData.moon;
  if (moon) {
    const size = tier === 'high' ? 2048 : 1024;
    const on = SET.shadows && tier !== 'low';
    moon.castShadow = on;
    if (moon.shadow.mapSize.x !== size) { moon.shadow.mapSize.set(size, size); if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; } }
  }
  if (motes) motes.visible = tier !== 'low';
}

/* ---------- procedural textures (canvas, zero external assets) ---------- */
function canvasTex(w, h, draw, rx, ry) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (rx) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry || rx); }
  t.anisotropy = 4;
  return t;
}
function groundTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#16102e'; g.fillRect(0, 0, w, h);
    const rnd = mulberry32(42);
    for (let i = 0; i < 5200; i++) { g.fillStyle = 'rgba(' + (140 + rnd() * 80 | 0) + ',' + (120 + rnd() * 60 | 0) + ',255,' + (rnd() * 0.05) + ')'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    for (let i = 0; i < 26; i++) { g.fillStyle = 'rgba(10,6,26,' + (0.05 + rnd() * 0.08) + ')'; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 60, 0, TAU); g.fill(); }
  }, 10, 10);
}
function plazaTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    const c = w / 2;
    g.fillStyle = '#231a4d'; g.fillRect(0, 0, w, h);
    for (let r = 500; r > 30; r -= 34) {
      g.beginPath(); g.arc(c, c, r, 0, TAU);
      g.fillStyle = (r / 34 | 0) % 2 ? '#251c52' : '#201845'; g.fill();
      g.strokeStyle = 'rgba(167,139,250,.16)'; g.lineWidth = 2; g.stroke();
    }
    g.strokeStyle = 'rgba(167,139,250,.10)';
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; g.beginPath(); g.moveTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60); g.lineTo(c + Math.cos(a) * 500, c + Math.sin(a) * 500); g.stroke(); }
    g.beginPath(); g.arc(c, c, 492, 0, TAU); g.strokeStyle = 'rgba(103,232,249,.5)'; g.lineWidth = 5; g.stroke();
    g.beginPath(); g.arc(c, c, 128, 0, TAU); g.strokeStyle = 'rgba(255,210,87,.4)'; g.lineWidth = 3; g.stroke();
    g.save(); g.translate(c, c); g.fillStyle = 'rgba(255,210,87,.13)';
    g.beginPath();
    for (let i = 0; i < 8; i++) { const rad = i % 2 === 0 ? 52 : 20, a = i * Math.PI / 4 - Math.PI / 2; const X = Math.cos(a) * rad, Y = Math.sin(a) * rad; if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y); }
    g.closePath(); g.fill(); g.restore();
  });
}
function waterTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, 8, c, c, c);
    gr.addColorStop(0, '#7dd3fc'); gr.addColorStop(0.45, '#2f6db3'); gr.addColorStop(1, '#173d6e');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(220,245,255,.35)';
    for (let r = 22; r < 128; r += 21) { g.beginPath(); g.arc(c, c, r, 0, TAU); g.lineWidth = 2; g.stroke(); }
  });
}
function windowsTexture(seed, accent) {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#1a1236'; g.fillRect(0, 0, w, h);
    const rnd = mulberry32(seed);
    for (let y = 10; y < h - 12; y += 22) for (let x = 10; x < w - 12; x += 22) {
      const on = rnd();
      g.fillStyle = on > 0.55 ? (rnd() > 0.4 ? 'rgba(255,205,120,.95)' : accent) : 'rgba(90,80,150,.28)';
      g.fillRect(x, y, 12, 14);
    }
  });
}
function signTexture(text, color) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112;
  const g = cv.getContext('2d');
  g.font = '800 58px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 22; g.fillStyle = color;
  g.fillText(text, 256, 58); g.fillText(text, 256, 58);
  return new THREE.CanvasTexture(cv);
}

/* ---------- world building: a designed plaza district ---------- */
function buildWorld() {
  const rnd = mulberry32(20261121);
  scene.fog = new THREE.FogExp2(0x0b0620, 0.0032);
  scene.background = new THREE.Color(0x0b0620);

  const hemi = new THREE.HemisphereLight(0x9a86ff, 0x14092e, 0.9);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xcdbfff, 1.6);
  moon.position.set(-40, 62, -25);
  moon.shadow.camera.left = -70; moon.shadow.camera.right = 70; moon.shadow.camera.top = 70; moon.shadow.camera.bottom = -70;
  moon.shadow.bias = -0.0006;
  scene.add(moon); scene.userData.moon = moon;
  const orbLight = new THREE.PointLight(0x67e8f9, 900, 30, 2);
  orbLight.position.set(0, 3.4, 0); scene.add(orbLight);

  // sky: stars, moon disc, nebula glows
  const starN = 900, starPos = new Float32Array(starN * 3);
  for (let i = 0; i < starN; i++) {
    const a = rnd() * TAU, e = rnd() * Math.PI * 0.48 + 0.05, Rr = 380;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * Rr; starPos[i * 3 + 1] = Math.sin(e) * Rr; starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * Rr;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdcd6ff, size: 1.6, sizeAttenuation: false, fog: false })));
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(15, 32), new THREE.MeshBasicMaterial({ color: 0xf2efff, fog: false }));
  moonDisc.position.set(-150, 128, -320); moonDisc.lookAt(0, 0, 0); scene.add(moonDisc);
  const nebTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(150,110,255,.55)'); gr.addColorStop(1, 'rgba(150,110,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  [[-190, 120, -260, 260, 0x8b5cf6], [230, 90, -240, 200, 0x2563eb], [60, 150, -330, 300, 0xdb2777]].forEach((n) => {
    const sm = new THREE.SpriteMaterial({ map: nebTex, color: n[4], transparent: true, opacity: 0.5, fog: false, depthWrite: false });
    const sp = new THREE.Sprite(sm); sp.position.set(n[0], n[1], n[2]); sp.scale.set(n[3], n[3] * 0.6, 1); scene.add(sp);
  });

  // ground + plaza + paths
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(BOUND_X * 2 + 160, BOUND_Z * 2 + 160), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(30, 56), new THREE.MeshStandardMaterial({ map: plazaTexture(), roughness: 0.85 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = true; scene.add(plaza);
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x2a2060, roughness: 0.95 });
  [[31, 0, 34, 4.6, 0], [-31, 0, 34, 4.6, 0], [0, -42, 4.6, 56, 0], [0, 42, 4.6, 56, 0]].forEach((pp) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pp[2], pp[3]), pathMat);
    m.rotation.x = -Math.PI / 2; m.position.set(pp[0], 0.015, pp[1]); m.receiveShadow = true; scene.add(m);
  });

  // distant mountain silhouettes (depth at the fog line)
  const mtnMat = new THREE.MeshBasicMaterial({ color: 0x0e0824 });
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * TAU + rnd() * 0.3, Rr = 305 + rnd() * 55;
    const m = new THREE.Mesh(new THREE.ConeGeometry(52 + rnd() * 46, 44 + rnd() * 42, 5), mtnMat);
    m.position.set(Math.cos(a) * Rr, 12, Math.sin(a) * Rr); m.rotation.y = rnd() * TAU; scene.add(m);
  }

  // THE FOUNTAIN (the wishing well, in 3d) — basin, rim, animated water,
  // pillar, top bowl, glowing orb + spray
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x32256a, roughness: 0.65, metalness: 0.08 });
  const fb = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 7.1, 1.15, 30), stoneMat);
  fb.position.y = 0.57; fb.castShadow = true; fb.receiveShadow = true; scene.add(fb);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6.35, 0.3, 10, 36), stoneMat);
  rim.rotation.x = Math.PI / 2; rim.position.y = 1.16; rim.castShadow = true; scene.add(rim);
  fountainWater = new THREE.Mesh(new THREE.CircleGeometry(6.1, 30), new THREE.MeshStandardMaterial({ map: waterTexture(), roughness: 0.15, metalness: 0.25, emissive: 0x0d3355, emissiveIntensity: 0.7, transparent: true, opacity: 0.96 }));
  fountainWater.rotation.x = -Math.PI / 2; fountainWater.position.y = 1.05; fountainWater.material.map.center.set(0.5, 0.5); scene.add(fountainWater);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 2.5, 10), stoneMat);
  pillar.position.y = 1.7; pillar.castShadow = true; scene.add(pillar);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.9, 0.5, 16), stoneMat);
  bowl.position.y = 3.05; scene.add(bowl);
  fountainOrb = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 16), new THREE.MeshBasicMaterial({ color: 0xeaf6ff }));
  fountainOrb.position.y = 3.9; scene.add(fountainOrb);
  const spN = 110, spPos = new Float32Array(spN * 3), spDat = [];
  for (let i = 0; i < spN; i++) { spDat.push({ a: rnd() * TAU, r: 0.3 + rnd() * 1.1, ph: rnd() }); spPos[i * 3 + 1] = -50; }
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  spray = new THREE.Points(spGeo, new THREE.PointsMaterial({ color: 0xbfe9ff, size: 0.13, transparent: true, opacity: 0.85, depthWrite: false }));
  spray.userData.dat = spDat; scene.add(spray);
  addCollider(0, 0, 7.7); camSpheres.push({ x: 0, y: 1.6, z: 0, r: 7.9 });

  // THE DIMENSIONAL PORTAL — mirror of the 2d door beside the well
  const portalGroup = new THREE.Group();
  portalGroup.position.set(PORTAL.x, 0, PORTAL.z);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d1440, roughness: 0.35, metalness: 0.45, emissive: 0x3b1470, emissiveIntensity: 0.55 });
  const frame = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.32, 12, 44), frameMat);
  frame.position.y = 3.6; frame.castShadow = true; portalGroup.add(frame);
  portalRing = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.1, 8, 44), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
  portalRing.position.y = 3.6; portalGroup.add(portalRing);
  portalDisc = new THREE.Mesh(new THREE.CircleGeometry(3.15, 40), new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.34, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  portalDisc.position.y = 3.6; portalGroup.add(portalDisc);
  const postGeo = new THREE.CylinderGeometry(0.3, 0.44, 1.5, 10);
  const postL = new THREE.Mesh(postGeo, frameMat); postL.position.set(-3.4, 0.75, 0); portalGroup.add(postL);
  const postR = new THREE.Mesh(postGeo, frameMat); postR.position.set(3.4, 0.75, 0); portalGroup.add(postR);
  const rune = new THREE.Mesh(new THREE.RingGeometry(3.7, 4.25, 40), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = 0.04; rune.name = 'rune'; portalGroup.add(rune);
  portalGroup.userData.rune = rune;
  const pN = 150, pPos = new Float32Array(pN * 3);
  for (let i = 0; i < pN; i++) { const a = rnd() * TAU, rr2 = rnd() * 3; pPos[i * 3] = Math.cos(a) * rr2; pPos[i * 3 + 1] = 3.6 + Math.sin(a) * rr2; pPos[i * 3 + 2] = (rnd() - 0.5) * 0.7; }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  portalPts = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xa5f3fc, size: 0.14, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  portalGroup.add(portalPts);
  scene.add(portalGroup);
  scene.userData.portalGroup = portalGroup;
  addCollider(PORTAL.x - 3.4, PORTAL.z, 0.95); addCollider(PORTAL.x + 3.4, PORTAL.z, 0.95);

  // lamps: plaza ring + path pairs (instanced)
  const lampSpots = [];
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; const lx = Math.cos(a) * 24, lz = Math.sin(a) * 24; if (Math.abs(lx - PORTAL.x) < 5.5 && Math.abs(lz - PORTAL.z) < 5.5) continue; lampSpots.push([lx, lz]); }
  [[-14, -5.4], [-14, 5.4], [14, -5.4], [14, 5.4], [-5.4, -20], [5.4, -20], [-5.4, 20], [5.4, 20]].forEach((s2) => lampSpots.push(s2));
  const dummy = new THREE.Object3D();
  const poleIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 3.4, 8), new THREE.MeshStandardMaterial({ color: 0x241a45, roughness: 0.8 }), lampSpots.length);
  const bulbIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lampSpots.length);
  lampSpots.forEach((s2, i) => {
    dummy.position.set(s2[0], 1.7, s2[1]); dummy.scale.setScalar(1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); poleIM.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 3.55; dummy.updateMatrix(); bulbIM.setMatrixAt(i, dummy.matrix);
    addCollider(s2[0], s2[1], 0.5); camSpheres.push({ x: s2[0], y: 2.4, z: s2[1], r: 0.8 });
  });
  scene.add(poleIM); scene.add(bulbIM);

  // benches + planters around the fountain (designed ring furniture)
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2f52, roughness: 0.9 });
  [45, 135, 225, 315].forEach((deg) => {
    const a = deg * Math.PI / 180, bx = Math.cos(a) * 11, bz = Math.sin(a) * 11;
    const bg = new THREE.Group(); bg.position.set(bx, 0, bz); bg.rotation.y = -a + Math.PI / 2;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.85), woodMat); seat.position.y = 0.62; seat.castShadow = true; bg.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.75, 0.13), woodMat); back.position.set(0, 1.08, -0.4); back.rotation.x = -0.16; bg.add(back);
    scene.add(bg); addCollider(bx, bz, 1.35);
  });
  const planterMat = new THREE.MeshStandardMaterial({ color: 0x2c2160, roughness: 0.8 });
  const flowerMat = new THREE.MeshBasicMaterial({ color: 0xf0abfc });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x1d4d33, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6, fx = Math.cos(a) * 16.5, fz = Math.sin(a) * 16.5;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 1.7), planterMat);
    box.position.set(fx, 0.35, fz); box.castShadow = true; scene.add(box);
    for (let k = 0; k < 3; k++) {
      const ox = (rnd() - 0.5) * 1.0, oz = (rnd() - 0.5) * 1.0;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 5), stemMat);
      st.position.set(fx + ox, 0.95, fz + oz); scene.add(st);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), flowerMat);
      fl.position.set(fx + ox, 1.26, fz + oz); scene.add(fl);
    }
    addCollider(fx, fz, 1.25);
  }

  // trees: path rows + designed groves (instanced, two-tier pines)
  const treeSpots = [];
  for (let d = 20; d <= 62; d += 13) { treeSpots.push([-d, -8.5], [-d, 8.5], [d + 6, -8.5], [d + 6, 8.5]); }
  for (let d = 26; d <= 66; d += 13) { treeSpots.push([-8.5, -d], [8.5, -d], [-8.5, d], [8.5, d]); }
  [[-72, -42], [76, -46], [-82, 36], [86, 42], [0, 88], [-48, 74], [52, 78]].forEach((c) => {
    const n = 5 + (rnd() * 3 | 0);
    for (let i = 0; i < n; i++) treeSpots.push([c[0] + (rnd() - 0.5) * 22, c[1] + (rnd() - 0.5) * 18]);
  });
  const trunkIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 1.7, 8), new THREE.MeshStandardMaterial({ color: 0x2a1c3f, roughness: 1 }), treeSpots.length);
  const coneIM1 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.85, 3.6, 8), new THREE.MeshStandardMaterial({ color: 0x14352a, roughness: 1 }), treeSpots.length);
  const coneIM2 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.3, 2.8, 8), new THREE.MeshStandardMaterial({ color: 0x1a4232, roughness: 1 }), treeSpots.length);
  treeSpots.forEach((s2, i) => {
    const sc = 0.85 + rnd() * 0.5;
    dummy.rotation.set(0, rnd() * TAU, 0); dummy.scale.setScalar(sc);
    dummy.position.set(s2[0], 0.85 * sc, s2[1]); dummy.updateMatrix(); trunkIM.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 3.3 * sc; dummy.updateMatrix(); coneIM1.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 5.3 * sc; dummy.updateMatrix(); coneIM2.setMatrixAt(i, dummy.matrix);
    addCollider(s2[0], s2[1], 0.85); camSpheres.push({ x: s2[0], y: 3.4, z: s2[1], r: 2.1 });
  });
  trunkIM.castShadow = coneIM1.castShadow = coneIM2.castShadow = true;
  scene.add(trunkIM); scene.add(coneIM1); scene.add(coneIM2);

  // rocks near the groves (instanced)
  const rockIM = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.8, 0), new THREE.MeshStandardMaterial({ color: 0x3a3264, roughness: 0.95 }), 16);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU, Rr = 38 + rnd() * 42, rx = Math.cos(a) * Rr, rz = Math.sin(a) * Rr * 0.8;
    dummy.position.set(rx, 0.3, rz); dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); dummy.scale.set(0.6 + rnd() * 1.1, 0.5 + rnd() * 0.7, 0.6 + rnd() * 1.1); dummy.updateMatrix();
    rockIM.setMatrixAt(i, dummy.matrix);
    addCollider(rx, rz, 1.0);
  }
  rockIM.castShadow = true; scene.add(rockIM);

  // district buildings: window-lit facades + neon signs (the 2d pads, in 3d)
  const districts = [
    { x: -62, z: -52, w: 26, d: 16, h: 13, name: 'ARCADE', col: '#a78bfa', seed: 7 },
    { x: 58, z: -54, w: 26, d: 16, h: 13, name: 'THEATER', col: '#f472b6', seed: 21 },
    { x: -64, z: 46, w: 22, d: 13, h: 10, name: 'BLOX', col: '#38bdf8', seed: 33 },
    { x: 62, z: 48, w: 22, d: 13, h: 10, name: 'CHAT', col: '#4ade80', seed: 48 },
    { x: 0, z: -80, w: 30, d: 14, h: 9, name: '6IX MUSIC', col: '#ffd257', seed: 59 },
  ];
  districts.forEach((b) => {
    const tex = windowsTexture(b.seed, b.col);
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfb8e8, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.85 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    m.position.set(b.x, b.h / 2, b.z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1.2, 0.5, b.d + 1.2), new THREE.MeshStandardMaterial({ color: 0x120b2c, roughness: 0.9 }));
    roof.position.set(b.x, b.h + 0.25, b.z); scene.add(roof);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(b.w * 0.8, 15), 3.3), new THREE.MeshBasicMaterial({ map: signTexture(b.name, b.col), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    const fz = b.z + (b.z < 0 ? b.d / 2 + 0.15 : -(b.d / 2 + 0.15));
    sign.position.set(b.x, b.h - 1.6, fz);
    if (b.z > 0) sign.rotation.y = Math.PI;
    scene.add(sign);
    boxColliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
    camBoxes.push({ minX: b.x - b.w / 2 - 0.4, maxX: b.x + b.w / 2 + 0.4, minZ: b.z - b.d / 2 - 0.4, maxZ: b.z + b.d / 2 + 0.4, h: b.h + 0.6 });
  });

  // drifting dust motes over the plaza
  const mN = 220, mPos = new Float32Array(mN * 3);
  for (let i = 0; i < mN; i++) { const a = rnd() * TAU, Rr = rnd() * 60; mPos[i * 3] = Math.cos(a) * Rr; mPos[i * 3 + 1] = 0.4 + rnd() * 6; mPos[i * 3 + 2] = Math.sin(a) * Rr; }
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  motes = new THREE.Points(mGeo, new THREE.PointsMaterial({ color: 0xa78bfa, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(motes);
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
    if (typeof r.bal === 'number') R.bal.textContent = '¢ ' + r.bal + ' six cents';
    R.who.textContent = '@' + me;
    R.count.textContent = (r.roster.length + 1) + ' here';
    const seen = new Set();
    for (const p of r.roster) {
      seen.add(p.u);
      let rm = remotes.get(p.u);
      if (!rm) {
        const group = makeAvatar(p.hue, p.u);
        group.position.set(p.x, 0, p.z);
        scene.add(group);
        rm = { group, tx: p.x, tz: p.z, try_: p.ry || 0, st: { phase: Math.random() * 6, speed: 0, grounded: true, landT: 0 }, lx: p.x, lz: p.z };
        remotes.set(p.u, rm);
      }
      rm.tx = p.x; rm.tz = p.z; rm.try_ = p.ry || 0;
    }
    for (const [u, rm] of remotes) {
      if (!seen.has(u)) { scene.remove(rm.group); disposeAvatar(rm.group); remotes.delete(u); }
    }
  } catch (e) { /* network blip: next ping retries; stale presence prunes server-side */ }
}

/* ---------- input: keyboard, pointer-lock mouse, drag, touch ---------- */
function doJump() { if (grounded) { vy = JUMP_V; grounded = false; } }
function onKey(down) {
  return (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    keys[e.code] = down;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Space' && down) doJump();
    if (e.code === 'KeyP' && down && R.set) R.set.hidden = !R.set.hidden;
    if (down) ensureAudio();
  };
}
const kd = onKey(true), ku = onKey(false);
function clearInput() {
  keys = {}; joyVec = { x: 0, y: 0 }; joyId = null; camPtrId = null; camLast = null; mouseDrag = false; sprintTouch = false;
  if (R.knob) R.knob.style.transform = 'translate(0px,0px)';
  if (R.sprint) R.sprint.classList.remove('on');
}
function onBlur() { clearInput(); }
function onVis() { if (document.hidden) clearInput(); }
function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
function applyCamDelta(dx, dy) {
  camYawT -= dx * 0.0021 * SET.sens;
  camPitchT = clamp(camPitchT + dy * 0.0019 * SET.sens, 0.06, 1.3);
}
function bindInput() {
  const cv = R.cv;
  cv.addEventListener('pointerdown', (e) => {
    ensureAudio();
    if (e.pointerType === 'touch') {
      if (camPtrId === null) { camPtrId = e.pointerId; camLast = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (err) { } }
    } else {
      if (e.button !== 0) return;
      mouseDrag = true; camLast = { x: e.clientX, y: e.clientY };
      if (document.pointerLockElement !== cv) { try { const pr = cv.requestPointerLock && cv.requestPointerLock(); if (pr && pr.catch) pr.catch(() => { }); } catch (err) { } }
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (document.pointerLockElement === cv && e.pointerType === 'mouse') { applyCamDelta(e.movementX || 0, e.movementY || 0); return; }
    const active = e.pointerType === 'touch' ? (e.pointerId === camPtrId) : mouseDrag;
    if (!active || !camLast) return;
    applyCamDelta(e.clientX - camLast.x, e.clientY - camLast.y);
    camLast = { x: e.clientX, y: e.clientY };
  });
  const endPtr = (e) => {
    if (e.pointerId === camPtrId) { camPtrId = null; camLast = null; }
    if (e.pointerType === 'mouse') mouseDrag = false;
  };
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);

  // dynamic-origin joystick: the stick appears where the thumb lands
  const zone = R.joyzone, joy = R.joy, knob = R.knob;
  zone.addEventListener('pointerdown', (e) => {
    ensureAudio();
    if (joyId !== null) return;
    joyId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch (err) { }
    const zr = zone.getBoundingClientRect();
    const cx = clamp(e.clientX - zr.left, 62, zr.width - 10), cy = clamp(e.clientY - zr.top, 62, zr.height - 10);
    joy.style.left = (cx - 62) + 'px'; joy.style.top = (cy - 62) + 'px'; joy.style.bottom = 'auto';
    joyCenter = { x: zr.left + cx, y: zr.top + cy };
    moveJoy(e);
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) moveJoy(e); });
  const endJoy = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null; joyVec = { x: 0, y: 0 }; joyCenter = null;
    knob.style.transform = 'translate(0px,0px)';
    joy.style.left = ''; joy.style.top = ''; joy.style.bottom = '';
  };
  zone.addEventListener('pointerup', endJoy); zone.addEventListener('pointercancel', endJoy);
  function moveJoy(e) {
    if (!joyCenter) return;
    let dx = (e.clientX - joyCenter.x) / 52, dy = (e.clientY - joyCenter.y) / 52;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    joyVec = { x: dx, y: dy };
    knob.style.transform = 'translate(' + (dx * 34) + 'px,' + (dy * 34) + 'px)';
  }
  R.jump.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); doJump(); });
  R.sprint.addEventListener('pointerdown', (e) => { e.preventDefault(); sprintTouch = true; R.sprint.classList.add('on'); });
  const endSprint = () => { sprintTouch = false; R.sprint.classList.remove('on'); };
  R.sprint.addEventListener('pointerup', endSprint); R.sprint.addEventListener('pointercancel', endSprint); R.sprint.addEventListener('pointerleave', endSprint);
  document.addEventListener('pointerdown', function firstTouch(e) {
    if (e.pointerType === 'touch') document.body.classList.add('touch');
  });
}

/* ---------- camera collision: shorten the boom, never clip ---------- */
function segSphereT(ax, ay, az, bx, by, bz, s) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const fx = ax - s.x, fy = ay - s.y, fz = az - s.z;
  const A = dx * dx + dy * dy + dz * dz; if (A < 1e-6) return -1;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - s.r * s.r;
  let disc = B * B - 4 * A * C; if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t = (-B - disc) / (2 * A);
  return (t >= 0 && t <= 1) ? t : -1;
}
function segBoxT(ax, ay, az, bx, by, bz, b) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let t0 = 0, t1 = 1;
  const axes = [[ax, dx, b.minX, b.maxX], [ay, dy, 0, b.h], [az, dz, b.minZ, b.maxZ]];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) return -1; }
    else {
      let ta = (mn - o) / d, tb = (mx - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return -1;
    }
  }
  return t0;
}
function updateCamera(dt) {
  const kA = dampK(18, dt);
  camYaw = angLerp(camYaw, camYawT, kA);
  camPitch += (camPitchT - camPitch) * kA;
  if (Math.abs(angWrap(camYawT - camYaw)) < 0.0005) { camYaw = angWrap(camYaw); camYawT = camYaw; }
  const kF = dampK(14, dt);
  followX += (px - followX) * kF;
  followZ += (pz - followZ) * kF;
  followY += ((SET.camH + py) - followY) * dampK(8, dt);
  const hx = followX, hy = followY + 0.35, hz = followZ;
  const cx = hx - Math.sin(camYaw) * Math.cos(camPitch) * SET.camDist;
  const cz = hz - Math.cos(camYaw) * Math.cos(camPitch) * SET.camDist;
  const cy = hy + Math.sin(camPitch) * SET.camDist;
  let maxT = 1;
  for (const s of camSpheres) { const t = segSphereT(hx, hy, hz, cx, cy, cz, s); if (t >= 0) maxT = Math.min(maxT, t); }
  for (const b of camBoxes) { const t = segBoxT(hx, hy, hz, cx, cy, cz, b); if (t >= 0) maxT = Math.min(maxT, t); }
  const wantDist = SET.camDist * clamp(maxT * 0.94, 0.12, 1);
  const rate = wantDist < camDistEff ? 22 : 6; // pull in fast, ease back out
  camDistEff += (wantDist - camDistEff) * dampK(rate, dt);
  const inv = camDistEff / SET.camDist;
  camera.position.set(hx + (cx - hx) * inv, Math.max(0.55, hy + (cy - hy) * inv), hz + (cz - hz) * inv);
  _v3.set(followX, followY + 0.15, followZ);
  camera.lookAt(_v3);
}

/* ---------- main loop (the ONLY loop) ---------- */
const mySt = { phase: 0, speed: 0, grounded: true, landT: 0 };
let firstFrame = true;
function loop() {
  if (disposed) return;
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (dt > 0) fpsEma += ((1 / Math.max(dt, 1e-4)) - fpsEma) * 0.05;
  const now = performance.now();

  // input direction (keyboard + joystick), camera-relative.
  // input is dead until READY and while a transition screen is active.
  let ix = 0, iz = 0;
  if (!transitioning) {
  if (keys.KeyW || keys.ArrowUp) iz -= 1;
  if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  ix += joyVec.x; iz += joyVec.y;
  }
  const mag = Math.hypot(ix, iz);
  const sprinting = !!(keys.ShiftLeft || keys.ShiftRight || sprintTouch) || (joyId !== null && Math.hypot(joyVec.x, joyVec.y) > 0.94);
  let dvx = 0, dvz = 0;
  if (mag > 0.08) {
    const cl = Math.min(1, mag);
    const nx = ix / (mag || 1), nz = iz / (mag || 1);
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    // camera basis: forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw).
    // (the v1/v2-first-cut rotation was inverted — W walked TOWARD the
    // camera and A/D were swapped. caught by the portal steering test.)
    const wx = -nx * cos - nz * sin, wz = nx * sin - nz * cos;
    const sp = (sprinting ? SPRINT : WALK) * cl;
    dvx = wx * sp; dvz = wz * sp;
  }
  // velocity approach: fast accel, faster stop (no glide, no stuck keys)
  const rate = (dvx || dvz) ? ACCEL : DECEL;
  const dvxD = dvx - vx, dvzD = dvz - vz, dl = Math.hypot(dvxD, dvzD), maxD = rate * dt;
  if (dl > 0.001) { const f = Math.min(1, maxD / dl); vx += dvxD * f; vz += dvzD * f; }
  px += vx * dt; pz += vz * dt;
  const spd = Math.hypot(vx, vz);
  speedSm += (spd - speedSm) * dampK(12, dt);
  if (spd > 0.7) ry = angLerp(ry, Math.atan2(vx, vz), dampK(TURN, dt));

  // gravity / jump / land
  wasGrounded = grounded;
  if (!grounded) {
    py += vy * dt; vy -= GRAV * dt;
    if (py <= 0) { py = 0; vy = 0; grounded = true; }
  }
  if (!wasGrounded && grounded) mySt.landT = 0.16;

  // bounds + colliders
  px = clamp(px, -BOUND_X, BOUND_X); pz = clamp(pz, -BOUND_Z, BOUND_Z);
  for (const c of colliders) {
    const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz), min = c.r + 0.55;
    if (d > 0.001 && d < min) { px = c.x + dx / d * min; pz = c.z + dz / d * min; }
  }
  for (const b of boxColliders) {
    const nx = clamp(px, b.minX, b.maxX), nz = clamp(pz, b.minZ, b.maxZ);
    const dx = px - nx, dz = pz - nz, d = Math.hypot(dx, dz);
    if (d > 0.001 && d < 0.55) { px = nx + dx / d * 0.55; pz = nz + dz / d * 0.55; }
    else if (d <= 0.001) { // inside: push out the shallowest side
      const pl = px - b.minX, pr = b.maxX - px, pt = pz - b.minZ, pb = b.maxZ - pz;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) px = b.minX - 0.55; else if (m === pr) px = b.maxX + 0.55; else if (m === pt) pz = b.minZ - 0.55; else pz = b.maxZ + 0.55;
    }
  }

  // my avatar + animation
  const meGroup = scene.userData.meGroup;
  if (meGroup) {
    meGroup.position.set(px, py, pz);
    meGroup.rotation.y = ry;
    mySt.speed = speedSm; mySt.grounded = grounded;
    animateAvatar(meGroup, mySt, dt, now);
  }
  // remotes: interpolate + animate from their real speed
  for (const rm of remotes.values()) {
    const g = rm.group, k = dampK(10, dt);
    const ox = g.position.x, oz = g.position.z;
    g.position.x += (rm.tx - g.position.x) * k;
    g.position.z += (rm.tz - g.position.z) * k;
    const inst = dt > 0 ? Math.hypot(g.position.x - ox, g.position.z - oz) / dt : 0;
    rm.st.speed += (inst - rm.st.speed) * dampK(8, dt);
    g.rotation.y = angLerp(g.rotation.y, rm.try_, k);
    animateAvatar(g, rm.st, dt, now);
  }

  // ambient life: portal swirl, fountain spray + water, orb pulse, motes
  if (portalRing) { portalRing.rotation.z = now / 600; portalRing.scale.setScalar(1 + Math.sin(now / 480) * 0.04); }
  if (portalPts) portalPts.rotation.z = -now / 2400;
  if (portalDisc) portalDisc.material.opacity = 0.3 + Math.sin(now / 700) * 0.09;
  const pg = scene.userData.portalGroup;
  if (pg && pg.userData.rune) pg.userData.rune.rotation.z = now / 5000;
  if (fountainOrb) { const s = 1 + Math.sin(now / 900) * 0.06; fountainOrb.scale.setScalar(s); fountainOrb.position.y = 3.9 + Math.sin(now / 900) * 0.07; }
  if (fountainWater) fountainWater.material.map.rotation += dt * 0.03;
  if (spray) {
    const pos = spray.geometry.attributes.position, dat = spray.userData.dat;
    for (let i = 0; i < dat.length; i++) {
      const d = dat[i]; d.ph += dt * 0.5; if (d.ph > 1) d.ph -= 1;
      const rr2 = d.r * (0.25 + d.ph * 1.9);
      pos.array[i * 3] = Math.cos(d.a) * rr2;
      pos.array[i * 3 + 1] = 3.55 + Math.sin(d.ph * Math.PI) * 1.15 - d.ph * 1.35;
      pos.array[i * 3 + 2] = Math.sin(d.a) * rr2;
    }
    pos.needsUpdate = true;
  }
  if (motes) { motes.rotation.y = now / 90000; motes.position.y = Math.sin(now / 3400) * 0.35; }

  // return-portal proximity -> action button
  const nearPortal = Math.hypot(px - PORTAL.x, pz - PORTAL.z) < 5.2;
  if (String(nearPortal) !== R.act.dataset.on) { R.act.dataset.on = String(nearPortal); R.act.hidden = !nearPortal; }
  if (toastAt && now > toastAt) { R.toast.hidden = true; toastAt = 0; }

  const connLost = booted && lastPingOk && (now - lastPingOk > 3200);
  if (R.conn && connLost !== R.conn.dataset.on) { R.conn.dataset.on = connLost; R.conn.hidden = !connLost; }
  updateCamera(dt);

  pingTimer += dt;
  if (pingTimer > 0.45) { pingTimer = 0; ping(); }
  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    setLoad(100, 'READY');
    booted = true; window.__w3booted = true;
    window.__w3state = function () {
      return { x: px, z: pz, y: py, ry, camYaw, camPitch, camDist: camDistEff, speed: speedSm, sprinting: !!(keys.ShiftLeft || keys.ShiftRight || sprintTouch), grounded, booted, state: bootState, remotes: remotes.size, fps: Math.round(fpsEma) };
    };
    if (window.__w3watchdog) clearTimeout(window.__w3watchdog);
    if (flavorTimer) { clearInterval(flavorTimer); flavorTimer = 0; }
    loadDone = true;
    R.wrap.classList.add('ready');
    setTimeout(() => { R.load.classList.add('hide'); }, 300);
    if (new URLSearchParams(location.search).get('from') === 'portal') toast('✦ u crossed over. wasd + mouse — click the world to lock the camera', 5200);
  }
}

function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function cleanup() {
  if (disposed) return; disposed = true;
  stopLoop();
  if (flavorTimer) { clearInterval(flavorTimer); flavorTimer = 0; }
  window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
  window.removeEventListener('resize', onResize); window.removeEventListener('blur', onBlur);
  document.removeEventListener('visibilitychange', onVis);
  if (document.exitPointerLock) document.exitPointerLock();
  if (AC && AC.close) AC.close();
  if (scene) scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
  });
  if (renderer) renderer.dispose();
}

/* ---------- return through the portal ---------- */
function goBack() {
  if (transitioning) return; transitioning = true;
  R.load.classList.add('show'); R.load.classList.remove('hide');
  if (R.loadmsg) R.loadmsg.textContent = 'crossing back…';
  try { navigator.sendBeacon && navigator.sendBeacon('/api/world3d/leave', new Blob(['{}'], { type: 'application/json' })); } catch (e) { }
  setTimeout(() => { location.href = '/world'; }, 650);
}

/* ---------- settings UI ---------- */
function bindSettings() {
  R.sens.value = SET.sens; R.camd.value = SET.camDist; R.camh.value = SET.camH; R.gfxsel.value = SET.gfx;
  R.shadow.checked = SET.shadows; R.snd.checked = SET.snd; R.vol.value = SET.vol;
  R.setbtn.addEventListener('click', () => { R.set.hidden = !R.set.hidden; });
  R.setclose.addEventListener('click', () => { R.set.hidden = true; });
  R.sens.addEventListener('input', () => { SET.sens = parseFloat(R.sens.value) || 1; saveSet(); });
  R.camd.addEventListener('input', () => { SET.camDist = parseFloat(R.camd.value) || 13; saveSet(); });
  R.camh.addEventListener('input', () => { SET.camH = parseFloat(R.camh.value) || 1.7; saveSet(); });
  R.gfxsel.addEventListener('change', () => { SET.gfx = R.gfxsel.value; saveSet(); applyGfx(); toast('graphics: ' + SET.gfx); });
  R.shadow.addEventListener('change', () => { SET.shadows = R.shadow.checked; saveSet(); applyGfx(); });
  R.snd.addEventListener('change', () => { SET.snd = R.snd.checked; saveSet(); applyAudio(); });
  R.vol.addEventListener('input', () => { SET.vol = parseFloat(R.vol.value) || 0; saveSet(); applyAudio(); });
}

/* ---------- boot: checkpoints are real events, not fake numbers ---------- */
function init() {
  R.barfill = $('w3barfill'); R.loadpct = $('w3loadpct'); R.loadmsg = $('w3loadmsg'); R.loaderr = $('w3loaderr'); R.loadbtns = $('w3loadbtns');
  R.load = $('w3load'); R.wrap = $('w3wrap'); R.cv = $('w3cv'); R.bal = $('w3bal'); R.who = $('w3who'); R.count = $('w3count');
  R.toast = $('w3toast'); R.act = $('w3act'); R.conn = $('w3conn'); R.camh = $('w3camh'); R.joy = $('w3joy'); R.knob = $('w3knob'); R.joyzone = $('w3joyzone');
  R.jump = $('w3jump'); R.sprint = $('w3sprint'); R.setbtn = $('w3setbtn'); R.set = $('w3set'); R.setclose = $('w3setclose');
  R.sens = $('w3sens'); R.camd = $('w3camd'); R.gfxsel = $('w3gfxsel'); R.shadow = $('w3shadow'); R.snd = $('w3snd'); R.vol = $('w3vol');

  flavorTimer = setInterval(() => { if (!loadDone && R.loadmsg) { flavorI = (flavorI + 1) % FLAVOR.length; R.loadmsg.textContent = FLAVOR[flavorI]; } }, 1500);
  setLoad(16, 'LOADING_ASSETS'); // checkpoint: engine module + three.js executing

  try {
    renderer = new THREE.WebGLRenderer({ canvas: R.cv, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    loadError('WebGL could not start on this device/browser: ' + (e && e.message ? e.message : e));
    return;
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 900);
  clock = new THREE.Clock();
  setLoad(38, 'BUILDING_WORLD'); // checkpoint: renderer + WebGL context live

  buildWorld();
  const mine = makeAvatar(null);
  mine.position.set(px, 0, pz);
  scene.add(mine); scene.userData.meGroup = mine;
  applyGfx();
  setLoad(60, 'INITIALIZING_PLAYER'); // checkpoint: world built, avatar spawned

  R.cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stopLoop(); loadError('the WebGL context was lost (gpu hiccup or too many tabs). tap retry to re-enter.'); }, false);
  R.cv.addEventListener('webglcontextrestored', () => { toast('context restored'); if (!raf && !disposed) raf = requestAnimationFrame(loop); }, false);

  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  window.addEventListener('resize', onResize); window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', () => { try { navigator.sendBeacon && navigator.sendBeacon('/api/world3d/leave', new Blob(['{}'], { type: 'application/json' })); } catch (e) { } cleanup(); });
  bindInput();
  bindSettings();
  R.act.addEventListener('click', goBack);

  ping().then(() => {
    if (window.__w3fatal) return;
    setLoad(84, 'INITIALIZING_CONTROLS'); // checkpoint: server hello answered; controls bound
    raf = requestAnimationFrame(loop); // first frame completes the load at 100
  }).catch((e) => { loadError('could not reach the world server: ' + (e && e.message ? e.message : e)); });
}

try { init(); } catch (e) { loadError('the 3d engine hit an error: ' + (e && e.message ? e.message : e)); }
