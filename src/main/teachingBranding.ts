'use strict';

const MAX_TEACHING_LOGO_CHARS = 512 * 1024;
const SAFE_CLASSROOM_PATH = /^\/classroom\/[A-Za-z0-9_-]{1,64}$/;

export function isBrandableTeachingUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  const raw = url.trim();
  if (raw === '' || raw.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.hostname !== 'open.maic.chat') return false;
  if (parsed.port !== '') return false;
  const pathname = parsed.pathname;
  const queryless = parsed.search === '' && parsed.hash === '';
  if (pathname === '' || pathname === '/') return queryless;
  return SAFE_CLASSROOM_PATH.test(pathname) && queryless;
}

function isSafeLogoDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_TEACHING_LOGO_CHARS) return false;
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

const MAX_TEACHING_TOPIC_CHARS = 20_000;

/** Jargon's cream/ink look laid over the hosted page. The site is a shadcn app,
 *  so its colours come from CSS variables — we remap those, force the light
 *  variant, and flatten the purple/violet accents it hard-codes. Layout and
 *  behaviour are untouched. Sign-in pages never receive this (see authScreen). */
const JARGON_SKIN_CSS = `
/* :root:root beats the site's own :root / .dark variable blocks */
:root:root {
  --background: #FFF8E7; --foreground: #1A1320;
  --card: #FCFAF0; --card-foreground: #1A1320;
  --popover: #FCFAF0; --popover-foreground: #1A1320;
  --primary: #DCAB3C; --primary-foreground: #1A1320;
  --secondary: #F4E9C7; --secondary-foreground: #1A1320;
  --muted: #F0EAD2; --muted-foreground: #6B5878;
  --accent: #F4E9C7; --accent-foreground: #1A1320;
  --destructive: #D96A62;
  --border: rgba(26,19,32,0.28); --input: rgba(26,19,32,0.35); --ring: #9482D3;
  --radius: 0.3rem;
  color-scheme: light;
}
body { background: #FFF8E7 !important; color: #1A1320 !important; }
[class*="from-slate-50"], [class*="from-slate-950"] { background-image: none !important; background-color: #FFF8E7 !important; }
[class*="blur-3xl"], [class*="blur-2xl"] { display: none !important; }
[class*="text-violet"], [class*="text-purple"], [class*="text-fuchsia"] { color: #7A5A12 !important; }
[class*="bg-violet"], [class*="bg-purple"], [class*="bg-fuchsia"] { background-color: #F3E4BC !important; }
[class*="from-violet-100"], [class*="from-violet-900"], [class*="from-purple-100"], [class*="from-purple-900"] { background-image: none !important; background-color: rgba(220,171,60,0.10) !important; }
[class*="from-violet-500"], [class*="from-purple-500"] { background-image: none !important; background-color: #DCAB3C !important; color: #1A1320 !important; }
[class*="border-violet"], [class*="border-purple"], [class*="ring-violet"] { border-color: rgba(26,19,32,0.35) !important; --tw-ring-color: rgba(26,19,32,0.35) !important; }
[class*="shadow-violet"], [class*="shadow-purple"] { --tw-shadow-color: rgba(26,19,32,0.12) !important; }
[class*="bg-slate-9"], [class*="bg-gray-9"], [class*="bg-zinc-9"] { background-color: #FCFAF0 !important; color: #1A1320 !important; }
button[class*="bg-primary"], [role="button"][class*="bg-primary"] { color: #1A1320 !important; box-shadow: inset 0 0 0 1px #1A1320 !important; }
textarea, input { color: #1A1320 !important; }
::placeholder { color: #6B5878 !important; opacity: 1 !important; }
a[href*="github.com"] { display: none !important; }
.jargon-wordmark { font-family: "Inter Variable", Inter, system-ui, sans-serif; font-weight: 800; font-size: 40px; letter-spacing: -0.02em; color: #1A1320; margin-left: 10px; align-self: center; line-height: 1; }
[data-pro-morph="lockup"] { display: flex !important; align-items: center; }
[data-pro-morph="badge"] { display: none !important; }
`;

/**
 * Fixed "clean workspace" script for the hosted root page: hides the site's
 * navbar/header/footer and every OpenMAIC name/logo, locks page scrolling, and
 * pre-fills the lesson topic into the empty prompt box so what the user wrote
 * in Jargon carries over. The topic is embedded only via JSON.stringify, is
 * never evaluated, and is never submitted — the user presses Enter Classroom
 * themselves. Sign-in pages (password inputs / auth dialogs) are left alone.
 */
export function createTeachingChromeScript(topic: string): string {
  const safeTopic = typeof topic === 'string' ? topic.slice(0, MAX_TEACHING_TOPIC_CHARS) : '';
  return `(function () {
"use strict";
var TOPIC = ${JSON.stringify(safeTopic).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};
var SKIN = ${JSON.stringify(JARGON_SKIN_CSS)};
var STYLE_ID = '__jargon_teaching_chrome';
var gotIt = false;
var filled = !!window.__jargonTopicFilled;
var tries = 0;

function onRoot() { var p = location.pathname || ''; return p === '' || p === '/'; }
function authScreen() {
  var inputs = document.getElementsByTagName('input');
  for (var i = 0; i < inputs.length; i++) {
    if ((inputs[i].getAttribute('type') || '').toLowerCase() === 'password') return true;
  }
  return !!document.querySelector('[aria-modal="true"]');
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = SKIN + 'header,nav,footer,[data-jargon-hide]{display:none!important}' +
    (onRoot() ? 'html,body{overflow:hidden!important;height:100%!important;overscroll-behavior:none!important}' : '');
  (document.head || document.documentElement).appendChild(s);
}

function hideBranding() {
  // The logo and bare wordmark are rebranded to Jargon by the branding script;
  // only other OpenMAIC-named promos (surveys, banners) are hidden here.
  // The announcement/survey ticker bar: its decorative gradient overlay marks the bar.
  var overlays = document.querySelectorAll('[class*="from-violet-100"][class*="absolute"]');
  for (var o = 0; o < overlays.length; o++) {
    if (overlays[o].parentElement) overlays[o].parentElement.setAttribute('data-jargon-hide', '');
  }
  var all = document.body ? document.body.getElementsByTagName('*') : [];
  for (var j = 0; j < all.length; j++) {
    var el = all[j];
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    for (var n = 0; n < el.childNodes.length; n++) {
      var node = el.childNodes[n];
      if (node.nodeType === 3 && /openmaic/i.test(node.data || '')) {
        var plain = (node.data || '').trim();
        if (plain === 'OpenMAIC' || plain === 'OpenMAIC logo') break;
        var target = el;
        for (var up = el; up && up !== document.body; up = up.parentNode) {
          var t = up.tagName;
          if (t === 'A' || t === 'BUTTON') { target = up; break; }
        }
        target.setAttribute('data-jargon-hide', '');
        break;
      }
    }
  }
}

function fillTopic() {
  if (filled || !TOPIC || !onRoot()) return;
  var areas = document.getElementsByTagName('textarea');
  for (var i = 0; i < areas.length; i++) {
    var ta = areas[i];
    if (ta.value) { filled = true; return; }
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, TOPIC);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    filled = true;
    window.__jargonTopicFilled = true;
    return;
  }
}

// "What's new in OpenMAIC" covers the page on first visit — dismiss it once.
function dismissAnnouncement() {
  if (gotIt || !onRoot()) return;
  var dialogs = document.querySelectorAll('[role="dialog"]');
  for (var i = 0; i < dialogs.length; i++) {
    var h = dialogs[i].querySelector('h2');
    if (!h || !/what.?s new/i.test(h.textContent || '')) continue;
    var btns = dialogs[i].getElementsByTagName('button');
    for (var j = 0; j < btns.length; j++) {
      if ((btns[j].textContent || '').trim() === 'Got it') { gotIt = true; btns[j].click(); return; }
    }
  }
}

// The Jargon logo replaces the site mark (branding script); add the NAME beside it.
function addWordmark() {
  if (!onRoot()) return;
  var lockup = document.querySelector('[data-pro-morph="lockup"]');
  if (!lockup || lockup.querySelector('.jargon-wordmark')) return;
  var img = lockup.querySelector('img');
  if (!img) return;
  var span = document.createElement('span');
  span.className = 'jargon-wordmark';
  span.textContent = 'Jargon';
  img.insertAdjacentElement('afterend', span);
}

function forceLight() {
  var root = document.documentElement;
  if (root.classList.contains('dark')) root.classList.remove('dark');
}

function apply() {
  if (!document.body) return;
  dismissAnnouncement();
  if (authScreen()) return;
  forceLight();
  ensureStyle();
  addWordmark();
  hideBranding();
  if (tries++ < 400) fillTopic();
}

if (window.__jargonTeachingChrome) { try { window.__jargonTeachingChrome.disconnect(); } catch (e) {} }
try {
  var obs = new MutationObserver(apply);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.__jargonTeachingChrome = obs;
} catch (e) {}
apply();
})();`;
}

export interface TeachingFilePayload { name: string; mime: string; b64: string }

const SAFE_B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Fixed script that places the user's own materials (PDFs, images, text) into
 * the site's upload input, as if they had been picked by hand. It only stages
 * the files — nothing is submitted; the user presses Enter Classroom. File
 * bytes are embedded only as validated base64 inside JSON.stringify.
 */
export function createTeachingAttachScript(files: readonly TeachingFilePayload[]): string {
  const safe = files.filter((f) => f && typeof f.name === 'string' && typeof f.mime === 'string'
    && typeof f.b64 === 'string' && SAFE_B64.test(f.b64));
  return `(function () {
"use strict";
var FILES = ${JSON.stringify(safe).replace(/</g, '\\u003c')};
// One poller per page: the host injects this on several load events, and a
// second staging would add every file again ("3 materials selected").
if (!FILES.length || window.__jargonFilesStaged || window.__jargonStaging) return;
window.__jargonStaging = true;
function toFile(f) {
  var bin = atob(f.b64), len = bin.length, bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.mime });
}
var opened = false;
function courseInput() {
  // The site keeps several hidden file inputs (.zip import, image-only, ...).
  // The course-material one accepts documents; it only mounts once the
  // paperclip popover has been opened.
  var inputs = document.querySelectorAll('input[type="file"]');
  for (var i = 0; i < inputs.length; i++) {
    if ((inputs[i].getAttribute('accept') || '').indexOf('.pdf') >= 0) return inputs[i];
  }
  return null;
}
function stage() {
  var input = courseInput();
  if (!input) {
    if (!opened) {
      var icon = document.querySelector('button svg.lucide-paperclip');
      var btn = icon && icon.closest ? icon.closest('button') : null;
      if (btn) { btn.click(); opened = true; }
    }
    return false;
  }
  var dt = new DataTransfer();
  for (var j = 0; j < FILES.length; j++) dt.items.add(toFile(FILES[j]));
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  window.__jargonFilesStaged = true;
  // Visible confirmation, so the hand-off never looks like "nothing arrived".
  try {
    var note = document.createElement('div');
    note.textContent = '\\u2713 Jargon attached ' + FILES.length + (FILES.length === 1 ? ' file: ' : ' files: ') + FILES.map(function (f) { return f.name; }).join(', ');
    note.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:70vw;padding:8px 12px;font:600 13px Inter,system-ui,sans-serif;background:#DCAB3C;color:#1A1320;box-shadow:inset 0 0 0 1px #1A1320;border-radius:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    document.body.appendChild(note);
    setTimeout(function () { note.remove(); }, 12000);
  } catch (e) {}
  // Close the popover again so the page looks untouched.
  setTimeout(function () {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }, 600);
  return true;
}
var tries = 0;
var timer = setInterval(function () {
  if (stage() || ++tries > 60) clearInterval(timer);
}, 500);
})();`;
}

export function createTeachingBrandingScript(logoDataUrl: string): string {
  if (!isSafeLogoDataUrl(logoDataUrl)) {
    throw new TypeError('logoDataUrl must be a PNG data URL within the size bound.');
  }

  return `(function () {
"use strict";
var JARGON_LOGO = ${JSON.stringify(logoDataUrl)};
var ANNOUNCEMENT_TITLE = "What's new in OpenMAIC";
var ANNOUNCEMENT_NEUTRAL = "What's new";

function tagName(el) { return el && el.tagName ? el.tagName.toLowerCase() : ''; }
function forEach(tag, fn) { var els = document.getElementsByTagName(tag); for (var i = 0; i < els.length; i++) fn(els[i]); }
function setOrig(el, name, value) { if (!el.hasAttribute('data-jargon-orig-' + name)) el.setAttribute('data-jargon-orig-' + name, value); }
function hasFeature(el, name) { return typeof el.hasAttribute === 'function' && el.hasAttribute(name); }

function inHeaderOrNav(el) {
  for (var n = el; n; n = n.parentNode) {
    var t = tagName(n);
    if (t === 'header' || t === 'nav') return true;
  }
  return false;
}

function onRootPage() {
  try {
    var loc = typeof location !== 'undefined' ? location : null;
    if (!loc) return false;
    var path = typeof loc.pathname === 'string' ? loc.pathname : '';
    return path === '' || path === '/';
  } catch (e) {
    return false;
  }
}

function inHeroLockup(el) {
  if (!onRootPage()) return false;
  for (var n = el; n; n = n.parentNode) {
    if (hasFeature(n, 'data-pro-morph') && n.getAttribute('data-pro-morph') === 'lockup') return true;
  }
  return false;
}

function inFooter(el) {
  for (var n = el; n; n = n.parentNode) {
    if (tagName(n) === 'footer') return true;
  }
  return false;
}

function brandHomeAnchor(el) {
  var n = el;
  while (n && tagName(n) !== 'a') n = n.parentNode;
  if (!n) return null;
  if (inFooter(n)) return null;
  var href = (n.getAttribute('href') || '').trim();
  if (href === '' || href === '/' || href === '#') return n;
  var m = /^([a-z]+):\\/\\/([^\\/?#]+)(\\/[^?#]*)?/i.exec(href);
  if (m && m[1].toLowerCase() === 'https' && m[2].toLowerCase() === 'open.maic.chat') {
    var p = m[3] || '';
    if (p === '' || p === '/') return n;
  }
  return null;
}

function isBrandContext(el) {
  return inHeaderOrNav(el) || brandHomeAnchor(el) !== null || inHeroLockup(el);
}

function decodedSrc(el) {
  var src = el.getAttribute('src') || '';
  try { return decodeURIComponent(src); } catch (e) { return src; }
}

function isBrandLogoImage(img) {
  var alt = (img.getAttribute('alt') || '').trim().toLowerCase();
  if (alt === 'openmaic' || alt === 'openmaic logo') return true;
  return /\\/logo[-_a-z0-9.]*\\.(png|svg|webp|avif|jpg|jpeg)(\\?|#|$)/i.test(decodedSrc(img));
}

function hasPasswordInput() {
  var inputs = document.getElementsByTagName('input');
  for (var i = 0; i < inputs.length; i++) {
    if ((inputs[i].getAttribute('type') || '').toLowerCase() === 'password') return true;
  }
  return false;
}

function textOf(el) {
  var out = '';
  var walk = function (node) {
    if (!node) return;
    if (node.nodeType === 3) { out += node.data || ''; return; }
    for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
  };
  walk(el);
  return out;
}

function normalizeQuotes(value) { return value.replace(/\u2019/g, "'"); }

function isAnnouncementDialog(el) {
  if ((el.getAttribute('role') || '').toLowerCase() !== 'dialog') return false;
  var buttons = el.getElementsByTagName('button');
  var marker = false;
  for (var i = 0; i < buttons.length; i++) {
    var label = textOf(buttons[i]).trim();
    if (label === 'Got it' || label === 'Close') { marker = true; break; }
  }
  if (!marker) return false;
  var headings = el.getElementsByTagName('h2');
  for (var j = 0; j < headings.length; j++) {
    if (normalizeQuotes(textOf(headings[j]).trim()) === ANNOUNCEMENT_TITLE) return true;
  }
  return false;
}

function announcementHeading() {
  if (!onRootPage()) return null;
  var els = document.getElementsByTagName('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (typeof el.getAttribute !== 'function') continue;
    if ((el.getAttribute('role') || '').toLowerCase() !== 'dialog') continue;
    if (!isAnnouncementDialog(el)) continue;
    var headings = el.getElementsByTagName('h2');
    for (var j = 0; j < headings.length; j++) {
      if (normalizeQuotes(textOf(headings[j]).trim()) === ANNOUNCEMENT_TITLE) return headings[j];
    }
  }
  return null;
}

function hasAuthDialog() {
  var els = document.getElementsByTagName('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (typeof el.getAttribute !== 'function') continue;
    if (isAnnouncementDialog(el)) continue;
    if (hasFeature(el, 'aria-modal')) return true;
    var role = (el.getAttribute('role') || '').toLowerCase();
    if (role !== 'dialog' && role !== 'alertdialog') continue;
    var inputs = el.getElementsByTagName('input');
    for (var j = 0; j < inputs.length; j++) {
      var t = (inputs[j].getAttribute('type') || '').toLowerCase();
      if (t === 'email' || t === 'text' || t === 'password') return true;
    }
  }
  return false;
}

function allowedLocation() {
  try {
    var loc = typeof location !== 'undefined' ? location : null;
    if (!loc) return false;
    if (typeof loc.protocol === 'string' && loc.protocol.toLowerCase() !== 'https:') return false;
    var host = typeof loc.hostname === 'string' ? loc.hostname : loc.host;
    if (host !== 'open.maic.chat') return false;
    if (loc.port && loc.port !== '' && loc.port !== '443') return false;
    if ((loc.username || '') !== '' || (loc.password || '') !== '') return false;
    var path = typeof loc.pathname === 'string' ? loc.pathname : '';
    var queryless = (loc.search || '') === '' && (loc.hash || '') === '';
    if (!queryless) return false;
    if (path === '' || path === '/') return true;
    return /^\\/classroom\\/[A-Za-z0-9_-]{1,64}$/.test(path);
  } catch (e) {
    return false;
  }
}

function patchAriaLabels() {
  forEach('a', function (a) {
    var label = a.getAttribute('aria-label');
    if (!label || label.indexOf('OpenMAIC') < 0) return;
    if (!isBrandContext(a)) return;
    setOrig(a, 'aria', label);
    a.setAttribute('aria-label', label.split('OpenMAIC').join('Jargon'));
  });
}

function patchLogoImages() {
  forEach('img', function (img) {
    if (!isBrandLogoImage(img)) return;
    if (!isBrandContext(img)) return;
    var alt = img.getAttribute('alt');
    if (!hasFeature(img, 'data-jargon-orig-src')) {
      setOrig(img, 'src', img.getAttribute('src') || '');
      setOrig(img, 'alt', alt === null ? '' : alt);
      var srcset = img.getAttribute('srcset');
      if (srcset !== null) setOrig(img, 'srcset', srcset);
    }
    if (img.getAttribute('src') !== JARGON_LOGO) img.setAttribute('src', JARGON_LOGO);
    if (hasFeature(img, 'srcset')) img.removeAttribute('srcset');
    var nextAlt = alt === null || alt === '' ? 'Jargon' : alt.split('OpenMAIC').join('Jargon');
    if (img.getAttribute('alt') !== nextAlt) img.setAttribute('alt', nextAlt);
  });
}

function patchWordmarks() {
  forEach('*', function (el) {
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node || node.nodeType !== 3) continue;
      var trimmed = (node.data || '').trim();
      if (trimmed !== 'OpenMAIC' && trimmed !== 'OpenMAIC logo') continue;
      if (!isBrandContext(el)) continue;
      setOrig(el, 'text', node.data);
      node.data = node.data.replace(trimmed, 'Jargon');
    }
  });
}

function patchAnnouncementHeading() {
  var heading = announcementHeading();
  if (!heading) return;
  var nodes = heading.childNodes;
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (!node || node.nodeType !== 3) continue;
    var data = node.data || '';
    if (normalizeQuotes(data.trim()) !== ANNOUNCEMENT_TITLE) continue;
    setOrig(heading, 'announce', data);
    node.data = /^\s*/.exec(data)[0] + ANNOUNCEMENT_NEUTRAL + /\s*$/.exec(data)[0];
  }
}

function restoreOriginals() {
  forEach('*', function (el) {
    if (hasFeature(el, 'data-jargon-orig-src')) {
      el.setAttribute('src', el.getAttribute('data-jargon-orig-src'));
      el.removeAttribute('data-jargon-orig-src');
    }
    if (hasFeature(el, 'data-jargon-orig-srcset')) {
      el.setAttribute('srcset', el.getAttribute('data-jargon-orig-srcset'));
      el.removeAttribute('data-jargon-orig-srcset');
    }
    if (hasFeature(el, 'data-jargon-orig-alt')) {
      el.setAttribute('alt', el.getAttribute('data-jargon-orig-alt'));
      el.removeAttribute('data-jargon-orig-alt');
    }
    if (hasFeature(el, 'data-jargon-orig-aria')) {
      el.setAttribute('aria-label', el.getAttribute('data-jargon-orig-aria'));
      el.removeAttribute('data-jargon-orig-aria');
    }
    if (hasFeature(el, 'data-jargon-orig-announce')) {
      var announced = el.getAttribute('data-jargon-orig-announce');
      var announcedNodes = el.childNodes;
      for (var k = 0; k < announcedNodes.length; k++) {
        var candidate = announcedNodes[k];
        if (candidate && candidate.nodeType === 3 && candidate.data === ANNOUNCEMENT_NEUTRAL) {
          candidate.data = announced;
          break;
        }
      }
      el.removeAttribute('data-jargon-orig-announce');
    }
    if (hasFeature(el, 'data-jargon-orig-text')) {
      var original = el.getAttribute('data-jargon-orig-text');
      var nodes = el.childNodes;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].nodeType === 3 && (nodes[i].data || '').trim() === 'Jargon') {
          nodes[i].data = original;
          break;
        }
      }
      el.removeAttribute('data-jargon-orig-text');
    }
  });
}

var controller = null;
var paused = false;

function stop() {
  restoreOriginals();
  if (controller.observer) {
    try { controller.observer.disconnect(); } catch (e) {}
  }
  controller.observer = null;
  controller.permanent = true;
  paused = false;
}

function apply() {
  if (controller.permanent) return;
  if (!allowedLocation() || hasPasswordInput()) {
    stop();
    return;
  }
  if (hasAuthDialog()) {
    if (!paused) {
      restoreOriginals();
      paused = true;
    }
    return;
  }
  paused = false;
  patchAnnouncementHeading();
  patchAriaLabels();
  patchLogoImages();
  patchWordmarks();
}

try { controller = window.__jargonTeachingBranding || null; } catch (e) { controller = null; }
if (!controller || typeof controller !== 'object') {
  controller = {};
  window.__jargonTeachingBranding = controller;
}
controller.apply = apply;
controller.restore = stop;
if (!controller.observer && typeof MutationObserver !== 'undefined') {
  try {
    controller.observer = new MutationObserver(function () { apply(); });
    controller.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  } catch (e) {
    controller.observer = null;
  }
}
window.__jargonTeachingBrandingApply = function () { apply(); };
window.__jargonTeachingBrandingRestore = function () { stop(); };
apply();
})();`;
}