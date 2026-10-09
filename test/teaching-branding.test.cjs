'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('@xmldom/xmldom');
const loadTs = require('./load-ts.cjs');

const { isBrandableTeachingUrl, createTeachingBrandingScript } = loadTs('src/main/teachingBranding.ts');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function freshWindow() {
  globalThis.window = {};
  globalThis.document = undefined;
  globalThis.location = undefined;
  globalThis.MutationObserver = undefined;
  FakeMO.instances = [];
}

function setLocation(href) {
  if (href === undefined) {
    globalThis.location = undefined;
    return;
  }
  const u = new URL(href);
  globalThis.location = {
    href: u.href,
    origin: u.origin,
    protocol: u.protocol,
    host: u.host,
    hostname: u.hostname,
    port: u.port,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    username: u.username,
    password: u.password,
  };
}

function loadFixture(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  globalThis.document = doc;
  return doc;
}

class FakeMO {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    this.observations = 0;
    FakeMO.instances.push(this);
  }
  observe() {
    this.observations += 1;
    this.disconnected = false;
  }
  disconnect() {
    this.disconnected = true;
  }
  trigger() {
    this.callback([]);
  }
}
FakeMO.instances = [];

function runScript(script) {
  new Function(script)();
}

const HEADER_LOGO = '/_next/image?url=%2Flogo-horizontal.png&amp;w=384&amp;q=75';
const HEADER_LOGO_RAW = '/_next/image?url=%2Flogo-horizontal.png&w=384&q=75';
const HEADER_SRCSET_HTML = '/_next/image?url=%2Flogo-horizontal.png&amp;w=256&amp;q=75 1x, /_next/image?url=%2Flogo-horizontal.png&amp;w=384&amp;q=75 2x';
const HEADER_SRCSET_RAW = '/_next/image?url=%2Flogo-horizontal.png&w=256&q=75 1x, /_next/image?url=%2Flogo-horizontal.png&w=384&q=75 2x';

function headerPage(extra = '') {
  return `<html><body>
<header><a href="/" aria-label="OpenMAIC home"><img alt="OpenMAIC" src="${HEADER_LOGO}" srcset="${HEADER_SRCSET_HTML}" width="128" height="32"></a></header>
${extra}
</body></html>`;
}

const ANNOUNCEMENT_MODAL = `<div role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
<h2 id="whats-new-title">What's new in OpenMAIC</h2>
<h3>Live classroom dashboards</h3>
<h3>Shareable lesson links</h3>
<a href="/docs/changelog">Read the changelog</a>
<button type="button">Close</button>
<button type="button">Got it</button>
</div>`;

test('the root announcement modal heading is masked without touching the release body', () => {
  freshWindow();
  setLocation('https://open.maic.chat/');
  const doc = loadFixture(headerPage(`<main>${ANNOUNCEMENT_MODAL}</main>`));
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));

  const dialog = doc.getElementsByTagName('div')[0];
  const headings = dialog.getElementsByTagName('h2');
  assert.equal(headings[0].firstChild.data, "What's new");
  assert.equal(dialog.getElementsByTagName('h3')[0].firstChild.data, 'Live classroom dashboards');
  assert.equal(dialog.getElementsByTagName('h3')[1].firstChild.data, 'Shareable lesson links');
  assert.equal(dialog.getElementsByTagName('a')[0].getAttribute('href'), '/docs/changelog');
  assert.equal(dialog.getElementsByTagName('a')[0].firstChild.data, 'Read the changelog');
  assert.equal(dialog.getElementsByTagName('button')[0].firstChild.data, 'Close');
  assert.equal(dialog.getElementsByTagName('button')[1].firstChild.data, 'Got it');
  assert.equal(doc.getElementsByTagName('img')[0].getAttribute('src'), PNG);
  assert.equal(FakeMO.instances[0].disconnected, false);
});

test('the same heading wording outside a real announcement dialog is never masked', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage(
    '<main><article><h2>What\'s new in OpenMAIC</h2><p>Release notes for the cohort.</p></article>' +
    '<div role="dialog"><h2>What\'s new in OpenMAIC</h2><button type="button">Dismiss</button></div></main>',
  ));
  runScript(createTeachingBrandingScript(PNG));

  assert.equal(doc.getElementsByTagName('h2')[0].firstChild.data, "What's new in OpenMAIC");
  assert.equal(doc.getElementsByTagName('h2')[1].firstChild.data, "What's new in OpenMAIC");
});

test('a typographic apostrophe in the announcement heading is still masked', () => {
  freshWindow();
  setLocation('https://open.maic.chat/');
  const doc = loadFixture(headerPage(
    '<main><div role="dialog"><h2>What\u2019s new in OpenMAIC</h2><button type="button">Got it</button></div></main>',
  ));
  runScript(createTeachingBrandingScript(PNG));

  assert.equal(doc.getElementsByTagName('h2')[0].firstChild.data, "What's new");
});

test('the announcement heading is restored on restore and when the route leaves the brandable scope', () => {
  freshWindow();
  setLocation('https://open.maic.chat/');
  const doc = loadFixture(headerPage(`<main>${ANNOUNCEMENT_MODAL}</main>`));
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));
  assert.equal(doc.getElementsByTagName('h2')[0].firstChild.data, "What's new");

  globalThis.window.__jargonTeachingBrandingRestore();
  assert.equal(doc.getElementsByTagName('h2')[0].firstChild.data, "What's new in OpenMAIC");
  assert.equal(doc.getElementsByTagName('h2')[0].hasAttribute('data-jargon-orig-announce'), false);

  freshWindow();
  setLocation('https://open.maic.chat/');
  const doc2 = loadFixture(headerPage(`<main>${ANNOUNCEMENT_MODAL}</main>`));
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));
  assert.equal(doc2.getElementsByTagName('h2')[0].firstChild.data, "What's new");
  setLocation('https://open.maic.chat/arena');
  FakeMO.instances[0].trigger();
  assert.equal(doc2.getElementsByTagName('h2')[0].firstChild.data, "What's new in OpenMAIC");
});

test('brandable URL accepts the root and classroom ids only', () => {
  assert.equal(isBrandableTeachingUrl('https://open.maic.chat'), true);
  assert.equal(isBrandableTeachingUrl('https://open.maic.chat/'), true);
  assert.equal(isBrandableTeachingUrl('https://open.maic.chat/classroom/Uyh82Y32ZK'), true);
  assert.equal(isBrandableTeachingUrl('https://open.maic.chat/classroom/a-b_c-1'), true);
});

test('brandable URL rejects query, hash, ports and non classroom paths', () => {
  for (const bad of [
    'https://open.maic.chat/?utm=1',
    'https://open.maic.chat/#hero',
    'https://open.maic.chat/classroom/abc?tab=1',
    'https://open.maic.chat:8443/classroom/abc',
    'https://open.maic.chat/classroom/abc/extra',
    'https://open.maic.chat/arena',
    'https://open.maic.chat/signin',
    'https://open.maic.chat/login',
    'https://open.maic.chat/classroom/' + 'a'.repeat(65),
    'https://open.maic.chat/classroom/a b',
    '',
  ]) {
    assert.equal(isBrandableTeachingUrl(bad), false, bad);
  }
});

test('brandable URL rejects docs, auth, account, billing, payment, privacy, terms, legal and lookalikes', () => {
  for (const bad of [
    'http://open.maic.chat',
    'https://open.maic.chat/docs/getting-started',
    'https://open.maic.chat/auth',
    'https://open.maic.chat/account',
    'https://open.maic.chat/billing',
    'https://open.maic.chat/payment',
    'https://open.maic.chat/privacy',
    'https://open.maic.chat/terms',
    'https://open.maic.chat/legal',
    'https://user:pw@open.maic.chat/classroom/abc',
    'https://evil.com/classroom/abc',
    'https://open.maic.chat.evil.com',
    'https://maic.chat/classroom/abc',
    'https://live-ack-prod.cogevol.com/classroom/abc',
  ]) {
    assert.equal(isBrandableTeachingUrl(bad), false, bad);
  }
});

test('the script builder only accepts a bounded PNG data URL', () => {
  assert.throws(() => createTeachingBrandingScript('data:image/svg+xml;base64,PHN2Zz4='), /PNG data URL/);
  assert.throws(() => createTeachingBrandingScript('https://example.com/logo.png'), /PNG data URL/);
  assert.throws(() => createTeachingBrandingScript('data:image/png;base64,' + 'A'.repeat(600 * 1024)), /PNG data URL/);
  assert.equal(typeof createTeachingBrandingScript(PNG), 'string');
});

test('the generated script is static and never reaches a network or Node API', () => {
  const script = createTeachingBrandingScript(PNG);
  for (const bad of ['fetch(', 'XMLHttpRequest', 'require(', 'process.', '__dirname', 'customInput', 'cth', 'import(']) {
    assert.equal(script.includes(bad), false, bad);
  }
  assert.equal(script.includes('__jargonTeachingBranding'), true);
  assert.equal(script.includes('__jargonTeachingBrandingApply'), true);
  assert.equal(script.includes('__jargonTeachingBrandingRestore'), true);
});

test('the header logo, brand home anchor and header wordmark are rebranded', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage('<nav><span>OpenMAIC</span></nav>'));
  runScript(createTeachingBrandingScript(PNG));

  const anchor = doc.getElementsByTagName('a')[0];
  const img = doc.getElementsByTagName('img')[0];
  assert.equal(img.getAttribute('src'), PNG);
  assert.equal(img.hasAttribute('srcset'), false);
  assert.equal(img.getAttribute('alt'), 'Jargon');
  assert.equal(anchor.getAttribute('aria-label'), 'Jargon home');
  assert.equal(anchor.getAttribute('href'), '/');
  assert.equal(img.getAttribute('width'), '128');
  assert.equal(doc.getElementsByTagName('span')[0].firstChild.data, 'Jargon');
});

test('a course figure logo image and its caption are left alone', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage(
    '<main><figure><img alt="OpenMAIC" src="/course/openmaic-syllabus.png"><figcaption>OpenMAIC</figcaption></figure></main>',
  ));
  runScript(createTeachingBrandingScript(PNG));

  const imgs = doc.getElementsByTagName('img');
  const course = imgs[1];
  assert.equal(course.getAttribute('src'), '/course/openmaic-syllabus.png');
  assert.equal(course.getAttribute('alt'), 'OpenMAIC');
  assert.equal(doc.getElementsByTagName('figcaption')[0].firstChild.data, 'OpenMAIC');
});

test('course citations and external links keep their text, href and aria label', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage(
    '<main><article><p>Built by <a href="https://github.com/THU-MAIC/OpenMAIC" aria-label="OpenMAIC source">OpenMAIC</a> in 2025.</p></article></main>',
  ));
  runScript(createTeachingBrandingScript(PNG));

  const link = doc.getElementsByTagName('article')[0].getElementsByTagName('a')[0];
  assert.equal(link.firstChild.data, 'OpenMAIC');
  assert.equal(link.getAttribute('href'), 'https://github.com/THU-MAIC/OpenMAIC');
  assert.equal(link.getAttribute('aria-label'), 'OpenMAIC source');
});

test('footer credits, legal text and body paragraphs are never rewritten', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage(
    '<main><p>OpenMAIC grades this lesson automatically.</p><textarea>OpenMAIC</textarea></main>' +
    '<footer><a href="/">OpenMAIC</a><small>Credits to the OpenMAIC team. Privacy and Terms apply.</small></footer>',
  ));
  runScript(createTeachingBrandingScript(PNG));

  assert.equal(doc.getElementsByTagName('p')[0].firstChild.data, 'OpenMAIC grades this lesson automatically.');
  assert.equal(doc.getElementsByTagName('textarea')[0].firstChild.data, 'OpenMAIC');
  assert.equal(doc.getElementsByTagName('a')[1].firstChild.data, 'OpenMAIC');
  assert.equal(doc.getElementsByTagName('small')[0].firstChild.data, 'Credits to the OpenMAIC team. Privacy and Terms apply.');
});

test('the verified root hero lockup is rebranded on the root page', () => {
  freshWindow();
  setLocation('https://open.maic.chat/');
  const doc = loadFixture(headerPage(
    '<main><div data-pro-morph="lockup"><img alt="OpenMAIC" src="/logo-horizontal.png" srcset="/logo-horizontal.png 2x"><h1>OpenMAIC</h1></div></main>',
  ));
  runScript(createTeachingBrandingScript(PNG));

  const heroImg = doc.getElementsByTagName('img')[1];
  assert.equal(heroImg.getAttribute('src'), PNG);
  assert.equal(heroImg.hasAttribute('srcset'), false);
  assert.equal(heroImg.getAttribute('alt'), 'Jargon');
  assert.equal(doc.getElementsByTagName('h1')[0].firstChild.data, 'Jargon');
});

test('a data-pro-morph lockup outside the root is not rebranded', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage('<main><div data-pro-morph="lockup"><img alt="OpenMAIC" src="/logo-horizontal.png"></div></main>'));
  runScript(createTeachingBrandingScript(PNG));

  const heroImg = doc.getElementsByTagName('img')[1];
  assert.equal(heroImg.getAttribute('src'), '/logo-horizontal.png');
  assert.equal(heroImg.getAttribute('alt'), 'OpenMAIC');
});

test('repeated applies and observer triggers stay idempotent', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage());
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));

  const img = doc.getElementsByTagName('img')[0];
  img.setAttribute('data-jargon-orig-srcset', HEADER_SRCSET_RAW);
  runScript(createTeachingBrandingScript(PNG));
  FakeMO.instances[0].trigger();
  FakeMO.instances[0].trigger();

  assert.equal(img.getAttribute('src'), PNG);
  assert.equal(img.hasAttribute('srcset'), false);
  assert.equal(img.getAttribute('alt'), 'Jargon');
});

test('a late arriving header logo is rebranded by the observer', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture('<html><body><header><a href="/"><span>OpenMAIC</span></a></header></body></html>');
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));
  assert.equal(FakeMO.instances.length, 1);

  const anchor = doc.getElementsByTagName('a')[0];
  const img = doc.createElement('img');
  img.setAttribute('alt', 'OpenMAIC');
  img.setAttribute('src', '/logo-horizontal.png');
  anchor.appendChild(img);
  FakeMO.instances[0].trigger();

  assert.equal(img.getAttribute('src'), PNG);
  assert.equal(img.getAttribute('alt'), 'Jargon');
});

test('injecting the script twice keeps one controller and one observer', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage());
  globalThis.MutationObserver = FakeMO;

  const script = createTeachingBrandingScript(PNG);
  runScript(script);
  const first = globalThis.window.__jargonTeachingBranding;
  runScript(script);
  const second = globalThis.window.__jargonTeachingBranding;

  assert.equal(FakeMO.instances.length, 1);
  assert.equal(first, second);
  assert.equal(typeof second.apply, 'function');
  assert.equal(typeof second.restore, 'function');
  assert.equal(second.observer, FakeMO.instances[0]);
  assert.equal(FakeMO.instances[0].disconnected, false);
  assert.equal(doc.getElementsByTagName('img')[0].getAttribute('src'), PNG);
});

test('an SPA route that is not brandable restores the brand even when unblacklisted', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage());
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));
  assert.equal(doc.getElementsByTagName('img')[0].getAttribute('src'), PNG);

  setLocation('https://open.maic.chat/arena');
  FakeMO.instances[0].trigger();
  const img = doc.getElementsByTagName('img')[0];
  assert.equal(img.getAttribute('src'), HEADER_LOGO_RAW);
  assert.equal(img.getAttribute('alt'), 'OpenMAIC');
  assert.equal(img.getAttribute('srcset'), HEADER_SRCSET_RAW);
  assert.equal(img.hasAttribute('data-jargon-orig-src'), false);
  assert.equal(doc.getElementsByTagName('a')[0].getAttribute('aria-label'), 'OpenMAIC home');
});

test('leaving the brandable origin restores the brand and stops the observer', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage());
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));

  setLocation('https://evil.com/classroom/AbC123xYz');
  FakeMO.instances[0].trigger();
  const img = doc.getElementsByTagName('img')[0];
  assert.equal(img.getAttribute('src'), HEADER_LOGO_RAW);
  assert.equal(img.getAttribute('alt'), 'OpenMAIC');
  assert.equal(FakeMO.instances[0].disconnected, true);
  assert.equal(globalThis.window.__jargonTeachingBranding.observer, null);
});

test('a password field restores the brand and permanently stops observing', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage('<main><form><input type="password"></form></main>'));
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));

  const img = doc.getElementsByTagName('img')[0];
  assert.equal(img.getAttribute('src'), HEADER_LOGO_RAW);
  assert.equal(img.getAttribute('alt'), 'OpenMAIC');
  assert.equal(FakeMO.instances[0].disconnected, true);
  assert.equal(globalThis.window.__jargonTeachingBranding.permanent, true);
});

test('an email auth dialog pauses branding without disconnecting and resumes after it closes', () => {
  freshWindow();
  setLocation('https://open.maic.chat/');
  const doc = loadFixture(headerPage('<main><div role="dialog" aria-label="Sign in"><form><input type="email"><button>Continue with GitHub</button></form></div></main>'));
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));

  const img = doc.getElementsByTagName('img')[0];
  assert.equal(img.getAttribute('src'), HEADER_LOGO_RAW);
  assert.equal(img.getAttribute('alt'), 'OpenMAIC');
  const observer = FakeMO.instances[0];
  assert.equal(observer.disconnected, false);
  assert.equal(globalThis.window.__jargonTeachingBranding.permanent, undefined);

  observer.trigger();
  assert.equal(observer.disconnected, false);
  assert.equal(img.getAttribute('src'), HEADER_LOGO_RAW);

  const dialog = doc.getElementsByTagName('div')[0];
  doc.getElementsByTagName('main')[0].removeChild(dialog);
  observer.trigger();

  assert.equal(img.getAttribute('src'), PNG);
  assert.equal(img.getAttribute('alt'), 'Jargon');
  assert.equal(observer.disconnected, false);
  assert.equal(observer.observations, 1);
});

test('a missing or unknown location never brands', () => {
  freshWindow();
  const doc = loadFixture(headerPage());
  runScript(createTeachingBrandingScript(PNG));
  assert.equal(doc.getElementsByTagName('img')[0].getAttribute('src'), HEADER_LOGO_RAW);

  freshWindow();
  const doc2 = loadFixture(headerPage());
  setLocation('https://maic.chat/signin?domain=live-ack-prod.cogevol.com');
  runScript(createTeachingBrandingScript(PNG));
  assert.equal(doc2.getElementsByTagName('img')[0].getAttribute('src'), HEADER_LOGO_RAW);
  assert.equal(doc2.getElementsByTagName('img')[0].getAttribute('alt'), 'OpenMAIC');
});

test('the explicit restore entry point undoes branding', () => {
  freshWindow();
  setLocation('https://open.maic.chat/classroom/AbC123xYz');
  const doc = loadFixture(headerPage());
  globalThis.MutationObserver = FakeMO;
  runScript(createTeachingBrandingScript(PNG));
  assert.equal(doc.getElementsByTagName('img')[0].getAttribute('src'), PNG);

  globalThis.window.__jargonTeachingBrandingRestore();
  const img = doc.getElementsByTagName('img')[0];
  assert.equal(img.getAttribute('src'), HEADER_LOGO_RAW);
  assert.equal(img.getAttribute('srcset'), HEADER_SRCSET_RAW);
  assert.equal(img.getAttribute('alt'), 'OpenMAIC');
  assert.equal(doc.getElementsByTagName('a')[0].getAttribute('aria-label'), 'OpenMAIC home');
  assert.equal(FakeMO.instances[0].disconnected, true);
});