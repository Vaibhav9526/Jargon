import { useCallback, useEffect, useState } from 'react';
import { IconBooks } from './icons';

type Doc = { id: string; name: string; addedAt: number; chars: number; chunks: number };

/** The Librarian's shelf: add notes/books/slides once; every character can then
 *  answer from them with @memory-notes. */
export function LibraryStrip() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(true);

  const refresh = useCallback(() => {
    void window.cth.libraryList().then(setDocs).catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);

  const add = async () => {
    setBusy(true); setErrors([]);
    try {
      const res = await window.cth.libraryAdd();
      setErrors(res.errors ?? []);
      refresh();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Could not add the files.']);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ margin: '0 auto 12px', width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 12, background: 'var(--cth-lilac-light)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontSize: 13, fontWeight: 700, color: 'var(--cth-ink-900)' }}>
          <IconBooks size={18} /> Library ({docs.length}) {open ? '▾' : '▸'}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={busy} onClick={() => { void add(); }}
          style={{ border: 'none', cursor: busy ? 'wait' : 'pointer', padding: '5px 10px', borderRadius: 8, background: 'var(--cth-ink-900)', color: 'var(--cth-paper-100)', fontSize: 12 }}>
          {busy ? 'Reading…' : '+ Add notes'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-ink-900)' }}>
          {docs.length === 0 && (
            <span style={{ color: 'var(--cth-ink-500)' }}>
              Add PDFs, slides (.pptx), Word files, books (.epub) or text notes. Then type <code>@memory-notes</code> in any chat and that character answers from them.
            </span>
          )}
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>{d.name}</span>
              <span style={{ color: 'var(--cth-ink-500)' }}>{Math.max(1, Math.round(d.chars / 1000))}k chars</span>
              <button type="button" aria-label={`Remove ${d.name}`} onClick={() => { void window.cth.libraryRemove(d.id).then(refresh); }}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)', fontSize: 14, padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {errors.map((e) => <div key={e} role="alert" style={{ marginTop: 6, fontSize: 12, color: 'var(--cth-coral)' }}>{e}</div>)}
    </div>
  );
}
