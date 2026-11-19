/** Voiding a rated game, with its audit. */

import { api, toast } from './app.js';

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-void]');
  if (!button) return;
  if (!window.confirm('Void this rated game? Every later rated game of both players is recomputed.')) return;
  button.disabled = true;
  try {
    const audits = await api('POST', `/api/admin/games/${button.dataset.void}/void`);
    const names = audits.map((audit) => `${audit.member} ${audit.rating_before} to ${audit.rating_after}`).join('; ');
    toast(`Voided. ${names}. Later rated games recomputed: ${audits[0]?.recomputed_games ?? 0}.`);
    window.setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
});
