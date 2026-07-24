# 用 Gemini 网页版 Banana 生产像素游戏精灵 · 流程手册

> 改编自 [chongdashu/ai-pixel-snapped-game-sprites](https://github.com/chongdashu/ai-pixel-snapped-game-sprites)（原版用 GPT Image 2.0 + fal.ai 视频）。
> 本手册把整条管线改写成 **Gemini 网页版 Nano Banana（"大香蕉"）** 可跑的版本，下游确定性步骤（像素对齐 / 帧恢复 / 脚锚归一化）与模型无关，原样复用。
>
> 核心思想（原作者原话）：**"Image gen ≈ 20% 的工作，剩下 80% 是下面的后处理管线。"** 把"一致性"问题交给"锚点 + 像素对齐 + 脚锚锁定"，而不是指望模型一次出完美的整张表。

---

## 0. 你能 / 不能指望 Banana 什么

| 环节 | 网页版 Banana 能做吗 | 说明 |
|---|---|---|
| 单图生图 + 上传参考图续图 | ✅ 强 | 同一串聊天里角色一致性高，可反复重 roll（gacha） |
| 像素风约束（chunky pixel） | ✅ | 靠提示词 + 交替像素引导图 |
| 透明背景 PNG | ❌ | 强制 `#00FF00` 绿幕后，下游 chroma-key 抠 |
| 图生视频（行走循环） | ❌ | 网页版无视频能力 → 见第 6 步 Banana 原生替代 |
| 一次出整张多帧表 | ⚠️ 可用但易漂移 | 单 prompt 建议 ≤ 6–8 帧；整表拆成动作板分步 |
| 旋转/镜像一致 | ⚠️ | 方向锚（N/S/E/W）单独生成，靠锚点系统统一 |

**关键操作纪律**：**整个角色只用一串 Gemini 聊天**，不要每个步骤开新对话——身份靠"续聊"保持。每步把上一步的**像素对齐后 chroma 图**作为身份参考（Image 1）上传，再配一张交替像素引导图（Image 2）。

---

## 1. 准备引导图（一次性）

```bash
python tools/banana_sprite_pipeline.py guides --out tools/guides
```
生成两张交替像素棋盘，上传给 Banana 当 Image 2，告诉它"按这个原生像素分辨率画"：
- `alternating-1024x1024.png` — 方向锚 / 像素风格引导（第 3 步用）
- `alternating-2048x1536-4x3-pose-board.png` — 动作板引导（第 4 步用）

---

## 2. 第 1 步：南向锚点（最重要的一张图）

在 Gemini 网页版开一串新聊天，输入（可先上传一张高清参考图，让它"重绘成更简单精灵"；身份参考即可，渲染风格要转）：

```
Intended use: create a lower-fidelity production sprite anchor for a top-down 2D game.
Create one full-body south-facing / front-facing character anchor on a 1024x1024 square canvas.

Style target:
- polished 16-bit / early 32-bit JRPG character sprite style
- lower fidelity than the reference, simpler shapes, fewer fine details
- crisp chunky pixel art, readable silhouette, dark outline clusters
- designed to fit cleanly inside future 256x256 animation cells

Composition:
- exactly one full-body character, facing screen/front/south, centered
- full body visible, generous margin, neutral upright pose
- no held weapons (effects live in attack sheets only)

Background: exact #00FF00 chroma green, flat opaque, no transparency, no shadow

Character identity:
- {CORE_IDENTITY}        # 例: "海盗, 红头巾, 独眼, 粗犷"
- {COSTUME_AND_PALETTE}  # 例: "棕色皮甲, 米色衬衫, 8-12 色"
- {SILHOUETTE_NOTES}     # 例: "大头, 紧凑身材"

Restrictive constraints (prompt-discipline lever):
- deliberately simple 16-bit era pixel art, low fidelity
- chunky readable silhouette, compact body, large simple head
- limited 8-12 color palette, big pixel clusters
- no ornate trim, no tiny accessories, no jewelry
```
**纪律**：提示词越"抠门"（少细节、大色块），像素对齐后原生网格越小、像素越"真"。细节党提示词会产出 170×170 假像素，简单提示词能到 96×96 真像素。

**设置**：图尺寸 1024×1024，背景 `#00FF00`，质量高。反复重 roll 直到满意（这是你最重要的身份基准）。

---

## 3. 第 2 步：像素对齐（Pixel Snap）— 不是 AI 调用

把第 1 步的图上传到 **[spritefusion.com](https://spritefusion.com)**（模型无关，Banana 出图一样用）。它做的是确定性图像处理：K-means 量化 → 估计原生网格间距 → 每格取主色 → 最近邻放大回 1024。

- 输出三张：`*-native.png`（原生 96×96 左右）、`*-1024.png`、`*-1024-chroma.png`（重键 `#00FF00` 绿幕）
- **铁律**：之后所有步骤都用 `*-1024-chroma.png` 当身份输入，**绝不**用原始 1024（原始图带 mixel 假像素，会传染下游）

> 这一步是整条管线"变真像素"的关键，和用 GPT 还是 Banana 无关。

---

## 4. 第 3 步：方向锚点（N/S/E/W）

顶部俯视游戏（如 Elin 的等距/俯视 4 向）必须做这一步。在同一串聊天里，上传 **Image 1 = 第 2 步的 snapped chroma 南向锚**，**Image 2 = alternating-1024x1024 引导图**，输入：

```
Intended use: a reusable single-frame directional anchor sprite for a top-down 2D action game.
Image 1 role: identity anchor (preserve exact approved character identity/silhouette/outfit/proportions).
Image 2 role: pixel-style anchor (reinforce crisp pixelated treatment only).

Primary request: generate a single-frame {DIRECTION}-facing anchor sprite.
Subject: same character as image 1. Direction: {DIRECTION_DESCRIPTION}.
- Preserve main handheld weapon as one complete object, visibly gripped.
- Weapon handle = one continuous unbroken shaft (not split/disconnected).

Look: high-res pixelated sprite art, chunky crisp edges, visual family of image 1.
No painterly shading, no blur, no soft gradients.
Background: 1024x1024, exact #00FF00 chroma green. Single full-body, centered, generous margin.
Neutral upright pose, no held effects.
```
- `{DIRECTION}` = `west` / `north`；东向 = 西向水平翻转（别单独生成）
- 每张生成后都跑第 2 步 snap，snapped chroma 版成为该方向所有动作的**规范参考**

---

## 5. 第 4 步：动作板（idle / attack / hurt / jump / death）

每个动作单独一次生成。上传 **Image 1 = 该方向 snapped chroma 锚**，**Image 2 = alternating-2048x1536 动作板引导图**。

```
Intended use: a reusable {ACTION} animation spritesheet for a top-down 2D game.
Image 1 role: identity anchor (preserve exact approved sprite identity).
Image 2 role: alternating-pixel pose-board guide at exact target size.

Primary request: create a {N}-frame {ACTION} sequence on a 2048x1536 pose board.
Place frames in the first {N} cells of an implied 4 column x 3 row grid, left-to-right, top-to-bottom.

{FRAME_BY_FRAME_DESCRIPTION}

Look: high-res pixelated sprite art, crisp chunky edges, preserve visible pixel structure.
No painterly rendering, no airbrush, no soft gradients. Sprite large & centered per cell.

Background: exact #00FF00 chroma green throughout. Each frame centered in its cell.
No drift between frames. No turn between frames. {ACTION_SPECIFIC_CONSTRAINTS}
```

**帧数建议（Banana 版）**：原版 idle/death 用 10 帧；Banana 单 prompt 压 >8 帧会糊，建议：
- Idle 10 帧 → 拆成两张 4×3 板（5+5）或接受重 roll
- Attack 8 / Hurt 6 / Jump 6 / Death 10 同理

**逐帧描述写法（death 这类叙事动作用显式，attack/idle 可松散）**：
```
Frame 1: ready stance, neutral.
Frame 2: anticipation, wind back.
Frame 3: wind-up, weapon raised.
Frame 4: strike — weapon at max extension.
Frame 5: recoil, weapon pulling back.
Frame 6: follow-through, momentum carrying.
Frame 7: recovery, returning toward neutral.
Frame 8: return to ready stance.
```
**铁律**：**绝不直接网格切动作板**——攻击帧挥武器会越过 cell 边界，朴素切会把超出部分砍掉（repo 叫 frame bleeding）。交给第 5 步"帧恢复"。

---

## 6. 第 6 步：行走循环（Banana 原生替代）

⚠️ **原版靠 fal.ai 图生视频（WAN/SeedDance），网页版 Banana 没有视频能力。** 两个 Banana 原生替代：

**方案 A（推荐，复用整条管线）**——把 walk 当动作板生成，但用显式脚部位移：
```
Create an 8-frame walk cycle on a 2048x1536 pose board (4x2 grid).
Each frame is an in-place walk, alternating left/right leg:
Frame 1: left foot forward (contact), right foot back.
Frame 2: passing pose, weight centered.
Frame 3: right foot forward (contact), left foot back.
Frame 4: passing pose.
Frame 5: left foot forward again (loop point).
... 8 frames returning to Frame 1.
Background exact #00FF00. No horizontal drift, no rotation.
```
生成后走第 2 步 snap → 第 5 步帧恢复 → 第 8 步打包。**预期**：不如 i2v 那样完美"钉在地上"，需要多 roll 几次 + 第 8c 步手动 1–2px 对齐。

**方案 B（快捷）**：单 prompt "8-frame side-view walk cycle, left to right, pure black background"，反复重 roll 直到角色大致不漂移，再 chroma/黑幕抠 + 手动对齐。

> 若日后拿到 Gemini API / Veo 或 fal.ai 权限，直接切回原版 i2v 流程（file 06），质量最高。

---

## 7. 第 5 步：帧恢复（前景连通域，非网格切）

```bash
python tools/banana_sprite_pipeline.py recover \
  --board attack-w-poseboard.png --cols 4 --rows 3 --margin 4 --out recovered/
```
- 对动作板每个 cell：chroma 抠背景 → 取最大连通前景 → 带 padding 的 bbox 裁出 → 存为原生尺寸 PNG（`frame_0001.png` …，按左→右、上→下顺序）
- **Native review checkpoint**：把恢复出的帧铺到一张共享画布、脚底对齐、不缩放，肉眼检查扭姿/缺肢/抠漏。不合格的**只重生成那一帧**，别重做整板

---

## 8. 第 7 步：逐帧像素对齐

每个恢复出的帧仍是 mixel，必须单独 snap。网页版：把每张 `recovered/frame_XXXX.png` 上传 spritefusion.com（用 chroma-layout 模式，有绿幕布局线索恢复更干净），输出 snapped PNG。

---

## 9. 第 8 步：运行时归一化 + 脚锚锁定（打包）

```bash
python tools/banana_sprite_pipeline.py pack \
  --indir snapped_frames/ --out spritesheet.png \
  --action attack --direction w --fps 10
```
- 把 snapped 帧打包成 **1280×512 RGBA**（5 列 × 2 行，每格 256×256）
- **脚锚锁定 (128,255)**：每帧最底非透明行放到 cell 的 y=255，水平居中 x=128 → 所有帧脚底同基线，动画不上下抖
- 同时写出 `spritesheet.manifest.json`（帧数/列/行/fps/锚点），引擎直接读
- **8c 手动对齐（可选）**：用支持洋葱皮的查看器，漂移帧 nudge 1–2px，预览循环后导出

---

## 10. 产出清单（每角色每方向 6 张表）

`idle/ walk/ attack/ hurt/ jump/ death/`，每张 1280×512、5×2×256、脚锚锁定、真像素。**可直接丢进 Phaser / Godot / Unity 2D / 自建 WebGL**（Elin-h5 的 `js/iso.js` 精灵加载亦可按此 manifest 接）。

---

## 速查：Banana 网页版 vs 原版差异

| 步骤 | 原版 | Banana 网页版改动 |
|---|---|---|
| 1 南向锚 | GPT Image 2.0 | Gemini 网页版 Banana，同串聊天 |
| 2 像素对齐 | SpriteFusion 算法 | **不变**，spritefusion.com（模型无关） |
| 3 方向锚 | GPT Image 2.0 img2img | Banana 上传参考图续图 |
| 4 动作板 | GPT Image 2.0 img2img | Banana 上传参考图续图；>8 帧拆板 |
| 5 帧恢复 | Python 确定性 | **不变**，本脚本 `recover` |
| 6 行走 | fal.ai i2v 视频 | **改**：动作板 + 显式脚部位移（方案 A） |
| 7 逐帧 snap | SpriteFusion | **不变** |
| 8 归一化 | Python 确定性 | **不变**，本脚本 `pack` |

---

## 辅助脚本命令总览

```bash
# 1) 生成交替像素引导图（一次性）
python tools/banana_sprite_pipeline.py guides --out tools/guides

# 2) 动作板 -> 逐帧 PNG（前景连通域恢复）
python tools/banana_sprite_pipeline.py recover \
  --board <动作板.png> --cols 4 --rows 3 --margin 4 --out recovered/

# 3) 逐帧 -> 运行时表 + manifest（脚锚锁定）
python tools/banana_sprite_pipeline.py pack \
  --indir <snapped帧目录> --out spritesheet.png \
  --action attack --direction w --fps 10
```
依赖：`pillow numpy scipy`（venv 已装：`C:/Users/PandaDecSt/.workbuddy/binaries/python/envs/default/Scripts/python.exe`）
