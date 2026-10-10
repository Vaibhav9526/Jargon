/**
 * spectatorStream.ts — the renderer half of spectator mode.
 *
 * A single background loop that, about once a second, reads the LIVE store (agents,
 * floor/theme, god status) plus the task board, folds them into one compact snapshot,
 * and pushes it to main over IPC (`spectator:push`). Main only caches it; the phone
 * page polls `/state`. Nothing here mutates the store — it is a pure read of the real
 * shapes, so the spectator view can never drift from or disturb the floor.
 *
 * The loop only runs while spectator mode is ON (started from the top-bar toggle), so
 * an idle app pays nothing. `startSpectatorStream()` is idempotent.
 */

import { useStore, type Agent, type GodStatus } from '@/store/store';

/** Schematic seat/zone label for an agent. The real floor assigns seats inside the
 *  Pixi scene (layout-bound); here we derive a stable, meaningful grouping instead:
 *  the orchestrator sits in "Michael's office" (the god's room), everyone else groups
 *  by their current station kind, falling back to a deterministic "Desk N". */
function seatLabelFor(agent: Agent, deskIndex: number): string {
  if (agent.isGod) return "Michael's office";
  if (agent.currentStation) {
    const station = agent.currentStation;
    return station.charAt(0).toUpperCase() + station.slice(1);
  }
  return `Desk ${deskIndex + 1}`;
}

/** A short human label for the active floor/theme. */
function floorLabel(theme: string): string {
  switch (theme) {
    case 'staffroom': return 'The Staff Room';
    case 'office': return 'The Office';
    case 'friends': return 'Central Perk';
    case 'brooklyn99': return 'The Nine-Nine';
    case 'siliconvalley': return 'Pied Piper';
    case 'got': return 'The Red Keep';
    case 'hogwarts': return 'The Great Hall';
    default: return theme || 'The Office';
  }
}

/** The current task headline for an agent — its live action, or its standing job. */
function taskTitleFor(agent: Agent): string {
  const action = (agent.action ?? '').trim();
  if (action) return action;
  return (agent.description ?? '').trim();
}

/** Build the compact snapshot from the live store. Pure — safe to unit-test. */
export function buildSpectatorSnapshot(now = Date.now()): {
  floor: string;
  floorLabel: string;
  godStatus: GodStatus;
  agents: Array<{ id: string; displayName: string; provider: string; status: string; seatLabel: string; currentTaskTitle: string }>;
  tasks: { queued: number; active: number; done: number };
  updatedAt: number;
} {
  const s = useStore.getState();
  const agents = s.agents.filter((a) => !a.archived);
  const viewerAgents = agents.map((a, i) => ({
    id: a.id,
    displayName: a.name || a.id,
    provider: a.provider ?? '',
    status: a.status,
    seatLabel: seatLabelFor(a, i),
    currentTaskTitle: taskTitleFor(a).slice(0, 120)
  }));
  return {
    floor: s.officeTheme,
    floorLabel: floorLabel(s.officeTheme),
    godStatus: s.godStatus,
    agents: viewerAgents,
    // Task counts are filled in by the poller (they need an async hive read); the
    // builder seeds zeros so the shape is always valid even before the first read.
    tasks: { queued: 0, active: 0, done: 0 },
    updatedAt: now
  };
}

/** Read the task board and fold it into {queued, active, done}. `queued` = todo +
 *  blocked, `active` = doing, `done` = done — the three numbers the spectator bar
 *  shows. Best-effort: any failure keeps the last good counts. */
async function readTaskCounts(): Promise<{ queued: number; active: number; done: number }> {
  try {
    const raw = await window.cth.hiveTasks() as { tasks?: Array<{ status?: string }> } | null;
    const list = raw && Array.isArray(raw.tasks) ? raw.tasks : [];
    let queued = 0, active = 0, done = 0;
    for (const t of list) {
      if (t?.status === 'doing') active++;
      else if (t?.status === 'done') done++;
      else queued++; // todo, blocked, or anything not yet moving
    }
    return { queued, active, done };
  } catch {
    return { queued: 0, active: 0, done: 0 };
  }
}

let streamTimer: ReturnType<typeof setInterval> | null = null;
let taskTimer: ReturnType<typeof setInterval> | null = null;
let lastCounts = { queued: 0, active: 0, done: 0 };

/**
 * Start pushing snapshots to main about once a second. Idempotent. Task counts are
 * refreshed on a slower cadence (they need an async hive read) and merged into each
 * snapshot, so the hot loop stays a cheap synchronous store read + IPC send.
 */
export function startSpectatorStream(): void {
  if (streamTimer) return;
  const push = (): void => {
    const snap = buildSpectatorSnapshot();
    snap.tasks = lastCounts;
    window.cth.spectatorPush(snap);
  };
  void readTaskCounts().then((c) => { lastCounts = c; });
  taskTimer = setInterval(() => { void readTaskCounts().then((c) => { lastCounts = c; }); }, 4000);
  streamTimer = setInterval(push, 1000);
  push(); // send one immediately so the page is live on first paint
}

/** Stop the stream. Safe to call when not running. */
export function stopSpectatorStream(): void {
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
  if (taskTimer) { clearInterval(taskTimer); taskTimer = null; }
}
