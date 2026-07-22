// ===== 世界系统：World > Region > Zone > Map（匹配Elin原版架构）=====
//
// Elin的世界结构：
//   World（根节点，管理日期/天气/季节）
//     └── Region（大地地图，有地形/城镇/地下城入口）
//           ├── Zone_Town（城镇，放在大地图上）
//           ├── Zone_Field（野外区域）
//           └── Zone_Dungeon（地下城，通过楼梯进入）
//                 └── Zone（子层级：lv=-1, -2, -3...）
//
// 玩家在大地地图上行走，走到城镇/地下城入口时切换到对应Zone的地图。

import { RNG } from './rng.js';
import { makeMonster } from './entity.js';
import { makeItem, qualityMult } from './item.js';
import { makeNPC } from './npc.js';
import { MAT, GROUPS, BIOMES } from './materials.js';
import { MONSTERS } from './data.js';

// 原版 Elin 分组语义：语义字符串 → xlsx 数字 id（按 biome/defMat 归类）
// 仅作生成期字面量兼容；地图存储层与渲染层全部是纯数字 id。
const G = GROUPS;

// ---- 地面语义 → 数字 id ----
// ===== 地面语义 → 真实 Elin 地板 id =====
// 原版 Elin 的单体地图/地牢生成是“按 biome 选一种地板”（见 Elin-Decompiled 的
// MapGenDungen.cs / BiomeProfile.cs：地板来自 zone.biome.exterior.floor / interior.floor），
// 并非随机挑。此前这些语义被错配到 G.floor.stone[0..4]（含 pedestal=104 / alien floor=131/134），
// 造成“泥土斑块变石头”“地牢混入草地”等不合理现象。这里映射到正确的 Elin 地板 id。
const FLOOR_SEM = {
  grass:      G.floor.grass[0],                                                          // 113 bush/grass
  grass_dark: G.floor.grass[1] != null ? G.floor.grass[1] : G.floor.grass[0],            // 114
  moss:       G.floor.grass[2] != null ? G.floor.grass[2] : G.floor.grass[0],            // 75 grass（苔藓=暗草，可接受）
  dirt:       100,                                                                        // 100 barren soil floor（真实泥土，不再是石地板）
  floor:      6,                                                                          // 6  stone floor（修正 pedestal=104）
  floor_dark: 15,                                                                         // 15 stone floor（修正 alien=131）
  stone_path: 14,                                                                         // 14 stone floor（修正 alien=134）
  rubble:     29,                                                                         // 29 stone floor（碎石）
  cave:       99,                                                                         // 99 cave floor（地牢房间用）
  sand:       G.floor.sand[0],                                                            // 33 sand floor
  snow:       G.floor.snow ? G.floor.snow[0] : 6,                                         // 39 snow floor
  ice:        G.floor.ice ? G.floor.ice[0] : 38,                                          // 38 ice floor
  wood:       G.floor.wood ? G.floor.wood[0] : 126,                                       // 126 wooden floor
  water:      (G.floor.water_shallow && G.floor.water_shallow[0]) != null ? G.floor.water_shallow[0] : 73,
  water_deep: (G.floor.water_deep && G.floor.water_deep[0]) != null ? G.floor.water_deep[0] : 72,
  wall:       6,                                                                          // 越界地形用石地板（实心由方块提供）
};
// 每个地面数字 id 归属的分组（用于装饰物选择）
const FLOOR_GROUP = {};
for(const [k, arr] of Object.entries(G.floor)){
  if(!arr) continue;
  for(const id of arr){ if(FLOOR_GROUP[id] === undefined) FLOOR_GROUP[id] = k; }
}

// ---- 方块语义 → 数字 id ----
// 每个语义映射到 Elin 中真实存在的「不同」墙块 id（此前全部指向 wall[0]=0 空块，导致所有墙一样）。
// 真实墙块：石墙(granite)=9/16/19/20/21/140/151；木板(oak)=22/30/31/32/145/146；砖墙(mud)=138/50；
// 沙墙=33；雪墙=36；冰墙=35；岩浆(magma)=201/18；暗黑(slate/cobalt)=207/191；玻璃=12/14；
// 半高块=11(石)/5(土)；柱(pillar, 通透)=67-72。
// 务必避开编辑块：128(隐身)/149(室内)/150(室外)/205(云)。
const BLOCK_SEM = {
  wall:        9,    // stone block (granite) — 默认石墙
  stone_wall:  9,    // stone block
  wood_wall:   22,   // wood block (oak)
  brick_wall:  138,  // brick block (mud)
  dark_wall:   207,  // alien block (slate) — 暗黑主题
  cobble_wall: 143,  // stone block (granite) 变体
  mossy_wall:  16,   // stone block (granite) 变体（偏苔绿感）
  dark_stone:  191,  // unknown block (cobalt) — 蓝暗石
  sand_wall:   33,   // sand block
  smooth_stone:151,  // plain block (granite)
  stone_half:  11,   // stone step (HalfBlock, h=0.5)
  wood_half:   5,    // natural step (HalfBlock, h=0.5)
  wood_fence:  69,   // wooden pillar（通透栅栏柱）
  stone_fence: 71,   // stone pillar（通透栅栏柱）
  iron_bars:   12,   // glass block（通透栅栏）
};

// ---- 地牢主题（按 dangerLv 切换，参考原版 BiomeProfile 单一 biome→地板/墙）----
// 原版地牢整张用 biome.exterior.floor + biome.exterior.block 一种地板+一种墙；深度越高分配越危险的 BiomeProfile。
// 这里用 dangerLv 分三档：低级=石质、中级=洞穴、高级=熔岩/暗黑。
const DUNGEON_THEMES = [
  // tier 0：低级 石质地牢
  { name:'stone', lvMax:3,  floors:[6,14,15,99],  wall:9,   wallVar:16,  wallVarChance:0.25 },
  // tier 1：中级 洞穴地牢
  { name:'cave',  lvMax:7,  floors:[99,6,14,16],  wall:16,  wallVar:151, wallVarChance:0.30 },
  // tier 2：高级 熔岩/暗黑地牢
  { name:'lava',  lvMax:99, floors:[20,99,6,18],  wall:201, wallVar:207, wallVarChance:0.30 },
];
function pickDungeonTheme(lv){
  const L = (typeof lv === 'number' && isFinite(lv)) ? Math.abs(lv) : 1;
  for(const t of DUNGEON_THEMES){ if(L <= t.lvMax) return t; }
  return DUNGEON_THEMES[DUNGEON_THEMES.length - 1];
}

// ---- 装饰物语义 → obj 数字 id ----
const DEC_KEY = {};
for(const [k, arr] of Object.entries(G.obj)){
  if(arr && arr.length && DEC_KEY[k] === undefined) DEC_KEY[k] = arr[0];
}
const firstObj = (g) => (G.obj[g] && G.obj[g][0]) || null;
DEC_KEY.grass_tuft    = firstObj('grass');
DEC_KEY.grass_tall    = (G.obj.grass && G.obj.grass[1]) || firstObj('grass');
DEC_KEY.flower_red    = firstObj('flower');
DEC_KEY.flower_yellow = (G.obj.flower && G.obj.flower[1]) || firstObj('flower');
DEC_KEY.flower_white  = (G.obj.flower && G.obj.flower[2]) || firstObj('flower');
DEC_KEY.mushroom      = firstObj('mushroom');
DEC_KEY.tree          = firstObj('tree');
DEC_KEY.rock          = firstObj('rock');
DEC_KEY.bone          = firstObj('bone');
DEC_KEY.crystal       = firstObj('crystal');
DEC_KEY.shell         = firstObj('shell');
DEC_KEY.bush          = firstObj('bush');

// 特殊瓦片：底层放一个地板，再打 special 标记（楼梯/门/祭坛/宝箱）
const SPECIALS = {
  stairs_dn:  { kind: 'stairs_dn',  base: FLOOR_SEM.floor },
  stairs_up:  { kind: 'stairs_up',  base: FLOOR_SEM.floor },
  door:       { kind: 'door',       base: FLOOR_SEM.floor },
  altar:      { kind: 'altar',      base: FLOOR_SEM.floor },
  chest_tile: { kind: 'chest',      base: FLOOR_SEM.floor },
};
const isSpecialKey = (id) => typeof id === 'string' && SPECIALS[id];

// ---- id 解析（字符串语义 → 数字）----
function resolveFloorId(id){
  if(id == null) return FLOOR_SEM.floor;
  if(typeof id === 'number') return id;
  if(typeof id === 'string'){
    if(isSpecialKey(id)) return SPECIALS[id].base;
    if(FLOOR_SEM[id] !== undefined) return FLOOR_SEM[id];
    if(/^\d+$/.test(id)) return parseInt(id, 10);
    console.warn('[world] 未知地面语义:', id);
    return FLOOR_SEM.floor;
  }
  return FLOOR_SEM.floor;
}
function resolveBlockId(id){
  if(typeof id === 'number') return id;
  if(typeof id === 'string'){
    if(BLOCK_SEM[id] !== undefined) return BLOCK_SEM[id];
    if(/^\d+$/.test(id)) return parseInt(id, 10);
    return BLOCK_SEM.wall;
  }
  return BLOCK_SEM.wall;
}
function resolveObjId(id){
  if(typeof id === 'number') return id;
  if(typeof id === 'string'){
    if(DEC_KEY[id] !== undefined) return DEC_KEY[id];
    if(/^\d+$/.test(id)) return parseInt(id, 10);
    return null;
  }
  return null;
}
const isFloor = (tid, key) => tid === FLOOR_SEM[key];
// 是否为任意地板（属于某个 floor 分组），用于主题化后判断"已开挖/房间地板"
const isAnyFloor = (tid) => FLOOR_GROUP[tid] !== undefined;

// ==================== GameMap（实际的瓦片网格）====================
export class GameMap{
  constructor(w, h){
    this.w = w; this.h = h;
    this.tiles = [];
    this.blocks = [];
    this.decorations = [];
    this.special = {};
    this._decorGrid = null;
    this.explored = [];
    this.visible = [];
    this.entities = [];
    this.items = [];
    this.depth = 1;
    this.name = '未知区域';
    this.stairsDown = null;
    this.stairsUp = null;
    this.rooms = [];
    this.isTown = false;
    this.isWorld = false;
    this._visibleZ = [];
    // 3D可见性：vis3D[y][x] = 位掩码，bit z=1 表示z层空气可见
    this.vis3D = [];
    this.exp3D = [];
    for(let y=0;y<h;y++){
      this.tiles.push(new Array(w).fill(FLOOR_SEM.floor));
      this.blocks.push(new Array(w).fill(null));
      this.explored.push(new Array(w).fill(false));
      this.visible.push(new Array(w).fill(false));
      this._visibleZ.push(new Array(w).fill(null));
      this.vis3D.push(new Array(w).fill(0));
      this.exp3D.push(new Array(w).fill(0));
    }
  }
  get(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return null;
    return MAT.floor[this.tiles[y][x]] || null;
  }
  tileId(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return FLOOR_SEM.floor;
    return this.tiles[y][x];
  }
  specialAt(x,y){
    return this.special[x + ',' + y] || null;
  }
  setSpecial(x,y,kind){
    if(x<0||y<0||x>=this.w||y>=this.h) return;
    this.special[x + ',' + y] = kind;
  }
  // ---- 方块堆叠系统 ----
  hasBlocks(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return false;
    const b = this.blocks[y][x];
    return b && b.length > 0;
  }
  getBlocks(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return null;
    return this.blocks[y][x];
  }
  setBlocks(x,y,blockIds){
    if(x<0||y<0||x>=this.w||y>=this.h) return;
    this.blocks[y][x] = (blockIds && blockIds.length > 0) ? blockIds.map(resolveBlockId) : null;
  }
  clearBlocks(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return;
    this.blocks[y][x] = null;
  }
  hasSolidBlocks(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return true;
    const b = this.blocks[y][x];
    if(!b) return false;
    return b.some(id => { const bt = MAT.block[id]; return bt && bt.solid; });
  }
  blockHeightAt(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return 0;
    const b = this.blocks[y][x];
    if(!b) return 0;
    let h = 0;
    for(const id of b){ const bt = MAT.block[id]; if(bt) h += bt.h; }
    return h;
  }
  isSolid(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return true;
    const t = this.get(x,y);
    if(t && t.solid) return true;
    return this.hasSolidBlocks(x,y);
  }
  isWalkable(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return false;
    const t = this.get(x,y);
    if(!t || !t.walkable) return false;
    if(this.hasSolidBlocks(x,y)) return false;
    for(const e of this.entities){
      if(e.x===x && e.y===y && e.blocksMove && e.alive) return false;
    }
    return true;
  }
  entityAt(x,y){
    return this.entities.find(e=>e.x===x&&e.y===y&&e.alive);
  }
  itemAt(x,y){
    return this.items.find(it=>it.x===x&&it.y===y);
  }
  setTile(x,y,id){
    if(x<0||y<0||x>=this.w||y>=this.h) return;
    if(isSpecialKey(id)){
      this.tiles[y][x] = SPECIALS[id].base;
      this.setSpecial(x, y, SPECIALS[id].kind);
      return;
    }
    this.tiles[y][x] = resolveFloorId(id);
  }

  // ---- 建造模式 ----
  addDecoration(x, y, type, face){
    if(x<0||y<0||x>=this.w||y>=this.h) return null;
    const oid = resolveObjId(type);
    const def = MAT.obj[oid];
    if(!def) return null;
    const scale = (def.minS != null) ? (def.minS + Math.random() * (def.maxS - def.minS)) : (0.85 + Math.random() * 0.3);
    const ox = (Math.random() - 0.5) * 20;
    const oy = (Math.random() - 0.5) * 12;
    const phase = Math.random() * Math.PI * 2;
    const decor = {x, y, type: oid, ox, oy, scale, phase, face: face || null, userPlaced: true};
    this.decorations.push(decor);
    const key = x + ',' + y;
    if(!this._decorGrid[key]) this._decorGrid[key] = [];
    this._decorGrid[key].push(decor);
    return decor;
  }
  removeDecorationAt(x, y){
    const key = x + ',' + y;
    const list = this._decorGrid[key];
    if(!list || list.length === 0) return null;
    const decor = list.pop();
    const idx = this.decorations.indexOf(decor);
    if(idx >= 0) this.decorations.splice(idx, 1);
    if(list.length === 0) delete this._decorGrid[key];
    return decor;
  }
  getDecorationsAt(x, y){
    const key = x + ',' + y;
    return this._decorGrid[key] || [];
  }
}

// ==================== Zone（游戏区域）====================
// Zone 是世界树的基本单元：城镇、野外、地下城都是 Zone
export class Zone {
  constructor(id, name, opts = {}){
    this.id = id;
    this.uid = Zone._nextUid++;
    this.name = name;
    this.parent = null;
    this.children = [];
    // 在大地图上的坐标
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    // 深度层级：0=地面，负数=地下，正数=空中
    this.lv = opts.lv || 0;
    this.dangerLv = opts.dangerLv || 0;
    // 区域类型
    this.biome = opts.biome || 'temperate';
    this.faction = opts.faction || null;
    this.isTown = opts.isTown || false;
    this.isDungeon = opts.isDungeon || false;
    this.isField = opts.isField || false;
    this.isNefia = opts.isNefia || false;  // 随机地下城
    // 关联的地图
    this.map = null;
    // 生成器类型
    this.generator = opts.generator || null;  // 'town', 'dungeon', 'field', 'region'
    // 地下城分支
    this.branch = opts.branch || null;
    // 状态
    this.visited = false;
    this.discovered = false;
    this.isConquered = false;
    // 出生点/楼梯标记
    this.spawnPos = opts.spawnPos || null;
    this.hasLaw = opts.hasLaw || false;
    this.regenerateOnEnter = opts.regenerateOnEnter || false;
  }

  get topZone(){
    let z = this;
    while(z.parent) z = z.parent;
    return z;
  }

  get dangerLevel(){
    return this.topZone.dangerLv + Math.abs(this.lv) - 1;
  }

  get isRegion(){
    return false;
  }

  addChild(child){
    child.parent = this;
    this.children.push(child);
    return child;
  }

  // 查找指定层级的子区域
  findZone(lv){
    return this.children.find(z => z.lv === lv);
  }

  // 查找或创建指定层级
  findOrCreateLevel(lv, rng){
    let z = this.findZone(lv);
    if(!z){
      z = new Zone(this.id + '_' + lv, this.name + ' ' + Math.abs(lv) + 'F', {
        lv: lv,
        dangerLv: this.dangerLv,
        isDungeon: true,
        generator: 'dungeon',
        branch: this.branch,
      });
      this.addChild(z);
    }
    return z;
  }

  // 激活区域（加载/生成地图）
  activate(map){
    this.map = map;
    this.visited = true;
    this.discovered = true;
  }

  // 停用区域（卸载地图）
  deactivate(){
    this.map = null;
  }

  // 生成地图
  generate(rng){
    if(this.map) return this.map;
    let map;
    if(this.generator === 'town'){
      map = _generateTownMap(this, rng);
    } else if(this.generator === 'dungeon'){
      map = _generateDungeonMap(this, rng);
    } else if(this.generator === 'field'){
      map = _generateFieldMap(this, rng);
    } else {
      map = _generateFieldMap(this, rng);
    }
    this.activate(map);
    return map;
  }
}
Zone._nextUid = 1;

// ==================== Region（大地地图 / 表世界）====================
// Region 是玩家的主要活动区域，包含城镇、野外、地下城入口
export class Region extends Zone {
  constructor(id, name, opts = {}){
    super(id, name, opts);
    this.isField = true;
    this.generator = 'region';
    // 大地图网格（类似 Elin 的 EloMap）
    this.regionW = opts.regionW || 80;   // 大地图宽（格子数）
    this.regionH = opts.regionH || 60;   // 大地图高
    // 大地图地形网格：每个格子记录地形类型
    this.terrain = [];   // terrain[y][x] = { biome, site, ... }
    // 区域内的地点（城镇、地下城入口等）
    this.sites = [];
    // 地下城列表
    this.dungeons = [];
    // 随机地下城目标数量
    this.nefiaTarget = 12;
  }

  get isRegion(){ return true; }

  // 初始化大地图地形网格
  initTerrain(){
    this.terrain = [];
    for(let y = 0; y < this.regionH; y++){
      this.terrain[y] = [];
      for(let x = 0; x < this.regionW; x++){
        this.terrain[y][x] = { biome: 'plain', site: null, zone: null };
      }
    }
  }

  // 在大地图上放置地点
  addSite(site, gx, gy){
    site.x = gx;
    site.y = gy;
    this.sites.push(site);
    this.addChild(site);
    if(gx >= 0 && gy >= 0 && gx < this.regionW && gy < this.regionH){
      this.terrain[gy][gx].site = site;
      this.terrain[gy][gx].zone = site;
    }
    return site;
  }
}

// ==================== World（世界根节点）====================
export class World {
  constructor(){
    this.regions = [];
    this.date = { day:1, hour:8, season:'春' };
    this.weather = '晴';
    this.activeZone = null;
    this.activeRegion = null;
  }

  addRegion(region){
    this.regions.push(region);
    return region;
  }

  get activeMap(){
    return this.activeZone ? this.activeZone.map : null;
  }
}

// ==================== ZoneTransition（区域切换）====================
// 类似 Elin 的 ZoneTransition：记录切换方向/位置/类型
export const EnterState = {
  Auto: 0,
  Center: 1,
  Top: 2,
  Right: 3,
  Bottom: 4,
  Left: 5,
  Down: 6,    // 下楼梯
  Up: 7,      // 上楼梯
  Return: 8,  // 返回上一区域
  Exact: 9,   // 精确坐标
  Region: 10, // 进入大地图
};

export class ZoneTransition {
  constructor(opts = {}){
    this.uidLastZone = opts.uidLastZone || 0;
    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.state = opts.state || EnterState.Auto;
    this.idTele = opts.idTele || null;
    this.ratePos = opts.ratePos || 0;
  }
}

// ==================== 大地图地形类型 ====================
const REGION_TERRAIN = {
  plain:    { walkable: true,  tile: 'grass',       name: '平原',   dangerMod: 0 },
  forest:   { walkable: true,  tile: 'grass_dark',  name: '森林',   dangerMod: 1 },
  hill:     { walkable: true,  tile: 'dirt',        name: '丘陵',   dangerMod: 2 },
  mountain: { walkable: false, tile: 'wall',        name: '山脉',   dangerMod: 5 },
  water:    { walkable: false, tile: 'water',       name: '水域',   dangerMod: 0 },
  beach:    { walkable: true,  tile: 'sand',        name: '海滩',   dangerMod: 0 },
  road:     { walkable: true,  tile: 'stone_path',  name: '道路',   dangerMod: 0 },
  swamp:    { walkable: true,  tile: 'moss',        name: '沼泽',   dangerMod: 3 },
  snow:     { walkable: true,  tile: 'snow',        name: '雪原',   dangerMod: 2 },
  desert:   { walkable: true,  tile: 'sand',        name: '沙漠',   dangerMod: 1 },
};

// ==================== 大地图生成器（MapGenRegion）====================
// 类似 Elin 的 MapGenRegion：读取地形数据生成实际可行走的地图
export function generateRegion(rng, seed = 0){
  const regionW = 80, regionH = 60;
  const mapW = 64, mapH = 48;
  const region = new Region('main', '雅拉大陆', { regionW, regionH });
  region.initTerrain();

  // 1. 用噪声生成大地图地形
  _genTerrainNoise(region, rng);

  // 2. 确保有道路
  _genRoads(region, rng);

  // 3. 放置城镇（固定位置）
  _placeTowns(region, rng);

  // 4. 放置地下城入口（Nefia）
  _placeNefia(region, rng);

  // 5. 生成实际可行走的 Region 地图
  const map = new GameMap(mapW, mapH);
  map.name = region.name;
  map.isWorld = true;
  map.isTown = false;

  // 将大地图地形映射到 Region 地图
  _renderRegionMap(region, map, rng);

  region.activate(map);
  return region;
}

// ---- 噪声地形生成 ----
// ---- 分形值噪声（多倍频，参考原版 biome 由连续场驱动，避免硬边界）----
function _vhash(ix, iy, seed){
  // 标准 32 位整数哈希（Math.imul 保证 32 位乘法，>>> 无符号移位，避免符号偏置）
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function _smoothstep(t){ return t * t * (3 - 2 * t); }
function _valueNoise(x, y, seed){
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const v00 = _vhash(x0,   y0,   seed);
  const v10 = _vhash(x0+1, y0,   seed);
  const v01 = _vhash(x0,   y0+1, seed);
  const v11 = _vhash(x0+1, y0+1, seed);
  const sx = _smoothstep(fx), sy = _smoothstep(fy);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
}
function _fbm(x, y, seed, octaves){
  octaves = octaves || 4;
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for(let o = 0; o < octaves; o++){
    sum += amp * _valueNoise(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

function _genTerrainNoise(region, rng){
  const W = region.regionW, H = region.regionH;
  const seed = rng ? rng.int(1, 99999) : 12345;
  const SC = 0.12, OCT = 5;
  // 1. 连续场：高程(fbm) + 湿度(另一 seed 的 fbm)
  const elev = new Float32Array(W * H), moist = new Float32Array(W * H);
  for(let y = 0; y < H; y++)
    for(let x = 0; x < W; x++){
      const i = y * W + x;
      elev[i]  = _fbm(x * SC, y * SC, seed, OCT);
      moist[i] = _fbm(x * SC + 50, y * SC + 50, seed + 777, 4);
    }
  // 2. 轻度 3x3 模糊，消除单格噪点，使 biome 过渡更自然
  const e2 = new Float32Array(W * H);
  for(let y = 0; y < H; y++)
    for(let x = 0; x < W; x++){
      let s = 0, c = 0;
      for(let dy = -1; dy <= 1; dy++)
        for(let dx = -1; dx <= 1; dx++){
          const nx = x + dx, ny = y + dy;
          if(nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          s += elev[ny * W + nx]; c++;
        }
      e2[y * W + x] = s / c;
    }
  // 3. 由 高程/湿度/纬度 分配 biome（参考 Elin BiomProfile 连续映射）
  for(let y = 0; y < H; y++)
    for(let x = 0; x < W; x++){
      const i = y * W + x;
      const e = e2[i], m = moist[i];
      const lat = y / H, cold = Math.abs(lat - 0.5) * 2; // 0 中部 1 边缘（冷）
      let biome;
      if(e < 0.42) biome = 'water';
      else if(e < 0.46) biome = 'beach';
      else if(e > 0.82) biome = 'mountain';
      else if(cold > 0.70 && e > 0.55) biome = 'snow';
      else if(m < 0.26 && e > 0.46) biome = 'desert';
      else if(m > 0.68) biome = 'swamp';
      else if(m > 0.50 || e > 0.60) biome = 'forest';
      else if(e > 0.50) biome = 'hill';
      else biome = 'plain';
      region.terrain[y][x].biome = biome;
    }
}

// 简单伪噪声函数
function _simpleNoise(x, y, W, H){
  const nx = x / W, ny = y / H;
  let v = 0;
  v += Math.sin(nx * 6.28 + 0.5) * 0.3;
  v += Math.cos(ny * 6.28 + 1.2) * 0.3;
  v += Math.sin((nx + ny) * 4.7 + 0.8) * 0.2;
  v += Math.cos((nx - ny) * 3.5 + 2.1) * 0.2;
  v = (v + 1) / 2;
  return Math.max(0, Math.min(1, v));
}

// ---- 道路生成 ----
function _genRoads(region, rng){
  const W = region.regionW, H = region.regionH;
  // 东西向主干道
  const roadY = Math.floor(H / 2) + rng.int(-3, 3);
  for(let x = 0; x < W; x++){
    if(region.terrain[roadY][x].biome !== 'water'){
      region.terrain[roadY][x].biome = 'road';
    }
  }
  // 南北向主干道
  const roadX = Math.floor(W / 2) + rng.int(-3, 3);
  for(let y = 0; y < H; y++){
    if(region.terrain[y][roadX].biome !== 'water'){
      region.terrain[y][roadX].biome = 'road';
    }
  }
}

// ---- 城镇放置 ----
function _placeTowns(region, rng){
  const W = region.regionW, H = region.regionH;
  const townDefs = [
    { name: '维尔尼斯', desc: '新手城镇', icon: '🏘️' },
    { name: '卡普尔',   desc: '首都',     icon: '🏰' },
    { name: '诺亚',     desc: '港口城镇', icon: '⚓' },
  ];
  for(const def of townDefs){
    let placed = false;
    for(let i = 0; i < 200 && !placed; i++){
      const gx = rng.int(5, W - 5);
      const gy = rng.int(5, H - 5);
      const tile = region.terrain[gy][gx];
      if(tile.biome === 'water' || tile.biome === 'mountain') continue;
      if(tile.site) continue;
      // 城镇周围应有道路
      const hasRoad = _hasNeighborBiome(region, gx, gy, 'road', 3);
      const town = new Zone(def.name, def.name, {
        x: gx, y: gy,
        isTown: true,
        hasLaw: true,
        generator: 'town',
        dangerLv: 0,
      });
      town.townDef = def;
      region.addSite(town, gx, gy);
      placed = true;
    }
  }
}

// ---- Nefia 随机地下城放置 ----
function _placeNefia(region, rng){
  const W = region.regionW, H = region.regionH;
  const types = [
    { id: 'dungeon',      name: '地下城',   icon: '🕳️', dangerMod: 0 },
    { id: 'dungeon_ruins', name: '遗迹',     icon: '🏛️', dangerMod: 1 },
    { id: 'cavern',       name: '洞窟',     icon: '⛰️', dangerMod: 2 },
    { id: 'tower',        name: '魔塔',     icon: '🗼', dangerMod: 3 },
  ];
  let placed = 0;
  for(let i = 0; i < 300 && placed < region.nefiaTarget; i++){
    const gx = rng.int(3, W - 3);
    const gy = rng.int(3, H - 3);
    const tile = region.terrain[gy][gx];
    if(tile.biome === 'water' || tile.biome === 'mountain') continue;
    if(tile.site) continue;
    // 距离城镇不能太近
    if(_nearbySiteType(region, gx, gy, 'isTown', 5)) continue;

    const typeDef = rng.pick(types);
    const dangerLv = Math.max(1, Math.floor(_simpleNoise(gx, gy, W, H) * 10) + typeDef.dangerMod);
    const nefia = new Zone(typeDef.id + '_' + placed, typeDef.name, {
      x: gx, y: gy,
      isDungeon: true,
      isNefia: true,
      generator: 'dungeon',
      dangerLv: dangerLv,
      regenerateOnEnter: true,
    });
    nefia.icon = typeDef.icon;
    region.addSite(nefia, gx, gy);
    region.dungeons.push(nefia);
    placed++;
  }
}

// ---- 辅助函数 ----
function _hasNeighborBiome(region, x, y, biome, radius){
  for(let dy = -radius; dy <= radius; dy++){
    for(let dx = -radius; dx <= radius; dx++){
      const nx = x + dx, ny = y + dy;
      if(nx < 0 || ny < 0 || nx >= region.regionW || ny >= region.regionH) continue;
      if(region.terrain[ny][nx].biome === biome) return true;
    }
  }
  return false;
}

function _nearbySiteType(region, x, y, typeCheck, radius){
  for(const site of region.sites){
    const d = Math.abs(site.x - x) + Math.abs(site.y - y);
    if(d <= radius && site[typeCheck]) return true;
  }
  return false;
}

// ---- 渲染 Region 实际地图 ----
function _renderRegionMap(region, map, rng){
  const W = map.w, H = map.h;
  const sx = Math.floor(region.regionW / 2 - W / 2);
  const sy = Math.floor(region.regionH / 2 - H / 2);

  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      const gx = sx + x, gy = sy + y;
      if(gx < 0 || gy < 0 || gx >= region.regionW || gy >= region.regionH){
        map.setTile(x, y, 'wall');
        map.setBlocks(x, y, ['stone_wall']);
        continue;
      }
      const tile = region.terrain[gy][gx];
      const tdef = REGION_TERRAIN[tile.biome];
      if(tdef){
        map.setTile(x, y, tdef.tile);
        if(!tdef.walkable){
          map.setBlocks(x, y, ['stone_wall']);
        }
      }
      // 放置地点标记
      if(tile.site){
        if(tile.site.isTown){
          // 城镇：生成建筑群
          _renderTownOnRegion(map, x, y, tile.site, rng);
        } else if(tile.site.isDungeon){
          // 地下城入口：放楼梯
          map.setTile(x, y, 'stairs_dn');
          map.clearBlocks(x, y);
        }
      }
    }
  }

  // 装饰物
  generateDecorations(map, rng);

  // 玩家出生点：城镇中心
  const firstTown = region.sites.find(s => s.isTown);
  if(firstTown){
    const tx = firstTown.x - sx;
    const ty = firstTown.y - sy;
    map.stairsUp = { x: tx, y: ty };
  } else {
    map.stairsUp = { x: Math.floor(W/2), y: Math.floor(H/2) };
  }
}

// ---- 在 Region 地图上渲染城镇标记 ----
// 大地图上城镇只显示为一个小标记，不是建筑群
function _renderTownOnRegion(map, cx, cy, townZone, rng){
  // 城镇标记：3x3 平地 + 中心标记
  const size = 1;
  for(let dy = -size; dy <= size; dy++){
    for(let dx = -size; dx <= size; dx++){
      const x = cx + dx, y = cy + dy;
      if(x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      map.setTile(x, y, 'floor');
      map.clearBlocks(x, y);
    }
  }
  // 中心放楼梯（进入城镇）
  map.setTile(cx, cy, 'stairs_dn');
  map.clearBlocks(cx, cy);
  // 标记城镇名称（通过 NPC 或日志显示）
  townZone._regionMarker = { x: cx, y: cy };
}

// ==================== 城镇地图生成 ====================
// 生成城镇内部地图（从 Region 进入时）
export function generateTown(rng, depth = 0){
  const W = 40, H = 36;
  const map = new GameMap(W, H);
  map.name = _townName(rng);
  map.isTown = true;
  map.depth = 0;

  // 填充草地 + 围墙
  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      map.setTile(x, y, 'grass');
    }
  }

  // 外围木墙
  for(let x = 0; x < W; x++){
    map.setBlocks(x, 0, ['wood_wall']);
    map.setBlocks(x, H-1, ['wood_wall']);
  }
  for(let y = 0; y < H; y++){
    map.setBlocks(0, y, ['wood_wall']);
    map.setBlocks(W-1, y, ['wood_wall']);
  }

  // ---- 生成建筑群 ----
  const buildings = [];
  const buildingDefs = [
    { name:'酒馆',   w:7, h:5, floor:'floor',      npc:'innkeeper',  items:['ration','bread','meat'], kind:'inn' },
    { name:'商店',   w:6, h:5, floor:'floor',      npc:'merchant',   items:['potion_heal','torch','arrow'], kind:'shop' },
    { name:'祭坛',   w:5, h:5, floor:'stone_path', npc:'priest',     items:[], kind:'altar' },
    { name:'铁匠铺', w:6, h:4, floor:'dirt',       npc:'guard',      items:['ore'], kind:'store' },
    { name:'民居A',  w:5, h:4, floor:'floor',      npc:'citizen',    items:['bread'], kind:'home' },
    { name:'民居B',  w:5, h:4, floor:'floor',      npc:'citizen',    items:['ration'], kind:'home' },
    { name:'仓库',   w:4, h:4, floor:'dirt',       npc:null,         items:['herb','ore','seed'], kind:'store' },
    { name:'农田',   w:7, h:5, floor:'dirt',       npc:null,         items:[], kind:'farm', farm:true },
  ];

  // 放置建筑（避免重叠）
  const attempts = 200;
  for(const def of buildingDefs){
    let placed = false;
    for(let i = 0; i < attempts && !placed; i++){
      const bx = rng.int(3, W - def.w - 3);
      const by = rng.int(3, H - def.h - 3);
      let overlap = false;
      for(const b of buildings){
        if(bx - 1 < b.x + b.w && bx + def.w + 1 > b.x &&
           by - 1 < b.y + b.h && by + def.h + 1 > b.y){
          overlap = true;
          break;
        }
      }
      if(overlap) continue;

      const building = { ...def, x: bx, y: by };

      // 地板
      for(let y = by; y < by + def.h; y++){
        for(let x = bx; x < bx + def.w; x++){
          map.setTile(x, y, def.floor);
          map.clearBlocks(x, y);
        }
      }

      // 墙壁 + 门（农田为开放地块，无需围墙）
      if(!def.farm){
        for(let y = by - 1; y <= by + def.h; y++){
          map.setBlocks(bx - 1, y, ['wood_wall']);
          map.setBlocks(bx + def.w, y, ['wood_wall']);
        }
        for(let x = bx - 1; x <= bx + def.w; x++){
          map.setBlocks(x, by - 1, ['wood_wall']);
          map.setBlocks(x, by + def.h, ['wood_wall']);
        }

        // 门
        const doorX = bx + Math.floor(def.w / 2);
        const doorY = by + def.h;
        map.setTile(doorX, doorY, 'door');
        map.clearBlocks(doorX, doorY);
        building.door = {x: doorX, y: doorY};
      }

      // 祭坛特殊处理
      if(def.name === '祭坛'){
        const altarX = bx + Math.floor(def.w / 2);
        const altarY = by + 1;
        map.setTile(altarX, altarY, 'altar');
        map.clearBlocks(altarX, altarY);
      }

      // 室内物品
      for(const itemId of def.items){
        const ix = rng.int(bx + 1, bx + def.w - 2);
        const iy = rng.int(by + 1, by + def.h - 2);
        if(map.isWalkable(ix, iy) && !map.itemAt(ix, iy)){
          map.items.push({x: ix, y: iy, item: makeItem(itemId, 0, rng)});
        }
      }

      buildings.push(building);
      placed = true;
    }
  }

  // ---- 道路 ----
  for(let i = 0; i < buildings.length; i++){
    const a = buildings[i].door;
    if(!a) continue;
    let nearest = null, minDist = Infinity;
    for(let j = 0; j < buildings.length; j++){
      if(i === j) continue;
      const b = buildings[j].door;
      if(!b) continue;
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if(d < minDist){ minDist = d; nearest = b; }
    }
    if(nearest){
      _carveRoad(map, a.x, a.y, nearest.x, nearest.y, rng);
    }
  }

  // ---- 出口（返回大地图）----
  // 在城镇边缘放置出口（门），走到出口会返回大地图
  const exitX = Math.floor(W / 2);
  const exitY = H - 2;  // 底部边缘
  map.setTile(exitX, exitY, 'stairs_up');  // 用 stairs_up 标记返回
  map.clearBlocks(exitX, exitY);
  map.stairsUp = { x: exitX, y: exitY };  // 玩家出生点

  // 出口附近放门
  if(map.specialAt(exitX, exitY - 1) !== 'door'){
    map.setTile(exitX, exitY - 1, 'door');
    map.clearBlocks(exitX, exitY - 1);
  }

  // ---- 生成 NPC ----
  for(const b of buildings){
    if(b.npc){
      const nx = b.x + Math.floor(b.w / 2);
      const ny = b.y + Math.floor(b.h / 2);
      map.entities.push(makeNPC(b.npc, nx, ny, rng));
    }
  }

  const guardCount = rng.int(2, 3);
  for(let i = 0; i < guardCount; i++){
    const gx = rng.int(5, W - 5);
    const gy = rng.int(5, H - 5);
    if(map.isWalkable(gx, gy)){
      map.entities.push(makeNPC('guard', gx, gy, rng));
    }
  }

  map.entities.push(makeNPC('adventurer', rng.int(5, W-5), rng.int(5, H-5), rng));

  const citizenCount = rng.int(3, 5);
  for(let i = 0; i < citizenCount; i++){
    const cx = rng.int(5, W - 5);
    const cy = rng.int(5, H - 5);
    if(map.isWalkable(cx, cy)){
      map.entities.push(makeNPC('citizen', cx, cy, rng));
    }
  }

  generateTownDecorations(map, buildings, rng);
  detectRooms(map);
  detectRoomWalls(map, map.rooms);
  map.buildings = buildings;   // 供调试/后续逻辑区分室内外

  return map;
}

// ---- 城镇名称 ----
const TOWN_NAMES = [
  ['风','晨','星','月','花','叶','石','水','火','光'],
  ['息','镇','村','庄','港','集','落','堡','寨','城'],
];
function _townName(rng){
  const pre = rng.pick(TOWN_NAMES[0]);
  const suf = rng.pick(TOWN_NAMES[1]);
  return pre + suf;
}

// ---- 道路雕刻 ----
function _carveRoad(map, x1, y1, x2, y2, rng){
  let cx = x1, cy = y1;
  while(cx !== x2 || cy !== y2){
    if(isFloor(map.tileId(cx, cy), 'grass')){
      map.setTile(cx, cy, 'stone_path');
      map.clearBlocks(cx, cy);
    }
    if(rng.chance(0.5)){
      if(cx < x2) cx++;
      else if(cx > x2) cx--;
    } else {
      if(cy < y2) cy++;
      else if(cy > y2) cy--;
    }
  }
}

// ==================== 地下城地图生成 ====================
// Zone 内部调用：生成地下城地图
function _generateDungeonMap(zone, rng){
  const W = 48, H = 48;
  const map = new GameMap(W, H);
  map.depth = Math.abs(zone.lv) + 1;
  map.name = zone.name;

  // 主题：按 dangerLv 选 石质/洞穴/熔岩暗黑（参考原版 BiomeProfile 单一地板+墙）
  const theme = pickDungeonTheme(zone.lv);
  map.themeName = theme.name;
  map.primaryFloor = theme.floors[0];

  // 填充（整张地图一种墙 + 一种主地板，与原版 biome 一致）
  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      map.setTile(x, y, theme.floors[0]);
      map.setBlocks(x, y, [theme.wall]);
    }
  }

  // 房间生成
  const rooms = [];
  const maxRooms = 14;
  const minSize = 5, maxSize = 11;
  let attempts = 0;
  while(rooms.length < maxRooms && attempts < 200){
    attempts++;
    const rw = rng.int(minSize, maxSize);
    const rh = rng.int(minSize, maxSize);
    const rx = rng.int(1, W - rw - 2);
    const ry = rng.int(1, H - rh - 2);
    const room = {x:rx,y:ry,w:rw,h:rh,cx:Math.floor(rx+rw/2),cy:Math.floor(ry+rh/2)};
    let overlap = false;
    for(const r of rooms){
      if(rx-1 < r.x+r.w && rx+rw+1 > r.x && ry-1 < r.y+r.h && ry+rh+1 > r.y){ overlap=true; break; }
    }
    if(overlap) continue;
    for(let y = ry; y < ry+rh; y++)
      for(let x = rx; x < rx+rw; x++){
        map.setTile(x, y, theme.floors[0]);
        map.clearBlocks(x, y);
      }
    if(rooms.length > 0){
      const prev = rooms[rooms.length-1];
      carveCorridor(map, prev.cx, prev.cy, room.cx, room.cy, rng);
    }
    rooms.push(room);
  }
  map.rooms = rooms;

  const startRoom = rooms[0];
  const lastRoom = rooms[rooms.length-1];
  if(Math.abs(zone.lv) > 0){
    map.stairsUp = {x:startRoom.cx, y:startRoom.cy};
    map.setTile(startRoom.cx, startRoom.cy, 'stairs_up');
  } else {
    map.stairsUp = {x:startRoom.cx, y:startRoom.cy};
  }
  map.stairsDown = {x:lastRoom.cx, y:lastRoom.cy};
  map.setTile(lastRoom.cx, lastRoom.cy, 'stairs_dn');

  // 门
  for(const r of rooms){
    if(rng.chance(0.5)){
      const sides = [
        {x:r.x-1, y:r.cy},{x:r.x+r.w, y:r.cy},
        {x:r.cx, y:r.y-1},{x:r.cx, y:r.y+r.h},
      ];
      for(const s of sides){
        if(isAnyFloor(map.tileId(s.x,s.y)) && isDoorway(map,s.x,s.y)){
          map.setTile(s.x,s.y,'door');
          map.clearBlocks(s.x,s.y);
          break;
        }
      }
    }
  }

  // 地形多样化
  for(const r of rooms){
    // 房间地板只从本主题地板池里选（不混入草地/泥土），与原版 biome 单一地板一致
    const roomFloor = rng.pick(theme.floors);
    for(let y=r.y;y<r.y+r.h;y++){
      for(let x=r.x;x<r.x+r.w;x++){
        if(isAnyFloor(map.tileId(x,y))) map.setTile(x,y,roomFloor);
      }
    }
    // 墙体变体（主题内的次级墙，如苔绿石/plain/alien）
    if(rng.chance(theme.wallVarChance)){
      for(let y=r.y-1;y<=r.y+r.h;y++){
        for(let x=r.x-1;x<=r.x+r.w;x++){
          if(map.hasBlocks(x,y) && rng.chance(0.3)){
            const blocks = map.getBlocks(x,y);
            if(blocks){
              const newBlocks = blocks.map(id => id === theme.wall ? theme.wallVar : id);
              map.setBlocks(x, y, newBlocks);
            }
          }
        }
      }
    }
  }

  generateDecorations(map, rng);
  spawnMonsters(map, map.depth, rng);
  spawnItems(map, map.depth, rng);
  return map;
}

// ==================== 野外地图生成 ====================
function _generateFieldMap(zone, rng){
  const W = 48, H = 48;
  const map = new GameMap(W, H);
  map.name = zone.name || '野外';
  map.depth = 0;

  // 基础草地
  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      map.setTile(x, y, 'grass');
    }
  }

  // 随机地形斑块
  const patches = rng.int(3, 8);
  for(let p = 0; p < patches; p++){
    const px = rng.int(5, W - 5);
    const py = rng.int(5, H - 5);
    const pr = rng.int(3, 8);
    const tileType = rng.pick(['grass_dark','dirt','moss','stone_path']);
    for(let dy = -pr; dy <= pr; dy++){
      for(let dx = -pr; dx <= pr; dx++){
        if(dx*dx + dy*dy > pr*pr) continue;
        const x = px + dx, y = py + dy;
        if(x > 0 && y > 0 && x < W-1 && y < H-1){
          map.setTile(x, y, tileType);
        }
      }
    }
  }

  // 水塘
  if(rng.chance(0.5)){
    const wx = rng.int(10, W - 10);
    const wy = rng.int(10, H - 10);
    const wr = rng.int(2, 4);
    for(let dy = -wr; dy <= wr; dy++){
      for(let dx = -wr; dx <= wr; dx++){
        if(dx*dx + dy*dy <= wr*wr){
          map.setTile(wx+dx, wy+dy, 'water');
        }
      }
    }
  }

  // 边界围墙
  for(let x = 0; x < W; x++){
    map.setBlocks(x, 0, ['stone_wall']);
    map.setBlocks(x, H-1, ['stone_wall']);
  }
  for(let y = 0; y < H; y++){
    map.setBlocks(0, y, ['stone_wall']);
    map.setBlocks(W-1, y, ['stone_wall']);
  }

  // 楼梯（返回 Region）
  map.stairsUp = {x: Math.floor(W/2), y: Math.floor(H/2)};
  map.stairsDown = {x: Math.floor(W/2), y: Math.floor(H/2) + 2};
  map.setTile(map.stairsDown.x, map.stairsDown.y, 'stairs_dn');

  generateDecorations(map, rng);
  spawnMonsters(map, Math.max(1, zone.dangerLv || 1), rng);
  spawnItems(map, Math.max(1, zone.dangerLv || 1), rng);
  return map;
}

// ==================== 装饰物 ====================
// 参考 Elin 原版：
//   - 野外：BiomeProfile.cluster.obj 按 biome 选 obj 簇放置
//   - 城镇：室内由 Room.thing 放家具(Thing)，室外放公共设施。
// H5 仅渲染 obj 层（无 Thing 家具），故用外观近似：
//   室内 → 稀疏“家具感”obj（树桩/鸟巢/盆栽）；室外 → 行道桩/水井(巨岩)/花园花木/行道树。
const isWaterFloor = (gid) => {
  const g = FLOOR_GROUP[gid];
  return g === 'water' || g === 'water_shallow' || g === 'water_deep';
};
// 仅保留 MAT.obj 中有贴图的项（避免死 id）
function _validObjIds(ids){
  const out = [];
  for(const id of ids){ if(MAT.obj[id]) out.push(id); }
  return out;
}
// ===== 装饰物规则系统（参考 Elin BiomeProfile.Cluster.Type）=====
// Cluster 类型语义：
//   exterior     仅室外(非室内、非水域)可生成
//   interior     仅室内(房间内部)可生成
//   nonObstacle  四邻无遮挡(无方块/物品/实体/装饰)才可生成
//   wall         紧邻墙体(方块)才可生成（路灯/壁灯）
//   spaceByWall  室内且紧邻墙体（靠墙家具）
//   onWater      仅在水域格生成（水草/芦苇）
// density=出现概率；spacing=同组最小间隔(格)，避免拥挤杂乱。
const P = {
  tree:        _validObjIds([58,56,76,0,113,17,69,49,50,53,55,54,94,63,64,118,119,112]),
  flower:      _validObjIds([1,2,3,4,120,139,140,141,115,116,117,5,7,127,108,121,138]),
  mushroom:    _validObjIds([6,12,15,47]),
  grass_tuft:  _validObjIds([115,116,117,5,7,105,127,108]),
  rock:        _validObjIds([9,11,144,91,102]),
  boulder:     _validObjIds([51,100,93,62,64,94]),
  crystal:     _validObjIds([10]),
  cactus:      _validObjIds([16,17,9,11,51,91,74]),
  snow_tree:   _validObjIds([54,13,11,52,142,143]),
  water_edge:  _validObjIds([20,99,73,74,75]),
  lamp:        _validObjIds([66]),                 // bollard 路灯柱
  street_tree: _validObjIds([17,58,113,0,56,69,49]),
  garden:      _validObjIds([1,2,3,4,120,139,140,141,35,36,38,39,40,78,88,104,121,122,138]),
  monument:    _validObjIds([51,100]),             // 公共石碑/巨岩
  // 室内家具近似（H5 仅有 obj 层，无 Thing 家具）→ 用自然/道具obj占位
  table_prop:  _validObjIds([72,84,101]),          // 树桩/土堆/木框
  shelf_prop:  _validObjIds([101,84,72]),          // 木框/土堆/树桩
  bed_prop:    _validObjIds([48,72]),              // 鸟巢/树桩
  crop:        _validObjIds([35,36,38,39,40,42,78,88,104,105,121,122,138,49,50]),
  fence:       _validObjIds([92]),                 // border 围栏
  bone:        _validObjIds([52,142,143,145,84,62,64,94,18,19]),
};

// 野外：每个 biome 一组 Cluster 规则
const BIOME_DECOR = {
  grass: [
    {type:'exterior',    density:0.045, pool:P.tree,       spacing:2, group:'tree',  opts:{scaleMin:0.95,scaleRange:0.35}},
    {type:'nonObstacle', density:0.10,  pool:P.flower,     spacing:1, group:'flower'},
    {type:'exterior',    density:0.025, pool:P.mushroom,   spacing:1, group:'mush'},
    {type:'exterior',    density:0.05,  pool:P.grass_tuft, spacing:1, group:'grass'},
  ],
  sand: [
    {type:'exterior', density:0.03, pool:P.cactus, spacing:2, group:'cactus'},
    {type:'exterior', density:0.04, pool:P.rock,   spacing:1, group:'rock'},
  ],
  snow: [
    {type:'exterior', density:0.04, pool:P.snow_tree, spacing:2, group:'snowtree'},
    {type:'exterior', density:0.05, pool:P.rock,      spacing:1, group:'rock'},
  ],
  stone: [
    {type:'exterior', density:0.04, pool:P.boulder, spacing:1, group:'boulder'},
    {type:'exterior', density:0.05, pool:P.rock,    spacing:1, group:'rock'},
    {type:'exterior', density:0.03, pool:P.crystal, spacing:2, group:'crystal'},
  ],
  wood: [
    {type:'exterior', density:0.04, pool:P.boulder, spacing:1, group:'boulder'},
    {type:'exterior', density:0.05, pool:P.rock,    spacing:1, group:'rock'},
  ],
  factory: [
    {type:'exterior', density:0.04, pool:P.boulder, spacing:1, group:'boulder'},
    {type:'exterior', density:0.05, pool:P.rock,    spacing:1, group:'rock'},
  ],
  water: [
    {type:'exterior', density:0.08, pool:P.water_edge, spacing:1, group:'water', onWater:true},
  ],
};

// 城镇室外：少量行道树、花园、公共石碑（路灯改为每栋门口立 1 根，避免杂乱）
const TOWN_OUTDOOR = [
  {type:'exterior',    density:0.022, pool:P.street_tree, spacing:3, group:'stree', opts:{scaleMin:0.95,scaleRange:0.3}},
  {type:'nonObstacle', density:0.05,  pool:P.garden,      spacing:1, group:'garden'},
  {type:'exterior',    density:0.012, pool:P.monument,    spacing:6, group:'monu'},
];

// 室内房间家具（按房间类型；数组为 obj id，运行时校验）
const ROOM_FURNITURE = {
  inn:    {table:[72,84],   shelf:[101,84], bed:[48],  lamp:true},
  shop:   {table:[84,72],   shelf:[101,84], bed:[],    lamp:true},
  altar:  {table:[],        shelf:[],      bed:[],     lamp:true},
  store:  {table:[84],      shelf:[101,72], bed:[],    lamp:false},
  home:   {table:[72,84],   shelf:[101],   bed:[48],   lamp:false},
  farm:   {table:[],        shelf:[],      bed:[],     lamp:false},
  default:{table:[72,84],   shelf:[101,84], bed:[48],  lamp:false},
};

// ---- Cluster 规则引擎辅助 ----
function _hasWallNeighbor(map,x,y){
  return (x>0 && map.hasSolidBlocks(x-1,y)) || (x<map.w-1 && map.hasSolidBlocks(x+1,y)) ||
         (y>0 && map.hasSolidBlocks(x,y-1)) || (y<map.h-1 && map.hasSolidBlocks(x,y+1));
}
function _hasObstacleNeighbor(map,x,y){
  for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
    const nx=x+dx, ny=y+dy;
    if(nx<0||ny<0||nx>=map.w||ny>=map.h) continue;
    if(map.hasSolidBlocks(nx,ny)||map.itemAt(nx,ny)||map.entityAt(nx,ny)||map.specialAt(nx,ny)) return true;
  }
  return false;
}
function _spaced(occ,x,y,group,minDist){
  for(let dy=-minDist;dy<=minDist;dy++)
    for(let dx=-minDist;dx<=minDist;dx++){
      if(occ.get((x+dx)+','+(y+dy))===group) return false;
    }
  occ.set(x+','+y,group);
  return true;
}
function _applyRules(map,rng,rules,x,y,ctx){
  if(!rules) return;
  for(const rule of rules) _applyRule(map,rng,rule,x,y,ctx);
}
function _applyRule(map,rng,rule,x,y,ctx){
  if(map._decoPlaced && map._decoPlaced.has(x+','+y)) return;
  const {type,density,pool,spacing,group,opts,onWater}=rule;
  if(!density||density<=0||!pool||!pool.length) return;
  if(onWater && !ctx.onWater) return;
  if(!onWater && ctx.onWater) return;
  if(type==='exterior'    && ctx.interior) return;
  if(type==='interior'    && !ctx.interior) return;
  if(type==='spaceByWall' && (!ctx.interior || !_hasWallNeighbor(map,x,y))) return;
  if(type==='wall'        && !_hasWallNeighbor(map,x,y)) return;
  if(type==='nonObstacle' && _hasObstacleNeighbor(map,x,y)) return;
  if(rng.float() > density) return;
  const g = group || (pool[0]+':'+type);
  if(spacing && !_spaced(ctx.occupied,x,y,g,spacing)) return;
  _pushDeco(map,x,y,rng.pick(pool),rng,opts);
}
// 室内可放置判定（不含间距，供房间布局函数用）
function _canIndoor(map,x,y){
  if(x<0||y<0||x>=map.w||y>=map.h) return false;
  if(map.hasSolidBlocks(x,y)||map.itemAt(x,y)||map.entityAt(x,y)||map.specialAt(x,y)) return false;
  if(map._decoPlaced && map._decoPlaced.has(x+','+y)) return false;
  return true;
}
// 单栋建筑房间：结构化家具（中心桌 + 靠墙架 + 墙角床 + 壁灯）
function _decorateRoom(map, rng, b, occ){
  const x0=b.x, y0=b.y, x1=b.x+b.w-1, y1=b.y+b.h-1;
  const cx=Math.floor((x0+x1)/2), cy=Math.floor((y0+y1)/2);
  const fr = ROOM_FURNITURE[b.kind] || ROOM_FURNITURE['default'];
  const table = _validObjIds(fr.table);
  const shelf = _validObjIds(fr.shelf);
  const bed   = _validObjIds(fr.bed);
  // 中央桌子（若被 NPC 占用则跳过）
  if(table.length && _canIndoor(map,cx,cy)) _pushDeco(map,cx,cy,rng.pick(table),rng,{scaleMin:0.9,scaleRange:0.2});
  // 靠墙家具（spaceByWall 语义）
  if(shelf.length){
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
      if(_hasWallNeighbor(map,x,y) && rng.chance(0.22) && _canIndoor(map,x,y))
        _pushDeco(map,x,y,rng.pick(shelf),rng,{scaleMin:0.8,scaleRange:0.2});
    }
  }
  // 床（墙角）
  if(bed.length && rng.chance(0.6)){
    const corners=[[x0,y0],[x1,y0],[x0,y1],[x1,y1]];
    for(const c of corners){ if(_canIndoor(map,c[0],c[1])){ _pushDeco(map,c[0],c[1],rng.pick(bed),rng,{scaleMin:0.85,scaleRange:0.15}); break; } }
  }
  // 壁灯（靠墙，每房间至多 1 盏）
  if(fr.lamp){
    let placedLamp = false;
    for(let y=y0;y<=y1 && !placedLamp;y++) for(let x=x0;x<=x1;x++){
      if(_hasWallNeighbor(map,x,y) && _canIndoor(map,x,y)){ _pushDeco(map,x,y,66,rng,{scaleMin:0.9,scaleRange:0.2}); placedLamp=true; break; }
    }
  }
}
// 农田：围栏 + 成行作物
function _decorateFarm(map, rng, b, occ){
  const x0=b.x, y0=b.y, x1=b.x+b.w-1, y1=b.y+b.h-1;
  const fence = P.fence[0];
  for(let x=x0-1;x<=x1+1;x++){
    if(_canIndoor(map,x,y0-1)) _pushDeco(map,x,y0-1,fence,rng,{});
    if(_canIndoor(map,x,y1+1)) _pushDeco(map,x,y1+1,fence,rng,{});
  }
  for(let y=y0-1;y<=y1+1;y++){
    if(_canIndoor(map,x0-1,y)) _pushDeco(map,x0-1,y,fence,rng,{});
    if(_canIndoor(map,x1+1,y)) _pushDeco(map,x1+1,y,fence,rng,{});
  }
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    if(rng.chance(0.7) && _canIndoor(map,x,y)) _pushDeco(map,x,y,rng.pick(P.crop),rng,{scaleMin:0.8,scaleRange:0.25});
  }
}
function _decoBlocked(map, x, y){
  if(x<0||y<0||x>=map.w||y>=map.h) return true;
  if(map.hasSolidBlocks(x,y)) return true;
  if(map.itemAt(x,y)) return true;
  if(map.entityAt(x,y)) return true;
  if(map.specialAt(x,y)) return true;
  if(map._decoPlaced && map._decoPlaced.has(x+','+y)) return true;
  return false;
}
function _pushDeco(map, x, y, oid, rng, opts){
  opts = opts || {};
  const ox = (rng.float() - 0.5) * (opts.ox || 20);
  const oy = (rng.float() - 0.5) * (opts.oy || 12);
  const phase = rng.float() * Math.PI * 2;
  const scale = (opts.scaleMin || 0.85) + rng.float() * (opts.scaleRange || 0.3);
  if(!map._decoPlaced) map._decoPlaced = new Set();
  map._decoPlaced.add(x+','+y);
  map.decorations.push({x, y, type: oid, ox, oy, scale, phase, face: opts.face || null});
}
function _finalizeDecoGrid(map){
  map._decorGrid = {};
  for(const d of map.decorations){
    const key = d.x + ',' + d.y;
    if(!map._decorGrid[key]) map._decorGrid[key] = [];
    map._decorGrid[key].push(d);
  }
}
// 统一入口：按地图类型分派
function generateDecorations(map, rng, buildings){
  if(map.isTown || map.generator === 'town') return generateTownDecorations(map, buildings, rng);
  if(map.generator === 'dungeon') return generateDungeonDecorations(map, rng);
  return generateWildDecorations(map, rng);
}
// 野外：按 biome 套用 Cluster 规则（参考 BiomeProfile.cluster.obj）
function generateWildDecorations(map, rng){
  map._decoPlaced = new Set();
  const occ = new Map();
  for(let y=0;y<map.h;y++){
    for(let x=0;x<map.w;x++){
      const gid = map.tileId(x,y);
      const gkey = FLOOR_GROUP[gid];
      if(!gkey) continue;
      const water = isWaterFloor(gid);
      if(water){
        if(_decoBlocked(map,x,y)) continue;
        _applyRules(map, rng, BIOME_DECOR['water'], x, y, {interior:false, occupied:occ, onWater:true});
        continue;
      }
      if(map.hasSolidBlocks(x,y)) continue;
      if(_decoBlocked(map,x,y)) continue;
      const rules = BIOME_DECOR[gkey] || BIOME_DECOR['grass'];
      _applyRules(map, rng, rules, x, y, {interior:false, occupied:occ, onWater:false});
    }
  }
  _finalizeDecoGrid(map);
}
// 城镇：室内结构化房间 + 室外路灯/行道树/花园/公共石碑 + 农田
function generateTownDecorations(map, buildings, rng){
  map._decoPlaced = new Set();
  const occ = new Map();
  const indoor = new Set();
  for(const b of buildings||[]){
    for(let yy=b.y; yy<b.y+b.h; yy++)
      for(let xx=b.x; xx<b.x+b.w; xx++)
        indoor.add(xx+','+yy);
  }
  // 室内：每栋建筑房间结构化家具
  for(const b of buildings||[]){
    if(b.farm){ _decorateFarm(map, rng, b, occ); continue; }
    _decorateRoom(map, rng, b, occ);
  }
  // 室外：道路/墙路灯、行道树、花园、公共石碑
  for(let y=0;y<map.h;y++){
    for(let x=0;x<map.w;x++){
      if(_decoBlocked(map,x,y)) continue;
      if(indoor.has(x+','+y)) continue;
      _applyRules(map, rng, TOWN_OUTDOOR, x, y, {interior:false, occupied:occ, onWater:false});
    }
  }
  // 每栋建筑门口立一盏路灯柱（公共照明标识）
  for(const b of buildings||[]){
    if(!b.door) continue;
    const px = b.door.x, py = b.door.y + 1;
    if(!_decoBlocked(map,px,py) && P.lamp.length)
      _pushDeco(map, px, py, P.lamp[0], rng, {scaleMin:0.9, scaleRange:0.2});
  }
  _finalizeDecoGrid(map);
}
// 地牢：骸骨/晶/巨岩/矿，低密度 + 间距
function generateDungeonDecorations(map, rng){
  map._decoPlaced = new Set();
  const occ = new Map();
  const rules = [
    {type:'exterior', density:0.04, pool:P.boulder, spacing:1, group:'boul'},
    {type:'exterior', density:0.05, pool:P.rock,    spacing:1, group:'rock'},
    {type:'exterior', density:0.02, pool:P.crystal, spacing:2, group:'crys'},
    {type:'exterior', density:0.03, pool:P.bone,    spacing:1, group:'bone'},
  ];
  for(let y=0;y<map.h;y++){
    for(let x=0;x<map.w;x++){
      if(_decoBlocked(map,x,y)) continue;
      _applyRules(map, rng, rules, x, y, {interior:false, occupied:occ, onWater:false});
    }
  }
  _finalizeDecoGrid(map);
}

// ==================== 地下城辅助函数 ====================
function carveCorridor(map, x1,y1,x2,y2, rng){
  if(rng.chance(0.5)){
    carveH(map,x1,x2,y1);
    carveV(map,y1,y2,x2);
  } else {
    carveV(map,y1,y2,x1);
    carveH(map,x1,x2,y2);
  }
}
function carveH(map,x1,x2,y){
  const pf = map.primaryFloor != null ? map.primaryFloor : FLOOR_SEM.floor;
  for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++){
    if(map.hasSolidBlocks(x,y)){ map.setTile(x,y,pf); map.clearBlocks(x,y); }
  }
}
function carveV(map,y1,y2,x){
  const pf = map.primaryFloor != null ? map.primaryFloor : FLOOR_SEM.floor;
  for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++){
    if(map.hasSolidBlocks(x,y)){ map.setTile(x,y,pf); map.clearBlocks(x,y); }
  }
}
function isDoorway(map,x,y){
  const lr = map.hasSolidBlocks(x-1,y) && map.hasSolidBlocks(x+1,y);
  const ud = map.hasSolidBlocks(x,y-1) && map.hasSolidBlocks(x,y+1);
  return lr || ud;
}

// ==================== 怪物生成 ====================
// 随机找一个可行走格（用于无房间地图，如野外）
function _randomSpot(map, rng){
  for(let i=0;i<300;i++){
    const x = rng.int(1, map.w-2), y = rng.int(1, map.h-2);
    if(map.isWalkable(x,y) && !map.entityAt(x,y) && !map.itemAt(x,y)) return {x, y};
  }
  return null;
}
function spawnMonsters(map, depth, rng){
  const count = Math.min(6 + depth*2, 22);
  const pool = monsterPoolForDepth(depth);
  const boss = depth % 5 === 0;
  const hasRooms = !!(map.rooms && map.rooms.length);
  const spawn = map.stairsUp || (hasRooms ? {x: map.rooms[0].cx, y: map.rooms[0].cy} : {x: Math.floor(map.w/2), y: Math.floor(map.h/2)});
  const SAFE_DIST = 6;
  let placed = 0;
  for(let i=0;i<count+10 && placed<count;i++){
    let x, y;
    const r = hasRooms ? rng.pick(map.rooms) : null;
    if(r){ x = rng.int(r.x, r.x+r.w-1); y = rng.int(r.y, r.y+r.h-1); }
    else { const s = _randomSpot(map, rng); if(!s) break; x = s.x; y = s.y; }
    if(r === map.rooms[0] && depth===1) continue;
    if(!map.isWalkable(x,y)) continue;
    if(map.entityAt(x,y)) continue;
    if(Math.abs(x-spawn.x)+Math.abs(y-spawn.y) < SAFE_DIST) continue;
    const mId = rng.pick(pool);
    const def = MONSTERS[mId];
    if(!def) continue;
    map.entities.push(makeMonster(def, x, y, depth, rng));
    placed++;
  }
  if(boss && hasRooms){
    const lastRoom = map.rooms[map.rooms.length-1];
    let bx = lastRoom.cx, by = lastRoom.cy;
    if(map.stairsDown && bx===map.stairsDown.x && by===map.stairsDown.y){ bx++; }
    const bossDef = depth>=10 ? MONSTERS.dragon : MONSTERS.troll;
    const m = makeMonster(bossDef, bx, by, depth, rng);
    m.isBoss = true;
    map.entities.push(m);
  }
}

function monsterPoolForDepth(depth){
  if(depth <= 2) return ['slime','rat','bat','kobold'];
  if(depth <= 4) return ['rat','bat','goblin','kobold','zombie'];
  if(depth <= 7) return ['goblin','kobold','zombie','ghost','orc','imp'];
  if(depth <= 10) return ['zombie','ghost','imp','orc'];
  return ['ghost','imp','orc','zombie'];
}

function spawnItems(map, depth, rng){
  const count = rng.int(4, 8);
  const itemPool = ['bread','ration','potion_heal','potion_cure','arrow','bullet','gold','herb','ore','lockpick','torch','seed'];
  const hasRooms = !!(map.rooms && map.rooms.length);
  for(let i=0;i<count+8 && map.items.length<count;i++){
    let x, y;
    const r = hasRooms ? rng.pick(map.rooms) : null;
    if(r){ x = rng.int(r.x, r.x+r.w-1); y = rng.int(r.y, r.y+r.h-1); }
    else { const s = _randomSpot(map, rng); if(!s) break; x = s.x; y = s.y; }
    if(!map.get(x,y) || !map.get(x,y).walkable) continue;
    if(map.itemAt(x,y)) continue;
    const id = rng.pick(itemPool);
    if(id === 'gold'){
      map.items.push({x,y,item:{id:'gold',name:'金币',icon:'🪙',type:'currency',amount: rng.int(5+depth*3, 15+depth*8),weight:0}});
    } else {
      map.items.push({x,y,item:makeItem(id, depth, rng)});
    }
  }
  if(rng.chance(0.6)){
    let x, y;
    const r = hasRooms && map.rooms.length > 1 ? rng.pick(map.rooms.slice(1)) : null;
    if(r){ x = rng.int(r.x, r.x+r.w-1); y = rng.int(r.y, r.y+r.h-1); }
    else { const s = _randomSpot(map, rng); if(!s) { /* no spot */ } else { x = s.x; y = s.y; } }
    if(x != null && map.get(x,y) && map.get(x,y).walkable && !map.itemAt(x,y)){
      map.items.push({x,y,item:makeItem('chest', depth, rng)});
    }
  }
}

// ==================== 房间检测 ====================
export function detectRooms(map){
  const rooms = [];
  const visited = Array.from({length:map.h}, () => new Array(map.w).fill(false));
  for(let y = 1; y < map.h - 1; y++){
    for(let x = 1; x < map.w - 1; x++){
      if(visited[y][x]) continue;
      if(map.isSolid(x, y)) continue;
      const tiles = [];
      const queue = [{x, y}];
      visited[y][x] = true;
      let minX = x, maxX = x, minY = y, maxY = y;
      while(queue.length > 0){
        const cur = queue.shift();
        tiles.push(cur);
        minX = Math.min(minX, cur.x);
        maxX = Math.max(maxX, cur.x);
        minY = Math.min(minY, cur.y);
        maxY = Math.max(maxY, cur.y);
        const dirs = [{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
        for(const d of dirs){
          const nx = cur.x + d.x, ny = cur.y + d.y;
          if(nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
          if(visited[ny][nx]) continue;
          if(map.isSolid(nx, ny)) continue;
          visited[ny][nx] = true;
          queue.push({x:nx, y:ny});
        }
      }
      if(tiles.length >= 9){
        rooms.push({ tiles, minX, maxX, minY, maxY, w: maxX-minX+1, h: maxY-minY+1, walls: [], doors: [] });
      }
    }
  }
  map.rooms = rooms;
  return rooms;
}

export function detectRoomWalls(map, rooms){
  if(!rooms) return;
  for(const room of rooms){
    room.walls = [];
    room.doors = [];
    for(let y = room.minY; y <= room.maxY; y++){
      for(let x = room.minX; x <= room.maxX; x++){
        if(map.hasBlocks(x, y)){
          room.walls.push({x, y});
        }
        if(map.specialAt(x, y) === 'door'){
          room.doors.push({x, y});
        }
      }
    }
  }
}

// ==================== 旧版兼容导出 ====================
// generateHome 现在重定向到 generateTown
export function generateHome(rng){
  return generateTown(rng, 0);
}

// ==================== FOV ====================
export function computeFOV3D(map, ox, oy, radius){
  const w = map.w, h = map.h;
  for(let y=0;y<h;y++){
    map.visible[y].fill(false);
    map.vis3D[y].fill(0);
  }
  const r2 = radius * radius;

  function hasLineOfSight(tx, ty){
    let x0 = Math.round(ox), y0 = Math.round(oy);
    const x1 = Math.round(tx), y1 = Math.round(ty);
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while(true){
      if(x0 === x1 && y0 === y1) break;
      if(x0 !== Math.round(ox) || y0 !== Math.round(oy)){
        if(x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;
        if(map.isSolid(x0, y0)) return false;
      }
      const e2 = 2 * err;
      if(e2 > -dy){ err -= dy; x0 += sx; }
      if(e2 < dx){  err += dx; y0 += sy; }
    }
    return true;
  }

  const minGx = Math.max(0, Math.floor(ox) - radius);
  const maxGx = Math.min(w - 1, Math.ceil(ox) + radius);
  const minGy = Math.max(0, Math.floor(oy) - radius);
  const maxGy = Math.min(h - 1, Math.ceil(oy) + radius);

  for(let gy = minGy; gy <= maxGy; gy++){
    for(let gx = minGx; gx <= maxGx; gx++){
      const dx = gx + 0.5 - ox, dy = gy + 0.5 - oy;
      if(dx*dx + dy*dy > r2) continue;
      if(!hasLineOfSight(gx, gy)) continue;
      map.visible[gy][gx] = true;
      map.explored[gy][gx] = true;
      const b = map.blocks[gy][gx];
      const stackH = b ? b.length : 0;
      let mask = 1;
      for(let z = 1; z <= stackH; z++){
        const belowBt = MAT.block[b[z-1]];
        if(belowBt && belowBt.solid){
          mask |= (1 << z);
          break;
        }
        mask |= (1 << z);
      }
      if(stackH > 0) mask |= (1 << stackH);
      map.vis3D[gy][gx] = mask;
      map.exp3D[gy][gx] |= mask;
    }
  }
}

export function computeFOV(map, ox, oy, radius){
  computeFOV3D(map, ox, oy, radius);
}

export function computeVerticalVisibility(map){}

export { makeItem, qualityMult };
