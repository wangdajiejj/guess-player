# -*- coding: utf-8 -*-
"""
players 集合数据校验脚本
用法：
    python validate.py ../database/players.sample.jsonl            # 只校验
    python validate.py ../database/players.sample.jsonl --fix      # 自动重算 search_index 并写回
    python validate.py ../database/players.sample.jsonl 2026-10-10 # 指定年龄基准日

校验项见 docs/02-database.md §7.2。
退出码 0 = 通过；1 = 存在阻断级错误。
"""
import json
import re
import sys
import unicodedata
from datetime import date

BLOCKERS = []
WARNINGS = []

POSITIONS = {
    "门将": "GK",
    "中后卫": "DF", "左后卫": "DF", "右后卫": "DF", "清道夫": "DF",
    "后腰": "MF", "中前卫": "MF", "前腰": "MF", "左边前卫": "MF", "右边前卫": "MF",
    "中锋": "FW", "影锋": "FW", "左边锋": "FW", "右边锋": "FW",
}
LEAGUES = {"英超", "西甲", "德甲", "意甲", "法甲", "荷甲", "葡超", "土超",
           "美职联", "沙特联", "巴甲", "阿甲", "韩K联", "日职联"}
# §1.2 禁用写法（俗称必须进 aliases，不能占 club 字段）
FORBIDDEN_CLUBS = {"皇马", "巴萨", "马竞", "国米", "Inter", "ACMilan", "米兰",
                   "曼彻斯特城", "曼彻斯特联", "托特纳姆", "大巴黎", "巴黎",
                   "拜仁", "多特", "莱比锡红牛", "拿坡里", "纳斯尔", "希拉尔",
                   "国际迈阿密", "已退役", "无", "retired", "Retired"}
BAD_RETIRED_CLUB = {"已退役", "无", "retired", "无俱乐部", "-"}

REQUIRED = ["_id", "id", "name_cn", "name_en", "aliases", "nationality",
            "nationality_code", "club", "club_en", "league", "position",
            "position_group", "birth_date", "height_cm", "preferred_foot",
            "shirt_number", "active", "fame_level", "pinyin", "initials",
            "search_index", "intro", "fun_fact",
            "primary_color", "secondary_color", "data_as_of"]

# 键必须存在，但值允许为空字符串（前端用 wx:if 判空，见 result.wxml §meme 卡）。
# 没有外号/梗的球员硬编一个反而是噪音，所以不做非空强制。
OPTIONAL_ALLOW_EMPTY = {"meme"}


def calc_age(birth: str, ref: date) -> int:
    y, m, d = (int(x) for x in birth.split("-"))
    return ref.year - y - ((ref.month, ref.day) < (m, d))


def fold(s: str) -> str:
    """小写 + 去分隔符 + 去重音符号（é -> e，见 §1.3）。"""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[·\s\-'\.]", "", s.lower())


def build_search_index(p: dict) -> str:
    """§3.5：一次性生成检索串，前端只做 indexOf。顺序不影响匹配结果。"""
    parts = [p["name_cn"], p["name_en"], p["club"], p["club_en"], p["league"],
             p["nationality"], p["position"], p["pinyin"], p["initials"]]
    parts += list(p.get("aliases") or [])
    return "|".join(fold(x) for x in parts if x)


def same_index(a: str, b: str) -> bool:
    """顺序无关比较：按 '|' 分段后集合比对。"""
    return {x for x in a.split("|") if x} == {x for x in b.split("|") if x}


def fix(path: str) -> int:
    """按 §3.5 规则重算所有记录的 search_index 并原地写回。"""
    out, changed = [], 0
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            p = json.loads(line)
            new = build_search_index(p)
            if p.get("search_index") != new:
                p["search_index"] = new
                changed += 1
            out.append(json.dumps(p, ensure_ascii=False))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"[fix] 已重写 {len(out)} 条，其中 {changed} 条 search_index 被重算 -> {path}")
    return 0


def validate(path: str, ref: date = None):
    ref = ref or date.today()
    seen_id, seen_pk = {}, {}
    with open(path, "r", encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                p = json.loads(line)
            except json.JSONDecodeError as e:
                BLOCKERS.append(f"L{ln} JSON 解析失败：{e}")
                continue

            tag = f"L{ln} {p.get('_id', '?')}"

            for k in REQUIRED:
                if k not in p or p[k] is None or p[k] == "":
                    BLOCKERS.append(f"{tag} 缺少必填字段 {k}")
            for k in OPTIONAL_ALLOW_EMPTY:
                if k not in p:
                    BLOCKERS.append(f"{tag} 缺少字段 {k}（允许为空字符串，但键必须存在）")

            if not re.match(r"^p\d{3}$", str(p.get("_id", ""))):
                BLOCKERS.append(f"{tag} _id 不符合 ^p\\d{{3}}$")

            if p.get("id") in seen_id:
                BLOCKERS.append(f"{tag} id 重复：{p['id']} (与 {seen_id[p['id']]} 冲突)")
            seen_id[p.get("id")] = p.get("_id")
            if p.get("_id") in seen_pk:
                BLOCKERS.append(f"{tag} _id 重复")
            seen_pk[p.get("_id")] = ln

            if p.get("position") not in POSITIONS:
                BLOCKERS.append(f"{tag} position 非法：{p.get('position')}")
            elif POSITIONS[p["position"]] != p.get("position_group"):
                BLOCKERS.append(
                    f"{tag} position/position_group 不匹配："
                    f"{p.get('position')} 应属 {POSITIONS[p['position']]}")

            if p.get("league") not in LEAGUES:
                WARNINGS.append(f"{tag} league 不在已知枚举：{p.get('league')}")
            if p.get("club") in FORBIDDEN_CLUBS:
                BLOCKERS.append(f"{tag} club 使用了俗称/禁用写法：{p.get('club')}")
            if p.get("preferred_foot") not in ("左脚", "右脚", "双脚"):
                BLOCKERS.append(f"{tag} preferred_foot 非法：{p.get('preferred_foot')}")

            h = p.get("height_cm")
            if not isinstance(h, int) or not (160 <= h <= 215):
                WARNINGS.append(f"{tag} height_cm 超出常见区间 [160,215]：{h}")
            sn = p.get("shirt_number")
            if not isinstance(sn, int) or not (1 <= sn <= 99):
                BLOCKERS.append(f"{tag} shirt_number 非法：{sn}")
            if not isinstance(p.get("fame_level"), int) or not (1 <= p["fame_level"] <= 5):
                BLOCKERS.append(f"{tag} fame_level 非法：{p.get('fame_level')}")

            bd = str(p.get("birth_date", ""))
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", bd):
                BLOCKERS.append(f"{tag} birth_date 格式错误：{bd}")
            else:
                try:
                    age = calc_age(bd, ref)
                    flags = []
                    if p.get("active") is False:
                        flags.append("退役")
                    print(f"  {tag:<10} {p.get('name_cn'):<12} "
                          f"{p.get('club')}/{p.get('league')} "
                          f"{str(age) + '岁':<6} {'|'.join(flags)}")
                except Exception as e:
                    BLOCKERS.append(f"{tag} birth_date 无法解析：{e}")

            if p.get("active") is False and str(p.get("club")) in BAD_RETIRED_CLUB:
                BLOCKERS.append(
                    f"{tag} 退役球员 club 填成了「{p.get('club')}」，"
                    f"必须填代表俱乐部（见 §3.2，否则所有传奇联赛/俱乐部互绿）")

            if not same_index(str(p.get("search_index", "")), build_search_index(p)):
                WARNINGS.append(
                    f"{tag} search_index 与规则 §3.5 不符（加 --fix 可自动重算）\n"
                    f"      期望: {build_search_index(p)}\n"
                    f"      实际: {p.get('search_index')}")

            if isinstance(p.get("pinyin"), str) and not p["pinyin"].isascii():
                BLOCKERS.append(f"{tag} pinyin 含非 ASCII 字符：{p['pinyin']}")
            for c in ("primary_color", "secondary_color"):
                if not re.match(r"^#[0-9A-Fa-f]{6}$", str(p.get(c, ""))):
                    BLOCKERS.append(f"{tag} {c} 非法：{p.get(c)}")

    n = len(seen_id)
    print(f"\n共校验 {n} 条")
    if WARNINGS:
        print(f"\n[警告] {len(WARNINGS)} 条")
        for w in WARNINGS:
            print("  -", w)
    if BLOCKERS:
        print(f"\n[阻断] {len(BLOCKERS)} 条 —— 禁止导入")
        for b in BLOCKERS:
            print("  -", b)
        return 1
    print("\n[通过] 无阻断级错误，可导入")
    return 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    do_fix = "--fix" in args
    args = [a for a in args if a != "--fix"]
    target = args[0] if args else "players.sample.jsonl"
    ref = date.today()
    if len(args) > 1:
        ref = date.fromisoformat(args[1])
    print(f"校验文件：{target}   基准日期：{ref}   去重音 + 含 league\n")
    if do_fix:
        fix(target)
        print()
    sys.exit(validate(target, ref))
