# -*- coding: utf-8 -*-
"""
⚠️ 本脚本随「AI 出图方案」一起停用（2026-10-11），保留备用。
头像已改为程序化绘制（见 miniprogram/components/player-badge/），
数据库不再有 photo_status / photo_age 字段 —— 若真要恢复出图，
需先在 build-players.py 里把这两个字段加回来。

--- 以下为原说明 ---

生成 200 名球员的 AI 出图 prompt。

用法：
    python scripts/gen-prompts.py                 # 生成全部 200 条 -> assets/prompts.txt
    python scripts/gen-prompts.py --id 1 2 3      # 只生成指定 id
    python scripts/gen-prompts.py --todo          # 只生成 photo_status != done 的

产物 assets/prompts.txt 是给人（或批量脚本）照着批量出图用的，
不是给程序消费的 —— 最终图要人工过目，确认「一眼认得出」且没有队徽/号码。

⚠️ 硬性禁止项见 assets/ai-photo-prompt.md §5（队徽 / 赞助商 / 球衣号 / 写实照片）。
   球衣号尤其不能出现：号码是游戏线索，图上剧透等于毁掉一道题。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'database', 'players.full.jsonl')
OUT = os.path.join(ROOT, 'assets', 'prompts.txt')

TEMPLATE = """A stylized semi-realistic sports illustration portrait of a professional \
footballer resembling {name_en}, {nationality}, {age} years old, upper-body headshot, \
three-quarter view, calm confident expression, looking at camera, \
wearing a plain {primary} football jersey with {secondary} collar, \
clean flat blurred stadium background, soft rim lighting on shoulders, \
painterly brush texture, vibrant saturated colors, editorial sports poster style, \
centered composition, square framing headroom, high detail face"""

NEGATIVE = ("NEGATIVE: no text, no letters, no numbers, no jersey number, no club crest, "
            "no sponsor logo, no badge, no watermark, no signature, no tattoo, "
            "no real photo look, no distorted hands, no extra limbs, no cropped head")


# 国籍必须写英文：混中文进英文 prompt 会让模型把它当噪声词处理。
NAT_EN = {
    '丹麦': 'Danish', '乌克兰': 'Ukrainian', '乌拉圭': 'Uruguayan',
    '克罗地亚': 'Croatian', '几内亚': 'Guinean', '加拿大': 'Canadian',
    '加纳': 'Ghanaian', '厄瓜多尔': 'Ecuadorian', '哥伦比亚': 'Colombian',
    '喀麦隆': 'Cameroonian', '土耳其': 'Turkish', '埃及': 'Egyptian',
    '塞内加尔': 'Senegalese', '塞尔维亚': 'Serbian', '奥地利': 'Austrian',
    '威尔士': 'Welsh', '尼日利亚': 'Nigerian', '巴西': 'Brazilian',
    '德国': 'German', '意大利': 'Italian', '挪威': 'Norwegian',
    '捷克': 'Czech', '摩洛哥': 'Moroccan', '斯洛文尼亚': 'Slovenian',
    '新西兰': 'New Zealander', '日本': 'Japanese', '比利时': 'Belgian',
    '法国': 'French', '波兰': 'Polish', '波黑': 'Bosnian',
    '瑞典': 'Swedish', '瑞士': 'Swiss', '科特迪瓦': 'Ivorian',
    '美国': 'American', '苏格兰': 'Scottish', '英格兰': 'English',
    '荷兰': 'Dutch', '葡萄牙': 'Portuguese', '西班牙': 'Spanish',
    '阿根廷': 'Argentine', '韩国': 'South Korean',
}

# 少数俱乐部的 primary_color 为了 UI 可读性选了深色（白字要看得清），
# 但拿去当"球衣颜色"会误导（皇马被画成金黄球衣，像巴西队）。
# 球衣颜色不是游戏线索，这里只求不穿帮，所以单独覆盖。
JERSEY_OVERRIDE = {
    '皇家马德里': 'white',
    '利雅得胜利': 'yellow',      # 主色被取成蓝色，实际是黄
    '利雅得新月': 'blue',
}


def hex_to_name(h):
    """把 #F7B5CD 转成 'light pink' 之类的自然语言，比十六进制更好使。"""
    r, g, b = int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn < 25:
        return 'white' if mx > 200 else ('black' if mx < 60 else 'grey')
    if r == mx:
        return 'red' if g < 100 and b < 100 else ('orange' if g < 170 else 'yellow')
    if g == mx:
        return 'green' if b < 150 else 'teal'
    return 'blue' if r < 120 else 'purple'


def build_prompt(p):
    nat = NAT_EN.get(p['nationality'], 'European')
    jersey = JERSEY_OVERRIDE.get(p['club']) or hex_to_name(p['primary_color'])
    collar = hex_to_name(p['secondary_color'])
    if collar == jersey:
        collar = 'contrasting'          # 同色时别写 "blue jersey with blue collar"
    return TEMPLATE.format(
        name_en=p['name_en'],
        nationality=nat,
        age=p.get('photo_age') or 28,
        primary=jersey,
        secondary=collar,
    ) + '\n\n' + NEGATIVE


def main():
    args = sys.argv[1:]
    players = [json.loads(l) for l in open(DATA, encoding='utf-8') if l.strip()]

    if '--todo' in args:
        players = [p for p in players if p.get('photo_status') != 'done']
        args.remove('--todo')
    if '--id' in args:
        i = args.index('--id')
        want = set()
        for x in args[i + 1:]:
            if x.isdigit():
                want.add(int(x))
            else:
                break
        players = [p for p in players if p['id'] in want]

    lines = [
        '# ⚠️ 本文件已停用（2026-10-11）：AI 出图方案取消，',
        '#    头像改为程序化绘制（miniprogram/components/player-badge/）。',
        '#    保留仅作备用 —— 若恢复出图，需先给数据加回 photo_age 字段。',
        '#',
        '# 参数：4:5 竖版，768x960 出图 -> 压到 512x640 WebP <= 50KB',
        '# 每张出图后必须人工过目：认得出 + 无队徽 + 无号码 + 无赞助商',
        '# 退役球员的 age 已固定为 28（巅峰期），不要用真实年龄',
        '',
    ]
    for p in players:
        lines.append('=' * 70)
        lines.append('### %s  %s（%s / %s / %s）  年龄 %s  %s 球衣+%s 领'
                     % (p['_id'], p['name_cn'], p['name_en'], p['club'],
                        p['league'], p.get('photo_age') or 28,
                        JERSEY_OVERRIDE.get(p['club']) or hex_to_name(p['primary_color']),
                        hex_to_name(p['secondary_color'])))
        lines.append('')
        lines.append(build_prompt(p))
        lines.append('')

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('已生成 %d 条 prompt -> %s' % (len(players), OUT))


if __name__ == '__main__':
    main()
