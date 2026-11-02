/**
 * Renders the built client bundle inside jsdom against the running server,
 * catching runtime errors that TypeScript cannot.
 * Run: node scripts/ui-smoke.mjs (server must be running on :4173)
 */
import { JSDOM } from 'jsdom';

const BASE = 'http://localhost:4173';

const indexHtml = await (await fetch(`${BASE}/`)).text();
const dom = new JSDOM(indexHtml, { url: `${BASE}/signin`, pretendToBeVisual: true });
const { window } = dom;

// Browser shims the bundle expects
window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.scrollTo = () => undefined;
window.Element.prototype.scrollIntoView = () => undefined;
window.EventSource = class {
  constructor() {
    this.onopen = null;
    this.onerror = null;
  }
  addEventListener() {}
  close() {}
};
window.fetch = async (input, init) => {
  const res = await bridgeFetch(input, init);
  return { status: res.status, ok: res.ok, text: async () => res.text(), json: async () => res.json() };
};

process.on('uncaughtException', (e) => {
  console.log('UNCAUGHT:', e?.name, e?.message ?? '(no message)', String(e?.stack ?? '').split('\n').filter((l) => !l.includes('data:text')).slice(0, 4).join(' | '));
});
const nodeFetch = global.fetch;
async function bridgeFetch(input, init) {
  const url = typeof input === 'string' ? input : input.url;
  const absolute = url.startsWith('http') ? url : `${BASE}${url}`;
  const headers = new Headers(init?.headers ?? {});
  const cookie = window.document.cookie;
  if (cookie) headers.set('cookie', cookie);
  const res = await nodeFetch(absolute, { ...init, headers });
  for (const setCookie of res.headers.getSetCookie?.() ?? []) {
    const [pair] = setCookie.split(';');
    window.document.cookie = pair;
  }
  return res;
}
global.fetch = async (input, init) => {
  const res = await bridgeFetch(input, init);
  return { status: res.status, ok: res.ok, text: async () => res.text(), json: async () => res.json() };
};
const errors = [];
window.addEventListener('error', (e) => {
  const stackLines = String(e.error?.stack ?? '').split('\n');
  const short = stackLines
    .filter((l) => !l.includes('data:text'))
    .slice(0, 3)
    .join(' | ');
  errors.push(`${e.error?.name ?? 'Error'}: ${e.error?.message ?? e.message} @ ${short}`);
});
const realErrors = [];
const origErr = console.error;
console.error = (...args) => {
  const text = args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ').slice(0, 300);
  if (!text.includes('Warning:')) realErrors.push(text);
  origErr(...args);
};

global.window = window;
global.document = window.document;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
Object.defineProperty(global, 'location', { value: window.location, configurable: true });
global.HTMLElement = window.HTMLElement;
global.HTMLInputElement = window.HTMLInputElement;
global.HTMLTextAreaElement = window.HTMLTextAreaElement;
global.HTMLButtonElement = window.HTMLButtonElement;
global.HTMLSelectElement = window.HTMLSelectElement;
global.HTMLAnchorElement = window.HTMLAnchorElement;
global.Node = window.Node;
global.Event = window.Event;
global.KeyboardEvent = window.KeyboardEvent;
global.MouseEvent = window.MouseEvent;
global.CustomEvent = window.CustomEvent;
global.getComputedStyle = window.getComputedStyle;
global.history = window.history;
global.EventSource = window.EventSource;
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;
global.MutationObserver = class {
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
};
global.ResizeObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};

const scriptTag = [...window.document.querySelectorAll('script[src]')][0];
const srcUrl = new URL(scriptTag.getAttribute('src'), BASE).toString();
const code = await (await fetch(srcUrl)).text();
try {
  const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));
  console.log('bundle loaded, exports:', Object.keys(mod).length);
} catch (err) {
  console.error('BUNDLE FAILED:', String(err).slice(0, 400));
  process.exit(1);
}

await new Promise((resolve) => setTimeout(resolve, 2000));

const html = window.document.body.innerHTML;
const has = (needle) => console.log(html.includes(needle) ? `PASS ${needle}` : `FAIL ${needle}`);
has('Quarrystone Strata');
has('Sign in');

// Sign in programmatically
const emailInput = window.document.querySelector('input[type="email"]');
const passInput = window.document.querySelector('input[type="password"]');
if (emailInput && passInput) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(emailInput, process.env.SMOKE_EMAIL ?? 'lena.marsh@lakeshore-health.test');
  emailInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  setter.call(passInput, process.env.SMOKE_PASSWORD ?? 'strata-seed-2026');
  passInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  const form = window.document.querySelector('form');
  form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

const html2 = window.document.body.innerHTML;
console.log('--- after sign-in, html length:', html2.length);
for (const needle of ['Search catalog', 'src.members', 'Glossary', 'Lena Marsh']) {
  console.log(html2.includes(needle) ? `PASS after-signin ${needle}` : `FAIL after-signin ${needle}`);
}

// Open an asset and its column detail
const assetLink = [...window.document.querySelectorAll('button')].find((b) => b.textContent?.includes('src.members'));
assetLink?.click();
await new Promise((resolve) => setTimeout(resolve, 1500));
const html3 = window.document.body.innerHTML;
const stewardNeedles = process.env.SMOKE_EMAIL?.includes('dana') ?? false;
const assetNeedles = stewardNeedles
  ? ['Columns', 'member_id', 'full_name', 'Apply tag to selected', 'Tag to apply']
  : ['Columns', 'member_id', 'full_name'];
for (const needle of assetNeedles) {
  console.log(html3.includes(needle) ? `PASS asset-open ${needle}` : `FAIL asset-open ${needle}`);
}

// Open a column
const columnBtn = [...window.document.querySelectorAll('button')].find((b) => b.textContent === 'ssn');
columnBtn?.click();
await new Promise((resolve) => setTimeout(resolve, 1500));
const html4 = window.document.body.innerHTML;
const columnNeedles = stewardNeedles
  ? ['Column detail', 'Lineage canvas', 'Trace impact', 'Zoom in', 'Reset view', 'Trace summary', 'Lineage status', 'Withdraw PII']
  : ['Column detail', 'Lineage canvas', 'Trace impact', 'Zoom in', 'Reset view', '[masked]'];
for (const needle of columnNeedles) {
  console.log(html4.includes(needle) ? `PASS column-open ${needle}` : `FAIL column-open ${needle}`);
}
// Canvas nodes rendered
const nodes = window.document.querySelectorAll('[data-column]').length;
console.log(nodes > 0 ? `PASS canvas nodes (${nodes})` : 'FAIL canvas nodes');
console.log(!!window.document.querySelector('[data-sweep]') ? 'PASS canvas sweep attr' : 'FAIL canvas sweep attr');

// Trace impact as a steward
if (stewardNeedles) {
  const traceBtn = [...window.document.querySelectorAll('button')].find((b) => b.textContent === 'Trace impact');
  traceBtn?.click();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const group = window.document.querySelector('[data-sweep]');
  console.log(group?.getAttribute('data-sweep') === 'done' ? 'PASS sweep done' : `FAIL sweep state ${group?.getAttribute('data-sweep')}`);
  const count = window.document.querySelector('[data-sweep-count]')?.textContent;
  console.log(count === '5' ? `PASS sweep count ${count}` : `FAIL sweep count ${count}`);
  const litNodes = window.document.querySelectorAll('[data-lit="true"]').length;
  console.log(litNodes >= 6 ? `PASS lit nodes ${litNodes}` : `FAIL lit nodes ${litNodes}`);
  const drawnEdges = window.document.querySelectorAll('[data-drawn="true"]').length;
  console.log(drawnEdges >= 5 ? `PASS drawn edges ${drawnEdges}` : `FAIL drawn edges ${drawnEdges}`);
}

// Sign out
const signOutBtn = [...window.document.querySelectorAll('button')].find((b) => b.textContent === 'Sign out');
signOutBtn?.click();
await new Promise((resolve) => setTimeout(resolve, 1000));
console.log(
  window.document.body.innerHTML.includes('Sign in') ? 'PASS sign out returns to signin' : 'FAIL sign out'
);
if (errors.length > 0) console.log('WINDOW ERRORS:', errors.slice(0, 3));
if (realErrors.length > 0) console.log('REACT ERRORS:', realErrors.slice(0, 3));
process.exit(0);
