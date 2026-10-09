// Reads the file attachments a teaching request picked and turns them into
// uploadable documents. The OpenAI-compatible teaching endpoint parses PDFs but
// has no standalone-image upload, so images are decoded to JPEG (by an injected
// decoder — main wires Electron's nativeImage; tests wire a mock) and wrapped
// into a single multi-page PDF, while real PDFs pass through byte-for-byte.
//
// Security contract: attachments are user-picked paths that could have been
// replaced by anything between the picker and this call, so every read is
// gated on (1) membership in the caller-supplied authorized set, (2) a realpath
// that resolves to itself — no symlink anywhere in the chain — checked both
// before and after the read, and (3) a bounded fd read with a regular-file
// fstat, never a whole-file readFile. Errors carry a stable code and the
// attachment index only — never a path, name, or file bytes, so a caller can
// log or surface them without leaking the user's filesystem.

import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import type { TeachingAttachment } from '../shared/teaching';

// ─── caps ────────────────────────────────────────────────────────────────────
export const MAX_ATTACHMENTS = 32;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;   // per attachment, pre-conversion
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;  // summed over what we emit
export const MAX_IMAGE_PIXELS = 24 * 1000 * 1000;
export const MAX_IMAGE_DIMENSION = 10_000;
export const IMAGES_PDF_NAME = 'teaching-images.pdf';
const MAX_PAGE_PT = 2048; // each image page fits inside a 2048pt box, aspect kept

export interface ImagePage { jpeg: Uint8Array; width: number; height: number }
export interface ReadTeachingOptions {
  decodeImage?: (bytes: Uint8Array) => { jpeg: Uint8Array; width: number; height: number } | Promise<{ jpeg: Uint8Array; width: number; height: number }>;
}
export interface TeachingMaterial { name: string; data: Uint8Array }

// ─── errors ──────────────────────────────────────────────────────────────────
// Codes are deliberately generic: no path, no file name, no contents.
function terr(code: string, index?: number): Error {
  return new Error(`teaching-attachment${index === undefined ? '' : ` [${index}]`}: ${code}`);
}

// ─── path / name validation ─────────────────────────────────────────────────
// Conservative Windows-aware identity: absolute + resolved, '/' separators,
// lowercased only where the filesystem is case-insensitive.
function normKey(p: string): string {
  const r = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

const EXT_CLASS: Record<string, string> = {
  '.pdf': 'pdf', '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg',
  '.gif': 'gif', '.bmp': 'bmp', '.webp': 'webp', '.tif': 'tiff', '.tiff': 'tiff',
};
const canonExt = (p: string): string | undefined => EXT_CLASS[extname(p).toLowerCase()];
const INVALID_NAME_CHAR = /[\u0000-\u001f\u007f\\/]/;

/** The name becomes a multipart filename — basename-safe, no separators/controls. */
function safeName(name: string, index: number): string {
  if (typeof name !== 'string' || !name || name.length > 255
    || INVALID_NAME_CHAR.test(name) || name !== basename(name)) {
    throw terr('bad-name', index);
  }
  return name;
}

// ─── bounded, link-free file read ────────────────────────────────────────────
async function readAuthorizedFile(cand: string, index: number): Promise<Uint8Array> {
  const key = normKey(cand);
  let real: string;
  try {
    real = await realpath(cand); // ENOENT / dangling components land here
  } catch {
    throw terr('missing', index);
  }
  if (normKey(real) !== key) throw terr('link', index); // a component (or the file) is a link

  let fh: FileHandle;
  try {
    fh = await open(real, 'r');
  } catch {
    throw terr('missing', index);
  }
  try {
    const fst = await fh.stat();
    if (!fst.isFile()) throw terr('not-a-file', index); // directory or device
    if (fst.size > MAX_FILE_BYTES) throw terr('too-large', index);
    // The path could have been swapped between the realpath and the open: the
    // final component must still not be a link, and it must still be the same
    // inode the fd opened.
    let lst;
    try {
      lst = await lstat(cand);
    } catch {
      throw terr('missing', index);
    }
    if (lst.isSymbolicLink() || lst.dev !== fst.dev || lst.ino !== fst.ino) throw terr('changed', index);

    // Bounded read: at most size+1 bytes, so a file growing mid-read is caught
    // instead of read into unbounded memory.
    const cap = Math.min(fst.size, MAX_FILE_BYTES) + 1;
    const buf = Buffer.alloc(cap);
    let read = 0;
    while (read < cap) {
      const { bytesRead } = await fh.read(buf, read, cap - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (read !== fst.size) throw terr('changed', index);

    // After: the path must still resolve to the same link-free target.
    let real2: string;
    try {
      real2 = await realpath(cand);
    } catch {
      throw terr('changed', index);
    }
    if (normKey(real2) !== key) throw terr('link', index);

    return buf.subarray(0, read);
  } finally {
    await fh.close().catch(() => undefined);
  }
}

// ─── format signatures + dimension prechecks ────────────────────────────────
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const i32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;

const has = (b: Uint8Array, off: number, s: string): boolean => {
  if (b.length < off + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[off + i] !== s.charCodeAt(i)) return false;
  return true;
};

const isPdf = (b: Uint8Array) => has(b, 0, '%PDF-');
const isPng = (b: Uint8Array) => b.length >= 8 && b[0] === 0x89 && has(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isGif = (b: Uint8Array) => has(b, 0, 'GIF8') && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;
const isBmp = (b: Uint8Array) => has(b, 0, 'BM');
const isWebp = (b: Uint8Array) => has(b, 0, 'RIFF') && has(b, 8, 'WEBP');
const isTiff = (b: Uint8Array) => (has(b, 0, 'II') && b[2] === 0x2a && b[3] === 0x00) || (has(b, 0, 'MM') && b[2] === 0x00 && b[3] === 0x2a);

interface Dims { w: number; h: number }

function pngDims(b: Uint8Array): Dims | null {
  return b.length >= 24 ? { w: u32be(b, 16), h: u32be(b, 20) } : null;
}
function gifDims(b: Uint8Array): Dims | null {
  return b.length >= 10 ? { w: u16le(b, 6), h: u16le(b, 8) } : null;
}
function bmpDims(b: Uint8Array): Dims | null {
  if (b.length < 26) return null;
  const w = i32le(b, 18), h = i32le(b, 22);
  return { w: Math.abs(w), h: Math.abs(h) };
}
function jpegDims(b: Uint8Array): Dims | null {
  let i = 2; // SOI already matched by the signature check
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0x00) { i++; continue; } // stuffed data byte
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; } // standalone
    if (m === 0xda) return null; // SOS — SOF must precede entropy data
    const segLen = u16be(b, i + 2);
    if (segLen < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 > b.length) return null;
      return { h: u16be(b, i + 5), w: u16be(b, i + 7) };
    }
    i += 2 + segLen;
  }
  return null;
}
function webpDims(b: Uint8Array): Dims | null {
  // RIFF(0-3) size(4-7) WEBP(8-11) fourcc(12-15) chunksize(16-19) payload(20-)
  if (b.length >= 30 && has(b, 12, 'VP8X')) return { w: le24(b, 24) + 1, h: le24(b, 27) + 1 };
  if (b.length >= 30 && has(b, 12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  }
  if (b.length >= 25 && has(b, 12, 'VP8L') && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null; // unknown RIFF payload — decoder's own dims still get checked
}
const DIMS: Record<string, (b: Uint8Array) => Dims | null> = {
  png: pngDims, jpg: jpegDims, gif: gifDims, bmp: bmpDims, webp: webpDims,
};
const SIGS: Record<string, (b: Uint8Array) => boolean> = {
  png: isPng, jpg: isJpeg, gif: isGif, bmp: isBmp, webp: isWebp,
};

function dimsWithinCaps(d: Dims): boolean {
  return Number.isFinite(d.w) && Number.isFinite(d.h)
    && d.w >= 1 && d.h >= 1
    && d.w <= MAX_IMAGE_DIMENSION && d.h <= MAX_IMAGE_DIMENSION
    && d.w * d.h <= MAX_IMAGE_PIXELS;
}

// ─── minimal image-only PDF writer ───────────────────────────────────────────
// Emits raw DCTDecode streams (JPEG bytes go in untouched), an accurate xref
// table and trailer, and nothing else — no names, metadata, JS, actions or URIs.
export function createImagePdf(images: readonly ImagePage[]): Uint8Array {
  if (!Array.isArray(images) || images.length === 0) throw terr('no-images');
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (s: string | Uint8Array) => {
    const b = typeof s === 'string' ? Buffer.from(s, 'latin1') : s;
    parts.push(b);
    pos += b.length;
  };
  const obj = (id: number) => { offsets[id] = pos; push(`${id} 0 obj\n`); };

  const n = images.length;
  const pageId = (i: number) => 3 + i;
  const contentId = (i: number) => 3 + n + i;
  const imageId = (i: number) => 3 + 2 * n + i;
  const fontId = 3 + 3 * n;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  obj(2);
  push(`<< /Type /Pages /Kids [${images.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`);

  for (let i = 0; i < n; i++) {
    const { jpeg, width, height } = images[i];
    if (!(jpeg instanceof Uint8Array) || jpeg.length < 4 || !isJpeg(jpeg)) throw terr('bad-jpeg');
    if (!dimsWithinCaps({ w: width, h: height })) throw terr('bad-jpeg-dims');
    const scale = Math.min(1, MAX_PAGE_PT / Math.max(width, height));
    const pw = Math.max(1, Math.round(width * scale));
    const ph = Math.max(1, Math.round(height * scale));
    // A truthful caption — just which pick this was, no invented description —
    // so a text extractor never sees an empty page. Standard Helvetica Type1,
    // ASCII-only, drawn over the bottom-left of the image; the MediaBox stays
    // exactly the scaled image bounds so aspect is untouched.
    const caption = `User supplied teaching image ${i + 1}`.replace(/[\\()]/g, '\\$&');
    const content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Im${i} Do\nQ\nBT\n/F1 8 Tf\n0 g\n6 6 Td\n(${caption}) Tj\nET\n`;
    obj(pageId(i));
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /ProcSet [/PDF /Text /ImageC] /Font << /F1 ${fontId} 0 R >> /XObject << /Im${i} ${imageId(i)} 0 R >> >> /Contents ${contentId(i)} 0 R >>\nendobj\n`);
    obj(contentId(i));
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
    obj(imageId(i));
    push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream\nendobj\n');
  }

  obj(fontId);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');

  const xref = pos;
  const total = 3 + 3 * n;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= total; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ─── main entry ──────────────────────────────────────────────────────────────
export async function readTeachingMaterials(
  attachments: readonly TeachingAttachment[],
  authorizedPaths: ReadonlySet<string>,
  options?: Readonly<ReadTeachingOptions>,
): Promise<TeachingMaterial[]> {
  if (!Array.isArray(attachments)) throw terr('bad-attachments');
  if (attachments.length > MAX_ATTACHMENTS) throw terr('too-many');
  const granted = new Set<string>();
  for (const p of authorizedPaths ?? []) if (typeof p === 'string') granted.add(normKey(p));

  // Pass 1 — shape, extension, authorization and deterministic dedup.
  interface Item { index: number; path: string; name: string; cls: string }
  const items: Item[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < attachments.length; index++) {
    const att = attachments[index];
    if (!att || typeof att !== 'object' || typeof att.path !== 'string' || typeof att.name !== 'string') {
      throw terr('bad-shape', index);
    }
    if (!isAbsolute(att.path)) throw terr('not-absolute', index);
    const cls = canonExt(att.path);
    if (!cls) throw terr('bad-ext', index);
    const name = safeName(att.name, index);
    if (canonExt(name) !== cls) throw terr('ext-mismatch', index);
    const key = normKey(att.path);
    if (!granted.has(key)) throw terr('unauthorized', index); // auth before any disk touch
    if (seen.has(key)) continue; // same pick twice — keep the first, preserve order
    seen.add(key);
    items.push({ index, path: att.path, name, cls });
  }

  // Pass 2 — read, sniff, convert. Output size is capped on what we EMIT.
  const out: TeachingMaterial[] = [];
  const images: ImagePage[] = [];
  let imageAnchor = -1;
  let total = 0;
  let imageBytes = 0; // decoded jpegs — pre-bound before the output pdf is allocated
  const decodeImage = options?.decodeImage;

  for (const it of items) {
    const bytes = await readAuthorizedFile(it.path, it.index);
    if (it.cls === 'pdf') {
      if (!isPdf(bytes)) throw terr('bad-magic', it.index);
      total += bytes.length;
      if (total > MAX_TOTAL_BYTES) throw terr('total-too-large');
      out.push({ name: it.name, data: bytes });
      continue;
    }
    // image class — signature must agree with the extension, then dimensions
    // are prechecked from the header where the format allows it.
    if (it.cls === 'tiff') {
      if (isTiff(bytes)) throw terr('unsupported-format', it.index); // clear error beats a misdecode
      throw terr('bad-magic', it.index);
    }
    const sigOk = SIGS[it.cls]?.(bytes) ?? false;
    if (!sigOk) throw terr('bad-magic', it.index);
    const dims = DIMS[it.cls]?.(bytes);
    if (dims === null && it.cls !== 'webp') throw terr('bad-image', it.index);
    if (dims && !dimsWithinCaps(dims)) throw terr('image-too-big', it.index);
    if (!decodeImage) throw terr('decoder-unavailable', it.index);
    let decoded: { jpeg: Uint8Array; width: number; height: number };
    try {
      decoded = await decodeImage(bytes);
    } catch {
      throw terr('decode-failed', it.index); // decoder's own text may embed paths
    }
    if (!decoded || !(decoded.jpeg instanceof Uint8Array) || decoded.jpeg.length < 4 || !isJpeg(decoded.jpeg)) {
      throw terr('bad-decode', it.index);
    }
    if (!dimsWithinCaps({ w: decoded.width, h: decoded.height })) throw terr('image-too-big', it.index);
    imageBytes += decoded.jpeg.length;
    if (imageBytes > MAX_TOTAL_BYTES) throw terr('total-too-large', it.index);
    if (imageAnchor < 0) imageAnchor = out.length;
    images.push({ jpeg: decoded.jpeg, width: decoded.width, height: decoded.height });
  }

  if (images.length > 0) {
    const pdf = createImagePdf(images);
    total += pdf.length;
    if (total > MAX_TOTAL_BYTES) throw terr('total-too-large');
    out.splice(imageAnchor, 0, { name: IMAGES_PDF_NAME, data: pdf });
  }
  return out;
}
