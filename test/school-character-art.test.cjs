'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const art = loadTs('src/renderer/src/scene/office/portraitArt.ts');
const cast = loadTs('src/renderer/src/scene/office/cast.ts');
const school = ['principal', 'teacher', 'topper', 'smartguy', 'librarian'];

for (const name of school) {
  test(`${name} preserves dimensions, head identity and six distinct walk views`, () => {
    const portrait = art.portraitBuf(name);
    const { front, back } = art.sceneFrameBufs(name);
    assert.equal(portrait.length, 18 * 28 * 4);
    assert.equal(front.length, 3);
    assert.equal(back.length, 3);
    for (const frame of [...front, ...back]) {
      assert.equal(frame.length, 18 * 32 * 4);
      assert.ok(frame.some((value, i) => i % 4 === 3 && value === 255));
      assert.ok(frame.some((value, i) => i % 4 === 3 && value === 0));
    }
    for (const frame of front) assert.deepEqual(frame.slice(0, 17 * 18 * 4), portrait.slice(0, 17 * 18 * 4));
    assert.equal(new Set([...front, ...back].map((frame) => Buffer.from(frame).toString('base64'))).size, 6);
    const original = art.portraitBuf(name)[0];
    portrait[0] ^= 255;
    assert.equal(art.portraitBuf(name)[0], original);
  });
}

test('school silhouettes and school hire defaults are distinct and theme scoped', () => {
  const silhouettes = school.map((name) => art.portraitBuf(name).filter((_, i) => i % 4 === 3).join(','));
  assert.equal(new Set(silhouettes).size, school.length);
  assert.deepEqual(cast.castForTheme('staffroom').map((member) => member.name), school);
  assert.equal(cast.castForTheme('office').length, 16);
  assert.equal(cast.defaultCharacterForTheme('staffroom'), 'teacher');
  assert.equal(cast.defaultCharacterForTheme('office'), 'jim');
});

test('theme identity effect only updates metadata, never destroys named sessions', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/hooks/useHive.ts'), 'utf8');
  const effect = source.slice(source.indexOf('const officeIdentity ='), source.indexOf('// Per-agent dedup'));
  assert.doesNotMatch(effect, /killPty|archiveAgent|spawnPty|removeAgent/);
  assert.doesNotMatch(source, /vice principal/i);
  assert.match(effect, /renameAgent\(GOD_ID, name\)/);
});
