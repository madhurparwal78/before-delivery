import { api, showFieldError, toast } from './app.js';

const download = document.getElementById('download-record');
if (download) {
  download.addEventListener('click', () => {
    const text = document.getElementById('record-text').textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${window.location.pathname.split('/')[2]}.pgn`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

const form = document.getElementById('import-form');
if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFieldError('import-error', '');
    try {
      const game = await api('/api/games/import', { method: 'POST', body: { record: document.getElementById('import-text').value } });
      toast('Record imported.');
      window.location.href = `/game/${game.id}`;
    } catch (error) { showFieldError('import-error', error.message); }
  });
}
