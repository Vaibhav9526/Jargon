'use strict';
/**
 * Jargon brand assets — the orange speech-bubble mark, every raster and
 * composite derived from it.
 *
 * THE SOURCE OF TRUTH IS references/. references/jargon.svg (hand-drawn vector)
 * and references/jargon.png (1200x1200 raster of the same mark) are READ-ONLY
 * inputs owned by the repo owner. Nothing here edits them; everything below is
 * generated from them, so re-running this script can never drift from the mark.
 *
 * The mark is a hand-drawn orange speech bubble with two dark eyes, transparent
 * outside its own silhouette — so every framing here is FULL BLEED. There is no
 * tile, no border and no background to reproduce: the raster pipeline is a plain
 * decode -> box-filter downscale -> re-encode of the source PNG, which is what
 * keeps a 32px favicon a faithful 32px Jargon and not a resampled
 * already-downsampled one.
 *
 * Writes, from references/:
 *   docs/logo.svg                  the mark, verbatim (site favicon)
 *   docs/logo-mark.svg             the mark, verbatim (compact mark asset)
 *   docs/logo.png               512 — site header, README, in-app toolbar
 *   docs/logo-light.png         512 — site header on light theme (identical
 *                                    mark; the old pair differed only by tile
 *                                    border colour and this mark has no border)
 *   docs/favicon-32.png          32 — native-size favicon
 *   docs/favicon-48.png          48
 *   docs/favicon-192.png        192 — PWA / touch
 *   docs/favicon.ico                — Windows, 16..256, PNG entries
 *   docs/apple-touch-icon.png   180
 *   build/icon.svg                  electron-builder design source
 *   build/icon.png              1024  — electron-builder base
 *   build/icon.ico                    — Windows installer, 16..256
 *   build/icon.icns                  — macOS installer, PNG chunks 128..1024
 *   docs/banner.svg            1280x400  — marketing banner (wordmark)
 *   docs/banner.png            2056x798  — rasterised banner, same layout
 *   docs/media/og.png          2400x1260 — Open Graph card, same layout
 *   docs/media/hero-poster.svg 1280x720  — office-floor poster
 *
 * The two marketing RASTERS (banner.png, og.png) are the only outputs that need
 * a text rasteriser, and the only place ffmpeg is used: it is invoked for
 * drawtext with an Impact wordmark. Everything else — all icons, favicons, the
 * ICO and the ICNS — is pure Node with no native deps and no external binaries,
 * so the icon set regenerates anywhere `node` runs. If ffmpeg is absent the
 * script still succeeds and says which two files it skipped.
 *
 *   node tools/make-logo.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

// Resolve from THIS file, not a hardcoded checkout: a generator that reads a
// path baked at authoring time will happily write assets from another clone.
const ROOT = path.resolve(__dirname, '..');
const D = (p) => path.join(ROOT, p);
const wrote = [];
const skipped = [];

function write(rel, buf) {
  fs.mkdirSync(path.dirname(D(rel)), { recursive: true });
  fs.writeFileSync(D(rel), buf);
  wrote.push(`${rel.padEnd(28)} ${(buf.length / 1024).toFixed(1)} KB`);
}

// ── source ─────────────────────────────────────────────────────────────────
const SRC_PNG = D('references/jargon.png');
const SRC_SVG = D('references/jargon.svg');
for (const p of [SRC_PNG, SRC_SVG]) {
  if (!fs.existsSync(p)) {
    console.error(`missing source asset: ${path.relative(ROOT, p)}`);
    process.exit(1);
  }
}

// ── palette (sampled from references/jargon.png) ───────────────────────────
const ORANGE = '#E76E00';   // the bubble body
const INK    = '#1C1A16';   // the eyes / deepest value in the mark
const CREAM  = '#F4F1EA';   // wordmark on dark grounds
const GROUND = '#1C1207';   // marketing background: near-black, warm-shifted
                                      //   to sit under the orange without
                                      //   the maroon cast the old mark had
const PLATE  = '#2E1D08';   // the wordmark plate
const RULE   = '#E76E00';

// ── PNG decode ─────────────────────────────────────────────────────────────
/**
 * Decode a non-interlaced 8-bit RGB/RGBA PNG to raw RGBA.
 *
 * Deliberately narrow: the source is exactly that, and a general-purpose
 * decoder would be dead weight. Anything else throws rather than guessing.
 */
function decodePng(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('not a PNG');

  const idat = [];
  let w = 0, h = 0, depth = 0, colorType = 0, interlace = 0;
  let i = 8;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    i += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (colorType !== 6 && colorType !== 2) throw new Error(`unsupported colour type ${colorType}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');

  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);

  // Undo the per-scanline filter. Each row prefixes a type byte; Paeth/Sub/
  // Average need the already-reconstructed pixel to their left and above.
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      switch (ft) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad filter type ${ft} on row ${y}`);
      }
      row[x] = v & 0xff;
    }
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let p = 0, n = w * h; p < n; p++) {
    rgba[p * 4] = out[p * bpp];
    rgba[p * 4 + 1] = out[p * bpp + 1];
    rgba[p * 4 + 2] = out[p * bpp + 2];
    rgba[p * 4 + 3] = bpp === 4 ? out[p * bpp + 3] : 255;
  }
  return { w, h, rgba };
}

// ── PNG encode ─────────────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(N, rgba) {
  const stride = N * 4 + 1;
  const raw = Buffer.alloc(N * stride);
  for (let y = 0; y < N; y++) {
    raw[y * stride] = 0;                                       // filter: none
    rgba.copy(raw, y * stride + 1, y * N * 4, (y + 1) * N * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; ihdr[9] = 6;                                    // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── downscale ──────────────────────────────────────────────────────────────
/**
 * Box-filter downscale in premultiplied alpha.
 *
 * Premultiplying first is the whole trick: the bubble's edge is a hard
 * step from full orange to full transparency, and averaging those in
 * straight-alpha space pulls the fringe toward black. Averaging the
 * premultiplied channels and re-applying alpha keeps the edge orange.
 */
function resize(src, n) {
  if (n === src.w) return Buffer.from(src.rgba);
  const out = Buffer.alloc(n * n * 4);
  const sx = src.w / n, sy = src.h / n;

  for (let y = 0; y < n; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(src.h, Math.ceil((y + 1) * sy));
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(src.w, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * src.w + xx) * 4;
          const al = src.rgba[p + 3];
          r += src.rgba[p] * al; g += src.rgba[p + 1] * al; b += src.rgba[p + 2] * al;
          a += al; cnt++;
        }
      }
      const i = (y * n + x) * 4;
      if (a === 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
      out[i] = Math.round(r / a);
      out[i + 1] = Math.round(g / a);
      out[i + 2] = Math.round(b / a);
      out[i + 3] = Math.round(a / cnt);
    }
  }
  return out;
}

// ── ICO ────────────────────────────────────────────────────────────────────
/** ICO container of PNG entries (Vista+). 256px is encoded as width byte 0. */
function buildIco(pngs) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = [], bodies = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); bodies.push(data);
    offset += data.length;
  }
  return Buffer.concat([dir, ...entries, ...bodies]);
}

// ── ICNS ───────────────────────────────────────────────────────────────────
/**
 * Hand-rolled ICNS — iconutil does not exist off macOS, so the container is
 * built directly. Layout: magic 'icns', then the total file length, then
 * chunks of { 4-byte type, 4-byte BIG-ENDIAN length INCLUDING this 8-byte
 * header, payload }. PNG payloads are legal in every chunk type used here.
 */
function buildIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

// ── SVG passthrough ────────────────────────────────────────────────────────
/**
 * The mark's own SVG, with its percentage width/height resolved to concrete
 * pixels so it behaves as a fixed-size asset. The geometry, the embedded
 * raster and the hand-drawn paths are left exactly as authored.
 */
function sized(svg, size) {
  let s = svg.replace(/<svg\b([^>]*?)width="100%"([^>]*?)height="100%"/,
    `<svg$1width="${size}"$2height="${size}"`);
  if (/width="100%"/.test(s)) {
    s = s.replace(/width="100%"/, `width="${size}"`).replace(/height="100%"/, `height="${size}"`);
  }
  return s.replace('<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<?xml version="1.0" encoding="UTF-8"?>');
}

const MARK_SVG = fs.readFileSync(SRC_SVG, 'utf8');
const MARK = decodePng(fs.readFileSync(SRC_PNG));

// ── ffmpeg (marketing rasters only) ────────────────────────────────────────
const FFMPEG = process.env.FFMPEG_PATH
  || 'C:\\Users\\VAIBHAV\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0-full_build\\bin\\ffmpeg.exe';

const FONT_BOLD = 'C\\:/Windows/Fonts/impact.ttf';
const FONT_BODY = 'C\\:/Windows/Fonts/segoeui.ttf';

function haveFfmpeg() {
  if (!fs.existsSync(FFMPEG)) return false;
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'color=c=black:s=8x8', '-frames:v', '1', '-f', 'null', '-'],
    { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
}



// ── run: the mark ──────────────────────────────────────────────────────────
const svg256 = sized(MARK_SVG, 256);
const svg1024 = sized(MARK_SVG, 1024);

// The mark IS the logo — the old tile-and-border framing is gone with the old
// artwork, and this mark is transparent outside its silhouette, so full bleed
// is the only framing that keeps the bubble filling the icon square.
write('docs/logo.svg', Buffer.from(svg1024));
write('docs/logo-mark.svg', Buffer.from(svg256));
write('build/icon.svg', Buffer.from(svg1024));

// Favicons and app rasters straight off the 1200px source. Each is a single
// box-filter step from full resolution, never a resize of a resize.
const at = (n) => encodePng(n, resize(MARK, n));

write('docs/logo.png', at(512));
// The old light/dark pair differed only by the tile's border colour. This mark
// has no border, so the two framings are the same image.
write('docs/logo-light.png', at(512));
write('docs/favicon-32.png', at(32));
write('docs/favicon-48.png', at(48));
write('docs/favicon-192.png', at(192));
write('docs/apple-touch-icon.png', at(180));
write('build/icon.png', at(1024));

const icoSizes = [16, 32, 48, 64, 128, 256];
const ico = buildIco(icoSizes.map((size) => ({ size, data: at(size) })));
write('build/icon.ico', ico);
write('docs/favicon.ico', ico);

// ic07/08/09/10 are the modern PNG-payload chunk types for 128/256/512/1024.
write('build/icon.icns', buildIcns([
  { type: 'ic07', data: at(128) },
  { type: 'ic08', data: at(256) },
  { type: 'ic09', data: at(512) },
  { type: 'ic10', data: at(1024) }
]));

// ── run: marketing composites ──────────────────────────────────────────────
/**
 * The banner. Layout is inherited from the old marketing banner so the page
 * does not reflow: a plate on the left carrying the mark, the wordmark beside
 * it, and the value-prop column on the right. Only the marks changed.
 *
 * The mark is inlined as a data-URI so the SVG is self-contained — a banner
 * gets pasted into issues and READMEs, and a relative <image href> would break
 * the moment it left docs/.
 */
const markDataUri = 'data:image/png;base64,' + encodePng(240, resize(MARK, 240)).toString('base64');

const BANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="400" viewBox="0 0 1280 400" role="img" aria-label="Jargon — local multi-agent harness for your CLI coding agents">
  <title>Jargon</title>
  <defs>
    <style>
      .mark { font-family: Impact, "Anton", "Arial Narrow", sans-serif; font-weight: 900; fill: ${CREAM}; }
      .big  { font-size: 104px; }
      .sub  { font-family: "Tahoma", "DejaVu Sans", Geneva, sans-serif; font-size: 18px; letter-spacing: 9px; fill: ${ORANGE}; }
      .tag  { font-family: "Tahoma", "DejaVu Sans", Geneva, sans-serif; font-size: 26px; fill: ${CREAM}; }
      .tag b{ fill: ${ORANGE}; }
      .mono { font-family: "DejaVu Sans Mono", Menlo, monospace; font-size: 15px; fill: #B9A9AC; }
    </style>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GROUND}"/>
      <stop offset="1" stop-color="#0D0904"/>
    </linearGradient>
  </defs>

  <rect width="1280" height="400" fill="url(#bg)"/>

  <!-- Plate carrying the Jargon mark -->
  <g transform="translate(72, 88)">
    <rect x="0" y="0" width="236" height="224" rx="18" fill="${PLATE}"/>
    <rect x="0" y="0" width="236" height="224" rx="18" fill="none" stroke="${RULE}" stroke-width="6"/>
    <image x="18" y="18" width="200" height="200" xlink:href="${markDataUri}"/>
  </g>

  <!-- Wordmark -->
  <text class="mark big" x="348" y="212">JARGON</text>
  <text class="sub" x="352" y="264">MULTI-AGENT HARNESS</text>

  <!-- Value-prop column -->
  <g transform="translate(760, 150)">
    <text class="tag" x="0" y="0">A hive of <b>CLI</b> agents that</text>
    <text class="tag" x="0" y="40">message, route, and remember —</text>
    <text class="tag" x="0" y="80">run by a <b>GOD</b> orchestrator</text>
    <text class="tag" x="0" y="120">you talk to.</text>
    <text class="mono" x="0" y="180">$ npm run dev   ·   local-first   ·   open source</text>
  </g>
</svg>
`;

write('docs/banner.svg', Buffer.from(BANNER_SVG, 'utf8'));

/**
 * The office-floor poster: the app's own floor scene, with the Jargon name.
 *
 * Authored in full here rather than patched at run time. A
 * read-modify-write of its own output would be self-referential — it only
 * works because the input already carries the new name — and it leaves the
 * previous name sitting in this file as a replacement pattern, which is worse:
 * the generator would go on shipping the old name as source text. The scene
 * art (agents, envelopes, terminal overlay) is untouched from the original.
 */
const HERO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="Jargon office floor — a busy agent session">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1A0A0E"/>
      <stop offset="1" stop-color="#2A1014"/>
    </linearGradient>
    <pattern id="floor" width="48" height="48" patternUnits="userSpaceOnUse">
      <rect width="48" height="48" fill="#E5C896"/>
      <rect width="24" height="24" fill="#C9A66B"/>
      <rect x="24" y="24" width="24" height="24" fill="#C9A66B"/>
    </pattern>
    <style>
      .px   { font-family: "Press Start 2P", monospace; fill: #F4F1EA; }
      .mono { font-family: "VT323", "DejaVu Sans Mono", monospace; }
    </style>
  </defs>

  <rect width="1280" height="720" fill="url(#sky)"/>

  <!-- office floor card -->
  <g>
    <rect x="40" y="40" width="1200" height="640" fill="#1A1320" stroke="#4A0D17" stroke-width="8"/>
    <rect x="56" y="56" width="1168" height="608" fill="url(#floor)"/>

    <!-- rooms -->
    <g opacity="0.96">
      <rect x="90" y="96" width="520" height="250" fill="#FFF8E7" stroke="#8B6F47" stroke-width="6"/>
      <rect x="660" y="96" width="520" height="250" fill="#FFF8E7" stroke="#8B6F47" stroke-width="6"/>
      <rect x="90" y="392" width="1090" height="232" fill="#FFF8E7" stroke="#8B6F47" stroke-width="6"/>
    </g>

    <!-- signposts -->
    <g class="mono" font-size="22" fill="#1A1320">
      <text x="110" y="128">project: harness</text>
      <text x="680" y="128">project: web</text>
      <text x="110" y="424">Michael's office · GOD</text>
    </g>

    <!-- desks + tiny avatars -->
    <g>
      <!-- agent A -->
      <rect x="150" y="210" width="60" height="36" fill="#C9A66B" stroke="#1A1320" stroke-width="3"/>
      <rect x="166" y="178" width="24" height="30" fill="#FF6B6B" stroke="#1A1320" stroke-width="3"/>
      <rect x="170" y="170" width="16" height="12" fill="#E8C39E" stroke="#1A1320" stroke-width="3"/>
      <!-- agent B -->
      <rect x="430" y="210" width="60" height="36" fill="#C9A66B" stroke="#1A1320" stroke-width="3"/>
      <rect x="446" y="178" width="24" height="30" fill="#4ECDC4" stroke="#1A1320" stroke-width="3"/>
      <rect x="450" y="170" width="16" height="12" fill="#E8C39E" stroke="#1A1320" stroke-width="3"/>
      <!-- agent C -->
      <rect x="760" y="210" width="60" height="36" fill="#C9A66B" stroke="#1A1320" stroke-width="3"/>
      <rect x="776" y="178" width="24" height="30" fill="#FFD93D" stroke="#1A1320" stroke-width="3"/>
      <rect x="780" y="170" width="16" height="12" fill="#E8C39E" stroke="#1A1320" stroke-width="3"/>
      <!-- god agent -->
      <rect x="150" y="500" width="64" height="40" fill="#6E1423" stroke="#1A1320" stroke-width="3"/>
      <rect x="168" y="466" width="26" height="32" fill="#B197FC" stroke="#1A1320" stroke-width="3"/>
      <rect x="172" y="456" width="18" height="13" fill="#E8C39E" stroke="#1A1320" stroke-width="3"/>
      <text x="160" y="492" class="px" font-size="9" fill="#F4D35E">GOD</text>
    </g>

    <!-- flying envelopes -->
    <g>
      <g transform="translate(300 196) rotate(-12)">
        <rect width="34" height="22" fill="#FFEC99" stroke="#1A1320" stroke-width="3"/>
        <path d="M0 0 L17 13 L34 0" fill="none" stroke="#1A1320" stroke-width="3"/>
      </g>
      <g transform="translate(600 230) rotate(10)">
        <rect width="34" height="22" fill="#B4E5BD" stroke="#1A1320" stroke-width="3"/>
        <path d="M0 0 L17 13 L34 0" fill="none" stroke="#1A1320" stroke-width="3"/>
      </g>
    </g>
  </g>

  <!-- live terminal overlay -->
  <g transform="translate(700 392)">
    <rect width="460" height="220" fill="#0c0608" stroke="#4A0D17" stroke-width="6"/>
    <g class="mono" font-size="21" fill="#d7c9a8">
      <text x="20" y="44"><tspan fill="#4ECDC4">god@jargon</tspan>:<tspan fill="#F4D35E">~</tspan>$ assign "ship it"</text>
      <text x="20" y="78" fill="#B9A9AC">&#8594; route &#8594; agent.coder</text>
      <text x="20" y="112" fill="#B9A9AC">&#8594; recalled 4 memories (12ms)</text>
      <text x="20" y="146" fill="#B9A9AC">&#8594; agent.coder &#9993; agent.qa</text>
      <text x="20" y="180"><tspan fill="#6BCF7F">&#10003;</tspan> done · 3 agents · 0 escalations</text>
    </g>
  </g>

  <!-- play affordance -->
  <g transform="translate(640 360)" opacity="0.92">
    <circle r="56" fill="#F4D35E" stroke="#4A0D17" stroke-width="8"/>
    <path d="M-18 -28 L34 0 L-18 28 Z" fill="#1A0A0E"/>
  </g>
</svg>
`;

write('docs/media/hero-poster.svg', Buffer.from(HERO_SVG, 'utf8'));

// ── marketing rasters (ffmpeg) ─────────────────────────────────────────────
if (haveFfmpeg()) {
  // banner.png — the same layout as banner.svg at its historical 2056x798
  // (a 1.606x render of the 1280x400 artboard, so the shipped PNG keeps its
  // existing dimensions and the page does not reflow).
  const BW = 2056, BH = 798, S = BW / 1280;
  const esc = (s) => s.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\\\'");
  const dt = (text, x, y, size, color, font, extra = '') =>
    `drawtext=fontfile='${font}':text='${esc(text)}':fontcolor=${color}:fontsize=${Math.round(size * S)}:x=${Math.round(x * S)}:y=${Math.round(y * S)}${extra}`;

  const markTmp = D('build/.tmp-banner-mark.png');
  fs.writeFileSync(markTmp, encodePng(Math.round(200 * S), resize(MARK, Math.round(200 * S))));

  // Plate first, then the mark OVER it, then type — in that order, so the plate
  // fill cannot paint over the bubble it is meant to frame.
  const box = (x, y, w, h, colour, t) =>
    `drawbox=x=${Math.round(x * S)}:y=${Math.round(y * S)}:w=${Math.round(w * S)}:h=${Math.round(h * S)}:color=${colour}@1:t=${Math.max(1, Math.round(t * S))}`;

  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${GROUND}:s=${BW}x${BH}`,
    '-i', markTmp,
    '-filter_complex',
    `[0:v]${box(72, 88, 236, 224, PLATE, 236)},` +
    `${box(72, 88, 236, 224, RULE, 6)}[plate];` +
    `[plate][1:v]overlay=${Math.round(90 * S)}:${Math.round(106 * S)}:format=auto,` +
    `${dt('JARGON', 348, 118, 104, CREAM, FONT_BOLD)},` +
    `${dt('MULTI-AGENT HARNESS', 352, 250, 18, ORANGE, FONT_BODY)},` +
    `${dt('A hive of CLI agents that', 760, 130, 26, CREAM, FONT_BODY)},` +
    `${dt('message, route, and remember -', 760, 170, 26, CREAM, FONT_BODY)},` +
    `${dt('run by a GOD orchestrator', 760, 210, 26, CREAM, FONT_BODY)},` +
    `${dt('you talk to.', 760, 250, 26, CREAM, FONT_BODY)},` +
    `${dt('$ npm run dev', 760, 318, 15, '#B9A9AC', FONT_BODY)}[out]`,
    '-map', '[out]', '-frames:v', '1', '-update', '1', D('docs/banner.png')]);
  fs.rmSync(markTmp, { force: true });
  wrote.push(`docs/banner.png              ${(fs.statSync(D('docs/banner.png')).size / 1024).toFixed(1)} KB`);

  // og.png — 2400x1260 Open Graph card. Rebuilt rather than recomputed: the
  // old card was a bespoke screenshot-derived composite and its underlying
  // capture is not reproducible, so the card is recomposed at the identical
  // dimensions, palette and headline with the new mark and wordmark.
  //
  // Authored on a 1200x630 artboard and scaled by GW/1200, matching how the
  // banner is authored — so both cards share one coordinate convention and a
  // font size means the same thing in both.
  const GW = 2400, GH = 1260, G = GW / 1200;
  const gDt = (text, x, y, size, color, font) =>
    `drawtext=fontfile='${font}':text='${esc(text)}':fontcolor=${color}:fontsize=${Math.round(size * G)}:x=${Math.round(x * G)}:y=${Math.round(y * G)}`;
  const gBox = (x, y, w, h, colour, t) =>
    `drawbox=x=${Math.round(x * G)}:y=${Math.round(y * G)}:w=${Math.round(w * G)}:h=${Math.round(h * G)}:color=${colour}@1:t=${Math.max(1, Math.round(t * G))}`;

  // Plate 300 artboard units square; the mark sits inside it at 240 with a
  // 30-unit inset on each axis, so the bubble never touches the rule.
  const PLATE_X = 80, PLATE_Y = 150, PLATE_S = 300, MARK_S = 240, INSET = 30;
  const gMark = D('build/.tmp-og-mark.png');
  fs.writeFileSync(gMark, encodePng(Math.round(MARK_S * G), resize(MARK, Math.round(MARK_S * G))));

  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${GROUND}:s=${GW}x${GH}`,
    '-i', gMark,
    '-filter_complex',
    `[0:v]${gBox(PLATE_X, PLATE_Y, PLATE_S, PLATE_S, PLATE, PLATE_S)},` +
    `${gBox(PLATE_X, PLATE_Y, PLATE_S, PLATE_S, RULE, 7)}[plate];` +
    `[plate][1:v]overlay=${Math.round((PLATE_X + INSET) * G)}:${Math.round((PLATE_Y + INSET) * G)}:format=auto,` +
    `${gDt('JARGON', 430, 190, 126, CREAM, FONT_BOLD)},` +
    `${gDt('Clones for you and your', 436, 336, 50, ORANGE, FONT_BODY)},` +
    `${gDt('team, working 24/7', 436, 394, 50, ORANGE, FONT_BODY)},` +
    `${gDt('A free, local-first harness that turns the', 436, 480, 28, CREAM, FONT_BODY)},` +
    `${gDt('CLI coding agent you already use into an', 436, 520, 28, CREAM, FONT_BODY)},` +
    `${gDt('office of agents on your own machine, with', 436, 560, 28, CREAM, FONT_BODY)},` +
    `${gDt('budgets, a breaker, and shared memory.', 436, 600, 28, CREAM, FONT_BODY)},` +
    `${gDt('npm run dev   .   local-first   .   open source', 436, 660, 22, '#B9A9AC', FONT_BODY)}[out]`,
    '-map', '[out]', '-frames:v', '1', '-update', '1', D('docs/media/og.png')]);
  fs.rmSync(gMark, { force: true });
  wrote.push(`docs/media/og.png            ${(fs.statSync(D('docs/media/og.png')).size / 1024).toFixed(1)} KB`);
} else {
  skipped.push('docs/banner.png', 'docs/media/og.png');
  console.warn(`! ffmpeg not found at ${FFMPEG}`);
  console.warn('  skipping the two marketing rasters (they need drawtext).');
  console.warn('  All icons, favicons, .ico and .icns were still generated.');
}

console.log(wrote.join('\n'));
if (skipped.length) console.log(`\nskipped (need ffmpeg): ${skipped.join(', ')}`);