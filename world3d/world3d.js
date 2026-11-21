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

function clampN(v, a, b) { v = Number(v); if (!isFinite(v)) return a; return v < a ? a : (v > b ? b : v); }
function dist2(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; return Math.sqrt(dx * dx + dz * dz); }

function createWorld3D(ctx) {
  const CSS = fs.readFileSync(path.join(__dirname, 'world3d.css'), 'utf8');
  const CLIENT = fs.readFileSync(path.join(__dirname, 'client3d.js'), 'utf8');
  const THREE_MIN = fs.readFileSync(path.join(__dirname, 'vendor', 'three.module.min.js'), 'utf8');

  const P = new Map(); // user -> { x, z, ry, at, sid, win, clampStreak, fx, hue }

  function prune(now) {
    for (const [u, p] of P) if (now - p.at > STALE_MS) P.delete(u);
  }

  function roster(me) {
    const out = [];
    for (const [u, p] of P) {
      if (u === me) continue;
      out.push({ u, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, ry: Math.round(p.ry * 100) / 100, fx: p.fx || '', hue: (typeof p.hue === 'number') ? p.hue : null });
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
        p = { x: SPAWN.x, z: SPAWN.z, ry: Math.PI, at: now, sid: '', win: null, clampStreak: 0, fx: '', hue: null };
        P.set(me, p);
      }
      if (b.sid) {
        const sid = String(b.sid).slice(0, 40);
        if (!p.sid) p.sid = sid;
        // a stale tab holding an old sid cannot move the live entry
        if (sid !== p.sid && b.x != null) { J({ ok: false, err: 'session taken over', roster: roster(me) }); return true; }
        if (sid !== p.sid) p.sid = sid; // takeover only when not moving
      }
      const prevAt = p.at;
      if (b.x != null || b.z != null) {
        let nx = b.x != null ? clampN(b.x, -BOUND_X, BOUND_X) : p.x;
        let nz = b.z != null ? clampN(b.z, -BOUND_Z, BOUND_Z) : p.z;
        const dtS = Math.min(2, Math.max(0.15, (now - prevAt) / 1000));
        const dd = dist2(p.x, p.z, nx, nz), maxStep = 52 * dtS + 6;
        if (dd > maxStep) { nx = p.x + (nx - p.x) * maxStep / dd; nz = p.z + (nz - p.z) * maxStep / dd; }
        // sustained-speed window, same shape as the 2D handler: legit
        // walkers at cap never trip it, teleport scripts get re-anchored.
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
      if (b.ry != null) p.ry = clampN(b.ry, -Math.PI * 4, Math.PI * 4);
      p.at = now;
      try { p.fx = ctx.getFx(me) || ''; } catch (e) { p.fx = ''; }
      try { p.hue = ctx.getHue(me); } catch (e) { p.hue = null; }
      let bal = null;
      try { bal = ctx.getCents(me); } catch (e) { }
      J({ ok: true, me, bal, x: p.x, z: p.z, portal: PORTAL_POS, roster: roster(me) });
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
    if (pathname === '/world3d/vendor/three.module.min.js') return { type: 'text/javascript; charset=utf-8', body: THREE_MIN };
    return null;
  }

  function page() {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n' +
      '<title>the third dimension — six\'s network</title>\n<link rel="icon" href="/icon-192.png">\n' + ctx.FONT_LINKS +
      '\n<style>' + ctx.GALAXY_CSS + '</style>\n<link rel="stylesheet" href="/world3d/world3d.css">\n' +
      '<script type="importmap">{"imports":{"three":"/world3d/vendor/three.module.min.js"}}</script>\n</head>\n<body>\n' +
      ctx.STAR_CANVAS + '\n' + ctx.SIDEBAR_HTML + '\n' +
      '<div id="w3wrap">\n<canvas id="w3cv"></canvas>\n' +
      '<div id="w3hud">\n' +
      '  <div class="w3left"><div class="w3brand"><span class="w3star">✦</span> the third dimension</div><div id="w3bal">¢ — six cents</div><div id="w3who"></div></div>\n' +
      '  <div class="w3btns"><button id="w3gfx" type="button" title="graphics quality">gfx: auto</button><a class="w3leave" href="/world" title="back to the 2d world">✕</a></div>\n' +
      '</div>\n' +
      '<div id="w3toast" hidden></div>\n' +
      '<button id="w3act" type="button" hidden>RETURN TO THE 2D WORLD</button>\n' +
      '<div id="w3joy"><div id="w3knob"></div></div>\n' +
      '<button id="w3jump" type="button">jump</button>\n' +
      '<div id="w3load">\n  <div class="w3load-card">\n' +
      '    <div class="w3load-t">✦ entering the third dimension</div>\n' +
      '    <div class="w3bar"><i id="w3barfill"></i></div>\n' +
      '    <div id="w3loadmsg">loading three.js…</div>\n' +
      '    <div id="w3loaderr" hidden></div>\n' +
      '    <div class="w3load-btns" id="w3loadbtns" hidden><button id="w3retry" type="button">retry</button><a href="/world" class="w3back">back to the 2d world</a></div>\n' +
      '  </div>\n</div>\n' +
      '</div>\n' +
      '<script>window.__w3watchdog=setTimeout(function(){if(!window.__w3booted){var e=document.getElementById("w3loaderr");var b=document.getElementById("w3loadbtns");var m=document.getElementById("w3loadmsg");if(e){e.hidden=false;e.textContent="the 3d engine did not start — ur browser may not support WebGL, or the engine file failed to load.";}if(b)b.hidden=false;if(m)m.textContent="load failed";}},14000);' +
      'document.getElementById("w3retry").addEventListener("click",function(){location.reload();});</script>\n' +
      '<script type="module" src="/world3d/client3d.js"></script>\n' +
      ctx.NOTIF_JS + '\n</body>\n</html>';
  }

  return { api, page, asset, _presence: P };
}

module.exports = { createWorld3D, PORTAL_POS, SPAWN, BOUND_X, BOUND_Z };
