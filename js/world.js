// ===== 世界/地下城生成 + FOV 视野 =====

import { TILES, MONSTERS, ITEMS, ENCHANTS, QUALITY, DECOR_TYPES, BLOCK_TYPES } from './data.js?v=43';
import { RNG } from './rng.js';
import { makeMonster } from './entity.js';
import { makeItem, qualityMult } from './item.js';
import { makeNPC } from './npc.js';

export class GameMap{
  constructor(w, h){
    this.w = w; this.h = h;
    this.tiles = [];       // 地面层：始终是floor类型（floor/grass/water等），不再是'wall'
    this.blocks = [];       // 方块层：blocks[y][x] = [blockId, ...] 从底到顶堆叠，或null
    this.decorations = []; // [{x, y, type, ox, oy, scale, phase}]
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
    this._visibleZ = [];  // [y][x] = {lo, hi} 可见z范围（含）
    for(let y=0;y<h;y++){
      this.tiles.push(new Array(w).fill('floor'));
      this.blocks.push(new Array(w).fill(null));
      this.explored.push(new Array(w).fill(false));
      this.visible.push(new Array(w).fill(false));
      this._visibleZ.push(new Array(w).fill(null));
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

// ---------- 3D视野：垂直扩展 ----------
export function computeVerticalVisibility(map){
  const w = map.w, h = map.h;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) map._visibleZ[y][x] = null;

  const setRange = (x,y,lo,hi)=>{
    if(x<0||y<0||x>=w||y>=h) return;
    const cur = map._visibleZ[y][x];
    if(!cur){ map._visibleZ[y][x] = {lo, hi}; return; }
    if(lo < cur.lo) cur.lo = lo;
    if(hi > cur.hi) cur.hi = hi;
  };

  // 对每个可见地板格子，向上/下扩展可见性
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      if(!map.visible[y][x]) continue;
      const b = map.blocks[y][x];
      const stackH = b ? b.length : 0;
      if(stackH === 0){
        // 无方块：地板可见，向上扩展直到遇到实体方块
        let hi = 0;
        for(let z=0; z<20; z++){
          const by = y - z;
          if(by < 0) break;
          const sb = map.blocks[by]?.[x];
          if(sb && sb.some(id=>{ const bt=BLOCK_TYPES[id]; return bt && bt.solid; })) break;
          hi = z;
        }
        // 向下扩展
        let lo = 0;
        for(let z=1; z<20; z++){
          const by = y + z;
          if(by >= h) break;
          const sb = map.blocks[by]?.[x];
          if(sb && sb.some(id=>{ const bt=BLOCK_TYPES[id]; return bt && bt.solid; })) break;
          lo = -z;
        }
        setRange(x, y, lo, hi);
      } else {
        // 有方块：从地板开始向上，经过非实体方块，到实体方块截止
        let lo = 0, hi = 0;
        // 从底部向上扫描
        for(let z=0; z<stackH; z++){
          const bt = BLOCK_TYPES[b[z]];
          if(!bt) continue;
          if(bt.solid){
            hi = z; // 实体方块本身可见（玩家能看到这面墙），但到此截止
            break;
          } else {
            hi = z; // 非实体方块（栅栏等），继续向上
          }
        }
        // 如果所有方块都是非实体，hi = stackH-1
        // 向上继续扩展（方块上方的空空间）
        for(let z=stackH; z<20; z++){
          const by = y - z;
          if(by < 0) break;
          const sb = map.blocks[by]?.[x];
          if(sb && sb.some(id=>{ const bt=BLOCK_TYPES[id]; return bt && bt.solid; })) break;
          hi = z;
        }
        setRange(x, y, lo, hi);
      }
    }
  }

  // 水平扩展平滑层：相邻可见格子的高度信息互相参考
  // 不传播空间可见性，只帮助确定相邻格子的可见高度
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      if(!map._visibleZ[y][x]) continue;
      const cur = map._visibleZ[y][x];
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for(const [dx,dy] of dirs){
        const nx=x+dx, ny=y+dy;
        if(nx<0||ny<0||nx>=w||ny>=h) continue;
        // 只对自身可见的邻居做平滑
        if(!map.visible[ny][nx]) continue;
        const nb = map.blocks[ny]?.[nx];
        const nH = nb ? nb.length : 0;
        const nHi = nH > 0 ? nH - 1 : cur.hi;
        setRange(nx, ny, cur.lo, Math.min(cur.hi, nHi));
      }
    }
  }
}

// ---------- FOV：射线投射 ----------
export function computeFOV(map, ox, oy, radius){
  for(let y=0;y<map.h;y++) map.visible[y].fill(false);
  const mark = (x,y)=>{
    if(x<0||y<0||x>=map.w||y>=map.h) return;
    map.visible[y][x] = true;
    map.explored[y][x] = true;
  };
  mark(ox,oy);
  const r2 = radius*radius;
  const numRays = Math.max(72, radius*16);
  for(let i=0;i<numRays;i++){
    const a = (i/numRays)*Math.PI*2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let x = ox+0.5, y = oy+0.5;
    for(let s=0;s<=radius;s++){
      x += dx*0.4; y += dy*0.4;
      const gx = Math.floor(x), gy = Math.floor(y);
      if((gx-ox)*(gx-ox)+(gy-oy)*(gy-oy) > r2) break;
      mark(gx,gy);
      if(map.isSolid(gx,gy)) break;
    }
  }
}

export { makeItem, qualityMult };

