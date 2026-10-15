/**
 * 本地 Mock 模式测试 —— 在 node 里把整局游戏打完
 *
 *   node scripts/test-mock.js
 *
 * 为什么要这一层：Mock 是给「还没配云环境的人」用的第一入口，
 * 它要是坏的，用户打开开发者工具第一眼就是白屏，而我们在这儿能先花 1 秒发现。
 *
 * 做法：给 require 进来 mock-api.js 之前塞一个 wx 替身（只实现 storage 三件套），
 * 于是客户端代码能在 node 里原样跑起来。
 * 校验的重点是「和真云函数的契约是否一致」—— 错码、字段、泄露守卫都过一遍。
 */
const path = require('path');

/* ---------- wx 替身（必须在 require mock-api 之前装好） ---------- */
const mem = {};
global.wx = {
  getStorageSync: k => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete mem[k]; }
};

const M = require('../miniprogram/utils/mock-api.js');
const C = require('../miniprogram/utils/mock-constants.js');
const U = require('../miniprogram/utils/mock-util.js');

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;

function G(name) { console.log(`\n== ${name} ==`); }

function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`); }
}

function eq(name, actual, expect) { ok(name, actual === expect, { actual, expect }); }

/* ---------- 准备 ---------- */
const FULL = path.join(__dirname, '../database/players.full.jsonl');
const rows = require('fs').readFileSync(FULL, 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));
console.log(`数据集：${path.basename(FULL)}（${rows.length} 条）`);

M.resetGames();
const ANY = () => rows[Math.floor(Math.random() * rows.length)].id;

/* ---------- 1. getPlayers ---------- */
G('候选池下发');
{
  const r = M.getPlayers('');
  ok('返回 ok', r.ok === true, r);
  ok('fresh=true（首次拉取）', r.data.fresh === true);
  eq('下发人数', r.data.count, rows.length);

  const p0 = r.data.players[0];
  const keys = Object.keys(p0);
  ok('字段与 CLIENT_FIELDS 完全一致',
    keys.length === C.CLIENT_FIELDS.length && C.CLIENT_FIELDS.every(f => f in p0), keys);
  ['search_index', 'intro', 'fun_fact', 'fame_level', 'data_as_of'].forEach(f => {
    ok(`不下发 ${f}`, !(f in p0));
  });
  ok('含队色（程序化头像要用）', !!p0.primary_color && !!p0.secondary_color);

  const again = M.getPlayers(r.data.version);
  ok('版本号相同时 fresh=false（省流量）', again.data.fresh === false && again.data.count === 0);
}

/* ---------- 2. 每日一题：开局幂等 ---------- */
G('每日一题开局');
const dateKey = U.beijingDateKey();
const g1 = M.gameStart('daily');
{
  const d = g1.data;
  ok('开局成功', g1.ok === true, g1);
  eq('mode', d.mode, 'daily');
  eq('dateKey 为北京今天', d.dateKey, dateKey);
  eq('初始已用次数', d.used, 0);
  eq('剩余次数', d.remaining, C.MAX_GUESSES);
  eq('状态', d.status, 'playing');
  eq('初始分数', d.score, 0);
  ok('无历史线索行', d.rows.length === 0);
  ok('返回体不含 answerId', JSON.stringify(d).indexOf('answerId') === -1);

  const g2 = M.gameStart('daily');
  eq('幂等：再次开局 gameId 不变', g2.data.gameId, d.gameId);

  const answer = M.peekTodayAnswer();
  ok('答案在题目里', !!answer);
  ok(`每日答案知名度 ≥ ${C.MIN_FAME_DAILY}`, answer.fame_level >= C.MIN_FAME_DAILY,
    { name: answer.name_cn, fame: answer.fame_level });
}

/* ---------- 3. 答案泄露守卫 ---------- */
G('答案泄露守卫');
{
  const r = M.gameResult(g1.data.gameId);
  ok('未终局时拒绝揭晓', r.ok === false && r.code === C.CODE.GAME_FINISHED, r);
  ok('错误信息可读', !!r.msg, r.msg);

  const bad = M.gameResult('g_not_exist');
  eq('不存在的对局', bad.code, C.CODE.GAME_NOT_FOUND);

  const empty = M.gameResult('');
  eq('空 gameId', empty.code, C.CODE.INVALID_PARAM);
}

/* ---------- 4. 猜测流程 ---------- */
G('猜测与判定');
const picked = M.peekTodayAnswer();
const wrongIds = rows.filter(p => p.id !== picked.id).slice(0, 12).map(p => p.id);
{
  const r = M.gameGuess(g1.data.gameId, 999999);
  eq('不存在的球员', r.code, C.CODE.PLAYER_NOT_FOUND);

  const first = M.gameGuess(g1.data.gameId, wrongIds[0]);
  ok('猜错返回 ok', first.ok === true, first);
  eq('第 1 次：used', first.data.used, 1);
  eq('第 1 次：remaining', first.data.remaining, C.MAX_GUESSES - 1);
  eq('第 1 次：hit', first.data.hit, false);
  eq('第 1 次：status', first.data.status, 'playing');
  ok('verdict 覆盖全部线索', C.CLUE_ORDER.every(k => k in first.data.verdict),
    Object.keys(first.data.verdict));
  ok('verdict 每项含 state/value', C.CLUE_ORDER.every(
    k => first.data.verdict[k] && 'state' in first.data.verdict[k] && 'value' in first.data.verdict[k]));

  const dup = M.gameGuess(g1.data.gameId, wrongIds[0]);
  eq('重复猜测', dup.code, C.CODE.DUPLICATE_GUESS);
  ok('重复猜测不消耗次数',
    M.gameResume(g1.data.gameId).data.used === 1);

  const rd = M.gameResume(g1.data.gameId);
  eq('重放行数', rd.data.rows.length, 1);
  eq('重放行 round', rd.data.rows[0].round, 1);
  ok('重放行自带球员信息（前端不必再查本地池）', !!rd.data.rows[0].player.name_cn);
  ok('重放行也不含 answerId', JSON.stringify(rd.data).indexOf('answerId') === -1);
}

/* ---------- 5. 猜中并揭晓 ---------- */
G('猜中 → 揭晓');
{
  const win = M.gameGuess(g1.data.gameId, picked.id);
  ok('猜中', win.data.hit === true, win);
  eq('状态', win.data.status, 'won');
  eq('分数 = (8+1-used)*100', win.data.score, (C.MAX_GUESSES + 1 - win.data.used) * 100);

  const over = M.gameGuess(g1.data.gameId, wrongIds[1]);
  eq('终局后不能再猜', over.code, C.CODE.GAME_FINISHED);

  const r = M.gameResult(g1.data.gameId);
  ok('揭晓成功', r.ok === true, r);
  eq('返回人数', r.data.used, 2);
  eq('答案 id 正确', r.data.answer.id, picked.id);
  ok('答案带年龄（服务端算好）', typeof r.data.answer.age === 'number', r.data.answer.age);
  ok('答案带梗', 'meme' in r.data.answer);
  ok('答案不含 search_index', !('search_index' in r.data.answer));
  ok('答案不含 fame_level', !('fame_level' in r.data.answer));
  eq('线索行数与已用次数一致', r.data.rows.length, r.data.used);
}

/* ---------- 6. 输局 + 无限模式 ---------- */
G('输局与自由练习');
{
  const e1 = M.gameStart('endless');
  const e2 = M.gameStart('endless');
  ok('无限模式可连开多局', e1.data.gameId !== e2.data.gameId);

  // 打一局必输的：前 20 个球员挨个猜。
  // 万一其中一个正好是答案就变成"赢了"，那就换一局再来。
  let last = null, gid = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    gid = M.gameStart('endless').data.gameId;
    last = null;
    for (let i = 0; i < C.MAX_GUESSES; i++) {
      const res = M.gameGuess(gid, rows[i].id);
      if (!res.ok) break;
      last = res;
      if (res.data.status !== 'playing') break;
    }
    if (last && last.data.status === 'lost') break;
  }
  ok('8 次耗尽判负', last && last.data.status === 'lost', last && last.data);
  eq('失败不得分', last.data.score, 0);
  eq('剩余 0 次', last.data.remaining, 0);

  const r = M.gameResult(gid);
  ok('输了也能看答案', r.ok === true && r.data.answer.id > 0, r);
  eq('状态', r.data.status, 'lost');
}

/* ---------- 7. 打包红线 ---------- */
G('打包体积');
{
  const fs = require('fs');
  const f = path.join(__dirname, '../miniprogram/utils/mock-players.js');
  const kb = Math.round(fs.statSync(f).size / 1024);
  // 小程序主包 2MB 红线，这块是最占地方的一坨
  ok(`mock-players.js ${kb} KB，占主包不到 10%`, kb < 200, kb);
}

/* ---------- 8. SHA-256 实现正确性 ---------- */
G('SHA-256（每日答案的唯一依赖）');
{
  // 小程序里没有 crypto 模块，抽样要用手写的 mock-hash。
  // 它算错不会报错，只会让每天的答案变成另一批人 —— 所以在 node 里逐条对拍。
  const nodeCrypto = require('crypto');
  const MH = require('../miniprogram/utils/mock-hash.js');
  const cases = [
    '', 'abc', 'a',
    'GP2026v1_DEFAULT|2026-10-11|mock_openid',
    '含中文的种子不太可能出现，但万一呢',
    'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(57),
    'y'.repeat(63), 'y'.repeat(64), 'y'.repeat(65), 'z'.repeat(1000)
  ];
  let bad = [];
  cases.forEach(s => {
    const expect = nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex');
    if (MH.createHash('sha256').update(s).digest('hex') !== expect) {
      bad.push(s.slice(0, 20));
    }
  });
  ok(`${cases.length} 个用例与 node crypto 完全一致`, bad.length === 0, bad);

  // 端到端再验一次：同样种子必须稳定命中同一个球员（否则"今天重进变了题"）
  const pool = rows.filter(p => p.fame_level >= C.MIN_FAME_DAILY)
    .sort((a, b) => a.id - b.id);
  const seed = { salt: 'S', dateKey: '2026-10-11', openid: 'u1', mode: 'per_user' };
  const a = U.pickDailyAnswer(pool, seed);
  const b = U.pickDailyAnswer(pool, seed);
  ok('同种子同答案（每日一题隔天不会跳题）', a.id === b.id, [a && a.id, b && b.id]);
}

/* ---------- 9. api.js 双路路由 ---------- */
G('api.js 路由');
{
  // 前面 mock-api 自测再全，也得有人把它接到页面上才算数。
  // 这里给 wx / getApp 补齐替身，验证 api.js 会按 USE_MOCK 走对路。
  let cloudCalls = [];
  global.getApp = () => ({ globalData: { useMock: true } });
  global.wx.cloud = {
    callFunction: (o) => {
      cloudCalls.push(o.name);
      return Promise.resolve({ result: { ok: true, data: {} } });
    }
  };

  const api = require('../miniprogram/utils/api.js');
  ok('Mock 开启时 isMock() 为真', api.isMock() === true);

  return api.getPlayers('')
    .then(d => {
      ok('走 Mock：拿到候选池', d.players.length === rows.length, d.count);
      ok('走 Mock：没调 wx.cloud', cloudCalls.length === 0, cloudCalls);

      global.getApp = () => ({ globalData: { useMock: false } });
      return api.gameStart('daily');
    })
    .then(() => {
      eq('关闭 Mock 后走云函数', cloudCalls[0], 'gameStart');
      return api.gameResult('g_x');
    })
    .then(() => {
      eq('第二个请求也走云函数', cloudCalls[1], 'gameResult');
    })
    .then(() => {
      console.log(`\n${'='.repeat(46)}`);
      console.log(`结果：${pass} 通过 / ${fail} 失败`);
      console.log('='.repeat(46));
      if (fail) process.exit(1);
    })
    .catch(e => {
      console.error('\n未捕获异常：', e);
      console.log(`\n结果：${pass} 通过 / ${fail + 1} 失败`);
      process.exit(1);
    });
}

console.log(`\n${'='.repeat(46)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(46));
if (fail) process.exit(1);
