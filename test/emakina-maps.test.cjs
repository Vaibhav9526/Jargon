'use strict';

// The "modern" tileset maps (tools/build-emakina-world.py) must satisfy the same
// engine contract as the classic floors: required spawn points and zones,
// monitors where the engine looks for them, walkable stand tiles, and every seat
// reachable from the entrance. Everything layout-bound (coffee tiles, anchors,
// errand spots) comes from the generated emakina.meta.json, never from
// hand-written coordinates in the registry.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS = path.join(__dirname, '../src/renderer/src/assets');
const meta = JSON.parse(fs.readFileSync(path.join(ASSETS, 'maps/emakina.meta.json'), 'utf8'));
const registrySrc = fs.readFileSync(path.join(__dirname, '../src/renderer/src/scene/office/themeRegistry.ts'), 'utf8');

const LAYERS = ['floor', 'walls', 'furniture-below', 'furniture-above', 'collision', 'spawn-points', 'zones'];
const OFFICE_SEATS = ['desk-ceo', 'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5', 'pc-6', 'desk-chief-architect', 'desk-product-manager',
  'desk-team-lead', 'desk-backend-engineer', 'desk-ui-ux-expert', 'desk-data-engineer', 'desk-project-manager',
  'desk-market-researcher', 'desk-agent-organizer'];
const SCHOOL_SEATS = ['desk-ceo', 'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5', 'pc-6'];
const COMMON = ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4', 'cafe-stand-coffee', 'cafe-stand-vending', 'entrance'];
const ERRAND_KINDS = ['water', 'window', 'dispenser', 'fridge', 'shelf', 'bin', 'smoke'];
const FACINGS = ['up', 'down', 'left', 'right'];
const NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];

function load(file) {
  const m = JSON.parse(fs.readFileSync(path.join(ASSETS, 'maps', file), 'utf8'));
  const layer = (n) => m.layers.find((l) => l.name === n);
  const spawns = Object.fromEntries(layer('spawn-points').objects.map((o) => [o.name, { x: o.x / m.tilewidth, y: o.y / m.tileheight }]));
  const zones = Object.fromEntries(layer('zones').objects.map((o) => [o.name, o]));
  const blocked = (x, y) => x < 0 || y < 0 || x >= m.width || y >= m.height || layer('collision').data[y * m.width + x] !== 0;
  const gid = (name, x, y) => layer(name).data[y * m.width + x];
  return { m, layer, spawns, zones, blocked, gid };
}

function reachable(map, from) {
  const seen = new Set([`${from.x},${from.y}`]);
  const q = [from];
  while (q.length) {
    const { x, y } = q.shift();
    for (const [dx, dy] of NB) {
      const n = { x: x + dx, y: y + dy };
      const k = `${n.x},${n.y}`;
      if (!seen.has(k) && !map.blocked(n.x, n.y)) { seen.add(k); q.push(n); }
    }
  }
  return seen;
}

const inZone = (z, p, ts) => p.x >= z.x / ts && p.x < (z.x + z.width) / ts && p.y >= z.y / ts && p.y < (z.y + z.height) / ts;

const CASES = [
  { name: 'office', file: 'office-modern.tmj', seats: OFFICE_SEATS, monitored: OFFICE_SEATS, zones: ['boardroom', 'cafeteria'],
    maxW: 34, maxH: 22, godZone: null, cfg: meta.office },
  { name: 'school', file: 'staffroom-modern.tmj', seats: SCHOOL_SEATS, monitored: ['desk-ceo', 'pc-6'], zones: ['boardroom', 'cafeteria', 'principal', 'teacher'],
    maxW: 36, maxH: 24, godZone: 'principal', cfg: meta.school },
];

for (const c of CASES) {
  test(`${c.name}: layers, gids and the atlas line up`, () => {
    const { m } = load(c.file);
    assert.equal(m.tilewidth, 16, 'engine grid');
    assert.deepEqual(m.layers.map((l) => l.name), LAYERS);
    const ts = m.tilesets[0];
    assert.equal(ts.tilewidth, 32);
    for (const l of m.layers.filter((x) => x.type === 'tilelayer')) {
      assert.equal(l.data.length, m.width * m.height, l.name);
      for (const g of l.data) assert.ok(g >= 0 && g <= ts.tilecount, `${l.name}: gid ${g} outside the atlas`);
    }
    // padded atlas geometry: columns of (32 + spacing) after the margin
    assert.equal(Math.floor((ts.imagewidth - 2 * ts.margin + ts.spacing) / (ts.tilewidth + ts.spacing)), ts.columns);
    const png = fs.readFileSync(path.join(ASSETS, 'tilesets/emakina-atlas.png'));
    assert.equal(png.readUInt32BE(16), ts.imagewidth);
    assert.equal(png.readUInt32BE(20), ts.imageheight);
  });

  test(`${c.name}: the floor is compact (the camera fits the whole map, so smaller reads bigger)`, () => {
    const { m } = load(c.file);
    assert.ok(m.width <= c.maxW && m.height <= c.maxH, `${m.width}x${m.height} exceeds ${c.maxW}x${c.maxH}`);
    assert.equal(c.cfg.width, m.width, 'meta width matches the map');
    assert.equal(c.cfg.height, m.height, 'meta height matches the map');
  });

  test(`${c.name}: every seat, café spot and zone the engine needs exists`, () => {
    const { spawns, zones } = load(c.file);
    for (const n of [...c.seats, ...COMMON]) assert.ok(spawns[n], `missing spawn point ${n}`);
    for (const z of c.zones) assert.ok(zones[z] && zones[z].width > 0, `missing zone ${z}`);
    assert.deepEqual([...c.cfg.seats].sort(), [...c.seats].sort(), 'meta seat list');
  });

  test(`${c.name}: seats face a desk and desks carry the monitor the engine lights`, () => {
    const map = load(c.file);
    for (const n of [...c.seats, 'cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4']) {
      const s = map.spawns[n];
      assert.ok(!map.blocked(s.x, s.y), `${n} sits on a blocked tile`);
      const hasDesk = NB.some(([dx, dy]) => map.blocked(s.x + dx, s.y + dy));
      assert.ok(hasDesk, `${n} has no desk beside it`);
    }
    for (const n of c.monitored) {
      const s = map.spawns[n];
      // the engine checks north first: a desk seat must face up at its monitor
      assert.ok(map.blocked(s.x, s.y - 1), `${n}: the desk is not directly north of the seat`);
      assert.equal(map.gid('furniture-above', s.x, s.y - 2), meta.monitorOff, `${n}: no monitor two rows above the seat`);
    }
    // the lit monitor is a runtime overlay only, never painted into the map
    for (const l of map.m.layers.filter((x) => x.type === 'tilelayer' && x.name !== 'collision')) {
      assert.ok(!l.data.includes(meta.monitorOn), `${l.name} paints the lit monitor`);
    }
  });

  test(`${c.name}: every seat and stand tile is reachable from the entrance`, () => {
    const map = load(c.file);
    const open = reachable(map, map.spawns.entrance);
    const near = (p) => open.has(`${p.x},${p.y}`) || NB.some(([dx, dy]) => open.has(`${p.x + dx},${p.y + dy}`));
    for (const [n, p] of Object.entries(map.spawns)) assert.ok(near(p), `${n} (${p.x},${p.y}) is walled off`);
    const a = c.cfg.anchors;
    const stands = [c.cfg.coffee.trayStand, c.cfg.coffee.machineStand, c.cfg.coffee.sinkStand,
      ...c.cfg.errands.map((e) => e.stand),
      ...[a.boardPin, a.boardTake, a.boardArchive].filter(Boolean)];
    assert.ok(stands.length >= 15, 'errand spots present');
    for (const p of stands) {
      assert.ok(!map.blocked(p.x, p.y), `stand (${p.x},${p.y}) is not walkable`);
      assert.ok(open.has(`${p.x},${p.y}`), `stand (${p.x},${p.y}) is unreachable`);
    }
  });

  test(`${c.name}: coffee tiles sit on furniture, their stands are free`, () => {
    const map = load(c.file);
    const k = c.cfg.coffee;
    for (const t of ['trayTile', 'machineTile', 'sinkTile']) assert.ok(map.blocked(k[t].x, k[t].y), `${t} should be furniture`);
    for (const [tile, stand] of [['trayTile', 'trayStand'], ['machineTile', 'machineStand'], ['sinkTile', 'sinkStand']]) {
      const d = Math.abs(k[tile].x - k[stand].x) + Math.abs(k[tile].y - k[stand].y);
      assert.ok(d <= 2, `${stand} is ${d} tiles from ${tile}`);
    }
  });

  test(`${c.name}: errand spots are well-formed and sit next to what they use`, () => {
    const map = load(c.file);
    const { m } = map;
    const kinds = new Set();
    for (const e of c.cfg.errands) {
      const where = `${e.kind} @ (${e.stand.x},${e.stand.y})`;
      assert.ok(ERRAND_KINDS.includes(e.kind), `${where}: unknown kind`);
      assert.ok(FACINGS.includes(e.facing), `${where}: bad facing ${e.facing}`);
      assert.ok(e.duration > 0, `${where}: duration`);
      assert.ok(e.fx.x >= 0 && e.fx.y >= 0 && e.fx.x < m.width && e.fx.y < m.height, `${where}: fx off the map`);
      const d = Math.abs(e.fx.x - e.stand.x) + Math.abs(e.fx.y - e.stand.y);
      assert.ok(d >= 1 && d <= 2, `${where}: fx is ${d} tiles away`);
      // everything but the window / cigar spots points at a piece of furniture
      if (e.kind !== 'window' && e.kind !== 'smoke') assert.ok(map.blocked(e.fx.x, e.fx.y), `${where}: fx is not furniture`);
      kinds.add(e.kind);
    }
    for (const k of ERRAND_KINDS) assert.ok(kinds.has(k), `no ${k} errand`);
    const god = c.cfg.errands.filter((e) => e.godOnly);
    assert.ok(god.some((e) => e.kind === 'smoke'), 'the boss has a cigar spot');
    if (c.godZone) {
      const z = map.zones[c.godZone];
      for (const e of god) assert.ok(inZone(z, e.stand, m.tilewidth), `god-only ${e.kind} spot outside the ${c.godZone}`);
    }
    for (const e of c.cfg.errands.filter((x) => !x.godOnly)) {
      if (c.godZone) assert.ok(!inZone(map.zones[c.godZone], e.stand, m.tilewidth), `public ${e.kind} spot inside the ${c.godZone}`);
    }
  });

  test(`${c.name}: the drawn wall props (task boards, ASK ME board, calendar) hang on walls, apart`, () => {
    const map = load(c.file);
    const ts = map.m.tilewidth;
    const a = c.cfg.anchors;
    assert.ok(a.calendar && a.boards && a.clock && a.questions, 'calendar, boards, clock and questions anchors');
    // pixel rects as OfficeFloor draws them (see drawTaskBoard / drawAskBoard / calG)
    const rects = {
      boards: [a.boards.x * ts + 15, a.boards.y * ts - 8, 82, 24],
      questions: [a.questions.x * ts, a.questions.y * ts - 8, 30, 22],
      calendar: [a.calendar.x * ts + 8, a.calendar.y * ts + 5, 16, 20],
      clock: [a.clock.x * ts, a.clock.y * ts, 16, 32],
    };
    for (const [n, [x, y, w, h]] of Object.entries(rects)) {
      for (let ty = Math.floor(y / ts); ty <= Math.floor((y + h - 1) / ts); ty++) {
        for (let tx = Math.floor(x / ts); tx <= Math.floor((x + w - 1) / ts); tx++) {
          assert.ok(map.blocked(tx, ty) && map.gid('walls', tx, ty), `${n} covers (${tx},${ty}), which is not a wall`);
        }
      }
    }
    const names = Object.keys(rects);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const [ax, ay, aw, ah] = rects[names[i]];
        const [bx, by, bw, bh] = rects[names[j]];
        const overlap = ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
        assert.ok(!overlap, `${names[i]} overlaps ${names[j]}`);
      }
    }
  });

  test(`${c.name}: no big empty patches (cosy, furnished floor)`, () => {
    const map = load(c.file);
    const { m } = map;
    const bare = (x, y) => !map.blocked(x, y)
      && !map.gid('walls', x, y) && !map.gid('furniture-below', x, y) && !map.gid('furniture-above', x, y);
    // no 5x5 square of bare, walkable floor anywhere
    for (let y = 0; y + 5 <= m.height; y++) {
      for (let x = 0; x + 5 <= m.width; x++) {
        let all = true;
        for (let dy = 0; dy < 5 && all; dy++) for (let dx = 0; dx < 5 && all; dx++) all = bare(x + dx, y + dy);
        assert.ok(!all, `empty 5x5 patch at (${x},${y})`);
      }
    }
  });
}

test('the theme registry reads layout data from the generated meta, not hand-written coordinates', () => {
  for (const [theme, floor] of [['OFFICE_MODERN_THEME', 'office'], ['STAFFROOM_MODERN_THEME', 'school']]) {
    const start = registrySrc.indexOf(`export const ${theme}`);
    assert.ok(start > 0, theme);
    const block = registrySrc.slice(start, registrySrc.indexOf('};', start));
    assert.match(block, new RegExp(`errandSpots: E\\.${floor}\\.errands`));
    assert.match(block, new RegExp(`coffee: modernCoffee\\(E\\.${floor}\\)`));
    assert.match(block, new RegExp(`anchors: modernAnchors\\(E\\.${floor}\\)`));
    assert.doesNotMatch(block, /\{ x: \d+, y: \d+ \}|t\(\d+, \d+\)/, `${theme} hard-codes a tile`);
  }
});

test('the Star Wars sheet from the source repo is never packed', () => {
  const tool = fs.readFileSync(path.join(__dirname, '../tools/build-emakina-world.py'), 'utf8');
  const sheets = tool.match(/SHEETS = \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(sheets, /yoda|kashyyyk|tatooine/i);
});
