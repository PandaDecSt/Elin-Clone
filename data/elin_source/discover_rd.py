import os
from UnityPy import Environment
from UnityPy.enums import ClassIDType

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
env = Environment(GAME_DATA)

# 1) 收集 Render* 脚本 path_id
render_scripts = set()
for obj in env.objects:
    if obj.type != ClassIDType.MonoScript:
        continue
    try:
        ms = obj.read(check_read=False)
    except Exception:
        continue
    nm = getattr(ms, "m_ClassName", None) or getattr(ms, "name", None)
    if nm and nm.startswith("Render"):
        render_scripts.add(obj.path_id)
print("Render* script path_ids:", sorted(render_scripts))

# 2) 扫描 MB, 用 m_Script 反查 Render* 候选, 验证 pass 解析链路
tested = 0
hits = 0
for obj in env.objects:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    tested += 1
    try:
        d = obj.read_typetree(wrap=False, check_read=False)
    except Exception:
        continue
    if not isinstance(d, dict):
        continue
    sc = d.get("m_Script")
    if not sc:
        continue
    sc_pid = sc.get("m_PathID") if isinstance(sc, dict) else getattr(sc, "path_id", None)
    if sc_pid not in render_scripts:
        continue
    hits += 1
    if hits <= 4:
        print(f"\n--- candidate obj {obj.path_id}, script={sc_pid} ---")
        print("  keys:", [k for k in d.keys()][:25])
        name = d.get("m_Name")
        print("  m_Name:", name)
        # 尝试 wrapped read + pass 解析
        try:
            rd = obj.read(check_read=False)
            print("  wrapped has pass:", hasattr(rd, "pass"))
            if hasattr(rd, "pass"):
                mp = getattr(rd, "pass").read(check_read=False)
                print("  meshpass keys:", [k for k in mp.__dict__ if not k.startswith('_')][:20] if hasattr(mp,'__dict__') else mp)
                tex = getattr(mp, "texture", None)
                if tex is not None:
                    t = tex.read(check_read=False)
                    print("  texture name:", getattr(t, "name", None) or getattr(t, "m_Name", None))
                pmesh = getattr(mp, "pmesh", None)
                if pmesh is not None:
                    til = getattr(pmesh, "tiling", None)
                    print("  tiling:", til)
        except Exception as e:
            print("  wrapped read err:", repr(e))
    if hits >= 4:
        break
print(f"\ntested={tested} render_candidates={hits}")
