const S = require('../../utils/storage.js');
/* >>> MOCK-BEGIN：本地测试模式专用，正式包必须删掉 <<< */
const api = require('../../utils/api.js');
/* <<< MOCK-END <<< */
const sfx = require('../../utils/sfx.js');

Page({
  data: {
    settings: { vibrate: true, sound: true },
    stats: { played: 0, won: 0, streak: 0, bestStreak: 0, dist: [] },
    winRate: 0,
    poolCount: 0,
    versionText: '—',
    sfxAvailable: true
    /* >>> MOCK-BEGIN：本地测试模式专用，正式包必须删掉 <<< */
    , mockMode: false
    , mockGames: 0
    /* <<< MOCK-END <<< */
  },

  onShow() {
    sfx.setEnabled(S.loadSettings().sound !== false);
    this.refresh();
    this.setData({
      sfxAvailable: sfx.available()
      /* >>> MOCK-BEGIN：本地测试模式专用，正式包必须删掉 <<< */
      , mockMode: api.isMock()
      , mockGames: this.countMockGames()
      /* <<< MOCK-END <<< */
    });
  },

  refresh() {
    const st = S.loadStats();
    const pool = S.loadPlayers();
    const ver = S.getVersion();
    this.setData({
      settings: S.loadSettings(),
      stats: st,
      winRate: st.played ? Math.round(st.won * 100 / st.played) : 0,
      poolCount: pool.length,
      versionText: ver ? String(ver).slice(-6) : '未缓存'
    });
  },

  onVibrate(e) {
    const v = !!e.detail.value;
    const s = S.loadSettings();
    s.vibrate = v;
    S.saveSettings(s);
    this.setData({ settings: s });
    if (v) wx.vibrateShort({ type: 'light' });
  },

  onSound(e) {
    const v = !!e.detail.value;
    const s = S.loadSettings();
    s.sound = v;
    S.saveSettings(s);
    sfx.setEnabled(v);
    this.setData({ settings: s });
    // 打开时立刻响一下，让用户知道是什么声音
    if (v) sfx.play('tap');
  },

  clearStats() {
    const played = this.data.stats.played;
    if (!played) {
      wx.showToast({ title: '还没有战绩', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '清除本地战绩',
      content: `将删除本机的 ${played} 局记录分布统计，且无法恢复。`,
      confirmText: '清除',
      confirmColor: '#c0392b',
      success: r => {
        if (!r.confirm) return;
        S.clearStats();
        this.refresh();
        wx.showToast({ title: '已清除', icon: 'none' });
      }
    });
  },

  clearCache() {
    wx.showModal({
      title: '刷新球员题库',
      content: '将清除本机缓存的球员题库（约本项目全部候选球员），下次进入时会自动重新拉取。仅在搜索结果异常时需要这么做。',
      confirmText: '刷新',
      success: r => {
        if (!r.confirm) return;
        S.clearPlayers();
        this.refresh();
        wx.showToast({ title: '已清除缓存', icon: 'none' });
      }
    });
  },

  goHelp() {
    wx.navigateTo({ url: '/pages/help/help' });
  }
  /* >>> MOCK-BEGIN：本地测试模式专用，正式包必须删掉 <<< */
  , countMockGames() {
    try { return require('../../utils/mock-api.js').gameCount(); } catch (e) { return 0; }
  }

  /**
   * 本地测试模式下「每日一题」一天只有一道，反复自测很憋屈，
   * 所以给个手动换题的口子。正式包不会有这个入口。
   */
  , resetMock() {
    wx.showModal({
      title: '换一道每日一题',
      content: `将清除本机 ${this.data.mockGames} 局测试对局（含今天已经开过的那局），之后重新抽题。`,
      confirmText: '换一道',
      success: r => {
        if (!r.confirm) return;
        try { require('../../utils/mock-api.js').resetGames(); }
        catch (e) { wx.showToast({ title: '重置失败', icon: 'none' }); return; }
        this.refresh();
        this.setData({ mockGames: 0 });
        wx.showToast({ title: '已重置', icon: 'none' });
      }
    });
  }
  /* <<< MOCK-END <<< */

});
