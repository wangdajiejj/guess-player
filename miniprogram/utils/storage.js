/**
 * 本地候选池存取 + 版本管理 + 战绩存档 + 设置项
 */
const app = () => getApp();

const KEYS = () => ({
  players: app().globalData.playerCacheKey,
  version: app().globalData.playerVersionKey,
  lastGameId: app().globalData.lastGameIdKey,
  settings: app().globalData.settingsKey,
  stats: app().globalData.statsKey,
  best: app().globalData.bestKey
});

/* ---------------- 候选池 ---------------- */

function savePlayers(list, version, updatedAt) {
  try {
    wx.setStorageSync(KEYS().players, list);
    wx.setStorageSync(KEYS().version, version);
  } catch (e) {
    // 超配额时先清掉再试一次；仍失败则本次不走缓存（不阻塞游戏）
    try {
      wx.removeStorageSync(KEYS().players);
      wx.setStorageSync(KEYS().players, list);
      wx.setStorageSync(KEYS().version, version);
    } catch (e2) { /* ignore */ }
  }
}

function loadPlayers() {
  try {
    return wx.getStorageSync(KEYS().players) || [];
  } catch (e) {
    return [];
  }
}

function getVersion() {
  try {
    return wx.getStorageSync(KEYS().version) || '';
  } catch (e) {
    return '';
  }
}

/**
 * 给每个球员补上客户端检索用的 index（服务端下发的包里已剔除该字段）
 */
function ensureIndex(list) {
  const { fold, buildSearchIndex } = require('./search.js');
  list.forEach(p => {
    if (!p.__idx) p.__idx = buildSearchIndex(p);
  });
  return list;
}

/* ---------------- 上次对局 ---------------- */

/**
 * @param {String} gameId
 * @param {String} mode 'daily' | 'endless'
 */
function saveLastGame(gameId, mode) {
  try {
    wx.setStorageSync(KEYS().lastGameId, { gameId, mode, at: Date.now() });
  } catch (e) {}
}

function loadLastGame() {
  try {
    const v = wx.getStorageSync(KEYS().lastGameId);
    // 兼容早期只存字符串的版本
    if (!v) return '';
    if (typeof v === 'string') return v;
    return v.gameId || '';
  } catch (e) {
    return '';
  }
}

function loadLastGameFull() {
  try {
    const v = wx.getStorageSync(KEYS().lastGameId);
    if (!v) return null;
    return typeof v === 'string' ? { gameId: v, mode: '', at: 0 } : v;
  } catch (e) {
    return null;
  }
}

function clearLastGame() {
  try { wx.removeStorageSync(KEYS().lastGameId); } catch (e) {}
}

/* ---------------- 设置 ---------------- */

const DEFAULT_SETTINGS = { vibrate: true, sound: true };

function loadSettings() {
  try {
    return Object.assign({}, DEFAULT_SETTINGS, wx.getStorageSync(KEYS().settings) || {});
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(s) {
  try { wx.setStorageSync(KEYS().settings, s); } catch (e) {}
}

/* ---------------- 本地战绩统计（不上传服务器） ---------------- */

const DEFAULT_STATS = {
  played: 0, won: 0, streak: 0, bestStreak: 0,
  scoreSum: 0,    // 累计得分，排行榜的排序依据
  bestSteps: 0,   // 历史最少步数（0 = 还没猜中过）
  dist: [0, 0, 0, 0, 0, 0, 0, 0],
  lastGameId: ''   // 只用于去重，不展示
};

function loadStats() {
  try {
    const s = wx.getStorageSync(KEYS().stats);
    if (!s) return Object.assign({}, DEFAULT_STATS);
    return Object.assign({}, DEFAULT_STATS, s, {
      dist: (s.dist && s.dist.length === 8) ? s.dist : DEFAULT_STATS.dist.slice()
    });
  } catch (e) {
    return Object.assign({}, DEFAULT_STATS);
  }
}

/**
 * 记录一局结果。used 为 1-8；won 为是否猜中。
 * maxGuesses 默认 8（与常量 MAX_GUESSES 一致），由调用方传入以保持口径统一。
 *
 * ⚠️ gameId 去重必须有：结果页可能被多次进入（分享后返回、下拉回退），
 *    没有这层保护，同一局会被重复计入"已玩局数"。
 *
 * ⚠️ 这里的得分公式必须与 utils/rank.js 的 scoreOf() 完全一致
 *    （排行榜排序依赖它，两边漂移会导致榜上分数和实际对不上）。
 *    由 scripts/test-rank.js 的「得分口径与云函数一致」守着。
 */
function recordGame(won, used, gameId, maxGuesses) {
  const s = loadStats();
  if (gameId) {
    if (s.lastGameId === gameId) return s;
    s.lastGameId = gameId;
  }
  const max = maxGuesses || 8;
  const u = Math.max(1, Math.min(used || 1, max));
  s.played += 1;
  if (won) {
    s.won += 1;
    s.dist[Math.min(u, 8) - 1] += 1;
    s.streak += 1;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    s.scoreSum = (s.scoreSum || 0) + (max + 1 - u) * 100;
    if (!s.bestSteps || u < s.bestSteps) s.bestSteps = u;
  } else {
    s.streak = 0;
  }
  try { wx.setStorageSync(KEYS().stats, s); } catch (e) {}
  return s;
}

function clearStats() {
  try {
    wx.removeStorageSync(KEYS().stats);
    wx.removeStorageSync(KEYS().best);
  } catch (e) {}
}

/* ---------------- 最佳记录（排行榜的本地部分） ---------------- */

function saveBest(list) {
  try { wx.setStorageSync(KEYS().best, list); } catch (e) {}
}

function loadBest() {
  try {
    const l = wx.getStorageSync(KEYS().best);
    return Array.isArray(l) ? l : [];
  } catch (e) {
    return [];
  }
}

/** 只清候选池（下次进入会按版本号重新拉取） */
function clearPlayers() {
  try {
    wx.removeStorageSync(KEYS().players);
    wx.removeStorageSync(KEYS().version);
  } catch (e) {}
}

module.exports = {
  savePlayers, loadPlayers, getVersion, ensureIndex,
  saveLastGame, loadLastGame, loadLastGameFull, clearLastGame,
  loadSettings, saveSettings,
  loadStats, recordGame,
  clearStats, clearPlayers,
  saveBest, loadBest
};
