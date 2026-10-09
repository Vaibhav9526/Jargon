/**
 * Gmail sign-in (Google OAuth) for Jargon Mail and the Email integration.
 *
 * Jargon does not ship a Google client of its own. The user creates a "Desktop
 * app" OAuth client in their Google Cloud project (Gmail API enabled), pastes
 * its client id/secret into Settings → Connections, and signs in through the
 * system browser (PKCE + loopback redirect). The tokens are written to
 * ~/.gmail-mcp/credentials.json — the file the Gmail MCP server
 * (@gongrzhe/server-gmail-autoauth-mcp) reads when an agent starts — so ONE
 * sign-in serves both the Mail panel (IMAP/SMTP over XOAUTH2, scope
 * https://mail.google.com/) and agents.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { shell, type IpcMain } from 'electron';

export const GMAIL_MCP_PACKAGE = '@gongrzhe/server-gmail-autoauth-mcp';
const DIR = () => join(homedir(), '.gmail-mcp');
const KEYS = () => join(DIR(), 'gcp-oauth.keys.json');
const CREDS = () => join(DIR(), 'credentials.json');
const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
const SCOPE = 'https://mail.google.com/ openid email';
const CLIENT_ID = /^[\w.-]{10,200}\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET = /^[\w-]{8,200}$/;

type Result = { ok: true } | { ok: false; error: string };

interface StoredCreds {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  jargon_email?: string;
  [k: string]: unknown;
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return null; }
}

function readClient(): { id: string; secret: string } | null {
  const k = readJson<{ installed?: { client_id?: string; client_secret?: string } }>(KEYS());
  const id = k?.installed?.client_id;
  const secret = k?.installed?.client_secret;
  return id && secret ? { id, secret } : null;
}

export function gmailStatus(): { hasClient: boolean; signedIn: boolean } {
  return { hasClient: existsSync(KEYS()), signedIn: existsSync(CREDS()) };
}

export function saveGmailClient(clientId: unknown, clientSecret: unknown): Result {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  const secret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
  if (!CLIENT_ID.test(id)) return { ok: false, error: 'Client ID should end in .apps.googleusercontent.com.' };
  if (!CLIENT_SECRET.test(secret)) return { ok: false, error: 'Client secret looks invalid.' };
  try {
    mkdirSync(DIR(), { recursive: true });
    writeFileSync(KEYS(), JSON.stringify({
      installed: {
        client_id: id,
        client_secret: secret,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        redirect_uris: ['http://localhost:3000/oauth2callback'],
      },
    }, null, 2), { mode: 0o600 });
    // A different client invalidates any token issued to the old one.
    rmSync(CREDS(), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function signOutGmail(): Result {
  try {
    rmSync(CREDS(), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

let signingIn = false;

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:48px;text-align:center"><h2>${title}</h2><p>${body}</p>`;

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error_description ?? json.error ?? `Google answered ${res.status}`));
  return json;
}

function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== 'string') return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: unknown };
    return typeof payload.email === 'string' ? payload.email : undefined;
  } catch { return undefined; }
}

/** Opens the system browser, waits for Google to redirect back to a loopback
 *  port, and stores the tokens. One attempt at a time. */
export async function signInGmail(): Promise<Result> {
  const client = readClient();
  if (!client) return { ok: false, error: 'Save your Google client ID and secret first.' };
  if (signingIn) return { ok: false, error: 'A sign-in is already in progress.' };
  signingIn = true;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth2callback`;
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in timed out — try again.')), SIGN_IN_TIMEOUT_MS);
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirect);
        if (url.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
        const err = url.searchParams.get('error');
        const got = url.searchParams.get('code');
        const ok = !err && !!got && url.searchParams.get('state') === state;
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(ok ? page('Signed in', 'You can close this tab and go back to Jargon.') : page('Sign-in failed', 'Go back to Jargon and try again.'));
        clearTimeout(timer);
        if (ok) resolve(got as string);
        else reject(new Error(err ? `Google: ${err}` : 'Sign-in was not completed.'));
      });
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: client.id, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
        access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
      }).toString();
      void shell.openExternal(auth.toString()).catch((e) => { clearTimeout(timer); reject(e); });
    });
    const t = await tokenRequest({
      code, client_id: client.id, client_secret: client.secret, code_verifier: verifier,
      redirect_uri: redirect, grant_type: 'authorization_code',
    });
    if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string') {
      return { ok: false, error: 'Google did not return a refresh token. Remove Jargon from myaccount.google.com/permissions and sign in again.' };
    }
    const creds: StoredCreds = {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      scope: t.scope,
      token_type: t.token_type ?? 'Bearer',
      expiry_date: Date.now() + (Number(t.expires_in) || 3600) * 1000,
      jargon_email: emailFromIdToken(t.id_token),
    };
    mkdirSync(DIR(), { recursive: true });
    writeFileSync(CREDS(), JSON.stringify(creds, null, 2), { mode: 0o600 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    signingIn = false;
    server.close();
  }
}

/** A fresh access token + address for the signed-in Google account (refreshing
 *  through the stored refresh token when needed), or null when not signed in. */
export async function googleMailLogin(): Promise<{ user: string; accessToken: string } | null> {
  const creds = readJson<StoredCreds>(CREDS());
  const client = readClient();
  if (!creds?.refresh_token || !client || !creds.jargon_email) return null;
  if (creds.access_token && (creds.expiry_date ?? 0) > Date.now() + 60_000) {
    return { user: creds.jargon_email, accessToken: creds.access_token };
  }
  const t = await tokenRequest({
    client_id: client.id, client_secret: client.secret, refresh_token: creds.refresh_token, grant_type: 'refresh_token',
  });
  if (typeof t.access_token !== 'string') throw new Error('Google did not refresh the sign-in. Sign in again in Settings → Connections.');
  const next: StoredCreds = { ...creds, access_token: t.access_token, expiry_date: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
  writeFileSync(CREDS(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return { user: creds.jargon_email, accessToken: t.access_token };
}

export function registerGmailIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  ipcMain.handle('gmail:status', () => gmailStatus());
  ipcMain.handle('gmail:saveClient', (_e, p: { clientId?: unknown; clientSecret?: unknown } | undefined) =>
    saveGmailClient(p?.clientId, p?.clientSecret));
  ipcMain.handle('gmail:signIn', () => signInGmail());
  ipcMain.handle('gmail:signOut', () => signOutGmail());
}
