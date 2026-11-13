import { api, type HistoryRow, type StoredRun } from './api.js';
import { el, formatPercent, formatSpeed, formatDuration, utcDateTimeString, utcDateString, ordinal } from './dom.js';
import { COPY, NOT_COUNTED_REASONS } from './copy.js';
import type { PageContext } from './main.js';
// History, account, boards, race rooms, settings and the auth screens.

export async function renderHistory(context: PageContext, folder: HTMLElement): Promise<void> {
  const { app } = context;
  const sheetEl = el('div', { class: 'sheet history-sheet' }, '');
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') ?? 'all';
  const verdict = params.get('verdict') ?? 'all';
  const table = el('div', { class: 'history-table' }, '');
  sheetEl.append(buildFilters(mode, params.get('length') ?? 'all', verdict), table);
  folder.appendChild(sheetEl);

  const query = new URLSearchParams();
  if (mode !== 'all') query.set('mode', mode);
  if (params.get('length') !== null && params.get('length') !== 'all') query.set('length', params.get('length') as string);
  if (verdict !== 'all') query.set('verdict', verdict === 'counted' ? 'counted' : 'not_counted');

  const load = async (): Promise<void> => {
    table.setAttribute('aria-busy', 'true');
    try {
      const response = await api<{ runs: HistoryRow[]; more: boolean }>(`/api/history?${query.toString()}&page=1`, 'GET');
      table.textContent = '';
      table.removeAttribute('aria-busy');
      if (response.runs.length === 0) {
        table.appendChild(el('p', { class: 'empty-history' }, COPY.emptyHistory));
        return;
      }
      const desktopTable = el('table', { class: 'data-table history-table-desktop', 'aria-label': 'History' });
      const thead = el('thead', {}, '');
      const headRow = el('tr', {}, '');
      for (const column of ['Date', 'Mode', 'Length', 'Speed', 'Raw', 'Accuracy', 'Consistency', 'Verdict']) {
        headRow.appendChild(el('th', { scope: 'col' }, column));
      }
      thead.appendChild(headRow);
      const tbody = el('tbody', {}, '');
      const phoneList = el('ul', { class: 'history-cards', 'aria-label': 'History' });
      for (const run of response.runs) {
        const open = el('a', { href: `/runs/${run.runId}`, class: 'run-link' }, COPY.openRun);
        const values = [
          utcDateTimeString(run.finishedAt),
          run.mode,
          run.length === null ? '-' : String(run.length),
          formatSpeed(run.speed),
          formatSpeed(run.raw),
          formatPercent(run.accuracy),
          formatPercent(run.consistency),
          run.verdict === 'counted' ? 'Counted' : 'Not counted',
        ];
        const tr = el('tr', {}, '');
        values.forEach((value) => tr.appendChild(el('td', {}, value)));
        const td = el('td', {}, '');
        td.appendChild(open.cloneNode(true));
        tr.appendChild(td);
        tbody.appendChild(tr);

        const card = el('li', { class: 'history-card' }, '');
        const fields = ['Date', 'Mode', 'Length', 'Speed', 'Raw', 'Accuracy', 'Consistency', 'Verdict'];
        fields.forEach((field, index) => {
          card.append(el('span', { class: 'card-field-label' }, field), el('span', { class: 'card-field-value' }, values[index]));
        });
        card.appendChild(open);
        phoneList.appendChild(card);
      }
      desktopTable.append(thead, tbody);
      table.append(desktopTable, phoneList);
      if (response.more) {
        const older = el('button', { class: 'button button-quiet older-runs' }, COPY.olderRuns);
        older.addEventListener('click', () => { void loadMore(desktopTable, phoneList, query, older); });
        table.appendChild(older);
      }
    } catch {
      table.removeAttribute('aria-busy');
      table.appendChild(el('p', { role: 'alert' }, COPY.serverError));
    }
  };

  const loadMore = async (desktopTable: HTMLElement, phoneList: HTMLElement, query: URLSearchParams, older: HTMLElement): Promise<void> => {
    const pages = desktopTable.querySelectorAll('tbody tr').length;
    const page = Math.floor(pages / 20) + 1;
    const response = await api<{ runs: HistoryRow[]; more: boolean }>(`/api/history?${query.toString()}&page=${page}`, 'GET');
    for (const run of response.runs) {
      appendHistoryRow(desktopTable, phoneList, run);
    }
    if (!response.more) older.remove();
  };

  if (app.state.session === null) {
    table.appendChild(el('p', { class: 'empty-history' }, COPY.emptyHistory));
    return;
  }
  void load();
}

function appendHistoryRow(desktopTable: HTMLElement, phoneList: HTMLElement, run: HistoryRow): void {
  const tbody = desktopTable.querySelector('tbody');
  if (tbody !== null) {
    const values = [
      utcDateTimeString(run.finishedAt),
      run.mode,
      run.length === null ? '-' : String(run.length),
      formatSpeed(run.speed),
      formatSpeed(run.raw),
      formatPercent(run.accuracy),
      formatPercent(run.consistency),
      run.verdict === 'counted' ? 'Counted' : 'Not counted',
    ];
    const tr = el('tr', {}, '');
    values.forEach((value) => tr.appendChild(el('td', {}, value)));
    const td = el('td', {}, '');
    td.appendChild(el('a', { href: `/runs/${run.runId}` }, COPY.openRun));
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  const card = el('li', { class: 'history-card' }, '');
  const fields = ['Date', 'Mode', 'Length', 'Speed', 'Raw', 'Accuracy', 'Consistency', 'Verdict'];
  const values = [
    utcDateTimeString(run.finishedAt), run.mode, run.length === null ? '-' : String(run.length),
    formatSpeed(run.speed), formatSpeed(run.raw), formatPercent(run.accuracy), formatPercent(run.consistency),
    run.verdict === 'counted' ? 'Counted' : 'Not counted',
  ];
  fields.forEach((field, index) => {
    card.append(el('span', { class: 'card-field-label' }, field), el('span', { class: 'card-field-value' }, values[index]));
  });
  card.appendChild(el('a', { href: `/runs/${run.runId}` }, COPY.openRun));
  phoneList.appendChild(card);
}

function buildFilters(mode: string, length: string, verdict: string): HTMLElement {
  const row = el('div', { class: 'filter-row' }, '');
  const modeSelect = el('select', { class: 'select', 'aria-label': 'Mode' }) as unknown as HTMLSelectElement;
  for (const value of ['all', 'time', 'words', 'quote', 'custom']) {
    const option = el('option', { value }, value === 'all' ? 'All' : value);
    if (value === mode) (option as HTMLOptionElement).selected = true;
    modeSelect.appendChild(option);
  }
  const lengthSelect = el('select', { class: 'select', 'aria-label': 'Length' }) as unknown as HTMLSelectElement;
  const lengthOption = el('option', { value: 'all' }, 'All');
  if (length === 'all') (lengthOption as HTMLOptionElement).selected = true;
  lengthSelect.appendChild(lengthOption);
  const verdictSelect = el('select', { class: 'select', 'aria-label': 'Verdict' }) as unknown as HTMLSelectElement;
  for (const [value, label] of [['all', 'All'], ['counted', 'Counted'], ['not_counted', 'Not counted']] as const) {
    const option = el('option', { value }, label);
    if (value === verdict) (option as HTMLOptionElement).selected = true;
    verdictSelect.appendChild(option);
  }
  const update = (): void => {
    const params = new URLSearchParams();
    if (modeSelect.value !== 'all') params.set('mode', modeSelect.value);
    if (lengthSelect.value !== 'all') params.set('length', lengthSelect.value);
    if (verdictSelect.value !== 'all') params.set('verdict', verdictSelect.value);
    window.history.replaceState({}, '', `/history?${params.toString()}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  modeSelect.addEventListener('change', update);
  lengthSelect.addEventListener('change', update);
  verdictSelect.addEventListener('change', update);
  row.append(modeSelect, lengthSelect, verdictSelect);
  return row;
}
