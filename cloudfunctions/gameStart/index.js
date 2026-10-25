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

  const mode = ['endless', 'reveal'].indexOf(event.mode) !== -1 ? event.mode : 'daily';
  // 难度分档作用于 endless / reveal（star/normal/all），非法值一律回落到 all
  const difficulty = (mode !== 'daily' && C.DIFFICULTIES.indexOf(event.difficulty) !== -1)
    ? event.difficulty : '';
  // 专题练习：只在 endless/reveal 生效，必须是已知主题（校验失败直接拒，别静默开错局）
  let theme = '';
  if (event.theme) {
    if (mode === 'daily' || !C.THEMES[event.theme]) {
      return U.fail(C.CODE.INVALID_PARAM, '未知的专题');
    }
    theme = event.theme;
  }
  const dateKey = U.beijingDateKey();

  try {
    // 1) daily 模式先看今天是否已有存档，有就直接续上
    let game = mode === 'daily' ? await U.findToday(db, OPENID, dateKey) : null;

    if (!game) {
      // 2) 抽答案（reveal 与 endless 同池；带专题时切主题子池）
      const pool = await U.loadAnswerPool(db, mode, difficulty, theme);
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
        difficulty,
        theme,
        dateKey,
        // 唯一索引只约束"每日挑战"：daily 用 openid+dateKey，
        // endless/reveal 用 gameId（本来就唯一）。
        uniqueKey: mode === 'daily' ? `${OPENID}|daily|${dateKey}` : `${mode}|${gameId}`,
        answerId: answer.id,
        maxGuesses: C.MAX_GUESSES,
        guessIds: [],
        // 反向猜球：开局自动揭第一条（国籍），列表不至于空着开场
        revealed: mode === 'reveal' ? 1 : 0,
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

    // 反向猜球：开局带上已揭线索（新局固定 1 条：国籍）
    let extra = {};
    if (game.mode === 'reveal') {
      const ans = await U.getPlayerById(db, game.answerId);
      if (!ans) return U.fail(C.CODE.INTERNAL, '答案数据异常');
      extra = {
        revealed: game.revealed || 1,
        clues: U.revealCluesOf(ans, game.revealed || 1, game.dateKey),
        maxScore: U.revealMaxScore(game.revealed || 1, game.maxGuesses)
      };
    }

    return U.ok(U.publicGame(game, rows, extra));
  } catch (e) {
    console.error('[gameStart]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
};
