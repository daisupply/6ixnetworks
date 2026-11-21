/* six's network — client engine. a big walkable world: districts, a lake,
   a pine forest, neon market, moon shards, quests, emotes, proximity VC. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
var lerp = function (a, b, k) { return a + (b - a) * k; };
var dist = function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); };
var TAU = Math.PI * 2;

var MAP_W = 6400, MAP_H = 7600;
var FOUNTAIN = { x: 2400, y: 1500 };
var LAKE = { x1: 1480, y1: 2260, x2: 3320, y2: 2940 };
var PIER = { x1: 2352, y1: 2240, x2: 2448, y2: 2580 };
var PORTALS = [
  { id: 'games', label: 'the arcade', sub: 'games', href: '/gs', x: 1780, y: 1215, c: '#a78bfa' },
  { id: 'movies', label: 'the theater', sub: 'movies', href: '/movies', x: 3020, y: 1215, c: '#f472b6' },
  { id: 'blox', label: 'blox tower', sub: 'roblox', href: '/blox', x: 2400, y: 1120, c: '#f0abfc' },
  { id: 'chat', label: 'chat lounge', sub: '6ixchat', href: '/chat', x: 1710, y: 1500, c: '#34d399' },
  { id: 'party', label: 'party house', sub: 'watch together', href: '/party', x: 3090, y: 1500, c: '#facc15' },
  { id: 'yt', label: 'tube corner', sub: '6ixtube', href: '/yt', x: 1780, y: 1800, c: '#fb7185' },
  { id: 'tiktok', label: 'tiktok wall', sub: 'tiktok', href: '/tiktok', x: 3020, y: 1800, c: '#7dd3fc' },
  { id: 'music', label: 'the stage', sub: 'music', href: '/music', x: 2400, y: 1905, c: '#38bdf8' }
];
var FXC = {
  '': { c: '#ffffff', g: 0 }, glow: { c: '#c9b8ff', g: 1 }, ghost: { c: '#e8f6ff', g: 0 },
  frost: { c: '#a5f3fc', g: 1 }, toxic: { c: '#bef264', g: 1 }, grad: { c: '#f0abfc', g: 1 },
  sunset: { c: '#fdba74', g: 1 }, fire: { c: '#fb923c', g: 1 }, gold: { c: '#ffd257', g: 1 },
  glitch: { c: '#f471b5', g: 1 }, rain: { c: '#7dd3fc', g: 1 }, galaxy: { c: '#c4b5fd', g: 1 }
};

/* seeded scatter: same world for every visitor */
function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
var srnd = mulberry(612496);
var LAMPS = [];
for (var lx = 350; lx <= 4450; lx += 560) for (var ly = 320; ly <= 2750; ly += 520) {
  if (dist(lx, ly, FOUNTAIN.x, FOUNTAIN.y) < 190) continue;
  if (lx > LAKE.x1 - 60 && lx < LAKE.x2 + 60 && ly > LAKE.y1 - 60 && ly < LAKE.y2 + 60) continue;
  LAMPS.push({ x: lx + ((ly % 1040 === 320) ? 140 : -60), y: ly, ph: srnd() * TAU });
}
var LAMP_PAIRS = [];
for (var li = 0; li < LAMPS.length; li++) for (var lj = li + 1; lj < LAMPS.length; lj++) {
  if (dist(LAMPS[li].x, LAMPS[li].y, LAMPS[lj].x, LAMPS[lj].y) < 660) LAMP_PAIRS.push([LAMPS[li], LAMPS[lj]]);
}
var TREES = [];
function treePatch(cx0, cy0, r, n) {
  for (var i = 0; i < n; i++) {
    var a = srnd() * TAU, d = Math.sqrt(srnd()) * r;
    var x = cx0 + Math.cos(a) * d, y = cy0 + Math.sin(a) * d * 0.82;
    TREES.push({ x: x, y: y, s: 0.8 + srnd() * 0.55, ph: srnd() * TAU });
  }
}
treePatch(650, 2100, 430, 54);
treePatch(700, 900, 240, 15);
for (var ti = 0; ti < 16; ti++) {
  var tx0 = 200 + srnd() * 4400, ty0 = 200 + srnd() * 2600;
  if (dist(tx0, ty0, FOUNTAIN.x, FOUNTAIN.y) < 560) continue;
  if (tx0 > LAKE.x1 - 40 && tx0 < LAKE.x2 + 40 && ty0 > LAKE.y1 - 40 && ty0 < LAKE.y2 + 40) continue;
  if (dist(tx0, ty0, 3950, 1600) < 300) continue;
  TREES.push({ x: tx0, y: ty0, s: 0.85 + srnd() * 0.5, ph: srnd() * TAU });
}
var STALLS = [];
(function () {
  var cols = ['#f472b6', '#a78bfa', '#38bdf8', '#ffd257', '#34d399', '#fb7185'];
  var k = 0;
  for (var sx = 3700; sx <= 4200; sx += 125) { STALLS.push({ x: sx, y: 1445, c: cols[k++ % 6] }); STALLS.push({ x: sx, y: 1755, c: cols[k++ % 6] }); }
})();
var ROCKS = [];
for (var ri = 0; ri < 12; ri++) ROCKS.push({ x: 3560 + srnd() * 820, y: 240 + srnd() * 520, r: 10 + srnd() * 22, ph: srnd() * TAU });
var FLOWERS = [];
for (var fi2 = 0; fi2 < 130; fi2++) {
  var fa = srnd() * TAU, fd = Math.sqrt(srnd()) * 300;
  FLOWERS.push({ x: 700 + Math.cos(fa) * fd, y: 900 + Math.sin(fa) * fd * 0.8, c: ['#f9a8d4', '#c4b5fd', '#fde68a', '#a5f3fc'][fi2 % 4], ph: srnd() * TAU });
}
/* ---- v507 districts: doors, sky pads, neon buildings, cave decor ---- */
var DOORS = [
  { id: 'arcade-in', x: 5600, y: 1680, label: 'enter the underground arcade' },
  { id: 'arcade-out', x: 5650, y: 3600, label: 'back to the neon district' },
  { id: 'sky-up', x: 5650, y: 640, label: 'climb to the sky islands' },
  { id: 'sky-down', x: 5650, y: 430, label: 'back to the rooftops' },
  { id: 'vault-in', x: 2100, y: 3980, label: 'slip into the vault' },
  { id: 'vault-out', x: 5300, y: 3970, label: 'back to the caves' }
];
var SKY_PADS = [
  { x: 5650, y: 430, rx: 150, ry: 64 }, { x: 5400, y: 380, rx: 120, ry: 52 },
  { x: 5200, y: 250, rx: 140, ry: 60 }, { x: 5650, y: 180, rx: 150, ry: 62 },
  { x: 6150, y: 300, rx: 140, ry: 60 }
];
var SKY_BRIDGES = [[5650, 430, 5400, 380], [5400, 380, 5200, 250], [5200, 250, 5650, 180], [5650, 180, 6150, 300], [6150, 300, 5650, 430]];
var SKYSTARS = [];
for (var ss = 0; ss < 80; ss++) SKYSTARS.push({ x: 4900 + srnd() * 1460, y: 80 + srnd() * 380, ph: srnd() * TAU });
var BUILDINGS = [];
(function () {
  var cols = ['#f472b6', '#38bdf8', '#a78bfa', '#ffd257', '#34d399'];
  [{ x: 4980, w: 300 }, { x: 5980, w: 320 }].forEach(function (rw, ri) {
    var k = 0;
    for (var by = 700; by <= 1380; by += 235) {
      BUILDINGS.push({ x: rw.x, y: by, w: rw.w, h: 170 + Math.floor(srnd() * 40), c: cols[(ri * 3 + k++) % 5], sd: srnd() * 100 });
    }
  });
})();
var CRYSDECOR = [];
for (var cd = 0; cd < 46; cd++) CRYSDECOR.push({ x: 260 + srnd() * 2100, y: 3160 + srnd() * 960, s: 3 + srnd() * 6, c: ['#67e8f9', '#c4b5fd', '#f0abfc'][cd % 3], ph: srnd() * TAU });
var CAVEROCKS = [];
for (var cr = 0; cr < 14; cr++) CAVEROCKS.push({ x: 260 + srnd() * 2100, y: 3160 + srnd() * 960, r: 14 + srnd() * 30 });
var SUNKENREEDS = [];
for (var sr2 = 0; sr2 < 60; sr2++) SUNKENREEDS.push({ x: 2480 + srnd() * 2280, y: 3160 + srnd() * 960, h: 8 + srnd() * 10, ph: srnd() * TAU });
var EASTROCKS = [];
for (var er = 0; er < 10; er++) EASTROCKS.push({ x: 5000 + srnd() * 1200, y: 2000 + srnd() * 1000, r: 10 + srnd() * 22 });
var BENCHES = [{ x: 2255, y: 1575 }, { x: 2545, y: 1575 }, { x: 2255, y: 1425 }, { x: 2545, y: 1425 }];
var BOARD = { x: 2620, y: 1390 };
[[5500, 800], [5800, 800], [5500, 1150], [5800, 1150], [5500, 1500], [5800, 1500], [2500, 3250], [3600, 3250], [4800, 3250]].forEach(function (lp) { LAMPS.push({ x: lp[0], y: lp[1], ph: srnd() * TAU }); });

var OBS = [{ x: FOUNTAIN.x, y: FOUNTAIN.y, r: 74 }];
TREES.forEach(function (t) { OBS.push({ x: t.x, y: t.y, r: 15 }); });
STALLS.forEach(function (s) { OBS.push({ x: s.x, y: s.y, r: 30 }); });
BUILDINGS.forEach(function (b) { OBS.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2.2 }); });
BENCHES.forEach(function (b) { OBS.push({ x: b.x, y: b.y, r: 16 }); });

function hueOf(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; }
function tileShade(x, y) { var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }

/* ---------------- tiny synth ---------------- */
var AC = null;
function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function tone(f, t0, dur, type, vol, slide) {
  var a = ac(); if (!a) return;
  var o = a.createOscillator(), g = a.createGain(), t = a.currentTime + t0;
  o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * SET.vol * (SET.sfx ? 1 : 0), t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
}
var sndPick = function (gold) { if (gold) { tone(880, 0, .18, 'sine', .16); tone(1174, .07, .2, 'sine', .16); tone(1568, .14, .3, 'sine', .15); } else { tone(988, 0, .12, 'sine', .13, 1318); } };
var sndQuest = function () { tone(523, 0, .14, 'triangle', .15); tone(659, .1, .14, 'triangle', .15); tone(784, .2, .16, 'triangle', .15); tone(1046, .3, .3, 'triangle', .16); };
var sndPortal = function () { tone(392, 0, .3, 'sine', .12, 784); };
var sndPop = function () { tone(660, 0, .07, 'square', .05, 520); };
var sndDash = function () { tone(300, 0, .16, 'sawtooth', .04, 620); };

/* ---------------- state ---------------- */
var cv = $('wcv'), cx2 = cv.getContext('2d');
var mapCv = $('wmap'), mapCx = mapCv ? mapCv.getContext('2d') : null;
var VW = 0, VH = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
}
window.addEventListener('resize', resize); resize();

var me = '', started = false;
var px = 2400, py = 1700, vx = 0, vy = 0, dir = 1.2, moving = false;
var keys = {};
var joy = { id: null, x: 0, y: 0 };
var cam = { x: 2400, y: 1700 };
var players = {};
var shards = {};
var meteors = {}, TREASURE_V = null;
var crys = {};
var parts = [];
var floats = [];
var fires = [];
for (var fi = 0; fi < 110; fi++) fires.push({ x: Math.random() * MAP_W, y: Math.random() * MAP_H, s: Math.random() * TAU, v: 4 + Math.random() * 9 });
var myEmote = '', myEmoteTs = 0;
var pendingClaim = '', claimAt = 0;
var insidePad = '';
var myZone = '', zoneSeen = false;
var wactMode = '';
var wactLabelShown = '';
var nearDoorId = '';
var dashUntil = 0, dashCd = 0, dashDir = 0;
var lastBub = {};
var moveTarget = null;
var goldKnown = {};
var questSig = '';

/* ---------------- net ---------------- */
function jpost(url, body) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then(function (r) { return r.json(); }).catch(function () { return null; });
}
function toast(msg, ms) {
  var t = $('wtoast'); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._h);
  toast._h = setTimeout(function () { t.hidden = true; }, ms || 3400);
}
function logLine(u, text) {
  var log = $('wlog'); if (!log) return;
  var d = document.createElement('div');
  var b = document.createElement('b'); b.textContent = u + ' ';
  var fxc = FXC[(players[u] && players[u].fx) || ''] || FXC[''];
  b.style.color = fxc.c;
  d.appendChild(b); d.appendChild(document.createTextNode(text));
  log.appendChild(d);
  while (log.children.length > 5) log.removeChild(log.firstChild);
  setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 9200);
}
function burst(x, y, color, n, spd) {
  for (var i = 0; i < n; i++) {
    var a = Math.random() * TAU, s = (0.3 + Math.random() * 0.7) * (spd || 90);
    parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, at: performance.now(), life: 520 + Math.random() * 380, c: color, r: 1.6 + Math.random() * 2.2 });
  }
}
function floatText(x, y, text, color) { floats.push({ x: x, y: y, text: text, c: color, at: performance.now() }); }

/* ---------------- voice chat ---------------- */
var vcOn = false, talkNow = false, localStream = null, localAn = null, vcCtx = null;
var peers = {};
var vcRetry = {};
var RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }].concat(window.WICE || []) };
var MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
var MIC_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
$('wdash').innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z"/></svg>';
$('wemotebtn').innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.15" fill="currentColor" stroke="none"/><path d="M8 14.5c1.2 1.4 2.5 2 4 2s2.8-.6 4-2" stroke-linecap="round"/></svg>';
var emotePopTimer = 0;
$('wemotebtn').addEventListener('click', function () {
  var pop = $('wemotes');
  pop.hidden = !pop.hidden;
  clearTimeout(emotePopTimer);
  if (!pop.hidden) emotePopTimer = setTimeout(function () { pop.hidden = true; }, 5000);
});
$('wmic').innerHTML = MIC_OFF;

function vcSend(to, data) { jpost('/api/world/signal', { to: to, data: data }); }
function closePeer(u) {
  var p = peers[u]; if (!p) return;
  try { p.pc.close(); } catch (e) { }
  try { p.gain.disconnect(); } catch (e) { }
  delete peers[u];
}
function ensurePeer(u, initiator) {
  if (peers[u] || u === me) return;
  if (vcRetry[u] && Date.now() < vcRetry[u]) return;
  if (!vcCtx) { try { vcCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
  if (vcCtx && vcCtx.state === 'suspended') vcCtx.resume();
  var pc;
  try { pc = new RTCPeerConnection(RTC_CFG); } catch (e) { return; }
  var gain = null;
  if (vcCtx) { gain = vcCtx.createGain(); gain.gain.value = 0; gain.connect(vcCtx.destination); }
  peers[u] = { pc: pc, gain: gain, iceQ: [], remoteSet: false };
  if (localStream) localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
  else pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onicecandidate = function (e) { if (e.candidate) vcSend(u, { t: 'ice', c: e.candidate }); };
  pc.ontrack = function (e) {
    if (!vcCtx || !peers[u]) return;
    try { var ms = (e.streams && e.streams[0]) || new MediaStream([e.track]); vcCtx.createMediaStreamSource(ms).connect(peers[u].gain); } catch (err) { }
  };
  pc.onconnectionstatechange = function () {
    if (pc.connectionState === 'failed') { vcRetry[u] = Date.now() + 6000; closePeer(u); }
    else if (pc.connectionState === 'closed') closePeer(u);
    else if (pc.connectionState === 'connected') delete vcRetry[u];
  };
  if (initiator) {
    pc.onnegotiationneeded = function () {
      pc.createOffer().then(function (of) { return pc.setLocalDescription(of); })
        .then(function () { vcSend(u, { t: 'offer', sdp: pc.localDescription }); }).catch(function () { });
    };
  }
}
function flushIce(p) {
  p.remoteSet = true;
  var q = p.iceQ || []; p.iceQ = [];
  q.forEach(function (c) { try { var pr = p.pc.addIceCandidate(new RTCIceCandidate(c)); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { } });
}
function handleSignal(from, data) {
  if (!data || !vcOn) return;
  if (data.t === 'offer') {
    ensurePeer(from, false);
    var p = peers[from]; if (!p) return;
    p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(function () { flushIce(p); return p.pc.createAnswer(); })
      .then(function (an) { return p.pc.setLocalDescription(an); })
      .then(function () { vcSend(from, { t: 'answer', sdp: p.pc.localDescription }); })
      .catch(function () { });
  } else if (data.t === 'answer') {
    var p2 = peers[from]; if (p2) p2.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () { flushIce(p2); }).catch(function () { });
  } else if (data.t === 'ice') {
    var p3 = peers[from]; if (p3 && data.c) { if (p3.remoteSet) p3.pc.addIceCandidate(new RTCIceCandidate(data.c)).catch(function () { }); else p3.iceQ.push(data.c); }
  }
}
function vcTick(roster) {
  if (!vcOn) return;
  if (vcCtx && vcCtx.state === 'suspended') vcCtx.resume();
  var want = {};
  for (var i = 0; i < roster.length; i++) {
    var p = roster[i];
    if (!p || p.u === me || p.npc || !p.vc) continue;
    var d = dist(px, py, p.x, p.y);
    if (d < 360) want[p.u] = d;
  }
  Object.keys(want).forEach(function (u) { ensurePeer(u, me < u); });
  Object.keys(peers).forEach(function (u) {
    if (want[u] == null) { closePeer(u); return; }
    var pr = peers[u];
    if (pr && pr.gain) { var g = Math.pow(clamp(1 - want[u] / 360, 0, 1), 1.4); pr.gain.gain.setTargetAtTime(g, vcCtx.currentTime, 0.08); }
  });
}
function talkLoop() {
  if (!localAn) { talkNow = false; return; }
  var buf = new Uint8Array(localAn.fftSize);
  localAn.getByteTimeDomainData(buf);
  var sum = 0;
  for (var i = 0; i < buf.length; i += 4) { var v = (buf[i] - 128) / 128; sum += v * v; }
  talkNow = Math.sqrt(sum / (buf.length / 4)) > 0.045;
  $('wmic').classList.toggle('live', vcOn && talkNow);
}
setInterval(talkLoop, 180);

$('wmic').addEventListener('click', function () {
  ac();
  if (vcOn) {
    vcOn = false;
    if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
    localAn = null;
    Object.keys(peers).forEach(closePeer);
    $('wmic').innerHTML = MIC_OFF; $('wmic').classList.remove('on', 'live');
    toast('voice off');
    return;
  }
  var done = function (stream) {
    localStream = stream || null;
    if (stream) {
      try {
        var a = ac(); var src = a.createMediaStreamSource(stream);
        localAn = a.createAnalyser(); localAn.fftSize = 512; src.connect(localAn);
      } catch (e) { }
    }
    vcOn = true;
    if (vcCtx && vcCtx.state === 'suspended') vcCtx.resume();
    $('wmic').innerHTML = MIC_SVG; $('wmic').classList.add('on');
    toast(stream ? 'voice on — walk up to someone to talk' : 'voice on (listen only — mic blocked)');
  };
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(done).catch(function () { done(null); });
  } else done(null);
});

/* ---------------- input ---------------- */
function tryDash() {
  var now = performance.now();
  if (now < dashCd || now < dashUntil) return;
  var ix = 0, iy = 0;
  if (keys['w'] || keys['arrowup']) iy -= 1;
  if (keys['s'] || keys['arrowdown']) iy += 1;
  if (keys['a'] || keys['arrowleft']) ix -= 1;
  if (keys['d'] || keys['arrowright']) ix += 1;
  if (joy.id !== null) { ix += joy.x; iy += joy.y; }
  var m = Math.sqrt(ix * ix + iy * iy);
  if (m < 0.2) { ix = Math.cos(dir); iy = Math.sin(dir); m = 1; }
  dashDir = Math.atan2(iy / m, ix / m);
  dashUntil = now + 300;
  dashCd = now + 1500;
  sndDash();
}
window.addEventListener('keydown', function (e) {
  if (document.activeElement === $('win')) { if (e.key === 'Escape') $('win').blur(); return; }
  if (window.__mgOpen) return;
  var k = e.key.toLowerCase();
  keys[k] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
  if (k === ' ') tryDash();
  if (k === 'enter') {
    if (insidePad) enterPortal(insidePad);
    else { $('win').focus(); }
  }
  var ems = { '1': 'wave', '2': 'dance', '3': 'spin', '4': 'heart', '5': 'dead' };
  if (ems[k]) doEmote(ems[k]);
});
window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
function doEmote(em) {
  var ep = $('wemotes'); if (ep) ep.hidden = true;
  myEmote = em; myEmoteTs = Date.now();
  if (players[me]) { players[me].emote = em; players[me].emoteAt = performance.now(); }
  if (em === 'heart') burst(px, py - 18, '#f472b6', 8, 60);
}
Array.prototype.forEach.call(document.querySelectorAll('#wemotes button'), function (b) {
  b.addEventListener('click', function () { doEmote(b.getAttribute('data-em')); });
});
$('wbar').addEventListener('submit', function (e) {
  e.preventDefault();
  var inp = $('win'), text = inp.value.trim();
  if (!text) { inp.blur(); return; }
  inp.value = '';
  sndPop();
  if (players[me]) { players[me].bub = text; players[me].bubAt = performance.now(); }
  logLine(me, text);
  jpost('/api/world/say', { text: text }).then(function (r) {
    if (r && r.questDone) onQuestDone(r.questDone);
    if (r && r.quest) renderQuest(r.quest);
  });
  inp.blur();
});
function enterPortal(pad) {
  sndPortal();
  burst(px, py, pad.c, 16, 120);
  jpost('/api/world/portal', { id: pad.id });
  setTimeout(function () { location.href = pad.href; }, 160);
}
$('wportal').addEventListener('click', function () { if (insidePad) enterPortal(insidePad); });
$('wact').addEventListener('click', function () {
  if (wactMode === 'shop') { openShop(); return; }
  if (wactMode === 'cab') { openArcade(); return; }
  if (wactMode === 'door') {
    jpost('/api/world/door', { id: nearDoorId }).then(function (r) {
      if (!r || !r.ok) { toast((r && r.err) || 'the door said no'); return; }
      px = r.x; py = r.y; vx = 0; vy = 0; moveTarget = null; cam.x = px; cam.y = py;
      sndPortal(); burst(px, py, '#a78bfa', 18, 120);
    });
    return;
  }
  if (wactMode === 'vault') {
    jpost('/api/world/vault-claim', {}).then(function (r) {
      if (!r || !r.ok) { toast((r && r.err) || 'not yet'); return; }
      myInv = r.inv || myInv;
      sndQuest(); burst(px, py - 10, '#ffd257', 34, 160);
      floatText(px, py - 46, 'VAULT CROWN', '#ffd257');
      toast('\u2726 u claimed the vault crown — equip it from the shop, hats tab', 4600);
    });
    return;
  }
    if (wactMode === 'bstrike') { bossHit(); return; }
  if (wactMode === 'dstrike') { var ns2 = nearestShade(); if (ns2) dunHit(ns2.id); return; }
  if (wactMode === 'crypt') { jpost('/api/world/dungeon-enter', {}).then(function (r) { if (r && r.ok && r.x) { px = r.x; py = r.y; vx = 0; vy = 0; moveTarget = null; cam.x = px; cam.y = py; sndPortal(); burst(px, py, '#a78bfa', 16, 110); } else if (!r || !r.ok) toast((r && r.err) || 'the gate wont open'); }); return; }
  if (wactMode === 'cryptexit') { cryptExitWanted = true; jpost('/api/world/dungeon-exit', {}).then(function (r) { if (r && r.ok && r.x) { px = r.x; py = r.y; vx = 0; vy = 0; moveTarget = null; cam.x = px; cam.y = py; sndPortal(); } setTimeout(function () { cryptExitWanted = false; }, 5000); }); return; }
  if (wactMode === 'reel') { reelLine(); return; }
    if (wactMode === 'waitfish') { clearFishing(); jpost('/api/world/fish-reel', {}).catch(function () {}); return; }
    if (wactMode === 'fish') { if (myWearIds.rod) castLine(); else openFish(); return; }
    if (wactMode === 'house') { enterHouse(me); return; }
  if (wactMode === 'hexit') { exitHouse(); return; }
  if (wactMode !== 'wish') return;
  jpost('/api/world/wish', {}).then(function (r) {
    if (!r) return;
    if (!r.ok) { toast(r.err || 'the fountain said no'); return; }
    if (r.jackpot) {
      sndQuest();
      burst(px, py - 10, '#ffd257', 34, 160);
      floatText(px, py - 46, 'JACKPOT +50¢', '#ffd257');
      toast('✦ THE FOUNTAIN PAID OUT — jackpot! ' + r.fortune, 5200);
    } else {
      sndPick(false);
      burst(px, py - 8, '#a5f3fc', 10, 80);
      toast('✦ ' + r.fortune, 4200);
    }
  });
});

/* joystick + dash button */
var joyEl = $('wjoy'), knob = $('wknob');
function joyPos(e) {
  var r = joyEl.getBoundingClientRect();
  var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  var m = Math.sqrt(dx * dx + dy * dy), max = r.width / 2 - 6;
  if (m > max) { dx = dx / m * max; dy = dy / m * max; }
  knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
  joy.x = dx / max; joy.y = dy / max;
}
joyEl.addEventListener('pointerdown', function (e) { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyEl.classList.add('on'); joyPos(e); ac(); });
joyEl.addEventListener('pointermove', function (e) { if (joy.id === e.pointerId) joyPos(e); });
function joyEnd(e) { if (joy.id === e.pointerId) { joy.id = null; joy.x = 0; joy.y = 0; knob.style.transform = 'translate(-50%,-50%)'; } }
joyEl.addEventListener('pointerup', joyEnd);
joyEl.addEventListener('pointercancel', joyEnd);
if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) joyEl.classList.add('on');
if ($('wdash')) $('wdash').addEventListener('click', function () { tryDash(); });
cv.addEventListener('pointerdown', function (e) {
  ac();
  if (decorOn && myHouse === me) { decorTap(e); return; }
  var cp = camPos();
  var wx = e.clientX + cp.x, wy = e.clientY + cp.y;
  if (BOSS_V && !BOSS_V.dead && dist(wx, wy, BOSS_V.x, BOSS_V.y) < 82) { bossHit(); return; }
  if (INST_V) { var shHit = null; INST_V.shades.forEach(function (s) { if (dist(wx, wy, s.x, s.y) < 52) shHit = s; }); if (shHit) { dunHit(shHit.id); return; } }
  var tapped = null;
  for (var ku in players) {
    var op = players[ku];
    if (!op || op.u === me || op.npc) continue;
    if (dist(wx, wy, op.x, op.y) < 36) { tapped = op; break; }
  }
  if (tapped) { openProfile(tapped.u); return; }
  for (var pu3 in pets) {
    var pt3 = pets[pu3];
    if (pt3 && dist(wx, wy, pt3.x, pt3.y) < 26) {
      if (pu3 === me) { burst(pt3.x, pt3.y - 6, '#f472b6', 10, 60); tone(1180, 0, .09, 'sine', .1, 1560); floatText(pt3.x, pt3.y - 26, pt3.name ? '\u2665 ' + pt3.name : '\u2665 ur buddy', '#f9a8d4'); }
      else floatText(pt3.x, pt3.y - 26, (pt3.name || pt3.kind) + ' \u00b7 @' + pu3, '#e9e4ff');
      return;
    }
  }
  moveTarget = { x: clamp(wx, 30, MAP_W - 30), y: clamp(wy, 30, MAP_H - 30), at: performance.now() };
}, { passive: true });

/* ---------------- HUD ---------------- */
function renderQuest(q) {
  var el = $('wquest'); if (!el || !q) return;
  var sig = q.t + '|' + q.prog + '|' + q.chain;
  if (sig === questSig) return;
  questSig = sig;
  el.hidden = false;
  el.querySelector('.wq-t').textContent = q.story ? ('\u2726 story ' + q.step + '/6: ' + q.t) : ('\u2726 quest: ' + q.t);
  el.querySelector('.wq-bar i').style.width = Math.round(100 * q.prog / Math.max(1, q.n)) + '%';
  el.querySelector('.wq-s').textContent = q.prog + ' / ' + q.n + ' · pays ¢' + q.pay + (q.chain ? ' · chain ×' + (q.chain + 1) : '');
}
function renderLb(lb, today) {
  var el = $('wlb'); if (!el) return;
  if (!lb || !lb.length) { el.hidden = true; return; }
  el.hidden = false;
  var h = '<div class="lb-h">shard hunters today</div>';
  for (var i = 0; i < lb.length; i++) h += '<div>' + (i + 1) + '. <b>' + lb[i].u + '</b> — ' + lb[i].n + '</div>';
  if (today) h += '<div style="margin-top:3px;color:#c9b8ff">u: ' + today.shards + ' shards' + (today.golds ? ' · ' + today.golds + ' gold' : '') + '</div>';
  el.innerHTML = h;
}
function onQuestDone(qd) {
  if (!qd) return;
  sndQuest();
  toast('✦ quest done: ' + qd.t + ' — +' + qd.pay + ' six cents');
  burst(px, py - 10, '#ffd257', 26, 140);
  floatText(px, py - 44, '+¢' + qd.pay, '#ffd257');
}

/* ---------------- sync loop ---------------- */
function ping() {
  if (!started) return;
  var body = { x: Math.round(px), y: Math.round(py), dir: dir, vc: vcOn, talk: talkNow, emote: myEmote, emoteTs: myEmoteTs };
  if (pendingClaim) { body.claim = pendingClaim; }
  jpost('/api/world/ping', body).then(function (r) {
    if (!r || !r.ok) return;
    $('wn').textContent = r.n + ' online';
    if (r.bal != null) setCentsBal(r.bal);
    if (r.inv) myInv = r.inv;
    if (r.wearIds) myWearIds = r.wearIds;
    if (window.__shopOpen) renderShopGrid();
    var seen = {};
    (r.players || []).forEach(function (p) {
      seen[p.u] = 1;
      if (mutedSet[p.u]) p.bub = '';
      var cur = players[p.u];
      if (!cur) {
        players[p.u] = { u: p.u, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir, fx: p.fx, vc: p.vc, talk: p.talk, bub: '', bubAt: 0, emote: '', emoteAt: 0, npc: !!p.npc, wear: p.wear || null, hue: (p.hue != null ? p.hue : null), petName: p.petName || '', gtag: p.gtag || '' };
        cur = players[p.u];
      }
      cur.tx = p.x; cur.ty = p.y; cur.dir = p.dir; cur.fx = p.fx; cur.vc = p.vc; cur.talk = p.talk; cur.npc = !!p.npc; cur.wear = p.wear || null; cur.hue = (p.hue != null ? p.hue : null); cur.petName = p.petName || ''; cur.gtag = p.gtag || '';
      if (p.bub && p.bub !== cur.bub) {
        cur.bub = p.bub; cur.bubAt = performance.now();
        if (p.u !== me && !p.npc && lastBub[p.u] !== p.bub && dist(px, py, p.x, p.y) < 460) { lastBub[p.u] = p.bub; logLine(p.u, p.bub); }
      }
      if (!p.bub) cur.bub = '';
      if (p.emote && p.emote !== cur.emote) { cur.emote = p.emote; cur.emoteAt = performance.now(); }
      if (!p.emote) cur.emote = '';
    });
    Object.keys(players).forEach(function (u) { if (!seen[u] && u !== me) delete players[u]; });
    var sSeen = {};
    (r.shards || []).forEach(function (s) {
      sSeen[s.id] = 1;
      if (!shards[s.id]) {
        shards[s.id] = { x: s.x, y: s.y, gold: !!s.gold, seed: Math.random() * TAU };
        if (s.gold && !goldKnown[s.id]) { goldKnown[s.id] = 1; toast('✦ a GOLDEN shard just dropped — 25 six cents, first one there'); }
      }
    });
    Object.keys(shards).forEach(function (id) { if (!sSeen[id]) delete shards[id]; });
    var cSeen = {};
    (r.crys || []).forEach(function (c) { cSeen[c.id] = 1; crys[c.id] = c; });
    Object.keys(crys).forEach(function (id) { if (!cSeen[id]) delete crys[id]; });
    if (r.gotC) {
      sndPick(true);
      burst(px, py - 8, '#f0abfc', 22, 130);
      floatText(px, py - 40, '+\u00a2' + r.gotC.amt, '#f0abfc');
      toast('\u2726 ' + r.gotC.rare + ' crystal found — +\u00a2' + r.gotC.amt, 3000);
    }
    meteors = {};
    (r.meteors || []).forEach(function (m) { meteors[m.x + ':' + m.y] = m; });
    TREASURE_V = r.treasure || null;
    if (r.gotM) { sndPick(true); burst(px, py - 8, '#fef3c7', 20, 120); floatText(px, py - 40, '+\u00a225 meteor', '#fef3c7'); }
    if (r.gotT) { sndQuest(); burst(px, py - 8, '#ffd257', 30, 150); floatText(px, py - 40, '+\u00a275 treasure', '#ffd257'); toast('\u2726 u found the hidden treasure \u2014 +\u00a275 + materials', 4200); }
    if (r.gotEvC) { sndQuest(); burst(px, py - 8, '#f0abfc', 26, 140); floatText(px, py - 40, '+\u00a2' + r.gotEvC.amt + ' event crystal', '#f0abfc'); }
    if (r.gotEvE) { sndQuest(); toast("\u2726 errand complete \u2014 +\u00a2" + r.gotEvE.amt, 3600); }
    if (r.evRes) { var er = r.evRes; var ENM = { derby: 'fishing derby', tourney: 'race tournament', community: 'community challenge', crystalhunt: 'crystal hunt', errand: "six's errand", lichsurge: 'lich surge', shardstorm: 'shard storm', goldenhunt: 'golden hunt', meteor: 'meteor shower', treasure: 'treasure hunt', doublexp: 'double xp' }; var enm = ENM[er.type] || er.type; if (er.type === 'community') toast(er.met ? '\u2726 community challenge complete \u2014 +\u00a260 for everyone who helped' : '\u2726 community challenge ended \u2014 goal missed this time', 5200); else if (er.prize > 0) toast('\u2726 u placed #' + er.place + ' in the ' + enm + ' \u2014 +\u00a2' + er.prize, 5200); else toast('\u2726 the ' + enm + ' wrapped up \u2014 thanks for playing', 4200); sndQuest(); }
    if (pendingClaim && !sSeen[pendingClaim]) pendingClaim = '';
    (r.sig || []).forEach(function (s) { handleSignal(s.from, s.data); });
    vcTick(r.players || []);
    if (r.got) {
      sndPick(r.got.gold);
      burst(px, py - 8, r.got.gold ? '#ffd257' : '#a5f3fc', r.got.gold ? 24 : 12, 110);
      floatText(px, py - 40, '+¢' + r.got.amt, r.got.gold ? '#ffd257' : '#a5f3fc');
      pendingClaim = '';
    }
    if (r.questDone) onQuestDone(r.questDone);
    if (r.dchal) MG.dchal = r.dchal;
    (r.dqDone || []).forEach(function (d) {
      sndQuest();
      toast((d.weekly ? '\u2726 WEEKLY quest done: ' : '\u2726 daily quest done: ') + d.t + ' \u2014 +\u00a2' + d.pay, 4400);
    });
    if (r.quest) renderQuest(r.quest);
    if (r.prog) renderProg(r.prog);
    if (r.disc) toast('discovered — ' + r.disc.zone + ' · +6 xp', 2600);
    if (r.achNew && r.achNew.length) r.achNew.forEach(function (a, i) { setTimeout(function () { toast('achievement — ' + a.name + ' · +\u00a2' + a.reward, 3400); sndQuest(); }, 350 * (i + 1)); });
    if (r.lvlUp) onLvlUp(r.lvlUp);
    duelTick(r);
    socialTick(r);
    renderLb(r.lb, r.today);
    if (typeof r.zone === 'string') {
      if (zoneSeen && r.zone && r.zone !== myZone) toast('— ' + r.zone + ' —', 1800);
      if (r.zone) myZone = r.zone;
      zoneSeen = true;
    }
  });
}
setInterval(ping, 900);

/* ---------------- update ---------------- */
function camPos() {
  var cx = clamp(cam.x - VW / 2, 0, Math.max(0, MAP_W - VW));
  var cy = clamp(cam.y - VH / 2, 0, Math.max(0, MAP_H - VH));
  if (VW >= MAP_W) cx = (MAP_W - VW) / 2;
  if (VH >= MAP_H) cy = (MAP_H - VH) / 2;
  return { x: cx, y: cy };
}
function inLake(x, y) { return x > LAKE.x1 && x < LAKE.x2 && y > LAKE.y1 && y < LAKE.y2; }
function onPier(x, y) { return x > PIER.x1 && x < PIER.x2 && y > PIER.y1 && y < PIER.y2; }
var lastT = performance.now();
function update(now) {
  var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  var ix = 0, iy = 0;
  if (moveTarget) {
    var tdx = moveTarget.x - px, tdy = moveTarget.y - py, td = Math.sqrt(tdx * tdx + tdy * tdy);
    if (td < 14) moveTarget = null;
    else { ix = tdx / td; iy = tdy / td; }
  }
  if (keys['w'] || keys['arrowup']) iy -= 1;
  if (keys['s'] || keys['arrowdown']) iy += 1;
  if (keys['a'] || keys['arrowleft']) ix -= 1;
  if (keys['d'] || keys['arrowright']) ix += 1;
  if (joy.id !== null || joy.x || joy.y) { ix += joy.x; iy += joy.y; }
  if (ix || iy) { if (keys['w'] || keys['a'] || keys['s'] || keys['d'] || keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'] || joy.id !== null) moveTarget = null; }
  if (window.__mgOpen) { ix = 0; iy = 0; }
  var m = Math.sqrt(ix * ix + iy * iy);
  if (m > 1) { ix /= m; iy /= m; }
  var dashing = now < dashUntil;
  var inWater = inLake(px, py) && !onPier(px, py);
  var mntIt2 = myWearIds.mount ? WBY[myWearIds.mount] : null;
  var flyM = !!(mntIt2 && (mntIt2.kind === 'cloud' || mntIt2.kind === 'dragonm'));
  var speed = dashing ? 660 : (mntIt2 ? (MOUNT_SPD[mntIt2.kind] || 350) : (keys['shift'] ? 372 : 258)) * ((inWater && !flyM) ? 0.72 : 1);
  if (FISHING && moving) clearFishing();
  if (dashing) { ix = Math.cos(dashDir); iy = Math.sin(dashDir); }
  var accel = dashing ? 4200 : 1500;
  vx += clamp(ix * speed - vx, -accel * dt, accel * dt);
  vy += clamp(iy * speed - vy, -accel * dt, accel * dt);
  if (!ix && Math.abs(vx) < 8) vx = 0;
  if (!iy && Math.abs(vy) < 8) vy = 0;
  px += vx * dt; py += vy * dt;
  moving = Math.abs(vx) + Math.abs(vy) > 24;
  if (moving) dir = Math.atan2(vy, vx);
  px = clamp(px, 30, MAP_W - 30); py = clamp(py, 30, MAP_H - 30);
  for (var oi = 0; oi < OBS.length; oi++) {
    var o = OBS[oi], od = dist(px, py, o.x, o.y);
    if (od < o.r + 12 && od > 0.01) { px = o.x + (px - o.x) / od * (o.r + 12); py = o.y + (py - o.y) / od * (o.r + 12); }
  }
  if (dashing && Math.random() < 0.75) {
    parts.push({ x: px - vx * 0.03 + (Math.random() * 14 - 7), y: py - vy * 0.03 + (Math.random() * 14 - 7), vx: -vx * 0.12, vy: -vy * 0.12, at: now, life: 330, c: '#a5f3fc', r: 2.4 });
  }
  Object.keys(players).forEach(function (u) {
    var p = players[u];
    if (p.wear && p.wear.trail) {
      var pmoving = u === me ? moving : dist(p.x, p.y, p.tx, p.ty) > 3;
      if (pmoving && Math.random() < 0.55) {
        parts.push({ x: p.x + (Math.random() * 10 - 5), y: p.y + 13 + Math.random() * 4, vx: 0, vy: 6, at: now, life: 620, c: p.wear.trail.c, r: 2.6, ts: p.wear.trail.kind });
      }
    }
    if (p.wear && p.wear.pet) {
      var pet = pets[u] || (pets[u] = { x: p.x, y: p.y - 30, kind: p.wear.pet.kind, c: p.wear.pet.c, hopSeed: Math.random() * 9, lx: p.x, ly: p.y, still: 0 });
      pet.kind = p.wear.pet.kind; pet.c = p.wear.pet.c; pet.rarity = p.wear.pet.rarity || ''; pet.name = p.petName || ''; pet.owner = u;
      var pMoved = dist(p.x, p.y, pet.lx || p.x, pet.ly || p.y);
      pet.still = pMoved > 4 ? 0 : (pet.still || 0) + dt;
      pet.lx = p.x; pet.ly = p.y;
      var FLYK = { orb: 1, star: 1, ghost: 1, bat: 1, ufo: 1, wisp: 1, dragon: 1 };
      var txp, typ;
      if (FLYK[pet.kind]) {
        var pa = now / 1500 + u.length * 1.7;
        txp = p.x + Math.cos(pa) * 30; typ = p.y - 30 + Math.sin(now / 600 + u.length) * 4;
        pet.hopY = 0;
      } else {
        var back = (p.dir || 0) + Math.PI;
        txp = p.x + Math.cos(back) * 27 + Math.sin(now / 900 + u.length) * 3;
        typ = p.y + 13 + Math.cos(now / 900 + u.length) * 2;
        var pd2 = dist(pet.x, pet.y, txp, typ);
        pet.hopY = (pet.still < 2.5 && pd2 > 7) ? -Math.abs(Math.sin(now / 95 + pet.hopSeed)) * 5.5 : 0;
      }
      var pk2 = Math.min(1, dt * (FLYK[pet.kind] ? 3.4 : 5.2));
      pet.x += (txp - pet.x) * pk2;
      pet.y += (typ - pet.y) * pk2;
      if (pet.rarity === 'legendary' && Math.random() < 0.10) parts.push({ x: pet.x + (Math.random() * 14 - 7), y: pet.y + (Math.random() * 10 - 5), vx: 0, vy: -8, at: now, life: 620, c: pet.c, r: 2.1, ts: 'star' });
    } else if (pets[u]) {
      delete pets[u];
    }
  });
  var myMntK = myWearIds.mount ? (WBY[myWearIds.mount] || {}).kind : '';
  if (myMntK === 'rocket' && moving && Math.random() < 0.7) parts.push({ x: px - Math.cos(dir) * 18, y: py + 10 - Math.sin(dir) * 4, vx: -Math.cos(dir) * 30, vy: 14, at: performance.now(), life: 380, c: Math.random() < 0.5 ? '#fb923c' : '#facc15', r: 3.2 });
  if (inWater && moving && Math.random() < 0.3) {
    parts.push({ x: px + (Math.random() * 22 - 11), y: py + 12, vx: 0, vy: 0, at: now, life: 620, c: '#7dd3fc', r: 3.4, ring: true });
  }
  var mp = players[me];
  if (mp) { mp.x = px; mp.y = py; mp.tx = px; mp.ty = py; mp.dir = dir; mp.vc = vcOn; mp.talk = talkNow; }
  Object.keys(players).forEach(function (u) {
    if (u === me) return;
    var p = players[u];
    var k = Math.min(1, dt * 7);
    p.x = lerp(p.x, p.tx, k); p.y = lerp(p.y, p.ty, k);
  });
  var near = null;
  for (var i = 0; i < PORTALS.length; i++) { if (dist(px, py, PORTALS[i].x, PORTALS[i].y) < 48) { near = PORTALS[i]; break; } }
  var chip = $('wportal');
  if (near) {
    var cp2 = camPos();
    chip.hidden = false;
    chip.style.left = (near.x - cp2.x) + 'px';
    chip.style.top = (near.y - cp2.y - 56) + 'px';
    if (insidePad !== near) { insidePad = near; chip.textContent = 'enter ' + near.label + ' →'; chip.style.borderColor = near.c; chip.style.boxShadow = '0 0 26px ' + near.c + '66'; }
  } else { insidePad = ''; chip.hidden = true; }
  var nearCab = false;
  for (var ci = 0; ci < CABS.length; ci++) { if (dist(px, py, CABS[ci].x, CABS[ci].y) < 82) { nearCab = true; break; } }
  var wact = $('wact'), actMode = '', actLabel = '';
  nearDoorId = '';
  for (var di = 0; di < DOORS.length; di++) { if (dist(px, py, DOORS[di].x, DOORS[di].y) < 58) { nearDoorId = DOORS[di].id; break; } }
  if (FISHING) { actMode = FISHING.stage === 'bite' ? 'reel' : 'waitfish'; actLabel = FISHING.stage === 'bite' ? 'REEL IT!' : 'line out… tap to pull in'; }
  else if (nearShore()) { actMode = 'fish'; actLabel = myWearIds.rod ? 'cast a line' : 'fish (need a rod)'; }
  else if (INST_V && INST_V.state === 'won') { actMode = 'cryptexit'; actLabel = 'leave the crypt \u2726 cleared'; }
  else if (INST_V && dist(px, py, INST_V.ox + 550, INST_V.oy + 470) < 84) { actMode = 'cryptexit'; actLabel = 'leave the crypt'; }
  else if (INST_V && nearestShade() && dist(px, py, nearestShade().x, nearestShade().y) < 250) { actMode = 'dstrike'; actLabel = 'strike the shade'; }
  else if (BOSS_V && !BOSS_V.dead && dist(px, py, BOSS_V.x, BOSS_V.y) < 280) { actMode = 'bstrike'; actLabel = BOSS_V.stun > 0 ? 'stunned\u2026' : 'strike the lich'; }
  else if (!INST_V && dist(px, py, 5050, 3550) < 120) { actMode = 'crypt'; actLabel = 'enter the sunken crypt'; }
  else if (myHouse && HOUSE_VIEW && HOUSE_VIEW.origin && dist(px, py, HOUSE_VIEW.origin.x + 430, HOUSE_VIEW.origin.y + 520) < 72) { actMode = 'hexit'; actLabel = 'leave the house'; }
  else if (!myHouse && nearHousePlot()) { actMode = 'house'; actLabel = 'enter ur house'; }
  else if (nearDoorId) { actMode = 'door'; for (var dj = 0; dj < DOORS.length; dj++) if (DOORS[dj].id === nearDoorId) actLabel = DOORS[dj].label; }
  else if (myZone === 'the vault' && myInv.indexOf('s141') < 0 && dist(px, py, 5650, 3970) < 120) { actMode = 'vault'; actLabel = 'claim the vault crown'; }
  else if (dist(px, py, TENT.x, TENT.y) < 105) { actMode = 'shop'; actLabel = 'six cents shop'; }
  else if (nearCab) { actMode = 'cab'; actLabel = 'play minigames'; }
  else if (dist(px, py, FOUNTAIN.x, FOUNTAIN.y) < 135) { actMode = 'wish'; actLabel = 'make a wish · 1 six cent'; }
  if (actMode) {
    if (wactMode !== actMode || wactLabelShown !== actLabel) {
      wactMode = actMode;
      wactLabelShown = actLabel;
      wact.className = 'm-' + actMode;
      wact.querySelector('.wact-t').textContent = actLabel;
    }
    wact.hidden = false;
  } else { wactMode = ''; wactLabelShown = ''; wact.hidden = true; }
  if (!pendingClaim) {
    for (var id in shards) { if (dist(px, py, shards[id].x, shards[id].y) < 54) { pendingClaim = id; claimAt = performance.now(); break; } }
  }
  var tx = px + vx * 0.22, ty = py + vy * 0.22;
  cam.x = lerp(cam.x, tx, Math.min(1, dt * 5));
  cam.y = lerp(cam.y, ty, Math.min(1, dt * 5));
  parts = parts.filter(function (p) { return now - p.at < p.life; });
  parts.forEach(function (p) { p.x += p.vx * 0.016; p.y += p.vy * 0.016; if (!p.ring) p.vy += 60 * 0.016; });
  floats = floats.filter(function (f) { return now - f.at < 1400; });
  fires.forEach(function (f) { f.x += Math.cos(f.s + now / 2400) * f.v * dt; f.y += Math.sin(f.s * 1.7 + now / 1900) * f.v * dt * 0.6; if (f.x < 0) f.x = MAP_W; if (f.x > MAP_W) f.x = 0; if (f.y < 0) f.y = MAP_H; if (f.y > MAP_H) f.y = 0; });
  Object.keys(players).forEach(function (u) {
    var p = players[u];
    if (p.emote === 'heart' && now - p.emoteAt < 2400 && Math.random() < 0.5) {
      parts.push({ x: p.x + (Math.random() * 34 - 17), y: p.y - 20, vx: 0, vy: -46, at: now, life: 1000, c: '#f472b6', r: 3, heart: true, big: true });
    }
    if (p.emote === 'dance' && now - p.emoteAt < 2400 && Math.random() < 0.3) {
      parts.push({ x: p.x + (Math.random() * 36 - 18), y: p.y - 26, vx: 6, vy: -34, at: now, life: 850, c: '#c4b5fd', r: 3, note: true });
    }
    if (p.emote === 'spin' && now - p.emoteAt < 2400 && Math.random() < 0.3) {
      var sa = now / 130 + p.x;
      parts.push({ x: p.x + Math.cos(sa) * 20, y: p.y + Math.sin(sa) * 8, vx: 0, vy: -8, at: now, life: 380, c: '#a5f3fc', r: 2.2 });
    }
  });
}

/* ---------------- render ---------------- */
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function star4(g, x, y, r, rot) {
  g.beginPath();
  for (var i = 0; i < 8; i++) {
    var rad = (i % 2 === 0) ? r : r * 0.34;
    var a = rot + i * Math.PI / 4;
    var X = x + Math.cos(a) * rad, Y = y + Math.sin(a) * rad;
    if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
  }
  g.closePath();
}
function starPath(g, r, waist, rot) {
  var pts = [];
  for (var i = 0; i < 8; i++) {
    var rad = (i % 2 === 0) ? r : r * waist;
    var a = rot - Math.PI / 2 + i * Math.PI / 4;
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  g.beginPath();
  g.moveTo((pts[7][0] + pts[0][0]) / 2, (pts[7][1] + pts[0][1]) / 2);
  for (var j = 0; j < 8; j++) {
    var p = pts[j], q = pts[(j + 1) % 8];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}
function wrapLines(g, text, maxW) {
  var words = String(text).split(' '), lines = [], cur = '';
  for (var i = 0; i < words.length; i++) {
    var t = cur ? cur + ' ' + words[i] : words[i];
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    if (lines.length >= 3) break;
  }
  if (cur && lines.length < 3) lines.push(cur);
  return lines;
}
function drawTree(g, t, now) {
  var s = t.s;
  g.fillStyle = 'rgba(0,0,0,.42)';
  g.beginPath(); g.ellipse(t.x, t.y + 4, 17 * s, 6 * s, 0, 0, TAU); g.fill();
  g.save();
  g.translate(t.x, t.y);
  g.rotate(Math.sin(now / 1700 + t.ph) * 0.022);
  g.fillStyle = '#2a1e3f'; g.fillRect(-2.4 * s, -8 * s, 4.8 * s, 10 * s);
  var tiers = [[30, -58, '#0e2a22'], [24, -44, '#123528'], [17, -31, '#17452f']];
  for (var i = 0; i < 3; i++) {
    var w = tiers[i][0] * s, top = tiers[i][1] * s;
    g.fillStyle = tiers[i][2];
    g.beginPath(); g.moveTo(0, top); g.lineTo(w / 2, top + 24 * s); g.lineTo(-w / 2, top + 24 * s); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(190,242,220,.16)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, top); g.lineTo(w / 2, top + 24 * s); g.stroke();
  }
  g.fillStyle = 'rgba(220,240,255,.85)';
  g.beginPath(); g.arc(0, -59 * s, 1.7, 0, TAU); g.fill();
  g.restore();
}
function drawNameTag(g, p, now, byOpt) {
  var by = byOpt != null ? byOpt : (p._by != null ? p._by : p.y);
  var fxc = FXC[p.fx || ''] || FXC[''];
  var label = p.npc ? (p.u + ' ✦') : ((p.gtag ? '[' + p.gtag + '] ' : '') + p.u);
  g.font = '700 12px Inter, sans-serif';
  var tw = g.measureText(label).width;
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 5; g.shadowOffsetY = 1;
  g.fillStyle = 'rgba(5,3,14,.55)';
  rr(g, p.x - tw / 2 - 7, by - 48, tw + 14, 17, 8); g.fill();
  g.shadowOffsetY = 0;
  if (fxc.g) { g.shadowColor = fxc.c; g.shadowBlur = 9; } else g.shadowBlur = 0;
  g.fillStyle = p.npc ? '#ffd257' : (myPartySet[p.u] ? '#ffd257' : fxc.c);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, p.x, by - 39.5);
  g.shadowBlur = 0;
  if (p.vc && !p.npc) {
    g.fillStyle = p.talk ? '#4ade80' : 'rgba(255,255,255,.55)';
    g.beginPath(); g.arc(p.x + tw / 2 + 13, by - 39.5, 3, 0, TAU); g.fill();
  }
  g.textBaseline = 'alphabetic';
}
function drawPlayer(g, p, now, isMe) {
  var x = p.x, y = p.y;
  var emoteAge = now - (p.emoteAt || 0);
  var emote = (p.emote && emoteAge < 2600) ? p.emote : '';
  var bounce = 0, rot = 0;
  if (emote === 'dance') { bounce = Math.abs(Math.sin(now / 125)) * 17; rot = Math.sin(now / 150) * 0.3; }
  if (emote === 'spin') rot = (emoteAge / 900) * TAU;
  if (emote === 'wave') bounce = Math.sin(now / 120) * 1.5;
  var walking = dist(p.x, p.y, p.tx, p.ty) > 4 || (isMe && moving);
  if (walking && !emote) bounce = Math.abs(Math.sin(now / 95)) * 2.4;
  var by = y - bounce;
  if (p.wear && p.wear.mount && (p.wear.mount.kind === 'cloud' || p.wear.mount.kind === 'dragonm')) by -= 5 + Math.sin(now / 320 + x) * 1.6;
  p._by = by;
  var sh = g.createRadialGradient(x, y + 16, 2, x, y + 16, 18);
  sh.addColorStop(0, 'rgba(0,0,0,.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.beginPath(); g.ellipse(x, y + 16, 18, 7.5, 0, 0, TAU); g.fill();
  if (!isMe && !p.npc && myPartySet[p.u]) {
    g.strokeStyle = 'rgba(255,210,87,.9)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, y + 16, 23, 9.5, 0, 0, TAU); g.stroke();
  }
  if (p.wear && p.wear.mount) drawMount(g, p, now, walking);
  if (p.wear && p.wear.aura) {
    var au = p.wear.aura, ai2, oa;
    g.strokeStyle = au.c; g.globalAlpha = 0.75; g.lineWidth = 2.2;
    if (au.kind === 'pulse') {
      g.beginPath(); g.arc(x, y + 4, 23.5 + Math.sin(now / 300 + x) * 2.5, 0, TAU); g.stroke();
    } else if (au.kind === 'spin') {
      for (ai2 = 0; ai2 < 3; ai2++) { g.beginPath(); g.arc(x, y + 4, 25, now / 900 + ai2 * 2.1, now / 900 + ai2 * 2.1 + 1.1); g.stroke(); }
    } else if (au.kind === 'orbit') {
      g.fillStyle = au.c;
      for (ai2 = 0; ai2 < 3; ai2++) { oa = now / 800 + ai2 * 2.1; g.beginPath(); g.arc(x + Math.cos(oa) * 25.5, y + 4 + Math.sin(oa) * 8, 2.6, 0, TAU); g.fill(); }
    } else {
      g.beginPath(); g.ellipse(x, y + 4, 23, 10, 0, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
  }
  if (emote === 'spin') {
    g.fillStyle = '#ffd257';
    for (var sxi = 0; sxi < 3; sxi++) {
      var sxa = now / 160 + sxi * 2.1;
      star4(g, x + Math.cos(sxa) * 25, y + Math.sin(sxa) * 10, 4.6, sxa);
      g.fill();
    }
  }
  g.save();
  g.translate(x, by);
  if (emote === 'dead') g.rotate(Math.PI / 2 * 0.92);
  else if (rot) g.rotate(rot);
  if (p.talk) {
    g.strokeStyle = 'rgba(74,222,128,.9)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, 24 + Math.sin(now / 150) * 2, 0, TAU); g.stroke();
  } else if (p.vc) {
    g.strokeStyle = 'rgba(183,168,255,.4)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 23, 0, TAU); g.stroke();
  }
  if (p.npc) {
    g.shadowColor = '#ffd257'; g.shadowBlur = 18;
    g.fillStyle = '#8b7cff';
    starPath(g, 19, 0.36, now / 2600); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#ffd257';
    starPath(g, 8, 0.36, -now / 2600); g.fill();
  } else {
    var hue = (p.hue != null ? p.hue : hueOf(p.u));
    var ph = 0; for (var ci = 0; ci < p.u.length; ci++) ph += p.u.charCodeAt(ci);
    ph = ph * 1.37;
    var breathe = 1 + Math.sin(now / 620 + ph) * 0.02;
    var sway = Math.sin(now / 940 + ph) * 0.05 + (walking ? Math.sin(now / 95) * 0.045 : 0);
    g.save();
    g.rotate(sway); g.scale(breathe, breathe);
    var grad = g.createRadialGradient(-5, -7, 3, 0, 0, 21);
    grad.addColorStop(0, 'hsl(' + hue + ',82%,72%)');
    grad.addColorStop(0.55, 'hsl(' + hue + ',68%,55%)');
    grad.addColorStop(1, 'hsl(' + hue + ',62%,40%)');
    g.shadowColor = 'hsla(' + hue + ',85%,64%,.75)'; g.shadowBlur = 15;
    g.fillStyle = grad;
    starPath(g, 19, 0.5, 0); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'hsla(' + hue + ',72%,27%,.9)'; g.lineWidth = 1.6;
    starPath(g, 19, 0.5, 0); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.10)';
    starPath(g, 10.5, 0.5, 0); g.fill();
    g.fillStyle = 'rgba(255,255,255,.38)';
    g.beginPath(); g.ellipse(-5.5, -8.5, 4.4, 2.6, -0.6, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.8)';
    for (var tw2 = 0; tw2 < 2; tw2++) { var ta = now / 1500 + ph + tw2 * Math.PI; star4(g, Math.cos(ta) * 16.5, -3 + Math.sin(ta) * 12, 2.1, ta); g.fill(); }
    if (p.wear && p.wear.hat) drawHat(g, p.wear.hat, now);
    var ex = Math.cos(p.dir || 0) * 3.4, ey = Math.sin(p.dir || 0) * 2.6;
    g.fillStyle = '#14101f';
    if (emote === 'dead') {
      g.font = 'bold 9px Inter, sans-serif'; g.textAlign = 'center';
      g.fillText('× ×', ex, ey + 1);
    } else {
      g.beginPath(); g.arc(-4.6 + ex, -1.5 + ey, 1.7, 0, TAU); g.arc(4.6 + ex, -1.5 + ey, 1.7, 0, TAU); g.fill();
      g.strokeStyle = '#14101f'; g.lineWidth = 1.3;
      g.beginPath(); g.arc(ex, 2.6 + ey, 4.4, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
    }
    if (p.wear && p.wear.face) {
      var fc = p.wear.face, fk = fc.kind;
      if (fk === 'shades') {
        g.fillStyle = '#17131f';
        g.beginPath(); g.roundRect(-11 + ex, -5 + ey, 22, 6.4, 3); g.fill();
        g.fillStyle = fc.c; g.globalAlpha = 0.5;
        g.fillRect(-8.6 + ex, -3.4 + ey, 6.4, 1.6); g.fillRect(2.2 + ex, -3.4 + ey, 6.4, 1.6);
        g.globalAlpha = 1;
      } else if (fk === 'stareyes') {
        g.fillStyle = fc.c; g.shadowColor = fc.c; g.shadowBlur = 7;
        star4(g, -4.6 + ex, -1.5 + ey, 4.8, now / 700); g.fill();
        star4(g, 4.6 + ex, -1.5 + ey, 4.8, -now / 700); g.fill();
        g.shadowBlur = 0;
      } else if (fk === 'hearteyes') {
        g.fillStyle = fc.c;
        [[-4.6], [4.6]].forEach(function (e2) {
          var hx = e2[0] + ex, hy = -1.8 + ey;
          g.beginPath();
          g.moveTo(hx, hy + 3.4);
          g.bezierCurveTo(hx - 4.6, hy - 1.2, hx - 2.2, hy - 4.6, hx, hy - 2);
          g.bezierCurveTo(hx + 2.2, hy - 4.6, hx + 4.6, hy - 1.2, hx, hy + 3.4);
          g.fill();
        });
      } else if (fk === 'sleepy') {
        g.strokeStyle = '#14101f'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(-4.6 + ex, -2.6 + ey, 2.7, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
        g.beginPath(); g.arc(4.6 + ex, -2.6 + ey, 2.7, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
        g.fillStyle = 'rgba(199,210,254,.85)';
        g.font = '700 7px Inter, sans-serif'; g.textAlign = 'center';
        g.fillText('z', 11.5 + ex, -8 + ey - Math.sin(now / 480) * 1.2);
        g.font = '700 5.5px Inter, sans-serif';
        g.fillText('z', 14.5 + ex, -12.5 + ey - Math.sin(now / 480 + 1) * 1.2);
      } else if (fk === 'wink') {
        g.fillStyle = '#14101f';
        g.fillRect(2.2 + ex, -2.2 + ey, 4.8, 1.5);
      } else if (fk === 'grin') {
        g.strokeStyle = '#14101f'; g.lineWidth = 1.9;
        g.beginPath(); g.arc(ex, 0.9 + ey, 7, 0.18 * Math.PI, 0.82 * Math.PI); g.stroke();
      } else if (fk === 'cat') {
        g.strokeStyle = '#14101f'; g.lineWidth = 1.3;
        g.beginPath(); g.arc(-2.1 + ex, 2.2 + ey, 2.1, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
        g.beginPath(); g.arc(2.1 + ex, 2.2 + ey, 2.1, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
      } else if (fk === 'dizzy') {
        g.strokeStyle = '#14101f'; g.lineWidth = 1.5;
        [[-4.6], [4.6]].forEach(function (e2) {
          var cx2 = e2[0] + ex, cy2 = -1.5 + ey;
          g.beginPath();
          g.moveTo(cx2 - 2.3, cy2 - 2.3); g.lineTo(cx2 + 2.3, cy2 + 2.3);
          g.moveTo(cx2 + 2.3, cy2 - 2.3); g.lineTo(cx2 - 2.3, cy2 + 2.3);
          g.stroke();
        });
      } else if (fk === 'blush') {
        g.fillStyle = fc.c; g.globalAlpha = 0.55;
        g.beginPath(); g.ellipse(-8.6 + ex, 2.4 + ey, 3.1, 1.9, 0, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(8.6 + ex, 2.4 + ey, 3.1, 1.9, 0, 0, TAU); g.fill();
        g.globalAlpha = 1;
      } else if (fk === 'blank') {
        starPath(g, 11, 0.5, 0);
        g.fillStyle = 'hsl(' + hue + ',70%,62%)'; g.fill();
      }
    }
    if (emote === 'wave') {
      g.fillStyle = 'hsl(' + hue + ',70%,60%)';
      g.beginPath(); g.arc(19.5, -9 + Math.sin(now / 110) * 3.4, 4.6, 0, TAU); g.fill();
    }
    g.restore();
  }
  g.restore();
  drawNameTag(g, p, now, by);
  var fxc = FXC[p.fx || ''] || FXC[''];
  g.font = '700 12px Inter, sans-serif';
  var tw = g.measureText(p.npc ? (p.u + ' ✦') : p.u).width;
  if (p.bub && now - p.bubAt < 5600) {
    g.font = '500 12.5px Inter, sans-serif';
    var lines = wrapLines(g, p.bub, 148);
    var bw = 0;
    lines.forEach(function (L) { bw = Math.max(bw, g.measureText(L).width); });
    bw += 18;
    var bh = lines.length * 16 + 11;
    var bx = clamp(x - bw / 2, 6, MAP_W - bw - 6), byy = by - 60 - bh;
    var age = now - p.bubAt;
    var fade = age > 4800 ? 1 - (age - 4800) / 800 : 1;
    var pop = age < 190 ? (0.55 + 0.45 * (1 - Math.pow(1 - age / 190, 3))) : 1;
    g.save();
    g.globalAlpha = Math.max(0, fade);
    g.translate(x, by - 58); g.scale(pop, pop); g.translate(-x, -(by - 58));
    g.shadowColor = 'rgba(2,0,10,.45)'; g.shadowBlur = 10; g.shadowOffsetY = 3;
    g.fillStyle = 'rgba(252,252,255,.97)';
    rr(g, bx, byy, bw, bh, 10); g.fill();
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.beginPath(); g.moveTo(x - 5, byy + bh - 1); g.lineTo(x + 5, byy + bh - 1); g.lineTo(x, byy + bh + 6); g.closePath(); g.fill();
    g.fillStyle = '#171226'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    lines.forEach(function (L, i) { g.fillText(L, bx + bw / 2, byy + 17 + i * 16); });
    g.restore();
  }
  g.textBaseline = 'alphabetic';
}
function render(now) {
  var g = cx2;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  var bg = g.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, '#0a0518'); bg.addColorStop(1, '#05030d');
  g.fillStyle = bg; g.fillRect(0, 0, VW, VH);
  var cpos = camPos();
  var camX = cpos.x, camY = cpos.y;
  var VX0 = camX - 60, VY0 = camY - 60, VX1 = camX + VW + 60, VY1 = camY + VH + 60;
  var inV = function (x, y, m) { return x > VX0 - (m || 0) && x < VX1 + (m || 0) && y > VY0 - (m || 0) && y < VY1 + (m || 0); };
  g.save();
  g.translate(-camX, -camY);
  /* ground */
  g.fillStyle = '#150f2e'; g.fillRect(0, 0, MAP_W, MAP_H);
  var tints = [
    [2400, 1500, 900, 'rgba(139,124,255,0.055)'], [650, 2100, 620, 'rgba(52,211,153,0.075)'],
    [700, 900, 430, 'rgba(52,211,153,0.06)'], [3950, 520, 540, 'rgba(216,208,255,0.06)'],
    [3950, 1600, 520, 'rgba(251,146,60,0.05)'], [5600, 1150, 700, 'rgba(244,114,182,0.05)'],
    [1200, 3650, 700, 'rgba(103,232,249,0.05)'], [5650, 3970, 480, 'rgba(255,210,87,0.05)'],
    [5650, 280, 520, 'rgba(196,181,253,0.06)']
  ];
  tints.forEach(function (t) {
    if (!inV(t[0], t[1], t[2])) return;
    var rg = g.createRadialGradient(t[0], t[1], 10, t[0], t[1], t[2]);
    rg.addColorStop(0, t[3]); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(t[0] - t[2], t[1] - t[2], t[2] * 2, t[2] * 2);
  });
  var txA = Math.max(0, Math.floor(VX0 / 80)), txB = Math.min(MAP_W / 80, Math.ceil(VX1 / 80));
  var tyA = Math.max(0, Math.floor(VY0 / 80)), tyB = Math.min(MAP_H / 80, Math.ceil(VY1 / 80));
  for (var tx = txA; tx < txB; tx++) for (var ty = tyA; ty < tyB; ty++) {
    if ((tx + ty) % 2 === 0) { g.fillStyle = 'rgba(255,255,255,' + (0.016 + tileShade(tx, ty) * 0.014) + ')'; g.fillRect(tx * 80, ty * 80, 80, 80); }
  }
  g.strokeStyle = 'rgba(139,124,255,.05)'; g.lineWidth = 1;
  g.beginPath();
  for (var gx = txA; gx <= txB; gx++) { g.moveTo(gx * 80, Math.max(0, VY0)); g.lineTo(gx * 80, Math.min(MAP_H, VY1)); }
  for (var gy = tyA; gy <= tyB; gy++) { g.moveTo(Math.max(0, VX0), gy * 80); g.lineTo(Math.min(MAP_W, VX1), gy * 80); }
  g.stroke();
  g.strokeStyle = 'rgba(139,124,255,.35)'; g.lineWidth = 2.5; g.strokeRect(1, 1, MAP_W - 2, MAP_H - 2);
  /* lake */
  if (VX1 > LAKE.x1 && VX0 < LAKE.x2 && VY1 > LAKE.y1 && VY0 < LAKE.y2) {
    var wg2 = g.createLinearGradient(0, LAKE.y1, 0, LAKE.y2);
    wg2.addColorStop(0, '#16294d'); wg2.addColorStop(0.5, '#132544'); wg2.addColorStop(1, '#0d1a36');
    g.fillStyle = wg2;
    rr(g, LAKE.x1, LAKE.y1, LAKE.x2 - LAKE.x1, LAKE.y2 - LAKE.y1, 60); g.fill();
    g.strokeStyle = 'rgba(165,243,252,.28)'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(147,197,253,.13)'; g.lineWidth = 1.4;
    for (var wv = 0; wv < 5; wv++) {
      var wy = LAKE.y1 + 90 + wv * 130;
      g.beginPath();
      for (var wx = Math.max(LAKE.x1 + 26, VX0); wx < Math.min(LAKE.x2 - 26, VX1); wx += 26) {
        var yy = wy + Math.sin(wx / 90 + now / 900 + wv * 1.7) * 3.2;
        if (wx === Math.max(LAKE.x1 + 26, VX0)) g.moveTo(wx, yy); else g.lineTo(wx, yy);
      }
      g.stroke();
    }
    var refl = g.createLinearGradient(0, LAKE.y1, 0, LAKE.y2);
    refl.addColorStop(0, 'rgba(230,228,255,' + (0.05 + 0.02 * Math.sin(now / 700)) + ')');
    refl.addColorStop(1, 'rgba(230,228,255,0)');
    g.fillStyle = refl; g.fillRect(2362, LAKE.y1 + 8, 76, LAKE.y2 - LAKE.y1 - 16);
    /* pier */
    g.fillStyle = '#3a2a1c'; g.fillRect(PIER.x1, PIER.y1, PIER.x2 - PIER.x1, PIER.y2 - PIER.y1);
    g.fillStyle = '#4a3624';
    for (var py2 = PIER.y1 + 4; py2 < PIER.y2 - 4; py2 += 15) g.fillRect(PIER.x1 + 3, py2, PIER.x2 - PIER.x1 - 6, 9);
    g.fillStyle = '#2a1e12';
    g.fillRect(PIER.x1 - 4, PIER.y1 + 30, 8, 14); g.fillRect(PIER.x2 - 4, PIER.y1 + 30, 8, 14);
    g.fillRect(PIER.x1 - 4, PIER.y2 - 44, 8, 14); g.fillRect(PIER.x2 - 4, PIER.y2 - 44, 8, 14);
  }
  /* ---- v507 districts ---- */
  if (VX1 > 4880 && VY1 > 40 && VX0 < 6400 && VY0 < 480) {
    g.fillStyle = '#0a0618'; g.fillRect(4880, 40, 1520, 440);
    SKYSTARS.forEach(function (s) {
      if (!inV(s.x, s.y)) return;
      g.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(now / 900 + s.ph));
      g.fillStyle = '#dcd6ff'; g.beginPath(); g.arc(s.x, s.y, 1.4, 0, TAU); g.fill();
    });
    g.globalAlpha = 1;
    SKY_BRIDGES.forEach(function (b) {
      g.strokeStyle = '#3a2a1c'; g.lineWidth = 15; g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[2], b[3]); g.stroke();
      g.strokeStyle = 'rgba(255,217,160,.35)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(b[0], b[1] - 7); g.lineTo(b[2], b[3] - 7); g.stroke();
    });
    SKY_PADS.forEach(function (pd) {
      if (!inV(pd.x, pd.y, 190)) return;
      g.fillStyle = '#241a45';
      g.beginPath(); g.moveTo(pd.x - pd.rx * 0.7, pd.y + 6); g.lineTo(pd.x + pd.rx * 0.7, pd.y + 6); g.lineTo(pd.x, pd.y + pd.ry + 64); g.closePath(); g.fill();
      var pgr = g.createRadialGradient(pd.x, pd.y - 6, 8, pd.x, pd.y, pd.rx);
      pgr.addColorStop(0, '#2e2361'); pgr.addColorStop(1, '#1d1440');
      g.fillStyle = pgr; g.beginPath(); g.ellipse(pd.x, pd.y, pd.rx, pd.ry, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(196,181,253,.5)'; g.lineWidth = 2; g.stroke();
    });
  }
  if (VX1 > 4880 && VX0 < 6400 && VY1 > 500 && VY0 < 1780) {
    g.fillStyle = '#171233'; g.fillRect(4850, 510, 1500, 1280);
    g.strokeStyle = 'rgba(244,114,182,.28)'; g.lineWidth = 2; g.strokeRect(4860, 520, 1480, 1260);
    g.fillStyle = '#1d1440'; g.fillRect(5450, 510, 400, 180);
    g.strokeStyle = 'rgba(125,211,252,.45)'; g.lineWidth = 2; g.strokeRect(5450, 510, 400, 180);
    g.fillStyle = 'rgba(243,239,255,.6)'; g.font = '700 11px Inter, sans-serif'; g.textAlign = 'center';
    g.fillText('the rooftops', 5650, 545);
    BUILDINGS.forEach(function (b) {
      if (!inV(b.x + b.w / 2, b.y + b.h / 2, 260)) return;
      g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.ellipse(b.x + b.w / 2, b.y + b.h + 8, b.w / 2, 12, 0, 0, TAU); g.fill();
      var fg = g.createLinearGradient(0, b.y, 0, b.y + b.h);
      fg.addColorStop(0, '#221a4a'); fg.addColorStop(1, '#150f30');
      g.fillStyle = fg; g.fillRect(b.x, b.y, b.w, b.h);
      g.fillStyle = b.c; g.shadowColor = b.c; g.shadowBlur = 14; g.fillRect(b.x, b.y, b.w, 4); g.shadowBlur = 0;
      for (var wc = 0; wc < 5; wc++) for (var wr2 = 0; wr2 < 4; wr2++) {
        if (tileShade(b.sd + wc * 3.1, wr2 * 7.7) < 0.42) continue;
        g.fillStyle = (wc + wr2) % 3 === 0 ? 'rgba(255,217,160,.85)' : 'rgba(165,243,252,.7)';
        g.fillRect(b.x + 18 + wc * ((b.w - 30) / 5), b.y + 22 + wr2 * ((b.h - 36) / 4), 15, 10);
      }
      g.strokeStyle = 'rgba(139,124,255,.35)'; g.lineWidth = 1.5; g.strokeRect(b.x, b.y, b.w, b.h);
    });
  }
  if (VX1 > 180 && VX0 < 2420 && VY1 > 3100 && VY0 < 4200) {
    g.fillStyle = '#0d0a1f'; g.fillRect(180, 3100, 2240, 1080);
    g.fillStyle = 'rgba(4,2,12,.3)'; g.fillRect(180, 3100, 2240, 1080);
    CAVEROCKS.forEach(function (r) {
      if (!inV(r.x, r.y, 40)) return;
      g.fillStyle = '#2c2752'; g.beginPath(); g.ellipse(r.x, r.y, r.r, r.r * 0.7, 0, Math.PI, TAU); g.fill();
      g.fillStyle = 'rgba(196,181,253,.12)'; g.beginPath(); g.ellipse(r.x - r.r * 0.25, r.y - r.r * 0.3, r.r * 0.45, r.r * 0.2, -0.4, 0, TAU); g.fill();
    });
    g.globalCompositeOperation = 'lighter';
    CRYSDECOR.forEach(function (c) {
      if (!inV(c.x, c.y, 60)) return;
      var pu = 0.7 + 0.3 * Math.sin(now / 700 + c.ph);
      var cg2 = g.createRadialGradient(c.x, c.y, 1, c.x, c.y, 30 * pu);
      cg2.addColorStop(0, 'rgba(165,243,252,.20)'); cg2.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = cg2; g.beginPath(); g.arc(c.x, c.y, 30 * pu, 0, TAU); g.fill();
      g.fillStyle = c.c; g.save(); g.translate(c.x, c.y); g.rotate(c.ph);
      g.beginPath(); g.moveTo(0, -c.s * 1.7); g.lineTo(c.s * 0.8, 0); g.lineTo(0, c.s * 1.7); g.lineTo(-c.s * 0.8, 0); g.closePath(); g.fill();
      g.restore();
    });
    g.globalCompositeOperation = 'source-over';
  }
  if (VX1 > 2420 && VX0 < 4820 && VY1 > 3100 && VY0 < 4200) {
    g.fillStyle = '#12102a'; g.fillRect(2420, 3100, 2400, 1080);
    SUNKENREEDS.forEach(function (r) {
      if (!inV(r.x, r.y)) return;
      g.strokeStyle = 'rgba(110,231,183,.4)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(r.x, r.y); g.quadraticCurveTo(r.x + 3, r.y - r.h * 0.6, r.x + 6 + Math.sin(now / 800 + r.ph) * 2, r.y - r.h); g.stroke();
    });
  }
  if (VX1 > 4920 && VX0 < 6400 && VY1 > 2000 && VY0 < 3720) {
    EASTROCKS.forEach(function (r) {
      if (!inV(r.x, r.y, 30)) return;
      g.fillStyle = '#4b4468'; g.beginPath(); g.ellipse(r.x, r.y, r.r, r.r * 0.72, 0, Math.PI, TAU); g.fill();
    });
  }
  if (VX1 > 4920 && VX0 < 6400 && VY1 > 3220 && VY0 < 3720) {
    g.fillStyle = '#14102b'; g.fillRect(4920, 3220, 1460, 500);
    g.fillStyle = '#1c1440'; g.fillRect(5060, 3380, 1180, 240);
    g.strokeStyle = 'rgba(167,139,250,.55)'; g.lineWidth = 2.5; g.strokeRect(4920, 3220, 1460, 500);
    g.fillStyle = 'rgba(196,181,253,.85)'; g.font = '800 17px Inter, sans-serif'; g.textAlign = 'center';
    g.shadowColor = '#8b7cff'; g.shadowBlur = 12;
    g.fillText('U N D E R G R O U N D   A R C A D E', 5650, 3300);
    g.shadowBlur = 0;
  }
  if (VX1 > 5020 && VX0 < 6280 && VY1 > 3740 && VY0 < 4200) {
    g.fillStyle = '#171126'; g.fillRect(5020, 3760, 1260, 420);
    g.strokeStyle = 'rgba(255,210,87,.6)'; g.lineWidth = 2.5; g.strokeRect(5020, 3760, 1260, 420);
    [[5080, 3800], [6220, 3800], [5080, 4120], [6220, 4120]].forEach(function (pl) {
      g.fillStyle = '#241a38'; g.beginPath(); g.arc(pl[0], pl[1], 15, 0, TAU); g.fill();
      g.fillStyle = '#ffd257'; g.shadowColor = '#ffd257'; g.shadowBlur = 12; g.beginPath(); g.arc(pl[0], pl[1], 5, 0, TAU); g.fill(); g.shadowBlur = 0;
    });
    g.fillStyle = '#241a38'; g.beginPath(); g.arc(5650, 3970, 44, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,210,87,.7)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#ffd257'; g.shadowColor = '#ffd257'; g.shadowBlur = 18;
    g.beginPath();
    g.moveTo(5628, 3982); g.lineTo(5634, 3948); g.lineTo(5644, 3968); g.lineTo(5650, 3942); g.lineTo(5656, 3968); g.lineTo(5666, 3948); g.lineTo(5672, 3982); g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(243,239,255,.65)'; g.font = '700 11px Inter, sans-serif'; g.textAlign = 'center';
    g.fillText('the vault crown', 5650, 4032);
  }
  BENCHES.forEach(function (b) {
    if (!inV(b.x, b.y, 50)) return;
    g.fillStyle = '#3a2a1c'; g.fillRect(b.x - 22, b.y - 5, 44, 9);
    g.fillStyle = '#4a3624'; g.fillRect(b.x - 22, b.y - 12, 44, 5);
    g.fillStyle = '#2a1e12'; g.fillRect(b.x - 18, b.y + 4, 5, 7); g.fillRect(b.x + 13, b.y + 4, 5, 7);
  });
  if (inV(BOARD.x, BOARD.y, 110)) {
    g.fillStyle = '#2a1e12'; g.fillRect(BOARD.x - 42, BOARD.y + 8, 6, 30); g.fillRect(BOARD.x + 36, BOARD.y + 8, 6, 30);
    g.fillStyle = '#241a38'; rr(g, BOARD.x - 50, BOARD.y - 42, 100, 56, 7); g.fill();
    g.strokeStyle = 'rgba(255,210,87,.55)'; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = '#ffd257'; g.font = '800 12px Inter, sans-serif'; g.textAlign = 'center';
    g.fillText('✦ board', BOARD.x, BOARD.y - 22);
    g.fillStyle = 'rgba(243,239,255,.5)';
    g.fillRect(BOARD.x - 36, BOARD.y - 12, 72, 3); g.fillRect(BOARD.x - 36, BOARD.y - 2, 56, 3); g.fillRect(BOARD.x - 36, BOARD.y + 8, 64, 3);
  }
  renderHouseDecor(g, now);
  drawFishing(g, now);
  drawCryptGate(g, now);
  drawCryptRoom(g, now);
  drawBoss(g, now);
  drawRaceBeacon(g, now);
  DOORS.forEach(function (d) {
    if (!inV(d.x, d.y, 90)) return;
    var pu2 = 1 + Math.sin(now / 480 + d.x) * 0.06;
    g.globalCompositeOperation = 'lighter';
    var dg = g.createRadialGradient(d.x, d.y, 2, d.x, d.y, 52);
    dg.addColorStop(0, 'rgba(167,139,250,.30)'); dg.addColorStop(1, 'rgba(167,139,250,0)');
    g.fillStyle = dg; g.beginPath(); g.ellipse(d.x, d.y, 52, 24, 0, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#a78bfa'; g.lineWidth = 2.6; g.shadowColor = '#a78bfa'; g.shadowBlur = 10;
    g.beginPath(); g.ellipse(d.x, d.y, 26 * pu2, 12 * pu2, 0, 0, TAU); g.stroke();
    g.shadowBlur = 0;
  });
  /* flowers + rocks */
  FLOWERS.forEach(function (f) {
    if (!inV(f.x, f.y)) return;
    g.globalAlpha = 0.5 + 0.3 * Math.sin(now / 800 + f.ph);
    g.fillStyle = f.c; g.beginPath(); g.arc(f.x, f.y, 2, 0, TAU); g.fill();
  });
  g.globalAlpha = 1;
  ROCKS.forEach(function (r) {
    if (!inV(r.x, r.y, 30)) return;
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(r.x, r.y + r.r * 0.4, r.r, r.r * 0.4, 0, 0, TAU); g.fill();
    g.fillStyle = '#4b4468';
    g.beginPath(); g.ellipse(r.x, r.y, r.r, r.r * 0.72, 0, Math.PI, TAU); g.fill();
    g.fillStyle = 'rgba(230,228,255,.14)';
    g.beginPath(); g.ellipse(r.x - r.r * 0.25, r.y - r.r * 0.3, r.r * 0.45, r.r * 0.2, -0.4, 0, TAU); g.fill();
  });
  /* market stalls */
  STALLS.forEach(function (s) {
    if (!inV(s.x, s.y, 70)) return;
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.beginPath(); g.ellipse(s.x, s.y + 16, 30, 8, 0, 0, TAU); g.fill();
    g.fillStyle = '#241a38'; g.fillRect(s.x - 22, s.y - 2, 44, 18);
    g.fillStyle = s.c; g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(s.x - 30, s.y - 2); g.lineTo(s.x, s.y - 20); g.lineTo(s.x + 30, s.y - 2); g.closePath(); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#ffd9a0'; g.shadowColor = '#ffca7a'; g.shadowBlur = 8;
    g.beginPath(); g.arc(s.x, s.y + 6, 2.6, 0, TAU); g.fill(); g.shadowBlur = 0;
  });
  /* lamp glows (additive) + string lights */
  g.globalCompositeOperation = 'lighter';
  LAMPS.forEach(function (L) {
    if (!inV(L.x, L.y, 130)) return;
    var fl = 0.85 + 0.15 * Math.sin(now / 340 + L.ph);
    var rg = g.createRadialGradient(L.x, L.y - 29, 4, L.x, L.y - 29, 118);
    rg.addColorStop(0, 'rgba(255,214,150,' + (0.12 * fl) + ')'); rg.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(L.x, L.y - 29, 118, 0, TAU); g.fill();
  });
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 1;
  LAMP_PAIRS.forEach(function (pr) {
    var A = pr[0], B = pr[1];
    if (!inV(A.x, A.y, 60) && !inV(B.x, B.y, 60)) return;
    var sag = 30;
    g.beginPath(); g.moveTo(A.x, A.y - 26);
    g.quadraticCurveTo((A.x + B.x) / 2, (A.y + B.y) / 2 - 26 + sag * 2, B.x, B.y - 26); g.stroke();
    for (var s2 = 1; s2 < 7; s2++) {
      var t = s2 / 7;
      var qx = (1 - t) * (1 - t) * A.x + 2 * (1 - t) * t * ((A.x + B.x) / 2) + t * t * B.x;
      var qy = (1 - t) * (1 - t) * (A.y - 26) + 2 * (1 - t) * t * ((A.y + B.y) / 2 - 26 + sag * 2) + t * t * (B.y - 26);
      var twk = 0.6 + 0.4 * Math.sin(now / 500 + s2 * 1.3 + A.x);
      g.fillStyle = (s2 % 2) ? 'rgba(255,205,120,' + (0.85 * twk) + ')' : 'rgba(183,168,255,' + (0.85 * twk) + ')';
      g.beginPath(); g.arc(qx, qy, 1.9, 0, TAU); g.fill();
    }
  });
  LAMPS.forEach(function (L) {
    if (!inV(L.x, L.y, 40)) return;
    g.fillStyle = '#241a45'; g.fillRect(L.x - 2.5, L.y - 26, 5, 26);
    g.fillStyle = '#ffd9a0'; g.shadowColor = '#ffca7a'; g.shadowBlur = 12;
    g.beginPath(); g.arc(L.x, L.y - 29, 4.4, 0, TAU); g.fill(); g.shadowBlur = 0;
  });
  /* fountain */
  (function () {
    var fx = FOUNTAIN.x, fy = FOUNTAIN.y;
    if (!inV(fx, fy, 160)) return;
    g.fillStyle = '#1d1440';
    g.beginPath(); g.arc(fx, fy, 66, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(183,168,255,.4)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = 'rgba(10,6,26,.35)';
    g.beginPath(); g.arc(fx, fy, 56, 0, TAU); g.fill();
    var wg = g.createRadialGradient(fx, fy, 4, fx, fy, 52);
    wg.addColorStop(0, 'rgba(96,165,250,.5)'); wg.addColorStop(1, 'rgba(59,7,100,.25)');
    g.fillStyle = wg; g.beginPath(); g.arc(fx, fy, 52, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(165,243,252,.25)';
    for (var wr = 0; wr < 3; wr++) {
      g.beginPath(); g.arc(fx, fy, 14 + wr * 13 + Math.sin(now / 700 + wr) * 2.5, 0, TAU); g.stroke();
    }
    g.globalCompositeOperation = 'lighter';
    var mg = g.createRadialGradient(fx, fy, 2, fx, fy, 62);
    mg.addColorStop(0, 'rgba(240,240,255,.5)'); mg.addColorStop(1, 'rgba(240,240,255,0)');
    g.fillStyle = mg; g.beginPath(); g.arc(fx, fy, 62, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#f4f2ff'; g.shadowColor = '#dcd6ff'; g.shadowBlur = 24;
    g.beginPath(); g.arc(fx, fy, 13 + Math.sin(now / 900) * 1.2, 0, TAU); g.fill(); g.shadowBlur = 0;
    if (Math.random() < 0.1) parts.push({ x: fx + (Math.random() * 30 - 15), y: fy - 12, vx: 0, vy: -26, at: now, life: 700, c: '#dcd6ff', r: 1.6 });
  })();
  if (inV(TENT.x, TENT.y, 150)) drawTent(g, now);
  /* arcade cabinets */
  CABS.forEach(function (c) { if (inV(c.x, c.y, 90)) drawCabinet(g, c, now); });
  /* portals */
  PORTALS.forEach(function (pad) {
    if (!inV(pad.x, pad.y, 130)) return;
    var pulse = 1 + Math.sin(now / 480 + pad.x) * 0.05;
    g.globalCompositeOperation = 'lighter';
    var pg = g.createRadialGradient(pad.x, pad.y, 2, pad.x, pad.y, 74);
    pg.addColorStop(0, pad.c + '2e'); pg.addColorStop(1, pad.c + '00');
    g.fillStyle = pg;
    g.beginPath(); g.ellipse(pad.x, pad.y, 74, 32, 0, 0, TAU); g.fill();
    var beam = g.createLinearGradient(0, pad.y - 96, 0, pad.y);
    beam.addColorStop(0, pad.c + '00'); beam.addColorStop(1, pad.c + '26');
    g.fillStyle = beam; g.fillRect(pad.x - 26, pad.y - 96, 52, 96);
    g.globalCompositeOperation = 'source-over';
    g.save(); g.translate(pad.x, pad.y); g.scale(1, 0.42);
    g.strokeStyle = pad.c; g.globalAlpha = 0.9; g.lineWidth = 3.4;
    g.shadowColor = pad.c; g.shadowBlur = 16;
    g.beginPath(); g.arc(0, 0, 40 * pulse, now / 900, now / 900 + Math.PI * 1.5); g.stroke();
    g.beginPath(); g.arc(0, 0, 31 * pulse, -now / 700, -now / 700 + Math.PI * 1.2); g.stroke();
    g.shadowBlur = 0; g.globalAlpha = 0.16; g.fillStyle = pad.c;
    g.beginPath(); g.arc(0, 0, 38, 0, TAU); g.fill();
    g.restore(); g.globalAlpha = 1;
    g.font = '800 13.5px Inter, sans-serif'; g.textAlign = 'center';
    g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 6;
    g.fillStyle = pad.c;
    g.fillText(pad.label, pad.x, pad.y - 36);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(243,239,255,.55)'; g.font = '600 10.5px Inter, sans-serif';
    g.fillText(pad.sub, pad.x, pad.y + 36);
  });
  /* shards */
  Object.keys(shards).forEach(function (id) {
    var s = shards[id];
    if (!inV(s.x, s.y, 50)) return;
    var bob = Math.sin(now / 420 + s.seed) * 4;
    var y = s.y + bob;
    g.globalCompositeOperation = 'lighter';
    var sg = g.createRadialGradient(s.x, y, 1, s.x, y, s.gold ? 30 : 20);
    sg.addColorStop(0, s.gold ? 'rgba(255,210,87,.4)' : 'rgba(125,211,252,.32)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(s.x, y, s.gold ? 30 : 20, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.save(); g.translate(s.x, y);
    if (s.gold) {
      g.shadowColor = '#ffd257'; g.shadowBlur = 22;
      g.fillStyle = '#ffd257';
      star4(g, 0, 0, 13 + Math.sin(now / 200) * 1.6, now / 500); g.fill();
      g.fillStyle = '#fff3c4'; star4(g, 0, 0, 6.5, -now / 500); g.fill();
    } else {
      g.shadowColor = '#7dd3fc'; g.shadowBlur = 12;
      g.fillStyle = '#a5f3fc';
      g.rotate(now / 800 + s.seed);
      g.fillRect(-5.4, -5.4, 10.8, 10.8);
    }
    g.restore();
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(s.x, s.y + 12, 8, 3, 0, 0, TAU); g.fill();
  });
  /* meteors (event) */
  Object.keys(meteors).forEach(function (id) {
    var m = meteors[id];
    if (!inV(m.x, m.y, 60)) return;
    var tNow = Date.now();
    if (tNow < m.landAt) {
      var k = 1 - (m.landAt - tNow) / 2400;
      var fx = m.x - 190 * (1 - k), fy = m.y - 300 * (1 - k);
      g.strokeStyle = 'rgba(254,243,199,.55)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(fx - 26, fy - 42); g.lineTo(fx, fy); g.stroke();
      g.fillStyle = '#fef3c7'; g.shadowColor = '#fcd34d'; g.shadowBlur = 16;
      g.beginPath(); g.arc(fx, fy, 4.5, 0, TAU); g.fill(); g.shadowBlur = 0;
      g.strokeStyle = 'rgba(252,211,77,.8)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(m.x, m.y, 8 + k * 22, (8 + k * 22) * 0.36, 0, 0, TAU); g.stroke();
    } else {
      var bob3 = Math.sin(now / 380 + m.x) * 3;
      g.globalCompositeOperation = 'lighter';
      var mg = g.createRadialGradient(m.x, m.y + bob3, 1, m.x, m.y + bob3, 30);
      mg.addColorStop(0, 'rgba(252,211,77,.4)'); mg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = mg; g.beginPath(); g.arc(m.x, m.y + bob3, 30, 0, TAU); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.save(); g.translate(m.x, m.y + bob3);
      g.fillStyle = '#fef3c7'; g.shadowColor = '#fcd34d'; g.shadowBlur = 18;
      starPath(g, 11, 0.45, now / 700); g.fill();
      g.fillStyle = '#f59e0b';
      starPath(g, 5.5, 0.45, -now / 700); g.fill();
      g.restore();
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath(); g.ellipse(m.x, m.y + 12, 9, 3.2, 0, 0, TAU); g.fill();
    }
  });
  /* treasure warmth: gold motes orbit u when the chest is close */
  if (TREASURE_V && TREASURE_V.near) {
    for (var twk = 0; twk < 5; twk++) {
      var wa2 = now / 500 + twk * 1.256;
      g.fillStyle = 'rgba(255,210,87,.85)';
      star4(g, px + Math.cos(wa2) * 26, py - 6 + Math.sin(wa2) * 14, 2.6, wa2);
      g.fill();
    }
  }
  /* crystals (server collectibles) */
  Object.keys(crys).forEach(function (id) {
    var c = crys[id];
    if (c.got || !inV(c.x, c.y, 50)) return;
    var col = c.rare === 'mythic' ? '#ffd257' : c.rare === 'epic' ? '#f0abfc' : c.rare === 'rare' ? '#c4b5fd' : '#a5f3fc';
    var bob2 = Math.sin(now / 460 + c.x) * 4;
    g.globalCompositeOperation = 'lighter';
    var cg3 = g.createRadialGradient(c.x, c.y + bob2, 1, c.x, c.y + bob2, 26);
    cg3.addColorStop(0, 'rgba(240,171,252,.32)'); cg3.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg3; g.beginPath(); g.arc(c.x, c.y + bob2, 26, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.save(); g.translate(c.x, c.y + bob2); g.rotate(now / 900 + c.x);
    g.shadowColor = col; g.shadowBlur = 14; g.fillStyle = col;
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 0); g.lineTo(0, 10); g.lineTo(-7, 0); g.closePath(); g.fill();
    g.restore();
  });
  if (moveTarget) {
    var mtAge = (now - moveTarget.at) / 1000;
    g.strokeStyle = 'rgba(165,243,252,.75)'; g.lineWidth = 2;
    var mtr = 10 + Math.sin(now / 160) * 2.4;
    g.beginPath(); g.arc(moveTarget.x, moveTarget.y, mtr, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(165,243,252,.9)';
    g.beginPath(); g.arc(moveTarget.x, moveTarget.y, 2.2, 0, TAU); g.fill();
    if (mtAge > 20) moveTarget = null;
  }
  /* fireflies */
  fires.forEach(function (f) {
    if (!inV(f.x, f.y)) return;
    var tw = 0.35 + 0.65 * Math.abs(Math.sin(now / 800 + f.s * 3));
    g.fillStyle = 'rgba(190,242,160,' + (0.5 * tw) + ')';
    g.beginPath(); g.arc(f.x, f.y, 1.7, 0, TAU); g.fill();
  });
  /* y-sorted: trees + players */
  var drawList = [];
  TREES.forEach(function (t) { if (inV(t.x, t.y, 90)) drawList.push({ y: t.y + 2, tree: t }); });
  Object.keys(players).forEach(function (u) { drawList.push({ y: players[u].y, p: players[u] }); });
  drawList.sort(function (a, b) { return a.y - b.y; });
  drawList.forEach(function (d) {
    if (d.tree) drawTree(g, d.tree, now);
    else drawPlayer(g, d.p, now, d.p.u === me);
  });
  if (players[me]) drawNameTag(g, players[me], now);
  Object.keys(pets).forEach(function (u) {
    var pet = pets[u];
    if (inV(pet.x, pet.y, 70)) drawPet(g, pet, now);
  });
  /* particles */
  parts.forEach(function (p) {
    var age = (now - p.at) / p.life;
    g.globalAlpha = Math.max(0, 1 - age);
    if (p.ring) {
      g.strokeStyle = p.c; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(p.x, p.y, 4 + age * 15, (4 + age * 15) * 0.42, 0, 0, TAU); g.stroke();
      return;
    }
    g.fillStyle = p.c;
    if (p.ts === 'star') {
      g.fillStyle = p.c; star4(g, p.x, p.y, p.r * 2.1, age * 4); g.fill();
    } else if (p.ts === 'spark') {
      g.strokeStyle = p.c; g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(p.x - p.r * 1.7, p.y); g.lineTo(p.x + p.r * 1.7, p.y);
      g.moveTo(p.x, p.y - p.r * 1.7); g.lineTo(p.x, p.y + p.r * 1.7);
      g.stroke();
    } else if (p.heart || p.ts === 'heart') {
      g.font = (p.big ? '21px' : '12px') + ' Inter'; g.textAlign = 'center';
      g.fillText('♥', p.x, p.y - age * 30);
    } else if (p.note || p.ts === 'note') {
      g.font = '13px Inter'; g.textAlign = 'center';
      g.fillText('♪', p.x, p.y - age * 24);
    } else {
      g.beginPath(); g.arc(p.x, p.y, p.r * (1 - age * 0.5), 0, TAU); g.fill();
    }
  });
  g.globalAlpha = 1;
  /* floats */
  g.font = '800 14px Inter, sans-serif'; g.textAlign = 'center';
  floats.forEach(function (f) {
    var age = (now - f.at) / 1400;
    g.globalAlpha = Math.max(0, 1 - age);
    g.fillStyle = f.c;
    g.fillText(f.text, f.x, f.y - age * 42);
  });
  g.globalAlpha = 1;
  g.restore();
  /* screen-space shading: moonlight wash + vignette */
  var mw = g.createLinearGradient(0, 0, 0, VH * 0.55);
  mw.addColorStop(0, 'rgba(160,150,255,.06)'); mw.addColorStop(1, 'rgba(160,150,255,0)');
  g.fillStyle = mw; g.fillRect(0, 0, VW, VH * 0.55);
  var vg = g.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.42, VW / 2, VH / 2, Math.max(VW, VH) * 0.78);
  vg.addColorStop(0, 'rgba(3,1,9,0)'); vg.addColorStop(1, 'rgba(3,1,9,.5)');
  g.fillStyle = vg; g.fillRect(0, 0, VW, VH);
  var cycT = (Date.now() % 600000) / 600000;
  var darkK = 0.5 - 0.5 * Math.cos(cycT * TAU);
  if (darkK > 0.02) { cx2.fillStyle = 'rgba(9,5,30,' + (darkK * 0.34).toFixed(3) + ')'; cx2.fillRect(0, 0, VW, VH); }
  if (WX === 'rain') {
    cx2.strokeStyle = 'rgba(165,200,255,.35)'; cx2.lineWidth = 1.2; cx2.beginPath();
    for (var ri = 0; ri < 70; ri++) {
      var rx = (ri * 173.3 + now / 9) % (VW + 40) - 20, ry = (ri * 311.7 + now / 2.4) % (VH + 30) - 15;
      cx2.moveTo(rx, ry); cx2.lineTo(rx - 3, ry + 13);
    }
    cx2.stroke();
  } else if (WX === 'fog') {
    for (var fi = 0; fi < 4; fi++) {
      var fx2 = ((fi * 401 + now / 60) % (VW + 300)) - 150, fy2 = VH * (0.25 + fi * 0.18);
      var fg = cx2.createRadialGradient(fx2, fy2, 10, fx2, fy2, 190);
      fg.addColorStop(0, 'rgba(205,200,235,.13)'); fg.addColorStop(1, 'rgba(205,200,235,0)');
      cx2.fillStyle = fg; cx2.fillRect(fx2 - 190, fy2 - 190, 380, 380);
    }
  }
  drawMap(camX, camY);
}
function drawMap(camX, camY) {
  if (!mapCx) return;
  var g = mapCx, W = 168, H = 105, sx = W / 6400, sy = H / 4200;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(13,9,28,.88)'; g.fillRect(0, 0, W, H);
  MAPZ.forEach(function (z) {
    g.fillStyle = z[5] + '2e';
    g.beginPath(); g.arc(z[2] * sx, z[3] * sy, Math.max(2.2, z[4] * sx), 0, TAU); g.fill();
  });
  g.fillStyle = 'rgba(56,120,220,.55)'; g.fillRect(LAKE.x1 * sx, LAKE.y1 * sy, (LAKE.x2 - LAKE.x1) * sx, (LAKE.y2 - LAKE.y1) * sy);
  PORTALS.forEach(function (pad) { g.fillStyle = pad.c; g.beginPath(); g.arc(pad.x * sx, pad.y * sy, 1.8, 0, TAU); g.fill(); });
  Object.keys(shards).forEach(function (id) { var s = shards[id]; if (!s.gold) return; g.fillStyle = '#ffd257'; g.fillRect(s.x * sx - 1.2, s.y * sy - 1.2, 2.4, 2.4); });
  if (BOSS_V && !BOSS_V.dead) { g.fillStyle = '#ef4444'; g.beginPath(); g.arc(BOSS_V.x * sx, BOSS_V.y * sy, 2.6 + Math.sin(performance.now() / 200) * 0.8, 0, TAU); g.fill(); }
  Object.keys(players).forEach(function (u) {
    var p = players[u];
    if (p.y > 4200) return;
    g.fillStyle = p.npc ? '#ffd257' : (u === me ? '#ffffff' : (myPartySet[u] ? '#ffd257' : 'rgba(200,190,255,.8)'));
    g.beginPath(); g.arc(p.x * sx, p.y * sy, u === me ? 2.8 : 2, 0, TAU); g.fill();
  });
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1;
  g.strokeRect(camX * sx, camY * sy, VW * sx, VH * sy);
}
if (mapCv) { mapCv.style.cursor = 'pointer'; mapCv.title = 'open the world map'; mapCv.addEventListener('click', function () { openMap2(); }); }

function loop(now) {
  update(now);
  render(now);
  requestAnimationFrame(loop);
}


/* ---------------- arcade: 112 minigames, 8 engines ---------------- */
var CABS = (window.WCABS || []);
CABS.forEach(function (c, i) { c.hue = [265, 320, 190, 45, 150, 210][i % 6]; OBS.push({ x: c.x, y: c.y, r: 20 }); });
function drawCabinet(g, c, now) {
  g.fillStyle = 'rgba(0,0,0,.45)';
  g.beginPath(); g.ellipse(c.x, c.y + 24, 24, 7, 0, 0, TAU); g.fill();
  g.fillStyle = 'hsl(' + c.hue + ',45%,16%)';
  rr(g, c.x - 17, c.y - 34, 34, 58, 6); g.fill();
  g.strokeStyle = 'hsl(' + c.hue + ',80%,62%)'; g.lineWidth = 1.6; g.stroke();
  g.fillStyle = 'hsl(' + c.hue + ',85%,68%)';
  rr(g, c.x - 13, c.y - 44, 26, 9, 4); g.fill();
  g.fillStyle = '#0b0618';
  g.font = '800 8px Inter, sans-serif'; g.textAlign = 'center';
  g.fillText('PLAY', c.x, c.y - 37);
  var sg = g.createLinearGradient(0, c.y - 30, 0, c.y + 2);
  sg.addColorStop(0, 'hsl(' + c.hue + ',70%,30%)'); sg.addColorStop(1, 'hsl(' + c.hue + ',70%,14%)');
  g.fillStyle = sg; rr(g, c.x - 12, c.y - 30, 24, 32, 3); g.fill();
  g.fillStyle = 'rgba(255,255,255,.85)';
  star4(g, c.x + Math.sin(now / 700 + c.x) * 4, c.y - 16 + Math.cos(now / 900 + c.y) * 3, 4.6, now / 800);
  g.fill();
  g.fillStyle = 'hsl(' + c.hue + ',85%,65%)';
  g.beginPath(); g.arc(c.x - 6, c.y + 10, 2.6, 0, TAU); g.arc(c.x + 6, c.y + 10, 2.6, 0, TAU); g.fill();
  g.fillStyle = 'rgba(230,228,255,.75)';
  g.fillRect(c.x - 8, c.y + 17, 16, 3);
}
var MG = { open: false, id: null, entry: null, points: 0, doneFlag: false, cleanups: [], raf: 0 };
function mgCleanup() {
  MG.cleanups.forEach(function (f) { try { f(); } catch (e) { } });
  MG.cleanups = [];
  if (MG.raf) cancelAnimationFrame(MG.raf);
  MG.raf = 0;
}
function mgOn(f) { MG.cleanups.push(f); }
function mgTimer(ms, fn) { var t = setInterval(fn, ms); mgOn(function () { clearInterval(t); }); return t; }
function mgDelay(ms, fn) { var t = setTimeout(fn, ms); mgOn(function () { clearTimeout(t); }); return t; }
function mgRaf(fn) {
  var step = function (t) { if (!MG.open || MG.doneFlag) return; fn(t); MG.raf = requestAnimationFrame(step); };
  MG.raf = requestAnimationFrame(step);
}
function mgCanvas(stage, h) {
  stage.innerHTML = '';
  var c = document.createElement('canvas');
  c.width = 560; c.height = h || 360;
  stage.appendChild(c);
  return [c, c.getContext('2d')];
}
function stagePos(e, c) {
  var r = c.getBoundingClientRect();
  return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
}
function mgKey(handler) {
  var fn = function (e) { handler(e); };
  window.addEventListener('keydown', fn);
  mgOn(function () { window.removeEventListener('keydown', fn); });
  return fn;
}
var ENGINE_NAMES = { pop: 'pop party', react: 'reflex corner', memory: 'memory lane', catch: 'catch crew', maze: 'maze district', stack: 'stack street', quiz: 'quiz alley', snake: 'snake row', plat: 'platform heights', race: 'gate rush', rhythm: 'beat street', slide: 'slide arcade' };
function buildArcadeList() {
  var list = $('wa-list');
  list.innerHTML = '';
  var order = ['pop', 'react', 'memory', 'catch', 'maze', 'stack', 'quiz', 'snake', 'plat', 'race', 'rhythm', 'slide'];
  order.forEach(function (eng) {
    var items = (window.WGAMES || []).filter(function (g) { return g.engine === eng; });
    if (!items.length) return;
    var h = document.createElement('div');
    h.className = 'wa-sec'; h.textContent = ENGINE_NAMES[eng] + ' · ' + items.length;
    h.setAttribute('data-sec', eng);
    list.appendChild(h);
    items.forEach(function (g) {
      var b = document.createElement('button');
      b.className = 'wa-item'; b.type = 'button';
      b.setAttribute('data-name', (g.name + ' ' + g.how).toLowerCase());
      b.setAttribute('data-sec', eng);
      var left = document.createElement('span');
      var nm = document.createElement('b'); nm.textContent = g.name;
      var sm = document.createElement('small'); sm.textContent = g.how;
      left.appendChild(nm); left.appendChild(sm);
      var cap = document.createElement('span');
      cap.className = 'wa-cap'; cap.textContent = 'up to ¢' + g.capCoins;
      if (MG.dchal && g.id === MG.dchal.id) { nm.textContent = '\u2605 ' + g.name; cap.textContent = MG.dchal.done ? 'daily challenge done' : 'daily challenge \u00b7 +\u00a215 bonus'; cap.style.color = '#ffd257'; }
      b.appendChild(left); b.appendChild(cap);
      b.addEventListener('click', function () { launchGame(g.id); });
      list.appendChild(b);
    });
  });
  $('wa-count').textContent = (window.WGAMES || []).length + ' minigames · 3 paid plays each per day';
}
function openArcade() {
  closeGame();
  buildArcadeList();
  $('warcade').hidden = false;
  document.body.classList.add('wov');
}
function closeArcade() { $('warcade').hidden = true; document.body.classList.remove('wov'); }
function closeGame() {
  MG.open = false; MG.doneFlag = false; MG.id = null; MG.entry = null;
  window.__mgOpen = false;
  mgCleanup();
  $('wgame').hidden = true;
  document.body.classList.remove('wov');
}
function launchGame(id) {
  var entry = null;
  (window.WGAMES || []).forEach(function (g) { if (g.id === id) entry = g; });
  if (!entry) return;
  closeGame();
  closeArcade();
  MG.open = true; MG.id = id; MG.entry = entry; MG.points = 0; MG.doneFlag = false; MG.token = '';
  jpost('/api/world/mini-start', { game: id }).then(function (r) { if (r && r.ok) MG.token = r.token; });
  window.__mgOpen = true;
  $('wg-title').textContent = entry.name;
  $('wg-how').textContent = entry.how + ' · up to ¢' + entry.capCoins + ' six cents';
  $('wg-score').textContent = '0 pts';
  $('wg-result').hidden = true;
  $('wgame').hidden = false;
  document.body.classList.add('wov');
  var api = {
    score: function (n) { MG.points = n; $('wg-score').textContent = n + ' pts'; },
    done: function (n) { finishGame(entry, Math.max(0, Math.floor(n || 0))); }
  };
  MG.api = api;
  var fn = ENGINES[entry.engine];
  if (fn) fn($('wg-stage'), entry, api);
}
function finishGame(entry, points) {
  if (MG.doneFlag || !MG.open) return;
  MG.doneFlag = true;
  MG.points = points;
  $('wg-score').textContent = points + ' pts';
  mgCleanup();
  var res = $('wg-result');
  res.hidden = false;
  res.innerHTML = 'submitting score…';
  sndQuest();
  jpost('/api/world/miniscore', { game: entry.id, points: points, token: MG.token || '' }).then(function (r) {
    var html;
    if (!r || !r.ok) html = 'score didn\'t land (' + ((r && r.err) || 'network') + ') — the run still counts in ur heart';
    else if (r.paid && r.cents > 0) html = '\u2726 +' + r.cents + ' six cents' + (r.bal != null ? ' \u00b7 balance \u00a2' + r.bal : '') + (r.playsLeft != null ? ' \u00b7 ' + r.playsLeft + ' paid plays left today' : '') + (r.dchalBonus ? ' \u00b7 daily challenge cleared (+\u00a215 inside)' : '') + (r.newBest ? ' \u00b7 NEW PERSONAL BEST' : '');
    else if (r.practice) html = 'practice run — that score wasnt from a live session, so no six cents';
    else if (points > 0) html = 'practice run \u2014 paid plays for this one are used up today, six cents resume tomorrow' + (r.pb != null ? ' \u00b7 ur best: ' + r.pb + ' pts' : '') + (r.newBest ? ' \u00b7 NEW PERSONAL BEST' : '');
    else html = 'no points that run — go again';
    res.innerHTML = '';
    res.appendChild(document.createTextNode(html));
    var again = document.createElement('button');
    again.type = 'button'; again.textContent = 'play again';
    again.addEventListener('click', function () { launchGame(entry.id); });
    var back = document.createElement('button');
    back.type = 'button'; back.className = 'ghost'; back.textContent = 'all games';
    back.addEventListener('click', function () { closeGame(); openArcade(); });
    res.appendChild(again); res.appendChild(back);
    if (r && r.bal != null) setCentsBal(r.bal);
  });
}
$('wgames').addEventListener('click', openArcade);
$('wa-x').addEventListener('click', closeArcade);
$('wg-x').addEventListener('click', closeGame);
$('wa-q').addEventListener('input', function () {
  var q = $('wa-q').value.trim().toLowerCase();
  var secs = {};
  Array.prototype.forEach.call($('wa-list').querySelectorAll('.wa-item'), function (it) {
    var show = !q || it.getAttribute('data-name').indexOf(q) >= 0;
    it.style.display = show ? '' : 'none';
    if (show) secs[it.getAttribute('data-sec')] = 1;
  });
  Array.prototype.forEach.call($('wa-list').querySelectorAll('.wa-sec'), function (s) {
    s.style.display = secs[s.getAttribute('data-sec')] ? '' : 'none';
  });
});
window.__arcade = {
  launch: launchGame, open: openArcade, close: closeGame,
  state: function () { return { open: MG.open, id: MG.id, points: MG.points, done: MG.doneFlag }; },
  finish: function () { if (MG.open && !MG.doneFlag && MG.entry) finishGame(MG.entry, MG.points); }
};

/* quiz bank: 4 per topic */
var QBANK = {
  space: [
    { q: 'which planet is called the red planet?', a: ['venus', 'mars', 'jupiter', 'mercury'], c: 1 },
    { q: 'what force keeps us on the ground?', a: ['magnetism', 'friction', 'gravity', 'inertia'], c: 2 },
    { q: 'how many moons does earth have?', a: ['two', 'one', 'three', 'zero'], c: 1 },
    { q: 'the sun is a…', a: ['planet', 'comet', 'star', 'asteroid'], c: 2 }],
  animals: [
    { q: 'fastest land animal?', a: ['lion', 'horse', 'cheetah', 'gazelle'], c: 2 },
    { q: 'a group of wolves is a…', a: ['herd', 'pack', 'flock', 'swarm'], c: 1 },
    { q: 'which animal has black and white stripes?', a: ['tiger', 'zebra', 'skunk', 'panda'], c: 1 },
    { q: 'baby frogs are called…', a: ['tadpoles', 'fry', 'cubs', 'pups'], c: 0 }],
  sports: [
    { q: 'how many players on a soccer team on the field?', a: ['9', '10', '11', '12'], c: 2 },
    { q: 'in basketball a free throw is worth…', a: ['1 point', '2 points', '3 points', '4 points'], c: 0 },
    { q: 'the super bowl decides the champion of…', a: ['baseball', 'hockey', 'football', 'golf'], c: 2 },
    { q: 'how many rings are on the olympic flag?', a: ['4', '5', '6', '7'], c: 1 }],
  food: [
    { q: 'sushi comes from…', a: ['china', 'korea', 'japan', 'thailand'], c: 2 },
    { q: 'which fruit keeps the doctor away, per the saying?', a: ['banana', 'apple', 'grape', 'pear'], c: 1 },
    { q: 'pizza originally comes from…', a: ['france', 'spain', 'italy', 'greece'], c: 2 },
    { q: 'what is the main ingredient in guacamole?', a: ['tomato', 'avocado', 'onion', 'pepper'], c: 1 }],
  music: [
    { q: 'how many strings does a standard guitar have?', a: ['4', '5', '6', '7'], c: 2 },
    { q: 'a piano has how many keys?', a: ['76', '88', '96', '108'], c: 1 },
    { q: 'which instrument has 47 strings?', a: ['cello', 'harp', 'viola', 'banjo'], c: 1 },
    { q: 'beats per minute measures…', a: ['volume', 'pitch', 'tempo', 'key'], c: 2 }],
  geography: [
    { q: 'capital of france?', a: ['london', 'paris', 'rome', 'berlin'], c: 1 },
    { q: 'the longest river in the world is the…', a: ['amazon', 'nile', 'yangtze', 'mississippi'], c: 1 },
    { q: 'which continent is egypt in?', a: ['asia', 'europe', 'africa', 'oceania'], c: 2 },
    { q: 'the great wall is in…', a: ['japan', 'china', 'india', 'mongolia'], c: 1 }],
  tech: [
    { q: 'what does "www" stand for?', a: ['world wide web', 'web world wide', 'wide world web', 'world web window'], c: 0 },
    { q: 'how many bits are in a byte?', a: ['4', '8', '16', '32'], c: 1 },
    { q: 'the first programmable computer concept was by…', a: ['turing', 'babbage', 'edison', 'tesla'], c: 1 },
    { q: 'which company makes the iphone?', a: ['samsung', 'google', 'apple', 'sony'], c: 2 }],
  movies: [
    { q: 'who directed jaws and e.t.?', a: ['nolan', 'spielberg', 'scott', 'burton'], c: 1 },
    { q: 'the titanic sank in which year (in real life)?', a: ['1905', '1912', '1920', '1931'], c: 1 },
    { q: 'which movie features a sinking ship and a big diamond?', a: ['avatar', 'titanic', 'poseidon', 'jaws'], c: 1 },
    { q: 'an oscar statuette is made of gold-plated…', a: ['steel', 'bronze', 'copper', 'tin'], c: 1 }],
  history: [
    { q: 'the first us president was…', a: ['lincoln', 'jefferson', 'washington', 'adams'], c: 2 },
    { q: 'world war ii ended in…', a: ['1943', '1944', '1945', '1947'], c: 2 },
    { q: 'the roman empire fell in the…', a: ['1st century', '3rd century', '5th century', '9th century'], c: 2 },
    { q: 'who painted the mona lisa?', a: ['picasso', 'van gogh', 'da vinci', 'rembrandt'], c: 2 }],
  nature: [
    { q: 'what gas do plants absorb?', a: ['oxygen', 'carbon dioxide', 'nitrogen', 'helium'], c: 1 },
    { q: 'the hardest natural substance is…', a: ['gold', 'iron', 'diamond', 'quartz'], c: 2 },
    { q: 'how many legs does a spider have?', a: ['6', '8', '10', '12'], c: 1 },
    { q: 'water is made of hydrogen and…', a: ['carbon', 'oxygen', 'nitrogen', 'sulfur'], c: 1 }],
  games: [
    { q: 'minecraft was created by…', a: ['notch', 'gaben', 'miyamoto', 'kojima'], c: 0 },
    { q: 'how many squares on a chess board?', a: ['48', '64', '72', '81'], c: 1 },
    { q: 'the best-selling console of all time is the…', a: ['ps2', 'wii', 'ps4', 'switch'], c: 0 },
    { q: 'in pac-man the ghosts are blinky, pinky, inky and…', a: ['clyde', 'fred', 'shadow', 'speedy'], c: 0 }],
  mixed: []
};
QBANK.mixed = QBANK.space.concat(QBANK.animals, QBANK.tech, QBANK.nature);

function mgRng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function mgDpad(stage, cb) {
  var d = document.createElement('div');
  d.className = 'mg-dpad';
  [['◀', 'l'], ['▲', 'u'], ['▼', 'd'], ['▶', 'r']].forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = p[0];
    b.addEventListener('pointerdown', function (ev) { ev.preventDefault(); cb(p[1]); });
    d.appendChild(b);
  });
  stage.appendChild(d);
}

var ENGINES = {
  pop: function (stage, e, api) {
    var cv2g = mgCanvas(stage, 360), c = cv2g[0], g = cv2g[1];
    var targets = [], parts2 = [], points = 0, lastSpawn = 0, t0 = performance.now();
    var total = e.params.secs * 1000;
    function onTap(ev) {
      var p = stagePos(ev, c);
      for (var i = targets.length - 1; i >= 0; i--) {
        var t = targets[i];
        if (dist(p.x, p.y, t.x, t.y) < Math.max(14, t.r)) {
          targets.splice(i, 1);
          points++; api.score(points); sndPop();
          for (var k = 0; k < 8; k++) parts2.push({ x: t.x, y: t.y, a: Math.random() * TAU, at: performance.now() });
          return;
        }
      }
    }
    c.addEventListener('pointerdown', onTap);
    mgOn(function () { c.removeEventListener('pointerdown', onTap); });
    mgRaf(function (now) {
      var el = now - t0;
      if (el >= total) { api.done(points); return; }
      if (now - lastSpawn > e.params.spawnMs && targets.length < 7) {
        lastSpawn = now;
        targets.push({ x: 40 + Math.random() * 480, y: 46 + Math.random() * 280, r: e.params.r, at: now });
      }
      g.fillStyle = '#0a0618'; g.fillRect(0, 0, 560, 360);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 0, 560, 5);
      g.fillStyle = '#a78bfa'; g.fillRect(0, 0, 560 * (1 - el / total), 5);
      targets = targets.filter(function (t) { return now - t.at < 1200; });
      targets.forEach(function (t) {
        var k = 1 - (now - t.at) / 1200;
        var r = Math.max(4, t.r * k);
        g.fillStyle = 'rgba(125,211,252,.18)';
        g.beginPath(); g.arc(t.x, t.y, r + 9, 0, TAU); g.fill();
        var gr = g.createRadialGradient(t.x - r * 0.3, t.y - r * 0.3, 1, t.x, t.y, r);
        gr.addColorStop(0, '#e0f2fe'); gr.addColorStop(1, '#38bdf8');
        g.fillStyle = gr;
        g.beginPath(); g.arc(t.x, t.y, r, 0, TAU); g.fill();
      });
      parts2 = parts2.filter(function (p) { return now - p.at < 380; });
      parts2.forEach(function (p) {
        var age = (now - p.at) / 380;
        g.fillStyle = 'rgba(165,243,252,' + (1 - age) + ')';
        g.beginPath(); g.arc(p.x + Math.cos(p.a) * age * 30, p.y + Math.sin(p.a) * age * 30, 2.4, 0, TAU); g.fill();
      });
      g.fillStyle = 'rgba(243,239,255,.85)';
      g.font = '800 15px Inter, sans-serif'; g.textAlign = 'left';
      g.fillText(points + ' popped · ' + Math.ceil((total - el) / 1000) + 's', 12, 26);
    });
  },

  react: function (stage, api2, api) {
    stage.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'mg-react';
    stage.appendChild(box);
    var e = api2, round = 0, times = [], state = 'start', t0 = 0;
    function show(txt, bg) { box.textContent = txt; box.style.background = bg; }
    function startWait() {
      state = 'wait';
      show('wait for green…', '#7f1d2d');
      mgDelay(1100 + Math.random() * 2600, function () {
        if (state !== 'wait') return;
        state = 'go'; t0 = performance.now();
        show('TAP!', '#15803d');
      });
    }
    show('round 1 of ' + e.params.rounds + ' — tap to start', '#312e81');
    box.addEventListener('click', function () {
      if (state === 'start') { startWait(); }
      else if (state === 'wait') {
        state = 'start';
        show('too soon! tap to retry round ' + (round + 1), '#7f1d2d');
      } else if (state === 'go') {
        var ms = Math.round(performance.now() - t0);
        times.push(ms); round++;
        api.score(Math.max(0, Math.round((950 - ms) / 6.5)));
        if (round >= e.params.rounds) {
          var avg = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
          show(ms + 'ms! avg ' + Math.round(avg) + 'ms', '#312e81');
          api.done(Math.max(0, Math.min(100, Math.round((950 - avg) / 6.5))));
        } else {
          state = 'start';
          show(ms + 'ms — tap for round ' + (round + 1), '#312e81');
        }
      }
    });
  },

  memory: function (stage, e, api) {
    stage.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'mg-pads';
    stage.appendChild(wrap);
    var colors = ['#f472b6', '#38bdf8', '#ffd257', '#4ade80'];
    var pads = colors.map(function (col) {
      var d = document.createElement('div');
      d.className = 'mg-pad'; d.style.background = col;
      wrap.appendChild(d);
      return d;
    });
    var seq = [], round = 1, idx = 0, locked = true;
    for (var i = 0; i < e.params.len; i++) seq.push(Math.floor(Math.random() * 4));
    function flash(i, done) {
      pads[i].classList.add('lit');
      tone(320 + i * 130, 0, 0.16, 'sine', 0.12);
      mgDelay(e.params.speed * 0.62, function () {
        pads[i].classList.remove('lit');
        mgDelay(e.params.speed * 0.3, done);
      });
    }
    function playRound() {
      locked = true; idx = 0;
      api.score((round - 1) * 10);
      var k = 0;
      mgDelay(650, function next() {
        if (k >= round) { locked = false; return; }
        flash(seq[k], function () { k++; next(); });
      });
    }
    pads.forEach(function (pad, i) {
      pad.addEventListener('click', function () {
        if (locked) return;
        flash(i, function () { });
        if (i !== seq[idx]) { locked = true; api.done((round - 1) * 10); return; }
        idx++;
        if (idx >= round) {
          locked = true;
          if (round >= e.params.len) { api.done(e.params.len * 15); return; }
          round++;
          mgDelay(700, playRound);
        }
      });
    });
    playRound();
  },

  catch: function (stage, e, api) {
    var cv2g = mgCanvas(stage, 360), c = cv2g[0], g = cv2g[1];
    var bx = 280, drops = [], points = 0, lastSpawn = 0, t0 = performance.now(), last = performance.now();
    var keyL = false, keyR = false;
    function onMove(ev) { bx = stagePos(ev, c).x; }
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerdown', onMove);
    mgOn(function () { c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerdown', onMove); });
    mgKey(function (ev) {
      if (ev.key === 'ArrowLeft' || ev.key === 'a') keyL = true;
      if (ev.key === 'ArrowRight' || ev.key === 'd') keyR = true;
    });
    var upFn = function (ev) {
      if (ev.key === 'ArrowLeft' || ev.key === 'a') keyL = false;
      if (ev.key === 'ArrowRight' || ev.key === 'd') keyR = false;
    };
    window.addEventListener('keyup', upFn);
    mgOn(function () { window.removeEventListener('keyup', upFn); });
    mgRaf(function (now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var el = now - t0, total = e.params.secs * 1000;
      if (el >= total) { api.done(points); return; }
      if (keyL) bx -= 380 * dt;
      if (keyR) bx += 380 * dt;
      bx = clamp(bx, 40, 520);
      if (now - lastSpawn > 430) {
        lastSpawn = now;
        var roll = Math.random();
        var kind = roll < 0.08 ? 'gold' : (e.params.bombs && roll < 0.19 ? 'bomb' : 'shard');
        drops.push({ x: 24 + Math.random() * 512, y: -12, vy: e.params.fall * (0.85 + Math.random() * 0.3), kind: kind });
      }
      g.fillStyle = '#0a0618'; g.fillRect(0, 0, 560, 360);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 0, 560, 5);
      g.fillStyle = '#ffd257'; g.fillRect(0, 0, 560 * (1 - el / total), 5);
      drops = drops.filter(function (d) { return d.y < 380; });
      drops.forEach(function (d) {
        d.y += d.vy * dt;
        if (d.y > 316 && d.y < 348 && Math.abs(d.x - bx) < 46) {
          d.y = 999;
          if (d.kind === 'shard') points += 2;
          else if (d.kind === 'gold') { points += 6; sndPick(true); }
          else { points = Math.max(0, points - 4); tone(140, 0, 0.2, 'sawtooth', 0.1, 70); }
          if (d.kind !== 'bomb') sndPop();
          api.score(points);
          return;
        }
        if (d.kind === 'bomb') {
          g.fillStyle = '#1f2937';
          g.beginPath(); g.arc(d.x, d.y, 9, 0, TAU); g.fill();
          g.fillStyle = '#f87171';
          g.beginPath(); g.arc(d.x + 3, d.y - 8, 2.6, 0, TAU); g.fill();
        } else {
          g.save(); g.translate(d.x, d.y); g.rotate(now / 500 + d.x);
          g.fillStyle = d.kind === 'gold' ? '#ffd257' : '#7dd3fc';
          g.shadowColor = g.fillStyle; g.shadowBlur = 10;
          var r = d.kind === 'gold' ? 8 : 6.4;
          g.fillRect(-r / 1.4, -r / 1.4, r * 1.42, r * 1.42);
          g.restore();
        }
      });
      g.fillStyle = '#8b7cff';
      rr(g, bx - 40, 326, 80, 13, 6); g.fill();
      g.fillStyle = 'rgba(230,228,255,.5)';
      rr(g, bx - 40, 326, 80, 4, 2); g.fill();
      g.fillStyle = 'rgba(243,239,255,.85)';
      g.font = '800 15px Inter, sans-serif'; g.textAlign = 'left';
      g.fillText(points + ' pts · ' + Math.ceil((total - el) / 1000) + 's', 12, 26);
    });
  },

  maze: function (stage, e, api) {
    stage.innerHTML = '';
    var rng = mgRng(e.params.seed);
    var W = e.params.w, H = e.params.h;
    var cell = Math.floor(500 / Math.max(W, H));
    var c = document.createElement('canvas');
    c.width = cell * W; c.height = cell * H;
    c.style.margin = '0 auto';
    stage.appendChild(c);
    var g = c.getContext('2d');
    // walls: vW[y][x] = wall right of cell, hW[y][x] = wall below cell
    var vW = [], hW = [], vis = [];
    for (var y = 0; y < H; y++) { vW.push([]); hW.push([]); vis.push([]); for (var x = 0; x < W; x++) { vW[y].push(1); hW[y].push(1); vis[y].push(0); } }
    var stack = [[0, 0]]; vis[0][0] = 1;
    while (stack.length) {
      var cur = stack[stack.length - 1], cx3 = cur[0], cy3 = cur[1], nbs = [];
      if (cx3 > 0 && !vis[cy3][cx3 - 1]) nbs.push([cx3 - 1, cy3, 'l']);
      if (cx3 < W - 1 && !vis[cy3][cx3 + 1]) nbs.push([cx3 + 1, cy3, 'r']);
      if (cy3 > 0 && !vis[cy3 - 1][cx3]) nbs.push([cx3, cy3 - 1, 'u']);
      if (cy3 < H - 1 && !vis[cy3 + 1][cx3]) nbs.push([cx3, cy3 + 1, 'd']);
      if (!nbs.length) { stack.pop(); continue; }
      var nb = nbs[Math.floor(rng() * nbs.length)];
      if (nb[2] === 'l') vW[cy3][cx3 - 1] = 0;
      if (nb[2] === 'r') vW[cy3][cx3] = 0;
      if (nb[2] === 'u') hW[cy3 - 1][cx3] = 0;
      if (nb[2] === 'd') hW[cy3][cx3] = 0;
      vis[nb[1]][nb[0]] = 1;
      stack.push([nb[0], nb[1]]);
    }
    var px2 = 0, py2 = 0, t0 = 0, steps = 0, won = false;
    function draw() {
      g.fillStyle = '#0d0920'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(255,210,87,.16)';
      g.fillRect((W - 1) * cell, (H - 1) * cell, cell, cell);
      g.strokeStyle = '#8b7cff'; g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(c.width, 0); g.moveTo(0, c.height); g.lineTo(c.width, c.height);
      g.moveTo(0, 0); g.lineTo(0, c.height); g.moveTo(c.width, 0); g.lineTo(c.width, c.height);
      for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
        if (vW[yy][xx]) { g.moveTo((xx + 1) * cell, yy * cell); g.lineTo((xx + 1) * cell, (yy + 1) * cell); }
        if (hW[yy][xx]) { g.moveTo(xx * cell, (yy + 1) * cell); g.lineTo((xx + 1) * cell, (yy + 1) * cell); }
      }
      g.stroke();
      g.fillStyle = '#ffd257';
      star4(g, (W - 0.5) * cell, (H - 0.5) * cell, cell * 0.3, performance.now() / 700);
      g.fill();
      g.fillStyle = '#e9e4ff';
      g.beginPath(); g.arc((px2 + 0.5) * cell, (py2 + 0.5) * cell, cell * 0.3, 0, TAU); g.fill();
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc((px2 + 0.5) * cell - cell * 0.1, (py2 + 0.5) * cell - cell * 0.04, cell * 0.045, 0, TAU); g.arc((px2 + 0.5) * cell + cell * 0.1, (py2 + 0.5) * cell - cell * 0.04, cell * 0.045, 0, TAU); g.fill();
    }
    function move(dx, dy) {
      if (won) return;
      if (!t0) t0 = performance.now();
      var nx = px2 + dx, ny = py2 + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
      if (dx === 1 && vW[py2][px2]) return;
      if (dx === -1 && vW[py2][px2 - 1]) return;
      if (dy === 1 && hW[py2][px2]) return;
      if (dy === -1 && hW[py2 - 1][px2]) return;
      px2 = nx; py2 = ny; steps++;
      draw();
      if (px2 === W - 1 && py2 === H - 1) {
        won = true;
        var secs = (performance.now() - t0) / 1000;
        api.done(Math.max(10, Math.min(e.maxPoints, Math.round(e.maxPoints - secs * 1.5))));
      }
    }
    mgKey(function (ev) {
      var k = ev.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') { ev.preventDefault(); move(0, -1); }
      else if (k === 'arrowdown' || k === 's') { ev.preventDefault(); move(0, 1); }
      else if (k === 'arrowleft' || k === 'a') { ev.preventDefault(); move(-1, 0); }
      else if (k === 'arrowright' || k === 'd') { ev.preventDefault(); move(1, 0); }
    });
    mgDpad(stage, function (d) {
      if (d === 'u') move(0, -1); else if (d === 'd') move(0, 1);
      else if (d === 'l') move(-1, 0); else move(1, 0);
    });
    c.addEventListener('pointerdown', function (ev) {
      var p = stagePos(ev, c);
      var tx = Math.floor(p.x / cell), ty = Math.floor(p.y / cell);
      if (Math.abs(tx - px2) + Math.abs(ty - py2) === 1) move(tx - px2, ty - py2);
    });
    draw();
    mgTimer(240, function () { if (!won) draw(); });
  },

  stack: function (stage, e, api) {
    var cv2g = mgCanvas(stage, 360), c = cv2g[0], g = cv2g[1];
    var blocks = [{ x: 190, w: 180 }], cur = null, dirS = 1, locks = 0, perfects = 0, points = 0, last = performance.now();
    function spawn() {
      var top = blocks[blocks.length - 1];
      cur = { x: dirS > 0 ? -top.w + 4 : 560 - 4, w: top.w };
    }
    spawn();
    function lock() {
      if (!cur) return;
      var top = blocks[blocks.length - 1];
      var nx = Math.max(cur.x, top.x), nw = Math.min(cur.x + cur.w, top.x + top.w) - nx;
      if (nw <= 6) { api.done(points); cur = null; return; }
      var perfect = Math.abs(cur.x - top.x) < 5;
      if (perfect) { perfects++; nw = Math.min(top.w, nw + 6); nx = top.x + (top.w - nw) / 2; tone(760 + locks * 40, 0, 0.12, 'sine', 0.1); }
      else sndPop();
      blocks.push({ x: nx, w: nw });
      locks++;
      points = locks * 10 + perfects * 4;
      api.score(points);
      if (locks >= e.params.levels) { api.done(points); cur = null; return; }
      dirS = Math.random() < 0.5 ? 1 : -1;
      spawn();
    }
    c.addEventListener('pointerdown', lock);
    mgOn(function () { c.removeEventListener('pointerdown', lock); });
    mgKey(function (ev) { if (ev.key === ' ') { ev.preventDefault(); lock(); } });
    mgRaf(function (now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (cur) {
        cur.x += dirS * 150 * e.params.speed * (1 + locks * 0.07) * dt;
        if (cur.x > 560) { cur.x = 560; dirS = -1; }
        if (cur.x + cur.w < 0) { cur.x = -cur.w; dirS = 1; }
      }
      g.fillStyle = '#0a0618'; g.fillRect(0, 0, 560, 360);
      var bh = 24, totalH = blocks.length * bh;
      var offY = Math.max(0, totalH - 300);
      blocks.forEach(function (b, i) {
        var y = 348 - (i + 1) * bh + offY;
        var hue = 258 + i * 9;
        g.fillStyle = 'hsl(' + hue + ',65%,' + (46 + (i % 3) * 5) + '%)';
        rr(g, b.x, y, b.w, bh - 2, 3); g.fill();
        g.fillStyle = 'rgba(255,255,255,.25)';
        g.fillRect(b.x + 2, y + 2, b.w - 4, 2);
      });
      if (cur) {
        var cy = 348 - (blocks.length + 1) * bh + offY;
        g.fillStyle = 'hsl(' + (258 + blocks.length * 9) + ',80%,66%)';
        rr(g, cur.x, cy, cur.w, bh - 2, 3); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.4;
        rr(g, cur.x, cy, cur.w, bh - 2, 3); g.stroke();
      }
      g.fillStyle = 'rgba(243,239,255,.85)';
      g.font = '800 15px Inter, sans-serif'; g.textAlign = 'left';
      g.fillText('level ' + (locks + 1) + ' / ' + e.params.levels + ' · ' + points + ' pts', 12, 26);
    });
  },

  quiz: function (stage, e, api) {
    stage.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'mg-quiz';
    stage.appendChild(wrap);
    var rng = mgRng(e.params.seed);
    var pool = (QBANK[e.params.topic] || QBANK.mixed).slice();
    var qs = [];
    while (qs.length < 4 && pool.length) qs.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    var extra = QBANK.mixed[Math.floor(rng() * QBANK.mixed.length)];
    if (qs.indexOf(extra) < 0) qs.push(extra);
    var qi = 0, points = 0, busy = false;
    function renderQ() {
      busy = false;
      wrap.innerHTML = '';
      var item = qs[qi];
      var q = document.createElement('div');
      q.className = 'q';
      q.textContent = (qi + 1) + '/5 · ' + item.q;
      wrap.appendChild(q);
      var order = [0, 1, 2, 3];
      for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
      order.forEach(function (ai) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.a[ai];
        b.addEventListener('click', function () {
          if (busy) return;
          busy = true;
          if (ai === item.c) { b.classList.add('right'); points += 20; api.score(points); sndPick(false); }
          else {
            b.classList.add('wrong');
            Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (bb, bi) {
              if (item.a.indexOf(bb.textContent) === item.c) bb.classList.add('right');
            });
            tone(150, 0, 0.2, 'sawtooth', 0.08, 90);
          }
          qi++;
          mgDelay(750, function () { if (qi >= qs.length) api.done(points); else renderQ(); });
        });
        wrap.appendChild(b);
      });
    }
    renderQ();
  },

  snake: function (stage, e, api) {
    stage.innerHTML = '';
    var N = e.params.grid, cell = Math.floor(500 / N);
    var c = document.createElement('canvas');
    c.width = cell * N; c.height = cell * N;
    c.style.margin = '0 auto';
    stage.appendChild(c);
    var g = c.getContext('2d');
    var rng = mgRng(987 + N * 7 + e.params.speed);
    var snake = [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }, { x: 5, y: 8 }];
    var dirS = { x: 1, y: 0 }, want = { x: 1, y: 0 }, apple = null, points = 0, acc = 0, last = performance.now(), dead = false;
    function dropApple() {
      for (var tries = 0; tries < 60; tries++) {
        var ax = Math.floor(rng() * N), ay = Math.floor(rng() * N);
        if (!snake.some(function (s) { return s.x === ax && s.y === ay; })) { apple = { x: ax, y: ay }; return; }
      }
      apple = { x: 0, y: 0 };
    }
    dropApple();
    function steer(d) {
      var nd = d === 'u' ? { x: 0, y: -1 } : d === 'd' ? { x: 0, y: 1 } : d === 'l' ? { x: -1, y: 0 } : { x: 1, y: 0 };
      if (nd.x !== -dirS.x || nd.y !== -dirS.y) want = nd;
    }
    mgKey(function (ev) {
      var k = ev.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') { ev.preventDefault(); steer('u'); }
      else if (k === 'arrowdown' || k === 's') { ev.preventDefault(); steer('d'); }
      else if (k === 'arrowleft' || k === 'a') { ev.preventDefault(); steer('l'); }
      else if (k === 'arrowright' || k === 'd') { ev.preventDefault(); steer('r'); }
    });
    mgDpad(stage, steer);
    mgRaf(function (now) {
      var dt = (now - last) / 1000; last = now;
      acc += dt;
      var step = 1 / e.params.speed;
      while (acc >= step && !dead) {
        acc -= step;
        dirS = want;
        var head = { x: snake[0].x + dirS.x, y: snake[0].y + dirS.y };
        if (e.params.walls) {
          if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N) { dead = true; break; }
        } else {
          head.x = (head.x + N) % N; head.y = (head.y + N) % N;
        }
        if (snake.some(function (s) { return s.x === head.x && s.y === head.y; })) { dead = true; break; }
        snake.unshift(head);
        if (apple && head.x === apple.x && head.y === apple.y) {
          points += 10; api.score(points); sndPick(false);
          if (points >= e.maxPoints) { dead = true; api.done(points); return; }
          dropApple();
        } else snake.pop();
      }
      g.fillStyle = '#0a0618'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = 'rgba(139,124,255,.07)';
      for (var i = 1; i < N; i++) {
        g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, c.height); g.stroke();
        g.beginPath(); g.moveTo(0, i * cell); g.lineTo(c.width, i * cell); g.stroke();
      }
      if (apple) {
        g.fillStyle = '#f87171';
        g.beginPath(); g.arc((apple.x + 0.5) * cell, (apple.y + 0.5) * cell, cell * 0.34, 0, TAU); g.fill();
        g.fillStyle = '#4ade80';
        g.fillRect((apple.x + 0.5) * cell - 1, (apple.y + 0.14) * cell, 2, cell * 0.2);
      }
      snake.forEach(function (s, i2) {
        g.fillStyle = i2 === 0 ? '#4ade80' : 'hsl(140,55%,' + (42 - Math.min(20, i2)) + '%)';
        rr(g, s.x * cell + 1.4, s.y * cell + 1.4, cell - 2.8, cell - 2.8, 4); g.fill();
        if (i2 === 0) {
          g.fillStyle = '#0b1f10';
          g.beginPath(); g.arc((s.x + 0.36) * cell, (s.y + 0.4) * cell, 1.8, 0, TAU); g.arc((s.x + 0.64) * cell, (s.y + 0.4) * cell, 1.8, 0, TAU); g.fill();
        }
      });
      if (dead) { api.done(points); }
    });
  },

  plat: function (stage, e, api) {
    var cvp = mgCanvas(stage, 360), c = cvp[0], g = cvp[1];
    var rnd = mulberry(e.params.seed || 7);
    var plats = [{ x: 0, y: 324, w: 560, h: 36 }];
    for (var i = 0; i < 7; i++) {
      var pw = 76 + rnd() * 58;
      plats.push({ x: 16 + rnd() * (560 - pw - 32), y: Math.max(64, 258 - i * 30 - rnd() * 8), w: pw, h: 12 });
    }
    var coins = [];
    for (var ci = 0; ci < e.params.coins; ci++) {
      var pl = plats[1 + (ci % (plats.length - 1))];
      coins.push({ x: pl.x + 14 + ((ci * 41) % Math.max(16, pl.w - 28)), y: pl.y - 15, got: false, ph: rnd() * TAU });
    }
    var P2 = { x: 28, y: 280, vx: 0, vy: 0, onG: false };
    var keys2 = {}, touch = { l: false, r: false, j: false };
    var kd = function (ev) { keys2[ev.key.toLowerCase()] = true; if (['arrowleft', 'arrowright', 'arrowup', ' '].indexOf(ev.key.toLowerCase()) >= 0) ev.preventDefault(); };
    var ku = function (ev) { keys2[ev.key.toLowerCase()] = false; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    mgOn(function () { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); });
    var pd = function (ev) { var p = stagePos(ev, c); if (p.y < 240) return; if (p.x < 100) touch.l = true; else if (p.x < 200) touch.r = true; else if (p.x > 430) touch.j = true; };
    var pu = function () { touch.l = touch.r = touch.j = false; };
    c.addEventListener('pointerdown', pd); c.addEventListener('pointerup', pu); c.addEventListener('pointerleave', pu);
    mgOn(function () { c.removeEventListener('pointerdown', pd); c.removeEventListener('pointerup', pu); c.removeEventListener('pointerleave', pu); });
    var t0 = performance.now(), total = e.params.secs * 1000, last = t0, got = 0, ended = false;
    mgRaf(function (now) {
      if (ended) return;
      var dt = Math.min(0.032, (now - last) / 1000); last = now;
      var el = now - t0;
      if (el >= total) { ended = true; api.done(got * 10); return; }
      var L = keys2['arrowleft'] || keys2['a'] || touch.l, R = keys2['arrowright'] || keys2['d'] || touch.r, J2 = keys2['arrowup'] || keys2['w'] || keys2[' '] || touch.j;
      P2.vx = (R ? 245 : 0) - (L ? 245 : 0);
      if (J2 && P2.onG) { P2.vy = -575; P2.onG = false; }
      P2.vy = Math.min(900, P2.vy + 1500 * dt);
      P2.x += P2.vx * dt; P2.y += P2.vy * dt;
      P2.x = clamp(P2.x, 4, 536);
      var wasFalling = P2.vy >= 0;
      P2.onG = false;
      plats.forEach(function (pl) {
        if (wasFalling && P2.x + 20 > pl.x && P2.x < pl.x + pl.w && P2.y + 22 >= pl.y && P2.y + 22 <= pl.y + pl.h + Math.max(0, P2.vy * dt) + 3) { P2.y = pl.y - 22; P2.vy = 0; P2.onG = true; }
      });
      if (P2.y > 380) { P2.x = 28; P2.y = 270; P2.vy = 0; }
      coins.forEach(function (cn) {
        if (!cn.got && Math.abs(P2.x + 10 - cn.x) < 24 && Math.abs(P2.y + 8 - cn.y) < 26) { cn.got = true; got++; api.score(got * 10); sndPick(false); }
      });
      if (got >= e.params.coins) { ended = true; api.done(got * 10 + Math.min(30, Math.ceil((total - el) / 1000))); return; }
      g.fillStyle = '#0a0618'; g.fillRect(0, 0, 560, 360);
      var bg = g.createLinearGradient(0, 0, 0, 360); bg.addColorStop(0, 'rgba(76,29,149,.25)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = bg; g.fillRect(0, 0, 560, 360);
      plats.forEach(function (pl, ix) {
        g.fillStyle = ix === 0 ? '#2c2752' : '#3b2f6e'; rr(g, pl.x, pl.y, pl.w, pl.h, 6); g.fill();
        g.fillStyle = 'rgba(196,181,253,.5)'; g.fillRect(pl.x + 3, pl.y, pl.w - 6, 3);
      });
      coins.forEach(function (cn) {
        if (cn.got) return;
        var bob = Math.sin(now / 380 + cn.ph) * 3;
        g.fillStyle = '#ffd257'; g.shadowColor = '#ffd257'; g.shadowBlur = 10;
        g.beginPath(); g.arc(cn.x, cn.y + bob, 7, 0, TAU); g.fill(); g.shadowBlur = 0;
        g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(cn.x - 2, cn.y + bob - 2, 2.4, 0, TAU); g.fill();
      });
      g.fillStyle = '#fda4af'; rr(g, P2.x, P2.y, 20, 22, 6); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(P2.x + (P2.vx < 0 ? 6 : 13), P2.y + 8, 2.4, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,.07)'; rr(g, 8, 268, 84, 84, 12); g.fill(); rr(g, 104, 268, 84, 84, 12); g.fill(); rr(g, 452, 268, 100, 84, 12); g.fill();
      g.fillStyle = 'rgba(243,239,255,.75)'; g.font = '800 20px Inter, sans-serif'; g.textAlign = 'center';
      g.fillText('\u25c0', 50, 318); g.fillText('\u25b6', 146, 318); g.font = '800 13px Inter, sans-serif'; g.fillText('JUMP', 502, 316);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 0, 560, 5);
      g.fillStyle = '#a78bfa'; g.fillRect(0, 0, 560 * (1 - el / total), 5);
      g.fillStyle = 'rgba(243,239,255,.85)'; g.font = '800 14px Inter, sans-serif'; g.textAlign = 'left';
      g.fillText('coins ' + got + '/' + e.params.coins + ' \u00b7 ' + Math.ceil((total - el) / 1000) + 's', 10, 24);
    });
  },

  race: function (stage, e, api) {
    var cvr = mgCanvas(stage, 360), c = cvr[0], g = cvr[1];
    var rnd = mulberry(e.params.seed || 11);
    var gates = [];
    for (var i = 0; i < e.params.gates; i++) gates.push({ x: 60 + rnd() * 440, y: 60 + rnd() * 240, r: 27 });
    var O = { x: 280, y: 312, vx: 0, vy: 0 };
    var gi = 0, keys2 = {}, ptr = null, ended = false;
    var kd = function (ev) { keys2[ev.key.toLowerCase()] = true; if (ev.key.toLowerCase().indexOf('arrow') === 0) ev.preventDefault(); };
    var ku = function (ev) { keys2[ev.key.toLowerCase()] = false; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    mgOn(function () { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); });
    var pd = function (ev) { ptr = stagePos(ev, c); };
    var pm = function (ev) { if (ptr) ptr = stagePos(ev, c); };
    var pu2 = function () { ptr = null; };
    c.addEventListener('pointerdown', pd); c.addEventListener('pointermove', pm); c.addEventListener('pointerup', pu2); c.addEventListener('pointerleave', pu2);
    mgOn(function () { c.removeEventListener('pointerdown', pd); c.removeEventListener('pointermove', pm); c.removeEventListener('pointerup', pu2); c.removeEventListener('pointerleave', pu2); });
    var t0 = performance.now(), total = e.params.secs * 1000, last = t0;
    mgRaf(function (now) {
      if (ended) return;
      var dt = Math.min(0.032, (now - last) / 1000); last = now;
      var el = now - t0;
      if (el >= total) { ended = true; api.done(gi * 8); return; }
      var ax = 0, ay = 0;
      if (ptr) { var dx = ptr.x - O.x, dy = ptr.y - O.y, dl = Math.hypot(dx, dy) || 1; ax = dx / dl * 1600; ay = dy / dl * 1600; }
      if (keys2['arrowleft'] || keys2['a']) ax -= 1200;
      if (keys2['arrowright'] || keys2['d']) ax += 1200;
      if (keys2['arrowup'] || keys2['w']) ay -= 1200;
      if (keys2['arrowdown'] || keys2['s']) ay += 1200;
      O.vx += ax * dt; O.vy += ay * dt;
      O.vx -= O.vx * 2.6 * dt; O.vy -= O.vy * 2.6 * dt;
      O.x = clamp(O.x + O.vx * dt, 14, 546); O.y = clamp(O.y + O.vy * dt, 14, 346);
      var gt = gates[gi];
      if (gt && dist(O.x, O.y, gt.x, gt.y) < gt.r) {
        gi++; sndPick(gi >= gates.length);
        if (gi >= gates.length) { ended = true; api.done(gi * 8 + Math.min(30, Math.ceil((total - el) / 1000))); return; }
        api.score(gi * 8);
      }
      g.fillStyle = '#0a0618'; g.fillRect(0, 0, 560, 360);
      gates.forEach(function (gt2, ix) {
        if (ix < gi) { g.strokeStyle = 'rgba(52,211,153,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(gt2.x, gt2.y, gt2.r, 0, TAU); g.stroke(); return; }
        if (ix === gi) {
          var pu3 = 1 + Math.sin(now / 200) * 0.1;
          g.strokeStyle = '#ffd257'; g.lineWidth = 3.4; g.shadowColor = '#ffd257'; g.shadowBlur = 14;
          g.beginPath(); g.arc(gt2.x, gt2.y, gt2.r * pu3, 0, TAU); g.stroke(); g.shadowBlur = 0;
          g.fillStyle = '#ffd257'; g.font = '800 13px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(String(ix + 1), gt2.x, gt2.y + 4);
        } else {
          g.strokeStyle = 'rgba(196,181,253,.3)'; g.lineWidth = 2; g.beginPath(); g.arc(gt2.x, gt2.y, gt2.r, 0, TAU); g.stroke();
          g.fillStyle = 'rgba(196,181,253,.5)'; g.font = '800 12px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(String(ix + 1), gt2.x, gt2.y + 4);
        }
      });
      if (gt) { g.strokeStyle = 'rgba(255,210,87,.25)'; g.setLineDash([4, 7]); g.beginPath(); g.moveTo(O.x, O.y); g.lineTo(gt.x, gt.y); g.stroke(); g.setLineDash([]); }
      g.fillStyle = '#7dd3fc'; g.shadowColor = '#7dd3fc'; g.shadowBlur = 16;
      g.beginPath(); g.arc(O.x, O.y, 11, 0, TAU); g.fill(); g.shadowBlur = 0;
      g.fillStyle = '#e0f2fe'; g.beginPath(); g.arc(O.x - 3, O.y - 3, 4, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 0, 560, 5);
      g.fillStyle = '#38bdf8'; g.fillRect(0, 0, 560 * (1 - el / total), 5);
      g.fillStyle = 'rgba(243,239,255,.85)'; g.font = '800 14px Inter, sans-serif'; g.textAlign = 'left';
      g.fillText('gate ' + Math.min(gi + 1, gates.length) + '/' + gates.length + ' \u00b7 ' + Math.ceil((total - el) / 1000) + 's', 10, 24);
    });
  },

  rhythm: function (stage, e, api) {
    var cvy = mgCanvas(stage, 360), c = cvy[0], g = cvy[1];
    var rnd = mulberry(e.params.seed || 13);
    var beat = 60000 / e.params.bpm, fall = 1150, lineY = 296;
    var notes = [];
    for (var i = 0; i < e.params.notes; i++) notes.push({ lane: Math.floor(rnd() * 4), at: i * beat, hit: 0, judged: false });
    var score = 0, judge = '', judgeAt = 0, ended = false;
    var t0 = performance.now() + 900;
    var freqs = [262, 330, 392, 523];
    var laneCols = ['#f472b6', '#38bdf8', '#ffd257', '#34d399'];
    function laneX(l) { return 118 + l * 108; }
    function tap(lane, now) {
      var t = now - t0, best = null, bd = 1e9;
      notes.forEach(function (nt) { if (nt.lane === lane && !nt.hit) { var d = Math.abs(nt.at - t); if (d < bd) { bd = d; best = nt; } } });
      if (best && bd <= beat * 0.24 + 60) {
        if (bd <= 62) { best.hit = 3; score += 3; judge = 'PERFECT'; tone(freqs[lane], 0, .18, 'triangle', .15); }
        else { best.hit = 1; score += 1; judge = 'good'; tone(freqs[lane], 0, .14, 'triangle', .1); }
        judgeAt = now; api.score(score);
      }
    }
    var kd = function (ev) { var idx = ['d', 'f', 'j', 'k'].indexOf(ev.key.toLowerCase()); if (idx >= 0) tap(idx, performance.now()); };
    window.addEventListener('keydown', kd);
    mgOn(function () { window.removeEventListener('keydown', kd); });
    var pd = function (ev) { var p = stagePos(ev, c); var lane = Math.floor((p.x - 64) / 108); if (lane >= 0 && lane < 4) tap(lane, performance.now()); };
    c.addEventListener('pointerdown', pd);
    mgOn(function () { c.removeEventListener('pointerdown', pd); });
    mgRaf(function (now) {
      if (ended) return;
      var t = now - t0;
      var lastEnd = (e.params.notes - 1) * beat + 1500;
      if (t > lastEnd) { ended = true; api.done(score); return; }
      g.fillStyle = '#0a0618'; g.fillRect(0, 0, 560, 360);
      for (var l = 0; l < 4; l++) {
        g.fillStyle = l % 2 ? 'rgba(255,255,255,.028)' : 'rgba(255,255,255,0)';
        g.fillRect(laneX(l) - 52, 0, 104, 360);
        g.fillStyle = laneCols[l]; g.globalAlpha = .85;
        rr(g, laneX(l) - 30, lineY + 22, 60, 30, 9); g.fill(); g.globalAlpha = 1;
        g.fillStyle = '#0d0a1f'; g.font = '800 15px Inter, sans-serif'; g.textAlign = 'center';
        g.fillText('DFJK'[l], laneX(l), lineY + 42);
      }
      g.strokeStyle = 'rgba(243,239,255,.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(56, lineY); g.lineTo(504, lineY); g.stroke();
      notes.forEach(function (nt) {
        if (nt.hit) return;
        var y = lineY - (nt.at - t) * (lineY - 18) / fall;
        if (y < -20) return;
        if (t > nt.at + 150) { nt.hit = -1; if (!nt.judged) { nt.judged = true; judge = 'miss'; judgeAt = now; } return; }
        g.fillStyle = laneCols[nt.lane]; g.shadowColor = laneCols[nt.lane]; g.shadowBlur = 10;
        g.save(); g.translate(laneX(nt.lane), y); g.rotate(Math.PI / 4);
        g.fillRect(-13, -13, 26, 26); g.restore(); g.shadowBlur = 0;
      });
      if (judge && now - judgeAt < 620) {
        g.globalAlpha = 1 - (now - judgeAt) / 620;
        g.fillStyle = judge === 'PERFECT' ? '#ffd257' : judge === 'good' ? '#a5f3fc' : '#fb7185';
        g.font = '800 24px Inter, sans-serif'; g.textAlign = 'center';
        g.fillText(judge, 280, 120);
        g.globalAlpha = 1;
      }
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 0, 560, 5);
      g.fillStyle = '#f472b6'; g.fillRect(0, 0, 560 * clamp(t / lastEnd, 0, 1), 5);
      g.fillStyle = 'rgba(243,239,255,.85)'; g.font = '800 14px Inter, sans-serif'; g.textAlign = 'left';
      g.fillText(score + ' pts \u00b7 ' + e.params.bpm + ' bpm', 10, 24);
    });
  },

  slide: function (stage, e, api) {
    stage.innerHTML = '';
    var n = e.params.size, N = n * n, BLANK = N - 1;
    var wrap = document.createElement('div'); wrap.className = 'mg-slide';
    var hud = document.createElement('div'); hud.className = 'mg-slide-hud';
    var board = document.createElement('div'); board.className = 'mg-slide-board';
    wrap.appendChild(hud); wrap.appendChild(board); stage.appendChild(wrap);
    var tilePx = n === 3 ? 102 : 78, gapPx = 5;
    board.style.width = board.style.height = (n * (tilePx + gapPx) + gapPx) + 'px';
    var tiles = []; for (var i0 = 0; i0 < N; i0++) tiles.push(i0);
    var blank = BLANK, moves = 0, startedAt = 0, finished = false;
    function neighbors(idx) { var r = Math.floor(idx / n), cc = idx % n, out = []; if (r > 0) out.push(idx - n); if (r < n - 1) out.push(idx + n); if (cc > 0) out.push(idx - 1); if (cc < n - 1) out.push(idx + 1); return out; }
    var lastBlank = -1;
    for (var s = 0; s < 90; s++) {
      var opts = neighbors(blank).filter(function (x) { return x !== lastBlank; });
      var pick = opts[Math.floor(Math.random() * opts.length)];
      tiles[blank] = tiles[pick]; tiles[pick] = BLANK; lastBlank = blank; blank = pick;
    }
    function homeCount() { var h2 = 0; for (var i = 0; i < N; i++) if (tiles[i] === i) h2++; return h2; }
    function render() {
      board.innerHTML = '';
      for (var idx = 0; idx < N; idx++) {
        var val = tiles[idx];
        if (val === BLANK) continue;
        var d = document.createElement('div');
        d.className = 'mg-tile';
        d.style.width = d.style.height = tilePx + 'px';
        d.style.left = (gapPx + (idx % n) * (tilePx + gapPx)) + 'px';
        d.style.top = (gapPx + Math.floor(idx / n) * (tilePx + gapPx)) + 'px';
        d.style.background = 'hsl(' + (258 - Math.round(val * 150 / (N - 1))) + ', 75%, 66%)';
        d.textContent = val + 1;
        d.setAttribute('data-idx', idx);
        board.appendChild(d);
      }
      hud.textContent = 'moves ' + moves + ' \u00b7 tiles home ' + homeCount() + '/' + (N - 1) + ' \u00b7 tap a tile next to the gap';
    }
    function finish(points) { if (finished) return; finished = true; api.done(points); }
    board.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute || t.getAttribute('data-idx') == null) return;
      var idx = Number(t.getAttribute('data-idx'));
      if (neighbors(blank).indexOf(idx) < 0) return;
      tiles[blank] = tiles[idx]; tiles[idx] = BLANK; blank = idx; moves++;
      if (!startedAt) startedAt = performance.now();
      sndPop();
      render();
      api.score(homeCount() * 2);
      if (homeCount() === N) {
        var secs = Math.floor((performance.now() - startedAt) / 1000);
        finish(Math.max(10, 100 - moves - Math.floor(secs / 2)));
      }
    });
    render();
    api.score(homeCount() * 2);
    mgDelay(150000, function () { finish(homeCount() * 2); });
  }
};


/* ---------------- six cents shop ---------------- */
var myInv = [], myWearIds = {}, shopTab = 'all', shopQuery = '', centsBal = 0;
var pets = {};
var RAR_C = { common: '#9ca3af', rare: '#38bdf8', epic: '#c084fc', legendary: '#ffd257' };
var TENT = { x: 3950, y: 1600 };
OBS.push({ x: TENT.x, y: TENT.y, r: 36 });
function setCentsBal(n) {
  centsBal = n;
  if ($('wbal')) $('wbal').textContent = '¢ ' + n + ' six cents';
  if (window.__shopOpen) $('wsh-bal').textContent = '¢ ' + n + ' six cents';
}
function drawTent(g, now) {
  var x = TENT.x, y = TENT.y;
  g.fillStyle = 'rgba(0,0,0,.45)';
  g.beginPath(); g.ellipse(x, y + 26, 56, 10, 0, 0, TAU); g.fill();
  g.fillStyle = '#241534'; g.fillRect(x - 46, y - 6, 92, 32);
  g.fillStyle = '#ffd257';
  g.beginPath(); g.moveTo(x - 58, y - 6); g.lineTo(x, y - 40); g.lineTo(x + 58, y - 6); g.closePath(); g.fill();
  g.fillStyle = '#b8860b';
  g.beginPath(); g.moveTo(x - 58, y - 6); g.lineTo(x, y - 40); g.lineTo(x - 30, y - 6); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(x + 58, y - 6); g.lineTo(x, y - 40); g.lineTo(x + 30, y - 6); g.closePath(); g.fill();
  g.fillStyle = '#17102e';
  rr(g, x - 34, y - 24, 68, 13, 4); g.fill();
  g.fillStyle = '#ffd257';
  g.font = '800 8.5px Inter, sans-serif'; g.textAlign = 'center';
  g.fillText('SIX CENTS SHOP', x, y - 14.5);
  g.fillStyle = '#ffd9a0'; g.shadowColor = '#ffca7a'; g.shadowBlur = 9;
  g.beginPath(); g.arc(x - 40, y + 4, 2.6, 0, TAU); g.arc(x + 40, y + 4, 2.6, 0, TAU); g.fill();
  g.shadowBlur = 0;
}
function drawHat(g, hat, now) {
  var c = hat.c;
  g.fillStyle = c; g.strokeStyle = c;
  switch (hat.kind) {
    case 'cap':
      g.save(); g.rotate(-0.07);
      g.beginPath(); g.arc(0, -11, 8.6, Math.PI, TAU); g.fill();
      g.fillRect(-8.6, -12.6, 17.2, 3.2);
      g.beginPath(); g.ellipse(6.5, -10.6, 6.8, 2.1, 0.1, 0, TAU); g.fill();
      g.restore();
      break;
    case 'crown':
      g.beginPath();
      g.moveTo(-9, -11.5); g.lineTo(-9, -21); g.lineTo(-4.5, -15.5); g.lineTo(0, -23.5); g.lineTo(4.5, -15.5); g.lineTo(9, -21); g.lineTo(9, -11.5); g.closePath(); g.fill();
      break;
    case 'halo':
      g.lineWidth = 2.6;
      g.beginPath(); g.ellipse(0, -24.5 + Math.sin(now / 500) * 1.2, 8.6, 3, 0, 0, TAU); g.stroke();
      break;
    case 'horns':
      g.beginPath(); g.moveTo(-11.5, -11); g.lineTo(-5.5, -13.5); g.lineTo(-10.5, -20.5); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(11.5, -11); g.lineTo(5.5, -13.5); g.lineTo(10.5, -20.5); g.closePath(); g.fill();
      break;
    case 'beanie':
      g.beginPath(); g.arc(0, -11.5, 9.2, Math.PI, TAU); g.fill();
      g.fillRect(-9.2, -13.8, 18.4, 4);
      g.beginPath(); g.arc(0, -21.5, 3.3, 0, TAU); g.fill();
      break;
    case 'wizard':
      g.beginPath(); g.moveTo(3, -31); g.lineTo(-9.5, -11.5); g.lineTo(9, -11.5); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(0, -11.5, 12, 3.2, 0, 0, TAU); g.fill();
      g.fillStyle = '#fff7cc'; star4(g, 0.5, -19, 3, now / 900); g.fill(); g.fillStyle = c;
      break;
    case 'antenna':
      g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, -16); g.lineTo(0, -25); g.stroke();
      g.fillStyle = c; star4(g, 0, -28, 5.2, now / 600); g.fill();
      break;
    case 'flower':
      for (var fi3 = 0; fi3 < 5; fi3++) {
        var fa2 = fi3 / 5 * TAU;
        g.beginPath(); g.arc(6.5 + Math.cos(fa2) * 3.6, -17.5 + Math.sin(fa2) * 3.6, 2.9, 0, TAU); g.fill();
      }
      g.fillStyle = '#fff7cc';
      g.beginPath(); g.arc(6.5, -17.5, 2.2, 0, TAU); g.fill();
      break;
    case 'mohawk':
      g.beginPath();
      g.moveTo(-2.4, -12); g.lineTo(0, -27); g.lineTo(2.4, -12); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-2.2, -9.5); g.lineTo(0.8, -22); g.lineTo(3.4, -10); g.closePath(); g.fill();
      break;
    case 'tophat':
      g.save(); g.rotate(-0.1);
      g.fillRect(-6.5, -26.5, 13, 12.5);
      g.fillRect(-10, -15.8, 20, 3.4);
      g.restore();
      break;
    default:
      g.beginPath(); g.arc(0, -16.5, 4.6, 0, TAU); g.fill();
  }
}
function drawPet(g, pet, now) {
  var x = pet.x, y = pet.y + (pet.hopY || 0), c = pet.c;
  g.fillStyle = 'rgba(0,0,0,.3)';
  g.beginPath(); g.ellipse(x, y + 12, 7, 2.6, 0, 0, TAU); g.fill();
  g.fillStyle = c; g.strokeStyle = c;
  switch (pet.kind) {
    case 'star':
      g.shadowColor = c; g.shadowBlur = 10;
      star4(g, x, y, 8, now / 700); g.fill(); g.shadowBlur = 0;
      break;
    case 'ghost':
      g.globalAlpha = 0.92;
      g.beginPath();
      g.arc(x, y, 7, Math.PI, TAU);
      g.lineTo(x + 7, y + 7);
      for (var wi = 0; wi < 3; wi++) g.arc(x + 4.6 - wi * 4.6, y + 7, 2.3, 0, Math.PI);
      g.lineTo(x - 7, y);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc(x - 2.6, y - 0.6, 1.3, 0, TAU); g.arc(x + 2.6, y - 0.6, 1.3, 0, TAU); g.fill();
      break;
    case 'bat': {
      var flap = Math.sin(now / 130) * 3;
      g.beginPath(); g.ellipse(x - 7, y - flap, 6.4, 3, -0.5, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(x + 7, y - flap, 6.4, 3, 0.5, 0, TAU); g.fill();
      g.beginPath(); g.arc(x, y, 4.4, 0, TAU); g.fill();
      break;
    }
    case 'cat':
      g.beginPath(); g.arc(x, y, 6.4, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(x - 6, y - 3); g.lineTo(x - 4.6, y - 9.4); g.lineTo(x - 1.4, y - 5.4); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x + 6, y - 3); g.lineTo(x + 4.6, y - 9.4); g.lineTo(x + 1.4, y - 5.4); g.closePath(); g.fill();
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc(x - 2.2, y - 0.6, 1.1, 0, TAU); g.arc(x + 2.2, y - 0.6, 1.1, 0, TAU); g.fill();
      break;
    case 'frog':
      g.beginPath(); g.arc(x, y, 6.6, 0, TAU); g.fill();
      g.beginPath(); g.arc(x - 4, y - 5.6, 2.7, 0, TAU); g.arc(x + 4, y - 5.6, 2.7, 0, TAU); g.fill();
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc(x - 4, y - 5.6, 1.2, 0, TAU); g.arc(x + 4, y - 5.6, 1.2, 0, TAU); g.fill();
      break;
    case 'skull':
      g.fillStyle = '#f1eefc';
      g.beginPath(); g.arc(x, y - 1, 6.4, 0, TAU); g.fill();
      g.fillRect(x - 3.6, y + 3.4, 7.2, 3.6);
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc(x - 2.5, y - 1.4, 1.7, 0, TAU); g.arc(x + 2.5, y - 1.4, 1.7, 0, TAU); g.fill();
      break;
    case 'ufo':
      g.fillStyle = 'rgba(230,228,255,.85)';
      g.beginPath(); g.arc(x, y - 2.6, 4.4, Math.PI, TAU); g.fill();
      g.fillStyle = c;
      g.beginPath(); g.ellipse(x, y, 9, 3.6, 0, 0, TAU); g.fill();
      g.fillStyle = '#fff7cc';
      g.beginPath(); g.arc(x - 5, y + 0.6, 1.2, 0, TAU); g.arc(x, y + 1.2, 1.2, 0, TAU); g.arc(x + 5, y + 0.6, 1.2, 0, TAU); g.fill();
      break;
    case 'fox':
      g.beginPath(); g.ellipse(x + 9, y + 4, 8, 4.4, 0.6, 0, TAU); g.fill();
      g.beginPath(); g.arc(x, y, 6.8, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(x - 6.4, y - 3); g.lineTo(x - 5, y - 10); g.lineTo(x - 1.6, y - 5.6); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x + 6.4, y - 3); g.lineTo(x + 5, y - 10); g.lineTo(x + 1.6, y - 5.6); g.closePath(); g.fill();
      g.fillStyle = '#fff3e0';
      g.beginPath(); g.ellipse(x, y + 3.4, 3.6, 2.6, 0, 0, TAU); g.fill();
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc(x - 2.4, y - 0.8, 1.1, 0, TAU); g.arc(x + 2.4, y - 0.8, 1.1, 0, TAU); g.fill();
      break;
    case 'axolotl':
      g.strokeStyle = c; g.lineWidth = 2;
      for (var gi2 = -1; gi2 <= 1; gi2++) {
        g.beginPath(); g.moveTo(x - 5, y - 2 + gi2 * 3); g.lineTo(x - 10, y - 4 + gi2 * 4); g.stroke();
        g.beginPath(); g.moveTo(x + 5, y - 2 + gi2 * 3); g.lineTo(x + 10, y - 4 + gi2 * 4); g.stroke();
      }
      g.beginPath(); g.arc(x, y, 6.8, 0, TAU); g.fill();
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc(x - 2.4, y - 1, 1.1, 0, TAU); g.arc(x + 2.4, y - 1, 1.1, 0, TAU); g.fill();
      g.strokeStyle = '#17102e'; g.lineWidth = 1.1;
      g.beginPath(); g.arc(x, y + 1.4, 2.8, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      break;
    case 'wisp': {
      var fl2 = 1 + Math.sin(now / 140 + x) * 0.16;
      g.shadowColor = c; g.shadowBlur = 13;
      g.beginPath();
      g.moveTo(x, y - 10 * fl2);
      g.quadraticCurveTo(x + 6.4, y - 1, x + 4.6, y + 4);
      g.quadraticCurveTo(x + 2, y + 8.4, x, y + 8.4);
      g.quadraticCurveTo(x - 2, y + 8.4, x - 4.6, y + 4);
      g.quadraticCurveTo(x - 6.4, y - 1, x, y - 10 * fl2);
      g.fill(); g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath(); g.arc(x - 1.8, y + 0.6, 1.2, 0, TAU); g.arc(x + 1.8, y + 0.6, 1.2, 0, TAU); g.fill();
      break;
    }
    case 'dragon': {
      var fl3 = Math.sin(now / 150) * 3.4;
      g.beginPath(); g.ellipse(x - 8, y - 4 - fl3, 7, 3.2, -0.6, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(x + 8, y - 4 - fl3, 7, 3.2, 0.6, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(x, y + 1, 5.6, 6.8, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(x, y - 6, 4.6, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(x - 3.6, y - 9); g.lineTo(x - 2.4, y - 13); g.lineTo(x - 0.8, y - 9.6); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x + 3.6, y - 9); g.lineTo(x + 2.4, y - 13); g.lineTo(x + 0.8, y - 9.6); g.closePath(); g.fill();
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc(x - 1.8, y - 6.4, 1, 0, TAU); g.arc(x + 1.8, y - 6.4, 1, 0, TAU); g.fill();
      break;
    }
    default:
      g.shadowColor = c; g.shadowBlur = 12;
      g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath(); g.arc(x - 2, y - 2, 2, 0, TAU); g.fill();
  }
  if (pet.rarity === 'epic' || pet.rarity === 'legendary') {
    g.strokeStyle = pet.rarity === 'legendary' ? 'rgba(255,210,87,.5)' : 'rgba(240,171,252,.45)';
    g.lineWidth = 1.2;
    g.beginPath(); g.ellipse(x, y + 12, 9, 3.2, 0, 0, TAU); g.stroke();
  }
  if (pet.name) {
    g.font = '700 8.5px Inter, sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(5,3,14,.6)';
    var nwt = g.measureText(pet.name).width;
    rr(g, x - nwt / 2 - 4, y + 15, nwt + 8, 11, 5); g.fill();
    g.fillStyle = '#f9d8ec'; g.fillText(pet.name, x, y + 23.5);
  }
}
function openShop() {
  closeGame(); closeArcade();
  window.__shopOpen = true;
  $('wshop').hidden = false;
  document.body.classList.add('wov');
  $('wsh-bal').textContent = '¢ ' + centsBal + ' six cents';
  renderShopTabs();
  renderShopGrid();
}
function closeShop() { window.__shopOpen = false; $('wshop').hidden = true; document.body.classList.remove('wov'); }
function renderShopTabs() {
  var tabs = [['all', 'all'], ['trail', 'trails'], ['hat', 'hats'], ['aura', 'auras'], ['pet', 'pets'], ['face', 'faces'], ['mount', 'mounts'], ['rod', 'rods'], ['mine', 'my stuff']];
  var wrap = $('wsh-tabs');
  wrap.innerHTML = '';
  tabs.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = t[1];
    if (shopTab === t[0]) b.className = 'on';
    b.addEventListener('click', function () { shopTab = t[0]; renderShopTabs(); renderShopGrid(); });
    wrap.appendChild(b);
  });
}
function renderShopGrid() {
  var grid = $('wsh-grid');
  if (!grid) return;
  grid.innerHTML = '';
  var items = (window.WSHOP || []).filter(function (it) {
    if (shopQuery && it.name.toLowerCase().indexOf(shopQuery) < 0) return false;
    if (shopTab === 'all') return true;
    if (shopTab === 'mine') return myInv.indexOf(it.id) >= 0;
    return it.cat === shopTab;
  });
  if (!items.length) {
    var none = document.createElement('div');
    none.style.cssText = 'color:rgba(243,239,255,.5);font-size:13.5px;padding:8px 2px';
    none.textContent = shopQuery ? 'no items match that search' : (shopTab === 'mine' ? 'nothing yet — buy something, it shows up here' : 'nothing here');
    grid.appendChild(none);
    return;
  }
  items.forEach(function (it) {
    var owned = myInv.indexOf(it.id) >= 0;
    var equipped = myWearIds[it.cat] === it.id;
    var card = document.createElement('div');
    card.className = 'wsh-card';
    var prev = document.createElement('div');
    prev.className = 'wsh-prev';
    prev.style.background = 'radial-gradient(circle at 50% 42%, ' + it.color + '59, rgba(255,255,255,.03) 72%)';
    var dot = document.createElement('i');
    if (it.cat === 'face') {
      dot.style.background = 'radial-gradient(circle at 35% 42%, #14101f 0 2.2px, transparent 3px), radial-gradient(circle at 65% 42%, #14101f 0 2.2px, transparent 3px), ' + it.color;
      dot.style.boxShadow = 'none';
    } else { dot.style.background = it.color; }
    dot.style.color = it.color;
    prev.appendChild(dot);
    var nm = document.createElement('div');
    nm.className = 'wsh-name'; nm.textContent = it.name;
    var rar = document.createElement('div');
    rar.className = 'wsh-rar'; rar.style.color = RAR_C[it.rarity] || '#fff';
    rar.textContent = it.rarity + ' · ' + it.cat;
    var btn = document.createElement('button');
    btn.type = 'button';
    if (equipped) { btn.textContent = 'equipped ✓ — tap to take off'; btn.className = 'on'; }
    else if (owned) { btn.textContent = 'equip'; btn.className = 'eq'; }
    else if (centsBal >= it.price) { btn.textContent = 'buy · ¢' + it.price; }
    else { btn.textContent = '¢' + it.price + ' · need more'; btn.disabled = true; }
    btn.addEventListener('click', function () {
      if (!owned) buyItem(it.id);
      else equipItem(it);
    });
    card.appendChild(prev); card.appendChild(nm); card.appendChild(rar); card.appendChild(btn);
    grid.appendChild(card);
  });
}
function buyItem(id) {
  jpost('/api/world/shopbuy', { id: id }).then(function (r) {
    if (!r || !r.ok) { toast((r && r.err) || 'buy failed'); return; }
    myInv = r.inv || myInv;
    if (r.bal != null) setCentsBal(r.bal);
    sndPick(true);
    toast('✦ bought it — equip it from the shop');
    renderShopGrid();
  });
}
function equipItem(it) {
  var equipped = myWearIds[it.cat] === it.id;
  jpost('/api/world/shopequip', { cat: it.cat, id: equipped ? '' : it.id }).then(function (r) {
    if (!r || !r.ok) { toast((r && r.err) || 'equip failed'); return; }
    myWearIds = r.wearIds || {};
    if (players[me]) players[me].wear = r.wear || null;
    sndPop();
    renderShopGrid();
  });
}
$('wshopbtn').addEventListener('click', openShop);
$('wsh-x').addEventListener('click', closeShop);
var wshQ = $('wsh-q');
if (wshQ) wshQ.addEventListener('input', function () { shopQuery = wshQ.value.trim().toLowerCase(); renderShopGrid(); });
window.__shop = {
  open: openShop, close: closeShop,
  state: function () { return { inv: myInv.slice(), wear: Object.assign({}, myWearIds), bal: centsBal, tab: shopTab }; }
};


/* ---------------- profiles, character, battles ---------------- */
function pesc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
var profUser = '';
function closeProfile() { $('wprof').hidden = true; document.body.classList.remove('wov'); }
function openProfile(u) {
  if (!u || u === me) return;
  profUser = u;
  var pop = $('wprof');
  pop.hidden = false;
  document.body.classList.add('wov');
  $('wprof-name').textContent = '@' + u;
  $('wprof-name').className = '';
  $('wprof-user').textContent = 'loading their six profile…';
  $('wprof-meta').textContent = '';
  $('wprof-badges').innerHTML = '';
  $('wprof-stats').innerHTML = '';
  $('wprof-wear').textContent = '';
  $('wprof-av').innerHTML = pesc(u.slice(0, 1).toUpperCase());
  $('wprof-link').href = '/u/' + encodeURIComponent(u);
  var addB = $('wprof-add');
  addB.disabled = true; addB.textContent = 'add friend';
  var batB = $('wprof-battle');
  batB.disabled = true; batB.textContent = 'battle';
  fetch('/api/user/' + encodeURIComponent(u)).then(function (r) { return r.json(); }).then(function (o) {
    if (!o || !o.ok || profUser !== u) return;
    var hue = (o.hue != null) ? o.hue : hueOf(u);
    var bh = (o.banner != null) ? o.banner : hue;
    var pb = $('wprof-banner');
    if (o.bannerImg) pb.style.background = 'url(' + o.bannerImg + ') center/cover';
    else pb.style.background = 'linear-gradient(120deg,hsl(' + bh + ',45%,32%),hsl(' + ((bh + 40) % 360) + ',50%,16%))';
    var av = $('wprof-av');
    av.style.background = 'hsl(' + hue + ',45%,38%)';
    av.innerHTML = o.av ? '<img src="' + pesc(o.av) + '" alt="">' : pesc((o.disp || u).slice(0, 1).toUpperCase());
    var nm = $('wprof-name');
    nm.textContent = o.disp || u;
    nm.className = o.fx ? ('fx' + o.fx) : '';
    $('wprof-user').textContent = '@' + o.user + (o.online ? ' · online now' : '');
    $('wprof-meta').textContent = (o.status ? o.status + ' · ' : '') + (o.created ? ('here since ' + new Date(o.created).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })) : '');
    var bh2 = '<span class="wprof-lv">Lv ' + (o.lvl || 1) + '</span>';
    (o.badges || []).forEach(function (b) { bh2 += ' <span class="wprof-chip">' + pesc(b.label) + '</span>'; });
    $('wprof-badges').innerHTML = bh2;
    fetch('/api/world/guild?u=' + encodeURIComponent(u)).then(function (x) { return x.json(); }).then(function (gr) {
      if (!gr || !gr.ok || !gr.guild || profUser !== u) return;
      $('wprof-badges').innerHTML += ' <span class="wprof-chip" style="color:hsl(' + gr.guild.color + ',85%,72%);border-color:hsla(' + gr.guild.color + ',70%,60%,.5)">[' + pesc(gr.guild.tag) + '] ' + pesc(gr.guild.name) + ' · lv ' + gr.guild.lvl + '</span>';
    }).catch(function () {});
    var c = o.cnt || {};
    $('wprof-stats').innerHTML =
      '<span class="wprof-chip">' + (c.msgs || 0) + ' msgs</span>' +
      '<span class="wprof-chip">' + (c.trivia || 0) + ' trivia wins</span>' +
      '<span class="wprof-chip">' + (c.plays || 0) + ' game scores</span>' +
      '<span class="wprof-chip">' + (o.friends || 0) + ' friends</span>';
    var soc = o.social || {};
    if (soc.friend) { addB.textContent = 'friends ✓'; addB.disabled = true; }
    else if (soc.out) { addB.textContent = 'request sent'; addB.disabled = true; }
    else if (soc.inc) {
      addB.textContent = 'accept friend request'; addB.disabled = false;
      addB.onclick = function () {
        addB.disabled = true; addB.textContent = 'adding…';
        fetch('/auth/friend-accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: u }) }).then(function () { addB.textContent = 'friends ✓'; toast('u + @' + u + ' are friends now'); }).catch(function () { addB.disabled = false; addB.textContent = 'accept friend request'; });
      };
    } else {
      addB.textContent = 'add friend'; addB.disabled = false;
      addB.onclick = function () {
        addB.disabled = true; addB.textContent = 'sending…';
        fetch('/auth/friend-add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: u }) }).then(function () { addB.textContent = 'request sent'; toast('friend request sent to @' + u); }).catch(function () { addB.disabled = false; addB.textContent = 'add friend'; });
      };
    }
  }).catch(function () {});
  fetch('/api/world/pinfo?u=' + encodeURIComponent(u)).then(function (r) { return r.json(); }).then(function (o) {
    if (!o || !o.ok || profUser !== u) return;
    if (o.cents != null) $('wprof-stats').innerHTML += '<span class="wprof-chip gold">¢' + o.cents + ' six cents</span>';
    if (o.prog) $('wprof-stats').innerHTML += '<span class="wprof-chip">Lv ' + o.prog.lvl + ' · ' + o.prog.title + '</span>';
    if (o.wear && o.wear.length) $('wprof-wear').textContent = 'wearing: ' + o.wear.join(' · ');
    if (o.online) { batB.disabled = false; batB.textContent = 'battle — reaction duel'; }
    else batB.textContent = 'battle (not in the world)';
    profSocial(u);
  }).catch(function () {});
}
$('wprof-x').addEventListener('click', closeProfile);
$('wprof').addEventListener('click', function (e) { if (e.target === $('wprof')) closeProfile(); });
$('wprof-battle').addEventListener('click', function () {
  var u = profUser;
  if (!u) return;
  jpost('/api/world/duel', { to: u }).then(function (r) {
    if (r && r.ok) { toast('battle challenge sent to @' + u + ' — first tap on green wins ¢20'); closeProfile(); }
    else toast('couldnt send the challenge', (r && r.err) || '');
  });
});

/* progression */
var sndLvl = function () { tone(392, 0, .16, 'triangle', .15); tone(523, .09, .16, 'triangle', .15); tone(659, .18, .16, 'triangle', .15); tone(784, .27, .2, 'triangle', .16); tone(1046, .38, .42, 'triangle', .17); };
function renderProg(p) {
  if (p.zonesList) myZonesList = p.zonesList;
  var el = $('wlvl'); if (el) el.textContent = 'Lv ' + p.lvl + ' · ' + p.title;
  var bar = document.querySelector('#wxp i');
  if (bar) bar.style.width = Math.max(0, Math.min(100, Math.round(p.cur / Math.max(1, p.need) * 100))) + '%';
}
function onLvlUp(u) {
  sndLvl();
  burst(px, py - 10, '#ffd257', 30, 150);
  floatText(px, py - 56, 'LEVEL ' + u.lvl, '#ffd257');
  toast('level ' + u.lvl + ' — ' + u.title, 3600);
}
/* achievements panel */
function openAch() {
  $('wach').hidden = false;
  document.body.classList.add('wov');
  $('wach-sub').textContent = 'loading…';
  $('wach-list').innerHTML = '';
  fetch('/api/world/ach', { headers: { 'x-six': '1' } }).then(function (r) { return r.json(); }).then(function (o) {
    if (!o || !o.ok) { $('wach-sub').textContent = 'couldnt load achievements'; return; }
    var got = o.achs.filter(function (a) { return a.got; }).length;
    $('wach-sub').textContent = got + ' of ' + o.achs.length + ' unlocked · Lv ' + o.prog.lvl + ' ' + o.prog.title + ' · ' + o.prog.xp + ' xp total';
    var list = $('wach-list');
    list.innerHTML = '';
    o.achs.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'ach-row' + (a.got ? ' got' : '');
      var ic = document.createElement('span'); ic.className = 'ach-ic'; ic.textContent = a.got ? '\u2726' : '\u2727';
      var mid = document.createElement('div'); mid.className = 'ach-mid';
      var nm = document.createElement('div'); nm.className = 'ach-name'; nm.textContent = a.name;
      var ds = document.createElement('div'); ds.className = 'ach-desc'; ds.textContent = a.desc + ' · ' + a.cat;
      mid.appendChild(nm); mid.appendChild(ds);
      var rw = document.createElement('span'); rw.className = 'ach-rw'; rw.textContent = a.got ? 'done' : '+\u00a2' + a.reward;
      row.appendChild(ic); row.appendChild(mid); row.appendChild(rw);
      list.appendChild(row);
    });
  }).catch(function () { $('wach-sub').textContent = 'couldnt load achievements'; });
}
function closeAch() { $('wach').hidden = true; document.body.classList.remove('wov'); }
$('wachbtn').addEventListener('click', openAch);
$('wach-x').addEventListener('click', closeAch);
$('wach').addEventListener('click', function (e) { if (e.target === $('wach')) closeAch(); });
window.__ach = { open: openAch, close: closeAch };
/* quest journal */
function jqRow(label, t, prog, n, pay, done, say) {
  var pct = Math.min(100, Math.round(100 * prog / Math.max(1, n)));
  return '<div class="jq-row' + (done ? ' done' : '') + '"><div class="jq-top"><span class="jq-k">' + label + '</span><span class="jq-pay">' + (done ? 'done' : '\u00a2' + pay) + '</span></div>' +
    '<div class="jq-t">' + t + '</div><div class="jq-bar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="jq-s">' + Math.floor(prog) + ' / ' + n + '</div>' + (say ? '<div class="jq-say">' + say + '</div>' : '') + '</div>';
}
function renderJournal(r) {
  var h = '';
  if (r.story && !r.story.doneAll) h += jqRow('six storyline · step ' + r.story.step + ' of ' + r.story.total, r.chain.t, r.chain.prog, r.chain.n, r.chain.pay, false, r.chain.say ? ('\u201c' + r.chain.say + ' \u2014 six\u201d') : '');
  else h += jqRow('quest chain \u00d7' + (r.chain.chain + 1), r.chain.t, r.chain.prog, r.chain.n, r.chain.pay, false, '');
  h += '<div class="jq-sec">today</div>';
  (r.daily || []).forEach(function (d) { h += jqRow('daily', d.t, d.prog, d.n, d.pay, d.done, ''); });
  h += '<div class="jq-sec">this week</div>';
  if (r.weekly) h += jqRow('weekly', r.weekly.t, r.weekly.prog, r.weekly.n, r.weekly.pay, r.weekly.done, '');
  $('wjournal-body').innerHTML = h;
}
function openJournal() {
  $('wjournal').hidden = false;
  document.body.classList.add('wov');
  $('wjournal-body').innerHTML = '<div class="jq-row">asking six\u2026</div>';
  fetch('/api/world/quests', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { $('wjournal-body').innerHTML = '<div class="jq-row">couldnt load the journal</div>'; return; }
    renderJournal(r);
  }).catch(function () { $('wjournal-body').innerHTML = '<div class="jq-row">couldnt load the journal</div>'; });
}
function closeJournal() { $('wjournal').hidden = true; document.body.classList.remove('wov'); }
$('wjournal-x').addEventListener('click', closeJournal);
$('wjournal').addEventListener('click', function (e) { if (e.target === $('wjournal')) closeJournal(); });
$('wquest').addEventListener('click', openJournal);
$('wquest').style.cursor = 'pointer';
$('wquest').title = 'tap for the quest journal';
window.__journal = { open: openJournal, close: closeJournal };
/* parties, blocks, reports, events, leaderboards */
function escH(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
var myParty = null, myPartySet = {}, myBlocks = [], mutedSet = {};
try { mutedSet = JSON.parse(localStorage.getItem('sixMuted') || '{}'); } catch (e) { mutedSet = {}; }
var lastEventId = -1, partyInvFrom = '', lastSoonKey = '';
function socialTick(r) {
  var ab = $('wadminbtn'); if (ab) ab.hidden = !r.isAdmin;
  if (r.weather) WX = r.weather;
  if (r.petNames) myPetNames = r.petNames;
  var nhouse = r.house || null;
  if (nhouse !== myHouse) { myHouse = nhouse; HOUSE_VIEW = null; decorOn = false; placeFid = null; if (myHouse) loadHouse(myHouse); }
  var nboss = r.boss || null;
  if (nboss && !nboss.dead && !BOSS_V) { toast('\u2726 the drowned lich rises from the lake', 4400); tone(196, 0, .5, 'sawtooth', .05, 98); }
  BOSS_V = nboss;
  var ninst = r.inst || null;
  if (INST_V && !ninst && !cryptExitWanted) { toast('u got dragged out of the crypt', 3400); px = 5050; py = 3610; vx = 0; vy = 0; moveTarget = null; cam.x = px; cam.y = py; }
  if (ninst && !INST_V) { toast('\u2726 the sunken crypt \u2014 clear 3 waves', 3600); if (!(px > ninst.ox - 40 && px < ninst.ox + 1140 && py > ninst.oy - 40 && py < ninst.oy + 560)) { px = ninst.ox + 550; py = ninst.oy + 420; vx = 0; vy = 0; moveTarget = null; cam.x = px; cam.y = py; sndPortal(); burst(px, py, '#a78bfa', 14, 100); } }
  INST_V = ninst;
  var nrace = r.race || null;
  if (nrace && nrace.flash) { burst(px, py, '#ffd257', 12, 100); sndPop(); if (!nrace.flash.start) floatText(px, py - 34, fmtRaceMs(nrace.flash.t), '#ffd257'); }
  if (nrace && nrace.fin && nrace.fin.invalid) { toast('that run was too fast to count — records need a clean run, no teleports', 5600); }
  else if (nrace && nrace.fin) { toast('\u2726 ' + nrace.fin.name + ' — ' + fmtRaceMs(nrace.fin.ms) + (nrace.fin.pb ? ' · new pb!' : '') + (nrace.fin.rec ? ' · WORLD RECORD' : '') + (nrace.fin.pay ? ' · +' + nrace.fin.pay + '\u00a2' : ''), 5600); sndQuest(); }
  RACE_V = nrace;
  if (nrace && nrace.state === 'running') { RACE_EL.el = nrace.el || 0; RACE_EL.at = performance.now(); }
  if (r.ann && r.ann.at !== lastAnnAt) { lastAnnAt = r.ann.at; toast('\u2726 six announces: ' + r.ann.text, 6500); sndQuest(); }
  if (r.myBlocks) myBlocks = r.myBlocks;
  (r.guildMsgs || []).forEach(function (m) { GUILD_MSGS.push({ from: m.from, text: m.text }); if (GUILD_MSGS.length > 40) GUILD_MSGS.shift(); logLine(m.from, '[guild] ' + m.text); if (!$('wguild').hidden) renderGuildChat(); });
  var ginv2 = r.guildInv || [];
  if (ginv2.length && JSON.stringify(ginv2) !== JSON.stringify(MY_GINV)) { var lv = ginv2[ginv2.length - 1]; toast('\u2726 guild invite — ' + lv.name + ' [' + lv.tag + '] from @' + lv.from + ' · open the guild panel to answer', 5600); sndPop(); }
  MY_GINV = ginv2;
  var tbar = $('wtrade-inv');
  if (r.tradeInv && r.tradeInv.from) {
    if (tradeInvFrom !== r.tradeInv.from) { tradeInvFrom = r.tradeInv.from; $('wtrade-inv-t').textContent = '@' + tradeInvFrom + ' wants to trade'; }
    tbar.hidden = false;
  } else { tbar.hidden = true; tradeInvFrom = ''; }
  if (r.tradeFlash) { toast('\u2726 ' + r.tradeFlash, 4200); sndPop(); }
  (r.matGot || []).forEach(function (mg) { var md = MAT_DEFS[mg.id]; if (md) floatText(px, py - 42, '+' + mg.n + ' ' + md.name, md.c); });
  TRADE_V = r.trade || null;
  if (TRADE_V && tradeWasNull) openTrade();
  tradeWasNull = !TRADE_V;
  if (!$('wtrade').hidden && TRADE_V) { var ae = document.activeElement; if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'SELECT')) renderTrade(); }
  myParty = r.party || null;
  myPartySet = {};
  if (myParty) myParty.members.forEach(function (m) { myPartySet[m] = 1; });
  var chip = $('wparty');
  if (myParty && myParty.members.length > 1) {
    var sig = myParty.leader + '|' + myParty.members.join(',');
    if (chip.getAttribute('data-sig') !== sig) {
      chip.setAttribute('data-sig', sig);
      chip.innerHTML = '<b>\u2726 party</b> ' + myParty.members.map(function (m) { return (m === myParty.leader ? '\u265b ' : '') + '@' + escH(m); }).join(' \u00b7 ') + ' <button id="wparty-leave" type="button">leave</button>';
      $('wparty-leave').addEventListener('click', function () { jpost('/api/world/party', { act: 'leave' }).then(function () { toast('left the party'); }); });
    }
    chip.hidden = false;
  } else chip.hidden = true;
  var bar = $('wparty-inv');
  if (r.partyInv && r.partyInv.from) {
    if (partyInvFrom !== r.partyInv.from) { partyInvFrom = r.partyInv.from; $('wparty-inv-t').textContent = '@' + partyInvFrom + ' invited u to their party'; }
    bar.hidden = false;
  } else { bar.hidden = true; partyInvFrom = ''; }
  var ev = $('wevent');
  if (r.event) {
    var left = Math.max(0, Math.round((r.event.endsAt - (r.srvNow || Date.now())) / 1000));
    var mmss = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    ev.hidden = false;
    var EV_TXT = { shardstorm: 'SHARD STORM \u2014 shard \u00a2 doubled', goldenhunt: 'GOLDEN HUNT \u2014 extra gold shards are out', meteor: 'METEOR SHOWER \u2014 catch the fallen stars', treasure: 'TREASURE HUNT \u2014 a chest hides in ' + (r.treasure ? r.treasure.zone : 'the world'), doublexp: 'DOUBLE XP \u2014 all xp doubled' };
    var EV_TOAST = { shardstorm: 'every shard pays double', goldenhunt: 'extra gold shards just dropped', meteor: 'meteors are falling \u2014 stand where they land', treasure: 'a chest is hidden \u2014 the banner names the zone, gold motes mean ur close', doublexp: 'every xp gain is doubled' };
    EV_TXT.derby = 'FISHING DERBY \u2014 most points wins \u00a2150'; EV_TOAST.derby = 'every catch scores \u00b7 rare fish score more \u00b7 top 3 paid at the end';
    EV_TXT.tourney = 'RACE TOURNAMENT \u2014 best ' + (r.event.course === 'grandtour' ? 'grand tour' : 'skyline sprint') + ' time wins \u00a2150'; EV_TOAST.tourney = 'run the featured course \u00b7 only ur best time counts';
    EV_TXT.crystalhunt = 'CRYSTAL HUNT \u2014 3 bonus crystals appeared'; EV_TOAST.crystalhunt = 'bright event crystals worth \u00a260 \u00b7 first come first served';
    EV_TXT.community = 'COMMUNITY CHALLENGE \u2014 ' + (r.event.goal ? r.event.goal.label : 'work together') + (r.event.goal ? ' (' + r.event.goal.got + '/' + r.event.goal.n + ')' : ''); EV_TOAST.community = 'hit the goal together \u00b7 everyone who helped gets \u00a260';
    EV_TXT.lichsurge = 'LICH SURGE \u2014 the drowned lich rises NOW'; EV_TOAST.lichsurge = 'the lich is up at the lake out of cycle \u00b7 spoils boosted 50%';
    EV_TXT.errand = "SIX'S ERRAND \u2014 get to " + (r.event.zoneName || 'the marked zone'); EV_TOAST.errand = 'reach the zone before time runs out \u00b7 +\u00a240';
    ev.textContent = '\u2726 ' + (EV_TXT[r.event.type] || r.event.type) + ' \u00b7 ' + mmss + ' left';
    if (lastEventId !== r.event.id) { lastEventId = r.event.id; toast('\u2726 ' + (EV_TXT[r.event.type] || r.event.type) + ' \u2014 ' + (EV_TOAST[r.event.type] || ''), 4200); sndQuest(); }
  } else if (r.evSoon) {
    ev.hidden = false;
    var SOON_TXT = { derby: 'FISHING DERBY', tourney: 'RACE TOURNAMENT', crystalhunt: 'CRYSTAL HUNT', community: 'COMMUNITY CHALLENGE', lichsurge: 'LICH SURGE', errand: "SIX'S ERRAND", shardstorm: 'SHARD STORM', goldenhunt: 'GOLDEN HUNT', meteor: 'METEOR SHOWER', treasure: 'TREASURE HUNT', doublexp: 'DOUBLE XP' };
    ev.textContent = '\u2726 ' + (SOON_TXT[r.evSoon.type] || r.evSoon.type) + ' starts in ' + r.evSoon.in + 's';
    var sk = r.evSoon.type + ':' + Math.ceil(r.evSoon.in / 30);
    if (lastSoonKey !== sk && r.evSoon.in <= 60) { lastSoonKey = sk; toast('\u2726 ' + (SOON_TXT[r.evSoon.type] || r.evSoon.type) + ' starts in ' + r.evSoon.in + 's', 3600); }
  } else ev.hidden = true;
}
$('wparty-yes').addEventListener('click', function () { jpost('/api/world/party', { act: 'accept' }).then(function (r) { if (r && r.ok) toast('joined the party \u2726'); else toast('invite fizzled', (r && r.err) || ''); }); $('wparty-inv').hidden = true; });
$('wtrade-yes').addEventListener('click', function () { jpost('/api/world/trade', { act: 'answer', yes: true }).then(function (r) { if (r && r.ok) { toast('trade started \u2726'); openTrade(); } else toast('invite fizzled', (r && r.err) || ''); }); $('wtrade-inv').hidden = true; });
$('wtrade-no').addEventListener('click', function () { jpost('/api/world/trade', { act: 'answer', yes: false }); $('wtrade-inv').hidden = true; });
$('wparty-no').addEventListener('click', function () { jpost('/api/world/party', { act: 'decline' }); $('wparty-inv').hidden = true; });
function bdSection(title, rows, fmt) {
  if (!rows || !rows.length) return '';
  return '<div class="jq-sec">' + title + '</div>' + rows.map(function (r, i) {
    return '<div class="bd-row"><span class="bd-rank">' + (i + 1) + '</span><span class="bd-name">@' + escH(r.u) + (r.lvl ? ' \u00b7 Lv ' + r.lvl : '') + '</span><span class="bd-val">' + fmt(r.v) + '</span></div>';
  }).join('');
}
function openBoards() {
  $('wboards').hidden = false;
  document.body.classList.add('wov');
  $('wboards-body').innerHTML = '<div class="jq-row">tallying the world\u2026</div>';
  fetch('/api/world/boards', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { $('wboards-body').innerHTML = '<div class="jq-row">couldnt load the boards</div>'; return; }
    var b = r.boards || {};
    $('wboards-body').innerHTML =
      bdSection('top levels', b.levels, function (v) { return v + ' xp'; }) +
      bdSection('most quests done', b.quests, function (v) { return v + ' quests'; }) +
      bdSection('shard hunters', b.shards, function (v) { return v + ' shards'; }) +
      bdSection('achievement hunters', b.ach, function (v) { return v + ' unlocked'; }) +
      bdSection('crystal keepers', b.crystals, function (v) { return v + ' crystals'; }) +
      (b.fish && b.fish.length ? '<div class="jq-sec">biggest catches this week</div>' + b.fish.map(function (r2, i) { return '<div class="bd-row"><span class="bd-rank">' + (i + 1) + '</span><span class="bd-name">@' + escH(r2.u) + '</span><span class="bd-val">' + r2.v + 'kg ' + escH(r2.sp) + '</span></div>'; }).join('') : '') +
      bdSection('crypt runners', b.crypt, function (v) { return v + ' clears'; });
  }).catch(function () { $('wboards-body').innerHTML = '<div class="jq-row">couldnt load the boards</div>'; });
}
function closeBoards() { $('wboards').hidden = true; document.body.classList.remove('wov'); }
$('wboardsbtn').addEventListener('click', openBoards);
$('wboards-x').addEventListener('click', closeBoards);
$('wboards').addEventListener('click', function (e) { if (e.target === $('wboards')) closeBoards(); });
window.__boards = { open: openBoards, close: closeBoards };
var EV_NAMES = { derby: 'fishing derby', tourney: 'race tournament', crystalhunt: 'crystal hunt', community: 'community challenge', lichsurge: 'lich surge', errand: "six's errand", shardstorm: 'shard storm', goldenhunt: 'golden hunt', meteor: 'meteor shower', treasure: 'treasure hunt', doublexp: 'double xp' };
function openEvents() {
  $('wevents').hidden = false;
  document.body.classList.add('wov');
  $('wevents-body').innerHTML = '<div class="jq-row">checking the skies\u2026</div>';
  fetch('/api/world/events', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { $('wevents-body').innerHTML = '<div class="jq-row">couldnt load events</div>'; return; }
    var h = '';
    if (r.now) h += '<div class="jq-sec">live now</div><div class="jq-row">\u2726 ' + (EV_NAMES[r.now.type] || r.now.type) + (r.course ? ' \u00b7 ' + escH(r.course) : '') + (r.zoneName ? ' \u00b7 ' + escH(r.zoneName) : '') + '</div>';
    else if (r.soon) h += '<div class="jq-sec">up next</div><div class="jq-row">\u2726 ' + (EV_NAMES[r.soon.type] || r.soon.type) + ' \u00b7 starts ' + new Date(r.soon.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</div>';
    if (r.goal) h += '<div class="jq-sec">community goal</div><div class="jq-row">' + escH(r.goal.label) + ' \u00b7 ' + r.goal.got + '/' + r.goal.n + '</div>';
    if (r.board && r.board.length) h += bdSection('live standings', r.board, function (v) { return r.now && r.now.type === 'tourney' ? fmtRaceMs(v) : v + ' pts'; });
    if (r.champs && r.champs.length) h += bdSection('event champions', r.champs.map(function (x) { return { u: x.u, v: x.n }; }), function (v) { return v + (v === 1 ? ' win' : ' wins'); });
    if (r.last && r.last.length) h += '<div class="jq-sec">recent results</div>' + r.last.slice(0, 5).map(function (e) { var w = e.winners && e.winners.length ? ' \u00b7 won by @' + escH(e.winners[0].u) : (e.goal ? (e.goal.met ? ' \u00b7 goal met' : ' \u00b7 goal missed') : ''); return '<div class="jq-row">\u2726 ' + (EV_NAMES[e.type] || e.type) + w + '</div>'; }).join('');
    if (r.hist && r.hist.length) h += '<div class="jq-sec">ur event history</div>' + r.hist.slice(0, 8).map(function (e) { return '<div class="jq-row">\u2726 ' + (EV_NAMES[e.type] || e.type) + (e.place ? ' \u00b7 #' + e.place : '') + (e.prize ? ' \u00b7 +\u00a2' + e.prize : '') + '</div>'; }).join('');
    if (!h) h = '<div class="jq-row">no events yet \u2014 one rolls in every 20 minutes</div>';
    $('wevents-body').innerHTML = h;
  }).catch(function () { $('wevents-body').innerHTML = '<div class="jq-row">couldnt load events</div>'; });
}
function closeEvents() { $('wevents').hidden = true; document.body.classList.remove('wov'); }
$('wevents-x').addEventListener('click', closeEvents);
$('wevents').addEventListener('click', function (e) { if (e.target === $('wevents')) closeEvents(); });
window.__events = { open: openEvents, close: closeEvents };
var mktQ = '', mktCat = '', mktSort = 'new', mktArm = '', mktArmT = null;
function mktItemName(id) { var it = (window.WSHOP || []).filter(function (x) { return x.id === id; })[0]; return it ? it.name : id; }
function openMarket() {
  $('wmarket').hidden = false;
  document.body.classList.add('wov');
  $('wmarket-body').innerHTML = '<div class="jq-row">opening the market\u2026</div>';
  loadMarket();
}
function loadMarket() {
  var qs = '?q=' + encodeURIComponent(mktQ) + '&cat=' + encodeURIComponent(mktCat) + '&sort=' + encodeURIComponent(mktSort);
  fetch('/api/world/market' + qs, { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { $('wmarket-body').innerHTML = '<div class="jq-row">couldnt load the market</div>'; return; }
    renderMarket(r);
  }).catch(function () { $('wmarket-body').innerHTML = '<div class="jq-row">couldnt load the market</div>'; });
}
function renderMarket(r) {
  var cats = [];
  (window.WSHOP || []).forEach(function (it) { if (cats.indexOf(it.cat) < 0) cats.push(it.cat); });
  var h = '<div class="mkt-controls"><input id="mkt-q" type="text" placeholder="search items or sellers\u2026" value="' + escH(mktQ) + '"><select id="mkt-cat"><option value="">all kinds</option>' + cats.map(function (ct) { return '<option value="' + escH(ct) + '"' + (mktCat === ct ? ' selected' : '') + '>' + escH(ct) + '</option>'; }).join('') + '</select><select id="mkt-sort"><option value="new"' + (mktSort === 'new' ? ' selected' : '') + '>newest</option><option value="lo"' + (mktSort === 'lo' ? ' selected' : '') + '>price low</option><option value="hi"' + (mktSort === 'hi' ? ' selected' : '') + '>price high</option></select></div>';
  h += '<div class="jq-sec">for sale \u00b7 ' + r.total + ' listings \u00b7 sellers pay a 5% fee</div>';
  if (!r.listings.length) h += '<div class="jq-row">nothing for sale right now \u2014 be the first to list something</div>';
  h += r.listings.map(function (l) {
    var hrs = Math.max(0, Math.round((l.exp - Date.now()) / 3600000));
    return '<div class="mkt-row"><span class="mkt-dot" style="background:' + l.color + ';color:' + l.color + '"></span><span class="mkt-nm">' + escH(l.name) + '<br><span style="color:' + (RAR_C[l.rarity] || '#fff') + ';font-size:12px">' + escH(l.rarity) + '</span> <span style="opacity:.65;font-size:12px">@' + escH(l.seller) + ' \u00b7 ' + hrs + 'h left</span></span>' + (l.mine ? '<span style="opacity:.7;font-size:12px">ur listing</span>' : '<button class="mkt-buy" data-lid="' + l.lid + '" type="button">\u00a2' + l.price + '</button>') + '</div>';
  }).join('');
  h += '<div class="jq-sec">ur listings (' + r.mine.length + '/' + r.maxList + ')</div>';
  if (!r.mine.length) h += '<div class="jq-row">nothing listed \u2014 list something below</div>';
  h += r.mine.map(function (l) { return '<div class="mkt-row"><span class="mkt-nm">' + escH(l.name) + ' \u00b7 \u00a2' + l.price + '</span><button class="mkt-cancel" data-lid="' + l.lid + '" type="button">cancel</button></div>'; }).join('');
  var equipped = {}; Object.keys(myWearIds || {}).forEach(function (k) { if (myWearIds[k]) equipped[myWearIds[k]] = 1; });
  var sellable = (window.WSHOP || []).filter(function (it) { return myInv.indexOf(it.id) >= 0 && !it.vaultOnly && !equipped[it.id]; });
  h += '<div class="jq-sec">list an item</div>';
  if (!sellable.length) h += '<div class="jq-row">nothing sellable in ur bag \u2014 equipped and bound items cant be listed</div>';
  else h += '<div class="mkt-controls"><select id="mkt-sell-item">' + sellable.map(function (it) { return '<option value="' + it.id + '">' + escH(it.name) + ' (' + escH(it.rarity) + ')</option>'; }).join('') + '</select><input id="mkt-sell-price" type="number" min="10" max="50000" placeholder="price \u00a2" style="max-width:110px"><button class="mkt-list-btn" id="mkt-sell-go" type="button">list it</button></div><div class="jq-row" style="font-size:12px;opacity:.7">listings last 48h \u00b7 the item leaves ur bag while its listed \u00b7 u get 95% when it sells</div>';
  if (r.hist && r.hist.length) {
    h += '<div class="jq-sec">ur market history</div>' + r.hist.slice(0, 8).map(function (e) {
      var nm = mktItemName(e.item);
      if (e.t === 'bought') return '<div class="jq-row">bought ' + escH(nm) + ' from @' + escH(e.who || '') + ' \u00b7 \u00a2' + e.price + '</div>';
      if (e.t === 'sold') return '<div class="jq-row">sold ' + escH(nm) + ' to @' + escH(e.who || '') + ' \u00b7 +\u00a2' + e.got + ' after fee</div>';
      if (e.t === 'listed') return '<div class="jq-row">listed ' + escH(nm) + ' \u00b7 \u00a2' + e.price + '</div>';
      if (e.t === 'cancelled') return '<div class="jq-row">cancelled ' + escH(nm) + ' \u00b7 item returned</div>';
      if (e.t === 'expired') return '<div class="jq-row">' + escH(nm) + ' expired unsold \u00b7 item returned</div>';
      return '';
    }).join('');
  }
  $('wmarket-body').innerHTML = h;
  var qEl = $('mkt-q');
  qEl.addEventListener('change', function () { mktQ = qEl.value; loadMarket(); });
  $('mkt-cat').addEventListener('change', function () { mktCat = this.value; loadMarket(); });
  $('mkt-sort').addEventListener('change', function () { mktSort = this.value; loadMarket(); });
  Array.prototype.forEach.call(document.querySelectorAll('.mkt-buy'), function (btn) {
    btn.addEventListener('click', function () {
      var lid = btn.getAttribute('data-lid');
      if (mktArm !== lid) {
        mktArm = lid; btn.classList.add('arm'); btn.textContent = 'confirm buy?';
        clearTimeout(mktArmT); mktArmT = setTimeout(function () { mktArm = ''; loadMarket(); }, 3000);
        return;
      }
      clearTimeout(mktArmT); mktArm = '';
      jpost('/api/world/market', { act: 'buy', lid: lid }).then(function (rr) {
        if (rr && rr.ok) { toast('\u2726 bought ' + mktItemName(rr.item) + ' for \u00a2' + rr.price, 3600); sndQuest(); }
        else toast('buy failed', (rr && rr.err) || '');
        loadMarket();
      });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.mkt-cancel'), function (btn) {
    btn.addEventListener('click', function () {
      jpost('/api/world/market', { act: 'cancel', lid: btn.getAttribute('data-lid') }).then(function (rr) {
        if (rr && rr.ok) toast('listing cancelled \u2014 item is back in ur bag', 3000); else toast('cancel failed', (rr && rr.err) || '');
        loadMarket();
      });
    });
  });
  var go = $('mkt-sell-go');
  if (go) go.addEventListener('click', function () {
    var item = $('mkt-sell-item').value;
    var price = parseInt($('mkt-sell-price').value, 10);
    if (!(price >= 10)) { toast('price must be at least \u00a210', ''); return; }
    jpost('/api/world/market', { act: 'list', item: item, price: price }).then(function (rr) {
      if (rr && rr.ok) { toast('\u2726 listed \u2014 the item sits in escrow till it sells', 3600); sndQuest(); }
      else toast('listing failed', (rr && rr.err) || '');
      loadMarket();
    });
  });
}
function closeMarket() { $('wmarket').hidden = true; document.body.classList.remove('wov'); }
$('wmarket-x').addEventListener('click', closeMarket);
$('wmarket').addEventListener('click', function (e) { if (e.target === $('wmarket')) closeMarket(); });
window.__market = { open: openMarket, close: closeMarket };
function openCollect() {
  $('wcollect').hidden = false;
  document.body.classList.add('wov');
  $('wcollect-body').innerHTML = '<div class="jq-row">opening ur journal\u2026</div>';
  loadCollect();
}
function loadCollect() {
  fetch('/api/world/journal', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { $('wcollect-body').innerHTML = '<div class="jq-row">couldnt load the journal</div>'; return; }
    renderCollect(r);
  }).catch(function () { $('wcollect-body').innerHTML = '<div class="jq-row">couldnt load the journal</div>'; });
}
function renderCollect(r) {
  var h = '<div class="jq-sec">ur whole collection \u00b7 ' + r.overall + '%</div><div class="col-bar"><i style="width:' + r.overall + '%"></i></div>';
  var ready = r.milestones.filter(function (m) { return m.state === 'ready'; });
  if (ready.length) h += ready.map(function (m) { return '<div class="col-ms"><span>\u2726 ' + escH(m.label) + ' complete \u00b7 +\u00a2' + m.amt + '</span><button class="col-claim" data-ms="' + m.id + '" type="button">claim</button></div>'; }).join('');
  if (r.recent && r.recent.length) h += '<div class="jq-sec">recently discovered</div><div class="col-grid">' + r.recent.map(function (e) { return '<span class="col-chip">' + escH(e.name) + '</span>'; }).join('') + '</div>';
  h += r.cats.map(function (ct) {
    var s = '<div class="jq-sec">' + escH(ct.name) + ' \u00b7 ' + ct.got + '/' + ct.total + ' \u00b7 ' + ct.pct + '%</div><div class="col-bar"><i style="width:' + ct.pct + '%"></i></div><div class="col-grid">';
    s += ct.entries.map(function (e) {
      if (e.got) return '<span class="col-chip">' + (e.color ? '<span class="col-dot" style="background:' + e.color + '"></span>' : '') + escH(e.name) + (e.max ? ' \u00b7 ' + e.n + '/' + e.max : (e.n ? ' \u00b7 \u00d7' + e.n : '')) + '</span>';
      if (e.max) return '<span class="col-chip miss">' + escH(e.name) + ' \u00b7 ' + (e.n || 0) + '/' + e.max + '</span>';
      return '<span class="col-chip miss">??? \u00b7 ' + escH(e.sub || '') + '</span>';
    }).join('');
    return s + '</div>';
  }).join('');
  var locked = r.milestones.filter(function (m) { return m.state !== 'claimed'; }).length;
  h += '<div class="jq-row" style="font-size:12px;opacity:.7">milestones pay out at 25/50/75/100% per category \u00b7 ' + locked + ' still out there \u00b7 stuff u sell or trade away still counts \u2014 the journal remembers</div>';
  $('wcollect-body').innerHTML = h;
  Array.prototype.forEach.call(document.querySelectorAll('.col-claim'), function (btn) {
    btn.addEventListener('click', function () {
      jpost('/api/world/journal', { id: btn.getAttribute('data-ms') }).then(function (rr) {
        if (rr && rr.ok) { toast('\u2726 milestone claimed \u00b7 +\u00a2' + rr.amt, 3600); sndQuest(); }
        else toast('claim failed', (rr && rr.err) || '');
        loadCollect();
      });
    });
  });
}
function closeCollect() { $('wcollect').hidden = true; document.body.classList.remove('wov'); }
$('wcollect-x').addEventListener('click', closeCollect);
$('wcollect').addEventListener('click', function (e) { if (e.target === $('wcollect')) closeCollect(); });
window.__collect = { open: openCollect, close: closeCollect };
/* settings, ambient audio, hub, inventory, big map, admin */
var SET = { vol: 0.85, music: true, sfx: true };
try { var svSet = JSON.parse(localStorage.getItem('sixSettings') || 'null'); if (svSet) SET = Object.assign(SET, svSet); } catch (e) {}
function saveSet() { try { localStorage.setItem('sixSettings', JSON.stringify(SET)); } catch (e) {} }
var WX = 'clear', lastAnnAt = 0, myZonesList = [];
var audioTouched = false;
window.addEventListener('pointerdown', function () { audioTouched = true; }, { once: true });
var AMB_ROOTS = [220, 196, 174.61, 146.83, 164.81, 196];
var ambIx = 0;
setInterval(function () {
  if (!SET.music || !audioTouched || document.hidden) return;
  var a = ac(); if (!a) return;
  var root = AMB_ROOTS[ambIx++ % AMB_ROOTS.length];
  [1, 1.5, 2].forEach(function (m, i) {
    var o = a.createOscillator(), gn = a.createGain(), t = a.currentTime;
    o.type = 'triangle'; o.frequency.value = root * m;
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(0.03 * SET.vol / (i + 1), t + 1.8);
    gn.gain.linearRampToValueAtTime(0, t + 7.5);
    o.connect(gn); gn.connect(a.destination); o.start(t); o.stop(t + 7.6);
  });
}, 8000);
/* hub */
var HUB_DEFS = [
  ['minigames', '<path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/><path d="M17.3 5H6.7a4.7 4.7 0 0 0-4.6 5.6l.7 3.6A3 3 0 0 0 5.7 17c.8 0 1.6-.4 2.2-1L9 14.5h6.1L16.2 16c.6.6 1.4 1 2.2 1a3 3 0 0 0 2.9-2.8l.7-3.6A4.7 4.7 0 0 0 17.3 5Z"/>', function () { openArcade(); }],
  ['six cents shop', '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.5a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.2L20.5 7H6"/>', function () { openShop(); }],
  ['marketplace', '<path d="M3 9 4.5 3h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>', function () { openMarket(); }],
  ['ur stuff', '<path d="M6 8h12l1.2 12H4.8L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', function () { openInv(); }],
  ['ur house', '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>', function () { openHouse(); }],
  ['mount up', '<circle cx="5.5" cy="17.5" r="2.4"/><circle cx="18.5" cy="17.5" r="2.4"/><path d="M5.5 17.5 10 8h5l3.5 9.5M10 8 8.2 4.5H5.8"/>', function () { openShop(); shopTab = 'mount'; renderShopTabs(); renderShopGrid(); }],
  ['sunken crypt', '<path d="M5 20V10l7-6 7 6v10"/><path d="M10 20v-5a2 2 0 1 1 4 0v5"/>', function () { toast('the crypt gate waits in the crystal caves \u00b7 bring ur party \u00b7 3 rewarded runs a day', 4600); }],
  ['world boss', '<circle cx="12" cy="9" r="5"/><path d="M9 8h.01M15 8h.01M8 20c0-3 1.8-5 4-5s4 2 4 5"/>', function () { toast(BOSS_V ? (BOSS_V.dead ? 'the lich is felled \u2014 it rises again next cycle' : 'the lich is UP at the lake \u00b7 hp ' + BOSS_V.hp + '/' + BOSS_V.max) : 'the drowned lich rises at the lake for 5 min every 25 \u00b7 kill it together for a \u00a2600 split', 4600); }],
  ['fishing', '<path d="M14 3v9.5"/><path d="M14 12.5c0 3 2.5 3.4 2.5 6a4.5 4.5 0 1 1-6.4-4"/><circle cx="14" cy="3" r="1.4"/>', function () { openFish(); }],
  ['pets', '<circle cx="7.5" cy="8" r="1.8"/><circle cx="12" cy="5.8" r="1.8"/><circle cx="16.5" cy="8" r="1.8"/><path d="M12 11c2.9 0 5.4 2.2 5.4 4.7 0 1.9-1.5 3.1-3.3 3.1-1 0-1.5-.4-2.1-.4s-1.1.4-2.1.4c-1.8 0-3.3-1.2-3.3-3.1C6.6 13.2 9.1 11 12 11Z"/>', function () { openPets(); }],
  ['world map', '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>', function () { openMap2(); }],
  ['races', '<path d="M4 21V4"/><path d="M4 5h13l-2.5 3.5L17 12H4"/>', function () { openRace(); }],
  ['guild', '<path d="M5 21V4"/><path d="M5 5h12.5L15 8.5 17.5 12H5"/>', function () { openGuild(); }],
  ['trade', '<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 12 4 4-4 4"/><path d="M21 16H7"/>', function () { openTrade(); }],
  ['crafting', '<path d="M15 12l-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9"/><path d="M17.6 3.4a4.5 4.5 0 0 0-6 6L15 12.8a4.5 4.5 0 0 0 6-6l-2.7 2.7-2.1-.7-.7-2.1 2.1-2.3Z"/>', function () { openCraft(); }],
  ['skills', '<path d="M12 3l1.9 4.6 4.6 1.4-4.6 1.4L12 15l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M18.6 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>', function () { openSkills(); }],
  ['photo', '<path d="M4 8h2.2l2-2.5h7.6l2 2.5H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.4"/>', function () { openPhoto(); }],
  ['quest journal', '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>', function () { openJournal(); }],
  ['achievements', '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>', function () { openAch(); }],
  ['leaderboards', '<path d="M3 3v18h18"/><path d="M8 17v-6"/><path d="M13 17V7"/><path d="M18 17v-9"/>', function () { openBoards(); }],
  ['events', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>', function () { openEvents(); }],
  ['collections', '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7"/><path d="M9 11h5"/>', function () { openCollect(); }],
  ['character', '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-3.6 4-5.5 8-5.5s7.2 1.9 8 5.5"/>', function () { openChar(); }],
  ['emotes', '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01"/>', function () { var ep = $('wemotes'); if (ep) ep.hidden = !ep.hidden; }],
  ['settings', '<circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.36.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.38 2.54a7 7 0 0 0-2.42 1.4l-2.36-.95-2 3.46 2 1.55a7 7 0 0 0 0 2.8l-2 1.55 2 3.46 2.36-.95a7 7 0 0 0 2.42 1.4l.38 2.54h3.4l.38-2.54a7 7 0 0 0 2.42-1.4l2.36.95 2-3.46-2-1.55c.1-.45.14-.92.14-1.4Z"/>', function () { openSettings(); }],
];
function openHub() {
  var grid = $('whub-grid');
  if (!grid.children.length) {
    HUB_DEFS.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'hub-btn';
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d[1] + '</svg><span>' + d[0] + '</span>';
      b.addEventListener('click', function () { closeHub(); d[2](); });
      grid.appendChild(b);
    });
  }
  $('whub').hidden = false;
  document.body.classList.add('wov');
}
function closeHub() { $('whub').hidden = true; document.body.classList.remove('wov'); }
$('whubbtn').addEventListener('click', openHub);
$('whub-x').addEventListener('click', closeHub);
$('whub').addEventListener('click', function (e) { if (e.target === $('whub')) closeHub(); });
window.__hub = { open: openHub, close: closeHub };
/* inventory + outfit presets */
var invCat = 'all', invPresets = {};
var RAR_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };
function openInv() {
  $('winv').hidden = false;
  document.body.classList.add('wov');
  renderInvCats(); renderInvPresets(); renderInvGrid();
  jpost('/api/world/preset', { act: 'get' }).then(function (r) { if (r && r.ok) { invPresets = r.presets || {}; renderInvPresets(); } });
}
function closeInv() { $('winv').hidden = true; document.body.classList.remove('wov'); }
function renderInvCats() {
  var cats = [['all', 'all'], ['trail', 'trails'], ['hat', 'hats'], ['aura', 'auras'], ['pet', 'pets'], ['face', 'faces']];
  $('winv-cats').innerHTML = cats.map(function (c) { return '<button type="button" class="inv-chip' + (invCat === c[0] ? ' on' : '') + '" data-cat="' + c[0] + '">' + c[1] + '</button>'; }).join('');
  Array.prototype.forEach.call($('winv-cats').querySelectorAll('.inv-chip'), function (b) {
    b.addEventListener('click', function () { invCat = b.getAttribute('data-cat'); renderInvCats(); renderInvGrid(); });
  });
}
function renderInvPresets() {
  var h = '<div class="jq-sec">outfit presets</div><div class="inv-presets">';
  for (var s = 1; s <= 3; s++) {
    var has = invPresets[s] && Object.keys(invPresets[s]).length;
    h += '<div class="inv-preset"><span>outfit ' + s + (has ? '' : ' \u00b7 empty') + '</span><button type="button" data-slot="' + s + '" class="inv-wear" ' + (has ? '' : 'disabled') + '>wear</button><button type="button" data-slot="' + s + '" class="inv-save">save</button></div>';
  }
  $('winv-presets').innerHTML = h + '</div>';
  Array.prototype.forEach.call($('winv-presets').querySelectorAll('.inv-wear'), function (b) {
    b.addEventListener('click', function () { jpost('/api/world/preset', { act: 'apply', slot: Number(b.getAttribute('data-slot')) }).then(function (r) { toast(r && r.ok ? 'outfit on \u2726' : 'couldnt wear it', (r && r.err) || ''); }); });
  });
  Array.prototype.forEach.call($('winv-presets').querySelectorAll('.inv-save'), function (b) {
    b.addEventListener('click', function () { jpost('/api/world/preset', { act: 'save', slot: Number(b.getAttribute('data-slot')) }).then(function (r) { if (r && r.ok) { invPresets = r.presets || invPresets; renderInvPresets(); toast('outfit saved'); } }); });
  });
}
function renderInvGrid() {
  var q = ($('winv-q').value || '').toLowerCase();
  var items = (window.WSHOP || []).filter(function (it) { return myInv.indexOf(it.id) >= 0; });
  if (invCat !== 'all') items = items.filter(function (it) { return it.cat === invCat; });
  if (q) items = items.filter(function (it) { return it.name.toLowerCase().indexOf(q) >= 0; });
  items.sort(function (a, b) { return (RAR_ORDER[b.rarity] || 0) - (RAR_ORDER[a.rarity] || 0) || b.price - a.price; });
  var grid = $('winv-grid');
  if (!items.length) { grid.innerHTML = '<div class="jq-row">nothing here yet \u2014 the shop tent at the neon market sells trails, hats, auras, pets + faces</div>'; return; }
  grid.innerHTML = '';
  items.forEach(function (it) {
    var equipped = myWearIds[it.cat] === it.id;
    var d = document.createElement('button');
    d.type = 'button'; d.className = 'inv-card' + (equipped ? ' on' : '');
    d.innerHTML = '<span class="inv-dot" style="background:' + it.color + '"></span><span class="inv-nm">' + escH(it.name) + '</span><span class="inv-meta">' + it.cat + ' \u00b7 ' + it.rarity + (equipped ? ' \u00b7 ON' : '') + '</span>';
    d.addEventListener('click', function () {
      jpost('/api/world/shopequip', { cat: it.cat, id: equipped ? '' : it.id }).then(function (r) {
        if (r && r.ok) { if (equipped) delete myWearIds[it.cat]; else myWearIds[it.cat] = it.id; renderInvGrid(); }
        else toast('couldnt swap', (r && r.err) || '');
      });
    });
    grid.appendChild(d);
  });
}
$('winv-x').addEventListener('click', closeInv);
$('winv').addEventListener('click', function (e) { if (e.target === $('winv')) closeInv(); });
$('winv-q').addEventListener('input', renderInvGrid);
window.__inv = { open: openInv, close: closeInv };
/* big map + fast travel */
var ZONE_SPOTS = [
  ['fountain', 'the fountain', 2400, 1500], ['stage', 'the stage', 2400, 1905], ['arcade', 'the arcade', 1780, 1215],
  ['theater', 'the theater', 3020, 1215], ['lounge', 'the chat lounge', 1710, 1500], ['party', 'the party house', 3090, 1500],
  ['tube', 'tube corner', 1780, 1800], ['tiktok', 'the tiktok wall', 3020, 1800], ['blox', 'blox tower', 2400, 1120],
  ['garden', 'the lamp garden', 700, 900], ['overlook', 'the east overlook', 3400, 750], ['spawn', 'spawn plaza', 2400, 1700],
  ['lake', 'the moonlit lake', 2400, 2600], ['pier', 'the pier', 2400, 2400], ['forest', 'the pine forest', 650, 2100],
  ['market', 'neon market', 3950, 1600], ['heights', 'blox heights', 3950, 480], ['neon', 'the neon district', 5600, 1150],
  ['rooftops', 'the rooftops', 5650, 600], ['alley', 'the back alley', 6150, 1620], ['sky', 'the sky islands', 5650, 280],
  ['eastwild', 'the eastern wilds', 5600, 2500], ['underarcade', 'the underground arcade', 5650, 3600], ['vault', 'the vault', 5650, 3990],
  ['caves', 'the crystal caves', 1150, 3650], ['cavedeep', 'the deep caves', 2100, 3980], ['sunken', 'the sunken flats', 3600, 3650]
];
var MAPZ = [
  ['fountain', 'the fountain', 2400, 1500, 125, '#8b7cff'], ['stage', 'the stage', 2400, 1905, 140, '#f472b6'],
  ['arcade', 'the arcade', 1780, 1215, 140, '#38b6ff'], ['theater', 'the theater', 3020, 1215, 140, '#c86bff'],
  ['lounge', 'the chat lounge', 1710, 1500, 125, '#3ddc84'], ['party', 'the party house', 3090, 1500, 125, '#ffb52e'],
  ['tube', 'tube corner', 1780, 1800, 135, '#fb7185'], ['tiktok', 'the tiktok wall', 3020, 1800, 135, '#67e8f9'],
  ['blox', 'blox tower', 2400, 1120, 125, '#f0abfc'], ['garden', 'the lamp garden', 700, 900, 230, '#a3e635'],
  ['overlook', 'the east overlook', 3400, 750, 210, '#fbbf24'], ['spawn', 'spawn plaza', 2400, 1700, 140, '#e8e6ff'],
  ['lake', 'the moonlit lake', 2400, 2600, 400, '#3b82f6'], ['pier', 'the pier', 2400, 2400, 170, '#93c5fd'],
  ['forest', 'the pine forest', 650, 2100, 400, '#22c55e'], ['market', 'neon market', 3950, 1600, 330, '#f472b6'],
  ['heights', 'blox heights', 3950, 480, 260, '#fb923c'], ['neon', 'the neon district', 5600, 1150, 580, '#e879f9'],
  ['rooftops', 'the rooftops', 5650, 600, 175, '#a78bfa'], ['alley', 'the back alley', 6150, 1620, 130, '#94a3b8'],
  ['sky', 'the sky islands', 5650, 280, 430, '#7dd3fc'], ['eastwild', 'the eastern wilds', 5600, 2500, 520, '#4ade80'],
  ['underarcade', 'the underground arcade', 5650, 3600, 340, '#818cf8'], ['vault', 'the vault', 5650, 3990, 380, '#ffd257'],
  ['maple', 'maple row', 900, 3080, 330, '#f59e0b'], ['caves', 'the crystal caves', 1150, 3650, 640, '#22d3ee'],
  ['cavedeep', 'the deep caves', 2100, 3980, 230, '#0ea5e9'], ['sunken', 'the sunken flats', 3600, 3650, 620, '#2dd4bf']
];
var MAPV = { z: 1, cx: 3200, cy: 2100 };
var map2Timer = 0;
function mHash(x, y) { var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function openMap2() {
  $('wmap2').hidden = false; document.body.classList.add('wov');
  MAPV.z = 1; MAPV.cx = 3200; MAPV.cy = 2100;
  map2Info(myZonesList.length + ' / ' + MAPZ.length + ' zones discovered' + (INST_V || myHouse ? ' · ur inside rn — the map shows the overworld' : ''));
  drawMap2();
  if (map2Timer) clearInterval(map2Timer);
  map2Timer = setInterval(drawMap2, 1000);
}
function closeMap2() { $('wmap2').hidden = true; document.body.classList.remove('wov'); if (map2Timer) { clearInterval(map2Timer); map2Timer = 0; } }
function map2Info(t) { var el = $('wmap2-info'); if (el) el.textContent = t; }
function drawMap2() {
  var c = $('wmap2-cv'); if (!c || $('wmap2').hidden) return;
  var g2 = c.getContext('2d');
  var W = c.width, H = c.height;
  var s = Math.min(W / 6400, H / 4200) * MAPV.z;
  var ox = W / 2 - MAPV.cx * s, oy = H / 2 - MAPV.cy * s;
  function X(wx) { return wx * s + ox; }
  function Y(wy) { return wy * s + oy; }
  var now = performance.now();
  g2.shadowColor = 'rgba(4,2,12,.92)'; g2.shadowBlur = 5;
  var bg = g2.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0c0820'); bg.addColorStop(1, '#070513');
  g2.fillStyle = bg; g2.fillRect(0, 0, W, H);
  g2.strokeStyle = 'rgba(139,124,255,.055)'; g2.lineWidth = 1;
  for (var gx = 0; gx <= 6400; gx += 400) { g2.beginPath(); g2.moveTo(X(gx), Y(0)); g2.lineTo(X(gx), Y(4200)); g2.stroke(); }
  for (var gy = 0; gy <= 4200; gy += 400) { g2.beginPath(); g2.moveTo(X(0), Y(gy)); g2.lineTo(X(6400), Y(gy)); g2.stroke(); }
  /* the lake + pier */
  var lg = g2.createLinearGradient(0, Y(LAKE.y1), 0, Y(LAKE.y2));
  lg.addColorStop(0, 'rgba(59,110,246,.5)'); lg.addColorStop(1, 'rgba(30,64,175,.62)');
  g2.fillStyle = lg;
  g2.beginPath(); g2.ellipse(X(2400), Y(2600), (LAKE.x2 - LAKE.x1) / 2 * s, (LAKE.y2 - LAKE.y1) / 2 * s, 0, 0, TAU); g2.fill();
  g2.fillStyle = 'rgba(146,104,58,.85)';
  g2.fillRect(X(PIER.x1), Y(PIER.y1), (PIER.x2 - PIER.x1) * s, (PIER.y2 - PIER.y1) * s);
  /* zones */
  MAPZ.forEach(function (z) {
    var found = myZonesList.indexOf(z[0]) >= 0;
    var cxp = X(z[2]), cyp = Y(z[3]), rr2 = z[4] * s;
    g2.fillStyle = z[5] + (found ? '24' : '10');
    g2.beginPath(); g2.arc(cxp, cyp, rr2, 0, TAU); g2.fill();
    g2.strokeStyle = z[5] + (found ? 'aa' : '44'); g2.lineWidth = found ? 1.6 : 1;
    g2.setLineDash(found ? [] : [5, 5]);
    g2.beginPath(); g2.arc(cxp, cyp, rr2, 0, TAU); g2.stroke();
    g2.setLineDash([]);
    g2.fillStyle = z[5];
    g2.beginPath(); g2.arc(cxp, cyp, 2.4, 0, TAU); g2.fill();
    if (rr2 > 30) {
      g2.font = '700 ' + Math.max(11, Math.min(15, rr2 / 5.4)) + 'px Inter, sans-serif'; g2.textAlign = 'center';
      g2.fillStyle = found ? 'rgba(243,239,255,.94)' : 'rgba(190,182,225,.5)';
      g2.fillText(z[1], cxp, cyp - 4);
      g2.font = '600 9.5px Inter, sans-serif';
      g2.fillStyle = found ? 'rgba(167,159,208,.75)' : 'rgba(150,140,190,.45)';
      g2.fillText(found ? 'tap to fast travel' : 'not discovered', cxp, cyp + 11);
    }
  });
  /* terrain detail */
  for (var ti = 0; ti < 110; ti++) {
    var ta = mHash(ti, 7) * TAU, td = Math.sqrt(mHash(ti, 13)) * 380;
    var txp = X(650 + Math.cos(ta) * td), typ = Y(2100 + Math.sin(ta) * td);
    g2.fillStyle = ti % 3 ? 'rgba(34,197,94,.5)' : 'rgba(21,128,61,.65)';
    g2.beginPath(); g2.moveTo(txp, typ - 5); g2.lineTo(txp - 3.4, typ + 3); g2.lineTo(txp + 3.4, typ + 3); g2.closePath(); g2.fill();
  }
  for (var ci2 = 0; ci2 < 46; ci2++) {
    var ca = mHash(ci2, 29) * TAU, cd = Math.sqrt(mHash(ci2, 31)) * 600;
    g2.fillStyle = ci2 % 2 ? 'rgba(103,232,249,.75)' : 'rgba(196,181,253,.75)';
    g2.beginPath(); g2.arc(X(1150 + Math.cos(ca) * cd), Y(3650 + Math.sin(ca) * cd * 0.7), 1.8, 0, TAU); g2.fill();
  }
  g2.strokeStyle = 'rgba(232,121,249,.16)'; g2.lineWidth = 1;
  for (var nb = 0; nb < 5; nb++) { g2.strokeRect(X(5080 + nb * 210), Y(660), 150 * s, 900 * s); }
  g2.strokeStyle = 'rgba(125,211,252,.35)'; g2.lineWidth = 1.4;
  [[5650, 430, 5400, 380], [5400, 380, 5200, 250], [5200, 250, 5650, 180], [5650, 180, 6150, 300], [6150, 300, 5650, 430]].forEach(function (br) { g2.beginPath(); g2.moveTo(X(br[0]), Y(br[1])); g2.lineTo(X(br[2]), Y(br[3])); g2.stroke(); });
  [[5650, 430, 150], [5400, 380, 120], [5200, 250, 140], [5650, 180, 150], [6150, 300, 120]].forEach(function (is2) {
    g2.fillStyle = 'rgba(125,211,252,.3)';
    g2.beginPath(); g2.ellipse(X(is2[0]), Y(is2[1]), is2[2] * s, is2[2] * 0.42 * s, 0, 0, TAU); g2.fill();
    g2.strokeStyle = 'rgba(125,211,252,.5)'; g2.stroke();
  });
  g2.strokeStyle = 'rgba(245,158,11,.55)'; g2.lineWidth = Math.max(2, 7 * s);
  g2.beginPath(); g2.moveTo(X(690), Y(3080)); g2.lineTo(X(1110), Y(3080)); g2.stroke();
  for (var mh = 0; mh < 6; mh++) {
    g2.fillStyle = ['#b45309', '#92400e', '#a16207', '#b45309', '#92400e', '#a16207'][mh];
    g2.fillRect(X(712 + mh * 68) - 11 * s, Y(3080 + (mh % 2 ? 44 : -44)) - 9 * s, 22 * s, 18 * s);
  }
  g2.strokeStyle = 'rgba(45,212,191,.4)'; g2.lineWidth = 1.4;
  for (var wv = 0; wv < 3; wv++) {
    g2.beginPath();
    for (var wx2 = 3050; wx2 <= 4150; wx2 += 55) { var wy2 = 3560 + wv * 90 + Math.sin(wx2 / 130 + wv) * 13; if (wx2 === 3050) g2.moveTo(X(wx2), Y(wy2)); else g2.lineTo(X(wx2), Y(wy2)); }
    g2.stroke();
  }
  g2.strokeStyle = '#ffd257'; g2.lineWidth = 2;
  g2.beginPath(); g2.arc(X(5650), Y(3990), 46 * s, 0, TAU); g2.stroke();
  g2.beginPath(); g2.arc(X(5650), Y(3990), 30 * s, 0, TAU); g2.stroke();
  /* points of interest */
  PORTALS.forEach(function (pad) {
    g2.strokeStyle = pad.c; g2.lineWidth = 2.2;
    g2.beginPath(); g2.arc(X(pad.x), Y(pad.y), Math.max(5, 42 * s), 0, TAU); g2.stroke();
    g2.fillStyle = pad.c;
    g2.beginPath(); g2.arc(X(pad.x), Y(pad.y), 2.6, 0, TAU); g2.fill();
    if (s > 0.09) { g2.font = '600 10px Inter, sans-serif'; g2.textAlign = 'center'; g2.fillStyle = 'rgba(230,225,255,.78)'; g2.fillText(pad.sub, X(pad.x), Y(pad.y) + Math.max(5, 42 * s) + 12); }
  });
  g2.fillStyle = '#ffd257';
  star4(g2, X(2400), Y(1500), 8, now / 900); g2.fill();
  g2.fillStyle = '#fbbf24';
  g2.beginPath(); g2.moveTo(X(3950), Y(1568)); g2.lineTo(X(3924), Y(1606)); g2.lineTo(X(3976), Y(1606)); g2.closePath(); g2.fill();
  if (s > 0.09) { g2.font = '600 10px Inter, sans-serif'; g2.textAlign = 'center'; g2.fillStyle = 'rgba(230,225,255,.78)'; g2.fillText('six cents shop', X(3950), Y(1630)); }
  g2.fillStyle = '#221c33'; g2.fillRect(X(5050) - 16 * s, Y(3550) - 20 * s, 32 * s, 26 * s);
  g2.fillStyle = '#a78bfa'; g2.fillRect(X(5050) - 10 * s, Y(3550) - 14 * s, 20 * s, 20 * s);
  if (s > 0.09) { g2.font = '600 10px Inter, sans-serif'; g2.textAlign = 'center'; g2.fillStyle = 'rgba(196,181,253,.9)'; g2.fillText('the sunken crypt', X(5050), Y(3550) + 26 * s + 8); }
  if (BOSS_V) {
    var bp2 = BOSS_V;
    g2.strokeStyle = bp2.dead ? 'rgba(148,163,184,.6)' : 'rgba(239,68,68,.9)'; g2.lineWidth = 2;
    g2.beginPath(); g2.arc(X(bp2.x), Y(bp2.y), 12 + Math.sin(now / 220) * 3, 0, TAU); g2.stroke();
    g2.fillStyle = bp2.dead ? '#94a3b8' : '#fca5a5';
    g2.beginPath(); g2.arc(X(bp2.x), Y(bp2.y), 4, 0, TAU); g2.fill();
    g2.font = '700 11px Inter, sans-serif'; g2.textAlign = 'center';
    g2.fillText(bp2.dead ? 'the lich — felled' : 'the drowned lich · hp ' + bp2.hp, X(bp2.x), Y(bp2.y) + 30);
  }
  Object.keys(shards).forEach(function (id) { var sh = shards[id]; if (!sh.gold) return; g2.fillStyle = '#ffd257'; g2.fillRect(X(sh.x) - 2, Y(sh.y) - 2, 4, 4); });
  /* players + npcs */
  Object.keys(players).forEach(function (u) {
    var p = players[u];
    if (!p || p.y > 4200 || u === me) return;
    var xp2 = X(p.x), yp2 = Y(p.y);
    if (p.npc) {
      g2.fillStyle = '#ffd257'; g2.beginPath(); g2.arc(xp2, yp2, 3.6, 0, TAU); g2.fill();
      g2.font = '700 10.5px Inter, sans-serif'; g2.textAlign = 'center'; g2.fillStyle = 'rgba(255,210,87,.92)';
      g2.fillText(p.u, xp2, yp2 - 8);
    } else if (myPartySet[u]) {
      g2.fillStyle = '#ffd257'; g2.beginPath(); g2.arc(xp2, yp2, 3.6, 0, TAU); g2.fill();
      g2.strokeStyle = 'rgba(255,210,87,.6)'; g2.lineWidth = 1.2; g2.beginPath(); g2.arc(xp2, yp2, 6.4, 0, TAU); g2.stroke();
      g2.font = '700 10.5px Inter, sans-serif'; g2.textAlign = 'center'; g2.fillStyle = 'rgba(255,230,150,.95)';
      g2.fillText(u, xp2, yp2 - 10);
    } else {
      g2.fillStyle = 'rgba(210,200,255,.75)'; g2.beginPath(); g2.arc(xp2, yp2, 2.6, 0, TAU); g2.fill();
      if (MAPV.z >= 1.7) { g2.font = '600 9.5px Inter, sans-serif'; g2.textAlign = 'center'; g2.fillStyle = 'rgba(200,190,240,.55)'; g2.fillText(u, xp2, yp2 - 7); }
    }
  });
  if (py <= 4200) {
    g2.strokeStyle = 'rgba(255,255,255,.85)'; g2.lineWidth = 1.6;
    g2.beginPath(); g2.arc(X(px), Y(py), 8 + Math.sin(now / 240) * 1.6, 0, TAU); g2.stroke();
    g2.fillStyle = '#ffffff';
    star4(g2, X(px), Y(py), 5.4, now / 700); g2.fill();
    g2.font = '800 11px Inter, sans-serif'; g2.textAlign = 'center'; g2.fillStyle = '#fff';
    g2.fillText('u', X(px), Y(py) - 14);
  }
  g2.shadowBlur = 0;
  var cp = camPos();
  g2.strokeStyle = 'rgba(255,255,255,.35)'; g2.lineWidth = 1;
  g2.strokeRect(X(cp.x), Y(cp.y), VW * s, VH * s);
  g2.strokeStyle = 'rgba(255,255,255,.22)';
  g2.strokeRect(X(0), Y(0), 6400 * s, 4200 * s);
}
var mapPtrs = {}, mapDrag = null;
function map2World(c, ev) {
  var r = c.getBoundingClientRect();
  var s = Math.min(c.width / 6400, c.height / 4200) * MAPV.z;
  var cxp = (ev.clientX - r.left) * (c.width / r.width), cyp = (ev.clientY - r.top) * (c.height / r.height);
  return { x: MAPV.cx + (cxp - c.width / 2) / s, y: MAPV.cy + (cyp - c.height / 2) / s, s: s };
}
function map2Tap(wx, wy) {
  var pois = [[5050, 3550, 'the sunken crypt — a 3-wave party dungeon. clear it for 120 cents, up to 3 paid runs a day'], [3950, 1600, 'the six cents shop — spend world cents on trails, pets, mounts, rods + more'], [2400, 1500, 'the fountain — toss a wish, sometimes it pays back big']];
  for (var i = 0; i < PORTALS.length; i++) pois.push([PORTALS[i].x, PORTALS[i].y, PORTALS[i].label + ' — portal to ' + PORTALS[i].sub]);
  if (BOSS_V) pois.push([BOSS_V.x, BOSS_V.y, BOSS_V.dead ? 'the drowned lich — felled. it rises again next cycle' : 'the drowned lich is UP — hp ' + BOSS_V.hp + '/' + BOSS_V.max + '. everyone who hits it splits 600 cents']);
  for (var j = 0; j < pois.length; j++) if (Math.hypot(wx - pois[j][0], wy - pois[j][1]) < 110) { map2Info(pois[j][2]); return; }
  var best = null;
  MAPZ.forEach(function (z) { if (Math.hypot(wx - z[2], wy - z[3]) < z[4]) best = z; });
  if (!best) return;
  if (myZonesList.indexOf(best[0]) < 0) { map2Info(best[1] + ' — not discovered yet. walk there once and it unlocks for fast travel'); return; }
  jpost('/api/world/travel', { zone: best[0] }).then(function (r) {
    if (r && r.ok) { px = r.x; py = r.y; vx = 0; vy = 0; moveTarget = null; cam.x = px; cam.y = py; closeMap2(); toast('fast traveled — ' + best[1]); sndPortal(); }
    else map2Info('couldnt travel — ' + ((r && r.err) || 'on recharge'));
  });
}
(function () {
  var c = $('wmap2-cv'); if (!c) return;
  c.style.touchAction = 'none';
  c.addEventListener('pointerdown', function (ev) {
    mapPtrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    mapDrag = { x: ev.clientX, y: ev.clientY, moved: false, pinch: 0 };
    var ids = Object.keys(mapPtrs);
    if (ids.length === 2) { var a = mapPtrs[ids[0]], b = mapPtrs[ids[1]]; mapDrag.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    try { c.setPointerCapture(ev.pointerId); } catch (e) { }
  });
  c.addEventListener('pointermove', function (ev) {
    if (!mapDrag || !mapPtrs[ev.pointerId]) return;
    var prev = mapPtrs[ev.pointerId];
    mapPtrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var ids = Object.keys(mapPtrs);
    if (ids.length === 2 && mapDrag.pinch) {
      var a = mapPtrs[ids[0]], b = mapPtrs[ids[1]];
      var d2 = Math.hypot(a.x - b.x, a.y - b.y);
      if (d2 > 0) { MAPV.z = clamp(MAPV.z * (d2 / mapDrag.pinch), 1, 6); mapDrag.pinch = d2; }
      mapDrag.moved = true; drawMap2(); return;
    }
    var dx = ev.clientX - mapDrag.x, dy = ev.clientY - mapDrag.y;
    if (Math.abs(ev.clientX - mapDrag.x) + Math.abs(ev.clientY - mapDrag.y) > 2) { }
    var r = c.getBoundingClientRect();
    var s = Math.min(c.width / 6400, c.height / 4200) * MAPV.z;
    var wdx = (ev.clientX - prev.x) * (c.width / r.width) / s, wdy = (ev.clientY - prev.y) * (c.height / r.height) / s;
    if (Math.abs(wdx) + Math.abs(wdy) > 0.5) mapDrag.moved = true;
    MAPV.cx = clamp(MAPV.cx - wdx, -200, 6600); MAPV.cy = clamp(MAPV.cy - wdy, -200, 4400);
    drawMap2();
  });
  function ptrUp(ev) {
    delete mapPtrs[ev.pointerId];
    if (!mapDrag) return;
    var wasDrag = mapDrag.moved;
    if (Object.keys(mapPtrs).length === 0) mapDrag = null;
    if (!wasDrag) { var w = map2World(c, ev); map2Tap(w.x, w.y); }
  }
  c.addEventListener('pointerup', ptrUp);
  c.addEventListener('pointercancel', function (ev) { delete mapPtrs[ev.pointerId]; if (!Object.keys(mapPtrs).length) mapDrag = null; });
  c.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var before = map2World(c, ev);
    MAPV.z = clamp(MAPV.z * (ev.deltaY < 0 ? 1.16 : 0.86), 1, 6);
    var after = map2World(c, ev);
    MAPV.cx = clamp(MAPV.cx + (before.x - after.x), -200, 6600);
    MAPV.cy = clamp(MAPV.cy + (before.y - after.y), -200, 4400);
    drawMap2();
  }, { passive: false });
  var zin = $('wmap2-zin'), zout = $('wmap2-zout'), meb = $('wmap2-me');
  if (zin) zin.addEventListener('click', function () { MAPV.z = clamp(MAPV.z * 1.4, 1, 6); drawMap2(); });
  if (zout) zout.addEventListener('click', function () { MAPV.z = clamp(MAPV.z / 1.4, 1, 6); drawMap2(); });
  if (meb) meb.addEventListener('click', function () { MAPV.cx = clamp(px, 0, 6400); MAPV.cy = clamp(py, 0, 4200); MAPV.z = Math.max(MAPV.z, 2.2); drawMap2(); });
})();
$('wmap2-x').addEventListener('click', closeMap2);
$('wmap2').addEventListener('click', function (e) { if (e.target === $('wmap2')) closeMap2(); });
window.__map2 = { open: openMap2, close: closeMap2 };

/* ---------------- races (M7) ---------------- */
var RACE_V = null, RACE_EL = { el: 0, at: 0 };
function fmtRaceMs(ms) {
  ms = Math.max(0, Math.round(ms));
  var m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, mm = ms % 1000;
  return (m ? m + ':' + String(s).padStart(2, '0') : s) + '.' + String(mm).padStart(3, '0');
}
function openRace() { $('wrace').hidden = false; document.body.classList.add('wov'); renderRace(); }
function closeRace() { $('wrace').hidden = true; document.body.classList.remove('wov'); }
function renderRace() {
  var body = $('wrace-body'); if (!body) return;
  body.innerHTML = '<div class="jq-row">pulling the race board…</div>';
  fetch('/api/world/races', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { body.innerHTML = '<div class="jq-row">couldnt load races</div>'; return; }
    var h = '';
    if (r.active) h += '<div class="rc-card"><div class="rc-name">race in progress</div><div class="rc-sub">' + escH(r.active.course) + ' · checkpoint ' + r.active.idx + ' / ' + r.active.n + ' · ' + r.active.state + '</div><button class="rc-quit" id="wrace-quit" type="button">quit this race</button></div>';
    (r.courses || []).forEach(function (c) {
      h += '<div class="rc-card"><div class="rc-name">' + escH(c.name) + '</div><div class="rc-sub">' + c.n + ' checkpoints · start: ' + escH(c.startLabel) + ' · finish pays 40¢ (first 3 runs a day) · pb +15¢ · world record +50¢</div>'
        + '<div class="rc-row"><span>ur best</span><b>' + (c.pb ? fmtRaceMs(c.pb) : '—') + '</b></div>'
        + '<div class="rc-row"><span>world record</span><b>' + (c.rec ? fmtRaceMs(c.rec.ms) + ' · @' + escH(c.rec.u) : 'unset — go take it') + '</b></div>'
        + '<div class="rc-row"><span>ur best this week</span><b>' + (c.myWk ? fmtRaceMs(c.myWk) : '—') + '</b></div>';
      if (c.wkTop && c.wkTop.length) { h += '<div class="jq-sec">this week</div>'; c.wkTop.forEach(function (w, i) { h += '<div class="rc-wk">' + (i + 1) + '. @' + escH(w.u) + ' — ' + fmtRaceMs(w.ms) + '</div>'; }); }
      if (!r.active) h += '<button class="rc-start" data-rc="' + c.id + '" type="button">arm this race</button>';
      h += '</div>';
    });
    body.innerHTML = h;
    Array.prototype.forEach.call(body.querySelectorAll('[data-rc]'), function (b) {
      b.addEventListener('click', function () {
        jpost('/api/world/race-start', { course: b.getAttribute('data-rc') }).then(function (rr) {
          if (rr && rr.ok) { closeRace(); toast('race armed — cross the start ring to begin', 3600); sndPortal(); }
          else toast('couldnt arm the race', (rr && rr.err) || '');
        });
      });
    });
    var q = $('wrace-quit');
    if (q) q.addEventListener('click', function () { jpost('/api/world/race-quit', {}).then(function () { RACE_V = null; renderRace(); toast('race quit'); }); });
  }).catch(function () { body.innerHTML = '<div class="jq-row">couldnt load races</div>'; });
}
function drawRaceBeacon(g, now) {
  if (!RACE_V || !RACE_V.cp) return;
  var cp = RACE_V.cp, r = RACE_V.r || 90;
  var cpx = camPos();
  if (cp.x < cpx.x - 260 || cp.x > cpx.x + VW + 260 || cp.y < cpx.y - 260 || cp.y > cpx.y + VH + 260) {
    /* off-screen: edge arrow pointing the way */
    var ang = Math.atan2(cp.y - py, cp.x - px);
    var ex = px + Math.cos(ang) * 120, ey = py + Math.sin(ang) * 120;
    g.save(); g.translate(ex, ey); g.rotate(ang);
    g.fillStyle = 'rgba(255,210,87,.9)';
    g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -8); g.lineTo(-8, 8); g.closePath(); g.fill();
    g.restore();
  } else {
    var pulse = 1 + Math.sin(now / 260) * 0.07;
    var grad = g.createLinearGradient(0, cp.y - 210, 0, cp.y);
    grad.addColorStop(0, 'rgba(255,210,87,0)'); grad.addColorStop(1, 'rgba(255,210,87,.34)');
    g.fillStyle = grad; g.fillRect(cp.x - 7, cp.y - 210, 14, 210);
    g.strokeStyle = 'rgba(255,210,87,.92)'; g.lineWidth = 3;
    g.beginPath(); g.arc(cp.x, cp.y, r * pulse, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,210,87,.4)'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(cp.x, cp.y, r * 0.62 * pulse, 0, TAU); g.stroke();
    g.fillStyle = '#ffd257';
    star4(g, cp.x, cp.y - 218 + Math.sin(now / 300) * 5, 9, now / 800); g.fill();
    g.font = '800 13px Inter, sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(255,233,168,.97)';
    var lbl = RACE_V.state === 'armed' ? 'start — cross the ring' : 'checkpoint ' + RACE_V.idx + ' / ' + RACE_V.n;
    g.fillText(lbl, cp.x, cp.y - r - 14);
    g.font = '700 11px Inter, sans-serif'; g.fillStyle = 'rgba(255,233,168,.65)';
    g.fillText(Math.round(dist(px, py, cp.x, cp.y)) + 'u away', cp.x, cp.y - r - 30);
  }
  if (RACE_V.state === 'running') {
    var el = RACE_EL.el + (performance.now() - RACE_EL.at);
    var txt = RACE_V.name + ' · ' + fmtRaceMs(el) + ' · cp ' + RACE_V.idx + '/' + RACE_V.n;
    g.font = '800 13.5px Inter, sans-serif';
    var tw = g.measureText(txt).width + 26;
    var bx = clamp(px - tw / 2, camPos().x + 8, camPos().x + VW - tw - 8), by = camPos().y + 64;
    g.fillStyle = 'rgba(10,6,24,.72)';
    rr(g, bx, by, tw, 30, 99); g.fill();
    g.strokeStyle = 'rgba(255,210,87,.5)'; g.lineWidth = 1; rr(g, bx, by, tw, 30, 99); g.stroke();
    g.fillStyle = '#ffe9a8'; g.textAlign = 'center';
    g.fillText(txt, bx + tw / 2, by + 20);
  }
}
$('wrace-x').addEventListener('click', closeRace);
$('wrace').addEventListener('click', function (e) { if (e.target === $('wrace')) closeRace(); });
window.__race = { open: openRace, close: closeRace };
/* ---------------- guilds (M8) ---------------- */
var GUILD_MSGS = [], MY_GINV = [], GUILD_FORM = { color: 265, emblem: 'star' };
var GUILD_COLORS = [265, 210, 160, 120, 45, 20, 340, 0];
var EMBLEMS = {
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  moon: '<path d="M20 13.6A8.5 8.5 0 1 1 10.4 4 6.8 6.8 0 0 0 20 13.6z"/>',
  bolt: '<path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z"/>',
  wave: '<path d="M2 9c3-3.5 6-3.5 9 0s6 3.5 9 0"/><path d="M2 15c3-3.5 6-3.5 9 0s6 3.5 9 0"/>',
  gem: '<path d="M6.5 3.5h11L21 8.5 12 20.5 3 8.5z"/><path d="M3 8.5h18"/>',
  crown: '<path d="M3.5 8 8 12l4-6.5L16 12l4.5-4L19 18.5H5z"/>',
  leaf: '<path d="M5.5 18.5C5.5 10.5 12 4.5 19.5 4.5c0 7.5-5.5 14-13.5 14z"/><path d="M5.5 18.5c2.8-4.8 6.5-8.3 10.5-10"/>',
  ghost: '<path d="M12 3.5a7 7 0 0 0-7 7v10l3.3-2.4L12 20.5l3.7-2.4L19 20.5v-10a7 7 0 0 0-7-7z"/>'
};
function embSvg(id, sz) { return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (EMBLEMS[id] || EMBLEMS.star) + '</svg>'; }
function openGuild() { $('wguild').hidden = false; document.body.classList.add('wov'); renderGuild(); }
function closeGuild() { $('wguild').hidden = true; document.body.classList.remove('wov'); }
function renderGuildChat() {
  var box = $('gu-chat'); if (!box) return;
  box.innerHTML = GUILD_MSGS.map(function (m) { return '<div class="gu-msg"><b>@' + escH(m.from) + '</b> ' + escH(m.text) + '</div>'; }).join('') || '<div class="jq-row">no guild chatter yet — say hi</div>';
  box.scrollTop = box.scrollHeight;
}
function renderGuild() {
  var body = $('wguild-body'); if (!body) return;
  body.innerHTML = '<div class="jq-row">pulling the guild hall…</div>';
  fetch('/api/world/guild', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { body.innerHTML = '<div class="jq-row">couldnt load the guild hall</div>'; return; }
    var h = '';
    if (r.mine) {
      var g = r.mine;
      var nextXp = 120 * g.lvl * g.lvl;
      h += '<div class="gu-head"><div class="gu-emb" style="background:hsl(' + g.color + ',45%,26%);color:hsl(' + g.color + ',85%,72%)">' + embSvg(g.emblem, 26) + '</div><div><div class="gu-name">' + escH(g.name) + '</div><div class="gu-tag" style="color:hsl(' + g.color + ',85%,72%)">[' + escH(g.tag) + '] · guild lv ' + g.lvl + ' · ' + g.xp + ' xp' + (nextXp > g.xp ? ' (' + (nextXp - g.xp) + ' to lv ' + (g.lvl + 1) + ')' : '') + '</div></div></div>';
      h += '<div class="rc-sub" style="margin-top:8px">' + (g.open ? 'open — anyone can join from this panel' : 'invite-only') + ' · ur rank: ' + escH(g.myRank) + ' · the guild levels up whenever members earn xp</div>';
      h += '<div class="jq-sec">weekly guild challenge — ' + g.wk.score + ' pts</div>';
      h += '<div class="rc-sub">races ' + g.wk.race + ' · crypt clears ' + g.wk.crypt + ' · lich kills ' + g.wk.boss + ' — every point is a guildmate finishing one this week</div>';
      g.wk.milestones.forEach(function (m) {
        h += '<div class="rc-row"><span>' + m.at + ' pts</span>' + (m.claimed ? '<b>claimed ✓</b>' : (m.hit ? '<button class="gu-act" data-claim="' + m.at + '" type="button">claim 25¢</button>' : '<span>locked</span>')) + '</div>';
      });
      h += '<div class="jq-sec">members (' + g.members.length + ' / 30)</div>';
      g.members.forEach(function (m) {
        h += '<div class="gu-mem"><span class="gu-dot" style="background:' + (m.online ? '#4ade80' : 'rgba(255,255,255,.25)') + '"></span>@' + escH(m.u) + '<span class="gu-rank">' + escH(m.rank) + '</span>';
        if (m.u !== me && g.myRank === 'owner') {
          h += '<button class="gu-act" data-rank="' + (m.rank === 'officer' ? 'member' : 'officer') + '" data-u="' + escH(m.u) + '" type="button">' + (m.rank === 'officer' ? 'demote' : 'promote') + '</button>'
            + '<button class="gu-act" data-transfer="' + escH(m.u) + '" type="button">give guild</button>'
            + '<button class="gu-act" data-kick="' + escH(m.u) + '" type="button">kick</button>';
        } else if (m.u !== me && g.myRank === 'officer' && m.rank === 'member') {
          h += '<button class="gu-act" data-kick="' + escH(m.u) + '" type="button">kick</button>';
        }
        h += '</div>';
      });
      if (g.myRank === 'owner' || g.myRank === 'officer') h += '<div style="display:flex;gap:7px;margin-top:11px"><input id="gu-inv-u" class="gu-inp" placeholder="invite by @username (must be online)" maxlength="16"><button class="gu-act" id="gu-inv-b" type="button" style="flex:none;padding:0 14px">invite</button></div>';
      h += '<div class="jq-sec">guild chat</div><div class="gu-chat" id="gu-chat"></div><div style="display:flex;gap:7px;margin-top:8px"><input id="gu-chat-in" class="gu-inp" placeholder="talk to ur guild…" maxlength="200"><button class="gu-act" id="gu-chat-b" type="button" style="flex:none;padding:0 14px">send</button></div>';
      h += '<div style="display:flex;gap:7px;margin-top:13px;flex-wrap:wrap">'
        + (g.myRank === 'owner' ? '<button class="gu-act" id="gu-open-b" type="button" data-open="' + (g.open ? '1' : '0') + '">' + (g.open ? 'make invite-only' : 'make open') + '</button><button class="gu-act" id="gu-disband-b" type="button">disband guild</button>' : '')
        + '<button class="gu-act" id="gu-leave-b" type="button">leave guild</button></div>';
    } else {
      if (r.invites && r.invites.length) {
        h += '<div class="jq-sec">guild invites</div>';
        r.invites.forEach(function (v) { h += '<div class="rc-row"><span><b style="color:#ffd257">[' + escH(v.tag) + ']</b> ' + escH(v.name) + ' · from @' + escH(v.from) + '</span><span><button class="gu-act" data-ans="1" data-gid="' + v.gid + '" type="button">join</button> <button class="gu-act" data-ans="0" data-gid="' + v.gid + '" type="button">pass</button></span></div>'; });
      }
      h += '<div class="jq-sec">found a guild — 500¢ charter</div>'
        + '<input id="gu-name" class="gu-inp" placeholder="guild name (3-16 chars)" maxlength="16" style="margin-top:4px">'
        + '<input id="gu-tag" class="gu-inp" placeholder="TAG (2-4)" maxlength="4" style="margin-top:7px;text-transform:uppercase">'
        + '<div class="rc-sub" style="margin-top:10px">color</div><div class="gu-sw">' + GUILD_COLORS.map(function (c) { return '<button class="gu-swatch' + (GUILD_FORM.color === c ? ' sel' : '') + '" data-col="' + c + '" type="button" style="background:hsl(' + c + ',65%,55%)" aria-label="color"></button>'; }).join('') + '</div>'
        + '<div class="rc-sub" style="margin-top:10px">emblem</div><div class="gu-sw">' + Object.keys(EMBLEMS).map(function (e) { return '<button class="gu-emb-b' + (GUILD_FORM.emblem === e ? ' sel' : '') + '" data-emb="' + e + '" type="button">' + embSvg(e, 20) + '</button>'; }).join('') + '</div>'
        + '<label class="rc-sub" style="display:flex;gap:7px;align-items:center;margin-top:11px"><input type="checkbox" id="gu-open-new"> open — anyone can join (off = invite-only)</label>'
        + '<button class="rc-start" id="gu-create-b" type="button">found it · 500¢</button>';
      h += '<div class="jq-sec">browse guilds</div>';
      if (r.list && r.list.length) r.list.forEach(function (g2) {
        h += '<div class="gu-mem"><div class="gu-emb" style="width:34px;height:34px;border-radius:10px;background:hsl(' + g2.color + ',45%,26%);color:hsl(' + g2.color + ',85%,72%)">' + embSvg(g2.emblem, 19) + '</div><span>' + escH(g2.name) + ' <span class="gu-tag" style="color:hsl(' + g2.color + ',85%,72%)">[' + escH(g2.tag) + ']</span></span><span class="gu-rank">lv ' + g2.lvl + ' · ' + g2.n + ' members</span>' + (g2.open ? '<button class="gu-act" data-join="' + g2.gid + '" type="button">join</button>' : '<span class="gu-rank">invite-only</span>') + '</div>';
      });
      else h += '<div class="jq-row">no guilds yet — found the first one</div>';
    }
    body.innerHTML = h;
    renderGuildChat();
    function wire(sel, fn) { Array.prototype.forEach.call(body.querySelectorAll(sel), function (b) { b.addEventListener('click', function () { fn(b); }); }); }
    function post(path, data, okMsg) { jpost(path, data).then(function (rr) { if (rr && rr.ok) { if (okMsg) toast(okMsg); renderGuild(); } else toast('nope', (rr && rr.err) || ''); }); }
    wire('[data-claim]', function (b) { post('/api/world/guild-claim', { ms: Number(b.getAttribute('data-claim')) }, 'milestone claimed · +25¢'); });
    wire('[data-kick]', function (b) { post('/api/world/guild-kick', { u: b.getAttribute('data-kick') }, 'kicked'); });
    wire('[data-rank]', function (b) { post('/api/world/guild-rank', { u: b.getAttribute('data-u'), rank: b.getAttribute('data-rank') }, 'rank updated'); });
    wire('[data-transfer]', function (b) { post('/api/world/guild-transfer', { u: b.getAttribute('data-transfer') }, 'guild handed over'); });
    wire('[data-join]', function (b) { post('/api/world/guild-join', { gid: b.getAttribute('data-join') }, 'welcome to the guild'); });
    wire('[data-ans]', function (b) { post('/api/world/guild-answer', { gid: b.getAttribute('data-gid'), yes: b.getAttribute('data-ans') === '1' }, b.getAttribute('data-ans') === '1' ? 'welcome to the guild' : 'invite passed'); });
    wire('[data-col]', function (b) { GUILD_FORM.color = Number(b.getAttribute('data-col')); Array.prototype.forEach.call(body.querySelectorAll('[data-col]'), function (x) { x.classList.toggle('sel', x === b); }); });
    wire('[data-emb]', function (b) { GUILD_FORM.emblem = b.getAttribute('data-emb'); Array.prototype.forEach.call(body.querySelectorAll('[data-emb]'), function (x) { x.classList.toggle('sel', x === b); }); });
    var cb = $('gu-create-b');
    if (cb) cb.addEventListener('click', function () { post('/api/world/guild-create', { name: $('gu-name').value, tag: $('gu-tag').value, color: GUILD_FORM.color, emblem: GUILD_FORM.emblem, open: $('gu-open-new').checked }, 'guild founded'); });
    var ib = $('gu-inv-b');
    if (ib) ib.addEventListener('click', function () { var v = $('gu-inv-u').value.replace(/^@/, '').trim().toLowerCase(); if (v) post('/api/world/guild-invite', { to: v }, 'invite sent'); });
    var sb = $('gu-chat-b');
    if (sb) sb.addEventListener('click', function () {
      var inp = $('gu-chat-in'); var v = inp.value.trim(); if (!v) return;
      jpost('/api/world/guild-say', { text: v }).then(function (rr) { if (rr && rr.ok) { GUILD_MSGS.push({ from: me, text: v }); if (GUILD_MSGS.length > 40) GUILD_MSGS.shift(); inp.value = ''; renderGuildChat(); } else toast('couldnt send', (rr && rr.err) || ''); });
    });
    var ob = $('gu-open-b');
    if (ob) ob.addEventListener('click', function () { post('/api/world/guild-open', { open: ob.getAttribute('data-open') !== '1' }, 'join policy updated'); });
    var lb = $('gu-leave-b');
    if (lb) lb.addEventListener('click', function () { post('/api/world/guild-leave', {}, 'left the guild'); });
    var db = $('gu-disband-b');
    if (db) db.addEventListener('click', function () { post('/api/world/guild-disband', {}, 'guild disbanded'); });
  }).catch(function () { body.innerHTML = '<div class="jq-row">couldnt load the guild hall</div>'; });
}
$('wguild-x').addEventListener('click', closeGuild);
/* ---- M9: trading + crafting ---- */
var MAT_DEFS = { dust: { name: 'stardust', c: '#fde68a' }, chip: { name: 'crystal chip', c: '#67e8f9' }, cloth: { name: 'gloom cloth', c: '#a78bfa' }, scale: { name: 'fish scale', c: '#6ee7b7' }, essence: { name: 'lich essence', c: '#f0abfc' } };
var TRADE_V = null, tradeInvFrom = '', tradeWasNull = true;
function openTrade() { $('wtrade').hidden = false; document.body.classList.add('wov'); renderTrade(); }
function closeTrade() { $('wtrade').hidden = true; document.body.classList.remove('wov'); }
function tradeSet(items, cents) { jpost('/api/world/trade', { act: 'set', items: items, cents: cents }).then(function (r) { if (r && !r.ok) toast('nope', r.err || ''); }); }
function renderTrade() {
  var body = $('wtrade-body'); if (!body) return;
  var t = TRADE_V;
  if (!t) { body.innerHTML = '<div class="tr-status">no trade going. tap someone\u2019s name in the world and hit <b>trade</b> on their profile \u2014 items and six cents swap atomically once both sides lock in and confirm. nothing is held or moved before that.</div>'; return; }
  var chip = function (it, mine) { return '<span class="tr-chip"><i style="width:8px;height:8px;border-radius:50%;background:' + it.c + ';display:inline-block"></i>' + escH(it.name) + (mine ? '<button type="button" data-rm="' + it.id + '">\u00d7</button>' : '') + '</span>'; };
  var myIds = t.mine.items.map(function (i) { return i.id; });
  var picker = myInv.filter(function (id) { return myIds.indexOf(id) < 0 && WBY[id]; }).map(function (id) { var it = WBY[id]; return '<option value="' + id + '">' + escH(it.name) + ' (' + it.cat + ')</option>'; }).join('');
  body.innerHTML = '<div class="tr-status" style="margin:0 0 10px">trading with <b>@' + escH(t.with) + '</b> \u2014 nothing moves until both sides lock in <b>and</b> confirm. changing an offer unlocks both sides.</div>'
    + '<div class="tr-cols"><div class="tr-side"><h4>ur offer' + (t.myLock ? ' \u00b7 locked' : '') + (t.myConf ? ' \u00b7 confirmed' : '') + '</h4><div class="tr-chips">' + (t.mine.items.map(function (i) { return chip(i, true); }).join('') || '<span class="tr-status">nothing yet</span>') + '</div><div class="tr-cents">\u00a2 ' + t.mine.cents + '</div>'
    + '<div class="tr-row"><select id="tr-pick"><option value="">add an item\u2026</option>' + picker + '</select></div>'
    + '<div class="tr-row"><input id="tr-cents" type="number" min="0" step="1" placeholder="six cents" value="' + (t.mine.cents || '') + '"><button class="tr-btn" id="tr-set-c" type="button">set \u00a2</button></div></div>'
    + '<div class="tr-side"><h4>@' + escH(t.with) + (t.theirLock ? ' \u00b7 locked' : '') + (t.theirConf ? ' \u00b7 confirmed' : '') + '</h4><div class="tr-chips">' + (t.theirs.items.map(function (i) { return chip(i, false); }).join('') || '<span class="tr-status">nothing yet</span>') + '</div><div class="tr-cents">\u00a2 ' + t.theirs.cents + '</div></div></div>'
    + '<div class="tr-row"><button class="tr-btn' + (t.myLock ? ' on' : '') + '" id="tr-lock" type="button">' + (t.myLock ? 'locked in \u2014 tap to unlock' : 'lock in') + '</button>'
    + '<button class="tr-btn go" id="tr-conf" type="button"' + ((t.myLock && t.theirLock && !t.myConf) ? '' : ' disabled') + '>' + (t.myConf ? 'confirmed \u2014 waiting on them' : 'confirm trade') + '</button>'
    + '<button class="tr-btn" id="tr-cancel" type="button">cancel trade</button></div>'
    + '<div class="tr-status">' + (t.myConf && !t.theirConf ? 'u confirmed \u2014 waiting on @' + escH(t.with) + ' to confirm.' : (t.theirConf && !t.myConf ? '@' + escH(t.with) + ' confirmed \u2014 ur turn once u lock in.' : 'offers update live. the swap re-checks ownership + balances at confirm time, so nobody can yank stuff mid-trade.')) + '</div>';
  body.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', function () { var ids = TRADE_V.mine.items.map(function (i) { return i.id; }).filter(function (id) { return id !== b.getAttribute('data-rm'); }); tradeSet(ids, TRADE_V.mine.cents); }); });
  var pick = $('tr-pick');
  if (pick) pick.addEventListener('change', function () { if (!pick.value) return; var ids = TRADE_V.mine.items.map(function (i) { return i.id; }); ids.push(pick.value); tradeSet(ids, TRADE_V.mine.cents); });
  var sc = $('tr-set-c');
  if (sc) sc.addEventListener('click', function () { var v = Math.max(0, Math.floor(Number(($('tr-cents') || {}).value) || 0)); tradeSet(TRADE_V.mine.items.map(function (i) { return i.id; }), v); });
  var lk = $('tr-lock');
  if (lk) lk.addEventListener('click', function () { jpost('/api/world/trade', { act: 'lock', locked: !TRADE_V.myLock }).then(function (r) { if (r && !r.ok) toast('nope', r.err || ''); }); });
  var cf = $('tr-conf');
  if (cf) cf.addEventListener('click', function () { jpost('/api/world/trade', { act: 'confirm' }).then(function (r) { if (r && !r.ok) toast('nope', r.err || ''); }); });
  var cx = $('tr-cancel');
  if (cx) cx.addEventListener('click', function () { jpost('/api/world/trade', { act: 'cancel' }).then(function () { closeTrade(); }); });
}
function openCraft() { $('wcraft').hidden = false; document.body.classList.add('wov'); renderCraft(); }
function closeCraft() { $('wcraft').hidden = true; document.body.classList.remove('wov'); }
function renderCraft() {
  var body = $('wcraft-body'); if (!body) return;
  body.innerHTML = '<div class="tr-status">loading\u2026</div>';
  fetch('/api/world/craft', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { body.innerHTML = '<div class="tr-status">couldnt load crafting</div>'; return; }
    var mats = Object.keys(MAT_DEFS).map(function (k) { var d = MAT_DEFS[k]; return '<span class="cr-mat"><i style="background:' + d.c + '"></i>' + d.name + ' \u00d7 ' + (r.mats[k] || 0) + '</span>'; }).join('');
    var cards = r.recipes.map(function (rc) {
      var can = rc.needs.every(function (n) { return n.have >= n.n; }) && !rc.owned;
      return '<div class="cr-card"><span class="cr-dot" style="background:' + rc.c + '22"><i style="width:10px;height:10px;border-radius:50%;background:' + rc.c + ';display:block"></i></span><div class="cr-info"><div class="cr-name">' + escH(rc.name) + ' <span style="color:rgba(243,239,255,.45);font-size:11px">' + rc.cat + ' \u00b7 ' + rc.rarity + '</span></div><div class="cr-needs">' + rc.needs.map(function (n) { return '<span style="color:' + (n.have >= n.n ? '#6ee7b7' : '#fca5a5') + '">' + n.name + ' ' + n.have + '/' + n.n + '</span>'; }).join(' \u00b7 ') + '</div></div>'
        + (rc.owned ? '<span class="tr-status">owned</span>' : '<button class="tr-btn go" data-craft="' + rc.id + '" type="button"' + (can && r.nearStation ? '' : ' disabled') + '>craft</button>') + '</div>';
    }).join('');
    body.innerHTML = '<div class="cr-mats">' + mats + '</div>' + (r.nearStation ? '' : '<div class="tr-status" style="margin-bottom:10px">crafting happens at the workbench by the six cents shop tent \u2014 head there to make stuff.</div>') + cards + '<div class="tr-status">materials: stardust drops off moon shards \u00b7 crystal chips off the 16 crystals \u00b7 gloom cloth off crypt shades \u00b7 fish scales off catches \u00b7 lich essence off lich kills (5+ hits).</div>';
    body.querySelectorAll('[data-craft]').forEach(function (b) { b.addEventListener('click', function () { jpost('/api/world/craft', { id: b.getAttribute('data-craft') }).then(function (rr) { if (rr && rr.ok) { toast('\u2726 crafted ' + rr.made, 4200); sndQuest(); renderCraft(); } else toast('nope', (rr && rr.err) || ''); }); }); });
  });
}
$('wtrade-x').addEventListener('click', closeTrade);
$('wcraft-x').addEventListener('click', closeCraft);
window.__trade = { open: openTrade, close: closeTrade };
window.__craft = { open: openCraft, close: closeCraft };
/* ---- M10: skills + photo mode ---- */
function openSkills() { $('wskills').hidden = false; document.body.classList.add('wov'); renderSkills(); }
function closeSkills() { $('wskills').hidden = true; document.body.classList.remove('wov'); }
function renderSkills() {
  var body = $('wskills-body'); if (!body) return;
  body.innerHTML = '<div class="tr-status">loading\u2026</div>';
  fetch('/api/world/skills', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { body.innerHTML = '<div class="tr-status">couldnt load skills</div>'; return; }
    if (r.paidNow > 0) toast('\u2726 skill milestones paid +\u00a2' + r.paidNow, 3600);
    body.innerHTML = r.skills.map(function (s) {
      var pct = s.lvl >= 10 ? 100 : Math.max(2, Math.round(100 * s.count / s.nextAt));
      return '<div class="sk-row"><span class="sk-dot" style="background:' + s.c + '22"><i style="background:' + s.c + '"></i></span><div class="sk-info"><div class="sk-name">' + escH(s.name) + ' <span class="sk-lvl">lv ' + s.lvl + '</span> <span class="sk-title">' + s.title + '</span></div><div class="sk-bar"><i style="width:' + pct + '%;background:' + s.c + '"></i></div><div class="sk-sub">' + (s.lvl >= 10 ? 'maxed \u2014 legend status' : s.count + ' / ' + s.nextAt + ' to lv ' + (s.lvl + 1)) + '</div></div></div>';
    }).join('') + '<div class="tr-status">skills level from just playing \u2014 fishing, crypt + lich kills, races, exploring, gathering, crafting + trading. lv 2/4/6/8/10 pay out six cents automatically.</div>';
  });
}
$('wskills-x').addEventListener('click', closeSkills);
window.__skills = { open: openSkills, close: closeSkills };
var PHOTO_FRAME = 'star';
function photoList() { try { return JSON.parse(localStorage.getItem('wphotos') || '[]'); } catch (e) { return []; } }
function openPhoto() { document.body.classList.add('wphoto'); $('wphoto').hidden = false; renderPhotoGal(); }
function closePhoto() { document.body.classList.remove('wphoto'); $('wphoto').hidden = true; }
function renderPhotoGal() {
  var gal = $('wphoto-gal'); if (!gal) return;
  var list = photoList();
  gal.innerHTML = list.map(function (p, i) { return '<img data-ph="' + i + '" src="' + p.img + '" alt="snap">'; }).join('') || '<span class="wphoto-none">no snaps yet \u2014 hit SNAP</span>';
  gal.querySelectorAll('[data-ph]').forEach(function (im) { im.addEventListener('click', function () { var p = photoList()[+im.getAttribute('data-ph')]; if (p) { var a = document.createElement('a'); a.href = p.img; a.download = 'six-network-snap.jpg'; a.click(); } }); });
}
function snapPhoto() {
  var src = $('wcv'); if (!src || !src.width) return;
  var out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
  var g = out.getContext('2d');
  g.drawImage(src, 0, 0);
  var W = out.width, H = out.height;
  var cap = "six's network \u2726 @" + me + ' \u00b7 ' + new Date().toLocaleDateString();
  if (PHOTO_FRAME === 'star') {
    g.strokeStyle = 'rgba(255,210,87,.9)'; g.lineWidth = Math.max(3, W * 0.006);
    g.strokeRect(g.lineWidth, g.lineWidth, W - g.lineWidth * 2, H - g.lineWidth * 2);
    g.fillStyle = '#ffd257';
    [[26, 26], [W - 26, 26], [26, H - 26], [W - 26, H - 26]].forEach(function (cc) { star4(g, cc[0], cc[1], 13, 0.6); g.fill(); });
    g.fillStyle = 'rgba(5,3,14,.72)'; g.fillRect(0, H - 44, W, 44);
    g.fillStyle = '#f3efff'; g.font = '600 17px Inter, sans-serif'; g.textAlign = 'center';
    g.fillText(cap, W / 2, H - 17);
  } else if (PHOTO_FRAME === 'polaroid') {
    g.fillStyle = '#fdfdf8';
    g.fillRect(0, 0, W, 18); g.fillRect(0, H - 74, W, 74); g.fillRect(0, 0, 18, H); g.fillRect(W - 18, 0, 18, H);
    g.fillStyle = '#241a38'; g.font = '600 19px Inter, sans-serif'; g.textAlign = 'center';
    g.fillText(cap, W / 2, H - 30);
  } else if (PHOTO_FRAME === 'film') {
    g.fillStyle = '#0a0a0f'; g.fillRect(0, 0, W, 34); g.fillRect(0, H - 34, W, 34);
    g.fillStyle = 'rgba(255,255,255,.75)';
    for (var fx2 = 14; fx2 < W - 10; fx2 += 30) { g.fillRect(fx2, 11, 15, 12); g.fillRect(fx2, H - 23, 15, 12); }
  }
  out.toBlob(function (b) {
    if (b) { var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = 'six-network.png'; a.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
    var th = document.createElement('canvas'); var sc = 480 / W; th.width = 480; th.height = Math.max(1, Math.round(H * sc));
    th.getContext('2d').drawImage(out, 0, 0, th.width, th.height);
    var list = photoList(); list.unshift({ at: Date.now(), img: th.toDataURL('image/jpeg', 0.72) });
    try { localStorage.setItem('wphotos', JSON.stringify(list.slice(0, 10))); } catch (e) {}
    renderPhotoGal();
    toast('\u2726 snap saved \u2014 full shot downloaded + a copy in the gallery', 3200);
  });
}
$('wphoto-shut').addEventListener('click', snapPhoto);
$('wphoto-x').addEventListener('click', closePhoto);
$('wphoto-frames').addEventListener('click', function (e) { var b = e.target.closest('[data-frame]'); if (!b) return; PHOTO_FRAME = b.getAttribute('data-frame'); Array.prototype.forEach.call($('wphoto-frames').children, function (x) { x.classList.toggle('on', x === b); }); });
window.__photo = { open: openPhoto, close: closePhoto, snap: snapPhoto };
$('wguild').addEventListener('click', function (e) { if (e.target === $('wguild')) closeGuild(); });
window.__guild = { open: openGuild, close: closeGuild };
/* settings */
function openSettings() {
  $('wset-vol').value = Math.round(SET.vol * 100);
  $('wset-music').checked = !!SET.music;
  $('wset-sfx').checked = !!SET.sfx;
  $('wsettings').hidden = false;
  document.body.classList.add('wov');
}
function closeSettings() { $('wsettings').hidden = true; document.body.classList.remove('wov'); }
$('wset-vol').addEventListener('input', function () { SET.vol = Number($('wset-vol').value) / 100; saveSet(); });
$('wset-music').addEventListener('change', function () { SET.music = $('wset-music').checked; saveSet(); });
$('wset-sfx').addEventListener('change', function () { SET.sfx = $('wset-sfx').checked; saveSet(); if (SET.sfx) sndPop(); });
$('wsettings-x').addEventListener('click', closeSettings);
$('wsettings').addEventListener('click', function (e) { if (e.target === $('wsettings')) closeSettings(); });
window.__settings = { open: openSettings, close: closeSettings };
/* admin */
function openAdmin() {
  $('wadmin').hidden = false;
  document.body.classList.add('wov');
  $('wadmin-body').innerHTML = '<div class="jq-row">pulling the world ledger\u2026</div>';
  fetch('/api/world/admin', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { $('wadmin-body').innerHTML = '<div class="jq-row">admins only</div>'; return; }
    var h = '<div class="bd-row"><span class="bd-name">online rn</span><span class="bd-val">' + r.online + '</span></div>' +
      '<div class="bd-row"><span class="bd-name">world accounts</span><span class="bd-val">' + r.players + '</span></div>' +
      '<div class="bd-row"><span class="bd-name">six cents in circulation</span><span class="bd-val">\u00a2' + r.centsInCirc + '</span></div>' +
      '<div class="bd-row"><span class="bd-name">active parties</span><span class="bd-val">' + r.parties + '</span></div>' +
      '<div class="bd-row"><span class="bd-name">weather</span><span class="bd-val">' + escH(r.weather || 'clear') + '</span></div>' +
      '<div class="bd-row"><span class="bd-name">event</span><span class="bd-val">' + (r.event ? escH(r.event.type) : 'none') + '</span></div>';
    h += '<div class="jq-sec">player reports</div>';
    if (r.reports && r.reports.length) r.reports.forEach(function (rp) { h += '<div class="bd-row"><span class="bd-name">@' + escH(rp.user) + ' \u2014 ' + escH(rp.why || '') + '</span><span class="bd-val">by @' + escH(rp.by) + '</span></div>'; });
    else h += '<div class="jq-row">no reports</div>';
    h += '<div class="jq-sec">recent six cents</div>';
    (r.recentTx || []).forEach(function (t) { h += '<div class="bd-row"><span class="bd-name">@' + escH(t.u) + ' \u00b7 ' + escH(t.kind) + (t.what ? ' \u00b7 ' + escH(t.what) : '') + '</span><span class="bd-val">' + (t.amt > 0 ? '+' : '') + '\u00a2' + t.amt + '</span></div>'; });
    $('wadmin-body').innerHTML = h;
  }).catch(function () { $('wadmin-body').innerHTML = '<div class="jq-row">couldnt load admin</div>'; });
}
function closeAdmin() { $('wadmin').hidden = true; document.body.classList.remove('wov'); }
$('wadminbtn').addEventListener('click', openAdmin);
$('wadmin-x').addEventListener('click', closeAdmin);
$('wadmin').addEventListener('click', function (e) { if (e.target === $('wadmin')) closeAdmin(); });
$('wadmin-send').addEventListener('click', function () {
  var text = $('wadmin-ann').value.trim();
  if (!text) return;
  jpost('/api/world/admin', { act: 'announce', text: text }).then(function (r) { if (r && r.ok) { $('wadmin-ann').value = ''; toast('announced to the world'); } else toast('announce failed', (r && r.err) || ''); });
});
Array.prototype.forEach.call(document.querySelectorAll('.wadmin-ev'), function (b) {
  b.addEventListener('click', function () { jpost('/api/world/admin', { act: 'event', type: b.getAttribute('data-ev') }).then(function (r) { toast(r && r.ok ? 'event set: ' + b.getAttribute('data-ev') : 'event failed', (r && r.err) || ''); openAdmin(); }); });
});

/* ================= housing ================= */
var HOUSE_PLOTS = [430, 590, 750, 910, 1070, 1230];
var HOUSE_STYLE_C = {
  cottage: { wall: '#4a3a63', trim: '#6d5a94', floor: '#2c2340', floor2: '#332a4a' },
  loft: { wall: '#5b2a86', trim: '#8b4fc4', floor: '#241a3d', floor2: '#2b2049' },
  den: { wall: '#123a4d', trim: '#1f6f8f', floor: '#0e2432', floor2: '#12303f' },
  castle: { wall: '#3d3d55', trim: '#5d5d7a', floor: '#23232f', floor2: '#2a2a38' },
};
var myHouse = null, HOUSE_VIEW = null, decorOn = false, placeFid = null, placeRot = 0, ghostCell = null;
function nearHousePlot() { for (var i = 0; i < HOUSE_PLOTS.length; i++) if (dist(px, py, HOUSE_PLOTS[i], 3140) < 58) return true; return false; }
function loadHouse(owner) {
  fetch('/api/world/house?u=' + encodeURIComponent(owner), { headers: { 'accept': 'application/json' } }).then(function (r) { return r.json(); }).then(function (v) {
    if (v && v.ok && myHouse === owner) { HOUSE_VIEW = v; if (!$('whouse').hidden) renderHousePanel(); }
  }).catch(function () { });
}
function enterHouse(owner) {
  jpost('/api/world/house-enter', { u: owner }).then(function (r) {
    if (!r || !r.ok) { toast((r && r.err) || 'that house said no'); return; }
    px = r.x; py = r.y; vx = 0; vy = 0; moveTarget = null; cam.x = px; cam.y = py;
    sndPortal(); burst(px, py, '#ffd257', 16, 110);
  });
}
function exitHouse() {
  jpost('/api/world/house-exit', {}).then(function (r) {
    if (!r || !r.ok) { toast((r && r.err) || 'stuck'); return; }
    px = r.x; py = r.y; vx = 0; vy = 0; moveTarget = null; cam.x = px; cam.y = py;
    decorOn = false; placeFid = null;
    sndPortal();
  });
}
function drawFurnShape(g2, fid, s, now) {
  var u = s / 40;
  g2.save(); g2.scale(u, u);
  switch (fid) {
    case 'rug': g2.fillStyle = '#3d2f63'; rr(g2, -19, -19, 38, 38, 9); g2.fill(); g2.strokeStyle = '#ffd257'; g2.lineWidth = 1.6; g2.beginPath(); g2.arc(0, 0, 10, 0, TAU); g2.stroke(); break;
    case 'couch': g2.fillStyle = '#5d4a9e'; rr(g2, -19, -12, 38, 24, 8); g2.fill(); g2.fillStyle = '#6f5bb5'; rr(g2, -19, -17, 38, 10, 7); g2.fill(); break;
    case 'table': g2.fillStyle = '#7a5a36'; rr(g2, -16, -11, 32, 22, 4); g2.fill(); g2.fillStyle = '#96703f'; rr(g2, -13, -8, 26, 16, 3); g2.fill(); break;
    case 'chair': g2.fillStyle = '#8a6a42'; rr(g2, -10, -6, 20, 15, 4); g2.fill(); rr(g2, -10, -15, 20, 8, 4); g2.fill(); break;
    case 'lamp': { var lg = g2.createRadialGradient(0, 0, 2, 0, 0, 30); lg.addColorStop(0, 'rgba(255,220,130,.5)'); lg.addColorStop(1, 'rgba(255,220,130,0)'); g2.fillStyle = lg; g2.beginPath(); g2.arc(0, 0, 30, 0, TAU); g2.fill(); g2.fillStyle = '#ffd257'; star4(g2, 0, 0, 9, now / 900); g2.fill(); break; }
    case 'shelf': g2.fillStyle = '#4e3a26'; rr(g2, -17, -18, 34, 36, 3); g2.fill(); g2.fillStyle = '#e8b4b8'; g2.fillRect(-13, -13, 5, 10); g2.fillStyle = '#a8d8ea'; g2.fillRect(-6, -13, 5, 10); g2.fillStyle = '#ffd257'; g2.fillRect(1, -13, 5, 10); g2.fillStyle = '#b8e6b0'; g2.fillRect(-10, 2, 5, 10); g2.fillStyle = '#f3efff'; g2.fillRect(-3, 2, 5, 10); break;
    case 'bed': g2.fillStyle = '#31456e'; rr(g2, -14, -19, 28, 38, 5); g2.fill(); g2.fillStyle = '#f3efff'; rr(g2, -11, -17, 22, 9, 4); g2.fill(); g2.fillStyle = '#8b7cff'; rr(g2, -13, -6, 26, 22, 4); g2.fill(); break;
    case 'plant': g2.fillStyle = '#8a5a36'; rr(g2, -8, 4, 16, 12, 3); g2.fill(); g2.strokeStyle = '#57c785'; g2.lineWidth = 3; for (var pa = -1; pa <= 1; pa++) { g2.beginPath(); g2.moveTo(0, 5); g2.quadraticCurveTo(pa * 9, -6, pa * 13, -13 + Math.abs(pa) * 4); g2.stroke(); } break;
    case 'tv': g2.fillStyle = '#14101f'; rr(g2, -18, -13, 36, 26, 4); g2.fill(); g2.fillStyle = '#67e8f9'; g2.globalAlpha = .55 + Math.sin(now / 300) * .12; rr(g2, -14, -9, 28, 18, 2); g2.fill(); g2.globalAlpha = 1; break;
    case 'tank': g2.fillStyle = 'rgba(103,232,249,.20)'; rr(g2, -18, -13, 36, 26, 4); g2.fill(); g2.strokeStyle = 'rgba(160,240,255,.6)'; g2.lineWidth = 1.6; g2.stroke(); g2.fillStyle = '#ffb86b'; g2.beginPath(); g2.ellipse(-5 + Math.sin(now / 700) * 4, 0, 5, 3, 0, 0, TAU); g2.fill(); g2.fillStyle = '#f472b6'; g2.beginPath(); g2.ellipse(7 - Math.sin(now / 800) * 4, 4, 4, 2.4, 0, 0, TAU); g2.fill(); break;
    case 'trophy': g2.fillStyle = '#4e3a26'; rr(g2, -17, -14, 34, 28, 3); g2.fill(); g2.fillStyle = '#ffd257'; star4(g2, -7, -3, 7, 0); g2.fill(); star4(g2, 8, 4, 5.5, 0); g2.fill(); break;
    case 'window': g2.fillStyle = '#1b1440'; rr(g2, -15, -18, 30, 36, 3); g2.fill(); g2.strokeStyle = '#8b7cff'; g2.lineWidth = 2; g2.stroke(); g2.fillStyle = '#fff'; g2.fillRect(-8, -10, 2, 2); g2.fillRect(5, -4, 2, 2); g2.fillRect(-2, 6, 2, 2); g2.fillStyle = '#f3efff'; g2.beginPath(); g2.arc(7, -9, 4.5, 0, TAU); g2.fill(); break;
    case 'paint': g2.fillStyle = '#c9a86a'; rr(g2, -14, -17, 28, 34, 2); g2.fill(); g2.fillStyle = '#241a45'; rr(g2, -11, -14, 22, 28, 2); g2.fill(); g2.fillStyle = '#f5eeda'; g2.beginPath(); g2.arc(2, -4, 6, 0, TAU); g2.fill(); g2.fillStyle = '#241a45'; g2.beginPath(); g2.arc(5, -5, 5.4, 0, TAU); g2.fill(); break;
    case 'plush': g2.fillStyle = '#8b7cff'; g2.beginPath(); g2.arc(0, 1, 11, 0, TAU); g2.fill(); g2.beginPath(); g2.arc(-8, -9, 4.5, 0, TAU); g2.arc(8, -9, 4.5, 0, TAU); g2.fill(); g2.fillStyle = '#fff'; g2.fillRect(-5, -1, 2.4, 2.4); g2.fillRect(3, -1, 2.4, 2.4); break;
    case 'candle': g2.fillStyle = '#e8dcc3'; g2.fillRect(-9, 0, 4, 10); g2.fillRect(5, 0, 4, 10); g2.fillRect(-2, -3, 4, 13); g2.fillStyle = '#ffb86b'; g2.beginPath(); g2.ellipse(-7, -3, 2, 3.4, 0, 0, TAU); g2.ellipse(7, -3, 2, 3.4, 0, 0, TAU); g2.ellipse(0, -6, 2, 3.4, 0, 0, TAU); g2.fill(); break;
    case 'pumpkin': g2.fillStyle = '#e07b39'; g2.beginPath(); g2.ellipse(0, 3, 13, 10, 0, 0, TAU); g2.fill(); g2.strokeStyle = '#b85c22'; g2.lineWidth = 1.6; g2.beginPath(); g2.ellipse(0, 3, 6, 10, 0, 0, TAU); g2.stroke(); g2.fillStyle = '#57c785'; g2.fillRect(-2, -10, 4, 5); break;
    case 'fire': g2.fillStyle = '#3a2c22'; rr(g2, -18, -16, 36, 32, 4); g2.fill(); g2.fillStyle = '#17100b'; rr(g2, -11, -4, 22, 18, 3); g2.fill(); var fl = 1 + Math.sin(now / 120) * .18; g2.fillStyle = '#ff9a3c'; g2.beginPath(); g2.ellipse(0, 6, 6 * fl, 9 * fl, 0, 0, TAU); g2.fill(); g2.fillStyle = '#ffd257'; g2.beginPath(); g2.ellipse(0, 8, 3.4 * fl, 5.4 * fl, 0, 0, TAU); g2.fill(); break;
    case 'minicab': g2.fillStyle = '#241a45'; rr(g2, -11, -18, 22, 36, 4); g2.fill(); g2.fillStyle = '#67e8f9'; rr(g2, -7, -14, 14, 11, 2); g2.fill(); g2.fillStyle = '#f472b6'; g2.beginPath(); g2.arc(0, 4, 3, 0, TAU); g2.fill(); g2.fillStyle = '#ffd257'; g2.fillRect(-6, 11, 12, 3); break;
    case 'throne': g2.fillStyle = '#6d5a1f'; rr(g2, -13, -8, 26, 20, 4); g2.fill(); rr(g2, -13, -19, 26, 10, 4); g2.fill(); g2.fillStyle = '#ffd257'; star4(g2, 0, -13, 5.5, 0); g2.fill(); g2.fillStyle = '#8b2f4f'; rr(g2, -9, -5, 18, 12, 3); g2.fill(); break;
    case 'ifountain': g2.strokeStyle = 'rgba(140,220,255,.75)'; g2.lineWidth = 2; g2.beginPath(); g2.arc(0, 4, 13, Math.PI * 1.08, Math.PI * 1.92); g2.stroke(); g2.fillStyle = '#4a6a8a'; g2.beginPath(); g2.ellipse(0, 9, 15, 6, 0, 0, TAU); g2.fill(); g2.fillStyle = 'rgba(140,220,255,.5)'; g2.beginPath(); g2.ellipse(0, 8, 11, 4, 0, 0, TAU); g2.fill(); g2.fillRect(-1.5, -8, 3, 12); break;
    default: g2.fillStyle = '#554a7a'; rr(g2, -12, -12, 24, 24, 5); g2.fill();
  }
  g2.restore();
}
function renderHouseDecor(g, now) {
  var cp9 = camPos();
  var vx0 = cp9.x, vy0 = cp9.y, vx1 = cp9.x + VW, vy1 = cp9.y + VH;
  function inV9(x, y, m) { return x > vx0 - (m || 0) && x < vx1 + (m || 0) && y > vy0 - (m || 0) && y < vy1 + (m || 0); }
  // maple row: street + six plot houses
  if (inV9(900, 3080, 900)) {
    g.fillStyle = '#241d38'; g.fillRect(320, 3150, 1160, 62);
    g.strokeStyle = 'rgba(255,210,87,.35)'; g.lineWidth = 2; g.setLineDash([16, 14]); g.beginPath(); g.moveTo(330, 3181); g.lineTo(1470, 3181); g.stroke(); g.setLineDash([]);
    var plotCols = ['#5d4a9e', '#7a4a6e', '#4a6e8a', '#6e8a4a', '#8a6a3a', '#4a5a9e'];
    for (var pi = 0; pi < HOUSE_PLOTS.length; pi++) {
      var hx = HOUSE_PLOTS[pi];
      if (!inV9(hx, 3050, 260)) continue;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(hx, 3146, 74, 12, 0, 0, TAU); g.fill();
      g.fillStyle = plotCols[pi]; rr(g, hx - 58, 3010, 116, 128, 6); g.fill();
      g.fillStyle = 'rgba(0,0,0,.22)'; rr(g, hx - 58, 3010, 116, 128, 6); g.fill();
      g.fillStyle = '#2c2340'; g.beginPath(); g.moveTo(hx - 70, 3014); g.lineTo(hx, 2952); g.lineTo(hx + 70, 3014); g.closePath(); g.fill();
      g.fillStyle = '#ffd257'; star4(g, hx, 2968, 7, now / 800); g.fill();
      g.fillStyle = '#3a2a1a'; rr(g, hx - 13, 3086, 26, 52, 5); g.fill();
      g.fillStyle = '#ffd257'; g.beginPath(); g.arc(hx + 7, 3112, 2.4, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,214,120,.85)'; rr(g, hx - 44, 3040, 20, 18, 3); g.fill(); rr(g, hx + 24, 3040, 20, 18, 3); g.fill();
    }
  }
  if (!myHouse || !HOUSE_VIEW || !HOUSE_VIEW.origin) return;
  var o = HOUSE_VIEW.origin, sc = HOUSE_STYLE_C[HOUSE_VIEW.style] || HOUSE_STYLE_C.cottage;
  if (!inV9(o.x + 430, o.y + 280, 1100)) return;
  g.fillStyle = '#050310'; g.fillRect(o.x - 700, o.y - 620, 2260, 1800);
  g.fillStyle = sc.floor; g.fillRect(o.x, o.y, 860, 560);
  g.fillStyle = sc.floor2;
  for (var fx2 = 0; fx2 < 860; fx2 += 80) g.fillRect(o.x + fx2, o.y, 40, 560);
  g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 1;
  for (var gx2 = 0; gx2 <= 20; gx2++) { g.beginPath(); g.moveTo(o.x + gx2 * 40 + .5, o.y); g.lineTo(o.x + gx2 * 40 + .5, o.y + 560); g.stroke(); }
  for (var gy2 = 0; gy2 <= 14; gy2++) { g.beginPath(); g.moveTo(o.x, o.y + gy2 * 40 + .5); g.lineTo(o.x + 860, o.y + gy2 * 40 + .5); g.stroke(); }
  (HOUSE_VIEW.items || []).forEach(function (it) {
    var cx3 = o.x + it.gx * 40 + 20, cy3 = o.y + it.gy * 40 + 20;
    g.save(); g.translate(cx3, cy3); g.rotate((it.r || 0) * Math.PI / 180); drawFurnShape(g, it.f, 40, now); g.restore();
  });
  // exit mat
  g.fillStyle = 'rgba(139,124,255,.30)'; rr(g, o.x + 398, o.y + 512, 64, 40, 8); g.fill();
  g.strokeStyle = '#8b7cff'; g.lineWidth = 1.6; g.stroke();
  g.fillStyle = '#cfc6ff'; g.font = '700 10px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('exit', o.x + 430, o.y + 536);
  // walls on top
  g.fillStyle = sc.wall; g.fillRect(o.x - 14, o.y - 26, 888, 26); g.fillRect(o.x - 14, o.y + 560, 888, 14); g.fillRect(o.x - 14, o.y, 14, 560); g.fillRect(o.x + 860, o.y, 14, 560);
  g.fillStyle = sc.trim; g.fillRect(o.x - 14, o.y - 4, 888, 4);
  if (decorOn && ghostCell && placeFid) {
    var gcx = o.x + ghostCell.gx * 40, gcy = o.y + ghostCell.gy * 40;
    g.globalAlpha = .55; g.save(); g.translate(gcx + 20, gcy + 20); g.rotate(placeRot * Math.PI / 180); drawFurnShape(g, placeFid, 40, now); g.restore(); g.globalAlpha = 1;
    g.strokeStyle = '#ffd257'; g.lineWidth = 2; g.strokeRect(gcx + 1, gcy + 1, 38, 38);
  }
}
function decorTap(e) {
  if (!HOUSE_VIEW || !HOUSE_VIEW.origin) return;
  var cp = camPos();
  var wx = e.clientX + cp.x, wy = e.clientY + cp.y, o = HOUSE_VIEW.origin;
  var gx = Math.floor((wx - o.x) / 40), gy = Math.floor((wy - o.y) / 40);
  if (gx < 0 || gx >= 20 || gy < 0 || gy >= 12) return;
  if (placeFid) {
    var fid = placeFid;
    jpost('/api/world/house-place', { fid: fid, gx: gx, gy: gy, rot: placeRot }).then(function (r) {
      if (!r || !r.ok) { toast((r && r.err) || 'can\'t put that there'); return; }
      HOUSE_VIEW.items = r.items; sndPop(); renderHousePanel();
    });
  } else {
    jpost('/api/world/house-unplace', { gx: gx, gy: gy }).then(function (r) {
      if (!r || !r.ok) return;
      HOUSE_VIEW.items = r.items; sndPop(); renderHousePanel();
    });
  }
}
cv.addEventListener('pointermove', function (e) {
  if (!decorOn || !HOUSE_VIEW || !HOUSE_VIEW.origin) { ghostCell = null; return; }
  var cp = camPos();
  var gx = Math.floor((e.clientX + cp.x - HOUSE_VIEW.origin.x) / 40), gy = Math.floor((e.clientY + cp.y - HOUSE_VIEW.origin.y) / 40);
  ghostCell = (gx >= 0 && gx < 20 && gy >= 0 && gy < 12) ? { gx: gx, gy: gy } : null;
});
function openHouse() { $('whouse').hidden = false; renderHousePanel(); }
function closeHouse() { $('whouse').hidden = true; }
function hsEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function renderHousePanel() {
  var body = $('whouse-body'); if (!body) return;
  var v = HOUSE_VIEW;
  $('whouse-t').textContent = myHouse ? (myHouse === me ? 'ur house' : '@' + myHouse + "'s house") : 'maple row housing';
  var h = '';
  if (!myHouse) {
    h += '<div class="hs-row"><span class="hs-nm">every player has a house on maple row — step to any plot door and hit enter</span></div>';
    h += '<button class="hs-btn" data-hs="enter-mine">enter ur house</button>';
    h += '<div class="hs-sec">visit a neighbor (online + visitable)</div><div id="whouse-visits"><span class="hs-note">looking around the row…</span></div>';
    body.innerHTML = h;
    fetch('/api/world/houses', { headers: { 'accept': 'application/json' } }).then(function (r) { return r.json(); }).then(function (r2) {
      var box = $('whouse-visits'); if (!box) return;
      if (!r2 || !r2.houses || !r2.houses.length) { box.innerHTML = '<span class="hs-note">nobody else is in the world rn</span>'; return; }
      box.innerHTML = r2.houses.map(function (hh) { return '<div class="hs-row"><span class="hs-nm">@' + hsEsc(hh.u) + ' · ' + hsEsc((HOUSE_STYLE_C[hh.style] && hh.style) || hh.style) + '</span><button class="hs-btn" data-hs="visit" data-u="' + hsEsc(hh.u) + '">visit</button></div>'; }).join('');
    }).catch(function () { });
    return;
  }
  if (!v) { body.innerHTML = '<span class="hs-note">loading ur house…</span>'; return; }
  var mine = v.mine;
  if (mine) {
    h += '<div class="hs-sec">who can visit</div><div class="hs-row">' + ['public', 'party', 'private'].map(function (lv) { return '<button class="hs-btn' + (v.pub === lv ? ' on' : '') + '" data-hs="priv" data-lv="' + lv + '">' + lv + '</button>'; }).join('') + '</div>';
    h += '<div class="hs-sec">house style</div>' + Object.keys(v.styles || {}).map(function (sid) { var st = v.styles[sid]; return '<div class="hs-row"><span class="hs-nm">' + hsEsc(st.name) + '</span>' + (v.style === sid ? '<span class="hs-pr">current</span>' : '<span class="hs-pr">¢' + st.price + '</span><button class="hs-btn" data-hs="buystyle" data-id="' + sid + '">buy</button>') + '</div>'; }).join('');
    h += '<div class="hs-sec">decorate</div><div class="hs-row"><button class="hs-btn' + (decorOn ? ' on' : '') + '" data-hs="decor">' + (decorOn ? 'decorating: ON (tap floor to place / pick up)' : 'start decorating') + '</button>' + (placeFid ? '<button class="hs-btn" data-hs="rot">rotate: ' + placeRot + '°</button><button class="hs-btn" data-hs="cancelplace">done placing</button>' : '') + '</div>';
    var placedCount = {};
    (v.items || []).forEach(function (it) { placedCount[it.f] = (placedCount[it.f] || 0) + 1; });
    var counts = {};
    (v.myFurn || []).forEach(function (f) { counts[f] = (counts[f] || 0) + 1; });
    var ownedIds = Object.keys(counts);
    h += '<div class="hs-sec">ur furniture (tap one, then tap the floor)</div>';
    h += ownedIds.length ? '<div class="hs-grid">' + ownedIds.map(function (fid) { var def = (v.furn || {})[fid] || {}; var left = counts[fid] - (placedCount[fid] || 0); return '<div class="hs-item' + (placeFid === fid ? ' sel' : '') + '" data-hs="pick" data-id="' + fid + '">' + hsEsc(def.name || fid) + '<span class="hs-pr">' + (left > 0 ? left + ' to place' : 'all placed') + '</span></div>'; }).join('') + '</div>' : '<span class="hs-note">nothing yet — the furniture shop is right below</span>';
    h += '<div class="hs-sec">furniture shop</div><div class="hs-grid">' + Object.keys(v.furn || {}).map(function (fid) { var def = v.furn[fid]; return '<div class="hs-item" data-hs="buyfurn" data-id="' + fid + '">' + hsEsc(def.name) + (def.rare ? ' · ' + def.rare : '') + (def.seasonal ? ' · seasonal' : '') + '<span class="hs-pr">¢' + def.price + '</span></div>'; }).join('') + '</div>';
  } else {
    h += '<div class="hs-row"><span class="hs-nm">ur visiting @' + hsEsc(v.owner) + ' — look around, the door mat at the bottom leaves</span></div><button class="hs-btn" data-hs="leave">leave</button>';
  }
  body.innerHTML = h;
}
$('whouse-body').addEventListener('click', function (e) {
  var t = e.target.closest('[data-hs]'); if (!t) return;
  var act = t.getAttribute('data-hs');
  if (act === 'enter-mine') { closeHouse(); enterHouse(me); }
  else if (act === 'visit') { closeHouse(); enterHouse(t.getAttribute('data-u')); }
  else if (act === 'leave') { closeHouse(); exitHouse(); }
  else if (act === 'priv') { jpost('/api/world/house-privacy', { level: t.getAttribute('data-lv') }).then(function (r) { if (r && r.ok) { HOUSE_VIEW.pub = r.pub; renderHousePanel(); } else toast((r && r.err) || 'nope'); }); }
  else if (act === 'buystyle') { jpost('/api/world/house-buy', { kind: 'style', id: t.getAttribute('data-id') }).then(function (r) { if (r && r.ok) { HOUSE_VIEW = r.view; toast('new house style ✦'); renderHousePanel(); } else toast((r && r.err) || 'can\'t buy that'); }); }
  else if (act === 'buyfurn') { jpost('/api/world/house-buy', { kind: 'furn', id: t.getAttribute('data-id') }).then(function (r) { if (r && r.ok) { HOUSE_VIEW = r.view; toast('bought — it\'s in ur furniture'); renderHousePanel(); } else toast((r && r.err) || 'can\'t buy that'); }); }
  else if (act === 'decor') { decorOn = !decorOn; if (!decorOn) placeFid = null; renderHousePanel(); }
  else if (act === 'pick') { if (!decorOn) decorOn = true; placeFid = t.getAttribute('data-id'); renderHousePanel(); toast('tap the floor to place it · rotate from the panel'); }
  else if (act === 'rot') { placeRot = (placeRot + 90) % 360; renderHousePanel(); }
  else if (act === 'cancelplace') { placeFid = null; renderHousePanel(); }
});
$('whouse-x').addEventListener('click', closeHouse);
window.__house = { open: openHouse, close: closeHouse };


/* ================= pets v2 ================= */
var myPetNames = {};
function openPets() { $('wpets').hidden = false; renderPets(); }
function closePets() { $('wpets').hidden = true; }
function renderPets() {
  var body = $('wpets-body'); if (!body) return;
  var pets = (window.WSHOP || []).filter(function (it) { return it.cat === 'pet'; });
  var ownedN = pets.filter(function (it) { return myInv.indexOf(it.id) >= 0; }).length;
  var h = '<div class="hs-note" style="margin-bottom:8px">' + ownedN + ' / ' + pets.length + ' companions adopted · tap a pet in the world to say hi</div><div class="pet-grid">';
  pets.forEach(function (it) {
    var owned = myInv.indexOf(it.id) >= 0;
    var eq = myWearIds.pet === it.id;
    var given = myPetNames[it.id] || '';
    h += '<div class="pet-card"><canvas width="56" height="56" data-petprev="' + it.id + '"></canvas><div class="pet-nm">' + escH(it.name) + '</div>' + (given ? '<div class="pet-given">“' + escH(given) + '”</div>' : '') + '<div class="pet-meta">' + it.rarity + (owned ? ' · adopted' : ' · ¢' + it.price) + '</div>';
    if (owned) {
      h += '<button class="hs-btn" data-pet="equip" data-id="' + it.id + '">' + (eq ? 'following u ✓' : 'call over') + '</button> <button class="hs-btn" data-pet="rename" data-id="' + it.id + '">name</button>';
    } else {
      h += '<button class="hs-btn" data-pet="adopt" data-id="' + it.id + '">adopt · ¢' + it.price + '</button>';
    }
    h += '</div>';
  });
  h += '</div>';
  body.innerHTML = h;
  body.querySelectorAll('canvas[data-petprev]').forEach(function (cv2) {
    var it = null;
    (window.WSHOP || []).forEach(function (x) { if (x.id === cv2.getAttribute('data-petprev')) it = x; });
    if (!it) return;
    var g2 = cv2.getContext('2d');
    drawPet(g2, { x: 28, y: 30, kind: it.kind, c: it.color, rarity: it.rarity, name: '' }, 1400);
  });
}
$('wpets-body').addEventListener('click', function (e) {
  var t = e.target.closest('[data-pet]'); if (!t) return;
  var act = t.getAttribute('data-pet'), id = t.getAttribute('data-id');
  if (act === 'equip') {
    var eq = myWearIds.pet === id;
    jpost('/api/world/shopequip', { cat: 'pet', id: eq ? '' : id }).then(function (r) { if (r && r.ok) { myWearIds = r.wearIds || myWearIds; renderPets(); } else toast((r && r.err) || 'nope'); });
  } else if (act === 'adopt') {
    jpost('/api/world/shopbuy', { id: id }).then(function (r) {
      if (r && r.ok) { myInv = r.inv || myInv; toast('adopted ✦ they\'ll follow u anywhere'); renderPets(); }
      else toast((r && r.err) || 'can\'t adopt that one');
    });
  } else if (act === 'rename') {
    var cur = myPetNames[id] || '';
    var nm = window.prompt('name ur companion (blank = clear):', cur);
    if (nm === null) return;
    jpost('/api/world/pet-name', { id: id, name: nm }).then(function (r) { if (r && r.ok) { myPetNames = r.names || {}; renderPets(); } else toast((r && r.err) || 'nope'); });
  }
});
$('wpets-x').addEventListener('click', closePets);
window.__pets = { open: openPets, close: closePets };


/* ================= mounts ================= */
var WBY = {};
(window.WSHOP || []).forEach(function (it) { WBY[it.id] = it; });
var MOUNT_SPD = { board: 350, scooter: 365, bike: 400, hover: 415, cloud: 440, rocket: 465, dragonm: 490 };
function drawMount(g, p, now, walking) {
  var m = p.wear.mount, c = m.c;
  g.save();
  g.translate(p.x, p.y + 14);
  g.rotate(p.dir || 0);
  g.fillStyle = c; g.strokeStyle = c;
  switch (m.kind) {
    case 'board':
      rr(g, -17, -3, 34, 6, 3); g.fill();
      g.fillStyle = '#241a38';
      g.beginPath(); g.arc(-10, 4.4, 3.4, 0, TAU); g.arc(10, 4.4, 3.4, 0, TAU); g.fill();
      break;
    case 'scooter':
      rr(g, -15, -2, 27, 5, 2); g.fill();
      g.lineWidth = 2.6; g.beginPath(); g.moveTo(10, -1); g.lineTo(15, -15); g.stroke();
      g.beginPath(); g.moveTo(10.4, -15); g.lineTo(19, -15); g.stroke();
      g.fillStyle = '#241a38';
      g.beginPath(); g.arc(-11, 4.6, 3.2, 0, TAU); g.arc(12, 4.6, 3.2, 0, TAU); g.fill();
      break;
    case 'bike':
      g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(-13, 2); g.lineTo(-1, -8); g.lineTo(13, 2); g.moveTo(-1, -8); g.lineTo(1, 3); g.moveTo(-13, 2); g.lineTo(1, 3); g.stroke();
      g.fillStyle = '#241a38';
      g.beginPath(); g.arc(-13, 3, 6.6, 0, TAU); g.fill();
      g.beginPath(); g.arc(13, 3, 6.6, 0, TAU); g.fill();
      g.fillStyle = c;
      g.beginPath(); g.arc(-13, 3, 2.4, 0, TAU); g.arc(13, 3, 2.4, 0, TAU); g.fill();
      break;
    case 'hover':
      g.shadowColor = c; g.shadowBlur = 14;
      rr(g, -17, -3, 34, 6, 3); g.fill(); g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.beginPath(); g.ellipse(0, 5.4, 13, 2.2, 0, 0, TAU); g.fill();
      break;
    case 'cloud':
      g.globalAlpha = 0.96; g.fillStyle = '#eef6ff';
      g.beginPath(); g.ellipse(-9, 2, 9, 5.4, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(2, -1, 11, 7, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(12, 2.6, 8, 4.6, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(1, 4.4, 13, 4.4, 0, 0, TAU); g.fill();
      g.globalAlpha = 1;
      break;
    case 'rocket':
      rr(g, -17, -3, 34, 6, 3); g.fill();
      if (walking) {
        var fl4 = 5 + Math.random() * 6;
        g.fillStyle = '#facc15';
        g.beginPath(); g.moveTo(-17, -2); g.lineTo(-17 - fl4 * 1.7, 0.6); g.lineTo(-17, 3.4); g.closePath(); g.fill();
        g.fillStyle = '#fb923c';
        g.beginPath(); g.moveTo(-17, -0.8); g.lineTo(-17 - fl4, 0.6); g.lineTo(-17, 2.2); g.closePath(); g.fill();
      }
      break;
    case 'dragonm': {
      var fl5 = Math.sin(now / 160) * 4;
      g.beginPath(); g.ellipse(-3, -9 - Math.abs(fl5), 13, 5, -0.5, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(4, 8 + Math.abs(fl5) * 0.4, 11, 4.4, 0.5, 0, TAU); g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
      g.beginPath(); g.ellipse(0, 0, 19, 7.4, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(-18, 0); g.lineTo(-27, -4); g.lineTo(-25, 3); g.closePath(); g.fill();
      g.beginPath(); g.arc(19, -3, 6, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(15, -8); g.lineTo(17, -13); g.lineTo(20, -8.6); g.closePath(); g.fill();
      g.fillStyle = '#17102e';
      g.beginPath(); g.arc(20.6, -4, 1.3, 0, TAU); g.fill();
      break;
    }
    default:
      rr(g, -15, -3, 30, 6, 3); g.fill();
  }
  g.restore();
}


/* ================= fishing ================= */
var FISHING = null;
function nearShore() {
  return (px > LAKE.x1 - 90 && px < LAKE.x2 + 90 && py > LAKE.y1 - 90 && py < LAKE.y2 + 90) || (px > PIER.x1 - 24 && px < PIER.x2 + 24 && py > PIER.y1 - 24 && py < PIER.y2 + 24);
}
function clearFishing(msg) {
  if (!FISHING) return;
  if (FISHING.t1) clearTimeout(FISHING.t1);
  if (FISHING.t2) clearTimeout(FISHING.t2);
  FISHING = null;
  if (msg) floatText(px, py - 34, msg, '#a5f3fc');
}
function castLine() {
  jpost('/api/world/fish-cast', {}).then(function (r) {
    if (!r || !r.ok) { toast((r && r.err) || 'cant fish here', ''); return; }
    var bx = px + Math.cos(dir) * 54, by = py + Math.sin(dir) * 54;
    FISHING = { stage: 'wait', bx: bx, by: by, t1: 0, t2: 0 };
    tone(520, 0, .12, 'sine', .08, 300);
    FISHING.t1 = setTimeout(function () {
      if (!FISHING) return;
      FISHING.stage = 'bite';
      tone(1240, 0, .1, 'square', .09, 900); tone(1560, .09, .12, 'square', .09, 1100);
      burst(FISHING.bx, FISHING.by, '#a5f3fc', 8, 46);
      FISHING.t2 = setTimeout(function () { clearFishing('it got away…'); }, 950);
    }, r.waitMs);
  });
}
function reelLine() {
  if (!FISHING) return;
  var f = FISHING;
  if (f.t1) clearTimeout(f.t1);
  if (f.t2) clearTimeout(f.t2);
  FISHING = null;
  jpost('/api/world/fish-reel', {}).then(function (r) {
    if (!r) return;
    if (r.ok) {
      burst(f.bx, f.by, r.sp.c, 16, 70);
      tone(760, 0, .12, 'triangle', .12, 1180);
      floatText(px, py - 38, (r.first ? 'NEW ✦ ' : '') + r.sp.name + ' · ' + r.kg + 'kg' + (r.sp.pay ? ' · +¢' + r.sp.pay : ''), r.sp.c);
      if (r.dailyBonus) toast('daily catch bonus ✦ +¢25', '');
    } else if (r.err) floatText(px, py - 34, r.err, '#fca5a5');
  });
}
function drawFishing(g, now) {
  if (!FISHING) return;
  var bob = FISHING.stage === 'bite' ? 3.4 : Math.sin(now / 300) * 1.4;
  g.strokeStyle = 'rgba(233,228,255,.4)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(px + Math.cos(dir) * 14, py - 6 + Math.sin(dir) * 6); g.lineTo(FISHING.bx, FISHING.by + bob); g.stroke();
  g.strokeStyle = 'rgba(165,243,252,.35)';
  g.beginPath(); g.ellipse(FISHING.bx, FISHING.by + 3, 8 + Math.sin(now / 400) * 2, 3, 0, 0, TAU); g.stroke();
  g.fillStyle = '#f8fafc';
  g.beginPath(); g.arc(FISHING.bx, FISHING.by + bob, 3.4, 0, TAU); g.fill();
  g.fillStyle = '#ef4444';
  g.beginPath(); g.arc(FISHING.bx, FISHING.by + bob, 3.4, Math.PI, TAU); g.fill();
  if (FISHING.stage === 'bite') {
    g.font = '900 17px Inter, sans-serif'; g.textAlign = 'center';
    g.fillStyle = '#ffd257';
    g.fillText('!', FISHING.bx, FISHING.by - 14 + Math.sin(now / 90) * 2);
  }
}
function openFish() { $('wfish').hidden = false; renderFish(); }
function closeFish() { $('wfish').hidden = true; }
function renderFish() {
  var body = $('wfish-body'); if (!body) return;
  body.innerHTML = '<div class="hs-note">checking the lake…</div>';
  fetch('/api/world/fish', { headers: { accept: 'application/json' } }).then(function (x) { return x.json(); }).then(function (r) {
    if (!r || !r.ok) { body.innerHTML = '<div class="hs-note">couldnt load fishing</div>'; return; }
    var caught = Object.keys(r.log || {}).length;
    var h = '<div class="hs-note">fish the moonlit lake shore or the pier · catch 3 in a day for a +¢25 bonus · u are ' + (nearShore() ? 'at the water rn' : 'not near the lake') + '</div>';
    h += '<div class="hs-sec">daily catch — ' + Math.min(r.daily.n, r.daily.need) + ' / ' + r.daily.need + (r.daily.paid ? ' · bonus paid ✓' : '') + '</div>';
    h += '<div class="hs-sec">ur rod</div><div class="hs-grid">' + r.rods.map(function (rd) {
      return '<div class="hs-item" data-fish="' + (rd.owned ? 'equiprod' : 'buyrod') + '" data-id="' + rd.id + '">' + hsEsc(rd.name) + ' · luck ×' + rd.luck + (rd.equipped ? ' · in hand ✓' : rd.owned ? ' · tap to hold' : '') + '<span class="hs-pr">' + (rd.owned ? '' : '¢' + rd.price) + '</span></div>';
    }).join('') + '</div>';
    h += '<div class="hs-sec">species journal — ' + caught + ' / ' + r.species.length + ' found</div><div class="fish-grid">' + r.species.map(function (s) {
      var le = (r.log || {})[s.id];
      return '<div class="fish-card' + (le ? '' : ' uncaught') + '"><div class="fish-dot" style="background:' + (le ? s.c : '#3b3355') + ';box-shadow:0 0 12px ' + (le ? s.c : 'transparent') + '"></div><div class="pet-nm">' + (le ? hsEsc(s.name) : '???') + '</div><div class="pet-meta">' + s.band + (le ? ' · ×' + le.n + ' · best ' + le.max + 'kg' : ' · ¢' + s.pay) + '</div></div>';
    }).join('') + '</div>';
    if (r.best && r.best.length) h += '<div class="hs-sec">biggest catches this week</div>' + r.best.map(function (b2, i) { return '<div class="hs-row"><span class="hs-nm">' + (i + 1) + '. @' + hsEsc(b2.u) + '</span><span class="hs-pr">' + b2.v + 'kg ' + hsEsc(b2.sp) + '</span></div>'; }).join('');
    body.innerHTML = h;
  }).catch(function () { body.innerHTML = '<div class="hs-note">couldnt load fishing</div>'; });
}
$('wfish-body').addEventListener('click', function (e) {
  var t = e.target.closest('[data-fish]'); if (!t) return;
  var act = t.getAttribute('data-fish'), id = t.getAttribute('data-id');
  if (act === 'buyrod') {
    jpost('/api/world/shopbuy', { id: id }).then(function (r) { if (r && r.ok) { myInv = r.inv || myInv; toast('rod got ✦ hold it from here'); renderFish(); } else toast((r && r.err) || 'cant buy that'); });
  } else if (act === 'equiprod') {
    jpost('/api/world/shopequip', { cat: 'rod', id: id }).then(function (r) { if (r && r.ok) { myWearIds = r.wearIds || myWearIds; renderFish(); } else toast((r && r.err) || 'nope'); });
  }
});
$('wfish-x').addEventListener('click', closeFish);
window.__fish = { open: openFish, close: closeFish };


/* ================= world boss + sunken crypt ================= */
var BOSS_V = null, INST_V = null, cryptExitWanted = false, lastBossHit = 0, lastDunHit = 0;
function bossHit() {
  var now = performance.now();
  if (now - lastBossHit < 460) return;
  lastBossHit = now;
  tone(180, 0, .08, 'square', .07, 90);
  jpost('/api/world/boss-hit', {}).then(function (r) {
    if (!r) return;
    if (r.ok) {
      burst(BOSS_V ? BOSS_V.x : px, BOSS_V ? BOSS_V.y - 20 : py, '#a78bfa', 7, 60);
      floatText(px, py - 40, '-' + r.dmg, '#c4b5fd');
      if (r.dead) { toast('\u2726 THE DROWNED LICH FALLS' + (r.urShare ? ' \u00b7 ur share +\u00a2' + r.urShare : ''), 5200); sndQuest(); }
    } else if (r.err) floatText(px, py - 36, r.err, '#fca5a5');
  });
}
function nearestShade() { var best = null, bd = 1e9; if (INST_V) INST_V.shades.forEach(function (s) { var d = dist(px, py, s.x, s.y); if (d < bd) { bd = d; best = s; } }); return best; }
function dunHit(id) {
  var now = performance.now();
  if (now - lastDunHit < 410) return;
  lastDunHit = now;
  tone(220, 0, .07, 'square', .07, 110);
  jpost('/api/world/dungeon-hit', { shade: id }).then(function (r) {
    if (!r) return;
    if (r.ok) {
      var s = nearestShade();
      if (s) burst(s.x, s.y, '#8b7fd4', 6, 54);
      if (r.killed) { floatText(px, py - 38, 'shade down +\u00a2' + r.pay, '#c4b5fd'); tone(660, 0, .1, 'triangle', .1, 990); }
      if (r.state === 'won') { toast('\u2726 CRYPT CLEARED \u00b7 +\u00a2120 (first 3 runs a day)', 4600); sndQuest(); }
    } else if (r.err) floatText(px, py - 36, r.err, '#fca5a5');
  });
}
function drawBoss(g, now) {
  if (!BOSS_V) return;
  var b = BOSS_V, bob = Math.sin(now / 600) * 4;
  if (!b.dead && b.slamIn < 2000) {
    var R = b.phase >= 2 ? 170 : 140;
    g.fillStyle = 'rgba(239,68,68,' + (0.05 + 0.05 * Math.sin(now / 90)) + ')';
    g.beginPath(); g.arc(b.x, b.y, R, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(239,68,68,.5)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(b.x, b.y, R * (b.slamIn / 2000), 0, TAU); g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.beginPath(); g.ellipse(b.x, b.y + 40, 34, 9, 0, 0, TAU); g.fill();
  if (b.dead) {
    g.save(); g.globalAlpha = 0.4; g.translate(b.x, b.y + 26); g.rotate(1.35);
    g.fillStyle = '#241a3d'; g.beginPath(); g.ellipse(0, 0, 15, 30, 0, 0, TAU); g.fill();
    g.restore();
    return;
  }
  var wg = g.createLinearGradient(b.x, b.y - 52 + bob, b.x, b.y + 42 + bob);
  wg.addColorStop(0, '#3b2a63'); wg.addColorStop(1, '#17102a');
  g.fillStyle = wg;
  g.beginPath();
  g.moveTo(b.x, b.y - 54 + bob);
  g.bezierCurveTo(b.x + 26, b.y - 40 + bob, b.x + 30, b.y + 10 + bob, b.x + 34, b.y + 42 + bob);
  g.lineTo(b.x - 34, b.y + 42 + bob);
  g.bezierCurveTo(b.x - 30, b.y + 10 + bob, b.x - 26, b.y - 40 + bob, b.x, b.y - 54 + bob);
  g.fill();
  g.fillStyle = '#0d0a18';
  g.beginPath(); g.arc(b.x, b.y - 38 + bob, 15, 0, TAU); g.fill();
  g.fillStyle = '#e9e4ff';
  g.beginPath(); g.arc(b.x, b.y - 34 + bob, 8.5, 0, TAU); g.fill();
  g.fillStyle = '#67e8f9';
  g.beginPath(); g.arc(b.x - 3.4, b.y - 35 + bob, 1.9, 0, TAU); g.arc(b.x + 3.4, b.y - 35 + bob, 1.9, 0, TAU); g.fill();
  g.strokeStyle = '#ffd257'; g.lineWidth = 2; g.beginPath();
  for (var ci = -2; ci <= 2; ci++) { g.moveTo(b.x + ci * 6, b.y - 50 + bob); g.lineTo(b.x + ci * 6, b.y - 58 + bob - Math.abs(ci)); }
  g.stroke();
  g.strokeStyle = '#8a6d3b'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(b.x + 30, b.y + 30 + bob); g.lineTo(b.x + 40, b.y - 34 + bob); g.stroke();
  var og = g.createRadialGradient(b.x + 40, b.y - 40 + bob, 1, b.x + 40, b.y - 40 + bob, 11);
  og.addColorStop(0, 'rgba(167,139,250,.95)'); og.addColorStop(1, 'rgba(167,139,250,0)');
  g.fillStyle = og; g.beginPath(); g.arc(b.x + 40, b.y - 40 + bob, 11, 0, TAU); g.fill();
  g.font = '800 12px Inter, sans-serif'; g.textAlign = 'center';
  g.fillStyle = '#e9e4ff';
  g.fillText('the drowned lich', b.x, b.y - 74 + bob);
  g.fillStyle = 'rgba(10,8,20,.72)';
  g.fillRect(b.x - 62, b.y - 68 + bob, 124, 7);
  g.fillStyle = b.phase >= 3 ? '#ef4444' : b.phase === 2 ? '#fb923c' : '#a78bfa';
  g.fillRect(b.x - 61, b.y - 67 + bob, 122 * Math.max(0, b.hp / b.max), 5);
  if (b.stun > 0) {
    g.font = '900 13px Inter, sans-serif'; g.fillStyle = '#fca5a5';
    g.fillText('STUNNED', px, py - 44 + Math.sin(now / 80) * 2);
  }
}
function heartPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.3, y, x - s * 0.7, y - s, x, y - s * 0.25);
  g.bezierCurveTo(x + s * 0.7, y - s, x + s * 1.3, y, x, y + s * 0.9);
  g.fill();
}
function drawCryptRoom(g, now) {
  if (!INST_V) return;
  var ox = INST_V.ox, oy = INST_V.oy;
  g.fillStyle = '#14101f';
  g.fillRect(ox - 26, oy - 26, 1152, 572);
  g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 1;
  for (var tx = ox; tx < ox + 1100; tx += 55) { g.beginPath(); g.moveTo(tx, oy); g.lineTo(tx, oy + 520); g.stroke(); }
  for (var ty = oy; ty < oy + 520; ty += 52) { g.beginPath(); g.moveTo(ox, ty); g.lineTo(ox + 1100, ty); g.stroke(); }
  g.strokeStyle = 'rgba(139,127,212,.35)'; g.lineWidth = 3;
  g.strokeRect(ox - 26, oy - 26, 1152, 572);
  [[ox + 60, oy + 60], [ox + 1040, oy + 60], [ox + 60, oy + 460], [ox + 1040, oy + 460]].forEach(function (t) {
    g.fillStyle = '#1e1830'; g.fillRect(t[0] - 13, t[1] - 13, 26, 26);
    var fg = g.createRadialGradient(t[0], t[1], 1, t[0], t[1], 30);
    fg.addColorStop(0, 'rgba(255,176,84,.85)'); fg.addColorStop(1, 'rgba(255,176,84,0)');
    g.fillStyle = fg; g.beginPath(); g.arc(t[0], t[1], 30, 0, TAU); g.fill();
    g.fillStyle = '#ffb054';
    g.beginPath(); g.ellipse(t[0], t[1] - 2, 4, 7 + Math.sin(now / 130 + t[0]) * 1.6, 0, 0, TAU); g.fill();
  });
  g.fillStyle = 'rgba(45,212,191,.16)';
  g.fillRect(ox + 505, oy + 446, 90, 48);
  g.strokeStyle = 'rgba(45,212,191,.55)'; g.lineWidth = 1.5;
  g.strokeRect(ox + 505, oy + 446, 90, 48);
  g.font = '700 10px Inter, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#5eead4';
  g.fillText('EXIT', ox + 550, oy + 474);
  INST_V.shades.forEach(function (s) {
    var sc = s.boss ? 1.9 : 1, wob = Math.sin(now / 240 + s.x) * 2;
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.beginPath(); g.ellipse(s.x, s.y + 14 * sc, 13 * sc, 4.5 * sc, 0, 0, TAU); g.fill();
    var sg = g.createRadialGradient(s.x, s.y - 4, 2, s.x, s.y, 20 * sc);
    sg.addColorStop(0, 'rgba(64,52,110,.96)'); sg.addColorStop(1, 'rgba(30,24,54,.88)');
    g.fillStyle = sg;
    g.beginPath();
    g.moveTo(s.x - 13 * sc, s.y + 12 * sc);
    for (var wv = 0; wv <= 4; wv++) g.lineTo(s.x - 13 * sc + wv * 6.5 * sc, s.y + (12 + (wv % 2) * 3.4) * sc + wob * 0.4);
    g.lineTo(s.x + 13 * sc, s.y - 8 * sc);
    g.arc(s.x, s.y - 8 * sc, 13 * sc, 0, Math.PI, true);
    g.closePath(); g.fill();
    g.fillStyle = s.boss ? '#ffd257' : '#a5f3fc';
    g.beginPath(); g.arc(s.x - 4.6 * sc, s.y - 6 * sc, 1.8 * sc, 0, TAU); g.arc(s.x + 4.6 * sc, s.y - 6 * sc, 1.8 * sc, 0, TAU); g.fill();
    if (s.boss) {
      g.strokeStyle = '#ffd257'; g.lineWidth = 2; g.beginPath();
      for (var cj = -2; cj <= 2; cj++) { g.moveTo(s.x + cj * 6, s.y - 26); g.lineTo(s.x + cj * 6, s.y - 33 - Math.abs(cj)); }
      g.stroke();
      g.font = '800 11px Inter, sans-serif'; g.fillStyle = '#ffd257';
      g.fillText('the crypt warden', s.x, s.y - 42);
    }
    g.fillStyle = 'rgba(10,8,20,.7)'; g.fillRect(s.x - 17 * sc, s.y - 22 * sc, 34 * sc, 4.4);
    g.fillStyle = s.boss ? '#ffd257' : '#8b7fd4';
    g.fillRect(s.x - 16 * sc, s.y - 21.4 * sc, 32 * sc * Math.max(0, s.hp / s.max), 3.2);
  });
  g.font = '800 13px Inter, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#e9e4ff';
  g.fillText(INST_V.state === 'won' ? 'CRYPT CLEARED \u2726' : 'the sunken crypt \u00b7 wave ' + INST_V.wave + ' / 3', ox + 550, oy + 26);
  for (var hi = 0; hi < 3; hi++) { g.fillStyle = hi < INST_V.hearts ? '#f87171' : 'rgba(255,255,255,.16)'; heartPath(g, ox + 512 + hi * 26, oy + 46, 7); }
}
function drawCryptGate(g, now) {
  var gx = 5050, gy = 3550;
  var cp9 = camPos();
  if (gx < cp9.x - 340 || gx > cp9.x + VW + 340 || gy < cp9.y - 340 || gy > cp9.y + VH + 340) return;
  g.fillStyle = '#221c33';
  g.fillRect(gx - 52, gy - 58, 14, 76); g.fillRect(gx + 38, gy - 58, 14, 76); g.fillRect(gx - 58, gy - 66, 116, 14);
  var gg = g.createRadialGradient(gx, gy - 10, 2, gx, gy - 10, 44);
  gg.addColorStop(0, 'rgba(139,127,212,.5)'); gg.addColorStop(1, 'rgba(139,127,212,0)');
  g.fillStyle = gg; g.fillRect(gx - 38, gy - 52, 76, 70);
  g.fillStyle = '#0a0812'; g.fillRect(gx - 36, gy - 50, 72, 68);
  g.fillStyle = 'rgba(167,139,250,' + (0.5 + 0.3 * Math.sin(now / 300)) + ')';
  [[-20, -30], [14, -18], [-6, 2], [20, 8], [-24, 12]].forEach(function (rn) { g.beginPath(); g.arc(gx + rn[0], gy + rn[1], 2, 0, TAU); g.fill(); });
  g.font = '700 11px Inter, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#c4b5fd';
  g.fillText('the sunken crypt', gx, gy - 76);
}

window.__admin = { open: openAdmin, close: closeAdmin };
function profSocial(u) {
  $('wprof-block').textContent = myBlocks.indexOf(u) >= 0 ? 'unblock' : 'block';
  $('wprof-mute').textContent = mutedSet[u] ? 'unmute' : 'mute';
}
$('wprof-trade').addEventListener('click', function () {
  if (!profUser || profUser === me) return;
  var u = profUser;
  jpost('/api/world/trade', { act: 'invite', to: u }).then(function (r) {
    if (r && r.ok) { toast('trade invite sent to @' + u); closeProfile(); }
    else toast('couldnt invite', (r && r.err) || '');
  });
});
$('wprof-invite').addEventListener('click', function () {
  var u = profUser; if (!u) return;
  jpost('/api/world/party', { act: 'invite', user: u }).then(function (r) {
    if (r && r.ok) { toast('party invite sent to @' + u); closeProfile(); }
    else toast('couldnt invite', (r && r.err) || '');
  });
});
$('wprof-mute').addEventListener('click', function () {
  var u = profUser; if (!u) return;
  if (mutedSet[u]) delete mutedSet[u]; else mutedSet[u] = 1;
  try { localStorage.setItem('sixMuted', JSON.stringify(mutedSet)); } catch (e) {}
  profSocial(u);
  toast(mutedSet[u] ? 'muted @' + u + ' \u2014 their bubbles hide for u' : 'unmuted @' + u);
});
$('wprof-block').addEventListener('click', function () {
  var u = profUser; if (!u) return;
  var un = myBlocks.indexOf(u) >= 0;
  jpost('/api/world/block', { user: u, act: un ? 'unblock' : 'block' }).then(function (r) {
    if (r && r.ok) { myBlocks = r.blocks || myBlocks; profSocial(u); toast(un ? 'unblocked @' + u : 'blocked @' + u + ' \u2014 gone from ur world'); if (!un) closeProfile(); }
    else toast('couldnt do that', (r && r.err) || '');
  });
});
$('wprof-visit').addEventListener('click', function () {
  if (!profUser || profUser === me) return;
  closeProfile();
  enterHouse(profUser);
});
$('wprof-report').addEventListener('click', function () {
  var u = profUser; if (!u) return;
  var why = window.prompt('report @' + u + ' \u2014 what happened? deion sees it in the world admin panel');
  if (why == null) return;
  jpost('/api/world/report', { user: u, why: why }).then(function (r) {
    toast(r && r.ok ? 'reported \u2014 thanks for flagging it' : 'report didnt land');
    closeProfile();
  });
});

/* character customization */
var CHAR_HUES = [258, 282, 305, 340, 12, 32, 55, 95, 145, 174, 200, 222];
function curHue() { var p = players[me]; return (p && p.hue != null) ? p.hue : hueOf(me); }
function drawCharPv(h) {
  var cv2 = $('wchar-pv'); if (!cv2) return;
  var g = cv2.getContext('2d');
  g.clearRect(0, 0, 96, 96);
  var sh = g.createRadialGradient(48, 78, 2, 48, 78, 24);
  sh.addColorStop(0, 'rgba(0,0,0,.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.beginPath(); g.ellipse(48, 78, 24, 9, 0, 0, TAU); g.fill();
  g.save(); g.translate(48, 44);
  var grad = g.createRadialGradient(-8, -10, 4, 0, 0, 32);
  grad.addColorStop(0, 'hsl(' + h + ',82%,72%)');
  grad.addColorStop(0.55, 'hsl(' + h + ',68%,55%)');
  grad.addColorStop(1, 'hsl(' + h + ',62%,40%)');
  g.shadowColor = 'hsla(' + h + ',85%,64%,.7)'; g.shadowBlur = 12;
  g.fillStyle = grad;
  starPath(g, 29, 0.5, 0); g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 2; g.strokeStyle = 'hsla(' + h + ',72%,30%,.85)';
  starPath(g, 29, 0.5, 0); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.10)';
  starPath(g, 16, 0.5, 0); g.fill();
  g.fillStyle = 'rgba(255,255,255,.38)';
  g.beginPath(); g.ellipse(-8, -12, 6.5, 4, -0.6, 0, TAU); g.fill();
  g.fillStyle = '#14101f';
  g.beginPath(); g.arc(-7, -2, 2.6, 0, TAU); g.arc(7, -2, 2.6, 0, TAU); g.fill();
  g.strokeStyle = '#14101f'; g.lineWidth = 2.2;
  g.beginPath(); g.arc(0, 3.5, 6.5, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
  g.restore();
}
function openChar() {
  $('wchar').hidden = false;
  document.body.classList.add('wov');
  $('wchar-name').textContent = '@' + me;
  var sw = $('wchar-sw');
  if (!sw.children.length) {
    CHAR_HUES.forEach(function (h) {
      var b = document.createElement('button');
      b.type = 'button';
      b.style.background = 'hsl(' + h + ',70%,58%)';
      b.setAttribute('data-hue', h);
      b.addEventListener('click', function () {
        jpost('/api/world/char', { hue: h }).then(function (r) {
          if (r && r.ok) {
            if (players[me]) players[me].hue = h;
            drawCharPv(h);
            Array.prototype.forEach.call(sw.children, function (x) { x.classList.toggle('on', +x.getAttribute('data-hue') === h); });
            toast('character saved — that color is u everywhere in the world');
          } else toast('couldnt save that', (r && r.err) || '');
        });
      });
      sw.appendChild(b);
    });
  }
  var cur = curHue();
  Array.prototype.forEach.call(sw.children, function (x) { x.classList.toggle('on', +x.getAttribute('data-hue') === cur); });
  drawCharPv(cur);
}
function closeChar() { $('wchar').hidden = true; document.body.classList.remove('wov'); }
$('wcharbtn').addEventListener('click', openChar);
$('wchar-x').addEventListener('click', closeChar);
$('wchar').addEventListener('click', function (e) { if (e.target === $('wchar')) closeChar(); });
$('wchar-shop').addEventListener('click', function () { closeChar(); openShop(); });
window.__profile = { open: openProfile };
window.__char = { open: openChar };

/* battles: reaction duel */
var duelChFrom = '', duelRun = null;
function duelTick(r) {
  if (r.duelDone) {
    var d = r.duelDone;
    if (d.declined) toast('@' + d.foe + ' declined ur battle');
    else if (d.win === 'win') toast('u WON the battle vs @' + d.foe + ' — ' + d.myMs + 'ms beats ' + d.foeMs + 'ms · +¢' + d.prize);
    else if (d.win === 'tie') toast('battle tie vs @' + d.foe + ' — both get +¢' + d.prize);
    else toast('u lost the battle vs @' + d.foe + ' — their ' + d.foeMs + 'ms beat ur ' + d.myMs + 'ms');
    if (d.bal != null) setCentsBal(d.bal);
  }
  var bar = $('wduel');
  if (r.duelIn && r.duelIn.from) {
    if (duelChFrom !== r.duelIn.from) { duelChFrom = r.duelIn.from; $('wduel-t').textContent = '@' + duelChFrom + ' wants to battle — reaction duel, winner +¢20'; }
    bar.hidden = false;
  } else { bar.hidden = true; duelChFrom = ''; }
  if (r.duel && !duelRun) startDuelFx(r.duel, r.srvNow || Date.now());
  if (!r.duel && duelRun && duelRun.reported) endDuelFx();
}
function startDuelFx(d, srvNow) {
  var ov = $('wduelgo');
  duelRun = { id: d.id, foe: d.foe, green: false, reported: !!d.reported, greenStamp: 0 };
  ov.hidden = false;
  ov.classList.remove('go');
  $('wduelgo-t').textContent = 'battle vs @' + d.foe;
  $('wduelgo-s').textContent = duelRun.reported ? 'time locked in — waiting on @' + d.foe + '…' : 'wait for green, then TAP as fast as u can';
  var wait = Math.max(0, (d.startAt + d.delay) - srvNow);
  setTimeout(function () {
    if (!duelRun || duelRun.id !== d.id || duelRun.reported) return;
    duelRun.green = true;
    duelRun.greenStamp = performance.now();
    ov.classList.add('go');
    $('wduelgo-s').textContent = 'TAP!';
  }, wait);
}
function endDuelFx() { $('wduelgo').hidden = true; duelRun = null; }
$('wduelgo').addEventListener('pointerdown', function (e) {
  e.preventDefault();
  if (!duelRun || duelRun.reported) return;
  duelRun.reported = true;
  if (!duelRun.green) {
    jpost('/api/world/duel-report', { id: duelRun.id });
    $('wduelgo-s').textContent = 'too soon! that counts as a loss unless they mess up too…';
    setTimeout(endDuelFx, 1600);
    return;
  }
  jpost('/api/world/duel-report', { id: duelRun.id });
  $('wduelgo-s').textContent = 'locked in — the server clock has ur time. waiting on @' + duelRun.foe + '…';
});
$('wduel-yes').addEventListener('click', function () {
  if (!duelChFrom) return;
  var f = duelChFrom;
  $('wduel').hidden = true; duelChFrom = '';
  jpost('/api/world/duel-accept', { from: f });
});
$('wduel-no').addEventListener('click', function () {
  if (!duelChFrom) return;
  var f = duelChFrom;
  $('wduel').hidden = true; duelChFrom = '';
  jpost('/api/world/duel-decline', { from: f });
});

/* ---------------- boot ---------------- */
requestAnimationFrame(loop);
fetch('/auth/me').then(function (r) { return r.json(); }).then(function (o) {
  if (!o || !o.user) { $('wlogin').hidden = false; return; }
  me = o.user;
  players[me] = { u: me, x: px, y: py, tx: px, ty: py, dir: dir, fx: '', vc: false, talk: false, bub: '', bubAt: 0, emote: '', emoteAt: 0, npc: false, wear: null };
  started = true;
  ping();
  setTimeout(function () { toast("welcome to six's network ✦ shards pay six cents · six gives quests"); }, 600);
}).catch(function () { $('wlogin').hidden = false; });
window.addEventListener('beforeunload', function () {
  try { navigator.sendBeacon('/api/world/leave', new Blob(['{}'], { type: 'application/json' })); } catch (e) { }
});
})();
