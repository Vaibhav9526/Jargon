'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { parseFileToolRequest, fileToolAlias } = loadTs('src/shared/fileTools.ts');

const f = (name) => ({ path: `D:\in\${name}`, name });
const parse = (text, ...names) => parseFileToolRequest(text, names.map(f));

test('non-tool messages are left alone', () => {
  for (const t of ['hello', 'mail bob@convert.com', '@converter x', '@compressor', '@convert.com', 'a@compress']) {
    assert.equal(parse(t, 'a.pdf'), null, t);
    assert.equal(fileToolAlias(t), null, t);
  }
});

test('convert: image and slides default to PDF', () => {
  assert.equal(parse('@convert', 'a.png').target, 'pdf');
  assert.equal(parse('please @convert this', 'deck.PPTX').target, 'pdf');
  assert.equal(parse('@convert to pdf', 'a.jpg', 'b.webp').files.length, 2);
});

test('convert: a PDF needs a destination', () => {
  assert.throws(() => parse('@convert', 'a.pdf'), /ppt.*image/);
  assert.equal(parse('@convert to ppt', 'a.pdf').target, 'ppt');
  assert.equal(parse('@convert to PowerPoint', 'a.pdf').target, 'ppt');
  const img = parse('@convert into jpg', 'a.pdf');
  assert.equal(img.target, 'image');
  assert.equal(img.imageFormat, 'jpg');
  assert.equal(parse('@convert to images', 'a.pdf').imageFormat, 'png');
});

test('convert: unsupported pairs and mixed batches are refused', () => {
  assert.throws(() => parse('@convert to ppt', 'a.png'), /Can't convert IMAGE to PPT/);
  assert.throws(() => parse('@convert to image', 'a.pptx'), /Can't convert PPT to IMAGE/);
  assert.throws(() => parse('@convert to pdf', 'a.pdf'), /Can't convert PDF to PDF/);
  assert.throws(() => parse('@convert to pdf', 'a.png', 'b.pptx'), /one kind/);
  assert.throws(() => parse('@convert to pdf', 'a.docx'), /not supported/);
  assert.throws(() => parse('@convert to pdf'), /Attach/);
});

test('compress: needs images and a percentage in range', () => {
  assert.deepEqual(
    (({ kind, reducePercent }) => ({ kind, reducePercent }))(parse('@compress 40%', 'a.jpg')),
    { kind: 'compress', reducePercent: 40 }
  );
  assert.equal(parse('compress it @compress by 70', 'a.png').reducePercent, 70);
  assert.throws(() => parse('@compress', 'a.png'), /how much smaller/);
  assert.throws(() => parse('@compress 99%', 'a.png'), /between 5% and 95%/);
  assert.throws(() => parse('@compress 2%', 'a.png'), /between 5% and 95%/);
  assert.throws(() => parse('@compress 50%', 'a.pdf'), /images/);
  assert.throws(() => parse('@compress 50%'), /Attach/);
});

test('attachment shape is validated', () => {
  assert.throws(() => parseFileToolRequest('@convert', [{ path: 'x', name: 'a/b.png' }]), TypeError);
  assert.throws(() => parseFileToolRequest('@convert', [{ path: 'x\u0000', name: 'a.png' }]), TypeError);
});
