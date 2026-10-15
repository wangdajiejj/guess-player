/**
 * ⚠️⚠️⚠️  当前是「本地测试模式」  ⚠️⚠️⚠️
 *
 * 由 scripts/toggle-mock.js 自动改写，手改这里没用（下次切换会被覆盖）。
 * 这个模式下小程序完全不连云：5 个「云函数」都在客户端跑，数据存在本机 storage。
 * 所以不需要 AppID、不需要备案、不需要云开发环境，打开就能玩。
 *
 * 提审前请双击 scripts/关闭本地测试-提审前必点.bat。
 */

/**
 * ⚠️ 这个 USE_MOCK 开关由 scripts/toggle-mock.js 维护，别手改：
 *   false = 正式版（连云）
 *   true  = 本地测试模式（不连云、5 个云函数在客户端跑）
 * 两个方向的切换分别对应 scripts 下的两个 .bat。
 *
 * 为什么正式包必须留在 false：本地测试模式把比对逻辑和答案池放进了客户端，
 * 留着提审等于让人能离线遍历候选池把答案试出来（详见 docs/03-algorithm.md §6）。
 */
const USE_MOCK = true;

/**
 * 云开发环境 ID。
 * 微信开发者工具 → 云开发 → 环境 → 环境 ID，形如 guess-player-1a2b3c4d。
 * ⚠️ 这是上线前**必须换成你自己的**那一处。
 */
const ENV_ID = 'guess-player-1a2b3c4d';

App({
  globalData: {
    // 保留这个字段（恒为 false）是为了让 check-mp.js 的守卫有东西可查，
    // 也让 _mock-backup 还原时 api.js 的 useMock() 直接可用
    useMock: USE_MOCK,
    envId: ENV_ID,
    cloudReady: false,
    // 候选池（500 人）会缓存在 storage，这里只做内存镜像
    playerCacheKey: 'gp_players',
    playerVersionKey: 'gp_players_version',
    lastGameIdKey: 'gp_last_gameid',
    settingsKey: 'gp_settings',
    statsKey: 'gp_stats',
    bestKey: 'gp_best'
  },

  onLaunch() {
    /* >>> MOCK-BEGIN：本地测试模式专用，正式包必须删掉 <<< */
    if (USE_MOCK) {
      console.warn(
        '[猜球员] 当前是「本地测试模式」：没有连任何云服务，数据都在你本机。\n' +
        '        提审前请双击 scripts/关闭本地测试-提审前必点.bat 换回正式版。'
      );
      this.globalData.cloudReady = true;
      this.prefetchPlayers();
      this.notifyMock();
      return;
    }
    /* <<< MOCK-END <<< */


    if (!wx.cloud) {
      wx.showModal({
        title: '基础库版本过低',
        content: '请把微信升级到最新版本后重试',
        showCancel: false
      });
      return;
    }

    wx.cloud.init({
      env: ENV_ID,
      traceUser: true // 记录访问用户，用于后台用户分析（匿名用户，非隐私采集）
    });

    this.globalData.cloudReady = true;

    // 静默拉一次候选池，写入本地缓存，让游戏页零等待
    this.prefetchPlayers();
  },

  /** 预拉取候选池，失败不影响启动 */
  prefetchPlayers() {
    try {
      const api = require('./utils/api.js');
      const S = require('./utils/storage.js');
      const version = wx.getStorageSync(this.globalData.playerVersionKey) || '';
      api.getPlayers(version).then(data => {
        if (data && data.fresh && data.players && data.players.length) {
          S.savePlayers(data.players, data.version, data.updatedAt);
        }
      }).catch(() => { /* 静默失败，进页面会重试 */ });
    } catch (e) { /* ignore */ }
  }
  /* >>> MOCK-BEGIN：本地测试模式专用，正式包必须删掉 <<< */
  , /** 让用户一眼看出当前跑在本地测试模式上，而不是「怎么没数据」 */
  notifyMock() {
    setTimeout(() => {
      wx.showToast({ title: '本地测试模式', icon: 'none', duration: 1800 });
    }, 600);
  }
  /* <<< MOCK-END <<< */

});
