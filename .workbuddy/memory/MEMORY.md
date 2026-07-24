# 项目记忆：elin-h5（Elin 地图/H5 复刻）

## 关键事实（已验证，勿推翻）
- **Elin 纹理是规则网格图集**：floors/blocks/objs 全部使用 `tile=行×100+列` 编码（来自 `RenderData.cs::ConvertTile()`）。
- **cell 尺寸 = 游戏权威值（2026-07-22 直接解析游戏 resources.assets，最终结论，取代此前所有自相关/半满率猜测）**：
  - 来源链路：`RenderData资产 → pass(MeshPass) → pmesh(ProceduralMesh).tiling` + `mat(Material)主纹理尺寸`；**cell = 纹理尺寸 / tiling**。全表 `data/elin_source/render_atlas_truth.json`（150 条）+ 干净查找表 `data/elin_source/idRenderData_atlas.json`（102 条有图集）。
  - **objs.png**=4096² cell **64×64**(tiling64×64) / **objs_S.png**=2048² cell **32×32**(64×64) / **objs_L.png**=1920×2048 cell **80×64**(24×32，⚠️此前记 80×32 是错的，自相关被子图案误导) / **blocks.png**=2048² cell **64×64**(32×32) / **floors.png**=2048×1920 cell **64×48**(32×40) / **roofs.png**=1152×2000 cell **96×80**(12×25)。
  - **objs_C/objs_CL/objs_CLL 是角色贴图集(pass chara/charaL/charaLW/charaLL)，不是 obj 着色遮罩**：objs_C=4096² **128×128**; objs_CL=4096² **128×256**(charaL) 另有 charaLW **256×256** 变体共用同图; objs_CLL=2048² **256×256**(此前记 32×32 错误)。
  - **objs_SS.png**=512²：游戏无任何 pass 引用，legacy/未用，cell 未知（暂沿用 32×32 猜测）。雪变体(objs_snow/objs_S_snow/objs_L_snow/blocks_snow/floors_snow)同各自基底 cell。
  - **Wall type block 双轴向→双边缘系统**：MAT.block 中 `type:'Wall'` 的条目（214个，如 log/plank/sandbag）。block 存储格式为 `[{id, axis}]`（world.js `_normBlockEntry` 兼容旧 number 格式）。
    - **渲染/自动衔接用 2 边缘（金刚石下缘）**：`se`(下右)邻接【东(E)】邻、`sw`(下左)邻接【南(S)】邻；`sw` 是 `se` 精灵 `ctx.scale(-1,1)` 水平翻转。
    - **轴归一化**：存储轴 `x`→`se`、`y`→`sw`；旧存档 `nw`/`ne` 已废弃→回落 `se`。
    - **R 键**在 `se`/`sw` 间循环；孤立墙显示当前选定单面，不自动补双面。
    - **放置/拆除**走 `game.js::_reconcileWallAt`（按四邻自动补/拆对应边缘，拆一边自愈），`_detectWallAxis` 已废弃（死代码）。
    - ⚠️ **2026-07-23 用户要求删除左上(nw)/右上(ne)上边缘墙**，仅保留 se/sw。西/北邻居不再有对应墙边（墙仍是实心阻挡，只是不显示上缘墙）。
    - Elin 源码对应 `cell.blockDir`(0/1) 选 `_tiles[]` 变体。
- **公开映射数据（两层）**：
  1. 逻辑层 SourceBlock!Floor/Block/Obj/Deco（本地 `data/sources/SourceBlock.xlsx`）→ `id→tile序号`+`_idRenderData`(纹理键)。已解析为 data/elin_source/{floor,block,obj,deco}_map.json。
  2. 像素层：tile→rect 由 `build_objs_rects.py` 从 PNG 连通域+网格对齐生成。
- **_idRenderData → 图集：已是游戏级真值（idRenderData_atlas.json），不再是启发式**。Elin 真实逻辑：`idRenderData` 是 ScriptableObject 资产名，`RenderRow.SetRenderData()` 用 `ResourceCache.Load<RenderData>("Scene/Render/Data/"+idRenderData)` 载入，图集由资产 `pass`(MeshPass) 字段决定，**完全不解析字符串**。此前启发式错得很多，已修正：
  - `obj tall`/`obj flat`→**objs**（非 objs_L）；`obj_LV*`→**objs_L**(80×64)（非 objs_S）；`roof`→**roofs**(96×80)（非 objs_S）；`support`/`scaffold`/`ramp`/`block`→**blocks**（非 objs）；`floor_obj`/`obj road`→**floors**(64×48)（非 objs_S）；`obj`/`obj wheat`/`obj paint`/`obj vine`/`obj mount`→objs ✓；`obj_S*`→objs_S ✓。
  - 48 个 RenderDataThing/Chara/Pcc 无 pass（用独立网格模型，不走等格图集）。
- **解析游戏 .assets 方法（可复用，见 extract_render_truth.py）**：游戏是 Mono 后端(有 Managed/Elin.dll+Assembly-CSharp.dll)。用 `UnityPy 1.25.2` + `TypeTreeGeneratorAPI 0.0.10`：`gen=TypeTreeGenerator("2021.3.45f2"); gen.load_local_dll_folder(Managed)`。**关键坑**：① 先在**不设** `env.typetree_generator` 时用 `obj.read(check_read=False).m_Script.read().m_ClassName` 识别 RenderData 子类(设了生成器会导致 read() 取不到 m_Script)；② 之后再设 `env.typetree_generator=gen`，对目标 `obj.read_typetree()` 才吐出 `pass` 等自定义字段；③ **path_id 仅文件内唯一**，跨文件 PPtr 必须按 `assets_file.externals[fid-1].name` + 文件名映射解析(fid=0 才是同文件)。RenderData 都在 resources.assets。
- **OBJ_ID_RECT 查找表**：`data/elin_source/obj_id_rect.js`，145/147 obj ID 有效（缺 id87 wreck）。生成器 `build_objs_rects.py`（三层查找：精确格340 + 邻居救援20 + missing）。
- **Elin 程序化上色模型（用户 recurring 关注点，勿漏）**：blocks/floors 是**灰度遮罩图集**，颜色由 `SourceMaterial.matColor` 经 `BaseTileMap.GetColorInt(matColor, colorMod)` 提供（`colorMod==0→默认104025`，否则 `p*262144+(matColor.r*50)<<12+(g*50)<<6+b`，4×6bit 打包）。H5 用 `material-tints.js` 的 `MAT_TINTS[defMat]→RGB` 做 multiply 近似（已在 `iso.js` 经 `tintForMat(mat)` 接线）。objs(树/花/草灰度遮罩) 走 `materials.js` 的 `OBJ_TINT` 硬编码列表 + `iso.js` `_getTintedTile` 的 `'colorize'` 模式。`SourceBlock`/`SourceFloor` 表有 `colorMod`(int)/`colorType`(string) 列；Block 仅 1 个(colorMod=100 oak)、Floor 10 个非零，绝大多数是预着色精灵（靠 defMat 上色）。⚠️ 每次重烘焙 materials 都要**保留着色数据**(tint/colorMod/defMat)，别把上色丢了。
- **blocks/floors rect 用网格编码直接算（2026-07-22）**：因 blocks/floors 精灵严格按 cell 网格对齐，直接用 `tile=行×100+列` 算 `rect=[(t%100)*cw,(t//100)*ch,cw,ch]` 即可（比 obj 的像素连通域注册法更准更全）。生成器 `build_tile_rects.py`，按 `_idRenderData`(fallback block/floor) 经 `idRenderData_atlas.json` 解析 atlas+cell；每 tile 带 `atlas`(roof→roofs 等) 与 `colorMod`。覆盖 Block=215/Floor=145（旧脚本只扫了 blocks.png 部分→87/95，漏 roof→roofs、pillar/fence/block_thin/blockEx）。
- ⚠️ **渲染器接线铁律**：`js/iso.js` 的 `elinAtlasMap` 必须包含 `obj_id_rect` 里出现过的**每一个** atlas 键（现含 floors/blocks/shadows/objs/objs_S/objs_L/{snow 变体}/**roofs**）。缺哪个，对应 obj 就画不出（静默回退灰圆）。roofs 是 2026-07-22 补的——之前漏掉导致 17 个 roof obj(22,26-30,67,124-134) 不显示。cell 尺寸(`game.js _atlasCell()`)与绘制无关，仅影响 F3 面板/悬停行列显示。
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

### ⚠️ 墙体系统铁律：永远只做 se/sw 双边缘，禁止加回四边缘(ne/nw)
- **用户明确决策（2026-07-23 两次强调）**：不要四边缘墙系统。原因是瘦墙厚度是**画出来的视觉感受，并未实际定义**，实现上缘 ne/nw 衔接太麻烦且容易算错。
- **惨痛教训**：曾自作主张把四边缘加回（TRIG/NEIGHBOR_OFF/ADJ 那套 + iso.js 上缘垂直翻转渲染），用户明确反对"加不来为什么要加"。**已撤销**：game.js/iso.js 全部回到 se/sw 双边缘；R 键 cycle 回到 `['se','sw']`；预览/面板标签去掉 ne/nw。
- **当前正确模型**：原生墙固定 + 仅增量补/删 `auto` 面。
  - 菱形地格四边各接一个网格邻居（iso 投影 `x:(gx-gy)*W/2, y:(gx+gy)*H/2`）：se(下右)=东邻(gx+1,gy)、sw(下左)=南邻(gx,gy+1)、ne(上右)=北邻(gx,gy-1)、nw(上左)=西邻(gx-1,gy)。墙只连 se/sw 两下缘边（无 ne/nw 精灵）。
  - 原生 `se`(东臂) → 仅当【东邻(gx+1,gy)原生是 `sw`】才补 `sw`（A 南臂与东邻南臂接成连续水平墙）。
  - 原生 `sw`(南臂) → 仅当【北邻(gx,gy-1)原生是 `se`】才补 `se`（A 东臂与北邻东臂接成连续竖直墙）。
  - 反向(南邻 se / 西邻 sw)不补：避免把邻居墙方向延长成 T 形（用户 ABC 场景1 明确禁止）；平行/同向绝不补。
  - ⚠️ **触发方向曾写反**（误写成 se→南邻sw、sw→东邻se），2026-07-23 用户用 ABC 菱形边澄清后改为正确方向（se→东邻、sw→北邻）。
  - 验证：`test_wall_abc.mjs`（Edge@8123）11/11 PASS（S1 A=[sw]不误补、S2 A=[sw,se]/B=[se]、同向行全单轴、拐角[sw,se]、拆墙自愈[sw]），仅 favicon 404。
- 若未来用户自己要求加四边缘，先确认瘦墙厚度来源（需定义实际几何），再动手。
