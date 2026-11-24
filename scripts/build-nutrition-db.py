#!/usr/bin/env python3
"""把《中国食物成分表标准版（第 6 版）》表一 CSV 编译成小程序内置营养库 nutritionDb.data.ts。

数据源 scripts/source/中国食物成分表第6版_表一.csv 由 scripts/nutrition/extract.sh 从扫描 PDF 提取。
两者都受原书版权约束，已加入 .gitignore，不进公开仓库；本脚本和提取脚本进仓库，换电脑时可重新生成。

    python3 scripts/build-nutrition-db.py
"""
import csv
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'scripts', 'source', '中国食物成分表第6版_表一.csv')
OUT = os.path.join(ROOT, 'miniprogram', 'data', 'nutritionDb.data.ts')

# 小程序里用到的营养素（键, CSV 列名）。水分、灰分、胡萝卜素、视黄醇不参与摄入量计算，不带进小程序包。
FIELDS = [
    ('edible', '食部(%)'), ('energyKcal', '能量(kcal)'), ('protein', '蛋白质(g)'), ('fat', '脂肪(g)'),
    ('carbohydrate', '碳水化合物(g)'), ('fiber', '不溶性膳食纤维(g)'), ('cholesterol', '胆固醇(mg)'),
    ('vitaminA', '总维生素A(μgRAE)'), ('thiamin', '硫胺素(mg)'), ('riboflavin', '核黄素(mg)'), ('niacin', '烟酸(mg)'),
    ('vitaminC', '维生素C(mg)'), ('vitaminE', '总维生素E(mg)'), ('calcium', '钙(mg)'), ('phosphorus', '磷(mg)'),
    ('potassium', '钾(mg)'), ('sodium', '钠(mg)'), ('magnesium', '镁(mg)'), ('iron', '铁(mg)'), ('zinc', '锌(mg)'),
    ('selenium', '硒(μg)'), ('copper', '铜(mg)'), ('manganese', '锰(mg)'),
]


def num(text):
    text = (text or '').strip()
    if not text:
        return None
    v = float(text)
    return int(v) if v == int(v) else v


def main():
    rows = []
    categories = []
    with open(SRC, encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            cat = r['类别']
            if cat not in categories:
                categories.append(cat)
            rows.append([r['食物编码'], r['食物名称'], categories.index(cat)] + [num(r[label]) for _, label in FIELDS])
    lines = [
        '// ⚠️ 本文件由 scripts/build-nutrition-db.py 从',
        '//    scripts/source/中国食物成分表第6版_表一.csv 自动生成，请勿手工编辑。',
        '//    数据出自《中国食物成分表标准版（第 6 版）》第一、二册表一，以每 100 g 可食部计；',
        '//    受原书版权约束，仅供本研究的非商业用途，不进公开仓库。',
        '',
        '/** 食物类别表，行内第 3 项是这里的下标 */',
        'export const NUTRITION_CATEGORIES: string[] = %s;' % json.dumps(categories, ensure_ascii=False),
        '',
        '/** 每行第 4 项起依次对应的营养素键，null 表示原书未检测（—） */',
        'export const NUTRITION_FIELDS = %s as const;' % json.dumps([k for k, _ in FIELDS]),
        '',
        'export type NutritionRow = [string, string, number, ...(number | null)[]];',
        '',
        '/** 共 %d 种食物 */' % len(rows),
        'export const NUTRITION_ROWS: NutritionRow[] = [',
    ]
    for row in rows:
        lines.append('  %s,' % json.dumps(row, ensure_ascii=False, separators=(',', ':')))
    lines.append('];')
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    print('%d foods -> %s (%d KB)' % (len(rows), OUT, os.path.getsize(OUT) // 1024))


if __name__ == '__main__':
    main()
