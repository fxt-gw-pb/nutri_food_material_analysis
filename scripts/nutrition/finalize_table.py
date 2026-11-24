# 把合并后的读数整理成最终的成分表 CSV。
#
# 依次做四件事：
#   1. 两遍读数只差小数点的，取带小数点的那一遍；
#   2. 水分、蛋白质、脂肪、碳水化合物、灰分五项按印刷格式补回的小数点，只有让五项之和更接近 100 g 时才保留；
#   3. 套用对照原书逐条核对过的人工更正（MANUAL）；
#   4. 原书「野菜」一节把 kcal 与 kJ 两列印反了，按 kJ ≥ kcal 摆正；kcal 印刷不清时由 kJ ÷ 4.184 推算。
#
# 用法：python3 -I finalize_table.py <passA.json> <passB.json> <merged.json> <out.csv>
import csv
import json
import re
import sys

A = json.load(open(sys.argv[1]))['foods']
B = json.load(open(sys.argv[2]))['foods']
merged = json.load(open(sys.argv[3]))
foods = merged['foods']
OUT = sys.argv[4]

PROX = ['water', 'protein', 'fat', 'cho', 'ash']

for code, f, ra, rb in merged['review']:
    if ra and rb and ra.replace('.', '').lstrip('0') == rb.replace('.', '').lstrip('0'):
        foods[code][f] = float(ra if '.' in ra else rb)

for code, r in foods.items():
    rep = [f for f in r.get('_repaired', []) if f in PROX]
    if not rep:
        continue
    raw = {**B.get(code, {}).get('_raw', {}), **A.get(code, {}).get('_raw', {})}

    def total(use_repair):
        s = 0
        for f in PROX:
            v = r.get(f)
            if not isinstance(v, (int, float)):
                continue
            if f in rep and not use_repair:
                v = float(raw[f])
            s += v
        return s

    if abs(total(False) - 100) < abs(total(True) - 100):
        for f in rep:
            r[f] = float(raw[f])

# 对照原书扫描页逐条核对后的更正（食物编码, 列）→ 原书数值
MANUAL = {
    ('045126', 'Ca'): 74, ('031515', 'Ca'): 134, ('062310', 'cho'): 84.4, ('031403', 'kcal'): 10,
    ('051053', 'retinol'): 0, ('083309', 'Cu'): 0.11, ('071032', 'K'): 468, ('045302', 'Na'): 242.0,
    ('012216', 'cho'): 75.0,
}
for (c, f), v in MANUAL.items():
    foods[c][f] = float(v)

for r in foods.values():
    kc, kj = r.get('kcal'), r.get('kJ')
    if isinstance(kc, float) and isinstance(kj, float) and kj < kc:
        r['kcal'], r['kJ'] = kj, kc
    if not isinstance(r.get('kcal'), float) and isinstance(r.get('kJ'), float):
        r['kcal'] = float(round(r['kJ'] / 4.184))

# OCR 认错的食物名称（对照原书更正），只收常用食材
NAME_FIX = {
    '041201': '胡萝卜（红）［金笋，丁香萝卜］', '043208': '黄瓜（鲜）［胡瓜］', '047104': '山药（鲜）［薯蓣，大薯］',
    '062310': '蜜枣［椰枣］', '041302': '苤蓝［玉蔓菁，球茎甘蓝］', '051034': '黄蘑（干）',
    '021201': '甘薯（白心）［红皮山芋］', '021205': '甘薯（红心）［山芋，红薯］', '021203': '甘薯片［白薯干］',
    '046008': '荸荠（鲜）［马蹄，地栗］', '045412': '金针菜（鲜）［黄花菜］', '122201': '虾米［海米，虾仁］',
    '063910': '草莓［洋莓，凤阳草莓］', '051054': '竹荪（干）［竹笙，竹参］', '082105': '牛肉（里脊肉）［牛柳］',
    '082111': '牛肉（背部肉）［上脑］', '012304': '紫红糯米［血糯米］', '121122': '鲢鱼［白鲢，胖子，连子鱼］',
    '121133': '鲫鱼［喜头鱼，海附鱼］', '121116': '乌鳢［黑鱼，乌鱼，生鱼］', '051048': '平菇［糙皮侧耳，青蘑］',
    '051050': '松蘑（干）［松茸，松口蘑］', '051053': '元蘑（干）［亚侧耳，冬蘑，黄蘑］', '081110x': '猪肉（瘦，fat 8g）',
    '081101x': '猪肉（代表值，fat 30g）', '082101x': '牛肉（代表值，fat 9g）', '082108x': '牛肉（代表值，瘦，fat 3g）',
    '083101x': '羊肉（代表值，fat 7g）', '081111x': '猪肉（fat 12g）', '045102': '大白菜（白梗）［黄芽白］',
    '121215': '绿鳍马面鲀［面包鱼，橡皮鱼］', '045415': '芦笋（绿）［石刁柏，龙须菜］', '044104': '青蒜［青葱］',
    '045327': '番杏［新西兰菠菜，夏菠菜］', '121107': '黄鳝［鳝鱼］', '051013': '木耳（干）［黑木耳，云耳］',
    '051014': '木耳（水发）［黑木耳，云耳］', '041101': '白萝卜（鲜）［莱菔］', '047203': '芋头［芋艿，毛芋］',
    '021205': '甘薯（红心）［山芋，红薯］', '051024': '银耳（干）［白木耳］', '122206': '虾仁',
}


def clean_name(n):
    if not n:
        return n
    for a, b in (('[', '［'), (']', '］'), ('【', '［'), ('】', '］'), ('〔', '［'), ('〕', '］'), ('「', '［'),
                 ('(', '（'), (')', '）'), (',', '，'), ('黃', '黄')):
        n = n.replace(a, b)
    n = re.sub(r'（千', '（干', n)
    n = re.sub(r'千）', '干）', n)
    n = n.replace('，千', '，干')
    n = re.sub(r'(?<=[一-鿿）])I(?=[一-鿿])', '［', n)
    n = re.sub(r'1$', '］', n)
    n = re.sub(r'1(?=[，、])', '］', n)
    n = n.rstrip('，、')
    if '］' in n and '［' not in n:
        n = n.replace('）', '）［', 1) if '）' in n else n.replace('］', '')
    if '［' in n and '］' not in n:
        n += '］'
    if '（' in n and '）' not in n and '［' not in n:
        n += '）'
    return n


CATEGORY = {
    '01': '谷类及制品', '02': '薯类、淀粉及制品', '03': '干豆类及制品', '04': '蔬菜类及制品', '05': '菌藻类',
    '06': '水果类及制品', '07': '坚果、种子类', '08': '畜肉类及制品', '09': '禽肉类及制品', '10': '乳类及制品',
    '11': '蛋类及制品', '12': '鱼虾蟹贝类', '19': '油脂类',
}
COLUMNS = [
    ('edible', '食部(%)'), ('water', '水分(g)'), ('kcal', '能量(kcal)'), ('kJ', '能量(kJ)'), ('protein', '蛋白质(g)'),
    ('fat', '脂肪(g)'), ('cho', '碳水化合物(g)'), ('fiber', '不溶性膳食纤维(g)'), ('cholesterol', '胆固醇(mg)'),
    ('ash', '灰分(g)'), ('vitA', '总维生素A(μgRAE)'), ('carotene', '胡萝卜素(μg)'), ('retinol', '视黄醇(μg)'),
    ('thiamin', '硫胺素(mg)'), ('riboflavin', '核黄素(mg)'), ('niacin', '烟酸(mg)'), ('vitC', '维生素C(mg)'),
    ('vitE', '总维生素E(mg)'), ('Ca', '钙(mg)'), ('P', '磷(mg)'), ('K', '钾(mg)'), ('Na', '钠(mg)'), ('Mg', '镁(mg)'),
    ('Fe', '铁(mg)'), ('Zn', '锌(mg)'), ('Se', '硒(μg)'), ('Cu', '铜(mg)'), ('Mn', '锰(mg)'),
]

rows = []
for code in sorted(foods):
    if code[:2] not in CATEGORY:  # 婴幼儿食品与「其他」（药食两用）不收
        continue
    r = foods[code]
    name = NAME_FIX.get(code) or clean_name(r.get('nameA') or r.get('nameB'))
    if not name or not isinstance(r.get('kcal'), float):
        continue
    row = {'食物编码': code, '食物名称': name, '类别': CATEGORY[code[:2]],
           '出处': '第一册' if r.get('book') == 'b1' else '第二册'}
    for key, label in COLUMNS:
        v = r.get(key)
        row[label] = '' if not isinstance(v, float) else ('%g' % v)
    if not row['食部(%)']:
        row['食部(%)'] = '100'
    rows.append(row)

with open(OUT, 'w', newline='', encoding='utf-8-sig') as fh:
    w = csv.DictWriter(fh, fieldnames=['食物编码', '食物名称', '类别', '出处'] + [c[1] for c in COLUMNS])
    w.writeheader()
    w.writerows(rows)
print(len(rows), 'foods ->', OUT)
