'use strict';

/**
 * Spectator mode — the read-only LAN surface that lets a phone watch the floor live.
 * What this locks down:
 *
 *   1. the server starts on a real port and stops cleanly (no leaked listener);
 *   2. GET /<token> serves the self-contained page; GET /<token>/state returns the
 *      latest pushed snapshot; GET /<token>/health is ok;
 *   3. TOKEN GATING — a wrong token is answered with the EXACT same 404 (status AND
 *      body) as a path that does not exist, so the surface can't be walked;
 *   4. GET ONLY — a POST (or any non-GET) to the correct token is still a 404;
 *   5. RATE LIMIT — a burst past the cap is answered 429;
 *   6. /state round-trip — a snapshot pushed via setSnapshot() comes back verbatim
 *      (and an over-long / malformed one is clamped, never echoed raw).
 *
 * Driven against a REAL bound server on an OS-assigned port (port 0), because the
 * whole point is the wire behaviour — the token gate, the 404 equivalence, and the
 * snapshot round-trip are only meaningful end-to-end. spectator.ts has no electron
 * import, so this is plain Node.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { SpectatorServer, sanitizeSpectatorSnapshot, SPECTATOR_DEFAULT_PORT } = loadTs('src/main/spectator.ts');

/** Start a server on a free port and return { server, base, token }. */
async function startServer(opts = {}) {
  const server = new SpectatorServer({ port: 0, ...opts });
  const res = await server.start();
  assert.equal(res.ok, true, `server failed to start: ${res.error}`);
  const port = server.port();
  assert.ok(port && port > 0, 'server did not report a bound port');
  return { server, base: `http://127.0.0.1:${port}`, token: server.token_() };
}

test('start binds a port and stop releases it', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.stop());
  assert.equal(server.listening(), true);
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  server.stop();
  assert.equal(server.listening(), false);
  // After stop the port must refuse connections.
  await assert.rejects(() => fetch(`${base}/x`, { signal: AbortSignal.timeout(2000) }));
});

test('the correct token serves the page, /state, and /health', async (t) => {
  const { server, base, token } = await startServer();
  t.after(() => server.stop());

  const page = await fetch(`${base}/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  const html = await page.text();
  assert.match(html, /Live Office/, 'page must carry the spectator UI');
  assert.ok(!html.includes('cdn.'), 'page must not pull from a CDN');
  assert.ok(!/<link[^>]+href="https?:/.test(html), 'page must not load external stylesheets');

  const health = await fetch(`${base}/${token}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.text()).trim(), 'ok');
});

test('a wrong token is answered EXACTLY like a path that does not exist', async (t) => {
  const { server, base, token } = await startServer();
  t.after(() => server.stop());

  const wrong = await fetch(`${base}/${'0'.repeat(token.length)}/state`);
  const missing = await fetch(`${base}/definitely-not-a-real-path`);
  assert.equal(wrong.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(wrong.status, missing.status, 'wrong token and missing path must share a status');
  const wrongBody = await wrong.text();
  const missingBody = await missing.text();
  assert.equal(wrongBody, missingBody, 'wrong token and missing path must share a body');

  // A wrong token of a DIFFERENT length is still the same 404 (no length oracle).
  const shortWrong = await fetch(`${base}/x`);
  assert.equal(shortWrong.status, 404);
  assert.equal(await shortWrong.text(), missingBody);

test('only GET is allowed — a POST to the correct token is a 404, not a write', async (t) => {
  const { server, base, token } = await startServer();
  t.after(() => server.stop());

  const before = server.currentSnapshot();
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await fetch(`${base}/${token}/state`, { method });
    assert.equal(res.status, 404, `${method} must be a 404 (GET-only surface)`);
  }
  // Nothing was written.
  assert.deepEqual(server.currentSnapshot(), before);
});

test('the fixed-window rate limit turns a flood into 429s', async (t) => {
  // A tiny cap so the test doesn't need to send hundreds of requests.
  const { server, base, token } = await startServer({ rateLimit: 5, rateWindowMs: 60_000 });
  t.after(() => server.stop());

  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${base}/${token}/health`);
    statuses.push(res.status);
  }
  assert.equal(statuses.slice(0, 5).every((s) => s === 200), true, 'the first `rateLimit` requests pass');
  assert.equal(statuses.slice(5).every((s) => s === 429), true, 'requests past the cap are 429');
});

test('/state round-trips the pushed snapshot, and clamps an abusive one', async (t) => {
  const { server, base, token } = await startServer();
  t.after(() => server.stop());

  const snap = {
    floor: 'staffroom', floorLabel: 'The Staff Room', godStatus: 'ready',
    agents: [
      { id: 'god', displayName: 'Principal', provider: 'claude', status: 'working', seatLabel: 'office', currentTaskTitle: 'coordinating the floor' },
      { id: 'w1', displayName: 'Jim', provider: 'codex', status: 'idle', seatLabel: 'Teacher desks', currentTaskTitle: '' }
    ],
    tasks: { queued: 3, active: 2, done: 7 },
    updatedAt: 1234567890
  };
  server.setSnapshot(snap);

  const res = await fetch(`${base}/${token}/state`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const got = await res.json();
  assert.deepEqual(got, snap, 'the pushed snapshot must round-trip verbatim');

  // A malformed / oversized snapshot is clamped, never echoed raw.
  server.setSnapshot({ agents: 'not-an-array', tasks: { queued: -5, active: 1e9, done: 'x' }, floor: 'y'.repeat(500) });
  const clamped = await (await fetch(`${base}/${token}/state`)).json();
  assert.ok(Array.isArray(clamped.agents) && clamped.agents.length === 0, 'bad agents → empty array');
  assert.ok(clamped.floor.length <= 40, 'floor is length-capped');
  assert.equal(clamped.tasks.queued, 0, 'negative counts clamp to 0');
  assert.ok(clamped.tasks.active <= 9999, 'huge counts are capped');
  assert.equal(clamped.tasks.done, 0, 'non-numeric counts become 0');
});

test('before any snapshot is pushed, /state serves a valid empty one', async (t) => {
  const { server, base, token } = await startServer();
  t.after(() => server.stop());
  const got = await (await fetch(`${base}/${token}/state`)).json();
  assert.equal(got.floor, 'office');
  assert.deepEqual(got.agents, []);
  assert.deepEqual(got.tasks, { queued: 0, active: 0, done: 0 });
  assert.equal(typeof got.godStatus, 'string');
});

test('sanitizeSpectatorSnapshot defaults a non-object to the empty snapshot', () => {
  const out = sanitizeSpectatorSnapshot(null);
  assert.deepEqual(out.agents, []);
  assert.deepEqual(out.tasks, { queued: 0, active: 0, done: 0 });
  assert.equal(typeof sanitizeSpectatorSnapshot(42).godStatus, 'string');
});

test('the default port constant is the suggested 47870', () => {
  assert.equal(SPECTATOR_DEFAULT_PORT, 47870);
});


test('the QR encoder produces a well-formed, self-contained SVG for a LAN URL', () => {
  // The QR encoder is hand-rolled (no npm dep) and a phone must actually scan it,
  // so lock down its structural invariants here.
  const { encodeQr, qrToSvg } = loadTs('src/renderer/src/spectator/qr.ts');

  const url = 'http://192.168.1.42:47870/0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  const m = encodeQr(url);
  // A QR symbol is (version*4+17) modules per side.
  assert.equal(m.size, m.version * 4 + 17);
  assert.equal(m.modules.length, m.size);
  assert.equal(m.modules[0].length, m.size);
  assert.ok(m.version >= 1 && m.version <= 10, 'a short URL fits in a low version');

  // The three finder patterns must be present (top-left, top-right, bottom-left):
  // a solid 7x7-ish dark ring at each corner. Check the finder's centre pixel is dark
  // and the module just inside the ring (the light separator side) is light.
  const at = (x, y) => m.modules[y][x];
  assert.equal(at(3, 3), true, 'top-left finder centre is dark');
  assert.equal(at(m.size - 4, 3), true, 'top-right finder centre is dark');
  assert.equal(at(3, m.size - 4), true, 'bottom-left finder centre is dark');

  const svg = qrToSvg(m, { scale: 4 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'valid svg root');
  assert.ok(svg.includes('<path'), 'svg has a module path');
  assert.ok(!svg.includes('http://cdn') && !svg.includes('<image'), 'no external refs in the QR svg');

  // A longer payload bumps the version (bigger matrix) — capacity selection works.
  const big = encodeQr('x'.repeat(120));
  assert.ok(big.version > m.version, 'a bigger payload needs a bigger version');
  assert.equal(big.size, big.version * 4 + 17);

  // An absurdly long payload throws rather than emitting a corrupt symbol.
  assert.throws(() => encodeQr('y'.repeat(500)), /exceeds version/);
});

});
