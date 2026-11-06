// Search screen: From, To, date and quota.

import { api } from './api.js';
import { el } from './ui.js';
import { renderShell, setTitle, renderRibbon, getStations, stationName, type RibbonStop } from './shell.js';
import type { QuotaCode, ClassCode } from '../types.js';

export interface SearchQuery {
  from: string; to: string; date: string; quota: QuotaCode; cls: ClassCode;
}

export async function renderSearch(): Promise<void> {
  setTitle('Search trains');
  const stations = await getStations();
  const main = el('main', { id: 'main' });

  const from = stations[0]?.code ?? 'MMCT';
  const to = stations[5]?.code ?? 'NDLS';
  const ribbon = renderRibbon([
    { code: from, name: stationName(from), time: null, terminal: true },
    { code: to, name: stationName(to), time: null, terminal: true },
  ]);
  renderShell(main, { ribbon });

  main.appendChild(el('h1', {}, 'Search trains'));
  const form = el('form', { class: 'search-form', novalidate: 'novalidate' });

  const fromId = 'search-from', toId = 'search-to', dateId = 'search-date';
  const fromSelect = el('select', { id: fromId, name: 'from' });
  fromSelect.setAttribute('aria-label', 'From');
  const toSelect = el('select', { id: toId, name: 'to' });
  toSelect.setAttribute('aria-label', 'To');
  for (const s of stations) {
    const opt = el('option', { value: s.code }, `${s.code} ${s.name}`);
    if (s.code === from) opt.selected = true;
    fromSelect.appendChild(opt);
  }
  for (const s of stations) {
    const opt = el('option', { value: s.code }, `${s.code} ${s.name}`);
    if (s.code === to) opt.selected = true;
    toSelect.appendChild(opt);
  }
  const dateInput = el('input', { id: dateId, name: 'date', type: 'date' });
  dateInput.setAttribute('aria-label', 'Journey date');
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const defaultDate = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate() + 1)}`;
  dateInput.value = defaultDate;

  form.appendChild(el('label', { for: fromId }, 'From'));
  form.appendChild(fromSelect);
  form.appendChild(el('label', { for: toId }, 'To'));
  form.appendChild(toSelect);
  form.appendChild(el('label', { for: dateId }, 'Journey date'));
  form.appendChild(dateInput);

  const quotaFs = el('fieldset');
  quotaFs.appendChild(el('legend', {}, 'Quota'));
  quotaFs.setAttribute('role', 'radiogroup');
  quotaFs.setAttribute('aria-label', 'Quota');
  const radios = el('div', { class: 'radios' });
  for (const [code, label] of [['GN', 'General'], ['TQ', 'Tatkal'], ['LD', 'Ladies'], ['SS', 'Senior']] as [QuotaCode, string][]) {
    const id = `quota-${code}`;
    const input = el('input', { type: 'radio', id, name: 'quota', value: code });
    if (code === 'GN') input.checked = true;
    input.setAttribute('aria-label', label);
    const lab = el('label', { for: id }, label);
    radios.appendChild(input);
    radios.appendChild(lab);
  }
  quotaFs.appendChild(radios);
  form.appendChild(quotaFs);

  const actions = el('div', { class: 'actions' });
  const submit = el('button', { class: 'btn-primary', type: 'submit' }, 'Search trains');
  actions.appendChild(submit);
  form.appendChild(actions);
  main.appendChild(form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const quota = (form.querySelector('input[name="quota"]:checked') as HTMLInputElement).value as QuotaCode;
    const params = new URLSearchParams({
      from: (fromSelect as HTMLSelectElement).value,
      to: (toSelect as HTMLSelectElement).value,
      date: dateInput.value,
      quota,
      class: 'SL',
    });
    location.href = `/trains?${params.toString()}`;
  });

  void api;
}
