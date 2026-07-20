#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
解析 Elin 官方源表，提取每个物件的「贴图在素材图集里的位置」(sprite sheet 名 + tile 编号)
以及渲染相关参数。重点：sheet 名优先从 _idRenderData 提取（如 'obj_S'->objS, 'obj_S flat'->objS+flat），
这比用 _tileType 推断准确得多。

覆盖表（权威源）：
  SourceCard!Thing    物品/家具/装备         -> thing_map.json
  SourceBlock!Obj     地面装饰/植物/自然物    -> obj_map.json   (对应 objs.png / objs_S.png 的装饰)
  SourceBlock!Block   方块/墙/屋顶/楼梯       -> block_map.json
  SourceBlock!Floor   地板                    -> floor_map.json
  SourceBlock!Deco    地板装饰边框            -> deco_map.json
  tile_index.json     跨表总索引：sheet -> tile编号 -> 物件id

不使用日文 name（用户要求）。主名用英文内部 id；displayName 仅在非日文时保留。
"""
import openpyxl, json, os, re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "sources")

# ---------- 工具 ----------
HIRA = re.compile(r'[\u3040-\u309f]')
KATA = re.compile(r'[\u30a0-\u30ff]')
def is_jp(s):
    if not isinstance(s, str): return False
    return bool(HIRA.search(s) or KATA.search(s))

def parse_tiles(v):
    if v is None: return []
    if isinstance(v, (int, float)): return [int(v)]
    s = str(v).strip()
    if not s: return []
    return [int(x) for x in re.findall(r'-?\d+', s)]

# 从 _idRenderData (如 'obj_S' / 'obj_S flat' / 'floor') 提取精灵表名 + 渲染姿态
RENDER_SHEET = {'obj_s':'objS','obj':'obj','objh':'objH','objc':'objC',
                'floor':'floor','block':'block','bg':'bg','icon':'icon'}
def sheet_from_render(rd):
    if not rd: return None
    tok = str(rd).split()[0].lower()
    return RENDER_SHEET.get(tok)
def render_mode(rd):
    if not rd: return None
    parts = str(rd).split()
    return ' '.join(parts[1:]) if len(parts) > 1 else None

# Thing _tileType -> 精灵表（回退用）
TILETYPE_SHEET = {'ObjHuge':'objH','ObjBig':'obj','Obj':'obj','ObjFloat':'obj',
    'ObjCeil':'obj','ObjFloatWaterfall':'obj','WallHang':'obj','Window':'obj',
    'Door':'obj','Vine':'obj','Stairs':'obj','SlopeFlat':'obj','Paint':'obj',
    'Boat':'obj','Illumination':'obj','Seed':'obj','Tent':'obj'}
EQUIP_HINT = re.compile(r'^(weapon|dagger|sword|spear|axe|bow|staff|wand|helm|hat|armor|cloth|shield|ring|amulet|pot|scroll|food|tool|gene|musical|lightsaber|pick|whip|club|fang|tail|skin|horn|leg|boot|glove|robe|dress|cap|mask|coat|ear)', re.I)

def infer_thing_sheet(rd, tiletype, tid, tile_nums):
    s = sheet_from_render(rd)
    if s: return s, 'renderData'
    if tiletype and tiletype in TILETYPE_SHEET:
        return TILETYPE_SHEET[tiletype], 'tileType'
    if tiletype is None and (EQUIP_HINT.match(str(tid) or '') or (tile_nums and tile_nums[0] >= 800)):
        return 'objS', 'heuristic_equip'
    return 'obj', 'heuristic_default'

# ---------- 加载 ----------
def load_rows(fname, sheet, skip_rows=2):
    f = os.path.join(SRC, fname)
    wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
    ws = wb[sheet]
    rows = []
    for i, r in enumerate(ws.iter_rows(min_row=1, values_only=True)):
        if i < skip_rows: continue
        if r is None or all(c is None for c in r): continue
        rows.append(r)
    wb.close()
    return rows

def pick(row, idx):
    return row[idx] if idx < len(row) else None

def base_entry(tid, name_idx, tiles_idx, rd_idx, tt_idx, extra):
    name = pick(tid_row if False else None, 0)  # placeholder (unused)
    return None

# ---------- Thing ----------
def parse_thing():
    rows = load_rows('SourceCard.xlsx', 'Thing')
    out = []
    for r in rows:
        tid = pick(r, 0)
        if tid is None: continue
        name_en = pick(r, 5)
        category = pick(r, 8)
        tiletype = pick(r, 11)
        render = pick(r, 12)
        tiles_raw = pick(r, 13)
        size = pick(r, 17)
        defmat = pick(r, 23)
        weight = pick(r, 31)
        nums = parse_tiles(tiles_raw)
        if not nums: continue
        sheet, conf = infer_thing_sheet(render, tiletype, tid, nums)
        disp = name_en if (isinstance(name_en, str) and not is_jp(name_en)) else None
        out.append({
            'id': tid, 'name': tid, 'displayName': disp,
            'tile': nums[0] if len(nums) == 1 else nums,
            'sheet': sheet, 'sheetSource': conf,
            'tileType': tiletype, 'renderData': render, 'renderMode': render_mode(render),
            'size': size, 'weight': weight, 'defMat': defmat, 'category': category,
        })
    return out

# ---------- Obj (装饰/植物/自然物) ----------
def parse_obj():
    rows = load_rows('SourceBlock.xlsx', 'Obj')
    out = []
    for r in rows:
        tid = pick(r, 0)
        if tid is None: continue
        name_en = pick(r, 3)
        tiletype = pick(r, 12)
        render = pick(r, 14)
        tiles_raw = pick(r, 15)
        objtype = pick(r, 6)
        growth = pick(r, 4)
        reqharvest = pick(r, 10)
        defmat = pick(r, 26)
        category = pick(r, 28)
        idroof = pick(r, 29)
        nums = parse_tiles(tiles_raw)
        if not nums: continue
        sheet = sheet_from_render(render) or 'objS'   # Obj 装饰几乎都在 objS
        src = 'renderData' if sheet_from_render(render) else 'default_objS'
        disp = name_en if (isinstance(name_en, str) and not is_jp(name_en)) else None
        out.append({
            'id': tid, 'name': name_en if disp else tid, 'displayName': disp,
            'tile': nums[0] if len(nums) == 1 else nums,
            'sheet': sheet, 'sheetSource': src,
            'tileType': tiletype, 'renderData': render, 'renderMode': render_mode(render),
            'objType': objtype, 'growth': growth, 'reqHarvest': reqharvest,
            'defMat': defmat, 'category': category, 'idRoof': idroof,
        })
    return out

# ---------- Block ----------
def parse_block():
    rows = load_rows('SourceBlock.xlsx', 'Block')
    out = []
    for r in rows:
        tid = pick(r, 0)
        if tid is None: continue
        name = pick(r, 3)
        tiletype = pick(r, 8)
        render = pick(r, 9)
        tiles_raw = pick(r, 10)
        idthing = pick(r, 7)
        defmat = pick(r, 20)
        category = pick(r, 21)
        nums = parse_tiles(tiles_raw)
        if not nums: continue
        disp = name if (isinstance(name, str) and not is_jp(name)) else None
        out.append({
            'id': tid, 'name': tid, 'displayName': disp,
            'tile': nums[0] if len(nums) == 1 else nums,
            'sheet': 'block', 'sheetSource': 'fixed_table',
            'tileType': tiletype, 'renderData': render, 'renderMode': render_mode(render),
            'idThing': idthing, 'defMat': defmat, 'category': category,
        })
    return out

# ---------- Floor ----------
def parse_floor():
    rows = load_rows('SourceBlock.xlsx', 'Floor')
    out = []
    for r in rows:
        tid = pick(r, 0)
        if tid is None: continue
        name = pick(r, 3)
        tiletype = pick(r, 8)
        render = pick(r, 9)
        tiles_raw = pick(r, 10)
        defmat = pick(r, 18)
        defblock = pick(r, 19)
        bridgeblock = pick(r, 20)
        category = pick(r, 21)
        edge = pick(r, 22)
        autotile = pick(r, 23)
        nums = parse_tiles(tiles_raw)
        if not nums: continue
        disp = name if (isinstance(name, str) and not is_jp(name)) else None
        out.append({
            'id': tid, 'name': tid, 'displayName': disp,
            'tile': nums[0] if len(nums) == 1 else nums,
            'sheet': 'floor', 'sheetSource': 'fixed_table',
            'tileType': tiletype, 'renderData': render, 'renderMode': render_mode(render),
            'defMat': defmat, 'defBlock': defblock, 'bridgeBlock': bridgeblock,
            'category': category, 'edge': edge, 'autotile': autotile,
        })
    return out

# ---------- Deco (地板装饰边框) ----------
def parse_deco():
    rows = load_rows('SourceBlock.xlsx', 'Deco')
    out = []
    for r in rows:
        tid = pick(r, 0)
        if tid is None or not isinstance(tid, int): continue
        alias = pick(r, 1)
        name = pick(r, 3)
        tiletype = pick(r, 8)
        render = pick(r, 9)
        tiles_raw = pick(r, 10)
        nums = parse_tiles(tiles_raw)
        if not nums: continue
        sheet = sheet_from_render(render) or 'floor'
        disp = name if (isinstance(name, str) and not is_jp(name)) else None
        out.append({
            'id': tid, 'alias': alias, 'name': name or alias or tid, 'displayName': disp,
            'tile': nums[0] if len(nums) == 1 else nums,
            'sheet': sheet, 'sheetSource': 'renderData' if sheet_from_render(render) else 'default_floor',
            'tileType': tiletype, 'renderData': render, 'renderMode': render_mode(render),
        })
    return out

# ---------- 总索引 ----------
def build_index(maps):
    idx = {}
    for entries in maps:
        for e in entries:
            sh = e['sheet']
            idx.setdefault(sh, {})
            tiles = e['tile'] if isinstance(e['tile'], list) else [e['tile']]
            for t in tiles:
                idx[sh].setdefault(str(t), []).append(e['id'])
    for sh in idx:
        idx[sh] = {k: idx[sh][k] for k in sorted(idx[sh], key=lambda x: int(x))}
    return idx

def main():
    thing = parse_thing()
    obj = parse_obj()
    block = parse_block()
    floor = parse_floor()
    deco = parse_deco()
    write = lambda name, obj_: open(os.path.join(HERE, name), 'w', encoding='utf-8').write(
        json.dumps(obj_, ensure_ascii=False, indent=1))
    write('thing_map.json', {'_meta': {'source':'SourceCard.xlsx!Thing','total':len(thing),
        'note':'物品/家具/装备. sheet 优先取自 _idRenderData, 否则 _tileType/启发式. tile=图集内编号.'},'entries':thing})
    write('obj_map.json', {'_meta': {'source':'SourceBlock.xlsx!Obj','total':len(obj),
        'note':'地面装饰/植物/自然物(对应 objs.png/objs_S.png). sheet 取自 _idRenderData (obj_S->objS). tile=图集内编号.'},'entries':obj})
    write('block_map.json', {'_meta': {'source':'SourceBlock.xlsx!Block','total':len(block),
        'note':'方块/墙/屋顶/楼梯. sheet 固定 block.'},'entries':block})
    write('floor_map.json', {'_meta': {'source':'SourceBlock.xlsx!Floor','total':len(floor),
        'note':'地板. sheet 固定 floor.'},'entries':floor})
    write('deco_map.json', {'_meta': {'source':'SourceBlock.xlsx!Deco','total':len(deco),
        'note':'地板装饰边框(stone border/curb). sheet 取自 _idRenderData.'},'entries':deco})
    index = build_index([thing, obj, block, floor, deco])
    write('tile_index.json', {'_meta': {'note':'按精灵表分组的 tile编号->物件id 索引, 直接对应素材图集位置.'}, 'sheets': index})
    print('Thing:', len(thing), '| Obj:', len(obj), '| Block:', len(block), '| Floor:', len(floor), '| Deco:', len(deco))
    print('Obj sheet dist:', dict(Counter(e['sheet'] for e in obj)))
    print('tile_index per sheet:', {k: len(v) for k, v in index.items()})

if __name__ == '__main__':
    main()
