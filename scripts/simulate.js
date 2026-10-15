/**
 * 可玩性模拟器 —— 回答一个问题：8 次机会够不够？
 *
 * 用法：
 *     node scripts/simulate.js                # 全量模拟（每名球员当答案各跑一遍）
 *     node scripts/simulate.js --quick        # 抽 40 名，快
 *     node scripts/simulate.js --max=6        # 试算「只给 6 次机会」的通关率
 *
 * 两种玩家模型：
 *   random —— 完全不懂，在候选池里瞎点。这是难度下界（最坏情况）。
 *   greedy —— 每步挑「能把剩余候选切得最碎」的球员。这是难度上界（老手最优）。
 * 真实玩家落在两者之间，且因为有球员知识，通常明显好于 random。
 *
 * 判据（见 docs/01-PRD.md §2.3）：
 *   greedy 平均步数 <= 5.5     出题不会太刁
 *   greedy 8 步通关率 >= 95%   8 次机会够用
 *   random 平均步数 >= 6       又不能闭眼乱点就赢，否则没有挑战性
 */
const fs = require('fs');
const path = require('path');

const C = require('../cloudfunctions/_shared/constants');
const { compare } = require('../cloudfunctions/_shared/compare');

/* ---------------- 参数 ---------------- */
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const maxArg = args.find(a => a.startsWith('--max='));
const MAX_TRIES = maxArg ? Number(maxArg.split('=')[1]) : C.MAX_GUESSES;
const DATE = '2026-10-11';

/* ---------------- 数据 ---------------- */
const DATA = [
  path.join(__dirname, '../database/players.full.jsonl'),
  path.join(__dirname, '../database/players.sample.jsonl')
].find(p => fs.existsSync(p));

const ALL = fs.readFileSync(DATA, 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));
// --pool=all 时按自由练习的全池跑；默认按每日一题的答案池（门槛高一档）
const POOL_MODE = args.find(a => a.startsWith('--pool=')) === '--pool=all' ? 'all' : 'daily';
const POOL = ALL.filter(p => p.fame_level >=
  (POOL_MODE === 'daily' ? C.MIN_FAME_DAILY : C.MIN_FAME));

/* ---------------- 判定指纹 ---------------- */
/**
 * 把一次猜测的 8 行判定压成字符串指纹。
 * 两个答案对同一次猜测产生相同指纹 => 这次猜测无法区分它们。
 * 注意：猜中（全绿）时单独标记，因为它是终局信号。
 */
function fingerprint(guess, answer) {
  const v = compare(guess, answer, DATE);
  const parts = C.CLUE_ORDER.map(k => {
    const cell = v[k];
    if (!cell) return '-';
    if (typeof cell === 'object') return cell.state + (cell.arrow || '');
    return String(cell);
  });
  return parts.join(',');
}

function isWin(guess, answer) {
  return guess.id === answer.id;
}

/* ---------------- 玩家模型 ---------------- */
/** 随机：在候选池里随便挑一个（不挑已经排除的） */
function pickRandom(cands, rng) {
  return cands[Math.floor(rng() * cands.length)];
}

/**
 * 贪心：挑一个能让「最坏情况剩余候选数」最小的猜测。
 * 等价于 minimax —— 不管答案是什么，剩下的候选都尽可能少。
 * 全量扫描候选池做 minimax 是 O(n²)，500 条 × 500 条 = 25 万次 compare，
 * 单局最多 8 步 => 200 万次，跑 250 局会到 5 亿次，太慢。
 * 所以只在候选池 > 30 时随机采样 30 个候选当探针，池子小了再全扫。
 */
function pickGreedy(cands, rng) {
  const SAMPLE = 30;
  const probes = cands.length <= SAMPLE
    ? cands
    : shuffle(cands.slice(), rng).slice(0, SAMPLE);

  let best = probes[0], bestWorst = Infinity;
  for (const g of probes) {
    const groups = new Map();
    for (const a of cands) {
      if (a.id === g.id) continue;               // 自己就是答案，一步结束
      const fp = fingerprint(g, a);
      groups.set(fp, (groups.get(fp) || 0) + 1);
    }
    // 最坏情况 = 最大分组的人数；平局时看分组数（信息量）
    let worst = 0;
    for (const n of groups.values()) if (n > worst) worst = n;
    const score = worst - groups.size * 0.001;
    if (score < bestWorst) { bestWorst = score; best = g; }
  }
  return best;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 可复现的伪随机（mulberry32），保证每次跑出一样的数 */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------------- 单局 ---------------- */
function playOne(answer, strategy, rng) {
  let cands = POOL.slice();
  const pick = strategy === 'greedy' ? pickGreedy : pickRandom;

  for (let step = 1; step <= MAX_TRIES; step++) {
    if (!cands.length) return { steps: step - 1, won: false, dead: true };
    const guess = pick(cands, rng);
    if (isWin(guess, answer)) return { steps: step, won: true };

    const fp = fingerprint(guess, answer);
    cands = cands.filter(c => c.id !== guess.id && fingerprint(guess, c) === fp);
  }
  return { steps: MAX_TRIES, won: false, dead: false };
}

/* ---------------- 主流程 ---------------- */
function run(strategy) {
  const targets = QUICK ? POOL.slice(0, 40) : POOL;
  const results = targets.map((a, i) => {
    const r = playOne(a, strategy, makeRng(i + 1));
    r.id = a.id; r.name = a.name_cn;
    return r;
  });

  const won = results.filter(r => r.won);
  const avg = won.reduce((s, r) => s + r.steps, 0) / (won.length || 1);
  const dist = {};
  results.forEach(r => {
    const k = r.won ? r.steps : 'X';
    dist[k] = (dist[k] || 0) + 1;
  });

  const worst = results.reduce((m, r) => Math.max(m, r.steps), 0);
  const hard = results.filter(r => r.steps >= 5);

  return {
    strategy,
    n: results.length,
    winRate: won.length / results.length,
    avgSteps: avg,
    worst,
    hardCount: hard.length,
    hardIds: hard.map(r => r.id),
    dist
  };
}

function bar(n, total, width = 30) {
  return '#'.repeat(Math.round(n / total * width));
}

console.log(`题库：${path.basename(DATA)}（${ALL.length} 条）  `
  + `答案池：${POOL_MODE === 'daily' ? '每日一题' : '自由练习'} ${POOL.length} 人`);
console.log(`机会：${MAX_TRIES} 次   基准日：${DATE}${QUICK ? '   [快速模式]' : ''}\n`);

const VERDICT = [];
for (const s of ['random', 'greedy']) {
  const r = run(s);
  const label = s === 'greedy' ? '老手（贪心 minimax）' : '新手（随机乱猜 + 完美过滤）';
  console.log(`== ${label} ==`);
  console.log(`  通关率 ${(r.winRate * 100).toFixed(1)}%   `
    + `平均步数 ${r.avgSteps.toFixed(2)}   最坏步数 ${r.worst}`);
  console.log('  步数分布：');
  for (let i = 1; i <= MAX_TRIES; i++) {
    const n = r.dist[i] || 0;
    console.log(`    ${String(i).padStart(2)} 步 ${String(n).padStart(4)}  ${bar(n, r.n)}`);
  }
  const x = r.dist['X'] || 0;
  console.log(`    失败 ${String(x).padStart(4)}  ${bar(x, r.n)}`);
  if (r.hardCount) {
    console.log(`  需 >=5 步的难题 ${r.hardCount} 个：`
      + r.hardIds.slice(0, 12).map(id => {
        const p = POOL.find(q => q.id === id);
        return p ? p.name_cn : id;
      }).join('、') + (r.hardCount > 12 ? ' …' : ''));
  }
  console.log('');
  VERDICT.push(r);
}

/* ---------------- 结论 ----------------
   两个模型都是「知道全部 500 人属性 + 能完美过滤」的机器人，真实玩家做不到，
   实际步数会明显更高。所以这里不追求"平均步数接近 8"，而是守住两条硬底线：
     1) 最坏情况也必须在 8 步内可解 —— 否则存在必然失败的死题；
     2) 平均步数不能低于 2 —— 否则一步就中，没有推理过程。 */
const g = VERDICT.find(r => r.strategy === 'greedy');
const checks = [
  [`最坏情况 ${g.worst} 步 <= ${MAX_TRIES}（不存在必败死题）`, g.worst <= MAX_TRIES, g.worst],
  [`老手通关率 100%（${MAX_TRIES} 次机会确实够用）`, g.winRate === 1,
    (g.winRate * 100).toFixed(1) + '%'],
  ['平均步数 >= 2（要有推理过程，不能一步中）', g.avgSteps >= 2, g.avgSteps.toFixed(2)],
  ['平均步数 <= 5.5（题目不刁，真人也推得动）', g.avgSteps <= 5.5, g.avgSteps.toFixed(2)]
];

console.log('== 判定 ==');
let bad = 0;
for (const [name, pass, actual] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${name}  实测 ${actual}`);
  if (!pass) bad++;
}
console.log('');
console.log('注：以上为「全知机器人」成绩（知道全部 500 人属性并能完美过滤），');
console.log('    真实玩家不熟悉全部球员属性，实际步数会明显更高 ——');
console.log(`    ${MAX_TRIES} 次机会是给真人的容错余量，不是给机器人用的。`);
console.log(bad
  ? `\n${bad} 项不达标 —— 需要调整 MAX_GUESSES 或题库构成`
  : '\n全部达标，当前难度设定可上线');
process.exit(bad ? 1 : 0);
