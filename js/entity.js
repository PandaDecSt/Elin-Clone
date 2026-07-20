// ===== 实体系统：角色/怪物/属性/等级/状态效果 =====
// 增强版：集成 ElementContainer + ConditionManager + 生存需求系统

import { RACES, CLASSES, ATTRS, SKILLS, ELEMENTS, QUALITY } from './data.js';
import { RNG, rollDice } from './rng.js';
import { makeItem, qualityMult } from './item.js';
import { ElementContainer, ELE_ID, ATTR_NAME_TO_ID, SKILL_NAME_TO_ID } from './element.js';
import { ConditionManager, CONDITIONS, addCondition, hasCondition } from './condition.js';

// ---------- 生存需求系统（移植自原版 Stats）----------
export class SurvivalNeed {
  constructor(name, max = 100, decayRate = 0.1){
    this.name = name;
    this.value = 0;       // 当前值
    this.max = max;       // 最大值
    this.decayRate = decayRate;  // 每秒衰减率
    this.phase = 0;       // 阶段 0-4
    this.thresholds = [0.2, 0.4, 0.6, 0.8];  // 阶段阈值
  }

  // 每帧更新
  update(dt){
    this.value = Math.min(this.max, this.value + this.decayRate * dt);
    this._updatePhase();
  }

  // 消耗
  consume(amount){
    this.value = Math.max(0, this.value - amount);
    this._updatePhase();
  }

  // 补充
  restore(amount){
    this.value = Math.min(this.max, this.value + amount);
    this._updatePhase();
  }

  _updatePhase(){
    const ratio = this.value / this.max;
    for(let i = this.thresholds.length - 1; i >= 0; i--){
      if(ratio >= this.thresholds[i]){
        this.phase = i + 1;
        return;
      }
    }
    this.phase = 0;
  }

  // 是否需要关注
  get needsAttention(){ return this.phase >= 3; }
  get isCritical(){ return this.phase >= 4; }
}

// ---- 创建玩家角色 ----
export function createPlayer(raceId, classId, name, rng){
  const race = RACES[raceId];
  const cls = CLASSES[classId];
  const attrs = {...race.attrs};
  // 速度作为特殊属性存在 attrs.速度
  // 职业加成
  for(const k in cls.attrs){ attrs[k] = (attrs[k]||0) + cls.attrs[k]; }
  // 初始速度
  attrs['速度'] = race.speed + (cls.attrs['速度']||0);

  const player = new Entity({
    name: name || '冒险者',
    isPlayer: true,
    race: raceId,
    class: classId,
    color: race.color,
    attrs,
    life: race.life,
    mana: race.mana,
    speed: attrs['速度'],
  });

  // 初始技能
  player.skills = {};
  if(cls.skills){
    for(const k in cls.skills) player.skills[k] = {level:cls.skills[k], xp:0, potential:100};
  }
  // 初始法术
  player.spells = {};
  if(cls.spells){
    for(const s of cls.spells) player.spells[s] = {stock: 3, xp:0};
  }
  // 职业特性
  if(cls.luck) player.luck = cls.luck;
  if(cls.manaBody) player.manaBody = true;
  // 种族特性
  if(race.dvBonus) player.dvBonus = race.dvBonus;
  if(race.foodBonus) player.foodBonus = race.foodBonus;
  if(race.weightLimit) player.weightLimit = race.weightLimit;

  player.gold = cls.gold || 50;
  player.level = 1;
  player.xp = 0;
  player.xpNext = 30;

  // 初始装备
  player.inventory = [];
  player.equipment = {武器:null,身体:null,头部:null,披风:null,盾牌:null,戒指:[],项链:null,弹药:null};
  if(cls.gear){
    for(const gid of cls.gear){
      const item = makeItem(gid, 0, rng);
      player.inventory.push(item);
    }
  }
  // 自动装备初始武器防具
  for(const item of player.inventory.slice()){
    if(item.type==='weapon' && !player.equipment.武器) equip(player, item);
    else if(item.type==='armor'){
      const slot = item.slot;
      if(slot && !player.equipment[slot]) equip(player, item);
    } else if(item.type==='ammo' && !player.equipment.弹药){
      // 弹药不装备到槽，保留在背包计数
    }
  }

  player.recalcStats();
  player.hp = player.maxHp;
  player.mp = player.maxMp;
  player.stamina = player.maxStamina;
  player.food = 80;
  player.karma = 0;
  player.faith = null;
  player.piety = 0;
  player.turnsAlive = 0;
  player.deaths = 0;
  player.killCount = 0;
  return player;
}

// ---- 创建怪物实例 ----
export function makeMonster(def, x, y, depth, rng){
  const attrs = {...def.attrs};
  const m = new Entity({
    name: def.name,
    isPlayer: false,
    monsterId: def.id,
    color: def.color,
    icon: def.icon,
    attrs,
    life: def.hp,
    mana: def.mp,
    speed: def.speed,
    x, y,
  });
  m.hp = def.hp; m.maxHp = def.hp;
  m.mp = def.mp; m.maxMp = def.mp;
  m.dv = def.dv; m.pv = def.pv;
  m.dice = def.dice; m.bonus = def.bonus;
  m.xp = def.xp; m.level = def.lvl;
  m.aggr = def.aggr;
  m.attacks = def.attacks;
  m.spells = {};
  if(def.spells){
    for(const s of def.spells) m.spells[s] = {stock: 99, xp:0};
  }
  m.resist = def.resist || {};
  m.regen = def.regen || 0;
  m.floats = def.floats;
  m.drops = def.drops || [];
  m.blocksMove = false; // 不在地图层面阻挡，碰撞由 _isWalkableFloatForMonster 单独处理
  m.alive = true;
  m.sightRange = 7;
  m.aiState = 'idle';
  // 难度缩放
  if(depth > def.lvl){
    const scale = 1 + (depth - def.lvl) * 0.15;
    m.maxHp = Math.floor(m.maxHp * scale);
    m.hp = m.maxHp;
    m.dv = Math.floor(m.dv * (1 + (depth-def.lvl)*0.05));
    m.pv = Math.floor(m.pv * (1 + (depth-def.lvl)*0.1));
    m.level = depth;
  }
  return m;
}

// ---- 实体基类 ----
export class Entity{
  constructor(opts){
    this.x = opts.x ?? 0;   // 网格坐标（整数，用于碰撞/FOV）
    this.y = opts.y ?? 0;
    this.px = opts.x ?? 0;  // 像素坐标（浮点，用于平滑移动渲染）
    this.py = opts.y ?? 0;
    this.vx = 0;            // 速度
    this.vy = 0;
    this.facing = 0;        // 朝向角度
    this.attackCD = 0;      // 攻击冷却（秒）
    this.spellCD = 0;       // 法术冷却
    this.aiThinkCD = 0;     // AI 思考间隔
    // ---- 动画状态 ----
    this.animState = 'idle';  // idle | walk | attack | hit | cast
    this.animTime = 0;        // 当前状态持续时间
    this.animDir = { x: 0, y: 1 }; // 朝向（归一化向量）
    this.faceLeft = false;    // 是否面向屏幕左侧（用于精灵翻转）
    this.hitFlash = 0;        // 受击闪烁计时
    this.attackAnim = 0;      // 攻击动画进度（0~1）
    this.name = opts.name || '???';
    this.isPlayer = opts.isPlayer || false;
    this.monsterId = opts.monsterId;
    this.race = opts.race || null;
    this.class = opts.class || null;
    this.color = opts.color || '#cccccc';
    this.icon = opts.icon;
    this.attrs = opts.attrs || {};
    this.life = opts.life || 100;
    this.mana = opts.mana || 100;
    this.speed = opts.speed || 100;
    this.level = 1;
    this.xp = 0; this.xpNext = 30;
    this.hp = 1; this.maxHp = 1;
    this.mp = 0; this.maxMp = 0;
    this.dv = 0; this.pv = 0;
    this.dice = '1d3'; this.bonus = 0;
    this.luck = 0;
    this.alive = true;
    this.blocksMove = true;
    this.sightRange = 7;
    this.statusEffects = []; // [{id,name,dur,level,attr,bad}]
    this.skills = {};
    this.spells = {};
    this.inventory = [];
    this.equipment = {};
    this.gold = 0;
    this.stamina = 100; this.maxStamina = 100;
    this.food = 80;
    this.karma = 0;
    this.regen = 0;
    this.resist = {};
    this.dvBonus = 0;
    this.foodBonus = 0;
    this.weightLimit = 99;
    this.manaBody = false;
    this.turnsAlive = 0;
    this.floatBob = 0;
    this._lastDamaged = 0;

    // ===== 新增系统 =====
    // ElementContainer：数据驱动的属性/技能/法术容器
    this.elements = new ElementContainer();
    // ConditionManager：状态效果管理器
    this.conditions = new ConditionManager();
    // 生存需求系统
    this.hunger = new SurvivalNeed('饥饿', 100, 0.08);   // 饱食度（越高越饱）
    this.sleepiness = new SurvivalNeed('睡眠', 100, 0.05); // 精力（越高越精神）
    this.hygiene = new SurvivalNeed('卫生', 100, 0.02);   // 卫生
    this.sanity = new SurvivalNeed('理智', 100, 0.01);    // 理智
    // 负重系统
    this.burden = 0;        // 当前负重
    this.weightLimit = this.weightLimit || 99;  // 负重上限
    // 装备槽系统（增强版）
    this.bodySlots = this._initBodySlots();
    // 派系
    this.faction = null;
    this.factionRelation = {};  // factionId -> relation value
    // 信仰
    this.faith = null;       // 所信仰的神
    this.piety = 0;          // 虔诚度
    // NPC 属性
    this.isNPC = opts.isNPC || false;
    this.npcType = opts.npcType || null;
    this.npcJob = opts.npcJob || null;
    this.shop = opts.shop || null;
    this.isHealer = opts.isHealer || false;
    // AI 引用
    this._game = null;       // 游戏实例引用（由外部设置）
    this.aiAct = null;       // AI 行为实例
  }

  // 初始化装备槽
  _initBodySlots(){
    return {
      主手: null,    // 主手武器
      副手: null,    // 副手武器/盾牌
      头部: null,
      身体: null,
      披风: null,
      手套: null,
      靴子: null,
      戒指: [null, null],  // 最多2个戒指
      项链: null,
      弹药: null,
    };
  }

  // 获取总负重
  getBurden(){
    let total = 0;
    if(this.inventory){
      for(const item of this.inventory){
        total += (item.weight || 0) * (item._count || 1);
      }
    }
    // 装备负重
    for(const slot in this.equipment){
      const item = this.equipment[slot];
      if(item) total += (item.weight || 0);
    }
    this.burden = total;
    return total;
  }

  // 负重百分比
  getBurdenPercent(){
    return (this.getBurden() / this.weightLimit) * 100;
  }

  // 是否超重
  get isOverburdened(){ return this.getBurden() > this.weightLimit; }

  // 更新生存需求
  updateSurvival(dt){
    this.hunger.update(dt);
    this.sleepiness.update(dt);
    this.hygiene.update(dt);
    this.sanity.update(dt);

    // 饥饿效果
    if(this.hunger.phase >= 4){
      this.hp -= 1 * dt;
      if(this.hp <= 0){ this.hp = 0; this.alive = false; }
    }

    // 睡眠不足效果
    if(this.sleepiness.phase >= 4){
      // 降低属性
    }
  }

  // 从 ElementContainer 读取属性值（兼容旧代码）
  getAttr(name){
    // 先查 ElementContainer
    const eleId = ATTR_NAME_TO_ID[name];
    if(eleId){
      const e = this.elements.get(eleId);
      if(e) return e.Value;
    }
    // 回退到旧的 attrs 系统
    let v = this.attrs[name] || 0;
    // 条件修正
    if(this.conditions){
      v += this.conditions.getAttrMods()[name] || 0;
    }
    // 附魔修正
    if(this.enchBonus && this.enchBonus[name]) v += this.enchBonus[name];
    return v;
  }

  // ---- 重新计算衍生属性（增强版：集成 ElementContainer + ConditionManager）----
  recalcStats(){
    const a = this.attrs;

    // 从 ElementContainer 读取主属性
    const str = this.getAttr('力量');
    const mag = this.getAttr('魔力');
    const wil = this.getAttr('意志');
    const dex = this.getAttr('灵巧');
    const per = this.getAttr('感知');

    // HP = life * (1 + 力量*0.02 + 意志*0.015) * 等级缩放
    this.maxHp = Math.floor(this.life * (1 + str*0.02 + wil*0.015) * (1 + (this.level-1)*0.08));
    // MP = mana * (1 + 魔力*0.03 + 意志*0.01)
    this.maxMp = Math.floor(this.mana * (1 + mag*0.03 + wil*0.01) * (1 + (this.level-1)*0.08));
    // 体力上限
    this.maxStamina = 100 + wil*2 + (this.skills['体力']?this.skills['体力'].level*5:0);

    // DV = 灵巧*0.8 + 感知*0.3 + 种族加成 + 条件修正
    let dv = dex*0.8 + per*0.3 + (this.dvBonus||0);
    let pv = 0;
    // 命中 = 灵巧 + 感知 + 等级 + 武器技能
    this.hit = dex + per + this.level;
    // 暴击 = 感知*0.3 + 幸运*0.1
    this.crit = per*0.3 + (this.luck||0)*0.1;

    // 装备加成
    if(this.equipment){
      for(const slot in this.equipment){
        const item = this.equipment[slot];
        if(!item) continue;
        dv += item.dv || 0;
        pv += item.pv || 0;
        // 武器命中加成
        if(item.hit) this.hit += item.hit;
        // 附魔
        if(item.enchants){
          for(const e of item.enchants){
            if(e.attr === 'dv') dv += e.val;
            if(e.attr === 'pv') pv += e.val;
            if(e.attr === 'crit') this.crit += e.val;
          }
        }
      }
    }

    // 条件修正（新系统）
    if(this.conditions){
      dv += this.conditions.getDVMod();
      pv += this.conditions.getPVMod();
    }

    this.dv = Math.floor(dv);
    this.pv = Math.floor(pv);
    // 附魔属性加成汇总
    this.enchBonus = this.sumEnchants();
    // 速度含附魔 + 条件修正
    let speedMod = 0;
    if(this.conditions) speedMod = this.conditions.getSpeedMod();
    this.speed = (a['速度']||100) + (this.enchBonus['速度']||0) + speedMod;
    // HP/MP 含附魔
    this.maxHp += (this.enchBonus['life']||0);
    this.maxMp += (this.enchBonus['mana']||0);
    // 限幅
    this.hp = Math.min(this.hp, this.maxHp);
    this.mp = Math.min(this.mp, this.maxMp);
    this.stamina = Math.min(this.stamina, this.maxStamina);
  }

  sumEnchants(){
    const b = {};
    if(!this.equipment) return b;
    for(const slot in this.equipment){
      const item = this.equipment[slot];
      if(!item || !item.enchants) continue;
      for(const e of item.enchants){
        if(e.attr){ b[e.attr] = (b[e.attr]||0) + e.val; }
      }
    }
    return b;
  }

  // ---- 元素抗性 ----
  getResist(ele){
    let r = this.resist[ele] || 0;
    if(this.equipment){
      for(const slot in this.equipment){
        const item = this.equipment[slot];
        if(item && item.enchants){
          for(const e of item.enchants){
            if(e.resist === ele) r += e.val;
          }
        }
      }
    }
    return r;
  }

  // ---- 武器伤害骰 ----
  weaponDamage(rng){
    const w = this.equipment['武器'];
    let dice, bonus;
    if(w){
      dice = w.dice; bonus = (w.bonus||0) + (w.qualityBonus||0);
    } else {
      dice = this.dice || '1d3'; bonus = this.bonus || 0;
    }
    let dmg = rollDice(dice, rng) + bonus;
    // 武器品质倍率
    if(w) dmg = Math.floor(dmg * qualityMult(w.quality));
    // 技能加成
    const sk = this.weaponSkill();
    if(sk && this.skills[sk]) dmg += Math.floor(this.skills[sk].level * 0.8);
    // 力量加成（近战）
    if(!w || !w.ranged) dmg += Math.floor(this.getAttr('力量') * 0.3);
    return Math.max(1, dmg);
  }

  weaponSkill(){
    const w = this.equipment['武器'];
    if(!w) return '格斗';
    if(w.id === 'dagger' || w.id === 'short_sword') return '短剑';
    if(w.id === 'sword' || w.id === 'longsword') return '长剑';
    if(w.id === 'bow') return '弓';
    if(w.id === 'pistol') return '枪械';
    if(w.id === 'staff') return '施法';
    return null;
  }

  isRanged(){
    const w = this.equipment['武器'];
    return w && w.ranged;
  }

  hasAmmo(){
    const w = this.equipment['武器'];
    if(!w || !w.ranged) return true;
    if(!w.ammo) return true;
    // 检查背包弹药
    const ammo = this.inventory.find(it=>it.type==='ammo' && it.ammo===w.ammo);
    return !!ammo;
  }

  consumeAmmo(){
    const w = this.equipment['武器'];
    if(!w || !w.ranged || !w.ammo) return;
    let ammo = this.inventory.find(it=>it.type==='ammo' && it.ammo===w.ammo);
    if(!ammo) return;
    ammo._count = (ammo._count||1) - 1;
    if(ammo._count <= 0){
      const idx = this.inventory.indexOf(ammo);
      if(idx>=0) this.inventory.splice(idx,1);
    }
  }

  // ---- 状态效果 ----
  addStatus(id, name, dur, level=1, attr=null, bad=true){
    // 旧系统
    const existing = this.statusEffects.find(s => s.id === id);
    if(existing){
      existing.dur = Math.max(existing.dur, dur);
      existing.level = Math.max(existing.level, level);
    } else {
      this.statusEffects.push({id, name, dur, level, attr, bad});
    }
    // 新系统（同步）
    if(this.conditions){
      const condDef = CONDITIONS[id];
      if(condDef){
        this.conditions.add(condDef, level);
      }
    }
  }
  hasStatus(id){
    // 旧系统
    if(this.statusEffects.some(s => s.id === id)) return true;
    // 新系统
    if(this.conditions && this.conditions.has(id)) return true;
    return false;
  }
  tickStatus(){
    for(let i=this.statusEffects.length-1;i>=0;i--){
      const s = this.statusEffects[i];
      s.dur--;
      if(s.dur<=0) this.statusEffects.splice(i,1);
    }
  }
  getSpeedMod(){
    let mod = 0;
    for(const s of this.statusEffects){
      if(s.id==='slow') mod -= 30*s.level;
      if(s.id==='haste') mod += 30*s.level;
      if(s.id==='frozen') mod -= 200;
    }
    return mod;
  }
  effectiveSpeed(){
    let mod = 0;
    // 旧状态系统兼容
    for(const s of this.statusEffects){
      if(s.id==='slow') mod -= 30*s.level;
      if(s.id==='haste') mod += 30*s.level;
      if(s.id==='frozen') mod -= 200;
    }
    // 新条件系统
    if(this.conditions){
      mod += this.conditions.getSpeedMod();
    }
    return Math.max(10, this.speed + mod);
  }

  // ---- 经验/升级 ----
  gainXP(amount, log){
    this.xp += amount;
    while(this.xp >= this.xpNext){
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.floor(this.xpNext * 1.4 + 10);
      const oldHp = this.maxHp, oldMp = this.maxMp;
      this.recalcStats();
      this.hp += (this.maxHp - oldHp);
      this.mp += (this.maxMp - oldMp);
      this.hp = Math.min(this.hp, this.maxHp);
      this.mp = Math.min(this.mp, this.maxMp);
      if(log) log(`${this.name} 升到了 Lv.${this.level}！`, 'info');
      // 变异者种族特性：随机获得新身体部位
      if(this.isPlayer && this.race==='mutant'){
        // 简化：偶尔加属性
      }
    }
  }

  // ---- 技能成长 ----
  gainSkillXP(skillName, amount){
    if(!this.skills[skillName]) this.skills[skillName] = {level:0, xp:0, potential:50};
    const sk = this.skills[skillName];
    const gain = amount * (sk.potential/100);
    sk.xp += gain;
    const need = (sk.level+1) * 50;
    while(sk.xp >= need){
      sk.xp -= need;
      sk.level++;
      if(this.isPlayer) sk.potential = Math.max(10, sk.potential-2);
      if(skillName==='体力' || skillName==='灵巧' || skillName==='感知'){
        this.recalcStats();
      }
    }
  }

  // ---- 距离 ----
  distTo(x,y){ return Math.sqrt((this.x-x)**2 + (this.y-y)**2); }
}

// ---- 装备 ----
export function equip(entity, item){
  if(item.type !== 'weapon' && item.type !== 'armor') return false;
  const slot = item.slot || (item.type==='weapon'?'武器':null);
  if(!slot) return false;
  // 重量限制（妖精）
  if(entity.weightLimit && item.weight > entity.weightLimit) return false;
  // 从背包移除
  const idx = entity.inventory.indexOf(item);
  if(idx>=0) entity.inventory.splice(idx,1);
  // 卸下旧装备
  if(entity.equipment[slot]){
    entity.inventory.push(entity.equipment[slot]);
  }
  entity.equipment[slot] = item;
  entity.recalcStats();
  return true;
}

export function unequip(entity, slot){
  const item = entity.equipment[slot];
  if(!item) return null;
  entity.equipment[slot] = null;
  entity.inventory.push(item);
  entity.recalcStats();
  return item;
}

