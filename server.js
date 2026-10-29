// web-proxy server — zero dependencies, Node 18+ (built-in fetch)
// Run: node server.js   (uses PORT env or 8080)

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;

// ---------- helpers ----------
function b64urlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}
function proxied(absUrl) {
  return '/browse/' + b64urlEncode(absUrl);
}
// ---------- browser identity + cookie handling ----------
// Present as one consistent, ordinary desktop Chrome browser (same UA +
// client hints + fetch headers every time), and persist each site's cookies
// by translating them onto the proxy's own domain, namespaced per host.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
function hostKey(hostname) { return 'px_' + hostname.replace(/[^a-zA-Z0-9]/g, '_') + '_'; }
function buildUpstreamCookies(cookieHeader, hostname) {
  if (!cookieHeader) return '';
  const prefix = hostKey(hostname);
  const out = [];
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('='); if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.startsWith(prefix)) out.push(name.slice(prefix.length) + '=' + part.slice(eq + 1).trim());
  }
  return out.join('; ');
}
function translateSetCookie(setCookieStr, hostname) {
  const prefix = hostKey(hostname);
  const segments = setCookieStr.split(';').map(s => s.trim());
  const first = segments[0];
  const eq = first.indexOf('='); if (eq < 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1);
  let out = prefix + name + '=' + value + '; Path=/';
  for (const attr of segments.slice(1)) {
    if (/^(max-age|expires)=/i.test(attr)) out += '; ' + attr;
  }
  return out + '; HttpOnly; SameSite=Lax';
}
function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h === '::1') return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}
function resolveAndProxy(rawValue, baseUrl) {
  const v = (rawValue || '').trim();
  if (!v || v.startsWith('#') || /^(data|javascript|mailto|tel|blob|about):/i.test(v)) return rawValue;
  try {
    const abs = new URL(v, baseUrl).toString();
    return proxied(abs);
  } catch { return rawValue; }
}
function rewriteSrcset(value, baseUrl) {
  return value.split(',').map(part => {
    const seg = part.trim();
    if (!seg) return seg;
    const bits = seg.split(/\s+/);
    bits[0] = resolveAndProxy(bits[0], baseUrl);
    return bits.join(' ');
  }).join(', ');
}
function rewriteHtml(html, baseUrl) {
  // v3: ONE pass over the document (was 4-5 passes). On Cloudflare's free
  // plan only 10ms of CPU is allowed per request, so scan count matters.
  const pattern = /<base[^>]*>|\b(href|src|action|poster|cite|background|data-src|data-href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))|url\(\s*(['"]?)([^'")]+)\5\s*\)/gi;
  return html.replace(pattern, (m, attr, dq, sq, uq, urlQuote, urlVal) => {
    if (urlVal !== undefined) {
      const q = urlQuote || '';
      return `url(${q}${resolveAndProxy(urlVal, baseUrl)}${q})`;
    }
    if (attr === undefined) return ''; // <base ...> tag: drop it
    const val = dq !== undefined ? dq : (sq !== undefined ? sq : uq);
    const quote = dq !== undefined ? '"' : (sq !== undefined ? "'" : '');
    const rewritten = attr.toLowerCase() === 'srcset' ? rewriteSrcset(val, baseUrl) : resolveAndProxy(val, baseUrl);
    return `${attr}=${quote}${rewritten}${quote}`;
  });
}
function rewriteCss(css, baseUrl) {
  let out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (m, q, u) => `url(${q}${resolveAndProxy(u.trim(), baseUrl)}${q})`);
  out = out.replace(/@import\s+(["'])([^"']+)\1/gi,
    (m, q, u) => `@import ${q}${resolveAndProxy(u, baseUrl)}${q}`);
  return out;
}


// ---------- tab cloak ----------
// One click makes this tab look like Google / Classroom / Docs (title +
// favicon), or opens the whole page inside an about:blank tab whose tab
// itself says Google — the classic cloak.
const CLOAK_JS = `
function cloakTab(kind){
  var presets={
    google:{t:'Google',i:'https://www.google.com/favicon.ico'},
    classroom:{t:'Google Classroom',i:'https://ssl.gstatic.com/classroom/favicon.png'},
    docs:{t:'Google Docs',i:'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico'},
    drive:{t:'My Drive - Google Drive',i:'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png'}
  };
  var p=presets[kind]||presets.google;
  document.title=p.t;
  var l=document.querySelector("link[rel~='icon']")||document.createElement('link');
  l.rel='icon'; l.href=p.i; document.head.appendChild(l);
}
function cloakOpen(){
  var w=window.open('about:blank','_blank');
  if(!w){ alert('popups are blocked — allow popups, then hit it again'); return; }
  w.document.write('<!DOCTYPE html><html><head><title>Google</title><link rel="icon" href="https://www.google.com/favicon.ico"></head><body style="margin:0"><iframe src="'+location.href+'" style="border:0;width:100vw;height:100vh"></iframe></body></html>');
  w.document.close();
}`;
const CLOAK_BAR = `<div style="margin-top:26px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;color:#9a9a9a;font-size:13px">tab cloak:
<button onclick="cloakTab('google')" style="background:#171717;color:#ddd;border:1px solid #2c2c2c;border-radius:999px;padding:7px 13px;cursor:pointer">Google</button>
<button onclick="cloakTab('classroom')" style="background:#171717;color:#ddd;border:1px solid #2c2c2c;border-radius:999px;padding:7px 13px;cursor:pointer">Classroom</button>
<button onclick="cloakTab('docs')" style="background:#171717;color:#ddd;border:1px solid #2c2c2c;border-radius:999px;padding:7px 13px;cursor:pointer">Docs</button>
<button onclick="cloakOpen()" style="background:#171717;color:#ddd;border:1px solid #2c2c2c;border-radius:999px;padding:7px 13px;cursor:pointer">open in cloaked tab</button></div>`;

// ---------- YouTube network ----------
// youtube.com's own player refuses every cloud/datacenter IP at the
// playability check, and the surviving public Invidious instances bot-wall
// their /watch pages when fetched from a server — but Invidious SEARCH works
// through the proxy, and the Piped network (a whole federated YouTube
// frontend) still plays. So: search here, mirror playback to Piped.
const PIPED_BASE = 'https://piped.video';
const INVIDIOUS_INSTANCES = [
  'https://invidious.tiekoetter.com',
  'https://inv.nadeko.net',
  'https://yt.chocolatemoo53.com',
];
const INVIDIOUS_HOSTS = INVIDIOUS_INSTANCES.map(u => new URL(u).hostname).concat(['invidious.nerdvpn.de']);
function youtubeMirror(target) {
  const h = target.hostname.toLowerCase();
  if (h === 'youtu.be') {
    const id = target.pathname.slice(1).split('/')[0];
    return id ? PIPED_BASE + '/watch?v=' + encodeURIComponent(id) : PIPED_BASE;
  }
  if (/(^|\.)youtube\.com$/.test(h) || h === 'www.youtube-nocookie.com') {
    const v = target.searchParams.get('v');
    if (target.pathname === '/watch' && v) return PIPED_BASE + '/watch?v=' + encodeURIComponent(v);
    if (target.pathname.startsWith('/shorts/') || target.pathname.startsWith('/embed/') || target.pathname.startsWith('/live/')) {
      const id = target.pathname.split('/')[2];
      if (id) return PIPED_BASE + '/watch?v=' + encodeURIComponent(id);
    }
    if (target.pathname === '/results') {
      const q = target.searchParams.get('search_query');
      if (q) return PIPED_BASE + '/search?q=' + encodeURIComponent(q);
    }
    if (target.pathname.startsWith('/channel/') || target.pathname.startsWith('/@')) return PIPED_BASE + target.pathname;
    return PIPED_BASE;
  }
  if (INVIDIOUS_HOSTS.includes(h) && target.pathname === '/watch') {
    const v = target.searchParams.get('v');
    if (v) return PIPED_BASE + '/watch?v=' + encodeURIComponent(v);
  }
  return null;
}
const YT_HOME = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks — YouTube</title>
<style>
*{box-sizing:border-box;margin:0}body{background:#0a0a0a;color:#f2f2f2;font-family:system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:48px 16px}
h1{font-size:32px;margin-bottom:6px}h1 span{color:#e11d2e}p.sub{color:#9a9a9a;margin-bottom:28px;font-size:14px;text-align:center;max-width:560px}
form{display:flex;width:100%;max-width:640px;gap:8px}input{flex:1;background:#171717;border:1px solid #2c2c2c;border-radius:10px;color:#fff;padding:14px 16px;font-size:16px;outline:none}
input:focus{border-color:#e11d2e}button{background:#e11d2e;color:#fff;border:0;border-radius:10px;padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer}
.links{margin-top:30px;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:640px}
.links a{color:#ddd;text-decoration:none;background:#171717;border:1px solid #2c2c2c;padding:9px 14px;border-radius:999px;font-size:14px}
footer{margin-top:auto;padding-top:40px;color:#666;font-size:12px;text-align:center;max-width:640px}
</style></head><body>
<h1>6ix<span>Networks</span> — YouTube mode</h1>
<p class="sub">search runs through 6ixNetworks. videos open on the Piped network — youtube's own player blocks every cloud proxy IP on earth right now, Piped is the workaround that actually plays.</p>
<form action="/yt/search" method="get"><input name="q" type="text" placeholder="search youtube" autocomplete="off" autofocus><button type="submit">Search</button></form>
<div class="links">
<a href="https://piped.video">open Piped directly</a>
<a href="/">← back to 6ixNetworks</a>
</div>
${CLOAK_BAR}<script src="/cloak.js"></script>
<footer>paste any youtube link into the main 6ixNetworks bar and it auto-mirrors to Piped too — watch links, shorts, youtu.be, all of it.</footer>
</body></html>`;
function isStaticAsset(target, ct) {
  if (ct) {
    if (/^(image|font)\//i.test(ct)) return true;
    if (/text\/css|javascript|ecmascript/i.test(ct)) return true;
  }
  return /\.(?:png|jpe?g|gif|webp|svg|ico|avif|css|mjs|js|woff2?|ttf|otf)$/i.test(target.pathname);
}


// ---------- games network (/gs) ----------
// The catalog is pulled live from the GameMonetize publisher feed
// (1,000+ embeddable HTML5 games, built for iframing) and cached for an
// hour. Games launch in /play inside an iframe — through the proxy by
// default, with a one-tap direct mode for games whose code fights it.
const GM_FEED = 'https://gamemonetize.com/rssfeed.php?format=json&category=All&type=html5&amount=1000';
const FALLBACK_GAMES = [
  { t: 'Nutty Rush Kart', u: 'https://html5.gamemonetize.co/jo8widlpg0usj47eix91m74q1jzvon00/', img: 'https://img.gamemonetize.com/jo8widlpg0usj47eix91m74q1jzvon00/512x384.jpg', c: 'Racing', w: 800, h: 600 },
  { t: '2048', u: 'https://play2048.co/', img: '', c: 'Puzzles', w: 800, h: 600 },
  { t: 'Hextris', u: 'https://hextris.io/', img: '', c: 'Arcade', w: 800, h: 600 },
  { t: 'Little Alchemy 2', u: 'https://littlealchemy2.com/', img: '', c: 'Puzzles', w: 800, h: 600 },
  { t: 'Slow Roads', u: 'https://slowroads.io/', img: '', c: 'Racing', w: 800, h: 600 },
];
let gamesCache = { at: 0, list: null };
async function loadGames() {
  if (gamesCache.list && Date.now() - gamesCache.at < 3600e3) return gamesCache.list;
  let list = [];
  try {
    const r = await fetch(GM_FEED, { headers: { 'user-agent': BROWSER_UA, 'accept': 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      const seen = new Set();
      for (const g of (Array.isArray(j) ? j : [])) {
        if (!g || !g.title || !g.url || !/^https:\/\//.test(g.url)) continue;
        if (seen.has(g.url)) continue;
        seen.add(g.url);
        list.push({ t: String(g.title).slice(0, 80), u: g.url, img: g.thumb || '', c: g.category || 'Arcade', w: +g.width || 800, h: +g.height || 600 });
        if (list.length >= 600) break;
      }
    }
  } catch {}
  if (!list.length) list = FALLBACK_GAMES;
  gamesCache = { at: Date.now(), list };
  return list;
}
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function gamesPage(games) {
  const cats = [...new Set(games.map(g => g.c))].sort();
  const cards = games.map(g => {
    const thumb = g.img ? proxied(g.img) : '';
    return `<a class="card" href="/play?u=${encodeURIComponent(g.u)}&t=${encodeURIComponent(g.t)}" data-s="${escHtml((g.t + ' ' + g.c).toLowerCase())}" data-c="${escHtml(g.c)}">
      ${thumb ? `<img loading="lazy" src="${thumb}" alt="">` : '<div class="noimg">no preview</div>'}
      <div class="gt">${escHtml(g.t)}</div><div class="gc">${escHtml(g.c)}</div></a>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks — Games</title>
<style>
*{box-sizing:border-box;margin:0}body{background:#0a0a0a;color:#f2f2f2;font-family:system-ui,sans-serif;min-height:100vh;padding:34px 16px 48px}
.wrap{max-width:1100px;margin:0 auto}h1{font-size:30px}h1 span{color:#e11d2e}
.sub{color:#9a9a9a;margin:6px 0 20px;font-size:14px}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.bar input{flex:1;min-width:200px;background:#171717;border:1px solid #2c2c2c;border-radius:10px;color:#fff;padding:12px 14px;font-size:15px;outline:none}
.bar select{background:#171717;border:1px solid #2c2c2c;border-radius:10px;color:#fff;padding:12px;font-size:15px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.card{background:#141414;border:1px solid #262626;border-radius:12px;overflow:hidden;text-decoration:none;color:#eee;display:block}
.card:hover{border-color:#e11d2e}.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#1d1d1d}
.noimg{width:100%;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;color:#555;background:#1d1d1d;font-size:12px}
.gt{padding:9px 10px 2px;font-size:14px;font-weight:600}.gc{padding:0 10px 10px;font-size:12px;color:#8a8a8a}
.foot{margin-top:34px;color:#666;font-size:12px;text-align:center}
a.back{color:#e11d2e;text-decoration:none;font-size:14px}
</style></head><body><div class="wrap">
<a class="back" href="/">← 6ixNetworks</a>
<h1>6ix<span>Networks</span> games</h1>
<p class="sub">${games.length} games, pulled live from the games network — every one launches inside the site, through the proxy.</p>
<div class="bar"><input id="gq" type="text" placeholder="search games..." autocomplete="off">
<select id="gc"><option value="">all categories</option>${cats.map(c => `<option>${escHtml(c)}</option>`).join('')}</select></div>
<div class="grid" id="grid">${cards}</div>
${CLOAK_BAR}
<div class="foot">a game stuck on a black screen? open it and hit <b>direct</b> — some games' code fights the proxy, direct mode iframes the original instead.</div>
</div>
<script src="/cloak.js"></script>
<script>
var gq=document.getElementById('gq'), gc=document.getElementById('gc');
function filt(){ var q=gq.value.toLowerCase(), c=gc.value;
  document.querySelectorAll('.card').forEach(function(el){
    el.style.display = ((!q || el.dataset.s.includes(q)) && (!c || el.dataset.c===c)) ? '' : 'none';
  });
}
gq.addEventListener('input', filt); gc.addEventListener('change', filt);
</script>
</body>
</html>`;
}
function playPage(u, t) {
  if (!/^https:\/\//i.test(u || '')) {
    return '<!DOCTYPE html><body style="background:#0a0a0a;color:#f2f2f2;font-family:system-ui;padding:40px">bad game link — <a style="color:#e11d2e" href="/gs">back to games</a></body>';
  }
  const prox = proxied(u);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(t || 'Game')}</title>
<style>
*{box-sizing:border-box;margin:0}body{background:#000;color:#f2f2f2;font-family:system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}
.top{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#0d0d0d;border-bottom:1px solid #222;flex-wrap:wrap}
.top .title{font-weight:700;margin-right:auto;font-size:15px}
.top a,.top button{background:#171717;color:#ddd;border:1px solid #2c2c2c;border-radius:8px;padding:7px 12px;cursor:pointer;text-decoration:none;font-size:13px}
.top button.on{border-color:#e11d2e;color:#fff}
iframe{flex:1;width:100%;border:0;background:#000}
</style></head><body>
<div class="top"><a href="/gs">← games</a><span class="title">${escHtml(t || 'Game')}</span>
<button id="bNet" class="on" onclick="setMode('net')">thru network</button>
<button id="bDir" onclick="setMode('dir')">direct</button>
<button onclick="document.getElementById('gf').requestFullscreen()">fullscreen</button>
<button onclick="cloakTab('google')">cloak: google</button>
<button onclick="cloakOpen()">cloaked tab</button></div>
<iframe id="gf" src="${prox}" allowfullscreen allow="autoplay; fullscreen; gamepad; keyboard-lock"></iframe>
<script src="/cloak.js"></script>
<script>
var PROX=${JSON.stringify(prox)}, DIRECT=${JSON.stringify(u)};
function setMode(m){
  document.getElementById('gf').src = (m==='net' ? PROX : DIRECT);
  document.getElementById('bNet').classList.toggle('on', m==='net');
  document.getElementById('bDir').classList.toggle('on', m==='dir');
}
</script>
</body>
</html>`;
}

// ---------- homepage ----------
const HOME = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>6ixNetworks</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { background:#0a0a0a; color:#f2f2f2; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         min-height:100vh; display:flex; flex-direction:column; align-items:center; padding: 48px 16px; }
  h1 { font-size: 34px; letter-spacing:.5px; margin-bottom: 6px; }
  h1 span { color:#e11d2e; }
  p.sub { color:#9a9a9a; margin-bottom: 28px; font-size:14px; }
  form { display:flex; width:100%; max-width:640px; gap:8px; }
  input { flex:1; background:#171717; border:1px solid #2c2c2c; border-radius:10px; color:#fff;
          padding:14px 16px; font-size:16px; outline:none; }
  input:focus { border-color:#e11d2e; }
  button { background:#e11d2e; color:#fff; border:0; border-radius:10px; padding:14px 22px;
           font-size:16px; font-weight:600; cursor:pointer; }
  button:hover { background:#c2131f; }
  .links { margin-top:30px; display:flex; flex-wrap:wrap; gap:10px; justify-content:center; max-width:640px; }
  .links a { color:#ddd; text-decoration:none; background:#171717; border:1px solid #2c2c2c;
             padding:9px 14px; border-radius:999px; font-size:14px; }
  .links a:hover { border-color:#e11d2e; color:#fff; }
  footer { margin-top:auto; padding-top:40px; color:#666; font-size:12px; text-align:center; max-width:640px;}
</style>
</head>
<body>
  <h1>6ix<span>Networks</span></h1>
  <p class="sub">paste a link or type a search — the site loads through this server, not your device</p>
  <form action="/go" method="get">
    <input name="q" type="text" placeholder="https://example.com  —  or just search something" autocomplete="off" autofocus>
    <button type="submit">Go</button>
  </form>
  <div class="links">
    <a href="/go?q=https://www.google.com">Google</a>
    <a href="/go?q=https://duckduckgo.com">DuckDuckGo</a>
    <a href="/go?q=https://www.wikipedia.org">Wikipedia</a>
    <a href="/yt">YouTube</a>
    <a href="/gs">Games</a>
    <a href="/go?q=https://www.reddit.com">Reddit</a>
    <a href="/go?q=https://www.coolmathgames.com">CoolMath Games</a>
  </div>
  ${CLOAK_BAR}<script src="/cloak.js"></script>
<footer>heads up: simple sites, search, articles and a lot of video/game pages work fine.
  sites see a regular Chrome browser running on this server, and cookies carry over per site, so some logins stick now. the biggest sites still block proxy IPs sometimes — that's them, not the proxy.</footer>
<script>
  // turn bare domains into https:// before submitting is handled server-side too
</script>
</body>
</html>`;

function normalizeInput(q) {
  const s = (q || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) return 'https://' + s;
  return 'https://www.bing.com/search?q=' + encodeURIComponent(s);
}

const MEM_CACHE = new Map();

// ---------- proxy core ----------
async function handleProxy(req, res, targetUrlStr) {
  let target;
  try { target = new URL(targetUrlStr); } catch {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('bad url');
  }
  if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('that host is blocked');
  }

  // collect request body (for proxied form posts)
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const accept = req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
  const isNav = accept.includes('text/html');
  const headers = {
    'user-agent': BROWSER_UA,
    'accept': accept,
    'accept-language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': isNav ? 'document' : 'empty',
    'sec-fetch-mode': isNav ? 'navigate' : 'cors',
    'sec-fetch-site': 'none',
    'referer': target.origin + '/',
  };
  if (isNav) {
    headers['sec-fetch-user'] = '?1';
    headers['upgrade-insecure-requests'] = '1';
  }
  if (req.headers['range']) headers['range'] = req.headers['range'];
  if (req.headers['if-range']) headers['if-range'] = req.headers['if-range'];
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  const upstreamCookies = buildUpstreamCookies(req.headers['cookie'] || '', target.hostname);
  if (upstreamCookies) headers['cookie'] = upstreamCookies;

  const mirror = youtubeMirror(target);
  if (mirror) {
    res.writeHead(302, { location: mirror });
    return res.end();
  }
  // memory cache (Node deploys): static assets only, GET without Range
  const cacheableReq = req.method === 'GET' && !req.headers['range'] && isStaticAsset(target, '');
  if (cacheableReq) {
    const hit = MEM_CACHE.get(target.toString());
    if (hit && Date.now() - hit.time < 3600e3) {
      const h = Object.assign({}, hit.headers, { 'x-6ixnetworks-cache': 'HIT' });
      res.writeHead(200, h);
      return res.end(hit.buf);
    }
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      redirect: 'manual',
    });
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    return res.end('proxy could not reach that site: ' + e.message);
  }

  const status = upstream.status;
  const outHeaders = {};
  const ct = upstream.headers.get('content-type');
  if (ct) outHeaders['content-type'] = ct;
  const cache = upstream.headers.get('cache-control');
  if (cache) outHeaders['cache-control'] = cache;
  // translate the site's cookies onto the proxy domain so sessions persist
  const translatedCookies = getSetCookies(upstream.headers)
    .map(sc => translateSetCookie(sc, target.hostname)).filter(Boolean);
  if (translatedCookies.length) outHeaders['set-cookie'] = translatedCookies;

  // redirects: send the browser to the proxied version of the new location
  if (status >= 300 && status < 400 && upstream.headers.get('location')) {
    const loc = new URL(upstream.headers.get('location'), target).toString();
    outHeaders['location'] = proxied(loc);
    res.writeHead(302, outHeaders);
    return res.end();
  }

  const isHtml = ct && ct.includes('text/html');
  const isCss = ct && ct.includes('text/css');

  if (isHtml || isCss) {
    const text = await upstream.text();
    const rewritten = isHtml ? rewriteHtml(text, target.toString()) : rewriteCss(text, target.toString());
    const buf = Buffer.from(rewritten, 'utf8');
    outHeaders['content-length'] = buf.length;
    res.writeHead(status, outHeaders);
    return res.end(buf);
  }

  // stream everything else raw, passing through the headers media
  // players need (range/seeking) — this is what makes video files play
  for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) outHeaders[h] = v;
  }
  const cacheableRes = cacheableReq && status === 200 && isStaticAsset(target, ct || '');
  if (cacheableRes) {
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length <= 3e6) {
      MEM_CACHE.set(target.toString(), { buf, headers: Object.assign({}, outHeaders), time: Date.now() });
      if (MEM_CACHE.size > 150) MEM_CACHE.delete(MEM_CACHE.keys().next().value);
    }
    outHeaders['x-6ixnetworks-cache'] = 'MISS';
    outHeaders['content-length'] = buf.length;
    res.writeHead(status, outHeaders);
    return res.end(buf);
  }
  res.writeHead(status, outHeaders);
  if (upstream.body) {
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  }
  res.end();
}

async function handleYtSearch(req, res, q) {
  const query = (q || '').trim();
  if (!query) { res.writeHead(302, { location: '/yt' }); return res.end(); }
  for (const inst of INVIDIOUS_INSTANCES) {
    try {
      const pageUrl = inst + '/search?q=' + encodeURIComponent(query);
      const r = await fetch(pageUrl, {
        headers: {
          'user-agent': BROWSER_UA,
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      if (!r.ok) continue;
      const text = await r.text();
      if (!text.includes('/watch?v=')) continue;
      const rewritten = rewriteHtml(text, pageUrl);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(rewritten);
    } catch { /* try next instance */ }
  }
  res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><body style="background:#0a0a0a;color:#f2f2f2;font-family:system-ui;padding:40px">all search instances are down rn — <a style="color:#e11d2e" href="https://piped.video/search?q=' + encodeURIComponent(query) + '">search on Piped instead</a></body>');
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(HOME);
  }
  if (u.pathname === '/cloak.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(CLOAK_JS);
  }
  if (u.pathname === '/gs') {
    const games = await loadGames();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(gamesPage(games));
  }
  if (u.pathname === '/play') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(playPage(u.searchParams.get('u') || '', u.searchParams.get('t') || 'Game'));
  }
  if (u.pathname === '/yt') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(YT_HOME);
  }
  if (u.pathname === '/yt/search') {
    return handleYtSearch(req, res, u.searchParams.get('q') || '');
  }
  if (u.pathname === '/go') {
    const dest = normalizeInput(u.searchParams.get('q') || '');
    if (!dest) { res.writeHead(302, { location: '/' }); return res.end(); }
    res.writeHead(302, { location: proxied(dest) });
    return res.end();
  }
  if (u.pathname.startsWith('/browse/')) {
    const encoded = u.pathname.slice('/browse/'.length);
    let targetStr;
    try { targetStr = b64urlDecode(encoded); } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad proxy path');
    }
    // keep any query string the browser appended
    if (u.search) targetStr += (targetStr.includes('?') ? '&' : '?') + u.search.slice(1);
    return handleProxy(req, res, targetStr);
  }
  if (u.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, () => console.log('web proxy listening on ' + PORT));
