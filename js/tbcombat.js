// ===== 回合制战斗系统（博德之门3风格）=====
// 实时探索 ↔ 回合制战斗 无缝切换
// 先攻骰 + 行动点(动作/附赠动作/移动) + 回合队列

// ---------- 行动点常量 ----------
export const AP_ACTION = 1;       // 主动作：攻击/施法/冲刺
export const AP_BONUS = 1;        // 附赠动作：小技能/快速物品
export const AP_REACTION = 1;     // 反应动作（本回合可用1次）

// ---------- 计算移动范围（格子数） ----------
export function getMoveRange(entity){
  const spd = entity._effSpeed ? entity._effSpeed() : (entity.effectiveSpeed ? entity.effectiveSpeed() : (entity.speed || 100));
  return Math.max(2, Math.floor(spd / 20));
}

// ---------- 骰先攻 ----------
export function rollInitiative(entity, rng){
  const speed = entity._effSpeed ? entity._effSpeed() : (entity.effectiveSpeed ? entity.effectiveSpeed() : (entity.speed || 100));
  const perception = entity.getAttr ? entity.getAttr('感知') : (entity.attrs?.['感知'] || 10);
  const dex = entity.getAttr ? entity.getAttr('灵巧') : (entity.attrs?.['灵巧'] || 10);
  // 先攻 = d20 + 速度/10 + 感知/2 + 灵巧/2
  const roll = rng.int(1, 20);
  const bonus = Math.floor(speed / 10) + Math.floor(perception / 2) + Math.floor(dex / 2);
  return roll + bonus;
}

// ---------- 回合制战斗管理器 ----------
export class TBCombat{
  constructor(){
    this.active = false;          // 是否处于回合制模式
    this.queue = [];              // 先攻队列 [{entity, initiative}]
    this.currentIdx = 0;          // 当前行动者索引
    this.round = 0;               // 回合数
    this.currentActor = null;     // 当前行动实体
    this.onTurnStart = null;      // 回合开始回调
    this.onTurnEnd = null;        // 回合结束回调
    this.onCombatEnd = null;      // 战斗结束回调
  }

  // 进入回合制战斗
  enter(combatants, rng){
    this.active = true;
    this.round = 1;
    this.currentIdx = 0;

    // 骰先攻
    this.queue = combatants
      .filter(e => e.alive)
      .map(e => ({
        entity: e,
        initiative: rollInitiative(e, rng),
      }))
      .sort((a, b) => b.initiative - a.initiative);

    if(this.queue.length === 0){
      this.active = false;
      return false;
    }

    this.currentActor = this.queue[0].entity;
    this._startTurn();
    return true;
  }

  // 退出回合制
  exit(){
    this.active = false;
    this.queue = [];
    this.currentIdx = 0;
    this.currentActor = null;
    this.round = 0;
    if(this.onCombatEnd) this.onCombatEnd();
  }

  // 回合开始：重置行动点
  _startTurn(){
    const e = this.currentActor;
    if(!e || !e.alive){
      this.nextTurn();
      return;
    }
    // 重置行动点
    e._tbAction = AP_ACTION;
    e._tbBonus = AP_BONUS;
    e._tbReaction = AP_REACTION;
    e._tbMoved = 0;              // 本回合已移动距离
    e._tbMoveRange = getMoveRange(e);
    e._tbDone = false;
    if(this.onTurnStart) this.onTurnStart(e);
  }

  // 结束当前回合，推进到下一个
  nextTurn(){
    if(this.onTurnEnd) this.onTurnEnd(this.currentActor);

    // 清理当前
    if(this.currentActor){
      this.currentActor._tbDone = true;
    }

    // 检查存活的战斗者
    this.queue = this.queue.filter(item => item.entity.alive);

    // 检查是否还有敌方战斗者
    const hasEnemy = this.queue.some(item => !item.entity.isPlayer);
    if(this.queue.length === 0 || !hasEnemy){
      // 没有敌方战斗者了，战斗结束
      this.exit();
      return;
    }

    // 推进索引，跳过已死亡的
    do {
      this.currentIdx = (this.currentIdx + 1) % this.queue.length;
      if(this.currentIdx === 0) this.round++;
    } while(!this.queue[this.currentIdx].entity.alive);

    this.currentActor = this.queue[this.currentIdx].entity;
    this._startTurn();
  }

  // 检查是否是某实体的回合
  isMyTurn(entity){
    return this.active && this.currentActor === entity;
  }

  // 获取回合顺序（用于UI显示）
  getTurnOrder(){
    return this.queue.map((item, i) => ({
      entity: item.entity,
      initiative: item.initiative,
      isCurrent: i === this.currentIdx,
    }));
  }

  // 检查实体是否在战斗中
  inCombat(entity){
    return this.queue.some(item => item.entity === entity);
  }

  // 添加新参战者
  addCombatant(entity, rng){
    if(this.inCombat(entity)) return;
    this.queue.push({
      entity,
      initiative: rollInitiative(entity, rng),
    });
    this.queue.sort((a, b) => b.initiative - a.initiative);
    // 调整 currentIdx 指向当前行动者
    this.currentIdx = this.queue.findIndex(item => item.entity === this.currentActor);
    if(this.currentIdx < 0) this.currentIdx = 0;
  }
}
