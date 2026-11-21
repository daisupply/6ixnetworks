# 3D world tests

Three suites, in increasing order of setup. All of them test the code
that actually ships: the browser suite drives the real page, the server
suite hits the real API, and the math suite imports the same
`../math3d.js` module the client imports.

## 1. Math (no setup)

```
node world3d/tests/math.test.mjs
```

Pure movement/camera math: WASD directions at multiple camera yaws,
camera-rotation coupling, diagonal speed == straight speed, analog
magnitude clamping, frame-rate-independent damping, angle wrap/lerp,
and the camera-boom segment tests (sphere + box).

## 2. Server contract (needs a local test server)

Start a throwaway server first (fake or scratch Upstash, any port):

```
PORT=18097 UPSTASH_REDIS_REST_URL=<scratch> UPSTASH_REDIS_REST_TOKEN=<scratch> node server.js
W3_BASE=http://127.0.0.1:18097 node world3d/tests/server.test.mjs
```

Asset routes + MIME types, inlined loader CSS, the NOTIF_JS script-tag
regression, auth (401 contract), the handshake response shape, the
session-takeover contract (movement from a stale sid is rejected, a
position-less ping transfers ownership), leave + respawn. Signs up
throwaway accounts through the real PoW flow. **Never run against
production.**

## 3. Browser regression (needs the local server + Chrome)

One-time setup: `npm install` in the repo root (installs the
`puppeteer-core` devDependency; it drives your own Chrome, it does not
download a browser).

```
W3_BASE=http://127.0.0.1:18097 CHROME_PATH=/path/to/chrome node world3d/tests/browser.test.mjs
```

Real headless Chrome (puppeteer-core). Covers the loader (styled first
paint with the engine blocked, no raw JS visible), handshake failure
(HTTP 500 and invalid JSON both land on the error screen, never
READY), desktop movement/camera (S/A/D/W directions, diagonal parity,
sprint, jump + no double-jump, no camera auto-rotate, boom no-clip,
follow continuity, blur/visibility freeze), the same movement checks
under 6x CPU throttling, settings persistence, the portal round trip,
the session-takeover freeze + reclaim between two live tabs, and
mobile simultaneous inputs (joystick+camera, joystick+jump,
joystick+sprint, touch cancel, release-stop, landscape boot).

Notes:
- Assertions poll `window.__w3state()` instead of trusting wall-clock
  timing, so the suite stays valid on slow/throttled machines.
- Pointer lock is stubbed out in the test pages: headless synthetic
  drags under pointer lock are chaotic (giant synthetic movementX),
  so the suite exercises the deterministic drag path. Pointer-lock
  engagement itself is native browser behavior on real hardware.
- Screenshots land in /tmp/w3t-*.png for eyeball checks.
