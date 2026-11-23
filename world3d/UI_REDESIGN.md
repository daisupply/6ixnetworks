# v580 — Moonfall Town UI redesign

## Audit (stage 1) — existing interface inventory
HUD: #w3hud (.w3left brand + chips #w3bal/#w3who/#w3conn; .w3btns
#w3count/#w3setbtn/.w3leave). Stack #w3stack: #w3mapbtn #w3wavebtn
#w3micbtn #w3mutebtn #w3partybtn. Settings #w3set: 11 controls
(w3sens w3camd w3camh w3gfxsel w3viewsel w3fov w3bob w3shadow
w3snd w3vol w3sfx) wired in bindSettings() to SET (localStorage
w3settings). Prompt #w3prompt (.w3p-ico/.w3p-lbl/.w3p-key) +
touch #w3use, driven by setPrompt()/scanPrompts() over INTERACT.
Panels: #w3dlg (name/text/next), #w3menu cafe (.w3mi rows built
by JS), #w3ward (hue slider + #w3ward_hat/_hair/_acc chip rows,
save/cancel), #w3games (3 static links), #w3quiz (q/choices/res),
#w3map (canvas 520x340 drawMap() + #w3mapseen). Overlays: #w3toast,
#w3act, #w3fade, #w3conflict, #w3load (critical CSS inlined in
world3d.js page()). Touch: #w3joyzone/#w3joy/#w3knob, .w3rbtns
(#w3sprint/#w3jump). Voice UI: vcSetBtn3() swaps mic icon +
.on/.live classes; speaking = .live via RMS interval; remote
speakers tint name labels. R{} caches all ids in init() — every
id above is load-bearing and preserved.
CSS debt: base rules + v543-546 appends + v552 !important system;
.w3chip means both HUD pill and wardrobe option; GALAXY_CSS global
button rules leak in (armor block is required, kept scoped).

## Design system — "warm dusk tavern" (matches the cozy world)
Tokens (CSS vars on #w3wrap): surfaces --mf-0 glass rgba(26,18,32,
.72) / --mf-1 #251a2e / --mf-2 #32223d; ink #f7ecd9, muted #c9b global
--mf-muted #c9b294; gold --mf-gold #ffc95e (primary accent),
blossom --mf-blossom #f2a7c3 (secondary), sage --mf-sage #9ec49a
(success), --mf-warn #f2b879, --mf-err #f29a9a; line rgba(255,201,
94,.22). Radii 14/18/999. Type: Inter (site font, already loaded):
display 800 19px, panel 800 16.5px, section 700 11px uppercase
.12em, body 500 14px, small 400 12px, button 700 13.5px.
Icons: existing inline SVG set (ICON_PATHS + page SVGs), 24 viewBox
stroke 2 — unchanged paths, new presentation (discs, badges).

## Integration changes to client3d.js (smallest possible, listed)
1. setPrompt: DOM writes only when the label changes; 140ms hide
   hysteresis (anti-flicker at range boundaries). Distances and
   actions untouched.
2. bindSettings: live value badges next to sliders (sens x, dist,
   height, fov deg, vol/sfx %); refreshed on open. Storage same.
3. Voice: new #w3vcstat status pill driven by vcSetBtn3 /
   vcToggle3 (off hidden, connecting, live, muted, listen-only);
   .talking class from the existing RMS interval. No WebRTC or
   signaling changes.
4. drawMap: palette swapped to the design tokens (same geometry,
   same data, same labels).
5. Escape closes the topmost open panel/settings/map and restores
   focus to the control that opened it (a11y). No handler removed.

## Fixes found by testing (post-implementation)
6. Armor specificity bug: the scoped armor `#w3wrap button` (ID
   specificity) outranked every component class, silently stripping
   button backgrounds and borders. Armor now resets only what
   GALAXY_CSS can actually leak (padding, shadow, font, color).
7. GALAXY_CSS carries `border-radius:8px!important` for buttons
   site-wide; round/pill game buttons answer with targeted
   `border-radius ... !important` on their own rules (hudbtn, w3x,
   rbtns, primary/ghost, buy, chip, qchoice, dlgnext). Proven via
   computed styles: sprint disc rgba(37,26,47,.62) + 50%, mic 50%.
8. `[hidden]` vs `display:flex` on .w3hudbtn defeated the hidden
   attribute (mute button visible while voice off) — armor now
   forces `[hidden]{display:none!important}` in scope.
9. drawMap: the lake ellipse painted BEFORE the park rect in the
   final pass, so the park covered the water. Lake now paints
   after the park (same geometry/data/labels).
Note: server.js caches static files at startup — CSS edits need a
server restart before a browser probe can see them (an early probe
round measured the pre-fix sheet; the computed-style re-probe after
restart is the valid one).

## Testing outcome (2026-11-23)
- Suites: math 106/106, roof 11/11, server 68/68 (one transient
  trivia fail on first run, clean on re-run — known fake-store
  flake; v580 touches no trivia logic), smoke ALL PASS.
- Wiring audit (code-level): all 74 client id lookups exist in the
  page HTML; every JS-built class (w3mi*, w3chip, w3qchoice, voice
  states) exists in the CSS; #w3vcstat has 12 rules.
- Browser probe, 5 viewports, zero page/shader errors: HUD 1920 +
  1366, settings open/slider-save/Escape, map (1920 + tablet),
  voice pill honest listen-only state, wardrobe/quiz/games shells,
  iPhone portrait (touch controls present, settings bottom sheet),
  landscape (stack becomes horizontal pill). Settings badges
  visually confirmed ("1.60x", "13 u", "72°", 50%/80%).
- NOT probe-verified: the café live path (prompt -> dialogue ->
  menu -> purchase). The sandbox trek never completed it (first
  attempt snagged on plaza colliders; the follow-up probe's client
  never finished booting in-window, twice). Per Deion's call
  (2026-11-23) the live test was skipped after the code-level
  wiring audit above; the café flow is his-screen verdict.
- Shell screenshots (wardrobe/quiz/games) are layout checks via
  real-DOM unhide; their rows/choices render on real open.
