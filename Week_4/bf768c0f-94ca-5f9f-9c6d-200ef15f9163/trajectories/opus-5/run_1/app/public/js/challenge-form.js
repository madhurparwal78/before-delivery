/** The challenge form, shared by the play menu and the challenges page. */

import { api, toast, fieldError } from './app.js';

export function sendChallenge(onSent) {
  const form = document.getElementById('challenge-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    fieldError('challenge-error', '');
    fieldError('challenge-opponent-error', '');
    const data = new FormData(form);
    const opponent = String(data.get('opponent') || '').trim();
    if (!opponent) {
      fieldError('challenge-opponent-error', 'Name the member you are challenging.');
      return;
    }
    try {
      const challenge = await api('POST', '/api/challenges', {
        opponent,
        colour: data.get('colour') || 'Random',
        rated: data.get('rated') !== null,
        club: data.get('club') || undefined,
      });
      const note = document.getElementById('challenge-note');
      if (note) note.textContent = `Challenge sent to ${opponent}. You take ${challenge.colour}.`;
      form.reset();
      toast(`Challenge sent to ${opponent}.`);
      if (onSent) onSent(challenge);
    } catch (error) {
      if (error.status === 404) fieldError('challenge-opponent-error', error.message);
      else fieldError('challenge-error', error.message);
    }
  });
}
