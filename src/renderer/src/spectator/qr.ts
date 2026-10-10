/**
 * qr.ts — a compact, dependency-free QR Code encoder (byte mode), DOM-free so it can
 * run in the Electron renderer AND be unit-tested as a plain Node module.
 *
 * Why hand-rolled: the app ships no QR dependency and the constraint is "no new npm
 * deps", so the in-app Spectator QR code (a phone scans it to open the live floor) is
 * generated here. It implements the ISO/IEC 18004 encoder — Reed–Solomon ECC over
 * GF(256), all 8 data masks with the standard penalty score, and format/version info
 * — following the canonical Nayuki QR generator (MIT), reduced to what a short URL
 * needs (versions 1–10, ECC levels L/M). A URL like `http://192.168.1.5:47870/<token>`
 * is ~50 bytes, which lands in a low version with room to spare.
 */

// ─── Galois field GF(256), primitive polynomial 0x11D ────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGalois(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Coefficients of the RS generator polynomial of the given degree (descending),
 *  computed as ∏(x − α^i) for i in [0, degree). Canonical Nayuki construction. */
function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1; // start with the monomial x^0
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** Reed–Solomon remainder of `data` divided by the generator of the given degree. */
function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const divisor = rsDivisor(degree);
  const result = new Uint8Array(degree);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// ─── Version / ECC tables (versions 1..10; index 0 unused) ───────────────────
// ECC levels: LOW, MEDIUM, QUARTILE, HIGH. We expose L and M; a short URL uses L/M.
export type EccLevel = 'L' | 'M';
const ECC_INDEX: Record<string, number> = { L: 0, M: 1, Q: 2, H: 3 };

// ECC codewords per block, indexed [ecc][version].
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], // LOW
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], // MEDIUM
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24], // QUARTILE
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28] // HIGH
];
// Number of ECC blocks, indexed [ecc][version].
const NUM_ECC_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4], // LOW
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5], // MEDIUM
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8], // QUARTILE
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8] // HIGH
];

const MIN_VERSION = 1;
const MAX_VERSION = 10;

/** Number of raw data modules (bits available for data+ECC, before ECC subtraction). */
function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** Number of data codewords for a version + ECC level. */
function numDataCodewords(ver: number, ecc: EccLevel): number {
  const e = ECC_INDEX[ecc];
  return Math.floor(numRawDataModules(ver) / 8)
    - ECC_CODEWORDS_PER_BLOCK[e][ver] * NUM_ECC_BLOCKS[e][ver];
}

// ─── Bit buffer ──────────────────────────────────────────────────────────────
class BitBuffer {
  readonly bits: number[] = [];
  get length(): number { return this.bits.length; }
  append(val: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  }
}

// UTF-8 bytes of a string (URLs are ASCII, but be correct regardless).
function toUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Build the final data+ECC codeword stream for a chosen version + ECC level. */
function buildCodewords(bytes: Uint8Array, ver: number, ecc: EccLevel): Uint8Array {
  const e = ECC_INDEX[ecc];
  const dataCapacity = numDataCodewords(ver, ecc);
  const bb = new BitBuffer();
  bb.append(0b0100, 4); // byte mode indicator
  bb.append(bytes.length, versionCharCountBits(ver));
  for (const b of bytes) bb.append(b, 8);

  const capacityBits = dataCapacity * 8;
  // Terminator (up to 4 zero bits), then pad to a byte boundary, then pad bytes.
  bb.append(0, Math.min(4, capacityBits - bb.length));
  bb.append(0, (8 - (bb.length % 8)) % 8);

  const padBytes = [0xec, 0x11];
  for (let i = 0; bb.length < capacityBits; i++) bb.append(padBytes[i % 2], 8);

  const data = new Uint8Array(dataCapacity);
  for (let i = 0; i < dataCapacity; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i * 8 + j];
    data[i] = byte;
  }

  // Split into blocks, append ECC to each, then interleave.
  const numBlocks = NUM_ECC_BLOCKS[e][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e][ver];
  const totalEccLen = numBlocks * blockEccLen;
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockDataLen = Math.floor(rawCodewords / numBlocks) - blockEccLen;

  const blocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    blocks.push(dat);
    eccBlocks.push(rsRemainder(dat, blockEccLen));
  }

  const result = new Uint8Array(rawCodewords);
  let idx = 0;
  const maxDat = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxDat; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < blocks[b].length) result[idx++] = blocks[b][i];
    }
  }
  for (let i = 0; i < blockEccLen; i++) {
    for (let b = 0; b < eccBlocks.length; b++) result[idx++] = eccBlocks[b][i];
  }
  void totalEccLen;
  return result;
}

/** Character-count-indicator width for byte mode at a version (8 bits ≤ v9, else 16). */
function versionCharCountBits(ver: number): number {
  return ver <= 9 ? 8 : 16;
}

// ─── Matrix construction ─────────────────────────────────────────────────────
const ALIGN_POS: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38],
  [6, 24, 42], [6, 26, 46], [6, 28, 50]
];

class Matrix {
  readonly size: number;
  readonly modules: boolean[][]; // true = dark
  readonly reserved: boolean[][];
  constructor(ver: number) {
    this.size = ver * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
}

function drawFunctionPatterns(m: Matrix, ver: number): void {
  const size = m.size;
  // Timing patterns.
  for (let i = 0; i < size; i++) {
    setFn(m, 6, i, i % 2 === 0);
    setFn(m, i, 6, i % 2 === 0);
  }
  // Finder patterns (+ separators).
  drawFinder(m, 3, 3);
  drawFinder(m, size - 4, 3);
  drawFinder(m, 3, size - 4);
  // Alignment patterns.
  const pos = ALIGN_POS[ver];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      // Skip the three corners (covered by finders).
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      drawAlign(m, pos[i], pos[j]);
    }
  }
  // Format bits (drawn with a dummy mask first, rewritten after mask choice).
  drawFormatBits(m, 0, 1); // ecc level index 1 = M placeholder; corrected later
  // Version info (v ≥ 7).
  drawVersion(m, ver);
}

function setFn(m: Matrix, x: number, y: number, dark: boolean): void {
  m.modules[y][x] = dark;
  m.reserved[y][x] = true;
}

function drawFinder(m: Matrix, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= m.size || y < 0 || y >= m.size) continue;
      setFn(m, x, y, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlign(m: Matrix, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFn(m, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}


/** Draw the 15-bit format information for an ECC level + mask. */
function drawFormatBits(m: Matrix, eccLevelIdx: number, mask: number): void {
  const size = m.size;
  const data = (eccLevelIdx << 3) | mask; // 5 bits
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412; // 15 bits, BCH + XOR mask

  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
  // First copy.
  for (let i = 0; i <= 5; i++) setFn(m, 8, i, bit(i));
  setFn(m, 8, 7, bit(6));
  setFn(m, 8, 8, bit(7));
  setFn(m, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFn(m, 14 - i, 8, bit(i));
  // Second copy.
  for (let i = 0; i < 8; i++) setFn(m, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFn(m, 8, size - 15 + i, bit(i));
  setFn(m, 8, size - 8, true); // dark module
}

/** Draw the 18-bit version information (versions ≥ 7). */
function drawVersion(m: Matrix, ver: number): void {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem; // 18 bits
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >>> i) & 1) !== 0;
    const a = m.size - 11 + (i % 3), b = Math.floor(i / 3);
    setFn(m, a, b, bit);
    setFn(m, b, a, bit);
  }
}

/** Place codewords into the matrix in the standard two-module-wide zigzag. */
function drawCodewords(m: Matrix, data: Uint8Array): void {
  let i = 0; // bit index
  const size = m.size;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (m.reserved[y][x]) continue;
        let dark = false;
        if (i < data.length * 8) dark = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        m.modules[y][x] = dark;
        i++;
      }
    }
  }
}

/** Apply data mask `mask` to all non-reserved modules. */
function applyMask(m: Matrix, mask: number): void {
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (m.reserved[y][x]) continue;
      let invert = false;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) m.modules[y][x] = !m.modules[y][x];
    }
  }
}

/** Penalty score for mask selection (the four standard rules). */
function penaltyScore(m: Matrix): number {
  const size = m.size;
  const mod = m.modules;
  let result = 0;

  // Rule 1: runs of 5+ same-colour modules in a row/column.
  const runScore = (run: number): number => run >= 5 ? 3 + (run - 5) : 0;
  for (let y = 0; y < size; y++) {
    let runH = 1, runV = 1;
    for (let x = 1; x < size; x++) {
      runH = (mod[y][x] === mod[y][x - 1]) ? runH + 1 : (result += runScore(runH), 1);
      runV = (mod[x][y] === mod[x - 1][y]) ? runV + 1 : (result += runScore(runV), 1);
    }
    result += runScore(runH) + runScore(runV);
  }

  // Rule 2: 2×2 blocks of the same colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) result += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 dark pattern with a 4-module light margin on
  // either side. Scan rows and columns independently, bounds-safe.
  const PAT = [true, false, true, true, true, false, true];
  const seq = (get: (i: number) => boolean, start: number): boolean => {
    for (let i = 0; i < 7; i++) if (get(start + i) !== PAT[i]) return false;
    return true;
  };
  const light4 = (get: (i: number) => boolean, start: number): boolean => {
    for (let i = 0; i < 4; i++) if (get(start + i) !== false) return false;
    return true;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x <= size - 7; x++) {
      // Row scan at this (y, x).
      if (seq((i) => mod[y][i], x)) {
        const before = x >= 4 && light4((i) => mod[y][i], x - 4);
        const after = x + 11 <= size && light4((i) => mod[y][i], x + 7);
        if (before || after) result += 40;
      }
      // Column scan at this (y, x) — valid only while 7 rows fit below y.
      if (y <= size - 7 && seq((i) => mod[i][x], y)) {
        const before = y >= 4 && light4((i) => mod[i][x], y - 4);
        const after = y + 11 <= size && light4((i) => mod[i][x], y + 7);
        if (before || after) result += 40;
      }
    }
  }

  // Rule 4: deviation from 50% dark.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mod[y][x]) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * 10;
  return result;
}


/** Pick the smallest version (1..10) whose data capacity fits `byteLen` at `ecc`. */
function chooseVersion(byteLen: number, ecc: EccLevel): number {
  for (let ver = MIN_VERSION; ver <= MAX_VERSION; ver++) {
    // Data bits available for the payload after mode(4) + char-count bits.
    const capacityBits = numDataCodewords(ver, ecc) * 8;
    const usedBits = 4 + versionCharCountBits(ver) + byteLen * 8;
    if (usedBits <= capacityBits) return ver;
  }
  throw new Error(`QR: payload of ${byteLen} bytes exceeds version ${MAX_VERSION} at ECC ${ecc}`);
}

export interface QrMatrix {
  /** Module count per side (version*4+17). */
  size: number;
  version: number;
  /** modules[y][x] === true → dark. */
  modules: boolean[][];
}

/**
 * Encode `text` (byte mode) into a QR matrix, choosing the smallest version that
 * fits and the mask with the lowest penalty. Throws if the text is too long for the
 * supported version range (a LAN URL never is).
 */
export function encodeQr(text: string, ecc: EccLevel = 'M'): QrMatrix {
  const bytes = toUtf8(text);
  const ver = chooseVersion(bytes.length, ecc);
  const codewords = buildCodewords(bytes, ver, ecc);

  const eccIdx = ECC_INDEX[ecc];
  let best: { mask: number; matrix: Matrix; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = new Matrix(ver);
    drawFunctionPatterns(m, ver);
    drawFormatBits(m, eccIdx, mask); // overwrite the placeholder with the real mask
    drawCodewords(m, codewords);
    applyMask(m, mask);
    const score = penaltyScore(m);
    if (!best || score < best.score) best = { mask, matrix: m, score };
  }
  const chosen = best as { mask: number; matrix: Matrix };
  return { size: chosen.matrix.size, version: ver, modules: chosen.matrix.modules };
}

/**
 * Render a QR matrix as a self-contained SVG string (no DOM, no deps) — a single
 * <path> of 1×1 dark modules. `quiet` is the quiet-zone width in modules (spec: 4).
 */
export function qrToSvg(matrix: QrMatrix, opts: { dark?: string; light?: string; quiet?: number; scale?: number } = {}): string {
  const dark = opts.dark ?? '#14111c';
  const light = opts.light ?? '#ffffff';
  const quiet = opts.quiet ?? 4;
  const scale = opts.scale ?? 8;
  const n = matrix.size;
  const dim = (n + quiet * 2) * scale;
  let path = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix.modules[y][x]) continue;
      const px = (x + quiet) * scale;
      const py = (y + quiet) * scale;
      path += `M${px} ${py}h${scale}v${scale}h-${scale}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`
    + `<rect width="${dim}" height="${dim}" fill="${light}"/>`
    + `<path d="${path}" fill="${dark}"/>`
    + `</svg>`;
}

