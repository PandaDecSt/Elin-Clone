import os, json
from collections import defaultdict
from UnityPy import Environment
from UnityPy.enums import ClassIDType
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
VER = "2021.3.45f2"
OUT = "render_atlas_truth.json"

gen = TypeTreeGenerator(VER)
gen.load_local_dll_folder(os.path.join(GAME_DATA, "Managed"))
env = Environment(GAME_DATA)

RENDER_CLASSES = {
    "RenderDataObj", "RenderDataTile", "RenderDataThing", "RenderDataChara",
    "RenderDataObjAdd", "RenderDataObjV", "RenderDataLiquid", "RenderDataRoof",
    "RenderDataPcc", "RenderDataCrate", "RenderDataHalfBlock", "RenderDataFish",
    "RenderDataObjDummy", "RenderDataEffect",
}

# ---- Pass 1: no generator; index + detect ----
allobjs = list(env.objects)
print("total objects:", len(allobjs))
file_index = defaultdict(dict)          # id(af) -> {path_id: reader}
files_by_name = {}                       # normalized name -> af
for obj in allobjs:
    af = obj.assets_file
    file_index[id(af)][obj.path_id] = obj
    nm = (getattr(af, "name", "") or "").lower()
    files_by_name[nm] = af

targets = []
for obj in allobjs:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    try:
        cls = obj.read(check_read=False).m_Script.read().m_ClassName
    except Exception:
        continue
    if cls in RENDER_CLASSES:
        targets.append((obj, cls))
print("RenderData assets:", len(targets))

# ---- enable generator ----
env.typetree_generator = gen

def resolve(reader, pptr):
    """resolve a PPtr dict (possibly cross-file) -> ObjectReader or None"""
    if not isinstance(pptr, dict):
        return None
    fid = pptr.get("m_FileID", 0)
    pid = pptr.get("m_PathID", 0)
    if pid == 0:
        return None
    af = reader.assets_file
    if fid == 0:
        tgt = af
    else:
        try:
            ext = af.externals[fid - 1]
            extname = (getattr(ext, "name", "") or "").lower()
        except Exception:
            return None
        tgt = files_by_name.get(extname)
        if tgt is None:
            base = os.path.basename(extname)
            tgt = files_by_name.get(base)
        if tgt is None:
            return None
    return file_index[id(tgt)].get(pid)

_tex_cache = {}
def tex_size(reader):
    key = (id(reader.assets_file), reader.path_id)
    if key in _tex_cache:
        return _tex_cache[key]
    try:
        t = reader.read()
        res = (getattr(t, "m_Name", None), getattr(t, "m_Width", None), getattr(t, "m_Height", None))
    except Exception:
        res = (None, None, None)
    _tex_cache[key] = res
    return res

def material_main_tex(mat_reader):
    """Material -> main texture reader + name/size"""
    try:
        md = mat_reader.read_typetree()
    except Exception:
        return None, None
    props = md.get("m_SavedProperties", {})
    texenvs = props.get("m_TexEnvs", [])
    # texenvs is list of [name, {m_Texture:PPtr,...}] or list of dicts
    chosen = None
    for item in texenvs:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            pname, penv = item
        elif isinstance(item, dict):
            pname, penv = item.get("first"), item.get("second")
        else:
            continue
        tex_pptr = penv.get("m_Texture") if isinstance(penv, dict) else None
        if not tex_pptr:
            continue
        if pname in ("_MainTex", "_BaseMap"):
            chosen = tex_pptr
            break
        if chosen is None:
            chosen = tex_pptr
    if chosen is None:
        return None, None
    treader = resolve(mat_reader, chosen)
    if treader is None:
        return None, None
    return treader, tex_size(treader)

results = {}
errs = 0
for obj, cls in targets:
    try:
        tree = obj.read_typetree()
    except Exception as e:
        errs += 1
        continue
    name = tree.get("m_Name")
    entry = {"class": cls}
    mp = resolve(obj, tree.get("pass"))
    if mp is None:
        entry["meshpass"] = None
        results[name] = entry
        continue
    try:
        mtree = mp.read_typetree()
    except Exception:
        results[name] = entry
        continue
    entry["meshpass"] = mtree.get("m_Name")
    # pmesh -> tiling
    pm = resolve(mp, mtree.get("pmesh"))
    tiling = None
    if pm is not None:
        try:
            ptree = pm.read_typetree()
            til = ptree.get("tiling")
            if isinstance(til, dict):
                tiling = [til.get("x"), til.get("y")]
            entry["pmesh"] = ptree.get("m_Name")
        except Exception:
            pass
    entry["tiling"] = tiling
    # mat -> texture
    mat = resolve(mp, mtree.get("mat"))
    if mat is not None:
        treader, (tname, tw, th) = material_main_tex(mat)
        entry["atlas"] = tname
        entry["tex_w"] = tw
        entry["tex_h"] = th
        if tiling and tw and th and tiling[0] and tiling[1]:
            entry["cell"] = [round(tw / tiling[0], 3), round(th / tiling[1], 3)]
    results[name] = entry

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=1)

print("read errors:", errs, "written:", len(results), "->", OUT)

# quick atlas summary
from collections import Counter
atlas_cell = defaultdict(Counter)
for name, e in results.items():
    a = e.get("atlas")
    c = e.get("cell")
    if a and c:
        atlas_cell[a][tuple(c)] += 1
print("\n=== atlas -> cell sizes (from game data) ===")
for a in sorted(atlas_cell):
    parts = ", ".join(f"{cw}x{ch}:{n}" for (cw, ch), n in atlas_cell[a].most_common())
    print(f"  {a:22s} {parts}")
