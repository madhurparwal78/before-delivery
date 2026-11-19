import { api, toast } from './app.js';

// One control per member: it reads the stored block and flips it.
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-block-toggle]');
  if (!button) return;
  const name = button.dataset.blockToggle;
  const blocked = button.getAttribute('aria-pressed') === 'true';
  button.disabled = true;
  try {
    if (blocked) await api(`/api/blocks/${encodeURIComponent(name)}`, { method: 'DELETE' });
    else await api('/api/blocks', { method: 'POST', body: { username: name } });
    button.setAttribute('aria-pressed', String(!blocked));
    button.textContent = blocked ? 'Block' : 'Unblock';
    button.classList.toggle('ghost', !blocked);
    toast(blocked ? `${name} is unblocked.` : `${name} is blocked.`, 'good');
  } catch (error) { toast(error.message, 'bad'); }
  button.disabled = false;
});
