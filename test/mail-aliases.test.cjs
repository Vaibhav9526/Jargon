'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { parseMailRequest } = loadTs('src/shared/mailAliases.ts');

test('every mail alias routes, case-insensitively, and keeps the rest of the request', () => {
  for (const a of ['@mail', '@email', '@mailman', '@inbox', '@MAILMAN', '@Inbox']) {
    assert.equal(parseMailRequest(a).request, '');
    assert.equal(parseMailRequest(`${a} summarize my unread`).request, 'summarize my unread');
    assert.equal(parseMailRequest(`please ${a}`).request, 'please');
  }
  assert.equal(parseMailRequest('@mailman').alias, 'mailman');
  assert.equal(parseMailRequest('@email.').alias, 'email');
  assert.equal(parseMailRequest('(@inbox)').request, '()');
});

test('addresses, partial words and ordinary text never route', () => {
  for (const t of ['', 'hello', 'bob@mail.com', 'x@email', '@mailing', '@mailbox', '@mails', '@email.com', '@inboxes', 'a @@mail']) {
    assert.equal(parseMailRequest(t), null, t);
  }
  assert.equal(parseMailRequest(null), null);
});
