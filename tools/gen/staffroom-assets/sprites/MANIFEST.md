# Staffroom sprites — generation manifest

> **PIVOT (coordinator decision):** `agy` image quota hit `429 RESOURCE_EXHAUSTED`
> mid-run (reset ~04:35 Oct 8). Per coordinator direction, the real sprites are
> now **procedural** — matching how every existing cast member is drawn
> (`portraitArt.ts` per-pixel recipes → `cast.ts::getCastFrames` /
> `paintCastPortrait`). The `agy` PNGs below are kept here as **style reference
> only** and are NOT wired into the app.

## Procedural cast (wired — `src/renderer/src/scene/office/portraitArt.ts`)

Composer additions made for this cast: `stylePonytail` hair (front tail +
back-tail in `drawHeadBack`), `'hoodie'` cloth kind (hood bumps, drawstrings,
kangaroo pocket, resting hood on the back), `'smirk'` mouth, `sleepy` eye flag.

| name | recipe | visual check (contact sheet) |
|---|---|---|
| principal | gray slicked short hair (recede), navy suit + dark-red tie, glasses, angry brow | OK — reads as stern boss; only suit in the cast |
| teacher | brown `styleBun`, olive cardigan over cream blouse, glasses, soft smile + blush + lashes | OK — warm and kind |
| topper | brown `stylePonytail`, pink sweater, thin glasses, `smirk` + raised brow + lashes | OK — tail visible front-right and down the back |
| smartguy | brown `styleMessy`, slate-blue `hoodie`, `sleepy` lids, lazy grin, no glasses | OK — only glasses-free character |
| librarian | gray `styleBun`, purple cardigan, glasses, quiet neutral mouth + lashes | OK — distinct from teacher by hair color + purple |

Render QA: `procedural-contact-sheet.png` (regenerate via
`node render-contact-sheet.cjs`) — 5 rows × [front stand, step-L, step-R, back
stand]. `npx tsc --noEmit -p tsconfig.web.json` passes.

## agy reference PNGs (style reference only — not wired)

Generated before the quota died; all PIL-verified (load OK, >5KB).

| file | px | bytes | notes |
|---|---|---|---|
| principal-walk.png | 1376×768 | 897,406 | 4-panel row: front / stride / stride / back — consistent outfit |
| principal-portrait.png | 1024×1024 | 1,237,197 | bust, warm-cream bg |
| teacher-walk.png | 1376×768 | 1,018,368 | 4-panel row — consistent outfit |
| teacher-portrait.png | 1024×1024 | 1,148,771 | bust |
| topper-walk.png | 1376×768 | 928,690 | 4-panel row — consistent outfit |

Not generated (quota): topper-portrait, smartguy-walk/portrait,
librarian-walk/portrait. If raster art is ever wanted, re-run the `w2-sprites.md`
prompts after the quota resets.
