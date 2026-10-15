# -*- coding: utf-8 -*-
"""
把 docs/02-database.md §6 的示例 JSON 换成 players.full.jsonl 的真实前 10 条。

用法：
    python scripts/sync-doc-examples.py

存在意义：文档里手写的示例早晚会和真库漂移（改了译名、调了队色、换了数据日期），
而这种漂移不会触发任何报错，等人照着文档排查时才发现对不上。
所以让示例由脚本从真库生成，人和程序看的是同一份。
"""
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOC = os.path.join(ROOT, 'docs', '02-database.md')
DATA = os.path.join(ROOT, 'database', 'players.full.jsonl')

N = 10


def main():
    all_rows = [json.loads(l) for l in open(DATA, encoding='utf-8') if l.strip()]
    total = len(all_rows)          # 文档里"完整 N 条"要跟着真库走，不能写死
    rows = all_rows[:N]

    # 可读版：缩进 2 空格，数组不换行到失控
    parts = []
    for i, p in enumerate(rows):
        body = json.dumps(p, ensure_ascii=False, indent=2)
        parts.append(body)
    block = ',\n'.join(parts)
    block = '[\n' + block + '\n]'

    doc = io.open(DOC, encoding='utf-8').read()

    # 定位 §6 正文里的 jsonc 代码块（§6 标题后 / §6.1 小节前）
    start = doc.index('## 6.')
    end = doc.index('### 6.1')
    section = doc[start:end]

    new_section, n = re.subn(
        r'```jsonc\n.*?\n```',
        '```jsonc\n' + block + '\n```',
        section,
        count=1,
        flags=re.S
    )
    if n != 1:
        raise SystemExit('没找到 §6 的 jsonc 代码块，检查文档结构')

    # 同步更新代码块前的说明：指向真库，别让人以为示例是手写的
    new_section = new_section.replace(
        '**以 `database/players.sample.jsonl` 为准**（该文件已通过 `validate.py` 校验，'
        '`search_index` 为脚本生成值）。\n以下为可读版，字段完整、数值已按 2026-10-10 校准。'
        '两处若有出入，一律以 jsonl 文件为准。',
        '下面 10 条由 `scripts/sync-doc-examples.py` 从 **`database/players.full.jsonl` 的前 10 条**'
        '自动生成，'
        '字段、译名、队色、数据日期与真库完全一致（改动后重跑该脚本即可同步）。\n'
        '完整 %d 条见 `database/players.full.jsonl`。' % total
    )

    doc = doc[:start] + new_section + doc[end:]
    io.open(DOC, 'w', encoding='utf-8').write(doc)
    print('已用真库前 %d 条重写 §6 示例 -> %s' % (N, DOC))
    for p in rows:
        print('   %s  %s / %s' % (p['_id'], p['name_cn'], p['club']))


if __name__ == '__main__':
    main()
