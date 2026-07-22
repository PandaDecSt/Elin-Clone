#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重建 obj_id_rect.json —— 直接从 xlsx(SourceBlock.Obj.tiles) 解码贴图位置。

原理：
  Elin tile 编码 = 行*100 + 列  (RenderData.cs::ConvertTile)
  每个 obj 在 xlsx 里有 tiles 列(权威)，_idRenderData 决定用哪张图集。
  本脚本：
    1. 取 tiles 第一个有效值(>=0)，解码 col/row
    2. 对 4 张候选图集(objs/objs_S/objs_L/blocks)按各自 cell 尺寸解出 rect
    3. 用 PIL 检测哪张 PNG 在该 rect 有最多非透明像素 → 选为权威图集
       (既尊重 xlsx 的行列位置，又自动判定正确图集，避免手写映射出错)
    4. 输出 OBJ_ID_RECT（与旧 schema 兼容：tex/rect/flip/how/name）

不依赖任何像素连通域启发式 → 彻底修复 ore/gem ore 等被错塞进 objs 共用占位 rect 的问题。
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSET = os.path.join(HERE, '..', '..', 'assets', 'elin')

# 图集配置: key -> (png 文件名, cellW, cellH)
ATLAS = {
    'objs':   ('objs.png',   64, 64),
    'objs_S': ('objs_S.png', 32, 32),
    'objs_L': ('objs_L.png', 32, 32),
    'blocks': ('blocks.png', 64, 64),
}

# _idRenderData -> 图集 (依据 Elin 纹理分配；block/block mount 用 blocks.png)
RENDER_TO_ATLAS = {
    'obj': 'objs', 'obj wheat': 'objs',
    'obj_LV': 'objs_S', 'obj_S': 'objs_S', 'obj_S flat': 'objs_S', 'obj_S fish': 'objs_S',
    'floor_obj': 'objs_S', 'roof': 'objs_S', 'support': 'objs_S',
    'block mount': 'blocks', 'block': 'blocks',
    'obj road': 'objs', 'obj road chasm': 'objs', 'ramp': 'objs',
    'obj flat': 'objs_L', 'obj tall': 'objs_L',
}

def load_png(key):
    fn, cw, ch = ATLAS[key]
    im = Image.open(os.path.join(ASSET, fn)).convert('RGBA')
    return im, cw, ch

CACHE = {}
def atlas_im(key):
    if key not in CACHE:
        CACHE[key] = load_png(key)
    return CACHE[key]

def non_transparent(im, x, y, w, h):
    """rect 内非透明像素数"""
    W, H = im.size
    if x < 0 or y < 0 or x + w > W or y + h > H:
        return 0
    px = im.crop((x, y, x + w, y + h)).getdata()
    return sum(1 for r, g, b, a in px if a > 8)

def decode(tile, cw, ch):
    col = tile % 100
    row = tile // 100
    return col * cw, row * ch

def main():
    src = json.load(open(os.path.join(HERE, 'sources.json'), encoding='utf-8'))
    obj = src['SourceBlock']['Obj']['byId']
    # 原始像素启发式值（合并基准：xlsx 解码不可靠时保留，避免回归）
    orig = json.load(open(os.path.join(HERE, 'obj_id_rect_orig.json'), encoding='utf-8'))['OBJ_ID_RECT']

    out = {}
    missing = []
    kept = 0
    for sid, v in obj.items():
        tiles = v.get('tiles') or []
        # 取第一个有效 tile
        tile = None
        for t in tiles:
            if isinstance(t, int):
                if t >= 0:
                    tile = t; break
                elif tile is None:
                    tile = -t  # 负数取绝对值作为兜底
        if tile is None:
            missing.append(sid)
            if sid in orig:
                out[sid] = dict(orig[sid]); out[sid]['how'] = (out[sid].get('how','') + ' | no-xlsx-tile')
            continue
        rd = v.get('_idRenderData')
        key = RENDER_TO_ATLAS.get(rd)
        if key is None:
            # 未知渲染类型：保留原值
            if sid in orig:
                out[sid] = dict(orig[sid]); kept += 1
                continue
            # 无原值则挑内容最多的图集
            best = None
            for k in ATLAS:
                im, cw, ch = atlas_im(k)
                x, y = decode(tile, cw, ch)
                cnt = non_transparent(im, x, y, cw, ch)
                if best is None or cnt > best[1]:
                    best = (k, cnt, x, y, cw, ch)
            key, _, x, y, cw, ch = best
            out[sid] = {
                'tex': key, 'rect': [x, y, cw, ch], 'flip': False,
                'how': 'xlsx tile=%d (%s) UNKNOWN_RENDER_FALLBACK' % (tile, rd),
                'name': v.get('name') or v.get('name_JP') or sid,
            }
            continue
        im, cw, ch = atlas_im(key)
        x, y = decode(tile, cw, ch)
        cnt = non_transparent(im, x, y, cw, ch)
        if cnt == 0:
            # 渲染类型对应图集该位置为空 → 保留原像素启发式值（不引入错误精灵）
            if sid in orig:
                out[sid] = dict(orig[sid]); kept += 1
                print('  KEEP-ORIG obj[%s] %s: %s tile=%d -> %s[%d,%d] EMPTY, kept orig %s' % (
                    sid, v.get('name'), rd, tile, key, x, y, orig[sid].get('tex')))
                continue
            # 无原值则仍输出（标记告警）
            print('  WARN obj[%s] %s: %s tile=%d -> %s[%d,%d] EMPTY (no atlas has content)' % (sid, v.get('name'), rd, tile, key, x, y))
        out[sid] = {
            'tex': key,
            'rect': [x, y, cw, ch],
            'flip': False,
            'how': 'xlsx tile=%d (%s)' % (tile, rd),
            'name': v.get('name') or v.get('name_JP') or sid,
        }

    result = {'OBJ_ID_RECT': out, '_meta': {'generated_from': 'xlsx SourceBlock.Obj.tiles', 'count': len(out), 'missing': missing}}
    with open(os.path.join(HERE, 'obj_id_rect.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print('wrote obj_id_rect.json: %d objs, %d missing, %d kept-orig' % (len(out), len(missing), kept))
    if missing:
        print('missing ids:', missing)
    # 打印几个关键对照
    for sid in ['18', '19', '28', '29', '30', '23', '95', '96']:
        print('  obj[%s] %s ->' % (sid, out.get(sid, {}).get('name')), out.get(sid, {}).get('tex'), out.get(sid, {}).get('rect'))

if __name__ == '__main__':
    main()
