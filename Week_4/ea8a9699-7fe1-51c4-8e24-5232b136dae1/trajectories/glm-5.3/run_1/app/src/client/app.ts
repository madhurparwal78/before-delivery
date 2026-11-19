// The app shell: the shared chrome (top bar).

import { el, link, signOut } from './lib.js';
import type { Account } from '../shared/types.js';

export function topBar(opts: { account: Account | null; currentSlug?: string; bare?: boolean }): HTMLElement {
  const acc = opts.account;
  const bar = el('header', { class: 'topbar' });
  bar.append(el('span', { class: 'wordmark' }, 'Rushes'));

  const navLinks: HTMLElement[] = [];
  navLinks.push(link('/explore', 'Explore'));
  if (acc && (acc.role === 'designer' || acc.role === 'ops_lead')) {
    const slug = opts.currentSlug ?? acc.workspaces[0]?.slug;
    if (slug) navLinks.push(link(`/w/${slug}`, 'Wall'));
  }
  if (acc && acc.role === 'ops_lead' && opts.currentSlug) {
    navLinks.push(link(`/w/${opts.currentSlug}/admin`, 'Admin'));
  }

  const nav = el('nav', { class: 'main-nav', 'aria-label': 'Main' }, ...navLinks);

  if (opts.bare) {
    // The review page leaves out Wall, Admin, the brand name and the switcher.
    bar.append(nav, accountControl(acc));
    return bar;
  }

  const menuButton = el('button', {
    class: 'menu-button',
    'aria-expanded': 'false',
    'aria-controls': 'main-nav-panel',
  }, 'Menu');

  menuButton.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) nav.querySelector('a')?.focus();
  });
  const closeMenu = (): void => {
    nav.classList.remove('nav-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.focus();
  };
  nav.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  });
  menuButton.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  });

  bar.append(menuButton, nav);

  if (acc && (acc.role === 'designer' || acc.role === 'ops_lead')) {
    if (acc.role === 'ops_lead' && acc.workspaces.length > 1) {
      const select = el('select', { class: 'ws-switcher', 'aria-label': 'Brand workspace' }) as HTMLSelectElement;
      for (const ws of acc.workspaces) {
        const opt = el('option', { value: ws.slug }, ws.name);
        if (ws.slug === opts.currentSlug) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        window.location.href = `/w/${select.value}`;
      });
      bar.append(select);
    } else {
      const wsName = acc.workspaces.find((w) => w.slug === opts.currentSlug)?.name ?? acc.workspaces[0]?.name;
      if (wsName) bar.append(el('span', { class: 'ws-name' }, wsName));
    }
  }

  bar.append(accountControl(acc));
  return bar;
}

function accountControl(acc: Account | null): HTMLElement {
  const wrap = el('div', { class: 'account-control' });
  if (!acc) {
    wrap.append(link('/signin', 'Sign in'));
    return wrap;
  }
  wrap.append(
    el('span', { class: 'account-name' }, acc.displayName),
    el('button', {
      class: 'btn btn-ghost',
      onclick: async () => {
        await signOut();
        window.location.href = '/explore';
      },
    }, 'Sign out'),
  );
  return wrap;
}
