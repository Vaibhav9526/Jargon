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

## Ambient floor sound

- Procedural only — oscillators + band-passed noise on the Web Audio API. There
  are no audio assets and there must never be any. Cues: `type` (key tick),
  `taskDone` (two-note chime), `agentJoin`/`agentLeave` (door sweep),
  `error` (low blip). All under 0.6s.
- `src/renderer/src/audio/soundEngine.ts` owns the AudioContext and the master
  gain; `src/renderer/src/audio/soundBridge.ts` owns the trigger map and is the
  ONLY thing wired to the engine (from `useHive.ts`). Do not add `playSound()`
  calls to components — the bridge subscribes to the store diff so mute is one
  master gain, not a per-component job. A test asserts `useHive.ts` is still the
  only wiring site.
- Chromium will not start an AudioContext before a user gesture. `initSound()`
  arms a one-shot gesture listener; a cue asked for while the context is still
  suspended is DROPPED, not queued, so a burst of cues cannot all land on the
  first click.
- Settings: `soundEnabled` (default true — absent must read as ON) and
  `soundVolume` (default 0.5), mirrored through the store and the top-bar
  speaker toggle in `components/SoundToggle.tsx`.
- Throttling (per-agent tick window, one-chime-per-moment) lives in the bridge
  so it is testable without an AudioContext. Checks:
  `node --test test/sound-bridge.test.cjs`.

## Spectator mode (read-only LAN live view)

- Top-bar **spectator toggle** (`components/SpectatorToggle.tsx`) starts a read-only
  HTTP server (`src/main/spectator.ts`, no electron import) bound to `0.0.0.0` and
  shows the LAN URL + a QR code a phone scans to watch the floor live. The audience
  is hackathon judges, so the page is a schematic floor that pulses, not a JSON dump.
- Security model: the unguessable token in the URL path (`crypto.randomBytes`, minted
  per start) is the ONLY auth — GET only, no write endpoint exists, a wrong token is
  answered with the identical 404 as a wrong path (constant-time compare against a
  decoy), and a fixed-window rate limit sheds floods with a 429. See the header
  comment on `spectator.ts`.
- The renderer pushes a compact snapshot ~1/s over IPC `spectator:push`
  (`src/renderer/src/spectator/spectatorStream.ts` reads the live store + task board);
  main only caches it. The self-contained page (`spectator.ts` `spectatorPage()`) polls
  `/<token>/state` every 1.5s — inline CSS/JS, NO CDN/fonts (hackathon wifi may be
  offline). The QR is a hand-rolled, dependency-free encoder
  (`src/renderer/src/spectator/qr.ts`); the raw URL is always shown as a fallback.
- Additive config: `spectatorPort` (optional; default 47870, falls back to a free
  port). Not auto-started on boot — the LAN surface exists only while the user has it
  on, and `teardownAndQuit` stops it.
- Checks: `node --test test/spectator-view.test.cjs`.

## Tapri level (chai-stall discussion — no agents)

- Third option in the top-bar **School / Office / Tapri** switch. Tapri is an overlay
  (`useTapriLevel` in `tapri/TapriLevel.tsx`) over the floor: it does NOT start a fresh
  team and leaves agents/PTYs running. Selecting School/Office closes it.
- The talk is generated by a CLI the user picks (Claude, Codex, Gemini, Qwen, OpenCode —
  `TAPRI_CLIS` in `shared/tapri.ts`). One tool-less one-shot per round, **prompt on stdin,
  never argv**. The reply is strict JSON (`turns`, `reactions`, `summary`, `leaves`) parsed
  and validated by `parseTalkResponse` — unknown speakers are dropped, not trusted.
- Split: `shared/tapri.ts` (cast, prompt, parser) · `main/tapri.ts` (CLI spawn, ElevenLabs,
  IPC `tapri:*`) · `renderer/src/tapri/` — `sim.ts` (pure world: seats, walkers, autos/cabs,
  anger → storm off), `engine.ts` (director; all I/O injected), `render.ts` (canvas, also
  rendered headlessly for screenshots), `people.ts`/`vehicles.ts` (procedural sprites),
  `voice.ts` (playback), `TapriLevel.tsx` (HUD: CLI select, topics, say box, top-right summary).
- ElevenLabs is optional BYOK: key saved write-only under `apikey:elevenlabs` (own `tapri:key*`
  IPC — deliberately NOT in `BACKEND_KEY_ENV`, which would export it into every agent's env).
  Voices use `eleven_flash_v2_5`; street ambience uses sound-generation, cached in
  `userData/tapri/ambience.mp3`. Voices/street default OFF; lines are capped at 300 chars.
- Auto-chat pauses after `MAX_AUTO_ROUNDS` rounds without the user speaking (each round is a
  CLI call). A CLI error also stops auto-chat so a missing binary is not retried forever.
- Backdrop: `assets/tapri/tapri-bg.png` (1600x900; the parked van was painted out so traffic
  can drive the road). Seat/stand/lane coordinates in `sim.ts` are in that frame.
- Checks: `node --test test/tapri.test.cjs test/tapri-people.test.cjs test/tapri-vehicles.test.cjs`.

## User preferences

- When running opencode, use `npx opencode` — NOT bare `opencode`. The bun shim
  at `~/.bun/bin/opencode` is broken ("bin executable does not exist on disk")
  and shadows the working npm-global `opencode-ai` install; npx resolves the
  latter correctly.
- After making a change, run the app (`npm run dev`) so the user can see it —
  do this every time, not just when asked.
