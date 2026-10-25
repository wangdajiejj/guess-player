/** 一次性：两个面板组件的硬编码颜色 → CSS 变量（深色模式用，跑完可删） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const SUBS = {
  'components/search-sheet/search-sheet.wxss': [
    ['background: #fff;', 'background: var(--gp-card);'],
    ['background: #dcdfdc;', 'background: var(--gp-holder);'],
    ['color: #9aa09c;', 'color: var(--gp-text-mute);'],
    ['background: #f2f4f2;', 'background: var(--gp-field);'],
    ['color: #b3b8b5;', 'color: var(--gp-text-mute);'],
    ['background: #f6f8f6;', 'background: var(--gp-field-hi);'],
    ['color: #1f2421;', 'color: var(--gp-text);'],
    ['color: #8a7a26;', 'color: var(--gp-amber-dark);'],
    ['background: #faf3dc;', 'background: var(--gp-amber-bg);']
  ],
  'components/candidate-sheet/candidate-sheet.wxss': [
    ['background: #fff;', 'background: var(--gp-card);'],
    ['background: #dcdfdc;', 'background: var(--gp-holder);'],
    ['color: #9aa09c;', 'color: var(--gp-text-mute);'],
    ['color: #1f2421;', 'color: var(--gp-text);'],
    ['background: #f6f8f6;', 'background: var(--gp-field-hi);'],
    ['color: #b3b8b5;', 'color: var(--gp-text-mute);'],
    ['color: #6b716d;', 'color: var(--gp-chip-text);'],
    ['color: #4a4d4f;', 'color: var(--gp-gray-dark);'],
    ['color: #8a7a26;', 'color: var(--gp-amber-dark);'],
    ['background: #faf3dc;', 'background: var(--gp-amber-bg);'],
    ['background: #eef0ee;', 'background: var(--gp-gray-bg);'],
    ['color: #d5d9d6;', 'color: var(--gp-divider);'],
    ['background: #f4f6f4;', 'background: var(--gp-chip-bg);']
  ]
};

for (const rel in SUBS) {
  const p = path.join(ROOT, 'miniprogram', rel);
  let s = fs.readFileSync(p, 'utf8');
  let n = 0;
  for (const [a, b] of SUBS[rel]) {
    while (s.includes(a)) { s = s.replace(a, b); n++; }
  }
  fs.writeFileSync(p, s, 'utf8');
  console.log(rel, '->', n, '处');
}
console.log('DONE.');
