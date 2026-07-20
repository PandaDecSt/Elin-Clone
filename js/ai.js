// ===== AI 系统：AIAct 基类 + AI_Idle 决策树 + AIWork + AI_Goto + AI_Eat 等 =====
// 移植自原版 Elin 的 AIAct 协程式行为树体系
// 使用 JavaScript generator 模拟 C# IEnumerator<Status>

import { findPath } from './pathfind.js?v=2';
import { attack } from './combat.js';

// ---------- AI 状态枚举 ----------
export const AIStatus = {
  Running: 0,
  Fail: 1,
  Success: 2,
};

// ---------- AIAct 基类 ----------
export class AIAct {
  constructor(owner){
    this.owner = owner;          // 执行此AI的角色
    this.status = AIStatus.Running;
    this.child = null;           // 子AI行为
    this.parent = null;          // 父AI行为
    this.generator = null;       // 协程生成器
    this.restartCount = 0;       // 重启次数
    this.isFail = null;          // 外部失败条件
    this.onChildFail = null;     // 子行为失败回调

    // 虚拟属性（子类可覆盖）
    this.IsIdle = false;
    this.IsAutoTurn = false;
    this.IsNoGoal = false;
    this.CancelOnAggro = true;
    this.CancelWhenDamaged = true;
    this.CancelWhenMoved = false;
    this.MaxRestart = 5;
    this.MaxProgress = 20;
    this.ShowProgress = true;
    this.UseTurbo = true;
    this.PushChara = true;
    this.InformCancel = true;
  }

  get IsRunning(){ return this.status === AIStatus.Running; }
  get IsChildRunning(){ return this.child && this.child.IsRunning; }
  get IsFail(){ return this.status === AIStatus.Fail; }
  get IsSuccess(){ return this.status === AIStatus.Success; }

  // --- 核心执行循环 ---
  tick(game){
    // 外部失败条件检查
    if(this.isFail && this.isFail()){
      return this.cancel();
    }

    // 子行为正在运行
    if(this.IsChildRunning){
      const childResult = this.child.tick(game);
      if(childResult === AIStatus.Fail){
        return this.onChildFail ? this.onChildFail() : this.cancel();
      }
      if(childResult === AIStatus.Running){
        return AIStatus.Running;
      }
      // 子行为成功，继续执行
      if(this.isFail && this.isFail()){
        return this.cancel();
      }
    }

    // 启动协程（如果还没启动）
    if(!this.generator){
      this.start();
      if(this.status !== AIStatus.Running) return this.status;
    }

    // 推进协程
    const result = this.generator.next();
    if(result.done){
      return this.status;
    }

    return this.status;
  }

  // --- 启动 ---
  start(){
    this.status = AIStatus.Running;
    this.generator = this.run();
  }

  // --- 子类必须实现的协程 ---
  *run(){
    yield AIStatus.Success;
  }

  // --- 设置子行为 ---
  setChild(act){
    if(this.child && this.child.IsRunning){
      this.child.cancel();
    }
    this.child = act;
    if(act) act.parent = this;
    return this;
  }

  // --- 执行子行为并等待完成 ---
  *do(act){
    this.setChild(act);
    while(this.child.IsRunning){
      yield AIStatus.Running;
    }
    return this.child.status;
  }

  // --- 创建并执行 Goto ---
  *doGoto(x, y, game, dist = 1){
    const act = new AI_Goto(this.owner, x, y, dist);
    yield* this.do(act);
    return act.status;
  }

  // --- 创建并执行 Idle ---
  *doIdle(count = 1){
    const act = new AI_Idle(this.owner, count);
    yield* this.do(act);
    return act.status;
  }

  // --- 创建并执行 Wait ---
  *doWait(ticks = 1){
    const act = new AI_Wait(this.owner, ticks);
    yield* this.do(act);
    return act.status;
  }

  // --- 创建并执行 Progress ---
  *doProgress(text, maxProgress, callbacks = {}){
    const act = new AI_Progress(this.owner, text, maxProgress, callbacks);
    yield* this.do(act);
    return act.status;
  }

  // --- 取消 ---
  cancel(){
    if(this.child && this.child.IsRunning){
      this.child.cancel();
    }
    this.status = AIStatus.Fail;
    this.cleanup();
    return AIStatus.Fail;
  }

  // --- 成功 ---
  success(){
    if(this.child && this.child.IsRunning){
      this.child.cancel();
    }
    this.status = AIStatus.Success;
    this.cleanup();
    return AIStatus.Success;
  }

  // --- 重启（重新开始）---
  restart(){
    this.restartCount++;
    if(this.restartCount >= this.MaxRestart){
      return this.success();
    }
    this.generator = null;
    this.child = null;
    return AIStatus.Running;
  }

  // --- 清理 ---
  cleanup(){
    this.generator = null;
  }

  // --- 重置 ---
  reset(){
    this.generator = null;
    this.child = null;
    this.status = AIStatus.Running;
    this.restartCount = 0;
  }
}

// ---------- AI_Idle：NPC 决策大脑 ----------
export class AI_Idle extends AIAct {
  constructor(owner, maxRepeat = 10){
    super(owner);
    this.maxRepeat = maxRepeat;
    this.moveFailCount = 0;
    this.IsIdle = true;
  }

  *run(){
    const e = this.owner;
    const game = e._game;
    if(!game){ yield AIStatus.Success; return; }

    for(let repeat = 0; repeat < this.maxRepeat; repeat++){
      // === 决策优先级（从高到低）===

      // 1. 检查是否需要进食
      if(e.hunger && e.hunger.phase >= 3){
        const eatAct = new AI_Eat(this.owner);
        yield* this.do(eatAct);
        if(this.child && this.child.IsSuccess) continue;
      }

      // 2. 检查是否需要睡觉
      if(e.sleepiness && e.sleepiness.phase >= 4){
        const sleepAct = new AI_Sleep(this.owner);
        yield* this.do(sleepAct);
        if(this.child && this.child.IsSuccess) continue;
      }

      // 3. 检查是否需要治疗附近友方
      if(e.isHealer && e.mp > 10){
        const healAct = this._tryHealAlly(game);
        if(healAct){
          yield* this.do(healAct);
          if(this.child && this.child.IsSuccess) continue;
        }
      }

      // 4. 卫兵：巡逻和战斗
      if(e.npcJob === 'guard'){
        const guardAct = this._guardBehavior(game);
        if(guardAct){
          yield* this.do(guardAct);
          continue;
        }
      }

      // 5. 商人：补充库存
      if(e.npcType === 'merchant' && e.shop){
        // 商人偶尔移动到柜台
      }

      // 6. 随机闲逛（在家中/城镇内）
      if(game.map && game.map.isTown){
        const wanderAct = this._randomWander(game);
        if(wanderAct){
          yield* this.do(wanderAct);
          continue;
        }
      }

      // 7. 原地等待
      yield* this.doWait(this.owner.rng ? this.owner.rng.int(3, 8) : 5);
    }

    yield AIStatus.Success;
  }

  _tryHealAlly(game){
    // 寻找附近需要治疗的友方
    if(!this.owner.isNPC) return null;
    for(const e of game.map.entities){
      if(e === this.owner || !e.alive || e.isPlayer) continue;
      if(e.faction !== this.owner.faction) continue;
      if(e.hp < e.maxHp * 0.5){
        return new AI_HealAlly(this.owner, e);
      }
    }
    return null;
  }

  _guardBehavior(game){
    // 卫兵：检测威胁并追击
    const e = this.owner;
    let threat = null, minDist = 8;
    for(const m of game.map.entities){
      if(!m.alive || m.isPlayer || m.isNPC) continue;
      if(m.faction === e.faction) continue;
      const d = Math.abs(m.px - e.px) + Math.abs(m.py - e.py);
      if(d < minDist){ minDist = d; threat = m; }
    }
    if(threat){
      return new AI_Chase(this.owner, threat);
    }
    // 无威胁时巡逻
    return this._patrol(game);
  }

  _patrol(game){
    const e = this.owner;
    const tx = e.x + (e.rng ? e.rng.int(-5, 5) : Math.floor(Math.random()*10-5));
    const ty = e.y + (e.rng ? e.rng.int(-5, 5) : Math.floor(Math.random()*10-5));
    if(game.map && game.map.isWalkable(tx, ty)){
      return new AI_Goto(this.owner, tx, ty);
    }
    return null;
  }

  _randomWander(game){
    const e = this.owner;
    if(e.aiThinkCD > 0) return null;
    e.aiThinkCD = 3 + Math.random() * 5;
    return this._patrol(game);
  }
}

// ---------- AI_Goto：移动/寻路 ----------
export class AI_Goto extends AIAct {
  constructor(owner, targetX, targetY, dist = 1){
    super(owner);
    this.targetX = targetX;
    this.targetY = targetY;
    this.dist = dist;
    this.path = null;
    this.pathIdx = 0;
    this.waitCount = 0;
  }

  *run(){
    const e = this.owner;
    const game = e._game;
    if(!game){ yield AIStatus.Fail; return; }

    // 已经在目标附近
    const dx = Math.abs(e.x - this.targetX);
    const dy = Math.abs(e.y - this.targetY);
    if(dx + dy <= this.dist){
      yield AIStatus.Success;
      return;
    }

    // 寻路
    if(!this.path){
      this.path = findPath(game.map, e.x, e.y, this.targetX, this.targetY);
      this.pathIdx = 0;
      if(!this.path || this.path.length === 0){
        yield AIStatus.Fail;
        return;
      }
      // 去掉起点
      this.path.shift();
    }

    // 沿路径移动
    while(this.pathIdx < this.path.length){
      const node = this.path[this.pathIdx];
      const mdx = node.x - e.x;
      const mdy = node.y - e.y;

      if(Math.abs(mdx) + Math.abs(mdy) <= 1){
        // 可以移动到下一个节点
        if(game.map.isWalkable(node.x, node.y)){
          e.x = node.x;
          e.y = node.y;
          e.px = node.x;
          e.py = node.y;
          this.pathIdx++;
          this.waitCount = 0;
        } else {
          // 被阻挡
          this.waitCount++;
          if(this.waitCount > 3){
            yield AIStatus.Fail;
            return;
          }
        }
      } else {
        // 需要等待
        this.waitCount++;
        if(this.waitCount > 5){
          yield AIStatus.Fail;
          return;
        }
      }

      yield AIStatus.Running;
    }

    yield AIStatus.Success;
  }
}

// ---------- AI_Wait：等待 ----------
export class AI_Wait extends AIAct {
  constructor(owner, ticks = 1){
    super(owner);
    this.ticks = ticks;
    this.elapsed = 0;
  }

  *run(){
    while(this.elapsed < this.ticks){
      this.elapsed++;
      yield AIStatus.Running;
    }
    yield AIStatus.Success;
  }
}

// ---------- AI_Progress：进度条行为 ----------
export class AI_Progress extends AIAct {
  constructor(owner, text = '', maxProgress = 20, callbacks = {}){
    super(owner);
    this.text = text;
    this.progress = 0;
    this.maxProgress = maxProgress;
    this.interval = callbacks.interval || 2;
    this.canProgress = callbacks.canProgress || (() => true);
    this.onProgressBegin = callbacks.onProgressBegin || (() => {});
    this.onProgress = callbacks.onProgress || (() => {});
    this.onProgressComplete = callbacks.onProgressComplete || (() => {});
    this.IsAutoTurn = true;
  }

  *run(){
    while(true){
      if(!this.canProgress()){
        yield AIStatus.Fail;
        return;
      }

      if(this.progress === 0){
        this.onProgressBegin();
      }

      if(this.progress % this.interval === 0){
        this.onProgress(this);
      }

      this.progress++;

      if(this.progress >= this.maxProgress){
        this.onProgressComplete();
        yield AIStatus.Success;
        return;
      }

      yield AIStatus.Running;
    }
  }
}

// ---------- AI_Eat：进食行为 ----------
export class AI_Eat extends AIAct {
  constructor(owner, target = null){
    super(owner);
    this.target = target;  // 目标食物
  }

  *run(){
    const e = this.owner;
    const game = e._game;
    if(!game || !e.hunger){
      yield AIStatus.Fail;
      return;
    }

    // 1. 如果没有目标食物，从背包找
    if(!this.target){
      this.target = this._findFood(e);
      if(!this.target){
        // 尝试从地上捡
        this.target = this._findFoodOnGround(e, game);
      }
      if(!this.target){
        yield AIStatus.Fail;
        return;
      }
    }

    // 2. 前往食物位置（如果不在同一格）
    if(this.target.x !== undefined && (this.target.x !== e.x || this.target.y !== e.y)){
      yield* this.doGoto(this.target.x, this.target.y, game);
    }

    // 3. 进食进度
    yield* this.doProgress('进食中...', 5, {
      onProgressComplete: () => {
        // 消耗食物，恢复饱腹度
        if(this.target && this.target.food){
          e.hunger.value = Math.min(e.hunger.max, e.hunger.value + this.target.food);
        }
        // 从背包移除
        if(this.target && e.inventory){
          const idx = e.inventory.indexOf(this.target);
          if(idx >= 0) e.inventory.splice(idx, 1);
        }
        this.target = null;
      }
    });
  }

  _findFood(e){
    if(!e.inventory) return null;
    for(const item of e.inventory){
      if(item.type === 'food' || item.type === 'potion'){
        return item;
      }
    }
    return null;
  }

  _findFoodOnGround(e, game){
    // 简化：检查当前格的物品
    if(game.map && game.map.items){
      for(const item of game.map.items){
        if(item.type === 'food'){
          return item;
        }
      }
    }
    return null;
  }
}

// ---------- AI_Sleep：睡觉 ----------
export class AI_Sleep extends AIAct {
  constructor(owner){
    super(owner);
  }

  *run(){
    const e = this.owner;
    if(!e.sleepiness){
      yield AIStatus.Fail;
      return;
    }

    // 睡觉进度
    yield* this.doProgress('睡眠中...', 10, {
      onProgressComplete: () => {
        e.sleepiness.value = 0;
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.5);
        e.mp = Math.min(e.maxMp, e.mp + e.maxMp * 0.3);
      }
    });
  }
}

// ---------- AI_HealAlly：治疗友方 ----------
export class AI_HealAlly extends AIAct {
  constructor(owner, target){
    super(owner);
    this.target = target;
  }

  *run(){
    const e = this.owner;
    // 前往目标
    yield* this.doGoto(this.target.x, this.target.y, e._game);
    // 施放治疗
    if(this.target.hp < this.target.maxHp * 0.8 && e.mp > 10){
      const heal = 10 + Math.floor((e.getAttr ? e.getAttr('魔力') : 0) * 0.5);
      this.target.hp = Math.min(this.target.maxHp, this.target.hp + heal);
      e.mp -= 5;
    }
    yield AIStatus.Success;
  }
}

// ---------- AI_Chase：追击敌人 ----------
export class AI_Chase extends AIAct {
  constructor(owner, target){
    super(owner);
    this.target = target;
    this.attackCD = 0;
  }

  *run(){
    const e = this.owner;
    const game = e._game;
    if(!game || !this.target || !this.target.alive){
      yield AIStatus.Fail;
      return;
    }

    const dx = this.target.x - e.x;
    const dy = this.target.y - e.y;
    const dist = Math.abs(dx) + Math.abs(dy);

    // 在攻击范围内
    if(dist <= 1){
      if(this.attackCD <= 0){
        // 攻击
        attack(e, this.target, e.rng || game.rng, (t, ty) => game.log && game.log(t, ty));
        this.attackCD = 2;
      } else {
        this.attackCD--;
      }
      yield AIStatus.Running;
      return;
    }

    // 追击
    yield* this.doGoto(this.target.x, this.target.y, game);
    yield AIStatus.Running;
  }
}

// ---------- AIWork：工作行为基类 ----------
export class AIWork extends AIAct {
  constructor(owner){
    super(owner);
    this.destX = 0;
    this.destY = 0;
    this.destThing = null;
  }

  *run(){
    const e = this.owner;
    const game = e._game;
    if(!game){ yield AIStatus.Fail; return; }

    // 空闲等待
    yield* this.doIdle(5);

    // 找到工作目标
    const workTarget = this.findWorkTarget(game);
    if(!workTarget){
      yield* this.doIdle(10);
      yield AIStatus.Running;
      return;
    }

    // 前往工作位置
    if(workTarget.x !== e.x || workTarget.y !== e.y){
      yield* this.doGoto(workTarget.x, workTarget.y, game);
    }

    // 执行工作
    yield* this.doProgress(this.getWorkText(), this.getWorkDuration(), {
      onProgressComplete: () => this.onWorkComplete(game, workTarget),
    });

    yield AIStatus.Running;  // 继续循环工作
  }

  findWorkTarget(game){ return null; }
  getWorkText(){ return '工作中...'; }
  getWorkDuration(){ return 10; }
  onWorkComplete(game, target){}
}

// ---------- AIWork_Farm：耕种 ----------
export class AIWork_Farm extends AIWork {
  findWorkTarget(game){
    // 找到农田
    if(game.map && game.map.farmSpots){
      return game.map.farmSpots[0] || null;
    }
    return null;
  }
  getWorkText(){ return '耕种中...'; }
  getWorkDuration(){ return 15; }
  onWorkComplete(game, target){
    // 种植/收获逻辑
  }
}

// ---------- AIWork_Fish：钓鱼 ----------
export class AIWork_Fish extends AIWork {
  findWorkTarget(game){
    // 找到水域旁边
    if(game.map){
      for(let y = 0; y < game.map.h; y++){
        for(let x = 0; x < game.map.w; x++){
          if(game.map.tileId(x,y) === 'water' || game.map.tileId(x,y) === 'water_deep'){
            // 找水边的可走位置
            for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){
              if(game.map.isWalkable(x+dx, y+dy)){
                return {x: x+dx, y: y+dy};
              }
            }
          }
        }
      }
    }
    return null;
  }
  getWorkText(){ return '钓鱼中...'; }
  getWorkDuration(){ return 20; }
  onWorkComplete(game, target){
    // 钓鱼结果
    if(game.rng && game.rng.chance(0.4)){
      // 钓到鱼
    }
  }
}
