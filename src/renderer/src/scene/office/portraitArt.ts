// Procedural portraits for The Office cast.
//
// These are fully custom-drawn busts (NOT recolored LimeZu sprites): each
// character is an explicit recipe layering skin → clothing → face → facial hair
// → hairstyle → glasses on an 18×28 canvas. This gives real control over each
// person's hairstyle shape, garment cut/color, and facial hair so they read as
// the specific show character. The in-scene walking sprites still use the LimeZu
// recolor in cast.ts; this module only powers the static portraits in the UI.

import type { OfficeCharacterName } from './cast';

export const PORTRAIT_W = 18;
export const PORTRAIT_H = 28;
// In-scene walking sprite: same width + upper body as the portrait, taller to add legs.
export const SCENE_W = 18;
export const SCENE_H = 32;
const OUTLINE: RGB = [38, 34, 46];
const HX0 = 4, HX1 = 13; // head skin columns

type RGB = [number, number, number];
type Buf = Uint8ClampedArray;

// Current canvas dims — set per compose() so the same drawing primitives serve
// both the 18×28 portrait and the 18×32 scene sprite. (Rendering is synchronous.)
let CUR_W = PORTRAIT_W, CUR_H = PORTRAIT_H;

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
function shades(rgb: RGB, dl = 1.22, dd = 0.68): [RGB, RGB, RGB] {
  return [
    [clamp(rgb[0] * dl), clamp(rgb[1] * dl), clamp(rgb[2] * dl)],
    [rgb[0], rgb[1], rgb[2]],
    [clamp(rgb[0] * dd), clamp(rgb[1] * dd), clamp(rgb[2] * dd)],
  ];
}

function set(buf: Buf, x: number, y: number, c: RGB, a = 255): void {
  if (x < 0 || x >= CUR_W || y < 0 || y >= CUR_H) return;
  const i = (y * CUR_W + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
}
function alphaAt(buf: Buf, x: number, y: number): number {
  if (x < 0 || x >= CUR_W || y < 0 || y >= CUR_H) return 0;
  return buf[(y * CUR_W + x) * 4 + 3];
}
function rgbAt(buf: Buf, x: number, y: number): RGB {
  const i = (y * CUR_W + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2]];
}
function eq(a: RGB, b: RGB): boolean { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
function rect(buf: Buf, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(buf, x, y, c);
}

// ─── palettes ────────────────────────────────────────────────────────────────
interface SkinPal { hi: RGB; base: RGB; sh: RGB; line: RGB; }
const SKIN: Record<string, SkinPal> = {
  light: { hi: [255, 221, 189], base: [247, 201, 170], sh: [212, 158, 126], line: [168, 112, 82] },
  tan:   { hi: [232, 182, 136], base: [214, 162, 116], sh: [176, 126, 86],  line: [138, 92, 60] },
  brown: { hi: [180, 130, 94],  base: [158, 112, 78],  sh: [124, 86, 58],   line: [90, 60, 40] },
  dark:  { hi: [142, 98, 70],   base: [120, 80, 56],   sh: [94, 62, 42],    line: [64, 42, 28] },
};

// ─── head + face ─────────────────────────────────────────────────────────────
function drawHead(buf: Buf, skin: string): void {
  const s = SKIN[skin];
  for (let y = 4; y <= 16; y++) {
    for (let x = HX0; x <= HX1; x++) {
      if (((x === HX0 || x === HX1) && (y === 4 || y === 5 || y === 16)) || ((x === 5 || x === 12) && y === 4)) continue;
      set(buf, x, y, s.base);
    }
  }
  for (let y = 6; y < 12; y++) set(buf, 5, y, s.hi);
  set(buf, 6, 5, s.hi); set(buf, 7, 5, s.hi);
  for (let y = 6; y < 15; y++) set(buf, 12, y, s.sh);
  for (const x of [7, 8, 9, 10, 11]) set(buf, x, 16, s.sh);
  for (const ex of [HX0 - 1, HX1 + 1]) { set(buf, ex, 9, s.base); set(buf, ex, 10, s.base); set(buf, ex, 11, s.sh); }
  rect(buf, 7, 17, 10, 18, s.sh); rect(buf, 7, 17, 9, 17, s.base);
}

type Brow = 'flat' | 'angry' | 'raised' | 'soft';
type Mouth = 'neutral' | 'smile' | 'frown' | 'grin' | 'smirk';
function drawFace(buf: Buf, skin: string, brow: Brow, mouth: Mouth, blush: boolean, lashes = false): void {
  const s = SKIN[skin];
  const white: RGB = [250, 248, 244], pup: RGB = [46, 38, 42];
  for (const [a, b, p] of [[5, 6, 6], [10, 11, 10]] as const) {
    set(buf, a, 9, white); set(buf, b, 9, white); set(buf, p, 9, pup);
  }
  // Feminine eyes: a dark upper lash line + an outer flick, and a bright glint
  // in each pupil so they read as bigger, rounder, more expressive.
  if (lashes) {
    const lash: RGB = [54, 40, 48], glint: RGB = [252, 250, 248];
    for (const x of [5, 6, 10, 11]) set(buf, x, 8, lash);
    set(buf, 4, 8, lash); set(buf, 12, 8, lash);
    set(buf, 5, 9, glint); set(buf, 10, 9, glint);
  }
  if (brow === 'flat') for (const x of [5, 6, 10, 11]) set(buf, x, 7, s.line);
  else if (brow === 'angry') { set(buf, 5, 8, s.line); set(buf, 6, 7, s.line); set(buf, 10, 7, s.line); set(buf, 11, 8, s.line); }
  else if (brow === 'raised') for (const x of [5, 6, 10, 11]) set(buf, x, 6, s.line);
  else if (brow === 'soft') { for (const x of [5, 11]) set(buf, x, 7, s.line); for (const x of [6, 10]) set(buf, x, 7, s.sh); }
  set(buf, 8, 11, s.sh); set(buf, 8, 12, s.sh); set(buf, 7, 12, s.sh);
  const mc: RGB = [158, 86, 80];
  const mouths: Record<Mouth, [number, number][]> = {
    neutral: [[7, 14], [8, 14], [9, 14], [10, 14]],
    smile: [[7, 14], [8, 14], [9, 14], [10, 14], [6, 13], [11, 13]],
    frown: [[7, 15], [8, 15], [9, 15], [10, 15], [6, 14], [11, 14]],
    grin: [[7, 14], [8, 14], [9, 14], [10, 14], [7, 13], [8, 13], [9, 13], [10, 13], [6, 13], [11, 13]],
    smirk: [[7, 14], [8, 14], [9, 14], [10, 14], [11, 13]],
  };
  for (const [x, y] of mouths[mouth]) set(buf, x, y, mc);
  if (blush) for (const x of [5, 12]) set(buf, x, 12, [235, 150, 140], 140);
}

// ─── hairstyles ──────────────────────────────────────────────────────────────
interface HairArgs { part?: 'L' | 'R'; recede?: number; length?: number; vol?: number; }
type HairFn = (buf: Buf, color: RGB, skinBase: RGB, a: HairArgs) => void;

const styleShort: HairFn = (buf, color, skinBase, a) => {
  const [hi, base, sh] = shades(color);
  const part = a.part ?? 'L', recede = a.recede ?? 0;
  rect(buf, HX0, 2, HX1, 4, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 3, base);
  rect(buf, HX0 - 1, 4, HX1 + 1, 5, base);
  for (let y = 6; y < 9; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  if (recede) {
    for (let y = 3; y < 6; y++) for (let x = 6; x < 12; x++) if (eq(rgbAt(buf, x, y), base)) set(buf, x, y, skinBase);
    set(buf, 8, 5, base); // widow's peak
  }
  const hx = part === 'L' ? 6 : 11;
  for (let y = 2; y < 6; y++) set(buf, hx, y, sh);
  for (let x = HX0; x < hx; x++) if (alphaAt(buf, x, 3)) set(buf, x, 3, hi);
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 2)) set(buf, x, 2, hi);
};

const styleFloppy: HairFn = (buf, color) => {
  const [hi, base] = shades(color);
  rect(buf, HX0, 2, HX1, 4, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 3, base);
  rect(buf, HX0 - 1, 4, HX1 + 1, 5, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x <= 12; x++) set(buf, x, 6, base);
  set(buf, 9, 7, base); set(buf, 10, 7, base); set(buf, 11, 7, base);
  for (let y = 6; y < 9; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 2)) set(buf, x, 2, hi);
  for (const x of [7, 8, 9]) set(buf, x, 6, hi);
};

const styleFrame: HairFn = (buf, color, skinBase, a) => {
  const [hi, base, sh] = shades(color);
  const length = a.length ?? 17, vol = a.vol ?? 1;
  rect(buf, HX0 - 1, 2, HX1 + 1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 3, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y <= length; y++) {
    for (let dx = 0; dx < vol; dx++) { set(buf, HX0 - 1 - dx, y, base); set(buf, HX1 + 1 + dx, y, base); }
    set(buf, HX0, y, base); set(buf, HX1, y, base);
  }
  for (let x = HX0 - 1; x < HX0 + 1; x++) set(buf, x, length + 1, base);
  for (let x = HX1; x < HX1 + 2; x++) set(buf, x, length + 1, base);
  for (let y = 2; y < 6; y++) if (alphaAt(buf, HX1, y)) set(buf, HX1, y, sh);
  for (let x = HX0; x < 9; x++) if (alphaAt(buf, x, 2)) set(buf, x, 2, hi);
};

const styleBun: HairFn = (buf, color, skinBase) => {
  const [hi, base] = shades(color);
  rect(buf, HX0, 3, HX1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 4, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y < 9; y++) { set(buf, HX0, y, base); set(buf, HX1, y, base); }
  rect(buf, 7, 1, 10, 2, base);
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 3)) set(buf, x, 3, hi);
};

// High ponytail: hair pulled back into a tight cap, a tie bump at the crown,
// and the tail draped down the right side of the head onto the shoulder.
const stylePonytail: HairFn = (buf, color, skinBase) => {
  const [hi, base, sh] = shades(color);
  rect(buf, HX0, 3, HX1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 4, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y < 9; y++) { set(buf, HX0, y, base); set(buf, HX1, y, base); }
  // gathered tie at the crown + the tail sweeping down the right
  rect(buf, 7, 1, 10, 2, base);
  for (let y = 6; y <= 16; y++) set(buf, HX1 + 1, y, base);
  for (let y = 9; y <= 16; y++) set(buf, HX1 + 2, y, base);
  for (let y = 12; y <= 16; y++) set(buf, HX1 + 1, y, sh);
  set(buf, HX1 + 1, 17, base);
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 3)) set(buf, x, 3, hi);
};

const styleCurly: HairFn = (buf, color, skinBase) => {
  const [hi, base] = shades(color);
  const pts: [number, number][] = [[4, 3], [5, 2], [6, 3], [7, 2], [8, 3], [9, 2], [10, 3], [11, 2], [12, 3], [13, 3],
    [3, 4], [4, 4], [13, 4], [14, 4], [3, 5], [4, 5], [13, 5], [14, 5], [3, 6], [13, 6], [4, 6], [12, 6], [3, 7], [13, 7], [4, 7]];
  rect(buf, HX0, 3, HX1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 4, base);
  for (const [x, y] of pts) set(buf, x, y, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (const [x, y] of [[5, 2], [7, 2], [9, 2], [11, 2]] as const) set(buf, x, y, hi);
};

const styleMessy: HairFn = (buf, color, skinBase, a) => {
  const [hi, base] = shades(color);
  const length = a.length ?? 8;
  rect(buf, HX0 - 1, 2, HX1 + 1, 5, base);
  const spikes: [number, number][] = [[3, 2], [5, 1], [7, 2], [9, 1], [11, 2], [13, 1], [14, 2], [4, 2], [12, 2]];
  for (const [x, y] of spikes) set(buf, x, y, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y <= length; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (const [x, y] of spikes) set(buf, x, y, hi);
};

const styleRecede: HairFn = (buf, color, skinBase) => {
  const [, base, sh] = shades(color);
  for (let y = 4; y < 10; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  for (let x = HX0; x <= HX1; x++) set(buf, x, 4, base);
  for (let x = HX0 + 1; x < HX1; x++) set(buf, x, 5, base);
  for (let y = 5; y < 9; y++) for (let x = 6; x < 12; x++) if (eq(rgbAt(buf, x, y), base)) set(buf, x, y, skinBase);
  for (let x = HX0; x <= HX1; x++) if (alphaAt(buf, x, 4)) set(buf, x, 4, sh);
};

const styleSpiky: HairFn = (buf, color, skinBase) => {
  const [hi, base] = shades(color);
  rect(buf, HX0, 3, HX1, 5, base);
  for (let x = HX0 - 1; x <= HX1 + 1; x++) set(buf, x, 4, base);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 5, base);
  const spikes: [number, number][] = [[5, 2], [7, 1], [9, 2], [11, 1], [6, 2], [8, 2], [10, 2], [12, 2]];
  for (const [x, y] of spikes) set(buf, x, y, base);
  for (let x = 6; x < 12; x++) set(buf, x, 6, base);
  set(buf, 8, 6, skinBase); set(buf, 9, 6, skinBase);
  for (let y = 6; y < 8; y++) { set(buf, HX0, y, base); set(buf, HX1, y, base); }
  for (const [x, y] of spikes) set(buf, x, y, hi);
};

// Bald: a rounded skin crown (with a sheen) and only a low horseshoe fringe of
// hair around the temples / back of the head.
const styleBald: HairFn = (buf, color, skinBase, a) => {
  const [shi, sbase, ssh] = shades(skinBase, 1.1, 0.82);
  // rounded skin dome above the forehead
  for (let x = 6; x <= 11; x++) set(buf, x, 2, sbase);
  for (let x = 5; x <= 12; x++) set(buf, x, 3, sbase);
  for (let x = HX0; x <= HX1; x++) set(buf, x, 4, sbase);
  // bald-head sheen + side falloff
  for (const x of [7, 8, 9]) set(buf, x, 2, shi);
  set(buf, 6, 3, shi); set(buf, 7, 3, shi);
  set(buf, 5, 3, ssh); set(buf, 12, 3, ssh); set(buf, HX1, 4, ssh);
  // low horseshoe hair fringe — sides only, leaving the crown bald.
  const [, base, sh] = shades(color);
  const top = a.recede ? 8 : 6; // recede:1 → only a thin fringe very low
  for (let y = top; y <= 10; y++) {
    set(buf, HX0 - 1, y, base); set(buf, HX0, y, base);
    set(buf, HX1, y, base); set(buf, HX1 + 1, y, base);
  }
  for (let y = top; y <= 10; y++) { set(buf, HX0 - 1, y, sh); set(buf, HX1 + 1, y, sh); }
};

const HAIR_FNS = { styleShort, styleFloppy, styleFrame, styleBun, stylePonytail, styleCurly, styleMessy, styleRecede, styleSpiky, styleBald };
type HairStyle = keyof typeof HAIR_FNS;

// ─── facial hair ─────────────────────────────────────────────────────────────
type Facial = 'mustache' | 'mustacheSm' | 'stubble' | 'goatee';
function drawFacial(buf: Buf, kind: Facial, color: RGB): void {
  const [, base, sh] = shades(color);
  if (kind === 'mustache') {
    for (const x of [6, 7, 8, 9, 10]) set(buf, x, 13, base);
    set(buf, 6, 12, base); set(buf, 10, 12, base);
  } else if (kind === 'mustacheSm') {
    for (const x of [7, 8, 9]) set(buf, x, 13, base);
  } else if (kind === 'stubble') {
    for (const [x, y] of [[5, 14], [6, 15], [7, 15], [8, 15], [9, 15], [10, 15], [11, 14], [12, 13], [4, 13], [5, 15], [10, 15]] as const)
      set(buf, x, y, sh, 150);
  } else if (kind === 'goatee') {
    for (const x of [8, 9]) set(buf, x, 15, base);
    set(buf, 8, 14, base); set(buf, 9, 14, base);
    for (const x of [7, 8, 9, 10]) set(buf, x, 13, base);
  }
}

// ─── glasses ─────────────────────────────────────────────────────────────────
// Clear prescription glasses (NOT sunglasses): a thin rim that frames each eye
// without covering it. The lens interior keeps the eye/skin already drawn, plus
// a small white glint so the lens reads as transparent glass.
function drawGlasses(buf: Buf): void {
  const frame: RGB = [60, 54, 62];
  const glint: RGB = [236, 240, 246];
  // Left lens rim around the eye at (5-6, 9): top, bottom, outer + inner edge.
  for (const x of [5, 6]) { set(buf, x, 8, frame); set(buf, x, 10, frame); }
  set(buf, 4, 9, frame); set(buf, 7, 9, frame);
  set(buf, 4, 8, frame); set(buf, 7, 8, frame);
  // Right lens rim around the eye at (10-11, 9).
  for (const x of [10, 11]) { set(buf, x, 8, frame); set(buf, x, 10, frame); }
  set(buf, 9, 9, frame); set(buf, 12, 9, frame);
  set(buf, 9, 8, frame); set(buf, 12, 8, frame);
  // Bridge over the nose + temple arms out to the hair.
  set(buf, 8, 8, frame);
  set(buf, 3, 9, frame); set(buf, 13, 9, frame);
  // Glass glint on each rim's top-outer corner so the lens reads as clear glass.
  set(buf, 4, 8, glint); set(buf, 9, 8, glint);
}

// ─── clothing ────────────────────────────────────────────────────────────────
type Cloth = 'suit' | 'dressshirt' | 'polo' | 'blouse' | 'cardigan' | 'sweater' | 'hoodie';
function bodyShape(buf: Buf, col: RGB, heavy = false): void {
  const [, base, sh] = shades(col);
  const rows: [number, number, number][] = heavy
    ? [[19, 5, 12], [20, 3, 14], [21, 2, 15], [22, 1, 16], [23, 1, 16], [24, 0, 17], [25, 0, 17], [26, 0, 17], [27, 0, 17]]
    : [[19, 6, 11], [20, 4, 13], [21, 3, 14], [22, 2, 15], [23, 2, 15], [24, 1, 16], [25, 1, 16], [26, 1, 16], [27, 1, 16]];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, base);
  const [lo, hi] = heavy ? [1, 16] : [2, 15];
  for (let y = 22; y < 28; y++) { set(buf, lo, y, sh); set(buf, hi, y, sh); }
}
function drawClothing(buf: Buf, kind: Cloth, c1: RGB, c2: RGB | undefined, tie: RGB | undefined, skin: string, heavy = false): void {
  const [hi, base, sh] = shades(c1);
  bodyShape(buf, c1, heavy);
  if (kind === 'suit') {
    const white: RGB = [238, 238, 236];
    for (const [x, y] of [[8, 19], [9, 19], [7, 20], [8, 20], [9, 20], [10, 20], [8, 21], [9, 21]] as const) set(buf, x, y, white);
    for (const [x, y] of [[6, 20], [7, 21], [11, 20], [10, 21], [6, 21], [11, 21]] as const) set(buf, x, y, sh);
    if (tie) { for (let y = 20; y < 26; y++) { set(buf, 8, y, tie); set(buf, 9, y, tie); } set(buf, 8, 20, shades(tie)[0]); }
    else for (let y = 22; y < 26; y++) { set(buf, 8, y, white); set(buf, 9, y, white); }
  } else if (kind === 'dressshirt') {
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19], [7, 20], [10, 20]] as const) set(buf, x, y, sh);
    for (let y = 20; y < 27; y += 2) set(buf, 8, y, sh);
    if (tie) for (let y = 19; y < 26; y++) { set(buf, 8, y, tie); set(buf, 9, y, tie); }
  } else if (kind === 'polo') {
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, hi);
    set(buf, 8, 20, sh); set(buf, 8, 22, sh);
    const accent = c2 ? shades(c2)[1] : hi;
    for (const [x, y] of [[7, 20], [9, 20]] as const) set(buf, x, y, accent);
  } else if (kind === 'blouse') {
    const s = SKIN[skin];
    for (const [x, y] of [[7, 19], [8, 19], [9, 19], [10, 19], [8, 20], [9, 20]] as const) set(buf, x, y, s.sh);
    for (let x = 5; x < 13; x++) if (eq(rgbAt(buf, x, 20), base)) set(buf, x, 20, hi);
  } else if (kind === 'cardigan') {
    const inner: RGB = c2 ? shades(c2)[1] : [235, 233, 226];
    for (let y = 19; y < 27; y++) { set(buf, 8, y, inner); set(buf, 9, y, inner); }
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, sh);
  } else if (kind === 'sweater') {
    for (const [x, y] of [[6, 19], [7, 19], [8, 19], [9, 19], [10, 19], [11, 19]] as const) set(buf, x, y, sh);
  } else if (kind === 'hoodie') {
    // the hood bunches up around the neck; drawstring tips + kangaroo-pocket mouth
    for (const [x, y] of [[5, 18], [6, 18], [11, 18], [12, 18], [5, 19], [6, 19], [7, 19], [10, 19], [11, 19], [12, 19]] as const) set(buf, x, y, sh);
    for (let y = 20; y <= 22; y++) { set(buf, 8, y, sh); set(buf, 9, y, sh); }
    for (const x of [6, 7, 8, 9, 10, 11]) set(buf, x, 25, sh);
    set(buf, 6, 26, sh); set(buf, 11, 26, sh);
  }
}
function collarNeck(buf: Buf, skin: string): void {
  rect(buf, 7, 18, 10, 19, SKIN[skin].sh);
}

// ─── scene body (full standing figure: torso + legs, front or back) ──────────
// Proportioned for standing (not the portrait bust): a narrower torso over real
// legs. Head (rows 2-16) sits above; this draws rows 18-31.
const SHOE: RGB = [44, 40, 48];

function drawSceneLegs(buf: Buf, pants: RGB, phase: number): void {
  const [, base, sh] = shades(pants);
  // two legs cols 5-7 / 10-12, gap at 8-9
  for (const [lx0, lx1] of [[5, 7], [10, 12]] as const) {
    rect(buf, lx0, 25, lx1, 30, base);
    for (let y = 25; y <= 30; y++) set(buf, lx1, y, sh); // inner shade
  }
  // feet — lift one foot per walk phase for a simple gait
  const leftLow = phase !== 1, rightLow = phase !== 2;
  rect(buf, 5, leftLow ? 31 : 30, 7, leftLow ? 31 : 30, SHOE);
  rect(buf, 10, rightLow ? 31 : 30, 12, rightLow ? 31 : 30, SHOE);
}

function drawSceneTorso(buf: Buf, r: Recipe, back: boolean): void {
  const [hi, base, sh] = shades(r.c1);
  // shoulders → torso, narrower than the portrait bust (wider + rounder if heavy)
  if (r.heavy) {
    rect(buf, 3, 18, 14, 18, base);
    rect(buf, 2, 19, 15, 19, base);
    rect(buf, 2, 20, 15, 24, base);
    for (let y = 20; y <= 24; y++) { set(buf, 2, y, sh); set(buf, 15, y, sh); set(buf, 14, y, sh); }
  } else {
    rect(buf, 4, 18, 13, 18, base);
    rect(buf, 3, 19, 14, 19, base);
    rect(buf, 4, 20, 13, 24, base);
    for (let y = 20; y <= 24; y++) { set(buf, 3, y, sh); set(buf, 14, y, sh); set(buf, 13, y, sh); } // arms / right shade
  }
  if (back) {
    // plain back with a collar line + center seam
    rect(buf, 6, 18, 11, 18, sh);
    for (let y = 19; y <= 24; y++) set(buf, 8, y, sh);
    if (r.cloth === 'hoodie') rect(buf, 6, 18, 11, 19, hi); // the hood resting on the back
    return;
  }
  const skin = SKIN[r.skin];
  if (r.cloth === 'suit') {
    const white: RGB = [238, 238, 236];
    for (const [x, y] of [[8, 18], [9, 18], [7, 19], [8, 19], [9, 19], [10, 19], [8, 20], [9, 20]] as const) set(buf, x, y, white);
    for (const [x, y] of [[6, 19], [7, 20], [11, 19], [10, 20]] as const) set(buf, x, y, sh);
    if (r.tie) { for (let y = 19; y <= 24; y++) { set(buf, 8, y, r.tie); set(buf, 9, y, r.tie); } set(buf, 8, 19, shades(r.tie)[0]); }
  } else if (r.cloth === 'dressshirt') {
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18], [7, 19], [10, 19]] as const) set(buf, x, y, sh);
    if (r.tie) for (let y = 18; y <= 24; y++) { set(buf, 8, y, r.tie); set(buf, 9, y, r.tie); }
    else for (let y = 20; y <= 24; y += 2) set(buf, 8, y, sh);
  } else if (r.cloth === 'polo') {
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]] as const) set(buf, x, y, hi);
    set(buf, 8, 19, sh); set(buf, 8, 21, sh);
  } else if (r.cloth === 'blouse') {
    for (const [x, y] of [[7, 18], [8, 18], [9, 18], [10, 18], [8, 19], [9, 19]] as const) set(buf, x, y, skin.sh);
    for (let x = 5; x < 13; x++) if (eq(rgbAt(buf, x, 19), base)) set(buf, x, 19, hi);
  } else if (r.cloth === 'cardigan') {
    const inner: RGB = r.c2 ? shades(r.c2)[1] : [235, 233, 226];
    for (let y = 18; y <= 24; y++) { set(buf, 8, y, inner); set(buf, 9, y, inner); }
    for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]] as const) set(buf, x, y, sh);
  } else if (r.cloth === 'sweater') {
    for (const [x, y] of [[6, 18], [7, 18], [8, 18], [9, 18], [10, 18], [11, 18]] as const) set(buf, x, y, sh);
  } else if (r.cloth === 'hoodie') {
    // hood bunched at the neck + drawstrings + pocket mouth
    for (const [x, y] of [[5, 18], [6, 18], [11, 18], [12, 18]] as const) set(buf, x, y, sh);
    for (const [x, y] of [[6, 19], [7, 19], [10, 19], [11, 19]] as const) set(buf, x, y, sh);
    for (let y = 19; y <= 21; y++) { set(buf, 8, y, sh); set(buf, 9, y, sh); }
    for (const x of [7, 8, 9, 10]) set(buf, x, 23, sh);
  }
}

/** Back of the head: a rounded hair-covered skull with crown sheen + nape, no face. */
function drawHeadBack(buf: Buf, r: Recipe): void {
  const s = SKIN[r.skin];
  if (r.hair === 'styleBald') { drawHeadBackBald(buf, r); return; }
  const [hi, base, sh] = shades(r.hairc);
  // rounded skull silhouette (narrow at crown + nape, full through the middle)
  const rows: [number, number, number][] = [
    [2, 6, 11], [3, 5, 12], [4, 4, 13], [5, 4, 13], [6, 4, 13], [7, 4, 13], [8, 4, 13],
    [9, 4, 13], [10, 4, 13], [11, 4, 13], [12, 4, 13], [13, 5, 12], [14, 6, 11],
  ];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, base);
  // long styles drape down the sides past the head
  const len = r.hair === 'styleFrame' ? (r.hairargs?.length ?? 17)
            : r.hair === 'styleMessy' ? (r.hairargs?.length ?? 9) : 0;
  for (let y = 11; y <= len; y++) { set(buf, HX0 - 1, y, base); set(buf, HX0, y, base); set(buf, HX1, y, base); set(buf, HX1 + 1, y, base); }
  // roundness: darken the side edges and the nape
  for (let y = 4; y <= 12; y++) { set(buf, 4, y, sh); set(buf, 13, y, sh); }
  for (const [x, y] of [[5, 3], [12, 3], [5, 13], [12, 13], [6, 14], [11, 14]] as const) set(buf, x, y, sh);
  // crown sheen (rounded top catching the light) + subtle center part
  for (const [x, y] of [[7, 2], [8, 2], [9, 2], [10, 2], [7, 3], [8, 3], [9, 3]] as const) set(buf, x, y, hi);
  for (let y = 4; y <= 11; y++) set(buf, 9, y, hi);   // sheen down the crown
  for (let y = 4; y <= 12; y++) set(buf, 8, y, sh);   // part line
  // nape + neck (skin)
  rect(buf, 7, 14, 10, 14, sh);
  rect(buf, 7, 15, 10, 17, s.sh);
  rect(buf, 7, 15, 9, 15, s.base);
  if (r.hair === 'stylePonytail') {
    // gathered tie at the crown, then the tail hanging down the back
    for (let y = 3; y <= 5; y++) for (const x of [7, 8, 9, 10]) set(buf, x, y, sh);
    rect(buf, 7, 15, 10, 18, base);
    for (let y = 15; y <= 18; y++) set(buf, 10, y, sh);
    set(buf, 8, 19, base); set(buf, 9, 19, base);
  }
}

/** Back of a bald head: a skin skull with a sheen and a low hair fringe ring. */
function drawHeadBackBald(buf: Buf, r: Recipe): void {
  const s = SKIN[r.skin];
  const [shi, sbase, ssh] = shades(s.base, 1.1, 0.82);
  const rows: [number, number, number][] = [
    [2, 6, 11], [3, 5, 12], [4, 4, 13], [5, 4, 13], [6, 4, 13], [7, 4, 13], [8, 4, 13],
    [9, 4, 13], [10, 4, 13], [11, 4, 13], [12, 4, 13], [13, 5, 12], [14, 6, 11],
  ];
  for (const [y, a, b] of rows) rect(buf, a, y, b, y, sbase);
  for (let y = 4; y <= 12; y++) { set(buf, 4, y, ssh); set(buf, 13, y, ssh); }
  for (const [x, y] of [[7, 2], [8, 2], [9, 2], [8, 3], [9, 4], [9, 5]] as const) set(buf, x, y, shi);
  // low hair fringe ring around the back/sides
  const [, base, sh] = shades(r.hairc);
  for (let x = 4; x <= 13; x++) { set(buf, x, 11, base); set(buf, x, 12, base); }
  for (const x of [4, 13]) { set(buf, x, 11, sh); set(buf, x, 12, sh); }
  // nape + neck (skin)
  rect(buf, 7, 14, 10, 14, s.sh);
  rect(buf, 7, 15, 10, 17, s.sh);
  rect(buf, 7, 15, 9, 15, s.base);
}

function drawSceneBody(buf: Buf, r: Recipe, phase: number, back: boolean): void {
  drawSceneTorso(buf, r, back);
  drawSceneLegs(buf, defaultPants(r), phase);
}

// ─── outline pass ────────────────────────────────────────────────────────────
function outlinePass(buf: Buf): void {
  const pts: [number, number][] = [];
  for (let y = 0; y < CUR_H; y++) {
    for (let x = 0; x < CUR_W; x++) {
      if (alphaAt(buf, x, y) !== 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (alphaAt(buf, x + dx, y + dy) === 255) { pts.push([x, y]); break; }
      }
    }
  }
  for (const [x, y] of pts) set(buf, x, y, OUTLINE);
}

// ─── recipes ─────────────────────────────────────────────────────────────────
interface Recipe {
  skin: string; hairc: RGB; hair: HairStyle; hairargs?: HairArgs;
  cloth: Cloth; c1: RGB; c2?: RGB; tie?: RGB; pants?: RGB;
  brow?: Brow; mouth?: Mouth; blush?: boolean; facial?: Facial; glasses?: boolean;
  /** Bigger, lashed eyes for a more feminine, expressive face. */
  lashes?: boolean;
  /** Droopy half-lidded eyes — the outer whites hooded over (lazy/sleepy look). */
  sleepy?: boolean;
  /** Heavier build: chubby cheeks, a double chin, and a wider torso. */
  heavy?: boolean;
}

// Puff the lower face into round cheeks + a double chin so a character reads as
// heavier. Runs after drawHead (adds skin at the jaw) and is safe before the
// face features, which sit higher (eyes y9, mouth y14).
function drawHeavyFace(buf: Buf, skin: string): void {
  const s = SKIN[skin];
  // Chubby cheeks: bulge the jaw outward past the normal x4..13 head box.
  for (let y = 11; y <= 15; y++) { set(buf, HX0 - 1, y, s.base); set(buf, HX1 + 1, y, s.base); }
  set(buf, HX0 - 1, 15, s.sh); set(buf, HX1 + 1, 15, s.sh);
  // Fuller, rounder lower jaw.
  for (const x of [5, 6, 11, 12]) set(buf, x, 16, s.base);
  // Double chin: a second rounded roll under the jaw.
  rect(buf, 6, 17, 11, 18, s.base);
  for (const x of [6, 7, 8, 9, 10, 11]) set(buf, x, 18, s.sh);
  set(buf, 7, 17, s.sh); set(buf, 10, 17, s.sh); // crease shadow between chin + roll
}

const RECIPES: Record<OfficeCharacterName, Recipe> = {
  michael:  { skin: 'light', hairc: [58, 42, 28],   hair: 'styleShort',  hairargs: { part: 'L' }, cloth: 'suit', c1: [58, 63, 74], tie: [170, 58, 58], brow: 'flat', mouth: 'smile' },
  jim:      { skin: 'light', hairc: [92, 60, 34],   hair: 'styleFloppy', cloth: 'dressshirt', c1: [172, 196, 224], tie: [120, 130, 150], brow: 'flat', mouth: 'smile' },
  pam:      { skin: 'light', hairc: [120, 76, 42],  hair: 'styleFrame',  hairargs: { length: 18, vol: 2 }, cloth: 'cardigan', c1: [236, 174, 192], c2: [244, 242, 238], brow: 'soft', mouth: 'smile', blush: true, lashes: true },
  dwight:   { skin: 'light', hairc: [64, 48, 28],   hair: 'styleShort',  hairargs: { part: 'L', recede: 1 }, cloth: 'dressshirt', c1: [184, 155, 62], tie: [120, 82, 46], glasses: true, brow: 'angry', mouth: 'neutral' },
  kevin:    { skin: 'light', hairc: [58, 44, 30],   hair: 'styleBald',   cloth: 'polo', c1: [110, 140, 180], c2: [90, 120, 160], brow: 'flat', mouth: 'neutral', heavy: true },
  angela:   { skin: 'light', hairc: [186, 154, 90], hair: 'styleBun',    cloth: 'cardigan', c1: [150, 146, 170], c2: [235, 233, 226], brow: 'angry', mouth: 'frown', lashes: true },
  oscar:    { skin: 'tan',   hairc: [28, 22, 18],   hair: 'styleShort',  hairargs: { part: 'L' }, cloth: 'sweater', c1: [122, 60, 74], brow: 'flat', mouth: 'smile' },
  stanley:  { skin: 'dark',  hairc: [60, 54, 48],   hair: 'styleRecede', cloth: 'dressshirt', c1: [150, 120, 86], tie: [120, 78, 52], glasses: true, facial: 'mustache', brow: 'flat', mouth: 'neutral', heavy: true },
  phyllis:  { skin: 'light', hairc: [196, 162, 110], hair: 'styleCurly', cloth: 'blouse', c1: [202, 160, 192], glasses: true, brow: 'soft', mouth: 'smile', lashes: true, heavy: true },
  andy:     { skin: 'light', hairc: [74, 51, 32],   hair: 'styleShort',  hairargs: { part: 'R' }, cloth: 'polo', c1: [176, 65, 58], c2: [150, 50, 46], brow: 'raised', mouth: 'smile' },
  kelly:    { skin: 'tan',   hairc: [24, 18, 22],   hair: 'styleFrame',  hairargs: { length: 20, vol: 1 }, cloth: 'blouse', c1: [212, 90, 158], brow: 'soft', mouth: 'smile', blush: true, lashes: true },
  ryan:     { skin: 'light', hairc: [42, 32, 24],   hair: 'styleSpiky',  cloth: 'suit', c1: [58, 58, 68], tie: [40, 40, 50], brow: 'flat', mouth: 'neutral' },
  toby:     { skin: 'light', hairc: [106, 90, 66],  hair: 'styleShort',  hairargs: { part: 'L', recede: 1 }, cloth: 'dressshirt', c1: [150, 150, 120], facial: 'mustacheSm', brow: 'soft', mouth: 'frown' },
  creed:    { skin: 'light', hairc: [170, 166, 156], hair: 'styleBald',   cloth: 'dressshirt', c1: [126, 130, 96], facial: 'stubble', brow: 'flat', mouth: 'neutral' },
  meredith: { skin: 'light', hairc: [154, 82, 46],  hair: 'styleMessy',  hairargs: { length: 15 }, cloth: 'blouse', c1: [176, 86, 74], brow: 'raised', mouth: 'smile', lashes: true },
  mailman:  { skin: 'tan',   hairc: [52, 40, 30],   hair: 'styleShort',  hairargs: { part: 'R' }, cloth: 'polo', c1: [47, 95, 158], c2: [30, 66, 118], brow: 'soft', mouth: 'smile' },
  principal: { skin: 'light', hairc: [152, 150, 144], hair: 'styleShort', hairargs: { part: 'L', recede: 1 }, cloth: 'suit', c1: [58, 74, 107], tie: [104, 38, 44], glasses: true, brow: 'angry', mouth: 'neutral' },
  teacher:   { skin: 'tan',   hairc: [98, 62, 36],   hair: 'styleFrame',  hairargs: { length: 17 }, cloth: 'cardigan', c1: [122, 154, 109], c2: [244, 238, 226], brow: 'soft', mouth: 'smile', blush: true, lashes: true },
  topper:    { skin: 'light', hairc: [74, 50, 34],   hair: 'stylePonytail', cloth: 'sweater', c1: [201, 79, 124], brow: 'raised', mouth: 'smirk', lashes: true },
  smartguy:  { skin: 'light', hairc: [52, 40, 30],   hair: 'styleMessy',  cloth: 'hoodie', c1: [90, 143, 168], sleepy: true, brow: 'soft', mouth: 'grin' },
  librarian: { skin: 'light', hairc: [148, 142, 136], hair: 'styleBun',   cloth: 'cardigan', c1: [138, 109, 155], c2: [230, 226, 236], glasses: true, brow: 'soft', mouth: 'neutral', lashes: true },
};

/** The face/hair group (head → face → facial hair → hair → glasses), no clothing. */
function drawHeadGroup(buf: Buf, r: Recipe): void {
  const skinBase = SKIN[r.skin].base;
  drawHead(buf, r.skin);
  if (r.heavy) drawHeavyFace(buf, r.skin);
  drawFace(buf, r.skin, r.brow ?? 'flat', r.mouth ?? 'neutral', r.blush ?? false, r.lashes ?? false);
  if (r.sleepy) {
    // hooded lids: each eye narrows to the pupil as the outer white lids over
    const s = SKIN[r.skin];
    set(buf, 5, 9, s.base); set(buf, 11, 9, s.base);
  }
  if (r.facial) drawFacial(buf, r.facial, r.hairc);
  HAIR_FNS[r.hair](buf, r.hairc, skinBase, r.hairargs ?? {});
  if (r.glasses) drawGlasses(buf);
}

function defaultPants(r: Recipe): RGB {
  if (r.pants) return r.pants;
  return r.cloth === 'suit' ? shades(r.c1)[2] : [54, 56, 70];
}

/** Portrait bust: shoulders-height clothing + front head group. */
function compose(r: Recipe): Buf {
  CUR_W = PORTRAIT_W; CUR_H = PORTRAIT_H;
  const buf = new Uint8ClampedArray(PORTRAIT_W * PORTRAIT_H * 4);
  drawClothing(buf, r.cloth, r.c1, r.c2, r.tie, r.skin, r.heavy ?? false);
  collarNeck(buf, r.skin);
  drawHeadGroup(buf, r);
  outlinePass(buf);
  return buf;
}

/** Full-body 18×32 scene sprite. `back=false` reuses the portrait's exact face. */
function composeScene(r: Recipe, phase: number, back: boolean): Buf {
  CUR_W = SCENE_W; CUR_H = SCENE_H;
  const buf = new Uint8ClampedArray(SCENE_W * SCENE_H * 4);
  drawSceneBody(buf, r, phase, back);
  if (back) drawHeadBack(buf, r);
  else drawHeadGroup(buf, r);
  outlinePass(buf);
  return buf;
}

// ─── public render ───────────────────────────────────────────────────────────
const bufCache = new Map<OfficeCharacterName, Buf>();
const sceneCache = new Map<OfficeCharacterName, SceneFrames>();

type SchoolName = 'principal' | 'teacher' | 'topper' | 'smartguy' | 'librarian';
const SCHOOL_PALETTES: Record<SchoolName, { skin: string; hair: RGB; coat: RGB; accent: RGB }> = {
  principal: { skin: 'brown', hair: [70, 65, 58], coat: [43, 57, 79], accent: [112, 44, 49] },
  teacher: { skin: 'tan', hair: [83, 48, 33], coat: [163, 100, 76], accent: [92, 117, 86] },
  topper: { skin: 'brown', hair: [40, 32, 28], coat: [43, 83, 65], accent: [185, 148, 78] },
  smartguy: { skin: 'light', hair: [65, 46, 34], coat: [126, 148, 117], accent: [47, 81, 68] },
  librarian: { skin: 'light', hair: [139, 132, 112], coat: [54, 88, 70], accent: [187, 132, 98] },
};
const SCHOOL_IVORY: RGB = [241, 229, 201];
const SCHOOL_GOLD: RGB = [208, 168, 91];
function isSchoolName(name: OfficeCharacterName): name is SchoolName {
  return Object.prototype.hasOwnProperty.call(SCHOOL_PALETTES, name);
}

function schoolHead(buf: Buf, name: SchoolName, back: boolean): void {
  const p = SCHOOL_PALETTES[name], s = SKIN[p.skin];
  const [hh, hair, hs] = shades(p.hair, 1.3, 0.7);
  drawHead(buf, p.skin);
  if (name === 'principal') {
    rect(buf, 4, 12, 13, 15, back ? hair : s.base);
    rect(buf, 5, 16, 12, 16, s.sh);
  }
  if (back) {
    rect(buf, 5, 3, 12, 4, hair);
    rect(buf, 4, 5, 13, 12, hair);
    rect(buf, 5, 13, 12, 14, hs);
    rect(buf, 6, 3, 9, 3, hh);
    rect(buf, 4, 6, 4, 12, hs); rect(buf, 13, 6, 13, 12, hs);
  } else {
    drawFace(buf, p.skin, name === 'principal' ? 'flat' : name === 'topper' ? 'raised' : 'soft',
      name === 'topper' || name === 'smartguy' ? 'smirk' : 'smile', false, name === 'teacher' || name === 'topper');
  }
  if (name === 'principal') {
    rect(buf, 5, 2, 11, 3, hair); rect(buf, 4, 4, 13, 5, hair);
    rect(buf, 5, 2, 8, 2, hh); set(buf, 10, 3, hs); set(buf, 11, 4, hs);
    rect(buf, 3, 6, 4, 8, [168, 161, 143]); rect(buf, 13, 6, 14, 8, [168, 161, 143]);
    if (!back) {
      set(buf, 5, 7, hs); set(buf, 6, 8, hs); set(buf, 10, 8, hs); set(buf, 11, 7, hs);
      rect(buf, 6, 13, 10, 13, hair); set(buf, 5, 12, s.line); set(buf, 12, 12, s.line);
      set(buf, 8, 14, SCHOOL_IVORY); set(buf, 9, 14, SCHOOL_IVORY);
    }
  } else if (name === 'teacher') {
    rect(buf, 4, 3, 12, 5, hair); rect(buf, 5, 2, 10, 2, hair);
    for (const [x, y] of [[3, 4], [3, 6], [2, 8], [3, 10], [3, 12], [4, 14], [13, 4], [14, 6], [15, 8], [14, 10], [14, 12], [13, 14]] as const) {
      rect(buf, x, y, x + 1, y + 1, hair); set(buf, x, y, hh);
    }
    set(buf, 5, 5, hh); set(buf, 6, 6, hair); set(buf, 7, 5, hh);
    set(buf, 3, 13, SCHOOL_GOLD); set(buf, 14, 13, SCHOOL_GOLD);
  } else if (name === 'topper') {
    rect(buf, 5, 2, 12, 4, hair); rect(buf, 4, 4, 13, 5, hair);
    rect(buf, 4, 6, 4, 8, hair); rect(buf, 13, 6, 13, 8, hair);
    rect(buf, 5, 2, 8, 2, hh); set(buf, 6, 5, hh);
    const tx = back ? 10 : 14;
    rect(buf, tx, 6, tx + 1, 17, hair); rect(buf, tx, 7, tx + 1, 8, p.accent);
    for (let y = 10; y < 17; y += 3) set(buf, tx, y, hh);
    set(buf, tx, 18, hs); set(buf, 11, 5, p.accent); set(buf, 12, 5, p.accent);
  } else if (name === 'smartguy') {
    rect(buf, 4, 3, 13, 5, hair); rect(buf, 3, 5, 14, 6, hair);
    for (const [x, y] of [[3, 3], [5, 2], [8, 1], [11, 2], [13, 3], [7, 6], [10, 7], [11, 7]] as const) {
      set(buf, x, y, hair); set(buf, x + 1, y, hh);
    }
    if (!back) { set(buf, 5, 9, s.sh); set(buf, 11, 9, s.sh); set(buf, 5, 8, hs); set(buf, 10, 8, hs); }
  } else {
    rect(buf, 4, 4, 13, 5, hair); rect(buf, 5, 3, 12, 3, hair);
    rect(buf, 7, 1, 10, 2, hair); set(buf, 7, 1, hh); set(buf, 9, 2, hs);
    rect(buf, 5, 4, 7, 4, hh); rect(buf, 4, 6, 4, 8, hair); rect(buf, 13, 6, 13, 8, hair);
    set(buf, 10, 1, p.accent); set(buf, 11, 2, SCHOOL_GOLD);
    if (!back) {
      drawGlasses(buf); set(buf, 5, 8, SCHOOL_GOLD); set(buf, 11, 8, SCHOOL_GOLD);
      set(buf, 5, 12, s.sh); set(buf, 12, 12, s.sh);
    }
  }
}

function schoolBody(buf: Buf, name: SchoolName, scene: boolean, back: boolean, phase: number): void {
  const p = SCHOOL_PALETTES[name], s = SKIN[p.skin];
  const [hi, base, sh] = shades(p.coat, 1.18, 0.72);
  const top = scene ? 18 : 19, bottom = scene ? 25 : 27;
  const left = name === 'principal' ? 3 : name === 'topper' ? 5 : 4;
  rect(buf, left + 1, top, 16 - left, top, base);
  rect(buf, left, top + 1, 17 - left, bottom, base);
  rect(buf, left, top + 2, left, bottom, hi); rect(buf, 17 - left, top + 2, 17 - left, bottom, sh);
  if (back) {
    rect(buf, 6, top, 11, top, sh); rect(buf, 8, top + 2, 8, bottom, sh);
    if (name === 'smartguy') { rect(buf, 6, top, 11, top + 2, p.accent); rect(buf, 7, top + 1, 10, top + 2, hi); }
    if (name === 'teacher') { rect(buf, 6, top + 1, 7, bottom, p.accent); set(buf, 8, bottom, p.accent); }
    if (name === 'librarian') rect(buf, 5, bottom - 1, 12, bottom - 1, p.accent);
  } else if (name === 'principal' || name === 'topper') {
    rect(buf, 7, top, 10, top + 2, SCHOOL_IVORY);
    set(buf, 6, top + 1, hi); set(buf, 7, top + 2, sh); set(buf, 11, top + 1, hi); set(buf, 10, top + 2, sh);
    rect(buf, 8, top + 1, 9, top + 4, name === 'principal' ? p.accent : [112, 44, 49]);
    set(buf, 11, top + 3, SCHOOL_GOLD); set(buf, 12, top + 3, p.accent);
    set(buf, 10, bottom - 1, SCHOOL_GOLD);
    if (name === 'principal') rect(buf, 5, bottom, 12, bottom, sh);
  } else if (name === 'teacher') {
    rect(buf, 7, top, 10, bottom, SCHOOL_IVORY);
    rect(buf, 6, top + 1, 7, top + 4, p.accent); rect(buf, 8, top + 3, 11, top + 4, p.accent);
    set(buf, 5, bottom - 1, SCHOOL_GOLD); set(buf, 12, bottom - 1, SCHOOL_GOLD);
  } else if (name === 'smartguy') {
    rect(buf, 6, top, 11, top + 1, p.accent); rect(buf, 8, top, 9, top + 1, s.sh);
    rect(buf, 7, top + 2, 7, top + 3, SCHOOL_IVORY); rect(buf, 10, top + 2, 10, top + 3, SCHOOL_IVORY);
    rect(buf, 6, bottom - 1, 11, bottom - 1, sh); set(buf, 6, bottom, sh); set(buf, 11, bottom, sh);
  } else {
    rect(buf, 7, top, 10, bottom, SCHOOL_IVORY);
    set(buf, 7, top + 1, p.accent); set(buf, 10, top + 1, p.accent);
    for (let y = top + 2; y <= bottom; y += 2) set(buf, 8, y, SCHOOL_GOLD);
    rect(buf, 11, bottom - 2, 12, bottom, p.accent); set(buf, 11, bottom - 1, SCHOOL_IVORY);
  }
  const armL = phase === 1 ? -1 : phase === 2 ? 1 : 0;
  for (const [x, offset] of [[left - 1, armL], [18 - left, -armL]]) {
    rect(buf, x, top + 2 + offset, x, top + 4 + offset, sh);
    set(buf, x, top + 5 + offset, s.base); set(buf, x, top + 6 + offset, s.sh);
  }
  if (scene) {
    if (name === 'topper' || name === 'librarian') {
      rect(buf, 4, 25, 13, 27, name === 'topper' ? [38, 61, 53] : sh);
      for (const x of [6, 9, 12]) rect(buf, x, 26, x, 27, hi);
    }
    const pants: RGB = name === 'teacher' ? [86, 65, 50] : name === 'smartguy' ? [64, 73, 83] : [38, 45, 57];
    for (const [x, lift] of [[5, phase === 1 ? 1 : 0], [10, phase === 2 ? 1 : 0]]) {
      rect(buf, x, name === 'topper' || name === 'librarian' ? 28 : 26, x + 2, 30 - lift, pants);
      rect(buf, x + 2, 28, x + 2, 30 - lift, shades(pants)[2]);
      rect(buf, x - (lift ? 1 : 0), 31 - lift, x + 2, 31 - lift, SHOE);
      if (name === 'smartguy') rect(buf, x, 31 - lift, x + 2, 31 - lift, SCHOOL_IVORY);
    }
  }
}

function composeSchool(name: SchoolName, scene = false, phase = 0, back = false): Buf {
  CUR_W = PORTRAIT_W; CUR_H = scene ? SCENE_H : PORTRAIT_H;
  const buf = new Uint8ClampedArray(CUR_W * CUR_H * 4);
  schoolBody(buf, name, scene, back, phase);
  schoolHead(buf, name, back);
  outlinePass(buf);
  return buf;
}

// ─── The Mailman ─────────────────────────────────────────────────────────────
// A hand-drawn postie: blue baseball cap, blue short-sleeved uniform and trousers,
// a parcel carried at the waist. Not recipe-driven — the cap and the parcel have
// no counterpart in the shared recipe vocabulary.
const MAIL_BLUE: RGB = [50, 128, 204];
const MAIL_CAP: RGB = [36, 92, 168];
const MAIL_PANTS: RGB = [46, 104, 178];
const PARCEL: RGB = [204, 154, 92];
const PARCEL_TAPE: RGB = [238, 214, 160];

function mailmanHead(buf: Buf, back: boolean): void {
  const s = SKIN.tan;
  const [capHi, cap, capSh] = shades(MAIL_CAP, 1.3, 0.62);
  const hair: RGB = [88, 58, 36];
  drawHead(buf, 'tan');
  if (back) {
    rect(buf, 5, 2, 12, 5, cap); rect(buf, 4, 4, 13, 6, cap);
    rect(buf, 6, 2, 9, 2, capHi); set(buf, 8, 1, capSh);
    rect(buf, 4, 7, 13, 12, hair); rect(buf, 5, 13, 12, 14, shades(hair)[2]);
    rect(buf, 6, 7, 11, 7, capSh);
    return;
  }
  drawFace(buf, 'tan', 'soft', 'smile', false);
  // sideburns / ear-height hair under the cap
  rect(buf, 4, 6, 4, 9, hair); rect(buf, 13, 6, 13, 9, hair);
  // cap dome + peak
  rect(buf, 6, 1, 11, 1, cap); rect(buf, 5, 2, 12, 3, cap); rect(buf, 4, 4, 13, 5, cap);
  rect(buf, 6, 2, 8, 2, capHi); set(buf, 5, 3, capHi);
  rect(buf, 4, 5, 13, 5, capSh);
  rect(buf, 3, 6, 14, 6, capSh);          // the peak, shading the brow
  set(buf, 8, 0, capHi); set(buf, 9, 0, cap); // button
  // a little badge on the front of the cap
  set(buf, 8, 3, [244, 206, 96]); set(buf, 9, 3, [244, 206, 96]);
  set(buf, 5, 12, s.sh); set(buf, 12, 12, s.sh);
}

function mailmanBody(buf: Buf, scene: boolean, back: boolean, phase: number): void {
  const s = SKIN.tan;
  const [hi, base, sh] = shades(MAIL_BLUE, 1.16, 0.7);
  const top = scene ? 18 : 19, bottom = scene ? 25 : 27;
  const left = 4;
  rect(buf, left + 1, top, 16 - left, top, base);
  rect(buf, left, top + 1, 17 - left, bottom, base);
  rect(buf, left, top + 2, left, bottom, hi); rect(buf, 17 - left, top + 2, 17 - left, bottom, sh);
  if (back) {
    rect(buf, 8, top + 1, 9, bottom, sh);                    // back seam
    rect(buf, 6, top, 11, top, sh);
  } else {
    // collar + a hint of neck, chest pocket with a tiny stamp
    rect(buf, 7, top, 10, top, s.base); rect(buf, 7, top + 1, 7, top + 1, hi); rect(buf, 10, top + 1, 10, top + 1, hi);
    set(buf, 8, top + 1, s.base); set(buf, 9, top + 1, s.base);
    rect(buf, 11, top + 3, 12, top + 4, sh); set(buf, 11, top + 3, [244, 206, 96]);
    // the parcel, held in both hands at the waist
    const by = scene ? 21 : 22;
    rect(buf, 5, by, 12, by + 3, PARCEL);
    rect(buf, 5, by, 12, by, shades(PARCEL, 1.18, 0.7)[0]);       // lit top edge
    rect(buf, 12, by + 1, 12, by + 3, shades(PARCEL, 1.18, 0.7)[2]); // shaded side
    rect(buf, 5, by + 3, 12, by + 3, shades(PARCEL, 1.18, 0.7)[2]);  // shaded base
    rect(buf, 8, by, 9, by + 3, PARCEL_TAPE);                         // tape
    set(buf, 6, by + 2, [250, 244, 230]);                              // label
    set(buf, 7, by + 2, [250, 244, 230]);
  }
  // short sleeves, then bare forearms; walking swings the arms
  const swing = phase === 1 ? -1 : phase === 2 ? 1 : 0;
  for (const [x, off] of [[left - 1, swing], [18 - left, -swing]]) {
    rect(buf, x, top + 1 + off, x, top + 3 + off, sh);
    set(buf, x, top + 4 + off, s.base); set(buf, x, top + 5 + off, s.base); set(buf, x, top + 6 + off, s.sh);
  }
  if (scene) {
    for (const [x, lift] of [[5, phase === 1 ? 1 : 0], [10, phase === 2 ? 1 : 0]]) {
      rect(buf, x, 26, x + 2, 30 - lift, MAIL_PANTS);
      rect(buf, x + 2, 26, x + 2, 30 - lift, shades(MAIL_PANTS)[2]);
      rect(buf, x - (lift ? 1 : 0), 31 - lift, x + 2, 31 - lift, [236, 236, 240]);
    }
    rect(buf, 5, 25, 12, 25, shades(MAIL_PANTS)[2]); // belt line
  }
}

function composeMailman(scene = false, phase = 0, back = false): Buf {
  CUR_W = PORTRAIT_W; CUR_H = scene ? SCENE_H : PORTRAIT_H;
  const buf = new Uint8ClampedArray(CUR_W * CUR_H * 4);
  mailmanBody(buf, scene, back, phase);
  mailmanHead(buf, back);
  outlinePass(buf);
  return buf;
}

export function portraitBuf(name: OfficeCharacterName): Buf {
  return getBuf(name).slice();
}

function getBuf(name: OfficeCharacterName): Buf {
  let buf = bufCache.get(name);
  if (!buf) {
    buf = name === 'mailman' ? composeMailman() : isSchoolName(name) ? composeSchool(name) : compose(RECIPES[name] ?? RECIPES.jim);
    bufCache.set(name, buf);
  }
  return buf;
}

export interface SceneFrames { front: Buf[]; back: Buf[]; }

/** Walk-phase frames (stand, step-L, step-R) for the in-scene sprite, front + back. */
export function sceneFrameBufs(name: OfficeCharacterName): SceneFrames {
  let frames = sceneCache.get(name);
  if (!frames) {
    const r = RECIPES[name] ?? RECIPES.jim;
    frames = {
      front: [0, 1, 2].map((phase) => name === 'mailman' ? composeMailman(true, phase) : isSchoolName(name) ? composeSchool(name, true, phase) : composeScene(r, phase, false)),
      back: [0, 1, 2].map((phase) => name === 'mailman' ? composeMailman(true, phase, true) : isSchoolName(name) ? composeSchool(name, true, phase, true) : composeScene(r, phase, true)),
    };
    sceneCache.set(name, frames);
  }
  return frames;
}

/** Paint a character's procedural portrait onto `ctx`, nearest-neighbor at `scale`. */
export function paintPortrait(ctx: CanvasRenderingContext2D, name: OfficeCharacterName, scale = 2): void {
  const buf = getBuf(name);
  // Stage at 1× on an offscreen canvas, then blit scaled with smoothing off.
  const stage = document.createElement('canvas');
  stage.width = PORTRAIT_W; stage.height = PORTRAIT_H;
  const sctx = stage.getContext('2d')!;
  const img = sctx.createImageData(PORTRAIT_W, PORTRAIT_H);
  img.data.set(buf);
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, PORTRAIT_W * scale, PORTRAIT_H * scale);
  ctx.drawImage(stage, 0, 0, PORTRAIT_W, PORTRAIT_H, 0, 0, PORTRAIT_W * scale, PORTRAIT_H * scale);
}
