import type { OfficeCharacterName } from '@/scene/office/cast';

/** The staff-room cast that has a classroom chat. */
export const SCHOOL_CAST = ['teacher', 'topper', 'smartguy', 'librarian', 'principal'] as const;
export type SchoolCast = (typeof SCHOOL_CAST)[number];

export function isSchoolCast(c: OfficeCharacterName | string | undefined): c is SchoolCast {
  return !!c && (SCHOOL_CAST as readonly string[]).includes(c);
}

// Drawn art is optional: drop PNGs into src/renderer/src/assets/classroom/
//   expressions/<cast>/<mood>.png   (one face per mood)
//   id-cards/<cast>.png             (ID-card portrait)
// and they are picked up automatically; anything missing falls back to the sprite.
const files = import.meta.glob('../../assets/classroom/**/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

const byKey = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  const m = /classroom\/(?:expressions\/([^/]+)\/([^/]+)|id-cards\/([^/]+))\.png$/.exec(path);
  if (!m) continue;
  byKey.set(m[3] ? `card:${m[3]}` : `face:${m[1]}:${m[2]}`, url);
}

export function moodImage(cast: string, mood: string | undefined): string | null {
  return byKey.get(`face:${cast}:${mood ?? 'neutral'}`) ?? byKey.get(`face:${cast}:neutral`) ?? byKey.get(`card:${cast}`) ?? null;
}

export function idCardImage(cast: string): string | null {
  return byKey.get(`card:${cast}`) ?? byKey.get(`face:${cast}:neutral`) ?? null;
}
