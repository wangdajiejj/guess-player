/**
 * 搜索命中测试 —— 用真实 500 条数据验证「用户会怎么搜」。
 *
 * 用法：node scripts/test-search.js
 *
 * 存在意义：客户端 fold 规则（miniprogram/utils/search.js）与服务端
 * validate.py 的 fold 是两份独立实现，一旦漂移，用户就会遇到
 * "名单里明明有这个人、就是搜不出来"。这个脚本用真实输入把它们钉死。
 */
const fs = require('fs');
const path = require('path');

const { fold, search, buildSearchIndex } = require('../miniprogram/utils/search.js');

const DATA = [
  path.join(__dirname, '../database/players.full.jsonl'),
  path.join(__dirname, '../database/players.sample.jsonl')
].find(p => fs.existsSync(p));

const P = fs.readFileSync(DATA, 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`); }
}

/** 搜 kw，返回是否命中指定球员 */
function hit(kw, nameCn) {
  const r = search(P, kw, 200);
  return r.some(p => p.name_cn === nameCn);
}
/** 搜 kw，返回排在第一位的球员名 */
function top(kw) {
  const r = search(P, kw, 200);
  return r.length ? r[0].name_cn : '(无结果)';
}

console.log(`搜索命中测试   题库 ${P.length} 人   数据 ${path.basename(DATA)}\n`);

/* ---------------- 1. 索引一致性：客户端重算必须等于服务端预生成 ---------------- */
console.log('== 客户端 fold 与服务端 search_index 是否一致 ==');
let drift = [];
for (const p of P) {
  const mine = buildSearchIndex(p);
  const theirs = p.search_index;
  // 顺序无关比对（与 validate.py 的 same_index 同规则）
  const a = new Set(mine.split('|').filter(Boolean));
  const b = new Set(theirs.split('|').filter(Boolean));
  const same = a.size === b.size && [...a].every(x => b.has(x));
  if (!same) drift.push(p.name_cn + '\n      本地: ' + mine + '\n      库里: ' + theirs);
}
ok(`${P.length} 条索引全部一致（无规则漂移）`, drift.length === 0, drift.slice(0, 3));

/* ---------------- 2. 真实输入：用户可能怎么搜 ---------------- */
console.log('\n== 真实输入命中 ==');
const CASES = [
  // [输入, 期望命中的球员]
  ['梅西', '利昂内尔·梅西'],
  ['梅球王', '利昂内尔·梅西'],
  ['messi', '利昂内尔·梅西'],
  ['Messi', '利昂内尔·梅西'],
  ['MESSI', '利昂内尔·梅西'],
  ['mx', '利昂内尔·梅西'],
  ['meixi', '利昂内尔·梅西'],
  ['C罗', '克里斯蒂亚诺·罗纳尔多'],
  ['c罗', '克里斯蒂亚诺·罗纳尔多'],
  ['罗纳尔多', '克里斯蒂亚诺·罗纳尔多'],
  ['ronaldo', '克里斯蒂亚诺·罗纳尔多'],
  ['cristiano ronaldo', '克里斯蒂亚诺·罗纳尔多'],
  ['哈兰德', '埃尔林·哈兰德'],
  ['haaland', '埃尔林·哈兰德'],
  ['hld', '埃尔林·哈兰德'],
  ['姆巴佩', '基利安·姆巴佩'],
  ['mbappe', '基利安·姆巴佩'],
  ['Mbappé', '基利安·姆巴佩'],
  ['mbp', '基利安·姆巴佩'],
  ['贝利', '贝利'],
  ['pele', '贝利'],
  ['球王', '贝利'],
  ['马拉多纳', '迭戈·马拉多纳'],
  ['maradona', '迭戈·马拉多纳'],
  ['贝克汉姆', '大卫·贝克汉姆'],
  ['beckham', '大卫·贝克汉姆'],
  ['小贝', '大卫·贝克汉姆'],
  ['内马尔', '内马尔'],
  ['neymar', '内马尔'],
  ['魔人布欧', '埃尔林·哈兰德'],
  ['猎豹', '萨穆埃尔·埃托奥'],
  ['冰王子', '丹尼斯·博格坎普'],
  ['狮王', '奥利弗·卡恩'],
  // 按球队 / 联赛 / 国籍搜（搜索串含这些字段）
  ['阿森纳', '丹尼斯·博格坎普'],
  ['arsenal', '丹尼斯·博格坎普'],
  ['西甲', '萨穆埃尔·埃托奥'],
  ['喀麦隆', '萨穆埃尔·埃托奥'],
  ['巴西', '贝利'],
];
for (const [kw, expect] of CASES) {
  ok(`"${kw}" -> ${expect}`, hit(kw, expect), top(kw));
}

/* ---------------- 3. 精确匹配必须排第一（减少滚动） ---------------- */
console.log('\n== 精确匹配排序 ==');
const RANK = [
  ['梅西', '利昂内尔·梅西'],
  ['messi', '利昂内尔·梅西'],
  ['哈兰德', '埃尔林·哈兰德'],
  ['贝利', '贝利'],
  // 歧义词：C罗 的别名里也有「罗纳尔多」，但大罗的本名就是 Ronaldo，
  // 精确匹配必须把他顶到第一位，否则用户搜"罗纳尔多"看到 C罗 会以为搜错了。
  ['罗纳尔多', '罗纳尔多']
];
for (const [kw, expect] of RANK) {
  ok(`"${kw}" 首位是 ${expect}`, top(kw) === expect, top(kw));
}

console.log('\n== 歧义词多命中（真实世界就是有重名，不能只留一个）==');
ok('"罗纳尔多" 同时能找到大罗和 C罗',
  hit('罗纳尔多', '罗纳尔多') && hit('罗纳尔多', '克里斯蒂亚诺·罗纳尔多'));
ok('"罗德里"/"罗德里戈" 两个人都搜得到',
  hit('罗德里', '罗德里') && hit('罗德里戈', '罗德里戈'));

/* ---------------- 4. 不该命中的别命中 ---------------- */
console.log('\n== 反例 ==');
ok('空关键字返回全部（不全空）', search(P, '', 200).length === 200);
ok('乱码不命中', search(P, 'zzzzqqqq', 200).length === 0);
ok('空白字符被折叠后不误伤', search(P, ' 梅西 ', 200).length > 0);
ok('中间点号被折叠（罗伯托·卡洛斯 -> 罗伯托卡洛斯）',
  hit('罗伯托卡洛斯', '罗伯托·卡洛斯'), top('罗伯托卡洛斯'));

/* ---------------- 5. 性能 ---------------- */
console.log('\n== 性能 ==');
const t0 = Date.now();
for (let i = 0; i < 100; i++) search(P, 'a', 30);
const per = (Date.now() - t0) / 100;
ok(`单次搜索 ${per.toFixed(2)}ms < 5ms`, per < 5, per);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
