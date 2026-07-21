#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Elin 导出的 .z 地图生成「渲染专用精简 JSON」(casino_render.json)。
结构:
  meta:   { name, id, w, h, seed, version }
  floors: [w*h] int8  二进制地板层 tile id
  blocks: [w*h] int8  二进制方块层 tile id
  objs:   [w*h] int8  二进制装饰层 tile id
  cards:  [{ rawType, id, name, x, y, ints, strs }]  摆放的物件/角色
卡片 name 用 data/elin_source 的 *_map.json 解析(源表权威名)。
"""
import json, os, zipfile, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'elin_source') if os.path.isdir(os.path.join(HERE, 'elin_source')) else HERE

def load_source_index():
    """把 obj/thing/block/floor 源表拼成 id->name / tile->name 两个索引。"""
    idx = {'id2name': {}, 'tile2name': {}, 'tile2sheet': {}}
    def add(path, kind):
        if not os.path.exists(path): return
        try:
            d = json.load(open(path, encoding='utf-8'))
        except Exception:
            return
        for e in d.get('entries', []):
            eid = e.get('id')
            name = e.get('name') or e.get('displayName')
            tile = e.get('tile')
            sheet = e.get('sheet')
            if eid and name:
                idx['id2name'].setdefault(str(eid), name)
            if tile is not None:
                tiles = tile if isinstance(tile, list) else [tile]
                for t in tiles:
                    if isinstance(t, int):
                        idx['tile2name'].setdefault(t, name)
                        if sheet: idx['tile2sheet'].setdefault(t, sheet)
    add(os.path.join(SRC, 'obj_map.json'), 'obj')
    add(os.path.join(SRC, 'thing_map.json'), 'thing')
    add(os.path.join(SRC, 'block_map.json'), 'block')
    add(os.path.join(SRC, 'floor_map.json'), 'floor')
    add(os.path.join(SRC, 'deco_map.json'), 'deco')
    return idx

def resolve_card_name(card_id, raw_type, idx):
    if card_id is None: return None
    s = str(card_id)
    if s in idx['id2name']:
        return idx['id2name'][s]
    # 数字 uid 可能落在 tile 索引上
    try:
        t = int(card_id)
        if t in idx['tile2name']:
            return idx['tile2name'][t]
    except (ValueError, TypeError):
        pass
    return None

def parse(zpath):
    with zipfile.ZipFile(zpath) as z:
        names = set(z.namelist())
        meta = json.loads(z.read('meta').decode('utf-8', 'replace')) if 'meta' in names else {}
        game = json.loads(z.read('map').decode('utf-8', 'replace')) if 'map' in names else {}
        w = h = None
        if 'Size' in game:
            sz = game['Size']
            w = h = sz if isinstance(sz, int) else None
        if w is None:
            # 从 floors 层长度反推
            for layer in ('floors', 'blocks'):
                if layer in names:
                    L = len(z.read(layer))
                    if L > 0:
                        import math
                        side = int(math.isqrt(L))
                        if side * side == L:
                            w = h = side
                            break
        # 二进制层
        def layer(name):
            if name not in names: return []
            data = z.read(name)
            return list(data)
        floors = layer('floors')
        blocks = layer('blocks')
        objs = layer('objs')
        # export cards
        cards = []
        if 'export' in names:
            ex = json.loads(z.read('export').decode('utf-8', 'replace'))
            sc = ex.get('serializedCards', {})
            raw = sc.get('cards', [])
            for c in raw:
                strs = c.get('strs', [])
                ints = c.get('ints', [])
                raw_type = strs[4] if len(strs) > 4 else None
                cid = strs[0] if len(strs) > 0 else None
                x = ints[5] if len(ints) > 5 else None
                y = ints[6] if len(ints) > 6 else None
                cards.append({
                    'rawType': raw_type,
                    'id': cid,
                    'name': None,  # 稍后解析
                    'x': x, 'y': y,
                    'ints': ints, 'strs': strs,
                })
    return meta, game, w, h, floors, blocks, objs, cards

def main():
    zpath = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'assets', 'map', 'casino.z')
    zpath = os.path.abspath(zpath)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'casino_render.json')
    print('decode:', zpath)
    meta, game, w, h, floors, blocks, objs, cards = parse(zpath)
    idx = load_source_index()
    for c in cards:
        c['name'] = resolve_card_name(c['id'], c['rawType'], idx)
        # 去掉超长 strs/ints 中无用的尾部，保留前若干便于检视
        c['strs'] = c['strs'][:8]
        c['ints'] = c['ints'][:12]
    # 统计
    from collections import Counter
    rt = Counter(c['rawType'] for c in cards)
    print('w,h=', w, h, 'floors', len(floors), 'blocks', len(blocks), 'objs', len(objs), 'cards', len(cards))
    print('card rawType dist:', dict(rt))
    named = sum(1 for c in cards if c['name'])
    print('cards with resolved name:', named)
    out_obj = {
        'meta': {
            'name': meta.get('name') or game.get('name'),
            'id': meta.get('id'),
            'w': w, 'h': h,
            'seed': game.get('seed'),
            'version': game.get('version'),
        },
        'floors': floors,
        'blocks': blocks,
        'objs': objs,
        'cards': cards,
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(',', ':'))
    print('written:', out, os.path.getsize(out), 'bytes')

if __name__ == '__main__':
    main()
