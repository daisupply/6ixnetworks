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
import { angWrap, angLerp, dampK, normInput, moveVec, segSphereT, segBoxT, groundH, fbm2, ridge2, terrainWeights, terrainChunkGrid, terrainChunkIndex, TERR_CHUNK, WATER_Y } from './math3d.js';
import { planChunks, genChunkVeg, isApronChunk, VEG_TREES, settlements, chunkWater, landmarks } from './worldgen.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skelClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const TAU = Math.PI * 2;
// deterministic rng so the plaza layout is designed, not scattered
function mulberry32(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const PORTAL = { x: 22, z: 0 };
let DISTRICT_REFS = [];
const BOUND_X = 195, BOUND_Z = 118;
const WALK = 15, SPRINT = 26, ACCEL = 90, DECEL = 120, TURN = 14;
const GRAV = 30, JUMP_V = 11.5;

/* ---------- settings (persisted) ---------- */
const SET_DEF = { sens: 1, camDist: 13, camH: 1.7, gfx: 'auto', shadows: true, snd: false, vol: 0.5, view: 'fp', fov: 72, bob: true, sfx: 0.8 };
let SET = { ...SET_DEF };
try { const s = JSON.parse(localStorage.getItem('w3settings') || 'null'); if (s) SET = { ...SET_DEF, ...s }; } catch (e) { }
function saveSet() { try { localStorage.setItem('w3settings', JSON.stringify(SET)); } catch (e) { } }

/* ---------- state ---------- */
let renderer = null, scene = null, camera = null, raf = 0, clock = null;
let disposed = false, booted = false;
let me = '', mySid = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let px = 0, pz = 18, py = 0, vy = 0, grounded = true, ry = Math.PI;
let groundY = 0; // stage 08: terrain height under the player (town only)
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
    acFilter = f;
    acSfx = AC.createGain(); acSfx.gain.value = 0.9; acSfx.connect(AC.destination);
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
  if (acMaster) acMaster.gain.value = SET.vol * ((AMB[ambZone] || AMB.town).g);
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
  const hatA = new THREE.Group(); hatA.position.set(0, 0.28, 0); head.add(hatA);
  const hairA = new THREE.Group(); hairA.position.set(0, 0.3, -0.02); head.add(hairA);
  const faceA = new THREE.Group(); faceA.position.set(0, 0.02, 0.32); head.add(faceA);
  parts.hatA = hatA; parts.hairA = hairA; parts.faceA = faceA;
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
  if (st.pose === 'sit') {
    P.legL.rotation.x = -1.1; P.legR.rotation.x = -1.1;
    P.armL.rotation.x = -0.45; P.armR.rotation.x = -0.45;
    P.armL.rotation.z = 0.14; P.armR.rotation.z = -0.14;
    P.body.position.y = 1.32; P.head.position.y = 2.06; P.body.rotation.x = 0.05;
    g.scale.set(1, 1 + Math.sin(now / 620) * 0.008, 1);
    return;
  }
  if (st.emote === 'wave') {
    P.legL.rotation.x = 0; P.legR.rotation.x = 0;
    P.armL.rotation.x = 0; P.armL.rotation.z = 0.08;
    P.armR.rotation.x = -2.4; P.armR.rotation.z = -0.35 + Math.sin(now / 130) * 0.5;
    P.body.position.y = 1.32; P.head.position.y = 2.06; P.body.rotation.x = 0;
    g.scale.set(1, 1 + Math.sin(now / 620) * 0.01, 1);
    return;
  }
  if (st.emote === 'celebrate') {
    P.legL.rotation.x = 0.12; P.legR.rotation.x = -0.12;
    P.armL.rotation.x = -2.9; P.armR.rotation.x = -2.9;
    P.armL.rotation.z = 0.55; P.armR.rotation.z = -0.55;
    const hop = Math.abs(Math.sin(now / 210)) * 0.15;
    P.body.position.y = 1.32 + hop; P.head.position.y = 2.06 + hop;
    P.body.rotation.x = 0; P.star.rotation.z = now / 300;
    g.scale.set(1, 1, 1);
    return;
  }
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
let autoCap = 2; const TIERS3 = ['low', 'medium', 'high'];
function tierOf() { if (SET.gfx !== 'auto') return SET.gfx; const base = window.matchMedia('(pointer: coarse)').matches ? 1 : 2; return TIERS3[Math.min(base, autoCap)]; }
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
/* ============ TERRAIN PASS: chunked procedural heightfield =========
 * The ground is built from fixed world-coordinate chunks (55u each,
 * 22x22 segments, one shared material). Every chunk is independently
 * reproducible from groundH alone: generation takes no player state,
 * no Math.random, no build order into account, and the registry
 * guarantees a chunk is generated at most once. Border vertices are
 * sampled at identical world coordinates by both neighbours, and
 * normals come from a 1-vertex halo grid sampled from the same pure
 * function, so adjacent chunks agree on heights AND normals exactly
 * — no seams, no cracks. Since worldgen Stage 3 the apron grid
 * below is the pinned core of a streaming manager: chunks beyond
 * it build and evict around the player (plan in worldgen.js);
 * buildings never unload, terrain streams.
 * Materials: five CC0 Poly Haven ground layers (grass / forest floor
 * / dry dirt / rocky ground / shore sand) blended per-vertex by
 * biome, slope, height and moisture weights computed from the same
 * terrain data, then mixed in the shader at two world-space scales
 * (7u detail + 23u breakup) so tiling never reads as a grid, with a
 * weighted normal-map blend for surface relief. ==================== */
const TERRAIN_CHUNKS = new Map();
let TERR_INDEX = null, terrainTex = null, terrainTexState = null;
function terrainPlaceholder(rgb, srgb) {
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const g = c.getContext('2d'); g.fillStyle = rgb; g.fillRect(0, 0, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function terrainTextures() {
  if (terrainTex) return terrainTex;
  const layers = {
    grass: ['#66793f', 'grass_diff', 'grass_nor'], forest: ['#4d4433', 'forest_diff', 'forest_nor'],
    dirt: ['#77603f', 'dirt_diff', 'dirt_nor'], rock: ['#8a8478', 'rock_diff', 'rock_nor'],
    sand: ['#c9b489', 'sand_diff', 'sand_nor'],
  };
  terrainTex = {};
  terrainTexState = { loaded: 0, failed: [] };
  const loader = new THREE.TextureLoader();
  for (const k of Object.keys(layers)) {
    const d = terrainPlaceholder(layers[k][0], true), n = terrainPlaceholder('rgb(128,128,255)', false);
    terrainTex[k] = { d, n };
    // the placeholder textures are the terrain's textures for
    // life: a successful load swaps the image into the same
    // texture object (colorspace, wrapping and anisotropy were
    // set on the placeholder and carry over), a failure keeps
    // the placeholder and is recorded — terrain never breaks.
    for (const [tex, file] of [[d, layers[k][1]], [n, layers[k][2]]]) {
      loader.load('/world3d/assets/terrain/' + file + '.webp',
        (lt) => { tex.image = lt.image; tex.needsUpdate = true; terrainTexState.loaded++; },
        undefined,
        () => { terrainTexState.failed.push(file); console.warn('[world3d] terrain texture failed to load, placeholder stays: ' + file); });
    }
  }
  return terrainTex;
}
function terrainMaterial() {
  const T = terrainTextures();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTG = { value: T.grass.d }; sh.uniforms.uTF = { value: T.forest.d };
    sh.uniforms.uTD = { value: T.dirt.d }; sh.uniforms.uTR = { value: T.rock.d };
    sh.uniforms.uTS = { value: T.sand.d };
    sh.uniforms.uTGn = { value: T.grass.n }; sh.uniforms.uTFn = { value: T.forest.n };
    sh.uniforms.uTDn = { value: T.dirt.n }; sh.uniforms.uTRn = { value: T.rock.n };
    sh.uniforms.uTSn = { value: T.sand.n };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aW1; attribute float aSand; varying vec4 vW1; varying float vSand; varying vec3 vWPos; varying vec3 vNormO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW1 = aW1; vSand = aSand; vWPos = position; vNormO = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uTG; uniform sampler2D uTF; uniform sampler2D uTD; uniform sampler2D uTR; uniform sampler2D uTS;\nuniform sampler2D uTGn; uniform sampler2D uTFn; uniform sampler2D uTDn; uniform sampler2D uTRn; uniform sampler2D uTSn;\nvarying vec4 vW1; varying float vSand; varying vec3 vWPos; varying vec3 vNormO;\nvec3 terrMixD(sampler2D t, vec2 a, vec2 b, float m) { return mix(texture2D(t, a), texture2D(t, b), m).rgb; }\nvec2 terrRot(vec2 uv, float c, float s) { return vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c); }\nfloat terrHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat terrNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(terrHash(i), terrHash(i + vec2(1, 0)), f.x), mix(terrHash(i + vec2(0, 1)), terrHash(i + vec2(1, 1)), f.x), f.y); }\nvec3 terrPerturb(vec3 e, vec3 n, vec3 m, vec2 uv) { vec3 q0 = dFdx(e); vec3 q1 = dFdy(e); vec2 s0 = dFdx(uv); vec2 s1 = dFdy(uv); vec3 S = normalize(q0 * s1.t - q1 * s0.t); vec3 T2 = normalize(-q0 * s1.s + q1 * s0.s); return normalize(T2 * m.x + S * m.y + n * m.z); }\nvec3 terrNrm(sampler2D t, vec2 a, vec2 b, float c, float s, float m, float str) { vec3 na = texture2D(t, a).rgb * 2.0 - 1.0; vec3 nb = texture2D(t, b).rgb * 2.0 - 1.0; nb.xy = terrRot(nb.xy, c, -s); vec3 n = mix(na, nb, m); n.xy *= str; return n; }')
      .replace('#include <map_fragment>', 'vec2 tUvA = vWPos.xz * 0.142857; vec2 tB = vWPos.xz * 0.052632;\nvec2 bG = terrRot(tB, 0.906, 0.423); vec2 bF = terrRot(tB, 0.799, 0.602); vec2 bD = terrRot(tB, 0.326, 0.946); vec2 bR = terrRot(tB, 0.966, 0.259); vec2 bS = terrRot(tB, 0.602, 0.799);\nfloat tSum = max(vW1.x + vW1.y + vW1.z + vW1.w + vSand, 1e-4);\nvec3 cG = terrMixD(uTG, tUvA, bG, 0.30);\nvec3 cF = terrMixD(uTF, tUvA, bF, 0.42);\nvec3 cD = terrMixD(uTD, tUvA, bD, 0.40);\nvec3 cS = terrMixD(uTS, tUvA, bS, 0.30);\nfloat tSideW = (1.0 - smoothstep(0.60, 0.88, abs(normalize(vNormO).y))) * step(0.001, vW1.w);\nvec2 tUvSide = (abs(vNormO.z) >= abs(vNormO.x) ? vWPos.xy : vWPos.zy) * 0.142857;\nvec3 rockTop = texture2D(uTR, tUvA).rgb;\nvec3 rockSide = texture2D(uTR, tUvSide).rgb;\nvec3 cR = mix(mix(rockTop, texture2D(uTR, bR).rgb, 0.38), rockSide, tSideW * 0.85);\nfloat tMicro = 0.94 + 0.12 * (0.6 * terrNoise(vWPos.xz * 0.59) + 0.4 * terrNoise(vWPos.xz * 1.7));\nvec3 tAlb = (cG * vW1.x + cF * vW1.y + cD * vW1.z + cR * vW1.w + cS * vSand) / tSum * tMicro;\ndiffuseColor.rgb = tAlb;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(0.93 * vW1.x + 0.97 * vW1.y + 0.88 * vW1.z + 0.96 * vW1.w + 0.85 * vSand, 0.8, 1.0);')
      .replace('#include <normal_fragment_maps>', 'vec3 nG = terrNrm(uTGn, tUvA, bG, 0.906, 0.423, 0.30, 0.55);\nvec3 nF = terrNrm(uTFn, tUvA, bF, 0.799, 0.602, 0.42, 0.70);\nvec3 nD = terrNrm(uTDn, tUvA, bD, 0.326, 0.946, 0.40, 0.60);\nvec3 nR = terrNrm(uTRn, tUvA, bR, 0.966, 0.259, 0.38, 0.95);\nvec3 nSd = texture2D(uTRn, tUvSide).rgb * 2.0 - 1.0;\nvec3 nRs = (abs(vNormO.z) >= abs(vNormO.x)) ? vec3(nSd.x, nSd.z * sign(vNormO.z), nSd.y) : vec3(nSd.z * sign(vNormO.x), nSd.x, nSd.y);\nnRs.xy *= 0.95;\nnR = mix(nR, nRs, tSideW);\nvec3 nS = terrNrm(uTSn, tUvA, bS, 0.602, 0.799, 0.30, 0.35);\nvec3 tN = nG * vW1.x + nF * vW1.y + nD * vW1.z + nR * vW1.w + nS * vSand;\ntN = normalize(tN / tSum + vec3(0.0, 0.0, 0.02));\ntN.xy *= mix(0.22, 1.0, exp(-length(vViewPosition) / 130.0));\nnormal = terrPerturb(-vViewPosition, normal, tN, tUvA);');
  };
  mat.customProgramCacheKey = () => 'terrain-pass-5';
  return mat;
}
let TERR_INDEX_FLAT = null;
function buildTerrainChunk(cx, cz) {
  const key = cx + ',' + cz;
  if (TERRAIN_CHUNKS.has(key)) return TERRAIN_CHUNKS.get(key);
  // grid generation lives in math3d.js (terrainChunkGrid) so the
  // Node test suite exercises the exact code the browser renders.
  const gr = terrainChunkGrid(cx, cz);
  let index = gr.flat ? TERR_INDEX_FLAT : TERR_INDEX;
  if (!index) {
    index = terrainChunkIndex(gr.seg);
    if (gr.flat) TERR_INDEX_FLAT = index; else TERR_INDEX = index;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(gr.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(gr.nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(gr.col, 3));
  g.setAttribute('aW1', new THREE.BufferAttribute(gr.w1, 4));
  g.setAttribute('aSand', new THREE.BufferAttribute(gr.wS, 1));
  g.setAttribute('uv', new THREE.BufferAttribute(gr.uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  TERRAIN_CHUNKS.set(key, g);
  return g;
}
let terrMat = null, terrGroup = null;
const TERRAIN_MESHES = new Map();
let terrBuildQ = [], terrCellCx = null, terrCellCz = null;
/* wild water (worldgen Stage 7): one shared material at the
 * shared WATER_Y level; a quad rides its terrain chunk's
 * lifecycle iff chunkWater says the chunk dips below the level.
 * apron chunks never qualify — the town pond stays its own disc. */
const WATER_MESHES = new Map();
let wildWaterMat = null;
function ensureWaterQuad(cx, cz, key) {
  if (!chunkWater(cx, cz).has) return;
  if (!wildWaterMat) wildWaterMat = new THREE.MeshStandardMaterial({ map: waterTexture(), roughness: 0.15, metalness: 0.25, emissive: 0x0d3355, emissiveIntensity: 0.6, transparent: true, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: -2 });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(TERR_CHUNK, TERR_CHUNK), wildWaterMat);
  q.rotation.x = -Math.PI / 2;
  q.position.set(cx * TERR_CHUNK + TERR_CHUNK / 2, WATER_Y + 0.02, cz * TERR_CHUNK + TERR_CHUNK / 2);
  q.receiveShadow = true;
  terrGroup.add(q);
  WATER_MESHES.set(key, q);
}
function evictWaterQuad(key) {
  const q = WATER_MESHES.get(key);
  if (!q) return;
  terrGroup.remove(q);
  q.geometry.dispose(); // the shared material is NOT disposed
  WATER_MESHES.delete(key);
}
function ensureChunkMesh(cx, cz) {
  const key = cx + ',' + cz;
  if (TERRAIN_MESHES.has(key)) return;
  const mesh = new THREE.Mesh(buildTerrainChunk(cx, cz), terrMat);
  mesh.receiveShadow = true;
  terrGroup.add(mesh);
  TERRAIN_MESHES.set(key, mesh);
  ensureWaterQuad(cx, cz, key);
}
function evictChunk(key) {
  const mesh = TERRAIN_MESHES.get(key);
  if (!mesh) return;
  terrGroup.remove(mesh);
  TERRAIN_MESHES.delete(key);
  evictWaterQuad(key);
  evictVeg(key);
  // drop the cached geometry too, or the cache grows forever on a
  // long trek. the shared index arrays (TERR_INDEX*) and the shared
  // material/textures are NOT disposed — other chunks use them.
  const g = TERRAIN_CHUNKS.get(key);
  if (g) { g.dispose(); TERRAIN_CHUNKS.delete(key); }
}
function buildTerrain() {
  terrGroup = new THREE.Group();
  terrMat = terrainMaterial();
  for (let cx = -5; cx < 5; cx++) for (let cz = -4; cz < 4; cz++) ensureChunkMesh(cx, cz);
  return terrGroup;
}
/* terrain streaming (worldgen Stage 3): the apron above is pinned;
 * beyond it, chunks build/evict around the player per the pure
 * plan in worldgen.js (STREAM_R build / EVICT_R evict). town zone
 * only — interiors sit at x~2000 where no terrain may ever
 * generate. the plan recomputes on chunk-boundary crossings;
 * builds drain at <=2 per frame, nearest first. */
function tickTerrainStreaming() {
  if (!terrGroup || zoneNow() !== 'town') { terrBuildQ.length = 0; terrCellCx = null; return; }
  const ccx = Math.floor(px / TERR_CHUNK), ccz = Math.floor(pz / TERR_CHUNK);
  if (ccx !== terrCellCx || ccz !== terrCellCz) {
    terrCellCx = ccx; terrCellCz = ccz;
    const plan = planChunks(new Set(TERRAIN_MESHES.keys()), px, pz);
    for (const key of plan.evict) evictChunk(key);
    terrBuildQ = plan.build.map(w => [w.cx, w.cz]);
  }
  let n = 0;
  while (terrBuildQ.length && n < 2) {
    const q = terrBuildQ.shift(); ensureChunkMesh(q[0], q[1]);
    if (!isApronChunk(q[0], q[1])) terrVegQ.push(q[0] + ',' + q[1]);
    n++;
  }
  let vn = 0;
  while (terrVegQ.length && vn < 2) { const key = terrVegQ.shift(); const i = key.indexOf(','); ensureVegChunk(+key.slice(0, i), +key.slice(i + 1)); vn++; }
  tickSettlements();
  tickLandmarks();
}

/* wild vegetation (worldgen Stage 4): per-chunk instanced meshes
 * from genChunkVeg descriptors — pure, cell-seeded, identical on
 * every client. trees render through their decimated _LOD parts
 * (the same approved models town trees use at distance); shrubs,
 * rocks and grass through their full parts. parts are cached per
 * species and SHARED across chunks: eviction disposes only each
 * InstancedMesh's own instance buffers, never the shared
 * geometry/materials. no colliders for wild vegetation — the
 * per-frame collider sweep stays town-sized on purpose. */
const VEG_MESHES = new Map();
const WILD_PARTS = new Map();
const WILD_WAITERS = new Map();
let terrVegQ = [];
const VEG_LOD = new Set([...VEG_TREES.broad, ...VEG_TREES.pine, ...VEG_TREES.twisted, ...VEG_TREES.dead, ...VEG_TREES.sakura]);
function wildParts(name, cb) {
  const got = WILD_PARTS.get(name);
  if (got && got !== 'pending') { cb(got); return; }
  if (got === 'pending') { const w = WILD_WAITERS.get(name) || []; w.push(cb); WILD_WAITERS.set(name, w); return; }
  WILD_PARTS.set(name, 'pending');
  WILD_WAITERS.set(name, [cb]);
  loadAsset(NAT + name + (VEG_LOD.has(name) ? '_LOD' : '') + '.glb', 60).then((proto) => {
    let parts = null;
    if (proto) {
      parts = lodParts(proto);
      if (name.indexOf('Grass_') === 0) parts = parts.map((p) => { const m = p.material.clone(); m.emissive = new THREE.Color(0x1c2a0e); m.emissiveIntensity = 0.38; return { geometry: p.geometry, material: m }; });
    }
    WILD_PARTS.set(name, parts); // null = failed: species omitted, never a primitive (ECO rule)
    const cbs = WILD_WAITERS.get(name) || []; WILD_WAITERS.delete(name);
    for (const f of cbs) f(parts);
  });
}
function ensureVegChunk(cx, cz) {
  const key = cx + ',' + cz;
  if (VEG_MESHES.has(key) || !TERRAIN_MESHES.has(key)) return;
  const veg = genChunkVeg(cx, cz);
  const group = new THREE.Group();
  const entry = { group };
  VEG_MESHES.set(key, entry);
  scene.add(group);
  const byName = new Map();
  for (const layer of ['trees', 'shrubs', 'rocks', 'grass']) for (const d of veg[layer]) {
    if (!byName.has(d.n)) byName.set(d.n, []);
    byName.get(d.n).push(d);
  }
  for (const [name, list] of byName) {
    wildParts(name, (parts) => {
      if (!parts || VEG_MESHES.get(key) !== entry) return; // evicted (or failed) meanwhile
      for (const p of parts) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
        const d = new THREE.Object3D();
        let bcx = 0, bcz = 0;
        list.forEach((q, i) => {
          d.position.set(q.x, groundH(q.x, q.z) - 0.04, q.z);
          d.rotation.set(0, q.ry, 0); d.scale.setScalar(q.s); d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
          bcx += q.x; bcz += q.z;
        });
        bcx /= list.length; bcz /= list.length;
        let brad = 0;
        for (const q of list) { const dd = Math.hypot(q.x - bcx, q.z - bcz) + 4; if (dd > brad) brad = dd; }
        im.boundingSphere = new THREE.Sphere(new THREE.Vector3(bcx, groundH(bcx, bcz), bcz), brad);
        im.castShadow = /Tree|Pine/.test(name);
        im.receiveShadow = true;
        group.add(im);
      }
    });
  }
}
function evictVeg(key) {
  const entry = VEG_MESHES.get(key);
  if (!entry) return;
  VEG_MESHES.delete(key);
  scene.remove(entry.group);
  entry.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
}

function plazaTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    const c = w / 2;
    g.fillStyle = '#cbb79a';
    for (let r = 500; r > 30; r -= 34) {
      g.beginPath(); g.arc(c, c, r, 0, TAU);
      g.fillStyle = (r / 34 | 0) % 2 ? '#c2ab88' : '#d3bf9f'; g.fill();
      g.strokeStyle = 'rgba(146,110,60,.30)'; g.lineWidth = 2; g.stroke();
    }
    g.strokeStyle = 'rgba(146,110,60,.16)';
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; g.beginPath(); g.moveTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60); g.lineTo(c + Math.cos(a) * 500, c + Math.sin(a) * 500); g.stroke(); }
    g.beginPath(); g.arc(c, c, 492, 0, TAU); g.strokeStyle = 'rgba(255,240,210,.55)'; g.lineWidth = 5; g.stroke();
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
    gr.addColorStop(0, '#bfe3f5'); gr.addColorStop(0.45, '#6aa3cf'); gr.addColorStop(1, '#33608f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(220,245,255,.35)';
    for (let r = 22; r < 128; r += 21) { g.beginPath(); g.arc(c, c, r, 0, TAU); g.lineWidth = 2; g.stroke(); }
  });
}
function windowsTexture(seed, accent, dark) {
  // light pass = warm cream walls + taupe unlit windows; dark pass =
  // the emissive map (near-black base, only the lit windows glow)
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = dark ? '#1c150c' : '#e6d7b8'; g.fillRect(0, 0, w, h);
    const rnd = mulberry32(seed);
    for (let y = 10; y < h - 12; y += 22) for (let x = 10; x < w - 12; x += 22) {
      const on = rnd();
      g.fillStyle = on > 0.55 ? (rnd() > 0.4 ? 'rgba(255,205,120,.95)' : accent) : (dark ? '#1c150c' : 'rgba(120,105,80,.55)');
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
  // v548 COZY REDESIGN: golden hour. gradient sky dome, warm haze,
  // a low warm sun (the light slot is still userData.moon — applyGfx
  // configures its shadows through that key), faint early stars.
  scene.fog = new THREE.FogExp2(0xcf9a68, 0.0016);
  scene.background = new THREE.Color(0xe9a06b);
  const skyTex = canvasTex(32, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#4a7fc4'); gr.addColorStop(0.42, '#7ba7dc'); gr.addColorStop(0.66, '#d9c2a0'); gr.addColorStop(0.84, '#f7b267'); gr.addColorStop(1, '#e88ca0');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(760, 24, 12), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(skyDome);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x977950, 0.85);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xffb36b, 1.9);
  moon.position.set(-120, 52, 48);
  moon.shadow.camera.left = -70; moon.shadow.camera.right = 70; moon.shadow.camera.top = 70; moon.shadow.camera.bottom = -70;
  moon.shadow.bias = -0.0006;
  scene.add(moon); scene.userData.moon = moon;
  const orbLight = new THREE.PointLight(0xffc98a, 900, 30, 2);
  orbLight.position.set(0, 3.4, 0); scene.add(orbLight);

  // sky: stars, moon disc, nebula glows
  const starN = 900, starPos = new Float32Array(starN * 3);
  for (let i = 0; i < starN; i++) {
    const a = rnd() * TAU, e = rnd() * Math.PI * 0.48 + 0.05, Rr = 380;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * Rr; starPos[i * 3 + 1] = Math.sin(e) * Rr; starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * Rr;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.3 })));
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(24, 32), new THREE.MeshBasicMaterial({ color: 0xffdf9e, fog: false }));
  moonDisc.position.set(-590, 255, 235); moonDisc.lookAt(0, 0, 0); scene.add(moonDisc);
  const nebTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,190,120,.5)'); gr.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  [[-190, 120, -260, 260, 0xf7a072], [230, 90, -240, 200, 0xf9a8d4], [60, 150, -330, 300, 0xffd9a0], [-590, 255, 235, 340, 0xffb36b]].forEach((n) => {
    const sm = new THREE.SpriteMaterial({ map: nebTex, color: n[4], transparent: true, opacity: 0.32, fog: false, depthWrite: false });
    const sp = new THREE.Sprite(sm); sp.position.set(n[0], n[1], n[2]); sp.scale.set(n[3], n[3] * 0.6, 1); scene.add(sp);
  });

  // ground + plaza + paths
  scene.add(buildTerrain()); // terrain pass: chunked heightfield, one shared blended material
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(30, 56), new THREE.MeshStandardMaterial({ map: plazaTexture(), roughness: 0.85 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = true; scene.add(plaza);
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.95 });
  [[31, 0, 34, 4.6, 0], [-31, 0, 34, 4.6, 0], [0, -42, 4.6, 56, 0], [0, 42, 4.6, 56, 0]].forEach((pp) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pp[2], pp[3]), pathMat);
    m.rotation.x = -Math.PI / 2; m.position.set(pp[0], 0.015, pp[1]); m.receiveShadow = true; scene.add(m);
  });

  // distant mountain silhouettes (depth at the fog line): one
  // continuous ridgeline ring whose crest follows the same ridged
  // noise as the terrain rim, so the far range reads as a real
  // mountain chain instead of repeated cones (terrain pass).
  {
    // each ring's radius wanders with angle (fbm over the circle, so
    // it closes seamlessly), the crest is notched by a second ridge
    // octave, and a farther, taller, paler range sits behind the
    // first — layered depth instead of one circular wall.
    const mkRing = (rBase, rVar, hBase, hVar, seed, cTop, cBot) => {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 180, 1, true);
      const rp = geo.attributes.position, rcol = new Float32Array(rp.count * 3);
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), z = rp.getZ(i), a = Math.atan2(z, x);
        const ca = Math.cos(a), sa = Math.sin(a);
        const R = rBase + rVar * fbm2(ca * 1.8 + seed, sa * 1.8 + seed * 0.3, 2);
        rp.setX(i, ca * R); rp.setZ(i, sa * R);
        const notch = 0.70 + 0.55 * ridge2(ca * 2.3 + seed * 2.1, sa * 2.3 + 3.7, 3);
        const crest = (hBase + hVar * Math.pow(ridge2(ca * 3.1 + 31.4, sa * 3.1 + 3.1, 4), 1.4)) * notch
          + 6 * fbm2(ca * 6.0 + 9.2, sa * 6.0, 2);
        const isTop = rp.getY(i) > 0;
        rp.setY(i, isTop ? crest : -8);
        const c = isTop ? cTop : cBot;
        rcol[i * 3] = c.r; rcol[i * 3 + 1] = c.g; rcol[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(rcol, 3));
      return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true }));
    };
    scene.add(mkRing(338, 55, 16, 40, 21.0, new THREE.Color(0x8a6f83), new THREE.Color(0xc7a68e)));
    scene.add(mkRing(478, 70, 30, 58, 47.0, new THREE.Color(0x9b7f92), new THREE.Color(0xcbb098)));
  }

  // THE FOUNTAIN (the wishing well, in 3d) — basin, rim, animated water,
  // pillar, top bowl, glowing orb + spray
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcfc0a4, roughness: 0.65, metalness: 0.08 });
  const fb = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 7.1, 1.15, 30), stoneMat);
  fb.position.y = 0.57; fb.castShadow = true; fb.receiveShadow = true; scene.add(fb);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6.35, 0.3, 10, 36), stoneMat);
  rim.rotation.x = Math.PI / 2; rim.position.y = 1.16; rim.castShadow = true; scene.add(rim);
  fountainWater = new THREE.Mesh(new THREE.CircleGeometry(6.1, 30), new THREE.MeshStandardMaterial({ map: waterTexture(), roughness: 0.15, metalness: 0.25, emissive: 0x2c4a66, emissiveIntensity: 0.4, transparent: true, opacity: 0.96 }));
  fountainWater.rotation.x = -Math.PI / 2; fountainWater.position.y = 1.05; fountainWater.material.map.center.set(0.5, 0.5); scene.add(fountainWater);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 2.5, 10), stoneMat);
  pillar.position.y = 1.7; pillar.castShadow = true; scene.add(pillar);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.9, 0.5, 16), stoneMat);
  bowl.position.y = 3.05; scene.add(bowl);
  fountainOrb = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 16), new THREE.MeshBasicMaterial({ color: 0xfff2cf }));
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
  const poleIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 3.4, 8), new THREE.MeshStandardMaterial({ color: 0x3f3a36, roughness: 0.8 }), lampSpots.length);
  const bulbIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lampSpots.length);
  lampSpots.forEach((s2, i) => {
    dummy.position.set(s2[0], 1.7, s2[1]); dummy.scale.setScalar(1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); poleIM.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 3.55; dummy.updateMatrix(); bulbIM.setMatrixAt(i, dummy.matrix);
    addCollider(s2[0], s2[1], 0.5); camSpheres.push({ x: s2[0], y: 2.4, z: s2[1], r: 0.8 });
  });
  scene.add(poleIM); scene.add(bulbIM);

  // benches + planters around the fountain (designed ring furniture)
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
  [45, 135, 225, 315].forEach((deg) => {
    const a = deg * Math.PI / 180, bx = Math.cos(a) * 11, bz = Math.sin(a) * 11;
    const bg = new THREE.Group(); bg.position.set(bx, 0, bz); bg.rotation.y = -a + Math.PI / 2;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.85), woodMat); seat.position.y = 0.62; seat.castShadow = true; bg.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.75, 0.13), woodMat); back.position.set(0, 1.08, -0.4); back.rotation.x = -0.16; bg.add(back);
    scene.add(bg); addCollider(bx, bz, 1.35);
  });
  const planterMat = new THREE.MeshStandardMaterial({ color: 0xa35a3c, roughness: 0.8 });
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

  // trees: path rows + designed groves. ECO (ecosystem phase):
  // the instanced two-tier cone pines are GONE — these designed
  // spots now grow approved library trees through natPlace with
  // real LODs. A failed load omits the tree; nothing primitive
  // ever stands here.
  const treeSpots = [];
  for (let d = 20; d <= 62; d += 13) { treeSpots.push([-d, -8.5], [-d, 8.5], [d + 6, -8.5], [d + 6, 8.5]); }
  for (let d = 26; d <= 66; d += 13) { treeSpots.push([-8.5, -d], [8.5, -d], [-8.5, d], [8.5, d]); }
  [[-72, -42], [76, -46], [-82, 36], [86, 42], [0, 88], [-48, 74], [52, 78]].forEach((c) => {
    const n = 5 + (rnd() * 3 | 0);
    for (let i = 0; i < n; i++) treeSpots.push([c[0] + (rnd() - 0.5) * 22, c[1] + (rnd() - 0.5) * 18]);
  });
  const AVE_TREES = ['CommonTree_2', 'CommonTree_4', 'Pine_2', 'Pine_4', 'CommonTree_1', 'Pine_1', 'CommonTree_3', 'Pine_3'];
  treeSpots.forEach((s2) => {
    const sc = 0.8 + rnd() * 0.45;
    natPlace(AVE_TREES[(rnd() * AVE_TREES.length) | 0], s2[0], s2[1], sc, rnd() * TAU, 0);
    addCollider(s2[0], s2[1], 0.85); camSpheres.push({ x: s2[0], y: 3.4, z: s2[1], r: 2.1 });
  });

  // rocks near the groves (instanced)
  const rockIM = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.8, 0), new THREE.MeshStandardMaterial({ color: 0x8d8272, roughness: 0.95 }), 16);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU, Rr = 38 + rnd() * 42, rx = Math.cos(a) * Rr, rz = Math.sin(a) * Rr * 0.8;
    dummy.position.set(rx, 0.3, rz); dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); dummy.scale.set(0.6 + rnd() * 1.1, 0.5 + rnd() * 0.7, 0.6 + rnd() * 1.1); dummy.updateMatrix();
    rockIM.setMatrixAt(i, dummy.matrix);
    addCollider(rx, rz, 1.0);
  }
  rockIM.castShadow = true; scene.add(rockIM);

  // district buildings: window-lit facades + neon signs (the 2d pads, in 3d)
  const districts = [
    { x: -62, z: -52, w: 26, d: 16, h: 13, name: 'ARCADE', col: '#d9b380', seed: 7 },
    { x: 58, z: -54, w: 26, d: 16, h: 13, name: 'LIBRARY', col: '#ffb36b', seed: 21 },
    { x: -64, z: 46, w: 22, d: 13, h: 10, name: 'APARTMENTS', col: '#f2a7c3', seed: 33 },
    { x: 62, z: 48, w: 22, d: 13, h: 10, name: 'REC CENTER', col: '#4ade80', seed: 48 },
    { x: 0, z: -80, w: 30, d: 14, h: 9, name: '6IX MUSIC', col: '#ffc95e', seed: 59 },
  ];
  const districtParts = [];
  districts.forEach((b) => {
    const tex = windowsTexture(b.seed, b.col);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf5ecd8, map: tex, emissive: 0xffffff, emissiveMap: windowsTexture(b.seed, b.col, true), emissiveIntensity: 0.55, roughness: 0.85 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    m.position.set(b.x, b.h / 2, b.z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1.2, 0.5, b.d + 1.2), new THREE.MeshStandardMaterial({ color: 0x9a5a40, roughness: 0.9 }));
    roof.position.set(b.x, b.h + 0.25, b.z); scene.add(roof);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(b.w * 0.8, 15), 3.3), new THREE.MeshBasicMaterial({ map: signTexture(b.name, b.col), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    const fz = b.z + (b.z < 0 ? b.d / 2 + 0.15 : -(b.d / 2 + 0.15));
    sign.position.set(b.x, b.h - 1.6, fz);
    if (b.z > 0) sign.rotation.y = Math.PI;
    scene.add(sign);
    boxColliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
    camBoxes.push({ minX: b.x - b.w / 2 - 0.4, maxX: b.x + b.w / 2 + 0.4, minZ: b.z - b.d / 2 - 0.4, maxZ: b.z + b.d / 2 + 0.4, h: b.h + 0.6 });
    districtParts.push([m, roof, sign]);
  });
  DISTRICT_REFS = districts.map((b, i) => ({ b, parts: districtParts[i] }));

  // drifting dust motes over the plaza
  const mN = 220, mPos = new Float32Array(mN * 3);
  for (let i = 0; i < mN; i++) { const a = rnd() * TAU, Rr = rnd() * 60; mPos[i * 3] = Math.cos(a) * Rr; mPos[i * 3 + 1] = 0.4 + rnd() * 6; mPos[i * 3 + 2] = Math.sin(a) * Rr; }
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  motes = new THREE.Points(mGeo, new THREE.PointsMaterial({ color: 0xffe6b0, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(motes);
  buildTown();
}


/* ---------- v542: the town dressing (art direction in ART_DIRECTION.md)
 * additive set-building on top of the v540 plaza: gazebo over the
 * Wishing Well, sakura, flower beds, streets, the north storefront row,
 * residential houses, the park. every solid registers its colliders;
 * repeated dressing is instanced. interiors arrive per-building in
 * later versions — storefronts here are glass + lit diorama shells. */
let swayers = [], fallsTex = null;
function buildTown() {
  const rnd = mulberry32(542);
  const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0.02 }, o || {}));
  const box = (w, h, d, mat, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  const cyl = (rt, rb, h, mat, x, y, z, seg) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 10), mat); m.position.set(x, y, z); m.castShadow = true; scene.add(m); return m; };
  const wood = M(0x6b4226, { roughness: 0.9 }), woodDark = M(0x3d2417, { roughness: 0.95 });
  const stone = M(0xa79b7f, { roughness: 0.95 }), brass = M(0xc9a227, { roughness: 0.35, metalness: 0.7 });
  const flowerSpots = [];
  function hipRoof(x, z, w, d, hTop, roofH, mat) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), mat);
    m.scale.set(w * 0.75, roofH, d * 0.75); m.rotation.y = Math.PI / 4;
    m.position.set(x, hTop + roofH / 2, z); m.castShadow = true; scene.add(m); return m;
  }
  const shingleTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a35a3c'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,220,180,.18)';
    for (let y = 0; y < h; y += 16) for (let x = ((y / 16) % 2) * 16; x < w; x += 32) g.fillRect(x, y, 30, 13);
  }, 3, 3);
  const shingle = M(0xffffff, { map: shingleTex, roughness: 0.95 });

  /* ----- gazebo over the Wishing Well (the fountain stays the well) ----- */
  {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6, gx = Math.cos(a) * 9.5, gz = Math.sin(a) * 9.5;
      cyl(0.16, 0.22, 5.4, wood, gx, 2.7, gz);
      box(0.5, 0.18, 0.5, woodDark, gx, 0.09, gz);
      addCollider(gx, gz, 0.34);
    }
    const beam = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.2, 8, 40), wood);
    beam.rotation.x = Math.PI / 2; beam.position.y = 5.45; scene.add(beam);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(12.4, 3.9, 24), shingle);
    roof.position.y = 7.5; roof.castShadow = true; scene.add(roof);
    const fin = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), M(0xffd257, { emissive: 0xffd257, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.6 }));
    fin.position.y = 9.75; scene.add(fin);
    cyl(0.03, 0.03, 0.8, woodDark, 0, 5.1, 0, 6);
    const lampM = box(0.44, 0.55, 0.44, M(0xffc98a, { emissive: 0xffb36b, emissiveIntensity: 2.2 }), 0, 4.55, 0);
    lampM.castShadow = false;
    const gl = new THREE.PointLight(0xffb36b, 650, 32, 2); gl.position.set(0, 4.4, 0); scene.add(gl);
    // flower ring hugging the gazebo
    const bed = new THREE.Mesh(new THREE.RingGeometry(10.4, 12.3, 40), M(0x241631, { roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = 0.03; bed.receiveShadow = true; scene.add(bed);
    for (let i = 0; i < 110; i++) { const a = rnd() * TAU, r = 10.7 + rnd() * 1.3; flowerSpots.push([Math.cos(a) * r, Math.sin(a) * r]); }
  }

  /* ----- sakura: ECO — the procedural blob sakuras are removed.
   * Every sakura is the textured SakuraTree model (derived from
   * the approved CC0 CommonTree_2 with a blossom-pink leaf atlas)
   * planted via natPlace; a failed load leaves the spot empty. */
  function sakura(x, z, s, hero) {
    natPlace('SakuraTree', x, z, s * 0.78, (x * 1.7 + z) % TAU, 0.55);
    camSpheres.push({ x, y: 3.2 * s, z, r: 2.3 * s });
  }
  [[26, 40], [27, 100], [26, 160], [27, 205], [26, 262], [27, 322]].forEach(([r, deg]) => {
    const a = deg * Math.PI / 180; sakura(Math.cos(a) * r, Math.sin(a) * r, 0.95 + rnd() * 0.25, true);
  });

  /* ----- streets: avenues N/S/E/W with sidewalks, crossings, lamps ----- */
  const asphaltTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#17142a'; g.fillRect(0, 0, w, h);
    const r2 = mulberry32(7);
    for (let i = 0; i < 260; i++) { g.fillStyle = r2() > 0.5 ? 'rgba(160,150,220,.05)' : 'rgba(0,0,0,.14)'; g.fillRect(r2() * w, r2() * h, 2, 2); }
  }, 2, 10);
  const walkTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#575180'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(16,10,40,.55)'; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, h - 2);
    g.fillStyle = 'rgba(230,225,255,.05)'; g.fillRect(4, 4, w - 8, 10);
  }, 1, 12);
  const asphalt = M(0xffffff, { map: asphaltTex, roughness: 1 }), walkM = M(0xffffff, { map: walkTex, roughness: 1 });
  function avenue(cx, cz, len, ns) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ns ? 13 : len, ns ? len : 13), asphalt);
    road.rotation.x = -Math.PI / 2; road.position.set(cx, 0.02, cz); road.receiveShadow = true; scene.add(road);
    for (const sgn of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(ns ? 2.4 : len, ns ? len : 2.4), walkM);
      sw.rotation.x = -Math.PI / 2;
      if (ns) sw.position.set(cx + sgn * 7.7, 0.03, cz); else sw.position.set(cx, 0.03, cz + sgn * 7.7);
      sw.receiveShadow = true; scene.add(sw);
    }
    // dashed centre line
    const dashM = M(0xffd257, { emissive: 0xffd257, emissiveIntensity: 0.25 });
    for (let d = -len / 2 + 6; d < len / 2 - 4; d += 9) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(ns ? 0.35 : 3.4, ns ? 3.4 : 0.35), dashM);
      dash.rotation.x = -Math.PI / 2;
      if (ns) dash.position.set(cx, 0.035, cz + d); else dash.position.set(cx + d, 0.035, cz);
      scene.add(dash);
    }
  }
  avenue(0, 66, 52, true); avenue(96, 0, 116, false); avenue(-96, 0, 116, false);
  // north: the storefront row fronts the plaza directly (like the
  // reference) — a paved apron, not a road through the hall.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(96, 15), walkM);
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.025, -38); apron.receiveShadow = true; scene.add(apron);
  // crosswalks where the avenues meet the plaza
  const crossM = M(0xe8e4ff, { roughness: 0.9 });
  [[0, -37.5, 0], [0, 37.5, 0], [37.5, 0, 1], [-37.5, 0, 1]].forEach(([cx, cz, rot]) => {
    for (let i = -2; i <= 2; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(rot ? 0.55 : 2.4, 0.04, rot ? 2.4 : 0.55), crossM);
      st.position.set(cx + (rot ? 0 : i * 2.6), 0.04, cz + (rot ? i * 2.6 : 0)); scene.add(st);
    }
  });
  // avenue lamps (instanced posts + heads)
  {
    const spots = [];
    for (let z = -84; z <= 84; z += 24) { if (Math.abs(z) > 40) { spots.push([8.6, z]); spots.push([-8.6, z + 12]); } }
    for (let x = -140; x <= 140; x += 24) { if (Math.abs(x) > 44) { spots.push([x, 8.6]); spots.push([x + 12, -8.6]); } }
    for (let i = spots.length - 1; i >= 0; i--) { const [sx, sz] = spots[i]; if (Math.abs(sx) < 17 && sz < -40 && sz > -60) spots.splice(i, 1); } // keep lamps out of the grand hall
    const postIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 6), M(0x14101f, { roughness: 0.6, metalness: 0.4 }), spots.length);
    const headIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 8), M(0xffd9a0, { emissive: 0xffc98a, emissiveIntensity: 2.4 }), spots.length);
    const dum = new THREE.Object3D();
    spots.forEach(([lx, lz], i) => {
      dum.position.set(lx, 1.8, lz); dum.updateMatrix(); postIM.setMatrixAt(i, dum.matrix);
      dum.position.set(lx, 3.75, lz); dum.updateMatrix(); headIM.setMatrixAt(i, dum.matrix);
      addCollider(lx, lz, 0.3);
    });
    scene.add(postIM); scene.add(headIM);
  }
  // street name signs
  function streetSign(x, z, text, ry) {
    cyl(0.05, 0.05, 2.6, M(0x14101f, { metalness: 0.4, roughness: 0.5 }), x, 1.3, z, 6);
    const t = canvasTex(256, 48, (g, w, h) => { g.fillStyle = '#1d1440'; g.fillRect(0, 0, w, h); g.font = '800 26px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffd9a0'; g.fillText(text, w / 2, h / 2 + 1); });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.64), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    p.position.set(x, 2.5, z); p.rotation.y = ry; scene.add(p);
    addCollider(x, z, 0.25);
  }
  streetSign(9.4, -35, 'FOUNTAIN AVE', 0.5); streetSign(-9.4, 35, 'SAKURA ROW', -0.5);

  /* ----- north storefront row: glass fronts, lit diorama interiors ----- */
  function dioramaTex(kind, warm) {
    return canvasTex(512, 192, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, warm); gr.addColorStop(1, '#2a1608');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(30,16,6,.9)';
      if (kind === 'coffee') {
        g.fillRect(30, 108, 300, 60); g.fillRect(30, 96, 300, 12); // counter
        for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(390 + i * 28, 52, 9, 0, 7); g.fillStyle = 'rgba(255,190,110,.95)'; g.fill(); g.fillStyle = 'rgba(30,16,6,.9)'; }
        for (let i = 0; i < 3; i++) { g.fillRect(356 + i * 48, 128, 30, 8); g.fillRect(366 + i * 48, 136, 6, 26); g.fillRect(356 + i * 48, 128, 30, 26); }
        g.fillRect(36, 26, 120, 52); g.fillStyle = 'rgba(255,220,160,.85)'; g.font = '700 17px Inter'; g.fillText('MENU', 52, 48); g.font = '12px Inter'; g.fillText('mocha .... 40c', 52, 68);
      } else if (kind === 'clothing') {
        for (let i = 0; i < 5; i++) { const x = 50 + i * 92; g.fillRect(x, 40, 4, 100); g.beginPath(); g.moveTo(x - 16, 66); g.lineTo(x + 2, 46); g.lineTo(x + 20, 66); g.lineTo(x + 14, 118); g.lineTo(x - 10, 118); g.closePath(); g.fill(); }
        g.fillRect(330, 130, 130, 34);
      } else { // grand hall: columns + chandelier dots
        for (let i = 0; i < 4; i++) g.fillRect(40 + i * 116, 20, 16, 148);
        for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(90 + i * 56, 44 + (i % 2) * 14, 7, 0, 7); g.fillStyle = 'rgba(255,215,120,.95)'; g.fill(); g.fillStyle = 'rgba(30,16,6,.9)'; }
        g.fillRect(150, 128, 212, 40);
      }
      g.fillStyle = 'rgba(255,200,120,.16)'; g.fillRect(0, 0, w, 10);
    });
  }
  function iconSign(glyph, text, color) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const g = cv.getContext('2d');
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 7; g.shadowColor = color; g.shadowBlur = 16;
    g.save(); g.translate(64, 64);
    if (glyph === 'cup') { g.strokeRect(-24, -12, 42, 32); g.beginPath(); g.arc(24, 4, 10, -1.2, 1.2); g.stroke(); g.beginPath(); g.moveTo(-14, -26); g.quadraticCurveTo(-8, -34, -4, -26); g.moveTo(2, -26); g.quadraticCurveTo(8, -34, 12, -26); g.stroke(); }
    else if (glyph === 'hanger') { g.beginPath(); g.arc(0, -22, 7, Math.PI, 2.6); g.stroke(); g.beginPath(); g.moveTo(0, -15); g.lineTo(-30, 18); g.lineTo(30, 18); g.closePath(); g.stroke(); }
    else if (glyph === 'crown') { g.beginPath(); g.moveTo(-30, 16); g.lineTo(-30, -14); g.lineTo(-14, 2); g.lineTo(0, -20); g.lineTo(14, 2); g.lineTo(30, -14); g.lineTo(30, 16); g.closePath(); g.fill(); }
    g.restore();
    g.font = '800 52px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(text, 118, 68);
    return new THREE.CanvasTexture(cv);
  }
  function storefront(b) {
    const g = new THREE.Group(); g.position.set(b.x, 0, b.z); scene.add(g);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), M(0xf5ecd8, { map: windowsTexture(b.seed, b.col), emissive: 0xffffff, emissiveMap: windowsTexture(b.seed, b.col, true), emissiveIntensity: 0.5 }));
    upper.position.y = b.h / 2; upper.castShadow = true; upper.receiveShadow = true; g.add(upper);
    const fz = b.d / 2;
    // diorama + glass at the face
    const dio = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.86, 3.3), new THREE.MeshBasicMaterial({ map: dioramaTex(b.kind, b.warm) }));
    dio.position.set(0, 1.85, fz + 0.04); g.add(dio);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.88, 3.5), M(0x8fb8ff, { transparent: true, opacity: 0.18, roughness: 0.08, metalness: 0.4 }));
    glass.position.set(0, 1.85, fz + 0.1); g.add(glass);
    // mullions
    for (let i = -2; i <= 2; i++) { const mull = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.5, 0.1), woodDark); mull.position.set(i * b.w * 0.18, 1.85, fz + 0.11); g.add(mull); }
    // awning + sign + door
    const awnTex = canvasTex(64, 64, (gg, w, h) => { gg.fillStyle = b.awn; gg.fillRect(0, 0, w, h); gg.fillStyle = 'rgba(255,255,255,.85)'; gg.fillRect(0, 0, 12, h); gg.fillRect(32, 0, 12, h); }, 4, 1);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.72, 0.16, 2.3), M(0xffffff, { map: awnTex, roughness: 0.9 }));
    awn.position.set(0, 4.05, fz + 1.05); awn.rotation.x = -0.32; g.add(awn);
    const board = new THREE.Mesh(new THREE.BoxGeometry(Math.min(b.w * 0.78, 17), 1.7, 0.3), woodDark);
    board.position.set(0, b.h - 1.15, fz + 0.12); g.add(board); board.userData.signPart = true; g.userData.keepers = [board];
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(b.w * 0.76, 16.4), 1.55), new THREE.MeshBasicMaterial({ map: iconSign(b.glyph, b.name, b.col), transparent: true, depthWrite: false }));
    sign.position.set(0, b.h - 1.15, fz + 0.29); g.add(sign); sign.userData.signPart = true; g.userData.keepers.push(sign);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.9, 0.14), woodDark);
    door.position.set(b.w * 0.31, 1.45, fz + 0.09); g.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), brass);
    knob.position.set(b.w * 0.31 - 0.55, 1.45, fz + 0.2); g.add(knob);
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.1), stone);
    step.position.set(b.w * 0.31, 0.08, fz + 0.6); g.add(step);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), shingle);
    roof.scale.set(b.w * 0.78, 3.4, b.d * 0.78); roof.rotation.y = Math.PI / 4; roof.position.y = b.h + 1.7; roof.castShadow = true; g.add(roof);
    // planters with flowers flanking the front
    for (const sgn of [-1, 1]) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.8), wood);
      pl.position.set(sgn * b.w * 0.36, 0.28, fz + 0.75); pl.castShadow = true; g.add(pl); g.userData.keepers.push(pl);
      for (let i = 0; i < 7; i++) flowerSpots.push([b.x + sgn * b.w * 0.36 + (rnd() - 0.5) * 2, b.z + fz + 0.75 + (rnd() - 0.5) * 0.5]);
    }
    boxColliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
    camBoxes.push({ minX: b.x - b.w / 2 - 0.4, maxX: b.x + b.w / 2 + 0.4, minZ: b.z - b.d / 2 - 0.4, maxZ: b.z + b.d / 2 + 0.4, h: b.h + 3.6 });
    return g;
  }
  const coffeeG = storefront({ x: -36, z: -44, w: 24, d: 14, h: 10.5, name: 'COFFEE SHOP', glyph: 'cup', col: '#ffc98a', kind: 'coffee', warm: '#8a5a20', awn: '#7c2d3e', seed: 71 });
  { // v553: the modeled coffee shop (Blender kit build) swaps over the shell
    const fb = new THREE.Group(); coffeeG.add(fb);
    const keepers = coffeeG.userData.keepers.filter((k) => !k.userData.signPart); // the modeled building carries its own sign now; planters stay
    [...coffeeG.children].forEach((c) => { if (c !== fb && !keepers.includes(c)) fb.add(c); });
    const holder = new THREE.Group(); coffeeG.add(holder);
    swapModel('/world3d/assets/architecture/coffee_shop.glb', holder, fb);
  }
  const hallG = storefront({ x: 0, z: -50, w: 30, d: 16, h: 16, name: '6IXNETWORKS', glyph: 'crown', col: '#ffc95e', kind: 'hall', warm: '#7a5c14', awn: '#7a5c14', seed: 97 });
  { // stage 05: the modeled grand hall swaps over the shell
    const fb = new THREE.Group(); hallG.add(fb);
    const keepers = hallG.userData.keepers.filter((k) => !k.userData.signPart);
    [...hallG.children].forEach((c) => { if (c !== fb && !keepers.includes(c)) fb.add(c); });
    const holder = new THREE.Group(); hallG.add(holder);
    swapModel('/world3d/assets/architecture/hall.glb', holder, fb);
  }
  const clothingG = storefront({ x: 36, z: -44, w: 24, d: 14, h: 10.5, name: 'CLOTHING CO.', glyph: 'hanger', col: '#f3efff', kind: 'clothing', warm: '#6b5a8a', awn: '#1f5f5b', seed: 83 });
  { // stage 06: the modeled boutique swaps over the shell
    const fb = new THREE.Group(); clothingG.add(fb);
    const keepers = clothingG.userData.keepers.filter((k) => !k.userData.signPart);
    [...clothingG.children].forEach((c) => { if (c !== fb && !keepers.includes(c)) fb.add(c); });
    const holder = new THREE.Group(); clothingG.add(holder);
    swapModel('/world3d/assets/architecture/clothing.glb', holder, fb);
  }

  /* ----- hip roofs + awnings on the five district buildings ----- */
  const districts2 = [
    { x: -62, z: -52, w: 26, d: 16, h: 13 }, { x: 58, z: -54, w: 26, d: 16, h: 13 },
    { x: -64, z: 46, w: 22, d: 13, h: 10 }, { x: 62, z: 48, w: 22, d: 13, h: 10 },
    { x: 0, z: -80, w: 30, d: 14, h: 9 },
  ];
  districts2.forEach((b) => {
    const hr = hipRoof(b.x, b.z, b.w + 1.6, b.d + 1.6, b.h + 0.4, 3.4, shingle);
    const fz = b.z + (b.z < 0 ? b.d / 2 : -b.d / 2), dir = b.z < 0 ? 1 : -1;
    const awn = box(b.w * 0.5, 0.14, 1.9, M(0x31235e, { roughness: 0.9 }), b.x, 3.6, fz + dir * 0.95);
    awn.rotation.x = dir * 0.3;
    const ref = DISTRICT_REFS.find((r) => r.b.x === b.x && r.b.z === b.z);
    if (ref) ref.parts.push(hr, awn);
  });
  { // CP7: modeled district exteriors (Blender) swap over the v542 shells
    const DIST_GLB = { ARCADE: 'arcade', LIBRARY: 'library', APARTMENTS: 'apartments', 'REC CENTER': 'rec', '6IX MUSIC': 'music' };
    for (const ref of DISTRICT_REFS) {
      const fb = new THREE.Group(); scene.add(fb);
      ref.parts.forEach((p) => fb.add(p));
      const holder = new THREE.Group();
      holder.position.set(ref.b.x, 0, ref.b.z);
      if (ref.b.z > 0) holder.rotation.y = Math.PI; // south buildings front -z; models are authored front +z
      scene.add(holder);
      swapModel('/world3d/assets/architecture/' + DIST_GLB[ref.b.name] + '.glb', holder, fb);
    }
  }

  /* ----- café terrace in front of the coffee shop ----- */
  [[-45, -31], [-36, -30], [-27, -31]].forEach(([tx, tz]) => {
    cyl(0.05, 0.05, 2.3, woodDark, tx, 1.15, tz, 6);
    const um = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.7, 10), M(0xf3e5cf, { roughness: 0.9 }));
    um.position.set(tx, 2.45, tz); um.castShadow = true; scene.add(um);
    cyl(0.55, 0.45, 0.75, wood, tx, 0.38, tz, 10);
    addCollider(tx, tz, 0.85);
    box(0.5, 0.75, 0.5, wood, tx + 1.05, 0.38, tz + 0.3); box(0.5, 0.75, 0.5, wood, tx - 1.05, 0.38, tz - 0.3);
  });

  /* ----- residential row (west): houses, fences, mailboxes ----- */
  function house(x, z, ry, wallCol, seed) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    const base = new THREE.Mesh(new THREE.BoxGeometry(11, 5.5, 9), M(wallCol, { map: windowsTexture(seed, '#ffd9a0'), emissive: 0xffffff, emissiveMap: windowsTexture(seed, '#ffd9a0', true), emissiveIntensity: 0.4 }));
    base.position.y = 2.75; base.castShadow = true; base.receiveShadow = true; g.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), shingle);
    roof.scale.set(11 * 0.78, 3, 9 * 0.78); roof.rotation.y = Math.PI / 4; roof.position.y = 7; roof.castShadow = true; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.4, 0.12), woodDark); door.position.set(0, 1.2, 4.56); g.add(door);
    const pl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), M(0xffd9a0, { emissive: 0xffc98a, emissiveIntensity: 2.4 }));
    pl.position.set(1.1, 2.2, 4.62); g.add(pl);
    { // CP7: modeled house swaps over the primitive shell (walls tinted per house)
      const fb = new THREE.Group(); g.add(fb);
      [base, roof, door, pl].forEach((p) => fb.add(p));
      const holder = new THREE.Group(); g.add(holder);
      holder.userData.onSwap = () => { holder.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'walls') { o.material = o.material.clone(); o.material.color.setHex(wallCol); } }); };
      swapModel('/world3d/assets/architecture/house.glb', holder, fb);
    }
    const mb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.45), M(0x8a2f3e, { roughness: 0.7 })); mb.position.set(4.4, 1.05, 6.4); g.add(mb);
    const mp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.05, 0.09), woodDark); mp.position.set(4.4, 0.5, 6.4); g.add(mp);
    boxColliders.push({ minX: x - 6, maxX: x + 6, minZ: z - 5, maxZ: z + 5 });
    camBoxes.push({ minX: x - 6.4, maxX: x + 6.4, minZ: z - 5.4, maxZ: z + 5.4, h: 9 });
    for (let i = 0; i < 6; i++) flowerSpots.push([x - 5 + i * 2, z + 5.6]);
  }
  house(-108, -28, 0.5, 0xe3d3ae, 111); house(-116, 6, 0.9, 0xbccdb4, 122); house(-104, 40, 0.25, 0xe8c4b0, 133);
  // picket fences along the residential frontage
  {
    const pickets = [];
    for (let x = -126; x < -88; x += 1.1) { pickets.push([x, -16.5]); pickets.push([x, 52]); }
    const pIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.05, 0.05), M(0xe8e2f2, { roughness: 0.9 }), pickets.length);
    const dum = new THREE.Object3D();
    pickets.forEach(([px2, pz2], i) => { dum.position.set(px2, 0.52, pz2); dum.updateMatrix(); pIM.setMatrixAt(i, dum.matrix); });
    pIM.castShadow = true; scene.add(pIM);
    // STAGE 04: rails tie the pickets into a fence - posts alone read as
    // disconnected sticks. Both runs sit on the flat plateau, so level
    // rails at two heights follow the ground exactly.
    const railM = M(0xe8e2f2, { roughness: 0.9 });
    for (const rz of [-16.5, 52]) for (const ry2 of [0.3, 0.76]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(38.4, 0.09, 0.045), railM);
      rail.position.set(-107, ry2, rz); rail.castShadow = true; scene.add(rail);
    }
  }

  /* ----- the park (east): pond, waterfall, stepping stones, grove ----- */
  {
    const pondTex = waterTexture();
    const pond = new THREE.Mesh(new THREE.CircleGeometry(13, 36), new THREE.MeshStandardMaterial({ map: pondTex, roughness: 0.15, metalness: 0.25, emissive: 0x0d3355, emissiveIntensity: 0.6 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(118, 0.04, 12); pond.receiveShadow = true; scene.add(pond);
    addCollider(118, 12, 13.4);
    const rim = new THREE.Mesh(new THREE.RingGeometry(13, 14.6, 36), stone);
    rim.rotation.x = -Math.PI / 2; rim.position.set(118, 0.035, 12); scene.add(rim);
    // waterfall over stacked rocks at the park's east edge
    const rockM = M(0x55506e, { flatShading: true, roughness: 1 });
    [[136, 4, 0, 5, 4.5, 6], [138, 10, 1.8, 4, 3.4, 5], [135, 17, 0.6, 5.5, 5, 5.5]].forEach(([rx, rz, ry2, w, h, d]) => {
      const r = box(w, h, d, rockM, rx, h / 2, rz); r.rotation.y = ry2; addCollider(rx, rz, Math.max(w, d) / 2);
    });
    fallsTex = canvasTex(64, 128, (g, w, h) => {
      g.fillStyle = '#9fd8ef'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.75)';
      for (let i = 0; i < 26; i++) g.fillRect((i * 37) % w, (i * 53) % h, 3, 16);
    }, 1, 2);
    const falls = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2), new THREE.MeshBasicMaterial({ map: fallsTex, transparent: true, opacity: 0.85 }));
    falls.position.set(133.5, 2.6, 10.5); falls.rotation.y = -Math.PI / 2.4; falls.rotation.x = 0.12; scene.add(falls);
    // stepping stones from the avenue to the pond
    for (let i = 0; i < 6; i++) {
      const st = cyl(0.85, 0.95, 0.14, stone, 66 + i * 6.4, 0.07, 6 + Math.sin(i * 1.3) * 2.4, 9);
      st.castShadow = false;
    }
    sakura(96, -14, 1.1, true); sakura(100, 34, 1.0, true); sakura(138, 30, 0.95, false); sakura(140, -8, 1.05, false);
    for (let i = 0; i < 70; i++) { const a = rnd() * TAU, r = 15.5 + rnd() * 3; flowerSpots.push([118 + Math.cos(a) * r, 12 + Math.sin(a) * r]); }
  }

  /* ----- all flowers, one instanced draw ----- */
  {
    const fIM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.11, 0), M(0xffffff, { roughness: 0.8, flatShading: true }), flowerSpots.length);
    const dum = new THREE.Object3D(); const palette = [new THREE.Color(0xf472b6), new THREE.Color(0xa78bfa), new THREE.Color(0xffd9a0), new THREE.Color(0xf9a8d4), new THREE.Color(0xffffff)];
    flowerSpots.forEach(([fx, fz], i) => {
      dum.position.set(fx, 0.16, fz); dum.scale.set(1, 0.72, 1); dum.rotation.set(rnd() * 3, rnd() * 3, 0); dum.updateMatrix();
      fIM.setMatrixAt(i, dum.matrix); fIM.setColorAt(i, palette[i % palette.length]);
    });
    scene.add(fIM);
  }
  buildCafe();
  buildArcade();
  buildClothing();
  buildTownDoors544();
  buildLibrary();
  buildRec();
  buildApt();
  buildTownDoors545();
  buildShards();
  buildStrollers();
  buildDressing(); buildForest(); buildWildlife(); buildEntrances(); buildTestGrove(); buildNature(); buildEcoZones(); buildGroundCover(); buildSpawnGarden();
  cozyInteriors();
}


/* ---------- v543: interactions, doors, interiors, seats, npcs ----------
 * one registry drives every prompt: { zone, x, z, r, label, action }.
 * the nearest in-range entry in the player's zone wins; E (desktop) or
 * the touch button runs it. interiors are real geometry far east of
 * the town (x ~2000) — the server zones presence by position and only
 * allows crossing zones through a validated door warp. */
let sitting = null, warpNext = false, curPrompt = null;
let dlgOpen = false, menuOpen = false, scanTick = 0;
const INTERACT = [];
const SEATS = []; // shared seat registry (v549 fix: buildCafe used to declare its own function-scoped SEATS, so the top-level seatTaken() read an undefined name — the intermittent cafe sit-prompt failures)
const NPCS = [];
const ZONE_BOXES = { coffee: { minX: 1989, maxX: 2011, minZ: -9, maxZ: 9 }, arcade: { minX: 2029, maxX: 2051, minZ: -9, maxZ: 9 }, clothing: { minX: 2069, maxX: 2091, minZ: -9, maxZ: 9 }, library: { minX: 2109, maxX: 2131, minZ: -9, maxZ: 9 }, rec: { minX: 2149, maxX: 2171, minZ: -9, maxZ: 9 }, apt: { minX: 2189, maxX: 2211, minZ: -9, maxZ: 9 } };
function zoneNow() {
  for (const id in ZONE_BOXES) { const b = ZONE_BOXES[id]; if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) return id; }
  if (Math.abs(px) <= 195 && Math.abs(pz) <= 118) return 'town';
  return 'void';
}
function addInteract(zone, x, z, r, label, action, when) { INTERACT.push({ zone, x, z, r, label, action, when }); }

/* ----- doors ----- */
function warpTo(x, z, ry2) {
  px = x; pz = z; vx = 0; vz = 0; vy = 0; py = 0;
  if (ry2 != null) { ry = ry2; camYaw = ry2; camYawT = ry2; }
  followX = x; followZ = z; warpNext = true; ping(true);
}
function fadeThrough(fn) {
  if (transitioning) return;
  transitioning = true; clearInput(); setPrompt(null); sfxDoor();
  R.fade.classList.add('on');
  setTimeout(() => { fn(); setTimeout(() => { R.fade.classList.remove('on'); transitioning = false; }, 140); }, 300);
}
function enterCafe() { standUp(); fadeThrough(() => warpTo(2000, 5.5, Math.PI)); }
function exitCafe() { standUp(); fadeThrough(() => warpTo(-28.6, -35.0, 0)); }

/* ----- seats ----- */
function seatTaken(s) {
  for (const rm of remotes.values()) if (rm.sit && Math.hypot(rm.tx - s.x, rm.tz - s.z) < 0.6) return true;
  return false;
}
function sitDown(s) {
  sitting = s; px = s.x; pz = s.z; ry = s.ry; vx = 0; vz = 0; clearInput(); ping(true);
}
function standUp() { if (!sitting) return; sitting = null; ping(true); }

/* ----- dialogue + menu ----- */
let dlgLines = [], dlgIdx = 0;
function openDlg(name, lines) {
  dlgOpen = true; dlgLines = lines; dlgIdx = 0;
  R.dlgname.textContent = name; R.dlgtext.textContent = lines[0];
  R.dlgnext.textContent = lines.length > 1 ? 'next' : 'close';
  R.dlg.hidden = false; clearInput(); setPrompt(null);
}
function advanceDlg() {
  dlgIdx++;
  if (dlgIdx >= dlgLines.length) { dlgOpen = false; R.dlg.hidden = true; return; }
  R.dlgtext.textContent = dlgLines[dlgIdx];
  R.dlgnext.textContent = dlgIdx >= dlgLines.length - 1 ? 'close' : 'next';
}
const MENU3 = [
  { id: 'espresso', name: 'starlight espresso', price: 30, desc: 'small, strong, a little sparkly' },
  { id: 'mocha', name: 'mocha', price: 40, desc: 'the classic — chocolate + moonroast' },
  { id: 'nebula', name: 'nebula latte', price: 65, desc: 'purple, sweet, the house favorite' },
];
// v582 a11y: focus management for the modal panels. noteOpener() runs
// at the top of every panel open, restoreOpener() at the end of every
// close — so the X button, Escape, save and cancel all return focus
// to whatever opened the panel. focusFirst() moves focus inside on
// open; the Tab trap lives in the existing keydown listener (init).
let w3Opener = null;
function noteOpener() { const a = document.activeElement; w3Opener = (a && a !== document.body) ? a : null; }
function restoreOpener() { const el = w3Opener; w3Opener = null; if (el && document.contains(el)) { try { el.focus({ preventScroll: true }); } catch (e) { } } }
function focusFirst(panel) { if (!panel) return; const f = panel.querySelector('button, a[href], input, select'); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { } } }
function topPanel() { if (R.set && !R.set.hidden) return R.set; if (mapOpen) return R.map; if (quizOpen) return R.quiz; if (gamesOpen) return R.games; if (wardOpen) return R.ward; if (menuOpen) return R.menu; return null; }
function openMenu() {
  noteOpener();
  menuOpen = true; R.menu.hidden = false; R.menures.textContent = '';
  R.menubal.textContent = 'ur balance: ' + R.bal.textContent;
  R.menulist.innerHTML = '';
  for (const m of MENU3) {
    const row = document.createElement('div'); row.className = 'w3mi';
    const tx = document.createElement('div'); tx.className = 'w3mi-tx';
    const nm = document.createElement('div'); nm.className = 'w3mi-nm'; nm.textContent = m.name + ' — ' + m.price + '¢';
    const ds = document.createElement('div'); ds.className = 'w3mi-ds'; ds.textContent = m.desc;
    tx.appendChild(nm); tx.appendChild(ds); row.appendChild(tx);
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'w3mi-buy'; btn.innerHTML = icon('bag', 14) + '<span>order</span>';
    btn.addEventListener('click', () => buyItem(m.id, btn));
    row.appendChild(btn); R.menulist.appendChild(row);
  }
  clearInput(); setPrompt(null); focusFirst(R.menu);
}
function closeMenu() { menuOpen = false; R.menu.hidden = true; restoreOpener(); }
async function buyItem(id, btn) {
  btn.disabled = true;
  try {
    const r = await (await fetch('/api/world3d/buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: id }) })).json();
    if (r.ok) {
      R.menures.textContent = 'one ' + r.name + ', coming up. (-' + r.price + '¢)';
      R.bal.textContent = '¢ ' + r.bal + ' six cents';
      R.menubal.textContent = 'ur balance: ' + R.bal.textContent;
      toast(r.name + ' — enjoy');
    } else {
      R.menures.textContent = r.err || 'that did not work';
      if (typeof r.bal === 'number') { R.bal.textContent = '¢ ' + r.bal + ' six cents'; R.menubal.textContent = 'ur balance: ' + R.bal.textContent; }
    }
  } catch (e) { R.menures.textContent = 'network hiccup — try again'; }
  btn.disabled = false;
}

/* ----- prompt machinery ----- */

/* ---------- v553: modeled-asset pipeline (see PIPELINE.md) ----------
 * GLB assets modeled in Blender (assets-src/) load async and swap in
 * over their procedural fallbacks. Gameplay never waits on them:
 * colliders, seats, interact points and positions are unchanged, and
 * if a model fails to load the procedural build simply stays. */
const gltfLoader = new GLTFLoader();
let assetSwaps = 0;
const assetCache = new Map();
const gltfCache = new Map();
/* STAGE 05: priority load queue. at most 4 GLBs in flight; lower prio
 * loads first and callers pass their distance from spawn, so the
 * spawn area dresses itself before distant scenery arrives. the
 * caches are set at enqueue time — a url is fetched exactly once
 * per session no matter how many systems ask for it. */
const LOAD_MAX = 6;
let loadActive = 0;
const loadQ = [];
function queueLoad(url, prio, full) {
  const cache = full ? gltfCache : assetCache;
  if (cache.has(url)) return cache.get(url);
  let res;
  const p = new Promise((r) => { res = r; });
  cache.set(url, p);
  loadQ.push({ url, prio: prio == null ? 60 : prio, res, full });
  loadQ.sort((a, b) => a.prio - b.prio);
  pumpLoads();
  return p;
}
function pumpLoads() {
  while (loadActive < LOAD_MAX && loadQ.length) {
    const job = loadQ.shift();
    loadActive++;
    gltfLoader.loadAsync(job.url).then((g) => job.res(job.full ? g : g.scene)).catch(() => job.res(null)).finally(() => { loadActive--; pumpLoads(); });
  }
}
function loadAsset(url, prio) { return queueLoad(url, prio, false); }
function loadGltf(url, prio) { return queueLoad(url, prio == null ? 30 : prio, true); }
function prioOf(x, z) { return Math.round(Math.hypot(x, z - 18)); }
/* attach a rigged character model to an NPC entry: real skeleton +
 * AnimationMixer clips (idle/walk) driven by the entry's existing
 * st.speed — the same state the sync and routines already maintain.
 * The procedural avatar stays as the fallback until the rig lands. */
function attachRig(entry, hue) {
  loadGltf('/world3d/assets/characters/character.glb', 25).then((gltf) => {
    if (!gltf || disposed || !gltf.animations || !gltf.animations.length) return;
    const model = skelClone(gltf.scene);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        if (o.material && o.material.name === 'body') { o.material = o.material.clone(); o.material.color.setHSL(hue / 360, 0.55, 0.52); }
      }
    });
    const mixer = new THREE.AnimationMixer(model);
    const acts = {};
    for (const clip of gltf.animations) { const a = mixer.clipAction(clip); a.setLoop(THREE.LoopRepeat); acts[clip.name] = a; }
    if (!acts.idle) return;
    acts.idle.play();
    const grp = entry.g || entry.group;
    const proc = grp.children.filter((c) => !c.isSprite);
    proc.forEach((c) => { c.visible = false; });
    grp.add(model);
    assetSwaps++;
    entry.rig = { mixer, acts, cur: 'idle', model, proc, shown: true };
  });
}
/* rig vs procedural: the rig has idle/walk clips only, so sitting,
 * emoting and the wardrobe preview keep the procedural avatar (which
 * carries the cosmetic anchors). toggling is visibility-only. */
function setRigShown(entry, shown) {
  const r = entry.rig;
  if (!r || r.shown === shown) return;
  r.shown = shown;
  r.model.visible = shown;
  r.proc.forEach((c) => { c.visible = !shown; });
}
function tintRig(entry, hue) {
  if (!entry.rig) return;
  entry.rig.model.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'body') o.material.color.setHSL(hue / 360, 0.55, 0.52); });
}
function updateRig(n, dt) {
  const r = n.rig;
  const want = n.st.speed > 0.25 ? 'walk' : 'idle';
  if (r.acts[want] && r.cur !== want) {
    r.acts[want].reset().fadeIn(0.22).play();
    if (r.acts[r.cur]) r.acts[r.cur].fadeOut(0.22);
    r.cur = want;
  }
  if (r.acts.walk) r.acts.walk.timeScale = THREE.MathUtils.clamp(n.st.speed / 2.1, 0.5, 1.8);
  r.mixer.update(dt);
}
function swapModel(url, holder, fallback, scale, ry) {
  let prio = 60;
  try { const v = new THREE.Vector3(); holder.getWorldPosition(v); prio = Math.min(120, prioOf(v.x, v.z)); } catch (e) { }
  loadAsset(url, prio).then((tpl) => {
    if (!tpl || disposed) return;
    const m = tpl.clone(true);
    if (scale) { if (typeof scale === 'number') m.scale.setScalar(scale); else m.scale.set(scale[0], scale[1], scale[2]); }
    if (ry) m.rotation.y = ry;
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    holder.add(m);
    assetSwaps++;
    if (fallback) fallback.visible = false;
    if (holder.userData.onSwap) holder.userData.onSwap(m);
  });
}

/* ---------- v552: the icon system ----------
 * one design language for the whole 3D interface: 24x24 viewBox,
 * stroke 2, round caps + joins, currentColor. paths live in this
 * internal table ONLY (never user input), so icon() can safely
 * return markup. decorative by default (aria-hidden); the BUTTON
 * carries the accessible name. */
const ICON_PATHS = {
  door: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M3 12h11M10 8l-4 4 4 4"/>',
  exit: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M21 12H11M17 8l4 4-4 4"/>',
  chair: '<path d="M7 4v7h10V4"/><path d="M7 11v9M17 11v9M7 15h10"/><path d="M5 11h14"/>',
  bag: '<path d="M5.5 8h13l-1 12.5a1 1 0 0 1-1 .5h-9a1 1 0 0 1-1-.5z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  gamepad: '<path d="M7.5 10.5v4M5.5 12.5h4"/><circle cx="16.5" cy="11" r=".6" fill="currentColor"/><circle cx="18.5" cy="14" r=".6" fill="currentColor"/><path d="M17.3 5.5H6.7a4 4 0 0 0-4 3.6C2.6 9.9 2 14.5 2 16a3 3 0 0 0 5.1 2.1L8.5 16.6a2 2 0 0 1 1.4-.6h4.2a2 2 0 0 1 1.4.6l1.4 1.5A3 3 0 0 0 22 16c0-1.5-.6-6.1-.7-6.9a4 4 0 0 0-4-3.6z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
  micoff: '<line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  hand: '<path d="M8 12.5V6.8a1.3 1.3 0 0 1 2.6 0V5.4a1.3 1.3 0 0 1 2.6 0V4.6a1.3 1.3 0 0 1 2.6 0v6.4"/><path d="M15.8 6.2a1.3 1.3 0 0 1 2.6.6l.5 5.7a7 7 0 0 1-7 7.5h-.8c-2.3 0-3.9-.9-5.1-3L3.9 13.6c-.5-.9.7-1.9 1.6-1.3L8 13.7"/>',
  hanger: '<path d="M12 8.5a2 2 0 1 1 2-2"/><path d="M12 8.5 3.6 15a1 1 0 0 0 .6 1.8h15.6a1 1 0 0 0 .6-1.8z"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 1 3.5 10.9c-.7.5-1 1-1 2.1h-5c0-1.1-.3-1.6-1-2.1A6 6 0 0 1 12 3z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  sparkles: '<path d="M12 3.5 13.8 9l5.7.2-4.4 3.7 1.5 5.6L12 15.4l-4.6 3.1 1.5-5.6L4.5 9.2 10.2 9z"/><path d="M19 2.8v2.4M20.2 4h-2.4"/>',
  star: '<path d="M12 3l2.2 6.6 6.8.3-5.3 4.3 1.8 6.6L12 17l-5.5 3.8 1.8-6.6L3 9.9l6.8-.3z"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
};
function icon(name, size) {
  const d = ICON_PATHS[name] || ICON_PATHS.hand;
  return '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}
function promptIconFor(label) {
  const t = String(label || '').toLowerCase();
  if (/enter|leave|exit|go in|step inside/.test(t)) return 'door';
  if (/^sit|seat|bench|sofa/.test(t)) return 'chair';
  if (/stand up/.test(t)) return 'hand';
  if (/order|menu|browse|buy|shop/.test(t)) return 'bag';
  if (/talk|chat|ask/.test(t)) return 'chat';
  if (/play|game|cabinet/.test(t)) return 'gamepad';
  if (/read|book/.test(t)) return 'book';
  if (/wardrobe|try on|mirror|outfit|fit/.test(t)) return 'hanger';
  if (/trivia|quiz|question/.test(t)) return 'bulb';
  if (/jukebox|music|song/.test(t)) return 'music';
  if (/decor|poster|rug|shard|star/.test(t)) return 'sparkles';
  return 'hand';
}

let promptIcoEl = null, promptLblEl = null, useIcoEl = null, useLblEl = null;
// v580: the prompt DOM is only rewritten when the label actually changes
// (scanPrompts runs every frame — rewriting innerHTML per frame caused
// visible flicker), and hiding is delayed 140ms so crossing an
// interaction boundary does not strobe the prompt. Distances/actions
// are untouched; curPrompt still updates immediately.
let promptShownLbl = null, promptHideT = 0;
function setPrompt(it) {
  curPrompt = it;
  if (!it) {
    if (promptShownLbl && !promptHideT) {
      promptHideT = setTimeout(() => { promptHideT = 0; promptShownLbl = null; if (!curPrompt) { R.prompt.hidden = true; R.use.hidden = true; } }, 140);
    }
    if (!promptShownLbl) { R.prompt.hidden = true; R.use.hidden = true; }
    return;
  }
  if (promptHideT) { clearTimeout(promptHideT); promptHideT = 0; }
  const lbl = typeof it.label === 'function' ? it.label() : it.label;
  if (lbl === promptShownLbl && !R.prompt.hidden) return;
  promptShownLbl = lbl;
  const touch = document.body.classList.contains('touch');
  if (!promptIcoEl) { promptIcoEl = R.prompt.querySelector('.w3p-ico'); promptLblEl = R.prompt.querySelector('.w3p-lbl'); useIcoEl = R.use.querySelector('.w3p-ico'); useLblEl = document.getElementById('w3uselbl'); }
  const ic = icon(promptIconFor(lbl), touch ? 22 : 17);
  if (promptIcoEl) promptIcoEl.innerHTML = ic;
  if (promptLblEl) promptLblEl.textContent = lbl;
  R.prompt.hidden = false;
  if (useIcoEl) useIcoEl.innerHTML = ic;
  if (useLblEl) useLblEl.textContent = lbl;
  R.use.setAttribute('aria-label', lbl);
  R.use.hidden = !touch;
}
function scanPrompts() {
  if (dlgOpen || menuOpen || wardOpen || gamesOpen || quizOpen || mapOpen || transitioning || sessionConflict) { setPrompt(null); return; }
  if (sitting) { setPrompt({ label: 'stand up', action: standUp }); return; }
  const z = zoneNow(); let best = null, bd = 1e9;
  for (const it of INTERACT) {
    if (it.zone !== z) continue;
    if (it.when && !it.when()) continue;
    const d = Math.hypot(px - it.x, pz - it.z);
    if (d <= it.r && d < bd) { bd = d; best = it; }
  }
  setPrompt(best);
  checkDistrict();
  tickPerf();
}
function tryInteract() {
  if (dlgOpen) { advanceDlg(); return; }
  if (menuOpen || transitioning) return;
  if (curPrompt) { const a = curPrompt.action; setPrompt(null); punchT = performance.now(); a(); }
}

/* ----- the coffee shop interior (world x 1989..2011) ----- */
function buildCafe() {
  const CX = 2000;
  const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.88, metalness: 0.02 }, o || {}));
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  const wood = M(0x6b4226, { roughness: 0.92 }), woodDark = M(0x3d2417, { roughness: 0.95 });
  const plankTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#5a3a20'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.25)';
    for (let y = 0; y < h; y += 21) g.fillRect(0, y, w, 2);
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,210,150,.05)'; g.fillRect((i * 53) % w, (i * 37) % h, 22, 3); }
  }, 5, 4);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(22.6, 0.2, 18.6), M(0xffffff, { map: plankTex, roughness: 0.9 }));
  floor.position.set(CX, -0.1, 0); floor.receiveShadow = true; scene.add(floor);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.4, 26), M(0x4c1d5e, { roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(CX - 2, 0.02, 1); rug.receiveShadow = true; scene.add(rug);
  const wallTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#8a6a9e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3d2417'; g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#c9a227'; g.fillRect(0, h * 0.62 - 3, w, 3);
    g.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h * 0.62);
  }, 3, 1);
  const wallM = M(0xffffff, { map: wallTex, roughness: 0.95 });
  // walls (door gap in the south wall; a collider plug keeps the gap
  // shut — leaving happens through the door interaction, not walking)
  box(22.6, 4.3, 0.3, wallM, CX, 2.15, -9.15);
  box(10.1, 4.3, 0.3, wallM, CX - 6.05, 2.15, 9.15); box(10.1, 4.3, 0.3, wallM, CX + 6.05, 2.15, 9.15);
  box(2.4, 1.5, 0.3, wallM, CX, 3.55, 9.15);
  box(0.3, 4.3, 18.6, wallM, CX - 11.15, 2.15, 0); box(0.3, 4.3, 18.6, wallM, CX + 11.15, 2.15, 0);
  box(22.6, 0.25, 18.6, woodDark, CX, 4.42, 0);
  for (let i = -1; i <= 1; i++) box(22.6, 0.22, 0.3, woodDark, CX, 4.24, i * 6);
  boxColliders.push(
    { minX: CX - 11.3, maxX: CX + 11.3, minZ: -9.5, maxZ: -8.8 },
    { minX: CX - 11.3, maxX: CX - 0.9, minZ: 8.8, maxZ: 9.5 },
    { minX: CX + 0.9, maxX: CX + 11.3, minZ: 8.8, maxZ: 9.5 },
    { minX: CX - 1.1, maxX: CX + 1.1, minZ: 8.7, maxZ: 9.5 },
    { minX: CX - 11.5, maxX: CX - 10.8, minZ: -9.3, maxZ: 9.3 },
    { minX: CX + 10.8, maxX: CX + 11.5, minZ: -9.3, maxZ: 9.3 });
  // the door itself (south wall, inside face)
  const doorM = box(1.7, 2.8, 0.12, wood, CX, 1.4, 8.95);
  doorM.castShadow = false;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), M(0xc9a227, { metalness: 0.7, roughness: 0.3 }));
  knob.position.set(CX - 0.55, 1.4, 8.85); scene.add(knob);
  // windows on the side walls: warm night glass, no see-through
  const winTex = canvasTex(64, 96, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#232a5e'); gr.addColorStop(1, '#3a2a6e');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f3efff'; g.beginPath(); g.arc(46, 22, 7, 0, 7); g.fill();
    g.fillStyle = 'rgba(249,168,212,.5)'; g.fillRect(4, h - 16, 10, 12); g.fillRect(w - 14, h - 20, 10, 16);
  });
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const wz = -5.4 + i * 5.4;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.0), new THREE.MeshBasicMaterial({ map: winTex }));
    win.position.set(CX + sx * 10.96, 2.3, wz); win.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2; scene.add(win);
    const fr = box(0.08, 2.2, 2.1, woodDark, CX + sx * 11.0, 2.3, wz); fr.castShadow = false;
  }
  // counter run along the north wall + back counter + machine + case
  const counterFb = new THREE.Group(); scene.add(counterFb);
  const c1 = box(11, 1.08, 1.3, woodDark, CX - 1.5, 0.54, -6.2); counterFb.attach(c1);
  const c2 = box(11.4, 0.09, 1.6, M(0xd8c8a8, { roughness: 0.5 }), CX - 1.5, 1.13, -6.2); counterFb.attach(c2);
  const counterHolder = new THREE.Group(); counterHolder.position.set(CX - 1.5, 0, -6.2); scene.add(counterHolder);
  swapModel('/world3d/assets/furniture/cafe_counter.glb', counterHolder, counterFb, null, Math.PI);
  box(11, 0.95, 0.8, wood, CX - 1.5, 0.48, -8.2);
  boxColliders.push({ minX: CX - 7, maxX: CX + 4, minZ: -6.9, maxZ: -5.5 }, { minX: CX - 7, maxX: CX + 4, minZ: -8.6, maxZ: -7.8 });
  const mach = box(1.15, 0.95, 0.9, M(0x8a8fa8, { metalness: 0.65, roughness: 0.35 }), CX - 4.2, 1.65, -6.2);
  mach.castShadow = false;
  const machHolder = new THREE.Group(); machHolder.position.set(CX - 4.2, 1.17, -6.2); scene.add(machHolder);
  swapModel('/world3d/assets/furniture/espresso.glb', machHolder, mach, null, Math.PI);
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 12), M(0xb9bed4, { metalness: 0.7, roughness: 0.3 }));
  boiler.position.set(CX - 4.2, 2.45, -6.2); scene.add(boiler);
  for (let i = 0; i < 3; i++) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.14, 8), M(0xf3efff, { roughness: 0.4 }));
    cup.position.set(CX - 2.6 + i * 0.5, 1.25, -6.1); scene.add(cup);
  }
  const caseM = box(1.9, 0.55, 1.0, M(0xbfd9ff, { transparent: true, opacity: 0.3, roughness: 0.1 }), CX + 1.6, 1.45, -6.2);
  caseM.castShadow = false;
  for (let i = 0; i < 3; i++) {
    const muf = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), M(i === 1 ? 0xf472b6 : 0xc98a4b, { roughness: 0.9 }));
    muf.position.set(CX + 1.1 + i * 0.5, 1.28, -6.2); muf.scale.y = 0.75; scene.add(muf);
  }
  // menu board (prices match the server menu — server is the source)
  const menuTex = canvasTex(512, 200, (g, w, h) => {
    g.fillStyle = '#17102c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a227'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#ffd9a0'; g.font = '800 30px Inter'; g.textAlign = 'center'; g.fillText('— MENU —', w / 2, 44);
    g.font = '600 24px Inter'; g.textAlign = 'left';
    g.fillText('starlight espresso', 40, 92); g.fillText('nebula latte', 40, 130); g.fillText('mocha', 40, 168);
    g.textAlign = 'right'; g.fillText('30¢', w - 40, 92); g.fillText('65¢', w - 40, 130); g.fillText('40¢', w - 40, 168);
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.9), new THREE.MeshBasicMaterial({ map: menuTex }));
  board.position.set(CX - 1.5, 2.8, -8.96); scene.add(board);
  // shelves + jars on the west wall
  for (let s = 0; s < 3; s++) {
    box(0.35, 0.06, 3.4, wood, CX - 10.8, 1.2 + s * 0.7, -3);
    for (let j = 0; j < 4; j++) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 8), M([0xa78bfa, 0xf472b6, 0xffd257, 0x4ade80][(s + j) % 4], { roughness: 0.4 }));
      jar.position.set(CX - 10.8, 1.44 + s * 0.7, -4.2 + j * 0.8); scene.add(jar);
    }
  }
  boxColliders.push({ minX: CX - 11, maxX: CX - 10.3, minZ: -4.8, maxZ: -1.2 });
  // pendant lights + the room's warm lights
  const shadeM = M(0xffc98a, { emissive: 0xffb36b, emissiveIntensity: 1.6 });
  [[CX - 5.5, -0.5], [CX, 1], [CX + 5, -0.5], [CX - 1.5, -4.6]].forEach(([lx, lz]) => {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), woodDark);
    cord.position.set(lx, 3.75, lz); scene.add(cord);
    const sh = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.4, 12, 1, true), shadeM);
    sh.position.set(lx, 3.15, lz); scene.add(sh);
  });
  const pl1 = new THREE.PointLight(0xffc98a, 480, 19, 2); pl1.position.set(CX, 3.1, 0); scene.add(pl1);
  const pl2 = new THREE.PointLight(0xffb36b, 260, 11, 2); pl2.position.set(CX - 1.5, 2.9, -5.6); scene.add(pl2);
  interiorLights.push({ light: pl1, zone: 'coffee' }, { light: pl2, zone: 'coffee' });
  // tables + chairs (chairs are seats; tables collide, chairs don't)
  const chairM = M(0x7a4a8a, { roughness: 0.8 }), tableM = M(0xd8c8a8, { roughness: 0.5 });
  // SEATS is the shared module-scope registry (declared by INTERACT)
  function chair(x, z, ry2) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry2; scene.add(g);
    const fb = new THREE.Group(); g.add(fb);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.07, 0.52), chairM); seat.position.y = 0.55; seat.castShadow = true; fb.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.75, 0.07), chairM); back.position.set(0, 0.95, -0.24); fb.add(back);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.52, 0.4), woodDark); ped.position.y = 0.26; fb.add(ped);
    const holder = new THREE.Group(); g.add(holder);
    swapModel('/world3d/assets/furniture/cafe_chair.glb', holder, fb, null, Math.PI);
    SEATS.push({ x, z, ry: ry2 });
  }
  function table(x, z) {
    const fb = new THREE.Group(); fb.position.set(x, 0, z); scene.add(fb);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.07, 18), tableM);
    top.position.set(0, 0.76, 0); top.castShadow = true; fb.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.74, 8), woodDark);
    leg.position.set(0, 0.37, 0); fb.add(leg);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.13, 8), M(0xf3efff, { roughness: 0.4 }));
    cup.position.set(0.3, 0.86, 0.2); fb.add(cup);
    const holder = new THREE.Group(); holder.position.set(x, 0, z); scene.add(holder);
    swapModel('/world3d/assets/furniture/cafe_table.glb', holder, fb, [1.3, 1.05, 1.3]);
    addCollider(x, z, 0.8);
    chair(x - 1.45, z, Math.PI / 2); chair(x + 1.45, z, -Math.PI / 2);
  }
  table(CX - 5.5, 1.0); table(CX - 5.5, -3.5); table(CX + 4.5, 2.0); table(CX + 5, -3.0);
  // sofa along the east wall, two seats
  const sofaM = M(0x31235e, { roughness: 0.95 });
  const sofaFb = new THREE.Group(); scene.add(sofaFb);
  for (const sm of [box(1.1, 0.55, 2.8, sofaM, CX + 10.2, 0.28, 3.5), box(0.3, 1.0, 2.8, sofaM, CX + 10.75, 0.5, 3.5), box(1.1, 0.25, 0.25, sofaM, CX + 10.2, 0.62, 2.15), box(1.1, 0.25, 0.25, sofaM, CX + 10.2, 0.62, 4.85)]) sofaFb.attach(sm);
  const sofaHolder = new THREE.Group(); sofaHolder.position.set(CX + 10.2, 0, 3.5); scene.add(sofaHolder);
  swapModel('/world3d/assets/furniture/cafe_sofa.glb', sofaHolder, sofaFb, 1.25, Math.PI / 2);
  SEATS.push({ x: CX + 10.2, z: 2.85, ry: -Math.PI / 2 }, { x: CX + 10.2, z: 4.15, ry: -Math.PI / 2 });
  // plants in the corners
  for (const [qx, qz] of [[CX - 10.3, 8.2], [CX + 10.3, -8.2]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.55, 10), M(0x8a2f3e, { roughness: 0.8 }));
    pot.position.set(qx, 0.28, qz); scene.add(pot);
    for (let i = 0; i < 3; i++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 - i * 0.08, 1), M(0x1d6b3c, { flatShading: true, roughness: 1 }));
      blob.position.set(qx + (i - 1) * 0.3, 0.85 + i * 0.22, qz + (i % 2) * 0.24 - 0.12); blob.castShadow = true; scene.add(blob);
    }
    addCollider(qx, qz, 0.5);
  }
  // mira, the barista
  const mira = makeAvatar(25, 'mira');
  mira.position.set(CX - 2.2, 0, -7.35); mira.rotation.y = 0.15;
  scene.add(mira);
  const miraEntry = { zone: 'coffee', routine: { a: [1995.5, -6.9], b: [2002.5, -6.9], dwell: 5, off: 0, faceA: 0.3, faceB: -0.3 }, g: mira, st: { phase: 1.3, speed: 0, grounded: true, landT: 0, pose: 'stand' } };
  NPCS.push(miraEntry);
  attachRig(miraEntry, 25);
  // ---- interactions for this room + its town door ----
  for (const s of SEATS) {
    addInteract('coffee', s.x, s.z, 1.7,
      () => seatTaken(s) ? 'seat taken' : 'sit',
      () => { if (seatTaken(s)) { toast('someone is sitting there'); return; } sitDown(s); });
  }
  // seal the staff corridor: counter + back counter + the gap between
  // them are ONE solid for the player, or the 0.4u gap pins them
  // between two box colliders forever (found by the test walks).
  boxColliders.push({ minX: CX - 6.1, maxX: CX + 5.1, minZ: -8.35, maxZ: -5.45 });
  addInteract('coffee', CX + 0.5, -4.4, 2.4, 'order a drink', openMenu);
  addInteract('coffee', CX - 2.2, -5.15, 1.6, 'talk to mira', () => openDlg('@mira — barista', [
    'welcome in. sit anywhere u like — the sofa is the good seat.',
    'the nebula latte is the one. purple, sweet, a little sparkly.',
    'u look like u have been walking that plaza all night.',
    'regulars get the good mugs. u are a regular now.',
  ]));
  addInteract('coffee', CX, 7.2, 2.5, 'leave the coffee shop', exitCafe);
  addInteract('town', -28.6, -35.0, 2.7, 'enter the coffee shop', enterCafe);
}

const interiorLights = []; // {light, zone} — zone-toggled in v546

/* ---------- v544: arcade + clothing interiors, cosmetics/wardrobe ----------
 * cosmetics are server-owned truth: COSMETICS + prices live in
 * world3d.js; the client mirrors names for display only. buying and
 * wearing go through /api/world3d/cos and the ping response carries
 * the authoritative { own, wear, hue } back. the wardrobe edits a
 * DRAFT — the avatar previews it live, nothing persists until save,
 * and the server re-validates ownership on save. */
let wardOpen = false;
let myCos = { own: [], wear: { hat: 'none', hair: 'crest', acc: 'none' }, hue: null, shards: [], apt: { rug: 0, poster: 0 } };
let draftWear = null, draftHue = null;
const COS_DISPLAY = {
  hat: [{ id: 'none', name: 'no hat' }, { id: 'cap_red', name: 'red cap', price: 150 }, { id: 'cap_violet', name: 'violet cap', price: 150 }, { id: 'crown', name: 'gold crown', price: 600 }],
  hair: [{ id: 'crest', name: 'star pin' }, { id: 'mohawk', name: 'mohawk', price: 200 }, { id: 'none', name: 'clean' }],
  acc: [{ id: 'none', name: 'no shades' }, { id: 'shades', name: 'shades', price: 120 }],
};

/* ----- wear rendering: build the slot meshes onto an avatar ----- */
function cosPart(kind, color) {
  const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.05 }, o || {}));
  if (kind === 'cap_red' || kind === 'cap_violet') {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(color, { roughness: 0.8 }));
    dome.position.y = 0.02; g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.05, 12, 1, false, -0.9, 1.8), M(color, { roughness: 0.8 }));
    brim.position.set(0, 0.03, 0.22); brim.rotation.x = 0.15; g.add(brim);
    return g;
  }
  if (kind === 'crown') {
    const g = new THREE.Group();
    const gold = M(0xffd257, { metalness: 0.75, roughness: 0.28, emissive: 0x6b4a00, emissiveIntensity: 0.5 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.2, 12, 1, true), gold); band.position.y = 0.1; g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), gold);
      spike.position.set(Math.cos(a) * 0.29, 0.3, Math.sin(a) * 0.29); g.add(spike);
    }
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), M(0xf472b6, { emissive: 0xf472b6, emissiveIntensity: 1.4 }));
    gem.position.set(0, 0.12, 0.32); g.add(gem);
    return g;
  }
  if (kind === 'mohawk') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.72), M(color, { roughness: 0.9 }));
    m.position.y = 0.16; return m;
  }
  if (kind === 'crest') {
    const m = new THREE.Mesh(sharedGeo.star, sharedMats.star);
    m.scale.setScalar(0.42); m.position.set(0.3, 0.12, 0.1); m.rotation.z = 0.4;
    return m;
  }
  if (kind === 'shades') {
    const g = new THREE.Group();
    const dark = M(0x0c0a18, { roughness: 0.25, metalness: 0.4 });
    for (const sx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.13, 0.04), dark);
      lens.position.set(sx * 0.13, 0, 0.02); g.add(lens);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), dark);
      arm.position.set(sx * 0.3, 0.02, -0.12); g.add(arm);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), dark); g.add(bridge);
    return g;
  }
  return new THREE.Group();
}
function clearSlot(anchor) {
  if (!anchor) return;
  while (anchor.children.length) {
    const c = anchor.children[0];
    anchor.remove(c);
    c.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry !== sharedGeo.star) o.geometry.dispose();
      if (o.isMesh && o.material && o.material !== sharedMats.star) o.material.dispose();
    });
  }
}
function applyWear(g, wear, hue) {
  const P = g.userData.parts; if (!P) return;
  clearSlot(P.hatA); clearSlot(P.hairA); clearSlot(P.faceA);
  const bodyCol = (typeof hue === 'number') ? new THREE.Color().setHSL(hue / 360, 0.55, 0.58) : null;
  if (wear) {
    if (wear.hat === 'cap_red') P.hatA.add(cosPart('cap_red', 0xd43a4a));
    if (wear.hat === 'cap_violet') P.hatA.add(cosPart('cap_violet', 0x7c5cd6));
    if (wear.hat === 'crown') P.hatA.add(cosPart('crown'));
    if (wear.hair === 'mohawk') P.hairA.add(cosPart('mohawk', bodyCol ? bodyCol.clone().offsetHSL(0.08, 0.1, -0.12).getHex() : 0xa78bfa));
    if (wear.hair === 'crest') P.hairA.add(cosPart('crest'));
    if (wear.acc === 'shades') P.faceA.add(cosPart('shades'));
  }
  if (bodyCol && g.userData.bodyMat) g.userData.bodyMat.color.copy(bodyCol);
}

/* ----- wardrobe panel ----- */
function openWardrobe() {
  noteOpener();
  wardOpen = true;
  draftWear = { ...myCos.wear }; draftHue = (typeof myCos.hue === 'number') ? myCos.hue : 265;
  R.ward.hidden = false; R.wardres.textContent = '';
  R.hue.value = draftHue; R.hueval.textContent = '— ' + draftHue + '°';
  renderWard(); clearInput(); setPrompt(null); focusFirst(R.ward);
}
function closeWardrobe(save) {
  wardOpen = false; R.ward.hidden = true;
  const g = scene.userData.meGroup;
  if (!save && g) applyWear(g, myCos.wear, myCos.hue); // revert the preview
  draftWear = null; restoreOpener();
}
function renderWard() {
  for (const slot of ['hat', 'hair', 'acc']) {
    const box = R['ward_' + slot]; if (!box) continue;
    box.innerHTML = '';
    for (const it of COS_DISPLAY[slot]) {
      const owned = !it.price || myCos.own.includes(it.id);
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'w3chip' + (draftWear[slot] === it.id ? ' on' : '');
      chip.textContent = it.name + (owned ? '' : ' — ' + it.price + '¢');
      chip.addEventListener('click', async () => {
        if (!owned) {
          if (chip.dataset.confirm) { await buyCos(it.id, chip); }
          else { chip.dataset.confirm = '1'; chip.textContent = 'buy ' + it.name + ' for ' + it.price + '¢?'; setTimeout(() => { delete chip.dataset.confirm; renderWard(); }, 2600); }
          return;
        }
        draftWear[slot] = it.id;
        const g = scene.userData.meGroup; if (g) applyWear(g, draftWear, draftHue);
        renderWard();
      });
      box.appendChild(chip);
    }
  }
}
async function buyCos(id, chip) {
  chip.disabled = true;
  try {
    const r = await (await fetch('/api/world3d/cos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'buy', id }) })).json();
    if (r.ok) {
      myCos = r.cos; R.bal.textContent = '¢ ' + r.bal + ' six cents';
      for (const slot of ['hat', 'hair', 'acc']) if (COS_DISPLAY[slot].some((x) => x.id === id)) draftWear[slot] = id;
      const g = scene.userData.meGroup; if (g) applyWear(g, draftWear, draftHue);
      R.wardres.textContent = 'bought — it is urs now';
    } else R.wardres.textContent = r.err || 'buy failed';
  } catch (e) { R.wardres.textContent = 'network hiccup — try again'; }
  renderWard();
}
async function saveWardrobe() {
  const sb = document.getElementById('w3wardsave'); if (sb) { sb.classList.add('busy'); sb.disabled = true; }
  try {
    for (const slot of ['hat', 'hair', 'acc']) {
      if (draftWear[slot] !== myCos.wear[slot]) {
        const r = await (await fetch('/api/world3d/cos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'wear', slot, id: draftWear[slot] }) })).json();
        if (!r.ok) { R.wardres.textContent = r.err || 'save failed'; return; }
        myCos = r.cos;
      }
    }
    if (draftHue !== myCos.hue) {
      const r = await (await fetch('/api/world3d/cos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'wear', slot: 'hue', id: draftHue }) })).json();
      if (!r.ok) { R.wardres.textContent = r.err || 'save failed'; return; }
      myCos = r.cos;
    }
    toast('fit saved');
    if (sb) sb.classList.add('ok');
    closeWardrobe(true);
    ping(true);
  } catch (e) { R.wardres.textContent = 'network hiccup — try again'; }
  finally { if (sb) { sb.classList.remove('busy'); sb.disabled = false; setTimeout(() => sb.classList.remove('ok'), 600); } }
}

/* ----- a generic room shell for the new interiors ----- */
function roomShell(CX, opts) {
  const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.9, metalness: 0.02 }, o || {}));
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  const floor = new THREE.Mesh(new THREE.BoxGeometry(22.6, 0.2, 18.6), M(opts.floor, { map: opts.floorTex || null, roughness: 0.95 }));
  floor.position.set(CX, -0.1, 0); floor.receiveShadow = true; scene.add(floor);
  const wallM = M(opts.wall, { map: opts.wallTex || null });
  box(22.6, 4.3, 0.3, wallM, CX, 2.15, -9.15);
  box(10.1, 4.3, 0.3, wallM, CX - 6.05, 2.15, 9.15); box(10.1, 4.3, 0.3, wallM, CX + 6.05, 2.15, 9.15);
  box(2.4, 1.5, 0.3, wallM, CX, 3.55, 9.15);
  box(0.3, 4.3, 18.6, wallM, CX - 11.15, 2.15, 0); box(0.3, 4.3, 18.6, wallM, CX + 11.15, 2.15, 0);
  box(22.6, 0.25, 18.6, M(0x241839, { roughness: 1 }), CX, 4.42, 0);
  boxColliders.push(
    { minX: CX - 11.3, maxX: CX + 11.3, minZ: -9.5, maxZ: -8.8 },
    { minX: CX - 11.3, maxX: CX - 0.9, minZ: 8.8, maxZ: 9.5 },
    { minX: CX + 0.9, maxX: CX + 11.3, minZ: 8.8, maxZ: 9.5 },
    { minX: CX - 1.1, maxX: CX + 1.1, minZ: 8.7, maxZ: 9.5 },
    { minX: CX - 11.5, maxX: CX - 10.8, minZ: -9.3, maxZ: 9.3 },
    { minX: CX + 10.8, maxX: CX + 11.5, minZ: -9.3, maxZ: 9.3 });
  const doorM = box(1.7, 2.8, 0.12, M(0x6b4226, { roughness: 0.9 }), CX, 1.4, 8.95);
  doorM.castShadow = false;
  return { M, box };
}

/* ----- the arcade (world x 2029..2051) ----- */
function buildArcade() {
  const CX = 2040;
  const carpetTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#120a24'; g.fillRect(0, 0, w, h);
    const cols = ['#d9b380', '#f472b6', '#67e8f9', '#ffc95e'];
    const r2 = mulberry32(9);
    for (let i = 0; i < 22; i++) {
      g.strokeStyle = cols[i % 4]; g.lineWidth = 2; g.globalAlpha = 0.5;
      g.beginPath();
      const x = r2() * w, y = r2() * h;
      if (i % 3 === 0) { g.arc(x, y, 4 + r2() * 7, 0, 7); } else if (i % 3 === 1) { g.moveTo(x, y); g.lineTo(x + 12, y + 6); g.lineTo(x + 4, y + 14); g.closePath(); }
      else { g.moveTo(x, y); g.lineTo(x + 14, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
  }, 5, 4);
  const { M, box } = roomShell(CX, { floor: 0xffffff, floorTex: carpetTex, wall: 0x3a2a33 });
  for (const [nz, col] of [[-8.92, 0xa78bfa], [8.92, 0x67e8f9]]) {
    const strip = box(21, 0.14, 0.06, M(col, { emissive: col, emissiveIntensity: 2 }), CX, 3.6, nz);
    strip.castShadow = false;
  }
  const glow = new THREE.PointLight(0xa78bfa, 420, 18, 2); glow.position.set(CX, 3.2, 0); scene.add(glow);
  interiorLights.push({ light: glow, zone: 'arcade' });
  const cabCols = [0xa78bfa, 0xf472b6, 0x67e8f9, 0xffd257, 0x4ade80, 0xfb923c];
  const cabNames = ['NEBULA DRIFT', 'PIXEL KART', 'STAR SIEGE', 'MOON HOPPER', 'BLOCK BREAKER', 'VOID RACER'];
  function cabinet(x, z, ry2, i) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry2; scene.add(g);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.9, 0.85), M(0x191233, { roughness: 0.6 }));
    body.position.y = 0.95; body.castShadow = true; g.add(body);
    const scrTex = canvasTex(64, 80, (gg, w, h) => {
      gg.fillStyle = '#0a0618'; gg.fillRect(0, 0, w, h);
      gg.fillStyle = '#' + cabCols[i].toString(16).padStart(6, '0');
      const r3 = mulberry32(i * 7 + 3);
      for (let k = 0; k < 14; k++) gg.fillRect(r3() * w * 0.85, r3() * h * 0.8, 5, 5);
      gg.fillRect(10, h - 18, w - 20, 5);
    });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.0), new THREE.MeshBasicMaterial({ map: scrTex }));
    scr.position.set(0, 1.32, 0.44); scr.rotation.x = -0.16; g.add(scr);
    const marq = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.3, 0.06), M(cabCols[i], { emissive: cabCols[i], emissiveIntensity: 1.6 }));
    marq.position.set(0, 1.98, 0.4); g.add(marq);
    const stick = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), M(0xf43f5e, { roughness: 0.35 }));
    stick.position.set(-0.2, 0.98, 0.5); g.add(stick);
    addCollider(x, z, 0.85);
    addInteract('arcade', x + Math.sin(ry2) * 1.3, z + Math.cos(ry2) * 1.3, 1.9, 'play ' + cabNames[i].toLowerCase(), () => { toast(cabNames[i] + ' — pick a game'); openGames(); });
  }
  cabinet(CX - 7.5, -7.6, 0, 0); cabinet(CX - 4.5, -7.6, 0, 1); cabinet(CX - 1.5, -7.6, 0, 2);
  cabinet(CX + 1.5, -7.6, 0, 3); cabinet(CX + 4.5, -7.6, 0, 4); cabinet(CX + 7.5, -7.6, 0, 5);
  box(4.6, 0.08, 0.7, M(0x6b4226), CX + 8.6, 1.5, -3);
  box(4.6, 0.08, 0.7, M(0x6b4226), CX + 8.6, 2.2, -3);
  for (let i = 0; i < 4; i++) {
    const plush = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), M(cabCols[i], { roughness: 0.95 }));
    plush.position.set(CX + 7.2 + i * 0.95, 1.78, -3); plush.scale.y = 0.85; scene.add(plush);
  }
  boxColliders.push({ minX: CX + 6.2, maxX: CX + 11, minZ: -3.5, maxZ: -2.5 });
  for (const [sx, sz] of [[CX - 4.5, -5.2], [CX + 1.5, -5.2]]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.62, 12), M(0x31235e, { roughness: 0.8 }));
    st.position.set(sx, 0.31, sz); st.castShadow = true; scene.add(st);
    addInteract('arcade', sx, sz, 1.6, 'sit', () => sitDown({ x: sx, z: sz, ry: Math.PI }));
  }
  const vex = makeAvatar(265, 'vex');
  vex.position.set(CX + 8.6, 0, -0.5); vex.rotation.y = -1.2;
  scene.add(vex);
  const vexEntry = { zone: 'arcade', g: vex, st: { phase: 2.6, speed: 0, grounded: true, landT: 0, pose: 'stand' } };
  NPCS.push(vexEntry);
  attachRig(vexEntry, 265);
  addInteract('arcade', CX + 8.6, -0.5, 2.4, 'talk to vex', () => openDlg('@vex — arcade attendant', [
    'every cabinet in here runs the sites own games. no tokens, no catch.',
    'the 2048 high score board is a war zone rn.',
    'if a screen ever goes dark, tell bro. he fixes things at 2am.',
  ]));
  addInteract('arcade', CX, 7.2, 2.5, 'leave the arcade', () => { standUp(); fadeThrough(() => warpTo(-62, -42.8, 0)); });
}

/* ----- games overlay (real, already-integrated games only) ----- */
let gamesOpen = false;
function openGames() { noteOpener(); gamesOpen = true; R.games.hidden = false; clearInput(); setPrompt(null); focusFirst(R.games); }
function closeGames() { gamesOpen = false; R.games.hidden = true; restoreOpener(); }

/* ----- the clothing store (world x 2069..2091) ----- */
function buildClothing() {
  const CX = 2080;
  const { M, box } = roomShell(CX, { floor: 0xa08b6d, wall: 0xe8dcc8 });
  const glow = new THREE.PointLight(0xffe9c4, 430, 18, 2); glow.position.set(CX, 3.2, 0); scene.add(glow);
  interiorLights.push({ light: glow, zone: 'clothing' });
  const shirtCols = [0xf472b6, 0xa78bfa, 0x67e8f9, 0xffd257, 0x4ade80, 0xfb923c, 0xf3efff, 0xd43a4a];
  function rack(x, z, ry2) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry2; scene.add(g);
    const metal = M(0xb9bed4, { metalness: 0.7, roughness: 0.3 });
    for (const sx of [-1.4, 1.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), metal);
      post.position.set(sx, 0.75, 0); g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.9, 6), metal);
    bar.rotation.z = Math.PI / 2; bar.position.y = 1.5; g.add(bar);
    for (let i = 0; i < 6; i++) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.72, 0.1), M(shirtCols[(i * 3 + 2) % 8], { roughness: 0.95 }));
      sh.position.set(-1.15 + i * 0.46, 1.1, 0); sh.castShadow = true; g.add(sh);
    }
    boxColliders.push({ minX: x - 1.6, maxX: x + 1.6, minZ: z - 0.4, maxZ: z + 0.4 });
  }
  rack(CX - 5.5, -4.5, 0); rack(CX + 0.5, -4.5, 0); rack(CX - 5.5, 0.5, 0); rack(CX + 5.5, 0.5, 0.4);
  const fits = [
    { hue: 265, wear: { hat: 'crown', hair: 'crest', acc: 'shades' } },
    { hue: 330, wear: { hat: 'cap_red', hair: 'mohawk', acc: 'none' } },
    { hue: 150, wear: { hat: 'cap_violet', hair: 'none', acc: 'shades' } },
  ];
  fits.forEach((f, i) => {
    const mx = CX - 2.5 + i * 3.2, mz = -7.6;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.3, 14), M(0x31235e, { roughness: 0.7 }));
    ped.position.set(mx, 0.15, mz); scene.add(ped);
    const mq = makeAvatar(f.hue, '');
    mq.position.set(mx, 0.3, mz); mq.rotation.y = 0.4 - i * 0.3;
    scene.add(mq);
    applyWear(mq, f.wear, f.hue);
    addCollider(mx, mz, 0.95);
  });
  const mir = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.9), new THREE.MeshStandardMaterial({ color: 0xafc4e8, metalness: 0.9, roughness: 0.12 }));
  mir.position.set(CX - 10.95, 2.0, 3.5); mir.rotation.y = Math.PI / 2; scene.add(mir);
  box(0.08, 3.1, 2.4, M(0xc9a227, { metalness: 0.6, roughness: 0.4 }), CX - 11.0, 2.0, 3.5);
  addInteract('clothing', CX - 9.6, 3.5, 2.2, 'open wardrobe', openWardrobe);
  box(3.6, 1.05, 1.1, M(0x3d2417), CX + 7.6, 0.53, -6.4);
  boxColliders.push({ minX: CX + 5.7, maxX: CX + 9.5, minZ: -7, maxZ: -5.8 });
  const sol = makeAvatar(285, 'sol');
  sol.position.set(CX + 7.6, 0, -7.6); sol.rotation.y = 0.1;
  scene.add(sol);
  const solEntry = { zone: 'clothing', routine: { a: [2074, 0], b: [2086, 0], dwell: 6, off: 4, faceA: 0.4, faceB: -0.4 }, g: sol, st: { phase: 4.1, speed: 0, grounded: true, landT: 0, pose: 'stand' } };
  NPCS.push(solEntry);
  attachRig(solEntry, 285);
  addInteract('clothing', CX + 7.6, -5.2, 2.2, 'talk to sol', () => openDlg('@sol — clothing co.', [
    'the mirror over there is the wardrobe. try stuff on, save when it hits.',
    'the crown is 600. yes it is worth it. no i will not discount it.',
    'everything u buy is urs on ur account — server keeps the receipts.',
  ]));
  const bench = box(2.6, 0.5, 0.7, M(0x7a4a8a, { roughness: 0.9 }), CX + 2, 0.25, 5.5);
  bench.castShadow = true;
  addInteract('clothing', CX + 1.4, 5.5, 1.7, 'sit', () => sitDown({ x: CX + 1.4, z: 5.5, ry: Math.PI }));
  addInteract('clothing', CX + 2.6, 5.5, 1.7, 'sit', () => sitDown({ x: CX + 2.6, z: 5.5, ry: Math.PI }));
  addInteract('clothing', CX, 7.2, 2.5, 'leave clothing co.', () => { standUp(); fadeThrough(() => warpTo(43.4, -35.0, 0)); });
}

/* ----- town-side doors for the two new interiors ----- */
function enterArcade() { standUp(); fadeThrough(() => warpTo(2040, 5.5, Math.PI)); }
function enterClothing() { standUp(); fadeThrough(() => warpTo(2080, 5.5, Math.PI)); }
function buildTownDoors544() {
  addInteract('town', -62, -42.8, 2.7, 'enter the arcade', enterArcade);
  addInteract('town', 43.4, -35.0, 2.7, 'enter clothing co.', enterClothing);
  const M2 = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0.02 }, o || {}));
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.0, 3.1, 0.14), M2(0x2a1e4a, { roughness: 0.6 }));
  door.position.set(-62, 1.55, -43.9); scene.add(door);
  const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.1), M2(0xa78bfa, { emissive: 0xa78bfa, emissiveIntensity: 2 }));
  glowStrip.position.set(-62, 3.25, -43.9); scene.add(glowStrip);
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.9), M2(0x4a4470));
  step.position.set(-62, 0.09, -43.4); scene.add(step);
}





/* ---------- v551: NPC schedules — strollers tour the town with stops,
 * interior npcs work routines between two posts. everything is a pure
 * function of the clock (same trick as the birds), so every client
 * sees the same town living the same life. nobody teleports: posts
 * are joined by straight walks on open floor, and nobody crosses a
 * building or a counter to get there. */
const STROLL_WP = [
  // x, z, dwell seconds at this point, face-x, face-z (what they look at while dwelling)
  [-30, -20, 0, 0, 0], [30, -20, 3, -36, -40], [58, -30, 0, 0, 0], [96, -8, 0, 0, 0],
  [112, 14, 6, 118, 12], [104, 34, 0, 0, 0], [100, 60, 0, 0, 0], [58, 86, 5, 18, 88],
  [0, 90, 0, 0, 0], [-58, 86, 0, 0, 0], [-62, 58, 3, -64, 46], [-36, 10, 0, 0, 0],
];
let strollTL = null;
function strollTimeline() {
  if (strollTL) return strollTL;
  const legs = []; let T = 0;
  for (let i = 0; i < STROLL_WP.length; i++) {
    const a = STROLL_WP[i], b = STROLL_WP[(i + 1) % STROLL_WP.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    legs.push({ a, b, len, walk: len / 2.1, dwell: a[2] });
    T += len / 2.1 + a[2];
  }
  strollTL = { legs, T };
  return strollTL;
}
function tickStrollers(dt, now) {
  const { legs, T } = strollTimeline();
  for (const s of STROLLERS) {
    let d = ((now / 1000) + s.off * T) % T;
    let leg = legs[0];
    for (const L of legs) {
      if (d < L.walk) { leg = L; break; }
      d -= L.walk;
      if (d < L.dwell) { leg = { ...L, dwellAt: true, a: L.b, b: L.b }; d = -1; break; }
      d -= L.dwell; leg = L;
    }
    if (leg.dwellAt || d < 0) {
      const p = leg.a;
      s.g.position.set(p[0], groundH(p[0], p[1]), p[1]);
      if (p[3] || p[4]) s.g.rotation.y = Math.atan2(p[3] - p[0], p[4] - p[1]);
      s.st.speed = 0;
    } else {
      const t = d / leg.walk, a = leg.a, b = leg.b;
      const sx2 = a[0] + (b[0] - a[0]) * t, sz2 = a[1] + (b[1] - a[1]) * t;
      s.g.position.set(sx2, groundH(sx2, sz2), sz2);
      s.g.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
      s.st.speed = 2.1;
    }
    if (s.rig) updateRig(s, dt); else animateAvatar(s.g, s.st, dt, now);
  }
}
function tickNPCRoutines(now) {
  const t = now / 1000;
  for (const n of NPCS) {
    const r = n.routine;
    if (!r) continue;
    const [ax, az] = r.a, [bx, bz] = r.b;
    const dist = Math.hypot(bx - ax, bz - az), walk = dist / 1.6;
    const cyc = walk * 2 + r.dwell * 2;
    let d = (t + r.off) % cyc;
    let x, z, face, moving = 0;
    if (d < walk) { const u = d / walk; x = ax + (bx - ax) * u; z = az + (bz - az) * u; face = Math.atan2(bx - ax, bz - az); moving = 1.6; }
    else if (d < walk + r.dwell) { x = bx; z = bz; face = r.faceB; }
    else if (d < walk * 2 + r.dwell) { const u = (d - walk - r.dwell) / walk; x = bx + (ax - bx) * u; z = bz + (az - bz) * u; face = Math.atan2(ax - bx, az - bz); moving = 1.6; }
    else { x = ax; z = az; face = r.faceA; }
    n.g.position.set(x, 0, z);
    n.g.rotation.y = face;
    n.st.speed = moving;
  }
}

/* ---------- v550: sound design — zone ambience + footsteps + doors ----------
 * the pad from ensureAudio gets a per-zone voice: the filter center
 * and pad level ease toward the room ur in (cafe warmer, library
 * quieter, arcade brighter). footsteps are short filtered noise
 * bursts fired off the head-bob cycle, voiced by surface (grass /
 * stone / wood). doors get a soft sweep when u pass through one.
 * everything rides the same AudioContext the jukebox suspends, and
 * nothing sounds until the first user gesture (ensureAudio's rule). */
let acFilter = null, acSfx = null, ambZone = '', lastStepSign = 0, noiseBuf = null;
const AMB = {
  town: { f: 420, g: 0.14 },
  coffee: { f: 660, g: 0.11 },
  arcade: { f: 940, g: 0.12 },
  clothing: { f: 520, g: 0.10 },
  library: { f: 300, g: 0.07 },
  rec: { f: 560, g: 0.12 },
  apt: { f: 380, g: 0.09 },
};
function setAmbience(zone) {
  ambZone = zone;
  if (!AC || !acMaster || !acFilter) return;
  const a = AMB[zone] || AMB.town, t = AC.currentTime;
  acFilter.frequency.setTargetAtTime(a.f, t, 0.6);
  acMaster.gain.setTargetAtTime(SET.vol * a.g, t, 0.6);
}
function sfxStep() {
  if (!AC || AC.state !== 'running' || !acSfx || !SET.sfx) return;
  if (!noiseBuf) {
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.12, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const src = AC.createBufferSource(); src.buffer = noiseBuf;
  const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  const z = zoneNow();
  bp.frequency.value = z === 'town' ? (districtNow === 'the plaza' ? 700 : 480) : 950;
  const g = AC.createGain();
  g.gain.value = SET.sfx * (sprintingNow() ? 0.20 : 0.13);
  src.connect(bp); bp.connect(g); g.connect(acSfx);
  src.start();
}
function sfxDoor() {
  if (!AC || AC.state !== 'running' || !acSfx || !SET.sfx) return;
  const o = AC.createOscillator(); o.type = 'triangle';
  const t = AC.currentTime;
  o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.13);
  const g = AC.createGain();
  g.gain.setValueAtTime(SET.sfx * 0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  o.connect(g); g.connect(acSfx); o.start(t); o.stop(t + 0.18);
}
function tickAudio() {
  const z = zoneNow();
  if (z !== ambZone) setAmbience(z);
  if (!AC) return;
  // a footstep each time the bob cycle crosses zero (two per stride)
  if (grounded && !sitting && speedSm > 1.2) {
    const sn = Math.sin(bobPhase * 2) >= 0 ? 1 : -1;
    if (lastStepSign !== 0 && sn !== lastStepSign) sfxStep();
    lastStepSign = sn;
  } else lastStepSign = 0;
}

/* ---------- v550: cozy interiors — pendants, string lights, lamps, plants ----------
 * emissive-only dressing (no new point lights — the perf rule), one
 * pass over the six interiors at their fixed world anchors. */
function cozyInteriors() {
  const cordM = new THREE.MeshStandardMaterial({ color: 0x2c2622, roughness: 0.8 });
  const shadeM = new THREE.MeshStandardMaterial({ color: 0xa35a3c, roughness: 0.7 });
  const bulbM = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const leafM = new THREE.MeshStandardMaterial({ color: 0x5d8148, roughness: 1, flatShading: true });
  const potM = new THREE.MeshStandardMaterial({ color: 0xa35a3c, roughness: 0.9 });
  const pendant = (x, y, z) => {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), cordM); cord.position.set(x, y + 0.55, z); scene.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 10, 1, true), shadeM); shade.position.set(x, y, z); scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), bulbM); bulb.position.set(x, y - 0.1, z); scene.add(bulb);
  };
  const plant = (x, z, s) => {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.16 * s, 0.34 * s, 8), potM); pot.position.set(x, 0.17 * s, z); scene.add(pot);
    const fol = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 * s, 0), leafM); fol.position.set(x, 0.62 * s, z); fol.castShadow = true; scene.add(fol);
  };
  const stringLights = (cx, z, y, n, span) => {
    const cols = [0xffd9a0, 0xf9a8d4, 0xa8d8f0, 0xffd257];
    for (let i = 0; i < n; i++) {
      const x = cx - span / 2 + (span * i) / (n - 1);
      const sag = Math.sin((i / (n - 1)) * Math.PI) * -0.22;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), new THREE.MeshBasicMaterial({ color: cols[i % 4] }));
      b.position.set(x, y + sag, z); scene.add(b);
    }
  };
  // cafe: pendants over the counter + plants by the sofa
  pendant(1996, 3.1, -5.2); pendant(2000, 3.1, -5.2); pendant(2004, 3.1, -5.2);
  plant(1991.5, 6.5, 1); plant(2009, -6.5, 1.2);
  // arcade: string lights along both long walls
  stringLights(2040, -8.4, 3.7, 13, 19); stringLights(2040, 8.4, 3.7, 13, 19);
  // clothing: plants + a real mirror sheen by the wardrobe station
  plant(2071.5, -7.5, 1.1); plant(2088.5, 6.8, 1);
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.1), new THREE.MeshStandardMaterial({ color: 0xdfe9ee, roughness: 0.06, metalness: 0.9 }));
  mirror.position.set(2086, 1.9, -8.85); scene.add(mirror);
  // library: it already has table lamps — just plants by the door wall
  plant(2111, 7.8, 1.2); plant(2129, 7.8, 1.2);
  // rec: string lights over the lounge + plants
  stringLights(2160, 0, 3.8, 11, 16);
  plant(2151.5, -7.6, 1); plant(2168.5, 7.6, 1.1);
  // apartment: floor lamp by the couch, plant on the desk, picture frames
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.5, 6), cordM); fl.position.set(2207.8, 0.75, 3.4); scene.add(fl);
  const fls = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.3, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffbf70, emissiveIntensity: 0.9, side: THREE.DoubleSide })); fls.position.set(2207.8, 1.6, 3.4); scene.add(fls);
  plant(2192, -7.6, 0.9);
  const artTex = canvasTex(64, 48, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#7ba7dc'); gr.addColorStop(0.7, '#f7b267'); gr.addColorStop(1, '#e88ca0'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#fff2cf'; g.beginPath(); g.arc(46, 12, 5, 0, 7); g.fill(); });
  for (const [x, z, ry] of [[2196, -8.8, 0], [2204, -8.8, 0]]) {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.06), shadeM); fr.position.set(x, 2.1, z); scene.add(fr);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.8), new THREE.MeshBasicMaterial({ map: artTex })); art.position.set(x, 2.1, z + 0.045); scene.add(art);
  }
}

/* ---------- v549: environment dressing — the town feels lived in ----------
 * leafy trees beside the pines, garden beds in the park, a bus stop
 * on south avenue, mailboxes at the houses, sittable park benches,
 * birds circling the pond and petals drifting off the sakuras.
 * all client-side dressing: no server state, no new colliders except
 * small ones around solid props. birds + petals run off the clock so
 * every client sees the same sky. */
let BIRDS = [], petals = null, petalDat = null;
/* ================= stage 12: entrance dressing + houses =================
 * Every enterable building gets the same entrance language the
 * modeled buildings have: a stone step, a colored door mat, twin
 * planters and lantern posts (emissive only — no new point
 * lights). Houses get chimneys. Small props, deliberate spots,
 * paths and door swings stay clear. */
/* ============ CP6 NATURE (stage 02 rebuild): the west forest, east
 * meadow and all ground cover rebuilt from the curated Quaternius
 * MegaKit library (CC0 — assets/ASSET_SOURCES.md). Replaces the stage-09
 * primitive instancing and the stage-10 Blender-tree forest. Placement
 * is seeded + deterministic: every client grows the identical world. */
let NATURE = { trees: 0, grass: 0, flowers: 0 };
const NAT = '/world3d/assets/nature/';
function natPlace(name, x, z, s, ry, colliderR) {
  const lod = registerLOD(name, x, z, s, ry);
  loadAsset(NAT + name + '.glb', prioOf(x, z)).then((proto) => {
    if (!proto) return; // ECO: the real-model LOD (if any) stays visible; never a primitive
    const m = proto.clone(true);
    m.position.set(x, groundH(x, z) - 0.05, z);
    m.rotation.y = ry || 0;
    m.scale.setScalar(s);
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(m);
    if (lod) { lod.model = m; m.visible = lod.near; setImpMatrix(lod); }
  });
  if (colliderR) addCollider(x, z, colliderR);
}
/* one InstancedMesh from a (single-mesh) library model.
 * list entries: [x, z, scale, ry]. Optional tint(x,z,i) -> THREE.Color. */
function natInst(name, list, tint, lift) {
  if (!list.length) return;
  let prio = 120;
  for (const p of list) { const d = prioOf(p[0], p[1]); if (d < prio) prio = d; }
  loadAsset(NAT + name + '.glb', prio).then((proto) => {
    if (!proto) return;
    let mesh = null;
    proto.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    let mat = mesh.material;
    if (lift) { // grass cards read near-black in shadow: clone + gentle emissive lift
      mat = mat.clone();
      mat.emissive = new THREE.Color(0x1c2a0e);
      mat.emissiveIntensity = 0.38;
    }
    const inst = new THREE.InstancedMesh(mesh.geometry, mat, list.length);
    const d = new THREE.Object3D();
    list.forEach(([x, z, s, ry], i) => {
      d.position.set(x, groundH(x, z) - 0.03, z);
      d.rotation.set(0, ry || 0, 0);
      d.scale.setScalar(s);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
      if (tint) inst.setColorAt(i, tint(x, z, i));
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.receiveShadow = true;
    // STAGE 05: real frustum culling — a bounding sphere fitted to the
    // instance points replaces the old frustumCulled=false blanket.
    let bcx = 0, bcz = 0;
    for (const p of list) { bcx += p[0]; bcz += p[1]; }
    bcx /= list.length; bcz /= list.length;
    let brad = 0;
    for (const p of list) { const dd = Math.hypot(p[0] - bcx, p[1] - bcz) + 3; if (dd > brad) brad = dd; }
    inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(bcx, 1, bcz), brad);
    scene.add(inst);
  });
}
function buildNature() {
  const rnd = mulberry32(90221022);
  const pathPts = [[-127, 32], [-140, 24], [-150, 8], [-158, -6], [-167, -19], [-174, -30], [-179, -37]];
  const nearPath = (x, z, r) => pathPts.some((p) => Math.hypot(x - p[0], z - p[1]) < r);
  const COMMON = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'];
  const PINES = ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5'];
  const treeSpots = [];
  // ---- west forest: dense clusters + scatter, path + clearing carved out
  const clusters = [[-168, -42, 30], [-172, 48, 27], [-158, 92, 20], [-180, -85, 22], [-150, -95, 20]];
  for (const [cx, cz, r] of clusters) {
    const n = 12 + (rnd() * 5 | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * r;
      treeSpots.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d * 0.8]);
    }
  }
  for (let i = 0; i < 16; i++) treeSpots.push([-140 - rnd() * 48, -100 + rnd() * 205]);
  const kept = treeSpots.filter(([x, z]) => x > -195 && x < -131 && Math.abs(z) < 112 && !nearPath(x, z, 5.5) && Math.hypot(x + 179, z + 38) > 9.5);
  kept.forEach(([x, z], i) => {
    const pine = rnd() < 0.32;
    const name = pine ? PINES[(rnd() * 5) | 0] : COMMON[(rnd() * 5) | 0];
    const sc = (pine ? 0.95 : 0.9) + rnd() * 0.45;
    natPlace(name, x, z, sc, rnd() * TAU, 0.8 * sc);
    FOREST.trees++; NATURE.trees++;
  });
  // ---- landmarks: red twisted trees + bare snags
  natPlace('TwistedTree_2', -179, -38, 0.66, 0.4, 1.1);
  natPlace('TwistedTree_1', -160, 78, 0.55, 2.2, 0.9);
  natPlace('TwistedTree_3', -146, -64, 0.5, 4.0, 0.9);
  natPlace('DeadTree_3', -186, -70, 1.0, 1.1, 0.7);
  natPlace('DeadTree_3', -138, 96, 0.85, 3.3, 0.6);
  NATURE.trees += 5;
  // ---- east meadow trees: lone broadleafs + a pine trio at the rim
  const meadowSpots = [[142, -18], [156, 58], [146, 88], [172, -52], [186, 22], [158, -84], [138, 30], [184, 66], [168, 96]];
  for (const [x, z] of meadowSpots) {
    natPlace(COMMON[(rnd() * 5) | 0], x, z, 1.0 + rnd() * 0.3, rnd() * TAU, 0.85);
    NATURE.trees++;
  }
  for (const [x, z] of [[190, -20], [192, 14], [188, 48]]) {
    natPlace(PINES[(rnd() * 5) | 0], x, z, 1.15 + rnd() * 0.25, rnd() * TAU, 0.9);
    NATURE.trees++;
  }
  // ---- boulders: forest + meadow + rim
  const ROCKS = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'];
  const rockSpots = [[-150, -20], [-166, 12], [-142, 66], [-176, -88], [-156, -100], [148, 8], [176, 40], [160, -30], [-136, -48], [142, 66]];
  for (const [x, z] of rockSpots) natPlace(ROCKS[(rnd() * 3) | 0], x, z, 0.8 + rnd() * 0.9, rnd() * TAU, 0);
  // ---- ground cover: grass by zone (instanced real models)
  const grassTall = [], grassShort = [], wispyTall = [], wispyShort = [];
  const scatter = (list, n, x0, x1, z0, z1, sMin, sMax, reject) => {
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 30) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (reject && reject(x, z)) continue;
      list.push([x, z, sMin + rnd() * (sMax - sMin), rnd() * TAU]);
      placed++;
    }
  };
  const pondReject = (x, z) => Math.hypot(x - 118, z - 12) < 15.5;
  scatter(grassTall, 700, -194, -133, -108, 108, 0.85, 1.5, (x, z) => nearPath(x, z, 3.2));
  scatter(grassTall, 240, 92, 132, -30, 62, 0.8, 1.3, pondReject);
  scatter(grassShort, 380, -126, 126, -100, 104, 0.7, 1.1, pondReject);
  scatter(wispyTall, 620, 133, 194, -104, 106, 0.85, 1.45, (x, z) => Math.hypot(x - 174, z - 8) < 7);
  scatter(wispyShort, 360, 128, 194, -104, 106, 0.65, 1.0, null);
  scatter(wispyShort, 120, -132, -126, -40, 60, 0.65, 1.0, null);
  const tintGrass = () => {
    const v = 0.86 + rnd() * 0.26;
    return new THREE.Color(v * 1.03, v, v * 0.92);
  };
  natInst('Grass_Common_Tall', grassTall, tintGrass, true);
  natInst('Grass_Common_Short', grassShort, tintGrass, true);
  natInst('Grass_Wispy_Tall', wispyTall, tintGrass, true);
  natInst('Grass_Wispy_Short', wispyShort, tintGrass, true);
  NATURE.grass = grassTall.length + grassShort.length + wispyTall.length + wispyShort.length;
  VEG.grass = NATURE.grass;
  // ---- flowers: composed clusters, not uniform scatter
  const fl3 = [], fl4 = [];
  const flowerCenters = [];
  for (let i = 0; i < 16; i++) flowerCenters.push([136 + rnd() * 54, -100 + rnd() * 204]);
  for (let i = 0; i < 6; i++) flowerCenters.push([94 + rnd() * 36, -26 + rnd() * 84]);
  for (let i = 0; i < 4; i++) flowerCenters.push([-179 + (rnd() - 0.5) * 22, -38 + (rnd() - 0.5) * 22]);
  flowerCenters.forEach(([cx, cz], ci) => {
    const list = ci % 2 ? fl4 : fl3;
    const n = 3 + (rnd() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 2.6;
      list.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.9 + rnd() * 0.5, rnd() * TAU]);
    }
  });
  natInst('Flower_3_Group', fl3, null);
  natInst('Flower_4_Group', fl4, null);
  NATURE.flowers = fl3.length + fl4.length;
  VEG.flowers = NATURE.flowers;
  // ---- forest floor detail: ferns, mushrooms, plants, pebbles
  const ferns = [], mush = [], plants = [], pebbles = [];
  for (const [x, z] of kept) {
    if (rnd() < 0.55) ferns.push([x + (rnd() - 0.5) * 3.4, z + (rnd() - 0.5) * 3.4, 0.9 + rnd() * 0.5, rnd() * TAU]);
    if (rnd() < 0.3) mush.push([x + (rnd() - 0.5) * 2.2, z + (rnd() - 0.5) * 2.2, 0.8 + rnd() * 0.6, rnd() * TAU]);
  }
  scatter(plants, 54, 92, 132, -30, 62, 0.8, 1.2, pondReject);
  scatter(plants, 26, -194, -133, -108, 108, 0.8, 1.2, (x, z) => nearPath(x, z, 3.2));
  const curve = new THREE.CatmullRomCurve3(pathPts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  for (let i = 0; i < 46; i++) {
    const p = curve.getPoint(rnd());
    pebbles.push([p.x + (rnd() - 0.5) * 4.4, p.z + (rnd() - 0.5) * 4.4, 0.7 + rnd() * 0.9, rnd() * TAU]);
  }
  scatter(pebbles, 70, -194, 194, -108, 108, 0.6, 1.1, pondReject);
  natInst('Fern_1', ferns, null);
  natInst('Mushroom_Common', mush, null);
  natInst('Plant_7', plants, null);
  natInst('Pebble_Round_2', pebbles, null);
  VEG.pebbles = pebbles.length; VEG.mushrooms = mush.length;
  // ---- cobble patches along the forest path (real path stones)
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, p = curve.getPoint(t), tan = curve.getTangent(t);
    natPlace(i % 2 ? 'RockPath_Round_Wide' : 'RockPath_Round_Thin', p.x, p.z, 1.15, Math.atan2(tan.x, tan.z), 0);
  }
}


/* ============ STAGE 03: WORLD-WIDE COVER + DISTANCE STREAMING ======
 * Part 1 — grove inventory (the reference environment, buildTestGrove +
 * buildNature): Quaternius MegaKit CommonTree/Pine/TwistedTree models,
 * Bush_Common_Flowers, Rock_Medium, Fern_1, Flower_3/4_Group clusters,
 * Grass_Common/Wispy instanced tufts with instance-color variation and
 * a gentle emissive lift, terrain via groundH, golden-hour lighting.
 * This stage extends those exact systems world-wide and adds the
 * streaming layer: chunked lawn grass with distance visibility, tree
 * LOD (full model near / instanced decimated real model far,
 * hysteresis both ways; the LOD is also the loading + failure
 * fallback — ECO replaced the old cone/icosahedron impostors), and a horizon ring
 * so the world never ends at a hard edge. Buildings and terrain are
 * single persistent systems — they never unload, so there are no holes.
 * ================================================================== */
const LODREG = [];
let COVER = { lawn: 0, chunks: 0, chunksOn: 0, lodNear: 0, lodFar: 0 };
const GRASS_CHUNKS = [];
function registerLOD(name, x, z, s, ry) {
  if (!/^(CommonTree_|Pine_|TwistedTree_|DeadTree_|SakuraTree)/.test(name)) return null;
  const e = { name, x, z, s, ry: ry || 0, model: null, slot: -1, near: Math.hypot(x, z - 18) < 95 };
  LODREG.push(e);
  return e;
}
/* ECO: the old cone/icosahedron impostors are deleted. Distance
 * LOD is now the APPROVED MODEL ITSELF, decimated in Blender to
 * ~20% tris with its real textures (assets/nature/<name>_LOD.glb),
 * instanced per type. If the full model fails to load, the LOD
 * stays visible at every distance; if the LOD also fails, the
 * tree is simply absent. Nothing primitive ever renders. */
const LODTYPES = new Map();
function lodParts(proto) {
  const parts = [];
  proto.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : null;
    if (mats && o.geometry.groups && o.geometry.groups.length) {
      for (const g of o.geometry.groups) {
        const geo = new THREE.BufferGeometry();
        for (const k in o.geometry.attributes) geo.setAttribute(k, o.geometry.attributes[k]);
        const idx = o.geometry.index;
        if (idx) {
          const sub = idx.array.subarray(g.start, g.start + g.count);
          geo.setIndex(new THREE.BufferAttribute(sub.slice(), 1));
        }
        parts.push({ geometry: geo, material: mats[g.materialIndex || 0] });
      }
    } else {
      parts.push({ geometry: o.geometry, material: o.material });
    }
  });
  return parts;
}
function setImpMatrix(e) {
  const rec = LODTYPES.get(e.name);
  if (!rec || e.slot < 0) return;
  const d = new THREE.Object3D();
  d.position.set(e.x, groundH(e.x, e.z) - 0.05, e.z);
  d.rotation.y = e.ry;
  d.scale.setScalar(e.near && e.model ? 0.0001 : e.s);
  d.updateMatrix();
  for (const im of rec.ims) { im.setMatrixAt(e.slot, d.matrix); im.instanceMatrix.needsUpdate = true; }
}
function buildLodMeshes() {
  const byType = new Map();
  for (const e of LODREG) { if (!byType.has(e.name)) byType.set(e.name, []); byType.get(e.name).push(e); }
  for (const [name, entries] of byType) {
    entries.forEach((e, i) => { e.slot = i; });
    loadAsset(NAT + name + '_LOD.glb', 40).then((proto) => {
      if (!proto) return;
      const ims = lodParts(proto).map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, entries.length);
        im.frustumCulled = false; im.receiveShadow = true;
        scene.add(im); return im;
      });
      LODTYPES.set(name, { ims, entries });
      for (const e of entries) setImpMatrix(e);
      COVER.lodFar = LODREG.length;
    });
  }
  COVER.lodFar = LODREG.length;
}
let lodTickN = 0;
let lodLast = 0;
function tickLOD() {
  const tnow = performance.now();
  if (tnow - lodLast < 220) return; // time-based cadence: ~4.5 passes/sec at ANY frame rate
  lodLast = tnow;
  if (typeof zoneNow === 'function' && zoneNow() !== 'town') return;
  const tier = tierOf();
  const TD = tier === 'high' ? 130 : tier === 'low' ? 68 : 95;
  const GD = tier === 'high' ? 115 : tier === 'low' ? 62 : 88;
  let near = 0;
  for (const e of LODREG) {
    const d = Math.hypot(px - e.x, pz - e.z);
    const want = e.near ? d < TD + 10 : d < TD;
    if (want !== e.near) { e.near = want; if (e.model) e.model.visible = want; setImpMatrix(e); }
    if (e.near) near++;
  }
  COVER.lodNear = near; COVER.lodFar = LODREG.length - near;
  let on = 0;
  for (const c of GRASS_CHUNKS) {
    const d = Math.hypot(px - c.cx, pz - c.cz);
    const want = c.on ? d < GD + 12 : d < GD;
    if (want !== c.on) { c.on = want; if (c.mesh) c.mesh.visible = want; }
    if (c.on) on++;
  }
  COVER.chunksOn = on;
}
function natInstChunked(name, list, cx, cz) {
  const chunk = { cx, cz, on: Math.hypot(cx, cz - 18) < 100, mesh: null };
  GRASS_CHUNKS.push(chunk);
  if (!list.length) return;
  loadAsset(NAT + name + '.glb').then((proto) => {
    if (!proto) return;
    let mesh = null;
    proto.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    const mat = mesh.material.clone();
    mat.emissive = new THREE.Color(0x1c2a0e);
    mat.emissiveIntensity = 0.38;
    const inst = new THREE.InstancedMesh(mesh.geometry, mat, list.length);
    const d = new THREE.Object3D();
    const r2 = mulberry32(4400 + GRASS_CHUNKS.length);
    list.forEach(([x, z, s, ry], i) => {
      d.position.set(x, groundH(x, z) - 0.03, z);
      d.rotation.set(0, ry || 0, 0);
      d.scale.setScalar(s);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
      const v = 0.86 + r2() * 0.26;
      inst.setColorAt(i, new THREE.Color(v * 1.03, v, v * 0.92));
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.receiveShadow = true;
    let bcx = 0, bcz = 0;
    for (const p of list) { bcx += p[0]; bcz += p[1]; }
    bcx /= list.length; bcz /= list.length;
    let brad = 0;
    for (const p of list) { const dd = Math.hypot(p[0] - bcx, p[1] - bcz) + 3; if (dd > brad) brad = dd; }
    inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(bcx, 1, bcz), brad);
    inst.visible = chunk.on;
    scene.add(inst);
    chunk.mesh = inst;
  });
}
function buildHorizon() {
  const rnd = mulberry32(60606);
  // realism pass: the ring of ten flattened backdrop spheres is
  // GONE. they predated the real terrain rim (v573) and the layered
  // ridgeline rings (v574) and read as smooth untextured grey domes
  // floating in front of the actual mountains — the single most
  // artificial shape in the landscape. the terrain rim + rings now
  // carry the horizon on their own; the silhouette tree band below
  // stays (it sits on the rim apron and reads as distant forest).
  // ECO: the flat cone/blob silhouette band is replaced by real
  // (decimated, textured) library trees ringing the rim.
  const hSpots = [];
  for (let i = 0; i < 110; i++) {
    const a = (i / 110) * TAU + rnd() * 0.05;
    hSpots.push({ x: Math.cos(a) * (230 + rnd() * 16), z: Math.sin(a) * (174 + rnd() * 13), pine: rnd() < 0.45, s: 1.6 + rnd() * 1.4, ry: rnd() * TAU });
  }
  for (const [hName, list] of [['CommonTree_2', hSpots.filter((q) => !q.pine)], ['Pine_3', hSpots.filter((q) => q.pine)]]) {
    if (!list.length) continue;
    loadAsset(NAT + hName + '_LOD.glb', 90).then((proto) => {
      if (!proto) return;
      const d = new THREE.Object3D();
      for (const p of lodParts(proto)) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
        list.forEach((q, i) => {
          d.position.set(q.x, groundH(q.x, q.z) - 0.15, q.z);
          d.rotation.set(0, q.ry, 0); d.scale.setScalar(q.s); d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
        });
        im.frustumCulled = false;
        scene.add(im);
      }
    });
  }
}
/* settlements (worldgen Stage 6): whole-hamlet streaming around
 * the ring-1 waypoints. structures are clones of the kitbashed
 * GLBs (assets-src/hamlet.py); fences are one InstancedMesh per
 * hamlet. colliders are registered synchronously from the layout
 * data (so a hamlet is solid before its models land) and spliced
 * out on eviction. hysteresis: build < 370u, evict > 430u. */
const SETTLE_MESHES = new Map();
const SETTLE_URLS = { cottage: '/world3d/assets/architecture/cottage.glb', shed: '/world3d/assets/architecture/shed.glb', watchtower: '/world3d/assets/architecture/watchtower.glb', well: '/world3d/assets/environment/well.glb', fence: '/world3d/assets/environment/fence.glb', crate: '/world3d/assets/environment/crate.glb' };
const SETTLE_COL = { cottage: 3.6, shed: 3.2, watchtower: 3.0, well: 1.3, crate: 0.8, fence: 0.9 };
function ensureSettlement(s) {
  if (SETTLE_MESHES.has(s.i)) return;
  const entry = { group: new THREE.Group(), colliders: [] };
  SETTLE_MESHES.set(s.i, entry);
  scene.add(entry.group);
  const byKind = {};
  for (const it of s.items) {
    (byKind[it.n] = byKind[it.n] || []).push(it);
    const c = { x: it.x, z: it.z, r: SETTLE_COL[it.n] || 1 };
    colliders.push(c); entry.colliders.push(c);
  }
  for (const kind of Object.keys(byKind)) {
    loadAsset(SETTLE_URLS[kind], 40).then((proto) => {
      if (!proto || SETTLE_MESHES.get(s.i) !== entry) return;
      const list = byKind[kind];
      if (kind === 'fence') {
        let mesh = null; proto.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
        if (!mesh) return;
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        const d = new THREE.Object3D();
        list.forEach((it, k) => { d.position.set(it.x, groundH(it.x, it.z) - 0.04, it.z); d.rotation.set(0, it.ry, 0); d.updateMatrix(); im.setMatrixAt(k, d.matrix); });
        im.castShadow = true; im.receiveShadow = true;
        entry.group.add(im);
      } else {
        for (const it of list) {
          const m = proto.clone(true);
          m.position.set(it.x, groundH(it.x, it.z) - 0.04, it.z);
          m.rotation.y = it.ry;
          m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          entry.group.add(m);
        }
      }
    });
  }
}
function evictSettlement(i) {
  const entry = SETTLE_MESHES.get(i);
  if (!entry) return;
  SETTLE_MESHES.delete(i);
  scene.remove(entry.group);
  entry.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  for (const c of entry.colliders) { const k = colliders.indexOf(c); if (k >= 0) colliders.splice(k, 1); }
}
function tickSettlements() {
  for (const s of settlements()) {
    const d = Math.hypot(px - s.x, pz - s.z);
    if (d < 370 && !SETTLE_MESHES.has(s.i)) ensureSettlement(s);
    else if (d > 430 && SETTLE_MESHES.has(s.i)) evictSettlement(s.i);
  }
}

/* the falls (worldgen Stage 7): a translucent ribbon sheeting
 * down the picked falls face, lip to base, following groundH.
 * built/evicted on the settlement hysteresis (370/430). the
 * other landmarks (lake, overlook, ruin) are sites for now —
 * their dressing lands with later stages. */
let fallsMesh = null;
function ensureFalls() {
  if (fallsMesh) return;
  const f = landmarks().find((l) => l.kind === 'falls');
  if (!f) return;
  const SEG = 10, W = 1.3;
  const dx = f.bx - f.x, dz = f.bz - f.z, len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len, nz = dx / len; // strip perpendicular in XZ
  const pos = [], idx = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG, cx = f.x + dx * t, cz = f.z + dz * t;
    const y = groundH(cx, cz) + 0.22;
    pos.push(cx - nx * W, y, cz - nz * W, cx + nx * W, y, cz + nz * W);
    if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  fallsMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  scene.add(fallsMesh);
}
function evictFalls() {
  if (!fallsMesh) return;
  scene.remove(fallsMesh);
  fallsMesh.geometry.dispose();
  fallsMesh.material.dispose();
  fallsMesh = null;
}
function tickLandmarks() {
  const f = landmarks().find((l) => l.kind === 'falls');
  if (!f) return;
  const d = Math.hypot(px - f.x, pz - f.z);
  if (d < 370 && !fallsMesh) ensureFalls();
  else if (d > 430 && fallsMesh) evictFalls();
}

function buildGroundCover() {
  const rnd = mulberry32(777333);
  const BRECTS = [
    [-36, -44, 13.2, 8.2], [0, -50, 16.2, 9.2], [36, -44, 13.2, 8.2],
    [-62, -52, 14.2, 9.2], [58, -54, 14.2, 9.2], [-64, 46, 12.2, 7.7], [62, 48, 12.2, 7.7], [0, -80, 16.2, 8.2],
    [-108, -28, 7.5, 6], [-116, 6, 7.5, 6], [-104, 40, 7.5, 6],
  ];
  const DOORS = [[-28.6, -35], [43.4, -35], [-62, -42.8], [58, -44.8], [62, 40.3], [-64, 38.3], [0, -72.6]];
  function grassOK(x, z) {
    if (Math.hypot(x, z) < 39.5) return false;
    if (Math.abs(x) < 49 && z < -30 && z > -46.5) return false;
    if (Math.abs(x) < 9.4 && z > 37 && z < 95) return false;
    if (Math.abs(z) < 9.4 && Math.abs(x) > 35 && Math.abs(x) < 157) return false;
    if (Math.hypot(x - 118, z - 12) < 15.5) return false;
    for (const [cx, cz, hw, hd] of BRECTS) if (Math.abs(x - cx) < hw && Math.abs(z - cz) < hd) return false;
    for (const [dx, dz] of DOORS) if (Math.hypot(x - dx, z - dz) < 2.3) return false;
    if (Math.hypot(x, z - 18) < 1.6) return false;
    return true;
  }
  const buckets = new Map();
  const bucketFor = (x, z, wispy) => {
    const key = (wispy ? 'w' : 'c') + Math.floor(x / 44) + ':' + Math.floor(z / 44);
    if (!buckets.has(key)) buckets.set(key, { list: [], wispy, cx: 0, cz: 0 });
    return buckets.get(key);
  };
  const drop = (x, z, s) => {
    const wispy = Math.abs(x) > 126 || Math.abs(z) > 98;
    const b = bucketFor(x, z, wispy);
    b.list.push([x, z, s, rnd() * TAU]);
    b.cx += x; b.cz += z;
  };
  let placed = 0, guard = 0;
  while (placed < 5200 && guard++ < 60000) {
    const x = -130 + rnd() * 260, z = -102 + rnd() * 204;
    if (!grassOK(x, z)) continue;
    drop(x, z, 0.62 + rnd() * 0.45);
    placed++;
  }
  // road-edge tufts: along both avenues, just off the sidewalks
  for (let z = 42; z < 93; z += 3.05) for (const sx of [-1, 1]) {
    const x = sx * (8.9 + rnd() * 0.7), zz = z + (rnd() - 0.5) * 1.4;
    if (grassOK(x, zz)) drop(x, zz, 0.6 + rnd() * 0.4);
  }
  for (let ax = 40; ax < 152; ax += 3.05) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * ax + (rnd() - 0.5) * 1.4, z = sz * (8.9 + rnd() * 0.7);
    if (grassOK(x, z)) drop(x, z, 0.6 + rnd() * 0.4);
  }
  // hillside + fringe bands (wispy)
  let hp = 0; guard = 0;
  while (hp < 750 && guard++ < 9000) {
    const bandPick = rnd();
    let x, z;
    if (bandPick < 0.3) { x = -135 + rnd() * 270; z = -116 + rnd() * 15; }
    else if (bandPick < 0.6) { x = -135 + rnd() * 270; z = 101 + rnd() * 15; }
    else if (bandPick < 0.8) { x = -146 + rnd() * 14; z = -110 + rnd() * 220; }
    else { x = 132 + rnd() * 14; z = -110 + rnd() * 220; }
    if (!grassOK(x, z)) continue;
    drop(x, z, 0.7 + rnd() * 0.5);
    hp++;
  }
  for (const b of buckets.values()) {
    const n = Math.max(1, b.list.length);
    natInstChunked(b.wispy ? 'Grass_Wispy_Short' : 'Grass_Common_Short', b.list, b.cx / n, b.cz / n);
    COVER.lawn += b.list.length;
  }
  COVER.chunks = GRASS_CHUNKS.length;
  // flower patches at doors + plaza ring (composed clusters, unchunked)
  const fl3 = [], fl4 = [];
  const patch = (cx, cz, list) => { const n = 3 + (rnd() * 3 | 0); for (let i = 0; i < n; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * 2.2; list.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.85 + rnd() * 0.4, rnd() * TAU]); } };
  DOORS.forEach(([dx, dz], i) => patch(dx + (i % 2 ? 3.4 : -3.4), dz + 1.6, i % 2 ? fl4 : fl3));
  for (let i = 0; i < 7; i++) { const a = rnd() * TAU; patch(Math.cos(a) * 43.5, Math.sin(a) * 43.5, i % 2 ? fl3 : fl4); }
  natInst('Flower_3_Group', fl3, null);
  natInst('Flower_4_Group', fl4, null);
  // perimeter landscaping: flowering bushes at building corners, plants at doors
  const BUSHES = [[-47, -36.5], [-25, -36.5], [-14, -41], [14, -41], [25, -36.5], [47, -36.5], [-74, -43], [-50, -43], [46, -45], [70, -45], [-74, 39], [-54, 39], [52, 41], [72, 41], [-13, -72], [13, -72], [-101, -22], [-110, 12], [-98, 34]];
  for (const [x, z] of BUSHES) natPlace('Bush_Common_Flowers', x, z, 1.1 + rnd() * 0.35, rnd() * TAU, 0);
  DOORS.forEach(([dx, dz], i) => natPlace('Plant_1_Big', dx + (i % 2 ? 2.1 : -2.1), dz + 0.4, 1.0 + rnd() * 0.3, rnd() * TAU, 0));
  buildLodMeshes();
  buildHorizon();
}



/* ================= ECO: zoned vegetation extension =================
 * Deterministic (seed 112358) plantings that complete the zone
 * system buildNature started: a forest-edge gradient, residential
 * garden trees, meadow groves and spawn-park shrubs. Every spot
 * passes slope + terrain-material gates and a minimum-spacing
 * ledger; every plant is an approved library model via natPlace
 * (omit-on-failure, real LOD). Same seed -> same world, on every
 * client, with zero network traffic. */
function buildEcoZones() {
  const rnd = mulberry32(112358);
  const placed = [[118, 12, 17]]; // pond + radius
  const clearOf = (x, z, r) => placed.every((p) => Math.hypot(p[0] - x, p[1] - z) > r + (p[2] || 0));
  const gate = (x, z) => {
    if (Math.abs(x) > 193 || Math.abs(z) > 114) return false;
    const e = 1.3, h = groundH(x, z);
    const gx = (groundH(x + e, z) - groundH(x - e, z)) / (2 * e), gz = (groundH(x, z + e) - groundH(x, z - e)) / (2 * e);
    if (Math.hypot(gx, gz) > 0.55) return false; // too steep
    const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
    const w = terrainWeights(x, z, ny, h);
    return w[0] + w[1] > 0.5 && w[4] < 0.2 && w[3] < 0.35; // grass/forest ground, not sand/rock
  };
  const plant = (name, x, z, s, r) => { natPlace(name, x, z, s, rnd() * TAU, r || 0); placed.push([x, z, 0]); NATURE.trees++; };
  // ---- forest edge gradient: smaller trees + bushes stepping
  // down from the west forest into the open (x -131..-114)
  const EDGE_T = ['CommonTree_5', 'CommonTree_1', 'Pine_5', 'Pine_2'];
  let tries = 0, plantedEdge = 0;
  while (plantedEdge < 15 && tries++ < 90) {
    const x = -131 + rnd() * 17, z = -104 + rnd() * 208;
    if (!gate(x, z) || !clearOf(x, z, 4.5)) continue;
    plant(EDGE_T[(rnd() * EDGE_T.length) | 0], x, z, 0.5 + rnd() * 0.3, 0.7);
    plantedEdge++;
  }
  let bushTries = 0, bushes = 0;
  while (bushes < 16 && bushTries++ < 80) {
    const inForest = rnd() < 0.5;
    const x = inForest ? -136 + rnd() * 26 : -128 + rnd() * 14, z = -104 + rnd() * 208;
    if (!gate(x, z) || !clearOf(x, z, 2.2)) continue;
    natPlace(rnd() < 0.5 ? 'Bush_Common' : 'Bush_Common_Flowers', x, z, 0.9 + rnd() * 0.5, rnd() * TAU, 0);
    placed.push([x, z, 0]); bushes++;
  }
  // ---- residential: garden trees in the houses' side/back yards
  // (local offsets rotated by each house's yaw; the front door
  // side stays clear)
  for (const [hx, hz, ry] of [[-108, -28, 0.5], [-116, 6, 0.9], [-104, 40, 0.25]]) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const offs = [[8.6, -3.5], [-8.6, -4.2], [7.8, 5.8]];
    offs.forEach(([lx, lz], i) => {
      const x = hx + lx * cs + lz * sn, z = hz - lx * sn + lz * cs;
      if (!gate(x, z)) return;
      plant(['CommonTree_5', 'SakuraTree', 'CommonTree_1'][(i + (hx % 3 + 3) % 3) % 3], x, z, 0.68 + rnd() * 0.25, 0.7);
    });
    natPlace('Bush_Common_Flowers', hx + 6.4 * cs - 5.4 * sn, hz - 6.4 * sn - 5.4 * cs, 1.0, ry, 0);
  }
  // ---- east meadow groves: three small clusters + lone trees
  const MEADOW_T = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'];
  for (const [cx, cz] of [[150, -58], [128, 64], [176, 84]]) {
    const n = 3 + (rnd() * 2 | 0);
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd() - 0.5) * 13, z = cz + (rnd() - 0.5) * 13;
      if (!gate(x, z) || !clearOf(x, z, 4)) continue;
      plant(MEADOW_T[(rnd() * MEADOW_T.length) | 0], x, z, 0.85 + rnd() * 0.4, 0.8);
    }
  }
  let lone = 0; tries = 0;
  while (lone < 6 && tries++ < 60) {
    const x = 130 + rnd() * 60, z = -100 + rnd() * 205;
    if (!gate(x, z) || !clearOf(x, z, 9)) continue;
    plant(MEADOW_T[(rnd() * MEADOW_T.length) | 0], x, z, 0.95 + rnd() * 0.35, 0.85);
    lone++;
  }
  // ---- spawn park shrubs: layered planting around the plaza rim
  for (let i = 0; i < 8; i++) {
    const a = rnd() * TAU, r = 21 + rnd() * 9;
    const x = Math.cos(a) * r, z = 18 + Math.sin(a) * r;
    if (Math.abs(x) < 10.5 || Math.abs(z - 18) < 10.5) continue; // keep the avenue cross clear
    natPlace(i % 2 ? 'Bush_Common_Flowers' : 'Fern_1', x, z, 0.95 + rnd() * 0.4, rnd() * TAU, 0);
  }
}

/* ============ CP3 TEST GROVE (stage 02 rebuild): curated Quaternius
 * MegaKit models composed on the east meadow to lock the art direction
 * in-engine before large-scale placement. Temporary — CP6 replaces the
 * world's dressing wholesale. Models: world3d/assets/nature/*.glb
 * (CC0, see assets/ASSET_SOURCES.md + CATALOG.md). */
let GROVE = { n: 0 };
function grovePlace(name, x, z, s, ry) {
  loadAsset('/world3d/assets/nature/' + name + '.glb').then((proto) => {
    if (!proto) return;
    const m = proto.clone(true);
    m.position.set(x, groundH(x, z) - 0.04, z);
    m.scale.setScalar(s);
    m.rotation.y = ry || 0;
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(m);
    GROVE.n++;
  });
}
function buildTestGrove() {
  const CX = 34, CZ = 64;
  // trees: 3 broadleaf + 2 pine + the red twisted landmark at center
  grovePlace('CommonTree_1', CX - 6, CZ - 6, 1.15, 0.7);
  grovePlace('CommonTree_3', CX + 6, CZ + 6, 0.95, 2.4);
  grovePlace('CommonTree_5', CX - 2, CZ + 14, 1.05, 4.1);
  grovePlace('Pine_2', CX + 10, CZ - 8, 1.1, 1.3);
  grovePlace('Pine_4', CX - 12, CZ + 10, 0.9, 5.3);
  grovePlace('TwistedTree_2', CX, CZ, 0.62, 0.2);
  // undergrowth + rocks
  grovePlace('Bush_Common', CX - 4, CZ + 4, 1.25, 1.1);
  grovePlace('Bush_Common_Flowers', CX + 4, CZ - 4, 1.25, 2.9);
  grovePlace('Rock_Medium_1', CX - 8, CZ, 1.3, 0.5);
  grovePlace('Rock_Medium_3', CX + 8, CZ + 10, 0.9, 2.2);
  grovePlace('Fern_1', CX - 5.4, CZ - 5.2, 1.2, 0.4);
  grovePlace('Fern_1', CX + 1.8, CZ + 2.6, 1.0, 2.0);
  grovePlace('Flower_3_Group', CX - 3, CZ + 9, 1.3, 0.9);
  grovePlace('Flower_3_Group', CX + 7, CZ + 1, 1.1, 3.4);
  grovePlace('Flower_4_Group', CX + 2, CZ - 9, 1.2, 1.8);
  // colliders for the trees + boulders (visuals are client-side, so are these)
  for (const [x, z, r] of [[CX - 6, CZ - 6, 1.0], [CX + 6, CZ + 6, 0.9], [CX - 2, CZ + 14, 0.9], [CX + 10, CZ - 8, 0.9], [CX - 12, CZ + 10, 0.8], [CX, CZ, 1.1], [CX - 8, CZ, 1.5], [CX + 8, CZ + 10, 1.1]]) {
    addCollider(x, z, r);
  }
  // (grass ring removed at CP6 — buildNature covers this area)
}

function buildEntrances() {
  const postM = new THREE.MeshStandardMaterial({ color: 0x3f3a36, roughness: 0.7, metalness: 0.4 });
  const glowM = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc98a, emissiveIntensity: 2.2 });
  // [doorX, doorZ, outward(+1 = town is +z of the door), accent]
  const doors = [
    [-62, -42.8, 1, 0xa78bfa], [58, -44.8, 1, 0xffb36b], [62, 40.3, -1, 0x4ade80],
    [-64, 38.3, -1, 0xf9a8d4], [0, -72.6, 1, 0xffd257],
  ];
  for (const [dx, dz, out, acc] of doors) {
    const mat1 = new THREE.Mesh(new THREE.CircleGeometry(1.15, 20), new THREE.MeshStandardMaterial({ color: acc, roughness: 0.9 }));
    mat1.rotation.x = -Math.PI / 2; mat1.position.set(dx, 0.035, dz + out * 0.4); mat1.receiveShadow = true; scene.add(mat1);
    // STAGE 04: no procedural step or planters here - the building GLBs
    // carry their own (grounded planters + a real 2-step stair since this
    // stage); the old slab intersected the GLB landing and the chunky
    // planters duplicated the modeled ones.
    for (const sgn of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.5, 6), postM);
      post.position.set(dx + sgn * 1.55, 0.75, dz + out * 0.9); scene.add(post);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 7), glowM);
      orb.position.set(dx + sgn * 1.55, 1.58, dz + out * 0.9); scene.add(orb);
    }
  }
  // STAGE 04: house chimneys placed in each house's LOCAL frame (the
  // houses are rotated) on the back roof slope - base embedded in the
  // slope (7.76 at that offset), cap clear of it. The old world-axis
  // offsets left them buried in the roof; the porch glow dots duplicated
  // the GLB bracket lanterns and floated in the yards, so they are gone.
  for (const [hx, hz, hry] of [[-108, -28, 0.5], [-116, 6, 0.9], [-104, 40, 0.25]]) {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.9), new THREE.MeshStandardMaterial({ color: 0x9a6a52, roughness: 1 }));
    const lx = 2.6, lz = -1.2, cs = Math.cos(hry), sn = Math.sin(hry);
    ch.position.set(hx + lx * cs + lz * sn, 7.5, hz - lx * sn + lz * cs);
    ch.rotation.y = hry; ch.castShadow = true; scene.add(ch);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 1.1), new THREE.MeshStandardMaterial({ color: 0x8a8a92, roughness: 0.9 }));
    cap.position.set(ch.position.x, 8.48, ch.position.z); cap.rotation.y = hry; scene.add(cap);
  }
}

/* ================= stage 11: wildlife =================
 * Butterflies over the flowers, rabbits in the grass, deer at the
 * forest edge and in the meadow. Base wander paths are pure
 * functions of the clock (seeded waypoints, stroller-style), so
 * every client sees the same animal in the same place with ZERO
 * network traffic. Fleeing is a local additive offset that decays
 * back to the true path. Distance-culled past ~95 units.
 * Animal models face +X; yaw to a travel dir is atan2(-dz, dx). */
let WILD = { bfly: [], rabbits: [], deer: [], fox: [] };
function wildWander(wps, period, t) {
  const n = wps.length;
  const ph = ((t % period) / period) * n;
  const i = Math.floor(ph) % n, f = ph - Math.floor(ph);
  const a = wps[i], b = wps[(i + 1) % n];
  if (f > 0.62) return { x: b[0], z: b[1], moving: false, dirx: b[0] - a[0], dirz: b[1] - a[1], dwell: true };
  const u = f / 0.62, s = u * u * (3 - 2 * u);
  return { x: a[0] + (b[0] - a[0]) * s, z: a[1] + (b[1] - a[1]) * s, moving: u > 0.02 && u < 0.98, dirx: b[0] - a[0], dirz: b[1] - a[1], dwell: false };
}
function buildWildlife() {
  // ECO: the primitive placeholder animals (sphere rabbits, cone
  // birds, plane butterflies, sphere-and-cylinder deer) are GONE.
  // Wildlife is rigged, animated, license-verified product models:
  // Quaternius Ultimate Animated Animals (CC0) deer + fox, served
  // from assets/animals/. Behavior stays clock-deterministic —
  // every client computes the same animal in the same place with
  // zero network traffic; only the flee offset is local.
  const wrnd = mulberry32(90210);
  const mkAnimal = (kind, url, hx, hz, spread, period) => {
    const g = new THREE.Group(); scene.add(g);
    const entry = { g, kind, wps: [], period, off: new THREE.Vector2(0, 0), mixer: null, acts: {}, cur: '', yawOff: -Math.PI / 2 }; // Quaternius animals face -Z in model space (bind-pose eye centroid + armature -90deg X); the stage-11 yaw convention assumed +X, hence the -90deg offset
    for (let k = 0; k < 4; k++) entry.wps.push([hx + (wrnd() - 0.5) * spread, hz + (wrnd() - 0.5) * spread]);
    loadGltf(url, 30).then((gltf) => {
      if (!gltf || disposed || !gltf.animations || !gltf.animations.length) return;
      const model = skelClone(gltf.scene);
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.add(model);
      const mixer = new THREE.AnimationMixer(model);
      const acts = {};
      for (const clip of gltf.animations) {
        const nm = clip.name.split('|').pop();
        if (!acts[nm]) { const a = mixer.clipAction(clip); a.setLoop(THREE.LoopRepeat); acts[nm] = a; }
      }
      entry.mixer = mixer; entry.acts = acts; entry.model = model;
      if (acts.Idle) { acts.Idle.play(); entry.cur = 'Idle'; }
    });
    return entry;
  };
  // deer herds at the three clearings / meadow homes (pairs)
  const deerHomes = [[-152, -12], [166, -32], [-160, 72]];
  deerHomes.forEach(([hx, hz]) => {
    for (let j = 0; j < 2; j++) WILD.deer.push(mkAnimal('deer', '/world3d/assets/animals/deer.glb', hx + j * 3.5, hz + j * 2.5, 22, 38 + wrnd() * 12));
  });
  // foxes: solitary, deep quiet forest
  [[-168, -58], [-146, 30]].forEach(([hx, hz]) => {
    WILD.fox.push(mkAnimal('fox', '/world3d/assets/animals/fox.glb', hx, hz, 26, 44 + wrnd() * 10));
  });
}
function tickWildlife(now, dt) {
  const t = now / 1000;
  const inTown = zoneNow() === 'town';
  const herd = (a, fleeR, fleeSp) => {
    const w = wildWander(a.wps, a.period, t + a.period * 0.37);
    let fx = w.x + a.off.x, fz = w.z + a.off.y;
    const dxp = fx - px, dzp = fz - pz, dp = Math.hypot(dxp, dzp);
    const fleeing = inTown && dp < fleeR && dp > 0.01;
    if (fleeing) {
      a.off.x += (dxp / dp) * fleeSp * dt; a.off.y += (dzp / dp) * fleeSp * dt;
      const l = Math.hypot(a.off.x, a.off.y); if (l > 8) { a.off.x *= 8 / l; a.off.y *= 8 / l; }
    } else {
      a.off.multiplyScalar(Math.max(0, 1 - dt * 0.35));
    }
    fx = w.x + a.off.x; fz = w.z + a.off.y;
    const far = Math.hypot(fx - px, fz - pz) > 95;
    a.g.visible = inTown && !far;
    if (!a.g.visible) return null;
    return { w, fx, fz, fleeing };
  };
  const runAnimal = (a, fleeR, fleeSp) => {
    const s = herd(a, fleeR, fleeSp); if (!s) return;
    a.g.position.set(s.fx, groundH(s.fx, s.fz), s.fz);
    if (s.w.moving || s.fleeing) a.g.rotation.y = Math.atan2(-s.w.dirz, s.w.dirx) + a.yawOff;
    if (!a.mixer) return;
    // behavior state -> animation clip: flee gallops, travel
    // walks, dwell cycles graze / look-around / idle by a slow
    // seeded phase so animals do not repeat in lockstep.
    let want = 'Idle';
    if (s.fleeing) want = a.acts.Gallop ? 'Gallop' : 'Walk';
    else if (s.w.moving) want = 'Walk';
    else if (s.w.dwell) {
      const ph = Math.sin(t * 0.45 + a.period * 1.7);
      want = ph > 0.35 ? 'Eating' : ph < -0.45 ? (a.acts.Idle_Headlow ? 'Idle_Headlow' : 'Idle_2_HeadLow') : 'Idle_2';
    }
    if (!a.acts[want]) want = 'Idle';
    if (want !== a.cur && a.acts[want]) {
      a.acts[want].reset().fadeIn(0.3).play();
      if (a.acts[a.cur]) a.acts[a.cur].fadeOut(0.3);
      a.cur = want;
    }
    a.mixer.update(dt);
  };
  for (const d of WILD.deer) runAnimal(d, 9.5, 5.5);
  for (const f of WILD.fox) runAnimal(f, 8, 6.5);
}

/* ================= stage 10: the west forest =================
 * Modeled trees (five families) clustered on the west hills, a
 * winding dirt path from the town edge to a stone-ring clearing,
 * an entrance signpost, and a sunset-overlook bench in the east
 * meadow. Tree placement is seeded (same on every client); each
 * tree is a shared-geometry clone sitting on groundH. */
let FOREST = { trees: 0 };
function buildForest() {
  const frnd = mulberry32(424242);
  // CP6: forest trees moved to buildNature() (curated MegaKit library).
  const pathPts = [[-127, 32], [-140, 24], [-150, 8], [-158, -6], [-167, -19], [-174, -30], [-179, -37]];
  // ---- winding dirt path (ribbon over the terrain) ----
  const curve = new THREE.CatmullRomCurve3(pathPts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const N = 60, posArr = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = curve.getPoint(i / N), t = curve.getTangent(i / N);
    const nx = -t.z, nz = t.x, w = 1.35;
    posArr.push(p.x + nx * w, groundH(p.x + nx * w, p.z + nz * w) + 0.07, p.z + nz * w,
                p.x - nx * w, groundH(p.x - nx * w, p.z - nz * w) + 0.07, p.z - nz * w);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
  pg.setIndex(idx); pg.computeVertexNormals();
  const path = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 1 }));
  path.receiveShadow = true; scene.add(path);
  // ---- the clearing: stone ring, fallen log, stumps ----
  const cx = -179, cz = -38, cy = groundH(cx, cz);
  const stoneM = new THREE.MeshStandardMaterial({ color: 0x8d8272, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU, sx = cx + Math.cos(a) * 4.4, sz = cz + Math.sin(a) * 4.4;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), stoneM);
    st.position.set(sx, groundH(sx, sz) + 0.2, sz); st.rotation.set(frnd() * 3, frnd() * 3, 0);
    st.castShadow = true; scene.add(st);
  }
  const barkM = new THREE.MeshStandardMaterial({ color: 0x5f4630, roughness: 1 });
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 3.6, 8), barkM);
  log.rotation.z = Math.PI / 2; log.rotation.y = 0.5;
  log.position.set(cx + 1.2, cy + 0.36, cz + 1.6); log.castShadow = true; scene.add(log);
  addCollider(cx + 1.2, cz + 1.6, 1.1);
  for (const [sx, sz] of [[cx - 2.6, cz - 1.2], [cx + 0.4, cz + 3.4]]) {
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.55, 8), barkM);
    stump.position.set(sx, groundH(sx, sz) + 0.27, sz); stump.castShadow = true; scene.add(stump);
    addCollider(sx, sz, 0.55);
  }
  // ---- signposts + the overlook bench ----
  const signpost = (x, z, text, ry) => {
    const g = new THREE.Group(); g.position.set(x, groundH(x, z), z); g.rotation.y = ry; scene.add(g);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.14), barkM); post.position.y = 1.15; g.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.62, 0.08),
      new THREE.MeshStandardMaterial({ map: canvasTex(512, 128, (c, w, h) => {
        c.fillStyle = '#4a3520'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#c9a86a'; c.lineWidth = 6; c.strokeRect(8, 8, w - 16, h - 16);
        c.fillStyle = '#f3e5c3'; c.font = 'bold 52px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(text, w / 2, h / 2 + 2);
      }), roughness: 0.9 }));
    board.position.set(0, 1.95, 0.1); g.add(board);
    addCollider(x, z, 0.4);
  };
  signpost(-129.5, 33.5, 'WHISPERING WOODS', Math.PI / 2 + 0.4);
  signpost(158, -2, 'SUNSET OVERLOOK', -Math.PI / 2);
  { // overlook bench (modeled), facing the town
    const bg = new THREE.Group(); bg.position.set(166, groundH(166, 6), 6); bg.rotation.y = -Math.PI / 2; scene.add(bg);
    const fb = new THREE.Group(); bg.add(fb);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.85), new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 }));
    seat.position.y = 0.62; fb.add(seat);
    const holder = new THREE.Group(); bg.add(holder);
    swapModel('/world3d/assets/environment/bench.glb', holder, fb);
    const st = { x: 166, z: 6, ry: -Math.PI / 2, zone: 'town' };
    SEATS.push(st);
    addInteract('town', 166, 6, 1.9, () => (seatTaken(st) ? 'seat taken' : 'sit on the bench'), () => sitDown(st));
  }
}

/* ================= stage 09: vegetation =================
 * Instanced grass tufts, meadow flowers, pebbles and forest
 * mushrooms, scattered by a seeded rng (identical on every client),
 * kept off streets, buildings, the pond and entrances. Everything
 * sits on groundH so the wild bands dress their own hills. One
 * InstancedMesh per family = a handful of draw calls total. */
let VEG = { grass: 0, flowers: 0, pebbles: 0, mushrooms: 0 };
function buildVegetation() {
  const vrnd = mulberry32(777001);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const scatterInto = (arr, n, x0, x1, z0, z1, reject) => {
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 40) {
      const x = x0 + vrnd() * (x1 - x0), z = z0 + vrnd() * (z1 - z0);
      if (reject && reject(x, z)) continue;
      arr.push([x, z]); placed++;
    }
  };
  const inPond = (x, z) => Math.hypot(x - 118, z - 12) < 16;
  const inHouse = (x, z) => [[-108, -28], [-116, 6], [-104, 40]].some((h) => Math.hypot(x - h[0], z - h[1]) < 11);
  // ---- grass tufts ----
  const gspots = [];
  scatterInto(gspots, 950, 130, 194, -100, 110, null);                 // east meadow
  scatterInto(gspots, 520, -194, -133, -105, 114, null);               // west forest floor
  scatterInto(gspots, 260, 92, 136, -32, 62, inPond);                  // park
  scatterInto(gspots, 220, -130, -94, -62, 62, inHouse);               // residential yards
  const tuft = new THREE.ConeGeometry(0.17, 0.6, 5); tuft.translate(0, 0.3, 0);
  const grass = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), gspots.length);
  gspots.forEach((sp, i) => {
    dummy.position.set(sp[0], groundH(sp[0], sp[1]) - 0.03, sp[1]);
    dummy.rotation.set((vrnd() - 0.5) * 0.22, vrnd() * TAU, (vrnd() - 0.5) * 0.22);
    dummy.scale.set(0.8 + vrnd() * 0.5, 0.7 + vrnd() * 0.9, 0.8 + vrnd() * 0.5);
    dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix);
    if (sp[0] < -133) col.setHSL(0.29 + vrnd() * 0.03, 0.32, 0.26 + vrnd() * 0.07);
    else col.setHSL(0.24 + vrnd() * 0.05, 0.42, 0.32 + vrnd() * 0.10);
    grass.setColorAt(i, col);
  });
  grass.instanceMatrix.needsUpdate = true; if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  scene.add(grass);
  // ---- meadow + park flowers ----
  const fspots = [];
  scatterInto(fspots, 300, 132, 192, -95, 105, null);
  scatterInto(fspots, 120, 94, 134, -28, 58, inPond);
  const fgeo = new THREE.IcosahedronGeometry(0.11, 0); fgeo.translate(0, 0.4, 0);
  const flowers = new THREE.InstancedMesh(fgeo, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), fspots.length);
  const fcols = [0xf9a8d4, 0xffffff, 0xffd257, 0xc4b5fd, 0xfda4af];
  fspots.forEach((sp, i) => {
    dummy.position.set(sp[0], groundH(sp[0], sp[1]), sp[1]);
    dummy.rotation.set(0, vrnd() * TAU, 0);
    dummy.scale.setScalar(0.8 + vrnd() * 0.7);
    dummy.updateMatrix(); flowers.setMatrixAt(i, dummy.matrix);
    col.setHex(fcols[(vrnd() * fcols.length) | 0]); flowers.setColorAt(i, col);
  });
  flowers.instanceMatrix.needsUpdate = true; if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  scene.add(flowers);
  // ---- pebbles ----
  const pspots = [];
  scatterInto(pspots, 70, 132, 192, -95, 105, null);
  scatterInto(pspots, 40, -190, -136, -100, 110, null);
  scatterInto(pspots, 24, 94, 134, -28, 58, inPond);
  const pgeo = new THREE.DodecahedronGeometry(0.15, 0);
  const pebbles = new THREE.InstancedMesh(pgeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), pspots.length);
  pspots.forEach((sp, i) => {
    dummy.position.set(sp[0], groundH(sp[0], sp[1]) + 0.04, sp[1]);
    dummy.rotation.set(vrnd() * 3, vrnd() * 3, vrnd() * 3);
    dummy.scale.set(0.6 + vrnd() * 1.1, 0.4 + vrnd() * 0.5, 0.6 + vrnd() * 1.1);
    dummy.updateMatrix(); pebbles.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.08, 0.06 + vrnd() * 0.05, 0.42 + vrnd() * 0.18); pebbles.setColorAt(i, col);
  });
  pebbles.instanceMatrix.needsUpdate = true; if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
  scene.add(pebbles);
  // ---- forest mushrooms (stem + cap instanced pair) ----
  const mspots = [];
  scatterInto(mspots, 36, -190, -140, -100, 110, null);
  const stemG = new THREE.CylinderGeometry(0.05, 0.075, 0.24, 6); stemG.translate(0, 0.12, 0);
  const capG = new THREE.ConeGeometry(0.17, 0.15, 7); capG.translate(0, 0.3, 0);
  const stems = new THREE.InstancedMesh(stemG, new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.9 }), mspots.length);
  const caps = new THREE.InstancedMesh(capG, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), mspots.length);
  mspots.forEach((sp, i) => {
    dummy.position.set(sp[0], groundH(sp[0], sp[1]), sp[1]);
    dummy.rotation.set((vrnd() - 0.5) * 0.15, vrnd() * TAU, (vrnd() - 0.5) * 0.15);
    dummy.scale.setScalar(0.8 + vrnd() * 0.9);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix); caps.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.03 + vrnd() * 0.03, 0.55, 0.38 + vrnd() * 0.1); caps.setColorAt(i, col);
  });
  stems.instanceMatrix.needsUpdate = true; caps.instanceMatrix.needsUpdate = true;
  if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
  scene.add(stems); scene.add(caps);
  VEG = { grass: gspots.length, flowers: fspots.length, pebbles: pspots.length, mushrooms: mspots.length };
}

/* ---------- STAGE 05: spawn garden ----------
 * the grove's visual language, composed around spawn (0,18): a
 * curated frame of library trees (sightlines to the gazebo, portal
 * and grove kept clear), hedge arcs, four garden beds off the plaza,
 * and a lush tall-grass band just outside the paving. hand-placed
 * and seeded — identical on every client, no scatter randomness. */
let SPAWNG = { trees: 0, beds: 0 };
/* the garden band's own ground mask (buildGroundCover's grassOK is
 * scoped inside that function): no grass on the plaza paving, the
 * avenues, or the pond. */
function spawnGrassOK(x, z) {
  if (Math.hypot(x, z) < 40) return false;
  if (Math.abs(x) < 9.4 && z > 37 && z < 95) return false;
  if (Math.abs(z) < 9.4 && Math.abs(x) > 35 && Math.abs(x) < 157) return false;
  if (Math.hypot(x - 118, z - 12) < 15.5) return false;
  return true;
}
function buildSpawnGarden() {
  const T = (name, x, z, s, ry) => { natPlace(name, x, z, s, ry, 0.85 * s); SPAWNG.trees++; };
  // framing trees: west / east / south of the plaza rim
  T('CommonTree_2', -16, 30, 1.15, 0.7);
  T('CommonTree_4', -40, 14, 1.05, 2.4);
  T('Pine_3', -31, -18, 1.1, 1.2);
  T('CommonTree_1', 17, 28, 1.2, 1.9);
  T('CommonTree_3', 27, 15, 1.0, 0.3);
  T('CommonTree_5', -10, 36, 1.1, 2.9);
  T('Pine_2', 12, 37, 1.15, 0.9);
  T('TwistedTree_3', -21, 42, 0.5, 1.6); // the one autumn accent
  T('CommonTree_2', 24, 33, 0.95, 2.2);  // toward the grove
  T('SakuraTree', -28, 22, 0.85, 1.7); // ECO: textured sakura (was the untextured tree_sakura.glb hero)
  // hedge arcs of flowering bushes flanking the plaza rim
  for (const [x, z] of [[-33, 6], [-33, 12], [-33, 18], [-33, 24], [33, 4], [33, 10], [33, 16]]) {
    natPlace('Bush_Common_Flowers', x, z, 1.25, x * 1.7 + z);
  }
  natPlace('Bush_Common', -15, 28.4, 1.1, 0.5); // dark accents at two tree bases
  natPlace('Bush_Common', 18.5, 26.5, 1.0, 2.1);
  // ferns at the framing trees' feet
  for (const [x, z] of [[-14.8, 28.8], [17.2, 26.6], [-9, 34.8], [25.4, 14], [-29.5, 20.5]]) {
    natPlace('Fern_1', x, z, 0.9, x + z);
  }
  // decorative rocks at two cluster bases
  natPlace('Rock_Medium_2', -15, 31.5, 0.8, 0.8, 0.6);
  natPlace('Rock_Medium_3', 18, 30.5, 0.7, 2.0, 0.55);
  // four garden beds on the grass outside the plaza
  const soilM = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 });
  for (const [bx, bz] of [[-42, -20], [42, -22], [-34, 54], [36, 52]]) {
    const soil = new THREE.Mesh(new THREE.CircleGeometry(2.7, 22), soilM);
    soil.rotation.x = -Math.PI / 2;
    soil.position.set(bx, groundH(bx, bz) + 0.06, bz);
    soil.receiveShadow = true;
    scene.add(soil);
    const ring = [], fl = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      ring.push([bx + Math.cos(a) * 2.75, bz + Math.sin(a) * 2.75, 0.55 + (i % 3) * 0.1, a]);
    }
    const brnd = mulberry32(31000 + bx * 7 + bz);
    for (let i = 0; i < 7; i++) {
      const a = brnd() * TAU, rr = 0.6 + brnd() * 1.7;
      fl.push([bx + Math.cos(a) * rr, bz + Math.sin(a) * rr, 0.75 + brnd() * 0.3, brnd() * TAU]);
    }
    natInst('Pebble_Round_2', ring);
    natInst('Flower_3_Group', fl.filter((_, i) => i % 2 === 0));
    natInst('Flower_4_Group', fl.filter((_, i) => i % 2 === 1));
    natPlace('Plant_1_Big', bx, bz, 0.9, bx);
    natPlace('Fern_1', bx + 1.8, bz + 1.2, 0.85, bz);
    SPAWNG.beds++;
    VEG.flowers += 7;
  }
  // lush tall-grass band just outside the paving (r 36..54), masked
  const rnd = mulberry32(555001);
  const tall = [], wispy = [];
  let tries = 0;
  while (tall.length + wispy.length < 520 && tries < 2600) {
    tries++;
    const a = rnd() * TAU, rr = 36 + rnd() * 18;
    const x = Math.cos(a) * rr, z = 18 + Math.sin(a) * rr * 0.82;
    if (!spawnGrassOK(x, z)) continue;
    (rnd() < 0.6 ? tall : wispy).push([x, z, 0.8 + rnd() * 0.45, rnd() * TAU]);
  }
  natInst('Grass_Common_Tall', tall, null, true);
  natInst('Grass_Wispy_Short', wispy, null, true);
  VEG.grass += tall.length + wispy.length;
  // flower clusters at path edges near spawn
  const fc = [];
  for (const [cx, cz] of [[10, 24], [-11, 25], [14, -6], [-14, -8], [30, 26], [-30, 30]]) {
    for (let i = 0; i < 4; i++) fc.push([cx + (rnd() - 0.5) * 3.4, cz + (rnd() - 0.5) * 3.4, 0.8 + rnd() * 0.3, rnd() * TAU]);
  }
  natInst('Flower_3_Group', fc.filter((_, i) => i % 2 === 0));
  natInst('Flower_4_Group', fc.filter((_, i) => i % 2 === 1));
  VEG.flowers += fc.length;
}


function buildDressing() {
  const woodD = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 });
  const woodL = new THREE.MeshStandardMaterial({ color: 0x9a6b40, roughness: 0.9 });
  const terra = new THREE.MeshStandardMaterial({ color: 0xa35a3c, roughness: 0.9 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x4a3421, roughness: 1 });
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x5f4630, roughness: 1 });
  const bx = (w, h, d, m, x, y, z, ry) => { const q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); q.position.set(x, y, z); if (ry) q.rotation.y = ry; q.castShadow = true; q.receiveShadow = true; scene.add(q); return q; };

  // leafy trees — ECO: the primitive round-tree fallbacks and the
  // untextured tree_round.glb are gone; these spots grow approved
  // library trees (omit-on-failure, real LOD).
  const leafSpots = [[86, -18], [98, 44], [132, -6], [70, 66], [-88, 74], [-132, -8], [44, 96], [-40, 104], [150, 40], [-150, 52]];
  const LEAF_TREES = ['CommonTree_1', 'CommonTree_3', 'CommonTree_5', 'CommonTree_2'];
  leafSpots.forEach(([x, z], i) => {
    natPlace(LEAF_TREES[i % LEAF_TREES.length], x, z, 1.05 + (i % 3) * 0.15, x * 0.7 + z, 0.95);
  });

  // park garden beds: soil + their own instanced flowers
  const beds = [[104, 26, 0.3], [128, 30, -0.4], [112, -12, 0.9]];
  const bedFlowers = [];
  for (const [x, z, ry] of beds) {
    bx(7, 0.28, 2.4, soil, x, 0.14, z, ry);
    bx(7.3, 0.2, 2.7, terra, x, 0.07, z, ry);
    for (let i = 0; i < 30; i++) bedFlowers.push([x + (Math.random() - 0.5) * 6.2, z + (Math.random() - 0.5) * 1.7]);
  }
  const bfIM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), bedFlowers.length);
  const dummy = new THREE.Object3D(); const bCols = [new THREE.Color(0xf9a8d4), new THREE.Color(0xffd257), new THREE.Color(0xffffff), new THREE.Color(0xf28b82)];
  bedFlowers.forEach((f, i) => { dummy.position.set(f[0], 0.42, f[1]); dummy.updateMatrix(); bfIM.setMatrixAt(i, dummy.matrix); bfIM.setColorAt(i, bCols[i % 4]); });
  scene.add(bfIM);

  // bus stop on south avenue: pole sign, shelter, bench
  {
    const g = new THREE.Group(); g.position.set(18, 0, 88); scene.add(g);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), trunkM); pole.position.y = 1.3; g.add(pole);
    const sTex = canvasTex(128, 128, (gg) => { gg.fillStyle = '#2e5a8a'; gg.fillRect(0, 0, 128, 128); gg.fillStyle = '#fff'; gg.font = '800 44px system-ui'; gg.textAlign = 'center'; gg.fillText('BUS', 64, 55); gg.fillText('STOP', 64, 100); });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.06), new THREE.MeshBasicMaterial({ map: sTex })); sign.position.y = 2.5; g.add(sign);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 1.8), terra); roof.position.set(2.6, 2.3, 0); roof.castShadow = true; g.add(roof);
    for (const dx of [0.7, 4.5]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 6), trunkM); post.position.set(dx, 1.15, -0.7); g.add(post); }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.6), woodL); bench.position.set(2.6, 0.62, -0.55); g.add(bench);
    for (const lx of [1.2, 4.0]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.5), woodD); leg.position.set(lx, 0.31, -0.55); g.add(leg); }
    addCollider(18 + 2.6, 88 - 0.55, 1.2);
  }

  // mailboxes at the three houses + the apartments door
  for (const [x, z] of [[-99, -24], [-107, 10], [-95, 44], [-56, 36]]) {
    const mg = new THREE.Group(); mg.position.set(x, 0, z); scene.add(mg);
    const fb = new THREE.Group(); mg.add(fb);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 0.12), woodD); post.position.y = 0.52; fb.add(post);
    const mbox = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x38618c, roughness: 0.6, metalness: 0.3 })); mbox.position.y = 1.3; fb.add(mbox);
    const mflag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.06), new THREE.MeshBasicMaterial({ color: 0xd64541 })); mflag.position.set(0.44, 1.52, 0); fb.add(mflag);
    const holder = new THREE.Group(); mg.add(holder);
    swapModel('/world3d/assets/environment/mailbox.glb', holder, fb);
    addCollider(x, z, 0.45);
  }

  // sittable benches: two by the pond, two along fountain avenue
  const benchSeat = (x, z, ry) => {
    const bg = new THREE.Group(); bg.position.set(x, 0, z); bg.rotation.y = ry; scene.add(bg);
    const fb = new THREE.Group(); bg.add(fb);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.85), woodL); seat.position.y = 0.62; seat.castShadow = true; fb.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.75, 0.13), woodL); back.position.set(0, 1.08, -0.4); back.rotation.x = -0.16; fb.add(back);
    for (const dx of [-1.1, 1.1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 0.7), woodD); leg.position.set(dx, 0.31, 0); fb.add(leg); }
    const holder = new THREE.Group(); bg.add(holder);
    swapModel('/world3d/assets/environment/bench.glb', holder, fb);
    const st = { x, z, ry, zone: 'town' };
    SEATS.push(st);
    addInteract('town', x, z, 1.8, () => (seatTaken(st) ? 'seat taken' : 'sit on the bench'), () => sitDown(st));
  };
  benchSeat(104, 20, 2.6); benchSeat(126, 2, -1.2); benchSeat(-14, 30, 0); benchSeat(16, -30, Math.PI);

  // park entrance sign
  {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.7, 0.14), woodD); post.position.set(96, 0.85, 34); scene.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.1), woodL); board.position.set(96, 1.6, 34); board.rotation.y = 0.5; scene.add(board);
    const t = signTexture('SAKURA PARK', '#ffd9a0');
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.62), new THREE.MeshBasicMaterial({ map: t, transparent: true })); face.position.set(96 + Math.sin(0.5) * 0.06, 1.6, 34 + Math.cos(0.5) * 0.06); face.rotation.y = 0.5; scene.add(face);
    addCollider(96, 34, 0.5);
  }

  // ECO: the cone-and-plane placeholder birds are removed — no
  // primitive animals. (Petals below are particles, not animals.)
  // drifting petals / pollen over the plaza + park
  const pN = 150, pPos = new Float32Array(pN * 3); petalDat = [];
  for (let i = 0; i < pN; i++) { pPos[i * 3] = -70 + Math.random() * 200; pPos[i * 3 + 1] = 0.3 + Math.random() * 6.5; pPos[i * 3 + 2] = -60 + Math.random() * 110; petalDat.push({ ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.7 }); }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  petals = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xffd7e8, size: 0.14, transparent: true, opacity: 0.75, depthWrite: false }));
  scene.add(petals);
}
function tickDressing(now) {
  const t = now / 1000;
  if (petals) {
    const arr = petals.geometry.attributes.position.array;
    for (let i = 0; i < petalDat.length; i++) {
      const d = petalDat[i];
      arr[i * 3] += 0.008 * d.sp; arr[i * 3 + 1] += Math.sin(t * 0.9 + d.ph) * 0.0022 - 0.0012; arr[i * 3 + 2] += Math.cos(t * 0.6 + d.ph) * 0.003;
      if (arr[i * 3] > 135) arr[i * 3] = -70;
      if (arr[i * 3 + 1] < 0.2) arr[i * 3 + 1] = 6.5;
    }
    petals.geometry.attributes.position.needsUpdate = true;
  }
}

/* ---------- v545: library + rec center + apartments, town NPCs,
 * star shards, trivia terminal, world map, district toasts ----------
 * shards/trivia/decor are server truth (world3d.js): the client
 * mirrors positions for rendering only; pickups, answers and decor
 * changes are claimed over the API and the server validates them. */
let quizOpen = false, mapOpen = false;
let aptRugMesh = null, aptPosterMesh = null;
const APT_RUGS = [0x5b4a8a, 0x8a3b4e, 0x2e6b5e];
const APT_POSTERS = ['moon', 'sakura', 'crown'];
const SHARD_SPOTS = {
  s1: [6, -6], s2: [105, 20], s3: [0, -92], s4: [-120, 30], s5: [-30, 95], s6: [-52, -30],
  s7: [2008.5, 3], s8: [2033, -7.5], s9: [2073, 6.5], s10: [2113, -6], s11: [2167, 5], s12: [2206, -4],
};
const SHARD_MESHES = {};
function buildShards() {
  for (const id in SHARD_SPOTS) {
    const [x, z] = SHARD_SPOTS[id];
    const m = new THREE.Mesh(sharedGeo.star, new THREE.MeshStandardMaterial({ color: 0xffd257, emissive: 0xffaa00, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.4 }));
    m.scale.setScalar(0.85); m.position.set(x, 1.25, z);
    scene.add(m); SHARD_MESHES[id] = m;
    const zone = id === 's7' ? 'coffee' : id === 's8' ? 'arcade' : id === 's9' ? 'clothing' : id === 's10' ? 'library' : id === 's11' ? 'rec' : id === 's12' ? 'apt' : 'town';
    addInteract(zone, x, z, 1.8, () => ((myCos.shards || []).includes(id) ? '' : 'take the star shard'), () => claimShard(id));
  }
  syncShards();
}
function syncShards() {
  const haveShards = myCos.shards || [];
  for (const id in SHARD_MESHES) SHARD_MESHES[id].visible = !haveShards.includes(id);
}
async function claimShard(id) {
  try {
    const r = await (await fetch('/api/world3d/shard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })).json();
    if (r.ok) {
      if (!myCos.shards.includes(id)) myCos.shards.push(id);
      syncShards();
      if (typeof r.bal === 'number') R.bal.textContent = '¢ ' + r.bal + ' six cents';
      toast('✦ star shard ' + r.shards + '/12 — +5¢');
      ping(true);
    } else toast(r.err || 'shard slipped away');
  } catch (e) { toast('network hiccup — try again'); }
}
function tickShards(now) {
  for (const id in SHARD_MESHES) {
    const m = SHARD_MESHES[id];
    if (!m.visible) continue;
    m.rotation.y = now / 700;
    m.position.y = 1.25 + Math.sin(now / 600 + id.charCodeAt(1)) * 0.14;
  }
}

/* ----- the library (world x 2109..2131) ----- */
const LORE = [
  ['the moonfall chronicles', '“…and when the lake turned violet, the town agreed to never ask why. some doors are happier closed.”'],
  ['a goblin’s guide to taverns', '“rule one: the well grants wishes, not refunds. rule two: tip ur barista — she remembers everything.”'],
  ['field notes: sakura park', '“the pink trees hum at night. i have stopped writing down the tune. it writes itself into my dreams anyway.”'],
  ['the lich correspondence', '“dear librarian, i return this book 400 years late. the fine, i trust, is forgiven. it is not. — n.”'],
  ['star shard almanac', '“twelve shards fell the night the moon cracked. find them all and the sky owes u a favor.”'],
  ['six: an unauthorized biography', '“chapter one: nobody knows where six came from. chapter two: six knows where u live. (it is a joke. mostly.)”'],
];
function buildLibrary() {
  const CX = 2120;
  const spineTex = canvasTex(256, 64, (g, w, h) => {
    const cols = ['#7c3a4a', '#3a5a7c', '#5a7c3a', '#7c6a3a', '#5a3a7c', '#3a7c6a'];
    const r2 = mulberry32(77);
    let x = 0;
    while (x < w) { const bw = 5 + r2() * 8; g.fillStyle = cols[(r2() * 6) | 0]; g.fillRect(x, 3, bw - 1, h - 6); g.fillStyle = 'rgba(255,217,160,.5)'; g.fillRect(x, 8, bw - 1, 2); x += bw; }
  }, 6, 1);
  const { M, box } = roomShell(CX, { floor: 0x4a3826, wall: 0x4a3626 });
  const glow = new THREE.PointLight(0xffd9a0, 430, 18, 2); glow.position.set(CX, 3.2, 0); scene.add(glow);
  interiorLights.push({ light: glow, zone: 'library' });
  const shelfM = M(0xffffff, { map: spineTex, roughness: 0.9 });
  for (const sx of [CX - 7.5, CX - 2.5, CX + 2.5, CX + 7.5]) {
    box(4.4, 2.9, 0.55, M(0x3d2417), sx, 1.45, -8.6);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), shelfM);
    face.position.set(sx, 1.5, -8.3); scene.add(face);
    boxColliders.push({ minX: sx - 2.2, maxX: sx + 2.2, minZ: -9, maxZ: -8.2 });
  }
  for (const sz of [-4, 0.5]) {
    box(0.55, 2.9, 4.4, M(0x3d2417), CX - 10.7, 1.45, sz);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), shelfM);
    face.position.set(CX - 10.4, 1.5, sz); face.rotation.y = Math.PI / 2; scene.add(face);
    boxColliders.push({ minX: CX - 11, maxX: CX - 10.2, minZ: sz - 2.2, maxZ: sz + 2.2 });
  }
  LORE.forEach((book, i) => {
    const bx = CX - 7.5 + (i % 4) * 5, bz = -7.2;
    addInteract('library', bx, bz, 1.9, 'read “' + book[0] + '”', () => openDlg('📖 ' + book[0], [book[1]]));
  });
  for (const [tx, tz] of [[CX - 3, 2.5], [CX + 3.5, 2.5]]) {
    box(3.4, 0.12, 1.6, M(0x6b4226), tx, 0.78, tz);
    for (const [lx, lz] of [[-1.5, -0.65], [1.5, -0.65], [-1.5, 0.65], [1.5, 0.65]]) box(0.12, 0.78, 0.12, M(0x3d2417), tx + lx, 0.39, tz + lz);
    boxColliders.push({ minX: tx - 1.8, maxX: tx + 1.8, minZ: tz - 0.9, maxZ: tz + 0.9 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), M(0xffd9a0, { emissive: 0xffb36b, emissiveIntensity: 2.2 }));
    lamp.position.set(tx, 1.15, tz); scene.add(lamp);
    addInteract('library', tx - 1, tz + 1.5, 1.7, 'sit + read', () => sitDown({ x: tx - 1, z: tz + 1.15, ry: Math.PI }));
    addInteract('library', tx + 1, tz + 1.5, 1.7, 'sit + read', () => sitDown({ x: tx + 1, z: tz + 1.15, ry: Math.PI }));
  }
  const noor = makeAvatar(40, 'noor');
  noor.position.set(CX + 8.6, 0, -6.8); noor.rotation.y = -0.5;
  scene.add(noor);
  const noorEntry = { zone: 'library', routine: { a: [2114, -5], b: [2120, 1.2], dwell: 7, off: 2, faceA: -1.2, faceB: 0.6 }, g: noor, st: { phase: 0.7, speed: 0, grounded: true, landT: 0, pose: 'stand' } };
  NPCS.push(noorEntry);
  attachRig(noorEntry, 40);
  addInteract('library', CX + 8.6, -5.6, 2.2, 'talk to noor', () => openDlg('@noor — librarian', [
    'shh. …okay we do not actually shush here. welcome in.',
    'every book on those shelves was written by somebody in this town. allegedly.',
    'the shard almanac is real, by the way. twelve shards. i counted the empty slots.',
  ]));
  addInteract('library', CX, 7.2, 2.5, 'leave the library', () => { standUp(); fadeThrough(() => warpTo(58, -44.8, 0)); });
}

/* ----- the rec center (world x 2149..2171) ----- */
let padOn = true; // the ambient pad starts with the first ensureAudio
function togglePad() {
  // the jukebox drives the world's real ambient pad (see ensureAudio):
  // suspending/resuming the context is an honest on/off for it.
  if (!SET.snd) { toast('sound is off — flip it on in settings (esc) first'); return padOn; }
  ensureAudio(); if (!AC) return padOn;
  try {
    if (padOn) { AC.suspend(); padOn = false; } else { AC.resume(); padOn = true; }
  } catch (e) { }
  return padOn;
}
function buildRec() {
  const CX = 2160;
  const { M, box } = roomShell(CX, { floor: 0x5a4a3a, wall: 0x39503c });
  const glow = new THREE.PointLight(0xb8ffd9, 400, 18, 2); glow.position.set(CX, 3.2, 0); scene.add(glow);
  interiorLights.push({ light: glow, zone: 'rec' });
  // dance floor: emissive tile grid (v546 hooks the celebrate emote here)
  const tileCols = [0xa78bfa, 0xf472b6, 0x67e8f9, 0xffd257];
  for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 3; iz++) {
    const c = tileCols[(ix + iz) % 4];
    const t = box(1.15, 0.06, 1.15, M(c, { emissive: c, emissiveIntensity: 0.55 }), CX - 2.4 + ix * 1.6, 0.03, -1.5 + iz * 1.6);
    t.castShadow = false;
  }
  // pool table (visual) + lounge sofas with seats
  // STAGE 04: the body now reaches the floor (it floated 0.13) and meets
  // the rail slab above it.
  box(3.2, 0.88, 1.8, M(0x1e6b4a, { roughness: 0.7 }), CX + 6.5, 0.44, -5.5);
  box(3.5, 0.18, 2.1, M(0x3d2417), CX + 6.5, 0.95, -5.5);
  boxColliders.push({ minX: CX + 4.7, maxX: CX + 8.3, minZ: -6.5, maxZ: -4.5 });
  for (const [sx, sz, ry] of [[CX - 7.5, 3.5, 0.6], [CX - 6, 5.8, 0.2]]) {
    // STAGE 04: plinth base + backrest - the seat block floated 0.15 with
    // nothing under or behind it.
    const sofaM2 = M(0x37503f, { roughness: 0.95 });
    const plinth = box(2.9, 0.15, 1.05, M(0x2a3d2f, { roughness: 1 }), sx, 0.075, sz, ry);
    plinth.castShadow = true;
    const sofa = box(2.9, 0.55, 1.05, sofaM2, sx, 0.42, sz, ry);
    sofa.castShadow = true;
    const back = box(2.9, 0.6, 0.22, sofaM2, sx + 0.415 * Math.sin(ry), 0.72, sz + 0.415 * Math.cos(ry), ry);
    back.castShadow = true;
    addInteract('rec', sx, sz + 0.4, 1.7, 'sit', () => sitDown({ x: sx, z: sz, ry: Math.PI + ry }));
  }
  // jukebox: toggles the ambient pad (real webaudio, generated live)
  const jb = box(1.1, 1.7, 0.6, M(0x8a2b3a, { roughness: 0.5, emissive: 0x8a2b3a, emissiveIntensity: 0.35 }), CX - 9.5, 0.85, -6.5);
  jb.castShadow = true; addCollider(CX - 9.5, -6.5, 0.85);
  addInteract('rec', CX - 9.5, -5.2, 2.0, () => (padOn ? 'jukebox: stop the pad' : 'jukebox: play the pad'), () => { toast(togglePad() ? '♪ pad on — the town hums again' : 'jukebox off — pad paused'); });
  // trivia terminal
  const term = box(0.9, 1.5, 0.5, M(0x14202c, { roughness: 0.4, emissive: 0x67e8f9, emissiveIntensity: 0.25 }), CX + 9.6, 0.75, 2.5);
  term.castShadow = true; addCollider(CX + 9.6, 2.5, 0.8);
  addInteract('rec', CX + 9.6, 3.9, 2.0, 'trivia terminal — 10¢ a right answer', openQuiz);
  const junie = makeAvatar(120, 'junie');
  junie.position.set(CX - 2, 0, -4.6); junie.rotation.y = 0.9;
  scene.add(junie);
  const junieEntry = { zone: 'rec', routine: { a: [2154, 4], b: [2158, 1], dwell: 5, off: 7, faceA: 2.6, faceB: 0 }, g: junie, st: { phase: 5.2, speed: 0, grounded: true, landT: 0, pose: 'stand' } };
  NPCS.push(junieEntry);
  attachRig(junieEntry, 120);
  addInteract('rec', CX - 2, -3.4, 2.2, 'talk to junie', () => openDlg('@junie — rec center', [
    'dance floor rules: there are none. that is the rule.',
    'the trivia terminal pays 10 cents a right answer, three a day. it has never once been wrong. it has been wrong.',
    'jukebox runs on vibes and one very tired oscillator.',
  ]));
  addInteract('rec', CX, 7.2, 2.5, 'leave the rec center', () => { standUp(); fadeThrough(() => warpTo(62, 40.3, 0)); });
}

/* ----- trivia quiz panel ----- */
let quizQid = null;
async function openQuiz() {
  noteOpener();
  quizOpen = true; R.quiz.hidden = false; R.quizres.textContent = 'loading a question…'; R.quizq.textContent = ''; R.quizchoices.innerHTML = '';
  clearInput(); setPrompt(null); focusFirst(R.quiz);
  try {
    const r = await (await fetch('/api/world3d/trivia', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'get' }) })).json();
    if (!r.ok) { R.quizres.textContent = r.err || 'terminal is down'; return; }
    quizQid = r.qid; R.quizq.textContent = r.q; R.quizres.textContent = '';
    r.choices.forEach((ch, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'w3qchoice'; b.textContent = ch;
      b.addEventListener('click', () => answerQuiz(i));
      R.quizchoices.appendChild(b);
    });
  } catch (e) { R.quizres.textContent = 'network hiccup — close + retry'; }
}
async function answerQuiz(i) {
  try {
    const r = await (await fetch('/api/world3d/trivia', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'answer', qid: quizQid, choice: i }) })).json();
    if (!r.ok) { R.quizres.textContent = r.err || 'answer failed'; return; }
    if (r.correct && r.paid) { R.quizres.textContent = '✓ correct — +10¢ (' + r.left + ' paid answers left today)'; if (typeof r.bal === 'number') R.bal.textContent = '¢ ' + r.bal + ' six cents'; }
    else if (r.correct && r.capped) R.quizres.textContent = '✓ correct — but today’s 3 paid answers are done. come back tomorrow';
    else if (r.correct) R.quizres.textContent = '✓ correct';
    else R.quizres.textContent = '✗ nope — no charge, try another';
    setTimeout(() => { if (quizOpen) openQuiz(); }, 1600);
  } catch (e) { R.quizres.textContent = 'network hiccup — try again'; }
}
function closeQuiz() { quizOpen = false; R.quiz.hidden = true; restoreOpener(); }

/* ----- ur apartment (world x 2189..2211) — a solo instance ----- */
function posterTex(kind) {
  return canvasTex(96, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    if (kind === 'moon') { grad.addColorStop(0, '#1b1040'); grad.addColorStop(1, '#3b2a7a'); g.fillStyle = grad; g.fillRect(0, 0, w, h); g.fillStyle = '#f7ecd9'; g.beginPath(); g.arc(w / 2, 44, 20, 0, 7); g.fill(); g.fillStyle = '#1b1040'; g.beginPath(); g.arc(w / 2 + 9, 38, 17, 0, 7); g.fill(); g.fillStyle = '#ffc95e'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillText('MOONFALL', w / 2, 104); }
    else if (kind === 'sakura') { grad.addColorStop(0, '#2c1836'); grad.addColorStop(1, '#59304e'); g.fillStyle = grad; g.fillRect(0, 0, w, h); g.strokeStyle = '#241222'; g.lineWidth = 6; g.beginPath(); g.moveTo(10, 128); g.quadraticCurveTo(40, 70, 84, 30); g.stroke(); g.fillStyle = '#f2a7c3'; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(20 + (i * 37) % 60, 18 + (i * 23) % 60, 5, 0, 7); g.fill(); } g.fillStyle = '#ffe3f1'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillText('SAKURA', w / 2, 112); }
    else { grad.addColorStop(0, '#241335'); grad.addColorStop(1, '#57420a'); g.fillStyle = grad; g.fillRect(0, 0, w, h); g.fillStyle = '#ffc95e'; g.beginPath(); g.moveTo(w / 2, 26); g.lineTo(w / 2 + 20, 62); g.lineTo(w / 2 + 8, 62); g.lineTo(w / 2 + 8, 76); g.lineTo(w / 2 - 8, 76); g.lineTo(w / 2 - 8, 62); g.lineTo(w / 2 - 20, 62); g.closePath(); g.fill(); g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText('STAY GOLD', w / 2, 104); }
  });
}
function applyAptDecor() {
  const aptNow = myCos.apt || { rug: 0, poster: 0 };
  if (aptRugMesh) aptRugMesh.material.color.setHex(APT_RUGS[aptNow.rug] || APT_RUGS[0]);
  if (aptPosterMesh) { aptPosterMesh.material.map = posterTex(APT_POSTERS[aptNow.poster] || 'moon'); aptPosterMesh.material.needsUpdate = true; }
}
async function setApt(key, val) {
  try {
    const r = await (await fetch('/api/world3d/apt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: val }) })).json();
    if (r.ok) { myCos.apt = r.apt; applyAptDecor(); toast('apartment updated — saved to ur account'); }
    else toast(r.err || 'could not save that');
  } catch (e) { toast('network hiccup — try again'); }
}
function buildApt() {
  const CX = 2200;
  const { M, box } = roomShell(CX, { floor: 0x5a4632, wall: 0xd9c6a5 });
  const glow = new THREE.PointLight(0xffc98a, 380, 17, 2); glow.position.set(CX, 3.1, 0); scene.add(glow);
  interiorLights.push({ light: glow, zone: 'apt' });
  aptRugMesh = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.05, 3.8), M(APT_RUGS[0], { roughness: 1 }));
  aptRugMesh.position.set(CX, 0.03, 1.5); scene.add(aptRugMesh);
  // bed + pillow + blanket
  box(2.1, 0.5, 3.6, M(0x3d2417), CX - 8.6, 0.25, -5.5);
  box(2.0, 0.22, 3.4, M(0xd8d2ea, { roughness: 1 }), CX - 8.6, 0.6, -5.5);
  box(2.0, 0.14, 1.9, M(0x7c5cd6, { roughness: 1 }), CX - 8.6, 0.72, -4.6);
  box(1.1, 0.16, 0.6, M(0xffffff, { roughness: 1 }), CX - 8.6, 0.76, -6.9);
  boxColliders.push({ minX: CX - 9.8, maxX: CX - 7.4, minZ: -7.4, maxZ: -3.6 });
  // desk + chair seat + lamp
  box(2.6, 0.1, 1.1, M(0x6b4226), CX + 7.8, 0.95, -7.9);
  boxColliders.push({ minX: CX + 6.4, maxX: CX + 9.2, minZ: -8.5, maxZ: -7.3 });
  addInteract('apt', CX + 7.8, -6.4, 1.7, 'sit at ur desk', () => sitDown({ x: CX + 7.8, z: -6.7, ry: Math.PI }));
  // window with the moon (emissive plane on the north wall)
  const win = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), new THREE.MeshBasicMaterial({ map: posterTex('moon') }));
  win.position.set(CX - 3, 2.3, -8.95); scene.add(win);
  // poster on the west wall (decor choice)
  aptPosterMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.0), new THREE.MeshStandardMaterial({ map: posterTex('moon'), roughness: 0.9 }));
  aptPosterMesh.position.set(CX - 10.95, 2.1, 2.5); aptPosterMesh.rotation.y = Math.PI / 2; scene.add(aptPosterMesh);
  // shelf + plant + couch seat
  box(2.8, 0.08, 0.6, M(0x6b4226), CX + 3.5, 1.6, -8.8); box(2.8, 0.08, 0.6, M(0x6b4226), CX + 3.5, 2.3, -8.8);
  const couch = box(3.0, 0.55, 1.05, M(0x5a3a7c, { roughness: 0.95 }), CX + 6.8, 0.42, 4.6);
  couch.castShadow = true;
  addInteract('apt', CX + 6.8, 5.2, 1.7, 'sit on ur couch', () => sitDown({ x: CX + 6.8, z: 4.6, ry: Math.PI }));
  // decorate console: two honest controls, both server-saved
  addInteract('apt', CX - 10, 5.8, 2.0, () => 'change rug (' + ['violet', 'rose', 'teal'][myCos.apt.rug] + ')', () => setApt('rug', (myCos.apt.rug + 1) % 3));
  addInteract('apt', CX - 10, 2.5, 2.0, () => 'change poster (' + APT_POSTERS[myCos.apt.poster] + ')', () => setApt('poster', (myCos.apt.poster + 1) % 3));
  addInteract('apt', CX, 7.2, 2.5, 'leave ur apartment', () => { standUp(); fadeThrough(() => warpTo(-64, 38.3, 0)); });
  applyAptDecor();
}

/* ----- town-side doors for the new interiors ----- */
function enterLibrary() { standUp(); fadeThrough(() => warpTo(2120, 5.5, Math.PI)); }
function enterRec() { standUp(); fadeThrough(() => warpTo(2160, 5.5, Math.PI)); }
function enterApt() { standUp(); fadeThrough(() => warpTo(2200, 5.5, Math.PI)); }
function buildTownDoors545() {
  addInteract('town', 58, -44.8, 2.7, 'enter the library', enterLibrary);
  addInteract('town', 62, 40.3, 2.7, 'enter the rec center', enterRec);
  addInteract('town', -64, 38.3, 2.7, 'enter ur apartment', enterApt);
  const M2 = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0.02 }, o || {}));
  const leaf = (x, z, col) => {
    const d = new THREE.Mesh(new THREE.BoxGeometry(2.0, 3.1, 0.14), M2(0x2a1e4a, { roughness: 0.6 }));
    d.position.set(x, 1.55, z); scene.add(d);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.1), M2(col, { emissive: col, emissiveIntensity: 1.8 }));
    strip.position.set(x, 3.25, z); scene.add(strip);
  };
  leaf(58, -45.9, 0xffb36b); leaf(62, 41.4, 0x4ade80); leaf(-64, 39.4, 0xf9a8d4);
}

/* ----- town strollers: two locals walking the plaza loop -----
 * purely client-side ambience; the path is a fixed loop and the
 * phase is clock-based, so every client sees them in the same spot. */
const STROLLERS = [];
function buildStrollers() {
  const defs = [{ hue: 200, name: 'pip', off: 0 }, { hue: 20, name: 'mae', off: 0.45 }];
  for (const d of defs) {
    const g = makeAvatar(d.hue, d.name);
    scene.add(g);
    const sEntry = { g, off: d.off, st: { phase: Math.random() * 6, speed: 0, grounded: true, landT: 0, pose: 'stand' } };
    STROLLERS.push(sEntry);
    attachRig(sEntry, d.hue);
  }
}

/* ----- districts + discovery toasts + the world map ----- */
const DISTRICTS = [
  { name: 'the plaza', test: (x, z) => Math.hypot(x, z) < 34 },
  { name: 'north row', test: (x, z) => z < -26 && Math.abs(x) < 75 },
  { name: 'sakura park', test: (x, z) => x > 78 },
  { name: 'west homes', test: (x, z) => x < -78 },
  { name: 'south avenue', test: (x, z) => z > 52 },
];
let districtNow = '';
function seenSet() { try { return new Set(JSON.parse(localStorage.getItem('w3seen') || '[]')); } catch (e) { return new Set(); } }
function checkDistrict() {
  const z = zoneNow();
  let name = '';
  if (z === 'town') { for (const d of DISTRICTS) if (d.test(px, pz)) { name = d.name; break; } }
  else name = { coffee: 'the coffee shop', arcade: 'the arcade', clothing: 'clothing co.', library: 'the library', rec: 'the rec center', apt: 'ur apartment' }[z] || '';
  if (name && name !== districtNow) {
    const first = !seenSet().has(name);
    if (first) {
      const s2 = seenSet(); s2.add(name);
      try { localStorage.setItem('w3seen', JSON.stringify([...s2])); } catch (e) { }
      toast('✦ ' + name + ' — discovered', 2600);
    }
  }
  districtNow = name;
}
function openMap() {
  noteOpener();
  mapOpen = true; R.map.hidden = false; const mb = document.getElementById('w3mapbtn'); if (mb) mb.classList.add('on'); clearInput(); setPrompt(null);
  drawMap();
  const seen = [...seenSet()];
  R.mapseen.textContent = seen.length ? 'discovered: ' + seen.join(' · ') : 'walk around to discover the town’s districts';
  focusFirst(R.map);
}
function closeMap() { mapOpen = false; R.map.hidden = true; const mb = document.getElementById('w3mapbtn'); if (mb) mb.classList.remove('on'); restoreOpener(); }
function drawMap() {
  const cv = R.mapcv; if (!cv) return;
  const g = cv.getContext('2d'); if (!g) return;
  const W = cv.width, H = cv.height;
  const sx = (x) => (x + 200) / 400 * W, sz = (z) => (z + 125) / 250 * H;
  g.fillStyle = '#1a1226'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#5b84ad'; g.beginPath(); g.ellipse(sx(150), sz(30), 52, 40, 0, 0, 7); g.fill(); // moonfall lake east
  g.fillStyle = '#7d9b6a'; g.fillRect(sx(82), sz(-70), sx(190) - sx(82), sz(70) - sz(-70)); // park
  g.fillStyle = '#2a1f33'; g.fillRect(sx(-195), sz(-118), sx(195) - sx(-195), sz(118) - sz(-118)); // ground tint under roads
  g.fillStyle = '#1a1226'; g.fillRect(0, 0, W, H); // reset bg (kept simple: redraw in order)
  g.fillStyle = '#2a1f33'; g.fillRect(sx(-195), sz(-118), sx(195) - sx(-195), sz(118) - sz(-118));
  g.fillStyle = '#7d9b6a'; g.fillRect(sx(82), sz(-70), sx(190) - sx(82), sz(70) - sz(-70));
  g.fillStyle = '#5b84ad'; g.beginPath(); g.ellipse(sx(150), sz(30), 52, 40, 0, 0, 7); g.fill(); // lake AFTER the park: the park rect covers the lake's shore, the water must paint on top (v580 fix — same geometry/data)
  g.strokeStyle = '#8a7461'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(sx(-190), sz(0)); g.lineTo(sx(190), sz(0)); g.moveTo(sx(0), sz(-115)); g.lineTo(sx(0), sz(115)); g.stroke();
  g.fillStyle = '#ffc95e'; g.beginPath(); g.arc(sx(0), sz(0), 5, 0, 7); g.fill(); // the well
  const B = [
    ['coffee shop', -36, -44], ['6ixnetworks', 0, -50], ['clothing co.', 36, -44], ['arcade', -62, -52],
    ['library', 58, -54], ['6ix music', 0, -80], ['apartments', -64, 46], ['rec center', 62, 48],
  ];
  g.font = '600 10px Inter, sans-serif'; g.textAlign = 'center';
  for (const [name, x, z] of B) {
    g.fillStyle = '#d9b380'; g.fillRect(sx(x) - 8, sz(z) - 5, 16, 10);
    g.fillStyle = '#f7ecd9'; g.fillText(name, sx(x), sz(z) - 9);
  }
  g.fillStyle = '#f2a7c3';
  for (const [x, z] of [[-120, 20], [-128, -6], [96, -30], [120, 44], [-40, 70], [44, 84]]) { g.beginPath(); g.arc(sx(x), sz(z), 3, 0, 7); g.fill(); }
  const z = zoneNow();
  if (z === 'town') {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx(px), sz(pz), 5, 0, 7); g.fill();
    g.strokeStyle = '#ffc95e'; g.lineWidth = 2; g.beginPath(); g.arc(sx(px), sz(pz), 8.5, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.fillText('u are here', sx(px), sz(pz) + 22);
  } else {
    g.fillStyle = '#ffd9a0'; g.font = '700 13px Inter, sans-serif';
    g.fillText('u are inside: ' + z, W / 2, 24);
  }
}


/* ---------- v546: emotes (wave / celebrate, server-synced), zone
 * light culling, auto-quality step-down, dance floor trigger ----------
 * emotes ride the ping like sit does: the client sends the active
 * emote for 2.2s, the server time-gates it in rosters at 2.6s, and
 * animateAvatar poses it. sitting cancels (the sit pose wins). */
let myEmote = null, myEmoteAt = 0, onDance = false;
function doEmote(kind) {
  if (sessionConflict || transitioning || bootState === 'ERROR') return;
  if (sitting) standUp();
  myEmote = kind; myEmoteAt = performance.now();
  ping(true);
}
let lowFpsSince = 0;
function tickPerf() {
  const zn = zoneNow();
  for (const e of interiorLights) e.light.visible = (e.zone === zn);
  // the rec center dance floor celebrates u, once per entry
  if (zn === 'rec' && px > 2156.8 && px < 2163.2 && pz > -2.3 && pz < 2.5) {
    if (!onDance) { onDance = true; doEmote('celebrate'); }
  } else onDance = false;
  // auto quality: sustained low fps steps the tier cap down, once
  // per 4s window, never below low; manual gfx choices are untouched
  if (SET.gfx === 'auto' && bootState === 'READY' && typeof fpsEma === 'number') {
    const now = performance.now();
    if (fpsEma > 0 && fpsEma < 26) {
      if (!lowFpsSince) lowFpsSince = now;
      else if (now - lowFpsSince > 4000 && autoCap > 0) { autoCap--; lowFpsSince = 0; applyGfx(); }
    } else lowFpsSince = 0;
  }
}

/* ---------- networking: ping-poll presence, like the 2d world ---------- */
/* ping(): one round-trip to the world server with an EXPLICIT result.
 * { ok: true, data } only for a validated response (HTTP 2xx + parseable
 * JSON + ok:true). failures are classified, never swallowed:
 * network | http | badjson | server | takeover | auth.
 * (v540's ping caught everything internally, so the boot sequence
 * transitioned to READY even when the handshake had failed.)
 * side effects: auth failure is fatal (error screen); a takeover reply
 * enters SESSION_CONFLICT. sendPos=false sends a position-less ping,
 * which is how a frozen tab reclaims the session (the server transfers
 * sid ownership only when the ping carries no movement). */
/* ---------- STAGE 05: proximity voice chat ----------
 * the 2d world's voice system, ported to 3d: WebRTC peers with
 * signaling mailboxes (POST /api/world3d/signal, replies drained
 * into the ping response), the same ICE config (STUN + openrelay
 * TURN + the server's own TURN via window.W3ICE), a lexicographic
 * initiator rule (glare-free offers), and per-peer gain nodes
 * driven by 3d distance. radius 36 units = the 2d world's 360px
 * at this world's scale. the roster is server-side and zone-
 * filtered, so voice can never cross zones or reach players the
 * server does not place near you. */
const VOICE_R = 36;
let vcOn3 = false, vcMuted = false, vcStream = null, vcCtx3 = null, vcAn3 = null, vcTalk3 = false;
const vcPeers = {};
const vcRetry3 = {};
const vcFails3 = {};
function vcNoteFail3(u) {
  vcFails3[u] = (vcFails3[u] || 0) + 1;
  vcRetry3[u] = Date.now() + Math.min(30000, 5000 * vcFails3[u]);
}
const RTC_CFG3 = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }].concat(window.W3ICE || [])
};
function vcSend3(to, data) {
  fetch('/api/world3d/signal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, data }) }).catch(() => { });
}
function vcClosePeer(u) {
  const p = vcPeers[u];
  if (!p) return;
  if (p.discT) { clearTimeout(p.discT); p.discT = 0; }
  try { p.pc.close(); } catch (e) { }
  try { if (p.src) p.src.disconnect(); } catch (e) { }
  try { if (p.an) p.an.disconnect(); } catch (e) { }
  try { if (p.gain) p.gain.disconnect(); } catch (e) { }
  delete vcPeers[u];
  const rm = remotes.get(u);
  if (rm && rm.group.userData.label) rm.group.userData.label.material.color.setHex(0xffffff);
}
function vcEnsurePeer(u, initiator) {
  if (vcPeers[u] || u === me) return;
  if (vcRetry3[u] && Date.now() < vcRetry3[u]) return;
  if (!vcCtx3) { try { vcCtx3 = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
  if (vcCtx3 && vcCtx3.state === 'suspended') vcCtx3.resume();
  let pc;
  try { pc = new RTCPeerConnection(RTC_CFG3); } catch (e) { return; }
  let gain = null;
  if (vcCtx3) { gain = vcCtx3.createGain(); gain.gain.value = 0; gain.connect(vcCtx3.destination); }
  const p = { pc, gain, iceQ: [], remoteSet: false, an: null, speaking: false, src: null, discT: 0 };
  vcPeers[u] = p;
  if (vcStream) vcStream.getTracks().forEach((t) => { try { pc.addTrack(t, vcStream); } catch (e) { } });
  else { try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch (e) { } }
  pc.onicecandidate = (e) => { if (e.candidate) vcSend3(u, { t: 'ice', c: e.candidate }); };
  pc.ontrack = (e) => {
    if (!vcCtx3 || !vcPeers[u]) return;
    try {
      if (p.src) { try { p.src.disconnect(); } catch (err) { } }
      if (p.an) { try { p.an.disconnect(); } catch (err) { } p.an = null; }
      const ms = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      const src = vcCtx3.createMediaStreamSource(ms);
      p.src = src;
      src.connect(p.gain);
      p.an = vcCtx3.createAnalyser(); p.an.fftSize = 512; src.connect(p.an);
    } catch (err) { }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') { vcNoteFail3(u); vcClosePeer(u); }
    else if (pc.connectionState === 'closed') vcClosePeer(u);
    else if (pc.connectionState === 'connected') {
      delete vcRetry3[u]; vcFails3[u] = 0;
      if (p.discT) { clearTimeout(p.discT); p.discT = 0; }
    } else if (pc.connectionState === 'disconnected') {
      if (p.discT) clearTimeout(p.discT);
      p.discT = setTimeout(() => {
        if (vcPeers[u] === p && pc.connectionState !== 'connected' && pc.connectionState !== 'closed') { vcNoteFail3(u); vcClosePeer(u); }
      }, 2600);
    }
  };
  if (initiator) {
    pc.onnegotiationneeded = () => {
      pc.createOffer().then((of) => pc.setLocalDescription(of))
        .then(() => vcSend3(u, { t: 'offer', sdp: pc.localDescription })).catch(() => { });
    };
  }
}
function vcFlushIce(p) {
  p.remoteSet = true;
  const q = p.iceQ || []; p.iceQ = [];
  q.forEach((c) => { try { const pr = p.pc.addIceCandidate(new RTCIceCandidate(c)); if (pr && pr.catch) pr.catch(() => { }); } catch (e) { } });
}
function vcHandleSignal(from, data) {
  if (!data || !vcOn3) return;
  if (data.t === 'offer') {
    vcEnsurePeer(from, false);
    const p = vcPeers[from]; if (!p) return;
    p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(() => { vcFlushIce(p); return p.pc.createAnswer(); })
      .then((an) => p.pc.setLocalDescription(an))
      .then(() => vcSend3(from, { t: 'answer', sdp: p.pc.localDescription }))
      .catch(() => { });
  } else if (data.t === 'answer') {
    const p2 = vcPeers[from];
    if (p2) p2.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(() => vcFlushIce(p2)).catch(() => { });
  } else if (data.t === 'ice') {
    const p3 = vcPeers[from];
    if (p3 && data.c) { if (p3.remoteSet) p3.pc.addIceCandidate(new RTCIceCandidate(data.c)).catch(() => { }); else p3.iceQ.push(data.c); }
  }
}
function vcRms(an) {
  if (!an) return 0;
  const buf = new Uint8Array(an.fftSize);
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) { const v = (buf[i] - 128) / 128; sum += v * v; }
  return Math.sqrt(sum / (buf.length / 4));
}
function vcTick3(roster) {
  if (!vcOn3) return;
  if (vcCtx3 && vcCtx3.state === 'suspended') vcCtx3.resume();
  const want = {};
  for (const p of roster) {
    if (!p || p.u === me || !p.vc) continue;
    const d = Math.hypot(p.x - px, p.z - pz);
    if (d < VOICE_R) want[p.u] = d;
  }
  Object.keys(want).forEach((u) => vcEnsurePeer(u, me < u));
  Object.keys(vcPeers).forEach((u) => {
    if (want[u] == null) { vcClosePeer(u); return; }
    const pr = vcPeers[u];
    if (pr && pr.gain && vcCtx3) {
      const g = Math.pow(Math.max(0, 1 - want[u] / VOICE_R), 1.4);
      pr.gain.gain.setTargetAtTime(g, vcCtx3.currentTime, 0.08);
    }
    // speaking indicator: tint the player's name label while they talk
    if (pr && pr.an) {
      const sp = vcRms(pr.an) > 0.045;
      if (sp !== pr.speaking) {
        pr.speaking = sp;
        const rm = remotes.get(u);
        if (rm && rm.group.userData.label) rm.group.userData.label.material.color.setHex(sp ? 0x86ff9e : 0xffffff);
      }
    }
  });
}
function vcSetBtn3() {
  const b = document.getElementById('w3micbtn');
  const mb = document.getElementById('w3mutebtn');
  if (b) {
    const listenOnly = vcOn3 && !vcStream;
    b.innerHTML = icon((vcOn3 && !vcMuted && !listenOnly) ? 'mic' : 'micoff', 20);
    b.classList.toggle('on', vcOn3);
    b.title = !vcOn3 ? 'voice chat' : listenOnly ? 'voice on — listen only (no mic)' : (vcMuted ? 'voice on — mic muted' : 'voice on — tap to turn off');
  }
  if (mb) { mb.hidden = !vcOn3; mb.classList.toggle('on', vcMuted); mb.innerHTML = icon(vcMuted ? 'micoff' : 'mic', 18); }
  // v580: voice status pill (presentation only — states come straight
  // from the existing voice flags; no signaling/WebRTC changes)
  const pill = document.getElementById('w3vcstat'), ptx = document.getElementById('w3vcstattx');
  if (pill && ptx) {
    let st = '', tx = '';
    if (vcPending3) { st = 'st-connecting'; tx = 'connecting…'; }
    else if (vcOn3) {
      if (!vcStream) { st = 'st-listen'; tx = 'listen only — no mic'; }
      else if (vcMuted) { st = 'st-muted'; tx = 'mic muted'; }
      else { st = 'st-live'; tx = 'voice live'; }
    }
    pill.className = st ? ('show ' + st + (vcTalk3 ? ' talking' : '')) : '';
    if (tx) ptx.textContent = tx;
  }
}
function vcStopAll3() {
  vcGen3++;
  vcOn3 = false; vcTalk3 = false;
  if (vcStream) { vcStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { } }); vcStream = null; }
  vcAn3 = null;
  Object.keys(vcPeers).forEach(vcClosePeer);
  vcSetBtn3();
}
function vcApplyMute() {
  if (vcStream) vcStream.getAudioTracks().forEach((t) => { t.enabled = !vcMuted; });
  vcSetBtn3();
}
let vcPending3 = false, vcGen3 = 0;
async function vcToggle3() {
  if (vcOn3) { vcStopAll3(); toast('voice off'); return; }
  if (vcPending3) return;
  vcPending3 = true;
  vcSetBtn3();
  const gen = vcGen3;
  let stream = null;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { stream = null; }
  }
  vcPending3 = false;
  vcSetBtn3();
  if (gen !== vcGen3) {
    if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { } });
    return;
  }
  vcStream = stream;
  if (!vcCtx3) { try { vcCtx3 = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
  if (vcCtx3 && vcCtx3.state === 'suspended') vcCtx3.resume();
  if (stream && vcCtx3) {
    try { const src = vcCtx3.createMediaStreamSource(stream); vcAn3 = vcCtx3.createAnalyser(); vcAn3.fftSize = 512; src.connect(vcAn3); } catch (e) { }
  }
  vcMuted = false;
  vcOn3 = true;
  vcSetBtn3();
  toast(stream ? 'voice on — walk up to someone to talk' : 'voice on (listen only — mic blocked)');
  ping(true);
}
setInterval(() => {
  if (!vcOn3 || !vcAn3) { if (vcTalk3) { vcTalk3 = false; const b = document.getElementById('w3micbtn'); if (b) b.classList.remove('live'); } return; }
  vcTalk3 = !vcMuted && vcRms(vcAn3) > 0.045;
  const b = document.getElementById('w3micbtn');
  if (b) b.classList.toggle('live', vcTalk3);
  const pill = document.getElementById('w3vcstat');
  if (pill) pill.classList.toggle('talking', vcTalk3);
}, 180);
document.addEventListener('visibilitychange', () => { if (!document.hidden && vcCtx3 && vcCtx3.state === 'suspended') vcCtx3.resume(); });
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (vcOn3 && vcStream && vcStream.getAudioTracks().every((t) => t.readyState === 'ended')) {
      toast('mic device changed — reconnecting mic');
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        vcStream = s; vcMuted = false;
        Object.keys(vcPeers).forEach((u) => { vcClosePeer(u); });
        vcSetBtn3();
      }).catch(() => { vcStream = null; toast('mic unavailable — listen only'); });
    }
  });
}
window.addEventListener('pagehide', () => { if (vcOn3) vcStopAll3(); });

{ const b = document.getElementById('w3micbtn'); if (b) b.addEventListener('click', () => vcToggle3());
  const mb = document.getElementById('w3mutebtn'); if (mb) mb.addEventListener('click', () => { if (!vcOn3) return; vcMuted = !vcMuted; vcApplyMute(); toast(vcMuted ? 'mic muted' : 'mic live'); });
  vcSetBtn3(); }

let sessionConflict = false, handshakeOk = false;
async function ping(sendPos) {
  if (sendPos === undefined) sendPos = true;
  let res;
  try {
    const wn = warpNext; warpNext = false;
    res = await fetch('/api/world3d/ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sendPos ? { x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10, ry, sid: mySid, sit: sitting ? 1 : 0, warp: wn, vc: vcOn3 ? 1 : 0, emote: (myEmote && performance.now() - myEmoteAt < 2200) ? myEmote : null } : { sid: mySid, vc: vcOn3 ? 1 : 0 }) });
  } catch (e) { return { ok: false, kind: 'network', err: 'network error' }; }
  let r = null;
  try { r = await res.json(); } catch (e) { return { ok: false, kind: 'badjson', err: 'non-JSON reply (HTTP ' + res.status + ')' }; }
  if (!res.ok) {
    if (res.status === 401 || (r && r.err === 'login first')) {
      window.__w3fatal = true;
      loadError('ur not logged in. log in on the site first, then come back through the portal.');
      stopLoop();
      return { ok: false, kind: 'auth', err: 'login first' };
    }
    return { ok: false, kind: 'http', err: 'HTTP ' + res.status + (r && r.err ? ' - ' + r.err : '') };
  }
  if (!r || r.ok !== true) {
    if (r && r.err === 'session taken over') { enterSessionConflict(); return { ok: false, kind: 'takeover', err: r.err }; }
    return { ok: false, kind: 'server', err: (r && r.err) || 'server refused' };
  }
  lastPingOk = performance.now();
  if (bootState === 'RECONNECTING') bootState = 'READY';
  me = r.me || me;
  if (typeof r.bal === 'number') R.bal.textContent = '¢ ' + r.bal + ' six cents';
  if (r.cos) {
    const changed = JSON.stringify(r.cos.wear) !== JSON.stringify(myCos.wear) || r.cos.hue !== myCos.hue;
    myCos = r.cos;
    if (changed && !wardOpen) { const g = scene.userData.meGroup; if (g) applyWear(g, myCos.wear, myCos.hue); }
    if (sleeveMat && typeof myCos.hue === 'number') sleeveMat.color.setHSL(myCos.hue / 360, 0.45, 0.5);
    if (meEntry && meEntry.rig && typeof myCos.hue === 'number') tintRig(meEntry, myCos.hue);
    syncShards(); applyAptDecor();
  }
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
      attachRig(rm, typeof p.hue === 'number' ? p.hue : 260);
    }
    rm.tx = p.x; rm.tz = p.z; rm.try_ = p.ry || 0; rm.sit = p.sit ? 1 : 0;
    rm.emote = p.emote || null;
    const wj = p.wear ? JSON.stringify(p.wear) + '|' + p.hue : '';
    if (rm.wj !== wj) { rm.wj = wj; applyWear(rm.group, p.wear || { hat: 'none', hair: 'crest', acc: 'none' }, (typeof p.hue === 'number') ? p.hue : null); }
  }
  for (const [u, rm] of remotes) {
    if (!seen.has(u)) { scene.remove(rm.group); disposeAvatar(rm.group); remotes.delete(u); }
  }
  if (r.sig && r.sig.length) for (const s of r.sig) vcHandleSignal(s.from, s.data);
  vcTick3(r.roster);
  return { ok: true, data: r };
}

/* SESSION_CONFLICT: the server says another tab owns this account's
 * session. this tab freezes for real: inputs cleared, velocity zeroed,
 * the loop's input gate and ping scheduler both check sessionConflict,
 * so no movement is applied and NO position is submitted from here.
 * the world keeps rendering behind a persistent card. reclaim sends a
 * position-less ping (server transfers sid ownership when not moving);
 * the account keeps exactly ONE server entry throughout — no dupes. */
function enterSessionConflict() {
  if (sessionConflict) return;
  sessionConflict = true;
  bootState = 'SESSION_CONFLICT';
  clearInput();
  vx = 0; vz = 0;
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) { } }
  loadDone = true;
  if (R.load) { R.load.classList.add('hide'); R.load.classList.remove('show'); }
  if (R.conflict) R.conflict.hidden = false;
}
function exitSessionConflict() {
  sessionConflict = false;
  if (R.conflict) R.conflict.hidden = true;
  handshakeOk = true;
  if (!booted) { booted = true; window.__w3booted = true; }
  bootState = 'READY';
  lastPingOk = performance.now();
}
async function reclaimSession() {
  const hs = await ping(false);
  if (hs.ok) { exitSessionConflict(); toast('this tab is live again'); }
  else if (hs.kind !== 'takeover') toast('still blocked: ' + hs.err);
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
    if (e.code === 'KeyE' && down) tryInteract();
    if (e.code === 'KeyM' && down) { if (mapOpen) closeMap(); else openMap(); }
    if (e.code === 'KeyV' && down) toggleView();
    if (e.code === 'Digit1' && down) doEmote('wave');
    if (e.code === 'Digit2' && down) doEmote('celebrate');
    if (down && sitting && (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD' || e.code === 'Space')) standUp();
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
  if (SET.view === 'fp') fpPitchT = clamp(fpPitchT + dy * 0.0019 * SET.sens, -1.35, 1.35);
  else camPitchT = clamp(camPitchT + dy * 0.0019 * SET.sens, 0.06, 1.3);
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
  R.use.addEventListener('click', () => tryInteract());
  R.dlgnext.addEventListener('click', () => advanceDlg());
  R.dlg.addEventListener('click', (e) => { if (e.target === R.dlg) advanceDlg(); });
  $('w3menuclose').addEventListener('click', () => closeMenu());
  $('w3wardclose').addEventListener('click', () => closeWardrobe(false));
  $('w3wardcancel').addEventListener('click', () => closeWardrobe(false));
  $('w3wardsave').addEventListener('click', () => saveWardrobe());
  $('w3gamesclose').addEventListener('click', () => closeGames());
  $('w3quizclose').addEventListener('click', () => closeQuiz());
  $('w3mapclose').addEventListener('click', () => closeMap());
  $('w3mapbtn').addEventListener('click', () => { if (mapOpen) closeMap(); else openMap(); });
  $('w3wavebtn').addEventListener('click', (e) => { doEmote('wave'); const b = e.currentTarget; b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 1200); });
  $('w3partybtn').addEventListener('click', (e) => { doEmote('celebrate'); const b = e.currentTarget; b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 1200); });
  R.hue.addEventListener('input', () => {
    draftHue = Number(R.hue.value); R.hueval.textContent = '— ' + draftHue + '°';
    const g = scene.userData.meGroup; if (g) applyWear(g, draftWear, draftHue);
  });
  R.sprint.addEventListener('pointerdown', (e) => { e.preventDefault(); sprintTouch = true; R.sprint.classList.add('on'); });
  const endSprint = () => { sprintTouch = false; R.sprint.classList.remove('on'); };
  R.sprint.addEventListener('pointerup', endSprint); R.sprint.addEventListener('pointercancel', endSprint); R.sprint.addEventListener('pointerleave', endSprint);
  document.addEventListener('pointerdown', function firstTouch(e) {
    if (e.pointerType === 'touch') document.body.classList.add('touch');
  });
}

/* ---------- camera collision: shorten the boom, never clip ---------- */

/* ---------- v547: first-person camera controller + view-model hands ----------
 * a dedicated FP controller, separate from the third-person boom:
 * the eye sits at the avatar's head height (avatar head center is
 * y 2.06, so eye 1.95), pitch is its own state (-1.35..1.35, zero =
 * level) so TP boom pitch is never disturbed, and facing (ry) tracks
 * the camera yaw — u face where u look, which is also what remote
 * players see. the TP camera stays fully intact behind SET.view.
 * hands are a world-space view model positioned from the camera
 * basis each frame (no camera parenting, no scene-graph surprises):
 * forearms in ur body color + hands, with idle sway, walk swing,
 * sprint tuck, air/land response, an interact punch and a sit rest. */
const EYE_H = 1.95, SIT_EYE_H = 1.32;
let fpPitch = 0, fpPitchT = 0, bobPhase = 0, sitEye = EYE_H, punchT = -1e9, fovApplied = 0;
let handsGroup = null, handL = null, handR = null, sleeveMat = null;
function buildHands() {
  sleeveMat = new THREE.MeshStandardMaterial({ color: 0x8a7fd4, roughness: 0.6, metalness: 0.05 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b48c, roughness: 0.75 });
  const mk = (side) => {
    // group origin sits at the HAND, ~0.45 ahead of the eye; the
    // forearm dives back-down-outward from it so its near end stays
    // off-axis and small in frame (a first v547 build put the arm's
    // cross-section right at the eye plane and it filled the screen).
    const g = new THREE.Group();
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.19), skin);
    g.add(hand);
    // four fingers at the front edge — the cue that makes it read as a hand
    for (let f = 0; f < 4; f++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.085 - Math.abs(f - 1.5) * 0.012), skin);
      fin.position.set(-0.039 + f * 0.026, -0.004, -0.125);
      fin.rotation.x = 0.25;
      g.add(fin);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.11), skin);
    thumb.position.set(-side * 0.085, 0.01, -0.03); thumb.rotation.y = side * 0.5; g.add(thumb);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.4), sleeveMat);
    fore.position.set(side * 0.05, -0.08, 0.19); fore.rotation.x = 0.95; fore.rotation.z = side * 0.14; g.add(fore);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.108, 0.09), sleeveMat);
    cuff.position.set(side * 0.032, -0.042, 0.1); cuff.rotation.x = 0.95; g.add(cuff);
    g.userData.side = side;
    return g;
  };
  handL = mk(-1); handR = mk(1);
  handsGroup = new THREE.Group();
  handsGroup.add(handL); handsGroup.add(handR);
  handsGroup.visible = false;
  scene.add(handsGroup);
}
const _fF = new THREE.Vector3(), _fR = new THREE.Vector3(), _fU = new THREE.Vector3(), _fB = new THREE.Vector3(), _fM = new THREE.Matrix4(), _fE = new THREE.Vector3();
function updateCameraFP(dt, now) {
  const kA = dampK(20, dt);
  camYaw = angLerp(camYaw, camYawT, kA);
  fpPitch += (fpPitchT - fpPitch) * kA;
  if (Math.abs(angWrap(camYawT - camYaw)) < 0.0005) { camYaw = angWrap(camYaw); camYawT = camYaw; }
  // head bob: tied to distance travelled, tiny by design (and off-able)
  if (grounded && speedSm > 0.6) bobPhase += dt * speedSm * 1.35;
  const sf = clamp(speedSm / WALK, 0, 1.6);
  const bobAmp = SET.bob ? (sprintingNow() ? 0.042 : 0.028) * Math.min(1, sf) : 0;
  const bobY = Math.sin(bobPhase * 2) * bobAmp;
  const bobX = Math.cos(bobPhase) * bobAmp * 0.5;
  const dip = mySt.landT > 0 ? (mySt.landT / 0.16) * 0.085 : 0; // landing absorption
  const airLift = !grounded ? clamp(vy * 0.006, -0.05, 0.07) : 0;
  sitEye += ((sitting ? SIT_EYE_H : EYE_H) - sitEye) * dampK(9, dt); // smooth sit/stand
  const cp = Math.cos(fpPitch), sp = Math.sin(fpPitch);
  _fF.set(Math.sin(camYaw) * cp, -sp, Math.cos(camYaw) * cp);
  _fR.set(-Math.cos(camYaw), 0, Math.sin(camYaw)).normalize();
  _fE.set(px + _fR.x * bobX, groundY + py + sitEye + bobY - dip + airLift, pz + _fR.z * bobX);
  camera.position.copy(_fE);
  _fB.copy(_fE).add(_fF);
  camera.lookAt(_fB);
  if (fovApplied !== SET.fov) { camera.fov = SET.fov; camera.updateProjectionMatrix(); fovApplied = SET.fov; }
  // local body hidden in FP (other players still see it via THEIR
  // clients); the wardrobe forces TP so the preview stays visible.
  const mg = scene.userData.meGroup;
  if (mg) mg.visible = wardOpen;
  updateHands(now, bobY, dip);
}
function sprintingNow() { return speedSm > WALK * 1.15; }
function updateHands(now, bobY, dip) {
  if (!handsGroup) buildHands();
  handsGroup.visible = !wardOpen && !menuOpen && !quizOpen && !mapOpen;
  if (!handsGroup.visible) return;
  // camera basis -> world frame for the view model
  _fU.crossVectors(_fR, _fF); // R x F: unit up, orthonormal with R and F
  _fB.copy(_fF).negate();
  _fM.makeBasis(_fR, _fU, _fB);
  handsGroup.quaternion.setFromRotationMatrix(_fM);
  handsGroup.position.copy(_fE);
  const sf = clamp(speedSm / WALK, 0, 1.6);
  const swing = Math.sin(bobPhase) * 0.045 * Math.min(1, sf) * (SET.bob ? 1 : 0.4);
  const idle = Math.sin(now / 950) * 0.006;
  const spr = sprintingNow() && grounded;
  const punch = Math.max(0, 1 - (now - punchT) / 260);
  const punchExt = Math.sin(punch * Math.PI) * 0.13;
  for (const h of [handL, handR]) {
    const side = h.userData.side;
    let x = side * (spr ? 0.21 : 0.27);
    let y = -0.36 + idle + bobY * 0.55 - dip * 0.7 + (grounded ? 0 : 0.028);
    let z = -0.5 + (spr ? 0.04 : 0) + (h === handL ? swing : -swing) * 0.4;
    if (h === handR) z -= punchExt;
    if (sitting) { x = side * 0.2; y = -0.48; z = -0.42; }
    h.position.set(x, y, z);
    h.rotation.set(sitting ? 0.5 : 0.3, side * -0.22, side * 0.06);
  }
}
function toggleView() {
  SET.view = SET.view === 'fp' ? 'tp' : 'fp';
  saveSet();
  if (R.viewsel) R.viewsel.value = SET.view;
  if (SET.view === 'tp' && camera) { camera.fov = 58; camera.updateProjectionMatrix(); fovApplied = 58; }
  else fovApplied = 0;
  const mg = scene.userData.meGroup; if (mg) mg.visible = SET.view === 'tp';
  if (handsGroup) handsGroup.visible = SET.view === 'fp';
  toast(SET.view === 'fp' ? 'first person' : 'third person');
}

function updateCamera(dt) {
  if (SET.view === 'fp') { updateCameraFP(dt, performance.now()); return; }
  const kA = dampK(18, dt);
  camYaw = angLerp(camYaw, camYawT, kA);
  camPitch += (camPitchT - camPitch) * kA;
  if (Math.abs(angWrap(camYawT - camYaw)) < 0.0005) { camYaw = angWrap(camYaw); camYawT = camYaw; }
  const kF = dampK(14, dt);
  followX += (px - followX) * kF;
  followZ += (pz - followZ) * kF;
  followY += ((SET.camH + groundY + py) - followY) * dampK(8, dt);
  const hx = followX, hy = followY + 0.35, hz = followZ;
  const cx = hx - Math.sin(camYaw) * Math.cos(camPitch) * SET.camDist;
  const cz = hz - Math.cos(camYaw) * Math.cos(camPitch) * SET.camDist;
  const cy = hy + Math.sin(camPitch) * SET.camDist;
  let maxT = 1;
  for (const s of camSpheres) { const t = segSphereT(hx, hy, hz, cx, cy, cz, s); if (t >= 0) maxT = Math.min(maxT, t); }
  for (const b of camBoxes) { const t = segBoxT(hx, hy, hz, cx, cy, cz, b); if (t >= 0) maxT = Math.min(maxT, t); }
  let wantDist = SET.camDist * clamp(maxT * 0.94, 0.12, 1);
  if (zoneNow() !== 'town') wantDist = Math.min(wantDist, 6.2); // indoor boom clamp
  const rate = wantDist < camDistEff ? 22 : 6; // pull in fast, ease back out
  camDistEff += (wantDist - camDistEff) * dampK(rate, dt);
  const inv = camDistEff / SET.camDist;
  camera.position.set(hx + (cx - hx) * inv, Math.max(0.55, hy + (cy - hy) * inv), hz + (cz - hz) * inv);
  _v3.set(followX, followY + 0.15, followZ);
  camera.lookAt(_v3);
}

/* ---------- main loop (the ONLY loop) ---------- */
const mySt = { phase: 0, speed: 0, grounded: true, landT: 0 };
let meEntry = null;
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
  if (!transitioning && !sessionConflict && !sitting && !dlgOpen && !menuOpen && !wardOpen && !gamesOpen && !quizOpen && !mapOpen && (bootState === 'READY' || bootState === 'RECONNECTING')) {
  if (keys.KeyW || keys.ArrowUp) iz -= 1;
  if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  ix += joyVec.x; iz += joyVec.y;
  }
  const ni = normInput(ix, iz);
  const sprinting = !!(keys.ShiftLeft || keys.ShiftRight || sprintTouch) || (joyId !== null && Math.hypot(joyVec.x, joyVec.y) > 0.94);
  let dvx = 0, dvz = 0;
  if (ni.raw > 0.08) {
    // camera-relative direction from math3d.js — the SAME function the
    // repo tests verify (v539 had this rotation inverted: W walked
    // toward the camera and A/D were swapped).
    const w = moveVec(camYaw, ni.x, ni.y);
    const sp = (sprinting ? SPRINT : WALK) * ni.mag;
    dvx = w.x * sp; dvz = w.z * sp;
  }
  // velocity approach: fast accel, faster stop (no glide, no stuck keys)
  const rate = (dvx || dvz) ? ACCEL : DECEL;
  const dvxD = dvx - vx, dvzD = dvz - vz, dl = Math.hypot(dvxD, dvzD), maxD = rate * dt;
  if (dl > 0.001) { const f = Math.min(1, maxD / dl); vx += dvxD * f; vz += dvzD * f; }
  px += vx * dt; pz += vz * dt;
  const spd = Math.hypot(vx, vz);
  speedSm += (spd - speedSm) * dampK(12, dt);
  if (SET.view === 'fp') ry = camYaw;
  else if (spd > 0.7) ry = angLerp(ry, Math.atan2(vx, vz), dampK(TURN, dt));

  // gravity / jump / land
  wasGrounded = grounded;
  if (!grounded) {
    py += vy * dt; vy -= GRAV * dt;
    if (py <= 0) { py = 0; vy = 0; grounded = true; }
  }
  if (!wasGrounded && grounded) mySt.landT = 0.16;

  // bounds + colliders — ZONE-AWARE: interiors live far outside the
  // town bounds; clamping to town while inside yanked the player to
  // the town edge the moment they moved (the v543 cafe bug).
  const zb = zoneNow();
  if (zb === 'town' || !ZONE_BOXES[zb]) { px = clamp(px, -BOUND_X, BOUND_X); pz = clamp(pz, -BOUND_Z, BOUND_Z); }
  else { const B = ZONE_BOXES[zb]; px = clamp(px, B.minX + 0.6, B.maxX - 0.6); pz = clamp(pz, B.minZ + 0.6, B.maxZ - 0.6); }
  // ground from the CLAMPED position's zone, not the pre-clamp one:
  // pushing against the town boundary overshoots past 195/118 for a
  // frame, read as 'void', and pinned groundY to 0 — the player sank
  // into the hillside for as long as they held the key (found by the
  // terrain refinement verification at the west edge).
  groundY = (zoneNow() === 'town') ? groundH(px, pz) : 0;
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
    meGroup.position.set(px, groundY + (sitting ? 0.04 : py), pz);
    meGroup.rotation.y = wardOpen ? (performance.now() / 900) : ry;
    mySt.speed = speedSm; mySt.grounded = grounded; mySt.pose = sitting ? 'sit' : 'stand';
    mySt.emote = (myEmote && now - myEmoteAt < 2200) ? myEmote : null;
    if (meEntry && meEntry.rig && !sitting && !mySt.emote && !wardOpen) { setRigShown(meEntry, true); updateRig(meEntry, dt); }
    else { if (meEntry && meEntry.rig) setRigShown(meEntry, false); animateAvatar(meGroup, mySt, dt, now); }
  }
  // remotes: interpolate + animate from their real speed
  for (const rm of remotes.values()) {
    const g = rm.group, k = dampK(10, dt);
    const ox = g.position.x, oz = g.position.z;
    g.position.x += (rm.tx - g.position.x) * k;
    g.position.z += (rm.tz - g.position.z) * k;
    const inst = dt > 0 ? Math.hypot(g.position.x - ox, g.position.z - oz) / dt : 0;
    rm.st.speed += (inst - rm.st.speed) * dampK(8, dt);
    rm.st.pose = rm.sit ? 'sit' : 'stand'; rm.st.emote = rm.emote;
    g.position.y = (zoneNow() === 'town' ? groundH(g.position.x, g.position.z) : 0) + (rm.sit ? 0.04 : 0);
    g.rotation.y = angLerp(g.rotation.y, rm.try_, k);
    if (rm.rig && !rm.sit && !rm.emote) { setRigShown(rm, true); updateRig(rm, dt); }
    else { if (rm.rig) setRigShown(rm, false); animateAvatar(g, rm.st, dt, now); }
  }
  // npcs idle in place; prompt scan + seat snap (v543)
  tickStrollers(dt, now); tickShards(now); tickDressing(now); tickAudio(); tickWildlife(now, dt); tickLOD(); tickTerrainStreaming();
  tickNPCRoutines(now);
  for (const n of NPCS) { if (n.zone && zoneNow() !== n.zone) continue; if (n.rig) updateRig(n, dt); else animateAvatar(n.g, n.st, dt, now); }
  if (sitting) { px = sitting.x; pz = sitting.z; if (joyVec.x || joyVec.y) standUp(); }
  if ((scanTick = (scanTick + 1) % 5) === 0) scanPrompts();

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
  for (const sw of swayers) { sw.g.rotation.z = Math.sin(now / 1600 + sw.ph) * 0.025; sw.g.rotation.x = Math.cos(now / 1900 + sw.ph) * 0.018; }
  if (fallsTex) fallsTex.offset.y = -((now / 1300) % 1);

  // return-portal proximity -> action button
  const nearPortal = Math.hypot(px - PORTAL.x, pz - PORTAL.z) < 5.2;
  if (String(nearPortal) !== R.act.dataset.on) { R.act.dataset.on = String(nearPortal); R.act.hidden = !nearPortal; }
  if (toastAt && now > toastAt) { R.toast.hidden = true; toastAt = 0; }

  const connLost = booted && !sessionConflict && lastPingOk && (now - lastPingOk > 3200);
  if (connLost && bootState === 'READY') bootState = 'RECONNECTING';
  if (R.conn && connLost !== R.conn.dataset.on) { R.conn.dataset.on = connLost; R.conn.hidden = !connLost; }
  updateCamera(dt);

  pingTimer += dt;
  if (pingTimer > 0.45 && !sessionConflict) { pingTimer = 0; ping(); }
  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    // READY requires BOTH a rendered first frame AND a validated server
    // handshake — never one without the other.
    if (handshakeOk && !sessionConflict) { setLoad(100, 'READY'); booted = true; window.__w3booted = true; }
    window.__w3scene = scene; // diagnostic handle (mesh census in tests)
    window.__w3state = function () {
      const miraN = NPCS.find((n) => n.zone === 'coffee');
      return { x: px, z: pz, y: py, ry, camYaw, camPitch, camDist: camDistEff, speed: speedSm, sprinting: !!(keys.ShiftLeft || keys.ShiftRight || sprintTouch), grounded, booted, state: bootState, conflict: sessionConflict, remotes: remotes.size, fps: Math.round(fpsEma), zone: zoneNow(), sitting: !!sitting, wear: myCos.wear, hue: myCos.hue, wardOpen, gamesOpen, quizOpen, mapOpen, shards: myCos.shards.length, district: districtNow, emote: (myEmote && performance.now() - myEmoteAt < 2200) ? myEmote : null, view: SET.view, eyeY: camera ? Math.round(camera.position.y * 100) / 100 : 0, fovNow: camera ? camera.fov : 0, fpPitch: Math.round(fpPitch * 1000) / 1000, hands: !!(handsGroup && handsGroup.visible), birds: BIRDS.length, petals: !!petals, groundY: Math.round(groundY * 100) / 100, hOverlook: Math.round(groundH(174, 8) * 10) / 10, grassN: VEG.grass, flowerN: VEG.flowers, forestN: FOREST.trees, groveN: GROVE.n, coverN: COVER.lawn, chunksOn: COVER.chunksOn, chunks: COVER.chunks, lodNear: COVER.lodNear, lodFar: COVER.lodFar, bfly: WILD.bfly.length, rabbits: WILD.rabbits.length, deer: WILD.deer.length, amb: ambZone, sfx: SET.sfx, npcs: NPCS.length, strollers: STROLLERS.length, miraX: (NPCS[0] ? +NPCS[0].g.position.x.toFixed(1) : 0), miraRig: !!(miraN && miraN.rig), rigs: NPCS.concat(STROLLERS).filter((n) => n.rig).length, meRig: !!(meEntry && meEntry.rig), remoteRigs: [...remotes.values()].filter((r) => r.rig).length, assetSwaps, perfQ: loadQ.length + loadActive, tChunks: TERRAIN_CHUNKS.size, tMesh: TERRAIN_MESHES.size, vegC: VEG_MESHES.size, settleC: SETTLE_MESHES.size, waterC: WATER_MESHES.size, fallsOn: !!fallsMesh, terrTex: terrainTexState ? { loaded: terrainTexState.loaded, failed: terrainTexState.failed.slice() } : null, garden: SPAWNG, vc: { on: vcOn3, muted: vcMuted, peers: Object.keys(vcPeers).length, states: Object.fromEntries(Object.entries(vcPeers).map(([u, p]) => [u, p.pc.connectionState])), talk: vcTalk3 }, autoCap, calls: (typeof renderer !== 'undefined' && renderer) ? renderer.info.render.calls : -1, prompt: curPrompt ? (typeof curPrompt.label === 'function' ? curPrompt.label() : curPrompt.label) : '' };
    };
    if (window.__w3watchdog) clearTimeout(window.__w3watchdog);
    if (flavorTimer) { clearInterval(flavorTimer); flavorTimer = 0; }
    loadDone = true;
    R.wrap.classList.add('ready');
    setTimeout(() => { R.load.classList.add('hide'); }, 300);
    if (booted && new URLSearchParams(location.search).get('from') === 'portal') toast('✦ u crossed over. wasd + mouse — click the world to lock the camera', 5200);
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
function paintRange(el) { if (!el) return; const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 1, v = parseFloat(el.value) || 0; el.style.setProperty('--fill', ((v - min) / (max - min) * 100) + '%'); }
function bindSettings() {
  const bv = (id) => document.getElementById(id);
  const badges = () => {
    const s = bv('w3sensv'); if (s) s.textContent = SET.sens.toFixed(2) + '×';
    const d = bv('w3camdv'); if (d) d.textContent = SET.camDist + ' u';
    const h = bv('w3camhv'); if (h) h.textContent = SET.camH.toFixed(1);
    const f = bv('w3fovv'); if (f) f.textContent = SET.fov + '°';
    const v = bv('w3volv'); if (v) v.textContent = Math.round(SET.vol * 100) + '%';
    const x = bv('w3sfxv'); if (x) x.textContent = Math.round(SET.sfx * 100) + '%';
    [R.sens, R.camd, R.camh, R.fov, R.vol, R.sfx].forEach(paintRange);
  };
  R.sens.value = SET.sens; R.camd.value = SET.camDist; R.camh.value = SET.camH; R.gfxsel.value = SET.gfx;
  if (R.viewsel) { R.viewsel.value = SET.view; R.fov.value = SET.fov; R.bob.checked = SET.bob; }
  R.shadow.checked = SET.shadows; R.snd.checked = SET.snd; R.vol.value = SET.vol; if (R.sfx) R.sfx.value = SET.sfx;
  badges();
  R.setbtn.addEventListener('click', () => { R.set.hidden = !R.set.hidden; R.setbtn.classList.toggle('on', !R.set.hidden); if (!R.set.hidden) { badges(); focusFirst(R.set); } });
  R.setclose.addEventListener('click', () => { R.set.hidden = true; R.setbtn.classList.remove('on'); R.setbtn.focus(); });
  R.sens.addEventListener('input', () => { SET.sens = parseFloat(R.sens.value) || 1; saveSet(); badges(); });
  R.camd.addEventListener('input', () => { SET.camDist = parseFloat(R.camd.value) || 13; saveSet(); badges(); });
  R.camh.addEventListener('input', () => { SET.camH = parseFloat(R.camh.value) || 1.7; saveSet(); badges(); });
  R.gfxsel.addEventListener('change', () => { SET.gfx = R.gfxsel.value; autoCap = 2; saveSet(); applyGfx(); toast('graphics: ' + SET.gfx); });
  if (R.viewsel) {
    R.viewsel.addEventListener('change', () => { if (R.viewsel.value !== SET.view) toggleView(); });
    R.fov.addEventListener('input', () => { SET.fov = parseInt(R.fov.value, 10) || 72; saveSet(); badges(); });
    R.bob.addEventListener('change', () => { SET.bob = R.bob.checked; saveSet(); });
  }
  R.shadow.addEventListener('change', () => { SET.shadows = R.shadow.checked; saveSet(); applyGfx(); });
  R.snd.addEventListener('change', () => { SET.snd = R.snd.checked; saveSet(); applyAudio(); });
  R.vol.addEventListener('input', () => { SET.vol = parseFloat(R.vol.value) || 0; saveSet(); applyAudio(); badges(); });
  if (R.sfx) R.sfx.addEventListener('input', () => { SET.sfx = parseFloat(R.sfx.value) || 0; saveSet(); badges(); });
}

/* ---------- boot: checkpoints are real events, not fake numbers ---------- */
function init() {
  R.barfill = $('w3barfill'); R.loadpct = $('w3loadpct'); R.loadmsg = $('w3loadmsg'); R.loaderr = $('w3loaderr'); R.loadbtns = $('w3loadbtns');
  R.load = $('w3load'); R.wrap = $('w3wrap'); R.cv = $('w3cv'); R.bal = $('w3bal'); R.who = $('w3who'); R.count = $('w3count');
  R.prompt = $('w3prompt'); R.use = $('w3use'); R.fade = $('w3fade');
  R.dlg = $('w3dlg'); R.dlgname = $('w3dlgname'); R.dlgtext = $('w3dlgtext'); R.dlgnext = $('w3dlgnext');
  R.menu = $('w3menu'); R.menulist = $('w3menulist'); R.menubal = $('w3menubal'); R.menures = $('w3menures');
  R.ward = $('w3ward'); R.wardres = $('w3wardres'); R.hue = $('w3hue'); R.hueval = $('w3hueval'); R.ward_hat = $('w3ward_hat'); R.ward_hair = $('w3ward_hair'); R.ward_acc = $('w3ward_acc'); R.games = $('w3games');
  R.quiz = $('w3quiz'); R.quizq = $('w3quizq'); R.quizchoices = $('w3quizchoices'); R.quizres = $('w3quizres'); R.map = $('w3map'); R.mapcv = $('w3mapcv'); R.mapseen = $('w3mapseen');
  R.toast = $('w3toast'); R.act = $('w3act'); R.conn = $('w3conn'); R.camh = $('w3camh'); R.conflict = $('w3conflict'); R.reclaim = $('w3reclaim'); R.confback = $('w3confback'); R.joy = $('w3joy'); R.knob = $('w3knob'); R.joyzone = $('w3joyzone');
  R.jump = $('w3jump'); R.sprint = $('w3sprint'); R.setbtn = $('w3setbtn'); R.set = $('w3set'); R.setclose = $('w3setclose');
  R.sens = $('w3sens'); R.camd = $('w3camd'); R.gfxsel = $('w3gfxsel'); R.shadow = $('w3shadow'); R.snd = $('w3snd'); R.vol = $('w3vol'); R.sfx = $('w3sfx');
  R.viewsel = $('w3viewsel'); R.fov = $('w3fov'); R.bob = $('w3bob');

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
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 900);
  clock = new THREE.Clock();
  setLoad(38, 'BUILDING_WORLD'); // checkpoint: renderer + WebGL context live

  buildWorld();
  const mine = makeAvatar(null);
  meEntry = { g: mine, st: mySt };
  attachRig(meEntry, 260);
  mine.position.set(px, 0, pz);
  scene.add(mine); scene.userData.meGroup = mine;
  applyGfx();
  setLoad(60, 'INITIALIZING_PLAYER'); // checkpoint: world built, avatar spawned

  R.cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stopLoop(); loadError('the WebGL context was lost (gpu hiccup or too many tabs). tap retry to re-enter.'); }, false);
  R.cv.addEventListener('webglcontextrestored', () => { toast('context restored'); if (!raf && !disposed) raf = requestAnimationFrame(loop); }, false);

  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  window.addEventListener('resize', onResize); window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', () => { if (!sessionConflict) { try { navigator.sendBeacon && navigator.sendBeacon('/api/world3d/leave', new Blob(['{}'], { type: 'application/json' })); } catch (e) { } } cleanup(); });
  bindInput();
  bindSettings();
  // v580 a11y: Escape closes the topmost open surface and returns
  // focus to the control that opened it. Close paths are the same
  // functions the X buttons already call — no new state.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      // v582 a11y: trap Tab inside the topmost open panel (same
      // priority order as Escape below). No panel open = no trap.
      const p = topPanel(); if (!p) return;
      const f = [...p.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])')].filter((el) => el.getClientRects().length);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!p.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key !== 'Escape') return;
    if (R.set && !R.set.hidden) { R.set.hidden = true; R.setbtn.classList.remove('on'); R.setbtn.focus(); return; }
    if (mapOpen) { closeMap(); const mb2 = document.getElementById('w3mapbtn'); if (mb2) mb2.focus(); return; }
    if (quizOpen) { closeQuiz(); return; }
    if (gamesOpen) { closeGames(); return; }
    if (wardOpen) { closeWardrobe(false); return; }
    if (menuOpen) { closeMenu(); return; }
    if (dlgOpen) { dlgOpen = false; R.dlg.hidden = true; }
  });
  R.act.addEventListener('click', goBack);

  setLoad(72, 'INITIALIZING_CONTROLS'); // checkpoint: input + settings bound
  if (R.reclaim) R.reclaim.addEventListener('click', reclaimSession);
  if (R.confback) R.confback.addEventListener('click', () => { location.href = '/world'; });

  // CONNECTING: the initial handshake must return a validated response
  // (HTTP ok + JSON + ok:true) before the render loop starts, and READY
  // additionally waits for the first rendered frame. a failed handshake
  // lands on the error screen — progress is never faked.
  setLoad(84, 'CONNECTING');
  ping().then((hs) => {
    if (window.__w3fatal) return; // auth failure already surfaced by ping()
    if (!hs.ok) {
      if (hs.kind === 'takeover') { raf = requestAnimationFrame(loop); return; } // frozen world renders behind the conflict card
      loadError('could not reach the world server (' + hs.err + '). check ur connection, then retry.');
      return;
    }
    handshakeOk = true;
    raf = requestAnimationFrame(loop); // first frame completes the load at READY
  });
}

try { init(); } catch (e) { loadError('the 3d engine hit an error: ' + (e && e.message ? e.message : e)); }
