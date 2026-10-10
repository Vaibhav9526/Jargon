// Tapri world simulation — pure state + tick, no canvas, no React, no IPC.
// Coordinates are in the 1600x900 reference frame of the backdrop (assets/tapri/tapri-bg.png).
// Everything random goes through `world.rng`, so tests can seed a whole afternoon.
import type { Facing, Mood, Pose, PersonStyle, VehicleKind } from './types';

export const W = 1600;
export const H = 1020;

/** Pavement lane people walk along (feet y) and the kerb gap they step down at. */
export const WALK_Y = 640;
export const KERB_Y = 700;
/** Road lanes (tyre y). Left-hand traffic seen from the pavement: near lane runs east. */
export const LANE_NEAR = 835;
export const LANE_FAR = 985;

export interface Pt { x: number; y: number }

export interface Seat extends Pt {
  id: string;
  facing: Facing;
  /** Pavement x this seat is entered from. */
  approachX: number;
}

const seat = (id: string, x: number, y: number, facing: Facing, approachX = x): Seat => ({ id, x, y, facing, approachX });

export const ME_SEAT = seat('me', 787, 606, 1, 770);

/** Free seats, listed roughly nearest-to-the-user first so a small crowd clusters round them. */
export const SEATS: readonly Seat[] = [
  seat('a-front', 888, 628, -1),
  seat('a-right', 1024, 584, -1, 1040),
  seat('b-fl', 1168, 620, -1),
  seat('b-fr', 1238, 614, -1),
  seat('l-t', 563, 454, -1, 580),
  seat('l-s', 520, 536, 1, 520),
  seat('l-s2', 548, 544, -1, 548),
  seat('c-l', 1385, 596, 1),
  seat('c-r', 1486, 622, -1),
  seat('d-l', 1388, 432, 1, 1370),
  seat('d-r', 1475, 448, -1, 1500),
  seat('l-0', 165, 460, 1),
  seat('l-c', 180, 554, 1),
  seat('l-6', 610, 488, -1, 620),
  seat('l-1', 222, 552, 1),
  seat('l-2', 252, 558, 1),
];

export interface StandSpot extends Pt { id: string; facing: Facing }
/** Kerb-side spots where people wait for a cab and still join in. */
export const STAND_SPOTS: readonly StandSpot[] = [
  { id: 'k1', x: 700, y: 652, facing: 1 },
  { id: 'k2', x: 945, y: 654, facing: -1 },
  { id: 'k3', x: 1100, y: 652, facing: -1 },
  { id: 'k4', x: 1310, y: 654, facing: -1 },
];

/** The chai-wala stands behind the counter; the scene clips his legs at CLIP_Y. */
export const OWNER_POS: Pt = { x: 1124, y: 420 };
export const OWNER_CLIP_Y = 402;

export type PersonMode = 'seated' | 'standing' | 'walking' | 'hidden';
export type OnArrive = 'sit' | 'stand' | 'despawn' | 'board' | 'none';

export interface Person {
  id: string;
  name: string;
  style: PersonStyle;
  /** Whether this person belongs to the conversation (vs. a passer-by). */
  role: 'me' | 'owner' | 'patron' | 'passer';
  x: number; y: number;
  facing: Facing;
  pose: Pose;
  mode: PersonMode;
  mood: Mood;
  moodUntil: number;
  baseMood: Mood;
  talking: boolean;
  chai: boolean;
  path: Pt[];
  speed: number;
  onArrive: OnArrive;
  arriveFacing: Facing;
  seatId?: string;
  standId?: string;
  anger: number;
  say?: { text: string; until: number };
  /** Cab this person is waiting to board. */
  cabId?: string;
  /** True once they are on their way out (no more chat). */
  leaving: boolean;
}

export type VehicleState = 'driving' | 'stopped' | 'leaving';

export interface Vehicle {
  id: string;
  kind: VehicleKind;
  variant: number;
  x: number; y: number;
  facing: Facing;
  speed: number;
  cruise: number;
  state: VehicleState;
  stopX?: number;
  waited: number;
  /** Person stepping out when this vehicle stops. */
  drop?: string;
  /** Person waiting to climb in. */
  pickup?: string;
}

export type PropKind = 'crow' | 'dog' | 'cow' | 'pigeon';
export interface Prop { id: string; kind: PropKind; x: number; y: number; facing: Facing; speed: number; until: number }

export interface World {
  t: number;
  rng: () => number;
  people: Person[];
  vehicles: Vehicle[];
  props: Prop[];
  nextId: number;
  nextWalker: number;
  nextVehicle: number;
  nextProp: number;
  /** Set false in tests that want a quiet street. */
  ambient: boolean;
}

/** Small deterministic PRNG (mulberry32) for seeded worlds. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PASSER_OUTFITS: PersonStyle['outfit'][] = ['student', 'officegoer', 'kurta', 'uncle', 'aunty', 'baniyan', 'dhoti'];
const WALK_VEHICLES: VehicleKind[] = ['auto', 'auto', 'rickshaw', 'car', 'car', 'bike', 'scooter', 'taxi', 'bus'];
const PROPS: PropKind[] = ['crow', 'dog', 'pigeon', 'cow'];

const pick = <T,>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length) % xs.length];
const between = (rng: () => number, a: number, b: number): number => a + rng() * (b - a);

function newId(w: World, p: string): string { return `${p}${w.nextId++}`; }

function blankPerson(w: World, over: Partial<Person> & Pick<Person, 'name' | 'style' | 'role' | 'x' | 'y'>): Person {
  return {
    id: newId(w, 'p'), facing: 1, pose: 'stand', mode: 'standing', mood: 'neutral', moodUntil: 0, baseMood: 'neutral',
    talking: false, chai: false, path: [], speed: 70, onArrive: 'none', arriveFacing: 1, anger: 0, leaving: false,
    ...over,
  };
}

export function createWorld(seed = 1, opts: { ambient?: boolean } = {}): World {
  const w: World = {
    t: 0, rng: seededRng(seed), people: [], vehicles: [], props: [], nextId: 1,
    nextWalker: 2500, nextVehicle: 1200, nextProp: 9000, ambient: opts.ambient ?? true,
  };
  w.people.push(blankPerson(w, {
    id: 'me', name: 'Vaibhav', style: { outfit: 'me', variant: 0 }, role: 'me',
    x: ME_SEAT.x, y: ME_SEAT.y, facing: ME_SEAT.facing, pose: 'sit', mode: 'seated', chai: true, seatId: ME_SEAT.id,
  }));
  w.people.push(blankPerson(w, {
    id: 'chhotu', name: 'Chhotu', style: { outfit: 'tapriwala', variant: 0 }, role: 'owner',
    x: OWNER_POS.x, y: OWNER_POS.y, facing: -1, pose: 'stand', mode: 'standing',
  }));
  return w;
}

export const personById = (w: World, id: string): Person | undefined => w.people.find((p) => p.id === id);

/* ── seating ──────────────────────────────────────────────────────────────── */

export function seatTaken(w: World, id: string): boolean {
  return w.people.some((p) => p.seatId === id && !p.leaving);
}

function freeSeat(w: World): Seat | undefined {
  // Keep a body-width of air between neighbours: sprites are ~56px wide.
  const taken = [ME_SEAT, ...SEATS].filter((s) => seatTaken(w, s.id) || s.id === ME_SEAT.id);
  const free = SEATS.filter((s) => !seatTaken(w, s.id) && taken.every((t) => Math.hypot(t.x - s.x, (t.y - s.y) * 1.6) > 80));
  // Mostly near the user, occasionally further out, so the crowd does not look scripted.
  const pool = free.slice(0, w.rng() < 0.55 ? 4 : free.length);
  return pool.length ? pick(w.rng, pool) : undefined;
}

function freeStand(w: World): StandSpot | undefined {
  const free = STAND_SPOTS.filter((s) => !w.people.some((p) => p.standId === s.id && !p.leaving));
  return free.length ? pick(w.rng, free) : undefined;
}

export type ArrivalKind = 'walk' | 'auto' | 'cab-waiter';

/** Number of people currently part of the chat (excluding the user and the chai-wala). */
export function patronCount(w: World): number {
  return w.people.filter((p) => p.role === 'patron' && !p.leaving).length;
}

/**
 * Bring a character to the tapri. Returns null if there is nowhere for them to sit/stand.
 * `how` defaults to a random pick: walk in from the road edge, hop out of an auto, or
 * drift up while "waiting for a cab" and join the talk on their feet.
 */
export function spawnPatron(
  w: World, c: { id: string; name: string; style: PersonStyle }, how?: ArrivalKind,
): Person | null {
  if (personById(w, c.id)) return null;
  const kind: ArrivalKind = how ?? pick(w.rng, ['walk', 'auto', 'auto', 'cab-waiter'] as const);
  const standing = kind === 'cab-waiter';
  const seat = standing ? undefined : freeSeat(w);
  const spot = standing ? freeStand(w) : undefined;
  if (!seat && !spot) {
    // Fall back: a full table means they lean at the kerb instead.
    const alt = freeStand(w);
    if (!alt) return null;
    return spawnPatron(w, c, 'cab-waiter');
  }
  const goal = seat ?? spot!;
  const approachX = seat ? seat.approachX : spot!.x;
  const p = blankPerson(w, {
    id: c.id, name: c.name, style: c.style, role: 'patron',
    x: 0, y: WALK_Y, chai: w.rng() < 0.7,
    seatId: seat?.id, standId: spot?.id,
    onArrive: seat ? 'sit' : 'stand',
    arriveFacing: seat ? seat.facing : spot!.facing,
    speed: between(w.rng, 62, 84),
  });
  const final: Pt[] = seat
    ? [{ x: approachX, y: WALK_Y }, { x: seat.x, y: seat.y }]
    : [{ x: spot!.x, y: spot!.y }];

  if (kind === 'auto') {
    const vehicle: Vehicle = {
      id: newId(w, 'v'), kind: pick(w.rng, ['auto', 'auto', 'taxi', 'rickshaw'] as const), variant: Math.floor(w.rng() * 4),
      x: -600, y: LANE_NEAR, facing: 1, speed: 190, cruise: 190, state: 'driving',
      stopX: Math.max(180, approachX - 40), waited: 0, drop: p.id,
    };
    p.mode = 'hidden';
    p.x = vehicle.stopX!; p.y = KERB_Y;
    p.path = [{ x: approachX, y: WALK_Y }, ...final.slice(final.length > 1 ? 1 : 0)];
    // Step off the kerb straight onto the pavement lane, then to the seat.
    p.path = [{ x: vehicle.stopX! + 20, y: WALK_Y + 8 }, ...final];
    w.vehicles.push(vehicle);
  } else {
    const fromLeft = approachX < W / 2 ? w.rng() < 0.7 : w.rng() < 0.3;
    p.x = fromLeft ? -60 : W + 60;
    p.path = [{ x: approachX, y: WALK_Y }, ...(final.length > 1 ? final.slice(1) : final)];
    p.mode = 'walking'; p.pose = 'walk';
  }
  void goal;
  w.people.push(p);
  return p;
}

/** Make someone stand up and go: on foot to the nearest edge, or into a cab at the kerb. */
export function sendAway(w: World, id: string, how: 'walk' | 'cab' = 'walk'): boolean {
  const p = personById(w, id);
  if (!p || p.leaving || p.role !== 'patron') return false;
  p.leaving = true;
  p.talking = false;
  p.say = undefined;
  p.chai = false;
  p.seatId = undefined;
  p.standId = undefined;
  p.pose = 'walk'; p.mode = 'walking';
  p.speed = 95;
  if (how === 'cab') {
    const kerbX = Math.min(W - 220, Math.max(220, p.x));
    const cab: Vehicle = {
      id: newId(w, 'v'), kind: 'taxi', variant: Math.floor(w.rng() * 4), x: -600, y: LANE_NEAR, facing: 1,
      speed: 200, cruise: 200, state: 'driving', stopX: kerbX, waited: 0, pickup: p.id,
    };
    p.cabId = cab.id;
    p.path = [{ x: kerbX, y: WALK_Y + 6 }, { x: kerbX, y: KERB_Y }];
    p.onArrive = 'board';
    w.vehicles.push(cab);
  } else {
    const left = p.x < W / 2;
    p.path = [{ x: p.x, y: WALK_Y }, { x: left ? -90 : W + 90, y: WALK_Y }];
    p.onArrive = 'despawn';
  }
  return true;
}

/* ── mood / anger ─────────────────────────────────────────────────────────── */

export const ANGER_LIMIT = 4;

/** Set a mood for a while. Returns true when the person is now angry enough to leave. */
export function react(w: World, id: string, mood: Mood, ms = 3600, trackAnger = true): boolean {
  const p = personById(w, id);
  if (!p || p.leaving || p.role === 'passer') return false;
  p.mood = mood;
  p.moodUntil = w.t + ms;
  if (p.role !== 'patron' || !trackAnger) return false;
  if (mood === 'furious') p.anger += 2;
  else if (mood === 'hating') p.anger += 1;
  else p.anger = Math.max(0, p.anger - 0.5);
  return p.anger >= ANGER_LIMIT;
}

export function say(w: World, id: string, text: string, ms: number): void {
  const p = personById(w, id);
  if (!p) return;
  p.say = { text, until: w.t + ms };
  p.talking = true;
}

export function stopSaying(w: World, id: string): void {
  const p = personById(w, id);
  if (!p) return;
  p.talking = false;
  p.say = undefined;
}

/* ── tick ─────────────────────────────────────────────────────────────────── */

export function tick(w: World, dtMs: number): void {
  const dt = Math.min(dtMs, 100); // a backgrounded tab must not teleport everyone
  w.t += dt;
  const sec = dt / 1000;

  for (const p of w.people) {
    if (p.mood !== p.baseMood && w.t > p.moodUntil) p.mood = p.baseMood;
    if (p.say && w.t > p.say.until) { p.say = undefined; p.talking = false; }
    if (p.mode === 'hidden') {
      // Wait for the vehicle that brought them to stop.
      const v = w.vehicles.find((x) => x.drop === p.id);
      if (!v) { p.mode = 'walking'; p.pose = 'walk'; }
      else if (v.state === 'stopped') { p.mode = 'walking'; p.pose = 'walk'; v.drop = undefined; v.waited = 0; }
      continue;
    }
    if (!p.path.length) continue;
    const next = p.path[0];
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * sec;
    if (dist <= step) {
      p.x = next.x; p.y = next.y;
      p.path.shift();
      if (!p.path.length) arrive(w, p);
    } else {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
      if (Math.abs(dx) > 1) p.facing = dx > 0 ? 1 : -1;
    }
  }
  w.people = w.people.filter((p) => !(p.mode === 'hidden' && p.leaving)); // boarded riders are gone

  tickVehicles(w, sec);
  if (w.ambient) spawnAmbient(w);
  w.props = w.props.filter((pr) => w.t < pr.until);
  for (const pr of w.props) pr.x += pr.facing * pr.speed * sec;
}

function arrive(w: World, p: Person): void {
  switch (p.onArrive) {
    case 'sit':
      p.pose = 'sit'; p.mode = 'seated'; p.facing = p.arriveFacing; break;
    case 'stand':
      p.pose = 'stand'; p.mode = 'standing'; p.facing = p.arriveFacing; break;
    case 'despawn':
      w.people = w.people.filter((x) => x !== p); break;
    case 'board': {
      const cab = w.vehicles.find((v) => v.id === p.cabId);
      if (cab && cab.state === 'stopped') { cab.pickup = undefined; cab.state = 'leaving'; w.people = w.people.filter((x) => x !== p); }
      else { p.pose = 'stand'; p.mode = 'standing'; p.facing = 1; p.onArrive = 'board'; } // cab not here yet: wait
      break;
    }
    default:
      p.pose = 'stand'; p.mode = 'standing';
  }
  p.onArrive = p.onArrive === 'board' && p.mode === 'standing' ? 'board' : 'none';
}

function tickVehicles(w: World, sec: number): void {
  for (const v of w.vehicles) {
    const dir = v.facing;
    if (v.state === 'stopped') {
      v.speed = 0;
      v.waited += sec * 1000;
      const holdFor = v.pickup ? 14000 : 1400;
      // A cab waits for its rider, then moves on regardless.
      if (!v.drop && (v.waited > holdFor)) { v.state = 'leaving'; }
      // A rider standing at the kerb while the cab is here boards via arrive().
      const rider = v.pickup ? personById(w, v.pickup) : undefined;
      if (rider && rider.mode === 'standing' && Math.abs(rider.x - v.x) < 40) {
        rider.path = [{ x: v.x, y: v.y - 40 }]; rider.onArrive = 'board'; rider.mode = 'walking'; rider.pose = 'walk';
      }
      continue;
    }
    let target = v.state === 'leaving' ? v.cruise : v.cruise;
    // Slow for a stopping point.
    if (v.stopX !== undefined && v.state === 'driving') {
      const remaining = (v.stopX - v.x) * dir;
      if (remaining <= 2) { v.x = v.stopX; v.state = 'stopped'; v.speed = 0; v.waited = 0; continue; }
      target = Math.min(target, Math.max(34, remaining * 1.7));
    }
    // Follow the vehicle ahead in the same lane.
    for (const o of w.vehicles) {
      if (o === v || o.y !== v.y || o.facing !== dir) continue;
      const gap = (o.x - v.x) * dir;
      if (gap > 0 && gap < 540) target = Math.min(target, o.state === 'stopped' ? Math.max(0, (gap - 460) * 1.5) : o.speed);
    }
    v.speed += (target - v.speed) * Math.min(1, sec * 4);
    v.x += dir * v.speed * sec;
    if (v.state === 'leaving') v.stopX = undefined;
  }
  w.vehicles = w.vehicles.filter((v) => v.x > -900 && v.x < W + 900);
}

function spawnAmbient(w: World): void {
  const rng = w.rng;
  if (w.t >= w.nextWalker && w.people.filter((q) => q.role === 'passer').length < 2) {
    w.nextWalker = w.t + between(rng, 12000, 26000);
    const fromLeft = rng() < 0.5;
    const outfit = pick(rng, PASSER_OUTFITS);
    const y = between(rng, 628, 668);
    w.people.push(blankPerson(w, {
      name: '', style: { outfit, variant: Math.floor(rng() * 4) }, role: 'passer',
      x: fromLeft ? -50 : W + 50, y, facing: fromLeft ? 1 : -1, pose: 'walk', mode: 'walking',
      speed: between(rng, 48, 92),
      path: [{ x: fromLeft ? W + 80 : -80, y: y + between(rng, -6, 6) }], onArrive: 'despawn',
    }));
  }
  if (w.t >= w.nextVehicle) {
    w.nextVehicle = w.t + between(rng, 1400, 3800);
    const near = rng() < 0.5;
    const lane = near ? LANE_NEAR : LANE_FAR;
    const dir: Facing = near ? 1 : -1;
    const startX = near ? -600 : W + 600;
    const clear = !w.vehicles.some((v) => v.y === lane && Math.abs(v.x - startX) < 760);
    if (clear) {
      const kind = pick(rng, WALK_VEHICLES);
      const cruise = kind === 'bus' ? between(rng, 110, 150) : kind === 'bike' || kind === 'scooter' ? between(rng, 210, 300) : between(rng, 140, 240);
      w.vehicles.push({
        id: newId(w, 'v'), kind, variant: Math.floor(rng() * 4), x: startX, y: lane, facing: dir,
        speed: cruise, cruise, state: 'driving', waited: 0,
      });
    }
  }
  if (w.t >= w.nextProp) {
    w.nextProp = w.t + between(rng, 12000, 30000);
    const kind = pick(rng, PROPS);
    const left = rng() < 0.5;
    const stay = kind === 'cow';
    w.props.push({
      id: newId(w, 'a'), kind, x: stay ? between(rng, 300, 1300) : left ? -40 : W + 40,
      y: kind === 'cow' ? 676 : between(rng, 662, 676), facing: left ? 1 : -1,
      speed: kind === 'cow' ? 0 : kind === 'dog' ? 70 : kind === 'crow' ? 34 : 26,
      until: w.t + (stay ? 26000 : 40000),
    });
  }
}
