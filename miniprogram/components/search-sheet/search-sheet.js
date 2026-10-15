const searchUtil = require('../../utils/search.js');

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer: '_onShow'
    },
    /** 全量候选池 */
    players: {
      type: Array,
      value: []
    },
    /** 已被猜过的 id 列表，置灰不可再选 */
    guessed: {
      type: Array,
      value: []
    }
  },

  data: {
    keyword: '',
    list: [],
    searched: false,
    focus: false
  },

  methods: {
    _onShow(v) {
      if (v) {
        this.setData({ focus: true }, () => {
          this._run(this.data.keyword);
        });
      } else {
        this.setData({ focus: false });
      }
    },

    noop() {},

    onInput(e) {
      const kw = e.detail.value;
      this.setData({ keyword: kw });
      this._run(kw);
    },

    onConfirm(e) {
      this._run(e.detail.value);
    },

    onClear() {
      this.setData({ keyword: '', searched: false });
      this._run('');
    },

    onClose() {
      this.setData({ keyword: '', list: [], searched: false });
      this.triggerEvent('close');
    },

    onPick(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const item = this.data.list[idx];
      if (!item) return;
      if (this.properties.guessed.indexOf(item.id) !== -1) {
        wx.showToast({ title: '已经猜过 TA 了', icon: 'none' });
        return;
      }
      this.triggerEvent('select', { player: item });
      // 选中导致的关闭不播"收起"音效：紧接着就会有猜测结果音，两个音叠在一起很吵
      this.triggerEvent('close', { silent: true });
      this.setData({ keyword: '', list: [], searched: false });
    },

    _run(kw) {
      const all = this.properties.players || [];
      const kwStr = String(kw || '').trim();

      let list;
      if (!kwStr) {
        // 未输入时展示全部，方便浏览
        list = all.slice(0, 50);
      } else {
        list = searchUtil.search(all, kwStr, 30);
      }

      // 已猜过的排到后面（服务端也会拦截，这里只是视觉优化）
      const guessed = this.properties.guessed || [];
      const fresh = list.filter(p => guessed.indexOf(p.id) === -1);
      const done = list.filter(p => guessed.indexOf(p.id) !== -1);

      // 首字交给 player-badge 组件算，这里不再装饰，省掉一次 500 条的对象复制
      this.setData({
        list: fresh.concat(done),
        searched: !!kwStr
      });
    }
  }
});
