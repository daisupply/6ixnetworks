'use strict';
/*
 * world3d.js — THE THIRD DIMENSION for 6ixNetworks: a separate 3D version
 * of the World, built under the mandatory 3D-migration safeguards
 * (2026-11-21). It is FULLY ISOLATED from the 2D game:
 *
 *   - its own directory (world3d/), its own routes (/world3d,
 *     /api/world3d/*), its own presence map, its own renderer.
 *   - it NEVER writes player data. Currency/inventory/progression stay
 *     owned by the existing systems; this module only READS the balance
 *     through ctx.getCents so the HUD matches the 2D game exactly.
 *     One source of truth — no duplicate accounts, no competing state.
 *   - server.js only wires it up, same pattern as world/world.js:
 *       const W3 = require('./world3d/world3d.js').createWorld3D({...ctx});
 *       if (await W3.api(req, res, u)) return;            // /api/world3d/*
 *       if (u.pathname === '/world3d') ... W3.page();
 *       asset routes -> W3.asset(pathname)
 *
 * Multiplayer rides the same model as the 2D world: HTTP ping-polling
 * presence (no sockets), server-validated movement (per-step clamp +
 * sustained-speed window, mirroring the 2D ping handler), stale
 * presence pruned after 7s, one presence entry per account (a second
 * tab takes over the same entry — duplicate spawns are impossible).
 *
 * Coordinates: the 3D plaza is the fountain district of the 2D map at
 * 1 unit = 10 world px, fountain at the origin:
 *   x3 = (x2 - 2400) / 10,  z3 = (y2 - 1500) / 10.
 * The dimensional portal stands at (22, 0) here — the mirror of its 2D
 * position beside the fountain at (2620, 1500).
 *
 * ctx: { voterUser(req), readJsonBody(req), getCents(user)->int,
 *        getFx(user)->fxId|'', getHue(user)->number|null,
 *        FONT_LINKS, GALAXY_CSS, SIDEBAR_HTML, STAR_CANVAS, NOTIF_JS }
 */
const fs = require('fs');
const path = require('path');

const STALE_MS = 7000;
const BOUND_X = 195;   // 2D x 450..4350
const BOUND_Z = 118;   // 2D y 320..2680
const WALK_CAP = 38;   // units/s sustained (2D on-foot cap is 372px/s)
const PORTAL_POS = { x: 22, z: 0 };
const SPAWN = { x: 0, z: 18 };

/* v543: enterable interiors live far east of the town in world-space
 * coords (x ~2000), so rendering and collision need no offset math.
 * zoneOf derives a player's zone from position alone: 'town', an
 * interior id, or null (the void — visible to nobody). movement is
 * only accepted inside the player's current zone; crossing zones
 * requires a warp ping while standing at a registered door pair.
 * the menu is server-side truth: prices never come from the client. */
const INTERIORS = {
  coffee: { minX: 1989, maxX: 2011, minZ: -9, maxZ: 9 },
  arcade: { minX: 2029, maxX: 2051, minZ: -9, maxZ: 9 },
  clothing: { minX: 2069, maxX: 2091, minZ: -9, maxZ: 9 },
  library: { minX: 2109, maxX: 2131, minZ: -9, maxZ: 9 },
  rec: { minX: 2149, maxX: 2171, minZ: -9, maxZ: 9 },
  apt: { minX: 2189, maxX: 2211, minZ: -9, maxZ: 9 },
};
const DOOR_PAIRS = [
  { town: { x: -28.6, z: -35.0 }, inside: { x: 2000, z: 5.5 } },
  { town: { x: -62, z: -42.8 }, inside: { x: 2040, z: 5.5 } },
  { town: { x: 43.4, z: -35.0 }, inside: { x: 2080, z: 5.5 } },
  { town: { x: 58, z: -44.8 }, inside: { x: 2120, z: 5.5 } },
  { town: { x: 62, z: 40.3 }, inside: { x: 2160, z: 5.5 } },
  { town: { x: -64, z: 38.3 }, inside: { x: 2200, z: 5.5 } },
];
/* star shards: 12 hidden collectibles. positions are server truth —
 * a pickup claim must be standing within 4.5u of the real spot.
 * each pays 5 cents, once, ever (tracked in the cos record). */
const SHARDS = {
  s1: { x: 6, z: -6 }, s2: { x: 105, z: 20 }, s3: { x: 0, z: -92 }, s4: { x: -120, z: 30 },
  s5: { x: -30, z: 95 }, s6: { x: -52, z: -30 }, s7: { x: 2008.5, z: 3 }, s8: { x: 2033, z: -7.5 },
  s9: { x: 2073, z: 6.5 }, s10: { x: 2113, z: -6 }, s11: { x: 2167, z: 5 }, s12: { x: 2206, z: -4 },
};
/* trivia: rec center terminal. answers never leave the server; the
 * client gets a qid + shuffled-free fixed choices. 3 paid correct
 * answers per chicago day, +10 cents each. */
const TRIVIA = [
  { q: 'what is the money in the 6ix world called?', a: ['six cents', 'moon coins', 'star bits'], c: 0 },
  { q: 'who runs the coffee shop?', a: ['vex', 'mira', 'sol'], c: 1 },
  { q: 'what stands at the center of the plaza?', a: ['a statue of six', 'the wishing well', 'a portal home'], c: 1 },
  { q: 'which tree blooms pink all over town?', a: ['oak', 'pine', 'sakura'], c: 2 },
  { q: 'what color is the moon over moonfall lake?', a: ['purple', 'green', 'orange'], c: 0 },
  { q: 'who watches the arcade?', a: ['noor', 'junie', 'vex'], c: 2 },
  { q: 'how many star shards are hidden in the world?', a: ['8', '12', '20'], c: 1 },
  { q: 'the gold crown in clothing co. costs…', a: ['60 cents', '600 cents', '6000 cents'], c: 1 },
];
function chicagoDay() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
/* cosmetics are server truth too: slots, ids, prices live here; the
 * client only mirrors names for display. free defaults: hat 'none',
 * hair 'crest', acc 'none', plus the account hue (free, 0..360). */
const COSMETICS = {
  cap_red: { slot: 'hat', price: 150, name: 'red cap' },
  cap_violet: { slot: 'hat', price: 150, name: 'violet cap' },
  crown: { slot: 'hat', price: 600, name: 'gold crown' },
  mohawk: { slot: 'hair', price: 200, name: 'mohawk' },
  shades: { slot: 'acc', price: 120, name: 'shades' },
};
function cosOf(ctx, u) {
  let c = null;
  try { c = ctx.getCos ? ctx.getCos(u) : null; } catch (e) { }
  const own = (c && Array.isArray(c.own)) ? c.own.slice() : [];
  const wear = { hat: 'none', hair: 'crest', acc: 'none' };
  if (c && c.wear) for (const k of ['hat', 'hair', 'acc']) if (typeof c.wear[k] === 'string') wear[k] = c.wear[k];
  let hue = null;
  try { hue = ctx.getHue(u); } catch (e) { }
  const shards = (c && Array.isArray(c.shards)) ? c.shards.slice() : [];
  const apt = { rug: 0, poster: 0 };
  if (c && c.apt) { if (Number.isInteger(c.apt.rug)) apt.rug = c.apt.rug; if (Number.isInteger(c.apt.poster)) apt.poster = c.apt.poster; }
  return { own, wear, hue, shards, apt };
}
const MENU = {
  espresso: { name: 'starlight espresso', price: 30 },
  mocha: { name: 'mocha', price: 40 },
  nebula: { name: 'nebula latte', price: 65 },
};
function zoneOf(x, z) {
  if (Math.abs(x) <= BOUND_X && Math.abs(z) <= BOUND_Z) return 'town';
  for (const id in INTERIORS) { const b = INTERIORS[id]; if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return id; }
  return null;
}

function clampN(v, a, b) { v = Number(v); if (!isFinite(v)) return a; return v < a ? a : (v > b ? b : v); }
function dist2(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; return Math.sqrt(dx * dx + dz * dz); }

function createWorld3D(ctx) {
  const CSS = fs.readFileSync(path.join(__dirname, 'world3d.css'), 'utf8');
  const CLIENT = fs.readFileSync(path.join(__dirname, 'client3d.js'), 'utf8');
  const MATH = fs.readFileSync(path.join(__dirname, 'math3d.js'), 'utf8');
  const THREE_MIN = fs.readFileSync(path.join(__dirname, 'vendor', 'three.module.min.js'), 'utf8');

  const P = new Map(); // user -> { x, z, ry, at, sid, win, clampStreak, fx, hue }

  function prune(now) {
    for (const [u, p] of P) if (now - p.at > STALE_MS) P.delete(u);
  }

  function roster(me) {
    const mp = P.get(me);
    const mz = mp ? (zoneOf(mp.x, mp.z) || 'town') : 'town';
    if (mz === 'apt') return []; // ur apartment is ur own instance
    const out = [];
    for (const [u, p] of P) {
      if (u === me) continue;
      if ((zoneOf(p.x, p.z) || 'town') !== mz) continue; // zones never see each other
      out.push({ u, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, ry: Math.round(p.ry * 100) / 100, fx: p.fx || '', hue: (typeof p.hue === 'number') ? p.hue : null, sit: p.sit ? 1 : 0, wear: p.wear || null, emote: (p.emote && Date.now() - (p.emoteAt || 0) < 2600) ? p.emote : null });
    }
    return out;
  }

  async function api(req, res, u) {
    if (!u.pathname.startsWith('/api/world3d/')) return false;
    const J = (o, code) => { res.writeHead(code || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); return true; };
    const meRaw = ctx.voterUser(req);
    if (!meRaw) { J({ ok: false, err: 'login first' }, 401); return true; }
    const me = String(meRaw).toLowerCase();
    const now = Date.now();
    prune(now);

    if (u.pathname === '/api/world3d/ping' && req.method === 'POST') {
      // first touch after a boot: wait (briefly) for the shared cents
      // store to finish loading so the HUD never flashes a wrong balance.
      // the load itself is triggered by ctx.storeReady(); this mirrors how
      // the 2d world's economy endpoints gate on the same check.
      if (ctx.storeReady) { for (let i = 0; i < 16 && !ctx.storeReady(); i++) await new Promise((r) => setTimeout(r, 150)); }
      let b = {};
      try { b = await ctx.readJsonBody(req) || {}; } catch (e) { b = {}; }
      let p = P.get(me);
      if (!p) {
        // one entry per account, keyed by name: a reconnect or second tab
        // reuses this same entry (new sid takes over) — never a duplicate.
        p = { x: SPAWN.x, z: SPAWN.z, ry: Math.PI, at: now, sid: '', win: null, clampStreak: 0, fx: '', hue: null, sit: 0 };
        P.set(me, p);
      }
      if (b.sid) {
        const sid = String(b.sid).slice(0, 40);
        if (!p.sid) p.sid = sid;
        // a stale tab holding an old sid cannot move the live entry
        if (sid !== p.sid && b.x != null) { J({ ok: false, err: 'session taken over', roster: roster(me) }); return true; }
        if (sid !== p.sid) p.sid = sid; // takeover only when not moving
      }
      if (b.sit != null) p.sit = b.sit ? 1 : 0;
      if (b.emote != null) { if (b.emote === 'wave' || b.emote === 'celebrate') { p.emote = b.emote; p.emoteAt = now; } else p.emote = null; }
      const prevAt = p.at;
      if (b.x != null || b.z != null) {
        let nx = b.x != null ? clampN(b.x, -2400, 2400) : p.x;
        let nz = b.z != null ? clampN(b.z, -2400, 2400) : p.z;
        const curZone = zoneOf(p.x, p.z) || 'town';
        let warped = false;
        if (b.warp === true) {
          for (const d of DOOR_PAIRS) {
            const crossA = dist2(p.x, p.z, d.town.x, d.town.z) < 3.5 && dist2(nx, nz, d.inside.x, d.inside.z) < 2.5;
            const crossB = dist2(p.x, p.z, d.inside.x, d.inside.z) < 3.5 && dist2(nx, nz, d.town.x, d.town.z) < 2.5;
            if (crossA || crossB) { warped = true; break; }
          }
        }
        if (warped) {
          p.x = nx; p.z = nz; p.win = null; p.clampStreak = 0;
        } else if (zoneOf(nx, nz) === curZone) {
          const dtS = Math.min(2, Math.max(0.15, (now - prevAt) / 1000));
          const dd = dist2(p.x, p.z, nx, nz), maxStep = 52 * dtS + 6;
          if (dd > maxStep) { nx = p.x + (nx - p.x) * maxStep / dd; nz = p.z + (nz - p.z) * maxStep / dd; }
          const stepD = dist2(p.x, p.z, nx, nz);
          if (dd > maxStep && !p.clampStreak) { p.win = { t: now, d: 0, x: nx, z: nz }; p.clampStreak = 1; }
          else {
            p.clampStreak = dd > maxStep ? 2 : 0;
            if (!p.win || now - p.win.t > 6000) { p.win = { t: now, d: 0, x: p.x, z: p.z }; }
            else {
              p.win.d += stepD;
              const wEl = (now - p.win.t) / 1000;
              if (wEl > 2 && p.win.d > WALK_CAP * wEl * 1.05 + WALK_CAP * 0.6) { nx = p.win.x; nz = p.win.z; p.win = { t: now, d: 0, x: nx, z: nz }; }
            }
          }
          p.x = nx; p.z = nz;
        }
        // else: cross-zone or void move without a valid door warp — refused, position unchanged
      }
      if (b.ry != null) p.ry = clampN(b.ry, -Math.PI * 4, Math.PI * 4);
      p.at = now;
      try { p.fx = ctx.getFx(me) || ''; } catch (e) { p.fx = ''; }
      try { p.hue = ctx.getHue(me); } catch (e) { p.hue = null; }
      p.wear = cosOf(ctx, me).wear;
      let bal = null;
      try { bal = ctx.getCents(me); } catch (e) { }
      J({ ok: true, me, bal, x: p.x, z: p.z, zone: zoneOf(p.x, p.z), portal: PORTAL_POS, roster: roster(me), cos: cosOf(ctx, me) });
      return true;
    }

    if (u.pathname === '/api/world3d/buy' && req.method === 'POST') {
      let b = {};
      try { b = await ctx.readJsonBody(req) || {}; } catch (e) { b = {}; }
      const item = MENU[String(b.item || '')];
      if (!item) { J({ ok: false, err: 'unknown item' }, 400); return true; }
      if (!ctx.spendCents) { J({ ok: false, err: 'shop unavailable' }, 501); return true; }
      if (ctx.storeReady) { for (let i = 0; i < 16 && !ctx.storeReady(); i++) await new Promise((r) => setTimeout(r, 150)); }
      const bal = await ctx.spendCents(me, item.price);
      if (bal < 0) { let cur = null; try { cur = ctx.getCents(me); } catch (e) { } J({ ok: false, err: 'not enough six cents', bal: cur }); return true; }
      J({ ok: true, item: String(b.item), name: item.name, price: item.price, bal });
      return true;
    }

    if (u.pathname === '/api/world3d/cos' && req.method === 'POST') {
      let b = {};
      try { b = await ctx.readJsonBody(req) || {}; } catch (e) { b = {}; }
      if (!ctx.cosBuy || !ctx.cosWear) { J({ ok: false, err: 'wardrobe unavailable' }, 501); return true; }
      if (ctx.storeReady) { for (let i = 0; i < 16 && !ctx.storeReady(); i++) await new Promise((r) => setTimeout(r, 150)); }
      if (b.action === 'buy') {
        const item = COSMETICS[String(b.id || '')];
        if (!item) { J({ ok: false, err: 'unknown item' }, 400); return true; }
        const r = await ctx.cosBuy(me, String(b.id), item.price);
        if (!r || r.err) { let cur = null; try { cur = ctx.getCents(me); } catch (e) { } J({ ok: false, err: (r && r.err) || 'buy failed', bal: cur }); return true; }
        J({ ok: true, bal: r.bal, cos: cosOf(ctx, me) });
        return true;
      }
      if (b.action === 'wear') {
        const slot = String(b.slot || '');
        if (!['hat', 'hair', 'acc', 'hue'].includes(slot)) { J({ ok: false, err: 'bad slot' }, 400); return true; }
        if (slot === 'hue') {
          const hv = Math.round(Number(b.id));
          if (!isFinite(hv) || hv < 0 || hv > 360) { J({ ok: false, err: 'bad hue' }, 400); return true; }
          const r = ctx.cosWear(me, 'hue', hv);
          if (!r || r.err) { J({ ok: false, err: (r && r.err) || 'wear failed' }); return true; }
          J({ ok: true, cos: cosOf(ctx, me) });
          return true;
        }
        const id = String(b.id || '');
        const free = id === 'none' || (slot === 'hair' && id === 'crest');
        if (!free && !(COSMETICS[id] && COSMETICS[id].slot === slot)) { J({ ok: false, err: 'unknown item for that slot' }, 400); return true; }
        if (!free && !cosOf(ctx, me).own.includes(id)) { J({ ok: false, err: 'u do not own that yet' }); return true; }
        const r = ctx.cosWear(me, slot, id);
        if (!r || r.err) { J({ ok: false, err: (r && r.err) || 'wear failed' }); return true; }
        J({ ok: true, cos: cosOf(ctx, me) });
        return true;
      }
      J({ ok: false, err: 'bad action' }, 400);
      return true;
    }

    if (u.pathname === '/api/world3d/shard' && req.method === 'POST') {
      let b = {};
      try { b = await ctx.readJsonBody(req) || {}; } catch (e) { b = {}; }
      const def = SHARDS[String(b.id || '')];
      if (!def) { J({ ok: false, err: 'unknown shard' }, 400); return true; }
      const p = P.get(me);
      if (!p || Math.hypot(p.x - def.x, p.z - def.z) > 4.5) { J({ ok: false, err: 'not close enough' }); return true; }
      const cos = cosOf(ctx, me);
      if (cos.shards.includes(String(b.id))) { J({ ok: false, err: 'already found', shards: cos.shards.length }); return true; }
      const shards = cos.shards.concat([String(b.id)]);
      if (ctx.cosPatch) ctx.cosPatch(me, { shards });
      if (ctx.awardCents) await ctx.awardCents(me, 5);
      let bal = null; try { bal = ctx.getCents(me); } catch (e) { }
      J({ ok: true, shards: shards.length, bal });
      return true;
    }

    if (u.pathname === '/api/world3d/trivia' && req.method === 'POST') {
      let b = {};
      try { b = await ctx.readJsonBody(req) || {}; } catch (e) { b = {}; }
      if (b.action === 'get') {
        const qid = Math.floor(Math.random() * TRIVIA.length);
        J({ ok: true, qid, q: TRIVIA[qid].q, choices: TRIVIA[qid].a });
        return true;
      }
      if (b.action === 'answer') {
        const t = TRIVIA[Number(b.qid)];
        if (!t) { J({ ok: false, err: 'bad question' }, 400); return true; }
        const day = chicagoDay();
        let rec = null;
        try { const c0 = ctx.getCos ? ctx.getCos(me) : null; rec = (c0 && c0.trivia && c0.trivia.day === day) ? c0.trivia : { day, n: 0, seen: [] }; } catch (e) { rec = { day, n: 0, seen: [] }; }
        if (!Array.isArray(rec.seen)) rec.seen = [];
        if (Number(b.choice) !== t.c) { J({ ok: true, correct: false, paid: 0, left: Math.max(0, 3 - rec.n) }); return true; }
        if (rec.seen.includes(Number(b.qid))) { J({ ok: true, correct: true, paid: 0, left: Math.max(0, 3 - rec.n), repeat: true }); return true; }
        if (rec.n >= 3) { J({ ok: true, correct: true, paid: 0, left: 0, capped: true }); return true; }
        rec = { day, n: rec.n + 1, seen: rec.seen.concat([Number(b.qid)]) };
        if (ctx.cosPatch) ctx.cosPatch(me, { trivia: rec });
        if (ctx.awardCents) await ctx.awardCents(me, 10);
        let bal = null; try { bal = ctx.getCents(me); } catch (e) { }
        J({ ok: true, correct: true, paid: 10, left: 3 - rec.n, bal });
        return true;
      }
      J({ ok: false, err: 'bad action' }, 400);
      return true;
    }

    if (u.pathname === '/api/world3d/apt' && req.method === 'POST') {
      let b = {};
      try { b = await ctx.readJsonBody(req) || {}; } catch (e) { b = {}; }
      const cur = cosOf(ctx, me).apt;
      const apt = { rug: cur.rug, poster: cur.poster };
      if (b.rug != null) { const v = Number(b.rug); if (!Number.isInteger(v) || v < 0 || v > 2) { J({ ok: false, err: 'bad rug' }, 400); return true; } apt.rug = v; }
      if (b.poster != null) { const v = Number(b.poster); if (!Number.isInteger(v) || v < 0 || v > 2) { J({ ok: false, err: 'bad poster' }, 400); return true; } apt.poster = v; }
      if (ctx.cosPatch) ctx.cosPatch(me, { apt });
      J({ ok: true, apt });
      return true;
    }

    if (u.pathname === '/api/world3d/leave' && req.method === 'POST') {
      P.delete(me);
      J({ ok: true });
      return true;
    }

    J({ ok: false, err: 'unknown' }, 404);
    return true;
  }

  function asset(pathname) {
    if (pathname === '/world3d/world3d.css') return { type: 'text/css; charset=utf-8', body: CSS };
    if (pathname === '/world3d/client3d.js') return { type: 'text/javascript; charset=utf-8', body: CLIENT };
    if (pathname === '/world3d/math3d.js') return { type: 'text/javascript; charset=utf-8', body: MATH };
    if (pathname === '/world3d/vendor/three.module.min.js') return { type: 'text/javascript; charset=utf-8', body: THREE_MIN };
    return null;
  }

  function page() {
    // CRITICAL CSS is inlined so the loading screen is fully styled on
    // first paint — before the external stylesheet or any JS arrives.
    // Players must never see unstyled HTML or raw code while loading.
    const CRIT = '<style>' +
      'html,body{height:100%}body{margin:0;overflow:hidden;background:#070313}' +
      '#w3wrap{position:fixed;inset:0;visibility:hidden}#w3wrap.ready{visibility:visible}' +
      '#w3cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}' +
      '#w3load{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 38%,rgba(59,20,112,.5),rgba(5,2,16,.97) 78%);transition:opacity .5s ease;font-family:Inter,system-ui,sans-serif}' +
      '#w3load.hide{opacity:0;pointer-events:none}#w3load.show{opacity:1;pointer-events:auto}' +
      '.w3load-card{width:min(88vw,400px);text-align:center;padding:30px 24px;border-radius:22px;background:rgba(18,10,42,.85);border:1px solid rgba(167,139,250,.35);box-shadow:0 0 70px rgba(124,58,237,.35)}' +
      '.w3ring{width:96px;height:96px;margin:0 auto 18px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 38%,#67e8f9 55%,#a78bfa 72%,transparent 88%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 11px),#000 calc(100% - 10px));mask:radial-gradient(farthest-side,transparent calc(100% - 11px),#000 calc(100% - 10px));animation:w3spin 1.5s linear infinite;position:relative}' +
      '.w3ring i{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-style:normal;color:#ffd257;font-size:30px;animation:w3pulse2 1.8s ease-in-out infinite;text-shadow:0 0 18px rgba(255,210,87,.8)}' +
      '@keyframes w3spin{to{transform:rotate(360deg)}}@keyframes w3pulse2{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}' +
      '.w3load-t{font-weight:800;font-size:18px;color:#f3efff;margin-bottom:4px;letter-spacing:.02em}' +
      '.w3load-sub{font-weight:600;font-size:11px;color:rgba(167,139,250,.85);letter-spacing:.28em;text-transform:uppercase;margin-bottom:18px}' +
      '.w3bar{height:8px;border-radius:99px;background:rgba(243,239,255,.12);overflow:hidden;margin-bottom:10px}' +
      '.w3bar i{display:block;height:100%;width:4%;border-radius:99px;background:linear-gradient(90deg,#67e8f9,#a78bfa);transition:width .35s ease}' +
      '#w3loadmsg{font-weight:600;font-size:12.5px;color:rgba(243,239,255,.72);min-height:16px}' +
      '#w3loadpct{font-weight:700;font-size:11px;color:rgba(103,232,249,.9);margin-top:5px}' +
      '#w3loaderr{margin-top:14px;font-weight:600;font-size:13px;color:#fda4af;line-height:1.45}' +
      '.w3load-btns{margin-top:16px;display:flex;gap:10px;justify-content:center}' +
      '#w3retry{font-weight:800;font-size:13px;color:#0b0620;background:linear-gradient(135deg,#67e8f9,#a78bfa);border:0;border-radius:999px;padding:10px 18px;cursor:pointer}' +
      '.w3back{font-weight:700;font-size:13px;color:#f3efff;text-decoration:none;border:1px solid rgba(167,139,250,.5);border-radius:999px;padding:10px 16px}' +
      '</style>';
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n' +
      '<title>the third dimension — six\'s network</title>\n<link rel="icon" href="/icon-192.png">\n' + ctx.FONT_LINKS +
      '\n<style>' + ctx.GALAXY_CSS + '</style>\n' + CRIT + '\n<link rel="stylesheet" href="/world3d/world3d.css">\n' +
      '<script type="importmap">{"imports":{"three":"/world3d/vendor/three.module.min.js"}}</script>\n</head>\n<body>\n' +
      ctx.STAR_CANVAS + '\n' + ctx.SIDEBAR_HTML + '\n' +
      '<div id="w3wrap">\n<canvas id="w3cv"></canvas>\n' +
      '<div id="w3hud">\n' +
      '  <div class="w3left"><div class="w3brand"><span class="w3star">✦</span> the third dimension</div><div class="w3chips"><span id="w3bal" class="w3chip gold">¢ — six cents</span><span id="w3who" class="w3chip"></span><span id="w3conn" class="w3chip warn" hidden>reconnecting…</span></div></div>\n' +
      '  <div class="w3btns"><span id="w3count" class="w3chip">1 here</span><button id="w3setbtn" type="button" title="settings" aria-label="settings"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg></button><a class="w3leave" href="/world" title="back to the 2d world">✕</a></div>\n' +
      '</div>\n' +
      '<div id="w3set" hidden>\n' +
      '  <div class="w3set-t">settings <button id="w3setclose" type="button" aria-label="close">✕</button></div>\n' +
      '  <label>camera sensitivity <input id="w3sens" type="range" min="0.4" max="2.2" step="0.05"></label>\n' +
      '  <label>camera distance <input id="w3camd" type="range" min="8" max="22" step="0.5"></label>\n' +
      '  <label>camera height <input id="w3camh" type="range" min="0.9" max="2.6" step="0.1"></label>\n' +
      '  <label>graphics <select id="w3gfxsel"><option value="auto">auto</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>\n' +
      '  <label>camera <select id="w3viewsel"><option value="fp">first person</option><option value="tp">third person</option></select></label>\n' +
      '  <label>field of view <input id="w3fov" type="range" min="60" max="90" step="1"></label>\n' +
      '  <label class="w3chk">head bob <input id="w3bob" type="checkbox"></label>\n' +
      '  <label class="w3chk">shadows <input id="w3shadow" type="checkbox"></label>\n' +
      '  <label class="w3chk">ambient sound <input id="w3snd" type="checkbox"></label>\n' +
      '  <label>sound volume <input id="w3vol" type="range" min="0" max="1" step="0.05"></label>\n' +
      '  <div class="w3how">wasd move · mouse camera (click the world to lock) · space jump · shift sprint<br>on touch: left stick moves, drag right side for camera</div>\n' +
      '</div>\n' +
      '<div id="w3toast" hidden></div>\n' +
      '<div id="w3prompt" hidden></div>\n' +
      '<button id="w3use" class="touchui" type="button" hidden>interact</button>\n' +
      '<div id="w3dlg" hidden><div id="w3dlgname"></div><div id="w3dlgtext"></div><button id="w3dlgnext" type="button">next</button></div>\n' +
      '<div id="w3menu" hidden><div class="w3menu-card"><div class="w3menu-t">the coffee shop <span>menu</span><button id="w3menuclose" type="button" aria-label="close">✕</button></div><div id="w3menulist"></div><div id="w3menubal"></div><div id="w3menures"></div></div></div>\n' +
      '<div id="w3ward" hidden><div class="w3menu-card w3ward-card"><div class="w3menu-t">clothing co. <span>wardrobe</span><button id="w3wardclose" type="button" aria-label="close">✕</button></div>' +
      '<div class="w3ward-sec">body color <span id="w3hueval"></span></div><input id="w3hue" type="range" min="0" max="360" step="1">' +
      '<div class="w3ward-sec">hat</div><div id="w3ward_hat" class="w3chips"></div>' +
      '<div class="w3ward-sec">hair</div><div id="w3ward_hair" class="w3chips"></div>' +
      '<div class="w3ward-sec">face</div><div id="w3ward_acc" class="w3chips"></div>' +
      '<div id="w3wardres"></div><div class="w3ward-btns"><button id="w3wardsave" type="button">save fit</button><button id="w3wardcancel" type="button">cancel</button></div></div></div>\n' +
      '<div id="w3games" hidden><div class="w3menu-card"><div class="w3menu-t">the arcade <span>pick a game</span><button id="w3gamesclose" type="button" aria-label="close">✕</button></div>' +
      '<div class="w3game-list"><a class="w3game" href="/g/2048">2048<span>our own build of the classic</span></a><a class="w3game" href="/g/cookie">cookie clicker<span>our own clone — infinite cookies</span></a><a class="w3game" href="/games">the full games page<span>8,000+ games thru the network</span></a></div>' +
      '<div class="w3games-note">these run on the site itself — the cabinet just points u there</div></div></div>\n' +
      '<div id="w3fade"></div>\n' +
      '<button id="w3act" type="button" hidden>RETURN TO THE 2D WORLD</button>\n' +
      '<div id="w3conflict" hidden>\n' +
      '  <div class="w3conf-card">\n' +
      '    <div class="w3conf-title">this world moved to another tab</div>\n' +
      '    <p>ur account opened the third dimension somewhere else, so this tab is frozen. no movement is being sent from here, and nothing here can move ur character over there.</p>\n' +
      '    <div class="w3conf-btns"><button id="w3reclaim" type="button" class="w3btn-go">use this tab instead</button><button id="w3confback" type="button" class="w3btn-ghost">back to the 2d world</button></div>\n' +
      '  </div>\n' +
      '</div>\n' +
      '<div id="w3joyzone" class="touchui"><div id="w3joy"><div id="w3knob"></div></div></div>\n' +
      '<div class="w3rbtns touchui"><button id="w3sprint" type="button">sprint</button><button id="w3jump" type="button">jump</button></div>\n' +
      '<button id="w3wavebtn" type="button" aria-label="wave"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 11.5V6a1.5 1.5 0 0 1 3 0V5a1.5 1.5 0 0 1 3 0v-1a1.5 1.5 0 0 1 3 0v5"/><path d="M16 5.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7h-1c-2.5 0-4-1-5.2-3.2L3.6 13c-.5-1 .8-2 1.7-1.4L7 12"/></svg></button>\n' +
      '<button id="w3partybtn" type="button" aria-label="celebrate"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 14.3 9l6.9.3-5.4 4.4 1.9 6.7L12 16.6l-5.7 3.8 1.9-6.7L2.8 9.3 9.7 9z"/></svg></button>\n' +
      '<button id="w3mapbtn" type="button" aria-label="world map"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14"/></svg></button>\n' +
      '<div id="w3quiz" hidden><div class="w3menu-card"><div class="w3menu-t">rec center <span>trivia terminal</span><button id="w3quizclose" type="button" aria-label="close">✕</button></div><div id="w3quizq"></div><div id="w3quizchoices"></div><div id="w3quizres"></div></div></div>\n' +
      '<div id="w3map" hidden><div class="w3menu-card w3map-card"><div class="w3menu-t">moonfall town <span>world map</span><button id="w3mapclose" type="button" aria-label="close">✕</button></div><canvas id="w3mapcv" width="520" height="340"></canvas><div id="w3mapseen"></div></div></div>\n' +
      '</div>\n' +
      '<div id="w3load">\n  <div class="w3load-card">\n' +
      '    <div class="w3ring"><i>✦</i></div>\n' +
      '    <div class="w3load-t">the third dimension</div>\n' +
      '    <div class="w3load-sub">6ixnetworks</div>\n' +
      '    <div class="w3bar"><i id="w3barfill"></i></div>\n' +
      '    <div id="w3loadmsg">warming up the portal…</div>\n' +
      '    <div id="w3loadpct">0%</div>\n' +
      '    <div id="w3loaderr" hidden></div>\n' +
      '    <div class="w3load-btns" id="w3loadbtns" hidden><button id="w3retry" type="button">retry</button><a href="/world" class="w3back">back to the 2d world</a></div>\n' +
      '  </div>\n</div>\n' +
      '<script>window.__w3fail=function(msg){if(window.__w3booted)return;var e=document.getElementById("w3loaderr");var b=document.getElementById("w3loadbtns");var m=document.getElementById("w3loadmsg");if(e){e.hidden=false;e.textContent=msg;}if(b)b.hidden=false;if(m)m.textContent="load failed";};' +
      'window.addEventListener("error",function(ev){if(!window.__w3booted&&ev&&ev.message)window.__w3fail("something failed while loading: "+ev.message);},true);' +
      'window.__w3watchdog=setTimeout(function(){if(!window.__w3booted)window.__w3fail("the 3d engine did not start — ur browser may not support WebGL, or the engine file failed to load.");},16000);' +
      'document.getElementById("w3retry").addEventListener("click",function(){location.reload();});</script>\n' +
      '<script type="module" src="/world3d/client3d.js"></script>\n' +
      // NOTIF_JS is a RAW js string — every other page wraps it in a
      // <script> tag (see world.js). v539 shipped it bare, which dumped
      // the notification source as visible page text behind the loader:
      // the literal 'raw code on screen' bug. wrapped now.
      '<script>' + ctx.NOTIF_JS + '</script>\n</body>\n</html>';
  }

  return { api, page, asset, _presence: P };
}

module.exports = { createWorld3D, PORTAL_POS, SPAWN, BOUND_X, BOUND_Z };
