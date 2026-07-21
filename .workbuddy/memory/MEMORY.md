# 项目记忆：elin-h5（Elin 地图/H5 复刻）

## 关键事实（已验证，勿推翻）
- **Elin 纹理是规则网格图集**：floors/blocks/objs 全部使用 `tile=行×100+列` 编码（来自 `RenderData.cs::ConvertTile()`）。
  - floors.png=2048×1920, **cell 64×48**, 32×40 格
  - blocks.png=2048×2048, **cell 64×64**, 32×32 格
  - **objs.png**=4096², **cell 64**, 64×64 格；**objs_S.png**=2048² cell 32; **objs_L.png**=1920×2048 cell 32
  - snow 变体同尺寸；排除 objs_SS(512² mini)/objs_C/CL/CLL(color mask)
  - 权威 pixel rect 来源：**游戏内 `Esc > 工具 > 纹理查看器`**
- **公开映射数据（两层）**：
  1. 逻辑层 SourceBlock!Floor/Block/Obj/Deco（本地 `data/sources/SourceBlock.xlsx`）→ `id→tile序号`+`_idRenderData`(纹理键)。已解析为 data/elin_source/{floor,block,obj,deco}_map.json。
  2. 像素层：tile→rect 由 `build_objs_rects.py` 从 PNG 连通域+网格对齐生成。
- **_idRenderData → 纹理映射**：`obj`/`obj wheat`→objs; `obj_S`/`obj_S flat`/`floor_obj`/`obj_LV`/`roof`/`block`/`obj road`→objs_S; `obj tall`/`obj flat`→objs_L; `ramp`/`obj road chasm`→objs; `support`→objs(主)。
- **OBJ_ID_RECT 查找表**：`data/elin_source/obj_id_rect.js`，145/147 obj ID 有效（缺 id87 wreck）。生成器 `build_objs_rects.py`（三层查找：精确格340 + 邻居救援20 + missing）。
- **elina-modding.net** 是权威 Modding Wiki。

## tile 编码（2026-07-21 从 Elin-Decompiled 源码破解）
- **tile = 行×100 + 列**（非线性序号！来自 `RenderData.cs::ConvertTile()`）。
  - `col = tile % 100`, `row = tile // 100`
  - 像素: `x = col*cellW`, `y = row*cellH`
- floors.png: 2048×1920, **cellW=64 cellH=48**, cols=32 rows=40
- blocks.png: 2048×2048, **cellW=64 cellH=64**, cols=32 rows=32
- 权威 rect 表: `data/elin_source/{floors,blocks}_tile_rects.json`（已像素验证）

## data.js 现状
- `FLOOR_ATLAS` / `BLOCK_TYPES` 的 r/c 已标注 ⚠️ 失效（错误），正确读法是 tile序号→rect 查表。候选 rect：`data/elin_source/{floors,blocks}_rects_candidate.json`（未校验，仅视觉参考，不可直接对齐 tile）。
- `DECOR_TYPES`（lines 296–310）仍用错误 sx/sy 坐标。待用 OBJ_ID_RECT 替换。

## 工具与约定
- 隔离 Python：`C:/Users/PandaDecSt/.workbuddy/binaries/python/envs/default/Scripts/python.exe`（已装 numpy/scipy/PIL）。
- `.z` 地图 = ZIP 包（PK魔数），含 meta/map/export + 二进制层（blocks/floors/objs 各 10000B=100×100 uint8）。读取器：`data/elin_source/read_zone.py`。
- 地图可视化：`map-viewer.html`（等距 Canvas，加载 assets/elin 贴图渲染 casino.z）；数据生成 `gen_render_json.py`→`casino_render.json`。需 `python -m http.server` 同源访问。**已支持 objs 物件层渲染**（OBJ_ID_RECT + objs_S/objs/objs_L 纹理）。
- **版权**：Elin 为 Lafrontier 付费商业游戏，资源/地图数据版权归作者，H5 复刻注意授权范围。

## Elin xlsx SourceData 移植（2026-07-21，用户指令"抄源码把xlsx读取移植+各种属性读取应用+保证有中文"）
- **架构（忠实 Elin Source 体系）**：xlsx 是编辑期数据 → `build_sources.py` 烘焙为 `data/elin_source/sources.json`（全表全字段，类型还原，alias 合并）；运行时 `js/source-data.js` 提供 `Source.Get(file,sheet,id)`/`Source.List`/`Lang`/`ZH` + 归一化访问器 `getRace/getJob/getThing/getChara/getMaterial/getFood`。
- **数据文件**：`data/sources/{SourceBlock,SourceCard,SourceChara,Lang}.xlsx` 为权威源；`sources.json` 4402 实体行 + 4303 Lang；`lang_zh.json` 71 条中文覆盖。
- **中文**：源数据无中文列（仅 name_JP 日文 / name 英文 / Lang.text 英文）。`build_lang_zh.py` 合并"当前 data.js 中文名"+Source 可玩翻译→`lang_zh.json`；`ZH(sheet,id)` = lang_zh→en→jp。这是中文唯一扩展点。
- **接入**：`createPlayer`(getRace/getJob，STR/END/DEX…→力量/体力/灵巧…，原始属性存 `.src`，ele* 注入 ElementContainer)、`makeItem`(getThing)、`makeMonster`(enrichMonster)。均优先 Source、回退 data.js 常量（当前游戏 id 与 Source id 部分不同：mage≠wizard、hillfolk≠dwarf、executioner 无对应）。
- **启动**：`game.js` `DOMContentLoaded` 改为 `await loadSource()` 后再 `new Game()`。

## 数据驱动转换完成状态（Tasks #13–#18，2026-07-20）
- **旧表已删除**（data.js）：TILES/BLOCK_TYPES/FLOOR_ATLAS/GRASS_ATLAS/SHADOW_ATLAS/DECOR_TYPES。全部替换为 MAT/GROUPS/BIOMES（materials.js）。
- **翻译层**（world.js）：FLOOR_SEM / BLOCK_SEM / DEC_KEY + resolve*Id() 函数 — 生成代码用语义字面量，存储/渲染用数值 id。
- **Special tiles**：floor + map.special marker → drawSpecialTile 向量绘制。
- **建造模式 UI**：完全数据驱动（GROUPS.obj/block/floor 分组代表）。
- **运行时验证通过**（Edge headless + playwright-core）：0 错误，dungeon+region 正常渲染 Elin 贴图。

### 运行时验证工具
- **`verify_runtime.mjs`** 位于 managed workspace (`C:/Users/PandaDecSt/.workbuddy/binaries/node/workspace/`)。
- 依赖：playwright-core + Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）。
- 用法：启动 http server 后运行 `node verify_runtime.mjs` → 自动诊断+截图。
- `?auto=1` URL 参数跳过角色创建直接进入 dungeon（需传入 Zone 对象给 enterDungeon）。

### 语法检查约定
- **禁止** `node --check "$f" | head -1 && echo OK` 形式（管道吞 exit code）。
- 正确形式：`if ! node --check "$f" 2>/dev/null; then echo FAIL: $f; fi`
