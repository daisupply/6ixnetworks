// 6ixNetworks "six is asleep" fallback — Cloudflare Worker.
//
// WHY: the site lives on Deion's PC. When the PC is off/asleep, the tunnel is
// down and Cloudflare shows its raw error page. This worker sits in front of
// the tunnel: it passes every request through, and when the origin answers
// with a tunnel error (502/503/504/530) or the fetch fails, it serves the
// asleep page instead.
//
// DEPLOY (one time, ~2 min, in the Cloudflare dashboard):
//   1. Workers & Pages -> Create -> Worker -> name it "six-asleep" -> Deploy.
//   2. Edit code -> delete the starter code -> paste this whole file -> Deploy.
//   3. Settings -> Domains & Routes -> Add route:  *.usareme.site/*
//      and another route: usareme.site/*
//   (Free tier allows 100k worker requests/day — plenty for this site.)
//
// The page auto-refreshes every 30s, so the moment the PC wakes up and the
// tunnel reconnects, visitors land back on the real site.

const ASLEEP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>six is asleep — 6ixnetworks</title>
<style>
  html,body{margin:0;height:100%;background:#07060e;color:#eceaf6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
  body{display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;
    background:radial-gradient(900px 500px at 70% 15%,rgba(88,60,180,.35),transparent 60%),radial-gradient(700px 420px at 20% 85%,rgba(255,94,168,.14),transparent 60%),#07060e}
  .card{max-width:430px;text-align:center}
  .star{font-size:64px;line-height:1;color:#b7a6ff;text-shadow:0 0 34px rgba(139,124,255,.8);animation:pulse 2.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.55;transform:scale(.96)}50%{opacity:1;transform:scale(1.04)}}
  h1{font-size:26px;margin:16px 0 6px;letter-spacing:.01em}
  p{color:#a79fd0;line-height:1.55;margin:6px 0;font-size:15px}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ffb52e;margin-right:7px;animation:pulse 1.4s infinite}
  .stat{display:inline-flex;align-items:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:6px 14px;font-size:13px;font-weight:700;margin-top:12px}
  button{margin-top:18px;background:#8b7cff;border:0;color:#fff;font:inherit;font-weight:800;border-radius:999px;padding:11px 22px;cursor:pointer}
</style>
</head>
<body>
  <div class="card">
    <div class="star">✦</div>
    <h1>six is asleep rn</h1>
    <p>the site lives on deion's pc and it's off or sleeping. soon as it wakes up, everything comes back — accounts, chat, all of it.</p>
    <div class="stat"><span class="dot"></span>checking again automatically…</div>
    <br>
    <button onclick="location.reload()">wake check — reload now</button>
  </div>
</body>
</html>`;

export default {
  async fetch(request) {
    let res = null;
    try {
      res = await fetch(request);
    } catch (e) {
      res = null;
    }
    if (!res || res.status === 502 || res.status === 503 || res.status === 504 || res.status === 530) {
      return new Response(ASLEEP_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return res;
  },
};
