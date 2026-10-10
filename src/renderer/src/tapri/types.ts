// Shared vocabulary for the Tapri level (a chai-stall discussion scene — no agents).
// Pure types/constants only: safe to import from sprites, sim, UI and node tests.

/** What a patron's face + body language says about the talk they are hearing. */
export type Mood =
  | 'neutral'
  | 'interested' // leaning in, eyes wide, nodding
  | 'wow'        // mouth open, eyebrows up
  | 'confused'   // squint, one brow up, head tilt
  | 'sayAgain'   // cupped ear, "huh?"
  | 'hating'     // scowl, arms crossed
  | 'furious'    // red face, steam, shaking fist
  | 'laughing'
  | 'bored';

export const MOODS: readonly Mood[] = [
  'neutral', 'interested', 'wow', 'confused', 'sayAgain', 'hating', 'furious', 'laughing', 'bored',
];

/** Who a person is. Drives outfit. `me` is the user (shirt); `tapriwala` serves chai. */
export type Outfit =
  | 'me'         // plain shirt + trousers (the user)
  | 'tapriwala'  // chai seller: vest, gamchha on shoulder
  | 'baniyan'    // sleeveless vest + lungi/dhoti
  | 'dhoti'      // kurta-less: bare-ish torso w/ angvastra + white dhoti
  | 'kurta'      // long kurta + pyjama, topi optional
  | 'uncle'      // half-sleeve shirt, grey hair, specs
  | 'aunty'      // saree, bindi
  | 'student'    // tee + jeans + backpack
  | 'officegoer' // formal shirt, lanyard
  | 'cop'        // khaki uniform + cap
  | 'driver';    // auto/cab driver: khaki shirt

export const OUTFITS: readonly Outfit[] = [
  'me', 'tapriwala', 'baniyan', 'dhoti', 'kurta', 'uncle', 'aunty', 'student', 'officegoer', 'cop', 'driver',
];

export type Pose = 'sit' | 'stand' | 'walk';
export type Facing = 1 | -1; // 1 = faces right, -1 = faces left

export interface PersonStyle {
  outfit: Outfit;
  /** 0..n palette variant so two "kurta" patrons do not look identical. */
  variant: number;
}

export interface PersonDrawOpts {
  pose: Pose;
  facing: Facing;
  /** Free-running animation counter (ms). Sprites derive bob/walk/blink from it. */
  t: number;
  mood: Mood;
  /** True while the person is speaking (mouth moves, gestures). */
  talking?: boolean;
  /** Holds a chai glass (sits / stands only). */
  chai?: boolean;
  /** Screen px per sprite pixel. */
  px?: number;
}

export type VehicleKind = 'auto' | 'rickshaw' | 'car' | 'taxi' | 'bike' | 'scooter' | 'bus';
export const VEHICLE_KINDS: readonly VehicleKind[] = ['auto', 'rickshaw', 'car', 'taxi', 'bike', 'scooter', 'bus'];

export interface VehicleDrawOpts {
  facing: Facing;
  t: number;
  /** Screen px per sprite pixel. */
  px?: number;
  /** Variant for body colour. */
  variant?: number;
}

/** Minimal 2D context surface the sprite code relies on (lets node tests stub it). */
export type Ctx = Pick<CanvasRenderingContext2D,
  'fillRect' | 'fillStyle' | 'save' | 'restore' | 'translate' | 'scale' | 'globalAlpha' | 'strokeStyle' | 'lineWidth' | 'fillText' | 'font' | 'textAlign' | 'strokeRect'>;
