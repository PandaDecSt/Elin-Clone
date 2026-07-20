// ===== ElementContainer 系统：数据驱动的属性/技能/法术容器 =====
// 移植自原版 Elin 的 Element + ElementContainer 体系
// 每个实体拥有一个 ElementContainer，存储所有属性、技能、法术的数值

// ---------- 元素ID定义（与原版对齐）----------
export const ELE_ID = {
  // 主属性
  STR: 70, CON: 72, DEX: 71, PER: 77, MAG: 74, WIL: 75, LER: 76, LIT: 73, CHA: 79,
  // 身体属性
  Body_STR: 70, Body_CON: 72, Body_DEX: 71, Body_PER: 77,
  // 精神属性
  Mind_MAG: 74, Mind_WIL: 75, Mind_LER: 76, Mind_LIT: 73,
  // 战斗技能
  MartialArts: 100, ShortSword: 101, LongSword: 102, Axe: 103, Blunt: 104,
  Polearm: 105, Bow: 106, Firearm: 107, Throwing: 108, Tactics: 132,
  Marksman: 133, TwoHand: 134, DualWield: 135, Shield: 136,
  // 魔法技能
  Casting: 150, Meditation: 151, MagicControl: 152, MagicDevice: 153,
  ElementalFire: 160, ElementalIce: 161, ElementalLightning: 162,
  // 生活技能
  Fishing: 200, Cooking: 201, Gathering: 202, Farming: 203,
  Taming: 204, Mining: 205, Lumberjack: 206, Alchemy: 207,
  // 社交技能
  Pickpocket: 250, Investing: 251, Perfomance: 252, Anatomy: 253,
  // 生存技能
  Travel: 300, Pathfinder: 301, Anatomy2: 302,
  // 战斗属性
  DV: 400, PV: 401, HIT: 402, DMG: 403, CRIT: 404, Speed: 405,
  // 元素抗性
  ResistFire: 500, ResistIce: 501, ResistLightning: 502,
  ResistDark: 503, ResistNature: 504,
  // 特殊
  Food: 600, Sleep: 601, Hygiene: 602, Burden: 603, Mana: 604,
  Stamina: 605, SpeedAlt: 606,
};

// ---------- 中文名映射 ----------
export const ELE_NAMES = {};
for(const [k,v] of Object.entries(ELE_ID)){
  ELE_NAMES[v] = k;
}

// ---------- 单个元素 ----------
export class Element {
  constructor(id, source){
    this.id = id;                    // 数字ID
    this.source = source || {};      // 源数据 { name, desc, icon, ... }
    this.vBase = 0;                  // 基础值
    this.vExp = 0;                   // 经验值
    this.vPotential = 100;           // 学习潜力 (影响经验获取)
    this.vTempPotential = 0;         // 临时潜力修正
    this.vLink = 0;                  // 父容器链接值
    this.vSource = 0;                // 源提供值
    this.vSourcePotential = 0;       // 源提供潜力
    this.owner = null;               // 所属 ElementContainer
    this.dirty = true;               // 缓存失效标记
    this._cachedValue = 0;           // 缓存值
  }

  // 有效值 = 基础值 + 源值 + 链接值 + 容器修正
  get Value(){
    if(this.dirty){
      this._cachedValue = this.vBase + this.vSource + this.vLink;
      if(this.owner) this._cachedValue += this.owner.getValueBonus(this);
      this.dirty = false;
    }
    return this._cachedValue;
  }

  // 无链接值
  get ValueWithoutLink(){ return this.vBase + this.vSource; }

  // 有效潜力
  get Potential(){
    return Math.max(1, this.vPotential + this.vTempPotential + this.vSourcePotential + this.getMinPotential());
  }

  // 最低潜力
  getMinPotential(){ return this.source.minPotential || 0; }

  // 升级所需经验
  get ExpToNext(){ return 1000; }

  // 训练费用
  get CostTrain(){
    return Math.max(1, Math.floor((this.ValueWithoutLink/10 + 5) * (100 + this.vTempPotential) / 500));
  }

  // 是否为主属性
  get IsMainAttribute(){ return this.id >= 70 && this.id <= 79; }

  // 是否为战斗技能
  get IsCombatSkill(){ return this.id >= 100 && this.id <= 136; }

  // 是否为魔法技能
  get IsMagicSkill(){ return this.id >= 150 && this.id <= 162; }

  // 是否为生活技能
  get IsLifeSkill(){ return this.id >= 200 && this.id <= 207; }

  markDirty(){
    this.dirty = true;
    if(this.owner) this.owner.markAllDirty();
  }

  // 增加经验
  gainExp(amount){
    const potentialMod = this.Potential / 100;
    const gain = amount * potentialMod;
    this.vExp += gain;
    while(this.vExp >= this.ExpToNext){
      this.vExp -= this.ExpToNext;
      this.vBase++;
      this.markDirty();
    }
  }

  // 序列化
  serialize(){
    return { id:this.id, vBase:this.vBase, vExp:this.vExp,
             vPotential:this.vPotential, vTempPotential:this.vTempPotential };
  }

  // 反序列化
  static deserialize(data){
    const e = new Element(data.id);
    e.vBase = data.vBase || 0;
    e.vExp = data.vExp || 0;
    e.vPotential = data.vPotential || 100;
    e.vTempPotential = data.vTempPotential || 0;
    return e;
  }
}

// ---------- ElementContainer ----------
export class ElementContainer {
  constructor(){
    this.dict = {};           // id -> Element
    this.parent = null;       // 父容器（用于链接值传播）
    this._allDirty = true;    // 所有元素缓存失效
  }

  // 获取或创建元素
  getOrCreate(id, source){
    if(!this.dict[id]){
      this.dict[id] = new Element(id, source);
      this.dict[id].owner = this;
    }
    return this.dict[id];
  }

  // 获取元素（不存在返回 null）
  get(id){ return this.dict[id] || null; }

  // 获取值（不存在返回 0）
  value(id){ return this.dict[id] ? this.dict[id].Value : 0; }

  // 设置基础值
  setBase(id, val){
    const e = this.getOrCreate(id);
    e.vBase = val;
    e.markDirty();
  }

  // 增加基础值
  addBase(id, val){
    const e = this.getOrCreate(id);
    e.vBase += val;
    e.markDirty();
  }

  // 设置链接值
  setLink(id, val){
    const e = this.dict[id];
    if(e){
      e.vLink = val;
      e.markDirty();
    }
  }

  // 获取子元素的值总和
  getValueBonus(element){
    // 从链接的子容器获取值
    if(this.parent){
      return this.parent.getChildBonus(element.id);
    }
    return 0;
  }

  // 获取子元素对父元素的贡献值
  getChildBonus(childId){
    // 子元素的值作为父元素的修正
    return this.value(childId);
  }

  // 标记所有元素为脏
  markAllDirty(){
    this._allDirty = true;
    for(const e of Object.values(this.dict)){
      e.dirty = true;
    }
  }

  // 设置父容器（管理链接）
  setParent(parent){
    if(this.parent){
      // 解除旧链接
      for(const e of Object.values(this.dict)){
        this.parent.unlinkElement(e);
      }
    }
    this.parent = parent;
    if(parent){
      // 建立新链接
      for(const e of Object.values(this.dict)){
        parent.linkElement(e);
      }
    }
  }

  // 链接元素到父容器
  linkElement(child){
    // 子元素的值链接到父容器
    child.vLink = this.value(child.id);
  }

  // 解除链接
  unlinkElement(child){
    child.vLink = 0;
  }

  // 获取指定过滤条件的元素列表
  listElements(filter, sort){
    let list = Object.values(this.dict);
    if(filter) list = list.filter(filter);
    if(sort) list.sort(sort);
    return list;
  }

  // 获取所有主属性的总和
  sumMainAttributes(){
    let sum = 0;
    for(const [name, id] of Object.entries(ELE_ID)){
      if(id >= 70 && id <= 79){
        sum += this.value(id);
      }
    }
    return sum;
  }

  // 获取所有战斗技能的总等级
  sumCombatSkills(){
    let sum = 0;
    for(const [name, id] of Object.entries(ELE_ID)){
      if(id >= 100 && id <= 136){
        sum += this.value(id);
      }
    }
    return sum;
  }

  // 序列化
  serialize(){
    const data = {};
    for(const [id, e] of Object.entries(this.dict)){
      data[id] = e.serialize();
    }
    return data;
  }

  // 反序列化
  static deserialize(data){
    const c = new ElementContainer();
    if(data){
      for(const [id, edata] of Object.entries(data)){
        c.dict[id] = Element.deserialize(edata);
        c.dict[id].owner = c;
      }
    }
    return c;
  }
}

// ---------- 工具函数：曲线函数（与原版对齐）----------
// 递减收益曲线：超过start后，每step增加rate%的递减
export function curve(value, start, step, rate){
  if(value <= start) return value;
  let result = start;
  let remaining = value - start;
  let currentStep = step;
  while(remaining > 0){
    const consumed = Math.min(remaining, currentStep);
    result += consumed * (1 - (rate/100));
    remaining -= consumed;
    currentStep = Math.floor(currentStep * (1 - rate/100));
    if(currentStep < 1) currentStep = 1;
  }
  return Math.floor(result);
}

// 简化曲线：用于命中/闪避等
export function curveSimple(value, center, minRate, maxRate){
  // value < center: 以 minRate 增长
  // value > center: 以 maxRate 衰减
  if(value <= center){
    return value * minRate / 100;
  } else {
    return center * minRate / 100 + (value - center) * maxRate / 100;
  }
}

// ---------- 中文属性名 -> Element ID 映射 ----------
export const ATTR_NAME_TO_ID = {
  '力量': ELE_ID.STR,
  '魔力': ELE_ID.MAG,
  '意志': ELE_ID.WIL,
  '灵巧': ELE_ID.DEX,
  '感知': ELE_ID.PER,
  '学习': ELE_ID.LER,
  '魅力': ELE_ID.CHA,
  '速度': ELE_ID.Speed,
};

// ---------- 技能名 -> Element ID 映射 ----------
export const SKILL_NAME_TO_ID = {
  '长剑': ELE_ID.LongSword,
  '短剑': ELE_ID.ShortSword,
  '弓': ELE_ID.Bow,
  '枪械': ELE_ID.Firearm,
  '格斗': ELE_ID.MartialArts,
  '战术': ELE_ID.Tactics,
  '双刀流': ELE_ID.DualWield,
  '施法': ELE_ID.Casting,
  '冥想': ELE_ID.Meditation,
  '魔力控制': ELE_ID.MagicControl,
  '种植': ELE_ID.Farming,
  '烹饪': ELE_ID.Cooking,
  '采集': ELE_ID.Gathering,
  '开锁': ELE_ID.Pickpocket,
  '偷窃': ELE_ID.Pickpocket,
  '旅行': ELE_ID.Travel,
  '寻路': ELE_ID.Pathfinder,
  '体力': ELE_ID.Stamina,
  '灵巧_': ELE_ID.DEX,
  '感知_': ELE_ID.PER,
};
