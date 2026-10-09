// The Librarian's file desk: @convert (PDF ↔ PPT, image → PDF, PDF → image) and
// @compress (shrink an image by N%). Everything runs locally — nothing is
// uploaded. PDF rendering uses pdf.js + @napi-rs/canvas (already shipped for
// pdf-parse); PPT → PDF drives PowerPoint (Windows) or LibreOffice if present.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { extname, join, parse as parsePath } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import {
  classify, type ConvertTarget, type FileToolAttachment, type FileToolOutput, type FileToolResult
} from '../shared/fileTools';

const MAX_INPUT_BYTES = 200 * 1024 * 1024;
const MAX_PDF_PAGES = 200;
const MAX_SIDE_PX = 3000;

type Canvas = import('@napi-rs/canvas').Canvas;
const loadCanvas = async () => await import('@napi-rs/canvas');

// ─── files ──────────────────────────────────────────────────────────────────

function checkInput(path: string, name: string): number {
  let st;
  try { st = statSync(path); } catch { throw new Error(`Can't read "${name}" — the file moved or was deleted.`); }
  if (!st.isFile()) throw new Error(`"${name}" is not a file.`);
  if (st.size > MAX_INPUT_BYTES) throw new Error(`"${name}" is over ${MAX_INPUT_BYTES / 1024 / 1024} MB.`);
  if (st.size === 0) throw new Error(`"${name}" is empty.`);
  return st.size;
}

function uniquePath(dir: string, base: string, ext: string): string {
  let p = join(dir, `${base}${ext}`);
  for (let i = 2; existsSync(p); i++) p = join(dir, `${base} (${i})${ext}`);
  return p;
}

const stem = (name: string) => parsePath(name).name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'file';

// ─── image → PDF ────────────────────────────────────────────────────────────

interface JpegPage { jpeg: Uint8Array; width: number; height: number }

/** Minimal PDF with one full-page JPEG per page (DCTDecode, bytes untouched). */
export function buildImagePdf(pages: readonly JpegPage[]): Buffer {
  if (!pages.length) throw new Error('No pages to write.');
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (s: string | Uint8Array) => {
    const b = typeof s === 'string' ? Buffer.from(s, 'latin1') : Buffer.from(s);
    parts.push(b);
    pos += b.length;
  };
  const obj = (id: number) => { offsets[id] = pos; push(`${id} 0 obj\n`); };
  const n = pages.length;
  const pageId = (i: number) => 3 + i;
  const contentId = (i: number) => 3 + n + i;
  const imageId = (i: number) => 3 + 2 * n + i;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  obj(2); push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`);
  pages.forEach(({ jpeg, width, height }, i) => {
    // 96 dpi pixels → points, capped so a 12k-px photo is not a 9000 pt page.
    const k = Math.min(0.75, 1440 / Math.max(width, height));
    const pw = Math.max(1, Math.round(width * k));
    const ph = Math.max(1, Math.round(height * k));
    const content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Im${i} Do\nQ\n`;
    obj(pageId(i));
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im${i} ${imageId(i)} 0 R >> >> /Contents ${contentId(i)} 0 R >>\nendobj\n`);
    obj(contentId(i));
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
    obj(imageId(i));
    push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream\nendobj\n');
  });
  const total = 2 + 3 * n;
  const xref = pos;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= total; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

async function imagesToPdf(files: readonly FileToolAttachment[], outDir: string): Promise<FileToolOutput[]> {
  const { createCanvas, loadImage } = await loadCanvas();
  const pages: JpegPage[] = [];
  let bytesIn = 0;
  for (const f of files) {
    bytesIn += checkInput(f.path, f.name);
    let img;
    try { img = await loadImage(readFileSync(f.path)); } catch { throw new Error(`Can't open "${f.name}" as an image.`); }
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; // JPEG has no alpha — flatten transparency onto white
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    pages.push({ jpeg: c.toBuffer('image/jpeg', 92), width: c.width, height: c.height });
  }
  const out = uniquePath(outDir, files.length === 1 ? stem(files[0].name) : `${stem(files[0].name)} +${files.length - 1} more`, '.pdf');
  const pdf = buildImagePdf(pages);
  writeFileSync(out, pdf);
  return [{ source: files.map((f) => f.name).join(', '), output: out, bytesIn, bytesOut: pdf.length, pages: pages.length }];
}

// ─── PDF → image(s) ─────────────────────────────────────────────────────────

async function renderPdfPages(path: string, name: string, scale: number): Promise<Canvas[]> {
  const { createCanvas } = await loadCanvas();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, isEvalSupported: false }).promise;
  } catch { throw new Error(`Can't read "${name}" as a PDF (damaged or password-protected).`); }
  if (doc.numPages > MAX_PDF_PAGES) throw new Error(`"${name}" has ${doc.numPages} pages — the limit is ${MAX_PDF_PAGES}.`);
  const out: Canvas[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const s = Math.min(scale, MAX_SIDE_PX / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale: s });
      const c = createCanvas(Math.max(1, Math.ceil(vp.width)), Math.max(1, Math.ceil(vp.height)));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      // pdf.js's types want a DOM context; the napi-rs one is call-compatible.
      await page.render({ canvasContext: ctx as never, canvas: c as never, viewport: vp }).promise;
      out.push(c);
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

async function pdfToImages(files: readonly FileToolAttachment[], outDir: string, fmt: 'png' | 'jpg'): Promise<FileToolOutput[]> {
  const results: FileToolOutput[] = [];
  for (const f of files) {
    const bytesIn = checkInput(f.path, f.name);
    const pages = await renderPdfPages(f.path, f.name, 2);
    const enc = (c: Canvas) => (fmt === 'png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', 90));
    let output: string;
    let bytesOut = 0;
    if (pages.length === 1) {
      output = uniquePath(outDir, stem(f.name), `.${fmt}`);
      const buf = enc(pages[0]);
      writeFileSync(output, buf);
      bytesOut = buf.length;
    } else {
      const dirBase = uniquePath(outDir, `${stem(f.name)} pages`, '');
      mkdirSync(dirBase, { recursive: true });
      output = dirBase;
      const w = String(pages.length).length;
      pages.forEach((c, i) => {
        const buf = enc(c);
        bytesOut += buf.length;
        writeFileSync(join(dirBase, `${stem(f.name)}-${String(i + 1).padStart(Math.max(2, w), '0')}.${fmt}`), buf);
      });
    }
    results.push({ source: f.name, output, bytesIn, bytesOut, pages: pages.length });
  }
  return results;
}

// ─── PDF → PPTX ─────────────────────────────────────────────────────────────

const EMU_LONG_SIDE = 12192000; // 13.33 in — the 16:9 default width

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const THEME = `${XML}<a:theme xmlns:a="${NS_A}" name="Jargon"><a:themeElements>
<a:clrScheme name="Jargon"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="365846"/></a:accent1><a:accent2><a:srgbClr val="8A6D9B"/></a:accent2><a:accent3><a:srgbClr val="BB8462"/></a:accent3><a:accent4><a:srgbClr val="4B7BEC"/></a:accent4><a:accent5><a:srgbClr val="E67E22"/></a:accent5><a:accent6><a:srgbClr val="2ECC71"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Jargon"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Jargon"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

export interface SlideImage { jpeg: Uint8Array; width: number; height: number }

/** One picture per slide, fitted and centred; the deck takes page 1's aspect. */
export async function buildImagePptx(slides: readonly SlideImage[]): Promise<Buffer> {
  if (!slides.length) throw new Error('No slides to write.');
  const first = slides[0];
  const k = EMU_LONG_SIDE / Math.max(first.width, first.height);
  const cx = Math.round(first.width * k);
  const cy = Math.round(first.height * k);
  const zip = new JSZip();
  const n = slides.length;
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml', `${XML}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 2}" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/theme/theme1.xml', THEME);
  zip.file('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  slides.forEach((s, i) => {
    const fit = Math.min(cx / s.width, cy / s.height);
    const w = Math.round(s.width * fit);
    const h = Math.round(s.height * fit);
    const x = Math.round((cx - w) / 2);
    const y = Math.round((cy - h) / 2);
    zip.file(`ppt/slides/slide${i + 1}.xml`, `${XML}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${i + 1}" descr="Page ${i + 1} of the converted PDF"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/image" Target="../media/image${i + 1}.jpeg"/></Relationships>`);
    zip.file(`ppt/media/image${i + 1}.jpeg`, s.jpeg);
  });
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function pdfToPptx(files: readonly FileToolAttachment[], outDir: string): Promise<FileToolOutput[]> {
  const results: FileToolOutput[] = [];
  for (const f of files) {
    const bytesIn = checkInput(f.path, f.name);
    const pages = await renderPdfPages(f.path, f.name, 2);
    const deck = await buildImagePptx(pages.map((c) => ({ jpeg: c.toBuffer('image/jpeg', 90), width: c.width, height: c.height })));
    const output = uniquePath(outDir, stem(f.name), '.pptx');
    writeFileSync(output, deck);
    results.push({
      source: f.name, output, bytesIn, bytesOut: deck.length, pages: pages.length,
      note: 'Each PDF page is a picture on its own slide (looks identical; text is not editable).'
    });
  }
  return results;
}

// ─── PPT/PPTX → PDF ─────────────────────────────────────────────────────────

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, out: `${stdout ?? ''}${stderr ?? ''}`.trim() });
    });
  });
}

const POWERPOINT_PS = `
$ErrorActionPreference = 'Stop'
$app = $null; $pres = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  # Open(file, ReadOnly, Untitled, WithWindow) — no window, never touches the source.
  $pres = $app.Presentations.Open($env:JARGON_SRC, -1, 0, 0)
  $pres.SaveAs($env:JARGON_DST, 32)
} finally {
  if ($pres) { $pres.Close() }
  if ($app) { $app.Quit() }
}
`;

function sofficeCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'];
  }
  if (process.platform === 'darwin') return ['/Applications/LibreOffice.app/Contents/MacOS/soffice', 'soffice'];
  return ['soffice', 'libreoffice'];
}

async function pptToPdf(files: readonly FileToolAttachment[], outDir: string): Promise<FileToolOutput[]> {
  const results: FileToolOutput[] = [];
  for (const f of files) {
    const bytesIn = checkInput(f.path, f.name);
    const output = uniquePath(outDir, stem(f.name), '.pdf');
    let done = false;
    let lastErr = '';
    if (process.platform === 'win32') {
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERPOINT_PS],
        { ...process.env, JARGON_SRC: f.path, JARGON_DST: output }, 180_000);
      done = r.code === 0 && existsSync(output);
      if (!done) lastErr = r.out;
    }
    if (!done) {
      const work = join(tmpdir(), `jargon-conv-${process.pid}-${Date.now()}`);
      mkdirSync(work, { recursive: true });
      try {
        for (const exe of sofficeCandidates()) {
          if (exe.includes('/') || exe.includes('\\')) { if (!existsSync(exe)) continue; }
          const r = await run(exe, ['--headless', '--convert-to', 'pdf', '--outdir', work, f.path], process.env, 180_000);
          const made = join(work, `${parsePath(f.path).name}.pdf`);
          if (r.code === 0 && existsSync(made)) {
            writeFileSync(output, readFileSync(made));
            done = true;
            break;
          }
          lastErr = r.out || lastErr;
        }
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
    if (!done) {
      throw new Error(`Couldn't convert "${f.name}" to PDF. It needs Microsoft PowerPoint (Windows) or LibreOffice installed.${lastErr ? ` (${lastErr.split('\n')[0].slice(0, 160)})` : ''}`);
    }
    results.push({ source: f.name, output, bytesIn, bytesOut: statSync(output).size });
  }
  return results;
}

// ─── compress ───────────────────────────────────────────────────────────────

async function compressOne(f: FileToolAttachment, reducePercent: number, outDir: string): Promise<FileToolOutput> {
  const { createCanvas, loadImage } = await loadCanvas();
  const bytesIn = checkInput(f.path, f.name);
  const target = Math.max(1, Math.floor(bytesIn * (1 - reducePercent / 100)));
  let img;
  try { img = await loadImage(readFileSync(f.path)); } catch { throw new Error(`Can't open "${f.name}" as an image.`); }

  const ext = extname(f.name).toLowerCase().replace('.', '');
  // PNG stays PNG (lossless: only shrinking the pixels helps); WebP stays WebP;
  // everything else becomes JPEG, the format that actually compresses photos.
  const fmt: 'png' | 'webp' | 'jpeg' = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg';
  const mime = `image/${fmt}` as const;

  const draw = (scale: number): Canvas => {
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    if (fmt === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  };
  const encode = (c: Canvas, q: number): Buffer => (fmt === 'png' ? c.toBuffer('image/png') : c.toBuffer(mime as 'image/jpeg' | 'image/webp', q));

  type Try = { buf: Buffer; scale: number; q: number };
  // best = biggest result that still fits the target; smallest = fallback.
  const found: { best: Try | null; smallest: Try | null } = { best: null, smallest: null };
  const consider = (buf: Buffer, scale: number, q: number): boolean => {
    if (!found.smallest || buf.length < found.smallest.buf.length) found.smallest = { buf, scale, q };
    if (buf.length <= target && (!found.best || buf.length > found.best.buf.length)) found.best = { buf, scale, q };
    return buf.length <= target;
  };

  if (fmt === 'png') {
    // Largest scale whose PNG fits the target (binary search over pixel scale).
    let lo = 0.05, hi = 1;
    if (!consider(encode(draw(1), 0), 1, 0)) {
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (consider(encode(draw(mid), 0), mid, 0)) lo = mid; else hi = mid;
      }
    }
  } else {
    // Quality first (keeps full resolution); only shrink pixels if quality alone can't.
    for (const scale of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]) {
      const c = draw(scale);
      let lo = 8, hi = 95;
      if (!consider(encode(c, lo), scale, lo)) continue; // even min quality is too big at this size
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (consider(encode(c, mid), scale, mid)) lo = mid; else hi = mid;
      }
      break;
    }
  }

  const pick = (found.best ?? found.smallest) as Try;
  const outExt = fmt === 'jpeg' ? '.jpg' : `.${fmt}`;
  const output = uniquePath(outDir, `${stem(f.name)}-compressed`, outExt);
  writeFileSync(output, pick.buf);
  const notes: string[] = [];
  if (!found.best) notes.push(`Couldn't reach ${reducePercent}% smaller — this is as small as it gets.`);
  if (pick.scale < 1) notes.push(`Resized to ${Math.round(pick.scale * 100)}% of the original dimensions.`);
  if (fmt === 'jpeg' && ext !== 'jpg' && ext !== 'jpeg') notes.push(`Saved as JPG.`);
  return { source: f.name, output, bytesIn, bytesOut: pick.buf.length, note: notes.join(' ') || undefined };
}

// ─── entry points ───────────────────────────────────────────────────────────

export type FileToolJob =
  | { kind: 'convert'; target: ConvertTarget; imageFormat: 'png' | 'jpg'; files: FileToolAttachment[] }
  | { kind: 'compress'; reducePercent: number; files: FileToolAttachment[] };

export async function runFileTool(job: FileToolJob, outDir: string): Promise<FileToolResult> {
  try {
    mkdirSync(outDir, { recursive: true });
    let outputs: FileToolOutput[];
    if (job.kind === 'compress') {
      outputs = [];
      for (const f of job.files) outputs.push(await compressOne(f, job.reducePercent, outDir));
    } else {
      const from = classify(job.files[0].name);
      if (from === 'image' && job.target === 'pdf') outputs = await imagesToPdf(job.files, outDir);
      else if (from === 'ppt' && job.target === 'pdf') outputs = await pptToPdf(job.files, outDir);
      else if (from === 'pdf' && job.target === 'ppt') outputs = await pdfToPptx(job.files, outDir);
      else if (from === 'pdf' && job.target === 'image') outputs = await pdfToImages(job.files, outDir, job.imageFormat);
      else throw new Error('That conversion is not supported.');
    }
    return { ok: true, folder: outDir, outputs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), outputs: [] };
  }
}
