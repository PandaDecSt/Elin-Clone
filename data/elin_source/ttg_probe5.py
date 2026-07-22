import os, json
from collections import defaultdict
from UnityPy import Environment
from UnityPy.enums import ClassIDType
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
VER = "2021.3.45f2"

gen = TypeTreeGenerator(VER)
gen.load_local_dll_folder(os.path.join(GAME_DATA, "Managed"))
env = Environment(GAME_DATA)

# ---- Pass 1: WITHOUT generator, detect classes & index ----
allobjs = list(env.objects)
print("total objects:", len(allobjs))
file_index = defaultdict(dict)
for obj in allobjs:
    file_index[id(obj.assets_file)][obj.path_id] = obj

targets = []  # (reader, class)
for obj in allobjs:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    try:
        data = obj.read(check_read=False)
        cls = data.m_Script.read().m_ClassName
    except Exception:
        continue
    if cls in ("RenderDataObj", "RenderDataTile"):
        targets.append((obj, cls))
print("RenderDataObj/Tile targets:", len(targets))

# ---- enable generator for typetree reads ----
env.typetree_generator = gen

def resolve(reader, pptr):
    if not isinstance(pptr, dict):
        return None, None
    fid = pptr.get("m_FileID", 0)
    pid = pptr.get("m_PathID", 0)
    if pid == 0:
        return None, fid
    if fid == 0:
        return file_index[id(reader.assets_file)].get(pid), fid
    return None, fid

done = 0
for obj, cls in targets:
    try:
        tree = obj.read_typetree()
    except Exception as e:
        print("tree err", e)
        continue
    nm = tree.get("m_Name")
    pr = tree.get("pass")
    print(f"\n== {cls} name={nm!r} size={tree.get('size')} pass={pr}")
    mp, fid = resolve(obj, pr)
    if mp is None:
        print(f"   pass unresolved fid={fid}")
        continue
    mtree = mp.read_typetree()
    print(f"   MeshPass name={mtree.get('m_Name')!r} pmesh={mtree.get('pmesh')} mat={mtree.get('mat')}")
    pm, _ = resolve(mp, mtree.get("pmesh"))
    if pm is not None:
        ptree = pm.read_typetree()
        print(f"   ProceduralMesh name={ptree.get('m_Name')!r} tiling={ptree.get('tiling')}")
    mat, _ = resolve(mp, mtree.get("mat"))
    if mat is not None:
        try:
            print(f"   Material name={mat.read().m_Name!r}")
        except Exception as e:
            print("   mat err", e)
    done += 1
    if done >= 10:
        break

print("\nDONE", done)
