// ===== 物品工厂（独立模块，避免循环依赖）=====

import { ITEMS, ENCHANTS, QUALITY } from './data.js';

export function makeItem(id, depth, rng){
  const base = ITEMS[id];
  if(!base) return {...ITEMS.bread, _uid: uid(rng)};
  let quality = 'normal';
  let enchants = [];
  if((base.type === 'weapon' || base.type === 'armor') && rng){
    const roll = rng.float();
    const depthBoost = Math.min(depth*0.02, 0.3);
    if(roll < 0.02 + depthBoost*0.1) quality = 'god';
    else if(roll < 0.08 + depthBoost*0.2) quality = 'miracle';
    else if(roll < 0.22 + depthBoost) quality = 'high';
    else if(roll < 0.5 + depthBoost) quality = 'good';
    if(quality !== 'normal'){
      const nEnch = quality==='god'?3: quality==='miracle'?2: 1;
      for(let k=0;k<nEnch;k++){
        const e = rng.pick(ENCHANTS);
        const val = rng.int(e.min, e.max);
        enchants.push({id:e.id, name:e.name, attr:e.attr, resist:e.resist, val});
      }
    }
  }
  return {...base, quality, enchants, _uid: uid(rng)};
}

function uid(rng){
  return rng ? rng.int(1,1e9) : Math.floor(Math.random()*1e9);
}

export function qualityMult(q){ return QUALITY[q]?QUALITY[q].mult:1.0; }

export function qualityName(q){ return QUALITY[q]?QUALITY[q].name:''; }
export function qualityClass(q){ return QUALITY[q]?QUALITY[q].cls:''; }

// 生成随机名称（高品质物品）
const NAME_PREFIX = ['祝福之','诅咒之','远古','英雄','混沌','星辰','龙裔','寂灭','永恒','烈焰'];
const NAME_SUFFIX = ['毁灭者','守护者','征服者','低语','余烬','裂隙','审判','苍穹','悲鸣','荣光'];
export function itemName(item){
  let n = item.name;
  if(item.quality==='miracle' || item.quality==='god'){
    const pre = item._namePre || NAME_PREFIX[item._uid % NAME_PREFIX.length];
    const suf = item._nameSuf || NAME_SUFFIX[(item._uid>>3) % NAME_SUFFIX.length];
    n = `☆${pre}${n} '${suf}'`;
  } else if(item.quality==='high'){
    n = `${item.name}+`;
  } else if(item.quality==='good'){
    n = `${item.name}`;
  }
  return n;
}
