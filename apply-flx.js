#!/usr/bin/env node
/* apply-flx.js — inlines flx.js into server.js. Backs up first. Aborts on any surprise. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const SRV = path.join(dir, 'server.js');
const BLK = path.join(dir, 'flx.js');
const BAK = path.join(dir, 'server.js.bak');

const die = (m) => { console.error('\n  ABORT: ' + m + '\n'); process.exit(1); };

for (const f of [SRV, BLK]) if (!fs.existsSync(f)) die('missing ' + path.basename(f));

let src = fs.readFileSync(SRV, 'utf8');
const block = fs.readFileSync(BLK, 'utf8');

if (src.includes('const FLX = (')) die('server.js already has FLX — nothing to do');
if (!src.includes('http.createServer(async (req, res)')) die('handler is not async — mount line would break');

const reqM = /^const \{[^\n]*\} = require\('stream'\);[^\n]*$/m.exec(src);
if (!reqM) die("couldn't find the require('stream') line");
const afterReq = reqM.index + reqM[0].length;
src = src.slice(0, afterReq) + '\n\n' + block + '\n' + src.slice(afterReq);

const mm = /^([ \t]*)if \(u\.pathname\.startsWith\('\/browse\/'\)\)/m.exec(src);
if (!mm) die("couldn't find the /browse/ branch");
src = src.slice(0, mm.index) + mm[1] + 'if (await FLX.handle(req, res, u)) return;\n\n' + src.slice(mm.index);

let swaps = 0;
src = src.replace(/src=(["'])https:\/\/(?:vidlink\.pro|vidfast\.vc|player\.videasy\.net|videasy\.net)\/(movie|tv)\/([^"']*)\1/g, (full, q, kind, rest) => {
  const parts = rest.split('/').map(p => p.trim());
  swaps++;
  if (kind === 'movie') return 'src=' + q + '/flx/watch?id=' + parts[0] + '&type=movie' + q;
  return 'src=' + q + '/flx/watch?id=' + parts[0] + '&type=tv&s=' + (parts[1] || '1') + '&e=' + (parts[2] || '1') + q;
});

fs.copyFileSync(SRV, BAK);

try { execFileSync(process.execPath, ['--check', SRV], { stdio: 'pipe' }); }
catch (e) {
  fs.copyFileSync(BAK, SRV);
  die('syntax check failed, server.js restored:\n' + String(e.stderr || e.message).slice(0, 900));
}

console.log('\n  ok. backup: server.js.bak');
console.log('  iframe srcs rewritten: ' + swaps + (swaps ? '' : '   <-- none matched, do that part by hand'));
console.log('  next: TMDB_KEY=xxx node server.js');
console.log('  then: curl localhost:8080/api/flx/health\n');