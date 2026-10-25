/** 一次性：把各文档里的题库人数 500 → 548 系列引用批量更新（跑完可删） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const SUBS = [
  ['比对逻辑和 500 人答案池放进了客户端', '比对逻辑和 548 人答案池放进了客户端'],
  ['players.full.jsonl（500 人）+ roster_{a..g}.py', 'players.full.jsonl（548 人）+ roster_{a..h}.py'],
  ['比对逻辑和 500 人的答案被打进了客户端', '比对逻辑和 548 人的答案被打进了客户端'],
  ['核对集合条数 = 500', '核对集合条数 = 548'],
  ['已完成：200 → **500 人**（退役传奇 + 现役新星 + 边后卫/左脚）',
   '已完成：200 → 500 → **548 人**（2026-10-25 又扩 48 人：现役 12 + 退役传奇 36）'],
  ['（fame>=3，500 人）', '（fame>=3，548 人）'],
  ['| 自由练习 500 人 |', '| 自由练习 548 人 |'],
  ['知道全部 500 人属性', '知道全部 548 人属性'],
  ['比对逻辑和 500 人答案池打进客户端', '比对逻辑和 548 人答案池打进客户端'],
  ['核对条数 = 500，且客户端能搜到最靠后的球员', '核对条数 = 548，且客户端能搜到最靠后的球员'],
  ['{ "_id": "players_meta","playerVersion": "2026-10-11", "playerCount": 200',
   '{ "_id": "players_meta","playerVersion": "2026-10-25", "playerCount": 548'],
  ['{ "_id": "players_meta", "playerVersion": "2026-10-10", "playerCount": 200',
   '{ "_id": "players_meta", "playerVersion": "2026-10-25", "playerCount": 548'],
];

for (const f of ['README-启动.md', 'docs/05-deployment.md', 'docs/02-database.md', 'docs/04-testing.md']) {
  const p = path.join(ROOT, f);
  let s = fs.readFileSync(p, 'utf8');
  let n = 0;
  for (const [a, b] of SUBS) {
    while (s.includes(a)) { s = s.replace(a, b); n++; }
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(f, '->', n, '处替换');
}
