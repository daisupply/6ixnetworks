# Deploy 6ixNetworks anywhere

Two builds of the same network live in this repo:

- **worker.js** — the Cloudflare Workers build (what's live now).
- **server.js** — the Node build. Same features, runs anywhere Node or
  Docker runs, and supports `UPSTREAM_PROXY` (see README's Egress
  section) for a different outgoing IP.

## Cloudflare Workers (free, no sleep, best default)
- Fastest: dashboard → your worker → Edit code → paste `worker.js` → Deploy.
- From a clone: `npx wrangler deploy` (uses `wrangler.toml`).
- From GitHub: Actions → "deploy worker" → Run workflow (needs the
  `CLOUDFLARE_API_TOKEN` secret — see the workflow file).

## Render (free tier, sleeps when idle)
One click: https://render.com/deploy?repo=https://github.com/daisupply/6ixnetworks
It reads `render.yaml`. Free web services sleep after ~15 idle minutes
and take ~1 minute to wake. Your custom domain can point here instead.

## Railway
New Project → Deploy from GitHub repo → pick this repo. `railway.json`
sets the start command; set `PORT` is handled by Railway automatically.
(Trial credit, then usage-based — a few bucks a month for light use.)

## Fly.io (paid, never sleeps)
Install flyctl → `fly launch` (or reuse `fly.toml` — rename the app
first) → `fly deploy`. Uses the Dockerfile. Closest region: `ord`.

## Docker — any VPS / home machine / Koyeb
```
docker compose up -d --build
```
…or plain: `docker build -t sixnetworks . && docker run -p 8080:8080 sixnetworks`
The same Dockerfile powers Fly/Koyeb/Coolify/Dokku-style deploys.
On a home machine this gives the network a **residential IP** — pair it
with a Cloudflare Tunnel if you want it on your domain.

## Heroku-style platforms (Heroku, Dokku, Coolify)
`Procfile` is included: they run `node server.js` with `npm install`
from `package.json`.

## Not recommended
Vercel/Netlify serverless: function timeouts and streaming limits fight
a proxy's long-lived range/stream responses. Possible in pieces, worse
in practice — use any option above instead.
