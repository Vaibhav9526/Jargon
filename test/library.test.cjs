'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const loadTs = require('./load-ts.cjs');

const { chunkText, tokenize, rank, extractText, Library } = loadTs('src/main/library.ts');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));

test('chunkText splits long text with overlap and never loses content', () => {
  const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about topic ${i}.`).join(' ');
  const chunks = chunkText(text);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1000, String(c.length));
  assert.ok(chunks[0].includes('Sentence number 0'));
  assert.ok(chunks.at(-1).includes('Sentence number 59'));
  assert.deepEqual(chunkText('short'), ['short']);
  assert.deepEqual(chunkText('   '), []);
});

test('tokenize drops stop words and keeps unicode words', () => {
  assert.deepEqual(tokenize('What is the Photosynthesis of plants?'), ['photosynthesis', 'plants']);
  assert.ok(tokenize('café 光合作用 2026').includes('café'));
});

test('rank finds the chunk that answers the question and ignores unrelated ones', () => {
  const chunks = [
    { source: 'bio.pdf', text: 'Photosynthesis converts light energy into chemical energy stored as glucose in chloroplasts.' },
    { source: 'hist.pdf', text: 'The French Revolution began in 1789 with the storming of the Bastille.' },
    { source: 'chem.pdf', text: 'Glucose is a simple sugar with the formula C6H12O6.' },
  ];
  const hits = rank(chunks, 'how does photosynthesis make glucose?', 2);
  assert.equal(hits[0].source, 'bio.pdf');
  assert.ok(hits.every((h) => h.source !== 'hist.pdf'));
  assert.deepEqual(rank(chunks, 'quantum chromodynamics', 3), []);
  assert.deepEqual(rank(chunks, 'the of and', 3), []);
  assert.deepEqual(rank([], 'anything'), []);
});

test('extractText reads txt, md, pptx and docx; rejects unsupported and empty files', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'Plain notes about cells.');
  fs.writeFileSync(path.join(dir, 'b.md'), '# Title\nMarkdown body');
  assert.match(await extractText(path.join(dir, 'a.txt')), /cells/);
  assert.match(await extractText(path.join(dir, 'b.md')), /Markdown body/);

  const pptx = new JSZip();
  pptx.file('ppt/slides/slide2.xml', '<p:sld><a:t>Second &amp; last</a:t></p:sld>');
  pptx.file('ppt/slides/slide1.xml', '<p:sld><a:t>First</a:t><a:t>slide</a:t></p:sld>');
  fs.writeFileSync(path.join(dir, 'c.pptx'), await pptx.generateAsync({ type: 'nodebuffer' }));
  const slides = await extractText(path.join(dir, 'c.pptx'));
  assert.ok(slides.indexOf('Slide 1: First slide') < slides.indexOf('Slide 2: Second & last'));

  const docx = new JSZip();
  docx.file('word/document.xml', '<w:document><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p><w:p><w:r><w:t>Line two</w:t></w:r></w:p></w:document>');
  fs.writeFileSync(path.join(dir, 'd.docx'), await docx.generateAsync({ type: 'nodebuffer' }));
  assert.equal(await extractText(path.join(dir, 'd.docx')), 'Hello world\nLine two');

  fs.writeFileSync(path.join(dir, 'e.exe'), 'x');
  await assert.rejects(extractText(path.join(dir, 'e.exe')), /Unsupported/);
  fs.writeFileSync(path.join(dir, 'f.txt'), '   ');
  await assert.rejects(extractText(path.join(dir, 'f.txt')), /No readable text/);
});

test('extractText reads a real PDF', async () => {
  // Minimal single-page PDF containing one line of text.
  const content = 'BT /F1 18 Tf 72 720 Td (Mitochondria are the powerhouse of the cell.) Tj ET';
  let pdf = '%PDF-1.4\n';
  const offs = [];
  const add = (s) => { offs.push(pdf.length); pdf += s; };
  add('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
  add('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n');
  add('3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n');
  add(`4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n`);
  add('5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n');
  const x = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`;
  const f = path.join(tmp(), 'bio.pdf');
  fs.writeFileSync(f, pdf, 'latin1');
  assert.match(await extractText(f), /powerhouse of the cell/);
});

test('Library adds, lists, searches, removes and survives a reload', async () => {
  const dir = tmp();
  const src = tmp();
  fs.writeFileSync(path.join(src, 'bio.txt'), 'Photosynthesis happens in chloroplasts. '.repeat(40) + 'Chlorophyll absorbs red and blue light.');
  fs.writeFileSync(path.join(src, 'war.txt'), 'The treaty was signed in 1648 ending the Thirty Years War.');
  const lib = new Library(path.join(dir, 'shelf'));
  assert.deepEqual(lib.list(), []);
  const a = await lib.add(path.join(src, 'bio.txt'));
  const b = await lib.add(path.join(src, 'war.txt'));
  assert.equal(a.ok && b.ok, true);
  assert.equal(lib.list().length, 2);
  assert.equal(lib.search('what absorbs light in chloroplasts?')[0].source, 'bio.txt');
  assert.equal(lib.search('when did the Thirty Years War end?')[0].source, 'war.txt');

  const reloaded = new Library(path.join(dir, 'shelf'));
  assert.equal(reloaded.list().length, 2);
  assert.equal(reloaded.remove(a.doc.id), true);
  assert.equal(reloaded.remove('../../etc'), false);
  assert.equal(reloaded.list().length, 1);
  assert.deepEqual(reloaded.search('chlorophyll'), []);

  const bad = await lib.add(path.join(src, 'missing.pdf'));
  assert.equal(bad.ok, false);
});
