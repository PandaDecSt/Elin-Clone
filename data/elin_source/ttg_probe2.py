import os, json, traceback
from UnityPy import Environment
from UnityPy.enums import ClassIDType
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
VER = "2021.3.45f2"

gen = TypeTreeGenerator(VER)
gen.load_local_dll_folder(os.path.join(GAME_DATA, "Managed"))
env = Environment(GAME_DATA)
# NOTE: do NOT set env.typetree_generator globally — it breaks obj.read().m_Script.
# Instead generate nodes explicitly per RenderData class below.

def fullname_of(script):
    ns = getattr(script, "m_Namespace", "") or ""
    cls = getattr(script, "m_ClassName", "") or ""
    return (ns + "." + cls) if ns else cls

# find first RenderDataObj-ish MonoBehaviour
found = 0
for obj in env.objects:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    try:
        data = obj.read(check_read=False)
    except Exception:
        continue
    try:
        script = data.m_Script.read()
    except Exception:
        continue
    cls = getattr(script, "m_ClassName", "") or ""
    if not cls.startswith("RenderData"):
        continue
    if cls == "RenderData":
        continue  # base, skip
    asm = getattr(script, "m_AssemblyName", "") or ""
    fn = fullname_of(script)
    name = getattr(data, "m_Name", None)
    print(f"\n===== MB obj={obj.path_id} class={cls} asm={asm} fullname={fn} name={name!r} =====")
    try:
        nodes = gen.get_nodes(asm, fn)
        tree = obj.read_typetree(nodes)
        print("  keys:", list(tree.keys()))
        for k in ("m_Name", "pass", "id", "idRenderData", "tiles"):
            if k in tree:
                sv = str(tree[k])
                print(f"    {k} = {sv[:120]}")
    except Exception as e:
        print("  read_typetree(nodes) ERR:", e)
        traceback.print_exc()
    found += 1
    if found >= 5:
        break

print("\nDONE found", found)
