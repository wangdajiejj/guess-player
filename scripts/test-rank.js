/**
 * 排行榜测试 —— 分数口径 + 等宽编码 + 托管 KV 约束 + 最佳记录
 *
 *   node scripts/test-rank.js
 *
 * 为什么值得测（这个模块的 bug 全是"不报错但悄悄排错序"）：
 *   1. 微信开放数据域按 value 的**字典序**排序。不补零时 "900" > "1000"，
 *      排行榜会静默错序 —— 而且看起来完全正常，只是第一名不对。
 *   2. 托管 KV 有硬性上限（128 个 key、单 value 1KB、必须是字符串），
 *      超了是**运行时**才报错，本地开发时碰不到。
 *   3. 得分公式在 storage 和 rank 两处各有一份，漂移后榜上分数和结果页对不上。
 *
 * ⚠️ 注意：本文件测的是**平台无关的数据层**。
 *    `wx.setUserCloudStorage` 等小游戏 API 在小程序里不存在，
 *    真正的开放数据域渲染要等架构切到 Canvas 之后再补。
 */
const path = require('path');

/* ---- mock 小程序运行时（storage.js 依赖 getApp() + wx.*） ---- */
const store = {};
global.getApp = () => ({
  globalData: {
    playerCacheKey: 'gp_players',
    playerVersionKey: 'gp_players_version',
    lastGameIdKey: 'gp_last_gameid',
    settingsKey: 'gp_settings',
    statsKey: 'gp_stats',
    bestKey: 'gp_best'
  }
});
global.wx = {
  getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: k => { delete store[k]; }
};

const R = require('../miniprogram/utils/rank.js');
const S = require('../miniprogram/utils/storage.js');
const C = require('../cloudfunctions/_shared/constants.js');

let pass = 0, fail = 0;
const fails = [];
function G(name) { console.log(`\n== ${name} ==`); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else {
    fail++; fails.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`);
  }
}
function eq(name, a, b) { ok(name, a === b, { actual: a, expect: b }); }

console.log('排行榜测试（分数口径 + 等宽编码 + KV 约束 + 最佳记录）\n');
console.log(`最大猜测次数 MAX_GUESSES = ${C.MAX_GUESSES}`);

/* ================= 1. 得分口径 ================= */
G('1. 得分口径');
{
  // 与云函数 gameGuess 的口径一致：score = (MAX + 1 - used) * 100
  for (let used = 1; used <= C.MAX_GUESSES; used++) {
    eq(`猜 ${used} 次 = ${(C.MAX_GUESSES + 1 - used) * 100} 分`,
      R.scoreOf(used, C.MAX_GUESSES), (C.MAX_GUESSES + 1 - used) * 100);
  }
  // 一步猜中应该是最高分，最后一步是最低分
  ok('步数越少分越高', R.scoreOf(1) > R.scoreOf(8));
  eq('最后一步猜中 = 100 分', R.scoreOf(C.MAX_GUESSES), 100);

  // 边界：used 越界要被夹住，不能算出 0 分或负分
  eq('used=0 夹到 1', R.scoreOf(0), R.scoreOf(1));
  eq('used=99 夹到最大', R.scoreOf(99), R.scoreOf(C.MAX_GUESSES));
  eq('used=undefined 夹到 1', R.scoreOf(undefined), R.scoreOf(1));
  ok('得分恒为正', R.scoreOf(8) > 0);

  // 和 storage 里 recordGame 的算式对拍（这是最容易被改漏的一处）
  Object.keys(store).forEach(k => delete store[k]);
  S.recordGame(true, 3, 'g_x', C.MAX_GUESSES);
  const s = S.loadStats();
  eq('storage 累计得分 = rank.scoreOf', s.scoreSum, R.scoreOf(3, C.MAX_GUESSES));
  eq('storage 最少步数', s.bestSteps, 3);
}

/* ================= 2. 等宽编码（核心） ================= */
G('2. 等宽编码：字典序必须等于数值序');
{
  // 这一组是整个文件存在的理由：微信按字符串排序
  const vals = [0, 1, 9, 10, 99, 100, 900, 1000, 99999];
  const padded = vals.map(v => R.pad(v, 6));

  ok('全部等宽', padded.every(p => p.length === 6), padded);
  ok('纯数字补齐（没有 NaN/undefined）', padded.every(p => /^[0-9]+$/.test(p)), padded);

  // 关键断言：字符串排序结果 == 数值排序结果
  const byStr = padded.slice().sort();                                  // 字典序
  const byNum = vals.slice().sort((a, b) => a - b).map(v => R.pad(v, 6)); // 数值序
  ok('字符串排序 == 数值排序', JSON.stringify(byStr) === JSON.stringify(byNum),
    { 字典序: byStr, 数值序: byNum });

  // 反例：不补零就会错 —— 用断言把"为什么必须补零"钉住
  const raw = vals.map(v => String(v));
  const badStr = raw.slice().sort();
  const goodStr = vals.slice().sort((a, b) => a - b).map(String);
  ok('不补零时字典序确实会错（证明补零必要）',
    JSON.stringify(badStr) !== JSON.stringify(goodStr), { bad: badStr, good: goodStr });

  // 往返
  ok('unpad(pad(x)) 往返一致',
    vals.every(v => R.unpad(R.pad(v, 6)) === v));
  eq('unpad 空串 = 0', R.unpad(''), 0);
  eq('unpad 非数字 = 0', R.unpad('abc'), 0);
}

/* ================= 3. 指标计算 ================= */
G('3. 指标：不能出现 NaN');
{
  const m0 = R.metricsOf({ played: 0, won: 0 });
  eq('0 局时胜率 = 0（不产生 NaN）', m0.winRate, 0);
  eq('0 局时积分 = 0', m0.score, 0);
  eq('0 局时最少步数 = 0', m0.best, 0);
  ok('0 局时无 NaN', Object.keys(m0).every(k => !isNaN(m0[k])), m0);

  const m1 = R.metricsOf({ played: 4, won: 3, scoreSum: 1500, bestSteps: 3, streak: 2 });
  eq('胜率按千分比（3/4 -> 750）', m1.winRate, 750);
  eq('积分透传', m1.score, 1500);
  ok('非空统计无 NaN', Object.keys(m1).every(k => !isNaN(m1[k])), m1);

  // 胜率上限 1000，且必须是整数（字符串化后不能有小数点）
  const m2 = R.metricsOf({ played: 3, won: 3 });
  eq('全胜 = 1000', m2.winRate, 1000);
  ok('胜率是整数（不含小数）', String(m2.winRate).indexOf('.') === -1);
}

/* ================= 4. 托管 KV 约束 ================= */
G('4. 托管 KV：微信的硬性上限');
{
  Object.keys(store).forEach(k => delete store[k]);
  S.recordGame(true, 2, 'g_1', C.MAX_GUESSES);
  S.recordGame(false, 8, 'g_2', C.MAX_GUESSES);
  S.recordGame(true, 5, 'g_3', C.MAX_GUESSES);
  const kv = R.toKV(S.loadStats());

  ok(`key 数 <= 128（实际 ${kv.length}）`, kv.length <= 128, kv.length);
  ok('value 全部是字符串', kv.every(x => typeof x.value === 'string'), kv);
  ok('key 全部是字符串', kv.every(x => typeof x.key === 'string'));
  ok('单 value <= 1KB', kv.every(x => x.value.length <= 1024),
    kv.map(x => x.key + '=' + x.value.length));
  ok('key 名 <= 128 字节', kv.every(x => Buffer.byteLength(x.key) <= 128));
  ok('value 都是纯数字（可字典序排序）', kv.every(x => /^[0-9]+$/.test(x.value)),
    kv.map(x => x.value));

  // key 必须带前缀，避免和别的数据撞名
  ok('key 都带 gp_ 前缀', kv.every(x => x.key.indexOf(R.KV_PREFIX) === 0),
    kv.map(x => x.key));

  // 排序键必须真的在列表里 —— 指一个不存在的 key 会导致整榜不排序
  ok('sortKey 在 KV 列表里', kv.some(x => x.key === R.sortKey()), R.sortKey());

  // 往返
  const back = R.fromKV(kv);
  eq('往返后积分一致', back.score, S.loadStats().scoreSum);
  // g_1 用 2 步猜中，g_3 用 5 步 —— 最少步数取 2，不是 3
  eq('往返后最少步数一致', back.best, 2);
  ok('往返后无 NaN', Object.keys(back).every(k => !isNaN(back[k])), back);

  // 脏数据不能炸
  eq('空列表解析为空对象', Object.keys(R.fromKV([])).length, 0);
  eq('忽略非本前缀的 key',
    Object.keys(R.fromKV([{ key: 'other', value: '1' }])).length, 0);
  eq('忽略未知字段', Object.keys(R.fromKV([{ key: 'gp_zzz', value: '1' }])).length, 0);
  ok('遇到 null 项不炸', Object.keys(R.fromKV([null, undefined])).length === 0);
}

/* ================= 5. 最佳记录 ================= */
G('5. 最佳记录：排序 / 去重 / 上限');
{
  Object.keys(store).forEach(k => delete store[k]);

  // 没猜中的局不进榜（没有步数可比，塞进去会冲淡榜单）
  R.recordBest({ gameId: 'g_lose', used: 8, won: false, date: '2026-10-15' });
  eq('没猜中不进榜', R.loadBest().length, 0);

  // 按得分降序
  R.recordBest({ gameId: 'a', used: 5, won: true, date: '2026-10-15', mode: 'daily' });
  R.recordBest({ gameId: 'b', used: 2, won: true, date: '2026-10-15', mode: 'daily' });
  R.recordBest({ gameId: 'c', used: 3, won: true, date: '2026-10-15', mode: 'daily' });
  let list = R.loadBest();
  eq('进了 3 条', list.length, 3);
  eq('第一步最快（2 步）', list[0].used, 2);
  eq('最后是最慢的（5 步）', list[2].used, 5);
  ok('按得分降序', list[0].score >= list[1].score && list[1].score >= list[2].score,
    list.map(x => x.score));

  // gameId 去重：结果页可能被多次进入
  const before = R.loadBest().length;
  R.recordBest({ gameId: 'b', used: 2, won: true, date: '2026-10-15' });
  eq('同一 gameId 不重复计入', R.loadBest().length, before);

  // 上限
  Object.keys(store).forEach(k => delete store[k]);
  for (let i = 0; i < 50; i++) {
    R.recordBest({
      gameId: 'g' + i, used: (i % 8) + 1, won: true,
      date: '2026-10-' + String((i % 28) + 1), playerName: 'P' + i
    });
  }
  list = R.loadBest();
  eq(`最多保留 ${R.BEST_LIMIT} 条`, list.length, R.BEST_LIMIT);
  // 50 局里 1 步猜中的只有 7 个，填满 10 条必然混入 2 步的 ——
  // 所以不能断言"全是 1 步"，该断言的是**单调性**：留下的不比后面的慢
  ok('留下的按步数升序（快的排前面）',
    list.every((x, i) => i === 0 || list[i - 1].used <= x.used), list.map(x => x.used));
  eq('榜首是最快的一局', list[0].used, 1);
  ok('没有更慢的挤在前面',
    list.every(x => x.used <= 2), list.map(x => x.used));

  // 数据规整
  R.recordBest({ gameId: 'gx', used: 99, won: true, date: '2026-10-15' });
  ok('used 越界被夹住', R.loadBest().every(x => x.used >= 1 && x.used <= 8));

  // 清空
  R.clearBest();
  eq('清空后为 0 条', R.loadBest().length, 0);
}

/* ================= 6. 与 storage 联动 ================= */
G('6. 与 storage 联动');
{
  Object.keys(store).forEach(k => delete store[k]);
  // 模拟 10 局：5 胜 5 负
  for (let i = 0; i < 10; i++) {
    S.recordGame(i % 2 === 0, (i % 8) + 1, 'g' + i, C.MAX_GUESSES);
  }
  const s = S.loadStats();
  eq('已玩 10 局', s.played, 10);
  eq('猜中 5 局', s.won, 5);
  // 逐局手算一遍期望值，不复用被测代码 —— 否则公式写错了测试也跟着错
  let expect = 0;
  for (let i = 0; i < 10; i += 2) expect += (C.MAX_GUESSES + 1 - ((i % 8) + 1)) * 100;
  eq('得分累计正确（手算对拍）', s.scoreSum, expect, expect);
  eq('最少步数 = 1', s.bestSteps, 1);

  // 清战绩时最佳记录必须一起清，否则会留下孤儿数据
  R.recordBest({ gameId: 'gz', used: 1, won: true, date: '2026-10-15' });
  ok('清战绩前有记录', R.loadBest().length > 0);
  S.clearStats();
  eq('清战绩后最佳记录也清空', R.loadBest().length, 0);
  eq('清战绩后统计归零', S.loadStats().played, 0);
}

/* ================= 汇总 ================= */
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  fails.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
