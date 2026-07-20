// ===== 物品系统：移植原版 Thing 完整属性 =====
// 包含：材质/品质/装备槽/食物效果/穿透/范围/物品描述

import { ITEMS, ENCHANTS, QUALITY } from './data.js';

// ---------- 材质系统（移植自原版 MATERIAL）----------
export const MATERIALS = {
  wood:    { id:'wood',    name:'木',    hardness:20, weight:0.8, color:'#8a6a3a' },
  iron:    { id:'iron',    name:'铁',    hardness:50, weight:1.0, color:'#7a7a7a' },
  steel:   { id:'steel',   name:'钢',    hardness:70, weight:0.9, color:'#9a9a9a' },
  silver:  { id:'silver',  name:'银',    hardness:40, weight:1.1, color:'#c0c0c0' },
  gold:    { id:'gold',    name:'金',    hardness:30, weight:1.5, color:'#d4a84a' },
  mithril: { id:'mithril', name:'秘银',  hardness:80, weight:0.6, color:'#a0c0e0' },
  crystal: { id:'crystal', name:'水晶',  hardness:60, weight:0.7, color:'#e0e0ff' },
  bone:    { id:'bone',    name:'骨',    hardness:35, weight:0.9, color:'#e0d8c0' },
  leather: { id:'leather', name:'皮革',  hardness:25, weight:0.7, color:'#8a6a4a' },
  cloth:   { id:'cloth',   name:'布',    hardness:10, weight:0.3, color:'#c0b0a0' },
  stone:   { id:'stone',   name:'石',    hardness:60, weight:1.2, color:'#6a6a6a' },
};

// ---------- 物品类型定义 ----------
export const ITEM_CATEGORIES = {
  weapon: { name:'武器', slots:['主手'] },
  armor:  { name:'防具', slots:['头部','身体','披风','手套','靴子'] },
  shield: { name:'盾牌', slots:['副手'] },
  ring:   { name:'戒指', slots:['戒指'] },
  amulet: { name:'项链', slots:['项链'] },
  food:   { name:'食物', slots:[] },
  potion: { name:'药水', slots:[] },
  scroll: { name:'卷轴', slots:[] },
  ammo:   { name:'弹药', slots:[] },
  tool:   { name:'工具', slots:[] },
  material:{ name:'材料', slots:[] },
  container:{ name:'容器', slots:[] },
  currency:{ name:'货币', slots:[] },
};

// ---------- 增强版 makeItem ----------
export function makeItem(id, depth, rng){
  const base = ITEMS[id];
  if(!base) return {...ITEMS.bread, _uid: uid(rng)};

  // 创建物品实例
  const item = {...base};
  item._uid = uid(rng);

  // 材质
  if(base.material){
    item.material = MATERIALS[base.material] || null;
  }

  // 品质系统
  let quality = 'normal';
  let enchants = [];
  if((base.type === 'weapon' || base.type === 'armor') && rng){
    const roll = rng.float();
    const depthBoost = Math.min(depth * 0.02, 0.3);
    if(roll < 0.02 + depthBoost * 0.1) quality = 'god';
    else if(roll < 0.08 + depthBoost * 0.2) quality = 'miracle';
    else if(roll < 0.22 + depthBoost) quality = 'high';
    else if(roll < 0.5 + depthBoost) quality = 'good';
    if(quality !== 'normal'){
      const nEnch = quality === 'god' ? 3 : quality === 'miracle' ? 2 : 1;
      for(let k = 0; k < nEnch; k++){
        const e = rng.pick(ENCHANTS);
        const val = rng.int(e.min, e.max);
        enchants.push({id:e.id, name:e.name, attr:e.attr, resist:e.resist, val});
      }
    }
  }
  item.quality = quality;
  item.enchants = enchants;

  // 计算物品等级
  item.level = base.level || Math.floor((depth || 0) * 0.5);

  // 穿透值（武器）
  if(base.type === 'weapon'){
    item.penetration = base.penetration || (5 + Math.floor((item.level || 0) / 3));
  }

  // 范围（远程武器）
  if(base.ranged){
    item.range = base.range || 5;
  }

  // 食物效果
  if(base.type === 'food'){
    item.foodValue = base.food || 20;
    item.nutrition = base.nutrition || 10;  // 营养值
    item.tasteBonus = base.tasteBonus || 0; // 口味加成
    // 食物品质影响
    if(quality !== 'normal'){
      item.foodValue = Math.floor(item.foodValue * qualityMult(quality));
    }
  }

  // 物品描述（高品质物品）
  if(quality === 'miracle' || quality === 'god'){
    item.desc = _generateMagicDesc(item, quality);
  }

  // 物品重量（含材质修正）
  if(item.material){
    item.weight = (base.weight || 1) * item.material.weight;
  }

  return item;
}

// ---------- 生成魔法物品描述 ----------
function _generateMagicDesc(item, quality){
  const prefixes = ['祝福之','远古的','英雄的','星辰','龙裔','永恒','烈焰'];
  const suffixes = ['毁灭者','守护者','征服者','低语','余烬','审判','荣光'];
  const pre = prefixes[item._uid % prefixes.length];
  const suf = suffixes[(item._uid >> 3) % suffixes.length];
  return `☆${pre}${item.name} '${suf}'`;
}

// ---------- 物品唯一ID ----------
function uid(rng){
  return rng ? rng.int(1, 1e9) : Math.floor(Math.random() * 1e9);
}

// ---------- 品质工具函数 ----------
export function qualityMult(q){ return QUALITY[q] ? QUALITY[q].mult : 1.0; }
export function qualityName(q){ return QUALITY[q] ? QUALITY[q].name : ''; }
export function qualityClass(q){ return QUALITY[q] ? QUALITY[q].cls : ''; }

// ---------- 物品名称（含品质前缀）----------
const NAME_PREFIX = ['祝福之','诅咒之','远古','英雄','混沌','星辰','龙裔','寂灭','永恒','烈焰'];
const NAME_SUFFIX = ['毁灭者','守护者','征服者','低语','余烬','裂隙','审判','苍穹','悲鸣','荣光'];
export function itemName(item){
  let n = item.name;
  if(item.quality === 'miracle' || item.quality === 'god'){
    const pre = item._namePre || NAME_PREFIX[item._uid % NAME_PREFIX.length];
    const suf = item._nameSuf || NAME_SUFFIX[(item._uid >> 3) % NAME_SUFFIX.length];
    n = `☆${pre}${n} '${suf}'`;
  } else if(item.quality === 'high'){
    n = `${item.name}+`;
  } else if(item.quality === 'good'){
    n = `${item.name}`;
  }
  return n;
}

// ---------- 物品属性计算 ----------
// 获取物品的DV修正
export function getItemDV(item){
  let dv = item.dv || 0;
  if(item.enchants){
    for(const e of item.enchants){
      if(e.attr === 'dv') dv += e.val;
    }
  }
  return dv;
}

// 获取物品的PV修正
export function getItemPV(item){
  let pv = item.pv || 0;
  if(item.enchants){
    for(const e of item.enchants){
      if(e.attr === 'pv') pv += e.val;
    }
  }
  return pv;
}

// 获取物品的HIT修正
export function getItemHIT(item){
  let hit = item.hit || 0;
  if(item.enchants){
    for(const e of item.enchants){
      if(e.attr === 'hit') hit += e.val;
    }
  }
  return hit;
}

// 获取物品的穿透值
export function getItemPenetration(item){
  return item.penetration || 5;
}

// 获取物品的射程
export function getItemRange(item){
  return item.range || 1;
}

// 获取物品的技能类型
export function getItemSkill(item){
  if(!item || item.type !== 'weapon') return null;
  if(item.id === 'dagger' || item.id === 'short_sword') return '短剑';
  if(item.id === 'sword' || item.id === 'longsword') return '长剑';
  if(item.id === 'bow') return '弓';
  if(item.id === 'pistol') return '枪械';
  if(item.id === 'staff') return '施法';
  if(item.id === 'axe') return '斧';
  if(item.id === 'hammer' || item.id === 'mace') return '钝器';
  if(item.id === 'spear' || item.id === 'pike') return '长矛';
  return '格斗';
}

// ---------- 物品使用（食物/药水）----------
export function useItem(entity, item, rng, log){
  if(!item) return false;

  // 食物
  if(item.type === 'food'){
    if(entity.hunger){
      entity.hunger.restore(item.foodValue || 20);
    }
    // 食物属性增益（暂时性）
    if(item.attr && entity.attrs){
      // 简化：暂时不加属性
    }
    if(log) log(`${entity.name} 吃了 ${item.name}`, 'info');
    return true;
  }

  // 药水
  if(item.type === 'potion'){
    if(item.use === 'heal'){
      const power = item.power || '4d6';
      const heal = rollDice(power, rng);
      entity.hp = Math.min(entity.maxHp, entity.hp + heal);
      if(log) log(`${entity.name} 使用了 ${item.name}，恢复 ${heal} HP`, 'heal');
    } else if(item.use === 'cure'){
      // 清除负面状态
      if(entity.conditions){
        for(let i = entity.conditions.conditions.length - 1; i >= 0; i--){
          if(entity.conditions.conditions[i].bad){
            entity.conditions.conditions.splice(i, 1);
          }
        }
      }
      if(log) log(`${entity.name} 使用了 ${item.name}，解除了异常状态`, 'info');
    }
    return true;
  }

  return false;
}

// ---------- 物品堆叠检查 ----------
export function canStack(a, b){
  if(!a || !b) return false;
  if(a.id !== b.id) return false;
  if(a.quality !== b.quality) return false;
  return true;
}

// ---------- 物品描述生成 ----------
export function itemDescription(item){
  if(!item) return '';
  const lines = [];
  lines.push(itemName(item));

  // 类型
  const cat = ITEM_CATEGORIES[item.type];
  if(cat) lines.push(`类型: ${cat.name}`);

  // 攻击力
  if(item.type === 'weapon'){
    lines.push(`伤害: ${item.dice || '1d1'} + ${item.bonus || 0}`);
    if(item.penetration) lines.push(`穿透: ${item.penetration}`);
    if(item.ranged) lines.push(`射程: ${item.range || 5}`);
  }

  // 防御
  if(item.type === 'armor' || item.type === 'shield'){
    if(item.dv) lines.push(`闪避: ${item.dv > 0 ? '+' : ''}${item.dv}`);
    if(item.pv) lines.push(`护甲: ${item.pv}`);
  }

  // 重量
  if(item.weight) lines.push(`重量: ${item.weight.toFixed(1)}s`);

  // 材质
  if(item.material) lines.push(`材质: ${item.material.name}`);

  // 附魔
  if(item.enchants && item.enchants.length > 0){
    lines.push('---');
    for(const e of item.enchants){
      const val = e.val > 0 ? `+${e.val}` : `${e.val}`;
      lines.push(`${e.name} ${val}`);
    }
  }

  // 描述
  if(item.desc) lines.push(item.desc);

  return lines.join('\n');
}
