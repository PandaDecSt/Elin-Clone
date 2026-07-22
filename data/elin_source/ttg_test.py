import os, json
from UnityPy import Environment
from UnityPy.enums import ClassIDType
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
VER = "2021.3.45f2"

print("loading typetree generator ...")
gen = TypeTreeGenerator(VER)
gen.load_local_dll_folder(os.path.join(GAME_DATA, "Managed"))
print("generator ready")

env = Environment(GAME_DATA)
try:
    env.typetree_generator = gen
    print("set env.typetree_generator OK")
except Exception as e:
    print("set generator failed:", repr(e))

# collect Render* MonoScript path_ids + their assembly/classname
render_scripts = {}
for obj in env.objects:
    if obj.type != ClassIDType.MonoScript:
        continue
    try:
        ms = obj.read(check_read=False)
    except Exception:
        continue
    nm = getattr(ms, "m_ClassName", None) or getattr(ms, "name", None)
    asm = getattr(ms, "m_AssemblyName", None)
    if nm and nm.startswith("Render"):
        render_scripts[obj.path_id] = (asm, nm)
print("Render* scripts:")
for pid,(asm,nm) in sorted(render_scripts.items()):
    print(f"  pid={pid} asm={asm} class={nm}")

# now find first few RenderData MonoBehaviours and try full read
hits=0
for obj in env.objects:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    try:
        d = obj.read(check_read=False)
    except Exception:
        continue
    tt = getattr(d, "object_reader", None)
    # get script pid
    try:
        raw = obj.read_typetree(check_read=False)
    except Exception as e:
        raw = None
    if not isinstance(raw, dict):
        continue
    sc = raw.get("m_Script")
    scpid = sc.get("m_PathID") if isinstance(sc,dict) else None
    if scpid not in render_scripts:
        continue
    asm,cls = render_scripts[scpid]
    if cls != "RenderData":
        continue
    hits+=1
    if hits<=3:
        print(f"\n=== RenderData obj {obj.path_id} name={raw.get('m_Name')} keys={list(raw.keys())[:30]}")
        if "pass" in raw:
            print("  pass field:", raw["pass"])
    if hits>=3:
        break
print("\nRenderData hits scanned:", hits)
