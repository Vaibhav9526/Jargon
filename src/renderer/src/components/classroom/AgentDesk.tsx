import type { ReactNode } from 'react';
import type { Agent } from '@/store/store';
import { CAST_BY_NAME, type OfficeCharacterName } from '@/scene/office/cast';
import { SpritePortrait } from '../SpritePortrait';
import { Face, ROLE_INFO } from './IdCard';
import { idCardImage, isSchoolCast } from './art';
import { IconSleep, IconWake, IconTrash } from './icons';

// Shared by the Classroom and the Office chat: the "who do you want to wake up?"
// picker, the right-click menu and the sleeping-zzz animation.

export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function describeCharacter(c: OfficeCharacterName): { title: string; tagline: string } {
  const school = ROLE_INFO[c];
  if (school) return school;
  const cast = CAST_BY_NAME[c];
  return { title: cast?.displayName ?? c, tagline: cast?.blurb ?? '' };
}

export interface AgentMenuState { x: number; y: number; agent: Agent; sleeping: boolean }

export function AgentDeskStyles() {
  return (
    <style>{`
      @keyframes crZzz { 0% { opacity: 0; transform: translate(0,6px) scale(.7); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(10px,-14px) scale(1.2); } }
      .cr-zzz { display: inline-block; font-size: 13px; opacity: 0; animation: crZzz 2.4s ease-in-out infinite; margin-left: 1px; }
      @media (prefers-reduced-motion: reduce) { .cr-zzz { animation: none; opacity: .8; } }
    `}</style>
  );
}

export function Zzz() {
  return (
    <span aria-hidden style={{ position: 'absolute', top: 6, right: 14, fontWeight: 800, color: 'var(--cth-ink-700)', pointerEvents: 'none' }}>
      <span className="cr-zzz" style={{ animationDelay: '0s' }}>z</span>
      <span className="cr-zzz" style={{ animationDelay: '0.6s' }}>z</span>
      <span className="cr-zzz" style={{ animationDelay: '1.2s' }}>z</span>
    </span>
  );
}

/** Art for a character with no agent yet: the ID-card picture, or the sprite. */
function Placeholder({ character, size }: { character: OfficeCharacterName; size: number }) {
  const art = isSchoolCast(character) ? idCardImage(character) : null;
  return (
    <div style={{ width: size, height: size, borderRadius: 14, overflow: 'hidden', background: 'var(--cth-cream-200)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      {art
        ? <img src={art} alt={describeCharacter(character).title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', imageRendering: 'pixelated' }} />
        : <SpritePortrait character={character} scale={Math.max(1, Math.floor(size / 28))} />}
    </div>
  );
}

export function AgentPickerDialog({
  title, subtitle, characters, openAgents, sleepers, waking, error, onPick, onClose, onContext,
}: {
  title: string;
  subtitle: string;
  characters: readonly OfficeCharacterName[];
  openAgents: readonly Agent[];
  sleepers: readonly Agent[];
  waking: string | null;
  error: string | null;
  onPick: (character: OfficeCharacterName) => void;
  onClose: () => void;
  onContext: (e: { clientX: number; clientY: number; preventDefault: () => void }, agent: Agent, sleeping: boolean) => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(26,19,32,0.45)', padding: 24 }}>
      <div style={{ width: 'min(680px, 100%)', maxHeight: '100%', overflowY: 'auto', borderRadius: 18, padding: 20, boxSizing: 'border-box', background: 'var(--cth-cream-50)', boxShadow: '0 12px 40px rgba(26,19,32,0.3), inset 0 0 0 1px var(--cth-ink-100)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <strong style={{ fontSize: 18, color: 'var(--cth-ink-900)', flex: 1 }}>{title}</strong>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--cth-ink-500)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', marginBottom: 14 }}>{subtitle}</div>
        {error && <div role="alert" style={{ fontSize: 12, color: 'var(--cth-coral)', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {characters.map((c) => {
            const awake = openAgents.find((x) => x.character === c);
            const sleeper = awake ? undefined : sleepers.find((x) => x.character === c);
            const a = awake ?? sleeper;
            const info = describeCharacter(c);
            return (
              <button key={c} type="button" disabled={waking !== null} onClick={() => onPick(c)}
                onContextMenu={(e) => { if (!a) return; e.preventDefault(); onContext(e, a, !awake); }}
                title={awake ? `Open ${awake.name}'s chat (right-click for more)` : sleeper ? `${sleeper.name} is asleep — click to wake them (right-click for more)` : `${info.title} isn't open — click to invoke them`}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, border: 'none', cursor: waking ? 'wait' : 'pointer', textAlign: 'center',
                  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
                <div style={{ opacity: awake ? 1 : 0.4, filter: awake ? 'none' : 'grayscale(0.6)' }}>
                  {a ? <Face agent={a} size={88} card /> : <Placeholder character={c} size={88} />}
                </div>
                {sleeper && <Zzz />}
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--cth-ink-900)', opacity: awake ? 1 : 0.55 }}>{a?.name ?? info.title}</div>
                <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', opacity: awake ? 1 : 0.7 }}>{sleeper ? 'Asleep' : info.tagline}</div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                  background: awake ? 'var(--cth-cream-200)' : 'var(--cth-ink-900)', color: awake ? 'var(--cth-ink-900)' : 'var(--cth-paper-100)' }}>
                  {waking === c ? 'Waking up…' : awake ? 'Open chat' : sleeper ? 'Wake up' : 'Invoke'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AgentContextMenu({ menu, leaderNote, onClose, onAction }: {
  menu: AgentMenuState;
  leaderNote: string;
  onClose: () => void;
  onAction: (kind: 'sleep' | 'delete' | 'wake') => void;
}) {
  return (
    <div onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 400 }}>
      <div role="menu" onMouseDown={(e) => e.stopPropagation()}
        style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 130), minWidth: 180, padding: 4, borderRadius: 10,
          background: 'var(--cth-paper-100)', boxShadow: '0 8px 24px rgba(26,19,32,0.28), inset 0 0 0 1px var(--cth-ink-100)' }}>
        <div style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, color: 'var(--cth-ink-500)' }}>{menu.agent.name}</div>
        {menu.agent.isGod ? (
          <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--cth-ink-500)' }}>{leaderNote}</div>
        ) : (
          <>
            {menu.sleeping
              ? <MenuItem icon={<IconWake size={16} />} label="Wake up" onClick={() => onAction('wake')} />
              : <MenuItem icon={<IconSleep size={16} />} label="Put to sleep" hint="Closes them; wake any time" onClick={() => onAction('sleep')} />}
            <MenuItem icon={<IconTrash size={16} />} label="Delete agent…" danger onClick={() => onAction('delete')} />
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, hint, danger, onClick }: { icon?: ReactNode; label: string; hint?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} title={hint}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: '7px 10px', borderRadius: 7, background: 'transparent',
        color: danger ? 'var(--cth-coral)' : 'var(--cth-ink-900)', fontSize: 13, fontWeight: 600 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--cth-cream-200)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      {icon}{label}
    </button>
  );
}
