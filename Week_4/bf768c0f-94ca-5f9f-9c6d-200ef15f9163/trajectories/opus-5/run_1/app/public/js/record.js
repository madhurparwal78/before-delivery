/** The record screen: import a record and open it as a game. */

import { api, fieldError } from './app.js';

document.getElementById('import-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  fieldError('import-error', '');
  const text = document.getElementById('import-text').value;
  try {
    const game = await api('POST', '/api/games/import', { record: text });
    window.location.href = `/game/${game.id}`;
  } catch (error) {
    fieldError('import-error', error.message);
  }
});
