#!/usr/bin/env python
# 交叉核对游戏 .assets 真值表(render_atlas_truth.json) 与当前 H5 数据(obj_id_rect.json / sources.json)
# 产出: 13 个模糊 obj 的真实图集、各图集权威 cell、与当前分配的 diff。
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
truth = json.load(open(os.path.join(HERE, "render_atlas_truth.json"), encoding="utf-8"))
rect = json.load(open(os.path.join(HERE, "obj_id_rect.json"), encoding="utf-8"))["OBJ_ID_RECT"]
src = json.load(open(os.path.join(HERE, "sources.json"), encoding="utf-8"))["SourceBlock"]["Obj"]["byId"]

def tiles_of(v):
    out = []
    for t in (v.get("tiles") or []):
        if isinstance(t, int):
            out.append(t if t >= 0 else -t)
    return out

# 1) 各图集权威 cell
print("===== 各图集权威 cell (来自 pass.pmesh.tiling) =====")
atlas_cell = {}
for name, info in truth.items():
    a, cw, ch = info.get("atlas"), info.get("cellW"), info.get("cellH")
    if a and cw and ch:
        atlas_cell.setdefault(a, (cw, ch))
for a, (cw, ch) in sorted(atlas_cell.items()):
    print(f"  {a:12s} {int(cw)}x{int(ch)}")

# 2) 13 个模糊 obj 的真实图集
AMB = {0, 24, 33, 44, 53, 54, 89, 92, 106, 112, 142, 143, 145}
print("\n===== 13 个模糊 obj 的真实图集(来自 .assets) =====")
for sid in sorted(AMB):
    v = src.get(str(sid)) or src.get(sid)
    rd = v.get("_idRenderData")
    t = truth.get(rd, {})
    cur = rect.get(str(sid)) or rect.get(sid) or {}
    print(f"  id={sid:>4} _idRenderData={rd!r:<14} truth_atlas={t.get('atlas')!r:<10} cell={t.get('cellW')}x{t.get('cellH')}  current_tex={cur.get('tex')!r}")

# 3) 全量 diff: 当前 tex vs 真实 atlas
print("\n===== 全量 diff (current tex vs truth atlas) =====")
diff = 0
for sid, v in src.items():
    rd = v.get("_idRenderData")
    t = truth.get(rd)
    if not t:
        continue
    cur = rect.get(str(sid)) or rect.get(sid) or {}
    cur_tex = cur.get("tex")
    if cur_tex != t.get("atlas"):
        diff += 1
        nm = v.get("name") or v.get("name_JP")
        print(f"  CHANGED id={sid:>4} {nm!r:<26} _idRenderData={rd!r:<14} current={cur_tex!r} -> truth={t.get('atlas')!r}")
print(f"  total changed: {diff}")
