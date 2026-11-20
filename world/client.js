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
$('wwish').addEventListener('click', function () {
  jpost('/api/world/wish', {}).then(function (r) {
    if (!r) return;
    if (!r.ok) { toast(r.err || 'the fountain said no'); return; }
    if (r.jackpot) {
      sndQuest();
      burst(px, py - 10, '#ffd257', 34, 160);
      floatText(px, py - 46, 'JACKPOT +50c', '#ffd257');
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
  el.querySelector('.wq-s').textContent = q.prog + ' / ' + q.n + ' · pays ' + q.pay + 'c' + (q.chain ? ' · chain ×' + (q.chain + 1) : '');
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
  toast('✦ quest done: ' + qd.t + ' — +' + qd.pay + ' coins');
  burst(px, py - 10, '#ffd257', 26, 140);
  floatText(px, py - 44, '+' + qd.pay + 'c', '#ffd257');
}

/* ---------------- sync loop ---------------- */
function ping() {
  if (!started) return;
  var body = { x: Math.round(px), y: Math.round(py), dir: dir, vc: vcOn, talk: talkNow, emote: myEmote, emoteTs: myEmoteTs };
  if (pendingClaim && performance.now() - claimAt > 250) { body.claim = pendingClaim; }
  jpost('/api/world/ping', body).then(function (r) {
    if (!r || !r.ok) return;
    $('wn').textContent = r.n + ' in the network';
    if (r.bal != null && $('wbal')) $('wbal').textContent = '✦ ' + r.bal + ' coins';
    var seen = {};
    (r.players || []).forEach(function (p) {
      seen[p.u] = 1;
      var cur = players[p.u];
      if (!cur) {
        players[p.u] = { u: p.u, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir, fx: p.fx, vc: p.vc, talk: p.talk, bub: '', bubAt: 0, emote: '', emoteAt: 0, npc: !!p.npc };
        cur = players[p.u];
      }
      cur.tx = p.x; cur.ty = p.y; cur.dir = p.dir; cur.fx = p.fx; cur.vc = p.vc; cur.talk = p.talk; cur.npc = !!p.npc;
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
        if (s.gold && !goldKnown[s.id]) { goldKnown[s.id] = 1; toast('✦ a GOLDEN shard just dropped — 25 coins, first one there'); }
      }
    });
    Object.keys(shards).forEach(function (id) { if (!sSeen[id]) delete shards[id]; });
    if (pendingClaim && !sSeen[pendingClaim]) pendingClaim = '';
    (r.sig || []).forEach(function (s) { handleSignal(s.from, s.data); });
    vcTick(r.players || []);
    if (r.got) {
      sndPick(r.got.gold);
      burst(px, py - 8, r.got.gold ? '#ffd257' : '#a5f3fc', r.got.gold ? 24 : 12, 110);
      floatText(px, py - 40, '+' + r.got.amt + 'c', r.got.gold ? '#ffd257' : '#a5f3fc');
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
  $('wwish').hidden = dist(px, py, FOUNTAIN.x, FOUNTAIN.y) > 135;
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
    if (p.emote === 'heart' && now - p.emoteAt < 2400 && Math.random() < 0.3) {
      parts.push({ x: p.x + (Math.random() * 34 - 17), y: p.y - 20, vx: 0, vy: -46, at: now, life: 1000, c: '#f472b6', r: 3, heart: true, big: true });
    }
    if (p.emote === 'dance' && now - p.emoteAt < 2400 && Math.random() < 0.14) {
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
  if (emote === 'dance') { bounce = Math.abs(Math.sin(now / 125)) * 11; rot = Math.sin(now / 150) * 0.22; }
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
    if (p.heart) {
      g.font = (p.big ? '16px' : '11px') + ' Inter'; g.textAlign = 'center';
      g.fillText('♥', p.x, p.y - age * 30);
    } else if (p.note) {
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

/* ---------------- boot ---------------- */
requestAnimationFrame(loop);
fetch('/auth/me').then(function (r) { return r.json(); }).then(function (o) {
  if (!o || !o.user) { $('wlogin').hidden = false; return; }
  me = o.user;
  players[me] = { u: me, x: px, y: py, tx: px, ty: py, dir: dir, fx: '', vc: false, talk: false, bub: '', bubAt: 0, emote: '', emoteAt: 0, npc: false };
  started = true;
  ping();
  setTimeout(function () { toast("welcome to six's network ✦ wasd / joystick · space = dash · shards pay coins · six gives quests"); }, 600);
}).catch(function () { $('wlogin').hidden = false; });
window.addEventListener('beforeunload', function () {
  try { navigator.sendBeacon('/api/world/leave', new Blob(['{}'], { type: 'application/json' })); } catch (e) { }
});
})();
