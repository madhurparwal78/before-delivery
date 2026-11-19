// The private frame: skip link, header, main navigation, Lock workspace, and the tonight verdict card.
import { h } from './core/dom.js';
import { api } from './core/api.js';
import { icon } from './core/icons.js';
import { createVerdictCard } from './core/verdict-card.js';

const REFRESH_MS = 60000;

const SCREENS = [
  ['plan', 'Plan', '/plan'],
  ['projects', 'Projects', '/projects'],
  ['sessions', 'Sessions', '/sessions'],
  ['library', 'Library', '/library'],
  ['site', 'Site', '/site'],
];

function brand() {
  return h('a', { class: 'brand', href: '/plan', 'aria-label': 'Darkframe' },
    h('img', { src: '/assets/favicon.svg', alt: '', width: 28, height: 28 }),
    h('span', { class: 'brand-name' }, 'Darkframe'));
}

async function lockWorkspace() {
  await api('POST', '/api/lock-workspace');
  history.replaceState(null, '', '/unlock');
  document.body.className = '';
  await (await import('./pages/unlock.js')).mount();
}

function navigation(page) {
  return h('nav', { class: 'main-nav', 'aria-label': 'Main' },
    h('ul', {}, SCREENS.map(([name, label, href]) => h('li', {},
      h('a', { href, 'aria-current': name === page ? 'page' : null }, icon(name), h('span', {}, label))))));
}

// mountShell({page, withCard}) -> {main, card, refresh}
export function mountShell({ page, withCard = true }) {
  const title = SCREENS.find(([name]) => name === page)[1];
  document.title = `${title} - Darkframe`;
  document.body.classList.add(`page-${page}`);
  const main = h('main', { id: 'main', class: `page-${page}`, tabindex: '-1' });
  const lock = h('button', { type: 'button', class: 'btn btn--ghost lock-button', onclick: lockWorkspace },
    icon('lock', 20), h('span', {}, 'Lock workspace'));
  document.getElementById('app').replaceChildren(
    h('a', { class: 'skip-link', href: '#main' }, 'Skip to content'),
    h('header', { class: 'site-header' }, brand(), navigation(page), lock),
    main);

  const card = withCard ? createVerdictCard() : null;
  let timer = 0;
  async function refresh() {
    clearTimeout(timer);
    try {
      card.paint(await api('GET', '/api/tonight'));
    } catch {
      // The card keeps its last figures; the next tick tries again.
    }
    timer = setTimeout(refresh, REFRESH_MS);
  }
  if (withCard) {
    card.showLoading();
    main.append(card.element);
    refresh();
  }
  return { main, card, refresh };
}
