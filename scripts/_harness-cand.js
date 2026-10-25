/**
 * 一次性排查脚本：用 Node 沙盒驱动 candidate-sheet 组件的真实代码，
 * 复现「点右脚标签 → 0 人 + 没有启用任何条件 + 无 chips」的报障。
 */
const path = require('path');

/* ---------- WeChat 桩 ---------- */
global.wx = {
  showToast: () => {},
  vibrateShort: () => {}
};

let compDef = null;
global.Component = def => { compDef = def; };

require(path.join(__dirname, '..', 'miniprogram', 'components', 'candidate-sheet', 'candidate-sheet.js'));

const clue = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'clue.js'));
const Scompare = require(path.join(__dirname, '..', 'cloudfunctions', '_shared', 'compare.js'));
const fs = require('fs');
const ALL = fs.readFileSync(path.join(__dirname, '..', 'database', 'players.full.jsonl'), 'utf8')
  .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

function makeComp(players) {
  const inst = {
    data: JSON.parse(JSON.stringify(compDef.data)),
    properties: { panel: null, players, guessed: [], dateKey: '2026-10-25' },
    _pending: []
  };
  inst.setData = (patch, cb) => {
    Object.assign(inst.data, patch);
    if (typeof cb === 'function') inst._pending.push(cb);
  };
  inst.flush = () => { while (inst._pending.length) inst._pending.shift()(); };
  // 把 methods 绑上去
  Object.keys(compDef.methods).forEach(k => { inst[k] = compDef.methods[k].bind(inst); });
  return inst;
}

const byName = n => ALL.filter(p => p.name_cn.indexOf(n) !== -1)[0];
const messi = byName('梅西');
const ronaldo = byName('C罗') || ALL.filter(p => p.name_en === 'Cristiano Ronaldo')[0];

// 找一个右脚、188-190cm、fame5 的答案（对应截图判定：C罗 右脚绿、187↑ 黄、#7↓ 黄）
const answers = ALL.filter(p =>
  p.preferred_foot === '右脚' && p.fame_level === 5 &&
  p.height_cm >= 188 && p.height_cm <= 190 && p.shirt_number >= 4 && p.shirt_number <= 10);
const answer = answers[0];
console.log(`答案取 ${answer.name_cn}（${answer.club} ${answer.height_cm}cm #${p2(answer)}）候选 ${answers.length} 个`);
function p2(a) { return a.shirt_number; }

const DK = '2026-10-25';
const rows = [
  { round: 1, guessedId: messi.id, verdict: Scompare.compare(messi, answer, DK), player: messi },
  { round: 2, guessedId: ronaldo.id, verdict: Scompare.compare(ronaldo, answer, DK), player: ronaldo }
];

console.log('\n== C罗这行的判定（应与截图一致：右脚绿） ==');
console.log(JSON.stringify(rows[1].verdict.preferred_foot));

/* ---------- 场景 1：页面 onClue 的完整路径 ---------- */
const all = clue.buildClues(rows);
console.log(`\nbuildClues 共 ${all.length} 条，右脚线索：${JSON.stringify(all.filter(c => c.key === 'preferred_foot').map(c => c.id + ':' + c.state + ':' + c.text))}`);

const ded = clue.dedupeClues(all);
console.log(`dedupeClues 后 ${ded.clues.length} 条`);

const comp = makeComp(ALL.map(p => ({ ...p })));
comp._onPanel({ clues: all, initial: ['2:preferred_foot'] });
comp.flush();

console.log('\n== 面板状态 ==');
console.log(`total=${comp.data.total} activeCount=${comp.data.activeCount} list=${comp.data.list.length} cluesView=${comp.data.cluesView.length}`);
console.log(`constraints=${JSON.stringify(comp.data.constraints)}`);
console.log(`active=${JSON.stringify(comp.data.active)}`);

/* ---------- 场景 2：老路径对拍（不传 initial，逐个 toggle） ---------- */
const comp2 = makeComp(ALL.map(p => ({ ...p })));
comp2._onPanel({ clues: all, initial: [] });
comp2.flush();
const footChip = comp2.data.cluesView.filter(c => c.id.indexOf('preferred_foot') !== -1);
console.log(`\n场景2 chips 里的惯用脚标签：${JSON.stringify(footChip.map(c => c.id + (c.on ? '[亮]' : '[灭]')))}`);
footChip.forEach(c => comp2.onToggle({ currentTarget: { dataset: { id: c.id } } }));
comp2.flush();
console.log(`场景2 total=${comp2.data.total} constraints=${JSON.stringify(comp2.data.constraints)}`);

/* ---------- 场景 3：guessed 带上已猜 2 人 ---------- */
const comp3 = makeComp(ALL.map(p => ({ ...p })));
comp3.properties.guessed = [messi.id, ronaldo.id];
comp3._onPanel({ clues: all, initial: ['2:preferred_foot'] });
comp3.flush();
console.log(`\n场景3 total=${comp3.data.total} list=${comp3.data.list.length}`);

/* ---------- 场景 4：players 为空（怀疑组件没拿到池子） ---------- */
const comp4 = makeComp([]);
comp4._onPanel({ clues: all, initial: ['2:preferred_foot'] });
comp4.flush();
console.log(`\n场景4（空池）total=${comp4.data.total} cluesView=${comp4.data.cluesView.length} activeCount=${comp3.data.activeCount}`);

/* ---------- 场景 5：clues 为空（怀疑传参丢失） ---------- */
const comp5 = makeComp(ALL.map(p => ({ ...p })));
comp5._onPanel({ clues: [], initial: [] });
comp5.flush();
console.log(`场景5（空线索）total=${comp5.data.total} cluesView=${comp5.data.cluesView.length}`);

/* ---------- 场景 6：setData 回调全部被丢弃（同步重算必须仍然正确） ---------- */
function makeCompNoCb(players) {
  const inst = makeComp(players);
  inst.setData = (patch) => { Object.assign(inst.data, patch); };   // 永不调回调
  Object.keys(compDef.methods).forEach(k => { inst[k] = compDef.methods[k].bind(inst); });
  return inst;
}
const comp6 = makeCompNoCb(ALL.map(p => ({ ...p })));
comp6._onPanel({ clues: all, initial: ['2:preferred_foot'] });
console.log(`\n场景6（回调丢弃）total=${comp6.data.total} constraints=${JSON.stringify(comp6.data.constraints)} cluesView=${comp6.data.cluesView.length}`);
const onChip = comp6.data.cluesView.filter(c => c.on);
console.log(`场景6 亮着的 chips：${JSON.stringify(onChip.map(c => c.label + c.text))}`);

/* ---------- 场景 7：空池 → poolEmpty 提示而不是"筛没了" ---------- */
const comp7 = makeCompNoCb([]);
comp7._onPanel({ clues: all, initial: ['2:preferred_foot'] });
console.log(`\n场景7（空池）total=${comp7.data.total} poolEmpty=${comp7.data.poolEmpty} cluesView=${comp7.data.cluesView.length}`);

/* ---------- 场景 8：旧缓存池（缺答案）热替换后自动重筛 ---------- */
const stalePool = ALL.slice(0, 40);   // 假装缓存是只有 40 人的旧包
const comp8 = makeCompNoCb(stalePool.map(p => ({ ...p })));
comp8.properties.panel = { clues: all, initial: ['2:preferred_foot'] };   // 真实绑定里 panel 是页面数据
comp8._onPanel(comp8.properties.panel);
console.log(`\n场景8（旧池40人）total=${comp8.data.total}`);
// 模拟 refreshPool 热替换：page setData players → 组件 observer _onData → 重筛
comp8.properties.players = ALL.map(p => ({ ...p }));
comp8._onData();
console.log(`场景8 热替换后 total=${comp8.data.total}（应为全池右脚人数）`);
