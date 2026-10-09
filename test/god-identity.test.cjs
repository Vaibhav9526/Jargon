'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { DEFAULT_GOD_NAME, resolveGodName, officeGodIdentity, godIdentityStorageKey, createIdentityRenameQueue } = loadTs('src/shared/godIdentity.ts');

test('staff room uses Principal without changing other themes', () => {
  assert.equal(resolveGodName('Michael', 'staffroom'), 'Principal');
  assert.equal(resolveGodName(undefined, 'staffroom'), 'Principal');
  assert.equal(resolveGodName('Savvas', 'office'), 'Savvas');
});

test('a persisted rename wins over the default', () => {
  assert.equal(resolveGodName('Savvas'), 'Savvas');
  assert.equal(resolveGodName('  Savvas  '), 'Savvas'); // trimmed, like renameAgent() trims on write
});

test('nothing persisted yet falls back to the default', () => {
  assert.equal(resolveGodName(undefined), DEFAULT_GOD_NAME);
  assert.equal(resolveGodName(null), DEFAULT_GOD_NAME);
  assert.equal(resolveGodName(''), DEFAULT_GOD_NAME);
  assert.equal(resolveGodName('   '), DEFAULT_GOD_NAME); // whitespace-only is not a real name
});

test('office restores its retained name instead of leaking Principal', () => {
  assert.equal(resolveGodName('Principal', 'office'), 'Michael');
  assert.equal(resolveGodName('Principal', 'office', 'Savvas'), 'Savvas');
  assert.deepEqual(officeGodIdentity(' Savvas ', 'dwight'), { name: 'Savvas', character: 'dwight' });
  assert.deepEqual(officeGodIdentity('Principal', 'principal'), { name: 'Michael', character: 'michael' });
  assert.equal(godIdentityStorageKey('D:\\Hive\\'), godIdentityStorageKey('d:/hive'));
  assert.notEqual(godIdentityStorageKey('d:/hive'), godIdentityStorageKey('d:/other'));
});

test('rapid theme changes serialize renames and settle on the latest identity', async () => {
  const writes = [], releases = [], errors = [];
  const sync = createIdentityRenameQueue((name) => {
    writes.push(name);
    return new Promise((resolve) => releases.push(() => resolve({ ok: true })));
  }, (error) => errors.push(error));
  const pending = sync('Principal');
  sync('Michael');
  sync('Savvas');
  assert.deepEqual(writes, ['Principal']);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ['Principal', 'Savvas']);
  releases.shift()();
  await pending;
  assert.deepEqual(errors, []);
  const next = sync('Principal');
  releases.shift()();
  await next;
  assert.deepEqual(writes, ['Principal', 'Savvas', 'Principal']);
});

test('failed identity updates are reported without spinning and may be retried', async () => {
  let calls = 0;
  const errors = [];
  const sync = createIdentityRenameQueue(async () => ({ ok: ++calls > 1, error: 'offline' }), (error) => errors.push(error));
  await sync('Principal');
  assert.equal(calls, 1);
  assert.deepEqual(errors, ['offline']);
  await sync('Principal');
  assert.equal(calls, 2);
});
