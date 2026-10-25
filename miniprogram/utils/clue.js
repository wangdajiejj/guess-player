/**
 * 线索筛选 —— 把「已经看到的反馈」翻译成候选池的过滤条件。
 *
 * 这是纯客户端的推理辅助：用到的全部是玩家自己看得见的信息
 * （每次猜测的 8 个标签颜色 + 箭头），不碰任何服务端私有数据，
 * 也不改变判定结果 —— 它只是替玩家做那道「哪些人还符合条件」的穷举。
 *
 * 三态语义（与服务端 cloudfunctions/_shared/compare.js 严格对应）：
 *   green  该字段与答案完全一致
 *          -> 正向精确约束
 *   amber  俱乐部=同联赛 / 位置=同大类 / 数值=差在公差内（箭头给方向）
 *          -> 正向放宽约束（比 green 弱，但一定包含答案）
 *   gray   该字段与答案不同（数值还带大小方向）
 *          -> 反向排除
 *
 * ★ 关键不变量：筛选结果一定包含正确答案。
 *   因为每条约束都只是答案的「必要条件」，不会把答案自己排掉。
 *   这条性质由 scripts/test-candidates.js 用真实题库跑几百局守着。
 *
 * ⚠️ TOL / POSITION_GROUP 是服务端 cloudfunctions/_shared/constants.js 的客户端口径，
 *    两处必须一致（同样由 test-candidates.js 对拍）。
 */
const { beijingDateKey, calcAge } = require('./age.js');
const theme = require('./theme.js');

/* ---------------- 判定口径（对齐 _shared/constants.js） ---------------- */

const TOL = { age: 2, height: 3, shirt_number: 3 };

const POSITION_GROUP = {
  '门将': 'GK',
  '中后卫': 'DF', '左后卫': 'DF', '右后卫': 'DF', '清道夫': 'DF',
  '后腰': 'MF', '中前卫': 'MF', '前腰': 'MF', '左边前卫': 'MF', '右边前卫': 'MF',
  '中锋': 'FW', '影锋': 'FW', '左边锋': 'FW', '右边锋': 'FW'
};

const GROUP_CN = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };

const NUMERIC_KEYS = ['age', 'height', 'shirt_number'];
const UNIT = { age: '岁', height: 'cm', shirt_number: '' };

/* ---------------- 取值 ---------------- */

/**
 * 球员在某个线索维度上的实际值。
 * 年龄要按对局自然日实时算（库里只有 birth_date）。
 */
function valueOf(player, key, dateKey) {
  if (!player) return null;
  if (key === 'age') return calcAge(player.birth_date, dateKey);
  if (key === 'height') return player.height_cm;
  if (key === 'shirt_number') return player.shirt_number;
  return player[key];
}

/**
 * 这条线索能不能拿来做筛选。
 * 数值字段缺少箭头（说明猜的那位自己就没有这个数据，服务端判了 gray+null）
 * 时必须跳过 —— 否则会把候选池筛成空集。
 */
function isUsable(key, clue) {
  if (!clue) return false;
  const v = clue.value;
  if (v === null || v === undefined || v === '') return false;
  if (NUMERIC_KEYS.indexOf(key) !== -1 && !clue.arrow) return false;
  return true;
}

/* ---------------- 从对局历史里抽出线索 ---------------- */

/**
 * 每一行猜测的 8 个标签都是一条线索。
 * @param {Array} rows game 页的 rows（{round, verdict, player}）
 * @returns {Array} [{ id, round, key, label, text, state, arrow, value, guess }]
 */
function buildClues(rows) {
  const out = [];
  (rows || []).forEach(row => {
    const verdict = row.verdict || {};
    theme.toChips(verdict).forEach(chip => {
      const v = verdict[chip.key] || {};
      const clue = {
        id: row.round + ':' + chip.key,
        round: row.round,
        key: chip.key,
        label: chip.label,
        text: chip.text,
        state: chip.state,
        arrow: v.arrow || null,
        value: v.value,
        guess: row.player || null
      };
      if (isUsable(chip.key, clue)) out.push(clue);
    });
  });
  return out;
}

/**
 * 跨行去重：多行猜测里「同字段+同值+同判定+同箭头」的线索，对过滤完全等价
 * （compileField 对这些条目逐条编译的结果一样），只留一条，不然候选面板里全是重复标签。
 * 数值字段的箭头参与去重键：39↑ 和 39↓ 文字相同但约束不同，不能并。
 * 去重后按字段归组排序（国籍一组、俱乐部一组…），同字段内保持猜测的先后顺序。
 * @param {Array} clues buildClues 的产物
 * @returns {{ clues: Array, idRemap: Object }} 去重后的线索 + 原始 id -> 代表 id 的映射
 *          （面板的初始条件可能指着被合并掉的重复项，要拿映射换到代表 id）
 */
function dedupeClues(clues) {
  const order = {};
  theme.CLUE_META.forEach((m, i) => { order[m.key] = i; });

  const seen = {};    // sig -> 代表线索 id
  const idRemap = {};
  const out = [];
  (clues || []).forEach(c => {
    const sig = c.key + '|' + c.state + '|' + c.text + '|' + (c.arrow || '');
    if (seen[sig]) {
      idRemap[c.id] = seen[sig];
      return;
    }
    seen[sig] = c.id;
    idRemap[c.id] = c.id;
    out.push(c);
  });

  out.sort((a, b) => (order[a.key] != null ? order[a.key] : 99) - (order[b.key] != null ? order[b.key] : 99));
  return { clues: out, idRemap };
}

/* ---------------- 编译约束 ---------------- */

function firstOfType(entries, state) {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].state === state) return entries[i];
  }
  return null;
}

function uniq(arr) {
  return arr.filter((v, i) => v !== null && v !== undefined && arr.indexOf(v) === i);
}

/**
 * 把同一字段的多条线索合并成一个充分但不过度的约束。
 *
 * 合并规则（强 -> 弱）：
 *   有 green  -> 用精确值（green 一定比同字段的 amber/gray 强）
 *   有 amber  -> 用放宽约束
 *   全 gray   -> 合并所有"不等于/不等式"
 *
 * @returns {Object|null} { key, op, text, test } 或 null（该字段无有效约束）
 */
function compileField(key, entries, dateKey) {
  const eq = firstOfType(entries, 'green');

  /* ---- 文字类字段：国籍 / 联赛 / 惯用脚 —— 只有全等或不等 ---- */
  if (key === 'nationality' || key === 'league' || key === 'preferred_foot') {
    if (eq) {
      const v = eq.value;
      return { key, op: '=', text: String(v), test: p => valueOf(p, key, dateKey) === v };
    }
    const vs = uniq(entries.map(e => e.value));
    if (!vs.length) return null;
    return {
      key, op: '≠', text: vs.join('、'),
      test: p => vs.indexOf(valueOf(p, key, dateKey)) === -1
    };
  }

  /* ---- 俱乐部：amber = 同联赛，且（黄灯本身就说明）不是被猜那个俱乐部 ---- */
  if (key === 'club') {
    if (eq) {
      const v = eq.value;
      return { key, op: '=', text: String(v), test: p => p.club === v };
    }
    const ambs = entries.filter(e => e.state === 'amber');
    if (ambs.length) {
      const leagues = uniq(ambs.map(e => (e.guess || {}).league));
      const notClubs = uniq(ambs.map(e => e.value));
      return {
        key,
        op: leagues.length ? '同联赛' : '≠',
        text: (leagues.length ? leagues : notClubs).join('、'),
        test: p => notClubs.indexOf(p.club) !== -1 ? false
          : (leagues.length ? leagues.indexOf(p.league) !== -1 : true)
      };
    }
    // 全灰：既不是这些俱乐部，也不在它们所在的联赛
    const pairs = entries.map(e => ({ club: e.value, league: (e.guess || {}).league }));
    return {
      key, op: '≠', text: uniq(pairs.map(p => p.club)).join('、'),
      test: p => pairs.every(x => p.club !== x.club && (!x.league || p.league !== x.league))
    };
  }

  /* ---- 位置：amber = 同大类，且（黄灯本身就说明）不是被猜那个细分位置 ---- */
  if (key === 'position') {
    if (eq) {
      const v = eq.value;
      return { key, op: '=', text: String(v), test: p => p.position === v };
    }
    const ambs = entries.filter(e => e.state === 'amber');
    const groups = uniq(ambs.map(e => POSITION_GROUP[(e.guess || {}).position]));
    if (groups.length) {
      const notPos = uniq(ambs.map(e => e.value));
      return {
        key, op: '同大类',
        text: groups.map(g => GROUP_CN[g] || g).join('、'),
        test: p => notPos.indexOf(p.position) === -1
          && groups.indexOf(POSITION_GROUP[p.position]) !== -1
      };
    }
    // 全灰：大类都不同
    const grayGroups = uniq(entries.map(e => POSITION_GROUP[(e.guess || {}).position]));
    if (!grayGroups.length) return null;
    return {
      key, op: '≠', text: uniq(entries.map(e => e.value)).join('、') + '（含同大类）',
      test: p => grayGroups.indexOf(POSITION_GROUP[p.position]) === -1
    };
  }

  /* ---- 数值字段：年龄 / 身高 / 球衣号 —— 统一化成区间求交集 ---- */
  const tol = TOL[key];
  if (eq) {
    const v = eq.value;
    return {
      key, op: '=', text: v + UNIT[key],
      test: p => valueOf(p, key, dateKey) === v
    };
  }

  let lo = null, hi = null;
  entries.forEach(e => {
    const v = e.value;
    if (e.state === 'amber') {
      // 差在公差内：箭头指的那一侧最多差 tol，另一侧最多差 1（相等就是 green 了）
      if (e.arrow === 'up') { lo = Math.max(lo == null ? -Infinity : lo, v - tol); hi = Math.min(hi == null ? Infinity : hi, v - 1); }
      else if (e.arrow === 'down') { lo = Math.max(lo == null ? -Infinity : lo, v + 1); hi = Math.min(hi == null ? Infinity : hi, v + tol); }
    } else if (e.state === 'gray') {
      // 只知道方向，不知道距离
      if (e.arrow === 'up') hi = Math.min(hi == null ? Infinity : hi, v - 1);
      else if (e.arrow === 'down') lo = Math.max(lo == null ? -Infinity : lo, v + 1);
    }
  });

  if (lo === null && hi === null) return null;
  const L = lo === -Infinity ? null : lo;
  const H = hi === Infinity ? null : hi;
  const u = UNIT[key];
  const text = (L != null && H != null) ? `${L}~${H}${u}`
    : (L != null ? `>${L}${u}` : `<${H}${u}`);

  return {
    key, op: '∈', text,
    test: p => {
      const x = valueOf(p, key, dateKey);
      if (x === null || x === undefined) return false;
      if (L != null && x < L) return false;
      if (H != null && x > H) return false;
      return true;
    }
  };
}

/**
 * 编译一组线索为约束列表。
 * @param {Array} clues
 * @param {String} dateKey 对局自然日 'YYYY-MM-DD'
 * @returns {Array} [{ key, label, op, text, test }]
 */
function compileConstraints(clues, dateKey) {
  const dk = dateKey || beijingDateKey();
  const byKey = {};
  (clues || []).forEach(c => {
    if (!c || !c.key) return;
    if (!isUsable(c.key, c)) return;
    (byKey[c.key] = byKey[c.key] || []).push(c);
  });

  const labels = {};
  theme.CLUE_META.forEach(m => { labels[m.key] = m.label; });

  return Object.keys(byKey)
    .map(k => {
      const c = compileField(k, byKey[k], dk);
      if (!c) return null;
      c.label = labels[k] || k;
      return c;
    })
    .filter(Boolean);
}

/**
 * 按线索过滤候选池。
 * @returns {Array} 符合条件的球员（**一定包含答案**）
 */
function filterPlayers(players, clues, dateKey) {
  const tests = compileConstraints(clues, dateKey);
  if (!tests.length) return (players || []).slice();
  return (players || []).filter(p => tests.every(t => t.test(p)));
}

/** 当前生效的约束说明（面板顶部展示用），不含 test 函数 */
function describeConstraints(clues, dateKey) {
  return compileConstraints(clues, dateKey)
    .map(c => ({ key: c.key, label: c.label, op: c.op, text: c.text }));
}

module.exports = {
  TOL, POSITION_GROUP, GROUP_CN, NUMERIC_KEYS,
  valueOf, isUsable, buildClues, dedupeClues,
  compileConstraints, filterPlayers, describeConstraints
};
