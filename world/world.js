'use strict';
/*
 * world.js — THE WORLD for 6ixNetworks: a walkable moonlit plaza game that
 * is the site's front door. Everything world-related lives in this folder
 * (world/world.js + world/client.js + world/world.css) so it can be lifted
 * out of the monolith cleanly. server.js only wires it up:
 *
 *   const WORLD = require('./world/world.js').createWorld({...ctx});
 *   if (await WORLD.api(req, res, u)) return;          // /api/world/*
 *   if (u.pathname === '/world') ... res.end(WORLD.page());
 *
 * The game: moon shards rain on the plaza — walk over them for coins.
 * Golden shards spawn on a timer and pay big. Six (the NPC) wanders the
 * plaza handing out an endless chain of daily quests (collect / visit /
 * chat / walk / emote) that pay coins on completion. Proximity voice chat
 * rides WebRTC with signaling mailboxes in here. Avatars wear the name fx
 * the user bought in the site shop (ctx.getFx).
 *
 * State is in-memory only (presence, shards, quests, stats, signaling),
 * exactly like party rooms: a server restart resets the plaza. Nothing
 * here touches the store directly — coins go through ctx.awardCoins, so
 * the world costs zero extra Upstash ops beyond the normal coin saves.
 *
 * ctx: { voterUser(req), readJsonBody(req), getFx(user)->fxId|'',
 *        awardCoins(user, n)->Promise<bal>, scoreDay()->'YYYY-MM-DD',
 *        FONT_LINKS, GALAXY_CSS, SIDEBAR_HTML, STAR_CANVAS, NOTIF_JS }
 */
const fs = require('fs');
const path = require('path');

const MAP_W = 1600;
const MAP_H = 1000;
const STALE_MS = 7000;
const SHARD_TARGET = 12;
const SHARD_PAY = 3;
const GOLD_PAY = 25;
const GOLD_EVERY_MS = 240000;
const GOLD_LIFE_MS = 45000;

const QUEST_POOL = [
  { id: 'shards5', kind: 'shard', n: 5, pay: 40, t: 'collect 5 moon shards' },
  { id: 'shards12', kind: 'shard', n: 12, pay: 90, t: 'collect 12 moon shards' },
  { id: 'portals3', kind: 'portal', n: 3, pay: 35, t: 'step on 3 different portals' },
  { id: 'chat4', kind: 'say', n: 4, pay: 30, t: 'say 4 things in the plaza' },
  { id: 'walk1400', kind: 'walk', n: 1400, pay: 45, t: 'walk 1400 steps around the plaza' },
  { id: 'gold1', kind: 'gold', n: 1, pay: 60, t: 'grab a golden shard' },
  { id: 'emote3', kind: 'emote', n: 3, pay: 25, t: 'use 3 emotes' },
  { id: 'shards20', kind: 'shard', n: 20, pay: 140, t: 'collect 20 moon shards' },
];

const SIX_LINES = [
  'the moon pays those who wander ✦',
  'golden shards? blink and they are gone',
  'portals are just doors that glow',
  'u new here? walk. talk. collect.',
  'the arcade owes me money btw',
  'say hi to someone. quest or not.',
  'this plaza never sleeps. neither do i',
  'name fx looks good on u. the shop did that',
];
const SIX_PATH = [
  { x: 800, y: 360 }, { x: 1150, y: 470 }, { x: 800, y: 660 }, { x: 450, y: 470 },
];

// Six's position is a pure function of time: walk each leg in 9s, pause
// 2.6s, loop. No server tick needed and every client sees the same Six.
function sixState(now) {
  const leg = 9000, pause = 2600, cyc = (leg + pause) * SIX_PATH.length;
  const t = now % cyc;
  const i = Math.floor(t / (leg + pause));
  const lt = t - i * (leg + pause);
  const a = SIX_PATH[i], b = SIX_PATH[(i + 1) % SIX_PATH.length];
  let x, y, moving = false;
  if (lt < leg) {
    const k = lt / leg, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    x = a.x + (b.x - a.x) * e; y = a.y + (b.y - a.y) * e; moving = true;
  } else { x = b.x; y = b.y; }
  const dir = Math.atan2(b.y - a.y, b.x - a.x);
  const lineIdx = Math.floor(now / 12000) % SIX_LINES.length;
  return {
    u: 'six', npc: true, x: Math.round(x), y: Math.round(y), dir, fx: 'galaxy',
    vc: false, talk: false, bub: moving ? '' : SIX_LINES[lineIdx],
  };
}

function createWorld(ctx) {
  const CSS = fs.readFileSync(path.join(__dirname, 'world.css'), 'utf8');
  const CLIENT = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');

  const P = new Map();      // user -> {x,y,dir,at,bub,bubAt,vc,talk,fx,emote,emoteTs,lx,ly}
  const SIG = new Map();    // user -> [{from, data, at}]
  const SAY_AT = new Map(); // user -> last say ts
  const STATS = new Map();  // user -> {day, shards, golds}
  const QUEST = new Map();  // user -> {day, qi, prog, chain, seen:Set}
  let shards = [];          // {id,x,y,gold,born}
  let shardSeq = 1;
  let nextGoldAt = Date.now() + 90000;

  const clampN = (v, lo, hi) => { v = Number(v); if (!isFinite(v)) v = lo; return Math.max(lo, Math.min(hi, v)); };
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

  function spawnPos() {
    for (let i = 0; i < 24; i++) {
      const x = 70 + Math.random() * (MAP_W - 140);
      const y = 70 + Math.random() * (MAP_H - 140);
      if (dist(x, y, 800, 500) < 110) continue; // not in the fountain
      return { x: Math.round(x), y: Math.round(y) };
    }
    return { x: 200, y: 200 };
  }
  function fillShards(now) {
    shards = shards.filter((s) => !s.gold || now - s.born < GOLD_LIFE_MS);
    let normal = shards.filter((s) => !s.gold).length;
    while (normal < SHARD_TARGET) {
      const p = spawnPos();
      shards.push({ id: 's' + (shardSeq++), x: p.x, y: p.y, gold: false, born: now });
      normal++;
    }
    if (now >= nextGoldAt) {
      const p = spawnPos();
      shards.push({ id: 'g' + (shardSeq++), x: p.x, y: p.y, gold: true, born: now });
      nextGoldAt = now + GOLD_EVERY_MS;
    }
  }

  function statsFor(user) {
    const day = ctx.scoreDay();
    let s = STATS.get(user);
    if (!s || s.day !== day) { s = { day, shards: 0, golds: 0 }; STATS.set(user, s); }
    return s;
  }
  function questFor(user) {
    const day = ctx.scoreDay();
    let q = QUEST.get(user);
    if (!q || q.day !== day) {
      let h = 0; const seed = user + day;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      q = { day, qi: h % QUEST_POOL.length, prog: 0, chain: 0, seen: new Set() };
      QUEST.set(user, q);
    }
    return q;
  }
  function questView(user) {
    const q = questFor(user);
    const def = QUEST_POOL[q.qi];
    return { t: def.t, prog: Math.min(q.prog, def.n), n: def.n, pay: def.pay + q.chain * 10, chain: q.chain };
  }
  // feed a game event into the user's quest; returns {done, pay} or null
  function questEvent(user, kind, key) {
    const q = questFor(user);
    const def = QUEST_POOL[q.qi];
    if (def.kind !== kind) return null;
    if (kind === 'portal') {
      if (q.seen.has(key)) return null;
      q.seen.add(key);
      q.prog = q.seen.size;
    } else if (kind === 'walk') {
      q.prog += key; // key carries distance units here
    } else {
      q.prog += 1;
    }
    if (q.prog >= def.n) {
      const pay = def.pay + q.chain * 10;
      q.chain += 1;
      q.qi = (q.qi + 3) % QUEST_POOL.length;
      q.prog = 0;
      q.seen = new Set();
      return { done: true, pay, t: def.t };
    }
    return null;
  }

  function prune(now) {
    for (const [u, p] of P) if (now - p.at > STALE_MS) { P.delete(u); SIG.delete(u); }
  }
  function roster(now) {
    const out = [sixState(now)];
    for (const [u, p] of P) {
      out.push({
        u, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, fx: p.fx || '',
        vc: !!p.vc, talk: !!p.talk,
        bub: (p.bub && now - p.bubAt < 6000) ? p.bub : '',
        emote: (p.emote && now - (p.emoteAt || 0) < 2600) ? p.emote : '',
      });
    }
    return out;
  }
  function leaderboard() {
    const day = ctx.scoreDay();
    const rows = [];
    for (const [u, s] of STATS) if (s.day === day && s.shards > 0) rows.push({ u, n: s.shards });
    rows.sort((a, b) => b.n - a.n);
    return rows.slice(0, 5);
  }

  async function api(req, res, u) {
    if (!u.pathname.startsWith('/api/world/')) return false;
    const J = (o, code) => { res.writeHead(code || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); return true; };
    const me = ctx.voterUser(req);
    if (!me) { J({ ok: false, err: 'log in first' }, 401); return true; }
    let b = {};
    if (req.method === 'POST') { try { b = (await ctx.readJsonBody(req)) || {}; } catch { b = {}; } }
    const now = Date.now();
    prune(now);
    fillShards(now);

    if (u.pathname === '/api/world/ping' && req.method === 'POST') {
      let p = P.get(me);
      if (!p) { p = { x: 800, y: 580, dir: 0, at: now, bub: '', bubAt: 0, vc: false, talk: false, fx: '', emote: '', emoteTs: 0, emoteAt: 0, lx: 800, ly: 580 }; P.set(me, p); }
      const ox = p.x, oy = p.y;
      if (b.x != null) p.x = clampN(b.x, 24, MAP_W - 24);
      if (b.y != null) p.y = clampN(b.y, 24, MAP_H - 24);
      if (b.dir != null) p.dir = clampN(b.dir, -Math.PI * 2, Math.PI * 2);
      p.vc = !!b.vc;
      p.talk = !!b.talk;
      p.at = now;
      try { p.fx = ctx.getFx(me) || ''; } catch { p.fx = ''; }
      let questDone = null;
      // walking feeds the walk quest (delta capped so teleports don't farm)
      const moved = dist(ox, oy, p.x, p.y);
      if (moved > 1 && moved < 340) questDone = questEvent(me, 'walk', Math.round(moved)) || questDone;
      // emotes: a fresh emote timestamp counts once
      if (b.emote && b.emoteTs && b.emoteTs !== p.emoteTs) {
        p.emote = String(b.emote).slice(0, 12); p.emoteTs = b.emoteTs; p.emoteAt = now;
        questDone = questEvent(me, 'emote') || questDone;
      }
      // shard claim: server validates the distance, then pays
      let got = null;
      if (b.claim) {
        const i = shards.findIndex((s) => s.id === String(b.claim));
        if (i >= 0 && dist(p.x, p.y, shards[i].x, shards[i].y) < 70) {
          const s = shards[i];
          shards.splice(i, 1);
          const st = statsFor(me);
          st.shards += 1;
          if (s.gold) st.golds += 1;
          const amt = s.gold ? GOLD_PAY : SHARD_PAY;
          let bal = null;
          try { bal = await ctx.awardCoins(me, amt); } catch { }
          got = { amt, gold: !!s.gold, bal };
          questDone = questEvent(me, 'shard') || questDone;
          if (s.gold) questDone = questEvent(me, 'gold') || questDone;
          fillShards(now);
        }
      }
      if (questDone && questDone.done) {
        let bal = null;
        try { bal = await ctx.awardCoins(me, questDone.pay); } catch { }
        questDone.bal = bal;
      }
      const sig = SIG.get(me) || [];
      SIG.delete(me);
      const st = statsFor(me);
      J({
        ok: true, me, players: roster(now), sig, n: P.size + 1,
        shards: shards.map((s) => ({ id: s.id, x: s.x, y: s.y, gold: s.gold })),
        lb: leaderboard(), quest: questView(me),
        today: { shards: st.shards, golds: st.golds },
        got, questDone,
      });
      return true;
    }

    if (u.pathname === '/api/world/say' && req.method === 'POST') {
      const last = SAY_AT.get(me) || 0;
      if (now - last < 700) { J({ ok: false, err: 'slow down' }); return true; }
      const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!text) { J({ ok: false, err: 'empty' }); return true; }
      SAY_AT.set(me, now);
      let p = P.get(me);
      if (!p) { p = { x: 800, y: 580, dir: 0, at: now, bub: '', bubAt: 0, vc: false, talk: false, fx: '', emote: '', emoteTs: 0, emoteAt: 0, lx: 800, ly: 580 }; P.set(me, p); }
      p.bub = text; p.bubAt = now; p.at = now;
      const qd = questEvent(me, 'say');
      let bal = null;
      if (qd && qd.done) { try { bal = await ctx.awardCoins(me, qd.pay); } catch { } }
      J({ ok: true, questDone: qd ? { done: true, pay: qd.pay, t: qd.t, bal } : null, quest: questView(me) });
      return true;
    }

    if (u.pathname === '/api/world/portal' && req.method === 'POST') {
      const id = String(b.id || '').slice(0, 20);
      const qd = id ? questEvent(me, 'portal', id) : null;
      let bal = null;
      if (qd && qd.done) { try { bal = await ctx.awardCoins(me, qd.pay); } catch { } }
      J({ ok: true, questDone: qd ? { done: true, pay: qd.pay, t: qd.t, bal } : null, quest: questView(me) });
      return true;
    }

    if (u.pathname === '/api/world/signal' && req.method === 'POST') {
      const to = String(b.to || '');
      if (!to || to === me || !P.has(to) || b.data == null) { J({ ok: false }); return true; }
      let arr = SIG.get(to);
      if (!arr) { arr = []; SIG.set(to, arr); }
      arr.push({ from: me, data: b.data, at: now });
      if (arr.length > 60) arr.splice(0, arr.length - 60);
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/leave' && req.method === 'POST') {
      P.delete(me); SIG.delete(me);
      J({ ok: true });
      return true;
    }

    J({ ok: false, err: 'unknown' }, 404);
    return true;
  }

  function page() {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
      '<title>the world — 6ixnetworks</title>\n' + ctx.FONT_LINKS +
      '\n<style>' + ctx.GALAXY_CSS + '</style>\n<style>' + CSS + '</style>\n</head>\n<body>\n' +
      ctx.STAR_CANVAS + '\n' + ctx.SIDEBAR_HTML + '\n' +
      '<canvas id="wcv"></canvas>\n' +
      '<div id="whud">\n' +
      '  <div class="wleft">\n' +
      '    <div class="wbrand">✦ the world <span id="wn"></span></div>\n' +
      '    <div id="wquest" hidden><div class="wq-t"></div><div class="wq-bar"><i></i></div><div class="wq-s"></div></div>\n' +
      '    <div id="wlb" hidden></div>\n' +
      '  </div>\n' +
      '  <div class="wbtns">\n' +
      '    <button id="wmic" type="button" title="voice chat"></button>\n' +
      '    <a class="wleave" href="/home" title="leave">✕</a>\n' +
      '  </div>\n</div>\n' +
      '<canvas id="wmap" width="168" height="105"></canvas>\n' +
      '<div id="wtoast" hidden></div>\n' +
      '<div id="wlog"></div>\n' +
      '<button id="wportal" type="button" hidden></button>\n' +
      '<div id="wemotes">\n' +
      '  <button type="button" data-em="wave">wave</button>\n' +
      '  <button type="button" data-em="dance">dance</button>\n' +
      '  <button type="button" data-em="spin">spin</button>\n' +
      '  <button type="button" data-em="heart">hearts</button>\n' +
      '  <button type="button" data-em="dead">dead</button>\n' +
      '</div>\n' +
      '<form id="wbar" autocomplete="off">\n' +
      '  <input id="win" type="text" maxlength="120" placeholder="say something…" enterkeyhint="send">\n' +
      '  <button id="wsend" type="submit">send</button>\n</form>\n' +
      '<div id="wjoy"><div id="wknob"></div></div>\n' +
      '<div id="wlogin" hidden><div class="wl-card"><div class="wl-big">the world is for the logged-in</div>' +
      '<p>make an account or log in, then walk in. collect moon shards, run quests for six, wear ur name fx.</p>' +
      '<a class="wl-btn" href="/home">go log in</a></div></div>\n' +
      '<script>' + ctx.NOTIF_JS + '</script>\n' +
      '<script>' + CLIENT + '</script>\n' +
      '</body>\n</html>';
  }

  return { api, page };
}

module.exports = { createWorld };
