# 把 ocr.swift 输出的逐页 OCR 结果还原成「表一 能量和食物一般营养成分」的逐食物记录。
# 左页（食部…核黄素 15 列）与右页（烟酸…锰 16 列 + 备注）按食物编码拼成一行。
#
# 用法：python3 -I parse_pages.py <ocr_root> <out.json> <scale> <第一册目录> <第二册目录>
#   scale：把坐标换算回 300dpi，300dpi 那遍填 1，400dpi 那遍填 0.75。
import sys, json, glob, re, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from table_layout import *
import table_layout as P
base = sys.argv[1]
OUT = sys.argv[2]
P.SCALE = float(sys.argv[3])
DIRS = {'b1': sys.argv[4], 'b2': sys.argv[5]}
L_COLS = ['edible','water','kcal','kJ','protein','fat','cho','fiber','cholesterol','ash','vitA','carotene','retinol','thiamin','riboflavin']
R_COLS = ['niacin','vitC','vitE','aE','bgE','dE','Ca','P','K','Na','Mg','Fe','Zn','Se','Cu','Mn']
# PDF 页码（扫描件页码，不是书上印的页码）。第二册跳过 13 婴幼儿食品（169–198 页）。
PAGES = {'b1': list(range(52,64))+list(range(66,70))+list(range(72,80))+list(range(82,110))+list(range(112,118))+list(range(120,138))+list(range(140,146))+[148,149],
         'b2': list(range(77,95))+list(range(97,105))+list(range(107,135))+list(range(137,141))+list(range(143,167))+[201,202,205,206]}
foods = {}
issues = []
parsed = {}
templates = {}
for book, pages in PAGES.items():
    for p in pages:
        f = f'{base}/{DIRS[book]}/p{p:03d}.json'
        pg, right, rows, vals, skew = parse_page(f)
        names = R_COLS if right else L_COLS
        cols = columns(vals, len(names))
        parsed[(book, p)] = (right, rows, vals, cols if len(cols) == len(names) else None)
        if len(cols) == len(names):
            templates.setdefault((book, right), []).append(cols)
def fit(vals, temps):
    best = None
    for tmp in temps:
        for dx in range(-200, 201, 2):
            score = 0
            for v in vals:
                d = min(abs(c + dx - v['cx']) for c in tmp)
                score += 1 if d < 25 else 0
            if best is None or score > best[0]:
                best = (score, [c + dx for c in tmp])
    return best
for book, pages in PAGES.items():
    for p in pages:
        right, rows, vals, cols = parsed[(book, p)]
        names = R_COLS if right else L_COLS
        if cols is None:
            score, cols = fit(vals, templates[(book, right)][:12])
            issues.append((book, p, 'fitted', score, len(vals)))
        for r in rows:
            cells = [[] for _ in names]
            for v in r['vals']:
                j = min(range(len(cols)), key=lambda j: abs(cols[j] - v['cx']))
                if abs(cols[j] - v['cx']) < 60: cells[j].append(v)
            rec = foods.setdefault(r['code'], {'code': r['code'], 'book': book, 'pages': []})
            rec['pages'].append(p)
            if not right:
                nm = ''.join(t['t'] for t in sorted(r['name'], key=lambda t: (round(t['cy']/30), t['x0'])))
                rec['name'] = nm
            else:
                rec['remark'] = ''.join(t['t'] for t in r['remark'])
                rec.setdefault('nameR', ''.join(t['t'] for t in sorted(r['name'], key=lambda t: (round(t['cy']/30), t['x0']))))
            for n, c in zip(names, cells):
                if len(c) > 1:
                    c.sort(key=lambda t: -t['conf'])
                    rec.setdefault('multi', []).append(n + ':' + '/'.join(t['t'] for t in c))
                if not c:
                    rec.setdefault(n, None)
                else:
                    t = c[0]
                    v = float(t['t']) if t['k']=='num' else (0.0 if t['k']=='tr' else 'dash')
                    if rec.get(n) is None:
                        rec[n] = v
                        rec.setdefault('_raw', {})[n] = t['t']
                        rec.setdefault('_pos', {})[n] = [round(t['cx'] / P.SCALE), round(t['cy'] / P.SCALE), p]
json.dump({'foods': foods, 'issues': issues}, open(OUT, 'w'), ensure_ascii=False, indent=0)
print('foods', len(foods), 'issues', issues)
