import { mountRegions } from './announce.js';
import { clear, h } from './dom.js';
import { currentMember, isFounder, setMember, type Member } from './state.js';
import { api } from './api.js';
import { openDialog } from './components/dialog.js';
import { navigate } from './router.js';

export interface NavItem {
  label: string;
  path: string;
}

function itemsFor(member: Member | null): NavItem[] {
  if (!member) {
    return [
      { label: 'Search', path: '/search' },
      { label: 'Offer a ride', path: '/offer' },
      { label: 'Sign in', path: '/sign-in' },
    ];
  }
  if (isFounder(member)) {
    return [
      { label: 'Search', path: '/search' },
      { label: 'ID review', path: '/founder/id-review' },
      { label: 'Network', path: '/founder/network' },
    ];
  }
  return [
    { label: 'Search', path: '/search' },
    { label: 'Offer a ride', path: '/offer' },
    { label: 'My rides', path: '/my-rides' },
    { label: 'Wallet', path: '/wallet' },
    { label: 'Earnings', path: '/earnings' },
    { label: 'Profile', path: '/profile' },
  ];
}

function signOutButton(): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class: 'nav-signout',
    text: 'Sign out',
    onclick: async () => {
      await api<void>('POST', '/api/auth/sign-out');
      setMember(null);
      renderBanner();
      navigate('/');
    },
  });
}

function navLinks(member: Member | null): HTMLElement {
  const nav = h('nav', { 'aria-label': 'Main', class: 'nav' });
  for (const item of itemsFor(member)) {
    nav.appendChild(h('a', { href: item.path, text: item.label, class: 'nav-link' }));
  }
  if (member) nav.appendChild(signOutButton());
  return nav;
}

let bannerBox: HTMLElement;
let mainBox: HTMLElement;

export function mainRegion(): HTMLElement {
  return mainBox;
}

export function renderBanner(): void {
  const member = currentMember();
  clear(bannerBox);
  bannerBox.appendChild(
    h('a', { href: '/', class: 'brand', text: 'Longseat', 'aria-label': 'Longseat' }),
  );
  bannerBox.appendChild(navLinks(member));
  const menuButton = h('button', {
    type: 'button',
    class: 'menu-button',
    text: 'Menu',
  });
  menuButton.addEventListener('click', () => {
    openDialog({
      name: 'Menu',
      opener: menuButton,
      sheet: true,
      build: ({ close }) => {
        const sheet = navLinks(currentMember());
        sheet.addEventListener('click', (event) => {
          if ((event.target as HTMLElement).tagName === 'A') close();
        });
        return [sheet];
      },
    });
  });
  bannerBox.appendChild(menuButton);
}

export function mountShell(root: HTMLElement): void {
  bannerBox = h('header', { class: 'banner' });
  mainBox = h('main', { class: 'main' });
  const announcements = h('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
    'aria-label': 'Announcements',
    class: 'announcements',
  });
  const notifications = h('div', {
    role: 'region',
    'aria-label': 'Notifications',
    class: 'notifications',
  });
  root.append(bannerBox, mainBox, announcements, notifications);
  mountRegions(announcements, notifications);
  renderBanner();
}
