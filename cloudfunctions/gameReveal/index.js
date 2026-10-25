/**
 * gameReveal —— 反向猜球：再揭晓一条答案线索
 *
 * 入参：{ gameId: string }
 * 出参：{ revealed, clues, maxScore, used, remaining, status }
 *
 * 幂等：已揭满 8 条时原样返回当前状态（不加错误），
 * 终局后返回 1004（和猜测/揭晓同一守卫口径）。
 * 响应绝不携带 answerId 或答案姓名 —— 每条线索只是答案某个属性的值。
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
    if (game.status !== 'playing') return U.fail(C.CODE.GAME_FINISHED);
    if (game.mode !== 'reveal') return U.fail(C.CODE.INVALID_PARAM, '本局不是反向猜球');

    const max = game.maxGuesses || C.MAX_GUESSES;
    const next = Math.min((game.revealed || 1) + 1, C.REVEAL_ORDER.length);

    if (next !== (game.revealed || 1)) {
      await db.collection('games').doc(game._id).update({ data: { revealed: next } });
      game.revealed = next;
    }

    const answer = await U.getPlayerById(db, game.answerId);
    if (!answer) return U.fail(C.CODE.INTERNAL, '答案数据异常');

    const used = (game.guessIds || []).length;
    return U.ok({
      revealed: game.revealed || 1,
      clues: U.revealCluesOf(answer, game.revealed || 1, game.dateKey),
      maxScore: U.revealMaxScore(game.revealed || 1, max),
      status: game.status,
      used,
      remaining: Math.max(0, max - used)
    });
  } catch (e) {
    console.error('[gameReveal]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
};
