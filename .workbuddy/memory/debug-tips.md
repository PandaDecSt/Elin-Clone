# 调试技巧总结

## 1. 截图对比法

用 Puppeteer 截图，与游戏截图叠加对比，发现渲染差异。

```javascript
// 对比两个截图，计算像素差异百分比
// Puppeteer script: puppeteer-compare.js
const puppeteer = require('puppeteer');
const { createCanvas, loadImage } = require('canvas');

async function compareImages(page, url1, url2, options = {}) {
  // 分别截图，然后逐像素对比
  // options.include: [[180,60,660,180]] 指定对比区域
}
```

**适用场景**：验证两个状态的视觉差异（如雾气渲染前后）

---

## 2. 菱形网格命中测试

等距游戏中，`screenToGrid` 不能用 `Math.floor`，必须找最近的瓦片中心。

```javascript
// 错误：独立取整，菱形边界处系统性偏移
gx = Math.floor(gx);
gy = Math.floor(gy);

// 正确：4个候选格子，菱形距离比较
function screenToGrid(cx, cy, cam, W, H) {
  // 1. 浮点网格坐标
  const rawGx = (cx - ox) / hw;
  const rawGy = (cy - oy) / hh;

  // 2. 4个候选格子（向下、向上各2个）
  const candidates = [[fx, fy], [fx+1, fy], [fx, fy+1], [fx+1, fy+1]];

  // 3. 菱形距离：|dx|*hh + |dy|*hw
  let best = null, bestD = Infinity;
  for (const [gx, gy] of candidates) {
    const dx = rawGx - gx, dy = rawGy - gy;
    const d = Math.abs(dx) * hh + Math.abs(dy) * hw;
    if (d < bestD) { bestD = d; best = [gx, gy]; }
  }
  return best;
}
```

**关键**：菱形距离用 `Math.abs(dx) * hh + Math.abs(dy) * hw`，不是欧几里得距离

---

## 3. 雾气可视化（边界测试）

把雾气渲染改成纯色，更容易看出遮挡关系。

```javascript
// 雾气 = 纯黑，无渐变，便于观察遮挡
if (fog > 0) {
  ctx.fillStyle = `rgba(0,0,0,${fog})`;
  ctx.fillRect(0, 0, W, H);
  return; // 跳过后续渲染
}

// 只在指定格子测试
const DEBUG_FOG = [26, 17]; // [x,y] 或 null
if (DEBUG_FOG) {
  fog = (gx === DEBUG_FOG[0] && gy === DEBUG_FOG[1]) ? fog : 1;
}
```

**技巧**：`return` 提前退出，只渲染目标格子

---

## 4. 逐层渲染截图法

分层截图，定位是哪一层出了问题。

```
截图1：只有地形 + 雾气（跳过建筑）
截图2：地形 + 雾气 + 建筑
截图3：地形 + 雾气 + 建筑 + 后处理
```

**适用场景**：后处理效果覆盖了什么

---

## 5. Canvas 像素提取

用 `getImageData` 提取指定区域的像素值，验证渲染结果。

```javascript
function sampleRegion(cx, cy, w, h) {
  const d = ctx.getImageData(cx, cy, w, h).data;
  const counts = {};
  for (let i = 0; i < d.length; i += 4) {
    const key = `rgb(${d[i]},${d[i+1]},${d[i+2]})`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
```

**注意**：Canvas 坐标是 CSS 像素（非设备像素），高DPI设备需除以 `devicePixelRatio`

---

## 6. 浏览器控制台验证

```javascript
// 测试 gridToScreen/screenToGrid 往返
const W = 64, H = 32;
const gridToScreen = (x, y) => ({ x: (x - y) * (W / 2), y: (x + y) * (H / 2) });
const screenToGrid = (sx, sy) => { /* 实现 */ };

// 测试一批坐标
for (let x = -2; x <= 20; x++) {
  for (let y = -2; y <= 20; y++) {
    const s = gridToScreen(x, y);
    const g = screenToGrid(s.x, s.y);
    if (g[0] !== x || g[1] !== y) console.log(`FAIL: ${x},${y}`);
  }
}
```

---

## 7. 颜色直方图（区分雾气 vs 暗部）

用直方图区分两种暗像素：
- **雾气**：纯黑 RGB(0,0,0)
- **正常暗部**：带色调的暗色

```javascript
const hist = sampleRegion(20, 32, 24, 24);
// 雾气 = rgb(0,0,0) 占比高
// 无雾气 = 无 rgb(0,0,0)
```

---

## 8. 遮挡裁剪（防止渲染溢出）

建筑雾气不应渲染到地面以下。

```javascript
// 方案A：clip 到建筑高度（推荐）
ctx.save();
ctx.beginPath();
ctx.rect(0, p.y - accumH, W, accumH);
ctx.clip();
// ... 画建筑雾气 ...
ctx.restore();

// 方案B：逐像素检查（慢）
const blockY = p.y + hh;
for (let sy = Math.floor(p.y); sy < Math.min(H, blockY); sy++) {
  if (sy < 0 || sy >= H) continue;
  // ...渲染像素...
}
```

---

## 9. 条件渲染开关

快速切换测试。

```javascript
const FOG_RENDER = 1; // 0=跳过雾气，1=开启
const POST_PROCESS = 1; // 0=跳过后处理
const DRAW_BLOCKS = 1; // 0=跳过建筑

if (FOG_RENDER) { /* 雾气代码 */ }
if (POST_PROCESS) { /* 后处理代码 */ }
if (DRAW_BLOCKS) { /* 建筑代码 */ }
```

---

## 10. 调试工作流

1. **定位问题**：截图对比 + 颜色直方图
2. **隔离变量**：分层渲染、条件开关
3. **验证修复**：批量坐标测试、视觉确认
4. **回归检查**：确保修改没有破坏其他功能

---

## 常见陷阱

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 鼠标点到错误格子 | `Math.floor` 独立取整 | 菱形距离最近中心 |
| 雾气盖住地面 | 没有按层级裁剪 | `ctx.clip` 到建筑高度 |
| 雾气溢出到旁边建筑 | 边缘格子高度不一致 | 逐像素高度检查 |
| 相机偏移 | 翻转地图没有补偿 | 用 `offsetX = (gridW - 1) * (W / 2)` |
