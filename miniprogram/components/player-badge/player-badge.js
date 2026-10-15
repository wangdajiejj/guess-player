/**
 * 程序化球员卡 —— 不用任何位图，纯 CSS 画。
 *
 * 为什么不用球员照片 / AI 人像：
 *   1. 真人形象踩肖像权，个人主体小程序风险高；
 *     主流 AI 工具（含 Soku 等）都刻意拒绝生成可识别的真实球员。
 *   2. 200 张图约 10MB 存储 + CDN 流量，加载慢、审核麻烦，还要求 AI 标识。
 *   3. 实际渲染尺寸只有 36~84px，照片细节根本看不清，性价比极低。
 *
 * 取而代之：队色渐变 + 球衣斜纹 + 姓氏首字 + 位置徽章。
 * 零存储、零加载、任意分辨率清晰、无版权风险。
 *
 * @property {Object} player  需含 primary_color / secondary_color / name_cn / position_group
 * @property {Number} size    边长（rpx），默认 72
 * @property {Boolean} circle 圆形裁切，默认 true
 * @property {Boolean} showMeta 大尺寸才用：显示位置徽章 + 国籍
 */
Component({
  properties: {
    player: { type: Object, value: null },
    size: { type: Number, value: 72 },
    circle: { type: Boolean, value: true },
    showMeta: { type: Boolean, value: false }
  },

  data: {
    bg: '',
    initial: '',
    posText: '',
    natText: '',
    radius: '50%',
    fontSize: 30
  },

  // 不依赖回调参数（多属性观察者按顺序传参，容易写错），统一读 properties
  observers: {
    'player, size, circle, showMeta': function () {
      this.rebuild(this.properties.player);
    }
  },

  lifetimes: {
    attached() { this.rebuild(this.properties.player); }
  },

  methods: {
    rebuild(p) {
      if (!p) return;
      const primary = p.primary_color || '#0C5C3B';
      const secondary = p.secondary_color || '#148053';

      // 姓氏首字：带「·」的名字取最后一段，否则取第一个字。
      // 利昂内尔·梅西 -> 梅（内地就是叫梅西），罗伯托·卡洛斯 -> 卡。
      // 取首段会得到「利」「罗」，反而是玩家不习惯的叫法。
      const cn = String(p.name_cn || '');
      const seg = cn.split('·');
      const last = (seg[seg.length - 1] || cn).trim();
      const initial = last.charAt(0) || cn.charAt(0) || '?';

      const size = this.properties.size;
      this.setData({
        bg: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
        initial,
        posText: p.position_group || '',
        natText: p.nationality || '',
        radius: this.properties.circle ? '50%' : '16rpx',
        fontSize: Math.round(size * 0.42)
      });
    }
  }
});
