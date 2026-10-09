#!/usr/bin/env python3
"""Offline renderer: composite a .tmj map (all tilesets) into a PNG preview."""
import json, sys
from PIL import Image

ROOT = r'D:\Work\Jargon'
MAP = sys.argv[1] if len(sys.argv) > 1 else ROOT + r'\src\renderer\src\assets\maps\staffroom.tmj'
OUT = sys.argv[2] if len(sys.argv) > 2 else r'D:\tmp\staffroom-v2.png'
SCALE = int(sys.argv[3]) if len(sys.argv) > 3 else 2

m = json.load(open(MAP))
W, H, TW = m['width'], m['height'], m['tilewidth']
# tileset images come from themeRegistry.ts (the .tmj's external .tsx stubs
# don't exist on disk) — mirror the registry entries by firstgid:
TS_DIR = ROOT + r'\src\renderer\src\assets\tilesets'
TS_DEFS = [  # (firstgid, file, columns, tilecount)
    (1,    'office-tileset.png',        16, 512),
    (513,  'a5-office-floors-walls.png',16, 512),
    (1025, 'interiors.png',             16, 1424),
    (2449, 'school-props.png',          16, 512),
]
ts = [(fg, c, tc, Image.open(TS_DIR + '\\' + f).convert('RGBA')) for fg, f, c, tc in TS_DEFS]

def tile(gid):
    for fg, c, tc, im in reversed(ts):
        if fg <= gid < fg + tc:
            i = gid - fg
            return im.crop(((i % c) * TW, (i // c) * TW, (i % c + 1) * TW, (i // c + 1) * TW))
    return None

out = Image.new('RGBA', (W * TW, H * TW), (20, 20, 24, 255))
for lname in ['floor', 'walls', 'furniture-below', 'furniture-above']:
    layer = next((l for l in m['layers'] if l['name'] == lname), None)
    if not layer:
        continue
    for i, g in enumerate(layer['data']):
        if g:
            t = tile(g)
            if t:
                out.paste(t, ((i % W) * TW, (i // W) * TW), t)
out = out.resize((W * TW * SCALE, H * TW * SCALE), Image.NEAREST)
out.save(OUT)
print('saved', out.size, '->', OUT)
