// ===== 等距(Isometric)瓦片渲染器 =====
// 菱形瓦片，宽:高 = 2:1，支持贴图纹理、精灵图、高度墙、Y-Sort、相机缩放

export const TILE_W = 64;
export const TILE_H = 32;
export const WALL_H = 32; // 墙体高度像素

import { MAT, GROUPS, BIOMES } from './materials.js';
import { tintForMat } from './material-tints.js';

// 怪物ID -> 精灵图key 映射
export const SPRITE_MAP = {
  slime: 'slime', rat: 'bat', bat: 'bat',
  kobold: 'goblin', goblin: 'goblin', orc: 'goblin',
  zombie: 'zombie', troll: 'zombie',
  ghost: 'ghost', imp: 'ghost',
  dragon: 'dragon',
};

export class Camera{
  constructor(){
    this.x = 0; this.y = 0;
    this.zoom = 1.0;
    this.targetX = 0; this.targetY = 0;
    this.targetZoom = 1.0;
  }
  follow(sx, sy){
    this.targetX = sx; this.targetY = sy;
  }
  setZoom(z){
    this.targetZoom = Math.max(0.5, Math.min(2.5, z));
  }
  update(dt){
    const k = 1 - Math.pow(0.001, dt);
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
    this.zoom += (this.targetZoom - this.zoom) * k;
  }
}

export function gridToScreen(gx, gy){
  return {
    x: (gx - gy) * (TILE_W/2),
    y: (gx + gy) * (TILE_H/2),
  };
}

export function screenToGrid(cx, cy, cam, canvasW, canvasH){
  const sx = (cx - canvasW/2) / cam.zoom + cam.x;
  const sy = (cy - canvasH/2) / cam.zoom + cam.y;
  const gx = (sx / (TILE_W/2) + sy / (TILE_H/2)) / 2;
  const gy = (sy / (TILE_H/2) - sx / (TILE_W/2)) / 2;
  // Math.floor on both axes independently gives wrong tile near diamond edges.
  // Check 4 candidate tiles and pick closest by diamond distance.
  const hw = TILE_W / 2, hh = TILE_H / 2;
  const fx = Math.floor(gx), fy = Math.floor(gy);
  let bestX = fx, bestY = fy, bestD = Infinity;
  for(const [tx,ty] of [[fx,fy],[fx+1,fy],[fx,fy+1],[fx+1,fy+1]]){
    const px = (tx - ty) * hw, py = (tx + ty) * hh;
    const d = Math.abs(sx - px) * hh + Math.abs(sy - py) * hw;
    if(d < bestD){ bestD = d; bestX = tx; bestY = ty; }
  }
  return {x: bestX, y: bestY};
}

export class IsoRenderer{
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.cam = new Camera();
    this.time = 0;
    this.resize();
    // 贴图与精灵
    this.textures = {};
    this.sprites = {};       // 旧版单图（保留兼容）
    this.spriteSheets = {};  // 新版图集：{ key: { idle:[canvas,...], walk:[...], attack:[...], hit:[...] } }
    this.assetsReady = false;
    this._tintCache = {};   // 材质着色缓存: key -> 已着色的离屏 canvas (或 null)
    this._loadAssets();
  }

  // ---- 加载纹理贴图和精灵图集 ----
  _loadAssets(){
    const texMap = {
      'floor': 'assets/textures/floor_stone.jpg',
      'wall':  'assets/textures/wall_stone.jpg',
      'grass': 'assets/textures/grass.jpg',
    };
    const sheetKeys = ['player','slime','goblin','bat','ghost','zombie','dragon'];
    let loaded = 0;
    const total = Object.keys(texMap).length + sheetKeys.length + 3; // +3 for Elin atlases (floors, blocks, shadows)
    const onDone = () => { loaded++; if(loaded >= total) this.assetsReady = true; };

    // 纹理贴图
    for(const [key, url] of Object.entries(texMap)){
      const img = new Image();
      img.onload = onDone;
      img.onerror = onDone;
      img.src = url;
      this.textures[key] = img;
    }

    // Elin 原版图集：floors.png (48px tiles), blocks.png (64px tiles), objs/objs_S/objs_L.png (装饰物)
    this.elinAtlases = {};
    const elinAtlasMap = {
      'floors':  'assets/elin/floors.png',
      'blocks':  'assets/elin/blocks.png',
      'shadows': 'assets/elin/shadows.png',
      'objs':    'assets/elin/objs.png',
      'objs_S':  'assets/elin/objs_S.png',
      'objs_L':  'assets/elin/objs_L.png',
      'objs_snow':    'assets/elin/objs_snow.png',
      'objs_S_snow':  'assets/elin/objs_S_snow.png',
      'objs_L_snow':  'assets/elin/objs_L_snow.png',
      'roofs':   'assets/elin/roofs.png',   // 新增：obj 22/26-30/67/124-134 等 roof 类物件真值图集
    };
    for(const [key, url] of Object.entries(elinAtlasMap)){
      const img = new Image();
      img.onload = () => { onDone(); };
      img.onerror = onDone;
      img.src = url + '?v=43';
      this.elinAtlases[key] = img;
    }

    // 精灵图集：4行(idle/walk/attack/hit) x 4列(帧) = 16帧
    const SHEET_COLS = 4, SHEET_ROWS = 4;
    const ANIM_ROWS = ['idle', 'walk', 'attack', 'hit'];

    for(const key of sheetKeys){
      const img = new Image();
      img.onload = () => {
        // 切片图集为帧数组
        this.spriteSheets[key] = this._sliceSpriteSheet(img, SHEET_COLS, SHEET_ROWS, ANIM_ROWS);
        // 同时生成旧版单图兼容（取 idle 第一帧）
        if(this.spriteSheets[key] && this.spriteSheets[key].idle){
          this.sprites[key] = this.spriteSheets[key].idle[0];
        }
        onDone();
      };
      img.onerror = onDone;
      img.src = `assets/sheets/${key}_sheet.jpg`;
    }
  }

  // ---- 将精灵图集切片为帧数组，并动态去除背景 ----
  _sliceSpriteSheet(img, cols, rows, animLabels){
    const w = img.naturalWidth, h = img.naturalHeight;
    if(!w || !h) return null;
    const cellW = Math.floor(w / cols);
    const cellH = Math.floor(h / rows);
    const sheet = {};

    // 辅助：采样一帧的四个角落实色
    const sampleCorners = (px, cw, ch) => {
      const samplePatch = (ox, oy) => {
        let sr=0, sg=0, sb=0, cnt=0;
        for(let dy=0; dy<10; dy++) for(let dx=0; dx<10; dx++){
          const xi = Math.min(cw-1, Math.max(0, ox+dx));
          const yi = Math.min(ch-1, Math.max(0, oy+dy));
          const i = (yi*cw+xi)*4;
          sr+=px[i]; sg+=px[i+1]; sb+=px[i+2]; cnt++;
        }
        return [sr/cnt, sg/cnt, sb/cnt];
      };
      return [
        samplePatch(0, 0),
        samplePatch(cw-10, 0),
        samplePatch(0, ch-10),
        samplePatch(cw-10, ch-10),
      ];
    };

    // 辅助：计算角样本的一致性（方差越小 = 越可能是纯背景）
    const cornerVariance = (corners) => {
      let mr=0, mg=0, mb=0;
      for(const c of corners){ mr+=c[0]; mg+=c[1]; mb+=c[2]; }
      mr/=4; mg/=4; mb/=4;
      let v=0;
      for(const c of corners){ v += (c[0]-mr)**2 + (c[1]-mg)**2 + (c[2]-mb)**2; }
      return v;
    };

    // 辅助：对单帧执行去背景
    const processFrame = (px, cw, ch, bgRef) => {
      const bgR = bgRef[0], bgG = bgRef[1], bgB = bgRef[2];
      const colorTol = 80;
      const colorTolSq = colorTol * colorTol;

      // 阶段1：按参考色去除匹配像素（全图颜色匹配）
      const removed = new Uint8Array(cw * ch);
      for(let i=0; i<cw*ch; i++){
        const idx = i*4;
        const dr = px[idx]-bgR, dg = px[idx+1]-bgG, db = px[idx+2]-bgB;
        if(dr*dr+dg*dg+db*db < colorTolSq){
          px[idx+3] = 0;
          removed[i] = 1;
        }
      }

      // 阶段2：泛洪填充从边缘清除残余背景
      const visited = new Uint8Array(cw * ch);
      const queue = [];
      const floodTol = 80;
      const floodTolSq = floodTol * floodTol;
      // 只从背景色边缘像素开始泛洪（避免误删角色边缘像素）
      const seedPixel = (x, y) => {
        const idx = y * cw + x;
        if(visited[idx]) return;
        const dr = px[idx*4]-bgR, dg = px[idx*4+1]-bgG, db = px[idx*4+2]-bgB;
        if(dr*dr+dg*dg+db*db < floodTolSq){
          visited[idx] = 1;
          queue.push(idx);
        }
      };
      for(let x = 0; x < cw; x++){ seedPixel(x, 0); seedPixel(x, ch-1); }
      for(let y = 0; y < ch; y++){ seedPixel(0, y); seedPixel(cw-1, y); }

      let head = 0;
      while(head < queue.length){
        const idx = queue[head++];
        px[idx*4+3] = 0;
        removed[idx] = 1;
        const x = idx % cw, y = (idx / cw) | 0;
        const tryNeighbor = (ni) => {
          if(visited[ni] || removed[ni]) return;
          const dr=px[ni*4]-bgR, dg=px[ni*4+1]-bgG, db=px[ni*4+2]-bgB;
          if(dr*dr+dg*dg+db*db < floodTolSq){ visited[ni]=1; queue.push(ni); }
        };
        if(x > 0) tryNeighbor(idx - 1);
        if(x < cw-1) tryNeighbor(idx + 1);
        if(y > 0) tryNeighbor(idx - cw);
        if(y < ch-1) tryNeighbor(idx + cw);
      }

      // 阶段3：填充角色内部小洞（被颜色匹配误删的暗色角色像素）
      for(let pass = 0; pass < 2; pass++){
        for(let y = 1; y < ch-1; y++){
          for(let x = 1; x < cw-1; x++){
            const idx = y * cw + x;
            if(px[idx*4+3] > 0) continue;
            let on = 0;
            if(px[((y-1)*cw+x)*4+3] > 0) on++;
            if(px[((y+1)*cw+x)*4+3] > 0) on++;
            if(px[(y*cw+x-1)*4+3] > 0) on++;
            if(px[(y*cw+x+1)*4+3] > 0) on++;
            if(on >= 4){
              px[idx*4+3] = 255;
            }
          }
        }
      }

      // 阶段4：边缘抗锯齿
      for(let y = 1; y < ch-1; y++){
        for(let x = 1; x < cw-1; x++){
          const idx = (y * cw + x) * 4;
          if(px[idx+3] < 200) continue;
          let tn = 0;
          if(px[((y-1)*cw+x)*4+3] === 0) tn++;
          if(px[((y+1)*cw+x)*4+3] === 0) tn++;
          if(px[(y*cw+x-1)*4+3] === 0) tn++;
          if(px[(y*cw+x+1)*4+3] === 0) tn++;
          if(tn >= 2) px[idx+3] = 128;
          else if(tn >= 1) px[idx+3] = 200;
        }
      }
    };

    // 先提取整张精灵图所有帧的原始像素数据
    const allFrameData = []; // [row][col] => {cv, cx, data, px}
    for(let row = 0; row < rows; row++){
      const rowData = [];
      for(let col = 0; col < cols; col++){
        const cv = document.createElement('canvas');
        cv.width = cellW;
        cv.height = cellH;
        const cx = cv.getContext('2d');
        cx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
        const data = cx.getImageData(0, 0, cellW, cellH);
        rowData.push({cv, cx, data, px: data.data});
      }
      allFrameData.push(rowData);
    }

    // 从整张精灵图所有帧中，用颜色直方图找到最常见的颜色簇作为全局背景参考
    // （角落采样在角色触及边缘时会被污染，直方图法则取全图最多见色 = 背景）
    const colorMap = {};
    for(let row = 0; row < rows; row++){
      for(let col = 0; col < cols; col++){
        const fd = allFrameData[row][col];
        const px = fd.px;
        for(let i = 0; i < cellW * cellH; i++){
          const idx = i * 4;
          // 量化到16级（每通道4bit），聚合相近颜色
          const qr = (px[idx] >> 4) << 4;
          const qg = (px[idx+1] >> 4) << 4;
          const qb = (px[idx+2] >> 4) << 4;
          const k = qr * 65536 + qg * 256 + qb;
          if(!colorMap[k]) colorMap[k] = { n: 0, r: 0, g: 0, b: 0 };
          colorMap[k].n++;
          colorMap[k].r += px[idx];
          colorMap[k].g += px[idx+1];
          colorMap[k].b += px[idx+2];
        }
      }
    }
    let bestBgRef = null, bestCount = 0;
    for(const k in colorMap){
      const e = colorMap[k];
      if(e.n > bestCount){
        bestCount = e.n;
        bestBgRef = [e.r / e.n, e.g / e.n, e.b / e.n];
      }
    }

    for(let row = 0; row < rows; row++){
      const animName = animLabels[row] || `row${row}`;
      sheet[animName] = [];
      // 用全局背景参考色处理该行所有帧
      for(const fd of allFrameData[row]){
        try {
          processFrame(fd.px, cellW, cellH, bestBgRef);
          fd.cx.putImageData(fd.data, 0, 0);
        } catch(e){ /* CORS */ }
        sheet[animName].push(fd.cv);
      }
    }
    return sheet;
  }

  // ---- 根据动画状态和时间获取当前帧 ----
  _getSpriteFrame(spriteKey, animState, animTime){
    const sheet = this.spriteSheets[spriteKey];
    if(!sheet) return null;
    const frames = sheet[animState] || sheet['idle'];
    if(!frames || frames.length === 0) return null;
    // 帧率：idle=4fps, walk=8fps, attack=12fps, hit=10fps
    const fps = animState === 'idle' ? 3 : animState === 'walk' ? 8 : animState === 'attack' ? 14 : 10;
    const frameIdx = Math.floor(animTime * fps) % frames.length;
    return frames[frameIdx];
  }

  resize(){
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.dpr = dpr;
    this.ctx.imageSmoothingEnabled = false;
  }

  applyCam(){
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.translate(w/2, h/2);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
  }

  clear(bg='#0a0c10'){
    const ctx = this.ctx;
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,this.canvas.clientWidth, this.canvas.clientHeight);
  }

  // ---- 获取瓦片对应的贴图 ----
  _tileTexture(tileId){
    // 旧单图纹理系统已弃用（改用 Elin 图集按数字 id 直绘）。保留兼容返回。
    return null;
  }

  // ---- 绘制单个菱形地面瓦片（带贴图 + 变体噪声 + 边缘过渡）----
  // ---- 兜底地面填充（drawFloorAtlas 失败时使用）----
  drawTileFloor(gx, gy, tid, visible, explored, hover){
    const ctx = this.ctx;
    const p = gridToScreen(gx, gy);
    const hw = TILE_W/2, hh = TILE_H/2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - hh); ctx.lineTo(p.x + hw, p.y);
    ctx.lineTo(p.x, p.y + hh); ctx.lineTo(p.x - hw, p.y); ctx.closePath();
    ctx.fillStyle = '#3a5a3a'; ctx.fill();
    ctx.restore();
  }

  // ---- 特殊瓦片覆盖（楼梯/门/祭坛/宝箱）: 矢量绘制于真实地板之上 ----
  drawSpecialTile(gx, gy, kind, visible, explored, hover){
    if(!kind) return;
    const ctx = this.ctx;
    const p = gridToScreen(gx, gy);
    const hw = TILE_W/2, hh = TILE_H/2;
    ctx.save();
    if(kind === 'stairs_dn' || kind === 'stairs_up'){
      const dn = kind === 'stairs_dn';
      ctx.fillStyle = dn ? 'rgba(40,80,110,0.55)' : 'rgba(110,80,30,0.55)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - hh); ctx.lineTo(p.x + hw, p.y);
      ctx.lineTo(p.x, p.y + hh); ctx.lineTo(p.x - hw, p.y); ctx.closePath();
      ctx.fill();
      const dir = dn ? 1 : -1;
      ctx.fillStyle = dn ? '#4a9fc9' : '#c9a23a';
      for(let i=0;i<4;i++){
        const oy = (i-1.5)*5*dir;
        const w = 18 - Math.abs(i-1.5)*2;
        ctx.fillRect(p.x-w/2, p.y+oy-1, w, 2.5);
      }
      ctx.fillStyle = '#fff';
      ctx.font = (12/this.cam.zoom)+'px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dn?'▼':'▲', p.x, p.y - 14);
      ctx.textBaseline = 'alphabetic';
    } else if(kind === 'door'){
      ctx.fillStyle = '#5a3a1a'; ctx.fillRect(p.x-9, p.y-12, 18, 22);
      ctx.fillStyle = '#8a6a3a'; ctx.fillRect(p.x-7, p.y-10, 14, 18);
      ctx.fillStyle = '#c9a23a'; ctx.fillRect(p.x+4, p.y-1, 2, 2);
    } else if(kind === 'altar'){
      ctx.fillStyle = '#7a6aaa'; ctx.fillRect(p.x-12, p.y-10, 24, 18);
      ctx.fillStyle = '#a990d0'; ctx.fillRect(p.x-8, p.y-14, 16, 4);
      ctx.fillStyle = '#c9b0e0';
      ctx.beginPath(); ctx.arc(p.x, p.y-16, 4, 0, Math.PI*2); ctx.fill();
    } else if(kind === 'chest'){
      ctx.fillStyle = '#6a4a25'; ctx.fillRect(p.x-10, p.y-12, 20, 16);
      ctx.fillStyle = '#8a6a35'; ctx.fillRect(p.x-8, p.y-10, 16, 12);
      ctx.fillStyle = '#c9a23a'; ctx.fillRect(p.x-2, p.y-6, 3, 3);
    }
    if(hover){
      ctx.strokeStyle = '#7fd1c4'; ctx.lineWidth = 2/this.cam.zoom;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - hh); ctx.lineTo(p.x + hw, p.y);
      ctx.lineTo(p.x, p.y + hh); ctx.lineTo(p.x - hw, p.y); ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 绘制带高度的墙体瓦片（贴图立方体）----
  drawTileWall(gx, gy, tile, visible, explored, neighborInfo){
    const ctx = this.ctx;
    const p = gridToScreen(gx, gy);
    const hw = TILE_W/2, hh = TILE_H/2;
    const dim = !visible && explored;
    if(!visible && !explored) return;

    // 邻居墙体信息（由调用方传入）
    // wallW = 西邻(gx-1,gy)是墙, wallN = 北邻(gx,gy-1)是墙
    // wallE = 东邻(gx+1,gy)是墙, wallS = 南邻(gx,gy+1)是墙
    const nb = neighborInfo || {};

    const tex = this.textures['wall'];
    const hasTex = tex && tex.complete && tex.naturalWidth > 0;
    let base = tile.base, top = tile.top;
    if(dim){ base = shade(base,0.35); top = shade(top,0.35); }

    const drawFace = (pts, texOffset, darken=0) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.clip();
      if(hasTex){
        ctx.drawImage(tex, p.x - hw, p.y - WALL_H - hh, TILE_W, TILE_H + WALL_H + hh);
        if(darken > 0){
          ctx.fillStyle = `rgba(0,0,0,${darken})`;
          ctx.fillRect(p.x - hw, p.y - WALL_H - hh, TILE_W, TILE_H + WALL_H + hh);
        }
        if(dim){
          ctx.fillStyle = 'rgba(15,18,28,0.55)';
          ctx.fillRect(p.x - hw, p.y - WALL_H - hh, TILE_W, TILE_H + WALL_H + hh);
        }
      } else {
        ctx.fillStyle = shade(base, darken > 0 ? -darken : 0);
        ctx.fill();
      }
      ctx.restore();
    };

    // 左侧面（西南面）— 始终绘制，由画家算法处理遮挡
    drawFace([
      {x:p.x-hw, y:p.y}, {x:p.x, y:p.y+hh},
      {x:p.x, y:p.y+hh-WALL_H}, {x:p.x-hw, y:p.y-WALL_H}
    ], null, 0.25);

    // 右侧面（东南面）— 始终绘制，由画家算法处理遮挡
    drawFace([
      {x:p.x+hw, y:p.y}, {x:p.x, y:p.y+hh},
      {x:p.x, y:p.y+hh-WALL_H}, {x:p.x+hw, y:p.y-WALL_H}
    ], null, 0.1);

    // 顶面 — 始终绘制，前方墙体会自然遮挡
    {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - hh - WALL_H);
      ctx.lineTo(p.x + hw, p.y - WALL_H);
      ctx.lineTo(p.x, p.y + hh - WALL_H);
      ctx.lineTo(p.x - hw, p.y - WALL_H);
      ctx.closePath();
      ctx.clip();
      if(hasTex){
        ctx.drawImage(tex, p.x - hw, p.y - hh - WALL_H, TILE_W, TILE_H);
        if(dim){
          ctx.fillStyle = 'rgba(15,18,28,0.55)';
          ctx.fillRect(p.x - hw, p.y - hh - WALL_H, TILE_W, TILE_H);
        }
      } else {
        ctx.fillStyle = top;
        ctx.fill();
      }
      ctx.restore();

      // 顶面描边
      ctx.strokeStyle = hasTex ? 'rgba(0,0,0,0.3)' : shade(top,-0.2);
      ctx.lineWidth = 1/this.cam.zoom;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - hh - WALL_H);
      ctx.lineTo(p.x + hw, p.y - WALL_H);
      ctx.lineTo(p.x, p.y + hh - WALL_H);
      ctx.lineTo(p.x - hw, p.y - WALL_H);
      ctx.closePath();
      ctx.stroke();

      // 顶面高光边（前缘亮线，增强2.5D深度感）
      ctx.strokeStyle = `rgba(255,255,255,${dim ? 0.06 : 0.15})`;
      ctx.lineWidth = 1/this.cam.zoom;
      ctx.beginPath();
      ctx.moveTo(p.x - hw, p.y - WALL_H);
      ctx.lineTo(p.x, p.y + hh - WALL_H);
      ctx.lineTo(p.x + hw, p.y - WALL_H);
      ctx.stroke();
    }

    // 墙基环境光遮蔽（AO）— 墙体底部与地面交界处加深
    if(visible){
      const aoGrad = ctx.createLinearGradient(p.x, p.y - 4, p.x, p.y + hh);
      aoGrad.addColorStop(0, 'rgba(0,0,0,0)');
      aoGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = aoGrad;
      ctx.beginPath();
      ctx.moveTo(p.x - hw, p.y);
      ctx.lineTo(p.x, p.y + hh);
      ctx.lineTo(p.x + hw, p.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---- 材质程序化着色 ----
  // 灰度图集(floors/blocks.png)按材质 alias 做 multiply 着色，
  // 复用离屏 canvas 缓存（每个 tile id 只渲染一次）。
  // 返回着色后的 canvas，或 null（该材质不着色，直接画原图）。
  _getTintedTile(atlasName, key, atlas, sx, sy, sw, sh, tint, mode){
    const ck = atlasName + ':' + key + ':' + (mode || 'mul');
    const cached = this._tintCache[ck];
    if(cached !== undefined) return cached;           // 含 null
    if(!tint){ this._tintCache[ck] = null; return null; }

    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    const cx = cv.getContext('2d');
    if(mode === 'colorize'){
      // 按遮罩灰度着色：保留精灵内部明暗(不变成纯色块)
      // 1) 先画原灰度遮罩(含 alpha)
      cx.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
      // 2) 逐像素：以遮罩亮度归一化后乘 tint，亮部满色、暗部留底色 → 有立体感的着色树/花
      const img = cx.getImageData(0, 0, sw, sh);
      const d = img.data;
      const tr = tint[0], tg = tint[1], tb = tint[2];
      let maxL = 1;
      for(let i = 0; i < d.length; i += 4){
        if(d[i+3] > 0){
          const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
          if(lum > maxL) maxL = lum;
        }
      }
      const inv = 255 / maxL;
      for(let i = 0; i < d.length; i += 4){
        if(d[i+3] > 0){
          const lum = (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]) * inv; // → 0..255
          const f = 0.30 + 0.70 * (lum / 255);   // 暗部保留 30% 底色，亮部满色
          d[i]   = Math.min(255, tr * f);
          d[i+1] = Math.min(255, tg * f);
          d[i+2] = Math.min(255, tb * f);
          // alpha 保留
        }
      }
      cx.putImageData(img, 0, 0);
    } else {
      // 1) 原图（含 alpha 遮罩）
      cx.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
      // 2) multiply 着色
      cx.globalCompositeOperation = 'multiply';
      cx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
      cx.fillRect(0, 0, sw, sh);
      // 3) 用原图 alpha 还原透明区域
      cx.globalCompositeOperation = 'destination-in';
      cx.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
      cx.globalCompositeOperation = 'source-over';
    }

    this._tintCache[ck] = cv;
    return cv;
  }

  // ---- 从Elin图集绘制地板 (floors.png, 48px tiles) ----
  // Elin菱形真实几何(逐行alpha扫描确认):
  //   顶(31,11) 左(1,27.5) 右(61,27.5) 底(31,44)
  //   真实宽=60 高=33 中心(31,27.5) → 非均匀缩放 scaleX=64/60 scaleY=32/33
  //   菱形右侧延伸到源x=61, 但cell只有48px宽 → 右侧14px在c%4==1列
  //   解决: 源宽度63px(=48+15), 跨cell读取完整菱形
  //   c%4==1列左侧的颜色与c%4==0完全匹配(已验证7种地板)
  //   不裁剪菱形 — 直接画完整区域, 透明角落自然形成菱形

  drawFloorAtlas(gx, gy, floorId, visible, explored, hover){
    const m = MAT.floor[floorId];
    if(!m) return false;
    const atlas = this.elinAtlases?.['floors'];
    if(!atlas || !atlas.complete || atlas.naturalWidth === 0) return false;

    const ctx = this.ctx;
    const p = gridToScreen(gx, gy);
    const dim = !visible && explored;
    const srcCellW = 64;  // floors.png cell width
    const srcCellH = 48;  // floors.png cell height

    const srcC = Math.floor(m.rect[0] / 64);
    const srcR = Math.floor(m.rect[1] / 48);

    // 调试截取偏移
    const dsx = this._debugSrcOff?.x || 0;
    const dsy = this._debugSrcOff?.y || 0;
    const ddx = this._debugDrawOff?.x || 0;
    const ddy = this._debugDrawOff?.y || 0;

    // 非均匀缩放: X方向映射菱形真宽60→TILE_W(64), Y方向映射真高33→TILE_H(32)
    const scaleX = TILE_W / 60;   // ≈1.0667
    const scaleY = TILE_H / 33;   // ≈0.9697
    // 源宽度: 63px — 完整截取60px宽菱形(含右侧溢出)
    const srcW = 63;
    const drawW = srcW * scaleX;
    const drawH = 48 * scaleY;
    // 菱形中心: 60px宽菱形居中于64px cell → center_x=32, 高33px底部对齐 → center_y=27.5
    const drawX = p.x - 32 * scaleX + ddx;
    const drawY = p.y - 27.5 * scaleY + ddy;

    // 画完整菱形 (源宽63px, 跨c%4==0和c%4==1两个cell)
    // 加0.5px padding防止亚像素级别的缝隙
    const pad = 0.5;
    const tint = tintForMat(m.mat);
    const tt = this._getTintedTile('floors', floorId, atlas,
      srcC * srcCellW + dsx, srcR * srcCellH + dsy, srcW, srcCellH, tint);
    if(tt){
      ctx.drawImage(tt, drawX - pad, drawY - pad, drawW + pad*2, drawH + pad*2);
    } else {
      ctx.drawImage(atlas,
        srcC * srcCellW + dsx, srcR * srcCellH + dsy, srcW, srcCellH,
        drawX - pad, drawY - pad, drawW + pad*2, drawH + pad*2
      );
    }

    // 战争迷雾由game.js批量处理

    if(hover){
      ctx.strokeStyle = '#7fd1c4';
      ctx.lineWidth = 2/this.cam.zoom;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - TILE_H/2);
      ctx.lineTo(p.x + TILE_W/2, p.y);
      ctx.lineTo(p.x, p.y + TILE_H/2);
      ctx.lineTo(p.x - TILE_W/2, p.y);
      ctx.closePath();
      ctx.stroke();
    }
    return true;
  }


  // ---- 绘制堆叠方块 (blocks.png, 64px tiles, 支持无限高度堆叠) ----
  // blockIds: 从底到顶的方块类型ID数组
  // 返回总高度(像素)，用于深度排序
  drawBlockStack(gx, gy, blockIds, visible, explored, hover){
    if(!blockIds || blockIds.length === 0) return 0;
    const ctx = this.ctx;
    const p = gridToScreen(gx, gy);
    if(!visible && !explored) return 0;

    const atlas = this.elinAtlases?.['blocks'];
    if(!atlas || !atlas.complete || atlas.naturalWidth === 0) return 0;

    const tilePx = 64;
    const spriteSize = 64;
    let accumH = 0;

    ctx.save();

    for(let i = 0; i < blockIds.length; i++){
      const bt = MAT.block[blockIds[i]];
      if(!bt) continue;

      const col = Math.floor(bt.rect[0] / tilePx);
      const row = Math.floor(bt.rect[1] / tilePx);
      const drawY = p.y - 48 - accumH;
      const tint = tintForMat(bt.mat);
      const tt = this._getTintedTile('blocks', blockIds[i], atlas,
        col * tilePx, row * tilePx, tilePx, tilePx, tint);
      if(tt){
        ctx.drawImage(tt, p.x - 32, drawY, spriteSize, spriteSize);
      } else {
        ctx.drawImage(atlas,
          col * tilePx, row * tilePx, tilePx, tilePx,
          p.x - 32, drawY, spriteSize, spriteSize
        );
      }

      accumH += (bt.h || 1) * WALL_H;
    }

    ctx.restore();

    // hover高亮
    if(hover && visible){
      ctx.strokeStyle = '#7fd1c4';
      ctx.lineWidth = 2/this.cam.zoom;
      const topY = p.y - 48 - accumH + 16; // 顶面中心Y
      ctx.beginPath();
      ctx.moveTo(p.x, topY - TILE_H/2);
      ctx.lineTo(p.x + TILE_W/2, topY);
      ctx.lineTo(p.x, topY + TILE_H/2);
      ctx.lineTo(p.x - TILE_W/2, topY);
      ctx.closePath();
      ctx.stroke();
    }

    return accumH;
  }

  // ---- 绘制实体（角色/怪物，优先使用精灵图）----
  drawEntity(gx, gy, opts){
    const ctx = this.ctx;
    const p = gridToScreen(gx, gy);
    const {color='#fff', name='', size=1, isPlayer=false, hpRatio=1, floatBob=0, sprite=null} = opts;
    const yy = p.y + floatBob;

    // 软阴影
    const sRad = 14 * size;
    const sGrad = ctx.createRadialGradient(p.x, p.y+3, 0, p.x, p.y+3, sRad * 1.6);
    sGrad.addColorStop(0, 'rgba(0,0,0,0.4)');
    sGrad.addColorStop(0.5, 'rgba(0,0,0,0.2)');
    sGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y+3, sRad*1.6, sRad*0.7*1.6, 0, 0, Math.PI*2);
    ctx.fill();

    // 精灵图绘制
    const spr = sprite ? this.sprites[sprite] : null;
    const hasSpr = spr && (spr.complete || spr.width > 0) && (spr.naturalWidth > 0 || spr.width > 0);

    if(hasSpr){
      const sw = 48 * size;
      const sh = 48 * size;
      const sx = p.x - sw/2;
      const sy = yy - sh + 4;
      ctx.drawImage(spr, sx, sy, sw, sh);
    } else {
      // 回退：形状绘制
      const bw = 16*size, bh = 22*size;
      const bx = p.x - bw/2, by = yy - bh;
      ctx.fillStyle = shade(color,-0.15);
      roundRect(ctx, bx, by+bh*0.35, bw, bh*0.65, 3*size);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, by+bh*0.25, 7*size, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#0a0c10';
      ctx.fillRect(p.x-3*size, by+bh*0.22, 2*size, 2*size);
      ctx.fillRect(p.x+1*size, by+bh*0.22, 2*size, 2*size);
    }

    // 玩家标记
    if(isPlayer){
      const topY = yy - 50*size;
      ctx.fillStyle = '#e0b34a';
      ctx.beginPath();
      ctx.moveTo(p.x, topY);
      ctx.lineTo(p.x-5, topY+6);
      ctx.lineTo(p.x+5, topY+6);
      ctx.closePath();
      ctx.fill();
    }

    // HP 条
    if(hpRatio < 1 && hpRatio >= 0){
      const bw2 = 24*size;
      const barY = yy - 48*size;
      ctx.fillStyle = '#000';
      ctx.fillRect(p.x-bw2/2, barY, bw2, 3*size);
      ctx.fillStyle = hpRatio>0.5?'#6abf6a':hpRatio>0.25?'#e0b34a':'#c9404a';
      ctx.fillRect(p.x-bw2/2, barY, bw2*hpRatio, 3*size);
    }

    // 名字
    if(name && !isPlayer){
      ctx.font = `${10/this.cam.zoom}px Microsoft YaHei`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(name, p.x+1, yy-50*size+1);
      ctx.fillStyle = '#dfe6f0';
      ctx.fillText(name, p.x, yy-50*size);
    }
  }

  // ---- 绘制实体（浮点坐标版本，序列帧动画）----
  drawEntityFloat(fx, fy, opts){
    const ctx = this.ctx;
    // 浮点坐标 -> 屏幕像素
    const p = {
      x: (fx - fy) * (TILE_W/2),
      y: (fx + fy) * (TILE_H/2),
    };
    const {color='#fff', name='', size=1, isPlayer=false, isNPC=false, npcColor=null, canInteract=false,
           hpRatio=1, floatBob=0, sprite=null,
           animState='idle', animTime=0, animDir={x:0,y:1}, faceLeft=false, hitFlash=0, attackAnim=0,
           currentPackage=null} = opts;

    // ---- 轻量级程序化辅助效果（叠加在序列帧之上）----
    let offsetX = 0, offsetY = floatBob;
    let flashAlpha = 0;

    // 浮空单位始终上下飘
    if(!sprite || true){ offsetY += Math.sin(animTime * 3) * 0.5; }

    if(animState === 'attack'){
      // 攻击时轻微向朝向方向偏移（世界方向 -> 屏幕方向）
      const phase = 1 - attackAnim;
      const lunge = Math.sin(phase * Math.PI) * 4 * size;
      const sdx = animDir.x - animDir.y;
      const sdy = animDir.x + animDir.y;
      const slen = Math.sqrt(sdx*sdx + sdy*sdy);
      if(slen > 0){
        offsetX = (sdx/slen) * lunge;
        offsetY += (sdy/slen) * lunge;
      }
    } else if(animState === 'hit'){
      // 受击抖动
      offsetX = (Math.random() - 0.5) * 3 * size;
      offsetY += (Math.random() - 0.5) * 2 * size;
      flashAlpha = hitFlash > 0 ? Math.min(1, hitFlash * 4) : 0;
    }

    const cx = p.x + offsetX;
    const yy = p.y + offsetY;

    // ---- 软阴影（多层渐变）----
    const shadowPulse = animState === 'walk' ? (1 - Math.abs(Math.sin(animTime*8))*0.12) : 1;
    const floatFactor = 1 - Math.min(0.5, Math.abs(floatBob) / 30); // 浮空越高阴影越淡越小
    const sAlpha = 0.4 * shadowPulse * floatFactor;
    const sRad = 14 * size * shadowPulse * floatFactor;
    // 外层柔和阴影
    const sGrad = ctx.createRadialGradient(p.x + offsetX*0.3, p.y+3, 0, p.x + offsetX*0.3, p.y+3, sRad * 1.6);
    sGrad.addColorStop(0, `rgba(0,0,0,${sAlpha})`);
    sGrad.addColorStop(0.5, `rgba(0,0,0,${sAlpha*0.5})`);
    sGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    ctx.ellipse(p.x + offsetX*0.3, p.y+3, sRad*1.6, sRad*0.7*1.6, 0, 0, Math.PI*2);
    ctx.fill();
    // 内层核心阴影
    ctx.fillStyle = `rgba(0,0,0,${sAlpha*0.7})`;
    ctx.beginPath();
    ctx.ellipse(p.x + offsetX*0.3, p.y+3, sRad*0.6, sRad*0.3, 0, 0, Math.PI*2);
    ctx.fill();

    // ---- 序列帧绘制 ----
    let frame = null;
    if(sprite){
      frame = this._getSpriteFrame(sprite, animState, animTime);
    }
    // 回退到旧版单图
    if(!frame && sprite){
      frame = this.sprites[sprite] || null;
    }

    ctx.save();
    if(frame){
      const sw = 48 * size;
      const sh = 48 * size;
      const sx = cx - sw/2;
      const sy = yy - sh + 4;
      // 面向左侧时水平翻转精灵
      if(faceLeft){
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-cx, 0);
      }
      ctx.drawImage(frame, sx, sy, sw, sh);
      // 受击红闪叠加
      if(flashAlpha > 0){
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(255,40,40,${flashAlpha * 0.55})`;
        ctx.fillRect(sx, sy, sw, sh);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      // 无精灵图回退：形状绘制
      const bw = 16*size, bh = 22*size;
      const bx = cx - bw/2, by = yy - bh;
      ctx.fillStyle = shade(color,-0.15);
      roundRect(ctx, bx, by+bh*0.35, bw, bh*0.65, 3*size);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, by+bh*0.25, 7*size, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#0a0c10';
      ctx.fillRect(cx-3*size, by+bh*0.22, 2*size, 2*size);
      ctx.fillRect(cx+1*size, by+bh*0.22, 2*size, 2*size);
      if(flashAlpha > 0){
        ctx.fillStyle = `rgba(255,40,40,${flashAlpha * 0.5})`;
        roundRect(ctx, bx, by, bw, bh, 3*size);
        ctx.fill();
      }
    }
    ctx.restore();

    // 玩家标记
    if(isPlayer){
      const topY = yy - 50*size;
      ctx.fillStyle = '#e0b34a';
      ctx.beginPath();
      ctx.moveTo(cx, topY);
      ctx.lineTo(cx-5, topY+6);
      ctx.lineTo(cx+5, topY+6);
      ctx.closePath();
      ctx.fill();
    }

    // HP 条
    if(hpRatio < 1 && hpRatio >= 0){
      const bw2 = 24*size;
      const barY = yy - 48*size;
      ctx.fillStyle = '#000';
      ctx.fillRect(cx-bw2/2, barY, bw2, 3*size);
      ctx.fillStyle = hpRatio>0.5?'#6abf6a':hpRatio>0.25?'#e0b34a':'#c9404a';
      ctx.fillRect(cx-bw2/2, barY, bw2*hpRatio, 3*size);
    }

    // 名字
    if(name && !isPlayer){
      const nameColor = isNPC ? (npcColor || '#7fdb7a') : '#dfe6f0';
      ctx.font = `${10/this.cam.zoom}px Microsoft YaHei`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(name, cx+1, yy-50*size+1);
      ctx.fillStyle = nameColor;
      ctx.fillText(name, cx, yy-50*size);

      // NPC 交互提示（金色感叹号或对话泡）
      if(isNPC && canInteract){
        const bobY = Math.sin(this.time * 3) * 2;
        ctx.font = `${12/this.cam.zoom}px serif`;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText('💬', cx+1, yy-62*size+bobY+1);
        ctx.fillStyle = '#e0b34a';
        ctx.fillText('💬', cx, yy-62*size+bobY);
      }

      // NPC 状态图标（睡觉/吃饭等）
      if(isNPC){
        let stateIcon = null;
        if(currentPackage === 'sleep') stateIcon = '💤';
        else if(currentPackage === 'eat') stateIcon = '🍽';
        else if(currentPackage === 'flee') stateIcon = '😱';
        else if(currentPackage === 'alert') stateIcon = '⚔';
        if(stateIcon){
          ctx.font = `${10/this.cam.zoom}px serif`;
          ctx.fillText(stateIcon, cx + 14*size, yy - 38*size);
        }
      }
    }
  }

  // ---- 绘制地面物品 ----
  drawItem(gx, gy, icon, color='#e0b34a'){
    const ctx = this.ctx;
    const p = gridToScreen(gx, gy);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y+3, 8, 3, 0, 0, Math.PI*2);
    ctx.fill();
    // 光晕
    const grad = ctx.createRadialGradient(p.x, p.y-2, 0, p.x, p.y-2, 8);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y-2, 8, 0, Math.PI*2);
    ctx.fill();
    // 图标
    if(icon){
      ctx.font = `${12/this.cam.zoom}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(icon, p.x, p.y-2);
      ctx.textBaseline = 'alphabetic';
    }
  }

  drawFog(){}

  // ---- 绘制装饰物（贴图版） ----
  drawDecoration(decor){
    const ctx = this.ctx;
    const p = gridToScreen(decor.x, decor.y);
    const s = decor.scale;
    const t = this.time;
    const def = MAT.obj[decor.type];
    if(!def) return;
    const hw = TILE_W/2, hh = TILE_H/2;

    // ---- 墙壁装饰物：按 face 定位到对应面 ----
    let cx = p.x + decor.ox;
    let cy = p.y + decor.oy;
    if(decor.face){
      switch(decor.face){
        case 'top':
          cy -= WALL_H;
          break;
        case 'left':
          cx -= hw * 0.32;
          cy += hh * 0.12 - WALL_H * 0.5;
          break;
        case 'right':
          cx += hw * 0.32;
          cy += hh * 0.12 - WALL_H * 0.5;
          break;
        case 'front':
          cy += hh * 0.28 - WALL_H * 0.45;
          break;
      }
    }

    // ---- 贴图绘制 ----
    const atlas = this.elinAtlases?.[def.atlas];
    if(atlas && atlas.complete && atlas.naturalWidth > 0){
      const sw = def.rect[2], sh = def.rect[3];
      const dw = sw * s, dh = sh * s;
      const tint = def.tint;
      // 程序化着色(obj 灰度遮罩 → 实色, 见 material-tints / build_materials OBJ_TINT)
      if(tint){
        const tt = this._getTintedTile('obj_' + def.atlas, String(decor.type), atlas,
          def.rect[0], def.rect[1], sw, sh, tint, 'colorize');
        if(tt){
          ctx.save();
          if(def.flip){ ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
          ctx.drawImage(tt, cx - dw/2, cy - dh, dw, dh);
          ctx.restore();
          return;
        }
      }
      ctx.save();
      if(def.flip){ ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
      ctx.drawImage(atlas, def.rect[0], def.rect[1], sw, sh, cx - dw/2, cy - dh, dw, dh);
      ctx.restore();
      return;
    }

    // ---- 回退：图集未加载时用简单形状 ----
    ctx.save();
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(cx, cy - 6*s, 5*s, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  drawTarget(gx, gy, color='#c9404a'){
    const ctx = this.ctx;
    const p = gridToScreen(gx, gy);
    const hw = TILE_W/2, hh = TILE_H/2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2/this.cam.zoom;
    ctx.setLineDash([4/this.cam.zoom, 3/this.cam.zoom]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - hh);
    ctx.lineTo(p.x + hw, p.y);
    ctx.lineTo(p.x, p.y + hh);
    ctx.lineTo(p.x - hw, p.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawArea(tiles, color='rgba(224,179,74,0.25)'){
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for(const t of tiles){
      const p = gridToScreen(t.x, t.y);
      const hw = TILE_W/2, hh = TILE_H/2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - hh);
      ctx.lineTo(p.x + hw, p.y);
      ctx.lineTo(p.x, p.y + hh);
      ctx.lineTo(p.x - hw, p.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  restore(){ this.ctx.restore(); }
}

// ---- 工具函数 ----
export function shade(hex, amt){
  const c = hexToRgb(hex);
  if(amt < 0){
    const f = 1+amt;
    return rgbToHex(c.r*f, c.g*f, c.b*f);
  } else {
    return rgbToHex(c.r+(255-c.r)*amt, c.g+(255-c.g)*amt, c.b+(255-c.b)*amt);
  }
}
function hexToRgb(hex){
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(h=>h+h).join('');
  return {r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)};
}
function rgbToHex(r,g,b){
  const h = v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
  return '#'+h(r)+h(g)+h(b);
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,y,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
