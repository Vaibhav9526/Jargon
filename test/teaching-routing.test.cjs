'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const {
  parseTeachingRequest,
  findTeacherAgent,
  MAX_TEACHING_TEXT_CHARS,
  MAX_TEACHING_TOPIC_CHARS,
  MAX_TEACHING_ATTACHMENTS,
  MAX_TEACHING_PATH_CHARS,
  MAX_TEACHING_NAME_CHARS
} = loadTs('src/shared/teaching.ts');

const pdf = Object.freeze({ path: 'D:\\selected\\lesson.PDF', name: 'lesson.PDF' });
const image = Object.freeze({ path: '/selected/diagram.png', name: 'diagram.png' });
const parse = (text, attachments = []) => parseTeachingRequest(text, attachments);
const shapeError = { name: 'TypeError', message: 'Each teaching attachment needs a valid path and file name.' };
const typeError = { name: 'Error', message: 'Teaching attachments must be PDF or PNG, JPG, JPEG, WEBP, GIF, BMP, TIF, TIFF images.' };
const fileBoundsError = {
  name: 'RangeError',
  message: `Teaching attachment paths must be ${MAX_TEACHING_PATH_CHARS} characters or fewer and names ${MAX_TEACHING_NAME_CHARS} or fewer.`
};

test('both aliases trigger case-insensitively and are stripped without losing context', () => {
  for (const alias of ['@teach-me', '@teacher', '@TEACH-ME', '@Teacher']) {
    assert.deepEqual(parse(`${alias} Explain photosynthesis`), { topic: 'Explain photosynthesis', attachments: [] });
    assert.equal(parse(`Prior context\n${alias} explain\n  this with @Bob`).topic, 'Prior context\n explain\n  this with @Bob');
  }
  assert.equal(parse('  @Teacher explain  @teach-me gravity\n@TEACHER  ').topic, 'explain   gravity');
});

test('whitespace, opening parentheses, brackets and quotes permit mentions', () => {
  for (const prefix of ['', ' ', '\t', '\n', '(', '[', '{', '"', "'", '“', '‘', '«']) {
    assert.notEqual(parse(`${prefix}@teacher explain`), null, JSON.stringify(prefix));
  }
  for (const suffix of ['', ' ', '\t', '\n', ')', ']', '}', '"', "'", '”', '’', '»']) {
    assert.notEqual(parse(`explain @teacher${suffix}`), null, JSON.stringify(suffix));
  }
});

test('ending punctuation is accepted and preserved as ordinary context', () => {
  for (const suffix of ['.', ',', ':', '!', '?', '?!', '...', '.)', ', explain']) {
    assert.deepEqual(parse(`context @teacher${suffix}`), { topic: `context ${suffix}`, attachments: [] });
  }
  assert.equal(parse('(@teacher): explain "@teach-me" please').topic, '(): explain "" please');
});

test('partial aliases, email addresses and embedded words do not route', () => {
  for (const text of [
    '', 'ordinary message', '@teacherly', '@teach-me-now', '@teacher-now', '@teachers',
    '@teach-me_more', '@teacher123', 'bob@teacher.com', '@teacher.com', '@teacher.pdf',
    '@teach-me.com', 'x@teacher', '/@teacher', '#@teacher', '@@teacher', 'é@teacher',
    '@teacher:3000', '@teacher.com explain', 'mailto:bob@teacher.com'
  ]) {
    assert.equal(parse(text), null, text);
  }
  assert.equal(parse('Email bob@teacher.com; @Teacher explain domains').topic, 'Email bob@teacher.com;  explain domains');
  assert.equal(parse('@teacherly @teach-me-now @teacher explain').topic, '@teacherly @teach-me-now  explain');
});

test('normal messages do not validate or inspect arbitrary attachments or teaching limits', () => {
  for (const attachments of [undefined, null, 42, 'anything', {}, [null], [{ path: '/code.js' }]]) {
    assert.equal(parseTeachingRequest('normal message', attachments), null);
  }
  const attachments = new Proxy([], { get() { throw new Error('Attachments were inspected'); } });
  assert.equal(parseTeachingRequest('normal message', attachments), null);
  assert.equal(parseTeachingRequest('x'.repeat(MAX_TEACHING_TEXT_CHARS + 1), attachments), null);
});

test('text must be a string even when no teaching route can be determined', () => {
  for (const text of [null, undefined, 42, {}, [], new String('@teacher explain')]) {
    assert.throws(() => parse(text), { name: 'TypeError', message: 'Teaching text must be a string.' });
  }
});

test('topic-only and files-only teaching requests are accepted', () => {
  assert.deepEqual(parse('@teacher explain calculus'), { topic: 'explain calculus', attachments: [] });
  assert.deepEqual(parse(' \n@teach-me\t ', [pdf]), { topic: '', attachments: [pdf] });
  for (const text of ['@teacher', ' \t@teach-me\n', '@teacher @teach-me']) {
    assert.throws(() => parse(text), { name: 'Error', message: 'Add a teaching topic or a PDF/image attachment.' });
  }
});

test('all selected allowed files, order, duplicate entries and exact input values survive', () => {
  const input = Object.freeze([pdf, image, pdf]);
  const text = '  @teacher Read both\n  keep this formatting  ';
  const result = parse(text, input);
  assert.deepEqual(result, { topic: 'Read both\n  keep this formatting', attachments: [pdf, image, pdf] });
  assert.equal(text, '  @teacher Read both\n  keep this formatting  ');
  assert.deepEqual(input, [pdf, image, pdf]);
  assert.notEqual(result.attachments, input);
  assert.notEqual(result.attachments[0], pdf);
  result.attachments[0].name = 'changed.pdf';
  assert.equal(pdf.name, 'lesson.PDF');
  assert.equal(parse('@teacher again').topic, 'again');
  assert.equal(parse('ordinary'), null);
  assert.equal(parse('@teacher again').topic, 'again');
});

test('PDF and every listed raster extension are allowed, including upper case', () => {
  for (const extension of ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff']) {
    for (const ext of [extension, extension.toUpperCase()]) {
      const file = { path: `/does/not/need/to/exist/file.${ext}`, name: `file.${ext}` };
      assert.deepEqual(parse('@teacher', [file]).attachments, [file]);
    }
  }
  const file = { path: 'D:\\folder with spaces\\课程.png', name: '课程.png', extra: 'not sent' };
  assert.deepEqual(parse('@teacher', [file]).attachments, [{ path: file.path, name: file.name }]);
});

test('unsupported or disguised extensions reject the complete request, not just the file', () => {
  for (const extension of ['txt', 'md', 'svg', 'html', 'exe', 'avif', 'heic', 'ico', 'pdf.exe', 'png.js', '']) {
    const file = { path: `/selected/file.${extension}`, name: `file.${extension}` };
    assert.throws(() => parse('@teacher explain', [pdf, file]), typeError, extension);
  }
  for (const file of [
    { path: '/selected/code.js', name: 'diagram.png' },
    { path: '/selected/diagram.png', name: 'code.js' },
    { path: '/selected/diagram.png/', name: 'diagram.png' },
    { path: '/selected/diagram.png?x=1', name: 'diagram.png' }
  ]) assert.throws(() => parse('@teacher explain', [file]), typeError);
});

test('teaching attachments require an array and valid string path/name records', () => {
  for (const attachments of [undefined, null, {}, 'files', 42]) {
    assert.throws(() => parseTeachingRequest('@teacher explain', attachments), {
      name: 'TypeError', message: 'Teaching attachments must be an array.'
    });
  }
  for (const file of [
    null, undefined, 42, 'file.pdf', [], {}, { path: '/file.pdf' }, { name: 'file.pdf' },
    { path: 42, name: 'file.pdf' }, { path: '/file.pdf', name: 42 },
    { path: '', name: 'file.pdf' }, { path: '  ', name: 'file.pdf' },
    { path: '/file.pdf', name: '' }, { path: '/file.pdf', name: '\t' },
    { path: '/file\u0000.pdf', name: 'file.pdf' }, { path: '/file.pdf', name: 'file\n.pdf' },
    { path: '/file\u007f.pdf', name: 'file.pdf' },
    { path: '/file.pdf', name: 'folder/file.pdf' }, { path: '/file.pdf', name: 'folder\\file.pdf' }
  ]) assert.throws(() => parse('@teacher explain', [file]), shapeError);
  assert.throws(() => parse('@teacher explain', new Array(1)), shapeError);
});

test('topic and raw message limits have inclusive boundaries and never silently truncate', () => {
  const topic = 'x'.repeat(MAX_TEACHING_TOPIC_CHARS);
  assert.equal(parse(`@teacher ${topic}`).topic, topic);
  assert.throws(() => parse(`@teacher ${topic}x`), {
    name: 'RangeError', message: `Teaching topic must be ${MAX_TEACHING_TOPIC_CHARS} characters or fewer.`
  });
  const text = '@teacher x'.padEnd(MAX_TEACHING_TEXT_CHARS, ' ');
  assert.equal(parse(text).topic, 'x');
  assert.throws(() => parse(`${text} `), {
    name: 'RangeError', message: `Teaching message must be ${MAX_TEACHING_TEXT_CHARS} characters or fewer.`
  });
});

test('file count, path and name limits are inclusive and never drop files', () => {
  assert.equal(parse('@teacher', Array(MAX_TEACHING_ATTACHMENTS).fill(pdf)).attachments.length, MAX_TEACHING_ATTACHMENTS);
  assert.throws(() => parse('@teacher', Array(MAX_TEACHING_ATTACHMENTS + 1).fill(pdf)), {
    name: 'RangeError', message: `Teaching supports up to ${MAX_TEACHING_ATTACHMENTS} attachments.`
  });
  const file = {
    path: `${'x'.repeat(MAX_TEACHING_PATH_CHARS - 4)}.pdf`,
    name: `${'x'.repeat(MAX_TEACHING_NAME_CHARS - 4)}.pdf`
  };
  assert.deepEqual(parse('@teacher', [file]).attachments, [file]);
  assert.throws(() => parse('@teacher', [{ ...file, path: `x${file.path}` }]), fileBoundsError);
  assert.throws(() => parse('@teacher', [{ ...file, name: `x${file.name}` }]), fileBoundsError);
});

test('teacher character wins over a name match regardless of roster order', () => {
  const named = { id: 'named', name: 'Teacher', character: 'smartguy' };
  const character = { id: 'character', name: 'Ada', character: 'teacher', status: 'idle' };
  assert.equal(findTeacherAgent([named, character]), character);
  assert.equal(findTeacherAgent([character, named]), character);
});

test('GOD and assistant agents are excluded from both teacher matching passes', () => {
  const worker = { id: 'worker', name: 'TEACHER' };
  const excluded = [
    { id: 'god', name: 'Teacher', character: 'teacher', isGod: true },
    { id: 'assistant', name: 'Teacher', character: 'teacher', isAssistant: true },
    { id: 'both', name: 'Teacher', isGod: true, isAssistant: true }
  ];
  assert.equal(findTeacherAgent(excluded), undefined);
  assert.equal(findTeacherAgent([...excluded, worker]), worker);
});

test('name fallback is exact and case-insensitive; ties follow roster order without mutation', () => {
  const first = Object.freeze({ id: 'one', name: 'tEaChEr', isGod: false, isAssistant: false });
  const second = Object.freeze({ id: 'two', name: 'Teacher' });
  const agents = Object.freeze([first, second]);
  assert.equal(findTeacherAgent(agents), first);
  assert.equal(findTeacherAgent([second, first]), second);
  assert.equal(findTeacherAgent([]), undefined);
  assert.equal(findTeacherAgent([{ id: 'other', name: 'Teacherly', character: 'TEACHER' }]), undefined);
  assert.equal(findTeacherAgent([{ id: 'other', name: ' Teacher ' }]), undefined);
  const a = Object.freeze({ id: 'a', name: 'A', character: 'teacher' });
  const b = Object.freeze({ id: 'b', name: 'B', character: 'teacher' });
  assert.equal(findTeacherAgent(Object.freeze([a, b])), a);
  assert.deepEqual(agents, [first, second]);
});
