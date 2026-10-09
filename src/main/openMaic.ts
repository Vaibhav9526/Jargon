/**
 * OpenMAIC hosted adapter — Electron-free, injectable-fetch.
 *
 * SCOPE AND WHY IT IS SHAPED THIS WAY
 *
 * This talks to the *hosted* OpenMAIC instance at the one exact origin below,
 * and only that origin. Every URL is built from `OPENMAIC_ORIGIN`; nothing in
 * the public surface accepts a caller-supplied base URL. That is not
 * parsimony, it is the whole security model: the access code is a bearer
 * credential, so any URL that could point elsewhere is a credential-exfiltration
 * primitive. Redirects are fetched with `redirect: 'manual'` and a 3xx is a hard
 * error, so a server-side redirect cannot walk the credential off-origin either.
 *
 * The access code never appears in an error, a message, a progress callback, or
 * a request body — only in the `Authorization` header of requests that are
 * already proven to be on-origin. Upstream error bodies are summarised by status
 * and never echoed, because an upstream `details` string is attacker-influenced
 * free text that may quote the request.
 *
 * CONTRACT — VERIFIED AGAINST THE LIVE HOSTED INSTANCE, NOT main
 *
 * The repo's `main` branch has moved to a `materialIds` + owner-scoped contract
 * (upload to `POST /api/materials`, pass ids to `POST /api/generate-classroom`,
 * `pdfContent` explicitly *rejected* with `400 INVALID_REQUEST`). The hosted
 * instance is behind that cutover and this file deliberately implements the
 * older hosted contract instead:
 *
 *   1. `GET  /api/health`                    -> capabilities; decides TTS only
 *   2. `POST /api/parse-pdf`                 -> multipart, field `pdf`,
 *                                               `{ success, data: { text, images } }`
 *   3. `POST /api/generate-classroom`        -> `{ requirement, pdfContent }`,
 *                                               `202 { jobId, status, step, pollUrl, pollIntervalMs }`
 *   4. `GET  {pollUrl}`                      -> `{ jobId, status, step, result, error, done }`
 *
 * Detection that decided this: `GET /api/generate-classroom/capabilities`
 * answers `404 {"error":"Classroom generation job not found"}` on the live
 * instance — the capabilities sub-route does not exist there, and the error text
 * is the `[jobId]` route's. `references/live-demo.md` documents exactly this
 * probe and says a 404 means "the instance predates this contract". Verified
 * read-only; no generation, upload or credentialed request was ever sent.
 *
 * `references/live-demo.md` is also the authority for the response envelopes
 * below; `generate-flow.md` and `api/api/generate-classroom/route.ts` at the
 * pre-cutover commit are the authority for the request payloads.
 *
 * The three optional features are not symmetric, and that is deliberate:
 *
 *   - TTS is sent as an explicit flag, but ONLY when `/api/health` advertises a
 *     TTS provider. Asking for narration the server cannot produce fails the
 *     job at a later, more expensive step.
 *   - Web search, image generation and video generation are NEVER sent. On the
 *     hosted instance these follow the server's configuration, there is no
 *     request-level switch, and turning them on costs the user's quota and
 *     money. Absence is the safe default.
 *   - `agentMode` is pinned to `'default'` — the built-in teaching agents.
 *     `'generate'` asks the server to author course-specific agents, which
 *     multiplies model spend for no benefit here.
 */

/** The only origin this adapter will ever contact. */
export const OPENMAIC_ORIGIN = 'https://open.maic.chat';

// ── bounds ────────────────────────────────────────────────────────────────
// Every one of these is a ceiling on something that would otherwise be sized by
// a remote server or by caller-supplied bytes. They are deliberately well under
// the hosted server's own limits so a hostile or broken response is refused
// before it can be forwarded into a generation request.
const LIMITS = {
  /** Hosted `materials.maxCount`. */
  maxPdfs: 5,
  /** Hosted `materials.maxDocumentBytes` (50 MiB). */
  maxPdfBytes: 50 * 1024 * 1024,
  /** Hosted `materials.maxTotalBytes` (150 MiB). */
  maxTotalPdfBytes: 150 * 1024 * 1024,
  maxRequirementChars: 8_000,
  /** Largest JSON response body read from any endpoint. */
  maxJsonBytes: 32 * 1024 * 1024,
  /** Largest error body read, and it is never surfaced. */
  maxErrorBytes: 8 * 1024,
} as const;

/**
 * Per-request ceilings on CONTENT the user supplied.
 *
 * These are different in kind from the response-size ceilings above, and the
 * difference is the whole point of this block. Exceeding a *response* ceiling is
 * a hostile or broken server and the only safe move is to refuse. Exceeding a
 * *content* ceiling means the user's own document is bigger than we will carry,
 * and silently slicing it would mean they get a classroom generated from half
 * their material and billed for it without being told. So nothing here
 * truncates: `parsePdf` and `aggregatePdfContent` throw
 * `'context_too_large'` and the caller never reaches the generation POST.
 *
 * The image ceiling is set well above a realistic page count (a 32-page
 * scanned deck must arrive whole) so the common case never trips it at all.
 */
const CONTENT_LIMITS = {
  maxTextCharsPerPdf: 400_000,
  maxTextCharsTotal: 800_000,
  maxImagesPerPdf: 64,
  maxImagesTotal: 128,
  /**
   * A single base64 data URL. ~3 MiB of decoded pixels — generous for one
   * slide, small enough that a `pdfContent` carrying 128 of them still fits
   * under the 32 MiB response ceiling.
   */
  maxImageChars: 4_000_000,
} as const;

const TIMEOUTS = {
  parsePdfMs: 120_000,
  submitMs: 30_000,
  pollMs: 30_000,
  healthMs: 10_000,
  /** Whole-job wall clock. */
  deadlineMs: 20 * 60 * 1000,
  /** Never poll faster than this, whatever the server hints. */
  minPollIntervalMs: 5_000,
  /** And never slower than this, so a bad hint cannot stall the job. */
  maxPollIntervalMs: 60_000,
} as const;

// ── errors ────────────────────────────────────────────────────────────────

export type OpenMaicErrorKind =
  | 'invalid_input'
  | 'invalid_url'
  | 'unsafe_response'
  | 'context_too_large'
  | 'unsupported_deployment'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'parse_failed'
  | 'http'
  | 'timeout'
  | 'aborted'
  | 'deadline'
  | 'job_failed';

/**
 * Every failure leaves this module as one of these. `message` is authored here
 * and never built from upstream text, so it cannot carry the access code, an
 * upstream `details` string, or a caller-supplied requirement.
 */
export class OpenMaicError extends Error {
  readonly kind: OpenMaicErrorKind;
  readonly status?: number;
  readonly jobId?: string;

  constructor(kind: OpenMaicErrorKind, message: string, extra: { status?: number; jobId?: string } = {}) {
    super(message);
    this.name = 'OpenMaicError';
    this.kind = kind;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.jobId !== undefined) this.jobId = extra.jobId;
  }
}

// ── URL validation ────────────────────────────────────────────────────────

/**
 * Classroom ids are server-generated `nanoid`s. Accepting only this alphabet
 * means a hostile `result.url` cannot smuggle a second path segment, a query
 * string, or a backslash-normalised traversal into a URL a user will click.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Parse and require an `https:` URL on the exact hosted origin, no userinfo. */
function requireOnOrigin(candidate: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new OpenMaicError('invalid_url', `${what} is not a valid URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new OpenMaicError('invalid_url', `${what} must be https.`);
  }
  // `userinfo` present means the URL is `https://user:pass@host/...` — either a
  // credential leak or an attempt to make the host look like ours.
  if (url.username !== '' || url.password !== '') {
    throw new OpenMaicError('invalid_url', `${what} must not contain credentials.`);
  }
  if (url.origin !== OPENMAIC_ORIGIN) {
    throw new OpenMaicError('invalid_url', `${what} must be on ${OPENMAIC_ORIGIN}.`);
  }
  return url;
}

/**
 * Validate a classroom URL and return it normalised.
 *
 * Accepts a bare id, a path, or a full URL, and returns the absolute
 * `https://open.maic.chat/classroom/<id>`. Anything else throws — this is the
 * last gate before a URL reaches a user as a clickable link, and the only thing
 * standing between a compromised response and an open redirect.
 */
export function validateClassroomUrl(input: string): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') throw new OpenMaicError('invalid_url', 'Classroom URL is empty.');

  // Bare id: `Uyh82Y32ZK`.
  if (SAFE_ID.test(raw)) return `${OPENMAIC_ORIGIN}/classroom/${raw}`;

  // Three input shapes are accepted, and which one we have decides how it is
  // resolved — an absolute URL must be parsed as-is, or `requireOnOrigin` would
  // be handed `https://open.maic.chat/https://evil.test/...` and validate a
  // string that was never a URL at all.
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  const url = isAbsolute
    ? requireOnOrigin(raw, 'Classroom URL')
    : requireOnOrigin(`${OPENMAIC_ORIGIN}${raw.startsWith('/') ? raw : `/${raw}`}`, 'Classroom URL');

  const match = /^\/classroom\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
  if (!match) {
    throw new OpenMaicError('invalid_url', 'Classroom URL must be /classroom/<id>.');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new OpenMaicError('invalid_url', 'Classroom URL must not carry a query or fragment.');
  }
  return `${OPENMAIC_ORIGIN}/classroom/${match[1]}`;
}

/**
 * The poll URL the server hands back is followed only if it is on-origin and on
 * the one expected route. A `pollUrl` pointing at another host, or at an
 * unexpected path on our host, is refused *before* the credential is attached.
 */
function validatePollUrl(raw: unknown, jobId: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new OpenMaicError('unsafe_response', 'Generation response is missing a poll URL.', { jobId });
  }
  const url = requireOnOrigin(raw.trim(), 'Poll URL');
  if (url.pathname !== `/api/generate-classroom/${jobId}`) {
    throw new OpenMaicError('unsafe_response', 'Poll URL is not the expected job route.', { jobId });
  }
  if (url.search !== '' || url.hash !== '') {
    throw new OpenMaicError('unsafe_response', 'Poll URL must not carry a query or fragment.', { jobId });
  }
  return url.toString();
}

// ── bounded I/O ───────────────────────────────────────────────────────────

class Aborted extends Error {
  constructor() {
    super('aborted');
    this.name = 'Aborted';
  }
}

/** Combine a caller signal and a deadline into one signal. */
function withDeadline(timeoutMs: number, caller?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Do not hold the event loop open for a timer we may abandon.
  (timer as unknown as { unref?: () => void }).unref?.();

  const onCallerAbort = () => controller.abort();
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener('abort', onCallerAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    },
  };
}

/** Read a response body as text, refusing anything over `maxBytes`. */
async function readBounded(res: Response, maxBytes: number, what: string): Promise<string> {
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new OpenMaicError('unsafe_response', `${what} exceeded the size limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function readJson(res: Response, what: string): Promise<unknown> {
  const text = await readBounded(res, LIMITS.maxJsonBytes, what);
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OpenMaicError('unsafe_response', `${what} was not valid JSON.`);
  }
}

/** Abort-aware sleep, so a cancelled job does not sit out the interval. */
function sleep(ms: number, caller?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (caller?.aborted) return reject(new Aborted());
    const timer = setTimeout(() => {
      caller?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    function onAbort() {
      clearTimeout(timer);
      reject(new Aborted());
    }
    caller?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Status-only error mapping. Upstream bodies are read to release the connection
 * and are then discarded: never parsed, never echoed. A caller learns the
 * actionable fact (fix your code / wait for the quota / retry later) without the
 * server's free text reaching a log line or a toast.
 */
function statusError(status: number, what: string): OpenMaicError {
  if (status === 401 || status === 403) {
    // 403 doubles as "access code valid but quota exhausted" on the hosted
    // instance, so name both rather than guess.
    return new OpenMaicError('auth', 'OpenMAIC rejected the access code or the daily quota is spent.', {
      status,
    });
  }
  if (status === 429) {
    return new OpenMaicError('rate_limited', 'OpenMAIC is rate limiting this account — too many generations in progress.', {
      status,
    });
  }
  return new OpenMaicError('http', `${what} failed with HTTP ${status}.`, { status });
}

// ── request core ──────────────────────────────────────────────────────────

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  accessCode: string;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
  /** Full override for the two calls whose URL is validated rather than built. */
  absoluteUrl?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
}

async function request(opts: RequestOptions): Promise<Response> {
  const url = opts.absoluteUrl ?? `${OPENMAIC_ORIGIN}${opts.path}`;
  // Belt and braces: a validated absolute URL is re-checked here, immediately
  // before the credential is attached, so no future caller can widen the net.
  if (opts.accessCode !== '') requireOnOrigin(url, 'Request URL');

  const { signal, done } = withDeadline(opts.timeoutMs, opts.signal);
  try {
    const res = await opts.fetchImpl(url, {
      method: opts.method,
      headers: {
        accept: 'application/json',
        ...(opts.accessCode !== '' ? { authorization: `Bearer ${opts.accessCode}` } : {}),
        ...opts.headers,
      },
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      signal,
      // A redirect would carry the bearer header to whatever host chose it.
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      throw new OpenMaicError('unsafe_response', 'OpenMAIC redirected the request; refusing to follow it.');
    }
    return res;
  } catch (err) {
    if (err instanceof OpenMaicError) throw err;
    if (err instanceof Aborted || (err as Error)?.name === 'AbortError') {
      if (opts.signal?.aborted) throw new OpenMaicError('aborted', 'OpenMAIC request was cancelled.');
      throw new OpenMaicError('timeout', `OpenMAIC ${opts.path} timed out.`);
    }
    // Never surface a raw transport error: it can quote the request URL, and in
    // a stack trace the header object is one property read away.
    throw new OpenMaicError('http', `OpenMAIC ${opts.path} could not be reached.`);
  } finally {
    done();
  }
}

// ── steps ─────────────────────────────────────────────────────────────────

interface Capabilities {
  tts: boolean;
}

/** Which generation contract the deployment actually speaks. */
export type DeploymentContract = 'legacy_pdf_content' | 'modern_materials';

async function readHealth(
  accessCode: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<Capabilities> {
  // `/api/health` needs no credential, and sending none keeps the access code
  // off a request whose response is the least sensitive.
  const res = await request({
    method: 'GET',
    path: '/api/health',
    accessCode: '',
    timeoutMs: TIMEOUTS.healthMs,
    ...(signal ? { signal } : {}),
    fetchImpl,
  });
  if (!res.ok) {
    await readBounded(res, LIMITS.maxErrorBytes, 'Health response').catch(() => '');
    throw statusError(res.status, 'Health check');
  }
  const body = (await readJson(res, 'Health response')) as { capabilities?: { tts?: unknown } };
  const tts = body?.capabilities?.tts === true;
  return { tts };
}

/**
 * Decide the generation contract at runtime, from the live deployment, with the
 * credential attached and redirects refused.
 *
 * Why a probe and not a constant: OpenMAIC cut over from `pdfContent` to
 * `materialIds` in commit `5312c2b4b` (2026-10-02), which also introduced
 * `GET /api/generate-classroom/capabilities`. The two contracts are mutually
 * exclusive on the wire — the modern route answers
 * `400 INVALID_REQUEST` to a `pdfContent` body, and the legacy route has no
 * `/api/materials` upload face — so guessing wrong means either a rejected
 * request or, worse, an upload to a route that will not use it.
 *
 * The probe result is read strictly, and the failure modes are distinguished
 * rather than collapsed:
 *
 *   - **200** — the capabilities route exists, so this build has the modern
 *     `materialIds` contract. `{ requirement }` still works unchanged; anything
 *     carrying a document is refused BEFORE upload (see the caller).
 *   - **404** — the route is absent and the `[jobId]` catch-all consumed the
 *     path. This is the legacy deployment, and the request is pinned to the
 *     routes verified against it.
 *   - **401 / 403** — the access-code gate answered, so the route's presence is
 *     still unknown. This does NOT mean legacy: it is refused, because treating
 *     an auth failure as a contract answer is exactly the guess this exists to
 *     prevent.
 *   - **anything else** (5xx, a network fault, a timeout, a malformed body) —
 *     likewise refused. Only a 200 or a 404 is evidence of anything.
 *
 * Verified against the live instance (read-only probes, no credential of ours
 * used, nothing generated or uploaded): `/api/generate-classroom/capabilities`
 * and `/api/generate-classroom/anything-else` return byte-identical 404
 * `{"success":false,"errorCode":"INVALID_REQUEST","error":"Classroom generation
 * job not found"}`, while `/api/materials` answers `401 Unauthorized` for the
 * same bad key. The capabilities path is therefore not a route there — it is
 * being read as a job id — which is the legacy signature, and the 401 on
 * materials confirms the access-code gate is genuinely live rather than absent.
 */
async function detectContract(
  accessCode: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<DeploymentContract> {
  const res = await request({
    method: 'GET',
    path: '/api/generate-classroom/capabilities',
    accessCode,
    timeoutMs: TIMEOUTS.healthMs,
    ...(signal ? { signal } : {}),
    fetchImpl,
  });

  if (res.status === 200) {
    await res.body?.cancel().catch(() => {});
    return 'modern_materials';
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    return 'legacy_pdf_content';
  }
  // Everything else: read-and-discard so the connection is released, then refuse.
  await readBounded(res, LIMITS.maxErrorBytes, 'Capabilities probe').catch(() => '');
  if (res.status === 401 || res.status === 403) {
    throw new OpenMaicError('auth', 'OpenMAIC rejected the access code before the deployment could be identified.', {
      status: res.status,
    });
  }
  throw new OpenMaicError(
    'http',
    `Could not determine which OpenMAIC generation contract this deployment uses (HTTP ${res.status}).`,
    { status: res.status },
  );
}

/** One PDF -> bounded `{ text, images }`. */
async function parsePdf(
  pdf: { name: string; data: Uint8Array },
  accessCode: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<{ text: string; images: string[] }> {
  const form = new FormData();
  const view = new Uint8Array(pdf.data);
  // `Blob` + filename in `append` produces a multipart part named `pdf` with a
  // filename, which is exactly what `/api/parse-pdf` reads.
  form.append('pdf', new Blob([view], { type: 'application/pdf' }), pdf.name);

  const res = await request({
    method: 'POST',
    path: '/api/parse-pdf',
    accessCode,
    timeoutMs: TIMEOUTS.parsePdfMs,
    ...(signal ? { signal } : {}),
    fetchImpl,
    body: form,
  });
  if (!res.ok) {
    await readBounded(res, LIMITS.maxErrorBytes, 'Parse response').catch(() => '');
    throw new OpenMaicError('parse_failed', `OpenMAIC could not read "${truncateForMessage(pdf.name)}".`, {
      status: res.status,
    });
  }
  const body = (await readJson(res, 'Parse response')) as {
    success?: unknown;
    error?: unknown;
    data?: unknown;
    // The envelope has moved across hosted versions, so a bare
    // `{ text, images }` is also accepted — but only as a well-formed payload,
    // never as a silent default.
    text?: unknown;
    images?: unknown;
  };

  // An explicit failure is a failure. `{ success: false, error }` means the
  // upload was acknowledged and could not be read; the upload already counted
  // against the user's quota, so pretending it produced "" text and no images
  // would build a classroom from nothing and bill for it.
  if (body && typeof body === 'object' && body.success === false) {
    throw new OpenMaicError(
      'parse_failed',
      `OpenMAIC could not read "${truncateForMessage(pdf.name)}".`,
    );
  }

  // `data` is required when an envelope is present; a flat `{text, images}` is
  // the other accepted shape. Anything else is a malformed response, not a
  // PDF with no extractable content.
  const data =
    body && typeof body === 'object' && 'data' in body
      ? (body as { data: unknown }).data
      : body;

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new OpenMaicError(
      'parse_failed',
      `OpenMAIC returned a parse result for "${truncateForMessage(pdf.name)}" that was not an object.`,
    );
  }

  const text = (data as { text?: unknown }).text;
  const rawImages = (data as { images?: unknown }).images;

  if (typeof text !== 'string') {
    throw new OpenMaicError(
      'parse_failed',
      `OpenMAIC did not return document text for "${truncateForMessage(pdf.name)}".`,
    );
  }
  if (!Array.isArray(rawImages)) {
    throw new OpenMaicError(
      'parse_failed',
      `OpenMAIC did not return an image list for "${truncateForMessage(pdf.name)}".`,
    );
  }

  const images: string[] = [];
  for (const image of rawImages) {
    if (typeof image !== 'string') {
      throw new OpenMaicError(
        'parse_failed',
        `OpenMAIC returned a non-string image entry for "${truncateForMessage(pdf.name)}".`,
      );
    }
    if (!isUsableImageDataUri(image)) {
      throw new OpenMaicError(
        'parse_failed',
        `OpenMAIC returned an image in an unsupported form for "${truncateForMessage(pdf.name)}".`,
      );
    }
    if (image.length > CONTENT_LIMITS.maxImageChars) {
      throw new OpenMaicError(
        'context_too_large',
        `"${truncateForMessage(pdf.name)}" contains an image too large to send. Re-export it at a lower resolution.`,
      );
    }
    images.push(image);
  }
  if (images.length > CONTENT_LIMITS.maxImagesPerPdf) {
    throw new OpenMaicError(
      'context_too_large',
      `"${truncateForMessage(pdf.name)}" contains ${images.length} images; more than ${CONTENT_LIMITS.maxImagesPerPdf} cannot be carried in one classroom.`,
    );
  }

  // Refuse rather than truncate. A PDF the user attached is context they expect
  // the classroom to be built from; dropping pages or characters without saying
  // so would produce a worse classroom and still bill them for it.
  if (text.length > CONTENT_LIMITS.maxTextCharsPerPdf) {
    throw new OpenMaicError(
      'context_too_large',
      `"${truncateForMessage(pdf.name)}" extracts to more text than a single classroom can carry. Split it into smaller documents.`,
    );
  }

  // An empty extraction means the parse itself failed — a document that yields
  // neither text nor an image is not a valid input, and sending it onward bills
  // for a generic classroom. An image-only PDF (`text === ''` with images) is
  // legitimate: locally converted image PDFs carry no extractable text at all.
  if (text.trim() === '' && images.length === 0) {
    throw new OpenMaicError(
      'parse_failed',
      `OpenMAIC extracted no text and no images from "${truncateForMessage(pdf.name)}".`,
    );
  }

  return { text, images };
}

/**
 * Only raster data URIs with an actual base64 payload may be forwarded as
 * classroom images. SVG, HTML, JS and remote URLs are refused: an SVG or JS
 * document the server renders back to the user is an XSS carrier, and a remote
 * URL would make the server fetch a caller-influenced address.
 */
const ALLOWED_IMAGE_DATA_URI = /^data:image\/(png|jpe?g|webp|gif|bmp|tiff?|avif);base64,([A-Za-z0-9+/]+={0,2})$/i;

function isUsableImageDataUri(value: string): boolean {
  const match = ALLOWED_IMAGE_DATA_URI.exec(value);
  return match !== null && match[2].length > 0;
}

/**
 * Merge the per-PDF parses into the single `pdfContent` document the legacy
 * route accepts.
 *
 * Throws rather than clips. The aggregate ceilings are the last chance to notice
 * that five individually-fine documents are collectively too big, and this runs
 * BEFORE the generation POST — so refusing here means the user is never billed
 * for a classroom built from a subset of what they attached.
 */
function aggregatePdfContent(perPdf: Array<{ name: string; text: string; images: string[] }>): {
  text: string;
  images: string[];
} {
  const blocks: string[] = [];
  const images: string[] = [];
  let textChars = 0;

  for (const parsed of perPdf) {
    if (parsed.text) {
      const block = `## ${truncateForMessage(parsed.name)}\n\n${parsed.text}`;
      textChars += block.length;
      blocks.push(block);
    }
    for (const image of parsed.images) images.push(image);
  }

  if (textChars > CONTENT_LIMITS.maxTextCharsTotal) {
    throw new OpenMaicError(
      'context_too_large',
      `These documents extract to ${textChars.toLocaleString('en-US')} characters of text, over the ${CONTENT_LIMITS.maxTextCharsTotal.toLocaleString('en-US')} a single classroom can carry. Attach fewer, or shorter, documents.`,
    );
  }
  if (images.length > CONTENT_LIMITS.maxImagesTotal) {
    throw new OpenMaicError(
      'context_too_large',
      `These documents contain ${images.length} images; more than ${CONTENT_LIMITS.maxImagesTotal} cannot be carried in one classroom.`,
    );
  }

  return { text: blocks.join('\n\n'), images };
}

/** Filenames appear in our own progress text, so keep them short and inert. */
function truncateForMessage(name: string): string {
  const base = typeof name === 'string' ? name.split(/[\\/]/).pop() ?? '' : '';
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64) || 'document';
}

// ── input validation ──────────────────────────────────────────────────────

function validateRequirement(requirement: string): string {
  const text = typeof requirement === 'string' ? requirement.trim() : '';
  if (text === '') throw new OpenMaicError('invalid_input', 'A requirement is required.');
  if (text.length > LIMITS.maxRequirementChars) {
    throw new OpenMaicError('invalid_input', 'The requirement is too long.');
  }
  return text;
}

function validatePdfs(pdfs: Array<{ name: string; data: Uint8Array }>): Array<{ name: string; data: Uint8Array }> {
  const list = Array.isArray(pdfs) ? pdfs : [];
  if (list.length === 0) return [];
  if (list.length > LIMITS.maxPdfs) {
    throw new OpenMaicError('invalid_input', `At most ${LIMITS.maxPdfs} PDFs are supported.`);
  }
  let total = 0;
  for (const pdf of list) {
    if (!pdf || typeof pdf.name !== 'string' || pdf.name === '') {
      throw new OpenMaicError('invalid_input', 'Each PDF needs a file name.');
    }
    if (!(pdf.data instanceof Uint8Array)) {
      throw new OpenMaicError('invalid_input', 'Each PDF needs a byte array.');
    }
    if (pdf.data.byteLength === 0) {
      throw new OpenMaicError('invalid_input', `"${truncateForMessage(pdf.name)}" is empty.`);
    }
    if (pdf.data.byteLength > LIMITS.maxPdfBytes) {
      throw new OpenMaicError('invalid_input', `"${truncateForMessage(pdf.name)}" is larger than the per-file limit.`);
    }
    total += pdf.data.byteLength;
  }
  if (total > LIMITS.maxTotalPdfBytes) {
    throw new OpenMaicError('invalid_input', 'The PDFs exceed the total size limit.');
  }
  return list;
}

// ── public API ────────────────────────────────────────────────────────────

export interface OpenMaicPdf {
  name: string;
  data: Uint8Array;
}

export interface CreateOpenMaicOptions {
  signal?: AbortSignal;
  /** Injected for tests and for a caller that owns its own transport. */
  fetch?: typeof fetch;
  onProgress?: (message: string) => void;
  /**
   * TEST-ONLY. Collapses the 5s poll floor and the 20-minute deadline so the
   * suite does not have to wait out real time.
   *
   * The double underscore is deliberate: this is a seam for the tests in
   * `test/openmaic.test.cjs` and is not part of the supported surface. There is
   * no reason for a caller to set it, and the 5s floor and 20-minute deadline
   * exist precisely so a job cannot be busy-polled or polled forever — a caller
   * that found a way to defeat them would be reintroducing the failure mode this
   * module is built to prevent. Production code must not pass it.
   *
   * @internal
   */
  __testTiming?: { minPollIntervalMs?: number; maxPollIntervalMs?: number; deadlineMs?: number };
}

/**
 * Strip the test-only timing seam from an options object.
 *
 * `createOpenMaicClassroom` accepts `__testTiming` so the suite does not have to
 * wait out a 5-second poll floor and a 20-minute deadline. It must never be
 * reachable from the renderer or from any IPC handler, because a caller that
 * could set it could defeat the two guards that stop a job being busy-polled or
 * polled indefinitely.
 *
 * `createOpenMaicClassroom` applies this itself, so tests can pass the option
 * directly. The main-process IPC wrappers must call this on any options object
 * that arrived from outside the process — it is exported so they can, and so a
 * test can assert the guarantee holds.
 *
 * @internal
 */
export function withoutTestTiming<T extends CreateOpenMaicOptions>(options: T): T {
  if (options && typeof options === 'object' && '__testTiming' in options) {
    const { __testTiming: _ignored, ...rest } = options;
    return rest as T;
  }
  return options;
}

export interface OpenMaicClassroom {
  jobId: string;
  url: string;
}

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/**
 * Generate one classroom on the hosted instance and resolve when it is ready.
 *
 * Topic-only when `pdfs` is empty. When PDFs are supplied they are parsed here
 * and aggregated into a single bounded `pdfContent` — the hosted contract takes
 * exactly one document, so N files become one merged payload.
 *
 * Resolves only on `succeeded`, with a validated, on-origin classroom URL.
 * Rejects on `failed`, on the 20-minute deadline, on cancellation, or on any
 * unsafe response.
 */
export async function createOpenMaicClassroom(
  input: { requirement: string; pdfs: OpenMaicPdf[] },
  accessCode: string,
  options: CreateOpenMaicOptions = {},
): Promise<OpenMaicClassroom> {
  const requirement = validateRequirement(input?.requirement);
  const pdfs = validatePdfs(input?.pdfs);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new OpenMaicError('invalid_input', 'No fetch implementation is available.');
  }
  const signal = options.signal;
  const progress = options.onProgress;

  // The access code is trimmed and length-bounded but NEVER logged or echoed. A
  // blank code is allowed through so `/api/health` can run unauthenticated; the
  // submission then fails as a 401 rather than throwing a shape error.
  const code = typeof accessCode === 'string' ? accessCode.trim() : '';
  if (code.length > 512) {
    throw new OpenMaicError('invalid_input', 'The access code is not a valid shape.');
  }

  // `__testTiming` is honoured only here, and only because a test calls THIS
  // function directly. Nothing outside the process calls this function — the
  // renderer goes through an IPC handler, and that handler must run its options
  // through `withoutTestTiming` before calling, which is what keeps the seam
  // unreachable from outside. See that function.
  const testTiming = options.__testTiming;
  const minPollIntervalMs = testTiming?.minPollIntervalMs ?? TIMEOUTS.minPollIntervalMs;
  const maxPollIntervalMs = testTiming?.maxPollIntervalMs ?? TIMEOUTS.maxPollIntervalMs;
  const deadline = Date.now() + (testTiming?.deadlineMs ?? TIMEOUTS.deadlineMs);
  const remaining = () => Math.max(0, deadline - Date.now());

  try {
    progress?.('Checking OpenMAIC capabilities…');
    const capabilities = await readHealth(code, signal, fetchImpl);

    // Which contract this deployment speaks, decided before anything is
    // uploaded. See `detectContract` for why this is a probe and not a constant.
    progress?.('Identifying the OpenMAIC deployment…');
    const contract = await detectContract(code, signal, fetchImpl);

    // Optional features are decided here, once, and only downward. TTS is asked
    // for only when the server says it can produce it; the other three are never
    // requested at all.
    //
    // These flags are LEGACY-ONLY. On the modern contract the request takes
    // exactly `{ requirement, materialIds? }`, optional features follow the
    // server's own configuration, and anything else is ignored — so they are
    // omitted rather than sent as no-ops.
    const enableTTS = capabilities.tts && contract === 'legacy_pdf_content' ? { enableTTS: true } : {};

    let pdfContent: { text: string; images: string[] } | undefined;
    if (pdfs.length > 0) {
      // Fail closed BEFORE the upload. The modern route answers
      // `400 INVALID_REQUEST` to a `pdfContent` body, so uploading first and
      // discovering that afterwards would spend a parse (and the user's bytes on
      // someone's server) on a request that cannot succeed. `materialIds` is not
      // implemented here: it needs the owner-scoped upload lifecycle and the
      // material library, which is a different contract with a different
      // cleanup story, and guessing it would be worse than declining.
      if (contract === 'modern_materials') {
        throw new OpenMaicError(
          'unsupported_deployment',
          'This OpenMAIC deployment uses the newer materialIds contract, which this adapter does not implement yet. Generate from a topic only, or attach your documents on the OpenMAIC site.',
        );
      }

      const perPdf: Array<{ name: string; text: string; images: string[] }> = [];
      for (const [index, pdf] of pdfs.entries()) {
        progress?.(`Reading PDF ${index + 1} of ${pdfs.length}: ${truncateForMessage(pdf.name)}…`);
        const parsed = await parsePdf(pdf, code, signal, fetchImpl);
        perPdf.push({ name: pdf.name, ...parsed });
      }
      // Throws rather than truncating if the combined context is too large, so
      // an over-size request never reaches the billable POST.
      const merged = aggregatePdfContent(perPdf);
      // The legacy route validates `pdfContent` as exactly `{text, images}`;
      // sending an empty object is valid but pointless, so only send when the
      // parse actually produced something.
      if (merged.text !== '' || merged.images.length > 0) pdfContent = merged;
    }

    progress?.('Submitting the classroom generation job…');
    const submitBody = JSON.stringify({
      requirement,
      ...(pdfContent ? { pdfContent } : {}),
      // Legacy-only: built-in teaching agents, not course-specific generated
      // ones. The modern route ignores this.
      ...(contract === 'legacy_pdf_content' ? { agentMode: 'default' } : {}),
      ...enableTTS,
    });

    const submitRes = await request({
      method: 'POST',
      path: '/api/generate-classroom',
      accessCode: code,
      timeoutMs: Math.min(TIMEOUTS.submitMs, remaining() || 1),
      ...(signal ? { signal } : {}),
      fetchImpl,
      body: submitBody,
      headers: { 'content-type': 'application/json' },
    });
    if (!submitRes.ok) {
      await readBounded(submitRes, LIMITS.maxErrorBytes, 'Submit response').catch(() => '');
      throw statusError(submitRes.status, 'Classroom submission');
    }

    const submitted = (await readJson(submitRes, 'Submit response')) as {
      jobId?: unknown;
      runId?: unknown;
      pollUrl?: unknown;
      pollIntervalMs?: unknown;
    };
    // `jobId` on the hosted contract; `runId` is accepted because a mid-version
    // hosted instance names it that way and it is the same value.
    const jobIdRaw = typeof submitted?.jobId === 'string' ? submitted.jobId : submitted?.runId;
    if (typeof jobIdRaw !== 'string' || !SAFE_JOB_ID.test(jobIdRaw)) {
      throw new OpenMaicError('unsafe_response', 'Generation response did not contain a usable job id.');
    }
    const jobId = jobIdRaw;
    const pollUrl = validatePollUrl(submitted?.pollUrl, jobId);

    let interval = clampPollInterval(submitted?.pollIntervalMs, minPollIntervalMs, maxPollIntervalMs);

    // Poll to a terminal state. A 404 is terminal by contract: the server does
    // not know this job for this owner, and resubmitting would burn quota.
    for (;;) {
      if (Date.now() >= deadline) {
        throw new OpenMaicError('deadline', 'Classroom generation did not finish within 20 minutes.', { jobId });
      }
      await sleep(Math.min(interval, remaining()), signal);

      progress?.(`Generating… (${jobId})`);

      const res = await request({
        method: 'GET',
        path: `/api/generate-classroom/${jobId}`,
        accessCode: code,
        timeoutMs: Math.min(TIMEOUTS.pollMs, remaining() || 1),
        ...(signal ? { signal } : {}),
        fetchImpl,
        absoluteUrl: pollUrl,
      });

      if (res.status === 404) {
        await readBounded(res, LIMITS.maxErrorBytes, 'Poll response').catch(() => '');
        throw new OpenMaicError('job_failed', 'OpenMAIC no longer knows this generation job.', {
          status: 404,
          jobId,
        });
      }
      if (!res.ok) {
        await readBounded(res, LIMITS.maxErrorBytes, 'Poll response').catch(() => '');
        throw statusError(res.status, 'Classroom status check');
      }

      const job = (await readJson(res, 'Poll response')) as {
        status?: unknown;
        step?: unknown;
        pollIntervalMs?: unknown;
        result?: { url?: unknown; classroomId?: unknown };
      };

      // Re-hint, but never below our floor.
      interval = clampPollInterval(job?.pollIntervalMs, minPollIntervalMs, maxPollIntervalMs) ?? interval;

      const status = job?.status as JobStatus | undefined;
      if (status === 'succeeded') {
        const rawUrl = typeof job?.result?.url === 'string' ? job.result.url : '';
        const rawId = typeof job?.result?.classroomId === 'string' ? job.result.classroomId : '';
        const candidate = rawUrl !== '' ? rawUrl : rawId;
        if (candidate === '') {
          throw new OpenMaicError('unsafe_response', 'The job succeeded without a classroom link.', { jobId });
        }
        const url = validateClassroomUrl(candidate);
        progress?.('Classroom ready.');
        return { jobId, url };
      }
      if (status === 'failed') {
        // `error` is upstream free text. It is counted, not quoted: the caller
        // gets the job id and can look it up with their own credential.
        throw new OpenMaicError('job_failed', 'Classroom generation failed on the OpenMAIC server.', { jobId });
      }
      if (status !== 'queued' && status !== 'running') {
        throw new OpenMaicError('unsafe_response', 'Generation returned an unexpected job status.', { jobId });
      }
    }
  } catch (err) {
    if (err instanceof OpenMaicError) throw err;
    if (err instanceof Aborted || (err as Error)?.name === 'AbortError') {
      throw new OpenMaicError('aborted', 'Classroom generation was cancelled.');
    }
    throw new OpenMaicError('http', 'Classroom generation could not be completed.');
  }
}

/**
 * Honour the server hint only inside our own floor and ceiling.
 *
 * A malformed or absent hint falls back to the floor rather than to zero — the
 * server's `pollIntervalMs` is remote input, and `pollIntervalMs: 0` would
 * otherwise turn this into a tight loop against a rate-limited endpoint.
 */
function clampPollInterval(
  hint: unknown,
  floorMs: number = TIMEOUTS.minPollIntervalMs,
  ceilingMs: number = TIMEOUTS.maxPollIntervalMs,
): number {
  if (typeof hint !== 'number' || !Number.isFinite(hint) || hint <= 0) {
    return floorMs;
  }
  return Math.min(ceilingMs, Math.max(floorMs, hint));
}
