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
  const MATH = fs.readFileSync(path.join(__dirname, 'math3d.js'), 'utf8');
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
      '  <label class="w3chk">shadows <input id="w3shadow" type="checkbox"></label>\n' +
      '  <label class="w3chk">ambient sound <input id="w3snd" type="checkbox"></label>\n' +
      '  <label>sound volume <input id="w3vol" type="range" min="0" max="1" step="0.05"></label>\n' +
      '  <div class="w3how">wasd move · mouse camera (click the world to lock) · space jump · shift sprint<br>on touch: left stick moves, drag right side for camera</div>\n' +
      '</div>\n' +
      '<div id="w3toast" hidden></div>\n' +
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
