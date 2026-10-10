// Procedural pixel-art people for the Tapri chai-stall scene.
//
// Each person is composed on a small sprite grid (one cell = one sprite px), given a
// 1px dark outline around the silhouette, then emitted as fillRect runs (identical
// neighbouring cells in a column are merged, so a person is a few hundred rects at most).
//
// Sprite space: W = 18 columns. Column 9 is the centre line; +x is the way the person
// faces (facing -1 mirrors the whole sprite around the anchor). Row 0 is the top of the
// frame. A standing person is 38 rows tall, feet on row 36, outline row 37. A seated one
// is 28 rows tall. The (x, y) passed in is the feet (or seat) centre on screen.

import type { Ctx, Facing, Mood, Outfit, PersonDrawOpts, PersonStyle } from './types';

const W = 18;
const CX = 9;
const SPRITE_W = W;
const H_STAND = 38;
const H_SIT = 28;
const DEFAULT_PX = 3;

const SKIN = ['#7a4b2a', '#8f5d35', '#a8714a', '#c08a5e', '#d9a57a'];
const HAIR = ['#1a1412', '#2a1d17', '#3b2a20', '#15100d'];
const GREY = '#9a9a9a';
const INK = '#23150f';
const OUT = '#2a1a10';
const SHOE = '#2b2220';
const LIP = '#8a3a3a';
const MOUTH = '#2a0f0a';
const TEETH = '#f5f5f5';
const TONGUE = '#d0606a';
const BROW = '#3a2418';
const METAL = '#3a3a3a';
const LENS = '#cfe9ff';
const WHITE = '#f5f5f5';
const EYE_WHITE = '#f4f1ea';
const STEAM = '#e6e6e6';
const RED_SKIN = '#c8553d';
const RED_SKIN_SH = '#9e3a2a';
const SHAWL = '#efe6cf';
const BORDER_GOLD = '#e0b040';
const KURTA_COLS = ['#2e7d8c', '#c97b2e', '#7a4fa0', '#3d8f4f', '#e8dcc0'];
const SAREE_COLS = ['#b03060', '#2a7f62', '#d4467a', '#c0392b'];
const TEE_COLS = ['#e4572e', '#3d9ae0', '#f2c14e', '#7bbf6a'];

type Cell = string | null;

function pick<T>(list: readonly T[], v: number): T {
  return list[Math.abs(Math.trunc(v)) % list.length];
}

function scaleHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * k))).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Per-variant tint so two patrons in the same outfit do not look identical. */
function tint(hex: string, v: number): string {
  return scaleHex(hex, [1, 0.86, 1.1][Math.abs(Math.trunc(v)) % 3]);
}

// --- sprite grid ----------------------------------------------------------------

class Sprite {
  readonly cells: Cell[];

  constructor(readonly h: number) {
    this.cells = new Array<Cell>(W * h).fill(null);
  }

  set(x: number, y: number, c: string): void {
    if (x >= 0 && y >= 0 && x < W && y < this.h) this.cells[y * W + x] = c;
  }

  at(x: number, y: number): Cell {
    return x >= 0 && y >= 0 && x < W && y < this.h ? this.cells[y * W + x] : null;
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /** Two-tone block: light on the top and left edges, shade on the right and bottom. */
  box(x: number, y: number, w: number, h: number, c: string): void {
    if (w <= 0 || h <= 0) return;
    const hi = scaleHex(c, 1.13);
    const sh = scaleHex(c, 0.78);
    this.rect(x, y, w, h, c);
    for (let xx = x; xx < x + w; xx++) this.set(xx, y, hi);
    for (let yy = y; yy < y + h; yy++) this.set(x, yy, hi);
    for (let yy = y; yy < y + h; yy++) this.set(x + w - 1, yy, sh);
    for (let xx = x; xx < x + w; xx++) this.set(xx, y + h - 1, sh);
  }
}

/** Dark 1px outline around everything drawn, on the empty cells touching the silhouette. */
function outline(sp: Sprite): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < sp.h; y++) {
    for (let x = 0; x < W; x++) {
      if (sp.at(x, y) !== null) continue;
      if (sp.at(x - 1, y) || sp.at(x + 1, y) || sp.at(x, y - 1) || sp.at(x, y + 1)) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) sp.set(x, y, OUT);
}

/**
 * Emit the sprite as fillRects. A cell at column c maps to screen [x + (c - CX) * px,
 * +px) for facing 1 and to the mirror image for facing -1. Runs of one colour are merged
 * across columns, and identical runs are merged down rows.
 */
function emit(ctx: Ctx, sp: Sprite, x: number, y: number, px: number, facing: Facing): void {
  const top = y - sp.h * px;
  let active = new Map<string, { c0: number; c1: number; col: string; y0: number; h: number }>();
  const flush = (a: { c0: number; c1: number; col: string; y0: number; h: number }) => {
    const left = facing === 1 ? x + (a.c0 - CX) * px : x - (a.c1 - CX) * px;
    ctx.fillStyle = a.col;
    ctx.fillRect(left, top + a.y0 * px, (a.c1 - a.c0) * px, a.h * px);
  };
  for (let r = 0; r <= sp.h; r++) {
    const next = new Map<string, { c0: number; c1: number; col: string; y0: number; h: number }>();
    if (r < sp.h) {
      let c = 0;
      while (c < W) {
        const col = sp.cells[r * W + c];
        if (col === null) { c++; continue; }
        const c0 = c;
        while (c < W && sp.cells[r * W + c] === col) c++;
        const key = `${c0}:${c}:${col}`;
        const prev = active.get(key);
        if (prev) {
          prev.h++;
          next.set(key, prev);
        } else {
          next.set(key, { c0, c1: c, col, y0: r, h: 1 });
        }
      }
    }
    for (const [k, a] of active) if (!next.has(k)) flush(a);
    active = next;
  }
}

// --- head ------------------------------------------------------------------------
// The head is 10 cells wide and 8 tall (rows 1..8 of the frame). Each token is a cell:
// s skin, d skin shade (ears, jaw), h hair, H hair highlight, j hair shade, b brow,
// w eye white, i pupil, e lid line, a closed-eye arc, n nose shade, l lips, m open mouth,
// t teeth, r tongue, M moustache, g spec frame, L lens, B bindi, T tilak, W white topi,
// k khaki cap, K cap peak, G cap badge, '.' empty. Column 0 and 9 are the ears.

const HEAD_R0 = '. . h H h h h j . .';
const HEAD_R1 = '. h h h h h h h j .';

/** Rows 2..7 of the head for each mood. Every mood reads from these rows alone. */
const FACE: Record<Mood, string[]> = {
  neutral: [
    'h h s s s s s s h h',
    'd s b b s s b b s d',
    'd s w i s s i w s d',
    'd s e e n n e e s d',
    '. s s l l l l s s .',
    '. . d d d d d d . .',
  ],
  interested: [
    'h h b b s s b b h h', // brows high
    'd s w w s s w w s d', // wide eyes
    'd s w i s s i w s d',
    'd s s s n n s s s d',
    '. s l s s s s l s .', // slight smile
    '. . d d d d d d . .',
  ],
  wow: [
    'h h b b s s b b h h',
    'd s w w s s w w s d',
    'd s w i s s i w s d',
    'd s s s n n s s s d',
    '. s s m m m m s s .', // round open mouth
    '. . d m m m m d . .',
  ],
  confused: [
    'h h b b s s s s h h', // left brow up
    'd s s s s s b b s d', // right brow down
    'd s e e s s i w s d', // squint on the left
    'd s s s n n s s s d',
    '. s s l l l s s s .', // mouth skewed
    '. . d d d d l d . .',
  ],
  sayAgain: [
    'h h b b s s b b h h',
    'd s w w s s w w s d',
    'd s w i s s i w s d',
    'd s s s n n s s s d',
    '. s s s m m s s s .', // "huh?"
    '. . d d m m d d . .',
  ],
  hating: [
    'h h b s s s s b h h', // V brows
    'd s s b s s b s s d',
    'd s w i s s i w s d',
    'd s e e n n e e s d',
    '. s s l l l l s s .',
    '. . l d d d d l . .', // frown
  ],
  furious: [
    'h h s s s s s s h h',
    'd b b b s s b b b d', // brows slammed down
    'd s e e s s e e s d',
    'd s e e n n e e s d',
    '. s m t t t t m s .', // bared teeth
    '. . m m m m m m . .',
  ],
  laughing: [
    'h h s s s s s s h h',
    'd s s s s s s s s d',
    'd s a a s s a a s d', // closed arc eyes
    'd s s s n n s s s d',
    '. s t t t t t t s .', // wide open, teeth showing
    '. . m r r r r m . .',
  ],
  bored: [
    'h h s s s s s s h h',
    'd s s s s s s s s d',
    'd s e e s s e e s d', // half-lidded
    'd s i i n n i i s d',
    '. s s l l l l s s .', // flat mouth
    '. . d d d d d d . .',
  ],
};

interface HeadPal {
  skin: string;
  skinSh: string;
  hair: string;
  hairHi: string;
  hairSh: string;
}

function tokenColour(tok: string, p: HeadPal): Cell {
  switch (tok) {
    case 's': return p.skin;
    case 'd': case 'x': case 'n': return p.skinSh;
    case 'h': case 'M': return p.hair;
    case 'H': return p.hairHi;
    case 'j': return p.hairSh;
    case 'w': return EYE_WHITE;
    case 'i': case 'e': case 'a': return INK;
    case 'b': return BROW;
    case 'l': return LIP;
    case 'm': return MOUTH;
    case 't': return TEETH;
    case 'r': return TONGUE;
    case 'g': return METAL;
    case 'L': return LENS;
    case 'B': return '#c0392b';
    case 'T': return '#e0a030';
    case 'W': return WHITE;
    case 'k': return '#c2b280';
    case 'K': return '#1f1f1f';
    case 'G': return '#d4af37';
    default: return null;
  }
}

/** Head token rows for this mood and outfit, copied so overlays do not leak between people. */
function headRows(mood: Mood, outfit: Outfit, v: number, talkOpen: boolean): string[][] {
  const rows = [HEAD_R0, HEAD_R1, ...FACE[mood]].map((s) => s.split(' '));
  const mouthRow = rows[6];
  if (talkOpen) for (let c = 3; c <= 6; c++) if (mouthRow[c] === 'l' || mouthRow[c] === 's') mouthRow[c] = 'm';

  switch (outfit) {
    case 'cop':
      rows[0] = '. k k k G k k k k .'.split(' ');
      rows[1] = '. k k k k k k k k .'.split(' ');
      for (let c = 6; c <= 9; c++) rows[2][c] = 'K';
      break;
    case 'kurta':
      if (Math.abs(Math.trunc(v)) % 2 === 0) {
        rows[0] = '. . . W W W W . . .'.split(' ');
        rows[1] = '. W W W W W W W W .'.split(' ');
      }
      break;
    case 'dhoti':
      rows[2][4] = 'T';
      rows[2][5] = 'T';
      break;
    case 'aunty':
      rows[2][4] = 'B';
      break;
    case 'uncle':
      // Specs: a 3x3 ring around each eye with a bridge over the nose.
      for (const c of [1, 2, 3, 6, 7, 8]) { rows[3][c] = 'g'; rows[5][c] = 'g'; }
      for (const c of [1, 3, 4, 5, 6, 8]) rows[4][c] = 'g';
      rows[4][2] = 'L';
      rows[4][7] = 'L';
      break;
    default:
      break;
  }

  const moustache = outfit === 'uncle' || outfit === 'dhoti' || outfit === 'driver'
    || (outfit === 'kurta' && Math.abs(Math.trunc(v)) % 2 === 1);
  if (moustache) for (let c = 3; c <= 6; c++) if (mouthRow[c] === 'l' || mouthRow[c] === 's') mouthRow[c] = 'M';

  return rows;
}

// --- body helpers ---------------------------------------------------------------

/** An arm: sleeve (if any) from the shoulder, then bare forearm and hand. */
function arm(sp: Sprite, x: number, y0: number, y1: number, sleeveRows: number, sleeve: string | null, skin: string): void {
  const len = y1 - y0 + 1;
  const s = sleeve ? Math.max(0, Math.min(sleeveRows, len - 2)) : 0;
  if (s > 0 && sleeve) sp.box(x, y0, 2, s, sleeve);
  sp.box(x, y0 + s, 2, len - s, skin);
}

interface Look {
  shirt: string;
  sleeve: number;
  pants: string;
  shoe: string;
}

function look(outfit: Outfit, v: number): Look {
  const c = (hex: string) => tint(hex, v);
  switch (outfit) {
    case 'me': return { shirt: c('#5b7aa0'), sleeve: 5, pants: c('#3b3f5c'), shoe: SHOE };
    case 'tapriwala': return { shirt: c('#efefe9'), sleeve: 4, pants: c('#8a6d4b'), shoe: SHOE };
    case 'baniyan': return { shirt: c('#f5f5f5'), sleeve: 0, pants: c('#3a6ea5'), shoe: '#4a3a2a' };
    case 'dhoti': return { shirt: skinOf(v), sleeve: 0, pants: WHITE, shoe: '#8a5a3a' };
    case 'kurta': return { shirt: pick(KURTA_COLS, v), sleeve: 12, pants: WHITE, shoe: '#7a4a2a' };
    case 'uncle': return { shirt: c('#9cc7a0'), sleeve: 5, pants: c('#5c5c6b'), shoe: '#5a3a22' };
    case 'aunty': return { shirt: pick(SAREE_COLS, v), sleeve: 4, pants: pick(SAREE_COLS, v), shoe: '#3a2a20' };
    case 'student': return { shirt: pick(TEE_COLS, v), sleeve: 5, pants: '#2f4f8f', shoe: '#eeeeee' };
    case 'officegoer': return { shirt: '#f4f4f6', sleeve: 12, pants: c('#3c3f4a'), shoe: '#1c1c1c' };
    case 'cop': return { shirt: c('#c2b280'), sleeve: 12, pants: c('#8c7b4f'), shoe: '#1e1e1e' };
    case 'driver': return { shirt: c('#c8b27a'), sleeve: 5, pants: c('#3f3f46'), shoe: '#1c1c1c' };
  }
}

function skinOf(v: number): string {
  return pick(SKIN, v);
}

// --- public API -------------------------------------------------------------------

/** Size of a standing person on screen, in px. Facing does not change it. */
export function personSize(px: number = DEFAULT_PX): { w: number; h: number } {
  return { w: SPRITE_W * px, h: H_STAND * px };
}

export function drawPerson(ctx: Ctx, style: PersonStyle, x: number, y: number, o: PersonDrawOpts): void {
  const px = o.px ?? DEFAULT_PX;
  const sit = o.pose === 'sit';
  const sp = new Sprite(sit ? H_SIT : H_STAND);
  paint(sp, style, o, sit, o.pose === 'walk');
  outline(sp);
  emit(ctx, sp, x, y, px, o.facing);
}

function paint(sp: Sprite, style: PersonStyle, o: PersonDrawOpts, sit: boolean, walking: boolean): void {
  const { t, mood } = o;
  const outfit = style.outfit;
  const v = Math.abs(Math.trunc(style.variant));
  const skin = pick(SKIN, v);
  const skinSh = scaleHex(skin, 0.8);
  const hair = outfit === 'uncle' ? GREY : pick(HAIR, v * 2 + 1);
  const L = look(outfit, v);
  const armCol = L.sleeve > 0 ? L.shirt : null;

  // --- motion, all derived from t ------------------------------------------
  const frame = walking ? Math.floor(t / 110) % 4 : 0;
  const stepL = frame === 1 ? 1 : 0;                 // left foot forward (lifted)
  const stepR = frame === 3 ? -1 : 0;                // right foot forward (lifted)
  const swing = frame === 1 ? -1 : frame === 3 ? 1 : 0; // arms counter-swing the legs
  const breathe = !sit && !walking && Math.sin(t / 480) > 0.55 ? 1 : 0;
  const T = sit ? 10 : 10 - breathe;                 // shoulder row (chest rises)
  const TB = sit ? 19 : 21;                          // bottom of the torso
  const armB = sit ? 19 : 21;                        // hands rest here
  const shake = mood === 'laughing' ? Math.round(Math.sin(t / 45)) : 0;
  const lean = mood === 'interested' || mood === 'sayAgain' ? 1 : 0;
  const tx = lean + shake;                           // torso, arms, neck and head shift
  const hx = 4 + tx;                                 // head left edge
  const blink = t % 3400 < 110 && mood !== 'laughing' && mood !== 'bored';
  const talkOpen = o.talking === true && Math.floor(t / 140) % 2 === 1;
  const raisedRight = mood === 'sayAgain' || mood === 'furious' || mood === 'confused';
  const fist = mood === 'furious' ? Math.round(Math.sin(t / 45)) : 0;

  // --- back layer ------------------------------------------------------------
  if (outfit === 'student') sp.box(1, T, 2, 9, '#3d3d3d');   // backpack on the back side

  // --- legs ------------------------------------------------------------------
  if (sit) {
    if (outfit === 'aunty') {
      sp.box(5, 20, 11, 5, L.pants);
      sp.box(13, 25, 3, 2, L.shoe);
    } else if (outfit === 'dhoti') {
      sp.box(5, 20, 11, 3, WHITE);
      sp.box(13, 23, 2, 2, skin);
      sp.box(13, 25, 3, 2, L.shoe);
    } else {
      sp.box(5, 20, 11, 3, L.pants);
      sp.box(13, 23, 2, 2, L.pants);
      sp.box(13, 25, 3, 2, L.shoe);
    }
  } else if (outfit === 'baniyan') {
    sp.box(5, 22, 8, 9, L.pants);                              // checked lungi
    for (let r = 22; r <= 30; r++) for (let c = 5; c <= 12; c++) if ((r + c) % 4 === 0) sp.set(c, r, '#d9e6f2');
    sp.box(6, 31, 3, 4, skin);
    sp.box(9, 31, 3, 4, skin);
    sp.box(5 + stepL, 35, 4, 2, L.shoe);
    sp.box(9 + stepR, 35, 4, 2, L.shoe);
  } else if (outfit === 'dhoti') {
    sp.box(5, 22, 8, 11, WHITE);                               // white dhoti, pleated front
    for (let r = 23; r <= 31; r++) { sp.set(9, r, '#d7d2c4'); sp.set(11, r, '#d7d2c4'); }
    sp.box(6, 33, 3, 2, skin);
    sp.box(9, 33, 3, 2, skin);
    sp.box(5 + stepL, 35, 4, 2, L.shoe);
    sp.box(9 + stepR, 35, 4, 2, L.shoe);
  } else if (outfit === 'aunty') {
    sp.box(5, 22, 8, 13, L.pants);                             // saree falls to the ankle
    for (let c = 5; c <= 12; c++) sp.set(c, 33, BORDER_GOLD);
    sp.box(6 + stepL, 35, 3, 2, L.shoe);
    sp.box(10 + stepR, 35, 3, 2, L.shoe);
  } else {
    const top = outfit === 'kurta' ? 30 : 22;                  // kurta covers to the knee
    const lowL = stepL ? 32 : 34;
    const lowR = stepR ? 32 : 34;
    sp.box(6, top, 3, lowL - top + 1, L.pants);
    sp.box(9, top, 3, lowR - top + 1, L.pants);
    sp.box(5 + stepL, stepL ? 33 : 35, 4, 2, L.shoe);
    sp.box(9 + stepR, stepR ? 33 : 35, 4, 2, L.shoe);
  }

  // --- arms (torso drawn over them) -------------------------------------------
  const leftX = 3 + tx + swing;
  const rightX = 13 + tx - swing;
  if (mood === 'wow') {
    for (const x of [2, 14]) {
      if (armCol) sp.box(x, 5, 2, 6, armCol);
      sp.box(x, 3, 2, 2, skin);
      sp.box(x, 1, 2, 2, skin);
    }
  } else {
    arm(sp, leftX, T, armB, L.sleeve, armCol, skin);
    if (mood === 'sayAgain') {
      if (armCol) sp.box(14, 6, 2, 4, armCol);
      sp.box(14, 3, 2, 3, skin);                             // hand cupped behind the ear
    } else if (mood === 'furious') {
      if (armCol) sp.box(14, 6, 2, 4, armCol);
      sp.box(14 + fist, 2, 2, 4, skin);                      // shaking fist
    } else if (mood === 'confused') {
      if (armCol) sp.box(14, 5, 2, 5, armCol);
      sp.box(14, 2, 2, 3, skin);                             // scratching the head
    } else {
      arm(sp, rightX, T, armB, L.sleeve, armCol, skin);
    }
  }
  if (mood === 'bored') sp.rect(4 + tx, 9, 2, 2, armCol ?? skin);

  // --- torso -----------------------------------------------------------------
  const torso = (c: string, x0 = 5, w = 8, bottom = TB) => sp.box(x0 + tx, T, w, bottom - T + 1, c);
  switch (outfit) {
    case 'me':
    case 'officegoer':
    case 'cop':
    case 'driver':
    case 'uncle': {
      if (outfit === 'uncle') {
        torso(L.shirt, 5, 8, 14);
        sp.box(4 + tx, 15, 10, 7, L.shirt);                    // belly
        for (let r = 15; r <= 21; r++) for (let c = 4; c <= 13; c++) if ((r + c) % 3 === 0) sp.set(c + tx, r, scaleHex(L.shirt, 0.88));
      } else {
        torso(L.shirt);
      }
      if (outfit === 'officegoer') {
        sp.rect(8 + tx, T + 1, 2, 6, '#7a1f2b');               // tie
        sp.set(8 + tx, T + 7, '#5e1620');
        sp.set(9 + tx, T + 7, '#5e1620');
        for (let r = T; r <= T + 3; r++) sp.set(7 + tx, r, '#2a6bd6'); // lanyard
        sp.box(6 + tx, T + 4, 3, 3, '#fafafa');                 // badge
      }
      if (outfit === 'cop') {
        sp.set(5 + tx, T, '#8c7b4f');                          // shoulder boards
        sp.set(12 + tx, T, '#8c7b4f');
        sp.set(6 + tx, T + 3, '#9f9461');                      // pocket
        sp.set(11 + tx, T + 3, '#9f9461');
        sp.box(5 + tx, TB, 8, 1, '#1e1e1e');                    // belt
        sp.set(8 + tx, TB, '#d4af37');
        sp.set(9 + tx, TB, '#d4af37');
      }
      if (outfit === 'driver') {
        for (let c = 5; c <= 12; c++) sp.set(c + tx, T, c % 2 ? '#c0392b' : WHITE); // towel round the neck
        sp.box(8 + tx, T + 1, 2, 5, '#c0392b');                 // towel end
      }
      if (outfit === 'me') {
        sp.set(8 + tx, T + 1, scaleHex(L.shirt, 0.7));          // placket
        sp.set(9 + tx, T + 1, scaleHex(L.shirt, 0.7));
      }
      break;
    }
    case 'tapriwala':
      torso(L.shirt);
      sp.box(6 + tx, 13, 6, TB - 12, '#6b4a2a');              // apron
      sp.box(4 + tx, T, 2, 8, '#c0392b');                     // gamchha on the shoulder
      sp.set(4 + tx, T + 2, WHITE);
      sp.set(4 + tx, T + 5, WHITE);
      break;
    case 'baniyan':
      torso(WHITE);
      for (let r = T; r <= TB; r += 2) for (let c = 6; c <= 11; c++) sp.set(c + tx, r, '#dcdcd4'); // ribbing
      if (v % 2 === 1) for (let c = 7; c <= 10; c++) sp.set(c + tx, T, '#e8b830'); // gold chain
      break;
    case 'dhoti': {
      torso(skin, 5, 8, TB);
      for (let k = 0; k <= TB - T; k++) {                    // angvastra across the chest
        const c = 5 + tx + Math.floor(k * 0.6);
        sp.set(c, T + k, '#c0392b');
        sp.set(c + 1, T + k, SHAWL);
      }
      sp.box(3 + tx, T, 2, 3, SHAWL);                          // over the left shoulder
      break;
    }
    case 'kurta': {
      sp.box(5 + tx, T, 8, 29 - T + 1, L.shirt);                // knee-length kurta
      for (let r = T + 1; r <= T + 7; r++) sp.set(9 + tx, r, scaleHex(L.shirt, 0.72));
      sp.set(8 + tx, T + 2, WHITE);
      sp.set(8 + tx, T + 5, WHITE);
      break;
    }
    case 'aunty': {
      torso(L.shirt, 5, 8, TB);
      sp.box(3 + tx, T, 2, 10, L.shirt);                       // pallu over the left arm
      for (let r = T; r < T + 10; r++) sp.set(3 + tx, r, BORDER_GOLD);
      break;
    }
    case 'student': {
      torso(L.shirt);
      sp.box(7 + tx, T + 3, 4, 3, '#fdfdfd');                 // tee print
      sp.set(8 + tx, T + 4, scaleHex(L.shirt, 0.7));
      sp.set(9 + tx, T + 4, scaleHex(L.shirt, 0.7));
      sp.set(5 + tx, T, '#222222');                            // backpack strap
      sp.set(12 + tx, T, '#222222');
      break;
    }
  }

  // Tapriwala gamchha, bored hand and crossed arms are overlays on top of the torso.
  if (mood === 'hating') sp.box(3 + tx, 14, 12, 3, armCol ?? skin);   // arms crossed

  // --- neck ------------------------------------------------------------------
  sp.rect(8 + tx, 9, 2, 1, skin);

  // --- head ------------------------------------------------------------------
  const pal: HeadPal = mood === 'furious'
    ? { skin: RED_SKIN, skinSh: RED_SKIN_SH, hair, hairHi: scaleHex(hair, 1.6), hairSh: scaleHex(hair, 0.7) }
    : { skin, skinSh, hair, hairHi: scaleHex(hair, 1.6), hairSh: scaleHex(hair, 0.7) };
  if (outfit === 'uncle') { pal.hair = GREY; pal.hairHi = '#bcbcbc'; pal.hairSh = '#6e6e6e'; }
  const rows = headRows(mood, outfit, v, talkOpen);
  if (blink) {
    for (const c of [2, 3, 6, 7]) {
      if (rows[3][c] === 'w') rows[3][c] = 's';
      if (['w', 'i', 'e'].includes(rows[4][c])) rows[4][c] = 'e';
    }
  }
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 10; c++) {
      const col = tokenColour(rows[r][c], pal);
      if (col) sp.set(hx + c, 1 + r, col);
    }
  }
  if (outfit === 'aunty') sp.box(2 + tx, 2, 2, 3, hair);       // bun at the back of the head

  // hand on the chin (bored) and fist / head-scratch overlays need the head drawn first
  if (mood === 'bored') {
    sp.box(hx + 1, 8, 4, 2, skin);
    sp.set(4 + tx, 9, skin);
  }
  if (mood === 'furious') {
    const a = Math.floor(t / 180) % 2 === 0;
    const puffs = a ? [[1, 0], [2, 2], [0, 1]] : [[1, 2], [2, 0], [0, 0]];
    for (const [x, y] of puffs) { sp.set(x, y, STEAM); sp.set(17 - x, y, STEAM); }
  }
  if (o.chai && !raisedRight) {
    const gy = sit ? 16 : 18;
    sp.box(15 + tx, gy, 2, 4, '#dfe6ea');
    sp.rect(15 + tx, gy + 1, 2, 3, '#b5651d');
    sp.rect(15 + tx, gy, 2, 1, '#f2f2f2');
    const wisp = Math.floor(t / 250) % 3;
    sp.set(15 + tx + (Math.floor(t / 400) % 2), gy - 2 - wisp, STEAM);
  }
}
// --- mood bubbles -------------------------------------------------------------
// Not used by the scene any more (the face carries the mood); kept for callers.

const GLYPH_BANG = ['.#.', '.#.', '.#.', '...', '.#.'];
const GLYPH_Q = ['###', '..#', '.##', '...', '.#.'];
const GLYPH_Z = ['###', '..#', '.#.', '#..', '###'];
const GLYPH_H = ['#..', '#..', '###', '#.#', '#.#'];
const GLYPH_A = ['...', '.#.', '#.#', '###', '#.#'];
const CLOUD = ['.##.#..', '#######', '#######', '.#####.'];
const ANGER = ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'];

function glyph(ctx: Ctx, rows: readonly string[], gx: number, gy: number, color: string, px: number): void {
  ctx.fillStyle = color;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '#') ctx.fillRect(gx + c * px, gy + r * px, px, px);
    }
  });
}

/**
 * Speech bubble with a mood symbol. (x, y) is the point just above the head
 * (bottom-centre of where the bubble's tail points). Bobs gently with t.
 */
export function drawMoodBubble(ctx: Ctx, mood: Mood, x: number, y: number, t: number, px: number = DEFAULT_PX): void {
  if (mood === 'neutral') return;
  const bob = Math.round(Math.sin(t / 260)) * px;
  const left = x - 4 * px;
  const top = y - 10 * px + bob;
  const ix = left + px;
  const iy = top + px;

  ctx.fillStyle = INK;
  ctx.fillRect(left, top, 9 * px, 8 * px);          // 1px ring
  ctx.fillStyle = '#fffdf6';
  ctx.fillRect(ix, iy, 7 * px, 6 * px);
  ctx.fillStyle = INK;
  ctx.fillRect(x - px, top + 8 * px, px, px);       // tail

  switch (mood) {
    case 'interested':
      glyph(ctx, GLYPH_BANG, ix + 2 * px, iy, INK, px);
      break;
    case 'wow':
      glyph(ctx, GLYPH_BANG, ix, iy, INK, px);
      glyph(ctx, GLYPH_BANG, ix + 4 * px, iy, INK, px);
      break;
    case 'confused':
      glyph(ctx, GLYPH_Q, ix + 2 * px, iy, INK, px);
      break;
    case 'sayAgain':
      glyph(ctx, GLYPH_Q, ix, iy, INK, px);
      glyph(ctx, GLYPH_BANG, ix + 4 * px, iy, INK, px);
      break;
    case 'hating':
      glyph(ctx, CLOUD, ix, iy + px, '#4a4a58', px);
      break;
    case 'furious':
      glyph(ctx, ANGER, ix + px, iy, '#d7261e', px);
      break;
    case 'laughing':
      glyph(ctx, GLYPH_H, ix, iy, INK, px);
      glyph(ctx, GLYPH_A, ix + 4 * px, iy, INK, px);
      break;
    case 'bored':
      glyph(ctx, GLYPH_Z, ix + 2 * px, iy, INK, px);
      break;
    default:
      break;
  }
}
