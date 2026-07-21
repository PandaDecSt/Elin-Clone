import json, numpy as np
from PIL import Image
from scipy import ndimage

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

def build_cellmap(path, cell):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    a = np.array(im)[:, :, 3]
    mask = a > 10
    cols = int(round(W / cell)); rows = int(round(H / cell))
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

# build candidate cellmaps: for each texture, choose cell by width
cellmaps = {}
for name, path in TEX_FILES.items():
    im = Image.open(path); W, H = im.size
    # pick cell so that cols ~ 64 (standard Elin tiling) when possible, else 32
    for cell in (64, 32, 8):
        cols = W / cell
        if cols >= 32 and abs(cols - round(cols)) < 1e-6:
            cm, info = build_cellmap(path, cell)
            cellmaps[(name, cell)] = (cm, info)
            print(f'{name:12s} W={W} cell={cell} cols={info[3]} rows={info[4]} occupied={len(cm)}')
            break

data = json.load(open('data/elin_source/obj_map.json'))['entries']
def tiles_of(e):
    t = e['tile']
    return [] if t is None else (t if isinstance(t, list) else [t])

# For each sheet, test hit rate against each (texture,cell) candidate
from collections import defaultdict
by_sheet = defaultdict(list)
for e in data:
    for tt in tiles_of(e):
        by_sheet[e['sheet']].append(abs(tt))

for sh, tiles in by_sheet.items():
    print(f'\n--- sheet {sh} ({len(tiles)} tiles) ---')
    best = None
    for (name, cell), (cm, info) in cellmaps.items():
        cols = info[3]
        hit = 0
        for tt in tiles:
            col, row = tt % 100, tt // 100
            if col >= cols or row >= info[4]:
                continue
            if (col, row) in cm:
                hit += 1
        rate = hit / len(tiles)
        flag = '  <== BEST' if (best is None or rate > best[0]) else ''
        if rate > 0:
            print(f'   {name:12s} cell={cell} hit={hit}/{len(tiles)} ({rate:.0%}){flag}')
        if best is None or rate > best[0]:
            best = (rate, name, cell)
