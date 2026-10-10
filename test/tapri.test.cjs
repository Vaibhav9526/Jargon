'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const shared = loadTs('src/shared/tapri.ts');
const sim = loadTs('src/renderer/src/tapri/sim.ts');
const { createEngine } = loadTs('src/renderer/src/tapri/engine.ts');

const { parseTalkResponse, buildTalkPrompt, buildSummaryPrompt, parseSummaryResponse, TAPRI_CLIS, TAPRI_CAST, readingMs } = shared;

/* ── script protocol ─────────────────────────────────────────────────────── */

test('parseTalkResponse reads fenced JSON and drops speakers who are not here', () => {
  const raw = 'Sure!\n```json\n' + JSON.stringify({
    turns: [
      { speaker: 'sharma', text: 'Arre, petrol phir mehenga!', reactions: { bhola: 'wow', ghost: 'wow', sharma: 'wow' } },
      { speaker: 'nobody', text: 'x', reactions: {} },
      { speaker: 'bhola', text: '   ', reactions: {} },
    ],
    summary: ['Petrol prices'], leaves: ['bhola', 'ghost'],
  }) + '\n```';
  const r = parseTalkResponse(raw, ['sharma', 'bhola']);
  assert.equal(r.turns.length, 1);
  assert.deepEqual(r.turns[0].reactions, { bhola: 'wow' });
  assert.deepEqual(r.leaves, ['bhola']);
  assert.deepEqual(r.summary, ['Petrol prices']);
});

test('parseTalkResponse survives braces inside strings and rejects non-answers', () => {
  const ok = parseTalkResponse('{"turns":[{"speaker":"a","text":"hi } there { x","reactions":{}}],"summary":[]}', ['a']);
  assert.equal(ok.turns[0].text, 'hi } there { x');
  assert.equal(parseTalkResponse('no json at all', ['a']), null);
  assert.equal(parseTalkResponse('{"turns":[]}', ['a']), null);
  assert.equal(parseTalkResponse('{"turns":"nope"}', ['a']), null);
});

test('buildTalkPrompt names every present speaker and forbids writing lines for the user', () => {
  const p = buildTalkPrompt({ cli: 'claude', language: 'en', present: ['chhotu', 'sharma'], history: [], summary: ['a'], userSaid: 'metro vs car?' });
  assert.match(p, /chhotu/);
  assert.match(p, /Sharma ji/);
  assert.match(p, /Never write lines for Vaibhav/);
  assert.match(p, /metro vs car\?/);
  assert.ok(!/\bME\b/.test(p), 'the user is addressed by name, never as ME');
});

test('every CLI takes its prompt on stdin: no argv slot for user text', () => {
  for (const c of TAPRI_CLIS) {
    assert.ok(!c.args.some((a) => a.includes('{prompt}')), c.id);
  }
  assert.equal(new Set(TAPRI_CAST.map((c) => c.id)).size, TAPRI_CAST.length);
});

test('readingMs is bounded', () => {
  assert.ok(readingMs('') >= 1000);
  assert.equal(readingMs('x'.repeat(5000)), 9000);
});

/* ── world ───────────────────────────────────────────────────────────────── */

const style = { outfit: 'kurta', variant: 1 };
const run = (w, ms) => { for (let t = 0; t < ms; t += 50) sim.tick(w, 50); };

test('a walk-in patron ends up seated and facing the table', () => {
  const w = sim.createWorld(7, { ambient: false });
  const p = sim.spawnPatron(w, { id: 'pappu', name: 'Pappu', style }, 'walk');
  assert.ok(p);
  run(w, 30000);
  assert.equal(p.mode, 'seated');
  assert.equal(p.pose, 'sit');
  assert.ok(sim.seatTaken(w, p.seatId));
});

test('an auto drops the patron at the kerb, then they walk to a seat', () => {
  const w = sim.createWorld(11, { ambient: false });
  const p = sim.spawnPatron(w, { id: 'gopal', name: 'Gopal', style }, 'auto');
  assert.equal(p.mode, 'hidden');
  run(w, 40000);
  assert.equal(p.mode, 'seated');
  assert.ok(w.vehicles.every((v) => v.drop !== 'gopal'));
});

test('two patrons never share a seat; a full tapri turns people away', () => {
  const w = sim.createWorld(3, { ambient: false });
  const ids = TAPRI_CAST.filter((c) => c.id !== 'chhotu');
  let got = 0;
  for (const c of ids) if (sim.spawnPatron(w, { id: c.id, name: c.name, style }, 'walk')) got++;
  const seats = w.people.filter((p) => p.seatId).map((p) => p.seatId);
  assert.equal(new Set(seats).size, seats.length);
  assert.ok(got >= 1);
});

test('anger builds on furious/hating and trips the limit; calm lines cool it', () => {
  const w = sim.createWorld(5, { ambient: false });
  sim.spawnPatron(w, { id: 'bhola', name: 'Bhola', style }, 'walk');
  run(w, 30000);
  assert.equal(sim.react(w, 'bhola', 'hating'), false);
  assert.equal(sim.react(w, 'bhola', 'interested'), false);
  assert.equal(sim.react(w, 'bhola', 'furious'), false);
  assert.equal(sim.react(w, 'bhola', 'furious'), true);
});

test('sendAway frees the seat, walks them off and removes them; cab takes them away', () => {
  const w = sim.createWorld(9, { ambient: false });
  sim.spawnPatron(w, { id: 'pappu', name: 'Pappu', style }, 'walk');
  sim.spawnPatron(w, { id: 'gopal', name: 'Gopal', style }, 'walk');
  run(w, 30000);
  const seat = sim.personById(w, 'pappu').seatId;
  assert.ok(sim.sendAway(w, 'pappu', 'walk'));
  assert.equal(sim.seatTaken(w, seat), false);
  assert.ok(sim.sendAway(w, 'gopal', 'cab'));
  run(w, 60000);
  assert.equal(sim.personById(w, 'pappu'), undefined);
  assert.equal(sim.personById(w, 'gopal'), undefined);
  assert.equal(w.vehicles.length, 0);
});

test('ambient traffic spawns, stays on the road, and cleans up', () => {
  const w = sim.createWorld(2, { ambient: true });
  run(w, 60000);
  assert.ok(w.vehicles.length + w.people.length > 2);
  for (const v of w.vehicles) assert.ok(v.y === sim.LANE_NEAR || v.y === sim.LANE_FAR);
  assert.ok(w.vehicles.length < 14);
});

/* ── director ────────────────────────────────────────────────────────────── */

function director(round, opts = {}) {
  const w = sim.createWorld(4, { ambient: false });
  const calls = [];
  const summaries = [];
  let summaryReply = () => ({ ok: true, summary: ['Fresh summary'] });
  const eng = createEngine({
    world: () => w,
    talk: async (req) => { calls.push(req); return round(req); },
    speak: async () => ({ ok: false, error: 'no key', code: 'no_key' }),
    settle: async () => undefined, // no real waiting in tests
    summarize: async (req) => { summaries.push(req); return summaryReply(req); },
  }, opts);
  return { w, eng, calls, summaries, setSummary: (f) => { summaryReply = f; } };
}

test('a user line reaches the CLI with who is present, and the reply updates the summary', async () => {
  const { w, eng, calls } = director(async () => ({ ok: true, round: {
    turns: [{ speaker: 'sharma', text: 'Sahi baat!', reactions: { chhotu: 'laughing' } }],
    summary: ['Metro vs car'], leaves: [],
  } }));
  sim.spawnPatron(w, { id: 'sharma', name: 'Sharma', style }, 'walk');
  run(w, 30000);
  eng.start();
  await eng.userSays('Metro better hai ya car?');
  assert.deepEqual(calls[0].present.sort(), ['chhotu', 'sharma']);
  assert.equal(calls[0].userSaid, 'Metro better hai ya car?');
  assert.deepEqual(eng.state().summary, ['Metro vs car']);
  assert.equal(eng.state().lines.at(-1).speaker, 'sharma');
  assert.equal(eng.state().busy, false);
});

test('someone pushed past the limit stands up and storms off', async () => {
  const furious = async () => ({ ok: true, round: {
    turns: [{ speaker: 'sharma', text: 'Tum log galat ho!', reactions: { bhola: 'furious' } }],
    summary: [], leaves: [],
  } });
  const { w, eng } = director(furious);
  sim.spawnPatron(w, { id: 'sharma', name: 'Sharma', style }, 'walk');
  sim.spawnPatron(w, { id: 'bhola', name: 'Bhola', style }, 'walk');
  run(w, 30000);
  eng.start();
  await eng.userSays('ek aur baat');
  assert.equal(sim.personById(w, 'bhola').leaving, false);
  await eng.userSays('aur ek');
  assert.equal(sim.personById(w, 'bhola').leaving, true);
  run(w, 60000);
  assert.equal(sim.personById(w, 'bhola'), undefined);
  assert.ok(eng.state().lines.some((l) => l.text.includes('storms off')));
});

test('a CLI failure surfaces the error and stops auto-chat from hammering it', async () => {
  const { w, eng, calls } = director(async () => ({ ok: false, error: 'Claude Code CLI was not found.', missing: true }));
  sim.spawnPatron(w, { id: 'sharma', name: 'Sharma', style }, 'walk');
  run(w, 30000);
  eng.start();
  await eng.startTopic('india');
  assert.match(eng.state().error, /not found/);
  w.t += 60000;
  eng.step();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 1);
});

/* ── language, summary button, speed ─────────────────────────────────────── */

test('the prompt asks for plain English or pure Hindi, never Hinglish, and skips the summary', () => {
  const base = { cli: 'claude', present: ['chhotu', 'sharma'], history: [], summary: [] };
  const en = buildTalkPrompt({ ...base, language: 'en' });
  const hi = buildTalkPrompt({ ...base, language: 'hi' });
  assert.match(en, /No Hindi words, no Hinglish/);
  assert.match(hi, /Devanagari/);
  assert.match(hi, /no Hinglish/);
  assert.ok(!/Hinglish in Roman/.test(en + hi));
  assert.ok(!/"summary":\[/.test(en), 'summary is no longer part of the chat call');
  assert.match(en, /Exactly 2 lines/);
  assert.match(en, /JSON Lines/);
});

test('summary prompt/response round-trip', () => {
  const p = buildSummaryPrompt([{ speaker: 'me', text: 'hello' }, { speaker: 'sharma', text: 'namaste' }], ['old'], 'hi');
  assert.match(p, /वैभव: hello/);
  assert.match(p, /Devanagari/);
  assert.deepEqual(parseSummaryResponse('```json\n{"summary":["a","b"]}\n```'), ['a', 'b']);
  assert.equal(parseSummaryResponse('{"summary":[]}'), null);
  assert.equal(parseSummaryResponse('nope'), null);
});

test('chat request carries the chosen language; Summarize makes one CLI call on demand', async () => {
  const { w, eng, calls, summaries } = director(async () => ({ ok: true, round: {
    turns: [{ speaker: 'sharma', text: 'ठीक है', reactions: {} }], summary: [], leaves: [],
  } }), { language: 'hi' });
  sim.spawnPatron(w, { id: 'sharma', name: 'Sharma', style }, 'walk');
  run(w, 30000);
  eng.start();
  await eng.userSays('नमस्ते');
  assert.equal(calls[0].language, 'hi');
  assert.equal(summaries.length, 0, 'no summary call during chat');
  assert.ok(eng.state().summary.length > 0, 'a free local summary still exists');
  await eng.summarize();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].language, 'hi');
  assert.deepEqual(eng.state().summary, ['Fresh summary']);
});

test('the table reacts the instant the user speaks, before the CLI answers', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { w, eng } = director(async () => { await gate; return { ok: true, round: { turns: [{ speaker: 'sharma', text: 'ok', reactions: {} }], summary: [], leaves: [] } }; });
  sim.spawnPatron(w, { id: 'sharma', name: 'Sharma', style }, 'walk');
  run(w, 30000);
  eng.start();
  const pending = eng.userSays('hello');
  await new Promise((r) => setTimeout(r, 5));
  assert.notEqual(sim.personById(w, 'sharma').mood, 'neutral');
  release();
  await pending;
});

test('voices are all requested before the first line finishes playing', async () => {
  const requested = [];
  const w = sim.createWorld(4, { ambient: false });
  const eng = createEngine({
    world: () => w,
    talk: async () => ({ ok: true, round: { turns: [
      { speaker: 'sharma', text: 'one', reactions: {} }, { speaker: 'sharma', text: 'two', reactions: {} },
    ], summary: [], leaves: [] } }),
    speak: async (sp, text) => { requested.push(text); return { ok: true, start() {}, stop() {} }; },
    settle: async () => { assert.equal(requested.length, 2, 'both fetched before line one is settled'); },
    summarize: async () => ({ ok: true, summary: [] }),
  }, { voice: true });
  sim.spawnPatron(w, { id: 'sharma', name: 'Sharma', style }, 'walk');
  run(w, 30000);
  eng.start();
  await eng.userSays('hi');
});

test('streamed lines start playing before the CLI has finished', async () => {
  const w = sim.createWorld(4, { ambient: false });
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const eng = createEngine({
    world: () => w,
    talk: async (req, onTurn) => {
      onTurn({ speaker: 'sharma', text: 'पहली बात', reactions: {} });
      await gate;                                    // CLI still writing line two
      return { ok: true, round: { turns: [
        { speaker: 'sharma', text: 'पहली बात', reactions: {} }, { speaker: 'meena', text: 'दूसरी बात', reactions: {} },
      ], summary: [], leaves: [] } };
    },
    speak: async () => ({ ok: false }),
    settle: async () => { order.push('settled:' + eng.state().lines.length); if (order.length === 1) release(); },
    summarize: async () => ({ ok: true, summary: [] }),
  });
  sim.spawnPatron(w, { id: 'sharma', name: 'Sharma', style }, 'walk');
  sim.spawnPatron(w, { id: 'meena', name: 'Meena', style }, 'walk');
  run(w, 30000);
  eng.start();
  await eng.startTopic('india');
  assert.deepEqual(eng.state().lines.map((l) => l.text), ['पहली बात', 'दूसरी बात']);
  assert.equal(order[0], 'settled:1', 'line one was played while the CLI was still working');
});

test('Hindi is the default and everyone calls the user Vaibhav (वैभव)', () => {
  const p = buildTalkPrompt({ cli: 'claude', present: ['chhotu', 'sharma'], history: [{ speaker: 'me', text: 'नमस्ते' }], summary: [] });
  assert.match(p, /Devanagari/);
  assert.match(p, /वैभव जी/);
  assert.match(p, /वैभव: नमस्ते/);
  assert.equal(shared.DEFAULT_LANGUAGE, 'hi');
  assert.equal(shared.USER_NAME, 'Vaibhav');
});

test('parseTalkResponse reads JSON Lines and the final leaves marker; parseTurnLine rejects strangers', () => {
  const raw = [
    '{"speaker":"sharma","text":"पहली","reactions":{"meena":"wow"}}',
    'chatter the model should not have written',
    '{"speaker":"ghost","text":"x","reactions":{}}',
    '{"speaker":"meena","text":"दूसरी","reactions":{}}',
    '{"leaves":["meena","ghost"]}',
  ].join('\n');
  const r = parseTalkResponse(raw, ['sharma', 'meena']);
  assert.deepEqual(r.turns.map((t) => t.text), ['पहली', 'दूसरी']);
  assert.deepEqual(r.leaves, ['meena']);
  assert.equal(shared.parseTurnLine('{"speaker":"ghost","text":"x"}', ['sharma']), null);
  assert.equal(shared.parseTurnLine('{"speaker":"sharma","tex', ['sharma']), null, 'a half-written line is not a turn yet');
});

test('Claude is configured for streaming with a model that does not think first', () => {
  const c = TAPRI_CLIS.find((x) => x.id === 'claude');
  assert.equal(c.stream, 'claude');
  assert.ok(c.args.includes('stream-json'));
  assert.ok(!c.args.includes('haiku'), 'Haiku spends seconds thinking before it answers');
});
