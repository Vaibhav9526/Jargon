/**
 * The Librarian's shelf — notes, books and slides the whole class can draw on.
 *
 * Files are read ONCE into plain text, split into overlapping chunks and stored
 * as JSON. A question is answered by ranking chunks (BM25) and handing the best
 * few to the character who is answering; nothing leaves the device here.
 *
 * No electron imports: the data directory is injected.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface LibraryDoc { id: string; name: string; addedAt: number; chars: number; chunks: number }
interface StoredDoc extends LibraryDoc { parts: string[] }
export interface Hit { source: string; text: string; score: number }

export const SUPPORTED = ['.pdf', '.pptx', '.docx', '.txt', '.md', '.markdown', '.csv', '.epub', '.html', '.htm'] as const;
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_TEXT_CHARS = 3_000_000;
const CHUNK = 1000;
const OVERLAP = 150;

// ─── text extraction ────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeXml(html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export async function extractText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (!(SUPPORTED as readonly string[]).includes(ext)) throw new Error(`Unsupported file type: ${ext || '(none)'}`);
  if (statSync(path).size > MAX_FILE_BYTES) throw new Error('File is larger than 60 MB.');
  const buf = readFileSync(path);
  let text = '';
  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try { text = (await parser.getText()).text.replace(/\n?-- \d+ of \d+ --\n?/g, '\n'); } finally { await parser.destroy().catch(() => undefined); }
  } else if (ext === '.pptx' || ext === '.docx' || ext === '.epub') {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    if (ext === '.pptx') {
      const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(naturalCompare);
      const out: string[] = [];
      for (const [i, n] of slides.entries()) {
        const xml = await zip.files[n].async('string');
        const runs = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
        if (runs.length) out.push(`Slide ${i + 1}: ${runs.join(' ')}`);
      }
      text = out.join('\n\n');
    } else if (ext === '.docx') {
      const xml = await zip.files['word/document.xml']?.async('string');
      if (!xml) throw new Error('Not a valid .docx file.');
      text = xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ')
        .split('\n').map((p) => [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXml(m[1])).join('')).join('\n');
    } else {
      const pages = Object.keys(zip.files).filter((n) => /\.(xhtml|html|htm)$/i.test(n)).sort(naturalCompare);
      const out: string[] = [];
      for (const n of pages) out.push(stripTags(await zip.files[n].async('string')));
      text = out.join('\n\n');
    }
  } else if (ext === '.html' || ext === '.htm') {
    text = stripTags(buf.toString('utf8'));
  } else {
    text = buf.toString('utf8');
  }
  text = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (!text) throw new Error('No readable text found (a scanned PDF needs OCR first).');
  return text.slice(0, MAX_TEXT_CHARS);
}

// ─── chunking + ranking ─────────────────────────────────────────────────────

export function chunkText(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + CHUNK);
    if (end < text.length) {
      const window = text.slice(i + CHUNK * 0.6, end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (cut > 0) end = i + Math.floor(CHUNK * 0.6) + cut + 1;
    }
    const piece = text.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= text.length) break;
    i = Math.max(end - OVERLAP, i + 1);
  }
  return out;
}

const STOP = new Set(('the a an and or of to in on at is are was were be been it its this that these those for with as by from '
  + 'what which who whom how why when where do does did can could would should i me my you your we our they them their '
  + 'about tell explain please give show notes note memory').split(' '));

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((t) => !STOP.has(t));
}

export function rank(chunks: Array<{ source: string; text: string }>, question: string, k = 5): Hit[] {
  const q = [...new Set(tokenize(question))];
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map((c) => tokenize(c.text));
  const N = docs.length;
  const avg = docs.reduce((n, d) => n + d.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, docs.reduce((n, d) => n + (d.includes(t) ? 1 : 0), 0));
  const k1 = 1.5, b = 0.75;
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return { source: chunks[i].source, text: chunks[i].text, score };
  }).filter((h) => h.score > 0).sort((a, b2) => b2.score - a.score);
  return scored.slice(0, k);
}

// ─── the shelf ──────────────────────────────────────────────────────────────

const ID = /^[a-f0-9]{12}$/;

export class Library {
  private cache: StoredDoc[] | null = null;
  constructor(private readonly dir: string) {}

  private load(): StoredDoc[] {
    if (this.cache) return this.cache;
    const docs: StoredDoc[] = [];
    if (existsSync(this.dir)) {
      for (const f of readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        try { docs.push(JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as StoredDoc); } catch { /* skip a corrupt entry */ }
      }
    }
    this.cache = docs.sort((a, b) => b.addedAt - a.addedAt);
    return this.cache;
  }

  list(): LibraryDoc[] {
    return this.load().map(({ id, name, addedAt, chars, chunks }) => ({ id, name, addedAt, chars, chunks }));
  }

  async add(path: string): Promise<{ ok: true; doc: LibraryDoc } | { ok: false; error: string }> {
    try {
      const text = await extractText(path);
      const parts = chunkText(text);
      const doc: StoredDoc = {
        id: randomBytes(6).toString('hex'), name: basename(path).slice(0, 120), addedAt: Date.now(),
        chars: text.length, chunks: parts.length, parts,
      };
      mkdirSync(this.dir, { recursive: true });
      const f = join(this.dir, `${doc.id}.json`);
      const tmp = `${f}.tmp`;
      writeFileSync(tmp, JSON.stringify(doc), 'utf8');
      renameSync(tmp, f);
      this.cache = null;
      return { ok: true, doc: { id: doc.id, name: doc.name, addedAt: doc.addedAt, chars: doc.chars, chunks: doc.chunks } };
    } catch (e) {
      return { ok: false, error: `${basename(path)}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  remove(id: string): boolean {
    if (!ID.test(id)) return false;
    rmSync(join(this.dir, `${id}.json`), { force: true });
    this.cache = null;
    return true;
  }

  search(question: string, k = 5): Hit[] {
    const chunks = this.load().flatMap((d) => d.parts.map((text) => ({ source: d.name, text })));
    return rank(chunks, question, k);
  }
}
