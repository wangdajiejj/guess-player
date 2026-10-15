const theme = require('../../utils/theme.js');

Page({
  data: {
    dataAsOf: '2026-10-11',
    legends: [
      {
        state: 'green',
        short: '绿',
        bg: theme.STATE_STYLE.green.bg,
        name: '完全命中',
        desc: '这一项和答案一模一样'
      },
      {
        state: 'amber',
        short: '黄',
        bg: theme.STATE_STYLE.amber.bg,
        name: '比较接近',
        desc: '俱乐部同联赛、位置同大类，或数值差距很小'
      },
      {
        state: 'gray',
        short: '灰',
        bg: theme.STATE_STYLE.gray.bg,
        name: '没有关系',
        desc: '完全不沾边，往别的方向想'
      }
    ]
  },

  onShareAppMessage() {
    return { title: '猜球员 — 8 次机会找出他是谁', path: '/pages/index/index' };
  },

  onShareTimeline() {
    return { title: '猜球员 — 8 次机会找出他是谁', query: '' };
  }
});
