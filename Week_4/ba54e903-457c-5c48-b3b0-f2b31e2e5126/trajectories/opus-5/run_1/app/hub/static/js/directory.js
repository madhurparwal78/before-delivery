// The directory: the latest input always wins, and the address always matches it.

import { api, element, latestInputGuard, thousands } from './api.js';

const search = document.getElementById('directory-q');
const chipBar = document.getElementById('category-chips');
const results = document.getElementById('directory-results');
const grid = document.getElementById('directory-grid');
const empty = document.getElementById('directory-empty');
const paging = document.getElementById('directory-paging');
const reset = document.getElementById('reset-filters');
const guard = latestInputGuard();
const PER_PAGE = 12;

let state = readAddress();
let typingTimer = null;

function readAddress() {
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get('page') || '1');
  return {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

function addressFor(next) {
  const parts = [];
  if (next.q.trim()) parts.push('q=' + encodeURIComponent(next.q.trim()));
  if (next.category !== 'all') parts.push('category=' + next.category);
  if (next.page > 1) parts.push('page=' + next.page);
  return '/servers' + (parts.length ? '?' + parts.join('&') : '');
}

function card(community) {
  const banner = element('img', {
    class: 'card-banner', src: community.splash_url, alt: '',
    width: 800, height: 300, loading: 'lazy',
  });
  const icon = element('img', {
    class: 'card-icon', src: community.icon_url, alt: community.name + ' icon',
    width: 72, height: 72,
  });
  const heading = element('h2', {}, [
    element('a', { href: '/servers/' + community.slug, text: community.name }),
  ]);
  const children = [banner, icon, heading];
  if (community.verified) children.push(element('p', { class: 'badge', text: 'Verified' }));
  else if (community.partnered) children.push(element('p', { class: 'badge', text: 'Partnered' }));
  children.push(element('p', { class: 'card-description', text: community.description }));
  children.push(element('p', { class: 'card-counts' }, [
    element('span', { text: thousands(community.presence_count) + ' Online' }),
    element('span', { text: thousands(community.member_count) + ' Members' }),
  ]));
  return element('article', { class: 'community-card' }, children);
}

function draw(payload) {
  grid.replaceChildren(...payload.data.map(card));
  const total = payload.total;
  results.textContent = total === 0
    ? 'No communities match your search.'
    : total === 1 ? '1 community' : total + ' communities';
  empty.hidden = total !== 0;
  paging.replaceChildren();
  if (state.page > 1) {
    paging.appendChild(element('a', {
      href: addressFor({ ...state, page: state.page - 1 }),
      id: 'previous-page', text: 'Previous page',
    }));
  }
  if (state.page * PER_PAGE < total) {
    paging.appendChild(element('a', {
      href: addressFor({ ...state, page: state.page + 1 }),
      id: 'next-page', text: 'Next page',
    }));
  }
  for (const chip of chipBar.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', chip.dataset.category === state.category ? 'true' : 'false');
  }
  if (search.value !== state.q) search.value = state.q;
}

async function load() {
  const ticket = guard.start();
  const query = new URLSearchParams();
  if (state.q.trim()) query.set('q', state.q.trim());
  if (state.category !== 'all') query.set('category', state.category);
  query.set('page', String(state.page));
  let answer;
  try {
    answer = await api('/api/servers?' + query.toString(), { token: null });
  } catch (error) {
    if (guard.current(ticket)) results.textContent = 'Communities could not be loaded. Try again.';
    return;
  }
  if (!guard.current(ticket)) return;
  if (!answer.ok) {
    results.textContent = 'Communities could not be loaded. Try again.';
    return;
  }
  draw(answer.data);
}

function go(next, replace) {
  state = next;
  const address = addressFor(state);
  if (replace) window.history.replaceState(state, '', address);
  else window.history.pushState(state, '', address);
  load();
}

search.addEventListener('input', () => {
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => {
    go({ q: search.value, category: state.category, page: 1 }, true);
  }, 200);
});

chipBar.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  go({ q: search.value, category: chip.dataset.category, page: 1 }, false);
});

reset.addEventListener('click', () => {
  search.value = '';
  go({ q: '', category: 'all', page: 1 }, false);
});

paging.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  const page = link.id === 'next-page' ? state.page + 1 : state.page - 1;
  go({ ...state, page }, false);
});

window.addEventListener('popstate', () => {
  state = readAddress();
  search.value = state.q;
  load();
});

window.history.replaceState(state, '', addressFor(state));
