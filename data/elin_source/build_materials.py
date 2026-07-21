#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建 js/materials.js —— Elin 全量材质注册表（数据驱动，按原版维度分组）

来源（均已像素验证 / 来自 Elin 源码）：
  - floors_tile_rects.json  (95, 真实像素 rect + xlsx id)
  - blocks_tile_rects.json  (88, 真实像素 rect + xlsx id)
  - obj_id_rect.json        (145, 真实像素 rect + xlsx id)
  - sources.json            (Floor/Block/Obj 全字段: alias/name/name_JP/idBiome/defMat/_tileType/_idRenderData/category...)

设计（贴合 Elin 原版 BiomeProfile 机制）：
  1. 三大命名空间 floor / block / obj，key = xlsx 数字 id（与原版一致，无抽象语义字符串）
  2. GROUPS：按原版字段自动归类（idBiome / name_JP / defMat / _tileType），不发明新概念
  3. BIOMES：群系预设（TileGroup 概念），exterior/interior 各一套 floor/block 数字 id + obj 列表，
     数值全部从真实表挑 —— 对应 world.js 的 REGION_TERRAIN / 地牢 / 城镇生成。
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'js', 'materials.js')

def load(fn):
    with open(os.path.join(HERE, fn), encoding='utf-8') as f:
        return json.load(f)

rect_f = load('floors_tile_rects.json')
rect_b = load('blocks_tile_rects.json')
rect_o = load('obj_id_rect.json')
src = load('sources.json')

# ---- rect lookups ----
floor_rect = {t['id']: t for t in rect_f['tiles']}
block_rect = {t['id']: t for t in rect_b['tiles']}
obj_rect = rect_o['OBJ_ID_RECT']

# atlas name mapping for objs (tex field -> atlas key used by iso.js)
OBJ_ATLAS = {'objs': 'objs', 'objs_S': 'objs_S', 'objs_L': 'objs_L'}

# ============ obj 程序化着色 (贴合 Elin: 仅"活物"按材质 matColor 着色) ============
# Elin 对 obj/Thing 总是执行 p.matColor = base.colorInt：
#   中性材质(石/矿/屋顶/道路) → 白(不变, 保持灰度遮罩)
#   活物(树/花/蘑菇/苔藓/落叶) → 彩色 matColor (季节/材质色)
# 本图集里这些活物精灵是灰度遮罩(graystd≈0)，需 runtime 着色。
# 石/矿/屋顶等灰度精灵保持原灰(不着色)。
# 着色方式: 平涂色 + 遮罩 alpha 裁形 (see iso.js _getTintedTile 'colorize' 模式)。
# 颜色 RGB 0-255，对应 Elin 季节/材质色 (枫红/樱粉/松绿等)。
OBJ_TINT = {
    # ---- 树 (foliage) ----
    0:  [205, 70, 45],    # momiji 枫 → 红 (秋)
    56: [120, 178, 95],   # birch 桦 → 绿
    57: [70, 140, 75],    # pine 松 → 深绿
    63: [130, 158, 110],  # fossil tree 化石树 → 暗绿
    70: [138, 172, 85],   # acacia 金合欢 → 绿
    76: [125, 182, 95],   # willow 柳 → 绿
    # 77: [248, 182, 216],  # cherry 樱 → 粉  ⚠ DISABLED: rect 碰撞(=家具桌), 待修复 obj_id_rect 后启用
    12: [205, 95, 90],    # mushroom tree 蘑菇树 → 红伞
    15: [205, 95, 90],
    47: [205, 95, 90],
    94: [150, 130, 95],   # decayed tree 枯树 → 褐
    62: [132, 152, 112],  # decayed fossil tree → 绿灰
    # ---- 花/草/苔藓/落叶 ----
    3:  [238, 208, 72],   # yellow flower 黄花
    7:  [118, 168, 88],   # weed 杂草 → 绿
    20: [222, 226, 236],  # water lily 睡莲 → 白
    # 60: [118, 168, 88],   # moss 苔藓 → 绿   ⚠ DISABLED: rect 碰撞(=家具桌), 待修复
    # 79: [208, 138, 58],   # pile of fallen leaves 落叶堆 → 橙  ⚠ DISABLED: rect 碰撞(=家具桌), 待修复
    103:[128, 178, 98],   # bamboo 竹 → 绿
}

floor_src = src['SourceBlock']['Floor']['byId']
block_src = src['SourceBlock']['Block']['byId']
obj_src = src['SourceBlock']['Obj']['byId']

def jp(v):
    return (v or '').lower()

# ============ MAT.floor ============
MAT_floor = {}
for k, v in floor_src.items():
    fid = int(k)
    r = floor_rect.get(fid)
    if not r:
        continue
    MAT_floor[fid] = {
        'id': fid,
        'atlas': 'floors',
        'rect': [r['x'], r['y'], r['w'], r['h']],
        'alias': v.get('alias'),
        'name': v.get('name'),
        'nameJP': v.get('name_JP'),
        'biome': v.get('idBiome'),
        'mat': v.get('defMat'),
        'type': v.get('_tileType'),
        'render': v.get('_idRenderData'),
        'solid': False,
        'walkable': not ('water' in jp(v.get('nameJP')) or '水' in jp(v.get('nameJP')) or v.get('_tileType') in ('FloorWater','FloorWaterShallow','FloorWaterDeep')),
    }

# ============ MAT.block ============
MAT_block = {}
for k, v in block_src.items():
    bid = int(k)
    r = block_rect.get(bid)
    if not r:
        continue
    ty = v.get('_tileType')
    transparent = v.get('transparent')
    # 高度系数：半块 0.5，其余 1.0（与原版 tileType 对齐）
    h = 0.5 if ty == 'HalfBlock' else 1.0
    # 碰撞：透明(玻璃/水)或非实体视为可穿越
    solid = not transparent
    MAT_block[bid] = {
        'id': bid,
        'atlas': 'blocks',
        'rect': [r['x'], r['y'], r['w'], r['h']],
        'alias': v.get('alias'),
        'name': v.get('name'),
        'nameJP': v.get('name_JP'),
        'mat': v.get('defMat'),
        'type': ty,
        'render': v.get('_idRenderData'),
        'transparent': transparent,
        'h': h,
        'solid': solid,
        'walkable': False,
    }

# ============ MAT.obj ============
MAT_obj = {}
for k, v in obj_src.items():
    oid = int(k)
    r = obj_rect.get(str(oid)) or obj_rect.get(oid)
    if not r:
        continue
    MAT_obj[oid] = {
        'id': oid,
        'atlas': OBJ_ATLAS.get(r['tex'], r['tex']),
        'rect': list(r['rect']),
        'flip': r.get('flip'),
        'alias': v.get('alias'),
        'name': v.get('name'),
        'nameJP': v.get('name_JP'),
        'type': v.get('_tileType'),
        'render': v.get('_idRenderData'),
        'objType': v.get('objType'),
        'tag': v.get('tag'),
        'defMat': v.get('defMat'),
    }
    if oid in OBJ_TINT:
        MAT_obj[oid]['tint'] = OBJ_TINT[oid]

# ============ GROUPS（按原版字段归类）============
def grp_floor(cats):
    out = {c: [] for c in cats}
    for fid, m in MAT_floor.items():
        n = jp(m['nameJP']) + ' ' + jp(m['alias']) + ' ' + jp(m['name'])
        bi = m['biome']
        dm = m['mat']
        ty = m['type']
        if 'water' in n or bi == 'Water' or m['render'] == 'floorWater' or ty in ('FloorWater','FloorWaterShallow','FloorWaterDeep'):
            if 'deep' in n or ty == 'FloorWaterDeep':
                out['water_deep'].append(fid)
            elif 'shallow' in n or ty == 'FloorWaterShallow':
                out['water_shallow'].append(fid)
            else:
                out['water'].append(fid)
        elif bi == 'Sand' or '砂' in n or dm == 'sand':
            out['sand'].append(fid)
        elif bi == 'Snow' or '雪' in n or dm == 'snow':
            out['snow'].append(fid)
        elif bi == 'Ice' or '氷' in n or dm == 'ice':
            out['ice'].append(fid)
        elif bi == 'Factory':
            out['factory'].append(fid)
        elif bi == 'Undersea':
            out['undersea'].append(fid)
        elif dm == 'grass' or '草' in n or 'grass' in n:
            out['grass'].append(fid)
        elif dm in ('oak','cedar','pine') or '木' in n or '板' in n or 'wood' in n:
            out['wood'].append(fid)
        elif '石' in n or dm in ('granite','marble','diorite','silt','obsidian','rubinus') or 'stone' in n:
            out['stone'].append(fid)
        else:
            out['other'].append(fid)
    return out

FLOOR_CATS = ['grass','water_shallow','water','water_deep','sand','snow','ice','stone','wood','factory','undersea','other']
GROUPS_floor = grp_floor(FLOOR_CATS)

def grp_block(cats):
    out = {c: [] for c in cats}
    for bid, m in MAT_block.items():
        n = jp(m['nameJP']) + ' ' + jp(m['alias'])
        ty = m['type']
        dm = m['mat']
        if ty == 'Pillar':
            out['pillar'].append(bid)
        elif ty == 'HalfBlock':
            out['half'].append(bid)
        elif ty == 'Waterfall' or '滝' in n:
            out['waterfall'].append(bid)
        elif '水' in n or dm == 'water':
            out['water'].append(bid)
        else:
            out['wall'].append(bid)
    return out

BLOCK_CATS = ['wall','pillar','half','water','waterfall']
GROUPS_block = grp_block(BLOCK_CATS)

# obj 关键词粗分（全量仍注册在 MAT.obj，这里只给生成/UI 提供便捷类别）
OBJ_KEYWORDS = [
    ('torch', ['torch','火','ランタン','灯']),
    ('flower', ['flower','花']),
    ('mushroom', ['mushroom','茸','菌','きのこ']),
    ('grass', ['grass','草','芝']),
    ('bush', ['bush','灌木','低木','潅']),
    ('tree', ['tree','木','幹','株']),
    ('rock', ['rock','岩','石','礫']),
    ('bone', ['bone','骨']),
    ('crystal', ['crystal','水晶','結晶']),
    ('shell', ['shell','貝']),
    ('book', ['book','本','巻物']),
    ('chest', ['chest','箱','宝']),
    ('barrel', ['barrel','樽','桶']),
    ('crate', ['crate',' crate','木箱']),
    ('sign', ['sign','看板','標']),
    ('statue', ['statue','像','彫']),
    ('lantern', ['lantern','提灯','行灯']),
    ('web', ['web','蜘蛛','糸']),
    ('cursed', ['curse','呪','デビル','悪魔']),
]
def grp_obj():
    out = {k: [] for k, _ in OBJ_KEYWORDS}
    out['misc'] = []
    for oid, m in MAT_obj.items():
        n = jp(m['nameJP']) + ' ' + jp(m['alias']) + ' ' + jp(m['name'])
        placed = False
        for key, kws in OBJ_KEYWORDS:
            if any(kw in n for kw in kws):
                out[key].append(oid)
                placed = True
                break
        if not placed:
            out['misc'].append(oid)
    return out

GROUPS_obj = grp_obj()

# ============ BIOMES（群系预设，TileGroup 概念）============
def first(group, fallback=None):
    lst = GROUPS_floor.get(group) or GROUPS_block.get(group) or GROUPS_obj.get(group) or []
    return lst[0] if lst else fallback

# 每个群系：exterior floor id, exterior block id, 默认 obj 列表（从真实表挑）
BIOMES = {
    'field':   {'floor': first('grass'),    'block': first('wall'),    'objs': GROUPS_obj.get('grass', [])[:4] + GROUPS_obj.get('flower', [])[:3]},
    'forest':  {'floor': first('grass'),    'block': first('wall'),    'objs': GROUPS_obj.get('tree', [])[:3] + GROUPS_obj.get('grass', [])[:3]},
    'hill':    {'floor': first('stone'),    'block': first('wall'),    'objs': GROUPS_obj.get('rock', [])[:3]},
    'mountain':{'floor': first('stone'),    'block': first('wall'),    'objs': GROUPS_obj.get('rock', [])[:3]},
    'water':   {'floor': first('water'),    'block': first('wall'),    'objs': []},
    'beach':   {'floor': first('sand'),     'block': first('wall'),    'objs': GROUPS_obj.get('shell', [])[:3]},
    'road':    {'floor': first('stone'),    'block': first('wall'),    'objs': []},
    'swamp':   {'floor': first('grass'),    'block': first('wall'),    'objs': GROUPS_obj.get('mushroom', [])[:3]},
    'snow':    {'floor': first('snow'),     'block': first('wall'),    'objs': []},
    'desert':  {'floor': first('sand'),     'block': first('wall'),    'objs': []},
    'dungeon': {'floor': first('stone'),    'block': first('wall'),    'objs': GROUPS_obj.get('crystal', [])[:1] + GROUPS_obj.get('rock', [])[:2]},
    'town':    {'floor': first('stone'),    'block': first('wall'),    'objs': GROUPS_obj.get('crystal', [])[:1]},
}

# ============ 写出 js/materials.js ============
def dumps(d, indent=2):
    return json.dumps(d, ensure_ascii=False, indent=indent)

lines = []
lines.append('// AUTO-GENERATED by build_materials.py — Elin 全量材质注册表（数据驱动）')
lines.append('// 来源: floors_tile_rects.json(95) / blocks_tile_rects.json(88) / obj_id_rect.json(145) + sources.json')
lines.append('// 三大命名空间 floor/block/obj，key = xlsx 数字 id（与原版一致）。')
lines.append('// GROUPS 按原版字段(idBiome/name_JP/defMat/_tileType)归类；BIOMES 为群系预设(TileGroup)。')
lines.append('')
lines.append('export const MAT = {')
lines.append('  floor: ' + dumps(MAT_floor) + ',')
lines.append('  block: ' + dumps(MAT_block) + ',')
lines.append('  obj: ' + dumps(MAT_obj) + ',')
lines.append('};')
lines.append('')
lines.append('export const GROUPS = {')
lines.append('  floor: ' + dumps(GROUPS_floor) + ',')
lines.append('  block: ' + dumps(GROUPS_block) + ',')
lines.append('  obj: ' + dumps(GROUPS_obj) + ',')
lines.append('};')
lines.append('')
lines.append('export const BIOMES = ' + dumps(BIOMES, indent=2) + ';')
lines.append('')
lines.append('// 便捷查询')
lines.append('export function getMat(kind, id){ return (MAT[kind] && MAT[kind][id]) || null; }')
lines.append('export function floorMat(id){ return MAT.floor[id] || null; }')
lines.append('export function blockMat(id){ return MAT.block[id] || null; }')
lines.append('export function objMat(id){ return MAT.obj[id] || null; }')
lines.append('')
lines.append('// 群系预设（TileGroup 概念）：返回 {floor, block, objs} 数字 id')
lines.append('export function biome(k){ return BIOMES[k] || null; }')
lines.append('')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print('WROTE', os.path.abspath(OUT))
print('floor=%d block=%d obj=%d' % (len(MAT_floor), len(MAT_block), len(MAT_obj)))
print('FLOOR_GROUPS:', {k: len(v) for k, v in GROUPS_floor.items()})
print('BLOCK_GROUPS:', {k: len(v) for k, v in GROUPS_block.items()})
print('OBJ_GROUPS(top):', {k: len(v) for k, v in GROUPS_obj.items()})
print('BIOMES:', {k: (v['floor'], v['block'], len(v['objs'])) for k, v in BIOMES.items()})
