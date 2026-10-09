<!-- RELEASE RUNNER, REQUIRED BEFORE YOU TAG: run RELEASE-CHECKLIST.md. Rehearse the updater on 0.4.7-rc.1 -> 0.4.8-rc.1 prereleases and pass the fault-injection checks BEFORE tagging the real release. This comment is not rendered in the published notes. -->
# Jargon v0.4.8 — Classroom, Mail and Looks

A Windows-only release from the private `Vaibhav9526/Jargon-backup` fork. It builds on v0.4.7 (School and Teaching).

## What's new

- **Classroom chat for the staff room.** Click Teacher, Topper, Smart Guy, Librarian or Vice Principal to get a school ID card and a chat. Focus mode is a messenger layout with every character's chat in a left rail. Each character answers in its own voice, and the Topper and Smart Guy change facial expression with each reply (hand-drawn expression sets).
- **Teacher quizzes (`@quiz`).** Tell the Teacher what you are stuck on and get 5 multiple-choice questions. After you answer: an exact score, an explanation for every question, your weak points with how to fix them, and recommended YouTube channels, books and other resources (each opens a YouTube or Google search, so links never go stale).
- **Librarian's library and `@memory-notes`.** Add PDFs, slides (.pptx), Word files, EPUBs and text notes once; any character can then answer from them with `@memory-notes` and names the note it used. If nothing matches, it says so.
- **`@teach-me` opens inside the chat.** The hosted OpenMAIC classroom is embedded in the Jargon window with a Jargon skin, the Jargon name and logo, your topic pre-filled and attached PDFs/images staged for you. You still press Enter Classroom yourself. A dropdown at the top of every chat keeps the running lesson one click away when you switch agents.
- **Jargon Mail (Office floor).** A Mail button in the title bar: connect any IMAP/SMTP mailbox with an app password, then read, summarize, extract dates/amounts/links, rewrite and send. Nothing is sent without your confirmation.
- **App looks.** Four new palettes (Paper, Ocean, Forest, Plum), each in light and dark, from a picker in the title bar. The original cream theme stays the default.
- **Windows title bar merged into the app**, Command Center header and tabs simplified, `@` suggestions in the message box, redesigned staff room with new cast sprites.

## Known issues

- Mail has been verified for sending (against a local test server) and for the AI actions, but reading a real inbox over IMAP has not been exercised yet. Gmail needs 2-Step Verification and an app password.
- The Gmail "Sign in with Google" option in Settings needs your own Google Cloud OAuth client and has not been exercised end to end.
- The new looks were checked numerically for contrast but not reviewed screen by screen.
- Classroom replies use your Claude Code login (one short call per message). The OpenMAIC account, quota and any payment rules still apply on the hosted site.

## Windows downloads

| Build | Download |
|---|---|
| Installer | [Jargon-0.4.8-win-x64-setup.exe](https://github.com/Vaibhav9526/Jargon-backup/releases/download/v0.4.8/Jargon-0.4.8-win-x64-setup.exe) |
| Portable | [Jargon-0.4.8-win-x64-portable.exe](https://github.com/Vaibhav9526/Jargon-backup/releases/download/v0.4.8/Jargon-0.4.8-win-x64-portable.exe) |

Windows 10/11 x64. Verify the downloaded executable against the release's `SHA256SUMS.txt` before running it. The build is unsigned.

## Release verification and exception

- Verification gates: typechecks (node and web), the focused School/Office, teaching, mail, classroom and library test suites, and the production build.
- The repository owner requested this Windows-only release on 2026-10-09. No macOS signing, notarization, stapling, or real updater rehearsal is claimed. The release checklist and security settings remain unchanged.
- The original `jargon-app/jargon` auto-update configuration is retained at the owner's request. Official updates may replace this fork's custom features.
- No API access codes, account credentials, mailbox passwords or user runtime data are included in the release.

[Source for v0.4.8](https://github.com/Vaibhav9526/Jargon-backup/archive/refs/tags/v0.4.8.zip)

MIT-licensed. The school artwork is original pixel art; the existing Office asset licensing remains unchanged.
