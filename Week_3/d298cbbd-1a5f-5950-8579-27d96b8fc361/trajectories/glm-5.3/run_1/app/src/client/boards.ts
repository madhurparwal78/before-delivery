import { api, type BoardRowData } from './api.js';
import { announce, el, formatPercent, formatSpeed, utcDateString } from './dom.js';
import { COPY } from './copy.js';
import type { PageContext } from './main.js';

// The boards: two tab lists and the live Leaderboard table.

export async function renderBoards(context: PageContext, folder: HTMLElement): Promise<void> {
  const { app } = context;
  const params = new URLSearchParams(window.location.search);
  const board = params.get('board') === 'alltime' ? 'alltime' : 'daily';
  const length = params.get('length') === '60' ? 60 : 15;

  const sheetEl = el('div', { class: 'sheet boards-sheet' }, '');
  const boardList = el('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Board' }, '');
  const lengthList = el('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Length' }, '');
  const updates = el('div', { role: 'status', 'aria-label': 'Board updates', class: 'status-region board-updates' }, '');
  const tableHost = el('div', { class: 'board-table' }, '');

  const boardTabs: { value: string; label: string }[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'alltime', label: 'All-time' },
  ];
  const lengthTabs: { value: string; label: string }[] = [
    { value: '15', label: '15 seconds' },
    { value: '60', label: '60 seconds' },
  ];

  const writeUrl = (): void => {
    const query = new URLSearchParams();
    query.set('board', board);
    query.set('length', String(length));
    window.history.replaceState({}, '', `/boards?${query.toString()}`);
  };

  const buildTabs = (host: HTMLElement, tabs: { value: string; label: string }[], current: string, onPick: (value: string) => void): HTMLElement[] => {
    host.textContent = '';
    const buttons: HTMLElement[] = [];
    tabs.forEach((tab) => {
      const selected = tab.value === current;
      const button = el('button', {
        type: 'button', role: 'tab', class: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        tabindex: selected ? '0' : '-1',
      }, tab.label) as unknown as HTMLButtonElement;
      if (selected) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => onPick(tab.value));
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const index = tabs.findIndex((t) => t.value === tab.value);
        const next = (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        buttons[next]?.focus();
        onPick(tabs[next].value);
      });
      host.appendChild(button);
      buttons.push(button);
    });
    return buttons;
  };

  buildTabs(boardList, boardTabs, board, (value) => {
    select(value === 'alltime' ? 'alltime' : 'daily', length);
  });
  buildTabs(lengthList, lengthTabs, String(length), (value) => {
    select(board, value === '60' ? 60 : 15);
  });

  const select = (nextBoard: 'daily' | 'alltime', nextLength: number): void => {
    if (nextBoard === board && nextLength === length) return;
    const query = new URLSearchParams();
    query.set('board', nextBoard);
    query.set('length', String(nextLength));
    window.history.replaceState({}, '', `/boards?${query.toString()}`);
    renderBoards(context, folder);
  };

  sheetEl.append(boardList, lengthList, updates, tableHost);
  folder.appendChild(sheetEl);

  const load = async (): Promise<void> => {
    tableHost.setAttribute('aria-busy', 'true');
    try {
      const response = await api<{ rows: BoardRowData[] }>(`/api/boards?board=${board}&length=${length}`, 'GET');
      tableHost.textContent = '';
      tableHost.removeAttribute('aria-busy');
      if (response.rows.length === 0) {
        tableHost.appendChild(el('p', { class: 'empty-board' }, COPY.emptyBoard));
        return;
      }
      const table = el('table', { class: 'data-table', 'aria-label': 'Leaderboard' });
      const thead = el('thead', {}, '');
      const headRow = el('tr', {}, '');
      for (const column of ['Rank', 'Typist', 'Speed', 'Accuracy', 'Date']) {
        headRow.appendChild(el('th', { scope: 'col' }, column));
      }
      thead.appendChild(headRow);
      const tbody = el('tbody', {}, '');
      for (const row of response.rows) {
        const tr = el('tr', {}, '');
        tr.appendChild(el('td', {}, String(row.rank)));
        tr.appendChild(el('td', {}, row.name));
        tr.appendChild(el('td', {}, formatSpeed(row.speed)));
        tr.appendChild(el('td', {}, formatPercent(row.accuracy)));
        tr.appendChild(el('td', {}, utcDateString(row.finishedAt)));
        tbody.appendChild(tr);
      }
      table.append(thead, tbody);
      tableHost.appendChild(table);
    } catch {
      tableHost.removeAttribute('aria-busy');
      tableHost.appendChild(el('p', { role: 'alert' }, COPY.serverError));
    }
  };

  await load();

  // Live board updates.
  const topic = `board:${board}:${length}`;
  app.connectLive([topic], null);
  app.onLive((event) => {
    if (event.kind !== 'board-change') return;
    void load();
    const payload = event.payload as { rank?: number; name?: string; speed?: number };
    if (typeof payload.name === 'string' && typeof payload.rank === 'number') {
      announce(updates, `${payload.name} is now #${payload.rank} with ${formatSpeed(payload.speed ?? 0)} wpm.`);
    }
  });
}
