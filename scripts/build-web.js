#!/usr/bin/env node
/**
 * 网页版打包 —— node scripts/build-web.js
 *
 * 产出仓库根目录的 index.html：单文件、零依赖、双击即玩。
 *   · 引擎与题库直接内联 miniprogram/utils/ 的 mock-* / theme / clue / age / search
 *     （与小程序共用同一份真源，玩法口径不会漂移）；
 *   · CommonJS 源码用极简 registry 垫片在浏览器里跑，不改一行源文件；
 *   · wx.getStorageSync / wx.setStorageSync 垫到 localStorage（file:// 被禁时再降级内存）。
 *
 * 产物会提交进仓库：GitHub Pages 直接托管它，下载 ZIP 的人双击就能玩。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const U = p => path.join(ROOT, 'miniprogram', 'utils', p);

/* 内联顺序无关（require 按需解析），这里只列清单 */
const MODULES = [
  'mock-hash.js',
  'mock-constants.js',
  'mock-players.js',
  'mock-compare.js',
  'mock-util.js',
  'mock-api.js',
  'age.js',
  'theme.js',
  'clue.js',
  'search.js'
];

/** require 规范化：'./mock-util.js' -> 'mock-util' */
function norm(spec) {
  return String(spec).replace(/^\.\//, '').replace(/\.js$/, '');
}

function bundleModules() {
  const parts = [];
  parts.push('(function(){');
  parts.push(`
/* ---- CommonJS 垫片 ---- */
var __defs = {};
var __cache = {};
function __def(name, factory) { __defs[name] = factory; }
function __req(spec) {
  var name = spec.replace(/^\\.\\//, '').replace(/\\.js$/, '');
  if (__cache[name]) return __cache[name].exports;
  var f = __defs[name];
  if (!f) throw new Error('web bundle 缺少模块: ' + name);
  var mod = { exports: {} };
  __cache[name] = mod;
  f(function (s) { return __req(s); }, mod, mod.exports);
  return mod.exports;
}

/* ---- wx.* 垫片（localStorage 不可用时降级内存，游戏仍可玩） ---- */
var __mem = {};
window.wx = {
  getStorageSync: function (k) {
    try { var v = localStorage.getItem('wxs:' + k); return v == null ? '' : JSON.parse(v); }
    catch (e) { return (k in __mem) ? __mem[k] : ''; }
  },
  setStorageSync: function (k, v) {
    try { localStorage.setItem('wxs:' + k, JSON.stringify(v)); }
    catch (e) { __mem[k] = v; }
  }
};
`);

  for (const m of MODULES) {
    let src = fs.readFileSync(U(m), 'utf8');
    if (/<!--/.test(src)) throw new Error(m + ' 含有 "<!--"，会破坏 HTML 解析，需先处理');
    src = src.replace(/<\/script/gi, '<\\/script');   // 防止内联时提前闭合 script 标签
    parts.push(`__def(${JSON.stringify(norm(m))}, function (require, module, exports) {\n${src}\n});`);
  }

  parts.push(`
/* ---- 暴露给 app.js 的模块表 ---- */
window.GP = {
  mock: __req('mock-api'),
  clue: __req('clue'),
  theme: __req('theme'),
  search: __req('search'),
  C: __req('mock-constants'),
  calcAge: __req('mock-compare').calcAge
};
})();`);
  return parts.join('\n');
}

function esc(s) {
  return s.replace(/<\/script/gi, '<\\/script');
}

function build() {
  const css = fs.readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
  const app = esc(fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8'));
  const bundle = bundleModules();

  const html = `<!DOCTYPE html>
<!-- 猜球员 · 足球版 Wordle · 网页版（由 scripts/build-web.js 生成，勿手改本文件） -->
<!-- 源码与题库: https://github.com/wangdajiejj/guess-player -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="足球版 Wordle：8 次机会猜出神秘球员，548 人题库，双击即玩">
<title>猜球员 · 足球版 Wordle</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>">
<style>
${css}
</style>
</head>
<body>
<div id="app">
  <div class="view on" id="view-home">
    <div class="hero">
      <div class="hero-title">猜球员</div>
      <div class="hero-sub sub">足球版 Wordle · 8 次机会 · 548 人题库</div>
    </div>
    <div id="home-body"></div>
  </div>
  <div class="view" id="view-game"></div>
  <div class="view" id="view-reveal"></div>
  <div class="view" id="view-result"></div>
  <div class="view" id="view-help"></div>
</div>
<div class="mask" id="mask"></div>
<div class="toast" id="toast"></div>
<script>
${bundle}
</script>
<script>
${app}
</script>
</body>
</html>
`;

  const out = path.join(ROOT, 'index.html');
  fs.writeFileSync(out, html, 'utf8');
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`web/index.html 生成完毕：${kb} KB（${MODULES.length} 个模块内联）`);
}

build();
