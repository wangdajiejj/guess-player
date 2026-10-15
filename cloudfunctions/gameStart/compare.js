/**
 * 匹配算法核心 —— 服务端唯一权威实现。
 * 客户端绝不实现比对逻辑（否则可被遍历候选池暴力反推答案），
 * 详见 docs/03-algorithm.md §6。
 */
const C = require('./constants');

/**
 * 按出生日期计算周岁。
 * @param {string} birthDate 'YYYY-MM-DD'
 * @param {string} refDateKey 'YYYY-MM-DD' 对局所在自然日（北京时间）
 */
function calcAge(birthDate, refDateKey) {
  const [by, bm, bd] = String(birthDate).split('-').map(Number);
  const [ry, rm, rd] = String(refDateKey).split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1; // 生日还没到
  return age;
}

/** 精确相等字段：国籍 / 联赛 / 惯用脚 */
function eqState(a, b) {
  return a === b ? C.STATE.GREEN : C.STATE.GRAY;
}

/** 俱乐部：完全相同绿；同联赛黄；否则灰 */
function clubState(g, a) {
  if (g.club === a.club) return C.STATE.GREEN;
  if (g.league && g.league === a.league) return C.STATE.AMBER;
  return C.STATE.GRAY;
}

/** 位置：细分相同绿；仅大类相同黄；否则灰 */
function positionState(g, a) {
  if (g.position === a.position) return C.STATE.GREEN;
  if (g.position_group === a.position_group) return C.STATE.AMBER;
  return C.STATE.GRAY;
}

/**
 * 数值字段：年龄 / 身高 / 球衣号
 * 相等 -> green + equal
 * 差值 <= tol -> amber + up/down
 * 差值 >  tol -> gray  + up/down
 * 缺失值(0/null) -> gray + null（UI 显示 —）
 */
function numericState(gv, av, tol) {
  if (!gv || !av) return { state: C.STATE.GRAY, arrow: null };
  if (gv === av) return { state: C.STATE.GREEN, arrow: C.ARROW.EQUAL };
  return {
    state: Math.abs(gv - av) <= tol ? C.STATE.AMBER : C.STATE.GRAY,
    arrow: gv > av ? C.ARROW.UP : C.ARROW.DOWN
  };
}

/**
 * 比对一次猜测与答案。
 * @returns {Object} 8 个字段的判定结果，键名与 C.CLUE_ORDER 一致
 */
function compare(guess, answer, refDateKey) {
  const gAge = calcAge(guess.birth_date, refDateKey);
  const aAge = calcAge(answer.birth_date, refDateKey);

  return {
    nationality: {
      value: guess.nationality,
      state: eqState(guess.nationality, answer.nationality)
    },
    club: {
      value: guess.club,
      state: clubState(guess, answer)
    },
    league: {
      value: guess.league,
      state: eqState(guess.league, answer.league)
    },
    position: {
      value: guess.position,
      state: positionState(guess, answer)
    },
    age: {
      value: gAge, unit: '岁',
      ...numericState(gAge, aAge, C.AGE_TOL)
    },
    height: {
      value: guess.height_cm, unit: 'cm',
      ...numericState(guess.height_cm, answer.height_cm, C.HEIGHT_TOL)
    },
    shirt_number: {
      value: guess.shirt_number, prefix: '#',
      ...numericState(guess.shirt_number, answer.shirt_number, C.SHIRT_TOL)
    },
    preferred_foot: {
      value: guess.preferred_foot,
      state: eqState(guess.preferred_foot, answer.preferred_foot)
    }
  };
}

/** 是否命中答案 */
function isHit(guess, answer) {
  return guess.id === answer.id;
}

/** 按 CLUE_ORDER 输出稳定的数组，便于前端 wx:for 渲染 */
function verdictToList(verdict) {
  return C.CLUE_ORDER.map(key => ({ key, ...verdict[key] }));
}

module.exports = {
  calcAge, eqState, clubState, positionState, numericState,
  compare, isHit, verdictToList
};
