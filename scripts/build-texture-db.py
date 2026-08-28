#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把《500道菜肴质构数据_切割测试_下压测试分类.xlsx》编译成小程序内置的质构数据库。

输入：scripts/source/500道菜肴质构数据_切割测试_下压测试分类.xlsx
输出：miniprogram/data/textureDb.data.ts （紧凑元组数组，机器生成，勿手改）

与上一版（0827 整合表）的关键区别：
  * 新表已有独立的「食材」「烹饪方式」「时间」列，不必再去解析源文件名，
    因此删掉了原来那套脆弱的文件名拆分逻辑；
  * 新表分「切割测试 / 下压测试」两个 sheet，是同一食材的两种 TPA 测试模式，
    编译进同一张表并用 testMode 字段区分（0=切割，1=下压）。

用法： python3 scripts/build-texture-db.py
依赖： pip install openpyxl
"""
import os
import re
import json
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, 'scripts', 'source', '500道菜肴质构数据_切割测试_下压测试分类.xlsx')
OUT = os.path.join(ROOT, 'miniprogram', 'data', 'textureDb.data.ts')

# sheet 名 → testMode 下标；顺序即 TEXTURE_TEST_MODES 的顺序。
TEST_MODES = ['切割测试', '下压测试']

# 列下标（0 起），对应表头：
# 菜品类别 菜名 源文件名 样品高度 硬度 脆度 黏着性 弹性 咀嚼性 胶着性 内聚性 回复性 食材 烹饪方式 时间
C_CATEGORY, C_DISH, C_SOURCE = 0, 1, 2
C_METRICS = range(3, 12)
C_INGREDIENT, C_METHOD, C_TIME = 12, 13, 14

# 数据从第 4 行开始（1=中文表头，2=英文表头，3=单位行）。
FIRST_DATA_ROW = 4

TIME_RE = re.compile(r'(\d+(?:\.\d+)?)\s*(小时|个?小时|h|H|分钟|分|min|MIN|Min|秒)')


def to_minutes(value, unit):
    v = float(value)
    if unit in ('小时', '个小时', 'h', 'H'):
        return v * 60
    if unit == '秒':
        return v / 60
    return v


def parse_time(cell):
    """「30分钟」「1.5小时」→ 分钟数；空 / 无法解析 → 0"""
    if cell is None or cell == '':
        return 0.0
    if isinstance(cell, (int, float)):
        return round(float(cell), 1)
    m = TIME_RE.search(str(cell))
    if not m:
        return 0.0
    return round(to_minutes(m.group(1), m.group(2)), 1)


def clean(text):
    """去掉空白与中英文标点，保留括号内的补充说明（如「芋艿（小芋头）」里的别名有检索价值）"""
    return re.sub(r'[\s　]+', '', str(text or '')).strip()


def num(v):
    if v is None or v == '':
        return None
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return None


def main():
    if not os.path.exists(XLSX):
        print('❌ 找不到数据源：' + XLSX, file=sys.stderr)
        return 1

    wb = openpyxl.load_workbook(XLSX, data_only=True)

    categories = []
    rows = []
    seen = set()
    duplicates = 0
    missing = 0

    for mode_index, sheet_name in enumerate(TEST_MODES):
        if sheet_name not in wb.sheetnames:
            print(f'⚠️ 缺少 sheet「{sheet_name}」，已跳过', file=sys.stderr)
            continue
        ws = wb[sheet_name]
        for r in ws.iter_rows(min_row=FIRST_DATA_ROW, values_only=True):
            if not r or not r[C_DISH]:
                continue
            dish = clean(r[C_DISH])
            ingredient = clean(r[C_INGREDIENT])
            method = clean(r[C_METHOD])
            minutes = parse_time(r[C_TIME])
            source = str(r[C_SOURCE] or '')
            category = clean(r[C_CATEGORY])

            if not ingredient:
                # 新表理论上不会出现，留个兜底：食材缺失时用菜名顶上，并计数告警。
                ingredient = dish
                missing += 1

            # 整行（含测试模式与全部指标）完全相同的才算重复。
            key = (mode_index, dish, ingredient, method, minutes) + tuple(
                '' if r[i] is None else str(r[i]) for i in C_METRICS
            )
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)

            if category not in categories:
                categories.append(category)

            rows.append([
                categories.index(category),
                dish,
                ingredient,
                method,
                minutes,
                mode_index,
            ] + [num(r[i]) for i in C_METRICS] + [source])

    # 稳定排序：同菜聚在一起、切割在前下压在后、时间长的在前。
    # 「时间长的在前」让下游取同食材第一条即为最长烹饪时间的那条。
    rows.sort(key=lambda x: (x[1], x[2], x[5], -x[4], x[3]))

    dishes = sorted({x[1] for x in rows})
    ingredients = sorted({x[2] for x in rows})

    lines = []
    lines.append('// ⚠️ 本文件由 scripts/build-texture-db.py 从')
    lines.append('//    scripts/source/500道菜肴质构数据_切割测试_下压测试分类.xlsx 自动生成，请勿手工编辑。')
    lines.append('//    重新生成： python3 scripts/build-texture-db.py')
    lines.append('//')
    lines.append('// 每行是一条 TPA 全质构测试记录（某道菜里的某种食材、某种测试模式的一次测试）：')
    lines.append('//   [类别下标, 菜名, 食材, 烹饪方式, 烹饪时间(分钟,0=未标注), 测试模式下标,')
    lines.append('//    样品高度mm, 硬度gf, 脆度gf, 黏着性gf*sec, 弹性, 咀嚼性gf, 胶着性gf, 内聚性, 回复性, 源文件名]')
    lines.append('')
    lines.append('/** 菜品类别表，行首下标指向这里 */')
    lines.append('export const TEXTURE_CATEGORIES: string[] = '
                 + json.dumps(categories, ensure_ascii=False) + ';')
    lines.append('')
    lines.append('/** TPA 测试模式表，第 6 列下标指向这里 */')
    lines.append('export const TEXTURE_TEST_MODES: string[] = '
                 + json.dumps(TEST_MODES, ensure_ascii=False) + ';')
    lines.append('')
    lines.append('/** 单行原始数据的元组类型 */')
    lines.append('export type TextureRow = [')
    lines.append('  number, string, string, string, number, number,')
    lines.append('  number | null, number | null, number | null, number | null, number | null,')
    lines.append('  number | null, number | null, number | null, number | null,')
    lines.append('  string,')
    lines.append('];')
    lines.append('')
    lines.append(f'/** 共 {len(rows)} 条记录，覆盖 {len(dishes)} 道菜、{len(ingredients)} 种食材 */')
    lines.append('export const TEXTURE_ROWS: TextureRow[] = [')
    for row in rows:
        lines.append('  ' + json.dumps(row, ensure_ascii=False) + ',')
    lines.append('];')
    lines.append('')

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    size = os.path.getsize(OUT)
    per_mode = {m: sum(1 for x in rows if x[5] == i) for i, m in enumerate(TEST_MODES)}
    print(f'✅ {OUT}')
    print(f'   {len(rows)} 行 / {len(dishes)} 道菜 / {len(ingredients)} 种食材 '
          f'/ {len(categories)} 个类别 / {size/1024:.0f} KB')
    print('   测试模式：' + '、'.join(f'{k} {v} 行' for k, v in per_mode.items()))
    if duplicates:
        print(f'   （已去掉 {duplicates} 行完全重复的数据）')
    if missing:
        print(f'   ⚠️ {missing} 行「食材」列为空，已回退为菜名')
    return 0


if __name__ == '__main__':
    sys.exit(main())
