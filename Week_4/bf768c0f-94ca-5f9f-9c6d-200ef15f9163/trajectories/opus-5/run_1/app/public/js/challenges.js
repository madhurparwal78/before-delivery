/** Challenges: accept creates the game at once; a new one arrives on its own. */

import { api, toast } from './app.js';
import { sendChallenge } from './challenge-form.js';

sendChallenge(() => window.setTimeout(() => window.location.reload(), 400));

document.addEventListener('click', async (event) => {
  const accept = event.target.closest('[data-accept]');
  if (accept) {
    accept.disabled = true;
    try {
      const game = await api('POST', `/api/challenges/${accept.dataset.accept}/accept`, undefined, {
        'Idempotency-Key': crypto.randomUUID(),
      });
      window.location.href = `/game/${game.id}`;
    } catch (error) {
      accept.disabled = false;
      toast(error.message, 'error');
    }
    return;
  }
  const decline = event.target.closest('[data-decline]');
  if (decline) {
    decline.disabled = true;
    try {
      await api('POST', `/api/challenges/${decline.dataset.decline}/decline`);
      decline.closest('.challenge-row')?.remove();
      toast('Challenge declined.');
    } catch (error) {
      decline.disabled = false;
      toast(error.message, 'error');
    }
  }
});

/** A challenge that arrives while the page is open shows without a reload. */
const known = new Set([...document.querySelectorAll('[data-challenge-id]')].map((node) => node.dataset.challengeId));

async function poll() {
  try {
    const challenges = await api('GET', '/api/challenges');
    const received = challenges.filter((challenge) => challenge.direction === 'received');
    const list = document.getElementById('received-list');
    for (const challenge of received) {
      if (known.has(challenge.id)) continue;
      known.add(challenge.id);
      if (!list) {
        window.location.reload();
        return;
      }
      const item = document.createElement('li');
      item.className = 'challenge-row';
      item.dataset.challengeId = challenge.id;
      item.innerHTML = `<img class="challenge-avatar" src="${challenge.opponent_avatar_url}" width="40" height="40" alt="">
        <span class="challenge-text"><strong></strong>
          <span class="challenge-meta">${challenge.rated ? 'Rated' : 'Unrated'} · they take ${challenge.colour}</span>
        </span>
        <span class="challenge-actions">
          <button type="button" class="button button-primary" data-accept="${challenge.id}">Accept</button>
          <button type="button" class="button button-quiet" data-decline="${challenge.id}">Decline</button>
        </span>`;
      item.querySelector('strong').textContent = challenge.opponent;
      list.prepend(item);
      toast(`${challenge.opponent} has challenged you.`);
    }
  } catch { /* the next tick will try again */ }
}

window.setInterval(poll, 3000);
