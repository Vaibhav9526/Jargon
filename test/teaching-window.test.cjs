'use strict';

// Unit coverage for src/main/teaching.ts — the manual hosted-workspace
// control plane. Electron and the branding module are injected fakes; the
// legacy hosted API, secret store and material reader are passed as POISONED
// spies so any regression that reaches for them trips the assertions below.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const loadTs = require('./load-ts.cjs');

const {
  createTeachingService,
  TEACHING_HOME_URL,
  TEACHING_GRANT_TTL_MS,
} = loadTs('src/main/teaching.ts');

const DEV_URL = 'http://localhost:5173';
const RENDERER_ENTRY = path.resolve(__dirname, '..', 'out', 'renderer', 'index.html');
const BRAND_SCRIPT = '/* fixed branding script */';
const LOGO_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'teach-logo-')), 'logo.png');
fs.writeFileSync(LOGO_FILE, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));

const flush = () => new Promise((r) => setImmediate(r));
async function settle(n = 8) { for (let i = 0; i < n; i++) await flush(); }

// ─── fakes ──────────────────────────────────────────────────────────────────

function makeEmitter() {
  const map = new Map();
  return {
    on(ev, fn) { (map.get(ev) ?? map.set(ev, []).get(ev)).push(fn); },
    once(ev, fn) { this.on(ev, fn); },
    emit(ev, ...args) { for (const fn of map.get(ev) ?? []) fn(...args); },
  };
}

// Sessions are keyed by partition, matching Electron semantics: every window
// on 'persist:jargon-teaching' shares ONE session object.
const sessionRegistry = new Map();
function sessionFor(win) {
  const partition = win && win.opts && win.opts.webPreferences && win.opts.webPreferences.partition;
  if (!partition) return null;
  if (!sessionRegistry.has(partition)) {
    sessionRegistry.set(partition, {
      requests: 0,
      checks: 0,
      setPermissionRequestHandler(fn) { this.handler = fn; this.requests += 1; },
      setPermissionCheckHandler(fn) { this.checkHandler = fn; this.checks += 1; },
    });
  }
  return sessionRegistry.get(partition);
}

class FakeWebContents {
  constructor(win, url) {
    this.__win = win;
    this.url = url;
    this.mainFrame = { url, top: null };
    this.mainFrame.top = this.mainFrame;
    this.destroyed = false;
    this.openHandler = null;
    this.executed = [];
    this.reloads = 0;
    this._em = makeEmitter();
    this.session = sessionFor(win) ?? {
      setPermissionRequestHandler(fn) { this.handler = fn; },
      setPermissionCheckHandler(fn) { this.checkHandler = fn; },
    };
  }
  on(ev, fn) { this._em.on(ev, fn); }
  once(ev, fn) { this._em.on(ev, fn); }
  emit(ev, ...a) { this._em.emit(ev, ...a); }
  isDestroyed() { return this.destroyed; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('destroyed'); } }
  setWindowOpenHandler(fn) { this.openHandler = fn; }
  getURL() { return this.url; }
  reload() { this.reloads += 1; }
  executeJavaScript(script) { this.executed.push(script); return Promise.resolve(0); }
}

class FakeWindow {
  static instances = [];
  constructor(opts = {}) {
    this.opts = opts;
    this.loaded = [];
    this.destroyed = false;
    this.shown = false;
    this.menu = null;
    this._em = makeEmitter();
    this.webContents = new FakeWebContents(this, '');
    FakeWindow.instances.push(this);
  }
  static fromWebContents(wc) { return wc && wc.__win; }
  on(ev, fn) { this._em.on(ev, fn); }
  once(ev, fn) { this._em.on(ev, fn); }
  emit(ev, ...a) { this._em.emit(ev, ...a); }
  isDestroyed() { return this.destroyed; }
  show() { this.shown = true; }
  setMenu(menu) { this.menu = menu; }
  async loadURL(u) {
    // failHttpDefault is armed BEFORE invoke() — open() reaches loadURL
    // synchronously, so a per-instance flag set afterwards would be too late.
    if ((this.failHttp || FakeWindow.failHttpDefault) && u.startsWith('http')) throw new Error('net::ERR_FAILED');
    this.loaded.push(u);
    this.webContents.url = u;
    this.webContents.mainFrame.url = u;
  }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.destroy();
    this.emit('closed');
  }
}

/** Walk a built menu template and click an item by label. */
function menuItem(menu, label) {
  const stack = [...(menu && menu.template ? menu.template : [])];
  while (stack.length) {
    const item = stack.shift();
    if (item.label === label) return item;
    if (item.submenu) stack.push(...item.submenu);
  }
  return undefined;
}

/** Build a service + harness. `opts.dev` toggles dev-origin vs packaged mode. */
function makeHarness(opts = {}) {
  sessionRegistry.clear(); // a fresh session universe per harness
  const allWindows = new Set();
  const ipcHandlers = new Map();
  const box = {
    asks: [],
    openedExternally: [],
    written: [],
    notes: [],
    scriptsFor: [],
    brandChecks: [],
    now: 1_000_000,
    // Legacy surfaces that must NEVER be touched in manual mode.
    secretCalls: 0,
    apiCalls: 0,
    materialReads: 0,
    urlChecks: 0,
    registry: opts.registry ?? {
      godId: 'god',
      agents: {
        god: { name: 'Michael', isGod: true },
        helper: { name: 'Prep', isAssistant: true },
        oldteach: { name: 'Teacher', archived: true },
        teacher: { name: 'Ms. Ada Lovelace' },
      },
    },
  };
  const legacyTrap = {
    getSecret: () => { box.secretCalls += 1; return 'sk-trapped'; },
    hasSecret: () => { box.secretCalls += 1; return true; },
    setSecret: () => { box.secretCalls += 1; return { ok: true }; },
    createClassroom: async () => { box.apiCalls += 1; return { jobId: 'x', url: TEACHING_HOME_URL }; },
    readMaterials: async () => { box.materialReads += 1; return []; },
    validateClassroomUrl: (u) => { box.urlChecks += 1; return u; },
  };
  const service = createTeachingService({
    ipcMain: { handle: (ch, fn) => ipcHandlers.set(ch, fn) },
    BrowserWindow: FakeWindow,
    nativeImage: {
      createFromBuffer: () => ({ isEmpty: () => false }),
    },
    dialog: {
      showMessageBox: async (w, o) => {
        box.asks.push({ win: w, opts: o });
        return { response: opts.allowAudio === false ? 1 : 0 };
      },
    },
    shell: { openExternal: async (u) => { box.openedExternally.push(u); } },
    clipboard: { writeText: (t) => { box.written.push(t); } },
    Menu: { buildFromTemplate: (template) => ({ template }) },
    allWindows,
    devRendererUrl: () => (opts.dev === false ? null : DEV_URL),
    rendererEntryFile: () => RENDERER_ENTRY,
    registry: () => box.registry,
    createBrandingScript: (logoDataUrl) => { box.scriptsFor.push(logoDataUrl); return BRAND_SCRIPT; },
    isBrandableTeachingUrl: (u) => {
      box.brandChecks.push(u);
      return (opts.brandable ?? ((url) =>
        url === TEACHING_HOME_URL || /^https:\/\/open\.maic\.chat\/classroom\/[\w-]+$/.test(url)))(u);
    },
    logoFile: opts.noLogo ? () => path.join(os.tmpdir(), 'no-such-logo.png') : () => LOGO_FILE,
    notifyTeacher: (id, status) => box.notes.push([id, status]),
    now: () => box.now,
    // Trapped legacy deps: present but must stay completely unused.
    ...legacyTrap,
  });
  service.registerIpc();
  const invoke = (ch, evt, ...args) => ipcHandlers.get(ch)(evt, ...args);

  /** A trusted Jargon window (in allWindows) + a matching invoke event. */
  function senderWindow(url = opts.dev === false ? pathToFileURL(RENDERER_ENTRY).href : `${DEV_URL}/`) {
    const win = new FakeWindow();
    win.webContents.url = url;
    win.webContents.mainFrame.url = url;
    allWindows.add(win);
    return win;
  }
  const evtOf = (win, frame = win.webContents.mainFrame) => ({ sender: win.webContents, senderFrame: frame });

  return { box, allWindows, invoke, service, senderWindow, evtOf };
}

const okRequest = { topic: 'Explain gravity', attachments: [], teacherId: 'teacher' };

// ─── sender guard ───────────────────────────────────────────────────────────

test('every teaching channel rejects a sender outside allWindows', async () => {
  const { invoke } = makeHarness();
  const stranger = new FakeWindow(); // created but NOT added to allWindows
  const evt = { sender: stranger.webContents, senderFrame: stranger.webContents.mainFrame };
  assert.deepEqual(await invoke('teaching:status', evt), { hasAccessCode: false, mode: 'manualHosted' });
  assert.equal((await invoke('teaching:setAccessCode', evt, 'sk-abcdefgh')).ok, false);
  assert.equal((await invoke('teaching:grantAttachment', evt, 'D:\\a.pdf')).ok, false);
  assert.equal((await invoke('teaching:open', evt, okRequest)).ok, false);
});

test('a sub-frame sender is rejected even inside a trusted window', async () => {
  const { invoke, senderWindow } = makeHarness();
  const win = senderWindow();
  const iframe = { url: `${DEV_URL}/`, top: win.webContents.mainFrame };
  const res = await invoke('teaching:open', { sender: win.webContents, senderFrame: iframe }, okRequest);
  assert.equal(res.ok, false);
});

test('dev origin must match exactly; packaged mode requires the renderer file URL', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  for (const url of ['https://localhost:5173/', 'http://localhost:5174/', 'https://evil.test/', 'file:///C:/app/out/renderer/index.html']) {
    const res = await invoke('teaching:open', evtOf(senderWindow(url)), { ...okRequest });
    assert.equal(res.ok, false, url);
  }
  const good = await invoke('teaching:open', evtOf(senderWindow(`${DEV_URL}/compose?x=1`)), { ...okRequest });
  assert.equal(good.ok, true);

  const packaged = makeHarness({ dev: false });
  const fileWin = packaged.senderWindow(pathToFileURL(RENDERER_ENTRY).href);
  assert.equal((await packaged.invoke('teaching:open', packaged.evtOf(fileWin), { ...okRequest })).ok, true);
  const httpsWin = packaged.senderWindow(`${DEV_URL}/`);
  assert.equal((await packaged.invoke('teaching:open', packaged.evtOf(httpsWin), { ...okRequest })).ok, false);
});

// ─── legacy access-code surface is disabled ─────────────────────────────────

test('status reports manualHosted and never reads the vault', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  const evt = evtOf(senderWindow());
  assert.deepEqual(await invoke('teaching:status', evt), { hasAccessCode: false, mode: 'manualHosted' });
  assert.equal(box.secretCalls, 0);
});

test('setAccessCode is disabled and never mutates the vault', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  const evt = evtOf(senderWindow());
  for (const code of ['sk-live-abc123', 'anything', 42, null, undefined]) {
    const res = await invoke('teaching:setAccessCode', evt, code);
    assert.equal(res.ok, false, JSON.stringify(code));
  }
  assert.equal(box.secretCalls, 0); // trapped setSecret/hasSecret/getSecret all silent
  assert.deepEqual(await invoke('teaching:status', evt), { hasAccessCode: false, mode: 'manualHosted' });
});

// ─── attachment grants ──────────────────────────────────────────────────────

test('grantAttachment grants only absolute bounded paths; open enforces grants', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  const win = senderWindow();
  const evt = evtOf(win);
  const pdf = path.resolve('D:\\docs\\lesson.pdf');

  assert.equal((await invoke('teaching:grantAttachment', evt, pdf)).ok, true);
  assert.equal((await invoke('teaching:grantAttachment', evt, 'relative\\lesson.pdf')).ok, false);
  assert.equal((await invoke('teaching:grantAttachment', evt, 42)).ok, false);
  assert.equal((await invoke('teaching:grantAttachment', evt, `D:\\${'x'.repeat(5000)}.pdf`)).ok, false);

  const ok = await invoke('teaching:open', evt, { ...okRequest, attachments: [{ path: pdf, name: 'lesson.pdf' }] });
  assert.equal(ok.ok, true);
  assert.ok(ok.jobId);

  const sneak = path.resolve('D:\\docs\\never-picked.pdf');
  const denied = await invoke('teaching:open', evt, { ...okRequest, attachments: [{ path: sneak, name: 'never-picked.pdf' }] });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /not authorized/);
});

test('grants expire after the TTL and die with their owner window', async () => {
  const { invoke, senderWindow, evtOf, box, service } = makeHarness();
  const win = senderWindow();
  const evt = evtOf(win);
  const pdf = path.resolve('D:\\docs\\soon-stale.pdf');
  await invoke('teaching:grantAttachment', evt, pdf);

  box.now += TEACHING_GRANT_TTL_MS + 1;
  assert.equal(service.authorizedPaths(win.webContents).size, 0);
  assert.equal((await invoke('teaching:open', evt, { ...okRequest, attachments: [{ path: pdf, name: 'soon-stale.pdf' }] })).ok, false);

  box.now -= TEACHING_GRANT_TTL_MS + 1;
  const win2 = senderWindow();
  await invoke('teaching:grantAttachment', evtOf(win2), pdf);
  win2.webContents.destroy();
  assert.equal(service.authorizedPaths(win2.webContents).size, 0);
});

// ─── teacher vetting ────────────────────────────────────────────────────────

test('open requires a registered ACTIVE worker — not god, assistant or archived', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  const evt = evtOf(senderWindow());
  for (const teacherId of ['ghost', 'oldteach', 'god', 'helper', '', 42]) {
    const res = await invoke('teaching:open', evt, { ...okRequest, teacherId });
    assert.equal(res.ok, false, JSON.stringify(teacherId));
  }
  // Custom display name is fine — validation is registry membership, not literal 'Teacher'.
  assert.equal((await invoke('teaching:open', evt, okRequest)).ok, true);
});

test('a non-string topic is rejected instead of coerced to file-only', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  const evt = evtOf(senderWindow());
  for (const topic of [42, { bad: true }, ['x']]) {
    const res = await invoke('teaching:open', evt, { ...okRequest, topic });
    assert.equal(res.ok, false);
    assert.match(res.error, /topic must be a string/);
  }
  assert.equal((await invoke('teaching:open', evt, { ...okRequest, topic: 'Real topic' })).ok, true);
});

// ─── zero legacy API / secret / file-content reads ──────────────────────────

test('open needs no access code and touches no legacy transport, secret or file reader', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  const win = senderWindow();
  const evt = evtOf(win);
  const pdf = path.resolve('D:\\docs\\untouched.pdf');
  await invoke('teaching:grantAttachment', evt, pdf);

  const res = await invoke('teaching:open', evt, {
    ...okRequest,
    attachments: [{ path: pdf, name: 'untouched.pdf' }],
  });
  assert.equal(res.ok, true);
  await settle();

  assert.equal(box.secretCalls, 0);   // no hasSecret/getSecret/setSecret
  assert.equal(box.apiCalls, 0);      // no hosted classroom API
  assert.equal(box.materialReads, 0); // no file content ever read
  assert.equal(box.urlChecks, 0);     // no classroom URL validation
});

// ─── window shape ───────────────────────────────────────────────────────────

test('open creates a hardened Jargon window — no preload, sandboxed, outside allWindows', async () => {
  const { invoke, senderWindow, evtOf, allWindows } = makeHarness();
  const res = await invoke('teaching:open', evtOf(senderWindow()), okRequest);
  assert.equal(res.ok, true);
  assert.ok(/^teach-/.test(res.jobId));
  await settle();

  const win = FakeWindow.instances.at(-1);
  assert.equal(allWindows.has(win), false);
  assert.equal(win.opts.title, 'Jargon Teaching');
  assert.ok(win.opts.icon); // bundled Jargon mark
  const wp = win.opts.webPreferences;
  assert.equal(wp.nodeIntegration, false);
  assert.equal(wp.sandbox, true);
  assert.equal(wp.contextIsolation, true);
  assert.equal(wp.webSecurity, true);
  assert.equal('preload' in wp, false);
});

test('the window loads the hosted root directly — nothing else, no progress page', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  await invoke('teaching:open', evtOf(senderWindow()), { ...okRequest, topic: 'Explain <b>gravity</b>' });
  await settle();
  const win = FakeWindow.instances.at(-1);
  assert.deepEqual(win.loaded, ['https://open.maic.chat/']);
});

test('teaching windows share one persistent session partition (sign-in survives)', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  const evt = evtOf(senderWindow());
  await invoke('teaching:open', evt, okRequest);
  await invoke('teaching:open', evt, okRequest);
  const [a, b] = FakeWindow.instances.slice(-2);
  assert.equal(a.opts.webPreferences.partition, 'persist:jargon-teaching-manual');
  assert.equal(a.opts.webPreferences.partition, b.opts.webPreferences.partition);
  assert.equal(a.webContents.session, b.webContents.session); // same Session object
  // …and the shared session's permission dispatcher was armed exactly once.
  assert.equal(a.webContents.session.requests, 1);
  assert.equal(a.webContents.session.checks, 1);
});

// ─── Lesson menu ────────────────────────────────────────────────────────────

test('the Lesson menu is small, native, and every action is user-driven', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  const win = senderWindow();
  const evt = evtOf(win);
  const pdf = path.resolve('D:\\docs\\lesson.pdf');
  await invoke('teaching:grantAttachment', evt, pdf);
  await invoke('teaching:open', evt, { ...okRequest, attachments: [{ path: pdf, name: 'lesson.pdf' }] });
  await settle();

  const teachWin = FakeWindow.instances.at(-1);
  assert.ok(teachWin.menu);
  const labels = [];
  const stack = [...teachWin.menu.template];
  while (stack.length) { const i = stack.shift(); if (i.label) labels.push(i.label); if (i.submenu) stack.push(...i.submenu); }
  assert.deepEqual(labels, ['Lesson', 'Copy Lesson Topic', 'Show Materials', 'Reload', 'Provider Details']);

  // Nothing happens without a click.
  assert.equal(box.written.length, 0);
  assert.equal(box.asks.length, 0);

  menuItem(teachWin.menu, 'Copy Lesson Topic').click();
  assert.deepEqual(box.written, ['Explain gravity']); // clipboard write is a user action

  menuItem(teachWin.menu, 'Show Materials').click();
  await flush();
  const materials = box.asks.at(-1);
  assert.equal(materials.opts.title, 'Lesson Materials');
  assert.ok(materials.opts.detail.includes('lesson.pdf')); // the picked name
  assert.ok(materials.opts.detail.includes(pdf));            // and its local path

  assert.equal(teachWin.webContents.reloads, 0);
  menuItem(teachWin.menu, 'Reload').click();
  assert.equal(teachWin.webContents.reloads, 1);

  menuItem(teachWin.menu, 'Provider Details').click();
  await flush();
  const provider = box.asks.at(-1);
  assert.equal(provider.opts.message, 'OpenMAIC');
  assert.match(provider.opts.detail, /open\.maic\.chat/);
});

test('Copy Lesson Topic is disabled for a materials-only request', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  const evt = evtOf(senderWindow());
  const pdf = path.resolve('D:\\docs\\only.pdf');
  await invoke('teaching:grantAttachment', evt, pdf);
  await invoke('teaching:open', evt, { topic: '', attachments: [{ path: pdf, name: 'only.pdf' }], teacherId: 'teacher' });
  await settle();
  const item = menuItem(FakeWindow.instances.at(-1).menu, 'Copy Lesson Topic');
  assert.equal(item.enabled, false);
});

// ─── navigation + popup policy ──────────────────────────────────────────────

test('in-window navigation is limited to the service origin; popups go to the OS', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  await invoke('teaching:open', evtOf(senderWindow()), okRequest);
  await settle();
  const wc = FakeWindow.instances.at(-1).webContents;

  const prevented = (url) => {
    let hit = false;
    wc.emit('will-navigate', { preventDefault: () => { hit = true; } }, url);
    return hit;
  };
  const verifiedSignin = 'https://maic.chat/signin?domain=live-ack-prod.cogevol.com&from=https%3A%2F%2Fopen.maic.chat%2F';
  for (const ok of ['https://open.maic.chat/', 'https://open.maic.chat/classroom/x', 'https://open.maic.chat/login', verifiedSignin, 'https://maic.chat/signin']) {
    assert.equal(prevented(ok), false, ok);
  }
  for (const bad of [
    'https://evil.test/',
    'http://open.maic.chat/classroom/x',
    'https://user:pw@open.maic.chat/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://maic.chat/',                     // only /signin is verified
    'https://maic.chat/signup',
    'https://maic.chat/signin/extra',
    'https://maic.chat:8443/signin',          // odd port
    'https://user:pw@maic.chat/signin',
    'http://maic.chat/signin',
    'https://live-ack-prod.cogevol.com/',     // a query param never whitelists a host
    'https://notmaic.chat/signin',
  ]) {
    assert.equal(prevented(bad), true, bad);
  }
  const redirected = (url) => {
    let hit = false;
    wc.emit('will-redirect', { preventDefault: () => { hit = true; } }, url);
    return hit;
  };
  assert.equal(redirected('https://open.maic.chat/next'), false);
  assert.equal(redirected('https://evil.test/'), true);

  assert.deepEqual(wc.openHandler({ url: 'https://example.com/doc' }), { action: 'deny' });
  assert.deepEqual(box.openedExternally, ['https://example.com/doc']);
  assert.deepEqual(wc.openHandler({ url: 'file:///etc/passwd' }), { action: 'deny' });
  assert.deepEqual(wc.openHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.equal(box.openedExternally.length, 1);
});

// ─── permission dispatcher (wc-owned on the shared session) ─────────────────

test('permissions deny by default; audio-only main-frame on-origin prompts its OWN window', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  const evt = evtOf(senderWindow());
  await invoke('teaching:open', evt, okRequest);
  await invoke('teaching:open', evt, okRequest);
  await settle();
  const [winA, winB] = FakeWindow.instances.slice(-2);
  const session = winA.webContents.session;
  const handler = session.handler;
  assert.equal(session.checkHandler(null, 'media'), false);

  const okDetails = { mediaTypes: ['audio'], isMainFrame: true, requestingUrl: 'https://open.maic.chat/classroom/x' };
  const ask = (perm, details, who) => new Promise((res) => handler(who, perm, res, details));

  // winB's request prompts on winB — never on winA (the wrong-window bug).
  assert.equal(await ask('media', okDetails, winB.webContents), true);
  assert.equal(box.asks.length, 1);
  assert.equal(box.asks[0].win, winB);

  assert.equal(await ask('media', { ...okDetails, isMainFrame: false }, winA.webContents), false);
  assert.equal(await ask('media', { ...okDetails, requestingUrl: 'https://evil.test/' }, winA.webContents), false);
  assert.equal(await ask('media', { ...okDetails, requestingUrl: 'https://maic.chat/signin?from=x' }, winA.webContents), false); // auth page gets no mic
  assert.equal(await ask('media', { ...okDetails, requestingUrl: 'about:blank' }, winA.webContents), false);
  assert.equal(await ask('media', okDetails, new FakeWebContents(null, 'https://open.maic.chat/')), false); // foreign wc
  assert.equal(await ask('media', { ...okDetails, mediaTypes: ['audio', 'video'] }, winA.webContents), false);
  assert.equal(await ask('media', { ...okDetails, mediaTypes: ['video'] }, winA.webContents), false);
  assert.equal(await ask('geolocation', okDetails, winA.webContents), false);
  assert.equal(await ask('midiSysex', okDetails, winA.webContents), false);
  assert.equal(box.asks.length, 1); // only the legitimate audio ask prompted
});

test('a closed window can no longer prompt', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  await invoke('teaching:open', evtOf(senderWindow()), okRequest);
  await settle();
  const win = FakeWindow.instances.at(-1);
  const wc = win.webContents;
  const handler = wc.session.handler;
  const okDetails = { mediaTypes: ['audio'], isMainFrame: true, requestingUrl: 'https://open.maic.chat/' };
  win.close();
  const res = await new Promise((r) => handler(wc, 'media', r, okDetails));
  assert.equal(res, false);
  assert.equal(box.asks.length, 0);
});

// ─── branding injection guard ───────────────────────────────────────────────

test('the fixed branding script injects only on verified brandable service URLs', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  await invoke('teaching:open', evtOf(senderWindow()), okRequest);
  await settle();
  const wc = FakeWindow.instances.at(-1).webContents;

  // Script built once, from OUR logo data URL only — never page/user input.
  assert.equal(box.scriptsFor.length, 1);
  assert.match(box.scriptsFor[0], /^data:image\/png;base64,/);

  wc.url = 'https://open.maic.chat/';
  wc.emit('did-finish-load');
  assert.deepEqual(wc.executed, [BRAND_SCRIPT]);

  wc.emit('did-navigate-in-page', {}, 'https://open.maic.chat/classroom/AbC123');
  assert.deepEqual(wc.executed, [BRAND_SCRIPT, BRAND_SCRIPT]); // fixed script, identical each time

  wc.emit('did-finish-load'); // still root — allowed
  wc.emit('did-navigate-in-page', {}, 'https://open.maic.chat/login'); // not brandable
  assert.equal(wc.executed.length, 3);
  assert.equal(box.brandChecks.includes('https://open.maic.chat/login'), true); // predicate consulted, declined
});

test('branding is never injected off-origin even if the predicate says yes', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness({ brandable: () => true });
  await invoke('teaching:open', evtOf(senderWindow()), okRequest);
  await settle();
  const wc = FakeWindow.instances.at(-1).webContents;
  wc.emit('did-navigate-in-page', {}, 'https://evil.test/classroom/x');
  // Navigable but never branded: the verified auth hop keeps its real identity.
  wc.emit('did-navigate-in-page', {}, 'https://maic.chat/signin?domain=live-ack-prod.cogevol.com&from=https%3A%2F%2Fopen.maic.chat%2F');
  wc.url = 'https://evil.test/';
  wc.emit('did-finish-load');
  assert.equal(wc.executed.length, 0); // origin gate beats a buggy predicate
});

test('no bundled mark means no branding at all — window still opens', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness({ noLogo: true });
  const res = await invoke('teaching:open', evtOf(senderWindow()), okRequest);
  assert.equal(res.ok, true);
  await settle();
  const win = FakeWindow.instances.at(-1);
  assert.equal('icon' in win.opts, false);
  win.webContents.url = 'https://open.maic.chat/';
  win.webContents.emit('did-finish-load');
  assert.equal(box.scriptsFor.length, 0);
  assert.equal(win.webContents.executed.length, 0);
});

// ─── load failure handling ──────────────────────────────────────────────────

test('a failed root load returns failed (draft preserved) and paints the error page', async () => {
  const { invoke, senderWindow, evtOf, box } = makeHarness();
  const evt = evtOf(senderWindow());
  FakeWindow.failHttpDefault = true; // armed before invoke — loadURL is reached synchronously
  let res;
  try {
    res = await invoke('teaching:open', evt, okRequest);
  } finally {
    FakeWindow.failHttpDefault = false;
  }
  assert.equal(res.ok, false);
  assert.match(res.error, /ERR_FAILED/);
  await settle();

  const win = FakeWindow.instances.at(-1);
  assert.ok(win.loaded.length === 1 && win.loaded[0].startsWith('data:text/html;base64,'));
  const last = Buffer.from(win.loaded[0].replace('data:text/html;base64,', ''), 'base64').toString('utf8');
  assert.match(last, /Could not open the lesson/);
  assert.match(last, /net::ERR_FAILED/);
  assert.match(last, /Explain gravity/); // topic echoed back escaped, not blank
  assert.deepEqual(box.notes, [['teacher', 'failed']]);
});

test('a late did-fail-load repaints the error page instead of going blank', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  await invoke('teaching:open', evtOf(senderWindow()), okRequest);
  await settle();
  const win = FakeWindow.instances.at(-1);
  const wc = win.webContents;
  assert.deepEqual(win.loaded, ['https://open.maic.chat/']);

  wc.emit('did-fail-load', {}, -3, 'aborted', 'https://open.maic.chat/', true);   // our own nav — ignored
  wc.emit('did-fail-load', {}, -6, 'gone', 'https://open.maic.chat/', false);      // subframe — ignored
  assert.equal(win.loaded.length, 1);

  wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://open.maic.chat/', true);
  await settle();
  const last = win.loaded.at(-1);
  assert.ok(last.startsWith('data:text/html;base64,'));
  assert.match(Buffer.from(last.replace('data:text/html;base64,', ''), 'base64').toString('utf8'), /Could not open the lesson/);
});

// ─── teacher notify + window cap ────────────────────────────────────────────

test('the teacher gets a fixed, content-free note — opened or failed, never a classroom', async () => {
  const okH = makeHarness();
  await okH.invoke('teaching:open', okH.evtOf(okH.senderWindow()), okRequest);
  await settle();
  assert.deepEqual(okH.box.notes, [['teacher', 'opened']]);

  const badH = makeHarness();
  FakeWindow.failHttpDefault = true;
  try {
    await badH.invoke('teaching:open', badH.evtOf(badH.senderWindow()), okRequest);
  } finally {
    FakeWindow.failHttpDefault = false;
  }
  await settle();
  assert.deepEqual(badH.box.notes, [['teacher', 'failed']]);
});

test('no more than four teaching windows may be open at once', async () => {
  const { invoke, senderWindow, evtOf } = makeHarness();
  const evt = evtOf(senderWindow());
  for (let i = 0; i < 4; i++) assert.equal((await invoke('teaching:open', evt, okRequest)).ok, true);
  const fifth = await invoke('teaching:open', evt, okRequest);
  assert.equal(fifth.ok, false);
  assert.match(fifth.error, /Too many/);
  // Closing one frees the slot.
  FakeWindow.instances.at(-1).close();
  assert.equal((await invoke('teaching:open', evt, okRequest)).ok, true);
});
