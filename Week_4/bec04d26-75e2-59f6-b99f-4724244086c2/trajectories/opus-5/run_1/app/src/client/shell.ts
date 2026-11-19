import { App, MAIL_BANNER, PDF_BANNER } from './app';
import { focusDialog } from './components/dialog';
import { append, clear, el } from './dom';
import { renderAuth } from './screens/auth';
import { renderCatalogue } from './screens/catalogue';
import { renderClients } from './screens/clients';
import { renderDialogForState } from './screens/dialogs';
import { renderHome } from './screens/home';
import { renderMonth } from './screens/month';
import { renderNotFound } from './screens/notfound';
import { renderReturn } from './screens/returnScreen';
import { renderSettings } from './screens/settings';
import { renderStates } from './screens/states';
import { renderToday } from './screens/today';
import { renderYear } from './screens/year';

const NAV: readonly { label: string; href: string }[] = [
  { label: 'Today', href: '/today' },
  { label: 'Catalogue', href: '/catalogue' },
  { label: 'Month', href: '/month' },
  { label: 'Year', href: '/year' },
  { label: 'Clients', href: '/clients' },
  { label: 'States', href: '/states' },
  { label: 'Settings', href: '/settings' },
];

interface Frame {
  notice: HTMLElement;
  bar: HTMLElement;
  announcements: HTMLElement;
  screen: HTMLElement;
  overlay: HTMLElement;
}

let frame: Frame | null = null;

/**
 * Writes one line into the announcement region. Each line is a separate change
 * to the region, so a batch announces one line per event in its given order.
 */
export function writeAnnouncement(text: string): void {
  const root = document.getElementById('shell');
  if (!root) return;
  const built = ensureFrame(root);
  built.announcements.textContent = text;
}

/**
 * The announcement region and the service notice are built once and never
 * replaced, so a live region keeps its identity for assistive technology.
 */
function ensureFrame(root: HTMLElement): Frame {
  if (frame && root.contains(frame.announcements)) return frame;
  clear(root);
  const built: Frame = {
    notice: el('div', { 'data-frame': 'notice' }),
    bar: el('div', { 'data-frame': 'bar' }),
    announcements: el('p', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Duefield announcements',
      class: 'announcements',
    }),
    screen: el('div', { 'data-frame': 'screen' }),
    overlay: el('div', { 'data-frame': 'overlay' }),
  };
  append(root, [built.notice, built.bar, built.announcements, built.screen, built.overlay]);
  frame = built;
  return built;
}

function navLink(app: App, item: { label: string; href: string }): HTMLElement {
  const current = app.state.path === item.href || app.state.path.startsWith(`${item.href}/`);
  return el(
    'li',
    {},
    el(
      'a',
      {
        href: item.href,
        'data-link': 'true',
        'data-focus-key': `nav:${item.label}`,
        'aria-current': current ? 'page' : null,
      },
      item.label,
    ),
  );
}

function signOutButton(app: App): HTMLElement {
  return el(
    'button',
    {
      type: 'button',
      'data-focus-key': 'sign-out',
      onClick: () => {
        void app.signOut();
      },
    },
    'Sign out',
  );
}

function topBar(app: App): HTMLElement | null {
  const me = app.state.me;
  if (!me) return null;
  if (me.user.role === 'owner') {
    const clientName =
      app.state.detail?.client.name ?? app.state.returns[0]?.client.name ?? '';
    return el(
      'header',
      { class: 'top-bar' },
      el('p', { class: 'wordmark' }, 'Duefield'),
      clientName ? el('p', { class: 'client-name' }, clientName) : null,
      signOutButton(app),
    );
  }
  return el(
    'header',
    { class: 'top-bar' },
    el('p', { class: 'wordmark' }, 'Duefield'),
    el(
      'nav',
      { class: 'main-nav', 'aria-label': 'Main' },
      el('ul', {}, ...NAV.map((item) => navLink(app, item))),
    ),
    signOutButton(app),
  );
}

function serviceNotice(app: App): HTMLElement | null {
  const me = app.state.me;
  if (!me || me.user.role !== 'bookkeeper') return null;
  const banners: string[] = [];
  if (!app.state.services.mail) banners.push(MAIL_BANNER);
  if (!app.state.services.pdf) banners.push(PDF_BANNER);
  if (banners.length === 0) return null;
  return el(
    'div',
    { role: 'region', 'aria-label': 'Service notice' },
    ...banners.map((copy) => el('p', { class: 'banner' }, copy)),
  );
}

function screenFor(app: App): HTMLElement {
  if (app.state.notFound) return renderNotFound();
  const route = app.route();
  switch (route.kind) {
    case 'sign-in':
    case 'sign-up':
      return renderAuth(app, route.kind);
    case 'today':
      return renderToday(app);
    case 'catalogue':
      return renderCatalogue(app);
    case 'month':
      return renderMonth(app, route.month ?? app.currentMonth());
    case 'year':
      return renderYear(app, route.year ?? app.currentYear());
    case 'clients':
      return renderClients(app);
    case 'states':
      return renderStates(app);
    case 'settings':
      return renderSettings(app);
    case 'return':
      return renderReturn(app);
    case 'home':
      return renderHome(app);
    case 'not-found':
      return renderNotFound();
  }
}

function replace(host: HTMLElement, content: HTMLElement | null): void {
  clear(host);
  if (content) host.appendChild(content);
}

export function renderShell(app: App): void {
  const root = document.getElementById('shell');
  if (!root) return;
  const current = ensureFrame(root);

  replace(current.notice, serviceNotice(app));
  replace(current.bar, topBar(app));
  if (current.announcements.textContent !== app.state.announcement) {
    current.announcements.textContent = app.state.announcement;
  }

  replace(current.screen, app.state.booted ? screenFor(app) : el('div', { class: 'screen' }));

  const dialog = app.state.dialog ? renderDialogForState(app) : null;
  replace(current.overlay, dialog);
  if (!dialog) {
    app.state.dialogFocused = false;
    return;
  }
  if (!app.state.dialogFocused || app.state.dialogRefocus) {
    app.state.dialogFocused = true;
    app.state.dialogRefocus = false;
    app.focusClaimed = true;
    focusDialog(dialog);
  }
}
