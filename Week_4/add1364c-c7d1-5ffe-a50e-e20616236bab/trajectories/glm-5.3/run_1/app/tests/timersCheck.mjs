/* DP-61: independent hide timers and the dialog-preserving behaviour, rendered in jsdom. */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync('/app/dist/client/index.html', 'utf8');
const appJs = readFileSync('/app/dist/client/assets/app.js', 'utf8');
const BASE = 'http://localhost:4173';

const checks = [];
function check(name, ok, detail) {
  checks.push([name, ok]);
  if (!ok) console.log(`FAIL  ${name} -> ${detail ?? ''}`);
}

const signIn = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'deandra', password: 'KeysKept-2026' })
});
const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0];
const answer = await signIn.json();

const dom = new JSDOM(html, {
  url: `${BASE}${answer.landing}`,
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
dom.window.fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('Cookie', cookie);
  return fetch(new URL(String(input), BASE).href, { ...init, headers });
};
dom.window.EventSource = class {
  constructor(url) { this.url = url; }
  addEventListener(name, listener) { /* noop */ }
  close() {}
};

// jsdom has no clipboard: stub it so Copy succeeds.
dom.window.navigator.clipboard = { writeText: async () => undefined };

let error = null;
try {
  dom.window.eval(appJs);
} catch (e) {
  error = e;
}
check('app evaluated without error', error === null, String(error));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(1500);

const doc = dom.window.document;
const text = () => doc.body.textContent ?? '';

// The drawer rendered with Deandra's vaults (Payroll, Banking, Vendor portals)
check('deandra lands on the drawer', text().includes('Payroll'), text().slice(0, 120));
check('deandra sees no night ruler', !text().includes('Lockset turns at midnight'));
check('deandra sees no pending rules', !text().includes('Pending rules'));
check('DP-15 deandra gets no back of the drawer', !text().includes('Back of the drawer'));

// Open the Vendor portals folder, where the EFIN account lives
const vendorTab = Array.from(doc.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent.includes('Vendor portals'));
vendorTab?.click();
await sleep(1200);

// Reveal the EFIN account
const revealButtons = Array.from(doc.querySelectorAll('button')).filter((b) => b.textContent.startsWith('Reveal '));
check('reveal buttons exist', revealButtons.length > 0, `buttons: ${revealButtons.length}`);
const efinButton = revealButtons.find((b) => b.textContent.includes('EFIN account'));
check('EFIN reveal button found', Boolean(efinButton), revealButtons.map((b) => b.textContent).join(','));
efinButton?.click();
await sleep(1200);
check('DP-04 secret appears in the slip', text().includes('Efile-maple-2020!'), text().slice(0, 400));
check('DP-58 hide button replaces reveal', Array.from(doc.querySelectorAll('button')).some((b) => b.textContent === 'Hide EFIN account'));

// Copy the practice admin (Vendor portals vault)
const copyButton = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === 'Copy Practice admin');
copyButton?.click();
await sleep(800);
check('DP-04 copy announces', text().includes('Practice admin copied.'), text().slice(0, 500));

// Open the Turn dialog and type into New password
const turnButton = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === 'Turn EFIN account');
turnButton?.click();
await sleep(600);
const dialog = doc.querySelector('[role="dialog"]');
check('DP-06 turn dialog opens', Boolean(dialog), 'no dialog');
const newPassword = dialog?.querySelector('input[type="password"]');
check('DP-06 new password field present', Boolean(newPassword));
if (newPassword) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setter.call(newPassword, 'Typed-while-waiting-77');
  newPassword.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
await sleep(300);
const typedValue = dialog?.querySelector('input[type="password"]')?.value ?? '';
check('DP-06 typed text present in the dialog', typedValue === 'Typed-while-waiting-77', typedValue);

// Twenty seconds later, reveal a second login; its own timer must not hide the first early
await sleep(20000);
const practiceReveal = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === 'Reveal Practice admin');
practiceReveal?.click();
await sleep(800);
check('DP-04 second secret appears', text().includes('Tally-room-door-41'));

// The first secret is still shown 20+ seconds after its reveal (its own timer runs)
check('DP-61 first secret still shown before its own timer', text().includes('Efile-maple-2020!'), 'first secret hidden early');

// Wait past the first slip's 30 seconds; the dialog must still be open with its typed text
await sleep(11000);
const dialogAfter = doc.querySelector('[role="dialog"]');
check('DP-61 dialog stays open after a hide timer fires', Boolean(dialogAfter), 'dialog closed');
const typedAfter = dialogAfter?.querySelector('input[type="password"]')?.value ?? '';
check('DP-61 typed text kept', typedAfter === 'Typed-while-waiting-77', typedAfter);
check('DP-61 first secret hidden after its own 30 seconds', !text().includes('Efile-maple-2020!'), 'secret still shown');
check('DP-61 hidden announcement', text().includes('EFIN account hidden.'), text().slice(0, 600));
check('DP-61 second secret still shown on its own timer', text().includes('Tally-room-door-41'), 'second secret hidden early');

let pass = 0;
for (const [name, ok] of checks) if (ok) pass += 1;
console.log(`timer checks: ${pass}/${checks.length} passed`);
process.exit(pass === checks.length ? 0 : 1);
