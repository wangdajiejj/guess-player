# -*- coding: utf-8 -*-
"""只读对拍：roster_{a..g}.py（构建源）与 players.full.jsonl（已校准成品）逐字段一致。

排除字段：data_as_of（成品上 12 条已单独打成 2026-10-25）、
pinyin / initials / search_index（由脚本派生，validate.py 已守）。
"""
import io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'database'))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import roster_a, roster_b, roster_c, roster_d, roster_e, roster_f, roster_g, roster_h

rows = []
for mod in (roster_a, roster_b, roster_c, roster_d, roster_e, roster_f, roster_g, roster_h):
    rows.extend(mod.ROWS)

# 从 build-players.py 里取 CLUB_COLORS（只 exec 那一段，不执行 build()）
src = io.open(os.path.join(ROOT, 'scripts', 'build-players.py'), encoding='utf-8').read()
ns = {}
start = src.index('CLUB_COLORS = {')
end = src.index('DEFAULT_COLOR')
exec(src[start:end], ns)
CLUB_COLORS = ns['CLUB_COLORS']
DEFAULT_COLOR = ('#0C5C3B', '#148053')

built = {}
for r in rows:
    pr, se = CLUB_COLORS.get(r['club'], DEFAULT_COLOR)
    built['p%03d' % r['id']] = {
        'name_cn': r['cn'], 'name_en': r['en'],
        'club': r['club'], 'club_en': r['ce'], 'league': r['lg'],
        'position': r['pos'], 'birth_date': r['bd'], 'height_cm': r['h'],
        'preferred_foot': r['ft'], 'shirt_number': r['sn'],
        'fame_level': r['fame'], 'active': bool(r['act']),
        'intro': r['intro'], 'fun_fact': r.get('fact', ''),
        'meme': r.get('meme', ''),
        'primary_color': pr, 'secondary_color': se,
    }

path = os.path.join(ROOT, 'database', 'players.full.jsonl')
bad = 0
seen = set()
with io.open(path, encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        p = json.loads(line)
        seen.add(p['_id'])
        want = built.get(p['_id'])
        if want is None:
            print('[缺失] %s 在 roster 里找不到' % p['_id']); bad += 1; continue
        for k, v in want.items():
            got = p.get(k)
            if got != v and not (k == 'meme' and got in ('', None) and v == ''):
                print('[不一致] %s(%s) %s: roster=%r jsonl=%r' % (p['_id'], p.get('name_cn'), k, v, got))
                bad += 1

missing = set(built) - seen
for mid in sorted(missing):
    print('[缺失] %s 在 jsonl 里找不到（roster 有、成品没有）' % mid); bad += 1

print('roster=%d 条, jsonl=%d 条, 不一致 %d 处' % (len(rows), len(seen), bad))
sys.exit(1 if bad else 0)
