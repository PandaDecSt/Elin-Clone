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
env.typetree_generator = gen

# index every object by (assets_file, path_id) — path_id is only unique per file
file_index = defaultdict(dict)
allobjs = []
for obj in env.objects:
    file_index[id(obj.assets_file)][obj.path_id] = obj
    allobjs.append(obj)
print("total objects:", len(allobjs))

def resolve(reader, pptr):
    if not isinstance(pptr, dict):
        return None
    fid = pptr.get("m_FileID", 0)
    pid = pptr.get("m_PathID", 0)
    if pid == 0:
        return None, fid
    if fid == 0:
        return file_index[id(reader.assets_file)].get(pid), fid
    return None, fid  # external — report fid

def name_of_script(reader):
    try:
        data = reader.read(check_read=False)
        return data.m_Script.read().m_ClassName
    except Exception:
        return None

# find a few RenderDataObj and follow the chain
done = 0
for obj in allobjs:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    cls = name_of_script(obj)
    if cls not in ("RenderDataObj", "RenderDataTile"):
        continue
    try:
        tree = obj.read_typetree()
    except Exception as e:
        continue
    nm = tree.get("m_Name")
    size = tree.get("size")
    pr = tree.get("pass")
    print(f"\n== {cls} name={nm!r} size={size} pass={pr}")
    mp, fid = resolve(obj, pr)
    if mp is None:
        print(f"   pass unresolved (m_FileID={fid})")
        continue
    mtree = mp.read_typetree()
    print(f"   MeshPass name={mtree.get('m_Name')!r} pmesh={mtree.get('pmesh')} mat={mtree.get('mat')} sprite={mtree.get('sprite')}")
    pm, fid2 = resolve(mp, mtree.get("pmesh"))
    if pm is not None:
        ptree = pm.read_typetree()
        print(f"   ProceduralMesh name={ptree.get('m_Name')!r} tiling={ptree.get('tiling')} UVPadding={ptree.get('UVPadding')}")
    else:
        print(f"   pmesh unresolved (m_FileID={fid2})")
    # material -> texture name
    mat, fidm = resolve(mp, mtree.get("mat"))
    if mat is not None:
        try:
            md = mat.read()
            print(f"   Material name={getattr(md,'m_Name',None)!r}")
        except Exception as e:
            print("   mat read err", e)
    done += 1
    if done >= 8:
        break

print("\nDONE", done)
