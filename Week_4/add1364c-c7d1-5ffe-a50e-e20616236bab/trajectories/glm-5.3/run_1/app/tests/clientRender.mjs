/* Renders the built client against the running server and checks the landing and sign-in. */

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync('/app/dist/client/index.html', 'utf8');
const appJs = readFileSync('/app/dist/client/assets/app.js', 'utf8');

function makeDom(url) {
  const dom = new JSDOM(html, {
    url: `http://localhost:4173${url}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const window = dom.window;
  // fetch against the real server
  window.fetch = (input, init) =>
    fetch(input , init );
  window.EventSource = class {
    constructor(url) { this.url = url; }
    addEventListener(name, listener) { /* noop */ }
    close() {}
  };
  // run the bundle
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = appJs;
  window.document.body.appendChild(scriptEl);
  window.eval(appJs);
  return dom;
}

async function textAfterRender(dom) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return dom.window.document.body.textContent ?? '';
}

// 1. Landing renders the hero
const landing = makeDom('/');
const landingText = await textAfterRender(landing);
const checks = [];
checks.push(['landing headline', landingText.includes('KEYS KEPT HERE')]);
checks.push(['landing sentence', landingText.includes('One drawer for every login the office shares')]);
checks.push(['landing open the drawer', landingText.includes('Open the drawer')]);
checks.push(['landing sign in link', landingText.includes('Sign in')]);
for (const folder of ['Payroll', 'Banking', 'Hosting', 'Vendor portals', 'Office']) {
  checks.push([`landing folder ${folder}`, landingText.includes(folder)]);
}

// 2. Sign-in screen
const signInDom = makeDom('/sign-in');
const signInText = await textAfterRender(signInDom);
checks.push(['sign-in username label', signInText.includes('Username')]);
checks.push(['sign-in password label', signInText.includes('Password')]);
checks.push(['sign-in button', signInText.includes('Sign in')]);

// 3. Sign in and land on the drawer (through the real API)
const signInResponse = await fetch('http://localhost:4173/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'marta', password: 'KeysKept-2026' })
});
const cookie = (signInResponse.headers.get('set-cookie') ?? '').split(';')[0];
const signInAnswer = await signInResponse.json();
checks.push(['sign-in 201', signInResponse.status === 201]);
checks.push(['landing route is first vault', signInAnswer.landing === '/desk/vaults/v-payroll']);

// 4. Drawer renders with the office manager's surfaces
const drawerDom = new JSDOM(html, {
  url: `http://localhost:4173${signInAnswer.landing}`,
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
drawerDom.window.fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('Cookie', cookie);
  return fetch(new URL(String(input), 'http://localhost:4173').href, { ...init, headers });
};
drawerDom.window.EventSource = class {
  constructor(url) { this.url = url; }
  addEventListener(name, listener) { /* noop */ }
  close() {}
};
try { drawerDom.window.eval(appJs); } catch (error) {
  checks.push(['drawer app evaluated', false, String(error)]);
}
await new Promise((resolve) => setTimeout(resolve, 1500));
const drawerText = drawerDom.window.document.body.textContent ?? '';
checks.push(['drawer night ruler region', drawerText.includes('Lockset turns at midnight')]);
checks.push(['drawer pending rules', drawerText.includes('Pending rules')]);
checks.push(['drawer vault tabs', drawerText.includes('Payroll') && drawerText.includes('Banking')]);
checks.push(['drawer open folder heading', drawerText.includes('At least')]);
checks.push(['drawer back of the drawer', drawerText.includes('Back of the drawer')]);
checks.push(['drawer top bar clock', /CST|CDT/.test(drawerText)]);

let pass = 0;
for (const [name, ok] of checks) {
  if (ok) pass += 1;
  else console.log(`FAIL  ${name}`);
}
console.log(`client render checks: ${pass}/${checks.length} passed`);
if (pass !== checks.length) process.exit(1);

process.exit(0);
