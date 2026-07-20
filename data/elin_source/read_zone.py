#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
read_zone.py — 读取 Elin 原版地图数据文件 (.z)

格式本质（来自 Elin-Decompiled 的 IO.cs / GameIO.cs）：
    Zone 对象经 Newtonsoft Json.NET 序列化为 JSON 文本，
    再可选地经 GZip 或 LZ4 压缩后写入 .z 文件。

    GameIO.cs 读存档:
        JsonConvert.DeserializeObject(
            IO.IsCompressed(path) ? IO.Decompress(path) : File.ReadAllText(path),
            jsReadGame)

    Zone.cs 中地图经建造模式(F1 -> Export Map)导出为 .z。

用法:
    python read_zone.py 地图.z                 # 打印结构概览
    python read_zone.py 地图.z --full          # 打印完整 JSON(截断到 50k)
    python read_zone.py 地图.z -o map.json     # 解析后保存为 JSON
    python read_zone.py 地图.z --cells 5       # 打印前 N 个 cell 的 tile 引用
"""
import sys, os, json, gzip, argparse

try:
    import lz4.frame as _lz4
except Exception:
    _lz4 = None


def _is_gzip(b):
    return len(b) >= 2 and b[0] == 0x1F and b[1] == 0x8B


def _is_lz4frame(b):
    # LZ4 帧格式 magic: 04 22 4D 18
    return len(b) >= 4 and b[0] == 0x04 and b[1] == 0x22 and b[2] == 0x4D and b[3] == 0x18


def _decompress(raw):
    """返回 (text, method)；无法识别则返回 (None, None)。"""
    if _is_gzip(raw):
        return gzip.decompress(raw).decode("utf-8"), "gzip"
    if _lz4 is not None and _is_lz4frame(raw):
        return _lz4.decompress(raw).decode("utf-8"), "lz4"
    # 末尝试：当纯文本 JSON
    try:
        txt = raw.decode("utf-8")
        if txt.lstrip()[:1] in ("{", "["):
            return txt, "none(plain json)"
    except Exception:
        pass
    return None, None


def read_zone(path):
    with open(path, "rb") as f:
        raw = f.read()
    text, method = _decompress(raw)
    if text is None:
        raise ValueError(
            "无法解压/解析: 既不是 gzip，也不是 lz4 帧，也不是纯 JSON。"
            "该 .z 可能使用了 LZ4 块格式(需原始大小)，请改用游戏内/BepInEx 方式读取。"
        )
    return json.loads(text), method


def _first(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and k in d:
            return d[k]
    return default


def summarize(z, n_cells=3):
    print("顶层字段:", list(z.keys()) if isinstance(z, dict) else type(z).__name__)
    for k in ("id", "uid", "name", "type", "level", "dangerLv", "biome"):
        v = _first(z, k)
        if v is not None:
            print(f"  {k}: {v}")

    m = _first(z, "map", "Map")
    if isinstance(m, dict):
        print("  map 字段:", list(m.keys()))
        w = _first(m, "w", "Width")
        h = _first(m, "h", "Height")
        if w is not None:
            print(f"  map 尺寸: {w} x {h}")
        # 一些已知子结构
        for sub in ("blocks", "floors", "objs", "things", "charas", "decos"):
            if sub in m:
                v = m[sub]
                n = len(v) if hasattr(v, "__len__") else "?"
                print(f"  map.{sub}: {n} 项")

    cells = _first(z, "cells", "Cells") or (_first(m, "cells", "Cells") if isinstance(m, dict) else None)
    if isinstance(cells, list):
        print(f"  cells 数量: {len(cells)}")
        for i in range(min(n_cells, len(cells))):
            print(f"  cell[{i}]: {json.dumps(cells[i], ensure_ascii=False)[:240]}")


def main():
    ap = argparse.ArgumentParser(description="读取 Elin 原版地图 .z 文件 (JSON + 可选 GZip/LZ4)")
    ap.add_argument("path", help=".z 文件路径")
    ap.add_argument("--full", action="store_true", help="输出完整 JSON (截断到 50k 字符)")
    ap.add_argument("--cells", type=int, default=3, help="概览中打印前 N 个 cell (默认 3)")
    ap.add_argument("-o", "--out", help="把解析后的 JSON 保存到该路径")
    a = ap.parse_args()

    if not os.path.exists(a.path):
        print(f"文件不存在: {a.path}", file=sys.stderr)
        sys.exit(1)

    z, method = read_zone(a.path)
    print(f"文件: {a.path}")
    print(f"压缩方式: {method}")

    if a.full:
        print(json.dumps(z, ensure_ascii=False, indent=2)[:50000])
    else:
        summarize(z, n_cells=a.cells)

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(z, f, ensure_ascii=False)
        print(f"已保存: {a.out}")


if __name__ == "__main__":
    main()
