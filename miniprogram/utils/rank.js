/**
 * 排行榜数据层 —— 平台无关部分
 *
 * ⚠️ 关于这个文件为什么现在长这样：
 *     真正的「微信好友排行榜」依赖 `wx.setUserCloudStorage` / `wx.getFriendCloudStorage`，
 *     这两个是**小游戏专有 API**，小程序里根本不存在，而且开放数据域只有 canvas、没有 DOM。
 *     所以本文件先把**与平台无关的部分**做出来：分数模型、指标计算、等宽编码、解析。
 *     这部分现在在小程序里就能跑（存本地），将来切到小游戏架构后，
 *     `toKV()` 的产物直接喂给 `setUserCloudStorage`，`fromKV()` 直接解析
 *     `getFriendCloudStorage` 的返回 —— **接口不用改**。
 *
 * 三个必须记住的约束（由 scripts/test-rank.js 守着）：
 *   1. 微信按 value 的**字符串字典序**排序，不是数值序。
 *      所以 value 必须等宽补零，否则 "900" 会排在 "1000" 后面。
 *   2. 微信托管 KV：最多 128 个 key，单个 value ≤ 1KB，且必须是字符串。
 *   3. 个人主体**禁止 UGC** —— 全网排行榜（展示陌生人的数据）做不了，
 *      开放数据域好友排行是合规的，因为**分数存在微信侧，开发者只写不读**。
 */
const S = require('./storage.js');

/** 本地最佳记录的条数上限（多了没意义，也占 storage） */
const BEST_LIMIT = 10;

/** 微信托管 KV 的 key 前缀，避免和别的数据撞名 */
const KV_PREFIX = 'gp_';

/**
 * 各指标的等宽位数 —— 补零后字典序 == 数值序。
 * 位数取的是"这个字段理论上能长到多大"，不是当前数据多大，
 * 否则哪天连胜超过 99 就悄悄排错序了。
 */
const WIDTH = {
  score: 8,      // 累计积分，会一直涨
  best: 2,       // 历史最少步数，1~8
  streak: 4,     // 当前连胜
  bestStreak: 4,
  played: 8,
  won: 8,
  winRate: 4     // 千分比 0~1000
};

/**
 * 单局得分。与云函数 gameGuess 的口径保持一致：
 * score = (MAX_GUESSES + 1 - used) * 100，猜中才有分，范围 100~800。
 *
 * 用"次数越少分越高"而不是"步数越少越好"，是因为排行榜按**大->小**排更自然。
 */
function scoreOf(used, maxGuesses) {
  const max = maxGuesses || 8;
  const u = Math.max(1, Math.min(used || 1, max));
  return (max + 1 - u) * 100;
}

/**
 * 等宽补零。
 *
 * ⚠️ 这是整个文件最关键的五行：微信开放数据域拿到的 value 是字符串，
 *    排序走字典序。不补零时 "900" > "1000"（因为 '9' > '1'），排行榜全乱。
 */
function pad(v, width) {
  let s = String(v == null ? 0 : v);
  // 超过宽度说明取值超预期，截断会悄悄改变大小关系 —— 宁可让它一眼看出来
  if (s.length > width) return s.slice(-width);
  while (s.length < width) s = '0' + s;
  return s;
}

/** 反解：'0000123' -> 123 */
function unpad(s) {
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 从本地战绩导出排行榜指标。
 * 胜率用千分比（0~1000）而不是百分比，是为了省掉小数 ——
 * 托管 KV 的 value 是字符串，带小数点的排序更麻烦。
 */
function metricsOf(stats) {
  const s = stats || {};
  const played = s.played || 0;
  const won = s.won || 0;
  // played=0 时别返回 NaN，否则补零后变成 "NaN" 排在中间
  const winRate = played ? Math.round(won * 1000 / played) : 0;
  return {
    // 累计积分：用猜中的总分，玩得多、猜得快的人排前面
    score: (s.scoreSum || 0),
    best: s.bestSteps || 0,          // 历史最少步数（越小越好，展示时再翻过来）
    streak: s.streak || 0,
    bestStreak: s.bestStreak || 0,
    played: played,
    won: won,
    winRate: winRate
  };
}

/**
 * 生成微信托管 KV 的 KVDataList。
 * 现在的落点：本地 storage。将来切小游戏：直接喂 setUserCloudStorage。
 */
function toKV(stats) {
  const m = metricsOf(stats);
  const out = [];
  Object.keys(WIDTH).forEach(k => {
    out.push({ key: KV_PREFIX + k, value: pad(m[k], WIDTH[k]) });
  });
  return out;
}

/** 解析回来（开放数据域收到好友数据后用） */
function fromKV(list) {
  const m = {};
  (list || []).forEach(kv => {
    if (!kv || typeof kv.key !== 'string') return;
    if (kv.key.indexOf(KV_PREFIX) !== 0) return;
    const k = kv.key.slice(KV_PREFIX.length);
    if (!WIDTH[k]) return;
    m[k] = unpad(kv.value);
  });
  return m;
}

/**
 * 排序键 —— 告诉开放数据域按哪个 key 排。
 * 取 score（累计积分）：玩得多且猜得快的人靠前。
 */
function sortKey() {
  return KV_PREFIX + 'score';
}

/* ---------------- 本地最佳记录（现在就能用的部分） ---------------- */

/** 持久化走 storage.js，key 名统一在 storage 的 KEYS() 里管，这里不硬编码 */

function normEntry(e) {
  return {
    gameId: e.gameId || '',
    date: e.date || '',
    mode: e.mode === 'endless' ? 'endless' : 'daily',
    won: !!e.won,
    used: Math.max(1, Math.min(e.used || 1, 8)),
    score: e.score || 0,
    playerId: e.playerId || 0,
    playerName: e.playerName || ''
  };
}

/**
 * 排序规则：先按得分降序，同分再按步数少、日期新靠前。
 * 只有猜中的局进榜 —— 没猜中的局没有步数可比，塞进去会把榜单冲淡。
 */
function cmpEntry(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.used !== b.used) return a.used - b.used;
  return String(b.date).localeCompare(String(a.date));
}

function loadBest() {
  return S.loadBest();
}

/**
 * 记一局进最佳记录。
 *
 * @returns {Array} 记录后的榜单（未变化则返回原数组引用，方便调用方判断是否要 setData）
 */
function recordBest(entry) {
  const e = normEntry(entry);
  if (!e.won) return S.loadBest();                  // 没猜中不进榜

  let list = S.loadBest();
  // 同一个 gameId 只记一次：结果页可能被多次进入（分享返回、下拉回退）
  if (e.gameId && list.some(x => x.gameId === e.gameId)) return list;

  list.push(e);
  list.sort(cmpEntry);
  list = list.slice(0, BEST_LIMIT);
  S.saveBest(list);
  return list;
}

/** 清最佳记录（设置页「清除战绩」时一起清） */
function clearBest() {
  S.saveBest([]);
}

module.exports = {
  BEST_LIMIT, KV_PREFIX, WIDTH,
  scoreOf, pad, unpad,
  metricsOf, toKV, fromKV, sortKey,
  loadBest, recordBest, clearBest
};
