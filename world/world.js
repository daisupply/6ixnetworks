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
const MAP_H = 7600; // 4200 of overworld + housing band (4400+) + crypt band (6460+)
const STALE_MS = 7000;
const RACE_COURSES = {
  skyline: { name: 'skyline sprint', startLabel: 'the sky islands (climb from the rooftops)', r: 85, pts: [[5650, 430], [5400, 380], [5200, 250], [5650, 180], [6150, 300], [5650, 430]] },
  grandtour: { name: 'the grand tour', startLabel: 'spawn plaza', r: 135, pts: [[2400, 1700], [700, 900], [650, 2100], [2400, 2400], [3950, 1600], [3950, 480], [3400, 750], [2400, 1700]] }
};
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
  { id: 'lake', name: 'the moonlit lake', x: 2400, y: 2600, r: 400 },
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
  const BOSS_POS = { x: 2400, y: 2600 };
  const BOSS_CYCLE = 1500000, BOSS_LIVE_FROM = 1200000;
  let BOSS = null;
  const STUN = new Map(), BOSS_HIT_CD = new Map(), DUN_HIT_CD = new Map();
  const DUNGEONS = new Map();
  const CRYPT_GATE = { x: 5050, y: 3550 };
  let SURGE = false;
  function bossLive(now) { return SURGE || (now % BOSS_CYCLE) >= BOSS_LIVE_FROM; }
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
  const RACES = new Map();
  const RACE_FLASH = new Map();
  const RACE_FIN = new Map();
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
  const BUYLOCK = new Set();   // users with a purchase in flight (operation-scoped: set on entry, cleared in finally)
  const CRAFT_INFLIGHT = new Set(); // users with a craft in flight
  const GUILD_INFLIGHT = new Set(); // users with a guild create/claim in flight
  const SKILL_INFLIGHT = new Set(); // users with a skill milestone payout in flight
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
    const evX = worldEvent(Date.now());
    if (evX && evX.type === 'doublexp') amt *= 2;
    const pg = progFor(user);
    const before = levelOf(pg.xp || 0);
    pg.xp = (pg.xp || 0) + amt;
    seasonXpAdd(user, amt);
    const after = levelOf(pg.xp);
    if (after > before) LVLUP.set(user, { lvl: after, title: titleOf(after) });
    progSave(user);
    guildXpAdd(user, amt);
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
    { id: 'event-goer', name: 'event goer', desc: 'take part in 5 world events', cat: 'events', reward: 30, test: (pg) => (pg.c.evpart || 0) >= 5 },
    { id: 'event-regular', name: 'event regular', desc: 'take part in 20 world events', cat: 'events', reward: 80, test: (pg) => (pg.c.evpart || 0) >= 20 },
    { id: 'champion', name: 'champion', desc: 'win a derby or tournament', cat: 'events', reward: 100, test: (pg) => (pg.c.evwin || 0) >= 1 },
    { id: 'event-legend', name: 'event legend', desc: 'win 5 derbies or tournaments', cat: 'events', reward: 250, test: (pg) => (pg.c.evwin || 0) >= 5 },
    { id: 'collector', name: 'collector', desc: 'complete any collection category', cat: 'collection', reward: 100, test: (pg) => (pg.c.colsets || 0) >= 1 },
    { id: 'grand-collector', name: 'grand collector', desc: 'complete 3 collection categories', cat: 'collection', reward: 300, test: (pg) => (pg.c.colsets || 0) >= 3 },
    { id: 'seasoned', name: 'seasoned', desc: 'reach season tier 10', cat: 'season', reward: 100, test: (pg) => (pg.c.sztier || 0) >= 10 },
    { id: 'season-master', name: 'season master', desc: 'complete the season track (tier 20)', cat: 'season', reward: 300, test: (pg) => (pg.c.sztier || 0) >= 20 },
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
    if (MTOK.size > 50) { for (const [k, v] of MTOK) if (now - v.at > 300000) MTOK.delete(k); }
    for (const [u, p] of P) if (now - p.at > STALE_MS) {
      P.delete(u); SIG.delete(u); PINV.delete(u); DUEL_CH.delete(u); FISH.delete(u); STUN.delete(u); BOSS_HIT_CD.delete(u); DUN_HIT_CD.delete(u); RACES.delete(u); RACE_FLASH.delete(u); RACE_FIN.delete(u);
      TINV.delete(u); MAT_GOT.delete(u);
      { const tid0 = TRADE_OF.get(u); if (tid0) { const t0 = TRADES.get(tid0); if (t0) { const other = t0.a === u ? t0.b : t0.a; TRADE_FLASH.set(other, { msg: 'trade ended \u2014 @' + u + ' left', at: Date.now() }); TRADES.delete(tid0); TRADE_OF.delete(other); } TRADE_OF.delete(u); } }
      if (p.inst) { const dg = DUNGEONS.get(p.inst); if (dg) { dg.members.delete(u); if (!dg.members.size) DUNGEONS.delete(p.inst); } }
      for (const [did, d] of DUELS) if (!d.settled && (d.a === u || d.b === u)) DUELS.delete(did);
      const pt = partyOf(u);
      if (pt && !pt.members.some((m) => m !== u && P.has(m))) for (const m of pt.members.slice()) partyRemove(m);
    }
  }

  function cryptOrigin(instId) { const s = hashStr(instId) % 4; return { x: 300 + (s % 2) * 2400, y: 6460 + Math.floor(s / 2) * 600 }; }
  function bossEnsure(now) {
    const c = Math.floor(now / BOSS_CYCLE);
    if (!BOSS || BOSS.cycle !== c) BOSS = { cycle: c, hp: 900, max: 900, dead: false, dmg: new Map(), hits: new Map(), slamAt: now + 12000 };
    return bossLive(now) ? BOSS : null;
  }
  function bossPhase() { if (!BOSS) return 1; const f = BOSS.hp / BOSS.max; return f > 0.66 ? 1 : f > 0.33 ? 2 : 3; }
  function bossTick(now) {
    const bs = bossEnsure(now); if (!bs || bs.dead) return;
    if (now >= bs.slamAt) {
      const R = bossPhase() >= 2 ? 170 : 140;
      for (const [u, p] of P) { if (!p.house && !p.inst && dist(p.x, p.y, BOSS_POS.x, BOSS_POS.y) < R) STUN.set(u, now + 3000); }
      bs.slamAt = now + (bossPhase() >= 2 ? 9000 : 12000);
    }
  }
  function bossView(me, now) {
    const bs = bossEnsure(now); if (!bs) return null;
    bossTick(now);
    return { x: BOSS_POS.x, y: BOSS_POS.y, hp: Math.max(0, Math.round(bs.hp)), max: bs.max, dead: bs.dead, phase: bossPhase(), slamIn: Math.max(0, bs.slamAt - now), stun: Math.max(0, (STUN.get(me) || 0) - now) };
  }


  const GINV = new Map();
  const GMSG = new Map();
  const GSAY_CD = new Map();
  const GUILD_EMBLEMS = ['star', 'moon', 'bolt', 'wave', 'gem', 'crown', 'leaf', 'ghost'];
  const GUILD_MS = [10, 25, 50];
  function guildReg() { return wload('guilds', '_guilds') || {}; }
  function guildSaveReg(reg) { wsave('guilds', '_guilds', reg); }
  function guildOf(user) { const gid = wload('guild', user); if (!gid) return null; const g = guildReg()[gid]; return g ? { gid, g } : null; }
  function guildTagOf(user) { const go = guildOf(user); return go ? go.g.tag : null; }
  function guildLvl(xp) { return Math.floor(Math.sqrt((xp || 0) / 120)) + 1; }
  function guildWkScore(g, now) { const wk = raceWeekKey(now); if (!g.wk || g.wk.key !== wk) return 0; return (g.wk.race || 0) + (g.wk.crypt || 0) + (g.wk.boss || 0); }
  function guildWkBump(user, kind, now) {
    const go = guildOf(user); if (!go) return;
    const wk = raceWeekKey(now);
    if (!go.g.wk || go.g.wk.key !== wk) go.g.wk = { key: wk, race: 0, crypt: 0, boss: 0 };
    go.g.wk[kind] = (go.g.wk[kind] || 0) + 1;
    const reg = guildReg(); reg[go.gid] = go.g; guildSaveReg(reg);
  }
  function guildXpAdd(user, amt) {
    const go = guildOf(user); if (!go) return;
    go.g.xp = (go.g.xp || 0) + amt;
    const reg = guildReg(); reg[go.gid] = go.g; guildSaveReg(reg);
  }
  function guildJoin(user, gid) {
    const reg = guildReg(); const g = reg[gid]; if (!g) return false;
    g.members[user] = 'member'; reg[gid] = g; guildSaveReg(reg);
    wsave('guild', user, gid);
    return true;
  }
  function guildRemoveMember(gid, user) {
    const reg = guildReg(); const g = reg[gid]; if (!g) return;
    delete g.members[user]; reg[gid] = g; guildSaveReg(reg);
    if (wload('guild', user) === gid) wsave('guild', user, null);
  }
  function raceWeekKey(now) { return Math.floor((now / 86400000 + 3) / 7); }
  function raceMinMs(C) {
    let d = 0;
    for (let i = 1; i < C.pts.length; i++) d += dist(C.pts[i - 1][0], C.pts[i - 1][1], C.pts[i][0], C.pts[i][1]);
    // checkpoints can be clipped at their radius edge, so the shortest legal
    // path is well under the center-to-center sum; 490 is the fastest mount
    return Math.floor(d * 0.62 / 490 * 1000);
  }
  function finishRace(me, rc, now) {
    const C = RACE_COURSES[rc.course];
    const ms = now - rc.t0;
    if (ms < raceMinMs(C)) return { course: rc.course, name: C.name, ms, pb: false, rec: false, pay: 0, invalid: true };
    const pb = wload('racepb', me) || {};
    const isPb = !pb[rc.course] || ms < pb[rc.course];
    if (isPb) { pb[rc.course] = ms; wsave('racepb', me, pb); }
    const recs = wload('racerec', '_racerec') || {};
    const oldRec = recs[rc.course] || null;
    const isRec = !!oldRec && oldRec.u !== me && ms < oldRec.ms;
    if (!oldRec || ms < oldRec.ms) { recs[rc.course] = { u: me, ms }; wsave('racerec', '_racerec', recs); }
    const wk = raceWeekKey(now);
    const wdat = wload('racewk', '_racewk') || { wk, rows: {} };
    if (wdat.wk !== wk) { wdat.wk = wk; wdat.rows = {}; }
    if (!wdat.rows[rc.course]) wdat.rows[rc.course] = {};
    if (!wdat.rows[rc.course][me] || ms < wdat.rows[rc.course][me]) wdat.rows[rc.course][me] = ms;
    wsave('racewk', '_racewk', wdat);
    const day = ctx.scoreDay();
    const rd = wload('raceday', me) || {};
    const n = rd.day === day ? (rd.n || 0) : 0;
    let pay = 0;
    if (n < 3) {
      pay = 40 + (isPb ? 15 : 0) + (isRec ? 50 : 0);
      if (pay > 0) { try { const pr = ctx.awardCents(me, pay); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} txLog(me, 'race', pay, C.name); }
    }
    wsave('raceday', me, { day, n: n + 1 });
    awardXp(me, 20);
    const pg = progFor(me); pg.c.race = (pg.c.race || 0) + 1; progSave(me);
    guildWkBump(me, 'race', now);
    seasonQuestAdd(me, 'races', 1);
    { const evT = worldEvent(now); if (evT && evT.type === 'tourney' && EV_RUN && EV_RUN.id === evT.id && EV_RUN.course === rc.course) { const prev = EV_RUN.scores.get(me); if (prev == null || ms < prev) EV_RUN.scores.set(me, ms); evPart(me); } }
    return { course: rc.course, name: C.name, ms, pb: isPb, rec: isRec, pay };
  }
  function raceTick(me, now) {
    const rc = RACES.get(me); if (!rc) return;
    if (now - rc.at > 600000) { RACES.delete(me); return; }
    const p = P.get(me); if (!p || p.house || p.inst) return;
    const C = RACE_COURSES[rc.course]; if (!C) { RACES.delete(me); return; }
    const cp = C.pts[rc.idx]; if (!cp) return;
    if (dist(p.x, p.y, cp[0], cp[1]) > C.r) return;
    rc.at = now;
    if (!rc.t0) { rc.t0 = now; rc.idx = 1; RACE_FLASH.set(me, { i: 0, start: true }); return; }
    rc.splits.push(now - rc.t0);
    const crossed = rc.idx;
    rc.idx++;
    if (rc.idx >= C.pts.length) { const fin = finishRace(me, rc, now); RACES.delete(me); if (fin) RACE_FIN.set(me, fin); }
    else RACE_FLASH.set(me, { i: crossed, t: now - rc.t0 });
  }
  function raceView(me, now) {
    raceTick(me, now);
    const flash = RACE_FLASH.get(me) || null; RACE_FLASH.delete(me);
    const fin = RACE_FIN.get(me) || null; RACE_FIN.delete(me);
    const rc = RACES.get(me);
    if (!rc) return (flash || fin) ? { flash, fin } : null;
    const C = RACE_COURSES[rc.course];
    const cp = C.pts[Math.min(rc.idx, C.pts.length - 1)];
    return { course: rc.course, name: C.name, state: rc.t0 ? 'running' : 'armed', idx: rc.idx, n: C.pts.length, cp: { x: cp[0], y: cp[1] }, r: C.r, el: rc.t0 ? now - rc.t0 : 0, flash, fin };
  }
  function dungeonOf(me) { const p = P.get(me); return (p && p.inst) ? (DUNGEONS.get(p.inst) || null) : null; }
  function spawnWave(dg, wave) {
    const o = dg.origin;
    const defs = wave === 1 ? [40, 40, 40] : wave === 2 ? [55, 55, 55, 55] : [60, 60];
    dg.shades = defs.map((hp, i) => ({ id: 'w' + wave + 's' + i, x: o.x + 190 + i * 150, y: o.y + 120 + (i % 2) * 110, hp, max: hp }));
    if (wave === 3) dg.shades.push({ id: 'warden', x: o.x + 550, y: o.y + 150, hp: 240, max: 240, boss: true });
    dg.wave = wave;
  }
  async function progressWaves(dg, now) {
    if (dg.state !== 'fighting' || dg.shades.length) return;
    if (dg.wave < 3) { spawnWave(dg, dg.wave + 1); return; }
    dg.state = 'won';
    const day = ctx.scoreDay();
    for (const m of Array.from(dg.members)) {
      const pg = progFor(m); pg.c.crypt = (pg.c.crypt || 0) + 1; progSave(m);
      guildWkBump(m, 'crypt', now);
      awardXp(m, 40);
      const cd = wload('cryptday', m) || {};
      const runs = cd.day === day ? (cd.n || 0) : 0;
      if (runs < 3) {
        try { await ctx.awardCents(m, 120); } catch { }
        txLog(m, 'crypt', 120, 'sunken crypt cleared');
        if (Math.random() < 0.25) { try { const inv = ctx.getInv(m) || []; if (!inv.includes('s159')) { inv.push('s159'); ctx.setInv(m, inv); } } catch { } }
        wsave('cryptday', m, { day, n: runs + 1 });
      }
      achCheck(m);
    }
  }
  function tickDungeon(dg, now) {
    const dt = Math.min(2.5, Math.max(0, (now - dg.lastTick) / 1000));
    dg.lastTick = now;
    if (dg.state !== 'fighting') return;
    for (const s of dg.shades) {
      let bu = null, bp = null, bd = 1e9;
      for (const m of dg.members) { const mp = P.get(m); if (!mp) continue; const d = dist(s.x, s.y, mp.x, mp.y); if (d < bd) { bd = d; bu = m; bp = mp; } }
      if (bp && bd > 4) { const sp = (s.boss ? 46 : 62) * dt; s.x += (bp.x - s.x) / bd * Math.min(sp, bd); s.y += (bp.y - s.y) / bd * Math.min(sp, bd); }
      if (bp && bd < 30 && now - (dg.hitCd.get(bu) || 0) > 1200) {
        dg.hitCd.set(bu, now);
        dg.hearts[bu] = (dg.hearts[bu] || 0) - 1;
        s.x += (s.x - bp.x) * 1.4; s.y += (s.y - bp.y) * 1.4;
        if (dg.hearts[bu] <= 0) {
          dg.members.delete(bu); delete dg.hearts[bu];
          bp.inst = null; bp.x = CRYPT_GATE.x; bp.y = CRYPT_GATE.y + 60; TP_OK.add(bu);
          if (!dg.members.size) { DUNGEONS.delete(dg.id); return; }
        }
      }
    }
    if (!dg.shades.length) progressWaves(dg, now).catch(() => { });
  }
  function instView(me, now) {
    const dg = dungeonOf(me); if (!dg) return null;
    tickDungeon(dg, now);
    if (!DUNGEONS.has(dg.id)) return null;
    return { wave: dg.wave, state: dg.state, hearts: dg.hearts[me] || 0, ox: dg.origin.x, oy: dg.origin.y, members: Array.from(dg.members), shades: dg.shades.map((s) => ({ id: s.id, x: Math.round(s.x), y: Math.round(s.y), hp: Math.max(0, Math.ceil(s.hp)), max: s.max, boss: !!s.boss })) };
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
  function equippedIds(u) { let w = {}; try { w = ctx.getWear(u) || {}; } catch { } return new Set(Object.values(w).filter(Boolean)); }
  const POKE = new Map(); const POKE_CD = new Map();
  function actOf(u, p, now) {
    if (!p) return '';
    if (p.inst) return 'in the crypt';
    if (FISH.has(u)) return 'fishing';
    if (RACES.has(u)) return 'racing';
    if (bossLive(now) && dist(p.x, p.y, 2400, 2600) < 650) return 'at the lich';
    for (const tk of MTOK.values()) if (tk.user === u && now - tk.at < 240000) return 'in a minigame';
    if (p.house) return 'visiting a house';
    return '';
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
        gtag: guildTagOf(u),
        act: actOf(u, p, now),
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
  const EV_ROT = ['shardstorm', 'goldenhunt', 'meteor', 'treasure', 'doublexp', 'derby', 'tourney', 'crystalhunt', 'community', 'lichsurge', 'errand'];
  function worldEvent(now) {
    if (FORCE_EV) { if (now < FORCE_EV.endsAt) return FORCE_EV; FORCE_EV = null; }
    const CYC = 20 * 60 * 1000, WIN = 5 * 60 * 1000;
    const cyc = Math.floor(now / CYC), ph = now - cyc * CYC;
    if (ph < CYC - WIN) return null;
    return { type: EV_ROT[cyc % EV_ROT.length], endsAt: (cyc + 1) * CYC, id: cyc };
  }
  function nextEventInfo(now) {
    if (FORCE_EV) return null;
    const CYC = 20 * 60 * 1000, WIN = 5 * 60 * 1000;
    const cyc = Math.floor(now / CYC), ph = now - cyc * CYC;
    if (ph >= CYC - WIN) { const nc = cyc + 1; return { type: EV_ROT[nc % EV_ROT.length], startsAt: nc * CYC + (CYC - WIN) }; }
    return { type: EV_ROT[cyc % EV_ROT.length], startsAt: cyc * CYC + (CYC - WIN) };
  }
  let lastHuntGold = 0;
  const METEORS = new Map();
  let lastMeteorAt = 0, meteorSeq = 1;
  let TREASURE = null, treasureEvId = null;
  function evTick(now, evNow) {
    SURGE = !!(evNow && evNow.type === 'lichsurge');
    if (!evNow || evNow.type !== 'meteor') { if (METEORS.size) METEORS.clear(); }
    else {
      for (const [mid, m] of METEORS) if (now - m.landAt > 90000) METEORS.delete(mid);
      if (METEORS.size < 3 && now - lastMeteorAt >= 16000) {
        lastMeteorAt = now;
        const p = spawnPos();
        METEORS.set('m' + (meteorSeq++), { x: p.x, y: p.y, landAt: now + 2400 });
      }
    }
    if (!evNow || evNow.type !== 'treasure') { TREASURE = null; treasureEvId = null; }
    else if (treasureEvId !== evNow.id && !TREASURE) {
      treasureEvId = evNow.id;
      const zs = ZONES.filter((z) => z.y < 4400);
      const z = zs[Math.floor(Math.random() * zs.length)];
      TREASURE = { x: Math.round(z.x + (Math.random() * 280 - 140)), y: Math.round(z.y + (Math.random() * 280 - 140)), zone: z.name, gone: false };
    }
  }
  let FORCE_EV = null;
  let ANN = null;
  // ---- event core v2 (E1): per-instance participation, settlement, history ----
  let EV_RUN = null;
  const EV_FLASH = new Map();
  const DERBY_PTS = { common: 1, uncommon: 2, rare: 3, epic: 5, legendary: 8 };
  const EV_PRIZES = [150, 75, 40];
  function evRunFor(evNow) {
    if (!evNow) return null;
    if (!EV_RUN || EV_RUN.id !== evNow.id) {
      EV_RUN = { id: evNow.id, type: evNow.type, scores: new Map(), parts: new Set(), done: new Set(), settled: false, prog: 0, goal: null, course: null, zone: null, bonus: [] };
      if (evNow.type === 'community') { const kinds = [{ kind: 'fish', n: 25, label: 'catch 25 fish together' }, { kind: 'shard', n: 150, label: 'claim 150 shards together' }, { kind: 'meteor', n: 12, label: 'catch 12 meteors together' }]; EV_RUN.goal = kinds[Math.abs(hashStr('evgoal' + evNow.id)) % kinds.length]; }
      if (evNow.type === 'tourney') EV_RUN.course = (Math.abs(hashStr('evcourse' + evNow.id)) % 2 === 0) ? 'skyline' : 'grandtour';
      if (evNow.type === 'errand') { const zs = ZONES.filter((z) => z.y < 4400); EV_RUN.zone = zs[Math.abs(hashStr('everr' + evNow.id)) % zs.length].id; }
      if (evNow.type === 'crystalhunt') { EV_RUN.bonus = [0, 1, 2].map((i) => { const p = spawnPos(); return { id: 'evc' + evNow.id + '_' + i, x: p.x, y: p.y, pay: 60, taken: false }; }); }
    }
    return EV_RUN;
  }
  // ---- season 1: first frost (E4) — free track, XP from playing, tier + quest rewards ----
  const SEASON = { id: 1, name: 'first frost', start: Date.UTC(2026, 10, 21), end: Date.UTC(2027, 0, 2) };
  const SZN_TIER_XP = (t) => 40 * t + 10 * t * t;
  const SZN_TIERS = [null,
    { cents: 30 }, { cents: 35 }, { cents: 40 }, { item: 's165' }, { cents: 55 },
    { cents: 60 }, { cents: 65 }, { item: 's164' }, { cents: 75 }, { cents: 80 },
    { cents: 85 }, { item: 's166' }, { cents: 95 }, { cents: 100 }, { cents: 110 },
    { item: 's167' }, { cents: 120 }, { item: 's168' }, { cents: 140 }, { item: 's169', cents: 250 }];
  const SZN_QUESTS = [
    { id: 'fish', label: 'catch 15 fish', need: 15, amt: 150 },
    { id: 'mg', label: 'play 25 minigames', need: 25, amt: 150 },
    { id: 'events', label: 'join 5 world events', need: 5, amt: 200 },
    { id: 'shards', label: 'claim 40 star shards', need: 40, amt: 120 },
    { id: 'races', label: 'finish 5 races', need: 5, amt: 150 },
    { id: 'lich', label: 'help drop the drowned lich', need: 1, amt: 300 }];
  function seasonActive(now) { return now >= SEASON.start && now < SEASON.end; }
  function seasonFor(user) {
    const s = wload('season', user);
    if (s && s.s === SEASON.id) { if (!s.q) s.q = {}; if (!s.claimed) s.claimed = []; if (!s.qclaimed) s.qclaimed = []; return s; }
    return { s: SEASON.id, xp: 0, claimed: [], q: {}, qclaimed: [] };
  }
  function seasonSave(user, s) { wsave('season', user, s); }
  function seasonXpAdd(user, amt) {
    if (!amt || !seasonActive(Date.now())) return;
    const s = seasonFor(user);
    s.xp = Math.min(SZN_TIER_XP(20), (s.xp || 0) + amt);
    seasonSave(user, s);
  }
  function seasonQuestAdd(user, key, n) {
    if (!seasonActive(Date.now())) return;
    const s = seasonFor(user);
    s.q[key] = Math.min(999, (s.q[key] || 0) + n);
    seasonSave(user, s);
  }
  function seasonTierOf(xp) { let t = 0; for (let i = 1; i <= 20; i++) if (xp >= SZN_TIER_XP(i)) t = i; return t; }
  function noteSeen(user, cat, id) {
    try {
      const key = cat === 'item' ? 'colseen' : cat === 'minigame' ? 'mgseen' : cat === 'event' ? 'evseen' : null;
      if (key) { const arr = wload(key, user) || []; if (!arr.includes(id)) { arr.push(id); wsave(key, user, arr.slice(0, 600)); } }
      if (key || cat === 'fish' || cat === 'crystal' || cat === 'zone') {
        const rec = wload('colrecent', user) || [];
        if (!rec.length || rec[0].cat !== cat || rec[0].id !== id) { rec.unshift({ cat, id, at: Date.now() }); wsave('colrecent', user, rec.slice(0, 8)); }
      }
    } catch { }
  }
  function journalNoteItems(user, ids) { (ids || []).forEach((id) => noteSeen(user, 'item', id)); }
  function evPart(user) { if (EV_RUN) { const fresh = !EV_RUN.parts.has(user); EV_RUN.parts.add(user); noteSeen(user, 'event', EV_RUN.type); if (fresh) seasonQuestAdd(user, 'events', 1); } }
  function evScore(user, pts) { if (!EV_RUN) return; evPart(user); EV_RUN.scores.set(user, (EV_RUN.scores.get(user) || 0) + pts); }
  function evGoalBump(kind, user) { if (EV_RUN && EV_RUN.type === 'community' && EV_RUN.goal && EV_RUN.goal.kind === kind) { evPart(user); EV_RUN.prog = (EV_RUN.prog || 0) + 1; } }
  async function evSettle(now) {
    if (!EV_RUN || EV_RUN.settled) return;
    const evNow = worldEvent(now);
    if (evNow && evNow.id === EV_RUN.id) return;
    EV_RUN.settled = true;
    const run = EV_RUN; EV_RUN = null;
    const board = [...run.scores.entries()].map(([u2, v]) => ({ u: u2, v })).sort((a, b) => run.type === 'tourney' ? a.v - b.v : b.v - a.v);
    let winners = [];
    if ((run.type === 'derby' || run.type === 'tourney') && board.length) {
      for (let i = 0; i < Math.min(3, board.length); i++) { const w = board[i]; const prize = EV_PRIZES[i]; try { await ctx.awardCents(w.u, prize); } catch { } txLog(w.u, 'event', prize, run.type + ' place ' + (i + 1)); winners.push({ u: w.u, v: w.v, prize }); }
    }
    let commMet = false;
    if (run.type === 'community' && run.goal) {
      commMet = (run.prog || 0) >= run.goal.n;
      if (commMet) { for (const u2 of run.parts) { try { await ctx.awardCents(u2, 60); } catch { } txLog(u2, 'event', 60, 'community challenge complete'); } winners = [...run.parts].map((u2) => ({ u: u2, v: 60, prize: 60 })); }
    }
    try {
      const last = wload('evlast', '_events') || [];
      last.unshift({ id: run.id, type: run.type, at: now, board: board.slice(0, 8), winners, goal: run.goal ? { kind: run.goal.kind, n: run.goal.n, got: run.prog || 0, met: commMet } : null, course: run.course || null });
      wsave('evlast', '_events', last.slice(0, 12));
      if (winners.length && (run.type === 'derby' || run.type === 'tourney')) { const wins = wload('evwins', '_events') || {}; wins[winners[0].u] = (wins[winners[0].u] || 0) + 1; wsave('evwins', '_events', wins); }
    } catch { }
    for (const u2 of run.parts) {
      const my = board.find((x) => x.u === u2);
      const place = my ? board.indexOf(my) + 1 : 0;
      const win = winners.find((x) => x.u === u2);
      try {
        const h = wload('evhist', u2) || [];
        h.unshift({ type: run.type, at: now, v: my ? my.v : 0, place, prize: win ? win.prize : 0 });
        wsave('evhist', u2, h.slice(0, 30));
        const pg = progFor(u2); pg.c.evpart = (pg.c.evpart || 0) + 1;
        if (win && place === 1 && (run.type === 'derby' || run.type === 'tourney')) pg.c.evwin = (pg.c.evwin || 0) + 1;
        progSave(u2);
      } catch { }
      EV_FLASH.set(u2, { type: run.type, place, prize: win ? win.prize : 0, met: run.type === 'community' ? commMet : undefined, board: board.slice(0, 3) });
    }
  }
  // ---- parties ----
  const PARTIES = new Map();
  const PINV = new Map();
  const TINV = new Map(), TRADES = new Map(), TRADE_OF = new Map(), TRADE_FLASH = new Map(), MAT_GOT = new Map();
  let partySeq = 1;
  function partyOf(user) {
    for (const [id, pt] of PARTIES) if (pt.members.includes(user)) return { id, leader: pt.leader, members: pt.members.slice() };
    return null;
  }
  function partyView(user) {
    const pt = partyOf(user);
    if (!pt) return null;
    const zones = {};
    for (const m of pt.members) { const pp = P.get(m); zones[m] = pp ? zoneName(zoneAt(pp.x, pp.y)) : null; }
    return { leader: pt.leader, members: pt.members, zones };
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
    evTick(now, worldEvent(now));
    await evSettle(now);
    evRunFor(worldEvent(now));

  /* ---- M9: materials + crafting + trading ---- */
  const SKILL_TITLES = ['novice', 'apprentice', 'adept', 'skilled', 'expert', 'master'];
  const SKILL_PAY = [[2, 20], [4, 40], [6, 60], [8, 100], [10, 150]];
  const SKILL_DEFS = [
    { id: 'fisher', name: 'angler', c: '#6ee7b7', per: 2, count: (pg) => pg.c.fish || 0 },
    { id: 'hunter', name: 'monster hunter', c: '#f0abfc', per: 1.5, count: (pg) => (pg.c.crypt || 0) * 3 + (pg.c.boss || 0) },
    { id: 'racer', name: 'racer', c: '#fbbf24', per: 2, count: (pg) => pg.c.race || 0 },
    { id: 'explorer', name: 'explorer', c: '#67e8f9', per: 0.28, count: (pg) => (pg.zones || []).length },
    { id: 'gatherer', name: 'gatherer', c: '#fde68a', per: 20, count: (pg) => (pg.c.shard || 0) + (pg.c.crystal || 0) * 3 },
    { id: 'maker', name: 'maker', c: '#a78bfa', per: 2, count: (pg) => (pg.c.craft || 0) + (pg.c.trade || 0) },
  ];
  const MATS = {
    dust: { name: 'stardust', c: '#fde68a' },
    chip: { name: 'crystal chip', c: '#67e8f9' },
    cloth: { name: 'gloom cloth', c: '#a78bfa' },
    scale: { name: 'fish scale', c: '#6ee7b7' },
    essence: { name: 'lich essence', c: '#f0abfc' },
  };
  const RECIPES = [
    { out: 's160', needs: { dust: 6, chip: 2 } },
    { out: 's161', needs: { cloth: 5, dust: 2 } },
    { out: 's162', needs: { chip: 6, essence: 1 } },
    { out: 's163', needs: { dust: 8, scale: 3 } },
  ];
  function matsOf(user) { return wload('mats', user) || {}; }
  function matAdd(user, id, n) {
    const m = matsOf(user); m[id] = (m[id] || 0) + n; wsave('mats', user, m);
    const arr = MAT_GOT.get(user) || []; arr.push({ id, n }); MAT_GOT.set(user, arr);
    return m[id];
  }
  function endTrade(tr, why) {
    if (why) { TRADE_FLASH.set(tr.a, { msg: why, at: Date.now() }); TRADE_FLASH.set(tr.b, { msg: why, at: Date.now() }); }
    TRADES.delete(tr.id); TRADE_OF.delete(tr.a); TRADE_OF.delete(tr.b);
  }
  function tradeView(me, now) {
    const tid = TRADE_OF.get(me); if (!tid) return null;
    const tr = TRADES.get(tid); if (!tr) { TRADE_OF.delete(me); return null; }
    if (now - tr.at > 150000) { endTrade(tr, 'trade timed out'); return null; }
    const iAmA = tr.a === me;
    const nm = (id) => { const it = SHOP.BY_ID[id]; return it ? { id, name: it.name, c: it.color, cat: it.cat } : { id, name: id, c: '#ffffff', cat: '' }; };
    const mo = iAmA ? tr.oa : tr.ob, to = iAmA ? tr.ob : tr.oa;
    return { with: iAmA ? tr.b : tr.a, mine: { items: mo.items.map(nm), cents: mo.cents }, theirs: { items: to.items.map(nm), cents: to.cents }, myLock: iAmA ? tr.la : tr.lb, theirLock: iAmA ? tr.lb : tr.la, myConf: iAmA ? tr.ca : tr.cb, theirConf: iAmA ? tr.cb : tr.ca };
  }
  async function execTrade(tr) {
    // re-entry guard: two confirms landing together must never run the swap twice
    if (tr.exec) return { ok: false, err: 'trade already completing' };
    tr.exec = true;
    const A = tr.a, B = tr.b;
    // snapshots for validation + rollback
    let invA = [], invB = [];
    try { invA = ctx.getInv(A) || []; } catch { }
    try { invB = ctx.getInv(B) || []; } catch { }
    const wearA = equippedIds(A), wearB = equippedIds(B);
    const valid = tr.oa.items.every((id) => invA.includes(id) && !wearA.has(id)) && tr.ob.items.every((id) => invB.includes(id) && !wearB.has(id));
    let balA = 0, balB = 0;
    try { balA = ctx.getCents(A) || 0; } catch { }
    try { balB = ctx.getCents(B) || 0; } catch { }
    if (!valid || balA < tr.oa.cents || balB < tr.ob.cents) { endTrade(tr, 'trade fell through \u2014 stuff changed'); return { ok: false, err: 'trade fell through \u2014 stuff changed' }; }
    // close the session BEFORE mutating anything: no second confirm, view or
    // timeout path can touch this trade again once execution starts
    TRADES.delete(tr.id); TRADE_OF.delete(A); TRADE_OF.delete(B);
    const nA = invA.filter((id) => !tr.oa.items.includes(id)).concat(tr.ob.items);
    const nB = invB.filter((id) => !tr.ob.items.includes(id)).concat(tr.oa.items);
    const netA = tr.ob.cents - tr.oa.cents;
    try {
      ctx.setInv(A, nA);
      ctx.setInv(B, nB);
      if (netA) { await ctx.awardCents(A, netA); await ctx.awardCents(B, -netA); }
      // verify the swap actually landed before calling it done
      const vA = ctx.getInv(A) || [], vB = ctx.getInv(B) || [];
      const okSwap = tr.oa.items.every((id) => vB.includes(id)) && tr.ob.items.every((id) => vA.includes(id))
        && (ctx.getCents(A) || 0) === balA + netA && (ctx.getCents(B) || 0) === balB - netA;
      if (!okSwap) throw new Error('trade verify failed');
    } catch (e) {
      // rollback: restore both inventories and balances, tell both players
      try { ctx.setInv(A, invA); } catch { }
      try { ctx.setInv(B, invB); } catch { }
      try { const cA = ctx.getCents(A) || 0; if (cA !== balA) await ctx.awardCents(A, balA - cA); } catch { }
      try { const cB = ctx.getCents(B) || 0; if (cB !== balB) await ctx.awardCents(B, balB - cB); } catch { }
      TRADE_FLASH.set(A, { msg: 'trade failed \u2014 everything was put back', at: Date.now() });
      TRADE_FLASH.set(B, { msg: 'trade failed \u2014 everything was put back', at: Date.now() });
      return { ok: false, err: 'trade failed \u2014 everything was put back' };
    }
    txLog(A, 'trade', netA, 'with @' + B);
    txLog(B, 'trade', -netA, 'with @' + A);
    const pgTA = progFor(A); pgTA.c.trade = (pgTA.c.trade || 0) + 1; progSave(A);
    const pgTB = progFor(B); pgTB.c.trade = (pgTB.c.trade || 0) + 1; progSave(B);
    journalNoteItems(A, tr.ob.items); journalNoteItems(B, tr.oa.items);
    TRADE_FLASH.set(A, { msg: 'trade done with @' + B, at: Date.now() });
    TRADE_FLASH.set(B, { msg: 'trade done with @' + A, at: Date.now() });
    return { ok: true };
  }

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
      if (!p.house && !p.inst && p.y > 4380) p.y = 4380;
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
        if (pg.zones.indexOf(zn) < 0) { pg.zones.push(zn); disc = { zone: zoneName(zn) }; awardXp(me, 6); progSave(me); noteSeen(me, 'zone', zn); }
      }
      p.zone = zn;
      // meeting people: standing close to another player counts them (the
      // loop always runs so daily/weekly meet quests progress too — the
      // event itself no-ops for quests that are not meet-kind)
      for (const [ou, op] of P) { if (ou !== me && (op.house || null) === (p.house || null) && (op.inst || null) === (p.inst || null) && dist(p.x, p.y, op.x, op.y) < 95) questDone = questEvent(me, 'meet', ou) || questDone; }
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
          if (Math.random() < 0.25) matAdd(me, 'dust', 1);
          txLog(me, s.gold ? 'gold shard' : 'shard', amt);
          statsSave(me);
          pg.c.shard = (pg.c.shard || 0) + 1;
          seasonQuestAdd(me, 'shards', 1);
          if (s.gold) pg.c.gold = (pg.c.gold || 0) + 1;
          awardXp(me, s.gold ? 5 : 1);
          achCheck(me);
          questDone = questEvent(me, 'shard') || questDone;
          if (EV_RUN) { evPart(me); evGoalBump('shard', me); }
          if (s.gold) questDone = questEvent(me, 'gold') || questDone;
          fillShards(now);
        }
      }
      let gotC = null;
      for (const c of CRYSTALS) {
        if (pg.crystals.indexOf(c.id) >= 0) continue;
        if (dist(p.x, p.y, c.x, c.y) < 58) {
          pg.crystals.push(c.id);
          noteSeen(me, 'crystal', c.id);
          pg.c.crystal = (pg.c.crystal || 0) + 1;
          let bal = null;
          try { bal = await ctx.awardCents(me, c.pay); } catch { }
          gotC = { amt: c.pay, rare: c.rare, bal };
          matAdd(me, 'chip', 1);
          txLog(me, 'crystal', c.pay, c.rare + ' crystal');
          try { dailyEvent(me, 'crystal'); } catch { }
          awardXp(me, 8);
          progSave(me);
          achCheck(me);
          break;
        }
      }
      let gotM = null, gotT = null;
      let gotEvC = null, gotEvE = null;
      const evQ = worldEvent(now);
      if (evQ && evQ.type === 'crystalhunt' && EV_RUN && EV_RUN.id === evQ.id) {
        for (const bc of EV_RUN.bonus) {
          if (!bc.taken && dist(p.x, p.y, bc.x, bc.y) < 70) {
            bc.taken = true;
            let bal = null;
            try { bal = await ctx.awardCents(me, bc.pay); } catch { }
            gotEvC = { amt: bc.pay, bal };
            txLog(me, 'event crystal', bc.pay);
            awardXp(me, 8);
            evScore(me, 1);
            achCheck(me);
            break;
          }
        }
      }
      const evC = worldEvent(now);
      if (evC && evC.type === 'meteor') {
        for (const [mid, m] of METEORS) {
          if (now >= m.landAt && dist(p.x, p.y, m.x, m.y) < 62) {
            METEORS.delete(mid);
            let bal = null;
            try { bal = await ctx.awardCents(me, 25); } catch { }
            matAdd(me, 'dust', 1);
            pg.c.meteor = (pg.c.meteor || 0) + 1;
            gotM = { amt: 25, bal };
            if (EV_RUN) { evPart(me); evGoalBump('meteor', me); }
            txLog(me, 'meteor shard', 25);
            awardXp(me, 6);
            progSave(me);
            achCheck(me);
            break;
          }
        }
      }
      if (evC && evC.type === 'treasure' && TREASURE && !TREASURE.gone) {
        if (dist(p.x, p.y, TREASURE.x, TREASURE.y) < 70) {
          const matKeys = Object.keys(MATS);
          const mk = matKeys[Math.floor(Math.random() * matKeys.length)];
          let bal = null;
          try { bal = await ctx.awardCents(me, 75); } catch { }
          matAdd(me, mk, 2);
          pg.c.treasure = (pg.c.treasure || 0) + 1;
          gotT = { amt: 75, bal, mat: mk };
          if (EV_RUN) evPart(me);
          txLog(me, 'treasure chest', 75);
          awardXp(me, 15);
          TREASURE.gone = true;
          progSave(me);
          achCheck(me);
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
      const evNowP = worldEvent(now);
      if (evNowP && evNowP.type === 'errand' && EV_RUN && EV_RUN.id === evNowP.id && !EV_RUN.done.has(me)) {
        const zA = zoneAt(p.x, p.y);
        if (zA && zA === EV_RUN.zone) {
          EV_RUN.done.add(me); evPart(me);
          let bal = null;
          try { bal = await ctx.awardCents(me, 40); } catch { }
          gotEvE = { amt: 40, bal };
          txLog(me, 'event', 40, "six's errand");
          awardXp(me, 10);
        }
      }
      let evPayload = evNowP;
      if (evNowP && EV_RUN && EV_RUN.id === evNowP.id) {
        evPayload = { ...evNowP };
        if (EV_RUN.type === 'derby' || EV_RUN.type === 'tourney' || EV_RUN.type === 'crystalhunt') evPayload.board = [...EV_RUN.scores.entries()].map(([u2, v]) => ({ u: u2, v })).sort((a, b) => EV_RUN.type === 'tourney' ? a.v - b.v : b.v - a.v).slice(0, 5);
        if (EV_RUN.type === 'community' && EV_RUN.goal) evPayload.goal = { label: EV_RUN.goal.label, n: EV_RUN.goal.n, got: EV_RUN.prog || 0 };
        if (EV_RUN.type === 'tourney') evPayload.course = EV_RUN.course;
        if (EV_RUN.type === 'errand') { const zN = ZONES.find((z2) => z2.id === EV_RUN.zone); evPayload.zoneName = zN ? zN.name : ''; }
      }
      const evSoonI = !evNowP ? nextEventInfo(now) : null;
      const evSoon = evSoonI && (evSoonI.startsAt - now <= 90000) ? { type: evSoonI.type, in: Math.ceil((evSoonI.startsAt - now) / 1000) } : null;
      const evRes = EV_FLASH.get(me) || null; if (evRes) EV_FLASH.delete(me);
      const crysOut = CRYSTALS.filter((c) => pg.crystals.indexOf(c.id) < 0).map((c) => ({ id: c.id, x: c.x, y: c.y, rare: c.rare }));
      if (evNowP && evNowP.type === 'crystalhunt' && EV_RUN && EV_RUN.id === evNowP.id) for (const bc of EV_RUN.bonus) if (!bc.taken) crysOut.push({ id: bc.id, x: bc.x, y: bc.y, rare: 'event' });
      const sig = (SIG.get(me) || []).filter((s2) => now - s2.at < 30000);
      SIG.delete(me);
      const st = statsFor(me);
      if (Math.random() < 0.08) achCheck(me);
      J({
        ok: true, me, players: roster(now).filter((pl) => (pl.npc ? (!p.house && !p.inst) : ((((P.get(pl.u) || {}).house || null) === (p.house || null)) && (((P.get(pl.u) || {}).inst || null) === (p.inst || null)))) && (pl.npc || pl.u === me || (!(wload('blocks', me) || []).includes(pl.u) && !(wload('blocks', pl.u) || []).includes(me)))), sig, n: P.size, bal: (() => { try { return ctx.getCents(me); } catch { return null; } })(),
        inv: (() => { try { return ctx.getInv(me); } catch { return []; } })(),
        wearIds: (() => { try { return ctx.getWear(me); } catch { return {}; } })(),
        shards: shards.map((s) => ({ id: s.id, x: s.x, y: s.y, gold: s.gold })),
        lb: leaderboard(), quest: questView(me),
        today: { shards: st.shards, golds: st.golds },
        zone: p.house ? (p.house === me ? 'ur house' : '@' + p.house + "'s house") : (p.zone ? zoneName(p.zone) : ''), got, questDone, srvNow: now,
        duelIn: duelInFor(me, now), duel: duelFor(me, now), duelDone: duelDoneFor(me, now),
        prog: progView(me), disc, gotC,
        house: p.house || null,
        boss: bossView(me, now),
        inst: instView(me, now),
        race: raceView(me, now),
        guildInv: (GINV.get(me) || []).filter((v) => now - v.at < 120000),
        guildMsgs: (() => { const q = GMSG.get(me) || []; GMSG.delete(me); return q; })(),
        myGuildTag: guildTagOf(me),
        petNames: wload('petname', me) || {},
        crys: crysOut,
        lvlUp: (() => { const v = LVLUP.get(me) || null; LVLUP.delete(me); return v; })(),
        achNew: (() => { const v = ACHNEW.get(me) || []; ACHNEW.delete(me); return v; })(),
        dqDone: (() => { const v = DQ_DONE.get(me) || []; DQ_DONE.delete(me); return v; })(),
        dchal: { id: dchalGameId(), done: wload('dchal', me) === ctx.scoreDay() },
        party: partyView(me),
        partyInv: (() => { const iv = PINV.get(me); return iv && now - iv.at < 90000 ? { from: iv.from } : null; })(),
        tradeInv: (() => { const iv = TINV.get(me); return iv && now - iv.at < 90000 ? { from: iv.from } : null; })(),
        trade: tradeView(me, now),
        tradeFlash: (() => { const f = TRADE_FLASH.get(me); if (f && now - f.at < 30000) { TRADE_FLASH.delete(me); return f.msg; } return null; })(),
        matGot: (() => { const arr = MAT_GOT.get(me); if (arr && arr.length) { MAT_GOT.delete(me); return arr; } return null; })(),
        event: evPayload,
        meteors: (() => { const e2 = worldEvent(now); return e2 && e2.type === 'meteor' ? [...METEORS.values()].map((m) => ({ x: m.x, y: m.y, landAt: m.landAt })) : []; })(),
        treasure: (() => { const e2 = worldEvent(now); return e2 && e2.type === 'treasure' && TREASURE && !TREASURE.gone ? { zone: TREASURE.zone, near: dist(p.x, p.y, TREASURE.x, TREASURE.y) < 380 } : null; })(),
        gotM, gotT, gotEvC, gotEvE, evSoon, evRes,
        myBlocks: wload('blocks', me) || [],
        poke: (() => { const pk = POKE.get(me); if (!pk) return null; POKE.delete(me); return now - pk.at < 30000 ? { from: pk.from } : null; })(),
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

    if (u.pathname === '/api/world/poke' && req.method === 'POST') {
      const target = String(b.user || '').toLowerCase();
      if (!target || target === me) { J({ ok: false, err: 'who?' }, 400); return true; }
      if (!P.has(target)) { J({ ok: false, err: 'they are not in the world rn' }, 400); return true; }
      if (blocksOf(me).includes(target) || blocksOf(target).includes(me)) { J({ ok: false, err: 'blocked' }, 400); return true; }
      const cdKey = me + '>' + target;
      if (now - (POKE_CD.get(cdKey) || 0) < 15000) { J({ ok: false, err: 'give it a sec' }, 429); return true; }
      POKE_CD.set(cdKey, now);
      POKE.set(target, { from: me, at: now });
      const mp = P.get(me); if (mp) { mp.emote = 'wave'; mp.emoteAt = now; }
      J({ ok: true });
      return true;
    }
    if (u.pathname === '/api/world/friends' && req.method === 'GET') {
      let list = [];
      try { list = ctx.friendsOf ? ctx.friendsOf(me) : []; } catch { list = []; }
      const rows = list.filter((f) => f && f !== me).map((f) => {
        const p = P.get(f);
        return { u: f, inWorld: !!p, zone: p ? zoneName(zoneAt(p.x, p.y)) : null, act: p ? actOf(f, p, now) : '' };
      });
      rows.sort((a, b) => ((b.inWorld ? 1 : 0) - (a.inWorld ? 1 : 0)) || a.u.localeCompare(b.u));
      J({ ok: true, friends: rows });
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
        return { u: u2, xp: p.xp || 0, lvl: lvlOfXp(p.xp || 0), quests: (p.c || {}).quest || 0, shards: (p.c || {}).shard || 0, ach: Object.keys(p.ach || {}).length, crystals: (p.crystals || []).length, crypt: (p.c || {}).crypt || 0 };
      });
      const top = (k) => rows.slice().sort((a, b2) => b2[k] - a[k]).slice(0, 10).map((r) => ({ u: r.u, v: r[k], lvl: r.lvl }));
      J({ ok: true, boards: {
        levels: rows.slice().sort((a, b2) => b2.xp - a.xp).slice(0, 10).map((r) => ({ u: r.u, v: r.xp, lvl: r.lvl })),
        quests: top('quests'), shards: top('shards'), ach: top('ach'), crystals: top('crystals'),
        fish: fishBoard(Date.now(), wload('fishbest', '_fishbest') || {}),
        crypt: top('crypt'),
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
      RACES.delete(me);
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
        else if (['shardstorm', 'goldenhunt', 'meteor', 'treasure', 'doublexp', 'derby', 'tourney', 'crystalhunt', 'community', 'lichsurge', 'errand'].includes(t)) FORCE_EV = { type: t, endsAt: now + 5 * 60 * 1000, id: 'f' + now };
        else { J({ ok: false, err: 'bad type' }, 400); return true; }
        J({ ok: true, event: worldEvent(now) });
        return true;
      }
      J({ ok: false, err: 'bad act' }, 400);
      return true;
    }

    if (u.pathname === '/api/world/boss-hit' && req.method === 'POST') {
      const now3 = Date.now();
      const bs = bossEnsure(now3);
      if (!bs) { J({ ok: false, err: 'the lich is not risen' }, 400); return true; }
      if (bs.dead) { J({ ok: false, err: 'already felled' }, 400); return true; }
      if ((STUN.get(me) || 0) > now3) { J({ ok: false, err: 'stunned by the slam' }, 400); return true; }
      if (now3 - (BOSS_HIT_CD.get(me) || 0) < 450) { J({ ok: false, err: 'too fast' }, 429); return true; }
      const bp = P.get(me);
      if (!bp || bp.house || bp.inst || dist(bp.x, bp.y, BOSS_POS.x, BOSS_POS.y) > 280) { J({ ok: false, err: 'get closer to the lich' }, 400); return true; }
      BOSS_HIT_CD.set(me, now3);
      bossTick(now3);
      const ph = bossPhase();
      const dmg = Math.round((8 + Math.random() * 7) * (ph >= 3 ? 1.25 : 1));
      bs.hp -= dmg;
      bs.dmg.set(me, (bs.dmg.get(me) || 0) + dmg);
      bs.hits.set(me, (bs.hits.get(me) || 0) + 1);
      let rewards = null;
      if (bs.hp <= 0 && !bs.dead) {
        bs.dead = true; bs.hp = 0;
        let tot = 0; for (const v of bs.dmg.values()) tot += v;
        rewards = {};
        for (const [u2, d2] of bs.dmg) {
          const share = Math.max(5, Math.round((SURGE ? 900 : 600) * d2 / Math.max(1, tot)));
          try { await ctx.awardCents(u2, share); } catch { }
          txLog(u2, 'boss', share, 'the drowned lich');
          if ((bs.hits.get(u2) || 0) >= 5) awardXp(u2, 30);
          const pg2 = progFor(u2); pg2.c.boss = (pg2.c.boss || 0) + 1; progSave(u2);
          seasonQuestAdd(u2, 'lich', 1);
          rewards[u2] = share;
          guildWkBump(u2, 'boss', now3);
          if ((bs.hits.get(u2) || 0) >= 5) matAdd(u2, 'essence', 1);
          if (SURGE && (bs.hits.get(u2) || 0) >= 5) matAdd(u2, 'essence', 1);
        }
        achCheck(me);
      }
      J({ ok: true, dmg, hp: Math.max(0, Math.round(bs.hp)), dead: bs.dead, urShare: rewards ? (rewards[me] || 0) : null });
      return true;
    }

    if (u.pathname === '/api/world/race-start' && req.method === 'POST') {
      const cid = String(b.course || '');
      const C = RACE_COURSES[cid];
      if (!C) { J({ ok: false, err: 'no such course' }, 400); return true; }
      const p = P.get(me);
      if (!p || p.house || p.inst) { J({ ok: false, err: 'not out in the world rn' }, 400); return true; }
      if (dist(p.x, p.y, C.pts[0][0], C.pts[0][1]) > 300) { J({ ok: false, err: 'get to the start first — ' + C.startLabel }, 400); return true; }
      RACES.set(me, { course: cid, idx: 0, t0: 0, splits: [], at: now });
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/race-quit' && req.method === 'POST') {
      RACES.delete(me);
      J({ ok: true });
      return true;
    }

    // ---- collection journal (E3): seen-trackers, category completion, milestone rewards ----
    const COL_MS = [[25, 25], [50, 60], [75, 120], [100, 250]];
    const COL_ALL_MS = [[50, 200], [100, 500]];
    const EV_NAMES_J = { shardstorm: 'shard storm', goldenhunt: 'golden hunt', meteor: 'meteor shower', treasure: 'treasure hunt', doublexp: 'double xp', derby: 'fishing derby', tourney: 'race tournament', crystalhunt: 'crystal hunt', community: 'community challenge', lichsurge: 'lich surge', errand: "six's errand" };
    function buildJournal(me) {
      const pg = progFor(me);
      let inv = []; try { inv = ctx.getInv(me) || []; } catch { }
      const seen = new Set(wload('colseen', me) || []);
      let grew = false;
      for (const id of inv) if (!seen.has(id)) { seen.add(id); grew = true; }
      for (const id of equippedIds(me)) if (!seen.has(id)) { seen.add(id); grew = true; }
      if (grew) wsave('colseen', me, [...seen].slice(0, 600));
      const fishlog = wload('fishlog', me) || {};
      const mgseen = new Set(wload('mgseen', me) || []);
      const evseen = new Set(wload('evseen', me) || []);
      const itemEntries = (cat) => SHOP.ITEMS.filter((it) => !cat || it.cat === cat).map((it) => ({ id: it.id, name: it.name, sub: it.rarity + ' \u00b7 ' + it.cat, color: it.color, got: seen.has(it.id) }));
      const cats = [];
      cats.push({ id: 'fish', name: 'fish of the lake', entries: FISH_SPECIES.map((s) => ({ id: s.id, name: s.name, sub: s.band + ' fish', color: s.c, got: !!fishlog[s.id], n: fishlog[s.id] ? fishlog[s.id].n : 0 })) });
      cats.push({ id: 'items', name: 'every item', entries: itemEntries(null) });
      cats.push({ id: 'pets', name: 'pets', entries: itemEntries('pet') });
      cats.push({ id: 'mounts', name: 'mounts', entries: itemEntries('mount') });
      cats.push({ id: 'crystals', name: 'world crystals', entries: CRYSTALS.map((c) => ({ id: c.id, name: c.rare + ' crystal', sub: 'somewhere in the world', color: c.rare === 'legendary' ? '#ffd257' : c.rare === 'epic' ? '#c084fc' : c.rare === 'rare' ? '#38bdf8' : '#9ca3af', got: pg.crystals.includes(c.id) })) });
      cats.push({ id: 'zones', name: 'places discovered', entries: ZONES.map((z) => ({ id: z.id, name: z.name, sub: 'a place in the world', got: pg.zones.includes(z.id) })) });
      cats.push({ id: 'minigames', name: 'minigames played', entries: GAMES_MOD.GAMES.map((g) => ({ id: g.id, name: g.name, sub: g.engine + ' game', got: mgseen.has(g.id) })) });
      cats.push({ id: 'events', name: 'events joined', entries: EV_ROT.map((t) => ({ id: t, name: EV_NAMES_J[t] || t, sub: 'a world event', got: evseen.has(t) })) });
      cats.push({ id: 'bosses', name: 'boss hunts', entries: [{ id: 'lich', name: 'the drowned lich', sub: 'lake boss', n: Math.min(10, pg.c.boss || 0), max: 10, got: (pg.c.boss || 0) >= 10 }, { id: 'crypt', name: 'crypt clears', sub: 'the sunken crypt', n: Math.min(10, pg.c.crypt || 0), max: 10, got: (pg.c.crypt || 0) >= 10 }] });
      for (const c of cats) { c.got = c.entries.reduce((a, e) => a + (e.max ? (e.n || 0) : (e.got ? 1 : 0)), 0); c.total = c.entries.reduce((a, e) => a + (e.max || 1), 0); c.pct = c.total ? Math.floor(100 * c.got / c.total) : 0; }
      const overall = cats.length ? Math.round(cats.reduce((a, c) => a + c.pct, 0) / cats.length) : 0;
      const claimed = new Set(wload('colclaim', me) || []);
      const milestones = [];
      for (const c of cats) for (const ms of COL_MS) milestones.push({ id: c.id + ':' + ms[0], label: c.name + ' ' + ms[0] + '%', pct: ms[0], amt: ms[1], state: claimed.has(c.id + ':' + ms[0]) ? 'claimed' : (c.pct >= ms[0] ? 'ready' : 'locked') });
      for (const ms of COL_ALL_MS) milestones.push({ id: 'all:' + ms[0], label: 'whole journal ' + ms[0] + '%', pct: ms[0], amt: ms[1], state: claimed.has('all:' + ms[0]) ? 'claimed' : (overall >= ms[0] ? 'ready' : 'locked') });
      const colsets = cats.filter((c) => c.pct >= 100).length;
      if ((pg.c.colsets || 0) !== colsets) { pg.c.colsets = colsets; progSave(me); }
      const recent = (wload('colrecent', me) || []).map((r) => ({ cat: r.cat, id: r.id, at: r.at, name: r.cat === 'item' && SHOP.BY_ID[r.id] ? SHOP.BY_ID[r.id].name : r.cat === 'fish' ? ((FISH_SPECIES.find((s) => s.id === r.id) || {}).name || r.id) : r.cat === 'minigame' ? ((GAMES_MOD.BY_ID[r.id] || {}).name || r.id) : r.cat === 'zone' ? zoneName(r.id) : r.cat === 'event' ? (EV_NAMES_J[r.id] || r.id) : r.id }));
      return { cats, overall, milestones, recent };
    }

    if (u.pathname === '/api/world/season' && req.method === 'GET') {
      const s = seasonFor(me);
      const tier = seasonTierOf(s.xp || 0);
      const pgS = progFor(me);
      if ((pgS.c.sztier || 0) !== tier) { pgS.c.sztier = tier; progSave(me); }
      achCheck(me);
      J({ ok: true,
        season: { id: SEASON.id, name: SEASON.name, start: SEASON.start, end: SEASON.end, active: seasonActive(now), daysLeft: Math.max(0, Math.ceil((SEASON.end - now) / 86400000)) },
        xp: s.xp || 0, tier, maxXp: SZN_TIER_XP(20),
        tiers: SZN_TIERS.slice(1).map((r, i) => { const t = i + 1; const it = r.item ? SHOP.BY_ID[r.item] : null; return { t, need: SZN_TIER_XP(t), cents: r.cents || 0, item: r.item || null, itemName: it ? it.name : null, rarity: it ? it.rarity : null, state: s.claimed.includes(t) ? 'claimed' : ((s.xp || 0) >= SZN_TIER_XP(t) ? 'ready' : 'locked') }; }),
        quests: SZN_QUESTS.map((q) => ({ id: q.id, label: q.label, n: Math.min(q.need, s.q[q.id] || 0), need: q.need, amt: q.amt, state: s.qclaimed.includes(q.id) ? 'claimed' : ((s.q[q.id] || 0) >= q.need ? 'ready' : 'doing') })) });
      return true;
    }

    if (u.pathname === '/api/world/season' && req.method === 'POST') {
      const s = seasonFor(me);
      if (b.tier != null) {
        const t = Math.floor(Number(b.tier) || 0);
        const r = SZN_TIERS[t];
        if (!r) { J({ ok: false, err: 'no such tier' }, 400); return true; }
        if (s.claimed.includes(t)) { J({ ok: false, err: 'already claimed' }, 400); return true; }
        if ((s.xp || 0) < SZN_TIER_XP(t)) { J({ ok: false, err: 'not enough season xp yet' }, 400); return true; }
        let grantedItem = false;
        if (r.item) {
          let inv = []; try { inv = ctx.getInv(me) || []; } catch { }
          if (!inv.includes(r.item)) {
            inv.push(r.item);
            try { ctx.setInv(me, inv); grantedItem = (ctx.getInv(me) || []).includes(r.item); } catch { grantedItem = false; }
            if (!grantedItem) { J({ ok: false, err: 'grant glitched — try again' }, 500); return true; }
          } else grantedItem = true;
        }
        if (r.cents) {
          let bal = null; try { bal = await ctx.awardCents(me, r.cents); } catch { }
          if (typeof bal !== 'number') {
            if (grantedItem && r.item) { try { const inv2 = (ctx.getInv(me) || []).filter((x) => x !== r.item); ctx.setInv(me, inv2); } catch { } }
            J({ ok: false, err: 'payout glitched — try again' }, 500); return true;
          }
          txLog(me, 'season', r.cents, 'season tier ' + t);
        }
        s.claimed.push(t); seasonSave(me, s);
        if (r.item) journalNoteItems(me, [r.item]);
        achCheck(me);
        J({ ok: true, tier: t, item: r.item || null, cents: r.cents || 0 });
        return true;
      }
      if (b.quest != null) {
        const q = SZN_QUESTS.find((x) => x.id === String(b.quest || ''));
        if (!q) { J({ ok: false, err: 'no such quest' }, 400); return true; }
        if (s.qclaimed.includes(q.id)) { J({ ok: false, err: 'already claimed' }, 400); return true; }
        if ((s.q[q.id] || 0) < q.need) { J({ ok: false, err: 'not done yet — ' + (s.q[q.id] || 0) + '/' + q.need }, 400); return true; }
        let bal = null; try { bal = await ctx.awardCents(me, q.amt); } catch { }
        if (typeof bal !== 'number') { J({ ok: false, err: 'payout glitched — try again' }, 500); return true; }
        s.qclaimed.push(q.id); seasonSave(me, s);
        txLog(me, 'season', q.amt, 'season quest: ' + q.label);
        J({ ok: true, quest: q.id, amt: q.amt, bal });
        return true;
      }
      J({ ok: false, err: 'bad act' }, 400); return true;
    }

    if (u.pathname === '/api/world/journal' && req.method === 'GET') {
      const j = buildJournal(me);
      achCheck(me);
      J({ ok: true, cats: j.cats, overall: j.overall, milestones: j.milestones, recent: j.recent });
      return true;
    }

    if (u.pathname === '/api/world/journal' && req.method === 'POST') {
      const id = String(b.id || '');
      const j = buildJournal(me);
      const ms = j.milestones.find((m) => m.id === id);
      if (!ms) { J({ ok: false, err: 'no such milestone' }, 400); return true; }
      if (ms.state === 'claimed') { J({ ok: false, err: 'already claimed' }, 400); return true; }
      if (ms.state !== 'ready') { J({ ok: false, err: 'not there yet — keep collecting' }, 400); return true; }
      const claimed = wload('colclaim', me) || [];
      claimed.push(id); wsave('colclaim', me, claimed);
      let bal = null; try { bal = await ctx.awardCents(me, ms.amt); } catch { }
      if (typeof bal !== 'number') { wsave('colclaim', me, claimed.filter((x) => x !== id)); J({ ok: false, err: 'payout glitched — try again' }, 500); return true; }
      txLog(me, 'collection', ms.amt, ms.label);
      achCheck(me);
      J({ ok: true, amt: ms.amt, bal });
      return true;
    }

    // ---- player marketplace (E2): escrow listings, 5% fee, 48h expiry ----
    function mktLoad() { const r = wload('mkt', '_mkt') || {}; if (!r.list) r.list = {}; if (!r.seq) r.seq = 1; return r; }
    function mktSave(reg) { wsave('mkt', '_mkt', reg); }
    function mktHist(user, entry) { try { const h = wload('mkthist', user) || []; h.unshift(entry); wsave('mkthist', user, h.slice(0, 40)); } catch { } }
    function mktReturnItem(l) {
      let inv = []; try { inv = ctx.getInv(l.seller) || []; } catch { }
      if (inv.includes(l.item)) return true;
      inv.push(l.item);
      try { ctx.setInv(l.seller, inv); } catch { }
      let chk = []; try { chk = ctx.getInv(l.seller) || []; } catch { }
      return chk.includes(l.item);
    }
    function mktSweep(reg, now) {
      let changed = false, n = 0;
      for (const lid of Object.keys(reg.list)) {
        if (n >= 20) break;
        const l = reg.list[lid];
        if (l.exp <= now) { if (mktReturnItem(l)) { delete reg.list[lid]; mktHist(l.seller, { t: 'expired', item: l.item, price: l.price, at: now }); changed = true; n++; } }
      }
      if (changed) mktSave(reg);
      return changed;
    }
    const MKT_INFLIGHT = new Set();
    const MKT_FEE = 0.05, MKT_MAX = 5, MKT_TTL = 48 * 3600 * 1000;

    if (u.pathname === '/api/world/market' && req.method === 'GET') {
      if (!ctx.storeReady || !ctx.storeReady()) { J({ ok: false, err: 'the market is still waking up — try again in a sec' }, 503); return true; }
      const reg = mktLoad();
      mktSweep(reg, now);
      const q = String(u.searchParams.get('q') || '').toLowerCase().slice(0, 40);
      const cat = String(u.searchParams.get('cat') || '');
      const sort = String(u.searchParams.get('sort') || 'new');
      let rows = Object.values(reg.list).map((l) => { const it = SHOP.BY_ID[l.item] || {}; return { lid: l.lid, item: l.item, name: it.name || l.item, cat: it.cat || '', rarity: it.rarity || 'common', color: it.color || '#a78bfa', price: l.price, seller: l.seller, at: l.at, exp: l.exp, mine: l.seller === me }; });
      if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.seller.toLowerCase().includes(q));
      if (cat) rows = rows.filter((r) => r.cat === cat);
      if (sort === 'lo') rows.sort((a, b) => a.price - b.price); else if (sort === 'hi') rows.sort((a, b) => b.price - a.price); else rows.sort((a, b) => b.at - a.at);
      J({ ok: true, listings: rows.slice(0, 100), total: rows.length, mine: rows.filter((r) => r.mine), hist: wload('mkthist', me) || [], feePct: 5, maxList: MKT_MAX });
      return true;
    }

    if (u.pathname === '/api/world/market' && req.method === 'POST') {
      if (!ctx.storeReady || !ctx.storeReady()) { J({ ok: false, err: 'the market is still waking up — try again in a sec' }, 503); return true; }
      const act = String(b.act || '');
      const reg = mktLoad();
      mktSweep(reg, now);
      if (act === 'list') {
        const item = String(b.item || '');
        const it = SHOP.BY_ID[item];
        if (!it) { J({ ok: false, err: 'no such item' }, 400); return true; }
        if (it.vaultOnly) { J({ ok: false, err: 'that item is bound to the world — it cant be sold' }, 400); return true; }
        const price = Math.floor(Number(b.price) || 0);
        if (!(price >= 10 && price <= 50000)) { J({ ok: false, err: 'price must be 10 to 50,000 six cents' }, 400); return true; }
        const myActive = Object.values(reg.list).filter((l) => l.seller === me).length;
        if (myActive >= MKT_MAX) { J({ ok: false, err: 'u already have ' + MKT_MAX + ' listings up' }, 400); return true; }
        let inv = []; try { inv = ctx.getInv(me) || []; } catch { }
        if (!inv.includes(item)) { J({ ok: false, err: 'u dont own that' }, 400); return true; }
        const equipped = equippedIds(me);
        if (equipped.has(item)) { J({ ok: false, err: 'unequip it first' }, 400); return true; }
        const snap = inv.slice();
        inv.splice(inv.indexOf(item), 1);
        let escrowed = false;
        try { ctx.setInv(me, inv); let chk = []; try { chk = ctx.getInv(me) || []; } catch { } escrowed = !chk.includes(item); } catch { }
        if (!escrowed) { try { ctx.setInv(me, snap); } catch { } J({ ok: false, err: 'listing glitched — ur item never left ur bag' }, 500); return true; }
        const lid = 'm' + (reg.seq++);
        reg.list[lid] = { lid, seller: me, item, price, at: now, exp: now + MKT_TTL };
        mktSave(reg);
        mktHist(me, { t: 'listed', item, price, at: now });
        J({ ok: true, lid });
        return true;
      }
      if (act === 'cancel') {
        const lid = String(b.lid || '');
        const l = reg.list[lid];
        if (!l) { J({ ok: false, err: 'that listing is gone' }, 400); return true; }
        if (l.seller !== me) { J({ ok: false, err: 'not ur listing' }, 403); return true; }
        if (MKT_INFLIGHT.has(lid)) { J({ ok: false, err: 'that listing is mid-sale — try again in a sec' }, 409); return true; }
        delete reg.list[lid]; mktSave(reg);
        if (!mktReturnItem(l)) { reg.list[lid] = l; mktSave(reg); J({ ok: false, err: 'cancel glitched — listing restored' }, 500); return true; }
        mktHist(me, { t: 'cancelled', item: l.item, price: l.price, at: now });
        J({ ok: true });
        return true;
      }
      if (act === 'buy') {
        const lid = String(b.lid || '');
        const l = reg.list[lid];
        if (!l) { J({ ok: false, err: 'that listing just sold or expired' }, 400); return true; }
        if (l.seller === me) { J({ ok: false, err: 'thats ur own listing' }, 400); return true; }
        if (MKT_INFLIGHT.has(lid)) { J({ ok: false, err: 'someone is buying that right now' }, 409); return true; }
        let bal0 = 0; try { bal0 = ctx.getCents(me) || 0; } catch { }
        if (bal0 < l.price) { J({ ok: false, err: 'not enough six cents' }, 400); return true; }
        MKT_INFLIGHT.add(lid);
        try {
          delete reg.list[lid]; mktSave(reg);
          const it = SHOP.BY_ID[l.item] || {};
          const fee = Math.max(1, Math.ceil(l.price * MKT_FEE));
          const proceeds = l.price - fee;
          let charged = false;
          try { const rr = await ctx.awardCents(me, -l.price); let bal1 = null; try { bal1 = ctx.getCents(me); } catch { } charged = typeof rr === 'number' && bal1 === bal0 - l.price; } catch { }
          if (!charged) { reg.list[lid] = l; mktSave(reg); J({ ok: false, err: 'payment glitched — u were not charged' }, 500); return true; }
          let granted = false;
          let inv = []; try { inv = ctx.getInv(me) || []; } catch { }
          const invSnap = inv.slice();
          inv.push(l.item);
          try { ctx.setInv(me, inv); let chk = []; try { chk = ctx.getInv(me) || []; } catch { } granted = chk.includes(l.item); } catch { }
          if (!granted) { try { await ctx.awardCents(me, l.price); } catch { } reg.list[lid] = l; mktSave(reg); J({ ok: false, err: 'grant glitched — u were refunded' }, 500); return true; }
          let paid = false;
          try { const rr2 = await ctx.awardCents(l.seller, proceeds); paid = typeof rr2 === 'number'; } catch { }
          if (!paid) {
            try { ctx.setInv(me, invSnap); } catch { }
            try { await ctx.awardCents(me, l.price); } catch { }
            reg.list[lid] = l; mktSave(reg);
            J({ ok: false, err: 'sale glitched — everything was put back' }, 500); return true;
          }
          txLog(me, 'market', -l.price, 'bought ' + (it.name || l.item) + ' from @' + l.seller);
          txLog(l.seller, 'market', proceeds, 'sold ' + (it.name || l.item) + ' (fee ' + fee + ')');
          mktHist(me, { t: 'bought', item: l.item, price: l.price, who: l.seller, at: now });
          mktHist(l.seller, { t: 'sold', item: l.item, price: l.price, got: proceeds, fee, who: me, at: now });
          const pg = progFor(me); pg.c.buy = (pg.c.buy || 0) + 1; progSave(me);
          journalNoteItems(me, [l.item]);
          J({ ok: true, item: l.item, price: l.price });
          return true;
        } finally { MKT_INFLIGHT.delete(lid); }
      }
      J({ ok: false, err: 'bad act' }, 400); return true;
    }

    if (u.pathname === '/api/world/events' && req.method === 'GET') {
      const evNow = worldEvent(now);
      const run = (evNow && EV_RUN && EV_RUN.id === evNow.id) ? EV_RUN : null;
      const board = run ? [...run.scores.entries()].map(([u2, v]) => ({ u: u2, v })).sort((a, b) => run.type === 'tourney' ? a.v - b.v : b.v - a.v).slice(0, 8) : [];
      const wins = wload('evwins', '_events') || {};
      const champs = Object.entries(wins).map(([u2, n]) => ({ u: u2, n })).sort((a, b) => b.n - a.n).slice(0, 10);
      J({ ok: true, now: evNow, soon: nextEventInfo(now), board, goal: run && run.goal ? { label: run.goal.label, n: run.goal.n, got: run.prog || 0 } : null, course: run ? run.course : null, zoneName: run && run.zone ? (ZONES.find((z2) => z2.id === run.zone) || {}).name || null : null, last: wload('evlast', '_events') || [], champs, hist: wload('evhist', me) || [] });
      return true;
    }

    if (u.pathname === '/api/world/races' && req.method === 'GET') {
      const pb = wload('racepb', me) || {};
      const recs = wload('racerec', '_racerec') || {};
      const wk = raceWeekKey(now);
      const wdat = wload('racewk', '_racewk') || { wk, rows: {} };
      const rows = wdat.wk === wk ? (wdat.rows || {}) : {};
      const rc = RACES.get(me);
      const courses = Object.keys(RACE_COURSES).map((cid) => {
        const C = RACE_COURSES[cid];
        const wkRows = rows[cid] || {};
        const wkTop = Object.keys(wkRows).map((u2) => ({ u: u2, ms: wkRows[u2] })).sort((a, b) => a.ms - b.ms).slice(0, 5);
        return { id: cid, name: C.name, startLabel: C.startLabel, n: C.pts.length, pb: pb[cid] || null, rec: recs[cid] || null, wkTop, myWk: wkRows[me] || null };
      });
      J({ ok: true, courses, active: rc ? { course: rc.course, state: rc.t0 ? 'running' : 'armed', idx: rc.idx, n: RACE_COURSES[rc.course].pts.length } : null });
      return true;
    }


    if (u.pathname === '/api/world/guild' && req.method === 'GET') {
      const qu = u.searchParams.get('u');
      if (qu) {
        const go = guildOf(String(qu).toLowerCase());
        J({ ok: true, guild: go ? { name: go.g.name, tag: go.g.tag, color: go.g.color, emblem: go.g.emblem, rank: go.g.members[String(qu).toLowerCase()] || 'member', lvl: guildLvl(go.g.xp) } : null });
        return true;
      }
      const reg = guildReg();
      const list = Object.keys(reg).map((gid) => { const g = reg[gid]; return { gid, name: g.name, tag: g.tag, color: g.color, emblem: g.emblem, lvl: guildLvl(g.xp), n: Object.keys(g.members).length, open: !!g.open }; }).sort((a, b) => b.n - a.n).slice(0, 30);
      const go = guildOf(me);
      let mine = null;
      if (go) {
        const g = go.g;
        const rankOrd = { owner: 0, officer: 1, member: 2 };
        const members = Object.keys(g.members).map((u2) => ({ u: u2, rank: g.members[u2], online: P.has(u2) })).sort((a, b) => (rankOrd[a.rank] - rankOrd[b.rank]) || (a.u < b.u ? -1 : 1));
        const claims = wload('guildclaim', me) || {};
        const wkKey = raceWeekKey(now);
        const got = claims.key === wkKey ? (claims.got || []) : [];
        const score = guildWkScore(g, now);
        mine = { gid: go.gid, name: g.name, tag: g.tag, color: g.color, emblem: g.emblem, open: !!g.open, owner: g.owner, xp: g.xp || 0, lvl: guildLvl(g.xp), myRank: g.members[me] || 'member', members, wk: { score, race: (g.wk && g.wk.key === wkKey) ? (g.wk.race || 0) : 0, crypt: (g.wk && g.wk.key === wkKey) ? (g.wk.crypt || 0) : 0, boss: (g.wk && g.wk.key === wkKey) ? (g.wk.boss || 0) : 0, milestones: GUILD_MS.map((m) => ({ at: m, hit: score >= m, claimed: got.indexOf(m) >= 0 })) } };
      }
      J({ ok: true, mine, list, invites: (GINV.get(me) || []).filter((v) => now - v.at < 120000) });
      return true;
    }

    if (u.pathname === '/api/world/guild-create' && req.method === 'POST') {
      if (guildOf(me)) { J({ ok: false, err: 'ur already in a guild — leave it first' }, 400); return true; }
      const name = String(b.name || '').replace(/[<>&"'\\]/g, '').trim().replace(/\s+/g, ' ');
      const tag = String(b.tag || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4);
      const emblem = GUILD_EMBLEMS.indexOf(String(b.emblem || '')) >= 0 ? String(b.emblem) : 'star';
      const color = Math.max(0, Math.min(359, Math.round(Number(b.color) || 265)));
      if (name.length < 3 || name.length > 16) { J({ ok: false, err: 'guild name is 3-16 chars' }, 400); return true; }
      if (tag.length < 2) { J({ ok: false, err: 'tag is 2-4 letters/numbers' }, 400); return true; }
      const reg = guildReg();
      const gids = Object.keys(reg);
      if (gids.length >= 200) { J({ ok: false, err: 'too many guilds rn' }, 400); return true; }
      if (gids.some((gid) => reg[gid].name.toLowerCase() === name.toLowerCase())) { J({ ok: false, err: 'that name is taken' }, 400); return true; }
      if (gids.some((gid) => reg[gid].tag === tag)) { J({ ok: false, err: 'that tag is taken' }, 400); return true; }
      if (GUILD_INFLIGHT.has(me)) { J({ ok: false, err: 'already on it — one sec' }, 429); return true; }
      let bal0 = 0;
      try { bal0 = ctx.getCents(me) || 0; } catch (e) {}
      if (bal0 < 500) { J({ ok: false, err: 'a guild charter costs 500 six cents (u have ' + bal0 + ')' }, 400); return true; }
      GUILD_INFLIGHT.add(me);
      let nb = null;
      try { nb = await ctx.awardCents(me, -500); } catch (e) { nb = null; }
      let balNow = null;
      try { balNow = ctx.getCents(me); } catch { }
      if (typeof nb !== 'number' || balNow == null || balNow === bal0) { GUILD_INFLIGHT.delete(me); J({ ok: false, err: 'payment glitched — u were not charged' }, 500); return true; }
      const gid = 'g' + (hashStr(name.toLowerCase() + ':' + now) % 1000000007).toString(36);
      reg[gid] = { name, tag, color, emblem, open: !!b.open, owner: me, xp: 0, created: now, members: { [me]: 'owner' }, wk: null };
      guildSaveReg(reg);
      wsave('guild', me, gid);
      GUILD_INFLIGHT.delete(me);
      J({ ok: true, gid });
      return true;
    }

    if (u.pathname === '/api/world/guild-join' && req.method === 'POST') {
      if (guildOf(me)) { J({ ok: false, err: 'ur already in a guild' }, 400); return true; }
      const gid = String(b.gid || '');
      const reg = guildReg(); const g = reg[gid];
      if (!g) { J({ ok: false, err: 'no such guild' }, 400); return true; }
      const invited = (GINV.get(me) || []).some((v) => v.gid === gid && now - v.at < 120000);
      if (!g.open && !invited) { J({ ok: false, err: 'that guild is invite-only' }, 400); return true; }
      if (Object.keys(g.members).length >= 30) { J({ ok: false, err: 'that guild is full (30)' }, 400); return true; }
      guildJoin(me, gid);
      GINV.set(me, (GINV.get(me) || []).filter((v) => v.gid !== gid));
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-answer' && req.method === 'POST') {
      const gid = String(b.gid || '');
      GINV.set(me, (GINV.get(me) || []).filter((v) => v.gid !== gid));
      if (b.yes) {
        if (guildOf(me)) { J({ ok: false, err: 'ur already in a guild' }, 400); return true; }
        const reg = guildReg(); const g = reg[gid];
        if (!g) { J({ ok: false, err: 'that guild is gone' }, 400); return true; }
        if (Object.keys(g.members).length >= 30) { J({ ok: false, err: 'that guild is full (30)' }, 400); return true; }
        guildJoin(me, gid);
      }
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-leave' && req.method === 'POST') {
      const go = guildOf(me);
      if (!go) { J({ ok: false, err: 'ur not in a guild' }, 400); return true; }
      if (go.g.owner === me && Object.keys(go.g.members).length > 1) { J({ ok: false, err: 'owners transfer or disband first' }, 400); return true; }
      if (go.g.owner === me) {
        const reg = guildReg(); delete reg[go.gid]; guildSaveReg(reg);
        wsave('guild', me, null);
      } else guildRemoveMember(go.gid, me);
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-disband' && req.method === 'POST') {
      const go = guildOf(me);
      if (!go || go.g.owner !== me) { J({ ok: false, err: 'only the owner can disband' }, 403); return true; }
      const reg = guildReg(); delete reg[go.gid]; guildSaveReg(reg);
      for (const u2 of Object.keys(go.g.members)) if (wload('guild', u2) === go.gid) wsave('guild', u2, null);
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-invite' && req.method === 'POST') {
      const go = guildOf(me);
      if (!go || (go.g.members[me] !== 'owner' && go.g.members[me] !== 'officer')) { J({ ok: false, err: 'only owners + officers invite' }, 403); return true; }
      const to = String(b.to || '').toLowerCase();
      if (!to || to === me || !P.has(to)) { J({ ok: false, err: 'they arent online rn' }, 400); return true; }
      if (guildOf(to)) { J({ ok: false, err: 'theyre already in a guild' }, 400); return true; }
      if (Object.keys(go.g.members).length >= 30) { J({ ok: false, err: 'guild is full (30)' }, 400); return true; }
      const arr = (GINV.get(to) || []).filter((v) => v.gid !== go.gid);
      arr.push({ gid: go.gid, from: me, name: go.g.name, tag: go.g.tag, at: now });
      GINV.set(to, arr.slice(-5));
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-kick' && req.method === 'POST') {
      const go = guildOf(me);
      const target = String(b.u || '').toLowerCase();
      if (!go || !target || target === me || !go.g.members[target]) { J({ ok: false, err: 'bad kick' }, 400); return true; }
      const myRank = go.g.members[me], tRank = go.g.members[target];
      if (myRank !== 'owner' && !(myRank === 'officer' && tRank === 'member')) { J({ ok: false, err: 'cant kick them' }, 403); return true; }
      guildRemoveMember(go.gid, target);
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-rank' && req.method === 'POST') {
      const go = guildOf(me);
      const target = String(b.u || '').toLowerCase();
      const rank = String(b.rank || '');
      if (!go || go.g.owner !== me || !go.g.members[target] || target === me || (rank !== 'officer' && rank !== 'member')) { J({ ok: false, err: 'bad rank change' }, 400); return true; }
      const reg = guildReg(); reg[go.gid].members[target] = rank; guildSaveReg(reg);
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-transfer' && req.method === 'POST') {
      const go = guildOf(me);
      const target = String(b.u || '').toLowerCase();
      if (!go || go.g.owner !== me || !go.g.members[target] || target === me) { J({ ok: false, err: 'bad transfer' }, 400); return true; }
      const reg = guildReg();
      reg[go.gid].members[target] = 'owner'; reg[go.gid].members[me] = 'officer'; reg[go.gid].owner = target;
      guildSaveReg(reg);
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-open' && req.method === 'POST') {
      const go = guildOf(me);
      if (!go || go.g.owner !== me) { J({ ok: false, err: 'owner only' }, 403); return true; }
      const reg = guildReg(); reg[go.gid].open = !!b.open; guildSaveReg(reg);
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-say' && req.method === 'POST') {
      const go = guildOf(me);
      if (!go) { J({ ok: false, err: 'ur not in a guild' }, 400); return true; }
      if (now - (GSAY_CD.get(me) || 0) < 600) { J({ ok: false, err: 'too fast' }, 429); return true; }
      const text = String(b.text || '').replace(/[<>&]/g, '').trim().slice(0, 200);
      if (!text) { J({ ok: false, err: 'empty' }, 400); return true; }
      GSAY_CD.set(me, now);
      for (const u2 of Object.keys(go.g.members)) {
        if (u2 === me || !P.has(u2)) continue;
        const q = GMSG.get(u2) || []; q.push({ from: me, text, at: now }); GMSG.set(u2, q.slice(-20));
      }
      J({ ok: true });
      return true;
    }

    if (u.pathname === '/api/world/guild-claim' && req.method === 'POST') {
      const go = guildOf(me);
      if (!go) { J({ ok: false, err: 'ur not in a guild' }, 400); return true; }
      const ms = Number(b.ms);
      if (GUILD_MS.indexOf(ms) < 0) { J({ ok: false, err: 'bad milestone' }, 400); return true; }
      if (guildWkScore(go.g, now) < ms) { J({ ok: false, err: 'ur guild hasnt hit that milestone this week' }, 400); return true; }
      const wkKey = raceWeekKey(now);
      const claims = wload('guildclaim', me) || {};
      const got = claims.key === wkKey ? (claims.got || []) : [];
      if (got.indexOf(ms) >= 0) { J({ ok: false, err: 'already claimed' }, 400); return true; }
      got.push(ms);
      wsave('guildclaim', me, { key: wkKey, got });
      let bal = null;
      try { bal = await ctx.awardCents(me, 25); } catch (e) { bal = null; }
      if (typeof bal !== 'number' || bal < 25) {
        // payout did not land — un-record the claim so it can be retried
        const claims2 = wload('guildclaim', me) || {};
        const got2 = (claims2.key === wkKey ? (claims2.got || []) : []).filter((x) => x !== ms);
        wsave('guildclaim', me, { key: wkKey, got: got2 });
        J({ ok: false, err: 'payout glitched \u2014 try claiming again' }, 500);
        return true;
      }
      txLog(me, 'guild', 25, 'weekly milestone ' + ms);
      J({ ok: true, amt: 25, bal });
      return true;
    }

    if (u.pathname === '/api/world/skills' && req.method === 'GET') {
      const pg = progFor(me);
      const paid = wload('skillpay', me) || {};
      let paidNow = 0;
      const list = SKILL_DEFS.map((sd) => {
        const count = sd.count(pg);
        const lvl = Math.min(10, Math.floor(Math.sqrt(count / sd.per)));
        for (const [ml, pay] of SKILL_PAY) if (lvl >= ml && (paid[sd.id] || 0) < ml) { paid[sd.id] = ml; paidNow += pay; }
        return { id: sd.id, name: sd.name, c: sd.c, count, lvl, nextAt: lvl >= 10 ? null : Math.ceil(sd.per * (lvl + 1) * (lvl + 1)), title: SKILL_TITLES[Math.min(5, Math.floor(lvl / 2))] };
      });
      if (paidNow > 0) {
        if (SKILL_INFLIGHT.has(me)) { paidNow = 0; }
        else {
          SKILL_INFLIGHT.add(me);
          let okPay = false;
          try { const nb = await ctx.awardCents(me, paidNow); okPay = typeof nb === 'number'; } catch { okPay = false; }
          if (okPay) { wsave('skillpay', me, paid); txLog(me, 'skill milestones', paidNow); }
          else paidNow = 0;
          SKILL_INFLIGHT.delete(me);
        }
      }
      J({ ok: true, skills: list, paidNow });
      return true;
    }

    if (u.pathname === '/api/world/craft' && req.method === 'GET') {
      const mats = matsOf(me);
      let inv = []; try { inv = ctx.getInv(me) || []; } catch { }
      const bp = P.get(me);
      const nearStation = !!bp && !bp.house && !bp.inst && dist(bp.x, bp.y, 3950, 1600) < 240;
      J({ ok: true, mats, nearStation, recipes: RECIPES.map((r) => { const it = SHOP.BY_ID[r.out]; return { id: r.out, name: it.name, cat: it.cat, rarity: it.rarity, c: it.color, owned: inv.includes(r.out), needs: Object.entries(r.needs).map(([m, n]) => ({ mat: m, name: MATS[m].name, c: MATS[m].c, n, have: mats[m] || 0 })) }; }) });
      return true;
    }
    if (u.pathname === '/api/world/craft' && req.method === 'POST') {
      if (CRAFT_INFLIGHT.has(me)) { J({ ok: false, err: 'already crafting \u2014 one sec' }, 429); return true; }
      CRAFT_INFLIGHT.add(me);
      try {
        const r = RECIPES.find((x) => x.out === String(b.id || ''));
        if (!r) { J({ ok: false, err: 'no such recipe' }, 400); return true; }
        const bp = P.get(me);
        if (!bp || bp.house || bp.inst || dist(bp.x, bp.y, 3950, 1600) >= 240) { J({ ok: false, err: 'crafting happens at the shop tent workbench' }, 400); return true; }
        let inv = []; try { inv = ctx.getInv(me) || []; } catch { }
        if (inv.includes(r.out)) { J({ ok: false, err: 'u already have that one' }, 400); return true; }
        const mats = matsOf(me);
        for (const [m, n] of Object.entries(r.needs)) if ((mats[m] || 0) < n) { J({ ok: false, err: 'not enough ' + MATS[m].name }, 400); return true; }
        const matsBefore = Object.assign({}, mats);
        for (const [m, n] of Object.entries(r.needs)) mats[m] -= n;
        wsave('mats', me, mats);
        inv.push(r.out);
        let granted = false;
        try { ctx.setInv(me, inv); granted = (ctx.getInv(me) || []).includes(r.out); } catch { granted = false; }
        if (!granted) { wsave('mats', me, matsBefore); J({ ok: false, err: 'craft glitched \u2014 ur materials were put back' }, 500); return true; }
        txLog(me, 'craft', 0, SHOP.BY_ID[r.out].name);
        const pgCr = progFor(me); pgCr.c.craft = (pgCr.c.craft || 0) + 1; progSave(me);
        awardXp(me, 10);
        journalNoteItems(me, [r.out]);
        J({ ok: true, made: SHOP.BY_ID[r.out].name });
        return true;
      } finally { CRAFT_INFLIGHT.delete(me); }
    }
    if (u.pathname === '/api/world/trade' && req.method === 'POST') {
      const act = String(b.act || '');
      const nowT = Date.now();
      if (act === 'invite') {
        const to = String(b.to || '').toLowerCase();
        if (!to || to === me) { J({ ok: false, err: 'pick someone else' }, 400); return true; }
        if (!P.has(to)) { J({ ok: false, err: '@' + to + ' is not online' }, 400); return true; }
        if ((wload('blocks', me) || []).includes(to) || (wload('blocks', to) || []).includes(me)) { J({ ok: false, err: 'blocked' }, 400); return true; }
        if (TRADE_OF.has(me) || TRADE_OF.has(to)) { J({ ok: false, err: 'one of u is already trading' }, 400); return true; }
        TINV.set(to, { from: me, at: nowT });
        J({ ok: true }); return true;
      }
      if (act === 'answer') {
        const iv = TINV.get(me); TINV.delete(me);
        if (!iv || nowT - iv.at > 90000) { J({ ok: false, err: 'that invite fizzled' }, 400); return true; }
        if (!b.yes) { J({ ok: true }); return true; }
        if (TRADE_OF.has(me) || TRADE_OF.has(iv.from) || !P.has(iv.from)) { J({ ok: false, err: 'trade fizzled' }, 400); return true; }
        const id = 't' + Math.abs(hashStr(me + ':' + iv.from + ':' + nowT)).toString(36);
        TRADES.set(id, { id, a: iv.from, b: me, oa: { items: [], cents: 0 }, ob: { items: [], cents: 0 }, la: false, lb: false, ca: false, cb: false, at: nowT });
        TRADE_OF.set(me, id); TRADE_OF.set(iv.from, id);
        J({ ok: true }); return true;
      }
      const tid = TRADE_OF.get(me);
      const tr = tid ? TRADES.get(tid) : null;
      if (act === 'cancel') { if (tr) endTrade(tr, 'trade cancelled'); J({ ok: true }); return true; }
      if (!tr) { J({ ok: false, err: 'no trade going' }, 400); return true; }
      if (nowT - tr.at > 150000) { endTrade(tr, 'trade timed out'); J({ ok: false, err: 'trade timed out' }, 400); return true; }
      const mineK = tr.a === me ? 'oa' : 'ob';
      const myLockK = tr.a === me ? 'la' : 'lb', myConfK = tr.a === me ? 'ca' : 'cb';
      if (act === 'set') {
        const items = Array.isArray(b.items) ? [...new Set(b.items.map((x) => String(x)))].slice(0, 8) : [];
        let inv = []; try { inv = ctx.getInv(me) || []; } catch { }
        const equipped = equippedIds(me);
        for (const id of items) {
          if (!SHOP.BY_ID[id] || !inv.includes(id)) { J({ ok: false, err: 'u dont own one of those' }, 400); return true; }
          if (equipped.has(id)) { J({ ok: false, err: 'unequip it first' }, 400); return true; }
        }
        const cents = Math.max(0, Math.floor(Number(b.cents) || 0));
        let bal = 0; try { bal = ctx.getCents(me) || 0; } catch { }
        if (cents > bal) { J({ ok: false, err: 'not enough six cents' }, 400); return true; }
        tr[mineK] = { items, cents };
        tr.la = tr.lb = tr.ca = tr.cb = false; tr.at = nowT;
        J({ ok: true }); return true;
      }
      if (act === 'lock') { tr[myLockK] = !!b.locked; if (!b.locked) { tr.ca = tr.cb = false; } tr.at = nowT; J({ ok: true }); return true; }
      if (act === 'confirm') {
        if (!(tr.la && tr.lb)) { J({ ok: false, err: 'both sides lock in first' }, 400); return true; }
        tr[myConfK] = true; tr.at = nowT;
        if (tr.ca && tr.cb) { const done = await execTrade(tr); J(done); return true; }
        J({ ok: true }); return true;
      }
      J({ ok: false, err: 'bad act' }, 400); return true;
    }

    if (u.pathname === '/api/world/dungeon-enter' && req.method === 'POST') {
      const now3 = Date.now();
      const bp = P.get(me);
      if (!bp || dist(bp.x, bp.y, CRYPT_GATE.x, CRYPT_GATE.y) > 140) { J({ ok: false, err: 'the crypt gate is in the crystal caves' }, 400); return true; }
      if (bp.inst) { J({ ok: false, err: 'already inside' }, 400); return true; }
      const pt = partyOf(me);
      if (pt && pt.leader !== me) { J({ ok: false, err: 'only the party leader can open the crypt' }, 400); return true; }
      const leader = pt ? pt.leader : me;
      const instId = 'crypt:' + leader;
      let dg = DUNGEONS.get(instId);
      if (dg && dg.state === 'fighting') { J({ ok: false, err: 'ur party is already inside' }, 400); return true; }
      const members = (pt ? pt.members : [me]).filter((m) => P.has(m));
      const origin = cryptOrigin(instId);
      dg = { id: instId, leader, origin, members: new Set(members), hearts: {}, hitCd: new Map(), wave: 0, shades: [], state: 'fighting', lastTick: now3, startedAt: now3 };
      for (const m of members) dg.hearts[m] = 3;
      DUNGEONS.set(instId, dg);
      spawnWave(dg, 1);
      for (const m of members) { const mp = P.get(m); mp.x = origin.x + 550; mp.y = origin.y + 420; mp.inst = instId; TP_OK.add(m); }
      J({ ok: true, members, wave: 1, x: origin.x + 550, y: origin.y + 420 });
      return true;
    }
    if (u.pathname === '/api/world/dungeon-exit' && req.method === 'POST') {
      const bp = P.get(me);
      if (!bp || !bp.inst) { J({ ok: false, err: 'not inside' }, 400); return true; }
      const dg = DUNGEONS.get(bp.inst);
      if (dg) { dg.members.delete(me); if (!dg.members.size) DUNGEONS.delete(bp.inst); }
      bp.inst = null; bp.x = CRYPT_GATE.x; bp.y = CRYPT_GATE.y + 60; TP_OK.add(me);
      J({ ok: true, x: CRYPT_GATE.x, y: CRYPT_GATE.y + 60 });
      return true;
    }
    if (u.pathname === '/api/world/dungeon-hit' && req.method === 'POST') {
      const now3 = Date.now();
      const dg = dungeonOf(me);
      if (!dg || dg.state !== 'fighting') { J({ ok: false, err: 'no fight here' }, 400); return true; }
      if (now3 - (DUN_HIT_CD.get(me) || 0) < 400) { J({ ok: false, err: 'too fast' }, 429); return true; }
      const sid = String(b.shade || '');
      const sh = dg.shades.find((s2) => s2.id === sid);
      if (!sh) { J({ ok: false, err: 'that shade is gone' }, 400); return true; }
      const bp = P.get(me);
      if (!bp || dist(bp.x, bp.y, sh.x, sh.y) > 250) { J({ ok: false, err: 'too far from the shade' }, 400); return true; }
      DUN_HIT_CD.set(me, now3);
      tickDungeon(dg, now3);
      const dmg = 10 + Math.round(Math.random() * 6);
      sh.hp -= dmg;
      let killed = false, pay = 0;
      if (sh.hp <= 0) {
        killed = true;
        dg.shades = dg.shades.filter((s2) => s2.id !== sid);
        pay = sh.boss ? 30 : 4;
        try { await ctx.awardCents(me, pay); } catch { }
        txLog(me, 'crypt', pay, sh.boss ? 'the crypt warden' : 'crypt shade');
        if (sh.boss || Math.random() < 0.4) matAdd(me, 'cloth', 1);
        await progressWaves(dg, now3);
      }
      J({ ok: true, dmg, killed, pay, wave: dg.wave, state: dg.state });
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
      seasonQuestAdd(me, 'fish', 1);
      { const evF = worldEvent(Date.now()); if (evF && EV_RUN && EV_RUN.id === evF.id) { if (evF.type === 'derby') evScore(me, DERBY_PTS[sp.band] || 1); if (evF.type === 'community') evGoalBump('fish', me); } }
      if (Math.random() < 0.5) matAdd(me, 'scale', 1);
      achCheck(me);
      const log = wload('fishlog', me) || {};
      const le = log[sp.id] || { n: 0, max: 0 };
      le.n += 1; le.max = Math.max(le.max, kg);
      log[sp.id] = le;
      wsave('fishlog', me, log);
      if (le.n === 1) noteSeen(me, 'fish', sp.id);
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
      try { bal0 = ctx.getCents(me) || 0; } catch { }
      if (bal0 < price) { J({ ok: false, err: 'not enough six cents (need ' + price + ')' }); return true; }
      BUYLOCK.add(me);
      try {
        let bal = null;
        try { bal = await ctx.awardCents(me, -price); } catch { bal = null; }
        let balNow = null;
        try { balNow = ctx.getCents(me); } catch { }
        if (typeof bal !== 'number' || balNow == null || (balNow === bal0 && price > 0)) { J({ ok: false, err: 'payment glitched — u were not charged' }, 500); return true; }
        if (kind === 'style') { const h = houseOf(me); h.style = id; houseSave(me, h); }
        else { const f = furnInv(me); f.push(id); wsave('furn', me, f); }
        txLog(me, 'house', -price, label);
        J({ ok: true, bal: balNow, view: houseView(me, me) });
        return true;
      } finally { BUYLOCK.delete(me); }
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

    // plausibility floor per engine: a genuine run cannot finish faster than
    // this (set far below real human times; it exists to stop scripts that
    // submit a max score the instant the old flat 2s window opens)
    function mgMinMs(g, pts) {
      const p = g.params || {};
      switch (g.engine) {
        case 'pop': case 'catch': return Math.floor((p.secs || 20) * 900);
        case 'plat': case 'race': return Math.floor((p.secs || 40) * 250);
        case 'rhythm': return Math.max(4000, Math.floor((p.notes || 20) * 60000 / (p.bpm || 100) * 0.3));
        case 'memory': return Math.max(2000, (p.len || 6) * 350);
        case 'react': return Math.max(2000, (p.rounds || 5) * 500);
        case 'stack': return Math.max(2000, (p.levels || 10) * 400);
        case 'slide': return Math.max(2500, (p.size || 3) * (p.size || 3) * 300);
        case 'quiz': return 6000;
        case 'snake': return 5000;
        case 'maze': return 2500;
        default: return 2000;
      }
    }
    if (u.pathname === '/api/world/mini-start' && req.method === 'POST') {
      const g = GAMES_MOD.BY_ID[String(b.game || '')];
      if (!g) { J({ ok: false, err: 'no such minigame' }, 400); return true; }
      const token = 'mt' + now.toString(36) + Math.floor(Math.random() * 1e9).toString(36);
      MTOK.set(token, { user: me, game: g.id, at: now });
      noteSeen(me, 'minigame', g.id);
      if (MTOK.size > 400) { for (const [k, v] of MTOK) { if (now - v.at > 180000) MTOK.delete(k); } }
      J({ ok: true, token });
      return true;
    }
    if (u.pathname === '/api/world/miniscore' && req.method === 'POST') {
      const g = GAMES_MOD.BY_ID[String(b.game || '')];
      if (!g) { J({ ok: false, err: 'no such minigame' }, 400); return true; }
      const pts = Math.floor(Number(b.points));
      if (!Number.isFinite(pts) || pts < 0 || pts > g.maxPoints) { J({ ok: false, err: 'score out of range' }, 400); return true; }
      // rate limit first: a rejected submit must never burn the one-shot token
      if (now - (lastMini.get(me) || 0) < 10000) { J({ ok: false, err: 'too fast \u2014 give it a few seconds' }, 429); return true; }
      // a score only pays against a live play session: started via mini-start,
      // one-shot, right game, right player, at least 2s of actual play.
      const tk = MTOK.get(String(b.token || ''));
      let live = false;
      if (tk && tk.user === me && tk.game === g.id && now - tk.at >= 2000 && now - tk.at <= 240000) { live = true; MTOK.delete(String(b.token || '')); }
      if (live) seasonQuestAdd(me, 'mg', 1);
      // per-engine plausibility floor: finishing faster than a real run can
      // possibly take makes the session practice, same as an invalid token
      if (live && now - tk.at < mgMinMs(g, pts)) live = false;
      if (!live) {
        let bal0 = null;
        try { bal0 = ctx.getCents(me); } catch { }
        J({ ok: true, cents: 0, paid: false, practice: true, playsLeft: null, bal: bal0 });
        return true;
      }
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
      try {
        const it = SHOP.BY_ID[String(b.id || '')];
        if (!it) { J({ ok: false, err: 'no such item' }, 400); return true; }
        if (it.vaultOnly) { J({ ok: false, err: 'that one is not for sale — it waits somewhere hidden' }); return true; }
        if (it.craftOnly) { J({ ok: false, err: 'that one is crafted, not bought — open the crafting panel' }); return true; }
        let inv = [];
        try { inv = ctx.getInv(me) || []; } catch { }
        if (inv.includes(it.id)) { J({ ok: false, err: 'u already own that' }); return true; }
        let bal0 = 0;
        try { bal0 = ctx.getCents(me) || 0; } catch { }
        if (bal0 < it.price) { J({ ok: false, err: 'not enough six cents', bal: bal0 }); return true; }
        // charge first, and only grant once the charge has verifiably landed
        let bal = null;
        try { bal = await ctx.awardCents(me, -it.price); } catch { bal = null; }
        let balNow = null;
        try { balNow = ctx.getCents(me); } catch { }
        if (typeof bal !== 'number' || balNow == null || (balNow === bal0 && it.price > 0)) { J({ ok: false, err: 'payment glitched — u were not charged' }, 500); return true; }
        inv.push(it.id);
        let granted = false;
        try { ctx.setInv(me, inv); granted = (ctx.getInv(me) || []).includes(it.id); } catch { granted = false; }
        if (!granted) {
          try { await ctx.awardCents(me, it.price); } catch { }
          J({ ok: false, err: 'grant glitched — u were refunded' }, 500);
          return true;
        }
        txLog(me, 'shop', -it.price, it.name);
        journalNoteItems(me, [it.id]);
        const pgb = progFor(me); pgb.c.buy = (pgb.c.buy || 0) + 1; progSave(me); achCheck(me);
        J({ ok: true, bal: balNow, inv });
        return true;
      } finally { BUYLOCK.delete(me); }
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
      J({ ok: true, user: who, cents, hue, wear: wearNames, online: P.has(who), prog: (() => { try { return progView(who); } catch { return null; } })(), season: (() => { try { return seasonTierOf(seasonFor(who).xp || 0); } catch { return 0; } })(), collect: (() => { try { return buildJournal(who).overall; } catch { return null; } })(), act: P.has(who) ? actOf(who, P.get(who), now) : '' });
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
      RACES.delete(me);
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
      journalNoteItems(me, ['s141']);
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
      // signaling payloads are WebRTC messages only: a plain object with a
      // known type, small enough to ride a ping payload
      const sdata = b.data;
      if (!sdata || typeof sdata !== 'object' || Array.isArray(sdata) || (sdata.t !== 'offer' && sdata.t !== 'answer' && sdata.t !== 'ice')) { J({ ok: false }); return true; }
      let sdLen = 0;
      try { sdLen = JSON.stringify(sdata).length; } catch { J({ ok: false }); return true; }
      if (sdLen > 16384) { J({ ok: false }); return true; }
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

  function iceExtra() {
    const urls = String(process.env.WORLD_TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return [];
    const out = { urls };
    if (process.env.WORLD_TURN_USER) out.username = process.env.WORLD_TURN_USER;
    if (process.env.WORLD_TURN_PASS) out.credential = process.env.WORLD_TURN_PASS;
    return [out];
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
      '  <div class="wprof-acts"><button id="wprof-add" type="button">add friend</button><button id="wprof-battle" type="button">battle</button><button id="wprof-poke" type="button">wave</button><a id="wprof-link" href="#">full profile</a></div>\n' +
      '  <div class="wprof-acts2"><button id="wprof-invite" type="button">party invite</button><button id="wprof-trade" type="button">trade</button><button id="wprof-mute" type="button">mute</button><button id="wprof-block" type="button">block</button><button id="wprof-report" type="button">report</button><button id="wprof-visit" type="button">visit house</button></div></div>\n' +
      '</div></div>\n' +
      '<div id="wduel" hidden><span id="wduel-t"></span><button id="wduel-yes" type="button">accept</button><button id="wduel-no" type="button">nah</button></div>\n' +
      '<div id="wparty-inv" hidden><span id="wparty-inv-t"></span><button id="wparty-yes" type="button">join party</button><button id="wparty-no" type="button">nah</button></div>\n' +
      '<div id="wtrade-inv" hidden><span id="wtrade-inv-t"></span><button id="wtrade-yes" type="button">trade</button><button id="wtrade-no" type="button">nah</button></div>\n' +
      '<div id="wevents" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 world events</span><button id="wevents-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wevents-body"></div>\n' +
      '</div></div>\n' +
      '<div id="wmarket" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 player marketplace</span><button id="wmarket-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wmarket-body"></div>\n' +
      '</div></div>\n' +
      '<div id="wcollect" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 collection journal</span><button id="wcollect-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wcollect-body"></div>\n' +
      '</div></div>\n' +
      '<div id="wseason" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 season 1 \u00b7 first frost</span><button id="wseason-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wseason-body"></div>\n' +
      '</div></div>\n' +
      '<div id="wfriends" hidden><div class="wa-card">\n' +
      '  <div class="wa-head"><span>\u2726 ur people</span><button id="wfriends-x" type="button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>\n' +
      '  <div id="wfriends-body"></div>\n' +
      '</div></div>\n' +
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
      '  <canvas id="wmap2-cv" width="1120" height="760"></canvas>\n' +
      '  <div class="wmap2-bar"><button id="wmap2-me" type="button">center on me</button><button id="wmap2-zin" type="button">zoom +</button><button id="wmap2-zout" type="button">zoom -</button><span id="wmap2-info"></span></div>\n' +
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
      '  <div class="wadmin-row"><button class="wadmin-ev" data-ev="shardstorm" type="button">force shard storm</button><button class="wadmin-ev" data-ev="goldenhunt" type="button">force golden hunt</button><button class="wadmin-ev" data-ev="meteor" type="button">force meteor shower</button><button class="wadmin-ev" data-ev="treasure" type="button">force treasure hunt</button><button class="wadmin-ev" data-ev="doublexp" type="button">force double xp</button><button class="wadmin-ev" data-ev="derby" type="button">force fishing derby</button><button class="wadmin-ev" data-ev="tourney" type="button">force race tourney</button><button class="wadmin-ev" data-ev="crystalhunt" type="button">force crystal hunt</button><button class="wadmin-ev" data-ev="community" type="button">force community challenge</button><button class="wadmin-ev" data-ev="lichsurge" type="button">force lich surge</button><button class="wadmin-ev" data-ev="errand" type="button">force sixs errand</button><button class="wadmin-ev" data-ev="off" type="button">events off</button></div>\n' +
      '</div></div>\n' +
      '<div id="wfish" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 fishing</span><button id="wfish-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wfish-body"></div></div></div>\n' +
      '<div id="wrace" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 races</span><button id="wrace-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wrace-body"></div></div></div>\n' +
      '<div id="wguild" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 guild</span><button id="wguild-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wguild-body"></div></div></div>\n' +
      '<div id="wtrade" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 trade</span><button id="wtrade-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wtrade-body"></div></div></div>\n' +
      '<div id="wcraft" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 crafting</span><button id="wcraft-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wcraft-body"></div></div></div>\n' +
      '<div id="wskills" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 skills</span><button id="wskills-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wskills-body"></div></div></div>\n' +
      '<div id="wphoto" hidden><button id="wphoto-x" type="button">done</button><div id="wphoto-bar"><div id="wphoto-frames"><button type="button" data-frame="none">no frame</button><button type="button" data-frame="star" class="on">star</button><button type="button" data-frame="polaroid">polaroid</button><button type="button" data-frame="film">film</button></div><button id="wphoto-shut" type="button">SNAP</button><div id="wphoto-gal"></div></div></div>\n' +
      '<div id="wpets" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 pet journal</span><button id="wpets-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="wpets-body"></div></div></div>\n' +
      '<div id="whouse" hidden><div class="wa-card"><div class="wa-head"><span>\u2726 <span id="whouse-t">ur house</span></span><button id="whouse-x" type="button" aria-label="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div id="whouse-body"></div></div></div>\n' +
      '<div id="wduelgo" hidden><div id="wduelgo-t"></div><div id="wduelgo-s"></div></div>\n' +
      '<div id="wlogin" hidden><div class="wl-card"><div class="wl-big">six\'s network is for the logged-in</div>' +
      '<p>make an account or log in, then walk in. a whole world in here: districts, a lake, a forest, moon shards, quests from six, voice chat.</p>' +
      '<a class="wl-btn" href="/home">go log in</a></div></div>\n' +
      '<script>' + ctx.NOTIF_JS + '</script>\n' +
      '<script>window.WGAMES=' + JSON.stringify(GAMES_MOD.GAMES) + ';window.WCABS=' + JSON.stringify(GAMES_MOD.CABINETS) + ';window.WSHOP=' + JSON.stringify(SHOP.ITEMS) + ';window.WICE=' + JSON.stringify(iceExtra()) + ';</script>\n' +
      '<script>' + CLIENT + '</script>\n' +
      '</body>\n</html>';
  }

  return { api, page };
}

module.exports = { createWorld };
