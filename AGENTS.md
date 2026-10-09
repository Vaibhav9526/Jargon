# Project notes

## Running this app (Windows)

- `npm install` fails on this machine: Node 25's headers ship `clang: 1` and the
  project's `@electron/node-gyp` fork lacks upstream's clang reset, so gyp
  demands the (uninstalled) ClangCL toolset → MSB8020.
- Workaround used: `npm install --ignore-scripts`, then:
  1. `node node_modules/electron/install.js` (downloads the Electron binary)
  2. `./node_modules/.bin/electron-rebuild -f` (builds better-sqlite3 + node-pty
     against Electron headers — no clang issue there)
  3. `node tools/ensure-pty-perms.cjs && node tools/patch-node-pty-conpty.cjs`
- `node-pty` also required a local patch: `SpectreMitigation: 'Spectre'` →
  `'false'` in `node_modules/node-pty/binding.gyp` and
  `node_modules/node-pty/deps/winpty/src/winpty.gyp` (this machine's VS Build
  Tools lack the Spectre-mitigated libs → MSB8040). Wiped on reinstall.
- Run dev app: `npm run dev`
- Rebuild the current School atlas/map: `python tools/build-school-world.py`
  (requires Pillow). This validates entrance reachability for all seats and
  interaction points before writing the assets. Older school generators produce
  the superseded layouts and should not be used for the current theme.
- School regression checks: `node --test test/staffroom-theme.test.cjs test/school-character-art.test.cjs test/school-leader-switch.test.cjs test/god-identity.test.cjs test/school-office-switcher.test.cjs`.

## Hosted teaching integration

- Manual teaching checks: `node --test test/teaching-routing.test.cjs test/teaching-composer.test.cjs test/teaching-window.test.cjs test/teaching-branding.test.cjs`.
- `@teacher` / `@teach-me` requires an active Teacher worker, but no API access
  code. Jargon opens the hosted website; the user signs in, uploads materials,
  and starts generation manually. Jargon does not make generation API calls.
- The isolated teaching window uses local Jargon branding on root/classroom
  chrome. Authentication, payment, legal pages, course content, and citations
  retain their original identity/content. Provider details disclose OpenMAIC.
- `openMaic.ts` and `teachingMaterials.ts` remain as standalone legacy helpers,
  but are not wired into the active manual teaching flow. Existing stored
  credentials are neither read nor deleted by manual mode.

## Librarian file desk

- `@convert` (PDF→PPT, PPT→PDF, image→PDF, PDF→image) and `@compress N%` (image)
  run locally from the composer: `shared/fileTools.ts` parses, `main/fileTools.ts`
  does the work, IPC `fileTools:run` re-validates and requires per-window file
  grants. Output goes to `Documents/Jargon Converted`. PPT→PDF needs PowerPoint
  (Windows) or LibreOffice; PDF→PPT makes one picture per slide (not editable).
- Checks: `node --test test/file-tools.test.cjs`.

## Modern tileset

- Settings: the top-bar **Modern / Classic** switch (`config.tilesetStyle`, default modern) swaps the
  art for the Office and School floors; seats, zones and cast are identical.
- Rebuild: `python tools/build-emakina-world.py --src <clone of EmakinaFR/office-map>` (Pillow).
  `--preview <prefix>` writes PNG previews instead of building. It refuses unreachable seats.
- Checks: `node --test test/emakina-maps.test.cjs`. The art is used with the owner's permission,
  is NOT MIT (see `LICENSE-ASSETS`), and the Star Wars sheet must never be packed.

## User preferences

- When running opencode, use `npx opencode` — NOT bare `opencode`. The bun shim
  at `~/.bun/bin/opencode` is broken ("bin executable does not exist on disk")
  and shadows the working npm-global `opencode-ai` install; npx resolves the
  latter correctly.
