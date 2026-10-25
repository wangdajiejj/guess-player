/**
 * gameResume —— 杀进程 / 切后台回来后重放线索
 *
 * 入参：{ gameId: string }
 * 出参：同 gameStart.data，rows 含全部历史线索（服务端重算，不信任客户端）
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

    // 反向猜球：重放已揭线索 + 已猜名单（无 verdict），不放比对行
    if (game.mode === 'reveal') {
      const answer = await U.getPlayerById(db, game.answerId);
      if (!answer) return U.fail(C.CODE.INTERNAL, '答案数据异常');
      const rows = [];
      const ids = game.guessIds || [];
      for (let i = 0; i < ids.length; i++) {
        const p = await U.getPlayerById(db, ids[i]);
        if (p) rows.push({ round: i + 1, guessedId: p.id, hit: p.id === answer.id, player: U.pickFields(p, C.CLIENT_FIELDS) });
      }
      return U.ok(U.publicGame(game, rows, {
        revealed: game.revealed || 1,
        clues: U.revealCluesOf(answer, game.revealed || 1, game.dateKey),
        maxScore: U.revealMaxScore(game.revealed || 1, game.maxGuesses)
      }));
    }

    let rows = [];
    if ((game.guessIds || []).length) {
      const answer = await U.getPlayerById(db, game.answerId);
      if (answer) rows = await U.replayRows(db, game, answer);
    }

    return U.ok(U.publicGame(game, rows));
  } catch (e) {
    console.error('[gameResume]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
};
