/**
 * IPC for Jargon Mail (Office floor only). Credentials live in the encrypted
 * secret store (safeStorage) and never travel to the renderer.
 */
import { shell, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { deleteSecret, getSecret, setSecret } from './integrations';
import { readConfig } from './config';
import {
  PROVIDER_HELP_URLS, buildAiPrompt, clearAccount, detectProviderWithMx, extractFacts, friendlyMailError, listMessages,
  loadAccount, parseAccount, publicStatus, readMessage, readMessages, runClaudeOnce, saveAccount, sendMail, testAccount,
  type MailAccount, type MailAiAction, type MailSecrets,
} from './mail';
import { runMailRequest } from './mailPlanner';
import type { MailProviderId } from '../shared/mailAsk';

const secrets: MailSecrets = {
  get: (ref) => getSecret(ref),
  set: (ref, plain) => setSecret(ref, plain),
  remove: (ref) => deleteSecret(ref),
};

const AI_ACTIONS: readonly MailAiAction[] = ['summarize', 'extract', 'rewrite', 'reply'];

function onOfficeFloor(): boolean {
  const cfg = readConfig();
  return (cfg.tvShowOffices ? (cfg.officeTheme ?? 'office') : 'office') === 'office';
}

const NOT_OFFICE = {
  ok: false as const,
  error: 'Mail lives on the Office floor. Switch the floor to Office (Office Theme picker), then open Mail again.',
};
const NOT_SET_UP = { ok: false as const, error: 'Sign in to your mailbox first.' };

/** Progress lines for the panel ("Checking inbox…"). Best effort. */
function progressTo(e: IpcMainInvokeEvent) {
  return (phase: string) => {
    try { if (!e.sender.isDestroyed()) e.sender.send('mail:progress', { phase }); } catch { /* window gone */ }
  };
}

export function registerMailIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  // Wrap every handler: floor gate, account load, and errors → { ok:false }.
  const guarded = <T>(fn: (account: MailAccount, payload: Record<string, unknown>, e: IpcMainInvokeEvent) => Promise<T>) =>
    async (e: IpcMainInvokeEvent, payload: unknown) => {
      if (!onOfficeFloor()) return NOT_OFFICE;
      const account = loadAccount(secrets);
      if (!account) return NOT_SET_UP;
      try {
        return await fn(account, (payload ?? {}) as Record<string, unknown>, e);
      } catch (err) {
        return { ok: false as const, error: friendlyMailError(err) };
      }
    };

  ipcMain.handle('mail:status', () => ({ ...publicStatus(loadAccount(secrets)), office: onOfficeFloor() }));

  // Provider auto-detection for the sign-in screen (domain, then MX records).
  ipcMain.handle('mail:preset', async (_e, email: unknown) =>
    (typeof email === 'string' && email.length <= 254 ? detectProviderWithMx(email) : null));

  // Opens ONLY the fixed https help page of a known provider — never a URL
  // supplied by the renderer.
  ipcMain.handle('mail:openHelp', async (_e, provider: unknown) => {
    const url = typeof provider === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_HELP_URLS, provider)
      ? PROVIDER_HELP_URLS[provider as MailProviderId] : null;
    if (!url || !url.startsWith('https://')) return { ok: false as const, error: 'No help page for this provider.' };
    await shell.openExternal(url);
    return { ok: true as const };
  });

  ipcMain.handle('mail:connect', async (e, payload: unknown) => {
    if (!onOfficeFloor()) return NOT_OFFICE;
    const p = { ...((payload ?? {}) as Record<string, unknown>) };
    // Fill servers the user did not type from the detected provider.
    if (typeof p.user === 'string' && (!p.imapHost || !p.smtpHost)) {
      const prov = await detectProviderWithMx(p.user);
      if (prov) {
        if (!p.imapHost) { p.imapHost = prov.imapHost; if (p.imapPort === undefined) p.imapPort = prov.imapPort; }
        if (!p.smtpHost) { p.smtpHost = prov.smtpHost; if (p.smtpPort === undefined) p.smtpPort = prov.smtpPort; }
      }
    }
    const parsed = parseAccount(p);
    if (!parsed.ok) return parsed;
    const progress = progressTo(e);
    const tested = await testAccount(parsed.account, (stage) => progress(stage === 'imap' ? 'Checking inbox…' : 'Checking sending…'));
    if (!tested.ok) return tested;
    const saved = saveAccount(secrets, parsed.account);
    return saved.ok
      ? { ok: true as const, user: parsed.account.user }
      : { ok: false as const, error: saved.error ?? 'Could not store the password securely on this device.' };
  });

  ipcMain.handle('mail:disconnect', () => { clearAccount(secrets); return { ok: true as const }; });

  ipcMain.handle('mail:list', guarded(async (a, p) => ({
    ok: true as const,
    messages: await listMessages(a, {
      limit: typeof p.limit === 'number' ? p.limit : undefined,
      unseenOnly: p.unseenOnly === true,
      query: typeof p.query === 'string' ? p.query : undefined,
    }),
  })));

  ipcMain.handle('mail:read', guarded(async (a, p) => {
    const message = await readMessage(a, Number(p.uid));
    return message ? { ok: true as const, message, facts: extractFacts(message.text) } : { ok: false as const, error: 'Message not found.' };
  }));

  ipcMain.handle('mail:send', guarded(async (a, p) => {
    // The renderer only calls this after an explicit confirmation click.
    if (p.confirmed !== true) return { ok: false as const, error: 'Sending needs your confirmation.' };
    return sendMail(a, {
      to: String(p.to ?? ''), cc: typeof p.cc === 'string' ? p.cc : '',
      subject: String(p.subject ?? ''), text: String(p.text ?? ''),
      inReplyTo: typeof p.inReplyTo === 'string' ? p.inReplyTo : null,
      references: Array.isArray(p.references) ? p.references.filter((r): r is string => typeof r === 'string') : [],
    });
  }));

  ipcMain.handle('mail:ai', guarded(async (a, p) => {
    const action = p.action as MailAiAction;
    if (!AI_ACTIONS.includes(action)) return { ok: false as const, error: 'Unknown action.' };
    const opts = {
      instructions: typeof p.instructions === 'string' ? p.instructions : undefined,
      tone: typeof p.tone === 'string' ? p.tone : undefined,
    };
    let mail: { from: string; subject: string; date: string | null; text: string };
    if (action === 'rewrite') {
      const text = typeof p.text === 'string' ? p.text : '';
      if (!text.trim()) return { ok: false as const, error: 'Write something to rewrite first.' };
      mail = { from: '', subject: '', date: null, text };
    } else {
      const m = await readMessage(a, Number(p.uid));
      if (!m) return { ok: false as const, error: 'Message not found.' };
      mail = { from: m.from, subject: m.subject, date: m.date, text: m.text };
    }
    return runClaudeOnce(buildAiPrompt(action, mail, opts));
  }));

  // The Mailman: natural-language request → whitelisted read-only plan →
  // results + drafts. Never sends (see mailPlanner.ts).
  ipcMain.handle('mail:ask', guarded(async (a, p, e) => {
    const draft = p.draft && typeof p.draft === 'object' ? p.draft as Record<string, unknown> : null;
    return runMailRequest({
      list: (o) => listMessages(a, o),
      readMany: (uids) => readMessages(a, uids),
      ai: (prompt, ms) => runClaudeOnce(prompt, ms),
      progress: progressTo(e),
    }, {
      request: typeof p.request === 'string' ? p.request : '',
      selectedUid: typeof p.selectedUid === 'number' ? p.selectedUid : null,
      draft: draft ? {
        to: typeof draft.to === 'string' ? draft.to : '', cc: typeof draft.cc === 'string' ? draft.cc : '',
        subject: typeof draft.subject === 'string' ? draft.subject : '', text: typeof draft.text === 'string' ? draft.text : '',
      } : null,
    });
  }));
}
