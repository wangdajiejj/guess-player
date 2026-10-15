/**
 * 判定状态 -> 展示层映射（唯一出处，避免各页各写一套颜色）
 */

const STATE_STYLE = {
  green: { bg: '#6aaa64', text: '#ffffff', soft: '#eaf3e6', softText: '#3d7a3a' },
  amber: { bg: '#c9b458', text: '#ffffff', soft: '#faf3dc', softText: '#8a7a26' },
  gray: { bg: '#787c7e', text: '#ffffff', soft: '#eeefee', softText: '#4a4d4f' }
};

const ARROW_TEXT = {
  equal: '=',
  up: '↑',
  down: '↓',
  '': ''
};

/** 线索字段的展示顺序与单位 */
const CLUE_META = [
  { key: 'nationality', label: '国籍' },
  { key: 'club', label: '俱乐部' },
  { key: 'league', label: '联赛' },
  { key: 'position', label: '位置' },
  { key: 'age', label: '年龄' },
  { key: 'height', label: '身高' },
  { key: 'shirt_number', label: '球衣号' },
  { key: 'preferred_foot', label: '惯用脚' }
];

/**
 * 把服务端返回的 verdict 转成可直接渲染的 chip 数组
 * @param {Object} verdict gameGuess 返回的 verdict
 * @returns {Array<{key,label,text,state,arrow,cls}>}
 */
function toChips(verdict) {
  if (!verdict) return [];
  return CLUE_META.map(m => {
    const v = verdict[m.key] || {};
    let text;
    if (m.key === 'age') text = (v.value != null ? v.value : '—') + '岁';
    else if (m.key === 'height') text = (v.value != null ? v.value : '—') + 'cm';
    else if (m.key === 'shirt_number') text = '#' + (v.value != null ? v.value : '—');
    else text = v.value || '—';

    const arrow = v.arrow ? (ARROW_TEXT[v.arrow] || '') : '';
    return {
      key: m.key,
      label: m.label,
      text: text,
      state: v.state || 'gray',
      arrow: arrow,
      bg: STATE_STYLE[v.state || 'gray'].bg,
      textColor: STATE_STYLE[v.state || 'gray'].text
    };
  });
}

/** 是否全绿（命中） */
function isAllGreen(verdict) {
  if (!verdict) return false;
  return CLUE_META.every(m => (verdict[m.key] || {}).state === 'green');
}

/** 战绩方块图里每一格的颜色 */
function gridColors(verdict) {
  return CLUE_META.map(m => STATE_STYLE[(verdict[m.key] || {}).state || 'gray'].bg);
}

module.exports = { STATE_STYLE, ARROW_TEXT, CLUE_META, toChips, isAllGreen, gridColors };
