// @convert / @compress — the Librarian's file desk. Pure parsing, shared by the
// composer (to disclose + validate) and the main process (to re-validate).

export interface FileToolAttachment {
  path: string;
  name: string;
}

export type ConvertTarget = 'pdf' | 'ppt' | 'image';
export type FileToolRequest =
  | { kind: 'convert'; target: ConvertTarget; imageFormat: 'png' | 'jpg'; files: FileToolAttachment[]; note: string }
  | { kind: 'compress'; reducePercent: number; files: FileToolAttachment[]; note: string };

export const MAX_FILE_TOOL_FILES = 20;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] as const;
export const MIN_REDUCE_PERCENT = 5;
export const MAX_REDUCE_PERCENT = 95;

const ALIAS = /(^|[\s([{"'“‘«])@(convert|compress)(?=$|[\s)\]}"'”’»]|[.,:!?]+(?=$|[\s)\]}"'”’»]))/gi;
const CONTROL = /[\u0000-\u001f\u007f]/;

export const extOf = (name: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
};
export type FileClass = 'pdf' | 'ppt' | 'image' | 'other';
export function classify(name: string): FileClass {
  const e = extOf(name);
  if (e === 'pdf') return 'pdf';
  if (e === 'ppt' || e === 'pptx') return 'ppt';
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(e)) return 'image';
  return 'other';
}

/** Which tool the draft asks for, ignoring everything else (never throws). */
export function fileToolAlias(text: string): 'convert' | 'compress' | null {
  if (typeof text !== 'string') return null;
  ALIAS.lastIndex = 0;
  let found: 'convert' | 'compress' | null = null;
  for (const m of text.matchAll(ALIAS)) {
    const which = m[2].toLowerCase() as 'convert' | 'compress';
    if (!found) found = which;
  }
  return found;
}

function detectTarget(note: string): ConvertTarget | null {
  const m = /\b(?:to|into|as)\s+(pdf|pptx?|power\s?point|slides?|deck|images?|pictures?|pngs?|jpe?gs?|photos?)\b/i.exec(note);
  if (!m) return null;
  const t = m[1].toLowerCase().replace(/\s+/g, '');
  if (t === 'pdf') return 'pdf';
  if (/^(pptx?|powerpoint|slides?|deck)$/.test(t)) return 'ppt';
  return 'image';
}

export function parseFileToolRequest(
  text: string,
  attachments: readonly FileToolAttachment[]
): FileToolRequest | null {
  if (typeof text !== 'string') throw new TypeError('Message must be text.');
  const which = fileToolAlias(text);
  if (!which) return null;
  const note = text.replace(ALIAS, (_a, prefix: string) => prefix).replace(/\s+/g, ' ').trim();

  if (!Array.isArray(attachments) || attachments.length === 0) {
    throw new Error(which === 'convert'
      ? 'Attach a PDF, PowerPoint or image to convert, e.g. "@convert to pdf".'
      : 'Attach the image(s) to compress, e.g. "@compress 50%".');
  }
  if (attachments.length > MAX_FILE_TOOL_FILES) throw new RangeError(`Up to ${MAX_FILE_TOOL_FILES} files at a time.`);
  const files: FileToolAttachment[] = [];
  for (const a of attachments) {
    if (!a || typeof a.path !== 'string' || typeof a.name !== 'string' || !a.path.trim() || !a.name.trim()
      || CONTROL.test(a.path) || CONTROL.test(a.name) || /[\\/]/.test(a.name)) {
      throw new TypeError('Each file needs a valid path and name.');
    }
    files.push({ path: a.path, name: a.name });
  }

  if (which === 'compress') {
    const bad = files.find((f) => classify(f.name) !== 'image');
    if (bad) throw new Error(`@compress works on images (PNG, JPG, WEBP, GIF, BMP) — "${bad.name}" is not one.`);
    const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(note) ?? /\b(?:by|reduce|smaller|less)\s+(\d{1,3})\b/i.exec(note);
    if (!m) throw new Error('Say how much smaller you want it, e.g. "@compress 50%" (5–95%).');
    const pct = Math.round(Number(m[1]));
    if (!(pct >= MIN_REDUCE_PERCENT && pct <= MAX_REDUCE_PERCENT)) {
      throw new RangeError(`Compression must be between ${MIN_REDUCE_PERCENT}% and ${MAX_REDUCE_PERCENT}%.`);
    }
    return { kind: 'compress', reducePercent: pct, files, note };
  }

  const classes = new Set(files.map((f) => classify(f.name)));
  if (classes.has('other')) {
    const bad = files.find((f) => classify(f.name) === 'other')!;
    throw new Error(`@convert handles PDF, PPT/PPTX and images — "${bad.name}" is not supported.`);
  }
  if (classes.size > 1) {
    throw new Error('Convert one kind of file at a time (all PDFs, all slides, or all images).');
  }
  const from = [...classes][0] as 'pdf' | 'ppt' | 'image';
  // Slides and images only have one destination; a PDF could go two ways.
  const target: ConvertTarget | null = detectTarget(note) ?? (from === 'pdf' ? null : 'pdf');
  if (!target) throw new Error('Say what to turn the PDF into: "@convert to ppt" or "@convert to image".');
  const supported = from === 'pdf' ? target === 'ppt' || target === 'image' : target === 'pdf';
  if (!supported) {
    throw new Error(`Can't convert ${from.toUpperCase()} to ${target.toUpperCase()}. Supported: PDF → PPT, PPT → PDF, image → PDF, PDF → image.`);
  }
  const imageFormat: 'png' | 'jpg' = /\bjpe?gs?\b/i.test(note) ? 'jpg' : 'png';
  return { kind: 'convert', target, imageFormat, files, note };
}

/** What the tools hand back, per file. */
export interface FileToolOutput {
  source: string;
  output: string;
  bytesIn: number;
  bytesOut: number;
  /** Extra outputs for multi-page results (PDF → images). */
  pages?: number;
  note?: string;
}
export interface FileToolResult {
  ok: boolean;
  error?: string;
  folder?: string;
  outputs: FileToolOutput[];
}
