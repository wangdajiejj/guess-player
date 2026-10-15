# -*- coding: utf-8 -*-
"""
生成小程序头像 —— 多套配色，一次全出，挑一个上传。

设计约束（三条都是合规要求，别改）：
  1. 不放任何球员照片/球迷素材 —— 肖像权与版权风险，一放就进审查
  2. 不放队徽、赞助商标识、真实球衣号码 —— 与「程序绘制」的对外表述保持一致
  3. 纯几何图形 —— 零素材、零版权

图案演进记录（别走回头路）：
  · 完整足球（20 个六边形蜂窝 + 6 个五边形）：512px 好看，**144px 缝线糊成一团** → 弃
  · 简化足球第一版：10 条射线 → **像太阳**，不是球 → 弃
  · 现在的画法：中央五边形 + 5 条缝线 + 一圈外弧把缝线收住 = 认得出是足球
    关键参数是 stop_r = ball_r * 0.86，缝线不顶到球缘才成立

性能：渐变底先在 160px 上算好再放大（平滑渐变放大无损观感），
      球体在超采样画布上直接画矢量。Pillow 没内建抗锯齿，靠 SS=8 超采样。

用法：
    python scripts/gen-logo.py              # 生成全部配色 + 对比拼图
    python scripts/gen-logo.py --only green # 只生成某一套
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, 'assets', 'logo')

SS = 8            # 超采样倍数
SIZE = 144 * SS
CORE = (20, 26, 23)   # 五边形填充：近黑，比纯黑柔和

# name, 显示名, 图案, 亮端, 暗端
# 图案 motif：ball = 简化足球 / pitch = 球场中线 / star = 五角星 / target = 靶心
#          chevron = 人字纹 / orbit = 轨道环
PALETTES = [
    ('green',   '绿茵场', 'ball',    ( 40, 210, 110), (  3,  92,  52)),
    ('sunset',  '日落',   'ball',    (255, 150,  60), (224,  40, 105)),
    ('ocean',   '海洋',   'pitch',   ( 60, 220, 240), ( 30,  80, 230)),
    ('grape',   '葡萄',   'star',    (180, 110, 255), ( 62,  40, 200)),
    ('flare',   '焰火',   'target',  (255, 205,  60), (240,  55,  70)),
    ('mint',    '薄荷',   'ball',    (110, 240, 190), ( 10, 150, 220)),
    ('lemon',   '柠檬',   'orbit',   (170, 240,  70), ( 20, 150,  70)),
    ('coral',   '珊瑚',   'chevron', (255, 130, 140), (200,  40, 110)),
]


def gradient(size, light, dark):
    """径向渐变：中心亮、边缘暗。小图算完再放大，避免逐像素跑满 1152²"""
    small = 160
    g = Image.new('RGB', (small, small))
    px = g.load()
    c = small / 2
    max_d = math.hypot(c, c)
    for y in range(small):
        for x in range(small):
            t = min(1.0, math.hypot(x - c, y - c) / max_d)
            px[x, y] = tuple(round(light[i] + (dark[i] - light[i]) * t) for i in range(3))
    return g.resize((size, size), Image.BICUBIC)


def pentagon(cx, cy, r, rot=-90):
    return [(cx + r * math.cos(math.radians(72 * i + rot)),
             cy + r * math.sin(math.radians(72 * i + rot))) for i in range(5)]


def gloss_layer(center, r):
    """左上角柔光。所有图案共用，让白色部分不至于死板"""
    g = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    gx, gy = center
    gr = r * 0.55
    gd.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=(255, 255, 255, 52))
    return g.filter(ImageFilter.GaussianBlur(SS * 6))


def motif_ball(d, c, r, seam):
    """简化足球：中央五边形 + 5 条缝线 + 外圈弧。
    别改成 10 条射线 —— 那会像太阳；也别把缝线画到球缘（stop_r 0.86 是关键）"""
    cx, cy = c
    core = pentagon(cx, cy, r * 0.40)
    stop_r = r * 0.86
    for (vx, vy) in core:
        dx, dy = vx - cx, vy - cy
        L = math.hypot(dx, dy)
        d.line([(vx, vy), (cx + dx / L * stop_r, cy + dy / L * stop_r)],
               fill=seam + (255,), width=int(SS * 2.4))
    d.ellipse([cx - stop_r, cy - stop_r, cx + stop_r, cy + stop_r],
              outline=seam + (255,), width=int(SS * 2.0))
    d.polygon(core, fill=CORE + (255,))


def motif_pitch(d, c, r, seam):
    """球场俯视：白色圆底 + 中线 + 中圈 + 上下禁区。
    注意别用椭圆当外框 —— 那样像灯笼。这里用"白色圆 + 内接矩形边线"，
    上下边线画成直线段，整体才是个球场。"""
    cx, cy = c
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    w = int(SS * 2.6)
    hw, hh = r * 0.72, r * 0.62          # 球场矩形半宽 / 半高
    d.rectangle([cx - hw, cy - hh, cx + hw, cy + hh],
                outline=seam + (255,), width=w)
    d.line([(cx - hw, cy), (cx + hw, cy)], fill=seam + (255,), width=w)
    cr = r * 0.24
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], outline=seam + (255,), width=w)
    d.ellipse([cx - r * 0.05, cy - r * 0.05, cx + r * 0.05, cy + r * 0.05],
              fill=seam + (255,))
    bw, bh = hw * 0.46, hh * 0.30
    d.rectangle([cx - bw, cy - hh, cx + bw, cy - hh + bh],
                outline=seam + (255,), width=w)
    d.rectangle([cx - bw, cy + hh - bh, cx + bw, cy + hh],
                outline=seam + (255,), width=w)


def motif_star(d, c, r, seam):
    """圆底 + 实心五角星：最直给的"醒目"方案"""
    cx, cy = c
    d.ellipse([cx - r * 0.92, cy - r * 0.92, cx + r * 0.92, cy + r * 0.92],
              fill=(255, 255, 255, 255))
    pts = []
    for i in range(10):
        ang = math.radians(36 * i - 90)
        rad = r * 0.72 if i % 2 == 0 else r * 0.30
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    d.polygon(pts, fill=seam + (255,))


def motif_target(d, c, r, seam):
    """同心靶环 + 中心实心点"""
    cx, cy = c
    d.ellipse([cx - r * 0.92, cy - r * 0.92, cx + r * 0.92, cy + r * 0.92],
              fill=(255, 255, 255, 255))
    for frac, w in ((0.74, 2.6), (0.52, 2.4)):
        rr = r * frac
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  outline=seam + (255,), width=int(SS * w))
    cr = r * 0.30
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=seam + (255,))


def motif_orbit(d, c, r, seam):
    """倾斜轨道环 + 中央实心球：速度感。
    坑：这里**不能**依赖返回的覆盖层 —— 它是纯白实心圆，
    叠上去会把轨道整圈盖住（第一版就是这样，环全没了）。
    轨道直接画进 d，返回值只留给"叠在轨道之上"的部分用。"""
    cx, cy = c
    ring = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    for rad, w in ((0.92, 2.6), (0.62, 2.2)):
        rr = r * rad
        rd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                   outline=seam + (255,), width=int(SS * w))
    ring = ring.rotate(24, center=(cx, cy), resample=Image.BICUBIC)
    d.bitmap((0, 0), ring.split()[3], fill=seam + (255,))

    core = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(core).ellipse(
        [cx - r * 0.34, cy - r * 0.34, cx + r * 0.34, cy + r * 0.34],
        fill=(255, 255, 255, 255))
    return core


def motif_chevron(d, c, r, seam):
    """三条人字纹：动势强，小尺寸也认得出"""
    cx, cy = c
    w = int(SS * 4.2)
    for i, off in enumerate((-1, 0, 1)):
        y = cy + off * r * 0.40
        h = r * 0.26
        d.line([(cx - r * 0.66, y + h), (cx, y - h)], fill=seam + (255,), width=w)
        d.line([(cx, y - h), (cx + r * 0.66, y + h)], fill=seam + (255,), width=w)


MOTIFS = {
    'ball': (motif_ball, False),
    'pitch': (motif_pitch, True),
    'star': (motif_star, False),
    'target': (motif_target, False),
    'orbit': (motif_orbit, True),
    'chevron': (motif_chevron, True),
}


def build(light, dark, motif='ball'):
    cx = cy = SIZE / 2
    base = gradient(SIZE, light, dark).convert('RGBA')
    seam = dark
    r = SIZE * 0.36

    fn, uses_draw = MOTIFS.get(motif, MOTIFS['ball'])
    layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    extra = fn(ImageDraw.Draw(layer), (cx, cy), r, seam)
    if extra is not None:
        layer = Image.alpha_composite(layer, extra)
    if not uses_draw:
        layer = Image.alpha_composite(layer, gloss_layer(
            (cx - r * 0.38, cy - r * 0.42), r))

    return Image.alpha_composite(base, layer)


def contact_sheet(items, cell=144, cols=4, pad=28, scale=2):
    rows = math.ceil(len(items) / cols)
    W = cols * cell + (cols + 1) * pad
    H = rows * cell + (rows + 1) * pad
    sheet = Image.new('RGB', (W, H), (246, 248, 247))
    for i, img in enumerate(items):
        r, c = divmod(i, cols)
        sheet.paste(img.convert('RGB'), (pad + c * (cell + pad), pad + r * (cell + pad)))
    return sheet.resize((W * scale, H * scale), Image.NEAREST)


def main():
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]

    os.makedirs(OUT_DIR, exist_ok=True)
    print('生成小程序头像（%s）...\n' % (only or '全部配色'))

    thumbs = []
    for key, cn, motif, light, dark in PALETTES:
        if only and key != only:
            continue
        img = build(light, dark, motif)
        p144 = os.path.join(OUT_DIR, 'logo-%s-144.png' % key)
        p512 = os.path.join(OUT_DIR, 'logo-%s-512.png' % key)
        img.resize((144, 144), Image.LANCZOS).save(p144, 'PNG', optimize=True)
        img.resize((512, 512), Image.LANCZOS).save(p512, 'PNG', optimize=True)
        thumbs.append(img.resize((144, 144), Image.LANCZOS))
        print('  %-8s %-6s %-8s 144: %5.1f KB   512: %5.1f KB'
              % (key, cn, motif, os.path.getsize(p144) / 1024,
                 os.path.getsize(p512) / 1024))

    sheet = contact_sheet(thumbs)
    sp = os.path.join(OUT_DIR, '_all-colors.png')
    sheet.save(sp, 'PNG')
    print('\n  对比拼图: %s' % sp)
    print('完成。挑一个把对应的 logo-<名字>-144.png 传上去。')


if __name__ == '__main__':
    main()
