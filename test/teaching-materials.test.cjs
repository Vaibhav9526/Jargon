'use strict';

// teachingMaterials turns user-picked attachment paths into uploadable
// documents: PDFs pass through, images get wrapped into one multi-page PDF by
// createImagePdf (the teaching endpoint has no image upload). Because the paths
// are picked by the user but read by main, every check here pins the same
// boundary: only paths in the caller's authorized set, resolved without any
// symlink, read through a bounded fd, sniffed by signature not by extension.
// Nothing in these tests touches a real file outside its own temp dir.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  readTeachingMaterials,
  createImagePdf,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_DIMENSION,
  IMAGES_PDF_NAME,
} = loadTs('src/main/teachingMaterials.ts');

// ─── fixtures ────────────────────────────────────────────────────────────────
const u32b = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
const u16b = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
const u32l = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const i32l = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const u16l = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u24l = (v) => Buffer.from([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]);

const png = (w, h) => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  u32b(13), Buffer.from('IHDR'), u32b(w), u32b(h), Buffer.from([8, 6, 0, 0, 0]), u32b(0),
  u32b(0), Buffer.from('IEND'), Buffer.from([0xae, 0x42, 0x60, 0x82]),
]);
const jpeg = (w, h) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]), u16b(16), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
  Buffer.from([0xff, 0xc0]), u16b(17), Buffer.from([8]), u16b(h), u16b(w),
  Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  Buffer.from([0xff, 0xd9]),
]);
const gif = (w, h) => Buffer.concat([Buffer.from('GIF89a'), u16l(w), u16l(h), Buffer.from([0, 0, 0])]);
const bmp = (w, h) => Buffer.concat([Buffer.from('BM'), Buffer.alloc(12), u32l(40), i32l(w), i32l(h), Buffer.alloc(8)]);
const webp = (w, h) => Buffer.concat([
  Buffer.from('RIFF'), u32l(30), Buffer.from('WEBP'), Buffer.from('VP8X'),
  u32l(10), Buffer.alloc(4), u24l(w - 1), u24l(h - 1),
]);
const webpL = (w, h) => Buffer.concat([ // lossless VP8L: 0x2f sig + 14-bit packed dims
  Buffer.from('RIFF'), u32l(21), Buffer.from('WEBP'), Buffer.from('VP8L'),
  u32l(5), Buffer.from([0x2f]), u32l((w - 1) | ((h - 1) << 14)),
]);
const tiff = () => Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
const pdf = (extra = 0) => Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'), Buffer.alloc(extra), Buffer.from('%%EOF\n'),
]);
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teaching-mat-'));
  return Promise.resolve(fn(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}
const write = (dir, name, bytes) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
};
const att = (p, name) => ({ path: p, name: name ?? path.basename(p) });
const grant = (...paths) => new Set(paths);
const decodeOk = (w = 100, h = 50) => () => ({ jpeg: FAKE_JPEG, width: w, height: h });
const code = (p) => p.then(
  () => assert.fail('expected rejection'),
  (e) => e.message,
);

// ─── minimal PDF reader — proves the writer's xref/trailer/streams ───────────
function parsePdf(buf) {
  const s = Buffer.from(buf).toString('latin1');
  assert.ok(s.startsWith('%PDF-'), 'header magic');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'EOF marker');
  const sx = /startxref\s+(\d+)/.exec(s);
  const xrefOff = +sx[1];
  assert.equal(s.slice(xrefOff, xrefOff + 4), 'xref', 'startxref must point at the xref table');
  const head = /xref\s+0\s+(\d+)\s*\n/.exec(s.slice(xrefOff));
  const count = +head[1];
  const tableStart = xrefOff + head[0].length; // entries begin after the "0 N" line
  const entries = [];
  for (let i = 0; i < count; i++) {
    const line = s.slice(tableStart + i * 20, tableStart + (i + 1) * 20);
    entries.push({ off: +line.slice(0, 10), gen: +line.slice(11, 16), tag: line[17] });
  }
  for (const e of entries.slice(1)) {
    assert.equal(e.tag, 'n');
    assert.match(s.slice(e.off), /^\d+ 0 obj/, `xref offset ${e.off} must land on an object`);
  }
  const trailer = /trailer\s*<<\s*\/Size\s+(\d+)\s*\/Root\s+(\d+)\s+0\s+R\s*>>/.exec(s);
  assert.equal(+trailer[1], count, 'trailer /Size matches the xref count');
  const mediaBoxes = [...s.matchAll(/\/MediaBox \[0 0 (\d+) (\d+)\]/g)].map((m) => [+m[1], +m[2]]);
  const pageCount = +(/\/Count\s+(\d+)/.exec(s)[1]);
  const images = [...s.matchAll(/\/Subtype \/Image \/Width (\d+) \/Height (\d+) \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length (\d+) >>/g)]
    .map((m) => ({ w: +m[1], h: +m[2], len: +m[3] }));
  let cursor = 0;
  const streams = images.map(({ len }) => {
    const i = s.indexOf(`/DCTDecode /Length ${len} `, cursor);
    const at = s.indexOf('stream\n', i) + 7;
    cursor = at + len;
    assert.equal(s.slice(at + len, at + len + 10), '\nendstream', 'declared /Length lands exactly on endstream');
    return buf.subarray(at, at + len);
  });
  // Page content streams are the bare `<< /Length N >>` dicts (image dicts end
  // with /Length too but carry the long XObject header first).
  const contentStreams = [];
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const len = +m[1], at = m.index + m[0].length;
    const body = s.slice(at, at + len);
    assert.equal(s.slice(at + len, at + len + 9), 'endstream', 'content /Length is accurate');
    contentStreams.push(body);
  }
  const fontOk = s.includes('/Subtype /Type1') && s.includes('/BaseFont /Helvetica');
  const captions = contentStreams.map((c) => /\(([^()]*)\) Tj/.exec(c)?.[1]);
  return { s, count, mediaBoxes, pageCount, images, streams, contentStreams, captions, fontOk };
}

// ─── createImagePdf ─────────────────────────────────────────────────────────
test('createImagePdf emits a structurally accurate single-page PDF', () => {
  const jpg = jpeg(640, 480);
  const buf = createImagePdf([{ jpeg: jpg, width: 640, height: 480 }]);
  const { count, mediaBoxes, pageCount, images, streams, contentStreams, captions, fontOk, s } = parsePdf(buf);
  assert.equal(count, 2 + 3 + 1 + 1, 'catalog + pages + page + contents + image + font + free head');
  assert.equal(pageCount, 1);
  assert.deepEqual(mediaBoxes, [[640, 480]], 'small image keeps pixel-sized page');
  assert.equal(images.length, 1);
  assert.equal(images[0].len, jpg.length, 'declared /Length is the exact jpeg size');
  assert.deepEqual(Buffer.from(streams[0]), jpg, 'DCT stream round-trips the jpeg byte-for-byte');
  assert.equal(contentStreams.length, 1, 'one page content stream');
  assert.match(contentStreams[0], /\bBT\b[\s\S]*\bTj\b/, 'content stream carries real text ops');
  assert.deepEqual(captions, ['User supplied teaching image 1'], 'truthful per-image caption, no invention');
  assert.ok([...contentStreams[0]].every((c) => c.charCodeAt(0) < 128), 'caption content is ASCII-safe');
  assert.ok(fontOk, 'shared Helvetica Type1 font is embedded in resources');
  for (const bad of ['JavaScript', '/JS', '/URI', '/AA', '/OpenAction', 'http']) {
    assert.ok(!s.includes(bad), `no ${bad} anywhere in the file`);
  }
});

test('createImagePdf bounds oversized pages while keeping the aspect ratio', () => {
  const jpg = jpeg(4000, 2000);
  const buf = createImagePdf([{ jpeg: jpg, width: 4000, height: 2000 }]);
  const { mediaBoxes } = parsePdf(buf);
  assert.equal(mediaBoxes.length, 1);
  const [w, h] = mediaBoxes[0];
  assert.ok(w <= 2048 && h <= 2048, 'page fits the bound');
  assert.ok(Math.abs(w / h - 2) < 0.01, `aspect kept (got ${w}x${h})`);
  assert.equal(w, 2048, 'long side lands on the bound');
});

test('createImagePdf pages each image in order', () => {
  const a = jpeg(100, 50), b = jpeg(50, 100);
  const buf = createImagePdf([
    { jpeg: a, width: 100, height: 50 },
    { jpeg: b, width: 50, height: 100 },
  ]);
  const { pageCount, mediaBoxes, images, streams, contentStreams, captions } = parsePdf(buf);
  assert.equal(pageCount, 2);
  assert.deepEqual(mediaBoxes, [[100, 50], [50, 100]], 'page boxes follow each image aspect');
  assert.deepEqual(images.map((i) => [i.w, i.h]), [[100, 50], [50, 100]]);
  assert.deepEqual(Buffer.from(streams[0]), a);
  assert.deepEqual(Buffer.from(streams[1]), b);
  assert.equal(contentStreams.length, 2);
  assert.deepEqual(captions, ['User supplied teaching image 1', 'User supplied teaching image 2'],
    'every page gets its own numbered caption');
});

test('createImagePdf refuses non-image input', () => {
  assert.throws(() => createImagePdf([]), /no-images/);
  assert.throws(() => createImagePdf([{ jpeg: Buffer.from('not a jpeg'), width: 4, height: 4 }]), /bad-jpeg/);
  assert.throws(() => createImagePdf([{ jpeg: FAKE_JPEG, width: 0, height: 4 }]), /bad-jpeg-dims/);
  assert.throws(() => createImagePdf([{ jpeg: FAKE_JPEG, width: 20000, height: 4 }]), /bad-jpeg-dims/);
});

// ─── readTeachingMaterials: happy paths ──────────────────────────────────────
test('a PDF attachment passes through byte-for-byte under its picked name', () => withTmp(async (dir) => {
  const p = write(dir, 'notes.pdf', pdf(64));
  const out = await readTeachingMaterials([att(p)], grant(p));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'notes.pdf');
  assert.deepEqual(Buffer.from(out[0].data), fs.readFileSync(p), 'PDF bytes are untouched');
}));

test('images collapse into one multi-page teaching-images.pdf', () => withTmp(async (dir) => {
  const a = write(dir, 'a.png', png(320, 200));
  const b = write(dir, 'b.jpg', jpeg(160, 90));
  const seen = [];
  const out = await readTeachingMaterials(
    [att(a), att(b)],
    grant(a, b),
    { decodeImage: (bytes) => { seen.push(Buffer.from(bytes)); return { jpeg: FAKE_JPEG, width: 320, height: 200 }; } },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].name, IMAGES_PDF_NAME);
  assert.equal(seen.length, 2, 'decoder ran once per image');
  assert.deepEqual(seen[0], fs.readFileSync(a), 'decoder received the exact file bytes');
  const { pageCount } = parsePdf(out[0].data);
  assert.equal(pageCount, 2, 'both images became pages');
}));

test('mixed picks keep order, with the image pdf anchored at the first image', () => withTmp(async (dir) => {
  const p1 = write(dir, 'one.pdf', pdf(8));
  const i1 = write(dir, 'shot.png', png(64, 64));
  const p2 = write(dir, 'two.pdf', pdf(8));
  const out = await readTeachingMaterials(
    [att(p1), att(i1), att(p2)],
    grant(p1, i1, p2),
    { decodeImage: decodeOk() },
  );
  assert.deepEqual(out.map((o) => o.name), ['one.pdf', IMAGES_PDF_NAME, 'two.pdf']);
}));

test('the same path picked twice is read once, keeping first-seen order', () => withTmp(async (dir) => {
  const p1 = write(dir, 'a.pdf', pdf(4));
  const p2 = write(dir, 'b.pdf', pdf(4));
  const out = await readTeachingMaterials([att(p1), att(p2), att(p1, 'b.pdf'), att(p2)], grant(p1, p2));
  assert.deepEqual(out.map((o) => o.name), ['a.pdf', 'b.pdf'], 'dupes collapse in pick order');
}));

// ─── readTeachingMaterials: rejection matrix ─────────────────────────────────
test('relative paths are refused', () => withTmp(async (dir) => {
  write(dir, 'x.pdf', pdf());
  const msg = await code(readTeachingMaterials([att('x.pdf')], grant('x.pdf')));
  assert.match(msg, /not-absolute/);
}));

test('paths outside the authorized set are refused before any disk access', () => withTmp(async (dir) => {
  const real = write(dir, 'secret.pdf', pdf());
  const other = write(dir, 'picked.pdf', pdf());
  const msg = await code(readTeachingMaterials([att(real)], grant(other)));
  assert.match(msg, /unauthorized/);
  assert.ok(!msg.includes('secret') && !msg.includes(dir), 'error leaks no path or name');
}));

test('missing files and directories are refused', () => withTmp(async (dir) => {
  const ghost = path.join(dir, 'ghost.pdf');
  assert.match(await code(readTeachingMaterials([att(ghost)], grant(ghost))), /missing/);
  const sub = path.join(dir, 'sub.pdf');
  fs.mkdirSync(sub);
  assert.match(await code(readTeachingMaterials([att(sub)], grant(sub))), /not-a-file|missing/);
}));

test('a final-component symlink is refused even when authorized', (t) => withTmp(async (dir) => {
  const target = write(dir, 'target.pdf', pdf());
  const link = path.join(dir, 'link.pdf');
  try { fs.symlinkSync(target, link); } catch (e) { return t.skip(`symlinks unavailable: ${e.code}`); }
  assert.match(await code(readTeachingMaterials([att(link)], grant(link))), /link/);
}));

test('an intermediate directory symlink is refused', (t) => withTmp(async (dir) => {
  const inner = path.join(dir, 'inner');
  fs.mkdirSync(inner);
  write(inner, 'doc.pdf', pdf());
  const linkDir = path.join(dir, 'via');
  try {
    // junctions cover the same attack on Windows without needing admin rights
    fs.symlinkSync(inner, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) { return t.skip(`symlinks unavailable: ${e.code}`); }
  const through = path.join(linkDir, 'doc.pdf');
  assert.match(await code(readTeachingMaterials([att(through)], grant(through))), /link/);
}));

test('a hardlink alias of an unauthorized file cannot launder access', () => withTmp(async (dir) => {
  const secret = write(dir, 'secret.pdf', pdf());
  const alias = path.join(dir, 'alias.pdf');
  try { fs.linkSync(secret, alias); } catch { return; }
  // Only the ALIAS was picked — it is a real file, but it was never granted.
  const msg = await code(readTeachingMaterials([att(secret)], grant(alias)));
  assert.match(msg, /unauthorized/);
}));

test('a name whose extension disagrees with the path is refused', () => withTmp(async (dir) => {
  const p = write(dir, 'doc.pdf', pdf());
  assert.match(await code(readTeachingMaterials([{ path: p, name: 'doc.png' }], grant(p))), /ext-mismatch/);
}));

test('names with separators or control characters are refused', () => withTmp(async (dir) => {
  const p = write(dir, 'doc.pdf', pdf());
  assert.match(await code(readTeachingMaterials([{ path: p, name: 'sub/doc.pdf' }], grant(p))), /bad-name|ext-mismatch/);
  assert.match(await code(readTeachingMaterials([{ path: p, name: 'a\nb.pdf' }], grant(p))), /bad-name/);
}));

test('more than 32 attachments is refused outright', () => withTmp(async (dir) => {
  const p = write(dir, 'a.pdf', pdf());
  const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => att(p));
  assert.match(await code(readTeachingMaterials(many, grant(p))), /too-many/);
}));

test('a file over 10MiB is refused', () => withTmp(async (dir) => {
  const p = write(dir, 'big.pdf', pdf(MAX_FILE_BYTES)); // magic + >10MiB pad
  assert.match(await code(readTeachingMaterials([att(p)], grant(p))), /too-large/);
}));

test('a .pdf whose bytes are not PDF is refused', () => withTmp(async (dir) => {
  const p = write(dir, 'fake.pdf', png(10, 10));
  assert.match(await code(readTeachingMaterials([att(p)], grant(p))), /bad-magic/);
}));

test('an image whose signature disagrees with its extension is refused', () => withTmp(async (dir) => {
  const p = write(dir, 'notajpeg.jpg', png(10, 10));
  assert.match(await code(readTeachingMaterials([att(p)], grant(p), { decodeImage: decodeOk() })), /bad-magic/);
}));

test('tiff is rejected clearly instead of misdecoded', () => withTmp(async (dir) => {
  const p = write(dir, 'scan.tif', tiff());
  assert.match(await code(readTeachingMaterials([att(p)], grant(p), { decodeImage: decodeOk() })), /unsupported-format/);
  const fake = write(dir, 'fake.tiff', png(10, 10));
  assert.match(await code(readTeachingMaterials([att(fake)], grant(fake), { decodeImage: decodeOk() })), /bad-magic/);
}));

test('oversized image dimensions are refused from the header before decoding', () => withTmp(async (dir) => {
  let calls = 0;
  const spy = () => { calls++; return { jpeg: FAKE_JPEG, width: 10, height: 10 }; };
  const bigPx = write(dir, 'big.png', png(6000, 5000)); // 30MP > 24MP cap
  assert.match(await code(readTeachingMaterials([att(bigPx)], grant(bigPx), { decodeImage: spy })), /image-too-big/);
  const wide = write(dir, 'wide.gif', gif(MAX_IMAGE_DIMENSION + 1, 10));
  assert.match(await code(readTeachingMaterials([att(wide)], grant(wide), { decodeImage: spy })), /image-too-big/);
  const tall = write(dir, 'tall.jpg', jpeg(10, MAX_IMAGE_DIMENSION + 1));
  assert.match(await code(readTeachingMaterials([att(tall)], grant(tall), { decodeImage: spy })), /image-too-big/);
  assert.equal(calls, 0, 'decoder never ran for header-rejected images');
}));

test('bmp and webp headers get the same dimension precheck', () => withTmp(async (dir) => {
  const okB = write(dir, 'ok.bmp', bmp(64, 32));
  const outB = await readTeachingMaterials([att(okB)], grant(okB), { decodeImage: decodeOk(64, 32) });
  assert.equal(outB.length, 1);
  const okW = write(dir, 'ok.webp', webp(50, 40));
  const outW = await readTeachingMaterials([att(okW)], grant(okW), { decodeImage: decodeOk(50, 40) });
  assert.equal(outW.length, 1);
  const okL = write(dir, 'ok2.webp', webpL(50, 40));
  const outL = await readTeachingMaterials([att(okL)], grant(okL), { decodeImage: decodeOk(50, 40) });
  assert.equal(outL.length, 1, 'VP8L header parses too');
  const bigW = write(dir, 'big.webp', webp(MAX_IMAGE_DIMENSION + 1, 10));
  assert.match(await code(readTeachingMaterials([att(bigW)], grant(bigW), { decodeImage: decodeOk() })), /image-too-big/);
  const bigL = write(dir, 'big2.webp', webpL(1, MAX_IMAGE_DIMENSION + 1));
  assert.match(await code(readTeachingMaterials([att(bigL)], grant(bigL), { decodeImage: decodeOk() })), /image-too-big/);
}));

test('images need a decoder and the decoded result is re-validated', () => withTmp(async (dir) => {
  const p = write(dir, 'a.png', png(40, 30));
  assert.match(await code(readTeachingMaterials([att(p)], grant(p))), /decoder-unavailable/);
  assert.match(await code(readTeachingMaterials([att(p)], grant(p), { decodeImage: () => ({ jpeg: Buffer.from('xx'), width: 4, height: 4 }) })), /bad-decode/);
  assert.match(await code(readTeachingMaterials([att(p)], grant(p), { decodeImage: () => ({ jpeg: FAKE_JPEG, width: 9000, height: 9000 }) })), /image-too-big/);
  assert.match(await code(readTeachingMaterials([att(p)], grant(p), { decodeImage: () => { throw new Error('decoder exploded with ' + p); } })), /decode-failed/);
}));

test('total emitted size is capped at 32MiB after conversion', () => withTmp(async (dir) => {
  const each = Math.floor(MAX_TOTAL_BYTES / 4) + 8; // 4 files over the cap together
  const ps = [0, 1, 2, 3].map((i) => write(dir, `p${i}.pdf`, pdf(each)));
  assert.match(await code(readTeachingMaterials(ps.map((p) => att(p)), grant(...ps))), /total-too-large/);
}));

test('a truncated image header is refused as a bad image', () => withTmp(async (dir) => {
  const p = write(dir, 'cut.png', png(10, 10).subarray(0, 12)); // signature ok, no IHDR
  assert.match(await code(readTeachingMaterials([att(p)], grant(p), { decodeImage: decodeOk() })), /bad-image|too-large/);
}));

test('authorization normalizes case and separators on Windows', (t) => withTmp(async (dir) => {
  if (process.platform !== 'win32') return t.skip('windows-only normalization');
  const p = write(dir, 'Case File.pdf', pdf());
  const upper = p.toUpperCase();
  // granted in upper-case, requested as written — the same file must still match
  const out = await readTeachingMaterials([att(p)], grant(upper));
  assert.equal(out.length, 1);
  const slashed = write(dir, 'sub dir.pdf', pdf());
  const fwd = slashed.replace(/\\/g, '/');
  const out2 = await readTeachingMaterials([att(fwd)], grant(slashed));
  assert.equal(out2.length, 1);
}));

test('an empty pick list yields an empty result', async () => {
  assert.deepEqual(await readTeachingMaterials([], new Set()), []);
});
