#!/usr/bin/env python3
"""Rebuild staffroom.tmj: school layout matching the reference, painting the
procedural school-props atlas (firstgid 2449). Emits the .tmj in place."""
import json, random, io

ROOT = r'D:\Work\Jargon'
MAP = ROOT + r'\src\renderer\src\assets\maps\staffroom.tmj'
ATLAS = ROOT + r'\tools\gen\staffroom-assets\school-atlas.json'
W, H = 36, 24
FIRSTGID = 2449
COLS = 16  # school-props atlas columns

atlas = json.load(open(ATLAS))
PROPS = atlas['props']

def pgid(name, px=0, py=0):
    """painted gid for prop `name` at intra-prop cell (px,py)."""
    p = PROPS[name]
    return FIRSTGID + p['gid'] + py * COLS + px

# legacy gids reused from existing atlases
GLASS_A, GLASS_B = 2341, 2342          # interiors glass panes (alternating)
WALL_L, WALL_R = 530, 533              # a5 wall edge columns
COLLIDE = 1                            # collision marker tile

floor = [0]*(W*H); walls = [0]*(W*H); below = [0]*(W*H); above = [0]*(W*H); col = [0]*(W*H)

def setc(layer, x, y, g):
    if 0 <= x < W and 0 <= y < H: layer[y*W+x] = g

def prop(name, x, y, top_layer, bot_layer=None, collide=True, nocollide_cells=()):
    """paint prop; py==0 cells go to top_layer, rest to bot_layer (or top)."""
    p = PROPS[name]
    for py in range(p['h']):
        for px in range(p['w']):
            tgt = top_layer if (bot_layer is None or py == 0) else bot_layer
            setc(tgt, x+px, y+py, pgid(name, px, py))
            if collide and (px, py) not in nocollide_cells:
                setc(col, x+px, y+py, COLLIDE)

def wallprop(name, x, y):
    """wall-mounted prop: paints onto walls layer, collides."""
    p = PROPS[name]
    for py in range(p['h']):
        for px in range(p['w']):
            setc(walls, x+px, y+py, pgid(name, px, py))
            setc(col, x+px, y+py, COLLIDE)

def glass_run(cells):
    for i, (x, y) in enumerate(cells):
        setc(walls, x, y, GLASS_A if i % 2 == 0 else GLASS_B)
        setc(col, x, y, COLLIDE)

# ── floor: warm tan school linoleum ──────────────────────────────────────────
rng = random.Random(7)
for y in range(H):
    for x in range(W):
        setc(floor, x, y, pgid('floor-a' if rng.random() < 0.85 else 'floor-b'))

# ── walls: side columns + top band + bottom ──────────────────────────────────
for y in range(2, H):
    setc(walls, 0, y, WALL_L); setc(col, 0, y, COLLIDE)
    setc(walls, W-1, y, WALL_R); setc(col, W-1, y, COLLIDE)
for x in range(W):                      # top band rows 0-1, school wall panels
    for y in (0, 1):
        setc(walls, x, y, pgid('wall')); setc(col, x, y, COLLIDE)
for x in range(W):                      # bottom wall row 23
    setc(walls, x, H-1, pgid('wall')); setc(col, x, H-1, COLLIDE)

# wall-mounted props on the band (ref1: tv, bulletin, 3-win bank, chalkboard, 3-win bank, whiteboard, clock, calendar)
wallprop('tv',         1, 0)
wallprop('bulletin',   4, 0)
wallprop('window',     7, 0); wallprop('window', 10, 0); wallprop('window', 13, 0)
wallprop('chalkboard', 16, 0)
wallprop('window',    20, 0); wallprop('window', 23, 0); wallprop('window', 26, 0)
wallprop('whiteboard',29, 0)
wallprop('clock',     32, 0); wallprop('calendar', 33, 0)

# against-wall floor props (row 2+)
prop('bookshelf',      1, 2, above, below)
prop('plant',          3, 3, below, collide=True)
prop('filing-cabinet', 4, 2, above, below)
prop('whiteboard-stand', 24, 2, above, below)   # hallway easel under right windows
prop('water-cooler',  31, 3, below, collide=True)
prop('coffee-machine', 30, 3, below, collide=True)
prop('counter',       31, 2, above, below)      # counter row behind them
prop('plant-big',     34, 3, above, below)

# ── meeting room (top-left glass box, x0-8 / y4-11) ───────────────────────────
# top edge y4: wall x1-3, door gap x4, glass x5-8 (as before)
for x in range(1, 4): setc(walls, x, 4, pgid('wall')); setc(col, x, 4, COLLIDE)
glass_run([(x, 4) for x in range(5, 9)])
glass_run([(1, y) for y in range(5, 11)])       # left glass col
glass_run([(8, y) for y in range(5, 11)])       # right glass col
glass_run([(x, 11) for x in range(1, 9)])       # bottom glass edge
prop('table-meeting', 3, 5, above, below)
for cx, cy in [(2,5),(2,6),(6,5),(6,6),(3,7),(5,7)]:
    prop('chair', cx, cy, below, collide=True)
prop('plant', 7, 9, below, collide=True)

# ── teacher corner (right, y4-5) ─────────────────────────────────────────────
prop('desk-teacher', 31, 4, above, below)
prop('chair-office', 32, 6, below, collide=False)      # pc-6 seat
prop('globe', 34, 4, below, collide=True)

# ── student desks mid-floor (y10-11, chairs y12) ──────────────────────────────
DESK_X = [3, 9, 15, 21, 27]
for dx in DESK_X:
    prop('desk-pc', dx, 10, above, below)
    prop('chair-office', dx+1, 12, below, collide=False)  # pc seats: no collision
prop('plant', 13, 10, below, collide=True)
prop('plant', 25, 10, below, collide=True)
prop('lockers', 1, 13, above, below)                    # left wall lockers

# ── lounge (bottom-left, x1-9 / y14-21) ──────────────────────────────────────
prop('rug',          2, 16, below, collide=False)
prop('coffee-table', 2, 17, below, collide=True)
prop('couch',        1, 15, below, collide=True)
prop('armchair',     5, 15, below, collide=True)
prop('armchair',     5, 17, below, collide=True)
prop('bookshelf-wide', 1, 21, below, collide=True)
prop('filing-cabinet', 5, 20, above, below)
prop('filing-cabinet', 6, 20, above, below)
prop('vending',      8, 20, above, below)
prop('water-cooler', 9, 15, below, collide=True)
prop('plant',        7, 21, below, collide=True)
# cafe seats sit on couch/armchair cells -> clear collision there
for sx, sy in [(1,15),(2,15),(5,15),(5,17)]:
    col[sy*W+sx] = 0

# ── entrance (bottom-center) ─────────────────────────────────────────────────
prop('door', 17, 22, walls, collide=False)             # doorway in bottom wall
col[22*W+17] = 0; col[23*W+17] = 0                     # clear wall-band collision under door
prop('rug', 16, 20, below, collide=False)
prop('reception', 16, 17, above, below)
prop('plant', 15, 18, below, collide=True)
prop('plant', 20, 18, below, collide=True)

# ── principal office (bottom-right glass box, interior x28-33 / y16-21) ───────
glass_run([(x, 14) for x in range(27, 34)])            # top glass edge
glass_run([(27, y) for y in range(15, 22) if y not in (18, 19)])  # left glass, door gap 18-19
glass_run([(x, 22) for x in range(27, 34)])            # bottom glass edge
prop('desk-principal', 30, 17, above, below)
prop('chair-office', 31, 19, below, collide=False)     # desk-ceo seat
prop('bookshelf', 28, 16, above, below)
prop('globe', 33, 16, below, collide=True)
prop('plant-big', 28, 20, above, below)

# ── objects ──────────────────────────────────────────────────────────────────
def pt(name, tx, ty, i): return {"id": i, "name": name, "point": True, "x": tx*16+8, "y": ty*16+8, "width": 0, "height": 0, "rotation": 0, "type": "", "visible": True}
def zone(name, tx, ty, tw, th, i): return {"id": i, "name": name, "x": tx*16, "y": ty*16, "width": tw*16, "height": th*16, "rotation": 0, "type": "", "visible": True}

spawns = [
    pt('desk-ceo', 31, 19, 1),
    pt('pc-1', 4, 12, 2), pt('pc-2', 10, 12, 3), pt('pc-3', 16, 12, 4),
    pt('pc-4', 22, 12, 5), pt('pc-5', 28, 12, 6), pt('pc-6', 32, 6, 7),
    pt('cafe-seat-1', 1, 15, 8), pt('cafe-seat-2', 2, 15, 9),
    pt('cafe-seat-3', 5, 15, 10), pt('cafe-seat-4', 5, 17, 11),
    pt('cafe-stand-coffee', 30, 4, 12), pt('cafe-stand-vending', 9, 19, 13),
    pt('entrance', 17, 22, 14),
]
zones = [
    zone('boardroom', 1, 4, 8, 8, 15),
    zone('cafeteria', 1, 14, 9, 8, 16),
    zone('principal', 27, 14, 8, 9, 17),
]

old = json.load(open(MAP))
layers = []
for i, (name, data) in enumerate([('floor',floor),('walls',walls),('furniture-below',below),('furniture-above',above),('collision',col)]):
    layers.append({"id": i+1, "name": name, "type": "tilelayer", "data": data, "width": W, "height": H, "x": 0, "y": 0, "opacity": 1, "visible": True})
layers.append({"id": 6, "name": "spawn-points", "type": "objectgroup", "objects": spawns, "x":0,"y":0,"opacity":1,"visible":True,"draworder":"topdown"})
layers.append({"id": 7, "name": "zones", "type": "objectgroup", "objects": zones, "x":0,"y":0,"opacity":1,"visible":True,"draworder":"topdown"})

tilesets = list(old['tilesets'])
tilesets.append({"firstgid": FIRSTGID, "columns": COLS, "image": "../tilesets/school-props.png",
                 "imageheight": atlas.get('imageheight', 128), "imagewidth": 256, "margin": 0,
                 "name": "school-props", "spacing": 0, "tilecount": atlas['tilecount'],
                 "tileheight": 16, "tilewidth": 16})

out = dict(old)
out['layers'] = layers
out['tilesets'] = tilesets
out['nextobjectid'] = 18
with io.open(MAP, 'w', encoding='utf-8') as f:
    json.dump(out, f, separators=(',', ':'))
print('written', MAP)
print('nonzero: floor', sum(1 for g in floor if g), '| walls', sum(1 for g in walls if g),
      '| below', sum(1 for g in below if g), '| above', sum(1 for g in above if g), '| col', sum(1 for g in col if g))
