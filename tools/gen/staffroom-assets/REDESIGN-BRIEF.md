# Staff room redesign — brief for the image agent

Goal: recreate the staff-room floor scenery and redesign the characters.

- Scenery: replace the current staff-room view (reference target: `staffroom-target.png`,
  props in `props/`, sprites in `sprites/`, QA renders in `qa/`).
- Characters: redesign the school cast (Teacher, Vice Principal, Topper, Smart Guy, Librarian)
  — new portraits and sprites; keep the existing sprite sheet dimensions and frame layout.
- Constraints: every seat and interaction point must stay reachable from the entrance.
  `python tools/build-school-world.py` (needs Pillow) rebuilds the atlas/map and validates this —
  run it after dropping new art in, and do not use older school generators.
- Regression checks:
  `node --test test/staffroom-theme.test.cjs test/school-character-art.test.cjs test/school-leader-switch.test.cjs test/god-identity.test.cjs test/school-office-switcher.test.cjs`
- Hand back to Claude (final reviewer) when done; Claude checks files and the scenery.
