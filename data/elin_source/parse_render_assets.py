#!/usr/bin/env python
# 解析 Elin 游戏构建中的 RenderData 资产，提取每个 _idRenderData -> {atlas, cellW, cellH}
import os, json, time
from UnityPy import Environment
from UnityPy.enums import ClassIDType

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render_atlas_truth.json")

print("Loading", GAME_DATA)
t0 = time.time()
env = Environment(GAME_DATA)
print("loaded in %.1fs" % (time.time() - t0))

results = {}
t0 = time.time()
n_mb = 0
for obj in env.objects:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    n_mb += 1
    try:
        rd = obj.read()
    except Exception:
        continue
    if not hasattr(rd, "pass"):
        continue
    name = getattr(rd, "name", None) or getattr(rd, "m_Name", None)
    atlas = None; cellW = None; cellH = None
    try:
        mp = getattr(rd, "pass").read()
    except Exception:
        mp = None
    if mp is not None:
        tex = getattr(mp, "texture", None)
        if tex is not None:
            try:
                t = tex.read()
                atlas = getattr(t, "name", None) or getattr(t, "m_Name", None)
            except Exception:
                atlas = None
        pmesh = getattr(mp, "pmesh", None)
        if pmesh is not None:
            tiling = getattr(pmesh, "tiling", None)
            if tiling is not None:
                try:
                    cellW = float(getattr(tiling, "x", None) or (tiling[0] if hasattr(tiling,'__getitem__') else None))
                    cellH = float(getattr(tiling, "y", None) or (tiling[1] if hasattr(tiling,'__getitem__') else None))
                except Exception:
                    pass
    results[name] = {"atlas": atlas, "cellW": cellW, "cellH": cellH}

print("scanned %d MonoBehaviours in %.1fs, RenderData found=%d" % (n_mb, time.time() - t0, len(results)))
for k, v in list(results.items())[:12]:
    print(f"  {k!r}: atlas={v['atlas']!r} cell={v['cellW']}x{v['cellH']}")

json.dump(results, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("Wrote", OUT)
