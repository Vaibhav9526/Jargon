// Redesigned school sprites — loaded on demand (needs the bundler's import.meta.glob,
// so cast.ts must not import this statically: plain-node tests load cast.ts).
import { Texture } from 'pixi.js';
import { SCENE_W, SCENE_H } from './portraitArt';

// The staff-room cast ships hand-drawn PNGs (assets/sprites/school): an 18x28
// portrait and a 108x32 walk sheet of six 18x32 frames
// [front-idle, front-left, front-right, back-idle, back-left, back-right].
// When a file is present it wins; otherwise the procedural art below is used.
const schoolPngs = import.meta.glob('../../assets/sprites/school/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export function schoolPngUrl(name: string, kind: 'portrait' | 'walk'): string | null {
  const hit = Object.entries(schoolPngs).find(([path]) => path.endsWith(`/${name}-${kind}.png`));
  return hit ? hit[1] : null;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`sprite failed to load: ${url}`));
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

export async function schoolSceneFrames(name: string): Promise<Texture[][] | null> {
  const url = schoolPngUrl(name, 'walk');
  if (!url) return null;
  const sheet = await loadImage(url);
  if (sheet.naturalWidth < SCENE_W * 6 || sheet.naturalHeight < SCENE_H) return null;
  const tex: Texture[] = [];
  for (let i = 0; i < 6; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = SCENE_W; canvas.height = SCENE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, i * SCENE_W, 0, SCENE_W, SCENE_H, 0, 0, SCENE_W, SCENE_H);
    const t = Texture.from(canvas);
    t.source.scaleMode = 'nearest';
    tex.push(t);
  }
  const row = (a: Texture, l: Texture, r: Texture): Texture[] => [a, l, r, a, a, a, a];
  const front = row(tex[0], tex[1], tex[2]);
  return [front, row(tex[3], tex[4], tex[5]), front]; // down, up, right
}

