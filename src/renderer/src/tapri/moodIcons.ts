// Pixel-art reaction faces for the Tapri scene. Hand-placed on an 11x11 grid and drawn with
// fillRect only, so they sit in the same chunky style as the backdrop and the sprites
// (no emoji: those come from the OS font and break the theme).
import type { Mood } from './types';

type Key = 'o' | 'f' | 's' | 'w' | 'k' | 'r' | 'b' | 'p';
type Cell = [number, number, Key];

const COLORS: Record<Key, string> = {
  o: '#2a1a10', // outline
  f: '#ffd45e', // face
  s: '#e3a63a', // face shade
  w: '#fffdf4', // eye white / teeth
  k: '#2a1a10', // ink: pupils, brows, mouth
  r: '#e0452f', // red: furious face, tongue
  b: '#58b7ff', // blue: tears / sweat
  p: '#c0392b', // dark red
};

const N = 11;

/** Face colour per mood. */
const FACE: Partial<Record<Mood, string>> = { furious: '#e0452f', hating: '#f6a640', bored: '#e1dca6' };
const SHADE: Partial<Record<Mood, string>> = { furious: '#b8301f', hating: '#cf8426', bored: '#b9b47e' };

const row = (y: number, xs: number[], k: Key): Cell[] => xs.map((x) => [x, y, k]);

/** Features per mood (eyes at rows 3-4, mouth rows 6-9). */
const FEATURES: Partial<Record<Mood, Cell[]>> = {
  interested: [
    ...row(2, [2, 3, 7, 8], 'k'),                          // raised brows
    ...row(3, [3, 4, 6, 7], 'w'), ...row(4, [3, 4, 6, 7], 'w'),
    [4, 4, 'k'], [4, 3, 'k'], [6, 4, 'k'], [6, 3, 'k'],    // pupils looking in
    ...row(6, [3, 7], 'k'), ...row(7, [4, 5, 6], 'k'),     // smile
  ],
  wow: [
    ...row(2, [3, 4, 6, 7], 'k'),
    ...row(3, [3, 4, 6, 7], 'w'), ...row(4, [3, 4, 6, 7], 'w'),
    [3, 4, 'k'], [7, 4, 'k'],
    ...row(6, [5], 'k'), ...row(7, [4, 6], 'k'), ...row(8, [4, 6], 'k'), ...row(9, [5], 'k'), [5, 7, 'k'], [5, 8, 'k'], // round open mouth
  ],
  confused: [
    ...row(2, [2, 3], 'k'), ...row(3, [7, 8], 'k'),         // one brow up, one down
    [3, 4, 'k'], [4, 4, 'k'], ...row(4, [6, 7, 8], 'k'),    // squint / wide
    [3, 7, 'k'], [4, 8, 'k'], [5, 7, 'k'], [6, 8, 'k'], [7, 7, 'k'], // wavy mouth
    [9, 2, 'b'], [9, 3, 'b'],                              // a sweat drop
  ],
  sayAgain: [
    ...row(2, [2, 3, 4, 6, 7, 8], 'k'),
    [3, 3, 'w'], [4, 3, 'w'], [6, 3, 'w'], [7, 3, 'w'], [3, 4, 'w'], [4, 4, 'w'], [6, 4, 'w'], [7, 4, 'w'],
    [4, 4, 'k'], [6, 4, 'k'],
    ...row(7, [5], 'k'), ...row(8, [4, 6], 'k'), ...row(9, [5], 'k'), // small "huh?" mouth
  ],
  hating: [
    [2, 2, 'k'], [3, 3, 'k'], [4, 3, 'k'], [8, 2, 'k'], [7, 3, 'k'], [6, 3, 'k'], // V brows
    ...row(4, [3, 4, 6, 7], 'k'),
    ...row(8, [4, 5, 6], 'k'), [3, 9, 'k'], [7, 9, 'k'],   // frown
  ],
  furious: [
    [1, 2, 'k'], [2, 2, 'k'], [3, 3, 'k'], [4, 3, 'k'], [9, 2, 'k'], [8, 2, 'k'], [7, 3, 'k'], [6, 3, 'k'],
    ...row(4, [3, 4, 6, 7], 'w'), [4, 4, 'k'], [6, 4, 'k'],
    ...row(7, [3, 4, 5, 6, 7], 'w'), ...row(8, [3, 4, 5, 6, 7], 'w'),
    [4, 7, 'k'], [6, 7, 'k'], [4, 8, 'k'], [6, 8, 'k'], ...row(6, [3, 4, 5, 6, 7], 'k'), ...row(9, [4, 5, 6], 'k'), // bared teeth
  ],
  laughing: [
    [2, 4, 'k'], [3, 3, 'k'], [4, 4, 'k'], [6, 4, 'k'], [7, 3, 'k'], [8, 4, 'k'],     // ^ ^ eyes
    ...row(6, [3, 4, 5, 6, 7], 'k'), ...row(7, [3, 7], 'k'), ...row(7, [4, 5, 6], 'w'),
    ...row(8, [3, 7], 'k'), ...row(8, [4, 5, 6], 'r'), ...row(9, [4, 5, 6], 'k'),     // open laugh, tongue
    [1, 5, 'b'], [9, 5, 'b'],                                                       // tears of joy
  ],
  bored: [
    ...row(3, [3, 4, 6, 7], 'k'), ...row(4, [3, 4, 6, 7], 'w'), [3, 4, 'k'], [6, 4, 'k'], // half-lidded
    ...row(8, [4, 5, 6], 'k'),
  ],
};

/** A "?" mark drawn beside the face for people who want it repeated. */
const QMARK: Cell[] = [
  [0, 0, 'k'], [1, 0, 'k'], [2, 0, 'k'], [3, 1, 'k'], [3, 2, 'k'], [2, 3, 'k'], [1, 4, 'k'], [1, 6, 'k'],
];

interface PixCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** Pixel speech bubble holding the mood face. (cx, headY) = just above the speaker's head. */
export function drawMoodIcon(ctx: PixCtx, mood: Mood, cx: number, headY: number, t: number, px = 4): void {
  const feat = FEATURES[mood];
  if (!feat) return;
  const bob = Math.round(Math.sin(t / 260)) * 2;
  const wide = mood === 'sayAgain' ? 5 : 0;                 // room for the "?"
  const pad = 2;
  const w = (N + pad * 2 + wide) * px;
  const h = (N + pad * 2) * px;
  const x0 = Math.round(cx - w / 2 + (wide * px) / 2);
  const y0 = Math.round(headY - h - 5 * px + bob);
  const r = (x: number, y: number, ww: number, hh: number, c: string): void => { ctx.fillStyle = c; ctx.fillRect(x, y, ww * px, hh * px); };

  // Bubble: pixel-rounded rectangle with a dark outline and a little tail.
  r(x0 + px, y0, (w / px) - 2, 1, COLORS.o);
  r(x0 + px, y0 + h / px * px - px, (w / px) - 2, 1, COLORS.o);
  r(x0, y0 + px, 1, (h / px) - 2, COLORS.o);
  r(x0 + w - px, y0 + px, 1, (h / px) - 2, COLORS.o);
  r(x0 + px, y0 + px, (w / px) - 2, (h / px) - 2, '#fffbea');
  const tx = Math.round(cx / px) * px;
  r(tx - px, y0 + h - px, 3, 1, '#fffbea');
  r(tx - px, y0 + h, 1, 1, COLORS.o); r(tx + px, y0 + h, 1, 1, COLORS.o); r(tx, y0 + h + px, 1, 1, COLORS.o);
  r(tx, y0 + h, 1, 1, '#fffbea');

  // Face disc.
  const fx = x0 + pad * px;
  const fy = y0 + pad * px;
  const face = FACE[mood] ?? COLORS.f;
  const shade = SHADE[mood] ?? COLORS.s;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - 5, y - 5);
      if (d > 5.3) continue;
      const c = d > 4.2 ? COLORS.o : (x + y > 12 ? shade : face);
      r(fx + x * px, fy + y * px, 1, 1, c);
    }
  }
  for (const [x, y, k] of feat) r(fx + x * px, fy + y * px, 1, 1, COLORS[k]);

  if (mood === 'sayAgain') for (const [x, y, k] of QMARK) r(fx + (N + 1 + x) * px, fy + (1 + y) * px, 1, 1, COLORS[k]);
  if (mood === 'furious') {
    // Steam puffs rising off the head.
    const up = Math.round(Math.sin(t / 140)) * px;
    r(fx + 0 * px, fy - px + up, 1, 1, '#ffffff'); r(fx + 10 * px, fy - px - up, 1, 1, '#ffffff');
  }
}
