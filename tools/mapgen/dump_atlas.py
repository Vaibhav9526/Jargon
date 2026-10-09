#!/usr/bin/env python3
"""Render a tileset atlas as a labeled grid PNG so we can eyeball what tiles exist.

Usage:
    python3 dump_atlas.py <atlas.png> <out.png> [scale]
Tiles are labeled with their LOCAL index (0-based row-major), which is what you
subtract from firstgid to get the gid.
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))


def dump(atlas, out, scale=3):
    img = Image.open(atlas).convert('RGBA')
    tw = th = 16
    cols = img.width // tw
    rows = img.height // th
    pad = 14          # room for the row/col header strips
    cell = tw * scale
    W = cols * cell + pad
    H = rows * cell + pad
    canvas = Image.new('RGBA', (W, H), (24, 22, 32, 255))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype('arial.ttf', 9)
    except Exception:
        font = ImageFont.load_default()

    big = img.resize((cols * cell, rows * cell), Image.NEAREST)
    canvas.alpha_composite(big, (pad, pad))

    # grid lines + every-5th thicker rule so indices are countable
    for c in range(cols + 1):
        x = pad + c * cell
        draw.line([x, pad, x, H], fill=(255, 0, 128, 90) if c % 5 else (0, 255, 200, 140), width=1)
    for r in range(rows + 1):
        y = pad + r * cell
        draw.line([pad, y, W, y], fill=(255, 0, 128, 90) if r % 5 else (0, 255, 200, 140), width=1)

    for c in range(cols):
        draw.text((pad + c * cell + 1, 2), str(c), fill=(0, 255, 200, 255), font=font)
    for r in range(rows):
        draw.text((2, pad + r * cell + 4), str(r * cols), fill=(255, 200, 0, 255), font=font)

    canvas.convert('RGB').save(out)
    print(f'{os.path.basename(atlas)}: {cols}x{rows} = {cols*rows} tiles -> {out}')


if __name__ == '__main__':
    a, o = sys.argv[1], sys.argv[2]
    s = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    dump(a, o, s)