# -*- coding: utf-8 -*-
"""
题库体检 —— 分布总览 + 可疑项清单。

用法：
    python scripts/audit-data.py                 # 用 jsonl 里的 data_as_of 作基准日
    python scripts/audit-data.py 2026-10-11      # 指定基准日（年龄按它算）
    python scripts/audit-data.py --top=20        # 分布榜显示前 20（默认 12）

和 validate.py 的分工：
    validate.py   管「字段合不合法」—— 译名、位置枚举、search_index、必填项。
                  它是阻断式的：不合格就不许导入。
    audit-data.py 管「数据好不好用」—— 分布是否失衡、有没有逻辑死题、
                   哪些条最可能因转会而漂移。它是**信息性的**，只报不改。

为什么需要第二个：字段全合法 ≠ 游戏可玩。举个例子，
两个球员在 8 条线索上取值完全相同，validate 一条都抓不到，
但玩家永远无法区分他们 —— 这是逻辑层面的死题，只能靠跨记录的比对发现。

退出码：0 = 无逻辑死题；1 = 存在「8 项线索完全相同」的组（必须改）。
       「待核」类不影响退出码 —— 那些是要人去查转会窗的，不是程序能判的错。
"""
import collections
import datetime
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'database', 'players.full.jsonl')

# 8 条线索字段 —— 与 cloudfunctions/_shared/constants.js 的 CLUE_ORDER 一致
CLUE = ('nationality', 'club', 'league', 'position',
        'age', 'height_cm', 'shirt_number', 'preferred_foot')

# 转会 / 号码漂移最快的联赛：这些联赛的中国区信息源滞后，校准时优先看这里
DRIFTY = ('土超', '沙特联', '美职联', '巴甲', '阿甲', '日职联', '韩K联')


def load(path):
    return [json.loads(l) for l in io.open(path, encoding='utf-8') if l.strip()]


def calc_age(birth_date, ref):
    y, m, d = (int(x) for x in birth_date.split('-'))
    return ref.year - y - ((ref.month, ref.day) < (m, d))


def bar(n, total, width=28):
    """纯 ASCII 条形图，避开 Windows 控制台的编码坑"""
    k = int(round(n * width / total)) if total else 0
    return '#' * max(k, 1 if n else 0)


def dist(title, counter, top, total=None):
    total = total or sum(counter.values())
    print('\n-- %s（共 %d 种）' % (title, len(counter)))
    for k, v in counter.most_common(top):
        pct = v * 100.0 / total if total else 0
        print('   %-14s %4d  %5.1f%%  %s' % (k, v, pct, bar(v, total)))
    if len(counter) > top:
        rest = sum(v for _, v in counter.most_common()[top:])
        print('   %-14s %4d  %5.1f%%   （其余 %d 种）'
              % ('...', rest, rest * 100.0 / total, len(counter) - top))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    top = 12
    for a in sys.argv[1:]:
        if a.startswith('--top='):
            top = int(a.split('=')[1])

    rows = load(DATA)
    ref = (datetime.date(*(int(x) for x in args[0].split('-')))
           if args else
           datetime.date(*(int(x) for x in rows[0]['data_as_of'].split('-'))))
    for r in rows:
        r['age'] = calc_age(r['birth_date'], ref)

    n = len(rows)
    act = [r for r in rows if r['active']]
    ret = [r for r in rows if not r['active']]

    print('=' * 58)
    print('题库体检   %s' % os.path.basename(DATA))
    print('基准日 %s（年龄按此日算周岁）' % ref)
    print('=' * 58)

    print('\n== 1. 总量与分档 ==')
    print('   总人数        %d' % n)
    print('   现役 / 退役   %d / %d' % (len(act), len(ret)))
    for lv in (5, 4, 3):
        c = len([r for r in rows if r['fame_level'] >= lv])
        a = len([r for r in rows if r['fame_level'] >= lv and r['active']])
        print('   知名度 >= %d    %3d 人进答案池（其中现役 %d）' % (lv, c, a))
    print('   每日一题池    %d 人（fame>=4，MIN_FAME_DAILY）'
          % len([r for r in rows if r['fame_level'] >= 4]))
    print('   自由练习池    %d 人（fame>=3，MIN_FAME）'
          % len([r for r in rows if r['fame_level'] >= 3]))

    print('\n== 2. 分布 ==')
    dist('细分位置', collections.Counter(r['position'] for r in rows), top, n)
    dist('位置大类', collections.Counter(r['position_group'] for r in rows), 4, n)
    dist('惯用脚', collections.Counter(r['preferred_foot'] for r in rows), 3, n)
    dist('联赛', collections.Counter(r['league'] for r in rows), top, n)
    dist('国籍', collections.Counter(r['nationality'] for r in rows), top, n)
    dist('俱乐部', collections.Counter(r['club'] for r in rows), top, n)
    dist('出生年代', collections.Counter('%ds' % (int(r['birth_date'][:4]) // 10 * 10)
                                         for r in rows), 10, n)
    dist('年龄段', collections.Counter('%d-%d' % (r['age'] // 5 * 5, r['age'] // 5 * 5 + 4)
                                       for r in rows), 8, n)

    ages = sorted(r['age'] for r in rows)
    hs = sorted(r['height_cm'] for r in rows)
    print('\n   年龄   %d ~ %d 岁，中位 %d' % (ages[0], ages[-1], ages[len(ages) // 2]))
    print('   身高   %d ~ %d cm，中位 %d' % (hs[0], hs[-1], hs[len(hs) // 2]))
    print('   俱乐部 %d 家，国籍 %d 个，联赛 %d 个'
          % (len(set(r['club'] for r in rows)),
             len(set(r['nationality'] for r in rows)),
             len(set(r['league'] for r in rows))))

    print('\n== 3. 可疑项 ==')

    # 3.1 逻辑死题：8 条线索取值完全相同 -> 玩家永远无法区分
    grp = collections.defaultdict(list)
    for r in rows:
        grp[tuple(r[f] for f in CLUE)].append(r)
    dead = [v for v in grp.values() if len(v) > 1]

    print('\n[3.1] 8 项线索完全相同的球员组 —— 应为 0 组')
    print('      两组球员在这 8 项上取值一样时，无论怎么猜反馈都相同，玩家无法区分。')
    if dead:
        for g in dead:
            print('      ❌ ' + ' / '.join('%s(%s)' % (r['name_cn'], r['_id']) for r in g))
    else:
        print('      ✅ 0 组（不存在逻辑死题）')

    # 3.2 现役同队同号：同一时点不可能两人穿同一个号
    sh = collections.defaultdict(list)
    for r in act:
        sh[(r['club'], r['shirt_number'])].append(r)
    clash = {k: v for k, v in sh.items() if len(v) > 1}
    print('\n[3.2] 现役球员同队同号 —— 同一时点不可能，需人工核对后修')
    print('      （跨时代重号是正常的：退役传奇和现役在不同年代穿过同一号码，不算冲突）')
    if clash:
        for (club, num), g in sorted(clash.items()):
            print('      ⚠ %s #%s -> %s'
                  % (club, num, ' / '.join('%s(%s)' % (r['name_cn'], r['_id']) for r in g)))
    else:
        print('      ✅ 0 组')

    # 3.3 现役年龄越界
    odd = [r for r in act if r['age'] < 16 or r['age'] > 45]
    print('\n[3.3] 现役年龄 <16 或 >45 —— %d 人' % len(odd))
    for r in sorted(odd, key=lambda x: x['age']):
        print('      ⚠ %s(%s) %d 岁  %s/%s'
              % (r['name_cn'], r['_id'], r['age'], r['club'], r['league']))

    # 3.4 身高越界（validate.py 只警告，这里汇总出来方便一起看）
    hodd = [r for r in rows if not (160 <= r['height_cm'] <= 215)]
    print('\n[3.4] 身高超出 160~215cm —— %d 人' % len(hodd))
    for r in sorted(hodd, key=lambda x: x['height_cm']):
        print('      ⚠ %s(%s) %dcm' % (r['name_cn'], r['_id'], r['height_cm']))

    # 3.5 同队同位置 >= 4 人：区分度预警（信息量被摊薄）
    cp = collections.Counter((r['club'], r['position']) for r in rows)
    dense = sorted([(k, v) for k, v in cp.items() if v >= 4], key=lambda x: -x[1])
    print('\n[3.5] 同队同位置 >= 4 人 —— %d 组（区分度预警，非错误）' % len(dense))
    for (club, pos), v in dense[:top]:
        print('      · %s %s -> %d 人' % (club, pos, v))

    # 3.6 漂移最快联赛里的现役球员：校准时优先看这些
    dr = [r for r in act if r['league'] in DRIFTY]
    print('\n[3.6] 高漂移联赛（%s）里的现役球员 —— %d 人，校准优先看这里'
          % ('/'.join(DRIFTY), len(dr)))
    print('      理由：这些联赛的中国区信息源滞后，转会和号码变更最容易漏。')
    for lg in DRIFTY:
        sub = [r for r in dr if r['league'] == lg]
        if sub:
            print('      · %s %d 人：%s' % (lg, len(sub),
                  '、'.join(r['name_cn'] for r in sub[:8])
                  + ('…' if len(sub) > 8 else '')))

    # 3.7 退役球员的"周岁"会超出常理 —— 是产品取舍，不是数据错误
    very_old = [r for r in ret if r['age'] >= 85]
    print('\n[3.7] 退役球员周岁 >= 85 岁 —— %d 人（产品取舍，需你拍板）' % len(very_old))
    print('      规则是自洽的：所有球员一律按基准日算周岁。但梅阿查这种 1910 年生的')
    print('      会显示 116 岁，玩家第一眼可能以为出 bug 了。')
    print('      好处是极端值区分度极高（箭头恒为一个方向，一步就能锁定年代）。')
    for r in sorted(very_old, key=lambda x: -x['age']):
        tag = '每日池' if r['fame_level'] >= 4 else '仅自由练习'
        print('      · %s(%s) %d 岁（生于 %s，%s） fame=%d %s'
              % (r['name_cn'], r['_id'], r['age'], r['birth_date'], tag,
                 r['fame_level'], r['club']))

    print('\n' + '=' * 58)
    if dead:
        print('❌ 存在 %d 组逻辑死题，必须改（改完重跑本脚本）' % len(dead))
        return 1
    todo = len(clash) + len(odd) + len(hodd)
    print('✅ 无逻辑死题。待人工核对 %d 项（转会/号码/年龄/身高），见 3.2~3.4' % todo)
    print('   这些都是要查转会窗的，程序判不了对错 —— 校准完把 jsonl 改掉，')
    print('   再跑 validate.py --fix 重算 search_index，最后 re-import + playerVersion +1。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
