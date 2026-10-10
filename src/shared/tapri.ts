/**
 * Tapri — the chai-stall discussion level. No agents, no terminals: a handful of
 * characters chat over chai and the words come from whichever CLI the user picks.
 *
 * This module is the contract between the renderer (scene + conversation loop) and
 * main (CLI one-shot + ElevenLabs voice). Pure and dependency-free, so both sides —
 * and plain-node tests — can import it.
 */

export type TapriMood =
  | 'neutral' | 'interested' | 'wow' | 'confused' | 'sayAgain'
  | 'hating' | 'furious' | 'laughing' | 'bored';

const MOODS: readonly TapriMood[] = [
  'neutral', 'interested', 'wow', 'confused', 'sayAgain', 'hating', 'furious', 'laughing', 'bored',
];

export function isTapriMood(v: unknown): v is TapriMood {
  return typeof v === 'string' && (MOODS as readonly string[]).includes(v);
}

/* ── Cast ─────────────────────────────────────────────────────────────────── */

export interface TapriCharacter {
  id: string;
  name: string;
  /** Picks a female voice when Hindi voices are matched by gender. */
  female?: boolean;
  /** Sprite outfit (see renderer/tapri/types.ts Outfit). */
  outfit: 'tapriwala' | 'baniyan' | 'dhoti' | 'kurta' | 'uncle' | 'aunty' | 'student' | 'officegoer' | 'cop' | 'driver';
  variant: number;
  /** One line the CLI is given so each voice stays distinct. */
  persona: string;
  /** ElevenLabs premade voice id (stock library). */
  voice: string;
}

export const ME_ID = 'me';
export const OWNER_ID = 'chhotu';

/** Stock ElevenLabs premade voices. Rachel/Adam/… exist in every account's library. */
export const TAPRI_CAST: readonly TapriCharacter[] = [
  { id: OWNER_ID, name: 'Chhotu', outfit: 'tapriwala', variant: 0, voice: 'TxGEqnHWrfWFTfGW9XjX',
    persona: 'the chai-wala. Hears everything, pours with a smirk, drops one-line wisdom and prices ("das rupaye, bhaiya").' },
  { id: 'sharma', name: 'Sharma ji', outfit: 'uncle', variant: 1, voice: 'pNInz6obpgDQGcFmaJgB',
    persona: 'retired clerk, news-channel addict, certain he is always right, loves lecturing about politics and "system".' },
  { id: 'bhola', name: 'Bhola Kaka', outfit: 'dhoti', variant: 0, voice: 'VR6AewLTigWG4xSOukaG',
    persona: 'elderly village man in dhoti, slow, proverbs and old-days nostalgia, suspicious of anything new.' },
  { id: 'pappu', name: 'Pappu Bhai', outfit: 'kurta', variant: 2, voice: 'ErXwobaYiN019PkySvjV',
    persona: 'kurta-clad local neta wannabe, gossip hub, hints he knows insiders, exaggerates.' },
  { id: 'gopal', name: 'Gopal', outfit: 'baniyan', variant: 1, voice: 'yoZ06aMxZJJ28mfd3POQ',
    persona: 'baniyan-wearing shopkeeper, thinks about prices, GST, fuel and business first; sarcastic.' },
  { id: 'rinku', name: 'Rinku', outfit: 'student', variant: 3, voice: 'IKne3meq5aSn9XLyUdCD',
    persona: 'college kid, backpacker, gives travel hacks, cheap train/bus tricks and offbeat locations; modern slang.' },
  { id: 'meena', name: 'Meena Aunty', female: true, outfit: 'aunty', variant: 0, voice: '21m00Tcm4TlvDq8ikWAM',
    persona: 'sharp-tongued neighbourhood aunty: society gossip, food, markets, shortcuts, bargains.' },
  { id: 'verma', name: 'Verma Sahab', outfit: 'officegoer', variant: 2, voice: 'JBFqnCBsd6RMkjVDRZzb',
    persona: 'weary office-goer, waiting for a cab, cynical about jobs, EMIs, metro and traffic.' },
  { id: 'yadav', name: 'Havaldar Yadav', outfit: 'cop', variant: 0, voice: '2EiwWnXFnvU5JabPnv8n',
    persona: 'traffic hawaldar on chai break, knows every road and challan trick; blunt.' },
  { id: 'munna', name: 'Munna', outfit: 'driver', variant: 1, voice: 'N2lVS1w4EtoT3dr4eOWO',
    persona: 'auto driver, knows every lane and fare trick; strong opinions on cabs, fuel prices and tourists.' },
];

export function characterById(id: string): TapriCharacter | undefined {
  return TAPRI_CAST.find((c) => c.id === id);
}

/** Voice for the user themself (they type; this only matters if "speak my lines" is on). */
export const ME_VOICE = 'pNInz6obpgDQGcFmaJgB';

/* ── Topics ───────────────────────────────────────────────────────────────── */

export type TopicKind = 'india' | 'world' | 'gossip' | 'tips' | 'travel' | 'random';

export const TOPIC_LABELS: Record<TopicKind, string> = {
  india: 'India today',
  world: 'World news',
  gossip: 'Political gossip',
  tips: 'Tips & tricks',
  travel: 'Travel & places',
  random: 'Surprise us',
};

const TOPIC_BRIEF: Record<TopicKind, string> = {
  india: 'a current-affairs topic in India (economy, elections, policy, cities, infrastructure, sport, cinema)',
  world: 'a current world-affairs topic as seen from an Indian street (trade, wars, oil, diaspora, cricket, tech)',
  gossip: 'light political gossip — rumours and opinions about public politics, framed as banter, never as proven fact',
  tips: 'practical tips and tricks (money, jugaad, commute, phones, food, bargaining, health)',
  travel: 'travel and locations — where to go, how to get there cheaply, what to eat, what to avoid',
  random: 'anything a group at a chai tapri would argue about',
};

/** Which topic a "start a topic" click uses; `random` rotates so it is never the same. */
export function pickTopicKind(n: number): TopicKind {
  const order: TopicKind[] = ['india', 'gossip', 'tips', 'travel', 'world'];
  return order[Math.abs(n) % order.length];
}

/* ── Language ─────────────────────────────────────────────────────────────── */

export type TapriLanguage = 'en' | 'hi';
/** Tapri speaks Hindi. English stays in the type for the prompt builder but is not offered. */
export const DEFAULT_LANGUAGE: TapriLanguage = 'hi';

/** The person at the table. Everyone at the tapri calls them by name. */
export const USER_NAME = 'Vaibhav';
export const USER_NAME_HI = 'वैभव';
export const userLabel = (lang: TapriLanguage): string => (lang === 'hi' ? USER_NAME_HI : USER_NAME);
export const TAPRI_LANGUAGES: { id: TapriLanguage; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिन्दी (Hindi)' },
];
export function isTapriLanguage(v: unknown): v is TapriLanguage { return v === 'en' || v === 'hi'; }

const LANGUAGE_RULE: Record<TapriLanguage, string> = {
  en: 'Plain, natural English. No Hindi words, no Hinglish.',
  hi: 'Standard Hindi (शुद्ध हिंदी) written in Devanagari script only. No Roman letters, no Hinglish, no English words.',
};

/* ── CLI engines ──────────────────────────────────────────────────────────── */

export type TapriCliId = 'claude' | 'codex' | 'gemini' | 'qwen' | 'opencode';

export interface TapriCli {
  id: TapriCliId;
  label: string;
  /** Binary resolved through the user's PATH. */
  command: string;
  /** Leading argv; the prompt always goes in on stdin, never in argv, so text
   *  typed at the tapri can never be parsed as a flag or shell syntax. */
  args: readonly string[];
  /** Install hint shown when the binary is missing. */
  install: string;
  /** 'claude' = stream-json events: lets each line be spoken as soon as it is written. */
  stream?: 'claude';
}

export const TAPRI_CLIS: readonly TapriCli[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude',
    // Sonnet answers at once; the Haiku models spend 6-55s thinking first (measured), which kills a chat.
    stream: 'claude',
    args: ['-p', '--model', 'claude-sonnet-5-5', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence',
      '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'],
    install: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex', label: 'Codex · GPT', command: 'codex',
    args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'],
    install: 'npm install -g @openai/codex' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini',
    args: ['-m', 'gemini-2.5-flash', '-p', ' '], install: 'npm install -g @google/gemini-cli' },
  { id: 'qwen', label: 'Qwen Code', command: 'qwen',
    args: ['-p', ' '], install: 'npm install -g @qwen-code/qwen-code' },
  { id: 'opencode', label: 'OpenCode', command: 'npx',
    args: ['--yes', 'opencode-ai', 'run'], install: 'npm install -g opencode-ai' },
];

export function isTapriCliId(v: unknown): v is TapriCliId {
  return typeof v === 'string' && TAPRI_CLIS.some((c) => c.id === v);
}

/* ── One round of talk ────────────────────────────────────────────────────── */

export interface TapriLine {
  speaker: string; // character id, or ME_ID
  text: string;
}

export interface TapriTurn {
  speaker: string;
  text: string;
  /** How each OTHER person at the table reacts while this line is spoken. */
  reactions: Record<string, TapriMood>;
}

export interface TapriRound {
  turns: TapriTurn[];
  /** Rolling summary. Only filled when the model volunteers one; the Summarize button asks for it. */
  summary: string[];
  /** Characters the model says storm off (also derived from anger in the scene). */
  leaves: string[];
}

export interface TapriTalkRequest {
  /** Routes streamed `tapri:turn` events back to the round that asked for them. */
  id?: string;
  cli: TapriCliId;
  language?: TapriLanguage;
  /** Who is at the tapri right now (character ids; never includes the user). */
  present: string[];
  history: TapriLine[];
  /** What the user just said, if anything. */
  userSaid?: string;
  /** Topic to open when nobody has said anything yet / the user asked for a new one. */
  topic?: TopicKind;
  summary: string[];
}

export const MAX_LINE = 240;
const MAX_HISTORY = 12;

const who = (speaker: string, lang: TapriLanguage): string =>
  speaker === ME_ID ? userLabel(lang) : (characterById(speaker)?.name ?? speaker);

export function buildTalkPrompt(req: TapriTalkRequest): string {
  const lang = req.language ?? DEFAULT_LANGUAGE;
  const me = userLabel(lang);
  const people = req.present
    .map(characterById)
    .filter((c): c is TapriCharacter => !!c)
    .map((c) => `- ${c.id}: ${c.name}, ${c.persona}`)
    .join('\n');
  const ids = req.present.join(', ');
  const hist = req.history.slice(-MAX_HISTORY)
    .map((l) => `${who(l.speaker, lang)}: ${l.text}`)
    .join('\n');
  const opener = req.userSaid
    ? `${me} just said: "${req.userSaid.slice(0, 600)}". The FIRST line must answer ${me} directly, by name.`
    : req.topic
      ? `Nobody is talking yet. One of them opens with ${TOPIC_BRIEF[req.topic]}, then the others join in and bring ${me} into it by name.`
      : `Continue the conversation naturally: someone answers, someone disagrees, someone asks ${me} what they think.`;
  return [
    `You write dialogue for "Chai Tapri", a roadside tea-stall in India. ${USER_NAME} (${USER_NAME_HI}) sits there sipping chai; everyone knows them and calls them by name ("${me} जी", "${me} भाई" in Hindi). Never call them "the user".`,
    'Output JSON Lines: ONE JSON object per line, nothing else (no fence, no commentary). Be fast.',
    '',
    'People at the tapri (use these exact ids for "speaker"):',
    people,
    '',
    'Rules:',
    `- Language: ${LANGUAGE_RULE[lang]}`,
    '- Exactly 2 lines, each at most 70 characters, short and punchy (every extra character costs seconds). Speakers must come from this list only: ' + ids + `. Never write lines for ${me}.`,
    '- Topics: Indian and world current affairs (mostly India), political gossip, tips and tricks, places and travel. Opinionated banter; no live news, so hedge on specifics and make no accusations about private individuals.',
    '- "reactions" is optional and tiny: at most 2 other people, each one mood from neutral, interested, wow, confused, sayAgain, hating, furious, laughing, bored. Mix them up.',
    '- If a line would make someone truly angry, give them "furious"; add a last line {"leaves":["<id>"]} only when they storm off.',
    '',
    'Line shape (one per line):',
    '{"speaker":"<id>","text":"...","reactions":{"<id>":"interested"}}',
    '',
    req.summary.length ? `Talk so far (summary):\n${req.summary.map((x) => `* ${x}`).join('\n')}\n` : '',
    hist ? `Conversation so far:\n${hist}\n` : '',
    opener,
  ].filter((x) => x !== '').join('\n');
}

/** Prompt for the Summarize button: a short rolling summary of the whole talk. */
export function buildSummaryPrompt(history: TapriLine[], prev: string[], lang: TapriLanguage = DEFAULT_LANGUAGE): string {
  const hist = history.slice(-30)
    .map((l) => `${who(l.speaker, lang)}: ${l.text}`)
    .join('\n');
  return [
    'Summarise this chai-tapri conversation. Output ONLY one JSON object, no fence: {"summary":["...", "..."]}',
    `- ${LANGUAGE_RULE[lang]}`,
    `- 3 to 6 bullets, each at most 90 characters; say who said what and what ${userLabel(lang)} said; merge with the earlier summary.`,
    prev.length ? `Earlier summary:
${prev.map((x) => `* ${x}`).join('\n')}
` : '',
    `Conversation:
${hist}`,
  ].filter((x) => x !== '').join('\n');
}

export function parseSummaryResponse(raw: string): string[] | null {
  const json = firstJsonObject(raw);
  if (!json) return null;
  try {
    const o = JSON.parse(json) as { summary?: unknown };
    if (!Array.isArray(o.summary)) return null;
    const out = o.summary.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 140)).slice(0, 6);
    return out.length ? out : null;
  } catch { return null; }
}

/** Extract the first balanced top-level JSON object from CLI output (models love fences). */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function cleanTurn(t: unknown, here: Set<string>): TapriTurn | null {
  if (!t || typeof t !== 'object') return null;
  const { speaker, text, reactions } = t as { speaker?: unknown; text?: unknown; reactions?: unknown };
  if (typeof speaker !== 'string' || !here.has(speaker)) return null;
  if (typeof text !== 'string' || !text.trim()) return null;
  const clean: Record<string, TapriMood> = {};
  if (reactions && typeof reactions === 'object') {
    for (const [id, mood] of Object.entries(reactions as Record<string, unknown>)) {
      if (id !== speaker && here.has(id) && isTapriMood(mood)) clean[id] = mood;
    }
  }
  return { speaker, text: text.trim().slice(0, MAX_LINE), reactions: clean };
}

/** One complete line of CLI output → a turn (or the final leaves marker). Streaming callers use this
 *  to start the first person talking before the CLI has finished writing the rest. */
export function parseTurnLine(line: string, present: string[]): { turn?: TapriTurn; leaves?: string[] } | null {
  const t = line.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  let o: unknown;
  try { o = JSON.parse(t); } catch { return null; }
  const here = new Set(present);
  const turn = cleanTurn(o, here);
  if (turn) return { turn };
  const lv = (o as { leaves?: unknown } | null)?.leaves;
  if (Array.isArray(lv)) return { leaves: lv.filter((x): x is string => typeof x === 'string' && here.has(x)) };
  return null;
}

/**
 * Turn raw CLI text into a validated round. Anything the scene could not honour
 * (unknown speaker, someone not present, empty text) is dropped rather than trusted.
 * Accepts JSON Lines (preferred) and the older single {"turns":[...]} object.
 */
export function parseTalkResponse(raw: string, present: string[]): TapriRound | null {
  const here = new Set(present);
  const turns: TapriTurn[] = [];
  let leaves: string[] = [];
  let summary: string[] = [];
  for (const line of raw.split('\n')) {
    const r = parseTurnLine(line, present);
    if (r?.turn) turns.push(r.turn);
    else if (r?.leaves) leaves = r.leaves;
  }
  if (!turns.length) {
    const json = firstJsonObject(raw);
    if (!json) return null;
    let obj: unknown;
    try { obj = JSON.parse(json); } catch { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as { turns?: unknown; summary?: unknown; leaves?: unknown };
    if (!Array.isArray(o.turns)) return null;
    for (const t of o.turns) { const c2 = cleanTurn(t, here); if (c2) turns.push(c2); }
    if (Array.isArray(o.summary)) {
      summary = o.summary.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, 6);
    }
    if (Array.isArray(o.leaves)) leaves = o.leaves.filter((x): x is string => typeof x === 'string' && here.has(x));
  }
  if (!turns.length) return null;
  return { turns, summary, leaves };
}

/** When the CLI gave no usable summary, keep a rough one from the lines themselves. */
export function fallbackSummary(prev: string[], lines: TapriLine[]): string[] {
  const add = lines.slice(-3).map((l) => {
    const name = who(l.speaker, DEFAULT_LANGUAGE);
    const t = l.text.length > 80 ? `${l.text.slice(0, 77)}…` : l.text;
    return `${name}: ${t}`;
  });
  return [...prev, ...add].slice(-6);
}

/** Reading time for a bubble when no voice plays: ~14 chars/s plus a beat. */
export function readingMs(text: string): number {
  return Math.min(9000, 1400 + Math.round(text.length * 62));
}

/* ── IPC shapes ───────────────────────────────────────────────────────────── */

export type TapriTalkResult =
  | { ok: true; round: TapriRound }
  | { ok: false; error: string; missing?: boolean };

export interface TapriSummaryRequest {
  cli: TapriCliId;
  language?: TapriLanguage;
  history: TapriLine[];
  summary: string[];
}

export type TapriSummaryResult = { ok: true; summary: string[] } | { ok: false; error: string };

export interface TapriCliStatus {
  id: TapriCliId;
  label: string;
  installed: boolean;
  install: string;
}

export type TapriSpeakResult =
  | { ok: true; audioBase64: string; mime: string }
  | { ok: false; error: string; code?: 'no_key' | 'quota' | 'network' | 'voice' };
