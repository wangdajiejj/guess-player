# -*- coding: utf-8 -*-
"""
生成 miniprogram/utils/mock-players.js —— 本地 Mock 模式用的球员数据。

用法：
    python scripts/gen-mock-data.py

只挑 Mock 真正用得上的字段（比对要看的 + 结果页要显示的），
丢掉 club_en / nationality_code 等装饰字段，压一压体积。
生成后记得看一眼终端输出的体积。
"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'database', 'players.full.jsonl')
OUT = os.path.join(ROOT, 'miniprogram', 'utils', 'mock-players.js')

KEEP = [
    'id', 'name_cn', 'name_en', 'aliases',
    'nationality', 'club', 'league', 'position', 'position_group',
    'birth_date', 'height_cm', 'preferred_foot', 'shirt_number',
    'active', 'fame_level', 'pinyin', 'initials',
    'primary_color', 'secondary_color',
    'intro', 'fun_fact', 'meme'
]


def main():
    rows = [json.loads(l) for l in open(DATA, encoding='utf-8') if l.strip()]
    slim = [{k: p[k] for k in KEEP} for p in rows]

    body = json.dumps(slim, ensure_ascii=False, separators=(',', ':'))
    out = (
        '/**\n'
        ' * 本地 Mock 模式的球员数据 —— 由 scripts/gen-mock-data.py 从\n'
        ' * database/players.full.jsonl 自动生成，禁止手改（改数据后重跑该脚本）。\n'
        ' *\n'
        ' * 体积约 %d KB，随主包打包。正式上线用云_database 拉同一个数据源，\n'
        ' * 这份副本不参与。（想彻底移除 Mock，见 README-启动.md §4）\n'
        ' */\n'
        'module.exports = %s;\n'
    ) % (len(body.encode('utf-8')) // 1024, body)

    io.open(OUT, 'w', encoding='utf-8').write(out)
    print('已生成 %s' % OUT)
    print('  %d 条，%d KB' % (len(slim), len(body.encode('utf-8')) // 1024))


if __name__ == '__main__':
    main()
