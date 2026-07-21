#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
read_zone.py — 读取 Elin 原版地图数据文件 (.z)

实测确认的两种 .z 形态：
  形态 A（建造模式 F1 -> Export Map 导出的用户地图，如 casino.z）：
      —— 一个 ZIP 压缩包（PK\\x03\\x04 魔数，内部成员用 DEFLATE 压缩）
      成员：
        meta      JSON  { name, id, version }
        map       JSON  { seed, compression, version, rooms, tasks, config, bounds, Size, maxX, maxZ }
        export    JSON  { serializedCards: { cards: [ {ints:[...], strs:[...]} ] } }
        blocks    uint8[w*h]   每格 block tile id（0=空）
        floors    uint8[w*h]   每格 floor tile id
        objs      uint8[w*h]   每格 obj tile id
        heights   uint8[w*h]   每格高度层级
        dirs      uint8[w*h]   每格方向/旋转
        flags     uint8[w*h]   每格标记
        *Mats     uint8[w*h]   每格材质 id
        ...（decal/bridge*/roof* 等，按需扩展）
      地图尺寸从 map.Size（或 maxX+1 / maxZ+1）取得，标准 100x100。
      export.cards 中：strs[0]=物件id，strs[4]=精灵表/渲染类型(obj/obj_S/obj_L/obj tall/chara/...)，
                       ints[5]/ints[6]=格子坐标(x,y)。

  形态 B（游戏存档/单文件压缩）：Newtonsoft Json.NET 序列化 + 可选 GZip / LZ4 帧 / 纯 JSON。
      （保留旧逻辑作为回退，但 Elin 实际导出多为形态 A）

用法：
  python read_zone.py 地图.z                 # 结构概览（尺寸/各层 tile 统计/摆放物件）
  python read_zone.py 地图.z --full          # 打印完整 JSON（截断到 60k）
  python read_zone.py 地图.z -o map.json     # 解析后保存为 JSON
  python read_zone.py 地图.z --cards 10      # 打印前 N 个摆放 card
  python read_zone.py 地图.z --no-cross      # 不做源表交叉引用（纯原始 id）

交叉引用：脚本同目录/上级的 data/elin_source/{block,floor,obj,thing}_map.json
          会把 tile id / 物件 id 解析成可读英文名（若文件存在）。
"""
import sys, os, json, gzip, argparse, zipfile

try:
    import lz4.frame as _lz4
except Exception:
    _lz4 = None

# ---------------------------------------------------------------- 格式探测
def _magic(path):
    with open(path, "rb") as f:
        return f.read(4)

def _is_zip(b):
    return b[:4] == b"PK\x03\x04"

def _is_gzip(b):
    return len(b) >= 2 and b[0] == 0x1F and b[1] == 0x8B

def _is_lz4frame(b):
    return len(b) >= 4 and b[:4] == b"\x04\x22\x4d\x18"


# ---------------------------------------------------------------- 源表交叉引用
def _load_source_maps(base_dir):
    """载入 block/floor/obj/thing 映射，建 tile->名称 与 id->名称 索引。"""
    idx = {}
    files = {
        "block": "block_map.json",
        "floor": "floor_map.json",
        "obj":   "obj_map.json",
        "thing": "thing_map.json",
    }
    for sheet, fn in files.items():
        p = os.path.join(base_dir, fn)
        if not os.path.exists(p):
            continue
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        tile_lookup = {}
        id_lookup = {}
        for e in d.get("entries", []):
            t = e.get("tile")
            nm = e.get("displayName") or e.get("name") or e.get("id")
            if t is not None:
                tiles = t if isinstance(t, list) else [t]
                for tv in tiles:
                    if tv not in tile_lookup:
                        tile_lookup[tv] = nm
            if e.get("id") is not None:
                id_lookup[str(e["id"])] = nm
        idx[sheet] = {"tile": tile_lookup, "id": id_lookup}
    return idx


def _resolve(sheet, tile_id, src):
    s = src.get(sheet)
    if not s:
        return None
    return s["tile"].get(tile_id)


def _resolve_obj_by_id(obj_id, src):
    """export card 的 str[0] 可能是 obj/thing 的 id 或英文名。"""
    for sheet in ("obj", "thing"):
        s = src.get(sheet)
        if s and str(obj_id) in s["id"]:
            return s["id"][str(obj_id)]
    return None


# ---------------------------------------------------------------- ZIP 解析（形态 A）
BINARY_LAYERS = {
    "blocks": "block", "floors": "floor", "objs": "obj",
    "heights": None, "dirs": None, "flags": None,
    "floorMats": None, "blockMats": None, "objMats": None,
    "decal": None, "bridgeHeights": None, "bridgePillars": None,
    "bridges": None, "bridgeMats": None, "roofBlocks": None,
    "roofBlockMats": None, "roofBlockDirs": None,
    "flags2": None,
}

TEXT_MEMBERS = ("meta", "map", "export")


def read_zone_zip(path, src):
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        result = {"_format": "zip-export", "members": sorted(names)}

        # 文本成员
        for nm in TEXT_MEMBERS:
            if nm in names:
                try:
                    result[nm] = json.loads(z.read(nm).decode("utf-8", "replace"))
                except Exception as e:
                    result[nm] = {"_error": str(e)}

        # 尺寸
        size = 100
        if isinstance(result.get("map"), dict):
            sz = result["map"].get("Size")
            if isinstance(sz, (int, float)):
                size = int(sz)
            elif isinstance(sz, dict):
                size = int(sz.get("x") or sz.get("Size") or size)
        w = h = size

        # 二进制层
        layers = {}
        for nm, sheet in BINARY_LAYERS.items():
            if nm not in names:
                continue
            data = z.read(nm)
            if len(data) == w * h:
                arr = list(data)
            else:
                arr = list(data)  # 长度不符也尽量保留
            layers[nm] = arr
        result["_layers"] = layers
        result["_size"] = [w, h]

        # 各层 tile 统计 + 解析名
        stats = {}
        for nm, sheet in BINARY_LAYERS.items():
            if nm not in layers:
                continue
            from collections import Counter
            c = Counter(layers[nm])
            items = []
            for val, cnt in c.most_common(12):
                name = _resolve(sheet, val, src) if sheet else None
                items.append({"value": val, "count": cnt,
                              "name": name if name else ("(空)" if val == 0 else None)})
            stats[nm] = {"distinct": len(c), "nonzero": sum(1 for v in c if v != 0),
                         "top": items}
        result["_layerStats"] = stats

        # export cards 解析
        cards = []
        ex = result.get("export")
        if isinstance(ex, dict):
            sc = ex.get("serializedCards", {})
            for card in sc.get("cards", []):
                ints = card.get("ints", [])
                strs = card.get("strs", [])
                obj_id = strs[0] if len(strs) > 0 else None
                sheet_or_type = strs[4] if len(strs) > 4 else None
                x = ints[5] if len(ints) > 5 else None
                y = ints[6] if len(ints) > 6 else None
                # 推断精灵表
                sheet_guess = None
                if sheet_or_type:
                    if "obj_S" in sheet_or_type:
                        sheet_guess = "objS"
                    elif "obj_L" in sheet_or_type:
                        sheet_guess = "objL"
                    elif "obj_H" in sheet_or_type or "objH" in sheet_or_type:
                        sheet_guess = "objH"
                    elif sheet_or_type.startswith("obj"):
                        sheet_guess = "obj"
                    elif sheet_or_type == "chara":
                        sheet_guess = "chara"
                    elif sheet_or_type.startswith("Thing"):
                        sheet_guess = "thing"
                name = _resolve_obj_by_id(obj_id, src) if obj_id else None
                cards.append({"id": obj_id, "sheet": sheet_guess,
                              "rawType": sheet_or_type, "pos": [x, y],
                              "name": name})
        result["_cards"] = cards
        return result


# ---------------------------------------------------------------- 单文件解析（形态 B，回退）
def read_zone_single(raw, src):
    if _is_gzip(raw):
        text = gzip.decompress(raw).decode("utf-8")
    elif _lz4 is not None and _is_lz4frame(raw):
        text = _lz4.decompress(raw).decode("utf-8")
    else:
        try:
            txt = raw.decode("utf-8")
            if txt.lstrip()[:1] in ("{", "["):
                text = txt
            else:
                raise ValueError("非 JSON 文本")
        except Exception:
            raise ValueError("无法识别：非 gzip/lz4 帧/纯 JSON。可能为 LZ4 块格式，请用 ZIP 导出版或游戏内读取。")
    return json.loads(text)


# ---------------------------------------------------------------- 输出
def summarize(z, n_cards=5, cross=True):
    print("格式:", z.get("_format"))
    if z.get("_format") == "zip-export":
        meta = z.get("meta", {})
        mp = z.get("map", {})
        w, h = z.get("_size", [100, 100])
        print(f"  地图名: {meta.get('name')}  (id={meta.get('id')}, version={meta.get('version')})")
        print(f"  尺寸: {w} x {h}   种子={mp.get('seed')}   压缩标记={mp.get('compression')}")
        v = mp.get("version", {})
        if isinstance(v, dict):
            print(f"  游戏版本: {v.get('minor')}.{v.get('batch')}")
        print()
        print("  === 各层 tile 统计（top values）===")
        for nm, st in z.get("_layerStats", {}).items():
            top = ", ".join(
                f"{t['value']}{('=' + str(t['name'])) if t.get('name') else ''}({t['count']})"
                for t in st["top"][:6])
            print(f"    {nm:12s} 去重={st['distinct']:3d} 非空={st['nonzero']:4d} | {top}")
        print()
        cards = z.get("_cards", [])
        print(f"  === 摆放物件 cards: 共 {len(cards)} 个 ===")
        # 按 sheet 统计
        from collections import Counter
        sc = Counter(c.get("sheet") or c.get("rawType") for c in cards)
        print("    按精灵表:", dict(sc))
        print(f"    前 {n_cards} 个:")
        for c in cards[:n_cards]:
            nm = c.get("name") or c.get("id")
            print(f"      id={str(c['id'])[:24]:24s} sheet={str(c['sheet']):6s} "
                  f"pos={c['pos']}  -> {nm}")
    else:
        print("  (单文件 JSON 形态，字段):", list(z.keys()) if isinstance(z, dict) else type(z))


def main():
    ap = argparse.ArgumentParser(description="读取 Elin 原版地图 .z 文件")
    ap.add_argument("path", help=".z 文件路径")
    ap.add_argument("--full", action="store_true", help="输出完整 JSON (截断到 60k)")
    ap.add_argument("--cards", type=int, default=5, help="概览中打印前 N 个 card")
    ap.add_argument("--no-cross", action="store_true", help="不做源表交叉引用")
    ap.add_argument("-o", "--out", help="把解析后的 JSON 保存到该路径")
    a = ap.parse_args()

    if not os.path.exists(a.path):
        print(f"文件不存在: {a.path}", file=sys.stderr)
        sys.exit(1)

    # 源表目录：脚本同目录（data/elin_source/）
    base = os.path.dirname(os.path.abspath(a.path))
    src_dir = os.path.join(base, "elin_source")
    if not os.path.isdir(src_dir):
        src_dir = os.path.dirname(os.path.abspath(__file__))
    src = _load_source_maps(src_dir) if not a.no_cross else {}

    magic = _magic(a.path)
    if _is_zip(magic):
        print(f"文件: {a.path}  [ZIP 导出格式]")
        z = read_zone_zip(a.path, src)
    else:
        print(f"文件: {a.path}  [单文件压缩/文本格式]")
        with open(a.path, "rb") as f:
            raw = f.read()
        z = read_zone_single(raw, src)

    if a.full:
        print(json.dumps(z, ensure_ascii=False, indent=2)[:60000])
    else:
        summarize(z, n_cards=a.cards)

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(z, f, ensure_ascii=False)
        print(f"\n已保存: {a.out}")


if __name__ == "__main__":
    main()
