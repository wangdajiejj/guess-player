/**
 * 小程序静态检查 —— 抓「开发者工具才会报」的低级错误，省一轮编译等待。
 *
 * 用法：node scripts/check-mp.js
 *
 * 检查项：
 *   1. 所有 .json 能解析（JSON 里写注释、末尾多逗号是最常见的翻车点）
 *   2. usingComponents 指向的路径真实存在
 *   3. wxml 里用到的自定义标签都已注册（漏注册 = 页面空白且不报错）
 *   4. 页面在 app.json 的 pages 里登记过
 *   5. 组件的 wxml / wxss 四件套齐全
 *   6. wxml 里 bind/catch 的事件在对应 js 里都有方法（漏写 = 点了没反应且不报错）
 *   7. Mock 开关状态（开着不失败，但每次都提醒你上线前改回去）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');
let pass = 0, fail = 0;
const errors = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else {
    fail++;
    errors.push(name + (extra ? ' -> ' + JSON.stringify(extra) : ''));
    console.log(`  ✗ ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`);
  }
}

function walk(dir, ext, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

console.log('小程序静态检查\n');

/* ---------- 1. JSON 可解析 ---------- */
console.log('== JSON 合法性 ==');
const jsons = walk(ROOT, '.json');
let badJson = [];
const parsed = {};
for (const f of jsons) {
  try {
    parsed[f] = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    badJson.push(path.relative(ROOT, f) + ': ' + e.message);
  }
}
ok(`${jsons.length} 个 json 全部可解析`, badJson.length === 0, badJson);

/* ---------- 2. usingComponents 路径存在 ---------- */
console.log('\n== 组件路径 ==');
let missing = [];
for (const [f, cfg] of Object.entries(parsed)) {
  const uc = cfg.usingComponents || {};
  for (const [tag, rel] of Object.entries(uc)) {
    // 绝对路径 /components/x/x 从 miniprogram 起算
    const base = rel.startsWith('/')
      ? path.join(ROOT, rel)
      : path.resolve(path.dirname(f), rel);
    if (!fs.existsSync(base + '.js') && !fs.existsSync(base + '.wxml')) {
      missing.push(`${path.relative(ROOT, f)}: <${tag}> -> ${rel}`);
    }
  }
}
ok('所有 usingComponents 路径都存在', missing.length === 0, missing);

/* ---------- 3. wxml 自定义标签已注册 ---------- */
console.log('\n== 标签注册 ==');
const wxmls = walk(ROOT, '.wxml');
const BUILTIN = new Set([
  'view', 'text', 'image', 'button', 'scroll-view', 'swiper', 'swiper-item',
  'input', 'textarea', 'picker', 'switch', 'slider', 'icon', 'progress',
  'block', 'template', 'import', 'include', 'navigator', 'canvas',
  'rich-text', 'form', 'label', 'checkbox', 'radio', 'movable-view',
  'movable-area', 'cover-view', 'cover-image', 'web-view', 'open-data',
  'official-account', 'editor', 'ad', 'page-meta', 'navigation-bar'
]);
let unregistered = [];
for (const w of wxmls) {
  const jsonPath = w.replace(/\.wxml$/, '.json');
  const cfg = parsed[jsonPath] || {};
  const local = Object.keys(cfg.usingComponents || {});
  const global = Object.keys(parsed[path.join(ROOT, 'app.json')].usingComponents || {});
  const known = new Set([...local, ...global, ...BUILTIN]);

  const src = fs.readFileSync(w, 'utf8');
  // 自定义组件标签要么带连字符，要么是已注册名
  const tags = new Set();
  const re = /<\/?([a-zA-Z][\w-]*)/g;
  let m;
  while ((m = re.exec(src))) {
    const t = m[1];
    if (t.includes('-') || local.includes(t) || global.includes(t)) tags.add(t);
  }
  for (const t of tags) {
    if (!known.has(t)) {
      unregistered.push(`${path.relative(ROOT, w)}: <${t}> 未注册`);
    }
  }
}
ok('所有自定义标签都已注册', unregistered.length === 0, unregistered);

/* ---------- 4. 页面登记 ---------- */
console.log('\n== 页面登记 ==');
const appJson = parsed[path.join(ROOT, 'app.json')];
const declared = new Set((appJson.pages || []).map(p => path.join(ROOT, p)));
const actualPages = wxmls.filter(w => w.includes(`${path.sep}pages${path.sep}`))
  .map(w => w.replace(/\.wxml$/, ''));
let undeclared = actualPages.filter(p => !declared.has(p)).map(p => path.relative(ROOT, p));
ok('所有页面都在 app.json pages 里', undeclared.length === 0, undeclared);

for (const p of declared) {
  ok(`  ${path.relative(ROOT, p)}.wxml 存在`, fs.existsSync(p + '.wxml'));
}

/* ---------- 5. 组件四件套齐全 ---------- */
console.log('\n== 组件文件完整性 ==');
let incomplete = [];
for (const [f, cfg] of Object.entries(parsed)) {
  if (!cfg.component) continue;
  const dir = path.dirname(f);
  const base = path.basename(f, '.json');
  for (const ext of ['.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(dir, base + ext))) {
      incomplete.push(`${path.relative(ROOT, dir)} 缺 ${base}${ext}`);
    }
  }
}
ok('每个组件的 wxml / wxss 都在', incomplete.length === 0, incomplete);

/* ---------- 6. wxml 的事件绑定都有对应方法 ---------- */
console.log('\n== 事件绑定 ==');
{
  let miss = [];
  let total = 0;
  for (const w of wxmls) {
    const js = w.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(js)) continue;
    const jsSrc = fs.readFileSync(js, 'utf8');
    const wSrc = fs.readFileSync(w, 'utf8');

    const handlers = new Set();
    const re = /\b(?:bind|catch):?([a-zA-Z]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(wSrc))) {
      const h = (m[2] || '').trim();
      if (!h || h.indexOf('{') !== -1) continue;   // 跳过 {{}} 动态绑定
      handlers.add(h);
    }
    for (const h of handlers) {
      total++;
      // js 里得能看到 h( 或 h: 或 h = 的定义，否则点了没反应且不报错
      if (!new RegExp('(^|[\\s,{])' + h + '\\s*[(:]').test(jsSrc)) {
        miss.push(`${path.relative(ROOT, w)}: ${h}() 在 js 里找不到`);
      }
    }
  }
  ok(`${total} 个事件绑定都有对应方法`, miss.length === 0, miss);
}

/* ---------- 7. Mock 开关 ---------- */
console.log('\n== 本地 Mock 开关 ==');
{
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const m = appJs.match(/const\s+USE_MOCK\s*=\s*(true|false)/);
  ok('app.js 里能找到 USE_MOCK', !!m);

  const on = m && m[1] === 'true';
  const mockFiles = walk(path.join(ROOT, 'utils'), '.js')
    .map(f => path.basename(f))
    .filter(n => n.startsWith('mock-'));

  if (on) {
    ok('Mock 已开启，配套文件齐全（>=5 个）', mockFiles.length >= 5, mockFiles);
    // 不算失败：开发期开着 Mock 是正常状态，但每次跑测试都要把这句话看一遍。
    console.log(
      '\n  ┌──────────────────────────────────────────────┐\n' +
      '  │ ⚠️  USE_MOCK = true，当前没有连任何云服务     │\n' +
      '  │    本地自测没问题，但提审/上线前必须改回 false │\n' +
      '  │    并删掉 miniprogram/utils/mock-*.js          │\n' +
      '  └──────────────────────────────────────────────┘\n'
    );
  } else {
    ok('Mock 已关闭（正式包状态）', true);
    // 直接算失败：留着这些文件就会被打进主包，等于把比对逻辑和答案池发出去
    ok('miniprogram/utils 下没有残留的 mock-*.js', mockFiles.length === 0, mockFiles);
    // 保险：源码里不该再出现对 mock-* 的 require
    const refs = [];
    walk(ROOT, '.js').forEach(f => {
      const t = fs.readFileSync(f, 'utf8');
      if (/require\(['"][^'"]*mock-(api|players|compare|constants|util|hash)/.test(t)) {
        refs.push(path.relative(ROOT, f));
      }
    });
    ok('没有页面/组件还在 require mock-*', refs.length === 0, refs);
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n待修：');
  errors.forEach(e => console.log('  - ' + e));
}
process.exit(fail ? 1 : 0);
