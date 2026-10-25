/** 2026-10-25 补丁2：库巴西5号 / 萨内→加拉塔萨雷 / 格拉利什→埃弗顿（一次性） */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'database');

function patch(file, id, repls) {
  const p = path.join(DIR, file);
  let s = fs.readFileSync(p, 'utf8');
  const m = s.match(new RegExp('dict\\(id=' + id + ','));
  if (!m) { console.error('!! id=' + id + ' not found in ' + file); process.exit(1); }
  const st = m.index, en = s.indexOf('),', st);
  let b = s.slice(st, en);
  for (const [r, v] of repls) {
    if (!r.test(b)) { console.error('!! pattern miss id=' + id); process.exit(1); }
    b = b.replace(r, v);
  }
  fs.writeFileSync(p, s.slice(0, st) + b + s.slice(en), 'utf8');
  console.log('[ok]', file, 'id=' + id, b.match(/cn='[^']*'/)[0]);
}

// 库巴西 2026-27 巴萨 5 号（官方名单，坎塞洛接 2 号）
patch('roster_b.py', 58, [[/sn=\d+/, 'sn=5']]);
// 萨内 → 加拉塔萨雷（2025-07 自由转会，土超 MVP；保留 10 号）
patch('roster_f.py', 384, [[/club='[^']*'/, "club='加拉塔萨雷'"], [/ce='[^']*'/, "ce='Galatasaray'"], [/lg='[^']*'/, "lg='土超'"]]);
// 格拉利什 → 埃弗顿（2026-27 二度租借；保留 10 号）
patch('roster_f.py', 380, [[/club='[^']*'/, "club='埃弗顿'"], [/ce='[^']*'/, "ce='Everton'"], [/lg='[^']*'/, "lg='英超'"]]);
console.log('DONE.');
