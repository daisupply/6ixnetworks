/* the world — client engine. a real little game: fixed-feel movement,
   camera, particles, collectible shards, quests, emotes, proximity VC. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
var lerp = function (a, b, k) { return a + (b - a) * k; };
var dist = function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); };
var TAU = Math.PI * 2;

var MAP_W = 1600, MAP_H = 1000;
var PORTALS = [
  { id: 'games', label: 'the arcade', sub: 'games', href: '/gs', x: 180, y: 215, c: '#a78bfa' },
  { id: 'movies', label: 'the theater', sub: 'movies', href: '/movies', x: 1420, y: 215, c: '#f472b6' },
  { id: 'blox', label: 'blox tower', sub: 'roblox', href: '/blox', x: 800, y: 120, c: '#f0abfc' },
  { id: 'chat', label: 'chat lounge', sub: '6ixchat', href: '/chat', x: 110, y: 500, c: '#34d399' },
  { id: 'party', label: 'party house', sub: 'watch together', href: '/party', x: 1490, y: 500, c: '#facc15' },
  { id: 'yt', label: 'tube corner', sub: '6ixtube', href: '/yt', x: 180, y: 800, c: '#fb7185' },
  { id: 'tiktok', label: 'tiktok wall', sub: 'tiktok', href: '/tiktok', x: 1420, y: 800, c: '#7dd3fc' },
  { id: 'music', label: 'the stage', sub: 'music', href: '/music', x: 800, y: 905, c: '#38bdf8' }
];
var FXC = {
  '': { c: '#ffffff', g: 0 }, glow: { c: '#c9b8ff', g: 1 }, ghost: { c: '#e8f6ff', g: 0 },
  frost: { c: '#a5f3fc', g: 1 }, toxic: { c: '#bef264', g: 1 }, grad: { c: '#f0abfc', g: 1 },
  sunset: { c: '#fdba74', g: 1 }, fire: { c: '#fb923c', g: 1 }, gold: { c: '#ffd257', g: 1 },
  glitch: { c: '#f471b5', g: 1 }, rain: { c: '#7dd3fc', g: 1 }, galaxy: { c: '#c4b5fd', g: 1 }
};
var LAMPS = [];
for (var lx = 200; lx <= 1400; lx += 400) for (var ly = 180; ly <= 850; ly += 335) LAMPS.push({ x: lx + ((ly === 515) ? 200 : 0), y: ly });

function hueOf(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; }

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
var px = 800, py = 580, vx = 0, vy = 0, dir = 1.2, moving = false;
var keys = {};
var joy = { id: null, x: 0, y: 0 };
var cam = { x: 800, y: 500 };
var players = {};   // u -> render state
var shards = {};    // id -> {x,y,gold,seed}
var parts = [];     // particles
var floats = [];    // floating texts
var fires = [];     // fireflies
for (var fi = 0; fi < 46; fi++) fires.push({ x: Math.random() * MAP_W, y: Math.random() * MAP_H, s: Math.random() * TAU, v: 4 + Math.random() * 9 });
var myEmote = '', myEmoteTs = 0;
var pendingClaim = '', claimAt = 0;
var insidePad = '';
var myZone = '', zoneSeen = false;
var lastBub = {};   // u -> bub text (for chat log)
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
var peers = {}; // u -> {pc, gain}
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
    try {
      var src = vcCtx.createMediaStreamSource(e.streams[0]);
      src.connect(peers[u].gain);
    } catch (err) { }
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
  var rms = Math.sqrt(sum / (buf.length / 4));
  talkNow = rms > 0.045;
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
window.addEventListener('keydown', function (e) {
  if (document.activeElement === $('win')) { if (e.key === 'Escape') $('win').blur(); return; }
  var k = e.key.toLowerCase();
  keys[k] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
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

/* joystick */
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
cv.addEventListener('pointerdown', function () { ac(); }, { passive: true });

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
    $('wn').textContent = r.n + ' in the plaza';
    // players
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
        if (p.u !== me && lastBub[p.u] !== p.bub) { lastBub[p.u] = p.bub; logLine(p.u, p.bub); }
      }
      if (!p.bub) cur.bub = '';
      if (p.emote && p.emote !== cur.emote) { cur.emote = p.emote; cur.emoteAt = performance.now(); }
      if (!p.emote) cur.emote = '';
    });
    Object.keys(players).forEach(function (u) { if (!seen[u] && u !== me) delete players[u]; });
    // shards
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
    // signals + vc
    (r.sig || []).forEach(function (s) { handleSignal(s.from, s.data); });
    vcTick(r.players || []);
    // game results
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
setInterval(function () { talkNow = talkNow; }, 5000);

/* ---------------- update ---------------- */
var lastT = performance.now();
function update(now) {
  var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  // input dir
  var ix = 0, iy = 0;
  if (keys['w'] || keys['arrowup']) iy -= 1;
  if (keys['s'] || keys['arrowdown']) iy += 1;
  if (keys['a'] || keys['arrowleft']) ix -= 1;
  if (keys['d'] || keys['arrowright']) ix += 1;
  if (joy.id !== null || joy.x || joy.y) { ix += joy.x; iy += joy.y; }
  var m = Math.sqrt(ix * ix + iy * iy);
  if (m > 1) { ix /= m; iy /= m; }
  var sprint = keys['shift'] ? 1.45 : 1;
  var speed = 238 * sprint;
  var accel = 1500;
  vx += clamp(ix * speed - vx, -accel * dt, accel * dt);
  vy += clamp(iy * speed - vy, -accel * dt, accel * dt);
  if (!ix && Math.abs(vx) < 8) vx = 0;
  if (!iy && Math.abs(vy) < 8) vy = 0;
  px += vx * dt; py += vy * dt;
  moving = Math.abs(vx) + Math.abs(vy) > 24;
  if (moving) dir = Math.atan2(vy, vx);
  px = clamp(px, 30, MAP_W - 30); py = clamp(py, 30, MAP_H - 30);
  // fountain collision
  var fd = dist(px, py, 800, 500);
  if (fd < 74 && fd > 0.01) { px = 800 + (px - 800) / fd * 74; py = 500 + (py - 500) / fd * 74; }
  // my render state
  var mp = players[me];
  if (mp) { mp.x = px; mp.y = py; mp.tx = px; mp.ty = py; mp.dir = dir; mp.vc = vcOn; mp.talk = talkNow; }
  // remotes ease toward targets
  Object.keys(players).forEach(function (u) {
    if (u === me) return;
    var p = players[u];
    var k = Math.min(1, dt * 7);
    p.x = lerp(p.x, p.tx, k); p.y = lerp(p.y, p.ty, k);
  });
  // portal proximity
  var near = null;
  for (var i = 0; i < PORTALS.length; i++) { if (dist(px, py, PORTALS[i].x, PORTALS[i].y) < 48) { near = PORTALS[i]; break; } }
  var chip = $('wportal');
  if (near) {
    if (insidePad !== near) { insidePad = near; chip.hidden = false; chip.textContent = 'enter ' + near.label + ' →'; chip.style.borderColor = near.c; chip.style.boxShadow = '0 0 26px ' + near.c + '66'; }
  } else { insidePad = ''; chip.hidden = true; }
  $('wwish').hidden = dist(px, py, 800, 500) > 135;
  // shard proximity -> claim on next ping
  if (!pendingClaim) {
    for (var id in shards) { if (dist(px, py, shards[id].x, shards[id].y) < 34) { pendingClaim = id; claimAt = performance.now(); break; } }
  }
  // camera
  var tx = px + vx * 0.22, ty = py + vy * 0.22;
  cam.x = lerp(cam.x, tx, Math.min(1, dt * 5));
  cam.y = lerp(cam.y, ty, Math.min(1, dt * 5));
  // particles
  parts = parts.filter(function (p) { return now - p.at < p.life; });
  parts.forEach(function (p) { var s = (now - p.at) / 1000; p.x += p.vx * 0.016; p.y += p.vy * 0.016; p.vy += 60 * 0.016; });
  floats = floats.filter(function (f) { return now - f.at < 1400; });
  fires.forEach(function (f) { f.x += Math.cos(f.s + now / 2400) * f.v * dt; f.y += Math.sin(f.s * 1.7 + now / 1900) * f.v * dt * 0.6; if (f.x < 0) f.x = MAP_W; if (f.x > MAP_W) f.x = 0; if (f.y < 0) f.y = MAP_H; if (f.y > MAP_H) f.y = 0; });
  // heart emote particles
  Object.keys(players).forEach(function (u) {
    var p = players[u];
    if (p.emote === 'heart' && now - p.emoteAt < 2400 && Math.random() < 0.25) {
      parts.push({ x: p.x + (Math.random() * 30 - 15), y: p.y - 20, vx: 0, vy: -42, at: now, life: 900, c: '#f472b6', r: 3, heart: true });
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
function drawPlayer(g, p, now, isMe) {
  var x = p.x, y = p.y;
  var emoteAge = now - (p.emoteAt || 0);
  var emote = (p.emote && emoteAge < 2600) ? p.emote : '';
  var bounce = 0, rot = 0;
  if (emote === 'dance') { bounce = Math.abs(Math.sin(now / 130)) * 7; rot = Math.sin(now / 160) * 0.14; }
  if (emote === 'spin') rot = (emoteAge / 700) * TAU;
  if (emote === 'wave') bounce = Math.sin(now / 120) * 1.5;
  if (moving && isMe) bounce = Math.abs(Math.sin(now / 95)) * 2.4;
  if (!isMe && dist(p.x, p.y, p.tx, p.ty) > 4) bounce = Math.abs(Math.sin(now / 95)) * 2.4;
  var by = y - bounce;
  // shadow
  g.fillStyle = 'rgba(0,0,0,.4)';
  g.beginPath(); g.ellipse(x, y + 14, 15, 5.5, 0, 0, TAU); g.fill();
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
    grad.addColorStop(0, 'hsl(' + hue + ',75%,68%)');
    grad.addColorStop(1, 'hsl(' + hue + ',62%,46%)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, 15.5, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.4; g.stroke();
    // face: eyes look toward dir
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
  // name tag
  var fxc = FXC[p.fx || ''] || FXC[''];
  var label = p.npc ? 'six ✦' : p.u;
  g.font = '700 12px Inter, sans-serif';
  var tw = g.measureText(label).width;
  g.fillStyle = 'rgba(5,3,14,.55)';
  rr(g, x - tw / 2 - 7, by - 42, tw + 14, 17, 8); g.fill();
  if (fxc.g) { g.shadowColor = fxc.c; g.shadowBlur = 9; }
  g.fillStyle = p.npc ? '#ffd257' : fxc.c;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, x, by - 33.5);
  g.shadowBlur = 0;
  if (p.vc && !p.npc) {
    g.fillStyle = p.talk ? '#4ade80' : 'rgba(255,255,255,.55)';
    g.beginPath(); g.arc(x + tw / 2 + 13, by - 33.5, 3, 0, TAU); g.fill();
  }
  // bubble
  if (p.bub && now - p.bubAt < 5600) {
    g.font = '500 12.5px Inter, sans-serif';
    var lines = wrapLines(g, p.bub, 148);
    var bw = 0;
    lines.forEach(function (L) { bw = Math.max(bw, g.measureText(L).width); });
    bw += 18;
    var bh = lines.length * 16 + 11;
    var bx = clamp(x - bw / 2, 6, MAP_W - bw - 6), byy = by - 52 - bh;
    var fade = now - p.bubAt > 4800 ? 1 - (now - p.bubAt - 4800) / 800 : 1;
    g.globalAlpha = Math.max(0, fade);
    g.fillStyle = 'rgba(252,252,255,.96)';
    rr(g, bx, byy, bw, bh, 10); g.fill();
    g.beginPath(); g.moveTo(x - 5, byy + bh - 1); g.lineTo(x + 5, byy + bh - 1); g.lineTo(x, byy + bh + 6); g.closePath(); g.fill();
    g.fillStyle = '#171226'; g.textAlign = 'center';
    lines.forEach(function (L, i) { g.fillText(L, bx + bw / 2, byy + 13 + i * 16); });
    g.globalAlpha = 1;
  }
  g.textBaseline = 'alphabetic';
}
function render(now) {
  var g = cx2;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  var bg = g.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, '#0a0518'); bg.addColorStop(1, '#05030d');
  g.fillStyle = bg; g.fillRect(0, 0, VW, VH);
  var camX = clamp(cam.x - VW / 2, 0, Math.max(0, MAP_W - VW));
  var camY = clamp(cam.y - VH / 2, 0, Math.max(0, MAP_H - VH));
  if (VW >= MAP_W) camX = (MAP_W - VW) / 2;
  if (VH >= MAP_H) camY = (MAP_H - VH) / 2;
  g.save();
  g.translate(-camX, -camY);
  // ground
  g.fillStyle = '#150f2e'; g.fillRect(0, 0, MAP_W, MAP_H);
  g.fillStyle = 'rgba(255,255,255,.022)';
  for (var tx = 0; tx < MAP_W / 80; tx++) for (var ty = 0; ty < MAP_H / 80; ty++) {
    if ((tx + ty) % 2 === 0) g.fillRect(tx * 80, ty * 80, 80, 80);
  }
  g.strokeStyle = 'rgba(139,124,255,.05)'; g.lineWidth = 1;
  g.beginPath();
  for (var gx = 0; gx <= MAP_W; gx += 80) { g.moveTo(gx, 0); g.lineTo(gx, MAP_H); }
  for (var gy = 0; gy <= MAP_H; gy += 80) { g.moveTo(0, gy); g.lineTo(MAP_W, gy); }
  g.stroke();
  g.strokeStyle = 'rgba(139,124,255,.35)'; g.lineWidth = 2.5; g.strokeRect(1, 1, MAP_W - 2, MAP_H - 2);
  // lamp glows + string lights
  LAMPS.forEach(function (L) {
    var rg = g.createRadialGradient(L.x, L.y, 4, L.x, L.y, 120);
    rg.addColorStop(0, 'rgba(255,214,150,.13)'); rg.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(L.x, L.y, 120, 0, TAU); g.fill();
  });
  g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 1;
  for (var li = 0; li < LAMPS.length; li++) {
    for (var lj = li + 1; lj < LAMPS.length; lj++) {
      var A = LAMPS[li], B = LAMPS[lj], d = dist(A.x, A.y, B.x, B.y);
      if (d > 430) continue;
      g.beginPath(); g.moveTo(A.x, A.y - 26);
      g.quadraticCurveTo((A.x + B.x) / 2, (A.y + B.y) / 2 - 6, B.x, B.y - 26); g.stroke();
      for (var s2 = 1; s2 < 7; s2++) {
        var t = s2 / 7, qx = (1 - t) * (1 - t) * A.x + 2 * (1 - t) * t * ((A.x + B.x) / 2) + t * t * B.x;
        var qy = (1 - t) * (1 - t) * (A.y - 26) + 2 * (1 - t) * t * ((A.y + B.y) / 2 - 6) + t * t * (B.y - 26);
        g.fillStyle = (s2 % 2) ? 'rgba(255,205,120,.85)' : 'rgba(183,168,255,.85)';
        g.beginPath(); g.arc(qx, qy, 1.8, 0, TAU); g.fill();
      }
    }
  }
  LAMPS.forEach(function (L) {
    g.fillStyle = '#241a45'; g.fillRect(L.x - 2.5, L.y - 26, 5, 26);
    g.fillStyle = '#ffd9a0'; g.shadowColor = '#ffca7a'; g.shadowBlur = 12;
    g.beginPath(); g.arc(L.x, L.y - 29, 4.4, 0, TAU); g.fill(); g.shadowBlur = 0;
  });
  // fountain + moon orb
  g.fillStyle = '#1d1440';
  g.beginPath(); g.arc(800, 500, 66, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(183,168,255,.4)'; g.lineWidth = 2; g.stroke();
  var wg = g.createRadialGradient(800, 500, 4, 800, 500, 52);
  wg.addColorStop(0, 'rgba(96,165,250,.5)'); wg.addColorStop(1, 'rgba(59,7,100,.25)');
  g.fillStyle = wg; g.beginPath(); g.arc(800, 500, 52, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(165,243,252,.25)';
  for (var wr = 0; wr < 3; wr++) {
    g.beginPath(); g.arc(800, 500, 14 + wr * 13 + Math.sin(now / 700 + wr) * 2.5, 0, TAU); g.stroke();
  }
  var mg = g.createRadialGradient(800, 488, 2, 800, 488, 60);
  mg.addColorStop(0, 'rgba(240,240,255,.5)'); mg.addColorStop(1, 'rgba(240,240,255,0)');
  g.fillStyle = mg; g.beginPath(); g.arc(800, 488, 60, 0, TAU); g.fill();
  g.fillStyle = '#f4f2ff'; g.shadowColor = '#dcd6ff'; g.shadowBlur = 24;
  g.beginPath(); g.arc(800, 488, 13 + Math.sin(now / 900) * 1.2, 0, TAU); g.fill(); g.shadowBlur = 0;
  // portal pads
  PORTALS.forEach(function (pad) {
    var pulse = 1 + Math.sin(now / 480 + pad.x) * 0.05;
    g.save(); g.translate(pad.x, pad.y); g.scale(1, 0.42);
    g.strokeStyle = pad.c; g.globalAlpha = 0.9; g.lineWidth = 3.4;
    g.shadowColor = pad.c; g.shadowBlur = 16;
    g.beginPath(); g.arc(0, 0, 40 * pulse, now / 900, now / 900 + Math.PI * 1.5); g.stroke();
    g.beginPath(); g.arc(0, 0, 31 * pulse, -now / 700, -now / 700 + Math.PI * 1.2); g.stroke();
    g.shadowBlur = 0; g.globalAlpha = 0.16; g.fillStyle = pad.c;
    g.beginPath(); g.arc(0, 0, 38, 0, TAU); g.fill();
    g.restore();
    g.fillStyle = pad.c; g.font = '800 13.5px Inter, sans-serif'; g.textAlign = 'center';
    g.shadowColor = pad.c; g.shadowBlur = 8;
    g.fillText(pad.label, pad.x, pad.y - 34);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(243,239,255,.55)'; g.font = '600 10.5px Inter, sans-serif';
    g.fillText(pad.sub, pad.x, pad.y + 34);
  });
  // shards
  Object.keys(shards).forEach(function (id) {
    var s = shards[id];
    var bob = Math.sin(now / 420 + s.seed) * 4;
    var y = s.y + bob;
    g.save(); g.translate(s.x, y);
    if (s.gold) {
      g.shadowColor = '#ffd257'; g.shadowBlur = 26;
      g.fillStyle = '#ffd257';
      star4(g, 0, 0, 13 + Math.sin(now / 200) * 1.6, now / 500); g.fill();
      g.fillStyle = '#fff3c4'; star4(g, 0, 0, 6.5, -now / 500); g.fill();
    } else {
      g.shadowColor = '#7dd3fc'; g.shadowBlur = 13;
      g.fillStyle = '#a5f3fc';
      g.rotate(now / 800 + s.seed);
      g.fillRect(-5.4, -5.4, 10.8, 10.8);
    }
    g.restore();
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(s.x, s.y + 12, 8, 3, 0, 0, TAU); g.fill();
  });
  // fireflies
  fires.forEach(function (f) {
    var tw = 0.35 + 0.65 * Math.abs(Math.sin(now / 800 + f.s * 3));
    g.fillStyle = 'rgba(190,242,160,' + (0.5 * tw) + ')';
    g.beginPath(); g.arc(f.x, f.y, 1.7, 0, TAU); g.fill();
  });
  // players sorted by y
  var list = Object.keys(players).map(function (u) { return players[u]; });
  list.sort(function (a, b) { return a.y - b.y; });
  list.forEach(function (p) { drawPlayer(g, p, now, p.u === me); });
  // particles
  parts.forEach(function (p) {
    var age = (now - p.at) / p.life;
    g.globalAlpha = Math.max(0, 1 - age);
    g.fillStyle = p.c;
    if (p.heart) {
      g.font = '11px Inter'; g.textAlign = 'center';
      g.fillText('♥', p.x, p.y - age * 26);
    } else {
      g.beginPath(); g.arc(p.x, p.y, p.r * (1 - age * 0.5), 0, TAU); g.fill();
    }
  });
  g.globalAlpha = 1;
  // floats
  g.font = '800 14px Inter, sans-serif'; g.textAlign = 'center';
  floats.forEach(function (f) {
    var age = (now - f.at) / 1400;
    g.globalAlpha = Math.max(0, 1 - age);
    g.fillStyle = f.c;
    g.fillText(f.text, f.x, f.y - age * 42);
  });
  g.globalAlpha = 1;
  g.restore();
  // vignette
  var vg = g.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.42, VW / 2, VH / 2, Math.max(VW, VH) * 0.78);
  vg.addColorStop(0, 'rgba(3,1,9,0)'); vg.addColorStop(1, 'rgba(3,1,9,.5)');
  g.fillStyle = vg; g.fillRect(0, 0, VW, VH);
  drawMap();
}
function drawMap() {
  if (!mapCx) return;
  var g = mapCx, W = 168, H = 105, sx = W / MAP_W, sy = H / MAP_H;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(16,10,34,.85)'; g.fillRect(0, 0, W, H);
  PORTALS.forEach(function (pad) { g.fillStyle = pad.c; g.beginPath(); g.arc(pad.x * sx, pad.y * sy, 2.6, 0, TAU); g.fill(); });
  Object.keys(shards).forEach(function (id) { var s = shards[id]; g.fillStyle = s.gold ? '#ffd257' : 'rgba(165,243,252,.8)'; g.fillRect(s.x * sx - 1, s.y * sy - 1, 2, 2); });
  Object.keys(players).forEach(function (u) {
    var p = players[u];
    g.fillStyle = p.npc ? '#ffd257' : (u === me ? '#ffffff' : 'rgba(200,190,255,.75)');
    g.beginPath(); g.arc(p.x * sx, p.y * sy, u === me ? 3 : 2.2, 0, TAU); g.fill();
  });
}
function loop(now) {
  update(now);
  render(now);
  requestAnimationFrame(loop);
}

/* ---------------- boot ---------------- */
fetch('/auth/me').then(function (r) { return r.json(); }).then(function (o) {
  if (!o || !o.user) { $('wlogin').hidden = false; return; }
  me = o.user;
  players[me] = { u: me, x: px, y: py, tx: px, ty: py, dir: dir, fx: '', vc: false, talk: false, bub: '', bubAt: 0, emote: '', emoteAt: 0, npc: false };
  started = true;
  ping();
  requestAnimationFrame(loop);
  setTimeout(function () { toast('walk with wasd or the joystick · shards pay coins · six gives quests'); }, 600);
}).catch(function () { $('wlogin').hidden = false; });
window.addEventListener('beforeunload', function () {
  try { navigator.sendBeacon('/api/world/leave', new Blob(['{}'], { type: 'application/json' })); } catch (e) { }
});
})();
