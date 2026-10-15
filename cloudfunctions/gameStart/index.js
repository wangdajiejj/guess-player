/**
 * gameStart —— 幂等开局
 *
 * 入参：{ mode: 'daily' | 'endless' }
 * 出参：docs/03-algorithm.md §4.2（绝不含 answerId）
 *
 * 幂等保证：daily 模式下同一用户同一天永远复用同一局，
 * 两层防线——应用层先查 + 数据库唯一索引兜底。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const C = require('./constants');
const U = require('./util');
const { compare } = require('./compare');

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return U.fail(C.CODE.FORBIDDEN, '无法获取用户标识');

  const mode = event.mode === 'endless' ? 'endless' : 'daily';
  const dateKey = U.beijingDateKey();

  try {
    // 1) daily 模式先看今天是否已有存档，有就直接续上
    let game = mode === 'daily' ? await U.findToday(db, OPENID, dateKey) : null;

    if (!game) {
      // 2) 抽答案
      const pool = await U.loadAnswerPool(db, mode);
      if (!pool.length) return U.fail(C.CODE.POOL_EMPTY);

      const { salt, mode: seedMode } = await U.getSalt(db);
      const answer = mode === 'daily'
        ? U.pickDailyAnswer(pool, { salt, dateKey, openid: OPENID, mode: seedMode })
        : U.pickEndlessAnswer(pool);
      if (!answer) return U.fail(C.CODE.POOL_EMPTY);

      const gameId = U.genGameId(dateKey);
      const doc = {
        gameId,
        _openid: OPENID,
        mode,
        dateKey,
        // 唯一索引只约束"每日挑战"：daily 用 openid+dateKey，
        // endless 用 gameId（本来就唯一），否则玩家一天只能开一局无限模式。
        uniqueKey: mode === 'daily' ? `${OPENID}|daily|${dateKey}` : `endless|${gameId}`,
        answerId: answer.id,
        maxGuesses: C.MAX_GUESSES,
        guessIds: [],
        status: 'playing',
        startedAt: Date.now(),
        finishedAt: 0,
        score: 0
      };

      try {
        await db.collection('games').add({ data: doc });
        game = doc;
      } catch (e) {
        // 并发写冲突：唯一索引命中 -> 说明别人(或上一次点击)已经建好了
        if (mode === 'daily') {
          const existed = await U.findToday(db, OPENID, dateKey);
          if (existed) {
            game = existed;
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    }

    // 3) 若已有存档（今天开过局/已结束），把历史线索重放回去
    let rows = [];
    if ((game.guessIds || []).length) {
      const answer = await U.getPlayerById(db, game.answerId);
      if (answer) rows = await U.replayRows(db, game, answer);
    }

    return U.ok(U.publicGame(game, rows));
  } catch (e) {
    console.error('[gameStart]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
};
