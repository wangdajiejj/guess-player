/**
 * ⚠️⚠️⚠️ 本地 Mock 专用 —— 严禁在正式包里启用 ⚠️⚠️⚠️
 *
 * 用本机 storage 假装成一个「云数据库」，把 5 个云函数在客户端跑一遍。
 * 目的只有一个：不配微信云环境、不等 ICP 备案，打开开发者工具就能玩通全局。
 *
 * 契约刻意写得和真云函数逐字段一致（连 {ok, code, msg, data} 这层信封都一样），
 * 这样 api.js 里只需要判断一次走哪条路，切回云模式时前端一行都不用改。
 * 想知道真正的返回体长什么样，直接看对应云函数的 index.js。
 *
 * 「假装就假装彻底」这条原则还体现在：
 *   - 答案池照样按模式分档（daily 用 MIN_FAME_DAILY）；
 *   - gameResult 照样有 status==='playing' 守卫（没终局答案就出不来）；
 *   - 每次请求照样套 Promise，将来换回云函数时前端一行都不用改。
 *
 * 提审 / 上线前必须把 app.js 的 USE_MOCK 改回 false 并删掉本文件，
 * 否则等于把答案摆在了客户端（有了这份比对逻辑就能离线暴力反推）。
 */
const PLAYERS = require('./mock-players.js');
const U = require('./mock-util.js');
const C = require('./mock-constants.js');
const { compare, isHit, calcAge } = require('./mock-compare.js');

/* ---------------- 假装成一个云环境 ---------------- */

const KEY = 'gp_mock_games';
const SALT = 'GP2026v1_DEFAULT';
const OPENID = 'mock_openid';
// 改这个版本号 = 强制客户端下一次进入时重新拉取候选池
const VERSION = 'mock-2026-10-11';

function loadTable() {
  try {
    const v = wx.getStorageSync(KEY);
    return (v && Array.isArray(v.games)) ? v.games : [];
  } catch (e) {
    return [];
  }
}

function saveTable(games) {
  try {
    wx.setStorageSync(KEY, { games });
  } catch (e) { /* 配额爆了就算了，本局仍能玩，只是重进会新开一局 */ }
}

function findGame(gameId) {
  const games = loadTable();
  for (let i = 0; i < games.length; i++) {
    if (games[i].gameId === gameId) return games[i];
  }
  return null;
}

function findToday(dateKey) {
  const games = loadTable();
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (g.mode === 'daily' && g.dateKey === dateKey && g._openid === OPENID) return g;
  }
  return null;
}

function upsert(game) {
  const games = loadTable();
  const i = games.findIndex(g => g.gameId === game.gameId);
  if (i === -1) games.push(game); else games[i] = game;
  saveTable(games);
}

function getPlayerById(id) {
  for (let i = 0; i < PLAYERS.length; i++) {
    if (PLAYERS[i].id === id) return PLAYERS[i];
  }
  return null;
}

/** 答案池：和 util.loadAnswerPool 一个口径 —— 按 id 升序决定了抽样的稳定性 */
function loadAnswerPool(mode) {
  const minFame = mode === 'daily' ? C.MIN_FAME_DAILY : C.MIN_FAME;
  return PLAYERS
    .filter(p => p.fame_level >= minFame)
    .sort((a, b) => a.id - b.id)
    .slice(0, C.MAX_POOL_SIZE);
}

/** 本地版 U.replayRows：云函数那份要查库，这里用内存数据，行结构保持一致 */
function replayRows(game, answer, dateKey) {
  const rows = [];
  const ids = game.guessIds || [];
  for (let i = 0; i < ids.length; i++) {
    const p = getPlayerById(ids[i]);
    if (!p) continue;
    rows.push({
      round: i + 1,
      guessedId: p.id,
      hit: p.id === answer.id,
      verdict: compare(p, answer, dateKey),
      player: U.pickFields(p, C.CLIENT_FIELDS)
    });
  }
  return rows;
}

function rowsFor(game, dateKey) {
  const answer = getPlayerById(game.answerId);
  return answer ? replayRows(game, answer, dateKey) : [];
}

/* ---------------- 五个接口，逐个对齐真云函数 ---------------- */

/** getPlayers —— 对齐 cloudfunctions/getPlayers/index.js */
function getPlayers(version) {
  if (version && version === VERSION) {
    return U.ok({ fresh: false, version: VERSION, updatedAt: 0, count: 0, players: [] });
  }
  const players = PLAYERS.map(p => U.pickFields(p, C.CLIENT_FIELDS));
  return U.ok({ fresh: true, version: VERSION, updatedAt: Date.now(), count: players.length, players });
}

/** gameStart —— 对齐 cloudfunctions/gameStart/index.js */
function gameStart(mode) {
  mode = mode === 'endless' ? 'endless' : 'daily';
  const dateKey = U.beijingDateKey();

  try {
    let game = mode === 'daily' ? findToday(dateKey) : null;

    if (!game) {
      const pool = loadAnswerPool(mode);
      if (!pool.length) return U.fail(C.CODE.POOL_EMPTY);

      const answer = mode === 'daily'
        ? U.pickDailyAnswer(pool, { salt: SALT, dateKey, openid: OPENID, mode: 'per_user' })
        : U.pickEndlessAnswer(pool);
      if (!answer) return U.fail(C.CODE.POOL_EMPTY);

      game = {
        gameId: U.genGameId(dateKey),
        _openid: OPENID,
        mode,
        dateKey,
        uniqueKey: mode === 'daily' ? `${OPENID}|daily|${dateKey}` : `endless|${U.genGameId(dateKey)}`,
        answerId: answer.id,
        maxGuesses: C.MAX_GUESSES,
        guessIds: [],
        status: 'playing',
        startedAt: Date.now(),
        finishedAt: 0,
        score: 0
      };
      upsert(game);
    }

    return U.ok(U.publicGame(game, rowsFor(game, dateKey)));
  } catch (e) {
    console.error('[mock gameStart]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
}

/** gameGuess —— 对齐 cloudfunctions/gameGuess/index.js */
function gameGuess(gameId, playerId) {
  gameId = String(gameId || '');
  playerId = Number(playerId);
  if (!gameId || !Number.isInteger(playerId)) return U.fail(C.CODE.INVALID_PARAM);

  try {
    const game = findGame(gameId);
    if (!game) return U.fail(C.CODE.GAME_NOT_FOUND);
    if (game._openid !== OPENID) return U.fail(C.CODE.FORBIDDEN);
    if (game.status !== 'playing') return U.fail(C.CODE.GAME_FINISHED);

    const guessIds = game.guessIds || [];
    if (guessIds.indexOf(playerId) !== -1) return U.fail(C.CODE.DUPLICATE_GUESS);

    const guess = getPlayerById(playerId);
    if (!guess) return U.fail(C.CODE.PLAYER_NOT_FOUND);
    const answer = getPlayerById(game.answerId);
    if (!answer) return U.fail(C.CODE.INTERNAL, '答案数据异常');

    const dateKey = game.dateKey || U.beijingDateKey();
    const verdict = compare(guess, answer, dateKey);
    const hit = isHit(guess, answer);

    const nextGuessIds = guessIds.concat([playerId]);
    const used = nextGuessIds.length;
    const max = game.maxGuesses || C.MAX_GUESSES;
    const status = hit ? 'won' : (used >= max ? 'lost' : 'playing');

    const patch = {
      guessIds: nextGuessIds,
      status,
      finishedAt: status === 'playing' ? 0 : Date.now(),
      score: hit ? Math.max(0, (max + 1 - used) * 100) : 0
    };

    upsert(Object.assign({}, game, patch));

    return U.ok({
      round: used,
      guessedId: playerId,
      hit,
      status,
      used,
      remaining: Math.max(0, max - used),
      score: patch.score,
      verdict
    });
  } catch (e) {
    console.error('[mock gameGuess]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
}

/** gameResume —— 对齐 cloudfunctions/gameResume/index.js */
function gameResume(gameId) {
  gameId = String(gameId || '');
  if (!gameId) return U.fail(C.CODE.INVALID_PARAM);

  try {
    const game = findGame(gameId);
    if (!game) return U.fail(C.CODE.GAME_NOT_FOUND);
    if (game._openid !== OPENID) return U.fail(C.CODE.FORBIDDEN);
    return U.ok(U.publicGame(game, rowsFor(game, game.dateKey)));
  } catch (e) {
    console.error('[mock gameResume]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
}

/** gameResult —— 对齐 cloudfunctions/gameResult/index.js（含 playing 守卫） */
function gameResult(gameId) {
  gameId = String(gameId || '');
  if (!gameId) return U.fail(C.CODE.INVALID_PARAM);

  try {
    const game = findGame(gameId);
    if (!game) return U.fail(C.CODE.GAME_NOT_FOUND);
    if (game._openid !== OPENID) return U.fail(C.CODE.FORBIDDEN);
    // 守卫不能省：本地 Mock 也得习惯"没终局就别想要答案"这条铁律，
    // 否则从 Mock 切回云模式时会以为这个接口永远有数据。
    if (game.status === 'playing') return U.fail(C.CODE.GAME_FINISHED);

    const answer = getPlayerById(game.answerId);
    if (!answer) return U.fail(C.CODE.INTERNAL, '答案数据异常');

    const dateKey = game.dateKey || U.beijingDateKey();
    const detail = U.pickFields(answer, C.DETAIL_FIELDS);
    detail.age = calcAge(answer.birth_date, dateKey);

    return U.ok({
      gameId: game.gameId,
      mode: game.mode,
      dateKey,
      status: game.status,
      used: (game.guessIds || []).length,
      score: game.score || 0,
      rows: rowsFor(game, dateKey),
      answer: detail
    });
  } catch (e) {
    console.error('[mock gameResult]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
}

/* ---------------- 测试辅助 ---------------- */

/** 清掉所有 Mock 对局。想反复体验「每日一题」时用它换一道题。 */
function resetGames() {
  saveTable([]);
}

/** 给设置页显示用：本机攒了多少局测试对局 */
function gameCount() {
  return loadTable().length;
}

/** 调试用：偷看今天的答案。正式包里不该存在这种接口。 */
function peekTodayAnswer() {
  const g = findToday(U.beijingDateKey());
  return g ? getPlayerById(g.answerId) : null;
}

module.exports = {
  getPlayers, gameStart, gameGuess, gameResume, gameResult,
  resetGames, gameCount, peekTodayAnswer,
  VERSION
};
