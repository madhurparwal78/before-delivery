// Trending: week steps and category presses, where the last press always wins.

import { api, element, latestInputGuard, signed, thousands, weekLabel } from './api.js';

const previousWeek = document.getElementById('previous-week');
const nextWeek = document.getElementById('next-week');
const label = document.getElementById('week-label');
const chipBar = document.getElementById('game-chips');
const body = document.getElementById('trending-body');
const guard = latestInputGuard();

let state = readAddress();
let payload = null;
let pendingSteps = 0;
let loading = false;

function readAddress() {
  const params = new URLSearchParams(window.location.search);
  return { week: params.get('week') || '', category: params.get('category') || 'all' };
}

function addressFor(next) {
  const parts = [];
  if (next.week) parts.push('week=' + next.week);
  if (next.category !== 'all') parts.push('category=' + next.category);
  return '/trending-games' + (parts.length ? '?' + parts.join('&') : '');
}

function gameFields(game, tag) {
  const children = [
    element('p', { class: 'rank', text: '#' + game.rank }),
    element('img', { src: game.cover_url, alt: '', width: 480, height: 270, loading: 'lazy' }),
    element('h2', {}, [element('a', { href: '/game/' + game.slug, text: game.name })]),
    element('p', { class: 'game-note', text: game.description }),
    element('p', { class: 'changes' }, [
      element('span', { text: 'Plays ' + signed(game.plays_change_pct) }),
      element('span', { text: 'Streams ' + signed(game.streams_change_pct) }),
    ]),
  ];
  if (game.community) {
    children.push(element('p', { class: 'game-community' }, [
      element('span', { text: thousands(game.community.member_count) + ' Members ' }),
      element('a', {
        href: '/servers/' + game.community.slug,
        text: 'Join ' + game.community.name,
      }),
    ]));
  }
  return element(tag, tag === 'article'
    ? { class: 'featured-game', 'aria-label': 'Featured game' }
    : {}, children);
}

function draw() {
  label.textContent = 'Week of ' + weekLabel(payload.week_date);
  previousWeek.disabled = !payload.prev_week_date;
  nextWeek.disabled = !payload.next_week_date;
  for (const chip of chipBar.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', chip.dataset.category === state.category ? 'true' : 'false');
  }
  if (!payload.games.length) {
    body.replaceChildren(element('p', {
      class: 'empty-line', text: 'No games in this category this week.',
    }));
    return;
  }
  const list = element('ol', { class: 'ranked-games', 'aria-label': 'Ranked games' },
    payload.games.slice(1).map((game) => gameFields(game, 'li')));
  body.replaceChildren(gameFields(payload.games[0], 'article'), list);
}

async function load() {
  const ticket = guard.start();
  loading = true;
  const query = new URLSearchParams();
  if (state.week) query.set('week', state.week);
  if (state.category !== 'all') query.set('category', state.category);
  const answer = await api('/api/trending-games' +
    (query.toString() ? '?' + query.toString() : ''));
  if (!guard.current(ticket)) return;
  loading = false;
  if (!answer.ok) {
    state = { week: '', category: 'all' };
    pendingSteps = 0;
    window.history.replaceState(state, '', '/trending-games');
    load();
    return;
  }
  payload = answer.data;
  draw();
  takeStep();
}

function go(next, replace) {
  state = next;
  const address = addressFor(state);
  if (replace) window.history.replaceState(state, '', address);
  else window.history.pushState(state, '', address);
  load();
}

// Steps pressed while an answer is still coming are kept, so the last press wins.
function stepWeek(direction) {
  pendingSteps += direction;
  takeStep();
}

function takeStep() {
  if (!payload || pendingSteps === 0 || loading) return;
  const target = pendingSteps < 0 ? payload.prev_week_date : payload.next_week_date;
  if (!target) {
    pendingSteps = 0;
    return;
  }
  pendingSteps -= Math.sign(pendingSteps);
  go({ ...state, week: target }, false);
}

previousWeek.addEventListener('click', () => stepWeek(-1));
nextWeek.addEventListener('click', () => stepWeek(1));
chipBar.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) go({ ...state, category: chip.dataset.category }, false);
});
window.addEventListener('popstate', () => {
  state = readAddress();
  pendingSteps = 0;
  load();
});

load();
