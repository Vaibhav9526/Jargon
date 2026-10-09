# Emakina tile catalog (32px sheets) — `(sheet, col, row, w×h)`

Used by `tools/build-emakina-world.py` (`World.put(layer, x, y, sheet, col, row, w, h)` copies a
w×h block of tiles). Sheets: **S1/S2/S3** = `tilesets_deviant_milkian_1/2/3.png` (16 cols),
**FL** = `floortileset.png`, **CU** = `tileset_custom.png`, **FA** = `fantasy.png` (8 cols).
Read off 4× zoomed, labelled crops of the sheets; verify visually with `--preview`.

## S1 — modern office
| item | tiles |
|---|---|
| bookcase (binders) | (1,0) 2×3 · (3,0) 2×3 · (5,0) 2×3 (shelf+cabinet) |
| tall fridge-cabinet (light green) | (7,0) 1×3 |
| executive glass desk (top row + drawers row) | (0,3) 2×2 |
| copier | (8,3) 2×2 |
| window pane | (14,0) 2×2 (art sits on the lower row) · large (12,0) 2×3 |
| venetian blinds | (10,3) 3×2 |
| black armchairs | (10,5) 4×3 (+ row 8) · single big (8,7) 2×2 |
| swivel chair (black) | (14,5) 1×2 |
| picture frame (flowers) | (14,7) 2×2 · small landscape (14,9) |
| long white desk — left cap / mid / right cap | (8,9) / (9,9) / (10,9), each 1×3: rows = top, mid, front edge. Repeat the mid tile for length |
| CRT + keyboard | (4,8) 1×2 · tower (5,8) 1×2 |
| monitors | **(3,15) off (black)** · **(2,15) on (blue)** · keyboard (0,15) · floppy (1,15) |
| chairs (seen from behind) | (0,7) (1,7) (2,7) (3,7) |
| whiteboard on stand | (1,10) 2×2 |
| cork board (framed) | (11,11) 2×2 · green notice strip (9,12) 2×1 |
| plants | tall grey pot (4,10) 1×3 · blue pot (5,11) 1×3 · red flowers (5,14) · blue flowers (6,14) |
| coffee machine (beige) | (6,12) 1×2 |
| green 3-drawer cabinet | (7,12) 1×3 · green bench (4,15)–(7,15) |
| clock | (6,10) 1×2 (round) |
| bin · extinguisher | (0,6) · (1,6) |
| mirror + sink | (8,12) / (8,13) 1×3 |
| mug tray (sideboard prop) | (13,13) |
| diagonal blue monitors (vertical desks) | (13,11) 2×2 |
| server racks (black) | (0,11) 3×4 |
| tall white cabinet · white drawers | (3,11) 1×4 · (4,13) 1×2 |

## S2
| item | tiles |
|---|---|
| green sofa (3 seat) | (10,3) 3×2 · second (10,5) 3×2 · armchair (9,3) 1×3 |
| green lockers | (7,4) 1×3 |
| vending machine (red) | (8,12) 2×2 |
| water jugs (blue) | (6,11) · (6,12) |
| grey counters / drawers | (0,5) 2×1 · (2,5) 2×1 · tall shelves (0,3) 2×3, (2,3) 2×3, (0,6) 2×3 |
| water cooler / printer | (6,0) 1×3 · clock (7,0) · notice board (4,0) 2×1 · bin (3,0) |
| sink + mirror | (0,13) 1×3 · tub (1,13) · toilet (2,13) |
| green bench | (0,12) 3×1 + end (3,12) |
| white table with legs | (4,3) 3×3 (cap/mid/cap, same as S1 desk) |
| bed | (1,0) 2×3 · curtains (3,1) 3×2 |
| wooden drawers | (7,2) 1×2 |

## S3 — school / cosy (warmer palette)
| item | tiles |
|---|---|
| **student desks** (1×1, top + legs): paper / open book / blue folder / open book / plain | (10,0) (11,0) (12,0) (13,0) (14,0) |
| desk + chair unit (chair under the desk) | desk (14,1) + chair (14,2) · chair alone (15,0)/(15,1) |
| **chalkboard** (green, wooden frame) | (12,3) 3×2 |
| bulletin board (green, papers) | (12,1) 2×2 |
| wall clock · typewriter · notice plaque | (15,4) · (15,5) · (12,5) |
| bookshelves (wood) | top rail (8..11,4) + body (9,5) 1×2 narrow · (10,5) 2×2 wide · cabinet door (8,5) 1×2 |
| wooden stairs | (9,1) 3×3 |
| light wooden table with legs | (14,9) 2×2 · dark wood cabinet-desk (15,13) 1×3 |
| plants | tall (11,9) 1×2 · red flowers (8,10) |
| stools | (12,6) · (14,7) · lab sink (13,6) 1×2 |
| books / envelope | (12,9) closed · (13,9) open · (12,10) letter |
| kitchen: counter (1,4) 3×2 · sink basin (1,3) · stove (2,3) · fridge (7,0) 1×3 · oven (6,0) 1×3 · dish cupboard (4,4) 2×3 · big cupboard (6,4) 2×3 | |
| beds | (1,0) (2,0) (3,0) each 1×3 (pink / blue / green) |

## Floors (FA, 8 cols; 32px) — warm → cool
light wood planks (0,36) · light stone (1,36) · cobble (2,36) · grey tile (3,36) · checker (4,36) ·
dark wood planks (0,37) · brown brick (1,37) · parquet (0,38) · grey brick (1,38) · **yellow diamonds (2,38)** ·
grey squares (3,38) · carbon (4,38) · blue-grey pattern (5,38) · dark parquet (0,39) · yellow brick (1,39) ·
orange diamond (2,39) · olive (3,39) · blue tile (5,39) · white marble (0,40) · sand (3,40).
`CU (0,3)` is the grey carpet of the Limoges map. Walls: `FL (5,4)` black; `FL (6,4)/(7,4)` dark grey brick.
Do **not** use `tileset_yoda_stories.png` (Star Wars IP).

## FA — warm interior pieces (used by the compact v2 floors)
| item | tiles |
|---|---|
| **two-row wall faces** (cols 0 / 3 = end caps, 1–2 repeat) | white plaster + wainscot (0..3,66)/(0..3,67) · yellow striped wallpaper (0..3,64)/(0..3,65) · wooden boards (0..3,62)/(0..3,63) |
| wall seen from above (partitions, outer walls) | (6,65) brown framed panel |
| wooden door (1×2) | (7,66) |
| **rugs** (3×3 nine-slice, transparent frayed edge) | beige (5..7,104..106) · red with gold fringe (5..7,98..100) |
| door mat (red stripes) | (4,41) |
| **light wood table** (3×3 nine-slice; 2 rows = top + bottom) | (5..7,89..91) — the office desks are the 3×2 cut |
| dark wood table (executive / reception desk) | (5..7,92..94) |
| round table · stool · small square table | (4,89) · (4,90) · (2,93) / stool (2,94) |
| bookcase (wood) · red drawers · wardrobe | (0,93) 2×2 · (0,91) 2×2 · (3,91) 2×2 |
| narrow bookshelf · light drawers · small drawer | (3,89) 1×2 · (0,89) 1×2 · (2,92) |
| brick fireplace with mantel · stone fireplace | (0,104) 3×2 · (0,102) 3×2 |
| upright piano | (3,105) 2×2 |
| clocks: wall · pendulum | (0,101) · (2,101) |
| paintings: world map · landscape · portrait | (0,78) 2×1 · (4,78) · (5,78) |
| potted plants: leafy · tall grass · pink flowers · empty pot | (7,113) 1×2 · (7,115) 1×2 · (7,117) · (7,118) |
| books (closed/open, 8 colours) | row 119 |
| cups / teapots | (5,121) (6,121) (7,121) |

## More S1 / S2 / S3 / CU picks
| item | tiles |
|---|---|
| S1 brown wood desk (art is 2 wide, offset half a tile) | (1,8) 3×2 · side-on desk (0,8) 1×3 |
| S2 drinks fridge (glass door) | (13,3) 2×2 · tall (13,5) 2×3 |
| S2 water cooler | (6,0) 1×2 (row 2 is empty) |
| S2 clock (1×2) | (7,0) |
| S2 armchairs | facing left (9,3) 1×3 · facing right (8,6) 2×2 |
| S3 school chair (from behind) | (15,0) · desk+chair unit (14,1)/(14,2) |
| S3 kitchen counter (top / front, left·mid·right) | (1..3,4) / (1..3,5) · sink basin (1,3) · fruit bowl (6,3) · teapot set (5,3) |
| S3 cushions · teddy bears | (4,7) (5,7) (5,8) · (4,10) (2,11) (3,11) (4,11) |
| S3 typewriter · notice plaque · archive box | (15,5) · (12,5) · (13,5) |
| CU foosball table | (0,1) 2×2 (avoid (0,4) stormtrooper and (7,6): third-party IP) |
