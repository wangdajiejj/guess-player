/**
 * 2026-10-25 数据校准补丁（一次性脚本，跑完可删）
 *
 * 修复 audit-data.py 扫出的 9 组「现役同队同号」及关联的过期转会。
 * 所有改动均经 web 检索核实（2026-10-25 时点）：
 *  - 卢卡库 那不勒斯 11→9（KDB 加入后穿 11，卢卡库改 9，ESPN/Transfermarkt）
 *  - 帕尔默 切尔西 20→10（2025-06 起穿 10）
 *  - 卡马文加 皇马 12→6（12 让给阿诺德）
 *  - 居莱尔 皇马 24→15（24 让给赫伊森）
 *  - 赖因德斯 AC米兰→曼城 4 号（2025-06 转会）
 *  - 马赫雷斯 吉达联合→吉达国民 7 号（2023-07 转会，此前漏改）
 *  - 莫拉塔 AC米兰→莱加内斯 21 号（2026-08-28 租借，西乙）
 *  - 塞尔吉·罗伯托 巴塞罗那→洛杉矶银河 6 号（2026-08-07 自由加盟）
 *  - 努涅斯 利雅得新月→迪里耶 29 号（2026-08 租借）
 *  - 本泽马 / 斯特林 现为自由球员（2026-08-31 / 2026-07-01 起）：
 *    按退役口径处理（active=false + 代表球队），签约后可一键改回。
 * 改完必须跑：python database/validate.py database/players.full.jsonl <日期> --fix
 */
const fs = require('fs');
const file = 'database/players.full.jsonl';
const AS_OF = '2026-10-25';

const patches = {
  p039: { shirt_number: 9 },
  p128: { shirt_number: 10 },
  p137: { active: false, club: '皇家马德里', club_en: 'Real Madrid', league: '西甲', shirt_number: 9 },
  p344: { club: '洛杉矶银河', club_en: 'LA Galaxy', league: '美职联', shirt_number: 6,
          primary_color: '#00245D', secondary_color: '#FFC72C' },
  p392: { active: false, club: '曼城', club_en: 'Manchester City', league: '英超', shirt_number: 7,
          primary_color: '#6CABDD', secondary_color: '#1C2C5B' },
  p420: { shirt_number: 6 },
  p421: { shirt_number: 15 },
  p437: { club: '迪里耶', club_en: 'Al-Diriyah', shirt_number: 29,
          primary_color: '#245C40', secondary_color: '#C9A227' },
  p443: { club: '曼城', club_en: 'Manchester City', league: '英超', shirt_number: 4,
          primary_color: '#6CABDD', secondary_color: '#1C2C5B',
          intro: '跑动与持球推进俱佳的荷兰中场，曼城中场主力。',
          fun_fact: '从阿尔克马尔转投米兰成名，2025 年夏天转投曼城。' },
  p455: { club: '吉达国民', club_en: 'Al-Ahli', primary_color: '#0B8043', secondary_color: '#FFFFFF' },
  p460: { club: '莱加内斯', club_en: 'CD Leganes', league: '西乙', shirt_number: 21,
          primary_color: '#005CA9', secondary_color: '#FFFFFF' }
};

const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
let patched = 0;
const out = lines.map(line => {
  const p = JSON.parse(line);
  const patch = patches[p._id];
  if (!patch) return line;
  Object.assign(p, patch, { data_as_of: AS_OF });
  patched++;
  console.log('[patched]', p._id, p.name_cn, '->', p.club, p.league, 'num=' + p.shirt_number, 'active=' + p.active);
  return JSON.stringify(p);
});

if (patched !== Object.keys(patches).length) {
  console.error('*** FAILED *** 预期改 ' + Object.keys(patches).length + ' 条，实际 ' + patched + ' 条');
  process.exit(1);
}

fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
console.log('DONE. ' + patched + ' records patched (order preserved), data_as_of=' + AS_OF);
console.log('下一步: python database/validate.py database/players.full.jsonl ' + AS_OF + ' --fix');
