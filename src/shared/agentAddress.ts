// Natural-language routing for the chat composer: "tell michael to …", "hey
// principal", "wake jim", "I need two more agents". Pure parsing — the composer
// decides what to do with the result (wake, open, queue, hire).

export type Address =
  | { kind: 'agent'; name: string; body: string; wake: boolean }
  | { kind: 'more'; count: number; body: string };

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, another: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
export const MAX_MORE_AGENTS = 6;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FILLER = '(?:(?:hey|hi|hello|yo|ok|okay|please|pls|so|now)[\\s,]+)*';

/** "I need more agents", "add 2 more workers", "get me another agent". */
export function parseMoreAgents(text: string): { count: number } | null {
  const t = String(text ?? '').trim();
  if (!t || t.length > 400) return null;
  const noun = '(?:agents?|workers?|people|hands|staff|team ?mates?|colleagues|employees)';
  const asks = new RegExp(
    `\\b(?:need|want|require|demand|get|add|hire|bring|call|spawn|summon|wake|give)\\b[^.?!\\n]{0,40}?\\b(?:(more|another|extra|\\d{1,2}|one|two|three|four|five|six)\\b[^.?!\\n]{0,20}?)${noun}\\b`, 'i');
  const m = asks.exec(t) ?? new RegExp(`\\b(more|another|extra)\\s+${noun}\\b`, 'i').exec(t);
  if (!m) return null;
  const word = (m[1] ?? m[0]).toLowerCase();
  const num = /\b(\d{1,2})\b/.exec(m[0]);
  const count = num ? Number(num[1])
    : NUMBER_WORDS[word] ?? NUMBER_WORDS[(/\b(one|two|three|four|five|six)\b/i.exec(m[0])?.[1] ?? '').toLowerCase()] ?? 2;
  return { count: Math.min(MAX_MORE_AGENTS, Math.max(1, count)) };
}

/**
 * Is this message for somebody else? `names` are the agents you can talk to
 * (open or asleep). `current` is the chat you are typing in — addressing
 * yourself is just talking, so it routes nowhere (except "wake X" when X is asleep,
 * which the caller handles by passing current = '').
 */
export function parseAddress(text: string, names: readonly string[], current = ''): Address | null {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!t) return null;

  const more = parseMoreAgents(t);
  if (more) return { kind: 'more', count: more.count, body: t };

  const known = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!known.length) return null;
  const alt = known.map(escape).join('|');
  const verb = '(tell|ask|ping|call|wake(?:\\s+up)?|get|message|notify|inform|let|have|talk\\s+to|speak\\s+to|check\\s+with|forward\\s+to|send\\s+to|bring)';
  const tail = '[\\s,:;!.-]*(?:(?:to|that|about)\\s+)?';
  const patterns: Array<{ re: RegExp; nameAt: number; bodyAt: number; verbAt?: number }> = [
    // "tell michael to …", "wake up jim", "ask the principal …"
    { re: new RegExp(`^${FILLER}${verb}\\s+(?:the\\s+)?(${alt})\\b${tail}([\\s\\S]*)$`, 'i'), verbAt: 1, nameAt: 2, bodyAt: 3 },
    // "to michael: …", "for michael …"
    { re: new RegExp(`^${FILLER}(?:to|for)\\s+(?:the\\s+)?(${alt})\\b[\\s,:;!.-]*([\\s\\S]*)$`, 'i'), nameAt: 1, bodyAt: 2 },
    // "hey michael, …", "hello principal"
    { re: new RegExp(`^(?:hey|hi|hello|yo|oi|dear)[\\s,]+(?:the\\s+)?(${alt})\\b[\\s,:;!.-]*([\\s\\S]*)$`, 'i'), nameAt: 1, bodyAt: 2 },
    // "michael, …" / "michael: …"
    { re: new RegExp(`^(?:the\\s+)?(${alt})\\s*[,:]\\s*([\\s\\S]+)$`, 'i'), nameAt: 1, bodyAt: 2 },
  ];
  for (const p of patterns) {
    const m = p.re.exec(t);
    if (!m) continue;
    const typed = m[p.nameAt];
    const name = known.find((n) => n.toLowerCase() === typed.toLowerCase());
    if (!name) continue;
    const verbWord = p.verbAt ? m[p.verbAt].toLowerCase() : '';
    const body = (m[p.bodyAt] ?? '').trim();
    const wake = verbWord.startsWith('wake') || verbWord === 'call' || verbWord === 'bring' || !body;
    // Addressing the chat you are already in is just conversation.
    if (current && name.toLowerCase() === current.toLowerCase() && !verbWord.startsWith('wake')) continue;
    return { kind: 'agent', name, body, wake };
  }
  return null;
}
