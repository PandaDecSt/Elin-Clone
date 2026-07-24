#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Banana (Gemini web) 像素精灵管线辅助脚本
=========================================
对应 chongdashu/ai-pixel-snapped-game-sprites 的确定性下游步骤，
与用哪个图像模型生图无关（GPT / Banana / 其它都可）。

子命令:
  guides  生成交替像素引导图（1024x1024 均匀 + 2048x1536 4x3 动作板）
  recover 从动作板 PNG 按 chroma 抠出每个帧（前景连通域，不朴素网格切）
  pack    把恢复出的帧打包成 1280x512 运行时精灵表 + manifest.json（脚锚锁定）

依赖: pillow, numpy, scipy
  python -m pip install pillow numpy scipy
"""
import argparse
import json
import os
import sys
from PIL import Image

CHROMA = (0, 255, 0)  # #00FF00


def _is_background(px):
    r, g, b = px[0], px[1], px[2]
    return g > 180 and (g - r) > 60 and (g - b) > 60


# ---------------------------------------------------------------------------
# guides: 交替像素引导图
# ---------------------------------------------------------------------------
def cmd_guides(args):
    out = args.out
    os.makedirs(out, exist_ok=True)

    # 均匀 1px 交替棋盘（1024x1024），用作方向锚 / 像素风格引导 (repo file 03)
    w = h = 1024
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (0, 0, 0) if (x + y) % 2 == 0 else (255, 255, 255)
    p1 = os.path.join(out, "alternating-1024x1024.png")
    img.save(p1)
    print("wrote", p1)

    # 动作板引导（2048x1536），同样 1px 交替棋盘，仅画布更大 (repo file 04)
    w, h = 2048, 1536
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (0, 0, 0) if (x + y) % 2 == 0 else (255, 255, 255)
    p2 = os.path.join(out, "alternating-2048x1536-4x3-pose-board.png")
    img.save(p2)
    print("wrote", p2)


# ---------------------------------------------------------------------------
# recover: 动作板 -> 逐帧 PNG（前景连通域，非网格切）
# ---------------------------------------------------------------------------
def cmd_recover(args):
    from scipy import ndimage
    import numpy as np

    board = Image.open(args.board).convert("RGBA")
    W, H = board.size
    cols, rows = args.cols, args.rows
    cw, ch = W // cols, H // rows
    margin = args.margin
    out = args.out
    os.makedirs(out, exist_ok=True)

    arr = np.array(board)
    # 背景掩码
    r = arr[:, :, 0].astype(int)
    g = arr[:, :, 1].astype(int)
    b = arr[:, :, 2].astype(int)
    bg = (g > 180) & ((g - r) > 60) & ((g - b) > 60)
    fg = ~bg

    count = 0
    for row in range(rows):
        for col in range(cols):
            x0, y0 = col * cw, row * ch
            # 该 cell 区域的前景掩码
            fcell = fg[y0:y0 + ch, x0:x0 + cw]
            if not fcell.any():
                continue
            # 连通域标记，取最大
            labeled, n = ndimage.label(fcell)
            if n == 0:
                continue
            sizes = ndimage.sum(fcell, labeled, range(1, n + 1))
            biggest = int(np.argmax(sizes)) + 1
            ys, xs = np.where(labeled == biggest)
            bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max(), ys.max()
            # 加上 padding，裁剪整张图的对应区域（用绝对坐标）
            ax0 = max(0, x0 + bx0 - margin)
            ay0 = max(0, y0 + by0 - margin)
            ax1 = min(W, x0 + bx1 + 1 + margin)
            ay1 = min(H, y0 + by1 + 1 + margin)
            frame = board.crop((ax0, ay0, ax1, ay1))
            # 清掉残留 chroma 边缘 -> 透明
            fa = np.array(frame)
            fr = fa[:, :, 0].astype(int)
            fg2 = fa[:, :, 1].astype(int)
            fb = fa[:, :, 2].astype(int)
            fgmask = (fg2 > 180) & ((fg2 - fr) > 60) & ((fg2 - fb) > 60)
            fa[fgmask, 3] = 0
            frame = Image.fromarray(fa, "RGBA")
            count += 1
            path = os.path.join(out, f"frame_{count:04d}.png")
            frame.save(path)
            print("recovered", path, frame.size)
    print(f"done: {count} frames -> {out}")


# ---------------------------------------------------------------------------
# pack: 逐帧 -> 1280x512 运行时表 + manifest（脚锚锁定）
# ---------------------------------------------------------------------------
def cmd_pack(args):
    import numpy as np

    indir = args.indir
    frames = sorted(
        f for f in os.listdir(indir)
        if f.lower().endswith(".png") and f.startswith("frame_")
    )
    if not frames:
        frames = sorted(f for f in os.listdir(indir) if f.lower().endswith(".png"))
    if not frames:
        print("no frames found in", indir)
        sys.exit(1)

    cell = 256
    cols = 5
    n = len(frames)
    rows = (n + cols - 1) // cols
    sheet_w, sheet_h = cols * cell, rows * cell
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    anchor_x, anchor_y = 128, 255  # 脚锚: 水平居中, cell 底部
    for i, fname in enumerate(frames):
        im = Image.open(os.path.join(indir, fname)).convert("RGBA")
        arr = np.array(im)
        alpha = arr[:, :, 3]
        ys, xs = np.where(alpha > 10)
        if len(ys) == 0:
            print("warn: empty frame", fname)
            continue
        bottom = int(ys.max())
        left = int(xs.min())
        right = int(xs.max())
        fw = right - left + 1
        fx = anchor_x - (fw // 2) - left
        fy = anchor_y - bottom
        sheet.paste(im, (i % cols) * cell + fx, (i // cols) * cell + fy)
        print(f"packed {fname} @ cell {i % cols},{i // cols}")

    sheet_path = os.path.join(indir, "..", args.out) if False else os.path.join(
        os.path.dirname(indir.rstrip("/\\")), args.out)
    sheet.save(sheet_path)
    print("wrote", sheet_path)

    manifest = {
        "version": 1,
        "action": args.action,
        "direction": args.direction,
        "spritesheet": os.path.basename(sheet_path),
        "previewGif": "",
        "frameWidth": cell,
        "frameHeight": cell,
        "columns": cols,
        "rows": rows,
        "frames": n,
        "fps": args.fps,
        "anchor": {"x": anchor_x, "y": anchor_y},
    }
    mpath = os.path.splitext(sheet_path)[0] + ".manifest.json"
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print("wrote", mpath)


def main():
    ap = argparse.ArgumentParser(description="Banana 像素精灵管线辅助")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("guides", help="生成交替像素引导图")
    g.add_argument("--out", default="guides")
    g.set_defaults(func=cmd_guides)

    r = sub.add_parser("recover", help="动作板 -> 逐帧 PNG")
    r.add_argument("--board", required=True, help="动作板 PNG 路径")
    r.add_argument("--cols", type=int, default=4)
    r.add_argument("--rows", type=int, default=3)
    r.add_argument("--margin", type=int, default=4)
    r.add_argument("--out", default="recovered")
    r.set_defaults(func=cmd_recover)

    p = sub.add_parser("pack", help="逐帧 -> 运行时表 + manifest")
    p.add_argument("--indir", required=True, help="恢复出的帧目录")
    p.add_argument("--out", default="spritesheet.png")
    p.add_argument("--action", default="idle")
    p.add_argument("--direction", default="s")
    p.add_argument("--fps", type=int, default=10)
    p.set_defaults(func=cmd_pack)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
