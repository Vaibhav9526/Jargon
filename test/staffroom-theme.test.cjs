'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const loadTs = require('./load-ts.cjs');
const { readHireManifestFiles } = loadTs('src/main/hire.ts');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const registryPath = 'src/renderer/src/scene/office/themeRegistry.ts';

function loadWithImports(file, imports) {
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output)(module, module.exports, imports);
  return module.exports;
}

const { STAFFROOM_THEME, OFFICE_THEME } = loadWithImports(registryPath, (request) => {
  if (request === './cast') return loadTs('src/renderer/src/scene/office/cast.ts');
  if (request === '@/design/tokens') return loadTs('src/renderer/src/design/tokens.ts');
  if (request.startsWith('@/assets/')) {
    const file = `src/renderer/src/${request.slice(2).split('?')[0]}`;
    if (request.endsWith('.json')) return { default: readJson(file), ...readJson(file) };   // generated tileset metadata
    return request.endsWith('?raw') ? readFileSync(file, 'utf8') : file;
  }
  throw new Error(`Unexpected theme import: ${request}`);
});
const map = JSON.parse(STAFFROOM_THEME.mapRaw);
const atlas = readJson('tools/gen/staffroom-assets/school-atlas.json');
const layer = (name) => map.layers.find((l) => l.name === name);
const firstgid = STAFFROOM_THEME.tilesets[0].firstgid;
const tileGid = (name) => firstgid + atlas.props[name].gid;

function reachableTiles() {
  const entrance = layer('spawn-points').objects.find((s) => s.name === 'entrance');
  const start = Math.floor(entrance.y / 16) * map.width + Math.floor(entrance.x / 16);
  const reached = new Set([start]);
  const queue = [start];
  const collision = layer('collision').data;
  for (const index of queue) {
    const x = index % map.width;
    const y = Math.floor(index / map.width);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const next = ny * map.width + nx;
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height || collision[next] || reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

test('school gallery does not offer a second leadership role', () => {
  const index = readJson('docs/hires/manifests/index.json');
  assert.ok(!index.includes('principal-school.hire.json'));
  const result = readHireManifestFiles(index.map((file) => `docs/hires/manifests/${file}`));
  assert.deepEqual(result.errors, []);
  assert.ok(!result.manifests.some((m) => m.name === 'Vice Principal'));
});

test('school ships one cohesive atlas with no borrowed Office furniture', () => {
  assert.equal(map.width, 40);
  assert.equal(map.height, 28);
  assert.equal(STAFFROOM_THEME.tilesets.length, 1);
  assert.equal(map.tilesets.length, 1);
  assert.equal(map.tilesets[0].tilecount, atlas.tilecount);
  assert.equal(STAFFROOM_THEME.tilesets[0].imageheight, atlas.imageheight);
  assert.equal(STAFFROOM_THEME.tilesets[0].tilecount, atlas.tilecount);
  const png = readFileSync('src/renderer/src/assets/tilesets/school-props.png');
  assert.equal(png.readUInt32BE(16), atlas.imagewidth);
  assert.equal(png.readUInt32BE(20), atlas.imageheight);
  const used = new Set(Object.values(atlas.props).flatMap((p) => {
    const gids = [];
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) gids.push(firstgid + p.gid + y * atlas.columns + x);
    return gids;
  }));
  for (const l of map.layers.filter((l) => l.type === 'tilelayer' && l.name !== 'collision')) {
    for (const gid of l.data) assert.ok(gid === 0 || used.has(gid), `${l.name} contains painted atlas art, not an empty slot`);
  }
});

test('runtime anchors, errands, coffee and monitor data match authored map metadata', () => {
  assert.deepEqual(STAFFROOM_THEME.anchors, atlas.layout.anchors);
  assert.deepEqual(STAFFROOM_THEME.coffee, atlas.layout.coffee);
  assert.deepEqual(STAFFROOM_THEME.errandSpots, atlas.layout.errandSpots);
  assert.deepEqual(STAFFROOM_THEME.monitor, atlas.layout.monitor);
});

test('every school seat, coffee station, errand and board stand is reachable', () => {
  const reached = reachableTiles();
  const checks = layer('spawn-points').objects.map((s) => [s.name, { x: Math.floor(s.x / 16), y: Math.floor(s.y / 16) }]);
  checks.push(...Object.entries(STAFFROOM_THEME.anchors.boardStands));
  for (const name of ['trayStand', 'machineStand', 'sinkStand']) checks.push([name, STAFFROOM_THEME.coffee[name]]);
  checks.push(...STAFFROOM_THEME.errandSpots.map((e) => [e.kind, e.stand]));
  assert.equal(new Set(checks.map(([, t]) => `${t.x},${t.y}`)).size, checks.length, 'independent interaction spots do not stack agents');
  for (const [name, { x, y }] of checks) assert.ok(reached.has(y * map.width + x), `${name} at ${x},${y} is reachable`);
});

test('school boards occupy a clear north-wall notice area', () => {
  for (const [name, width] of [['boards', 7], ['questions', 2]]) {
    const anchor = STAFFROOM_THEME.anchors[name];
    for (let y = anchor.y - 1; y <= anchor.y + 1; y++) {
      for (let x = anchor.x; x < anchor.x + width; x++) {
        for (const name of ['furniture-below', 'furniture-above']) assert.equal(layer(name).data[y * map.width + x], 0);
      }
    }
  }
});

test('school signs, materials, cafes and desk overlays obey the live scene contract', () => {
  for (const name of ['floor-study', 'floor-lounge', 'floor-office']) assert.ok(layer('floor').data.includes(tileGid(name)));
  for (const name of ['sign-study', 'sign-meeting', 'sign-lounge', 'sign-principal', 'sign-library', 'sign-teacher']) {
    const gid = tileGid(name);
    const start = layer('furniture-above').data.indexOf(gid);
    const width = atlas.props[name].w;
    assert.ok(start >= 0, `${name} is present`);
    assert.deepEqual(layer('furniture-above').data.slice(start, start + width), Array.from({ length: width }, (_, i) => gid + i));
  }
  const spawns = layer('spawn-points').objects;
  for (const name of STAFFROOM_THEME.primarySeatNames) {
    const seat = spawns.find((s) => s.name === name);
    const x = Math.floor(seat.x / 16), y = Math.floor(seat.y / 16);
    assert.equal(layer('furniture-above').data[(y - 2) * map.width + x], STAFFROOM_THEME.monitor.offTopLeftGid);
    assert.notEqual(layer('collision').data[(y - 1) * map.width + x], 0);
  }
  for (let i = 0; i < 4; i += 2) {
    const a = spawns.find((s) => s.name === STAFFROOM_THEME.cafeSeatNames[i]);
    const b = spawns.find((s) => s.name === STAFFROOM_THEME.cafeSeatNames[i + 1]);
    assert.equal(a.x, b.x);
    assert.equal(Math.abs(a.y - b.y), 32);
  }
  assert.deepEqual(Object.keys(STAFFROOM_THEME.cast.byName), ['principal', 'teacher', 'topper', 'smartguy', 'librarian']);
  assert.equal(Object.keys(OFFICE_THEME.cast.byName).length, 16);
});

test('school hiring and editing use the selected cast without another Principal picker', () => {
  const add = readFileSync('src/renderer/src/components/AddAgentModal.tsx', 'utf8');
  const edit = readFileSync('src/renderer/src/components/EditAgentModal.tsx', 'utf8');
  assert.match(add, /castForTheme\(officeTheme\)/);
  assert.match(add, /defaultCharacterForTheme\(officeTheme\)/);
  assert.match(add, /member\.name !== 'principal'/);
  assert.match(edit, /castForTheme\(officeTheme\)/);
  assert.doesNotMatch(add + edit, /OFFICE_CAST\.map/);
});

test('school break-room dialogue does not reference the Office leader or cast', () => {
  const { pickSoloLine, pickExchange } = loadTs('src/renderer/src/scene/office/cafeteriaLines.ts');
  for (const character of Object.keys(STAFFROOM_THEME.cast.byName)) {
    for (let seed = 0; seed < 60; seed++) {
      for (const spot of ['coffee', 'vending', 'snack', 'table']) {
        assert.doesNotMatch(pickSoloLine(character, spot, seed), /Michael|Dwight|Schrute|Dunder|that's what she said/i);
      }
      assert.doesNotMatch(pickExchange(character, seed).join(' '), /Michael|Dwight|Schrute|Dunder|that's what she said/i);
    }
  }
  assert.match(pickSoloLine('michael', 'table', 0), /BANKRUPTCY/);
});

test('orchestrator status never consumes its name-row width', () => {
  const card = readFileSync('src/renderer/src/components/AgentCard.tsx', 'utf8');
  const identity = card.slice(card.indexOf('{/* Identity row:'), card.indexOf('{/* Context line:'));
  assert.match(identity, /!isGod && <PixelBadge/);
  assert.match(card, /isGod && <PixelBadge/);
});

test('school screen animation remains inside the new one-tile monitor', () => {
  class Container { children = []; addChild(child) { this.children.push(child); } }
  class Graphics {
    rects = [];
    clear() { this.rects = []; }
    rect(x, y, w, h) { this.rects.push({ x, y, w, h }); return this; }
    fill() { return this; }
  }
  class Sprite {}
  const { DeskScreen } = loadWithImports('src/renderer/src/scene/office/DeskScreen.ts', () => ({ Container, Graphics, Sprite }));
  const screen = new DeskScreen({ tileSize: 16, textureForGid: () => ({}) }, { x: 0, y: 0 }, STAFFROOM_THEME.monitor);
  const interior = STAFFROOM_THEME.monitor.screenRect;
  screen.setOn(true);
  for (let i = 0; i < 100; i++) {
    screen.update(0.08);
    for (const rect of screen.container.children.at(-1).rects) {
      assert.ok(rect.x >= interior.x && rect.y >= interior.y);
      assert.ok(rect.x + rect.w <= interior.x + interior.w);
      assert.ok(rect.y + rect.h <= interior.y + interior.h);
    }
  }
  const floor = readFileSync('src/renderer/src/scene/office/OfficeFloor.tsx', 'utf8');
  assert.match(floor, /theme\.coffee\.machineTile/);
  assert.doesNotMatch(floor, /machineG\.position\.set\(26 \* ts0, 17 \* ts0\)/);
});
