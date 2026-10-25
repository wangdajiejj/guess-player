/* ============================================================
 * 猜球员 · 网页版 —— 单文件应用主体
 *
 * 与小程序共用同一套引擎（打包时从 miniprogram/utils/ 内联）：
 *   mock-api（对局）/ mock-compare（判定）/ clue（筛选）/ theme（线索映射）/ search（检索）
 * 所以玩法口径、题目分布、筛选不变量与小程序完全一致。
 *
 * 本文件只做 DOM 胶水：视图切换、渲染、事件。
 * ============================================================ */
(function () {
  'use strict';

  var M = window.GP;                       // 打包器注入的模块表
  var mock = M.mock, clue = M.clue, theme = M.theme, search = M.search, C = M.C;
  var DIFF_NAME = { star: '明星局', normal: '标准局', all: '全员局', '': '' };
  var RENDER_CAP = 100;

  /* ---------------- 本地存取（file:// 下 localStorage 可能被禁，降级内存） ---------------- */

  var memStore = {};
  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return memStore[k] || null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { memStore[k] = v; }
  }

  var SETTINGS = { sound: true, musicTrack: 't1', musicVol: 0.5 };
  try { Object.assign(SETTINGS, JSON.parse(lsGet('gpweb_settings') || '{}')); } catch (e) {}

  function loadStats() {
    var d = { played: 0, won: 0, streak: 0, bestStreak: 0, scoreSum: 0, bestSteps: 0, lastGameId: '' };
    try { Object.assign(d, JSON.parse(lsGet('gpweb_stats') || '{}')); } catch (e) {}
    return d;
  }
  function saveStats(s) { lsSet('gpweb_stats', JSON.stringify(s)); }

  /* ---------------- 音效（WebAudio 现场合成，与小程序同一套参数思路） ---------------- */

  /* ---------------- 音频：SFX 重制 + 生成式背景音乐（零素材） ----------------
   *
   * 全部 WebAudio 现场合成。总线结构：
   *   sfxBus / musicBus → 主输出；另有一条共享反馈延迟做空间感。
   * 浏览器自动播放策略：首次用户手势时才创建/恢复 AudioContext。
   */

  var AC = null, musicBus = null, sfxBus = null, delayIn = null, noiseBuf = null;
  var audioErrors = [];
  window.__audioDebug = function () { return { hasCtx: !!AC, state: AC ? AC.state : 'none', errors: audioErrors, music: Music.info() }; };

  function ctx() {
    if (AC) return AC;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      musicBus = AC.createGain();
      musicBus.gain.value = 0.5 * 2 * (SETTINGS.musicVol != null ? SETTINGS.musicVol : 0.5);
      musicBus.connect(AC.destination);
      sfxBus = AC.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(AC.destination);
      var dly = AC.createDelay(1.0);
      dly.delayTime.value = 0.27;
      var fb = AC.createGain(); fb.gain.value = 0.32;
      var wet = AC.createGain(); wet.gain.value = 0.5;
      dly.connect(fb); fb.connect(dly);
      dly.connect(wet); wet.connect(AC.destination);
      delayIn = dly;
      var len = AC.sampleRate * 0.4;
      noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    } catch (e) {
      audioErrors.push('ctx: ' + e.message);
      AC = null;
    }
    return AC;
  }

  var mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };

  /** 基础音色：振荡器 + 指数包络，可挂滤波与延迟发送 */
  function voice(o) {
    var ac = ctx();
    if (!ac) return;
    try {
      var t = ac.currentTime + (o.at || 0);
      var osc = ac.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur));
      var g = ac.createGain();
      var vol = o.vol || 0.1;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (o.atk || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      var out = g;
      if (o.lp) {
        var f = ac.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = o.lp;
        g.connect(f); out = f;
      }
      osc.connect(g);
      out.connect(o.bus || sfxBus);
      if (o.echo) {
        var send = ac.createGain(); send.gain.value = o.echo;
        out.connect(send); send.connect(delayIn);
      }
      osc.start(t);
      osc.stop(t + o.dur + 0.05);
    } catch (e) { audioErrors.push('voice: ' + e.message); }
  }

  /** 噪声瞬态：hat / clap / whoosh 共用 */
  function noiseHit(o) {
    var ac = ctx();
    if (!ac) return;
    try {
      var t = ac.currentTime + (o.at || 0);
      var src = ac.createBufferSource();
      src.buffer = noiseBuf;
      var f = ac.createBiquadFilter();
      f.type = o.ftype || 'highpass';
      f.frequency.setValueAtTime(o.f || 6000, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
      if (o.q) f.Q.value = o.q;
      var g = ac.createGain();
      g.gain.setValueAtTime(o.vol || 0.1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(f); f.connect(g);
      g.connect(o.bus || sfxBus);
      if (o.echo) {
        var send = ac.createGain(); send.gain.value = o.echo;
        g.connect(send); send.connect(delayIn);
      }
      src.start(t);
      src.stop(t + o.dur + 0.05);
    } catch (e) { audioErrors.push('noise: ' + e.message); }
  }

  var SFX = {
    tap: function () {
      voice({ f: 1720, dur: 0.045, vol: 0.045, atk: 0.004 });
      noiseHit({ f: 5200, dur: 0.03, vol: 0.05 });
    },
    open: function () {
      noiseHit({ f: 420, f2: 2400, dur: 0.2, vol: 0.05, ftype: 'bandpass', q: 1.2 });
      voice({ f: 660, dur: 0.12, vol: 0.055, at: 0.06, echo: 0.25 });
      voice({ f: 990, dur: 0.14, vol: 0.04, at: 0.13, echo: 0.25 });
    },
    close: function () {
      noiseHit({ f: 2200, f2: 320, dur: 0.16, vol: 0.04, ftype: 'bandpass', q: 1.0 });
      voice({ f: 520, dur: 0.09, vol: 0.04 });
    },
    miss: function () {
      voice({ f: 347, f2: 330, dur: 0.13, vol: 0.085, type: 'triangle' });
      voice({ f: 262, dur: 0.17, vol: 0.075, type: 'triangle', at: 0.1, echo: 0.15 });
    },
    hit: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        voice({ f: f, dur: 0.22, vol: 0.09, at: i * 0.09, echo: 0.35 });
      });
      voice({ f: 2093, dur: 0.5, vol: 0.03, at: 0.36, echo: 0.5 });
    },
    lose: function () {
      [392, 330, 262].forEach(function (f, i) {
        voice({ f: f, dur: 0.3, vol: 0.08, type: 'triangle', at: i * 0.17, echo: 0.2 });
      });
    },
    reveal: function () {
      voice({ f: 987, dur: 0.7, vol: 0.07, atk: 0.006, echo: 0.45 });
      voice({ f: 1480, dur: 0.6, vol: 0.025, at: 0.02, echo: 0.45 });
      voice({ f: 1975, dur: 0.45, vol: 0.014, at: 0.04, echo: 0.45 });
    }
  };
  function sfx(name) { if (!SETTINGS.sound) return; if (SFX[name]) SFX[name](); }

  /* ---------------- 生成式背景音乐 ----------------
   * 每首曲子是一份「编曲配置」（速度/和声进行/音阶/鼓型/音色），
   * 音序器每小节实时演奏；旋律在调内随机行走，偏向和弦内音——
   * 每遍听感略有不同，但始终和谐。零采样、零体积。
   */
  var TRACKS = [
    {
      id: 't1', name: '午后球场', bpm: 78, swing: 0.18, style: 'chill',
      chords: [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]],
      scale: [60, 62, 64, 67, 69, 72, 74, 76],
      density: 0.42, pad: 'triangle', lead: 'triangle', bass: 'sine',
      drums: { kick: [0, 8], hat: [2, 6, 10, 14], clap: [] }, masterLp: 2600
    },
    {
      id: 't2', name: '冠军之路', bpm: 112, swing: 0, style: 'upbeat',
      chords: [[50, 57, 62, 66], [54, 61, 66, 69], [52, 59, 64, 68], [47, 54, 59, 62]],
      scale: [62, 64, 66, 69, 71, 74, 76, 78],
      density: 0.68, pad: 'triangle', lead: 'square', bass: 'triangle',
      drums: { kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], clap: [4, 12] }, masterLp: 3800
    },
    {
      id: 't3', name: '深夜复盘', bpm: 58, swing: 0, style: 'ambient',
      chords: [[40, 47, 52, 55], [43, 50, 55, 59], [45, 52, 57, 60], [38, 45, 50, 54]],
      scale: [52, 55, 57, 59, 62, 64, 67, 71],
      density: 0.22, pad: 'sine', lead: 'sine', bass: 'sine',
      drums: null, masterLp: 1800
    },
    {
      id: 't4', name: '绿茵晨光', bpm: 96, swing: 0.24, style: 'bossa',
      chords: [[46, 53, 58, 62, 65], [51, 58, 62, 65, 69], [44, 51, 56, 60, 63], [49, 56, 61, 64, 68]],
      scale: [58, 60, 62, 65, 67, 70, 72, 74],
      density: 0.5, pad: 'triangle', lead: 'triangle', bass: 'sine',
      drums: { kick: [0, 10], hat: [2, 6, 10, 14], clap: [4, 12], rim: true }, masterLp: 3000
    }
  ];

  var Music = (function () {
    var timer = null, track = null, bar = 0, nextBar = 0, masterLp = null;
    var info = { on: false, id: '', name: '' };

    function barDur() { return 60 / track.bpm * 4; }

    function scheduleBar(t) {
      var ac = ctx();
      if (!ac || !track) return;
      var chord = track.chords[bar % track.chords.length];
      var dur = barDur();
      var s16 = dur / 16;

      // 和弦垫
      chord.forEach(function (m) {
        voice({ f: mtof(m), dur: dur * 0.96, vol: 0.038, atk: dur * 0.25, type: track.pad, lp: track.masterLp, bus: musicBus, at: t - ac.currentTime, echo: 0.12 });
      });
      // 贝斯：1、3 拍根音（bossa 加反拍）
      var bassHits = track.style === 'bossa' ? [0, 6, 10] : [0, 8];
      bassHits.forEach(function (st) {
        voice({ f: mtof(chord[0] - 24), dur: s16 * 5, vol: 0.11, type: track.bass, lp: 400, bus: musicBus, at: t - ac.currentTime + st * s16 });
      });
      // 鼓
      if (track.drums) {
        (track.drums.kick || []).forEach(function (st) {
          voice({ f: 120, f2: 44, dur: 0.16, vol: 0.4, bus: musicBus, at: t - ac.currentTime + st * s16, glide: 0.1 });
        });
        (track.drums.hat || []).forEach(function (st, i) {
          var sw = (st % 4 === 2 && track.swing) ? track.swing * s16 * 2 : 0;
          noiseHit({ f: 7500, dur: 0.05, vol: i % 2 ? 0.028 : 0.05, bus: musicBus, at: t - ac.currentTime + st * s16 + sw });
        });
        (track.drums.clap || []).forEach(function (st) {
          noiseHit({ f: 1600, dur: 0.09, vol: 0.05, ftype: 'bandpass', q: 1.4, bus: musicBus, at: t - ac.currentTime + st * s16, echo: 0.15 });
        });
      }
      // 旋律：8 分网格上随机行走，偏向和弦音与级进
      var last = Math.floor(track.scale.length / 2);
      for (var e = 0; e < 8; e++) {
        if (Math.random() > track.density) continue;
        var step = Math.random() < 0.7 ? (Math.random() < 0.5 ? -1 : 1) : (Math.random() < 0.5 ? -2 : 2);
        last = Math.max(0, Math.min(track.scale.length - 1, last + step));
        var deg = track.scale[last];
        if (chord.indexOf(deg % 12 + 12 * Math.floor(deg / 12)) !== -1) deg += 12; // 和弦音升八度点亮
        var sw = (e % 2 === 1 && track.swing) ? track.swing * (dur / 8) : 0;
        voice({
          f: mtof(deg), dur: dur / 8 * (track.style === 'ambient' ? 3 : 1.4), vol: 0.075,
          type: track.lead, lp: track.masterLp + 800, bus: musicBus,
          at: t - ac.currentTime + e * dur / 8 + sw, echo: 0.3
        });
      }
      bar++;
    }

    function loop() {
      var ac = ctx();
      if (!ac || !track) return;
      while (nextBar < ac.currentTime + 0.25) {
        scheduleBar(nextBar);
        nextBar += barDur();
      }
    }

    function applyVolume() {
      if (musicBus) musicBus.gain.value = (SETTINGS.musicVol != null ? SETTINGS.musicVol : 0.5) * 0.5;
    }

    function start(id) {
      var t = TRACKS.filter(function (x) { return x.id === id; })[0];
      if (!t) return stop();
      stop();
      track = t;
      info = { on: true, id: t.id, name: t.name };
      var ac = ctx();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();
      applyVolume();
      bar = 0;
      nextBar = ac.currentTime + 0.08;
      timer = setInterval(loop, 40);
      loop();
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      track = null;
      info = { on: false, id: '', name: '' };
    }

    return {
      start: start, stop: stop, info: function () { return info; }, applyVolume: applyVolume,
      list: function () { return TRACKS.map(function (t) { return { id: t.id, name: t.name }; }); }
    };
  })();

  /** 浏览器自动播放策略：第一次任意手势时按记忆的曲目起播 */
  function armAutoplay() {
    function go() {
      var ac = ctx();
      if (ac && ac.state === 'suspended') ac.resume();
      if (SETTINGS.musicTrack && SETTINGS.musicTrack !== 'off' && !Music.info().on) {
        Music.start(SETTINGS.musicTrack);
      }
      document.removeEventListener('pointerdown', go);
    }
    document.addEventListener('pointerdown', go);
  }

  /* ---------------- DOM 小工具 ---------------- */

  function el(tag, attrs) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'onClick') n.addEventListener('click', v);
      else if (k === 'onInput') n.addEventListener('input', v);
      else if (k === 'onKey') n.addEventListener('keydown', v);
      else if (k === 'value') n.value = v;
      else if (v === false) { /* 布尔属性：false = 不设置 */ }
      else n.setAttribute(k, v === true ? '' : v);   // true = 只设属性名
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid === null || kid === undefined) continue;
      n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1900);
  }

  /* ---------------- 状态 ---------------- */

  var S = {
    view: 'home',
    game: null,             // applyGame 的对局数据（与小程序字段一致）
    players: [],            // 候选池（CLIENT_FIELDS 投影）
    cand: null,             // 筛选面板状态
    searchKw: '',
    searchHl: 0,
    searchResults: [],
    submitting: false,
    revealing: false,
    candKeep: []            // 同一局内记住上次面板勾选的条件，重开时带回来
  };

  /* ---------------- 头像徽章 ---------------- */

  function badgeOf(p, lg) {
    var b = el('div', { class: 'badge' + (lg ? ' lg' : '') });
    b.style.background = 'linear-gradient(150deg, ' + (p.primary_color || '#3a7d5a') + ', ' + (p.secondary_color || '#1f4d38') + ')';
    b.appendChild(el('span', { class: 'b-nat', text: p.nationality || '' }));
    b.appendChild(el('span', { class: 'b-txt', text: (p.name_cn || '?').charAt(0) }));
    b.appendChild(el('span', { class: 'b-pos', text: p.position || '' }));
    return b;
  }

  /* ---------------- 视图切换 ---------------- */

  function show(view) {
    S.view = view;
    ['home', 'game', 'reveal', 'result', 'help'].forEach(function (v) {
      $(v === 'game' ? 'view-game' : 'view-' + v).classList.toggle('on', v === view);
    });
    window.scrollTo(0, 0);
    closeSheet();
  }

  /* ---------------- 首页 ---------------- */

  function renderHome() {
    var box = $('home-body');
    clear(box);
    var st = loadStats();

    var strip = el('div', { class: 'stats-strip' });
    [['局数', st.played], ['胜率', st.played ? Math.round(st.won * 100 / st.played) + '%' : '—'],
     ['连胜', st.streak], ['最少步数', st.bestSteps || '—']].forEach(function (x) {
      strip.appendChild(el('div', { class: 'stat' },
        el('div', { class: 'stat-num', text: String(x[1]) }),
        el('div', { class: 'stat-label', text: x[0] })));
    });
    box.appendChild(strip);

    box.appendChild(modeCard('📅', '每日一题', '一天一位神秘球员，答案人人不同',
      function () { startGame('daily'); }, 't1'));

    box.appendChild(el('div', { class: 'mode-title', text: '自由练习' }));
    var c1 = el('div', { class: 'card' }, el('div', { class: 'mode-card' },
      el('div', { class: 'mode-icon t2', text: '⚽' }),
      el('div', { class: 'mode-body' },
        el('div', { class: 'mode-name', text: '按难度开局' }),
        el('div', { class: 'mode-desc', text: '猜满 8 条线索，随便玩' }))));
    var row1 = el('div', { class: 'diff-row' });
    [['star', '明星局', 75], ['normal', '标准局', 278], ['all', '全员局', 548]].forEach(function (d) {
      row1.appendChild(el('button', {
        class: 'diff-btn', onClick: function () { startGame('endless', d[0]); }
      }, d[1], el('small', { text: d[2] + ' 人池' })));
    });
    c1.appendChild(row1);
    box.appendChild(c1);

    box.appendChild(el('div', { class: 'mode-title', text: '反向猜球' }));
    var c2 = el('div', { class: 'card' }, el('div', { class: 'mode-card' },
      el('div', { class: 'mode-icon t3', text: '🔍' }),
      el('div', { class: 'mode-body' },
        el('div', { class: 'mode-name', text: '先看线索，再猜是谁' }),
        el('div', { class: 'mode-desc', text: '系统逐条揭晓答案属性，揭得越少分越高' }))));
    var row2 = el('div', { class: 'diff-row' });
    ['star', 'normal', 'all'].forEach(function (d) {
      row2.appendChild(el('button', {
        class: 'diff-btn', onClick: function () { startGame('reveal', d); }
      }, DIFF_NAME[d]));
    });
    c2.appendChild(row2);
    box.appendChild(c2);

    box.appendChild(el('div', { class: 'mode-title', text: '专题练习' }));
    var c3 = el('div', { class: 'card' });
    var grid = el('div', { class: 'theme-grid' });
    Object.keys(C.THEMES).forEach(function (id) {
      var t = C.THEMES[id];
      var n = S.players.filter(function (p) { return p.fame_level >= 3 && themeTest(p, t); }).length;
      grid.appendChild(el('button', {
        class: 'theme-chip', onClick: function () { startGame('endless', 'all', id); }
      }, t.label, el('small', { text: String(n) })));
    });
    c3.appendChild(grid);
    box.appendChild(c3);

    box.appendChild(modeCard('📖', '规则说明', '三色线索怎么读、怎么筛候选', function () { show('help'); }, 't4'));

    var foot = el('div', { class: 'home-foot' });
    foot.appendChild(el('span', { text: '题库 ' + S.players.length + ' 人 · 数据校准 2026-10-25 · ' }));
    var a = el('a', { text: 'GitHub', href: 'https://github.com/wangdajiejj/guess-player', target: '_blank' });
    foot.appendChild(a);
    var sndBtn = el('button', {
      class: 'cond-acts', style: 'margin-left:8px',
      onClick: function () {
        SETTINGS.sound = !SETTINGS.sound;
        lsSet('gpweb_settings', JSON.stringify(SETTINGS));
        sndBtn.textContent = SETTINGS.sound ? '🔊 音效开' : '🔇 音效关';
        sfx('tap');
      }
    }, SETTINGS.sound ? '🔊 音效开' : '🔇 音效关');
    foot.appendChild(sndBtn);
    box.appendChild(foot);
  }

  /** 与 mock-util.themeFilter 同口径的客户端过滤（专题人数展示用） */
  function themeTest(p, t) {
    if (t.league) return p.league === t.league;
    if (t.nationality) return p.nationality === t.nationality;
    if (t.active !== undefined) return p.active === t.active;
    if (t.foot) return p.preferred_foot === t.foot;
    if (t.group) return p.position_group === t.group;
    if (t.bornAfter) return Number(String(p.birth_date || '').slice(0, 4)) > t.bornAfter;
    return true;
  }

  function modeCard(icon, name, desc, onClick, tone) {
    return el('div', { class: 'card' }, el('div', { class: 'mode-card', onClick: onClick },
      el('div', { class: 'mode-icon ' + (tone || 't1'), text: icon }),
      el('div', { class: 'mode-body' },
        el('div', { class: 'mode-name', text: name }),
        el('div', { class: 'mode-desc', text: desc })),
      el('div', { class: 'mode-arrow', text: '›' })));
  }

  /* ---------------- 开局 / 通用 ---------------- */

  function startGame(mode, difficulty, themeId) {
    var r = mock.gameStart(mode, difficulty || '', themeId || '');
    if (!r.ok) { toast(r.msg || '开局失败'); return; }
    var d = r.data;
    if (d.status !== 'playing') { openResult(d.gameId); return; }
    S.game = d;
    S.candKeep = [];        // 新一局，条件从零开始
    S.submitting = false;
    S.revealing = false;
    S.searchKw = ''; S.searchHl = 0; S.searchResults = [];
    sfx('open');
    show(mode === 'reveal' ? 'reveal' : 'game');
    if (mode === 'reveal') renderReveal(); else renderGame();
  }

  function gameTitle(g) {
    if (g.mode === 'daily') return '每日一题';
    if (g.theme && C.THEMES[g.theme]) return C.THEMES[g.theme].label;
    var base = g.mode === 'reveal' ? '反向猜球' : '自由练习';
    return base + (DIFF_NAME[g.difficulty] ? ' · ' + DIFF_NAME[g.difficulty] : '');
  }

  function topbar(title, rightHtml) {
    var tb = el('div', { class: 'topbar' },
      el('button', { class: 'tb-back', text: '‹', onClick: function () { show('home'); renderHome(); } }),
      el('div', { class: 'tb-title' }, el('div', { class: 'tb-name', text: title })));
    if (rightHtml) tb.appendChild(rightHtml);
    return tb;
  }

  function dotsRow(g) {
    var d = el('div', { class: 'dots' });
    for (var i = 0; i < g.maxGuesses; i++) {
      var cls = i < g.used ? 'dot used' : (i === g.used && g.status === 'playing' ? 'dot cur' : 'dot');
      d.appendChild(el('div', { class: cls, text: i < g.used ? '✓' : '' }));
    }
    return d;
  }

  function recordGame(g) {
    var st = loadStats();
    if (st.lastGameId === g.gameId) return;
    st.lastGameId = g.gameId;
    st.played += 1;
    if (g.status === 'won') {
      st.won += 1;
      st.streak += 1;
      if (st.streak > st.bestStreak) st.bestStreak = st.streak;
      st.scoreSum = (st.scoreSum || 0) + (g.score || 0);
      if (!st.bestSteps || g.used < st.bestSteps) st.bestSteps = g.used;
    } else {
      st.streak = 0;
    }
    saveStats(st);
  }

  /* ---------------- 游戏页（常规模式） ---------------- */

  function renderGame() {
    var g = S.game;
    var box = $('view-game');
    clear(box);

    var remain = el('div', { class: 'tb-remain' },
      el('div', { class: 'tb-num' + (g.remaining <= 2 && g.status === 'playing' ? ' danger' : ''), text: String(g.remaining) }),
      el('div', { class: 'tb-label', text: '剩余机会' }));
    box.appendChild(topbar(gameTitle(g), remain));
    box.appendChild(dotsRow(g));

    var rows = el('div', { class: 'rows' });

    if (!g.rows.length) {
      rows.appendChild(el('div', { class: 'empty-state' },
        el('div', { class: 'big', text: '⚽' }),
        el('div', { class: 't1', text: '第一位球员，由你来定' }),
        el('div', { class: 'sub', text: '从下方搜一名球员，看看你和答案差在哪' })));
    }

    g.rows.forEach(function (row) {
      rows.appendChild(clueCardOf(row, row.round === g.rows[g.rows.length - 1].round));
    });

    if (g.status !== 'playing' && g.rows.length) {
      rows.appendChild(el('div', { class: 'finish-tip',
        text: g.status === 'won' ? '🎉 猜中了！正在揭晓…' : '机会用完了，正在揭晓答案…' }));
    }

    rows.appendChild(el('div', { style: 'height:20px' }));
    box.appendChild(rows);
    box.appendChild(searchBar());

    // 终局跳结果页
    if (g.status !== 'playing') {
      recordGame(g);
      setTimeout(function () { openResult(g.gameId); }, g.status === 'won' ? 950 : 700);
    }
  }

  function clueCardOf(row, isNew) {
    var p = row.player || {};
    var card = el('div', { class: 'clue-card' + (isNew ? ' new' : '') });

    var head = el('div', { class: 'cc-head' },
      el('div', { class: 'cc-round', text: '第 ' + row.round + ' 猜' }),
      badgeOf(p),
      el('div', { class: 'cc-name', text: p.name_cn || '未知球员' }));
    card.appendChild(head);

    var chips = el('div', { class: 'cc-chips' });
    theme.toChips(row.verdict).forEach(function (c) {
      chips.appendChild(el('button', {
        class: 'vchip ' + c.state,
        title: '按这条线索筛选候选池',
        onClick: function () { openCand(c.key, row.round); }
      },
        el('span', { class: 'lab', text: c.label }),
        c.text,
        c.arrow ? el('span', { class: 'arr', text: c.arrow }) : null));
    });
    card.appendChild(chips);
    return card;
  }

  /* ---------------- 搜索条 ---------------- */

  function searchBar() {
    var wrap = el('div', { class: 'bottom' }, el('div', { class: 'bottom-inner' }));
    var drop = el('div', { class: 'search-drop' });
    var input = el('input', {
      class: 'search-input', type: 'text', autocomplete: 'off',
      placeholder: S.game && S.game.status === 'playing' ? '搜球员名字 / 俱乐部 / 国籍…' : '本局已结束',
      value: S.searchKw,
      onInput: function () {
        S.searchKw = input.value;
        S.searchHl = 0;
        S.searchResults = (S.game && S.game.status === 'playing')
          ? search.search(S.players, S.searchKw, 30) : [];
        renderDrop();
      },
      onKey: function (e) {
        if (e.key === 'ArrowDown') { S.searchHl = Math.min(S.searchHl + 1, S.searchResults.length - 1); renderDrop(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { S.searchHl = Math.max(S.searchHl - 1, 0); renderDrop(); e.preventDefault(); }
        else if (e.key === 'Enter') {
          var p = S.searchResults[S.searchHl] || S.searchResults[0];
          if (p) submitGuess(p);
        } else if (e.key === 'Escape') { drop.classList.remove('on'); }
      }
    });

    function renderDrop() {
      clear(drop);
      if (!S.searchKw.trim() || !S.searchResults.length) {
        drop.classList.remove('on');
        return;
      }
      S.searchResults.forEach(function (p, i) {
        drop.appendChild(el('div', {
          class: 'sr-item' + (i === S.searchHl ? ' hl' : ''),
          onClick: function () { submitGuess(p); }
        },
          badgeOf(p),
          el('div', { class: 'sr-name' }, p.name_cn, el('b', { text: p.name_en || '' })),
          el('div', { class: 'sr-club', text: (p.club || '') + ' · ' + (p.league || '') })));
      });
      drop.classList.add('on');
    }

    var box = el('div', { class: 'search-box' }, drop, input);
    wrap.firstChild.appendChild(box);
    return wrap;
  }

  function submitGuess(p) {
    if (!S.game || S.game.status !== 'playing' || S.submitting) return;
    if (S.game.rows.some(function (r) { return r.guessedId === p.id; })) { toast('已经猜过 TA 了'); return; }
    S.submitting = true;
    var r = mock.gameGuess(S.game.gameId, p.id);
    S.submitting = false;
    if (!r.ok) { toast(r.msg || '没提交成功'); return; }
    var res = r.data;

    S.game.rows.push({
      round: res.round,
      guessedId: res.guessedId,
      verdict: res.verdict,
      player: res.player || p
    });
    S.game.used = res.used;
    S.game.remaining = res.remaining;
    S.game.status = res.status;
    S.game.score = res.score;
    if (S.game.mode === 'reveal') S.game.maxScore = res.maxScore || S.game.maxScore;

    S.searchKw = ''; S.searchResults = []; S.searchHl = 0;
    sfx(res.status === 'won' ? 'hit' : (res.status === 'lost' ? 'lose' : 'miss'));
    if (S.game.mode === 'reveal') renderReveal(); else renderGame();
  }

  /* ---------------- 候选筛选面板（与小程序 candidate-sheet 同一套逻辑） ---------------- */

  function openCand(key, round) {
    if (!S.game || S.game.status !== 'playing') return;
    if (!S.players.length) { toast('题库还没准备好'); return; }
    var all = clue.buildClues(S.game.rows);
    var picked = all.filter(function (c) { return c.key === key && c.round === round; })[0];
    if (!picked) { toast('这条线索暂时用不上'); return; }
    var d = clue.dedupeClues(all);
    var rep = d.idRemap[picked.id] || picked.id;
    S.cand = { clues: d.clues, active: keepUnion(d.clues, rep) };
    sfx('tap');
    renderSheet();
    $('mask').classList.add('on');
  }

  /** 重开面板时把上次勾的条件带回来：只保留当前仍存在的线索，再叠上这次点的 */
  function keepUnion(clues, rep) {
    var valid = {};
    clues.forEach(function (c) { valid[c.id] = 1; });
    var active = [];
    (S.candKeep || []).forEach(function (id) {
      if (valid[id] && id !== rep && active.indexOf(id) === -1) active.push(id);
    });
    active.push(rep);
    return active;
  }

  /** 反向猜球：点已揭线索槽，用绿色精确条件筛（与小程序 onSlotTap 同构） */
  function openCandFromSlot(slotKey) {
    if (!S.game || S.game.status !== 'playing') return;
    var clues = buildRevealClues();
    var picked = clues.filter(function (c) { return c.key === slotKey; })[0];
    if (!picked) return;
    sfx('tap');
    S.cand = { clues: clues, active: keepUnion(clues, picked.id) };
    renderSheet();
    $('mask').classList.add('on');
  }

  function buildRevealClues() {
    return (S.game.clues || [])
      .filter(function (c) { return c.value !== null && c.value !== undefined; })
      .map(function (c) {
        return {
          id: 'rv:' + c.key, key: c.key, label: c.label, text: c.text,
          state: 'green', arrow: 'equal', value: c.value, guess: null
        };
      });
  }

  function candCells(p) {
    var dk = S.game.dateKey;
    return theme.CLUE_META.map(function (m) {
      var v;
      if (m.key === 'age') v = (p.birth_date ? M.calcAge(p.birth_date, dk) : null), v = v == null ? '—' : v + '岁';
      else if (m.key === 'height') v = p.height_cm == null ? '—' : p.height_cm + 'cm';
      else if (m.key === 'shirt_number') v = p.shirt_number == null ? '—' : '#' + p.shirt_number;
      else v = p[m.key] || '—';
      return { label: m.label, text: String(v) };
    });
  }

  function renderSheet() {
    var c = S.cand;
    if (!c) return;
    S.candKeep = (c.active || []).slice();   // 勾选变化随时记住，关面板再开不丢
    var mask = $('mask');
    clear(mask);
    var sheet = el('div', { class: 'sheet' });

    var guessedIds = S.game.rows.map(function (r) { return r.guessedId; });

    var picked = c.clues.filter(function (x) { return c.active.indexOf(x.id) !== -1; });
    var constraints = clue.describeConstraints(picked, S.game.dateKey);
    var hit = clue.filterPlayers(S.players, picked, S.game.dateKey);
    var fresh = [], done = [];
    hit.forEach(function (p) { (guessedIds.indexOf(p.id) !== -1 ? done : fresh).push(p); });
    var ordered = fresh.concat(done);

    // 头部
    sheet.appendChild(el('div', { class: 'sheet-handle' }));
    sheet.appendChild(el('div', { class: 'sheet-title' },
      el('b', { text: '符合条件的球员' }),
      el('span', { class: 'sheet-count', text: hit.length + ' 人' }),
      el('button', { class: 'sheet-close', text: '关闭', onClick: closeSheet })));

    // chips 行
    var head = el('div', { class: 'cond-head' },
      el('span', { class: 'cond-tip', text: '点标签可增减条件' }),
      el('div', { class: 'cond-acts' },
        el('button', { text: '全选', onClick: function () { c.active = c.clues.map(function (x) { return x.id; }); sfx('tap'); renderSheet(); } }),
        el('span', { text: ' · ' }),
        el('button', { text: '清空', onClick: function () { c.active = []; sfx('tap'); renderSheet(); } })));
    sheet.appendChild(head);

    var scroll = el('div', { class: 'cond-scroll' });
    var row = el('div', { class: 'cond-row' });
    c.clues.forEach(function (x) {
      var on = c.active.indexOf(x.id) !== -1;
      row.appendChild(el('button', {
        class: 'cchip ' + x.state + (on ? ' on' : ''),
        onClick: function () {
          var i = c.active.indexOf(x.id);
          if (i === -1) c.active.push(x.id); else c.active.splice(i, 1);
          sfx('tap'); renderSheet();
        }
      },
        el('span', { class: 'lab', text: x.label }), x.text));
    });
    scroll.appendChild(row);
    sheet.appendChild(scroll);

    // 条件摘要（启用即显示，和人数对得上）
    var consLine = el('div', { class: 'cons-line' });
    if (constraints.length) {
      consLine.appendChild(el('span', {
        text: constraints.length < picked.length
          ? '已启用 ' + picked.length + ' 条，同字段合并后实际生效 ' + constraints.length + ' 条：'
          : '已启用 ' + picked.length + ' 条：'
      }));
      constraints.forEach(function (k) {
        consLine.appendChild(el('span', { class: 'c', text: k.label + k.op + k.text }));
      });
    } else if (!S.players.length) {
      consLine.appendChild(el('span', { text: '题库还没准备好' }));
    } else {
      consLine.appendChild(el('span', { text: '没有启用任何条件，下面是全部候选球员' }));
    }
    sheet.appendChild(consLine);
    sheet.appendChild(el('div', { class: 'sheet-hint', text: '点球员即提交这次猜测' }));

    // 列表
    var list = el('div', { class: 'sheet-list' });
    if (!ordered.length) {
      list.appendChild(el('div', { class: 'cand-empty' },
        el('p', { text: !S.players.length ? '题库还没准备好' : '没有球员同时满足这些条件' }),
        el('p', { text: !S.players.length ? '稍等一下再点这个标签' : '去掉一个条件再试试' })));
    } else {
      ordered.slice(0, RENDER_CAP).forEach(function (p) {
        var isDone = guessedIds.indexOf(p.id) !== -1;
        var item = el('div', { class: 'cand-item' + (isDone ? ' done' : ''), onClick: function () { pickFromSheet(p); } });
        item.appendChild(badgeOf(p));
        var info = el('div', { style: 'flex:1;min-width:0' });
        var nameRow = el('div', { class: 'cand-name-row' },
          el('span', { class: 'cand-name', text: p.name_cn }),
          isDone ? el('span', { class: 'cand-tag', text: '已猜过' })
            : (p.active === false ? el('span', { class: 'cand-tag', text: '传奇' }) : null));
        info.appendChild(nameRow);
        var cells = el('div', { class: 'cand-cells' });
        candCells(p).forEach(function (cell) {
          cells.appendChild(el('div', { class: 'cand-cell' },
            el('span', { class: 'k', text: cell.label }),
            el('span', { class: 'v', text: cell.text })));
        });
        info.appendChild(cells);
        item.appendChild(info);
        list.appendChild(item);
      });
      if (ordered.length > RENDER_CAP) {
        list.appendChild(el('div', { class: 'cand-capped',
          text: '候选共 ' + ordered.length + ' 人，列表只渲染前 ' + RENDER_CAP + ' 人；点上方标签收窄条件后即为完整列表' }));
      }
    }
    sheet.appendChild(list);
    mask.appendChild(sheet);
  }

  function pickFromSheet(p) {
    if (S.game.rows.some(function (r) { return r.guessedId === p.id; })) { toast('已经猜过 TA 了'); return; }
    closeSheet();
    submitGuess(p);
  }

  function closeSheet() {
    $('mask').classList.remove('on');
    S.cand = null;
  }

  /* ---------------- 反向猜球页 ---------------- */

  function renderReveal() {
    var g = S.game;
    var box = $('view-reveal');
    clear(box);

    var right = el('div', { class: 'tb-remain' },
      el('div', { class: 'tb-score', text: String(g.maxScore || 0) }),
      el('div', { class: 'tb-label', text: '现在猜中的得分' }));
    box.appendChild(topbar(gameTitle(g), right));

    box.appendChild(el('div', { class: 'chance-bar' },
      el('span', { text: '剩余机会 ' + g.remaining + '/' + g.maxGuesses }),
      el('span', { text: '已揭 ' + (g.revealed || 1) + '/8 条线索' })));

    var body = el('div', { class: 'rows' });

    var board = el('div', { class: 'card' });
    var grid = el('div', { class: 'slot-board' });
    var order = C.REVEAL_ORDER;
    var byKey = {};
    (g.clues || []).forEach(function (c) { byKey[c.key] = c; });
    var labels = { nationality: '国籍', league: '联赛', club: '俱乐部', position: '位置', age: '年龄', height: '身高', shirt_number: '球衣号', preferred_foot: '惯用脚' };
    order.forEach(function (key, i) {
      var locked = i >= (g.revealed || 1);
      var c = byKey[key];
      var slot = el('div', {
        class: 'slot ' + (locked ? 'locked' : 'open'),
        onClick: function () { if (!locked) openCandFromSlot(key); }
      },
        el('div', { class: 's-lab', text: labels[key] || key }),
        el('div', { class: 's-val', text: locked ? '第 ' + (i + 1) + ' 条揭晓' : (c ? c.text : '') }));
      grid.appendChild(slot);
    });
    board.appendChild(grid);
    board.appendChild(el('div', { class: 'board-tip', text: '点已揭开的线索，筛出还符合的球员' }));
    body.appendChild(board);

    var canReveal = g.status === 'playing' && (g.revealed || 1) < 8 && !S.revealing;
    var revealBtn = el('button', {
      class: 'btn btn-gold', style: 'margin:10px 14px 0;width:auto',
      disabled: !canReveal,
      onClick: function () { revealNext(); }
    }, S.revealing ? '揭晓中…'
      : ((g.revealed || 1) >= 8 ? '8 条线索全揭开了'
        : '揭晓下一条（猜中只剩 ' + Math.max(100, (g.maxScore || 800) - 100) + ' 分）'));
    body.appendChild(revealBtn);

    if (g.rows.length) {
      var gl = el('div', { class: 'card guess-list' },
        el('div', { class: 'g-title', text: '已猜 ' + g.rows.length + ' 人（都不对）' }));
      var chips = el('div', { class: 'g-chips' });
      g.rows.forEach(function (r) {
        chips.appendChild(el('span', { class: 'g-chip', text: '✗ ' + ((r.player || {}).name_cn || '') }));
      });
      gl.appendChild(chips);
      body.appendChild(gl);
    }

    if (g.status !== 'playing') {
      body.appendChild(el('div', { class: 'finish-tip',
        text: g.status === 'won' ? '🎉 猜中了！正在揭晓…' : '机会用完了，正在揭晓答案…' }));
      recordGame(g);
      setTimeout(function () { openResult(g.gameId); }, g.status === 'won' ? 950 : 700);
    }

    body.appendChild(el('div', { style: 'height:16px' }));
    box.appendChild(body);
    box.appendChild(searchBar());
  }

  function revealNext() {
    if (!S.game || S.game.status !== 'playing' || S.revealing) return;
    if ((S.game.revealed || 1) >= 8) { toast('8 条都揭开了，直接猜吧'); return; }
    S.revealing = true;
    renderReveal();
    var r = mock.gameReveal(S.game.gameId);
    S.revealing = false;
    if (!r.ok) { toast(r.msg || '没揭晓成功'); renderReveal(); return; }
    var d = r.data;
    S.game.revealed = d.revealed;
    S.game.maxScore = d.maxScore;
    S.game.clues = d.clues;
    S.game.used = d.used;
    S.game.remaining = d.remaining;
    sfx('reveal');
    renderReveal();
  }

  /* ---------------- 彩带庆祝（canvas 现画，无素材文件） ---------------- */

  function confetti() {
    var cvs = document.createElement('canvas');
    if (!cvs.getContext) return;   // 异常环境直接放弃，不影响结果页
    cvs.id = 'confetti';
    document.body.appendChild(cvs);
    var ctx = cvs.getContext('2d');
    var W = cvs.width = window.innerWidth;
    var H = cvs.height = window.innerHeight;
    var COLORS = ['#6aaa64', '#d9a62e', '#e8c14d', '#3a9d6d', '#ffffff', '#c9b458'];
    var parts = [];
    for (var i = 0; i < 90; i++) {
      parts.push({
        x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        c: COLORS[i % COLORS.length],
        vy: 2.2 + Math.random() * 2.6, vx: -1.2 + Math.random() * 2.4,
        rot: Math.random() * Math.PI, vr: -0.12 + Math.random() * 0.24
      });
    }
    var t0 = Date.now();
    (function frame() {
      ctx.clearRect(0, 0, W, H);
      var el0 = Date.now() - t0;
      parts.forEach(function (q) {
        q.x += q.vx; q.y += q.vy; q.rot += q.vr; q.vy += 0.015;
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.globalAlpha = Math.max(0, 1 - el0 / 2600);
        ctx.fillStyle = q.c;
        ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
        ctx.restore();
      });
      if (el0 < 2800) requestAnimationFrame(frame);
      else cvs.remove();
    })();
  }

  /* ---------------- 结果页 ---------------- */

  function openResult(gameId) {
    var r = mock.gameResult(gameId);
    if (!r.ok) { toast(r.msg || '结果读取失败'); return; }
    var d = r.data;
    var box = $('view-result');
    clear(box);

    var banner = el('div', {
      class: 'res-banner ' + (d.status === 'won' ? 'won' : 'lost')
    },
      el('div', { class: 'emoji', text: d.status === 'won' ? '🎉' : '😢' }),
      el('h2', { text: d.status === 'won' ? '猜中了！' : '很遗憾' }),
      el('div', { class: 'score', text: d.status === 'won' ? ('得分 ' + d.score) : (d.used + ' / ' + (d.rows.length ? '8' : '8') + ' 次用尽') }),
      el('div', { class: 'mute', style: 'margin-top:6px;opacity:.8', text: (d.mode === 'reveal' ? '反向猜球 · 揭了 ' + d.revealed + ' 条线索' : gameTitle({ mode: d.mode, difficulty: d.difficulty, theme: d.theme })) }));
    box.appendChild(banner);

    // 答案卡
    var a = d.answer;
    var ansCard = el('div', { class: 'card' });
    var head = el('div', { class: 'ans-head' }, badgeOf(a, true));
    var meta = el('div', { class: 'ans-meta' },
      el('div', { class: 'ans-name', text: a.name_cn || '' }),
      el('div', { class: 'ans-en', text: a.name_en || '' }));
    var tags = el('div', { class: 'ans-tags' },
      el('span', { class: 'tag', text: a.position || '' }),
      el('span', { class: 'tag', text: a.league || '' }),
      a.active === false ? el('span', { class: 'tag legend', text: '退役传奇' }) : null);
    meta.appendChild(tags);
    head.appendChild(meta);
    ansCard.appendChild(head);

    var grid = el('div', { class: 'ans-grid' });
    [['国籍', a.nationality], ['俱乐部', a.club], ['联赛', a.league], ['位置', a.position],
     ['年龄', a.age != null ? a.age + '岁' : '—'], ['身高', a.height_cm ? a.height_cm + 'cm' : '—'],
     ['球衣号', a.shirt_number != null ? '#' + a.shirt_number : '—'], ['惯用脚', a.preferred_foot || '—']].forEach(function (x) {
      grid.appendChild(el('div', { class: 'ag' },
        el('div', { class: 'k', text: x[0] }),
        el('div', { class: 'v', text: String(x[1] || '—') })));
    });
    ansCard.appendChild(grid);

    [['简介', a.intro], ['冷知识', a.fun_fact], ['梗', a.meme]].forEach(function (x) {
      if (x[1]) ansCard.appendChild(el('div', { class: 'txt-block' },
        el('div', { class: 't', text: x[0] }), el('div', { class: 'b', text: x[1] })));
    });
    box.appendChild(ansCard);

    // 回放
    if (d.rows.length) {
      var rp = el('div', { class: 'card' },
        el('div', { class: 'replay-title', text: '猜测回放' }));
      if (d.mode === 'reveal') {
        var gc = el('div', { class: 'g-chips' });
        d.rows.forEach(function (r) {
          gc.appendChild(el('span', { class: 'g-chip', text: (r.hit ? '✓ ' : '✗ ') + ((r.player || {}).name_cn || '') }));
        });
        rp.appendChild(gc);
      } else {
        d.rows.forEach(function (row) {
          var card = el('div', { class: 'clue-card', style: 'margin:8px 0 0;box-shadow:none;background:var(--field)' });
          card.appendChild(el('div', { class: 'cc-head' },
            el('div', { class: 'cc-round', text: '第 ' + row.round + ' 猜' }),
            badgeOf(row.player || {}),
            el('div', { class: 'cc-name', text: (row.player || {}).name_cn || '' })));
          var chips = el('div', { class: 'cc-chips' });
          theme.toChips(row.verdict).forEach(function (c) {
            chips.appendChild(el('span', { class: 'vchip ' + c.state, style: 'cursor:default' },
              el('span', { class: 'lab', text: c.label }), c.text,
              c.arrow ? el('span', { class: 'arr', text: c.arrow }) : null));
          });
          card.appendChild(chips);
          rp.appendChild(card);
        });
      }
      box.appendChild(rp);
    }

    // 操作
    var acts = el('div', { class: 'res-acts' });
    if (d.mode === 'daily') {
      acts.appendChild(el('button', { class: 'btn btn-primary', onClick: function () { show('home'); renderHome(); } }, '回首页（明天再来）'));
    } else {
      acts.appendChild(el('button', {
        class: 'btn btn-primary',
        onClick: function () { startGame(d.mode, d.difficulty, d.theme); }
      }, '再来一局'));
      acts.appendChild(el('button', { class: 'btn btn-ghost', onClick: function () { show('home'); renderHome(); } }, '回首页'));
    }
    box.appendChild(acts);

    show('result');
    if (d.status === 'won') confetti();
  }

  /* ---------------- 帮助页 ---------------- */

  function renderHelp() {
    var box = $('view-help');
    clear(box);
    box.appendChild(topbar('规则说明'));

    var body = el('div', { class: 'rows' });
    var card = el('div', { class: 'card help-body' });

    card.appendChild(el('h3', { text: '玩法' }));
    card.appendChild(el('p', { text: '每局有一位神秘球员。搜一名球员作为猜测，系统会把他和答案的 8 项属性逐行比对，用三种颜色告诉你差多远。8 次机会内找出答案。' }));

    card.appendChild(el('h3', { text: '三色线索' }));
    var demo = el('div', { class: 'help-demo' },
      el('span', { class: 'vchip green', style: 'cursor:default' }, el('span', { class: 'lab', text: '国籍' }), '巴西'),
      el('span', { class: 'vchip amber', style: 'cursor:default' }, el('span', { class: 'lab', text: '俱乐部' }), '皇马 ↑'),
      el('span', { class: 'vchip gray', style: 'cursor:default' }, el('span', { class: 'lab', text: '年龄' }), '26岁 ↓'));
    card.appendChild(demo);
    card.appendChild(el('ul'));
    ['绿：完全一致', '黄：接近 —— 俱乐部同联赛 / 位置同大类 / 数值在公差内（↑↓ 表示答案在这边）', '灰：不对，数值类同样带方向箭头'].forEach(function (t) {
      card.lastChild.appendChild(el('li', { text: t }));
    });

    card.appendChild(el('h3', { text: '点标签筛候选' }));
    card.appendChild(el('p', { text: '线索卡上任意标签都能点：面板会列出还符合这条条件的所有球员，可以继续勾选其它标签叠加条件。筛完的结果必定包含答案 —— 每条约束都只是答案的必要条件。' }));

    card.appendChild(el('h3', { text: '模式' }));
    card.appendChild(el('ul'));
    ['每日一题：一天一局，答案按日期 + 浏览器指纹散列，人人不同', '自由练习：按知名度分 明星局（75 人）/ 标准局（278 人）/ 全员局（548 人）', '反向猜球：系统逐条揭晓答案属性，越早猜中得分越高', '专题练习：英超、退役传奇、左脚将、00后新星 等 12 个主题池'].forEach(function (t) {
      card.lastChild.appendChild(el('li', { text: t }));
    });

    card.appendChild(el('h3', { text: '关于网页版' }));
    card.appendChild(el('p', { text: '题库与判定逻辑与微信小程序版完全同源（同一份代码），对局数据只存在你的浏览器本地。下载本文件后双击即可离线游玩。' }));

    body.appendChild(card);
    body.appendChild(el('div', { style: 'height:30px' }));
    box.appendChild(body);
  }

  /* ---------------- 音乐浮控（所有视图可见） ---------------- */

  var musicPop = null;

  function musicChipSync(chip) {
    var on = Music.info().on;
    chip.classList.toggle('playing', on);
    chip.setAttribute('title', on ? '背景音乐：' + Music.info().name + '（点开切换）' : '背景音乐（关）');
  }

  function buildMusicUI() {
    var chip = el('button', { class: 'music-chip', text: '🎵', title: '背景音乐' });
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      if (musicPop) { closeMusicPop(chip); return; }
      sfx('tap');
      if (!ctx()) { toast('当前浏览器不支持音频'); return; }
      musicPop = el('div', { class: 'music-pop' });
      musicPop.appendChild(el('div', { class: 'mp-title', text: '背景音乐' }));

      var rows = [{ id: 'off', name: '关闭' }].concat(Music.list());
      rows.forEach(function (t) {
        var cur = SETTINGS.musicTrack || 'off';
        var row = el('div', {
          class: 'mp-row' + (cur === t.id ? ' on' : ''),
          onClick: function () {
            SETTINGS.musicTrack = t.id;
            lsSet('gpweb_settings', JSON.stringify(SETTINGS));
            if (t.id === 'off') Music.stop(); else Music.start(t.id);
            refreshRows();
            musicChipSync(chip);
            sfx('tap');
          }
        },
          el('span', { class: 'mp-dot', text: cur === t.id ? '●' : '○' }),
          el('span', { text: t.name }));
        row.dataset.tid = t.id;
        musicPop.appendChild(row);
      });

      function refreshRows() {
        var cur = SETTINGS.musicTrack || 'off';
        musicPop.querySelectorAll('.mp-row').forEach(function (r) {
          r.classList.toggle('on', r.dataset.tid === cur);
          r.firstChild.textContent = r.dataset.tid === cur ? '●' : '○';
        });
      }

      var vol = el('input', { class: 'mp-vol', type: 'range', min: '0', max: '1', step: '0.05', value: String(SETTINGS.musicVol != null ? SETTINGS.musicVol : 0.5) });
      vol.addEventListener('input', function () {
        SETTINGS.musicVol = Number(vol.value);
        Music.applyVolume();
        lsSet('gpweb_settings', JSON.stringify(SETTINGS));
      });
      var volRow = el('div', { class: 'mp-vol-row' }, el('span', { class: 'mute', text: '音量' }), vol);
      musicPop.appendChild(volRow);

      document.body.appendChild(musicPop);
      musicChipSync(chip);
      setTimeout(function () {
        document.addEventListener('pointerdown', function outside(ev) {
          if (musicPop && !musicPop.contains(ev.target)) closeMusicPop(chip);
          else if (musicPop) document.addEventListener('pointerdown', outside, { once: true });
        }, { once: true });
      }, 0);
    });
    document.body.appendChild(chip);
    return chip;
  }

  function closeMusicPop(chip) {
    if (musicPop) { musicPop.remove(); musicPop = null; }
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    // 骨架占位：题库在页面里是同步内联的，这里直接取
    var r = mock.getPlayers('');
    S.players = (r.ok && r.data.players) || [];
    renderHome();
    renderHelp();
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheet();
    });
    $('mask').addEventListener('click', function (e) {
      if (e.target === $('mask')) { sfx('close'); closeSheet(); }
    });
    var chip = buildMusicUI();
    armAutoplay();
    setTimeout(function () { musicChipSync(chip); }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
