'use strict';
/**
 * Render QA contact sheet for the procedural staffroom sprites.
 *
 * Compiles portraitArt.ts with esbuild (no DOM needed — sceneFrameBufs is pure
 * buffer math), pulls the front/back walk frames for the 5 school cast names,
 * and writes procedural-contact-sheet.png next to this script: one row per
 * character, columns [front stand, front stepL, front stepR, back stand].
 *
 *   node render-contact-sheet.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = path.join(ROOT, 'src', 'renderer', 'src', 'scene', 'office', 'portraitArt.ts');
const OUT_CJS = path.join(__dirname, '.portraitArt.cjs');
const OUT_PNG = path.join(__dirname, 'procedural-contact-sheet.png');
const NAMES = ['principal', 'teacher', 'topper', 'smartguy', 'librarian'];
const SCALE = 8, GAP = 8, BG = [36, 34, 44];

// minimal RGBA PNG encoder (filter: none), arbitrary w×h
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

require('esbuild').buildSync({
  entryPoints: [SRC], bundle: true, format: 'cjs', platform: 'node',
  outfile: OUT_CJS, logLevel: 'silent',
});
const { sceneFrameBufs, SCENE_W, SCENE_H } = require(OUT_CJS);

const COLS = 4; // front stand, front stepL, front stepR, back stand
const W = COLS * SCENE_W * SCALE + (COLS + 1) * GAP;
const H = NAMES.length * SCENE_H * SCALE + (NAMES.length + 1) * GAP;
const sheet = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { sheet[i * 4] = BG[0]; sheet[i * 4 + 1] = BG[1]; sheet[i * 4 + 2] = BG[2]; sheet[i * 4 + 3] = 255; }

function blit(buf, ox, oy) {
  for (let y = 0; y < SCENE_H; y++) {
    for (let x = 0; x < SCENE_W; x++) {
      const si = (y * SCENE_W + x) * 4;
      if (buf[si + 3] === 0) continue;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const di = ((oy + y * SCALE + dy) * W + ox + x * SCALE + dx) * 4;
          sheet[di] = buf[si]; sheet[di + 1] = buf[si + 1];
          sheet[di + 2] = buf[si + 2]; sheet[di + 3] = buf[si + 3];
        }
      }
    }
  }
}

NAMES.forEach((name, row) => {
  const { front, back } = sceneFrameBufs(name);
  const sprites = [front[0], front[1], front[2], back[0]];
  const oy = GAP + row * (SCENE_H * SCALE + GAP);
  sprites.forEach((buf, col) => blit(buf, GAP + col * (SCENE_W * SCALE + GAP), oy));
  console.log(name.padEnd(10), 'rendered', front.length + back.length, 'frames');
});

fs.writeFileSync(OUT_PNG, encodePng(W, H, sheet));
console.log('wrote', OUT_PNG);
