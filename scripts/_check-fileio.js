/**
 * 一次性验证：把 index.html 里内联的【真实产物代码】在 Node 里跑一遍。
 * DOM 用最小桩实现；localStorage 按 file:// 协议最坏情况直接抛异常
 * （部分浏览器在 file:// 下禁 storage）——app 必须仍能完成启动并渲染首页。
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 2) { console.log('script 数量不对: ' + scripts.length); process.exit(1); }

/* ---------------- 最小 DOM 桩 ---------------- */

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this._text = '';
    this.parentNode = null;
    this.classList = {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { (on === undefined ? !this._set.has(c) : on) ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    };
    this.style = {};
  }
  get className() { return [...this.classList._set].join(' '); }
  set className(v) { this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() {
    return this._text + this.children.map(c => c.textContent).join('');
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(n) { if (n && n.__text != null) { this.children.push(n); } else if (n) { n.parentNode = this; this.children.push(n); } return n; }
  removeChild(n) { const i = this.children.indexOf(n); if (i !== -1) this.children.splice(i, 1); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this, key: '' })); }
}

const registry = {};
function reg(id) { const e = new FakeEl('div'); e.id = id; registry[id] = e; return e; }

global.document = {
  readyState: 'complete',
  createElement: t => new FakeEl(t),
  createTextNode: t => { const n = new FakeEl('#text'); n.__text = String(t); n.textContent = String(t); return n; },
  getElementById: id => registry[id] || null,
  addEventListener: () => {}
};
global.window = global;
global.scrollTo = () => {};
// file:// 最坏情况：访问 localStorage 直接抛
Object.defineProperty(global, 'localStorage', { get() { throw new Error('blocked (file://)'); } });
// 无 AudioContext 环境
global.AudioContext = undefined;

['app', 'view-home', 'home-body', 'view-game', 'view-reveal', 'view-result', 'view-help', 'mask', 'toast'].forEach(reg);

/* ---------------- 执行产物脚本 ---------------- */

try {
  new Function(scripts[0])();   // 引擎 + 题库 + wx 垫片（localStorage 抛异常也要活）
  new Function(scripts[1])();   // app：init() 同步跑，renderHome 填 home-body
} catch (e) {
  console.log('✗ 启动抛异常: ' + e.stack.split('\n').slice(0, 3).join('\n'));
  process.exit(1);
}

/* ---------------- 断言 ---------------- */

const texts = [];
(function walk(n) { n.children.forEach(c => { if (c.__text != null) texts.push(c.__text); else { texts.push(c._text); walk(c); } }); })(registry['home-body']);
const all = texts.join('|');

const checks = [
  ['引擎已加载（GP）', typeof global.GP === 'object' && !!global.GP.mock],
  ['候选池 548 人', global.GP.mock.getPlayers('').data.players.length === 548],
  ['每日一题卡片', all.includes('每日一题')],
  ['自由练习', all.includes('按难度开局')],
  ['反向猜球', all.includes('先看线索，再猜是谁')],
  ['12 个专题', (all.match(/专场|球员|传奇|左脚|新星/g) || []).length >= 12],
  ['题库页脚', all.includes('题库 548 人')],
  ['localStorage 被禁也未崩', registry['home-body'].children.length > 3]
];

let bad = 0;
checks.forEach(c => { if (!c[1]) bad++; console.log((c[1] ? '  ✓ ' : '  ✗ ') + c[0]); });

// 顺手再验证一把开局引擎在无 storage 环境下能出题
const g = global.GP.mock.gameStart('endless', 'star');
console.log((g.ok && g.data.status === 'playing' && g.data.maxGuesses === 8)
  ? '  ✓ 无 storage 环境开局成功（明星局 ' + g.data.gameId + '）'
  : '  ✗ 开局失败: ' + JSON.stringify(g).slice(0, 120));
if (!(g.ok && g.ok)) bad++;

process.exitCode = bad ? 1 : 0;
console.log(bad ? '\n结论：file:// 场景有问题' : '\n结论：file:// 双击即玩场景验证通过');
