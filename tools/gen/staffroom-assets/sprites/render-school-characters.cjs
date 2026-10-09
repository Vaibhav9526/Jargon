'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const art = require('../../../../test/load-ts.cjs')('src/renderer/src/scene/office/portraitArt.ts');
const names = ['principal', 'teacher', 'topper', 'smartguy', 'librarian'];
const scale = 6, cellW = 128, cellH = 210, width = cellW * 7, height = cellH * 5;
const sheet = Buffer.alloc(width * height * 4);
const backgrounds = [[238, 231, 208], [208, 219, 197], [238, 231, 208], [208, 219, 197], [166, 109, 87], [208, 219, 197], [238, 231, 208]];
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = -1;
  for (const byte of content) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  const len = Buffer.alloc(4), checksum = Buffer.alloc(4);
  len.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ -1) >>> 0);
  return Buffer.concat([len, content, checksum]);
}
function png(w, h, rgba) {
  const hdr = Buffer.alloc(13); hdr.writeUInt32BE(w); hdr.writeUInt32BE(h, 4); hdr[8] = 8; hdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(rgba).copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4, color = backgrounds[Math.floor(x / cellW)];
  sheet.set([...color, 255], i);
}
names.forEach((name, row) => {
  const portrait = art.portraitBuf(name), frames = art.sceneFrameBufs(name);
  const buffers = [portrait, ...frames.front, ...frames.back];
  buffers.forEach((buf, col) => {
    const h = col === 0 ? 28 : 32;
    for (let y = 0; y < h; y++) for (let x = 0; x < 18; x++) {
      const src = (y * 18 + x) * 4;
      if (!buf[src + 3]) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const dst = ((row * cellH + 8 + y * scale + dy) * width + col * cellW + 10 + x * scale + dx) * 4;
        sheet.set(buf.subarray(src, src + 4), dst);
      }
    }
  });
  fs.writeFileSync(path.join(__dirname, `${name}-rebuilt-portrait.png`), png(18, 28, portrait));
  const walk = Buffer.alloc(18 * 6 * 32 * 4);
  [...frames.front, ...frames.back].forEach((frame, col) => {
    for (let y = 0; y < 32; y++) Buffer.from(frame).copy(walk, (y * 108 + col * 18) * 4, y * 72, (y + 1) * 72);
  });
  fs.writeFileSync(path.join(__dirname, `${name}-rebuilt-walk.png`), png(108, 32, walk));
  console.log(name, 'portrait + front stand/left/right + back stand/left/right');
});
fs.writeFileSync(path.join(__dirname, 'school-character-contact-sheet.png'), png(width, height, sheet));
console.log('wrote school-character-contact-sheet.png; rows:', names.join(', '));
