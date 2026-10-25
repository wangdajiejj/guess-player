/** 一次性：反向猜球上线后的文档同步（跑完可删） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function sub(file, pairs) {
  const p = path.join(ROOT, file);
  let s = fs.readFileSync(p, 'utf8');
  let n = 0;
  for (const [a, b] of pairs) {
    // 只替换一次（有的替换结果会包含原文，用 while 会死循环）
    if (s.includes(a)) { s = s.replace(a, b); n++; }
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(file, '->', n, '处');
}

sub('README.md', [
  ['| **自由练习 · 全员局** | 整个答案池随机抽，含冷门 | 8 次 | 随便玩 |',
   '| **自由练习 · 全员局** | 整个答案池随机抽，含冷门 | 8 次 | 随便玩 |\n| **反向猜球** | 系统逐条揭开答案自身属性（国籍→联赛→俱乐部→…），随时可猜，揭得越少分越高 | 8 次 | 随便玩 |'],
  ['cloudfunctions/       5 个云函数 + _shared/', 'cloudfunctions/       6 个云函数 + _shared/'],
  ['| 后端 | `cloudfunctions/` | 5 个云函数 + `_shared/`', '| 后端 | `cloudfunctions/` | 6 个云函数 + `_shared/`'],
  ['307 条断言，分 9 段跑：判定算法 32、对局流程 85（含难度分档 8 条：明星局答案必为 5 星、\n不传难度保持老行为）',
   '337 条断言，分 9 段跑：判定算法 32、对局流程 115（含难度分档 8 条 + 反向猜球 30 条：\n揭线索计分、猜错不下发 verdict、答案零泄露）'],
]);

sub('README-启动.md', [
  ['#    一共 5 个：gameStart / gameGuess / gameResume / gameResult / getPlayers',
   '#    一共 6 个：gameStart / gameGuess / gameResume / gameResult / gameReveal / getPlayers'],
  ['| `test-flow.js` | 77 | 5 个云函数端到端、并发幂等、越权、**答案零泄露** |',
   '| `test-flow.js` | 115 | 6 个云函数端到端、并发幂等、越权、难度分档、反向猜球、**答案零泄露** |'],
  ['**合计 299 条断言**（32+77+51+36+24+66+13）。',
   '**合计 337 条断言**（32+115+51+36+24+66+13）。'],
  ['├── cloudfunctions/         5 个云函数 + _shared/（判定与抽样的单一真源）',
   '├── cloudfunctions/         6 个云函数 + _shared/（判定与抽样的单一真源）'],
]);

sub('docs/05-deployment.md', [
  ['```\ngameStart → gameGuess → gameResume → gameResult → getPlayers\n```',
   '```\ngameStart → gameGuess → gameResume → gameResult → gameReveal → getPlayers\n```'],
  ['然后依次右键 5 个目录', '然后依次右键 6 个目录'],
]);
console.log('DONE.');
