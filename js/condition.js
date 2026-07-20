// ===== Condition 状态效果系统：基类 + 20+ 常用状态 =====
// 移植自原版 Elin 的 Condition 体系
// 每个状态效果都有：持续时间、等级、属性修改、回合效果

// ---------- 状态效果定义 ----------
export const CONDITIONS = {
  // ===== 持续伤害类 =====
  poison: {
    id:'poison', name:'中毒', icon:'☠', color:'#6a4a8a', bad:true,
    desc:'每回合受到毒素伤害',
    perTurn(c, level, rng){ return level * 2; },  // 每回合伤害
    duration: 8,
  },
  burn: {
    id:'burn', name:'燃烧', icon:'🔥', color:'#e05a2a', bad:true,
    desc:'每回合受到火焰伤害',
    perTurn(c, level, rng){ return level * 3; },
    duration: 5,
  },
  bleed: {
    id:'bleed', name:'流血', icon:'🩸', color:'#c04040', bad:true,
    desc:'每回合流失生命',
    perTurn(c, level, rng){ return level * 2; },
    duration: 6,
  },
  frozen: {
    id:'frozen', name:'冰冻', icon:'🧊', color:'#6aafe0', bad:true,
    desc:'无法行动，受到攻击必中',
    perTurn(){ return 0; },
    duration: 3,
    effect: 'skipTurn',
  },

  // ===== 移动/速度类 =====
  slow: {
    id:'slow', name:'减速', icon:'🐌', color:'#8a8a6a', bad:true,
    desc:'移动速度降低',
    perTurn(){ return 0; },
    duration: 5,
    speedMod: -30,
  },
  haste: {
    id:'haste', name:'加速', icon:'⚡', color:'#e0d04a', bad:false,
    desc:'移动速度提升',
    perTurn(){ return 0; },
    duration: 5,
    speedMod: 30,
  },
  paralysis: {
    id:'paralysis', name:'麻痹', icon:'⚡', color:'#c0c040', bad:true,
    desc:'无法移动和攻击',
    perTurn(){ return 0; },
    duration: 3,
    effect: 'skipTurn',
  },

  // ===== 属性修正类 =====
  bless: {
    id:'bless', name:'祝福', icon:'✨', color:'#e0e0a0', bad:false,
    desc:'全属性提升',
    perTurn(){ return 0; },
    duration: 20,
    attrMods: { '力量':3, '魔力':3, '意志':3, '灵巧':3, '感知':3 },
  },
  curse: {
    id:'curse', name:'诅咒', icon:'💀', color:'#6a2a6a', bad:true,
    desc:'全属性降低',
    perTurn(){ return 0; },
    duration: 15,
    attrMods: { '力量':-3, '魔力':-3, '意志':-3, '灵巧':-3, '感知':-3 },
  },
  brave: {
    id:'brave', name:'勇气', icon:'🛡', color:'#e0a040', bad:false,
    desc:'攻击力提升',
    perTurn(){ return 0; },
    duration: 10,
    attrMods: { '力量':5 },
  },
  weaken: {
    id:'weaken', name:'虚弱', icon:'💧', color:'#6a6a8a', bad:true,
    desc:'力量降低',
    perTurn(){ return 0; },
    duration: 8,
    attrMods: { '力量':-5 },
  },
  confuse: {
    id:'confuse', name:'混乱', icon:'💫', color:'#c060c0', bad:true,
    desc:'有概率攻击友方',
    perTurn(){ return 0; },
    duration: 5,
    effect: 'confuse',
  },
  blind: {
    id:'blind', name:'失明', icon:'🌑', color:'#3a3a3a', bad:true,
    desc:'命中率大幅降低',
    perTurn(){ return 0; },
    duration: 5,
    effect: 'blind',
  },
  silence: {
    id:'silence', name:'沉默', icon:'🤐', color:'#6a6a6a', bad:true,
    desc:'无法使用法术',
    perTurn(){ return 0; },
    duration: 8,
    effect: 'silence',
  },
  fear: {
    id:'fear', name:'恐惧', icon:'👻', color:'#8a4a8a', bad:true,
    desc:'无法主动攻击',
    perTurn(){ return 0; },
    duration: 5,
    effect: 'fear',
  },
  sleep: {
    id:'sleep', name:'睡眠', icon:'💤', color:'#4a4a8a', bad:true,
    desc:'无法行动，受到攻击时醒来',
    perTurn(){ return 0; },
    duration: 10,
    effect: 'sleep',
  },
  regen: {
    id:'regen', name:'再生', icon:'💚', color:'#40c040', bad:false,
    desc:'每回合恢复生命',
    perTurn(c, level){ return -(level * 3); },  // 负数 = 治疗
    duration: 10,
  },
  manaShield: {
    id:'manaShield', name:'法力护盾', icon:'💠', color:'#4a8ae0', bad:false,
    desc:'受到伤害时优先消耗法力',
    perTurn(){ return 0; },
    duration: 15,
    effect: 'manaShield',
  },
  sneak: {
    id:'sneak', name:'潜行', icon:'🌑', color:'#4a4a4a', bad:false,
    desc:'下次攻击必定暴击',
    perTurn(){ return 0; },
    duration: 1,
    effect: 'sneak',
  },
  atkUp: {
    id:'atkUp', name:'攻击强化', icon:'⚔', color:'#e06040', bad:false,
    desc:'攻击力提升',
    perTurn(){ return 0; },
    duration: 8,
    attrMods: { '力量':8 },
  },
  defUp: {
    id:'defUp', name:'防御强化', icon:'🛡', color:'#4a8ae0', bad:false,
    desc:'防御力提升',
    perTurn(){ return 0; },
    duration: 8,
    dvBonus: 5, pvBonus: 5,
  },
  // 醉酒
  drunk: {
    id:'drunk', name:'醉酒', icon:'🍺', color:'#c08040', bad:true,
    desc:'灵巧降低，感知降低',
    perTurn(){ return 0; },
    duration: 20,
    attrMods: { '灵巧':-3, '感知':-2 },
  },
  // 饱腹
  full: {
    id:'full', name:'饱腹', icon:'🍖', color:'#a0c040', bad:false,
    desc:'生命恢复加速',
    perTurn(){ return 0; },
    duration: 30,
    effect: 'regenBonus',
  },
  // 以太之风
  ether: {
    id:'ether', name:'以太侵蚀', icon:'🌀', color:'#c060e0', bad:true,
    desc:'持续受到以太伤害',
    perTurn(c, level, rng){ return level * 4; },
    duration: 10,
  },
};

// ---------- Condition 实例 ----------
export class Condition {
  constructor(def, level = 1){
    this.id = def.id;
    this.def = def;
    this.name = def.name;
    this.level = level;
    this.dur = def.duration || 5;
    this.bad = def.bad;
    this.turnsElapsed = 0;
  }

  // 每回合处理
  tick(entity, rng, log){
    this.turnsElapsed++;

    // 持续伤害/治疗
    if(this.def.perTurn){
      const dmg = this.def.perTurn(entity, this.level, rng);
      if(dmg > 0){
        entity.hp -= dmg;
        if(log && entity.isPlayer) log(`${this.name}造成 ${dmg} 伤害`, 'dmg');
        if(entity.hp <= 0){
          entity.hp = 0;
          entity.alive = false;
        }
      } else if(dmg < 0){
        // 负数 = 治疗
        const heal = -dmg;
        entity.hp = Math.min(entity.maxHp, entity.hp + heal);
      }
    }

    this.dur--;
    return this.dur <= 0;  // 返回 true 表示应移除
  }

  // 获取属性修正
  getAttrMod(attrName){
    if(this.def.attrMods && this.def.attrMods[attrName]){
      return this.def.attrMods[attrName] * this.level;
    }
    return 0;
  }

  // 获取DV修正
  getDVMod(){
    let mod = 0;
    if(this.def.dvBonus) mod += this.def.dvBonus * this.level;
    return mod;
  }

  // 获取PV修正
  getPVMod(){
    let mod = 0;
    if(this.def.pvBonus) mod += this.def.pvBonus * this.level;
    return mod;
  }

  // 获取速度修正
  getSpeedMod(){
    if(this.def.speedMod) return this.def.speedMod * this.level;
    return 0;
  }

  // 是否阻止行动
  get blocksAction(){
    return this.def.effect === 'skipTurn' ||
           this.def.effect === 'sleep' ||
           this.def.effect === 'paralysis';
  }

  // 是否阻止移动
  get blocksMovement(){
    return this.def.effect === 'skipTurn' ||
           this.def.effect === 'sleep' ||
           this.def.effect === 'paralysis';
  }

  // 是否阻止施法
  get blocksCasting(){
    return this.def.effect === 'silence';
  }

  // 是否阻止攻击
  get blocksAttack(){
    return this.def.effect === 'fear';
  }

  serialize(){
    return { id:this.id, level:this.level, dur:this.dur, turnsElapsed:this.turnsElapsed };
  }

  static deserialize(data){
    const def = CONDITIONS[data.id];
    if(!def) return null;
    const c = new Condition(def, data.level);
    c.dur = data.dur;
    c.turnsElapsed = data.turnsElapsed || 0;
    return c;
  }
}

// ---------- ConditionManager（附加到实体上）----------
export class ConditionManager {
  constructor(){
    this.conditions = [];  // Condition[]
  }

  // 添加状态
  add(condDef, level = 1){
    // 检查是否已存在（叠加或刷新）
    const existing = this.conditions.find(c => c.id === condDef.id);
    if(existing){
      existing.level = Math.max(existing.level, level);
      existing.dur = Math.max(existing.dur, condDef.duration || 5);
      return existing;
    }
    const c = new Condition(condDef, level);
    this.conditions.push(c);
    return c;
  }

  // 移除状态
  remove(condId){
    const idx = this.conditions.findIndex(c => c.id === condId);
    if(idx >= 0) this.conditions.splice(idx, 1);
  }

  // 检查是否有某状态
  has(condId){ return this.conditions.some(c => c.id === condId); }

  // 获取某状态
  get(condId){ return this.conditions.find(c => c.id === condId); }

  // 每回合处理
  tickAll(entity, rng, log){
    for(let i = this.conditions.length - 1; i >= 0; i--){
      const c = this.conditions[i];
      const shouldRemove = c.tick(entity, rng, log);
      if(shouldRemove){
        this.conditions.splice(i, 1);
      }
    }
  }

  // 获取所有属性修正
  getAttrMods(){
    const mods = {};
    for(const c of this.conditions){
      if(c.def.attrMods){
        for(const [attr, val] of Object.entries(c.def.attrMods)){
          mods[attr] = (mods[attr] || 0) + val * c.level;
        }
      }
    }
    return mods;
  }

  // 获取DV修正
  getDVMod(){
    let mod = 0;
    for(const c of this.conditions) mod += c.getDVMod();
    return mod;
  }

  // 获取PV修正
  getPVMod(){
    let mod = 0;
    for(const c of this.conditions) mod += c.getPVMod();
    return mod;
  }

  // 获取速度修正
  getSpeedMod(){
    let mod = 0;
    for(const c of this.conditions) mod += c.getSpeedMod();
    return mod;
  }

  // 是否阻止行动
  get blocksAction(){ return this.conditions.some(c => c.blocksAction); }

  // 是否阻止移动
  get blocksMovement(){ return this.conditions.some(c => c.blocksMovement); }

  // 是否阻止施法
  get blocksCasting(){ return this.conditions.some(c => c.blocksCasting); }

  // 是否阻止攻击
  get blocksAttack(){ return this.conditions.some(c => c.blocksAttack); }

  // 是否有持续伤害
  get hasDOT(){ return this.conditions.some(c => c.def.perTurn && c.def.perTurn(0, 0) > 0); }

  // 是否有益
  get hasBuff(){ return this.conditions.some(c => !c.bad); }

  // 是否有害
  get hasDebuff(){ return this.conditions.some(c => c.bad); }

  serialize(){
    return this.conditions.map(c => c.serialize());
  }

  static deserialize(data){
    const m = new ConditionManager();
    if(data){
      for(const cdata of data){
        const c = Condition.deserialize(cdata);
        if(c) m.conditions.push(c);
      }
    }
    return m;
  }
}

// ---------- 快捷创建函数 ----------
export function addCondition(entity, condId, level = 1){
  const def = CONDITIONS[condId];
  if(!def) return null;
  if(!entity.conditions) entity.conditions = new ConditionManager();
  return entity.conditions.add(def, level);
}

export function hasCondition(entity, condId){
  return entity.conditions ? entity.conditions.has(condId) : false;
}

export function removeCondition(entity, condId){
  if(entity.conditions) entity.conditions.remove(condId);
}
