// The game page, drawn for whoever is signed in right now.

import { api, element, latestInputGuard, signed, weekLabel } from './api.js';

const page = document.querySelector('.game-page');
const communityLine = document.getElementById('game-community');
const historyBody = document.getElementById('history-body');
const guard = latestInputGuard();

async function load() {
  const ticket = guard.start();
  const answer = await api('/api/games/' + page.dataset.slug);
  if (!guard.current(ticket) || !answer.ok) return;
  const game = answer.data;
  if (game.community) {
    communityLine.replaceChildren(element('a', {
      href: '/servers/' + game.community.slug,
      text: 'Join ' + game.community.name,
    }));
  } else {
    communityLine.textContent = 'Community not available.';
  }
  historyBody.replaceChildren(...game.history.map((entry) => element('tr', {}, [
    element('td', { text: 'Week of ' + weekLabel(entry.week_date) }),
    element('td', { text: String(entry.rank) }),
    element('td', { text: signed(entry.plays_change_pct) }),
    element('td', { text: signed(entry.streams_change_pct) }),
  ])));
}

window.addEventListener('pageshow', load);
load();
