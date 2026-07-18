// ===== 世界/地下城生成 + FOV 视野 =====

import { TILES, MONSTERS, ITEMS, ENCHANTS, QUALITY, DECOR_TYPES, BLOCK_TYPES } from './data.js?v=43';
import { RNG } from './rng.js';
import { makeMonster } from './entity.js';
import { makeItem, qualityMult } from './item.js';
import { makeNPC } from './npc.js';

export class GameMap{
  constructor(w, h){
    this.w = w; this.h = h;
    this.tiles = [];
    this.blocks = [];
    this.decorations = [];
    this._decorGrid = null;
    this.explored = [];
    this.visible = [];
    this.entities = [];
    this.items = [];
    this.depth = 1;
    this.name = '未知地下城';
    this.stairsDown = null;
    this.stairsUp = null;
    this.rooms = [];
    this.isTown = false;
    this.isWorld = false;
    this._visibleZ = [];
    // 3D可见性：vis3D[y][x] = 位掩码，bit z=1 表示z层空气可见
    // z=0: 地面层(z=0块的地板面), z=1: 第1块顶面/第2块地板面 ...
    this.vis3D = [];
    this.exp3D = [];
    for(let y=0;y<h;y++){
      this.tiles.push(new Array(w).fill('floor'));
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
    return TILES[this.tiles[y][x]];
  }
  tileId(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return 'wall';
    return this.tiles[y][x];
  }
  // ---- 方块堆叠系统辅助方法 ----
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
    this.blocks[y][x] = (blockIds && blockIds.length > 0) ? blockIds : null;
  }
  clearBlocks(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return;
    this.blocks[y][x] = null;
  }
  hasSolidBlocks(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return true;
    const b = this.blocks[y][x];
    if(!b) return false;
    return b.some(id => { const bt = BLOCK_TYPES[id]; return bt && bt.solid; });
  }
  blockHeightAt(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return 0;
    const b = this.blocks[y][x];
    if(!b) return 0;
    let h = 0;
    for(const id of b){ const bt = BLOCK_TYPES[id]; if(bt) h += bt.h; }
    return h;
  }
  isSolid(x,y){
    if(x<0||y<0||x>=this.w||y>=this.h) return true;
    const t = this.get(x,y);
    if(t && t.solid) return true; // water等solid地面
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
    this.tiles[y][x] = id;
  }

  // ---- 建造模式：放置装饰物 ----
  addDecoration(x, y, type, face){
    if(x<0||y<0||x>=this.w||y>=this.h) return null;
    const def = DECOR_TYPES[type];
    if(!def) return null;
    const scale = def.minS + Math.random() * (def.maxS - def.minS);
    const ox = (Math.random() - 0.5) * 20;
    const oy = (Math.random() - 0.5) * 12;
    const phase = Math.random() * Math.PI * 2;
    const decor = {x, y, type, ox, oy, scale, phase, face: face || null, userPlaced: true};
    this.decorations.push(decor);
    const key = x + ',' + y;
    if(!this._decorGrid[key]) this._decorGrid[key] = [];
    this._decorGrid[key].push(decor);
    return decor;
  }

  // ---- 建造模式：拆除装饰物 ----
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

  // ---- 建造模式：获取该格所有装饰物 ----
  getDecorationsAt(x, y){
    const key = x + ',' + y;
    return this._decorGrid[key] || [];
  }
}

// ---------- 地下城生成 ----------
export function generateDungeon(depth, rng){
  const W = 48, H = 48;
  const map = new GameMap(W,H);
  map.depth = depth;
  map.name = `地下城 ${depth}F`;

  // 填充：所有格子先设为 floor_dark 地面 + 2高石墙
  const wallBlockTypes = ['stone_wall','stone_wall']; // 2高墙
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      map.setTile(x,y,'floor_dark');
      map.setBlocks(x,y, wallBlockTypes.slice());
    }
  }

  const rooms = [];
  const maxRooms = 14;
  const minSize = 5, maxSize = 11;
  let attempts = 0;
  while(rooms.length < maxRooms && attempts < 200){
    attempts++;
    const rw = rng.int(minSize, maxSize);
    const rh = rng.int(minSize, maxSize);
    const rx = rng.int(1, W-rw-2);
    const ry = rng.int(1, H-rh-2);
    const room = {x:rx,y:ry,w:rw,h:rh,cx:Math.floor(rx+rw/2),cy:Math.floor(ry+rh/2)};
    let overlap = false;
    for(const r of rooms){
      if(rx-1 < r.x+r.w && rx+rw+1 > r.x && ry-1 < r.y+r.h && ry+rh+1 > r.y){ overlap=true; break; }
    }
    if(overlap) continue;
    // 挖出房间：清除方块，设为地板
    for(let y=ry;y<ry+rh;y++)
      for(let x=rx;x<rx+rw;x++){
        map.setTile(x,y,'floor');
        map.clearBlocks(x,y);
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
  if(depth > 1){
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
        if(map.tileId(s.x,s.y)==='floor' && isDoorway(map,s.x,s.y)){
          map.setTile(s.x,s.y,'door');
          map.clearBlocks(s.x,s.y);
          break;
        }
      }
    }
  }
  // 地形多样化：每个房间随机选择地面类型
  for(const r of rooms){
    const roomFloor = rng.pick(['floor','floor_dark','dirt','stone_path','moss']);
    for(let y=r.y;y<r.y+r.h;y++){
      for(let x=r.x;x<r.x+r.w;x++){
        if(map.tileId(x,y)==='floor') map.setTile(x,y,roomFloor);
      }
    }
    // 墙壁偶尔长苔藓：将 stone_wall 替换为 mossy_wall
    if(rng.chance(0.4)){
      for(let y=r.y-1;y<=r.y+r.h;y++){
        for(let x=r.x-1;x<=r.x+r.w;x++){
          if(map.hasBlocks(x,y) && rng.chance(0.3)){
            const blocks = map.getBlocks(x,y);
            if(blocks){
              const newBlocks = blocks.map(id => id === 'stone_wall' ? 'mossy_wall' : id);
              map.setBlocks(x, y, newBlocks);
            }
          }
        }
      }
    }
  }

  // 装饰物生成
  generateDecorations(map, rng);

  spawnMonsters(map, depth, rng);
  spawnItems(map, depth, rng);
  return map;
}

// ---- 装饰物生成 ----
function generateDecorations(map, rng){
  const decorTypes = Object.keys(DECOR_TYPES);
  // 按地形类型分组装饰偏好
  const floorDecors = ['pebble','crack','puddle','grass_tuft','mushroom'];
  const grassDecors = ['grass_tuft','grass_tall','flower_red','flower_yellow','flower_white','mushroom','pebble'];
  const mossDecors = ['mushroom','flower_white','grass_tuft','pebble'];
  const dirtDecors = ['pebble','crack','bone','grass_tuft'];
  const stoneDecors = ['crack','pebble','puddle'];
  const darkDecors = ['mushroom','crack','bone','crystal'];
  const wallDecors = ['vine','torch','crystal'];
  const wallFaces = ['top','left','right','front'];

  for(let y=0;y<map.h;y++){
    for(let x=0;x<map.w;x++){
      const tid = map.tileId(x,y);
      if(!tid) continue;
      let pool = null;
      if(tid==='grass' || tid==='grass_dark') pool = grassDecors;
      else if(tid==='moss') pool = mossDecors;
      else if(tid==='dirt') pool = dirtDecors;
      else if(tid==='stone_path') pool = stoneDecors;
      else if(tid==='floor_dark') pool = darkDecors;
      else if(tid==='floor') pool = floorDecors;
      else if(tid==='rubble') pool = ['pebble','bone'];
      else if(map.hasBlocks(x,y)) pool = wallDecors;

      if(!pool) continue;
      // 装饰密度
      const density = (tid==='grass'||tid==='grass_dark') ? 0.25 : 0.12;
      if(rng.chance(density)){
        const type = rng.pick(pool);
        const def = DECOR_TYPES[type];
        if(!def) continue;
        const scale = def.minS + rng.float() * (def.maxS - def.minS);
        const ox = (rng.float() - 0.5) * 20;
        const oy = (rng.float() - 0.5) * 12;
        const phase = rng.float() * Math.PI * 2;
        // 墙壁装饰物分配4面
        const isWallDecor = (pool === wallDecors);
        const face = isWallDecor ? rng.pick(wallFaces) : null;
        map.decorations.push({x, y, type, ox, oy, scale, phase, face});
      }
    }
  }
  // 构建装饰网格用于快速查找
  map._decorGrid = {};
  for(const d of map.decorations){
    const key = d.x + ',' + d.y;
    if(!map._decorGrid[key]) map._decorGrid[key] = [];
    map._decorGrid[key].push(d);
  }
}

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
  for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++){
    if(map.hasSolidBlocks(x,y)){ map.setTile(x,y,'floor'); map.clearBlocks(x,y); }
  }
}
function carveV(map,y1,y2,x){
  for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++){
    if(map.hasSolidBlocks(x,y)){ map.setTile(x,y,'floor'); map.clearBlocks(x,y); }
  }
}
function isDoorway(map,x,y){
  const lr = map.hasSolidBlocks(x-1,y) && map.hasSolidBlocks(x+1,y);
  const ud = map.hasSolidBlocks(x,y-1) && map.hasSolidBlocks(x,y+1);
  return lr || ud;
}

// ---------- 怪物生成 ----------
function spawnMonsters(map, depth, rng){
  const count = Math.min(6 + depth*2, 22);
  const pool = monsterPoolForDepth(depth);
  const boss = depth % 5 === 0;
  // 玩家入口位置（上楼梯），附近不放怪
  const spawn = map.stairsUp || {x: map.rooms[0].cx, y: map.rooms[0].cy};
  const SAFE_DIST = 6;
  let placed = 0;
  for(let i=0;i<count+10 && placed<count;i++){
    const r = rng.pick(map.rooms);
    if(r === map.rooms[0] && depth===1) continue; // 起始房无怪
    const x = rng.int(r.x, r.x+r.w-1), y = rng.int(r.y, r.y+r.h-1);
    if(!map.isWalkable(x,y)) continue;
    if(map.entityAt(x,y)) continue;
    // 距离入口太近不放怪
    if(Math.abs(x-spawn.x)+Math.abs(y-spawn.y) < SAFE_DIST) continue;
    const mId = rng.pick(pool);
    const def = MONSTERS[mId];
    if(!def) continue;
    map.entities.push(makeMonster(def, x, y, depth, rng));
    placed++;
  }
  if(boss){
    const lastRoom = map.rooms[map.rooms.length-1];
    let bx = lastRoom.cx, by = lastRoom.cy;
    if(bx===map.stairsDown.x && by===map.stairsDown.y){ bx++; }
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
  for(let i=0;i<count+8;i++){
    if(map.items.length >= count) break;
    const r = rng.pick(map.rooms);
    const x = rng.int(r.x, r.x+r.w-1), y = rng.int(r.y, r.y+r.h-1);
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
    const r = rng.pick(map.rooms.slice(1));
    const x = rng.int(r.x, r.x+r.w-1), y = rng.int(r.y, r.y+r.h-1);
    if(map.get(x,y) && map.get(x,y).walkable && !map.itemAt(x,y)){
      map.items.push({x,y,item:makeItem('chest', depth, rng)});
    }
  }
}

// ---------- 家园/城镇地图 ----------
export function generateHome(rng){
  const W=24, H=20;
  const map = new GameMap(W,H);
  map.name = '我的家';
  map.isTown = true;
  map.depth = 0;
  // 全部设为草地，无方块
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) map.setTile(x,y,'grass');
  // 外围边界：1高木墙
  for(let x=0;x<W;x++){ map.setBlocks(x,0,['wood_wall']); map.setBlocks(x,H-1,['wood_wall']); }
  for(let y=0;y<H;y++){ map.setBlocks(0,y,['wood_wall']); map.setBlocks(W-1,y,['wood_wall']); }
  // 屋内地板
  for(let y=6;y<12;y++) for(let x=8;x<16;x++){
    map.setTile(x,y,'wood');
    map.clearBlocks(x,y);
  }
  // 屋内墙壁：1高木墙
  for(let y=6;y<12;y++){ map.setBlocks(8,y,['wood_wall']); map.setBlocks(15,y,['wood_wall']); }
  for(let x=8;x<16;x++){ map.setBlocks(x,6,['wood_wall']); map.setBlocks(x,11,['wood_wall']); }
  // 门
  map.setTile(11,11,'door');
  map.clearBlocks(11,11);
  map.setTile(20,4,'altar');
  map.clearBlocks(20,4);
  map.stairsDown = {x:12, y:16};
  map.setTile(12,16,'stairs_dn');
  map.stairsUp = {x:12, y:16};
  map.items.push({x:13,y:8,item:makeItem('ration',0,rng)});
  map.items.push({x:10,y:9,item:makeItem('potion_heal',0,rng)});
  map.items.push({x:18,y:5,item:makeItem('potion_heal_l',0,rng)});
  map.rooms = [{x:1,y:1,w:W-2,h:H-2,cx:12,cy:10}];

  // ---- 生成 NPC ----
  // 商人在屋内
  map.entities.push(makeNPC('merchant', 12, 8, rng));
  // 卫兵巡逻在室外
  map.entities.push(makeNPC('guard', 5, 5, rng));
  map.entities.push(makeNPC('guard', 18, 15, rng));
  // 祭司在祭坛旁
  map.entities.push(makeNPC('priest', 20, 5, rng));
  // 旅店老板在屋子附近
  map.entities.push(makeNPC('innkeeper', 14, 14, rng));
  // 村民四处闲逛
  map.entities.push(makeNPC('citizen', 6, 12, rng));
  map.entities.push(makeNPC('citizen', 16, 8, rng));
  map.entities.push(makeNPC('citizen', 8, 16, rng));
  // 冒险者
  map.entities.push(makeNPC('adventurer', 3, 3, rng));

  // 家园装饰物
  generateDecorations(map, rng);

  return map;
}

// ---------- FOV：JSiso风格欧几里得距离 + Bresenham LOS遮挡 ----------
// 每个方向从玩家到目标画Bresenham直线，遇到实心格则停止。
// vis3D[y][x] 位掩码: bit z=1 表示 z 层空气可见
export function computeFOV3D(map, ox, oy, radius){
  const w = map.w, h = map.h;

  // 清空
  for(let y=0;y<h;y++){
    map.visible[y].fill(false);
    map.vis3D[y].fill(0);
  }

  const r2 = radius * radius;

  // Bresenham直线：检查从(ox,oy)到(tx,ty)是否有实心遮挡
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

  // 遍历半径内所有格子
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

      // 3D z层可见性
      const b = map.blocks[gy][gx];
      const stackH = b ? b.length : 0;
      let mask = 1; // z=0 地板面始终可见
      for(let z = 1; z <= stackH; z++){
        const belowBt = BLOCK_TYPES[b[z-1]];
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

// 兼容旧代码：computeFOV + computeVerticalVisibility 合并
export function computeFOV(map, ox, oy, radius){
  computeFOV3D(map, ox, oy, radius);
}

export function computeVerticalVisibility(map){
  // 已在 computeFOV3D 中完成，此处保持兼容
}

export { makeItem, qualityMult };

