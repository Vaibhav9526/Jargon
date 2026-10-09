'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { decodeText } = loadTs('src/main/textFile.ts');

test('BOM-prefixed and UTF-16 files (Windows PowerShell) still parse as JSON', () => {
  const json = '{"to":"god","body":"hi"}';
  assert.deepEqual(JSON.parse(decodeText(Buffer.from('﻿' + json, 'utf8'))), { to: 'god', body: 'hi' });
  assert.deepEqual(JSON.parse(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]))), { to: 'god', body: 'hi' });
  assert.equal(decodeText(Buffer.from(json)), json);
});
