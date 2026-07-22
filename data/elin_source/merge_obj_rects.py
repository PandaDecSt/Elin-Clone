#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge 策略（安全最小爆炸半径）：
  - 原始 obj_id_rect_orig.json 中属于"碰撞组"（多 id 共享同一 rect，即像素启发式塌缩）
    的 obj → 改用 xlsx 解码值（build_objs_rects_xlsx.py 产出），前提是解码干净（有内容、非 EMPTY/KEEP-ORIG/UNKNOWN）。
  - 其余 obj → 保留原始值（不引入回归）。
输出 obj_id_rect.json。
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))

orig = json.load(open(os.path.join(HERE, 'obj_id_rect_orig.json'), encoding='utf-8'))['OBJ_ID_RECT']
new  = json.load(open(os.path.join(HERE, 'obj_id_rect.json'),     encoding='utf-8'))['OBJ_ID_RECT']
src  = json.load(open(os.path.join(HERE, 'sources.json'),         encoding='utf-8'))['SourceBlock']['Obj']['byId']

# 碰撞组：orig 中 rect 被 >1 id 共享
from collections import Counter
rc = Counter(tuple(v['rect']) for v in orig.values())
collisions = {r for r, c in rc.items() if c > 1}
collision_ids = {k for k, v in orig.items() if tuple(v['rect']) in collisions}

# block/block mount 渲染类型必然属于 blocks 图集，orig 若在 objs/objs_S/objs_L 必错
BLOCK_RENDER = {'block', 'block mount'}
block_ids = {k for k, v in src.items() if v.get('_idRenderData') in BLOCK_RENDER}

final = {}
used_xlsx = 0
for sid in orig:
    in_coll = sid in collision_ids
    force_block = sid in block_ids
    how = new.get(sid, {}).get('how', '')
    clean = ('xlsx' in how) and ('EMPTY' not in how) and ('KEEP-ORIG' not in how) and ('UNKNOWN_RENDER_FALLBACK' not in how) and ('FALLBACK' not in how)
    if (in_coll or force_block) and clean and sid in new:
        final[sid] = dict(new[sid])
        used_xlsx += 1
    else:
        final[sid] = dict(orig[sid])

out = {'OBJ_ID_RECT': final,
       '_meta': {'strategy': 'orig + xlsx-for-collision-ids',
                 'collision_ids': len(collision_ids),
                 'used_xlsx': used_xlsx,
                 'kept_orig': len(final) - used_xlsx}}
with open(os.path.join(HERE, 'obj_id_rect.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print('collision_ids:', len(collision_ids))
print('used_xlsx (fixed):', used_xlsx)
print('kept_orig:', len(final) - used_xlsx)
for k in ['18', '19', '23', '28', '29', '30', '95', '96']:
    print('  ', k, '->', final[k]['tex'], final[k]['rect'])
