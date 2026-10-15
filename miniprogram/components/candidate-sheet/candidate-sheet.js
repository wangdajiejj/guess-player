/**
 * 候选面板 —— 「点线索标签，筛出还符合条件的人」
 *
 * 数据流：
 *   game 页把每一行猜测的 8 个标签都变成线索（clue.buildClues），
 *   点某个标签时把 panel = { clues, initial } 传进来，
 *   面板内部允许继续勾选/取消其它线索，实时重算候选列表。
 *
 * ⚠️ 为什么线索和初始条件合并成一个 `panel` 对象传，而不是拆成 clues + initialKeys 两个属性：
 *    组件属性的 observer 触发顺序在小程序里是不保证的（同一次 setData 里谁先谁后看实现）。
 *    拆成两个属性时，可能出现"先用旧的 clues 算了一遍、再读到新的初始条件"的中间态 ——
 *    表现就是面板打开瞬间人数不对，卡住不动。合成一个对象就只有一次 observer，天然原子。
 *
 * 默认只启用「你点的那一条」—— 想叠加更多线索得自己勾，
 * 因为全部叠加上去基本等于直接给答案（实测平均只剩 1 人）。
 */
const clueUtil = require('../../utils/clue.js');
const sfx = require('../../utils/sfx.js');
const theme = require('../../utils/theme.js');
const ageUtil = require('../../utils/age.js');

/**
 * 列表一次最多渲染多少人。
 * 每人要铺 8 项线索（= 16 个 text），「清空条件」时是 500 人 —— 4000+ 个节点，
 * 低端机会明显掉帧。超过就截断，并在列表底部**明说**截断了多少（不做静默截断）。
 * 正常玩法里点一两条线索就收到十几人以内，碰不到这个上限。
 */
const RENDER_CAP = 100;

/**
 * 把一名球员的 8 项线索全部摊平，供候选列表逐项展示。
 *
 * 字段顺序和名字直接复用 theme.CLUE_META —— 就是线索卡、结果页、分享图用的那一份表，
 * 所以「面板里从上到下看到的顺序」永远等于「猜完之后线索卡的顺序」，不会有第二套口径。
 * 年龄同样不存库，按对局自然日实时算（和 clue.js 过滤时用的是同一个 calcAge）。
 */
function cellsOf(p, dateKey) {
  return theme.CLUE_META.map(m => {
    let text;
    if (m.key === 'age') {
      const a = ageUtil.calcAge(p.birth_date, dateKey);
      text = a == null ? '—' : a + '岁';
    } else if (m.key === 'height') {
      text = p.height_cm == null ? '—' : p.height_cm + 'cm';
    } else if (m.key === 'shirt_number') {
      text = p.shirt_number == null ? '—' : '#' + p.shirt_number;
    } else {
      text = p[m.key] || '—';
    }
    return { key: m.key, label: m.label, text: String(text) };
  });
}

Component({
  properties: {
    /** null = 关闭；{ clues: [...], initial: [clueId] } = 打开 */
    panel: {
      type: Object,
      value: null,
      observer: '_onPanel'
    },
    /** 候选池（全量 500 人） */
    players: {
      type: Array,
      value: [],
      observer: '_onData'
    },
    /** 已猜过的 id，置灰并排到后面 */
    guessed: {
      type: Array,
      value: []
    },
    /** 对局自然日，用来算年龄 */
    dateKey: {
      type: String,
      value: ''
    }
  },

  data: {
    clues: [],
    active: [],
    cluesView: [],
    constraints: [],
    activeCount: 0,
    list: [],
    total: 0,
    /** 被截断没渲染的人数，0 = 全部渲染了 */
    hidden: 0
  },

  methods: {
    noop() {},

    _onPanel(v) {
      if (!v) {
        this.setData({ clues: [], active: [], cluesView: [], constraints: [], activeCount: 0, list: [], total: 0, hidden: 0 });
        return;
      }
      this.setData({
        clues: v.clues || [],
        active: (v.initial || []).slice()
      }, () => this._rebuild());
    },

    /** 候选池变了就重算（幂等，多次触发也没关系） */
    _onData() {
      if (this.properties.panel) this._rebuild();
    },

    _rebuild() {
      const all = this.data.clues || [];
      const active = this.data.active || [];
      const picked = all.filter(c => active.indexOf(c.id) !== -1);

      const constraints = clueUtil.describeConstraints(picked, this.properties.dateKey);
      const hit = clueUtil.filterPlayers(this.properties.players, picked, this.properties.dateKey);

      // 已猜过的排到后面并置灰（服务端也会拦，这里只是别让人白点）
      // 只在真的猜过时复制对象，避免清空条件时白白复制 500 条
      const guessed = this.properties.guessed || [];
      const fresh = [], done = [];
      hit.forEach(p => (guessed.indexOf(p.id) !== -1 ? done : fresh).push(p));

      // 每人补齐 8 项线索（年龄要按对局日算，所以必须在这里做而不是模板里）
      const dk = this.properties.dateKey || ageUtil.beijingDateKey();
      const decorate = p => Object.assign({}, p, { __cells: cellsOf(p, dk) });
      const ordered = fresh.concat(done.map(p => Object.assign({}, p, { __done: true })));

      this.setData({
        cluesView: all.map(c => ({
          id: c.id,
          label: c.label,
          text: c.text,
          state: c.state,
          on: active.indexOf(c.id) !== -1
        })),
        constraints,
        activeCount: picked.length,
        list: ordered.slice(0, RENDER_CAP).map(decorate),
        total: hit.length,
        hidden: Math.max(0, ordered.length - RENDER_CAP)
      });
    },

    onToggle(e) {
      const id = e.currentTarget.dataset.id;
      const active = (this.data.active || []).slice();
      const i = active.indexOf(id);
      if (i === -1) active.push(id); else active.splice(i, 1);
      sfx.play('tap');
      this.setData({ active }, () => this._rebuild());
    },

    onAll() {
      sfx.play('tap');
      this.setData({ active: (this.data.clues || []).map(c => c.id) }, () => this._rebuild());
    },

    onNone() {
      sfx.play('tap');
      this.setData({ active: [] }, () => this._rebuild());
    },

    onClose() {
      sfx.play('close');
      this.triggerEvent('close');
    },

    onPick(e) {
      const item = this.data.list[Number(e.currentTarget.dataset.index)];
      if (!item) return;
      if ((this.properties.guessed || []).indexOf(item.id) !== -1) {
        wx.showToast({ title: '已经猜过 TA 了', icon: 'none' });
        return;
      }
      this.triggerEvent('select', { player: item });
      // 选中导致的关闭不播"收起"音：紧接着就是猜测结果音，叠在一起很吵
      this.triggerEvent('close', { silent: true });
    }
  }
});
