/**
 * 专题练习的主题表 —— 首页展示 + 客户端人数统计。
 *
 * ⚠️ 服务端的真源在 cloudfunctions/_shared/constants.js 的 THEMES
 * （开局时按它切答案池）。两份表的条件口径由 scripts/test-flow.js
 * 的「主题口径对拍」逐主题核对：改任何一边都必须同步另一边。
 *
 * cond 字段与服务端一一对应：league / nationality / active / foot /
 * group（position_group）/ bornAfter（出生年份 > 该值）。
 */
const THEMES = [
  { id: 'epl',       label: '英超专场',   league: '英超' },
  { id: 'laliga',    label: '西甲专场',   league: '西甲' },
  { id: 'seriea',    label: '意甲专场',   league: '意甲' },
  { id: 'bundes',    label: '德甲专场',   league: '德甲' },
  { id: 'legends',   label: '退役传奇',   active: false },
  { id: 'lefty',     label: '左脚将',     foot: '左脚' },
  { id: 'gk',        label: '门将专场',   group: 'GK' },
  { id: 'fw',        label: '前锋专场',   group: 'FW' },
  { id: 'brazil',    label: '巴西球员',   nationality: '巴西' },
  { id: 'argentina', label: '阿根廷球员', nationality: '阿根廷' },
  { id: 'england',   label: '英格兰球员', nationality: '英格兰' },
  { id: 'genz',      label: '00后新星',   bornAfter: 1999 }
];

const BY_ID = {};
THEMES.forEach(t => { BY_ID[t.id] = t; });

function labelOf(id) {
  return BY_ID[id] ? BY_ID[id].label : '';
}

/** 与服务端 themeFilter 同口径的谓词（用于首页人数统计） */
function testOf(t, p) {
  if (t.league) return p.league === t.league;
  if (t.nationality) return p.nationality === t.nationality;
  if (t.active !== undefined) return p.active === t.active;
  if (t.foot) return p.preferred_foot === t.foot;
  if (t.group) return p.position_group === t.group;
  if (t.bornAfter) return Number(String(p.birth_date || '').slice(0, 4)) > t.bornAfter;
  return true;
}

/** 各主题的池子人数（答案池口径：fame>=3 再切主题） */
function countAll(players) {
  const pool = (players || []).filter(p => p.fame_level >= 3);
  const out = {};
  THEMES.forEach(t => {
    out[t.id] = pool.filter(p => testOf(t, p)).length;
  });
  return out;
}

module.exports = { THEMES, labelOf, testOf, countAll };
