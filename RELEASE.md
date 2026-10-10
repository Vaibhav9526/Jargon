# Jargon v0.5.0 — Tapri, voice, and auto-update

A Windows-only release. It builds on v0.4.9 (Office chat, Mailman and a hive fix).

## What's new

- **Tapri, a new level.** Pick **Tapri** in the top-bar switch for a roadside chai stall with no agents: you sit sipping chai while the regulars (Sharma ji, Bhola Kaka, Pappu Bhai, Gopal, Meena Aunty, Rinku, Verma Sahab, Havaldar Yadav, Munna and Chhotu the chai-wala) walk up, hop out of autos, sit down and talk about India and the world, political gossip, tips and tricks, and travel. Autos, rickshaws, cars, buses, bikes, passers-by and street animals go by. Listeners react with pixel faces; push someone too far and they stand up and storm off.
- **Pick the CLI that writes the talk.** Claude Code, Codex, Gemini CLI, Qwen Code or OpenCode, from a menu. Lines stream in as they are written, so the first person starts talking in a few seconds with Claude.
- **Hold Alt+S to talk.** Your words are transcribed with ElevenLabs and the table answers you by name (Vaibhav). The conversation is in Hindi.
- **Summarize button.** One click writes a short summary of everything said; "Full talk" shows the transcript.
- **ElevenLabs voices and street ambience** (optional, bring your own key; stored encrypted, off by default).
- **Auto-update.** Jargon checks GitHub for new releases, shows a notice when one is ready, downloads it in the background, and installs it when you choose "restart to update". It never restarts on its own.
- **Spectator mode.** A read-only live view of the floor for a phone on the same network (QR code in the top bar).
- **Ambient floor sound.** Quiet generated cues for typing, finished tasks and agents joining or leaving. No audio files are shipped.

## Known issues

- **Versions before 0.5.0 cannot auto-update.** Their updater was switched off and pointed at a repository that does not exist. Install v0.5.0 once from the table below; every release after this one is offered inside the app.
- The updater is new in this build and has not been rehearsed through a real version hop; if an in-app update fails, the app falls back to a notice that opens the release page for a manual download.
- Tapri's Hindi voices use the voices in your ElevenLabs account. Without Hindi voices there, stock voices are used with the multilingual model, which can sound foreign.
- The build is unsigned, so Windows SmartScreen may warn on first run.
- 22 existing tests fail on this machine (symlink and config tests), with and without these changes.

## Windows downloads

| Build | Download |
|---|---|
| Installer | [Jargon-0.5.0-win-x64-setup.exe](https://github.com/Vaibhav9526/Jargon/releases/download/v0.5.0/Jargon-0.5.0-win-x64-setup.exe) |
| Portable | [Jargon-0.5.0-win-x64-portable.exe](https://github.com/Vaibhav9526/Jargon/releases/download/v0.5.0/Jargon-0.5.0-win-x64-portable.exe) |

Windows 10/11 x64. Verify the downloaded executable against the release's `SHA256SUMS.txt` before running it. The portable build does not auto-update; use the installer for in-app updates.

## Release verification

- Typechecks (node and web) and the focused tests for Tapri, the Office/School switcher, sound and spectator mode.
- No real updater rehearsal, signing or notarization is claimed.
- No API keys, account credentials or user runtime data are included in the release.

[Source for v0.5.0](https://github.com/Vaibhav9526/Jargon/archive/refs/tags/v0.5.0.zip)
