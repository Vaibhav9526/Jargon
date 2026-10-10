import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeQr, qrToSvg } from '@/spectator/qr';
import { startSpectatorStream, stopSpectatorStream } from '@/spectator/spectatorStream';

const BAR_HEIGHT = 26;

/**
 * Spectator mode, live from the top bar: one click starts a read-only LAN server and
 * shows the URL + a QR code a phone can scan to watch the floor live. A second click
 * stops it. The raw URL is always shown as text too — a QR that fails to scan (bad
 * wifi, locked-down camera) must never be the only way in.
 *
 * Start/stop is authoritative in MAIN (`spectator:start` / `spectator:stop`); this
 * component just reflects that state and drives the renderer→main snapshot stream.
 */
export function SpectatorToggle() {
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Hydrate from main on mount, so reopening the window shows the live state + QR.
  useEffect(() => {
    let alive = true;
    void window.cth.spectatorStatus().then((s) => {
      if (!alive) return;
      setRunning(s.running);
      setUrl(s.url);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // Close the popover on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const start = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      const res = await window.cth.spectatorStart();
      if (!res.ok) { setNote(res.error ?? 'could not start'); return; }
      setUrl(res.url); setRunning(true); setOpen(true);
      startSpectatorStream();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      stopSpectatorStream();
      await window.cth.spectatorStop();
      setRunning(false); setOpen(false);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, []);

  const qr = url ? qrToSvg(encodeQr(url), { dark: '#14111c', light: '#ffffff', scale: 4, quiet: 3 }) : '';

  return (
    <div ref={wrapRef} className="cth-titlebar-nodrag" style={{ position: 'relative', flexShrink: 0 }}>
      <button
        className="cth-titlebar-nodrag cth-tip"
        aria-pressed={running}
        disabled={busy}
        data-tip={running ? 'Spectator mode is live — click to stop' : 'Spectator mode: share the floor on your LAN'}
        aria-label="Toggle spectator mode"
        onClick={() => { if (running) { void stop(); } else if (url) { setOpen((o) => !o); } else { void start(); } }}
        style={{
          height: BAR_HEIGHT, minWidth: 30, padding: '0 7px', fontSize: 13, lineHeight: 1,
          background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
          border: '1px solid var(--cth-ink-300)', borderRadius: 2,
          boxShadow: 'inset 0 -2px 0 var(--cth-cream-200)',
          cursor: busy ? 'default' : 'pointer', opacity: running ? 1 : 0.7
        }}
      >
        {running ? '📡' : '📴'}
      </button>

      {open && running && url && (
        <div role="dialog" aria-label="Spectator mode" style={{
          position: 'absolute', top: 32, right: 0, width: 260, zIndex: 401,
          padding: 14, textAlign: 'center',
          background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
          border: '1px solid var(--cth-ink-300)', boxShadow: '2px 3px 0 0 rgba(26,19,32,0.2)',
          fontFamily: 'var(--cth-font-ui)'
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Spectator mode is live</div>
          <div style={{ background: '#fff', padding: 8, borderRadius: 4, display: 'inline-block' }} dangerouslySetInnerHTML={{ __html: qr }} />
          <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', margin: '8px 0 4px' }}>Scan, or open on any device on this network:</div>
          <div style={{
            fontSize: 11, wordBreak: 'break-all', userSelect: 'text',
            background: 'var(--cth-cream-100)', padding: '6px 8px', borderRadius: 3,
            border: '1px solid var(--cth-ink-300)'
          }}>{url}</div>
          <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 8 }}>Read-only · stops when you close the app</div>
        </div>
      )}

      {note && (
        <div role="status" style={{
          position: 'absolute', top: 32, right: 0, width: 240, zIndex: 401,
          padding: 8, fontFamily: 'var(--cth-font-ui)', fontSize: 12,
          color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)',
          border: '1px solid var(--cth-ink-300)', userSelect: 'text'
        }}>{note}</div>
      )}
    </div>
  );
}
