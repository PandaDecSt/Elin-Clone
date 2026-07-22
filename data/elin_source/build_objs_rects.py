#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Re-bake objs_tile_rects.json using GROUND-TRUTH atlas + cell.

Replaces the old heuristic RD_TEXTURE / choose_cell with values extracted
directly from the game's RenderData assets (idRenderData_atlas.json, produced
by extract_render_truth.py). For every obj we now know its true atlas
(_idRenderData -> MeshPass.m_Name) and true cell (texture size / tiling),
so the sprite rect is computed against the correct atlas PNG at the correct
grid origin. This fixes, among others:
  - objs_L cell 80x32 -> 80x64 (shifts/resizes all obj_L / obj_LV sprites)
  - obj tall/obj flat -> objs (not objs_L)
  - obj_LV* -> objs_L (not objs_S)
  - roof -> roofs (newly needed atlas)
  - support/scaffold/ramp -> blocks
  - floor_obj/obj road/obj road chasm -> floors
"""
import json, os, numpy as np
from PIL import Image
from scipy import ndimage
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # project root

# ---- ground-truth atlas -> cell (from idRenderData_atlas.json) ----
ATLAS = json.load(open(os.path.join(HERE, 'idRenderData_atlas.json'), encoding='utf-8'))

# Only the "art" atlases that obj sprites live in. Masks (objs_C/CL/CLL),
# effects and fov are not simple sprite atlases and are excluded.
ART_ATLASES = {'objs', 'objs_S', 'objs_L', 'blocks', 'floors', 'roofs'}

TEX_FILES = {
    'objs':    os.path.join(ROOT, 'assets/elin/objs.png'),
    'objs_S':  os.path.join(ROOT, 'assets/elin/objs_S.png'),
    'objs_L':  os.path.join(ROOT, 'assets/elin/objs_L.png'),
    'blocks':  os.path.join(ROOT, 'assets/elin/blocks.png'),
    'floors':  os.path.join(ROOT, 'assets/elin/floors.png'),
    'roofs':   os.path.join(ROOT, 'assets/elin/roofs.png'),
}

# derive atlas -> cell from the ground-truth table (cell is per-rd but
# consistent within an atlas)
ATLAS_CELL = {}
for rd, info in ATLAS.items():
    a, c = info['atlas'], info['cell']
    if a in ART_ATLASES and a not in ATLAS_CELL:
        ATLAS_CELL[a] = (int(c[0]), int(c[1]))


def build_cellmap(path, cell):
    """Register every sprite under EACH grid cell its bbox overlaps.

    Elin sprites are often bottom-anchored and overflow into the cell above,
    so the tile-cell CENTER can fall in the sprite's transparent margin. By
    registering the sprite on every cell it touches, an exact lookup at
    (col,row) recovers the real (large) art. Returns { (cx,cy): [rect,...] }.
    """
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    cw, ch = cell
    cols = int(round(W / cw))
    rows = int(round(H / ch))
    a = np.array(im)[:, :, 3]
    mask = a > 10
    struct = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    labeled, n = ndimage.label(mask, structure=struct)
    objs = ndimage.find_objects(labeled)
    cellmap = {}
    for sl in objs:
        if sl is None:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        w, h = x1 - x0, y1 - y0
        if w < 2 or h < 2:
            continue
        rect = [int(x0), int(y0), int(w), int(h)]
        cx0, cx1 = int(x0 // cw), int((x1 - 1) // cw)
        cy0, cy1 = int(y0 // ch), int((y1 - 1) // ch)
        for cx in range(cx0, cx1 + 1):
            for cy in range(cy0, cy1 + 1):
                if 0 <= cx < cols and 0 <= cy < rows:
                    cellmap.setdefault((cx, cy), []).append(rect)
    return cellmap, (W, H, cell, cols, rows)


def lookup_at(col, row, cellmap, info):
    """Find the sprite for grid cell (col,row) in a SINGLE authoritative atlas.

    Exact: any sprite registered at (col,row); prefer the largest (reject
    specks <4px) so a real tree wins over a stray icon in the same cell.
    Rescue: nearest sprite center within 1.5*cell (reject specks <8px).
    """
    ccols, crows, cell = info[3], info[4], info[2]
    cw, ch = cell[0], cell[1]
    if 0 <= col < ccols and 0 <= row < crows:
        lst = cellmap.get((col, row))
        if lst:
            big = [r for r in lst if r[2] >= 4 and r[3] >= 4]
            if big:
                return max(big, key=lambda r: r[2] * r[3]), 'exact'
    # nearest-neighbor rescue (reject specks <8px), per-atlas cell size
    maxd = 1.5 * max(cw, ch)
    ncx = (col + 0.5) * cw
    ncy = (row + 0.5) * ch
    best, bestd = None, 1e18
    for (cx, cy), lst in cellmap.items():
        if abs(cx - col) > 2 or abs(cy - row) > 2:
            continue
        for r in lst:
            if r[2] < 8 or r[3] < 8:
                continue
            scx = r[0] + r[2] / 2.0
            scy = r[1] + r[3] / 2.0
            d = ((scx - ncx) ** 2 + (scy - ncy) ** 2) ** 0.5
            if d <= maxd and d < bestd:
                best, bestd = r, d
    if best:
        return best, 'rescue(off %.1f)' % bestd
    return None, None


print('Building cellmaps (ground-truth cells)...')
cellmaps = {}
infos = {}
for name, path in TEX_FILES.items():
    cell = ATLAS_CELL[name]
    cm, info = build_cellmap(path, cell)
    cellmaps[name] = cm
    infos[name] = info
    print(f'  {name:8s} cell={cell} size={info[0]}x{info[1]} occupied={len(cm)}')

# Read obj definitions from sources.json (the same baked source that
# materials.js consumes) so that renderData / atlas stay consistent with the
# runtime. Some xlsx _idRenderData cells are blank while sources.json carries
# the real value (e.g. obj 145 'egg' -> 'support').
src = json.load(open(os.path.join(ROOT, 'data/elin_source', 'sources.json'), encoding='utf-8'))
obj_src = src['SourceBlock']['Obj']['byId']


def norm_tiles(t):
    if t is None:
        return []
    if isinstance(t, list):
        return [int(x) for x in t if x is not None]
    if isinstance(t, (int, float)):
        return [int(t)]
    s = str(t).strip()
    if not s:
        return []
    out = []
    for p in s.replace(' ', ',').split(','):
        p = p.strip()
        if p:
            try:
                out.append(int(p))
            except ValueError:
                pass
    return out


results, missing = [], []
for oid, v in obj_src.items():
    if not isinstance(v, dict):
        continue
    oid = int(oid)
    name = v.get('name')
    rd = v.get('_idRenderData')
    tiles = norm_tiles(v.get('tiles'))
    if not tiles:
        continue
    rec = {'id': oid, 'name': name, 'renderData': rd, 'tiles': []}
    if rd not in ATLAS or ATLAS[rd]['atlas'] not in ART_ATLASES:
        # no sprite rect available (mask/effect/fov atlas or unknown rd)
        missing.append((oid, rd, 'no-art-atlas'))
        rec['tiles'].append({'tile': tiles[0], 'found': False})
        results.append(rec)
        continue
    atlas = ATLAS[rd]['atlas']
    cell = ATLAS_CELL[atlas]
    cellmap = cellmaps[atlas]
    info = infos[atlas]
    for raw in tiles:
        flip = raw < 0
        tt = abs(raw)
        col, row = tt % 100, tt // 100
        rect, how = lookup_at(col, row, cellmap, info)
        if rect is None:
            missing.append((oid, rd, raw, col, row))
            rec['tiles'].append({'tile': raw, 'found': False})
        else:
            rec['tiles'].append({'tile': raw, 'tex': atlas, 'rect': rect,
                                 'flip': flip, 'found': True, 'how': how})
    results.append(rec)

json.dump(results, open(os.path.join(HERE, 'objs_tile_rects.json'), 'w'),
          ensure_ascii=False, indent=1)
tot = sum(len(r['tiles']) for r in results)
hit = sum(1 for r in results for t in r['tiles'] if t.get('found'))
exact = sum(1 for r in results for t in r['tiles'] if t.get('how') == 'exact')
resc = hit - exact
print(f'\nTotal obj tiles={tot}  found={hit}  missing={tot - hit} ({hit / tot:.1%})')
print(f'  exact={exact}  rescued={resc}')
for m in missing:
    print('  MISSING', m)
