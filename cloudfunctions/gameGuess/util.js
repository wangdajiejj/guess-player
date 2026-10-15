/**
 * 云函数公共工具 —— 响应封装、时区、答案池、抽样
 */
const crypto = require('crypto');
const C = require('./constants');

/* ---------------- 响应封装 ---------------- */

function ok(data = {}) {
  return { ok: true, code: C.CODE.OK, data };
}

function fail(code, msg) {
  return { ok: false, code, msg: msg || C.CODE_MSG[code] || '未知错误' };
}

/* ---------------- 日期：强制北京时间自然日 ---------------- */

/**
 * 不能依赖云函数运行环境的时区，必须手动对齐 UTC+8，
 * 否则跨零点的一两个小时会拿到错误的 dateKey。
 */
function beijingDateKey(now = Date.now()) {
  const d = new Date(now + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ---------------- 配置读取 ---------------- */

async function getMeta(db, id, fallback) {
  try {
    const r = await db.collection('meta').doc(id).get();
    return r.data || fallback;
  } catch (e) {
    return fallback;
  }
}

async function getSalt(db) {
  const m = await getMeta(db, 'daily_salt', null);
  return {
    salt: (m && m.salt) || 'GP2026v1_DEFAULT',
    // global    = 同一天所有人答案一致
    // per_user  = 每人每天答案不同（当前采用）
    mode: (m && m.mode) || 'per_user'
  };
}

/**
 * 答案池配置按模式分档（daily 比 endless 严格，理由见 C.MIN_FAME_DAILY）。
 * 线上可用 meta/answer_pool 的 minFameDaily / minFameEndless 覆盖，
 * 老的 minFame 字段保留作兜底，改配置不用停机。
 */
async function getAnswerPoolConfig(db, mode) {
  const m = await getMeta(db, 'answer_pool', null);
  const key = mode === 'daily' ? 'minFameDaily' : 'minFameEndless';
  const fallback = mode === 'daily' ? C.MIN_FAME_DAILY : C.MIN_FAME;
  return {
    minFame: (m && typeof m[key] === 'number') ? m[key]
      : (m && typeof m.minFame === 'number') ? m.minFame
        : fallback,
    activeOnly: !!(m && m.activeOnly),
    excludedIds: (m && Array.isArray(m.excludedIds)) ? m.excludedIds : []
  };
}

/* ---------------- 答案池 ---------------- */

/**
 * 拉取答案池，按 id 升序 —— 顺序稳定是「同一天同一用户答案固定」的前提。
 * @param {string} mode 'daily' | 'endless'
 */
async function loadAnswerPool(db, mode) {
  const cfg = await getAnswerPoolConfig(db, mode);
  const where = { fame_level: db.command.gte(cfg.minFame) };
  if (cfg.activeOnly) where.active = true;

  const res = await db.collection('players')
    .where(where)
    .orderBy('id', 'asc')
    .limit(C.MAX_POOL_SIZE)
    .get();

  let pool = (res.data || []).filter(p => cfg.excludedIds.indexOf(p.id) === -1);
  if (!pool.length) pool = res.data || [];
  return pool;
}

/* ---------------- 抽样 ---------------- */

/**
 * 十六进制字符串对 m 取模 —— 逐位累加，纯整数运算。
 *
 * ⚠️ 千万不要写成 parseInt(hex64, 16) % m：
 *    64 位十六进制约 1.8e19，远超 Number.MAX_SAFE_INTEGER(9e15)，
 *    双精度会把它吸附到 2048 的整数倍上，最后对 200 取模只剩 25 种可能值，
 *    答案分布严重塌缩（这个 bug 由 scripts/test-compare.js 的分布测试抓出）。
 */
function modHex(hexStr, m) {
  let r = 0;
  for (let i = 0; i < hexStr.length; i++) {
    r = (r * 16 + parseInt(hexStr[i], 16)) % m;
  }
  return r;
}

/**
 * 每日答案：sha256(salt | dateKey | [openid]) 取模。
 * mode = global 时不掺 openid，同一天所有人同答案。
 */
function pickDailyAnswer(pool, { salt, dateKey, openid, mode }) {
  if (!pool || !pool.length) return null;
  const tail = mode === 'global' ? '' : `|${openid}`;
  const h = crypto.createHash('sha256')
    .update(`${salt}|${dateKey}${tail}`)
    .digest('hex');
  return pool[modHex(h, pool.length)];
}

/** 无限模式：加密安全随机，客户端不可预测 */
function pickEndlessAnswer(pool) {
  if (!pool || !pool.length) return null;
  return pool[crypto.randomInt(0, pool.length)];
}

/* ---------------- 其他 ---------------- */

function genGameId(dateKey) {
  const rand = crypto.randomBytes(4).toString('hex');
  return `g_${String(dateKey).replace(/-/g, '')}_${rand}`;
}

/** 按白名单裁剪字段，防止把不该下发的字段漏出去 */
function pickFields(player, fields) {
  const out = {};
  fields.forEach(f => {
    if (player[f] !== undefined) out[f] = player[f];
  });
  return out;
}

/**
 * 对局文档 -> 可安全下发给客户端的结构。
 * 关键：绝不携带 answerId。（docs/03-algorithm.md §4.3）
 */
function publicGame(game, rows = []) {
  const used = (game.guessIds || []).length;
  return {
    gameId: game.gameId,
    mode: game.mode,
    dateKey: game.dateKey,
    maxGuesses: game.maxGuesses || C.MAX_GUESSES,
    used,
    remaining: Math.max(0, (game.maxGuesses || C.MAX_GUESSES) - used),
    status: game.status,
    score: game.score || 0,
    rows
  };
}

/** 通过 gameId 查对局，找不到返回 null */
async function findGame(db, gameId) {
  const r = await db.collection('games')
    .where({ gameId })
    .limit(1)
    .get();
  return r.data && r.data[0] ? r.data[0] : null;
}

/** 查某人当天的每日局 */
async function findToday(db, openid, dateKey) {
  const r = await db.collection('games')
    .where({ _openid: openid, mode: 'daily', dateKey })
    .orderBy('startedAt', 'asc')
    .limit(1)
    .get();
  return r.data && r.data[0] ? r.data[0] : null;
}

/** 取球员（按数字主键 id） */
async function getPlayerById(db, id) {
  const r = await db.collection('players').where({ id }).limit(1).get();
  return r.data && r.data[0] ? r.data[0] : null;
}

/**
 * 重放历史猜测：用 guessIds 重新算一遍判定。
 * 用于 gameResume / gameStart 返回已有存档。
 */
async function replayRows(db, game, answer) {
  const dateKey = game.dateKey || beijingDateKey();
  const rows = [];
  const ids = game.guessIds || [];
  for (let i = 0; i < ids.length; i++) {
    const p = await getPlayerById(db, ids[i]);
    if (!p) continue;
    rows.push({
      round: i + 1,
      guessedId: p.id,
      hit: p.id === answer.id,
      verdict: require('./compare').compare(p, answer, dateKey),
      // 顺带下发被猜球员的展示信息，客户端不必再依赖本地候选池渲染历史行
      player: pickFields(p, C.CLIENT_FIELDS)
    });
  }
  return rows;
}

module.exports = {
  ok, fail, beijingDateKey,
  getMeta, getSalt, getAnswerPoolConfig,
  loadAnswerPool, pickDailyAnswer, pickEndlessAnswer,
  genGameId, modHex, pickFields, publicGame,
  findGame, findToday, getPlayerById, replayRows
};
