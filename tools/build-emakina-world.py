#!/usr/bin/env python3
"""Build the "Modern" office + school tilemaps from the EmakinaFR/office-map art.

Art: https://github.com/EmakinaFR/office-map (32px tiles). Used with the owner's
permission — see src/renderer/src/assets/ATTRIBUTION.md. The Star Wars sheet in
that repo is NOT used (third-party IP).

    python tools/build-emakina-world.py --src <path-to-office-map-clone> [--preview out]

Writes (all under src/renderer/src/assets/):
    tilesets/emakina-atlas.png   only the tiles the maps use, 1px-extruded so
                                 linear filtering never bleeds between tiles
    maps/office-modern.tmj       the Office floor
    maps/staffroom-modern.tmj    the School floor
    maps/emakina.meta.json       everything the theme registry needs that is tied
                                 to the layout: monitor gids, the coffee economy
                                 tiles, the clickable anchors and the errand spots

The maps are laid out on the engine's 16-unit grid; each 32px art tile fills one
cell (the renderer scales it to the grid), so characters keep their proportions.
The camera fits the whole map to the window, so the floors are kept COMPACT (the
smaller the map, the bigger everything reads on screen) and densely furnished,
like the classic floors: individual desks, partition walls with doorways, rugs,
plants and props in every corner.

Engine contract (validated by `check()` before anything is written):
  * a seat is walkable with a blocked tile beside it (the engine checks north,
    south, west, east in that order to pick the facing);
  * a seat whose desk should light up has the OFF monitor (S1 (3,15)) on layer
    furniture-above exactly two rows above it;
  * every spawn point, errand stand, coffee stand and board stand is reachable
    from `entrance`; coffee tiles (tray / machine / sink) sit on furniture.
"""
import argparse
import json
import os
import sys
from collections import deque

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', 'src', 'renderer', 'src', 'assets'))
CELL = 16          # engine grid, in world units
ART = 32           # source tile size, in pixels
PAD = 1            # extrusion around every packed tile

SHEETS = {
    'S1': 'tilesets_deviant_milkian_1.png',
    'S2': 'tilesets_deviant_milkian_2.png',
    'S3': 'tilesets_deviant_milkian_3.png',
    'FL': 'floortileset.png',
    'CU': 'tileset_custom.png',
    'FA': 'fantasy.png',
}
ORDER = list(SHEETS)
LAYERS = ['floor', 'walls', 'furniture-below', 'furniture-above']

MONITOR_OFF = ('S1', 3, 15)
MONITOR_ON = ('S1', 2, 15)
FACINGS = ('up', 'down', 'left', 'right')
ERRAND_KINDS = ('water', 'window', 'dispenser', 'fridge', 'shelf', 'bin', 'smoke')
ERRAND_DURATION = {'water': 4.5, 'window': 5, 'dispenser': 3.5, 'fridge': 3.2, 'shelf': 4, 'bin': 2.6, 'smoke': 18}


class World:
    def __init__(self, name, w, h):
        self.name, self.w, self.h = name, w, h
        self.layers = {n: [[None] * w for _ in range(h)] for n in LAYERS}
        self.blocked = [[False] * w for _ in range(h)]
        self.spawns = {}          # name -> (x, y)
        self.zones = {}           # name -> (x, y, w, h)
        self.monitored = []       # seats that must carry a lit-able monitor
        self.errands = []         # dicts: kind, stand, facing, fx, duration, godOnly
        self.coffee = {}          # trayTile / trayStand / machineTile / ...
        self.anchors = {}         # calendar / boards / clock / questions / board*

    # -- drawing -----------------------------------------------------------
    def fill(self, layer, x0, y0, w, h, key):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                self.set(layer, x, y, key)

    def set(self, layer, x, y, key):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.layers[layer][y][x] = key

    def put(self, layer, x, y, sheet, col, row, w=1, h=1):
        """Copy a w x h block of sheet tiles to (x, y)."""
        for dy in range(h):
            for dx in range(w):
                self.set(layer, x + dx, y + dy, (sheet, col + dx, row + dy))

    def item(self, x, y, sheet, col, row, w=1, h=1, block=None, layer='furniture-below'):
        """Place a w x h prop and block it (``block`` = number of rows from the
        top that collide; default all)."""
        self.put(layer, x, y, sheet, col, row, w, h)
        self.block(x, y, w, h if block is None else block)

    def block(self, x, y, w=1, h=1):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.blocked[yy][xx] = True

    def clear_block(self, x, y, w=1, h=1):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.blocked[yy][xx] = False

    def spawn(self, name, x, y):
        assert name not in self.spawns, f'duplicate spawn {name}'
        self.spawns[name] = (x, y)

    def zone(self, name, x, y, w, h):
        self.zones[name] = (x, y, w, h)

    def errand(self, kind, stand, facing, fx, god_only=False, duration=None):
        assert kind in ERRAND_KINDS and facing in FACINGS
        e = {'kind': kind, 'stand': stand, 'facing': facing, 'fx': fx,
             'duration': ERRAND_DURATION[kind] if duration is None else duration}
        if god_only:
            e['godOnly'] = True
        self.errands.append(e)

    def walkable(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h and not self.blocked[y][x]


# ---------------------------------------------------------------------------
# palette — floors, walls, rugs (verified against 4x labelled crops)
# ---------------------------------------------------------------------------
PARQUET = ('FA', 0, 38)
DARK_PARQUET = ('FA', 0, 39)
PLANKS = ('FA', 0, 36)
DIAMONDS = ('FA', 2, 38)          # warm yellow diamond tiles (kitchen)
TERRACOTTA = ('FA', 2, 39)
MARBLE = ('FA', 0, 40)
GREEN_CHECK = ('FA', 1, 40)
MAT = ('FA', 4, 41)               # red striped door mat
WALL_TOP = ('FA', 6, 65)          # a partition / outer wall seen from above

# two-row wall faces: (upper row, lower row); columns 0/3 carry the end caps
FACES = {
    'white': 66,                  # white plaster over a wooden wainscot
    'stripes': 64,                # warm yellow striped wallpaper over a rail
    'wood': 62,                   # wooden boards
}


def face(wd, x0, x1, y, style):
    """A two-row wall face (rows y, y+1) from x0 to x1 inclusive."""
    r = FACES[style]
    for x in range(x0, x1 + 1):
        c = 0 if x == x0 else 3 if x == x1 else 1 + (x - x0) % 2
        wd.set('walls', x, y, ('FA', c, r))
        wd.set('walls', x, y + 1, ('FA', c, r + 1))
        wd.block(x, y, 1, 2)


def wall_top(wd, x0, y0, x1, y1):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            wd.set('walls', x, y, WALL_TOP)
            wd.block(x, y)


def nine(wd, layer, x, y, w, h, c0, r0, rows=3):
    """Nine-slice a 3x3 (or 3x2: rows=2 uses top + bottom) sheet block over w x h."""
    for dy in range(h):
        rr = r0 if dy == 0 else (r0 + rows - 1 if dy == h - 1 else r0 + 1)
        for dx in range(w):
            cc = c0 if dx == 0 else (c0 + 2 if dx == w - 1 else c0 + 1)
            wd.set(layer, x + dx, y + dy, ('FA', cc, rr))


def rug(wd, x, y, w, h, kind='beige'):
    """Rugs go on the walls layer (nothing else lives there inside a room)."""
    c0, r0 = {'beige': (5, 104), 'red': (5, 98)}[kind]
    nine(wd, 'walls', x, y, w, h, c0, r0)


def table(wd, x, y, w, h=3, kind='light'):
    """Wooden table from the fantasy sheet, any width, 2 or 3 rows; all rows block."""
    c0, r0 = {'light': (5, 89), 'dark': (5, 92)}[kind]
    if h == 2:
        for dx in range(w):
            cc = 5 if dx == 0 else (7 if dx == w - 1 else 6)
            wd.set('furniture-below', x + dx, y, ('FA', cc, r0))
            wd.set('furniture-below', x + dx, y + 1, ('FA', cc, r0 + 2))
    else:
        nine(wd, 'furniture-below', x, y, w, h, c0, r0)
    wd.block(x, y, w, h)


def windows(wd, xs, y=0):
    """2x2 window pieces set into a two-row wall face."""
    for x in xs:
        wd.put('furniture-below', x, y, 'S1', 14, 0, 2, 2)


CHAIRS = [('S1', 1, 7), ('S1', 0, 7), ('S1', 3, 7), ('S1', 2, 7)]
DESK_PROPS = [('S1', 14, 10), ('S1', 7, 10), ('S3', 13, 9), ('S1', 1, 15), ('S3', 12, 9), ('S1', 7, 9)]


def desk(wd, x, a, seat=None, i=0, monitor=True, chair=None):
    """An individual light-wood desk (S3 (14,9), 2x2) at rows a..a+1, monitor on
    its left half, a small prop on the right, keyboard in front, chair at a+2.
    The engine lights the monitor that sits two rows above the seat."""
    wd.item(x, a, 'S3', 14, 9, 2, 2)
    if monitor:
        wd.set('furniture-above', x, a, MONITOR_OFF)
        wd.set('furniture-above', x, a + 1, ('S1', 0, 15))          # keyboard
    wd.set('furniture-above', x + 1, a, DESK_PROPS[i % len(DESK_PROPS)])
    if seat:
        wd.set('furniture-above', x, a + 2, chair or CHAIRS[i % len(CHAIRS)])
        wd.spawn(seat, x, a + 2)
        if monitor:
            wd.monitored.append(seat)


LEFT_PROPS = [('S3', 12, 9), ('FA', 0, 119), ('S1', 1, 15), ('FA', 2, 119), ('S3', 12, 10), ('FA', 4, 119)]


def wide_desk(wd, x, a, seat, i=0):
    """A warm three-tile wooden desk (fantasy light table, rows a..a+1): papers
    on the left, the monitor + keyboard in the middle, a mug / phone / book on
    the right, the office chair in front (seat at x+1, a+2)."""
    table(wd, x, a, 3, 2, 'light')
    wd.set('furniture-above', x, a, LEFT_PROPS[i % len(LEFT_PROPS)])
    wd.set('furniture-above', x + 1, a, MONITOR_OFF)
    wd.set('furniture-above', x + 1, a + 1, ('S1', 0, 15))              # keyboard
    wd.set('furniture-above', x + 2, a, DESK_PROPS[i % len(DESK_PROPS)])
    wd.set('furniture-above', x + 1, a + 2, CHAIRS[i % len(CHAIRS)])
    wd.spawn(seat, x + 1, a + 2)
    wd.monitored.append(seat)


def plant(wd, x, y, kind=0):
    """Potted plants: 0 tall leafy (1x2), 1 tall grass (1x2), 2 pink flowers,
    3 red flowers, 4 blue flowers, 5 school fig (1x2)."""
    spec = [('FA', 7, 113, 2), ('FA', 7, 115, 2), ('FA', 7, 117, 1),
            ('S1', 5, 14, 1), ('S1', 6, 14, 1), ('S3', 11, 9, 2)][kind]
    s, c, r, h = spec
    wd.item(x, y, s, c, r, 1, h)
    return (x, y + h - 1)          # the pot tile (where droplets land)


def bin_(wd, x, y):
    wd.item(x, y, 'S1', 0, 6)
    return (x, y)


def kitchen(wd, x, y):
    """The coffee corner: a 9-wide run against a wall at rows y..y+1 — drinks
    fridge, counter with the mug tray, coffee machine, counter with the sink,
    counter with a fruit bowl, vending machine, water cooler — then two round
    café tables (seats above and below) at row y+4. Emits the café spawn points,
    the coffee-economy tiles and the fridge / dispenser errands."""
    wd.item(x, y, 'S2', 13, 3, 2, 2)                                   # drinks fridge
    for dx, (c, r) in ((2, (1, 4)), (4, (2, 4)), (5, (3, 4))):         # kitchen counter
        wd.item(x + dx, y, 'S3', c, r, 1, 2)
    wd.set('furniture-above', x + 2, y, ('S1', 13, 13))                # mug tray
    wd.item(x + 3, y, 'S1', 6, 12, 1, 2)                               # coffee machine
    wd.set('furniture-above', x + 4, y, ('S3', 1, 3))                  # sink
    wd.set('furniture-above', x + 5, y, ('S3', 6, 3))                  # fruit bowl
    wd.item(x + 6, y, 'S2', 8, 12, 2, 2)                               # vending machine
    wd.item(x + 8, y, 'S2', 6, 0, 1, 2)                                # water cooler
    for i, dx in enumerate((2, 6)):
        tx = x + dx
        wd.item(tx, y + 4, 'FA', 4, 89)                                # round café table
        wd.set('furniture-above', tx, y + 4, [('FA', 7, 121), ('FA', 5, 121)][i])
        for sy, n in ((y + 3, 1), (y + 5, 2)):
            wd.set('furniture-above', tx, sy, ('FA', 4, 90))           # stools
            wd.spawn(f'cafe-seat-{2 * i + n}', tx, sy)
    wd.spawn('cafe-stand-coffee', x + 3, y + 2)
    wd.spawn('cafe-stand-vending', x + 6, y + 2)
    wd.coffee = dict(trayTile=(x + 2, y), trayStand=(x + 2, y + 2),
                     machineTile=(x + 3, y), machineStand=(x + 3, y + 2),
                     sinkTile=(x + 4, y), sinkStand=(x + 4, y + 2))
    wd.errand('fridge', (x + 1, y + 2), 'up', (x + 1, y + 1))
    wd.errand('dispenser', (x + 8, y + 2), 'up', (x + 8, y + 1))


# ---------------------------------------------------------------------------
# OFFICE  (34 x 22)
#   top band   : CEO office | meeting room | café (coffee economy)
#   open plan  : 3 rows of 5 individual desks
#   right side : reception lounge by the front door
# ---------------------------------------------------------------------------
OFFICE_SEATS = [
    'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5',
    'pc-6', 'desk-chief-architect', 'desk-product-manager', 'desk-team-lead', 'desk-backend-engineer',
    'desk-ui-ux-expert', 'desk-data-engineer', 'desk-project-manager', 'desk-market-researcher', 'desk-agent-organizer',
]


def build_office():
    W, H = 34, 22
    wd = World('office-modern', W, H)
    wd.fill('floor', 0, 0, W, H, PARQUET)

    # ---- shell -------------------------------------------------------------
    wall_top(wd, 0, 0, 0, H - 1)
    wall_top(wd, W - 1, 0, W - 1, H - 1)
    wall_top(wd, 0, H - 1, W - 1, H - 1)
    face(wd, 1, 8, 0, 'wood')          # CEO office back wall
    face(wd, 10, 21, 0, 'white')       # meeting room
    face(wd, 23, 32, 0, 'white')       # café
    wall_top(wd, 9, 0, 9, 7)
    wall_top(wd, 22, 0, 22, 7)
    # the partition between the top rooms and the open plan (doors at 4-5, 14-15, 27-28)
    face(wd, 1, 3, 8, 'stripes')
    face(wd, 6, 13, 8, 'stripes')
    face(wd, 16, 26, 8, 'stripes')
    face(wd, 29, 32, 8, 'stripes')
    for dx in (4, 5, 14, 15, 27, 28):
        wd.set('floor', dx, 8, PLANKS); wd.set('floor', dx, 9, PLANKS)

    # ---- CEO office (x 1-8, y 2-7) ------------------------------------------
    wd.fill('floor', 1, 2, 8, 6, DARK_PARQUET)
    rug(wd, 3, 4, 5, 4, 'beige')
    wd.put('furniture-below', 1, 0, 'S1', 6, 10, 1, 2)                # wall clock
    windows(wd, [3])
    wd.put('furniture-below', 6, 0, 'S1', 14, 7, 2, 2)                 # framed flowers
    wd.item(1, 2, 'FA', 0, 93, 2, 2)                                   # bookcase
    ceo_plant = plant(wd, 5, 2, 1)
    wd.item(6, 2, 'FA', 0, 104, 3, 2)                                  # brick fireplace
    table(wd, 4, 4, 3, 2, 'dark')                                      # executive desk
    wd.set('furniture-above', 5, 4, MONITOR_OFF)
    wd.set('furniture-above', 4, 4, ('FA', 1, 119))                    # open ledger
    wd.set('furniture-above', 6, 4, ('S1', 7, 10))                     # phone
    wd.set('furniture-above', 5, 5, ('S1', 0, 15))
    wd.set('furniture-above', 5, 6, ('S1', 3, 7))
    wd.spawn('desk-ceo', 5, 6); wd.monitored.append('desk-ceo')
    wd.item(1, 4, 'S2', 8, 6, 2, 2)                                    # guest armchair
    wd.item(1, 6, 'FA', 4, 89)                                         # side table
    wd.set('furniture-above', 1, 6, ('FA', 6, 121))                    # teapot
    bin_(wd, 1, 7)
    wd.item(8, 4, 'S2', 9, 3, 1, 3)                                    # green armchair
    plant(wd, 8, 7, 3)
    wd.errand('water', (4, 3), 'right', ceo_plant, god_only=True)
    wd.errand('smoke', (3, 2), 'up', (3, 1), god_only=True)

    # ---- meeting room (x 10-21, y 2-7) --------------------------------------
    wd.fill('floor', 10, 2, 12, 6, PLANKS)
    rug(wd, 11, 2, 10, 5, 'beige')
    windows(wd, [11, 19])
    wd.put('furniture-below', 15, 0, 'S1', 11, 11, 2, 2)               # cork board
    p1 = plant(wd, 10, 2, 0)
    p2 = plant(wd, 21, 2, 0)
    table(wd, 12, 3, 8, 3, 'light')
    for cx in range(13, 19):
        wd.set('furniture-above', cx, 2, ('S3', 15, 0))
        wd.set('furniture-above', cx, 6, ('S1', 1, 7))
    for cx, prop in ((13, ('S1', 1, 15)), (15, ('S3', 13, 9)), (17, ('S1', 14, 10)), (18, ('FA', 6, 121))):
        wd.set('furniture-above', cx, 4, prop)
    wd.spawn('warroom-seat', 16, 6)
    wd.item(10, 5, 'S1', 1, 10, 2, 2)                                  # whiteboard on its stand
    plant(wd, 21, 6, 4)
    wd.zone('boardroom', 10, 2, 12, 6)
    wd.errand('water', (10, 4), 'up', p1)
    wd.errand('water', (21, 4), 'up', p2)
    wd.errand('window', (11, 2), 'up', (11, 1))
    wd.errand('window', (20, 2), 'up', (20, 1))

    # ---- café (x 23-32, y 2-7) — the coffee economy -------------------------
    wd.fill('floor', 23, 2, 10, 6, DIAMONDS)
    windows(wd, [26])
    wd.put('furniture-below', 29, 0, 'S1', 14, 9)                      # small landscape
    wd.put('furniture-below', 30, 0, 'S2', 7, 0, 1, 2)                 # clock
    kitchen(wd, 23, 2)
    cafe_plant = plant(wd, 32, 2, 1)
    wd.item(31, 5, 'CU', 0, 1, 2, 2)                                   # foosball
    cafe_bin = bin_(wd, 23, 7)
    plant(wd, 32, 7, 2)
    wd.zone('cafeteria', 23, 2, 10, 6)
    wd.errand('water', (32, 4), 'up', cafe_plant)
    wd.errand('bin', (24, 7), 'left', cafe_bin)

    # ---- open plan (x 1-24, y 10-20): 3 rows x 5 individual desks ----------------------
    wd.put('furniture-below', 1, 8, 'S1', 14, 9)                       # small landscape beside the calendar
    wd.put('furniture-below', 19, 8, 'S1', 14, 7, 2, 2)                # framed flowers
    wd.put('furniture-below', 23, 8, 'S1', 14, 9)                      # small landscape
    wd.put('furniture-below', 30, 8, 'S3', 12, 5)                      # notice plaque
    n = 0
    for a in (10, 14, 18):
        for x in (1, 6, 11, 16, 21):
            wide_desk(wd, x, a, OFFICE_SEATS[n], n)
            n += 1
    # little things between the desks
    op1 = plant(wd, 9, 10, 0)
    op2 = plant(wd, 19, 10, 1)
    wd.item(9, 14, 'S1', 4, 13, 1, 2)                                  # white drawers
    plant(wd, 4, 14, 3)
    plant(wd, 20, 15, 4)
    wd.item(14, 14, 'S2', 7, 2, 1, 2)                                  # wooden drawers
    wd.item(14, 18, 'S1', 8, 3, 2, 2)                                  # copier
    op_bin = bin_(wd, 10, 19)
    plant(wd, 4, 19, 2)
    plant(wd, 19, 19, 3)
    wd.item(24, 19, 'S1', 1, 6)                                        # extinguisher
    wd.errand('water', (9, 12), 'up', op1)
    wd.errand('water', (19, 12), 'up', op2)
    wd.errand('bin', (10, 18), 'down', op_bin)

    # ---- reception lounge (x 25-32, y 10-20) + the front door ---------------
    rug(wd, 26, 12, 6, 4, 'beige')
    wd.item(27, 11, 'S2', 10, 3, 3, 2)                                 # sofa
    wd.item(28, 14, 'FA', 2, 93)                                       # coffee table
    wd.set('furniture-above', 28, 14, ('FA', 2, 119))                  # magazines
    wd.item(31, 12, 'S2', 9, 3, 1, 3)                                  # armchair (faces left)
    wd.item(25, 13, 'S2', 8, 6, 2, 2)                                  # armchair (faces right)
    wd.item(32, 10, 'S2', 6, 0, 1, 2)                                  # water cooler
    wd.item(25, 10, 'FA', 2, 92)                                       # little dresser
    wd.set('furniture-above', 25, 10, ('FA', 7, 117))
    # reception desk facing the front door
    table(wd, 28, 17, 3, 2, 'dark')
    wd.set('furniture-above', 28, 17, ('FA', 3, 119))                  # visitor book
    wd.set('furniture-above', 29, 17, MONITOR_OFF)
    wd.set('furniture-above', 30, 17, ('S1', 7, 10))                   # phone
    wd.item(29, 16, 'S3', 15, 0, layer='furniture-above')              # receptionist's chair
    wd.item(25, 17, 'FA', 0, 93, 2, 2)                                 # bookcase
    lp = plant(wd, 25, 19, 0)
    plant(wd, 32, 19, 1)
    lb = bin_(wd, 32, 16)
    for x in (28, 29):
        wd.set('walls', x, H - 1, None)
        wd.clear_block(x, H - 1)
        wd.set('floor', x, H - 1, MAT)
    wd.spawn('entrance', 28, H - 2)
    wd.errand('dispenser', (32, 12), 'up', (32, 11))
    wd.errand('shelf', (27, 18), 'left', (26, 18))
    wd.errand('water', (26, 20), 'left', lp)
    wd.errand('bin', (32, 17), 'up', lb)

    wd.anchors = dict(calendar=(2, 8), boards=(7, 9), clock=(1, 0), questions=(16, 9))
    return wd


# ---------------------------------------------------------------------------
# SCHOOL  (34 x 22)
#   left  : classroom (chalkboard, task boards, paired student desks, reading
#           corner) over the staff room café and the meeting room
#   right : principal's office over the teacher's room + library
# ---------------------------------------------------------------------------
def student_desk(wd, x, y, kind, seat=None):
    """A one-tile school desk (paper / open book / folder / ...) with its chair below."""
    wd.item(x, y, 'S3', 10 + kind % 5, 0)
    wd.set('furniture-above', x, y + 1, ('S3', 14, 2))
    if seat:
        wd.spawn(seat, x, y + 1)


def build_school():
    W, H = 34, 22
    wd = World('staffroom-modern', W, H)
    wd.fill('floor', 0, 0, W, H, PARQUET)

    # ---- shell -------------------------------------------------------------
    wall_top(wd, 0, 0, 0, H - 1)
    wall_top(wd, W - 1, 0, W - 1, H - 1)
    wall_top(wd, 0, H - 1, W - 1, H - 1)
    face(wd, 1, 20, 0, 'white')        # classroom
    face(wd, 22, 32, 0, 'wood')        # principal
    wall_top(wd, 21, 0, 21, H - 2)
    for y in (6, 7, 10):               # doors: classroom <-> principal / teacher's room
        wd.set('walls', 21, y, None); wd.clear_block(21, y); wd.set('floor', 21, y, PLANKS)
    # classroom | staff room + meeting room (doors at 10-11 and 13-14)
    face(wd, 1, 9, 11, 'white')
    face(wd, 12, 12, 11, 'stripes')
    face(wd, 15, 20, 11, 'stripes')
    wall_top(wd, 12, 13, 12, H - 2)
    # principal | teacher's room (door at 23-24)
    face(wd, 22, 22, 8, 'stripes')
    face(wd, 25, 32, 8, 'stripes')
    for x, y in ((10, 11), (11, 11), (13, 11), (14, 11), (23, 8), (24, 8)):
        wd.set('floor', x, y, PLANKS); wd.set('floor', x, y + 1, PLANKS)
    # the front door, left wall
    for y in (9, 10):
        wd.set('walls', 0, y, None); wd.clear_block(0, y); wd.set('floor', 0, y, MAT)
    wd.spawn('entrance', 1, 10)

    # ---- classroom (x 1-20, y 2-10) ------------------------------------------
    wd.put('furniture-below', 1, 0, 'S1', 6, 10, 1, 2)                # wall clock
    windows(wd, [2, 18])
    wd.put('furniture-below', 5, 0, 'S3', 12, 3, 3, 2)                 # chalkboard
    wd.item(1, 2, 'S3', 9, 4, 1, 3)                                    # bookshelf
    wd.put('furniture-below', 1, 3, 'S3', 9, 5, 1, 2)
    wd.item(5, 3, 'S3', 14, 9, 2, 2)                                   # teacher's table
    wd.set('furniture-above', 5, 3, ('S3', 13, 9))
    wd.set('furniture-above', 6, 3, ('S3', 6, 3))
    wd.item(6, 2, 'S3', 15, 0, layer='furniture-above')                # teacher's chair
    wd.item(4, 3, 'S3', 8, 10)                                         # flowers
    cp3 = plant(wd, 8, 2, 5)
    # the reading corner under the task boards
    rug(wd, 9, 3, 9, 2, 'beige')
    wd.item(10, 3, 'S3', 4, 7)                                         # cushions
    wd.item(12, 4, 'S3', 5, 7)
    wd.item(14, 3, 'S3', 4, 10)                                        # teddy
    wd.item(16, 4, 'S3', 5, 8)
    wd.item(19, 2, 'S2', 7, 4, 1, 3)                                   # lockers
    wd.item(20, 2, 'S2', 7, 4, 1, 3)
    kinds = 0
    seat_at = {(3, 5): 'pc-1', (11, 5): 'pc-2', (19, 5): 'pc-3', (6, 8): 'pc-4', (14, 8): 'pc-5'}
    for y in (5, 8):
        for x in (2, 3, 6, 7, 10, 11, 14, 15, 18, 19):
            student_desk(wd, x, y, kinds, seat_at.get((x, y)))
            kinds += 1
    cp1 = plant(wd, 1, 6, 5)
    cp2 = plant(wd, 20, 8, 0)
    cb = bin_(wd, 20, 5)
    wd.errand('window', (2, 2), 'up', (2, 1))
    wd.errand('window', (18, 2), 'up', (18, 1))
    wd.errand('water', (1, 8), 'up', cp1)
    wd.errand('water', (20, 10), 'up', cp2)
    wd.errand('water', (8, 4), 'up', cp3)
    wd.errand('shelf', (2, 3), 'left', (1, 3))
    wd.errand('bin', (20, 6), 'up', cb)

    # ---- staff room / café (x 1-11, y 13-20) ---------------------------------
    wd.fill('floor', 1, 13, 11, 8, DIAMONDS)
    kitchen(wd, 1, 13)
    wd.put('furniture-below', 2, 11, 'S1', 14, 9)                      # small landscape
    wd.put('furniture-below', 3, 11, 'S2', 4, 0, 2, 1)                 # notice strip beside the calendar
    wd.item(1, 18, 'S2', 8, 6, 2, 2)                                   # armchair (faces right)
    wd.item(11, 18, 'S2', 9, 3, 1, 3)                                  # armchair (faces left)
    wd.item(5, 17, 'FA', 2, 93)                                        # side table with the teapot
    wd.set('furniture-above', 5, 17, ('FA', 6, 121))
    sp = plant(wd, 11, 15, 0)
    sb = bin_(wd, 1, 20)
    plant(wd, 5, 20, 2)
    plant(wd, 9, 20, 3)
    wd.zone('cafeteria', 1, 13, 11, 8)
    wd.errand('water', (11, 17), 'up', sp)
    wd.errand('bin', (2, 20), 'left', sb)

    # ---- meeting room (x 13-20, y 13-20) -------------------------------------
    wd.fill('floor', 13, 13, 8, 8, PLANKS)
    rug(wd, 14, 14, 7, 5, 'beige')
    wd.put('furniture-below', 16, 11, 'FA', 0, 78, 2, 1)               # world map
    table(wd, 15, 15, 5, 3, 'light')
    for cx in (16, 17, 18):
        wd.set('furniture-above', cx, 14, ('S3', 15, 0))
        wd.set('furniture-above', cx, 18, ('S1', 1, 7))
    wd.set('furniture-above', 16, 16, ('S3', 13, 9))
    wd.set('furniture-above', 18, 16, ('FA', 7, 121))
    wd.spawn('warroom-seat', 17, 18)
    mp = plant(wd, 20, 13, 0)
    wd.item(13, 19, 'S1', 1, 10, 2, 2)                                 # whiteboard on its stand
    plant(wd, 20, 20, 4)
    wd.item(17, 20, 'S2', 0, 12, 3, 1)                                 # bench
    wd.zone('boardroom', 13, 13, 8, 8)
    wd.errand('water', (19, 13), 'right', mp)

    # ---- principal's office (x 22-32, y 2-7) ---------------------------------
    wd.fill('floor', 22, 2, 11, 6, DARK_PARQUET)
    rug(wd, 24, 4, 7, 4, 'beige')
    windows(wd, [24])
    wd.put('furniture-below', 29, 0, 'S1', 14, 7, 2, 2)                # framed flowers
    wd.put('furniture-below', 32, 0, 'FA', 2, 101)                     # pendulum clock
    wd.item(22, 2, 'FA', 0, 93, 2, 2)                                  # bookcase
    wd.item(26, 2, 'FA', 0, 104, 3, 2)                                 # fireplace
    wd.item(30, 2, 'FA', 3, 89, 1, 2)                                  # bookshelf
    wd.item(31, 2, 'FA', 0, 89, 1, 2)                                  # drawers
    pp = plant(wd, 32, 2, 1)
    table(wd, 26, 4, 3, 2, 'dark')
    wd.set('furniture-above', 27, 4, MONITOR_OFF)
    wd.set('furniture-above', 26, 4, ('FA', 1, 119))
    wd.set('furniture-above', 28, 4, ('S3', 15, 5))                    # typewriter
    wd.set('furniture-above', 27, 5, ('S1', 0, 15))
    wd.set('furniture-above', 27, 6, ('S1', 3, 7))
    wd.spawn('desk-ceo', 27, 6)
    wd.monitored.append('desk-ceo')
    wd.item(30, 6, 'S2', 10, 5, 3, 2)                                  # sofa
    plant(wd, 22, 5, 3)
    wd.zone('principal', 22, 2, 11, 6)
    wd.errand('water', (32, 4), 'up', pp, god_only=True)
    wd.errand('smoke', (24, 2), 'up', (24, 1), god_only=True)

    # ---- teacher's room + library (x 22-32, y 10-20) --------------------------
    wd.fill('floor', 22, 10, 11, 11, PLANKS)
    rug(wd, 22, 15, 6, 5, 'beige')
    for sx in (25, 27, 29):
        wd.item(sx, 10, 'S3', 10, 4, 2, 3)                             # library shelves
    tp1 = plant(wd, 31, 10, 0)
    wd.item(32, 10, 'S2', 7, 2, 1, 2)                                  # wooden drawers
    wide_desk(wd, 28, 14, 'pc-6', 1)
    table(wd, 23, 16, 3, 2, 'light')                                   # reading table
    for cx in (23, 25):
        wd.set('furniture-above', cx, 15, ('FA', 4, 90))
        wd.set('furniture-above', cx, 18, ('FA', 4, 90))
    wd.set('furniture-above', 23, 16, ('S3', 12, 9))
    wd.set('furniture-above', 24, 16, ('FA', 0, 119))
    wd.set('furniture-above', 25, 17, ('S3', 12, 10))
    wd.item(32, 14, 'S2', 9, 3, 1, 3)                                  # reading armchair
    tp2 = plant(wd, 32, 19, 1)
    tb = bin_(wd, 31, 20)
    plant(wd, 22, 20, 3)
    wd.item(28, 18, 'FA', 3, 105, 2, 2)                                # piano
    wd.set('furniture-above', 28, 20, ('FA', 2, 94))                   # piano stool
    wd.zone('teacher', 22, 10, 11, 11)
    wd.errand('shelf', (26, 13), 'up', (26, 12))
    wd.errand('water', (31, 12), 'up', tp1)
    wd.errand('water', (32, 18), 'down', tp2)
    wd.errand('bin', (30, 20), 'right', tb)

    wd.anchors = dict(calendar=(6, 11), boards=(11, 1), clock=(1, 0), questions=(9, 1),
                      boardPin=(13, 2), boardTake=(15, 2), boardArchive=(17, 2))
    return wd


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------
def reach_set(wd):
    start = wd.spawns['entrance']
    seen = {start}
    q = deque([start])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in seen and wd.walkable(*n):
                seen.add(n); q.append(n)
    return seen


def check(wd):
    """Return a list of contract violations (empty = good)."""
    bad = []
    seen = reach_set(wd)
    nb = ((0, -1), (0, 1), (-1, 0), (1, 0))
    for name, (x, y) in wd.spawns.items():
        if (x, y) not in seen and not any((x + dx, y + dy) in seen for dx, dy in nb):
            bad.append(f'{name} unreachable')
        if name.startswith(('pc-', 'desk-', 'cafe-seat')) and not any(not wd.walkable(x + dx, y + dy) for dx, dy in nb):
            bad.append(f'{name} has no desk beside it')
    for name in wd.monitored:
        x, y = wd.spawns[name]
        if wd.layers['furniture-above'][y - 2][x] != MONITOR_OFF:
            bad.append(f'{name}: no monitor two rows above')
    stands = [('errand ' + e['kind'], e['stand']) for e in wd.errands]
    stands += [(k, v) for k, v in wd.coffee.items() if k.endswith('Stand')]
    stands += [(k, v) for k, v in wd.anchors.items() if k.startswith('board') and k != 'boards']
    for label, p in stands:
        if not wd.walkable(*p):
            bad.append(f'{label} stand {p} blocked')
        elif p not in seen:
            bad.append(f'{label} stand {p} unreachable')
    for k in ('trayTile', 'machineTile', 'sinkTile'):
        x, y = wd.coffee[k]
        if wd.walkable(x, y):
            bad.append(f'{k} {wd.coffee[k]} is not furniture')
    return bad


# ---------------------------------------------------------------------------
# packing / output
# ---------------------------------------------------------------------------
def pack(worlds, src):
    keys = set()
    for wd in worlds:
        for layer in LAYERS:
            for row in wd.layers[layer]:
                keys.update(k for k in row if k)
    keys.add(MONITOR_OFF)
    keys.add(MONITOR_ON)             # the lit monitor — only ever drawn as a runtime overlay
    ordered = sorted(keys, key=lambda k: (ORDER.index(k[0]), k[2], k[1]))
    sheets = {s: Image.open(os.path.join(src, f)).convert('RGBA') for s, f in SHEETS.items()}
    cols = 16
    cw = ART + 2 * PAD
    rows = (len(ordered) + cols - 1) // cols
    atlas = Image.new('RGBA', (cols * cw, rows * cw), (0, 0, 0, 0))
    gid = {}
    for i, key in enumerate(ordered):
        sheet, c, r = key
        tile = sheets[sheet].crop((c * ART, r * ART, (c + 1) * ART, (r + 1) * ART))
        # extrude 1px on every side by pasting a slightly larger edge-clamped copy
        big = Image.new('RGBA', (cw, cw))
        big.paste(tile, (PAD, PAD))
        big.paste(tile.crop((0, 0, ART, 1)).resize((ART, PAD)), (PAD, 0))
        big.paste(tile.crop((0, ART - 1, ART, ART)).resize((ART, PAD)), (PAD, PAD + ART))
        big.paste(big.crop((PAD, 0, PAD + 1, cw)).resize((PAD, cw)), (0, 0))
        big.paste(big.crop((PAD + ART - 1, 0, PAD + ART, cw)).resize((PAD, cw)), (PAD + ART, 0))
        atlas.paste(big, ((i % cols) * cw, (i // cols) * cw))
        gid[key] = i + 1
    return atlas, gid, cols, len(ordered)


def to_tmj(wd, gid, cols, count, atlas_size):
    def layer(name, data, lid):
        return {'id': lid, 'name': name, 'type': 'tilelayer', 'width': wd.w, 'height': wd.h,
                'x': 0, 'y': 0, 'opacity': 1, 'visible': True, 'data': data}
    layers = []
    for i, name in enumerate(LAYERS):
        data = [gid[k] if (k := wd.layers[name][y][x]) else 0 for y in range(wd.h) for x in range(wd.w)]
        layers.append(layer(name, data, i + 1))
    coll = [1 if wd.blocked[y][x] else 0 for y in range(wd.h) for x in range(wd.w)]
    layers.append(layer('collision', coll, 5))
    layers.append({'id': 6, 'name': 'spawn-points', 'type': 'objectgroup', 'x': 0, 'y': 0, 'opacity': 1, 'visible': True,
                   'objects': [{'id': 100 + i, 'name': n, 'type': '', 'x': x * CELL, 'y': y * CELL, 'width': 0, 'height': 0, 'rotation': 0, 'visible': True}
                               for i, (n, (x, y)) in enumerate(wd.spawns.items())]})
    layers.append({'id': 7, 'name': 'zones', 'type': 'objectgroup', 'x': 0, 'y': 0, 'opacity': 1, 'visible': True,
                   'objects': [{'id': 300 + i, 'name': n, 'type': '', 'x': x * CELL, 'y': y * CELL, 'width': w * CELL, 'height': h * CELL, 'rotation': 0, 'visible': True}
                               for i, (n, (x, y, w, h)) in enumerate(wd.zones.items())]})
    return {
        'compressionlevel': -1, 'height': wd.h, 'width': wd.w, 'infinite': False, 'orientation': 'orthogonal',
        'renderorder': 'right-down', 'tiledversion': '1.10.2', 'version': '1.10', 'type': 'map',
        'tilewidth': CELL, 'tileheight': CELL, 'nextlayerid': 8, 'nextobjectid': 500,
        'tilesets': [{
            'firstgid': 1, 'name': 'emakina-atlas', 'image': '../tilesets/emakina-atlas.png',
            'imagewidth': atlas_size[0], 'imageheight': atlas_size[1],
            'tilewidth': ART, 'tileheight': ART, 'margin': PAD, 'spacing': 2 * PAD,
            'columns': cols, 'tilecount': count,
        }],
        'layers': layers,
    }


def floor_meta(wd):
    pt = lambda p: {'x': p[0], 'y': p[1]}
    return {
        'width': wd.w, 'height': wd.h,
        'seats': [n for n in wd.spawns if n.startswith(('pc-', 'desk-'))],
        'coffee': {k: pt(v) for k, v in wd.coffee.items()},
        'anchors': {k: pt(v) for k, v in wd.anchors.items()},
        'errands': [{**e, 'stand': pt(e['stand']), 'fx': pt(e['fx'])} for e in wd.errands],
    }


def preview(wd, src, out, scale=1.0, marks=True):
    sheets = {s: Image.open(os.path.join(src, f)).convert('RGBA') for s, f in SHEETS.items()}
    img = Image.new('RGBA', (wd.w * ART, wd.h * ART), (30, 30, 40, 255))
    for layer in LAYERS:
        for y in range(wd.h):
            for x in range(wd.w):
                k = wd.layers[layer][y][x]
                if not k:
                    continue
                s, c, r = k
                t = sheets[s].crop((c * ART, r * ART, (c + 1) * ART, (r + 1) * ART))
                img.alpha_composite(t, (x * ART, y * ART))
    if marks:
        d = ImageDraw.Draw(img)
        for n, (x, y) in wd.spawns.items():
            d.rectangle([x * ART + 4, y * ART + 4, x * ART + 28, y * ART + 28], outline=(255, 0, 255), width=2)
            d.text((x * ART + 5, y * ART + 5), n[:6], fill=(255, 255, 0))
        for e in wd.errands:
            x, y = e['stand']
            d.ellipse([x * ART + 10, y * ART + 10, x * ART + 22, y * ART + 22], outline=(0, 255, 255), width=2)
        for y in range(wd.h):
            for x in range(wd.w):
                if wd.blocked[y][x]:
                    d.rectangle([x * ART + 14, y * ART + 14, x * ART + 18, y * ART + 18], fill=(255, 60, 60))
    if scale != 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    img.convert('RGB').save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='clone of EmakinaFR/office-map')
    ap.add_argument('--preview', help='write PNG previews with this prefix instead of building')
    ap.add_argument('--clean', action='store_true', help='previews without the debug marks')
    ap.add_argument('--only', choices=['office', 'school'])
    ap.add_argument('--scale', type=float, default=0.5)
    args = ap.parse_args()

    worlds = [('office', build_office()), ('school', build_school())]
    if args.only:
        worlds = [w for w in worlds if w[0] == args.only]

    failed = False
    for name, wd in worlds:
        bad = check(wd)
        print(f'{name}: {wd.w}x{wd.h}, {len(wd.spawns)} spawns, {len(wd.errands)} errands, problems: {bad or "none"}')
        failed |= bool(bad)
    if args.preview:
        for name, wd in worlds:
            preview(wd, args.src, f'{args.preview}-{name}.png', args.scale, marks=not args.clean)
            print('preview', f'{args.preview}-{name}.png')
        return
    if failed or args.only:
        sys.exit('refusing to write assets' + (' (--only)' if args.only else ''))

    atlas, gid, cols, count = pack([w for _n, w in worlds], args.src)
    os.makedirs(os.path.join(ASSETS, 'tilesets'), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, 'maps'), exist_ok=True)
    atlas.save(os.path.join(ASSETS, 'tilesets', 'emakina-atlas.png'), optimize=True)
    meta = {'monitorOff': gid[MONITOR_OFF], 'monitorOn': gid[MONITOR_ON]}
    for name, wd in worlds:
        file = {'office': 'office-modern.tmj', 'school': 'staffroom-modern.tmj'}[name]
        with open(os.path.join(ASSETS, 'maps', file), 'w', encoding='utf8') as f:
            json.dump(to_tmj(wd, gid, cols, count, atlas.size), f, separators=(',', ':'))
        meta[name] = floor_meta(wd)
    with open(os.path.join(ASSETS, 'maps', 'emakina.meta.json'), 'w', encoding='utf8') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    print(f'atlas {atlas.size}, {count} tiles; wrote maps + meta')


if __name__ == '__main__':
    main()
