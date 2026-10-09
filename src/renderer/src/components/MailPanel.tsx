import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MailAskItem, MailAskResult, MailDraft, MailProviderInfo } from '@shared/mailAsk';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';

type Summary = { uid: number; from: string; subject: string; date: string | null; seen: boolean };
type Full = NonNullable<Awaited<ReturnType<typeof window.cth.mailRead>>['message']>;
type Facts = NonNullable<Awaited<ReturnType<typeof window.cth.mailRead>>['facts']>;
type Tab = 'read' | 'summary' | 'details' | 'write';
type Status = { configured: boolean; user?: string; provider?: string; office: boolean; googleClient?: boolean };
type DraftState = { to: string; cc: string; subject: string; text: string };

const box: React.CSSProperties = {
  fontSize: 12, padding: '5px 7px', border: '1px solid var(--cth-ink-300)',
  background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', boxSizing: 'border-box', width: '100%',
};
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--cth-ink-500)' };
const errStyle: React.CSSProperties = { fontSize: 12, color: 'var(--cth-coral)' };
const linkBtn: React.CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-900)', textDecoration: 'underline', fontSize: 12, padding: 0 };
const pre: React.CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--cth-font-ui)', fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-900)' };

// Main enforces its own timeouts; these only guarantee the panel never spins forever.
const CONNECT_DEADLINE_MS = 180_000;
const READ_DEADLINE_MS = 150_000;
const AI_DEADLINE_MS = 150_000;
const ASK_DEADLINE_MS = 300_000;

function deadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} is taking too long — try again.`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const msg = (e: unknown, dflt: string) => (e instanceof Error && e.message ? e.message : dflt);

function fmtDate(d: string | null): string {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// `@mail <request>` fires this event; remembering it here lets the panel tell a
// fresh request (auto-run once) from a stale one when Mail is reopened later.
let freshRequest: string | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('jargon:open-mail', (e: Event) => {
    const d = (e as CustomEvent<{ request?: string } | undefined>).detail;
    freshRequest = typeof d?.request === 'string' ? d.request : null;
  });
}

/** Jargon Mail — Office floor only. Sign in once, then ask the Mailman. */
export function MailPanel({ onClose, request = '', draft = null }: { onClose: () => void; request?: string; draft?: MailDraft | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusErr, setStatusErr] = useState('');
  const [switching, setSwitching] = useState(false);
  const refreshStatus = useCallback(() => {
    setStatusErr('');
    void deadline(window.cth.mailStatus(), 15_000, 'Loading mail')
      .then((s) => { setStatus(s); setSwitching(false); })
      .catch((e) => { setStatus({ configured: false, office: true }); setStatusErr(msg(e, 'Could not load mail status.')); });
  }, []);
  useEffect(refreshStatus, [refreshStatus]);

  // A request to auto-run once the mailbox is signed in.
  const pending = useRef<string>('');
  const [asked, setAsked] = useState('');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (freshRequest !== null && freshRequest === request && request.trim()) {
      pending.current = request.trim(); setAsked(request.trim()); setNonce((n) => n + 1);
    }
    freshRequest = null;
  }, [request]);
  useEffect(() => {
    // Panel already open and another `@mail …` arrives (even with the same text).
    const onOpen = (e: Event) => {
      const r = (e as CustomEvent<{ request?: string } | undefined>).detail?.request;
      if (typeof r === 'string' && r.trim()) { pending.current = r.trim(); setAsked(r.trim()); setNonce((n) => n + 1); }
      freshRequest = null;
    };
    window.addEventListener('jargon:open-mail', onOpen);
    return () => window.removeEventListener('jargon:open-mail', onOpen);
  }, []);
  const takeRequest = useCallback(() => { const r = pending.current; pending.current = ''; return r; }, []);

  const signOut = async () => {
    try { await deadline(window.cth.mailDisconnect(), 15_000, 'Signing out'); } catch { /* status refresh shows the truth */ }
    refreshStatus();
  };

  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { rootRef.current?.focus({ preventScroll: true }); }, []);

  const signedIn = !!status?.office && !!status.configured && !switching;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(26,19,32,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Mail" tabIndex={-1}
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        style={{ outline: 'none' }}>
        <PixelPanel variant="dialog" title="MAIL" noPadding>
          <div style={{ width: 'min(1040px, calc(100vw - 48px))', height: 'min(660px, calc(100vh - 96px))', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--cth-ink-100)', background: 'var(--cth-cream-100)' }}>
              <div style={{ width: 36, height: 36, flexShrink: 0, overflow: 'hidden', background: 'var(--cth-sky-light)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <SpritePortrait character="mailman" scale={1} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cth-ink-900)' }}>Mailman</div>
                <div style={{ ...muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {asked
                    ? (status?.configured ? `You asked: ${asked}` : `You asked: ${asked} — sign in and I'll get right on it.`)
                    : 'Sign in once, then ask me anything about your mail.'}
                </div>
              </div>
              {signedIn && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', ...muted, flexShrink: 0 }}>
                  <span title={status?.user} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status?.user}</span>
                  <button type="button" style={linkBtn} onClick={() => setSwitching(true)}>Switch account</button>
                  <button type="button" style={linkBtn} onClick={() => { void signOut(); }}>Sign out</button>
                </div>
              )}
            </div>
            {!status ? (
              <div style={{ padding: 16, ...muted }}>Loading…</div>
            ) : !status.office ? (
              <div style={{ padding: 16, fontSize: 13, color: 'var(--cth-ink-900)' }}>
                Mail lives on the Office floor. Switch the floor to <b>Office</b> with the Office Theme picker, then open Mail again.
              </div>
            ) : !status.configured || switching ? (
              <>
                {statusErr && <div role="alert" style={{ padding: '8px 16px 0', ...errStyle }}>{statusErr}</div>}
                <SignIn onDone={refreshStatus} onCancel={switching ? () => setSwitching(false) : undefined} googleClient={!!status.googleClient} />
              </>
            ) : (
              <Inbox user={status.user ?? ''} takeRequest={takeRequest} nonce={nonce} startDraft={draft} />
            )}
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}

// ─── sign-in ────────────────────────────────────────────────────────────────

function SignIn({ onDone, onCancel, googleClient }: { onDone: () => void; onCancel?: () => void; googleClient: boolean }) {
  const [gBusy, setGBusy] = useState(false);
  const [gErr, setGErr] = useState('');
  const googleSignIn = async () => {
    if (gBusy) return;
    setGBusy(true); setGErr('');
    try {
      const res = await deadline(window.cth.mailGoogleSignIn(), CONNECT_DEADLINE_MS, 'Signing in with Google');
      if (res.ok) onDone(); else setGErr(res.error ?? 'Google sign-in failed.');
    } catch (e) { setGErr(msg(e, 'Google sign-in failed.')); } finally { setGBusy(false); }
  };
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [prov, setProv] = useState<MailProviderInfo | null>(null);
  const [adv, setAdv] = useState(false);
  const [touched, setTouched] = useState(false);
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [phases, setPhases] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [errKind, setErrKind] = useState('');

  // Detect the provider as the address is typed (debounced; MX lookup in main).
  useEffect(() => {
    const email = user.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setProv(null); return; }
    let live = true;
    const t = setTimeout(() => {
      void deadline(window.cth.mailPreset(email), 8_000, 'Detecting your provider').then((p) => {
        if (!live) return;
        setProv(p);
        if (p && !touched) {
          setImapHost(p.imapHost); setImapPort(String(p.imapPort));
          setSmtpHost(p.smtpHost); setSmtpPort(String(p.smtpPort));
        }
      }).catch(() => { if (live) setProv(null); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [user, touched]);

  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { setTouched(true); set(e.target.value); };

  const connect = async () => {
    if (busy) return;
    setBusy(true); setErr(''); setErrKind(''); setPhases([]);
    const off = window.cth.onMailProgress((p) => setPhases((xs) => (xs.includes(p) ? xs : [...xs, p])));
    try {
      const port = (s: string) => { const n = Number.parseInt(s, 10); return Number.isInteger(n) ? n : undefined; };
      const res = await deadline(window.cth.mailConnect(touched
        ? { user: user.trim(), pass, imapHost: imapHost.trim(), smtpHost: smtpHost.trim(), imapPort: port(imapPort), smtpPort: port(smtpPort) }
        : { user: user.trim(), pass }), CONNECT_DEADLINE_MS, 'Signing in');
      if (res.ok) { setPass(''); onDone(); }
      else { setErr(res.error ?? 'Could not sign in.'); setErrKind(res.kind ?? ''); if (res.kind === 'tls' || res.kind === 'dns' || res.kind === 'refused') setAdv(true); }
    } catch (e) {
      setErr(msg(e, 'Could not sign in.'));
    } finally { off(); setBusy(false); }
  };

  const isAppPw = prov && prov.id !== 'generic';
  const helpBtn = prov?.hasHelpPage && (
    <button type="button" style={linkBtn} onClick={() => { void window.cth.mailOpenHelp(prov.id); }}>
      {prov.id === 'zoho' ? 'Open Zoho account settings ↗' : `Get a ${prov.name.replace(/ \(.*\)$/, '')} app password ↗`}
    </button>
  );
  return (
    <div onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && user.trim() && pass) { e.preventDefault(); void connect(); } }}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480, overflowY: 'auto' }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cth-ink-900)' }}>Sign in to your mailbox</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--cth-ink-100)' }}>
        <div><PixelButton variant="primary" size="sm" disabled={!googleClient || gBusy} onClick={() => { void googleSignIn(); }}>{gBusy ? 'Waiting for Google…' : 'Sign in with Google'}</PixelButton></div>
        {!googleClient && <span style={muted}>One-time setup: add your Google OAuth client in Settings → Connections → Email, then come back here.</span>}
        {gErr && <span role="alert" style={errStyle}>{gErr}</span>}
        <span style={muted}>Or use an app password:</span>
      </div>
      <span style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-700, var(--cth-ink-900))' }}>
        Your password is encrypted on this device and never leaves it except to your mail server. The Mailman never sends anything until you press Send.
      </span>
      <input style={box} type="email" autoComplete="off" autoFocus placeholder="you@example.com" aria-label="Email address" value={user}
        onChange={(e) => setUser(e.target.value)} disabled={busy} />
      {prov && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-100)' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cth-ink-900)' }}>
            {prov.via === 'guess' ? `Mailbox at ${prov.name}` : `${prov.name} detected`}
          </span>
          <span style={{ ...muted, lineHeight: '16px' }}>{prov.help}</span>
          {helpBtn && <div>{helpBtn}</div>}
        </div>
      )}
      <input style={box} type="password" autoComplete="off" aria-label={isAppPw ? 'App password' : 'Password'}
        placeholder={isAppPw ? 'App password' : 'Password (or app password)'} value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy} />
      <div>
        <button type="button" style={linkBtn} onClick={() => setAdv((v) => !v)} aria-expanded={adv}>{adv ? 'Hide advanced' : 'Advanced (servers & ports)'}</button>
      </div>
      {adv && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 6 }}>
          <input style={box} aria-label="IMAP server" placeholder="IMAP server (imap.example.com)" value={imapHost} onChange={edit(setImapHost)} disabled={busy} />
          <input style={box} aria-label="IMAP port" placeholder="993" inputMode="numeric" value={imapPort} onChange={edit(setImapPort)} disabled={busy} />
          <input style={box} aria-label="SMTP server" placeholder="SMTP server (smtp.example.com)" value={smtpHost} onChange={edit(setSmtpHost)} disabled={busy} />
          <input style={box} aria-label="SMTP port" placeholder="465" inputMode="numeric" value={smtpPort} onChange={edit(setSmtpPort)} disabled={busy} />
          <span style={{ ...muted, gridColumn: '1 / -1' }}>993 / 465 use SSL; 143 / 587 use STARTTLS (always encrypted).</span>
        </div>
      )}
      {busy && (
        <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 2, ...muted }}>
          {(phases.length ? phases : ['Connecting…']).map((p, i, all) => (
            <span key={p}>{i < all.length - 1 ? '✓ ' : '… '}{p}</span>
          ))}
        </div>
      )}
      {err && (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={errStyle}>{err}</span>
          {(errKind === 'auth' || errKind === 'app-password') && helpBtn && <div>{helpBtn}</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <PixelButton variant="primary" size="sm" onClick={() => { void connect(); }} disabled={busy || !user.trim() || !pass}>{busy ? 'Signing in…' : 'Sign in'}</PixelButton>
        {onCancel && <PixelButton variant="secondary" size="sm" onClick={onCancel} disabled={busy}>Cancel</PixelButton>}
      </div>
    </div>
  );
}

// ─── inbox + Mailman ────────────────────────────────────────────────────────

const SUGGESTIONS = ['Summarize my unread mail', 'What action items and dates are in my unread mail?', 'Reply to the selected mail', 'Find mail about invoices'];

type AskOk = Extract<MailAskResult, { ok: true }>;

function Inbox({ user, takeRequest, nonce, startDraft = null }: { user: string; takeRequest: () => string; nonce: number; startDraft?: MailDraft | null }) {
  const [list, setList] = useState<Summary[]>([]);
  const [listTitle, setListTitle] = useState('Inbox');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [unseen, setUnseen] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [pane, setPane] = useState<'mailman' | 'mail'>('mail');

  const [ask, setAsk] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [askPhase, setAskPhase] = useState('');
  const [askErr, setAskErr] = useState('');
  const [answer, setAnswer] = useState<AskOk | null>(null);
  const askGen = useRef(0);
  const draftRef = useRef<DraftState | null>(null);
  const onDraft = useCallback((d: DraftState | null) => { draftRef.current = d; }, []);

  const [pageSize, setPageSize] = useState(40);
  const load = useCallback(async (q: string, u: boolean, limit = 40) => {
    setLoading(true); setErr(''); setPageSize(limit);
    try {
      const res = await deadline(window.cth.mailList({ limit, unseenOnly: u, query: q }), READ_DEADLINE_MS, 'Loading mail');
      if (res.ok) { setList(res.messages ?? []); setListTitle(q ? `Matching "${q}"` : u ? 'Unread' : 'Inbox'); }
      else setErr(res.error ?? 'Could not load mail.');
    } catch (e) {
      setErr(msg(e, 'Could not load mail.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load('', false); }, [load]);

  const runAsk = useCallback(async (text: string) => {
    const request = text.trim();
    if (!request) return;
    const gen = ++askGen.current;
    setAskBusy(true); setAskErr(''); setAskPhase('Starting…'); setPane('mailman');
    const off = window.cth.onMailProgress((p) => { if (askGen.current === gen) setAskPhase(p); });
    try {
      const res = await deadline(window.cth.mailAsk({ request, selectedUid: sel, draft: draftRef.current }), ASK_DEADLINE_MS, 'The Mailman');
      if (askGen.current !== gen) return;
      if (!res.ok) { setAskErr(res.error); setAnswer(null); return; }
      setAnswer(res);
      const lastList = [...res.items].reverse().find((i): i is Extract<MailAskItem, { kind: 'list' }> => i.kind === 'list');
      if (lastList) { setList(lastList.messages); setListTitle(lastList.title); }
      const open = res.items.find((i): i is Extract<MailAskItem, { kind: 'open' }> => i.kind === 'open');
      if (open && res.items.every((i) => i.kind === 'open' || i.kind === 'list')) { setSel(open.uid); setPane('mail'); }
    } catch (e) {
      if (askGen.current === gen) setAskErr(msg(e, 'The Mailman could not do that.'));
    } finally {
      off();
      if (askGen.current === gen) { setAskBusy(false); setAskPhase(''); }
    }
  }, [sel]);

  // Auto-run a request that arrived via `@mail …` (once).
  const runRef = useRef(runAsk);
  runRef.current = runAsk;
  useEffect(() => {
    const r = takeRequest();
    if (r) { setAsk(r); void runRef.current(r); }
  }, [nonce, takeRequest]);

  const stop = () => { askGen.current++; setAskBusy(false); setAskPhase(''); setAskErr('Stopped waiting. (Anything already running finishes in the background; nothing is sent.)'); };

  const pick = (uid: number) => { setSel(uid); setPane('mail'); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--cth-ink-300)' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={box} aria-label="Ask the Mailman" placeholder='Ask the Mailman — e.g. "summarize my unread", "reply saying I can make Tuesday"'
            value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={2000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !askBusy) { e.preventDefault(); void runAsk(ask); } }} />
          <PixelButton variant="primary" size="sm" onClick={() => { void runAsk(ask); }} disabled={askBusy || !ask.trim()}>{askBusy ? 'Working…' : 'Ask'}</PixelButton>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" style={{ ...linkBtn, color: 'var(--cth-ink-500)' }} disabled={askBusy}
              onClick={() => { setAsk(s); if (!/invoices$/.test(s)) void runAsk(s); }}>{s}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--cth-ink-300)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, borderBottom: '1px solid var(--cth-ink-300)' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={box} placeholder="Search mail" value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void load(query, unseen); }} />
              <PixelButton variant="secondary" size="sm" onClick={() => { void load(query, unseen); }}>Go</PixelButton>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', ...muted }}>
              <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={unseen} onChange={(e) => { setUnseen(e.target.checked); void load(query, e.target.checked); }} /> Unread only
              </label>
              <span style={{ flex: 1 }} />
              <button type="button" style={linkBtn} onClick={() => { void load(query, unseen); }}>Refresh</button>
            </div>
          </div>
          <div style={{ ...muted, padding: '4px 10px', borderBottom: '1px solid var(--cth-ink-100)' }}>{listTitle}</div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {loading && <div style={{ padding: 10, ...muted }}>Loading…</div>}
            {err && (
              <div role="alert" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={errStyle}>{err}</span>
                <div><PixelButton variant="secondary" size="sm" onClick={() => { void load(query, unseen); }}>Try again</PixelButton></div>
              </div>
            )}
            {!loading && !err && list.length === 0 && <div style={{ padding: 10, ...muted }}>No messages.</div>}
            {list.map((m) => <MailRow key={m.uid} m={m} active={sel === m.uid} onClick={() => pick(m.uid)} />)}
            {!loading && !err && list.length >= pageSize && pageSize < 1000 && (
              <div style={{ padding: 8 }}><PixelButton variant="secondary" size="sm" onClick={() => { void load(query, unseen, Math.min(1000, pageSize + 100)); }}>Load more</PixelButton></div>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {(answer || askBusy || askErr) && (
            <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderBottom: '1px solid var(--cth-ink-100)' }}>
              <PixelButton variant={pane === 'mailman' ? 'primary' : 'secondary'} size="sm" onClick={() => setPane('mailman')}>Mailman</PixelButton>
              <PixelButton variant={pane === 'mail' ? 'primary' : 'secondary'} size="sm" onClick={() => setPane('mail')}>{sel === null ? 'New message' : 'Message'}</PixelButton>
            </div>
          )}
          {pane === 'mailman' && (answer || askBusy || askErr) ? (
            <MailmanResults busy={askBusy} phase={askPhase} error={askErr} answer={answer} user={user} onPick={pick} onStop={stop} onDraft={onDraft} />
          ) : sel === null ? (
            <div style={{ padding: '12px 16px', overflowY: 'auto' }}>
              {startDraft ? (
                <>
                  <div style={{ ...muted, marginBottom: 6 }}>The Mailman drafted this. Edit anything you like — nothing is sent until you press Send and confirm.</div>
                  {startDraft.warnings.map((w) => <div key={w} style={{ ...errStyle, marginBottom: 4 }}>⚠ {w}</div>)}
                </>
              ) : <div style={{ ...muted, marginBottom: 8 }}>Select a message — or ask the Mailman above.</div>}
              <Composer key={startDraft ? `draft:${startDraft.to}:${startDraft.subject}` : 'blank'} user={user} initial={startDraft ? draftInitial(startDraft) : null} onSent={() => undefined} onDraft={onDraft} />
            </div>
          ) : (
            <Reader key={sel} uid={sel} user={user} onDraft={onDraft} />
          )}
        </div>
      </div>
    </div>
  );
}

function MailRow({ m, active, onClick }: { m: Summary; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: '7px 10px',
        borderBottom: '1px solid var(--cth-ink-100)', background: active ? 'var(--cth-lemon)' : 'transparent', color: 'var(--cth-ink-900)' }}>
      <div style={{ fontSize: 12, fontWeight: m.seen ? 400 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.from || '(unknown sender)'}</div>
      <div style={{ fontSize: 12, fontWeight: m.seen ? 400 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject}</div>
      <div style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{fmtDate(m.date)}</div>
    </button>
  );
}

function MailmanResults({ busy, phase, error, answer, user, onPick, onStop, onDraft }: {
  busy: boolean; phase: string; error: string; answer: AskOk | null; user: string;
  onPick: (uid: number) => void; onStop: () => void; onDraft: (d: DraftState | null) => void;
}) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 12, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {busy && (
        <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>The Mailman is on it… {phase}</span>
          <button type="button" style={linkBtn} onClick={onStop}>Stop waiting</button>
        </div>
      )}
      {error && <span role="alert" style={errStyle}>{error}</span>}
      {answer && !busy && (
        <>
          {answer.note && <div style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>{answer.note}</div>}
          {answer.steps.length > 0 && <div style={muted}>Did: {answer.steps.join(' → ')}</div>}
          {answer.warnings.map((w) => <div key={w} style={muted}>⚠ {w}</div>)}
          {answer.items.length === 0 && <div style={muted}>Nothing to show.</div>}
          {answer.items.map((it, i) => <AskItem key={i} item={it} user={user} onPick={onPick} onDraft={onDraft} />)}
        </>
      )}
    </div>
  );
}

function AskItem({ item, user, onPick, onDraft }: { item: MailAskItem; user: string; onPick: (uid: number) => void; onDraft: (d: DraftState | null) => void }) {
  const head = (t: string) => <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cth-ink-900)', marginBottom: 4 }}>{t}</div>;
  switch (item.kind) {
    case 'list':
      return (
        <div>
          {head(`${item.title} (${item.messages.length})`)}
          {item.messages.length === 0 && <span style={muted}>No messages.</span>}
          <div style={{ border: item.messages.length ? '1px solid var(--cth-ink-100)' : 'none', maxHeight: 220, overflowY: 'auto' }}>
            {item.messages.map((m) => <MailRow key={m.uid} m={m} active={false} onClick={() => onPick(m.uid)} />)}
          </div>
        </div>
      );
    case 'open':
      return <div>{head('Opened')}<button type="button" style={linkBtn} onClick={() => onPick(item.uid)}>{item.subject || `Message ${item.uid}`}</button></div>;
    case 'text':
      return (
        <div>
          {head(item.title)}
          <div className="cth-chat-md" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-900)', overflowWrap: 'anywhere' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown></div>
          {item.uid !== null && <button type="button" style={{ ...linkBtn, marginTop: 4 }} onClick={() => onPick(item.uid as number)}>Open this mail</button>}
        </div>
      );
    case 'draft':
      return (
        <div style={{ border: '1px solid var(--cth-ink-300)', padding: 8 }}>
          {head(`Draft — ${item.title}`)}
          <div style={{ ...muted, marginBottom: 6 }}>Review and edit. Nothing is sent until you press Send and confirm.</div>
          {item.draft.warnings.map((w) => <div key={w} style={{ ...errStyle, marginBottom: 4 }}>⚠ {w}</div>)}
          <Composer user={user} initial={draftInitial(item.draft)} onSent={() => undefined} onDraft={onDraft} />
        </div>
      );
    case 'error':
      return <div>{head(item.title)}<span role="alert" style={errStyle}>{item.text}</span></div>;
  }
}

function draftInitial(d: MailDraft): ComposerInit {
  return { to: d.to, cc: d.cc, subject: d.subject, body: d.text, inReplyTo: d.inReplyTo, references: d.references, uid: d.replyToUid };
}

// ─── reader ─────────────────────────────────────────────────────────────────

function Reader({ uid, user, onDraft }: { uid: number; user: string; onDraft: (d: DraftState | null) => void }) {
  const [message, setMessage] = useState<Full | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('read');
  const [ai, setAi] = useState<Record<string, { text?: string; error?: string; busy?: boolean }>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setErr(''); setMessage(null);
    void deadline(window.cth.mailRead(uid), READ_DEADLINE_MS, 'Opening the message').then((r) => {
      if (!live) return;
      if (r.ok && r.message) { setMessage(r.message); setFacts(r.facts ?? null); } else setErr(r.error ?? 'Could not open the message.');
    }).catch((e) => { if (live) setErr(msg(e, 'Could not open the message.')); });
    return () => { live = false; };
  }, [uid, attempt]);

  const run = async (action: 'summarize' | 'extract') => {
    setAi((s) => ({ ...s, [action]: { busy: true } }));
    try {
      const r = await deadline(window.cth.mailAi({ action, uid }), AI_DEADLINE_MS, 'The AI');
      setAi((s) => ({ ...s, [action]: r.ok ? { text: r.text } : { error: r.error ?? 'Failed.' } }));
    } catch (e) {
      setAi((s) => ({ ...s, [action]: { error: msg(e, 'Failed.') } }));
    }
  };

  if (err) {
    return (
      <div role="alert" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={errStyle}>{err}</span>
        <div><PixelButton variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</PixelButton></div>
      </div>
    );
  }
  if (!message) return <div style={{ padding: 16, ...muted }}>Opening…</div>;

  const tabs: Array<[Tab, string]> = [['read', 'Read'], ['summary', 'Summary'], ['details', 'Details'], ['write', 'Reply']];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--cth-ink-300)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cth-ink-900)', overflowWrap: 'anywhere' }}>{message.subject}</div>
        <div style={muted}>From {message.from} · {fmtDate(message.date)}</div>
        <div style={{ ...muted, overflowWrap: 'anywhere' }}>To {message.to}{message.cc ? ` · Cc ${message.cc}` : ''}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {tabs.map(([k, label]) => (
            <PixelButton key={k} variant={tab === k ? 'primary' : 'secondary'} size="sm" onClick={() => setTab(k)}>{label}</PixelButton>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, minHeight: 0 }}>
        {tab === 'read' && (
          <>
            <pre style={pre}>{message.text || '(empty message)'}</pre>
            {message.truncated && <div style={muted}>…message truncated.</div>}
            {message.attachments.length > 0 && (
              <div style={{ marginTop: 10, ...muted }}>Attachments: {message.attachments.map((a) => `${a.name} (${Math.max(1, Math.round(a.size / 1024))} KB)`).join(', ')}</div>
            )}
          </>
        )}
        {tab === 'summary' && <AiBlock label="Summarize this email" state={ai.summarize} onRun={() => { void run('summarize'); }} />}
        {tab === 'details' && (
          <>
            <AiBlock label="Extract key details with AI" state={ai.extract} onRun={() => { void run('extract'); }} />
            <FactsView facts={facts} />
          </>
        )}
        {tab === 'write' && (
          <Composer user={user} onDraft={onDraft}
            initial={{ to: /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(message.from)?.[1] ?? message.from, cc: '', subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`, body: '', inReplyTo: message.messageId, references: [...message.references, ...(message.messageId ? [message.messageId] : [])], uid }}
            onSent={() => setTab('read')} />
        )}
      </div>
    </div>
  );
}

function AiBlock({ label, state, onRun }: { label: string; state?: { text?: string; error?: string; busy?: boolean }; onRun: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <div><PixelButton variant="primary" size="sm" onClick={onRun} disabled={state?.busy}>{state?.busy ? 'Working…' : state?.text ? 'Run again' : label}</PixelButton></div>
      {state?.error && <span role="alert" style={errStyle}>{state.error}</span>}
      {state?.text && <pre style={pre}>{state.text}</pre>}
    </div>
  );
}

function FactsView({ facts }: { facts: Facts | null }) {
  if (!facts) return null;
  const rows: Array<[string, string[]]> = [
    ['Deadlines', facts.deadlines], ['Dates', facts.dates], ['Amounts', facts.amounts],
    ['Links', facts.urls], ['Emails', facts.emails], ['Phones', facts.phones],
  ];
  const any = rows.some(([, v]) => v.length);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cth-ink-900)' }}>Found in the text</div>
      {!any && <span style={muted}>Nothing structured found.</span>}
      {rows.filter(([, v]) => v.length).map(([k, v]) => (
        <div key={k} style={{ fontSize: 12, color: 'var(--cth-ink-900)' }}>
          <b>{k}</b>
          <ul style={{ margin: '2px 0 0 18px', padding: 0, overflowWrap: 'anywhere' }}>{v.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

// ─── composer (the only place a send can start — always confirmed) ─────────

type ComposerInit = { to: string; cc: string; subject: string; body: string; inReplyTo: string | null; references: string[]; uid: number | null };

function Composer({ user, initial, onSent, onDraft }: {
  user: string;
  initial: ComposerInit | null;
  onSent: () => void;
  onDraft?: (d: DraftState | null) => void;
}) {
  const [open, setOpen] = useState(initial !== null);
  const [to, setTo] = useState(initial?.to ?? '');
  const [cc, setCc] = useState(initial?.cc ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [tone, setTone] = useState('professional');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Let the Mailman see the draft being written (for "rewrite my draft …").
  useEffect(() => {
    if (!onDraft) return;
    onDraft(open && body.trim() ? { to, cc, subject, text: body } : null);
  }, [onDraft, open, to, cc, subject, body]);
  useEffect(() => () => { onDraft?.(null); }, [onDraft]);

  const ai = async (action: 'rewrite' | 'reply') => {
    setBusy(action); setErr('');
    try {
      const r = await deadline(window.cth.mailAi(action === 'reply'
        ? { action, uid: initial?.uid ?? undefined, tone, instructions: body.trim() || undefined }
        : { action, text: body, tone }), AI_DEADLINE_MS, 'The AI');
      if (r.ok && r.text) setBody(r.text); else setErr(r.error ?? 'The AI could not do that.');
    } catch (e) {
      setErr(msg(e, 'The AI could not do that.'));
    } finally { setBusy(''); }
  };
  const send = async () => {
    setBusy('send'); setErr(''); setConfirming(false);
    try {
      const r = await deadline(window.cth.mailSend({ to, cc, subject, text: body, inReplyTo: initial?.inReplyTo, references: initial?.references }), 120_000, 'Sending');
      if (r.ok) { setDone(`Sent to ${to}.`); setBody(''); setOpen(false); onSent(); } else setErr(r.error ?? 'Could not send.');
    } catch (e) {
      setErr(`${msg(e, 'Could not send.')} Check your Sent folder before trying again.`);
    } finally { setBusy(''); }
  };

  if (!open) {
    return (
      <div style={{ padding: '4px 0 12px' }}>
        {done && <div style={{ ...muted, color: 'var(--cth-mint)' }}>{done}</div>}
        <PixelButton variant="secondary" size="sm" onClick={() => { setDone(''); setOpen(true); }}>New message</PixelButton>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 12 }}>
      <input style={box} aria-label="To" placeholder="To (comma separated)" value={to} onChange={(e) => { setTo(e.target.value); setConfirming(false); }} />
      <input style={box} aria-label="Cc" placeholder="Cc" value={cc} onChange={(e) => { setCc(e.target.value); setConfirming(false); }} />
      <input style={box} aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea style={{ ...box, minHeight: 140, resize: 'vertical', fontFamily: 'var(--cth-font-ui)', lineHeight: '18px' }}
        aria-label="Message"
        placeholder={initial?.uid ? 'Write your reply — or type a few notes and press “AI draft reply”.' : 'Write your message'}
        value={body} onChange={(e) => { setBody(e.target.value); setConfirming(false); }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tone} onChange={(e) => setTone(e.target.value)} style={{ ...box, width: 'auto' }} aria-label="Tone">
          {['professional', 'friendly', 'formal', 'short and direct', 'warm', 'apologetic'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <PixelButton variant="secondary" size="sm" disabled={!!busy || !body.trim()} onClick={() => { void ai('rewrite'); }}>{busy === 'rewrite' ? 'Rewriting…' : 'Rewrite'}</PixelButton>
        {initial?.uid ? <PixelButton variant="secondary" size="sm" disabled={!!busy} onClick={() => { void ai('reply'); }}>{busy === 'reply' ? 'Drafting…' : 'AI draft reply'}</PixelButton> : null}
        <span style={{ flex: 1 }} />
        {confirming ? (
          <>
            <span style={muted}>Send from {user} to {to}{cc ? ` (cc ${cc})` : ''}?</span>
            <PixelButton variant="primary" size="sm" disabled={busy === 'send'} onClick={() => { void send(); }}>{busy === 'send' ? 'Sending…' : 'Yes, send'}</PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={() => setConfirming(false)}>Cancel</PixelButton>
          </>
        ) : (
          <PixelButton variant="primary" size="sm" disabled={!!busy || !to.trim() || !body.trim()} onClick={() => setConfirming(true)}>Send</PixelButton>
        )}
      </div>
      {err && <span role="alert" style={errStyle}>{err}</span>}
      {done && <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{done}</span>}
    </div>
  );
}
