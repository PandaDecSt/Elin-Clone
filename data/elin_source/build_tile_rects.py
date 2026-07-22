#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_tile_rects.py — Elin Block/Floor 像素 rect 提取（权威 atlas 版）

设计（对齐 Elin 源码 / idRenderData_atlas.json）：
  - 每个 Block/Floor 行有 _idRenderData（缺省 fallback 'block'/'floor），
    经 idRenderData_atlas.json 解析出 {atlas, cell=[cw,ch]}。
  - tile 索引编码 = 行×100 + 列（见 RenderData.ConvertTile）：
        col = t % 100 ; row = t // 100
    像素 rect = [col*cw, row*ch, cw, ch]  (网格对齐，精确无歧义)
  - tiles 是 int[]（4 个旋转变体 dir%len），取 tiles[0]；负数表示翻转(flip)。
  - 每个 tile 携带 atlas 字段（roof→roofs 等），供 build_materials / iso.js 取正确图集。
  - 携带 colorMod / colorType（程序化上色字段，供 renderer 使用）。
  - 边界校验：rect 必须落在对应 atlas PNG 尺寸内，越界则跳过并报告。

输出：
  blocks_tile_rects.json  (覆盖全部 215 Block)
  floors_tile_rects.json  (覆盖全部 145 Floor)
格式兼容旧文件（顶层 atlas/cellW/cellH/cols/imageW/imageH + tiles[]），
并在每个 tile 增加 atlas/flip/colorMod/colorType/_idRenderData/_tileType。
"""
import json, os, struct

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..')
ASSETS = os.path.join(SRC, 'assets', 'elin')

def load(fn):
    with open(os.path.join(HERE, fn), encoding='utf-8') as f:
        return json.load(f)

src = load('sources.json')
atlas_map = load('idRenderData_atlas.json')

# ---- PNG 尺寸（无 PIL 依赖，读 IHDR）----
def png_dim(path):
    with open(path, 'rb') as f:
        f.read(8)                      # 签名
        ln = struct.unpack('>I', f.read(4))[0]
        typ = f.read(4)
        assert typ == b'IHDR', typ
        w, h = struct.unpack('>II', f.read(8))
    return w, h

ATLAS_IMG = {}
def ensure_atlas_img(name):
    if name not in ATLAS_IMG:
        ATLAS_IMG[name] = png_dim(os.path.join(ASSETS, name + '.png'))
    return ATLAS_IMG[name]

def resolve(sheet, rd):
    key = rd if rd else ('block' if sheet == 'Block' else 'floor')
    return atlas_map.get(key) or atlas_map['block' if sheet == 'Block' else 'floor']

def gen(sheet, out_fn):
    rows = src['SourceBlock'][sheet]['rows']
    primary = 'blocks' if sheet == 'Block' else 'floors'
    tiles = []
    skipped = []
    for r in rows:
        bid = r.get('id')
        tl = r.get('tiles')
        if not tl:
            skipped.append((bid, 'no tiles')); continue
        t0 = tl[0]
        if t0 is None:
            skipped.append((bid, 'tile0 None')); continue
        flip = t0 < 0
        t = abs(t0)
        a = resolve(sheet, r.get('_idRenderData'))
        aname = a['atlas']; cw, ch = a['cell']
        col = t % 100; row = t // 100
        x = col * cw; y = row * ch; w = cw; h = ch
        iw, ih = ensure_atlas_img(aname)
        if x + w > iw or y + h > ih:
            skipped.append((bid, f'OOB atlas={aname} rect=({x},{y},{w},{h}) img=({iw},{ih})'))
            continue
        tiles.append({
            'id': bid, 'tile': t0, 'col': col, 'row': row,
            'x': x, 'y': y, 'w': w, 'h': h,
            'atlas': aname, 'flip': flip,
            'colorMod': r.get('colorMod'), 'colorType': r.get('colorType'),
            '_idRenderData': r.get('_idRenderData'), '_tileType': r.get('_tileType'),
        })
    # 顶层兼容字段（取主要 atlas）
    pa, pcw, pch = primary, 64, 64
    if primary in atlas_map:
        pcw, pch = atlas_map[primary]['cell']
    piw, pih = ensure_atlas_img(primary)
    out = {
        'atlas': primary,
        'source': 'sources.json + idRenderData_atlas.json (grid-rect from tile index)',
        'decode': 'tile=row*100+col; rect=[col*cw,row*ch,cw,ch]',
        'cellW': pcw, 'cellH': pch,
        'cols': piw // pcw, 'imageW': piw, 'imageH': pih,
        'verified': True, 'count': len(tiles), 'tiles': tiles,
    }
    with open(os.path.join(HERE, out_fn), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'WROTE {out_fn}: {len(tiles)} tiles, skipped={len(skipped)}')
    for s in skipped:
        print('   SKIP', s)

if __name__ == '__main__':
    gen('Block', 'blocks_tile_rects.json')
    gen('Floor', 'floors_tile_rects.json')
