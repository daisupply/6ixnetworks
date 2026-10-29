// Cloudflare Worker version of the web proxy — same logic as server.js
// Deploy:  npx wrangler deploy        (free tier: 100,000 requests/day)
// Or paste this file straight into the Cloudflare dashboard's Worker editor.

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return decodeURIComponent(escape(atob(b64 + pad)));
}
function proxied(absUrl) { return '/browse/' + b64urlEncode(absUrl); }
function gproxied(absUrl) {
  return '/gproxy/' + b64urlEncode(absUrl);
}
// ---------- proxy shim ----------
// Injected at the very top of every proxied page. The static rewriter only
// catches URLs written in HTML — this patches the runtime too: fetch, XHR,
// dynamically-set src/href, link clicks, form posts and DOM insertions all
// get routed back through the proxy, so a page's own code can't wander off
// to its base network. Everything stays inside 6ixNetworks.
const PROXY_SHIM = `(function(){
var TGT=%%TGT%%, PRE=%%PRE%%;
function b64(s){ return btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function rw(u){ try{ if(typeof u!=='string') return u; if(!u || u.indexOf(PRE)===0 || /^(data|blob|about|javascript|mailto|tel):/i.test(u)) return u; var a=new URL(u, TGT); if(!/^https?:$/.test(a.protocol)) return u; return PRE + b64(a.href); }catch(e){ return u; } }
var of=window.fetch;
if(of) window.fetch=function(input, init){ try{ if(typeof input==='string') input=rw(input); else if(input && input.url) input=new Request(rw(input.url), input); }catch(e){} return of.call(this, input, init); };
var oo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m, u){ try{ arguments[1]=rw(u); }catch(e){} return oo.apply(this, arguments); };
[['HTMLImageElement','src'],['HTMLScriptElement','src'],['HTMLMediaElement','src'],['HTMLSourceElement','src'],['HTMLIFrameElement','src'],['HTMLLinkElement','href'],['HTMLAnchorElement','href']].forEach(function(pair){
  var el=window[pair[0]]; if(!el) return;
  var desc=Object.getOwnPropertyDescriptor(el.prototype, pair[1]);
  if(desc && desc.set && desc.configurable){ Object.defineProperty(el.prototype, pair[1], { configurable:true, enumerable:desc.enumerable, get:desc.get, set:function(v){ desc.set.call(this, rw(v)); } }); }
});
document.addEventListener('click', function(e){ var a=e.target && e.target.closest ? e.target.closest('a[href]') : null; if(a){ var h=a.getAttribute('href'); var r=rw(h); if(r!==h) a.setAttribute('href', r); } }, true);
document.addEventListener('submit', function(e){ var f=e.target; if(f && f.getAttribute && f.getAttribute('action')){ var r=rw(f.getAttribute('action')); f.setAttribute('action', r); } }, true);
function fixNode(node){ if(node.nodeType!==1) return; var list=[node]; if(node.querySelectorAll) list=list.concat(Array.prototype.slice.call(node.querySelectorAll('img,script,link,video,audio,source,iframe,a'))); list.forEach(function(el){ if(!el.getAttribute) return; ['src','href'].forEach(function(at){ var v=el.getAttribute(at); if(v){ var r=rw(v); if(r!==v) el.setAttribute(at, r); } }); }); }
try{ new MutationObserver(function(ms){ ms.forEach(function(m){ m.addedNodes.forEach(fixNode); }); }).observe(document.documentElement, { childList:true, subtree:true }); }catch(e){}
try{ var _lr=window.location.replace.bind(window.location); window.location.replace=function(u){ _lr(rw(u)); }; }catch(e){}
try{ var _la=window.location.assign.bind(window.location); window.location.assign=function(u){ _la(rw(u)); }; }catch(e){}
window.open=function(u){ if(u){ window.location.href=rw(u); } return null; };
})();`;
function injectProxyShim(html, tgt, pre) {
  const shim = '<script>' + PROXY_SHIM.replace('%%TGT%%', JSON.stringify(tgt)).replace('%%PRE%%', JSON.stringify(pre)) + '</' + 'script>';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + shim);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + shim);
  return shim + html;
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

// The page the browser was actually on, translated back to target-space:
// its referer points at a /browse or /gproxy URL on this host, so decode
// it and hand the site the real page URL as the referer.
function proxyReferer(ref, target) {
  if (ref) {
    try {
      const u = new URL(ref);
      const m = u.pathname.match(/^\/(?:browse|gproxy)\/(.+)$/);
      if (m) {
        const decoded = b64urlDecode(m[1]);
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    } catch { /* fall through */ }
  }
  return target.origin + '/';
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

// Bing result links don't point at the result — they point at Bing's own
// click-tracker (bing.com/ck/a?...&u=a1<base64 of the real URL>), which
// serves a fragile JS interstitial that dies or loops from datacenter
// IPs. The real destination is sitting right there in the link, so we
// decode it and skip the tracker entirely.
function debingUrl(abs) {
  try {
    if (!/(^|\.)bing\.com$/i.test(abs.hostname)) return null;
    if (!abs.pathname.startsWith('/ck/')) return null;
    const p = abs.searchParams.get('u');
    if (!p || p.slice(0, 2) !== 'a1') return null;
    const real = b64urlDecode(p.slice(2).replace(/\+/g, '-').replace(/\//g, '_'));
    return /^https?:\/\//i.test(real) ? real : null;
  } catch { return null; }
}

function resolveAndProxy(rawValue, baseUrl) {
  const v = (rawValue || '').trim();
  if (!v || v.startsWith('#') || /^(data|javascript|mailto|tel|blob|about):/i.test(v)) return rawValue;
  try {
    const abs = new URL(v, baseUrl).toString();
    const real = debingUrl(new URL(abs));
    return proxied(real || abs);
  } catch { return rawValue; }
}
function rewriteSrcset(value, baseUrl) {
  return value.split(',').map(part => {
    const seg = part.trim(); if (!seg) return seg;
    const bits = seg.split(/\s+/);
    bits[0] = resolveAndProxy(bits[0], baseUrl);
    return bits.join(' ');
  }).join(', ');
}
// Browsers hand us attribute values HTML-escaped (&amp; for &). Encoding
// the escaped text into the proxy URL corrupts the query string — Bing's
// result links died as blank 204s because of exactly this. Decode first.
function unescapeAttr(s) {
  return s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
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
    const val = unescapeAttr(dq !== undefined ? dq : (sq !== undefined ? sq : uq));
    const quote = dq !== undefined ? '"' : (sq !== undefined ? "'" : '');
    const rewritten = attr.toLowerCase() === 'srcset' ? rewriteSrcset(val, baseUrl) : resolveAndProxy(val, baseUrl);
    return `${attr}=${quote}${rewritten}${quote}`;
  }).replace(/\s+target\s*=\s*("_blank"|'_blank'|_blank)/gi, '');
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
const CLOAK_BAR = `<div style="margin-top:26px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;color:#9a9a9a;font-size:13px">
<button onclick="cloakTab('google')" style="background:rgba(139,92,246,.13);color:#e6e0ff;border:1px solid rgba(196,181,253,.35);border-radius:999px;padding:7px 13px;cursor:pointer">google</button>
<button onclick="cloakTab('classroom')" style="background:rgba(139,92,246,.13);color:#e6e0ff;border:1px solid rgba(196,181,253,.35);border-radius:999px;padding:7px 13px;cursor:pointer">classroom</button>
<button onclick="cloakTab('docs')" style="background:rgba(139,92,246,.13);color:#e6e0ff;border:1px solid rgba(196,181,253,.35);border-radius:999px;padding:7px 13px;cursor:pointer">docs</button>
<button onclick="cloakOpen()" style="background:rgba(139,92,246,.13);color:#e6e0ff;border:1px solid rgba(196,181,253,.35);border-radius:999px;padding:7px 13px;cursor:pointer">open in cloaked tab</button></div>`;
// ---------- galaxy theme ----------
// relaxing deep-space look shared by every page: layered nebula gradients,
// a slow twinkling starfield canvas (served from /stars.js), glass panels,
// soft rounded type (Comfortaa + Nunito), all-lowercase niche copy.
const FONT_LINKS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@500;700&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">';
const STAR_CANVAS = '<canvas id="stars"></canvas><script src="/stars.js"></script>';
const GALAXY_CSS = `
*{box-sizing:border-box;margin:0}
html{background:#05030f}
body{background:radial-gradient(1200px 800px at 85% -10%, rgba(88,60,180,.28), transparent 60%),radial-gradient(1000px 700px at -10% 110%, rgba(30,80,160,.20), transparent 60%),linear-gradient(180deg,#070418 0%,#05030f 45%,#030209 100%);color:#ece9ff;font-family:'Nunito',system-ui,-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:56px 16px 48px;overflow-x:hidden}
body::before{content:'';position:fixed;inset:-12%;z-index:0;pointer-events:none;background:radial-gradient(560px 380px at 18% 26%, rgba(139,92,246,.20), transparent 65%),radial-gradient(640px 420px at 82% 18%, rgba(236,121,196,.13), transparent 65%),radial-gradient(760px 520px at 55% 88%, rgba(56,150,255,.12), transparent 65%);filter:blur(6px);animation:nebula 26s ease-in-out infinite alternate}
@keyframes nebula{from{transform:translate3d(-1.5%,-1%,0) scale(1)}to{transform:translate3d(1.5%,1.2%,0) scale(1.05)}}
#stars{position:fixed;inset:0;z-index:0;pointer-events:none}
body>*:not(#stars){position:relative;z-index:1}
h1{font-family:'Comfortaa','Nunito',sans-serif;font-size:clamp(30px,6vw,44px);font-weight:700;letter-spacing:.04em;text-transform:lowercase;background:linear-gradient(92deg,#c4b5fd 0%,#f0abfc 48%,#7dd3fc 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 18px rgba(167,139,250,.35));margin-bottom:10px;text-align:center}
p.sub{color:#b3a8e8;margin-bottom:30px;font-size:15px;text-align:center;max-width:600px;line-height:1.55;font-weight:600;letter-spacing:.02em}
form{display:flex;width:100%;max-width:640px;gap:10px}
input{flex:1;background:rgba(255,255,255,.055);border:1px solid rgba(196,181,253,.28);border-radius:16px;color:#fff;padding:15px 18px;font-size:16px;outline:none;font-family:inherit;backdrop-filter:blur(10px);transition:border-color .25s, box-shadow .25s}
input::placeholder{color:#8f86c9}
input:focus{border-color:rgba(240,171,252,.75);box-shadow:0 0 0 4px rgba(167,139,250,.16),0 0 24px rgba(167,139,250,.22)}
button{background:linear-gradient(120deg,#8b5cf6,#ec4899);color:#fff;border:0;border-radius:16px;padding:15px 24px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:.03em;box-shadow:0 6px 24px rgba(168,85,247,.35);transition:transform .2s, box-shadow .2s}
button:hover{transform:translateY(-1px);box-shadow:0 10px 30px rgba(236,72,153,.4)}
.links{margin-top:32px;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:680px}
.links a{color:#ded7ff;text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(196,181,253,.25);padding:10px 16px;border-radius:999px;font-size:14px;font-weight:600;backdrop-filter:blur(8px);transition:border-color .2s, background .2s}
.links a:hover{border-color:rgba(240,171,252,.7);background:rgba(167,139,250,.14)}
footer,.foot{margin-top:auto;padding-top:44px;color:#7e74ad;font-size:12.5px;text-align:center;max-width:640px;line-height:1.6}
::selection{background:rgba(167,139,250,.45)}
::-webkit-scrollbar{width:10px}::-webkit-scrollbar-thumb{background:rgba(167,139,250,.35);border-radius:8px}::-webkit-scrollbar-track{background:transparent}
.wrap{width:100%;max-width:1120px;margin:0 auto}
a.back{color:#c4b5fd;text-decoration:none;font-size:14px;font-weight:700}
.bar{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 20px;width:100%;max-width:1120px}
.bar input{flex:1;min-width:200px;padding:13px 16px;font-size:15px}
.bar select{background:rgba(20,14,48,.88);border:1px solid rgba(196,181,253,.28);border-radius:16px;color:#ece9ff;padding:13px;font-size:15px;font-family:inherit;outline:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;width:100%;max-width:1120px}
.card{background:rgba(255,255,255,.045);border:1px solid rgba(196,181,253,.16);border-radius:18px;overflow:hidden;text-decoration:none;color:#ece9ff;display:block;backdrop-filter:blur(8px);transition:transform .22s, border-color .22s, box-shadow .22s}
.card:hover{transform:translateY(-4px);border-color:rgba(240,171,252,.65);box-shadow:0 14px 34px rgba(88,60,180,.35)}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:rgba(255,255,255,.03)}
.noimg{width:100%;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;color:#7e74ad;background:rgba(255,255,255,.03);font-size:12px}
.gt{padding:10px 12px 2px;font-size:14px;font-weight:700}
.gc{padding:0 12px 12px;font-size:12px;color:#9d92d6}
body.playbody{padding:0;height:100vh}
.top{display:flex;gap:8px;align-items:center;padding:9px 12px;background:rgba(10,6,28,.72);border-bottom:1px solid rgba(196,181,253,.18);flex-wrap:wrap;width:100%;backdrop-filter:blur(12px)}
.top .title{font-weight:700;margin-right:auto;font-size:15px;font-family:'Comfortaa',sans-serif;letter-spacing:.02em}
.top a,.top button{background:rgba(255,255,255,.06);color:#ded7ff;border:1px solid rgba(196,181,253,.3);border-radius:12px;padding:8px 13px;cursor:pointer;text-decoration:none;font-size:13px;font-weight:700;box-shadow:none;font-family:inherit}
.top button.on{border-color:#f0abfc;color:#fff;background:rgba(236,72,153,.18)}
iframe.gameframe{flex:1;width:100%;border:0;background:#000}
`;
const STARS_JS = `
(function(){
  var c=document.getElementById('stars'); if(!c) return;
  var ctx=c.getContext('2d'); var W=0,H=0,stars=[],meteor=null;
  var DPR=Math.min(window.devicePixelRatio||1,1.5);
  var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size(){ W=window.innerWidth; H=window.innerHeight; c.width=W*DPR; c.height=H*DPR; c.style.width=W+'px'; c.style.height=H+'px'; ctx.setTransform(DPR,0,0,DPR,0,0);
    var n=Math.min(170, Math.floor(W*H/11000)); stars=[];
    for(var i=0;i<n;i++) stars.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.4+0.3,p:Math.random()*6.283,s:0.4+Math.random()*1.1,d:Math.random()*0.008+0.002});
  }
  function draw(){
    ctx.clearRect(0,0,W,H);
    for(var i=0;i<stars.length;i++){ var st=stars[i]; st.p+=st.s*0.016; st.y-=st.d; if(st.y<-2){ st.y=H+2; st.x=Math.random()*W; }
      var a=0.35+0.65*Math.abs(Math.sin(st.p));
      ctx.beginPath(); ctx.arc(st.x,st.y,st.r,0,6.2832); ctx.fillStyle='rgba(230,225,255,'+(a*0.9)+')'; ctx.fill();
      if(st.r>1.15){ ctx.beginPath(); ctx.arc(st.x,st.y,st.r*3.2,0,6.2832); ctx.fillStyle='rgba(167,139,250,'+(a*0.10)+')'; ctx.fill(); }
    }
    if(!meteor && !reduced && Math.random()<0.0022){ meteor={x:Math.random()*W*0.7+W*0.2,y:Math.random()*H*0.25,vx:-7-Math.random()*3,vy:4+Math.random()*2,l:1}; }
    if(meteor){ meteor.x+=meteor.vx; meteor.y+=meteor.vy; meteor.l-=0.016;
      var g=ctx.createLinearGradient(meteor.x,meteor.y,meteor.x-meteor.vx*9,meteor.y-meteor.vy*9);
      g.addColorStop(0,'rgba(255,255,255,'+(0.85*Math.max(meteor.l,0))+')'); g.addColorStop(1,'rgba(255,255,255,0)');
      ctx.strokeStyle=g; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(meteor.x,meteor.y); ctx.lineTo(meteor.x-meteor.vx*9,meteor.y-meteor.vy*9); ctx.stroke();
      if(meteor.l<=0||meteor.x<-80||meteor.y>H+80) meteor=null;
    }
    if(!reduced) requestAnimationFrame(draw);
  }
  size(); window.addEventListener('resize',size); requestAnimationFrame(draw);
})();`;


// ---------- YouTube network ----------
// youtube.com's own player refuses every cloud/datacenter IP at the
// playability check, and the surviving public Invidious instances bot-wall
// their /watch pages when fetched from a server — but Invidious SEARCH works
// through the proxy, and the Piped network (a whole federated YouTube
// frontend) still plays. So: search here, mirror playback to Piped.
const INVIDIOUS_INSTANCES = [
  'https://invidious.tiekoetter.com',
  'https://inv.nadeko.net',
  'https://yt.chocolatemoo53.com',
];
const INVIDIOUS_API_ORDER = [
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
];
const INVIDIOUS_HOSTS = INVIDIOUS_INSTANCES.map(u => new URL(u).hostname).concat(['invidious.nerdvpn.de']);
// every video/search link resolves to a 6ixNetworks route — nothing is
// ever handed off to youtube, piped, or an instance's own pages
function internalMirror(target) {
  const h = target.hostname.toLowerCase();
  const vid = target.searchParams.get('v');
  if (h === 'youtu.be') {
    const id = target.pathname.slice(1).split('/')[0];
    return id ? '/yt/watch?v=' + encodeURIComponent(id) : '/yt';
  }
  if (/(^|\.)youtube\.com$/.test(h) || h === 'www.youtube-nocookie.com') {
    if (target.pathname === '/watch' && vid) return '/yt/watch?v=' + encodeURIComponent(vid);
    if (/^\/(shorts|embed|live)\//.test(target.pathname)) {
      const id = target.pathname.split('/')[2];
      if (id) return '/yt/watch?v=' + encodeURIComponent(id);
    }
    if (target.pathname === '/results') {
      const q = target.searchParams.get('search_query');
      if (q) return '/yt/search?q=' + encodeURIComponent(q);
    }
    return '/yt';
  }
  if (h === 'www.google.com' || h === 'google.com') {
    // google serves datacenter IPs its "unusual traffic" sorry page, and
    // the captcha on it can never work through a proxy (reCAPTCHA is
    // domain-locked — it errors "invalid domain for site key" anywhere
    // but google.com). So google searches just become network searches.
    if (target.pathname === '/search') {
      const q = target.searchParams.get('q');
      return q ? '/go?q=' + encodeURIComponent(q) : '/';
    }
    if (target.pathname === '/' || target.pathname.startsWith('/sorry')) return '/home';
    return null;
  }
  if (INVIDIOUS_HOSTS.includes(h) && target.pathname === '/watch' && vid) {
    return '/yt/watch?v=' + encodeURIComponent(vid);
  }
  return null;
}
const YT_HOME = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks — YouTube</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style></head><body>${STAR_CANVAS}
<h1>6ix<span>Networks</span> — youtube mode</h1>

<form action="/yt/search" method="get"><input name="q" type="text" placeholder="search youtube" autocomplete="off" autofocus><button type="submit">search</button></form>
<div class="links">

<a href="/home">← back to 6ixnetworks</a>
</div>
${CLOAK_BAR}<script src="/cloak.js"></script>

</body></html>`;
function isStaticAsset(target, ct) {
  if (ct) {
    if (/^(image|font)\//i.test(ct)) return true;
    if (/text\/css|javascript|ecmascript/i.test(ct)) return true;
  }
  return /\.(?:png|jpe?g|gif|webp|svg|ico|avif|css|mjs|js|woff2?|ttf|otf)$/i.test(target.pathname);
}

function normalizeInput(q) {
  const s = (q || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) return 'https://' + s;
  return 'https://www.bing.com/search?q=' + encodeURIComponent(s);
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
  const cards = games.map((g, gi) => {
    const thumb = g.img ? proxied(g.img) : '';
    return `<a class="card" href="/play?u=${encodeURIComponent(g.u)}&t=${encodeURIComponent(g.t)}" data-s="${escHtml((g.t + ' ' + g.c).toLowerCase())}" data-c="${escHtml(g.c)}" data-u="${escHtml(g.u)}" data-i="${gi}">
      ${thumb ? `<img loading="lazy" src="${thumb}" alt="">` : '<div class="noimg">no preview</div>'}
      <span class="fav" data-f="${escHtml(g.u)}">☆</span><div class="gt">${escHtml(g.t)}</div></a>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks — Games</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style><style>.card{position:relative}.fav{position:absolute;top:6px;right:8px;z-index:2;font-size:19px;line-height:1;color:rgba(255,255,255,.85);text-shadow:0 1px 6px rgba(0,0,0,.85);cursor:pointer;padding:3px 5px}.fav.on{color:#fbbf24}.chip{background:rgba(139,92,246,.14);color:#e6e0ff;border:1px solid rgba(196,181,253,.35);border-radius:999px;padding:9px 15px;cursor:pointer;font-weight:700;font-family:inherit}.chip.on{background:rgba(139,92,246,.45)}</style></head><body>${STAR_CANVAS}<div class="wrap">
<a class="back" href="/home">← 6ixNetworks</a>
<h1>6ix<span>Networks</span> games</h1>

<div class="bar"><input id="gq" type="text" placeholder="search games..." autocomplete="off">
<select id="gc"><option value="">all categories</option>${cats.map(c => `<option>${escHtml(c)}</option>`).join('')}</select><button class="chip" id="gfav" type="button">★ favorites</button><button class="chip" id="grec" type="button">recent</button><button class="chip" id="grand" type="button">🎲 random</button><a class="chip" href="/emu" style="text-decoration:none">🕹 emulator</a><a class="chip" href="/chat" style="text-decoration:none">💬 chat</a><a class="chip" href="/ai" style="text-decoration:none">✦ ai</a></div>
<div class="grid" id="grid">${cards}</div>
${CLOAK_BAR}

</div>
<script src="/cloak.js"></script>
<script>
var gq=document.getElementById('gq'), gc=document.getElementById('gc'), grid=document.getElementById('grid');
var favOnly=false, recOnly=false;
function ls(k, d){ try{ return JSON.parse(localStorage.getItem(k)) || d; }catch(e){ return d; } }
function favs(){ return ls('gx_favs', []); }
function recents(){ return ls('gx_recent', []); }
function paintFavs(){ var f=favs(); document.querySelectorAll('.fav').forEach(function(el){ var on=f.indexOf(el.dataset.f)>=0; el.classList.toggle('on', on); el.textContent = on ? '★' : '☆'; }); }
function filt(){ var q=gq.value.toLowerCase(), c=gc.value, f=favs(), r=recents();
  document.querySelectorAll('.card').forEach(function(el){
    var ok = (!q || el.dataset.s.includes(q)) && (!c || el.dataset.c===c);
    if(favOnly) ok = ok && f.indexOf(el.dataset.u)>=0;
    if(recOnly) ok = ok && r.indexOf(el.dataset.u)>=0;
    el.style.display = ok ? '' : 'none';
  });
}
function orderRecent(on){ var cards=[].slice.call(grid.querySelectorAll('.card')); if(on){ var r=recents(); cards.sort(function(a,b){ var ia=r.indexOf(a.dataset.u), ib=r.indexOf(b.dataset.u); ia = ia<0 ? 999 : ia; ib = ib<0 ? 999 : ib; return ia-ib; }); } else { cards.sort(function(a,b){ return (+a.dataset.i)-(+b.dataset.i); }); } cards.forEach(function(el){ grid.appendChild(el); }); }
gq.addEventListener('input', filt); gc.addEventListener('change', filt);
document.getElementById('gfav').addEventListener('click', function(){ favOnly=!favOnly; this.classList.toggle('on', favOnly); filt(); });
document.getElementById('grec').addEventListener('click', function(){ recOnly=!recOnly; this.classList.toggle('on', recOnly); orderRecent(recOnly); filt(); });
document.getElementById('grand').addEventListener('click', function(){ var vis=[].slice.call(grid.querySelectorAll('.card')).filter(function(el){ return el.style.display!=='none'; }); if(vis.length) location.href = vis[Math.floor(Math.random()*vis.length)].href; });
grid.addEventListener('click', function(e){
  var f=e.target.closest ? e.target.closest('.fav') : null;
  if(f){ e.preventDefault(); e.stopPropagation(); var u=f.dataset.f, a=favs(), i=a.indexOf(u); if(i>=0) a.splice(i,1); else a.push(u); try{ localStorage.setItem('gx_favs', JSON.stringify(a)); }catch(err){} paintFavs(); if(favOnly) filt(); return; }
  var card=e.target.closest ? e.target.closest('.card') : null;
  if(card && card.dataset.u){ var r=recents().filter(function(x){ return x!==card.dataset.u; }); r.unshift(card.dataset.u); try{ localStorage.setItem('gx_recent', JSON.stringify(r.slice(0,12))); }catch(err){} }
});
paintFavs();
</script>
</body>
</html>`;
}
function playPage(u, t) {
  if (!/^https:\/\//i.test(u || '')) {
    return '<!DOCTYPE html><body style="background:#070313;color:#f2f2f2;font-family:system-ui;padding:40px">bad game link — <a style="color:#c084fc" href="/gs">back to games</a></body>';
  }
  const prox = gproxied(u);
  const alt = proxied(u);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(t || 'Game')}</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style></head><body class="playbody">${STAR_CANVAS}
<div class="top"><a href="/gs">← games</a><span class="title">${escHtml(t || 'Game')}</span><span id="st" style="opacity:.7;font-size:13px"></span>
<button class="on" onclick="useNet()">network</button>
<button onclick="retry()">retry</button>
<button onclick="document.getElementById('gf').requestFullscreen()">fullscreen</button>
<button onclick="cloakTab('google')">cloak: google</button>
<button onclick="cloakOpen()">cloaked tab</button></div>
<iframe class="gameframe" id="gf" src="${prox}" allowfullscreen allow="autoplay; fullscreen; gamepad; keyboard-lock"></iframe>
<div id="dead" onclick="retry()" style="display:none;position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:5;background:rgba(20,14,48,.92);border:1px solid rgba(196,181,253,.45);color:#ece9ff;border-radius:999px;padding:10px 20px;cursor:pointer;font-weight:700">✦ retry</div>
<script src="/cloak.js"></script>
<script src="/stars.js"></script>
<script>
var PROX=${JSON.stringify(prox)}, ALT=${JSON.stringify(alt)}, stage=0;
var gf=document.getElementById('gf'), stEl=document.getElementById('st');
var MKEY='gx_mode_'+location.search;
function saveMode(){ try{ localStorage.setItem(MKEY, stage===0 ? 'prox' : 'alt'); }catch(e){} }
try{ if(localStorage.getItem(MKEY)==='alt'){ stage=1; gf.src=ALT; } }catch(e){}
try{ var gu=new URLSearchParams(location.search).get('u'); if(gu){ var R=[]; try{ R=JSON.parse(localStorage.getItem('gx_recent'))||[]; }catch(e){} R=[gu].concat(R.filter(function(x){ return x!==gu; })).slice(0,12); localStorage.setItem('gx_recent', JSON.stringify(R)); } }catch(e){}
function dead(){
  try{
    var d=gf.contentDocument;
    if(!d || !d.body) return false;
    var t=d.body.innerText||'';
    if(/proxy could not reach|that host is blocked|bad proxy path/i.test(t)) return true;
    if(d.querySelector('canvas,iframe,video,embed,object')) return false;
    return d.body.innerHTML.length < 5000;
  }catch(e){ return false; }
}
function check(){
  if(!dead()){ saveMode(); if(stEl) stEl.textContent=''; return; }
  if(stage===0){ stage=1; if(stEl) stEl.textContent='switching route…'; gf.src=ALT; arm(); }
  else if(stage===1){ stage=2; if(stEl) stEl.textContent=''; document.getElementById('dead').style.display='block'; }
}
function arm(){ [5000, 11000, 18000, 30000].forEach(function(ms){ setTimeout(check, ms); }); }
function useNet(){ stage=0; document.getElementById('dead').style.display='none'; if(stEl) stEl.textContent=''; gf.src=PROX; arm(); }
function retry(){ useNet(); }
gf.addEventListener('load', function(){ setTimeout(check, 3000); });
arm();
</script>
</body>
</html>`;
}



// ---------- emulator (/emu) ----------
// EmulatorJS cores (real JS/WASM emulation: NES, SNES, GB, GBA, N64,
// Genesis, Atari) stream through the network via the /px/ prefix proxy,
// and the ROM runs entirely in the visitor's browser — they supply the
// game file (upload or link), nothing is hosted or uploaded here.
function emuPage() {
  const data = '/px/' + b64urlEncode('https://cdn.emulatorjs.org/stable/data/') + '/';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks — Emulator</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style><style>
.panel{background:rgba(20,14,48,.55);border:1px solid rgba(196,181,253,.25);border-radius:18px;padding:16px;margin-top:16px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0}
.row select,.row input[type=text]{background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(196,181,253,.3);border-radius:10px;padding:10px;font-family:inherit}
.row input[type=text]{flex:1;min-width:200px}
#game{width:100%;aspect-ratio:4/3;background:#000;border-radius:14px;overflow:hidden}
button.play{background:rgba(139,92,246,.3);color:#fff;border:1px solid rgba(196,181,253,.5);border-radius:999px;padding:11px 26px;font-weight:800;cursor:pointer;font-family:inherit;font-size:15px}
</style></head><body>${STAR_CANVAS}<div class="wrap">
<a class="back" href="/gs">← games</a>
<h1>6ix<span>Networks</span> emulator</h1>
<div class="panel">
<div class="row">
<select id="sys">
<option value="nes">NES</option>
<option value="snes">SNES</option>
<option value="gb">Game Boy / Color</option>
<option value="gba">Game Boy Advance</option>
<option value="n64">Nintendo 64</option>
<option value="segaMD">Genesis</option>
<option value="atari2600">Atari 2600</option>
</select>
<input type="file" id="rom">
</div>
<div class="row"><input type="text" id="romurl" placeholder="or paste a rom link (.nes .smc .gba .z64 .zip...)"><button class="play" id="go">▶ play</button></div>
<p style="opacity:.75;font-size:13px;margin:6px 2px 0">drop in a rom u own — it runs right in ur browser, nothing uploads ✦ zip files work too</p>
</div>
<div class="panel"><div id="game"></div></div>
${CLOAK_BAR}
</div>
<script src="/cloak.js"></script>
<script src="/stars.js"></script>
<script>
var DATA=${JSON.stringify(data)};
var extmap={nes:'nes',smc:'snes',sfc:'snes',gb:'gb',gbc:'gb',gba:'gba',z64:'n64',n64:'n64',v64:'n64',md:'segaMD',gen:'segaMD',a26:'atari2600'};
var fileEl=document.getElementById('rom'), sysEl=document.getElementById('sys');
fileEl.addEventListener('change', function(){
  var f=fileEl.files[0]; if(!f) return;
  var ext=(f.name.split('.').pop()||'').toLowerCase();
  if(extmap[ext]) sysEl.value=extmap[ext];
});
function b64url(s){ return btoa(unescape(encodeURIComponent(s))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }
document.getElementById('go').addEventListener('click', function(){
  var url='';
  var f=fileEl.files[0];
  if(f){ url=URL.createObjectURL(f); }
  else {
    var raw=document.getElementById('romurl').value.trim();
    if(!raw){ alert('pick a rom file or paste a link first'); return; }
    if(/^https?:\\/\\//i.test(raw)){ url='/gproxy/'+b64url(raw); }
    else { url=raw; }
    var ext=(raw.split('?')[0].split('.').pop()||'').toLowerCase();
    if(extmap[ext]) sysEl.value=extmap[ext];
  }
  window.EJS_player='#game';
  window.EJS_core=sysEl.value;
  window.EJS_pathtodata=location.origin+DATA;
  window.EJS_gameUrl=url;
  window.EJS_startOnLoaded=true;
  var sc=document.createElement('script');
  sc.src=location.origin+DATA+'loader.js';
  document.body.appendChild(sc);
  document.getElementById('game').scrollIntoView({ behavior:'smooth' });
});
</script>
</body>
</html>`;
}

const FEATURED_GAMES = [
  { t: 'Roblox', u: 'https://www.roblox.com/home', img: '', c: 'Featured', w: 800, h: 600 },
  { t: 'Minecraft Classic', u: 'https://classic.minecraft.net', img: '', c: 'Featured', w: 800, h: 600 },
  { t: 'Krunker', u: 'https://krunker.io', img: '', c: 'Featured', w: 800, h: 600 },
];


// ---------- six ai + chatroom (shared pages) ----------
const SIX_SYSTEM = 'You are Six, the AI inside 6ixNetworks — a galaxy-themed web network with a web proxy, a 600-game hub, a retro emulator (NES, SNES, Game Boy/Color, GBA, N64, Genesis, Atari 2600), a YouTube player, tools (calculator, notepad, timers), and a live chatroom where people can summon you with /ai. You are chill, direct, and genuinely helpful. Keep answers short unless asked for detail. Help with homework, games, ideas, and questions about the site. Never claim a feature exists that is not listed here.';
function cleanName(n) { n = String(n || '').replace(/[<>&"']/g, '').trim().slice(0, 24); if (!n || /six/i.test(n)) n = 'anon'; return n; }
function cleanText(t) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 500); }

function chatPage() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks — Chat</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style><style>
#msgs{height:52vh;overflow-y:auto;background:rgba(0,0,0,.25);border:1px solid rgba(196,181,253,.22);border-radius:16px;padding:14px;text-align:left}
.msg{margin:7px 0;word-break:break-word}
.msg b{color:#c4b5fd}
.msg.bot b{color:#f0abfc}
.sys{text-align:center;opacity:.55;font-size:12px;margin:8px 0}
.bar{display:flex;gap:8px;margin-top:10px}
.bar input[type=text]{flex:1;background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(196,181,253,.3);border-radius:10px;padding:11px;font-family:inherit}
.bar button{background:rgba(139,92,246,.3);color:#fff;border:1px solid rgba(196,181,253,.5);border-radius:10px;padding:11px 18px;font-weight:800;cursor:pointer;font-family:inherit}
.chip.on{background:rgba(139,92,246,.45)}
</style></head><body>${STAR_CANVAS}<div class="wrap">
<a class="back" href="/home">← home</a> · <a class="back" href="/ai">ask six ✦</a>
<h1>6ix<span>Networks</span> chat</h1>
<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0">
<button class="chip room on" data-room="lobby" type="button">lobby</button>
<button class="chip room" data-room="games" type="button">games</button>
<button class="chip room" data-room="random" type="button">random</button>
<span id="pres" style="opacity:.7;font-size:13px">connecting…</span>
<input id="name" type="text" maxlength="24" placeholder="ur name" style="margin-left:auto;background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(196,181,253,.3);border-radius:10px;padding:8px 10px;font-family:inherit;width:130px">
</div>
<div id="msgs"></div>
<form class="bar" id="sendbar"><input type="text" id="text" placeholder="message…  (/ai + a question summons six)" autocomplete="off" maxlength="500"><button type="submit">send</button></form>
<p style="opacity:.65;font-size:13px">real people, live ✦ be cool — names n messages are public to the room</p>
${CLOAK_BAR}
</div>
<script src="/cloak.js"></script>
<script src="/stars.js"></script>
<script>
var nameEl=document.getElementById('name'), msgsEl=document.getElementById('msgs'), presEl=document.getElementById('pres'), textEl=document.getElementById('text');
var myName=localStorage.getItem('six_name')||'';
if(!myName){ myName='anon-'+Math.floor(1000+Math.random()*9000); localStorage.setItem('six_name', myName); }
nameEl.value=myName;
var room='lobby', lastTs=0, ws=null, polling=false, pollTimer=null;
function curName(){ return (nameEl.value||'').trim()||myName; }
function line(m){
  var d=document.createElement('div');
  if(m.sys){ d.className='sys'; d.textContent=m.text; }
  else { d.className='msg'+(m.bot?' bot':''); var b=document.createElement('b'); b.textContent=(m.bot?'✦ ':'')+m.name; var s=document.createElement('span'); s.textContent=' '+m.text; d.appendChild(b); d.appendChild(s); }
  msgsEl.appendChild(d); msgsEl.scrollTop=msgsEl.scrollHeight;
}
function handle(o){
  if(!o) return;
  if(o.type==='history'){ (o.msgs||[]).forEach(function(m){ line(m); if(m.ts>lastTs) lastTs=m.ts; }); }
  else if(o.type==='msg'){ line(o.msg); if(o.msg.ts>lastTs) lastTs=o.msg.ts; }
  else if(o.type==='presence'){ presEl.textContent=o.n+' online'; }
  else if(o.type==='sys'){ line({sys:true, text:o.text}); }
}
function connect(){
  stopPoll();
  try { ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/chat/ws?room='+encodeURIComponent(room)+'&name='+encodeURIComponent(curName())); }
  catch(e){ startPoll(); return; }
  ws.onopen=function(){ presEl.textContent='live ✦'; };
  ws.onmessage=function(ev){ try{ handle(JSON.parse(ev.data)); }catch(e){} };
  ws.onclose=function(){ startPoll(); };
  ws.onerror=function(){ try{ ws.close(); }catch(e){} };
}
function poll(){
  fetch('/chat/poll?room='+encodeURIComponent(room)+'&since='+lastTs).then(function(r){ return r.json(); }).then(function(o){
    (o.msgs||[]).forEach(function(m){ line(m); if(m.ts>lastTs) lastTs=m.ts; });
    presEl.textContent=(o.n||0)+' online · polling';
  }).catch(function(){});
}
function startPoll(){ if(polling) return; polling=true; poll(); pollTimer=setInterval(poll, 1500); }
function stopPoll(){ polling=false; if(pollTimer) clearInterval(pollTimer); }
document.getElementById('sendbar').addEventListener('submit', function(ev){
  ev.preventDefault();
  var t=textEl.value.trim(); if(!t) return; textEl.value='';
  if(t.toLowerCase().indexOf('/ai ')===0){
    line({sys:true, text:'asking six…'});
    fetch('/ai/room', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ room: room, name: curName(), question: t.slice(4) }) }).catch(function(){});
    return;
  }
  if(ws && ws.readyState===1){ ws.send(JSON.stringify({ text: t })); }
  else { fetch('/chat/send', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ room: room, name: curName(), text: t }) }).then(function(){ setTimeout(poll, 150); }).catch(function(){}); }
});
nameEl.addEventListener('change', function(){ localStorage.setItem('six_name', curName()); if(ws) try{ ws.close(); }catch(e){} connect(); });
Array.prototype.forEach.call(document.querySelectorAll('.room'), function(btn){
  btn.addEventListener('click', function(){
    Array.prototype.forEach.call(document.querySelectorAll('.room'), function(b){ b.classList.remove('on'); });
    btn.classList.add('on'); room=btn.getAttribute('data-room');
    msgsEl.innerHTML=''; lastTs=0; if(ws) try{ ws.close(); }catch(e){} connect();
  });
});
connect();
</script>
</body>
</html>`;
}

function aiPage() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks — Six AI</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style><style>
#log{height:52vh;overflow-y:auto;background:rgba(0,0,0,.25);border:1px solid rgba(196,181,253,.22);border-radius:16px;padding:14px;text-align:left}
.bub{max-width:85%;margin:8px 0;padding:10px 13px;border-radius:14px;word-break:break-word;white-space:pre-wrap}
.bub.me{margin-left:auto;background:rgba(139,92,246,.35)}
.bub.six{margin-right:auto;background:rgba(255,255,255,.07)}
.bar{display:flex;gap:8px;margin-top:10px}
.bar input[type=text]{flex:1;background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(196,181,253,.3);border-radius:10px;padding:11px;font-family:inherit}
.bar button{background:rgba(139,92,246,.3);color:#fff;border:1px solid rgba(196,181,253,.5);border-radius:10px;padding:11px 18px;font-weight:800;cursor:pointer;font-family:inherit}
</style></head><body>${STAR_CANVAS}<div class="wrap">
<a class="back" href="/home">← home</a> · <a class="back" href="/chat">chatroom</a>
<h1>six <span>✦ ai</span></h1>
<div id="log"></div>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
<button class="chip q" type="button">what can this site do?</button>
<button class="chip q" type="button">help me study chemistry</button>
<button class="chip q" type="button">pick a game for me</button>
</div>
<form class="bar" id="askbar"><input type="text" id="q" placeholder="ask six anything…" autocomplete="off" maxlength="1000"><button type="submit">ask</button></form>
${CLOAK_BAR}
</div>
<script src="/cloak.js"></script>
<script src="/stars.js"></script>
<script>
var logEl=document.getElementById('log'), qEl=document.getElementById('q'), hist=[];
function bubble(cls, text){ var d=document.createElement('div'); d.className='bub '+cls; d.textContent=text; logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight; return d; }
bubble('six', 'yo ✦ im six — the ai that lives in this network. ask me anything: homework, games, what to search, how the site works.');
function ask(text){
  hist.push({ role:'user', content: text }); bubble('me', text);
  var wait=bubble('six', 'thinking…');
  fetch('/ai/ask', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ messages: hist.slice(-10) }) })
    .then(function(r){ return r.json(); })
    .then(function(o){ var t=(o && o.text) || 'six blanked ✦ try again'; wait.textContent=t; hist.push({ role:'assistant', content: t }); })
    .catch(function(){ wait.textContent='six is unreachable rn ✦ try again in a sec'; });
}
document.getElementById('askbar').addEventListener('submit', function(ev){ ev.preventDefault(); var t=qEl.value.trim(); if(!t) return; qEl.value=''; ask(t); });
Array.prototype.forEach.call(document.querySelectorAll('.q'), function(b){ b.addEventListener('click', function(){ ask(b.textContent); }); });
</script>
</body>
</html>`;
}

function toolsPage() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks — Tools</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style><style>
.tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:16px}
.panel{background:rgba(20,14,48,.55);border:1px solid rgba(196,181,253,.25);border-radius:18px;padding:16px}
.panel h2{margin:0 0 12px;font-size:17px}
#cdisp{background:rgba(0,0,0,.35);border-radius:12px;padding:12px;font-size:24px;text-align:right;min-height:30px;word-break:break-all}
.cgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}
.cgrid button,.tbtn{background:rgba(139,92,246,.16);color:#ece9ff;border:1px solid rgba(196,181,253,.3);border-radius:12px;padding:12px 10px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit}
#note{width:100%;min-height:170px;background:rgba(0,0,0,.3);color:#f2f2f2;border:1px solid rgba(196,181,253,.25);border-radius:12px;padding:10px;font-family:inherit;font-size:14px;box-sizing:border-box}
#sw{font-size:38px;text-align:center;font-weight:800;margin:8px 0 12px}
.trow{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;align-items:center}
#tmin{width:70px;background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(196,181,253,.3);border-radius:10px;padding:9px;text-align:center;font-family:inherit}
</style></head><body>${STAR_CANVAS}<div class="wrap">
<a class="back" href="/home">← 6ixNetworks</a>
<h1>6ix<span>Networks</span> tools</h1>
<div class="tools">
<div class="panel"><h2>calculator</h2><div id="cdisp">0</div><div class="cgrid" id="cgrid"></div></div>
<div class="panel"><h2>notepad</h2><textarea id="note" placeholder="type here — it saves itself ✦"></textarea><div id="ncount" style="opacity:.7;font-size:12px;margin-top:6px"></div></div>
<div class="panel"><h2>stopwatch + timer</h2><div id="sw">00:00.0</div>
<div class="trow"><button class="tbtn" id="swgo">start</button><button class="tbtn" id="swreset">reset</button></div>
<div class="trow" style="margin-top:14px"><input id="tmin" type="number" min="0" placeholder="min"><button class="tbtn" id="tgo">timer</button><span id="tstat" style="opacity:.8"></span></div></div>
</div>
${CLOAK_BAR}
</div>
<script src="/cloak.js"></script>
<script src="/stars.js"></script>
<script>
var cd=document.getElementById('cdisp'), expr='';
var keys=['C','(',')','/','7','8','9','*','4','5','6','-','1','2','3','+','0','.','⌫','='];
var cg=document.getElementById('cgrid');
keys.forEach(function(k){ var b=document.createElement('button'); b.type='button'; b.textContent=k; b.addEventListener('click', function(){
  if(k==='C'){ expr=''; }
  else if(k==='⌫'){ expr=expr.slice(0,-1); }
  else if(k==='='){ if(/^[0-9+\-*/.() ]+$/.test(expr)){ try{ var v=Function('return ('+expr+')')(); expr=String(Math.round(v*1e10)/1e10); }catch(e){ expr=''; cd.textContent='error'; return; } } }
  else { expr+=k; }
  cd.textContent = expr || '0';
}); cg.appendChild(b); });
var note=document.getElementById('note'), nc=document.getElementById('ncount');
try{ note.value=localStorage.getItem('gx_note')||''; }catch(e){}
function nupd(){ nc.textContent=note.value.length+' chars — saved ✦'; try{ localStorage.setItem('gx_note', note.value); }catch(e){} }
note.addEventListener('input', nupd); nupd();
var swEl=document.getElementById('sw'), swT0=0, swAcc=0, swRun=null;
function fmt(ms){ var t=Math.floor(ms/100), s=Math.floor(t/10), m=Math.floor(s/60); function p(n,l){ return String(n).padStart(l,'0'); } return p(m,2)+':'+p(s%60,2)+'.'+(t%10); }
function swDraw(){ swEl.textContent=fmt(swAcc + (swT0 ? Date.now()-swT0 : 0)); }
document.getElementById('swgo').addEventListener('click', function(){ if(swT0){ swAcc+=Date.now()-swT0; swT0=0; clearInterval(swRun); this.textContent='start'; } else { swT0=Date.now(); swRun=setInterval(swDraw, 47); this.textContent='pause'; } });
document.getElementById('swreset').addEventListener('click', function(){ swAcc=0; swT0=0; clearInterval(swRun); document.getElementById('swgo').textContent='start'; swDraw(); });
var tInt=null;
document.getElementById('tgo').addEventListener('click', function(){ var m=parseFloat(document.getElementById('tmin').value)||0, st=document.getElementById('tstat'); if(tInt){ clearInterval(tInt); tInt=null; } if(m<=0){ st.textContent=''; return; } var left=Math.round(m*60); st.textContent=left+'s left'; tInt=setInterval(function(){ left--; if(left<=0){ clearInterval(tInt); tInt=null; st.textContent='done ✦'; try{ var ac=new (window.AudioContext||window.webkitAudioContext)(), o=ac.createOscillator(), g=ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value=880; g.gain.value=0.15; o.start(); setTimeout(function(){ o.stop(); ac.close(); }, 700); }catch(e){} return; } st.textContent=left+'s left'; }, 1000); });
swDraw();
</script>
</body>
</html>`;
}

const HOME = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>6ixNetworks</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style></head><body>${STAR_CANVAS}
<h1>6ix<span>Networks</span></h1>

<form action="/go" method="get"><input name="q" type="text" placeholder="search ✦" autocomplete="off" autofocus list="sg"><button type="submit">go</button></form><datalist id="sg"></datalist>
<div class="links">
<a href="/go?q=https://www.google.com">google</a>
<a href="/go?q=https://duckduckgo.com">duckduckgo</a>
<a href="/go?q=https://www.wikipedia.org">wikipedia</a>
<a href="/yt">youtube</a><a href="/gs">games</a> <a href="/tools">tools</a> <a href="/chat">chat</a> <a href="/ai">ai ✦</a>
<a href="/go?q=https://www.reddit.com">reddit</a>
<a href="/go?q=https://www.coolmathgames.com">coolmath games</a>
</div>
${CLOAK_BAR}<script src="/cloak.js"></script>

<script>
var qi=document.querySelector('input[name=q]'), sg=document.getElementById('sg'), sgt=null;
if(qi && sg){ qi.addEventListener('input', function(){ clearTimeout(sgt); var v=qi.value.trim(); if(v.length<2){ sg.innerHTML=''; return; } sgt=setTimeout(function(){ fetch('/suggest?q='+encodeURIComponent(v)).then(function(r){ return r.json(); }).then(function(list){ sg.innerHTML=''; (list||[]).forEach(function(s){ var o=document.createElement('option'); o.value=s; sg.appendChild(o); }); }).catch(function(){}); }, 160); }); }
</script>
</body></html>`;


function blockPage(targetStr) {
  const arch = proxied('https://web.archive.org/web/2id_/' + targetStr);
  const again = proxied(targetStr);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>blocked — 6ixNetworks</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style></head><body>${STAR_CANVAS}<div class="wrap">
<a class="back" href="/home">← 6ixNetworks</a>
<h1>6ix<span>Networks</span></h1>
<p style="font-weight:700;font-size:19px">that site blocked the network ✦</p>
<p style="opacity:.8;max-width:52ch">its firewall refused the connection — happens with datacenter traffic. the archive copy usually still loads:</p>
<div class="links"><a href="${arch}">archive.org copy</a><a href="${again}">retry</a><a href="/home">home</a></div>
${CLOAK_BAR}
</div>
<script src="/cloak.js"></script>
<script src="/stars.js"></script>
</body></html>`;
}
function looksBlocked(text) {
  const head = (text || '').slice(0, 4000);
  return /attention required|are you a robot|access denied|request blocked|unusual traffic|verify you are human|checking your browser|ddos-guard|incapsula|just a moment/i.test(head) || head.length < 1200;
}

const BLOCK_SIG = /attention required|are you a robot|access denied|request blocked|unusual traffic|verify you are human|checking your browser|ddos-guard|incapsula|just a moment|rate limit|too many requests/i;
const CHAL_SIG = /just a moment|checking your browser|verify you are human|are you a robot|attention required/i;
// alternate egress, worker-style: public relay services fetch the page
// from THEIR network and hand us the HTML. Wired as an automatic
// fallback for sites that firewall the direct route — allorigins and
// cors.lol were the two that demonstrably answered during testing
// (codetabs timed out, corsproxy.io wants a key, thingproxy is dead).
const RELAYS = [
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://api.cors.lol/?url=' + encodeURIComponent(u),
];
async function fetchViaRelay(targetStr) {
  for (const build of RELAYS) {
    try {
      const r = await fetch(build(targetStr), { headers: { 'user-agent': BROWSER_UA, 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('text/html')) continue;
      const text = await r.text();
      if (text.length < 800 || BLOCK_SIG.test(text.slice(0, 4000))) continue;
      return text;
    } catch { /* next relay */ }
  }
  return null;
}
async function handleProxy(request, targetUrlStr, ctx, gameMode) {
  let target;
  try { target = new URL(targetUrlStr); } catch {
    return new Response('bad url', { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) {
    return new Response('that host is blocked', { status: 403 });
  }
  const accept = request.headers.get('accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
  const isNav = accept.includes('text/html');
  const headers = new Headers();
  headers.set('user-agent', BROWSER_UA);
  headers.set('accept', accept);
  headers.set('accept-language', request.headers.get('accept-language') || 'en-US,en;q=0.9');
  headers.set('sec-ch-ua', '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="24"');
  headers.set('sec-ch-ua-mobile', '?0');
  headers.set('sec-ch-ua-platform', '"Windows"');
  // forward the browser's own fetch metadata when it sent any: an image
  // request has to look like an image request, a script like a script.
  // Forging one fixed shape for everything (the old way) is what made
  // image and captcha servers refuse to serve pictures.
  const fDest = request.headers.get('sec-fetch-dest');
  const fMode = request.headers.get('sec-fetch-mode');
  const fSite = request.headers.get('sec-fetch-site');
  headers.set('sec-fetch-dest', fDest || (isNav ? 'document' : 'empty'));
  headers.set('sec-fetch-mode', fMode || (isNav ? 'navigate' : 'cors'));
  headers.set('sec-fetch-site', fSite || 'none');
  headers.set('referer', proxyReferer(request.headers.get('referer'), target));
  if (request.headers.get('sec-fetch-user')) headers.set('sec-fetch-user', request.headers.get('sec-fetch-user'));
  else if (isNav && !fDest) {
    headers.set('sec-fetch-user', '?1');
    headers.set('upgrade-insecure-requests', '1');
  }
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  const ifRange = request.headers.get('if-range');
  if (ifRange) headers.set('if-range', ifRange);
  const ctype = request.headers.get('content-type');
  if (ctype) headers.set('content-type', ctype);
  // bing degrades search results when a request carries an established
  // cookie jar (it collapses the ranking to a single term while still
  // echoing the full query) — a fresh jar always gets the real results.
  // so bing search requests go out cookieless, always.
  const isBingSearch = /(^|\.)bing\.com$/i.test(target.hostname) && target.pathname.includes('/search');
  const upstreamCookies = isBingSearch ? '' : buildUpstreamCookies(request.headers.get('cookie') || '', target.hostname);
  if (upstreamCookies) headers.set('cookie', upstreamCookies);

  const mirror = internalMirror(target);
  if (mirror) return Response.redirect(new URL(mirror, request.url).toString(), 302);
  const debinged = debingUrl(target);
  if (debinged) return Response.redirect(new URL(proxied(debinged), request.url).toString(), 302);
  // edge cache: static assets only, GET without Range
  const canCache = request.method === 'GET' && !request.headers.has('range') && isStaticAsset(target, '');
  const cache = (typeof caches !== 'undefined') ? caches.default : null;
  const cacheKey = canCache && cache ? new Request('https://cache.6ixnetworks/' + b64urlEncode(target.toString())) : null;
  if (cacheKey) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers);
      h.set('x-6ixnetworks-cache', 'HIT');
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
    });
  } catch (e) {
    return new Response('proxy could not reach that site: ' + e.message, { status: 502 });
  }

  // translate the site's cookies onto the proxy domain so sessions persist
  const translatedCookies = getSetCookies(upstream.headers)
    .map(sc => translateSetCookie(sc, target.hostname)).filter(Boolean);

  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
    const loc = new URL(upstream.headers.get('location'), target).toString();
    const rh = new Headers({ location: new URL(proxied(loc), request.url).toString() });
    for (const c of translatedCookies) rh.append('set-cookie', c);
    return new Response(null, { status: 302, headers: rh });
  }
  const ct = upstream.headers.get('content-type') || '';
  const outHeaders = new Headers();
  if (ct) outHeaders.set('content-type', ct);
  const ucc = upstream.headers.get('cache-control');
  if (ucc) outHeaders.set('cache-control', ucc);
  else if (isStaticAsset(target, ct)) outHeaders.set('cache-control', 'public, max-age=604800, immutable');
  for (const c of translatedCookies) outHeaders.append('set-cookie', c);

  if (ct.includes('text/html') || ct.includes('text/css')) {
    const text = await upstream.text();
    if (ct.includes('text/html') && isNav && (upstream.status === 403 || upstream.status === 429 || CHAL_SIG.test(text.slice(0, 4000)))) {
      const relayed = await fetchViaRelay(target.toString());
      if (relayed) {
        let rw = rewriteHtml(relayed, target.toString());
        rw = injectProxyShim(rw, target.toString(), gameMode ? '/gproxy/' : '/browse/');
        return new Response(rw, { headers: { 'content-type': 'text/html; charset=utf-8', 'x-6ixnetworks-route': 'relay' } });
      }
      if (upstream.status !== 200) {
        return new Response(blockPage(target.toString()), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    }
    let rewritten = ct.includes('text/html')
      ? rewriteHtml(text, target.toString())
      : rewriteCss(text, target.toString());
  if (ct.includes('text/html')) rewritten = injectProxyShim(rewritten, target.toString(), gameMode ? '/gproxy/' : '/browse/');
    return new Response(rewritten, { status: upstream.status, headers: outHeaders });
  }
  for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) outHeaders.set(h, v);
  }
  const resp = new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  if (cacheKey && upstream.status === 200 && isStaticAsset(target, ct)) {
    outHeaders.set('x-6ixnetworks-cache', 'MISS');
    const toCache = new Response(resp.body ? resp.clone().body : null, { status: resp.status, headers: outHeaders });
    ctx.waitUntil(cache.put(cacheKey, toCache));
    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  }
  return resp;
}


function ytSearchPage(query, hit) {
  const abs = (u) => { try { return new URL(u, hit.inst).href; } catch { return u; } };
  const cards = hit.vids.map(r => {
    const t0 = (r.videoThumbnails || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    const img = t0 ? proxied(abs(t0.url)) : '';
    const len = r.lengthSeconds ? Math.floor(r.lengthSeconds / 60) + ':' + String(r.lengthSeconds % 60).padStart(2, '0') : '';
    return `<a class="card" href="/yt/watch?v=${encodeURIComponent(r.videoId)}">${img ? `<img loading="lazy" src="${img}" alt="">` : '<div class="noimg">✦</div>'}<div class="gt">${escHtml(r.title || '')}</div><div style="opacity:.65;font-size:12px;padding:0 10px 10px">${escHtml(r.author || '')}${len ? ' · ' + len : ''}</div></a>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(query)} — 6ixNetworks</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style></head><body>${STAR_CANVAS}<div class="wrap">
<a class="back" href="/yt">← youtube</a>
<h1>6ix<span>Networks</span></h1>
<form action="/yt/search" method="get"><input name="q" type="text" value="${escHtml(query)}" placeholder="search youtube ✦" autocomplete="off"><button type="submit">go</button></form>
<div class="grid" style="margin-top:18px">${cards}</div>
${CLOAK_BAR}
</div>
<script src="/cloak.js"></script>
<script src="/stars.js"></script>
</body></html>`;
}
async function fetchYtSearchApi(query) {
  for (let round = 0; round < 2; round++) {
    for (const inst of INVIDIOUS_API_ORDER) {
      try {
        const r = await fetch(inst + '/api/v1/search?q=' + encodeURIComponent(query) + '&type=video', { headers: { 'user-agent': BROWSER_UA, 'accept': 'application/json' } });
        if (!r.ok) continue;
        const j = await r.json();
        if (Array.isArray(j)) { const vids = j.filter(x => x && x.videoId && x.title); if (vids.length) return { inst, vids }; }
      } catch { /* next instance */ }
    }
    if (round === 0) await sleep(1200);
  }
  return null;
}
async function handleYtSearch(q, request) {
  const query = (q || '').trim();
  if (!query) return Response.redirect(new URL('/yt', request.url).toString(), 302);
  const apiHit = await fetchYtSearchApi(query);
  if (apiHit) return new Response(ytSearchPage(query, apiHit), { headers: { 'content-type': 'text/html; charset=utf-8' } });
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
      return new Response(rewriteHtml(text, pageUrl), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    } catch { /* try next instance */ }
  }
  return new Response('<!DOCTYPE html><body style="background:#070313;color:#f2f2f2;font-family:system-ui;padding:40px">all search instances are down rn — <a style="color:#c084fc" href="/yt/search?q=' + encodeURIComponent(query) + '">retry</a></body>', { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } });
}


// ---------- in-network youtube player (/yt/watch) ----------
// Data comes from an instance's API (fetched by this server), playback is
// an MSE player in our own page streaming both tracks through /gproxy —
// the browser never talks to youtube, an instance, or googlevideo.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const YT_INFO_CACHE = new Map();
async function fetchVideoInfo(id, bust) {
  if (!bust) { const c = YT_INFO_CACHE.get(id); if (c && Date.now() - c.at < 300e3) return c.hit; }
  // instances flap (their youtube-bypass backends restart and 500 for a
  // few seconds), so sweep the list twice with a breath between rounds
  for (let round = 0; round < 2; round++) {
    for (const inst of INVIDIOUS_API_ORDER) {
      try {
        const r = await fetch(inst + '/api/v1/videos/' + encodeURIComponent(id) + '?local=true', {
          headers: { 'user-agent': BROWSER_UA, 'accept': 'application/json' },
        });
        if (!r.ok) continue;
        const j = await r.json();
        if (j && ((j.adaptiveFormats || []).length || (j.formatStreams || []).length)) { const hit = { inst, data: j }; YT_INFO_CACHE.set(id, { at: Date.now(), hit }); if (YT_INFO_CACHE.size > 60) YT_INFO_CACHE.delete(YT_INFO_CACHE.keys().next().value); return hit; }
      } catch { /* next instance */ }
    }
    if (round === 0) await sleep(1500);
  }
  return null;
}
function pickStreams(d) {
  const hOf = (f) => parseInt(f.resolution) || f.height || 0;
  const vids = (d.adaptiveFormats || []).filter(f => /^video\//.test(f.type || '') && /video\/mp4/.test(f.type || ''));
  const auds = (d.adaptiveFormats || []).filter(f => /^audio\//.test(f.type || ''));
  const avc = vids.filter(f => (f.type || '').includes('avc1')).sort((a, b) => hOf(b) - hOf(a));
  const v = avc.find(f => hOf(f) <= 720) || avc[0] || vids.sort((a, b) => hOf(b) - hOf(a))[0] || null;
  const audsMp4 = auds.filter(f => /audio\/mp4/.test(f.type || '')).sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0));
  const a = audsMp4[0] || auds.sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0))[0] || null;
  const p = (d.formatStreams || [])[0] || null;
  return { v, a, p };
}
function ytWatchPage(id, hit) {
  const d = hit.data;
  const abs = (u) => { try { return new URL(u, hit.inst).href; } catch { return u; } };
  const hOf = (f) => parseInt(f.resolution) || f.height || 0;
  const vids = (d.adaptiveFormats || []).filter(f => /^video\//.test(f.type || '') && /video\/mp4/.test(f.type || ''));
  const auds = (d.adaptiveFormats || []).filter(f => /^audio\//.test(f.type || ''));
  const avc = vids.filter(f => (f.type || '').includes('avc1')).sort((a, b) => hOf(b) - hOf(a));
  const pickV = avc.find(f => hOf(f) <= 720) || avc[0] || vids.sort((a, b) => hOf(b) - hOf(a))[0];
  const pickA = auds.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  const thumbs = (d.videoThumbnails || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0));
  const poster = thumbs.length ? proxied(abs(thumbs[0].url)) : '';
  const recs = (d.recommendedVideos || []).slice(0, 12).map(rv => {
    const t0 = (rv.videoThumbnails || [])[0];
    const img = t0 ? proxied(abs(t0.url)) : '';
    return `<a class="card" href="/yt/watch?v=${encodeURIComponent(rv.videoId)}">${img ? `<img loading="lazy" src="${img}" alt="">` : '<div class="noimg">✦</div>'}<div class="gt">${escHtml(rv.title || '')}</div></a>`;
  }).join('');
  // signed stream urls expire and instances restart, so the player asks
  // /yt/stream for a fresh one at play time instead of trusting this render
  const streamV = pickV ? '/yt/stream?v=' + encodeURIComponent(id) + '&kind=v' : '';
  const streamA = pickA ? '/yt/stream?v=' + encodeURIComponent(id) + '&kind=a' : '';
  const progUrl = (d.formatStreams || []).length ? '/yt/stream?v=' + encodeURIComponent(id) + '&kind=p' : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(d.title || 'video')}</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style></head><body>${STAR_CANVAS}
<div class="wrap">
<a class="back" href="/yt">← youtube</a>
<video id="vid" controls autoplay playsinline ${poster ? `poster="${poster}"` : ''} style="width:100%;border-radius:18px;background:#000;aspect-ratio:16/9;margin-top:12px"></video>
<p style="margin:14px 2px 20px;font-weight:700">${escHtml(d.title || '')}</p>
<div id="ytretry" onclick="location.reload()" style="display:none;margin:0 2px 14px;background:rgba(20,14,48,.92);border:1px solid rgba(196,181,253,.45);color:#ece9ff;border-radius:999px;padding:10px 20px;cursor:pointer;font-weight:700;width:fit-content">✦ tap to retry</div>
<div class="grid">${recs}</div>
${CLOAK_BAR}
</div>
<script src="/cloak.js"></script>
<script>
var GOT=0;
var V=${JSON.stringify(streamV)}, A=${JSON.stringify(streamA)}, VM=${JSON.stringify(pickV ? pickV.type : '')}, AM=${JSON.stringify(pickA ? pickA.type : '')}, PROG=${JSON.stringify(progUrl)};
var vid=document.getElementById('vid');
function appendBuf(sb, buf){ return new Promise(function(res){ function u(){ sb.removeEventListener('updateend', u); res(); } sb.addEventListener('updateend', u); try{ sb.appendBuffer(buf); }catch(e){ res(); } }); }
async function pump(sb, url, end){
  var start=0, CH=2000000, base=url, retries=0;
  try{
    while(true){
      var r=await fetch(url, { headers:{ 'Range':'bytes='+start+'-'+(start+CH-1) } });
      if(r.status===416) break;
      if(r.status===403 || r.status===500 || r.status===502){
        if(start===0 && retries<2){ retries++; url=base; await new Promise(function(res){ setTimeout(res, 1200*retries); }); continue; }
        break;
      }
      if(!r.ok && r.status!==206) break;
      if(r.url) url=r.url;
      var buf=await r.arrayBuffer();
      if(!buf.byteLength) break;
      await appendBuf(sb, buf); GOT+=buf.byteLength;
      start+=buf.byteLength;
      var cr=r.headers.get('Content-Range');
      if(cr){ var total=parseInt((cr.split('/')[1]||''),10); if(!isNaN(total) && start>=total) break; }
      else if(buf.byteLength<CH) break;
    }
  }catch(e){}
  end();
}
(function start(){
  if(!V){ if(PROG) vid.src=PROG; return; }
  if(!('MediaSource' in window) || !MediaSource.isTypeSupported(VM) || (A && !MediaSource.isTypeSupported(AM))){ vid.src = PROG || V; return; }
  var ms=new MediaSource();
  vid.src=URL.createObjectURL(ms);
  ms.addEventListener('sourceopen', function(){
    var vb, ab, dv=false, da=!A;
    try{ vb=ms.addSourceBuffer(VM); if(A) ab=ms.addSourceBuffer(AM); }catch(e){ vid.src = PROG || V; return; }
    function done(){ if(dv && da){ if(GOT===0 && (PROG || V)){ vid.src = PROG || V; return; } try{ ms.endOfStream(); }catch(e){} } }
    pump(vb, V, function(){ dv=true; done(); });
    if(A) pump(ab, A, function(){ da=true; done(); });
    setTimeout(function(){ if(GOT===0 && vid.readyState<2){ var p=document.getElementById('ytretry'); if(p) p.style.display='block'; } }, 12000);
  });
})();
</script>
</body>
</html>`;
}


// ---------- the shell (/shell) ----------
// A single HTML page that IS the cloak: the whole network runs inside a
// fullscreen iframe, so the outer tab's title + favicon stay disguised
// (Google by default) on EVERY page — not just the homepage. Served at
// /shell, and exportable as a standalone file (?ext=1 bakes in the
// public server list) that can be opened from a download with the
// server running entirely in the background.
function shellPage(servers) {
  const list = servers ? JSON.stringify(servers) : 'null';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Google</title><link rel="icon" href="https://www.google.com/favicon.ico">
<style>html,body{margin:0;height:100%;background:#070313;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}
#dot{position:fixed;right:14px;bottom:14px;z-index:9;width:30px;height:30px;border-radius:50%;border:1px solid rgba(196,181,253,.35);background:rgba(16,10,38,.55);color:#c4b5fd;opacity:.35;cursor:pointer;font-size:14px;line-height:1}
#dot:hover{opacity:1}
#menu{position:fixed;right:14px;bottom:52px;z-index:9;display:none;flex-direction:column;gap:6px;background:rgba(12,8,30,.94);border:1px solid rgba(196,181,253,.3);border-radius:14px;padding:10px}
#menu button{background:rgba(139,92,246,.14);color:#e6e0ff;border:1px solid rgba(196,181,253,.3);border-radius:999px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:700;text-align:left;font-family:system-ui}
</style></head><body>
<iframe id="f" allow="autoplay; fullscreen; gamepad; keyboard-lock" allowfullscreen></iframe>
<button id="dot">✦</button>
<div id="menu">
<button onclick="disguise('google')">google</button>
<button onclick="disguise('classroom')">classroom</button>
<button onclick="disguise('docs')">docs</button>
<button onclick="disguise('drive')">drive</button>
<button onclick="panic()">panic</button>
<button onclick="blank()">about:blank</button>
</div>
<script>
var SERVERS=${list} || [location.origin + '/'];
var f=document.getElementById('f');
var presets={ google:{t:'Google',i:'https://www.google.com/favicon.ico'}, classroom:{t:'Google Classroom',i:'https://ssl.gstatic.com/classroom/favicon.png'}, docs:{t:'Google Docs',i:'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico'}, drive:{t:'My Drive - Google Drive',i:'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png'} };
function disguise(k){ try{ localStorage.setItem('six_disguise', k); }catch(e){} var p=presets[k]||presets.google; document.title=p.t; var l=document.querySelector("link[rel~='icon']")||document.createElement('link'); l.rel='icon'; l.href=p.i; document.head.appendChild(l); }
function panic(){ disguise('classroom'); f.src='https://classroom.google.com/'; }
document.addEventListener('keydown', function(e){ if(e.keyCode===192) panic(); });
document.getElementById('dot').addEventListener('click', function(){ var m=document.getElementById('menu'); m.style.display = m.style.display==='flex' ? 'none' : 'flex'; });
function blank(){
  var w=window.open('about:blank','_blank');
  if(!w) return;
  var src=f.src;
  w.document.write('<!DOCTYPE html><html><head><title>Google</title><link rel="icon" href="https://www.google.com/favicon.ico"></head><body style="margin:0"><iframe src="'+src+'" style="border:0;width:100vw;height:100vh" allowfullscreen></iframe></body></html>');
  w.document.close();
  location.replace('https://www.google.com/');
}
try{ var sd=localStorage.getItem('six_disguise'); if(sd && presets[sd]){ document.title=presets[sd].t; var li=document.querySelector("link[rel~='icon']"); if(li) li.href=presets[sd].i; } }catch(e){}
(function start(){
  var saved=null;
  try{ saved=localStorage.getItem('six_server'); }catch(e){}
  var cands = saved ? [saved].concat(SERVERS) : SERVERS.slice();
  var i=0;
  function next(){
    if(i>=cands.length){ f.src=cands[0]+'home'; return; }
    var base=cands[i++];
    fetch(base, { mode:'no-cors', cache:'no-store' }).then(function(){ f.src=base+'home'; }, next);
  }
  if(cands.length===1) f.src=cands[0]+'home'; else next();
})();
</script>
</body></html>`;
}


// ---------- six ai (cloudflare workers ai) + chat backend ----------
function cleanRoom(r) { r = String(r || 'lobby').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24); return r || 'lobby'; }
function sixMessages(list) {
  const out = [];
  if (Array.isArray(list)) for (const m of list.slice(-10)) {
    if (m && (m.role === 'user' || m.role === 'assistant')) out.push({ role: m.role, content: String(m.content || '').slice(0, 1000) });
  }
  return out.length ? out : [{ role: 'user', content: 'hi' }];
}
const SIX_MODELS = ['@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.1-8b-instruct-fp8', '@cf/openai/gpt-oss-20b', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.2-3b-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
async function askSix(env, messages) {
  if (!env || !env.AI) return 'six only wakes up on the cloudflare build ✦ this copy cant reach him — try s.usareme.site';
  for (const model of SIX_MODELS) {
    try {
      const r = await env.AI.run(model, { messages: [{ role: 'system', content: SIX_SYSTEM }].concat(messages), max_tokens: 400 });
      const t = (r && (r.response || (r.result && r.result.response))) || '';
      if (String(t).trim()) return String(t).trim();
    } catch {}
  }
  return 'six is unreachable rn ✦ try again in a sec';
}
async function sixHealth(env) {
  const out = { binding: !!(env && env.AI), models: {} };
  if (!env || !env.AI) return out;
  for (const model of SIX_MODELS) {
    try {
      const r = await env.AI.run(model, { messages: [{ role: 'user', content: 'say ok' }], max_tokens: 3 });
      out.models[model] = 'ok: ' + String((r && r.response) || '').slice(0, 24);
    } catch (e) { out.models[model] = 'ERR: ' + String((e && e.message) || e).slice(0, 220); }
  }
  return out;
}

// the chatroom itself: one Durable Object per room. WebSockets use the
// hibernation API so idle rooms cost nothing; history (last 60) persists
// in the object's storage. bot messages can only arrive through the
// worker's /ai/room route, which marks them with an internal header the
// public /chat/send path never sets.
export class ChatRoom {
  constructor(state, env) { this.state = state; this.env = env; this.msgs = null; }
  async loadMsgs() { if (this.msgs === null) { try { this.msgs = (await this.state.storage.get('msgs')) || []; } catch { this.msgs = []; } } }
  async storeMsgs() { try { await this.state.storage.put('msgs', this.msgs.slice(-60)); } catch {} }
  broadcast(obj) { const s = JSON.stringify(obj); for (const ws of this.state.getWebSockets()) { try { ws.send(s); } catch {} } }
  presence() { this.broadcast({ type: 'presence', n: this.state.getWebSockets().length }); }
  async addMsg(msg) { await this.loadMsgs(); this.msgs.push(msg); this.msgs = this.msgs.slice(-60); await this.storeMsgs(); this.broadcast({ type: 'msg', msg }); }
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const name = cleanName(u.searchParams.get('name'));
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ name, last: 0 });
      await this.loadMsgs();
      try { pair[1].send(JSON.stringify({ type: 'history', msgs: this.msgs.slice(-50) })); } catch {}
      this.broadcast({ type: 'sys', text: name + ' slid in ✦' });
      this.presence();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (u.pathname === '/send' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const bot = request.headers.get('x-six-bot') === '1';
      const text = cleanText(b.text);
      if (!text) return new Response('{"ok":false}', { headers: { 'content-type': 'application/json' } });
      await this.addMsg({ name: bot ? 'six ✦ ai' : cleanName(b.name), text, ts: Date.now(), bot });
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/poll') {
      await this.loadMsgs();
      const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;
      const msgs = since > 0 ? this.msgs.filter(m => m.ts > since) : this.msgs.slice(-50);
      return new Response(JSON.stringify({ msgs, n: this.state.getWebSockets().length }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }
  async webSocketMessage(ws, data) {
    let att = {}; try { att = ws.deserializeAttachment() || {}; } catch {}
    const now = Date.now();
    if (now - (att.last || 0) < 300) return;
    att.last = now; try { ws.serializeAttachment(att); } catch {}
    let b = {}; try { b = JSON.parse(String(data)); } catch { return; }
    const text = cleanText(b.text); if (!text) return;
    await this.addMsg({ name: cleanName(att.name), text, ts: now, bot: false });
  }
  webSocketClose(ws) { let att = {}; try { att = ws.deserializeAttachment() || {}; } catch {} this.broadcast({ type: 'sys', text: (att.name || 'anon') + ' dipped' }); this.presence(); }
  webSocketError() { this.presence(); }
}

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === '/' || u.pathname === '/index.html') {
      return new Response(shellPage(null), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/home') {
      return new Response(HOME, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/stars.js') {
      return new Response(STARS_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
    }
    if (u.pathname === '/shell') {
      const servers = u.searchParams.has('ext') ? ['https://s.usareme.site/', 'https://sixsearch.deionmont1.workers.dev/'] : null;
      return new Response(shellPage(servers), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
        if (u.pathname === '/tools') {
      return new Response(toolsPage(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/suggest') {
      const q = (u.searchParams.get('q') || '').trim();
      let out = [];
      if (q) {
        try {
          const r = await fetch('https://ac.duckduckgo.com/ac/?q=' + encodeURIComponent(q) + '&type=list', { headers: { 'user-agent': BROWSER_UA, 'accept': 'application/json' } });
          const j = await r.json();
          if (Array.isArray(j) && Array.isArray(j[1])) out = j[1].slice(0, 8).map(String);
        } catch {}
      }
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    }
    if (u.pathname === '/cloak.js') {
      return new Response(CLOAK_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
    }
    if (u.pathname === '/chat') {
      return new Response(chatPage(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/ai') {
      return new Response(aiPage(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/ai/health') {
      return new Response(JSON.stringify(await sixHealth(env)), { headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/ai/ask' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const text = await askSix(env, sixMessages(b.messages));
      return new Response(JSON.stringify({ text }), { headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/ai/room' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const q = cleanText(b.question).slice(0, 300);
      if (!q || !env.CHAT) return new Response('{"ok":false}', { headers: { 'content-type': 'application/json' } });
      const stub = env.CHAT.get(env.CHAT.idFromName(cleanRoom(b.room)));
      await stub.fetch('https://chat/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: cleanName(b.name), text: q }) });
      const ans = await askSix(env, [{ role: 'user', content: q }]);
      await stub.fetch('https://chat/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-six-bot': '1' }, body: JSON.stringify({ text: ans }) });
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/chat/ws' || u.pathname === '/chat/send' || u.pathname === '/chat/poll') {
      if (!env.CHAT) return new Response('chat needs the full deploy ✦', { status: 503 });
      const stub = env.CHAT.get(env.CHAT.idFromName(cleanRoom(u.searchParams.get('room'))));
      if (u.pathname === '/chat/ws') {
        const du = new URL(request.url); du.pathname = '/ws';
        return stub.fetch(new Request(du, request));
      }
      if (u.pathname === '/chat/send') {
        const b = await request.json().catch(() => ({}));
        const r = await stub.fetch('https://chat/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: cleanName(b.name), text: cleanText(b.text) }) });
        return new Response(await r.text(), { headers: { 'content-type': 'application/json' } });
      }
      const r = await stub.fetch('https://chat/poll?since=' + encodeURIComponent(u.searchParams.get('since') || '0'));
      return new Response(await r.text(), { headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/emu') {
      return new Response(emuPage(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/gs') {
      const games = await loadGames();
      return new Response(gamesPage(FEATURED_GAMES.concat(games)), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/play') {
      return new Response(playPage(u.searchParams.get('u') || '', u.searchParams.get('t') || 'Game'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/yt') {
      return new Response(YT_HOME, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/yt/watch') {
      const vidId = (u.searchParams.get('v') || '').trim();
      const hit = vidId ? await fetchVideoInfo(vidId) : null;
      if (!hit) {
        return new Response('<!DOCTYPE html><body style="background:#070313;color:#f2f2f2;font-family:system-ui;padding:40px">unavailable rn — <a style="color:#c084fc" href="/yt">back</a></body>', { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response(ytWatchPage(vidId, hit), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.pathname === '/yt/stream') {
      const vidId = (u.searchParams.get('v') || '').trim();
      const kind = u.searchParams.get('kind') || 'v';
      if (!vidId) return new Response('stream unavailable', { status: 502 });
      const range = request.headers.get('range');
      let hit = await fetchVideoInfo(vidId);
      for (let attempt = 0; attempt < 2; attempt++) {
        const fmt = hit ? pickStreams(hit.data)[kind] : null;
        if (!fmt) break;
        let absUrl; try { absUrl = new URL(fmt.url, hit.inst).href; } catch { absUrl = fmt.url; }
        try {
          const up = await fetch(absUrl, { headers: { 'user-agent': BROWSER_UA, ...(range ? { range } : {}) } });
          if ((up.status === 403 || up.status === 500 || up.status === 502) && attempt === 0) { hit = await fetchVideoInfo(vidId, true); continue; }
          const hh = new Headers();
          for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) hh.set(h, v); }
          return new Response(up.body, { status: up.status, headers: hh });
        } catch { if (attempt === 0) { hit = await fetchVideoInfo(vidId, true); continue; } }
      }
      return new Response('stream unavailable', { status: 502 });
    }
    if (u.pathname === '/yt/search') {
      return handleYtSearch(u.searchParams.get('q') || '', request);
    }
    if (u.pathname === '/go') {
      const dest = normalizeInput(u.searchParams.get('q') || '');
      if (!dest) return Response.redirect(u.origin + '/home', 302);
      return Response.redirect(u.origin + proxied(dest), 302);
    }
    if (u.pathname.startsWith('/px/')) {
      const rest = u.pathname.slice('/px/'.length);
      const slash = rest.indexOf('/');
      let base = null;
      if (slash > 0) { try { base = b64urlDecode(rest.slice(0, slash)); } catch {} }
      if (!base || !/^https:\/\//i.test(base)) return new Response('bad prefix path', { status: 400 });
      if (!base.endsWith('/')) base += '/';
      let targetStr = base + rest.slice(slash + 1);
      if (u.search) targetStr += u.search;
      return handleProxy(request, targetStr, ctx, false);
    }
    if (u.pathname.startsWith('/gproxy/')) {
      let targetStr;
      try { targetStr = b64urlDecode(u.pathname.slice('/gproxy/'.length)); } catch {
        return new Response('bad proxy path', { status: 400 });
      }
      if (u.search) targetStr += (targetStr.includes('?') ? '&' : '?') + u.search.slice(1);
      return handleProxy(request, targetStr, ctx, true);
    }
    if (u.pathname.startsWith('/browse/')) {
      let targetStr;
      try { targetStr = b64urlDecode(u.pathname.slice('/browse/'.length)); } catch {
        return new Response('bad proxy path', { status: 400 });
      }
      if (u.search) targetStr += (targetStr.includes('?') ? '&' : '?') + u.search.slice(1);
      return handleProxy(request, targetStr, ctx);
    }
    if (u.pathname === '/healthz') return new Response('ok');
    return new Response('not found', { status: 404 });
  }
};
