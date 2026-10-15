# -*- coding: utf-8 -*-
"""
把服务端的核心算法复制一份到小程序端，仅供本地 Mock 模式使用。

用法：
    python scripts/gen-mock-core.py

产物（都在 miniprogram/utils/）：
    mock-compare.js     <- cloudfunctions/_shared/compare.js
    mock-constants.js   <- cloudfunctions/_shared/constants.js
    mock-util.js        <- cloudfunctions/_shared/util.js

思路：与其把服务端的抽样/判定逻辑手抄一份到客户端（抄必错，且改了服务端就漂移），
不如让同一份源码搬过来跑。搬过来唯一的技术障碍是 `_shared/util.js` 依赖 node 的
crypto 模块，而小程序里没有 —— 所以 require('crypto') 会被换成本项目手写的
miniprogram/utils/mock-hash.js（README-启动.md §4 有说明）。

⚠️ 这是全项目唯一一处「比对逻辑出现在客户端」的地方。
   正式的架构红线是不允许的（前端有比对 = 可遍历候选池暴力反推答案）。
   它只服务于不开云环境就想玩通全局的场景，上线前务必关掉 Mock。

   不要手改生成出来的 mock-*.js —— 改了 _shared/ 之后重跑本脚本。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHARED = os.path.join(ROOT, 'cloudfunctions', '_shared')
OUT_DIR = os.path.join(ROOT, 'miniprogram', 'utils')

# 源文件 -> 目标文件
FILES = ('compare.js', 'constants.js', 'util.js')

# 副本都加了 mock- 前缀、crypto 要换成本地实现，require 路径必须跟着改。
# 漏改一条就是小程序里的 MODULE_NOT_FOUND，而且 node 跑测试时反而正常，很容易漏网。
REWRITES = (
    ("require('./constants')", "require('./mock-constants')"),
    ("require('./compare')", "require('./mock-compare')"),
    ("require('crypto')", "require('./mock-hash')"),
)

BANNER = """/**
 * ⚠️⚠️⚠️ 本地 Mock 专用 —— 严禁在正式包里启用 ⚠️⚠️⚠️
 *
 * 本文件由 scripts/gen-mock-core.py 从 cloudfunctions/_shared/ 复制而来，
 * 目的是让「不想配云环境、只想先看一眼界面」的人能立刻跑通全局。
 *
 * 它违反了一条架构红线：比对逻辑不允许出现在客户端
 * （有了它，别人就能离线遍历候选池把答案试出来）。
 * 所以：
 *   1. 只有 app.js 里 USE_MOCK = true 时才会被加载；
 *   2. 提审 / 上线前必须把 USE_MOCK 改回 false，并删掉本文件；
 *   3. scripts/check-mp.js 会在 Mock 开启时给出醒目告警。
 *
 * 不要手改这里 —— 改请改 _shared/ 的真源，然后重跑生成脚本。
 */

"""


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    stray = 0

    for name in FILES:
        src = io.open(os.path.join(SHARED, name), encoding='utf-8').read()
        for old, new in REWRITES:
            src = src.replace(old, new)

        dst = os.path.join(OUT_DIR, 'mock-' + name)
        io.open(dst, 'w', encoding='utf-8').write(BANNER + src)

        # 兜底自检：小程序里没有 node 内置模块，require 裸模块名必然炸，
        # 所以只盯那些不是 ./ 开头的（改完的相对路径已经安全了）。
        left = [l.strip() for l in src.split('\n')
                if "require('" in l and "require('./" not in l]
        print('已生成 %-24s (%d 行)' % (os.path.basename(dst), len(src.split('\n'))))
        for l in left:
            print('    ⚠️ 可疑 require：%s' % l)
            stray += 1

    print('\n同步完毕。若 _shared/ 有改动，重跑本脚本。')
    if stray:
        print('有 %d 处 require 需要人工确认 —— 小程序里没有 node 内置模块。' % stray)


if __name__ == '__main__':
    main()
