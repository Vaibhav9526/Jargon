'use strict';
/**
 * Procedural school-prop atlas generator for the `staffroom` theme.
 *
 * Draws every staff-room prop as flat 16px-cell pixel art — flat saturated
 * fills, dark 1px outlines, minimal shading — matching the existing
 * office-tileset.png / a5-office-floors-walls.png / interiors.png vocabulary.
 *
 * Pure Node: raw RGBA -> PNG via zlib (same approach as tools/make-logo.cjs).
 *
 * Outputs:
 *   src/renderer/src/assets/tilesets/school-props.png   16x8 atlas (256x128)
 *   tools/gen/staffroom-assets/school-atlas.json        name -> {gid,x,y,w,h}
 *
 *   node tools/gen-school-tiles.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT_PNG = path.join(ROOT, 'src/renderer/src/assets/tilesets/school-props.png');
const OUT_JSON = path.join(ROOT, 'tools/gen/staffroom-assets/school-atlas.json');

const CELL = 16;
const COLS = 16, ROWS = 10;
const W = COLS * CELL, H = ROWS * CELL;

// ── palette (sampled from the existing atlases) ─────────────────────────────
const INK = '#391624';   // dark outline used across office-tileset
const WOOD = '#a17849';  // desk wood
const WOODL = '#c1a96c'; // light wood top
const WOODD = '#7a5530'; // dark wood edge
const CREAM = '#ebe8e0'; // wall / white goods
const PAPER = '#f4f2ea';
const METAL = '#98a4b4'; // lockers / aluminium
const METALD = '#617275';// printer grey-teal
const BEZEL = '#535568'; // monitor bezel
const SCREEN = '#232339';
const MAUVE = '#b87989'; // office fabric
const MAUVED = '#894666';
const GOLD = '#d4af73';  // rug gold
const TAN = '#b7ac93';   // a5 floor tan
const TAND = '#a3967d';
const BLUE = '#79a0c0';  // vending light blue
const SKY = '#7fb8d8';
const LEAF = '#4a8c3f';
const LEAFD = '#2f5e2a';
const POT = '#b5643a';   // terracotta
const GREEN = '#3a6b4a'; // chalkboard green
const CORK = '#c98f52';
const CORKD = '#a8743c';
const RED = '#b8433a';
const ORANGE = '#c4742f';// couch orange-brown
const ORANGED = '#8f4f1d';
const RUGR = '#9e4f38';  // rug red-brown

function hx(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

// ── pixel buffer ─────────────────────────────────────────────────────────────
const buf = Buffer.alloc(W * H * 4); // transparent

function set(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const [r, g, b, a] = hx(c);
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}
function rect(x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c);
}
// outline rect: 1px border color c, fill f (skip fill if null)
function orect(x, y, w, h, c, f) {
  if (f) rect(x, y, w, h, f);
  for (let i = 0; i < w; i++) { set(x + i, y, c); set(x + i, y + h - 1, c); }
  for (let j = 0; j < h; j++) { set(x, y + j, c); set(x + w - 1, y + j, c); }
}
function hline(x, y, n, c) { for (let i = 0; i < n; i++) set(x + i, y, c); }
function vline(x, y, n, c) { for (let j = 0; j < n; j++) set(x, y + j, c); }
function disc(cx, cy, r, c) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r + r * 0.6) set(cx + x, cy + y, c);
}
function ring(cx, cy, r, c) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = x * x + y * y;
    if (d <= r * r + r * 0.6 && d > (r - 1.2) * (r - 1.2)) set(cx + x, cy + y, c);
  }
}
// seeded pseudo-random for speckles (deterministic output)
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

// helpers scoped to a prop's px origin
function prop(x0, y0, fn) { fn({ set: (x, y, c) => set(x0 + x, y0 + y, c),
  rect: (x, y, w, h, c) => rect(x0 + x, y0 + y, w, h, c),
  orect: (x, y, w, h, c, f) => orect(x0 + x, y0 + y, w, h, c, f),
  hline: (x, y, n, c) => hline(x0 + x, y0 + y, n, c),
  vline: (x, y, n, c) => vline(x0 + x, y0 + y, n, c),
  disc: (x, y, r, c) => disc(x0 + x, y0 + y, r, c),
  ring: (x, y, r, c) => ring(x0 + x, y0 + y, r, c) }); }

// ── prop painters (draw inside a w*16 x h*16 box) ────────────────────────────
const BOOKC = ['#a84c4c', '#4c6ea8', '#4ca86e', GOLD, CREAM, '#7d5aa8', '#c46a3a'];
function bookRow(g, x, y, w, rnd) {
  for (let i = 0; i < w; i++) {
    if (rnd() < 0.14) continue; // gap
    g.vline(x + i, y, 7 + ((i * 7) % 3), BOOKC[(i * 5) % BOOKC.length]);
  }
}

const painters = {
  chalkboard(g) { // 4x2: green board + wood frame + chalk marks
    g.orect(0, 0, 64, 32, INK, WOOD);
    g.rect(2, 2, 60, 28, WOODD);           // inner shadow under frame
    g.rect(3, 3, 58, 25, GREEN);
    g.rect(3, 3, 58, 2, '#2d5739');        // top inner shade
    g.hline(8, 10, 18, '#b9c4ae'); g.hline(8, 12, 12, '#b9c4ae');
    g.hline(32, 9, 14, '#b9c4ae'); g.hline(32, 11, 20, '#b9c4ae'); g.hline(40, 14, 8, '#b9c4ae');
    g.hline(12, 18, 24, '#a4b49a');        // fainter line
    g.rect(4, 27, 20, 3, WOODL);           // chalk tray
    g.hline(6, 28, 4, CREAM);              // chalk stick
    g.vline(30, 28, 1, '#b8433a');
  },
  whiteboard(g) { // 3x2: white board + metal frame + marker scribbles
    g.orect(0, 0, 48, 32, INK, METAL);
    g.rect(2, 2, 44, 26, PAPER);
    g.hline(6, 8, 14, RED); g.hline(6, 10, 10, '#3a6bc4');
    g.hline(26, 7, 16, '#3a6bc4'); g.hline(26, 9, 8, GREEN);
    g.vline(12, 14, 6, RED); g.hline(12, 19, 6, RED);
    g.hline(28, 15, 12, '#333333'); g.hline(28, 17, 6, '#333333');
    g.rect(2, 28, 44, 2, '#8a93a4');       // tray
    g.hline(8, 29, 5, '#555566');          // markers on tray
    g.vline(30, 28, 1, RED);
  },
  bulletin(g) { // 3x2: cork board + pinned papers
    g.orect(0, 0, 48, 32, INK, WOOD);
    g.rect(2, 2, 44, 28, CORK);
    const r = rng(7);
    for (let i = 0; i < 60; i++) g.set(3 + ((r() * 42) | 0), 3 + ((r() * 26) | 0), CORKD);
    const papers = [[6, 6], [20, 5], [33, 8], [8, 19], [24, 18], [35, 20]];
    for (const [px, py] of papers) {
      g.orect(px, py, 7, 9, '#8a6a4a', PAPER);
      g.set(px + 3, py + 1, RED);
      g.hline(px + 1, py + 4, 5, '#9a9aa2'); g.hline(px + 1, py + 6, 4, '#9a9aa2');
    }
  },
  window(g) { // 3x2: blue panes + white frame + brown sill
    g.orect(0, 0, 48, 32, INK, CREAM);
    g.rect(2, 2, 44, 24, SKY);
    g.rect(2, 2, 44, 3, '#a8d4e8');        // light at top
    g.set(10, 8, '#e8f4f8'); g.set(11, 8, '#e8f4f8'); g.set(11, 9, '#e8f4f8'); // cloud
    g.set(32, 14, '#e8f4f8'); g.set(33, 14, '#e8f4f8'); g.set(34, 15, '#e8f4f8');
    g.vline(23, 2, 24, CREAM);             // mullions
    g.hline(2, 13, 44, CREAM);
    g.rect(0, 26, 48, 6, WOOD);            // sill
    g.hline(0, 26, 48, WOODL); g.hline(0, 31, 48, INK);
  },
  lockers(g) { // 3x2: three grey-blue lockers
    g.orect(0, 0, 48, 32, INK, '#7a8ba0');
    for (let i = 0; i < 3; i++) {
      const x = 2 + i * 15;
      g.orect(x, 2, 14, 27, INK, METAL);
      g.rect(x + 1, 3, 12, 2, '#aab6c4');
      g.hline(x + 4, 8, 6, METALD); g.hline(x + 4, 10, 6, METALD); // vents
      g.vline(x + 10, 15, 3, '#4a5464');   // handle
      g.hline(x + 4, 24, 6, '#8a96a6');    // label slot
    }
    g.hline(0, 31, 48, INK);
  },
  'desk-pc': (g) => deskPc(g, false),
  'desk-teacher': (g) => deskPc(g, 'teacher'),
  'desk-principal': (g) => deskPc(g, 'principal'),
  chair(g) { // 1x1: wooden chair, top-down
    g.orect(3, 1, 10, 4, INK, WOODD);      // backrest
    g.rect(4, 2, 8, 2, WOOD);
    g.orect(2, 6, 12, 8, INK, WOOD);       // seat
    g.rect(4, 7, 8, 6, WOODL);
    g.hline(4, 8, 8, WOOD);                // seat crease
    g.vline(3, 14, 2, WOODD); g.vline(12, 14, 2, WOODD); // front legs
  },
  'chair-office': (g) => { // 1x1: black swivel chair
    g.disc(8, 9, 5, '#33333e');
    g.disc(8, 9, 3, '#4a4a56');
    g.rect(5, 2, 6, 3, INK);               // backrest
    g.set(3, 13, INK); g.set(12, 13, INK); g.set(8, 14, INK); // base spokes
  },
  bookshelf(g) { // 2x2: tall bookcase, two shelf rows
    g.orect(0, 0, 32, 32, INK, WOOD);
    g.rect(2, 2, 28, 12, '#5e4632');       // shelf interior
    g.rect(2, 16, 28, 12, '#5e4632');
    const r1 = rng(11), r2 = rng(23);
    bookRow({ vline: (x, y, n, c) => g.vline(x, y, n, c) }, 4, 5, 24, r1);
    bookRow({ vline: (x, y, n, c) => g.vline(x, y, n, c) }, 4, 19, 24, r2);
    g.rect(2, 13, 28, 3, WOODL);           // shelf boards
    g.rect(2, 29, 28, 2, WOODL);
    g.orect(0, 0, 32, 32, INK, null);
  },
  'bookshelf-wide': (g) => { // 3x1: low bookcase
    g.orect(0, 0, 48, 16, INK, WOOD);
    g.rect(2, 2, 44, 10, '#5e4632');
    const r = rng(31);
    bookRow({ vline: (x, y, n, c) => g.vline(x, y, n, c) }, 4, 4, 40, r);
    g.rect(2, 12, 44, 3, WOODL);
    g.orect(0, 0, 48, 16, INK, null);
  },
  couch(g) { // 2x1: orange two-seater
    g.orect(0, 3, 32, 13, INK, ORANGE);
    g.rect(2, 0, 13, 6, ORANGE);           // back cushions
    g.rect(17, 0, 13, 6, ORANGE);
    g.orect(2, 0, 13, 6, INK, null); g.orect(17, 0, 13, 6, INK, null);
    g.rect(0, 3, 4, 13, ORANGED);          // armrests
    g.rect(28, 3, 4, 13, ORANGED);
    g.orect(0, 3, 4, 13, INK, null); g.orect(28, 3, 4, 13, INK, null);
    g.hline(5, 9, 22, ORANGED);            // seat crease
    g.hline(5, 14, 22, '#7d4318');         // base shade
  },
  armchair(g) { // 1x1
    g.orect(2, 5, 12, 10, INK, ORANGE);
    g.rect(4, 1, 8, 6, ORANGE); g.orect(4, 1, 8, 6, INK, null);
    g.rect(2, 5, 3, 10, ORANGED); g.rect(11, 5, 3, 10, ORANGED);
    g.orect(2, 5, 3, 10, INK, null); g.orect(11, 5, 3, 10, INK, null);
    g.hline(5, 9, 6, ORANGED); g.hline(5, 13, 6, '#7d4318');
  },
  'coffee-table': (g) => { // 2x1: low wood table + magazines + mug
    g.orect(0, 3, 32, 10, INK, WOOD);
    g.rect(2, 5, 28, 6, WOODL);
    g.orect(6, 6, 6, 4, INK, '#a84c4c');   // magazine
    g.orect(13, 7, 5, 3, INK, '#4c6ea8');
    g.orect(23, 5, 4, 4, INK, CREAM);      // mug
    g.set(27, 6, CREAM);                   // mug handle
    g.hline(0, 13, 32, WOODD);
  },
  'coffee-machine': (g) => { // 1x1: espresso machine + cup
    g.orect(3, 1, 10, 10, INK, '#4a4450');
    g.rect(4, 2, 8, 2, '#6a6474');
    g.set(5, 5, RED);                      // power light
    g.rect(7, 6, 2, 3, '#2e2a36');         // spout
    g.orect(6, 10, 4, 4, INK, CREAM);      // cup
    g.hline(2, 14, 12, '#3a3440');
  },
  'water-cooler': (g) => { // 1x1
    g.orect(4, 0, 8, 6, INK, BLUE);        // bottle
    g.rect(5, 1, 6, 2, '#9cc4e0');
    g.orect(3, 6, 10, 9, INK, CREAM);      // body
    g.set(7, 8, METALD); g.set(9, 8, METALD); // taps
    g.rect(6, 11, 4, 3, '#d0d2d4');        // cup tray
    g.hline(2, 15, 12, INK);
  },
  'filing-cabinet': (g) => { // 1x2: grey 4-drawer
    g.orect(2, 0, 12, 31, INK, METAL);
    for (let d = 0; d < 4; d++) {
      const y = 1 + d * 8;
      g.orect(3, y, 10, 7, '#6a7688', '#98a4b4');
      g.hline(5, y + 3, 6, '#4a5464');     // handle
      g.hline(5, y + 5, 6, '#8a96a6');     // label
    }
    g.hline(2, 31, 12, INK);
  },
  printer(g) { // 1x1: beige printer + paper
    g.rect(6, 1, 4, 2, PAPER);             // paper sticking up
    g.orect(6, 0, 4, 3, INK, PAPER);
    g.hline(7, 1, 2, '#9a9aa2');
    g.orect(2, 4, 12, 8, INK, '#d8d0c0');
    g.hline(4, 6, 8, '#4a4a52');           // slot
    g.set(12, 5, '#4ca86e');               // green LED
    g.rect(4, 8, 8, 3, PAPER);             // output paper
    g.hline(2, 12, 12, INK);
  },
  vending(g) { // 1x2: snack machine, lit front
    g.orect(1, 0, 14, 31, INK, '#2e3a46');
    g.orect(3, 3, 7, 16, INK, '#1c2836');  // glass front
    const cans = ['#c0392b', '#d4af73', '#4ca86e', '#4c6ea8', '#e0e0e0'];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++)
      g.rect(4 + c * 3, 5 + r * 5, 2, 3, cans[(r * 2 + c) % cans.length]);
    g.rect(11, 4, 3, 9, '#48586a');        // keypad column
    g.set(12, 5, RED); g.set(12, 7, CREAM); g.set(12, 9, CREAM);
    g.rect(3, 22, 10, 4, '#1a2430');       // pickup slot
    g.hline(1, 30, 14, INK);
  },
  reception(g) { // 4x2: long counter + bell + papers
    g.rect(0, 0, 64, 10, WOODL);           // counter top
    g.hline(0, 9, 64, '#8a6a4a');
    g.rect(0, 10, 64, 22, WOOD);           // front face
    for (let p = 0; p < 4; p++) {          // front panels
      g.orect(4 + p * 15, 14, 12, 14, WOODD, null);
    }
    g.orect(0, 0, 64, 32, INK, null);
    g.disc(50, 6, 3, GOLD); g.set(50, 3, INK);   // service bell
    g.orect(8, 4, 7, 5, '#8a6a4a', PAPER);       // papers
    g.hline(9, 6, 5, '#9a9aa2');
  },
  tv(g) { // 2x1: wall TV, dark screen
    g.orect(0, 1, 32, 12, INK, '#2a2a34');
    g.rect(2, 3, 28, 8, '#1e2830');
    g.rect(3, 4, 12, 3, '#31404e');        // sheen
    g.rect(14, 13, 4, 2, '#1a1a22');       // mount stub
  },
  clock(g) { // 1x1: round wall clock
    g.disc(8, 8, 6, INK);
    g.disc(8, 8, 5, WOOD);
    g.disc(8, 8, 4, PAPER);
    g.vline(8, 4, 2, INK);                 // 12 tick
    g.vline(8, 5, 4, INK);                 // hands
    g.hline(8, 8, 3, INK);
    g.set(9, 9, RED);
  },
  calendar(g) { // 1x1: red-header wall calendar
    g.orect(3, 2, 10, 13, INK, PAPER);
    g.rect(3, 2, 10, 4, RED);
    g.hline(5, 3, 6, '#e0a0a0');           // header text hint
    g.set(8, 1, INK);                      // pin
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++)
      g.set(5 + c * 3, 8 + r * 3, '#9a9aa2');
    g.hline(4, 14, 8, '#c8c8c8');
  },
  'whiteboard-stand': (g) => { // 2x2: easel whiteboard
    g.orect(3, 1, 26, 18, INK, METAL);
    g.rect(5, 3, 22, 14, PAPER);
    g.hline(8, 7, 10, '#3a6bc4'); g.hline(8, 9, 6, '#3a6bc4');
    g.hline(20, 8, 5, RED); g.vline(12, 12, 3, GREEN);
    g.vline(6, 19, 10, WOODD); g.vline(25, 19, 10, WOODD); // legs
    g.set(6, 29, INK); g.set(25, 29, INK);
    g.hline(10, 24, 12, WOODD);            // crossbar
  },
  globe(g) { // 1x1: desk globe on stand
    g.disc(8, 6, 5, '#3a7ac4');
    g.set(6, 4, GREEN); g.set(7, 5, GREEN); g.set(10, 6, GREEN);
    g.set(6, 8, GREEN); g.set(9, 3, '#e0d8c0');
    g.ring(8, 6, 6, GOLD);                 // meridian arc
    g.rect(6, 12, 4, 2, WOODD);            // stand
    g.orect(4, 14, 8, 2, INK, WOOD);       // base
  },
  rug(g) { // 3x2: patterned red-brown rug
    g.orect(0, 0, 48, 32, INK, RUGR);
    g.orect(3, 3, 42, 26, GOLD, null);
    g.orect(6, 6, 36, 20, '#8a4030', null);
    const r = rng(41);
    for (let i = 0; i < 14; i++)
      g.set(9 + ((r() * 30) | 0), 9 + ((r() * 14) | 0), GOLD);
    g.hline(10, 15, 6, GOLD); g.hline(32, 16, 6, GOLD);
    g.set(23, 14, GOLD); g.set(24, 15, GOLD); g.set(23, 17, GOLD);
  },
  counter(g) { // 4x1: long counter + sink
    g.rect(0, 0, 64, 6, WOODL);            // top
    g.orect(26, 1, 14, 4, '#6a7688', '#aebcc8'); // sink basin
    g.vline(33, 0, 1, METALD);             // faucet
    g.rect(0, 6, 64, 10, WOOD);
    for (let p = 0; p < 4; p++) g.orect(4 + p * 15, 8, 12, 6, WOODD, null);
    g.orect(0, 0, 64, 16, INK, null);
  },
  'table-meeting': (g) => { // 3x2: light wood meeting table
    g.orect(0, 2, 48, 26, INK, WOODL);
    g.rect(2, 4, 44, 22, '#cbb480');
    g.hline(4, 10, 40, '#b89f68'); g.hline(4, 18, 40, '#b89f68'); // grain
    g.set(3, 3, '#e0cf9a');
    g.rect(3, 28, 3, 3, WOODD); g.rect(42, 28, 3, 3, WOODD); // legs
    g.orect(0, 2, 48, 26, INK, null);
  },
  plant(g) { // 1x1: potted plant
    g.set(5, 2, LEAF); g.set(8, 1, LEAF); g.set(10, 2, LEAF);
    g.set(4, 4, LEAF); g.set(7, 3, LEAFD); g.set(11, 4, LEAF);
    g.set(6, 5, LEAF); g.set(9, 4, LEAFD); g.set(5, 6, LEAF); g.set(10, 6, LEAF);
    g.vline(8, 3, 5, LEAFD);
    g.orect(4, 8, 8, 7, INK, POT);         // pot
    g.rect(5, 9, 6, 2, '#c97a4e');         // pot rim light
    g.hline(4, 8, 8, '#8a4526');
  },
  'plant-big': (g) => { // 1x2: bushy ficus
    const r = rng(53);
    for (let y = 1; y <= 16; y++) for (let x = 1; x <= 14; x++) {
      const dx = (x - 7.5) / 6.8, dy = (y - 8.5) / 8.2;
      if (dx * dx + dy * dy < 0.82) {
        const v = r();
        g.set(x, y, v < 0.22 ? LEAFD : v < 0.8 ? LEAF : '#5ea34f');
      }
    }
    // leaf-tip sparkle pixels on the silhouette edge
    g.set(2, 5, '#5ea34f'); g.set(13, 6, '#5ea34f'); g.set(4, 2, LEAF);
    g.set(11, 3, LEAF); g.set(7, 1, '#5ea34f');
    g.vline(8, 10, 8, '#5a4632');          // trunk
    g.orect(3, 20, 10, 11, INK, POT);
    g.rect(4, 21, 8, 2, '#c97a4e');
    g.hline(3, 20, 10, '#8a4526');
  },
  'floor-a': (g) => floorTile(g, 61),
  'floor-b': (g) => floorTile(g, 97),
  'floor-study': (g) => {
    g.rect(0, 0, 16, 16, '#dedcc4');
    g.hline(0, 15, 16, '#c7c5ac');
    g.vline(15, 0, 16, '#c7c5ac');
    g.set(3, 3, '#eae8d3');
  },
  'floor-lounge': (g) => {
    g.rect(0, 0, 16, 16, '#668579');
    for (let y = 2; y < 16; y += 4) {
      for (let x = 2; x < 16; x += 4) g.set(x, y, '#739185');
    }
  },
  'floor-office': (g) => {
    g.rect(0, 0, 16, 16, '#c7a475');
    g.hline(0, 7, 16, '#b18f64');
    g.hline(0, 15, 16, '#b18f64');
    g.hline(3, 3, 8, '#d4b487');
    g.hline(6, 11, 7, '#d4b487');
  },
  'sign-study': (g) => schoolSign(g, 'STAFF ROOM'),
  'sign-principal': (g) => schoolSign(g, 'PRINCIPAL'),
  'sign-meeting': (g) => schoolSign(g, 'MEETING'),
  'sign-lounge': (g) => schoolSign(g, 'LOUNGE'),
  wall(g) { // 1x1: warm brown wall panel
    g.rect(0, 0, 16, 16, '#8a6b4a');
    g.hline(0, 0, 16, '#a5855e');          // top light
    g.hline(0, 15, 16, '#6b5036');         // bottom shade
    g.vline(0, 0, 16, '#7d5f40'); g.vline(15, 0, 16, '#7d5f40');
  },
  door(g) { // 1x2: wooden door in frame
    g.orect(0, 0, 16, 32, INK, WOODD);     // frame
    g.orect(3, 2, 10, 29, '#5e4632', WOOD);
    g.orect(5, 5, 6, 8, WOODD, '#9a7440'); // upper panel
    g.orect(5, 16, 6, 10, WOODD, '#9a7440');// lower panel
    g.set(11, 16, GOLD); g.set(12, 16, INK); // knob
    g.hline(0, 31, 16, INK);
  },
};

function deskPc(g, kind) { // 3x2 desk+monitor stamp
  const woodBase = kind === 'principal' ? '#7a4f2c' : WOOD;
  const woodTop = kind === 'principal' ? '#9a6a40' : WOODL;
  g.orect(0, 4, 48, 27, INK, woodBase);    // desk body
  g.rect(2, 6, 44, 12, woodTop);           // desktop
  g.hline(0, 30, 48, WOODD);               // front shade
  g.orect(12, 6, 14, 9, INK, BEZEL);       // monitor
  g.rect(14, 8, 10, 5, SCREEN);
  g.set(15, 8, '#4a6a8a');
  g.rect(17, 15, 4, 2, BEZEL);             // stand neck
  g.orect(13, 18, 14, 4, INK, '#8a93a4');  // keyboard
  for (let k = 0; k < 6; k++) g.set(15 + k * 2, 19, '#5a6274');
  if (kind === 'teacher') {
    g.disc(36, 9, 3, RED); g.set(36, 5, LEAF);   // apple
    g.orect(30, 16, 9, 6, '#8a6a4a', PAPER);     // papers
    g.hline(31, 18, 7, '#9a9aa2'); g.hline(31, 20, 5, '#9a9aa2');
  } else if (kind === 'principal') {
    g.orect(33, 12, 10, 5, INK, GOLD);           // nameplate
    g.hline(35, 14, 6, '#6a5030');
    g.orect(5, 9, 6, 7, INK, '#3a3a44');         // phone
    g.orect(30, 20, 8, 5, '#8a6a4a', PAPER);
    g.hline(31, 22, 6, '#9a9aa2');
  } else {
    g.orect(35, 7, 4, 5, INK, CREAM);            // mug
    g.set(39, 8, CREAM);
    g.orect(4, 9, 4, 5, INK, POT);               // small plant pot
    g.set(5, 7, LEAF); g.set(6, 6, LEAF); g.set(7, 7, LEAF);
    g.rect(31, 18, 10, 6, '#3a3a44');            // mousepad
    g.set(35, 20, '#9a9aa2');
  }
}

function schoolSign(g, text) {
  const glyphs = {
    A: ['010', '101', '111', '101', '101'], C: ['011', '100', '100', '100', '011'],
    E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
    G: ['011', '100', '101', '101', '011'], I: ['111', '010', '010', '010', '111'],
    L: ['100', '100', '100', '100', '111'], M: ['101', '111', '111', '101', '101'],
    N: ['101', '111', '111', '111', '101'], O: ['010', '101', '101', '101', '010'],
    P: ['110', '101', '110', '100', '100'], R: ['110', '101', '110', '101', '101'],
    S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
    U: ['101', '101', '101', '101', '111']
  };
  g.orect(1, 2, 62, 12, INK, WOODL);
  g.rect(3, 4, 58, 8, PAPER);
  const left = Math.floor((64 - text.length * 4 + 1) / 2);
  [...text].forEach((letter, i) => {
    (glyphs[letter] ?? []).forEach((row, y) => {
      [...row].forEach((pixel, x) => {
        if (pixel === '1') g.set(left + i * 4 + x, y + 5, GREEN);
      });
    });
  });
}

function floorTile(g, seed) { // 1x1 tan floor, subtle grain
  g.rect(0, 0, 16, 16, seed === 61 ? '#e5dfcb' : '#e2dcc8');
  const r = rng(seed);
  for (let i = 0; i < 3; i++) g.set((r() * 16) | 0, (r() * 16) | 0, '#d6cfbb');
  g.hline(0, 15, 16, '#d9d2bf');            // plank seams
  g.vline(15, 0, 16, '#d9d2bf');
}

// ── pack props into the atlas ────────────────────────────────────────────────
// [name, cellX, cellY, cellW, cellH]
const layout = [
  ['chalkboard', 0, 0, 4, 2], ['whiteboard', 4, 0, 3, 2], ['bulletin', 7, 0, 3, 2],
  ['window', 10, 0, 3, 2], ['lockers', 13, 0, 3, 2],
  ['desk-pc', 0, 2, 3, 2], ['desk-teacher', 3, 2, 3, 2], ['desk-principal', 6, 2, 3, 2],
  ['whiteboard-stand', 9, 2, 2, 2], ['plant-big', 11, 2, 1, 2], ['filing-cabinet', 12, 2, 1, 2],
  ['vending', 13, 2, 1, 2], ['door', 14, 2, 1, 2],
  ['bookshelf', 0, 4, 2, 2], ['rug', 2, 4, 3, 2], ['table-meeting', 5, 4, 3, 2],
  ['reception', 8, 4, 4, 2],
  ['bookshelf-wide', 0, 6, 3, 1], ['couch', 3, 6, 2, 1], ['coffee-table', 5, 6, 2, 1],
  ['tv', 7, 6, 2, 1], ['counter', 9, 6, 4, 1],
  ['chair', 0, 7, 1, 1], ['chair-office', 1, 7, 1, 1], ['armchair', 2, 7, 1, 1],
  ['coffee-machine', 3, 7, 1, 1], ['water-cooler', 4, 7, 1, 1], ['printer', 5, 7, 1, 1],
  ['clock', 6, 7, 1, 1], ['calendar', 7, 7, 1, 1], ['globe', 8, 7, 1, 1],
  ['plant', 9, 7, 1, 1], ['floor-a', 10, 7, 1, 1], ['floor-b', 11, 7, 1, 1],
  ['wall', 12, 7, 1, 1],
  ['floor-study', 13, 7, 1, 1], ['floor-lounge', 14, 7, 1, 1], ['floor-office', 15, 7, 1, 1],
  ['sign-study', 0, 8, 4, 1], ['sign-principal', 4, 8, 4, 1],
  ['sign-meeting', 8, 8, 4, 1], ['sign-lounge', 12, 8, 4, 1],
];

const atlas = {};
for (const [name, cx, cy, cw, ch] of layout) {
  const fn = painters[name];
  if (!fn) { console.error('no painter for', name); process.exit(1); }
  prop(cx * CELL, cy * CELL, fn);
  atlas[name] = { gid: cy * COLS + cx, x: cx, y: cy, w: cw, h: ch };
}

// ── PNG encode (make-logo.cjs approach) ─────────────────────────────────────
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8);
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

fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
fs.writeFileSync(OUT_PNG, encodePng(W, H, buf));
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify({
  image: 'school-props.png', tilewidth: CELL, tileheight: CELL,
  columns: COLS, tilecount: COLS * ROWS, props: atlas,
}, null, 2));
console.log(`wrote ${OUT_PNG} (${W}x${H})`);
console.log(`wrote ${OUT_JSON} (${Object.keys(atlas).length} props)`);
