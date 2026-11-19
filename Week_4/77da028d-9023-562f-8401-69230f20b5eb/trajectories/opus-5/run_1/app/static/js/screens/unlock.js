import { api } from '../api.js';
import { clear, el } from '../dom.js';
import { paintSkyDisc } from '../skychart.js';

const WRONG_KEY = 'That workspace key is not recognised.';

export function renderUnlock(main) {
  const key = el('input', {
    type: 'text',
    id: 'unlock-key',
    'aria-label': 'Workspace key',
    autocomplete: 'off',
  });
  const summary = el('div', {
    role: 'alert',
    'aria-label': 'Error summary',
    class: 'error-summary',
    hidden: true,
  });
  const disc = el('canvas', { role: 'img', 'aria-label': 'Sky disc' });
  const form = el('form', { class: 'form-grid' }, [
    summary,
    el('div', { class: 'field' }, [
      el('label', { for: 'unlock-key', text: 'Workspace key' }),
      key,
    ]),
    el('button', { type: 'submit', class: 'pill', text: 'Unlock' }),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clear(summary);
    summary.hidden = true;
    try {
      await api('POST', '/api/unlock', { key: key.value.trim() });
      location.assign('/plan');
    } catch (error) {
      summary.hidden = false;
      summary.append(
        el('p', { text: error.status === 401 ? WRONG_KEY : error.message }),
        el('ul', {}, [
          el('li', {}, [
            el('a', {
              href: '#unlock-key',
              text: 'Workspace key',
              onclick: (click) => {
                click.preventDefault();
                key.focus();
              },
            }),
          ]),
        ]),
      );
    }
  });

  main.append(
    el('div', { class: 'hero-empty' }, [
      el('h1', { text: 'Darkframe' }),
      disc,
      el('p', { class: 'muted', text: 'Unlock the workspace with its key.' }),
    ]),
    el('div', { class: 'card', style: 'max-width:420px;margin:0 auto' }, [form]),
  );
  requestAnimationFrame(() => paintSkyDisc(disc, null));
}
