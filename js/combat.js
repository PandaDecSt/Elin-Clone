// ===== 战斗系统：移植原版 AttackProcess 完整公式 =====
// 包含：命中/暴击/DV-PV/穿透/元素/武器类型/战斗风格/反击/格挡

import { SPELLS, ELEMENTS, ITEMS } from './data.js';
import { rollDice, RNG, parseDice } from './rng.js';
import { qualityMult } from './item.js';
import { curve, ELE_ID } from './element.js';

const DMG_CAP = 9999999;

// ---------- 武器攻击类型 ----------
export const AttackType = {
  Slash: 'slash',
  Blunt: 'blunt',
  Pierce: 'pierce',
  Bow: 'bow',
  Firearm: 'firearm',
  Cane: 'cane',
  Claw: 'claw',
  Punch: 'punch',
};

// ---------- 战斗风格 ----------
export const AttackStyle = {
  Default: 'default',
  TwoHand: 'twoHand',
  Shield: 'shield',
  DualWield: 'dualWield',
};

// ---------- 攻击过程（移植自原版 AttackProcess）----------
export class AttackProcess {
  constructor(){
    // 伤害骰
    this.dNum = 0;       // 骰子数量
    this.dDim = 0;       // 骰子面数
    this.dBonus = 0;     // 固定加值
    this.dMulti = 1.0;   // 伤害倍率

    // 命中
    this.toHit = 0;
    this.toHitBase = 0;
    this.toHitFix = 0;

    // 闪避
    this.evasion = 0;

    // 穿透
    this.penetration = 0;

    // 距离修正
    this.distMod = 100;

    // 武器/弹药
    this.weapon = null;
    this.ammo = null;
    this.weaponSkill = 0;
    this.weaponSkillParent = 0;

    // 攻击类型
    this.attackType = AttackType.Slash;
    this.attackStyle = AttackStyle.Default;

    // 结果
    this.hit = false;
    this.crit = false;
    this.evade = false;
    this.rawDamage = 0;
    this.finalDamage = 0;

    // 攻击者/目标
    this.CC = null;  // 攻击角色
    this.TC = null;  // 目标角色
  }
}

// ---------- 准备伤害计算（Prepare）----------
export function prepareDamage(attacker, defender, weapon, rng){
  const ap = new AttackProcess();
  ap.CC = attacker;
  ap.TC = defender;
  ap.weapon = weapon;

  const isRanged = weapon && weapon.ranged;
  const isTwoHanded = weapon && weapon.twoHanded;
  const hasShield = attacker.equipment && attacker.equipment['盾牌'];

  // 确定攻击风格
  if(isTwoHanded && !hasShield){
    ap.attackStyle = AttackStyle.TwoHand;
  } else if(hasShield && !isRanged){
    ap.attackStyle = AttackStyle.Shield;
  }

  // 获取武器技能值
  const skName = attacker.weaponSkill ? attacker.weaponSkill() : '格斗';
  const sk = attacker.skills && attacker.skills[skName];
  ap.weaponSkill = sk ? sk.level : 0;
  ap.weaponSkillParent = ap.weaponSkill;  // 父技能（简化为同一技能）

  // 根据攻击类型计算伤害骰
  if(!weapon || weapon.type !== 'weapon'){
    // 徒手攻击
    _prepareMartialArts(ap, attacker, rng);
  } else {
    // 武器攻击
    _prepareWeapon(ap, attacker, weapon, rng);
  }

  // 计算命中
  _prepareHit(ap, attacker, weapon, isRanged);

  // 计算闪避
  _prepareEvasion(ap, defender);

  // 计算穿透
  _preparePenetration(ap, attacker, weapon);

  return ap;
}

// ---------- 徒手/格斗伤害 ----------
function _prepareMartialArts(ap, attacker, rng){
  const str = attacker.getAttr ? attacker.getAttr('力量') : (attacker.attrs['力量'] || 0);
  const martialArts = ap.weaponSkill;

  // 骰子数量 = 2 + min(格斗/10, 4)，最多 d6
  ap.dNum = 2 + Math.min(Math.floor(martialArts / 10), 4);
  // 骰子面数 = 5 + sqrt(格斗/3)
  ap.dDim = 5 + Math.floor(Math.sqrt(martialArts / 3));
  // 固定加值 = sqrt(力量/5 + 格斗/4)
  ap.dBonus = Math.floor(Math.sqrt(str / 5 + martialArts / 4));
  // 伤害倍率 = 0.6 + (力量/2 + 格斗/2 + 战术/2) / 50
  const tactics = attacker.skills && attacker.skills['战术'] ? attacker.skills['战术'].level : 0;
  ap.dMulti = 0.6 + (str / 2 + martialArts / 2 + tactics / 2) / 50;

  ap.attackType = AttackType.Punch;
}

// ---------- 武器伤害 ----------
function _prepareWeapon(ap, attacker, weapon, rng){
  // 从武器数据读取伤害骰
  const diceStr = weapon.dice || '1d4';
  const d = parseDice(diceStr);
  ap.dNum = d.count;
  ap.dDim = d.sides;
  ap.dBonus = d.bonus + (weapon.bonus || 0);

  // 武器品质倍率
  const qMult = qualityMult(weapon.quality);
  ap.dMulti = qMult;

  // 武器技能加成
  const weaponSkillBonus = ap.weaponSkill / 50;
  ap.dMulti *= (1 + weaponSkillBonus);

  // 攻击类型
  if(weapon.id && weapon.id.includes('sword')){
    ap.attackType = AttackType.Slash;
  } else if(weapon.id && (weapon.id.includes('axe') || weapon.id.includes('hammer') || weapon.id.includes('mace'))){
    ap.attackType = AttackType.Blunt;
  } else if(weapon.id && (weapon.id.includes('spear') || weapon.id.includes('pike') || weapon.id.includes('rapier'))){
    ap.attackType = AttackType.Pierce;
  } else if(weapon.ranged && weapon.ammo === 'arrow'){
    ap.attackType = AttackType.Bow;
  } else if(weapon.ranged && weapon.ammo === 'bullet'){
    ap.attackType = AttackType.Firearm;
  } else if(weapon.id && weapon.id.includes('staff')){
    ap.attackType = AttackType.Cane;
  } else {
    ap.attackType = AttackType.Slash;
  }

  // 双手武器倍率
  if(ap.attackStyle === AttackStyle.TwoHand){
    const twoHandSkill = attacker.skills && attacker.skills['双刀流'] ? attacker.skills['双刀流'].level : 0;
    ap.dMulti *= (1 + 0.05 * Math.floor(twoHandSkill / 5));
  }
}

// ---------- 命中计算 ----------
function _prepareHit(ap, attacker, weapon, isRanged){
  const dex = attacker.getAttr ? attacker.getAttr('灵巧') : (attacker.attrs['灵巧'] || 0);
  const wil = attacker.getAttr ? attacker.getAttr('意志') : (attacker.attrs['意志'] || 0);
  const per = attacker.getAttr ? attacker.getAttr('感知') : (attacker.attrs['感知'] || 0);
  const tactics = attacker.skills && attacker.skills['战术'] ? attacker.skills['战术'].level : 0;

  // 基础命中 = curve(属性 + 技能, 50, 25, 75) + 50
  let baseStat;
  if(ap.attackType === AttackType.Cane){
    baseStat = wil;
  } else if(isRanged){
    baseStat = dex;
  } else {
    baseStat = dex;
  }

  ap.toHitBase = curve(
    Math.floor(baseStat / 4 + ap.weaponSkillParent / 3 + ap.weaponSkill),
    50, 25, 75
  ) + 50;

  // 武器命中加成
  const weaponHit = weapon ? (weapon.hit || 0) : 0;
  ap.toHit = ap.toHitBase + ap.toHitFix + weaponHit;

  // 双手武器加成
  if(ap.attackStyle === AttackStyle.TwoHand){
    const twoHandSkill = attacker.skills && attacker.skills['双刀流'] ? attacker.skills['双刀流'].level : 0;
    ap.toHit += 25 + Math.floor(Math.sqrt(twoHandSkill * 2));
  }

  // 盾牌命中惩罚
  if(ap.attackStyle === AttackStyle.Shield){
    const shieldSkill = attacker.skills && attacker.skills['格斗'] ? attacker.skills['格斗'].level : 0;
    ap.toHit = Math.floor(ap.toHit * (100 - Math.min(25, shieldSkill)) / 100);
  }

  // 状态修正
  if(attacker.hasStatus && attacker.hasStatus('blind')) ap.toHit = Math.floor(ap.toHit / 3);
  if(attacker.hasStatus && attacker.hasStatus('confuse')) ap.toHit = Math.floor(ap.toHit * 0.7);
  if(defender_hasCondition(attacker, 'fear')) ap.toHit = Math.floor(ap.toHit * 0.8);

  // 高地加成
  // (简化：跳过)
}

// ---------- 闪避计算 ----------
function _prepareEvasion(ap, defender){
  const per = defender.getAttr ? defender.getAttr('感知') : (defender.attrs['感知'] || 0);
  const dv = defender.dv || 0;

  // 闪避 = curve(感知 + 闪避技能, 50, 10, 75) + DV + 25
  const evasionSkill = defender.skills && defender.skills['灵巧'] ? defender.skills['灵巧'].level : 0;
  ap.evasion = curve(
    Math.floor(per / 3 + evasionSkill),
    50, 10, 75
  ) + dv + 25;

  // 状态修正
  if(defender.hasStatus && defender.hasStatus('slow')) ap.evasion = Math.floor(ap.evasion * 0.7);
  if(defender.hasStatus && defender.hasStatus('frozen')) ap.evasion = 0;
  if(defender.hasStatus && defender.hasStatus('sleep')) ap.evasion = 0;
  if(defender.hasStatus && defender.hasStatus('paralysis')) ap.evasion = 0;
}

// ---------- 穿透计算 ----------
function _preparePenetration(ap, attacker, weapon){
  let pen = 5;

  if(weapon){
    // 武器穿透 = 武器穿透值 + 技能/10
    pen = (weapon.penetration || 5) + Math.floor(ap.weaponSkill / 10);
  } else {
    // 徒手穿透 = 格斗/10 + 5
    pen = Math.floor(ap.weaponSkill / 10) + 5;
  }

  // 穿透上限
  ap.penetration = Math.max(5, Math.min(20, pen));
}

// ---------- 执行攻击（Perform）----------
export function performAttack(ap, rng, log){
  if(!ap.CC || !ap.TC) return ap;

  // 随机化伤害骰
  let baseDmg = 0;
  for(let i = 0; i < ap.dNum; i++){
    baseDmg += rng.int(1, Math.max(1, ap.dDim));
  }
  baseDmg += ap.dBonus;
  baseDmg = Math.floor(baseDmg * ap.dMulti);

  ap.rawDamage = baseDmg;

  // 命中判定
  const hitChance = ap.toHit / (ap.toHit + Math.max(1, ap.evasion));
  const clampedHit = Math.max(0.05, Math.min(0.95, hitChance));

  // 暴击判定
  let critChance = (ap.CC.crit || 0) / 100;
  const luck = ap.CC.luck || 0;
  critChance += luck * 0.001;
  const per = ap.CC.getAttr ? ap.CC.getAttr('感知') : (ap.CC.attrs['感知'] || 0);
  critChance += per * 0.002;
  // 偷袭加成
  if(ap.CC.hasStatus && ap.CC.hasStatus('sneak')) critChance += 0.3;
  // 低生命值加成
  if(ap.CC.hp < ap.CC.maxHp * 0.25) critChance += 0.1;
  critChance = Math.max(0.01, Math.min(0.6, critChance));

  // 目标沉睡/死亡 → 必定暴击
  if(ap.TC.hasStatus && ap.TC.hasStatus('sleep')) critChance = 1.0;

  // 随机判定
  const hitRoll = rng.float();
  const critRoll = rng.float();

  if(critRoll < critChance){
    // 暴击
    ap.crit = true;
    ap.hit = true;
    baseDmg = Math.floor(baseDmg * 1.8);
  } else if(hitRoll < clampedHit){
    // 命中
    ap.hit = true;
  } else {
    // 闪避
    ap.evade = true;
    ap.hit = false;
    if(log && ap.CC.isPlayer) log(`${ap.TC.name} 闪避了攻击`, 'info');
    return ap;
  }

  // 护甲减伤
  let finalDmg = baseDmg;
  const pv = ap.TC.pv || 0;

  // PV 减伤公式（原版风格）
  if(ap.attackType === AttackType.Blunt){
    // 钝器对护甲效果较差
    finalDmg = Math.max(1, finalDmg - Math.floor(pv * 0.6));
  } else if(ap.attackType === AttackType.Pierce){
    // 穿透对护甲效果较好（已被穿透值处理一部分）
    finalDmg = Math.max(1, finalDmg - Math.floor(pv * 0.5));
  } else {
    // 标准减伤
    finalDmg = Math.max(1, finalDmg - Math.floor(pv * 0.8));
  }

  // 穿透修正
  if(ap.penetration > 0){
    const penReduction = Math.floor(pv * (1 - ap.penetration / 20));
    finalDmg = Math.max(1, finalDmg - Math.max(0, penReduction));
  }

  // 法力之体（处刑人特性）
  if(ap.TC.manaBody && ap.TC.mp > 0){
    const toMana = Math.min(ap.TC.mp, Math.floor(finalDmg * 0.5));
    ap.TC.mp -= toMana;
    finalDmg -= toMana;
  }

  // 等级压制减伤（高等级目标）
  if(ap.TC.level > 50){
    const levelDR = Math.min(80, Math.floor(Math.sqrt(ap.TC.level - 50) * 2.5));
    finalDmg = Math.floor(finalDmg * (100 - levelDR) / 100);
  }

  finalDmg = Math.max(1, Math.min(DMG_CAP, finalDmg));
  ap.finalDamage = finalDmg;

  return ap;
}

// ---------- 完整攻击流程（一步到位）----------
export function attack(attacker, defender, rng, log){
  if(!attacker.alive || !defender.alive) return {hit:false};

  // 弹药检查
  if(attacker.isRanged && attacker.isRanged() && !attacker.hasAmmo()){
    if(log && attacker.isPlayer) log('弹药耗尽！', 'warn');
    return {hit:false, noAmmo:true};
  }

  // 获取武器
  const weapon = attacker.equipment ? attacker.equipment['武器'] : null;

  // 准备 + 执行
  const ap = prepareDamage(attacker, defender, weapon, rng);
  performAttack(ap, rng, log);

  if(!ap.hit){
    // 技能成长（挥空也给经验）
    gainAttackXP(attacker, 1, log);
    if(attacker.isRanged && attacker.isRanged()) attacker.consumeAmmo();
    return {hit:false, dodged:true};
  }

  // 应用伤害
  applyDamage(defender, ap.finalDamage, attacker, rng, log);

  // 暴击日志
  if(ap.crit && log) log(`暴击！`, 'warn');

  // 弹药消耗
  if(attacker.isRanged && attacker.isRanged()) attacker.consumeAmmo();

  // 攻击附带状态
  applyAttackStatus(attacker, defender, rng, log);

  // 技能成长
  gainAttackXP(attacker, 3 + Math.floor(ap.finalDamage / 5), log);
  if(defender.isPlayer) defender.gainSkillXP && defender.gainSkillXP('灵巧', 1);

  // 特殊攻击效果
  _applySpecialAttack(attacker, defender, ap.finalDamage, rng, log);

  return {hit:true, dmg:ap.finalDamage, crit:ap.crit, ele:null, ap};
}

// ---------- 特殊攻击效果 ----------
function _applySpecialAttack(attacker, defender, dmg, rng, log){
  // 吸血
  if(attacker.attacks === '吸血' && dmg > 0){
    const heal = Math.floor(dmg * 0.5);
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
    if(log) log(`${attacker.name} 吸取了 ${heal} 生命`, 'info');
  }
  // 冰冷触碰
  if(attacker.attacks === '冰冷触碰' && defender.alive){
    defender.addStatus('slow', '减速', 5, 1, '速度', true);
    if(rng.chance(0.3)) defender.addStatus('frozen', '冰冻', 2, 1, null, true);
  }
  // 麻痹触碰
  if(attacker.attacks === '麻痹' && defender.alive){
    if(rng.chance(0.2)) defender.addStatus('paralysis', '麻痹', 3, 1, null, true);
  }
}

// ---------- 攻击附带状态 ----------
function applyAttackStatus(attacker, defender, rng, log){
  const weapon = attacker.equipment ? attacker.equipment['武器'] : null;
  if(!weapon || !weapon.enchants) return;

  for(const ench of weapon.enchants){
    if(ench.id === 'fire_r' && rng.chance(0.15)){
      defender.addStatus('burn', '燃烧', 3, 1, null, true);
      if(log) log(`${defender.name} 被点燃了！`, 'info');
    }
    if(ench.id === 'ice_r' && rng.chance(0.15)){
      defender.addStatus('slow', '减速', 4, 1, '速度', true);
    }
  }
}

// ---------- 辅助函数 ----------
function defender_hasCondition(entity, condId){
  if(entity.hasStatus) return entity.hasStatus(condId);
  if(entity.conditions) return entity.conditions.has(condId);
  return false;
}

// ---------- 造成伤害（统一入口）----------
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

// ---------- 法术施放 ----------
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

  // 法术威力计算（原版风格）
  let power = 0;
  if(spell.power){
    power = rollDice(spell.power, rng);
  }
  // 魔力加成
  const mag = caster.getAttr ? caster.getAttr('魔力') : (caster.attrs['魔力'] || 0);
  power += Math.floor(mag * 0.6);
  // 施法技能加成
  const castSkill = caster.skills && caster.skills['施法'] ? caster.skills['施法'].level : 0;
  power += Math.floor(castSkill * 3);
  // 装备施法加成
  let castBonus = 0;
  if(caster.equipment){
    for(const slot in caster.equipment){
      const it = caster.equipment[slot];
      if(it && it.castBonus) castBonus += it.castBonus;
    }
  }
  power = Math.floor(power * (1 + castBonus * 0.1));
  // 法力控制减溢出
  const mcSkill = caster.skills && caster.skills['魔力控制'] ? caster.skills['魔力控制'].level : 0;
  // (溢出伤害由外部处理)

  // 治疗法术
  if(spell.heal){
    const heal = Math.max(1, power);
    const tgt = target || caster;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
    if(log) log(`${tgt.name} 恢复了 ${heal} HP`, 'heal');
    return {ok:true, heal};
  }

  // 攻击法术
  if(!target) return {ok:false};

  // 元素抗性
  const resist = target.getResist ? target.getResist(spell.ele) : 0;
  let finalDmg = power;
  if(resist > 0){
    finalDmg = Math.floor(finalDmg * (1 - resist / 100));
    if(log) log(`${target.name} 抵抗了${spell.ele}元素`, 'info');
  }

  // AoE
  const aoeTiles = [];
  if(spell.radius > 0 && map){
    for(let dx = -spell.radius; dx <= spell.radius; dx++){
      for(let dy = -spell.radius; dy <= spell.radius; dy++){
        if(Math.abs(dx) + Math.abs(dy) <= spell.radius){
          aoeTiles.push({x:target.x+dx, y:target.y+dy});
        }
      }
    }
    // AoE 伤害范围内所有实体
    for(const e of map.entities){
      if(!e.alive) continue;
      if(Math.abs(e.x-target.x)+Math.abs(e.y-target.y) <= spell.radius){
        if(e !== caster){
          applyDamage(e, finalDmg, caster, rng, log);
        }
      }
    }
  } else {
    applyDamage(target, finalDmg, caster, rng, log);
  }

  // 法术附带状态
  if(spell.ele === '火' && target.alive && rng.chance(0.3)){
    target.addStatus('burn', '燃烧', 3, 1, null, true);
  }
  if(spell.ele === '冰' && target.alive && rng.chance(0.3)){
    target.addStatus('slow', '减速', 4, 1, '速度', true);
  }
  if(spell.ele === '雷' && target.alive && rng.chance(0.2)){
    target.addStatus('paralysis', '麻痹', 2, 1, null, true);
  }

  return {ok:true, dmg:finalDmg, aoeTiles};
}

// ---------- 攻击技能经验 ----------
function gainAttackXP(attacker, amount, log){
  if(!attacker.gainSkillXP) return;
  const sk = attacker.weaponSkill ? attacker.weaponSkill() : null;
  if(sk) attacker.gainSkillXP(sk, amount);
  attacker.gainSkillXP('战术', Math.floor(amount * 0.3));
}

// ---------- 死亡处理 ----------
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
            const amt = d.min ? rng.int(d.min, d.max) : 10;
            victim._drops.push({item:{id:'gold',name:'金币',icon:'🪙',type:'currency',amount:amt,weight:0}});
          } else if(d.count){
            for(let i = 0; i < d.count; i++) victim._drops.push({item:{id:d.id}});
          } else {
            victim._drops.push({item:{id:d.id}});
          }
        }
      }
    }
    // 经验
    if(killer && killer.gainXP){
      killer.gainXP(victim.xp || 5, log);
      if(killer.isPlayer) killer.killCount = (killer.killCount||0) + 1;
    }
  }
}

// ---------- 状态效果每回合结算 ----------
export function tickStatusEffects(entity, rng, log){
  if(!entity.alive) return;
  // 使用新的 ConditionManager（如果存在）
  if(entity.conditions && entity.conditions.tickAll){
    entity.conditions.tickAll(entity, rng, log);
    return;
  }
  // 兼容旧的状态系统
  for(let i = entity.statusEffects.length - 1; i >= 0; i--){
    const s = entity.statusEffects[i];
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
    if(s.dur <= 0) entity.statusEffects.splice(i, 1);
  }
}

// ---------- 回合再生 ----------
export function regenEntity(entity, rng){
  if(!entity.alive) return;
  if(entity.hp < entity.maxHp){
    const r = entity.regen || 0;
    entity.hp = Math.min(entity.maxHp, entity.hp + 0.1 + r * 0.5);
    if(entity.hp < entity.maxHp && entity.isPlayer){
      entity.hp = Math.min(entity.maxHp, entity.hp + 0.05);
    }
  }
  if(entity.mp < entity.maxMp){
    const med = entity.skills && entity.skills['冥想'] ? entity.skills['冥想'].level : 0;
    entity.mp = Math.min(entity.maxMp, entity.mp + 0.15 + med * 0.1);
  }
}
