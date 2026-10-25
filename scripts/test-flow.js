/**
 * 端到端流程测试 —— 用真实的云函数代码跑完整对局
 *
 *   node scripts/test-flow.js
 *
 * 原理：把 require('wx-server-sdk') 重定向到 scripts/mock-cloud.js（内存版数据库），
 * 于是 5 个云函数的 index.js 原封不动地跑起来，不需要连真云环境。
 *
 * 覆盖：开局幂等 / 并发冲突 / 答案分布 / 猜测判定 / 错误码 / 越权 / 答案零泄露。
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');

/* ---------- 把 wx-server-sdk 换成内存替身（必须在加载云函数之前） ---------- */
const MOCK_PATH = path.join(__dirname, 'mock-cloud.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'wx-server-sdk') return MOCK_PATH;
  return origResolve.call(this, request, ...args);
};

const cloud = require('./mock-cloud.js');
const U = require('../cloudfunctions/_shared/util.js');
const C = require('../cloudfunctions/_shared/constants.js');

const FN = {
  gameStart: require('../cloudfunctions/gameStart/index.js').main,
  gameGuess: require('../cloudfunctions/gameGuess/index.js').main,
  gameResume: require('../cloudfunctions/gameResume/index.js').main,
  gameResult: require('../cloudfunctions/gameResult/index.js').main,
  gameReveal: require('../cloudfunctions/gameReveal/index.js').main,
  getPlayers: require('../cloudfunctions/getPlayers/index.js').main
};

/* ---------- 断言 ---------- */
let pass = 0, fail = 0, group = '';

function G(name) { group = name; console.log(`\n== ${name} ==`); }

function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`); }
}

function eq(name, actual, expect) {
  ok(name, actual === expect, { actual, expect });
}

/* ---------- 造数据 ---------- */
const SALT = 'TEST_SALT_V1';
const DATE = U.beijingDateKey();

cloud.__seedMeta([
  { _id: 'daily_salt', salt: SALT, mode: 'per_user' },
  { _id: 'answer_pool', minFameDaily: 4, minFameEndless: 3, activeOnly: false, excludedIds: [] },
  { _id: 'players_meta', playerVersion: '2026-10-10', updatedAt: Date.now() }
]);

// 优先跑全量题库（500 条），缺文件时回退到 sample，保证测试始终贴近生产。
const DATA_CANDIDATES = [
  path.join(__dirname, '../database/players.full.jsonl'),
  path.join(__dirname, '../database/players.sample.jsonl')
];
const DATA_PATH = DATA_CANDIDATES.find(p => fs.existsSync(p));
const players = fs.readFileSync(DATA_PATH, 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));
cloud.__store.players = players;
console.log(`数据集：${path.basename(DATA_PATH)}（${players.length} 条）`);

// 可猜对象 vs 每日答案池：每日一题门槛高一档（见 C.MIN_FAME_DAILY），
// 冷门球员只能被猜、不能当每日答案，否则没听说过的人必然猜不出。
const POOL = players.filter(p => p.fame_level >= C.MIN_FAME);
const DAILY_POOL = players.filter(p => p.fame_level >= C.MIN_FAME_DAILY);
const CLUE_KEYS = C.CLUE_ORDER;

function othersThan(id, n) {
  return POOL.filter(p => p.id !== id).slice(0, n).map(p => p.id);
}

/** 已知 salt/openid/dateKey 时，答案是可以算出来的 —— 测试靠这个构造"必胜局" */
function dailyAnswerOf(openid, dateKey = DATE) {
  return U.pickDailyAnswer(DAILY_POOL, { salt: SALT, dateKey, openid, mode: 'per_user' });
}

/**
 * 记录响应，供泄露扫描。bucket 可临时切换成独立数组，
 * 否则不同用例的快照会互相污染（比如别人猜中的 id 被算到你头上）。
 */
let SNAPSHOTS = [];
function useBucket(arr) { SNAPSHOTS = arr; }
function keep(tag, res) {
  SNAPSHOTS.push({ tag, json: JSON.stringify(res) });
  return res;
}

(async function main() {
  console.log(`端到端流程测试   题库 ${players.length} 人 / `
    + `每日答案池 ${DAILY_POOL.length} 人 / 可猜对象 ${POOL.length} 人 / 日期 ${DATE}`);

  /* ---------------- 1. 开局与幂等 ---------------- */
  G('开局与幂等');
  cloud.__setOpenid('u_idem');

  const s1 = keep('start1', await FN.gameStart({ mode: 'daily' }));
  ok('开局成功', s1.ok, s1);
  eq('初始状态 playing', s1.data.status, 'playing');
  eq('初始已用 0 次', s1.data.used, 0);
  eq('剩余 8 次', s1.data.remaining, C.MAX_GUESSES);
  ok('响应不含 answerId', JSON.stringify(s1).indexOf('answerId') === -1);
  ok('响应不含 players 详情', JSON.stringify(s1).indexOf('fun_fact') === -1);

  const s2 = keep('start2', await FN.gameStart({ mode: 'daily' }));
  eq('重复开局 gameId 不变', s2.data.gameId, s1.data.gameId);
  eq('重复开局不消耗次数', s2.data.used, 0);
  eq('数据库未新增对局', cloud.__store.games.length, 1);

  /* ---------------- 2. 并发开局（唯一索引冲突分支） ---------------- */
  G('并发开局');
  cloud.__setOpenid('u_race');
  const [r1, r2] = await Promise.all([
    FN.gameStart({ mode: 'daily' }),
    FN.gameStart({ mode: 'daily' })
  ]);
  keep('race', r1); keep('race', r2);
  ok('两次并发都成功', r1.ok && r2.ok, { r1, r2 });
  eq('并发后 gameId 一致', r1.data.gameId, r2.data.gameId);
  eq('并发只建了一局', cloud.__store.games.filter(g => g._openid === 'u_race').length, 1);

  /* ---------------- 3. 答案分布（散列必须散得开） ---------------- */
  G('答案分布');
  const byUser = {};
  for (let i = 0; i < 40; i++) {
    const a = dailyAnswerOf('user_' + i);
    byUser[a.id] = (byUser[a.id] || 0) + 1;
  }
  // 唯一数上界是样本数本身（40 个用户不可能有 200 种答案）。
  // 40 球投 200 桶的生日悖论期望唯一数 = 200*(1-e^(-0.2)) ≈ 36，实测 36 属于正常。
  const distinctUsers = Object.keys(byUser).length;
  ok(`40 个用户同一天答案够分散（${distinctUsers}/${DAILY_POOL.length} 种）`,
    distinctUsers >= Math.ceil(Math.min(40, DAILY_POOL.length) * 0.8), distinctUsers);

  const byDay = {};
  for (let d = 1; d <= 20; d++) {
    const day = `2026-11-${String(d).padStart(2, '0')}`;
    const a = dailyAnswerOf('u_idem', day);
    byDay[a.id] = (byDay[a.id] || 0) + 1;
  }
  const distinctDays = Object.keys(byDay).length;
  ok(`同一用户 20 天答案够分散（${distinctDays}/${DAILY_POOL.length} 种）`,
    distinctDays >= Math.ceil(Math.min(20, DAILY_POOL.length) * 0.8), byDay);

  /* ---- 大样本均匀性：这才是真正守住 modHex 不塌缩的防线 ----
     小样本下「够分散」很弱（塌缩到 25 桶也可能侥幸通过），
     必须放大到每桶期望命中 20 次，才能用覆盖率 + 卡方判死。
     历史 bug：parseInt(hex64,16) 超 MAX_SAFE_INTEGER 被吸附到 2048 的倍数，
     2048 与 200 的 gcd=8，答案只剩 25 种 —— 这个用例能直接抓出来。 */
  const N = DAILY_POOL.length * 20;           // 每桶期望 20 次
  const bucket = {};
  for (let i = 0; i < N; i++) {
    const id = dailyAnswerOf('u_dist_' + i).id;
    bucket[id] = (bucket[id] || 0) + 1;
  }
  const covered = Object.keys(bucket).length;
  ok(`大样本覆盖全部 ${DAILY_POOL.length} 名球员（散列没塌缩）`,
    covered === DAILY_POOL.length, covered);

  const expect = N / DAILY_POOL.length;
  const chi2 = DAILY_POOL.reduce((s, p) => {
    const o = bucket[p.id] || 0;
    return s + (o - expect) * (o - expect) / expect;
  }, 0);
  const df = DAILY_POOL.length - 1;
  // chi2_{0.999}(df) ≈ df + 3.09*sqrt(2*df)；df=199 时约 261，放宽到 290 防 flaky
  const chi2Limit = df + 3.09 * Math.sqrt(2 * df) + 30;
  ok(`答案分布通过卡方检验（χ²=${chi2.toFixed(1)} < ${chi2Limit.toFixed(1)}, df=${df}）`,
    chi2 < chi2Limit, chi2);

  /* ---- 分档本身要生效：每日答案不能出现 fame<4 的冷门球员 ---- */
  const dbNow = cloud.database();
  const poolDaily = await U.loadAnswerPool(dbNow, 'daily');
  const poolEndless = await U.loadAnswerPool(dbNow, 'endless');
  ok('每日答案池比自由练习更严格', poolDaily.length < poolEndless.length,
    { daily: poolDaily.length, endless: poolEndless.length });
  ok(`每日答案池无 fame<${C.MIN_FAME_DAILY} 球员`,
    poolDaily.every(p => p.fame_level >= C.MIN_FAME_DAILY),
    poolDaily.filter(p => p.fame_level < C.MIN_FAME_DAILY).map(p => p.name_cn));
  ok('自由练习仍可抽到 fame=3 的冷门球员',
    poolEndless.some(p => p.fame_level === C.MIN_FAME));

  const globalMode = U.pickDailyAnswer(DAILY_POOL, { salt: SALT, dateKey: DATE, openid: 'x', mode: 'global' });
  const globalMode2 = U.pickDailyAnswer(DAILY_POOL, { salt: SALT, dateKey: DATE, openid: 'y', mode: 'global' });
  eq('global 模式下所有人同答案', globalMode.id, globalMode2.id);

  /* ---------------- 4. 猜测判定 ---------------- */
  G('猜测判定');
  cloud.__setOpenid('u_flow');
  const g = keep('start_flow', await FN.gameStart({ mode: 'daily' }));
  const answer = dailyAnswerOf('u_flow');
  const wrongIds = othersThan(answer.id, 3);

  const g1 = keep('guess1', await FN.gameGuess({ gameId: g.data.gameId, playerId: wrongIds[0] }));
  ok('猜测成功', g1.ok, g1);
  eq('回合数 1', g1.data.round, 1);
  eq('已用 1 次', g1.data.used, 1);
  eq('剩余 7 次', g1.data.remaining, C.MAX_GUESSES - 1);
  eq('未命中仍 playing', g1.data.status, 'playing');
  ok('verdict 含全部 8 个线索字段',
    CLUE_KEYS.every(k => g1.data.verdict && g1.data.verdict[k]), Object.keys(g1.data.verdict || {}));
  ok('每个字段都有三态之一',
    CLUE_KEYS.every(k => ['green', 'amber', 'gray'].indexOf(g1.data.verdict[k].state) !== -1));
  ok('猜测响应不含 answerId', JSON.stringify(g1).indexOf('answerId') === -1);

  const dup = await FN.gameGuess({ gameId: g.data.gameId, playerId: wrongIds[0] });
  eq('重复猜测返回 1005', dup.code, C.CODE.DUPLICATE_GUESS);
  const afterDup = await FN.gameResume({ gameId: g.data.gameId });
  eq('重复猜测不消耗次数', afterDup.data.used, 1);

  await FN.gameGuess({ gameId: g.data.gameId, playerId: wrongIds[1] });
  await FN.gameGuess({ gameId: g.data.gameId, playerId: wrongIds[2] });

  const resMid = keep('resume', await FN.gameResume({ gameId: g.data.gameId }));
  eq('续局回合数一致', resMid.data.rows.length, 3);
  ok('续局逐轮 verdict 与当时一致',
    JSON.stringify(resMid.data.rows.map(r => r.verdict)) ===
    JSON.stringify(await replayVerdicts(g.data.gameId, wrongIds.slice(0, 3))));

  const win = keep('guess_win', await FN.gameGuess({ gameId: g.data.gameId, playerId: answer.id }));
  eq('猜中状态 won', win.data.status, 'won');
  eq('猜中已用 4 次', win.data.used, 4);
  eq('猜测响应带回 score', win.data.score, 500);
  eq('得分 = (8+1-4)*100', win.data.score, (C.MAX_GUESSES + 1 - 4) * 100);
  eq('失败时 score 为 0', g1.data.score, 0);
  ok('猜中时全绿', CLUE_KEYS.every(k => win.data.verdict[k].state === 'green'));

  const finished = await FN.gameGuess({ gameId: g.data.gameId, playerId: wrongIds[0] });
  eq('终局后再猜返回 1004', finished.code, C.CODE.GAME_FINISHED);

  /* ---------------- 5. 揭晓答案 ---------------- */
  G('揭晓答案');
  const result = await FN.gameResult({ gameId: g.data.gameId });
  ok('揭晓成功', result.ok, result);
  eq('答案 id 正确', result.data.answer.id, answer.id);
  eq('答案姓名正确', result.data.answer.name_cn, answer.name_cn);
  // meme 允许为空：validate.py 的 OPTIONAL_ALLOW_EMPTY = {'meme'}，
  // 没有外号/梗的球员硬编一个反而是噪音。这里只要求键存在，不要求值非空。
  ok('答案含简介与冷知识（meme 可为空）',
    !!(result.data.answer.intro && result.data.answer.fun_fact)
    && 'meme' in result.data.answer);
  eq('答案年龄已算好', result.data.answer.age,
    require('../cloudfunctions/_shared/compare.js').calcAge(answer.birth_date, DATE));
  eq('回放 4 行', result.data.rows.length, 4);
  ok('回放每行都带球员信息', result.data.rows.every(r => r.player && r.player.name_cn));
  eq('揭晓返回 dateKey', result.data.dateKey, DATE);

  /* ---------------- 6. 未终局不得揭晓 ---------------- */
  G('答案防泄露');
  cloud.__setOpenid('u_leak');
  const leakShots = [];
  useBucket(leakShots);                      // 只扫描本用例的响应
  const lg = keep('start_leak', await FN.gameStart({ mode: 'daily' }));
  const lgAnswer = dailyAnswerOf('u_leak');
  const leakEarly = await FN.gameResult({ gameId: lg.data.gameId });
  eq('未终局揭晓返回 1004', leakEarly.code, C.CODE.GAME_FINISHED);
  ok('未终局揭晓不带任何答案内容', !leakEarly.data);

  const wrong8 = othersThan(lgAnswer.id, C.MAX_GUESSES);
  for (const pid of wrong8) {
    keep('guess_leak', await FN.gameGuess({ gameId: lg.data.gameId, playerId: pid }));
  }
  const lost = await FN.gameResume({ gameId: lg.data.gameId });
  eq('用完 8 次状态 lost', lost.data.status, 'lost');

  const leaked = leakShots.filter(s => s.json.indexOf('answerId') !== -1);
  eq('全部响应均无 answerId 字段', leaked.length, 0);
  const withAnswerId = leakShots.filter(s => s.json.indexOf(`"guessedId":${lgAnswer.id}`) !== -1);
  eq('未猜中时答案 id 从不出现在响应里', withAnswerId.length, 0);
  const withAnswerName = leakShots.filter(s => s.json.indexOf(lgAnswer.name_cn) !== -1);
  eq('未猜中时答案姓名从不出现在响应里', withAnswerName.length, 0);
  useBucket(leakShots === SNAPSHOTS ? [] : leakShots); // 保持 bucket 指向本用例，便于下面报错排查

  /* ---------------- 7. 越权 ---------------- */
  G('越权访问');
  const otherGuess = await (async () => {
    cloud.__setOpenid('intruder');
    return FN.gameGuess({ gameId: lg.data.gameId, playerId: wrong8[0] });
  })();
  eq('他人猜测返回 1003', otherGuess.code, C.CODE.FORBIDDEN);

  cloud.__setOpenid('intruder');
  const otherResult = await FN.gameResult({ gameId: lg.data.gameId });
  eq('他人揭晓返回 1003', otherResult.code, C.CODE.FORBIDDEN);
  const otherResume = await FN.gameResume({ gameId: lg.data.gameId });
  eq('他人续局返回 1003', otherResume.code, C.CODE.FORBIDDEN);

  /* ---------------- 8. 无限模式 ---------------- */
  G('无限模式');
  cloud.__setOpenid('u_endless');
  const e1 = await FN.gameStart({ mode: 'endless' });
  const e2 = await FN.gameStart({ mode: 'endless' });
  ok('两次开局 gameId 不同', e1.data.gameId !== e2.data.gameId);
  eq('无限模式开局成功', e1.data.status, 'playing');
  eq('已建 2 局', cloud.__store.games.filter(x => x._openid === 'u_endless').length, 2);

  /* ---------------- 8b. 难度分档（star / normal / all，2026-10-25 起） ---------------- */
  G('难度分档');
  // 明星局答案必须 fame=5，标准局 fame>=4，全员局沿用 minFameEndless(=3)。
  // 用「开局→查库里的 answerId」验证，答案 id 本来就在测试的假云数据库里。
  async function answerOf(openid, difficulty) {
    cloud.__setOpenid(openid);
    const r = await FN.gameStart({ mode: 'endless', difficulty });
    const g = cloud.__store.games.filter(x => x.gameId === r.data.gameId)[0];
    return { fame: players.filter(p => p.id === g.answerId)[0].fame_level,
             diff: r.data.difficulty };
  }
  const starAns = await answerOf('u_diff_star', 'star');
  eq('明星局回显 difficulty=star', starAns.diff, 'star');
  eq(`明星局答案 fame=5（实际 ${starAns.fame}）`, starAns.fame, 5);
  const normAns = await answerOf('u_diff_normal', 'normal');
  eq('标准局回显 difficulty=normal', normAns.diff, 'normal');
  ok(`标准局答案 fame>=4（实际 ${normAns.fame}）`, normAns.fame >= 4);
  const allAns = await answerOf('u_diff_all', 'all');
  eq('全员局回显 difficulty=all', allAns.diff, 'all');
  ok(`全员局答案可含 fame=3（池 ${POOL.length} 人）`, allAns.fame >= C.MIN_FAME);
  const legacyAns = await answerOf('u_diff_legacy', undefined);
  eq('不传 difficulty = 老行为（回显空）', legacyAns.diff, '');
  // 明星局统计上确实更严：40 局全部 fame=5
  let allStar = true;
  for (let i = 0; i < 40; i++) {
    const a = await answerOf('u_diff_star_' + i, 'star');
    if (a.fame !== 5) { allStar = false; break; }
  }
  ok('明星局连开 40 局，答案全部 fame=5', allStar);

  /* ---------------- 8c. 反向猜球（mode = reveal，2026-10-25 新玩法） ---------------- */
  G('反向猜球');
  cloud.__setOpenid('u_reveal');
  const REVEAL_BUCKET = [];
  const MAIN_BUCKET = SNAPSHOTS;   // 切走前先留引用，段末切回来做全局泄露扫描
  useBucket(REVEAL_BUCKET);

  const rv1 = keep('rv-start', await FN.gameStart({ mode: 'reveal' }));
  ok('反向开局成功', rv1.ok && rv1.data.status === 'playing', rv1);
  eq('开局自动揭 1 条', rv1.data.revealed, 1);
  eq('第一条是国籍', (rv1.data.clues || [])[0] && rv1.data.clues[0].key, 'nationality');
  ok('开局线索不带答案姓名', JSON.stringify(rv1.data.clues || []).indexOf('name') === -1);
  const rvGame = cloud.__store.games.filter(x => x.gameId === rv1.data.gameId)[0];
  ok('开局响应不含 answerId', JSON.stringify(rv1).indexOf('answerId') === -1);

  const rv2 = keep('rv-reveal2', await FN.gameReveal({ gameId: rv1.data.gameId }));
  eq('揭到 2 条', rv2.data.revealed, 2);
  eq('第二条是联赛', rv2.data.clues[1].key, 'league');
  eq('2 条时满分 700', rv2.data.maxScore, 700);

  for (let i = 0; i < 6; i++) await FN.gameReveal({ gameId: rv1.data.gameId });
  const rv8 = keep('rv-reveal8', await FN.gameReveal({ gameId: rv1.data.gameId }));
  eq('揭满后幂等（仍是 8 条）', rv8.data.revealed, 8);
  eq('8 条时满分 100', rv8.data.maxScore, 100);
  eq('线索共 8 条', rv8.data.clues.length, 8);
  eq('末条是惯用脚', rv8.data.clues[7].key, 'preferred_foot');

  // 猜错：不带 verdict（8 行比对会白送答案相对信息），只回被猜球员本体
  const rvAnswerId = rvGame.answerId;
  const wrongP = POOL.filter(p => p.id !== rvAnswerId)[0];
  const rw1 = keep('rv-wrong', await FN.gameGuess({ gameId: rv1.data.gameId, playerId: wrongP.id }));
  ok('猜错未命中', rw1.ok && rw1.data.hit === false, rw1);
  ok('猜错响应 verdict 为空', !rw1.data.verdict, rw1.data.verdict);
  ok('猜错响应带回被猜球员', rw1.data.player && rw1.data.player.id === wrongP.id);
  eq('消耗 1 次机会', rw1.data.used, 1);
  eq('猜错不得分', rw1.data.score, 0);

  const rw2 = await FN.gameGuess({ gameId: rv1.data.gameId, playerId: wrongP.id });
  eq('重复猜测 1005', rw2.code, C.CODE.DUPLICATE_GUESS);

  // 续局：线索与已猜名单原样重放，无 verdict
  const rsm = keep('rv-resume', await FN.gameResume({ gameId: rv1.data.gameId }));
  eq('续局线索 8 条', rsm.data.clues.length, 8);
  eq('续局回放 1 行', rsm.data.rows.length, 1);
  ok('续局回放行无 verdict', !rsm.data.rows[0].verdict);

  // 新局：揭 3 条后直接猜答案 -> 600 分
  cloud.__setOpenid('u_reveal_win');
  const w1 = keep('rv-win-start', await FN.gameStart({ mode: 'reveal', difficulty: 'star' }));
  const wGame = cloud.__store.games.filter(x => x.gameId === w1.data.gameId)[0];
  const wAns = players.filter(p => p.id === wGame.answerId)[0];
  ok('反向明星局答案 fame=5（难度档生效）', wAns.fame_level === 5, wAns.fame_level);
  await FN.gameReveal({ gameId: w1.data.gameId });
  await FN.gameReveal({ gameId: w1.data.gameId });
  const w2 = keep('rv-win-guess', await FN.gameGuess({ gameId: w1.data.gameId, playerId: wGame.answerId }));
  eq('3 条线索猜中', w2.data.status, 'won');
  eq('得分 = (9-3)×100', w2.data.score, 600);

  const wRevealAfter = await FN.gameReveal({ gameId: w1.data.gameId });
  eq('终局后再揭 1004', wRevealAfter.code, C.CODE.GAME_FINISHED);
  const wGuessAfter = await FN.gameGuess({ gameId: w1.data.gameId, playerId: wrongP.id });
  eq('终局后再猜 1004', wGuessAfter.code, C.CODE.GAME_FINISHED);

  const wRes = keep('rv-result', await FN.gameResult({ gameId: w1.data.gameId }));
  eq('揭晓答案正确', wRes.data.answer.id, wGame.answerId);
  eq('揭晓带 revealed=3', wRes.data.revealed, 3);

  // 对非反向对局调 gameReveal -> 1001（用自己名下的常规对局，避免先撞越权 1003）
  const plain = await FN.gameStart({ mode: 'endless' });
  const badReveal = await FN.gameReveal({ gameId: plain.data.gameId });
  eq('非反向对局 1001', badReveal.code, C.CODE.INVALID_PARAM);

  // 零泄露扫描：本段全部响应快照里不得出现 answerId 字样
  const rvLeaked = REVEAL_BUCKET.filter(s => s.json.indexOf('answerId') !== -1);
  eq('反向模式响应均无 answerId 字段', rvLeaked.length, 0);
  useBucket(MAIN_BUCKET);

  /* ---------------- 8d. 专题练习（theme，2026-10-25） ---------------- */
  G('专题练习');
  // 客户端 miniprogram/utils/themes.js 与服务端 THEMES 逐主题对拍（label + 过滤口径）
  const clientThemes = require('../miniprogram/utils/themes.js');
  const THEME_COUNTS = [];
  clientThemes.THEMES.forEach(ct => {
    const st = C.THEMES[ct.id];
    ok(`主题表对拍 ${ct.label}`, !!st && st.label === ct.label, { id: ct.id, server: st && st.label });
    const serverN = POOL.filter(p => U.themeFilter(p, st)).length;
    const clientN = POOL.filter(p => clientThemes.testOf(ct, p)).length;
    eq(`主题池人数对拍 ${ct.label}`, clientN, serverN);
    THEME_COUNTS.push(clientN);
  });
  ok('每个主题池都 >= 20 人（够抽不重复）', THEME_COUNTS.every(n => n >= 20), THEME_COUNTS);

  async function themeAnswer(openid, event) {
    cloud.__setOpenid(openid);
    const r = await FN.gameStart(event);
    if (!r.ok) return { err: r };
    const g = cloud.__store.games.filter(x => x.gameId === r.data.gameId)[0];
    return { ans: players.filter(p => p.id === g.answerId)[0], res: r };
  }

  const tEpl = await themeAnswer('u_theme_epl', { mode: 'endless', theme: 'epl' });
  ok('英超专场答案在英超', tEpl.ans.league === '英超', tEpl.ans.name_cn);
  eq('响应回显 theme=epl', tEpl.res.data.theme, 'epl');

  const tLeg = await themeAnswer('u_theme_leg', { mode: 'endless', theme: 'legends' });
  ok('退役传奇答案 active=false', tLeg.ans.active === false, tLeg.ans.name_cn);
  const tGk = await themeAnswer('u_theme_gk', { mode: 'endless', theme: 'gk' });
  ok('门将专场答案是门将', tGk.ans.position_group === 'GK', tGk.ans.position);
  const tLeft = await themeAnswer('u_theme_left', { mode: 'endless', theme: 'lefty' });
  ok('左脚将答案惯用左脚', tLeft.ans.preferred_foot === '左脚', tLeft.ans.name_cn);
  const tGenz = await themeAnswer('u_theme_genz', { mode: 'endless', theme: 'genz' });
  ok('00后新星答案生于 2000 年及以后',
    Number(String(tGenz.ans.birth_date).slice(0, 4)) >= 2000, tGenz.ans.birth_date);
  const tBra = await themeAnswer('u_theme_bra', { mode: 'endless', theme: 'brazil' });
  ok('巴西球员答案国籍巴西', tBra.ans.nationality === '巴西', tBra.ans.name_cn);

  // 主题 + 难度：难度档被忽略（全员池再切主题），主题仍然生效
  let allEpl = true;
  for (let i = 0; i < 12; i++) {
    const t = await themeAnswer('u_theme_mix' + i, { mode: 'endless', theme: 'epl', difficulty: 'star' });
    if (t.err || t.ans.league !== '英超') { allEpl = false; break; }
  }
  ok('专题+难度连开 12 局，答案全部在英超（难度被忽略）', allEpl);

  // 非法主题 / daily 带主题 -> 1001
  const badTheme = await FN.gameStart({ mode: 'endless', theme: 'nope' });
  eq('未知专题 1001', badTheme.code, C.CODE.INVALID_PARAM);
  cloud.__setOpenid('u_theme_daily');
  const dailyTheme = await FN.gameStart({ mode: 'daily', theme: 'epl' });
  eq('每日一题带专题 1001', dailyTheme.code, C.CODE.INVALID_PARAM);

  /* ---------------- 9. 错误码 ---------------- */
  G('错误码');
  cloud.__setOpenid('u_err');
  eq('缺 gameId -> 1001', (await FN.gameGuess({ playerId: 1 })).code, C.CODE.INVALID_PARAM);
  eq('非法 playerId -> 1001',
    (await FN.gameGuess({ gameId: 'x', playerId: 'abc' })).code, C.CODE.INVALID_PARAM);
  eq('不存在的对局 -> 1002',
    (await FN.gameResume({ gameId: 'g_not_exist' })).code, C.CODE.GAME_NOT_FOUND);
  eq('空 gameId -> 1001', (await FN.gameResume({ gameId: '' })).code, C.CODE.INVALID_PARAM);

  const eg = await FN.gameStart({ mode: 'daily' });
  eq('不存在的球员 -> 1006',
    (await FN.gameGuess({ gameId: eg.data.gameId, playerId: 99999 })).code, C.CODE.PLAYER_NOT_FOUND);

  /* ---------------- 10. 候选池下发 ---------------- */
  G('候选池下发');
  const pg = await FN.getPlayers({ version: '' });
  ok('首次拉取 fresh=true', pg.data.fresh === true, pg.data.fresh);
  eq('下发条数正确', pg.data.players.length, players.length);
  const first = pg.data.players[0];
  // 头像改用队色 + 首字现画，不再下发任何图片字段（省 500 条无用字符串）
  ok('不再下发 photo_url（头像改程序化绘制）', !('photo_url' in first));
  ['intro', 'fun_fact', 'meme', 'search_index', 'answerId'].forEach(f => {
    ok(`候选包不含 ${f}`, !(f in first));
  });
  // 程序化头像依赖队色，这两个必须在包里，否则头像会变成默认绿块
  ['primary_color', 'secondary_color'].forEach(f => {
    ok(`候选包含 ${f}（头像要用）`, f in first && !!first[f]);
  });
  ok('候选包字段数受控', Object.keys(first).length <= C.CLIENT_FIELDS.length,
    Object.keys(first));

  const pg2 = await FN.getPlayers({ version: pg.data.version });
  eq('版本号一致时 fresh=false', pg2.data.fresh, false);
  eq('版本号一致时不重复下发', pg2.data.players.length, 0);

  /* ---------------- 汇总 ---------------- */
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);

  /** 用同样的 3 次猜测，重开一局比对 verdict（验证重放是纯函数） */
  async function replayVerdicts(gameId, ids) {
    // 直接调 compare，绕开数据库，验证 gameResume 的重算与实时判定一致
    const { compare } = require('../cloudfunctions/_shared/compare.js');
    const ans = dailyAnswerOf('u_flow');
    return ids.map(id => compare(POOL.find(p => p.id === id), ans, DATE));
  }
})().catch(e => {
  console.error('\n测试脚本自身异常：', e);
  process.exit(1);
});
