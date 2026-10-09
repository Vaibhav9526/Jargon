import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store/store';
import type { HarnessConfig } from '@/store/config';
import { FullscreenTerminal } from '../FullscreenTerminal';
import { ClassroomChat } from './ClassroomChat';
import { Face, ROLE_INFO } from './IdCard';
import { isSchoolCast, SCHOOL_CAST } from './art';
import { quickHire, sleepAgent, deleteAgent } from './quickHire';
import { IconUser } from './icons';
import { AgentPickerDialog, AgentContextMenu, AgentDeskStyles, ago, type AgentMenuState } from './AgentDesk';
import type { Agent } from '@/store/store';
import brandLogo from '@brand/logo.png?url';

interface Preview { text: string; ts: number }

/**
 * Focus mode for the staff room: a messenger-style layout — every character's chat
 * in the left rail, the open conversation in the middle. The raw terminal is still
 * reachable from the header for power use.
 */
export function ClassroomFocus({ config }: { config?: HarnessConfig | null }) {
  const agents = useStore((s) => s.agents);
  const selectedId = useStore((s) => s.fullscreenAgentId);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const [terminal, setTerminal] = useState(false);
  const [q, setQ] = useState('');
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [reload, setReload] = useState(0);
  const [chatKey, setChatKey] = useState(0);
  const [mood, setMood] = useState('neutral');
  const [picking, setPicking] = useState(false);
  const [waking, setWaking] = useState<string | null>(null);
  const [wakeError, setWakeError] = useState<string | null>(null);
  const archivedAgents = useStore((s) => s.archivedAgents);
  const [menu, setMenu] = useState<AgentMenuState | null>(null);

  const cast = useMemo(() => agents.filter((a) => !a.archived && isSchoolCast(a.character)), [agents]);
  const agent = cast.find((a) => a.id === selectedId) ?? null;
  const sleepingCast = useMemo(() => archivedAgents.filter((a) => isSchoolCast(a.character)), [archivedAgents]);
  const pool = useMemo(() => [...cast, ...sleepingCast], [cast, sleepingCast]);

  useEffect(() => {
    let live = true;
    void Promise.all(pool.map(async (a) => {
      const h = await window.cth.classroomHistory(a.id).catch(() => []);
      const last = h[h.length - 1];
      return [a.id, last ? { text: last.text, ts: last.ts } : null] as const;
    })).then((rows) => {
      if (!live) return;
      const next: Record<string, Preview> = {};
      for (const [id, p] of rows) if (p) next[id] = p;
      setPreviews(next);
    });
    return () => { live = false; };
  }, [pool, reload, selectedId]);

  // Esc leaves focus mode (unless a modal or the terminal view owns the key).
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

  const clearChat = useCallback(async () => {
    if (!agent) return;
    await window.cth.classroomClear(agent.id);
    setChatKey((k) => k + 1);
    setReload((r) => r + 1);
  }, [agent]);

  /** "+ New chat": wake the chosen character (hiring them first if they are not
   *  open yet) and open their conversation — earlier history is kept. */
  const startChatWith = useCallback(async (character: (typeof SCHOOL_CAST)[number]) => {
    setWakeError(null);
    setWaking(character);
    try {
      const open = useStore.getState().agents.find((a) => a.character === character && !a.archived);
      const target = open ?? await quickHire(character, config);
      setPicking(false);
      setFullscreen(target.id);
      setChatKey((k) => k + 1);
      setReload((r) => r + 1);
    } catch (err) {
      setWakeError(err instanceof Error ? err.message : String(err));
    } finally {
      setWaking(null);
    }
  }, [config, setFullscreen]);

  const runMenuAction = useCallback(async (kind: 'sleep' | 'delete' | 'wake') => {
    const m = menu;
    setMenu(null);
    if (!m) return;
    setWakeError(null);
    try {
      if (kind === 'wake') { await startChatWith(m.agent.character as (typeof SCHOOL_CAST)[number]); return; }
      if (kind === 'sleep') { await sleepAgent(m.agent); return; }
      if (!window.confirm(`Delete ${m.agent.name} for good? Their notes and chat history go with them.`)) return;
      await window.cth.classroomClear(m.agent.id).catch(() => undefined);
      await deleteAgent(m.agent);
      setReload((r) => r + 1);
    } catch (err) {
      setWakeError(err instanceof Error ? err.message : String(err));
      setPicking(true);
    }
  }, [menu, startChatWith]);

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
  const filtered = pool
    .filter((a) => previews[a.id] && (a.name.toLowerCase().includes(needle) || previews[a.id].text.toLowerCase().includes(needle)))
    .sort((x, y) => previews[y.id].ts - previews[x.id].ts);
  const sleepingIds = new Set(sleepingCast.map((a) => a.id));
  const role = ROLE_INFO[agent.character];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 250, padding: 24, boxSizing: 'border-box',
      background: 'linear-gradient(135deg, var(--cth-lilac-light) 0%, var(--cth-sky-light) 100%)',
      display: 'flex',
    }}>
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', borderRadius: 18, overflow: 'hidden',
        background: 'var(--cth-cream-50)', boxShadow: '0 12px 40px rgba(26,19,32,0.18), inset 0 0 0 1px var(--cth-ink-100)',
      }}>
        {/* Left rail — every chat */}
        <aside style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-cream-100)', borderRight: '1px solid var(--cth-ink-100)', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 8px' }}>
            <img src={brandLogo} alt="Jargon" style={{ height: 26, width: 'auto' }} />
            <strong style={{ fontSize: 16, color: 'var(--cth-ink-900)' }}>Classroom</strong>
          </div>
          <div style={{ padding: '4px 16px 8px' }}>
            <button type="button" onClick={() => setPicking(true)}
              style={{ width: '100%', border: 'none', cursor: 'pointer', padding: '9px 12px', borderRadius: 12, background: 'var(--cth-ink-900)', color: 'var(--cth-paper-100)', fontSize: 14, fontWeight: 600 }}>
              + New chat
            </button>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '8px 10px', borderRadius: 10, border: 'none', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', color: 'var(--cth-ink-900)', fontSize: 13, outline: 'none' }} />
          </div>
          <div style={{ padding: '4px 16px', fontSize: 11, color: 'var(--cth-ink-500)', fontWeight: 600 }}>CHATS</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
            {filtered.map((a) => {
              const on = a.id === agent.id;
              const asleep = sleepingIds.has(a.id);
              const p = previews[a.id];
              return (
                <button key={a.id} type="button" onClick={() => { if (asleep) void startChatWith(a.character as (typeof SCHOOL_CAST)[number]); else setFullscreen(a.id); }}
                  title={asleep ? `${a.name} is asleep — click to wake them` : undefined}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, agent: a, sleeping: asleep }); }}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: 12, background: on ? 'var(--cth-paper-100)' : 'transparent', boxShadow: on ? 'inset 0 0 0 1px var(--cth-ink-100)' : 'none', marginBottom: 2, opacity: asleep ? 0.45 : 1, filter: asleep ? 'grayscale(0.5)' : 'none' }}>
                  <Face agent={a} size={40} card />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cth-ink-900)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{asleep ? 'asleep' : ago(p.ts)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.text.replace(/\s+/g, ' ')}
                    </div>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--cth-ink-500)' }}>{pool.some((a) => previews[a.id]) ? 'No matching chats.' : 'No chats yet — press New chat and pick someone.'}</div>}
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

        {/* Conversation */}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--cth-paper-100)' }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--cth-ink-100)' }}>
            <Face agent={agent} mood={mood} size={44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cth-ink-900)' }}>{agent.name}</div>
              <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{role?.title} · {role?.tagline}</div>
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => { void clearChat(); }}
              style={{ border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 10, background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)', fontSize: 12 }}>Clear chat</button>
            <button type="button" onClick={() => setTerminal(true)}
              style={{ border: 'none', cursor: 'pointer', padding: '6px 12px', borderRadius: 10, background: 'var(--cth-cream-200)', color: 'var(--cth-ink-900)', fontSize: 12 }}>Terminal</button>
          </header>
          <ClassroomChat key={`${agent.id}:${chatKey}`} agent={agent} variant="focus" onActivity={() => setReload((r) => r + 1)} onMood={setMood} />
        </main>
      </div>
      <AgentDeskStyles />
      {menu && (
        <AgentContextMenu menu={menu} leaderNote="Leads the school — can't sleep or be deleted."
          onClose={() => setMenu(null)} onAction={(k) => void runMenuAction(k)} />
      )}
      {picking && (
        <AgentPickerDialog
          title="Who do you want to wake up?"
          subtitle="Opens their chat — earlier history is kept. Faded ones aren't open; Invoke or Wake up brings them back. Right-click for sleep / delete."
          characters={SCHOOL_CAST} openAgents={cast} sleepers={archivedAgents} waking={waking} error={wakeError}
          onPick={(c) => { void startChatWith(c as (typeof SCHOOL_CAST)[number]); }}
          onClose={() => setPicking(false)}
          onContext={(e, agent, sleeping) => setMenu({ x: e.clientX, y: e.clientY, agent, sleeping })}
        />
      )}
    </div>
  );
}
