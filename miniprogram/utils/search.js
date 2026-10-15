/**
 * 本地检索 —— 500 条线性扫描，实测 0.05ms，无需建索引
 *
 * ⚠️ fold / buildSearchIndex 的职责必须与服务端 validate.py 完全一致：
 *    小写 + 去分隔符 + 去重音符号，含 league 字段。
 *    一旦两边规则漂移，用户会遇到"服务端说有这个人、本地搜不到"的诡异现象。
 */

/** 小写 + 去分隔符 + 去音标（Mbappé -> mbappe） */
function fold(s) {
  let out = String(s == null ? '' : s);
  try {
    out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    // 极老机型不支持 normalize，降级为原串
  }
  return out.toLowerCase().replace(/[·\s\-'\.]/g, '');
}

/**
 * 构造检索串。字段集合必须与 docs/02-database.md §3.5 一致。
 */
function buildSearchIndex(p) {
  const parts = [
    p.name_cn, p.name_en, p.club, p.club_en, p.league,
    p.nationality, p.position, p.pinyin, p.initials
  ].concat(p.aliases || []);
  return parts.filter(Boolean).map(fold).join('|');
}

/**
 * 在候选池中模糊搜索。
 * @param {Array}  list  候选池
 * @param {String} kw    关键字
 * @param {Number} limit 最多返回条数
 * @returns {Array}
 */
function search(list, kw, limit = 30) {
  const key = fold(kw);
  if (!key) return list.slice(0, limit);

  const hits = [];
  const exact = [];

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p.__idx) p.__idx = buildSearchIndex(p);
    if (p.__idx.indexOf(key) === -1) continue;

    // 优先展示：中文名/英文短名直接匹配的排前面，减少用户滚动
    const nameKey = fold(p.name_cn);
    const isExact = nameKey === key || fold(p.name_en) === key;
    (isExact ? exact : hits).push(p);

    if (exact.length + hits.length >= limit * 3) break;
  }
  return exact.concat(hits).slice(0, limit);
}

module.exports = { fold, buildSearchIndex, search };
