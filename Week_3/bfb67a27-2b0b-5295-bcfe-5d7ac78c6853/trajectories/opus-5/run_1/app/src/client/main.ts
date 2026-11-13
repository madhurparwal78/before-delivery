import { COPY } from './copy.js';
import { clear, el } from './dom.js';
import { mountServiceNotice } from './notice.js';
import { renderCatalogue } from './pages/catalogue.js';
import { renderKitSheet } from './pages/kit.js';
import { renderBookingPage } from './pages/booking.js';
import { renderDeskSignIn } from './pages/desk.js';
import { renderCounter } from './pages/counter.js';
import { renderOwnerDesk } from './pages/owner.js';

function renderNotFound(root: HTMLElement): void {
  clear(root);
  const page = el('div', { class: 'page page-not-found' });
  root.append(page);
  mountServiceNotice(page);
  page.append(
    el('div', { class: 'sheet' }, [
      el('h1', { class: 'kit-name' }, [COPY.notFoundHeading]),
      el('a', { href: '/', class: 'sheet-open' }, ['Back to the catalogue']),
    ]),
  );
}

async function route(root: HTMLElement): Promise<void> {
  const path = window.location.pathname;
  if (path === '/') return renderCatalogue(root);
  const kit = /^\/kits\/([^/]+)$/.exec(path);
  if (kit !== null) return renderKitSheet(root, decodeURIComponent(kit[1] as string));
  const booking = /^\/bookings\/([^/]+)$/.exec(path);
  if (booking !== null) return renderBookingPage(root, decodeURIComponent(booking[1] as string));
  if (path === '/desk') return renderDeskSignIn(root);
  if (path === '/desk/counter') return renderCounter(root);
  if (path === '/desk/owner') return renderOwnerDesk(root);
  renderNotFound(root);
}

const root = document.getElementById('app');
if (root !== null) {
  void route(root).catch(() => {
    renderNotFound(root);
  });
}
