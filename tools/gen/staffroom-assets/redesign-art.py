from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]
INK = '#303d3b'
PAPER = '#faf0d6'
CREAM = '#e7d8b8'
OAK = '#ca9762'
LIGHT = '#ebc18a'
DARK = '#8f6648'
MOSS = '#4b7164'
SAGE = '#91ad8c'
CORAL = '#bd725b'
SKY = '#9bc8c1'


def panel(d, box, fill, edge=INK):
    d.rectangle(box, fill=fill, outline=edge)


def grain(d, w, y, color=DARK):
    for x in range(5, w - 8, 14):
        d.line((x, y, x + 7, y), fill=color)


def paint(name, image, fallback, glyph, text_width):
    w, h = image.size
    d = ImageDraw.Draw(image)
    if name.startswith('floor-'):
        colors = {'floor-a': ('#e7dfc9', '#ded5bc'), 'floor-b': ('#e5ddc7', '#ded5bc'),
                  'floor-study': ('#cbd5bc', '#c2ceb2'), 'floor-lounge': (MOSS, '#628574'),
                  'floor-office': (OAK, '#ad7e53'), 'floor-entry': (CORAL, '#d49472')}
        fill, line = colors[name]
        d.rectangle((0, 0, 15, 15), fill=fill)
        if name == 'floor-office':
            d.line((0, 7, 15, 7), fill=line)
            d.line((0, 15, 15, 15), fill=line)
            d.line((6, 0, 6, 6), fill=line)
            d.line((13, 8, 13, 14), fill=line)
            d.line((8, 2, 13, 2), fill=LIGHT)
            d.line((2, 10, 9, 10), fill=LIGHT)
        elif name in ('floor-lounge', 'floor-entry'):
            for x, y in ((2, 3), (11, 7), (5, 13)):
                d.point((x, y), fill=line)
        else:
            d.line((0, 15, 15, 15), fill=line)
            d.line((15, 0, 15, 15), fill=line)
            d.point((4, 5), fill='#eee6d0' if name != 'floor-study' else '#dbe2ca')
    elif name == 'wall':
        d.rectangle((0, 0, w - 1, h - 1), fill=CREAM)
        d.rectangle((0, 0, w - 1, 2), fill=PAPER)
        d.line((0, 3, w - 1, 3), fill='#c9b996')
        d.rectangle((0, 22, w - 1, 30), fill=MOSS)
        d.line((0, 21, w - 1, 21), fill=LIGHT)
        d.line((0, 24, w - 1, 24), fill='#628574')
        d.line((0, 31, w - 1, 31), fill=INK)
    elif name == 'wall-side':
        d.rectangle((0, 0, 15, 15), fill=DARK)
        d.rectangle((2, 0, 11, 15), fill=CREAM)
        d.line((3, 0, 3, 15), fill=PAPER)
        d.line((12, 0, 12, 15), fill=INK)
    elif name.startswith('partition'):
        if name.endswith('side'):
            panel(d, (3, 0, 12, 15), DARK)
            d.rectangle((5, 0, 9, 15), fill=OAK)
            d.line((5, 0, 5, 15), fill=LIGHT)
        else:
            panel(d, (0, 1, 15, 14), DARK)
            panel(d, (2, 2, 13, 10), '#c6d8bc', MOSS)
            d.line((3, 3, 12, 3), fill=PAPER)
            d.line((3, 8, 6, 5), fill='#e2ebd6')
            d.rectangle((1, 12, 14, 13), fill=OAK)
    elif name == 'window':
        panel(d, (0, 0, w - 1, h - 1), DARK)
        panel(d, (2, 2, w - 3, h - 5), SKY, MOSS)
        d.rectangle((3, 3, w - 4, 10), fill='#d5e5d2')
        for x, y in ((5, 9), (22, 7), (43, 10)):
            d.polygon([(x, 21), (x + 3, y), (x + 8, y - 3), (x + 13, y + 2), (x + 17, 21)], fill=SAGE)
            d.rectangle((x + 8, y + 5, x + 9, 23), fill='#779582')
        d.rectangle((3, 24, w - 4, 26), fill=MOSS)
        d.rectangle((w // 2 - 1, 2, w // 2 + 1, h - 5), fill=PAPER)
        d.line((3, 14, w - 4, 14), fill=PAPER, width=2)
        d.polygon([(2, 2), (7, 2), (5, 22), (2, 25)], fill=CORAL)
        d.polygon([(w - 8, 2), (w - 3, 2), (w - 3, 25), (w - 6, 22)], fill=CORAL)
        d.rectangle((0, h - 4, w - 1, h - 2), fill=OAK)
        d.line((0, h - 4, w - 1, h - 4), fill=LIGHT)
    elif name.startswith('sign-'):
        labels = {'study': 'STUDY HALL', 'principal': 'PRINCIPAL', 'meeting': 'FACULTY',
                  'lounge': 'STAFF LOUNGE', 'library': 'LIBRARY', 'teacher': 'TEACHER'}
        label = labels[name[5:]]
        panel(d, (1, 2, w - 2, h - 2), DARK)
        panel(d, (3, 3, w - 4, h - 4), PAPER, OAK)
        glyph(d, label, (w - text_width(label)) // 2, 5, MOSS)
        d.point((5, 7), fill=CORAL)
        d.point((w - 6, 7), fill=CORAL)
    elif name.startswith('desk-'):
        panel(d, (2, 9, w - 3, h - 3), DARK)
        panel(d, (1, 5, w - 2, 20), OAK)
        d.line((3, 6, w - 4, 6), fill=LIGHT)
        grain(d, w, 8, '#dba66d')
        d.line((2, 20, w - 3, 20), fill=DARK)
        for x in (4, w - 19):
            panel(d, (x, 22, x + 14, h - 5), OAK, DARK)
            d.line((x + 5, 24, x + 9, 24), fill=LIGHT)
        panel(d, (18, 16, 31, 19), '#d9dfcb', MOSS)
        for x in range(20, 30, 3):
            d.point((x, 17), fill=SAGE)
        panel(d, (37, 10, 49, 17), PAPER, DARK)
        d.line((39, 12, 46, 12), fill=SAGE)
        d.line((39, 14, 44, 14), fill=SAGE)
        d.rectangle((52, 13, 57, 17), fill=MOSS)
        d.arc((53, 13, 60, 17), 260, 100, fill=MOSS)
        if name == 'desk-teacher':
            d.ellipse((47, 19, 53, 25), fill=CORAL, outline=DARK)
            d.line((50, 19, 51, 17), fill=MOSS)
        if name == 'desk-principal':
            panel(d, (w - 23, 18, w - 5, 24), MOSS)
            d.line((w - 20, 21, w - 8, 21), fill=LIGHT)
            panel(d, (4, 9, 12, 16), CORAL, DARK)
            d.line((7, 10, 7, 15), fill=PAPER)
    elif name in ('chair', 'chair-office'):
        cloth = CORAL if name == 'chair' else MOSS
        panel(d, (3, 1, 12, 6), cloth)
        d.line((5, 2, 10, 2), fill=LIGHT if name == 'chair' else SAGE)
        panel(d, (2, 8, 13, 12), cloth)
        d.line((4, 9, 11, 9), fill=LIGHT if name == 'chair' else SAGE)
        d.line((4, 13, 4, 15), fill=DARK)
        d.line((11, 13, 11, 15), fill=DARK)
    elif name == 'table-meeting':
        d.rectangle((5, h - 10, 9, h - 1), fill=DARK)
        d.rectangle((w - 10, h - 10, w - 6, h - 1), fill=DARK)
        panel(d, (2, 3, w - 3, h - 5), DARK)
        panel(d, (2, 1, w - 3, h - 9), OAK)
        d.rectangle((4, 3, w - 5, h - 12), outline=LIGHT)
        grain(d, w, 8, '#b68153')
        grain(d, w, h - 16, '#b68153')
        for x, y in ((12, 12), (w - 24, 22)):
            panel(d, (x, y, x + 12, y + 8), PAPER, DARK)
            d.line((x + 3, y + 3, x + 9, y + 3), fill=SAGE)
            d.rectangle((x + 15, y + 1, x + 19, y + 5), fill=CORAL)
        d.rectangle((w // 2 - 3, 20, w // 2 + 3, 25), fill=CORAL)
        d.line((w // 2, 14, w // 2, 21), fill=MOSS)
        d.ellipse((w // 2 - 4, 11, w // 2 + 3, 17), fill=SAGE)
    elif name == 'bookshelf':
        panel(d, (1, 0, w - 2, h - 2), DARK)
        d.rectangle((3, 2, w - 4, h - 4), fill='#5a5242')
        colors = [CORAL, SAGE, LIGHT, SKY, PAPER]
        for y in (3, 17):
            for i, x in enumerate(range(5, w - 6, 5)):
                bh = 8 + i % 4
                d.rectangle((x, y + 11 - bh, x + 2, y + 10), fill=colors[i % 5])
                d.point((x + 1, y + 7), fill=DARK)
            d.rectangle((3, y + 12, w - 4, y + 14), fill=OAK)
            d.line((3, y + 12, w - 4, y + 12), fill=LIGHT)
        d.line((2, 2, 2, h - 3), fill=LIGHT)
    elif name == 'plant-big':
        d.line((8, 5, 8, 24), fill=DARK, width=2)
        for box, color in (((3, 0, 12, 9), MOSS), ((0, 6, 8, 15), SAGE), ((7, 7, 15, 17), MOSS), ((2, 13, 12, 20), '#779667')):
            d.ellipse(box, fill=color)
        for x, y in ((5, 3), (3, 9), (11, 10), (6, 16)):
            d.line((x, y, x + 2, y), fill='#a8bb83')
        panel(d, (3, 23, 12, 29), CORAL, DARK)
        panel(d, (2, 21, 13, 23), '#d79770', DARK)
        d.line((4, 24, 4, 27), fill=LIGHT)
        d.line((3, 30, 12, 30), fill=INK)
    elif name == 'couch':
        panel(d, (1, 2, w - 2, h - 3), MOSS)
        d.rectangle((3, 3, w - 4, 7), fill=SAGE)
        d.line((4, 3, w - 5, 3), fill='#c1cfab')
        d.rectangle((4, 8, w - 5, h - 4), fill='#729782')
        d.line((w // 2, 8, w // 2, h - 4), fill=MOSS)
        panel(d, (1, 5, 4, h - 3), MOSS)
        panel(d, (w - 5, 5, w - 2, h - 3), MOSS)
        d.rectangle((7, 5, 13, 9), fill=CORAL)
        d.rectangle((w - 14, 5, w - 8, 9), fill=LIGHT)
        d.point((5, h - 2), fill=DARK)
        d.point((w - 6, h - 2), fill=DARK)
    elif name == 'coffee-table':
        panel(d, (1, 3, w - 2, 12), DARK)
        d.rectangle((2, 3, w - 3, 10), fill=OAK)
        d.line((3, 4, w - 4, 4), fill=LIGHT)
        panel(d, (8, 5, 18, 9), PAPER, MOSS)
        d.line((13, 5, 13, 9), fill=SAGE)
        d.rectangle((22, 5, 25, 8), fill=CORAL)
    elif name == 'counter':
        panel(d, (0, 7, w - 1, h - 1), DARK)
        d.rectangle((1, 8, w - 2, 13), fill=PAPER)
        d.line((1, 13, w - 2, 13), fill=OAK)
        for x in range(2, w - 12, 16):
            panel(d, (x, 15, x + 13, h - 3), MOSS, '#35544d')
            d.line((x + 2, 16, x + 10, 16), fill='#628574')
            d.line((x + 8, 18, x + 10, 18), fill=LIGHT)
    elif name == 'reception':
        panel(d, (1, 4, w - 2, h - 2), DARK)
        d.rectangle((2, 5, w - 3, 12), fill=OAK)
        d.line((3, 5, w - 4, 5), fill=LIGHT)
        for x in range(6, w - 12, 18):
            panel(d, (x, 15, x + 13, h - 5), OAK, DARK)
            d.line((x + 1, 16, x + 12, 16), fill=LIGHT)
        panel(d, (w // 2 - 24, 6, w // 2 + 24, 16), MOSS)
        glyph(d, 'WELCOME', w // 2 - text_width('WELCOME') // 2, 8, PAPER)
        panel(d, (9, 7, 22, 10), PAPER, DARK)
        d.ellipse((w - 21, 6, w - 13, 12), fill=CORAL, outline=DARK)
        d.line((w - 17, 5, w - 16, 3), fill=MOSS)
    elif name == 'chalkboard':
        panel(d, (0, 0, w - 1, h - 1), DARK)
        panel(d, (2, 2, w - 3, h - 5), MOSS, INK)
        glyph(d, 'LEARN AND BUILD', 6, 6, PAPER)
        d.line((7, 17, 34, 17), fill=SAGE)
        d.line((7, 20, 27, 20), fill=SAGE)
        d.line((7, 23, 31, 23), fill=SAGE)
        d.rectangle((58, 17, 72, 24), outline=CREAM)
        d.line((65, 17, 65, 24), fill=CREAM)
        d.line((76, 18, 85, 18), fill=SAGE)
        d.line((76, 22, 82, 22), fill=SAGE)
        d.rectangle((2, h - 4, w - 3, h - 2), fill=OAK)
        d.line((8, h - 3, 16, h - 3), fill=PAPER)
    else:
        palette = {'#343a35': INK, '#f4edd7': CREAM, '#fff8e6': PAPER, '#a5774c': OAK,
                   '#c89e67': LIGHT, '#76563d': DARK, '#466458': MOSS, '#7f9d80': SAGE,
                   '#d9b569': LIGHT, '#6896a9': SKY, '#a85c56': CORAL}
        converted = {tuple(bytes.fromhex(k[1:])): tuple(bytes.fromhex(v[1:])) for k, v in palette.items()}
        pixels = [fallback.getpixel((x, y)) for y in range(h) for x in range(w)]
        image.putdata([(*converted.get(p[:3], p[:3]), p[3]) for p in pixels])
    return image


CAST = {
    'principal': ('#c79570', '#bdc4b4', '#344c63', '#dfb16c', 'silver'),
    'teacher': ('#d7a078', '#654338', '#ba715a', '#f5e6c5', 'bun'),
    'topper': ('#ba825c', '#443a36', '#497766', '#ebbf72', 'pigtails'),
    'smartguy': ('#edbb94', '#624633', '#6f9caa', '#eee0bb', 'messy'),
    'librarian': ('#d5a18a', '#acae99', '#7d617d', '#f3e6cb', 'knot'),
    'vice-principal': ('#bf8d69', '#4c3e37', '#9e875b', '#f0dfb9', 'bob'),
}


def character(name, back=False, step=0):
    skin, hair, outfit, accent, style = CAST[name]
    image = Image.new('RGBA', (18, 32))
    d = ImageDraw.Draw(image)
    if style == 'pigtails':
        for box in ((1, 6, 4, 19), (14, 6, 16, 19)):
            panel(d, box, hair)
        d.point((2, 8), fill=accent)
        d.point((15, 8), fill=accent)
    elif style == 'bun':
        panel(d, (10, 0, 14, 4), hair)
        d.point((12, 1), fill=accent)
    elif style == 'knot':
        panel(d, (3, 0, 7, 4), hair)
    if style == 'messy':
        d.polygon([(2, 7), (3, 4), (5, 4), (4, 2), (7, 3), (9, 1), (10, 3), (13, 2), (13, 4), (15, 4), (14, 8)], fill=INK)
    else:
        d.polygon([(3, 7), (3, 4), (5, 2), (12, 2), (14, 4), (14, 13), (12, 16), (5, 16), (3, 13)], fill=INK)
    d.rectangle((4, 5, 13, 12), fill=hair if back else skin)
    d.rectangle((5, 12, 12, 14), fill=hair if back else skin)
    d.rectangle((6, 15, 11, 16), fill=skin)
    d.rectangle((4, 3, 12, 6), fill=hair)
    d.point((3, 6), fill=hair)
    d.point((13, 6), fill=hair)
    if style == 'messy':
        d.polygon([(4, 5), (5, 3), (8, 4), (9, 2), (11, 4), (13, 3), (13, 6), (10, 7), (7, 5), (5, 7)], fill=hair)
    elif style == 'silver':
        d.rectangle((6, 5, 11, 7), fill=skin if not back else hair)
        d.point((3, 7), fill=hair)
        d.point((14, 7), fill=hair)
    elif style in ('bob', 'knot', 'bun'):
        d.rectangle((3, 7, 4, 13), fill=hair)
        if style == 'bob':
            d.rectangle((13, 7, 14, 15), fill=hair)
            d.rectangle((3, 13, 4, 15), fill=hair)
    if not back:
        if name in ('librarian', 'vice-principal'):
            d.rectangle((4, 8, 7, 10), outline=INK)
            d.rectangle((10, 8, 13, 10), outline=INK)
            d.line((7, 9, 10, 9), fill=INK)
        else:
            d.point((6, 9), fill=INK)
            d.point((11, 9), fill=INK)
        if name == 'principal':
            d.line((5, 8, 7, 8), fill=INK)
            d.line((10, 8, 12, 8), fill=INK)
        d.line((7, 13, 10, 13), fill=INK)
        if name in ('teacher', 'smartguy'):
            d.point((11, 12), fill=INK)
    else:
        if style == 'bun':
            panel(d, (10, 5, 14, 9), hair)
        elif style == 'knot':
            panel(d, (5, 8, 10, 13), hair)
        d.line((5, 4, 11, 4), fill=hair)
    panel(d, (4, 17, 13, 26), outfit)
    d.rectangle((3, 19, 4, 24), fill=outfit)
    d.rectangle((13, 19, 14, 24), fill=outfit)
    d.rectangle((3, 24, 4, 25), fill=skin)
    d.rectangle((13, 24, 14, 25), fill=skin)
    if not back:
        if name == 'principal':
            d.polygon([(6, 17), (11, 17), (9, 20), (8, 20)], fill=accent)
            d.rectangle((8, 19, 9, 23), fill=accent)
            d.point((11, 22), fill=accent)
        elif name == 'smartguy':
            d.line((6, 18, 6, 20), fill=accent)
            d.line((11, 18, 11, 20), fill=accent)
            d.line((6, 23, 11, 23), fill=INK)
        elif name == 'teacher':
            d.rectangle((6, 17, 11, 19), fill=accent)
            d.rectangle((8, 20, 9, 25), fill=accent)
            d.point((11, 23), fill=accent)
        elif name == 'topper':
            d.polygon([(6, 17), (11, 17), (9, 20), (8, 20)], fill=accent)
            d.point((12, 22), fill=accent)
        else:
            d.rectangle((7, 17, 10, 24), fill=accent)
            d.point((8, 21), fill=outfit)
    elif name == 'smartguy':
        d.line((5, 18, 6, 20), fill=accent)
        d.line((6, 20, 11, 20), fill=accent)
        d.line((11, 20, 12, 18), fill=accent)
    elif name == 'librarian':
        d.rectangle((6, 17, 11, 18), fill=accent)
    d.rectangle((5, 27, 7, 29), fill=INK)
    d.rectangle((10, 27, 12, 29), fill=INK)
    if step == 1:
        d.rectangle((4, 29, 7, 30), fill=INK)
        d.rectangle((10, 28, 13, 29), fill=INK)
        d.point((3, 24), fill=outfit)
        d.point((14, 25), fill=outfit)
    elif step == 2:
        d.rectangle((4, 28, 7, 29), fill=INK)
        d.rectangle((10, 29, 13, 30), fill=INK)
        d.point((3, 25), fill=outfit)
        d.point((14, 24), fill=outfit)
    else:
        d.rectangle((4, 30, 7, 30), fill=INK)
        d.rectangle((10, 30, 13, 30), fill=INK)
    return image


def draw_cast():
    scale, cw, ch = 6, 128, 220
    sheet = Image.new('RGB', (cw * 7, ch * len(CAST)), PAPER)
    d = ImageDraw.Draw(sheet)
    sprite_manifest = {}
    for row, name in enumerate(CAST):
        portrait = character(name).crop((0, 0, 18, 28))
        frames = [character(name, back, step) for back in (False, True) for step in (0, 1, 2)]
        assert len({im.tobytes() for im in frames}) == 6
        assert all(im.crop((0, 0, 18, 17)).tobytes() == portrait.crop((0, 0, 18, 17)).tobytes() for im in frames[:3])
        pixels = [portrait.getpixel((x, y)) for y in range(28) for x in range(18)]
        colors = {p for p in pixels if p[3]}
        assert portrait.size == (18, 28)
        assert all(im.size == (18, 32) and im.getextrema()[3] == (0, 255) for im in frames)
        assert len(colors) <= 5, (name, colors)
        portrait.save(BASE / 'sprites' / f'{name}-redesigned-portrait.png')
        walk = Image.new('RGBA', (108, 32))
        for col, im in enumerate(frames):
            walk.alpha_composite(im, (col * 18, 0))
        walk.save(BASE / 'sprites' / f'{name}-redesigned-walk.png')
        for col, im in enumerate([portrait, *frames]):
            bg = '#e6dbc1' if col < 4 else '#c2d1b6'
            d.rectangle((col * cw, row * ch, (col + 1) * cw - 1, (row + 1) * ch - 1), fill=bg)
            sheet.paste(im.resize((18 * scale, im.height * scale), Image.Resampling.NEAREST), (col * cw + 10, row * ch + 20), im.resize((18 * scale, im.height * scale), Image.Resampling.NEAREST))
        d.text((8, row * ch + 3), name.upper(), fill=INK)
        sprite_manifest[name] = {'portrait': f'sprites/{name}-redesigned-portrait.png', 'walk': f'sprites/{name}-redesigned-walk.png',
                                 'portraitSize': [18, 28], 'sheetSize': [108, 32], 'frameSize': [18, 32],
                                 'frames': ['front-idle', 'front-left', 'front-right', 'back-idle', 'back-left', 'back-right'],
                                 'optionalArtOnly': name == 'vice-principal', 'opaqueColors': len(colors)}
    silhouettes = [character(name).getchannel('A').tobytes() for name in CAST]
    assert len(set(silhouettes)) == len(CAST)
    sheet.save(BASE / 'sprites/school-redesigned-contact-sheet.png')
    return sprite_manifest


def main():
    import runpy
    protected = sorted((ROOT / 'src').rglob('*'))
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected if p.is_file()}
    with tempfile.TemporaryDirectory(prefix='redesign-build-', dir=BASE) as temporary:
        sandbox = Path(temporary)
        for directory in ('tools', 'src/renderer/src/assets/tilesets', 'src/renderer/src/assets/maps', 'tools/gen/staffroom-assets/qa'):
            (sandbox / directory).mkdir(parents=True, exist_ok=True)
        builder = sandbox / 'tools/build-school-world.py'
        shutil.copyfile(ROOT / 'tools/build-school-world.py', builder)
        subprocess.run([sys.executable, 'tools/build-school-world.py'], cwd=sandbox, check=True)
        env = runpy.run_path(str(builder))
        metadata = json.loads((sandbox / 'tools/gen/staffroom-assets/school-atlas.json').read_text(encoding='utf-8'))
        map_data = json.loads((sandbox / 'src/renderer/src/assets/maps/staffroom.tmj').read_text(encoding='utf-8'))
        atlas = Image.open(sandbox / 'src/renderer/src/assets/tilesets/school-props.png').convert('RGBA')
        for name, p in metadata['props'].items():
            box = (p['x'] * 16, p['y'] * 16, (p['x'] + p['w']) * 16, (p['y'] + p['h']) * 16)
            original = atlas.crop(box)
            image = paint(name, Image.new('RGBA', original.size), original, env['text'], env['text_width'])
            atlas.paste(image, box[:2])
            image.save(BASE / 'props' / f'{name}-redesigned.png')
        atlas.save(BASE / 'school-props-redesigned.png')
        metadata['image'] = 'school-props-redesigned.png'
        map_data['tilesets'][0]['image'] = 'school-props-redesigned.png'
        (BASE / 'school-atlas-redesigned.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
        (BASE / 'staffroom-redesigned.tmj').write_text(json.dumps(map_data, separators=(',', ':')), encoding='utf-8')
        preview = Image.new('RGBA', (640, 448), INK)
        for layer in map_data['layers']:
            if layer['name'] not in ('floor', 'walls', 'furniture-below', 'furniture-above'):
                continue
            for i, gid in enumerate(layer['data']):
                if gid:
                    local = gid - map_data['tilesets'][0]['firstgid']
                    x, y = local % 16 * 16, local // 16 * 16
                    preview.alpha_composite(atlas.crop((x, y, x + 16, y + 16)), (i % 40 * 16, i // 40 * 16))
        preview.save(BASE / 'qa/staffroom-redesigned-native.png')
        preview.resize((1280, 896), Image.Resampling.NEAREST).save(BASE / 'qa/staffroom-redesigned.png')
        for name, box in {'faculty': (16, 64, 192, 208), 'principal': (480, 64, 624, 224),
                          'study': (192, 96, 464, 320), 'lounge': (16, 208, 192, 432)}.items():
            crop = preview.crop(box)
            crop.resize((crop.width * 4, crop.height * 4), Image.Resampling.NEAREST).save(BASE / 'qa' / f'{name}-redesigned.png')
        sprites = draw_cast()
        after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / 'src').rglob('*') if p.is_file()}
        differences = sorted(p for p in set(before) | set(after) if before.get(p) != after.get(p))
        report = {'builder': 'python tools/build-school-world.py (isolated copy; production source untouched)',
                  'props': len(metadata['props']), 'mapTiles': [40, 28], 'atlasSize': [256, 512],
                  'reachability': len(env['checks']), 'collisionAndAnchors': 'unchanged from the canonical builder',
                  'sprites': sprites, 'productionSourceChangedDuringGeneration': differences,
                  'runtimeIntegration': 'candidate art only; production PNGs and procedural character recipes are not changed'}
        (BASE / 'redesign-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'props': report['props'], 'reachablePoints': report['reachability'], 'cast': list(sprites), 'sourceChangesDuringGeneration': differences}))


if __name__ == '__main__':
    main()
