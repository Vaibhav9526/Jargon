# W7 QA — staffroom v2: typecheck + validate + offline render vs target

Date: 2026-10-08. Scope: read-only `src/`, artifacts in `tools/gen/staffroom-assets/qa/`.
Renderer: `qa/render_staffroom.py` (Python+PIL, extends `tools/mapgen/render_map.py`
with the `school-props` tileset @ firstgid 2449). Output `qa/staffroom-v2-render.png`
(1728×1152, 3×) + `qa/staffroom-v2-render-labels.png` (collision + spawn/zone overlay).
This file supersedes the previous run's COMPARE.md — the map was revised since
(spawn coords, atlas grew to 160 tiles, validator range now [2449,2608]).

## 1. Typecheck — PASS
- `npx tsc --noEmit -p tsconfig.json` → clean (solution file, builds both refs)
- `npx tsc --noEmit -p tsconfig.web.json` → clean
- `npx tsc --noEmit -p tsconfig.node.json` → clean (extra, not required)
- Bonus: `node test/staffroom-theme.test.cjs` → 2/2 pass

## 2. validate-map — PASS 7/7
`node tools/validate-map.cjs src/renderer/src/assets/maps/staffroom.tmj`:
JSON parses / 5 tilelayers × 864 / gids in [1,512]∪[513,1024]∪[1025,2448]∪[2449,2608] /
desk-ceo+entrance+6×pc (14 objects) / 3 zones / all spawn tiles collision-free /
layer set+order match.

## 3. Offline render — PASS
142 distinct gids, all in-range. school-props carries 918 tiles
(floor 714, furniture-below 129, furniture-above 75); walls still a5/interiors
(192); collision gid 1 ×318. Zone crops saved as `qa/crop-*.png`.

## 4. Layout match — PASS (spec v2 render, 1 note)
Verified in render + labeled overlay:
- Walls + bottom door gap x=17–18; top-wall mounts: clock {1,1}, calendar {5,1},
  green chalkboard x=16–19, bulletin board top-right, 4× 2-tile windows ✓
- Top band y=2–3: bookshelf x=1–2, plant, printer, globe, filing cabinets x=10–11,
  freestanding whiteboard x=13–14, plant x=25, bookshelf x=30–31,
  water cooler x=32, coffee counter x=33–34 ✓
- Meeting room top-left: glass/partition walls, table, 6 chairs, plant, "MEETING"
  sign; door gap right edge ✓ · zone rect {1,4,8,8} ✓
- Lounge bottom-left: green carpet, 4 couches w/ cafe-seat-1..4, coffee table,
  low bookshelf, 2 cabinets, vending + cafe-stand-vending {9,22}, "LOUNGE" sign ✓
  · zone {1,14,10,8} ✓
- Principal's office bottom-right: glass walls w/ left-edge door gap, wood floor,
  desk+PC, desk-ceo chair {30,19}, plant, bookshelf, "PRINCIPAL" sign ✓
  · zone {27,15,8,8} ✓
- Entrance: reception counter x=16–19,y=18, rug y=20, entrance {17,21} ✓
- Teacher corner pc-6 {32,9} w/ desk+PC + filing cabinet + plant ✓
- Lockers on left wall y=13, bins {14,21} + {24,16} ✓
- NOTE (unchanged from prior run): pc-1..5 spawn objects sit at a 3-over-2
  cluster — tiles {11,9},{17,9},{23,9},{14,13},{20,13} (half-tile px coords,
  floored by TiledMapRenderer) — NOT the v1 spec's single row {4,10,16,22,28},13.
  Chairs visibly sit under every marker and all five are collision-free, so it
  is self-consistent; the name contract (the only thing themeRegistry binds)
  is intact. Flagging for owner sign-off, not fixing.
- Seat-name cross-check vs STAFFROOM_THEME: all 14 spawn names match
  primarySeatNames + cafeSeatNames + cafeStands + entrance. Zero mismatches.

## 5. Art-style gap vs `staffroom-target.png`
The target (858×463) is a screenshot of the EXISTING office floor — the correct
style anchor per the STYLE CORRECTION, not a layout target. The v2 render matches
the flat pattern: flat saturated fills, dark 1px outlines, minimal shading,
16px-tile readability. Nothing painterly made it into the shipped atlas
(school-props is procedurally generated per the pivot, palette sampled from the
existing atlases).

What's still flat (i.e. unchanged existing-atlas content — by design):
wall band + windows (a5), cubicle/glass partitions (interiors), chairs, plants,
printer, globe, bins, collision gids.

Honest gaps:
- "Glass" room walls render as solid lavender cubicle panels — reads as
  partitions, not glass. Spec-sanctioned ("interiors glass/cubicle pieces") but
  it's the least convincing element vs a real staff room.
- Large bare-floor tracts: mid-floor right of the desk cluster (x=24–34, y=10–15)
  and the corridor band y=15–17 center. Walkable by spec, visually sparse vs the
  dense target office.
- The right-edge locker strip (x=34–35, y=5–9) and lone dark object at {33,10}
  read as filler; worth an owner look.
- `staffroom-target.png` itself is a stale v1 screenshot — misleading filename;
  it's a style anchor only.

Top 5 fixes (for owners — not applied):
1. Decide `src/renderer/src/assets/schoolsprites/` fate: dir does not exist —
   nothing references it (grep-clean). Either emit the sliced PNGs there or drop
   the path from the spec; characters currently ship via procedural recipes.
2. Delete stray `nul` file at repo root (Windows `> nul` artifact, untracked).
3. Rename/replace `staffroom-target.png` with a v2 screenshot or
   `flat-style-anchor.png` so future workers don't treat it as the look target.
4. If glass matters: swap partition gids for lighter interiors pieces, or drop
   every other partition tile on the door-gap edges for readability.
5. Optional density pass on the two bare-floor tracts (bench/rug/plant) — needs
   spec-owner sign-off, not a QA edit.

## 6. Sliced sprites `src/renderer/src/assets/schoolsprites/*.png` — GAP (literal) / PASS (functional)
- Directory does NOT exist; nothing in `src/` or `tools/` references it.
- Functional equivalent verified: `portraitArt.ts` ships 5 updated procedural
  recipes (new `stylePonytail` hair + `smirk` mouth added for topper; hoodie +
  sleepy eyes for smartguy). `qa/cast-sheet.png` + `cast-sheet-back.png`
  (dumped via `qa/dump-cast.cjs` from the live recipes) show 5 distinct,
  persona-correct characters front+back: stern suited principal w/ glasses,
  smiling cardigan teacher, ponytailed smirking topper, sleepy hoodie smartguy,
  bun+glasses librarian — all in the app's 18×32 flat style.
