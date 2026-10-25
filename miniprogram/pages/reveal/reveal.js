/**
 * 反向猜球（mode = 'reveal'）—— 常规模式的镜像玩法。
 *
 * 常规：你猜谁，就把「谁 vs 答案」的 8 行比对给你看。
 * 反向：系统逐条公布「答案自己」的属性（国籍→联赛→俱乐部→…），
 *       你随时可以猜；揭晓得越少就猜中，得分越高（(9-条数)×100）。
 *
 * 架构口径与常规模式完全一致：
 *   - 答案、birth_date 都留在服务端；每条线索只是「答案某个属性的值」；
 *   - 猜错的响应**不带 verdict**（8 行比对会白送答案相对信息），只回被猜球员本体；
 *   - 点已揭线索标签 → 复用 candidate-sheet 按绿色精确条件筛候选池，
 *     「筛选结果必含答案」的不变量依旧成立（每条约束都是答案的必要条件）。
 */
const api = require('../../utils/api.js');
const S = require('../../utils/storage.js');
const searchUtil = require('../../utils/search.js');
const theme = require('../../utils/theme.js');
const sfx = require('../../utils/sfx.js');

const DIFF_NAME = { star: '明星局', normal: '标准局', all: '全员局' };
// 8 个线索位（与 _shared REVEAL_ORDER 同序，仅用于渲染占位）
const SLOTS = theme.CLUE_META.map(m => ({ key: m.key, label: m.label }));

Page({
  data: {
    status: 'loading',       // loading | playing | error
    gameId: '',
    difficulty: '',
    dateKey: '',
    used: 0,
    remaining: 8,
    maxGuesses: 8,
    revealedCount: 0,
    maxScore: 800,
    // 8 个线索位：已揭的带 {text}，未揭的显示锁
    slots: [],
    guesses: [],             // [{round, player}]
    players: [],
    sheetShow: false,
    submitting: false,
    revealing: false,
    candPanel: null,
    errMsg: ''
  },

  onLoad(options) {
    this._difficulty = ['star', 'normal', 'all'].indexOf(options.difficulty) !== -1
      ? options.difficulty : '';
    const title = '反向猜球' + (DIFF_NAME[this._difficulty] ? ' · ' + DIFF_NAME[this._difficulty] : '');
    wx.setNavigationBarTitle({ title });
    sfx.setEnabled(S.loadSettings().sound !== false);
    this.setData({ difficulty: this._difficulty });
    this.loadPoolThenStart();
  },

  onShow() {
    sfx.setEnabled(S.loadSettings().sound !== false);
  },

  /** 候选池优先本地，否则现拉（与 game 页同一套：命中缓存也后台校版本） */
  loadPoolThenStart() {
    let pool = S.loadPlayers();
    if (pool && pool.length) {
      pool.forEach(p => { if (!p.__idx) p.__idx = searchUtil.buildSearchIndex(p); });
      this.setData({ players: pool });
      this.start();
      this.refreshPool();
      return;
    }
    api.getPlayers('').then(data => {
      if (data && data.players && data.players.length) {
        S.savePlayers(data.players, data.version, data.updatedAt);
        data.players.forEach(p => { p.__idx = searchUtil.buildSearchIndex(p); });
        this.setData({ players: data.players });
      }
      this.start();
    }).catch(() => {
      this.setData({ status: 'error', errMsg: '候选球员列表加载失败' });
    });
  },

  /** 后台校题库版本，变了就整包热换（面板开着也会被 players 观察者带着重筛） */
  refreshPool() {
    api.getPlayers(S.getVersion())
      .then(data => {
        if (data && data.players && data.players.length) {
          S.savePlayers(data.players, data.version, data.updatedAt);
          data.players.forEach(p => { p.__idx = searchUtil.buildSearchIndex(p); });
          this.setData({ players: data.players });
        }
      })
      .catch(() => { /* 后台校验失败不影响当前对局 */ });
  },

  start(retryCount = 0) {
    this.setData({ status: 'loading', errMsg: '' });
    api.gameStart('reveal', this._difficulty)
      .then(d => this.applyGame(d))
      .catch(e => {
        if (retryCount < 1) {
          setTimeout(() => this.start(retryCount + 1), 600);
          return;
        }
        this.setData({ status: 'error', errMsg: e.message || '加载失败，请检查网络' });
      });
  },

  applyGame(d) {
    if (!d) throw new Error('返回数据为空');
    S.saveLastGame(d.gameId, 'reveal');
    const guesses = (d.rows || []).map(r => ({ round: r.round, player: r.player }));
    this.setData({
      gameId: d.gameId,
      status: d.status,
      used: d.used || 0,
      remaining: d.remaining != null ? d.remaining : d.maxGuesses,
      maxGuesses: d.maxGuesses || 8,
      dateKey: d.dateKey || '',
      revealedCount: d.revealed || 1,
      maxScore: d.maxScore || 800,
      slots: this.buildSlots(d.clues || [], d.revealed || 1),
      guesses,
      guessIds: guesses.map(g => g.player && g.player.id)
    });
    if (d.status !== 'playing') this.gotoResult();
  },

  /** 8 个槽位：已揭的亮出来，未揭的带锁占位 */
  buildSlots(clues, revealed) {
    const byKey = {};
    (clues || []).forEach(c => { byKey[c.key] = c; });
    return SLOTS.map((s, i) => ({
      key: s.key,
      label: s.label,
      order: i + 1,
      locked: i >= revealed,
      text: byKey[s.key] ? byKey[s.key].text : '',
      value: byKey[s.key] ? byKey[s.key].value : null
    }));
  },

  /* ---------------- 揭线索 ---------------- */

  revealNext() {
    if (this.data.status !== 'playing' || this.data.revealing) return;
    if (this.data.revealedCount >= 8) {
      wx.showToast({ title: '8 条都揭开了，直接猜吧', icon: 'none' });
      return;
    }
    this.setData({ revealing: true });
    api.gameReveal(this.data.gameId)
      .then(d => {
        sfx.play('open');
        this.setData({
          revealing: false,
          revealedCount: d.revealed,
          maxScore: d.maxScore,
          slots: this.buildSlots(d.clues || [], d.revealed)
        });
      })
      .catch(e => {
        this.setData({ revealing: false });
        wx.showToast({ title: e.serverMsg || e.message || '没揭晓成功', icon: 'none' });
      });
  },

  /* ---------------- 猜测 ---------------- */

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

  onSelect(e) {
    const player = e.detail && e.detail.player;
    if (!player) return;
    this.submit(player);
  },

  submit(player) {
    if (this.data.submitting || this.data.status !== 'playing') return;
    if (this.data.guesses.some(g => g.player && g.player.id === player.id)) {
      wx.showToast({ title: '已经猜过 TA 了', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });

    api.gameGuess(this.data.gameId, player.id)
      .then(res => {
        const guesses = this.data.guesses.concat([{ round: res.round, player: res.player || player }]);
        this.setData({
          guesses,
          guessIds: guesses.map(g => g.player && g.player.id),
          used: res.used,
          remaining: res.remaining,
          status: res.status,
          submitting: false
        });

        const st = S.loadSettings();
        if (st.vibrate) wx.vibrateShort({ type: 'light' });

        if (res.status === 'won') sfx.play('hit');
        else if (res.status === 'lost') sfx.play('lose');
        else sfx.play('miss');

        if (res.status !== 'playing') {
          setTimeout(() => this.gotoResult(), res.status === 'won' ? 950 : 700);
        }
      })
      .catch(e => {
        this.setData({ submitting: false });
        wx.showToast({ title: e.serverMsg || e.message || '没提交成功', icon: 'none' });
      });
  },

  /* ---------------- 点线索筛候选 ---------------- */

  /**
   * 已揭线索都是答案的精确值 → 构造成绿色线索喂给 candidate-sheet。
   * 数值字段带 arrow:'equal' 才会被 clue.isUsable 认可。
   */
  onSlotTap(e) {
    if (this.data.status !== 'playing') return;
    if (!this.data.players.length) {
      wx.showToast({ title: '题库还没准备好', icon: 'none' });
      return;
    }
    const key = e.currentTarget.dataset.key;
    const slot = this.data.slots.filter(s => s.key === key)[0];
    if (!slot || slot.locked || slot.value == null) return;
    sfx.play('tap');

    const clues = this.data.slots
      .filter(s => !s.locked && s.value != null)
      .map(s => ({
        id: 'rv:' + s.key,
        key: s.key,
        label: s.label,
        text: s.text,
        state: 'green',
        arrow: 'equal',
        value: s.value,
        guess: null
      }));
    if (!clues.length) return;
    this.setData({ candPanel: { clues, initial: ['rv:' + key] } });
  },

  closeCand(e) {
    if (!(e && e.detail && e.detail.silent)) sfx.play('close');
    this.setData({ candPanel: null });
  },

  onCandSelect(e) {
    const player = e.detail && e.detail.player;
    if (!player) return;
    this.submit(player);
  },

  /* ---------------- 其他 ---------------- */

  retry() {
    this.loadPoolThenStart();
  },

  goHome() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  },

  gotoResult() {
    wx.redirectTo({ url: '/pages/result/result?gameId=' + this.data.gameId });
  },

  onShareAppMessage() {
    return {
      title: '只给线索不给名字，你能几条猜出他是谁？',
      path: '/pages/index/index'
    };
  }
});
