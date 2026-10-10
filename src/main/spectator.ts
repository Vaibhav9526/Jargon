/**
 * SpectatorServer — a read-only "spectator mode" HTTP surface that lets anyone on the
 * same LAN watch the office floor live from a phone (the in-app QR code points at it).
 * Hackathon judges are the audience: it must feel alive, so the page polls a compact
 * JSON snapshot and renders a schematic floor, not a raw dump.
 *
 * SECURITY MODEL — a LAN surface, deliberately tiny and deliberately strict:
 *   - AUTH = THE TOKEN IN THE URL PATH. No login, no cookie, no header. The
 *     unguessable token (crypto.randomBytes, 128-bit, minted per server start) is the
 *     ONLY thing between the floor and the network. A request whose first path segment
 *     is not that token is answered EXACTLY like a request to a path that does not
 *     exist — identical 404, identical body — and the token compare still runs against
 *     a per-process decoy so "wrong token" costs the same as "wrong path" and can't be
 *     walked to discover the live one.
 *   - GET ONLY. No write endpoint of any kind — no POST/PUT/DELETE handler exists, so a
 *     non-GET request to any path (even the correct token) is a uniform 404. A
 *     spectator can never mutate the floor; the worst they can do is read.
 *   - RATE LIMIT. A fixed-window limiter bounds total requests before any parsing or
 *     crypto runs, so a flood is rejected cheaply (429) rather than allowed to spin.
 *   - The snapshot the page reads is pushed IN over IPC by the renderer and only CACHED
 *     here (setSnapshot); this module never reaches the hive, the filesystem, or
 *     Electron. It owns transport, the token gate, rate limiting, and the page.
 *
 * Runs in the Electron main process but is deliberately free of any `electron` import
 * so it can be unit-/smoke-tested as a plain Node module (test/spectator-view.test.cjs).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** One agent as shown on the schematic floor. Compact on purpose — the page polls
 *  this every ~1.5s over wifi, so every field earns its bytes. */
export interface SpectatorAgent {
  id: string;
  displayName: string;
  /** CLI engine the agent runs on (claude / codex / …); may be empty. */
  provider: string;
  /** Live status kind (idle / working / thinking / blocked / …). */
  status: string;
  /** Schematic seat/zone label the chip is grouped under. */
  seatLabel: string;
  /** Current task / prompt headline, already length-capped by the pusher. */
  currentTaskTitle: string;
}

/** The whole floor snapshot the page renders. Pushed from the renderer ~1/s. */
export interface SpectatorSnapshot {
  /** Floor/theme name (e.g. 'office' / 'staffroom'). */
  floor: string;
  /** Human label for the floor, if the pusher resolved one. */
  floorLabel?: string;
  /** Orchestrator (god) status: 'booting' | 'ready' | 'failed'. */
  godStatus: string;
  agents: SpectatorAgent[];
  tasks: { queued: number; active: number; done: number };
  /** epoch ms the renderer built this snapshot (for the "updated Ns ago" pulse). */
  updatedAt: number;
}

export interface SpectatorServerOptions {
  /** Local TCP port to bind. 0 = let the OS pick a free one. */
  port?: number;
  /** Requests allowed per fixed window, globally. Defaults to SPECTATOR_RATE_LIMIT. */
  rateLimit?: number;
  /** Fixed-window length in ms. Defaults to SPECTATOR_RATE_WINDOW_MS. */
  rateWindowMs?: number;
  /** Override the served page (tests / theming). Defaults to the built-in page. */
  page?: string;
}

/** Basic abuse guard: at most this many requests per fixed window, globally. A live
 *  viewer polling /state every 1.5s is ~40/min; the cap leaves generous headroom for
 *  a room of phones while still turning a flood into cheap 429s. */
export const SPECTATOR_RATE_LIMIT = 300;
export const SPECTATOR_RATE_WINDOW_MS = 60_000;
/** Default port. The task's suggested 47870; the server falls back to a free port if
 *  this one is taken, and always reports the port it actually bound. */
export const SPECTATOR_DEFAULT_PORT = 47870;

/** An empty-but-valid snapshot, served until the renderer pushes the first real one,
 *  so the page never has to special-case "no data yet". */
function emptySnapshot(): SpectatorSnapshot {
  return { floor: 'office', godStatus: 'booting', agents: [], tasks: { queued: 0, active: 0, done: 0 }, updatedAt: 0 };
}


/** Clamp + shape an untrusted snapshot arriving over IPC. The renderer is trusted,
 *  but the served JSON is public to anyone holding the token, so we bound every
 *  string and array here rather than echoing whatever crossed the bridge. */
export function sanitizeSpectatorSnapshot(input: unknown): SpectatorSnapshot {
  const out = emptySnapshot();
  if (!input || typeof input !== 'object') return out;
  const o = input as Record<string, unknown>;
  if (typeof o.floor === 'string' && o.floor) out.floor = o.floor.slice(0, 40);
  if (typeof o.floorLabel === 'string') out.floorLabel = o.floorLabel.slice(0, 60);
  if (typeof o.godStatus === 'string' && o.godStatus) out.godStatus = o.godStatus.slice(0, 20);
  if (typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt)) out.updatedAt = o.updatedAt;
  const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');
  if (Array.isArray(o.agents)) {
    out.agents = o.agents.slice(0, 64).map((a) => {
      const ag = (a ?? {}) as Record<string, unknown>;
      return {
        id: str(ag.id, 64),
        displayName: str(ag.displayName, 60) || 'agent',
        provider: str(ag.provider, 24),
        status: str(ag.status, 24) || 'idle',
        seatLabel: str(ag.seatLabel, 40),
        currentTaskTitle: str(ag.currentTaskTitle, 120)
      };
    });
  }
  const t = (o.tasks ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(9999, Math.trunc(v))) : 0);
  out.tasks = { queued: n(t.queued), active: n(t.active), done: n(t.done) };
  return out;
}


export class SpectatorServer {
  private server: Server | null = null;
  private readonly requestedPort: number;
  private readonly rateLimit: number;
  private readonly rateWindowMs: number;
  private readonly page: string;
  /** Minted per instance (main builds a fresh instance per start), so it is
   *  effectively per server start. Never leaves this class except via the served URL. */
  private readonly token = randomBytes(16).toString('hex');
  /** Compared against when the requested token is wrong, purely so the failure path
   *  does the same work as a correct compare. Random per process, never exported. */
  private readonly decoyToken = randomBytes(16).toString('hex');
  private boundPort: number | null = null;
  private snapshot: SpectatorSnapshot = emptySnapshot();
  // Fixed-window limiter. The LAN has no single choke IP worth keying on (many phones
  // share NAT), so this is one global bucket — enough to shed a flood cheaply.
  private windowStart = 0;
  private windowCount = 0;

  constructor(opts: SpectatorServerOptions = {}) {
    this.requestedPort = typeof opts.port === 'number' && opts.port >= 0 ? Math.trunc(opts.port) : SPECTATOR_DEFAULT_PORT;
    this.rateLimit = typeof opts.rateLimit === 'number' && opts.rateLimit > 0 ? Math.trunc(opts.rateLimit) : SPECTATOR_RATE_LIMIT;
    this.rateWindowMs = typeof opts.rateWindowMs === 'number' && opts.rateWindowMs > 0 ? Math.trunc(opts.rateWindowMs) : SPECTATOR_RATE_WINDOW_MS;
    this.page = typeof opts.page === 'string' ? opts.page : spectatorPage();
  }

  /** The unguessable path token. Handed to main so it can build the LAN URL + QR. */
  token_(): string { return this.token; }
  /** The port actually bound, or null before start. */
  port(): number | null { return this.boundPort; }
  /** Is the HTTP server listening? */
  listening(): boolean { return this.server != null; }

  /** Cache the latest snapshot pushed from the renderer. Bounded by `sanitize`. */
  setSnapshot(input: unknown): void { this.snapshot = sanitizeSpectatorSnapshot(input); }
  /** The current cached snapshot (what /state serves). */
  currentSnapshot(): SpectatorSnapshot { return this.snapshot; }

  /**
   * Bind the local HTTP server on 0.0.0.0 (so LAN phones can reach it). Tries the
   * requested port; if it is taken, falls back to an OS-assigned free port rather
   * than failing the demo. Resolves with the port it actually bound.
   */
  async start(): Promise<{ ok: boolean; port?: number; error?: string }> {
    const first = await this.tryListen(this.requestedPort);
    if (first.ok) return { ok: true, port: first.port };
    // Requested port unavailable (e.g. EADDRINUSE): retry on an OS-assigned free port.
    const second = await this.tryListen(0);
    if (second.ok) return { ok: true, port: second.port };
    return { ok: false, error: second.error };
  }

  /** Close the HTTP server. Idempotent and best-effort. */
  stop(): void {
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null;
    this.boundPort = null;
  }

  private tryListen(port: number): Promise<{ ok: boolean; port?: number; error?: string }> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => this.handleRequest(req, res));
      const onError = (e: Error): void => {
        server.off('listening', onOk);
        try { server.close(); } catch { /* noop */ }
        const code = (e as NodeJS.ErrnoException).code;
        resolve({ ok: false, error: code === 'EADDRINUSE' ? 'port in use' : e.message });
      };
      const onOk = (): void => {
        server.off('error', onError);
        const addr = server.address();
        this.server = server;
        this.boundPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve({ ok: true, port: this.boundPort });
      };
      server.once('error', onError);
      server.listen(port, '0.0.0.0', onOk);
    });
  }

  /** Fixed-window limiter — bounds total work before any parse/crypto runs. */
  private allowRequest(): boolean {
    const now = Date.now();
    if (now - this.windowStart > this.rateWindowMs) {
      this.windowStart = now;
      this.windowCount = 1;
      return true;
    }
    this.windowCount += 1;
    return this.windowCount <= this.rateLimit;
  }

  /**
   * The single request handler — the whole security boundary.
   *
   * Order matters: rate-limit first (cheapest rejection), then the token gate. Any
   * request that is not a GET to a path under the live token is answered with the
   * SAME 404, so the surface leaks nothing about which paths or tokens exist.
   */
  handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (!this.allowRequest()) { text(res, 429, 'rate limited'); return; }

    const method = req.method ?? '';
    // GET ONLY — a non-GET is a uniform 404 (no 405, which would confirm the path).
    if (method !== 'GET') { this.notFound(res); return; }

    let pathname: string;
    try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; }
    catch { this.notFound(res); return; }
    const segments = pathname.split('/').filter((s) => s.length > 0).map(decodeSegment);

    // Wrong token OR a path that doesn't exist → identical 404. The token compare
    // runs against the live token when one segment was given, and the failure does
    // the same work either way (see tokenMatches), so there is no timing signal.
    if (segments.length === 0 || !this.tokenMatches(segments[0])) { this.notFound(res); return; }

    const sub = segments[1];
    if (sub === undefined) { this.servePage(res); return; }         // GET /<token>
    if (sub === 'state') { this.serveState(res); return; }          // GET /<token>/state
    if (sub === 'health') { text(res, 200, 'ok'); return; }         // GET /<token>/health
    this.notFound(res);
  }

  /**
   * Constant-time token check. A length mismatch short-circuits before the compare
   * (timingSafeEqual throws on unequal lengths), but a WRONG token of the right
   * length is compared against a per-process decoy, so the work — and the 404 that
   * follows — is identical whether the token is wrong or the path simply doesn't exist.
   */
  private tokenMatches(provided: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(this.token);
    if (a.length !== b.length) {
      const probe = Buffer.from(this.decoyToken.slice(0, a.length));
      timingSafeEqual(probe, probe); // equal-work no-op so a length miss isn't cheaper
      return false;
    }
    return timingSafeEqual(a, b);
  }

  private servePage(res: ServerResponse): void {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(this.page);
    } catch { /* socket gone */ }
  }

  private serveState(res: ServerResponse): void {
    try {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(this.snapshot));
    } catch { /* socket gone */ }
  }

  private notFound(res: ServerResponse): void {
    try {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('Not Found');
    } catch { /* socket gone */ }
  }
}

/** Decode one path segment, falling back to the raw segment on a malformed escape. */
function decodeSegment(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function text(res: ServerResponse, status: number, body: string): void {
  try {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  } catch { /* socket gone */ }
}


/**
 * The spectator page: ONE self-contained HTML string — inline CSS + inline JS, NO
 * external fonts, NO CDN, NO network calls except polling `/state`. Hackathon wifi
 * may not reach the internet, so everything it needs is right here. Dark theme to
 * match the app's vibe; renders a schematic floor that pulses as snapshots arrive.
 *
 * NOTE: this page's own JS deliberately avoids backticks and `${` so the whole thing
 * can live inside a TypeScript template literal without escaping collisions.
 */
function spectatorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Jargon — Live Office</title>
<style>
  :root {
    --bg: #14111c; --bg2: #1c1826; --panel: #221d2e; --line: #322b40;
    --ink: #ece7f5; --muted: #9a92ad; --dim: #6b6479;
    --idle: #8b8b9a; --thinking: #6aa9ff; --working: #4fd08a; --waiting: #f5c451;
    --blocked: #ff6b6b; --success: #57e0a8; --ghost: #5a5566; --compacting: #b58cff; --looping: #ff9f43;
    --queued: #6aa9ff; --active: #4fd08a; --done: #57e0a8;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  body { min-height: 100vh; padding: 16px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .brand { font-size: 18px; font-weight: 700; letter-spacing: .5px; }
  .brand span { color: var(--working); }
  .floor { font-size: 13px; color: var(--muted); }
  .god { font-size: 12px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
  .god.ready { color: #0e1a14; background: var(--working); border-color: var(--working); }
  .god.failed { color: #fff; background: var(--blocked); border-color: var(--blocked); }
  .god.booting { color: var(--waiting); }
  .spacer { flex: 1; }
  .live { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dim); }
  .dot.on { background: var(--working); animation: pulse 1.6s infinite; }
  .dot.err { background: var(--blocked); }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(79,208,138,.6);} 70%{ box-shadow: 0 0 0 10px rgba(79,208,138,0);} 100%{ box-shadow: 0 0 0 0 rgba(79,208,138,0);} }
  .tasks { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
  .tasks .row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: var(--bg2); }
  .bar i { display: block; height: 100%; transition: width .5s ease; }
  .bar .q { background: var(--queued); } .bar .a { background: var(--active); } .bar .d { background: var(--done); }
  .counts { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; flex-wrap: wrap; }
  .counts b { color: var(--ink); }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: var(--muted); margin: 0 0 16px; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  #floor { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .zone { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px; min-height: 60px; }
  .zone h3 { margin: 0 0 9px; font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); font-weight: 600; }
  .chip { display: flex; align-items: center; gap: 8px; background: var(--bg2); border: 1px solid var(--line);
    border-radius: 8px; padding: 8px 9px; margin-bottom: 8px; animation: rise .35s ease; }
  .chip:last-child { margin-bottom: 0; }
  @keyframes rise { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: none;} }
  .sdot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--idle); }
  .sdot.working { animation: blink 1.1s infinite; }
  @keyframes blink { 0%,100% { opacity: 1;} 50% { opacity: .35;} }
  .chip .meta { min-width: 0; flex: 1; }
  .chip .name { font-size: 13px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip .sub { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .chip .prov { font-size: 10px; color: var(--dim); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; flex: none; }
  .empty { color: var(--dim); font-size: 12px; padding: 6px 2px; }
  footer { margin-top: 18px; font-size: 11px; color: var(--dim); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  @media (max-width: 520px) { body { padding: 12px; } .brand { font-size: 16px; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">Jargon <span>Live Office</span></div>
    <div class="floor" id="floor-name">—</div>
    <div class="god" id="god">god …</div>
    <div class="spacer"></div>
    <div class="live"><span class="dot" id="dot"></span><span id="status">connecting…</span></div>
  </header>

  <section class="tasks">
    <div class="row"><span>Task board</span><span id="board-total">0 total</span></div>
    <div class="bar"><i class="q" id="bq"></i><i class="a" id="ba"></i><i class="d" id="bd"></i></div>
    <div class="counts">
      <span><b id="cq">0</b> queued</span>
      <span><b id="ca">0</b> active</span>
      <span><b id="cd">0</b> done</span>
    </div>
  </section>

  <div class="legend">
    <span><i style="background:var(--working)"></i>working</span>
    <span><i style="background:var(--thinking)"></i>thinking</span>
    <span><i style="background:var(--waiting)"></i>waiting</span>
    <span><i style="background:var(--blocked)"></i>blocked</span>
    <span><i style="background:var(--idle)"></i>idle</span>
  </div>

  <div id="floor"></div>

  <footer>
    <span id="updated">never updated</span>
    <span>read-only · token-gated</span>
  </footer>
</div>
PLACEHOLDER_SCRIPT
<script>
(function () {
  var COLORS = {
    idle: 'var(--idle)', thinking: 'var(--thinking)', working: 'var(--working)',
    waiting: 'var(--waiting)', blocked: 'var(--blocked)', success: 'var(--success)',
    ghost: 'var(--ghost)', compacting: 'var(--compacting)', looping: 'var(--looping)',
    typing: 'var(--thinking)'
  };
  var POLL_MS = 1500;
  // Rebuild the /state URL from the token already in this page's own path, so it works
  // whether we were served at /<token> or /<token>/ and never needs the token in JS.
  var seg = location.pathname.split('/').filter(function (s) { return s.length > 0; });
  var token = seg.length ? seg[0] : '';
  var STATE = '/' + encodeURIComponent(token) + '/state';
  var lastOk = 0;

  function $(id) { return document.getElementById(id); }
  function color(status) { return COLORS[status] || 'var(--idle)'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ago(ms) {
    if (!ms) return 'never updated';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 2 ? 'updated just now' : ('updated ' + s + 's ago');
  }

  function render(snap) {
    $('floor-name').textContent = snap.floorLabel || snap.floor || 'office';
    var god = $('god');
    god.textContent = 'god · ' + (snap.godStatus || '?');
    god.className = 'god ' + (snap.godStatus || '');

    var t = snap.tasks || { queued: 0, active: 0, done: 0 };
    var q = t.queued || 0, a = t.active || 0, d = t.done || 0, total = q + a + d;
    $('cq').textContent = q; $('ca').textContent = a; $('cd').textContent = d;
    $('board-total').textContent = total + ' total';
    var base = total > 0 ? total : 1;
    $('bq').style.width = (q / base * 100) + '%';
    $('ba').style.width = (a / base * 100) + '%';
    $('bd').style.width = (d / base * 100) + '%';

    // Group agents by seat/zone so the schematic reads like a floor, not a list.
    var zones = {};
    var order = [];
    var agents = Array.isArray(snap.agents) ? snap.agents : [];
    for (var i = 0; i < agents.length; i++) {
      var ag = agents[i];
      var key = ag.seatLabel || 'Open floor';
      if (!zones[key]) { zones[key] = []; order.push(key); }
      zones[key].push(ag);
    }
    var html = '';
    for (var z = 0; z < order.length; z++) {
      var label = order[z];
      html += '<div class="zone"><h3>' + esc(label) + '</h3>';
      var list = zones[label];
      for (var j = 0; j < list.length; j++) {
        var it = list[j];
        var st = it.status || 'idle';
        var sub = it.currentTaskTitle ? it.currentTaskTitle : st;
        html += '<div class="chip">'
          + '<span class="sdot ' + esc(st) + '" style="background:' + color(st) + '"></span>'
          + '<span class="meta"><span class="name">' + esc(it.displayName) + '</span>'
          + '<span class="sub">' + esc(sub) + '</span></span>'
          + (it.provider ? '<span class="prov">' + esc(it.provider) + '</span>' : '')
          + '</div>';
      }
      html += '</div>';
    }
    if (!html) html = '<div class="empty">The floor is quiet — waiting for agents…</div>';
    $('floor').innerHTML = html;
  }

  function tickClock() { $('updated').textContent = ago(lastOk); }

  function poll() {
    fetch(STATE, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (snap) {
        lastOk = (snap && snap.updatedAt) || Date.now();
        render(snap);
        $('dot').className = 'dot on';
        $('status').textContent = 'live';
      })
      .catch(function () {
        $('dot').className = 'dot err';
        $('status').textContent = 'reconnecting…';
      });
  }

  poll();
  setInterval(poll, POLL_MS);
  setInterval(tickClock, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
</script>
</body>
</html>
`;
}

