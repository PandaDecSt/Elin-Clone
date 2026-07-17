// ===== NPC 行为系统：老滚5风格的 Radiant AI =====
// 包含：NPC定义、AI行为包、日程表、社交系统

import { rollDice } from './rng.js';

// ---------- NPC 类型定义 ----------
export const NPC_TYPES = {
  merchant: {
    id: 'merchant', name: '商人', icon: '🧑‍💼', color: '#d4a84a',
    sprite: 'goblin', // 复用精灵图
    hp: 30, speed: 90,
    job: 'trade', faction: 'town',
    dialogue: [
      '欢迎光临！看看有什么需要的吗？',
      '最近生意不太好啊...地下城的怪物越来越多了。',
      '这些可都是好货，童叟无欺！',
      '你要是有多余的白金币，不妨多买点药水。',
    ],
    shop: ['potion_heal','potion_heal_l','ration','bread','arrow','torch'],
  },
  guard: {
    id: 'guard', name: '卫兵', icon: '💂', color: '#5a7aaa',
    sprite: 'goblin',
    hp: 50, speed: 95,
    job: 'guard', faction: 'town',
    dialogue: [
      '这片区域由我守卫，放心吧。',
      '最近地下城不太平，你要小心。',
      '看到可疑人物立刻告诉我。',
      '保重，冒险者。',
    ],
  },
  priest: {
    id: 'priest', name: '祭司', icon: '🧙', color: '#c8b0e0',
    sprite: 'ghost',
    hp: 25, speed: 80,
    job: 'pray', faction: 'town',
    dialogue: [
      '愿神明保佑你的旅程。',
      '祭坛可以恢复你的力量，别忘了使用。',
      '我感受到了黑暗的气息从地下传来...',
      '如果你受伤了，来这里休息一下吧。',
    ],
  },
  innkeeper: {
    id: 'innkeeper', name: '旅店老板', icon: '🍳', color: '#c97a4a',
    sprite: 'zombie',
    hp: 35, speed: 85,
    job: 'inn', faction: 'town',
    dialogue: [
      '欢迎来到我的旅店！要来份热饭吗？',
      '一晚只要5金币，包你睡个好觉。',
      '我这儿的炖肉可是远近驰名！',
      '外面太危险了，还是店里舒服啊。',
    ],
    shop: ['ration','bread','meat','potion_heal'],
  },
  citizen: {
    id: 'citizen', name: '村民', icon: '🧑', color: '#aabbcc',
    sprite: 'goblin',
    hp: 20, speed: 100,
    job: 'wander', faction: 'town',
    dialogue: [
      '哦，你就是那个新来的冒险者吧？',
      '这几天总听到地下城传来奇怪的声音...',
      '我家就在附近，有空来坐坐。',
      '希望你能在地下城找到宝藏！',
      '听说每5层就有一个大Boss，你可要小心。',
    ],
  },
  adventurer: {
    id: 'adventurer', name: '冒险者', icon: '⚔️', color: '#c9a04a',
    sprite: 'player',
    hp: 45, speed: 105,
    job: 'adventure', faction: 'neutral',
    dialogue: [
      '又见面了！地下城探索得怎么样？',
      '我上次在3层差点就没回来...',
      '你有 spare 的药水吗？我的用完了。',
      '一起加油吧，冒险者！',
    ],
  },
};

// ---------- NPC 名字池 ----------
const NAME_POOLS = {
  male: ['艾德温','加雷斯','罗兰','塞德里克','阿尔顿','莫里斯','芬恩','康纳','达克斯','维尔纳'],
  female: ['艾琳','塞拉菲娜','薇拉','伊莎贝拉','葛丽特','梅丽尔','黛安','奥莉维亚','希尔达','罗克珊'],
};

// ---------- 日程时间表（24小时制） ----------
// 阶段：深夜(0-5) 黎明(5-8) 上午(8-12) 下午(12-17) 黄昏(17-20) 夜晚(20-24)
export const TIME_PHASES = [
  { start: 0,  end: 5,  name: '深夜', activity: 'sleep' },
  { start: 5,  end: 8,  name: '黎明', activity: 'wake'  },
  { start: 8,  end: 12, name: '上午', activity: 'work'  },
  { start: 12, end: 14, name: '午间', activity: 'eat'   },
  { start: 14, end: 17, name: '下午', activity: 'work'  },
  { start: 17, end: 20, name: '黄昏', activity: 'social'},
  { start: 20, end: 24, name: '夜晚', activity: 'sleep' },
];

export function getTimePhase(hour){
  for(const p of TIME_PHASES){
    if(hour >= p.start && hour < p.end) return p;
  }
  return TIME_PHASES[0];
}

// ---------- AI 行为包系统 ----------
// 每个行为包是一个函数(game, npc, dt) -> bool(是否完成)
export const AI_PACKAGES = {
  // 睡觉：走到床的位置然后待着
  sleep: {
    name: '睡觉',
    execute(game, npc, dt){
      if(!npc._bed) npc._bed = npc._home || { x: npc.x, y: npc.y };
      const arrived = _moveTo(game, npc, npc._bed, dt, 1.5);
      if(arrived){
        npc.animState = 'idle';
        npc._sleeping = true;
        // 睡觉恢复HP
        if(npc.hp < npc.maxHp) npc.hp = Math.min(npc.maxHp, npc.hp + 2 * dt);
      }
      return false; // 持续到时间表切换
    }
  },

  // 工作：根据职业不同有不同行为
  work: {
    name: '工作',
    execute(game, npc, dt){
      npc._sleeping = false;
      const job = npc.npcJob || 'wander';
      switch(job){
        case 'trade': return _workMerchant(game, npc, dt);
        case 'guard': return _workGuard(game, npc, dt);
        case 'pray':  return _workPriest(game, npc, dt);
        case 'inn':   return _workInnkeeper(game, npc, dt);
        case 'wander': return _wander(game, npc, dt);
        case 'adventure': return _adventure(game, npc, dt);
        default: return _wander(game, npc, dt);
      }
    }
  },

  // 吃饭：找食物位置
  eat: {
    name: '吃饭',
    execute(game, npc, dt){
      npc._sleeping = false;
      if(!npc._eatSpot){
        // 随机走到附近一个位置吃饭
        const spots = game.map.items?.filter(it => 
          ['ration','bread','meat'].includes(it.item?.type) || it.item?.id === 'ration'
        ) || [];
        if(spots.length > 0){
          npc._eatSpot = { x: spots[0].x, y: spots[0].y };
        } else {
          npc._eatSpot = npc._home || { x: npc.x, y: npc.y };
        }
      }
      const arrived = _moveTo(game, npc, npc._eatSpot, dt, 1.5);
      if(arrived){
        npc.animState = 'idle';
        npc._eating = true;
      }
      return false;
    }
  },

  // 社交：走向另一个NPC聊天
  social: {
    name: '社交',
    execute(game, npc, dt){
      npc._sleeping = false;
      npc._eating = false;
      // 找最近的NPC
      if(!npc._socialTarget || npc._socialCD <= 0){
        npc._socialCD = 5 + game.rng.float() * 5;
        let nearest = null, minDist = 999;
        for(const other of game.map.entities){
          if(other === npc || !other.alive || other.isPlayer) continue;
          if(other.faction !== npc.faction) continue;
          const d = Math.abs(other.px - npc.px) + Math.abs(other.py - npc.py);
          if(d < minDist && d > 0.5){ minDist = d; nearest = other; }
        }
        npc._socialTarget = nearest ? { x: nearest.px, y: nearest.py, entity: nearest } : null;
      }
      npc._socialCD -= dt;
      if(npc._socialTarget){
        const arrived = _moveTo(game, npc, npc._socialTarget, dt, 1.2);
        if(arrived){
          npc.animState = 'idle';
          // 偶尔切换聊天对象
          if(game.rng.chance(0.02)){
            npc._socialCD = 0;
          }
        }
        return false;
      }
      // 没人可聊就闲逛
      return _wander(game, npc, dt);
    }
  },

  // 逃跑：远离威胁
  flee: {
    name: '逃跑',
    execute(game, npc, dt){
      npc._sleeping = false;
      npc._eating = false;
      const threat = npc._threat;
      if(!threat) return true;
      const dx = npc.px - threat.px;
      const dy = npc.py - threat.py;
      const len = Math.sqrt(dx*dx + dy*dy);
      if(len > 12 || !threat.alive){
        npc._threat = null;
        npc._fleeing = false;
        return true; // 逃脱
      }
      const spd = MONSTER_MOVE_SPEED_BASE * 1.5 * (npc._effSpeed() / 100) * dt;
      const nx = npc.px + (dx/len) * spd;
      const ny = npc.py + (dy/len) * spd;
      if(game._isWalkableFloatForMonster(nx, npc.py, npc)) npc.px = nx;
      if(game._isWalkableFloatForMonster(npc.px, ny, npc)) npc.py = ny;
      npc.x = Math.round(npc.px); npc.y = Math.round(npc.py);
      npc.animState = 'walk';
      npc.animDir = { x: dx/len, y: dy/len };
      const sdx = npc.animDir.x - npc.animDir.y;
      if(Math.abs(sdx) > 0.15) npc.faceLeft = sdx > 0;
      return false;
    }
  },

  // 警戒：卫兵发现敌人
  alert: {
    name: '警戒',
    execute(game, npc, dt){
      npc._sleeping = false;
      const threat = npc._threat;
      if(!threat || !threat.alive){
        npc._threat = null;
        npc._alerted = false;
        return true;
      }
      const dx = threat.px - npc.px;
      const dy = threat.py - npc.py;
      const dist = Math.sqrt(dx*dx + dy*dy);
      // 近距离攻击
      if(dist < 1.3 && npc.attackCD <= 0){
        npc.attackCD = 1.0;
        game._triggerAttackAnim(npc);
        npc.animDir = { x: dx/dist, y: dy/dist };
        const sdx = npc.animDir.x - npc.animDir.y;
        if(Math.abs(sdx) > 0.15) npc.faceLeft = sdx > 0;
        // 通过 game 的辅助方法处理攻击
        if(game._npcAttack) game._npcAttack(npc, threat);
        return false;
      }
      // 追击
      const spd = MONSTER_MOVE_SPEED_BASE * 1.2 * (npc._effSpeed() / 100) * dt;
      const target = { x: threat.px, y: threat.py };
      _moveTo(game, npc, target, dt, 1.0, spd);
      return false;
    }
  },
};

// ---------- 辅助函数 ----------
const MONSTER_MOVE_SPEED_BASE = 2.5;

// 通用移动到目标
function _moveTo(game, npc, target, dt, arriveDist=0.8, customSpd=null){
  const dx = (target.x !== undefined ? target.x : target.px) - npc.px;
  const dy = (target.y !== undefined ? target.y : target.py) - npc.py;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if(dist < arriveDist) return true;

  const spd = customSpd || MONSTER_MOVE_SPEED_BASE * 0.7 * (npc._effSpeed() / 100) * dt;
  // 简单寻路：尝试直线，碰墙则试侧向（用排除自身的碰撞检测）
  const walkable = (fx, fy) => game._isWalkableFloatForMonster(fx, fy, npc);
  let nx = npc.px + (dx/dist) * spd;
  let ny = npc.py + (dy/dist) * spd;
  if(walkable(nx, npc.py)){
    npc.px = nx;
  } else if(walkable(npc.px + (dx > 0 ? spd : -spd), npc.py)){
    npc.px += dx > 0 ? spd : -spd;
  }
  if(walkable(npc.px, ny)){
    npc.py = ny;
  } else if(walkable(npc.px, npc.py + (dy > 0 ? spd : -spd))){
    npc.py += dy > 0 ? spd : -spd;
  }
  npc.x = Math.round(npc.px); npc.y = Math.round(npc.py);
  npc.animState = 'walk';
  npc.animDir = { x: dx/dist, y: dy/dist };
  const sdx = npc.animDir.x - npc.animDir.y;
  if(Math.abs(sdx) > 0.15) npc.faceLeft = sdx > 0;
  return false;
}

// 商人工作：站在店铺位置，偶尔移动
function _workMerchant(game, npc, dt){
  if(!npc._workSpot) npc._workSpot = npc._home || { x: npc.x, y: npc.y };
  if(npc.aiThinkCD <= 0){
    npc.aiThinkCD = 4 + game.rng.float() * 6;
    // 30%概率在店铺附近走动
    if(game.rng.chance(0.3)){
      npc._wanderTarget = {
        x: npc._workSpot.x + game.rng.int(-2, 2),
        y: npc._workSpot.y + game.rng.int(-2, 2),
      };
    } else {
      npc._wanderTarget = null;
    }
  }
  if(npc._wanderTarget){
    const arrived = _moveTo(game, npc, npc._wanderTarget, dt, 0.8);
    if(arrived) npc._wanderTarget = null;
  } else {
    _moveTo(game, npc, npc._workSpot, dt, 1.0);
    npc.animState = 'idle';
  }
  return false;
}

// 卫兵工作：巡逻路线
function _workGuard(game, npc, dt){
  if(!npc._patrolPoints){
    // 生成巡逻路线：以家为中心的5个点
    npc._patrolPoints = [];
    const origin = npc._home || { x: npc.x, y: npc.y };
    for(let i = 0; i < 5; i++){
      const angle = (i / 5) * Math.PI * 2;
      const r = 4 + game.rng.int(0, 3);
      const px = Math.round(origin.x + Math.cos(angle) * r);
      const py = Math.round(origin.y + Math.sin(angle) * r);
      if(game.map.isWalkable(px, py)) npc._patrolPoints.push({ x: px, y: py });
    }
    if(npc._patrolPoints.length === 0) npc._patrolPoints = [origin];
    npc._patrolIdx = 0;
  }
  const target = npc._patrolPoints[npc._patrolIdx];
  const arrived = _moveTo(game, npc, target, dt, 0.8);
  if(arrived){
    npc._patrolIdx = (npc._patrolIdx + 1) % npc._patrolPoints.length;
    npc.animState = 'idle';
    // 巡逻点停留
    npc.aiThinkCD = 1 + game.rng.float() * 2;
  }
  return false;
}

// 祭司工作：在祭坛附近祈祷
function _workPriest(game, npc, dt){
  if(!npc._workSpot){
    // 找祭坛位置
    for(let y = 0; y < game.map.h; y++){
      for(let x = 0; x < game.map.w; x++){
        if(game.map.tiles[y][x].id === 'altar'){
          npc._workSpot = { x, y };
          break;
        }
      }
      if(npc._workSpot) break;
    }
    if(!npc._workSpot) npc._workSpot = npc._home || { x: npc.x, y: npc.y };
  }
  const arrived = _moveTo(game, npc, npc._workSpot, dt, 1.5);
  if(arrived){
    npc.animState = 'idle';
    // 祈祷效果：偶尔恢复
    if(npc.hp < npc.maxHp && game.rng.chance(0.01)){
      npc.hp = Math.min(npc.maxHp, npc.hp + 1);
    }
  }
  return false;
}

// 旅店老板工作：在旅店位置
function _workInnkeeper(game, npc, dt){
  if(!npc._workSpot) npc._workSpot = npc._home || { x: npc.x, y: npc.y };
  // 大部分时间站着，偶尔走动
  if(npc.aiThinkCD <= 0){
    npc.aiThinkCD = 5 + game.rng.float() * 5;
    if(game.rng.chance(0.25)){
      npc._wanderTarget = {
        x: npc._workSpot.x + game.rng.int(-3, 3),
        y: npc._workSpot.y + game.rng.int(-3, 3),
      };
    } else {
      npc._wanderTarget = null;
    }
  }
  if(npc._wanderTarget){
    const arrived = _moveTo(game, npc, npc._wanderTarget, dt, 0.8);
    if(arrived) npc._wanderTarget = null;
  } else {
    _moveTo(game, npc, npc._workSpot, dt, 1.0);
    npc.animState = 'idle';
  }
  return false;
}

// 闲逛：在出生点附近随机走动
function _wander(game, npc, dt){
  if(!npc._wanderOrigin) npc._wanderOrigin = { x: npc.x, y: npc.y };
  if(npc.aiThinkCD <= 0){
    npc.aiThinkCD = 3 + game.rng.float() * 4;
    if(game.rng.chance(0.7)){
      npc._wanderTarget = {
        x: npc._wanderOrigin.x + game.rng.int(-4, 4),
        y: npc._wanderOrigin.y + game.rng.int(-4, 4),
      };
    } else {
      npc._wanderTarget = null;
    }
  }
  if(npc._wanderTarget){
    const arrived = _moveTo(game, npc, npc._wanderTarget, dt, 0.8);
    if(arrived) npc._wanderTarget = null;
  } else {
    npc.animState = 'idle';
  }
  return false;
}

// 冒险者：进出地下城探索
function _adventure(game, npc, dt){
  if(!npc._adventureState) npc._adventureState = 'idle';
  if(npc.aiThinkCD <= 0){
    npc.aiThinkCD = 5 + game.rng.float() * 8;
    const r = game.rng.float();
    if(r < 0.3) npc._adventureState = 'goto_dungeon';
    else if(r < 0.6) npc._adventureState = 'goto_home';
    else npc._adventureState = 'idle';
  }
  switch(npc._adventureState){
    case 'goto_dungeon':
      if(game.map.stairsDown){
        const arrived = _moveTo(game, npc, game.map.stairsDown, dt, 1.0);
        if(arrived){
          npc._adventureState = 'idle';
          npc.aiThinkCD = 10; // 在地下城待一会
        }
      }
      break;
    case 'goto_home':
      if(npc._home){
        const arrived = _moveTo(game, npc, npc._home, dt, 1.0);
        if(arrived) npc._adventureState = 'idle';
      }
      break;
    default:
      _wander(game, npc, dt);
  }
  return false;
}

// ---------- 创建NPC实例 ----------
export function makeNPC(typeId, x, y, rng){
  const def = NPC_TYPES[typeId];
  if(!def) return null;
  const gender = rng.chance(0.5) ? 'male' : 'female';
  const name = rng.pick(NAME_POOLS[gender]);
  const npc = {
    // 基础
    name: name,
    isPlayer: false,
    isNPC: true,
    npcType: typeId,
    npcJob: def.job,
    faction: def.faction,
    monsterId: def.sprite,
    color: def.color,
    icon: def.icon,
    hp: def.hp, maxHp: def.hp,
    mp: 0, maxMp: 0,
    speed: def.speed,
    dv: 8, pv: 1,
    dice: '1d4', bonus: 0,
    level: 1, xp: 0, xpNext: 30,
    attrs: { 力量:10, 魔力:5, 意志:8, 灵巧:10, 感知:8, 学习:5, 魅力:8, 速度: def.speed },
    // 坐标
    x, y, px: x, py: y, vx: 0, vy: 0,
    // AI状态
    aiState: 'idle',
    aiThinkCD: 0,
    attackCD: 0,
    sightRange: 6,
    // 动画
    animState: 'idle',
    animTime: 0,
    animDir: { x: 0, y: 1 },
    faceLeft: false,
    hitFlash: 0,
    attackAnim: 0,
    // 日程
    schedule: null, // 由外部设置
    currentPackage: null,
    // 状态标记
    alive: true,
    blocksMove: false,
    statusEffects: [],
    inventory: [],
    equipment: {},
    skills: {},
    spells: {},
    gold: rng.int(10, 50),
    stamina: 100, maxStamina: 100,
    food: 80,
    karma: 0,
    resist: {},
    regen: 0,
    floats: false,
    drops: [],
    // NPC私有
    _home: { x, y },
    _bed: null,
    _workSpot: null,
    _wanderTarget: null,
    _wanderOrigin: { x, y },
    _socialTarget: null,
    _socialCD: 0,
    _threat: null,
    _fleeing: false,
    _alerted: false,
    _sleeping: false,
    _eating: false,
    _patrolPoints: null,
    _patrolIdx: 0,
    _adventureState: null,
    _dialogueOffset: rng.int(0, 1000),
    // Entity 兼容方法
    _effSpeed(){ return Math.max(10, this.speed); },
    getAttr(name){ return this.attrs[name] || 10; },
    hasStatus(){ return false; },
    isRanged(){ return false; },
    hasAmmo(){ return false; },
    consumeAmmo(){},
    weaponDamage(rng){ return rollDice(this.dice || '1d4') + (this.bonus || 0); },
    weaponSkill(){ return '格斗'; },
    getResist(ele){ return (this.resist && this.resist[ele]) || 0; },
    sumEnchants(){ return {}; },
    // 对话
    dialogue: def.dialogue,
    shop: def.shop || null,
  };
  return npc;
}

// ---------- 获取NPC当前应该执行的行为包 ----------
export function getNPCPackage(npc, hour){
  const phase = getTimePhase(hour);
  const activity = phase.activity;

  // 威胁优先级最高
  if(npc._threat && npc._fleeing) return 'flee';
  if(npc._threat && npc._alerted) return 'alert';

  // 根据时间段选择行为
  switch(activity){
    case 'sleep': return 'sleep';
    case 'wake': return 'work'; // 起床后直接工作
    case 'eat': return 'eat';
    case 'social': return 'social';
    case 'work': return 'work';
    default: return 'work';
  }
}

// ---------- 获取NPC当前对话 ----------
export function getNPCDialogue(npc, hour, rng){
  const phase = getTimePhase(hour);
  let lines = npc.dialogue || [];
  // 根据时间添加额外对话
  if(phase.activity === 'sleep'){
    return '嘘...我现在要休息了，明天再聊吧。';
  }
  if(phase.activity === 'eat'){
    lines = ['正在吃饭呢，等会儿再说。', '这顿饭真香！', ...lines];
  }
  if(phase.activity === 'social'){
    lines = ['今天天气不错啊。', '你今天过得怎么样？', ...lines];
  }
  // 随机选一句
  const idx = (npc._dialogueOffset + Math.floor(rng.float() * 3)) % lines.length;
  return lines[idx];
}
