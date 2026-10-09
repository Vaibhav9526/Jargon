// W4 QA harness — dump school-cast stand frames (sceneFrameBufs front[0]) to PNG.
// Usage: node tools/gen/staffroom-assets/qa/dump-cast.cjs
// Requires tools/gen/staffroom-assets/portraitArt.bundle.cjs (esbuild bundle of
// src/renderer/src/scene/office/portraitArt.ts — rebuild after recipe edits).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { sceneFrameBufs, SCENE_W, SCENE_H } = require('../portraitArt.bundle.cjs');

const OUT = __dirname;
const NAMES = ['principal', 'teacher', 'topper', 'smartguy', 'librarian'];
const SCALE = 4;
// Spec shirt colors (shared.md): the garment field each char must read as.
const SPEC = {
  principal: [0x2b, 0x39, 0x4f],
  teacher: [0xa3, 0x64, 0x4c],
  topper: [0x2b, 0x53, 0x41],
  smartguy: [0x7e, 0x94, 0x75],
  librarian: [0x36, 0x58, 0x46],
};

// ── minimal PNG encoder ──────────────────────────────────────────────────────
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_T[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function writePng(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter none
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ── helpers ──────────────────────────────────────────────────────────────────
function scaleBuf(buf, w, h, s) {
  const out = Buffer.alloc(w * s * h * s * 4);
  for (let y = 0; y < h * s; y++)
    for (let x = 0; x < w * s; x++) {
      const si = ((y / s | 0) * w + (x / s | 0)) * 4, di = (y * w * s + x) * 4;
      for (let c = 0; c < 4; c++) out[di + c] = buf[si + c];
    }
  return out;
}
// Dominant opaque color in a rect of the unscaled buffer.
function dominant(buf, x0, y0, x1, y1) {
  const m = new Map();
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * SCENE_W + x) * 4;
      if (buf[i + 3] < 255) continue;
      const k = `${buf[i]},${buf[i + 1]},${buf[i + 2]}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ── dump ─────────────────────────────────────────────────────────────────────
const frames = {};
const backs = {};
for (const name of NAMES) {
  const { front, back } = sceneFrameBufs(name);
  const stand = Buffer.from(front[0].buffer);
  frames[name] = stand;
  backs[name] = Buffer.from(back[0].buffer);
  writePng(path.join(OUT, `cast-${name}.png`), SCENE_W * SCALE, SCENE_H * SCALE,
    scaleBuf(stand, SCENE_W, SCENE_H, SCALE));
  writePng(path.join(OUT, `cast-${name}-back.png`), SCENE_W * SCALE, SCENE_H * SCALE,
    scaleBuf(backs[name], SCENE_W, SCENE_H, SCALE));
}

// contact sheet: all five stand frames side by side (4px gaps, transparent)
const gap = 4, SW = SCENE_W * SCALE, SH = SCENE_H * SCALE;
const sheetW = SW * NAMES.length + gap * (NAMES.length - 1);
for (const [file, src] of [['cast-sheet.png', frames], ['cast-sheet-back.png', backs]]) {
  const sheet = Buffer.alloc(sheetW * SH * 4);
  NAMES.forEach((name, i) => {
    const s = scaleBuf(src[name], SCENE_W, SCENE_H, SCALE);
    const xoff = i * (SW + gap);
    for (let y = 0; y < SH; y++)
      s.copy(sheet, (y * sheetW + xoff) * 4, y * SW * 4, (y + 1) * SW * 4);
  });
  writePng(path.join(OUT, file), sheetW, SH, sheet);
}

// ── report: dominant torso color vs spec + pairwise garment distance ──────────
const doms = {};
for (const name of NAMES) {
  const [k] = dominant(frames[name], 4, 20, 13, 24);
  const rgb = k.split(',').map(Number);
  doms[name] = rgb;
  console.log(`${name.padEnd(10)} torso=${k.padEnd(14)} spec=#${SPEC[name].map(v => v.toString(16).padStart(2, '0')).join('')} dist=${dist(rgb, SPEC[name]).toFixed(1)}`);
}
console.log('\npairwise torso distance:');
for (let i = 0; i < NAMES.length; i++)
  for (let j = i + 1; j < NAMES.length; j++)
    console.log(`  ${NAMES[i]} vs ${NAMES[j]}: ${dist(doms[NAMES[i]], doms[NAMES[j]]).toFixed(1)}`);
console.log('\nwrote', NAMES.length, 'frames + cast-sheet.png to', OUT);
