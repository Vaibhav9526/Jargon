/**
 * Gmail sign-in for the Email integration.
 *
 * Jargon does not ship a Google client of its own. The user creates a "Desktop
 * app" OAuth client in their Google Cloud project (Gmail API enabled), pastes
 * its client id/secret into Settings, and signs in through the system browser.
 * The heavy lifting (consent screen, token exchange, refresh) is done by the
 * @gongrzhe/server-gmail-autoauth-mcp package's `auth` command, which stores
 * tokens in ~/.gmail-mcp/credentials.json — the same place the MCP server
 * reads them from when an agent starts. Jargon never sees or stores the tokens.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IpcMain } from 'electron';

export const GMAIL_MCP_PACKAGE = '@gongrzhe/server-gmail-autoauth-mcp';
const DIR = () => join(homedir(), '.gmail-mcp');
const KEYS = () => join(DIR(), 'gcp-oauth.keys.json');
const CREDS = () => join(DIR(), 'credentials.json');
const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
const CLIENT_ID = /^[\w.-]{10,200}\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET = /^[\w-]{8,200}$/;

type Result = { ok: true } | { ok: false; error: string };

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

/** Runs the package's `auth` command (opens the system browser) and resolves
 *  once ~/.gmail-mcp/credentials.json exists. One attempt at a time. */
export function signInGmail(): Promise<Result> {
  if (!existsSync(KEYS())) return Promise.resolve({ ok: false, error: 'Save your Google client ID and secret first.' });
  if (signingIn) return Promise.resolve({ ok: false, error: 'A sign-in is already in progress.' });
  signingIn = true;
  return new Promise<Result>((resolve) => {
    let settled = false;
    const finish = (r: Result) => {
      if (settled) return;
      settled = true;
      signingIn = false;
      clearTimeout(timer);
      resolve(r);
    };
    // Fixed command line — nothing user-supplied reaches the shell.
    const child = spawn(`npx -y ${GMAIL_MCP_PACKAGE} auth`, { shell: true, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ ok: false, error: 'Sign-in timed out — try again.' });
    }, SIGN_IN_TIMEOUT_MS);
    child.on('error', (e) => finish({ ok: false, error: e.message }));
    child.on('exit', () =>
      finish(existsSync(CREDS())
        ? { ok: true }
        : { ok: false, error: 'Sign-in did not complete. Check the client is a Desktop app with the Gmail API enabled.' }));
  });
}

export function registerGmailIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  ipcMain.handle('gmail:status', () => gmailStatus());
  ipcMain.handle('gmail:saveClient', (_e, p: { clientId?: unknown; clientSecret?: unknown } | undefined) =>
    saveGmailClient(p?.clientId, p?.clientSecret));
  ipcMain.handle('gmail:signIn', () => signInGmail());
  ipcMain.handle('gmail:signOut', () => signOutGmail());
}
