const api = require('../../utils/api.js');
const S = require('../../utils/storage.js');
const shareUtil = require('../../utils/share.js');
const { calcAge } = require('../../utils/age.js');
const sfx = require('../../utils/sfx.js');

Page({
  data: {
    gameId: '',
    mode: 'daily',
    dateKey: '',
    status: 'lost',
    won: false,
    used: 0,
    max: 8,
    scoreText: '',
    modeText: '',
    rows: [],
    answer: null,
    info: [],
    loading: true,
    errMsg: '',
    generating: false,
    shareReady: false
  },

  onLoad(options) {
    this._gameId = options.gameId || '';
    this._sharePath = '';      // 生成好的分享图本地路径
    this._rawRows = [];        // 给画布用的 {verdict}

    wx.setNavigationBarTitle({ title: '本局结果' });
    sfx.setEnabled(S.loadSettings().sound !== false);

    if (!this._gameId) {
      this.setData({ loading: false, errMsg: '缺少对局信息，请从首页重新进入' });
      return;
    }
    this.load();
  },

  /* ---------------- 数据 ---------------- */

  load() {
    this.setData({ loading: true, errMsg: '' });

    api.gameResult(this._gameId)
      .then(d => {
        if (!d || !d.answer) throw new Error('返回数据不完整');
        this.applyResult(d);
        this.setData({ loading: false });
        // 静默预生成，让用户点"分享给好友"时立刻有图
        this.genShare(true);
      })
      .catch(e => {
        this.setData({
          loading: false,
          errMsg: e.serverMsg || e.message || '加载失败，请检查网络'
        });
      });
  },

  applyResult(d) {
    const a = d.answer || {};
    const max = 8;
    const won = d.status === 'won';
    const rows = (d.rows || []).map(r => ({
      round: r.round,
      guessedId: r.guessedId,
      verdict: r.verdict,
      // 服务端已带上 player；本地候选池缺失时也不会白屏
      player: r.player || { id: r.guessedId, name_cn: '未知球员', name_en: '' }
    }));

    this._rawRows = rows;

    // 本地战绩：同一个 gameId 只计一次（见 storage.recordGame）
    S.recordGame(won, d.used || rows.length, d.gameId);

    // 若本局结束且是无限模式，清掉"未完成对局"记录
    const last = S.loadLastGameFull();
    if (last && last.gameId === d.gameId) S.clearLastGame();

    this.setData({
      gameId: d.gameId,
      mode: d.mode || 'daily',
      dateKey: d.dateKey || '',
      status: d.status,
      won,
      used: d.used || rows.length,
      max,
      rows,
      answer: a,
      scoreText: won ? `${d.used || rows.length}/${max}` : `X/${max}`,
      modeText: d.mode === 'daily'
        ? `每日一题 · ${d.dateKey || ''}`
        : '自由练习',
      info: this.buildInfo(a, d.dateKey || '')
    });
  },

  /** 答案的 8 个字段，顺序与线索行一致，方便对照 */
  buildInfo(a, dateKey) {
    // 库里只存出生日期，年龄按本局自然日实时算（与服务端口径一致）
    const age = calcAge(a.birth_date, dateKey);
    return [
      { label: '国籍', value: a.nationality || '—' },
      { label: '俱乐部', value: a.club || '—' },
      { label: '联赛', value: a.league || '—' },
      { label: '位置', value: a.position || '—' },
      { label: '年龄', value: (age != null ? age : '—') + '岁' },
      { label: '身高', value: (a.height_cm ? a.height_cm : '—') + 'cm' },
      { label: '球衣号', value: '#' + (a.shirt_number != null ? a.shirt_number : '—') },
      { label: '惯用脚', value: a.preferred_foot || '—' }
    ];
  },

  /* ---------------- 分享图 ---------------- */

  /**
   * @param {Boolean} silent true = 后台预生成，失败也不打扰用户
   */
  genShare(silent) {
    if (this._sharePath) return Promise.resolve(this._sharePath);
    if (this.data.generating) return Promise.reject(new Error('正在生成中'));

    this.setData({ generating: true });

    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#shareCanvas')
        .fields({ node: true, size: true })
        .exec(res => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas) {
            this.setData({ generating: false });
            reject(new Error('画布初始化失败'));
            return;
          }

          shareUtil.draw(canvas, {
            mode: this.data.mode,
            status: this.data.status,
            used: this.data.used,
            max: this.data.max,
            rows: this._rawRows,
            dateKey: this.data.dateKey
          })
            .then(path => {
              this._sharePath = path;
              this.setData({ generating: false, shareReady: true });
              resolve(path);
            })
            .catch(e => {
              this.setData({ generating: false });
              if (!silent) wx.showToast({ title: '生成失败，请重试', icon: 'none' });
              reject(e);
            });
        });
    });
  },

  saveImage() {
    const doIt = () => {
      this.genShare(false)
        .then(path => {
          wx.saveImageToPhotosAlbum({
            filePath: path,
            success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
            fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
          });
        })
        .catch(() => {});
    };

    wx.getSetting({
      success: res => {
        // 明确拒绝过 -> 引导去设置页；未问过 -> 直接写（小程序会自己弹授权）
        if (res.authSetting['scope.writePhotosAlbum'] === false) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存战绩图需要访问相册，是否去开启？',
            confirmText: '去设置',
            success: r => { if (r.confirm) wx.openSetting({}); }
          });
          return;
        }
        doIt();
      },
      fail: doIt
    });
  },

  onShareAppMessage() {
    // 有预生成好的图就用，没有就用系统默认截图
    const title = this.data.won
      ? `我用 ${this.data.used}/8 次猜中了今天这名球员`
      : '这名球员我 8 次都没猜出来，你来试试';
    return {
      title,
      path: '/pages/index/index',
      imageUrl: this._sharePath || ''
    };
  },

  onShareTimeline() {
    return {
      // 措辞避开"通关/过关/挑战成功"这类游戏化表述，降低被判游戏类目的风险（见 docs/05-deployment.md §7.2）
      title: this.data.won
        ? `猜球员 ${this.data.used}/8 · 今日已答对`
        : '猜球员 — 8 次机会找出他是谁',
      query: '',
      imageUrl: this._sharePath || ''
    };
  },

  /* ---------------- 导航 ---------------- */

  again() {
    sfx.play('tap');
    wx.redirectTo({ url: '/pages/game/game?mode=endless' });
  },

  goHome() {
    sfx.play('tap');
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  }
});
