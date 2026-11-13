// Entry for every page: shows a pending flash, wires sign-out, opens the one socket, mounts the page module.
import { boot } from './lib/boot.js';
import { render, html } from './lib/html.js';
import { live } from './lib/live.js';
import { api } from './lib/api.js';
import { takeFlash } from './lib/flash.js';

function showFlash() {
  const text = takeFlash();
  const root = document.getElementById('root');
  if (!text || !root) return;
  const bar = document.createElement('div');
  bar.className = 'bar flash';
  bar.setAttribute('role', 'note');
  bar.textContent = text;
  root.before(bar);
}

function wireSignOut() {
  const button = document.querySelector('[data-sign-out]');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    await api.del('/api/session', { keepOn401: true });
    location.assign('/sign-in');
  });
}

async function main() {
  showFlash();
  wireSignOut();
  const root = document.getElementById('root');
  const module = await import(`./pages/${boot.page}.js`);
  // A page that opens a socket says so: a stakeholder's /me and the public pages open none.
  if (module.socket !== false && boot.user && boot.user.role !== 'stakeholder') live.start(module.announce);
  if (module.mount) module.mount(root, boot);
  else render(html`<${module.default} />`, root);
}

main();
