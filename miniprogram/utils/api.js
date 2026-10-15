/**
 * 云函数调用统一封装
 *
 * 把服务端返回的 { ok, code, msg, data } 这层信封，
 * 转成 Promise<data> / reject({ code, msg })，页面层只管拿数据。
 *
 * ⚠️ 曾经这里有一条「本地测试」分支（客户端假扮服务端），
 * 已从正式包移除：那等于把比对逻辑和答案池打进客户端。
 * 想本地跑起来就双击 scripts\开启本地测试.bat（它会把那段拼回来）。
 */
const app = () => getApp();

/** 信封 -> Promise。所有接口共用同一套解包规则。 */
function unwrap(r) {
  const res = r || {};
  if (res.ok) return Promise.resolve(res.data);

  const err = new Error(res.msg || '请求失败');
  err.code = res.code || -1;
  err.serverMsg = res.msg;
  err.isServer = true;   // 业务错误：说明云已连通，只是这个请求被拒
  return Promise.reject(err);
}

/**
 * 把「连不上云」的原始报错翻译成人话。
 *
 * 微信开发者工具里新手最常撞的三堵墙是：
 *   -501000 environment not found            → ENV_ID 还是模板里那个假值
 *   FunctionName parameter could not be found → 云函数还没上传
 *   collection not exists                     → 集合没建 / 题库没导入
 * 原样抛给用户只会看到一串英文，所以这里做一次归因。
 */
function diagnose(e) {
  const raw = String((e && (e.errMsg || e.message)) || '');
  if (/environment not found|-501000/i.test(raw)) {
    return '云环境没连上：请把 miniprogram/app.js 的 ENV_ID 换成你自己云开发环境的 ID';
  }
  if (/FunctionName|Function not found|could not be found/i.test(raw)) {
    return '云函数还没上传：在开发者工具左侧 cloudfunctions 上右键 → 上传并部署';
  }
  if (/collection|database|not exists?/i.test(raw)) {
    return '数据库集合还没建：先建 games / players / meta 三个集合并导入题库';
  }
  if (/timeout|network|fail/i.test(raw)) {
    return '网络好像有点问题，稍后再试';
  }
  return raw || '请求失败';
}

/* >>> MOCK-BEGIN：本地测试模式专用，正式包必须删掉 <<< */

/** 本地假造一点网络延迟，免得 Mock 下 loading 一闪而过看不清 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function useMock() {
  try { return !!(app() && app().globalData && app().globalData.useMock); }
  catch (e) { return false; }
}

function mkErr(code, msg) {
  const e = new Error(msg);
  e.code = code;
  e.serverMsg = msg;
  return e;
}

function callMock(name, data) {
  let mock;
  try {
    mock = require('./mock-api.js');
  } catch (e) {
    return Promise.reject(mkErr(-1, 'mock-api.js 不存在，请双击 scripts/开启本地测试.bat 重新安装'));
  }
  const table = {
    gameStart: () => mock.gameStart(data.mode),
    gameGuess: () => mock.gameGuess(data.gameId, data.playerId),
    gameResume: () => mock.gameResume(data.gameId),
    gameResult: () => mock.gameResult(data.gameId),
    getPlayers: () => mock.getPlayers(data.version)
  };
  const fn = table[name];
  if (!fn) return Promise.reject(mkErr(-1, 'Mock 未实现接口：' + name));
  return delay(name === 'getPlayers' ? 60 : 140).then(() => unwrap(fn()));
}
/* <<< MOCK-END <<< */

function call(name, data = {}) {
  /* >>> MOCK-BEGIN <<< */
  if (useMock()) return callMock(name, data);
  /* <<< MOCK-END <<< */


  return wx.cloud
    .callFunction({ name, data })
    .then(res => unwrap(res.result || {}))
    .catch(e => {
      if (e && e.isServer) throw e;     // 业务错误，原样往上抛
      const err = new Error(diagnose(e));
      err.code = (e && e.errCode) || -1;
      err.raw = e;
      throw err;
    });
}

module.exports = {
  /** 幂等开局 */
  gameStart: (mode) => call('gameStart', { mode }),

  /** 提交猜测 */
  gameGuess: (gameId, playerId) => call('gameGuess', { gameId, playerId }),

  /** 续上次对局 */
  gameResume: (gameId) => call('gameResume', { gameId }),

  /** 揭晓答案（仅终局后） */
  gameResult: (gameId) => call('gameResult', { gameId }),

  /** 拉候选池，带版本号增量 */
  getPlayers: (version) => call('getPlayers', { version }),

  /* >>> MOCK-BEGIN：本地测试模式专用，正式包必须删掉 <<< */
  isMock: useMock,
  /* <<< MOCK-END <<< */

  /** 把网络错误翻译成人话，给页面直接用 */
  diagnose
};
