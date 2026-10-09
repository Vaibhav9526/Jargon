// Theme registry — the pluggable "office theme" contract.
//
// Phase 0 of the TV-show-offices feature (card tvshow-phase0-abstraction):
// extract the ~40% of constants that were hard-coded inside OfficeFloor.tsx
// (errand spots, coffee-economy tile coords, prop anchors, seat names, tileset
// URLs, palette, monitor gids) into a ThemeConfig so the scene becomes
// swappable per show. This phase ships the EXISTING office unchanged as
// `theme: 'office'`: every value below is copied byte-for-byte from the old
// in-file literals, so the office renders and behaves identically.
//
// The engine (TiledMapRenderer / BFS pathfinding / Camera / sprite animation)
// is already fully generic and needs no change. cast.ts is read-only here
// (uncommitted human WIP) — the office theme references its existing exports.

import type { Texture } from 'pixi.js';
import { colors } from '@/design/tokens';
import {
  getCastFrames,
  castForTheme,
  DEFAULT_CHARACTER,
  type CastMember,
  type OfficeCharacterName,
} from './cast';

import officeTilesetUrl from '@/assets/tilesets/office-tileset.png?url';
import a5FloorsWallsUrl from '@/assets/tilesets/a5-office-floors-walls.png?url';
import interiorsUrl from '@/assets/tilesets/interiors.png?url';
import schoolPropsUrl from '@/assets/tilesets/school-props.png?url';
// .tmj is Tiled JSON; imported as raw text and parsed by the loader.
import officeMapRaw from '@/assets/maps/office.tmj?raw';
import brooklyn99MapRaw from '@/assets/maps/brooklyn99.tmj?raw';
import staffroomMapRaw from '@/assets/maps/staffroom.tmj?raw';
// "Modern" tileset: 32px art from EmakinaFR/office-map (see assets/ATTRIBUTION.md),
// built by tools/build-emakina-world.py. The meta file carries the generated gids.
import emakinaAtlasUrl from '@/assets/tilesets/emakina-atlas.png?url';
import officeModernMapRaw from '@/assets/maps/office-modern.tmj?raw';
import staffroomModernMapRaw from '@/assets/maps/staffroom-modern.tmj?raw';
import emakinaMeta from '@/assets/maps/emakina.meta.json';

/** Theme identifiers. Only `office` exists in Phase 0; the five TV-show themes
 *  (friends, brooklyn99, siliconvalley, got, hogwarts) land in later phases. */
export type ThemeId =
  | 'office'
  | 'friends'
  | 'brooklyn99'
  | 'siliconvalley'
  | 'got'
  | 'hogwarts'
  | 'staffroom';

export interface Tile { x: number; y: number; }
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Kinds of small idle errands around the office (incl. plant watering).
 *  'smoke' is the boss special: cigar at the open window, god only. */
export type ErrandKind =
  | 'water' | 'window' | 'dispenser' | 'fridge' | 'shelf' | 'bin' | 'smoke';

/** One idle-errand anchor: a stand tile + facing, an `fx` tile for the ambient
 *  animation, a duration, and an optional god-only restriction. */
export interface ErrandSpot {
  kind: ErrandKind;
  stand: Tile;
  facing: Facing;
  fx: Tile;
  duration: number;
  godOnly?: boolean;
}

/** One tileset atlas + its placement in the global gid space. `embedded` marks
 *  the atlas whose metadata already lives inline in the map's own `tilesets[0]`
 *  (the loader keeps the map's copy and only patches the appended atlases). */
export interface TilesetEntry {
  url: string;
  embedded?: boolean;
  firstgid?: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
}

/** Desk-monitor overlay gids. The map paints an OFF monitor block; DeskScreen
 *  overlays the matching ON tiles while the desk's agent is seated. */
export interface MonitorConfig {
  /** gid of the OFF monitor block's top-left tile, as painted in the map. */
  offTopLeftGid: number;
  /** Matching ON tiles as [gid, dx, dy] relative to the block's top-left. */
  onGids: ReadonlyArray<readonly [number, number, number]>;
  screenRect?: { x: number; y: number; w: number; h: number };
}

/** The coffee economy's fixed tiles: sideboard (mug rack) → counter machine →
 *  sink → back to the sideboard. `maxCups` caps the clean-mug stock. */
export interface CoffeeConfig {
  trayTile: Tile;
  trayStand: Tile;
  machineStand: Tile;
  machineTile?: Tile;
  sinkTile: Tile;
  sinkStand: Tile;
  maxCups: number;
}

/** Clickable prop anchors (tile coords). calendar → TRIGGERS, boards → TASKS,
 *  clock → CLOSING TIME. */
export interface AnchorConfig {
  calendar: Tile;
  boards: Tile;
  clock: Tile;
  questions?: Tile;
  boardStands?: { pin: Tile; take: Tile; archive: Tile };
}

/** Theme palette. `background` is the canvas clear color; `noteColors` are the
 *  kanban note colors keyed by task status. */
export interface PaletteConfig {
  background: number;
  noteColors: Record<string, number>;
}

/** Per-theme cast loader — the indirection point so a future show can swap its
 *  own roster + sprite frames. The office theme points at cast.ts's exports. */
export interface ThemeCast {
  byName: Record<string, CastMember>;
  getFrames: (name: string) => Promise<Texture[][]>;
  defaultCharacter: string;
}

/** The full contract a theme must supply. See report §A (theme contract). */
export interface ThemeConfig {
  id: ThemeId;
  /** Raw Tiled JSON text; parsed + tileset-patched by themeLoader. */
  mapRaw: string;
  /** Ordered atlases — order matches both the texture load order and the map's
   *  tileset array (texture[i] ↔ tilesets[i]). */
  tilesets: TilesetEntry[];
  /** Desk-claim order, by spawn-point name (seat 0 = god / desk-ceo). */
  primarySeatNames: string[];
  /** Paired café table seats, in order. */
  cafeSeatNames: string[];
  /** Café standing spots: [spawn-point name, kind]. */
  cafeStands: ReadonlyArray<readonly [string, 'coffee' | 'vending']>;
  coffee: CoffeeConfig;
  anchors: AnchorConfig;
  errandSpots: ErrandSpot[];
  monitor: MonitorConfig;
  palette: PaletteConfig;
  cast: ThemeCast;
}

/** The existing office, expressed as a theme. Values are copied verbatim from
 *  the former in-file constants in OfficeFloor.tsx / DeskScreen.ts. */
export const OFFICE_THEME: ThemeConfig = {
  id: 'office',
  mapRaw: officeMapRaw,
  tilesets: [
    // office-tileset.png — embedded in the map (firstgid 1); keep the map's copy.
    { url: officeTilesetUrl, embedded: true },
    { url: a5FloorsWallsUrl, firstgid: 513, image: 'a5', imagewidth: 256, imageheight: 512, tilewidth: 16, tileheight: 16, columns: 16, tilecount: 512 },
    { url: interiorsUrl, firstgid: 1025, image: 'interiors', imagewidth: 256, imageheight: 1424, tilewidth: 16, tileheight: 16, columns: 16, tilecount: 1424 },
  ],
  primarySeatNames: [
    'desk-ceo',
    'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5', 'pc-6',
    'desk-chief-architect', 'desk-product-manager', 'desk-team-lead',
    'desk-backend-engineer', 'desk-ui-ux-expert', 'desk-data-engineer',
    'desk-project-manager', 'desk-market-researcher', 'desk-agent-organizer',
  ],
  cafeSeatNames: ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
  cafeStands: [
    ['cafe-stand-coffee', 'coffee'],
    ['cafe-stand-vending', 'vending'],
  ],
  coffee: {
    trayTile: { x: 29, y: 15 },     // the sideboard (counter piece)
    trayStand: { x: 29, y: 16 },
    machineStand: { x: 26, y: 20 }, // below the counter machine
    sinkTile: { x: 28, y: 18 },     // free counter top, right end
    sinkStand: { x: 28, y: 20 },
    maxCups: 4,
  },
  anchors: {
    calendar: { x: 4, y: 1 },
    boards: { x: 6, y: 10 },
    clock: { x: 1, y: 1 },
  },
  errandSpots: [
    // plants (droplets ride on the character via startWatering)
    { kind: 'water', stand: { x: 2, y: 20 }, facing: 'left', fx: { x: 1, y: 20 }, duration: 4.5 },
    { kind: 'water', stand: { x: 22, y: 20 }, facing: 'right', fx: { x: 23, y: 20 }, duration: 4.5 },
    { kind: 'water', stand: { x: 30, y: 20 }, facing: 'right', fx: { x: 31, y: 20 }, duration: 4.5 },
    // the CEO office is the god's domain: its plant, window, cigar. Workers
    // never set foot in there for errands.
    { kind: 'water', stand: { x: 6, y: 4 }, facing: 'up', fx: { x: 6, y: 3 }, duration: 4.5, godOnly: true },
    { kind: 'smoke', stand: { x: 2, y: 3 }, facing: 'up', fx: { x: 2, y: 1 }, duration: 18, godOnly: true },
    { kind: 'water', stand: { x: 17, y: 4 }, facing: 'up', fx: { x: 17, y: 3 }, duration: 4.5 },
    // the two public wall windows — wind streaks drift into the room
    { kind: 'window', stand: { x: 10, y: 3 }, facing: 'up', fx: { x: 10, y: 1 }, duration: 5 },
    { kind: 'window', stand: { x: 15, y: 3 }, facing: 'up', fx: { x: 14, y: 1 }, duration: 5 },
    // water dispensers (hallway + the top-right corner one)
    { kind: 'dispenser', stand: { x: 16, y: 3 }, facing: 'down', fx: { x: 16, y: 4 }, duration: 3.5 },
    { kind: 'dispenser', stand: { x: 32, y: 4 }, facing: 'up', fx: { x: 32, y: 3 }, duration: 3.5 },
    // the café fridge (door light spills out) + the shelf beside it
    { kind: 'fridge', stand: { x: 29, y: 20 }, facing: 'up', fx: { x: 29, y: 19 }, duration: 3.2 },
    { kind: 'shelf', stand: { x: 30, y: 20 }, facing: 'up', fx: { x: 30, y: 18 }, duration: 4 },
    // garbage bins (entrance + café) — a paper ball arcs in
    { kind: 'bin', stand: { x: 18, y: 20 }, facing: 'left', fx: { x: 17, y: 20 }, duration: 2.6 },
    { kind: 'bin', stand: { x: 31, y: 16 }, facing: 'right', fx: { x: 32, y: 16 }, duration: 2.6 },
  ],
  monitor: {
    offTopLeftGid: 365,
    onGids: [
      [367, 0, 0], [368, 1, 0],
      [383, 0, 1], [384, 1, 1],
    ],
  },
  palette: {
    background: colors.ink[900],
    noteColors: { todo: 0xf2df8a, doing: 0x9ecbf0, blocked: 0xf0a3a3, done: 0xa8e0b0 },
  },
  cast: {
    byName: Object.fromEntries(castForTheme('office').map((member) => [member.name, member])),
    getFrames: (name: string) => getCastFrames(name as OfficeCharacterName),
    defaultCharacter: DEFAULT_CHARACTER,
  },
};

/** Brooklyn Nine-Nine — the 99th precinct (TV-show offices Phase 2, structure).
 *  The map (brooklyn99.tmj) is a precinct bullpen: Captain Holt's glass office
 *  in the back corner (`desk-ceo`), an 8-desk detective bullpen (`pc-1..8`), a
 *  briefing room (boardroom zone) + break room (cafeteria zone) with the coffee
 *  economy. PLACEHOLDER ART: the map reuses the office tileset gids, so the
 *  tilesets / monitor / palette / cast below reuse the office theme verbatim —
 *  Pam's license-clean B99 tileset + cast likenesses (§C/§D) drop into those
 *  same seams later. Only the layout-bound anchors (seats, café, coffee, props,
 *  errands) are authored to brooklyn99.tmj's own coordinates. */
export const BROOKLYN99_THEME: ThemeConfig = {
  id: 'brooklyn99',
  mapRaw: brooklyn99MapRaw,
  // PLACEHOLDER: brooklyn99.tmj uses the office gid space, so the same atlases
  // (office-tileset embedded @1, a5 @513, interiors @1025) resolve every tile.
  tilesets: OFFICE_THEME.tilesets,
  primarySeatNames: [
    'desk-ceo',                                            // Captain Holt's glass office
    'pc-1', 'pc-2', 'pc-3', 'pc-4',                        // bullpen — front row
    'pc-5', 'pc-6', 'pc-7', 'pc-8',                        // bullpen — back row
  ],
  cafeSeatNames: ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
  cafeStands: [
    ['cafe-stand-coffee', 'coffee'],
    ['cafe-stand-vending', 'vending'],
  ],
  coffee: {
    trayTile: { x: 33, y: 18 },
    trayStand: { x: 33, y: 19 },
    machineStand: { x: 30, y: 21 },
    sinkTile: { x: 31, y: 18 },
    sinkStand: { x: 31, y: 19 },
    maxCups: 4,
  },
  anchors: {
    calendar: { x: 4, y: 1 },   // briefing-room top wall → TRIGGERS
    boards: { x: 14, y: 1 },    // over the bullpen → TASKS
    clock: { x: 1, y: 1 },      // top-left corner → CLOSING TIME
  },
  // Placeholder errand anchors authored to brooklyn99.tmj's open floor (verified
  // walkable against the map's collision layer + desk stamps). The godOnly spots
  // sit inside Holt's glass office.
  errandSpots: [
    // public plants around the bullpen
    { kind: 'water', stand: { x: 2, y: 13 }, facing: 'left', fx: { x: 1, y: 13 }, duration: 4.5 },
    { kind: 'water', stand: { x: 24, y: 15 }, facing: 'right', fx: { x: 25, y: 15 }, duration: 4.5 },
    { kind: 'water', stand: { x: 13, y: 15 }, facing: 'down', fx: { x: 13, y: 16 }, duration: 4.5 },
    // Captain Holt's glass office — god's domain (plant + cigar at the window)
    { kind: 'water', stand: { x: 28, y: 6 }, facing: 'up', fx: { x: 28, y: 5 }, duration: 4.5, godOnly: true },
    { kind: 'smoke', stand: { x: 34, y: 2 }, facing: 'up', fx: { x: 34, y: 0 }, duration: 18, godOnly: true },
    // public windows on the north wall — wind streaks drift in
    { kind: 'window', stand: { x: 14, y: 1 }, facing: 'up', fx: { x: 14, y: 0 }, duration: 5 },
    { kind: 'window', stand: { x: 22, y: 1 }, facing: 'up', fx: { x: 22, y: 0 }, duration: 5 },
    // water dispensers (bullpen + entrance corridor)
    { kind: 'dispenser', stand: { x: 8, y: 15 }, facing: 'down', fx: { x: 8, y: 16 }, duration: 3.5 },
    { kind: 'dispenser', stand: { x: 17, y: 20 }, facing: 'down', fx: { x: 17, y: 21 }, duration: 3.5 },
    // break-room fridge + shelf (by the coffee economy)
    { kind: 'fridge', stand: { x: 29, y: 21 }, facing: 'up', fx: { x: 29, y: 20 }, duration: 3.2 },
    { kind: 'shelf', stand: { x: 34, y: 18 }, facing: 'up', fx: { x: 34, y: 17 }, duration: 4 },
    // garbage bins (entrance + break room)
    { kind: 'bin', stand: { x: 19, y: 20 }, facing: 'left', fx: { x: 18, y: 20 }, duration: 2.6 },
    { kind: 'bin', stand: { x: 34, y: 15 }, facing: 'up', fx: { x: 34, y: 14 }, duration: 2.6 },
  ],
  // PLACEHOLDER: brooklyn99.tmj paints the office desk stamp (monitor gid 365).
  monitor: OFFICE_THEME.monitor,
  // PLACEHOLDER: office palette + cast until Pam's B99 art (§C/§D) lands.
  palette: OFFICE_THEME.palette,
  cast: OFFICE_THEME.cast,
};

/** Staff Room — the school floor.
 *  The map (staffroom.tmj) is a school staff room: the Principal's glass office
 *  bottom-right (`desk-ceo`), a student desk row mid-floor (`pc-1..5`), the
 *  teacher's corner top-right (`pc-6`), a lounge (cafeteria zone) + meeting
 *  room (boardroom zone) with the coffee economy. The map uses the office
 *  gid space plus the generated school-props atlas (firstgid 2449), so
 *  monitor / palette / cast reuse OFFICE_THEME verbatim while tilesets
 *  appends the school atlas; only the layout-bound anchors (seats, café,
 *  coffee, props, errands) are authored to staffroom.tmj's own coordinates. */
export const STAFFROOM_THEME: ThemeConfig = {
  id: 'staffroom',
  mapRaw: staffroomMapRaw,
  tilesets: [
    // school-props.png — generated school prop atlas (16×16 cells, 128 tiles).
    { url: schoolPropsUrl, firstgid: 2449, image: 'school-props', imagewidth: 256, imageheight: 512, tilewidth: 16, tileheight: 16, columns: 16, tilecount: 512 },
  ],
  primarySeatNames: [
    'desk-ceo',                                            // Principal's office
    'pc-1', 'pc-2', 'pc-3', 'pc-4', 'pc-5',                // student desk row
    'pc-6',                                                // teacher's corner
  ],
  cafeSeatNames: ['cafe-seat-1', 'cafe-seat-2', 'cafe-seat-3', 'cafe-seat-4'],
  cafeStands: [
    ['cafe-stand-coffee', 'coffee'],
    ['cafe-stand-vending', 'vending'],
  ],
  coffee: {
    trayTile: { x: 17, y: 3 },    // coffee counter, top-right band
    trayStand: { x: 17, y: 5 },
    machineStand: { x: 14, y: 5 },
    machineTile: { x: 14, y: 3 },
    sinkTile: { x: 20, y: 3 },    // water cooler end of the band
    sinkStand: { x: 20, y: 5 },
    maxCups: 4,
  },
  anchors: {
    calendar: { x: 23, y: 0 },   // top wall → TRIGGERS
    boards: { x: 24, y: 1 },    // the green chalkboard → TASKS
    clock: { x: 3, y: 0 },      // top-left corner → CLOSING TIME
    questions: { x: 31, y: 1 },
    boardStands: { pin: { x: 25, y: 2 }, take: { x: 27, y: 2 }, archive: { x: 29, y: 2 } },
  },
  errandSpots: [
    // public plants (top band, meeting room, lounge)
    { kind: 'water', stand: { x: 26, y: 4 }, facing: 'right', fx: { x: 27, y: 4 }, duration: 4.5 },
    { kind: 'water', stand: { x: 9, y: 9 }, facing: 'down', fx: { x: 9, y: 11 }, duration: 4.5 },
    { kind: 'water', stand: { x: 11, y: 17 }, facing: 'left', fx: { x: 10, y: 17 }, duration: 4.5 },
    // the Principal's office — god's domain (plant + cigar at the window)
    { kind: 'water', stand: { x: 36, y: 6 }, facing: 'right', fx: { x: 37, y: 6 }, duration: 4.5, godOnly: true },
    // public windows on the north wall — wind streaks drift in
    { kind: 'window', stand: { x: 6, y: 2 }, facing: 'up', fx: { x: 6, y: 1 }, duration: 5 },
    { kind: 'window', stand: { x: 11, y: 2 }, facing: 'up', fx: { x: 11, y: 1 }, duration: 5 },
    // water cooler in the top band
    { kind: 'dispenser', stand: { x: 23, y: 5 }, facing: 'up', fx: { x: 23, y: 4 }, duration: 3.5 },
    // lounge vending machine + low bookshelf
    { kind: 'fridge', stand: { x: 8, y: 24 }, facing: 'right', fx: { x: 9, y: 25 }, duration: 3.2 },
    { kind: 'shelf', stand: { x: 5, y: 15 }, facing: 'right', fx: { x: 6, y: 15 }, duration: 4 },
    // garbage bins (entrance + mid-floor)
    { kind: 'bin', stand: { x: 12, y: 24 }, facing: 'down', fx: { x: 12, y: 25 }, duration: 2.6 },
    { kind: 'bin', stand: { x: 36, y: 25 }, facing: 'right', fx: { x: 37, y: 25 }, duration: 2.6 },
  ],
  monitor: { offTopLeftGid: 2526, onGids: [[2527, 0, 0]], screenRect: { x: 3, y: 3, w: 10, h: 6 } },
  palette: { ...OFFICE_THEME.palette, background: 0x27372f },
  cast: {
    ...OFFICE_THEME.cast,
    byName: Object.fromEntries(castForTheme('staffroom').map((member) => [member.name, member])),
    defaultCharacter: 'teacher',
  },
};

// ─── Modern tileset (Emakina art) ───────────────────────────────────────────
// Same theme ids and the same cast / seat / zone contract as the classic floors;
// only the map and art change. The maps are laid out on the engine's 16-unit grid
// with one 32px art tile per cell (the renderer scales it to the grid), so
// characters, speeds and effects keep their proportions.
//
// Everything tied to the layout — the coffee-economy tiles, the clickable
// anchors and the idle-errand spots — is emitted by the generator into
// emakina.meta.json next to the maps, so it can never drift from the art.

/** One floor's layout-bound data, as written by tools/build-emakina-world.py. */
interface EmakinaFloorMeta {
  width: number;
  height: number;
  seats: string[];
  coffee: { trayTile: Tile; trayStand: Tile; machineTile: Tile; machineStand: Tile; sinkTile: Tile; sinkStand: Tile };
  anchors: {
    calendar: Tile;
    boards: Tile;
    clock: Tile;
    questions?: Tile;
    boardPin?: Tile;
    boardTake?: Tile;
    boardArchive?: Tile;
  };
  errands: ErrandSpot[];
}
interface EmakinaMeta {
  monitorOff: number;
  monitorOn: number;
  office: EmakinaFloorMeta;
  school: EmakinaFloorMeta;
}

// JSON imports widen string literals (`facing`, `kind`) to string; the
// generator only ever writes the ErrandKind / Facing values.
const E = emakinaMeta as unknown as EmakinaMeta;
const EMAKINA_TILESETS: TilesetEntry[] = [{ url: emakinaAtlasUrl, embedded: true }];
const EMAKINA_MONITOR: MonitorConfig = {
  offTopLeftGid: E.monitorOff,
  // one 32px monitor per desk; its screen in 16-unit cell coordinates
  onGids: [[E.monitorOn, 0, 0]],
  screenRect: { x: 2, y: 2, w: 12, h: 7 },
};

function modernCoffee(floor: EmakinaFloorMeta): CoffeeConfig {
  return { ...floor.coffee, maxCups: 4 };
}

function modernAnchors(floor: EmakinaFloorMeta): AnchorConfig {
  const { calendar, boards, clock, questions, boardPin, boardTake, boardArchive } = floor.anchors;
  return {
    calendar,
    boards,
    clock,
    ...(questions ? { questions } : {}),
    ...(boardPin && boardTake && boardArchive ? { boardStands: { pin: boardPin, take: boardTake, archive: boardArchive } } : {}),
  };
}

/** The Office floor on the modern tileset: CEO office, meeting room and café
 *  along the top, 15 individual desks in the open plan, a reception lounge by
 *  the front door. */
export const OFFICE_MODERN_THEME: ThemeConfig = {
  ...OFFICE_THEME,
  mapRaw: officeModernMapRaw,
  tilesets: EMAKINA_TILESETS,
  coffee: modernCoffee(E.office),
  anchors: modernAnchors(E.office),
  errandSpots: E.office.errands,
  monitor: EMAKINA_MONITOR,
};

/** The School floor on the modern tileset: classroom with chalkboard, task
 *  boards and a reading corner; principal's office; teacher's room + library;
 *  staff-room café; meeting room. */
export const STAFFROOM_MODERN_THEME: ThemeConfig = {
  ...STAFFROOM_THEME,
  mapRaw: staffroomModernMapRaw,
  tilesets: EMAKINA_TILESETS,
  coffee: modernCoffee(E.school),
  anchors: modernAnchors(E.school),
  errandSpots: E.school.errands,
  monitor: EMAKINA_MONITOR,
};

/** Which art a floor is drawn with. 'classic' is the original LimeZu-based set. */
export type TilesetStyle = 'classic' | 'modern';
export const TILESET_STYLES: readonly TilesetStyle[] = ['classic', 'modern'];

const MODERN_THEMES: Partial<Record<ThemeId, ThemeConfig>> = {
  office: OFFICE_MODERN_THEME,
  staffroom: STAFFROOM_MODERN_THEME,
};

/** All registered themes. Phase 0 ships only the office; show themes register
 *  here as their content lands (Phase 2). */
export const THEMES: Partial<Record<ThemeId, ThemeConfig>> = {
  office: OFFICE_THEME,
  brooklyn99: BROOKLYN99_THEME,
  staffroom: STAFFROOM_THEME,
};

/** Look up a theme by id, falling back to the office theme if unknown/missing
 *  (a bad/absent show bundle must never break the floor — see report §E). */
export function getTheme(id: ThemeId, style: TilesetStyle = 'classic'): ThemeConfig {
  if (style === 'modern') {
    const modern = MODERN_THEMES[id];
    if (modern) return modern;   // themes without a modern floor keep their classic art
  }
  return THEMES[id] ?? OFFICE_THEME;
}
