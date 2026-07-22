import re
from collections import Counter

def parse(fn):
    d = {}
    pat = re.compile(r'(\d+):\{tex:"([^"]+)",rect:\[(\d+),(\d+),(\d+),(\d+)\],flip:(true|false)')
    for line in open(fn, encoding='utf-8'):
        m = pat.search(line)
        if m:
            d[int(m.group(1))] = {
                'tex': m.group(2),
                'rect': [int(m.group(3)), int(m.group(4)), int(m.group(5)), int(m.group(6))],
                'flip': m.group(7) == 'true',
            }
    return d

old = parse('obj_id_rect.old.js')
new = parse('obj_id_rect.js')
print('old entries:', len(old), ' new entries:', len(new))

changed_tex = []
changed_rect = []
same = 0
only_old = []
only_new = []
for oid in set(old) | set(new):
    o = old.get(oid); n = new.get(oid)
    if o and not n:
        only_old.append(oid); continue
    if n and not o:
        only_new.append(oid); continue
    if o['tex'] != n['tex']:
        changed_tex.append((oid, o['tex'], n['tex'], o['rect'], n['rect']))
    elif o['rect'] != n['rect']:
        changed_rect.append((oid, o['tex'], o['rect'], n['rect']))
    else:
        same += 1

print(f'same={same}  tex_changed={len(changed_tex)}  rect_changed(same_tex)={len(changed_rect)}')
print('only_old(dropped):', sorted(only_old))
print('only_new(added):', sorted(only_new))

print('\n=== 图集归属变更 (旧 -> 新) ===')
for oid, ot, nt, orc, nrc in sorted(changed_tex):
    print(f'  obj {oid:3d}: {ot:9s} -> {nt:9s}  {orc} -> {nrc}')

print('\n=== 同图集但 rect 变化（按图集统计）===')
cc = Counter(t[1] for t in changed_rect)
print('  ', dict(cc))
for oid, tex, orc, nrc in sorted(changed_rect)[:60]:
    print(f'  obj {oid:3d} [{tex:8s}]: {orc} -> {nrc}')
