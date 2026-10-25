/**
 * gameResult —— 揭晓答案
 *
 * 入参：{ gameId: string }
 * 出参：docs/03-algorithm.md §4.5
 *
 * 守卫：status 仍为 playing 时返回 1004，
 * 这是「答案不泄露」的最后一道门——只要没终局，答案就出不了服务端。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const C = require('./constants');
const U = require('./util');

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return U.fail(C.CODE.FORBIDDEN);

  const gameId = String(event.gameId || '');
  if (!gameId) return U.fail(C.CODE.INVALID_PARAM);

  try {
    const game = await U.findGame(db, gameId);
    if (!game) return U.fail(C.CODE.GAME_NOT_FOUND);
    if (game._openid !== OPENID) return U.fail(C.CODE.FORBIDDEN);
    if (game.status === 'playing') return U.fail(C.CODE.GAME_FINISHED);

    const answer = await U.getPlayerById(db, game.answerId);
    if (!answer) return U.fail(C.CODE.INTERNAL, '答案数据异常');

    const rows = await U.replayRows(db, game, answer);
    const dateKey = game.dateKey || U.beijingDateKey();

    // 年龄在服务端算好一起下发，客户端不要再算一遍
    const detail = U.pickFields(answer, C.DETAIL_FIELDS);
    detail.age = require('./compare').calcAge(answer.birth_date, dateKey);

    return U.ok(Object.assign({
      gameId: game.gameId,
      mode: game.mode,
      difficulty: game.difficulty || '',
      dateKey,
      status: game.status,
      used: (game.guessIds || []).length,
      score: game.score || 0,
      rows,
      answer: detail
    }, game.mode === 'reveal' ? { revealed: game.revealed || 1 } : {}));
  } catch (e) {
    console.error('[gameResult]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
};
