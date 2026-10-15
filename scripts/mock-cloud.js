/**
 * wx-server-sdk 的内存版替身 —— 只服务于 scripts/test-flow.js
 *
 * 目的：让 5 个云函数的**真实代码**能在 Node 里跑一遍完整对局，
 * 不用连真云环境就能验证「开局 → 猜测 → 终局 → 揭晓」全链路。
 *
 * 覆盖了被测代码实际用到的全部 API：
 *   cloud.init / cloud.DYNAMIC_CURRENT_ENV / cloud.getWXContext
 *   db.collection(name).where().orderBy().skip().limit().get()
 *   db.collection(name).add({data})
 *   db.collection(name).doc(id).get() / .update({data})
 *   db.command.gte(v)
 *   db.runTransaction(fn)          // 单线程下等价于直接执行，不做回滚
 *
 * 另外模拟了 games 集合的「openid + mode + dateKey」唯一索引，
 * 用来验证 gameStart 的并发冲突分支（真云环境靠数据库唯一索引，这里靠这行 throw）。
 */

// meta 也要是数组：getMeta 走的是 collection('meta').doc(id).get()
const store = {
  players: [],
  games: [],
  meta: []
};

let CURRENT_OPENID = 'test_openid';

function setOpenid(id) { CURRENT_OPENID = id; }
function getOpenid() { return CURRENT_OPENID; }

function reset() {
  store.players = [];
  store.games = [];
  store.meta = [];
  CURRENT_OPENID = 'test_openid';
}

/** _id 必须写成 'daily_salt' / 'answer_pool' / 'players_meta' 这种字面量 */
function seedMeta(docs) {
  docs.forEach(d => store.meta.push(Object.assign({}, d)));
}

function genId() {
  return 'doc_' + Math.random().toString(36).slice(2, 12);
}

/** 支持 {a:1} 和 {a: db.command.gte(3)} 两种写法 */
function matchCond(doc, cond) {
  // 默认参数挡不住显式传入的 null（query 未调 where 时 _cond 就是 null）
  doc = doc || {};
  cond = cond || {};
  return Object.keys(cond).every(k => {
    const v = cond[k];
    if (v && typeof v === 'object' && v !== null && '__gte' in v) {
      return doc[k] >= v.__gte;
    }
    return doc[k] === v;
  });
}

function sortList(list, sort) {
  if (!sort) return list;
  const { field, dir } = sort;
  return list.slice().sort((a, b) => {
    const r = a[field] > b[field] ? 1 : (a[field] < b[field] ? -1 : 0);
    return dir === 'desc' ? -r : r;
  });
}

function collection(name) {
  const list = () => (store[name] || (store[name] = []));

  const api = {
    _cond: null,
    _sort: null,
    _skip: 0,
    _limit: null,

    where(c) { api._cond = c; return api; },
    orderBy(field, dir) { api._sort = { field, dir: dir || 'asc' }; return api; },
    skip(n) { api._skip = n; return api; },
    limit(n) { api._limit = n; return api; },

    async get() {
      let out = list().filter(d => matchCond(d, api._cond));
      out = sortList(out, api._sort);
      if (api._skip) out = out.slice(api._skip);
      if (api._limit != null) out = out.slice(0, api._limit);
      return { data: out };
    },

    async add({ data }) {
      // 模拟 games 集合在 uniqueKey 上的唯一索引（真云环境靠数据库，这里靠这行 throw）
      // 注意：不能直接用 openid+mode+dateKey，否则 endless 模式一天只能开一局
      if (name === 'games' && data.uniqueKey) {
        const dup = list().some(d => d.uniqueKey === data.uniqueKey);
        if (dup) {
          const err = new Error('duplicate key: openid+mode+dateKey');
          err.code = 'DUPLICATE_KEY';
          throw err;
        }
      }
      const doc = Object.assign({ _id: genId() }, data);
      list().push(doc);
      return { _id: doc._id };
    },

    doc(id) {
      return {
        async get() {
          const hit = list().find(d => d._id === id || d._id === String(id));
          return { data: hit || null };
        },
        async update({ data }) {
          const hit = list().find(d => d._id === id || d._id === String(id));
          if (!hit) throw new Error('doc not found: ' + id);
          Object.assign(hit, data);
          return { stats: { updated: 1 } };
        },
        async remove() {
          const i = list().findIndex(d => d._id === id || d._id === String(id));
          if (i >= 0) list().splice(i, 1);
          return { stats: { removed: i >= 0 ? 1 : 0 } };
        }
      };
    }
  };

  return api;
}

const db = {
  collection,
  command: {
    gte: v => ({ __gte: v }),
    gt: v => ({ __gt: v }),
    lte: v => ({ __lte: v }),
    lt: v => ({ __lt: v }),
    neq: v => ({ __neq: v }),
    in: v => ({ __in: v })
  },
  /** Node 单线程，事务退化为顺序执行；够验证「读-判-写」逻辑正确性 */
  async runTransaction(fn) {
    const tx = { collection };
    return fn(tx);
  }
};

const cloud = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() { /* noop */ },
  database() { return db; },
  getWXContext() { return { OPENID: CURRENT_OPENID, APPID: 'mockappid' }; }
};

module.exports = cloud;
module.exports.__store = store;
module.exports.__setOpenid = setOpenid;
module.exports.__getOpenid = getOpenid;
module.exports.__reset = reset;
module.exports.__seedMeta = seedMeta;
