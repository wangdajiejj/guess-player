# -*- coding: utf-8 -*-
"""
把 database/roster_{a,b,c,d}.py 的紧凑名册展开成可导入的 players.full.jsonl

    "C:/Users/wang/.workbuddy/binaries/python/envs/default/Scripts/python.exe" \
        scripts/build-players.py

自动补全这些字段，不需要在名册里手写：
  _id / position_group
  pinyin / initials / aliases(数组) / data_as_of / primary_color / secondary_color
  search_index 留空，交给 database/validate.py --fix 生成（保证与前端规则一致）
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'database'))

from pypinyin import pinyin, Style  # noqa: E402

import roster_a, roster_b, roster_c, roster_d  # noqa: E402
import roster_e, roster_f, roster_g  # noqa: E402
import roster_h  # noqa: E402  # 2026-10-25 扩充批（现役 12 + 退役传奇 36）

POSITION_GROUP = {
    '门将': 'GK',
    '中后卫': 'DF', '左后卫': 'DF', '右后卫': 'DF', '清道夫': 'DF',
    '后腰': 'MF', '中前卫': 'MF', '前腰': 'MF', '左边前卫': 'MF', '右边前卫': 'MF',
    '中锋': 'FW', '影锋': 'FW', '左边锋': 'FW', '右边锋': 'FW',
}

# 多音字修正：pypinyin 无声调模式下偶尔会在姓氏/译名上选错读音
PINYIN_OVERRIDE = {
    '单': 'shan', '解': 'xie', '曾': 'zeng', '查': 'zha',
    '盖': 'gai', '华': 'hua', '朴': 'piao', '覃': 'qin',
}

# 俱乐部配色（主色 / 副色）。副色用于头像降级时的渐变与卡片底色。
CLUB_COLORS = {
    '皇家马德里': ('#FEBE10', '#00529F'),
    '巴塞罗那': ('#A50044', '#004D98'),
    '马德里竞技': ('#CB3524', '#26282A'),
    '毕尔巴鄂竞技': ('#EE2523', '#000000'),
    '皇家社会': ('#0067B1', '#FFFFFF'),
    '塞维利亚': ('#D9042B', '#FFFFFF'),
    '瓦伦西亚': ('#F0B429', '#1A1A1A'),
    '比利亚雷亚尔': ('#FFE667', '#003F7F'),
    '贝蒂斯': ('#00954C', '#FFFFFF'),
    '赫罗纳': ('#E20613', '#FFFFFF'),
    '曼城': ('#6CABDD', '#1C2C5B'),
    '曼联': ('#DA291C', '#000000'),
    '利物浦': ('#C8102E', '#00B2A9'),
    '阿森纳': ('#EF0107', '#FFFFFF'),
    '切尔西': ('#034694', '#FFFFFF'),
    '托特纳姆热刺': ('#132257', '#FFFFFF'),
    '纽卡斯尔联': ('#241F20', '#FFFFFF'),
    '阿斯顿维拉': ('#95BFE5', '#670E36'),
    '西汉姆联': ('#7A263A', '#1BB1E7'),
    '布莱顿': ('#0057B8', '#FFCD00'),
    '水晶宫': ('#1B458F', '#C4122E'),
    '布伦特福德': ('#E30613', '#FFFFFF'),
    '诺丁汉森林': ('#DD0000', '#FFFFFF'),
    '狼队': ('#FDB913', '#231F20'),
    '埃弗顿': ('#003399', '#FFFFFF'),
    '富勒姆': ('#000000', '#CC0000'),
    '伯恩茅斯': ('#DA291C', '#000000'),
    '国际米兰': ('#0068A8', '#010E80'),
    'AC米兰': ('#FB090B', '#000000'),
    '尤文图斯': ('#000000', '#FFFFFF'),
    '那不勒斯': ('#12A0D7', '#003366'),
    '罗马': ('#8E1F2F', '#F8C300'),
    '拉齐奥': ('#87D8F7', '#191970'),
    '亚特兰大': ('#1C1C1C', '#00A0DE'),
    '佛罗伦萨': ('#592C82', '#FFFFFF'),
    '都灵': ('#8A1E03', '#FFFFFF'),
    '帕尔马': ('#FFD700', '#003F7F'),
    '博洛尼亚': ('#1A2F47', '#C4122E'),
    '拜仁慕尼黑': ('#DC052D', '#0066B2'),
    '多特蒙德': ('#FDE100', '#000000'),
    'RB莱比锡': ('#DD0741', '#001A36'),
    '勒沃库森': ('#E32219', '#000000'),
    '法兰克福': ('#E1000F', '#000000'),
    '斯图加特': ('#E32219', '#FFFFFF'),
    '弗赖堡': ('#E2001A', '#000000'),
    '霍芬海姆': ('#1C63B7', '#FFFFFF'),
    '巴黎圣日耳曼': ('#004170', '#DA291C'),
    '马赛': ('#2FAEE0', '#FFFFFF'),
    '摩纳哥': ('#E63946', '#FFFFFF'),
    '里尔': ('#D8001C', '#003399'),
    '里昂': ('#1C3A94', '#FFFFFF'),
    '加拉塔萨雷': ('#FDB912', '#B9022D'),
    '费内巴切': ('#003876', '#F9C100'),
    '埃因霍温': ('#EC1C24', '#FFFFFF'),
    '阿贾克斯': ('#D2122E', '#FFFFFF'),
    '本菲卡': ('#E4002B', '#000000'),
    '波尔图': ('#0033A0', '#FFFFFF'),
    '桑托斯': ('#000000', '#FFFFFF'),
    '利雅得胜利': ('#FFE600', '#0057B8'),
    '利雅得新月': ('#0057B8', '#FFFFFF'),
    '吉达联合': ('#F9C100', '#1A1A1A'),
    '迈阿密国际': ('#F7B5CD', '#000000'),
    '洛杉矶银河': ('#00245D', '#FFC72C'),
    # —— 第 5~7 批新增（退役传奇 / 边后卫·左脚 / 现役新星·联赛平衡）——
    '汉堡': ('#005CA9', '#FFFFFF'),
    '卡利亚里': ('#9E1B32', '#003876'),
    '桑普多利亚': ('#003B70', '#CC0000'),
    '拉科鲁尼亚': ('#005BAC', '#FFFFFF'),
    '皇家贝蒂斯': ('#00954C', '#FFFFFF'),
    '科莫': ('#0B4EA2', '#FFFFFF'),
    '葡萄牙体育': ('#008060', '#FFFFFF'),
    '弗拉门戈': ('#E2001A', '#111111'),
    '弗鲁米嫩塞': ('#7A2E3A', '#009639'),
    '科林蒂安': ('#0A0A0A', '#E8E8E8'),
    '帕尔梅拉斯': ('#006437', '#FFFFFF'),
    '圣保罗': ('#E30613', '#111111'),
    '博塔弗戈': ('#111111', '#DDDDDD'),
    '米内罗竞技': ('#0F0F0F', '#E8E8E8'),
    '博卡青年': ('#004B93', '#FFD500'),
    '横滨水手': ('#0033A0', '#E2001A'),
    'FC东京': ('#004098', '#E60012'),
    '浦项制铁': ('#1A1A1A', '#ED1C24'),
    # —— 2026-10-25 校准新增（莱万→芝加哥火焰、孙兴慜→洛杉矶FC、穆勒→温哥华白浪、
    #    弗拉霍维奇→贝西克塔斯、奥纳纳→特拉布宗体育）——
    '芝加哥火焰': ('#D0021B', '#01295F'),
    '洛杉矶FC': ('#000000', '#C39E6D'),
    '温哥华白浪': ('#00245D', '#86BCFF'),
    '贝西克塔斯': ('#000000', '#FFFFFF'),
    '特拉布宗体育': ('#6C1D45', '#5CB8E8'),
    # —— 2026-10-25 校准新增（马赫雷斯→吉达国民、莫拉塔→莱加内斯、努涅斯→迪里耶）——
    '吉达国民': ('#0B8043', '#FFFFFF'),
    '莱加内斯': ('#005CA9', '#FFFFFF'),
    '迪里耶': ('#245C40', '#C9A227'),
}
DEFAULT_COLOR = ('#0C5C3B', '#148053')



def to_pinyin(name_cn: str):
    """全名去掉间隔号，逐字取全拼与首字母。"""
    plain = name_cn.replace('·', '').replace(' ', '')
    chars = list(plain)
    full, init = [], []
    for ch in chars:
        if '\u4e00' <= ch <= '\u9fff':
            if ch in PINYIN_OVERRIDE:
                syl = PINYIN_OVERRIDE[ch]
            else:
                syl = pinyin(ch, style=Style.NORMAL, heteronym=False)[0][0]
            full.append(''.join(c for c in syl if c.isalpha()))
            init.append(syl[0])
        else:
            full.append(ch.lower())
            init.append(ch.lower())
    return ''.join(full), ''.join(init)


def build():
    rows = []
    for mod in (roster_a, roster_b, roster_c, roster_d,
                roster_e, roster_f, roster_g, roster_h):
        rows.extend(mod.ROWS)

    rows.sort(key=lambda r: r['id'])
    if len(rows) != len({r['id'] for r in rows}):
        dup = [i for i in {r['id'] for r in rows} if sum(1 for r in rows if r['id'] == i) > 1]
        raise SystemExit('id 重复：%s' % dup)

    out = []
    for r in rows:
        py, ini = to_pinyin(r['cn'])
        primary, secondary = CLUB_COLORS.get(r['club'], DEFAULT_COLOR)
        aliases = [a.strip() for a in r.get('al', '').split(',') if a.strip()]

        out.append({
            '_id': 'p%03d' % r['id'],
            'id': r['id'],
            'name_cn': r['cn'],
            'name_en': r['en'],
            'aliases': aliases,
            'nationality': r['nat'],
            'nationality_code': r['nc'],
            'club': r['club'],
            'club_en': r['ce'],
            'league': r['lg'],
            'position': r['pos'],
            'position_group': POSITION_GROUP[r['pos']],
            'birth_date': r['bd'],
            'height_cm': r['h'],
            'preferred_foot': r['ft'],
            'shirt_number': r['sn'],
            # 不使用任何球员照片 / AI 人像，头像由 player-badge 组件用队色 + 首字现画。
            # 理由见 miniprogram/components/player-badge/player-badge.js 顶部注释：
            # 真人形象踩肖像权（个人主体风险高），200 张图约 10MB 存储/CDN，
            # 且实际渲染只有 36~84px，照片细节根本看不清。
            'active': bool(r['act']),
            'fame_level': r['fame'],
            'pinyin': py,
            'initials': ini,
            'search_index': '',
            'intro': r['intro'],
            'fun_fact': r.get('fact', ''),
            'meme': r.get('meme', ''),
            'primary_color': primary,
            'secondary_color': secondary,
            'data_as_of': '2026-10-25'
        })

    path = os.path.join(ROOT, 'database', 'players.full.jsonl')
    with open(path, 'w', encoding='utf-8') as f:
        for o in out:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    print('已生成 %d 条 -> %s' % (len(out), path))
    print('  现役 %d / 退役 %d' % (sum(1 for o in out if o['active']),
                                  sum(1 for o in out if not o['active'])))
    print('  答案池(fame>=3) %d 人' % sum(1 for o in out if o['fame_level'] >= 3))
    missing = [c for c in {o['club'] for o in out} if c not in CLUB_COLORS]
    if missing:
        print('  [注意] 未配色的俱乐部（已用默认色）：%s' % '、'.join(sorted(missing)))


if __name__ == '__main__':
    build()
