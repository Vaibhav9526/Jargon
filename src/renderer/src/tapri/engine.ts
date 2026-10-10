// Tapri conversation director. Owns the loop that asks the chosen CLI for a round of
// chatter, plays it line by line (bubble + optional ElevenLabs voice), drives the
// patrons' reactions, and lets people storm off when pushed too far.
// Everything that touches the outside world is injected, so the director runs in plain
// node tests with a fake clock and a fake CLI.
import {
  ME_ID, OWNER_ID, TAPRI_CAST, fallbackSummary, pickTopicKind, readingMs,
  type TapriCliId, type TapriLanguage, type TapriLine, type TapriSummaryRequest, type TapriSummaryResult,
  type TapriTalkRequest, type TapriTalkResult, type TapriTurn, type TopicKind,
} from '@shared/tapri';
import { patronCount, personById, react, say, sendAway, spawnPatron, stopSaying, type World } from './sim';
import type { Mood } from './types';

export interface EngineDeps {
  /** Ask the CLI for a round. `onTurn` fires for each line the moment it is complete (streaming),
   *  so the first person can start talking while the rest is still being written. */
  talk: (req: TapriTalkRequest, onTurn: (turn: TapriTurn) => void) => Promise<TapriTalkResult>;
  /** Resolves when the line has been heard (or immediately when voice is unavailable). */
  /** Fetch a voiced line (not yet playing). `start` begins playback. */
  speak: (speaker: string, text: string, language: TapriLanguage) => Promise<{ ok: boolean; start?: () => void; stop?: () => void; error?: string; code?: string }>;
  /** Wait for audio started by `speak`, resolving early if it finishes. */
  settle: (handle: { stop?: () => void } | null, maxMs: number) => Promise<void>;
  /** Ask the CLI for a fresh summary of the whole talk. */
  summarize: (req: TapriSummaryRequest) => Promise<TapriSummaryResult>;
  world: () => World;
}

export interface EngineState {
  lines: TapriLine[];
  summary: string[];
  busy: boolean;
  status: string;
  error: string;
  cli: TapriCliId;
  language: TapriLanguage;
  voice: boolean;
  auto: boolean;
  /** True while the Summarize button's CLI call is running. */
  summarizing: boolean;
  /** Who is at the tapri (patrons only). */
  present: string[];
}

export const MAX_AUTO_ROUNDS = 3;
const TARGET_CROWD = 4;
const FIRST_GUESTS = 2;

const DEFAULT_BASE: Mood = 'neutral';

export interface Engine {
  state(): EngineState;
  subscribe(fn: () => void): () => void;
  start(): void;
  stop(): void;
  setCli(id: TapriCliId): void;
  setLanguage(lang: TapriLanguage): void;
  /** The Summarize button: one CLI call that rewrites the summary. */
  summarize(): Promise<void>;
  setVoice(on: boolean): void;
  setAuto(on: boolean): void;
  /** The user says something; the table reacts. */
  userSays(text: string): Promise<void>;
  /** Ask the table to open a topic (one of the patrons starts it). */
  startTopic(kind?: TopicKind): Promise<void>;
  /** Advance arrivals + auto-chat. Called on a timer by the UI; also called directly in tests. */
  step(): void;
}

export function createEngine(deps: EngineDeps, init: Partial<Pick<EngineState, 'cli' | 'voice' | 'auto' | 'language'>> = {}): Engine {
  const st: EngineState = {
    lines: [], summary: [], busy: false, status: '', error: '', present: [], summarizing: false,
    cli: init.cli ?? 'claude', language: init.language ?? 'en', voice: init.voice ?? false, auto: init.auto ?? true,
  };
  const subs = new Set<() => void>();
  const emit = () => { st.present = presentIds(); for (const f of subs) f(); };
  let running = false;
  let playing = false;
  let nextArrivalAt = 0;
  let nextRoundAt = 0;
  let autoRounds = 0;
  let topicN = Math.floor(Math.random() * 5);
  let guests = 0;
  let epoch = 0; // bumps on stop(), so a round that returns after leaving is discarded

  const world = () => deps.world();
  const presentIds = (): string[] => world().people.filter((p) => p.role === 'patron' && !p.leaving).map((p) => p.id);
  const talkingTo = (): string[] => [OWNER_ID, ...presentIds()];

  function addLine(speaker: string, text: string): void {
    st.lines.push({ speaker, text });
    if (st.lines.length > 60) st.lines.splice(0, st.lines.length - 60);
  }

  function admitNext(): void {
    const w = world();
    const here = new Set(w.people.map((p) => p.id));
    const pool = TAPRI_CAST.filter((c) => c.id !== OWNER_ID && !here.has(c.id));
    if (!pool.length) return;
    const c = pool[Math.floor(w.rng() * pool.length)];
    spawnPatron(w, { id: c.id, name: c.name, style: { outfit: c.outfit, variant: c.variant } });
    guests++;
  }

  type Fetched = Awaited<ReturnType<EngineDeps['speak']>>;

  async function playTurn(turn: TapriTurn, leaves: Set<string>, fetched?: Promise<Fetched>): Promise<void> {
    const w = world();
    const speaker = personById(w, turn.speaker);
    if (!speaker || speaker.leaving) return;
    addLine(turn.speaker, turn.text);
    // Listeners react to this line.
    const angry: string[] = [];
    for (const p of w.people) {
      if (p.id === turn.speaker || (p.role !== 'patron' && p.role !== 'owner' && p.role !== 'me')) continue;
      const mood = turn.reactions[p.id] ?? (p.role === 'patron' ? 'interested' : DEFAULT_BASE);
      if (react(w, p.id, mood, 4200)) angry.push(p.id);
    }
    const reading = readingMs(turn.text);
    say(w, turn.speaker, turn.text, st.voice && fetched ? 20_000 : reading);
    emit();
    let handle: { stop?: () => void } | null = null;
    if (st.voice && fetched) {
      // Already fetching since the round arrived; wait at most a few seconds for it.
      const r = await Promise.race([fetched, new Promise<Fetched>((res) => setTimeout(() => res({ ok: false }), 6000))]);
      if (r.ok) { handle = r; r.start?.(); }
      else if (r.error) { st.error = r.error; if (r.code === 'no_key' || r.code === 'quota') st.voice = false; }
    }
    await deps.settle(handle, st.voice && handle ? 20_000 : reading);
    stopSaying(w, turn.speaker);
    for (const id of angry) leaves.add(id);
    emit();
  }

  function stormOff(id: string): void {
    const w = world();
    const p = personById(w, id);
    if (!p || p.leaving) return;
    react(w, id, 'furious', 3000);
    say(w, id, pickExit(w.rng(), st.language), 2600);
    addLine(id, '*stands up and storms off*');
    sendAway(w, id, w.rng() < 0.35 ? 'cab' : 'walk');
    nextArrivalAt = w.t + 6000;
    emit();
  }

  async function round(extra: Pick<TapriTalkRequest, 'userSaid' | 'topic'>): Promise<void> {
    if (st.busy) return;
    const w = world();
    if (!presentIds().length) { st.status = 'Waiting for someone to walk in…'; emit(); return; }
    const myEpoch = epoch;
    st.busy = true; st.error = ''; st.status = 'The tapri is thinking…'; emit();

    const lang = st.language;
    const queue: TapriTurn[] = [];
    const fetched: (Promise<Fetched> | undefined)[] = [];
    let finished = false;
    let result: TapriTalkResult | null = null;
    let wake: (() => void) | null = null;
    const poke = (): void => { const f = wake; wake = null; f?.(); };
    // Every voice is requested the moment its line exists, so it is usually ready when its turn comes.
    const enqueue = (t: TapriTurn): void => {
      queue.push(t);
      fetched.push(st.voice ? deps.speak(t.speaker, t.text, lang).catch((): Fetched => ({ ok: false })) : undefined);
      poke();
    };
    deps.talk(
      { cli: st.cli, language: lang, present: talkingTo(), history: st.lines.slice(-10), summary: st.summary, ...extra },
      (t) => { if (myEpoch === epoch) enqueue(t); },
    ).then(
      (r) => { result = r; finished = true; poke(); },
      (e) => { result = { ok: false, error: e instanceof Error ? e.message : String(e) }; finished = true; poke(); },
    );

    const leaves = new Set<string>();
    let i = 0;
    try {
      for (;;) {
        if (myEpoch !== epoch) return;
        if (i < queue.length) {
          playing = true; st.status = '';
          await playTurn(queue[i], leaves, fetched[i]);
          i++;
          continue;
        }
        if (finished) {
          // A CLI that does not stream hands everything over at the end.
          const done = result as TapriTalkResult | null;
          if (done && done.ok && done.round.turns.length > queue.length) {
            for (const t of done.round.turns.slice(queue.length)) enqueue(t);
            continue;
          }
          break;
        }
        await new Promise<void>((r) => { wake = r; });
      }
    } finally {
      playing = false;
      st.busy = false;
    }
    const res = result as TapriTalkResult | null;
    if (!res || !res.ok) {
      st.status = ''; st.error = res ? res.error : 'No answer.';
      if (!queue.length) autoRounds = MAX_AUTO_ROUNDS;
      emit();
      return;
    }
    st.status = '';
    for (const id of res.round.leaves) leaves.add(id);
    for (const id of leaves) stormOff(id);
    // A rough local summary after every round (free); the Summarize button asks the CLI for a proper one.
    st.summary = res.round.summary.length ? res.round.summary : fallbackSummary(st.summary, st.lines);
    nextRoundAt = w.t + 1200 + w.rng() * 1200;
    emit();
  }

  return {
    state: () => st,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    start() {
      running = true;
      const w = world();
      nextArrivalAt = w.t + 1500;
      nextRoundAt = w.t + 7000;
      emit();
    },
    stop() { running = false; epoch++; st.busy = false; playing = false; },
    setCli(id) { st.cli = id; st.error = ''; emit(); },
    setLanguage(lang) { st.language = lang; emit(); },
    async summarize() {
      if (st.summarizing) return;
      if (!st.lines.length) { st.error = st.language === 'hi' ? 'अभी सारांश के लिए कुछ नहीं है।' : 'Nothing to summarise yet.'; emit(); return; }
      st.summarizing = true; st.error = ''; emit();
      try {
        const r = await deps.summarize({ cli: st.cli, language: st.language, history: st.lines.slice(-30), summary: st.summary });
        if (r.ok) st.summary = r.summary; else st.error = r.error;
      } catch (e) { st.error = e instanceof Error ? e.message : String(e); }
      st.summarizing = false; emit();
    },
    setVoice(on) { st.voice = on; emit(); },
    setAuto(on) { st.auto = on; autoRounds = 0; emit(); },
    async userSays(text) {
      const t = text.trim().slice(0, 500);
      if (!t) return;
      const w = world();
      addLine(ME_ID, t);
      say(w, ME_ID, t, readingMs(t));
      react(w, ME_ID, 'neutral', 1000);
      // Instant feedback while the CLI thinks: a couple of regulars turn to listen.
      const listeners = w.people.filter((p) => p.role === 'patron' && !p.leaving);
      const moods = ['interested', 'sayAgain', 'confused', 'wow'] as const;
      for (const p of listeners.slice(0, 3)) react(w, p.id, moods[Math.floor(w.rng() * moods.length)], 4000, false);
      autoRounds = 0;
      emit();
      await round({ userSaid: t });
    },
    async startTopic(kind) {
      autoRounds = 0;
      await round({ topic: kind ?? pickTopicKind(topicN++) });
    },
    step() {
      if (!running) return;
      const w = world();
      if (w.t >= nextArrivalAt) {
        const crowd = patronCount(w);
        const want = guests < FIRST_GUESTS ? FIRST_GUESTS : TARGET_CROWD;
        if (crowd < want) admitNext();
        nextArrivalAt = w.t + 7000 + w.rng() * 9000;
      }
      if (!st.busy && !playing && st.auto && autoRounds < MAX_AUTO_ROUNDS && w.t >= nextRoundAt && presentIds().length) {
        const opener = st.lines.length === 0;
        autoRounds++;
        void round(opener ? { topic: pickTopicKind(topicN++) } : {});
      } else if (!st.busy && st.auto && autoRounds >= MAX_AUTO_ROUNDS && !st.status) {
        st.status = 'They are waiting for your take…'; emit();
      }
    },
  };
}

const EXITS: Record<TapriLanguage, string[]> = {
  en: [
    'That is enough! I am leaving.',
    'There is no point talking to you people!',
    'Stop wasting my time. I am going!',
    'Put my tea on the bill, I am out of here!',
    'I cannot listen to this nonsense!',
  ],
  hi: [
    'बस, बहुत हो गया! मैं चला।',
    'आप लोगों से बात करना ही बेकार है!',
    'मेरा समय मत खराब करो, मैं जा रहा हूँ!',
    'चाय के पैसे जोड़ लेना, मैं निकल रहा हूँ!',
    'यह बकवास मुझसे नहीं सुनी जाती!',
  ],
};
function pickExit(r: number, lang: TapriLanguage): string { const l = EXITS[lang]; return l[Math.floor(r * l.length) % l.length]; }
