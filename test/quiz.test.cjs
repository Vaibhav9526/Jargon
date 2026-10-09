'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { buildQuizPrompt, buildReportPrompt, parseQuiz, gradeQuiz, parseReport, reportToMarkdown, youtubeSearchUrl, webSearchUrl } = loadTs('src/main/quiz.ts');

const q = (i, answer = 1, concept = 'Fractions') => ({
  q: `Question ${i}?`, options: [`a${i}`, `b${i}`, `c${i}`, `d${i}`], answer, explanation: `because ${i}`, concept,
});
const quizJson = (n = 5) => JSON.stringify({ topic: 'Fractions', questions: Array.from({ length: n }, (_, i) => q(i + 1, i % 4, i < 3 ? 'Unlike denominators' : 'Simplifying')) });

test('quiz prompt carries the doubt, asks for 4 options/1 answer, and fences the context as data', () => {
  const p = buildQuizPrompt('I do not get adding 1/2 + 1/3', [{ role: 'user', text: 'help with fractions' }], 5);
  assert.match(p, /exactly 5 multiple-choice/);
  assert.match(p, /exactly 4 options/);
  assert.match(p, /DATA describing what to test/);
  assert.match(p, /adding 1\/2 \+ 1\/3/);
  assert.match(p, /Student: help with fractions/);
  assert.match(buildQuizPrompt('x', [], 99), /exactly 10 /);
  assert.match(buildQuizPrompt('x', [], 0), /exactly 5 /);
});

test('parseQuiz accepts a well-formed quiz, also inside fences or chatter', () => {
  const ok = parseQuiz('```json\n' + quizJson(5) + '\n```');
  assert.equal(ok.ok, true);
  assert.equal(ok.quiz.questions.length, 5);
  assert.equal(ok.quiz.topic, 'Fractions');
  assert.equal(parseQuiz('Sure! ' + quizJson(4) + ' hope it helps').ok, true);
});

test('parseQuiz drops invalid questions and rejects too-small or unreadable output', () => {
  const bad = JSON.parse(quizJson(5));
  bad.questions[0].options = ['same', 'same', 'x', 'y'];      // duplicate options
  bad.questions[1].answer = 4;                                // out of range
  bad.questions[2].options = ['a', 'b', 'c'];                 // wrong count
  const r = parseQuiz(JSON.stringify(bad));
  assert.equal(r.ok, false);                                   // only 2 valid left (< 3)
  const four = JSON.parse(quizJson(5));
  four.questions[0].answer = 'B';
  const r2 = parseQuiz(JSON.stringify(four));
  assert.equal(r2.ok, true);
  assert.equal(r2.quiz.questions.length, 4);
  assert.equal(parseQuiz('no json at all').ok, false);
  assert.equal(parseQuiz('{"questions": "nope"}').ok, false);
});

test('gradeQuiz scores exactly, treats skipped as wrong, and ranks weak concepts', () => {
  const { quiz } = parseQuiz(quizJson(5));          // answers: 0,1,2,3,0 ; concepts: U,U,U,S,S
  const all = gradeQuiz(quiz, quiz.questions.map((x) => ({ picked: x.answer })));
  assert.deepEqual([all.correct, all.total, all.percent], [5, 5, 100]);
  assert.deepEqual(all.weakConcepts, []);

  const mixed = gradeQuiz(quiz, [
    { picked: 0 },          // right (answer 0)
    { picked: 3 },          // wrong
    { picked: null },       // skipped
    { picked: 3 },          // right
    { picked: 1 },          // wrong
  ]);
  assert.deepEqual([mixed.correct, mixed.percent], [2, 40]);
  assert.deepEqual(mixed.items.map((i) => i.right), [true, false, false, true, false]);
  assert.deepEqual(mixed.weakConcepts, [
    { concept: 'Unlike denominators', missed: 2, of: 3 },
    { concept: 'Simplifying', missed: 1, of: 2 },
  ].sort((a, b) => b.missed / b.of - a.missed / a.of));
  // missing answers array entries count as skipped
  assert.equal(gradeQuiz(quiz, []).correct, 0);
});

test('report prompt includes the exact score and each verdict', () => {
  const { quiz } = parseQuiz(quizJson(5));
  const answers = [{ picked: 0 }, { picked: 3 }, { picked: null }, { picked: 3 }, { picked: 1 }];
  const g = gradeQuiz(quiz, answers);
  const p = buildReportPrompt(quiz, g, answers);
  assert.match(p, /Score: 2\/5 \(40%\)/);
  assert.match(p, /\| RIGHT/);
  assert.match(p, /\| WRONG/);
  assert.match(p, /\| SKIPPED/);
  assert.match(p, /never a video URL/);
});

test('parseReport builds SAFE search links, never trusting model-supplied URLs', () => {
  const r = parseReport(JSON.stringify({
    summary: 'Good start.',
    weakPoints: [{ concept: 'Unlike denominators', why: 'Adds tops and bottoms', tip: 'Find the LCD first' }],
    strengths: ['Simplifying'],
    youtube: [{ channel: 'Khan Academy', why: 'Clear basics', query: 'adding fractions unlike denominators', url: 'https://evil.test/x' }],
    books: [{ title: 'Basic Mathematics', author: 'Serge Lang', why: 'Solid', url: 'javascript:alert(1)' }],
    other: [{ name: 'Desmos', why: 'Visualise', query: 'desmos fractions' }],
  }));
  assert.equal(r.ok, true);
  const { youtube, books, other } = r.report.resources;
  assert.match(youtube[0].url, /^https:\/\/www\.youtube\.com\/results\?search_query=/);
  assert.ok(!youtube[0].url.includes('evil.test'));
  assert.match(books[0].url, /^https:\/\/www\.google\.com\/search\?q=/);
  assert.ok(!books[0].url.startsWith('javascript:'));
  assert.match(other[0].url, /^https:\/\/www\.google\.com\/search/);
  assert.equal(youtubeSearchUrl('a b&c'), 'https://www.youtube.com/results?search_query=a%20b%26c');
  assert.equal(webSearchUrl('x y'), 'https://www.google.com/search?q=x%20y');
});

test('parseReport tolerates partial output, caps list sizes, and rejects an empty analysis', () => {
  assert.equal(parseReport('{}').ok, false);
  assert.equal(parseReport('garbage').ok, false);
  const many = parseReport(JSON.stringify({ summary: 's', youtube: Array.from({ length: 9 }, (_, i) => ({ channel: `c${i}`, query: 'q' })) }));
  assert.equal(many.report.resources.youtube.length, 3);
  assert.deepEqual(many.report.weakPoints, []);
});

test('reportToMarkdown is a compact recap that keeps score, weak points and resources', () => {
  const { quiz } = parseQuiz(quizJson(5));
  const answers = [{ picked: 0 }, { picked: 3 }, { picked: null }, { picked: 3 }, { picked: 1 }];
  const g = gradeQuiz(quiz, answers);
  const rep = parseReport(JSON.stringify({
    summary: 'Keep going.', weakPoints: [{ concept: 'Unlike denominators', why: 'w', tip: 't' }],
    strengths: ['Simplifying'], youtube: [{ channel: 'Khan Academy', why: 'y', query: 'fractions' }],
    books: [{ title: 'Basic Mathematics', author: 'Serge Lang', why: 'b' }],
  })).report;
  const md = reportToMarkdown(quiz, g, rep);
  assert.match(md, /\*\*Quiz: Fractions\*\* — 2\/5 \(40%\)/);
  assert.match(md, /Weak points/);
  assert.match(md, /Unlike denominators/);
  assert.match(md, /Khan Academy/);
  assert.match(md, /Basic Mathematics — Serge Lang/);
});

test('YouTube search does not repeat the channel name, and long text is cut at a word with an ellipsis', () => {
  const r = parseReport(JSON.stringify({
    summary: 'ok',
    weakPoints: [{ concept: 'c', why: 'word '.repeat(200), tip: 'short tip' }],
    youtube: [
      { channel: 'Khan Academy', why: 'y', query: 'Khan Academy adding fractions' },
      { channel: 'Math Antics', why: 'y', query: 'adding fractions' },
    ],
  }));
  assert.equal(r.report.resources.youtube[0].url, 'https://www.youtube.com/results?search_query=Khan%20Academy%20adding%20fractions');
  assert.equal(r.report.resources.youtube[1].url, 'https://www.youtube.com/results?search_query=Math%20Antics%20adding%20fractions');
  const why = r.report.weakPoints[0].why;
  assert.ok(why.endsWith('…') && why.length <= 451, String(why.length));
  assert.ok(!/wor…$/.test(why), 'must not cut mid-word');
  assert.equal(r.report.weakPoints[0].tip, 'short tip');
});
