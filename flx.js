/* ===== FLX — sixflix resolvers + HLS relay + player ===== */
const FLX = (() => {
  const { execFile } = require('child_process');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  const ENCDEC = 'https://enc-dec.app/api';
  const SRC_TTL = 8 * 60 * 1000;
  const CURL = process.env.FLX_CURL !== '0';
  const srcCache = new Map();
  const jar = new Map();

  const b64e = (s) => Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const now = () => Date.now();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const send = (res, code, type, body, extra) => {
    res.writeHead(code, Object.assign({ 'content-type': type, 'access-control-allow-origin': '*' }, extra || {}));
    res.end(body);
  };
  const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

  function privHost(h) {
    if (!h) return true;
    if (h === 'localhost' || h.endsWith('.local')) return true;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^\[?::1\]?$/.test(h) || h === '::') return true;
    return false;
  }

  function curlRun(url, opts) {
    return new Promise((resolve, reject) => {
      const args = ['-sS', '-L', '--max-time', String(Math.ceil((opts.ms || 12000) / 1000)), '-A', opts.headers['user-agent'] || UA, '-o', '-', '-w', '\n__FLX_STATUS__%{http_code}'];
      for (const [k, v] of Object.entries(opts.headers)) {
        if (k.toLowerCase() === 'user-agent' || v == null) continue;
        args.push('-H', k + ': ' + v);
      }
      if (opts.method && opts.method !== 'GET') args.push('-X', opts.method);
      if (opts.body != null) args.push('--data-binary', opts.body);
      args.push(url);
      execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) return reject(err);
        const m = /\n__FLX_STATUS__(\d+)$/.exec(stdout);
        const status = m ? parseInt(m[1], 10) : 0;
        const body = m ? stdout.slice(0, m.index) : stdout;
        resolve({ status, headers: {}, buf: Buffer.from(body, 'utf8'), text: body });
      });
    });
  }

  async function req2(url, opts = {}) {
    const o = {
      method: opts.method || 'GET',
      headers: Object.assign({ 'user-agent': UA, accept: '*/*', 'accept-encoding': 'identity' }, opts.headers || {}),
      ms: opts.ms || 12000,
      body: opts.body
    };
    let r, buf;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), o.ms);
      r = await fetch(url, { method: o.method, headers: o.headers, body: o.body, redirect: 'follow', signal: ac.signal });
      buf = Buffer.from(await r.arrayBuffer());
      clearTimeout(t);
    } catch (e) {
      if (!CURL || opts.noCurl) throw e;
      return curlRun(url, o);
    }
    if (CURL && !opts.noCurl && (r.status === 403 || r.status === 429 || r.status === 503)) {
      const c = await curlRun(url, o).catch(() => null);
      if (c && c.status && c.status < 400) return c;
    }
    return { status: r.status, headers: r.headers, buf, text: buf.toString('utf8') };
  }

  function jarHost(h) { return jar.get(h) || ''; }
  function jarSave(h, setCookies) {
    if (!setCookies || !setCookies.length) return;
    const pairs = setCookies.map(c => String(c).split(';')[0]).filter(Boolean);
    if (!pairs.length) return;
    const cur = jar.get(h) || '';
    const merged = new Map();
    for (const p of (cur + '; ' + pairs.join('; ')).split(';')) {
      const kv = p.trim(); if (!kv) continue;
      merged.set(kv.split('=')[0], kv);
    }
    jar.set(h, [...merged.values()].join('; '));
  }

  function unwrap(url) {
    try {
      const u = new URL(url);
      const inner = u.searchParams.get('url') || u.searchParams.get('u');
      if (/m3u8-proxy|proxy\/m3u8|master\.m3u8/.test(u.pathname + u.search) && inner) {
        const dec = decodeURIComponent(inner);
        if (/^https?:\/\//.test(dec)) return dec;
      }
    } catch {}
    return url;
  }

  async function meta(tmdb, type) {
    const key = process.env.TMDB_KEY || process.env.TMDB_API_KEY || process.env.TMDB_READ_TOKEN;
    const out = { title: '', year: '', imdb: '' };
    if (!key) return out;
    const bearer = key.startsWith('eyJ');
    const q = bearer ? '?' : '?api_key=' + encodeURIComponent(key) + '&';
    const h = bearer ? { authorization: 'Bearer ' + key } : {};
    const base = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + encodeURIComponent(tmdb);
    const r = await req2(base + q + 'append_to_response=external_ids', { headers: h, noCurl: true }).catch(() => null);
    if (!r || r.status !== 200) return out;
    let j; try { j = JSON.parse(r.text); } catch { return out; }
    out.title = j.title || j.name || '';
    out.year = String(j.release_date || j.first_air_date || '').slice(0, 4);
    out.imdb = (j.external_ids && j.external_ids.imdb_id) || j.imdb_id || '';
    return out;
  }

  async function pVidlink(tmdb, type, s, e) {
    const enc = await req2(ENCDEC + '/enc-vidlink?text=' + encodeURIComponent(tmdb), { headers: { origin: 'https://vidlink.pro', referer: 'https://vidlink.pro/' } });
    const ej = JSON.parse(enc.text);
    if (ej.status !== 200) throw new Error('vidlink enc ' + ej.status);
    const path = type === 'tv' ? `tv/${ej.result}/${s}/${e}` : `movie/${ej.result}`;
    const r = await req2('https://vidlink.pro/api/b/' + path, { headers: { origin: 'https://vidlink.pro', referer: 'https://vidlink.pro/' } });
    if (r.status !== 200) throw new Error('vidlink ' + r.status);
    const j = JSON.parse(r.text);
    const url = unwrap(j.stream && (j.stream.playlist || j.stream.url) || j.playlist || j.url || '');
    if (!url) throw new Error('vidlink no source');
    const subs = (j.stream && j.stream.captions) || j.captions || [];
    return { url, subs: subs.map(c => ({ lang: c.language || c.lang || 'en', url: c.url || c.file })), referer: 'https://vidlink.pro/' };
  }

  async function pVideasy(tmdb, type, s, e, m) {
    const H = { origin: 'https://vidy.st', referer: 'https://vidy.st/' };
    const seedR = await req2('https://api.wecollege.net/seed?mediaId=' + encodeURIComponent(tmdb), { headers: H });
    const seed = JSON.parse(seedR.text).seed;
    const title = encodeURIComponent(encodeURIComponent(m.title || ''));
    let q = `?title=${title}&mediaType=${type}&year=${m.year || ''}&tmdbId=${tmdb}&imdbId=${m.imdb || ''}&enc=2&seed=${encodeURIComponent(seed)}`;
    if (type === 'tv') q += `&seasonId=${s}&episodeId=${e}`;
    const encR = await req2('https://api.wecollege.net/miami/sources' + q, { headers: H });
    const dec = await req2(ENCDEC + '/dec-videasy', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, H),
      body: JSON.stringify({ text: encR.text, id: tmdb, seed })
    });
    const dj = JSON.parse(dec.text);
    if (dj.status !== 200) throw new Error('videasy dec ' + dj.status);
    const srcs = dj.result.sources || dj.result;
    const pick = (Array.isArray(srcs) ? srcs : []).find(x => /m3u8|hls/i.test(x.url || x.file || '')) || (Array.isArray(srcs) ? srcs[0] : null);
    if (!pick) throw new Error('videasy no source');
    const subs = (dj.result.subtitles || dj.result.subs || []).map(c => ({ lang: c.language || c.lang || 'en', url: c.url || c.file }));
    return { url: unwrap(pick.url || pick.file), subs, referer: 'https://vidy.st/' };
  }

  async function pVidfast(tmdb, type, s, e) {
    const H = { referer: 'https://vidfast.vc/', origin: 'https://vidfast.vc', 'x-requested-with': 'XMLHttpRequest' };
    const page = type === 'tv' ? `https://vidfast.vc/tv/${tmdb}/${s}/${e}/` : `https://vidfast.vc/movie/${tmdb}`;
    const pr = await req2(page, { headers: { referer: 'https://vidfast.vc/' } });
    const mm = /\\"(?:en|token)\\":\\"(.*?)\\"/.exec(pr.text);
    if (!mm) throw new Error('vidfast no token');
    const s1r = await req2(ENCDEC + '/enc-vidfast?text=' + encodeURIComponent(mm[1]) + '&stage=1', { headers: H });
    const s1 = JSON.parse(s1r.text);
    if (s1.status !== 200) throw new Error('vidfast stage1 ' + s1.status);
    const h1 = Object.assign({}, H, { 'x-csrf-token': s1.result.token });
    const post1 = await req2(s1.result.stage1, { method: 'POST', headers: h1, body: '' });
    const s2r = await req2(ENCDEC + '/enc-vidfast?text=' + encodeURIComponent(post1.text) + '&stage=2', { headers: H });
    const s2 = JSON.parse(s2r.text);
    if (s2.status !== 200) throw new Error('vidfast stage2 ' + s2.status);
    const h2 = Object.assign({}, H, { 'x-csrf-token': s2.result.token });
    const srv = await req2(s2.result.servers, { method: 'POST', headers: h2, body: '' });
    const dec1 = await req2(ENCDEC + '/dec-vidfast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: srv.text }) });
    const d1 = JSON.parse(dec1.text);
    if (d1.status !== 200) throw new Error('vidfast servers ' + d1.status);
    const list = Array.isArray(d1.result) ? d1.result : [];
    if (!list.length) throw new Error('vidfast no servers');
    const st = await req2(s2.result.stream + '/' + list[0].data, { method: 'POST', headers: h2, body: '' });
    const dec2 = await req2(ENCDEC + '/dec-vidfast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: st.text }) });
    const d2 = JSON.parse(dec2.text);
    if (d2.status !== 200) throw new Error('vidfast stream ' + d2.status);
    const out = d2.result;
    const url = unwrap(typeof out === 'string' ? out : (out.url || out.file || (out.sources && out.sources[0] && out.sources[0].url) || ''));
    if (!url) throw new Error('vidfast no source');
    const subs = (out.subtitles || out.subs || []).map(c => ({ lang: c.language || c.lang || 'en', url: c.url || c.file }));
    return { url, subs, referer: 'https://vidfast.vc/' };
  }

  const PROV = {
    vidlink: { run: pVidlink, iframe: (t, ty, s, e) => `https://vidlink.pro/${ty}/${t}${ty === 'tv' ? `/${s}/${e}` : ''}` },
    videasy: { run: pVideasy, iframe: (t, ty, s, e) => `https://player.videasy.net/${ty}/${t}${ty === 'tv' ? `/${s}/${e}` : ''}` },
    vidfast: { run: pVidfast, iframe: (t, ty, s, e) => `https://vidfast.vc/${ty}/${t}${ty === 'tv' ? `/${s}/${e}` : ''}` }
  };

  async function drm(url, referer) {
    const r = await req2(url, { headers: referer ? { referer } : {} }).catch(() => null);
    if (!r || r.status !== 200) return { drm: false, manifest: '' };
    const t = r.text.slice(0, 20000);
    const widevine = /com\.widevine|urn:uuid:edef8ba9|SAMPLE-AES-CTR/i.test(t);
    return { drm: widevine, manifest: t };
  }

  async function resolve(tmdb, type, s, e, provider, overrides) {
    const key = [tmdb, type, s, e, provider].join('|');
    const hit = srcCache.get(key);
    if (hit && now() - hit.at < SRC_TTL) return hit.val;

    const order = provider && PROV[provider] ? [provider] : ['vidlink', 'videasy', 'vidfast'];
    const m = { title: overrides.title || '', year: overrides.year || '', imdb: overrides.imdb || '' };
    if (!m.title) {
      const fetched = await meta(tmdb, type).catch(() => null);
      if (fetched) Object.assign(m, fetched);
    }
    const errors = [];
    for (const name of order) {
      try {
        const got = await PROV[name].run(tmdb, type, s, e, m);
        const probe = await drm(got.url, got.referer);
        const val = { provider: name, url: got.url, subs: got.subs || [], referer: got.referer, drm: probe.drm, iframe: PROV[name].iframe(tmdb, type, s, e) };
        srcCache.set(key, { at: now(), val });
        return val;
      } catch (err) {
        errors.push(name + ': ' + err.message);
        await sleep(120);
      }
    }
    return { provider: 'iframe', url: '', subs: [], drm: false, iframe: PROV[order[0]].iframe(tmdb, type, s, e), errors };
  }

  function rewriteManifest(body, base, ref) {
    const wrap = (abs) => '/flx/relay?u=' + b64e(abs) + (ref ? '&r=' + encodeURIComponent(ref) : '');
    const out = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) { out.push(raw); continue; }
      if (line.startsWith('#')) {
        out.push(raw.replace(/URI="([^"]+)"/g, (mm, uri) => {
          try { return 'URI="' + wrap(new URL(uri, base).href) + '"'; } catch { return mm; }
        }));
        continue;
      }
      try { out.push(wrap(new URL(line, base).href)); } catch { out.push(line); }
    }
    return out.join('\n');
  }

  async function relay(req, res, u) {
    const target = b64d(u.searchParams.get('u') || '');
    let t;
    try { t = new URL(target); } catch { return send(res, 400, 'text/plain', 'bad u'); }
    if (privHost(t.hostname) && !process.env.FLX_ALLOW_PRIVATE) return send(res, 403, 'text/plain', 'private host');
    const ref = u.searchParams.get('r') || '';
    const h = { 'user-agent': UA, accept: '*/*', 'accept-encoding': 'identity' };
    if (ref) { h.referer = ref; try { h.origin = new URL(ref).origin; } catch {} }
    const ck = jarHost(t.hostname);
    if (ck) h.cookie = ck;
    if (req.headers.range) h.range = req.headers.range;
    if (req.headers['if-none-match']) h['if-none-match'] = req.headers['if-none-match'];

    const r = await req2(t.href, { headers: h, ms: 20000 }).catch(e => ({ status: 502, headers: {}, buf: Buffer.from('upstream ' + e.message), text: '' }));
    if (r.status >= 400) return send(res, r.status, 'text/plain', r.buf);

    jarSave(t.hostname, r.headers.getSetCookie ? r.headers.getSetCookie() : []);
    const ct = (r.headers.get && r.headers.get('content-type')) || '';
    const isMan = /mpegurl/i.test(ct) || /^#EXTM3U/.test(r.text.slice(0, 16));

    if (isMan) {
      const body = rewriteManifest(r.text, t.href, ref || t.origin);
      return send(res, 200, 'application/vnd.apple.mpegurl', body, { 'cache-control': 'no-store' });
    }
    const out = { 'cache-control': 'public, max-age=3600' };
    const cr = r.headers.get && r.headers.get('content-range');
    const cl = r.headers.get && r.headers.get('content-length');
    if (cr) out['content-range'] = cr;
    if (cl) out['content-length'] = cl;
    if (ct) out['content-type'] = ct;
    res.writeHead(r.status, Object.assign({ 'access-control-allow-origin': '*' }, out));
    res.end(r.buf);
  }

  function srtToVtt(s) {
    const blocks = s.replace(/\r/g, '').replace(/^\uFEFF/, '').split(/\n{2,}/);
    const out = ['WEBVTT', ''];
    for (let b of blocks) {
      b = b.trim(); if (!b) continue;
      const lines = b.split('\n');
      if (/^\d+$/.test(lines[0].trim())) lines.shift();
      out.push(lines.join('\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'), '');
    }
    return out.join('\n');
  }

  async function subs(res, u) {
    const target = b64d(u.searchParams.get('u') || '');
    let t; try { t = new URL(target); } catch { return send(res, 400, 'text/plain', 'bad u'); }
    const ref = u.searchParams.get('r') || '';
    const r = await req2(t.href, { headers: Object.assign({ 'user-agent': UA }, ref ? { referer: ref } : {}) }).catch(() => null);
    if (!r || r.status !== 200) return send(res, 502, 'text/plain', 'sub fetch failed');
    let body = r.text.replace(/^\uFEFF/, '');
    if (!/^WEBVTT/.test(body)) body = srtToVtt(body);
    return send(res, 200, 'text/vtt; charset=utf-8', body, { 'cache-control': 'public, max-age=3600' });
  }

  function page(q) {
    const id = q.get('id') || '';
    const type = q.get('type') === 'tv' ? 'tv' : 'movie';
    const s = q.get('s') || '1', e = q.get('e') || '1';
    const title = q.get('title') || '';
    const qs = `id=${encodeURIComponent(id)}&type=${type}&s=${s}&e=${e}` + (title ? '&title=' + encodeURIComponent(title) : '');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title ? title.replace(/[<>&]/g, '') + ' — ' : ''}flx</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#08080b;color:#e9e9ef;font:14px/1.5 system-ui,sans-serif}
#wrap{display:flex;flex-direction:column;height:100%}
#bar{display:flex;gap:6px;align-items:center;padding:8px 10px;background:#101016;border-bottom:1px solid #1e1e28;flex-wrap:wrap}
#bar b{font-weight:600;margin-right:auto;opacity:.85;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button{background:#1b1b26;color:#d6d6e2;border:1px solid #2a2a38;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit}
button.on{background:#3d6bff;border-color:#3d6bff;color:#fff}
#stage{flex:1;background:#000;display:flex;align-items:center;justify-content:center;position:relative}
video{width:100%;height:100%;background:#000}
#msg{padding:26px;text-align:center;opacity:.7;font-size:13px}
iframe{width:100%;height:100%;border:0}
</style></head><body><div id="wrap">
<div id="bar"><b>${title || id}</b>
<button data-p="vidlink">vidlink</button><button data-p="videasy">videasy</button><button data-p="vidfast">vidfast</button>
<button id="ifs">iframe</button></div>
<div id="stage"><div id="msg">resolving…</div></div></div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>
<script>
const QS='${qs}', stage=document.getElementById('stage');
let hls=null, cur=null;
function clear(){ if(hls){hls.destroy();hls=null;} stage.innerHTML=''; }
function msg(t){ clear(); stage.innerHTML='<div id="msg"></div>'; document.getElementById('msg').textContent=t; }
function mkVideo(){ const v=document.createElement('video'); v.controls=true; v.autoplay=true; v.playsInline=true; stage.appendChild(v); return v; }
async function load(p){
  document.querySelectorAll('button[data-p]').forEach(b=>b.classList.toggle('on', b.dataset.p===p));
  document.getElementById('ifs').classList.remove('on');
  msg('resolving '+p+'…');
  let j;
  try { const r=await fetch('/api/flx/play?'+QS+'&provider='+p); j=await r.json(); }
  catch(err){ return msg('request failed'); }
  if(!j.ok || !j.url) return msg((j.errors||[]).join(' · ') || 'no source from '+p);
  if(j.drm) return frame(j.iframe, 'widevine — iframe');
  cur=j;
  const src='/flx/relay?u='+encodeURIComponent(j.relay)+'&r='+encodeURIComponent(j.referer||'');
  const v=mkVideo();
  if(v.canPlayType('application/vnd.apple.mpegurl')){ v.src=src; }
  else if(window.Hls&&Hls.isSupported()){
    hls=new Hls({maxBufferLength:40}); hls.loadSource(src); hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED,()=>{ v.play().catch(()=>{}); });
    hls.on(Hls.Events.ERROR,(_,d)=>{ if(d.fatal) msg('stream error: '+d.details); });
  } else v.src=src;
  (j.subs||[]).forEach((c,i)=>{
    const t=document.createElement('track');
    t.kind='subtitles'; t.label=c.lang||('sub'+(i+1)); t.srclang=(c.lang||'en').slice(0,2);
    t.src='/flx/subs?u='+encodeURIComponent(btoa(c.url).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''))+'&r='+encodeURIComponent(j.referer||'');
    v.appendChild(t);
  });
}
function frame(u,why){
  clear(); const f=document.createElement('iframe');
  f.src=u; f.allow='autoplay; fullscreen; encrypted-media'; f.allowFullscreen=true;
  stage.appendChild(f);
  document.querySelectorAll('button[data-p]').forEach(b=>b.classList.remove('on'));
  document.getElementById('ifs').classList.add('on');
  if(why) console.log(why);
}
document.querySelectorAll('button[data-p]').forEach(b=>b.onclick=()=>load(b.dataset.p));
document.getElementById('ifs').onclick=async()=>{
  const r=await fetch('/api/flx/play?'+QS).catch(()=>null);
  const j=r?await r.json().catch(()=>null):null;
  frame(j&&j.iframe||'/flx/embeds?'+QS, 'manual');
};
load('vidlink');
</script></body></html>`;
  }

  async function handle(req, res, u) {
    const p = u.pathname;
    if (p === '/flx/relay') { await relay(req, res, u); return true; }
    if (p === '/flx/subs') { await subs(res, u); return true; }
    if (p === '/flx/watch') { send(res, 200, 'text/html; charset=utf-8', page(u.searchParams)); return true; }

    if (p === '/api/flx/health') {
      json(res, 200, {
        ok: true, curl: CURL, tmdb: !!(process.env.TMDB_KEY || process.env.TMDB_API_KEY || process.env.TMDB_READ_TOKEN),
        providers: Object.keys(PROV), cached: srcCache.size, uptime: Math.round(process.uptime())
      });
      return true;
    }

    if (p === '/api/flx/embeds') {
      const q = u.searchParams, id = q.get('id') || '', type = q.get('type') === 'tv' ? 'tv' : 'movie';
      json(res, 200, { embeds: Object.entries(PROV).map(([k, v]) => ({ provider: k, url: v.iframe(id, type, q.get('s') || 1, q.get('e') || 1) })) });
      return true;
    }

    if (p === '/api/flx/resolve' || p === '/api/flx/play') {
      const q = u.searchParams;
      const id = q.get('id') || q.get('tmdb');
      if (!id || !/^\d+$/.test(id)) { json(res, 400, { ok: false, error: 'id must be a numeric tmdb id' }); return true; }
      const type = q.get('type') === 'tv' ? 'tv' : 'movie';
      const s = q.get('s') || q.get('season') || '1';
      const e = q.get('e') || q.get('episode') || '1';
      const out = await resolve(id, type, s, e, q.get('provider'), { title: q.get('title') || '', year: q.get('year') || '', imdb: q.get('imdb') || '' });
      const ok = !!out.url && !out.drm;
      if (p === '/api/flx/resolve') { json(res, ok ? 200 : 502, Object.assign({ ok }, out)); return true; }
      json(res, ok ? 200 : 502, Object.assign({ ok }, out, { relay: out.url ? b64e(out.url) : '' }));
      return true;
    }

    return false;
  }

  return { handle, resolve, PROV };
})();
/* ===== /FLX ===== */