/**
 * 战绩分享图（Canvas 2d）
 *
 * 尺寸 1080x864 = 5:4，正好符合朋友圈封面推荐比例，
 * 同时也用于"发送给朋友"封面和保存到相册。
 *
 * ⚠️ 不泄露答案：只画形容词色块，不画球员姓名、头像、俱乐部。
 */
const theme = require('./theme.js');

const W = 1080;
const H = 864;

/**
 * @param {Object} canvasNode  wx.createSelectorQuery 取到的 canvas node
 * @param {Object} opts
 *    mode      'daily' | 'endless'
 *    status    'won' | 'lost'
 *    used      已用次数
 *    max       总次数
 *    rows      [{verdict}]
 *    dateKey   日期
 * @returns {Promise<String>} 本地临时文件路径
 */
function draw(canvasNode, opts) {
  const ctx = canvasNode.getContext('2d');
  const dpr = (wx.getSystemInfoSync().pixelRatio || 2);

  canvasNode.width = W * dpr;
  canvasNode.height = H * dpr;
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = '#0c5c3b';
  ctx.fillRect(0, 0, W, H);

  // 内卡片
  roundRect(ctx, 40, 40, W - 80, H - 80, 28, '#ffffff');

  // 标题
  ctx.fillStyle = '#1f2421';
  ctx.font = '500 56px -apple-system, "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('猜球员', W / 2, 150);

  // 副标题
  const isDaily = opts.mode === 'daily';
  const sub = isDaily ? `每日一题 · ${opts.dateKey || ''}` : '自由练习';
  ctx.fillStyle = '#6b726e';
  ctx.font = '400 28px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(sub, W / 2, 196);

  // 成绩
  const won = opts.status === 'won';
  ctx.fillStyle = won ? '#3d7a3a' : '#8a7a26';
  ctx.font = '500 76px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(won ? `${opts.used}/${opts.max}` : `X/${opts.max}`, W / 2, 300);

  ctx.fillStyle = '#9aa09c';
  ctx.font = '400 26px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(won ? '猜中了' : '这次没猜到', W / 2, 342);

  // 色块网格
  const rows = opts.rows || [];
  const cols = theme.CLUE_META.length; // 8
  const maxRows = opts.max || 8;
  const cell = 76;
  const gap = 14;
  const gridW = cols * cell + (cols - 1) * gap;
  const gridH = maxRows * cell + (maxRows - 1) * gap;
  const startX = (W - gridW) / 2;
  const startY = 400;

  for (let r = 0; r < maxRows; r++) {
    const rowData = rows[r];
    const colors = rowData ? theme.gridColors(rowData.verdict) : null;
    for (let c = 0; c < cols; c++) {
      const x = startX + c * (cell + gap);
      const y = startY + r * (cell + gap);
      if (colors) {
        ctx.fillStyle = colors[c];
      } else {
        ctx.fillStyle = '#e9ebe9'; // 未使用的次数
      }
      roundRect(ctx, x, y, cell, cell, 12, ctx.fillStyle);
    }
  }

  // 底部声明（形象为程序绘制，非照片/肖像）
  ctx.fillStyle = '#9aa09c';
  ctx.font = '400 22px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('小头像由球队配色现场绘制，非照片或肖像', W / 2, H - 108);
  ctx.fillText('不含队徽与赞助商标识', W / 2, H - 76);

  // 导出
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: canvasNode,
      x: 0, y: 0, width: W, height: H,
      destWidth: W * dpr, destHeight: H * dpr,
      fileType: 'jpg',
      quality: 0.92,
      success: res => resolve(res.tempFilePath),
      fail: reject
    });
  });
}

function roundRect(ctx, x, y, w, h, r, color) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

module.exports = { draw, W, H };
