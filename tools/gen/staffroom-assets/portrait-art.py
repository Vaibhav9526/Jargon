from pathlib import Path
import hashlib
import json
import runpy
from PIL import Image, ImageChops, ImageDraw

BASE = Path(__file__).resolve().parent
ART = runpy.run_path(str(BASE / 'redesign-art.py'))
CAST = ART['CAST']
INK = ART['INK']
PAPER = '#faf0d6'
NAMES = ['teacher', 'topper', 'smartguy', 'librarian', 'vice-principal']
EXPRESSIONS = ['neutral', 'smug', 'annoyed', 'eye-roll', 'excited', 'thinking', 'shocked', 'laughing']


def shade(color, amount):
    values = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    return tuple(max(0, min(255, round(v * amount))) for v in values)


def poly(d, points, fill, outline=INK):
    d.polygon(points, fill=fill)
    d.line(points + [points[0]], fill=outline, width=1)


def bust(name):
    skin, hair, outfit, accent, style = CAST[name]
    image = Image.new('RGBA', (64, 64))
    d = ImageDraw.Draw(image)
    hair_light = shade(hair, 1.22)
    skin_dark = shade(skin, .85)
    cloth_dark = shade(outfit, .78)
    if style == 'pigtails':
        poly(d, [(14, 16), (20, 17), (21, 29), (19, 42), (14, 45), (11, 40), (11, 24)], hair)
        poly(d, [(44, 17), (50, 16), (53, 24), (53, 40), (50, 45), (45, 42), (43, 29)], hair)
        d.line((14, 24, 14, 38), fill=hair_light)
        d.line((50, 24, 50, 38), fill=hair_light)
        poly(d, [(11, 20), (14, 18), (17, 21), (20, 18), (22, 20), (19, 24), (14, 24)], accent)
        poly(d, [(42, 20), (45, 18), (48, 21), (51, 18), (53, 20), (50, 24), (45, 24)], accent)
    elif style == 'bun':
        poly(d, [(39, 2), (47, 2), (51, 6), (51, 11), (47, 15), (40, 14), (37, 9)], hair)
        d.line((41, 4, 46, 4), fill=hair_light)
        d.line((46, 5, 49, 8), fill=hair_light)
        d.rectangle((39, 11, 48, 12), fill=accent)
    elif style == 'knot':
        poly(d, [(15, 3), (23, 3), (27, 7), (26, 13), (21, 17), (15, 13), (12, 8)], hair)
        d.line((16, 5, 22, 5), fill=hair_light)
        d.line((15, 7, 15, 10), fill=hair_light)
    poly(d, [(25, 35), (39, 35), (39, 43), (43, 47), (32, 51), (21, 47), (25, 43)], skin)
    d.rectangle((26, 37, 38, 40), fill=skin_dark)
    poly(d, [(23, 42), (26, 44), (38, 44), (41, 42), (50, 45), (56, 51), (58, 59), (6, 59), (8, 51), (14, 45)], outfit)
    d.polygon([(9, 52), (13, 48), (14, 58), (7, 58)], fill=cloth_dark)
    d.polygon([(51, 48), (55, 52), (57, 58), (50, 58)], fill=cloth_dark)
    d.line((15, 51, 15, 58), fill=INK)
    d.line((49, 51, 49, 58), fill=INK)
    if name == 'smartguy':
        poly(d, [(22, 42), (27, 45), (37, 45), (42, 42), (45, 46), (40, 50), (24, 50), (19, 46)], cloth_dark)
        d.line([(23, 43), (28, 46), (36, 46), (41, 43)], fill=accent, width=2)
        d.line((24, 48, 24, 54), fill=accent)
        d.line((40, 48, 40, 54), fill=accent)
        d.rectangle((23, 55, 41, 57), outline=INK)
        d.point((24, 54), fill=INK)
        d.point((40, 54), fill=INK)
    elif name == 'topper':
        poly(d, [(23, 42), (31, 46), (28, 51), (20, 45)], accent)
        poly(d, [(41, 42), (33, 46), (36, 51), (44, 45)], accent)
        poly(d, [(31, 47), (33, 47), (35, 53), (32, 55), (29, 53)], '#ba715a')
        poly(d, [(41, 52), (45, 52), (45, 56), (43, 57), (41, 55)], accent)
        d.point((43, 54), fill=outfit)
    else:
        poly(d, [(25, 43), (31, 46), (39, 43), (40, 58), (24, 58)], accent)
        d.line((31, 48, 31, 58), fill=cloth_dark)
        poly(d, [(23, 42), (29, 46), (26, 50), (22, 47), (20, 50)], outfit)
        poly(d, [(41, 42), (35, 46), (38, 50), (42, 47), (44, 50)], outfit)
        for y in (51, 56):
            d.point((33, y), fill=INK)
        if name == 'teacher':
            d.rectangle((43, 50, 47, 54), outline=cloth_dark)
            d.line((44, 50, 46, 50), fill=accent)
        elif name == 'librarian':
            d.line((20, 52, 20, 58), fill=cloth_dark)
            d.line((44, 52, 44, 58), fill=cloth_dark)
    if style == 'messy':
        poly(d, [(15, 18), (16, 11), (21, 11), (20, 7), (27, 9), (31, 5), (35, 9), (43, 6), (44, 11), (49, 12), (48, 20), (45, 34), (40, 38), (24, 38), (18, 34)], hair)
    else:
        poly(d, [(21, 8), (40, 8), (46, 13), (48, 23), (47, 33), (43, 38), (38, 41), (26, 41), (20, 38), (16, 32), (16, 18)], hair)
    poly(d, [(17, 23), (20, 22), (21, 30), (18, 30), (16, 27)], skin)
    poly(d, [(44, 22), (47, 23), (48, 27), (46, 30), (43, 30)], skin)
    d.point((18, 26), fill=skin_dark)
    d.point((46, 26), fill=skin_dark)
    poly(d, [(21, 14), (41, 14), (44, 18), (44, 31), (41, 36), (37, 39), (27, 39), (23, 36), (20, 31), (20, 18)], skin)
    d.line((42, 21, 42, 30), fill=skin_dark)
    d.line((40, 34, 37, 37), fill=skin_dark)
    d.line((23, 34, 26, 37), fill=skin_dark)
    d.line((32, 27, 31, 29), fill=skin_dark)
    d.line((31, 29, 33, 29), fill=skin_dark)
    if style == 'messy':
        d.polygon([(17, 16), (18, 12), (24, 10), (27, 12), (31, 9), (35, 12), (42, 9), (46, 14), (45, 19), (40, 18), (39, 15), (34, 18), (29, 15), (25, 18), (23, 15), (20, 19)], fill=hair)
        d.line((22, 12, 26, 12), fill=hair_light)
        d.line((32, 12, 36, 13), fill=hair_light)
    elif style == 'pigtails':
        d.polygon([(18, 19), (19, 14), (23, 10), (39, 10), (45, 14), (46, 20), (41, 18), (36, 15), (34, 17), (28, 15), (25, 18), (21, 19)], fill=hair)
        d.line((23, 12, 30, 12), fill=hair_light)
        d.line((35, 12, 40, 13), fill=hair_light)
        d.rectangle((41, 15, 43, 17), fill=accent)
    elif style == 'bob':
        d.polygon([(18, 22), (18, 16), (23, 10), (39, 10), (44, 15), (46, 22), (41, 20), (36, 15), (28, 16), (22, 21)], fill=hair)
        d.rectangle((17, 23, 19, 35), fill=hair)
        d.rectangle((45, 23, 47, 35), fill=hair)
        d.line((23, 12, 34, 12), fill=hair_light)
    else:
        d.polygon([(17, 23), (18, 16), (23, 10), (39, 10), (45, 15), (46, 23), (42, 20), (35, 15), (30, 14), (25, 18), (21, 21)], fill=hair)
        d.line((23, 12, 30, 12), fill=hair_light)
        d.line((35, 12, 40, 14), fill=hair_light)
        d.line((18, 24, 18, 30), fill=hair_light)
    return image


def eye(d, x, y=22, offset=2, tall=5):
    poly(d, [(x, y + 1), (x + 1, y), (x + 6, y), (x + 7, y + 1), (x + 7, y + tall - 2), (x + 5, y + tall - 1), (x + 1, y + tall - 1), (x, y + tall - 2)], PAPER)
    d.rectangle((x + offset, y + 1, x + offset + 1, y + tall - 2), fill=INK)


def face(base, name, expression):
    image = base.copy()
    d = ImageDraw.Draw(image)
    girl = name == 'topper'
    skin = CAST[name][0]
    blush = shade(skin, .91)
    if expression == 'neutral':
        eye(d, 22)
        eye(d, 35)
        d.line((22, 19, 28, 19), fill=INK)
        d.line((35, 19, 41, 19), fill=INK)
        d.line([(27, 33), (30, 34), (34, 34), (37, 32)], fill=INK)
    elif expression == 'smug':
        eye(d, 22, 23, 4, 4)
        eye(d, 35, 23, 3, 4)
        d.line((21, 18, 28, 19), fill=INK)
        d.line((35, 21, 42, 20), fill=INK)
        d.line((22, 23, 29, 23), fill=INK, width=2 if girl else 1)
        d.line((35, 23, 42, 23), fill=INK, width=2 if girl else 1)
        d.line([(26, 33), (29, 35), (34, 35), (38, 31 if girl else 32)], fill=INK)
        d.line((29, 34, 34, 34), fill=PAPER)
    elif expression == 'annoyed':
        eye(d, 22, 23, 2, 4)
        eye(d, 35, 23, 2, 4)
        d.line((21, 18 if girl else 19, 29, 21), fill=INK, width=2 if girl else 1)
        d.line((35, 21, 43, 18 if girl else 19), fill=INK, width=2 if girl else 1)
        d.line((22, 23, 29, 23), fill=INK)
        d.line((35, 23, 42, 23), fill=INK)
        d.line([(27, 35), (30, 33), (34, 33), (37, 35)], fill=INK)
    elif expression == 'eye-roll':
        eye(d, 22, 22, 4, 6)
        eye(d, 35, 22, 4, 6)
        d.rectangle((23, 24, 28, 26), fill=PAPER)
        d.rectangle((36, 24, 41, 26), fill=PAPER)
        d.rectangle((26, 22, 27, 23), fill=INK)
        d.rectangle((39, 22, 40, 23), fill=INK)
        d.line((21, 19, 28, 18), fill=INK)
        d.line((35, 18, 42, 19), fill=INK)
        d.line([(27, 35), (32, 35), (35, 34), (38, 34)], fill=INK)
    elif expression == 'excited':
        eye(d, 22, 21, 3, 7)
        eye(d, 35, 21, 3, 7)
        d.point((25, 22), fill=PAPER)
        d.point((38, 22), fill=PAPER)
        d.line([(21, 19), (24, 18), (28, 19)], fill=INK)
        d.line([(35, 19), (39, 18), (42, 19)], fill=INK)
        poly(d, [(26, 31), (38, 31), (36, 35), (34, 37), (30, 37), (28, 35)], INK)
        d.rectangle((28, 32, 36, 33), fill=PAPER)
        d.line((30, 36, 34, 36), fill=blush)
        d.line((21, 29, 24, 29), fill=blush)
        d.line((40, 29, 43, 29), fill=blush)
    elif expression == 'thinking':
        eye(d, 22, 22, 4, 5)
        eye(d, 35, 22, 4, 5)
        d.line((21, 19, 28, 18), fill=INK)
        d.line((35, 20, 42, 21), fill=INK)
        d.line([(29, 34), (32, 34), (34, 33), (36, 33)], fill=INK)
        d.point((36, 34), fill=blush)
    elif expression == 'shocked':
        eye(d, 21, 20, 3, 8)
        eye(d, 35, 20, 3, 8)
        d.line((22, 18, 28, 18), fill=INK)
        d.line((35, 18, 41, 18), fill=INK)
        poly(d, [(30, 30), (34, 30), (36, 32), (36, 35), (34, 37), (30, 37), (28, 35), (28, 32)], INK)
        d.line((30, 31, 34, 31), fill=PAPER)
        d.line((31, 36, 34, 36), fill=blush)
    elif expression == 'laughing':
        d.line([(21, 25), (24, 22), (26, 22), (29, 25)], fill=INK, width=2 if girl else 1)
        d.line([(35, 25), (38, 22), (40, 22), (43, 25)], fill=INK, width=2 if girl else 1)
        d.line([(21, 19), (25, 18), (29, 19)], fill=INK)
        d.line([(35, 19), (39, 18), (43, 19)], fill=INK)
        poly(d, [(25, 31), (39, 31), (38, 35), (35, 38), (29, 38), (26, 35)], INK)
        d.rectangle((27, 32, 37, 33), fill=PAPER)
        d.line((30, 37, 34, 37), fill=blush)
        d.line((21, 28, 24, 28), fill=blush)
        d.line((40, 28, 43, 28), fill=blush)
    else:
        raise ValueError(expression)
    if girl and expression not in ('laughing', 'shocked'):
        d.point((21, 22), fill=INK)
        d.point((43, 22), fill=INK)
    if name in ('librarian', 'vice-principal'):
        d.rectangle((20, 21, 30, 28), outline=INK, width=1)
        d.rectangle((34, 21, 44, 28), outline=INK, width=1)
        d.line((30, 23, 34, 23), fill=INK)
        d.line((19, 23, 20, 23), fill=INK)
        d.line((44, 23, 45, 23), fill=INK)
    return image


def save_portrait(image, relative, records):
    path = BASE / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    output = image.resize((512, 512), Image.Resampling.NEAREST)
    output.save(path)
    with Image.open(path) as decoded:
        assert decoded.size == (512, 512) and decoded.mode == 'RGBA'
        assert decoded.getextrema()[3] == (0, 255)
        assert decoded.getpixel((0, 0))[3] == decoded.getpixel((511, 511))[3] == 0
    records.append({'file': relative, 'size': [512, 512], 'mode': 'RGBA', 'alpha': 'binary transparency',
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})


def contact_sheet(images, columns, path):
    cw, ch = 272, 292
    rows = (len(images) + columns - 1) // columns
    sheet = Image.new('RGB', (columns * cw, rows * ch), PAPER)
    d = ImageDraw.Draw(sheet)
    for i, (label, im) in enumerate(images):
        x, y = i % columns * cw, i // columns * ch
        for yy in range(24, 280, 16):
            for xx in range(8, 264, 16):
                if (xx // 16 + yy // 16) % 2:
                    d.rectangle((x + xx, y + yy, x + xx + 15, y + yy + 15), fill='#e2dbc7')
        thumb = im.resize((256, 256), Image.Resampling.NEAREST)
        sheet.paste(thumb, (x + 8, y + 24), thumb)
        d.text((x + 8, y + 6), label.upper(), fill=INK)
    sheet.save(BASE / path)


def main():
    records = []
    portraits = []
    for name in NAMES:
        base = bust(name)
        neutral = face(base, name, 'neutral')
        save_portrait(neutral, f'id-cards/{name}.png', records)
        portraits.append((name, neutral))
        if name not in ('topper', 'smartguy'):
            continue
        variants = []
        for expression in EXPRESSIONS:
            im = face(base, name, expression)
            assert im.getchannel('A').tobytes() == neutral.getchannel('A').tobytes()
            diff = ImageChops.difference(im.convert('RGB'), neutral.convert('RGB')).getbbox()
            if diff:
                assert diff[0] >= 20 and diff[1] >= 18 and diff[2] <= 44 and diff[3] <= 39, (name, expression, diff)
            save_portrait(im, f'expressions/{name}/{expression}.png', records)
            variants.append((expression, im))
        assert len({im.tobytes() for _, im in variants}) == 8
        contact_sheet(variants, 4, f'qa/{name}-expressions.png')
    contact_sheet(portraits, 5, 'qa/id-card-portraits.png')
    report = {'nativeGrid': [64, 64], 'exportSize': [512, 512], 'resampling': 'nearest-neighbor 8x',
              'paletteSource': 'redesign-art.py school cast', 'expressionOrder': EXPRESSIONS,
              'poseChecks': 'expression alpha masks identical; changed pixels restricted to face rectangle',
              'runtimeIntegration': 'new art only; no production source edits', 'files': records}
    (BASE / 'portrait-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'portraits': len(NAMES), 'expressionPNGs': 16, 'totalTransparentPNGs': len(records),
                      'size': [512, 512], 'expressionPoseChecks': 'passed'}))


if __name__ == '__main__':
    main()
