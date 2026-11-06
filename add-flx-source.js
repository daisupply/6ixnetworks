const fs = require('fs'), { execFileSync } = require('child_process');
const F = 'server.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes("n: 'flx'")) { console.log('already there'); process.exit(0); }
const m = /var SRCS = \[\r?\n/.exec(s);
if (!m) { console.error('anchor missing'); process.exit(1); }
const line = "  { n: 'flx', w: 1, m: function(x){ return (+x) ? '/flx/watch?id=' + x + '&type=movie' : 'https://vidlink.pro/movie/' + x; }, t: function(x, s, e){ return (+x) ? '/flx/watch?id=' + x + '&type=tv&s=' + s + '&e=' + e : 'https://vidlink.pro/tv/' + x + '/' + s + '/' + e; } },\n";
const at = m.index + m[0].length;
fs.copyFileSync(F, 'server.js.bak2');
s = s.slice(0, at) + line + s.slice(at);
fs.writeFileSync(F, s);
try { execFileSync(process.execPath, ['--check', F], { stdio: 'pipe' }); }
catch (e) { fs.copyFileSync('server.js.bak2', F); console.error('syntax fail, restored'); process.exit(1); }
console.log('ok — flx added as source 0');