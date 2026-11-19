import { api, showFieldError, toast } from './app.js';

const SET_SLUG = { Classic: 'classic', 'Staunton Flat': 'staunton', Neo: 'neo', Pixel: 'pixel' };

function repaintPreview() {
  const slug = document.documentElement.dataset.set2d;
  document.querySelectorAll('#settings-board .piece use').forEach((use) => {
    const kind = use.closest('.piece').dataset.kind;
    use.setAttribute('href', `#pc-${slug}-${kind}`);
  });
}

function markGroup(selector, attribute, value) {
  document.querySelectorAll(selector).forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset[attribute] === value));
  });
}

async function save(body, after) {
  try {
    const me = await api('/api/profile', { method: 'PATCH', body });
    if (after) after(me);
    toast('Saved.');
  } catch (error) { toast(error.message, 'bad'); }
}

document.getElementById('name-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFieldError('username-error', '');
  const username = document.getElementById('username').value.trim();
  try {
    await api('/api/profile', { method: 'PATCH', body: { username } });
    window.location.reload();
  } catch (error) { showFieldError('username-error', error.message); }
});

document.querySelectorAll('[data-avatar]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      const me = await api('/api/profile/avatar', { method: 'PUT', body: { avatar: button.dataset.avatar } });
      document.querySelectorAll('.rail-account .avatar').forEach((img) => { img.src = `${me.avatar_url}?v=${Date.now()}`; });
      toast('Picture changed.');
    } catch (error) { toast(error.message, 'bad'); }
  });
});

document.getElementById('avatar-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFieldError('avatar-error', '');
  const input = document.getElementById('avatar-file');
  if (!input.files || !input.files[0]) { showFieldError('avatar-error', 'Choose a file first.'); return; }
  const body = new FormData();
  body.append('file', input.files[0]);
  try {
    const me = await api('/api/profile/avatar', { method: 'PUT', body });
    document.querySelectorAll('.rail-account .avatar').forEach((img) => { img.src = `${me.avatar_url}?v=${Date.now()}`; });
    toast('Picture uploaded.');
  } catch (error) { showFieldError('avatar-error', error.message); }
});

document.querySelectorAll('#set2d-group [data-set2d]').forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.dataset.set2d;
    document.documentElement.dataset.set2d = SET_SLUG[value];
    markGroup('#set2d-group [data-set2d]', 'set2d', value);
    repaintPreview();
    save({ piece_set_2d: value });
  });
});

document.querySelectorAll('#set3d-group [data-set3d]').forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.dataset.set3d;
    document.documentElement.dataset.set3d = value;
    markGroup('#set3d-group [data-set3d]', 'set3d', value);
    save({ piece_set_3d: value });
  });
});

document.querySelectorAll('#theme-group [data-theme-choice]').forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.dataset.themeChoice;
    document.documentElement.dataset.theme = value;
    markGroup('#theme-group [data-theme-choice]', 'themeChoice', value);
    save({ theme: value });
  });
});

document.querySelectorAll('#view-group [data-view-choice]').forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.dataset.viewChoice;
    markGroup('#view-group [data-view-choice]', 'viewChoice', value);
    save({ view: value });
  });
});

document.getElementById('sound-toggle')?.addEventListener('change', (event) => {
  const on = event.target.checked;
  document.documentElement.dataset.sound = on ? 'on' : 'off';
  save({ sound: on });
});
