// ===== A* 寻路模块 =====
// 在网格上寻找最短可行走路径

/**
 * A* 寻路
 * @param {Object} map - GameMap 实例（需要 isWalkable 方法）
 * @param {number} sx, sy - 起点网格坐标
 * @param {number} tx, ty - 终点网格坐标
 * @param {Object} opts - { maxIter, allowDiagonal, entityCheck }
 * @returns {Array<{x,y}>} 路径点数组（含起点不含终点→实际上不含起点，含终点），空数组表示无路径
 */
export function findPath(map, sx, sy, tx, ty, opts = {}){
  const maxIter = opts.maxIter || 2000;
  const allowDiagonal = opts.allowDiagonal !== false;
  const entityCheck = opts.entityCheck; // (x,y) => boolean 是否被实体阻挡

  sx = Math.round(sx); sy = Math.round(sy);
  tx = Math.round(tx); ty = Math.round(ty);

  if(sx === tx && sy === ty) return [];

  // 终点本身可能不可走，找最近的可走点
  if(!map.isWalkable(tx, ty)){
    let found = null;
    for(let r = 1; r <= 3 && !found; r++){
      for(let dy = -r; dy <= r && !found; dy++){
        for(let dx = -r; dx <= r && !found; dx++){
          if(map.isWalkable(tx+dx, ty+dy)){ found = {x: tx+dx, y: ty+dy}; }
        }
      }
    }
    if(!found) return [];
    tx = found.x; ty = found.y;
  }

  const key = (x, y) => y * map.w + x;
  const openMap = new Map();   // key -> node
  const closed = new Set();
  const cameFrom = new Map();

  const startNode = { x: sx, y: sy, g: 0, f: 0 };
  startNode.f = _heuristic(sx, sy, tx, ty);
  openMap.set(key(sx, sy), startNode);

  let iter = 0;
  const neighbors = allowDiagonal
    ? [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
    : [[1,0],[-1,0],[0,1],[0,-1]];

  while(openMap.size > 0 && iter < maxIter){
    iter++;

    // 取 f 最小的节点
    let current = null;
    let currentKey = -1;
    for(const [k, node] of openMap){
      if(!current || node.f < current.f){
        current = node;
        currentKey = k;
      }
    }

    if(current.x === tx && current.y === ty){
      // 重建路径
      const result = [];
      result.push({ x: tx, y: ty });
      let ck2 = key(tx, ty);
      while(cameFrom.has(ck2)){
        const prev = cameFrom.get(ck2);
        result.unshift(prev);
        ck2 = key(prev.x, prev.y);
      }
      // 移除起点（玩家已经在那里）
      if(result.length > 0 && result[0].x === sx && result[0].y === sy){
        result.shift();
      }
      return result;
    }

    openMap.delete(currentKey);
    closed.add(currentKey);

    for(const [dx, dy] of neighbors){
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);

      if(closed.has(nk)) continue;
      if(!map.isWalkable(nx, ny)) continue;
      // 对角线不能穿越墙角
      if(dx !== 0 && dy !== 0){
        if(!map.isWalkable(current.x + dx, current.y) || !map.isWalkable(current.x, current.y + dy)) continue;
      }
      // 实体阻挡检查（可选）
      if(entityCheck && entityCheck(nx, ny)) continue;

      const moveCost = (dx !== 0 && dy !== 0) ? 1.414 : 1.0;
      const g = current.g + moveCost;

      const existing = openMap.get(nk);
      if(!existing || g < existing.g){
        const h = _heuristic(nx, ny, tx, ty);
        openMap.set(nk, { x: nx, y: ny, g, f: g + h });
        cameFrom.set(nk, { x: current.x, y: current.y });
      }
    }
  }

  return []; // 无路径
}

function _heuristic(x1, y1, x2, y2){
  const dx = Math.abs(x1 - x2), dy = Math.abs(y1 - y2);
  return (dx + dy) + (1.414 - 2) * Math.min(dx, dy); // 八方向启发
}

/**
 * 平滑路径：移除共线的中间点，减少抖动
 */
export function smoothPath(path){
  if(path.length <= 2) return path;
  const result = [path[0]];
  for(let i = 1; i < path.length - 1; i++){
    const prev = result[result.length - 1];
    const curr = path[i];
    const next = path[i + 1];
    // 如果三点共线，跳过中间点
    const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
    if(Math.abs(cross) > 0.001){
      result.push(curr);
    }
  }
  result.push(path[path.length - 1]);
  return result;
}
