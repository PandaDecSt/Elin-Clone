// ===== 战斗系统：骰子伤害 / 命中 / 暴击 / DV-PV / 元素 / 状态效果 =====

import { SPELLS, ELEMENTS } from './data.js';
import { rollDice, RNG } from './rng.js';
import { qualityMult } from './item.js';

const DMG_CAP = 9999999;

// ---- 命中判定 ----
function rollHit(attacker, defender, rng){
  const hit = attacker.hit || (attacker.getAttr?attacker.getAttr('灵巧'):0);
  const dv = defender.dv || 0;
  // 命中率 = hit / (hit + dv) * 100，最低 5%，最高 95%
  let chance = hit / (hit + Math.max(1,dv));
  chance = Math.max(0.05, Math.min(0.95, chance));
  // 状态影响
  if(attacker.hasStatus && attacker.hasStatus('blind')) chance *= 0.5;
  if(defender.hasStatus && defender.hasStatus('frozen')) chance = 1;
  return rng.chance(chance);
}

// ---- 暴击判定 ----
function rollCrit(attacker, rng){
  let crit = attacker.crit || 0;
  const luck = attacker.luck || 0;
  crit += luck * 0.15;
  crit += (attacker.getAttr?attacker.getAttr('感知'):0) * 0.2;
  // 偷袭
  if(attacker.hasStatus && attacker.hasStatus('sneak')) crit += 30;
  let chance = crit / 100;
  chance = Math.max(0.01, Math.min(0.6, chance));
  return rng.chance(chance);
}

// ---- 近战/远程攻击 ----
export function attack(attacker, defender, rng, log){
  if(!attacker.alive || !defender.alive) return {hit:false};
  // 弹药检查
  if(attacker.isRanged && attacker.isRanged() && !attacker.hasAmmo()){
    if(log && attacker.isPlayer) log('弹药耗尽！', 'warn');
    return {hit:false, noAmmo:true};
  }

  const hit = rollHit(attacker, defender, rng);
  if(!hit){
    if(log) log(`${defender.name} 闪避了攻击`, 'info');
    // 技能成长（挥空也给少量经验）
    gainAttackXP(attacker, 1, log);
    if(attacker.isRanged && attacker.isRanged()) attacker.consumeAmmo();
    return {hit:false, dodged:true};
  }

  let dmg = attacker.weaponDamage(rng);
  // 暴击
  const crit = rollCrit(attacker, rng);
  if(crit){
    dmg = Math.floor(dmg * 1.8);
    if(log) log(`暴击！`, 'warn');
  }
  // 元素（武器无元素，简化）
  const ele = null;

  // 护甲减伤 (PV)
  const pv = defender.pv || 0;
  dmg = Math.max(1, dmg - Math.floor(pv * 0.8));
  // 处刑人：法力之体
  if(defender.manaBody && defender.mp > 0){
    const toMana = Math.min(defender.mp, Math.floor(dmg * 0.5));
    defender.mp -= toMana;
    dmg -= toMana;
  }

  dmg = Math.min(DMG_CAP, Math.max(0, dmg));
  applyDamage(defender, dmg, attacker, rng, log);

  // 弹药消耗
  if(attacker.isRanged && attacker.isRanged()) attacker.consumeAmmo();

  // 状态效果（攻击附带）
  applyAttackStatus(attacker, defender, rng, log);

  // 技能成长
  gainAttackXP(attacker, 3 + Math.floor(dmg/5), log);
  // 被攻击方防御技能成长
  if(defender.isPlayer) defender.gainSkillXP && defender.gainSkillXP('灵巧', 1);

  // 特殊攻击效果
  if(attacker.attacks === '吸血' && dmg > 0){
    const heal = Math.floor(dmg * 0.5);
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
    if(log) log(`${attacker.name} 吸取了 ${heal} 生命`, 'info');
  }
  if(attacker.attacks === '冰冷触碰' && defender.alive){
    defender.addStatus('slow', '减速', 5, 1, '速度', true);
    if(rng.chance(0.3)) defender.addStatus('frozen', '冰冻', 2, 1, null, true);
  }

  return {hit:true, dmg, crit, ele};
}

// ---- 造成伤害（统一入口）----
export function applyDamage(target, dmg, source, rng, log){
  if(!target.alive) return;
  target.hp -= dmg;
  target._lastDamaged = performance.now();
  if(log){
    if(target.isPlayer) log(`你受到 ${dmg} 点伤害`, 'dmg');
    else if(source && source.isPlayer) log(`对 ${target.name} 造成 ${dmg} 伤害`, 'dmg');
  }
  if(target.hp <= 0){
    target.hp = 0;
    target.alive = false;
    onDeath(target, source, rng, log);
  }
}

// ---- 法术施放 ----
export function castSpell(caster, spellId, target, rng, log, map){
  const spell = SPELLS[spellId];
  if(!spell) return {ok:false};
  const sp = caster.spells[spellId];
  if(!sp || sp.stock <= 0){
    if(log && caster.isPlayer) log(`${spell.name} 使用次数耗尽`, 'warn');
    return {ok:false};
  }
  if(caster.mp < spell.mp){
    if(log && caster.isPlayer) log('法力不足', 'warn');
    return {ok:false};
  }
  sp.stock--;
  caster.mp -= spell.mp;
  caster.gainSkillXP && caster.gainSkillXP('施法', 5);

  // 治疗法术
  if(spell.heal){
    let heal = rollDice(spell.power, rng);
    heal += Math.floor((caster.getAttr?caster.getAttr('魔力'):0) * 0.5);
    heal += Math.floor((caster.skills['施法']?caster.skills['施法'].level:0) * 2);
    const tgt = target || caster;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
    if(log) log(`${tgt.name} 恢复了 ${heal} HP`, 'heal');
    return {ok:true, heal};
  }

  // 攻击法术
  if(!target) return {ok:false};
  let dmg = rollDice(spell.power, rng);
  dmg += Math.floor((caster.getAttr?caster.getAttr('魔力'):0) * 0.6);
  dmg += Math.floor((caster.skills['施法']?caster.skills['施法'].level:0) * 3);
  // 施法加成（法杖/法袍）
  let castBonus = 0;
  if(caster.equipment){
    for(const slot in caster.equipment){
      const it = caster.equipment[slot];
      if(it && it.castBonus) castBonus += it.castBonus;
    }
  }
  dmg = Math.floor(dmg * (1 + castBonus*0.1));
  // 元素抗性
  const resist = target.getResist ? target.getResist(spell.ele) : 0;
  if(resist > 0){
    dmg = Math.floor(dmg * (1 - resist/100));
    if(log) log(`${target.name} 抵抗了${spell.ele}元素`, 'info');
  }
  // AoE
  const aoeTiles = [];
  if(spell.radius > 0 && map){
    for(let dx=-spell.radius; dx<=spell.radius; dx++){
      for(let dy=-spell.radius; dy<=spell.radius; dy++){
        if(Math.abs(dx)+Math.abs(dy) <= spell.radius){
          aoeTiles.push({x:target.x+dx, y:target.y+dy});
        }
      }
    }
    // AoE 伤害范围内所有实体
    const eulderna = caster.race === 'eulderna'; // 法术精准：不误伤队友
    for(const e of map.entities){
      if(!e.alive) continue;
      if(Math.abs(e.x-target.x)+Math.abs(e.y-target.y) <= spell.radius){
        if(eulderna && !e.isPlayer && caster.isPlayer){
          // 友军判定简化：玩家施法不误伤宠物（暂无宠物系统，跳过）
        }
        if(e !== caster){
          applyDamage(e, dmg, caster, rng, log);
        }
      }
    }
  } else {
    applyDamage(target, dmg, caster, rng, log);
  }
  // 法术附带状态
  if(spell.ele === '火' && target.alive && rng.chance(0.3)){
    target.addStatus('burn', '燃烧', 3, 1, null, true);
  }
  if(spell.ele === '冰' && target.alive && rng.chance(0.3)){
    target.addStatus('slow', '减速', 4, 1, '速度', true);
  }
  return {ok:true, dmg, aoeTiles};
}

// ---- 攻击附带状态 ----
function applyAttackStatus(attacker, defender, rng, log){
  // 武器附魔状态（简化）
  if(attacker.equipment && attacker.equipment['武器'] && attacker.equipment['武器'].enchants){
    // 暂不实现武器附魔触发状态
  }
}

// ---- 攻击技能经验 ----
function gainAttackXP(attacker, amount, log){
  if(!attacker.gainSkillXP) return;
  const sk = attacker.weaponSkill ? attacker.weaponSkill() : null;
  if(sk) attacker.gainSkillXP(sk, amount);
  attacker.gainSkillXP('战术', Math.floor(amount*0.3));
}

// ---- 死亡处理 ----
function onDeath(victim, killer, rng, log){
  if(log){
    if(victim.isPlayer){
      log(`你被 ${killer?killer.name:'未知力量'} 击杀了…`, 'dmg');
    } else {
      log(`${victim.name} 被击败了`, 'info');
    }
  }
  // 掉落
  if(!victim.isPlayer){
    victim._drops = [];
    if(victim.drops){
      for(const d of victim.drops){
        if(rng.chance(d.chance)){
          if(d.id === 'gold'){
            const amt = d.min? rng.int(d.min, d.max) : 10;
            victim._drops.push({item:{id:'gold',name:'金币',icon:'🪙',type:'currency',amount:amt,weight:0}});
          } else if(d.count){
            for(let i=0;i<d.count;i++) victim._drops.push({item:{id:d.id}});
          } else {
            victim._drops.push({item:{id:d.id}});
          }
        }
      }
    }
    // 经验
    if(killer && killer.gainXP){
      killer.gainXP(victim.xp || 5, log);
      if(killer.isPlayer) killer.killCount = (killer.killCount||0)+1;
    }
  }
}

// ---- 状态效果每回合结算 ----
export function tickStatusEffects(entity, rng, log){
  if(!entity.alive) return;
  for(let i=entity.statusEffects.length-1; i>=0; i--){
    const s = entity.statusEffects[i];
    // 持续伤害
    if(s.id === 'poison'){
      const d = s.level * 2;
      entity.hp -= d;
      if(log && entity.isPlayer) log(`中毒受到 ${d} 伤害`, 'dmg');
      if(entity.hp <= 0){ entity.hp=0; entity.alive=false; if(log) log(`${entity.name} 被毒死了`, 'dmg'); }
    }
    if(s.id === 'burn'){
      const d = s.level * 3;
      entity.hp -= d;
      if(log && entity.isPlayer) log(`燃烧受到 ${d} 伤害`, 'dmg');
      if(entity.hp <= 0){ entity.hp=0; entity.alive=false; }
    }
    if(s.id === 'bleed'){
      const d = s.level * 2;
      entity.hp -= d;
      if(entity.hp <= 0){ entity.hp=0; entity.alive=false; }
    }
    s.dur--;
    if(s.dur <= 0) entity.statusEffects.splice(i,1);
  }
}

// ---- 回合再生 ----
export function regenEntity(entity, rng){
  if(!entity.alive) return;
  // HP 回复（缓慢）
  if(entity.hp < entity.maxHp){
    const r = entity.regen || 0;
    entity.hp = Math.min(entity.maxHp, entity.hp + 0.1 + r*0.5);
    if(entity.hp < entity.maxHp && entity.isPlayer){
      // 玩家每回合微量回复
      entity.hp = Math.min(entity.maxHp, entity.hp + 0.05);
    }
  }
  // MP 回复
  if(entity.mp < entity.maxMp){
    const med = entity.skills['冥想']?entity.skills['冥想'].level:0;
    entity.mp = Math.min(entity.maxMp, entity.mp + 0.15 + med*0.1);
  }
}
