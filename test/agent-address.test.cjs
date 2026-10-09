'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { parseAddress, parseMoreAgents } = loadTs('src/shared/agentAddress.ts');

const names = ['Michael', 'Jim', 'Pam', 'Principal'];

test('"tell/ask/to/hey NAME" routes to that agent with the rest as the task', () => {
  assert.deepEqual(parseAddress('tell michael to review the PR', names), { kind: 'agent', name: 'Michael', body: 'review the PR', wake: false });
  assert.equal(parseAddress('Ask Jim about the report', names).body, 'the report');
  assert.equal(parseAddress('to michael: ship it', names).body, 'ship it');
  assert.equal(parseAddress('hey principal, plan my week', names).name, 'Principal');
  assert.equal(parseAddress('pam, book a room', names).body, 'book a room');
});

test('waking: bare name or wake verb sets wake', () => {
  assert.equal(parseAddress('wake up jim', names).wake, true);
  assert.equal(parseAddress('hey michael', names).wake, true);
});

test('ordinary sentences and the current chat are not routed', () => {
  assert.equal(parseAddress('jim is slow today', names), null);
  assert.equal(parseAddress('summarize the repo', names), null);
  assert.equal(parseAddress('michael, hi', names, 'Michael'), null);
});

test('asking for more agents', () => {
  assert.equal(parseMoreAgents('I need more agents').count, 2);
  assert.equal(parseMoreAgents('add 3 more workers please').count, 3);
  assert.equal(parseMoreAgents('get me another agent').count, 1);
  assert.equal(parseMoreAgents('fix the agent loop'), null);
  assert.equal(parseAddress('we need two more agents for this', names).kind, 'more');
});
