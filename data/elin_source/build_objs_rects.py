import json, numpy as np
from PIL import Image
from scipy import ndimage
import openpyxl

RD_TEXTURE = {
    'obj':           ['objs', 'objs_S'],
    'obj wheat':     ['objs', 'objs_S'],
    'obj_S':         ['objs_S', 'objs'],
    'obj_S flat':    ['objs_S', 'objs'],
    'obj_S fish':    ['objs_S', 'objs'],
    'floor_obj':     ['objs_S', 'objs'],
    'obj_LV':        ['objs', 'objs_L', 'objs_S'],
    'roof':          ['objs_S', 'objs'],
    'block':         ['objs_S', 'blocks', 'objs'],
    'obj road':      ['objs_S', 'objs'],
    'ramp':          ['objs', 'objs_S'],
    'obj road chasm':['objs'],
    'obj tall':      ['objs_L', 'objs', 'objs_S'],
    'obj flat':      ['objs_L', 'objs', 'objs_S'],
    'support':       ['objs', 'objs_S', 'objs_L'],
    None:            ['objs', 'objs_S', 'objs_L'],
}

# Only "real art" textures are candidates. Exclude the tiny mini-variant (objs_SS)
# and the color/light masks (objs_C/CL/CLL) -- they are shader passes, not main art,
# and contain specks that produce false-positive rects.
TEX_FILES = {
    'objs': 'assets/elin/objs.png', 'objs_S': 'assets/elin/objs_S.png',
    'objs_L': 'assets/elin/objs_L.png',
    'objs_snow': 'assets/elin/objs_snow.png',
    'objs_S_snow': 'assets/elin/objs_S_snow.png', 'objs_L_snow': 'assets/elin/objs_L_snow.png',
    'blocks': 'assets/elin/blocks.png',
}

def choose_cell(W):
    return {4096:64, 2048:32, 512:8, 1920:32}.get(W, 64)

def build_cellmap(path):
    im = Image.open(path).convert('RGBA'); W, H = im.size
    cell = choose_cell(W)
    cols = int(round(W / cell)); rows = int(round(H / cell))
    a = np.array(im)[:, :, 3]; mask = a > 10
    struct = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    labeled, n = ndimage.label(mask, structure=struct)
    objs = ndimage.find_objects(labeled)
    # register each sprite under EVERY grid cell its bbox overlaps
    cellmap = {}
    for sl in objs:
        if sl is None: continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        w, h = x1 - x0, y1 - y0
        if w < 2 or h < 2:
            continue
        rect = [int(x0), int(y0), int(w), int(h)]
        cx0, cx1 = int(x0 // cell), int((x1 - 1) // cell)
        cy0, cy1 = int(y0 // cell), int((y1 - 1) // cell)
        for cx in range(cx0, cx1 + 1):
            for cy in range(cy0, cy1 + 1):
                if 0 <= cx < cols and 0 <= cy < rows:
                    cellmap[(cx, cy)] = rect
    return cellmap, (W, H, cell, cols, rows)

print('Building cellmaps...')
cellmaps = {name: build_cellmap(path) for name, path in TEX_FILES.items()}
for name, (cm, info) in cellmaps.items():
    print(f'  {name:12s} cell={info[2]} cols={info[3]} occupied={len(cm)}')

def lookup(col, row, cands):
    # Collect EVERY candidate match (exact at nominal cell + nearest-neighbor
    # rescue for bottom-anchored / overflowing sprites), then prefer the
    # LARGEST sprite. Rationale: Elin obj tiles often overflow into a neighbor
    # cell, so their true art fails the exact test; meanwhile a tiny icon in
    # another atlas (e.g. objs_S) can falsely "exact"-match. Picking the biggest
    # rect recovers the real (large) tree/object art. Tie-break by candidate order.
    matches = []  # (area, cand, rect, how)
    for ci_, cand in enumerate(cands):
        cm, info = cellmaps.get(cand)
        if cm is None: continue
        ccols, crows, c = info[3], info[4], info[2]
        # exact at nominal cell
        if 0 <= col < ccols and 0 <= row < crows and (col, row) in cm:
            r = cm[(col, row)]
            if r[2] >= 4 and r[3] >= 4:
                matches.append((r[2] * r[3], cand, r, 'exact'))
        # nearest-neighbor rescue (reject specks <8px), per-candidate cell size
        maxd = 1.5 * c
        ncx = (col + 0.5) * c; ncy = (row + 0.5) * c
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                cx, cy = col + dx, row + dy
                if 0 <= cx < ccols and 0 <= cy < crows and (cx, cy) in cm:
                    r = cm[(cx, cy)]
                    if r[2] < 8 or r[3] < 8:
                        continue
                    scx = r[0] + r[2] / 2; scy = r[1] + r[3] / 2
                    d = ((scx - ncx) ** 2 + (scy - ncy) ** 2) ** 0.5
                    if d <= maxd:
                        matches.append((r[2] * r[3], cand, r, f'rescue(off {dx},{dy})'))
    if not matches:
        return None, None, None
    # prefer large sprite; tie-break: earlier candidate order (ci_), then exact
    matches.sort(key=lambda m: (-m[0], m[1] != cands[0], 0 if m[3] == 'exact' else 1))
    area, cand, r, how = matches[0]
    return cand, r, how

wb = openpyxl.load_workbook('data/sources/SourceBlock.xlsx', read_only=True, data_only=True)
ws = wb['Obj']; rows = list(ws.iter_rows(values_only=True)); hdr = rows[0]
ci = {h: i for i, h in enumerate(hdr)}
id_i, name_i, tile_i, rd_i = ci['id'], ci['name'], ci['tiles'], ci['_idRenderData']

def norm_tiles(t):
    if t is None: return []
    if isinstance(t, list): return [int(x) for x in t if x is not None]
    if isinstance(t, (int, float)): return [int(t)]
    s = str(t).strip()
    if not s: return []
    out = []
    for p in s.replace(' ', ',').split(','):
        p = p.strip()
        if p:
            try: out.append(int(p))
            except ValueError: pass
    return out

results, missing = [], []
for r in rows[1:]:
    if r[id_i] == 'int': continue
    oid, name, rd = r[id_i], r[name_i], r[rd_i]
    tiles = norm_tiles(r[tile_i])
    if not tiles: continue
    cands = RD_TEXTURE.get(rd, ['objs', 'objs_S'])
    rec = {'id': oid, 'name': name, 'renderData': rd, 'tiles': []}
    for raw in tiles:
        flip = raw < 0; tt = abs(raw)
        col, row = tt % 100, tt // 100
        tex, rect, how = lookup(col, row, cands)
        if tex is None:
            missing.append((oid, rd, raw, col, row))
            rec['tiles'].append({'tile': raw, 'found': False})
        else:
            rec['tiles'].append({'tile': raw, 'tex': tex, 'rect': rect, 'flip': flip, 'found': True, 'how': how})
    results.append(rec)

json.dump(results, open('data/elin_source/objs_tile_rects.json', 'w'), ensure_ascii=False, indent=1)
tot = sum(len(r['tiles']) for r in results)
hit = sum(1 for r in results for t in r['tiles'] if t.get('found'))
exact = sum(1 for r in results for t in r['tiles'] if t.get('how') == 'exact')
resc = hit - exact
print(f'\nTotal obj tiles={tot}  found={hit}  missing={tot-hit} ({hit/tot:.1%})')
print(f'  exact={exact}  rescued={resc}')
for m in missing:
    print('  MISSING', m)
