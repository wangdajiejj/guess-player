const theme = require('../../utils/theme.js');

Component({
  properties: {
    row: {
      type: Object,
      value: null,
      observer: '_onRow'
    },
    /** 对局进行中时标签可点：点了就按这条线索筛候选池 */
    tappable: {
      type: Boolean,
      value: false
    }
  },

  data: {
    chips: [],
    allGreen: false,
    player: {}
  },

  methods: {
    _onRow(row) {
      if (!row) return;
      this.setData({
        chips: theme.toChips(row.verdict),
        allGreen: theme.isAllGreen(row.verdict),
        player: row.player || {}
      });
    },

    onChip(e) {
      if (!this.properties.tappable) return;
      const key = e.currentTarget.dataset.key;
      if (!key) return;
      this.triggerEvent('clue', { key, round: this.properties.row && this.properties.row.round });
    }
  }
});
