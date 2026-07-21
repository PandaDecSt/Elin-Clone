#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_lang_zh.py  —  生成 lang_zh.json (中文显示名覆盖表)

策略 (因源数据只有 name_JP 日文 / name 英文, 无中文列):
- 当前 H5 的 data.js 已为中文显示名 (RACES/CLASSES/ITEMS/MONSTERS 的 name 字段).
- 本脚本把"当前游戏用到的中文名" + "Source 可玩内容的中文翻译" 合并进一张覆盖表,
  键为 "<Sheet>:<id>"  (Sheet ∈ Race/Job/Thing/Chara/Food/Material).
- 运行时 ZH(sheet,id) 优先返回这里的中文; 否则回退 en->jp.

这样: 角色创建(种族/职业) 与 当前游戏使用的内容 全部保证有中文; 新增的 Source 驱动
实体也有中文. 这是单一扩展点 —— 以后可直接补全整张表.
"""
import json, re, os

# ---- 1) 从当前 data.js 提取已存在的中文名 (id -> 中文) ----
txt = open('js/data.js', encoding='utf-8').read()
def extract(block):
    m = re.search(r'const\s+' + block + r'\s*=\s*\{(.*?)\n\};', txt, re.S)
    out = {}
    if not m: return out
    # 每个条目:  key:{ ... name:'中文' ... }
    for entry in re.finditer(r'(\w+)\s*:\s*\{(.*?)\n\s*\}', m.group(1), re.S):
        key = entry.group(1)
        body = entry.group(2)
        nm = re.search(r"name\s*:\s*'([^']*)'", body)
        if nm: out[key] = nm.group(1)
    return out

races_cn   = extract('RACES')
classes_cn = extract('CLASSES')
items_cn   = extract('ITEMS')
mons_cn    = extract('MONSTERS')

# ---- 2) Source 可玩内容的权威中文翻译 (当前常量未覆盖的部分) ----
curated = {
    # Race (Source 可玩 id, 部分不在当前 RACES 常量里)
    'Race': {
        'yerles':'耶雷斯', 'eulderna':'欧尔德娜', 'fairy':'妖精', 'dwarf':'丘陵民',
        'juere':'朱雷', 'elea':'艾莉亚', 'mutant':'混沌体', 'snail':'蜗牛', 'lich':'巫妖',
        'hillfolk':'丘陵民',  # 当前游戏用的 id
    },
    # Job (Source 可玩 id)
    'Job': {
        'warrior':'战士', 'thief':'盗墓者', 'wizard':'法师', 'farmer':'农民',
        'archer':'猎人', 'warmage':'魔战士', 'tourist':'游客', 'pianist':'钢琴家',
        'priest':'神官', 'gunner':'机工兵',
        'mage':'法师', 'executioner':'剑术导师',  # 当前游戏用的 id
    },
    # Thing 常见物品
    'Thing': {
        'dagger':'匕首', 'sword':'长剑', 'longsword':'长剑', 'staff':'法杖', 'bow':'弓',
        'pistol':'手枪', 'hoe':'锄头', 'leather_armor':'皮甲', 'robe':'长袍', 'cloak':'斗篷',
        'straw_hat':'草帽', 'shield':'盾牌', 'bread':'面包', 'ration':'口粮', 'apple':'苹果',
        'meat':'烤肉', 'potion_heal':'治疗药水', 'potion_heal_l':'大治疗药水', 'potion_cure':'解毒药水',
        'arrow':'箭', 'bullet':'子弹', 'lockpick':'撬锁工具', 'torch':'火把', 'seed':'种子',
        'herb':'药草', 'ore':'矿石', 'chest':'宝箱', 'platinum':'白金',
        'axe':'斧', 'blunt':'钝器', 'polearm':'长柄武器', 'scythe':'镰刀',
    },
    # Chara 常见怪物
    'Chara': {
        'slime':'史莱姆', 'bat':'蝙蝠', 'rat':'巨鼠', 'goblin':'哥布林', 'kobold':'狗头人',
        'orc':'兽人', 'zombie':'僵尸', 'ghost':'幽灵', 'imp':'小恶魔', 'troll':'洞穴巨魔',
        'dragon':'幼龙', 'ratkin':'鼠人', 'mush_zombie':'蘑菇僵尸', 'candle_ghost':'烛火幽灵',
        'imp_nether':'深渊小恶魔', 'orc_warrior':'兽人战士', 'goblin_wizard':'哥布林巫师',
    },
    # Food
    'Food': {},
    # Material
    'Material': {},
}

# ---- 3) 合并: 当前常量中文优先, 再用 curated 补全 Source id ----
zh = {}
for sheet, d in curated.items():
    src = {'Race':races_cn, 'Job':classes_cn, 'Thing':items_cn, 'Chara':mons_cn}.get(sheet, {})
    for k, v in src.items():
        zh[f'{sheet}:{k}'] = v
    for k, v in d.items():
        zh.setdefault(f'{sheet}:{k}', v)

# ---- 4) 写入 ----
os.makedirs('data/elin_source', exist_ok=True)
json.dump(zh, open('data/elin_source/lang_zh.json','w'), ensure_ascii=False, indent=1)
print(f'lang_zh.json written: {len(zh)} entries')
for s in ('Race','Job','Thing','Chara'):
    print(f'  {s}: {sum(1 for k in zh if k.startswith(s+":"))} ids')
