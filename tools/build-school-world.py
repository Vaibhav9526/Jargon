from pathlib import Path
import hashlib
import json
import re
import shutil
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src/renderer/src/assets'
ART = ROOT / 'tools/gen/staffroom-assets'
MANIFEST = ART / 'school-atlas.json'
BACKUP = ART / 'backup-original'
TILE = 16
COLS = 16
ROWS = 32
FIRST = 2449
W, H = 40, 28
CHARACTERS = ['principal', 'teacher', 'topper', 'smartguy', 'librarian']
FRAME_NAMES = ['front-idle', 'front-left', 'front-right', 'back-idle', 'back-left', 'back-right']
source_metadata = json.loads((ART / 'school-atlas-redesigned.json').read_text(encoding='utf-8'))
source_props = source_metadata['props']
for name in source_props:
    if not re.fullmatch(r'[a-z]+(?:-[a-z]+)*', name):
        raise ValueError(f'Invalid school prop name: {name}')
prop_out = OUT / 'tilesets/school-props'
sprite_out = OUT / 'sprites/school'
outputs = [OUT / 'tilesets/school-props.png', OUT / 'maps/staffroom.tmj', MANIFEST,
           ART / 'qa/school-world.png', sprite_out / 'manifest.json']
outputs += [prop_out / f'{name}.png' for name in source_props]
outputs += [sprite_out / f'{name}-{kind}.png' for name in CHARACTERS for kind in ['portrait', 'walk']]


def backup_originals():
    backups = []
    for path in outputs:
        if not path.exists():
            continue
        relative = path.relative_to(ROOT)
        destination = BACKUP / relative
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
        backups.append({'asset': relative.as_posix(),
                        'backup': destination.relative_to(ROOT).as_posix(),
                        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
    return backups


if '--backup-only' in sys.argv:
    backups = backup_originals()
    print(json.dumps({'backedUpExistingOutputs': len(backups), 'backups': backups}, indent=2))
    sys.exit(0)

atlas_image = Image.new('RGBA', (COLS * TILE, ROWS * TILE))
props = {}
prop_images = {}
pack_x = pack_y = row_height = 0


def register(name, tw, th):
    global pack_x, pack_y, row_height
    if not isinstance(tw, int) or not isinstance(th, int) or not (0 < tw <= COLS and 0 < th <= ROWS):
        raise ValueError(f'Invalid school prop footprint: {name}')
    if pack_x + tw > COLS:
        pack_y += row_height
        pack_x = row_height = 0
    if pack_y + th > ROWS:
        raise ValueError('School atlas capacity exceeded')
    with Image.open(ART / 'props' / f'{name}-redesigned.png') as source:
        if source.mode != 'RGBA' or source.size != (tw * TILE, th * TILE):
            raise ValueError(f'Incorrect school prop format or dimensions: {name}')
        image = source.copy()
    atlas_image.paste(image, (pack_x * TILE, pack_y * TILE))
    prop_images[name] = image
    props[name] = {'gid': pack_y * COLS + pack_x, 'x': pack_x, 'y': pack_y, 'w': tw, 'h': th}
    pack_x += tw
    row_height = max(row_height, th)


for name, source in source_props.items():
    register(name, source['w'], source['h'])
if props != source_props:
    raise ValueError('Approved school atlas packing changed; review runtime GIDs before rebuilding')

sprite_images = {}
sprite_manifest = {'frameSize': [18, 32], 'portraitSize': [18, 28], 'sheetSize': [108, 32],
                   'frames': FRAME_NAMES, 'characters': {}}
for name in CHARACTERS:
    pair = {}
    for kind, dimensions in [('portrait', (18, 28)), ('walk', (108, 32))]:
        with Image.open(ART / 'sprites' / f'{name}-redesigned-{kind}.png') as source:
            if source.mode != 'RGBA' or source.size != dimensions:
                raise ValueError(f'Incorrect school sprite format or dimensions: {name} {kind}')
            pair[kind] = source.copy()
    frames = [pair['walk'].crop((i * 18, 0, (i + 1) * 18, 32)) for i in range(6)]
    if len({frame.tobytes() for frame in frames}) != 6:
        raise ValueError(f'School walk views must be distinct: {name}')
    if any(frame.getextrema()[3] != (0, 255) for frame in frames):
        raise ValueError(f'School walk frames must retain opaque art and transparency: {name}')
    head = pair['portrait'].crop((0, 0, 18, 17)).tobytes()
    if any(frame.crop((0, 0, 18, 17)).tobytes() != head for frame in frames[:3]):
        raise ValueError(f'School portrait and front sprite heads disagree: {name}')
    sprite_images[name] = pair
    sprite_manifest['characters'][name] = {'portrait': f'{name}-portrait.png', 'walk': f'{name}-walk.png'}

layers = {name:[0]*(W*H) for name in ['floor','walls','furniture-below','furniture-above','collision']}


def cell(layer,x,y,gid):
    if not (0<=x<W and 0<=y<H):
        raise ValueError(f'Out of bounds {layer} {x},{y}')
    layers[layer][y*W+x]=gid


def stamp(name,x,y,layer='furniture-below',collision=True):
    p=props[name]
    for dy in range(p['h']):
        for dx in range(p['w']):
            cell(layer,x+dx,y+dy,FIRST+p['gid']+dy*COLS+dx)
            if collision:
                cell('collision',x+dx,y+dy,1)


def fill(name,x,y,w,h):
    for dy in range(h):
        for dx in range(w):
            cell('floor',x+dx,y+dy,FIRST+props[name]['gid'])


for y in range(H):
    for x in range(W):
        name='floor-b' if (x*7+y*13)%11==0 else 'floor-a'
        cell('floor',x,y,FIRST+props[name]['gid'])
fill('floor-office',2,5,9,7)
fill('floor-office',31,5,8,8)
fill('floor-study',13,9,16,10)
fill('floor-office',30,17,9,9)
fill('floor-lounge',1,19,10,7)
fill('floor-entry',16,24,7,3)
for x in range(W):
    stamp('wall',x,0,'walls')
    stamp('partition',x,H-1,'walls')
for y in range(2,H):
    stamp('wall-side',0,y,'walls')
    stamp('wall-side',W-1,y,'walls')
for x in (4,9,14,19,34):
    stamp('window',x,0,'walls')
stamp('school-crest',1,0,'walls')
for x in range(1,12):
    stamp('partition',x,4,'walls')
    stamp('partition',x,12,'walls')
for y in range(5,12):
    if y not in (8,9):
        stamp('partition-side',11,y,'walls')
for x in range(30,39):
    stamp('partition',x,4,'walls')
    stamp('partition',x,13,'walls')
for y in range(5,13):
    if y not in (11,12):
        stamp('partition-side',30,y,'walls')
for x in range(30,39):
    stamp('partition',x,16,'walls')
for y in range(17,25):
    if y not in (20,21):
        stamp('partition-side',29,y,'walls')

stamp('sign-meeting',3,4,'furniture-above',False)
stamp('sign-principal',32,4,'furniture-above',False)
stamp('sign-library',3,13,'furniture-above',False)
stamp('sign-lounge',3,18,'furniture-above',False)
stamp('sign-teacher',32,16,'furniture-above',False)
stamp('sign-study',18,8,'furniture-above',False)
stamp('table-meeting',4,7)
meeting_seats=[(5,6),(7,6),(3,8),(9,8),(5,10),(7,10)]
for x,y in meeting_seats:
    stamp('chair',x,y,collision=False)
stamp('plant-big',2,5)
stamp('plant-big',9,10)
stamp('counter',13,3)
stamp('coffee-machine',14,3,'furniture-above')
stamp('sink',20,3,'furniture-above')
stamp('water-cooler',23,3)
stamp('plant-big',27,3)
stamp('chalkboard',16,6,'walls')
stamp('bookshelf',1,14)
stamp('bookshelf',6,14)
stamp('lockers',1,16)
for x,y in [(2,20),(7,20),(2,22),(7,22)]:
    stamp('couch',x,y)
stamp('coffee-table',3,21)
stamp('coffee-table',7,21)
stamp('bookshelf',1,24)
stamp('vending',9,24)
stamp('plant-big',10,16)
stamp('desk-principal',33,8)
stamp('monitor-off',34,8,'furniture-above')
stamp('chair-office',34,10,collision=False)
stamp('bookshelf',31,5)
stamp('plant-big',37,5)
stamp('printer',32,11)
stamp('plant-big',37,11)
stamp('desk-teacher',32,18)
stamp('monitor-off',33,18,'furniture-above')
stamp('chair-office',33,20,collision=False)
stamp('bookshelf',35,23)
stamp('plant-big',37,18)
stamp('printer',31,24)
stamp('bin',37,25)
stamp('reception',16,22)
stamp('plant-big',14,23)
stamp('plant-big',24,23)
stamp('bin',12,25)
stamp('door',19,27,'walls',False)
for x in (19,20):
    cell('collision',x,27,0)
for x,y in [(14,10),(20,10),(26,10),(14,15),(20,15)]:
    stamp('desk-pc',x,y)
    stamp('monitor-off',x+1,y,'furniture-above')
    stamp('chair-office',x+1,y+2,collision=False)
stamp('plant-big',25,16)

spawns=[]
zones=[]


def point(name,x,y):
    cell('collision',x,y,0)
    spawns.append({'id':len(spawns)+1,'name':name,'point':True,'x':x*16+8,'y':y*16+8,'width':0,'height':0,'rotation':0,'type':'','visible':True})


point('desk-ceo',34,10)
for i,(x,y) in enumerate([(15,12),(21,12),(27,12),(15,17),(21,17),(33,20)],1):
    point(f'pc-{i}',x,y)
for i,(x,y) in enumerate([(3,20),(3,22),(8,20),(8,22)],1):
    point(f'cafe-seat-{i}',x,y)
point('cafe-stand-coffee',16,5)
point('cafe-stand-vending',8,25)
point('entrance',19,26)
for name,x,y,w,h in [('boardroom',2,5,9,7),('cafeteria',1,19,10,7),('principal',31,5,8,8),('teacher',30,17,9,9)]:
    zones.append({'id':len(spawns)+len(zones)+1,'name':name,'x':x*16,'y':y*16,'width':w*16,'height':h*16,'rotation':0,'type':'','visible':True})

anchors={
    'calendar':{'x':23,'y':0}, 'clock':{'x':3,'y':0},
    'boards':{'x':24,'y':1}, 'questions':{'x':31,'y':1},
    'boardStands':{'pin':{'x':25,'y':2},'take':{'x':27,'y':2},'archive':{'x':29,'y':2}},
}
coffee={'trayTile':{'x':17,'y':3},'trayStand':{'x':17,'y':5},'machineStand':{'x':14,'y':5},'machineTile':{'x':14,'y':3},'sinkTile':{'x':20,'y':3},'sinkStand':{'x':20,'y':5},'maxCups':4}
errands=[
    {'kind':'water','stand':{'x':26,'y':4},'facing':'right','fx':{'x':27,'y':4},'duration':4.5},
    {'kind':'water','stand':{'x':9,'y':9},'facing':'down','fx':{'x':9,'y':11},'duration':4.5},
    {'kind':'water','stand':{'x':11,'y':17},'facing':'left','fx':{'x':10,'y':17},'duration':4.5},
    {'kind':'water','stand':{'x':36,'y':6},'facing':'right','fx':{'x':37,'y':6},'duration':4.5,'godOnly':True},
    {'kind':'window','stand':{'x':6,'y':2},'facing':'up','fx':{'x':6,'y':1},'duration':5},
    {'kind':'window','stand':{'x':11,'y':2},'facing':'up','fx':{'x':11,'y':1},'duration':5},
    {'kind':'dispenser','stand':{'x':23,'y':5},'facing':'up','fx':{'x':23,'y':4},'duration':3.5},
    {'kind':'fridge','stand':{'x':8,'y':24},'facing':'right','fx':{'x':9,'y':25},'duration':3.2},
    {'kind':'shelf','stand':{'x':5,'y':15},'facing':'right','fx':{'x':6,'y':15},'duration':4},
    {'kind':'bin','stand':{'x':12,'y':24},'facing':'down','fx':{'x':12,'y':25},'duration':2.6},
    {'kind':'bin','stand':{'x':36,'y':25},'facing':'right','fx':{'x':37,'y':25},'duration':2.6},
]

collision=layers['collision']
entrance=spawns[-1]
start=(int(entrance['x']//16),int(entrance['y']//16))
reached={start}
queue=[start]
for x,y in queue:
    for nx,ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
        if 0<=nx<W and 0<=ny<H and not collision[ny*W+nx] and (nx,ny) not in reached:
            reached.add((nx,ny))
            queue.append((nx,ny))
checks=[(s['name'],int(s['x']//16),int(s['y']//16)) for s in spawns]
checks += [(name,t['x'],t['y']) for name,t in anchors['boardStands'].items()]
checks += [(name,coffee[name]['x'],coffee[name]['y']) for name in ['trayStand','machineStand','sinkStand']]
checks += [(e['kind'],e['stand']['x'],e['stand']['y']) for e in errands]
runtime_checks=list(checks)
checks += [(f'faculty-chair-{i}',x,y) for i,(x,y) in enumerate(meeting_seats,1)]
if len({(x,y) for _,x,y in checks}) != len(checks):
    raise ValueError('Independent school seats and interaction points overlap')
for name,x,y in checks:
    if (x,y) not in reached:
        raise ValueError(f'Unreachable {name} at {x},{y}')

map_layers=[]
for i,(name,data) in enumerate(layers.items(),1):
    map_layers.append({'id':i,'name':name,'type':'tilelayer','data':data,'width':W,'height':H,'x':0,'y':0,'opacity':1,'visible':True})
for i,(name,objects) in enumerate([('spawn-points',spawns),('zones',zones)],6):
    map_layers.append({'id':i,'name':name,'type':'objectgroup','objects':objects,'x':0,'y':0,'opacity':1,'visible':True,'draworder':'topdown'})
map_data={'compressionlevel':-1,'infinite':False,'orientation':'orthogonal','renderorder':'right-down','width':W,'height':H,'tilewidth':16,'tileheight':16,'nextlayerid':8,'nextobjectid':len(spawns)+len(zones)+1,'version':'1.10','tiledversion':'1.10.2','type':'map','tilesets':[{'firstgid':FIRST,'columns':COLS,'image':'../tilesets/school-props.png','imageheight':ROWS*16,'imagewidth':COLS*16,'margin':0,'name':'school-props','spacing':0,'tilecount':COLS*ROWS,'tileheight':16,'tilewidth':16}],'layers':map_layers}
metadata={'image':'school-props.png','tilewidth':16,'tileheight':16,'columns':COLS,'tilecount':COLS*ROWS,'imagewidth':COLS*16,'imageheight':ROWS*16,'props':props,'layout':{'anchors':anchors,'coffee':coffee,'errandSpots':errands,'monitor':{'offTopLeftGid':FIRST+props['monitor-off']['gid'],'onGids':[[FIRST+props['monitor-on']['gid'],0,0]],'screenRect':{'x':3,'y':3,'w':10,'h':6}}}}


def counts(world, manifest):
    spawn_points=next(layer['objects'] for layer in world['layers'] if layer['name']=='spawn-points')
    seats=[s for s in spawn_points if s['name']=='desk-ceo' or s['name'].startswith(('pc-','cafe-seat-'))]
    furniture=next(layer['data'] for layer in world['layers'] if layer['name']=='furniture-below')
    faculty=furniture.count(world['tilesets'][0]['firstgid']+manifest['props']['chair']['gid'])
    layout=manifest['layout']
    return {'workerSeats':sum(s['name'].startswith('pc-') for s in seats),
            'principalSeats':sum(s['name']=='desk-ceo' for s in seats),
            'loungeSeats':sum(s['name'].startswith('cafe-seat-') for s in seats),
            'runtimeSeats':len(seats),'facultyChairs':faculty,'allSeats':len(seats)+faculty,
            'runtimeInteractionPoints':len(spawn_points)+len(layout['anchors']['boardStands'])+3+len(layout['errandSpots'])}


before_map=json.loads((OUT/'maps/staffroom.tmj').read_text(encoding='utf-8')) if (OUT/'maps/staffroom.tmj').exists() else None
before_metadata=json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else None
before_counts=counts(before_map,before_metadata) if before_map and before_metadata else None
after_counts=counts(map_data,metadata)
backups=backup_originals()
for path in outputs:
    path.parent.mkdir(parents=True,exist_ok=True)
atlas_image.save(OUT/'tilesets/school-props.png')
MANIFEST.write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
(OUT/'maps/staffroom.tmj').write_text(json.dumps(map_data,separators=(',',':')),encoding='utf-8')
for name,image in prop_images.items():
    image.save(prop_out/f'{name}.png')
for name,pair in sprite_images.items():
    for kind,image in pair.items():
        image.save(sprite_out/f'{name}-{kind}.png')
(sprite_out/'manifest.json').write_text(json.dumps(sprite_manifest,indent=2)+'\n',encoding='utf-8')
preview=Image.new('RGBA',(W*16,H*16),'#27372f')
for name in ['floor','walls','furniture-below','furniture-above']:
    for i,gid in enumerate(layers[name]):
        if gid:
            local=gid-FIRST
            tile=atlas_image.crop(((local%COLS)*16,(local//COLS)*16,(local%COLS+1)*16,(local//COLS+1)*16))
            preview.alpha_composite(tile,((i%W)*16,(i//W)*16))
preview.resize((W*32,H*32),Image.Resampling.NEAREST).save(ART/'qa/school-world.png')
report={'before':before_counts,'after':after_counts,'validatedReachablePoints':len(checks),
        'runtimeChecks':len(runtime_checks),'additionalFacultySeatChecks':len(meeting_seats),
        'layoutUnchanged':before_map==map_data if before_map else None,
        'metadataUnchanged':before_metadata==metadata if before_metadata else None,
        'props':len(props),'schoolSprites':CHARACTERS,'backups':backups,
        'spriteRuntimeStatus':'PNG sheets emitted; cast.ts still uses procedural sceneFrameBufs; lead must wire PNG loading',
        'outputSha256':{path.relative_to(ROOT).as_posix():hashlib.sha256(path.read_bytes()).hexdigest() for path in outputs}}
(ART/'production-integration.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(f'Created {len(props)} redesigned school props, {W}x{H} map, {len(sprite_images)} sprite sets, {len(checks)} reachable points ({len(runtime_checks)} runtime points + {len(meeting_seats)} faculty chairs).')
print(json.dumps({'before':before_counts,'after':after_counts,'layoutUnchanged':report['layoutUnchanged'],'backedUpExistingOutputs':len(backups)}))
