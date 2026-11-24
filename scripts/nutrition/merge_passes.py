# 合并两遍 OCR（300dpi 与 400dpi）的逐格读数。
# 两遍一致直接采用；只有一遍读到就用那一遍；不一致时按该列印刷格式（小数位数）判断哪一遍丢了小数点，
# 仍判断不了的列入 review，交给 finalize_table.py 的人工核对表处理。
# 用法：python3 -I merge_passes.py <passA.json> <passB.json> <out.json>
import json, sys, re
A = json.load(open(sys.argv[1]))['foods']; B = json.load(open(sys.argv[2]))['foods']
DEC = {'edible':0,'water':1,'kcal':0,'kJ':0,'protein':1,'fat':1,'cho':1,'fiber':1,'cholesterol':0,'ash':1,'vitA':0,'carotene':0,'retinol':0,
       'thiamin':2,'riboflavin':2,'niacin':2,'vitC':None,'vitE':2,'aE':2,'bgE':2,'dE':2,'Ca':0,'P':0,'K':0,'Na':1,'Mg':0,'Fe':1,'Zn':2,'Se':2,'Cu':2,'Mn':2}
FIELDS = list(DEC)
def norm(f, raw):
    """returns (value, quality) ; quality: ok / repaired / odd"""
    if raw is None: return None, 'none'
    if raw == 'Tr': return 0.0, 'ok'
    if not raw[0].isdigit(): return None, 'dash'
    k = DEC[f]
    if k is None: return float(raw), 'ok'
    if '.' in raw:
        d = len(raw.split('.')[1])
        return float(raw), ('ok' if d == k else 'odd')
    if k == 0 or raw.strip('0') == '': return float(raw), 'ok'
    s = raw.rjust(k + 1, '0')
    return float(s[:-k] + '.' + s[-k:]), 'repaired'
out = {}; review = []
for code in sorted(set(A) | set(B)):
    a, b = A.get(code, {}), B.get(code, {})
    ra, rb = a.get('_raw', {}), b.get('_raw', {})
    rec = {'code': code, 'nameA': a.get('name'), 'nameB': b.get('name'), 'remark': a.get('remark') or b.get('remark') or '',
           'book': a.get('book') or b.get('book'), 'pos': {}}
    for f in FIELDS:
        va, qa = norm(f, ra.get(f)); vb, qb = norm(f, rb.get(f))
        pos = a.get('_pos', {}).get(f) or (b.get('_pos', {}).get(f))
        rec['pos'][f] = pos
        if qa in ('none', 'dash') and qb in ('none', 'dash'):
            rec[f] = None; continue
        if qa in ('none', 'dash'): rec[f] = vb; q = qb
        elif qb in ('none', 'dash'): rec[f] = va; q = qa
        elif va == vb: rec[f] = va; q = 'ok' if 'ok' in (qa, qb) else qa
        else:
            good = [(v, q) for v, q in ((va, qa), (vb, qb)) if q == 'ok']
            if len(good) == 1: rec[f], q = good[0]
            else:
                rec[f] = va; q = 'conflict'
                review.append((code, f, ra.get(f), rb.get(f)))
                continue
        if q in ('odd',): review.append((code, f, ra.get(f), rb.get(f)))
        if q == 'repaired': rec.setdefault('_repaired', []).append(f)
    out[code] = rec
json.dump({'foods': out, 'review': review}, open(sys.argv[3], 'w'), ensure_ascii=False, indent=0)
print('foods', len(out), 'review', len(review))
for r in review: print(r, out[r[0]]['nameA'])
