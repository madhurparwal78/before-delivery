import { h, clear, esc } from './dom';
import { toastHost } from './dom';

export interface TopbarModel {
  personName: string | null;
  unread: number;
  active: 'mywork' | 'goals' | 'inbox' | null;
}

export function renderTopbar(root: HTMLElement, model: TopbarModel): void {
  clear(root);
  const bar = h('header', { class: 'topbar' });
  const mark = h('span', { class: 'logomark', 'aria-hidden': 'true' });
  mark.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="9" cy="13" r="6.5" stroke="#e2554a" stroke-width="2.5"/><circle cx="17" cy="13" r="6.5" stroke="#17181a" stroke-width="2.5"/></svg>`;
  const brand = h('a', { class: 'wordmark', href: '/' }, mark, 'Everyweek');
  bar.append(brand);

  if (model.personName) {
    const links = h('nav', { class: 'navlinks', 'aria-label': 'Main' },
      h('a', { class: 'navlink', href: '/', 'aria-current': model.active === 'mywork' ? 'page' : '' }, 'My work'),
      h('a', { class: 'navlink', href: '/goals', 'aria-current': model.active === 'goals' ? 'page' : '' }, 'Goals'),
      h('a', { class: 'navlink', href: '/inbox', id: 'inbox-link', 'aria-current': model.active === 'inbox' ? 'page' : '' }, `Inbox, ${model.unread} unread`),
    );
    bar.append(links);
    const account = h('button', { class: 'pill quiet', onclick: () => { window.location.href = '/account'; } }, model.personName);
    bar.append(h('span', { class: 'spacer' }), account);
    const menuBtn = h('button', { class: 'pill quiet menubtn', 'aria-expanded': 'false', 'aria-controls': 'mobmenu', style: 'display:none' }, 'Menu');
    bar.append(menuBtn);
    const mob = h('div', { id: 'mobmenu', hidden: true },
      h('a', { href: '/', onclick: () => void 0 }, 'My work'),
      h('a', { href: '/goals' }, 'Goals'),
      h('a', { href: '/inbox' }, `Inbox, ${model.unread} unread`),
      h('a', { href: '/account' }, 'Account'));
    mob.style.display = 'none';
    bar.append(mob);
    menuBtn.addEventListener('click', () => {
      const open = menuBtn.getAttribute('aria-expanded') === 'true';
      menuBtn.setAttribute('aria-expanded', String(!open));
      mob.hidden = open;
      mob.style.display = open ? 'none' : 'grid';
      mob.style.position = 'absolute';
      mob.style.top = '56px';
      mob.style.left = '12px';
      mob.style.background = 'var(--paper)';
      mob.style.border = '1px solid var(--line)';
      mob.style.borderRadius = '12px';
      mob.style.padding = '12px';
      mob.style.display = open ? 'none' : 'grid';
      mob.style.gap = '4px';
      mob.style.zIndex = '46';
      mob.querySelectorAll('a').forEach(a => { (a as HTMLElement).style.padding = '10px 14px'; });
    });
  } else {
    bar.append(h('span', { class: 'spacer' }),
      h('a', { class: 'navlink', href: '/account' }, 'Log in'),
      h('a', { class: 'pill outline', href: '/f/supply-request' }, 'Try the sample form'),
      h('a', { class: 'pill primary', href: '/account' }, 'Get started'));
  }

  root.append(bar);
  window.addEventListener('scroll', () => {
    bar.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
}

export function toast(text: string): void {
  toastHost().show(text);
}

export function outageBand(root: HTMLElement, show: boolean): void {
  let band = root.querySelector<HTMLElement>('.outage');
  if (show && !band) {
    band = h('div', { class: 'outage', role: 'alert' }, 'File storage is unavailable. Everything else keeps working.');
    const tb = root.querySelector('.topbar');
    tb ? tb.after(band) : root.prepend(band);
  } else if (!show && band) {
    band.remove();
  }
}

export function fmtDateAttr(d: string | null): string { return d ?? ''; }

export function escText(s: string): string { return esc(s); }
