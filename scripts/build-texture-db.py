#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把《500道菜肴质构数据整合.xlsx》编译成小程序内置的质构数据库。

输入：scripts/source/500道菜肴质构数据整合.xlsx
输出：miniprogram/data/textureDb.data.ts   （紧凑元组数组，机器生成，勿手改）

解析核心是「源文件名」列，形如：
    粉丝鲜虾煲12分钟—鲜虾—（TPA全质构切割测试）.xlsx
    扒条子肉—蒸60分钟—（TPA全质构切割测试）.xlsx
    清蒸石斑鱼（TPA全质构切割测试）.xlsx
从中拆出：菜名 / 原食材名 / 烹饪方式 / 烹饪时间(分钟)。

用法： python3 scripts/build-texture-db.py
依赖： pip install openpyxl
"""
import os
import re
import json
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, 'scripts', 'source', '500道菜肴质构数据整合.xlsx')
OUT = os.path.join(ROOT, 'miniprogram', 'data', 'textureDb.data.ts')

# 烹饪方式关键词：长词优先，避免「清蒸」被切成「蒸」。
METHODS = [
    '凉拌', '清蒸', '粉蒸', '红烧', '干煸', '干锅', '油炸', '油焖', '油淋', '白灼', '白切',
    '爆炒', '生煎', '水煮', '汆烫', '焯水', '慢炖', '清炒', '酱烧', '黄焖',
    '炖', '煮', '蒸', '炒', '炸', '烤', '焖', '烧', '卤', '煎', '爆', '熘', '溜',
    '拌', '腌', '烩', '焯', '煨', '汆', '涮', '酱', '熏', '煲', '扒', '熬', '烙', '烘',
]
# 烹饪器具：本身不是烹饪方式，但会显著影响质构；仅在找不到烹饪方式时兜底使用。
DEVICES = ['高压锅', '电压力锅', '空气炸锅', '砂锅', '电饭煲', '微波炉', '烤箱']

# 描述保存/放置状态而非食材的词：出现时不当作原食材名，食材回退到菜名。
STATE_WORDS = ['室温', '常温', '冷藏', '冷冻', '解冻', '复热', '静置', '放置', '现做', '刚出锅']

TIME_RE = re.compile(r'(\d+(?:\.\d+)?)\s*(小时|个?小时|h|H|分钟|分|min|MIN|Min|秒)')
TPA_RE = re.compile(r'[（(][^（()）]*(?:TPA|全质构)[^（()）]*[)）]')
PAREN_RE = re.compile(r'[（(][^（()）]*[)）]')
SPLIT_RE = re.compile(r'[—–\-−~～]+')


def to_minutes(value, unit):
    v = float(value)
    if unit in ('小时', '个小时', 'h', 'H'):
        return v * 60
    if unit == '秒':
        return v / 60
    return v


def extract_time(text):
    """返回 (分钟数 or 0, 去掉时间标记后的文本)"""
    m = TIME_RE.search(text)
    if not m:
        return 0.0, text
    minutes = to_minutes(m.group(1), m.group(2))
    return minutes, TIME_RE.sub('', text)


def extract_method(text):
    """返回 (烹饪方式 or '', 去掉方式/器具词后的文本)。

    先找真正的烹饪方式；找不到时才退回器具词（高压锅等）。
    无论是否命中，器具词都要从文本里剔除，避免混进食材名。
    """
    device = ''
    for kw in DEVICES:
        idx = text.find(kw)
        if idx >= 0:
            device = device or kw
            text = text[:idx] + text[idx + len(kw):]
    for kw in METHODS:
        idx = text.find(kw)
        if idx >= 0:
            return kw, text[:idx] + text[idx + len(kw):]
    return device, text


def clean(text):
    text = PAREN_RE.sub('', text)
    # 原表个别文件名括号写重了（如「…测试））.xlsx」），去掉落单的括号
    text = re.sub(r'[（）()【】\[\]]', '', text)
    return re.sub(r'[\s　·、,，。.]+', '', text).strip()


def parse_source(source_name, dish_name):
    """解析源文件名 → (原食材名, 烹饪方式, 分钟)"""
    s = str(source_name or '')
    s = re.sub(r'\.xlsx?$', '', s, flags=re.I)
    s = TPA_RE.sub('', s)
    parts = [p for p in (x.strip() for x in SPLIT_RE.split(s)) if clean(p)]

    dish_seg = parts[0] if parts else str(dish_name or '')
    ing_segs = parts[1:]

    minutes = 0.0
    method = ''

    # 优先从食材段取时间与烹饪方式（更贴近该食材的实际处理）
    ingredient = ''
    for seg in ing_segs:
        t, rest = extract_time(seg)
        if t:
            minutes = max(minutes, t)
        m, rest2 = extract_method(rest)
        if m and not method:
            method = m
        name = clean(rest2)
        if name in STATE_WORDS or any(name == w for w in STATE_WORDS):
            name = ''
        if not name:
            # 该段只写了时间/方式（如「蒸60分钟」「8分钟」），食材名回退到菜名
            name = ''
        if name:
            ingredient = name if not ingredient else ingredient + name

    # 菜名段里的时间与烹饪方式
    t, dish_rest = extract_time(dish_seg)
    if t:
        minutes = max(minutes, t)
    dm, dish_rest2 = extract_method(dish_rest)
    if dm and not method:
        method = dm

    if not ingredient:
        # 整道菜就是一个食材（如「清蒸石斑鱼」），用去掉时间的菜名兜底
        ingredient = clean(dish_rest) or clean(str(dish_name or ''))

    return ingredient, method, round(minutes, 1)


def num(v):
    if v is None or v == '':
        return None
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return None


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb[wb.sheetnames[0]]

    categories = []
    rows = []
    # 原表把整份数据粘贴了两遍，完全相同的行只保留一条。
    seen = set()
    duplicates = 0
    for r in ws.iter_rows(min_row=4, values_only=True):
        if not r or not r[1]:
            continue
        key = tuple('' if c is None else str(c) for c in r[:12])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        category = str(r[0] or '').strip()
        dish = clean(str(r[1]))
        source = str(r[2] or '')
        if category not in categories:
            categories.append(category)
        ingredient, method, minutes = parse_source(source, r[1])
        rows.append([
            categories.index(category),
            dish,
            ingredient,
            method,
            minutes,
            num(r[3]), num(r[4]), num(r[5]), num(r[6]),
            num(r[7]), num(r[8]), num(r[9]), num(r[10]), num(r[11]),
            source,
        ])

    lines = []
    lines.append('// ⚠️ 本文件由 scripts/build-texture-db.py 从')
    lines.append('//    scripts/source/500道菜肴质构数据整合.xlsx 自动生成，请勿手工编辑。')
    lines.append('//    重新生成： python3 scripts/build-texture-db.py')
    lines.append('//')
    lines.append('// 每行是一条 TPA 全质构测试记录（一道菜的一种原食材一次测试），字段顺序：')
    lines.append('//   [类别下标, 菜名, 原食材名, 烹饪方式, 烹饪时间(分钟,0=未标注),')
    lines.append('//    样品高度mm, 硬度gf, 脆度gf, 黏着性gf*sec, 弹性, 咀嚼性gf, 胶着性gf, 内聚性, 回复性, 源文件名]')
    lines.append('')
    lines.append('/** 菜品类别表，行首下标指向这里 */')
    lines.append('export const TEXTURE_CATEGORIES: string[] = ' + json.dumps(categories, ensure_ascii=False) + ';')
    lines.append('')
    lines.append('/** 单行原始数据的元组类型 */')
    lines.append('export type TextureRow = [')
    lines.append('  number, string, string, string, number,')
    lines.append('  number | null, number | null, number | null, number | null, number | null,')
    lines.append('  number | null, number | null, number | null, number | null,')
    lines.append('  string,')
    lines.append('];')
    lines.append('')
    lines.append(f'/** 共 {len(rows)} 条记录，覆盖 {len(set(x[1] for x in rows))} 道菜 */')
    lines.append('export const TEXTURE_ROWS: TextureRow[] = [')
    for row in rows:
        lines.append('  ' + json.dumps(row, ensure_ascii=False) + ',')
    lines.append('];')
    lines.append('')

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    size = os.path.getsize(OUT)
    print(f'✅ {OUT}')
    print(f'   {len(rows)} 行 / {len(set(x[1] for x in rows))} 道菜 / {len(categories)} 个类别 / {size/1024:.0f} KB')
    print(f'   （已去掉 {duplicates} 行完全重复的数据）')
    noing = [x for x in rows if not x[2]]
    if noing:
        print(f'   ⚠️ {len(noing)} 行未解析出原食材名')


if __name__ == '__main__':
    sys.exit(main())
