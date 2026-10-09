import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore, type Agent } from '@/store/store';
import type { HarnessConfig } from '@/store/config';
import { castForTheme, type OfficeCharacterName } from '@/scene/office/cast';
import { FullscreenTerminal } from '../FullscreenTerminal';
import { MessageQueueComposer } from '../MessageQueueComposer';
import { Face } from './IdCard';
import { isSchoolCast } from './art';
import { quickHire, sleepAgent, deleteAgent } from './quickHire';
import { IconUser } from './icons';
import { AgentPickerDialog, AgentContextMenu, AgentDeskStyles, ago, type AgentMenuState } from './AgentDesk';
import brandLogo from '@brand/logo.png?url';

interface Line { id: string; role: 'user' | 'agent' | 'note'; text: string; ts: number; detail?: string; pending?: boolean }

const MAILMAN_STARTERS = ['@summarize unread mail from today', '@compose name@example.com ', '@inbox'];
const STARTERS = ['What are you working on right now?', 'Summarize where this project stands', 'Review my latest changes'];
const clearedKey = (id: string) => `jargon:officeChatCleared:${id}`;
function readCleared(id: string): number {
  try { return Number(localStorage.getItem(clearedKey(id))) || 0; } catch { return 0; }
}

/** Put text in the composer's box (it keeps its draft in the store, so go through the DOM value setter). */
function fillComposer(host: HTMLElement | null, text: string) {
  const ta = host?.querySelector<HTMLTextAreaElement>('textarea.cth-input');
  if (!ta) return;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(text.length, text.length);
}

const OFFICE_CHARACTERS = castForTheme('office').map((m) => m.name);
const PREVIEW_EVERY_MS = 8000;
const OPEN_CHAT_EVERY_MS = 1500;

/**
 * Focus mode for the Office floor: the same messenger layout as the Classroom,
 * but every chat is with a REAL worker. What you say goes to the agent's own
 * terminal (queued if it is busy); what it says comes back as bubbles, read from
 * its Claude transcript — so anything typed in the terminal shows up here too.
 */
export function OfficeFocus({ config }: { config?: HarnessConfig | null }) {
  const agents = useStore((s) => s.agents);
  const archivedAgents = useStore((s) => s.archivedAgents);
  const selectedId = useStore((s) => s.fullscreenAgentId);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const [terminal, setTerminal] = useState(false);
  const [q, setQ] = useState('');
  const [previews, setPreviews] = useState<Record<string, Line>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [clearedAt, setClearedAt] = useState(0);
  const [hiveLines, setHiveLines] = useState<Line[]>([]);
  /** Answers produced by the app itself (Mailman's @summarize / @compose) — not in any transcript. */
  const [localByAgent, setLocalByAgent] = useState<Record<string, Line[]>>({});
  const [picking, setPicking] = useState(false);
  const [waking, setWaking] = useState<string | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  const [menu, setMenu] = useState<AgentMenuState | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const dock = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);

  const open = useMemo(() => agents.filter((a) => !a.archived && !isSchoolCast(a.character)), [agents]);
  const sleeping = useMemo(() => archivedAgents.filter((a) => !isSchoolCast(a.character)), [archivedAgents]);
  const pool = useMemo(() => [...open, ...sleeping], [open, sleeping]);
  const agent = open.find((a) => a.id === selectedId) ?? null;
  const sleepingIds = useMemo(() => new Set(sleeping.map((a) => a.id)), [sleeping]);

  // Rail previews: the last thing said in each agent's transcript.
  useEffect(() => {
    let live = true;
    const load = () => {
      void Promise.all(pool.map(async (a) => {
        const r = await window.cth.officeChatMessages(a.id, 1).catch(() => null);
        const last = r?.lines[r.lines.length - 1];
        return [a.id, last ?? null] as const;
      })).then((rows) => {
        if (!live) return;
        const next: Record<string, Line> = {};
        for (const [id, l] of rows) if (l) next[id] = l;
        setPreviews(next);
      });
    };
    load();
    const t = setInterval(load, PREVIEW_EVERY_MS);
    return () => { live = false; clearInterval(t); };
  }, [pool]);

  // The open conversation, refreshed while it is on screen.
  useEffect(() => {
    if (!agent) return;
    let live = true;
    stick.current = true;
    setLines([]);
    setClearedAt(readCleared(agent.id));
    const load = () => {
      void window.cth.officeChatMessages(agent.id, 300).then((r) => { if (live) setLines(r.lines); }).catch(() => undefined);
    };
    load();
    const t = setInterval(load, OPEN_CHAT_EVERY_MS);
    return () => { live = false; clearInterval(t); };
  }, [agent?.id]);

  // Messages between agents (task hand-offs, questions, replies) that touch this
  // agent — so delegation is visible here, whatever CLI the agent runs.
  useEffect(() => {
    if (!agent) return;
    let live = true;
    setHiveLines([]);
    const nameOf = (id: string) => {
      if (id === 'human') return 'You';
      const a = useStore.getState().agents.find((x) => x.id === id) ?? useStore.getState().archivedAgents.find((x) => x.id === id)
        ?? (id === 'god' ? useStore.getState().agents.find((x) => x.isGod) : undefined);
      return a?.name ?? id;
    };
    const load = () => {
      void window.cth.hiveMessages({ agentId: agent.id, limit: 40, includeArchived: true }).then((ms) => {
        if (!live) return;
        setHiveLines(ms.map((m) => ({
          id: `hive-${m.id}`, role: 'note' as const, ts: Date.parse(m.created_at) || 0,
          text: `${nameOf(m.from)} → ${nameOf(m.to)} · ${m.act}: ${m.subject}`,
          detail: m.body,
        })));
      }).catch(() => undefined);
    };
    load();
    const t = setInterval(load, OPEN_CHAT_EVERY_MS * 2);
    return () => { live = false; clearInterval(t); };
  }, [agent?.id]);

  useEffect(() => {
    const onSay = (e: Event) => {
      const d = (e as CustomEvent<{ agentId: string; id: string; role: 'user' | 'agent'; text: string; pending?: boolean; ts: number }>).detail;
      if (!d?.agentId) return;
      setLocalByAgent((prev) => {
        const list = prev[d.agentId] ?? [];
        const line: Line = { id: `local-${d.id}`, role: d.role, text: d.text, ts: d.ts, pending: d.pending };
        const at = list.findIndex((l) => l.id === line.id);
        const next = at >= 0 ? list.map((l, i) => (i === at ? { ...line, ts: l.ts } : l)) : [...list, line];
        return { ...prev, [d.agentId]: next };
      });
      stick.current = true;
    };
    window.addEventListener('jargon:mailman-chat', onSay);
    return () => window.removeEventListener('jargon:mailman-chat', onSay);
  }, []);

  // Opening (or switching to) a chat puts the cursor in its message box.
  useEffect(() => {
    if (!agent) return;
    const t = window.setTimeout(() => dock.current?.querySelector<HTMLTextAreaElement>('textarea.cth-input')?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(t);
  }, [agent?.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, hiveLines, localByAgent, agent?.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) { setMenu(null); return; }
      if (picking) { setPicking(false); return; }
      if (!terminal && !(e.target instanceof HTMLTextAreaElement && e.target.value)) setFullscreen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [terminal, picking, menu, setFullscreen]);

  /** "+ New chat" / waking a sleeper / invoking someone not hired yet. */
  const chatWith = useCallback(async (character: OfficeCharacterName) => {
    setDeskError(null);
    setWaking(character);
    try {
      const live = useStore.getState().agents.find((a) => a.character === character && !a.archived);
      const target = live ?? await quickHire(character, config);
      setPicking(false);
      setFullscreen(target.id);
    } catch (err) {
      setDeskError(err instanceof Error ? err.message : String(err));
    } finally {
      setWaking(null);
    }
  }, [config, setFullscreen]);

  const runMenuAction = useCallback(async (kind: 'sleep' | 'delete' | 'wake') => {
    const m = menu;
    setMenu(null);
    if (!m) return;
    setDeskError(null);
    try {
      if (kind === 'wake') { await chatWith(m.agent.character); return; }
      if (kind === 'sleep') { await sleepAgent(m.agent); return; }
      if (!window.confirm(`Delete ${m.agent.name} for good? Their terminal ends and they leave the office.`)) return;
      await deleteAgent(m.agent);
    } catch (err) {
      setDeskError(err instanceof Error ? err.message : String(err));
      setPicking(true);
    }
  }, [menu, chatWith]);

  if (terminal) {
    return (
      <>
        <FullscreenTerminal config={config} />
        <button type="button" onClick={() => setTerminal(false)}
          style={{ position: 'fixed', zIndex: 260, right: 16, bottom: 16, border: 'none', cursor: 'pointer', padding: '8px 14px', borderRadius: 10, background: 'var(--cth-ink-900)', color: 'var(--cth-paper-100)', fontSize: 13 }}>
          ← Back to chat
        </button>
      </>
    );
  }
  if (!agent) return null;

  const needle = q.trim().toLowerCase();
  // Every open agent has a row (an agent whose CLI keeps no transcript — or that has not
  // spoken yet — still needs to be reachable); sleepers only show once they have said something.
  const rows = pool
    .filter((a) => (previews[a.id] || !sleepingIds.has(a.id))
      && (a.name.toLowerCase().includes(needle) || (previews[a.id]?.text ?? '').toLowerCase().includes(needle)))
    .sort((x, y) => (previews[y.id]?.ts ?? 0) - (previews[x.id]?.ts ?? 0));
  // The open agent always has a row, even before its first message.
  if (!rows.some((a) => a.id === agent.id) && !needle) rows.unshift(agent);
  const visible = [...lines, ...hiveLines, ...(localByAgent[agent.id] ?? [])].filter((l) => l.ts > clearedAt).sort((x, y) => x.ts - y.ts);
  const working = agent.status === 'working' || agent.status === 'thinking';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 250, padding: 24, boxSizing: 'border-box', background: 'linear-gradient(135deg, var(--cth-sky-light) 0%, var(--cth-lemon-light) 100%)', display: 'flex' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', borderRadius: 18, overflow: 'hidden', background: 'var(--cth-cream-50)', boxShadow: '0 12px 40px rgba(26,19,32,0.18), inset 0 0 0 1px var(--cth-ink-100)' }}>
        <aside style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-cream-100)', borderRight: '1px solid var(--cth-ink-100)', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 8px' }}>
            <img src={brandLogo} alt="Jargon" style={{ height: 26, width: 'auto' }} />
            <strong style={{ fontSize: 16, color: 'var(--cth-ink-900)' }}>Office</strong>
          </div>
          <div style={{ padding: '4px 16px 8px' }}>
            <button type="button" onClick={() => { setDeskError(null); setPicking(true); }}
              style={{ width: '100%', border: 'none', cursor: 'pointer', padding: '9px 12px', borderRadius: 12, background: 'var(--cth-ink-900)', color: 'var(--cth-paper-100)', fontSize: 14, fontWeight: 600 }}>
              + New chat
            </button>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '8px 10px', borderRadius: 10, border: 'none', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-900)', fontSize: 13, outline: 'none' }} />
          </div>
          <div style={{ padding: '4px 16px', fontSize: 11, color: 'var(--cth-ink-500)', fontWeight: 600 }}>CHATS</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
            {rows.map((a) => {
              const on = a.id === agent.id;
              const asleep = sleepingIds.has(a.id);
              const p = previews[a.id];
              return (
                <button key={a.id} type="button"
                  onClick={() => { if (asleep) void chatWith(a.character); else setFullscreen(a.id); }}
                  title={asleep ? `${a.name} is asleep — click to wake them` : undefined}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, agent: a, sleeping: asleep }); }}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: 8, borderRadius: 12, background: on ? 'var(--cth-paper-100)' : 'transparent', boxShadow: on ? 'inset 0 0 0 1px var(--cth-ink-100)' : 'none', marginBottom: 2, opacity: asleep ? 0.45 : 1, filter: asleep ? 'grayscale(0.5)' : 'none' }}>
                  <Face agent={a} size={40} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cth-ink-900)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{asleep ? 'asleep' : p ? ago(p.ts) : ''}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p ? `${p.role === 'user' ? 'You: ' : ''}${p.text.replace(/\s+/g, ' ')}` : a.description}
                    </div>
                  </div>
                </button>
              );
            })}
            {rows.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--cth-ink-500)' }}>{pool.some((a) => previews[a.id]) ? 'No matching chats.' : 'No chats yet — press New chat and pick someone.'}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderTop: '1px solid var(--cth-ink-100)' }}>
            <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconUser size={30} /></div>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-900)' }}>You</div>
            <button type="button" onClick={() => setFullscreen(null)} title="Leave focus mode (Esc)"
              style={{ border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 8, background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', fontSize: 12, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
              Exit ⤡
            </button>
          </div>
        </aside>

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--cth-paper-100)' }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--cth-ink-100)' }}>
            <Face agent={agent} size={44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cth-ink-900)' }}>{agent.name}</div>
              <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.description} · {agent.project || 'no project'}
              </div>
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => {
              const now = Date.now();
              try { localStorage.setItem(clearedKey(agent.id), String(now)); } catch { /* private window */ }
              setClearedAt(now);
            }} title="Hide the messages above — the agent's own history is untouched"
              style={{ border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 10, background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)', fontSize: 12 }}>Clear chat</button>
            <button type="button" onClick={() => setTerminal(true)}
              style={{ border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 10, background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)', fontSize: 12 }}>Terminal</button>
          </header>

          <div style={{ padding: '10px 24px 0' }}>
            <select aria-label="Chat" value="chat" onChange={() => undefined}
              style={{ padding: '5px 8px', borderRadius: 10, border: 'none', background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)', fontSize: 13, fontWeight: 600, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', cursor: 'pointer', maxWidth: '100%' }}>
              <option value="chat">{agent.name} chat</option>
            </select>
          </div>

          <div ref={scroller}
            onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 24px' }}>
            <div style={{ maxWidth: 808, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visible.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0 8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Face agent={agent} size={96} card /></div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--cth-ink-900)' }}>Hi, I&apos;m {agent.name}.</div>
                  <div style={{ fontSize: 16, color: 'var(--cth-ink-500)', marginTop: 4 }}>What would you like to work on?</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 16 }}>
                    {(agent.character === 'mailman' ? MAILMAN_STARTERS : STARTERS).map((st) => (
                      <button key={st} type="button" onClick={() => fillComposer(dock.current, st)}
                        style={{ border: 'none', cursor: 'pointer', padding: '8px 12px', borderRadius: 12, background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', fontSize: 13, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', textAlign: 'left' }}>
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {visible.map((l) => <Bubble key={l.id} line={l} agent={agent} />)}
              {working && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <Face agent={agent} size={36} />
                  <div style={{ padding: '8px 12px', borderRadius: 14, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-500)', fontSize: 13 }}>
                    {agent.name} is working…
                  </div>
                </div>
              )}
            </div>
          </div>

          <div ref={dock} style={{ padding: '0 24px 20px', maxWidth: 808 + 48, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
            <MessageQueueComposer agent={agent} variant="chat" />
          </div>
        </main>
      </div>
      <AgentDeskStyles />
      {menu && (
        <AgentContextMenu menu={menu} leaderNote="Leads the office — can't sleep or be deleted."
          onClose={() => setMenu(null)} onAction={(k) => void runMenuAction(k)} />
      )}
      {picking && (
        <AgentPickerDialog
          title="Who do you want to wake up?"
          subtitle="Opens their chat — what they have said stays in it. Faded ones aren't open; Invoke or Wake up brings them to their desk. Right-click for sleep / delete."
          characters={OFFICE_CHARACTERS} openAgents={open} sleepers={sleeping} waking={waking} error={deskError}
          onPick={(c) => { void chatWith(c); }}
          onClose={() => setPicking(false)}
          onContext={(e, a, sleepingNow) => setMenu({ x: e.clientX, y: e.clientY, agent: a, sleeping: sleepingNow })}
        />
      )}
    </div>
  );
}

function Bubble({ line, agent }: { line: Line; agent: Agent }) {
  if (line.role === 'note') {
    return (
      <div style={{ alignSelf: 'center', maxWidth: '86%', fontSize: 12, color: 'var(--cth-ink-500)', padding: '4px 10px', borderRadius: 10, background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}
        title={line.detail}>
        <div style={{ fontWeight: 600 }}>{line.text}</div>
        {line.detail && <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 84, overflow: 'hidden' }}>{line.detail.slice(0, 400)}</div>}
      </div>
    );
  }
  const mine = line.role === 'user';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: mine ? 'row-reverse' : 'row' }}>
      {!mine && <Face agent={agent} size={36} />}
      <div style={{
        maxWidth: '78%', padding: '8px 12px', borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: mine ? 'var(--cth-lemon-light)' : 'var(--cth-paper-100)',
        boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-900)', fontSize: 14, lineHeight: '21px', overflowWrap: 'anywhere',
      }}>
        {mine
          ? <span style={{ whiteSpace: 'pre-wrap' }}>{line.text}</span>
          : <div className="cth-chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{line.text}</ReactMarkdown></div>}
      </div>
    </div>
  );
}
