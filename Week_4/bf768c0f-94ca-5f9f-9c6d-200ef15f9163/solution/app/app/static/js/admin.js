import { api, showFieldError, toast } from './app.js';
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-void]');
  if (!button) return;
  showFieldError('void-error', '');
  button.disabled = true;
  try {
    const entries = await api(`/api/admin/games/${button.dataset.void}/void`, { method: 'POST' });
    toast(`Voided. ${entries.length} ratings rewritten.`);
    window.setTimeout(() => window.location.reload(), 700);
  } catch (error) { showFieldError('void-error', error.message); button.disabled = false; }
});
