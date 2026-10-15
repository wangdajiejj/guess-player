/**
 * 把 _shared 里的公共代码物理复制进每个云函数目录。
 *
 * 为什么必须这么做：微信云开发上传时只打包「单个云函数文件夹」，
 * 跨目录的 require('../_shared/x') 在生产环境会 MODULE_NOT_FOUND。
 * 所以每次上传前都要跑一次本脚本。
 *
 * 用法：node scripts/sync-shared.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'cloudfunctions', '_shared');
const CF_DIR = path.join(ROOT, 'cloudfunctions');

// 需要同步的共享文件
const FILES = ['constants.js', 'compare.js', 'util.js'];

function main() {
  if (!fs.existsSync(SHARED)) {
    console.error('找不到 _shared 目录：', SHARED);
    process.exit(1);
  }

  // 排除下划线开头的目录（_shared 自身）和 node_modules
  const targets = fs.readdirSync(CF_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'node_modules')
    .map(d => d.name);

  if (!targets.length) {
    console.error('cloudfunctions 下没有找到任何云函数目录');
    process.exit(1);
  }

  let copied = 0;
  let skipped = 0;

  targets.forEach(fn => {
    const dir = path.join(CF_DIR, fn);
    FILES.forEach(f => {
      const src = path.join(SHARED, f);
      const dst = path.join(dir, f);
      if (!fs.existsSync(src)) {
        console.warn(`  ! 共享文件缺失：${f}`);
        return;
      }
      const a = fs.readFileSync(src, 'utf8');
      const b = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
      if (a === b) {
        skipped++;
        return;
      }
      fs.writeFileSync(dst, a, 'utf8');
      copied++;
      console.log(`  + ${fn}/${f}`);
    });
  });

  console.log(`\n同步完成：${targets.length} 个云函数，写入 ${copied} 个文件，${skipped} 个已是最新`);

  // 额外检查：确保没有云函数还在用跨目录 require
  let bad = 0;
  targets.forEach(fn => {
    FILES.forEach(f => {
      const dst = path.join(CF_DIR, fn, f);
      if (!fs.existsSync(dst)) return;
      const code = fs.readFileSync(dst, 'utf8');
      if (code.includes("_shared")) {
        console.error(`  x ${fn}/${f} 里出现了 _shared 引用，说明同步有问题`);
        bad++;
      }
    });
  });
  if (bad) process.exit(1);
}

main();
