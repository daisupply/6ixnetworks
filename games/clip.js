// 6ix clip-it: rolling last-15-seconds recorder for folder games.
// Starts on first interaction, keeps a rolling buffer, posts the clip to 6ixTube.
(function () {
  var chunks = [], rec = null, started = false;
  function toast(msg) {
    var t = document.getElementById('gxClipToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'gxClipToast';
      t.style.cssText = 'position:fixed;right:10px;bottom:58px;z-index:9999;background:rgba(10,7,24,.93);border:1px solid rgba(139,124,255,.55);color:#eceaf6;font:600 12.5px system-ui,sans-serif;border-radius:10px;padding:8px 12px;max-width:260px';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.display = 'none'; }, 3400);
  }
  function start() {
    if (started) return;
    var cv = document.querySelector('canvas');
    if (!cv || !cv.captureStream || !window.MediaRecorder) return;
    started = true;
    var stream;
    try { stream = cv.captureStream(30); } catch (e) { return; }
    var mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    var mime = '';
    for (var i = 0; i < mimes.length; i++) { try { if (MediaRecorder.isTypeSupported(mimes[i])) { mime = mimes[i]; break; } } catch (e) {} }
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined); } catch (e) { return; }
    rec.ondataavailable = function (e) {
      if (e.data && e.data.size) {
        chunks.push({ t: Date.now(), d: e.data });
        var cut = Date.now() - 17000;
        while (chunks.length && chunks[0].t < cut) chunks.shift();
      }
    };
    rec.start(1000);
  }
  document.addEventListener('pointerdown', start);
  document.addEventListener('keydown', start);
  var btn = document.createElement('button');
  btn.textContent = 'clip it';
  btn.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9999;background:rgba(255,59,92,.92);border:1px solid rgba(255,255,255,.5);color:#fff;font:800 12.5px system-ui,sans-serif;border-radius:999px;padding:9px 15px;cursor:pointer';
  btn.addEventListener('click', function () {
    if (!rec) { toast('play a few seconds first, then clip'); return; }
    var cut = Date.now() - 15000;
    var parts = chunks.filter(function (c) { return c.t >= cut; }).map(function (c) { return c.d; });
    if (!parts.length) { toast('nothing recorded yet'); return; }
    var type = (rec.mimeType || 'video/webm').split(';')[0];
    var blob = new Blob(parts, { type: type });
    btn.disabled = true; btn.textContent = 'posting…';
    fetch('/api/tube/uploadinit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'clip — ' + document.title.replace(/<[^>]*>/g, '').slice(0, 80), dur: 15 }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.err || 'login on the site first');
        return fetch('/api/tube/uploadfile?id=' + d.id, { method: 'POST', headers: { 'content-type': type }, body: blob }).then(function (r) { return r.json(); });
      })
      .then(function (d) {
        if (!d.ok) throw new Error(d.err || 'upload failed');
        toast('clip posted to 6ixtube');
      })
      .catch(function (e) { toast(e.message || 'clip failed'); })
      .finally(function () { btn.disabled = false; btn.textContent = 'clip it'; });
  });
  document.body.appendChild(btn);
})();
