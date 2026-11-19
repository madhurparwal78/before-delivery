// The desk shell: rail or Menu, the settlement time, and the desk live regions.

import { post } from './api.js';
import { Dialog } from './dialog.js';
import { el, liveRegion } from './dom.js';
import { DESK, currentBand, onBandChange } from './breakpoints.js';
import { navigate } from './router.js';
import { settlementTimer } from './timers.js';

const LINKS = {
  analyst: [
    ['Window board', '/windows'],
    ['Statement check', '/check'],
  ],
  verifier: [
    ['Review queue', '/review'],
    ['Statement check', '/check'],
  ],
  lead: [
    ['Group scores', '/group'],
    ['Window board', '/windows'],
    ['Statement check', '/check'],
  ],
};

function navigation(role) {
  const links = (LINKS[role] || []).map(([text, href]) =>
    el('a', { href, text, dataset: { route: href } })
  );
  links.forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(link.getAttribute('href'));
    })
  );
  return el('nav', { 'aria-label': 'Desk', className: 'rail__links' }, links);
}

export function deskShell(account) {
  const main = el('main', { className: 'shell__main' });
  const menuButton = el('button', { type: 'button', text: 'Menu', className: 'menu-button' });
  const signOut = el('button', { type: 'button', text: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await post('/api/auth/sign-out');
    navigate('/sign-in');
  });
  let menu = null;
  menuButton.addEventListener('click', () => {
    menu = new Dialog({ name: 'Menu', sheet: 'dialog--sheet-bottom' });
    menu.bodyNode.append(navigation(account.role));
    const close = el('button', { type: 'button', text: 'Close' });
    close.addEventListener('click', () => menu.close());
    menu.buttonsNode.append(close);
    menu.onClose = () => {
      menu = null;
    };
  });
  onBandChange((next) => {
    if (next === DESK && menu) {
      const dialog = menu;
      menu = null;
      dialog.closed = true;
      dialog.node.remove();
      if (dialog.scrim) dialog.scrim.remove();
      const first = rail.querySelector('nav a');
      if (first) first.focus();
    }
  });
  const rail = el('div', { className: 'rail' }, [navigation(account.role)]);
  const top = el('div', { className: 'shell__top' }, [
    el('span', { className: 'shell__brand', text: 'Hourproof' }),
    menuButton,
    settlementTimer(),
    signOut,
  ]);
  const root = el('div', { className: 'shell' }, [
    top,
    rail,
    main,
    liveRegion('Desk status', 'status'),
    liveRegion('Desk alert', 'alert'),
  ]);
  if (currentBand() === DESK) menuButton.setAttribute('hidden', '');
  onBandChange((next) => {
    if (next === DESK) menuButton.setAttribute('hidden', '');
    else menuButton.removeAttribute('hidden');
  });
  return { root, main };
}
