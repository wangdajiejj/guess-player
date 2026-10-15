# -*- coding: utf-8 -*-
"""
把用户提供的图片裁成微信后台要求的小程序头像（144x144）。

⚠️ 合规提醒（重要，先读再决定用不用）：
   本脚本处理的是**外部提供的位图**，与项目「零素材、程序绘制」的对外表述不同。
   如果用这张图当小程序头像，就等于官方门面上有了一张第三方/AI 生成的写实图。
   这张图里没有真人、没有队徽、没有赞助商标识、没有球衣号 —— 这点是干净的，
   但 _mock-backup / docs 里那句「小头像由球队配色现场绘制，非照片或肖像」
   说的是**App 内的球员头像**，两者不冲突；只是提审材料里别把话说太满。
   （详见 docs/05-deployment.md §7.3 的表述口径）

裁剪策略：
   原图 1242x1172（比例 1.060），不是正方形，直接压成 144x144 会把主体压扁。
   所以先按「内容重心」裁正方 —— 主体（发光大脑 + 足球）在画面中央偏下，
   取竖直中心稍偏下位置裁，确保足球和大脑都完整入画，再缩到 144。

   微信头像在列表里是**圆形**展示，圆形会切掉四个角。
   所以裁完后要检查四角没有关键内容（本例四角是草地和灯，安全）。

用法：
    python scripts/gen-logo-photo.py <原图路径>
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, 'assets', 'logo')

SS = 4          # 先放大到 576 再缩回 144，等于超采样抗锯齿
TARGET = 144
YUAN_HINT = 0.56   # 竖直方向的裁剪中心（0=顶 1=底），实测 0.56 时主体居中最好


def square_crop(im, cy_hint=YUAN_HINT):
    """按给定竖直重心裁出最大内接正方形"""
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = int(h * cy_hint - side / 2)
    top = max(0, min(h - side, top))
    return im.crop((left, top, left + side, top + side))


def build(src):
    im = Image.open(src).convert('RGB')
    print('  原图 %dx%d  比例 %.3f' % (im.size[0], im.size[1], im.size[0] / im.size[1]))

    sq = square_crop(im)
    print('  裁剪后 %dx%d（正方形）' % sq.size)

    big = sq.resize((TARGET * SS, TARGET * SS), Image.LANCZOS)

    os.makedirs(OUT_DIR, exist_ok=True)

    # 1) 方形版：微信后台里"头像预览"左侧那个方块
    square = big.resize((TARGET, TARGET), Image.LANCZOS)
    p1 = os.path.join(OUT_DIR, 'logo-photo-144.png')
    square.save(p1, 'PNG', optimize=True)
    print('  ✓ %s  %.1f KB' % (os.path.basename(p1), os.path.getsize(p1) / 1024))

    # 2) 圆形版：预览右侧那个圆。自带 alpha，万一后台也需要圆图
    #    ⚠️ 遮罩要在**最终尺寸**上画，不能在放大画布上画完再缩 ——
    #    缩的时候边缘会重采样，圆外那一圈半透明像素会显成黑边。
    mask_small = Image.new('L', (TARGET * 4, TARGET * 4), 0)
    ImageDraw.Draw(mask_small).ellipse(
        [0, 0, TARGET * 4 - 1, TARGET * 4 - 1], fill=255)
    mask_small = mask_small.resize((TARGET, TARGET), Image.LANCZOS)

    circle = big.resize((TARGET, TARGET), Image.LANCZOS)
    # 把圆外像素直接刷成同色，避免透明边缘在深色底上显黑边
    bg = Image.new('RGB', (TARGET, TARGET), (246, 248, 247))
    circle = Image.composite(circle, bg, mask_small.point(lambda v: 255 if v > 128 else 0))
    circle.putalpha(mask_small)
    p2 = os.path.join(OUT_DIR, 'logo-photo-144-circle.png')
    circle.save(p2, 'PNG', optimize=True)
    print('  ✓ %s  %.1f KB' % (os.path.basename(p2), os.path.getsize(p2) / 1024))

    # 3) 大图备用
    p3 = os.path.join(OUT_DIR, 'logo-photo-512.png')
    big.resize((512, 512), Image.LANCZOS).save(p3, 'PNG', optimize=True)
    print('  ✓ %s  %.1f KB' % (os.path.basename(p3), os.path.getsize(p3) / 1024))

    # 4) 圆形裁切预览：模拟微信列表里那个圆，检查四角会不会切掉东西
    prev = Image.new('RGB', (TARGET * 2 + 60, TARGET + 40), (246, 248, 247))
    prev.paste(square, (20, 20))
    prev.paste(circle.convert('RGB'), (TARGET + 40, 20))
    p4 = os.path.join(OUT_DIR, '_photo-preview.png')
    prev.resize((prev.width * 2, prev.height * 2), Image.NEAREST).save(p4)
    print('  ✓ %s（左=方形 右=圆形）' % os.path.basename(p4))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python scripts/gen-logo-photo.py <原图路径>')
        sys.exit(1)
    print('转换头像图 ...')
    build(sys.argv[1])
    print('完成。上传 assets/logo/logo-photo-144.png')
