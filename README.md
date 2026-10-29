# 6ixNetworks — web proxy, games + YouTube network

Paste a link or type a search on the homepage — the page loads through **your**
server instead of the visitor's device, so the site they visit only sees your
server. Zero dependencies: the whole thing is one Node file (`server.js`) or
one Cloudflare Worker file (`worker.js`).

## How it works

- `/` — homepage with the URL/search bar
- `/go?q=...` — turns a typed link or search into a proxied address
  (bare searches go to Bing results, proxied — DuckDuckGo throws a bot challenge at server IPs)
- `/browse/<base64url>` — the proxy itself. It fetches the target server-side,
  rewrites links/images/stylesheets/forms in HTML and CSS so clicks stay inside
  the proxy, rewrites redirects, and streams everything else (images, video,
  downloads) straight through.
- Local/private hosts (localhost, 192.168.x.x, etc.) are blocked so the proxy
  can't be pointed at your own network.

## Honest limits

- Simple sites, search, articles, wikis, lots of game/video pages: work.
- Heavy JavaScript apps sometimes partially work — their scripts build
  addresses in the browser that a basic proxy can't rewrite.
- Every request presents as one consistent desktop Chrome browser (same
  user agent, client hints and fetch headers), and each site's cookies are
  translated onto the proxy's own domain, namespaced per site, so sessions
  and search-engine cookies persist like a real browser's would. That fixes
  most bot challenges that come from looking inconsistent or cookieless.
  What it can't fix: the site still sees the host's IP address, and big
  sites (Google accounts, TikTok, Instagram) sometimes block datacenter /
  Cloudflare IP ranges outright. A service-worker proxy (Ultraviolet /
  Scramjet class) is the upgrade path for the heaviest sites — a much
  bigger build.
- Don't run this as a wide-open public proxy for strangers. It'll eat your
  free-tier limits and can get the host flagged for other people's traffic.
  Keep the link among people you trust.

## Run it locally

```bash
node server.js          # http://localhost:8080
PORT=3000 node server.js
```

## Deploy option A — Cloudflare Workers (recommended, free)

- Free: 100,000 requests/day, no credit card, no cold starts / sleep.
- Downsides: 10 ms CPU per request on free (fine for fetch-and-rewrite),
  and it's a Worker, not a full server.
- Steps: make a free Cloudflare account → Workers & Pages → Create Worker →
  paste in `worker.js` → Deploy. You get a `*.workers.dev` address.
- Or with the CLI: `npm i -g wrangler && wrangler login && wrangler deploy`
  (uses `wrangler.toml`).

## Deploy option B — Render (free Node server)

- Free: 750 instance-hours/month, 512 MB RAM, no credit card, deploys
  straight from GitHub using `render.yaml`.
- Downside: spins down after 15 idle minutes; the next visit takes about a
  minute to wake it. Paid $7/mo removes the sleep.
- Steps: push this folder to a GitHub repo → render.com → New → Blueprint →
  pick the repo → Deploy. You get an `*.onrender.com` address.

## Deploy option C — the rest

- **Koyeb** — 1 free web service (512 MB), scales to zero after 1 h idle,
  wakes in seconds. Now requires a card with a ~$29 authorization hold.
- **Railway** — $5 one-time trial credit, then $1/month of free credit.
  Fine to test on; not free forever.
- **Fly.io** — no real free tier anymore (tiny trial, then ~$2/mo). Skip
  unless you're paying anyway.
- **GitHub Pages / Vercel static** — can't run a proxy. A proxy needs a
  server fetching pages; static hosting has nowhere to run it.

## v3 — speed + the YouTube network

- **Single-pass rewriting.** HTML is rewritten in one regex scan instead of
  four or five. On Cloudflare Workers Free you only get 10 ms of CPU per
  request; scan count is the difference between fast and Error 1102.
- **Range streaming.** `Range` / `If-Range` are forwarded and
  `Content-Range` / `Accept-Ranges` / `Content-Length` pass back through,
  so direct video/audio files actually play and seek instead of stalling.
- **Caching.** Static assets (images, CSS, JS, fonts) are cached — the
  Cloudflare edge Cache API in `worker.js`, a 150-entry memory cache in
  `server.js`. Repeat assets return with `x-sixsearch-cache: HIT`.
- **YouTube mode (`/yt`).** youtube.com's player refuses cloud IPs at the
  playability check — no rewriting proxy on a datacenter IP gets raw
  YouTube playback, and the surviving Invidious instances bot-wall their
  watch pages for server IPs. What works: Invidious **search** through the
  proxy (3 instances with automatic failover) and **playback on the Piped
  network**. Any YouTube link pasted into SixSearch (watch, shorts,
  youtu.be, embeds) auto-mirrors to piped.video, and tapping a watch link
  in search results does the same.
- **The real speed unlock is Workers Paid ($5/mo)** if it ever matters:
  CPU per request goes from 10 ms to up to 5 minutes, and the 100k
  requests/day cap disappears. Free works; paid removes the ceiling.

## v4 — 6ixNetworks: games hub + tab cloak

- **`/gs` games network.** The catalog is fetched live from the GameMonetize
  publisher feed (1,000+ embeddable HTML5 games) and cached for an hour;
  the hub renders 600 with search + category filters. Games open in `/play`
  in a fullscreen iframe — **through the proxy by default**, with a
  one-tap **direct** mode for games whose code fights the proxy rewriter.
  Thumbnails load through the proxy (and hit the v3 cache) too.
- **Tab cloak on every page.** One click retitles the tab to Google,
  Google Classroom or Google Docs with the matching favicon, or opens the
  current page inside an about:blank tab labeled Google.
- Renamed from SixSearch to **6ixNetworks** (worker name `6ixnetworks`).
