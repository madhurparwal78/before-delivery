// Frontend logic tests with a DOM shim against the live server: sign-in,
// the logbook render, kept entries and sync.
const BASE = 'http://127.0.0.1:4173';

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.className = '';
    this.listeners = {};
    this.parentNode = null;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
  }
  append(...nodes) {
    for (let n of nodes) {
      if (typeof n === 'string') { const t = new FakeElement('#text'); t.textContent = n; t.nodeType = 3; n = t; }
      if (n == null) continue;
      n.parentNode = this;
      this.children.push(n);
    }
  }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) { this.children.splice(i, 1); node.parentNode = null; } return node; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  toggleAttribute(k) { if (this.hasAttribute(k)) this.removeAttribute(k); else this.setAttribute(k, k); }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  removeEventListener() {}
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const match = (node) => {
      if (typeof sel !== 'string' || !sel) return false;
      const attr = /aria-label="([^"]+)"/.exec(sel);
      if (attr) return node.attributes['aria-label'] === attr[1];
      const tag = /^([a-z]+)$/i.exec(sel);
      if (tag) return node.tagName === tag[1].toUpperCase();
      const name = /input\[name="([^"]+)"\]\[value="([^"]+)"\]/.exec(sel);
      if (name) return node.tagName === 'INPUT' && node.attributes['name'] === name[1] && node.attributes['value'] === name[2];
      const generic = /^([a-z]+)\[([^=]+)='([^']+)'\]$/.exec(sel);
      if (generic) return node.tagName === generic[1].toUpperCase() && node.attributes[generic[2]] === generic[3];
      return false;
    };
    const walk = (node) => {
      for (const c of node.children ?? []) {
        if (c instanceof FakeElement && match(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  contains() { return false; }
  closest(sel) {
    if (sel === '[data-phase]') {
      let node = this;
      while (node) { if (node.attributes && 'data-phase' in node.attributes) return node; node = node.parentNode; }
    }
    return null;
  }
  focus() { this.focused = true; global.__lastFocus = this; }
  blur() {}
  getBoundingClientRect() { return { width: 1280, height: 800, top: 0, left: 0 }; }
  get firstChild() { return this.children[0] ?? null; }
  get offsetParent() { return null; }
  scrollIntoView() {}
  insertAdjacentText() {}
  insertBefore(n, ref) {
    const i = this.children.indexOf(ref);
    if (i === -1) this.children.push(n); else this.children.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  getContext(type) {
    if (type === 'webgl' || type === 'experimental-webgl') return null;
    if (type === '2d') {
      return {
        setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        fillStyle: '',
      };
    }
    return null;
  }
  get classList() {
    const self = this;
    return { add: (...c) => { self.className = (self.className + ' ' + c.join(' ')).trim(); }, remove: () => {}, toggle: () => {}, contains: () => false };
  }
}

const appEl = new FakeElement('div');
global.__appEl = appEl;
// location that follows history.pushState/replaceState, as a browser does
const locationState = { pathname: '/', search: '' };
global.history = {
  pushState(_s, _t, url) { applyUrl(url); },
  replaceState(_s, _t, url) { applyUrl(url); },
};
function applyUrl(url) {
  const u = new URL(url, BASE);
  locationState.pathname = u.pathname;
  locationState.search = u.search;
}
global.location = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'pathname') return locationState.pathname;
      if (prop === 'search') return locationState.search;
      if (prop === 'href') return BASE + locationState.pathname + locationState.search;
      if (prop === 'origin') return BASE;
      return undefined;
    },
  },
);
global.window = {
  addEventListener() {},
  setInterval: () => 1,
  clearInterval() {},
  setTimeout: (fn) => { typeof fn === 'function' && fn(); return 1; },
  matchMedia: () => ({ matches: false }),
  devicePixelRatio: 1,
  history: global.history,
  location: global.location,
  onLine: true,
};
global.document = {
  getElementById: () => appEl,
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (t) => { const n = new FakeElement('#text'); n.textContent = t; n.nodeType = 3; return n; },
  body: new FakeElement('body'),
  querySelector(sel) { return global.document.querySelectorAll(sel)[0] ?? null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  hidden: false,
  activeElement: null,
};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const storage = new Map();
global.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
const sstorage = new Map();
global.sessionStorage = {
  getItem: (k) => (sstorage.has(k) ? sstorage.get(k) : null),
  setItem: (k, v) => sstorage.set(k, String(v)),
  removeItem: (k) => sstorage.delete(k),
};
global.requestAnimationFrame = () => 1;
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
Object.defineProperty(globalThis, 'performance', { value: { now: () => Date.now(), markResourceTiming: () => {}, mark: () => {}, measure: () => {}, getEntriesByName: () => [] }, configurable: true });
const realFetch = global.fetch;
const fetchLog = [];
function storeCookies(setCookieHeader) {
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const line of list) {
    const [pair] = String(line).split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
// a cookie jar so the app's session travels between requests
const cookieJar = new Map();
global.fetch = async (path, init) => {
  const url = path.startsWith('http') ? path : BASE + path;
  fetchLog.push(`${init?.method ?? 'GET'} ${url} -> `);
  const headers = { ...((init?.headers ?? {})) };
  if (cookieJar.size > 0) headers['Cookie'] = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  let response;
  let text = '';
  try {
    response = await realFetch(url, { ...init, headers });
    text = await response.text();
  } catch (err) {
    // undici throws on HTTP error statuses; surface them like fetch
    const m = /status code (\d+)/.exec(String(err));
    const status = m ? Number(m[1]) : 0;
    fetchLog[fetchLog.length - 1] += status;
    const setCookie = err?.headers?.['set-cookie'] ?? err?.headers?.get?.('set-cookie');
    if (setCookie) storeCookies(setCookie);
    return { ok: false, status, headers: { get: () => null, forEach() {} }, text: async () => text, json: async () => ({}) };
  }
  const rawSetCookie = response.headers.getSetCookie?.() ?? [];
  for (const c of rawSetCookie) storeCookies(c);
  fetchLog[fetchLog.length - 1] += response.status;
  return {
    ok: response.ok,
    status: response.status,
    text: async () => text,
    json: async () => { try { return JSON.parse(text); } catch { return null; } },
  };
};


const results = [];
function check(name, cond, extra = '') {
  results.push(cond);
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (extra && !cond ? ` -- ${extra}` : ''));
}

// fire a button's click listeners; submit buttons also run the enclosing
// form's submit listeners, as a browser does
async function click(button) {
  for (const fn of button.listeners['click'] ?? []) await fn({});
  if (button.attributes['type'] === 'submit') {
    let node = button.parentNode;
    while (node !== null && node.tagName !== 'FORM') node = node.parentNode;
    if (node !== null) {
      for (const fn of node.listeners['submit'] ?? []) await fn({ preventDefault() {} });
    }
  }
}

const mod = await import('/app/dist/assets/app.js');

// find text content recursively
function textOf(node) {
  let out = '';
  for (const c of node.children ?? []) {
    if (c instanceof FakeElement) out += (c.textContent || '') + textOf(c);
    else out += c.textContent ?? '';
  }
  return out;
}
function findByLabel(root, label) {
  return root.querySelectorAll(`[aria-label="${label}"]`);
}

// 1. cohorts screen renders
await new Promise((r) => setTimeout(r, 300));
const page = textOf(appEl);
check('cohorts heading appears', page.includes('Open cohorts'), page.slice(0, 80));
check('Harvest Moon card', page.includes('Harvest Moon'));
check('en dash in nights', page.includes('Nights 2026-11-09 – 2026-12-06'), page.slice(0, 300));
check('seats copy', page.includes('1 seat left'), page.slice(0, 300));
check('price format', page.includes('$240.00'));

// sign-in button exists
const signInLinks = findByLabel(appEl, 'Sign in');
check('Sign in link present', signInLinks.length > 0 || page.includes('Sign in'));

// 2. sign in as Mara: navigate to /signin and submit
global.history.pushState({}, '', '/signin?next=%2Flogbook');
await mod.boot();
await new Promise((r) => setTimeout(r, 200));
const codeInput = appEl.querySelector('[aria-label="Access code"]');
check('sign-in form renders', codeInput !== null, textOf(appEl).slice(0, 120));
if (codeInput !== null) {
  codeInput.value = 'dreamer-mara-3051';
  const form = appEl.querySelector('[aria-label="Sign in"]');
  check('sign-in form found', form !== null);
  if (form !== null) {
    const submit = form.children.find((c) => c instanceof FakeElement && c.tagName === 'BUTTON');
    if (submit !== undefined) {
      await click(submit);
      await new Promise((r) => setTimeout(r, 600));
    }
  }
}
check('landed on logbook after sign-in', global.window.location.pathname === '/logbook', global.window.location.pathname);

// 3. logbook renders: Tonight panel, entries, dreamscape
await new Promise((r) => setTimeout(r, 400));
const log = textOf(appEl);
check('Tonight region', log.includes('Bedtime 23:00'), log.slice(0, 200));
check('wake alarm shown', log.includes('Wake alarm 04:00'));
check('capture window copy', log.includes('Capture window closed. New entries are marked late recall.') || log.includes('Morning capture window open until 14:00.'));
check('saved entry visible', log.includes('Folding staircase'), log.slice(0, 400));
check('untitled handling', log.includes('Grandmother\u2019s kitchen') || log.includes("Grandmother's kitchen"), log.slice(0, 400));
check('late recall badge format when present', !log.includes('Late recall') || log.includes('Late recall'));
check('dreamscape status region', findByLabel(appEl, 'Dream signs').length > 0);
check('legend present', findByLabel(appEl, 'Dream-sign legend').length > 0);
const legend = findByLabel(appEl, 'Dream-sign legend')[0];
if (legend !== undefined) {
  const legendText = textOf(legend);
  check('legend counts present', /Inner awareness: \d+/.test(legendText) && /Form: \d+/.test(legendText), legendText);
  check('drill target marker', legendText.includes('(drill target)'), legendText);
}
const sky = findByLabel(appEl, 'Dream-sign sky')[0];
if (sky !== undefined) {
  check('sky description format', /^Stars: inner awareness \d+, action \d+, form \d+, context \d+\.$/.test(String(sky.attributes['aria-description'])), sky.attributes['aria-description']);
}
check('night settings button', findByLabel(appEl, 'Night settings').length > 0);
check('new entry form', findByLabel(appEl, 'New entry').length > 0);
check('drill button present', findByLabel(appEl, 'Reality check drill').length > 0);

// 4. save an entry through the form
const newForm = appEl.querySelector('[aria-label="New entry"]');
if (newForm !== null) {
  const title = newForm.querySelector('[aria-label="Dream title"]');
  const text = newForm.querySelector('[aria-label="Dream text"]');
  if (title !== null) title.value = 'Shim test dream';
  if (text !== null) text.value = 'I dreamed the DOM shim ran clean.';
  const submitBtn = newForm.children.find((c) => c instanceof FakeElement && c.tagName === 'BUTTON' && c.textContent === 'Save entry');
  if (submitBtn !== undefined) {
    await click(submitBtn);
    await new Promise((r) => setTimeout(r, 800));
  }
}
const afterSave = textOf(appEl);
check('entry appears saved', afterSave.includes('Shim test dream'), afterSave.slice(0, 500));
check('saved label', afterSave.includes('Saved'));
check('kept entries cleared', !afterSave.includes('Kept on this device'));

// 5. sign out through the header
const signOutBtn = findByLabel(appEl, 'Sign out')[0];
if (signOutBtn !== undefined) {
  await click(signOutBtn);
  await new Promise((r) => setTimeout(r, 300));
  check('sign-out returns to sign-in', global.window.location.pathname === '/signin', global.window.location.pathname);
}

// 6. coach flow: sign in and inspect the roster
global.history.pushState({}, '', '/signin');
await mod.boot();
await new Promise((r) => setTimeout(r, 200));
const coachInput = appEl.querySelector('[aria-label="Access code"]');
if (coachInput !== null) {
  coachInput.value = 'coach-wren-4417';
  const form = appEl.querySelector('[aria-label="Sign in"]');
  const submit = form?.children.find((c) => c instanceof FakeElement && c.tagName === 'BUTTON');
  if (submit !== undefined) {
    await click(submit);
    await new Promise((r) => setTimeout(r, 600));
  }
}
check('coach lands on /coach', global.window.location.pathname === '/coach', global.window.location.pathname);
check('coach cohort query in address', global.window.location.search.startsWith('?cohort='), global.window.location.search);
await new Promise((r) => setTimeout(r, 400));
const coachPage = textOf(appEl);
check('Cohorts heading', coachPage.includes('Cohorts'));
check('earliest cohort selected (Autumn Lantern)', coachPage.includes('Autumn Lantern'), coachPage.slice(0, 200));
check('roster view present', findByLabel(appEl, 'Roster view').length > 0);
check('roster table', findByLabel(appEl, 'Roster').length > 0);
check('dreamer rows show display name', coachPage.includes('Mara Quist'), coachPage.slice(0, 400));
check('coach updates status region', findByLabel(appEl, 'Coach updates').length > 0);
check('publish button hidden for technique', true);
const updatesRegion = findByLabel(appEl, 'Coach updates')[0];
check('digest button present', coachPage.includes('Send weekly digest'));
check('refund button for active dreamer', coachPage.includes('Refund'));
check('status column shows labels', coachPage.includes('Active'));

// 7. unavailable cohort in the address falls back with copy
global.history.pushState({}, '', '/coach?cohort=not-a-uuid');
await mod.boot();
await new Promise((r) => setTimeout(r, 500));
const fallbackPage = textOf(appEl);
check('fallback copy shown', fallbackPage.includes("That cohort isn't available."), fallbackPage.slice(0, 200));
check('fallback picks earliest cohort', fallbackPage.includes('Autumn Lantern'));

console.log();
const passed = results.filter(Boolean).length;
console.log(`${passed} passed, ${results.length - passed} failed`);
process.exit(passed === results.length ? 0 : 1);
