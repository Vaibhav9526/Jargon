'use strict';

// Composer-side coverage for teach mode: @teach-me / @teacher drafts route to
// the Teacher agent, open the hosted learning site in the Jargon Teaching
// window over IPC (manual flow — the user signs in, uploads and presses
// Generate there themselves), then park the topic + file paths on the
// Teacher's own queue. There is no access-code gate: the send must never call
// teachingStatus, teachingSetAccessCode or a code prompt. The parser +
// teacher matcher itself lives in teaching-routing.test.cjs.
//
// The component module is transpiled straight from source and every import
// except the REAL @shared/teaching is stubbed — the component function is never
// invoked, only the exported sendTeachingDraft seam is driven with injected
// handlers (no live provider, no PTY, no DOM).

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const loadTs = require('./load-ts.cjs');

const composerPath = 'src/renderer/src/components/MessageQueueComposer.tsx';
const dialogPath = 'src/renderer/src/components/TeachingAccessDialog.tsx';

const composer = (() => {
  const output = ts.transpileModule(readFileSync(composerPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX
    },
    fileName: composerPath
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output)(module, module.exports, (request) => {
    if (request === '@shared/teaching') return loadTs('src/shared/teaching.ts');
    // Everything else (react, store, pixi-side pools, sibling components) is
    // only dereferenced when the component renders — an empty stub loads fine.
    return {};
  });
  return module.exports;
})();

const {
  sendTeachingDraft,
  teachingQueueText,
  teachingQueueInstruction,
  draftAfterSend
} = composer;

const TEACHER = { id: 't-1', name: 'Teacher', character: 'teacher' };
const WORKER = { id: 'w-1', name: 'Casey', character: 'dwight' };
const PDF = { path: 'D:\\docs\\chapter1.pdf', name: 'chapter1.pdf' };
const IMG = { path: 'D:\\shots\\board.png', name: 'board.png' };

/** Injected deps that record every boundary crossing. Behaviour knobs stay
 *  recording — an override swaps the RESULT, never the call log. The legacy
 *  access-code surface is stubbed with counters on purpose: a correct send
 *  must leave all three counts at zero. */
function makeDeps(opts = {}) {
  const calls = {
    status: 0, setCode: 0, open: 0,
    codeArgs: [], openArgs: [],
    enqueued: [], selected: [], trackSent: 0, promptCount: 0
  };
  const deps = {
    agents: opts.agents ?? [TEACHER, WORKER],
    api: {
      teachingStatus: async () => {
        calls.status++;
        return { hasAccessCode: opts.hasAccessCode ?? false };
      },
      teachingSetAccessCode: async (code) => {
        calls.setCode++;
        calls.codeArgs.push(code);
        return { ok: true };
      },
      teachingOpen: async (req) => {
        calls.open++;
        calls.openArgs.push(req);
        if (opts.openImpl) return opts.openImpl(req);
        return opts.openResult ?? { ok: true, jobId: 'job-7' };
      }
    },
    // Not part of the seam's deps — passed anyway so a regression that still
    // consults a code prompt is caught by the count, not silently ignored.
    requestAccessCode: async () => (calls.promptCount++, true),
    enqueue: (agentId, text, meta) => calls.enqueued.push({ agentId, text, meta }),
    select: (id) => calls.selected.push(id),
    trackSent: () => calls.trackSent++
  };
  return { deps, calls };
}

test('ordinary drafts never touch the teaching IPC', async () => {
  for (const text of [
    'refactor the login form',
    'ping me at bob@teacher.com when done',   // @ mid-token is not an alias
    'email teach-me@school.edu the notes',
    '@tutor linear algebra please'            // not one of the two aliases
  ]) {
    const { deps, calls } = makeDeps();
    const outcome = await sendTeachingDraft(text, [], deps);
    assert.equal(outcome.kind, 'ordinary', text);
    assert.equal(calls.status, 0);
    assert.equal(calls.open, 0);
    assert.equal(calls.enqueued.length, 0);
    assert.equal(calls.trackSent, 0);
  }
});

test('@teach-me topic routes to the Teacher and opens the learning site', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await sendTeachingDraft('@teach-me explain photosynthesis', [], deps);
  assert.equal(outcome.kind, 'sent');
  assert.equal(outcome.teacherId, TEACHER.id);
  assert.equal(outcome.jobId, 'job-7');
  assert.equal(calls.open, 1);
  assert.deepEqual(calls.openArgs[0], { topic: 'explain photosynthesis', attachments: [], teacherId: 't-1' });
});

test('a send never consults the access-code surface — no status, set or prompt', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await sendTeachingDraft('@teacher fractions', [PDF], deps);
  assert.equal(outcome.kind, 'sent');
  assert.equal(calls.open, 1);
  assert.equal(calls.status, 0, 'the manual flow never checks for a stored code');
  assert.equal(calls.setCode, 0, 'the manual flow never stores a code');
  assert.deepEqual(calls.codeArgs, []);
  assert.equal(calls.promptCount, 0, 'the manual flow never opens a code prompt');
});

test('@teacher alias is recognised the same way', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await sendTeachingDraft('@teacher the water cycle', [], deps);
  assert.equal(outcome.kind, 'sent');
  assert.equal(calls.openArgs[0].topic, 'the water cycle');
});

test('alias anywhere in the draft is stripped out of the topic', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await sendTeachingDraft('hey, @teach-me cover fractions today', [], deps);
  assert.equal(outcome.kind, 'sent');
  assert.equal(calls.openArgs[0].topic, 'hey,  cover fractions today');
});

test('attachments travel into the open request and the queue context', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await sendTeachingDraft('@teacher quiz me on this', [PDF, IMG], deps);
  assert.equal(outcome.kind, 'sent');
  assert.deepEqual(calls.openArgs[0].attachments, [PDF, IMG]);
  const row = calls.enqueued[0];
  assert.match(row.text, /quiz me on this/);
  assert.match(row.text, /Attached files:/);
  assert.match(row.text, /D:\\docs\\chapter1\.pdf \(chapter1\.pdf\)/);
  assert.match(row.text, /D:\\shots\\board\.png \(board\.png\)/);
  assert.match(row.meta.instruction, /chapter1\.pdf/);
});

test('attachment-only teaching drafts are allowed (no topic)', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await sendTeachingDraft('@teacher', [PDF], deps);
  assert.equal(outcome.kind, 'sent');
  assert.equal(calls.openArgs[0].topic, '');
  assert.deepEqual(calls.openArgs[0].attachments, [PDF]);
});

test('the Teacher gets the queue entry, selection and exactly one send count', async () => {
  const { deps, calls } = makeDeps();
  await sendTeachingDraft('@teacher vectors', [], deps);
  assert.equal(calls.enqueued.length, 1);
  assert.equal(calls.enqueued[0].agentId, TEACHER.id);
  assert.equal(calls.enqueued[0].text, 'vectors');
  assert.deepEqual(calls.selected, [TEACHER.id]);
  assert.equal(calls.trackSent, 1);
});

test('queued instruction describes the manual workspace — no API, no auto-generate', async () => {
  const { deps, calls } = makeDeps();
  await sendTeachingDraft('@teacher vectors', [], deps);
  const instruction = calls.enqueued[0].meta.instruction;
  // The window opened the hosted site; the USER does the manual steps there.
  assert.match(instruction, /opened the hosted learning site/i);
  assert.match(instruction, /Jargon Teaching window/i);
  assert.match(instruction, /signs in/i);
  assert.match(instruction, /pastes the topic/i);
  assert.match(instruction, /uploads the selected materials/i);
  assert.match(instruction, /presses Generate/i);
  assert.match(instruction, /do NOT call the OpenMAIC API/i);
  assert.match(instruction, /auto-generate/i);
  assert.match(instruction, /guide the user/i);
  assert.match(instruction, /Teach the user about: vectors/);
  // teachingOpen only opens the window — nothing may claim a lesson or
  // classroom was generated, completed or is ready.
  assert.doesNotMatch(instruction, /(lesson|classroom|lecture|course) (is |has been |was )?(done|complete[ds]?|ready|generated|created|finished)/i);
  assert.doesNotMatch(instruction, /generation (is )?(done|complete|finished)/i);
  assert.doesNotMatch(calls.enqueued[0].text, /hosted|workspace|Generate|signs in/i,
    'the manual-flow note lives in instruction, not the visible queue text');
});

test('no Teacher on the roster blocks the send before any IPC', async () => {
  const { deps, calls } = makeDeps({ agents: [WORKER] });
  const outcome = await sendTeachingDraft('@teacher fractions', [PDF], deps);
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.error, /Teacher/);
  assert.equal(calls.status, 0);
  assert.equal(calls.open, 0);
  assert.equal(calls.enqueued.length, 0, 'nothing is enqueued — the draft stays');
  assert.equal(calls.trackSent, 0);
});

test('god/assistant agents named Teacher do not satisfy the route', async () => {
  const { deps, calls } = makeDeps({
    agents: [
      { id: 'g', name: 'Teacher', isGod: true },
      { id: 'a', name: 'Teacher', isAssistant: true }
    ]
  });
  const outcome = await sendTeachingDraft('@teacher fractions', [], deps);
  assert.equal(outcome.kind, 'blocked');
  assert.equal(calls.open, 0);
});

test('name-only Teacher (no character) still routes', async () => {
  const { deps, calls } = makeDeps({ agents: [{ id: 'n-1', name: 'teacher' }] });
  const outcome = await sendTeachingDraft('@teacher fractions', [], deps);
  assert.equal(outcome.kind, 'sent');
  assert.equal(calls.openArgs[0].teacherId, 'n-1');
});

test('a rejected open blocks the send and keeps the draft', async () => {
  const { deps, calls } = makeDeps({ openResult: { ok: false, error: 'window failed to load' } });
  const outcome = await sendTeachingDraft('@teacher fractions', [PDF], deps);
  assert.deepEqual(outcome, { kind: 'blocked', error: 'window failed to load' });
  assert.equal(calls.enqueued.length, 0, 'nothing queued — the draft and files stay');
  assert.equal(calls.selected.length, 0);
  assert.equal(calls.trackSent, 0);
});

test('an open failure with no message still keeps the draft on a safe error', async () => {
  const { deps, calls } = makeDeps({ openResult: { ok: false } });
  const outcome = await sendTeachingDraft('@teacher fractions', [], deps);
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.error, /could not be opened/i);
  assert.equal(calls.enqueued.length, 0);
});

test('a throwing bridge degrades to a blocked error, not a crash', async () => {
  const { deps, calls } = makeDeps({ openImpl: () => { throw new Error('cth.teachingOpen is not a function'); } });
  const outcome = await sendTeachingDraft('@teacher fractions', [], deps);
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.error, /teachingOpen/);
  assert.equal(calls.enqueued.length, 0);
});

test('a non-PDF/image attachment blocks the send before any IPC', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await sendTeachingDraft('@teacher run this', [{ path: 'D:\\x\\virus.exe', name: 'virus.exe' }], deps);
  assert.equal(outcome.kind, 'blocked');
  assert.match(outcome.error, /PDF|image/i);
  assert.equal(calls.status, 0);
  assert.equal(calls.open, 0);
});

test('an alias with neither topic nor files blocks before any IPC', async () => {
  const { deps, calls } = makeDeps();
  const outcome = await sendTeachingDraft('@teacher   ', [], deps);
  assert.equal(outcome.kind, 'blocked');
  assert.equal(calls.open, 0);
});

test('the request snapshot ignores edits made after the send started', async () => {
  let resolveOpen;
  const { deps, calls } = makeDeps({
    openImpl: () => new Promise((res) => { resolveOpen = () => res({ ok: true, jobId: 'j' }); })
  });
  const sent = sendTeachingDraft('@teacher original topic', [PDF], deps);
  // The user keeps typing while the request is in flight — irrelevant to it.
  await new Promise((r) => setImmediate(r));
  resolveOpen();
  const outcome = await sent;
  assert.equal(outcome.kind, 'sent');
  assert.equal(calls.openArgs[0].topic, 'original topic');
});

test('teachingQueueText keeps the raw topic and path context', () => {
  assert.equal(
    teachingQueueText({ topic: 'recursion', attachments: [PDF] }),
    'recursion\n\nAttached files:\n- D:\\docs\\chapter1.pdf (chapter1.pdf)'
  );
  assert.equal(teachingQueueText({ topic: '', attachments: [PDF] }), 'Attached files:\n- D:\\docs\\chapter1.pdf (chapter1.pdf)');
  assert.equal(teachingQueueText({ topic: 'recursion', attachments: [] }), 'recursion');
});

test('draftAfterSend clears the sent draft but keeps text appended mid-flight', () => {
  assert.equal(draftAfterSend('@teacher vectors', '@teacher vectors'), '');
  assert.equal(draftAfterSend('@teacher vectors\nnew dictation line', '@teacher vectors'), 'new dictation line');
  assert.equal(draftAfterSend('totally rewritten draft', '@teacher vectors'), 'totally rewritten draft');
});

// --- Source-level checks for the parts the pure seam can't reach: the
// component wiring and the repurposed provider-details dialog. ---------------

const composerSrc = readFileSync(composerPath, 'utf8');
const dialogSrc = readFileSync(dialogPath, 'utf8');

test('the composer has no access-code path at all', () => {
  assert.doesNotMatch(composerSrc, /teachingStatus|teachingSetAccessCode|hasAccessCode/,
    'the send never checks or stores a code');
  assert.doesNotMatch(composerSrc, /requestAccessCode|accessCodePrompt|askForAccessCode|settleAccessCode|openAccessSetup/,
    'no pending-prompt machinery survives');
  assert.doesNotMatch(composerSrc, /kind: 'cancelled'/, 'nothing in the send flow is cancellable by a dialog');
  // The double-click guard is still what makes the async handoff safe.
  assert.match(composerSrc, /disabled=\{!canSend \|\| teachingBusy\}/);
  assert.match(composerSrc, /teachingBusyRef\.current = true/);
  // A blocked send keeps the draft — the only outcome that clears it is 'sent'.
  const queueIt = composerSrc.slice(composerSrc.indexOf('const queueIt'));
  assert.doesNotMatch(
    queueIt.slice(queueIt.indexOf("'blocked'"), queueIt.indexOf('} finally')),
    /setText|setAttachments/,
    'the blocked branch reports the error but never clears the draft or files'
  );
});

test('the disclosure is Jargon-branded, describes the manual flow, and cannot send', () => {
  const disclosure = composerSrc.slice(
    composerSrc.indexOf('teachAliasSeen && ('),
    composerSrc.indexOf('{teachError && (')
  );
  assert.match(disclosure, /Teaching draft/);
  assert.match(disclosure, /Jargon Teaching\s+window/, 'the window is Jargon-branded chrome');
  assert.match(disclosure, /paste the topic/);
  assert.match(disclosure, /press Generate/);
  assert.match(disclosure, /no access code/i, 'says no API access code is involved');
  assert.match(disclosure, /account, quota or charges may apply/i, 'honest about provider account/quota');
  assert.match(disclosure, /Provider details/, 'the help action exists');
  // The provider's decorative name belongs in the details dialog, not the hint.
  assert.doesNotMatch(disclosure, /OpenMAIC|maic\.chat/i);
  assert.doesNotMatch(disclosure, /free/i, 'no free-usage promise');
  // Opening details is purely informational — it never arms or fires a send.
  assert.match(disclosure, /setProviderInfoOpen\(true\)/);
  assert.doesNotMatch(disclosure, /queueIt|sendTeachingDraft|teachingOpen/);
  assert.match(composerSrc, /<TeachingAccessDialog\s+onClose=\{closeProviderInfo\}/);
});

test('the provider dialog is informational only — no code entry, no storage', () => {
  assert.match(dialogSrc, /PROVIDER DETAILS/, 'repurposed as the provider-details dialog');
  assert.match(dialogSrc, /OpenMAIC/);
  // The official link always goes through the validating bridge, never a raw href.
  assert.match(dialogSrc, /window\.cth\.openExternal\('https:\/\/open\.maic\.chat\/'\)/);
  assert.match(dialogSrc, /preventDefault\(\)/);
  assert.match(dialogSrc, /key === 'Escape'.*onClose\(\)/, 'Escape dismisses');
  assert.doesNotMatch(dialogSrc, /type="password"|<input|saveCode|onDone|access code must|sk-/i,
    'no credential field or save path survives');
  // No pricing claim — the provider's account/quota are its own.
  assert.doesNotMatch(dialogSrc, /free/i);
  // Nothing is logged or persisted by the renderer.
  assert.doesNotMatch(dialogSrc, /console\.(log|warn|error|info)/);
  assert.doesNotMatch(dialogSrc, /localStorage|sessionStorage|setDraft|teachingSetAccessCode|teachingStatus/);
});
