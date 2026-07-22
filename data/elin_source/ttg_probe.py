import os, json
from UnityPy import Environment
from UnityPy.enums import ClassIDType
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
VER = "2021.3.45f2"

gen = TypeTreeGenerator(VER)
gen.load_local_dll_folder(os.path.join(GAME_DATA, "Managed"))
env = Environment(GAME_DATA)
env.typetree_generator = gen

# map ALL MonoScript path_id -> (asm, class)
scripts = {}
for obj in env.objects:
    if obj.type != ClassIDType.MonoScript:
        continue
    try:
        ms = obj.read(check_read=False)
    except Exception:
        continue
    nm = getattr(ms, "m_ClassName", None) or getattr(ms, "name", None)
    asm = getattr(ms, "m_AssemblyName", None)
    if nm:
        scripts[obj.path_id] = (asm, nm)

# which classes are interesting
INTEREST = {"RenderDataObj","RenderDataTile","RenderDataThing","MeshPass","ProceduralMesh"}
# find MeshPass / ProceduralMesh script ids by name
byname = {}
for pid,(asm,nm) in scripts.items():
    byname.setdefault(nm, []).append(pid)
for nm in ["MeshPass","ProceduralMesh"]:
    print(nm, "script pids:", byname.get(nm))

# probe: read one asset of each interesting Render* subclass, dump keys + pass
want = {"RenderDataObj":None,"RenderDataTile":None,"RenderDataThing":None}
count=0
for obj in env.objects:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    try:
        raw = obj.read_typetree(check_read=False)
    except Exception:
        continue
    if not isinstance(raw, dict):
        continue
    sc = raw.get("m_Script")
    scpid = sc.get("m_PathID") if isinstance(sc,dict) else None
    info = scripts.get(scpid)
    if not info:
        continue
    asm,cls = info
    if cls in want and want[cls] is None:
        want[cls] = obj.path_id
        print(f"\n===== {cls} obj={obj.path_id} name={raw.get('m_Name')!r} =====")
        for k,v in raw.items():
            sv = str(v)
            if len(sv)>90: sv=sv[:90]+"..."
            print(f"   {k} = {sv}")
    if all(v is not None for v in want.values()):
        break

# now follow 'pass' of the RenderDataObj we found
print("\n\n########## follow pass chain ##########")
def read_by_pid(pid):
    for obj in env.objects:
        if obj.path_id==pid:
            return obj
    return None

for cls,pid in want.items():
    if pid is None: continue
    o = None
    # re-read
    for obj in env.objects:
        if obj.path_id==pid and obj.type==ClassIDType.MonoBehaviour:
            o=obj; break
    raw = o.read_typetree(check_read=False)
    passref = raw.get("pass")
    print(f"\n{cls} name={raw.get('m_Name')!r} pass={passref}")
    if isinstance(passref, dict) and passref.get("m_PathID"):
        mp_pid = passref["m_PathID"]
        mp_obj = None
        for obj in env.objects:
            if obj.path_id==mp_pid and obj.type==ClassIDType.MonoBehaviour:
                mp_obj=obj; break
        if mp_obj:
            mraw = mp_obj.read_typetree(check_read=False)
            print(f"  MeshPass obj={mp_pid} name={mraw.get('m_Name')!r} keys={list(mraw.keys())}")
            for k,v in mraw.items():
                sv=str(v)
                if len(sv)>110: sv=sv[:110]+"..."
                print(f"     {k} = {sv}")
