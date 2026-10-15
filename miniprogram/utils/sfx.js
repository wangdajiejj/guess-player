/**
 * 音效 —— 用 WebAudio 现场合成，不携带任何音频文件。
 *
 * 为什么不用 mp3：
 *   1. 素材版权（个人主体最容易踩的坑之一）；
 *   2. 包体：一个 30KB 的 mp3 要塞进主包，200 个球员数据才 123KB；
 *   3. 合成音更"轻"，适合点击反馈这种短促音。
 *
 * 实现要点：
 *   - wx.createWebAudioContext()（基础库 2.19.0+），不支持时全部静默降级，不报错；
 *   - 每个音符都是「振荡器 + 指数包络」，避免出现方波那种刺耳的爆音；
 *   - 音量压得很低（0.08~0.16），手机外放不会扰民；
 *   - 开关来自 storage 的 settings.sound（设置页可关）。
 *
 * ⚠️ 合成参数集中在 TONES 里，想调节手感改这里就行，
 *    不需要动任何调用点。scripts/test-candidates.js 会静态校验这些常量。
 */
const S = require('./storage.js');

const VERSION = 1;

let ctx = null;
let broken = false;     // 创建失败就不再重试，避免每次点击都抛一遍
let on = null;          // null = 尚未从 storage 读过开关

/* ---------------- 开关 ---------------- */

function enabled() {
  if (on === null) on = S.loadSettings().sound !== false;
  return on;
}

function setEnabled(v) {
  on = !!v;
}

/** 当前环境能不能出声（设置页用它决定是否显示开关的说明） */
function available() {
  if (broken) return false;
  return typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function';
}

/* ---------------- 音频上下文 ---------------- */

function getCtx() {
  if (ctx || broken) return ctx;
  if (!available()) { broken = true; return null; }
  try {
    ctx = wx.createWebAudioContext();
  } catch (e) {
    broken = true;
    ctx = null;
  }
  return ctx;
}

/**
 * 有些机型（特别是 iOS）挂起后需要显式恢复，
 * 否则后面所有音都会"静悄悄地播不出来"。
 */
function unlock() {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state && c.state !== 'running' && typeof c.resume === 'function') c.resume();
  } catch (e) { /* ignore */ }
}

/* ---------------- 音色表 ---------------- */
/**
 * f  起始频率(Hz)      to 扫频终点(调频时用)
 * d  时长(秒)          v  峰值音量 0~1
 * at 延迟(秒)          type 波形 sine 最柔和 / triangle 稍亮
 */
const TONES = {
  // 通用点击
  tap: [{ f: 660, d: 0.05, v: 0.09, type: 'triangle' }],
  // 面板弹出 / 收起
  open: [{ f: 520, to: 780, d: 0.10, v: 0.08, type: 'sine' }],
  close: [{ f: 620, to: 380, d: 0.10, v: 0.07, type: 'sine' }],
  // 猜中：C5-E5-G5-C6 上行琶音
  hit: [
    { f: 523.25, d: 0.16, v: 0.15, type: 'sine' },
    { f: 659.25, d: 0.16, v: 0.15, type: 'sine', at: 0.075 },
    { f: 783.99, d: 0.16, v: 0.15, type: 'sine', at: 0.150 },
    { f: 1046.50, d: 0.24, v: 0.16, type: 'sine', at: 0.225 }
  ],
  // 猜错但还有机会：轻轻下坠，不打击人
  miss: [{ f: 420, to: 300, d: 0.18, v: 0.09, type: 'triangle' }],
  // 机会用完：低沉收场
  lose: [
    { f: 330, to: 250, d: 0.28, v: 0.11, type: 'triangle' },
    { f: 220, to: 150, d: 0.45, v: 0.10, type: 'triangle', at: 0.22 }
  ]
};

/* ---------------- 播放 ---------------- */

function voice(c, n) {
  try {
    const t0 = c.currentTime + (n.at || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = n.type || 'sine';
    osc.frequency.setValueAtTime(n.f, t0);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.d);

    // 包络：0 不能直接指数逼近（会静音），所以从头尾各留 0.0001 的极小值
    const v = n.v || 0.1;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + n.d + 0.03);
  } catch (e) {
    // 单个音符失败不影响整段音效，更不能影响游戏
  }
}

/**
 * 播放一个音效。
 * @param {String} name tap|open|close|pick|hit|miss|lose
 * @returns {Boolean} 是否真的播了（静音/不支持时返回 false）
 */
function play(name) {
  if (!enabled()) return false;
  const notes = TONES[name];
  if (!notes) return false;
  const c = getCtx();
  if (!c) return false;
  unlock();
  notes.forEach(n => voice(c, n));
  return true;
}

module.exports = {
  VERSION, TONES,
  play, unlock, enabled, setEnabled, available
};
