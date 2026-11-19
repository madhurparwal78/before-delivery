/**
 * Settings: the member's name, picture, view, sets, theme and sound.  Every
 * choice is stored with the account, so it survives signing in elsewhere.
 */

import { api, toast, fieldError } from './app.js';
import { pieceSvg, FLAT_SETS } from './pieces.js';
import { playSound } from './sound.js';

const root = document.documentElement;

document.getElementById('name-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  fieldError('settings-username-error', '');
  const username = document.getElementById('settings-username').value.trim();
  try {
    const member = await api('PATCH', '/api/profile', { username });
    document.querySelectorAll('.me-name').forEach((node) => { node.textContent = member.username; });
    root.dataset.member = member.username;
    toast('Your name is changed everywhere it appears.');
  } catch (error) {
    fieldError('settings-username-error', error.message);
  }
});

async function patch(body, note) {
  try {
    await api('PATCH', '/api/profile', body);
    const status = document.getElementById('settings-note');
    if (status) status.textContent = note;
  } catch (error) {
    toast(error.message, 'error');
  }
}

document.querySelectorAll('input[name="view"]').forEach((input) => {
  input.addEventListener('change', () => patch({ view: input.value }, `The board opens on the ${input.labels[0].textContent.toLowerCase()}.`));
});

document.querySelectorAll('input[name="piece_set_2d"]').forEach((input) => {
  input.addEventListener('change', () => {
    root.dataset.set2d = input.value;
    renderPreview();
    patch({ piece_set_2d: input.value }, `Flat pieces: ${input.value}.`);
  });
});

document.querySelectorAll('input[name="piece_set_3d"]').forEach((input) => {
  input.addEventListener('change', () => {
    root.dataset.set3d = input.value;
    patch({ piece_set_3d: input.value }, `Deep pieces: ${input.value}.`);
  });
});

document.querySelectorAll('input[name="theme"]').forEach((input) => {
  input.addEventListener('change', () => {
    root.dataset.theme = input.value;
    patch({ theme: input.value }, `Board theme: ${input.value}.`);
  });
});

document.querySelectorAll('input[name="sound"]').forEach((input) => {
  input.addEventListener('change', () => {
    const on = input.value === 'on';
    root.dataset.sound = on ? 'on' : 'off';
    patch({ sound: on }, on ? 'Sound is on.' : 'Sound is off.');
  });
});

document.getElementById('sound-test')?.addEventListener('click', () => {
  const played = playSound('move');
  if (!played) toast('Sound is off, so nothing played.');
});

document.querySelectorAll('input[name="avatar"]').forEach((input) => {
  input.addEventListener('change', async () => {
    try {
      const member = await api('PUT', '/api/profile/avatar', { avatar: input.value });
      document.querySelectorAll('.rail-me img, #avatar-now').forEach((image) => {
        image.src = `${member.avatar_url}?v=${Date.now()}`;
      });
      toast('Your picture is changed.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
});

document.getElementById('avatar-upload-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  fieldError('avatar-error', '');
  const input = document.getElementById('avatar-file');
  const file = input.files?.[0];
  if (!file) {
    fieldError('avatar-error', 'Choose a picture first.');
    return;
  }
  const data = new FormData();
  data.append('file', file);
  try {
    const member = await api('PUT', '/api/profile/avatar', data);
    document.querySelectorAll('.rail-me img, #avatar-now').forEach((image) => {
      image.src = `${member.avatar_url}?v=${Date.now()}`;
    });
    toast('Your picture is stored as a 256 by 256 PNG.');
  } catch (error) {
    fieldError('avatar-error', error.message);
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-unblock]');
  if (!button) return;
  try {
    await api('DELETE', `/api/blocks/${encodeURIComponent(button.dataset.unblock)}`);
    button.closest('.member-row')?.remove();
    toast('Unblocked. They may challenge and chat you again.');
  } catch (error) {
    toast(error.message, 'error');
  }
});

/** One position in every flat set, so a choice shows before it is made. */
function renderPreview() {
  const holder = document.getElementById('set-preview');
  if (!holder) return;
  const pieces = ['K', 'q', 'R', 'b', 'N', 'p'];
  holder.innerHTML = FLAT_SETS.map((set) => `<figure data-set-preview="${set}">
    <span class="preview-row">${pieces.map((piece) => `<span>${pieceSvg(set, piece)}</span>`).join('')}</span>
    <figcaption>${set}</figcaption>
  </figure>`).join('');
}

renderPreview();
