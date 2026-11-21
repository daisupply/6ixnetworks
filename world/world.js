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

const MAP_W = 6400;
const MAP_H = 6400; // 4200 of overworld + a housing-interior band below (4400+)
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
  { id: 'neon', name: 'the neon district', x: 5600, y: 1150, r: 580 },
  { id: 'rooftops', name: 'the rooftops', x: 5650, y: 600, r: 175 },
  { id: 'alley', name: 'the back alley', x: 6150, y: 1620, r: 130 },
  { id: 'sky', name: 'the sky islands', x: 5650, y: 280, r: 430 },
  { id: 'eastwild', name: 'the eastern wilds', x: 5600, y: 2500, r: 520 },
  { id: 'underarcade', name: 'the underground arcade', x: 5300, y: 3470, r: 340 },
  { id: 'underarcade', name: 'the underground arcade', x: 6000, y: 3470, r: 340 },
  { id: 'underarcade', name: 'the underground arcade', x: 5650, y: 3600, r: 210 },
  { id: 'vault', name: 'the vault', x: 5650, y: 3990, r: 380 },
  { id: 'vault', name: 'the vault', x: 5150, y: 3970, r: 240 },
  { id: 'vault', name: 'the vault', x: 6150, y: 3970, r: 240 },
  { id: 'maple', name: 'maple row', x: 900, y: 3080, r: 330 },
  { id: 'caves', name: 'the crystal caves', x: 1150, y: 3650, r: 640 },
  { id: 'cavedeep', name: 'the deep caves', x: 2100, y: 3980, r: 230 },
  { id: 'sunken', name: 'the sunken flats', x: 3600, y: 3650, r: 620 },
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
  { x: 5600, y: 1150 }, { x: 1200, y: 3650 },
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

// Decorative NPCs: same time-function trick as Six — every client computes
// the same position, no server tick, they wander their district and talk.
const NPC_DEFS = [
  {
    u: 'nova', fx: 'sunset', leg: 11000, pause: 3200,
    path: [{ x: 5200, y: 900 }, { x: 6050, y: 900 }, { x: 6050, y: 1420 }, { x: 5200, y: 1420 }],
    lines: [
      'the district never dims. neither do i',
      'arcade is DOWNSTAIRS. the glowing door. ur welcome',
      'rooftops got the best view in the whole network',
      'i saw a crystal up top once. once.',
      'buildings here hum at night. listen',
    ],
    wear: { trail: { kind: 'star', c: '#fb7185' }, aura: { kind: 'spin', c: '#f472b6' } },
  },
  {
    u: 'echo', fx: 'frost', leg: 13000, pause: 3600,
    path: [{ x: 800, y: 3500 }, { x: 1650, y: 3480 }, { x: 1980, y: 3920 }, { x: 900, y: 3960 }],
    lines: [
      'the crystals sing if u stand still',
      'deep caves keep deep secrets',
      'something gold sleeps past the dark. past ME, even',
      'mind the glow. it minds u back',
      'i count crystals so the caves dont have to',
    ],
    wear: { trail: { kind: 'star', c: '#67e8f9' }, pet: { kind: 'star', c: '#a5f3fc' } },
  },
];
function npcState(def, now) {
  const cyc = (def.leg + def.pause) * def.path.length;
  const t = now % cyc;
  const i = Math.floor(t / (def.leg + def.pause));
  const lt = t - i * (def.leg + def.pause);
  const a = def.path[i], b = def.path[(i + 1) % def.path.length];
  let x, y, moving = false;
  if (lt < def.leg) {
    const k = lt / def.leg, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    x = a.x + (b.x - a.x) * e; y = a.y + (b.y - a.y) * e; moving = true;
  } else { x = b.x; y = b.y; }
  const lineIdx = Math.floor(now / 12000 + def.u.length) % def.lines.length;
  return {
    u: def.u, npc: true, x: Math.round(x), y: Math.round(y), dir: Math.atan2(b.y - a.y, b.x - a.x), fx: def.fx,
    vc: false, talk: false, bub: moving ? '' : def.lines[lineIdx], wear: def.wear,
  };
}

// Crystal collectibles: fixed spots in the new districts. One-time per
// player, paid by rarity, tracked on the persistent prog record.
const CRYSTALS = [
  { id: 'c1', x: 700, y: 3400, rare: 'common', pay: 15 }, { id: 'c2', x: 1250, y: 3550, rare: 'common', pay: 15 },
  { id: 'c3', x: 1650, y: 3380, rare: 'rare', pay: 30 }, { id: 'c4', x: 600, y: 3850, rare: 'rare', pay: 30 },
  { id: 'c5', x: 1500, y: 3900, rare: 'common', pay: 15 }, { id: 'c6', x: 2050, y: 3900, rare: 'epic', pay: 60 },
  { id: 'c7', x: 2250, y: 4050, rare: 'rare', pay: 30 }, { id: 'c8', x: 5200, y: 250, rare: 'common', pay: 15 },
  { id: 'c9', x: 5650, y: 180, rare: 'rare', pay: 30 }, { id: 'c10', x: 6150, y: 300, rare: 'epic', pay: 60 },
  { id: 'c11', x: 5400, y: 380, rare: 'common', pay: 15 }, { id: 'c12', x: 5400, y: 3900, rare: 'rare', pay: 30 },
  { id: 'c13', x: 5650, y: 3850, rare: 'epic', pay: 60 }, { id: 'c14', x: 5950, y: 4000, rare: 'mythic', pay: 150 },
  { id: 'c15', x: 6150, y: 1620, rare: 'rare', pay: 30 }, { id: 'c16', x: 5650, y: 600, rare: 'epic', pay: 60 },
];

// Intra-world doors: the server validates the player is standing at the
// from-point, then sanctions the teleport (TP_OK) and moves them itself.
const MOUNT_SPEED = { board: 350, scooter: 365, bike: 400, hover: 415, cloud: 440, rocket: 465, dragonm: 490 };
  const ROD_LUCK = { rod1: 1, rod2: 1.5, rod3: 2.1, rod4: 2.8 };
  const FISH_SPECIES = [
    { id: 'minnow', name: 'moon minnow', band: 'common', pay: 6, c: '#a5f3fc', w: 18, w0: 0.1, w1: 0.4 },
    { id: 'perch', name: 'puddle perch', band: 'common', pay: 8, c: '#93c5fd', w: 16, w0: 0.2, w1: 0.8 },
    { id: 'guppy', name: 'gloom guppy', band: 'common', pay: 7, c: '#c4b5fd', w: 16, w0: 0.1, w1: 0.3 },
    { id: 'boot', name: 'old boot', band: 'junk', pay: 0, c: '#78716c', w: 6, w0: 0.5, w1: 0.5 },
    { id: 'silver', name: 'silverfin', band: 'rare', pay: 16, c: '#e2e8f0', w: 11, w0: 0.5, w1: 1.6 },
    { id: 'koi', name: 'ember koi', band: 'rare', pay: 20, c: '#fb923c', w: 10, w0: 0.6, w1: 2.0 },
    { id: 'eel', name: 'void eel', band: 'epic', pay: 38, c: '#a78bfa', w: 6, w0: 1.0, w1: 3.4 },
    { id: 'carp', name: 'crystal carp', band: 'epic', pay: 45, c: '#7dd3fc', w: 5, w0: 1.2, w1: 4.0 },
    { id: 'levi', name: 'moon leviathan', band: 'legendary', pay: 120, c: '#f0abfc', w: 2.2, w0: 6, w1: 18 },
    { id: 'lich', name: 'lichfish', band: 'legendary', pay: 150, c: '#ffd257', w: 1.8, w0: 4, w1: 12 },
    { id: 'aurelia', name: 'aurelia, the drowned star', band: 'mythic', pay: 400, c: '#fff3c4', w: 0.5, w0: 2, w1: 5 },
  ];
  const FISH_BAND_I = { junk: 0, common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
  const FISH = new Map();
  function fishSpot(p) {
    if (!p) return false;
    const inLake = p.x > 1480 - 90 && p.x < 3320 + 90 && p.y > 2260 - 90 && p.y < 2940 + 90;
    const onPier = p.x > 2352 - 24 && p.x < 2448 + 24 && p.y > 2240 - 24 && p.y < 2580 + 24;
    return inLake || onPier;
  }
  function fishWeek(now) { return Math.floor((now / 86400000 + 3) / 7); }
  function fishBoard(now, fb) {
    fb = fb || {};
    if (fb.wk !== fishWeek(now)) return [];
    return Object.keys(fb.rows || {}).map((u2) => ({ u: u2, v: fb.rows[u2].w, sp: fb.rows[u2].sp })).sort((a, b2) => b2.v - a.v).slice(0, 10);
  }
const PORTAL_PADS = { games: [1780, 1215], movies: [3020, 1215], blox: [2400, 1120], chat: [1710, 1500], party: [3090, 1500], yt: [1780, 1800], tiktok: [3020, 1800], music: [2400, 1905] };
const DOORS = {
  'arcade-in': { fx: 5600, fy: 1680, tx: 5650, ty: 3600 },
  'arcade-out': { fx: 5650, fy: 3600, tx: 5600, ty: 1680 },
  'sky-up': { fx: 5650, fy: 640, tx: 5650, ty: 430 },
  'sky-down': { fx: 5650, fy: 430, tx: 5650, ty: 640 },
  'vault-in': { fx: 2100, fy: 3980, tx: 5300, ty: 3970 },
  'vault-out': { fx: 5300, fy: 3970, tx: 2100, ty: 3980 },
};

// Six's storyline: the first six quests every player gets, in order, before
// the endless bank chain takes over. Progress lives on the prog record.
const STORY = [
  { id: 'story1', kind: 'walk', n: 400, pay: 30, t: "six's errand — feel out the plaza", say: 'walk the plaza a bit. feel it out.' },
  { id: 'story2', kind: 'shard', n: 5, pay: 40, t: 'shard school', say: 'see the glowing bits? grab five. they pay rent here.' },
  { id: 'story3', kind: 'say', n: 3, pay: 35, t: 'say hi to the world', say: 'say three things. anything. the world likes voices.' },
  { id: 'story4', kind: 'portal', n: 3, pay: 50, t: 'door hopper', say: 'portals are just doors that glow. try three different ones.' },
  { id: 'story5', kind: 'gold', n: 1, pay: 80, t: 'gold fever', say: 'a golden shard drops every few minutes. be standing there when it does.' },
  { id: 'story6', kind: 'meet', n: 3, pay: 100, t: 'meet the network', say: 'stand close to three different people. that is the whole game.' },
];
// Daily quests: 3 per player per day, picked deterministically from the pool.
const DAILY_POOL = [
  { kind: 'shard', n: 8, pay: 20, t: 'shard sweep — collect 8 moon shards' },
  { kind: 'shard', n: 20, pay: 45, t: 'shard binge — collect 20 moon shards' },
  { kind: 'gold', n: 2, pay: 40, t: 'gold rush — catch 2 golden shards' },
  { kind: 'say', n: 5, pay: 15, t: 'loud enough — say 5 things in the world' },
  { kind: 'emote', n: 4, pay: 15, t: 'express urself — use 4 emotes' },
  { kind: 'walk', n: 3000, pay: 20, t: 'daily stroll — walk 3,000 steps of the world' },
  { kind: 'zone', n: 3, pay: 25, t: 'wanderer — visit 3 different places' },
  { kind: 'portal', n: 3, pay: 25, t: 'door hopper — step through 3 different portals' },
  { kind: 'meet', n: 2, pay: 30, t: 'people person — meet 2 different players' },
  { kind: 'vc', n: 60, pay: 25, t: 'voice check — spend 60s in voice range of someone' },
  { kind: 'mini', n: 2, pay: 25, t: 'arcade run — finish 2 paid minigame runs' },
  { kind: 'crystal', n: 1, pay: 30, t: 'crystal found — find a hidden crystal' },
];
// Weekly quest: one per player per week (Monday-bucketed), bigger targets.
const WEEKLY_POOL = [
  { kind: 'shard', n: 120, pay: 300, t: 'the big sweep — collect 120 moon shards this week' },
  { kind: 'chain', n: 8, pay: 250, t: 'quest machine — complete 8 quests this week' },
  { kind: 'mini', n: 15, pay: 280, t: 'arcade marathon — finish 15 paid minigame runs this week' },
  { kind: 'walk', n: 60000, pay: 260, t: 'the long walk — walk 60,000 steps this week' },
  { kind: 'gold', n: 8, pay: 320, t: 'gold standard — catch 8 golden shards this week' },
];


function createWorld(ctx) {
  try { ctx.wget('__warm'); } catch { } // kick the persistent world-data load early so early writes never race it
  const CSS = fs.readFileSync(path.join(__dirname, 'world.css'), 'utf8');
  const CLIENT = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');

  const P = new Map();      // user -> {x,y,dir,at,bub,bubAt,vc,talk,fx,emote,emoteTs,lx,ly}
  const SIG = new Map();
  const SIG_WIN = new Map(); // per-sender signal timestamps (rate guard)    // user -> [{from, data, at}]
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
    pg.c = pg.c || {}; pg.ach = pg.ach || {}; pg.zones = pg.zones || []; pg.crystals = pg.crystals || []; pg.story = pg.story || 0;
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
    return { xp: pg.xp || 0, lvl, title: titleOf(lvl), cur: (pg.xp || 0) - lvlAt(lvl), need: lvlAt(lvl + 1) - lvlAt(lvl), playSec: Math.floor(pg.playSec || 0), zones: (pg.zones || []).length, zonesList: pg.zones || [], ach: Object.keys(pg.ach || {}).length, crystals: (pg.crystals || []).length };
  }
  const ACHS = [
    { id: 'first-steps', name: 'first steps', desc: 'spend a minute inside the world', cat: 'progression', reward: 5, test: (pg) => (pg.playSec || 0) >= 60 },
    { id: 'angler', name: 'angler', desc: 'catch 25 fish at the moonlit lake', cat: 'world', reward: 60, test: (pg) => ((pg.c || {}).fish || 0) >= 25 },
    { id: 'rising-star', name: 'rising star', desc: 'reach level 5', cat: 'progression', reward: 50, test: (pg) => levelOf(pg.xp || 0) >= 5 },
    { id: 'world-veteran', name: 'world veteran', desc: 'reach level 10', cat: 'progression', reward: 150, test: (pg) => levelOf(pg.xp || 0) >= 10 },
    { id: 'wanderer', name: 'wanderer', desc: 'discover 5 locations', cat: 'exploration', reward: 20, test: (pg) => (pg.zones || []).length >= 5 },
    { id: 'cartographer', name: 'cartographer', desc: 'discover 12 locations', cat: 'exploration', reward: 50, test: (pg) => (pg.zones || []).length >= 12 },
    { id: 'globetrotter', name: 'globetrotter', desc: 'discover 20 locations', cat: 'exploration', reward: 120, test: (pg) => (pg.zones || []).length >= 20 },
    { id: 'world-master', name: 'world master', desc: 'discover every location in the world', cat: 'exploration', reward: 200, test: (pg) => (pg.zones || []).length >= 27 },
    { id: 'crystal-hunter', name: 'crystal hunter', desc: 'find 5 hidden crystals', cat: 'collection', reward: 40, test: (pg) => (pg.c.crystal || 0) >= 5 },
    { id: 'master-collector', name: 'master collector', desc: 'find all 16 hidden crystals', cat: 'collection', reward: 200, test: (pg) => (pg.c.crystal || 0) >= 16 },
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
      const y = 70 + Math.random() * (4200 - 140); // shards never spawn in the housing band
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
    const evNow = worldEvent(now);
    const goldAlive = shards.filter((s) => s.gold).length;
    if (now >= nextGoldAt || (evNow && evNow.type === 'goldenhunt' && goldAlive < 3 && now - lastHuntGold >= 20000)) {
      const p = spawnPos();
      shards.push({ id: 'g' + (shardSeq++), x: p.x, y: p.y, gold: true, born: now });
      nextGoldAt = now + GOLD_EVERY_MS;
      lastHuntGold = now;
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
    const pg = progFor(user);
    if ((pg.story || 0) < STORY.length) {
      const def = STORY[pg.story || 0];
      return { id: def.id, t: def.t, prog: Math.min(Math.floor(q.prog), def.n), n: def.n, pay: def.pay, chain: q.chain, story: true, say: def.say, step: (pg.story || 0) + 1 };
    }
    const def = QUESTS[q.qi];
    return { id: def.id, t: def.t, prog: Math.min(Math.floor(q.prog), def.n), n: def.n, pay: def.pay + q.chain * 10, chain: q.chain };
  }
  // feed a game event into the user's quest; returns {done, pay} or null.
  // key: portal/zone/meet carry an id (distinct-set or specific target),
  // emote carries the emote id, walk/vc carry an amount.
  function questEvent(user, kind, key) {
    try { dailyEvent(user, kind, key); } catch { }
    const q = questFor(user);
    const pg = progFor(user);
    const storyDef = (pg.story || 0) < STORY.length ? STORY[pg.story || 0] : null;
    const def = storyDef || QUESTS[q.qi];
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
      if (storyDef) {
        const pay = def.pay;
        pg.story = (pg.story || 0) + 1;
        progSave(user);
        q.prog = 0;
        q.seen = new Set();
        wsave('quest', user, { day: q.day, qi: q.qi, prog: 0, chain: q.chain, seen: [] });
        try { dailyEvent(user, 'chain'); } catch { }
        return { done: true, pay, t: def.t, story: true };
      }
      const pay = def.pay + q.chain * 10;
      q.chain += 1;
      q.qi = (q.qi + 137 + q.chain * 31) % QUESTS.length;
      q.prog = 0;
      q.seen = new Set();
      wsave('quest', user, { day: q.day, qi: q.qi, prog: 0, chain: q.chain, seen: [] });
      try { dailyEvent(user, 'chain'); } catch { }
      return { done: true, pay, t: def.t };
    }
    wsave('quest', user, { day: q.day, qi: q.qi, prog: q.prog, chain: q.chain, seen: Array.from(q.seen).slice(0, 60) });
    return null;
  }

  function prune(now) {
    for (const [u, p] of P) if (now - p.at > STALE_MS) {
      P.delete(u); SIG.delete(u); PINV.delete(u); DUEL_CH.delete(u);
      for (const [did, d] of DUELS) if (!d.settled && (d.a === u || d.b === u)) DUELS.delete(did);
      const pt = partyOf(u);
      if (pt && !pt.members.some((m) => m !== u && P.has(m))) for (const m of pt.members.slice()) partyRemove(m);
    }
  }
  function wearOf(u) {
    const out = { trail: null, hat: null, aura: null, pet: null, face: null, mount: null, rod: null };
    let w = {};
    try { w = ctx.getWear(u) || {}; } catch { }
    for (const cat of ['trail', 'hat', 'aura', 'pet', 'face', 'mount', 'rod']) {
      const it = w[cat] && SHOP.BY_ID[w[cat]];
      if (it) out[cat] = { kind: it.kind, c: it.color, id: it.id, rarity: it.rarity || 'common' };
    }
    return out;
  }
  function roster(now) {
    const out = [sixState(now)].concat(NPC_DEFS.map((d) => npcState(d, now)));
    for (const [u, p] of P) {
      out.push({
        u, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, fx: p.fx || '', hue: (p.hue != null ? p.hue : null),
        vc: !!p.vc, talk: !!p.talk,
        bub: (p.bub && now - p.bubAt < 6000) ? p.bub : '',
        emote: (p.emote && now - (p.emoteAt || 0) < 2600) ? p.emote : '',
        wear: p.wear || null,
        petName: (p.wear && p.wear.pet && p.wear.pet.id) ? ((wload('petname', u) || {})[p.wear.pet.id] || '') : '',
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

  const DQ_DONE = new Map();   // user -> [{t, pay, weekly}] quest completions waiting for their next ping
  function weekKeyOf(dayStr) {
    const d = new Date(dayStr + 'T12:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function dailyFor(user, pg) {
    const day = ctx.scoreDay();
    if (!pg.daily || pg.daily.day !== day) {
      const h = hashStr(user + ':daily:' + day);
      const list = [];
      for (let k = 0; k < 3; k++) list.push({ i: (h + k * 5) % DAILY_POOL.length, prog: 0, seen: [], done: false });
      pg.daily = { day, list };
      progSave(user);
    }
    return pg.daily;
  }
  function weeklyFor(user, pg) {
    const wk = weekKeyOf(ctx.scoreDay());
    if (!pg.weekly || pg.weekly.week !== wk) {
      pg.weekly = { week: wk, i: hashStr(user + ':weekly:' + wk) % WEEKLY_POOL.length, prog: 0, seen: [], done: false };
      progSave(user);
    }
    return pg.weekly;
  }
  function trackEvent(rec, def, kind, key) {
    if (rec.done || def.kind !== kind) return false;
    if (kind === 'portal' || kind === 'meet' || kind === 'zone') {
      if (rec.seen.indexOf(key) >= 0) return false;
      rec.seen.push(key);
      rec.prog = rec.seen.length;
    } else if (kind === 'walk' || kind === 'vc') rec.prog += key;
    else rec.prog += 1;
    return rec.prog >= def.n;
  }
  function dailyEvent(user, kind, key) {
    const pg = progFor(user);
    const d = dailyFor(user, pg);
    for (const rec of d.list) {
      const def = DAILY_POOL[rec.i];
      if (trackEvent(rec, def, kind, key)) {
        rec.done = true;
        Promise.resolve(ctx.awardCents(user, def.pay)).catch(() => { });
        txLog(user, 'daily quest', def.pay, def.t);
        awardXp(user, 10);
        const arr = DQ_DONE.get(user) || []; arr.push({ t: def.t, pay: def.pay, weekly: false }); DQ_DONE.set(user, arr);
      }
    }
    const w = weeklyFor(user, pg);
    const wdef = WEEKLY_POOL[w.i];
    if (trackEvent(w, wdef, kind, key)) {
      w.done = true;
      Promise.resolve(ctx.awardCents(user, wdef.pay)).catch(() => { });
      txLog(user, 'weekly quest', wdef.pay, wdef.t);
      awardXp(user, 30);
      const arr = DQ_DONE.get(user) || []; arr.push({ t: wdef.t, pay: wdef.pay, weekly: true }); DQ_DONE.set(user, arr);
    }
    progSave(user);
  }
  function activeDef(user) {
    const pg = progFor(user);
    if ((pg.story || 0) < STORY.length) return STORY[pg.story || 0];
    return QUESTS[questFor(user).qi];
  }
  function dchalGameId() {
    return GAMES_MOD.GAMES[hashStr('dchal:' + ctx.scoreDay()) % GAMES_MOD.GAMES.length].id;
  }
  function dailyView(user) {
    const pg = progFor(user);
    const d = dailyFor(user, pg);
    return d.list.map((rec) => { const def = DAILY_POOL[rec.i]; return { t: def.t, prog: Math.min(Math.floor(rec.prog), def.n), n: def.n, pay: def.pay, done: !!rec.done }; });
  }
  function weeklyView(user) {
    const pg = progFor(user);
    const w = weeklyFor(user, pg);
    const def = WEEKLY_POOL[w.i];
    return { t: def.t, prog: Math.min(Math.floor(w.prog), def.n), n: def.n, pay: def.pay, done: !!w.done };
  }
  // ---- world events: a 5-minute window in every 20-minute cycle ----
  function worldEvent(now) {
    if (FORCE_EV) { if (now < FORCE_EV.endsAt) return FORCE_EV; FORCE_EV = null; }
    const CYC = 20 * 60 * 1000, WIN = 5 * 60 * 1000;
    const cyc = Math.floor(now / CYC), ph = now - cyc * CYC;
    if (ph < CYC - WIN) return null;
    return { type: cyc % 2 === 0 ? 'shardstorm' : 'goldenhunt', endsAt: (cyc + 1) * CYC, id: cyc };
  }
  let lastHuntGold = 0;
  let FORCE_EV = null;
  let ANN = null;
  // ---- parties ----
  const PARTIES = new Map();
  const PINV = new Map();
  let partySeq = 1;
  function partyOf(user) {
    for (const [id, pt] of PARTIES) if (pt.members.includes(user)) return { id, leader: pt.leader, members: pt.members.slice() };
    return null;
  }
  function partyView(user) {
    const pt = partyOf(user);
    return pt ? { leader: pt.leader, members: pt.members } : null;
  }
  function partyRemove(user) {
    const pt = partyOf(user);
    if (!pt) return;
    const rec = PARTIES.get(pt.id);
    rec.members = rec.members.filter((m) => m !== user);
    if (!rec.members.length) { PARTIES.delete(pt.id); return; }
    if (rec.leader === user) rec.leader = rec.members[0];
  }
  function blocksOf(user) { return wload('blocks', user) || []; }
  function lvlOfXp(xp) { let l = 1; while (xp >= 60 * l * (l + 1) / 2) l++; return l; }

  const TRAVEL_AT = new Map();
  function weatherOf(now) {
    const kinds = ['clear', 'clear', 'rain', 'fog', 'clear', 'stars'];
    return kinds[hashStr('wx:' + Math.floor(now / 3600000)) % kinds.length];
  }

  // ---- housing: maple row plots outside, instanced interiors in the band
  // below the overworld. A house instance is keyed by its OWNER: everyone in
  // the same house shares one room; the roster filter keeps instances apart.
  const HOUSE_STYLES = {
    cottage: { name: 'moon cottage', price: 0 },
    loft: { name: 'violet loft', price: 400 },
    den: { name: 'neon den', price: 900 },
    castle: { name: 'castle room', price: 2000 },
  };
  const FURN = {
    rug: { name: 'moon rug', price: 40, layer: 0 }, couch: { name: 'cloud couch', price: 180 },
    table: { name: 'oak table', price: 90 }, chair: { name: 'comfy chair', price: 60 },
    lamp: { name: 'star lamp', price: 75 }, shelf: { name: 'bookshelf', price: 140 },
    bed: { name: 'dream bed', price: 220 }, plant: { name: 'moon fern', price: 45 },
    tv: { name: 'tube tv', price: 260 }, tank: { name: 'fish tank', price: 350 },
    trophy: { name: 'trophy shelf', price: 300 }, window: { name: 'star window', price: 200 },
    paint: { name: 'moon painting', price: 120 }, plush: { name: 'six plush', price: 150 },
    candle: { name: 'candle set', price: 35 }, pumpkin: { name: 'harvest pumpkin', price: 85, seasonal: true },
    fire: { name: 'fireplace', price: 480, rare: 'rare' }, minicab: { name: 'mini arcade cab', price: 650, rare: 'rare' },
    throne: { name: 'mini throne', price: 1500, rare: 'legendary' }, ifountain: { name: 'indoor fountain', price: 1200, rare: 'legendary' },
  };
  const FURN_BY = {};
  for (const fid of Object.keys(FURN)) FURN_BY[fid] = Object.assign({ id: fid }, FURN[fid]);
  function houseOf(user) { const h = wload('house', user); return h && typeof h === 'object' ? h : { style: 'cottage', pub: 'public', items: [] }; }
  function houseSave(user, h) { wsave('house', user, h); }
  function furnInv(user) { const f = wload('furn', user); return Array.isArray(f) ? f : []; }
  function houseOrigin(user) { const s = hashStr('house:' + user) % 18; return { x: 300 + (s % 6) * 1020, y: 4460 + Math.floor(s / 6) * 620 }; }
  function canEnterHouse(me, owner) {
    if (me === owner) return true;
    const h = houseOf(owner);
    if (h.pub === 'public') return true;
    if (h.pub === 'party') { const pt = partyOf(me); return !!(pt && pt.members.includes(owner)); }
    return false;
  }
  function houseView(me, owner) {
    const h = houseOf(owner);
    const can = canEnterHouse(me, owner);
    return { ok: true, owner, style: h.style, pub: h.pub, mine: me === owner, canEnter: can, items: can ? (h.items || []) : [], origin: can ? houseOrigin(owner) : null, styles: HOUSE_STYLES, furn: FURN_BY, myFurn: me === owner ? furnInv(me) : [] };
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
        const wasTp = TP_OK.has(me);
        if (dd > maxStep && !wasTp) { nx = ox + (nx - ox) * maxStep / dd; ny = oy + (ny - oy) * maxStep / dd; }
        TP_OK.delete(me);
        p.x = nx; p.y = ny;
        // sustained-speed enforcement over a 6s window: mount caps (372 on foot) hold; dash bursts average out.
        // the budget carries a 0.6s-of-cap allowance because a step's distance is credited at ping arrival,
        // so window edges jitter by about a step — legit riders at cap speed must never trip it.
        // one clamped step = login desync grace (re-anchor); clamped steps in a row count as movement
        if (wasTp) { p.win = { t: now, d: 0, x: p.x, y: p.y }; p.clampStreak = 0; }
        else if (dd > maxStep && !p.clampStreak) { p.win = { t: now, d: 0, x: p.x, y: p.y }; p.clampStreak = 1; }
        else {
          p.clampStreak = dd > maxStep ? 2 : 0;
          const cap = (p.wear && p.wear.mount) ? (MOUNT_SPEED[p.wear.mount.kind] || 350) : 372;
          const stepD = dist(ox, oy, p.x, p.y);
          if (!p.win || now - p.win.t > 6000) { p.win = { t: now, d: 0, x: p.x, y: p.y }; }
          else {
            p.win.d += stepD;
            const wEl = (now - p.win.t) / 1000;
            if (wEl > 2 && p.win.d > cap * wEl * 1.05 + cap * 0.6) { p.x = p.win.x; p.y = p.win.y; p.win = { t: now, d: 0, x: p.x, y: p.y }; }
          }
        }
      }
      if (!p.house && p.y > 4380) p.y = 4380;
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
      // meeting people: standing close to another player counts them (the
      // loop always runs so daily/weekly meet quests progress too — the
      // event itself no-ops for quests that are not meet-kind)
      for (const [ou, op] of P) { if (ou !== me && (op.house || null) === (p.house || null) && dist(p.x, p.y, op.x, op.y) < 95) questDone = questEvent(me, 'meet', ou) || questDone; }
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
          let amt = s.gold ? GOLD_PAY : SHARD_PAY;
          if (!s.gold && worldEvent(now) && worldEvent(now).type === 'shardstorm') amt *= 2;
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
      let gotC = null;
      for (const c of CRYSTALS) {
        if (pg.crystals.indexOf(c.id) >= 0) continue;
        if (dist(p.x, p.y, c.x, c.y) < 58) {
          pg.crystals.push(c.id);
          pg.c.crystal = (pg.c.crystal || 0) + 1;
          let bal = null;
          try { bal = await ctx.awardCents(me, c.pay); } catch { }
          gotC = { amt: c.pay, rare: c.rare, bal };
          txLog(me, 'crystal', c.pay, c.rare + ' crystal');
          try { dailyEvent(me, 'crystal'); } catch { }
          awardXp(me, 8);
          progSave(me);
          achCheck(me);
          break;
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
        ok: true, me, players: roster(now).filter((pl) => (pl.npc ? !p.house : (((P.get(pl.u) || {}).house || null) === (p.house || null))) && (pl.npc || pl.u === me || (!(wload('blocks', me) || []).includes(pl.u) && !(wload('blocks', pl.u) || []).includes(me)))), sig, n: P.size, bal: (() => { try { return ctx.getCents(me); } catch { return null; } })(),
        inv: (() => { try { return ctx.getInv(me); } catch { return []; } })(),
        wearIds: (() => { try { return ctx.getWear(me); } catch { return {}; } })(),
        shards: shards.map((s) => ({ id: s.id, x: s.x, y: s.y, gold: s.gold })),
        lb: leaderboard(), quest: questView(me),
        today: { shards: st.shards, golds: st.golds },
        zone: p.house ? (p.house === me ? 'ur house' : '@' + p.house + "'s house") : (p.zone ? zoneName(p.zone) : ''), got, questDone, srvNow: now,
        duelIn: duelInFor(me, now), duel: duelFor(me, now), duelDone: duelDoneFor(me, now),
        prog: progView(me), disc, gotC,
        house: p.house || null,
        petNames: wload('petname', me) || {},
        crys: CRYSTALS.map((c) => ({ id: c.id, x: c.x, y: c.y, rare: c.rare, got: pg.crystals.indexOf(c.id) >= 0 })),
        lvlUp: (() => { const v = LVLUP.get(me) || null; LVLUP.delete(me); return v; })(),
        achNew: (() => { const v = ACHNEW.get(me) || []; ACHNEW.delete(me); return v; })(),
        dqDone: (() => { const v = DQ_DONE.get(me) || []; DQ_DONE.delete(me); return v; })(),
        dchal: { id: dchalGameId(), done: wload('dchal', me) === ctx.scoreDay() },
        party: partyView(me),
        partyInv: (() => { const iv = PINV.get(me); return iv && now - iv.at < 90000 ? { from: iv.from } : null; })(),
        event: worldEvent(now),
        myBlocks: wload('blocks', me) || [],
        ann: ANN && now - ANN.at < 120000 ? ANN : null,
        isAdmin: !!ctx.isAdmin(me),
        weather: weatherOf(now),
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

    if (u.pathname === '/api/world/party' && req.method === 'POST') {
      const act = String(b.act || '');
      const target = String(b.user || '').toLowerCase();
      if (act === 'invite') {
        if (!target || target === me || !P.has(target)) { J({ ok: false, err: 'they are not in the world rn' }, 400); return true; }
        if (blocksOf(me).includes(target) || blocksOf(target).includes(me)) { J({ ok: false, err: 'blocked' }, 400); return true; }
        let pt = partyOf(me);
        if (!pt) { const id = 'p' + (partySeq++); PARTIES.set(id, { leader: me, members: [me] }); pt = { id, leader: me, members: [me] }; }
        if (pt.members.includes(target)) { J({ ok: false, err: 'already in ur party' }, 400); return true; }
        if (pt.members.length >= 5) { J({ ok: false, err: 'party is full (5)' }, 400); return true; }
        const tp = partyOf(target);
        if (tp && tp.id !== pt.id) { J({ ok: false, err: 'they are in another party' }, 400); return true; }
        PINV.set(target, { from: me, pid: pt.id, at: now });
        J({ ok: true });
        return true;
      }
      if (act === 'accept') {
        const iv = PINV.get(me);
        if (!iv || now - iv.at > 90000) { J({ ok: false, err: 'invite expired' }, 400); return true; }
        PINV.delete(me);
        const rec = PARTIES.get(iv.pid);
        if (!rec) { J({ ok: false, err: 'that party ended' }, 400); return true; }
        if (rec.members.length >= 5) { J({ ok: false, err: 'party is full (5)' }, 400); return true; }
        partyRemove(me);
        rec.members.push(me);
        J({ ok: true, party: partyView(me) });
        return true;
      }
      if (act === 'decline') { PINV.delete(me); J({ ok: true }); return true; }
      if (act === 'leave') { partyRemove(me); J({ ok: true }); return true; }
      if (act === 'kick') {
        const pt = partyOf(me);
        if (!pt || pt.leader !== me || !pt.members.includes(target)) { J({ ok: false, err: 'only the leader kicks, and only members' }, 400); return true; }
        partyRemove(target);
        J({ ok: true, party: partyView(me) });
        return true;
      }
      J({ ok: false, err: 'bad act' }, 400);
      return true;
    }

    if (u.pathname === '/api/world/block' && req.method === 'POST') {
      const target = String(b.user || '').toLowerCase();
      if (!target || target === me) { J({ ok: false, err: 'bad user' }, 400); return true; }
      const cur = (wload('blocks', me) || []).slice();
      const ix = cur.indexOf(target);
      if (b.act === 'unblock') { if (ix >= 0) cur.splice(ix, 1); }
      else if (ix < 0) { cur.push(target); const mp = partyOf(me); if (mp && mp.members.includes(target)) partyRemove(target); }
      wsave('blocks', me, cur.slice(0, 200));
      J({ ok: true, blocks: cur });
      return true;
    }

    if (u.pathname === '/api/world/report' && req.method === 'POST') {
      const target = String(b.user || '').toLowerCase();
      const why = String(b.why || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (!target || target === me) { J({ ok: false, err: 'bad user' }, 400); return true; }
      const reps = (ctx.wget('reports') || []).slice();
      reps.push({ by: me, user: target, why, at: now });
      while (reps.length > 200) reps.shift();
      try { ctx.wset('reports', reps); } catch { }
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/boards' && req.method === 'GET') {
      const all = ctx.wget('prog') || {};
      const rows = Object.keys(all).map((u2) => {
        const p = all[u2] || {};
        return { u: u2, xp: p.xp || 0, lvl: lvlOfXp(p.xp || 0), quests: (p.c || {}).quest || 0, shards: (p.c || {}).shard || 0, ach: Object.keys(p.ach || {}).length, crystals: (p.crystals || []).length };
      });
      const top = (k) => rows.slice().sort((a, b2) => b2[k] - a[k]).slice(0, 10).map((r) => ({ u: r.u, v: r[k], lvl: r.lvl }));
      J({ ok: true, boards: {
        levels: rows.slice().sort((a, b2) => b2.xp - a.xp).slice(0, 10).map((r) => ({ u: r.u, v: r.xp, lvl: r.lvl })),
        quests: top('quests'), shards: top('shards'), ach: top('ach'), crystals: top('crystals'),
        fish: fishBoard(Date.now(), wload('fishbest', '_fishbest') || {}),
      } });
      return true;
    }

    if (u.pathname === '/api/world/travel' && req.method === 'POST') {
      const zid = String(b.zone || '');
      const z = ZONES.find((zz) => zz.id === zid);
      const pgT = progFor(me);
      if (!z || !(pgT.zones || []).includes(zid)) { J({ ok: false, err: 'u havent discovered that zone yet' }, 400); return true; }
      if (now - (TRAVEL_AT.get(me) || 0) < 10000) { J({ ok: false, err: 'fast travel is recharging (10s)' }, 429); return true; }
      TRAVEL_AT.set(me, now);
      const p = P.get(me);
      if (p) { TP_OK.add(me); p.x = z.x; p.y = z.y; p.lx = z.x; p.ly = z.y; }
      J({ ok: true, x: z.x, y: z.y });
      return true;
    }

    if (u.pathname === '/api/world/preset' && req.method === 'POST') {
      const slot = Math.floor(Number(b.slot));
      const allPr = ctx.wget('presets') || {};
      const minePr = allPr[me] || {};
      if (b.act === 'get') { J({ ok: true, presets: minePr }); return true; }
      if (!(slot >= 1 && slot <= 3)) { J({ ok: false, err: 'bad slot' }, 400); return true; }
      if (b.act === 'save') {
        let wear = {};
        try { wear = ctx.getWear(me) || {}; } catch { }
        minePr[slot] = wear;
        allPr[me] = minePr;
        try { ctx.wset('presets', allPr); } catch { }
        J({ ok: true, presets: minePr });
        return true;
      }
      if (b.act === 'apply') {
        const saved = minePr[slot];
        if (!saved) { J({ ok: false, err: 'nothing saved in that slot yet' }, 400); return true; }
        let inv = [];
        try { inv = ctx.getInv(me) || []; } catch { }
        const wear = {};
        for (const cat of ['trail', 'hat', 'aura', 'pet', 'face', 'mount', 'rod']) { if (saved[cat] && inv.includes(saved[cat])) wear[cat] = saved[cat]; }
        try { ctx.setWear(me, wear); } catch { }
        const p = P.get(me);
        if (p) p.wear = wearOf(me);
        J({ ok: true, wear });
        return true;
      }
      J({ ok: false, err: 'bad act' }, 400);
      return true;
    }

    if (u.pathname === '/api/world/admin' && req.method === 'GET') {
      if (!ctx.isAdmin(me)) { J({ ok: false, err: 'admins only' }, 403); return true; }
      const progAll = ctx.wget('prog') || {};
      let circ = 0;
      for (const u2 of Object.keys(progAll)) { try { circ += ctx.getCents(u2) || 0; } catch { } }
      const txAll = ctx.wget('tx') || {};
      const recent = [];
      for (const [u2, list] of Object.entries(txAll)) for (const t of (list || [])) recent.push({ u: u2, kind: t.kind, amt: t.amt, what: t.what, at: t.at });
      recent.sort((a, b2) => b2.at - a.at);
      J({ ok: true, online: P.size, players: Object.keys(progAll).length, centsInCirc: circ, parties: PARTIES.size, event: worldEvent(now), weather: weatherOf(now), reports: (ctx.wget('reports') || []).slice(-20).reverse(), recentTx: recent.slice(0, 20) });
      return true;
    }

    if (u.pathname === '/api/world/admin' && req.method === 'POST') {
      if (!ctx.isAdmin(me)) { J({ ok: false, err: 'admins only' }, 403); return true; }
      if (b.act === 'announce') { ANN = { text: String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 160), at: now }; J({ ok: true }); return true; }
      if (b.act === 'event') {
        const t = String(b.type || '');
        if (t === 'off') FORCE_EV = null;
        else if (t === 'shardstorm' || t === 'goldenhunt') FORCE_EV = { type: t, endsAt: now + 5 * 60 * 1000, id: 'f' + now };
        else { J({ ok: false, err: 'bad type' }, 400); return true; }
        J({ ok: true, event: worldEvent(now) });
        return true;
      }
      J({ ok: false, err: 'bad act' }, 400);
      return true;
    }

    if (u.pathname === '/api/world/fish' && req.method === 'GET') {
      let inv = [];
      try { inv = ctx.getInv(me) || []; } catch { }
      const wof = wearOf(me);
      const fd = wload('fishday', me) || {};
      const day = ctx.scoreDay();
      J({ ok: true, species: FISH_SPECIES.map((s) => ({ id: s.id, name: s.name, band: s.band, pay: s.pay, c: s.c })), log: wload('fishlog', me) || {}, rods: ['s155', 's156', 's157', 's158'].map((id) => { const it = SHOP.BY_ID[id]; return { id, name: it.name, price: it.price, luck: ROD_LUCK[it.kind], owned: inv.includes(id), equipped: !!(wof.rod && wof.rod.id === id) }; }), daily: { n: fd.day === day ? (fd.n || 0) : 0, need: 3, paid: fd.day === day && !!fd.paid }, best: fishBoard(Date.now(), wload('fishbest', '_fishbest') || {}) });
      return true;
    }
    if (u.pathname === '/api/world/fish-cast' && req.method === 'POST') {
      const p = P.get(me);
      if (!fishSpot(p)) { J({ ok: false, err: 'fish from the lake shore or the pier' }, 400); return true; }
      const wof = wearOf(me);
      if (!wof.rod) { J({ ok: false, err: 'u need a rod equipped — grab one in the fishing panel' }, 400); return true; }
      const luck = ROD_LUCK[wof.rod.kind] || 1;
      const waitMs = Math.max(1600, Math.round((2200 + Math.random() * 4200) * (1 - (luck - 1) * 0.12)));
      FISH.set(me, { biteAt: Date.now() + waitMs, luck });
      J({ ok: true, waitMs });
      return true;
    }
    if (u.pathname === '/api/world/fish-reel' && req.method === 'POST') {
      const rec = FISH.get(me);
      if (!rec) { J({ ok: false, err: 'no line in the water' }, 400); return true; }
      const p = P.get(me);
      if (!fishSpot(p)) { FISH.delete(me); J({ ok: false, err: 'u wandered off — line pulled in' }, 400); return true; }
      const now2 = Date.now();
      if (now2 < rec.biteAt - 150) { FISH.delete(me); J({ ok: false, err: 'too soon — scared it off' }); return true; }
      if (now2 > rec.biteAt + 900) { FISH.delete(me); J({ ok: false, err: 'too late — it slipped away' }); return true; }
      FISH.delete(me);
      let tot = 0;
      const ws = FISH_SPECIES.map((s) => { const w2 = s.w * Math.pow(rec.luck, FISH_BAND_I[s.band] * 0.25); tot += w2; return w2; });
      let roll = Math.random() * tot, sp = FISH_SPECIES[0];
      for (let i = 0; i < FISH_SPECIES.length; i++) { roll -= ws[i]; if (roll <= 0) { sp = FISH_SPECIES[i]; break; } }
      const kg = Math.round((sp.w0 + Math.random() * (sp.w1 - sp.w0)) * 10) / 10;
      let bal = null;
      if (sp.pay > 0) { try { bal = await ctx.awardCents(me, sp.pay); } catch { } txLog(me, 'fish', sp.pay, sp.name); }
      awardXp(me, 4);
      const pg = progFor(me);
      pg.c.fish = (pg.c.fish || 0) + 1;
      achCheck(me);
      const log = wload('fishlog', me) || {};
      const le = log[sp.id] || { n: 0, max: 0 };
      le.n += 1; le.max = Math.max(le.max, kg);
      log[sp.id] = le;
      wsave('fishlog', me, log);
      const day = ctx.scoreDay();
      const fd = wload('fishday', me) || {};
      const fdN = (fd.day === day ? (fd.n || 0) : 0) + 1;
      let dailyBonus = 0;
      if (fdN >= 3 && !(fd.day === day && fd.paid)) {
        dailyBonus = 25;
        try { bal = await ctx.awardCents(me, 25); } catch { }
        txLog(me, 'fish', 25, 'daily catch bonus');
        wsave('fishday', me, { day, n: fdN, paid: true });
      } else wsave('fishday', me, { day, n: fdN, paid: fd.day === day && !!fd.paid });
      if (sp.band !== 'junk') {
        const fb = wload('fishbest', '_fishbest') || {};
        const wk = fishWeek(now2);
        const rows = (fb.wk === wk && fb.rows) ? fb.rows : {};
        if (!rows[me] || rows[me].w < kg) rows[me] = { sp: sp.name, w: kg };
        wsave('fishbest', '_fishbest', { wk, rows });
      }
      J({ ok: true, sp: { id: sp.id, name: sp.name, band: sp.band, pay: sp.pay, c: sp.c }, kg, bal, dailyBonus, first: le.n === 1 });
      return true;
    }
    if (u.pathname === '/api/world/pet-name' && req.method === 'POST') {
      const it = SHOP.BY_ID[String(b.id || '')];
      if (!it || it.cat !== 'pet') { J({ ok: false, err: 'bad pet' }, 400); return true; }
      let owned = false;
      try { owned = ctx.getInv(me).includes(it.id); } catch { }
      if (!owned) { J({ ok: false, err: 'u don\'t own that pet' }, 403); return true; }
      const name = String(b.name || '').replace(/[<>&"']/g, '').trim().slice(0, 14);
      const all = wload('petname', me) || {};
      if (name) all[it.id] = name; else delete all[it.id];
      wsave('petname', me, all);
      J({ ok: true, names: all });
      return true;
    }
    if (u.pathname === '/api/world/house' && req.method === 'GET') {
      const owner = String(u.searchParams.get('u') || me).toLowerCase();
      J(houseView(me, owner));
      return true;
    }
    if (u.pathname === '/api/world/houses' && req.method === 'GET') {
      const out = [];
      for (const [usr] of P) { if (usr !== me && canEnterHouse(me, usr)) out.push({ u: usr, style: houseOf(usr).style }); }
      J({ ok: true, houses: out.slice(0, 30) });
      return true;
    }
    if (u.pathname === '/api/world/house-enter' && req.method === 'POST') {
      const owner = String(b.u || me).toLowerCase();
      const p = P.get(me);
      if (!p) { J({ ok: false, err: 'enter the world first' }, 400); return true; }
      if (!canEnterHouse(me, owner)) { J({ ok: false, err: owner === me ? 'locked' : 'that house is ' + houseOf(owner).pub + ' rn' }, 403); return true; }
      const o = houseOrigin(owner);
      p.house = owner;
      TP_OK.add(me);
      p.x = o.x + 430; p.y = o.y + 460; p.at = now;
      J({ ok: true, x: p.x, y: p.y, owner });
      return true;
    }
    if (u.pathname === '/api/world/house-exit' && req.method === 'POST') {
      const p = P.get(me);
      if (!p) { J({ ok: false, err: 'enter the world first' }, 400); return true; }
      p.house = null;
      TP_OK.add(me);
      p.x = 900; p.y = 3180; p.at = now;
      J({ ok: true, x: p.x, y: p.y });
      return true;
    }
    if (u.pathname === '/api/world/house-buy' && req.method === 'POST') {
      if (BUYLOCK.has(me)) { J({ ok: false, err: 'one purchase at a time' }, 429); return true; }
      const kind = String(b.kind || ''), id = String(b.id || '');
      let price = -1, label = '';
      if (kind === 'style' && HOUSE_STYLES[id]) { price = HOUSE_STYLES[id].price; label = HOUSE_STYLES[id].name; }
      else if (kind === 'furn' && FURN[id]) { price = FURN[id].price; label = FURN[id].name; }
      if (price < 0) { J({ ok: false, err: 'bad item' }, 400); return true; }
      if (kind === 'style' && houseOf(me).style === id) { J({ ok: false, err: 'ur house already looks like that' }); return true; }
      let bal0 = 0;
      try { bal0 = ctx.getCents(me); } catch { }
      if (bal0 < price) { J({ ok: false, err: 'not enough six cents (need ' + price + ')' }); return true; }
      BUYLOCK.add(me);
      setTimeout(() => BUYLOCK.delete(me), 1500);
      let bal = bal0;
      try { bal = await ctx.awardCents(me, -price); } catch { }
      if (kind === 'style') { const h = houseOf(me); h.style = id; houseSave(me, h); }
      else { const f = furnInv(me); f.push(id); wsave('furn', me, f); }
      txLog(me, 'house', -price, label);
      J({ ok: true, bal, view: houseView(me, me) });
      return true;
    }
    if (u.pathname === '/api/world/house-place' && req.method === 'POST') {
      const p = P.get(me);
      if (!p || p.house !== me) { J({ ok: false, err: 'u can only decorate ur own house, from inside it' }, 403); return true; }
      const fid = String(b.fid || '');
      const def = FURN[fid];
      const gx = Math.round(Number(b.gx)), gy = Math.round(Number(b.gy));
      const rot = [0, 90, 180, 270].includes(Number(b.rot)) ? Number(b.rot) : 0;
      if (!def || !(gx >= 0 && gx < 20 && gy >= 0 && gy < 12)) { J({ ok: false, err: 'bad placement' }, 400); return true; }
      const h = houseOf(me);
      h.items = h.items || [];
      if (h.items.length >= 60) { J({ ok: false, err: 'house is full (60 pieces)' }); return true; }
      const owned = furnInv(me).filter((f) => f === fid).length;
      const placed = h.items.filter((it) => it.f === fid).length;
      if (placed >= owned) { J({ ok: false, err: 'u don\'t have another one of those' }); return true; }
      const clash = h.items.find((it) => it.gx === gx && it.gy === gy && (FURN[it.f] && FURN[it.f].layer !== 0) && def.layer !== 0);
      if (clash) { J({ ok: false, err: 'something is already there' }); return true; }
      h.items.push({ f: fid, gx, gy, r: rot });
      houseSave(me, h);
      J({ ok: true, items: h.items });
      return true;
    }
    if (u.pathname === '/api/world/house-unplace' && req.method === 'POST') {
      const p = P.get(me);
      if (!p || p.house !== me) { J({ ok: false, err: 'u can only decorate ur own house, from inside it' }, 403); return true; }
      const gx = Math.round(Number(b.gx)), gy = Math.round(Number(b.gy));
      const h = houseOf(me);
      h.items = h.items || [];
      const i = h.items.findIndex((it) => it.gx === gx && it.gy === gy);
      if (i < 0) { J({ ok: false, err: 'nothing there' }, 400); return true; }
      h.items.splice(i, 1);
      houseSave(me, h);
      J({ ok: true, items: h.items });
      return true;
    }
    if (u.pathname === '/api/world/house-privacy' && req.method === 'POST') {
      const level = String(b.level || '');
      if (!['public', 'party', 'private'].includes(level)) { J({ ok: false, err: 'bad level' }, 400); return true; }
      const h = houseOf(me);
      h.pub = level;
      houseSave(me, h);
      J({ ok: true, pub: level });
      return true;
    }
    if (u.pathname === '/api/world/portal' && req.method === 'POST') {
      const id = String(b.id || '').slice(0, 20);
      // the pad claim is verified against the player's server position —
      // portal quests can no longer be farmed from anywhere on the map
      const pad = PORTAL_PADS[id];
      const pp2 = P.get(me);
      if (!pad || !pp2 || dist(pp2.x, pp2.y, pad[0], pad[1]) > 150) { J({ ok: false, err: 'stand on the portal pad first' }, 400); return true; }
      const qd = questEvent(me, 'portal', id);
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
        try { dailyEvent(me, 'mini'); } catch { }
        const pgm = progFor(me); pgm.c.mini = (pgm.c.mini || 0) + 1; progSave(me); awardXp(me, 4); achCheck(me);
      }
      let pb = null, newBest = false, dchalBonus = 0;
      if (pts > 0) {
        const allPb = ctx.wget('pb') || {};
        const mine = allPb[me] || {};
        if (pts > (mine[g.id] || 0)) { mine[g.id] = pts; allPb[me] = mine; try { ctx.wset('pb', allPb); } catch { } newBest = true; }
        pb = mine[g.id] || pts;
        if (paid && g.id === dchalGameId() && wload('dchal', me) !== mday) {
          wsave('dchal', me, mday);
          dchalBonus = 15;
          coins += 15;
          try { await ctx.awardCents(me, 15); } catch { }
          txLog(me, 'daily challenge', 15, g.name);
        }
      }
      let bal = null;
      try { bal = ctx.getCents(me); } catch { }
      J({ ok: true, cents: coins, paid, playsLeft: Math.max(0, 3 - (rec.plays[g.id] || 0)), bal, pb, newBest, dchalBonus });
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
      if (it.vaultOnly) { J({ ok: false, err: 'that one is not for sale — it waits somewhere hidden' }); return true; }
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
      if (!['trail', 'hat', 'aura', 'pet', 'face', 'mount', 'rod'].includes(cat)) { J({ ok: false, err: 'bad category' }, 400); return true; }
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
    if (u.pathname === '/api/world/quests' && req.method === 'GET') {
      const pg = progFor(me);
      J({ ok: true, chain: questView(me), daily: dailyView(me), weekly: weeklyView(me), story: { step: Math.min((pg.story || 0) + 1, STORY.length), total: STORY.length, doneAll: (pg.story || 0) >= STORY.length } });
      return true;
    }
    if (u.pathname === '/api/world/door' && req.method === 'POST') {
      const d = DOORS[String(b.id || '')];
      const p = P.get(me);
      if (!d || !p) { J({ ok: false, err: 'no door here' }); return true; }
      if (dist(p.x, p.y, d.fx, d.fy) > 110) { J({ ok: false, err: 'stand at the door first' }); return true; }
      TP_OK.add(me);
      p.x = d.tx; p.y = d.ty;
      J({ ok: true, x: d.tx, y: d.ty });
      return true;
    }
    if (u.pathname === '/api/world/vault-claim' && req.method === 'POST') {
      const p = P.get(me);
      if (!p || zoneAt(p.x, p.y) !== 'vault') { J({ ok: false, err: 'the crown waits in the vault' }); return true; }
      let inv = [];
      try { inv = ctx.getInv(me) || []; } catch { }
      if (inv.indexOf('s141') >= 0) { J({ ok: false, err: 'u already carry the vault crown' }); return true; }
      inv.push('s141');
      try { ctx.setInv(me, inv); } catch { }
      txLog(me, 'vault', 0, 'claimed the vault crown');
      awardXp(me, 25);
      achCheck(me);
      J({ ok: true, inv });
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
      // server-timed reaction: the tap's arrival is the measurement. Any
      // client-sent ms is ignored — self-reported times were forgeable.
      const goAt = d.startAt + d.delay;
      const ms = now < goAt ? 6000 : Math.min(6000, now - goAt);
      if (d.a === me) { if (d.ra == null) d.ra = ms; } else if (d.rb == null) d.rb = ms;
      if (d.ra != null && d.rb != null) settleDuel(d);
      J({ ok: true, ms });
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
      if (blocksOf(me).includes(to) || blocksOf(to).includes(me)) { J({ ok: true }); return true; }
      const sigWin = (SIG_WIN.get(me) || []).filter((t) => now - t < 2000);
      if (sigWin.length >= 40) { J({ ok: true }); return true; }
      sigWin.push(now); SIG_WIN.set(me, sigWin);
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
      '    <div id="wevent" hidden></div>\n' +
      '    <div id="wparty" hidden></div>\n' +
      '    <div id="wlb" hidden></div>\n' +
      '  </div>\n' +
      '  <div class="wbtns">\n' +
      '    <button id="wshopbtn" type="button" title="six cents shop"><span class="wcent">\u00a2</span></button>\n' +
      '    <button id="wgames" type="button" title="minigames"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.2-.022.63-.022 1.41a5 5 0 0 0 8.303 4.743 1 1 0 0 1 .984-.27h.066a1 1 0 0 1 .984.27A5 5 0 0 0 21.32 10c0-.78-.016-1.21-.022-1.41A4 4 0 0 0 17.32 5z"/></svg></button>\n' +
      '    <button id="wcharbtn" type="button" title="your character"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>\n' +
      '    <button id="wachbtn" type="button" title="achievements"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg></button>\n' +
      '    <button id="wboardsbtn" type="button" title="leaderboards"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M8 17v-6"/><path d="M13 17V7"/><path d="M18 17v-9"/></svg></button>\n' +
      '    <button id="whubbtn" type="button" title="menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></button>\n' +
      '    <button id="wadminbtn" type="button" title="world admin" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg></button>\n' +
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
      '<div id="wjournal" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 quest journal</span><button id="wjournal-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wjournal-body"></div>\n' +
      '</div></div>\n' +
      '<div id="wprof" hidden><div class="wprof-card">\n' +
      '  <div id="wprof-banner"></div><button id="wprof-x" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>\n' +
      '  <div class="wprof-body"><div id="wprof-av"></div><div id="wprof-name"></div><div id="wprof-user"></div><div id="wprof-meta"></div><div id="wprof-badges"></div><div id="wprof-stats"></div><div id="wprof-wear"></div>\n' +
      '  <div class="wprof-acts"><button id="wprof-add" type="button">add friend</button><button id="wprof-battle" type="button">battle</button><a id="wprof-link" href="#">full profile</a></div>\n' +
      '  <div class="wprof-acts2"><button id="wprof-invite" type="button">party invite</button><button id="wprof-mute" type="button">mute</button><button id="wprof-block" type="button">block</button><button id="wprof-report" type="button">report</button><button id="wprof-visit" type="button">visit house</button></div></div>\n' +
      '</div></div>\n' +
      '<div id="wduel" hidden><span id="wduel-t"></span><button id="wduel-yes" type="button">accept</button><button id="wduel-no" type="button">nah</button></div>\n' +
      '<div id="wparty-inv" hidden><span id="wparty-inv-t"></span><button id="wparty-yes" type="button">join party</button><button id="wparty-no" type="button">nah</button></div>\n' +
      '<div id="wboards" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 leaderboards</span><button id="wboards-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wboards-body"></div>\n' +
      '</div></div>\n' +
      '<div id="whub" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 six\'s network</span><button id="whub-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="whub-grid"></div>\n' +
      '</div></div>\n' +
      '<div id="winv" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 ur stuff</span><button id="winv-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <input id="winv-q" type="search" placeholder="search ur items\u2026" autocomplete="off">\n' +
      '  <div id="winv-cats"></div>\n' +
      '  <div id="winv-presets"></div>\n' +
      '  <div id="winv-grid"></div>\n' +
      '</div></div>\n' +
      '<div id="wmap2" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 world map</span><button id="wmap2-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <canvas id="wmap2-cv" width="640" height="430"></canvas>\n' +
      '  <div class="wmap2-hint">tap a discovered zone to fast travel (10s recharge)</div>\n' +
      '</div></div>\n' +
      '<div id="wsettings" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 settings</span><button id="wsettings-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <label class="wset-row"><span>volume</span><input id="wset-vol" type="range" min="0" max="100" step="1"></label>\n' +
      '  <label class="wset-row"><span>ambient music</span><input id="wset-music" type="checkbox"></label>\n' +
      '  <label class="wset-row"><span>sound effects</span><input id="wset-sfx" type="checkbox"></label>\n' +
      '  <div class="wset-note">the world breathes: day + night cycle, weather rolls in, six hums under everything.</div>\n' +
      '</div></div>\n' +
      '<div id="wadmin" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 world admin</span><button id="wadmin-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wadmin-body"></div>\n' +
      '  <div class="wadmin-row"><input id="wadmin-ann" type="text" maxlength="160" placeholder="announce to the whole world\u2026"><button id="wadmin-send" type="button">send</button></div>\n' +
      '  <div class="wadmin-row"><button class="wadmin-ev" data-ev="shardstorm" type="button">force shard storm</button><button class="wadmin-ev" data-ev="goldenhunt" type="button">force golden hunt</button><button class="wadmin-ev" data-ev="off" type="button">events off</button></div>\n' +
      '</div></div>\n' +
      '<div id="wfish" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 fishing</span><button id="wfish-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wfish-body"></div></div></div>\n' +
      '<div id="wpets" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 pet journal</span><button id="wpets-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wpets-body"></div></div></div>\n' +
      '<div id="whouse" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 <span id="whouse-t">ur house</span></span><button id="whouse-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="whouse-body"></div></div></div>\n' +
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
