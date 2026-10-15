/**
 * getPlayers —— 拉候选池（当前 500 人，分页取全量），带版本号增量更新
 *
 * 入参：{ version: string }  首轮传空串
 * 出参：
 *   { fresh:false }                     本地已最新，不重复传输（省流量、省云开发读次数）
 *   { fresh:true, version, players:[…] } 需要更新
 *
 * 裁剪：按 C.CLIENT_FIELDS 白名单下发，
 *       intro/fun_fact/meme/search_index 不下发（结果页单独取）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const C = require('./constants');
const U = require('./util');

exports.main = async (event = {}) => {
  try {
    const meta = await U.getMeta(db, 'players_meta', null);
    const version = (meta && meta.playerVersion) || 'unknown';
    const updatedAt = (meta && meta.updatedAt) || 0;

    // 版本号一致 -> 直接告诉客户端不用更新
    if (event.version && event.version === version) {
      return U.ok({ fresh: false, version, updatedAt, count: 0, players: [] });
    }

    /**
     * 云数据库单次 get 上限 100 条，必须分页。
     *
     * ⚠️ 页数绝不能写死。这里曾经是 `for (page = 0; page < 3; page++)`，
     *    题库 200 人时够用，扩到 500 人后被悄悄截到 300 ——
     *    答案一旦落在候选池之外，玩家在搜索框里根本搜不到正确答案，游戏无解。
     *    （由 scripts/test-flow.js 的「下发条数正确」抓出，期望值取自题库实际条数。）
     *
     * 改成「取不满一页即止」，再用 MAX_POOL_SIZE 兜一个硬上限防死循环。
     * 以后题库继续扩，只要不超过 MAX_POOL_SIZE 就不用动这里。
     */
    const players = [];
    const PAGE = 100;
    for (let page = 0; players.length < C.MAX_POOL_SIZE; page++) {
      const res = await db.collection('players')
        .orderBy('id', 'asc')
        .skip(page * PAGE)
        .limit(PAGE)
        .get();
      const list = res.data || [];
      list.forEach(p => players.push(U.pickFields(p, C.CLIENT_FIELDS)));
      if (list.length < PAGE) break;
    }

    return U.ok({
      fresh: true,
      version,
      updatedAt,
      count: players.length,
      players
    });
  } catch (e) {
    console.error('[getPlayers]', e);
    return U.fail(C.CODE.INTERNAL, e.message);
  }
};
