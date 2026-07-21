import json, numpy as np
from PIL import Image
from scipy import ndimage
from collections import defaultdict

TEX_FILES = {
    'objs':    'assets/elin/objs.png',
    'objs_S':  'assets/elin/objs_S.png',
    'objs_SS': 'assets/elin/objs_SS.png',
    'objs_L':  'assets/elin/objs_L.png',
    'objs_C':  'assets/elin/objs_C.png',
    'objs_CL': 'assets/elin/objs_CL.png',
    'objs_CLL':'assets/elin/objs_CLL.png',
    'objs_snow':'assets/elin/objs_snow.png',
    'objs_S_snow':'assets/elin/objs_S_snow.png',
    'objs_L_snow':'assets/elin/objs_L_snow.png',
    'blocks':  'assets/elin/blocks.png',
}

def choose_cell(W):
    # textures that are 2048 -> 32px cells(64 cols); 4096 -> 64px(64 cols); 512 -> 8px(64col); 1920 -> 32px(60 cols)
    if W == 4096: return 64
    if W == 2048: return 32
    if W == 512:  return 8
    if W == 1920: return 32
    return 64

def build_cellmap(path):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    cell = choose_cell(W)
    cols = int(round(W / cell)); rows = int(round(H / cell))
    a = np.array(im)[:, :, 3]
    mask = a > 10
    labeled, n = ndimage.label(mask, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(labeled)
    cellmap = {}
    for sl in objs:
        if sl is None: continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        cx, cy = int(x0 // cell), int(y0 // cell)
        cellmap[(cx, cy)] = [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]
    return cellmap, (W, H, cell, cols, rows)

cellmaps = {}
for name, path in TEX_FILES.items():
    cm, info = build_cellmap(path)
    cellmaps[name] = (cm, info)
    print(f'{name:12s} W={info[0]} cell={info[2]} cols={info[3]} rows={info[4]} occupied={len(cm)}')

data = json.load(open('data/elin_source/obj_map.json'))['entries']
def tiles_of(e):
    t = e['tile']
    return [] if t is None else (t if isinstance(t, list) else [t])

by_rd = defaultdict(list)
for e in data:
    for tt in tiles_of(e):
        by_rd[e['renderData']].append(abs(tt))

for rd, tiles in sorted(by_rd.items(), key=lambda x: -len(x[1])):
    print(f'\n--- renderData={rd!r} ({len(tiles)} tiles) ---')
    scored = []
    for name, (cm, info) in cellmaps.items():
        cols, rows = info[3], info[4]
        hit = 0
        for tt in tiles:
            col, row = tt % 100, tt // 100
            if col < cols and row < rows and (col, row) in cm:
                hit += 1
        scored.append((hit / len(tiles), name, hit))
    scored.sort(reverse=True)
    for rate, name, hit in scored[:4]:
        if rate > 0:
            print(f'    {name:12s} hit={hit}/{len(tiles)} ({rate:.0%})')
