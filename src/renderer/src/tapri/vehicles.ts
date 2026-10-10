// Procedural pixel-art vehicles and roadside props for the Tapri street.
// Drawn with ctx.fillRect only: no images, fonts or sprite sheets.
//
// Each static body is authored as a small cell grid (Sprite), given a 1px ink
// outline and two-tone shading (light from the top-left), then baked once per
// (kind, variant) into merged rects. Per frame only the moving parts (wheel
// spokes, legs, exhaust, flutter) are drawn on top.
//
// Units are sprite pixels (multiplied by px on screen). Grid space is x to the
// right, y down, origin at the top-left of the body box. The ground line is the
// bottom of the box (y = H); the road shadow is the row just below it. The
// public origin (x, y) is the ground point under the bottom-centre. The art
// faces right and is mirrored for facing -1.

import type { Ctx, Facing, VehicleDrawOpts, VehicleKind } from './types';

export type SmallProp = 'crow' | 'dog' | 'cow' | 'pigeon';

interface Rect { x: number; y: number; w: number; h: number; c: string }

const SHADOW = 'rgba(0, 0, 0, 0.38)';
const INK = '#161616';
const TYRE = '#2a2c31';
const RIM = '#b4bcc5';
const SPOKE = '#4b535c';
const HUB = '#eef1f4';
const SKIN = '#b57a52';
const HAIR = '#1f1a17';
const GLASS = '#8fd3f7';
const GLASS_LIT = '#e3f6ff';
const GLASS_DARK = '#3f7aa3';
const LAMP = '#fff3a3';
const TAIL = '#e03131';
const KHAKI = '#c4a06a';
const SHIRT = '#e2b45c';
const TROUSER = '#33405c';
const SEAT = '#3a3f47';
const UNDER = '#2a2e36';
const PINK = '#e64980';
const CAR_PAINT = ['#f1f3f5', '#e03131', '#b4bcc5', '#1c7ed6'];

/** Mixes a #rrggbb colour toward white (amt > 0) or black (amt < 0). */
function tone(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => {
    const out = amt >= 0 ? v + (255 - v) * amt : v * (1 + amt);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  const v = (ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255);
  return `#${v.toString(16).padStart(6, '0')}`;
}

/** A static pixel-art body: cells are painted, shaded, then outlined. */
class Sprite {
  readonly w: number;
  readonly h: number;
  private readonly cells: Array<string | null>;
  private readonly lit: boolean[];

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cells = new Array<string | null>(w * h).fill(null);
    this.lit = new Array<boolean>(w * h).fill(false);
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  private solid(x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const c = this.cells[y * this.w + x];
    return c !== null && c !== INK;
  }

  /** Paints a rect. lit cells take part in the two-tone shading pass. */
  fill(x: number, y: number, fw: number, fh: number, c: string, lit = false): void {
    for (let yy = y; yy < y + fh; yy++) {
      for (let xx = x; xx < x + fw; xx++) {
        if (!this.inside(xx, yy)) continue;
        const i = yy * this.w + xx;
        this.cells[i] = c;
        this.lit[i] = lit;
      }
    }
  }

  put(x: number, y: number, c: string): void {
    this.fill(x, y, 1, 1, c, false);
  }

  /** A one-cell line between two points (limbs, handlebars). */
  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      this.put(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), c);
    }
  }

  /** Top and left edges of lit cells go lighter, bottom and right go darker. */
  shade(): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const base = this.cells[i];
        if (!this.lit[i] || base === null) continue;
        const hi = !this.solid(x, y - 1) || !this.solid(x - 1, y);
        const lo = !this.solid(x, y + 1) || !this.solid(x + 1, y);
        if (hi) this.cells[i] = tone(base, 0.22);
        else if (lo) this.cells[i] = tone(base, -0.24);
        this.lit[i] = false;
      }
    }
  }

  /** 1px ink outline around every silhouette cell that borders empty space. */
  outline(c = INK): void {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.cells[y * this.w + x] !== null) continue;
        if (this.solid(x - 1, y) || this.solid(x + 1, y) || this.solid(x, y - 1) || this.solid(x, y + 1)) {
          add.push(y * this.w + x);
        }
      }
    }
    for (const i of add) this.cells[i] = c;
  }

  /** Row-merged, then column-stacked, rects: far fewer fillRect calls than cells. */
  rects(): Rect[] {
    const out: Rect[] = [];
    let open = new Map<string, Rect>();
    for (let y = 0; y < this.h; y++) {
      const row: Rect[] = [];
      let x = 0;
      while (x < this.w) {
        const c = this.cells[y * this.w + x];
        if (c === null) {
          x++;
          continue;
        }
        const start = x;
        while (x < this.w && this.cells[y * this.w + x] === c) x++;
        row.push({ x: start, y, w: x - start, h: 1, c });
      }
      const next = new Map<string, Rect>();
      for (const r of row) {
        const key = `${r.x}:${r.w}:${r.c}`;
        const prev = open.get(key);
        if (prev) {
          prev.h++;
          next.set(key, prev);
          open.delete(key);
        } else {
          next.set(key, r);
        }
      }
      out.push(...open.values());
      open = next;
    }
    out.push(...open.values());
    return out;
  }
}

const baked = new Map<string, Rect[]>();
function bake(key: string, make: () => Sprite): Rect[] {
  let rects = baked.get(key);
  if (!rects) {
    rects = make().rects();
    baked.set(key, rects);
  }
  return rects;
}

/** Draws in grid space, mirrored for facing -1, lifted by dy sprite units. */
class Painter {
  readonly ctx: Ctx;
  readonly x: number;
  readonly y: number;
  readonly px: number;
  readonly f: Facing;
  readonly W: number;
  readonly H: number;
  readonly dy: number;

  constructor(ctx: Ctx, x: number, y: number, px: number, f: Facing, W: number, H: number, dy = 0) {
    this.ctx = ctx;
    this.x = x;
    this.y = y;
    this.px = px;
    this.f = f;
    this.W = W;
    this.H = H;
    this.dy = dy;
  }

  /** The same painter with the body lifted (dy < 0) or dropped by whole units. */
  shifted(dy: number): Painter {
    return new Painter(this.ctx, this.x, this.y, this.px, this.f, this.W, this.H, this.dy + dy);
  }

  /** A w x h rect whose top-left is (gx, gy) in grid space. */
  r(gx: number, gy: number, w: number, h: number, color: string): void {
    let left = gx - this.W / 2;
    if (this.f === -1) left = -(left + w);
    const top = gy - this.H + this.dy;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      Math.round(this.x + left * this.px),
      Math.round(this.y + top * this.px),
      Math.round(w * this.px),
      Math.round(h * this.px),
    );
  }

  paint(rects: Rect[]): void {
    for (const q of rects) this.r(q.x, q.y, q.w, q.h, q.c);
  }

  /** A filled disc built from one-unit rows, centred on (cx, cy). */
  disc(cx: number, cy: number, rad: number, color: string): void {
    for (let dy = -rad; dy <= rad; dy++) {
      const half = Math.round(Math.sqrt(rad * rad + rad * 0.5 - dy * dy));
      this.r(cx - half, cy + dy, half * 2 + 1, 1, color);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: string): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      this.r(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), 1, 1, color);
    }
  }

  /** A tyre, rim and hub whose spokes turn with t. The bottom row is cy + rad. */
  wheel(cx: number, cy: number, rad: number, t: number): void {
    this.disc(cx, cy, rad + 1, INK);
    this.disc(cx, cy, rad, TYRE);
    this.disc(cx, cy, rad - 1, RIM);
    const a = (Math.floor(t / 70) % 8) * (Math.PI / 8);
    const reach = rad - 1.5;
    for (const k of [0, Math.PI / 2]) {
      const ang = a + k;
      this.line(cx - Math.cos(ang) * reach, cy - Math.sin(ang) * reach, cx + Math.cos(ang) * reach, cy + Math.sin(ang) * reach, SPOKE);
    }
    this.r(cx, cy, 1, 1, HUB);
  }

  /** Three exhaust specks rising and drifting back from grid point (gx, gy). */
  puff(gx: number, gy: number, t: number): void {
    for (let j = 0; j < 3; j++) {
      const age = (Math.floor(t / 150) + j) % 3;
      const alpha = (0.6 - age * 0.18).toFixed(2);
      this.r(gx - age, gy - age * 2, 1, 1, `rgba(230, 230, 230, ${alpha})`);
    }
  }
}

function clampVariant(variant: number | undefined): number {
  return Number.isFinite(variant) ? Math.abs(Math.floor(variant as number)) : 0;
}

// --- vehicle bodies ----------------------------------------------------------

// Grid sizes: W x H is the body box; the drawn height is H + 1 (road shadow).
const AUTO = { w: 26, h: 17 };
const RICKSHAW = { w: 28, h: 19 };
const CAR = { w: 46, h: 18 };
const BIKE = { w: 24, h: 17 };
const SCOOTER = { w: 22, h: 19 };
const BUS = { w: 82, h: 37 };

function autoSprite(scheme: number): Sprite {
  const body = ['#23262b', '#f2b705', '#2f9e44'][scheme];
  const roof = ['#c5e03b', '#23262b', '#ffd43b'][scheme];
  const s = new Sprite(AUTO.w, AUTO.h);
  // canopy with a curved crown and a sloping front
  s.fill(7, 1, 12, 1, roof, true);
  s.fill(3, 2, 18, 2, roof, true);
  s.fill(19, 3, 4, 2, roof, true);
  // cabin walls, nose and chassis
  s.fill(1, 5, 21, 7, body, true);
  s.fill(19, 6, 5, 6, body, true);
  s.fill(1, 12, 23, 3, UNDER, true);
  s.shade();
  // open rear and front bays
  s.fill(3, 6, 10, 4, '#121316');
  s.fill(15, 6, 4, 4, '#121316');
  s.line(13, 5, 13, 10, INK);
  s.line(14, 5, 14, 10, body);
  // passenger in the back, driver at the front
  s.fill(6, 6, 3, 2, SKIN);
  s.fill(6, 6, 3, 1, HAIR);
  s.fill(5, 8, 5, 2, '#3b5bdb');
  s.fill(16, 6, 2, 2, SKIN);
  s.put(16, 6, HAIR);
  s.fill(16, 8, 3, 2, KHAKI);
  s.line(18, 8, 18, 10, INK);
  // windscreen, lamps, meter flag and a stripe on the body
  s.fill(20, 6, 2, 3, GLASS);
  s.put(23, 9, LAMP);
  s.put(1, 9, TAIL);
  s.line(21, 2, 21, 0, INK);
  s.fill(1, 10, 21, 1, roof);
  s.put(22, 2, TAIL);
  return s;
}

function drawAuto(p: Painter, b: Painter, t: number, variant: number): void {
  const scheme = variant % 3;
  const shadowRow = AUTO.h;
  p.r(1, shadowRow, AUTO.w - 2, 1, SHADOW);
  p.puff(0, 13, t);
  b.paint(bake(`auto:${scheme}`, () => autoSprite(scheme)));
  p.wheel(6, 13, 3, t);
  p.wheel(10, 13, 3, t);
  p.wheel(20, 13, 3, t);
}

function rickshawSprite(scheme: number): Sprite {
  const paint = ['#f08c00', '#2f9e44', '#1c7ed6'][scheme];
  const hood = ['#e8590c', '#fab005', '#c92a2a'][scheme];
  const stripe = ['#fff3bf', '#e8590c', '#fff3bf'][scheme];
  const s = new Sprite(RICKSHAW.w, RICKSHAW.h);
  // striped hood over the passenger, pointed at the front
  s.fill(7, 1, 10, 1, hood, true);
  s.fill(3, 2, 16, 3, hood, true);
  s.fill(2, 5, 16, 1, hood, true);
  s.fill(17, 6, 2, 3, hood, true);
  for (const x of [5, 9, 13]) s.fill(x, 2, 1, 4, stripe);
  // seat and body panels
  s.fill(2, 11, 15, 2, paint, true);
  s.fill(2, 13, 15, 2, paint, true);
  s.fill(2, 15, 16, 1, SEAT, true);
  s.shade();
  // passenger under the hood
  s.fill(6, 6, 3, 3, SKIN);
  s.fill(6, 6, 3, 1, HAIR);
  s.fill(5, 9, 6, 2, '#c2255c');
  // driver standing behind the handlebar
  s.fill(20, 3, 3, 3, SKIN);
  s.fill(20, 3, 3, 1, HAIR);
  s.fill(19, 6, 4, 5, KHAKI, true);
  s.line(22, 7, 25, 10, KHAKI);
  s.line(25, 6, 25, 10, INK);
  s.line(24, 6, 26, 6, INK);
  s.put(26, 11, LAMP);
  s.put(1, 8, TAIL);
  s.line(12, 15, 22, 15, SEAT);
  return s;
}

function drawRickshaw(p: Painter, b: Painter, t: number, variant: number): void {
  const scheme = variant % 3;
  const shadowRow = RICKSHAW.h;
  const a = t / 120;
  p.r(1, shadowRow, RICKSHAW.w - 2, 1, SHADOW);
  b.paint(bake(`rickshaw:${scheme}`, () => rickshawSprite(scheme)));
  p.wheel(6, 14, 4, t); // bench wheel
  p.wheel(24, 15, 3, t); // bicycle wheel
  // pedalling leg: the foot circles a crank under the driver
  const cx = 17;
  const cy = 15;
  const fx = cx + Math.cos(a) * 2;
  const fy = cy + Math.sin(a) * 2;
  const kx = (19 + fx) / 2 + 1;
  const ky = (11 + fy) / 2;
  b.line(19, 11, kx, ky, TROUSER);
  b.line(kx, ky, fx, fy, TROUSER);
}

function carSprite(paint: string, taxi: boolean): Sprite {
  const roof = taxi ? '#ffd43b' : paint;
  const lower = taxi ? '#1d1f23' : paint;
  const s = new Sprite(CAR.w, CAR.h);
  // cabin with sloping windscreens, then the lower body
  s.fill(15, 1, 13, 1, roof, true);
  s.fill(12, 2, 21, 4, roof, true);
  s.fill(1, 6, 44, 8, lower, true);
  s.fill(4, 13, 40, 1, UNDER, true);
  s.shade();
  // windows and pillars
  s.fill(13, 2, 7, 3, GLASS);
  s.fill(13, 2, 7, 1, GLASS_LIT);
  s.fill(22, 2, 8, 3, GLASS);
  s.fill(22, 2, 8, 1, GLASS_LIT);
  s.fill(31, 2, 2, 3, GLASS_DARK);
  s.fill(20, 2, 2, 3, roof);
  s.fill(11, 5, 25, 1, roof);
  // door seams, handles, mirror
  s.fill(21, 6, 1, 7, GLASS_DARK);
  s.fill(36, 6, 1, 7, GLASS_DARK);
  s.put(18, 9, INK);
  s.put(33, 9, INK);
  s.put(31, 6, INK);
  // wheel arches
  s.fill(6, 9, 11, 5, INK);
  s.fill(30, 9, 11, 5, INK);
  // lights and bumpers
  s.fill(43, 8, 2, 2, LAMP);
  s.fill(42, 11, 3, 2, '#50565e');
  s.fill(1, 12, 3, 2, '#50565e');
  s.fill(1, 8, 1, 2, TAIL);
  if (taxi) {
    s.fill(1, 10, 44, 1, '#ffd43b'); // yellow flash along the body
    s.fill(17, 1, 8, 1, '#fff7d6'); // lit roof sign
    s.put(18, 1, INK);
    s.put(21, 1, INK);
    s.put(24, 1, INK);
  }
  return s;
}

function drawSedan(p: Painter, b: Painter, t: number, variant: number, taxi: boolean): void {
  const paint = taxi ? '#1d1f23' : CAR_PAINT[variant % CAR_PAINT.length];
  p.r(1, CAR.h, CAR.w - 2, 1, SHADOW);
  p.puff(0, 12, t);
  b.paint(bake(`car:${taxi ? 'taxi' : paint}`, () => carSprite(paint, taxi)));
  p.wheel(11, 13, 4, t);
  p.wheel(35, 13, 4, t);
}

function bikeSprite(scheme: number): Sprite {
  const paint = ['#e03131', '#1c7ed6', '#2f9e44', '#f08c00'][scheme];
  const helmet = scheme % 2 === 0 ? '#f1f3f5' : '#212529';
  const s = new Sprite(BIKE.w, BIKE.h);
  // engine, tank and seat
  s.fill(7, 9, 7, 3, '#4a4f57', true);
  s.fill(8, 5, 7, 3, paint, true);
  s.fill(4, 7, 4, 1, INK);
  s.shade();
  // frame and fork
  s.line(14, 10, 19, 10, INK);
  s.line(6, 10, 9, 9, INK);
  s.line(18, 12, 16, 3, INK);
  s.fill(14, 2, 3, 1, INK); // handlebar
  s.put(16, 4, LAMP); // headlight
  // rider: leaning torso, helmet with visor, thigh and arm
  s.fill(8, 3, 3, 3, SHIRT, true);
  s.fill(10, 1, 3, 3, helmet, true);
  s.put(12, 2, GLASS);
  s.fill(7, 6, 3, 2, TROUSER);
  s.line(10, 4, 14, 3, SHIRT);
  s.line(9, 8, 11, 9, TROUSER);
  s.fill(2, 11, 4, 1, '#9aa3ad'); // exhaust
  return s;
}

function drawBike(p: Painter, b: Painter, t: number, variant: number): void {
  const scheme = variant % 4;
  p.r(1, BIKE.h, BIKE.w - 2, 1, SHADOW);
  p.puff(1, 11, t);
  b.paint(bake(`bike:${scheme}`, () => bikeSprite(scheme)));
  p.wheel(6, 12, 4, t);
  p.wheel(18, 12, 4, t);
  // the rider's shin, drawn over the engine
  const knee = Math.floor(t / 300) % 2 === 0 ? 0 : 1;
  b.line(9, 8, 11 + knee, 10, TROUSER);
}

function scooterSprite(paint: string, helmet: string): Sprite {
  const s = new Sprite(SCOOTER.w, SCOOTER.h);
  // low bodywork over the engine, tall leg shield at the front
  s.fill(2, 8, 11, 4, paint, true);
  s.fill(12, 4, 4, 8, paint, true);
  s.fill(5, 12, 9, 2, SEAT, true);
  s.shade();
  s.fill(4, 6, 6, 1, INK); // seat
  s.line(13, 2, 13, 4, INK); // steering stem
  s.fill(12, 1, 3, 1, INK); // handlebar
  s.put(15, 6, LAMP);
  s.put(1, 8, TAIL);
  // rider upright on the seat, reaching the bars
  s.fill(6, 3, 3, 3, SHIRT, true);
  s.fill(6, 1, 3, 2, helmet, true);
  s.put(8, 2, GLASS);
  s.line(8, 4, 12, 2, SHIRT);
  s.line(7, 7, 9, 11, TROUSER);
  // pillion behind, in a saree
  s.fill(2, 3, 2, 2, SKIN);
  s.fill(2, 3, 2, 1, HAIR);
  s.fill(2, 5, 3, 2, PINK, true);
  return s;
}

function drawScooter(p: Painter, b: Painter, t: number, variant: number): void {
  const scheme = variant % 4;
  const paint = ['#f1f3f5', '#2f9e44', '#fcc419', '#c2255c'][scheme];
  const helmet = scheme % 2 === 0 ? '#1971c2' : '#e8590c';
  p.r(1, SCOOTER.h, SCOOTER.w - 2, 1, SHADOW);
  p.puff(1, 10, t);
  b.paint(bake(`scooter:${scheme}`, () => scooterSprite(paint, helmet)));
  p.wheel(4, 15, 3, t);
  p.wheel(17, 15, 3, t);
  // a dupatta streaming back from the pillion, flapping
  const flap = Math.floor(t / 120) % 2;
  b.r(0, 3 + flap, 2, 1, PINK);
  b.r(0, 4 - flap, 2, 1, PINK);
  b.r(0, 5 + flap, 1, 1, PINK);
}

function busSprite(paint: string): Sprite {
  const skirt = tone(paint, -0.3);
  const s = new Sprite(BUS.w, BUS.h);
  s.fill(2, 1, 78, 1, '#dee2e6', true); // roof rim
  s.fill(1, 2, 80, 22, paint, true); // upper body
  s.fill(1, 24, 80, 9, skirt, true); // lower skirt
  s.fill(1, 33, 80, 1, UNDER, true); // bumper
  s.shade();
  s.fill(1, 18, 80, 2, '#f8f9fa'); // white side stripe
  // windows with passengers, each a glass band with a lit top edge
  const windows = [5, 16, 27, 38, 49];
  windows.forEach((x, i) => {
    s.fill(x, 6, 9, 10, GLASS);
    s.fill(x, 6, 9, 1, GLASS_LIT);
    s.fill(x, 15, 9, 1, GLASS_DARK);
    if (i % 2 === 0) {
      s.fill(x + 3, 9, 3, 2, i === 2 ? HAIR : SKIN);
      s.fill(x + 2, 11, 5, 3, i === 2 ? '#e8590c' : '#3b5bdb');
    } else {
      s.fill(x + 1, 10, 3, 2, '#5c3d2e');
      s.fill(x + 1, 12, 4, 3, '#f08c00');
    }
  });
  // passenger door, windscreen, destination board
  s.fill(60, 6, 7, 20, GLASS_DARK);
  s.line(63, 6, 63, 25, INK);
  s.fill(71, 5, 8, 15, GLASS);
  s.fill(72, 6, 2, 9, GLASS_LIT);
  s.fill(56, 3, 19, 2, '#ffb703');
  for (let x = 58; x < 74; x += 3) s.put(x, 3, '#3a2a06');
  s.put(80, 22, LAMP);
  s.put(80, 28, LAMP);
  s.put(1, 22, TAIL);
  s.fill(9, 26, 14, 6, INK); // rear wheel arch
  s.fill(59, 26, 14, 6, INK); // front wheel arch
  return s;
}

function drawBus(p: Painter, b: Painter, t: number, variant: number): void {
  const paint = variant % 2 === 0 ? '#1c7ed6' : '#c92a2a';
  p.r(1, BUS.h, BUS.w - 2, 1, SHADOW);
  p.puff(1, 25, t);
  b.paint(bake(`bus:${variant % 2}`, () => busSprite(paint)));
  p.wheel(16, 31, 5, t);
  p.wheel(66, 31, 5, t);
}

/** Draws a vehicle with its ground point (tyres on the road) at (x, y). */
export function drawVehicle(ctx: Ctx, kind: VehicleKind, x: number, y: number, o: VehicleDrawOpts): void {
  const px = o.px ?? 3;
  const variant = clampVariant(o.variant);
  const dims = SIZE[kind];
  const p = new Painter(ctx, x, y, px, o.facing, dims.w, dims.h);
  // Suspension: the body rides up by one unit on the crest of each bump.
  const b = p.shifted(Math.sin(o.t / 180) > 0.5 ? -1 : 0);
  switch (kind) {
    case 'auto': drawAuto(p, b, o.t, variant); break;
    case 'rickshaw': drawRickshaw(p, b, o.t, variant); break;
    case 'car': drawSedan(p, b, o.t, variant, false); break;
    case 'taxi': drawSedan(p, b, o.t, variant, true); break;
    case 'bike': drawBike(p, b, o.t, variant); break;
    case 'scooter': drawScooter(p, b, o.t, variant); break;
    case 'bus': drawBus(p, b, o.t, variant); break;
  }
}

const SIZE: Record<VehicleKind, { w: number; h: number }> = {
  auto: AUTO,
  rickshaw: RICKSHAW,
  car: CAR,
  taxi: CAR,
  bike: BIKE,
  scooter: SCOOTER,
  bus: BUS,
};

/** Bounding size in screen px of a vehicle at the given px scale. */
export function vehicleSize(kind: VehicleKind, px = 3): { w: number; h: number } {
  const d = SIZE[kind];
  return { w: d.w * px, h: (d.h + 1) * px };
}

// --- roadside props ----------------------------------------------------------

const CROW = { w: 8, h: 5 };
const DOG = { w: 12, h: 7 };
const COW = { w: 22, h: 15 };
const PIGEON = { w: 8, h: 5 };

function crowSprite(): Sprite {
  const s = new Sprite(CROW.w, CROW.h);
  s.fill(2, 2, 4, 2, '#1e1e26', true);
  s.fill(5, 1, 2, 2, '#1e1e26', true);
  s.fill(1, 3, 2, 1, '#1e1e26', true);
  s.shade();
  s.put(4, 1, '#6d7480'); // grey neck
  s.put(6, 1, '#f1f3f5'); // eye
  s.put(7, 1, '#e8a317'); // beak
  return s;
}

function drawCrow(p: Painter, t: number): void {
  const hop = Math.max(0, Math.round(Math.sin(t / 140) * 2));
  const b = p.shifted(-hop);
  p.r(0, CROW.h, CROW.w, 1, SHADOW);
  b.paint(bake('crow', crowSprite));
  if (hop === 0) {
    p.r(3, 4, 1, 1, '#e8a317');
    p.r(4, 4, 1, 1, '#e8a317');
  }
  const flapUp = Math.floor(t / 90) % 2 === 0;
  if (flapUp) b.r(2, 1, 4, 1, '#2d2d36');
  else b.r(2, 3, 3, 1, '#2d2d36');
}

function dogSprite(): Sprite {
  const FUR = '#c2864e';
  const FUR_DARK = '#7a5230';
  const s = new Sprite(DOG.w, DOG.h);
  s.fill(2, 2, 7, 3, FUR, true); // body
  s.fill(7, 1, 3, 3, FUR, true); // head
  s.fill(9, 2, 2, 2, '#e0b48a', true); // muzzle
  s.fill(3, 2, 3, 2, FUR_DARK); // saddle patch
  s.fill(5, 4, 3, 1, '#f5ead8'); // white belly
  s.fill(7, 1, 1, 1, FUR_DARK); // ear
  s.shade();
  s.put(8, 2, INK); // eye
  s.put(10, 2, INK); // nose
  return s;
}

function drawDog(p: Painter, t: number): void {
  const FUR = '#c2864e';
  const FUR_DARK = '#7a5230';
  const phase = Math.floor(t / 110) % 2;
  const b = p.shifted(phase ? -1 : 0); // trot: the body bounces
  p.r(1, DOG.h, DOG.w - 2, 1, SHADOW);
  b.paint(bake('dog', dogSprite));
  // trotting legs: one diagonal pair planted while the other lifts
  const a = phase === 0 ? 2 : 1;
  const c = phase === 0 ? 1 : 2;
  p.r(3, 5, 1, a + 1, FUR_DARK);
  p.r(7, 5, 1, a + 1, FUR_DARK);
  p.r(4, 5, 1, c, FUR_DARK);
  p.r(8, 5, 1, c, FUR_DARK);
  // tail wagging up and down
  const wag = Math.floor(t / 130) % 2;
  b.r(1, 1 + wag, 2, 1, FUR);
  b.r(0, 1 + wag, 1, 1, FUR_DARK);
}

function cowSprite(): Sprite {
  const COW_BODY = '#f5f5f0';
  const SPOT = '#2b2b2b';
  const LEG = '#e9e4da';
  const s = new Sprite(COW.w, COW.h);
  s.fill(3, 4, 13, 5, COW_BODY, true); // body
  s.fill(9, 3, 4, 1, COW_BODY, true); // shoulder hump
  s.fill(14, 3, 3, 4, COW_BODY, true); // neck
  s.fill(16, 2, 5, 5, COW_BODY, true); // head
  s.fill(4, 9, 2, 4, LEG, true); // legs
  s.fill(7, 9, 2, 4, LEG, true);
  s.fill(12, 9, 2, 4, LEG, true);
  s.fill(15, 9, 2, 4, LEG, true);
  s.shade();
  s.fill(5, 4, 3, 3, SPOT); // black patches
  s.fill(11, 5, 2, 2, SPOT);
  s.fill(2, 4, 1, 5, SPOT); // tail
  s.fill(15, 3, 2, 1, SPOT); // ear
  s.fill(18, 2, 1, 1, '#e8590c'); // tilak
  s.fill(19, 5, 2, 2, '#f2b8b5'); // muzzle
  s.fill(4, 13, 2, 2, '#2b2b2b'); // hooves
  s.fill(7, 13, 2, 2, '#2b2b2b');
  s.fill(12, 13, 2, 2, '#2b2b2b');
  s.fill(15, 13, 2, 2, '#2b2b2b');
  s.put(17, 1, '#ddd6b8'); // horns
  s.put(20, 1, '#ddd6b8');
  s.put(18, 3, INK); // eye
  s.put(20, 5, INK); // nostril
  return s;
}

function drawCow(p: Painter, t: number): void {
  const chewing = Math.floor(t / 400) % 2 === 1;
  p.r(1, COW.h, COW.w - 2, 1, SHADOW);
  p.paint(bake('cow', cowSprite));
  // jaw working while chewing, bell swinging on the neck, tail swatting flies
  if (chewing) p.r(19, 7, 2, 1, INK);
  const bell = Math.floor(t / 300) % 2;
  p.r(14 + bell, 7, 1, 1, '#ffd43b');
  const swat = Math.floor(t / 600) % 2;
  p.r(1 + swat, 9, 1, 1, '#2b2b2b');
}

function pigeonSprite(): Sprite {
  const GREY = '#8a94a6';
  const s = new Sprite(PIGEON.w, PIGEON.h);
  s.fill(2, 2, 4, 2, GREY, true);
  s.fill(1, 2, 1, 2, '#5c6678');
  s.shade();
  s.put(6, 1, '#f1f3f5'); // eye ring
  s.put(7, 1, '#e0a040'); // beak
  return s;
}

function pigeonHead(): Sprite {
  const GREY = '#8a94a6';
  const s = new Sprite(PIGEON.w, PIGEON.h);
  s.fill(5, 1, 2, 2, GREY, true);
  s.shade();
  s.put(5, 2, '#4c6ef5'); // iridescent neck
  s.put(6, 1, INK);
  s.put(7, 1, '#e0a040');
  return s;
}

function drawPigeon(p: Painter, t: number): void {
  const pecking = Math.floor(t / 380) % 3 === 0;
  const flap = Math.floor(t / 100) % 2 === 1;
  const headDrop = pecking ? 2 : 0;
  p.r(1, PIGEON.h, PIGEON.w - 2, 1, SHADOW);
  p.paint(bake('pigeon:body', pigeonSprite));
  p.shifted(headDrop).paint(bake('pigeon:head', pigeonHead));
  p.r(3, 4, 1, 1, '#e0a040'); // legs
  p.r(5, 4, 1, 1, '#e0a040');
  // wing, raised on alternate flaps
  if (flap) p.r(2, 1, 3, 1, '#6c7a8d');
  else p.r(2, 3, 3, 1, '#6c7a8d');
}

/** A small roadside animal or bird with its feet at (x, y), animated from t. */
export function drawSmallProps(ctx: Ctx, prop: SmallProp, x: number, y: number, t: number, facing: Facing, px = 3): void {
  const size = prop === 'crow' ? CROW : prop === 'dog' ? DOG : prop === 'cow' ? COW : PIGEON;
  const p = new Painter(ctx, x, y, px, facing, size.w, size.h);
  switch (prop) {
    case 'crow': drawCrow(p, t); break;
    case 'dog': drawDog(p, t); break;
    case 'cow': drawCow(p, t); break;
    case 'pigeon': drawPigeon(p, t); break;
  }
}
