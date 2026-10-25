/**
 * ⚠️⚠️⚠️ 本地 Mock 专用 —— 严禁在正式包里启用 ⚠️⚠️⚠️
 *
 * 本文件由 scripts/gen-mock-core.py 从 cloudfunctions/_shared/ 复制而来，
 * 目的是让「不想配云环境、只想先看一眼界面」的人能立刻跑通全局。
 *
 * 它违反了一条架构红线：比对逻辑不允许出现在客户端
 * （有了它，别人就能离线遍历候选池把答案试出来）。
 * 所以：
 *   1. 只有 app.js 里 USE_MOCK = true 时才会被加载；
 *   2. 提审 / 上线前必须把 USE_MOCK 改回 false，并删掉本文件；
 *   3. scripts/check-mp.js 会在 Mock 开启时给出醒目告警。
 *
 * 不要手改这里 —— 改请改 _shared/ 的真源，然后重跑生成脚本。
 */

/**
 * 云函数公共工具 —— 响应封装、时区、答案池、抽样
 */
const crypto = require('./mock-hash');
const C = require('./mock-constants');

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
 *
 * 2026-10-25 起 endless 支持 difficulty 分档（star / normal / all）：
 *   star   -> minFameStar   （默认 5，只抽巨星）
 *   normal -> minFameNormal （默认 4，与每日一题同档）
 *   all / 不传 -> minFameEndless（默认 3，含冷门，保持老行为）
 */
async function getAnswerPoolConfig(db, mode, difficulty) {
  const m = await getMeta(db, 'answer_pool', null);
  const pick = (key, fallback) =>
    (m && typeof m[key] === 'number') ? m[key]
      : (m && typeof m.minFame === 'number') ? m.minFame
        : fallback;

  let minFame;
  if (mode === 'daily') {
    minFame = pick('minFameDaily', C.MIN_FAME_DAILY);
  } else if (difficulty === 'star') {
    minFame = pick('minFameStar', C.MIN_FAME_STAR);
  } else if (difficulty === 'normal') {
    minFame = pick('minFameNormal', C.MIN_FAME_NORMAL);
  } else {
    minFame = pick('minFameEndless', C.MIN_FAME);
  }
  return {
    minFame,
    activeOnly: !!(m && m.activeOnly),
    excludedIds: (m && Array.isArray(m.excludedIds)) ? m.excludedIds : []
  };
}

/* ---------------- 答案池 ---------------- */

/** 专题练习：按主题条件过滤（条件定义见 C.THEMES） */
function themeFilter(p, t) {
  if (!t) return true;
  if (t.league) return p.league === t.league;
  if (t.nationality) return p.nationality === t.nationality;
  if (t.active !== undefined) return p.active === t.active;
  if (t.foot) return p.preferred_foot === t.foot;
  if (t.group) return p.position_group === t.group;
  if (t.bornAfter) return Number(String(p.birth_date || '').slice(0, 4)) > t.bornAfter;
  return true;
}

/**
 * 拉取答案池，按 id 升序 —— 顺序稳定是「同一天同一用户答案固定」的前提。
 * @param {string} mode 'daily' | 'endless' | 'reveal'
 * @param {string} [difficulty] endless/reveal 的难度档：'star' | 'normal' | 'all'
 * @param {string} [theme] 专题 id（C.THEMES 的键）。带专题时忽略难度档，
 *                         固定全员池（minFameEndless）再切主题，避免小池筛空。
 */
async function loadAnswerPool(db, mode, difficulty, theme) {
  const themed = theme && C.THEMES[theme];
  const cfg = await getAnswerPoolConfig(db, mode, themed ? '' : difficulty);
  const where = { fame_level: db.command.gte(cfg.minFame) };
  if (cfg.activeOnly) where.active = true;

  const res = await db.collection('players')
    .where(where)
    .orderBy('id', 'asc')
    .limit(C.MAX_POOL_SIZE)
    .get();

  let pool = (res.data || []).filter(p => cfg.excludedIds.indexOf(p.id) === -1);
  if (!pool.length) pool = res.data || [];
  if (themed) pool = pool.filter(p => themeFilter(p, C.THEMES[theme]));
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
 * extra：模式特有的附加字段（如 reveal 模式的已揭线索），浅合并进 data。
 */
function publicGame(game, rows = [], extra = {}) {
  const used = (game.guessIds || []).length;
  return Object.assign({
    gameId: game.gameId,
    mode: game.mode,
    difficulty: game.difficulty || '',
    theme: game.theme || '',
    dateKey: game.dateKey,
    maxGuesses: game.maxGuesses || C.MAX_GUESSES,
    used,
    remaining: Math.max(0, (game.maxGuesses || C.MAX_GUESSES) - used),
    status: game.status,
    score: game.score || 0,
    rows
  }, extra);
}

/* ---------------- 反向猜球：线索揭晓 ---------------- */

/**
 * 「反向猜球」已揭晓的线索（答案自身的精确属性）。
 *
 * 只下发前 revealedCount 条（按 C.REVEAL_ORDER 顺序），绝不带 answerId
 * 或答案姓名。年龄在服务端算好 —— birth_date 本身不能在这一步下发。
 *
 * @returns {Array<{key, label, text, value}>}
 */
function revealCluesOf(answer, revealedCount, dateKey) {
  if (!answer || !revealedCount) return [];
  const cmp = require('./mock-compare');
  const out = [];
  const labels = {
    nationality: '国籍', league: '联赛', club: '俱乐部', position: '位置',
    age: '年龄', height: '身高', shirt_number: '球衣号', preferred_foot: '惯用脚'
  };
  C.REVEAL_ORDER.slice(0, Math.max(0, Math.min(revealedCount, C.REVEAL_ORDER.length)))
    .forEach(key => {
      let value, text;
      if (key === 'age') {
        value = cmp.calcAge(answer.birth_date, dateKey || beijingDateKey());
        text = value + '岁';
      } else if (key === 'height') {
        value = answer.height_cm;
        text = value + 'cm';
      } else if (key === 'shirt_number') {
        value = answer.shirt_number;
        text = '#' + value;
      } else {
        value = answer[key];
        text = String(value);
      }
      out.push({ key, label: labels[key], text, value });
    });
  return out;
}

/** 反向猜球：当前「立刻猜中」的得分（揭得越少分越高，与常规模式同构） */
function revealMaxScore(revealedCount, maxGuesses) {
  const max = maxGuesses || C.MAX_GUESSES;
  const n = Math.max(1, Math.min(revealedCount || 1, max));
  return Math.max(0, (max + 1 - n) * 100);
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
      verdict: require('./mock-compare').compare(p, answer, dateKey),
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
  themeFilter,
  genGameId, modHex, pickFields, publicGame,
  revealCluesOf, revealMaxScore,
  findGame, findToday, getPlayerById, replayRows
};
