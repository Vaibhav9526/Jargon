'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const source = readFileSync('src/renderer/src/scene/office/OfficeFloor.tsx', 'utf8');
const start = source.indexOf('const pendingCharacters =');
const end = source.indexOf('const removeCharacter =', start);
assert.ok(start >= 0 && end > start);
const output = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(agents, themeId = 'staffroom') {
  const frames = [];
  const rendered = [];
  const runtimes = new Map();
  const seatClaims = new Set();
  const state = { agents, select() {} };
  let claims = 0;
  const context = {
    theme: {
      id: themeId,
      cast: {
        byName: Object.fromEntries(['principal', 'michael', 'teacher'].map((name) => [name, { shirt: '#466458' }])),
        defaultCharacter: 'teacher',
        getFrames: (name) => new Promise((resolve, reject) => frames.push({ name, resolve, reject })),
      },
      monitor: { offTopLeftGid: 1 },
    },
    runtimes, seatClaims,
    claimSeat: (agent) => { claims++; const index = agent.isGod ? 0 : 1; seatClaims.add(index); return index; },
    seatTiles: [{ x: 4, y: 4 }, { x: 6, y: 4 }],
    waitTiles: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
    mapRenderer: { tileSize: 16, getSpawnPoint: () => ({ x: 0, y: 0 }), gidAt: () => 0 },
    mountIdRef: { current: 1 }, mountId: 1,
    useStore: { getState: () => state },
    Character: class { constructor(options) { this.options = options; } show() { rendered.push(this.options); } },
    facingForSeat: () => 'up', entrance: { x: 0, y: 0 },
    hexNum: () => 0, hexToNumber: () => 0, colors: { accent: { sky: 0 } },
    charLayer: { addChild() {} }, applyState() {}, syncAgents() {}, queueMicrotask() {},
  };
  const methods = new Function(...Object.keys(context), `${output}\nreturn { addCharacter, pendingCharacters };`)(...Object.values(context));
  return { ...methods, frames, rendered, runtimes, seatClaims, state, claims: () => claims };
}

const worker = { id: 'librarian', name: 'Librarian', character: 'teacher', accent: 'sky' };

test('concurrent roster refreshes load one sprite and claim one seat per agent', async () => {
  const h = harness([worker]);
  const first = h.addCharacter(worker);
  const second = h.addCharacter({ ...worker, action: 'starting up' });
  assert.equal(h.frames.length, 1);
  assert.equal(h.claims(), 1);
  h.frames[0].resolve([]);
  await Promise.all([first, second]);
  assert.equal(h.rendered.length, 1);
  assert.equal(h.runtimes.size, 1);
  assert.equal(h.pendingCharacters.size, 0);
  await h.addCharacter(worker);
  assert.equal(h.frames.length, 1);
});

test('removing an agent during artwork loading releases its seat and renders nothing', async () => {
  const h = harness([worker]);
  const loading = h.addCharacter(worker);
  h.state.agents = [];
  h.frames[0].resolve([]);
  await loading;
  assert.equal(h.rendered.length, 0);
  assert.equal(h.runtimes.size, 0);
  assert.equal(h.seatClaims.size, 0);
  assert.equal(h.pendingCharacters.size, 0);
});

test('failed frame loading releases the seat and allows a later retry', async () => {
  const h = harness([worker]);
  const failed = h.addCharacter(worker);
  h.frames[0].reject(new Error('art failed'));
  await assert.rejects(failed, /art failed/);
  assert.equal(h.pendingCharacters.size, 0);
  assert.equal(h.seatClaims.size, 0);
  const retry = h.addCharacter(worker);
  h.frames[1].resolve([]);
  await retry;
  assert.equal(h.rendered.length, 1);
});

test('school GOD artwork is Principal even before the metadata rename settles', async () => {
  const god = { ...worker, id: 'god', isGod: true, name: 'Michael', character: 'michael' };
  const h = harness([god]);
  const loading = h.addCharacter(god);
  assert.equal(h.frames[0].name, 'principal');
  h.state.agents = [{ ...god, name: 'Principal' }];
  h.frames[0].resolve([]);
  await loading;
  assert.equal(h.rendered[0].displayName, 'Principal');
  assert.match(source, /rt\.charName !== characterNameFor\(agent\)/);
});
