import os, json, traceback
from UnityPy import Environment
from UnityPy.enums import ClassIDType
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
VER = "2021.3.45f2"

gen = TypeTreeGenerator(VER)
gen.load_local_dll_folder(os.path.join(GAME_DATA, "Managed"))
env = Environment(GAME_DATA)

def fullname_of(script):
    ns = getattr(script, "m_Namespace", "") or ""
    cls = getattr(script, "m_ClassName", "") or ""
    return (ns + "." + cls) if ns else cls

# pre-scan all MonoBehaviour scripts to know class names WITHOUT touching typetree
mb_info = {}  # path_id -> (class, asm, fullname, name)
for obj in env.objects:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    try:
        data = obj.read(check_read=False)
    except Exception:
        continue
    ms = getattr(data, "m_Script", None)
    if ms is None:
        continue
    try:
        script = ms.read()
    except Exception:
        continue
    cls = getattr(script, "m_ClassName", "") or ""
    if not cls.startswith("RenderData") or cls == "RenderData":
        continue
    asm = getattr(script, "m_AssemblyName", "") or ""
    mb_info[obj.path_id] = (cls, asm, fullname_of(script), getattr(data, "m_Name", None))

print("RenderData subclass assets found:", len(mb_info))

# NOW enable the generator so read_typetree uses it
env.typetree_generator = gen

# follow one of each kind
seen = set()
for obj in env.objects:
    if obj.path_id not in mb_info:
        continue
    cls, asm, fn, name = mb_info[obj.path_id]
    if cls in seen:
        continue
    seen.add(cls)
    print(f"\n===== {cls} obj={obj.path_id} name={name!r} =====")
    try:
        tree = obj.read_typetree()
        print("  keys:", list(tree.keys()))
        for k in ("m_Name", "pass", "id", "idRenderData", "tiles", "snowOnly"):
            if k in tree:
                print(f"    {k} = {str(tree[k])[:140]}")
        # follow pass
        pr = tree.get("pass")
        print("  pass raw:", pr)
    except Exception as e:
        print("  ERR:", repr(e))
        traceback.print_exc()
    if len(seen) >= 6:
        break

print("\nDONE")
