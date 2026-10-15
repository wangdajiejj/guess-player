/**
 * 比对算法 + 抽样算法单元测试（零依赖，直接 node 运行）
 *   node scripts/test-compare.js
 *
 * 覆盖 docs/03-algorithm.md §3.3 的全部边界用例 B1-B11。
 */
const assert = require('assert');
const path = require('path');

// require 的是同步到云函数目录的副本，顺带验证同步没坏
const { compare, calcAge, isHit } = require(path.join(__dirname, '..', 'cloudfunctions', 'gameGuess', 'compare.js'));
const U = require(path.join(__dirname, '..', 'cloudfunctions', 'gameGuess', 'util.js'));

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); fail++; }
}

const P = (o) => Object.assign({
  id: 0, name_cn: '', nationality: '', club: '', league: '',
  position: '', position_group: '', birth_date: '1990-01-01',
  height_cm: 0, preferred_foot: '', shirt_number: 0
}, o);

console.log('\n== 周岁计算 ==');
it('生日已过 -> 正常计龄', () => {
  assert.strictEqual(calcAge('1987-06-24', '2026-10-10'), 39);
});
it('生日未到 -> 少一岁', () => {
  assert.strictEqual(calcAge('1987-12-24', '2026-10-10'), 38);
});
it('生日当天 -> 已满周岁', () => {
  assert.strictEqual(calcAge('2000-07-21', '2026-07-21'), 26);
});

console.log('\n== 边界用例 B1-B11 ==');
const REF = '2026-10-10';

it('B1 身高差 3（公差内）-> amber + down', () => {
  const v = compare(P({ height_cm: 170 }), P({ height_cm: 173 }), REF).height;
  assert.strictEqual(v.state, 'amber');
  assert.strictEqual(v.arrow, 'down');
});
it('B2 身高差 4（超公差）-> gray + down', () => {
  const v = compare(P({ height_cm: 170 }), P({ height_cm: 174 }), REF).height;
  assert.strictEqual(v.state, 'gray');
  assert.strictEqual(v.arrow, 'down');
});
it('B3 年龄相等 -> green + equal（不能出现 amber+equal）', () => {
  const v = compare(P({ birth_date: '2001-01-01' }), P({ birth_date: '2001-01-01' }), REF).age;
  assert.strictEqual(v.state, 'green');
  assert.strictEqual(v.arrow, 'equal');
});
it('B4 答案身高缺失(0) -> gray + arrow null', () => {
  const v = compare(P({ height_cm: 180 }), P({ height_cm: 0 }), REF).height;
  assert.strictEqual(v.state, 'gray');
  assert.strictEqual(v.arrow, null);
});
it('B5 前腰 vs 后腰 -> amber（同 MF）', () => {
  const v = compare(P({ position: '前腰', position_group: 'MF' }),
                    P({ position: '后腰', position_group: 'MF' }), REF).position;
  assert.strictEqual(v.state, 'amber');
});
it('B6 左后卫 vs 中后卫 -> amber（同 DF）', () => {
  const v = compare(P({ position: '左后卫', position_group: 'DF' }),
                    P({ position: '中后卫', position_group: 'DF' }), REF).position;
  assert.strictEqual(v.state, 'amber');
});
it('B7 门将 vs 门将 -> green', () => {
  const v = compare(P({ position: '门将', position_group: 'GK' }),
                    P({ position: '门将', position_group: 'GK' }), REF).position;
  assert.strictEqual(v.state, 'green');
});
it('B8 中锋 vs 右边锋 -> amber（同 FW）', () => {
  const v = compare(P({ position: '中锋', position_group: 'FW' }),
                    P({ position: '右边锋', position_group: 'FW' }), REF).position;
  assert.strictEqual(v.state, 'amber');
});
it('B8b 右后卫 vs 前腰 -> gray（DF vs MF）', () => {
  const v = compare(P({ position: '右后卫', position_group: 'DF' }),
                    P({ position: '前腰', position_group: 'MF' }), REF).position;
  assert.strictEqual(v.state, 'gray');
});
it('B9 双脚 vs 左脚 -> gray（双脚是独立取值）', () => {
  const v = compare(P({ preferred_foot: '左脚' }), P({ preferred_foot: '双脚' }), REF).preferred_foot;
  assert.strictEqual(v.state, 'gray');
});
it('B9b 双脚 vs 双脚 -> green', () => {
  const v = compare(P({ preferred_foot: '双脚' }), P({ preferred_foot: '双脚' }), REF).preferred_foot;
  assert.strictEqual(v.state, 'green');
});
it('B10 曼城 vs 曼联（同英超）-> amber', () => {
  const v = compare(P({ club: '曼城', league: '英超' }),
                    P({ club: '曼联', league: '英超' }), REF).club;
  assert.strictEqual(v.state, 'amber');
});
it('B10b 曼城 vs 皇马（跨联赛）-> gray', () => {
  const v = compare(P({ club: '曼城', league: '英超' }),
                    P({ club: '皇家马德里', league: '西甲' }), REF).club;
  assert.strictEqual(v.state, 'gray');
});
it('B11 退役传奇之间正常比对（非「已退役」）', () => {
  const v = compare(P({ club: '皇家马德里', league: '西甲', active: false }),
                    P({ club: 'AC米兰', league: '意甲', active: false }), REF);
  assert.strictEqual(v.club.state, 'gray');
  assert.strictEqual(v.league.state, 'gray');
});

console.log('\n== 球衣号 ==');
it('号差 1 -> amber', () => {
  const v = compare(P({ shirt_number: 8 }), P({ shirt_number: 7 }), REF).shirt_number;
  assert.strictEqual(v.state, 'amber');
});
it('号差 10 -> gray', () => {
  const v = compare(P({ shirt_number: 18 }), P({ shirt_number: 8 }), REF).shirt_number;
  assert.strictEqual(v.state, 'gray');
});
it('号码相等 -> green + equal', () => {
  const v = compare(P({ shirt_number: 10 }), P({ shirt_number: 10 }), REF).shirt_number;
  assert.strictEqual(v.state, 'green');
  assert.strictEqual(v.arrow, 'equal');
});

console.log('\n== 命中判定 ==');
it('按数字主键 id 判命中', () => {
  assert.strictEqual(isHit({ id: 3 }, { id: 3 }), true);
  assert.strictEqual(isHit({ id: 3 }, { id: 4 }), false);
});
it('同名不同 id 不算命中（防重名误判）', () => {
  assert.strictEqual(isHit(P({ id: 1, name_cn: '哈兰德' }), P({ id: 2, name_cn: '哈兰德' })), false);
});

console.log('\n== 每日抽样 ==');
const pool = Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));

it('同一 user 同一天 -> 答案固定', () => {
  const a = U.pickDailyAnswer(pool, { salt: 'S', dateKey: '2026-10-10', openid: 'u1', mode: 'per_user' });
  const b = U.pickDailyAnswer(pool, { salt: 'S', dateKey: '2026-10-10', openid: 'u1', mode: 'per_user' });
  assert.strictEqual(a.id, b.id);
});
it('不同 user 同一天 -> per_user 模式下大概率不同', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    seen.add(U.pickDailyAnswer(pool, { salt: 'S', dateKey: '2026-10-10', openid: 'u' + i, mode: 'per_user' }).id);
  }
  assert.ok(seen.size >= 15, `仅离散出 ${seen.size}/20 个答案，分布异常`);
});
it('global 模式 -> 不同 user 答案一致', () => {
  const a = U.pickDailyAnswer(pool, { salt: 'S', dateKey: '2026-10-10', openid: 'u1', mode: 'global' });
  const b = U.pickDailyAnswer(pool, { salt: 'S', dateKey: '2026-10-10', openid: 'u2', mode: 'global' });
  assert.strictEqual(a.id, b.id);
});
it('同一 user 不同天 -> 答案会变', () => {
  const seen = new Set();
  for (let d = 1; d <= 30; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    seen.add(U.pickDailyAnswer(pool, { salt: 'S', dateKey: day, openid: 'u1', mode: 'per_user' }).id);
  }
  assert.ok(seen.size >= 20, `30 天只出现 ${seen.size} 个不同答案，分布过于集中`);
});
it('索引永远落在池内', () => {
  for (let i = 0; i < 300; i++) {
    const p = U.pickDailyAnswer(pool, { salt: 'S', dateKey: '2026-10-10', openid: 'u' + i, mode: 'per_user' });
    assert.ok(p && p.id >= 1 && p.id <= 200);
  }
});
it('无限模式落在池内', () => {
  for (let i = 0; i < 300; i++) {
    const p = U.pickEndlessAnswer(pool);
    assert.ok(p && p.id >= 1 && p.id <= 200);
  }
});
it('空池返回 null，不崩溃', () => {
  assert.strictEqual(U.pickDailyAnswer([], { salt: 'S', dateKey: 'd', openid: 'u' }), null);
  assert.strictEqual(U.pickEndlessAnswer([]), null);
});

console.log('\n== 时区（北京时间自然日）==');
it('UTC 23:30 应归属北京时间次日', () => {
  // 2026-10-10T15:30Z = 北京时间 2026-10-10 23:30 -> 仍是 10-10
  const d1 = new Date('2026-10-10T15:30:00Z').getTime();
  assert.strictEqual(U.beijingDateKey(d1), '2026-10-10');
  // 2026-10-10T16:30Z = 北京时间 2026-10-11 00:30 -> 已是 10-11
  const d2 = new Date('2026-10-10T16:30:00Z').getTime();
  assert.strictEqual(U.beijingDateKey(d2), '2026-10-11');
});

console.log('\n== 字段裁剪（防答案泄露）==');
it('publicGame 不含 answerId', () => {
  const g = U.publicGame({ gameId: 'g1', mode: 'daily', dateKey: '2026-10-10', answerId: 42, maxGuesses: 8, guessIds: [], status: 'playing' }, []);
  assert.ok(!('answerId' in g));
  assert.ok(!JSON.stringify(g).includes('42'));
});
it('publicGame 剩余次数计算正确', () => {
  const g = U.publicGame({ gameId: 'g1', maxGuesses: 8, guessIds: [1, 2, 3], status: 'playing' }, []);
  assert.strictEqual(g.used, 3);
  assert.strictEqual(g.remaining, 5);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
