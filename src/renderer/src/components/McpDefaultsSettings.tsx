import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { MCP_CATALOG, type McpTier } from '@shared/mcpCatalog';

export interface McpDefaultsSettingsProps {
  config: HarnessConfig;
}

const TIER_ORDER: McpTier[] = ['safe-readonly', 'write', 'secret'];
const TIER_LABEL_KEY: Record<McpTier, string> = {
  'safe-readonly': 'mcpDefaults.tiers.safeReadonly',
  'write': 'mcpDefaults.tiers.write',
  'secret': 'mcpDefaults.tiers.secret'
};
const TIER_NOTE_KEY: Record<McpTier, string> = {
  'safe-readonly': 'mcpDefaults.tiers.safeReadonlyNote',
  'write': 'mcpDefaults.tiers.writeNote',
  'secret': 'mcpDefaults.tiers.secretNote'
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--cth-font-display)',
  fontSize: 8,
  lineHeight: '12px',
  color: 'var(--cth-ink-500)',
  textTransform: 'uppercase'
};

export function McpDefaultsSettings({ config }: McpDefaultsSettingsProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  const enabledFor = (id: string): boolean =>
    config.mcpDefaults?.[id]?.enabled ?? MCP_CATALOG.find((e) => e.id === id)?.defaultEnabled ?? false;

  const toggle = async (id: string) => {
    const next = !enabledFor(id);
    try {
      await window.cth.updateConfig({
        mcpDefaults: { ...(config.mcpDefaults ?? {}), [id]: { ...(config.mcpDefaults?.[id] ?? {}), enabled: next } }
      });
      setNote(t('mcpDefaults.toggleNote', { id, state: next ? t('common.on') : t('common.off') }));
      setTimeout(() => setNote(''), 1800);
    } catch {
      setNote(t('mcpDefaults.couldNotSave'));
      setTimeout(() => setNote(''), 2000);
    }
  };

  const [mail, setMail] = useState<Record<string, string>>({});
  const mailVal = (k: string): string => mail[k] ?? config.mcpDefaults?.['email-calendar']?.env?.[k] ?? '';
  const saveMail = async () => {
    const env: Record<string, string> = { ...(config.mcpDefaults?.['email-calendar']?.env ?? {}), ...mail };
    if (env.EMAIL_USER) env.EMAIL_ADDRESS = env.EMAIL_USER;
    env.EMAIL_PROVIDER = 'imap';
    try {
      await window.cth.updateConfig({
        mcpDefaults: {
          ...(config.mcpDefaults ?? {}),
          'email-calendar': { enabled: config.mcpDefaults?.['email-calendar']?.enabled ?? false, env }
        }
      });
      setMail({});
      setNote('Email settings saved — applies to agents started from now on.');
      setTimeout(() => setNote(''), 2500);
    } catch {
      setNote(t('mcpDefaults.couldNotSave'));
      setTimeout(() => setNote(''), 2000);
    }
  };
  // Gmail sign-in (OAuth through the system browser). The user brings their own
  // Google "Desktop app" client; tokens live in ~/.gmail-mcp and serve both agents and the Mail panel.
  const [gmail, setGmail] = useState<{ hasClient: boolean; signedIn: boolean }>({ hasClient: false, signedIn: false });
  const [gClientId, setGClientId] = useState('');
  const [gSecret, setGSecret] = useState('');
  const [gBusy, setGBusy] = useState(false);
  const [gMsg, setGMsg] = useState('');
  useEffect(() => {
    void window.cth.gmailStatus().then(setGmail).catch(() => undefined);
  }, []);
  const gmailMode = config.mcpDefaults?.['email-calendar']?.env?.EMAIL_PROVIDER === 'gmail';
  const setProvider = (provider: 'gmail' | 'imap', enabled: boolean) =>
    window.cth.updateConfig({
      mcpDefaults: {
        ...(config.mcpDefaults ?? {}),
        'email-calendar': {
          enabled,
          env: { ...(config.mcpDefaults?.['email-calendar']?.env ?? {}), EMAIL_PROVIDER: provider }
        }
      }
    });
  const gmailSignIn = async () => {
    setGBusy(true);
    setGMsg('');
    try {
      if (gClientId.trim() || gSecret.trim()) {
        const saved = await window.cth.gmailSaveClient(gClientId, gSecret);
        if (!saved.ok) { setGMsg(saved.error ?? 'Could not save the client.'); return; }
        setGClientId(''); setGSecret('');
      }
      setGMsg('Finish signing in with Google in your browser…');
      const res = await window.cth.gmailSignIn();
      setGmail(await window.cth.gmailStatus());
      if (res.ok) {
        await setProvider('gmail', true);
        setGMsg('Signed in. Agents started from now on can read your Gmail.');
      } else {
        setGMsg(res.error ?? 'Sign-in failed.');
      }
    } catch (e) {
      setGMsg(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setGBusy(false);
    }
  };
  const gmailSignOut = async () => {
    await window.cth.gmailSignOut();
    setGmail(await window.cth.gmailStatus());
    await setProvider('imap', false);
    setGMsg('Signed out of Gmail.');
  };
  const MAIL_FIELDS: Array<[string, string, string]> = [
    ['EMAIL_USER', 'Email address', 'text'],
    ['EMAIL_PASS', 'App password', 'password'],
    ['IMAP_HOST', 'IMAP host (default imap.gmail.com)', 'text'],
    ['SMTP_HOST', 'SMTP host (default smtp.gmail.com)', 'text']
  ];

  const byTier = (tier: McpTier) => MCP_CATALOG.filter((e) => e.tier === tier);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ ...labelStyle, marginBottom: 6 }}>{t('mcpDefaults.title')}</div>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
          {t('mcpDefaults.desc')}
        </span>
      </div>

      {TIER_ORDER.map((tier) => {
        const entries = byTier(tier);
        if (entries.length === 0) return null;
        const isConsent = tier !== 'safe-readonly';
        return (
          <div key={tier} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{
                fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
                color: isConsent ? '#6E1423' : 'var(--cth-ink-500)',
                textTransform: 'uppercase'
              }}>
                {t(TIER_LABEL_KEY[tier])}
              </span>
              <span style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-400, var(--cth-ink-500))' }}>
                {t(TIER_NOTE_KEY[tier])}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((entry) => {
                const on = enabledFor(entry.id);
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, padding: '7px 10px', flexWrap: 'wrap',
                      background: 'var(--cth-paper-100)',
                      boxShadow: `inset 0 0 0 1px ${isConsent && on ? '#6E1423' : 'var(--cth-ink-300)'}`
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--cth-ink-900)', fontWeight: 600 }}>
                        {entry.label}
                        <code style={{
                          marginLeft: 6,
                          fontFamily: 'var(--cth-font-mono)',
                          fontSize: 11,
                          color: 'var(--cth-ink-500)',
                          fontWeight: 400
                        }}>{entry.id}</code>
                      </span>
                      <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)', wordBreak: 'break-word' }}>
                        {entry.description}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { void toggle(entry.id); }}
                      style={{
                        flexShrink: 0,
                        padding: '3px 10px 1px',
                        background: on
                          ? (isConsent ? 'var(--cth-coral-light, #f6d3c4)' : 'var(--cth-lemon)')
                          : 'var(--cth-cream-200)',
                        boxShadow: `inset 0 0 0 1px ${on ? 'var(--cth-ink-900)' : 'var(--cth-ink-700)'}`,
                        border: 'none',
                        fontFamily: 'var(--cth-font-display)',
                        fontSize: 8,
                        lineHeight: '14px',
                        color: 'var(--cth-ink-900)',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      {on ? t('common.on') : t('common.off')}
                    </button>
                    {entry.id === 'email-calendar' && (
                      <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 6, borderBottom: '1px solid var(--cth-ink-300)' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-900)' }}>
                            Gmail (Sign in with Google){gmail.signedIn && gmailMode ? ' — signed in' : ''}
                          </span>
                          {!gmail.hasClient && (
                            <span style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-500)' }}>
                              One-time setup: in Google Cloud Console enable the Gmail API, create an OAuth client of type
                              &quot;Desktop app&quot;, and paste its client ID and secret here. Your Google password is never seen by Jargon; the sign-in also unlocks the Mail panel on the Office floor.
                            </span>
                          )}
                          {!gmail.hasClient && (
                            <>
                              <input type="text" autoComplete="off" placeholder="Client ID (….apps.googleusercontent.com)" value={gClientId}
                                onChange={(e) => setGClientId(e.target.value)}
                                style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--cth-ink-300)', background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)' }} />
                              <input type="password" autoComplete="off" placeholder="Client secret" value={gSecret}
                                onChange={(e) => setGSecret(e.target.value)}
                                style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--cth-ink-300)', background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)' }} />
                            </>
                          )}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" disabled={gBusy} onClick={() => { void gmailSignIn(); }}
                              style={{ padding: '3px 10px 1px', border: 'none', cursor: gBusy ? 'wait' : 'pointer', fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '14px', textTransform: 'uppercase', background: 'var(--cth-lemon)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-900)', color: 'var(--cth-ink-900)' }}>
                              {gmail.signedIn ? 'Sign in again' : 'Sign in with Google'}
                            </button>
                            {gmail.signedIn && (
                              <button type="button" disabled={gBusy} onClick={() => { void gmailSignOut(); }}
                                style={{ padding: '3px 10px 1px', border: 'none', cursor: 'pointer', fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '14px', textTransform: 'uppercase', background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-700)', color: 'var(--cth-ink-900)' }}>
                                Sign out
                              </button>
                            )}
                          </div>
                          {gMsg && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{gMsg}</span>}
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>Or use any IMAP mailbox with an app password:</span>
                        {MAIL_FIELDS.map(([k, ph, type]) => (
                          <input
                            key={k}
                            type={type}
                            autoComplete="off"
                            placeholder={ph}
                            value={mailVal(k)}
                            onChange={(e) => setMail({ ...mail, [k]: e.target.value })}
                            style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--cth-ink-300)', background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)' }}
                          />
                        ))}
                        <button type="button" onClick={() => { void saveMail(); }}
                          style={{ alignSelf: 'flex-start', padding: '3px 10px 1px', border: 'none', cursor: 'pointer', fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '14px', textTransform: 'uppercase', background: 'var(--cth-lemon)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-900)', color: 'var(--cth-ink-900)' }}>
                          Save email settings
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {note && (
        <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{note}</span>
      )}
    </div>
  );
}
