import { el, liveRegion, say } from './dom.js';
import { FOOTER_COPY, PENDING_COPY, SUCCESS_COPY, refusalCopy } from './copy.js';
import { currentAccount, onAccountChange, signOut } from './session.js';
import { navigate } from './router.js';
import { openDialog } from './dialog.js';
import { ApiFailure } from './api.js';

const NAV_LINKS: readonly { readonly label: string; readonly href: string }[] = [
  { label: 'Overview', href: '/#overview' },
  { label: 'Experiences', href: '/#experiences' },
  { label: 'TPS Record', href: '/#tps-record' },
  { label: 'Agenda', href: '/#agenda' },
  { label: 'Speakers', href: '/#speakers' },
  { label: 'Sponsors', href: '/#sponsors' },
];

export const accountMessages = liveRegion('Account messages', 'live account-messages');

export function sayAccount(message: string | null): void {
  say(accountMessages, message);
}

function navigation(): HTMLElement {
  return el(
    'nav',
    { class: 'topbar-nav', 'aria-label': 'Main' },
    NAV_LINKS.map((link) => el('a', { href: link.href, text: link.label })),
  );
}

function accountControls(): HTMLElement {
  const account = currentAccount();
  const wrapper = el('div', { class: 'account-controls' });
  if (account === null) {
    wrapper.appendChild(el('a', { class: 'account-link', href: signInHref(), text: 'Sign in' }));
    return wrapper;
  }
  wrapper.appendChild(el('span', { class: 'account-name', text: account.name }));
  wrapper.appendChild(
    account.role === 'organiser'
      ? el('a', { class: 'account-link', href: '/organiser', text: 'Organiser' })
      : el('a', { class: 'account-link', href: '/my-agenda', text: 'My Agenda' }),
  );
  const out = el('button', { class: 'account-signout', type: 'button', text: 'Sign out' });
  out.addEventListener('click', () => {
    void runSignOut();
  });
  wrapper.appendChild(out);
  return wrapper;
}

async function runSignOut(): Promise<void> {
  sayAccount(PENDING_COPY.signout);
  try {
    await signOut();
    sayAccount(SUCCESS_COPY.signout);
    navigate('/agenda');
  } catch (error) {
    sayAccount(refusalCopy(error instanceof ApiFailure ? error.code : 'outage'));
  }
}

export function signInHref(): string {
  const here = `${location.pathname}${location.search}`;
  return here === '/signin' || here === '/signup' ? '/signin' : `/signin?next=${encodeURIComponent(here)}`;
}

function menuSheet(opener: HTMLButtonElement): void {
  const panel = el('div', { class: 'menu-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu' });
  const close = el('button', { class: 'menu-close', type: 'button' }, [
    el('span', { class: 'icon icon-close', 'aria-hidden': 'true' }),
    el('span', { text: 'Close menu' }),
  ]);
  panel.append(close, navigation(), accountControls());
  const handle = openDialog(panel, close, opener, () => {
    opener.setAttribute('aria-expanded', 'false');
  });
  opener.setAttribute('aria-expanded', 'true');
  close.addEventListener('click', () => handle.close());
}

export function buildChrome(): { readonly header: HTMLElement; readonly footer: HTMLElement } {
  const bar = el('div', { class: 'topbar-inner' });
  const header = el('header', { class: 'chrome' }, [
    el('div', { class: 'banner-strip' }, [
      el('a', { href: '/agenda', text: 'Keel Outpost starts this week. Final seats →' }),
    ]),
    el('div', { class: 'topbar' }, [bar]),
  ]);

  const paint = (): void => {
    const menu = el('button', { class: 'menu-button', type: 'button', 'aria-expanded': 'false' }, [
      el('span', { class: 'icon icon-menu', 'aria-hidden': 'true' }),
      el('span', { text: 'Menu' }),
    ]);
    menu.addEventListener('click', () => menuSheet(menu));
    bar.replaceChildren(
      el('a', { class: 'wordmark', href: '/', text: 'Keel' }),
      navigation(),
      accountControls(),
      menu,
      accountMessages,
    );
  };
  paint();
  onAccountChange(paint);

  const footer = el('footer', { class: 'chrome-footer' }, [el('p', { text: FOOTER_COPY })]);
  return { header, footer };
}
