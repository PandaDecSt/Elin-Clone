// ===== 回合调度器（基于 Speed 的能量点制行动队列）=====
// 正确实现：仅当无人可行动时才推进时间（给所有人加能量），
// 已就绪的实体立即行动，不额外给他人加能量。

export const ACTION_THRESHOLD = 100;

export class Scheduler{
  constructor(){
    this.entities = [];
    this.current = null;
    this.turnCount = 0;
  }
  add(e){ this.entities.push(e); }
  remove(e){
    const i = this.entities.indexOf(e);
    if(i>=0) this.entities.splice(i,1);
    if(this.current === e) this.current = null;
  }
  clear(){ this.entities = []; this.current = null; this.turnCount = 0; }

  // 获取下一个可行动的实体
  next(){
    this.entities = this.entities.filter(e=>e.alive);
    if(this.entities.length === 0) return null;

    // 检查是否有已就绪的实体（能量 >= 阈值）
    let ready = this.entities.filter(e=>(e._energy||0) >= ACTION_THRESHOLD);

    // 无人就绪：推进时间，给所有人加能量，直到有人就绪
    let safety = 0;
    while(ready.length === 0 && safety < 2000){
      safety++;
      for(const e of this.entities){
        const spd = e.effectiveSpeed ? e.effectiveSpeed() : e.speed;
        e._energy = (e._energy||0) + spd;
      }
      ready = this.entities.filter(e=>(e._energy||0) >= ACTION_THRESHOLD);
    }
    if(ready.length === 0) return null;

    // 在就绪者中选能量最高的（最"亏欠"回合的实体优先）
    ready.sort((a,b)=>(b._energy||0)-(a._energy||0));
    const actor = ready[0];
    actor._energy -= ACTION_THRESHOLD;
    this.current = actor;
    this.turnCount++;
    return actor;
  }

  isPlayerTurn(){ return this.current && this.current.isPlayer; }
}
