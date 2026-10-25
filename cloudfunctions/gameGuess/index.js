/**
 * gameGuess —— 提交一次猜测
 *
 * 入参：{ gameId: string, playerId: number }
 * 出参：docs/03-algorithm.md §4.3
 *
 * 用数据库事务保证「读-判-写」原子性：
 * 连续点两次提交时，第二个请求会等到第一个提交后再读，
 * 此时 guessIds 已含该 id，直接返回 1005 DUPLICATE_GUESS（不消耗次数）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const C = require('./constants');
const U = require('./util');
const { compare, isHit } = require('./compare');

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return U.fail(C.CODE.FORBIDDEN, '无法获取用户标识');

  const gameId = String(event.gameId || '');
  const playerId = Number(event.playerId);
  if (!gameId || !Number.isInteger(playerId)) {
    return U.fail(C.CODE.INVALID_PARAM);
  }

  try {
    const result = await db.runTransaction(async tx => {
      // --- 读 ---
      const gRes = await tx.collection('games').where({ gameId }).limit(1).get();
      const game = gRes.data && gRes.data[0];
      if (!game) throw abort(C.CODE.GAME_NOT_FOUND);
      if (game._openid !== OPENID) throw abort(C.CODE.FORBIDDEN);
      if (game.status !== 'playing') throw abort(C.CODE.GAME_FINISHED);

      const guessIds = game.guessIds || [];
      if (guessIds.indexOf(playerId) !== -1) throw abort(C.CODE.DUPLICATE_GUESS);

      // --- 判 ---
      const guess = await getPlayer(tx, playerId);
      if (!guess) throw abort(C.CODE.PLAYER_NOT_FOUND);
      const answer = await getPlayer(tx, game.answerId);
      if (!answer) throw abort(C.CODE.INTERNAL, '答案数据异常');

      const dateKey = game.dateKey || U.beijingDateKey();
      const hit = isHit(guess, answer);

      const nextGuessIds = guessIds.concat([playerId]);
      const used = nextGuessIds.length;
      const max = game.maxGuesses || C.MAX_GUESSES;
      const status = hit ? 'won' : (used >= max ? 'lost' : 'playing');

      // 反向猜球：分数看「揭了几条线索」而不是「猜了几次」；
      // 且不下发 verdict —— 8 行比对会白送大量答案相对信息（绿=命中等），
      // 揭线索模式的情报只能来自揭晓按钮。改发被猜球员本体供列表渲染。
      const isReveal = game.mode === 'reveal';
      const revealed = isReveal ? (game.revealed || 1) : used;

      // --- 写 ---
      const patch = {
        guessIds: nextGuessIds,
        status,
        finishedAt: status === 'playing' ? 0 : Date.now(),
        // 常规：1 次猜中 800 分；反向：第 1 条线索就猜中 800 分。失败 0 分
        score: hit ? (isReveal
          ? Math.max(0, (max + 1 - revealed) * 100)
          : Math.max(0, (max + 1 - used) * 100)) : 0
      };
      await tx.collection('games').doc(game._id).update({ data: patch });

      return {
        data: {
            round: used,
          guessedId: playerId,
          hit,
          status,
          used,
          remaining: Math.max(0, max - used),
          score: patch.score,
          verdict: isReveal ? null : compare(guess, answer, dateKey),
          player: isReveal ? U.pickFields(guess, C.CLIENT_FIELDS) : undefined,
          revealed: isReveal ? revealed : undefined,
          maxScore: isReveal ? U.revealMaxScore(revealed, max) : undefined
        }
      };
    });

    return U.ok(result.data);
  } catch (e) {
    // 用 code 标记的预期业务错误，原样返回；其余按内部错误处理
    if (e && e.__gpCode) {
      return U.fail(e.__gpCode, e.__gpMsg);
    }
    console.error('[gameGuess]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
};

/** 事务内抛出一个"预期业务错误" */
function abort(code, msg) {
  const err = new Error(msg || C.CODE_MSG[code] || 'abort');
  err.__gpCode = code;
  err.__gpMsg = msg;
  return err;
}

/** 事务里取球员只能用 transaction.collection */
async function getPlayer(tx, id) {
  const r = await tx.collection('players').where({ id }).limit(1).get();
  return r.data && r.data[0] ? r.data[0] : null;
}
