# 版面解析：把 OCR 文字块按坐标归到「食物编码行 × 数值列」，带页面倾斜校正。
import json, re, sys, glob, statistics
from collections import defaultdict

DASHES = set('—–-一－_~')
def clean(t):
    t = t.strip().replace(' ', '').rstrip('*＊').lstrip('*＊')
    t = t.replace('O', '0').replace('o', '0') if re.fullmatch(r'[\dOo.]+', t) else t
    return t

def kind(t):
    if re.fullmatch(r'\d+(\.\d+)?', t): return 'num'
    if t in ('Tr', 'tr', 'TR', 'Ir', 'Tt', 'T'): return 'tr'
    if t and all(c in DASHES for c in t): return 'dash'
    return 'text'

SCALE = 1.0
def tokens(page):
    out = []
    for it0 in page['items']:
        it = dict(it0)
        for k in ('x', 'y', 'w', 'h'): it[k] = it0[k] * SCALE
        parts = it['text'].split()
        if not parts: continue
        total = sum(len(p) for p in parts) + len(parts) - 1
        pos = 0
        for p in parts:
            x0 = it['x'] + it['w'] * pos / total
            x1 = it['x'] + it['w'] * (pos + len(p)) / total
            pos += len(p) + 1
            t = clean(p)
            out.append({'t': t, 'k': kind(t), 'cx': (x0 + x1) / 2, 'x0': x0, 'x1': x1,
                        'cy': it['y'] + it['h'] / 2, 'conf': it['conf'], 'h': it['h']})
    return out

CODE = re.compile(r'^(\d{6}x?)$')

def parse_page(path):
    page = json.load(open(path))
    toks = tokens(page)
    hdr = [t for t in toks if t['t'] in ('Food', 'code', 'Foodcode') or t['t'].startswith('Food')]
    head_y = max([t['cy'] for t in toks if t['t'] in ('Edible', 'Niacin', 'Water', 'Ca', 'Na', 'Remark')] or [400])
    is_right = any(t['t'] in ('Niacin', 'Remark', 'Na', 'Mn') for t in toks)
    codes = [t for t in toks if CODE.match(t['t']) and t['cx'] < 450 and t['cy'] > head_y + 60]
    codes.sort(key=lambda t: t['cy'])
    if not codes: return page['page'], is_right, []
    name_x0 = min(c['x1'] for c in codes) + 5
    # value column start: header x of first numeric column
    first_col = [t['x0'] for t in toks if t['t'] in (('Niacin',) if is_right else ('Edible',)) ]
    val_x0 = (first_col[0] - 40) if first_col else 760
    foot_y = codes[-1]['cy'] + 120
    vals = [t for t in toks if t['k'] in ('num', 'tr', 'dash') and t['x0'] >= val_x0 and head_y + 60 < t['cy'] < foot_y]
    names = [t for t in toks if t['k'] == 'text' and name_x0 <= t['x0'] < val_x0 and head_y + 60 < t['cy'] < foot_y]
    remarks = [t for t in toks if t['k'] == 'text' and t['x0'] >= val_x0 and head_y + 60 < t['cy'] < foot_y]
    # skew: choose slope minimizing distance to nearest code row
    cys = [c['cy'] for c in codes]
    def cost(s):
        tot = 0
        for v in vals:
            y = v['cy'] - s * (v['cx'] - 300)
            tot += min(min(abs(y - c) for c in cys), 40) ** 2
        return tot
    best = min((cost(s / 2000.0), s / 2000.0) for s in range(-40, 41))[1]
    rows = [{'code': c['t'], 'cy': c['cy'], 'vals': [], 'name': [], 'remark': []} for c in codes]
    def nearest(t):
        y = t['cy'] - best * (t['cx'] - 300)
        i = min(range(len(rows)), key=lambda i: abs(rows[i]['cy'] - y))
        return i, abs(rows[i]['cy'] - y)
    for v in vals:
        i, d = nearest(v)
        if d < 32: rows[i]['vals'].append(v)
    for n in names:
        i, d = nearest(n)
        if d < 32: rows[i]['name'].append(n)
    for n in remarks:
        i, d = nearest(n)
        if d < 32: rows[i]['remark'].append(n)
    rows = [r for r in rows if r['name']]
    return page['page'], is_right, rows, vals, best

def columns(all_vals, expected):
    xs = sorted(v['cx'] for v in all_vals)
    groups = [[xs[0]]]
    for x in xs[1:]:
        if x - groups[-1][-1] > 38: groups.append([x])
        else: groups[-1].append(x)
    groups = [g for g in groups if len(g) >= 3]
    return [statistics.median(g) for g in groups]
