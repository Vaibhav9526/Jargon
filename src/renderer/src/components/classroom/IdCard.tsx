import type { Agent } from '@/store/store';
import { SpritePortrait } from '../SpritePortrait';
import { PixelBadge } from '../PixelBadge';
import { idCardImage, moodImage, isSchoolCast } from './art';
import { MoodFace } from './icons';

const ROLE: Record<string, { title: string; tagline: string }> = {
  teacher: { title: 'Teacher', tagline: 'Patient, clear, explains step by step' },
  topper: { title: 'Topper', tagline: 'Top of the class — and knows it' },
  smartguy: { title: 'Smart Guy', tagline: 'Shortcuts, tricks and big-picture insight' },
  librarian: { title: 'Librarian', tagline: 'Keeps the notes, books and slides' },
  principal: { title: 'Vice Principal', tagline: 'Keeps the school running' },
};

/** Face for an agent: the drawn expression if present, else the sprite portrait. */
export function Face({ agent, mood, size, card = false }: { agent: Agent; mood?: string; size: number; card?: boolean }) {
  const url = isSchoolCast(agent.character)
    ? (card ? idCardImage(agent.character) : moodImage(agent.character, mood))
    : null;
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, borderRadius: Math.round(size / 6), overflow: 'hidden', position: 'relative',
      background: `var(--cth-${agent.accent}-light)`, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      {url
        ? <img src={url} alt={agent.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', imageRendering: 'pixelated' }} />
        : <SpritePortrait character={agent.character} scale={Math.max(1, Math.floor(size / 28))} />}
      {!url && mood && mood !== 'neutral' && (
        <span style={{ position: 'absolute', right: 2, bottom: 2, display: 'flex' }} aria-hidden><MoodFace mood={mood} size={Math.max(14, Math.round(size / 3))} /></span>
      )}
    </div>
  );
}

/** A school ID card: photo, name, role, one-line description, status. */
export function IdCard({ agent, mood, compact = false }: { agent: Agent; mood?: string; compact?: boolean }) {
  const role = ROLE[agent.character] ?? { title: agent.character, tagline: agent.description };
  return (
    <div style={{
      display: 'flex', gap: compact ? 10 : 14, alignItems: 'center',
      padding: compact ? '10px 12px' : '14px 16px',
      background: 'var(--cth-paper-100)', borderRadius: 12,
      boxShadow: 'inset 0 0 0 1px var(--cth-ink-100), var(--cth-shadow-hard)',
    }}>
      <Face agent={agent} mood={mood} size={compact ? 64 : 96} card />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)', letterSpacing: 0.5 }}>SCHOOL ID</div>
        <div style={{ fontSize: compact ? 15 : 18, fontWeight: 800, color: 'var(--cth-ink-900)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: `var(--cth-${agent.accent})`, filter: 'brightness(0.8)' }}>{role.title}</div>
        {!compact && <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', marginTop: 2 }}>{role.tagline}</div>}
        <div style={{ marginTop: 6 }}><PixelBadge status={agent.status} /></div>
      </div>
    </div>
  );
}

export { ROLE as ROLE_INFO };
