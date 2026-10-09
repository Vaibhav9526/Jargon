// Office chat: turns an agent's Claude Code transcript (JSONL) into chat bubbles.
// The transcript is the single source of truth for what the user and the agent
// actually said — messages typed in the terminal and in the chat both land in it.
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir } from './transcript';

export interface ChatLine {
  id: string;
  role: 'user' | 'agent';
  text: string;
  ts: number;
}

const TAIL_BYTES = 3 * 1024 * 1024; // long sessions: only the recent end matters
const MAX_TEXT = 20_000;

/** Text of a message `content` (string or blocks), ignoring tools/thinking/images. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text') {
      const t = (b as { text?: unknown }).text;
      if (typeof t === 'string') parts.push(t);
    }
  }
  return parts.join('\n\n');
}

/** Harness-injected "user" turns (system reminders, command echoes, caveats) are
 *  not something the person wrote, so they never become bubbles. */
function isInjected(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('<') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted');
}

export function parseTranscript(jsonl: string, limit = 200): ChatLine[] {
  const out: ChatLine[] = [];
  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw[0] !== '{') continue;
    let row: Record<string, unknown>;
    try { row = JSON.parse(raw) as Record<string, unknown>; } catch { continue; } // partial first/last line
    if (row.isSidechain === true || row.isMeta === true) continue;
    const type = row.type;
    if (type !== 'user' && type !== 'assistant') continue;
    const message = row.message as { content?: unknown } | undefined;
    const text = textOf(message?.content).trim();
    if (!text) continue;
    if (type === 'user' && isInjected(text)) continue;
    const ts = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
    out.push({
      id: typeof row.uuid === 'string' ? row.uuid : `l${i}`,
      role: type === 'user' ? 'user' : 'agent',
      text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
      ts: Number.isFinite(ts) ? ts : 0,
    });
  }
  return out.length > limit ? out.slice(out.length - limit) : out;
}

const parsed = new Map<string, { mtimeMs: number; size: number; limit: number; lines: ChatLine[] }>();

/** Read the tail of a transcript file and parse it. The chat polls this every
 *  second or two, so an unchanged file is served from a one-entry-per-file cache. */
export function readChatLines(file: string, limit = 200): ChatLine[] {
  if (!file || !existsSync(file)) return [];
  const fd = openSync(file, 'r');
  try {
    const st = fstatSync(fd);
    const hit = parsed.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size && hit.limit === limit) return hit.lines;
    const start = Math.max(0, st.size - TAIL_BYTES);
    const buf = Buffer.alloc(st.size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // drop the cut-off first line
    const lines = parseTranscript(text, limit);
    if (parsed.size > 64) parsed.clear();
    parsed.set(file, { mtimeMs: st.mtimeMs, size: st.size, limit, lines });
    return lines;
  } finally {
    closeSync(fd);
  }
}

/** Where an agent's transcript lives: the live path learned from its hooks, else
 *  `<project dir>/<sessionId>.jsonl` from the hive registry. */
export function transcriptFileFor(hookPath: string | undefined, cwd: string | undefined, sessionId: string | undefined): string | null {
  if (hookPath) return hookPath;
  if (cwd && sessionId) return join(projectDir(cwd), `${sessionId}.jsonl`);
  return null;
}
