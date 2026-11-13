import { api } from './api.ts';
import { announce, h, statusRegion } from './dom.ts';
import { ANNOUNCE, MAIL_NOTICE, ROLE_WORD, STORAGE_NOTICE } from '../shared/copy.ts';
import type { Role, ServiceNotice } from '../shared/types.ts';
import { navigate } from './router.ts';

export interface Frame {
  root: HTMLElement;
  main: HTMLElement;
  serviceNotice: HTMLElement;
  accountNotice: HTMLElement;
  setRole: (role: Role) => void;
  setNotice: (notice: ServiceNotice) => void;
}

const NAV_LINKS: ReadonlyArray<[string, string]> = [
  ['Documents', '/documents'],
  ['Templates', '/templates'],
  ['Team', '/team'],
];

export const buildFrame = (currentPath: string, role: Role): Frame => {
  const nav = h(
    'nav',
    { 'aria-label': 'Main', class: 'main-nav' },
    ...NAV_LINKS.map(([label, href]) =>
      h(
        'a',
        {
          href,
          class: 'nav-link',
          'aria-current': currentPath.startsWith(href) ? 'page' : null,
        },
        label,
      ),
    ),
  );
  const signOut = h('button', { type: 'button', class: 'button quiet' }, 'Sign out');
  signOut.addEventListener('click', () => {
    void (async () => {
      await api.signOut();
      navigate('/sign-in');
    })();
  });

  const serviceNotice = statusRegion('Service notice', 'notice');
  const accountNotice = statusRegion('Account notice', 'notice');
  const main = h('main', { class: 'main' });
  let shownRole: Role | null = role;

  const root = h(
    'div',
    { class: 'frame' },
    h(
      'header',
      { class: 'top-bar' },
      h('span', { class: 'product' }, 'Undersign'),
      nav,
      signOut,
    ),
    serviceNotice,
    accountNotice,
    main,
  );

  return {
    root,
    main,
    serviceNotice,
    accountNotice,
    setRole: (next: Role) => {
      if (shownRole === next) return;
      shownRole = next;
      announce(accountNotice, ANNOUNCE.roleChanged(ROLE_WORD[next]));
    },
    setNotice: (notice: ServiceNotice) => {
      const text = !notice.storage ? STORAGE_NOTICE : !notice.mail ? MAIL_NOTICE : '';
      if (serviceNotice.textContent !== text) serviceNotice.textContent = text;
      serviceNotice.classList.toggle('shown', text !== '');
    },
  };
};
