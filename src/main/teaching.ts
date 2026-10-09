/**
 * Hosted teaching control — main-process owner of the manual OpenMAIC
 * workspace.
 *
 * The renderer asks to open a lesson; main vets the teacher, checks the
 * calling window's attachment grants and opens a locked-down Jargon Teaching
 * window directly on the hosted site (TEACHING_HOME_URL). There is no hosted
 * API here: no access code, no upload, no generation, no DOM submit — the
 * site is driven by the user alone. This module imports NO electron runtime —
 * every electron surface arrives via `TeachingDeps` injection, so the whole
 * flow (sender guard, grants, window policy, menu) is unit-testable under
 * plain node.
 *
 * Security posture:
 *   - Every IPC handler passes `isTrustedSender`: the sender's window must be
 *     in `allWindows` (the teaching window is deliberately not), the sending
 *     frame must be the top/main frame, and the frame URL must be the exact
 *     dev renderer origin or the packaged renderer file URL.
 *   - Attachment paths are per-window short-TTL grants written only by
 *     `dialog:attachFiles` picks, `clipboard:saveImage` products, and the
 *     preload's File-derived `teaching:grantAttachment` relay — never by a raw
 *     renderer-supplied path at open time. File contents are never read here:
 *     paths only ever reach a local "Show materials" dialog on user click.
 *   - The teaching window is a sandboxed, preloadless BrowserWindow on a
 *     shared persistent session partition (sign-in survives reloads, new
 *     windows and restarts). It may navigate only within the service origin;
 *     the shared session's permission handler dispatches on the REQUESTING
 *     webContents, so one window can never answer another's prompt.
 *   - The only page injection is the fixed branding script built by
 *     teachingBranding.ts from our own logo data URL — user input is never
 *     interpolated, and the gate is its verified brandable-URL predicate.
 */

import { readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseTeachingRequest, type TeachingAttachment, type TeachingRequest } from '../shared/teaching';
import type {
  BrowserWindow, BrowserWindowConstructorOptions, Clipboard, Dialog, IpcMain,
  IpcMainInvokeEvent, Menu, MenuItemConstructorOptions, MessageBoxOptions, NativeImage, Session, Shell, WebContents,
  WebContentsView,
} from 'electron';

/** The hosted site the teaching window opens on — root load only, always. */
export const TEACHING_HOME_URL = 'https://open.maic.chat/';
const TEACHING_ORIGIN = 'https://open.maic.chat';
/** One persistent partition shared by every teaching window: sign-in survives
 *  reloads, new windows and restarts, while staying isolated from the app's
 *  default session. Because it is shared, the permission handler is installed
 *  once per session and dispatches on the requesting webContents. */
const TEACHING_PARTITION = 'persist:jargon-teaching-manual';
/** Attachment grants are short-lived: a pick is meant to be used soon after. */
export const TEACHING_GRANT_TTL_MS = 10 * 60_000;
/** Grants a single window may hold at once — drops the oldest on overflow. */
const TEACHING_MAX_GRANTS_PER_WINDOW = 64;
/** Bound on concurrently open teaching windows. */
const MAX_TEACHING_WINDOWS = 4;
const MAX_GRANT_PATH_CHARS = 4096;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// ─── dep contracts (structural — real modules satisfy these) ────────────────

/** The slice of the hive registry needed to vet a requested teacher. */
export interface TeachingRegistryAgent {
  isGod?: boolean;
  isAssistant?: boolean;
  archived?: boolean;
}
export interface TeachingRegistry {
  godId: string | null;
  agents: Record<string, TeachingRegistryAgent | undefined>;
}

export interface TeachingDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  BrowserWindow: typeof BrowserWindow;
  /** Optional: enables the embedded teaching panel (a view inside the main window). */
  WebContentsView?: typeof WebContentsView;
  nativeImage: {
    createFromBuffer(buffer: Buffer): NativeImage;
  };
  dialog: Pick<Dialog, 'showMessageBox'>;
  shell: Pick<Shell, 'openExternal'>;
  clipboard: Pick<Clipboard, 'writeText'>;
  Menu: Pick<typeof Menu, 'buildFromTemplate'>;
  /** Every trusted Jargon window (primary + floors). The teaching window is
   *  never added, which also bars it from every IPC handler here. */
  allWindows: ReadonlySet<BrowserWindow>;
  /** Dev renderer origin source (ELECTRON_RENDERER_URL), null when packaged. */
  devRendererUrl: () => string | null;
  /** The packaged renderer entry the file:// URL must resolve to exactly. */
  rendererEntryFile: () => string;
  registry: () => TeachingRegistry;
  /** teachingBranding.ts — fixed script factory, called once per window with
   *  OUR logo data URL, plus the predicate that verifies a URL may receive it. */
  createBrandingScript: (logoDataUrl: string) => string;
  isBrandableTeachingUrl: (url: string) => boolean;
  /** Optional: fixed script (topic embedded via JSON only) that hides the
   *  site's navbar/name, locks scrolling and pre-fills the topic box. Never
   *  submits anything. */
  createChromeScript?: (topic: string) => string;
  /** Optional: builds the script that stages the user's own files in the
   *  site's upload input. Only paths this window holds a live grant for are
   *  ever read (open() checks the grants before the window is created). */
  createAttachScript?: (files: Array<{ name: string; mime: string; b64: string }>) => string;
  /** Bundled mark override (test seam; defaults to __dirname/logo.png). */
  logoFile?: () => string;
  /** Optional: drop a fixed, content-free status note into the teacher's hive
   *  inbox — 'opened' means the manual workspace is showing, never that a
   *  classroom was generated. */
  notifyTeacher?: (teacherId: string, status: 'opened' | 'failed') => void;
  /** Test seam for grant expiry. */
  now?: () => number;
}

type Result = { ok: true; jobId?: string } | { ok: false; error: string };

// ─── small helpers ──────────────────────────────────────────────────────────

/** Same canonical key teachingMaterials.normKey uses, so grants and any
 *  consumer agree on path identity. */
function normKey(p: string): string {
  const r = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c] as string);
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain', '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const MAX_STAGED_FILES = 5; // the site accepts at most 5 course-material files
const MAX_STAGED_FILE_BYTES = 25 * 1024 * 1024;
const MAX_STAGED_TOTAL_BYTES = 50 * 1024 * 1024;

/** Read the attachments the user already granted this window and build the
 *  staging script. Oversized or unreadable files are skipped, never fatal. */
function buildAttachScript(
  attachments: readonly TeachingAttachment[],
  make: (files: Array<{ name: string; mime: string; b64: string }>) => string,
): string | null {
  const files: Array<{ name: string; mime: string; b64: string }> = [];
  let total = 0;
  for (const att of attachments.slice(0, MAX_STAGED_FILES)) {
    try {
      const size = statSync(att.path).size;
      if (size > MAX_STAGED_FILE_BYTES || total + size > MAX_STAGED_TOTAL_BYTES) continue;
      const buf = readFileSync(att.path);
      total += buf.length;
      files.push({
        name: att.name,
        mime: MIME_BY_EXT[extname(att.path).toLowerCase()] ?? 'application/octet-stream',
        b64: buf.toString('base64'),
      });
    } catch { /* unreadable file — leave it to the manual upload */ }
  }
  return files.length ? make(files) : null;
}

// ─── the service ────────────────────────────────────────────────────────────

export interface TeachingService {
  registerIpc(): void;
  /** Grant attachment paths to a window (dialog picks, clipboard products). */
  grantPaths(sender: WebContents, paths: readonly string[]): void;
  /** Live, unexpired grant keys for a sender (also evicts expired entries). */
  authorizedPaths(sender: WebContents): ReadonlySet<string>;
}

export function createTeachingService(deps: TeachingDeps): TeachingService {
  const now = deps.now ?? (() => Date.now());

  // ── per-window attachment grants ────────────────────────────────────────
  const grants = new Map<WebContents, Map<string, number>>();

  function grantPaths(sender: WebContents, paths: readonly string[]): void {
    if (!sender || sender.isDestroyed()) return;
    let bag = grants.get(sender);
    if (!bag) {
      bag = new Map();
      grants.set(sender, bag);
      // The grant dies with its owner — a fresh window inherits nothing.
      sender.once('destroyed', () => grants.delete(sender));
    }
    const at = now();
    for (const [key, exp] of bag) if (exp <= at) bag.delete(key);
    for (const p of paths) {
      // Raw path must already be absolute — resolve() must not launder a
      // relative string into a cwd-joined "absolute" grant.
      if (typeof p !== 'string' || !p || p.length > MAX_GRANT_PATH_CHARS
        || CONTROL_CHARS.test(p) || !isAbsolute(p)) continue;
      bag.set(normKey(p), at + TEACHING_GRANT_TTL_MS);
    }
    while (bag.size > TEACHING_MAX_GRANTS_PER_WINDOW) {
      let oldestKey: string | undefined;
      let oldest = Infinity;
      for (const [key, exp] of bag) if (exp < oldest) { oldest = exp; oldestKey = key; }
      if (oldestKey === undefined) break;
      bag.delete(oldestKey);
    }
  }

  function authorizedPaths(sender: WebContents): ReadonlySet<string> {
    const out = new Set<string>();
    const bag = grants.get(sender);
    if (!bag) return out;
    const at = now();
    for (const [key, exp] of bag) {
      if (exp > at) out.add(key);
      else bag.delete(key);
    }
    return out;
  }

  // ── trusted-sender guard ────────────────────────────────────────────────

  /** The caller must be a tracked local Jargon window's top frame, on the
   *  exact dev origin or the packaged renderer file URL. */
  function isTrustedSender(evt: IpcMainInvokeEvent): boolean {
    try {
      const win = deps.BrowserWindow.fromWebContents(evt.sender);
      if (!win || win.isDestroyed() || !deps.allWindows.has(win)) return false;
      const frame = evt.senderFrame;
      if (!frame || frame !== evt.sender.mainFrame) return false;
      let url: URL;
      try {
        url = new URL(frame.url);
      } catch {
        return false;
      }
      if (url.username || url.password) return false;
      const devUrl = deps.devRendererUrl();
      if (devUrl) {
        try {
          return url.origin === new URL(devUrl).origin;
        } catch {
          return false;
        }
      }
      if (url.protocol !== 'file:') return false;
      const expected = resolve(deps.rendererEntryFile());
      const actual = resolve(fileURLToPath(url));
      return process.platform === 'win32'
        ? actual.toLowerCase() === expected.toLowerCase()
        : actual === expected;
    } catch {
      return false;
    }
  }

  // ── branding mark (docs/logo.png copied beside the main bundle) ─────────

  function loadLogo(): { icon: NativeImage | undefined; dataUrl: string | null } {
    try {
      const png = readFileSync(deps.logoFile ? deps.logoFile() : join(__dirname, 'logo.png'));
      const icon = deps.nativeImage.createFromBuffer(png);
      return {
        icon: icon.isEmpty() ? undefined : icon,
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      };
    } catch {
      return { icon: undefined, dataUrl: null };
    }
  }

  // ── local error page (data: URL, CSP with zero scripts) ─────────────────

  const PAGE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

  function errorPage(opts: { topic: string; status: string; logo: string | null }): string {
    const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<title>Jargon Teaching</title>
<style>
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
       font:14px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;background:#f4efe6;color:#2f2a22;text-align:center;padding:32px}
  img{width:64px;height:64px;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 8px}
  .topic{color:#6b5f4c;margin:0 0 24px;max-width:560px;overflow-wrap:anywhere}
  .status{font-size:15px;color:#a33b2e;max-width:560px;overflow-wrap:anywhere}
  .hint{margin-top:32px;color:#8a8172;font-size:12px}
</style></head><body>
${opts.logo ? `<img src="${opts.logo}" alt="">` : ''}
<h1>Could not open the lesson</h1>
${opts.topic ? `<p class="topic">${escapeHtml(opts.topic)}</p>` : ''}
<p class="status">${escapeHtml(opts.status)}</p>
<p class="hint">Close this window and try again.</p>
</body></html>`;
    return `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`;
  }

  // ── the teaching window ─────────────────────────────────────────────────

  interface TeachingWindowCtx {
    id: string;
    /** The standalone window — null when this is an embedded panel. */
    win: BrowserWindow | null;
    /** Window that parents native dialogs (the window itself, or the panel's host). */
    dialogParent: BrowserWindow | null;
    view?: WebContentsView;
    wc: WebContents;
    topic: string;
    attachments: readonly TeachingAttachment[];
    logo: string | null;
    /** Fixed script built once from our logo — null when no mark exists. */
    brandScript: string | null;
    chromeScript: string | null;
    attachScript: string | null;
  }

  /** Windows by id (cap + bookkeeping) and by webContents (permission
   *  dispatch on the shared session). */
  const windowsById = new Map<string, TeachingWindowCtx>();
  const windowsByWc = new Map<WebContents, TeachingWindowCtx>();
  /** The shared partition means one Session object serves every teaching
   *  window — arm each distinct session exactly once. */
  const armedSessions = new WeakSet<Session>();

  /** https + no credentials is the floor; the fixed service origin is the gate. */
  function navOrigin(raw: string): string | null {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  /** Same-tab navigation may reach the hosted site plus the ONE auth hop its
   *  login flow redirects to (verified live: maic.chat/signin carries the
   *  account form; the provider then returns to open.maic.chat). Everything
   *  else — other hosts, odd ports, userinfo, non-https — fails closed; an
   *  unverified auth redirect is never whitelisted by query params. */
  function allowedNavUrl(raw: string): boolean {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) return false;
      if (url.origin === TEACHING_ORIGIN) return true;
      return url.hostname === 'maic.chat' && url.port === '' && url.pathname === '/signin';
    } catch {
      return false;
    }
  }

  function paintError(ctx: TeachingWindowCtx, status: string): void {
    if (ctx.wc.isDestroyed()) return;
    (ctx.win ?? ctx.wc).loadURL(errorPage({ topic: ctx.topic, status, logo: ctx.logo })).catch(() => undefined);
  }

  function messageBox(ctx: TeachingWindowCtx, opts: MessageBoxOptions) {
    const parent = ctx.dialogParent ?? ctx.win;
    return parent ? deps.dialog.showMessageBox(parent, opts) : deps.dialog.showMessageBox(opts);
  }

  /** Every permission request is denied by default. The single carve-out is a
   *  microphone request that is audio-only AND comes from a teaching window's
   *  MAIN frame on the service origin — and even that needs an explicit user
   *  OK. The session is shared, so the requester is identified by webContents
   *  ownership: a foreign or destroyed window can never prompt under the
   *  hosted page's name. */
  function armSession(ses: Session): void {
    if (armedSessions.has(ses)) return;
    armedSessions.add(ses);
    ses.setPermissionRequestHandler((reqWc, permission, callback, details) => {
      const ctx = windowsByWc.get(reqWc);
      if (!ctx || permission !== 'media') return callback(false);
      const d = details as { isMainFrame?: boolean; requestingUrl?: string; mediaTypes?: string[] };
      const types = d.mediaTypes ?? [];
      if (d.isMainFrame !== true || navOrigin(d.requestingUrl ?? '') !== TEACHING_ORIGIN
        || types.length === 0 || !types.every((t) => t === 'audio')) {
        return callback(false);
      }
      void messageBox(ctx, {
        type: 'question',
        buttons: ['Allow microphone', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        message: 'Allow microphone access?',
        detail: 'The hosted lesson site is asking for audio input. Video is never granted.',
      }).then((r) => callback(r.response === 0), () => callback(false));
    });
    ses.setPermissionCheckHandler(() => false);
  }

  function installLessonMenu(ctx: TeachingWindowCtx): void {
    const template: MenuItemConstructorOptions[] = [{
      label: 'Lesson',
      submenu: [
        {
          label: 'Copy Lesson Topic',
          enabled: ctx.topic.length > 0,
          click: () => { try { deps.clipboard.writeText(ctx.topic); } catch { /* clipboard unavailable */ } },
        },
        {
          label: 'Show Materials',
          click: () => {
            const list = ctx.attachments.length
              ? ctx.attachments.map((a, i) => `${i + 1}. ${a.name}\n    ${a.path}`).join('\n')
              : 'No materials were attached to this lesson.';
            void messageBox(ctx, {
              type: 'info',
              buttons: ['OK'],
              title: 'Lesson Materials',
              message: 'Lesson materials',
              detail: `${list}\n\nThese stay on this device — choose what to share on the site yourself.`,
            }).then(() => undefined, () => undefined);
          },
        },
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => { if (!ctx.wc.isDestroyed()) ctx.wc.reload(); },
        },
        { type: 'separator' },
        {
          label: 'Provider Details',
          click: () => {
            void messageBox(ctx, {
              type: 'info',
              buttons: ['OK'],
              title: 'Provider',
              message: 'OpenMAIC',
              detail: 'This window shows the hosted OpenMAIC web app at https://open.maic.chat/. Jargon only opened the site — sign-in, payment, uploads and lesson generation all happen there, under your control.',
            }).then(() => undefined, () => undefined);
          },
        },
      ],
    }];
    ctx.win?.setMenu(deps.Menu.buildFromTemplate(template));
  }

  const WEB_PREFS = {
    // Remote hosted content — hardest lockdown: no Jargon preload, no
    // node, a persistent isolated session, NOT registered in allWindows.
    nodeIntegration: false,
    sandbox: true,
    contextIsolation: true,
    webSecurity: true,
    partition: TEACHING_PARTITION,
  } as const;

  function buildScripts(topic: string, attachments: readonly TeachingAttachment[], dataUrl: string | null) {
    let brandScript: string | null = null;
    if (dataUrl) {
      try { brandScript = deps.createBrandingScript(dataUrl); } catch { brandScript = null; }
    }
    let chromeScript: string | null = null;
    if (deps.createChromeScript) {
      try { chromeScript = deps.createChromeScript(topic); } catch { chromeScript = null; }
    }
    let attachScript: string | null = null;
    if (deps.createAttachScript && attachments.length) {
      try { attachScript = buildAttachScript(attachments, deps.createAttachScript); } catch { attachScript = null; }
    }
    return { brandScript, chromeScript, attachScript };
  }

  function openTeachingWindow(
    jobId: string,
    topic: string,
    attachments: readonly TeachingAttachment[],
  ): TeachingWindowCtx {
    const { icon, dataUrl } = loadLogo();
    const { brandScript, chromeScript, attachScript } = buildScripts(topic, attachments, dataUrl);
    const options: BrowserWindowConstructorOptions = {
      title: 'Jargon Teaching',
      width: 1120,
      height: 800,
      minWidth: 640,
      minHeight: 480,
      show: false,
      ...(icon ? { icon } : {}),
      webPreferences: { ...WEB_PREFS },
    };
    const win = new deps.BrowserWindow(options);
    const wc = win.webContents;
    const ctx: TeachingWindowCtx = {
      id: jobId, win, dialogParent: null, wc, topic, attachments, logo: dataUrl, brandScript, chromeScript, attachScript,
    };

    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
    // The remote page's <title> must not rename this Jargon window.
    win.on('page-title-updated', (e) => e.preventDefault());
    win.on('closed', () => {
      windowsById.delete(jobId);
      windowsByWc.delete(wc);
    });

    wireContents(ctx);
    installLessonMenu(ctx);
    return ctx;
  }

  /** Navigation lockdown, branding/skin injection and failure handling shared by
   *  the standalone window and the embedded panel. */
  function wireContents(ctx: TeachingWindowCtx): void {
    const wc = ctx.wc;
    armSession(wc.session);
    wc.on('will-attach-webview', (e) => e.preventDefault());

    // Content-initiated navigation stays on the hosted site or its single
    // verified auth hop; everything else (credential URLs, other hosts,
    // dangerous schemes) dies.
    const gateNav = (e: { preventDefault(): void }, raw: string) => {
      if (!allowedNavUrl(raw)) {
        console.warn('[teaching] blocked navigation to', String(raw).slice(0, 120));
        e.preventDefault();
      }
    };
    wc.on('will-navigate', gateNav);
    wc.on('will-redirect', gateNav);
    // No child windows, ever. A genuine https link goes to the OS browser,
    // where auth/payment pages keep their real identity.
    wc.setWindowOpenHandler(({ url }) => {
      if (navOrigin(url)) void deps.shell.openExternal(url).catch(() => undefined);
      return { action: 'deny' };
    });

    // The branding script is the ONLY page injection: a fixed script built
    // from our own logo data URL, gated to verified brandable service URLs.
    const run = (label: string, script: string) => {
      void ctx.wc.executeJavaScript(script).then(
        () => undefined,
        (err: unknown) => console.warn(`[teaching] ${label} script failed:`, err instanceof Error ? err.message : String(err)),
      );
    };
    const injectBranding = (rawUrl: string) => {
      if (ctx.wc.isDestroyed() || navOrigin(rawUrl) !== TEACHING_ORIGIN) return;
      if (ctx.attachScript) run('attach', ctx.attachScript);
      if (ctx.chromeScript) run('chrome', ctx.chromeScript);
      if (!ctx.brandScript) return;
      let brandable = false;
      try { brandable = deps.isBrandableTeachingUrl(rawUrl); } catch { return; }
      if (!brandable) return;
      run('brand', ctx.brandScript);
    };
    // Belt and braces: the load events can be missed or fire before the page is
    // ready, so re-apply (all scripts are idempotent) every 1.5 s for ~15 s after
    // each main-frame navigation. A state probe is logged once so a page that
    // still looks unskinned can be diagnosed from the dev console.
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    const startRetries = () => {
      if (retryTimer) clearInterval(retryTimer);
      let n = 0;
      retryTimer = setInterval(() => {
        n += 1;
        if (wc.isDestroyed() || n > 10) {
          if (retryTimer) clearInterval(retryTimer);
          retryTimer = null;
          return;
        }
        let url = '';
        try { url = wc.getURL(); } catch { return; }
        injectBranding(url);
        if (n === 3) {
          void wc.executeJavaScript(`(function(){return JSON.stringify({style:!!document.getElementById('__jargon_teaching_chrome'),header:!!document.querySelector('header'),modal:document.querySelectorAll('[aria-modal]').length,pw:document.querySelectorAll('input[type=password]').length,path:location.pathname,ta:(document.querySelector('textarea')||{}).value||''})})()`)
            .then((r: unknown) => console.log('[teaching] page state', url.slice(0, 60), r), () => undefined);
        }
      }, 1500);
    };
    // Keep the hosted page invisible from the start of a site navigation until
    // our branding has run (dom-ready), so the original logo/name never flashes.
    // A fallback timer guarantees the page is revealed even if injection fails.
    let hideKey: Promise<string> | null = null;
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const reveal = () => {
      if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
      const key = hideKey;
      hideKey = null;
      if (!key || wc.isDestroyed() || typeof wc.removeInsertedCSS !== 'function') return;
      void key.then((k) => wc.removeInsertedCSS(k)).catch(() => undefined);
    };
    wc.on('did-start-navigation', (_e, url, _inPlace, isMainFrame) => {
      if (isMainFrame && navOrigin(url) === TEACHING_ORIGIN) startRetries();
      if (!isMainFrame || navOrigin(url) !== TEACHING_ORIGIN || typeof wc.insertCSS !== 'function') return;
      reveal();
      hideKey = wc.insertCSS('html{visibility:hidden!important;background:#0b1020!important}');
      hideKey.catch(() => undefined);
      revealTimer = setTimeout(reveal, 6000);
    });
    wc.on('dom-ready', () => {
      let url = '';
      try { url = wc.getURL(); } catch { return; }
      if (navOrigin(url) !== TEACHING_ORIGIN) return;
      injectBranding(url);
      setTimeout(reveal, 900);
    });
    wc.on('did-finish-load', () => {
      let url = '';
      try { url = wc.getURL(); } catch { return; }
      injectBranding(url);
      setTimeout(reveal, 900);
    });
    wc.on('did-navigate-in-page', (_e, url) => {
      injectBranding(typeof url === 'string' && url ? url : (() => {
        try { return wc.getURL(); } catch { return ''; }
      })());
    });

    // A real main-frame load failure must never leave the window blank —
    // repaint the local error page (the data: URL cannot itself fail).
    wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
      if (errorCode === -3 || isMainFrame === false || ctx.wc.isDestroyed()) return;
      if (typeof validatedURL === 'string' && validatedURL.startsWith('data:')) return;
      console.warn('[teaching] load failed', errorCode, String(validatedURL).slice(0, 120));
      paintError(ctx, `The page could not be loaded (net error ${errorCode}).`);
    });
  }

  // ── the embedded panel (a view inside the main Jargon window) ───────────

  /** One panel per host window. */
  const panels = new Map<BrowserWindow, TeachingWindowCtx>();

  function closePanel(host: BrowserWindow): void {
    const ctx = panels.get(host);
    if (!ctx) return;
    panels.delete(host);
    windowsById.delete(ctx.id);
    windowsByWc.delete(ctx.wc);
    try { if (ctx.view && !host.isDestroyed()) host.contentView.removeChildView(ctx.view); } catch { /* already gone */ }
    try { if (!ctx.wc.isDestroyed()) ctx.wc.close(); } catch { /* already gone */ }
  }

  function openTeachingPanel(
    host: BrowserWindow,
    jobId: string,
    topic: string,
    attachments: readonly TeachingAttachment[],
    bounds: { x: number; y: number; width: number; height: number },
  ): TeachingWindowCtx {
    const ViewCtor = deps.WebContentsView!;
    const { dataUrl } = loadLogo();
    const scripts = buildScripts(topic, attachments, dataUrl);
    closePanel(host);
    const view = new ViewCtor({ webPreferences: { ...WEB_PREFS } });
    const ctx: TeachingWindowCtx = {
      id: jobId, win: null, dialogParent: host, view, wc: view.webContents,
      topic, attachments, logo: dataUrl, ...scripts,
    };
    view.setBounds(bounds);
    host.contentView.addChildView(view);
    panels.set(host, ctx);
    windowsById.set(jobId, ctx);
    windowsByWc.set(ctx.wc, ctx);
    host.once('closed', () => { panels.delete(host); windowsById.delete(jobId); windowsByWc.delete(ctx.wc); });
    wireContents(ctx);
    return ctx;
  }

  // ── handlers ────────────────────────────────────────────────────────────

  /** Manual hosted mode never has an access code — the shape stays stable for
   *  older renderers, which read only `hasAccessCode`. */
  function status(): { hasAccessCode: boolean; mode: 'manualHosted' } {
    return { hasAccessCode: false, mode: 'manualHosted' };
  }

  /** The legacy write-only code channel is disabled; the vault is untouched. */
  function setAccessCode(): Result {
    return { ok: false, error: 'Access codes are not used — Jargon opens the hosted teaching site for manual use.' };
  }

  function grantAttachment(evt: IpcMainInvokeEvent, payload: unknown): Result {
    if (!isTrustedSender(evt)) return { ok: false, error: 'untrusted sender' };
    const path = typeof payload === 'string' ? payload : '';
    if (!path || path.length > MAX_GRANT_PATH_CHARS || CONTROL_CHARS.test(path) || !isAbsolute(path)) {
      return { ok: false, error: 'invalid attachment path' };
    }
    grantPaths(evt.sender, [path]);
    return { ok: true };
  }

  type Validated =
    | { ok: true; teacherId: string; parsed: TeachingRequest }
    | { ok: false; error: string };

  /** Everything both entry points (window and embedded panel) must prove before
   *  anything opens: trusted sender, a real active teacher, and a well-formed
   *  request whose attachments this window has a live grant for. */
  function validateOpen(evt: IpcMainInvokeEvent, payload: unknown): Validated {
    if (!isTrustedSender(evt)) return { ok: false, error: 'untrusted sender' };
    const req = (payload ?? {}) as { topic?: unknown; attachments?: unknown; teacherId?: unknown };
    const teacherId = typeof req.teacherId === 'string' ? req.teacherId.trim() : '';
    if (!teacherId) return { ok: false, error: 'A teacher must be selected.' };
    // A non-string topic is a malformed payload — never coerce it into a
    // file-only request the sender did not describe.
    if (req.topic != null && typeof req.topic !== 'string') {
      return { ok: false, error: 'topic must be a string.' };
    }

    // Re-validate the shared contract in main — the renderer's payload is only
    // a claim until parseTeachingRequest accepts it.
    let parsed: TeachingRequest;
    try {
      const r = parseTeachingRequest(
        `@teach-me ${typeof req.topic === 'string' ? req.topic : ''}`,
        req.attachments == null ? [] : (req.attachments as TeachingAttachment[]),
      );
      // The alias prefix guarantees non-null; the check keeps the type honest.
      if (!r) return { ok: false, error: 'Not a teaching request.' };
      parsed = r;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // The teacher must be a registered ACTIVE worker per the main-process
    // registry — never renderer isGod flags, and never a literal-name match
    // (the Teacher's display name is user-customizable).
    const reg = deps.registry();
    const agent = Object.prototype.hasOwnProperty.call(reg.agents, teacherId)
      ? reg.agents[teacherId]
      : undefined;
    if (!agent || agent.archived || agent.isGod || agent.isAssistant || teacherId === reg.godId) {
      return { ok: false, error: 'The selected teacher is not an active registered worker.' };
    }

    // Every attachment must be covered by a live grant for THIS window — the
    // paths stay local (they only ever reach a native dialog on user click).
    const authorized = authorizedPaths(evt.sender);
    for (const att of parsed.attachments) {
      if (!authorized.has(normKey(att.path))) {
        return { ok: false, error: `Attachment is not authorized for this window: ${att.name}` };
      }
    }

    return { ok: true, teacherId, parsed };
  }

  async function open(evt: IpcMainInvokeEvent, payload: unknown): Promise<Result> {
    const v = validateOpen(evt, payload);
    if (!v.ok) return v;
    const { teacherId, parsed } = v;

    if (windowsById.size >= MAX_TEACHING_WINDOWS) {
      return { ok: false, error: 'Too many teaching windows are already open.' };
    }

    const notify = (status: 'opened' | 'failed') => {
      try { deps.notifyTeacher?.(teacherId, status); } catch { /* notify is best-effort */ }
    };

    const jobId = `teach-${now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const ctx = openTeachingWindow(jobId, parsed.topic, parsed.attachments);
    windowsById.set(jobId, ctx);
    windowsByWc.set(ctx.wc, ctx);

    // The open resolves only once the hosted root has actually loaded — on a
    // load failure the caller keeps its draft and the window shows a local
    // error page rather than going blank.
    try {
      await ctx.win!.loadURL(TEACHING_HOME_URL);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      paintError(ctx, msg);
      notify('failed');
      return { ok: false, error: msg };
    }
    notify('opened');
    return { ok: true, jobId };
  }

  // ── embedded panel IPC ──────────────────────────────────────────────────

  function clampBounds(raw: unknown): { x: number; y: number; width: number; height: number } | null {
    const b = (raw ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
    const x = n(b.x), y = n(b.y), width = n(b.width), height = n(b.height);
    if ([x, y, width, height].some(Number.isNaN)) return null;
    if (width < 0 || height < 0 || width > 10000 || height > 10000 || Math.abs(x) > 20000 || Math.abs(y) > 20000) return null;
    return { x, y, width, height };
  }

  function hostOf(evt: IpcMainInvokeEvent): BrowserWindow | null {
    const win = deps.BrowserWindow.fromWebContents(evt.sender);
    return win && !win.isDestroyed() && deps.allWindows.has(win) ? win : null;
  }

  async function openPanel(evt: IpcMainInvokeEvent, payload: unknown): Promise<Result> {
    if (!deps.WebContentsView) return { ok: false, error: 'Embedded teaching is not available in this build.' };
    const v = validateOpen(evt, payload);
    if (!v.ok) return v;
    const host = hostOf(evt);
    if (!host) return { ok: false, error: 'untrusted sender' };
    const bounds = clampBounds((payload as { bounds?: unknown } | null)?.bounds);
    if (!bounds) return { ok: false, error: 'invalid panel bounds' };
    if (windowsById.size >= MAX_TEACHING_WINDOWS && !panels.has(host)) {
      return { ok: false, error: 'Too many teaching windows are already open.' };
    }
    const jobId = `teach-${now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const ctx = openTeachingPanel(host, jobId, v.parsed.topic, v.parsed.attachments, bounds);
    const notify = (status: 'opened' | 'failed') => {
      try { deps.notifyTeacher?.(v.teacherId, status); } catch { /* best-effort */ }
    };
    try {
      await ctx.wc.loadURL(TEACHING_HOME_URL);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      paintError(ctx, msg);
      notify('failed');
      return { ok: false, error: msg };
    }
    notify('opened');
    return { ok: true, jobId };
  }

  return {
    registerIpc() {
      deps.ipcMain.handle('teaching:openPanel', (evt, payload) => openPanel(evt, payload));
      deps.ipcMain.handle('teaching:panelBounds', (evt, raw) => {
        if (!isTrustedSender(evt)) return { ok: false as const };
        const host = hostOf(evt);
        const ctx = host ? panels.get(host) : undefined;
        const b = clampBounds(raw);
        if (!ctx?.view || !b) return { ok: false as const };
        ctx.view.setBounds(b);
        return { ok: true as const };
      });
      deps.ipcMain.handle('teaching:panelVisible', (evt, visible: unknown) => {
        if (!isTrustedSender(evt)) return { ok: false as const };
        const host = hostOf(evt);
        const ctx = host ? panels.get(host) : undefined;
        if (!ctx?.view) return { ok: false as const };
        ctx.view.setVisible(visible === true);
        return { ok: true as const };
      });
      deps.ipcMain.handle('teaching:panelClose', (evt) => {
        if (!isTrustedSender(evt)) return { ok: false as const };
        const host = hostOf(evt);
        if (host) closePanel(host);
        return { ok: true as const };
      });
      deps.ipcMain.handle('teaching:status', async (evt) =>
        isTrustedSender(evt) ? status() : { hasAccessCode: false, mode: 'manualHosted' as const });
      deps.ipcMain.handle('teaching:setAccessCode', async (evt) => {
        if (!isTrustedSender(evt)) return { ok: false as const, error: 'untrusted sender' };
        return setAccessCode();
      });
      deps.ipcMain.handle('teaching:open', (evt, payload) => open(evt, payload));
      deps.ipcMain.handle('teaching:grantAttachment', async (evt, payload) => grantAttachment(evt, payload));
    },
    grantPaths,
    authorizedPaths,
  };
}
