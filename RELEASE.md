<!-- RELEASE RUNNER, REQUIRED BEFORE YOU TAG: run RELEASE-CHECKLIST.md. Rehearse the updater on 0.4.7-rc.1 -> 0.4.8-rc.1 prereleases and pass the fault-injection checks BEFORE tagging the real release. This comment is not rendered in the published notes. -->
# Jargon v0.4.9 — Office chat, Mailman and a hive fix

A Windows-only release from the private `Vaibhav9526/Jargon-backup` fork. It builds on v0.4.8 (Classroom, Mail and Looks).

## What's new

- **Office focus chat redesigned.** Every agent gets a messenger-style chat with a welcome screen, starter prompts, a chat dropdown, Clear chat / Terminal buttons and a rounded composer. Messages between agents (hand-offs, questions, replies) appear as notes in the chat, so delegation is visible.
- **Talk to the team in plain words.** "tell Michael to…", "wake Jim", "hey Principal, …" route to that agent and wake it if asleep. "I need two more agents" brings in more of the floor's cast and tells the orchestrator. A sleeping agent that receives mail is woken automatically.
- **Google sign-in for Mail.** Set up your own Google OAuth client once in Settings → Connections, then sign in with one click (PKCE, scope `https://mail.google.com/`). The same login serves the Mail panel and agents. The inbox has a Load more button (up to 1000).
- **Mailman chat commands.** `@summarize` answers in the chat, `@inbox` opens the inbox, `@compose <address> <what to say>` writes a ready-to-send draft you can edit and must confirm. Date filters such as "unread mail sent today" work. Summaries render as formatted text.
- **Floor-aware `@` suggestions.** School-only commands (`@teach-me`, `@quiz`, `@convert`, `@compress`) show only on the School floor; mail commands only on the Office floor.
- **Fix: agent messages were being dropped on Windows.** Files written by PowerShell carry a byte-order mark that made the router reject them as malformed. The hive now reads them correctly.

## Known issues

- Google sign-in needs your own Google Cloud "Desktop app" client and has not been exercised against a live Google account.
- The Office chat shows an agent's own replies only for CLIs that keep a Claude-style transcript; other providers (for example Antigravity) show hand-off notes and their replies in the Terminal view.
- 22 existing tests fail on this machine (symlink and config tests), with and without these changes.
- The build is unsigned.

## Windows downloads

| Build | Download |
|---|---|
| Installer | [Jargon-0.4.9-win-x64-setup.exe](https://github.com/Vaibhav9526/Jargon-backup/releases/download/v0.4.9/Jargon-0.4.9-win-x64-setup.exe) |
| Portable | [Jargon-0.4.9-win-x64-portable.exe](https://github.com/Vaibhav9526/Jargon-backup/releases/download/v0.4.9/Jargon-0.4.9-win-x64-portable.exe) |

Windows 10/11 x64. Verify the downloaded executable against the release's `SHA256SUMS.txt` before running it. The build is unsigned.

## Release verification and exception

- Verification gates: typechecks (node and web) and the focused tests for mail, agent addressing and text decoding. No macOS signing, notarization or real updater rehearsal is claimed; the release checklist is unchanged.
- The original `jargon-app/jargon` auto-update configuration is retained at the owner's request.
- No API access codes, account credentials, mailbox passwords or user runtime data are included in the release.

[Source for v0.4.9](https://github.com/Vaibhav9526/Jargon-backup/archive/refs/tags/v0.4.9.zip)
