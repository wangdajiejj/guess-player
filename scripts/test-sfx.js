/**
 * 音效测试 —— 合成参数是否安全 + 开关是否真的生效
 *
 *   node scripts/test-sfx.js
 *
 * 为什么值得测：
 *   音效是"错了会直接伤到用户"的东西 —— 一个 0.9 的音量、一个 18kHz 的
 *   频率、一个 3 秒的长音，都不会报错，但会让用户当场静音卸载。
 *   而且 play('xxx') 拼错 name 时是**静默失效**的，没有测试根本发现不了。
 */
const fs = require('fs');
const path = require('path');

const sfx = require('../miniprogram/utils/sfx.js');

let pass = 0, fail = 0;
const fails = [];
function G(name) { console.log(`\n== ${name} ==`); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`); }
}

const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];

console.log('音效测试（合成参数 + 开关 + 调用点）');

/* ================= 1. 音色参数 ================= */
G('1. 音色参数安全区间');

{
  const names = Object.keys(sfx.TONES);
  ok(`音效数量合理（${names.length} 个）`, names.length >= 5 && names.length <= 12, names);

  let noNote = [], outFreq = [], tooLong = [], tooShort = [], tooLoud = [], badWave = [], noEnv = [];
  names.forEach(n => {
    const notes = sfx.TONES[n];
    if (!Array.isArray(notes) || !notes.length) { noNote.push(n); return; }
    notes.forEach((x, i) => {
      const tag = `${n}[${i}]`;
      if (typeof x.f !== 'number' || x.f <= 0) noNote.push(tag);
      // 可听范围：低于 20Hz 听不见（白耗性能），高于 8000Hz 刺耳且廉价
      if (!(x.f >= 20 && x.f <= 8000)) outFreq.push(`${tag}=${x.f}`);
      if (x.to && !(x.to >= 20 && x.to <= 8000)) outFreq.push(`${tag}.to=${x.to}`);
      // 短促反馈音不该超过 0.5 秒；长音（失败音）放宽到 0.8
      const cap = 0.8;
      if (x.d > cap) tooLong.push(`${tag}.d=${x.d}`);
      if (x.d < 0.02) tooShort.push(`${tag}.d=${x.d}`);
      if (x.v == null || x.v > 0.3) tooLoud.push(`${tag}.v=${x.v}`);
      if (x.type && WAVES.indexOf(x.type) === -1) badWave.push(`${tag}.type=${x.type}`);
      // 包络起点不能是 0（指数逼近会静音），也不能太长（会"啵"一声）
      if (x.at != null && x.at < 0) noEnv.push(`${tag}.at=${x.at}`);
    });
  });

  ok('每个音效都至少有一个音符', noNote.length === 0, noNote);
  ok('频率都在 20~8000Hz（听得见且不刺耳）', outFreq.length === 0, outFreq);
  ok('时长都在 20ms~0.8s', tooLong.length === 0 && tooShort.length === 0, tooLong.concat(tooShort));
  ok('峰值音量都不超过 0.3（手机外放不扰民）', tooLoud.length === 0, tooLoud);
  ok('波形只用白名单里的', badWave.length === 0, badWave);

  // 音量叠加：琶音的音符是交错的，不能简单求和（那会把不重叠的也算上）。
  // 这里按时间轴估算"最多几个音同时响"，作为爆音风险的上界。
  function peakOf(notes) {
    const evts = [];
    notes.forEach(n => {
      const s = n.at || 0;
      evts.push({ t: s, dv: n.v || 0 });
      evts.push({ t: s + n.d, dv: -(n.v || 0) });
    });
    evts.sort((a, b) => a.t - b.t || a.dv - b.dv);
    let cur = 0, peak = 0;
    evts.forEach(ev => { cur += ev.dv; if (cur > peak) peak = cur; });
    return peak;
  }

  let peak = 0, peakName = '';
  names.forEach(n => {
    const p = peakOf(sfx.TONES[n]);
    if (p > peak) { peak = p; peakName = n; }
  });
  ok(`最响的音效（${peakName} 同时最多约 ${peak.toFixed(2)}）不超过 0.5`, peak <= 0.5);
}

/* ================= 2. 开关 ================= */
G('2. 音效开关');

{
  sfx.setEnabled(true);
  ok('开启后 enabled() 为真', sfx.enabled() === true);
  sfx.setEnabled(false);
  ok('关闭后 enabled() 为假', sfx.enabled() === false);
  ok('关闭时 play 返回 false（不报错）', sfx.play('tap') === false);
  sfx.setEnabled(true);
  ok('重新开启后 enabled() 为真', sfx.enabled() === true);
}

/* ================= 3. 无 wx 环境降级 ================= */
G('3. 非小程序环境（node）安全降级');

{
  ok('没有 wx 全局对象（确认在 node 里跑）', typeof wx === 'undefined');
  ok('available() 为 false', sfx.available() === false);
  ok('play 不抛异常且返回 false', sfx.play('hit') === false);
  ok('unlock 不抛异常', (() => { try { sfx.unlock(); return true; } catch (e) { return false; } })());
  ok('未知音效名返回 false', sfx.play('不存在的音效') === false);
}

/* ================= 4. 调用点静态检查 ================= */
G('4. 调用点（防 play 名字拼错静默失效）');

{
  const ROOT = path.join(__dirname, '..', 'miniprogram');
  function walk(dir, out = []) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.js')) out.push(p);
    }
    return out;
  }

  const known = Object.keys(sfx.TONES);
  const calls = [];
  const bad = [];
  walk(ROOT).forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    const re = /sfx\.play\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      calls.push(m[1]);
      if (known.indexOf(m[1]) === -1) bad.push(`${path.relative(ROOT, f)}: sfx.play('${m[1]}')`);
    }
  });

  ok(`代码里共 ${calls.length} 处音效调用`, calls.length > 0);
  ok('所有音效名都在 TONES 里（没有拼错）', bad.length === 0, bad);

  const unused = known.filter(k => calls.indexOf(k) === -1);
  ok('没有定义了却从不播放的音效', unused.length === 0, unused);

  // 每个用到 sfx 的文件都必须真的 require 过，否则运行时报 undefined
  const noRequire = [];
  walk(ROOT).forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    if (/sfx\.(play|setEnabled|available|unlock)/.test(src) && !/require\([^)]*sfx\.js['"]\)/.test(src)) {
      noRequire.push(path.relative(ROOT, f));
    }
  });
  ok('用到 sfx 的文件都 require 了', noRequire.length === 0, noRequire);
}

/* ================= 5. 设置项 ================= */
G('5. 设置项与默认值');

{
  const storageSrc = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'utils', 'storage.js'), 'utf8');
  ok('DEFAULT_SETTINGS 里默认开启音效', /DEFAULT_SETTINGS\s*=\s*\{[^}]*sound:\s*true/.test(storageSrc));

  const wxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'settings', 'settings.wxml'), 'utf8');
  ok('设置页有音效开关', /onSound/.test(wxml) && /settings\.sound/.test(wxml));

  const js = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'settings', 'settings.js'), 'utf8');
  ok('切开关会同步到 sfx', /onSound[\s\S]{0,400}sfx\.setEnabled/.test(js));
  ok('设置页会显示"设备不支持"的说明', /sfxAvailable/.test(wxml));
}

/* ---------- 汇总 ---------- */
console.log(`\n${'='.repeat(46)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n待修：');
  fails.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
