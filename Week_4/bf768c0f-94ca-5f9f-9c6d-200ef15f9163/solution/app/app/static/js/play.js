import { api, showFieldError, toast } from './app.js';

const challengeForm = document.getElementById('challenge-form');
if (challengeForm) {
  challengeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFieldError('challenge-error', '');
    try {
      const challenge = await api('/api/challenges', {
        method: 'POST',
        body: {
          opponent: document.getElementById('opponent').value,
          colour: document.getElementById('challenge-colour').value,
          club: document.getElementById('challenge-club').value || null,
          rated: document.getElementById('challenge-rated').checked,
        },
      });
      toast(`Challenge sent to ${challenge.to.username}.`);
      window.setTimeout(() => { window.location.href = '/challenges'; }, 600);
    } catch (error) {
      showFieldError('challenge-error', error.message);
    }
  });
}

document.querySelectorAll('[data-house-level]').forEach((button) => {
  button.addEventListener('click', async () => {
    showFieldError('house-error', '');
    button.disabled = true;
    try {
      const game = await api('/api/computer-games', { method: 'POST', body: { level: button.dataset.houseLevel } });
      window.location.href = `/game/${game.id}`;
    } catch (error) {
      showFieldError('house-error', error.message);
      button.disabled = false;
    }
  });
});

const fenForm = document.getElementById('fen-form');
if (fenForm) {
  fenForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFieldError('fen-error', '');
    try {
      const game = await api('/api/games/from-fen', { method: 'POST', body: { fen: document.getElementById('study-fen').value.trim() } });
      window.location.href = `/game/${game.id}`;
    } catch (error) {
      showFieldError('fen-error', error.message);
    }
  });
}
