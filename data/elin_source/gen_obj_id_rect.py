#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert objs_tile_rects.json (per-id, possibly multi-tile) into the
OBJ_ID_RECT lookup used by js/materials.js and runtime code.

For each obj id we keep the single tile with the LARGEST bounding-box area
(multi-tile objects such as fossil trees collapse to their biggest frame).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.path.join(HERE, 'objs_tile_rects.json'), encoding='utf-8'))
entries = src if isinstance(src, list) else src['entries']

OBJ_ID_RECT = {}
for r in entries:
    oid = r['id']
    best = None
    for t in r['tiles']:
        if not t.get('found'):
            continue
        rect = t['rect']
        area = rect[2] * rect[3]
        if best is None or area > best[0]:
            best = (area, t)
    if best is None:
        continue
    t = best[1]
    OBJ_ID_RECT[str(oid)] = {
        'tex': t['tex'],
        'rect': t['rect'],
        'flip': bool(t.get('flip')),
        'how': t.get('how'),
        'name': r.get('name'),
    }

out = {'OBJ_ID_RECT': OBJ_ID_RECT}
with open(os.path.join(HERE, 'obj_id_rect.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

# also emit the .js form used by the map-viewer / runtime
lines = ['// AUTO-GENERATED from objs_tile_rects.json (build_objs_rects.py)',
         '//  largest-tile-per-id; obj_LV trees now resolve to big objs/objs_L sprites',
         'const OBJ_ID_RECT = {']
for oid, v in OBJ_ID_RECT.items():
    lines.append(f'{oid}:{{tex:"{v["tex"]}",rect:[{v["rect"][0]},{v["rect"][1]},{v["rect"][2]},{v["rect"][3]}],flip:{str(v["flip"]).lower()}}},')
lines.append('};')
if os.environ.get('EMIT_JS'):
    with open(os.path.join(HERE, 'obj_id_rect.js'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

print(f'OBJ_ID_RECT entries: {len(OBJ_ID_RECT)}')
