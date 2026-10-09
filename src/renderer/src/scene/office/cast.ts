// The Office cast — roster metadata + sprite frames.
//
// Both the static portraits (cards / picker) and the in-scene walking sprites are
// now fully custom-drawn from the same per-character recipes in portraitArt.ts:
// the scene sprite reuses the portrait's exact head/face/clothing and adds legs,
// so an agent on the office floor looks identical to its card. The LimeZu base
// sheets are no longer used for the cast. See assets/ATTRIBUTION.md.

import { Texture } from 'pixi.js';
import { paintPortrait, sceneFrameBufs, SCENE_W, SCENE_H, PORTRAIT_W, PORTRAIT_H } from './portraitArt';

export type OfficeCharacterName =
  | 'michael' | 'jim' | 'pam' | 'dwight' | 'kevin' | 'angela'
  | 'oscar' | 'stanley' | 'phyllis' | 'andy' | 'kelly' | 'ryan'
  | 'toby' | 'creed' | 'meredith' | 'mailman'
  | 'principal' | 'teacher' | 'topper' | 'smartguy' | 'librarian';

export interface CastMember {
  name: OfficeCharacterName;
  displayName: string;
  /** Signature accent color (hex) — used for the in-scene selection glow. */
  shirt: string;
  /** Blurb shown when this character is picked / has no description yet. */
  blurb: string;
}

/** Selectable roster, in display order. */
export const OFFICE_CAST: CastMember[] = [
  { name: 'michael',  displayName: 'Michael',  shirt: '#5a6b8c', blurb: "World's best boss" },
  { name: 'jim',      displayName: 'Jim',      shirt: '#6fa8dc', blurb: 'Salesman, prankster' },
  { name: 'pam',      displayName: 'Pam',      shirt: '#9caf88', blurb: 'Receptionist, artist' },
  { name: 'dwight',   displayName: 'Dwight',   shirt: '#b89b3e', blurb: 'Assistant (to the) RM' },
  { name: 'kevin',    displayName: 'Kevin',    shirt: '#4a7ab5', blurb: 'Accounting' },
  { name: 'angela',   displayName: 'Angela',   shirt: '#8a86a6', blurb: 'Head of accounting' },
  { name: 'oscar',    displayName: 'Oscar',    shirt: '#7a4b6b', blurb: 'Accountant' },
  { name: 'stanley',  displayName: 'Stanley',  shirt: '#8c5a4b', blurb: 'Sales, crossword' },
  { name: 'phyllis',  displayName: 'Phyllis',  shirt: '#b08bbf', blurb: 'Sales' },
  { name: 'andy',     displayName: 'Andy',     shirt: '#6fae6f', blurb: 'Cornell, a cappella' },
  { name: 'kelly',    displayName: 'Kelly',    shirt: '#d16ba5', blurb: 'Customer service' },
  { name: 'ryan',     displayName: 'Ryan',     shirt: '#3a3a44', blurb: 'The temp' },
  { name: 'toby',     displayName: 'Toby',     shirt: '#9a8c5a', blurb: 'Human resources' },
  { name: 'creed',    displayName: 'Creed',    shirt: '#6b7a4b', blurb: 'Quality assurance' },
  { name: 'meredith', displayName: 'Meredith', shirt: '#b5544a', blurb: 'Supplier relations' },
  { name: 'mailman',  displayName: 'Mailman',  shirt: '#2f5f9e', blurb: 'Reads, writes and sends your mail' },
  { name: 'principal', displayName: 'Principal', shirt: '#2b394f', blurb: 'Runs the school' },
  { name: 'teacher',   displayName: 'Teacher',   shirt: '#a3644c', blurb: 'Explains it properly' },
  { name: 'topper',    displayName: 'Topper',    shirt: '#2b5341', blurb: 'Top of the class — and she knows it' },
  { name: 'smartguy',  displayName: 'Smart Guy', shirt: '#7e9475', blurb: 'Lazy genius — tips and tricks' },
  { name: 'librarian', displayName: 'Librarian', shirt: '#365846', blurb: 'Shhh — knows where everything is' },
];

export const CAST_BY_NAME: Record<OfficeCharacterName, CastMember> =
  Object.fromEntries(OFFICE_CAST.map((c) => [c.name, c])) as Record<OfficeCharacterName, CastMember>;

const SCHOOL_NAMES: OfficeCharacterName[] = ['principal', 'teacher', 'topper', 'smartguy', 'librarian'];
export const SCHOOL_CAST = OFFICE_CAST.filter((member) =>
  ['principal', 'teacher', 'topper', 'smartguy', 'librarian'].includes(member.name));
export const DEFAULT_CHARACTER: OfficeCharacterName = 'jim';
export function defaultCharacterForTheme(theme: string): OfficeCharacterName {
  return theme === 'staffroom' ? 'teacher' : DEFAULT_CHARACTER;
}
export function castForTheme(theme: string): CastMember[] {
  return theme === 'staffroom' ? SCHOOL_CAST : OFFICE_CAST.filter((member) => !SCHOOL_CAST.includes(member));
}

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// ─── scene frames ────────────────────────────────────────────────────────────
const frameCache = new Map<OfficeCharacterName, Texture[][]>();

function bufToTexture(buf: Uint8ClampedArray): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_W; canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SCENE_W, SCENE_H);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

/**
 * Frame grid CharacterSprite expects: 3 rows (down, up, right) × 7 frames
 * [walk1, walk2, walk3, type1, type2, read1, read2]. We provide a front view
 * (down — and reused for the side row, so left/right walkers still show a face)
 * and a back view (up — agents seated facing their desk show their back). The
 * three walk frames are stand / step-left / step-right.
 */
export async function getCastFrames(name: OfficeCharacterName): Promise<Texture[][]> {
  const cached = frameCache.get(name);
  if (cached) return cached;
  if (SCHOOL_NAMES.includes(name)) {
    try {
      const { schoolSceneFrames } = await import('./schoolSprites');
      const drawn = await schoolSceneFrames(name);
      if (drawn) { frameCache.set(name, drawn); return drawn; }
    } catch { /* fall back to the procedural sprite */ }
  }
  const { front, back } = sceneFrameBufs(name);
  const toRow = (bufs: Uint8ClampedArray[]): Texture[] => {
    const [stand, stepL, stepR] = bufs.map(bufToTexture);
    return [stand, stepL, stepR, stand, stand, stand, stand];
  };
  const frontRow = toRow(front);
  const frames: Texture[][] = [frontRow, toRow(back), frontRow]; // down, up, right
  frameCache.set(name, frames);
  return frames;
}

/**
 * Paint a character's static portrait for cards / the picker (delegates to the
 * custom procedural composer in portraitArt.ts).
 */
export async function paintCastPortrait(
  ctx: CanvasRenderingContext2D,
  name: OfficeCharacterName,
  scale = 2,
): Promise<void> {
  if (SCHOOL_NAMES.includes(name)) {
    try {
      const { schoolPngUrl, loadImage } = await import('./schoolSprites');
      const url = schoolPngUrl(name, 'portrait');
      if (url) {
        const img = await loadImage(url);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, PORTRAIT_W * scale, PORTRAIT_H * scale);
        ctx.drawImage(img, 0, 0, PORTRAIT_W, PORTRAIT_H, 0, 0, PORTRAIT_W * scale, PORTRAIT_H * scale);
        return;
      }
    } catch { /* fall back to the procedural portrait */ }
  }
  paintPortrait(ctx, name, scale);
}
