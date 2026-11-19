/** The play menu: a member, the house, or a position to work through. */

import { api, toast, fieldError } from './app.js';
import { sendChallenge } from './challenge-form.js';

sendChallenge();

api('GET', '/api/members?limit=100').then((members) => {
  const list = document.getElementById('member-names');
  if (!list) return;
  list.innerHTML = members.map((member) => `<option value="${member.username}"></option>`).join('');
}).catch(() => {});

document.getElementById('house-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  fieldError('house-error', '');
  const form = new FormData(event.target);
  try {
    const game = await api('POST', '/api/computer-games', {
      level: form.get('level'),
      colour: form.get('colour'),
    });
    window.location.href = `/game/${game.id}`;
  } catch (error) {
    fieldError('house-error', error.message);
  }
});

document.getElementById('study-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  fieldError('study-fen-error', '');
  const form = new FormData(event.target);
  const body = { fen: String(form.get('fen')).trim() };
  const level = form.get('level');
  if (level) body.level = level;
  try {
    const game = await api('POST', '/api/games/from-fen', body);
    window.location.href = `/game/${game.id}`;
  } catch (error) {
    fieldError('study-fen-error', error.message);
  }
});
