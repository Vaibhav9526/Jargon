'use strict';
/**
 * OpenMAIC hosted adapter — every network call mocked.
 *
 * Nothing in this file touches the network. `fetch` is injected, so the tests
 * assert on exactly the bytes and headers the adapter would have put on the
 * wire, and the host is unreachable by construction.
 *
 * The security properties get the most assertions, because they are the ones
 * that fail silently: the origin pin, the credential-on-redirect refusal, the
 * hostile `pollUrl`, the hostile `result.url`, and the access code never
 * appearing in an error, a progress message, or a request body.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const loadTs = require(path.join(ROOT, 'test/load-ts.cjs'));

const mod = loadTs('src/main/openMaic.ts');
const { OPENMAIC_ORIGIN, validateClassroomUrl, createOpenMaicClassroom, OpenMaicError } = mod;

const SECRET = 'sk-do-not-leak-this-value';

// ── helpers ───────────────────────────────────────────────────────────────

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * The runtime contract probe. The adapter calls
 * `GET /api/generate-classroom/capabilities` before uploading anything; a 404 is
 * the legacy deployment (the `[jobId]` catch-all ate the path) and a 200 is the
 * modern `materialIds` one. `mockFetch` answers this path itself so the
 * individual tests only have to script what they are actually about.
 */
const LEGACY_PROBE = json(
  { success: false, errorCode: 'INVALID_REQUEST', error: 'Classroom generation job not found' },
  404,
);
const MODERN_PROBE = json({
  success: true,
  capabilities: { webSearch: true, imageGeneration: true, videoGeneration: true, tts: true },
  materials: {
    formats: [{ id: 'pdf', mime: 'application/pdf', extensions: ['.pdf'] }],
    maxCount: 5,
    maxTotalBytes: 157286400,
    maxDocumentBytes: 52428800,
    maxMediaBytes: 52428800,
  },
});

const PROBE_PATH = '/api/generate-classroom/capabilities';

/**
 * Records every call and answers from a queue of scripted responses.
 *
 * `opts.deployment` picks the answer the contract probe gets: `'legacy'` (the
 * default, and what the live instance actually does) or `'modern'`. Every probe
 * call is still recorded in `calls`, so a test can assert the probe happened and
 * what it carried.
 */
function mockFetch(script, opts = {}) {
  const deployment = opts.deployment ?? 'legacy';
  const calls = [];
  const fn = async (url, init) => {
    const href = String(url);
    if (new URL(href).pathname === PROBE_PATH) {
      // The probe is intercepted and answered by this double, not scripted by
      // each test, so it is recorded separately — otherwise every index-based
      // assertion below (`calls[1]` is the submit, and so on) would have to
      // chase an extra entry in every single test.
      (fn.probeCalls ??= []).push({ url: href, init: init || {} });
      if (deployment === 'legacy') return LEGACY_PROBE;
      if (deployment === 'modern') return MODERN_PROBE;
      return deployment; // a Response the caller supplied, for probe-status tests
    }
    calls.push({ url: href, init: init || {} });
    let step = typeof script === 'function' ? script(calls.length) : script.shift();
    // A scripted step may be a promise (e.g. a rejected one standing in for an
    // aborted fetch). Settle it here so it rejects rather than being handed back
    // as if it were a Response.
    if (step && typeof step.then === 'function') step = await step;
    if (step === undefined) throw new Error(`mockFetch: unscripted call #${calls.length} to ${href}`);
    if (step instanceof Error) throw step;
    return step;
  };
  fn.calls = calls;
  return fn;
}

const health = (caps = { webSearch: true, imageGeneration: true, videoGeneration: true, tts: true }) =>
  json({ success: true, status: 'ok', version: '0.1.0', capabilities: caps });

const submitOk = (jobId = 'run-AbC123', overrides = {}) =>
  json(
    {
      success: true,
      jobId,
      status: 'queued',
      step: 'queued',
      message: 'Classroom generation job queued',
      pollUrl: `${OPENMAIC_ORIGIN}/api/generate-classroom/${jobId}`,
      pollIntervalMs: 5000,
      ...overrides,
    },
    202,
  );

const pollOk = (status, overrides = {}) =>
  json({
    success: true,
    jobId: 'run-AbC123',
    status,
    step: status === 'succeeded' ? 'completed' : 'generating_scenes',
    pollUrl: `${OPENMAIC_ORIGIN}/api/generate-classroom/run-AbC123`,
    pollIntervalMs: 5000,
    done: status === 'succeeded' || status === 'failed',
    ...overrides,
  });

const parseOk = (text = 'lecture notes', images = []) => json({ success: true, data: { text, images } });

/** A tiny valid-ish PDF byte array; contents are never inspected by the adapter. */
const pdfBytes = (n = 64) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251));

function immediateAbort() {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

/**
 * Collapse the 5s poll floor and the 20-minute deadline. Every test that polls
 * more than once needs this or the suite waits out real time — the un-collapsed
 * version took ~155s. The production defaults are asserted separately in
 * "the poll floor and the deadline are 5s and 20 minutes".
 */
const FAST = { __testTiming: { minPollIntervalMs: 0, maxPollIntervalMs: 0, deadlineMs: 5_000 } };

const baseOptions = (fetchImpl, extra = {}) => ({ fetch: fetchImpl, ...FAST, ...extra });

// ── validateClassroomUrl ──────────────────────────────────────────────────

test('validateClassroomUrl accepts a bare classroom id', () => {
  assert.equal(validateClassroomUrl('Uyh82Y32ZK'), `${OPENMAIC_ORIGIN}/classroom/Uyh82Y32ZK`);
});

test('validateClassroomUrl accepts a full on-origin URL', () => {
  assert.equal(
    validateClassroomUrl(`${OPENMAIC_ORIGIN}/classroom/Uyh82Y32ZK`),
    `${OPENMAIC_ORIGIN}/classroom/Uyh82Y32ZK`,
  );
});

test('validateClassroomUrl accepts an origin-relative path', () => {
  assert.equal(validateClassroomUrl('/classroom/abc-123_XY'), `${OPENMAIC_ORIGIN}/classroom/abc-123_XY`);
});

test('validateClassroomUrl trims surrounding whitespace', () => {
  assert.equal(validateClassroomUrl('  abc123 \n'), `${OPENMAIC_ORIGIN}/classroom/abc123`);
});

test('validateClassroomUrl refuses another origin', () => {
  assert.throws(() => validateClassroomUrl('https://evil.example/classroom/abc'), /must be on/);
});

test('validateClassroomUrl refuses a lookalike host', () => {
  assert.throws(() => validateClassroomUrl('https://open.maic.chat.evil.test/classroom/abc'), /must be on/);
});

test('validateClassroomUrl refuses http', () => {
  assert.throws(() => validateClassroomUrl('http://open.maic.chat/classroom/abc'), /must be https/);
});

test('validateClassroomUrl refuses embedded credentials', () => {
  assert.throws(() => validateClassroomUrl('https://user:pw@open.maic.chat/classroom/abc'), /must not contain credentials/);
});

test('validateClassroomUrl refuses a non-classroom path', () => {
  assert.throws(() => validateClassroomUrl(`${OPENMAIC_ORIGIN}/admin`), /must be \/classroom/);
});

test('validateClassroomUrl refuses a traversal attempt', () => {
  assert.throws(() => validateClassroomUrl(`${OPENMAIC_ORIGIN}/classroom/../../admin`), /must be \/classroom/);
});

test('validateClassroomUrl refuses a query string', () => {
  assert.throws(() => validateClassroomUrl(`${OPENMAIC_ORIGIN}/classroom/abc?next=https://evil.test`), /query or fragment/);
});

test('validateClassroomUrl refuses a fragment', () => {
  assert.throws(() => validateClassroomUrl(`${OPENMAIC_ORIGIN}/classroom/abc#x`), /query or fragment/);
});

test('validateClassroomUrl refuses an empty or non-string input', () => {
  assert.throws(() => validateClassroomUrl(''), /empty/);
  assert.throws(() => validateClassroomUrl(undefined), /empty/);
  assert.throws(() => validateClassroomUrl(null), /empty/);
});

test('validateClassroomUrl refuses a second path segment', () => {
  assert.throws(() => validateClassroomUrl(`${OPENMAIC_ORIGIN}/classroom/abc/../../x`), /must be \/classroom/);
});

test('validateClassroomUrl refuses an over-long id', () => {
  assert.throws(() => validateClassroomUrl('a'.repeat(65)), /must be \/classroom|not a valid/);
});

// ── topic-only generation ─────────────────────────────────────────────────

test('topic-only generation submits just the requirement and polls to success', async () => {
  const f = mockFetch([
    health(),
    submitOk(),
    pollOk('running'),
    pollOk('succeeded', {
      result: { classroomId: 'Uyh82Y32ZK', url: `${OPENMAIC_ORIGIN}/classroom/Uyh82Y32ZK`, scenesCount: 6 },
    }),
  ]);

  const out = await createOpenMaicClassroom(
    { requirement: 'Intro to quantum mechanics for high schoolers', pdfs: [] },
    SECRET,
    baseOptions(f),
  );

  assert.equal(out.jobId, 'run-AbC123');
  assert.equal(out.url, `${OPENMAIC_ORIGIN}/classroom/Uyh82Y32ZK`);

  const paths = f.calls.map((c) => new URL(c.url).pathname);
  assert.deepEqual(paths, [
    '/api/health',
    '/api/generate-classroom',
    '/api/generate-classroom/run-AbC123',
    '/api/generate-classroom/run-AbC123',
  ]);
});

test('submit body carries requirement, built-in agents, and no pdfContent', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'teach me graphs', pdfs: [] }, SECRET, baseOptions(f));

  const body = JSON.parse(f.calls[1].init.body);
  assert.equal(body.requirement, 'teach me graphs');
  assert.equal(body.agentMode, 'default');
  assert.ok(!('pdfContent' in body));
});

test('TTS is requested when health advertises it', async () => {
  const f = mockFetch([health({ tts: true }), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  assert.equal(JSON.parse(f.calls[1].init.body).enableTTS, true);
});

test('TTS is not requested when health does not advertise it', async () => {
  const f = mockFetch([health({ tts: false }), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  assert.ok(!('enableTTS' in JSON.parse(f.calls[1].init.body)));
});

test('image, video and web search are never requested even when advertised', async () => {
  const f = mockFetch([
    health({ webSearch: true, imageGeneration: true, videoGeneration: true, tts: true }),
    submitOk(),
    pollOk('succeeded', { result: { classroomId: 'abc' } }),
  ]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  const body = JSON.parse(f.calls[1].init.body);
  for (const flag of ['enableImageGeneration', 'enableVideoGeneration', 'enableWebSearch']) {
    assert.ok(!(flag in body), `${flag} must not be sent`);
  }
});

// ── PDF handling ──────────────────────────────────────────────────────────

test('a PDF is parsed and its bounded content becomes pdfContent', async () => {
  const f = mockFetch([
    health({ tts: false }),
    parseOk('photosynthesis notes', ['data:image/png;base64,AAA']),
    submitOk(),
    pollOk('succeeded', { result: { classroomId: 'abc' } }),
  ]);

  await createOpenMaicClassroom(
    { requirement: 'teach biology', pdfs: [{ name: 'notes.pdf', data: pdfBytes() }] },
    SECRET,
    baseOptions(f),
  );

  assert.equal(f.calls[1].url, `${OPENMAIC_ORIGIN}/api/parse-pdf`);
  const body = JSON.parse(f.calls[2].init.body);
  assert.match(body.pdfContent.text, /photosynthesis notes/);
  assert.match(body.pdfContent.text, /notes\.pdf/);
  assert.deepEqual(body.pdfContent.images, ['data:image/png;base64,AAA']);
});

test('the parse request is multipart with the field named pdf', async () => {
  const f = mockFetch([
    health(),
    parseOk('t'),
    submitOk(),
    pollOk('succeeded', { result: { classroomId: 'abc' } }),
  ]);
  await createOpenMaicClassroom(
    { requirement: 'x', pdfs: [{ name: 'lecture.pdf', data: pdfBytes() }] },
    SECRET,
    baseOptions(f),
  );
  const init = f.calls[1].init;
  assert.ok(init.body instanceof FormData);
  const file = init.body.get('pdf');
  assert.ok(file, 'pdf field must be present');
  assert.equal(file.name, 'lecture.pdf');
});

test('several PDFs are parsed in order and merged into one pdfContent', async () => {
  const f = mockFetch([
    health(),
    parseOk('first doc'),
    parseOk('second doc'),
    parseOk('third doc'),
    submitOk(),
    pollOk('succeeded', { result: { classroomId: 'abc' } }),
  ]);

  await createOpenMaicClassroom(
    {
      requirement: 'x',
      pdfs: [
        { name: 'one.pdf', data: pdfBytes() },
        { name: 'two.pdf', data: pdfBytes() },
        { name: 'three.pdf', data: pdfBytes() },
      ],
    },
    SECRET,
    baseOptions(f),
  );

  const text = JSON.parse(f.calls[4].init.body).pdfContent.text;
  assert.ok(text.indexOf('first doc') < text.indexOf('second doc'));
  assert.ok(text.indexOf('second doc') < text.indexOf('third doc'));
  assert.equal(f.calls.filter((c) => c.url.endsWith('/api/parse-pdf')).length, 3);
});

test('extracted text past the per-document limit is refused before the POST, not truncated', async () => {
  const huge = 'x'.repeat(400_001); // one past CONTENT_LIMITS.maxTextCharsPerPdf
  const f = mockFetch([health(), parseOk(huge)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'big.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => {
      assert.equal(e.kind, 'context_too_large');
      return true;
    },
  );
  // No submit, no upload-bound request: it must have thrown at parse/aggregate.
  assert.ok(!f.calls.some((c) => c.url.endsWith('/api/generate-classroom')), 'must not submit');
});

test('extracted text exactly at the limit is carried whole, not sliced', async () => {
  const atLimit = 'x'.repeat(400_000);
  const f = mockFetch([health(), parseOk(atLimit), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'big.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f));
  const sent = JSON.parse(f.calls[2].init.body).pdfContent.text;
  assert.ok(sent.includes(atLimit), 'the full extracted text must arrive untruncated');
});

test('more images than the per-document cap is refused, not silently dropped', async () => {
  const images = Array.from({ length: 65 }, (_, i) => `data:image/png;base64,IMG${i}`);
  const f = mockFetch([health(), parseOk('t', images)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'context_too_large',
  );
  assert.ok(!f.calls.some((c) => c.url.endsWith('/api/generate-classroom')), 'must not submit');
});

test('a non-data-URL image is refused, not dropped', async () => {
  const images = ['data:image/png;base64,AAA', 'https://evil.test/pixel.png'];
  const f = mockFetch([health(), parseOk('t', images)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'parse_failed',
  );
  assert.ok(!f.calls.some((c) => c.url.endsWith('/api/generate-classroom')), 'must not submit');
});

test('an SVG or script-shaped image is refused, not forwarded', async () => {
  const images = ['data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDwvc2NyaXB0Pjwvc3ZnPg=='];
  const f = mockFetch([health(), parseOk('t', images)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'parse_failed',
  );
});

test('a data URL with no base64 payload is refused', async () => {
  const images = ['data:image/png;base64,'];
  const f = mockFetch([health(), parseOk('t', images)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'parse_failed',
  );
});

test('a 32-image page set is carried whole, not clipped to a small cap', async () => {
  const images = Array.from({ length: 32 }, (_, i) => `data:image/png;base64,PAGE${i}`);
  const f = mockFetch([health(), parseOk('slides', images), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'deck.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f));
  assert.equal(JSON.parse(f.calls[2].init.body).pdfContent.images.length, 32);
});

test('an oversize single image is refused, not dropped', async () => {
  const big = `data:image/png;base64,${'A'.repeat(4_000_001)}`;
  const f = mockFetch([health(), parseOk('t', [big, 'data:image/png;base64,SMALL'])]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'context_too_large',
  );
  assert.equal(f.calls.length, 2, 'health + parse only: must not submit after a content-limit refusal');
});

test('an image-only PDF (converted locally) yields images with no text', async () => {
  const f = mockFetch([
    health(),
    parseOk('', ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']),
    submitOk(),
    pollOk('succeeded', { result: { classroomId: 'abc' } }),
  ]);
  await createOpenMaicClassroom(
    { requirement: 'explain these slides', pdfs: [{ name: 'scan.pdf', data: pdfBytes() }] },
    SECRET,
    baseOptions(f),
  );
  const content = JSON.parse(f.calls[2].init.body).pdfContent;
  assert.equal(content.text, '');
  assert.equal(content.images.length, 2);
});

test('a PDF that parses to neither text nor images is refused, not submitted empty', async () => {
  const f = mockFetch([health(), parseOk('', [])]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'blank.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'parse_failed',
  );
  assert.ok(!f.calls.some((c) => c.url.endsWith('/api/generate-classroom')), 'must not submit');
});

test('a 200 body with success:false is a parse_failed, not blank context', async () => {
  const f = mockFetch([health(), json({ success: false, error: 'could not read' }, 200)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'corrupt.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'parse_failed',
  );
  assert.ok(!f.calls.some((c) => c.url.endsWith('/api/generate-classroom')), 'must not submit');
});

test('a wrapped 200 whose data is missing text/images is refused', async () => {
  const f = mockFetch([health(), json({ success: true, data: {} }, 200)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'parse_failed',
  );
});

test('a 200 with non-string text and non-array images is refused', async () => {
  const f = mockFetch([health(), json({ success: true, data: { text: 42, images: 'nope' } }, 200)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'parse_failed',
  );
});

test('a non-string entry inside the image list fails the whole parse', async () => {
  const f = mockFetch([health(), parseOk('t', ['data:image/png;base64,AAA', 42])]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'parse_failed',
  );
});

test('a flat parse response without the data envelope remains compatible', async () => {
  const f = mockFetch([
    health(),
    json({ success: true, text: 'flat shape', images: [] }),
    submitOk(),
    pollOk('succeeded', { result: { classroomId: 'abc' } }),
  ]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f));
  assert.match(JSON.parse(f.calls[2].init.body).pdfContent.text, /flat shape/);
});

// ── input validation ──────────────────────────────────────────────────────

test('an empty requirement is refused before any request', async () => {
  const f = mockFetch([]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: '   ', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => e instanceof OpenMaicError && e.kind === 'invalid_input',
  );
  assert.equal(f.calls.length, 0);
});

test('an over-long requirement is refused before any request', async () => {
  const f = mockFetch([]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'a'.repeat(8_001), pdfs: [] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'invalid_input',
  );
  assert.equal(f.calls.length, 0);
});

test('too many PDFs is refused before any request', async () => {
  const f = mockFetch([]);
  const pdfs = Array.from({ length: 6 }, (_, i) => ({ name: `${i}.pdf`, data: pdfBytes() }));
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs }, SECRET, baseOptions(f)), (e) => e.kind === 'invalid_input');
  assert.equal(f.calls.length, 0);
});

test('an empty PDF byte array is refused', async () => {
  const f = mockFetch([]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'e.pdf', data: new Uint8Array(0) }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'invalid_input',
  );
});

test('an over-size PDF is refused before any request', async () => {
  const f = mockFetch([]);
  const huge = { name: 'huge.pdf', data: new Uint8Array(50 * 1024 * 1024 + 1) };
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [huge] }, SECRET, baseOptions(f)), (e) => e.kind === 'invalid_input');
  assert.equal(f.calls.length, 0);
});

test('a PDF with no name is refused', async () => {
  const f = mockFetch([]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: '', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'invalid_input',
  );
});

// ── origin and credential pinning ─────────────────────────────────────────

test('every request goes to the exact pinned origin', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  for (const call of f.calls) {
    assert.equal(new URL(call.url).origin, OPENMAIC_ORIGIN);
    assert.ok(call.url.startsWith('https://'));
  }
});

test('the health probe is sent without the credential', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  assert.ok(!('authorization' in f.calls[0].init.headers));
});

test('the credential is sent on submission and polling', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  assert.equal(f.calls[1].init.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(f.calls[2].init.headers.authorization, `Bearer ${SECRET}`);
});

test('the credential is sent on the PDF parse request', async () => {
  const f = mockFetch([health(), parseOk('t'), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f));
  assert.equal(f.calls[1].init.headers.authorization, `Bearer ${SECRET}`);
});

test('a redirect response is refused rather than followed', async () => {
  const redirect = () => new Response(null, { status: 302, headers: { location: 'https://evil.test/steal' } });
  const f = mockFetch([health(), redirect(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'unsafe_response' && /redirect/i.test(e.message),
  );
  assert.equal(f.calls.length, 2, 'must not have issued a request to the redirect target');
});

test('every request sets redirect: manual', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  for (const call of f.calls) assert.equal(call.init.redirect, 'manual');
});

test('a hostile pollUrl is refused before the credential is sent', async () => {
  const f = mockFetch([health(), submitOk('run-AbC123', { pollUrl: 'https://evil.test/collect' })]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'invalid_url',
  );
  assert.equal(f.calls.length, 2, 'no credentialed request may follow');
});

test('a pollUrl on our host but the wrong route is refused', async () => {
  const f = mockFetch([health(), submitOk('run-AbC123', { pollUrl: `${OPENMAIC_ORIGIN}/api/health` })]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'unsafe_response',
  );
  assert.equal(f.calls.length, 2);
});

test('a pollUrl for a different job id is refused', async () => {
  const f = mockFetch([health(), submitOk('run-AbC123', { pollUrl: `${OPENMAIC_ORIGIN}/api/generate-classroom/run-Other` })]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'unsafe_response');
});

test('a missing pollUrl is refused', async () => {
  const f = mockFetch([health(), json({ success: true, jobId: 'run-AbC123' }, 202)]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'unsafe_response');
});

test('a submit response without a usable job id is refused', async () => {
  const f = mockFetch([health(), json({ success: true, pollUrl: `${OPENMAIC_ORIGIN}/api/generate-classroom/x` }, 202)]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'unsafe_response');
});

test('a hostile job id is refused', async () => {
  const f = mockFetch([health(), submitOk('../../admin')]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'unsafe_response');
});

test('a hostile result.url is refused and never returned', async () => {
  const f = mockFetch([
    health(),
    submitOk(),
    pollOk('succeeded', { result: { classroomId: 'abc', url: 'https://evil.test/phish' } }),
  ]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'invalid_url');
});

test('a succeeded job with no link is refused', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: {} })]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'unsafe_response');
});

test('a bare classroomId result resolves to a validated URL', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'Uyh82Y32ZK' } })]);
  const out = await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  assert.equal(out.url, `${OPENMAIC_ORIGIN}/classroom/Uyh82Y32ZK`);
});

test('an unexpected job status is refused rather than polled forever', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('weird')]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'unsafe_response');
});

// ── HTTP status handling ──────────────────────────────────────────────────

test('401 reports an auth problem without echoing the body', async () => {
  const f = mockFetch([health(), json({ success: false, errorCode: 'UNAUTHENTICATED', error: `bad code ${SECRET}` }, 401)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => {
      assert.equal(e.kind, 'auth');
      assert.equal(e.status, 401);
      assert.ok(!e.message.includes(SECRET));
      return true;
    },
  );
});

test('403 is reported as auth-or-quota, without quoting upstream text', async () => {
  const f = mockFetch([health(), json({ success: false, error: 'Daily quota exhausted', details: SECRET }, 403)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => {
      assert.equal(e.status, 403);
      assert.ok(!e.message.includes(SECRET));
      assert.ok(!/Daily quota exhausted/.test(e.message), 'upstream text must not be echoed verbatim');
      return true;
    },
  );
});

test('429 is reported as rate limiting', async () => {
  const f = mockFetch([health(), json({ success: false, errorCode: 'ACTIVE_RUN_LIMIT' }, 429)]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'rate_limited');
});

test('a 500 on submit is a concise http error', async () => {
  const f = mockFetch([health(), json({ success: false, error: 'boom', details: `key=${SECRET}` }, 500)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => {
      assert.equal(e.kind, 'http');
      assert.equal(e.status, 500);
      assert.ok(!e.message.includes(SECRET));
      assert.ok(!e.message.includes('boom'));
      return true;
    },
  );
});

test('a failed parse is reported per file without the credential', async () => {
  const f = mockFetch([health(), json({ success: false, error: `parse failed ${SECRET}` }, 500)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [{ name: 'notes.pdf', data: pdfBytes() }] }, SECRET, baseOptions(f)),
    (e) => {
      assert.equal(e.kind, 'parse_failed');
      assert.ok(e.message.includes('notes.pdf'));
      assert.ok(!e.message.includes(SECRET));
      return true;
    },
  );
});

test('a failed job surfaces the job id but not the upstream error text', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('failed', { error: `scene:2:content: leaked ${SECRET}` })]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => {
      assert.equal(e.kind, 'job_failed');
      assert.equal(e.jobId, 'run-AbC123');
      assert.ok(!e.message.includes(SECRET));
      assert.ok(!/scene:2/.test(e.message));
      return true;
    },
  );
});

test('a 404 while polling is terminal', async () => {
  const f = mockFetch([health(), submitOk(), json({ success: false }, 404)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => {
      assert.equal(e.kind, 'job_failed');
      assert.equal(e.status, 404);
      return true;
    },
  );
  assert.equal(f.calls.length, 3, 'must not keep polling after a 404');
});

test('a non-JSON success body is refused', async () => {
  const f = mockFetch([health(), new Response('<html>not json</html>', { status: 200 })]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'unsafe_response');
});

test('an over-size JSON body is refused', async () => {
  const f = mockFetch([health(), new Response('x'.repeat(33 * 1024 * 1024), { status: 200 })]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'unsafe_response');
});

// ── cancellation and timeouts ─────────────────────────────────────────────

test('an already-aborted signal cancels before any request', async () => {
  const f = mockFetch([]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f, { signal: immediateAbort() })),
    (e) => e instanceof OpenMaicError && (e.kind === 'aborted' || e.kind === 'http'),
  );
});

test('abort during polling rejects as cancelled', async () => {
  const controller = new AbortController();
  // Health and submit succeed; the first poll aborts the caller's signal and
  // then rejects the way a real fetch does when its signal fires.
  let count = 0;
  const f = async (url, init) => {
    const href = String(url);
    if (new URL(href).pathname === PROBE_PATH) return LEGACY_PROBE;
    f.calls.push({ url: href, init: init || {} });
    count += 1;
    if (count === 1) return health();
    if (count === 2) return submitOk();
    controller.abort();
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
  f.calls = [];

  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f, { signal: controller.signal })),
    (e) => e.kind === 'aborted',
  );
});

test('an abort while sleeping between polls rejects without another request', async () => {
  const controller = new AbortController();
  let count = 0;
  const f = async (url, init) => {
    const href = String(url);
    if (new URL(href).pathname === PROBE_PATH) return LEGACY_PROBE;
    f.calls.push({ url: href, init: init || {} });
    count += 1;
    if (count === 1) return health();
    if (count === 2) {
      // Abort right after the submission lands, i.e. during the poll sleep.
      controller.abort();
      return submitOk();
    }
    return pollOk('running');
  };
  f.calls = [];

  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f, { signal: controller.signal })),
    (e) => e.kind === 'aborted',
  );
  assert.equal(f.calls.length, 2, 'the sleep must abort before the next poll is issued');
});

test('a transport failure never surfaces the raw error', async () => {
  const f = mockFetch([health(), new Error(`connect ECONNREFUSED with key ${SECRET}`)]);
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => {
      assert.ok(!e.message.includes(SECRET));
      assert.ok(!e.message.includes('ECONNREFUSED'));
      return true;
    },
  );
});

test('an aborted request reports a timeout when no caller signal was given', async () => {
  const abortErr = new Error('aborted');
  abortErr.name = 'AbortError';
  const f = mockFetch([health(), Promise.reject(abortErr)]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)), (e) => e.kind === 'timeout');
});

test('the poll floor is 5s and the deadline is 20 minutes in production', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/openMaic.ts'), 'utf8');
  assert.match(src, /minPollIntervalMs:\s*5_000/);
  assert.match(src, /deadlineMs:\s*20 \* 60 \* 1000/);
  assert.match(src, /maxPollIntervalMs:\s*60_000/);
});

test('a server poll hint below the floor cannot produce a busy loop', async () => {
  // `pollIntervalMs: 0` is remote input. With the real 5s floor against a 20ms
  // deadline, a busy loop would be visible as an unbounded call count instead of
  // as a slow test.
  const calls = [];
  let count = 0;
  const cycling = async (url, init) => {
    const href = String(url);
    if (new URL(href).pathname === PROBE_PATH) return LEGACY_PROBE;
    calls.push({ url: href, init: init || {} });
    count += 1;
    if (count === 1) return health();
    if (count === 2) return submitOk('run-AbC123', { pollIntervalMs: 0 });
    if (count < 400) return pollOk('running', { pollIntervalMs: 0 });
    return pollOk('succeeded', { result: { classroomId: 'abc' } });
  };

  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, {
      fetch: cycling,
      __testTiming: { minPollIntervalMs: 5_000, deadlineMs: 20 },
    }),
    (e) => e.kind === 'deadline',
  );
  // 2 setup calls plus at most one poll before the deadline — never 400.
  assert.ok(calls.length <= 4, `the 5s floor must throttle polling, saw ${calls.length} calls`);
});

test('a server poll hint above the ceiling is clamped', async () => {
  const calls = [];
  let count = 0;
  const cycling = async (url, init) => {
    const href = String(url);
    if (new URL(href).pathname === PROBE_PATH) return LEGACY_PROBE;
    calls.push({ url: href, init: init || {} });
    count += 1;
    if (count === 1) return health();
    if (count === 2) return submitOk('run-AbC123', { pollIntervalMs: 86_400_000 });
    return pollOk('succeeded', { result: { classroomId: 'abc' }, pollIntervalMs: 86_400_000 });
  };

  const out = await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, {
    fetch: cycling,
    __testTiming: { minPollIntervalMs: 0, maxPollIntervalMs: 1, deadlineMs: 5_000 },
  });
  assert.equal(out.jobId, 'run-AbC123');
  assert.equal(calls.length, 3, 'a one-day hint must not stall the job past the deadline');
});

// ── progress ──────────────────────────────────────────────────────────────

test('progress messages are emitted and never contain the credential', async () => {
  const messages = [];
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f, { onProgress: (m) => messages.push(m) }));
  assert.ok(messages.length >= 2);
  assert.ok(messages.some((m) => /capabilit/i.test(m)));
  assert.ok(messages.some((m) => /ready/i.test(m)));
  for (const m of messages) assert.ok(!m.includes(SECRET));
});

test('progress reports each PDF being read', async () => {
  const messages = [];
  const f = mockFetch([health(), parseOk('a'), parseOk('b'), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom(
    { requirement: 'x', pdfs: [{ name: 'a.pdf', data: pdfBytes() }, { name: 'b.pdf', data: pdfBytes() }] },
    SECRET,
    baseOptions(f, { onProgress: (m) => messages.push(m) }),
  );
  assert.ok(messages.some((m) => /1 of 2/.test(m)));
  assert.ok(messages.some((m) => /2 of 2/.test(m)));
});

// ── secret hygiene ────────────────────────────────────────────────────────

test('the access code never appears in a request body', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'teach graphs', pdfs: [] }, SECRET, baseOptions(f));
  for (const call of f.calls) {
    const body = typeof call.init.body === 'string' ? call.init.body : '';
    assert.ok(!body.includes(SECRET));
  }
});

test('no error message across the failure paths contains the access code', async () => {
  const scripts = [
    [health(), json({}, 401)],
    [health(), json({}, 403)],
    [health(), json({}, 429)],
    [health(), json({}, 500)],
    [health(), parseOk('t'), json({}, 401)],
    [health(), submitOk(), pollOk('failed', { error: SECRET })],
    [health(), submitOk(), json({}, 404)],
  ];
  for (const script of scripts) {
    const f = mockFetch(script.slice());
    await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: script.length > 2 ? [{ name: 'a.pdf', data: pdfBytes() }] : [] }, SECRET, baseOptions(f)));
  }
});

test('an over-long access code is refused without a request', async () => {
  const f = mockFetch([]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, 'a'.repeat(600), baseOptions(f)), (e) => e.kind === 'invalid_input');
  assert.equal(f.calls.length, 0);
});

test('a blank access code still runs health and fails as a 401, not a crash', async () => {
  const f = mockFetch([health(), json({}, 401)]);
  await assert.rejects(createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, '', baseOptions(f)), (e) => e.kind === 'auth');
});

test('the adapter imports nothing from electron', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/openMaic.ts'), 'utf8');
  assert.ok(!/from ['"]electron['"]/.test(src), 'must be Electron-free');
  assert.ok(!/require\(['"]electron['"]\)/.test(src));
});

// ── deployment-contract negotiation ───────────────────────────────────────

test('modern deployment: topic-only works and no legacy flags are sent', async () => {
  const f = mockFetch(
    [health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })],
    { deployment: 'modern' },
  );
  await createOpenMaicClassroom({ requirement: 'teach linear algebra', pdfs: [] }, SECRET, baseOptions(f));

  const body = JSON.parse(f.calls[1].init.body);
  assert.equal(body.requirement, 'teach linear algebra');
  assert.ok(!('pdfContent' in body));
  assert.ok(!('agentMode' in body), 'agentMode is legacy-only');
  assert.ok(!('enableTTS' in body), 'enableTTS is legacy-only');
  assert.ok(!('enableWebSearch' in body));
  assert.ok(!('enableImageGeneration' in body));
  assert.ok(!('enableVideoGeneration' in body));
});

test('modern deployment: PDFs are refused before any upload', async () => {
  const f = mockFetch([health()], { deployment: 'modern' });
  await assert.rejects(
    createOpenMaicClassroom(
      { requirement: 'x', pdfs: [{ name: 'lecture.pdf', data: pdfBytes() }] },
      SECRET,
      baseOptions(f),
    ),
    (e) => {
      assert.equal(e.kind, 'unsupported_deployment');
      return true;
    },
  );
  // Health ran, the probe ran, and NOTHING was uploaded or submitted: the
  // refusal must happen before the first /api/parse-pdf and before any
  // /api/generate-classroom POST, or it is not "before upload".
  assert.ok(!f.calls.some((c) => c.url.endsWith('/api/parse-pdf')), 'must not upload');
  assert.ok(!f.calls.some((c) => c.url.endsWith('/api/generate-classroom') && c.init.method === 'POST'), 'must not submit');
});

test('the probe answers with the credential attached and redirects refused', async () => {
  const f = mockFetch([health(), submitOk(), pollOk('succeeded', { result: { classroomId: 'abc' } })]);
  await createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f));
  const probe = f.probeCalls[0];
  assert.ok(probe, 'the probe must run');
  assert.equal(probe.init.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(probe.init.redirect, 'manual');
});

test('a 401 from the probe is an auth error, not a legacy fallback', async () => {
  const f = mockFetch([health()], { deployment: json({ success: false, error: 'Unauthorized' }, 401) });
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => {
      assert.equal(e.kind, 'auth');
      assert.equal(e.status, 401);
      return true;
    },
  );
  // It must not have proceeded to parse, upload, or submit on the wrong guess.
  assert.ok(
    !f.calls.some((c) => c.url.includes('/parse-pdf') || (c.url.endsWith('/api/generate-classroom') && c.init.method === 'POST')),
    'probe 401 must stop before any parse, upload or submit',
  );
});

test('a 403 from the probe is an auth error, not a legacy fallback', async () => {
  const f = mockFetch([health()], { deployment: json({ success: false }, 403) });
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'auth' && e.status === 403,
  );
});

test('a 500 from the probe refuses with http, not a legacy guess', async () => {
  const f = mockFetch([health()], { deployment: json({ success: false }, 500) });
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'http' && e.status === 500,
  );
});

test('a network failure during the probe refuses, it does not fall back', async () => {
  const f = mockFetch([health()], { deployment: new Response('<html>bad gateway</html>', { status: 502 }) });
  await assert.rejects(
    createOpenMaicClassroom({ requirement: 'x', pdfs: [] }, SECRET, baseOptions(f)),
    (e) => e.kind === 'http' && e.status === 502,
  );
});

// ── test-timing seam containment ──────────────────────────────────────────

test('withoutTestTiming strips the seam from an options object', () => {
  const m = loadTs('src/main/openMaic.ts');
  const stripped = m.withoutTestTiming({ __testTiming: { minPollIntervalMs: 0 }, onProgress: () => {} });
  assert.ok(!('__testTiming' in stripped));
  assert.equal(typeof stripped.onProgress, 'function');
  // Without the seam, the object is returned unchanged.
  const clean = m.withoutTestTiming({ onProgress: () => {} });
  assert.ok(!('__testTiming' in clean));
});

test('the renderer cannot reach the test-timing seam', () => {
  // The seam is only reachable if an IPC handler or the preload forwards an
  // arbitrary options object. Grep both: nothing may reference it.
  const preloadSrc = fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf8');
  assert.ok(!preloadSrc.includes('__testTiming'), 'preload must not forward __testTiming');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main/openMaic.ts'), 'utf8');
  assert.ok(mainSrc.includes('@internal'), 'the seam must be documented as internal');
});
