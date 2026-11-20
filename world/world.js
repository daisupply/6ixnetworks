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
  try { ctx.wget('__warm'); } catch { } // kick the persistent world-data load early so early writes never race it
  const CSS = fs.readFileSync(path.join(__dirname, 'world.css'), 'utf8');
  const CLIENT = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');

  const P = new Map();      // user -> {x,y,dir,at,bub,bubAt,vc,talk,fx,emote,emoteTs,lx,ly}
  const SIG = new Map();    // user -> [{from, data, at}]
  const SAY_AT = new Map(); // user -> last say ts
  const WISH_AT = new Map(); // user -> last wish ts
  const lastMini = new Map(); // user -> ts (miniscore rate limit)
  const MGPLAY = new Map(); // user -> { day, plays: { gameId: n } } (paid plays per game/day)
  const STATS = new Map();  // user -> {day, shards, golds}
  const DUEL_CH = new Map();   // challenged user -> {from, at}
  const DUELS = new Map();     // id -> {id, a, b, startAt, delay, ra, rb, settled}
  const DUEL_DONE = new Map(); // user -> finished-duel result waiting for their next ping
  const TP_OK = new Set();     // users allowed one server-sanctioned teleport (portals, fast travel)
  const MTOK = new Map();      // minigame play token -> {user, game, at}
  const BUYLOCK = new Set();   // users with a shop purchase in flight
  const PROG = new Map();      // user -> progression record (persisted in cfg:wdata 'prog')
  const LVLUP = new Map();     // user -> {lvl, title} waiting for their next ping
  const ACHNEW = new Map();    // user -> [{name, reward}] waiting for their next ping
  function wload(key, user) { try { const all = ctx.wget(key) || {}; return all[user]; } catch { return undefined; } }
  function wsave(key, user, val) { try { const all = ctx.wget(key) || {}; all[user] = val; ctx.wset(key, all); } catch { } }
  function progFor(user) {
    let pg = PROG.get(user);
    if (!pg) { const sv = wload('prog', user); if (sv && typeof sv === 'object') pg = sv; }
    if (!pg || typeof pg !== 'object') pg = { xp: 0, playSec: 0, zones: [], ach: {}, c: {}, lastDay: '' };
    pg.c = pg.c || {}; pg.ach = pg.ach || {}; pg.zones = pg.zones || [];
    PROG.set(user, pg);
    return pg;
  }
  function progSave(user) { try { wsave('prog', user, progFor(user)); } catch { } }
  function lvlAt(l) { return 60 * (l - 1) * l / 2; }
  function levelOf(xp) { let l = 1; while (lvlAt(l + 1) <= xp) l++; return l; }
  const TITLES = [[18, 'legend'], [12, 'veteran'], [8, 'world traveler'], [5, 'arcade regular'], [3, 'explorer'], [1, 'newcomer']];
  function titleOf(l) { for (const [n, t] of TITLES) if (l >= n) return t; return 'newcomer'; }
  function awardXp(user, amt) {
    if (!amt) return;
    const pg = progFor(user);
    const before = levelOf(pg.xp || 0);
    pg.xp = (pg.xp || 0) + amt;
    const after = levelOf(pg.xp);
    if (after > before) LVLUP.set(user, { lvl: after, title: titleOf(after) });
    progSave(user);
  }
  function progView(user) {
    const pg = progFor(user);
    const lvl = levelOf(pg.xp || 0);
    return { xp: pg.xp || 0, lvl, title: titleOf(lvl), cur: (pg.xp || 0) - lvlAt(lvl), need: lvlAt(lvl + 1) - lvlAt(lvl), playSec: Math.floor(pg.playSec || 0), zones: (pg.zones || []).length, ach: Object.keys(pg.ach || {}).length };
  }
  const ACHS = [
    { id: 'first-steps', name: 'first steps', desc: 'spend a minute inside the world', cat: 'progression', reward: 5, test: (pg) => (pg.playSec || 0) >= 60 },
    { id: 'rising-star', name: 'rising star', desc: 'reach level 5', cat: 'progression', reward: 50, test: (pg) => levelOf(pg.xp || 0) >= 5 },
    { id: 'world-veteran', name: 'world veteran', desc: 'reach level 10', cat: 'progression', reward: 150, test: (pg) => levelOf(pg.xp || 0) >= 10 },
    { id: 'wanderer', name: 'wanderer', desc: 'discover 5 locations', cat: 'exploration', reward: 20, test: (pg) => (pg.zones || []).length >= 5 },
    { id: 'cartographer', name: 'cartographer', desc: 'discover 12 locations', cat: 'exploration', reward: 50, test: (pg) => (pg.zones || []).length >= 12 },
    { id: 'globetrotter', name: 'globetrotter', desc: 'discover 17 locations', cat: 'exploration', reward: 120, test: (pg) => (pg.zones || []).length >= 17 },
    { id: 'marathon', name: 'marathon walker', desc: 'walk 100,000 steps worth of world', cat: 'exploration', reward: 60, test: (pg) => (pg.c.walk || 0) >= 100000 },
    { id: 'shard-starter', name: 'shard starter', desc: 'collect 10 moon shards', cat: 'collection', reward: 10, test: (pg) => (pg.c.shard || 0) >= 10 },
    { id: 'shard-hunter', name: 'shard hunter', desc: 'collect 100 moon shards', cat: 'collection', reward: 40, test: (pg) => (pg.c.shard || 0) >= 100 },
    { id: 'shard-legend', name: 'shard legend', desc: 'collect 500 moon shards', cat: 'collection', reward: 150, test: (pg) => (pg.c.shard || 0) >= 500 },
    { id: 'gold-rush', name: 'gold rush', desc: 'collect 5 golden shards', cat: 'collection', reward: 30, test: (pg) => (pg.c.gold || 0) >= 5 },
    { id: 'gold-hoarder', name: 'gold hoarder', desc: 'collect 25 golden shards', cat: 'collection', reward: 100, test: (pg) => (pg.c.gold || 0) >= 25 },
    { id: 'big-spender', name: 'big spender', desc: 'buy 5 things from the six cents shop', cat: 'collection', reward: 25, test: (pg) => (pg.c.buy || 0) >= 5 },
    { id: 'fashionista', name: 'fashionista', desc: 'own 15 cosmetics', cat: 'collection', reward: 60, test: (pg, h) => h.inv >= 15 },
    { id: 'high-roller', name: 'high roller', desc: 'hold 500 six cents at once', cat: 'collection', reward: 50, test: (pg, h) => h.bal >= 500 },
    { id: 'first-game', name: 'first game', desc: 'finish a paid minigame run', cat: 'arcade', reward: 5, test: (pg) => (pg.c.mini || 0) >= 1 },
    { id: 'arcade-regular', name: 'arcade regular', desc: 'finish 25 paid minigame runs', cat: 'arcade', reward: 40, test: (pg) => (pg.c.mini || 0) >= 25 },
    { id: 'arcade-addict', name: 'arcade addict', desc: 'finish 100 paid minigame runs', cat: 'arcade', reward: 120, test: (pg) => (pg.c.mini || 0) >= 100 },
    { id: 'quest-starter', name: 'quest starter', desc: 'complete ur first quest', cat: 'quests', reward: 5, test: (pg) => (pg.c.quest || 0) >= 1 },
    { id: 'quest-pro', name: 'quest pro', desc: 'complete 10 quests', cat: 'quests', reward: 30, test: (pg) => (pg.c.quest || 0) >= 10 },
    { id: 'quest-legend', name: 'quest legend', desc: 'complete 50 quests', cat: 'quests', reward: 100, test: (pg) => (pg.c.quest || 0) >= 50 },
    { id: 'chatterbox', name: 'chatterbox', desc: 'say 25 things in world chat', cat: 'social', reward: 20, test: (pg) => (pg.c.say || 0) >= 25 },
    { id: 'duelist', name: 'duelist', desc: 'win a reaction duel', cat: 'social', reward: 15, test: (pg) => (pg.c.duel || 0) >= 1 },
    { id: 'champion', name: 'champion', desc: 'win 10 reaction duels', cat: 'social', reward: 80, test: (pg) => (pg.c.duel || 0) >= 10 },
    { id: 'wishing-well', name: 'wishing well', desc: 'make 10 wishes at the fountain', cat: 'social', reward: 20, test: (pg) => (pg.c.wish || 0) >= 10 },
  ];
  function achCheck(user) {
    const pg = progFor(user);
    const h = { bal: 0, inv: 0 };
    try { h.bal = ctx.getCents(user) || 0; } catch { }
    try { h.inv = (ctx.getInv(user) || []).length; } catch { }
    for (const a of ACHS) {
      if (pg.ach[a.id]) continue;
      let okA = false;
      try { okA = a.test(pg, h); } catch { }
      if (okA) {
        pg.ach[a.id] = Date.now();
        const arr = ACHNEW.get(user) || []; arr.push({ name: a.name, reward: a.reward }); ACHNEW.set(user, arr);
        Promise.resolve(ctx.awardCents(user, a.reward)).catch(() => { });
        txLog(user, 'achievement', a.reward, a.name);
      }
    }
    progSave(user);
  }
  function txLog(user, kind, amt, note) {
    try {
      const arr = wload('tx', user) || [];
      arr.unshift({ ts: Date.now(), kind, amt, note: note || '' });
      wsave('tx', user, arr.slice(0, 40));
    } catch { }
  }
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
    if (!s) { const sv = wload('stats', user); if (sv && sv.day === day) { s = sv; STATS.set(user, s); } }
    if (!s || s.day !== day) { s = { day, shards: 0, golds: 0 }; STATS.set(user, s); }
    return s;
  }
  function statsSave(user) { try { const s = STATS.get(user); if (s) wsave('stats', user, s); } catch { } }
  function questFor(user) {
    const day = ctx.scoreDay();
    let q = QUEST.get(user);
    if (!q) { const sv = wload('quest', user); if (sv && sv.day === day) { q = { day: sv.day, qi: sv.qi, prog: sv.prog, chain: sv.chain, seen: new Set(sv.seen || []) }; QUEST.set(user, q); } }
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
      wsave('quest', user, { day: q.day, qi: q.qi, prog: 0, chain: q.chain, seen: [] });
      return { done: true, pay, t: def.t };
    }
    wsave('quest', user, { day: q.day, qi: q.qi, prog: q.prog, chain: q.chain, seen: Array.from(q.seen).slice(0, 60) });
    return null;
  }

  function prune(now) {
    for (const [u, p] of P) if (now - p.at > STALE_MS) { P.delete(u); SIG.delete(u); }
  }
  function wearOf(u) {
    const out = { trail: null, hat: null, aura: null, pet: null, face: null };
    let w = {};
    try { w = ctx.getWear(u) || {}; } catch { }
    for (const cat of ['trail', 'hat', 'aura', 'pet', 'face']) {
      const it = w[cat] && SHOP.BY_ID[w[cat]];
      if (it) out[cat] = { kind: it.kind, c: it.color };
    }
    return out;
  }
  function roster(now) {
    const out = [sixState(now)];
    for (const [u, p] of P) {
      out.push({
        u, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, fx: p.fx || '', hue: (p.hue != null ? p.hue : null),
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

  function duelInFor(me, now) {
    const ch = DUEL_CH.get(me);
    if (!ch) return null;
    if (now - ch.at > 30000) { DUEL_CH.delete(me); return null; }
    return { from: ch.from };
  }
  function duelFor(me, now) {
    for (const d of DUELS.values()) {
      if (d.settled) continue;
      if (d.a !== me && d.b !== me) continue;
      // deadline: 8s after the green moment, settle with whoever reported
      if (now > d.startAt + d.delay + 8000) { settleDuel(d); continue; }
      return { id: d.id, foe: d.a === me ? d.b : d.a, startAt: d.startAt, delay: d.delay, reported: (d.a === me ? d.ra : d.rb) != null };
    }
    return null;
  }
  function duelDoneFor(me, now) {
    const r = DUEL_DONE.get(me);
    if (!r) return null;
    DUEL_DONE.delete(me);
    return r;
  }
  async function settleDuel(d) {
    if (d.settled) return;
    d.settled = true;
    DUELS.delete(d.id);
    const ra = d.ra != null ? d.ra : 6000, rb = d.rb != null ? d.rb : 6000;
    const tie = Math.abs(ra - rb) < 15;
    const aWin = !tie && ra < rb;
    let pa = 0, pb = 0;
    if (tie) { pa = 10; pb = 10; } else if (aWin) pa = 20; else pb = 20;
    let ba = null, bb = null;
    try { if (pa) ba = await ctx.awardCents(d.a, pa); } catch { }
    try { if (pb) bb = await ctx.awardCents(d.b, pb); } catch { }
    if (pa) txLog(d.a, 'battle', pa, 'vs ' + d.b);
    if (pb) txLog(d.b, 'battle', pb, 'vs ' + d.a);
    if (tie) { awardXp(d.a, 3); awardXp(d.b, 3); }
    else { const wu = aWin ? d.a : d.b; const pd = progFor(wu); pd.c.duel = (pd.c.duel || 0) + 1; progSave(wu); awardXp(wu, 8); achCheck(wu); }
    DUEL_DONE.set(d.a, { win: tie ? 'tie' : (aWin ? 'win' : 'lose'), foe: d.b, myMs: ra, foeMs: rb, prize: pa, bal: ba });
    DUEL_DONE.set(d.b, { win: tie ? 'tie' : (aWin ? 'lose' : 'win'), foe: d.a, myMs: rb, foeMs: ra, prize: pb, bal: bb });
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
      if (b.x != null || b.y != null) {
        let nx = b.x != null ? clampN(b.x, 24, MAP_W - 24) : p.x;
        let ny = b.y != null ? clampN(b.y, 24, MAP_H - 24) : p.y;
        const dtS = Math.min(2, Math.max(0.15, (now - prevAt) / 1000));
        const dd = dist(ox, oy, nx, ny), maxStep = 660 * dtS + 90;
        if (dd > maxStep && !TP_OK.has(me)) { nx = ox + (nx - ox) * maxStep / dd; ny = oy + (ny - oy) * maxStep / dd; }
        TP_OK.delete(me);
        p.x = nx; p.y = ny;
      }
      if (b.dir != null) p.dir = clampN(b.dir, -Math.PI * 2, Math.PI * 2);
      p.vc = !!b.vc;
      p.talk = !!b.talk;
      p.at = now;
      try { p.fx = ctx.getFx(me) || ''; } catch { p.fx = ''; }
      try { p.wear = wearOf(me); } catch { p.wear = null; }
      try { p.hue = ctx.getHue(me); } catch { p.hue = null; }
      let questDone = null;
      // walking feeds the walk quest (delta capped so teleports don't farm)
      const pg = progFor(me);
      pg.playSec = (pg.playSec || 0) + Math.min(1.6, Math.max(0, (now - prevAt) / 1000));
      if (pg.lastDay !== ctx.scoreDay()) { pg.lastDay = ctx.scoreDay(); awardXp(me, 10); }
      if (!pg.c.enter) pg.c.enter = 1;
      const moved = dist(ox, oy, p.x, p.y);
      if (moved > 1 && moved < 560) questDone = questEvent(me, 'walk', Math.round(moved)) || questDone;
      if (moved > 1 && moved < 560) pg.c.walk = (pg.c.walk || 0) + Math.round(moved);
      // emotes: a fresh emote timestamp counts once
      if (b.emote && b.emoteTs && b.emoteTs !== p.emoteTs) {
        p.emote = String(b.emote).slice(0, 12); p.emoteTs = b.emoteTs; p.emoteAt = now;
        questDone = questEvent(me, 'emote', p.emote) || questDone;
      }
      // zone entry (distinct spots, or a specific spot for targeted quests)
      const zn = zoneAt(p.x, p.y);
      let disc = null;
      if (zn && zn !== p.zone) {
        questDone = questEvent(me, 'zone', zn) || questDone;
        if (pg.zones.indexOf(zn) < 0) { pg.zones.push(zn); disc = { zone: zoneName(zn) }; awardXp(me, 6); progSave(me); }
      }
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
      let claimId = b.claim;
      if (!claimId) {
        let bd = 62;
        for (const s of shards) { const dd = dist(p.x, p.y, s.x, s.y); if (dd < bd) { bd = dd; claimId = s.id; } }
      }
      if (claimId) {
        const i = shards.findIndex((s) => s.id === String(claimId));
        if (i >= 0 && dist(p.x, p.y, shards[i].x, shards[i].y) < 85) {
          const s = shards[i];
          shards.splice(i, 1);
          const st = statsFor(me);
          st.shards += 1;
          if (s.gold) st.golds += 1;
          const amt = s.gold ? GOLD_PAY : SHARD_PAY;
          let bal = null;
          try { bal = await ctx.awardCents(me, amt); } catch { }
          got = { amt, gold: !!s.gold, bal };
          txLog(me, s.gold ? 'gold shard' : 'shard', amt);
          statsSave(me);
          pg.c.shard = (pg.c.shard || 0) + 1;
          if (s.gold) pg.c.gold = (pg.c.gold || 0) + 1;
          awardXp(me, s.gold ? 5 : 1);
          achCheck(me);
          questDone = questEvent(me, 'shard') || questDone;
          if (s.gold) questDone = questEvent(me, 'gold') || questDone;
          fillShards(now);
        }
      }
      if (questDone && questDone.done) {
        let bal = null;
        try { bal = await ctx.awardCents(me, questDone.pay); } catch { }
        questDone.bal = bal;
        txLog(me, 'quest', questDone.pay, questDone.t);
        pg.c.quest = (pg.c.quest || 0) + 1;
        awardXp(me, 12);
        achCheck(me);
      }
      const sig = SIG.get(me) || [];
      SIG.delete(me);
      const st = statsFor(me);
      if (Math.random() < 0.08) achCheck(me);
      J({
        ok: true, me, players: roster(now), sig, n: P.size, bal: (() => { try { return ctx.getCents(me); } catch { return null; } })(),
        inv: (() => { try { return ctx.getInv(me); } catch { return []; } })(),
        wearIds: (() => { try { return ctx.getWear(me); } catch { return {}; } })(),
        shards: shards.map((s) => ({ id: s.id, x: s.x, y: s.y, gold: s.gold })),
        lb: leaderboard(), quest: questView(me),
        today: { shards: st.shards, golds: st.golds },
        zone: p.zone ? zoneName(p.zone) : '', got, questDone, srvNow: now,
        duelIn: duelInFor(me, now), duel: duelFor(me, now), duelDone: duelDoneFor(me, now),
        prog: progView(me), disc,
        lvlUp: (() => { const v = LVLUP.get(me) || null; LVLUP.delete(me); return v; })(),
        achNew: (() => { const v = ACHNEW.get(me) || []; ACHNEW.delete(me); return v; })(),
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
      const pgs = progFor(me); pgs.c.say = (pgs.c.say || 0) + 1; progSave(me); achCheck(me);
      let bal = null;
      if (qd && qd.done) { try { bal = await ctx.awardCents(me, qd.pay); } catch { } txLog(me, 'quest', qd.pay, qd.t); pgs.c.quest = (pgs.c.quest || 0) + 1; awardXp(me, 12); achCheck(me); }
      J({ ok: true, questDone: qd ? { done: true, pay: qd.pay, t: qd.t, bal } : null, quest: questView(me) });
      return true;
    }

    if (u.pathname === '/api/world/portal' && req.method === 'POST') {
      const id = String(b.id || '').slice(0, 20);
      const qd = id ? questEvent(me, 'portal', id) : null;
      let bal = null;
      if (qd && qd.done) { try { bal = await ctx.awardCents(me, qd.pay); } catch { } txLog(me, 'quest', qd.pay, qd.t); const pgp = progFor(me); pgp.c.quest = (pgp.c.quest || 0) + 1; awardXp(me, 12); achCheck(me); }
      J({ ok: true, questDone: qd ? { done: true, pay: qd.pay, t: qd.t, bal } : null, quest: questView(me) });
      return true;
    }

    if (u.pathname === '/api/world/mini-start' && req.method === 'POST') {
      const g = GAMES_MOD.BY_ID[String(b.game || '')];
      if (!g) { J({ ok: false, err: 'no such minigame' }, 400); return true; }
      const token = 'mt' + now.toString(36) + Math.floor(Math.random() * 1e9).toString(36);
      MTOK.set(token, { user: me, game: g.id, at: now });
      if (MTOK.size > 400) { for (const [k, v] of MTOK) { if (now - v.at > 180000) MTOK.delete(k); } }
      J({ ok: true, token });
      return true;
    }
    if (u.pathname === '/api/world/miniscore' && req.method === 'POST') {
      const g = GAMES_MOD.BY_ID[String(b.game || '')];
      if (!g) { J({ ok: false, err: 'no such minigame' }, 400); return true; }
      const pts = Math.floor(Number(b.points));
      if (!Number.isFinite(pts) || pts < 0 || pts > g.maxPoints) { J({ ok: false, err: 'score out of range' }, 400); return true; }
      // a score only pays against a live play session: started via mini-start,
      // one-shot, right game, right player, at least 2s of actual play.
      const tk = MTOK.get(String(b.token || ''));
      let live = false;
      if (tk && tk.user === me && tk.game === g.id && now - tk.at >= 2000 && now - tk.at <= 240000) { live = true; MTOK.delete(String(b.token || '')); }
      if (!live) {
        let bal0 = null;
        try { bal0 = ctx.getCents(me); } catch { }
        J({ ok: true, cents: 0, paid: false, practice: true, playsLeft: null, bal: bal0 });
        return true;
      }
      if (now - (lastMini.get(me) || 0) < 10000) { J({ ok: false, err: 'too fast — give it a few seconds' }, 429); return true; }
      lastMini.set(me, now);
      const mday = ctx.scoreDay();
      let rec = MGPLAY.get(me);
      if (!rec) { const sv = wload('mgplay', me); if (sv && sv.day === mday) { rec = sv; MGPLAY.set(me, rec); } }
      if (!rec || rec.day !== mday) { rec = { day: mday, plays: {} }; MGPLAY.set(me, rec); }
      const used = rec.plays[g.id] || 0;
      let coins = 0, paid = false;
      if (pts > 0 && used < 3) {
        coins = Math.max(1, Math.round(pts / g.maxPoints * g.capCoins));
        rec.plays[g.id] = used + 1;
        wsave('mgplay', me, rec);
        paid = true;
        try { await ctx.awardCents(me, coins); } catch { }
        txLog(me, 'minigame', coins, g.name);
        const pgm = progFor(me); pgm.c.mini = (pgm.c.mini || 0) + 1; progSave(me); awardXp(me, 4); achCheck(me);
      }
      let bal = null;
      try { bal = ctx.getCents(me); } catch { }
      J({ ok: true, cents: coins, paid, playsLeft: Math.max(0, 3 - (rec.plays[g.id] || 0)), bal });
      return true;
    }
    if (u.pathname === '/api/world/tx' && req.method === 'GET') {
      J({ ok: true, tx: wload('tx', me) || [] });
      return true;
    }
    if (u.pathname === '/api/world/shopbuy' && req.method === 'POST') {
      if (BUYLOCK.has(me)) { J({ ok: false, err: 'one purchase at a time' }, 429); return true; }
      BUYLOCK.add(me);
      setTimeout(() => BUYLOCK.delete(me), 1500);
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
      txLog(me, 'shop', -it.price, it.name);
      const pgb = progFor(me); pgb.c.buy = (pgb.c.buy || 0) + 1; progSave(me); achCheck(me);
      J({ ok: true, bal, inv });
      return true;
    }
    if (u.pathname === '/api/world/shopequip' && req.method === 'POST') {
      const cat = String(b.cat || '');
      if (!['trail', 'hat', 'aura', 'pet', 'face'].includes(cat)) { J({ ok: false, err: 'bad category' }, 400); return true; }
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
    if (u.pathname === '/api/world/char' && req.method === 'POST') {
      const h = Math.round(Number(b.hue));
      if (!isFinite(h) || h < 0 || h > 359) { J({ ok: false, err: 'bad color' }, 400); return true; }
      try { ctx.setHue(me, h); } catch { }
      const p2 = P.get(me); if (p2) p2.hue = h;
      J({ ok: true, hue: h });
      return true;
    }
    if (u.pathname === '/api/world/pinfo' && req.method === 'GET') {
      const who = String(u.searchParams.get('u') || '').toLowerCase();
      if (!who) { J({ ok: false, err: 'who?' }, 400); return true; }
      let cents = null, hue = null, wearNames = [];
      try { cents = ctx.getCents(who); } catch { }
      try { hue = ctx.getHue(who); } catch { }
      try { const w = wearOf(who); if (w) for (const k of ['trail', 'hat', 'aura', 'pet']) if (w[k]) wearNames.push(w[k].name); } catch { }
      J({ ok: true, user: who, cents, hue, wear: wearNames, online: P.has(who), prog: (() => { try { return progView(who); } catch { return null; } })() });
      return true;
    }
    if (u.pathname === '/api/world/ach' && req.method === 'GET') {
      const pg = progFor(me);
      J({ ok: true, achs: ACHS.map((a) => ({ id: a.id, name: a.name, desc: a.desc, cat: a.cat, reward: a.reward, got: !!pg.ach[a.id] })), prog: progView(me) });
      return true;
    }
    if (u.pathname === '/api/world/duel' && req.method === 'POST') {
      const to = String(b.to || '').toLowerCase();
      if (!to || to === me) { J({ ok: false, err: 'pick someone else' }, 400); return true; }
      if (!P.has(to)) { J({ ok: false, err: 'they are not in the world rn' }); return true; }
      if (duelFor(me, now) || duelFor(to, now)) { J({ ok: false, err: 'one of u is already in a battle' }); return true; }
      if (DUEL_CH.has(to)) { J({ ok: false, err: 'they already have a challenge waiting' }); return true; }
      DUEL_CH.set(to, { from: me, at: now });
      J({ ok: true });
      return true;
    }
    if (u.pathname === '/api/world/duel-accept' && req.method === 'POST') {
      const from = String(b.from || '').toLowerCase();
      const ch = DUEL_CH.get(me);
      if (!ch || ch.from !== from || now - ch.at > 30000) { J({ ok: false, err: 'that challenge expired' }); return true; }
      DUEL_CH.delete(me);
      if (!P.has(from)) { J({ ok: false, err: 'they left' }); return true; }
      const id = 'd' + now.toString(36) + Math.floor(Math.random() * 9999);
      DUELS.set(id, { id, a: from, b: me, startAt: now + 1600, delay: 1300 + Math.floor(Math.random() * 2200), ra: null, rb: null, settled: false });
      J({ ok: true, id });
      return true;
    }
    if (u.pathname === '/api/world/duel-decline' && req.method === 'POST') {
      const from = String(b.from || '').toLowerCase();
      const ch = DUEL_CH.get(me);
      if (ch && ch.from === from) { DUEL_CH.delete(me); DUEL_DONE.set(from, { declined: true, foe: me }); }
      J({ ok: true });
      return true;
    }
    if (u.pathname === '/api/world/duel-report' && req.method === 'POST') {
      const d = DUELS.get(String(b.id || ''));
      if (!d || d.settled || (d.a !== me && d.b !== me)) { J({ ok: false, err: 'no such battle' }, 400); return true; }
      let ms = Number(b.ms);
      if (!isFinite(ms) || ms < 0) ms = 6000;
      ms = Math.min(6000, Math.max(0, Math.round(ms)));
      if (d.a === me) d.ra = ms; else d.rb = ms;
      if (d.ra != null && d.rb != null) settleDuel(d);
      J({ ok: true });
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
      txLog(me, 'wish', jackpot ? 49 : -1, jackpot ? 'fountain jackpot' : 'a wish at the fountain');
      const pgw = progFor(me); pgw.c.wish = (pgw.c.wish || 0) + 1; progSave(me); achCheck(me);
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
      '    <div id="wlvlrow"><span id="wlvl">Lv 1 · newcomer</span><span id="wxp"><i></i></span></div>\n' +
      '    <div id="wquest" hidden><div class="wq-t"></div><div class="wq-bar"><i></i></div><div class="wq-s"></div></div>\n' +
      '    <div id="wlb" hidden></div>\n' +
      '  </div>\n' +
      '  <div class="wbtns">\n' +
      '    <button id="wshopbtn" type="button" title="six cents shop"><span class="wcent">\u00a2</span></button>\n' +
      '    <button id="wgames" type="button" title="minigames"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.2-.022.63-.022 1.41a5 5 0 0 0 8.303 4.743 1 1 0 0 1 .984-.27h.066a1 1 0 0 1 .984.27A5 5 0 0 0 21.32 10c0-.78-.016-1.21-.022-1.41A4 4 0 0 0 17.32 5z"/></svg></button>\n' +
      '    <button id="wcharbtn" type="button" title="your character"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>\n' +
      '    <button id="wachbtn" type="button" title="achievements"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg></button>\n' +
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
      '  <div class="wa-head"><span>✦ the arcade</span><span id="wa-count"></span><button id="wa-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <input id="wa-q" type="text" placeholder="search 112 minigames…">\n' +
      '  <div id="wa-list"></div>\n' +
      '</div></div>\n' +
      '<div id="wgame" hidden><div class="wg-card">\n' +
      '  <div class="wg-head"><span id="wg-title"></span><span id="wg-score"></span><button id="wg-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wg-how"></div>\n' +
      '  <div id="wg-stage"></div>\n' +
      '  <div id="wg-result" hidden></div>\n' +
      '</div></div>\n' +
      '<div id="wshop" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 six cents shop</span><span id="wsh-bal"></span><button id="wsh-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div class="wsh-note">six cents are earned right here in the world \u2014 shards, quests, minigames. they are NOT site coins.</div>\n' +
      '  <input id="wsh-q" type="text" placeholder="search 140 items\u2026">\n' +
      '  <div id="wsh-tabs"></div>\n' +
      '  <div id="wsh-grid"></div>\n' +
      '</div></div>\n' +
      '<div id="wchar" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 your character</span><button id="wchar-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div class="wchar-top"><canvas id="wchar-pv" width="96" height="96"></canvas><div><div id="wchar-name"></div><div class="wchar-sub">this is how the world sees u \u2014 color is saved to ur account</div></div></div>\n' +
      '  <div class="wchar-lab">body color</div><div id="wchar-sw"></div>\n' +
      '  <div class="wchar-lab">ur fit</div><div class="wchar-fit">hats, trails, auras + pets live in the six cents shop. name fx lives in the site fx shop.</div>\n' +
      '  <button id="wchar-shop" type="button">open the six cents shop</button>\n' +
      '</div></div>\n' +
      '<div id="wach" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 achievements</span><button id="wach-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wach-sub" class="wchar-sub"></div>\n' +
      '  <div id="wach-list"></div>\n' +
      '</div></div>\n' +
      '<div id="wprof" hidden><div class="wprof-card">\n' +
      '  <div id="wprof-banner"></div><button id="wprof-x" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>\n' +
      '  <div class="wprof-body"><div id="wprof-av"></div><div id="wprof-name"></div><div id="wprof-user"></div><div id="wprof-meta"></div><div id="wprof-badges"></div><div id="wprof-stats"></div><div id="wprof-wear"></div>\n' +
      '  <div class="wprof-acts"><button id="wprof-add" type="button">add friend</button><button id="wprof-battle" type="button">battle</button><a id="wprof-link" href="#">full profile</a></div></div>\n' +
      '</div></div>\n' +
      '<div id="wduel" hidden><span id="wduel-t"></span><button id="wduel-yes" type="button">accept</button><button id="wduel-no" type="button">nah</button></div>\n' +
      '<div id="wduelgo" hidden><div id="wduelgo-t"></div><div id="wduelgo-s"></div></div>\n' +
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
