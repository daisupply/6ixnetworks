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
 * here touches the store directly — six cents (the world-only currency, NOT
 * site coins) go through ctx.awardCents, so
 * the world costs zero extra Upstash ops beyond the normal coin saves.
 *
 * ctx: { voterUser(req), readJsonBody(req), getFx(user)->fxId|'',
 *        awardCents(user, n)->Promise<bal>, getCents(user)->int,
 *        getInv/setInv, getWear/setWear, scoreDay()->'YYYY-MM-DD',
 *        FONT_LINKS, GALAXY_CSS, SIDEBAR_HTML, STAR_CANVAS, NOTIF_JS }
 */
const fs = require('fs');
const path = require('path');

const MAP_W = 4800;
const MAP_H = 3000;
const STALE_MS = 7000;
const SHARD_TARGET = 40;
const SHARD_PAY = 3;
const GOLD_PAY = 25;
const GOLD_EVERY_MS = 240000;
const GOLD_LIFE_MS = 45000;

const QUESTS = require('./quests.js');
const GAMES_MOD = require('./games.js');
const SHOP = require('./shop.js');

const ZONES = [
  { id: 'fountain', name: 'the fountain', x: 2400, y: 1500, r: 125 },
  { id: 'stage', name: 'the stage', x: 2400, y: 1905, r: 140 },
  { id: 'arcade', name: 'the arcade', x: 1780, y: 1215, r: 140 },
  { id: 'theater', name: 'the theater', x: 3020, y: 1215, r: 140 },
  { id: 'lounge', name: 'the chat lounge', x: 1710, y: 1500, r: 125 },
  { id: 'party', name: 'the party house', x: 3090, y: 1500, r: 125 },
  { id: 'tube', name: 'tube corner', x: 1780, y: 1800, r: 135 },
  { id: 'tiktok', name: 'the tiktok wall', x: 3020, y: 1800, r: 135 },
  { id: 'blox', name: 'blox tower', x: 2400, y: 1120, r: 125 },
  { id: 'garden', name: 'the lamp garden', x: 700, y: 900, r: 230 },
  { id: 'overlook', name: 'the east overlook', x: 3400, y: 750, r: 210 },
  { id: 'spawn', name: 'spawn plaza', x: 2400, y: 1700, r: 140 },
  { id: 'lake', name: 'the moonlit lake', x: 2400, y: 2620, r: 400 },
  { id: 'pier', name: 'the pier', x: 2400, y: 2400, r: 170 },
  { id: 'forest', name: 'the pine forest', x: 650, y: 2100, r: 400 },
  { id: 'market', name: 'neon market', x: 3950, y: 1600, r: 330 },
  { id: 'heights', name: 'blox heights', x: 3950, y: 480, r: 260 },
];

const FORTUNES = [
  'the moon saw ur wish. it is thinking about it',
  'a golden shard is coming for u. be ready',
  'someone in the plaza is about to make ur day',
  'ur next quest pays more than u think',
  'the lamps hum ur name tonight',
  'walk east. trust me',
  'a stranger will say hi. say hi back',
  'ur luck stat went up by exactly one vibe',
  'the fountain keeps ur coin. the moon keeps ur secret',
  'tonight the plaza feels like home because u are in it',
  'six owes u one. he will not say for what',
  'a dance is never wasted',
  'the fireflies voted: ur fit is fine',
  'something small and good is on its way',
  'ur shards miss u when u log off',
  'the theater will play exactly what u need soon',
  'wish again sometime. the moon likes ur voice',
  'an old friend is about to log in',
  'the stage lights look good on u. go stand there',
  'ur next golden shard is closer than u think',
  'the fountain says: patience, then sparkle',
  'somewhere, a portal u have not tried is waiting',
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
  { x: 2400, y: 1330 }, { x: 3950, y: 1600 }, { x: 3900, y: 620 }, { x: 2400, y: 1100 },
  { x: 700, y: 900 }, { x: 650, y: 2100 }, { x: 2400, y: 2560 }, { x: 2900, y: 1700 },
];

// Six's position is a pure function of time: walk each leg in 9s, pause
// 2.6s, loop. No server tick needed and every client sees the same Six.
function sixState(now) {
  const leg = 15000, pause = 2600, cyc = (leg + pause) * SIX_PATH.length;
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
    wear: { trail: { kind: 'star', c: '#c4b5fd' }, hat: { kind: 'crown', c: '#ffd257' }, aura: { kind: 'spin', c: '#8b7cff' }, pet: { kind: 'star', c: '#ffd257' } },
  };
}

function createWorld(ctx) {
  const CSS = fs.readFileSync(path.join(__dirname, 'world.css'), 'utf8');
  const CLIENT = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');

  const P = new Map();      // user -> {x,y,dir,at,bub,bubAt,vc,talk,fx,emote,emoteTs,lx,ly}
  const SIG = new Map();    // user -> [{from, data, at}]
  const SAY_AT = new Map(); // user -> last say ts
  const WISH_AT = new Map(); // user -> last wish ts
  const lastMini = new Map(); // user -> ts (miniscore rate limit)
  const MGPLAY = new Map(); // user -> { day, plays: { gameId: n } } (paid plays per game/day)
  const STATS = new Map();  // user -> {day, shards, golds}
  const QUEST = new Map();  // user -> {day, qi, prog, chain, seen:Set}
  let shards = [];          // {id,x,y,gold,born}
  let shardSeq = 1;
  let nextGoldAt = Date.now() + 90000;

  const clampN = (v, lo, hi) => { v = Number(v); if (!isFinite(v)) v = lo; return Math.max(lo, Math.min(hi, v)); };
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  function zoneAt(x, y) {
    let best = '', bs = Infinity;
    for (const z of ZONES) { const d = dist(x, y, z.x, z.y); if (d < z.r && d - z.r < bs) { bs = d - z.r; best = z.id; } }
    return best;
  }
  function zoneName(id) { const z = ZONES.find((v) => v.id === id); return z ? z.name : ''; }

  function spawnPos() {
    for (let i = 0; i < 24; i++) {
      const x = 70 + Math.random() * (MAP_W - 140);
      const y = 70 + Math.random() * (MAP_H - 140);
      if (dist(x, y, 2400, 1500) < 110) continue; // not in the fountain
      return { x: Math.round(x), y: Math.round(y) };
    }
    return { x: 300, y: 300 };
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
      q = { day, qi: h % QUESTS.length, prog: 0, chain: 0, seen: new Set() };
      QUEST.set(user, q);
    }
    return q;
  }
  function questView(user) {
    const q = questFor(user);
    const def = QUESTS[q.qi];
    return { id: def.id, t: def.t, prog: Math.min(Math.floor(q.prog), def.n), n: def.n, pay: def.pay + q.chain * 10, chain: q.chain };
  }
  // feed a game event into the user's quest; returns {done, pay} or null.
  // key: portal/zone/meet carry an id (distinct-set or specific target),
  // emote carries the emote id, walk/vc carry an amount.
  function questEvent(user, kind, key) {
    const q = questFor(user);
    const def = QUESTS[q.qi];
    if (def.kind !== kind) return null;
    if (kind === 'portal' || kind === 'meet' || (kind === 'zone' && !def.zone)) {
      if (q.seen.has(key)) return null;
      q.seen.add(key);
      q.prog = q.seen.size;
    } else if (kind === 'zone') {
      if (def.zone !== key) return null;
      q.prog += 1;
    } else if (kind === 'emote') {
      if (def.emote && def.emote !== key) return null;
      q.prog += 1;
    } else if (kind === 'walk' || kind === 'vc') {
      q.prog += key;
    } else {
      q.prog += 1;
    }
    if (q.prog >= def.n) {
      const pay = def.pay + q.chain * 10;
      q.chain += 1;
      q.qi = (q.qi + 137 + q.chain * 31) % QUESTS.length;
      q.prog = 0;
      q.seen = new Set();
      return { done: true, pay, t: def.t };
    }
    return null;
  }

  function prune(now) {
    for (const [u, p] of P) if (now - p.at > STALE_MS) { P.delete(u); SIG.delete(u); }
  }
  function wearOf(u) {
    const out = { trail: null, hat: null, aura: null, pet: null };
    let w = {};
    try { w = ctx.getWear(u) || {}; } catch { }
    for (const cat of ['trail', 'hat', 'aura', 'pet']) {
      const it = w[cat] && SHOP.BY_ID[w[cat]];
      if (it) out[cat] = { kind: it.kind, c: it.color };
    }
    return out;
  }
  function roster(now) {
    const out = [sixState(now)];
    for (const [u, p] of P) {
      out.push({
        u, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, fx: p.fx || '',
        vc: !!p.vc, talk: !!p.talk,
        bub: (p.bub && now - p.bubAt < 6000) ? p.bub : '',
        emote: (p.emote && now - (p.emoteAt || 0) < 2600) ? p.emote : '',
        wear: p.wear || null,
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
      if (!p) { p = { x: 2400, y: 1700, dir: 0, at: now, bub: '', bubAt: 0, vc: false, talk: false, fx: '', emote: '', emoteTs: 0, emoteAt: 0, lx: 2400, ly: 1700, zone: '' }; P.set(me, p); }
      const ox = p.x, oy = p.y;
      const prevAt = p.at;
      if (b.x != null) p.x = clampN(b.x, 24, MAP_W - 24);
      if (b.y != null) p.y = clampN(b.y, 24, MAP_H - 24);
      if (b.dir != null) p.dir = clampN(b.dir, -Math.PI * 2, Math.PI * 2);
      p.vc = !!b.vc;
      p.talk = !!b.talk;
      p.at = now;
      try { p.fx = ctx.getFx(me) || ''; } catch { p.fx = ''; }
      try { p.wear = wearOf(me); } catch { p.wear = null; }
      let questDone = null;
      // walking feeds the walk quest (delta capped so teleports don't farm)
      const moved = dist(ox, oy, p.x, p.y);
      if (moved > 1 && moved < 560) questDone = questEvent(me, 'walk', Math.round(moved)) || questDone;
      // emotes: a fresh emote timestamp counts once
      if (b.emote && b.emoteTs && b.emoteTs !== p.emoteTs) {
        p.emote = String(b.emote).slice(0, 12); p.emoteTs = b.emoteTs; p.emoteAt = now;
        questDone = questEvent(me, 'emote', p.emote) || questDone;
      }
      // zone entry (distinct spots, or a specific spot for targeted quests)
      const zn = zoneAt(p.x, p.y);
      if (zn && zn !== p.zone) questDone = questEvent(me, 'zone', zn) || questDone;
      p.zone = zn;
      // meeting people: standing close to another player counts them
      if (QUESTS[questFor(me).qi].kind === 'meet') {
        for (const [ou, op] of P) { if (ou !== me && dist(p.x, p.y, op.x, op.y) < 95) questDone = questEvent(me, 'meet', ou) || questDone; }
      }
      // vc time: near another voice-on player, seconds accumulate
      if (p.vc) {
        let nearVc = false;
        for (const [ou, op] of P) { if (ou !== me && op.vc && dist(p.x, p.y, op.x, op.y) < 230) { nearVc = true; break; } }
        if (nearVc) questDone = questEvent(me, 'vc', Math.min(2.5, Math.max(0, (now - prevAt) / 1000))) || questDone;
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
          try { bal = await ctx.awardCents(me, amt); } catch { }
          got = { amt, gold: !!s.gold, bal };
          questDone = questEvent(me, 'shard') || questDone;
          if (s.gold) questDone = questEvent(me, 'gold') || questDone;
          fillShards(now);
        }
      }
      if (questDone && questDone.done) {
        let bal = null;
        try { bal = await ctx.awardCents(me, questDone.pay); } catch { }
        questDone.bal = bal;
      }
      const sig = SIG.get(me) || [];
      SIG.delete(me);
      const st = statsFor(me);
      J({
        ok: true, me, players: roster(now), sig, n: P.size, bal: (() => { try { return ctx.getCents(me); } catch { return null; } })(),
        inv: (() => { try { return ctx.getInv(me); } catch { return []; } })(),
        wearIds: (() => { try { return ctx.getWear(me); } catch { return {}; } })(),
        shards: shards.map((s) => ({ id: s.id, x: s.x, y: s.y, gold: s.gold })),
        lb: leaderboard(), quest: questView(me),
        today: { shards: st.shards, golds: st.golds },
        zone: p.zone ? zoneName(p.zone) : '', got, questDone,
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
      if (!p) { p = { x: 2400, y: 1700, dir: 0, at: now, bub: '', bubAt: 0, vc: false, talk: false, fx: '', emote: '', emoteTs: 0, emoteAt: 0, lx: 2400, ly: 1700, zone: '' }; P.set(me, p); }
      p.bub = text; p.bubAt = now; p.at = now;
      const qd = questEvent(me, 'say');
      let bal = null;
      if (qd && qd.done) { try { bal = await ctx.awardCents(me, qd.pay); } catch { } }
      J({ ok: true, questDone: qd ? { done: true, pay: qd.pay, t: qd.t, bal } : null, quest: questView(me) });
      return true;
    }

    if (u.pathname === '/api/world/portal' && req.method === 'POST') {
      const id = String(b.id || '').slice(0, 20);
      const qd = id ? questEvent(me, 'portal', id) : null;
      let bal = null;
      if (qd && qd.done) { try { bal = await ctx.awardCents(me, qd.pay); } catch { } }
      J({ ok: true, questDone: qd ? { done: true, pay: qd.pay, t: qd.t, bal } : null, quest: questView(me) });
      return true;
    }

    if (u.pathname === '/api/world/miniscore' && req.method === 'POST') {
      const g = GAMES_MOD.BY_ID[String(b.game || '')];
      if (!g) { J({ ok: false, err: 'no such minigame' }, 400); return true; }
      const pts = Math.floor(Number(b.points));
      if (!Number.isFinite(pts) || pts < 0 || pts > g.maxPoints) { J({ ok: false, err: 'score out of range' }, 400); return true; }
      if (now - (lastMini.get(me) || 0) < 10000) { J({ ok: false, err: 'too fast — give it a few seconds' }, 429); return true; }
      lastMini.set(me, now);
      const mday = ctx.scoreDay();
      let rec = MGPLAY.get(me);
      if (!rec || rec.day !== mday) { rec = { day: mday, plays: {} }; MGPLAY.set(me, rec); }
      const used = rec.plays[g.id] || 0;
      let coins = 0, paid = false;
      if (pts > 0 && used < 3) {
        coins = Math.max(1, Math.round(pts / g.maxPoints * g.capCoins));
        rec.plays[g.id] = used + 1;
        paid = true;
        try { await ctx.awardCents(me, coins); } catch { }
      }
      let bal = null;
      try { bal = ctx.getCents(me); } catch { }
      J({ ok: true, cents: coins, paid, playsLeft: Math.max(0, 3 - (rec.plays[g.id] || 0)), bal });
      return true;
    }
    if (u.pathname === '/api/world/shopbuy' && req.method === 'POST') {
      const it = SHOP.BY_ID[String(b.id || '')];
      if (!it) { J({ ok: false, err: 'no such item' }, 400); return true; }
      let inv = [];
      try { inv = ctx.getInv(me); } catch { }
      if (inv.includes(it.id)) { J({ ok: false, err: 'u already own that' }); return true; }
      let bal = 0;
      try { bal = ctx.getCents(me); } catch { }
      if (bal < it.price) { J({ ok: false, err: 'not enough six cents', bal }); return true; }
      try { bal = await ctx.awardCents(me, -it.price); } catch { }
      inv.push(it.id);
      try { ctx.setInv(me, inv); } catch { }
      J({ ok: true, bal, inv });
      return true;
    }
    if (u.pathname === '/api/world/shopequip' && req.method === 'POST') {
      const cat = String(b.cat || '');
      if (!['trail', 'hat', 'aura', 'pet'].includes(cat)) { J({ ok: false, err: 'bad category' }, 400); return true; }
      let wear = {};
      try { wear = ctx.getWear(me); } catch { }
      if (b.id == null || b.id === '') { delete wear[cat]; }
      else {
        const it = SHOP.BY_ID[String(b.id)];
        if (!it || it.cat !== cat) { J({ ok: false, err: 'bad item' }, 400); return true; }
        let owned = false;
        try { owned = ctx.getInv(me).includes(it.id); } catch { }
        if (!owned) { J({ ok: false, err: 'u don\'t own that' }); return true; }
        wear[cat] = it.id;
      }
      try { ctx.setWear(me, wear); } catch { }
      J({ ok: true, wearIds: wear, wear: wearOf(me) });
      return true;
    }
    if (u.pathname === '/api/world/wish' && req.method === 'POST') {
      const p = P.get(me);
      if (!p || dist(p.x, p.y, 2400, 1500) > 130) { J({ ok: false, err: 'stand at the fountain to wish' }); return true; }
      const lastW = WISH_AT.get(me) || 0;
      if (now - lastW < 3000) { J({ ok: false, err: 'the fountain needs a sec' }); return true; }
      let bal0 = 0;
      try { bal0 = ctx.getCents(me); } catch { }
      if (bal0 < 1) { J({ ok: false, err: 'u need 1 coin to wish' }); return true; }
      WISH_AT.set(me, now);
      const jackpot = Math.random() < 0.02;
      let bal = null;
      try { bal = await ctx.awardCents(me, jackpot ? 49 : -1); } catch { }
      J({ ok: true, fortune: FORTUNES[Math.floor(Math.random() * FORTUNES.length)], jackpot, bal });
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
      '<title>six\'s network — 6ixnetworks</title>\n' + ctx.FONT_LINKS +
      '\n<style>' + ctx.GALAXY_CSS + '</style>\n<style>' + CSS + '</style>\n</head>\n<body>\n' +
      ctx.STAR_CANVAS + '\n' + ctx.SIDEBAR_HTML + '\n' +
      '<canvas id="wcv"></canvas>\n' +
      '<div id="whud">\n' +
      '  <div class="wleft">\n' +
      '    <div class="wbrand"><span class="wstar">✦</span> six\'s network <span id="wn"></span></div><span id="wbal">¢ — six cents</span>\n' +
      '    <div id="wquest" hidden><div class="wq-t"></div><div class="wq-bar"><i></i></div><div class="wq-s"></div></div>\n' +
      '    <div id="wlb" hidden></div>\n' +
      '  </div>\n' +
      '  <div class="wbtns">\n' +
      '    <button id="wshopbtn" type="button" title="six cents shop"><span class="wcent">\u00a2</span></button>\n' +
      '    <button id="wgames" type="button" title="minigames"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.2-.022.63-.022 1.41a5 5 0 0 0 8.303 4.743 1 1 0 0 1 .984-.27h.066a1 1 0 0 1 .984.27A5 5 0 0 0 21.32 10c0-.78-.016-1.21-.022-1.41A4 4 0 0 0 17.32 5z"/></svg></button>\n' +
      '    <button id="wmic" type="button" title="voice chat"></button>\n' +
      '    <a class="wleave" href="/home" title="leave">✕</a>\n' +
      '  </div>\n</div>\n' +
      '<canvas id="wmap" width="168" height="105"></canvas>\n' +
      '<div id="wtoast" hidden></div>\n' +
      '<div id="wlog"></div>\n' +
      '<button id="wportal" type="button" hidden></button>\n' +
      '<button id="wact" type="button" hidden><span class="wact-ic"></span><span class="wact-t"></span></button>\n' +
      '<button id="wemotebtn" type="button" title="emotes"></button>\n' +
      '<div id="wemotes" hidden>\n' +
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
      '<button id="wdash" type="button">dash</button>\n' +
      '<div id="warcade" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>✦ the arcade</span><span id="wa-count"></span><button id="wa-x" type="button">✕</button></div>\n' +
      '  <input id="wa-q" type="text" placeholder="search 112 minigames…">\n' +
      '  <div id="wa-list"></div>\n' +
      '</div></div>\n' +
      '<div id="wgame" hidden><div class="wg-card">\n' +
      '  <div class="wg-head"><span id="wg-title"></span><span id="wg-score"></span><button id="wg-x" type="button">✕</button></div>\n' +
      '  <div id="wg-how"></div>\n' +
      '  <div id="wg-stage"></div>\n' +
      '  <div id="wg-result" hidden></div>\n' +
      '</div></div>\n' +
      '<div id="wshop" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 six cents shop</span><span id="wsh-bal"></span><button id="wsh-x" type="button">\u2715</button></div>\n' +
      '  <div class="wsh-note">six cents are earned right here in the world \u2014 shards, quests, minigames. they are NOT site coins.</div>\n' +
      '  <div id="wsh-tabs"></div>\n' +
      '  <div id="wsh-grid"></div>\n' +
      '</div></div>\n' +
      '<div id="wlogin" hidden><div class="wl-card"><div class="wl-big">six\'s network is for the logged-in</div>' +
      '<p>make an account or log in, then walk in. a whole world in here: districts, a lake, a forest, moon shards, quests from six, voice chat.</p>' +
      '<a class="wl-btn" href="/home">go log in</a></div></div>\n' +
      '<script>' + ctx.NOTIF_JS + '</script>\n' +
      '<script>window.WGAMES=' + JSON.stringify(GAMES_MOD.GAMES) + ';window.WCABS=' + JSON.stringify(GAMES_MOD.CABINETS) + ';window.WSHOP=' + JSON.stringify(SHOP.ITEMS) + ';</script>\n' +
      '<script>' + CLIENT + '</script>\n' +
      '</body>\n</html>';
  }

  return { api, page };
}

module.exports = { createWorld };
