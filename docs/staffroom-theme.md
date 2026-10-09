# The Staff Room theme — a school floor for the agent office

The office floor is a **theme**, not a scene. `office`, `brooklyn99` and now
**`staffroom`** are three different maps and casts behind one renderer, swapped from
**Settings → Office Theme**. `staffroom` is the school staff room: a chalkboard, a
meeting room, a student desk row, a lounge with couches, and a glass-walled
principal's office — and a cast of five school characters instead of the
*Office* parody.

Nothing about the engine is school-aware. A theme is a `.tmj` map plus a
`ThemeConfig`, and the floor gets its behaviour from real hook events either way:
agents still sit at desks, still fly envelopes, still steal mugs from a four-cup
rack, and still walk to the door and flash `!` when they need you.

---

## The five

An agent's sprite is picked from its `character` field, falling back to its **name
lowercased** matched against the cast — so an agent literally named "Topper" or
"Smart Guy" gets the right avatar with no configuration at all. Set `character`
explicitly when you rename one.

| Character | Persona |
|---|---|
| **Principal** | Runs the floor. Stern but fair, slightly dramatic authority; keeps every teacher and student on task. Occupies the boss seat (`desk-ceo`). |
| **Teacher** | A patient educator. Explains step by step, checks understanding, assigns small exercises, never talks down. |
| **Topper** | Brilliant and knows it. When asked a doubt she flaunts first — acts like the question is beneath her, name-drops being top of the class, gets a little jealous if you managed without her — then still hands over a technically perfect answer wrapped in snark and superiority. Mean-girl energy, never crude, always right. |
| **Smart Guy** | A lazy genius. Too lazy for lectures; instead drops tricks, shortcuts and mental models: how to think, how to crack the question. Chill, friendly, good-person energy, great brain, zero-effort aesthetic. |
| **Librarian** | A quiet custodian. Shushes you if you're loud, knows where everything lives, and always answers with references — books, docs, sources — plus a suggestion for what to read next. |

The cast is drawn procedurally in
[`scene/office/portraitArt.ts`](../src/renderer/src/scene/office/portraitArt.ts)
from per-character recipes, like every other avatar. The *Office* cast names are
characters, not the product, and they stay.

## Enabling it

**Settings → Office Theme**, same picker as `office` and `brooklyn99`. Turn on the
**TV-show office themes** toggle if it is off — with the flag off the store is
forced to `office` regardless of what is saved
([`App.tsx:113`](../src/renderer/src/App.tsx)), so the Staff Room will not appear
until it is on.

**Switching floors starts a fresh cast.** Every non-god agent's terminal is closed
and the agent archived before the new theme is persisted; the god agent and its prep
assistant carry over, and the god's PTY is never touched. If a terminal refuses to
close, the switch is **aborted** and the old theme is kept rather than leaving a
half-switched floor. Archived agents can be restored from the roster.

> The switch is not undoable. Hire manifests are the cheapest way to bring a team
> back — see below.

## Hiring the school agents

The Agent Gallery ships one manifest per persona under
[`docs/hires/manifests/`](hires/manifests/), following the gallery's
`<character>-<role>.hire.json` naming:

| Manifest | Character | Role |
|---|---|---|
| `principal-staff.hire.json` | Principal | Runs the floor; keeps everyone on task |
| `teacher-lessons.hire.json` | Teacher | Step-by-step explanations and small exercises |
| `topper-exams.hire.json` | Topper | Correct answers, delivered with superiority |
| `smartguy-tricks.hire.json` | Smart Guy | Shortcuts, tricks and mental models |
| `librarian-research.hire.json` | Librarian | Answers with references and a next read |

Open a manifest from the gallery, or import one with a `jargon://hire` deep link or
a file drop. Imports are **validated, never auto-spawned**: flags only, no raw
command, SSRF-guarded, so a shared manifest cannot run something on your machine.

Each manifest pins `character` and `accent`, which is why the gallery's five school
hires render as the right five avatars. Hiring one after switching to `staffroom` is
the fast path: the manifest sets the character, so you do not have to name it after
the sprite.

## No new art

`maps/staffroom.tmj` is built on the **same three tileset atlases** already bundled
for `office` and `brooklyn99` — `office-tileset.png` (firstgid 1), `a5-office-floors-walls.png`
(513) and `interiors.png` (1025). The staff room is a *rearrangement* of existing
tiles: shelves, glass partitions, a desk-and-PC stamp, a counter run. There is no new
atlas, no new licence obligation, and no new download.

The layout, in tile coordinates on the 36×24 grid:

- **Top wall** — clock, calendar, green chalkboard, notice board, four two-tile windows
- **Top furniture band** — bookshelves, printer, filing cabinets, whiteboard, water cooler, coffee counter
- **Meeting room** (top-left, zone `boardroom`) — glass walls, conference table, six chairs
- **Teacher's corner** (top-right) — desk and PC, filing cabinet, `pc-6`
- **Student desk row** (mid-floor) — five desk-and-PC stamps, `pc-1`…`pc-5`
- **Lounge** (bottom-left, zone `cafeteria`) — two facing couches, coffee table, low bookshelf, vending machine, and the four café seats
- **Principal's office** (bottom-right, zone `principal`) — glass walls, desk, `desk-ceo`, bookshelf
- **Reception** (bottom-centre) — counter, rug, and the entrance

## What still works, unchanged

The floor is not a reskin of the *picture* only — the whole idle simulation is shared:

- **Coffee economy.** Four mugs on the rack, a machine and a sink; carrying a used mug home is 60% lazy refill, 40% a proper wash. Interrupt an agent mid-run and the mug is parked steaming beside its monitor.
- **Errands.** Plants to water, windows to open, bins, a fridge, a shelf — plus the principal's 18-second cigarette break.
- **Cafeteria director.** Idle agents drift to the lounge, pair up on the couches, and trade a two-beat line. Each character has signature lines that win over the generic pool.
- **Cafeteria is not desk seating.** It is deliberately excluded from overflow seats so the couches stay free for breaks. `boardroom` *is* overflow seating.
- **Task choreography.** New tasks are pinned to the board, claimed from it, carried to a desk, and filed when done — all driven off the real task ledger.
- **Circuit breaker, budgets, breakers** are engine-side and theme-agnostic.

## Adding another floor

A theme is a map plus a `ThemeConfig`. See
[`themeRegistry.ts`](../src/renderer/src/scene/office/themeRegistry.ts) for the
contract and `tools/gen-b99-map.cjs` for a script that authors a whole map — it
includes a flood-fill validator that refuses to write the file unless every seat,
café stand and spawn is reachable from the entrance, which is the part that is
annoying to get right by hand.

`tools/mapgen/render_map.py <map.tmj> out.png --labels` rasterizes a map offline
with collision and spawn overlays, so a layout can be iterated without launching
Electron.