// ===== 主游戏控制器：实时平滑移动 / 输入 / AI / 渲染 =====

import { RNG, rng, rollDice } from './rng.js';
import { IsoRenderer, gridToScreen, screenToGrid, TILE_W, TILE_H, WALL_H, SPRITE_MAP } from './iso.js?v=43';
import { GameMap, generateTown, computeFOV, computeFOV3D, computeVerticalVisibility, Zone, Region, World, ZoneTransition, EnterState, generateRegion } from './world.js?v=43';
import { createPlayer, makeMonster, Entity, equip, unequip } from './entity.js';
import { makeItem, itemName } from './item.js';
import { attack, castSpell, applyDamage, tickStatusEffects, regenEntity } from './combat.js';
import { RACES, CLASSES, SPELLS, ITEMS, GODS, SKILLS, ATTRS, SEASONS, getSeason, WEATHER_EFFECTS } from './data.js?v=43';
import { MAT, GROUPS, BIOMES } from './materials.js';
import { UI } from './ui.js';
import { findPath, smoothPath } from './pathfind.js?v=2';
import { AI_PACKAGES, getNPCPackage, getNPCDialogue, getTimePhase, RelationManager, ShopManager, DIALOGUE_TOPICS, getTopicResponse, FACTIONS, getNPCTopics } from './npc.js?v=43';
import { TBCombat, getMoveRange, AP_ACTION, AP_BONUS } from './tbcombat.js';
import { loadSource } from './source-data.js';

// 移动速度常量
const PLAYER_MOVE_SPEED = 4.5;   // 格/秒
const MONSTER_MOVE_SPEED_BASE = 2.5;
const ATTACK_COOLDOWN = 0.6;      // 玩家攻击冷却秒
const FOV_UPDATE_INTERVAL = 0.15; // FOV刷新间隔
const PICKUP_RADIUS = 0.6;        // 自动拾取半径



class Game{
  constructor(){
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new IsoRenderer(this.canvas);
    this.ui = new UI();
    this.rng = new RNG(Math.floor(Math.random()*1e9));
    this.player = null;
    this.map = null;
    this.gs = { day:1, weather:'晴', mapName:'', depth:null, turn:0, hour:8, timeAccum:0 };
    this._relations = new RelationManager();
    this._shopMgr = new ShopManager();
    this.world = null;
    this.region = null;
    this.currentZone = null;
    this._lastRegionPos = null;
    this.hoverTile = null;
    this.targetMode = null;
    this.lastTime = 0;
    this.running = false;
    this.messages = [];
    this.keys = {};            // 按键状态
    this.fovTimer = 0;
    // 回合制战斗系统
    this.tb = new TBCombat();
    this.tb.onTurnStart = (e) => this._onTBTurnStart(e);
    this.tb.onTurnEnd = (e) => this._onTBTurnEnd(e);
    this.tb.onCombatEnd = () => this._onTBCombatEnd();
    this._tbAITimer = 0;       // AI回合行动延迟计时器
    this._tbMovePath = null;   // 回合制移动路径
    this._tbAIMovePath = null; // AI平滑移动路径
    this._tbHighlightTiles = []; // 移动范围高亮瓦片
    this.regenTimer = 0;
    this.dmgPopups = [];       // 浮动伤害数字 [{x,y,text,color,life}]
    this._autoPath = null;      // 自动寻路状态 { path: [], idx: 0, target: {x,y} }
    // 建造模式
    this.buildMode = null;      // null=关闭, {cat:'decor'|'wall'|'floor', tool:'place'|'remove', selected:null, search:''}
    this.fogNoFog = false;      // 建造模式：去除战争迷雾（完全照亮）
    this.fogReveal = false;     // 建造模式：直接显示未探索区域
    this._allTrueCache = null;  // 全true可见性数组缓存
    // 调试模式
    this.debugMode = false;
    this.debugTile = null;      // {x, y} 选中的格子
    this.debugHideOthers = false;
    this.debugSrcOff = {x:0, y:0};   // atlas截取偏移 (像素)
    this.debugDrawOff = {x:0, y:0};  // 绘制位置偏移 (像素)
    this._setupResize();
    this._setupInput();
    this.ui.initSettings();
    this._initSettingsListeners();
    this._initCharCreate();
    this._startLoop();
  }

  // ========== 初始化角色创建 ==========
  _initCharCreate(){
    const urlParams = new URLSearchParams(window.location.search);
    if(urlParams.get('auto') === '1'){
      this.ui.hideCharCreate();
      this.ui.showHUD();
      this.player = createPlayer('yerles', 'warrior', '测试', this.rng);
      const dungeonRoot = new Zone('dungeon_auto', '测试地下城', {
        lv: 0, dangerLv: 3, isDungeon: true, generator: 'dungeon', branch: null
      });
      this.enterDungeon(dungeonRoot, 3);
      return;
    }
    this.ui.initCharCreate(({raceId, classId, name})=>{
      this.ui.hideCharCreate();
      this.ui.showHUD();
      this.player = createPlayer(raceId, classId, name, this.rng);
      this.startNewGame();
    });
  }

  startNewGame(){ this.enterRegion(); }

  // ========== 设置监听 ==========
  _initSettingsListeners(){
    this.ui.onSettingsChange((key, value)=>{
      if(key === 'showHelp'){
        const tip = document.getElementById('help-tip');
        if(tip) tip.classList.toggle('hidden', !value);
      }
    });
  }

  // ========== 进入大地图（Region）==========
  enterRegion(){
    this.world = new World();
    this.region = generateRegion(this.rng, 0);
    this.world.addRegion(this.region);
    this.currentZone = this.region;
    this.map = this.region.map;
    this.gs.mapName = this.region.name;
    this.gs.depth = 0;
    this._placePlayer(this.map.stairsUp.x, this.map.stairsUp.y);
    this.log(`欢迎来到 ${this.region.name}！`, 'info');
    this.log('在大地图上行走，找到城镇和地下城入口。', 'info');
    this._afterMapEnter();
  }

  // ========== 进入城镇 ==========
  enterTown(townZone){
    this.map = generateTown(this.rng, 0);
    this.currentZone = townZone;
    this.gs.mapName = townZone.name;
    this.gs.depth = 0;
    this._placePlayer(this.map.stairsUp.x, this.map.stairsUp.y);
    this.log(`来到 ${townZone.name}！这里有商店、酒馆和祭坛。`, 'info');
    // 初始化NPC商店库存
    for(const npc of this.map.entities){
      if(npc.isNPC && npc.shop && npc.shop.length > 0){
        this._shopMgr.initShop(npc.name, npc.shop, this.rng);
      }
    }
    this._afterMapEnter();
  }

  // ========== 进入地下城 ==========
  enterDungeon(dungeonZone, depth){
    // 找到或创建对应层级的 Zone
    const targetLv = -(depth || 1);
    let targetZone = dungeonZone.findZone(targetLv);
    if(!targetZone){
      targetZone = new Zone(dungeonZone.id + '_' + targetLv, dungeonZone.name + ' ' + depth + 'F', {
        lv: targetLv,
        dangerLv: dungeonZone.dangerLv,
        isDungeon: true,
        generator: 'dungeon',
        branch: dungeonZone.branch,
      });
      dungeonZone.addChild(targetZone);
    }
    // 生成地图（如果还没有）
    targetZone.generate(this.rng);
    this.map = targetZone.map;
    this.currentZone = targetZone;
    this.gs.mapName = targetZone.name;
    this.gs.depth = depth || Math.abs(targetLv);
    const sx = this.map.stairsUp.x, sy = this.map.stairsUp.y;
    this._placePlayer(sx, sy);
    this.log(`进入 ${targetZone.name}（危险度 ${targetZone.dangerLevel}）`, 'info');
    if(this.gs.depth % 5 === 0) this.log('前方似乎有强大的存在…', 'warn');
    this._afterMapEnter();
  }

  // ========== 进入野外 ==========
  enterField(fieldZone){
    fieldZone.generate(this.rng);
    this.map = fieldZone.map;
    this.currentZone = fieldZone;
    this.gs.mapName = fieldZone.name;
    this.gs.depth = 0;
    this._placePlayer(this.map.stairsUp.x, this.map.stairsUp.y);
    this.log(`进入 ${fieldZone.name}`, 'info');
    this._afterMapEnter();
  }

  // ========== 返回大地图 ==========
  returnToRegion(){
    if(!this.region) return;
    this.map = this.region.map;
    this.currentZone = this.region;
    this.gs.mapName = this.region.name;
    this.gs.depth = 0;
    // 返回到之前的大地图位置（如果有的话）
    const lastPos = this._lastRegionPos;
    if(lastPos){
      this._placePlayer(lastPos.x, lastPos.y);
    } else {
      this._placePlayer(this.map.stairsUp.x, this.map.stairsUp.y);
    }
    this.log(`返回 ${this.region.name}`, 'info');
    this._afterMapEnter();
  }

  _placePlayer(x, y){
    let px = x, py = y;
    if(!this.map.isWalkable(px, py)){
      for(let r=1;r<5;r++){
        for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
          if(this.map.isWalkable(px+dx, py+dy)){ px+=dx; py+=dy; dx=99; dy=99; break; }
        }
      }
    }
    this.player.x = px; this.player.y = py;
    this.player.px = px; this.player.py = py;
    this.player.vx = 0; this.player.vy = 0;
  }

  _afterMapEnter(){
    // 初始化所有实体的像素坐标
    for(const e of this.map.entities){
      e.px = e.x; e.py = e.y; e.vx = 0; e.vy = 0; e.attackCD = 0; e.aiThinkCD = 0;
    }
    this._recomputeFOV();
    this._centerCamera();
    this._updateHUD();
    // 应用设置
    const tip = document.getElementById('help-tip');
    if(tip) tip.classList.toggle('hidden', !this.ui.settings.showHelp);
    // 刷新移动端法术栏
    if(this._isTouch) this._updateMobileSpells();
  }

  _centerCamera(){
    const p = gridToScreen(this.player.px, this.player.py);
    this.renderer.cam.follow(p.x, p.y);
    this.renderer.cam.x = p.x; this.renderer.cam.y = p.y;
  }

  _recomputeFOV(){
    const gx = Math.round(this.player.px), gy = Math.round(this.player.py);
    this.player.x = gx; this.player.y = gy;
    const range = 6 + Math.floor((this.player.getAttr?this.player.getAttr('感知'):0) * 0.3);
    const r = Math.max(5, range);
    this.map.sight = r;
    computeFOV3D(this.map, gx, gy, r);
  }

  // ========== 主循环：实时更新 ==========
  _startLoop(){
    const loop = (t)=>{
      const dt = Math.min(0.05, (t - this.lastTime)/1000 || 0.016);
      this.lastTime = t;
      this.renderer.time += dt;
      this.renderer.cam.update(dt);

      if(this.player && this.player.alive && this.map && !this.ui.isPanelOpen()){
        this._update(dt);
      }
      this._updatePopups(dt);
      this._render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ========== 实时更新 ==========
  _update(dt){
    if(this.tb.active){
      this._updateTurnBased(dt);
    } else {
      this._updateRealtime(dt);
    }
  }

  // ========== 回合制更新 ==========
  _updateTurnBased(dt){
    // FOV 刷新
    this.fovTimer += dt;
    if(this.fovTimer >= FOV_UPDATE_INTERVAL){
      this.fovTimer = 0;
      this._recomputeFOV();
    }

    // 玩家回合：处理移动
    if(this.tb.isMyTurn(this.player)){
      this._updateTBPlayer(dt);
    } else {
      // AI回合：先处理平滑移动，再决策
      if(this._tbAIMovePath && this._tbAIMovePath.length > 0){
        this._updateTBAIMove(dt);
      } else {
        // AI延迟后决策
        this._tbAITimer -= dt;
        if(this._tbAITimer <= 0){
          this._updateTBAI(dt);
        }
      }
    }

    // 玩家动画
    this._updateEntityAnim(this.player, null, dt);
    for(const m of this.map.entities){
      if(m.alive) this._updateEntityAnim(m, null, dt);
    }

    // 清理死亡掉落
    this._handleDrops();

    // 相机跟随
    const p = gridToScreen(this.player.px, this.player.py);
    this.renderer.cam.follow(p.x, p.y);

    // HUD
    this._hudTimer = (this._hudTimer||0) + dt;
    if(this._hudTimer >= 0.2){
      this._hudTimer = 0;
      this._updateHUD();
      this._updateTBUI();
    }
  }

  // ========== 实时更新 ==========
  _updateRealtime(dt){
    // ---- 游戏时间推进（1现实秒 = 1游戏分钟，24分钟=1天）----
    this.gs.timeAccum += dt;
    this.gs.hour += dt * (24/1440); // 1秒=1分钟，24*60=1440秒=1天
    while(this.gs.hour >= 24){
      this.gs.hour -= 24;
      this.gs.day++;
      // 每天更新天气
      this._updateWeather();
      // 每6小时检查是否需要换天气
    }
    // 每6小时有概率换天气
    this._weatherTimer = (this._weatherTimer || 0) + dt;
    if(this._weatherTimer >= 21600){ // 6小时=21600秒
      this._weatherTimer = 0;
      if(Math.random() < 0.3){
        this._updateWeather();
      }
    }

    // FOV 定时刷新
    this.fovTimer += dt;
    if(this.fovTimer >= FOV_UPDATE_INTERVAL){
      this.fovTimer = 0;
      this._recomputeFOV();
    }

    // 玩家移动
    this._updatePlayerMovement(dt);

    // 玩家待机动画持续计时（即使不动也要呼吸）
    if(this.player.animState !== 'attack' && this.player.animState !== 'hit'){
      if(!this.keys['w']&&!this.keys['a']&&!this.keys['s']&&!this.keys['d']&&
         !this.keys['W']&&!this.keys['A']&&!this.keys['S']&&!this.keys['D']&&
         !this.keys['ArrowUp']&&!this.keys['ArrowDown']&&!this.keys['ArrowLeft']&&!this.keys['ArrowRight']&&
         !this._joyActive &&
         !this._autoPath){
        this._updateEntityAnim(this.player, null, dt);
      }
    } else {
      this._updateEntityAnim(this.player, null, dt);
    }

    // 玩家攻击冷却
    if(this.player.attackCD > 0) this.player.attackCD -= dt;
    if(this.player.spellCD > 0) this.player.spellCD -= dt;

    // 自动攻击：按住攻击键或碰到敌人
    if((this.keys['f'] || this.keys['F'] || this._touchAttack) && this.player.attackCD <= 0){
      this._playerTryAttack();
    }

    // 实体 AI 更新（区分怪物和NPC）
    for(const m of this.map.entities){
      if(!m.alive) continue;
      if(m.isNPC){
        this._updateNPC(m, dt);
      } else {
        this._updateMonster(m, dt);
      }
    }

    // 清理死亡掉落
    this._handleDrops();

    // 状态效果 & 回复（定时）
    this.regenTimer += dt;
    if(this.regenTimer >= 1.0){
      this.regenTimer = 0;
      tickStatusEffects(this.player, this.rng, (t,ty)=>this.log(t,ty));
      regenEntity(this.player, this.rng);
      // 饱食度
      this.player.food -= 0.1;
      if(this.player.food < 0){ this.player.food = 0; this.player.hp -= 1; if(this.player.hp<=0){ this.player.hp=0; this.player.alive=false; this._onPlayerDeath(); } }
      for(const m of this.map.entities){
        if(!m.alive) continue;
        tickStatusEffects(m, this.rng, ()=>{});
        regenEntity(m, this.rng);
      }
    }

    // 相机跟随
    const p = gridToScreen(this.player.px, this.player.py);
    this.renderer.cam.follow(p.x, p.y);

    // NPC 交互检测
    this._checkNPCInteraction();

    // HUD 更新（节流）
    this._hudTimer = (this._hudTimer||0) + dt;
    if(this._hudTimer >= 0.2){
      this._hudTimer = 0;
      this._updateHUD();
    }
  }

  // ========== 天气更新 ==========
  _updateWeather(){
    const season = getSeason(this.gs.day);
    const weights = season.weatherWeights;
    const total = Object.values(weights).reduce((a,b)=>a+b, 0);
    let rand = Math.random() * total;
    for(const [w, weight] of Object.entries(weights)){
      rand -= weight;
      if(rand <= 0){
        if(this.gs.weather !== w){
          this.gs.weather = w;
          const effect = WEATHER_EFFECTS[w];
          if(effect){
            this.log(`天气变化：${effect.desc}`, 'info');
          }
        }
        return;
      }
    }
  }

  // 获取当前天气效果
  _getWeatherEffect(){
    return WEATHER_EFFECTS[this.gs.weather] || WEATHER_EFFECTS['晴'];
  }

  // ========== 回合制：进入/退出战斗 ==========
  _toggleCombatMode(){
    if(this.tb.active){
      // ===== 硬退出回合制 → 切回实时 =====
      this._exitTurnBased();
    } else {
      this._enterTurnBased(false);
    }
  }

  // 彻底退出回合制，清理所有状态
  _exitTurnBased(){
    this.tb.active = false;
    this.tb.queue = [];
    this.tb.currentIdx = 0;
    this.tb.currentActor = null;
    this.tb.round = 0;
    this._tbAITimer = 0;
    this._tbMovePath = null;
    this._tbAIMovePath = null;
    this._tbHighlightTiles = [];
    // 清理所有实体的回合制状态
    if(this.player){
      this.player._tbAction = 0;
      this.player._tbBonus = 0;
      this.player._tbMoved = 0;
      this.player._tbDashing = false;
      this.player._tbMoveRange = 0;
    }
    for(const e of this.map.entities){
      e._tbAction = 0;
      e._tbBonus = 0;
      e._tbMoved = 0;
      e._tbMoveRange = 0;
      e._tbDone = false;
    }
    // 隐藏回合制UI
    const el = document.getElementById('tb-ui');
    if(el) el.classList.add('hidden');
    this.log('切换至实时模式', 'good');
  }

  _enterTurnBased(triggeredByCombat){
    // 只收集附近的怪物（12格内或有仇恨的）+ 玩家
    const p = this.player;
    const COMBAT_RADIUS = 12;
    const combatants = [p];
    for(const e of this.map.entities){
      if(!e.alive) continue;
      if(e.isNPC) continue;
      const dist = Math.abs(e.px - p.px) + Math.abs(e.py - p.py);
      const hasAggro = e._aggroMemory && e._aggroMemory.aggro;
      if(dist <= COMBAT_RADIUS || hasAggro){
        combatants.push(e);
      }
    }
    if(combatants.length < 2){
      this.log('附近没有敌人，无需进入回合制', 'info');
      return;
    }
    this.log(triggeredByCombat ? '战斗开始！进入回合制模式' : '切换至回合制模式（按 Tab 切回实时）', 'warn');
    this.tb.enter(combatants, this.rng);
    this._tbAITimer = 0.5;
  }

  _onTBCombatEnd(){
    this._exitTurnBased();
    this.log('战斗结束！回到实时模式', 'good');
  }

  _onTBTurnStart(entity){
    if(!entity) return;
    this.log(`${entity.name} 的回合开始`, entity.isPlayer ? 'good' : 'info');
    if(entity.isPlayer){
      // 计算移动范围高亮
      this._computeTBMoveTiles();
    } else {
      this._tbHighlightTiles = [];
      this._tbAITimer = 0.8; // AI延迟0.8秒
    }
  }

  _onTBTurnEnd(entity){
    this._tbMovePath = null;
    this._tbAIMovePath = null;
  }

  // 计算玩家可移动的格子（BFS范围）
  _computeTBMoveTiles(){
    const p = this.player;
    const range = (p._tbMoveRange || 0) - (p._tbMoved || 0);
    if(range <= 0){ this._tbHighlightTiles = []; return; }
    const tiles = [];
    const visited = new Set();
    const queue = [{x: Math.round(p.px), y: Math.round(p.py), dist: 0}];
    visited.add(`${Math.round(p.px)},${Math.round(p.py)}`);
    while(queue.length > 0){
      const cur = queue.shift();
      if(cur.dist >= range) continue;
      for(const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]){
        const nx = cur.x + dx, ny = cur.y + dy;
        const key = `${nx},${ny}`;
        if(visited.has(key)) continue;
        if(!this.map.isWalkable(nx, ny)) continue;
        // 不走到敌人身上
        let blocked = false;
        for(const e of this.map.entities){
          if(e.alive && !e.isPlayer && !e.isNPC && e.x === nx && e.y === ny){ blocked = true; break; }
        }
        if(blocked) continue;
        visited.add(key);
        tiles.push({x: nx, y: ny});
        queue.push({x: nx, y: ny, dist: cur.dist + 1});
      }
    }
    this._tbHighlightTiles = tiles;
  }

  // ========== 回合制：玩家操作 ==========
  _updateTBPlayer(dt){
    const p = this.player;

    // 平滑移动到路径目标
    if(this._tbMovePath && this._tbMovePath.length > 0){
      const target = this._tbMovePath[0];
      const dx = target.x - p.px;
      const dy = target.y - p.py;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if(dist < 0.15){
        // 到达此节点
        p.px = target.x; p.py = target.y;
        p.x = Math.round(p.px); p.y = Math.round(p.py);
        this._tbMovePath.shift();
        p._tbMoved = (p._tbMoved || 0) + 1;
        this._computeTBMoveTiles();
        if(this._tbMovePath.length === 0){
          p.animState = 'idle';
        }
      } else {
        const spd = PLAYER_MOVE_SPEED * 1.2 * dt;
        const nx = p.px + (dx/dist) * spd;
        const ny = p.py + (dy/dist) * spd;
        p.px = nx; p.py = ny;
        p.animState = 'walk';
        p.animDir = { x: dx/dist, y: dy/dist };
        const sdx = p.animDir.x - p.animDir.y;
        if(Math.abs(sdx) > 0.15) p.faceLeft = sdx > 0;
      }
    } else {
      // 键盘移动（一格一格走，消耗移动点）
      if(p._tbMoved < (p._tbMoveRange || 0)){
        let dx = 0, dy = 0;
        if(!this.debugMode){
          if(this.keys['w']||this.keys['W']||this.keys['ArrowUp']) dy = -1;
          else if(this.keys['s']||this.keys['S']||this.keys['ArrowDown']) dy = 1;
          else if(this.keys['a']||this.keys['A']||this.keys['ArrowLeft']) dx = -1;
          else if(this.keys['d']||this.keys['D']||this.keys['ArrowRight']) dx = 1;
        } else {
          // debug模式：WASD移动，方向键留给offset调整
          if(this.keys['w']||this.keys['W']) dy = -1;
          else if(this.keys['s']||this.keys['S']) dy = 1;
          else if(this.keys['a']||this.keys['A']) dx = -1;
          else if(this.keys['d']||this.keys['D']) dx = 1;
        }

        if(dx !== 0 || dy !== 0){
          const nx = p.x + dx, ny = p.y + dy;
          if(this._isWalkableFloat(nx, ny)){
            p.px = nx; p.py = ny;
            p.x = nx; p.y = ny;
            p._tbMoved = (p._tbMoved || 0) + 1;
            p.animState = 'walk';
            p.animDir = { x: dx, y: dy };
            const sdx = dx - dy;
            if(Math.abs(sdx) > 0.15) p.faceLeft = sdx > 0;
            this._computeTBMoveTiles();
          }
        }
      }

      // F键攻击（消耗主动作）
      if((this.keys['f'] || this.keys['F'] || this._touchAttack) && (p._tbAction || 0) > 0){
        this._tbPlayerAttack();
      }
    }
  }

  // 回合制玩家攻击
  _tbPlayerAttack(){
    const p = this.player;
    let bestTarget = null, bestDist = 1.5;
    for(const m of this.map.entities){
      if(!m.alive || m.isNPC) continue;
      const dist = Math.sqrt((m.px - p.px)**2 + (m.py - p.py)**2);
      if(dist < bestDist){ bestDist = dist; bestTarget = m; }
    }
    if(bestTarget){
      p._tbAction = 0; // 消耗主动作
      this._triggerAttackAnim(p);
      p.animDir = { x: bestTarget.px - p.px, y: bestTarget.py - p.py };
      const dirLen = Math.sqrt(p.animDir.x**2 + p.animDir.y**2);
      if(dirLen > 0){ p.animDir.x /= dirLen; p.animDir.y /= dirLen; }
      const sdx = p.animDir.x - p.animDir.y;
      if(Math.abs(sdx) > 0.15) p.faceLeft = sdx > 0;
      attack(p, bestTarget, this.rng, (t,ty)=>{ this.log(t,ty); this._addDmgPopup(bestTarget, t, ty); this._triggerHitAnim(bestTarget); });
      this._updateTBUI();
    } else {
      this.log('附近没有敌人', 'info');
    }
  }

  // 回合制玩家施法
  _tbPlayerCastSpell(spellId){
    const p = this.player;
    if((p._tbAction || 0) <= 0){
      this.log('没有动作点了！', 'warn');
      return;
    }
    const spell = SPELLS[spellId];
    if(!spell) return;
    if(!p.spells[spellId] || p.spells[spellId].stock <= 0){
      this.log('法术次数耗尽', 'warn');
      return;
    }
    if(p.mp < spell.mp){
      this.log('法力不足', 'warn');
      return;
    }
    // 治疗法术直接施放
    if(spell.heal){
      p._tbAction = 0;
      castSpell(p, spellId, p, this.rng, (t,ty)=>this.log(t,ty), this.map);
      this._updateTBUI();
      return;
    }
    // 攻击法术：找最近敌人
    let bestTarget = null, bestDist = 6;
    for(const m of this.map.entities){
      if(!m.alive || m.isNPC) continue;
      const dist = Math.sqrt((m.px - p.px)**2 + (m.py - p.py)**2);
      if(dist < bestDist){ bestDist = dist; bestTarget = m; }
    }
    if(bestTarget){
      p._tbAction = 0;
      this._triggerAttackAnim(p);
      castSpell(p, spellId, bestTarget, this.rng, (t,ty)=>this.log(t,ty), this.map);
      this._updateTBUI();
    } else {
      this.log('6格内没有敌人', 'info');
    }
  }

  // 回合制玩家结束回合
  _tbEndTurn(){
    if(this.tb.isMyTurn(this.player)){
      this.player._tbDashing = false;
      this.tb.nextTurn();
    }
  }

  // 冲刺：消耗主动作，移动范围翻倍
  _tbDash(){
    const p = this.player;
    if((p._tbAction || 0) <= 0){ this.log('没有动作点！', 'warn'); return; }
    if(p._tbDashing){ this.log('已经冲刺过了！', 'warn'); return; }
    p._tbAction = 0;
    p._tbDashing = true;
    p._tbMoveRange = (p._tbMoveRange || 0) * 2;
    this.log('冲刺！移动范围翻倍', 'good');
    this._computeTBMoveTiles();
    this._updateTBUI();
  }

  // 急救：消耗附赠动作，恢复少量HP
  _tbQuickHeal(){
    const p = this.player;
    if((p._tbBonus || 0) <= 0){ this.log('没有附赠动作了！', 'warn'); return; }
    if(p.hp >= p.maxHp){ this.log('HP已满', 'info'); return; }
    p._tbBonus = 0;
    const heal = Math.floor(p.maxHp * 0.15) + 5;
    p.hp = Math.min(p.maxHp, p.hp + heal);
    this.log(`急救恢复 ${heal} HP`, 'heal');
    this._addDmgPopup(p, '+' + heal, 'heal');
    this._updateTBUI();
  }

  // ========== 回合制：AI平滑移动 ==========
  _updateTBAIMove(dt){
    const actor = this.tb.currentActor;
    if(!actor || !this._tbAIMovePath || this._tbAIMovePath.length === 0){
      this._tbAIMovePath = null;
      this._tbAITimer = 0.3;
      return;
    }
    const target = this._tbAIMovePath[0];
    // 安全检查：目标格是否被玩家或其他实体占据
    const p = this.player;
    if(Math.round(target.x) === Math.round(p.px) && Math.round(target.y) === Math.round(p.py)){
      // 目标是玩家位置，停止移动
      this._tbAIMovePath = null;
      actor.animState = 'idle';
      this._tbAITimer = 0.2;
      return;
    }
    const dx = target.x - actor.px;
    const dy = target.y - actor.py;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if(dist < 0.15){
      actor.px = target.x; actor.py = target.y;
      actor.x = Math.round(actor.px); actor.y = Math.round(actor.py);
      this._tbAIMovePath.shift();
      actor._tbMoved = (actor._tbMoved || 0) + 1;
      if(this._tbAIMovePath.length === 0){
        actor.animState = 'idle';
        this._tbAITimer = 0.3;
      }
    } else {
      const spd = MONSTER_MOVE_SPEED_BASE * 1.5 * (actor._effSpeed ? actor._effSpeed() : (actor.effectiveSpeed ? actor.effectiveSpeed() : 100)) / 100 * dt;
      actor.px += (dx/dist) * spd;
      actor.py += (dy/dist) * spd;
      actor.animState = 'walk';
      actor.animDir = { x: dx/dist, y: dy/dist };
      const sdx = actor.animDir.x - actor.animDir.y;
      if(Math.abs(sdx) > 0.15) actor.faceLeft = sdx > 0;
    }
  }

  // ========== 回合制：AI行动 ==========
  _updateTBAI(dt){
    const actor = this.tb.currentActor;
    if(!actor || !actor.alive){
      this.tb.nextTurn();
      return;
    }
    if(actor.isPlayer){
      this._tbAITimer = 999;
      return;
    }

    const p = this.player;
    const dx = p.px - actor.px;
    const dy = p.py - actor.py;
    const dist = Math.sqrt(dx*dx + dy*dy);

    // 冰冻/眩晕跳过
    if(actor.hasStatus && (actor.hasStatus('frozen') || actor.hasStatus('stun'))){
      this.log(`${actor.name} 被冰冻，跳过回合`, 'info');
      this.tb.nextTurn();
      this._tbAITimer = 0.5;
      return;
    }

    // 攻击范围内：攻击
    if(dist < 1.3){
      this._triggerAttackAnim(actor);
      actor.animDir = { x: dx, y: dy };
      const len = Math.sqrt(dx*dx + dy*dy);
      if(len > 0){ actor.animDir.x /= len; actor.animDir.y /= len; }
      const sdx = actor.animDir.x - actor.animDir.y;
      if(Math.abs(sdx) > 0.15) actor.faceLeft = sdx > 0;
      attack(actor, p, this.rng, (t,ty)=>{ this.log(t,ty); this._addDmgPopup(p, t, ty); this._triggerHitAnim(p); });
      if(!p.alive) this._onPlayerDeath();
      this.tb.nextTurn();
      this._tbAITimer = 0.6;
      return;
    }

    // 远程施法
    if(actor.spells && dist > 2 && dist <= 6){
      const spellIds = Object.keys(actor.spells).filter(s => actor.spells[s].stock > 0);
      if(spellIds.length && this.rng.chance(0.5)){
        const sid = this.rng.pick(spellIds);
        this._triggerAttackAnim(actor);
        castSpell(actor, sid, p, this.rng, (t,ty)=>this.log(t,ty), this.map);
        this.tb.nextTurn();
        this._tbAITimer = 0.6;
        return;
      }
    }

    // 移动靠近玩家（A*寻路 + 平滑移动）
    const moveRange = actor._tbMoveRange || getMoveRange(actor);
    const moveLeft = moveRange - (actor._tbMoved || 0);
    if(moveLeft > 0 && dist > 1.3){
      const targetX = Math.round(p.px);
      const targetY = Math.round(p.py);
      // A*寻路：玩家也作为阻挡物，怪物不会走到玩家格子上
      const blockers = this.map.entities.filter(e => e.alive && !e.isNPC && e !== actor);
      const path = findPath(this.map, Math.round(actor.px), Math.round(actor.py), targetX, targetY, blockers);
      if(path && path.length > 1){
        // 去掉起点；路径最后一个节点可能是玩家所在格，去掉它（停在玩家旁边）
        path.shift();
        // 检查路径终点是否是玩家位置，是则去掉
        while(path.length > 0){
          const last = path[path.length - 1];
          if(last.x === targetX && last.y === targetY) path.pop();
          else break;
        }
        const movePath = path.slice(0, moveLeft).map(n => ({x: n.x, y: n.y}));
        if(movePath.length > 0){
          this._tbAIMovePath = movePath;
          return; // 交给 _updateTBAIMove 处理平滑移动
        }
      }
      // A*失败，尝试直线方向（不走到玩家格子上）
      const tdx = dx / dist;
      const tdy = dy / dist;
      const nx = Math.round(actor.px + tdx);
      const ny = Math.round(actor.py + tdy);
      // 不走到玩家位置
      if(nx === targetX && ny === targetY){
        // 已经在玩家旁边，不需要移动
      } else if(this._isWalkableFloatForMonster(nx, ny, actor)){
        this._tbAIMovePath = [{x: nx, y: ny}];
        return;
      }
    }

    // 没有更多行动，结束回合
    actor.animState = 'idle';
    this.tb.nextTurn();
    this._tbAITimer = 0.5;
  }

  // ========== 回合制UI更新 ==========
  _updateTBUI(){
    const el = document.getElementById('tb-ui');
    if(!el) return;
    if(!this.tb.active){
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');

    const order = this.tb.getTurnOrder();
    let html = '<div class="tb-round">第 ' + this.tb.round + ' 回合</div>';
    html += '<div class="tb-order">';
    for(const item of order){
      const e = item.entity;
      // 只显示FOV可见的生物（玩家始终显示）
      if(!e.isPlayer){
        const ex = Math.round(e.px), ey = Math.round(e.py);
        if(!this.map.visible[ey] || !this.map.visible[ey][ex]) continue;
      }
      const cls = item.isCurrent ? 'tb-current' : '';
      const name = e.isPlayer ? '你' : e.name;
      const icon = e.isPlayer ? '⚔️' : (e.isNPC ? '🛡' : '👹');
      html += '<div class="tb-entry ' + cls + '">' + icon + ' ' + name + (item.isCurrent?' ◀':'') + '</div>';
    }
    html += '</div>';

    // 玩家行动点
    if(this.tb.isMyTurn(this.player)){
      const p = this.player;
      const ap = p._tbAction || 0;
      const bp = p._tbBonus || 0;
      const moved = p._tbMoved || 0;
      const range = p._tbMoveRange || 0;
      const dashing = p._tbDashing ? true : false;
      html += '<div class="tb-ap">';
      html += '<span class="' + (ap>0?'ap-active':'ap-spent') + '">⭐动作×'+ap+'</span>';
      html += '<span class="' + (bp>0?'ap-active':'ap-spent') + '">✦附赠×'+bp+'</span>';
      html += '<span class="ap-move">👟'+moved+'/'+range+(dashing?'⚡冲刺':'')+'</span>';
      html += '</div>';
      html += '<div class="tb-actions">';
      if(ap > 0){
        html += '<button id="tb-dash" class="tb-action-btn">冲刺 [R]</button>';
      }
      if(bp > 0 && p.hp < p.maxHp){
        html += '<button id="tb-quickheal" class="tb-action-btn">急救 [Q]</button>';
      }
      html += '<button id="tb-end-turn" class="tb-btn">结束回合 [空格]</button>';
      html += '</div>';
    }
    el.innerHTML = html;

    // 绑定按钮
    const btnEnd = document.getElementById('tb-end-turn');
    if(btnEnd) btnEnd.onclick = () => this._tbEndTurn();
    const btnDash = document.getElementById('tb-dash');
    if(btnDash) btnDash.onclick = () => this._tbDash();
    const btnHeal = document.getElementById('tb-quickheal');
    if(btnHeal) btnHeal.onclick = () => this._tbQuickHeal();
  }

  // ========== 回合制：点击移动 ==========
  _tbClickMove(gx, gy){
    if(!this.tb.isMyTurn(this.player)) return false;
    const p = this.player;
    // 检查是否在移动范围内
    const dist = Math.abs(gx - p.x) + Math.abs(gy - p.y);
    const moveLeft = (p._tbMoveRange || 0) - (p._tbMoved || 0);
    if(dist > moveLeft){
      this.log('移动距离不够！剩余 ' + moveLeft + ' 格', 'warn');
      return false;
    }
    // 寻路
    const path = findPath(this.map, p.x, p.y, gx, gy, this.map.entities.filter(e=>!e.isPlayer&&e.alive&&!e.isNPC));
    if(path && path.length > 1){
      // 去掉起点
      path.shift();
      // 限制路径长度
      if(path.length > moveLeft) path.length = moveLeft;
      this._tbMovePath = path.map(p => ({x: p.x, y: p.y}));
      return true;
    }
    // 直线移动
    this._tbMovePath = [{x: gx, y: gy}];
    return true;
  }

  // ========== NPC AI 更新 ==========
  _updateNPC(npc, dt){
    if(npc.attackCD > 0) npc.attackCD -= dt;
    if(npc.aiThinkCD > 0) npc.aiThinkCD -= dt;
    npc.animTime += dt;

    // 卫兵：检测附近敌对怪物
    if(npc.npcJob === 'guard'){
      let threat = null, minDist = 6;
      for(const e of this.map.entities){
        if(!e.alive || e.isPlayer || e.isNPC || e.faction === npc.faction) continue;
        const d = Math.sqrt((e.px-npc.px)**2 + (e.py-npc.py)**2);
        if(d < minDist){ minDist = d; threat = e; }
      }
      if(threat){
        npc._threat = threat;
        npc._alerted = true;
      }
    }

    // 非卫兵NPC：检测附近敌对怪物并逃跑
    if(npc.npcJob !== 'guard'){
      let threat = null, minDist = 4;
      for(const e of this.map.entities){
        if(!e.alive || e.isPlayer || e.isNPC) continue;
        const d = Math.sqrt((e.px-npc.px)**2 + (e.py-npc.py)**2);
        if(d < minDist){ minDist = d; threat = e; }
      }
      if(threat){
        npc._threat = threat;
        npc._fleeing = true;
      }
    }

    // 获取当前时间阶段的行为包
    const pkgName = getNPCPackage(npc, this.gs.hour);
    const pkg = AI_PACKAGES[pkgName];
    if(pkg){
      npc.currentPackage = pkgName;
      pkg.execute(this, npc, dt);
    }

    // 动画状态更新
    if(npc.animState === 'walk'){
      this._updateEntityAnim(npc, { dx: npc.animDir.x, dy: npc.animDir.y }, dt);
    } else {
      this._updateEntityAnim(npc, null, dt);
    }
  }

  // ========== NPC 交互 ==========
  _checkNPCInteraction(){
    if(this._interactingNPC) return;
    // 找最近的NPC
    let nearest = null, minDist = 1.5;
    for(const e of this.map.entities){
      if(!e.alive || !e.isNPC) continue;
      const d = Math.sqrt((e.px - this.player.px)**2 + (e.py - this.player.py)**2);
      if(d < minDist){ minDist = d; nearest = e; }
    }
    this._nearbyNPC = nearest;
  }

  _interactNPC(){
    if(!this._nearbyNPC) return;
    const npc = this._nearbyNPC;
    const dialogue = getNPCDialogue(npc, this.gs.hour, this.rng);
    const phase = getTimePhase(this.gs.hour);

    // 获取玩家与NPC的关系（如果有 RelationManager）
    let affinityLevel = '中立';
    let affinityValue = 0;
    if(this._relations){
      const rel = this._relations.get(npc.name);
      affinityLevel = this._relations.getAffinityLevel(npc.name);
      affinityValue = rel.affinity;
    }

    // 构建交互面板
    let html = `<div style="margin-bottom:8px;">`;
    html += `<div style="font-size:16px;font-weight:bold;color:${npc.color};">${npc.name}</div>`;
    html += `<div style="font-size:12px;color:#888;margin-bottom:4px;">${npc.npcType === 'merchant' ? '商人' : npc.npcType === 'guard' ? '卫兵' : npc.npcType === 'priest' ? '祭司' : npc.npcType === 'innkeeper' ? '旅店老板' : npc.npcType === 'adventurer' ? '冒险者' : '村民'} · ${phase.name}</div>`;
    // 关系显示
    const affinityColor = affinityValue >= 20 ? '#4a4' : affinityValue <= -20 ? '#a44' : '#888';
    html += `<div style="font-size:11px;color:${affinityColor};margin-bottom:8px;">关系: ${affinityLevel} (${affinityValue > 0 ? '+' : ''}${affinityValue})</div>`;
    html += `<div style="background:#1a1a2e;padding:8px;border-radius:4px;margin-bottom:8px;font-style:italic;">"${dialogue}"</div>`;

    // 话题按钮
    const topics = getNPCTopics(npc, this.gs.hour, this._relations ? this._relations.get(npc.name) : null);
    if(topics.length > 0){
      html += `<div style="margin-bottom:8px;font-size:12px;color:#aaa;">话题:</div>`;
      html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">`;
      for(const topicId of topics){
        const topic = DIALOGUE_TOPICS[topicId];
        if(topic){
          html += `<button class="npc-topic-btn" data-topic="${topicId}" style="padding:4px 8px;background:#2a2a3a;border:1px solid #444;border-radius:4px;color:#ccc;font-size:12px;cursor:pointer;">${topic.name}</button>`;
        }
      }
      html += `</div>`;
    }

    // 商人/旅店老板：交易按钮
    if(npc.shop && npc.shop.length > 0){
      html += `<div style="margin-bottom:8px;">`;
      for(const itemId of npc.shop){
        const item = ITEMS[itemId];
        if(!item) continue;
        const price = item.price || 5;
        html += `<div class="npc-shop-item" data-item="${itemId}" data-price="${price}" style="display:flex;justify-content:space-between;padding:4px 8px;border:1px solid #333;border-radius:4px;margin:2px 0;cursor:pointer;">`;
        html += `<span>${item.icon||''} ${item.name}</span><span style="color:#e0b34a;">${price}金</span></div>`;
      }
      html += `</div>`;
    }

    // 旅店老板：休息选项
    if(npc.npcType === 'innkeeper'){
      html += `<button id="npc-rest" style="width:100%;padding:6px;margin:4px 0;background:#3a5a3a;border:1px solid #5a8a5a;border-radius:4px;color:#cfc;cursor:pointer;">休息恢复（5金币）</button>`;
    }

    // 祭司：治疗选项
    if(npc.npcType === 'priest'){
      html += `<button id="npc-heal" style="width:100%;padding:6px;margin:4px 0;background:#3a3a5a;border:1px solid #5a5a8a;border-radius:4px;color:#ccf;cursor:pointer;">祈祷治疗（恢复满HP）</button>`;
    }

    html += `<button id="npc-close" style="width:100%;padding:6px;margin:4px 0;background:#333;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;">再见</button>`;
    html += `</div>`;

    this.ui.showPanel(`<h3 style="margin:0 0 8px;">与 ${npc.name} 交谈</h3>${html}`, ()=>{
      this._interactingNPC = null;
    });

    this._interactingNPC = npc;

    // 绑定按钮事件（延迟一帧让DOM渲染）
    setTimeout(()=>{
      // 话题按钮
      document.querySelectorAll('.npc-topic-btn').forEach(btn=>{
        btn.onclick = ()=>{
          const topicId = btn.dataset.topic;
          const response = getTopicResponse(topicId, npc, this.rng);
          if(response){
            // 显示对话回复
            const dialogBox = document.querySelector('.npc-panel div[style*="font-style:italic"]');
            if(dialogBox) dialogBox.textContent = `"${response}"`;
            // 增加好感度
            if(this._relations){
              this._relations.addAffinity(npc.name, 1, `谈论${DIALOGUE_TOPICS[topicId]?.name || ''}`);
            }
          }
        };
      });
      // 购买物品
      document.querySelectorAll('.npc-shop-item').forEach(el=>{
        el.onclick = ()=>{
          const itemId = el.dataset.item;
          const price = parseInt(el.dataset.price);
          if(this.player.gold >= price){
            this.player.gold -= price;
            const item = makeItem(itemId, 0, this.rng);
            this.player.inventory.push(item);
            this.log(`花了 ${price} 金币买了 ${ITEMS[itemId].name}`, 'good');
            this._updateHUD();
          } else {
            this.log('金币不够！', 'bad');
          }
        };
      });
      // 休息
      const restBtn = document.getElementById('npc-rest');
      if(restBtn) restBtn.onclick = ()=>{
        if(this.player.gold >= 5){
          this.player.gold -= 5;
          this.player.hp = this.player.maxHp;
          this.player.mp = this.player.maxMp;
          this.player.stamina = this.player.maxStamina;
          this.log('在旅店休息了一晚，精力充沛！', 'good');
          this.gs.hour = 8; this.gs.day++;
          this._updateHUD();
        } else {
          this.log('金币不够住店！', 'bad');
        }
      };
      // 治疗
      const healBtn = document.getElementById('npc-heal');
      if(healBtn) healBtn.onclick = ()=>{
        this.player.hp = this.player.maxHp;
        this.player.mp = this.player.maxMp;
        this.log('祭司为你祈祷，伤口完全愈合了。', 'good');
        this._updateHUD();
      };
      // 关闭
      const closeBtn = document.getElementById('npc-close');
      if(closeBtn) closeBtn.onclick = ()=>{
        this.ui.closePanel();
      };
    }, 50);
  }

  // ========== 玩家平滑移动 ==========
  _updatePlayerMovement(dt){
    const p = this.player;
    // 等距方向映射：屏幕WASD -> 网格方向
    let dx = 0, dy = 0;
    if(!this.debugMode){
      if(this.keys['w'] || this.keys['W'] || this.keys['ArrowUp']){ dx -= 1; dy -= 1; }
      if(this.keys['s'] || this.keys['S'] || this.keys['ArrowDown']){ dx += 1; dy += 1; }
      if(this.keys['a'] || this.keys['A'] || this.keys['ArrowLeft']){ dx -= 1; dy += 1; }
      if(this.keys['d'] || this.keys['D'] || this.keys['ArrowRight']){ dx += 1; dy -= 1; }
    } else {
      // debug模式：WASD移动，方向键留给offset调整
      if(this.keys['w'] || this.keys['W']){ dx -= 1; dy -= 1; }
      if(this.keys['s'] || this.keys['S']){ dx += 1; dy += 1; }
      if(this.keys['a'] || this.keys['A']){ dx -= 1; dy += 1; }
      if(this.keys['d'] || this.keys['D']){ dx += 1; dy -= 1; }
    }
    if(this.keys['q'] || this.keys['Q']){ dx -= 1; }
    if(this.keys['e'] || this.keys['E']){ dy -= 1; }
    if(this.keys['z'] || this.keys['Z']){ dy += 1; }
    if(this.keys['x'] || this.keys['X']){ dx += 1; }

    // 移动端摇杆输入
    if(this._joyActive && this._joyVec){
      const jx = this._joyVec.x, jy = this._joyVec.y;
      if(Math.abs(jx) > 0.1 || Math.abs(jy) > 0.1){
        // 屏幕方向 -> 等距网格方向
        // 上(jy<0)->W: dx-1,dy-1  下(jy>0)->S: dx+1,dy+1
        // 右(jx>0)->D: dx+1,dy-1  左(jx<0)->A: dx-1,dy+1
        dx = jx + jy;
        dy = -jx + jy;
      }
    }

    // 归一化
    const len = Math.sqrt(dx*dx + dy*dy);
    if(len > 0){ dx /= len; dy /= len; }

    // 如果有手动按键输入，取消自动寻路
    if(len > 0 && this._autoPath){
      this._cancelAutoPath();
    }

    // 如果没有手动输入且有自动寻路，沿路径移动
    if(len === 0 && this._autoPath){
      this._followAutoPath(dt);
      return;
    }

    const spd = PLAYER_MOVE_SPEED * (p.effectiveSpeed() / 100);
    const moveX = dx * spd * dt;
    const moveY = dy * spd * dt;

    // 分轴碰撞检测
    let newX = p.px + moveX;
    if(this._isWalkableFloat(newX, p.py)){ p.px = newX; }
    let newY = p.py + moveY;
    if(this._isWalkableFloat(p.px, newY)){ p.py = newY; }

    p.x = Math.round(p.px);
    p.y = Math.round(p.py);

    // 更新动画状态
    this._updateEntityAnim(p, len > 0 ? { dx, dy } : null, dt);

    if(len > 0){
      p.stamina -= 0.1 * dt;
      p.gainSkillXP && p.gainSkillXP('旅行', dt * 2);
    } else {
      p.stamina = Math.min(p.maxStamina, p.stamina + 1 * dt);
    }

    this._checkPickupAndStairs();
  }

  // ========== 自动寻路 ==========
  _startAutoPath(tx, ty){
    const p = this.player;
    const rawPath = findPath(this.map, p.px, p.py, tx, ty, {
      maxIter: 3000,
      allowDiagonal: true,
      entityCheck: (x, y) => {
        // 楼梯和物品不阻挡
        for(const m of this.map.entities){
          if(m.alive && m.x === x && m.y === y) return true;
        }
        return false;
      }
    });
    if(rawPath.length === 0){
      this.log('无法到达该位置', 'warn');
      return;
    }
    const path = smoothPath(rawPath);
    this._autoPath = { path, idx: 0, target: {x: tx, y: ty} };
    this.log(`自动寻路中…（${path.length} 步）`, 'info');
  }

  _followAutoPath(dt){
    const ap = this._autoPath;
    if(!ap || ap.idx >= ap.path.length){
      this._cancelAutoPath();
      return;
    }
    const p = this.player;
    const target = ap.path[ap.idx];
    const dx = target.x - p.px;
    const dy = target.y - p.py;
    const dist = Math.sqrt(dx*dx + dy*dy);

    // 到达当前路径点
    if(dist < 0.15){
      ap.idx++;
      if(ap.idx >= ap.path.length){
        this.log('已到达目标', 'info');
        this._cancelAutoPath();
        return;
      }
      return;
    }

    // 朝路径点移动
    const nx = dx / dist, ny = dy / dist;
    const spd = PLAYER_MOVE_SPEED * (p.effectiveSpeed() / 100) * dt;
    let newX = p.px + nx * spd;
    let newY = p.py + ny * spd;

    if(this._isWalkableFloat(newX, p.py)){ p.px = newX; }
    if(this._isWalkableFloat(p.px, newY)){ p.py = newY; }

    p.x = Math.round(p.px);
    p.y = Math.round(p.py);
    p.stamina -= 0.08 * dt;
    p.gainSkillXP && p.gainSkillXP('旅行', dt * 2);

    // 更新行走动画
    this._updateEntityAnim(p, { dx: nx, dy: ny }, dt);

    // 检测路径是否被阻挡（怪物挡路）
    const blocker = this.map.entities.find(e => e.alive && Math.round(e.px) === target.x && Math.round(e.py) === target.y);
    if(blocker){
      this.log('路径被阻挡，停止寻路', 'warn');
      this._cancelAutoPath();
    }

    this._checkPickupAndStairs();
  }

  _cancelAutoPath(){
    if(this._autoPath){
      this._autoPath = null;
    }
  }

  _checkPickupAndStairs(){
    const p = this.player;
    // 自动拾取金币
    if(this.ui.settings.autoPickup){
      const tileItem = this.map.itemAt(p.x, p.y);
      if(tileItem && tileItem.item.id === 'gold'){
        p.gold += tileItem.item.amount;
        this.log(`拾取 ${tileItem.item.amount} 金币`, 'info');
        this._removeMapItem(tileItem);
      }
    }
    // 楼梯提示
    const sp = this.map.specialAt(p.x, p.y);
    if(sp === 'stairs_dn' || sp === 'stairs_up'){
      if(!this._stairsNotified){
        this._stairsNotified = true;
        this.log(sp==='stairs_dn' ? '按 Enter 下楼' : '按 Enter 上楼', 'info');
      }
    } else {
      this._stairsNotified = false;
    }
    // NPC 交互提示
    if(this._nearbyNPC){
      if(!this._npcNotified){
        this._npcNotified = true;
        this.log(`按 T 与 ${this._nearbyNPC.name} 交谈`, 'info');
      }
    } else {
      this._npcNotified = false;
    }
  }

  // ========== 动画状态更新 ==========
  _updateEntityAnim(e, moveDir, dt){
    // 衰减计时器
    if(e.hitFlash > 0) e.hitFlash -= dt;
    if(e.attackAnim > 0) e.attackAnim -= dt * 3; // 攻击动画约0.33秒

    // 移动方向 -> 朝向
    if(moveDir && (moveDir.dx !== 0 || moveDir.dy !== 0)){
      const len = Math.sqrt(moveDir.dx*moveDir.dx + moveDir.dy*moveDir.dy);
      e.animDir = { x: moveDir.dx/len, y: moveDir.dy/len };
      // 等距视图屏幕水平方向：screenX ∝ (gx - gy)
      const screenDirX = e.animDir.x - e.animDir.y;
      if(Math.abs(screenDirX) > 0.15){
        e.faceLeft = screenDirX > 0;
      }
    }

    // 状态切换：攻击/受击优先
    if(e.attackAnim > 0){
      e.animState = 'attack';
    } else if(e.hitFlash > 0){
      e.animState = 'hit';
    } else if(moveDir){
      e.animState = 'walk';
    } else {
      e.animState = 'idle';
    }
    e.animTime += dt;
  }

  // 触发攻击动画
  _triggerAttackAnim(e){
    e.attackAnim = 1.0;
    e.animState = 'attack';
  }

  // NPC攻击怪物
  _npcAttack(npc, target){
    attack(npc, target, this.rng, (t,ty)=>{
      this.log(t, ty);
      this._addDmgPopup(target, t, ty);
      this._triggerHitAnim(target);
    });
  }

  // 触发受击动画
  _triggerHitAnim(e){
    e.hitFlash = 0.3;
    e.animState = 'hit';
  }

  // 浮点坐标碰撞检测（检查实体中心点所在格 + 边缘）
  _isWalkableFloat(fx, fy){
    const margin = 0.3;
    // 检查实体四角
    const corners = [
      [fx - margin, fy - margin],
      [fx + margin, fy - margin],
      [fx - margin, fy + margin],
      [fx + margin, fy + margin],
    ];
    for(const [cx, cy] of corners){
      const gx = Math.round(cx), gy = Math.round(cy);
      if(!this.map.isWalkable(gx, gy)) return false;
    }
    return true;
  }

  // ========== 玩家攻击 ==========
  _playerTryAttack(){
    const p = this.player;
    // 寻找前方/周围最近的敌人
    let bestTarget = null, bestDist = 1.5;
    for(const m of this.map.entities){
      if(!m.alive) continue;
      const dist = Math.sqrt((m.px - p.px)**2 + (m.py - p.py)**2);
      if(dist < bestDist){
        bestDist = dist;
        bestTarget = m;
      }
    }
    if(bestTarget){
      p.attackCD = ATTACK_COOLDOWN;
      this._triggerAttackAnim(p);
      p.animDir = { x: bestTarget.px - p.px, y: bestTarget.py - p.py };
      const dirLen = Math.sqrt(p.animDir.x**2 + p.animDir.y**2);
      if(dirLen > 0){ p.animDir.x /= dirLen; p.animDir.y /= dirLen; }
      const pScreenDirX = p.animDir.x - p.animDir.y;
      if(Math.abs(pScreenDirX) > 0.15){ p.faceLeft = pScreenDirX > 0; }
      attack(p, bestTarget, this.rng, (t,ty)=>{ this.log(t,ty); this._addDmgPopup(bestTarget, t, ty); this._triggerHitAnim(bestTarget); });
      // 攻击反冲
      p.vx = (p.px - bestTarget.px) * 2;
      p.vy = (p.py - bestTarget.py) * 2;
    }
  }

  // ========== 怪物实时 AI（智能行为）==========
  _updateMonster(m, dt){
    if(m.attackCD > 0) m.attackCD -= dt;
    if(m.aiThinkCD > 0) m.aiThinkCD -= dt;
    if(m.spellCD > 0) m.spellCD -= dt;

    // 冰冻/眩晕
    if(m.hasStatus('frozen') || m.hasStatus('stun')) return;

    const dx = this.player.px - m.px;
    const dy = this.player.py - m.py;
    const dist = Math.sqrt(dx*dx + dy*dy);

    // 视线检测
    const canSee = this.map.visible[Math.round(m.py)]?.[Math.round(m.px)] && dist <= (m.sightRange || 7);

    // ---- 仇恨记忆：看到玩家后记住仇恨 ----
    if(!m._aggroMemory) m._aggroMemory = {};
    if(!m._patrolOrigin) m._patrolOrigin = { x: m.x, y: m.y };
    if(!m._patrolTarget) m._patrolTarget = null;
    if(!m._fleeTimer) m._fleeTimer = 0;

    if(canSee){
      m._aggroMemory.lastSeen = { x: Math.round(this.player.px), y: Math.round(this.player.py), time: 0 };
      m._aggroMemory.aggro = true;
    } else if(m._aggroMemory.aggro){
      m._aggroMemory.time = (m._aggroMemory.time || 0) + dt;
      // 仇恨消退：10秒没看到玩家
      if(m._aggroMemory.time > 10){
        m._aggroMemory.aggro = false;
        m._aggroMemory.lastSeen = null;
        m._aggroMemory.time = 0;
      }
    }

    // ---- 低血量逃跑 ----
    const hpRatio = m.hp / m.maxHp;
    const fleeThreshold = m._fleeThreshold || 0.25;
    if(hpRatio < fleeThreshold && m.alive){
      // 胆小怪物逃跑
      const isCoward = m._cowardly || ['slime','rat','bat'].includes(m.monsterId);
      if(isCoward || m._cowardly){
        m._fleeTimer = 3; // 逃跑3秒
        m._cowardly = true;
      }
    }

    if(m._fleeTimer > 0){
      m._fleeTimer -= dt;
      this._monsterFlee(m, dt);
      return;
    }

    // ---- 攻击范围 ----
    if(dist < 1.3 && m.attackCD <= 0 && (canSee || m._aggroMemory.aggro)){
      m.attackCD = 1.2;
      this._triggerAttackAnim(m);
      m.animDir = { x: this.player.px - m.px, y: this.player.py - m.py };
      const mdirLen = Math.sqrt(m.animDir.x**2 + m.animDir.y**2);
      if(mdirLen > 0){ m.animDir.x /= mdirLen; m.animDir.y /= mdirLen; }
      const mScreenDirX = m.animDir.x - m.animDir.y;
      if(Math.abs(mScreenDirX) > 0.15){ m.faceLeft = mScreenDirX > 0; }
      attack(m, this.player, this.rng, (t,ty)=>{ this.log(t,ty); this._addDmgPopup(this.player, t, ty); this._triggerHitAnim(this.player); });
      if(!this.player.alive) this._onPlayerDeath();
      // ---- 呼叫援助：Boss/群体怪物被攻击时呼叫附近同伴 ----
      if(m.isBoss || m._callHelp){
        this._callForHelp(m, 4);
      }
      return;
    }

    // ---- 远程法术 ----
    if(m.spells && canSee && dist > 2 && dist <= 6 && m.spellCD <= 0){
      const spellIds = Object.keys(m.spells).filter(s=>m.spells[s].stock>0);
      if(spellIds.length && this.rng.chance(0.3)){
        const sid = this.rng.pick(spellIds);
        m.spellCD = 2.5;
        castSpell(m, sid, this.player, this.rng, (t,ty)=>this.log(t,ty), this.map);
        return;
      }
    }

    // ---- 移动决策 ----
    if(m._aggroMemory.aggro){
      // 仇恨状态：追击玩家或前往最后看到的位置
      let targetX, targetY;
      if(canSee){
        targetX = this.player.px;
        targetY = this.player.py;
      } else if(m._aggroMemory.lastSeen){
        targetX = m._aggroMemory.lastSeen.x;
        targetY = m._aggroMemory.lastSeen.y;
        // 到达最后看到的位置后放弃
        const lsDist = Math.abs(m.px - targetX) + Math.abs(m.py - targetY);
        if(lsDist < 0.5){
          m._aggroMemory.aggro = false;
          m._aggroMemory.lastSeen = null;
          return;
        }
      } else {
        m._aggroMemory.aggro = false;
        return;
      }

      const tdx = targetX - m.px;
      const tdy = targetY - m.py;
      const tdist = Math.sqrt(tdx*tdx + tdy*tdy);
      if(tdist > 0.1){
        const nx = tdx / tdist, ny = tdy / tdist;
        const spd = MONSTER_MOVE_SPEED_BASE * (m.effectiveSpeed() / 100) * dt;
        let newX = m.px + nx * spd;
        let newY = m.py + ny * spd;
        if(this._isWalkableFloatForMonster(newX, m.py, m)) m.px = newX;
        else if(this._isWalkableFloatForMonster(m.px, newY, m)) m.py = newY; // 尝试绕墙
        if(this._isWalkableFloatForMonster(m.px, newY, m)) m.py = newY;
        m.x = Math.round(m.px); m.y = Math.round(m.py);
      }
      // 仇恨追击中 -> 行走动画
      this._updateEntityAnim(m, { dx: tdx, dy: tdy }, dt);
    } else {
      // ---- 巡逻模式 ----
      this._monsterPatrol(m, dt);
      const ptx = m._patrolTarget ? m._patrolTarget.x - m.px : 0;
      const pty = m._patrolTarget ? m._patrolTarget.y - m.py : 0;
      this._updateEntityAnim(m, (Math.abs(ptx)+Math.abs(pty) > 0.1) ? { dx: ptx, dy: pty } : null, dt);
    }
  }

  // 怪物逃跑
  _monsterFlee(m, dt){
    const dx = m.px - this.player.px;
    const dy = m.py - this.player.py;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if(dist > 0.1){
      const nx = dx / dist, ny = dy / dist;
      const spd = MONSTER_MOVE_SPEED_BASE * 1.3 * (m.effectiveSpeed() / 100) * dt; // 逃跑更快
      let newX = m.px + nx * spd;
      let newY = m.py + ny * spd;
      if(this._isWalkableFloatForMonster(newX, m.py, m)) m.px = newX;
      if(this._isWalkableFloatForMonster(m.px, newY, m)) m.py = newY;
      m.x = Math.round(m.px); m.y = Math.round(m.py);
      this._updateEntityAnim(m, { dx: nx, dy: ny }, dt);
    }
  }

  // 怪物巡逻：在出生点附近游荡，偶尔走到房间其他位置
  _monsterPatrol(m, dt){
    if(m.aiThinkCD <= 0){
      m.aiThinkCD = 2 + this.rng.float() * 3;
      // 选择巡逻目标：在出生点 5 格范围内随机选一个可走位置
      const origin = m._patrolOrigin;
      for(let attempt = 0; attempt < 8; attempt++){
        const tx = origin.x + this.rng.int(-5, 5);
        const ty = origin.y + this.rng.int(-5, 5);
        if(this.map.isWalkable(tx, ty)){
          m._patrolTarget = { x: tx, y: ty };
          break;
        }
      }
      // 有时原地等待
      if(this.rng.chance(0.3)) m._patrolTarget = null;
    }

    if(m._patrolTarget){
      const tdx = m._patrolTarget.x - m.px;
      const tdy = m._patrolTarget.y - m.py;
      const tdist = Math.sqrt(tdx*tdx + tdy*tdy);
      if(tdist < 0.3){
        m._patrolTarget = null; // 到达，停下
      } else {
        const nx = tdx / tdist, ny = tdy / tdist;
        const spd = MONSTER_MOVE_SPEED_BASE * 0.5 * (m.effectiveSpeed() / 100) * dt;
        let newX = m.px + nx * spd;
        let newY = m.py + ny * spd;
        if(this._isWalkableFloatForMonster(newX, m.py, m)) m.px = newX;
        if(this._isWalkableFloatForMonster(m.px, newY, m)) m.py = newY;
        m.x = Math.round(m.px); m.y = Math.round(m.py);
      }
    }
  }

  // 呼叫援助：让附近的同伴进入仇恨状态
  _callForHelp(caller, radius){
    for(const m of this.map.entities){
      if(m === caller || !m.alive) continue;
      const dist = Math.sqrt((m.px - caller.px)**2 + (m.py - caller.py)**2);
      if(dist <= radius && !m._aggroMemory?.aggro){
        if(!m._aggroMemory) m._aggroMemory = {};
        m._aggroMemory.aggro = true;
        m._aggroMemory.lastSeen = { x: Math.round(this.player.px), y: Math.round(this.player.py), time: 0 };
      }
    }
  }

  _isWalkableFloatForMonster(fx, fy, self){
    const margin = 0.3;
    const corners = [
      [fx - margin, fy - margin],
      [fx + margin, fy - margin],
      [fx - margin, fy + margin],
      [fx + margin, fy + margin],
    ];
    for(const [cx, cy] of corners){
      const gx = Math.round(cx), gy = Math.round(cy);
      if(!this.map.isWalkable(gx, gy)) return false;
      // 不撞玩家
      if(this.player.alive && Math.round(this.player.px) === gx && Math.round(this.player.py) === gy) return false;
      // 不撞其他怪物
      for(const m of this.map.entities){
        if(m === self || !m.alive) continue;
        if(Math.round(m.px) === gx && Math.round(m.py) === gy) return false;
      }
    }
    return true;
  }

  // ========== 浮动伤害数字 ==========
  _addDmgPopup(entity, text, type){
    const colors = { dmg:'#ff4444', heal:'#44ff44', info:'#ffffff', warn:'#ffaa00' };
    this.dmgPopups.push({
      px: entity.px, py: entity.py,
      text: text, color: colors[type] || '#fff',
      life: 1.0, vy: -30,
    });
  }

  _updatePopups(dt){
    for(let i = this.dmgPopups.length - 1; i >= 0; i--){
      const p = this.dmgPopups[i];
      p.life -= dt;
      p.py -= dt * 1.5;
      if(p.life <= 0) this.dmgPopups.splice(i, 1);
    }
  }

  _handleDrops(){
    const toRemove = [];
    for(const e of this.map.entities){
      if(!e.alive){
        if(e._drops){
          for(const d of e._drops){
            let item = d.item;
            if(item.id && !ITEMS[item.id] && item.id!=='gold'){
              item = makeItem(item.id, this.map.depth, this.rng);
            }
            this.map.items.push({x:e.x, y:e.y, item});
          }
        }
        toRemove.push(e);
      }
    }
    for(const e of toRemove){
      const i = this.map.entities.indexOf(e);
      if(i>=0) this.map.entities.splice(i,1);
    }
  }

  // ========== 楼梯/拾取/使用 ==========
  useStairs(){
    if(!this.player || !this.player.alive) return;
    const sp = this.map.specialAt(this.player.x, this.player.y);
    if(!sp || (sp !== 'stairs_dn' && sp !== 'stairs_up')){
      this.log('这里没有楼梯', 'info');
      return;
    }

    // 保存当前位置（返回大地图时用）
    // 只在大地图上进入其他区域时保存位置
    if(this.map && this.map.isWorld){
      this._lastRegionPos = { x: this.player.x, y: this.player.y };
    }

    if(sp === 'stairs_dn'){
      // 下楼梯
      if(this.currentZone && this.currentZone.isTown){
        // 在城镇里 → 进入地下城（城镇不应该有楼梯dn，这里是兼容）
        this.log('城镇里没有地下城入口', 'info');
        return;
      } else if(this.currentZone && this.currentZone.isDungeon){
        // 在地下城里 → 继续深入
        const depth = (this.currentZone.lv ? Math.abs(this.currentZone.lv) : 1) + 1;
        this.enterDungeon(this.currentZone.parent || this.currentZone, depth);
      } else if(this.map.isWorld){
        // 在大地图上 → 检查是否有城镇/地下城
        const site = this._getSiteAtPlayer();
        if(site){
          if(site.isTown){
            this.enterTown(site);
          } else if(site.isDungeon){
            this.enterDungeon(site, 1);
          } else {
            this.enterField(site);
          }
        } else {
          this.log('这里没有入口', 'info');
        }
      } else {
        this.log('这里没有楼梯', 'info');
      }
    } else if(sp === 'stairs_up'){
      // 上楼梯
      if(this.currentZone && this.currentZone.isDungeon){
        // 在地下城里 → 返回上一层
        const depth = Math.abs(this.currentZone.lv || 0);
        if(depth <= 1){
          // 返回大地图
          this.returnToRegion();
        } else {
          // 返回上一层：在父zone中找 depth-1 的子zone
          this.enterDungeon(this.currentZone.parent, depth - 1);
        }
      } else if(this.currentZone && this.currentZone.isTown){
        // 在城镇里 → 返回大地图
        this.returnToRegion();
      } else if(this.currentZone && this.currentZone.isField){
        // 在野外 → 返回大地图
        this.returnToRegion();
      } else {
        this.log('已经是地面了', 'info');
      }
    }
  }

  // 获取玩家所在位置的地点
  _getSiteAtPlayer(){
    if(!this.region || !this.map) return null;
    const px = this.player.x, py = this.player.y;
    // 计算在大地图上的坐标
    const mapW = this.map.w, mapH = this.map.h;
    const regionW = this.region.regionW, regionH = this.region.regionH;
    const gx = Math.floor(regionW / 2 - mapW / 2 + px);
    const gy = Math.floor(regionH / 2 - mapH / 2 + py);
    // 检查附近是否有地点
    for(const site of this.region.sites){
      const d = Math.abs(site.x - gx) + Math.abs(site.y - gy);
      if(d <= 3) return site;
    }
    return null;
  }

  playerPickup(){
    if(!this.player || !this.player.alive) return;
    const it = this.map.itemAt(this.player.x, this.player.y);
    if(!it){ this.log('这里没有物品', 'info'); return; }
    if(it.item.type === 'container' || it.item.id === 'chest'){
      this._openChest(it); return;
    }
    this._addItemToInventory(it.item);
    this._removeMapItem(it);
    this.log(`拾取了 ${itemName(it.item)}`, 'info');
  }

  _openChest(chestEntry){
    if(chestEntry.item.locked){
      const sk = this.player.skills['开锁'];
      const lvl = sk?sk.level:0;
      if(this.rng.chance(0.3 + lvl*0.1)){
        this.log('成功开锁！', 'info');
        chestEntry.item.locked = false;
      } else {
        this.log('锁太紧了…', 'warn'); return;
      }
    }
    const depth = Math.max(1, this.map.depth);
    const nItems = this.rng.int(1, 3);
    for(let i=0;i<nItems;i++){
      const lootPool = ['potion_heal','potion_heal_l','sword','longsword','leather_armor','shield','robe','cloak','arrow','bullet','ration','ore','herb','platinum'];
      const id = this.rng.pick(lootPool);
      const item = makeItem(id, depth+2, this.rng);
      this._addItemToInventory(item);
      this.log(`宝箱中发现：${itemName(item)}！`, 'info');
    }
    const gold = this.rng.int(20+depth*5, 60+depth*15);
    this.player.gold += gold;
    this.log(`还有 ${gold} 金币`, 'info');
    this._removeMapItem(chestEntry);
  }

  _addItemToInventory(item){
    if(item.stack || item.type==='ammo' || item.type==='currency' || item.type==='material'){
      const existing = this.player.inventory.find(it=>it.id===item.id);
      if(existing){ existing._count = (existing._count||1) + 1; return; }
    }
    item._count = item._count || 1;
    this.player.inventory.push(item);
  }

  _removeMapItem(it){
    const i = this.map.items.indexOf(it);
    if(i>=0) this.map.items.splice(i,1);
  }

  // ========== 使用物品 ==========
  useItem(item){
    if(item.type === 'food'){
      const food = item.food * (1 + (this.player.foodBonus||0));
      this.player.food = Math.min(100, this.player.food + food);
      this.log(`食用了 ${itemName(item)}，恢复 ${Math.floor(food)} 饱食度`, 'heal');
      if(this.player.food < 40 && item.attr){
        this.log(`${item.attr} 提升了！`, 'info');
        this.player.attrs[item.attr] = (this.player.attrs[item.attr]||0) + 1;
        this.player.recalcStats();
      }
      this._consumeItem(item);
    } else if(item.type === 'potion'){
      if(item.use === 'heal'){
        const heal = rollDice(item.power, this.rng);
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
        this.log(`恢复了 ${heal} HP`, 'heal');
      } else if(item.use === 'cure'){
        this.player.statusEffects = this.player.statusEffects.filter(s=>!['poison','bleed','burn'].includes(s.id));
        this.log('状态异常被治愈了', 'heal');
      }
      this._consumeItem(item);
    } else if(item.type === 'tool' && item.id === 'torch'){
      this.log('点燃了火把，视野扩大', 'info');
      this.player.addStatus('light', '照明', 50, 1, null, false);
    }
    this.ui.showInventory(this.player, this._invActions());
    this._updateHUD();
  }

  _consumeItem(item){
    item._count = (item._count||1) - 1;
    if(item._count <= 0){
      const i = this.player.inventory.indexOf(item);
      if(i>=0) this.player.inventory.splice(i,1);
    }
  }

  equipItem(item){
    const ok = equip(this.player, item);
    if(ok) this.log(`装备了 ${itemName(item)}`, 'info');
    else this.log('无法装备此物品', 'warn');
    this.ui.showInventory(this.player, this._invActions());
    this._updateHUD();
  }

  unequipItem(slot){
    const it = unequip(this.player, slot);
    if(it) this.log(`卸下了 ${itemName(it)}`, 'info');
    this.ui.showInventory(this.player, this._invActions());
    this._updateHUD();
  }

  dropItem(item){
    const i = this.player.inventory.indexOf(item);
    if(i<0) return;
    this.player.inventory.splice(i,1);
    this.map.items.push({x:this.player.x, y:this.player.y, item});
    this.log(`丢弃了 ${itemName(item)}`, 'info');
    this.ui.showInventory(this.player, this._invActions());
  }

  _invActions(){
    return {
      equip: (it)=>this.equipItem(it),
      use: (it)=>this.useItem(it),
      drop: (it)=>this.dropItem(it),
      unequip: (slot)=>this.unequipItem(slot),
    };
  }

  // ========== 法术 ==========
  tryCastSpell(sid){
    const spell = SPELLS[sid];
    if(!spell) return;
    if(this.player.spellCD > 0) return;
    if(spell.heal){
      castSpell(this.player, sid, this.player, this.rng, (t,ty)=>{this.log(t,ty);}, this.map);
      this.player.spellCD = 1.0;
    } else {
      this.targetMode = {type:'spell', sid, range: spell.range};
      this.log(`选择 ${spell.name} 的目标（点击敌人，Esc 取消）`, 'info');
    }
  }

  castAtTarget(tx, ty){
    if(!this.targetMode) return;
    if(this.targetMode.type === 'spell'){
      const spell = SPELLS[this.targetMode.sid];
      const dist = Math.abs(tx-this.player.x)+Math.abs(ty-this.player.y);
      if(dist > spell.range){ this.log('超出射程', 'warn'); return; }
      const target = this.map.entityAt(tx, ty);
      castSpell(this.player, this.targetMode.sid, target, this.rng, (t,ty)=>this.log(t,ty), this.map);
      this.targetMode = null;
      this.player.spellCD = 1.0;
    }
  }

  // ========== 祭坛/祈祷 ==========
  prayAtAltar(){
    if(!this.player || !this.player.alive) return;
    const altar = this.map.specialAt(this.player.x, this.player.y);
    if(altar !== 'altar'){ this.log('这里没有祭坛', 'info'); return; }
    if(!this.player.faith){
      const godIds = Object.keys(GODS);
      let html = `<button class="btn-close" onclick="document.getElementById('panel-overlay').classList.add('hidden')">关闭</button>`;
      html += `<h2>选择你的守护神</h2><div class="inv-grid">`;
      for(const gid of godIds){
        const g = GODS[gid];
        html += `<div class="inv-item" style="flex-direction:column;align-items:flex-start" data-god="${gid}">
          <div class="ii-name" style="color:${g.color}">${g.name}</div>
          <div class="ii-sub">领域：${g.domain}</div>
          <div class="ii-sub">加成：${g.bonus}</div>
          <div class="ii-sub">祭品：${g.gift}</div>
        </div>`;
      }
      html += `</div>`;
      this.ui.showPanel(html);
      document.getElementById('panel-content').querySelectorAll('[data-god]').forEach(n=>{
        n.onclick = ()=>{
          this.player.faith = n.dataset.god;
          this.player.piety = 0;
          this.log(`你成为了 ${GODS[n.dataset.god].name} 的信徒`, 'info');
          this.ui.hidePanel();
        };
      });
      return;
    }
    const cost = 50;
    if(this.player.gold < cost){ this.log('金币不足以献祭', 'warn'); return; }
    this.player.gold -= cost;
    this.player.piety += 10;
    this.log(`向 ${GODS[this.player.faith].name} 祈祷，虔诚度 +10`, 'info');
    if(this.player.piety >= 100 && !this.player._gotReward){
      this.player._gotReward = true;
      this.log('神明降下恩赐！获得白金币', 'info');
      this._addItemToInventory(makeItem('platinum', 0, this.rng));
    }
  }

  // ========== 死亡 ==========
  _onPlayerDeath(){
    this.player.deaths = (this.player.deaths||0)+1;
    this.ui.showGameOver(this.player,
      ()=>{ this._respawn(); },
      ()=>{ location.reload(); }
    );
  }

  _respawn(){
    this.ui.hideGameOver();
    this.player.alive = true;
    this.player.hp = Math.floor(this.player.maxHp * 0.5);
    this.player.mp = Math.floor(this.player.maxMp * 0.5);
    this.player.food = 50;
    this.player.stamina = 50;
    this.player.xp = Math.floor(this.player.xp * 0.9);
    this.player.gold = Math.floor(this.player.gold * 0.9);
    this.player.statusEffects = [];
    this.enterRegion();
  }

  // ========== 渲染 ==========
  _render(){
    const r = this.renderer;
    r.clear();
    r.applyCam();
    if(!this.map){ r.restore(); return; }

    // 建造模式迷雾覆盖：显示未探索时临时将 visible/explored 置为全 true（渲染后还原）
    const _savedVis = this.map.visible, _savedExp = this.map.explored;
    if(this.fogReveal){
      if(!this._allTrueCache || this._allTrueCache.length !== this.map.h || this._allTrueCache[0].length !== this.map.w){
        const a = [];
        for(let y = 0; y < this.map.h; y++){ const row = []; for(let x = 0; x < this.map.w; x++) row.push(true); a.push(row); }
        this._allTrueCache = a;
      }
      this.map.explored = this._allTrueCache;
      this.map.visible = this._allTrueCache;
    }

    const cam = r.cam;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const center = screenToGrid(w/2, h/2, cam, w, h);
    const rad = Math.ceil(Math.max(w,h) / (TILE_W * cam.zoom)) + 4;

    // 辅助：检查某格是否有实体方块（墙）
    const isWallAt = (x, y) => {
      if(x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return false;
      return this.map.hasSolidBlocks(x, y);
    };
    // 辅助：获取地板纹理类型（用于判断同种地板）
    const getFloorTex = (x, y) => {
      if(x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return null;
      const tid = this.map.tileId(x, y);
      return MAT.floor[tid] ? tid : null;
    };
    const halfW = (w/2)/cam.zoom + TILE_W, halfH=(h/2)/cam.zoom + TILE_H*2;
    const inView = (sx, sy) => sx >= cam.x-halfW && sx <= cam.x+halfW && sy >= cam.y-halfH && sy <= cam.y+halfH;

    // 调试偏移传递给渲染器
    r._debugSrcOff = this.debugMode ? this.debugSrcOff : null;
    r._debugDrawOff = this.debugMode ? this.debugDrawOff : null;

    // ===== 第一趟：绘制所有地板瓦片（地面层，始终在最底层）=====
    const hw = TILE_W/2, hh = TILE_H/2;
    for(let gy = Math.max(0, center.y-rad); gy < Math.min(this.map.h, center.y+rad); gy++){
      for(let gx = Math.max(0, center.x-rad); gx < Math.min(this.map.w, center.x+rad); gx++){
        const tid = this.map.tileId(gx, gy);
        const m = MAT.floor[tid];
        if(!m) continue;
        const vis = this.map.visible[gy][gx];
        const exp = this.map.explored[gy][gx];
        if(!exp) continue;
        if(this.debugMode && this.debugHideOthers && this.debugTile && (gx!==this.debugTile.x || gy!==this.debugTile.y)) continue;
        const screenP = gridToScreen(gx, gy);
        if(!inView(screenP.x, screenP.y)) continue;
        const hover = this.hoverTile && this.hoverTile.x===gx && this.hoverTile.y===gy;
        const drawn = r.drawFloorAtlas(gx, gy, tid, vis, exp, hover);
        if(!drawn){
          r.drawTileFloor(gx, gy, tid, vis, exp, hover);
        }
        // 特殊瓦片覆盖（楼梯/门/祭坛/宝箱）
        const sp = this.map.specialAt(gx, gy);
        if(sp){
          r.drawSpecialTile(gx, gy, sp, vis, exp, hover);
        }
      }
    }

    // 战争迷雾颜色常量（供地板迷雾和方块/物品迷雾共用）
    const FOG_R=10, FOG_G=12, FOG_B=20;

    // ===== 战争迷雾（地板之后、方块/实体之前绘制，确保墙体在雾之上）=====
    // 改进: 平滑衰减、边缘渐变过渡、多光源支持、高度遮挡
    {
      const gmMinY = Math.max(0, center.y-rad), gmMaxY = Math.min(this.map.h, center.y+rad);
      const gmMinX = Math.max(0, center.x-rad), gmMaxX = Math.min(this.map.w, center.x+rad);
      const sight = this.map.sight || 12;

      // 收集光源: 玩家 + 带light状态的实体 + 火把装饰物
      const lights = [];
      lights.push({ x: this.player.px, y: this.player.py, radius: sight, intensity: 1.0 });
      // 带照明状态的实体
      for(const e of this.map.entities){
        if(!e.alive) continue;
        if(e.hasStatus && e.hasStatus('light')){
          lights.push({ x: e.px, y: e.py, radius: sight * 0.8, intensity: 0.8 });
        }
      }

      // Smoothstep: 平滑step函数
      const smoothstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
      const smootherstep = (t) => { t = Math.max(0, Math.min(1, t)); return t*t*t*(t*(t*6-15)+10); };

      // 计算某格的综合光照值 (0=完全照亮, 1=完全黑暗)
      const fogGradientOn = this.ui.settings.fogGradient;
      this._computeFogAlpha = (gx, gy) => {
        // 建造模式：去除迷雾 / 显示未探索 → 完全照亮
        if(this.fogNoFog || this.fogReveal) return 0;
        // 已探索但不在视野内: 已探索迷雾
        if(!this.map.visible[gy] || !this.map.visible[gy][gx]){
          if(!fogGradientOn) return 0.62;
          // 边缘软化: 检查周围是否有可见格，有则渐变过渡
          let neighborVis = 0;
          for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
            const nx=gx+dx, ny=gy+dy;
            if(ny>=0 && ny<this.map.h && nx>=0 && nx<this.map.w && this.map.visible[ny][nx]){
              neighborVis++;
            }
          }
          if(neighborVis > 0){
            return 0.35 + (0.6 - 0.35) * (1 - neighborVis/4);
          }
          return 0.62;
        }

        let minFog = 1.0;
        for(const light of lights){
          const dx = gx - light.x, dy = gy - light.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const ratio = dist / light.radius;

          let fog;
          if(!fogGradientOn){
            // 无渐变: 视野内完全照亮
            fog = ratio < 1.0 ? 0 : 1.0;
          } else {
            if(ratio < 0.35){
              fog = 0;
            } else if(ratio < 0.8){
              fog = smootherstep((ratio - 0.35) / 0.45) * 0.85;
            } else if(ratio < 1.0){
              fog = 0.85 + smootherstep((ratio - 0.8) / 0.2) * 0.15;
            } else {
              fog = 1.0;
            }
          }

          const effectiveIntensity = light.intensity * Math.max(0, 1 - ratio * 0.3);
          fog = fog * (1 - effectiveIntensity * 0.3);
          minFog = Math.min(minFog, fog);
        }

        // 高度遮挡阴影
        const pGx = Math.round(this.player.px), pGy = Math.round(this.player.py);
        const b = this.map.blocks[gy]?.[gx];
        const stackH = b ? b.length : 0;
        if(stackH >= 2){
          const distToPlayer = Math.sqrt((gx-pGx)**2 + (gy-pGy)**2);
          if(distToPlayer > 2){
            const shadowAlpha = Math.min(0.15, stackH * 0.05);
            minFog = Math.min(1.0, minFog + shadowAlpha);
          }
        }

        return Math.max(0, Math.min(1, minFog));
      };

      r.ctx.save();
      for(let gy = gmMinY; gy < gmMaxY; gy++){
        for(let gx = gmMinX; gx < gmMaxX; gx++){
          if(!this.map.explored[gy][gx]) continue;
          const sp = gridToScreen(gx, gy);
          if(!inView(sp.x, sp.y)) continue;

          const fogAlpha = this._computeFogAlpha(gx, gy);
          if(fogAlpha > 0.01){
            r.ctx.globalAlpha = fogAlpha;
            r.ctx.fillStyle = `rgb(${FOG_R},${FOG_G},${FOG_B})`;
            r.ctx.beginPath();
            r.ctx.moveTo(sp.x, sp.y - TILE_H/2);
            r.ctx.lineTo(sp.x + TILE_W/2, sp.y);
            r.ctx.lineTo(sp.x, sp.y + TILE_H/2);
            r.ctx.lineTo(sp.x - TILE_W/2, sp.y);
            r.ctx.closePath();
            r.ctx.fill();
          }
        }
      }
      r.ctx.globalAlpha = 1;
      r.ctx.restore();
    }

    // ===== 回合制移动范围高亮 =====
    if(this.tb.active && this._tbHighlightTiles.length > 0){
      const ctx = this.renderer.ctx;
      for(const t of this._tbHighlightTiles){
        if(!this.map.visible[t.y] || !this.map.visible[t.y][t.x]) continue;
        const sp = gridToScreen(t.x, t.y);
        const pulse = 0.3 + Math.sin(this.renderer.time * 4) * 0.1;
        ctx.fillStyle = `rgba(80, 180, 255, ${pulse})`;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - TILE_H/2);
        ctx.lineTo(sp.x + TILE_W/2, sp.y);
        ctx.lineTo(sp.x, sp.y + TILE_H/2);
        ctx.lineTo(sp.x - TILE_W/2, sp.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(120, 200, 255, 0.6)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // ===== 第二趟：收集方块（墙体）、物品、实体，按深度排序后绘制 =====
    const drawList = [];

    // 方块（墙体，支持多高度堆叠）
    for(let gy = Math.max(0, center.y-rad); gy < Math.min(this.map.h, center.y+rad); gy++){
      for(let gx = Math.max(0, center.x-rad); gx < Math.min(this.map.w, center.x+rad); gx++){
        const blocks = this.map.getBlocks(gx, gy);
        if(!blocks || blocks.length === 0) continue;
        const vis = this.map.visible[gy][gx];
        const exp = this.map.explored[gy][gx];
        if(!exp) continue;
        const screenP = gridToScreen(gx, gy);
        if(!inView(screenP.x, screenP.y)) continue;
        const hover = this.hoverTile && this.hoverTile.x===gx && this.hoverTile.y===gy;
        drawList.push({type:'block', gx, gy, blocks, vis, exp, hover, depth: gx+gy, sortPri: 2});
      }
    }

    // 地面物品
    for(const it of this.map.items){
      if(!this.map.visible[it.y]?.[it.x] && !this.map.explored[it.y]?.[it.x]) continue;
      if(this.map.visible[it.y]?.[it.x]){
        drawList.push({type:'item', x:it.x, y:it.y, item:it.item, depth: it.x + it.y, sortPri: 0});
      }
    }

    // 实体（无深度偏移，两趟渲染确保地板不会覆盖角色）
    for(const e of this.map.entities){
      if(!e.alive) continue;
      if(!this.map.visible[Math.round(e.py)]?.[Math.round(e.px)]) continue;
      drawList.push({type:'entity', entity:e, depth: e.px + e.py, sortPri: 1});
    }
    drawList.push({type:'entity', entity:this.player, depth: this.player.px + this.player.py, sortPri: 1, isPlayer:true});

    // 装饰物（地面装饰 sortPri=0 与物品同级，墙面装饰 sortPri=2.5 在墙体之后）
    if(this.map._decorGrid){
      for(let gy = Math.max(0, center.y-rad); gy < Math.min(this.map.h, center.y+rad); gy++){
        for(let gx = Math.max(0, center.x-rad); gx < Math.min(this.map.w, center.x+rad); gx++){
          if(!this.map.explored[gy][gx]) continue;
          const decors = this.map._decorGrid[gx + ',' + gy];
          if(!decors) continue;
          const vis = this.map.visible[gy][gx];
          for(const d of decors){
            const isWallDecor = !!d.face;
            drawList.push({type:'decor', decor:d, depth: d.x + d.y, sortPri: isWallDecor ? 2.5 : 0, vis});
          }
        }
      }
    }

    // 深度排序：depth(gx+gy / px+py) 从小到大（从后到前），同 depth 时 sortPri（物品<实体<墙体）
    drawList.sort((a,b)=> a.depth - b.depth || a.sortPri - b.sortPri);

    // 调试模式：隐藏非选中格子的方块/物品/装饰
    const debugFilter = (this.debugMode && this.debugHideOthers && this.debugTile);
    const dkx = debugFilter ? this.debugTile.x : -1, dky = debugFilter ? this.debugTile.y : -1;

    for(const d of drawList){
      // 调试隐藏模式：跳过非选中格子的元素
      if(debugFilter){
        if(d.type==='block' && (d.gx!==dkx || d.gy!==dky)) continue;
        if(d.type==='decor' && (Math.round(d.decor.x)!==dkx || Math.round(d.decor.y)!==dky)) continue;
        if(d.type==='item' && (d.x!==dkx || d.y!==dky)) continue;
        // 实体不隐藏（方便观察）
      }
      if(d.type === 'block'){
        r.drawBlockStack(d.gx, d.gy, d.blocks, d.vis, d.exp, d.hover);
        if(this._computeFogAlpha){
          const fogA = this._computeFogAlpha(d.gx, d.gy);
          if(fogA > 0.02){
            const bp = gridToScreen(d.gx, d.gy);
            const accumH = this.map.blockHeightAt(d.gx, d.gy) * WALL_H;
            const hw = TILE_W / 2, hh = TILE_H / 2;
            r.ctx.save();
            r.ctx.globalAlpha = fogA;
            r.ctx.fillStyle = `rgb(${FOG_R},${FOG_G},${FOG_B})`;
            // 邻接剔除：判断相邻方块高度，跳过不可见面（仅已探索邻格参与剔除）
            const curH = this.map.blockHeightAt(d.gx, d.gy);
            const nbSExplored = this.map.explored[d.gy + 1]?.[d.gx];
            const nbEExplored = this.map.explored[d.gy]?.[d.gx + 1];
            const nbS = nbSExplored ? this.map.blockHeightAt(d.gx, d.gy + 1) : 0;
            const nbE = nbEExplored ? this.map.blockHeightAt(d.gx + 1, d.gy) : 0;
            const showLeft = nbS < curH;
            const showRight = nbE < curH;
            // 顶面菱形（始终绘制）
            r.ctx.beginPath();
            r.ctx.moveTo(bp.x, bp.y - accumH - hh);
            r.ctx.lineTo(bp.x + hw, bp.y - accumH);
            r.ctx.lineTo(bp.x, bp.y - accumH + hh);
            r.ctx.lineTo(bp.x - hw, bp.y - accumH);
            r.ctx.closePath();
            r.ctx.fill();
            // 左侧面（西南面）
            if(showLeft){
              r.ctx.beginPath();
              r.ctx.moveTo(bp.x - hw, bp.y - accumH);
              r.ctx.lineTo(bp.x, bp.y - accumH + hh);
              r.ctx.lineTo(bp.x, bp.y + hh);
              r.ctx.lineTo(bp.x - hw, bp.y);
              r.ctx.closePath();
              r.ctx.fill();
            }
            // 右侧面（东南面）
            if(showRight){
              r.ctx.beginPath();
              r.ctx.moveTo(bp.x, bp.y - accumH + hh);
              r.ctx.lineTo(bp.x + hw, bp.y - accumH);
              r.ctx.lineTo(bp.x + hw, bp.y);
              r.ctx.lineTo(bp.x, bp.y + hh);
              r.ctx.closePath();
              r.ctx.fill();
            }
            r.ctx.restore();
          }
        }
      } else if(d.type === 'decor'){
        // 不可见（仅已探索）的装饰物降低透明度
        if(!d.vis){
          r.ctx.save();
          r.ctx.globalAlpha = 0.4;
          r.drawDecoration(d.decor);
          r.ctx.restore();
        } else {
          r.drawDecoration(d.decor);
        }
      } else if(d.type === 'item'){
        const icon = d.item.icon || '❓';
        const color = d.item.type==='currency' ? '#e0b34a' : d.item.type==='weapon' ? '#c9a23a' : '#7fd1c4';
        r.drawItem(d.x, d.y, icon, color);
        // 物品迷雾覆盖
        if(this._computeFogAlpha){
          const fogA = this._computeFogAlpha(d.x, d.y);
          if(fogA > 0.02){
            const ip = gridToScreen(d.x, d.y);
            r.ctx.save();
            r.ctx.globalAlpha = fogA;
            r.ctx.fillStyle = `rgb(${FOG_R},${FOG_G},${FOG_B})`;
            r.ctx.beginPath();
            r.ctx.moveTo(ip.x, ip.y - TILE_H/2);
            r.ctx.lineTo(ip.x + TILE_W/2, ip.y);
            r.ctx.lineTo(ip.x, ip.y + TILE_H/2);
            r.ctx.lineTo(ip.x - TILE_W/2, ip.y);
            r.ctx.closePath();
            r.ctx.fill();
            r.ctx.restore();
          }
        }
      } else if(d.type === 'entity'){
        const e = d.entity;
        const floatBob = e.floats ? Math.sin(r.time*3)*3 : 0;
        r.drawEntityFloat(e.px, e.py, {
          color: e.color,
          name: e.isPlayer ? '' : e.name + (e.isBoss?' [Boss]':''),
          isPlayer: e.isPlayer,
          isNPC: e.isNPC || false,
          npcColor: e.isNPC ? e.color : null,
          canInteract: e.isNPC && this._nearbyNPC === e,
          hpRatio: e.hp / e.maxHp,
          size: e.isBoss?1.4:1,
          floatBob,
          sprite: e.isPlayer ? 'player' : (e.monsterId ? SPRITE_MAP[e.monsterId] || e.monsterId : null),
          animState: e.animState || 'idle',
          animTime: e.animTime || 0,
          animDir: e.animDir || {x:0,y:1},
          faceLeft: e.faceLeft || false,
          hitFlash: e.hitFlash || 0,
          attackAnim: e.attackAnim || 0,
          currentPackage: e.currentPackage || null,
        });
      }
    }

// 浮动伤害数字
    if(this.ui.settings.dmgPopups){
      for(const dp of this.dmgPopups){
        const p = gridToScreen(dp.px, dp.py);
        r.ctx.save();
        r.ctx.font = `${14/r.cam.zoom}px Microsoft YaHei`;
        r.ctx.textAlign = 'center';
        r.ctx.globalAlpha = Math.min(1, dp.life);
        r.ctx.fillStyle = '#000';
        r.ctx.fillText(dp.text, p.x+1, p.y - 20 + 1);
        r.ctx.fillStyle = dp.color;
        r.ctx.fillText(dp.text, p.x, p.y - 20);
        r.ctx.restore();
      }
    }

    // 目标选择高亮
    if(this.targetMode && this.hoverTile){
      r.drawTarget(this.hoverTile.x, this.hoverTile.y);
    }

    // 自动寻路路径可视化
    if(this._autoPath && this._autoPath.path.length > 0){
      const ctx = r.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(127, 209, 196, 0.5)';
      ctx.lineWidth = 3 / r.cam.zoom;
      ctx.setLineDash([6/r.cam.zoom, 4/r.cam.zoom]);
      ctx.beginPath();
      const start = gridToScreen(this.player.px, this.player.py);
      ctx.moveTo(start.x, start.y);
      for(let i = this._autoPath.idx; i < this._autoPath.path.length; i++){
        const pt = this._autoPath.path[i];
        const sp = gridToScreen(pt.x, pt.y);
        ctx.lineTo(sp.x, sp.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // 终点标记
      const last = this._autoPath.path[this._autoPath.path.length - 1];
      const lp = gridToScreen(last.x, last.y);
      ctx.fillStyle = 'rgba(127, 209, 196, 0.3)';
      ctx.beginPath();
      ctx.arc(lp.x, lp.y, 8/r.cam.zoom, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    // 建造模式预览：半透明幽灵瓦片
    if(this.buildMode && this.hoverTile){
      this._drawBuildPreview(r);
    }

    r.restore();

    // 后处理：暗角 + 调色 + 氛围
    this._postProcess();

    // 调试模式：绘制选中格子信息
    if(this.debugMode) this._renderDebug();

    // 还原迷雾数组（若本帧被覆盖）
    if(this.fogReveal){
      this.map.visible = _savedVis;
      this.map.explored = _savedExp;
    }
  }

  // ========== 调试模式渲染 ==========
  _renderDebug(){
    const r = this.renderer;
    const ctx = r.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const cam = r.cam;

    // 顶部状态栏
    ctx.save();
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, w, 28);
    ctx.fillStyle = '#7fd1c4';
    ctx.font = '13px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`[DEBUG] F3=关 H=隐藏 | ↑↓←→=调节 R=重置 | srcOff(${this.debugSrcOff.x},${this.debugSrcOff.y}) drawOff(${this.debugDrawOff.x},${this.debugDrawOff.y})`, 10, 19);

    if(!this.debugTile){ ctx.restore(); return; }
    const gx = this.debugTile.x, gy = this.debugTile.y;
    if(gx<0||gy<0||gx>=this.map.w||gy>=this.map.h){ ctx.restore(); return; }

    // 选中格子高亮边框 (世界空间)
    r.applyCam();
    const p = gridToScreen(gx, gy);
    const hw = TILE_W/2, hh = TILE_H/2;
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 3/cam.zoom;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - hh);
    ctx.lineTo(p.x + hw, p.y);
    ctx.lineTo(p.x, p.y + hh);
    ctx.lineTo(p.x - hw, p.y);
    ctx.closePath();
    ctx.stroke();
    // 渲染边界框 (根据绘制方式)
    const tid = this.map.tileId(gx, gy);
    const m = MAT.floor[tid];
    if(m){
      // atlas渲染：显示截取区域
      const srcTile = 64;
      const srcW = 63;
      const sx = TILE_W/60, sy = TILE_H/33;
      const drawW = srcW*sx, drawH = 48*sy;
      const drawX = p.x - 32*sx, drawY = p.y - 27.5*sy;
      ctx.strokeStyle = 'rgba(0,255,136,0.7)';
      ctx.lineWidth = 1.5/cam.zoom;
      ctx.strokeRect(drawX, drawY, drawW, drawH);
      // 标注截取源坐标
      const col = Math.floor(m.rect[0]/srcTile);
      const row = Math.floor(m.rect[1]/48);
      const srcX = col * srcTile, srcY = row * 48;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(p.x + hw + 4, p.y - hh, 220, 46);
      ctx.fillStyle = '#0f8';
      ctx.font = '11px Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`atlas: FLOOR[${row},${col}]`, p.x+hw+8, p.y-hh+14);
      ctx.fillText(`src: [${srcX},${srcY}] → ${srcW}x48`, p.x+hw+8, p.y-hh+28);
      ctx.fillText(`draw: (${drawX.toFixed(1)},${drawY.toFixed(1)}) ${drawW.toFixed(0)}x${drawH.toFixed(0)}`, p.x+hw+8, p.y-hh+42);
    } else {
      // drawTileFloor渲染
      ctx.strokeStyle = 'rgba(255,160,0,0.7)';
      ctx.lineWidth = 1.5/cam.zoom;
      ctx.strokeRect(p.x-hw, p.y-hh, TILE_W, TILE_H*2);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(p.x+hw+4, p.y-hh, 180, 32);
      ctx.fillStyle = '#fa0';
      ctx.font = '11px Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`drawTileFloor (tex=${tid})`, p.x+hw+8, p.y-hh+14);
      ctx.fillText(`无atlas映射, 使用旧渲染器`, p.x+hw+8, p.y-hh+28);
    }
    // 墙体 atlas 截取框（橙色，与地板框对应）
    const blk = this.map.getBlocks?.(gx, gy);
    if(blk && blk.length){
      const bt = MAT.block[blk[0]];
      if(bt && bt.atlas){
        const col = Math.floor(bt.rect[0]/64), row = Math.floor(bt.rect[1]/64);
        ctx.strokeStyle = 'rgba(255,170,0,0.85)';
        ctx.lineWidth = 1.5/cam.zoom;
        const bw = 46/cam.zoom, bh = 46/cam.zoom;
        ctx.strokeRect(p.x - bw/2, p.y - hh - bh, bw, bh);
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(p.x - bw/2, p.y - hh - bh - 16/cam.zoom, 170/cam.zoom, 15/cam.zoom);
        ctx.fillStyle = '#fa0';
        ctx.font = (11/cam.zoom)+'px Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`BLOCK[${row},${col}] id=${blk[0]}`, p.x - bw/2, p.y - hh - bh - 4/cam.zoom);
      }
    }
    r.restore();

    // 右侧信息面板
    ctx.save();
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    const tile = m;
    const vis = this.map.visible[gy][gx];
    const exp = this.map.explored[gy][gx];
    const blocks = this.map.getBlocks?.(gx, gy);
    const decors = this.map.getDecorationsAt?.(gx, gy) || [];
    const hasOffsets = this.debugSrcOff.x || this.debugSrcOff.y || this.debugDrawOff.x || this.debugDrawOff.y;
    const panelH = (hasOffsets ? 330 : 300) + (this.map.themeName ? 18 : 0);

    const px = w - 280, py = 36;
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(px, py, 270, panelH);
    ctx.strokeStyle = '#7fd1c4';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, 270, panelH);

    ctx.fillStyle = '#7fd1c4';
    ctx.font = 'bold 13px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`格子 [${gx}, ${gy}]`, px+10, py+20);

    ctx.font = '11px Consolas, monospace';
    let y = py + 40;
    const line = (label, val, color='#ccc') => {
      ctx.fillStyle = '#888';
      ctx.fillText(label, px+10, y);
      ctx.fillStyle = color;
      ctx.fillText(String(val), px+100, y);
      y += 16;
    };
    const divider = () => { ctx.strokeStyle='#333'; ctx.beginPath(); ctx.moveTo(px+10,y-4); ctx.lineTo(px+260,y-4); ctx.stroke(); y+=4; };

    const sp = this.map.specialAt(gx, gy);
    line('tileId:', tid, '#fff');
    line('name:', m?.name || '?', '#fff');
    if(this.map.themeName) line('theme:', this.map.themeName, '#f8a');
    line('solid:', m?.solid ?? '?');
    line('walkable:', m?.walkable ?? '?');
    line('alias:', m?.alias || '(none)');
    if(sp) line('special:', sp, '#fd0');
    divider();
    line('visible:', vis, vis?'#4f8':'#f84');
    line('explored:', exp, exp?'#4f8':'#f84');
    divider();
    if(m){
      const frc = this._atlasRC(m);
      line('atlas:', m.atlas, '#0f8');
      if(frc) line('贴图集行列:', `行 ${frc.row} / 列 ${frc.col}`, '#0f8');
    } else {
      line('atlas:', '(none)', '#f84');
    }
    if(this.debugSrcOff.x || this.debugSrcOff.y || this.debugDrawOff.x || this.debugDrawOff.y){
      divider();
      line('srcOff:', `(${this.debugSrcOff.x}, ${this.debugSrcOff.y})`, '#fd0');
      line('drawOff:', `(${this.debugDrawOff.x}, ${this.debugDrawOff.y})`, '#fd0');
    }
    if(blocks && blocks.length){
      divider();
      line('blocks:', blocks.length+'个', '#fa0');
      blocks.forEach((bid,i)=>{
        const bt = MAT.block[bid];
        if(!bt){ line(`  [${i}]`, `${bid} (缺失 rect)`, '#f84'); return; }
        line(`  [${i}] id`, bid, '#fa0');
        line('    name:', bt.name || '?', '#fa0');
        line('    solid:', bt.solid ?? '?');
        line('    walkable:', bt.walkable ?? '?');
        line('    alias:', bt.alias || '(none)');
        line('    type:', bt.type || '-');
        line('    h:', bt.h ?? '?');
        if(bt.atlas){
          const br = Math.floor(bt.rect[1]/64), bc = Math.floor(bt.rect[0]/64);
          line('    atlas:', `BLOCK[${br},${bc}] (${bt.atlas})`, '#fa0');
        }
      });
    }
    if(decors.length){
      divider();
      line('objs(装饰):', decors.length+'个', '#a8f');
      decors.forEach((d,i)=>{
        const oid = d.type;
        const od = MAT.obj[oid];
        const orc = this._atlasRC(od);
        line(`  [${i}] id`, oid, '#a8f');
        line('    name:', (od && (od.name || od.nameJP)) || '?', '#a8f');
        if(od && od.atlas){
          line('    atlas:', `${od.atlas}${orc ? ` [行 ${orc.row}, 列 ${orc.col}]` : ''}`, '#a8f');
        }
        line('    alias:', od ? (od.alias || '-') : '(缺失)');
        line('    type:', od ? (od.type || '-') : '?');
        line('    solid:', od ? (od.solid ?? '?') : '?');
        line('    walkable:', od ? (od.walkable ?? '?') : '?');
      });
    }
    ctx.restore();
  }

  _drawBuildPreview(r){
    const ctx = r.ctx;
    const gx = this.hoverTile.x, gy = this.hoverTile.y;
    if(gx < 0 || gy < 0 || gx >= this.map.w || gy >= this.map.h) return;
    const p = gridToScreen(gx, gy);
    const hw = TILE_W/2, hh = TILE_H/2;
    const bm = this.buildMode;
    ctx.save();
    if(bm.tool === 'remove'){
      // 拆除模式：红色高亮菱形
      ctx.strokeStyle = 'rgba(255,80,80,0.8)';
      ctx.fillStyle = 'rgba(255,80,80,0.15)';
      ctx.lineWidth = 2/r.cam.zoom;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - hh);
      ctx.lineTo(p.x + hw, p.y);
      ctx.lineTo(p.x, p.y + hh);
      ctx.lineTo(p.x - hw, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 检查是否有可拆除的东西
      const hasDecor = this.map.getDecorationsAt(gx, gy).length > 0;
      const hasBlocks = this.map.hasBlocks(gx, gy);
      const isSpecial = !!this.map.specialAt(gx, gy);
      const canRemove = hasDecor || hasBlocks || (!!this.map.get(gx, gy) && !isSpecial);
      if(!canRemove){
        ctx.fillStyle = 'rgba(120,120,120,0.1)';
        ctx.fill();
      }
    } else if(bm.selected){
      // 放置模式：绿色高亮 + 幽灵预览
      const isWallDecor = false;
      const hasBlocks = this.map.hasBlocks(gx, gy);
      const canPlace = true;
      const color = canPlace ? 'rgba(127,209,196,0.8)' : 'rgba(255,180,80,0.8)';
      const fill = canPlace ? 'rgba(127,209,196,0.15)' : 'rgba(255,180,80,0.1)';
      ctx.strokeStyle = color;
      ctx.fillStyle = fill;
      ctx.lineWidth = 2/r.cam.zoom;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - hh);
      ctx.lineTo(p.x + hw, p.y);
      ctx.lineTo(p.x, p.y + hh);
      ctx.lineTo(p.x - hw, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 方块放置预览：画半透明墙体轮廓
      if(bm.cat === 'wall' && MAT.block[bm.selected]){
        const bt = MAT.block[bm.selected];
        const stackH = this.map.blockHeightAt(gx, gy);
        const previewH = bt.h * WALL_H;
        const topY = p.y - 48 - stackH - previewH + 16;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1/r.cam.zoom;
        ctx.beginPath();
        ctx.moveTo(p.x, topY - hh);
        ctx.lineTo(p.x + hw, topY);
        ctx.lineTo(p.x + hw, p.y - 32 - stackH);
        ctx.lineTo(p.x, p.y + hh - 64 - stackH + 32);
        ctx.lineTo(p.x - hw, p.y - 32 - stackH);
        ctx.lineTo(p.x - hw, topY);
        ctx.closePath();
        ctx.globalAlpha = 0.3;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ========== 后处理 ==========
  _postProcess(){
    const r = this.renderer;
    const ctx = r.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const s = this.ui.settings;

    ctx.save();
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);

    // 1. 暗角（Vignette）— 径向渐变，边缘变暗
    if(s.vignette){
      const vGrad = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.3, w/2, h/2, Math.max(w,h)*0.75);
      vGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vGrad.addColorStop(0.6, 'rgba(0,0,0,0.15)');
      vGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vGrad;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. 调色 — 地下城偏冷青色调，城镇偏暖
    if(s.colorGrading){
      if(this.map && this.map.isTown){
        ctx.fillStyle = 'rgba(255,200,120,0.04)';
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.fillStyle = 'rgba(40,60,90,0.06)';
        ctx.fillRect(0, 0, w, h);
      }
    }

    // 3. 顶部渐变压暗 — 模拟天花板/上方阴影
    if(s.topGradient){
      const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.3);
      topGrad.addColorStop(0, 'rgba(0,0,0,0.25)');
      topGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, w, h * 0.3);
    }

    // 4. 底部渐变压暗 — 模拟地面雾气
    if(s.bottomGradient){
      const botGrad = ctx.createLinearGradient(0, h * 0.7, 0, h);
      botGrad.addColorStop(0, 'rgba(0,0,0,0)');
      botGrad.addColorStop(1, 'rgba(10,12,18,0.3)');
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
    }

    ctx.restore();
  }

  // ========== 输入 ==========
  _setupInput(){
    // 键盘按下/释放跟踪
    window.addEventListener('keydown', (e)=>{
      this.keys[e.key] = true;
      // 面板打开时只处理 Esc
      if(this.ui.isPanelOpen()){
        if(e.key === 'Escape'){ this.ui.hidePanel(); }
        return;
      }
      if(this.ui.isSettingsOpen()){
        if(e.key === 'Escape'){ this.ui.hideSettings(); }
        return;
      }
      if(!this.player || !this.player.alive) return;

      const k = e.key;
      let handled = true;
      if(this.targetMode && k === 'Escape'){ this.targetMode = null; this.log('取消施法', 'info'); }
      else if(e.shiftKey && (k === '.' || k === '>')){ this.useStairs(); }
      else if(e.shiftKey && (k === ',' || k === '<')){ this.useStairs(); }
      else if(k === 'Enter'){ this.useStairs(); }
      else if(k === 'g' || k === 'G'){ this.playerPickup(); }
      else if(k === 'i' || k === 'I'){ this.ui.showInventory(this.player, this._invActions()); }
      else if(k === 'v' || k === 'V'){ this.ui.showCharacterSheet(this.player); }
      else if(k === 'p' || k === 'P'){ this.prayAtAltar(); }
      else if(k === 'f' || k === 'F'){ /* 攻击在 update 中持续处理 */ }
      else if(k === 't' || k === 'T'){ this._interactNPC(); }
      else if(k === 'b' || k === 'B'){ this._toggleBuildMode(); }
      else if(k === 'Tab'){ e.preventDefault(); this._toggleCombatMode(); }
      else if(k === 'r' || k === 'R'){ if(this.tb.active && this.tb.isMyTurn(this.player)) this._tbDash(); }
      else if(k === 'q' || k === 'Q'){ if(this.tb.active && this.tb.isMyTurn(this.player)) this._tbQuickHeal(); }
      else if(k === 'Escape'){
        if(this.buildMode){ this._toggleBuildMode(); }
        else if(!this.targetMode){ this.ui.toggleSettings(); }
        else { this.targetMode = null; this._cancelAutoPath(); }
      }
      else if(k === ' '){
        if(this.tb.active && this.tb.isMyTurn(this.player)){
          this._tbEndTurn();
        } else {
          this._cancelAutoPath();
        }
        e.preventDefault();
      }
      else if(k >= '1' && k <= '9'){
        const idx = parseInt(k)-1;
        const sids = Object.keys(this.player.spells||{});
        if(sids[idx]){
          if(this.tb.active && this.tb.isMyTurn(this.player)){
            this._tbPlayerCastSpell(sids[idx]);
          } else {
            this.tryCastSpell(sids[idx]);
          }
        }
      }
      else if(k === 'F3'){
        this.debugMode = !this.debugMode;
        if(!this.debugMode){ this.debugTile = null; this.debugHideOthers = false; }
        this.log(this.debugMode ? '调试模式 ON | F3关 点击选格 H隐藏 ↑↓←→调偏移 R重置' : '调试模式 OFF', 'info');
      }
      else if(k === 'h' || k === 'H'){
        if(this.debugMode){ this.debugHideOthers = !this.debugHideOthers; }
        else handled = false;
      }
      else if(this.debugMode && (k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight')){
        handled = true;
        const step = e.shiftKey ? 10 : 1;
        if(e.altKey){
          // Alt+方向键: 调整截取偏移 srcOff
          if(k==='ArrowUp') this.debugSrcOff.y -= step;
          if(k==='ArrowDown') this.debugSrcOff.y += step;
          if(k==='ArrowLeft') this.debugSrcOff.x -= step;
          if(k==='ArrowRight') this.debugSrcOff.x += step;
        } else {
          // 方向键: 调整绘制偏移 drawOff
          if(k==='ArrowUp') this.debugDrawOff.y -= step;
          if(k==='ArrowDown') this.debugDrawOff.y += step;
          if(k==='ArrowLeft') this.debugDrawOff.x -= step;
          if(k==='ArrowRight') this.debugDrawOff.x += step;
        }
      }
      else if(this.debugMode && (k==='r'||k==='R')){
        this.debugSrcOff = {x:0, y:0};
        this.debugDrawOff = {x:0, y:0};
        this.log('偏移已重置', 'info');
      }
      else if(this.debugMode && (k==='o'||k==='O')){
        // 导出3D可见性数据
        const map = this.map;
        const lines = [];
        lines.push('===== Fog of War 3D Visibility Report =====');
        lines.push(`Time: ${new Date().toISOString()}`);
        lines.push(`Player: (${this.player.px},${this.player.py})`);
        lines.push(`Map: ${map.w}x${map.h}`);
        lines.push('');
        lines.push('--- Visible Columns (2D) ---');
        let visCount = 0, expCount = 0;
        for(let y=0;y<map.h;y++) for(let x=0;x<map.w;x++){
          if(map.visible[y][x]) visCount++;
          if(map.explored[y][x]) expCount++;
        }
        lines.push(`Visible: ${visCount}  Explored: ${expCount}`);
        lines.push('');
        lines.push('--- 3D Visibility (vis3D bitmask per cell) ---');
        for(let y=0;y<map.h;y++){
          for(let x=0;x<map.w;x++){
            const v = map.vis3D[y][x];
            const e = map.exp3D[y][x];
            const b = map.blocks[y]?.[x];
            const stackH = b ? b.length : 0;
            if(v === 0 && e === 0) continue;
            lines.push(`  (${x},${y}) vis=0b${v.toString(2).padStart(4,'0')} exp=0b${e.toString(2).padStart(4,'0')} blocks=${stackH}`);
          }
        }
        const blob = new Blob([lines.join('\n')], {type:'text/plain'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fog3d_${this.player.px}_${this.player.py}_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        this.log(`3D可见性已导出: ${a.download}`, 'info');
        handled = true;
      }
      else handled = false;
      if(handled) e.preventDefault();
    });
    window.addEventListener('keyup', (e)=>{ this.keys[e.key] = false; });

    this.canvas.addEventListener('mousemove', (e)=>this._onMouseMove(e));
    this.canvas.addEventListener('click', (e)=>this._onMouseClick(e));
    this.canvas.addEventListener('wheel', (e)=>this._onWheel(e), {passive:false});

    // 拖拽相机
    let dragging = false, dragX=0, dragY=0;
    this.canvas.addEventListener('mousedown', (e)=>{
      if((e.button === 2 && !this.buildMode) || e.shiftKey){
        dragging = true; dragX = e.clientX; dragY = e.clientY;
        this._dragging = true;
      }
    });
    window.addEventListener('mousemove', (e)=>{
      if(dragging){
        const dx = (e.clientX - dragX) / this.renderer.cam.zoom;
        const dy = (e.clientY - dragY) / this.renderer.cam.zoom;
        this.renderer.cam.targetX -= dx; this.renderer.cam.targetY -= dy;
        this.renderer.cam.x -= dx; this.renderer.cam.y -= dy;
        dragX = e.clientX; dragY = e.clientY;
      }
    });
    window.addEventListener('mouseup', ()=>{ dragging=false; this._dragging=false; });
    this.canvas.addEventListener('contextmenu', (e)=>{
      e.preventDefault();
      // 建造模式：右键拆除
      if(this.buildMode && this.player && this.player.alive && !this.ui.isPanelOpen()){
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const g = screenToGrid(cx, cy, this.renderer.cam, this.canvas.clientWidth, this.canvas.clientHeight);
        this._buildRemove(g.x, g.y);
      }
    });

    // ---- 移动端触控 ----
    const urlParams = new URLSearchParams(window.location.search);
    this._isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || urlParams.get('touch') === '1';
    if(this._isTouch){
      document.body.classList.add('touch-device');
      this._setupTouchInput();
    }
  }

  // ========== 移动端触控输入 ==========
  _setupTouchInput(){
    this._joyVec = {x:0, y:0};      // 摇杆方向向量 (-1~1)
    this._joyActive = false;
    this._touchAttack = false;
    this._pinchDist = 0;
    this._joyTouchId = null;        // 跟踪摇杆的触摸ID
    this._longPressTimer = null;

    const joystick = document.getElementById('mobile-joystick');
    const base = document.getElementById('joystick-base');
    const thumb = document.getElementById('joystick-thumb');
    const maxRadius = 50;

    // ---- 浮动摇杆：手指落下处即摇杆中心 ----
    const onJoyStart = (e) => {
      e.preventDefault();
      if(this._joyActive) return; // 已有摇杆激活
      const t = e.touches ? e.touches[0] : e;
      this._joyTouchId = e.touches ? t.identifier : null;
      this._joyActive = true;
      // 将摇杆移到手指位置
      const cx = t.clientX, cy = t.clientY;
      joystick.style.left = (cx - 65) + 'px';
      joystick.style.bottom = 'auto';
      joystick.style.top = (cy - 65) + 'px';
      joystick.style.opacity = '1';
      this._updateJoystick(0, 0, thumb, maxRadius);
    };
    const onJoyMove = (e) => {
      if(!this._joyActive) return;
      e.preventDefault();
      let t;
      if(e.touches){
        // 找到对应ID的触摸点
        for(let i=0; i<e.touches.length; i++){
          if(e.touches[i].identifier === this._joyTouchId){ t = e.touches[i]; break; }
        }
        if(!t) return;
      } else { t = e; }
      // 以摇杆中心为基准
      const r = joystick.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      this._updateJoystick(t.clientX - cx, t.clientY - cy, thumb, maxRadius);
    };
    const onJoyEnd = (e) => {
      if(!this._joyActive) return;
      e.preventDefault();
      this._joyActive = false;
      this._joyVec = {x:0, y:0};
      this._joyTouchId = null;
      thumb.style.transform = 'translate(0,0)';
      joystick.style.opacity = '0';
    };

    // 在左半屏区域监听摇杆（不干扰右侧按钮区）
    this.canvas.addEventListener('touchstart', (e)=>{
      if(this._joyActive) return;
      if(e.touches.length !== 1) return;
      const t = e.touches[0];
      // 只在屏幕左半部分触发摇杆
      if(t.clientX > window.innerWidth * 0.5) return;
      if(this.ui.isPanelOpen()) return;
      if(this.buildMode) return; // 建造模式下不触发摇杆
      onJoyStart(e);
    }, {passive:false});

    this.canvas.addEventListener('touchmove', (e)=>{
      onJoyMove(e);
    }, {passive:false});

    this.canvas.addEventListener('touchend', (e)=>{
      // 检查是否是摇杆的触摸结束
      if(this._joyActive){
        let stillActive = false;
        if(e.touches){
          for(let i=0; i<e.touches.length; i++){
            if(e.touches[i].identifier === this._joyTouchId){ stillActive = true; break; }
          }
        }
        if(!stillActive) onJoyEnd(e);
      }
    }, {passive:false});

    this.canvas.addEventListener('touchcancel', (e)=>{
      if(this._joyActive) onJoyEnd(e);
    }, {passive:false});

    // 桌面测试支持
    joystick.addEventListener('mousedown', (e)=>{ onJoyStart(e); });
    window.addEventListener('mousemove', (e)=>{ if(this._joyActive) onJoyMove(e); });
    window.addEventListener('mouseup', (e)=>{ if(this._joyActive) onJoyEnd(e); });

    // ---- 动作按钮 ----
    const actionMap = {
      'attack':   () => {
        if(this.tb.active && this.tb.isMyTurn(this.player)){ this._tbPlayerAttack(); }
        else { this._touchAttack = true; }
      },
      'pickup':   () => { this.playerPickup(); },
      'stairs':   () => { this.useStairs(); },
      'dash':     () => { if(this.tb.active && this.tb.isMyTurn(this.player)) this._tbDash(); },
      'heal':     () => {
        if(this.tb.active && this.tb.isMyTurn(this.player)) this._tbQuickHeal();
        else { // 实时模式：使用治疗药水
          const healItem = this.player.inventory.find(it => it.use === 'heal');
          if(healItem) this.useItem(healItem);
          else this.log('没有治疗药水', 'warn');
        }
      },
      'build':    () => { this._toggleBuildMode(); },
      'tbmode':   () => { this._toggleCombatMode(); },
      'tbend':    () => { if(this.tb.active) this._tbEndTurn(); },
      'inventory':() => { this.ui.showInventory(this.player, this._invActions()); },
      'character':() => { this.ui.showCharacterSheet(this.player); },
      'cancel':   () => {
        if(this.buildMode){ this._toggleBuildMode(); return; }
        this._cancelAutoPath(); this.targetMode = null; this.log('取消', 'info');
      },
      'settings': () => { this.ui.toggleSettings(); },
    };

    document.querySelectorAll('.mob-btn').forEach(btn => {
      const action = btn.dataset.action;
      if(action === 'attack'){
        btn.addEventListener('touchstart', (e)=>{ e.preventDefault(); this._touchAttack = true; }, {passive:false});
        btn.addEventListener('touchend', (e)=>{ e.preventDefault(); this._touchAttack = false; }, {passive:false});
        btn.addEventListener('mousedown', ()=>{ this._touchAttack = true; });
        btn.addEventListener('mouseup', ()=>{ this._touchAttack = false; });
      } else if(actionMap[action]){
        btn.addEventListener('touchstart', (e)=>{ e.preventDefault(); actionMap[action](); }, {passive:false});
        btn.addEventListener('click', actionMap[action]);
      }
    });

    // ---- 法术快捷栏 ----
    this._updateMobileSpells();

    // ---- 点击画布寻路 / 建造模式触摸 ----
    this.canvas.addEventListener('touchstart', (e)=>{
      if(this.ui.isPanelOpen()) return;
      if(this._joyActive) return;
      if(e.touches.length !== 1) return;
      const t = e.touches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY);
      if(target && target !== this.canvas) return;
      this._touchTap = {x: t.clientX, y: t.clientY, time: Date.now()};
      // 建造模式：长按拆除
      if(this.buildMode){
        this._longPressTimer = setTimeout(()=>{
          const rect = this.canvas.getBoundingClientRect();
          const cx = this._touchTap.x - rect.left;
          const cy = this._touchTap.y - rect.top;
          const g = screenToGrid(cx, cy, this.renderer.cam, this.canvas.clientWidth, this.canvas.clientHeight);
          this._buildRemove(g.x, g.y);
          this._touchTap = null; // 已处理
          if(navigator.vibrate) navigator.vibrate(30);
        }, 500);
      }
    }, {passive:true});

    this.canvas.addEventListener('touchend', (e)=>{
      if(this._longPressTimer){ clearTimeout(this._longPressTimer); this._longPressTimer = null; }
      if(!this._touchTap) return;
      if(this.ui.isPanelOpen()) return;
      const dt = Date.now() - this._touchTap.time;
      if(dt > 300){ this._touchTap = null; return; }
      const rect = this.canvas.getBoundingClientRect();
      const cx = this._touchTap.x - rect.left;
      const cy = this._touchTap.y - rect.top;
      const g = screenToGrid(cx, cy, this.renderer.cam, this.canvas.clientWidth, this.canvas.clientHeight);
      if(this.buildMode){
        // 建造模式：tap放置
        this._buildPlace(g.x, g.y);
        if(navigator.vibrate) navigator.vibrate(15);
      } else if(this.targetMode){
        this.castAtTarget(g.x, g.y);
      } else if(this.tb.active){
        this._tbClickMove(g.x, g.y);
      } else {
        this._startAutoPath(g.x, g.y);
      }
      this._touchTap = null;
    }, {passive:true});

    // ---- 双指缩放 ----
    let pinchStartDist = 0, pinchStartZoom = 1;
    this.canvas.addEventListener('touchmove', (e)=>{
      if(e.touches.length === 2){
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(pinchStartDist === 0){
          pinchStartDist = dist;
          pinchStartZoom = this.renderer.cam.targetZoom;
        } else {
          const ratio = dist / pinchStartDist;
          this.renderer.cam.setZoom(pinchStartZoom * ratio);
        }
      }
    }, {passive:false});

    this.canvas.addEventListener('touchend', (e)=>{
      if(e.touches.length < 2) pinchStartDist = 0;
    });
  }

  _updateJoystick(dx, dy, thumb, maxR){
    const dist = Math.sqrt(dx*dx + dy*dy);
    if(dist > maxR){ dx = dx/dist * maxR; dy = dy/dist * maxR; }
    thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    // 归一化为 -1~1
    this._joyVec = {x: dx / maxR, y: dy / maxR};
  }

  _updateMobileSpells(){
    const container = document.getElementById('mobile-spells');
    if(!container) return;
    container.innerHTML = '';
    const sids = Object.keys(this.player?.spells || {});
    sids.forEach((sid, i) => {
      if(i >= 6) return;
      const spell = this.player.spells[sid];
      const btn = document.createElement('div');
      btn.className = 'spell-btn';
      btn.textContent = spell.icon || (i+1);
      btn.title = spell.name || sid;
      const castFn = () => this.tryCastSpell(sid);
      btn.addEventListener('touchstart', (e)=>{ e.preventDefault(); castFn(); }, {passive:false});
      btn.addEventListener('click', castFn);
      container.appendChild(btn);
    });
  }

  _onMouseMove(e){
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    this.hoverTile = screenToGrid(cx, cy, this.renderer.cam, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  _onMouseClick(e){
    if(!this.player || !this.player.alive) return;
    if(this.ui.isPanelOpen()) return;
    if(this._dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const g = screenToGrid(cx, cy, this.renderer.cam, this.canvas.clientWidth, this.canvas.clientHeight);
    // 调试模式：点击选中格子
    if(this.debugMode){
      if(e.button === 0){
        this.debugTile = (this.debugTile && this.debugTile.x===g.x && this.debugTile.y===g.y) ? null : {x:g.x, y:g.y};
      }
      return;
    }
    // 建造模式：左键根据工具放置或拆除
    if(this.buildMode){
      if(e.button === 0){
        if(this.buildMode.tool === 'remove') this._buildRemove(g.x, g.y);
        else this._buildPlace(g.x, g.y);
      }
      return;
    }
    if(this.targetMode){
      this.castAtTarget(g.x, g.y);
      return;
    }
    // 回合制模式：点击移动
    if(this.tb.active){
      if(e.button === 0) this._tbClickMove(g.x, g.y);
      return;
    }
    // 左键点击：A* 自动寻路
    if(e.button === 0){
      this._startAutoPath(g.x, g.y);
    }
  }

  _onWheel(e){
    e.preventDefault();
    const z = this.renderer.cam.targetZoom - Math.sign(e.deltaY) * 0.15;
    this.renderer.cam.setZoom(z);
  }

  _setupResize(){
    window.addEventListener('resize', ()=>this.renderer.resize());
  }

  // ========== 建造模式 ==========
  _toggleBuildMode(){
    if(this.buildMode){
      // 关闭：复位迷雾覆盖标记
      this.buildMode = null;
      this.fogNoFog = false;
      this.fogReveal = false;
      const nf = document.getElementById('build-nofog'); if(nf) nf.checked = false;
      const rv = document.getElementById('build-reveal'); if(rv) rv.checked = false;
      document.getElementById('build-panel').classList.add('hidden');
      this._hideBuildTooltip();
      this.log('退出建造模式', 'info');
    } else {
      // 打开
      this.buildMode = {cat:'decor', tool:'place', selected:null};
      this._showBuildPanel();
      this.log('进入建造模式 — 左键放置 · 右键拆除', 'info');
    }
  }

  _showBuildPanel(){
    const panel = document.getElementById('build-panel');
    panel.classList.remove('hidden');
    if(this.buildMode.search === undefined) this.buildMode.search = '';
    this._renderBuildGrid();
    // 分类标签计数
    const setCount = (id, n) => { const el = document.getElementById(id); if(el) el.textContent = '(' + n + ')'; };
    setCount('tabn-decor', Object.keys(MAT.obj).length);
    setCount('tabn-wall', Object.keys(MAT.block).length);
    setCount('tabn-floor', Object.keys(MAT.floor).length);
    // tab 切换
    panel.querySelectorAll('.build-tab').forEach(tab => {
      tab.onclick = () => {
        panel.querySelectorAll('.build-tab').forEach(t=>t.classList.remove('active'));
        tab.classList.add('active');
        this.buildMode.cat = tab.dataset.cat;
        this.buildMode.selected = null;
        this._renderBuildGrid();
      };
    });
    // 工具切换
    panel.querySelectorAll('.build-tool-btn').forEach(btn => {
      btn.onclick = () => {
        panel.querySelectorAll('.build-tool-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        this.buildMode.tool = btn.dataset.tool;
      };
    });
    // 搜索（防抖）
    const searchEl = document.getElementById('build-search');
    if(searchEl){
      searchEl.value = this.buildMode.search || '';
      if(this._buildSearchTimer) clearTimeout(this._buildSearchTimer);
      searchEl.oninput = (e) => {
        const v = e.target.value;
        if(this._buildSearchTimer) clearTimeout(this._buildSearchTimer);
        this._buildSearchTimer = setTimeout(() => {
          this.buildMode.search = v;
          this._renderBuildGrid();
        }, 80);
      };
    }
    // 迷雾开关
    const nofog = document.getElementById('build-nofog');
    const reveal = document.getElementById('build-reveal');
    if(nofog){ nofog.checked = !!this.fogNoFog; nofog.onchange = (e)=>{ this.fogNoFog = e.target.checked; }; }
    if(reveal){ reveal.checked = !!this.fogReveal; reveal.onchange = (e)=>{ this.fogReveal = e.target.checked; }; }
    // 关闭按钮
    document.getElementById('build-close').onclick = () => this._toggleBuildMode();
  }

  _renderBuildGrid(){
    const grid = document.getElementById('build-grid');
    const cat = this.buildMode.cat;
    const q = (this.buildMode.search || '').trim().toLowerCase();
    grid.innerHTML = '';

    // 收集当前分类的全部元素（不再只取每组代表）
    let all = [];
    const table = cat === 'decor' ? MAT.obj : cat === 'wall' ? MAT.block : MAT.floor;
    for(const id in table){
      const def = table[id];
      if(!def) continue;
      all.push({ id: +id, def, cat });
    }

    // 搜索过滤（名称/ID/类型/标签/别名/材质/群系/渲染）
    if(q) all = all.filter(it => this._matchBuildItem(it, q));

    // 分组（无搜索时按语义分组，便于浏览海量元素）
    const groups = {};
    if(!q){
      for(const it of all){
        const g = this._buildGroupKey(cat, it.def);
        (groups[g] = groups[g] || []).push(it);
      }
    } else {
      groups['搜索结果'] = all;
    }

    const frag = document.createDocumentFragment();
    const keys = Object.keys(groups).sort((a,b)=> a=== '搜索结果' ? -1 : b==='搜索结果' ? 1 : a.localeCompare(b));
    for(const gk of keys){
      if(!q){
        const h = document.createElement('div');
        h.className = 'build-group-header';
        h.textContent = gk + ' (' + groups[gk].length + ')';
        frag.appendChild(h);
      }
      for(const it of groups[gk]){
        frag.appendChild(this._makeBuildItem(cat, it));
      }
    }
    grid.appendChild(frag);

    const cnt = document.getElementById('build-count');
    if(cnt) cnt.textContent = all.length + ' 项';
  }

  _matchBuildItem(it, q){
    const d = it.def;
    const hay = [
      String(it.id), d.name, d.nameJP, d.type, d.tag, d.alias,
      d.mat, d.biome, d.render, d.objType, d.defMat
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  _buildGroupKey(cat, d){
    if(cat === 'decor') return (d.type && d.type !== 'None' && d.type !== 'none') ? d.type : (d.render || '其他');
    if(cat === 'wall')  return d.mat || d.type || '其他';
    if(cat === 'floor') return d.biome || d.mat || '其他';
    return '其他';
  }

  _makeBuildItem(cat, it){
    const el = document.createElement('div');
    el.className = 'build-item';
    if(this.buildMode.selected === it.id) el.classList.add('selected');

    const iconDiv = document.createElement('div');
    iconDiv.className = 'build-item-icon';
    const c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    c.style.width = '100%'; c.style.height = '100%';
    c.style.imageRendering = 'pixelated';
    this._drawBuildIcon(c, cat, it.def);
    iconDiv.appendChild(c);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'build-item-name';
    nameDiv.textContent = (it.def.name || it.def.nameJP) || ('#' + it.id);
    nameDiv.title = (it.def.name || it.def.nameJP || ('ID ' + it.id)) + '  ·  id=' + it.id;

    const idDiv = document.createElement('div');
    idDiv.className = 'build-item-id';
    idDiv.textContent = '#' + it.id;

    el.appendChild(iconDiv);
    el.appendChild(nameDiv);
    el.appendChild(idDiv);

    el.onclick = () => {
      this.buildMode.selected = it.id;
      this.buildMode.tool = 'place';
      const grid = document.getElementById('build-grid');
      grid.querySelectorAll('.build-item').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
      document.querySelectorAll('.build-tool-btn').forEach(b=>b.classList.remove('active'));
      const pbtn = document.querySelector('.build-tool-btn[data-tool="place"]');
      if(pbtn) pbtn.classList.add('active');
    };
    // 悬停信息卡（显示 atlas 行列等）
    el.onmouseenter = (e) => { this._showBuildTooltip(it); this._moveBuildTooltip(e); };
    el.onmousemove = (e) => { this._moveBuildTooltip(e); };
    el.onmouseleave = () => { this._hideBuildTooltip(); };
    return el;
  }

  // 贴图集固定 cell 尺寸（cell = 纹理尺寸 / pass.pmesh.tiling）
  // 数值为游戏权威值：解析 resources.assets 的 RenderData→MeshPass→ProceduralMesh.tiling 得到，
  // 见 data/elin_source/render_atlas_truth.json。
  _atlasCell(atlas){
    switch(atlas){
      case 'floors':       return { cw:64, ch:48 };
      case 'blocks':       return { cw:64, ch:64 };
      case 'roofs':        return { cw:96, ch:80 };
      case 'objs':         return { cw:64, ch:64 };
      case 'objs_S':       return { cw:32, ch:32 };
      case 'objs_L':       return { cw:80, ch:64 };   // 游戏真值 80x64（原 80x32 错误）
      case 'objs_SS':      return { cw:32, ch:32 };   // 游戏无 pass 引用，legacy 猜测
      case 'objs_snow':    return { cw:64, ch:64 };
      case 'objs_S_snow':  return { cw:32, ch:32 };
      case 'objs_L_snow':  return { cw:80, ch:64 };   // 同 objs_L 80x64
      case 'blocks_snow':  return { cw:64, ch:64 };
      case 'floors_snow':  return { cw:64, ch:48 };
      case 'objs_C':       return { cw:128, ch:128 }; // 角色图集 pass chara
      case 'objs_CL':      return { cw:128, ch:256 }; // 角色图集 pass charaL（charaLW 变体 256x256）
      case 'objs_CLL':     return { cw:256, ch:256 }; // 角色图集 pass charaLL（原 32x32 错误）
      default:             return { cw:64, ch:64 };
    }
  }
  // 贴图集内行列位置（网格索引，非裁剪尺寸）
  _atlasRC(def){
    if(!def || !def.atlas || !Array.isArray(def.rect) || def.rect.length < 4) return null;
    const x = def.rect[0], y = def.rect[1];
    const cell = this._atlasCell(def.atlas);
    const col = Math.round(x / cell.cw), row = Math.round(y / cell.ch);
    return { atlas: def.atlas, col, row, x, y, cw: cell.cw, ch: cell.ch };
  }
  _esc(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  _getTooltip(){
    let el = document.getElementById('build-tooltip');
    if(!el){ el = document.createElement('div'); el.id = 'build-tooltip'; el.className = 'hidden'; document.body.appendChild(el); }
    return el;
  }
  _showBuildTooltip(it){
    const el = this._getTooltip();
    const d = it.def || {};
    const rc = this._atlasRC(d);
    const name = this._esc(d.name || d.nameJP || ('#' + it.id));
    const atlas = this._esc(d.atlas || '?');
    const row = (k, v, c) => `<div class="bt-row"><span class="bt-k">${k}</span><span class="bt-v${c ? ' ' + c : ''}">${v}</span></div>`;
    let html = `<div class="bt-title">${name}</div>`;
    html += `<div class="bt-sub">#${it.id} · 图集 ${atlas}</div>`;
    if(rc) html += row('贴图集行列', `行 ${rc.row} / 列 ${rc.col}`, 'atlas');
    html += row('类型 type', this._esc(String(d.type ?? '-')));
    html += row('材质 mat', this._esc(String(d.mat ?? '-')));
    html += row('群系 biome', this._esc(String(d.biome ?? '-')));
    html += row('别名 alias', this._esc(String(d.alias ?? '-')));
    html += row('实心 solid', this._esc(String(d.solid ?? '-')));
    html += row('可走 walkable', this._esc(String(d.walkable ?? '-')));
    html += row('渲染 render', this._esc(String(d.render ?? '-')));
    el.innerHTML = html;
    el.classList.remove('hidden');
  }
  _moveBuildTooltip(e){
    const el = document.getElementById('build-tooltip');
    if(!el || el.classList.contains('hidden')) return;
    const tw = el.offsetWidth, th = el.offsetHeight;
    let x = e.clientX + 16, y = e.clientY + 16;
    if(x + tw > window.innerWidth - 8) x = e.clientX - tw - 16;
    if(x < 8) x = 8;
    if(y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
    if(y < 8) y = 8;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  _hideBuildTooltip(){
    const el = document.getElementById('build-tooltip');
    if(el) el.classList.add('hidden');
  }

  _drawBuildIcon(canvas, cat, def){
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const atlas = this.renderer?.elinAtlases;
    if(!atlas || !def) return;

    if(cat === 'decor'){
      const img = atlas[def.atlas];
      if(img && img.complete && img.naturalWidth > 0){
        ctx.drawImage(img, def.rect[0], def.rect[1], def.rect[2], def.rect[3], 0, 0, 48, 48);
        return;
      }
    } else if(cat === 'wall'){
      const img = atlas['blocks'];
      if(img && img.complete && img.naturalWidth > 0){
        const tilePx = 64;
        const col = Math.floor(def.rect[0]/tilePx), row = Math.floor(def.rect[1]/tilePx);
        ctx.drawImage(img, col*tilePx, row*tilePx, tilePx, tilePx, 0, 0, 48, 48);
        return;
      }
    } else if(cat === 'floor'){
      const img = atlas['floors'];
      if(img && img.complete && img.naturalWidth > 0){
        const cellW = 64, cellH = 48;
        const col = Math.floor(def.rect[0]/cellW), row = Math.floor(def.rect[1]/cellH);
        ctx.drawImage(img, col*cellW, row*cellH, cellW, cellH, 0, 0, 48, 48);
        return;
      }
    }
    // fallback
    ctx.fillStyle = '#555';
    ctx.fillRect(4, 4, 40, 40);
  }

  _decorName(id){
    const def = MAT.obj[id];
    if(def) return def.name || def.nameJP || ('#' + id);
    return '#' + id;
  }
  _decorIcon(id){
    const icons = {
      grass_tuft:'🌿', grass_tall:'🌾', flower_red:'🌸', flower_yellow:'🌻',
      flower_white:'🌼', mushroom:'🍄', pebble:'🪨', crack:'〰',
      vine:'🍃', torch:'🔥', crystal:'💎', bone:'🦴', puddle:'💧',
    };
    return icons[id] || '◆';
  }

  _buildPlace(gx, gy){
    if(!this.buildMode || this.buildMode.selected == null) return;
    if(gx < 0 || gy < 0 || gx >= this.map.w || gy >= this.map.h) return;
    const cat = this.buildMode.cat;
    const id = this.buildMode.selected;
    if(cat === 'decor'){
      // 地面装饰物（Elin objs 图集均为地面物件）
      this.map.addDecoration(gx, gy, id, null);
      this.log(`放置 ${this._decorName(id)}`, 'info');
    } else if(cat === 'wall' || cat === 'floor'){
      // 不能覆盖特殊瓦片（楼梯/门/祭坛/宝箱）
      if(this.map.specialAt(gx, gy)){ this.log('不能覆盖特殊瓦片', 'warn'); return; }
      if(cat === 'wall'){
        // 放置方块：堆叠到现有方块上方
        const ent = this.map.entityAt(gx, gy);
        if(ent){ this.log('该位置有生物', 'warn'); return; }
        const bt = MAT.block[id];
        if(bt){
          const existing = this.map.getBlocks(gx, gy) || [];
          this.map.setBlocks(gx, gy, [...existing, id]);
          this.log(`放置 ${bt.name || id}（高度${existing.length + 1}）`, 'info');
        }
      } else {
        // 放置地板
        this.map.setTile(gx, gy, id);
        this.log(`放置 ${MAT.floor[id]?.name || id}`, 'info');
      }
    }
  }

  _buildRemove(gx, gy){
    if(gx < 0 || gy < 0 || gx >= this.map.w || gy >= this.map.h) return;
    // 先尝试拆除装饰物
    const removed = this.map.removeDecorationAt(gx, gy);
    if(removed){
      this.log(`拆除 ${this._decorName(removed.type)}`, 'info');
      return;
    }
    // 尝试拆除方块（从顶往下拆）
    if(this.map.hasBlocks(gx, gy)){
      const blocks = this.map.getBlocks(gx, gy);
      const lastId = blocks[blocks.length - 1];
      const bt = MAT.block[lastId];
      this.map.setBlocks(gx, gy, blocks.slice(0, -1));
      this.log(`拆除 ${bt?.name || '方块'}（剩余${Math.max(0, blocks.length-1)}层）`, 'info');
      return;
    }
    // 没有方块，尝试拆除特殊地板（恢复为默认 floor）
    if(this.map.specialAt(gx, gy)){ this.log('不能拆除特殊瓦片', 'warn'); return; }
    const tile = this.map.get(gx, gy);
    if(!tile) return;
    this.map.setTile(gx, gy, 'floor');
    this.log(`拆除 ${tile.name || '地板'}`, 'info');
  }

  // ========== 日志 ==========
  log(text, type='info'){
    this.ui.log(text, type);
    this.messages.push({text, type, t: Date.now()});
  }

  _updateHUD(){
    this.ui.updateHUD(this.player, this.gs);
    this.ui.setSpellCastCallback((sid)=>this.tryCastSpell(sid));
  }
}

// 启动
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadSource();           // 加载 Elin SourceData (sources.json + lang_zh.json)
  window.game = new Game();
  // 调试便利：暴露材质表
  window.MAT = MAT;
  window.GROUPS = GROUPS;
  window.BIOMES = BIOMES;
});
