const fs = require('fs');
const html = fs.readFileSync('C:/Users/wang/Desktop/新建文件夹/guess-player/index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('inline scripts: ' + scripts.length);
scripts.forEach((s, i) => {
  try {
    new Function(s);   // 只解析不执行
    console.log(`  script[${i}] 语法 OK (${(s.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.log(`  script[${i}] 语法错误: ${e.message}`);
    const line = e.stack.match(/<anonymous>:(\d+)/);
    if (line) {
      const n = Number(line[1]);
      console.log('    附近: ' + s.split('\n').slice(n - 3, n + 1).join('\n    '));
    }
    process.exitCode = 1;
  }
});
// 关键内容抽查
const checks = [
  ['题库数据', /利昂内尔·梅西/.test(html) && /罗伯特·莱万多夫斯基/.test(html)],
  ['引擎入口', html.includes('window.GP')],
  ['视图容器', ['view-home', 'view-game', 'view-reveal', 'view-result', 'view-help'].every(id => html.includes('id="' + id + '"'))],
  ['深色样式', html.includes('prefers-color-scheme: dark')],
  ['无未闭合 script', (html.match(/<script>/g) || []).length === (html.match(/<\/script>/g) || []).length]
];
let bad = 0;
checks.forEach(c => { console.log((c[1] ? '  ✓ ' : '  ✗ ') + c[0]); if (!c[1]) bad = 1; });
process.exitCode = process.exitCode || bad;
