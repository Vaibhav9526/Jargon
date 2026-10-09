import type { FileToolResult as Result } from '@shared/fileTools';
import { IconCheck } from './icons';

export const fmtBytes = (n: number): string =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

const linkBtn = {
  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, font: 'inherit', color: 'inherit', textDecoration: 'underline',
} as const;

/** What the Librarian hands back after an @convert / @compress. */
export function FileToolResultCard({ result }: { result: Result }) {
  return (
    <div role="status" style={{
      display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', fontSize: 12, lineHeight: '16px', borderRadius: 10,
      background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', color: 'var(--cth-ink-900)',
    }}>
      <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <IconCheck size={16} /> Librarian: done — {result.outputs.length} file{result.outputs.length === 1 ? '' : 's'} ready
      </strong>
      {result.outputs.map((o) => {
        const saved = o.bytesIn > 0 ? Math.round((1 - o.bytesOut / o.bytesIn) * 100) : 0;
        const name = o.output.split(/[\\/]/).pop();
        return (
          <div key={o.output}>
            <button type="button" onClick={() => void window.cth.fileToolsReveal(o.output)} title="Show in folder" style={linkBtn}>{name}</button>
            <span style={{ color: 'var(--cth-ink-500)' }}>
              {' '}· {fmtBytes(o.bytesIn)} → {fmtBytes(o.bytesOut)}
              {saved > 0 ? ` (${saved}% smaller)` : ''}{o.pages ? ` · ${o.pages} page${o.pages === 1 ? '' : 's'}` : ''}
            </span>
            {o.note && <div style={{ color: 'var(--cth-ink-500)' }}>{o.note}</div>}
          </div>
        );
      })}
      <button type="button" onClick={() => void window.cth.fileToolsReveal(result.folder ?? '')}
        style={{ ...linkBtn, alignSelf: 'flex-start', color: 'var(--cth-ink-500)' }}>Open folder</button>
    </div>
  );
}
