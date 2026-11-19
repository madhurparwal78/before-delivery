import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { createErrorSummary } from '../core/forms.js';
import { skyDisc } from './sky-disc.js';

const WRONG_KEY = 'That workspace key is not recognised.';

export async function mount() {
  document.title = 'Unlock - Darkframe';
  document.body.classList.add('page-unlock');
  const summary = createErrorSummary();
  const key = h('input', { id: 'workspace-key', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-field': 'key' });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Unlock');

  const form = h('form', { class: 'unlock-form', novalidate: true },
    summary.element,
    h('div', { class: 'field' }, h('label', { for: key.id }, 'Workspace key'), key),
    submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    summary.clear();
    key.removeAttribute('aria-invalid');
    if (key.value.trim() === '') {
      summary.showFields({ key: 'Enter your workspace key.' }, () => key);
      return;
    }
    submit.disabled = true;
    try {
      await api('POST', '/api/unlock', { body: { key: key.value.trim() } });
      location.assign('/plan');
    } catch (error) {
      summary.showMessage(error.code === 'invalid_key' ? WRONG_KEY : error.message);
      submit.disabled = false;
    }
  });

  document.getElementById('app').replaceChildren(
    h('main', { id: 'main', class: 'unlock' },
      h('div', { class: 'hero' }, skyDisc({ size: 320 })),
      h('h1', {}, 'Darkframe'),
      h('p', { class: 'muted' }, 'Unlock your workspace to open tonight.'),
      form));
  key.focus();
}
