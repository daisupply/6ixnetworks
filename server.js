// 6ixNetworks server — Node 18+ (built-in fetch; one optional dep, undici,
// only used when UPSTREAM_PROXY is set)
// Run: node server.js   (uses PORT env or 8080)

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;

// ---------- optional egress proxy / VPN ----------
// A Cloudflare Worker can never choose its egress IP — but this Node
// server can. Set UPSTREAM_PROXY to any http(s) proxy endpoint
// (a VPN provider's proxy, a local WARP/vpn client proxy, a proxy you
// run) and ALL upstream traffic leaves through it, from that IP.
// Or skip this entirely and run the server on a machine that is itself
// on a VPN — the server's fetches then use the VPN's IP automatically.
if (process.env.UPSTREAM_PROXY) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(process.env.UPSTREAM_PROXY));
    console.log('egress: upstream proxy on (' + process.env.UPSTREAM_PROXY.replace(/\/\/[^@]*@/, '//***@') + ')');
  } catch (e) {
    console.log('egress: UPSTREAM_PROXY set but undici is unavailable — run npm install. (' + e.message + ')');
  }
}

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
function rw(u){ try{ if(typeof u!=='string') return u; if(!u || u.indexOf(PRE)===0 || /^(data|blob|about|javascript|mailto|tel):/i.test(u)) return u; var a=new URL(u, TGT); if(!/^https?:$/.test(a.protocol)) return u; try{ if(a.host===location.host) return u; }catch(e){} return PRE + b64(a.href); }catch(e){ return u; } }
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
function sixAnswerSnippet(tgt) {
  let t; try { t = new URL(tgt); } catch { return ''; }
  if (!/(^|\.)bing\.com$/i.test(t.hostname) || !t.pathname.startsWith('/search')) return '';
  const q = (t.searchParams.get('q') || '').trim();
  if (!q) return '';
  const js = "(function(){var Q=" + JSON.stringify(q) + ";function init(){if(document.getElementById('sixbox'))return;var st=document.createElement('style');st.textContent='#sixbox{max-width:648px;margin:14px 0 6px;padding:14px 18px;border:1px solid rgba(167,139,250,.55);border-radius:16px;background:linear-gradient(135deg,rgba(38,22,84,.92),rgba(14,10,34,.94));color:#ece9ff;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 6px 30px rgba(88,28,175,.35)}#sixbox .h{font-weight:800;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#c4b5fd;margin-bottom:6px}#sixbox .b{font-size:16px;line-height:1.5;white-space:pre-wrap}#sixbox .f{margin-top:8px;font-size:11px;opacity:.55}';document.head.appendChild(st);var box=document.createElement('div');box.id='sixbox';box.innerHTML='<div class=h>\u2726 six</div><div class=b>thinking\u2026</div>';var host=document.querySelector('#b_content')||document.body;host.insertBefore(box,host.firstChild);fetch(location.origin+'/ai/answer?q='+encodeURIComponent(Q)).then(function(r){return r.json()}).then(function(j){if(j&&j.answer){box.querySelector('.b').textContent=j.answer;var f=document.createElement('div');f.className='f';f.textContent='ai answer \u2014 the real results are right below';box.appendChild(f);}else{box.remove();}}).catch(function(){box.remove();});}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();";
  return '<script>' + js + '</' + 'script>';
}

function summarizeSnippet(tgt) {
  const ub = JSON.stringify(b64urlEncode(tgt));
  const js = "(function(){if(location.pathname.indexOf('/browse/')!==0)return;function init(){if(document.getElementById('sixsum')||!document.body)return;var b=document.createElement('button');b.id='sixsum';b.textContent='\u2726 summarize';b.setAttribute('style','position:fixed;left:14px;bottom:14px;z-index:2147483640;background:rgba(30,20,60,.92);color:#e9d5ff;border:1px solid rgba(196,181,253,.65);border-radius:999px;padding:9px 15px;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.45)');var p=document.createElement('div');p.setAttribute('style','position:fixed;left:14px;bottom:60px;z-index:2147483640;max-width:min(440px,86vw);max-height:48vh;overflow-y:auto;background:rgba(18,12,38,.97);color:#f3efff;border:1px solid rgba(196,181,253,.5);border-radius:14px;padding:14px 16px;font:14px/1.55 system-ui,sans-serif;display:none;box-shadow:0 10px 34px rgba(0,0,0,.5)');var h=document.createElement('div');h.textContent='\u2726 six summary';h.setAttribute('style','font-weight:800;color:#c4b5fd;margin-bottom:6px');var t=document.createElement('div');t.style.whiteSpace='pre-wrap';p.appendChild(h);p.appendChild(t);var done=false;b.addEventListener('click',function(){if(p.style.display==='block'){p.style.display='none';return;}p.style.display='block';if(done)return;t.textContent='reading the page\u2026';fetch(location.origin+'/ai/summarize?u='+" + ub + ").then(function(r){return r.json()}).then(function(o){done=true;t.textContent=(o&&o.summary)?o.summary:'six couldnt summarize this one \u2014 some pages hide their text from readers.';}).catch(function(){t.textContent='six couldnt summarize this one.';});});document.body.appendChild(b);document.body.appendChild(p);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();";
  return '<script>' + js + '</' + 'script>';
}
function privCode() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += A[x % A.length];
  return s;
}
const SUM_CACHE = new Map();
async function summarizeUrl(env, ub) {
  let target = '';
  try { target = b64urlDecode(ub); } catch { return null; }
  if (!target) return null;
  let t;
  try { t = new URL(target); } catch { return null; }
  if (!/^https?:$/.test(t.protocol) || isPrivateHost(t.hostname)) return null;
  const hit = SUM_CACHE.get(target);
  if (hit && Date.now() - hit.ts < 600000) return hit.s;
  let s = null;
  try {
    const r = await fetchT(target, { headers: { 'user-agent': BROWSER_UA, 'accept': 'text/html,application/xhtml+xml' } }, 10000);
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('html')) {
      const raw = await r.text();
      const tm = raw.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
      const title = tm ? tm[1].replace(/\s+/g, ' ').trim() : '';
      let text = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
      text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 6000);
      if (text.length > 120) s = await askSixSummary(env, t.href, title, text);
    }
  } catch { s = null; }
  SUM_CACHE.set(target, { s, ts: Date.now() });
  if (SUM_CACHE.size > 100) SUM_CACHE.clear();
  return s;
}
async function askSixSummary(env, url, title, text) {
  const out = await askSix(null, [
    { role: 'system', content: 'You are Six, the AI inside the 6ixNetworks proxy. Summarize the web page below for a student: the gist in 3-5 short sentences, plain text, no markdown symbols. If the page has clear key facts, add them after as short lines starting with "• ". If the text is mostly navigation junk or you cannot tell what the page is about, say so honestly in one line.' },
    { role: 'user', content: 'URL: ' + url + '\nTITLE: ' + title + '\n\n' + text }
  ]);
  if (!out || out.indexOf('six is') === 0 || out.indexOf('six only') === 0) return null;
  return out;
}
function injectProxyShim(html, tgt, pre) {
  const shim = '<script>' + PROXY_SHIM.replace('%%TGT%%', JSON.stringify(tgt)).replace('%%PRE%%', JSON.stringify(pre)) + '</' + 'script>' + sixAnswerSnippet(tgt) + summarizeSnippet(tgt);
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
    const seg = part.trim();
    if (!seg) return seg;
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
  // the official embed player is the one youtube surface built to run
  // inside other sites — let it load through the proxy (the /yt/watch
  // page iframes it). watch/shorts/search links still mirror inside.
  if (h === 'www.youtube-nocookie.com' && /^\/embed\/[\w-]+/.test(target.pathname)) return null;
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

// ---------- homepage ----------


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
<div id="privbar" style="display:none;margin:8px 0;padding:10px 12px;border:1px solid rgba(240,171,252,.4);border-radius:12px;background:rgba(240,171,252,.08);font-size:14px;text-align:left"></div>
<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0">
<button class="chip" id="mkpriv" type="button">🔒 new private room</button>
<input id="joincode" type="text" maxlength="12" placeholder="room code" style="background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(196,181,253,.3);border-radius:10px;padding:8px 10px;font-family:inherit;width:120px">
<button class="chip" id="joinpriv" type="button">join private</button>
<span style="opacity:.6;font-size:12px">private rooms wipe themselves right after everyone leaves</span>
</div>
<div id="msgs"></div>
<form class="bar" id="sendbar"><input type="text" id="text" placeholder="message…  (/ai + a question summons six)" autocomplete="off" maxlength="500"><button type="submit">send</button></form>
<p style="opacity:.65;font-size:13px">real people, live ✦ public rooms are public — grab a private room for just ur people</p>
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
var privbar=document.getElementById('privbar');
function showPriv(){
  if(room.indexOf('p-')===0){
    privbar.style.display='block'; privbar.innerHTML='';
    var s=document.createElement('span'); s.textContent='🔒 private room · code: ';
    var c=document.createElement('b'); c.textContent=room.slice(2); c.style.fontSize='17px'; c.style.letterSpacing='2px';
    var t=document.createElement('span'); t.textContent=' — share it to invite ur people. history wipes itself right after everyone leaves ✦';
    privbar.appendChild(s); privbar.appendChild(c); privbar.appendChild(t);
  } else { privbar.style.display='none'; }
}
function goRoom(r){
  room=r;
  Array.prototype.forEach.call(document.querySelectorAll('.room'), function(b){ b.classList.toggle('on', b.getAttribute('data-room')===r); });
  msgsEl.innerHTML=''; lastTs=0; stopPoll();
  if(ws) try{ ws.close(); }catch(e){}
  try{ history.replaceState(null,'','/chat?room='+encodeURIComponent(r)); }catch(e){}
  showPriv(); connect();
}
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
  btn.addEventListener('click', function(){ goRoom(btn.getAttribute('data-room')); });
});
document.getElementById('mkpriv').addEventListener('click', function(){
  fetch('/chat/create-private', { method:'POST' }).then(function(r){ return r.json(); }).then(function(o){ if(o && o.room) goRoom(o.room); }).catch(function(){});
});
document.getElementById('joinpriv').addEventListener('click', function(){
  var c=(document.getElementById('joincode').value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  if(c.length>=4) goRoom('p-'+c.slice(0,12));
});
var startRoom='lobby';
try { startRoom=(new URLSearchParams(location.search).get('room')||'lobby').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,24)||'lobby'; } catch(e){}
if(startRoom!=='lobby'){ room=startRoom; Array.prototype.forEach.call(document.querySelectorAll('.room'), function(b){ b.classList.toggle('on', b.getAttribute('data-room')===startRoom); }); }
showPriv();
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>6ixNetworks</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style>
</head>
<body>${STAR_CANVAS}
  <h1>6ix<span>Networks</span></h1>
  
  <form action="/go" method="get">
    <input name="q" type="text" placeholder="search ✦" autocomplete="off" autofocus list="sg">
    <button type="submit">go</button>
  </form><datalist id="sg"></datalist>
  <div class="links">
    <a href="/go?q=https://www.google.com">google</a>
    <a href="/go?q=https://duckduckgo.com">duckduckgo</a>
    <a href="/go?q=https://www.wikipedia.org">wikipedia</a>
    <a href="/yt">youtube</a>
    <a href="/gs">games</a> <a href="/tools">tools</a> <a href="/chat">chat</a> <a href="/ai">ai ✦</a>
    <a href="/go?q=https://www.reddit.com">reddit</a>
    <a href="/go?q=https://www.coolmathgames.com">coolmath games</a>
  </div>
  ${CLOAK_BAR}<script src="/cloak.js"></script>

<script>
  // turn bare domains into https:// before submitting is handled server-side too
</script>
<script>
var qi=document.querySelector('input[name=q]'), sg=document.getElementById('sg'), sgt=null;
if(qi && sg){ qi.addEventListener('input', function(){ clearTimeout(sgt); var v=qi.value.trim(); if(v.length<2){ sg.innerHTML=''; return; } sgt=setTimeout(function(){ fetch('/suggest?q='+encodeURIComponent(v)).then(function(r){ return r.json(); }).then(function(list){ sg.innerHTML=''; (list||[]).forEach(function(s){ var o=document.createElement('option'); o.value=s; sg.appendChild(o); }); }).catch(function(){}); }, 160); }); }
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
async function handleProxy(req, res, targetUrlStr, gameMode) {
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
    // forward the browser's own fetch metadata when it sent any: an image
    // request has to look like an image request, a script like a script.
    // Forging one fixed shape for everything (the old way) is what made
    // image and captcha servers refuse to serve pictures.
    const fDest = req.headers['sec-fetch-dest'];
    const fMode = req.headers['sec-fetch-mode'];
    const fSite = req.headers['sec-fetch-site'];
  const headers = {
    'user-agent': BROWSER_UA,
    'accept': accept,
    'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': fDest || (isNav ? 'document' : 'empty'),
    'sec-fetch-mode': fMode || (isNav ? 'navigate' : 'cors'),
    'sec-fetch-site': fSite || 'none',
    'referer': proxyReferer(req.headers['referer'], target),
  };
  if (req.headers['sec-fetch-user']) headers['sec-fetch-user'] = req.headers['sec-fetch-user'];
  else if (isNav && !fDest) {
    headers['sec-fetch-user'] = '?1';
    headers['upgrade-insecure-requests'] = '1';
  }
  if (req.headers['range']) headers['range'] = req.headers['range'];
  if (req.headers['if-range']) headers['if-range'] = req.headers['if-range'];
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  // bing degrades search results when a request carries an established
  // cookie jar (it collapses the ranking to a single term while still
  // echoing the full query) — a fresh jar always gets the real results.
  // so bing search requests go out cookieless, always.
  const isBingSearch = /(^|\.)bing\.com$/i.test(target.hostname) && target.pathname.includes('/search');
  const upstreamCookies = isBingSearch ? '' : buildUpstreamCookies(req.headers['cookie'] || '', target.hostname);
  if (upstreamCookies) headers['cookie'] = upstreamCookies;

  const mirror = internalMirror(target);
  if (mirror) {
    res.writeHead(302, { location: mirror });
    return res.end();
  }
  const debinged = debingUrl(target);
  if (debinged) {
    res.writeHead(302, { location: proxied(debinged) });
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
  else if (isStaticAsset(target, ct || '')) outHeaders['cache-control'] = 'public, max-age=604800, immutable';
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
    if (isHtml && isNav && (status === 403 || status === 429 || CHAL_SIG.test(text.slice(0, 4000)))) {
      const relayed = await fetchViaRelay(target.toString());
      if (relayed) {
        let rw = rewriteHtml(relayed, target.toString());
        rw = injectProxyShim(rw, target.toString(), gameMode ? '/gproxy/' : '/browse/');
        const rb = Buffer.from(rw, 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': rb.length, 'x-6ixnetworks-route': 'relay' });
        return res.end(rb);
      }
      if (status !== 200) {
        const bp = Buffer.from(blockPage(target.toString()), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': bp.length });
        return res.end(bp);
      }
    }
    let rewritten = isHtml ? rewriteHtml(text, target.toString()) : rewriteCss(text, target.toString());
  if (isHtml) rewritten = injectProxyShim(rewritten, target.toString(), gameMode ? '/gproxy/' : '/browse/');
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
        const r = await fetchT(inst + '/api/v1/search?q=' + encodeURIComponent(query) + '&type=video', { headers: { 'user-agent': BROWSER_UA, 'accept': 'application/json' } }, 6000);
        if (!r.ok) continue;
        const j = await r.json();
        if (Array.isArray(j)) { const vids = j.filter(x => x && x.videoId && x.title); if (vids.length) return { inst, vids }; }
      } catch { /* next instance */ }
    }
    if (round === 0) await sleep(1200);
  }
  return null;
}
async function handleYtSearch(req, res, q) {
  const query = (q || '').trim();
  if (!query) { res.writeHead(302, { location: '/yt' }); return res.end(); }
  const pipedHit = await fetchPipedSearch(query);
  if (pipedHit) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(ytSearchPage(query, pipedHit)); }
  const apiHit = await fetchYtSearchApi(query);
  if (apiHit) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(ytSearchPage(query, apiHit)); }
  for (const inst of INVIDIOUS_INSTANCES) {
    try {
      const pageUrl = inst + '/search?q=' + encodeURIComponent(query);
      const r = await fetch(pageUrl, {
        headers: {
          'user-agent': BROWSER_UA,
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9',
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
  res.end('<!DOCTYPE html><body style="background:#070313;color:#f2f2f2;font-family:system-ui;padding:40px">all search instances are down rn — <a style="color:#c084fc" href="/yt/search?q=' + encodeURIComponent(query) + '">retry</a></body>');
}


// ---------- in-network youtube player (/yt/watch) ----------
// Data comes from an instance's API (fetched by this server), playback is
// an MSE player in our own page streaming both tracks through /gproxy —
// the browser never talks to youtube, an instance, or googlevideo.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fetchT = (url, opts, ms) => fetch(url, { ...(opts || {}), signal: AbortSignal.timeout(ms || 6000) });
// piped backend: its proxy serves muxed mp4 files whose bytes actually
// flow from datacenter IPs (for videos its extractor can still reach).
// invidious stays as the metadata/search fallback — its companion
// rejects datacenter playback requests outright ("URL has expired").
const PIPED_APIS = ['https://api.piped.private.coffee'];
const PIPED_INFO_CACHE = new Map();
async function fetchPipedStreams(id, bust) {
  if (!bust) { const c = PIPED_INFO_CACHE.get(id); if (c && Date.now() - c.at < 300e3) return c.hit; }
  for (const api of PIPED_APIS) {
    try {
      const r = await fetchT(api + '/streams/' + encodeURIComponent(id), { headers: { 'user-agent': BROWSER_UA, 'accept': 'application/json' } }, 7000);
      if (!r.ok) continue;
      const j = await r.json();
      if (j && (j.title || (j.videoStreams || []).length)) { const hit = { api, data: j }; PIPED_INFO_CACHE.set(id, { at: Date.now(), hit }); if (PIPED_INFO_CACHE.size > 60) PIPED_INFO_CACHE.delete(PIPED_INFO_CACHE.keys().next().value); return hit; }
    } catch { /* next backend */ }
  }
  return null;
}
function pickPipedFile(d) {
  const vs = (d.videoStreams || []).filter(s => s && s.url && !s.videoOnly && /video\/mp4/.test(s.mimeType || ''));
  const q = (s) => parseInt(s.quality, 10) || 0;
  vs.sort((a, b) => q(b) - q(a));
  return vs.find(s => q(s) > 0 && q(s) <= 720) || vs.find(s => q(s) > 0) || vs[0] || null;
}
async function fetchPipedSearch(query) {
  for (const api of PIPED_APIS) {
    try {
      const r = await fetchT(api + '/search?q=' + encodeURIComponent(query) + '&filter=videos', { headers: { 'user-agent': BROWSER_UA, 'accept': 'application/json' } }, 7000);
      if (!r.ok) continue;
      const j = await r.json();
      const items = ((j && j.items) || []).filter(x => x && x.url && x.title);
      if (items.length) {
        const vids = items.map(x => ({ videoId: (String(x.url).split('v=')[1] || '').split('&')[0], title: x.title, author: x.uploaderName || '', lengthSeconds: x.duration || 0, videoThumbnails: [{ url: x.thumbnail || '', width: 480 }] })).filter(v => v.videoId);
        if (vids.length) return { inst: api, vids };
      }
    } catch { /* next backend */ }
  }
  return null;
}
const YT_INFO_CACHE = new Map();
async function fetchVideoInfo(id, bust) {
  if (!bust) { const c = YT_INFO_CACHE.get(id); if (c && Date.now() - c.at < 300e3) return c.hit; }
  // instances flap (their youtube-bypass backends restart and 500 for a
  // few seconds), so sweep the list twice with a breath between rounds
  for (let round = 0; round < 2; round++) {
    for (const inst of INVIDIOUS_API_ORDER) {
      try {
        const r = await fetchT(inst + '/api/v1/videos/' + encodeURIComponent(id) + '?local=true', {
          headers: { 'user-agent': BROWSER_UA, 'accept': 'application/json' },
        }, 6000);
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
function ytWatchPage(id, hit, phit) {
  // stream mode is the primary player: a muxed mp4 file relayed through
  // /yt/stream (piped proxy first) — verified actually playing in a real
  // browser. youtube's embed is the manual backup: through the proxy it
  // renders black (and bare embed urls error 153 without a referer), so
  // it only loads when the user taps for it.
  const embedSrc = gproxied('https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0&playsinline=1');
  const progUrl = '/yt/stream?v=' + encodeURIComponent(id) + '&kind=p';
  let title = '', poster = '', recs = '';
  if (hit) {
    const d = hit.data;
    const abs = (u) => { try { return new URL(u, hit.inst).href; } catch { return u; } };
    const thumbs = (d.videoThumbnails || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0));
    title = d.title || '';
    poster = thumbs.length ? proxied(abs(thumbs[0].url)) : '';
    recs = (d.recommendedVideos || []).slice(0, 12).map(rv => {
      const t0 = (rv.videoThumbnails || [])[0];
      const img = t0 ? proxied(abs(t0.url)) : '';
      return `<a class="card" href="/yt/watch?v=${encodeURIComponent(rv.videoId)}">${img ? `<img loading="lazy" src="${img}" alt="">` : '<div class="noimg">✦</div>'}<div class="gt">${escHtml(rv.title || '')}</div></a>`;
    }).join('');
  } else if (phit) {
    const d = phit.data;
    title = d.title || '';
    poster = d.thumbnailUrl ? proxied(d.thumbnailUrl) : '';
    recs = (d.relatedStreams || []).slice(0, 12).map(rv => {
      const rid = (String(rv.url || '').split('v=')[1] || '').split('&')[0];
      if (!rid) return '';
      return `<a class="card" href="/yt/watch?v=${encodeURIComponent(rid)}">${rv.thumbnail ? `<img loading="lazy" src="${proxied(rv.thumbnail)}" alt="">` : '<div class="noimg">✦</div>'}<div class="gt">${escHtml(rv.title || '')}</div></a>`;
    }).join('');
  }
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(title || 'video')}</title>
${FONT_LINKS}<style>${GALAXY_CSS}</style></head><body>${STAR_CANVAS}
<div class="wrap">
<a class="back" href="/yt">← youtube</a>
<video id="vid" controls playsinline preload="auto" ${poster ? `poster="${poster}"` : ''} style="width:100%;border-radius:18px;background:#000;aspect-ratio:16/9;margin-top:12px"></video>
<iframe id="ytembed" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:18px;background:#000;margin-top:12px;display:none"></iframe>
<div style="display:flex;gap:8px;margin:12px 2px 4px;flex-wrap:wrap;align-items:center">
<button id="modeStream" style="background:rgba(124,58,237,.25);border:1px solid rgba(196,181,253,.45);color:#ece9ff;border-radius:999px;padding:8px 16px;cursor:pointer;font-weight:700">✦ stream mode</button>
<button id="modeEmbed" style="background:rgba(20,14,48,.92);border:1px solid rgba(196,181,253,.45);color:#ece9ff;border-radius:999px;padding:8px 16px;cursor:pointer;font-weight:700;opacity:.65">embed player</button>
<span id="ytstat" style="opacity:.75;font-size:13px">stream mode — the file itself, straight through the network</span>
</div>
<p style="margin:10px 2px 20px;font-weight:700">${escHtml(title || '')}</p>
<div id="ytretry" style="display:none;margin:0 2px 14px;background:rgba(20,14,48,.92);border:1px solid rgba(196,181,253,.45);color:#ece9ff;border-radius:999px;padding:10px 20px;cursor:pointer;font-weight:700;width:fit-content">✦ tap for a fresh route</div>
<div class="grid">${recs}</div>
${CLOAK_BAR}
</div>
<script src="/cloak.js"></script>
<script>
var EMBED=document.getElementById('ytembed'), VID=document.getElementById('vid'), STAT=document.getElementById('ytstat'), PILL=document.getElementById('ytretry');
var PROG=${JSON.stringify(progUrl)}, EMBEDSRC=${JSON.stringify(embedSrc)};
var mode='stream', retries=0, embedWatch=null, eChecks=0;
function setStat(t){ if(STAT) STAT.textContent=t; }
function tryPlay(){
  var p=VID.play();
  if(p && p.catch) p.catch(function(){ try{ VID.muted=true; var q=VID.play(); if(q && q.catch) q.catch(function(){}); }catch(e){} });
}
VID.src=PROG; tryPlay();
function toStream(){
  if(embedWatch){ clearInterval(embedWatch); embedWatch=null; }
  mode='stream';
  EMBED.style.display='none'; VID.style.display='block';
  if(!VID.getAttribute('src')){ VID.src=PROG; }
  tryPlay();
  setStat('stream mode — the file itself, straight through the network');
  document.getElementById('modeEmbed').style.opacity='.65';
  document.getElementById('modeStream').style.opacity='1';
}
function toEmbed(){
  mode='embed'; eChecks=0;
  try{ VID.pause(); }catch(e){}
  VID.style.display='none'; EMBED.style.display='block';
  if(!EMBED.getAttribute('src')) EMBED.src=EMBEDSRC;
  setStat('embed player — the normal youtube player, inside the network');
  document.getElementById('modeStream').style.opacity='.65';
  document.getElementById('modeEmbed').style.opacity='1';
  if(embedWatch) clearInterval(embedWatch);
  embedWatch=setInterval(function(){
    eChecks++;
    if(mode!=='embed'){ clearInterval(embedWatch); embedWatch=null; return; }
    if(eChecks>8){ clearInterval(embedWatch); embedWatch=null; setStat('embed still black… stream mode is the one that works — tap it'); return; }
    var doc=null;
    try{ doc=EMBED.contentWindow && EMBED.contentWindow.document; }catch(e){}
    if(!doc || !doc.body) return;
    var v=doc.querySelector('video');
    if(v && (v.readyState>=2 || v.currentTime>0)){ setStat('playing ✦'); clearInterval(embedWatch); embedWatch=null; return; }
    var t=(doc.body.innerText || '').toLowerCase();
    if(t.indexOf('video is unavailable')>=0 || t.indexOf('video unavailable')>=0 || t.indexOf('sign in')>=0 || t.indexOf('configuration error')>=0 || (t.indexOf('error')>=0 && t.indexOf('occurred')>=0)){
      clearInterval(embedWatch); embedWatch=null;
      setStat('the embed got refused — tap stream mode, that is the one that works');
    }
  }, 2500);
}
document.getElementById('modeStream').addEventListener('click', toStream);
document.getElementById('modeEmbed').addEventListener('click', toEmbed);
VID.addEventListener('error', function(){
  if(mode!=='stream') return;
  PILL.style.display='block';
  setStat('stream mode could not load this one — tap for a fresh route, or try another video');
}, true);
PILL.addEventListener('click', function(){
  retries++;
  PILL.style.display='none';
  if(retries>2){ location.reload(); return; }
  setStat('getting a fresh route…');
  VID.src=PROG + '&fresh=1&n=' + retries;
  tryPlay();
});
setTimeout(function(){
  if(mode==='stream' && VID.readyState<2 && !VID.error){ PILL.style.display='block'; setStat('still loading… tap for a fresh route, or pick another video'); }
}, 14000);
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

// ---------- server ----------

// ---------- chatroom (node) + six ai ----------
function cleanRoom(r) { r = String(r || 'lobby').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24); return r || 'lobby'; }
function sixMessages(list) {
  const out = [];
  if (Array.isArray(list)) for (const m of list.slice(-10)) {
    if (m && (m.role === 'user' || m.role === 'assistant')) out.push({ role: m.role, content: String(m.content || '').slice(0, 1000) });
  }
  return out.length ? out : [{ role: 'user', content: 'hi' }];
}
async function askSix(messages) {
  return 'six only wakes up on the cloudflare build ✦ this copy cant reach him — try s.usareme.site';
}
async function askSixAnswer(q) {
  const t = await askSix([{ role: 'user', content: q }]);
  if (!t || t.includes('only wakes up') || t.includes('unreachable')) return null;
  return String(t).trim().slice(0, 500) || null;
}
const crypto = require('crypto');
const CHAT_ROOMS = new Map();
function chatRoomOf(name) { if (!CHAT_ROOMS.has(name)) CHAT_ROOMS.set(name, { msgs: [], socks: new Set(), pollAct: 0, wipeTimer: null }); return CHAT_ROOMS.get(name); }
function wsEncode(str) {
  const p = Buffer.from(str, 'utf8'); const len = p.length; let h;
  if (len < 126) { h = Buffer.from([0x81, len]); }
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([h, p]);
}
function chatBroadcast(room, obj) { const data = wsEncode(JSON.stringify(obj)); for (const sk of room.socks) { try { sk.write(data); } catch {} } }
function chatPost(roomName, msg) { const room = chatRoomOf(roomName); room.msgs.push(msg); room.msgs = room.msgs.slice(-60); chatBroadcast(room, { type: 'msg', msg }); return msg; }
function chatPresence(roomName) { const room = chatRoomOf(roomName); chatBroadcast(room, { type: 'presence', n: room.socks.size }); }
function readJsonBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 32768) { try { req.destroy(); } catch {} } });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function chatUpgrade(req, socket) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/chat/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const roomName = cleanRoom(u.searchParams.get('room'));
  const name = cleanName(u.searchParams.get('name'));
  const room = chatRoomOf(roomName);
  room.socks.add(socket);
  if (room.wipeTimer) { clearTimeout(room.wipeTimer); room.wipeTimer = null; }
  try { socket.write(wsEncode(JSON.stringify({ type: 'history', msgs: room.msgs.slice(-50) }))); } catch {}
  chatBroadcast(room, { type: 'sys', text: name + ' slid in ✦' });
  chatPresence(roomName);
  let buf = Buffer.alloc(0); let last = 0; let dead = false;
  const cleanup = () => { if (dead) return; dead = true; room.socks.delete(socket); chatBroadcast(room, { type: 'sys', text: name + ' dipped' }); chatPresence(roomName);
    if (roomName.startsWith('p-') && room.socks.size === 0) { if (room.wipeTimer) clearTimeout(room.wipeTimer); room.wipeTimer = setTimeout(() => { if (room.socks.size === 0 && (!room.pollAct || Date.now() - room.pollAct > 12000)) { room.msgs = []; CHAT_ROOMS.delete(roomName); } }, 20000); }
  };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1]; const op = b0 & 15; const masked = !!(b1 & 128);
      let len = b1 & 127; let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off; if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.slice(off, off + len);
      if (masked) { const mask = buf.slice(maskOff, maskOff + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
      buf = buf.slice(off + len);
      if (op === 8) { try { socket.end(); } catch {} cleanup(); return; }
      if (op === 9) { if (payload.length <= 125) { try { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); } catch {} } continue; }
      if (op !== 1) continue;
      const now = Date.now(); if (now - last < 300) continue; last = now;
      let b = {}; try { b = JSON.parse(payload.toString('utf8')); } catch { continue; }
      const text = cleanText(b.text); if (!text) continue;
      chatPost(roomName, { name, text, ts: now, bot: false });
    }
  });
  socket.on('close', cleanup);
  socket.on('error', cleanup);
  socket.on('end', () => { cleanup(); try { socket.end(); } catch {} });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(shellPage(null));
  }
  if (u.pathname === '/home') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(HOME);
  }  if (u.pathname === '/stars.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(STARS_JS);
  }
  if (u.pathname === '/shell') {
    const servers = u.searchParams.has('ext') ? ['https://s.usareme.site/', 'https://sixsearch.deionmont1.workers.dev/'] : null;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(shellPage(servers));
  }
    if (u.pathname === '/tools') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(toolsPage());
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
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' });
    return res.end(JSON.stringify(out));
  }
  if (u.pathname === '/cloak.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(CLOAK_JS);
  }
  if (u.pathname === '/chat') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(chatPage());
  }
  if (u.pathname === '/ai') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(aiPage());
  }
  if (u.pathname === '/ai/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ binding: false, note: 'node build — six lives on the cloudflare build' }));
  }
  if (u.pathname === '/ai/answer') {
    const q = (u.searchParams.get('q') || '').trim().slice(0, 200);
    const answer = q ? await askSixAnswer(q) : null;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' });
    return res.end(JSON.stringify({ answer }));
  }
  if (u.pathname === '/ai/summarize') {
    const s = await summarizeUrl(null, u.searchParams.get('u') || '');
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ summary: s }));
  }
  if (u.pathname === '/ai/ask' && req.method === 'POST') {
    const b = await readJsonBody(req);
    const text = await askSix(sixMessages(b.messages));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ text }));
  }
  if (u.pathname === '/ai/room' && req.method === 'POST') {
    const b = await readJsonBody(req);
    const q = cleanText(b.question).slice(0, 300);
    const roomName = cleanRoom(b.room);
    if (q) {
      chatPost(roomName, { name: cleanName(b.name), text: q, ts: Date.now(), bot: false });
      const ans = await askSix([{ role: 'user', content: q }]);
      chatPost(roomName, { name: 'six ✦ ai', text: ans, ts: Date.now(), bot: true });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }
  if (u.pathname === '/chat/create-private' && req.method === 'POST') {
    const code = privCode();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ room: 'p-' + code, code }));
  }
  if (u.pathname === '/chat/send' && req.method === 'POST') {
    const b = await readJsonBody(req);
    const text = cleanText(b.text);
    if (text) { const rn = cleanRoom(b.room); chatPost(rn, { name: cleanName(b.name), text, ts: Date.now(), bot: false }); chatRoomOf(rn).pollAct = Date.now(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }
  if (u.pathname === '/chat/poll') {
    const room = chatRoomOf(cleanRoom(u.searchParams.get('room')));
    if (cleanRoom(u.searchParams.get('room')).startsWith('p-') && room.socks.size === 0 && room.msgs.length && room.pollAct && Date.now() - room.pollAct > 90000) room.msgs = [];
    room.pollAct = Date.now();
    const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;
    const msgs = since > 0 ? room.msgs.filter(m => m.ts > since) : room.msgs.slice(-50);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ msgs, n: room.socks.size }));
  }
  if (u.pathname === '/emu') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(emuPage());
  }
  if (u.pathname === '/gs') {
    const games = await loadGames();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(gamesPage(FEATURED_GAMES.concat(games)));
  }
  if (u.pathname === '/play') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(playPage(u.searchParams.get('u') || '', u.searchParams.get('t') || 'Game'));
  }
  if (u.pathname === '/yt') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(YT_HOME);
  }
  if (u.pathname === '/yt/watch') {
    const vidId = (u.searchParams.get('v') || '').trim();
    if (!vidId) { res.writeHead(302, { location: '/yt' }); return res.end(); }
    // metadata is decoration now (title, poster, up next) — the embed
    // player does not need it, so a dead metadata backend no longer
    // kills the watch page; it renders with whatever resolved
    const hit = await fetchVideoInfo(vidId);
    const phit = hit ? null : await fetchPipedStreams(vidId);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(ytWatchPage(vidId, hit, phit));
  }
  if (u.pathname === '/yt/stream') {
    const vidId = (u.searchParams.get('v') || '').trim();
    const kind = u.searchParams.get('kind') || 'v';
    if (!vidId) { res.writeHead(502); return res.end('stream unavailable'); }
    const range = req.headers['range'];
    if (kind === 'p') {
      // direct-file playback: a muxed mp4 whose bytes actually flow.
      // piped's proxy first (its extractor flaps per video, so a
      // failed fetch earns one fresh re-resolve), invidious
      // progressive (below) as the last resort
      const wantFresh = u.searchParams.get('fresh') === '1';
      for (let round = 0; round < 2; round++) {
        const ph = await fetchPipedStreams(vidId, wantFresh || round === 1);
        const pf = ph ? pickPipedFile(ph.data) : null;
        if (!pf) break;
        try {
          const up = await fetch(pf.url, { headers: { 'user-agent': BROWSER_UA, ...(range ? { range } : {}) } });
          if (up.status === 200 || up.status === 206) {
            const hh = {};
            for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) hh[h] = v; }
            res.writeHead(up.status, hh);
            if (up.body) { const reader = up.body.getReader(); while (true) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); } }
            return res.end();
          }
        } catch { /* retry fresh once, then fall through */ }
      }
    }
    let hit = await fetchVideoInfo(vidId);
    for (let attempt = 0; attempt < 2; attempt++) {
      const fmt = hit ? pickStreams(hit.data)[kind] : null;
      if (!fmt) break;
      let absUrl; try { absUrl = new URL(fmt.url, hit.inst).href; } catch { absUrl = fmt.url; }
      try {
        const up = await fetch(absUrl, { headers: { 'user-agent': BROWSER_UA, ...(range ? { range } : {}) } });
        if ((up.status === 403 || up.status === 500 || up.status === 502) && attempt === 0) { hit = await fetchVideoInfo(vidId, true); continue; }
        const hh = {};
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) hh[h] = v; }
        res.writeHead(up.status, hh);
        if (up.body) { const reader = up.body.getReader(); while (true) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); } }
        return res.end();
      } catch { if (attempt === 0) { hit = await fetchVideoInfo(vidId, true); continue; } }
    }
    res.writeHead(502); return res.end('stream unavailable');
  }
  if (u.pathname === '/yt/search') {
    return handleYtSearch(req, res, u.searchParams.get('q') || '');
  }
  if (u.pathname === '/go') {
    const dest = normalizeInput(u.searchParams.get('q') || '');
    if (!dest) { res.writeHead(302, { location: '/home' }); return res.end(); }
    res.writeHead(302, { location: proxied(dest) });
    return res.end();
  }
  if (u.pathname.startsWith('/px/')) {
    const rest = u.pathname.slice('/px/'.length);
    const slash = rest.indexOf('/');
    let base = null;
    if (slash > 0) { try { base = b64urlDecode(rest.slice(0, slash)); } catch {} }
    if (!base || !/^https:\/\//i.test(base)) { res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('bad prefix path'); }
    if (!base.endsWith('/')) base += '/';
    let targetStr = base + rest.slice(slash + 1);
    if (u.search) targetStr += u.search;
    return handleProxy(req, res, targetStr, false);
  }
  if (u.pathname.startsWith('/gproxy/')) {
    const encoded = u.pathname.slice('/gproxy/'.length);
    let targetStr;
    try { targetStr = b64urlDecode(encoded); } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad proxy path');
    }
    if (u.search) targetStr += (targetStr.includes('?') ? '&' : '?') + u.search.slice(1);
    return handleProxy(req, res, targetStr, true);
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

server.on('upgrade', chatUpgrade);
server.listen(PORT, () => console.log('web proxy listening on ' + PORT));
