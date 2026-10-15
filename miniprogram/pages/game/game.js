const api = require('../../utils/api.js');
const S = require('../../utils/storage.js');
const searchUtil = require('../../utils/search.js');
const clueUtil = require('../../utils/clue.js');
const sfx = require('../../utils/sfx.js');

const MAX_RETRY = 1;
const TIP_KEY = 'gp_tip_clue';      // 「点标签可筛选」新手提示只看一次

Page({
  data: {
    mode: 'daily',
    gameId: '',
    status: 'loading',       // loading | playing | won | lost | error
    maxGuesses: 8,
    used: 0,
    remaining: 8,
    dateKey: '',
    rows: [],
    guessedIds: [],
    players: [],
    sheetShow: false,
    submitting: false,
    anchor: '',
    errMsg: '',
    titleText: '每日一题',
    // 候选筛选面板
    candPanel: null,
    tipShow: false
  },

  onLoad(options) {
    const mode = options.mode === 'endless' ? 'endless' : 'daily';
    this._resumeId = options.gameId || '';
    this.setData({
      mode,
      titleText: mode === 'daily' ? '每日一题' : '自由练习'
    });

    wx.setNavigationBarTitle({
      title: mode === 'daily' ? '每日一题' : '自由练习'
    });

    sfx.setEnabled(S.loadSettings().sound !== false);
    this.loadPoolThenStart();
  },

  /** 从设置页回来时同步音效开关 */
  onShow() {
    sfx.setEnabled(S.loadSettings().sound !== false);
  },

  onUnload() {
    if (this._tipTimer) {
      clearTimeout(this._tipTimer);
      this._tipTimer = null;
    }
  },

  /** 候选池优先本地，否则现拉 */
  loadPoolThenStart() {
    let pool = S.loadPlayers();
    if (pool && pool.length) {
      pool.forEach(p => {
        if (!p.__idx) p.__idx = searchUtil.buildSearchIndex(p);
      });
      this.setData({ players: pool });
      this.start();
      return;
    }

    api.getPlayers('')
      .then(data => {
        if (data && data.players && data.players.length) {
          S.savePlayers(data.players, data.version, data.updatedAt);
          const list = data.players;
          list.forEach(p => { p.__idx = searchUtil.buildSearchIndex(p); });
          this.setData({ players: list });
        }
        this.start();
      })
      .catch(() => {
        // 题库没拉到也允许进游戏（搜索会没结果），这里给明确提示
        this.setData({
          status: 'error',
          errMsg: '候选球员列表加载失败'
        });
      });
  },

  start(retryCount = 0) {
    this.setData({ status: 'loading', errMsg: '' });

    const isDaily = this.data.mode === 'daily';
    // daily：服务端幂等，永远返回今天的那一局
    // endless：带 gameId 则续，否则新开
    const task = isDaily
      ? api.gameStart('daily')
      : (this._resumeId ? api.gameResume(this._resumeId) : api.gameStart('endless'));

    task
      .then(d => this.applyGame(d))
      .catch(e => {
        if (retryCount < MAX_RETRY) {
          setTimeout(() => this.start(retryCount + 1), 600);
          return;
        }
        this.setData({ status: 'error', errMsg: e.message || '加载失败，请检查网络' });
      });
  },

  /** 把服务端返回的对局状态落到 data */
  applyGame(d) {
    if (!d) throw new Error('返回数据为空');

    const pool = this.data.players || [];
    // 服务端 replayRows 已带 player；本地候选池只是兜底
    const rows = (d.rows || []).map(r => ({
      round: r.round,
      guessedId: r.guessedId,
      verdict: r.verdict,
      player: r.player || this.findPlayer(pool, r.guessedId)
    }));

    this.setData({
      gameId: d.gameId,
      status: d.status,
      maxGuesses: d.maxGuesses || 8,
      used: d.used || 0,
      remaining: d.remaining != null ? d.remaining : (d.maxGuesses || 8),
      dateKey: d.dateKey || '',
      rows,
      guessedIds: (d.rows || []).map(r => r.guessedId)
    });

    S.saveLastGame(d.gameId, this.data.mode);

    // 已结束就直接进结果页
    if (d.status !== 'playing') {
      this.gotoResult();
      return;
    }

    // 滚到最后一行
    if (rows.length) {
      this.setData({ anchor: 'row-' + rows[rows.length - 1].round });
    }
  },

  findPlayer(pool, id) {
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].id === id) return pool[i];
    }
    return { id, name_cn: '未知球员', name_en: '' };
  },

  /* ---------------- 交互 ---------------- */

  openSheet() {
    if (this.data.status !== 'playing' || this.data.submitting) return;
    if (!this.data.players.length) {
      wx.showToast({ title: '题库还没准备好', icon: 'none' });
      return;
    }
    sfx.play('open');
    this.setData({ sheetShow: true });
  },

  closeSheet(e) {
    if (!(e && e.detail && e.detail.silent)) sfx.play('close');
    this.setData({ sheetShow: false });
  },

  /**
   * 点了线索卡上的某个标签 —— 按这条线索筛出还符合条件的球员。
   * 默认只启用被点的那一条；想叠加更多线索在面板里自己勾。
   */
  onClue(e) {
    if (this.data.status !== 'playing' || this.data.submitting) return;
    const { key, round } = (e && e.detail) || {};
    if (!key) return;

    const all = clueUtil.buildClues(this.data.rows);
    const picked = all.filter(c => c.key === key && c.round === round)[0];
    sfx.play('tap');

    if (!picked) {
      wx.showToast({ title: '这条线索暂时用不上', icon: 'none' });
      return;
    }
    // 线索和初始条件必须一次性传进去，否则组件可能先拿到旧的线索池
    this.setData({
      candPanel: { clues: all, initial: [picked.id] }
    });
  },

  closeCand(e) {
    if (!(e && e.detail && e.detail.silent)) sfx.play('close');
    this.setData({ candPanel: null });
  },

  onCandSelect(e) {
    const player = e.detail && e.detail.player;
    if (!player) return;
    this._picked = player;
    this.submit(player.id);
  },

  /** 新手提示：只在第一次猜完时出现一次 */
  maybeTip() {
    if (this.data.tipShow) return;
    try {
      if (wx.getStorageSync(TIP_KEY)) return;
    } catch (err) { return; }
    this.setData({ tipShow: true });
    this._tipTimer = setTimeout(() => this.hideTip(), 6000);
  },

  hideTip() {
    if (this._tipTimer) {
      clearTimeout(this._tipTimer);
      this._tipTimer = null;
    }
    this.setData({ tipShow: false });
    try { wx.setStorageSync(TIP_KEY, 1); } catch (err) { /* ignore */ }
  },

  retry() {
    this.loadPoolThenStart();
  },

  goHelp() {
    wx.navigateTo({ url: '/pages/help/help' });
  },

  onSelect(e) {
    const player = e.detail && e.detail.player;
    if (!player) return;
    this._picked = player;   // 搜索面板给的就是完整对象，不必回本地池再查一次
    this.submit(player.id);
  },

  submit(playerId) {
    if (this.data.submitting) return;
    if (this.data.status !== 'playing') return;
    if (this.data.guessedIds.indexOf(playerId) !== -1) {
      wx.showToast({ title: '已经猜过 TA 了', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    api.gameGuess(this.data.gameId, playerId)
      .then(res => {
        const picked = (this._picked && this._picked.id === res.guessedId) ? this._picked : null;
        const row = {
          round: res.round,
          guessedId: res.guessedId,
          verdict: res.verdict,
          player: picked || this.findPlayer(this.data.players, res.guessedId)
        };
        this._picked = null;

        const rows = this.data.rows.concat([row]);
        this.setData({
          rows,
          guessedIds: this.data.guessedIds.concat([playerId]),
          status: res.status,
          used: res.used,
          remaining: res.remaining,
          submitting: false,
          anchor: 'row-' + row.round
        });

        const st = S.loadSettings();
        if (st.vibrate) wx.vibrateShort({ type: 'light' });

        // 结果音：三种语气分开，猜错也不能打击人
        if (res.status === 'won') sfx.play('hit');
        else if (res.status === 'lost') sfx.play('lose');
        else sfx.play('miss');

        // 第一次猜完顺手教一次「标签可以点」，只出现一次
        if (res.status === 'playing' && row.round === 1) this.maybeTip();

        if (res.status !== 'playing') {
          // 留够时间让结果音播完再跳结果页（命中是琶音，稍长一点）
          setTimeout(() => this.gotoResult(), res.status === 'won' ? 950 : 700);
        }
      })
      .catch(e => {
        this.setData({ submitting: false });
        if (e.code === 1005) {
          // 重复猜测：不消耗次数，同步本地状态
          this.setData({
            guessedIds: this.data.guessedIds.concat([playerId])
          });
        }
        wx.showToast({ title: e.serverMsg || e.message || '没提交成功', icon: 'none' });
      });
  },

  gotoResult() {
    wx.redirectTo({
      url: '/pages/result/result?gameId=' + this.data.gameId
    });
  },

  onShareAppMessage() {
    return {
      title: '我在猜球员，你来试试？',
      path: '/pages/index/index'
    };
  }
});
