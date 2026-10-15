/**
 * 客户端年龄计算。
 *
 * 为什么客户端也要算年龄：
 *   「点线索标签 → 筛出还符合条件的球员」要在本地按年龄过滤候选池，
 *   而年龄不存库（只存 birth_date），必须按对局自然日实时算周岁。
 *
 * ⚠️ 必须与两份服务端实现保持一致，改了一处要同步另一处：
 *   - cloudfunctions/_shared/util.js    :: beijingDateKey
 *   - cloudfunctions/_shared/compare.js :: calcAge
 *   scripts/test-candidates.js 会把两边逐一对拍，不一致直接失败。
 */

/**
 * 北京时间自然日 'YYYY-MM-DD'。
 * 不能依赖运行环境时区 —— 跨零点的那一两个小时会拿到错误的日期，
 * 导致"今天过生日"的球员年龄算错一岁。
 */
function beijingDateKey(now) {
  const d = new Date((now == null ? Date.now() : now) + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 按出生日期算周岁，当年生日还没到就减一岁 */
function calcAge(birthDate, refDateKey) {
  if (!birthDate || !refDateKey) return null;
  const [by, bm, bd] = String(birthDate).split('-').map(Number);
  const [ry, rm, rd] = String(refDateKey).split('-').map(Number);
  if (!by || !ry) return null;
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age;
}

module.exports = { beijingDateKey, calcAge };
