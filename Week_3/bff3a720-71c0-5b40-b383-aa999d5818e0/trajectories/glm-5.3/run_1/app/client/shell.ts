import { h } from './lib/els.js';
import { router } from './lib/router.js';
import { store } from './lib/store.js';
import { announcementsRegion, notificationsRegion } from './lib/announce.js';
import { openDialog } from './lib/dialog.js';
import { api } from './lib/api.js';

export function banner(): HTMLElement {
  const nav = h('nav', { role: 'navigation', 'aria-label': 'Main', class: 'nav' });
  const render = (): void => {
    nav.innerHTML = '';
    const links: Array<[string, string]> = [];
    if (!store.me) {
      links.push(['Search', '/search'], ['Offer a ride', '/offer'], ['Sign in', '/sign-in']);
    } else if (store.isFounder()) {
      links.push(['Search', '/search'], ['ID review', '/founder/id-review'], ['Network', '/founder/network']);
    } else {
      links.push(['Search', '/search'], ['Offer a ride', '/offer'], ['My rides', '/my-rides'], ['Wallet', '/wallet'], ['Earnings', '/earnings'], ['Profile', '/profile']);
    }
    for (const [label, path] of links) {
      const current = router.path === path;
      nav.append(h('a', { href: path, class: current ? 'current' : '' }, label));
    }
    if (store.me) {
      const btn = h('button', { type: 'button', class: 'ghost', onClick: async () => { await api('POST', '/api/auth/sign-out', {}); await store.refreshMe(); router.go('/'); } }, 'Sign out');
      nav.append(btn);
    }
  };
  render();
  store.subscribe(render);
  router.subscribe(render);

  const menuBtn = h('button', { type: 'button', class: 'btn menu-button', onClick: () => {
    const items = Array.from(nav.querySelectorAll('a, button')) as HTMLElement[];
    const { close } = openDialog({ label: 'Menu', sheet: true }, items.map(node => {
      const clone = node.cloneNode(true) as HTMLElement;
      if (clone instanceof HTMLAnchorElement) {
        clone.addEventListener('click', () => { close(); router.go(clone.getAttribute('href') ?? '/'); });
      } else {
        clone.addEventListener('click', () => { close(); node.click(); });
      }
      return clone;
    }));
  } }, 'Menu');

  return h('header', { class: 'banner' },
    h('a', { class: 'brand', href: '/' }, 'Longseat'),
    nav,
    menuBtn,
    announcementsRegion(),
    notificationsRegion(),
  );
}
