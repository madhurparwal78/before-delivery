import { api, toast } from './app.js';
document.querySelectorAll('[data-join-club]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await api(`/api/clubs/${button.dataset.joinClub}/join`, { method: 'POST' });
      window.location.reload();
    } catch (error) { toast(error.message, 'bad'); }
  });
});
