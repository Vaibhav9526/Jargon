/**
 * Ambient floor sound — synthesized, never shipped.
 *
 * Every cue is a handful of oscillators and a band-passed noise burst scheduled
 * on the Web Audio API, so the app carries no audio assets and a demo floor
 * cannot sound like a looping sample pack. Cues are short (well under 0.6s) and
 * quiet by default: this is room tone behind the office, not UI feedback.
 *
 * Autoplay policy: Chromium refuses to start an AudioContext until the window has
 * seen a gesture, so nothing is created here at module load. `initSound` arms a
 * one-shot gesture listener, `playSound` creates the context on demand, and a
 * context that is still suspended is treated as silence rather than queued — a
 * burst of cues scheduled against a locked context would all land together on
 * the first click.
 */

/** The five cues the floor can make. */
export type SoundName = 'type' | 'taskDone' | 'agentJoin' | 'agentLeave' | 'error';

export const SOUND_NAMES: readonly SoundName[] = ['type', 'taskDone', 'agentJoin', 'agentLeave', 'error'];

/** Loudness of a fresh install. Deliberately low. */
export const DEFAULT_SOUND_VOLUME = 0.5;

/** One agent may tick at most this often. */
export const TYPE_TICK_WINDOW_MS = 1500;
/** …plus up to this much more, so a busy floor never locks onto one beat. */
export const TYPE_TICK_JITTER_MS = 450;

/** Clamp a setting to a usable 0..1 level. Anything unreadable (absent, NaN, a
 *  string out of a hand-edited config.json) falls back to the install default
 *  rather than to silence — the user asked for sound, not for a broken slider. */
export function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SOUND_VOLUME;
  return Math.min(1, Math.max(0, value));
}

export interface TypeThrottle {
  /** True when this agent may tick; records the tick when it says yes. */
  allow(agentId: string, now: number): boolean;
  /** Drop an agent's window — called when it leaves the floor, so a re-hire is
   *  not silenced by the time it happened to leave. */
  forget(agentId: string): void;
}

/**
 * Per-agent cooldown for the 'type' tick. Deliberately clock-free apart from the
 * `now` it is handed, so the rule is unit-testable without an AudioContext, and
 * jittered per window so repeated ticks never form a metronome.
 */
export function createTypeThrottle(random: () => number = Math.random): TypeThrottle {
  const last = new Map<string, number>();
  const window = (): number => TYPE_TICK_WINDOW_MS + Math.round(random() * TYPE_TICK_JITTER_MS);
  return {
    allow(agentId, now) {
      const prev = last.get(agentId);
      if (prev !== undefined && now - prev < window()) return false;
      last.set(agentId, now);
      return true;
    },
    forget(agentId) { last.delete(agentId); }
  };
}

interface Tone {
  /** Offset from the cue's start, seconds. */
  at: number;
  freq: number;
  /** Sweep target. A moving pitch reads as a whoosh where a fixed one beeps. */
  to?: number;
  dur: number;
  peak: number;
  wave: OscillatorType;
  /** Pitch wobble in semitones. Without it a repeated tick IS a metronome. */
  spread?: number;
}

interface Noise {
  at: number;
  dur: number;
  peak: number;
  /** Band-pass centre when the burst starts, and where it has swept by the end. */
  from: number;
  to: number;
  q?: number;
}

interface Cue {
  tone?: Tone[];
  noise?: Noise[];
}

/** Peaks sit near 0.4 so two cues at once cannot drive the master bus hard. */
const CUES: Record<SoundName, Cue> = {
  // A key cap letting go: a filtered click over a tiny wooden thump.
  type: {
    tone: [{ at: 0, freq: 320, dur: 0.035, peak: 0.5, wave: 'triangle', spread: 2.4 }],
    noise: [{ at: 0, dur: 0.028, peak: 0.22, from: 2600, to: 1100, q: 1.1 }]
  },
  // Two soft notes a fifth apart — something finished, not something broke.
  taskDone: {
    tone: [
      { at: 0, freq: 784, dur: 0.16, peak: 0.4, wave: 'sine' },
      { at: 0.11, freq: 1175, dur: 0.22, peak: 0.34, wave: 'sine' }
    ]
  },
  // A door swinging open: band-passed noise sweeping up and away.
  agentJoin: { noise: [{ at: 0, dur: 0.34, peak: 0.34, from: 480, to: 2400, q: 0.9 }] },
  // The same door, lower and closing.
  agentLeave: { noise: [{ at: 0, dur: 0.3, peak: 0.3, from: 1800, to: 380, q: 0.9 }] },
  // Muted and low on purpose: this is "that did not work", not an alarm.
  error: { tone: [{ at: 0, freq: 165, dur: 0.12, peak: 0.4, wave: 'triangle', to: 116 }] }
};

const NOOP = (): void => undefined;
/** Exponential ramps cannot reach zero, so every envelope lands just above it. */
const FLOOR = 0.0001;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let enabled = true;
let volume = DEFAULT_SOUND_VOLUME;
let watchingGesture = false;

/** The bus every cue is mixed into. Null until the first cue or gesture. */
function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctor) return null;
    ctx = new ctor();
    master = ctx.createGain();
    master.gain.value = enabled ? volume : 0;
    master.connect(ctx.destination);
  } catch {
    // No audio device, or a browser without Web Audio at all. Sound is optional
    // everywhere else in the app; it must never be the thing that throws.
    ctx = null;
    master = null;
  }
  return ctx;
}

function applyGain(): void {
  if (!ctx || !master) return;
  const target = enabled ? volume : 0;
  try {
    // A 15ms ramp, not a step: muting mid-cue would otherwise click.
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.015);
  } catch {
    master.gain.value = target;
  }
}

/** Ask the context to start playing. A refusal means "no gesture yet" — silence. */
export function resumeSound(): void {
  const context = ensureContext();
  if (!context || context.state !== 'suspended') return;
  void context.resume().catch(() => undefined);
}

/**
 * Arm the engine. Called once from the app root; it only listens for the first
 * gesture, so calling it before anything is audible is safe.
 */
export function initSound(): () => void {
  if (watchingGesture) return NOOP;
  watchingGesture = true;
  const unlock = (): void => resumeSound();
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  return () => {
    watchingGesture = false;
    window.removeEventListener('pointerdown', unlock, { capture: true });
    window.removeEventListener('keydown', unlock, { capture: true });
  };
}

/** Master mute. Applies to whatever is already sounding, so the toggle is instant. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  applyGain();
}

/** Master level, 0..1. Applied immediately — the top-bar control is a live fader. */
export function setSoundVolume(value: number): void {
  volume = clampVolume(value);
  applyGain();
}

function noiseFor(context: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const frames = Math.ceil(context.sampleRate * 1);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

function scheduleTone(context: AudioContext, out: AudioNode, tone: Tone, t0: number): void {
  const start = t0 + tone.at;
  const osc = context.createOscillator();
  const env = context.createGain();
  // One draw per tone, so a two-note cue stays harmonically coherent while
  // successive ticks of the same cue do not.
  const detune = tone.spread ? 2 ** ((Math.random() * 2 - 1) * tone.spread / 12) : 1;
  osc.type = tone.wave;
  osc.frequency.setValueAtTime(tone.freq * detune, start);
  if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to * detune, start + tone.dur);
  env.gain.setValueAtTime(FLOOR, start);
  env.gain.exponentialRampToValueAtTime(tone.peak, start + 0.004);
  env.gain.exponentialRampToValueAtTime(FLOOR, start + tone.dur);
  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + tone.dur + 0.02);
}

function scheduleNoise(context: AudioContext, out: AudioNode, hit: Noise, t0: number): void {
  const start = t0 + hit.at;
  const src = context.createBufferSource();
  const band = context.createBiquadFilter();
  const env = context.createGain();
  src.buffer = noiseFor(context);
  band.type = 'bandpass';
  band.Q.value = hit.q ?? 1;
  band.frequency.setValueAtTime(hit.from, start);
  band.frequency.exponentialRampToValueAtTime(hit.to, start + hit.dur);
  env.gain.setValueAtTime(FLOOR, start);
  env.gain.exponentialRampToValueAtTime(hit.peak, start + hit.dur * 0.25);
  env.gain.exponentialRampToValueAtTime(FLOOR, start + hit.dur);
  src.connect(band).connect(env).connect(out);
  src.start(start);
  src.stop(start + hit.dur + 0.02);
}

/** Play one cue. Silent (never throwing) before the first gesture, when muted,
 *  or on a build with no Web Audio. */
export function playSound(name: SoundName): void {
  if (!enabled) return;
  const cue = CUES[name];
  if (!cue) return;
  const context = ensureContext();
  if (!context || !master || context.state !== 'running') return;
  const t0 = context.currentTime + 0.001;
  for (const tone of cue.tone ?? []) scheduleTone(context, master, tone, t0);
  for (const hit of cue.noise ?? []) scheduleNoise(context, master, hit, t0);
}

/** Test seam: drop the cached context and buffers so a fresh engine is built. */
export function resetSoundEngine(): void {
  ctx = null;
  master = null;
  noiseBuffer = null;
  enabled = true;
  volume = DEFAULT_SOUND_VOLUME;
  watchingGesture = false;
}