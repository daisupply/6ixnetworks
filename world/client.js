/* six's network — client engine. a big walkable world: districts, a lake,
   a pine forest, neon market, moon shards, quests, emotes, proximity VC. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
var lerp = function (a, b, k) { return a + (b - a) * k; };
var dist = function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); };
var TAU = Math.PI * 2;

var MAP_W = 4800, MAP_H = 3000;
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
var OBS = [{ x: FOUNTAIN.x, y: FOUNTAIN.y, r: 74 }];
TREES.forEach(function (t) { OBS.push({ x: t.x, y: t.y, r: 15 }); });
STALLS.forEach(function (s) { OBS.push({ x: s.x, y: s.y, r: 30 }); });

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
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012);
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
var parts = [];
var floats = [];
var fires = [];
for (var fi = 0; fi < 110; fi++) fires.push({ x: Math.random() * MAP_W, y: Math.random() * MAP_H, s: Math.random() * TAU, v: 4 + Math.random() * 9 });
var myEmote = '', myEmoteTs = 0;
var pendingClaim = '', claimAt = 0;
var insidePad = '';
var myZone = '', zoneSeen = false;
var wactMode = '';
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
var RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
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
  if (!vcCtx) { try { vcCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
  var pc;
  try { pc = new RTCPeerConnection(RTC_CFG); } catch (e) { return; }
  var gain = null;
  if (vcCtx) { gain = vcCtx.createGain(); gain.gain.value = 0; gain.connect(vcCtx.destination); }
  peers[u] = { pc: pc, gain: gain };
  if (localStream) localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
  else pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onicecandidate = function (e) { if (e.candidate) vcSend(u, { t: 'ice', c: e.candidate }); };
  pc.ontrack = function (e) {
    if (!vcCtx || !peers[u]) return;
    try { vcCtx.createMediaStreamSource(e.streams[0]).connect(peers[u].gain); } catch (err) { }
  };
  pc.onconnectionstatechange = function () {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(u);
  };
  if (initiator) {
    pc.onnegotiationneeded = function () {
      pc.createOffer().then(function (of) { return pc.setLocalDescription(of); })
        .then(function () { vcSend(u, { t: 'offer', sdp: pc.localDescription }); }).catch(function () { });
    };
  }
}
function handleSignal(from, data) {
  if (!data || !vcOn) return;
  if (data.t === 'offer') {
    ensurePeer(from, false);
    var p = peers[from]; if (!p) return;
    p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(function () { return p.pc.createAnswer(); })
      .then(function (an) { return p.pc.setLocalDescription(an); })
      .then(function () { vcSend(from, { t: 'answer', sdp: p.pc.localDescription }); })
      .catch(function () { });
  } else if (data.t === 'answer') {
    var p2 = peers[from]; if (p2) p2.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(function () { });
  } else if (data.t === 'ice') {
    var p3 = peers[from]; if (p3 && data.c) p3.pc.addIceCandidate(new RTCIceCandidate(data.c)).catch(function () { });
  }
}
function vcTick(roster) {
  if (!vcOn) return;
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
  var cp = camPos();
  moveTarget = { x: clamp(e.clientX + cp.x, 30, MAP_W - 30), y: clamp(e.clientY + cp.y, 30, MAP_H - 30), at: performance.now() };
}, { passive: true });

/* ---------------- HUD ---------------- */
function renderQuest(q) {
  var el = $('wquest'); if (!el || !q) return;
  var sig = q.t + '|' + q.prog + '|' + q.chain;
  if (sig === questSig) return;
  questSig = sig;
  el.hidden = false;
  el.querySelector('.wq-t').textContent = '✦ quest: ' + q.t;
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
  if (pendingClaim && performance.now() - claimAt > 250) { body.claim = pendingClaim; }
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
      var cur = players[p.u];
      if (!cur) {
        players[p.u] = { u: p.u, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir, fx: p.fx, vc: p.vc, talk: p.talk, bub: '', bubAt: 0, emote: '', emoteAt: 0, npc: !!p.npc, wear: p.wear || null };
        cur = players[p.u];
      }
      cur.tx = p.x; cur.ty = p.y; cur.dir = p.dir; cur.fx = p.fx; cur.vc = p.vc; cur.talk = p.talk; cur.npc = !!p.npc; cur.wear = p.wear || null;
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
    if (r.quest) renderQuest(r.quest);
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
  var speed = dashing ? 660 : (keys['shift'] ? 372 : 258) * (inWater ? 0.72 : 1);
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
        parts.push({ x: p.x + (Math.random() * 10 - 5), y: p.y + 8 + Math.random() * 4, vx: 0, vy: 6, at: now, life: 620, c: p.wear.trail.c, r: 2.6, ts: p.wear.trail.kind });
      }
    }
    if (p.wear && p.wear.pet) {
      var pet = pets[u] || (pets[u] = { x: p.x, y: p.y - 30, kind: p.wear.pet.kind, c: p.wear.pet.c });
      pet.kind = p.wear.pet.kind; pet.c = p.wear.pet.c;
      var pa = now / 1500 + u.length * 1.7;
      var txp = p.x + Math.cos(pa) * 30, typ = p.y - 30 + Math.sin(now / 600 + u.length) * 4;
      pet.x += (txp - pet.x) * Math.min(1, dt * 3.4);
      pet.y += (typ - pet.y) * Math.min(1, dt * 3.4);
    } else if (pets[u]) {
      delete pets[u];
    }
  });
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
  if (dist(px, py, TENT.x, TENT.y) < 105) { actMode = 'shop'; actLabel = 'six cents shop'; }
  else if (nearCab) { actMode = 'cab'; actLabel = 'play minigames'; }
  else if (dist(px, py, FOUNTAIN.x, FOUNTAIN.y) < 135) { actMode = 'wish'; actLabel = 'make a wish · 1 six cent'; }
  if (actMode) {
    if (wactMode !== actMode) {
      wactMode = actMode;
      wact.className = 'm-' + actMode;
      wact.querySelector('.wact-t').textContent = actLabel;
    }
    wact.hidden = false;
  } else { wactMode = ''; wact.hidden = true; }
  if (!pendingClaim) {
    for (var id in shards) { if (dist(px, py, shards[id].x, shards[id].y) < 34) { pendingClaim = id; claimAt = performance.now(); break; } }
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
  var label = p.npc ? 'six ✦' : p.u;
  g.font = '700 12px Inter, sans-serif';
  var tw = g.measureText(label).width;
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 5; g.shadowOffsetY = 1;
  g.fillStyle = 'rgba(5,3,14,.55)';
  rr(g, p.x - tw / 2 - 7, by - 42, tw + 14, 17, 8); g.fill();
  g.shadowOffsetY = 0;
  if (fxc.g) { g.shadowColor = fxc.c; g.shadowBlur = 9; } else g.shadowBlur = 0;
  g.fillStyle = p.npc ? '#ffd257' : fxc.c;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, p.x, by - 33.5);
  g.shadowBlur = 0;
  if (p.vc && !p.npc) {
    g.fillStyle = p.talk ? '#4ade80' : 'rgba(255,255,255,.55)';
    g.beginPath(); g.arc(p.x + tw / 2 + 13, by - 33.5, 3, 0, TAU); g.fill();
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
  p._by = by;
  var sh = g.createRadialGradient(x, y + 13, 2, x, y + 13, 19);
  sh.addColorStop(0, 'rgba(0,0,0,.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.beginPath(); g.ellipse(x, y + 13, 19, 8, 0, 0, TAU); g.fill();
  if (p.wear && p.wear.aura) {
    var au = p.wear.aura, ai2, oa;
    g.strokeStyle = au.c; g.globalAlpha = 0.75; g.lineWidth = 2.2;
    if (au.kind === 'pulse') {
      g.beginPath(); g.arc(x, y + 4, 21 + Math.sin(now / 300 + x) * 3, 0, TAU); g.stroke();
    } else if (au.kind === 'spin') {
      for (ai2 = 0; ai2 < 3; ai2++) { g.beginPath(); g.arc(x, y + 4, 23, now / 900 + ai2 * 2.1, now / 900 + ai2 * 2.1 + 1.1); g.stroke(); }
    } else if (au.kind === 'orbit') {
      g.fillStyle = au.c;
      for (ai2 = 0; ai2 < 3; ai2++) { oa = now / 800 + ai2 * 2.1; g.beginPath(); g.arc(x + Math.cos(oa) * 24, y + 4 + Math.sin(oa) * 7, 2.6, 0, TAU); g.fill(); }
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
    g.beginPath(); g.arc(0, 0, 21 + Math.sin(now / 150) * 2.5, 0, TAU); g.stroke();
  } else if (p.vc) {
    g.strokeStyle = 'rgba(183,168,255,.4)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 20, 0, TAU); g.stroke();
  }
  if (p.npc) {
    g.shadowColor = '#ffd257'; g.shadowBlur = 18;
    g.fillStyle = '#8b7cff';
    star4(g, 0, 0, 19, now / 2600); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#ffd257';
    star4(g, 0, 0, 8, -now / 2600); g.fill();
  } else {
    var hue = hueOf(p.u);
    var grad = g.createRadialGradient(-5, -6, 3, 0, 0, 17);
    grad.addColorStop(0, 'hsl(' + hue + ',78%,70%)');
    grad.addColorStop(0.55, 'hsl(' + hue + ',66%,54%)');
    grad.addColorStop(1, 'hsl(' + hue + ',60%,40%)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, 15.5, 0, TAU); g.fill();
    g.strokeStyle = 'hsla(' + hue + ',70%,26%,.85)'; g.lineWidth = 1.6; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(0, 0, 13.6, Math.PI * 1.08, Math.PI * 1.52); g.stroke();
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
    if (emote === 'wave') {
      g.fillStyle = 'hsl(' + hue + ',70%,60%)';
      g.beginPath(); g.arc(17, -12 + Math.sin(now / 110) * 3.4, 4.6, 0, TAU); g.fill();
    }
  }
  g.restore();
  drawNameTag(g, p, now, by);
  var fxc = FXC[p.fx || ''] || FXC[''];
  g.font = '700 12px Inter, sans-serif';
  var tw = g.measureText(p.npc ? 'six ✦' : p.u).width;
  if (p.bub && now - p.bubAt < 5600) {
    g.font = '500 12.5px Inter, sans-serif';
    var lines = wrapLines(g, p.bub, 148);
    var bw = 0;
    lines.forEach(function (L) { bw = Math.max(bw, g.measureText(L).width); });
    bw += 18;
    var bh = lines.length * 16 + 11;
    var bx = clamp(x - bw / 2, 6, MAP_W - bw - 6), byy = by - 52 - bh;
    var age = now - p.bubAt;
    var fade = age > 4800 ? 1 - (age - 4800) / 800 : 1;
    var pop = age < 190 ? (0.55 + 0.45 * (1 - Math.pow(1 - age / 190, 3))) : 1;
    g.save();
    g.globalAlpha = Math.max(0, fade);
    g.translate(x, by - 50); g.scale(pop, pop); g.translate(-x, -(by - 50));
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
    [3950, 1600, 520, 'rgba(251,146,60,0.05)']
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
    var rg = g.createRadialGradient(L.x, L.y, 4, L.x, L.y, 118);
    rg.addColorStop(0, 'rgba(255,214,150,' + (0.12 * fl) + ')'); rg.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(L.x, L.y, 118, 0, TAU); g.fill();
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
    var mg = g.createRadialGradient(fx, fy - 12, 2, fx, fy - 12, 62);
    mg.addColorStop(0, 'rgba(240,240,255,.5)'); mg.addColorStop(1, 'rgba(240,240,255,0)');
    g.fillStyle = mg; g.beginPath(); g.arc(fx, fy - 12, 62, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#f4f2ff'; g.shadowColor = '#dcd6ff'; g.shadowBlur = 24;
    g.beginPath(); g.arc(fx, fy - 12, 13 + Math.sin(now / 900) * 1.2, 0, TAU); g.fill(); g.shadowBlur = 0;
    if (Math.random() < 0.1) parts.push({ x: fx + (Math.random() * 30 - 15), y: fy - 22, vx: 0, vy: -26, at: now, life: 700, c: '#dcd6ff', r: 1.6 });
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
  drawMap(camX, camY);
}
function drawMap(camX, camY) {
  if (!mapCx) return;
  var g = mapCx, W = 168, H = 105, sx = W / MAP_W, sy = H / MAP_H;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(16,10,34,.85)'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(56,120,220,.5)'; g.fillRect(LAKE.x1 * sx, LAKE.y1 * sy, (LAKE.x2 - LAKE.x1) * sx, (LAKE.y2 - LAKE.y1) * sy);
  g.fillStyle = 'rgba(52,211,153,.35)'; g.beginPath(); g.arc(650 * sx, 2100 * sy, 430 * sx, 0, TAU); g.fill();
  PORTALS.forEach(function (pad) { g.fillStyle = pad.c; g.beginPath(); g.arc(pad.x * sx, pad.y * sy, 2.4, 0, TAU); g.fill(); });
  Object.keys(shards).forEach(function (id) { var s = shards[id]; if (!s.gold) return; g.fillStyle = '#ffd257'; g.fillRect(s.x * sx - 1.4, s.y * sy - 1.4, 2.8, 2.8); });
  Object.keys(players).forEach(function (u) {
    var p = players[u];
    g.fillStyle = p.npc ? '#ffd257' : (u === me ? '#ffffff' : 'rgba(200,190,255,.8)');
    g.beginPath(); g.arc(p.x * sx, p.y * sy, u === me ? 3 : 2.2, 0, TAU); g.fill();
  });
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1;
  g.strokeRect(camX * sx, camY * sy, VW * sx, VH * sy);
}
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
var ENGINE_NAMES = { pop: 'pop party', react: 'reflex corner', memory: 'memory lane', catch: 'catch crew', maze: 'maze district', stack: 'stack street', quiz: 'quiz alley', snake: 'snake row' };
function buildArcadeList() {
  var list = $('wa-list');
  list.innerHTML = '';
  var order = ['pop', 'react', 'memory', 'catch', 'maze', 'stack', 'quiz', 'snake'];
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
      b.appendChild(left); b.appendChild(cap);
      b.addEventListener('click', function () { launchGame(g.id); });
      list.appendChild(b);
    });
  });
  $('wa-count').textContent = (window.WGAMES || []).length + ' minigames · 3 paid plays each per day';
}
function openArcade() {
  closeGame();
  if (!$('wa-list').children.length) buildArcadeList();
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
  MG.open = true; MG.id = id; MG.entry = entry; MG.points = 0; MG.doneFlag = false;
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
  jpost('/api/world/miniscore', { game: entry.id, points: points }).then(function (r) {
    var html;
    if (!r || !r.ok) html = 'score didn\'t land (' + ((r && r.err) || 'network') + ') — the run still counts in ur heart';
    else if (r.paid && r.cents > 0) html = '✦ +' + r.cents + ' six cents' + (r.bal != null ? ' · balance ¢' + r.bal : '') + (r.playsLeft != null ? ' · ' + r.playsLeft + ' paid plays left today' : '');
    else if (points > 0) html = 'practice run — paid plays for this one are used up today, six cents resume tomorrow';
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
  }
};


/* ---------------- six cents shop ---------------- */
var myInv = [], myWearIds = {}, shopTab = 'all', centsBal = 0;
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
      g.beginPath(); g.arc(0, -3, 13, Math.PI, TAU); g.fill();
      g.fillRect(0, -6.4, 19, 3.6);
      break;
    case 'crown':
      g.beginPath();
      g.moveTo(-11, -10); g.lineTo(-11, -22); g.lineTo(-5.5, -15); g.lineTo(0, -24); g.lineTo(5.5, -15); g.lineTo(11, -22); g.lineTo(11, -10); g.closePath(); g.fill();
      break;
    case 'halo':
      g.lineWidth = 2.6;
      g.beginPath(); g.ellipse(0, -21 + Math.sin(now / 500) * 1.2, 9, 3.1, 0, 0, TAU); g.stroke();
      break;
    case 'horns':
      g.beginPath(); g.moveTo(-13, -8); g.lineTo(-7, -10); g.lineTo(-12, -20); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(13, -8); g.lineTo(7, -10); g.lineTo(12, -20); g.closePath(); g.fill();
      break;
    case 'beanie':
      g.beginPath(); g.arc(0, -2, 13.6, Math.PI, TAU); g.fill();
      g.fillRect(-13.6, -4.6, 27.2, 4);
      g.beginPath(); g.arc(0, -16, 3.4, 0, TAU); g.fill();
      break;
    case 'wizard':
      g.beginPath(); g.moveTo(-3, -30); g.lineTo(-12, -8); g.lineTo(12, -8); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(0, -8, 16, 3.6, 0, 0, TAU); g.fill();
      break;
    case 'antenna':
      g.lineWidth = 2; g.beginPath(); g.moveTo(0, -13); g.lineTo(0, -23); g.stroke();
      g.fillStyle = c; star4(g, 0, -26, 5.4, now / 600); g.fill();
      break;
    case 'flower':
      for (var fi3 = 0; fi3 < 5; fi3++) {
        var fa2 = fi3 / 5 * TAU;
        g.beginPath(); g.arc(9 + Math.cos(fa2) * 3.6, -13 + Math.sin(fa2) * 3.6, 2.9, 0, TAU); g.fill();
      }
      g.fillStyle = '#fff7cc';
      g.beginPath(); g.arc(9, -13, 2.2, 0, TAU); g.fill();
      break;
    case 'mohawk':
      g.beginPath();
      g.moveTo(-2.6, -13); g.lineTo(0, -25); g.lineTo(2.6, -13); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-2.4, -10); g.lineTo(0.6, -21); g.lineTo(3.2, -10.6); g.closePath(); g.fill();
      break;
    case 'tophat':
      g.fillRect(-8, -25, 16, 13);
      g.fillRect(-13.5, -13.4, 27, 3.6);
      break;
    default:
      g.beginPath(); g.arc(0, -13, 5, 0, TAU); g.fill();
  }
}
function drawPet(g, pet, now) {
  var x = pet.x, y = pet.y, c = pet.c;
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
    default:
      g.shadowColor = c; g.shadowBlur = 12;
      g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath(); g.arc(x - 2, y - 2, 2, 0, TAU); g.fill();
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
  var tabs = [['all', 'all'], ['trail', 'trails'], ['hat', 'hats'], ['aura', 'auras'], ['pet', 'pets'], ['mine', 'my stuff']];
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
    if (shopTab === 'all') return true;
    if (shopTab === 'mine') return myInv.indexOf(it.id) >= 0;
    return it.cat === shopTab;
  });
  if (!items.length) {
    var none = document.createElement('div');
    none.style.cssText = 'color:rgba(243,239,255,.5);font-size:13.5px;padding:8px 2px';
    none.textContent = shopTab === 'mine' ? 'nothing yet — buy something, it shows up here' : 'nothing here';
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
    dot.style.background = it.color; dot.style.color = it.color;
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
window.__shop = {
  open: openShop, close: closeShop,
  state: function () { return { inv: myInv.slice(), wear: Object.assign({}, myWearIds), bal: centsBal, tab: shopTab }; }
};

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
