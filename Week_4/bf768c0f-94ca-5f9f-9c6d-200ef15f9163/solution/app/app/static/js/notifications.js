import { api, toast } from './app.js';
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-read]');
  if (!button) return;
  button.disabled = true;
  try {
    const data = await api(`/api/notifications/${button.dataset.read}/read`, { method: 'POST' });
    document.getElementById('unread-chip').textContent = `${data.unread} unread`;
    const badge = document.getElementById('unread-count');
    if (badge) { badge.textContent = String(data.unread); badge.classList.toggle('is-zero', data.unread === 0); }
    button.closest('[data-notification]').querySelector('.chip').classList.remove('good');
    button.remove();
  } catch (error) { toast(error.message, 'bad'); button.disabled = false; }
});
