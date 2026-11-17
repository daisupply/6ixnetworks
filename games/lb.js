// 6ix leaderboards for folder games.
// Usage: <script>window.GXLB={game:'stack'}</script><script src="/games/lb.js"></script>
// Games call window.gxSubmit(score) at game over. auto modes poll the game itself.
(function () {
  var cfg = window.GXLB || {};
  var game = cfg.game;
  if (!game) return;
  var lastSent = -1, lastAt = 0;
  var card = document.createElement('div');
  card.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9999;background:rgba(10,7,24,.88);border:1px solid rgba(139,124,255,.45);border-radius:12px;color:#eceaf6;font:600 12px system-ui,sans-serif;padding:9px 12px;max-width:230px;backdrop-filter:blur(6px)';
  card.innerHTML = '<div style="font-weight:800;letter-spacing:.08em;font-size:11px;color:#bdb4e4">LEADERBOARD</div><div class="gx-lb-body">loading…</div>';
  document.body.appendChild(card);
  var body = card.querySelector('.gx-lb-body');
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render(d) {
    if (!d || !d.ok) { body.textContent = 'scores unavailable rn'; return; }
    var rows = (d.top || []).slice(0, 5).map(function (r, i) { return '<div style="display:flex;justify-content:space-between;gap:12px;padding:1.5px 0"><span>' + (i + 1) + '. ' + esc(r.u) + '</span><b>' + r.s + '</b></div>'; }).join('');
    var tag = d.dailyGame === game ? '<div style="color:#ffd257;font-weight:800;margin-top:4px">today\'s daily challenge</div>' : '';
    var mine = d.mine ? '<div style="margin-top:4px;color:#9a93b8">you: #' + (d.mine.rank || '—') + ' · ' + d.mine.s + '</div>' : '<div style="margin-top:4px;color:#9a93b8">login on the site to compete</div>';
    body.innerHTML = (rows || 'no scores yet — be first') + tag + mine;
  }
  function load() { fetch('/api/scores?game=' + game).then(function (r) { return r.json(); }).then(render).catch(function () {}); }
  load();
  window.gxSubmit = function (score) {
    score = Math.floor(Number(score) || 0);
    if (!score) return;
    if (score === lastSent && Date.now() - lastAt < 5000) return;
    lastSent = score; lastAt = Date.now();
    fetch('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game: game, score: score }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) load(); })
      .catch(function () {});
  };
  if (cfg.auto === 'g2048') {
    var seen = false;
    setInterval(function () {
      var over = document.querySelector('.game-message.game-over');
      var sc = document.querySelector('.score-container');
      if (over && sc && !seen) {
        seen = true;
        var n = parseInt((sc.textContent || '').replace(/[^0-9]/g, ''), 10);
        if (n) window.gxSubmit(n);
      }
      if (!over) seen = false;
    }, 1000);
  }
  if (cfg.auto === 'hextris') {
    var prevState = null, peak = 0;
    setInterval(function () {
      if (typeof window.gameState !== 'undefined' && typeof window.score !== 'undefined') {
        if (window.gameState === 1) peak = Math.max(peak, window.score || 0);
        if (prevState === 1 && window.gameState !== 1 && peak > 0) { window.gxSubmit(peak); peak = 0; }
        prevState = window.gameState;
      }
    }, 600);
  }
})();
