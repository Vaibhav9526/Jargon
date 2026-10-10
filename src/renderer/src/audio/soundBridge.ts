import {
  clampVolume,
  createTypeThrottle,
  type SoundName,
  type TypeThrottle
} from './soundEngine';

/**
 * The one place that decides what the floor sounds like.
 *
 * Nothing else in the app calls `playSound`. Components that sprinkled their own
 * cues drifted out of step with each other and made mute a per-component job;
 * this module watches the store diff and speaks for all of them, and carries the
 * master gain so the top-bar toggle lands on the very next store write.
 *
 * Every dependency is injected — that is what makes the diff and throttle rules
 * testable without Electron, React or an AudioContext.
 */

/** The part of the roster the bridge reads. Structural so tests can pass plain objects. */
export interface SoundAgent {
  id: string;
  status: string;
}

export interface SoundState {
  agents: SoundAgent[];
  godStatus?: string;
  soundEnabled?: boolean;
  soundVolume?: number;
}

export interface SoundBridgeDeps {
  /** `useStore.subscribe` — handed (state, previousState). */
  subscribe: (listener: (state: SoundState, previous: SoundState) => void) => () => void;
  /** Current state, read once at subscribe time so the engine is configured
   *  before the first store write rather than after it. */
  getState?: () => SoundState;
  play: (name: SoundName) => void;
  /** Push the engine's master gain/mute. Called on every change, so a mute is
   *  heard on the next write instead of at the next cue. */
  configure: (options: { enabled: boolean; volume: number }) => void;
  now?: () => number;
  random?: () => number;
  throttle?: TypeThrottle;
}

/** Roster churn (a boot restoring six cards) must not land six cues at once. */
const AMBIENT_GAP_MS = 140;
/** Two agents finishing together must not stack two chimes. */
const DONE_GAP_MS = 700;
/** A breaker can block several agents in the same tick. One blip is enough. */
const ERROR_GAP_MS = 1200;

/**
 * Subscribe the floor's sound to the store. Returns the unsubscribe; the caller
 * owns the lifetime (see useHive, which pairs it with initSound).
 */
export function createSoundBridge(deps: SoundBridgeDeps): () => void {
  const now = deps.now ?? ((): number => Date.now());
  const throttle = deps.throttle ?? createTypeThrottle(deps.random);
  let lastAmbient = Number.NEGATIVE_INFINITY;
  let lastDone = Number.NEGATIVE_INFINITY;
  let lastError = Number.NEGATIVE_INFINITY;

  const ambient = (name: SoundName): void => {
    const at = now();
    if (at - lastAmbient < AMBIENT_GAP_MS) return;
    lastAmbient = at;
    deps.play(name);
  };

  const configure = (state: SoundState): void =>
    // Default ON at half volume: an absent setting must read as the install
    // default, never as silence.
    deps.configure({ enabled: state.soundEnabled !== false, volume: clampVolume(state.soundVolume) });

  const react = (state: SoundState, previous: SoundState): void => {
    configure(state);
    // Before the roster short-circuit: the orchestrator's own status flips on
    // its own store write, which leaves the agents array untouched.
    if (previous.godStatus !== 'failed' && state.godStatus === 'failed') {
      const at = now();
      if (at - lastError >= ERROR_GAP_MS) { lastError = at; deps.play('error'); }
    }
    // Every pty chunk rewrites the roster; nothing to say unless it moved.
    if (state.agents === previous.agents) return;

    const before = new Map(previous.agents.map((a) => [a.id, a.status]));
    const present = new Set<string>();
    for (const agent of state.agents) {
      present.add(agent.id);
      const was = before.get(agent.id);
      if (was === undefined) { ambient('agentJoin'); continue; }
      if (was === agent.status) continue;
      if (agent.status === 'working') {
        // Every transition back into working ticks, not just the first, so an
        // agent that keeps cycling stays audible. The throttle is what stops that
        // from becoming a machine gun.
        if (throttle.allow(agent.id, now())) deps.play('type');
      } else if (agent.status === 'blocked') {
        const at = now();
        if (at - lastError >= ERROR_GAP_MS) { lastError = at; deps.play('error'); }
      } else if (agent.status === 'idle' && was === 'working') {
        // The turn ended: the unit of work the floor was asked for is done.
        const at = now();
        if (at - lastDone >= DONE_GAP_MS) { lastDone = at; deps.play('taskDone'); }
      }
    }
    for (const agent of previous.agents) {
      if (present.has(agent.id)) continue;
      // Forget the tick window too, so a re-hire is not silenced by when the
      // agent happened to leave.
      throttle.forget(agent.id);
      ambient('agentLeave');
    }
  };

  const initial = deps.getState?.();
  if (initial) configure(initial);
  return deps.subscribe(react);
}