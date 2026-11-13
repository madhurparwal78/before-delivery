import { api } from './api.js';
import { el, formatPercent, formatSpeed, utcDateString } from './dom.js';
import { COPY } from './copy.js';
import type { PageContext } from './main.js';

// The account page: Tests counted and the Personal bests table.

export async function renderAccount(context: PageContext, folder: HTMLElement): Promise<void> {
  const { app } = context;
  const sheetEl = el('div', { class: 'sheet account-sheet' }, '');
  folder.appendChild(sheetEl);
  if (app.state.session === null) {
    sheetEl.appendChild(el('p', {}, COPY.notFiledSignIn));
    return;
  }
  try {
    const account = await api<{
      name: string; email: string; verified: boolean; testsCounted: number;
      personalBests: { mode: string; length: number | null; punctuation: boolean; numbers: boolean; speed: number | null; accuracy: number | null; finishedAt: string }[];
    }>('/api/account', 'GET');
    const total = el('div', { id: 'tests-counted', class: 'account-total' }, `Tests counted ${account.testsCounted}`);
    const table = el('table', { class: 'data-table', 'aria-label': 'Personal bests' });
    const thead = el('thead', {}, '');
    const headRow = el('tr', {}, '');
    for (const column of ['Mode', 'Length', 'Punctuation', 'Numbers', 'Speed', 'Accuracy', 'Date']) {
      headRow.appendChild(el('th', { scope: 'col' }, column));
    }
    thead.appendChild(headRow);
    const tbody = el('tbody', {}, '');
    for (const best of account.personalBests) {
      const tr = el('tr', {}, '');
      tr.append(
        el('td', {}, best.mode),
        el('td', {}, best.length === null ? '-' : String(best.length)),
        el('td', {}, best.punctuation ? 'on' : 'off'),
        el('td', {}, best.numbers ? 'on' : 'off'),
        el('td', {}, formatSpeed(best.speed)),
        el('td', {}, formatPercent(best.accuracy)),
        el('td', {}, utcDateString(best.finishedAt)),
      );
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    sheetEl.append(el('h2', { class: 'sheet-heading' }, account.name), total, table);
  } catch {
    sheetEl.appendChild(el('p', { role: 'alert' }, COPY.serverError));
  }
}
