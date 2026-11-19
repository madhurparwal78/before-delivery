import { el, t } from './ui.js';
import { store } from './store.js';
import { setLocale } from './api-client.js';

/** The language picker re-renders the page in the chosen language at once (DP-07). */
export function mountLanguagePicker(): void {
  const root = document.getElementById('language-picker-root');
  if (!root) return;
  const select = root.querySelector('select');
  if (!select) return;
  select.setAttribute('aria-label', t('controls', 'language'));
  select.addEventListener('change', async () => {
    await setLocale(select.value);
    location.reload();
  });
  // The picker is a combobox by role; make each option announce its own name.
  for (const option of Array.from(select.options)) {
    option.setAttribute('role', 'option');
  }
  select.setAttribute('aria-expanded', 'false');
  select.setAttribute('aria-haspopup', 'listbox');
}

export function languagePickerHtml(): HTMLElement {
  const row = el('div', { class: 'lang-row', id: 'language-picker-root' });
  const labelEl = el('label', { for: 'language-picker', text: t('controls', 'language') });
  const select = el('select', { id: 'language-picker', 'aria-label': t('controls', 'language'), role: 'combobox' });
  for (const value of ['en', 'ja', 'es']) {
    const option = el('option', { value, text: value === 'en' ? 'English' : value === 'ja' ? '日本語' : 'Español' });
    if (value === store.account?.locale || value === document.documentElement.lang) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', async () => {
    await setLocale(select.value);
    location.reload();
  });
  row.append(labelEl, select);
  return row;
}
