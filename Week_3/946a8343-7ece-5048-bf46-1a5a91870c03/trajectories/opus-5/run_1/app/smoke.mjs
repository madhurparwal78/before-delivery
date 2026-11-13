import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const base = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT ?? 4173}`;
const username = process.argv[2] ?? 'asha';
const path = process.argv[3] ?? '/';

const session = await fetch(`${base}/api/grading/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username }),
});
const cookie = (session.headers.get('set-cookie') ?? '').split(';')[0];

const dom = new JSDOM(readFileSync('dist/public/index.html', 'utf8'), {
  url: `${base}${path}`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
window.fetch = async (input, init = {}) => {
  const url = String(input).startsWith('http') ? String(input) : `${base}${String(input)}`;
  const headers = { ...(init.headers ?? {}), cookie };
  return fetch(url, { ...init, headers });
};
window.WebSocket = class {
  constructor() {
    this.readyState = 0;
  }
  addEventListener() {}
  close() {}
  send() {}
};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.Element.prototype.animate = function animate() {
  return { id: '', cancel() {}, finish() {} };
};
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
window.addEventListener('error', (event) => {
  process.stderr.write(`page error: ${event.error?.stack ?? event.message}\n`);
  process.exitCode = 1;
});
window.eval(readFileSync('dist/public/app.js', 'utf8'));
await new Promise((resolve) => setTimeout(resolve, 1500));
const main = window.document.querySelector('main');
process.stdout.write(`--- ${path} as ${username}\n`);
process.stdout.write(`main data-seq=${main?.dataset.seq} data-pending=${main?.dataset.pending}\n`);
process.stdout.write(`${(main?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 400)}\n`);
const roles = [...window.document.querySelectorAll('[role], main h1, nav, aside')].slice(0, 400).map((node) => {
  const role = node.getAttribute('role') ?? node.tagName.toLowerCase();
  const name = node.getAttribute('aria-label') ?? '';
  return name === '' ? role : `${role} "${name}"`;
});
process.stdout.write(`${[...new Set(roles)].join(' | ')}\n`);
dom.window.close();
