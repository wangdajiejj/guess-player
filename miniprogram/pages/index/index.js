const api = require('../../utils/api.js');
const S = require('../../utils/storage.js');
const { beijingDateKey } = require('../../utils/age.js');
const sfx = require('../../utils/sfx.js');
const themes = require('../../utils/themes.js');

Page({
  data: {
    today: '',
    dailyLoading: true,
    dailyStatus: '',       // playing | won | lost | ''
    dailyErr: '',          // 连不上云时的可读原因（ENV_ID / 云函数 / 集合）
    dailyUsed: 0,
    dailyRemaining: 8,
    dailyMax: 8,
    pendingGameId: '',
    pendingUsed: 0,
    stats: { played: 0, won: 0, streak: 0, bestStreak: 0, dist: [0, 0, 0, 0, 0, 0, 0, 0] },
    winRate: 0,
    maxDist: 1,
    diffCounts: null,
    themeList: [],
    // 题库规模从本地缓存里读，不写死 —— 扩池后自动跟着变
    // （曾经在 wxml 里硬编码「200 名」，扩到 500 后文案没跟上，属于会静默漂移的坑）
    heroSub: '8 次机会，找出今天的答案球员'
  },

  onLoad() {
    this.setData({ today: beijingDateKey() });
  },

  onShow() {
    sfx.setEnabled(S.loadSettings().sound !== false);
    this.loadStats();
    this.refreshDaily();
    this.checkPending();
    this.loadPoolCount();
  },

  /** 首页副标题里的球员人数 + 各难度档/专题人数：读本地缓存，拿不到就退化成不带数字的说法 */
  loadPoolCount() {
    let list = [];
    try { list = S.loadPlayers() || []; } catch (e) { list = []; }
    const n = list.length;
    // 旧缓存没有 fame_level 字段（2026-10-25 起候选包才带上），此时不显示分档人数
    const withFame = n > 0 && list[0].fame_level != null;
    const themeCounts = withFame ? themes.countAll(list) : null;
    this.setData({
      heroSub: n > 0
        ? '8 次机会，从 ' + n + ' 名球员里找出答案'
        : '8 次机会，找出今天的答案球员',
      diffCounts: withFame ? {
        star: list.filter(p => p.fame_level >= 5).length,
        normal: list.filter(p => p.fame_level >= 4).length,
        all: n
      } : null,
      themeList: themes.THEMES.map(t => ({
        id: t.id, label: t.label, count: themeCounts ? themeCounts[t.id] : 0
      }))
    });
  },

  loadStats() {
    const s = S.loadStats();
    const maxDist = Math.max.apply(null, s.dist.concat([1]));
    this.setData({
      stats: s,
      maxDist,
      winRate: s.played ? Math.round(s.won * 100 / s.played) : 0
    });
  },

  /**
   * daily 模式服务端幂等，这里调用既能查状态，
   * 又能让用户点进游戏页时零等待。
   */
  refreshDaily() {
    this.setData({ dailyLoading: true });
    api.gameStart('daily')
      .then(d => {
        this.setData({
          dailyLoading: false,
          dailyStatus: d.status,
          dailyUsed: d.used || 0,
          dailyRemaining: d.remaining != null ? d.remaining : d.maxGuesses,
          dailyMax: d.maxGuesses || 8,
          dailyErr: ''
        });
        S.saveLastGame(d.gameId, 'daily');
      })
      .catch(e => {
        // 不写「加载失败」这种废话 —— api.js 已经把 ENV_ID / 云函数 / 集合三种情况
        // 翻译成具体该去改哪儿，这里原样显示给用户（首次搭环境时这行能省半小时）
        this.setData({
          dailyLoading: false,
          dailyErr: (e && e.message) || '加载失败'
        });
      });
  },

  /** 检查有没有没打完的无限模式 */
  checkPending() {
    const last = S.loadLastGameFull();
    if (!last || !last.gameId || last.mode !== 'endless') {
      this.setData({ pendingGameId: '' });
      return;
    }
    api.gameResume(last.gameId)
      .then(d => {
        if (d && d.status === 'playing') {
          this.setData({ pendingGameId: d.gameId, pendingUsed: d.used || 0 });
        } else {
          this.setData({ pendingGameId: '' });
        }
      })
      .catch(() => this.setData({ pendingGameId: '' }));
  },

  startDaily() {
    sfx.play('tap');
    wx.navigateTo({ url: '/pages/game/game?mode=daily' });
  },

  /** 按难度开一局自由练习：star=只抽巨星 / normal=知名 / all=含冷门 */
  startEndless(e) {
    const diff = (e && e.currentTarget && e.currentTarget.dataset.diff) || 'all';
    sfx.play('tap');
    wx.navigateTo({ url: '/pages/game/game?mode=endless&difficulty=' + diff });
  },

  /** 反向猜球：同样按难度分档开局 */
  startReveal(e) {
    const diff = (e && e.currentTarget && e.currentTarget.dataset.diff) || 'all';
    sfx.play('tap');
    wx.navigateTo({ url: '/pages/reveal/reveal?difficulty=' + diff });
  },

  /** 专题练习：从主题子池里随机开局 */
  startTheme(e) {
    const theme = e && e.currentTarget && e.currentTarget.dataset.theme;
    if (!theme) return;
    sfx.play('tap');
    wx.navigateTo({ url: '/pages/game/game?mode=endless&theme=' + theme });
  },

  resumePending() {
    if (!this.data.pendingGameId) return;
    sfx.play('tap');
    wx.navigateTo({
      url: '/pages/game/game?mode=endless&gameId=' + this.data.pendingGameId
    });
  },

  viewDailyResult() {
    const last = S.loadLastGameFull();
    // daily 的 gameId 一定存在（refreshDaily 时已写入）
    const gid = last && last.mode === 'daily' ? last.gameId : '';
    if (!gid) { this.refreshDaily(); return; }
    sfx.play('tap');
    wx.navigateTo({ url: '/pages/result/result?gameId=' + gid });
  },

  goHelp() {
    sfx.play('tap');
    wx.navigateTo({ url: '/pages/help/help' });
  },

  goSettings() {
    sfx.play('tap');
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  onShareAppMessage() {
    return { title: '猜球员 — 8 次机会找出他是谁', path: '/pages/index/index' };
  },

  onShareTimeline() {
    return {
      title: '猜球员 — 8 次机会找出他是谁',
      query: ''
    };
  }
});
