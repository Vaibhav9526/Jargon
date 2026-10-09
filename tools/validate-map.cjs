#!/usr/bin/env node
/**
 * validate-map.cjs — validate a .tmj map against the staffroom map contract.
 *
 * Usage: node tools/validate-map.cjs <path.tmj> [--shipping]
 *
 * Checks:
 *   a. file parses as JSON
 *   b. every tilelayer has width*height data entries
 *   c. every gid (flip-flags masked) is 0 or in [1,512] ∪ [513,1024] ∪
 *      [1025,2448] ∪ [2449,2449+school tilecount) — the school band is read
 *      from tools/gen/staffroom-assets/school-atlas.json when present,
 *      else a fixed [2449,3000] allowance so maps can paint ahead of the atlas.
 *   d. required spawn-point objects exist (desk-ceo, entrance, ≥1 pc-N)
 *   e. zones exist (zones objectgroup with ≥1 object)
 *   f. every spawn-point tile is not collision-marked (collision gid 0 at x,y)
 *   g. layer names match [floor, walls, furniture-below, furniture-above,
 *      collision, spawn-points, zones]
 *
 * Prints per-check PASS/FAIL; exits 1 on any FAIL. With --shipping, FAILs are
 * reported as WARN instead (shipping maps are ground truth — a deviation there
 * is flagged for review, not treated as a blocking defect), and the exit code
 * stays 0.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FLIP_MASK = 0x1fffffff;
const SCHOOL_FIRSTGID = 2449;
// Generated school-props atlas: its gid band is [2449, 2449+tilecount) when
// school-atlas.json exists; a fixed [2449,3000] allowance otherwise, so a map
// can reference the atlas before/while the generator's manifest lands.
function schoolRange() {
  try {
    const atlas = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'gen', 'staffroom-assets', 'school-atlas.json'), 'utf8'));
    if (Number.isInteger(atlas.tilecount) && atlas.tilecount > 0) {
      return [SCHOOL_FIRSTGID, SCHOOL_FIRSTGID + atlas.tilecount - 1];
    }
  } catch { /* manifest absent — use the fixed allowance */ }
  return [SCHOOL_FIRSTGID, 3000];
}
const VALID_RANGES = [
  [1, 512],      // office-tileset (firstgid 1)
  [513, 1024],   // a5-office-floors-walls (firstgid 513)
  [1025, 2448],  // interiors (firstgid 1025)
  schoolRange(), // school-props (firstgid 2449)
];
const EXPECTED_LAYERS = [
  'floor', 'walls', 'furniture-below', 'furniture-above',
  'collision', 'spawn-points', 'zones',
];

const args = process.argv.slice(2).filter((a) => a !== '--shipping');
const shipping = process.argv.includes('--shipping');
const file = args[0];

if (!file) {
  console.error('usage: node tools/validate-map.cjs <path.tmj> [--shipping]');
  process.exit(2);
}

let failures = 0;
let warnings = 0;
const report = (id, ok, detail) => {
  if (!ok && shipping) {
    warnings++;
    console.log(`  [WARN] ${id}. ${detail}  (shipping map — not blocking)`);
    return;
  }
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id}. ${detail}`);
};

console.log(`validate-map: ${file}`);

// a. parses as JSON
let map;
try {
  map = JSON.parse(fs.readFileSync(file, 'utf8'));
  report('a', true, 'parses as JSON');
} catch (e) {
  report('a', false, `parses as JSON — ${e.message}`);
  console.log(`RESULT: ${shipping ? 'WARN' : 'FAIL'} (1/7 checks)`);
  process.exit(shipping ? 0 : 1);
}

const W = map.width;
const H = map.height;
const tw = map.tilewidth || 16;
const th = map.tileheight || 16;
const layers = Array.isArray(map.layers) ? map.layers : [];
const tilelayers = layers.filter((l) => l.type === 'tilelayer');
const byName = (n) => layers.find((l) => l.name === n);

// b. every tilelayer has width*height entries
{
  const bad = tilelayers.filter((l) => !Array.isArray(l.data) || l.data.length !== W * H);
  report('b', bad.length === 0,
    bad.length === 0
      ? `all ${tilelayers.length} tilelayers have ${W}*${H}=${W * H} entries`
      : `tilelayers with wrong data length: ${bad.map((l) => `${l.name}(${Array.isArray(l.data) ? l.data.length : 'n/a'}!=${W * H})`).join(', ')}`);
}

// c. every gid is 0 or in a valid range (flip flags masked — engine masks too)
{
  let flagged = 0;
  const bad = new Map();
  for (const l of tilelayers) {
    if (!Array.isArray(l.data)) continue;
    l.data.forEach((raw, i) => {
      const gid = raw & FLIP_MASK;
      if (raw !== gid) flagged++;
      if (gid === 0) return;
      if (!VALID_RANGES.some(([lo, hi]) => gid >= lo && gid <= hi)) {
        bad.set(gid, (bad.get(gid) || []).concat(`${l.name}[${i % W},${Math.floor(i / W)}]`));
      }
    });
  }
  const rangesDesc = VALID_RANGES.map(([lo, hi]) => `[${lo},${hi}]`).join('∪');
  const detail = bad.size === 0
    ? `all gids in ${rangesDesc}${flagged ? ` (${flagged} carry flip flags, masked)` : ''}`
    : `out-of-range gids: ${[...bad.entries()].map(([g, at]) => `${g}@${at.slice(0, 3).join(',')}${at.length > 3 ? ` +${at.length - 3}more` : ''}`).join('; ')}`;
  report('c', bad.size === 0, detail);
}

// d. required spawn-point objects exist
const spawns = byName('spawn-points');
const spawnObjs = spawns && Array.isArray(spawns.objects) ? spawns.objects : [];
const spawnNames = new Set(spawnObjs.map((o) => o.name));
{
  const missing = ['desk-ceo', 'entrance'].filter((n) => !spawnNames.has(n));
  const pcCount = [...spawnNames].filter((n) => /^pc-\d+$/.test(n)).length;
  const ok = missing.length === 0 && pcCount >= 1;
  report('d', ok,
    ok
      ? `spawn-points present: desk-ceo, entrance, ${pcCount} pc-N (${spawnObjs.length} total objects)`
      : `missing spawns: ${[...missing, ...(pcCount === 0 ? ['pc-N'] : [])].join(', ')}`);
}

// e. zones exist
{
  const zones = byName('zones');
  const n = zones && Array.isArray(zones.objects) ? zones.objects.length : 0;
  report('e', n >= 1,
    n >= 1 ? `zones layer has ${n} zone(s): ${zones.objects.map((o) => o.name || '?').join(', ')}` : 'zones objectgroup missing or empty');
}

// f. every spawn-point tile is not collision-marked
{
  const col = byName('collision');
  if (!col || !Array.isArray(col.data)) {
    report('f', false, 'collision tilelayer missing — cannot check spawn tiles');
  } else {
    const bad = [];
    for (const o of spawnObjs) {
      const tx = Math.floor(o.x / tw);
      const ty = Math.floor(o.y / th);
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) {
        bad.push(`${o.name}@(${tx},${ty}) out of bounds`);
        continue;
      }
      if ((col.data[ty * W + tx] & FLIP_MASK) !== 0) {
        bad.push(`${o.name}@(${tx},${ty}) gid=${col.data[ty * W + tx] & FLIP_MASK}`);
      }
    }
    report('f', bad.length === 0,
      bad.length === 0 ? `all ${spawnObjs.length} spawn tiles have collision gid 0` : `spawns on collision: ${bad.join('; ')}`);
  }
}

// g. layer names match the expected set
{
  const names = layers.map((l) => l.name);
  const missing = EXPECTED_LAYERS.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !EXPECTED_LAYERS.includes(n));
  const orderMatches = names.join(',') === EXPECTED_LAYERS.join(',');
  const ok = missing.length === 0 && extra.length === 0;
  let detail;
  if (ok && orderMatches) detail = 'layer set matches expected (order too)';
  else if (ok) detail = `layer set matches expected (order differs: ${names.join(',')})`;
  else detail = `${missing.length ? `missing: ${missing.join(',')}` : ''}${missing.length && extra.length ? ' ' : ''}${extra.length ? `extra: ${extra.join(',')}` : ''}`;
  report('g', ok, detail);
}

const total = 7;
console.log(`RESULT: ${failures ? 'FAIL' : warnings ? 'PASS with WARNINGS' : 'PASS'} (${total - failures - warnings}/${total} clean${warnings ? `, ${warnings} warn` : ''})`);
process.exit(failures ? 1 : 0);
