/**
 * gen-mock-core 的 Node 版 —— 与 _mock-backup/scripts/gen-mock-core.py 逐行为等价。
 *
 * 为什么会有两个实现：WorkBuddy 托管的 Python 基础环境在会话中途被清空
 * （venv 指向的 versions/3.13.12/python.exe 消失），scripts/gen-mock-core.py 跑不了时用这份顶上。
 * 两个脚本产物必须一致：同样的源文件、同样的三处 require 改写、同样的横幅。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', 'Desktop', '新建文件夹', 'guess-player');
// 直接按仓库内相对关系算更稳：本文件被放到 <repo>/scripts/ 下运行
const REPO = fs.existsSync(path.join(__dirname, 'sync-shared.js'))
  ? __dirname.replace(/scripts[\\/]?$/, '')
  : ROOT;

const SHARED = path.join(REPO, 'cloudfunctions', '_shared');
const OUT_DIR = path.join(REPO, 'miniprogram', 'utils');

const FILES = ['compare.js', 'constants.js', 'util.js'];
const REWRITES = [
  ["require('./constants')", "require('./mock-constants')"],
  ["require('./compare')", "require('./mock-compare')"],
  ["require('crypto')", "require('./mock-hash')"]
];

const BANNER = `/**
 * ⚠️⚠️⚠️ 本地 Mock 专用 —— 严禁在正式包里启用 ⚠️⚠️⚠️
 *
 * 本文件由 scripts/gen-mock-core.py 从 cloudfunctions/_shared/ 复制而来，
 * 目的是让「不想配云环境、只想先看一眼界面」的人能立刻跑通全局。
 *
 * 它违反了一条架构红线：比对逻辑不允许出现在客户端
 * （有了它，别人就能离线遍历候选池把答案试出来）。
 * 所以：
 *   1. 只有 app.js 里 USE_MOCK = true 时才会被加载；
 *   2. 提审 / 上线前必须把 USE_MOCK 改回 false，并删掉本文件；
 *   3. scripts/check-mp.js 会在 Mock 开启时给出醒目告警。
 *
 * 不要手改这里 —— 改请改 _shared/ 的真源，然后重跑生成脚本。
 */

`;

let stray = 0;
for (const name of FILES) {
  let src = fs.readFileSync(path.join(SHARED, name), 'utf8');
  for (const [old, now] of REWRITES) src = src.split(old).join(now);

  fs.writeFileSync(path.join(OUT_DIR, 'mock-' + name), BANNER + src, 'utf8');

  const left = src.split('\n').map(l => l.trim())
    .filter(l => l.includes("require('") && !l.includes("require('./"));
  console.log(`已生成 mock-${name} (${src.split('\n').length} 行)`);
  left.forEach(l => { console.log('    ⚠️ 可疑 require：' + l); stray++; });
}
console.log('\n同步完毕（Node 版）。若 _shared/ 有改动，重跑本脚本。');
if (stray) process.exit(1);
