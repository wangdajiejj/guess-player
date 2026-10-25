/**
 * 线索筛选测试 —— 「点标签筛候选池」这条功能的正确性防线
 *
 *   node scripts/test-candidates.js
 *
 * 为什么值得单独一层测试：
 *   筛选是客户端唯一的「推理类」逻辑，一旦它把正确答案筛掉了，
 *   玩家就会看到"我明明知道线索却找不到人"，而且不会报错、很难察觉。
 *
 * 六组断言：
 *   1. 客户端判定口径与服务端 _shared 逐一对拍（年龄 / 日期 / 公差 / 位置大类）
 *   2. 单条线索的语义正确（绿=精确、黄=放宽、灰=排除、数值箭头方向）
 *   3. ★ 黄金不变量：用真实题库模拟对局，答案永不被筛掉
 *   4. 边界：数据缺失的线索不产生约束（不能把池子筛成空集）
 *   5. 体验指标：叠加全部线索后候选池缩到多少人
 *   6. 去重等价性：候选面板合并重复标签后，筛选结果与约束说明分毫不变
 */
const fs = require('fs');
const path = require('path');

const clue = require('../miniprogram/utils/clue.js');
const ageUtil = require('../miniprogram/utils/age.js');
const SC = require('../cloudfunctions/_shared/constants.js');
const Scompare = require('../cloudfunctions/_shared/compare.js');
const SUtil = require('../cloudfunctions/_shared/util.js');

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
const fails = [];

function G(name) { console.log(`\n== ${name} ==`); }

function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else {
    fail++;
    fails.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`);
  }
}

/* ---------- 题库 ---------- */
const CANDIDATES = [
  path.join(__dirname, '..', 'database', 'players.full.jsonl'),
  path.join(__dirname, '..', 'database', 'players.sample.jsonl')
];
const DATA = CANDIDATES.find(f => fs.existsSync(f));
const ALL = fs.readFileSync(DATA, 'utf8').split('\n')
  .filter(l => l.trim()).map(l => JSON.parse(l));

const DK = '2026-10-11';                       // 固定的"对局自然日"，保证可复现
const DAILY_POOL = ALL.filter(p => p.fame_level >= SC.MIN_FAME_DAILY);

/* 确定性伪随机（mulberry32）—— 换机器、换时间跑结果一致 */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log(`线索筛选测试（题库 ${ALL.length} 人 / 每日池 ${DAILY_POOL.length} 人，来自 ${path.basename(DATA)}）`);

/* ================= 1. 与服务端口径对拍 ================= */
G('1. 客户端口径 vs 服务端 _shared');

{
  // 1.1 公差
  ok(`年龄公差一致（${SC.AGE_TOL}）`, clue.TOL.age === SC.AGE_TOL);
  ok(`身高公差一致（${SC.HEIGHT_TOL}）`, clue.TOL.height === SC.HEIGHT_TOL);
  ok(`球衣号公差一致（${SC.SHIRT_TOL}）`, clue.TOL.shirt_number === SC.SHIRT_TOL);

  // 1.2 位置大类
  const a = clue.POSITION_GROUP, b = SC.POSITION_GROUP;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  const same = ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
  ok(`位置大类表一致（${ka.length} 项）`, same);

  // 1.3 年龄：全量 N 人 × 3 个参考日（题库扩容后自动跟着变）
  const keys = [DK, '2026-01-01', '2026-12-31'];
  let bad = 0;
  ALL.forEach(p => keys.forEach(k => {
    if (ageUtil.calcAge(p.birth_date, k) !== Scompare.calcAge(p.birth_date, k)) bad++;
  }));
  ok(`${ALL.length * keys.length} 组年龄计算与服务端一致`, bad === 0, { mismatched: bad });

  // 1.4 北京时间自然日：跨零点 / 月末 / 年末
  const stamps = [
    Date.parse('2026-10-11T15:59:59Z'),   // 北京 23:59:59 -> 10-11
    Date.parse('2026-10-11T16:00:00Z'),   // 北京 00:00:00 -> 10-12
    Date.parse('2026-10-12T00:30:00Z'),
    Date.parse('2026-02-28T16:30:00Z'),   // 北京 03-01
    Date.parse('2026-12-31T16:00:01Z'),   // 北京 2027-01-01
    Date.now()
  ];
  let dbad = 0;
  stamps.forEach(t => {
    if (ageUtil.beijingDateKey(t) !== SUtil.beijingDateKey(t)) dbad++;
  });
  ok(`${stamps.length} 个时间点的北京日期与服务端一致`, dbad === 0, { mismatched: dbad });
}

/* ================= 2. 单条线索的语义 ================= */
G('2. 单条线索语义');

{
  // 找一个惯用脚为"右脚"、且国籍为"巴西"的球员当"猜的人"
  const guess = ALL.find(p => p.preferred_foot === '右脚' && p.nationality === '巴西');
  ok('测试基准球员存在（右脚 / 巴西）', !!guess);

  const mk = (key, state, value, arrow, g) =>
    ({ key, state, value, arrow: arrow || null, guess: g || guess });

  // 2.1 green 精确
  const r1 = clue.filterPlayers(ALL, [mk('preferred_foot', 'green', '右脚')], DK);
  ok('绿·惯用脚 → 结果全是右脚', r1.length > 0 && r1.every(p => p.preferred_foot === '右脚'), { n: r1.length });
  ok('绿·惯用脚 → 不含左脚', r1.every(p => p.preferred_foot !== '左脚'));

  // 2.2 文字 gray 排除
  const r2 = clue.filterPlayers(ALL, [mk('nationality', 'gray', '巴西')], DK);
  ok('灰·国籍 → 结果不含巴西', r2.length > 0 && r2.every(p => p.nationality !== '巴西'));
  ok('灰·国籍 → 数量=总池-巴西籍', r2.length === ALL.length - ALL.filter(p => p.nationality === '巴西').length);

  // 2.3 amber 俱乐部 = 同联赛
  const r3 = clue.filterPlayers(ALL, [mk('club', 'amber', guess.club)], DK);
  ok('黄·俱乐部 → 结果都在同联赛', r3.length > 0 && r3.every(p => p.league === guess.league), { league: guess.league, n: r3.length });
  ok('黄·俱乐部 → 排除了猜的那位自己', r3.every(p => p.club !== guess.club));

  // 2.4 amber 位置 = 同大类
  const r4 = clue.filterPlayers(ALL, [mk('position', 'amber', guess.position)], DK);
  ok('黄·位置 → 结果都在同大类', r4.length > 0 && r4.every(p => clue.POSITION_GROUP[p.position] === clue.POSITION_GROUP[guess.position]));

  // 2.5 数值 amber + 箭头：答案更小
  const gAge = Scompare.calcAge(guess.birth_date, DK);
  const r5 = clue.filterPlayers(ALL, [mk('age', 'amber', gAge, 'up')], DK);
  const ages5 = r5.map(p => ageUtil.calcAge(p.birth_date, DK));
  ok(`黄·年龄↑(${gAge}岁) → 结果落在 ${gAge - SC.AGE_TOL}~${gAge - 1}`,
    r5.length > 0 && ages5.every(a => a >= gAge - SC.AGE_TOL && a <= gAge - 1), { n: r5.length });

  // 2.6 数值 gray + 箭头：只知道方向
  const r6 = clue.filterPlayers(ALL, [mk('height', 'gray', 180, 'down')], DK);
  ok('灰·身高↓(180) → 结果都高于 180', r6.length > 0 && r6.every(p => p.height_cm > 180), { n: r6.length });

  // 2.7 同字段多条合并：绿一定压过灰
  const r7 = clue.filterPlayers(ALL, [
    mk('preferred_foot', 'gray', '左脚'),
    mk('preferred_foot', 'green', '右脚')
  ], DK);
  ok('同字段 绿+灰 → 取绿（全是右脚）', r7.length > 0 && r7.every(p => p.preferred_foot === '右脚'));

  // 2.8 反复猜同一个人，约束不该自相矛盾
  const same = [mk('age', 'amber', 30, 'up'), mk('age', 'amber', 30, 'up')];
  ok('重复线索 → 不会筛空', clue.filterPlayers(ALL, same, DK).length > 0);

  // 2.9 约束说明文案
  const desc = clue.describeConstraints([
    mk('preferred_foot', 'green', '右脚'),
    mk('age', 'amber', gAge, 'up')
  ], DK);
  ok('约束说明按字段聚合（2 条）', desc.length === 2, desc);
  ok('惯用脚说明含「=」', desc[0].label === '惯用脚' && desc[0].op === '=');
  ok('年龄说明含区间', desc[1].label === '年龄' && desc[1].op === '∈' && /~\d+岁/.test(desc[1].text), desc[1]);
}

/* ================= 3. ★ 黄金不变量 ================= */
G('3. 黄金不变量：答案永不被筛掉');

{
  const rng = makeRng(20261012);
  const GAMES = 40;
  let checks = 0, single = 0, bad = 0, badSingle = 0;
  const shrink = [];

  for (let gi = 0; gi < GAMES; gi++) {
    const answer = DAILY_POOL[Math.floor(rng() * DAILY_POOL.length)];
    const used = [];
    const rows = [];

    for (let r = 1; r <= SC.MAX_GUESSES; r++) {
      let g;
      do { g = ALL[Math.floor(rng() * ALL.length)]; } while (used.indexOf(g.id) !== -1);
      used.push(g.id);

      rows.push({
        round: r,
        guessedId: g.id,
        verdict: Scompare.compare(g, answer, DK),
        player: g
      });

      const clues = clue.buildClues(rows);
      if (!clues.length) continue;

      // 3.1 全部线索叠加
      const hit = clue.filterPlayers(ALL, clues, DK);
      checks++;
      if (!hit.some(p => p.id === answer.id)) {
        bad++;
        if (bad <= 2) console.log(`     ↳ 漏筛：第 ${r} 轮，答案 #${answer.id} ${answer.name_cn}`);
      }

      // 3.2 每条线索单独筛
      clues.forEach(c => {
        single++;
        if (!clue.filterPlayers(ALL, [c], DK).some(p => p.id === answer.id)) {
          badSingle++;
          if (badSingle <= 2) console.log(`     ↳ 单条漏筛：${c.id} ${c.label}=${c.text}(${c.state})`);
        }
      });

      if (r === SC.MAX_GUESSES || g.id === answer.id) shrink.push(hit.length);
      if (g.id === answer.id) break;
    }
  }

  ok(`${GAMES} 局 × 每轮全部线索叠加（${checks} 次）答案都在结果里`, bad === 0, { leaked: bad });
  ok(`每条线索单独筛（${single} 次）答案都在结果里`, badSingle === 0, { leaked: badSingle });

  // 单调性：约束只增不减，候选数必然单调不增
  const more = clue.filterPlayers(ALL, clue.buildClues([
    { round: 1, verdict: Scompare.compare(ALL[0], ALL[1], DK), player: ALL[0] },
    { round: 2, verdict: Scompare.compare(ALL[2], ALL[1], DK), player: ALL[2] }
  ]), DK);
  const one = clue.filterPlayers(ALL, clue.buildClues([
    { round: 1, verdict: Scompare.compare(ALL[0], ALL[1], DK), player: ALL[0] }
  ]), DK);
  ok('线索越多，候选不会变多', more.length <= one.length, { one: one.length, more: more.length });

  const avg = shrink.reduce((a, b) => a + b, 0) / (shrink.length || 1);
  console.log(`\n  · 体验指标：8 次猜完，用上全部线索平均还剩 ${avg.toFixed(1)} 人（最少 ${Math.min(...shrink)}，最多 ${Math.max(...shrink)}）`);
  ok('全部线索叠加后确实收窄（平均 < 30 人）', avg < 30, { avg: +avg.toFixed(1) });
}

/* ================= 4. 边界 ================= */
G('4. 边界');

{
  ok('空线索 → 返回整池', clue.filterPlayers(ALL, [], DK).length === ALL.length);
  ok('空池 → 返回空', clue.filterPlayers([], clue.buildClues([
    { round: 1, verdict: Scompare.compare(ALL[0], ALL[1], DK), player: ALL[0] }
  ]), DK).length === 0);

  // 数值字段缺箭头（服务端判 gray+null）——必须视为「没有约束」，不能筛成空集
  const badClue = { key: 'shirt_number', state: 'gray', value: 0, arrow: null, guess: ALL[0] };
  ok('数值线索缺箭头 → 不出约束', clue.describeConstraints([badClue], DK).length === 0);
  ok('数值线索缺箭头 → 不缩池', clue.filterPlayers(ALL, [badClue], DK).length === ALL.length);

  // 空值文本线索
  const emptyTxt = { key: 'club', state: 'gray', value: '', arrow: null, guess: ALL[0] };
  ok('空值文本线索 → 不出约束', clue.describeConstraints([emptyTxt], DK).length === 0);

  // 缺 guess 的 amber 俱乐部（拿不到联赛）→ 退化为「排除这个俱乐部」，
  // 但绝不能变成"随便筛"（答案仍须在结果里，由第 3 组统一守着）
  const base = ALL.find(p => p.preferred_foot === '右脚' && p.nationality === '巴西');
  const noGuess = { key: 'club', state: 'amber', value: base.club, arrow: null, guess: null };
  const dNo = clue.describeConstraints([noGuess], DK);
  const rNo = clue.filterPlayers(ALL, [noGuess], DK);
  ok('黄·俱乐部缺参照球员 → 退化为排除该俱乐部',
    dNo.length === 1 && dNo[0].op === '≠' && rNo.every(p => p.club !== base.club), dNo);
  ok('黄·俱乐部缺参照球员 → 数量=总池-该俱乐部', rNo.length === ALL.length - ALL.filter(p => p.club === base.club).length);

  // 缺 birth_date 的球员不会被算错年龄而误杀
  const ghost = { id: 99999, name_cn: '无生日', nationality: '巴西', club: 'X', league: 'Y', position: '中锋', preferred_foot: '右脚' };
  const rGhost = clue.filterPlayers([ghost], [{
    key: 'age', state: 'gray', value: 30, arrow: 'up', guess: ALL[0]
  }], DK);
  ok('没有生日数据的球员能被安全跳过（不崩、不误留）', rGhost.length === 0);

  ok('buildClues 从对局行里抽满 8 条', clue.buildClues([
    { round: 1, verdict: Scompare.compare(ALL[0], ALL[1], DK), player: ALL[0] }
  ]).length === 8);
}

/* ================= 5. 分布与抽样合理性 ================= */
G('5. 结果分布');

{
  // 绿·惯用脚：筛出的人应当是左右脚的真实分布，而不是全绿或全灰
  const r = clue.filterPlayers(ALL, [{ key: 'preferred_foot', state: 'green', value: '右脚', arrow: null, guess: ALL[0] }], DK);
  const expect = ALL.filter(p => p.preferred_foot === '右脚').length;
  ok('筛选数量与逐条手工统计一致', r.length === expect, { got: r.length, expect });

  // 覆盖每个字段都能单独筛出非空结果
  const fields = ['nationality', 'club', 'league', 'position', 'height', 'shirt_number', 'preferred_foot'];
  let empty = [];
  fields.forEach(k => {
    const g = ALL[10];
    const v = clue.valueOf(g, k, DK);
    const c = { key: k, state: 'green', value: v, arrow: k === 'height' || k === 'shirt_number' ? 'equal' : null, guess: g };
    if (clue.filterPlayers(ALL, [c], DK).length === 0) empty.push(k);
  });
  ok('每个字段都能筛出非空结果', empty.length === 0, empty);
}

/* ================= 6. 去重等价性（候选面板用） ================= */
G('6. 线索去重：合并重复标签不改变筛选结果');

{
  const rng = makeRng(20261025);
  const GAMES = 40;
  let eqAll = 0, eqDesc = 0, remapBad = 0, dupSaved = 0, totalBefore = 0, totalAfter = 0;

  for (let gi = 0; gi < GAMES; gi++) {
    const answer = DAILY_POOL[Math.floor(rng() * DAILY_POOL.length)];
    const used = [];
    const rows = [];

    for (let r = 1; r <= 6; r++) {
      let g;
      do { g = ALL[Math.floor(rng() * ALL.length)]; } while (used.indexOf(g.id) !== -1);
      used.push(g.id);
      rows.push({ round: r, guessedId: g.id, verdict: Scompare.compare(g, answer, DK), player: g });
    }

    const all = clue.buildClues(rows);
    const { clues, idRemap } = clue.dedupeClues(all);
    totalBefore += all.length;
    totalAfter += clues.length;
    if (all.length > clues.length) dupSaved++;

    // 6.1 去重前后：全量线索的筛选结果、约束说明必须一致（答案仍在）
    const hitA = clue.filterPlayers(ALL, all, DK);
    const hitB = clue.filterPlayers(ALL, clues, DK);
    if (hitA.length !== hitB.length || hitA.some((p, i) => p.id !== hitB[i].id)) eqAll++;
    const dA = JSON.stringify(clue.describeConstraints(all, DK));
    const dB = JSON.stringify(clue.describeConstraints(clues, DK));
    if (dA !== dB) eqDesc++;

    // 6.2 任取被合并掉的重复项当初始条件，remap 必须把它指到仍存在的代表 id 上
    Object.keys(idRemap).forEach(id => {
      if (id === idRemap[id]) return;   // 保留项不动
      const rep = clues.filter(c => c.id === idRemap[id])[0];
      if (!rep) { remapBad++; return; }
      // 代表与被合并项「同字段同值同判定」——单条筛选结果也应一致
      const orig = all.filter(c => c.id === id)[0];
      const rA = clue.filterPlayers(ALL, [orig], DK).map(p => p.id);
      const rB = clue.filterPlayers(ALL, [rep], DK).map(p => p.id);
      if (JSON.stringify(rA) !== JSON.stringify(rB)) remapBad++;
    });
  }

  ok(`去重不改变全量筛选结果（${GAMES} 局）`, eqAll === 0, { diff: eqAll });
  ok(`去重不改变约束说明（${GAMES} 局）`, eqDesc === 0, { diff: eqDesc });
  ok(`被合并项的单条筛选与代表项一致 + remap 指向存在线索`, remapBad === 0, { bad: remapBad });
  ok('多行猜测确实会被去重压掉重复标签', dupSaved > 0 && totalAfter < totalBefore,
    { before: totalBefore, after: totalAfter, dedupedGames: dupSaved });

  // 6.3 归组排序：同字段挨在一起，顺序与 CLUE_META 一致（面板横条按字段分组展示）
  {
    const { clues } = clue.dedupeClues(clue.buildClues([
      { round: 1, verdict: Scompare.compare(ALL[3], ALL[1], DK), player: ALL[3] },
      { round: 2, verdict: Scompare.compare(ALL[4], ALL[1], DK), player: ALL[4] }
    ]));
    const metaOrder = require('../miniprogram/utils/theme.js').CLUE_META.map(m => m.key);
    let idx = 0, grouped = true;
    clues.forEach(c => {
      const at = metaOrder.indexOf(c.key);
      if (at < idx) grouped = false;   // 字段序号倒退 = 没归好组
      idx = at;
    });
    ok('去重后按字段归组（国籍一组、俱乐部一组…）', grouped);
  }
  console.log(`  · 体验指标：${GAMES} 局共 ${totalBefore} 条线索去重后剩 ${totalAfter} 条`);
}

/* ---------- 汇总 ---------- */
console.log(`\n${'='.repeat(46)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n待修：');
  fails.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
