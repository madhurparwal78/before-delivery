/** Marking a notification read lowers the count by exactly one. */

import { api, toast, refreshUnread } from './app.js';

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-mark-read]');
  if (!button) return;
  button.disabled = true;
  try {
    const result = await api('POST', `/api/notifications/${button.dataset.markRead}/read`);
    const row = button.closest('.notification-row');
    row?.classList.remove('is-unread');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = 'read';
    button.replaceWith(chip);
    const counter = document.getElementById('unread-count');
    if (counter) {
      counter.textContent = String(result.unread);
      counter.dataset.unread = String(result.unread);
    }
    refreshUnread();
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
});
