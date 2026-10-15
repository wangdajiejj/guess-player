#!/usr/bin/env node
/**
 * 本地测试模式 开 / 关
 *
 *   用法：node scripts/toggle-mock.js on | off | status
 *         （平时不用手敲，双击 scripts 下的两个 .bat 就行）
 *
 * 它在干什么：
 *   on  —— 把 _mock-backup/blocks/ 里那几段代码**现场拼进**当前的正式文件，
 *          再把 _mock-backup/utils/mock-*.js 拷进小程序包。
 *          于是不需要 AppID、不需要备案、不需要云开发环境，打开就能玩。
 *   off —— 把带 MOCK-BEGIN / MOCK-END 标记的段落原样拆掉，删掉 mock-*.js。
 *          拆完的代码和正式版一致（多余的空白行会收掉）。
 *
 * 为什么用「现场拼装」而不是「存两份整文件」：
 *   存两份的话，今天改了 settings.js、忘了同步那份副本，明天就会拿旧代码覆盖新代码 ——
 *   而且不报错。拼装则相反：正式代码一改，锚点找不到，它当场停下来喊你。
 *   宁可停，也不要悄悄跑起一份过期的界面。
 *
 * ⚠️ 本地测试模式把**比对逻辑和 500 人答案池**放进了客户端。
 *    它只用来本地看效果，提审 / 上线前必须 off。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BK = path.join(ROOT, '_mock-backup');
const BLOCKS = path.join(BK, 'blocks');
const SRC_UTILS = path.join(BK, 'utils');
const SRC_SCRIPTS = path.join(BK, 'scripts');

const APP = 'miniprogram/app.js';
const API = 'miniprogram/utils/api.js';
const SET_JS = 'miniprogram/pages/settings/settings.js';
const SET_WXML = 'miniprogram/pages/settings/settings.wxml';

/** 小程序包里要增删的 mock 文件（只认这几个确切的文件名，不做通配删除） */
const MOCK_UTILS = [
  'mock-api.js', 'mock-players.js', 'mock-compare.js',
  'mock-constants.js', 'mock-util.js', 'mock-hash.js'
];
const MOCK_SCRIPTS = ['test-mock.js', 'gen-mock-core.py', 'gen-mock-data.py'];

/** 插到 app.js 最顶上的横幅，用来提醒「这不是正式版」 */
const BANNER =
  '/**\n' +
  ' * ⚠️⚠️⚠️  当前是「本地测试模式」  ⚠️⚠️⚠️\n' +
  ' *\n' +
  ' * 由 scripts/toggle-mock.js 自动改写，手改这里没用（下次切换会被覆盖）。\n' +
  ' * 这个模式下小程序完全不连云：5 个「云函数」都在客户端跑，数据存在本机 storage。\n' +
  ' * 所以不需要 AppID、不需要备案、不需要云开发环境，打开就能玩。\n' +
  ' *\n' +
  ' * 提审前请双击 scripts/关闭本地测试-提审前必点.bat。\n' +
  ' */\n\n';

const USE_MOCK_RE = /const\s+USE_MOCK\s*=\s*(true|false)\s*;/;
const BANNER_RE = /^\/\*\*[\s\S]*?当前是「本地测试模式」[\s\S]*?\*\/\n+/;
/** 一段被标记包起来的代码，连同它所在行的缩进和换行一起匹配 */
const MARK_RE = /[ \t]*(?:\/\*|<!--)[^\n]*?MOCK-BEGIN[\s\S]*?MOCK-END[^\n]*?(?:\*\/|-->)[ \t]*\n?/g;

/**
 * 每条规则 = 「在哪插 / 插什么」。
 * block 里的内容放在 _mock-backup/blocks/ 下，都是带标记的片段，off 时按标记原样拆。
 */
const RULES = [
  { file: APP, op: 'insertAfter', anchor: '  onLaunch() {\n', block: 'app.onlaunch.txt',
    why: '启动时短路掉云初始化' },
  { file: APP, op: 'insertAfter', anchor: '    } catch (e) { /* ignore */ }\n  }', block: 'app.tail.txt',
    why: '加一个 notifyMock() 提示条' },
  { file: API, op: 'insertBefore', anchor: 'function call(name, data = {}) {', block: 'api.block.txt',
    why: '加 useMock / callMock' },
  { file: API, op: 'insertAfter', anchor: 'function call(name, data = {}) {\n', block: 'api.callline.txt',
    why: 'call() 里分流到 Mock' },
  { file: API, op: 'insertBefore', anchor: '  /** 把网络错误翻译成人话，给页面直接用 */', block: 'api.export.txt',
    why: '导出 isMock' },
  { file: SET_JS, op: 'insertAfter', anchor: "const S = require('../../utils/storage.js');\n", block: 'settings.require.txt',
    why: '设置页引入 api' },
  { file: SET_JS, op: 'insertAfter', anchor: '    sfxAvailable: true\n', block: 'settings.data.txt',
    why: '设置页加 mockMode / mockGames' },
  { file: SET_JS, op: 'insertAfter', anchor: '      sfxAvailable: sfx.available()\n', block: 'settings.setdata.txt',
    why: '设置页 onShow 读 Mock 状态' },
  { file: SET_JS, op: 'insertAfter', anchor: "  goHelp() {\n    wx.navigateTo({ url: '/pages/help/help' });\n  }", block: 'settings.methods.txt',
    why: '设置页加「换一道每日一题」' },
  { file: SET_WXML, op: 'insertBefore', anchor: '  <!-- 关于 -->', block: 'settings.wxml.section.txt',
    why: '设置页加「本地测试」分组' }
];

/* ---------------- 基础工具 ---------------- */

const abs = rel => path.join(ROOT, rel);
const read = rel => fs.readFileSync(abs(rel), 'utf8');
const write = rel => (s) => fs.writeFileSync(abs(rel), s, 'utf8');

function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function die(msg) {
  console.error('\n✗ 中止：' + msg + '\n');
  process.exit(1);
}

function detectMode() {
  const src = read(APP);
  const m = src.match(USE_MOCK_RE);
  if (!m) return 'unknown';
  return m[1] === 'true' ? 'mock' : 'prod';
}

/* ---------------- on ---------------- */

function turnOn() {
  const mode = detectMode();
  if (mode === 'mock') {
    console.log('ℹ️  已经是本地测试模式了，直接重装一遍文件（不会重复插代码块）。');
  } else if (mode === 'unknown') {
    die('在 ' + APP + ' 里找不到 `const USE_MOCK = ...;` —— 文件被改过了？');
  }

  // 1) 拼装代码块（先拆掉可能残留的，保证幂等：连点两次不会插两份）
  const files = [...new Set(RULES.map(r => r.file))];
  const cache = {};
  files.forEach(f => { cache[f] = strip(read(f)); });

  for (const r of RULES) {
    const bf = path.join(BLOCKS, r.block);
    if (!fs.existsSync(bf)) die('缺少代码块文件 _mock-backup/blocks/' + r.block);
    const chunk = fs.readFileSync(bf, 'utf8');

    if (r.op === 'replace') {
      const n = count(cache[r.file], r.anchor);
      if (n !== 1) die(`${r.file} 里锚点出现 ${n} 次（应为 1 次）：${JSON.stringify(r.anchor).slice(0, 60)}`);
      cache[r.file] = cache[r.file].replace(r.anchor, chunk);
      continue;
    }
    const n = count(cache[r.file], r.anchor);
    if (n !== 1) {
      die(`${r.file} 里找不到唯一锚点（出现 ${n} 次）：${JSON.stringify(r.anchor).slice(0, 60)}\n` +
          `      → 说明正式代码被改过，这个代码块已经对不上了（想加的是：${r.why}）。\n` +
          `      → 改完 _mock-backup/blocks/${r.block} 里的锚点再试。`);
    }
    cache[r.file] = r.op === 'insertAfter'
      ? cache[r.file].replace(r.anchor, r.anchor + chunk)
      : cache[r.file].replace(r.anchor, chunk + r.anchor);
  }

  // 2) USE_MOCK 置真 + 顶部横幅（已经是 true 就别再插横幅，靠 strip 保证幂等）
  const appSrc = cache[APP];
  const isOn = count(appSrc, 'const USE_MOCK = true;');
  const isOff = count(appSrc, 'const USE_MOCK = false;');
  if (isOff === 1) {
    cache[APP] = appSrc.replace('const USE_MOCK = false;', 'const USE_MOCK = true;');
  } else if (isOn !== 1) {
    die(APP + ' 里找不到唯一 `const USE_MOCK = ...;`（true ' + isOn + ' 次 / false ' + isOff + ' 次）');
  }
  cache[APP] = BANNER + cache[APP];

  // 3) 语法自检 —— 拼坏了就别落盘
  for (const f of [APP, API, SET_JS]) {
    try { new Function(cache[f]); }   // 只编译不执行
    catch (e) { die('拼装后 ' + f + ' 语法不合法：' + e.message); }
  }

  files.forEach(f => write(f)(cache[f]));

  // 4) 拷 mock 运行文件
  let copied = 0;
  for (const n2 of MOCK_UTILS) {
    const s = path.join(SRC_UTILS, n2);
    if (!fs.existsSync(s)) die('缺少 _mock-backup/utils/' + n2);
    fs.copyFileSync(s, path.join(ROOT, 'miniprogram', 'utils', n2));
    copied++;
  }
  for (const n2 of MOCK_SCRIPTS) {
    const s = path.join(SRC_SCRIPTS, n2);
    if (!fs.existsSync(s)) die('缺少 _mock-backup/scripts/' + n2);
    fs.copyFileSync(s, path.join(ROOT, 'scripts', n2));
  }

  verify('mock');
  console.log(`\n✅ 已切到「本地测试模式」（拼进 ${RULES.length} 段代码块，拷入 ${copied} 个运行文件）`);
  console.log('   现在打开微信开发者工具重新编译，就能直接玩了 —— 不连云、不用 AppID、不用备案。');
  console.log('   ⚠️  提审 / 上线前必须双击：scripts/关闭本地测试-提审前必点.bat\n');
}

/* ---------------- off ---------------- */

function strip(src) {
  let s = src.replace(BANNER_RE, '');
  s = s.replace(MARK_RE, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  // 文件结尾 `});` 前的多余空行收掉（`});` 必须顶格，避免误伤 wx.showModal({...});）
  s = s.replace(/\n{2,}(\}\);)/g, '\n$1');
  return s;
}

function turnOff() {
  const mode = detectMode();
  if (mode === 'prod') {
    console.log('ℹ️  当前已经是正式版；下面顺手清一遍可能残留的 mock 文件。');
  } else if (mode === 'unknown') {
    die('在 ' + APP + ' 里找不到 `const USE_MOCK = ...;` —— 文件被改过了？');
  }

  const files = [...new Set(RULES.map(r => r.file))];
  const out = {};
  for (const f of files) {
    let s = strip(read(f));
    if (f === APP) {
      // 已经是正式版时允许重复点（不改，只做清理），所以这里要两种都认
      const on = count(s, 'const USE_MOCK = true;');
      const off = count(s, 'const USE_MOCK = false;');
      if (on === 1) s = s.replace('const USE_MOCK = true;', 'const USE_MOCK = false;');
      else if (off !== 1) die(APP + ' 里找不到 `const USE_MOCK = ...;`（true ' + on + ' 次 / false ' + off + ' 次）');
    }
    out[f] = s;
  }

  for (const f of [APP, API, SET_JS]) {
    try { new Function(out[f]); } catch (e) { die('拆完 ' + f + ' 语法不合法：' + e.message); }
  }

  files.forEach(f => write(f)(out[f]));

  // 删 mock 运行文件（只删名单里的确切文件名，绝不通配）
  let removed = [];
  MOCK_UTILS.forEach(n => {
    const p = path.join(ROOT, 'miniprogram', 'utils', n);
    if (fs.existsSync(p)) { fs.unlinkSync(p); removed.push('miniprogram/utils/' + n); }
  });
  MOCK_SCRIPTS.forEach(n => {
    const p = path.join(ROOT, 'scripts', n);
    if (fs.existsSync(p)) { fs.unlinkSync(p); removed.push('scripts/' + n); }
  });

  verify('prod');
  console.log(`\n✅ 已切回「正式版」（拆掉全部 MOCK 段，删除 ${removed.length} 个 mock 文件）`);
  if (removed.length) removed.forEach(r => console.log('   - ' + r));
  console.log('   别忘了 miniprogram/app.js 里的 ENV_ID 要填你自己云环境的 ID。\n');
}

/* ---------------- 校验 ---------------- */

function verify(expect) {
  const problems = [];
  const appSrc = read(APP);

  const m = appSrc.match(USE_MOCK_RE);
  if (!m) problems.push(APP + ' 里找不到 USE_MOCK');
  else if (m[1] !== (expect === 'mock' ? 'true' : 'false')) {
    problems.push(`USE_MOCK 期望 ${expect === 'mock' ? 'true' : 'false'}，实际 ${m[1]}`);
  }

  const leftovers = [];
  for (const f of [APP, API, SET_JS, SET_WXML]) {
    if (/MOCK-(BEGIN|END)/.test(read(f))) leftovers.push(f);
  }
  const wantMarks = expect === 'mock';
  if (wantMarks && leftovers.length !== 4) {
    problems.push('本地测试模式下这 4 个文件都该有 MOCK 标记，实际只有：' + (leftovers.join(', ') || '无'));
  }
  if (!wantMarks && leftovers.length) {
    problems.push('正式版里还留着 MOCK 标记：' + leftovers.join(', '));
  }

  const utilsDir = path.join(ROOT, 'miniprogram', 'utils');
  const present = MOCK_UTILS.filter(n => fs.existsSync(path.join(utilsDir, n)));
  if (wantMarks && present.length !== MOCK_UTILS.length) {
    problems.push(`mock 运行文件不全：${present.length}/${MOCK_UTILS.length}`);
  }
  if (!wantMarks && present.length) {
    problems.push('正式版里还有 mock 文件：' + present.join(', '));
  }

  if (!wantMarks) {
    const refs = [];
    const scan = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) { scan(p); continue; }
        if (!p.endsWith('.js')) continue;
        if (/require\(['"][^'"]*mock-(api|players|compare|constants|util|hash)/.test(fs.readFileSync(p, 'utf8'))) {
          refs.push(path.relative(ROOT, p));
        }
      }
    };
    scan(path.join(ROOT, 'miniprogram'));
    if (refs.length) problems.push('还有代码在 require mock-*：' + refs.join(', '));
  }

  if (problems.length) {
    console.log('\n⚠️  自检发现问题：');
    problems.forEach(p => console.log('   - ' + p));
    die('切换结果不符合预期，请检查');
  }
  console.log('   ✓ 自检通过：' + (wantMarks ? '本地测试模式已就位' : '正式版已就位'));
}

/* ---------------- CLI ---------------- */

const cmd = (process.argv[2] || '').toLowerCase();

if (cmd === 'on') {
  console.log('切换 → 本地测试模式');
  turnOn();
} else if (cmd === 'off') {
  console.log('切换 → 正式版');
  turnOff();
} else if (cmd === 'status') {
  const mode = detectMode();
  const utilsDir = path.join(ROOT, 'miniprogram', 'utils');
  const n = MOCK_UTILS.filter(x => fs.existsSync(path.join(utilsDir, x))).length;
  console.log('当前模式：' + (mode === 'mock' ? '本地测试模式（不连云）' : mode === 'prod' ? '正式版（连云）' : '未知'));
  console.log('mock 文件：' + n + ' / ' + MOCK_UTILS.length);
} else {
  console.log('用法：node scripts/toggle-mock.js on|off|status');
  process.exit(1);
}
