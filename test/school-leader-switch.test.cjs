'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const loadTs = require('./load-ts.cjs');
const identity = loadTs('src/shared/godIdentity.ts');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/renderer/src/hooks/useHive.ts'), 'utf8');
const effect = source.slice(source.indexOf('  const officeIdentity ='), source.indexOf('  // Per-agent dedup'));
const js = ts.transpileModule(`function render(officeTheme: string, leaderName: string, leaderCharacter: string, config: any) { ${effect} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(initial, cached) {
  const slots = [], effects = [], writes = [], pending = [], storage = new Map();
  const config = { harnessHome: 'D:/test-hive' };
  if (cached) storage.set(identity.godIdentityStorageKey(config.harnessHome), JSON.stringify(cached));
  let cursor = 0, agent = { ...initial };
  const store = {
    updateAgent: (_, patch) => { agent = { ...agent, ...patch }; },
    renameAgent: (_, name) => {
      writes.push(name);
      return new Promise((resolve) => pending.push(() => { agent.name = name; resolve({ ok: true }); }));
    },
    pushFeed: () => assert.fail('unexpected rename failure'),
  };
  const useStore = { getState: () => store };
  const render = new Function('useRef', 'useEffect', 'useStore', 'window', 'officeGodIdentity', 'godIdentityStorageKey', 'createIdentityRenameQueue', 'CAST_BY_NAME', `const GOD_ID = 'god'; ${js}; return render;`)(
    (value) => slots[cursor++] ?? (slots[cursor - 1] = { current: value }),
    (callback) => effects.push(callback), useStore,
    { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } },
    identity.officeGodIdentity, identity.godIdentityStorageKey, identity.createIdentityRenameQueue,
    { michael: {}, dwight: {}, principal: {} },
  );
  return {
    run(theme) { cursor = 0; render(theme, agent.name, agent.character, config); effects.splice(0).forEach((effect) => effect()); },
    async settle() { while (pending.length) { pending.shift()(); await new Promise((resolve) => setImmediate(resolve)); } },
    get agent() { return agent; }, writes,
    rename(name) { agent.name = name; },
  };
}

test('actual leader effect restores customized office identity and never clobbers office edits', async () => {
  const h = harness({ name: 'Savvas', character: 'dwight' });
  h.run('office');
  assert.deepEqual(h.writes, []);
  h.run('staffroom');
  assert.equal(h.agent.character, 'principal');
  await h.settle();
  h.run('staffroom');
  h.run('office');
  await h.settle();
  assert.deepEqual(h.agent, { name: 'Savvas', character: 'dwight' });
  h.rename('New Boss'); h.run('office'); h.run('office');
  assert.deepEqual(h.writes, ['Principal', 'Savvas']);
  h.run('staffroom'); await h.settle(); h.run('office'); await h.settle();
  assert.equal(h.agent.name, 'New Boss');
});

test('actual leader effect handles rapid fresh-team switches and restored Principal', async () => {
  const h = harness({ name: 'Michael', character: 'michael' });
  h.run('staffroom'); h.run('office'); h.run('staffroom'); h.run('office');
  await h.settle();
  assert.deepEqual(h.agent, { name: 'Michael', character: 'michael' });
  assert.deepEqual(h.writes, ['Principal', 'Michael']);
  const restarted = harness({ name: 'Principal', character: 'principal' }, { name: 'Savvas', character: 'dwight' });
  restarted.run('office'); await restarted.settle();
  assert.deepEqual(restarted.agent, { name: 'Savvas', character: 'dwight' });
});
