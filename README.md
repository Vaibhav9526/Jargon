<div align="center">

<img src="./docs/logo.png" alt="Jargon" width="160">

# Jargon

### Run an office of AI agents on your own machine

A desktop app that turns the terminal coding agents you already use into a coordinated team,
with memory, mailboxes and a desk each, and lets you talk to them like colleagues, in an office or
in a school.

<sub>Electron · React · TypeScript · Pixi.js · xterm.js · node-pty</sub>

</div>

---

## What problem it solves

AI coding agents are strong one at a time and awkward as a team. Each lives in its own terminal.
You copy context between windows, re-explain the same things, and work stops the moment you step
away. Nothing remembers, nothing hands work to anything else, and with several running you cannot
tell at a glance who is busy, stuck, waiting or idle.

Jargon runs real agent CLIs side by side, gives them shared memory and a way to message each other,
puts one orchestrator in charge so you brief **one** agent instead of many, and shows the whole team
working. It is local-first and works with the subscriptions and keys you already have.

## What makes it different

- **Real agents, not simulations.** Every agent is an actual CLI process in its own pseudo-terminal,
  byte-for-byte authentic. You can read it live and type straight back into it.
- **A team that coordinates itself.** Agents keep markdown memory, drain a mailbox and post to a
  shared blackboard. An orchestrator routes work and escalates only what needs you.
- **Two places to work.** An **Office floor** for engineering teams and a **School floor** for
  learning, each with its own cast, rooms and chat.
- **Talk to them, don't just watch them.** A messenger-style chat for every agent, in both floors.
- **Everything visible.** Agents are avatars that walk to stations, and messages fly desk to desk.
- **Local by default.** State, memory and credentials stay on your machine.

## Features

**The floors**
- **Office floor**: open-plan desks, executive office, meeting room, café with a working coffee
  economy, lounge. Agents sit at desks, take coffee breaks and water the plants.
- **School floor**: classroom with a chalkboard and student desks, principal's office, library and
  teacher's corner, staff café and meeting room, with its own cast: Principal, Teacher, Topper,
  Smart Guy and Librarian.
- **Two art sets** for both floors, switchable from the title bar: *Modern* and *Classic*.
- **Hire, wake, sleep, delete.** A picker shows every character. Open ones are one click away;
  sleeping ones are faded with a drifting "zzz" and wake with their memory intact; characters not
  hired yet can be invoked on the spot. Right-click an agent to put it to sleep or delete it.

**Chat**
- **Office chat**: focus on any worker and you get a messenger. Your messages go to the agent's real
  terminal queue; its replies come back as bubbles read from its transcript. A Terminal button
  opens the raw view.
- **Classroom chat**: each school character has a voice of their own, with chats listed in a
  sidebar and a mood that shows on their face.
- **Teacher**: `@quiz` builds multiple-choice questions from your doubt, grades them locally and
  points at weak spots; `@teach-me` opens an interactive lesson with your attached PDFs and images.
- **Librarian**: keeps a shelf of notes (PDF, PPTX, DOCX, EPUB, HTML, text) indexed locally;
  `@memory-notes` lets any character answer from them.

**File desk (the Librarian, entirely local)**
- `@convert`: PDF to slides, slides to PDF, images to PDF, PDF to images.
- `@compress 50%`: shrink an image by a percentage, with the saved size reported.

**Mail (Office floor)**
- The **Mailman** owns `@mail`, `@email`, `@mailman` and `@inbox`.
- **One-screen sign-in**: type your email, the provider is detected (Gmail, Outlook, Yahoo, iCloud,
  Zoho, Fastmail, or custom), servers are filled in, and both reading and sending are checked.
- **Ask in plain words**: summarize unread, find mail from someone, pull out dates, amounts and
  action items, reply, compose, rewrite a draft in a tone.
- **Safe by design**: mail text is treated as untrusted data, only whitelisted read steps run, and
  **sending always waits for your confirmation**. Credentials stay in the main process.

**Coordination and control**
- **The hive**: per-agent memory, atomic file mailboxes, a shared blackboard, an append-only event
  log and a single-committer git design.
- **Semantic recall**: markdown memory mined into a searchable shared store.
- **Orchestrator**: one agent you brief; it assigns work and escalates spend, scope changes and
  destructive actions to an approvals queue.
- **Circuit breaker**: a steer, constrain, stop ladder for agents that loop or run away, plus
  per-agent token budgets and real cost from transcripts.
- **Command Center**: kanban tasks with dependencies, scheduled missions, fleet monitoring, memory
  search, an activity log and a built-in Monaco IDE with git history, diffs and branch compare.
- **Per-agent git worktrees** so parallel agents never collide on a branch.
- **Slack and webhooks**: message a channel or POST a webhook to put the team to work.
- **Bring your own keys and local models**: Ollama, LM Studio and vLLM base URLs, with keys held in
  a write-only secret broker.
- **Languages**: English, Simplified Chinese and Arabic (with right-to-left layout).
- **Optional voice**: dictation and a realtime voice mode, both off until you turn them on.

## Supported agents

Anything that runs in a terminal can run here. Built-in presets cover:

`Claude Code` · `Codex` · `Gemini CLI` · `Antigravity` · `Grok` · `Kimi Code` · `Qwen` ·
`OpenCode` · `Crush` · `pi` · `GitHub Copilot CLI` · `Cursor` · plus any custom command.

You need at least one of these installed. If one is missing, the app offers to install it.

## How it works

```
            you ── talk to ──►  ┌──────────────┐
                                │ Orchestrator │  roster · routing · adjudication
                                │   (the boss) │  blackboard · task ledger
                                └──────┬───────┘
                                       │ assigns · routes · escalates
              ┌────────────────────────┼────────────────────────┐
              ▼                         ▼                         ▼
        ┌───────────┐            ┌───────────┐            ┌───────────┐
        │  agent A  │  message   │  agent B  │  message   │  agent C  │
        │  CLI + PTY│ ─────────► │  CLI + PTY│ ─────────► │  CLI + PTY│
        │  + memory │            │  + memory │            │  + memory │
        └───────────┘            └───────────┘            └───────────┘
              └──────── shared hive: memory · mailbox · blackboard · log ───────┘
```

1. **You hire agents.** Each is a normal terminal process with its own folder, identity and model.
2. **They collaborate through the hive**: a local repository of plain files. Agents write to their
   own `outbox/`; the router delivers into the recipients' `inbox/`.
3. **The orchestrator runs the floor.** It resolves routine requests itself and escalates only the
   critical ones.
4. **You see everything**: avatars move, messages fly, the terminal streams live, and you can step
   in at any point.

More detail: [`HIVE.md`](./HIVE.md) (multi-agent design), [`SPEC.md`](./SPEC.md) (terminal and event
plane), [`DESIGN.md`](./DESIGN.md) (visual system), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Getting started

### Download (Windows)

Grab the installer or the portable build from the
[latest release](https://github.com/Vaibhav9526/Jargon/releases/latest). The build is **unsigned**,
so Windows SmartScreen may warn on first run: choose *More info*, then *Run anyway*.

### Build from source

**Prerequisites:** Node.js 18+ and npm, a C/C++ toolchain for the `node-pty` and `better-sqlite3`
native modules (Visual Studio Build Tools on Windows, Xcode Command Line Tools on macOS, build
essentials on Linux), and at least one agent CLI on your `PATH`.

```bash
git clone https://github.com/Vaibhav9526/Jargon.git
cd Jargon
npm install
npm run dev        # launches the app with hot reload
```

```bash
npm run build      # production build
npm run typecheck  # type-check main/preload and renderer
npm run dist:win   # Windows installer + portable exe (dist:mac, dist:linux also exist)
node --test test/*.test.cjs
```

> **Windows note:** if `npm install` fails on the native modules, install with
> `npm install --ignore-scripts` and then run `npx electron-rebuild -f`. See [`AGENTS.md`](./AGENTS.md)
> for the exact workaround and the school-map and teaching test commands.

### Rebuilding the tilemaps

The Modern floors are generated, not hand-edited:

```bash
python tools/build-emakina-world.py --src <clone of EmakinaFR/office-map>
python tools/build-emakina-world.py --src <clone> --preview out   # PNG previews only
```

The generator refuses to write maps with unreachable seats or missing monitors.
`node --test test/emakina-maps.test.cjs` checks the same contract.

## Roadmap

- More chat integrations (Telegram and others) routed into the orchestrator's queue.
- OAuth sign-in for mail providers that are retiring password sign-in.
- Signed builds and an in-app updater once releases have a public home.
- More engines and integration templates.

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md): fork, run it, keep
`npm run typecheck` green, and derive any new UI from the tokens in [`DESIGN.md`](./DESIGN.md).

## Telemetry

Official builds can send a small set of anonymous usage events (never prompts, code, file paths or
agent output). It is off when `DO_NOT_TRACK` is set, can be switched off in Settings, and forks
compiled without a key send nothing. See [`TELEMETRY.md`](./TELEMETRY.md).

## License

The **source code** is licensed under the **MIT License** ([`LICENSE`](./LICENSE)).

> [!IMPORTANT]
> **Bundled art is licensed separately** and is **not** covered by the MIT grant
> ([`LICENSE-ASSETS`](./LICENSE-ASSETS), [`ATTRIBUTION.md`](./src/renderer/src/assets/ATTRIBUTION.md)):
> - The *Classic* tileset is **Modern Interiors** by [LimeZu](https://limezu.itch.io/moderninteriors),
>   used under the Complete Version licence. **Credit to LimeZu is required** and must stay in place.
> - The *Modern* tileset is built from [Emakina's office tilesets](https://github.com/EmakinaFR/office-map),
>   used with the owner's permission. Forks must remove it or obtain their own permission.
> - Character portraits and walking sprites are drawn procedurally in code and are MIT.
>
> Character names in the Office theme are playful references and imply no affiliation with any
> show, studio or company.

## Acknowledgements

- [LimeZu](https://limezu.itch.io/) for the *Modern Interiors* tilesets.
- [Emakina](https://github.com/EmakinaFR/office-map) for the 32px office tilesets behind the Modern floors.
- [`shahar061/the-office`](https://github.com/shahar061/the-office) for the original office map vendoring.
- [Pixi.js](https://pixijs.com/) · [xterm.js](https://xtermjs.org/) · [node-pty](https://github.com/microsoft/node-pty) · [electron-vite](https://electron-vite.org/) · [CodeMirror](https://codemirror.net/) · [Monaco](https://microsoft.github.io/monaco-editor/).
