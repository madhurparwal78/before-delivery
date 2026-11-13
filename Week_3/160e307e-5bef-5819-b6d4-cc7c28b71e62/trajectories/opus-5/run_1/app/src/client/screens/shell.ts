import { el } from '../dom.js';
import { state } from '../store.js';

/** The top bar: profile link, chalk balance, shop and leaderboard. */
export function topbar(): HTMLElement {
  const me = state.me;
  const name = me?.name ?? 'Guest';
  return el('div', { class: 'topbar' }, [
    el('a', { href: `/profile/${encodeURIComponent(name)}`, 'aria-label': `${name} profile`, text: `${name} profile` }),
    el('span', { id: 'chalk-balance', class: 'num', text: `${me?.chalk ?? 0} chalk` }),
    el('span', { class: 'spacer' }),
    el('a', { href: '/shop', text: 'Shop' }),
    el('a', { href: '/leaderboard', text: 'Leaderboard' }),
  ]);
}

export function emptyState(word: string, link: { href: string; label: string }): HTMLElement {
  return el('div', { class: 'empty-state' }, [
    el('p', { class: 'crop-word', text: word }),
    el('a', { href: link.href, class: 'hero__cta', text: link.label }),
  ]);
}
