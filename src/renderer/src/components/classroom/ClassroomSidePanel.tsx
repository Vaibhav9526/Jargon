import { useState, type ReactNode } from 'react';
import { useStore, type Agent } from '@/store/store';
import { ClassroomChat } from './ClassroomChat';

/** Sidebar for a staff-room character: ID card + chat, with the raw terminal one click away. */
export function ClassroomSidePanel({ agent, terminal }: { agent: Agent; terminal: ReactNode }) {
  const [view, setView] = useState<'chat' | 'terminal'>('chat');
  const setFullscreen = useStore((s) => s.setFullscreen);

  const tab = (key: 'chat' | 'terminal', label: string) => (
    <button type="button" onClick={() => setView(key)}
      style={{
        border: 'none', cursor: 'pointer', padding: '8px 12px', background: 'transparent', fontSize: 13,
        fontFamily: 'var(--cth-font-ui)', fontWeight: view === key ? 700 : 500,
        color: view === key ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)',
        boxShadow: view === key ? 'inset 0 -2px 0 var(--cth-ink-900)' : 'none',
      }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--cth-cream-100)', borderRadius: 4, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px', borderBottom: '1px solid var(--cth-ink-100)' }}>
        {tab('chat', 'Chat')}
        {tab('terminal', 'Terminal')}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setFullscreen(agent.id)} title="Open the full chat view"
          style={{ border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 8, background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', fontSize: 12, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)' }}>
          Focus ⤢
        </button>
      </div>
      {view === 'chat'
        ? <ClassroomChat agent={agent} variant="side" />
        : <div style={{ flex: 1, minHeight: 0 }}>{terminal}</div>}
    </div>
  );
}
